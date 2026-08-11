# PRP — P1.M1.T1.S2: Update `filter.ts` `suppressCheck` call site to pass `recentMetrics` (BUG-001 fix, step 2/2)

---

## Goal

**Feature Goal**: Close the BUG-001 fix by updating the ONE production call site of `suppressCheck` — `src/filter.ts:319` — to pass `markers.recentMetrics` as the new 2nd argument introduced by S1 (`P1.M1.T1.S1`). This wires the turn-based suppression lower bound (S1's `suppressCheck(metric, recentMetrics, markers)`) into the live `contextHandler` drift-nudge injection path, so the drift nudge (Nudge B) actually resumes firing on the turn *after* a rewind/shrink instead of being silently no-op'd.

**Deliverable**: A one-line change in `src/filter.ts:319`: `!suppressCheck(markers.metric, markers)` → `!suppressCheck(markers.metric, markers.recentMetrics, markers)`, plus an optional touch-up of the adjacent stale comment (lines ~310-312) that claims suppressCheck takes "the single LATEST metric … [for] the time-window suppress heuristic". No other file is touched by S2.

**Success Definition**:
- `npx tsc --noEmit` — **fully clean**: the `src/filter.ts:319` TS2554 error that S1 intentionally left is now resolved; no NEW error cites `src/filter.ts`.
- `npx vitest run test/drift_nudge.test.ts` — green (S1's direct unit tests; S2 confirms no regression).
- `npx vitest run` (FULL suite) — **green**. This is S2's unique gate: `test/filter.test.ts:454` ("injects the drift nudge when shouldNudge is true and not suppressed") goes RED→GREEN (it fails under S1's intermediate state because the broken call site throws inside the `if`, caught by `contextHandler`'s outer try/catch, so the nudge silently no-ops).

## User Persona (if applicable)

**Target User**: The coding agent relying on Nudge B (the "free ride" drift nudge), and maintainers closing BUG-001.

**Use Case**: The agent issues one `mulligan_shrink`. On subsequent, unrelated turns that each grow context, the drift nudge should fire normally. S1 fixed the algorithm; S2 connects that fix to the live filter path so it takes effect at runtime.

**User Journey**: S1 refactored `suppressCheck` to a turn-based lower bound (and updated its direct unit tests) → **S2 updates the one filter call site** so the production `contextHandler` path passes `recentMetrics` → the drift nudge now fires on the turn after a marker. `test/filter.test.ts:454` (the integration assertion that a drift nudge IS injected through the filter) turns green.

**Pain Points Addressed**: Without S2, S1's algorithmic fix never reaches the runtime — `filter.ts:319` still calls the 2-arg form, passing `undefined` as `recentMetrics`, which throws and is swallowed by the handler's try/catch, silently disabling the nudge. S2 is the wire that lights the fix.

## Why

- **Business value / user impact**: Completes BUG-001 (Major). S1 alone is not user-observable — the filter call site is the only production path. After S2, the project's signature "free ride" drift nudge resumes firing on the turn after any rewind/shrink, instead of being silently suppressed.
- **Integration with existing features**: `suppressCheck` is the §5.3 gate composed in `contextHandler` as `fire = shouldNudge(...) && !suppressCheck(metric, recentMetrics, markers)`. The `recentMetrics` data is already on the `MarkersBundle` (`readMarkers` returns it at `filter.ts:204`; always an array — fail-open returns `[]` at `filter.ts:147`). The call site already guards `markers.recentMetrics.length > 0` (line 316) before reaching `suppressCheck`, so the array is guaranteed non-empty.
- **Problems this solves and for whom**: For the agent: Nudge B fires when it should (post-marker). For maintainers: the S1 refactor is actually exercised at runtime + the TS2554 is cleared.

## What

A single one-line edit (the call site) + an optional comment touch-up. No schema, config, persistence, registration, or test-file changes (test files are S1's — see Decision D1).

### Success Criteria

- [ ] `src/filter.ts:319` reads `!suppressCheck(markers.metric, markers.recentMetrics, markers) &&`.
- [ ] No other term in the `if`-condition (lines 314-321) changes: `config.nudges.perTurnDrift`, `markers.recentMetrics` + `.length > 0`, `shouldNudge(markers.recentMetrics, config)`, `markers.metric`, and `rt.rewindRefusedTurnIndex !== markers.metric.turnIndex` are all byte-for-byte unchanged.
- [ ] `npx tsc --noEmit` is fully clean (the S1-left TS2554 at `filter.ts:319` is resolved).
- [ ] `npx vitest run` (full suite) is green, including `test/filter.test.ts:454` (RED→GREEN).
- [ ] NO edits to `src/nudges.ts` (S1), `test/drift_nudge.test.ts` (S1), `src/markers.ts`, or any other file.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact call-site line (current + target), the surrounding `if`-condition, the `MarkersBundle` shape proving structural assignability, the S1 contract for `suppressCheck`'s new signature, and the precise red→green validation (`test/filter.test.ts:454`). The S1 PRP (sibling) defines the new `suppressCheck` signature this consumes; this PRP treats it as a stable contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/filter.ts
  why: "THE file. The call site is line 319 inside contextHandler's drift-nudge if-block (lines 314-322): `!suppressCheck(markers.metric, markers) &&`. The import is line 51 (`... suppressCheck } from './nudges.js'`). The MarkersBundle type (lines 88-114) has `recentMetrics: TurnMetric[]` (line 114) — always present. readMarkers returns `recentMetrics` at line 204 (fail-open `[]` at line 147). contextHandler's whole body is try/catch-wrapped (try line 236 / catch line 435) — this is WHY the S1 intermediate state silently no-ops instead of crashing."
  pattern: "The if-condition already guards `markers.recentMetrics && markers.recentMetrics.length > 0` (lines 315-316) BEFORE suppressCheck (line 319) → recentMetrics is guaranteed NON-EMPTY at the call site, and `markers.metric` is truthy (line 318) → arg 1 is non-null. The guard already does the work S1's first-turn fallback (lo=0) needs."
  gotcha: "MarkersBundle is structurally assignable to suppressCheck's `{rewinds, shrinks}` 3rd param — extra fields (metric/cancelledIds/recentMetrics) are ignored by TS structural typing. Passing `markers` as arg 3 typechecks with NO cast. Do NOT destructure or build a new object — pass `markers` directly."

- file: src/nudges.ts  # (modified by S1 — assumed to exist with the new signature)
  why: "S1's new suppressCheck signature is `(metric: TurnMetric, recentMetrics: TurnMetric[], markers: {rewinds, shrinks})`. The 2nd param is the NEW one S2 supplies. `lo = recentMetrics[1].ts` when length>=2 else `lo=0`. S1 removed NUDGE_TURN_WINDOW_MS. S2 consumes this contract — do NOT re-edit nudges.ts."
  pattern: "suppressCheck is pure + total (never throws on well-formed input). After S2 passes a real array, the `recentMetrics.length` read is safe (it threw on `undefined` under the S1 intermediate state)."
  gotcha: "Do NOT edit nudges.ts in S2 (S1 owns it — parallel subtask, merge-conflict risk). Do NOT edit markers.ts (recentMetrics already produced by readMarkers; no change)."

- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M1T1S1/PRP.md
  why: "The CONTRACT. It specifies the new signature `(metric, recentMetrics, markers)`, confirms S1 leaves filter.ts:319 UNCHANGED (the expected TS2554 is owned by S2), and — critically — confirms S1 FULLY updates test/drift_nudge.test.ts (Task 4: imports, all 3-arg calls incl. acceptance a/b/c describe at lines 222-265, BUG-001 regression)."
  critical: "S1's Task 4c explicitly updates the acceptance a/b/c tests to 3-arg. So the S2 item's instruction to 'update the acceptance tests' is ALREADY satisfied by S1's contract. S2 does NOT edit drift_nudge.test.ts (Decision D1) — it would conflict with S1's parallel work. S2 VERIFIES those tests pass instead."

- file: test/filter.test.ts
  why: "S2's red→green validation lives here. Line 454: 'injects the drift nudge when shouldNudge(metric) is true and not suppressed' — this is the integration test that exercises contextHandler's drift-nudge path THROUGH filter.ts:319. Line 470: 'does NOT inject ... when suppressed by a same-turn rewind marker' (the suppress branch; passes under both S1 and S2). Lines 324-381: readMarkers recentMetrics-window unit tests (unaffected)."
  pattern: "filter.test.ts uses hand-rolled fakes + real contextHandler (no vi.fn). The drift-nudge tests script markers (rewinds/shrinks/metrics) and assert injectNudge's text appears (or not) in the filtered messages."
  gotcha: "Do NOT edit filter.test.ts in S2 unless a test is genuinely broken by the call-site change (it won't be — S2 makes the path work, which is what line 454 asserts). If line 454 was already passing pre-S1 (because the 2-arg call was valid then), it FAILS post-S1 (the throw) and PASSES post-S2. That red→green is the proof S2 landed."

- file: test/drift_nudge.test.ts (READ-ONLY — do NOT edit in S2)
  why: "Confirms S1 owns ALL the suppressCheck unit tests. The mechanism describe (170-220) + acceptance a/b/c describe (222-265) are S1's to update to 3-arg. S2 only RUNS this file (must stay green) — it does NOT edit it."
  gotcha: "Editing drift_nudge.test.ts in S2 = a merge conflict with S1 (both subtasks run in parallel). The parallel_execution_context directive is explicit: 'Do NOT duplicate or conflict with work specified in the previous PRP.' S1's PRP Task 4 covers every suppressCheck call in this file."

- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: "§BUG-001 confirms the bug end-to-end (location, repro, the spec/07 §5.3 prescription). The recommendation (h2.5) chose approach (1): lower bound = 2nd-newest metric's ts (recentMetrics[1]), requiring NO marker schema change — S1 implemented that; S2 wires the call site."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  filter.ts    # ← MODIFY (S2): line 319 call site (+ optional comment touch-up ~310-312)
  nudges.ts    # ← S1 (NOT this subtask): suppressCheck new signature + NUDGE_TURN_WINDOW_MS removed
  markers.ts   # ← READ-ONLY: recentMetrics already produced by readMarkers; no change
test/
  drift_nudge.test.ts   # ← S1 (NOT this subtask): all suppressCheck calls already 3-arg
  filter.test.ts        # ← READ-ONLY: line 454 is S2's red→green validation (do NOT edit)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S2 MODIFIES exactly ONE source file (no test changes):
src/filter.ts   # line 319: 2-arg → 3-arg suppressCheck call (+ optional comment touch-up at ~310-312)
# All other files are S1 (nudges.ts, drift_nudge.test.ts) / untouched (markers.ts, filter.test.ts).
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S2 is a ONE-LINE change — do not broaden the if-condition). The surrounding guard
//   (lines 314-321) already does everything needed: `markers.recentMetrics && markers.recentMetrics.length > 0`
//   guarantees recentMetrics is a non-empty array before suppressCheck runs; `markers.metric &&` (line 318)
//   guarantees arg 1 is non-null; `rt.rewindRefusedTurnIndex !== markers.metric.turnIndex` (line 320) is the
//   P4 rewind-refusal mute. S2's ONLY edit is inserting `markers.recentMetrics, ` as the 2nd argument on line 319.
//   Do NOT reorder the terms, add a null-check, or wrap in try/catch — the guard + suppressCheck's own defensive
//   reads (S1) already handle every edge.

// CRITICAL GOTCHA #2 (MarkersBundle is structurally assignable — pass `markers` directly, no destructure).
//   suppressCheck's 3rd param is typed `{ rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> }`.
//   MarkersBundle has those PLUS metric/cancelledIds/recentMetrics. TS structural typing accepts the extra fields
//   in this (object → narrower-param) direction with NO cast and NO error. Do NOT build a `{rewinds, shrinks}`
//   subset object — that's needless churn and diverges from the existing 2-arg call's shape (which already passed
//   the full `markers`).

// CRITICAL GOTCHA #3 (the S1 intermediate state silently no-ops — that's WHY filter.test.ts:454 is the gate).
//   After S1 but before S2, line 319 calls `suppressCheck(markers.metric, markers)` → the 3rd param `recentMetrics`
//   is `undefined` at runtime → `recentMetrics.length` throws TypeError → the if-condition evaluation throws →
//   caught by contextHandler's OUTER try/catch (try@236 / catch@435) → `messages = injectNudge(...)` NEVER runs.
//   The nudge silently disappears (fail-open, no crash). So tsc shows TS2554 AND filter.test.ts:454 fails.
//   S2's one-line fix resolves BOTH (tsc clean + the nudge injects again → line 454 green).

// CRITICAL GOTCHA #4 (do NOT edit test/drift_nudge.test.ts — it is S1's). S1's PRP Task 4 updates EVERY
//   suppressCheck call in that file to 3-arg (mechanism describe + acceptance a/b/c describe) and adds the
//   BUG-001 regression. Editing it in S2 = a merge conflict with the parallel S1 work. The S2 item's phrase
//   "update them to use the new 3-arg signature" is SATISFIED by S1's contract (Decision D1). S2 only RUNS
//   the file (must be green). If you find a 2-arg suppressCheck call still in drift_nudge.test.ts when S2
//   starts, that means S1 deviated — flag it, do not silently fix it in a file S1 owns.

// CRITICAL GOTCHA #5 (the comment at lines ~310-312 becomes slightly stale — touch it up). It currently reads
//   "injectNudge/suppressCheck still take the single LATEST metric (markers.metric) for the text + the time-window
//   suppress heuristic." After S2, suppressCheck ALSO takes recentMetrics (for the turn-boundary lower bound, not
//   a time-window). Update this to note suppressCheck now takes recentMetrics too (turn-boundary lower bound).
//   This is OPTIONAL hygiene (the code is correct without it) but avoids a comment that lies about the impl.
//   (The MarkersBundle JSDoc at lines 105-107 + 193 has similar "still use the single latest metric" wording —
//   lower priority; the line 310-312 comment adjacent to the change is the one to fix.)

// CRITICAL GOTCHA #6 (scope — S2 is the filter call site ONLY). Do NOT touch nudges.ts (S1), markers.ts,
//   config.ts, the high-water block (lines 324+), or any tool. Do NOT re-export or re-wrap suppressCheck.
//   The production path now has exactly ONE suppressCheck call site (filter.ts:319) — confirmed by grep.
```

## Implementation Blueprint

### Data models and structure

**No data-model change.** `MarkersBundle` (filter.ts:88-114) already carries `recentMetrics: TurnMetric[]`; `readMarkers` already produces it (filter.ts:204, fail-open `[]` at 147). S2 only changes a call argument.

```typescript
// The handoff S2 wires: suppressCheck(metric, recentMetrics, markers) — S1's signature.
//   markers.recentMetrics is TurnMetric[] (newest-first; [0]===markers.metric).
//   The if-guard (line 316) guarantees length > 0 at the call site, so suppressCheck's
//   first-turn fallback (length < 2 → lo=0) handles the length===1 case cleanly.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/filter.ts:319 — pass markers.recentMetrics as the 2nd argument
  - CURRENT (line 319):
      !suppressCheck(markers.metric, markers) &&
  - TARGET:
      !suppressCheck(markers.metric, markers.recentMetrics, markers) &&
  - NOTHING ELSE in the if-condition (lines 314-321) changes. The full condition after the edit:
      if (
        config.nudges.perTurnDrift &&
        markers.recentMetrics &&
        markers.recentMetrics.length > 0 &&
        shouldNudge(markers.recentMetrics, config) &&
        markers.metric &&
        !suppressCheck(markers.metric, markers.recentMetrics, markers) &&
        rt.rewindRefusedTurnIndex !== markers.metric.turnIndex
      ) {
        messages = injectNudge(messages, markers.metric);
      }
  - NAMING/PLACEMENT: insert `markers.recentMetrics, ` between `markers.metric,` and `markers` on line 319.
    Keep it on the same line (it's short). Arg order matches S1's signature: (metric, recentMetrics, markers).
  - GOTCHA: pass `markers` (the full MarkersBundle) as arg 3 — it is structurally assignable to `{rewinds, shrinks}`
    (GOTCHA #2). Do NOT destructure.
  - DEPENDENCIES: S1's nudges.ts (the 3-arg signature must be in place; the S1 PRP is the contract).

Task 2 (OPTIONAL, recommended hygiene): EDIT the comment at src/filter.ts ~lines 310-312
  - CURRENT (the comment block above the if-condition, ~310-312):
      "// injectNudge/suppressCheck still take the single LATEST metric (markers.metric) for the text + the
      //  time-window suppress heuristic. markers.metric !== null ⟺ recentMetrics.length > 0, so the reorder is
      //  logically equivalent EXCEPT shouldNudge is never called on an empty window (cleaner, defensive)."
  - TARGET: note suppressCheck now ALSO takes recentMetrics (turn-boundary lower bound, NOT a time-window). e.g.:
      "// injectNudge still takes the single LATEST metric (markers.metric) for the nudge text. suppressCheck now
      //  takes (markers.metric, markers.recentMetrics, markers) — the turn-boundary lower bound
      //  (recentMetrics[1].ts) replaces the old fixed time-window (BUG-001). markers.metric !== null ⟺
      //  recentMetrics.length > 0, so the reorder is logically equivalent EXCEPT shouldNudge is never called on
      //  an empty window (cleaner, defensive)."
  - GOTCHA: this is hygiene only — the code in Task 1 is correct without it. Keep the edit minimal + accurate;
    do not rewrite the whole comment block. (The MarkersBundle JSDoc lines 105-107 + 193 have similar stale
    "still use the single latest metric" wording — leave those; they're lower priority and farther from the change.)
  - DEPENDENCIES: Task 1.

Task 3: VERIFY drift_nudge.test.ts is green (do NOT edit it — S1 owns it)
  - RUN `npx vitest run test/drift_nudge.test.ts` → all pass. These are S1's direct unit tests (now 3-arg per S1's
    contract). S2 confirms NO regression. If a suppressCheck test FAILS here, it means either S1 hasn't landed its
    test updates yet (coordinate with S1 — do not edit the file yourself) OR S1 deviated from its PRP. Do NOT
    patch drift_nudge.test.ts in S2 (GOTCHA #4 — merge-conflict risk with the parallel S1 work).
  - DEPENDENCIES: Task 1 (the call-site change does not affect these direct unit tests, but run them to be sure).

Task 4: VALIDATE (no new code)
  - RUN `npx tsc --noEmit` → ZERO errors. The S1-left `src/filter.ts:319` TS2554 is resolved. Confirm NO error
    cites src/filter.ts (or any file). [S1 left exactly one error for S2 to clear; after S2 the typecheck is clean.]
  - RUN `npx vitest run test/filter.test.ts` → green, INCLUDING line 454 ("injects the drift nudge when
    shouldNudge(metric) is true and not suppressed"). This is S2's red→green proof (GOTCHA #3). Line 470 (suppress
    branch) also passes.
  - RUN `npx vitest run` (FULL suite) → GREEN. This is S2's headline gate: the full suite is clean for the first
    time in this bugfix series (S1's intermediate state left filter.test.ts:454 red via the runtime throw).
  - DEPENDENCIES: Tasks 1-3.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the change is a single inserted argument — the guard already did the defensive work.
//   The if-condition (lines 314-321) evaluates left-to-right with short-circuit &&:
//     config.nudges.perTurnDrift  →  markers.recentMetrics (truthy)  →  .length > 0  →  shouldNudge(...)  →
//     markers.metric (truthy)  →  !suppressCheck(markers.metric, markers.recentMetrics, markers)  →
//     rt.rewindRefusedTurnIndex !== markers.metric.turnIndex
//   By the time suppressCheck runs: recentMetrics is a NON-EMPTY array, markers.metric is non-null. suppressCheck's
//   own defensive reads (S1) handle the rest. No additional guard is needed or wanted.

// CRITICAL walk-through (why filter.test.ts:454 goes red→green):
//   Under S1 (pre-S2): suppressCheck(markers.metric, markers) → arg `recentMetrics` = undefined →
//     `recentMetrics.length` throws TypeError → if-condition throws → caught by contextHandler try@236/catch@435 →
//     `messages = injectNudge(...)` never runs → drift nudge NOT injected → filter.test.ts:454 FAILS.
//   Under S2: suppressCheck(markers.metric, markers.recentMetrics, markers) → recentMetrics is a real array →
//     no throw → (no same-turn marker) → returns false → !false = true → injectNudge runs → nudge injected → GREEN.

// CRITICAL: the production codebase has exactly ONE suppressCheck call site (filter.ts:319 — grep-confirmed).
//   The only other references are the import (filter.ts:51) + the direct unit tests (drift_nudge.test.ts, S1's).
//   So S2's one-line edit is the COMPLETE production wiring of the BUG-001 fix.
```

### Integration Points

```yaml
CODE:
  - modify: src/filter.ts — line 319 call site (2-arg → 3-arg) + optional comment touch-up (~310-312)
  - untouched: the rest of contextHandler, the high-water block (324+), registerFilterHandler, readMarkers,
    MarkersBundle, nudges.ts (S1), markers.ts, config.ts, all tools
TESTS:
  - untouched: test/drift_nudge.test.ts (S1 owns it — GOTCHA #4), test/filter.test.ts (line 454 is the validation,
    do NOT edit), every other test file
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config knob (NUDGE_TURN_WINDOW_MS was a const, removed by S1 — not config); no persistence change;
    no registration change (registerFilterHandler unchanged).
DOWNSTREAM (none — S2 is the LEAF of the BUG-001 fix):
  - P1.M3.T1 (changeset docs) will mention the drift-nudge behavior change; that is a separate doc task, not S2.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: ZERO errors. S1 intentionally left exactly ONE error — `src/filter.ts(319,X): error TS2554: Expected 3
#   arguments, but got 2` — for S2 to clear. After Task 1, that error is gone and the typecheck is fully clean.
#   If ANY error remains citing src/filter.ts (e.g. a typo like `markers.recentmetric`), fix YOUR line.
#   If an error cites a DIFFERENT file, it's pre-existing/unrelated — note it but it's not S2's bar (verify it's
#   not caused by your edit).
```

### Level 2: Unit Tests (Component Validation)

```bash
# S1's direct unit tests — confirm no regression (do NOT edit this file; it's S1's):
npx vitest run test/drift_nudge.test.ts
# EXPECTED: all pass. These test suppressCheck/shouldNudge directly (3-arg, per S1's contract). They do NOT go
#   through filter.ts:319, so S2's call-site change cannot break them. A failure here means S1 hasn't landed its
#   test updates (coordinate — don't edit the file) or S1 deviated from its PRP.

# The filter unit/integration tests — S2's red→green proof:
npx vitest run test/filter.test.ts
# EXPECTED: all pass, INCLUDING:
#   - line 454 "injects the drift nudge when shouldNudge(metric) is true and not suppressed"  ← RED→GREEN (the fix)
#   - line 470 "does NOT inject ... when suppressed by a same-turn rewind marker"             ← stays GREEN
#   - line 485 "does NOT inject ... when shouldNudge is false"                                ← stays GREEN
#   - line 493 "does NOT inject ... rewind was refused (P4.M1.T2.S3)"                         ← stays GREEN
# If line 454 still FAILS after Task 1, re-check you inserted `markers.recentMetrics, ` (not e.g. `markers`) and
#   that S1's suppressCheck signature/return is correct.
```

### Level 3: Integration Testing (System Validation)

```bash
# The FULL suite is S2's headline gate — clean for the first time in this bugfix series:
npx vitest run
# EXPECTED: all pass. Under S1's intermediate state this was RED (filter.test.ts:454 failed via the runtime throw).
#   After S2 it is GREEN. No server/endpoint to curl — this is a Pi extension (event-driven, no HTTP surface).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# BUG-001 end-to-end sanity (optional — proves the headline fix at the pure-helper tier, mirroring S1's regression):
#   a quick tsx one-liner exercising suppressCheck through the SAME shape filter.ts:319 now passes:
#   npx tsx -e "
#     import { suppressCheck } from './src/nudges.js';
#     const latest = { ts: 200, seq: 3 }; const prev = { ts: 100, seq: 2 };
#     // A shrink from the PREVIOUS turn (ts===prev.ts) must NOT suppress (BUG-001 fix):
#     console.log(suppressCheck(latest, [latest, prev], { rewinds: [], shrinks: [{ ts: 100 }] })); // → false
#     // A shrink created DURING this turn still suppresses:
#     console.log(suppressCheck(latest, [latest, prev], { rewinds: [], shrinks: [{ ts: 150 }] })); // → true
#   "
# (test/drift_nudge.test.ts already asserts this programmatically — S1's BUG-001 regression. This is manual confirmation.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` → ZERO errors (the S1-left `filter.ts:319` TS2554 is resolved).
- [ ] `npx vitest run test/drift_nudge.test.ts` → green (S1's tests; no regression).
- [ ] `npx vitest run test/filter.test.ts` → green, incl. line 454 (RED→GREEN).
- [ ] `npx vitest run` (full suite) → GREEN.

### Feature Validation

- [ ] `src/filter.ts:319` reads `!suppressCheck(markers.metric, markers.recentMetrics, markers) &&`.
- [ ] The rest of the if-condition (lines 314-321) is byte-for-byte unchanged.
- [ ] The drift nudge now injects through the contextHandler path when `shouldNudge` is true and no same-turn marker exists (filter.test.ts:454 green).
- [ ] A same-turn marker still suppresses (filter.test.ts:470 green — the §5.3 intent is preserved).

### Code Quality Validation

- [ ] Only `src/filter.ts` is modified — NO edits to `src/nudges.ts` (S1), `test/drift_nudge.test.ts` (S1), `src/markers.ts`, `test/filter.test.ts`, or any other file.
- [ ] `markers` is passed directly as arg 3 (no destructure / no cast — structural assignability).
- [ ] The optional comment touch-up (lines ~310-312) accurately reflects the new 3-arg call (no stale "time-window" claim).

### Documentation & Deployment

- [ ] The adjacent comment (lines ~310-312) is updated if Task 2 was applied (Mode A — rides with the code).
- [ ] No README/spec change in S2 (changeset doc sync is P1.M3.T1; the drift-nudge behavior change is documented there).

---

## Anti-Patterns to Avoid

- ❌ Don't broaden the if-condition or add defensive guards — the existing guard (lines 315-318) already guarantees `recentMetrics` is a non-empty array and `markers.metric` is non-null before `suppressCheck` runs. S2's edit is ONE inserted argument, nothing more (GOTCHA #1).
- ❌ Don't destructure `markers` into a `{rewinds, shrinks}` subset for arg 3 — `MarkersBundle` is structurally assignable to the `{rewinds, shrinks}` param (extra fields ignored). Pass `markers` directly (GOTCHA #2). The old 2-arg call already passed the full `markers`; keep that shape.
- ❌ Don't edit `test/drift_nudge.test.ts` — S1's contract (Task 4) already updates every `suppressCheck` call there to 3-arg (mechanism + acceptance a/b/c) and adds the BUG-001 regression. Editing it in S2 causes a merge conflict with the parallel S1 work (GOTCHA #4, Decision D1). S2 only RUNS that file.
- ❌ Don't edit `test/filter.test.ts` either — line 454 is the red→green *validation*, not something to change. If it fails after Task 1, your call-site edit is wrong (re-check the inserted argument), not the test.
- ❌ Don't touch `src/nudges.ts`, `src/markers.ts`, `config.ts`, the high-water block, or any tool — S2 is the filter call site ONLY (GOTCHA #6). `NUDGE_TURN_WINDOW_MS` was already removed by S1; do not re-add or reference it.
- ❌ Don't wrap the call in a new try/catch — `contextHandler`'s outer try/catch (line 236/435) already covers it, and after S2 `suppressCheck` no longer throws (it gets a real array). Adding a local try/catch would mask real bugs.
- ❌ Don't treat the full `npx vitest run` as "someone else's gate" — it is S2's headline validation. S1 explicitly could NOT make it green (the runtime throw broke `filter.test.ts:454`); S2 is the subtask that turns it green. A red full suite after Task 1 means S2 isn't done.
- ❌ Don't leave the line ~310-312 comment claiming suppressCheck uses "the time-window suppress heuristic" if you can trivially fix it (Task 2) — a comment that lies about the implementation is worse than no comment. (Optional, but cheap.)

---

## Decision Log

- **D1 — S2 does NOT edit `test/drift_nudge.test.ts`; S1 owns it.** The S2 item description says "update [the acceptance tests] to use the new 3-arg signature," but S1's PRP Task 4c already updates the acceptance a/b/c describe (lines 222-265) to 3-arg, and Task 4 more broadly rewrites ALL `suppressCheck` calls in `drift_nudge.test.ts` (imports, mechanism describe, BUG-001 regression). The `parallel_execution_context` directive is explicit: "Treat that PRP as a CONTRACT … Do NOT duplicate or conflict with work specified in the previous PRP." Editing the same file in two parallel subtasks risks merge conflicts and double-writes. Resolution: S2's exclusive code deliverable is the `filter.ts:319` call site; S2 VERIFIES `drift_nudge.test.ts` is green (S1's deliverable) rather than re-editing it. S2's real test contribution is the FULL-suite green gate — `test/filter.test.ts:454` goes red→green via the filter path, which S1 could not validate (its intermediate state broke that path at runtime).

- **D2 — Pass `markers` directly as arg 3 (no destructure, no cast).** `suppressCheck`'s 3rd param is typed `{ rewinds; shrinks }`; `MarkersBundle` has those plus `metric`/`cancelledIds`/`recentMetrics`. TypeScript structural typing accepts the extra fields in the object→narrower-param direction with no cast. The pre-S1 2-arg call already passed the full `markers`; preserving that shape minimizes churn and matches the codebase idiom. Building a subset object would be needless ceremony.

- **D3 — The comment touch-up (Task 2) is optional hygiene, not a gate.** The line ~310-312 comment claims `suppressCheck` uses "the single LATEST metric … [for] the time-window suppress heuristic." After S1+S2 that's stale (it now takes `recentMetrics` for a turn-boundary lower bound, and `NUDGE_TURN_WINDOW_MS` is gone). Fixing it is cheap and avoids a lying comment, but the code is correct without it, so it's recommended-not-required. The adjacent-to-the-change comment is the priority; the distant `MarkersBundle` JSDoc (lines 105-107, 193) has similar wording but is lower priority and left alone to keep the diff tight.

---