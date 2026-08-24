# PRP — P1.M3.T1.S1: Replace the prescribing tail with the awareness-only tail + update FORMAT JSDoc

## Goal

**Feature Goal**: `renderDriftNudge` (src/notes.ts) must emit the v2.0 **awareness-only** tail instead of the current tail that prescribes `mulligan_rewind`/`mulligan_shrink` on the *previous* (now out-of-scope) turn, and its FORMAT JSDoc must move in lockstep.

**Deliverable**: A modified `renderDriftNudge` function + updated FORMAT JSDoc block in `src/notes.ts`. No other file changes.

**Success Definition**: `renderDriftNudge` returns `` `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.` `` for all three lead variants, with all existing invariants preserved (single physical line, no `\n`, no `[mulligan]` prefix, no trailing newline). `tsc --noEmit` passes. (Test updates belong to P1.M3.T1.S2 — see Validation.)

## Why

Under v2.0 current-turn scoping (spec/05 §2), the drift nudge fires at the *next* inference about the *previous* turn's growth — that turn is already out of modification scope, so prescribing `mulligan_rewind`/`mulligan_shrink` on it violates the scoping contract. The message must be awareness + forward-looking advice only. Nudge A (`renderBloatReminder`, src/notes.ts:~278-282) is the only prescribing nudge and is **untouched** (it rides the result inside the producing turn, when the shrink is still issuable). Spec reference: PRD §2 (Nudge B) v2.0 note and §2 `renderDriftNudge` v2.0 block; also PRD §6 (awareness-only clause).

## What

- Change **only** the fixed tail on the return line of `renderDriftNudge` (currently src/notes.ts:337):

  **Current**:
  ```ts
  return `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`;
  ```

  **New** (exact spec/07 §2 v2.0 text — note the **em-dash** `—`, not a hyphen):
  ```ts
  return `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`;
  ```

- The three lead variants and the optional sustained clause are **UNCHANGED**:
  - delta lead: `` Previous turn added ~<k> tokens to your context `` (with optional ` (sustained over the last N turns)` when `sustainedN > 0 && delta < LARGE_SINGLE_TURN_DELTA` (=4000))
  - bloat-fallback lead: `Previous turn produced <N> bloated <result|results>`
  - totality fallback lead: `Previous turn changed your context`
- Update the **FORMAT JSDoc block** (currently lines 288-297, the `FORMAT (spec/07 §2 — VERBATIM; ...)` paragraph) to quote the new tail and cite spec/07 §2 v2.0 (awareness-only; the reported turn is out of modification scope under current-turn scoping; Nudge A is the only prescribing nudge).
- **DO NOT touch**: `renderBloatReminder`, `shouldNudge`, `injectNudge` (src/nudges.ts:~395 treats the rendered line as opaque), windowing, high-water logic, suppression, or any other function. **DO NOT update tests** — that is P1.M3.T1.S2's entire scope.

### Success Criteria

- [ ] `renderDriftNudge` output for delta lead: `Previous turn added ~4.2k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
- [ ] Bloat-fallback lead: `Previous turn produced 2 bloated results. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
- [ ] Totality fallback: `Previous turn changed your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
- [ ] Output contains no `\n`, no `[mulligan]` prefix, no trailing newline, and no `mulligan_rewind`/`mulligan_shrink` mention
- [ ] FORMAT JSDoc quotes the new tail verbatim and cites spec/07 §2 v2.0 + awareness-only rationale
- [ ] `npm run typecheck` passes
- [ ] No changes outside the `renderDriftNudge` return line + its JSDoc FORMAT paragraph (and, if needed, the one JSDoc sentence describing the tail)

## All Needed Context

### Context Completeness Check

This is a two-line surgical edit to one pure function. The implementing agent needs: exact current text, exact new text (em-dash!), the invariants, and what NOT to touch. All provided below.

### Documentation & References

```yaml
- file: src/notes.ts
  why: renderDriftNudge (~line 310-338) + its FORMAT JSDoc (~288-297) — the only edit site
  pattern: pure renderer; readDelta/readBloatHits/readSustainedTurns defensive guards stay as-is
  gotcha: renderBloatReminder above it is UNTOUCHED; LARGE_SINGLE_TURN_DELTA=4000 unchanged

- file: src/nudges.ts
  why: injectNudge (~line 395) consumes the rendered line as opaque — zero changes needed there
  gotcha: do NOT edit nudges.ts

- docfile: plan/008_1c8ca4d1826d/prd_snapshot.md (§2 "Nudge B", §6)
  why: v2.0 awareness-only mandate + the exact new tail text
