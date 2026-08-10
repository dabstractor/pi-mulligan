# PRP — P1.M1.T1.S1: `Math.floor >= 1` guard on `driftWindowTurns` in `validateConfig` (BUG-002 fix)

---

## Goal

**Feature Goal**: Close a config-validation gap where `nudges.driftWindowTurns` accepts a fractional value whose `Math.floor` is `0` (e.g. `0.5`), producing a degenerate **zero-length drift window** that permanently defeats the spec/07 §5.1 windowed-drift design. Add the `Math.floor(n) >= 1` guard already used by the sibling `rewind.maxRetriesPerPrompt` knob, so any value flooring below 1 silently falls back to the default (3).

**Deliverable**: A one-line edit to `src/config.ts` line 288 (the `driftWindowTurns` assignment inside `validateConfig`'s `if (isRecord(nudgesRaw))` block), plus a regression test in `test/config.test.ts` asserting `validateConfig({ nudges: { driftWindowTurns: 0.5 } })` returns `driftWindowTurns === 3`. Optional: tighten the field's JSDoc.

**Success Definition**:
- `validateConfig({ nudges: { driftWindowTurns: 0.5 } }).nudges.driftWindowTurns === 3` (was `0` before the fix).
- `validateConfig({ nudges: { driftWindowTurns: 5.7 } }).nudges.driftWindowTurns === 5` (unchanged — still floors to a valid `>= 1` integer).
- `npx vitest run test/config.test.ts` — all pass (existing integer/invalid tests unaffected; new 0.5 test green).
- `npx vitest run` — full suite passes.
- `npx tsc --noEmit` — no new errors from the touched files.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and any user who misconfigures `driftWindowTurns` with a fraction; indirectly the agent relying on the per-turn drift nudge (Nudge B).

**Use Case**: A user sets `"mulligan": { "nudges": { "driftWindowTurns": 0.5 } }` (typo / misunderstanding). The validator must not accept a value that produces a zero-length window.

**User Journey**: User sets `driftWindowTurns: 0.5` → `validateConfig` now rejects it (silent fallback to default 3) → `shouldNudge` slices a 3-turn window as designed → the drift nudge fires correctly instead of permanently falling back to the bloat-only path.

**Pain Points Addressed**: A degenerate `driftWindowTurns: 0` made `shouldNudge()` do `recentMetrics.slice(0, 0)` → empty deltas → permanent bloat-only fallback, silently disabling the windowed-drift feature with no diagnostic.

## Why

- **Business value / user impact**: Minor. No built-in default triggers it (the default is `3`); only a misconfigured fractional value does. But it is a genuine validation gap: a value the validator ACCEPTS produces a functionally-broken drift subsystem with no warning.
- **Integration with existing features**: `driftWindowTurns` feeds `shouldNudge` (src/nudges.ts:327) `recentMetrics.slice(0, config.nudges.driftWindowTurns)`. A `0` collapses that slice to `[]`. The fix is purely upstream (validation); `shouldNudge` and `contextHandler` are unchanged — they already treat `driftWindowTurns` as a positive integer.
- **Problems this solves and for whom**: BUG-002 (Minor). For maintainers: consistent integer validation across the three `Math.floor`-gated knobs (`maxRetriesPerPrompt` already correct; `driftWindowTurns` fixed here; `maxActive`/`staleAfterFires` are BUG-003, a SEPARATE task).

## What

User-visible behavior: none for the shipped default config. For a misconfigured `driftWindowTurns` in `(0, 1)` (e.g. `0.5`), the validator now silently falls back to `3` instead of storing `0`. The drift nudge then works as designed.

### Success Criteria

- [ ] `src/config.ts` line 288 uses `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.nudges.driftWindowTurns` (the bare `Number.isFinite(n) ? Math.floor(n) : …` is gone).
- [ ] A regression test asserts `0.5 → 3` (the case that exposed the bug).
- [ ] The existing `5.7 → 5` test still passes (flooring to a valid `>= 1` integer is unchanged).
- [ ] `validateConfig`'s other nudges knobs (`bloatThresholdBytes`, `driftThresholdTokens`, `highWaterFraction`, `bloatThresholdBytesByTool`) are UNCHANGED.
- [ ] `npx vitest run test/config.test.ts`, `npx vitest run`, `npx tsc --noEmit` all pass.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact buggy line (288), the exact fixed line, the exact sibling precedent (line 249), the downstream consumer's vulnerable slice, the precise test to add, and confirmation that no existing test breaks. No external documentation is required.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/config.ts
  why: "THE file. The buggy driftWindowTurns branch is lines 285-288 (inside `if (isRecord(nudgesRaw))`). The CORRECT precedent is rewind.maxRetriesPerPrompt at lines 247-250."
  pattern: "CORRECT (line 249): cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
            BUGGY (line 288): cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;"
  gotcha: "coerceNumber('...', v, default, true) returns the value if v is a finite number > 0 (NO warn), else returns the default WITH a warnConfig. So 0.5 passes coerceNumber (0.5 > 0, no warn) → reaches the floor logic → Math.floor(0.5)===0. The >= 1 guard then falls back to the default SILENTLY (no warn) — exactly like maxRetriesPerPrompt. Do NOT add a warnConfig call; the contract is 'EXACT same pattern as maxRetriesPerPrompt'."

- file: src/nudges.ts
  why: "The downstream consumer that the bug breaks. shouldNudge (line 326) does `recentMetrics.slice(0, config.nudges.driftWindowTurns)` (line 327). With driftWindowTurns===0 → slice(0,0) → empty `deltas` (line 329-330) → returns `window.some(m => m.bloatHit)` (line 331) → permanent bloat-only fallback. Read this to confirm WHY a 0 is degenerate; DO NOT modify nudges.ts (it already handles a positive integer correctly)."
  pattern: "const window = recentMetrics.slice(0, config.nudges.driftWindowTurns); // the vulnerable line — only safe when driftWindowTurns >= 1"

- file: test/config.test.ts
  why: "THE test file. The driftWindowTurns describe block starts at line 316: 'nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000'. Existing tests: (a) default 3 (line 317); (b) explicit 5 (line 333); (c) 5.7 → 5 floor (line 343); (d) {0,-1,NaN,'abc',Infinity} → 3 + 1 warn (line 354)."
  pattern: "vitest, vi.mock for warnConfig (the `warn` spy — see line 361 `warn.mock.calls[0][0]`). Test (c) is the template for the new 0.5 case: `const cfg = validateConfig({ nudges: { driftWindowTurns: 0.5 } }); expect(cfg.nudges.driftWindowTurns).toBe(3);`."
  critical: "NO existing test breaks. (c) 5.7→5 still passes (5>=1). (d) 0/-1/NaN→3 still passes (they fail coerceNumber's >0 gate, warn, return default — the floor guard never sees the bad value). The 0.5→0 bug is UNTESTED today — that is the whole point of adding the regression test. For 0.5, assert ZERO warns (silent fallback), unlike (d) which asserts exactly 1 warn."

- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  why: "§BUG-002 confirms the bug end-to-end: location (lines 285-288), the buggy line, the contrast with maxRetriesPerPrompt (lines 247-250), and the impact (0.5 → 0 → slice(0,0) → bloat-only fallback). Read §BUG-002 ONLY — BUG-003 (maxActive/staleAfterFires) is a SEPARATE task (P1.M1.T2); do not fix it here."
  critical: "The recommendation (h2.5) lists applying the guard to driftWindowTurns AND maxActive AND staleAfterFires together. This subtask does ONLY driftWindowTurns (BUG-002). maxActive/staleAfterFires (BUG-003) is P1.M1.T2.S1 — out of scope."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  config.ts   # ← MODIFY: validateConfig driftWindowTurns branch (line 288); optional JSDoc (~driftWindowTurns field)
  nudges.ts   # ← READ-ONLY downstream consumer (shouldNudge line 327 — the slice that 0 breaks)
test/
  config.test.ts   # ← ADD one regression test (0.5 → 3) in the driftWindowTurns describe block (line 316+)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly two existing files:
src/config.ts        # 1 line (line 288) + optional JSDoc touch
test/config.test.ts  # 1 new it(...) test for 0.5 → 3
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the >= 1 guard must be SILENT — no warnConfig). coerceNumber("...", v, default, true)
//   returns 0.5 unchanged (0.5 > 0, no warn). The fix's fallback branch `: cfg.nudges.driftWindowTurns`
//   keeps the default WITHOUT warning. This EXACTLY mirrors maxRetriesPerPrompt (line 249), which also
//   silently falls back when floor < 1. Do NOT add a warnConfig("nudges.driftWindowTurns", v) call — that
//   would diverge from the established sibling pattern. (A diagnostic would be nice, but consistency wins;
//   the contract is "EXACT same guard pattern as maxRetriesPerPrompt".)

