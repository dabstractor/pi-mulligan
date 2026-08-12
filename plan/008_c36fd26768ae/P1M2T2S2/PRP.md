---
name: "P1.M2.T2.S2 — Add SessionRuntime.snapshots field to runtime.ts"
description: "Add `snapshots?: Map<string, RevertCheckpoint>` to the `SessionRuntime` interface + initialize it in `freshRuntime()`, plus a type-only `import { type RevertCheckpoint } from \"./markers.js\"`. Pure additive change to runtime.ts (the v1.2 working-tree-revert capture store keyed by label). No change to resetRuntime/clearAll (delete/clear drop the whole runtime object). Update the existing exact-shape runtime test + add a type test + a behavioral isolation test. [Mode A] JSDoc on the field citing @14 §2 and spec/04 §8."
---

## Goal

**Feature Goal**: Wire the in-memory home for active `RevertCheckpoint`s into Mulligan's per-session runtime: add an OPTIONAL `snapshots?: Map<string, RevertCheckpoint>` field to `SessionRuntime`, initialize a fresh empty `Map` in `freshRuntime()`, and pull in the `RevertCheckpoint` type via a type-only import from `markers.js`. This is the storage half of the v1.2 capture lifecycle — the turn_start/agent_end hooks (P3.M1.T1) will `set()` checkpoints here keyed by capture label (`"turn"` | `"checkpoint:<name>"`), and `rewindExecute` (P4.M2.T1) will `get()`/resolve them.

**Deliverable**: A focused, purely-additive edit to `src/runtime.ts` (one `import type`, one interface field + JSDoc, one `freshRuntime()` initializer line, and a one-clause refinement of the header DESIGN note so it stays truthful) plus `test/runtime.test.ts` edits (update the exact-shape `toEqual` assertion to include `snapshots`, add a type test, add a per-session isolation test). No new files, no dependency changes, no runtime logic changes.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict) passes — proves the import resolves and the field type-checks against `RevertCheckpoint` from markers.ts (the P1.M2.T2.S1 contract).
- `npm test` (`vitest run`) passes — the updated exact-shape test + 2 new tests are green, and EVERY existing runtime test stays green.
- `SessionRuntime.snapshots` is importable/usable as `Map<string, RevertCheckpoint> | undefined`; a fresh runtime always yields a live empty `Map` (never `undefined`).
- `resetRuntime(sessionId)` and `clearAll()` need NO code change — confirmed by a test proving a reset wipes checkpoints and the next `getRuntime` returns a fresh empty Map.
- [Mode A] docs ride with the work: the field's JSDoc cites `@14-working-tree-revert.md §2` and `spec/04-data-model.md §8`; the header DESIGN note is kept truthful about the new (erased) type-only import.

## User Persona

**Target User**: Downstream implementation tasks that store/read revert checkpoints at runtime — P3.M1.T1 (turn_start/agent_end capture hooks), P3.M2.T1 (`/mulligan_checkpoint` step 4b), P4.M2.T1 (rewindExecute checkpoint resolution + step 6b).

**Use Case**: A capture hook does `getRuntime(sessionId).snapshots?.set("turn", ckpt)` at turn_start; rewindExecute does `getRuntime(sessionId).snapshots?.get(granularity === "checkpoint" ? "checkpoint:"+name : "turn")` to resolve the before/after refs before calling `store.restore()`.

**Pain Points Addressed**: There is currently NO in-memory home for active `RevertCheckpoint`s. The v1.2 capture lifecycle (P3) has nowhere to park the before/after snapshot refs between the turn_start capture and the rewind's dirtyCheck/restore. This task provides that home on the existing per-session mutable state object (the established pattern — every other per-session field already lives on `SessionRuntime`).

## Why

- **Unblocks the v1.2 capture chain**: P3.M1.T1 (capture hooks) and P4.M2.T1 (rewind resolution) both need `getRuntime(sessionId).snapshots`. This task is the storage contract they build on.
- **Follows the established runtime pattern**: every per-session mutable field already lives on `SessionRuntime` (seq, tokenBaseline, lastFiltered, shrinkMissCounts, aboveHighWater, …). `snapshots` is the same shape of addition — codebase_patterns.md §3 confirms the exact field + initializer. The store-threading decision (codebase_patterns.md §8) may ALSO add a `store?` field later, but that is a SEPARATE task — this PRP adds ONLY `snapshots`.
- **Zero runtime risk**: a type-only import (erased by tsc) + an optional field + an empty-Map initializer. No control flow changes; the fail-open, Pi-free, unit-testable-in-isolation discipline of runtime.ts is preserved.
- **Backward-compatible**: `snapshots?` is optional, so any hand-built `{} as SessionRuntime` keeps type-checking; persisted shapes are untouched (this is non-persisted in-memory state).

## What

