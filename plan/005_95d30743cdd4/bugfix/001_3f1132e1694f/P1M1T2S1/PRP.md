# PRP — P1.M1.T2.S1: `Math.floor >= 1` guard on `shrink.maxActive` & `shrink.staleAfterFires` in `validateConfig` (BUG-003 fix)

---

## Goal

**Feature Goal**: Close the BUG-003 config-validation gap where `shrink.maxActive` and `shrink.staleAfterFires` accept a fractional value in `(0,1)` (e.g. `0.5`) **verbatim**, producing a degenerate soft cap (one active shrink auto-retired immediately) and a degenerate auto-retire threshold (pinned shrink retired after a single miss). Expand each single-line `coerceNumber(..., true)` assignment into the multi-line block form that floors and guards `>= 1` — **exactly mirroring the already-correct `rewind.maxRetriesPerPrompt` knob** (lines 247–250).

**Deliverable**: 
1. `src/config.ts` (MODIFY) — rewrite the `maxActive` and `staleAfterFires` branches (lines 266–269) from single-line assignments into the 3-line `const n` + floored-`>= 1` block (mirroring `maxRetriesPerPrompt`). Optionally tighten the two fields' JSDoc (Mode A docs).
2. `test/config.test.ts` (MODIFY) — add two regression tests in the existing `shrink.maxActive & shrink.staleAfterFires` describe block (line 234): `maxActive: 0.5 → 32` and `staleAfterFires: 0.5 → 3` (both SILENT — zero warns).

**Success Definition**:
- `validateConfig({ shrink: { maxActive: 0.5 } }).shrink.maxActive === 32` (was `0.5` before the fix).
- `validateConfig({ shrink: { staleAfterFires: 0.5 } }).shrink.staleAfterFires === 3` (was `0.5` before the fix).
- `validateConfig({ shrink: { maxActive: 10.9 } }).shrink.maxActive === 10` (unchanged — floors to a valid `>= 1` integer).
- `npx vitest run test/config.test.ts` — all pass (existing integer/invalid tests unaffected; 2 new fractional tests green).
- `npx vitest run` — full suite passes.
- `npx tsc --noEmit` — no new errors from the touched files.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and any user who misconfigures `maxActive`/`staleAfterFires` with a fraction; indirectly the shrink subsystem (filter.ts `contextHandler`).

**Use Case**: A user sets `"mulligan": { "shrink": { "maxActive": 0.5 } }` (typo / misunderstanding). The validator must not accept a value that collapses the soft cap or the auto-retire threshold.

**User Journey**: User sets `maxActive: 0.5` → `validateConfig` now floors + guards → `0.5` floors to `0`, `0 < 1` → silent fallback to `32` → `filter.ts` `markers.shrinks.length > 32` behaves as designed.

**Pain Points Addressed**: A fractional `maxActive` made `1 > 0.5` true → oldest shrink auto-retired with a single active marker. A fractional `staleAfterFires` made `1 >= 0.5` true → pinned shrink retired after one miss instead of three. Both silently broke the shrink lifecycle with no diagnostic.

## Why

- **Business value / user impact**: Minor. No built-in default triggers it (`maxActive` default `32`, `staleAfterFires` default `3`); only a misconfigured fractional value does. But it is a genuine validation gap: a value the validator ACCEPTS produces functionally-broken shrink behavior with no warning, and it diverges from the sibling integer knobs (`maxRetriesPerPrompt` correct; `driftWindowTurns` fixed by the parallel BUG-002 task).
- **Integration with existing features**: `maxActive` feeds `filter.ts:411` `markers.shrinks.length > config.shrink.maxActive`; `staleAfterFires` feeds `filter.ts:401` `misses >= config.shrink.staleAfterFires`. Both comparisons are integer-threshold semantics. The fix is purely upstream (validation); `filter.ts` is unchanged — it already treats both as positive integers.
- **Problems this solves and for whom**: BUG-003 (Minor). For maintainers: consistent integer validation across the three `Math.floor`-gated knobs (`maxRetriesPerPrompt` already correct; `driftWindowTurns` = sibling BUG-002; `maxActive`/`staleAfterFires` fixed here).
- **Scope boundary (CRITICAL)**: This task is `shrink.maxActive` + `shrink.staleAfterFires` ONLY (BUG-003). The sibling `driftWindowTurns` (BUG-002) is P1.M1.T1.S1 — a SEPARATE task running in parallel. The two edits touch DIFFERENT branches (shrink vs nudges) with NO textual overlap, and the sibling's edit adds no lines, so the line numbers in this PRP stay valid.