// CRITICAL GOTCHA #2 (why 0.5 reaches the floor logic at all). coerceNumber's `true` 4th arg requires `> 0`,
//   NOT `>= 1`. So 0.5 PASSES coerceNumber (it is > 0) and reaches Math.floor(0.5)===0. The integers
//   0/-1 and NaN/non-numbers are rejected EARLIER by coerceNumber (they are not > 0) → they warn and return
//   the default, never reaching the floor. That is why existing test (d) {0,-1,NaN,...} still passes
//   unchanged, and why the 0.5 case is the ONLY one the >= 1 guard newly affects.

// CRITICAL GOTCHA #3 (scope: ONLY driftWindowTurns). shrink.maxActive and shrink.staleAfterFires (lines
//   266-269) have a DIFFERENT bug (BUG-003: no Math.floor at all — they accept 0.5 verbatim). That is
//   P1.M1.T2.S1, a SEPARATE task. Do NOT touch those two lines in this subtask, even though the PRD's
//   recommendation groups all three. Scope creep here crosses a task boundary and risks merge conflicts
//   with the parallel/sibling task.

// CRITICAL GOTCHA #4 (no existing test breaks — verify, don't assume). The fix only changes behavior for
//   values in (0, 1) that are finite and > 0 (i.e. 0 < v < 1). The existing tests probe: integers (3, 5),
//   a fraction that floors to >= 1 (5.7 → 5), and hard-invalid values (0, -1, NaN, 'abc', Infinity → 3).
//   None of these land in the (0,1) range, so all stay green. The NEW behavior is the 0.5 → 3 case, which
//   is currently UNTESTED — add it.

