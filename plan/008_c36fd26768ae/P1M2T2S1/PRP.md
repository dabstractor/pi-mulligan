---
name: "P1.M2.T2.S1 — Add RewindMarker.revert field + RevertCheckpoint type to markers.ts"
description: "Pure TypeScript type additions: an optional `revert?` block on RewindMarker (v1.2 working-tree revert result) + a new exported RevertCheckpoint interface. Both are verbatim from spec/04 §3 and spec/14 §2. No runtime logic changes — revert rides the existing `{...data}` spread in appendRewindMarker via Omit propagation."
---

## Goal

**Feature Goal**: Add the two type definitions the v1.2 working-tree-revert feature needs as the shared data-model hub: (1) an OPTIONAL `revert?` result block on `RewindMarker`, and (2) a NEW exported `RevertCheckpoint` interface. Both compile and are consumable by downstream tasks (runtime.ts P1.M2.T2.S2, store.ts P2.M1.T1.S1, rewind.ts P4.M2.T1.S2) without changing `appendRewindMarker`.

**Deliverable**: A focused edit to `src/markers.ts` adding the two type members (verbatim field names/types from spec), plus `test/markers.test.ts` additions asserting the optionality and shapes via `expectTypeOf`. [Mode A] JSDoc on each new member citing spec sections.

**Success Definition**:
- `npm run typecheck` (tsc --noEmit, strict) passes.
- `npm test` (vitest run) passes — new tests added, ALL existing markers tests still green.
- `RewindMarkerInput` exposes `revert?: {...}` automatically (via Omit) — no edit to the wrapper.
- `RevertCheckpoint` is exported and importable as `import { type RevertCheckpoint } from "./markers.js"`.
- Old persisted markers (no `revert`) still type-check → backward-compatible.

## User Persona

**Target User**: Downstream implementation tasks (P1.M2.T2.S2 runtime.ts, P2.M1.T1.S1 store.ts, P4.M2.T1.S2 rewind.ts step 6b) that import these types.

**Use Case**: `runtime.ts` will hold `snapshots?: Map<string, RevertCheckpoint>`; `store.ts` will use `RevertCheckpoint` as the persisted checkpoint shape; `rewind.ts` will write the `revert` result into `RewindMarkerInput` (which carries it through the spread into the persisted marker).

**Pain Points Addressed**: There is currently NO type for the revert result or the snapshot checkpoint anywhere in `src/`. Downstream tasks cannot type their revert code without this shared definition living in the data-model hub (`markers.ts`).

## Why

- **Unblocks the v1.2 revert chain**: P1.M2.T2.S2 (runtime snapshots) and P2.M1.T1.S1 (SnapshotStore interface) both `import { type RevertCheckpoint } from "./markers.js"`. This task is the foundational type contract they build on.
- **Backward-compatible by construction**: `revert?` is optional, so persisted v1.1 markers (no revert field) keep type-checking and `REWIND_DATA` test fixtures keep compiling.
- **Zero runtime risk**: Pure type additions — no logic in `appendRewindMarker` changes; the `revert` payload rides the existing `{...data}` spread exactly like `hideEntryIds` and `excludeToolCallId` already do.

## What

A user-invisible (type-only) change to the Mulligan data-model module:
1. `RewindMarker` gains an optional `revert?: {...}` field — present only when the agent requested revert AND it ran.
2. A new exported `interface RevertCheckpoint` describing a paired before/after snapshot ref held in `SessionRuntime` and persisted for cross-reload.
3. JSDoc on both citing `spec/04-data-model.md §3` and `@14-working-tree-revert.md §2`.
4. New `expectTypeOf` tests in `test/markers.test.ts`.

### Success Criteria

- [ ] `RewindMarker` has `revert?` with exactly the 6 inner members and the `"git"|"cas"|"none"` backend union (spec/04 §3).
- [ ] `RevertCheckpoint` is exported with exactly `{ label; backend:"git"|"cas"; beforeRef; afterRef?; turnIndex; ts }` (spec/14 §2).
- [ ] `RewindMarkerInput` automatically exposes `revert?` (proven by a compiling `expectTypeOf` test) — NO edit to the `Omit<...>` or to `appendRewindMarker`.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (new + all existing markers tests green).

## All Needed Context