## What

User-visible behavior: none for the shipped default config. For a misconfigured fractional `maxActive`/`staleAfterFires` in `(0,1)`, the validator now silently floors + falls back to the default instead of storing the fraction. The shrink soft cap and auto-retire threshold then behave as designed.

### Success Criteria

- [ ] `src/config.ts` lines 266–269: each of `maxActive` and `staleAfterFires` is a 3-line block (`const n = coerceNumber(...)`; assignment `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.X`), EXACTLY mirroring `maxRetriesPerPrompt` (lines 247–250).
- [ ] Regression tests assert `0.5 → 32` (maxActive) and `0.5 → 3` (staleAfterFires), both SILENT (zero warns).
- [ ] The existing `10 → 10`, `5 → 5`, `1 → 1`, and `{0,-1,NaN,'abc',Infinity} → default + 1 warn` tests still pass.
- [ ] `shrink.notifyMaxChars` (line ~270) is UNCHANGED (it is a char-size cap, legitimately any positive number — NOT an integer-count knob; leave at `coerceNumber(..., true)` only).
- [ ] `rewind.maxRetriesPerPrompt` (247–250) and `nudges.driftWindowTurns` (~288) are UNCHANGED.
- [ ] `npx vitest run test/config.test.ts`, `npx vitest run`, `npx tsc --noEmit` all pass (no new errors).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim buggy lines (266–269), the verbatim precedent to mirror (247–250), the verbatim fixed code for both branches, the exact tests to add with their insertion point, the coerceNumber trace explaining the silent fallback, and confirmation no existing test breaks. No external documentation is required.

### Documentation & References