A developer-invisible (data-plumbing) change to the Mulligan runtime module:
1. `src/runtime.ts` gains `import type { RevertCheckpoint } from "./markers.js";` (the FIRST import in a currently import-free file).
2. `SessionRuntime` gains an optional `snapshots?: Map<string, RevertCheckpoint>` field — placed as the LAST field of the interface, with a multi-line JSDoc citing `@14-working-tree-revert.md §2` and `spec/04-data-model.md §8`.
3. `freshRuntime(sessionId)` initializes `snapshots: new Map<string, RevertCheckpoint>()` as the last property of its returned object literal — each fresh runtime gets its OWN Map (never a module-level shared Map — mirrors the existing `shrinkMissCounts`/`pendingBloatHits` GOTCHA #5).
4. `resetRuntime` and `clearAll` are UNCHANGED — `delete`/`clear` already drop the whole runtime object (Map included).
5. The header DESIGN note is refined by one clause so its "Imports NOTHING" claim stays truthful (clarify it means no RUNTIME imports; the lone type-only import is erased by tsc).
6. `test/runtime.test.ts`: update the exact-shape `toEqual` assertion to include `snapshots: new Map()`, add a `expectTypeOf` type test, and add a behavioral test proving per-session isolation + reset clears checkpoints.

### Success Criteria

- [ ] `SessionRuntime` has `snapshots?: Map<string, RevertCheckpoint>` as a field (spec/04 §8, @14 §2).
- [ ] `freshRuntime` returns an object whose `snapshots` is a `new Map()` (non-undefined, empty).
- [ ] `runtime.ts` has `import type { RevertCheckpoint } from "./markers.js";` (type-only, `.js` extension).
- [ ] `resetRuntime`/`clearAll` bodies are UNCHANGED (read-only confirmation — they already drop the whole object).
- [ ] The header DESIGN note no longer makes the false "Imports NOTHING" claim (clarified: no *runtime* imports).
- [ ] The exact-shape `toEqual` test in `test/runtime.test.ts` is updated to include `snapshots: new Map()`.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes (updated + 2 new runtime tests green; all other suites green).

## All Needed Context

### Context Completeness Check
_Passes "No Prior Knowledge":_ the implementing agent needs only `src/runtime.ts` (the interface, `freshRuntime`, `resetRuntime`, `clearAll`), `test/runtime.test.ts` (the exact-shape test + `expectTypeOf`/`beforeEach` patterns), the `RevertCheckpoint` shape produced verbatim by the parallel sibling (quoted below), and the two verbatim spec snippets. Every insertion anchor, import line, and field name is specified exactly. No external research is needed — everything is in-repo.

### Documentation & References

```yaml
# MUST READ — the verbatim definitions (field names/types are normative; copy exactly)
- docfile: spec/04-data-model.md
  section: "## 8. In-memory (non-persisted) state"   # the SessionRuntime partial summary with snapshots?
  why: "Source of truth for the snapshots? field + its JSDoc comment intent (v1.2 working-tree revert: active RevertCheckpoints keyed by capture label)."
  critical: "spec/04 §8 is a PARTIAL summary (it explicitly says so) — the live runtime has MORE fields than shown. Copy ONLY the snapshots? line + its intent; do NOT delete or reorder the existing fields. snapshots? is OPTIONAL."

- docfile: spec/14-working-tree-revert.md
  section: "## 2. Architecture — the SnapshotStore"   # the RevertCheckpoint one-liner + 'Detection cached per session in SessionRuntime'
  why: "Source of truth for what snapshots HOLDS (RevertCheckpoint) and WHY it is on SessionRuntime (per-session, keyed by capture label)."
  critical: "RevertCheckpoint.backend is 'git' | 'cas' ONLY (NO 'none' — a checkpoint exists only when a real backend captured). This task STORES RevertCheckpoints; it does not CREATE them — but the field type must match the sibling's export exactly."

# EXACT file to edit (read in full before editing)
- file: src/runtime.ts
  why: "The ONLY source file modified. SessionRuntime interface (10 current fields); freshRuntime() (the default-returning factory); resetRuntime/clearAll (delete/clear — NO edit)."
  pattern: "Mirror the JSDoc density of the existing `shrinkMissCounts` field (per-member JSDoc citing spec sections + who-writes/who-reads + GOTCHA #5 isolation note) for the new snapshots? field. freshRuntime init mirrors `shrinkMissCounts: new Map()` exactly."
  gotcha: "The file header DESIGN note currently says 'Imports NOTHING — not Pi, not config, not log.' That is about RUNTIME/value imports. `import type` is erased by tsc → zero runtime coupling → the invariant holds, but the NOTE must be refined by one clause so it is not false on its face. Do NOT add a runtime import."

- file: test/runtime.test.ts
  why: "The test file edited. vitest. beforeEach/afterEach call clearAll(). CONTAINS an exact-shape test that will BREAK when snapshots is added to freshRuntime."
  pattern: "Update the `toEqual` expected literal in 'getRuntime creates a runtime with the exact default shape' (add `snapshots: new Map(),`). Add a type test mirroring the file's existing expectTypeOf style. Add a behavioral test mirroring the per-session-isolation tests."
  gotcha: "vitest `toEqual` requires BOTH objects to have the same key set — once freshRuntime returns snapshots, the existing expected literal (which omits it) FAILS. Run `npm test -- test/runtime.test.ts` to surface ANY other exact-shape/runtime-literal assertion that also needs snapshots added."

# CONTRACT from the parallel sibling (assume it lands EXACTLY as specified)
- docfile: plan/008_c36fd26768ae/P1M2T2S1/PRP.md
  section: "## Implementation Blueprint > Data models and structure"   # the export interface RevertCheckpoint block
  why: "Defines the EXACT shape of RevertCheckpoint that this task imports. Treat as a contract."
  critical: "`export interface RevertCheckpoint { label: string; backend: 'git'|'cas'; beforeRef: string; afterRef?: string; turnIndex: number; ts: number; }` — exported from src/markers.ts, importable as `import { type RevertCheckpoint } from './markers.js'`. This task adds NO field to it; it only consumes the type."

# PATTERN guide (read-only — do NOT edit)
- docfile: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  section: "## 3. Runtime Pattern (src/runtime.ts)"
  why: "Confirms the contract verbatim: 'SessionRuntime → add snapshots?: Map<string, RevertCheckpoint>'; 'freshRuntime(sessionId) → initialize snapshots: new Map()'; 'resetRuntime deletes the entry → snapshots map cleared automatically'; 'clearAll wipes everything'."
  critical: "States explicitly that resetRuntime/clearAll need NO change (delete wipes the whole object). This task touches ONLY src/runtime.ts + test/runtime.test.ts — NOT markers.ts (sibling), NOT snapshot/paths.ts (complete), NOT config.ts (complete)."
```

### Current Codebase tree (relevant slice)

```
src/
  runtime.ts          # ← THE file to edit (interface + freshRuntime + header DESIGN note)
  markers.ts          # (parallel sibling P1.M2.T2.S1 ADDS export interface RevertCheckpoint — DO NOT TOUCH)
  snapshot/
    paths.ts          # (sibling P1.M2.T1.S1 — complete; DO NOT TOUCH)
  config.ts           # config.revert.* (P1.M1.T1.S1 — complete; DO NOT TOUCH)
test/
  runtime.test.ts     # ← the test file to edit (exact-shape assertion + new tests)
spec/
  04-data-model.md    # §8 = SessionRuntime partial summary (snapshots? source of truth)
  14-working-tree-revert.md  # §2 = RevertCheckpoint + 'cached per session in SessionRuntime'
plan/008_c36fd26768ae/architecture/
  codebase_patterns.md  # §3 = the runtime-pattern contract (read-only)
plan/008_c36fd26768ae/P1M2T2S1/PRP.md  # the RevertCheckpoint type contract (read-only)
```

### Desired Codebase tree (what changes)

```
src/runtime.ts        # MODIFIED — +import type RevertCheckpoint; +snapshots? field (+JSDoc); +freshRuntime init; +header note clause
test/runtime.test.ts  # MODIFIED — exact-shape toEqual gains snapshots; +type RevertCheckpoint import; +1 type test; +1 isolation test
```
No new files. No new directories. No dependency changes.

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA #1 (CRITICAL) — `import type` is ERASED by tsc; the "Imports NOTHING" header is about RUNTIME imports.
// runtime.ts's header DESIGN note says "Imports NOTHING — not Pi, not config, not log. This keeps it a pure, fast,
// isolated unit-test target." That refers to RUNTIME/value imports (which would couple runtime.ts to Pi/config at
// runtime and require those modules to load during unit tests). `import type { RevertCheckpoint } from "./markers.js"`
// is a TYPE-ONLY import: tsc strips it entirely → zero runtime module loading, zero coupling. markers.ts's
// RevertCheckpoint is a pure self-contained interface (its shape references only primitives). So runtime.ts REMAINS
// Pi-free and unit-testable in isolation. ACTION: add the type import AND refine the header DESIGN note by ONE
// clause (e.g. "Imports no RUNTIME modules; the sole type-only import is erased by tsc") so the comment is truthful.

// GOTCHA #2 (CRITICAL) — adding snapshots to freshRuntime BREAKS the existing exact-shape toEqual test.
// test/runtime.test.ts has:
//   it("getRuntime creates a runtime with the exact default shape on first access", () => {
//     expect(rt).toEqual({ sessionId, seq:0, ..., rewindRefusedTurnIndex: null });   // ← no snapshots key
//   });
// vitest toEqual requires BOTH objects to have the SAME key set. Once freshRuntime returns snapshots:new Map(),
// that expected literal is missing snapshots → the test FAILS ("expected property 'snapshots' to be undefined").
// ACTION: add `snapshots: new Map(),` to that expected literal. Then RUN `npm test -- test/runtime.test.ts` and
// fix ANY other exact-shape / runtime-object-literal assertion in the file the same way.

// GOTCHA #3 — snapshots? is OPTIONAL in the interface but ALWAYS initialized in freshRuntime.
// Declare `snapshots?: Map<string, RevertCheckpoint>` (optional) so `{} as SessionRuntime` type-checks (matches
// spec/04 §8's snapshots? and the existing optional-tolerant style). BUT freshRuntime ALWAYS sets
// `snapshots: new Map()` so downstream hooks get a live Map. The type test asserts the INTERFACE type
// `Map<string, RevertCheckpoint> | undefined`; the behavioral test asserts freshRuntime yields a non-undefined Map.

// GOTCHA #4 — each fresh runtime MUST get its OWN Map (never a module-level shared Map).
// Mirrors the file's existing GOTCHA #5 on shrinkMissCounts/pendingBloatHits ("never a module-level shared
// Map/array, which would leak state across sessions"). So `snapshots: new Map()` is constructed INSIDE
// freshRuntime's return literal — NOT hoisted to module scope. resetRuntime/clearAll need NO change: deleting the
// map entry drops the whole runtime object (Map included) — there is no module-level Map to clear.

// GOTCHA #5 — source imports use `.js`; resetRuntime/clearAll are UNCHANGED.
// ESM + tsc output convention: `import type { RevertCheckpoint } from "./markers.js"` (NOT ".ts"). resetRuntime does
// `runtimes.delete(sessionId)` and clearAll does `runtimes.clear()` — both already drop snapshots automatically.
// DO NOT add a `delete rt.snapshots` or `rt.snapshots?.clear()` line — that would be dead code (the object is gone).

// GOTCHA #6 — backend union is "git" | "cas" ONLY (this task only STORES, never constructs, checkpoints).
// RevertCheckpoint.backend is "git" | "cas" (NO "none"). This task does not build RevertCheckpoint literals in src,
// but if a test constructs one, use one of those two values. (Contrast: RewindMarker.revert.backend is 3-valued —
// that is a DIFFERENT type, owned by the sibling task, not relevant here.)
```

## Implementation Blueprint

### Data models and structure

There are no new data models to CREATE — this task CONSUMES the `RevertCheckpoint` type (contract from the parallel sibling) and adds one field + initializer. The exact shapes:

```ts
// ── The type this task imports (produced verbatim by P1.M2.T2.S1 in src/markers.ts; DO NOT recreate here) ──
// export interface RevertCheckpoint {
//   label: string;
//   backend: "git" | "cas";
//   beforeRef: string;
//   afterRef?: string;
//   turnIndex: number;
//   ts: number;
// }
```

```ts
// ── NEW field on SessionRuntime, placed AFTER `rewindRefusedTurnIndex: number | null;` (the current last field) ──
// (intent verbatim from spec/04-data-model.md §8 snapshots? + spec/14-working-tree-revert.md §2)
/**
 * Active RevertCheckpoints for the v1.2 working-tree-revert feature, keyed by capture label
 * (`"turn"` | `"checkpoint:<name>"`). In-memory and non-persisted (spec/04 §8). Each RevertCheckpoint (spec/14 §2)
 * pairs a `beforeRef` (snapshot at turn_start / checkpoint-set) with an `afterRef` (snapshot at turn_end / next
 * capture) so `rewindExecute` can `store.dirtyCheck(afterRef, paths)` then `store.restore(beforeRef, opts)`.
 *
 * WHO WRITES: the turn_start/agent_end capture hooks (P3.M1.T1) and the `/mulligan_checkpoint` step 4b command
 * (P3.M2.T1) — only when `config.revert.enabled`. WHO READS: `rewindExecute` (P4.M2.T1 step 6b) resolves the
 * before/after refs before calling store.restore().
 *
 * OPTIONAL in the interface (`snapshots?`) so a hand-built `{ } as SessionRuntime` type-checks, but freshRuntime
 * ALWAYS initializes it to a fresh empty `Map` — downstream hooks rely on a live Map (read via `rt.snapshots?.…`).
 * Per-session isolated: each fresh runtime gets its OWN `new Map()` (GOTCHA #5 — never a module-level shared Map,
 * which would leak checkpoints across sessions). Auto-reset: resetRuntime deletes the whole runtime entry
 * (session_start) and clearAll wipes all entries (shutdown) — the Map is dropped with the object, no explicit clear.
 * See `@14-working-tree-revert.md` §2 (definition + per-session caching), §5 (capture lifecycle), §6 (restore).
 */
snapshots?: Map<string, RevertCheckpoint>;
```

```ts
// ── freshRuntime initializer: add as the LAST property of the returned object literal ──
// (mirrors the existing `shrinkMissCounts: new Map(),` line exactly — same Map-per-instance discipline)
//     return {
//       sessionId,
//       seq: 0,
//       tokenBaseline: null,
//       lastTurnIndex: null,
//       lastFiltered: null,
//       lastFilterTs: null,
//       pendingBloatHits: [],
//       shrinkMissCounts: new Map(),
//       aboveHighWater: false,
//       rewindRefusedTurnIndex: null,
//       snapshots: new Map<string, RevertCheckpoint>(),   // ← ADD THIS LINE (last)
//     };
```

```ts
// ── The import line (place AFTER the file-level header JSDoc, BEFORE the `AgentMessage` section) ──
// (type-only — erased by tsc; mirrors markers.ts/filter.ts where imports follow the header JSDoc)
import type { RevertCheckpoint } from "./markers.js";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/runtime.ts — add the type-only import
  - EDIT: insert `import type { RevertCheckpoint } from "./markers.js";` as the FIRST statement of the file,
    placed AFTER the file-level header JSDoc block (the `/** Per-session runtime state map … */` comment that
    currently ends just before the `/** AgentMessage … */` block) and BEFORE the `AgentMessage` section.
  - FOLLOW pattern: markers.ts places imports immediately after its header JSDoc (lines ~23-27). Match that.
  - CRITICAL: it is `import type` (NOT `import`) — type-only, erased by tsc, zero runtime coupling (GOTCHA #1).
    Use the `.js` extension (NOT `.ts`) — ESM + tsc output convention (GOTCHA #5).
  - PRESERVE: the entire header JSDoc (it is edited in Task 5, not here).

Task 2: MODIFY src/runtime.ts — add the snapshots? field to SessionRuntime
  - EDIT: the SessionRuntime interface. The current LAST field is `rewindRefusedTurnIndex: number | null;`
    (with its JSDoc). INSERT the `snapshots?` field + its JSDoc (see "Data models and structure") AFTER that
    field's JSDoc and BEFORE the interface's closing `}`.
  - FOLLOW pattern: the existing `shrinkMissCounts` field (its multi-line JSDoc citing spec sections +
    who-writes/who-reads + the GOTCHA #5 isolation note) — match that density and structure.
  - CRITICAL: the field is `snapshots?` (OPTIONAL — matches spec/04 §8). The type is `Map<string, RevertCheckpoint>`
    (the exact generic — RevertCheckpoint resolves via the Task-1 import). JSDoc MUST cite `@14-working-tree-revert.md §2`
    and `spec/04-data-model.md §8` (Mode A docs ride with the work).
  - PRESERVE: every existing field of SessionRuntime (sessionId, seq, tokenBaseline, lastTurnIndex, lastFiltered,
    lastFilterTs, pendingBloatHits, shrinkMissCounts, aboveHighWater, rewindRefusedTurnIndex) — insert ONLY.

Task 3: MODIFY src/runtime.ts — initialize snapshots in freshRuntime
  - EDIT: the `freshRuntime(sessionId)` function's returned object literal. Add
    `snapshots: new Map<string, RevertCheckpoint>(),` as the LAST property (after `rewindRefusedTurnIndex: null,`).
  - FOLLOW pattern: the existing `shrinkMissCounts: new Map(),` line — same per-instance Map construction.
  - CRITICAL: construct the Map INSIDE the returned literal (NOT a module-level shared Map — GOTCHA #4). The
    generic args are `<string, RevertCheckpoint>` (explicit, matching the interface field type).
  - PRESERVE: all other freshRuntime properties and their order.

Task 4: VERIFY resetRuntime/clearAll need NO change (a read-only check, NOT an edit)
  - CONFIRM: `resetRuntime(sessionId)` body is `runtimes.delete(sessionId);` — deleting the map entry drops the
    whole SessionRuntime object (its snapshots Map included). No edit. (GOTCHA #5.)
  - CONFIRM: `clearAll()` body is `runtimes.clear();` — wipes all entries. No edit.
  - DO NOT add `rt.snapshots?.clear()` or `delete rt.snapshots` anywhere — that is dead code (the object is gone).

Task 5: MODIFY src/runtime.ts — refine the header DESIGN note (keep it truthful)
  - EDIT: the file-level header JSDoc. It currently contains the bullet:
      "- Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log. This keeps it a pure, fast,
       isolated unit-test target and honors the work-item contract …"
    Refine by ONE clause so the now-present type-only import is not a contradiction, e.g.:
      "- Foundation-tier and Pi-FREE. Imports no RUNTIME modules — not Pi, not config, not log (a single type-only
       import, `import type { RevertCheckpoint }`, is erased by tsc and adds no runtime coupling). This keeps it a
       pure, fast, isolated unit-test target …"
  - CRITICAL: minimal edit — clarify the invariant, do NOT rewrite the whole header. This is part of Mode A
    (docs ride with the work): leaving a false "Imports NOTHING" statement next to an import line is a doc defect.

Task 6: MODIFY test/runtime.test.ts — extend the type-only import
  - EDIT (import block): add `type RevertCheckpoint,` to the existing `import { type SessionRuntime, type BloatHit,
    type AgentMessage, } from "../src/markers.js";`? NO — RevertCheckpoint lives in MARKERS, not runtime. Add a
    NEW type-only import line: `import { type RevertCheckpoint } from "../src/markers.js";` (place it right after
    the existing `from "../src/runtime.js";` import block). Use the `.js` extension + `../src/` prefix (house style).
  - GOTCHA: RevertCheckpoint is exported from markers.ts (the sibling's contract), NOT runtime.ts — do not add it
    to the runtime.js import.

Task 7: MODIFY test/runtime.test.ts — update the exact-shape toEqual assertion (REQUIRED)
  - EDIT: the test `it("getRuntime creates a runtime with the exact default shape on first access", ...)`. Its
    `expect(rt).toEqual({ ... })` literal currently ends with `rewindRefusedTurnIndex: null,`. Add
    `snapshots: new Map(),` as the LAST property of that expected literal.
  - CRITICAL (GOTCHA #2): without this edit the test FAILS (toEqual requires matching key sets). `new Map()` in the
    expected literal matches `new Map()` in freshRuntime (vitest toEqual does Map deep-equality — empty ≡ empty).
  - THEN run `npm test -- test/runtime.test.ts` and fix ANY other exact-shape/runtime-literal assertion that breaks
    the same way (grep the file for `toEqual` over a getRuntime result).

Task 8: ADD test/runtime.test.ts — a type test for snapshots
  - ADD (mirror the file's existing expectTypeOf type-test style):
      it("SessionRuntime.snapshots is Map<string, RevertCheckpoint> | undefined (spec/14 §2, spec/04 §8)", () => {
        const rt = {} as SessionRuntime;
        expectTypeOf(rt.snapshots).toEqualTypeOf<Map<string, RevertCheckpoint> | undefined>();
      });
  - PLACEMENT: in (or adjacent to) the existing type/describe block that asserts SessionRuntime field types.
  - WHY optional: the INTERFACE marks snapshots? optional; freshRuntime always sets it. This test pins the interface
    type (so downstream code that does `rt.snapshots?.get(...)` type-checks).

Task 9: ADD test/runtime.test.ts — a behavioral isolation test
  - ADD (mirror the file's existing per-session-isolation tests):
      it("fresh runtime gets its OWN empty snapshots Map; reset clears it (GOTCHA #5; spec/14 §2)", () => {
        const a = getRuntime("s1");
        expect(a.snapshots).toBeInstanceOf(Map);
        expect(a.snapshots!.size).toBe(0);
        a.snapshots!.set("turn", { label: "turn", backend: "git", beforeRef: "r1", turnIndex: 0, ts: 1 });
        expect(a.snapshots!.size).toBe(1);
        // different session → its own Map (no leak)
        const b = getRuntime("s2");
        expect(b.snapshots!.size).toBe(0);
        expect(b.snapshots).not.toBe(a.snapshots);
        // reset wipes the session's runtime; next getRuntime is fresh
        resetRuntime("s1");
        expect(getRuntime("s1").snapshots!.size).toBe(0);
      });
  - CRITICAL: the RevertCheckpoint literal uses `backend: "git"` (a valid 2-valued union member — GOTCHA #6).
    `afterRef` is intentionally omitted (it is optional). This test PROVES resetRuntime needs no explicit clear.
```

### Implementation Patterns & Key Details

```ts
// The import placement (insert between the header JSDoc end and the AgentMessage JSDoc — DO NOT change either):
//     /**
//      * Per-session runtime state map …  (existing header JSDoc — ends here)
//      */
//   ↓↓↓ INSERT import type { RevertCheckpoint } from "./markers.js"; HERE ↓↓↓
//     /**
//      * AgentMessage — LOCAL opaque alias …  (existing — unchanged)
//      */

// The interface field placement (insert AFTER the rewindRefusedTurnIndex JSDoc, BEFORE the interface closing brace):
//       … latched by the rewind tool's refuse() wrapper …  (existing rewindRefusedTurnIndex JSDoc)
//       rewindRefusedTurnIndex: number | null;
//   ↓↓↓ INSERT snapshots? field + JSDoc HERE ↓↓↓
//     }

// The freshRuntime init placement (insert as the LAST property — DO NOT change existing properties/order):
//       aboveHighWater: false,
//       rewindRefusedTurnIndex: null,
//   ↓↓↓ INSERT snapshots: new Map<string, RevertCheckpoint>(), HERE ↓↓↓
//     };

// EXPECTED no-op proof (Task 4): after the edits, resetRuntime is STILL just `runtimes.delete(sessionId);`
// and a checkpoint set before reset is gone after reset — proven by Task 9's behavioral test.
```

### Integration Points

```yaml
TYPES (the deliverable):
  - SessionRuntime.snapshots (src/runtime.ts): +optional Map<string, RevertCheckpoint> — WRITTEN by P3.M1.T1
    (turn_start/agent_end hooks) + P3.M2.T1 (/mulligan_checkpoint step 4b); READ by P4.M2.T1 (rewindExecute 6b).
NO DATABASE: none (in-memory, non-persisted — spec/04 §8).
NO CONFIG: config.revert.* already exists (P1.M1.T1.S1); this task does not gate on it (the hooks will).
NO ROUTES: none.
NO package.json / tsconfig changes: none (a type-only import + a field inside an already-included file).
NO markers.ts change: RevertCheckpoint is produced by the parallel sibling (P1.M2.T2.S1) — assume it lands exactly.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# TypeScript is the ONLY compiler/linter here. (NO ruff/mypy/eslint/uv — those are Python tools; this is TS.)
npm run typecheck
# Expected: zero errors. This is the PRIMARY gate:
#   - proves the type-only import resolves RevertCheckpoint from markers.ts (the sibling contract)
#   - proves the snapshots? field type-checks (Map<string, RevertCheckpoint>)
#   - proves freshRuntime's new Map<string, RevertCheckpoint>() is assignable to the optional field
#   - proves nothing downstream broke (filter.ts/nudges.ts import SessionRuntime by type — unaffected)
# If errors: READ the tsc output. Most likely cause = a typo in the generic args or a wrong import path/extension.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the runtime test file in isolation first (fast feedback on the updated exact-shape + new tests):
npm test -- test/runtime.test.ts
# Expected: all green, INCLUDING the updated exact-shape test (now with snapshots) + the 2 NEW tests.
# If the exact-shape test FAILS with "expected property 'snapshots'…" → you missed Task 7; apply the edit.

# Then the full suite (proves no cross-file regression — filter.ts/nudges.ts/tools read SessionRuntime fields):
npm test
# Expected: all green.
```

### Level 3: Integration Testing (System Validation)

This task is data-plumbing (an optional field + empty-Map initializer; no runtime behavior beyond storage). There
is no service to start / endpoint to hit / DB to inspect. The integration proof is that downstream consumers will
type-check against the new field once written. As a lightweight manual confirmation that the field is present and
the reset invariant holds:

```bash
# Confirm the field + import are present in source:
grep -n "snapshots?: Map<string, RevertCheckpoint>" src/runtime.ts       # → the interface field
grep -n "snapshots: new Map<string, RevertCheckpoint>()" src/runtime.ts  # → the freshRuntime init
grep -n 'import type { RevertCheckpoint } from "./markers.js"' src/runtime.ts  # → the type-only import
# Expected: all three lines present.

# Confirm resetRuntime/clearAll are UNCHANGED (still delete/clear — no snapshots-specific code added):
grep -n "snapshots" src/runtime.ts
# Expected: exactly 3 matches (the import is NOT a 'snapshots' match; the field, its JSDoc mentions, and the init).
# There must be NO `rt.snapshots?.clear()`, `delete rt.snapshots`, or snapshots mention inside resetRuntime/clearAll.

# Confirm no OTHER source file references snapshots yet (downstream hooks add their own usage in P3):
grep -rn "\.snapshots" src/ test/ | grep -v "src/runtime.ts" | grep -v "test/runtime.test.ts"
# Expected: no matches yet (P3.M1.T1 / P4.M2.T1 add their reads/writes later).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (Optional) A construct-site sanity check that a RevertCheckpoint literal is storable — already covered by Task 9's
# behavioral test (it builds `{ label:"turn", backend:"git", beforeRef:"r1", turnIndex:0, ts:1 }` and stores it).
# No additional command needed; `npm test -- test/runtime.test.ts` is sufficient.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes (zero errors)
- [ ] `npm test` passes (all green: updated exact-shape test + 2 new runtime tests; every other suite green)
- [ ] `grep -n "snapshots?: Map<string, RevertCheckpoint>" src/runtime.ts` returns the new interface field
- [ ] `grep -n "snapshots: new Map<string, RevertCheckpoint>()" src/runtime.ts` returns the freshRuntime init
- [ ] `grep -n 'import type { RevertCheckpoint } from "./markers.js"' src/runtime.ts` returns the import

### Feature Validation
- [ ] `SessionRuntime.snapshots` is `Map<string, RevertCheckpoint> | undefined` (optional interface field — spec/04 §8, @14 §2)
- [ ] `freshRuntime` always returns a live, empty `snapshots` Map (proven by Task 9)
- [ ] `resetRuntime`/`clearAll` are UNCHANGED and still wipe checkpoints (proven by Task 9 — reset clears)
- [ ] Two different sessions get DISTINCT snapshots Maps (no cross-session leak — proven by Task 9)
- [ ] The field's JSDoc cites `@14-working-tree-revert.md §2` and `spec/04-data-model.md §8` (Mode A)

### Code Quality Validation
- [ ] JSDoc density matches the existing `shrinkMissCounts` field (the file's house style)
- [ ] The header DESIGN note is no longer false about imports (Task 5 refinement applied)
- [ ] `import type` (not `import`) + `.js` extension (house ESM convention)
- [ ] The Map is constructed per-instance inside freshRuntime (NOT module-level — GOTCHA #4)
- [ ] No new files, no dependency changes, no config changes

### Scope Guardrails (did NOT over-reach)
- [ ] Did NOT touch `src/markers.ts` (RevertCheckpoint is the parallel sibling P1.M2.T2.S1's deliverable)
- [ ] Did NOT touch `src/snapshot/paths.ts` (sibling P1.M2.T1.S1 — complete)
- [ ] Did NOT touch `src/config.ts` (P1.M1.T1.S1 — complete)
- [ ] Did NOT add a `store?: SnapshotStore` field (that is a SEPARATE future task per codebase_patterns.md §8 — this PRP adds ONLY snapshots)
- [ ] Did NOT add capture/restore logic (P3.M1.T1 / P4.M2.T1) — this task only provides the storage field
- [ ] Did NOT modify any `spec/*.md` or plan files

---

## Anti-Patterns to Avoid

- ❌ Don't use `import` (value import) where `import type` is required — a value import would couple runtime.ts to markers.ts at RUNTIME and break the Pi-free/unit-testable-in-isolation invariant (GOTCHA #1).
- ❌ Don't skip updating the exact-shape `toEqual` test (Task 7) — it WILL fail (GOTCHA #2). Run `npm test -- test/runtime.test.ts` and fix every shape assertion it surfaces.
- ❌ Don't hoist the Map to module scope, and don't share one Map across sessions — each fresh runtime gets its OWN `new Map()` (GOTCHA #4, mirroring shrinkMissCounts).
- ❌ Don't add `rt.snapshots?.clear()` / `delete rt.snapshots` to resetRuntime or clearAll — the object is already dropped by `delete`/`clear`; extra clears are dead code (GOTCHA #5).
- ❌ Don't make `snapshots` required in the interface — it MUST be optional (`snapshots?`) so `{ } as SessionRuntime` and old-style constructions type-check (spec/04 §8).
- ❌ Don't import RevertCheckpoint from runtime.js in the test — it is exported from **markers.js** (the sibling's contract). The test gets SessionRuntime from `../src/runtime.js` and RevertCheckpoint from `../src/markers.js`.
- ❌ Don't drop the `.js` extension on source/test imports, and don't use `.ts` — ESM + tsc output convention.
- ❌ Don't leave the header "Imports NOTHING" claim false after adding the import — refine it (Task 5); docs ride with the work (Mode A).
- ❌ Don't run `ruff`/`mypy`/`eslint`/`uv` — this is a TypeScript project; those Python tool calls are no-ops here.

---

## Confidence Score: 9/10

**Why 9, not 10:** The task is small, purely-additive, and exactly specified — one type-only import, one optional interface field (verbatim from spec/04 §8), one `freshRuntime` initializer line (mirroring the existing `shrinkMissCounts: new Map()`), and a no-op confirmation for resetRuntime/clearAll. The insertion anchors (after `rewindRefusedTurnIndex` in the interface; last property in freshRuntime; after the header JSDoc for the import) are exact, and the test patterns (exact-shape `toEqual`, `expectTypeOf`, per-session isolation) already exist in `test/runtime.test.ts` to mirror. The only residual risk is missing a second exact-shape assertion elsewhere in the test file; the Level-2 `npm test -- test/runtime.test.ts` run surfaces and fixes that immediately. No external research is needed — everything is in-repo.

**Parallel-execution note:** This PRP runs alongside P1.M2.T2.S1 (which adds `export interface RevertCheckpoint` to `src/markers.ts`). The two touch DISJOINT files (runtime.ts + test/runtime.test.ts vs markers.ts + test/markers.test.ts) with no shared edits, so there is no merge conflict. This task IMPORTS the type S1 produces — it is gated on S1 landing its `export interface RevertCheckpoint { label; backend:"git"|"cas"; beforeRef; afterRef?; turnIndex; ts }` exactly as its PRP specifies; if S1 lands, `npm run typecheck` here passes. The downstream consumers of THIS task's `snapshots` field are P3.M1.T1 (capture hooks) and P4.M2.T1 (rewindExecute), which run later.