### Context Completeness Check
_Passes "No Prior Knowledge":_ the implementing agent needs only `src/markers.ts` (the existing `RewindMarker` interface at lines 54-83 and `RewindMarkerInput` at line 87), `test/markers.test.ts` (the `expectTypeOf` patterns + import block), and the two verbatim spec snippets quoted below. Every field name, type, and insertion anchor is specified exactly.

### Documentation & References

```yaml
# MUST READ — the verbatim definitions to copy (field names/types are normative)
- docfile: spec/04-data-model.md
  section: "## 3. Marker: rewind"   # the revert? block inside RewindMarker (after ts: number;)
  why: "Source of truth for the revert? field — copy the 6 inner members + backend union verbatim"
  critical: "revert? goes AFTER `ts: number;` (the current last field of RewindMarker), matching spec/04 §3 ordering (ledger → ts → revert). Field is OPTIONAL (revert?) so old markers type-check."

- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"   # the RevertCheckpoint one-liner (line ~62)
  why: "Source of truth for RevertCheckpoint — copy label/backend/beforeRef/afterRef?/turnIndex/ts verbatim"
  critical: "backend here is 'git' | 'cas' ONLY (NO 'none' — a checkpoint exists only when a real backend captured). afterRef is OPTIONAL (string | undefined)."

# EXACT file to edit (read these before editing)
- file: src/markers.ts
  why: "The ONLY source file modified. Lines 54-83 = RewindMarker interface; line 87 = RewindMarkerInput; line 89 = shrink divider (do not cross)."
  pattern: "Mirror the JSDoc density of the existing `hideEntryIds?` field (lines ~68-75) for the revert? field. Follow the file's `export interface` + per-member JSDoc convention."
  gotcha: "RewindMarkerInput = Omit<RewindMarker,'schema'|'v'|'kind'|'id'|'seq'|'ts'> — revert is NOT omitted, so it propagates to RewindMarkerInput AUTOMATICALLY. Do NOT touch the Omit list or appendRewindMarker."

- file: test/markers.test.ts
  why: "The test file extended. Uses vitest `expectTypeOf` for type-level assertions; type-only imports from '../src/markers.js'."
  pattern: "Mirror the EXISTING `hideEntryIds` optional-field test (in the `describe('types (GOTCHA #2 — string | null)')` block) for the new revert? test; mirror the NoteDetails type-shape test for RevertCheckpoint."
  gotcha: "ADD `type RevertCheckpoint` to the existing type-only import block (do not start a new import line). `REWIND_DATA` (RewindMarkerInput constant) intentionally omits revert — it must STILL compile (revert is optional)."

# PATTERN guide (do NOT edit — read-only reference)
- docfile: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  section: "## 2. Marker Pattern (src/markers.ts)"
  why: "Confirms the contract: 'add optional revert? field' + 'RewindMarkerInput automatically picks up revert? via Omit' + 'appendRewindMarker spreads data; revert rides the spread like checkpoint does today'."
  critical: "States 'Optional field → old markers type-check unchanged (backward-compat)' and 'Never throws' (the wrapper is untouched, so this holds automatically)."

# The PRP concept
- docfile: plan/008_c36fd26768ae/P1M2T1S1/PRP.md  # sibling (src/snapshot/paths.ts)
  why: "Confirms project toolchain: TypeScript + vitest. Gates: `npm run typecheck` (tsc --noEmit strict), `npm test` (vitest run). NO ruff/mypy/eslint (Python tools). Source imports use `.js` extensions (ESM + tsc output convention)."
```

### Current Codebase tree (relevant slice)

```
src/
  markers.ts          # ← THE file to edit (MulliganEnvelope, all marker interfaces, append* wrappers, leaveNote, setCheckpoint)
  runtime.ts          # (downstream P1.M2.T2.S2 will add snapshots?: Map<string, RevertCheckpoint>)
  snapshot/
    paths.ts          # (sibling P1.M2.T1.S1 — already created; DO NOT TOUCH)
  config.ts           # config.revert.* block already added (P1.M1.T1.S1) — DO NOT TOUCH
test/
  markers.test.ts     # ← the test file to extend
spec/
  04-data-model.md    # §3 = revert? field source of truth
  14-working-tree-revert.md  # §2 = RevertCheckpoint source of truth
plan/008_c36fd26768ae/architecture/
  codebase_patterns.md  # §2 = the marker-pattern contract (read-only)
```

### Desired Codebase tree (what changes)