// CRITICAL GOTCHA #5 (the assignment is inside an `if (v !== undefined)` block — keep the block intact).
//   Lines 286-288: `v = safeGet(nudgesRaw, "driftWindowTurns"); if (v !== undefined) { const n = coerceNumber(...); cfg.nudges.driftWindowTurns = <THE LINE>; }`.
//   Change ONLY the assignment line (288). Do NOT remove the `if (v !== undefined)` guard, the `const n`
//   declaration, or the coerceNumber call.
```

## Implementation Blueprint

### Data models and structure

**No data-model changes.** The `driftWindowTurns` field stays `number` in `MulliganConfig`. The fix is purely a validation-predicate tightening (adds `&& Math.floor(n) >= 1` to the ternary's condition).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FIX src/config.ts line 288 — add the >= 1 guard to driftWindowTurns
  - LOCATE the driftWindowTurns branch in validateConfig (inside `if (isRecord(nudgesRaw))`, lines 285-288):
      v = safeGet(nudgesRaw, "driftWindowTurns");
      if (v !== undefined) {
        const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
        cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
      }
  - EDIT line 288 ONLY. CURRENT:
      cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
    TARGET (EXACT mirror of maxRetriesPerPrompt line 249):
      cfg.nudges.driftWindowTurns = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.nudges.driftWindowTurns;
  - PRESERVE: the `v = safeGet(...)` line, the `if (v !== undefined)` wrapper, the `const n = coerceNumber(...)`
    line, and ALL other nudges branches (bloatThresholdBytes, driftThresholdTokens, highWaterFraction,
    bloatThresholdBytesByTool). The change is literally inserting `&& Math.floor(n) >= 1` into the ternary.
  - NAMING: no new names (no new variable, no new import — Math.floor/Number.isFinite are globals).
  - DEPENDENCIES: none.

Task 2 (OPTIONAL — Mode A docs): tighten the driftWindowTurns JSDoc in the MulliganConfig interface
  - The driftWindowTurns field's JSDoc currently says "Positive integer. Default: 3." (adequate per the contract).
    If you want precision, change "Positive integer." → "Positive integer (>= 1; fractional values that floor
    below 1 fall back to the default)." This rides WITH the code change. SKIP if the line already reads adequately.
  - GOTCHA: this is a JSDoc COMMENT only — do not change the field type or default. Locate it in the
    MulliganConfig interface (the nudges sub-object, near driftThresholdTokens).
  - DEPENDENCIES: none.

Task 3: ADD the regression test to test/config.test.ts (driftWindowTurns describe block, line 316+)
  - LOCATE the describe block at line 316: "nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000".
    Its existing tests are (a) defaults, (b) explicit 5, (c) 5.7 → 5 floor, (d) {0,-1,NaN,...} → 3 + warn.
  - ADD a new it(...) AFTER test (c) [the floor test] and BEFORE test (d) [the invalid test], e.g. as (c-bis) or
    fold into (c). Recommended standalone case:
      it("driftWindowTurns fractional value that floors below 1 (0.5) → falls back to default 3 (BUG-002)", () => {
        const cfg = validateConfig({ nudges: { driftWindowTurns: 0.5 } });
        expect(cfg.nudges.driftWindowTurns).toBe(3); // Math.floor(0.5)===0, 0 < 1 → default (was 0 before the fix)
      });
  - GOTCHA (warn assertion): 0.5 PASSES coerceNumber's >0 gate (no warn), then the >= 1 guard falls back
    SILENTLY (no warn). So this test should assert ZERO warns, NOT 1. If the file's `warn` spy is in scope:
      expect(warn).not.toHaveBeenCalled();   // silent fallback, matching maxRetriesPerPrompt (GOTCHA #1)
    (Contrast with test (d), which asserts exactly 1 warn because coerceNumber rejects 0/-1/NaN.) If adding
    the warn assertion is awkward in this describe block, the `toBe(3)` assertion alone is sufficient — but
    the no-warn expectation documents the silent-fallback contract.
  - ALSO (defensive): keep test (c) 5.7 → 5 EXACTLY as-is — it must still pass (Math.floor(5.7)===5 >= 1 → kept).
    Do NOT change (c).
  - NAMING: title the test to name BUG-002 + the 0.5 input (mirrors the explanatory titles in the block).
  - DEPENDENCIES: Task 1 (the fix must be in place for the test to pass — it FAILS before the fix, which is the
    TDD red step; confirm the failure first if practicing TDD).

Task 4: VALIDATE (no new code)
  - RUN `npx vitest run test/config.test.ts` → all pass (new 0.5→3 test green; existing (a)-(e) unchanged).
  - RUN `npx vitest run` → full suite passes (no regressions; nudges.test.ts shouldNudge tests unaffected —
    they pass valid configs).
  - RUN `npx tsc --noEmit` → no new errors (the change adds a boolean to an existing ternary condition; types
    are unchanged). Any pre-existing errors elsewhere are out of scope.
  - DEPENDENCIES: Tasks 1-3.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the guard is a 1-token insertion into the existing ternary condition.
//   BEFORE (buggy):  Number.isFinite(n) ? Math.floor(n) : default
//   AFTER  (fixed):  Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : default
//   The ONLY added text is:  && Math.floor(n) >= 1
//   (Note Math.floor(n) is evaluated twice — once in the condition, once in the true-branch. This is EXACTLY
//    how maxRetriesPerPrompt line 249 reads; keep the duplication for parity rather than extracting a temp.)

// PATTERN (Task 3): the regression test isolates the (0,1) fractional range the guard newly affects.
//   validateConfig({ nudges: { driftWindowTurns: 0.5 } }).nudges.driftWindowTurns === 3
//   Trace: coerceNumber(0.5, default, true) → 0.5 (>0, no warn) → n=0.5 → Math.floor(0.5)=0 → 0>=1 FALSE → default 3.
//   Before the fix: Number.isFinite(0.5) → true → Math.floor(0.5)=0 → stored 0 (BUG). After: → 3 (FIXED).

// CRITICAL: do not confuse this with the maxActive/staleAfterFires bug (BUG-003). Those have NO Math.floor
//   at all (lines 266-269 use bare coerceNumber(..., true) → 0.5 stored verbatim). This subtask floors +
//   guards ONLY driftWindowTurns. BUG-003 is P1.M1.T2.S1.
```

