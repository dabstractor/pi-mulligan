# Codebase Recon — P1.M2.T1.S1 (Add hideEntryIds to marker type interfaces)

First-hand findings from reading pi-mulligan at the start of this bugfix subtask.

## 1. What this task is (and is NOT)

- **IS**: Add an OPTIONAL `hideEntryIds?: string[]` field to the three rewind-marker type surfaces + JSDoc.
- **IS NOT**: implement capture (P1.M2.T3), implement `resolvePinnedHide` (P1.M2.T2), or wire
  `filterPipeline` dispatch (P1.M2.T4). Those CONSUME the field this task adds. **This task is the data-model
  foundation only.** No runtime/algorithm behavior changes — the field is optional and additive.

## 2. The three interfaces — EXACT current state (verified live)

### 2a. `RewindMarker` — `src/markers.ts:54-73` (FROZEN persisted shape, spec/04 §3)
```ts
export interface RewindMarker extends MulliganEnvelope {
  kind: "rewind";
  id: string;
  granularity: Granularity;
  options: { to_previous_prompt?: boolean; protect?: string[]; };
  excludeToolCallId?: string;   // ← INSERT hideEntryIds AFTER this line
  seq: number;
  note: NoteInput;
  ledger: FileLedger;
  ts: number;
}
```

### 2b. `RewindMarkerInput` — `src/markers.ts:77` (caller-supplied payload, DERIVED)
```ts
export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;
```
**CRITICAL: `hideEntryIds` is NOT in the Omit list → adding it to `RewindMarker` AUTO-PROPAGATES to
`RewindMarkerInput`. NO edit needed here.** (This is the one non-obvious fact; do NOT hand-add it.)

### 2c. `RewindMarkerLike` — `src/transforms.ts:793-805` (structural slice filterPipeline reads)
```ts
export interface RewindMarkerLike {
  seq: number;
  granularity: "last_tool_call_group" | "last_turn" | "checkpoint";
  options?: { to_previous_prompt?: boolean };
  excludeToolCallId?: string;   // ← INSERT hideEntryIds AFTER this line (before `checkpoint?: string`)
  checkpoint?: string;          // the precedent field (see §3)
}
```
`RewindMarkerLike` is declared LOCALLY in transforms.ts (which stays **Pi-FREE / 0 imports** — it must NOT
import markers.ts). Adding a field does not change that. A real `RewindMarker` assigns in with NO cast.

## 3. The precedent: `checkpoint` rides the spread WITHOUT being in the frozen type

- `checkpoint?: string` exists ONLY in `RewindMarkerLike` (transforms.ts:825), NOT in `RewindMarker`/
  `RewindMarkerInput`. filterPipeline reads it defensively via `readOwn(rw, "checkpoint")`
  (transforms.ts:1032). The rewind TOOL persists it at runtime via the spread (markers.ts:166-176
  `appendRewindMarker` does `{ ...data, ...envelope }`), so the extra field survives though it is untyped at
  the source interface — this is **GOTCHA #1 in src/tools/rewind.ts**.
- **`hideEntryIds` improves on this**: add it to ALL THREE interfaces as a FIRST-CLASS typed field (so the
  rewind tool, the wrapper, the filter, and tests all get type safety). It rides the SAME spread mechanism at
  runtime, but is now typed everywhere.

## 4. The spread that persists hideEntryIds (markers.ts:161-189, `appendRewindMarker`)
```ts
const entry: RewindMarker = { ...data /* RewindMarkerInput */, schema, v, kind:"rewind", id, seq, ts };
pi.appendEntry("mulligan:rewind", entry);
```
`...data` spreads `RewindMarkerInput`. Once `hideEntryIds` is in `RewindMarker` (→ `RewindMarkerInput`), a
caller passing `hideEntryIds` in `data` gets it persisted to the entry. **No change to `appendRewindMarker`
is needed** — the spread already carries any field present in `data`. (P1.M2.T3 is the task that starts
POPULATING `data.hideEntryIds`; this task only types the field.)

## 5. filterPipeline reads defensively via `readOwn` (the read side, for context)

The downstream P1.M2.T4 dispatch will be `readOwn(rw, "hideEntryIds")` (mirroring `readOwn(rw, "checkpoint")`
at transforms.ts:1032). Because the field is read via `readOwn` (a try/catch property read), an ABSENT
`hideEntryIds` returns `undefined` → filterPipeline falls back to relative resolution. **This is exactly why
the field being OPTIONAL is correct for backward compatibility** (old markers lack it; new markers populate it).

## 6. Parallel-task boundary — DO NOT collide with P1.M1.T3.S1

- P1.M1.T3.S1 (in flight) edits `resolveCheckpoint` in **transforms.ts:450-526** (snaps `iTarget` to a unit
  boundary) + 3 tests in transforms.test.ts. **That is a DIFFERENT region** of transforms.ts from
  `RewindMarkerLike` (793-805) — ~340 lines away. My edit is a single additive field in the interface; no
  overlap. If the two edits land concurrently, the only risk is a trivial text-merge on transforms.ts (the
  changed line ranges are disjoint). Do NOT touch `resolveCheckpoint` — that is P1.M1.T3.S1's scope.
- markers.ts is NOT edited by any in-flight task → safe to edit `RewindMarker` there.

## 7. Test fixtures + convention (verified)

- `test/markers.test.ts:117-130` defines `const REWIND_DATA: RewindMarkerInput = { … }` (omits hideEntryIds →
  already proves backward-compat by compiling once the field is added). Existing type-level assertion at
  markers.test.ts:435 (`expectTypeOf(r.granularity).toEqualTypeOf<RewindMarker["granularity"]>()`).
- vitest convention: `expectTypeOf` for type checks; `npx vitest run` for the suite; `npx tsc --noEmit -p
  tsconfig.json` for types.

## 8. Baseline state (run live at start of recon)

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `npx vitest run test/markers.test.ts test/transforms.test.ts` → **176 passed** (markers 42 + transforms 134).
- Full suite is 671 tests (per the bugfix PRD h2.0 overview) — all green pre-fix.

## 9. Downstream consumers of this field (do NOT implement them — for boundary awareness)

- **P1.M2.T2** `resolvePinnedHide(messages, branchEntries, hideEntryIds): number[]` (transforms.ts) — reads
  `hideEntryIds` as a `string[]` arg.
- **P1.M2.T3** `captureHideEntryIds` (rewind.ts/markers.ts) — POPULATES `data.hideEntryIds` at rewind-creation.
- **P1.M2.T4** filterPipeline dispatch — `readOwn(rw, "hideEntryIds")` → `resolvePinnedHide` else legacy fallback.