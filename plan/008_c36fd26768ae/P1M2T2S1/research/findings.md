# Research Findings — P1.M2.T2.S1 (RewindMarker.revert + RevertCheckpoint)

## 1. The ONE core mechanism (why this task is ~15 lines of pure types)

`RewindMarkerInput = Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">` (markers.ts line 87).
`revert` is **NOT** in the Omit list, so adding `revert?` to `RewindMarker` **automatically propagates** to `RewindMarkerInput`.

`appendRewindMarker` builds the entry via `{ ...data, schema, v, kind, id, seq, ts }` (markers.ts ~lines 230-240).
`revert` is NOT among the stamped fields, so it **rides the `{...data}` spread** like `hideEntryIds`/`excludeToolCallId` already do.

**Consequence:** NO change to `appendRewindMarker` is required. The task is strictly:
1. Add the `revert?` field to the `RewindMarker` interface.
2. Add the new exported `RevertCheckpoint` interface.
Both verbatim from spec. This matches `architecture/codebase_patterns.md` §2 exactly.

## 2. Exact definitions (copy from spec — do NOT paraphrase field names/types)

### revert field — spec/04-data-model.md §3 (the RewindMarker block):
```ts
/** v1.2 working-tree revert result — present only when the agent requested revert AND `config.revert.enabled`
 *  AND the granularity is supported (last_turn/checkpoint). `backend:"none"`/absent ⇒ revert did not run.
 *  Audit-recoverable from /tree. See `@14-working-tree-revert.md` §2 (SnapshotStore) / §6 (restore). */
revert?: {
  revertedFiles: string[];        // paths restored to their pre-span content
  deletedFiles: string[];         // span-created paths deleted (delete_created_files + allowDeleteCreatedFiles)
  failedFiles: string[];          // paths that could not be restored/deleted (best-effort; logged)
  refusedFiles: string[];         // paths the dirty guard refused (post-turn drift) — revert skipped those
  skipped: boolean;               // true when caps/partial snapshot degraded the restore
  backend: "git" | "cas" | "none";
};
```
**Placement:** AFTER the existing `ts: number;` field (markers.ts line 82), BEFORE the closing `}` (line 83). This matches spec/04 §3 ordering (ledger → ts → revert) exactly.

### RevertCheckpoint — spec/14-working-tree-revert.md §2 (line 62):
```ts
interface RevertCheckpoint { label: string; backend: "git" | "cas"; beforeRef: string; afterRef?: string; turnIndex: number; ts: number; }
```
- Export it: `export interface RevertCheckpoint { ... }`.
- `backend` here is `"git" | "cas"` only (NO "none" — a checkpoint only exists when a real backend captured; "none" ⇒ no checkpoint).
- `afterRef` is OPTIONAL (may be null until agent_end captures it).
- **Placement:** a new section block AFTER `RewindMarkerInput` (line 87) and BEFORE the shrink divider (line 89).

## 3. anchors (1-indexed) for the edits
| line | content | role |
|------|---------|------|
| 82   | `  ts: number;` | last field of RewindMarker → insert `revert?` AFTER |
| 83   | `}`              | closing brace of RewindMarker |
| 87   | `export type RewindMarkerInput = Omit<...>` | insert RevertCheckpoint block AFTER |
| 89   | `// ── Marker: shrink (spec/04...` divider | boundary (don't cross) |

## 4. Downstream consumers (NOT implemented here — for context only)
- **runtime.ts (P1.M2.T2.S2):** adds `snapshots?: Map<string, RevertCheckpoint>` to `SessionRuntime` — IMPORTS `type RevertCheckpoint` from `./markers.js`.
- **store.ts (P2.M1.T1.S1):** the `SnapshotStore` interface; `RevertCheckpoint` is the persisted checkpoint shape.
- **rewind.ts step 6b (P4.M2.T1.S2):** writes `revert` into the marker payload (via `RewindMarkerInput`).
So the type MUST be exported and field MUST be optional (both confirmed).

## 5. JSDoc / citations (Mode A — docs ride with the work)
Item DOCS line: "citing @14 §2 and @spec/04 §3".
- `revert?` JSDoc → cite `spec/04-data-model.md §3` (home) + `@14-working-tree-revert.md` (§2 SnapshotStore, §6 restore, §7 rewind integration).
- `RevertCheckpoint` JSDoc → cite `@14-working-tree-revert.md §2` (definition) + note it is consumed by runtime.ts + store.ts.
The codebase style is rich per-export JSDoc citing spec sections (see the existing `hideEntryIds` JSDoc as the density model).

## 6. Validation gates (project-specific, verified)
- `npm run typecheck` → `tsc --noEmit` (tsconfig: `strict:true, noImplicitAny:true`). This is the PRIMARY gate: it proves (a) the types compile, (b) `RewindMarkerInput` picks up `revert?` via Omit, (c) nothing downstream breaks.
- `npm test` → `vitest run`.
- **NO** ruff/mypy/eslint/uv (this is a TS project, those are Python tools).

## 7. Test additions — exact pattern to follow (test/markers.test.ts)
Import block already pulls type-only from `"../src/markers.js"` — ADD `type RevertCheckpoint`.

Template A — optional-field test (mirror the existing `hideEntryIds` test in the `describe("types ...")` block):
```ts
it("RewindMarker/RewindMarkerInput carry optional revert (v1.2 working-tree revert; backward-compat)", () => {
  const withoutRevert: RewindMarkerInput = REWIND_DATA;            // omits revert → compiles (old markers)
  const withRevert: RewindMarkerInput = { ...REWIND_DATA, revert: { revertedFiles: ["a.ts"], deletedFiles: [], failedFiles: [], refusedFiles: [], skipped: false, backend: "git" } };
  expectTypeOf(withRevert.revert).toEqualTypeOf<RewindMarker["revert"] | undefined>();
  expectTypeOf(withoutRevert.revert).toEqualTypeOf<RewindMarker["revert"] | undefined>();
});
```
Template B — type-shape test (mirror the NoteDetails test):
```ts
it("RevertCheckpoint is { label; backend:'git'|'cas'; beforeRef; afterRef?; turnIndex; ts } (spec/14 §2)", () => {
  const c = {} as RevertCheckpoint;
  expectTypeOf(c.label).toEqualTypeOf<string>();
  expectTypeOf(c.backend).toEqualTypeOf<"git" | "cas">();
  expectTypeOf(c.beforeRef).toEqualTypeOf<string>();
  expectTypeOf(c.afterRef).toEqualTypeOf<string | undefined>();
  expectTypeOf(c.turnIndex).toEqualTypeOf<number>();
  expectTypeOf(c.ts).toEqualTypeOf<number>();
});
```
Existing tests stay GREEN unchanged (revert? optional ⇒ `REWIND_DATA` still compiles; `appendRewindMarker(pi,ctx,REWIND_DATA)` unaffected).

## 8. Scope guardrails (do NOT do these — they belong to other tasks)
- Do NOT touch `appendRewindMarker` body (revert rides the spread automatically).
- Do NOT touch runtime.ts (`snapshots` field is P1.M2.T2.S2).
- Do NOT create src/snapshot/store.ts (P2.M1.T1.S1) — paths.ts already exists from the sibling.
- Do NOT add a "checkpoint" literal to the `Granularity` union (already present in config.ts).
- Do NOT modify the spec/*.md or plan files.