### Integration Points

```yaml
CODE:
  - modify: src/config.ts line 288 (the driftWindowTurns assignment); optional JSDoc on the field
  - untouched: nudges.ts (shouldNudge already handles a positive integer), filter.ts, all tools, all other config branches
TESTS:
  - add: test/config.test.ts — one it(...) in the driftWindowTurns describe block (0.5 → 3)
  - untouched: all other tests (existing integer/invalid cases stay green)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No new config field, no default change (default stays 3), no registration.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no new errors from src/config.ts. The change adds `&& Math.floor(n) >= 1` (a boolean) to an
# existing `Number.isFinite(n) ? ... : ...` ternary condition — types are unchanged (both branches are number).
# Common mistake: accidentally editing the maxRetriesPerPrompt line (249) or a nudges sibling line — re-read
# the diff to confirm ONLY line 288 changed.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The config test file — fast feedback on the validation change.
npx vitest run test/config.test.ts
# EXPECTED: all pass. New test: 0.5 → 3 (green after fix; was the bug). Existing (c) 5.7→5 and (d) {0,-1,...}→3
# unchanged. If 0.5→3 FAILS with received=0, the fix on line 288 wasn't applied (re-check Task 1).

# Full suite — confirm no regression in the drift-nudge subsystem tests (nudges.test.ts shouldNudge cases).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: validateConfig is a pure function exercised directly by the unit tests. There is no
# live runtime seam to exercise for a one-line predicate change. (End-to-end "does the drift nudge fire with
# a 3-turn window" is already covered by the existing nudges.test.ts shouldNudge tests, which pass valid configs.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green confirmation (optional — proves the test actually guards the behavior):
#   1. BEFORE applying Task 1: run `npx vitest run test/config.test.ts` with ONLY the new 0.5 test added → it
#      FAILS (received 0, expected 3). This is the red step confirming the bug reproduces.
#   2. Apply Task 1 → re-run → PASSES (green). The red→green transition is the proof the test locks in the fix.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — no new errors from `src/config.ts` / `test/config.test.ts`.
- [ ] `npx vitest run test/config.test.ts` — all pass (new 0.5→3 test green).
- [ ] `npx vitest run` — full suite passes.

### Feature Validation

- [ ] `validateConfig({ nudges: { driftWindowTurns: 0.5 } }).nudges.driftWindowTurns === 3`.
- [ ] `validateConfig({ nudges: { driftWindowTurns: 5.7 } }).nudges.driftWindowTurns === 5` (unchanged).
- [ ] `validateConfig({ nudges: { driftWindowTurns: 0 } }).nudges.driftWindowTurns === 3` (unchanged — still rejected by coerceNumber's >0 gate + 1 warn).
- [ ] The driftWindowTurns assignment at line 288 reads `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.nudges.driftWindowTurns`.
- [ ] All other nudges branches + the maxRetriesPerPrompt line (249) + maxActive/staleAfterFires (266-269) are UNCHANGED.

### Code Quality Validation

- [ ] The guard EXACTLY mirrors `maxRetriesPerPrompt` (line 249) — same `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : <default>` shape.
- [ ] Only `src/config.ts` (1 line + optional JSDoc) and `test/config.test.ts` (1 test) are modified — NO changes to nudges.ts, filter.ts, tools, or other config branches.
- [ ] BUG-003 (maxActive/staleAfterFires) is NOT touched here (it's P1.M1.T2.S1).

### Documentation & Deployment

- [ ] Optional JSDoc touch on the `driftWindowTurns` field reflects ">= 1" (Mode A — rides with the code if done).
- [ ] No README/spec change in this subtask (changeset doc sync is P1.M5.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't add a `warnConfig` call on the fallback branch — the contract is "EXACT same pattern as maxRetriesPerPrompt", which falls back SILENTLY (GOTCHA #1). Adding a warn would diverge from the sibling and change the existing {0,-1,NaN} test's warn-count expectations indirectly. Consistency with maxRetriesPerPrompt is the goal.
- ❌ Don't "fix" `maxActive`/`staleAfterFires` (BUG-003) in this subtask — they have a DIFFERENT bug (no Math.floor at all) and belong to P1.M1.T2.S1. Touching them here is scope creep that crosses a task boundary (GOTCHA #3).
- ❌ Don't change `coerceNumber`'s 4th-arg `true` to something else — `true` (require `> 0`) is correct and is what lets `0.5` reach the floor logic (where the new `>= 1` guard catches it). The `> 0` gate and the `>= 1` floor guard are TWO layers, both needed (GOTCHA #2).
- ❌ Don't extract a temp variable (e.g. `const floored = Math.floor(n)`) "to avoid computing floor twice" — maxRetriesPerPrompt line 249 computes it twice deliberately for a one-line readable ternary; mirror it verbatim. A refactor here would diverge from the established sibling pattern.
- ❌ Don't assert a warn for the `0.5` test — `0.5` passes coerceNumber (no warn) and the `>= 1` guard falls back silently. Asserting a warn would be a false test (it would fail). Assert `toBe(3)` and (optionally) `expect(warn).not.toHaveBeenCalled()` (GOTCHA #1).
- ❌ Don't skip the regression test because "it's a one-line fix" — the `0.5 → 0` bug is currently UNTESTED; without the test the guard can silently regress later. The test is the lock-in (GOTCHA #4).