```yaml
# MUST READ — the file being fixed (bug site + precedent in the same file)
- file: src/config.ts
  why: "THE file. BUGGY shrink branch = lines 266–269 (single-line coerceNumber assignments, NO Math.floor). CORRECT precedent = rewind.maxRetriesPerPrompt at lines 247–250 (the 3-line const-n + floored->=1 block to mirror EXACTLY)."
  pattern: "BUGGY (266–269): `v = safeGet(shrinkRaw,'maxActive'); if (v !== undefined) cfg.shrink.maxActive = coerceNumber('shrink.maxActive', v, cfg.shrink.maxActive, true);` (same shape for staleAfterFires).
            PRECEDENT (247–250): `v = safeGet(rewindRaw,'maxRetriesPerPrompt'); if (v !== undefined) { const n = coerceNumber('rewind.maxRetriesPerPrompt', v, cfg.rewind.maxRetriesPerPrompt, true); cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt; }`."
  gotcha: "coerceNumber('…', v, default, true) returns v if finite & > 0 (NO warn) else default WITH warnConfig. So 0.5 passes (>0, no warn) → n=0.5 → Math.floor=0 → 0>=1 false → SILENT fallback to default. Do NOT add warnConfig — mirror maxRetriesPerPrompt EXACTLY (it falls back silently too)."

# MUST READ — the downstream consumer the bug breaks
- file: src/filter.ts
  why: "Confirms WHY a fractional value is degenerate. contextHandler line 411: `markers.shrinks.length > config.shrink.maxActive` → `1 > 0.5` true → oldest shrink auto-retired with ONE active marker. Line 401: `misses >= config.shrink.staleAfterFires` → `1 >= 0.5` → pinned shrink retired after a SINGLE miss (default 3). Read to confirm the impact; DO NOT modify filter.ts (it already handles positive integers correctly)."
  critical: "Both comparisons are integer-threshold semantics (`>` and `>=`). Flooring config to >= 1 is the correct upstream fix; filter.ts needs no change."

# MUST READ — the test file
- file: test/config.test.ts
  why: "THE test file. The describe block at line 234: 'shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)'. Existing cases: (a) 10/5 pass-through; (b) round-trip defaults; (c) 1/1 edge; (d) enabled:false; (e) invalid maxActive {0,-1,NaN,'abc',Infinity}→32+1 warn; (f) invalid staleAfterFires→3+1 warn; (g) 0/-1; (h) autoOnBloat dropped. vi.mock for warnConfig is already set up — the `warn` spy is asserted at line 270 `warn.mock.calls[0][0]`."
  pattern: "Existing (e)/(f) are the template for the invalid-value assertion shape; the NEW tests reuse the same validateConfig({shrink:{…}}) call + toBe() + warn spy, but assert the SILENT path (warn NOT called)."
  critical: "NO existing test breaks. (a)/(c) use integers >=1 (unaffected). (e)/(f) use {0,-1,NaN,'abc',Infinity} which fail coerceNumber's >0 gate (warn+default) before the floor ever sees them (unaffected). The 0.5 case is UNTESTED today — that is the whole point of the 2 new tests. For 0.5, assert ZERO warns (silent fallback), unlike (e)/(f) which assert exactly 1 warn."

# MUST READ — the confirmed bug write-up
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  why: "§BUG-003 (Status CONFIRMED) gives the verbatim buggy lines (266–269), the filter.ts impact traces (1>0.5, 1>=0.5), and the inconsistency note (driftWindowTurns floors via BUG-002; maxRetriesPerPrompt floors >=1; maxActive/staleAfterFires have NO flooring). Read §BUG-003 ONLY — BUG-004 (transforms.ts) is a SEPARATE task, out of scope."
  critical: "Confirms the minimal fix = apply the maxRetriesPerPrompt guard to BOTH knobs. Lists ONLY maxActive + staleAfterFires (notifyMaxChars is correctly NOT listed — it is a char-size cap, not an integer-count knob)."

# CONTEXT — the sibling task's contract (parallel, different branch, no collision)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M1T1S1/PRP.md
  why: "CONTRACT for BUG-002 (driftWindowTurns). Confirms it edits the NUDGES branch (~line 288) ONLY, as a single token insertion into an EXISTING 2-line form (no line-count change). My task edits the SHRINK branch (266–269, EARLIER in the file) — no textual overlap, no line-number drift."
  critical: "Do NOT touch driftWindowTurns (T1.S1 owns it). Do NOT assume T1.S1 is merged — my line numbers (266–269) are valid independently because T1.S1's edit adds/removes no lines."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  config.ts   # ← MODIFY: shrink branch lines 266–269 (maxActive + staleAfterFires); optional JSDoc on both fields (~59–66)
  filter.ts   # ← READ-ONLY downstream consumer (lines 401, 411 — the comparisons a fraction breaks)
test/
  config.test.ts   # ← ADD 2 regression tests (0.5→32, 0.5→3) in the shrink describe block (line 234)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly two existing files:
src/config.ts        # shrink.maxActive + shrink.staleAfterFires branches (266–269) → floored >=1 block form; optional JSDoc
test/config.test.ts  # +2 it(...) tests (0.5 → default, silent) in the shrink describe block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (EXPAND to multi-line, don't just insert a token).
//   Unlike BUG-002's driftWindowTurns (which already had `const n` + Math.floor, only missing `>= 1`),
//   maxActive/staleAfterFires are SINGLE-LINE `if (v !== undefined) cfg.shrink.X = coerceNumber(..., true);`.
//   The fix EXPANDS each into the 3-line block: add the `const n = coerceNumber(...)` line, then the
//   assignment `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.X`, wrapped in braces.
//   Mirror maxRetriesPerPrompt (247–250) character-for-character (substitute name/label/default).

// CRITICAL GOTCHA #2 (the >= 1 guard must be SILENT — no warnConfig). coerceNumber(name, v, default, true)
//   returns 0.5 unchanged (0.5 > 0, no warn). The fix's fallback branch keeps the default WITHOUT warning.
//   This EXACTLY mirrors maxRetriesPerPrompt (line 249), which also silently falls back when floor < 1.
//   Do NOT add a warnConfig("shrink.maxActive", v) call — that would diverge from the established sibling
//   pattern AND break existing tests' warn-count expectations. Consistency with maxRetriesPerPrompt wins.

// CRITICAL GOTCHA #3 (why 0.5 reaches the floor logic at all). coerceNumber's `true` 4th arg requires `> 0`,
//   NOT `>= 1`. So 0.5 PASSES coerceNumber (it is > 0) and reaches Math.floor(0.5)===0. The integers 0/-1
//   and NaN/non-numbers/'abc'/Infinity are rejected EARLIER by coerceNumber (not > 0) → they warn + return
//   default, never reaching the floor. That is why existing tests (e)/(f) {0,-1,NaN,...} still pass
//   unchanged, and why the 0.5 case is the ONLY one the >= 1 guard newly affects (silently).

// CRITICAL GOTCHA #4 (scope: ONLY maxActive + staleAfterFires). Do NOT touch:
//   - driftWindowTurns (~288) — sibling BUG-002 (P1.M1.T1.S1, parallel). Different branch; no collision.
//   - maxRetriesPerPrompt (247–250) — already correct (the precedent you mirror).
//   - notifyMaxChars (~270) — legitimately a char-size cap (any positive number; NOT an integer-count knob).
//     The bug doc lists ONLY maxActive + staleAfterFires. Flooring notifyMaxChars would be WRONG.
//   Scope creep here crosses task boundaries and risks merge conflicts with the parallel sibling task.

// CRITICAL GOTCHA #5 (preserve the `if (v !== undefined)` wrapper + the `v = safeGet(...)` line).
//   The `v` variable is shared across the whole validateConfig body (declared once near the top). Each knob
//   does `v = safeGet(shrinkRaw, "X"); if (v !== undefined) { … }`. The fix keeps both lines and only
//   changes the assignment inside the `if` (expanding it to the 2-line const-n + guarded-assignment form).

// CRITICAL GOTCHA #6 (no existing test breaks — verify, don't assume). The fix only changes behavior for
//   values in (0,1) that are finite and > 0. Existing tests probe: integers (10, 5, 1), round-trips, and
//   hard-invalid values ({0,-1,NaN,'abc',Infinity} → default + warn). None land in the (0,1) range, so all
//   stay green. The NEW behavior is the 0.5 → default case, which is UNTESTED today — add it.

// CRITICAL GOTCHA #7 (mirror the duplicated Math.floor deliberately — do NOT extract a temp).
//   maxRetriesPerPrompt line 249 computes Math.floor(n) TWICE (once in the condition, once in the true-
//   branch) for a one-line readable ternary. Mirror that EXACTLY (do not write `const floored = …`). A
//   refactor here would diverge from the established sibling pattern.
```