```

### Current Codebase tree (relevant excerpt)

```bash
src/notes.ts          # renderBloatReminder (:~278), renderDriftNudge (:~310-338), FORMAT JSDoc (:~288-297)
src/nudges.ts         # injectNudge (:~395) — opaque consumer
test/notes.ts         # asserts old tail (:~396, :~646, :~660) — S2's job to update, NOT yours
test/drift_nudge.test.ts  # asserts old tail (:~243, :~250) — S2's job
```

### Known Gotchas

```python
# CRITICAL: the new tail uses an EM-DASH "—" (U+2014), not a hyphen "-" and not "--". Copy it exactly.
# CRITICAL: the tail is interpolated into a template literal — apostrophe in "turn's" is fine inside backticks.
# GOTCHA: vitest WILL fail on test/notes.ts and test/drift_nudge.test.ts after this change (they pin the old
#   tail). That is EXPECTED and correct — updating those tests is exactly P1.M3.T1.S2's scope. Do not "fix"
#   them here and do not be alarmed by the failures; typecheck is this item's validation gate.
```

## Implementation Blueprint

Single task, no dependencies:

```yaml
Task 1: MODIFY src/notes.ts (two spots)
  - EDIT A (return line, ~:337): replace
      return `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`;
    with
      return `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`;
  - EDIT B (FORMAT JSDoc paragraph, ~:288-297): rewrite the "FORMAT (spec/07 §2 ...)" block to quote the new
    tail: "<lead>. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results
    as you produce them." and add the v2.0 rationale: awareness-only (spec/07 §2 v2.0); the reported turn is out
    of modification scope under current-turn scoping (spec/05 §2), so the nudge must not prescribe
    rewind/shrink of past content; Nudge A is the only prescribing nudge. Also update the JSDoc sentence
    (currently "The tail is a terse 'If wasteful, … to undo / compact a result.' suggestion;") to describe the
    new forward-looking tail. PRESERVE all other FORMAT invariants verbatim in the JSDoc: single physical line,
    NO embedded "\n", NO [mulligan] prefix, NO trailing newline, 3-branch lead selection unchanged.
```

No data models, no integration points, no config.

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck    # tsc --noEmit — must pass
npx tsc --noEmit     # equivalent direct invocation
```

### Level 2: Verify the rendered output (read-only spot check, no file changes)

```bash
node --experimental-strip-types -e '
import("./src/notes.ts").then(m => {
  console.log(JSON.stringify(m.renderDriftNudge({deltaTokens: 4200, bloatHits: []})));
  console.log(JSON.stringify(m.renderDriftNudge({deltaTokens: null, bloatHits: [{},{}]})));
});'
# Expected (respectively):
# "Previous turn added ~4.2k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them."
# "Previous turn produced 2 bloated results. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them."
# (If the module graph requires compilation, alternatively inspect by grep: the new tail string must appear verbatim in src/notes.ts, and "If wasteful" must NOT appear anywhere in src/notes.ts.)
```

```bash
grep -c "If wasteful" src/notes.ts          # Expected: 0
grep -c "Keep this turn's outputs lean — pipe large command output" src/notes.ts  # Expected: >= 2 (code + JSDoc)
grep -rn "mulligan_rewind" src/notes.ts | grep -v Bloat | grep -v bloat   # Expected: no renderDriftNudge remnants
```

### Level 3: Unit Tests — EXPECTED to fail (S2 scope)

`npm test` will show failures in `test/notes.ts` and `test/drift_nudge.test.ts` (they pin the old tail). This is intentional: P1.M3.T1.S2 updates exactly those assertions plus adds the negative no-prescription assertion. Confirm the failures are ONLY old-tail string mismatches, nothing else:

```bash
npx vitest run test/notes.ts test/drift_nudge.test.ts 2>&1 | grep -E "expected|FAIL"
```

## Final Validation Checklist

- [ ] New tail string appears verbatim (em-dash) in the return line and FORMAT JSDoc of `renderDriftNudge`
- [ ] "If wasteful" no longer appears anywhere in src/notes.ts
- [ ] renderBloatReminder untouched (still prescribes `mulligan_shrink`/`mulligan_rewind` — that is correct)
- [ ] src/nudges.ts untouched
- [ ] No test files modified (S2 owns them)
- [ ] `npm run typecheck` passes
- [ ] Test failures (if run) are exclusively old-tail string assertions in notes/drift_nudge tests

## Anti-Patterns to Avoid

- ❌ Don't "helpfully" update the tests — S2's whole work item is that; touching them here conflicts with the parallel plan
- ❌ Don't touch renderBloatReminder, shouldNudge, injectNudge, windowing, or suppression logic
- ❌ Don't replace the em-dash with a hyphen or add a trailing newline / `[mulligan]` prefix
- ❌ Don't reword the lead variants or the sustained clause

---

**Confidence Score**: 9/10 — a two-line, fully-specified surgical edit with exact old/new strings and explicit non-goals; the only residual risk is accidental scope creep into tests or nudges.ts.