```
src/markers.ts        # MODIFIED — +revert? field on RewindMarker; +exported RevertCheckpoint interface (+JSDoc each)
test/markers.test.ts  # MODIFIED — +type RevertCheckpoint import; +2 expectTypeOf tests (revert optionality + RevertCheckpoint shape)
```
No new files. No new directories. No dependency changes.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: RewindMarkerInput = Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts"> (line 87).
// `revert` is NOT in the Omit list → it PROPAGATES to RewindMarkerInput automatically. Do NOT edit the Omit.
// Do NOT edit appendRewindMarker (lines ~225-247): it builds entry via {...data, schema, v, kind, id, seq, ts};
// revert rides the {...data} spread like hideEntryIds/excludeToolCallId already do. Adding it to the interface
// is sufficient — the wrapper carries it for free.

// CRITICAL: revert? is OPTIONAL. Old persisted markers (v1.1, no revert) MUST still type-check.
// The existing REWIND_DATA fixture in test/markers.test.ts omits revert and MUST keep compiling.

// CRITICAL: backend unions differ by location:
//   RewindMarker.revert.backend   = "git" | "cas" | "none"   (spec/04 §3 — "none"/absent ⇒ revert did not run)
//   RevertCheckpoint.backend      = "git" | "cas"            (spec/14 §2 — NO "none"; a checkpoint exists only when a real backend captured)
// Do NOT unify these — copy each verbatim from its own spec section.

// GOTCHA: source imports use `.js` extension (ESM + tsc output convention). The test imports
// `type RevertCheckpoint` from "../src/markers.js" (NOT "../src/markers.ts").

// GOTCHA: markers.ts NEVER throws on the hot path (fail-open discipline). Since this task adds ONLY types,
// that invariant is automatically preserved — do not wrap anything.
```

## Implementation Blueprint

### Data models and structure

There are no runtime data models to create — this task DEFINES two pure TypeScript types. Their exact shapes:

```ts
// ── Inside RewindMarker, AFTER `ts: number;` and BEFORE the closing brace ──
// (verbatim from spec/04-data-model.md §3)
/** v1.2 working-tree revert result — present only when the agent requested revert AND `config.revert.enabled` AND
 *  the granularity is supported (last_turn/checkpoint). `backend:"none"`/absent ⇒ revert did not run. The rewind
 *  tool (rewindExecute step 6b, P4.M2.T1.S2) populates this from store.restore()'s RestoreResult and folds it into
 *  the marker via the appendRewindMarker `{...data}` spread (RewindMarkerInput carries it — see Omit at line ~87).
 *  OPTIONAL for backward compatibility: absent on old persisted markers (v1.1). Audit-recoverable from /tree.
 *  See `@14-working-tree-revert.md` §2 (SnapshotStore), §6 (restore semantics), §7 (mulligan_rewind integration). */
revert?: {
  /** Paths restored to their pre-span content. */
  revertedFiles: string[];
  /** Span-created paths deleted (delete_created_files + config.revert.allowDeleteCreatedFiles). */
  deletedFiles: string[];
  /** Paths that could not be restored/deleted (best-effort; logged — E27). */
  failedFiles: string[];
  /** Paths the dirty guard refused to overwrite (post-turn drift detected — E30) — revert skipped those. */
  refusedFiles: string[];
  /** true when caps/partial snapshot degraded the restore (E29). */
  skipped: boolean;
  /** Which backend ran: "git" | "cas" | "none" ("none"/absent ⇒ revert did not run). */
  backend: "git" | "cas" | "none";
};
```

```ts
// ── NEW exported interface, placed AFTER RewindMarkerInput, BEFORE the shrink divider ──
// (verbatim from spec/14-working-tree-revert.md §2)
/**
 * RevertCheckpoint — a paired before/after snapshot ref held in `SessionRuntime` (in-memory, keyed by capture label:
 * "turn" | "checkpoint:<name>") and persisted for cross-reload (spec/14 §2). Pairs a `beforeRef` (snapshot at turn
 * start / checkpoint set) with an `afterRef` (snapshot at turn end / next capture) so the rewind tool can
 * `dirtyCheck(afterRef, paths)` then `restore(beforeRef, opts)`. `backend` is "git" | "cas" only — a checkpoint
 * exists ONLY when a real backend captured ("none" ⇒ no checkpoint created). `afterRef` is OPTIONAL (null until the
 * turn_end / next-capture snapshot writes it). EXPORTED so runtime.ts (P1.M2.T2.S2 — `snapshots?: Map<string,
 * RevertCheckpoint>`) and store.ts (P2.M1.T1.S1 — SnapshotStore) share ONE canonical shape. See `@14-working-tree-
 * revert.md` §2 (definition), §5 (capture lifecycle), §6 (restore).
 */