---

## Implementation Blueprint

### Data models and structure

**No data-model changes.** Both fields stay `number` in `MulliganConfig`; defaults stay `32` / `3`. The fix is purely a validation-predicate tightening (adds `const n` + the floored `>= 1` guard to each assignment), bringing two knobs into line with `maxRetriesPerPrompt`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: FIX src/config.ts lines 266–267 — expand maxActive to the floored >= 1 block
  - LOCATE (verbatim, the buggy single-line form):
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
  - REPLACE WITH (EXACT mirror of maxRetriesPerPrompt lines 247–250, substituting names):
      v = safeGet(shrinkRaw, "maxActive");
      if (v !== undefined) {
        const n = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
        cfg.shrink.maxActive = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.maxActive;
      }
  - PRESERVE: the `v = safeGet(...)` line, the `if (v !== undefined)` guard (now wrapping a block), and the
    coerceNumber 4th-arg `true` (require > 0 — the FIRST layer; the >= 1 floor is the SECOND layer; both needed).
  - GOTCHA: this is an EXPANSION (1 assignment line → 3 lines), NOT a token insertion. (GOTCHA #1, #5, #7.)
  - DEPENDENCIES: none.

Task 2: FIX src/config.ts lines 268–269 — expand staleAfterFires to the floored >= 1 block
  - LOCATE (verbatim):
      v = safeGet(shrinkRaw, "staleAfterFires");
      if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
  - REPLACE WITH:
      v = safeGet(shrinkRaw, "staleAfterFires");
      if (v !== undefined) {
        const n = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
        cfg.shrink.staleAfterFires = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.staleAfterFires;
      }
  - PRESERVE: same as Task 1. The ONLY differences from Task 1 are the field name, the coerceNumber label,
    and the default-ref (`cfg.shrink.staleAfterFires`).
  - GOTCHA: keep `const n` in EACH block (do not share — they are separate `if` scopes). Two separate `n`s.
  - DEPENDENCIES: none (independent of Task 1; both may be applied in one edit pass).

Task 3 (OPTIONAL — Mode A docs): tighten the JSDoc on both MulliganConfig.shrink fields (~lines 59–66)
  - maxActive JSDoc currently ends: `… Mirrors rewind.maxDepth as a bound on marker accumulation. Must be > 0. Default: 32. …`
    CHANGE "Must be > 0." → "Positive integer (>= 1; fractional values that floor below 1 fall back to the default)."
  - staleAfterFires JSDoc currently has: `… for this many consecutive fires. Must be > 0. Default: 3. …`
    CHANGE "Must be > 0." → "Positive integer (>= 1; fractional values that floor below 1 fall back to the default)."
  - GOTCHA: JSDoc COMMENT only — do not change the field type (`number`) or default (32 / 3). Locate both in the
    MulliganConfig interface's `shrink` sub-object.
  - DEPENDENCIES: none (rides with Tasks 1–2).

Task 4: ADD 2 regression tests to test/config.test.ts (shrink describe block, line 234)
  - LOCATE the describe: "shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)" (line 234).
    Existing cases (a)–(h) + (type). Insert the new cases AFTER the existing floor-relevant tests (after (c) the
    `1 → 1` edge case is a good neighbor, or grouped near (e)/(f) the invalid tests — either reads cleanly).
  - ADD:
      it("(g-bis) maxActive fractional value that floors below 1 (0.5) → falls back to default 32, SILENT (BUG-003)", () => {
        const cfg = validateConfig({ shrink: { maxActive: 0.5 } });
        expect(cfg.shrink.maxActive).toBe(32); // Math.floor(0.5)===0, 0 < 1 → default (was 0.5 before the fix)
        expect(warn).not.toHaveBeenCalled();   // silent fallback, matching maxRetriesPerPrompt (GOTCHA #2)
      });

      it("(g-ter) staleAfterFires fractional value that floors below 1 (0.5) → falls back to default 3, SILENT (BUG-003)", () => {
        const cfg = validateConfig({ shrink: { staleAfterFires: 0.5 } });
        expect(cfg.shrink.staleAfterFires).toBe(3); // Math.floor(0.5)===0, 0 < 1 → default (was 0.5 before the fix)
        expect(warn).not.toHaveBeenCalled();         // silent fallback
      });
  - NAMING: titles name BUG-003 + the 0.5 input + the SILENT expectation (mirrors the explanatory titles in the block).
  - GOTCHA (warn assertion): 0.5 PASSES coerceNumber's >0 gate (no warn), then the >= 1 guard falls back
    SILENTLY (no warn). So assert `expect(warn).not.toHaveBeenCalled()` — the OPPOSITE of (e)/(f) which assert
    exactly 1 warn. The `warn` spy is already in scope (vi.mock for warnConfig is file-level; see line 270).
    If the spy's exact name differs in this describe, match the existing (e)/(f) usage verbatim.
  - GOTCHA: do NOT modify (a)/(c)/(e)/(f) — they must stay green. (c) 1→1 still passes (1>=1 kept). (e)/(f)
    {0,-1,NaN,...} still warn+default (rejected by coerceNumber >0 before the floor). (GOTCHA #3, #6.)
  - DEPENDENCIES: Tasks 1–2 (the fix must be in place — the 0.5 tests FAIL before it, which is the TDD red step).

Task 5: VALIDATE (no new code)
  - RUN `npx vitest run test/config.test.ts` → all pass (2 new tests green; existing (a)–(h) unchanged).
  - RUN `npx vitest run` → full suite passes (no regressions; filter.ts/nudges.ts tests unaffected — they pass valid configs).
  - RUN `npx tsc --noEmit` → no new errors (the change swaps a single-line assignment for a typed block; types are
    unchanged — `coerceNumber(...)` returns `number`, `Math.floor(number)` returns `number`). Any pre-existing
    errors elsewhere are out of scope.
  - DEPENDENCIES: Tasks 1–4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Tasks 1–2): EXPAND the single-line assignment into the floored >= 1 block (mirror maxRetriesPerPrompt).
//   BEFORE (buggy, 1 line):  if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
//   AFTER  (fixed, 3 lines):
//     if (v !== undefined) {
//       const n = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
//       cfg.shrink.maxActive = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.maxActive;
//     }
//   The ADDED text is: the `{`, the `const n = …` line, the guarded assignment (vs the bare coerceNumber call),
//   and the `}`. Mirror lines 247–250 character-for-character (substitute field name / label / default ref).

// PATTERN (Task 4): the regression tests isolate the (0,1) fractional range the guard newly affects.
//   validateConfig({ shrink: { maxActive: 0.5 } }).shrink.maxActive === 32
//   Trace: coerceNumber(0.5, default, true) → 0.5 (>0, no warn) → n=0.5 → Math.floor(0.5)=0 → 0>=1 FALSE → default 32.
//   Before the fix: 0.5 stored VERBATIM (BUG — 1 > 0.5 retires the oldest shrink immediately). After: → 32 (FIXED).
//   The warn assertion `expect(warn).not.toHaveBeenCalled()` documents the SILENT-fallback contract.

// CRITICAL: do not confuse this with BUG-002 (driftWindowTurns) or notifyMaxChars.
//   - driftWindowTurns (~288): sibling task P1.M1.T1.S1 — DO NOT TOUCH (different branch; parallel).
//   - notifyMaxChars (~270): legitimately any positive number (char-size cap) — leave at coerceNumber(…, true) only.
//   This subtask floors + guards ONLY maxActive + staleAfterFires.
```

### Integration Points

```yaml
CODE:
  - modify: src/config.ts lines 266–269 (maxActive + staleAfterFires branches → floored >=1 block); optional JSDoc on both fields
  - untouched: filter.ts (lines 401/411 already treat both as positive integers), nudges.ts, all tools,
    all other config branches (notifyMaxChars, maxRetriesPerPrompt, driftWindowTurns, bloatThresholdBytes, etc.)
TESTS:
  - add: test/config.test.ts — two it(...) in the shrink describe block (0.5→32 silent, 0.5→3 silent)
  - untouched: all other tests (existing integer/invalid cases stay green)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No new config field, no default change (32 / 3), no registration.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no new errors from src/config.ts. The change replaces a single-line `cfg.shrink.X = coerceNumber(...)`
# (number) with a 3-line block whose assignment is `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : default`
# (number). Types are unchanged. Common mistake: accidentally editing notifyMaxChars (~270), maxRetriesPerPrompt
# (247–250), or driftWindowTurns (~288) — re-read the diff to confirm ONLY lines 266–269 changed.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The config test file — fast feedback on the validation change.
npx vitest run test/config.test.ts
# EXPECTED: all pass. New tests: 0.5→32 and 0.5→3 (green after fix; were the bug). Existing (a)/(c) integer cases
# and (e)/(f) invalid cases unchanged. If 0.5→32 FAILS with received=0.5, the fix on lines 266–267 wasn't applied
# (re-check Task 1). If a warn-assertion fails (warn WAS called), you accidentally added a warnConfig (GOTCHA #2).

# Full suite — confirm no regression in the shrink subsystem tests (filter.ts/nudges.ts pass valid configs).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: validateConfig is a pure function exercised directly by the unit tests. There is no live
# runtime seam to exercise for a predicate-tightening change. (End-to-end "does the shrink soft cap behave" is
# already covered by filter.ts tests that pass valid integer configs.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green confirmation (optional — proves the tests actually guard the behavior):
#   1. BEFORE applying Tasks 1–2: run `npx vitest run test/config.test.ts` with ONLY the 2 new 0.5 tests added →
#      they FAIL (received 0.5, expected 32/3). This is the red step confirming the bug reproduces.
#   2. Apply Tasks 1–2 → re-run → PASS (green). The red→green transition is the proof the tests lock in the fix.

# Grep sanity (confirm the block form landed and the bare form is gone):
grep -n 'shrink.maxActive\|shrink.staleAfterFires' src/config.ts
# EXPECTED: each appears in a `const n = coerceNumber(...)` line AND a guarded assignment line (NOT a bare
# `cfg.shrink.X = coerceNumber(...)` one-liner).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — no new errors from `src/config.ts` / `test/config.test.ts`.
- [ ] `npx vitest run test/config.test.ts` — all pass (2 new 0.5→default tests green).
- [ ] `npx vitest run` — full suite passes.

### Feature Validation
- [ ] `validateConfig({ shrink: { maxActive: 0.5 } }).shrink.maxActive === 32`.
- [ ] `validateConfig({ shrink: { staleAfterFires: 0.5 } }).shrink.staleAfterFires === 3`.
- [ ] `validateConfig({ shrink: { maxActive: 10.9 } }).shrink.maxActive === 10` (unchanged — floors to a valid `>= 1` integer).
- [ ] `validateConfig({ shrink: { maxActive: 0 } }).shrink.maxActive === 32` (unchanged — still rejected by coerceNumber's >0 gate + 1 warn).
- [ ] Both branches (266–269) read the 3-line `const n` + `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.shrink.X` form, mirroring `maxRetriesPerPrompt` (247–250).

### Code Quality Validation
- [ ] Both guards EXACTLY mirror `maxRetriesPerPrompt` (247–250) — same `const n` + floored-`>= 1` ternary shape.
- [ ] The fallback is SILENT (no `warnConfig` added) — matching the sibling pattern.
- [ ] Only `src/config.ts` (lines 266–269 + optional JSDoc) and `test/config.test.ts` (2 tests) are modified — NO changes to filter.ts, nudges.ts, tools, or other config branches.
- [ ] `notifyMaxChars` (~270), `maxRetriesPerPrompt` (247–250), and `driftWindowTurns` (~288) are UNCHANGED.
- [ ] BUG-002 (driftWindowTurns) is NOT touched here (it's P1.M1.T1.S1).

### Documentation & Deployment
- [ ] Optional JSDoc touch on `maxActive` + `staleAfterFires` reflects ">= 1" (Mode A — rides with the code if done).
- [ ] No README/spec change in this subtask (changeset doc sync is a separate task).

---

## Anti-Patterns to Avoid

- ❌ Don't just insert `&& Math.floor(n) >= 1` into the existing line — maxActive/staleAfterFires have NO `const n` and NO Math.floor yet (unlike driftWindowTurns). EXPAND each to the 3-line block form mirroring maxRetriesPerPrompt (GOTCHA #1).
- ❌ Don't add a `warnConfig` call on the fallback branch — the contract is "EXACT same pattern as maxRetriesPerPrompt", which falls back SILENTLY (GOTCHA #2). Adding a warn diverges from the sibling and breaks the new tests' `expect(warn).not.toHaveBeenCalled()`.
- ❌ Don't "fix" `driftWindowTurns` (BUG-002) — that's P1.M1.T1.S1 (parallel, different branch). Touching it here is scope creep that crosses a task boundary (GOTCHA #4).
- ❌ Don't floor `notifyMaxChars` — it is a char-size cap (legitimately any positive number), NOT an integer-count knob. The bug doc lists ONLY maxActive + staleAfterFires (GOTCHA #4).
- ❌ Don't change `coerceNumber`'s 4th-arg `true` — `true` (require `> 0`) is the FIRST layer; the `>= 1` floor is the SECOND. Both are needed (GOTCHA #3).
- ❌ Don't extract a temp variable (`const floored = Math.floor(n)`) "to avoid computing floor twice" — maxRetriesPerPrompt computes it twice deliberately; mirror it verbatim (GOTCHA #7).
- ❌ Don't assert a warn for the `0.5` tests — `0.5` passes coerceNumber (no warn) and the `>= 1` guard falls back silently. Assert `toBe(default)` AND `expect(warn).not.toHaveBeenCalled()` (GOTCHA #2, #6).
- ❌ Don't share one `const n` across both knobs — they are separate `if (v !== undefined)` scopes; each gets its own `n` (Task 2 GOTCHA).
- ❌ Don't skip the regression tests because "it's a small fix" — the `0.5 → 0.5` bug is currently UNTESTED; without the tests the guards can silently regress later (GOTCHA #6).

---

## Decision Log

- **D1 — EXPAND to the multi-line block, mirroring maxRetriesPerPrompt verbatim.** Unlike BUG-002's `driftWindowTurns` (which already had `const n` + `Math.floor` and only lacked `>= 1`), `maxActive`/`staleAfterFires` are single-line `coerceNumber(..., true)` assignments. The correct, consistent fix is to bring them into the exact shape of the already-correct `maxRetriesPerPrompt` (lines 247–250): `const n` + `Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : default`. This maximizes cross-knob consistency (the explicit goal of BUG-002/BUG-003 per the bug doc's "Inconsistency" note) and makes future readers see one canonical integer-validation idiom.

- **D2 — SILENT fallback (no warnConfig), matching maxRetriesPerPrompt.** `coerceNumber(..., true)` already warns for hard-invalid values (0, -1, NaN, non-numbers). A fractional `(0,1)` value passes that gate (it is `> 0`), so the `>= 1` floor is a SECOND, silent safety net — exactly as `maxRetriesPerPrompt` behaves. Adding a diagnostic here would diverge from the sibling and break the existing warn-count semantics. Consistency with the established pattern is the contract.

- **D3 — Scope = maxActive + staleAfterFires ONLY; notifyMaxChars excluded.** The bug doc (`bug_verification.md §BUG-003`) lists exactly these two knobs. `notifyMaxChars` is a character-cap on operator-echo text (any positive number is legitimate; flooring it would be semantically wrong), so it correctly stays at `coerceNumber(..., true)` alone. `maxRetriesPerPrompt` (already correct) and `driftWindowTurns` (sibling BUG-002 task) are out of scope. This keeps the change minimal and avoids crossing the parallel task boundary.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a small, mechanical fix (expand two single-line assignments into the verbatim `maxRetriesPerPrompt` block form) backed by: (a) the in-file precedent to mirror character-for-character (lines 247–250), (b) the confirmed bug write-up with verbatim buggy lines + downstream impact traces, (c) the coerceNumber trace explaining the silent `(0,1)` fallback, (d) the exact test insertion point + assertion shape, and (e) confirmation no existing test breaks. Residual risks: (1) accidentally touching `notifyMaxChars`/`driftWindowTurns` (mitigated by GOTCHA #4 + the Level-1/Level-4 greps); (2) the warn-assertion direction (mitigated by GOTCHA #2/#3 + the explicit `expect(warn).not.toHaveBeenCalled()` in the test).