export interface RevertCheckpoint {
  label: string;
  backend: "git" | "cas";
  beforeRef: string;
  afterRef?: string;
  turnIndex: number;
  ts: number;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/markers.ts — add the revert? field to RewindMarker
  - EDIT: the RewindMarker interface. The current LAST field is `ts: number;` (line 82), immediately followed by `}` (line 83).
  - INSERT: the revert? block (see "Data models and structure" above) AFTER `ts: number;` and BEFORE the closing `}`.
  - FOLLOW pattern: the existing `hideEntryIds?` field (lines ~68-75) for JSDoc density — multi-line block comment citing spec sections, OPTIONAL-for-backward-compat note, who-populates-it / who-reads-it note.
  - CRITICAL: the field is `revert?` (optional). backend union is "git" | "cas" | "none" (three values). Copy the 6 inner members verbatim from spec/04 §3: revertedFiles, deletedFiles, failedFiles, refusedFiles, skipped, backend.
  - PRESERVE: every existing field of RewindMarker (kind, id, granularity, options, excludeToolCallId, hideEntryIds, seq, note, ledger, ts) — insert ONLY, do not reorder or delete.

Task 2: MODIFY src/markers.ts — add the exported RevertCheckpoint interface
  - EDIT: insert a new section block AFTER the `RewindMarkerInput` type alias (line 87) and BEFORE the `// ── Marker: shrink` divider (line 89).
  - INSERT: the `export interface RevertCheckpoint { ... }` block (see "Data models and structure" above), preceded by a section-divider comment line consistent with the file's style, e.g.:
      // ── Revert checkpoint (v1.2 working-tree revert — spec/04 §3 revert field; @14 §2) ─────────────────
  - FOLLOW pattern: the existing per-export JSDoc style (see the ShrinkTarget / TurnMetric interface comments).
  - CRITICAL: backend union is "git" | "cas" ONLY (two values — NO "none"). afterRef is OPTIONAL (`afterRef?: string`). EXPORT the interface (`export interface`).
  - DEPENDENCIES: none within markers.ts (it is a standalone interface; it does not reference RewindMarker or vice-versa).

Task 3: VERIFY no wrapper edit is needed (a read-only check, NOT an edit)
  - CONFIRM: `appendRewindMarker` (lines ~225-247) builds `entry: RewindMarker = { ...data, schema, v, kind, id, seq, ts }`. Since `revert` is part of `RewindMarkerInput` (via Omit propagation from Task 1) and is NOT among the stamped fields, it rides `{...data}` automatically. No code change.
  - CONFIRM: `RewindMarkerInput = Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">` (line 87) does NOT omit `revert`, so Task 1 makes `revert?` appear on RewindMarkerInput for free.

Task 4: MODIFY test/markers.test.ts — extend the type-only import + add 2 expectTypeOf tests
  - EDIT (import block): add `type RevertCheckpoint,` to the existing `import { ..., } from "../src/markers.js";` block (alphabetical-ish, near the other type imports). Do NOT create a second import line.
  - ADD test A (in the `describe("types (GOTCHA #2 — string | null)", ...)` block, right after the existing `hideEntryIds` test): mirror it for revert:
        it("RewindMarker/RewindMarkerInput carry optional revert (v1.2 working-tree revert; backward-compat)", () => {
          const withoutRevert: RewindMarkerInput = REWIND_DATA;  // omits revert → compiles (old markers)
          const withRevert: RewindMarkerInput = { ...REWIND_DATA, revert: { revertedFiles: ["src/a.ts"], deletedFiles: ["tmp/x"], failedFiles: [], refusedFiles: ["dirty.ts"], skipped: false, backend: "git" } };
          expectTypeOf(withRevert.revert).toEqualTypeOf<RewindMarker["revert"] | undefined>();
          expectTypeOf(withoutRevert.revert).toEqualTypeOf<RewindMarker["revert"] | undefined>();
        });
  - ADD test B (mirror the NoteDetails type-shape test):
        it("RevertCheckpoint is { label; backend:'git'|'cas'; beforeRef; afterRef?; turnIndex; ts } (spec/14 §2)", () => {
          const c = {} as RevertCheckpoint;
          expectTypeOf(c.label).toEqualTypeOf<string>();
          expectTypeOf(c.backend).toEqualTypeOf<"git" | "cas">();
          expectTypeOf(c.beforeRef).toEqualTypeOf<string>();
          expectTypeOf(c.afterRef).toEqualTypeOf<string | undefined>();
          expectTypeOf(c.turnIndex).toEqualTypeOf<number>();
          expectTypeOf(c.ts).toEqualTypeOf<number>();
        });
  - PRESERVE: all existing tests unchanged. `REWIND_DATA` (which omits revert) must STILL compile (proof revert? is optional).
```

### Implementation Patterns & Key Details

```ts
// The revert? field placement (insert between these two existing lines — DO NOT change them):
//     ledger: FileLedger;
//     ts: number;
//   ↓↓↓ INSERT revert? block HERE ↓↓↓
//     }

// The RevertCheckpoint insertion point (between these existing lines — DO NOT change them):
//     export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;
//   ↓↓↓ INSERT section divider + export interface RevertCheckpoint HERE ↓↓↓
//     // ── Marker: shrink (spec/04-data-model.md §4) ──...

// EXPECTED no-op proof (Task 3): after editing ONLY the interface, this still type-checks unchanged:
//   const id = appendRewindMarker(pi, ctx, REWIND_DATA);   // REWIND_DATA omits revert → still valid (optional)
// and a revert-bearing payload now also compiles:
//   appendRewindMarker(pi, ctx, { ...REWIND_DATA, revert: { revertedFiles:[], deletedFiles:[], failedFiles:[], refusedFiles:[], skipped:false, backend:"none" } });
```

### Integration Points

```yaml
TYPES (the deliverable):
  - RewindMarker (src/markers.ts): +revert? field — consumed by rewind.ts step 6b (P4.M2.T1.S2, writes it) + audit/tree (reads it).
  - RevertCheckpoint (src/markers.ts): NEW exported type — imported by runtime.ts (P1.M2.T2.S2) + store.ts (P2.M1.T1.S1).
NO DATABASE: none (pure types).
NO CONFIG: config.revert.* already exists (P1.M1.T1.S1); this task does not touch it.
NO ROUTES: none.
NO package.json / tsconfig changes: none (pure type additions inside already-included files).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript is the ONLY compiler/linter here. (NO ruff/mypy/eslint — those are Python tools.)
npm run typecheck
# Expected: zero errors. This is the PRIMARY gate:
#   - proves the two new types compile
#   - proves RewindMarkerInput picks up revert? via Omit (else REWIND_DATA + the new withRevert test fail to compile)
#   - proves nothing downstream broke (the wrapper, the filter's readMarkers cast, etc.)
# If errors: READ the tsc output; fix field names/types/optionality. Most likely cause = a typo in the backend union.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the markers test file in isolation first (fast feedback on the new expectTypeOf tests):
npm test -- test/markers.test.ts
# Expected: all green, including the 2 NEW tests + every existing markers test unchanged.

# Then the full suite (proves no cross-file type regression — e.g. tools/, filter readMarkers casts):
npm test
# Expected: all green.
```

### Level 3: Integration Testing (System Validation)

This task is type-only (no runtime behavior added), so there is no service to start / endpoint to hit / DB to inspect. The integration proof is that downstream consumers compile against the new types once they're written. As a lightweight manual confirmation that the export is reachable:

```bash
# Confirm the new export is part of the module surface (grep the source):
grep -n "export interface RevertCheckpoint\|revert?:" src/markers.ts
# Expected: both lines present.

# Confirm no other file references RevertCheckpoint yet (downstream tasks add their own imports later):
grep -rn "RevertCheckpoint" src/ test/ | grep -v "src/markers.ts" | grep -v "test/markers.test.ts"
# Expected: no matches yet (runtime.ts/store.ts imports come in P1.M2.T2.S2 / P2.M1.T1.S1).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Optional) A one-shot type assertion that RevertCheckpoint is assignable from a hand-built literal, mirroring how
# runtime.ts will construct it in P1.M2.T2.S2. Add to test/markers.test.ts if you want belt-and-suspenders:
#   it("a RevertCheckpoint literal with afterRef omitted type-checks", () => {
#     const ckpt: RevertCheckpoint = { label: "turn", backend: "git", beforeRef: "ref-1", turnIndex: 2, ts: Date.now() };
#     expectTypeOf(ckpt.afterRef).toEqualTypeOf<string | undefined>();
#   });
# Not strictly required — the Task-4 tests already cover the shape. Include only if you want the construct-site proof.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes (zero errors)
- [ ] `npm test` passes (all green, including 2 new tests; every existing markers test unchanged)
- [ ] `grep -n "export interface RevertCheckpoint" src/markers.ts` returns the new interface
- [ ] `grep -n "revert?:" src/markers.ts` returns the new field inside RewindMarker

### Feature Validation
- [ ] `RewindMarker.revert?` has exactly: revertedFiles, deletedFiles, failedFiles, refusedFiles (all `string[]`), skipped (`boolean`), backend (`"git"|"cas"|"none"`) — spec/04 §3
- [ ] `RevertCheckpoint` has exactly: label (`string`), backend (`"git"|"cas"` — NO "none"), beforeRef (`string`), afterRef (`string | undefined`), turnIndex (`number`), ts (`number`) — spec/14 §2
- [ ] `RewindMarkerInput` exposes `revert?` automatically (no edit to the Omit / wrapper) — proven by the new `withRevert` test compiling
- [ ] Old markers type-check (backward-compat) — proven by `REWIND_DATA` (no revert) still compiling
- [ ] `appendRewindMarker` body is UNCHANGED

### Code Quality Validation
- [ ] JSDoc on `revert?` cites spec/04 §3 + `@14-working-tree-revert.md` (Mode A docs ride with the work)
- [ ] JSDoc on `RevertCheckpoint` cites `@14-working-tree-revert.md §2` + names its consumers (runtime.ts, store.ts)
- [ ] JSDoc density matches the existing `hideEntryIds?` field (the file's house style)
- [ ] Section-divider comment style matches the file's existing `// ── ... ──` blocks
- [ ] No new files, no dependency changes, no config changes

### Scope Guardrails (did NOT over-reach)
- [ ] Did NOT touch `appendRewindMarker` (revert rides the spread automatically)
- [ ] Did NOT touch `runtime.ts` (`snapshots?` field is P1.M2.T2.S2)
- [ ] Did NOT create/modify `src/snapshot/store.ts` (P2.M1.T1.S1) or `paths.ts` (sibling P1.M2.T1.S1)
- [ ] Did NOT modify `RewindMarkerInput`'s Omit list
- [ ] Did NOT modify any `spec/*.md` or plan files

---

## Anti-Patterns to Avoid

- ❌ Don't edit `appendRewindMarker` or the `Omit<...>` — `revert?` propagates for free; touching them is a regression risk.
- ❌ Don't unify the two `backend` unions. `revert.backend` is 3-valued (`"git"|"cas"|"none"`); `RevertCheckpoint.backend` is 2-valued (`"git"|"cas"`). Copy each from its own spec section.
- ❌ Don't make `revert` required — it MUST be optional (`revert?`) for backward-compat with v1.1 markers and for the REWIND_DATA fixture.
- ❌ Don't paraphrase field names/types. `revertedFiles`/`deletedFiles`/`failedFiles`/`refusedFiles`/`skipped`/`backend` and `label`/`beforeRef`/`afterRef`/`turnIndex`/`ts` are normative — copy verbatim.
- ❌ Don't add a runtime check, validator, or wrapper — this is a type-only task; the fail-open discipline of markers.ts is preserved automatically.
- ❌ Don't use `import type` on a value, or drop the `.js` extension on source imports — house convention is `import { type X } from "../src/markers.js"`.
- ❌ Don't run `ruff`/`mypy`/`eslint`/`uv` — this is a TypeScript project; those Python tool calls are no-ops here.

---

## Confidence Score: 9/10

**Why 9, not 10:** The task is a small, well-specified, pure-type addition with exact spec sources, exact insertion anchors (lines 82/83/87/89), a verified propagation mechanism (Omit), and a directly-mirrorable test pattern (the existing `hideEntryIds` test). The only residual risk is a typo in a field name/union; the `typecheck` gate catches that immediately. No external research is needed — everything is in-repo.

**Parallel-execution note:** This PRP runs alongside P1.M2.T1.S1 (`src/snapshot/paths.ts`). The two touch DISJOINT files (markers.ts vs snapshot/paths.ts) with no shared edits, so there is no merge conflict and no ordering dependency between them. The downstream consumer of THIS task's `RevertCheckpoint` type is P1.M2.T2.S2 (runtime.ts `snapshots?` field), which runs after both.