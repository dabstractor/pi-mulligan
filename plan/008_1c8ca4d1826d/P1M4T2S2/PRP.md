# PRP — P1.M4.T2.S2 (RE-PLAN, attempt 2): Stale-reference grep sweep + spec-staleness wrap-up notes + gate closure

## Goal

**Feature Goal**: Finish the v2.0 changeset-level documentation close-out so that (1) README.md and VERIFICATION.md carry zero non-historical stale references to the removed `by_content_includes` arm / pre-v2.0 semantics, (2) VERIFICATION.md carries the v2.0 delta verification rows (append-only), (3) the two stale E18 test assertions that the previous attempt *reported* are **fixed**, so the full gate (`npm run typecheck && npx vitest run && npm run smoke`) is 100% green, and (4) the spec-staleness wrap-up notes are delivered verbatim for the owner.

**Deliverable**: (a) a two-line edit to `test/edge-cases.test.ts` (E18 block, ~lines 984–992) aligning assertions with the shipped v2.0 awareness-only nudge; (b) an appended addendum line to the v2.0 section of `VERIFICATION.md` recording the fix and the final green gate; (c) wrap-up notes text in the final report; (d) re-run of the grep sweep proving zero stale references.

**Success Definition**: `npm run typecheck` clean, `npx vitest run` 0 failed (≥1098 passed), `npm run smoke` 14/14, grep sweep hits ONLY the historical VERIFICATION.md:209 BUG-004 row, `git diff` touches only `test/edge-cases.test.ts` and `VERIFICATION.md` (spec/ and README.md untouched).

## Why

Attempt 1 landed all docs deliverables but exited with `"result": "issue"` because the full gate was not green: `npx vitest run` had **2 failures** in `test/edge-cases.test.ts` E18 (`:984`/`:992`). Those two assertions still expect the PRE-v2.0 *prescribing* drift-nudge text (asserting `/mulligan_rewind|mulligan_shrink/` appears in the nudge), while `src/notes.ts`'s `renderDriftNudge` was correctly re-tailed to the awareness-only form in P1.M3.T1.S2. The sibling task missed them. Attempt 1, honoring its "docs-only, don't touch src/test" contract, reported the gap instead of fixing it — correct then, but the task cannot close until the gate is green.

**Re-plan decision**: this revision *authorizes the minimal test-only fix*. It changes zero source behavior — `src/notes.ts` is already correct and locked by `test/drift_nudge.test.ts` / `test/nudges.test.ts` (e.g. `drift_nudge.test.ts:506-522` asserts `not.toContain("mulligan_shrink")` and the new phrasing). Only the two orphaned E18 assertions are wrong. Updating them is test-reconciliation (P1.M4.T1's sweep category), not a behavior change. **Do NOT touch `src/` at all in this task.**

## What

1. Fix the two E18 assertions in `test/edge-cases.test.ts` to match the shipped awareness-only tail (exact current text below).
2. Append an addendum line to the v2.0 verification section of `VERIFICATION.md` (append-only; do NOT rewrite the previously appended rows or any historical section, including the BUG-004 row at line 209).
3. Re-run the grep sweep for stale references in README.md + VERIFICATION.md.
4. Run the full gate; require 100% green.
5. Deliver the spec-staleness wrap-up notes verbatim in the final report. **Do NOT edit `spec/` or `README.md`.**

### Success Criteria

- [ ] `npx vitest run` → 0 failed (the two E18 tests pass; total ≥1098)
- [ ] `npm run typecheck` → clean; `npm run smoke` → 14/14
- [ ] `grep -n 'by_content_includes\|past tool result\|If wasteful' README.md VERIFICATION.md` → exactly one hit: the historical VERIFICATION.md:209 BUG-004 row (do not edit it)
- [ ] `grep -nE 'any role|three matcher|three-arm' README.md` → 0 hits
- [ ] `git diff --name-only` → only `test/edge-cases.test.ts`, `VERIFICATION.md` (+ plan/ bookkeeping if the harness touches it)
- [ ] Wrap-up notes delivered verbatim in the final report

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this from this PRP alone?" — Yes: exact file, exact lines, exact expected strings, exact gate commands, and the environment gotcha for smoke.

### Documentation & References

```yaml
- file: src/notes.ts
  why: renderDriftNudge is the function the E18 tests exercise — read it to write correct assertions
  pattern: "final line: `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`"
  gotcha: the nudge NEVER contains the strings mulligan_rewind / mulligan_shrink / "call" (P1.M3.T1 awareness-only lock, comment at notes.ts:532)

- file: test/edge-cases.test.ts (E18 describe block, lines ~979-996)
  why: the two failing assertions to fix
  pattern: |
    Current failing shape (both tests):
      expect(text.includes("mulligan_rewind") || text.includes("mulligan_shrink")).toBe(true);
      expect(text).toMatch(/undo|compact/);          // test 1
      expect(text).toMatch(/mulligan_rewind|mulligan_shrink/);   // test 2
    Replace with v2.0 awareness-only expectations:
      expect(text).not.toMatch(/mulligan_rewind|mulligan_shrink/);   // no tool prescription (v2.0)
      expect(text).toContain("Keep this turn's outputs lean");        // the new imperative
      expect(text).toMatch(/lean|summarize/);                        // advisory verbs survive
  gotcha: keep the describe title's advisory framing; update the stale inline comments that say "names the tools" — they are now wrong

- file: test/drift_nudge.test.ts
  why: canonical example of the v2.0 awareness-only assertions (lines ~506-522)
  pattern: not.toContain("mulligan_shrink") + toContain of the new phrasing
  gotcha: mirror this style so the two suites don't drift apart

- file: VERIFICATION.md (end of file; "## v2.0 current-turn scoping delta — verification summary" section, currently ending at ~line 275)
  why: previous attempt appended this section with the honest "1096 passed, 2 failed" ledger line
  pattern: APPEND one short addendum paragraph/line after the existing gate line, e.g.:
    "Addendum (P1.M4.T2.S2 follow-up): the two reported E18 stale assertions in test/edge-cases.test.ts
     were updated to the v2.0 awareness-only nudge expectations (test-only; src unchanged). Final gate:
     `npm run typecheck` clean, `npx vitest run` → <N> passed / 0 failed, `npm run smoke` → 14/14."
  gotcha: append-only — do NOT rewrite the "1096 passed, 2 failed" history line (it was true at run time), do NOT touch line 209 (BUG-004 historical row), do NOT reword prior baselines
```

### Current Codebase tree (relevant slice)

```bash
src/notes.ts                  # renderDriftNudge — v2.0 awareness-only tail (DO NOT MODIFY)
test/edge-cases.test.ts       # E18 block ~:979-996 — THE FIX TARGET
test/drift_nudge.test.ts      # reference assertions for the new tail
test/nudges.test.ts           # injectNudge-site tests, already v2.0-locked
VERIFICATION.md               # :209 historical BUG-004 row (keep) + appended v2.0 section (extend, append-only)
README.md                     # already swept clean by P1.M4.T2.S1 (verify only, do not edit)
spec/                         # READ-ONLY — never edit in this task
```

### Known Gotchas of our codebase & Environment

```bash
# CRITICAL (from attempt 1, issue B): smoke breaks if the sibling worktree
# /home/dustin/projects/pi-mulligan-state-reset is registered as a global pi extension in
# ~/.pi/agent/settings.json — tool-name conflicts cause 'EXTENSION LOAD FAILED' in ALL scenarios.
# Before running smoke: temporarily remove that one registration line, run smoke, then restore the
# file byte-identically (verify with a checksum before/after). Do not leave it removed.

# vitest run is the gate form (single pass, CI-equivalent). Use `npx vitest run`, not `vitest watch`.

# The E18 fix is TEST-ONLY. If you find yourself editing src/notes.ts, STOP — the src is correct
# and locked by other green tests; you would be masking a regression instead of closing this task.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/edge-cases.test.ts — E18 block only
  - LOCATE: describe("E18 — Model ignores the nudges (advisory text ...)", two `it(...)` at ~:984 and ~:992
  - REPLACE the three stale expectations with:
      expect(text).not.toMatch(/mulligan_rewind|mulligan_shrink/);
      expect(text).toContain("Keep this turn's outputs lean");
      expect(text).toMatch(/lean|summarize/);
  - UPDATE the stale inline comments ("names the tools (advisory)") to state the v2.0 awareness-only contract
  - DO NOT touch any other describe block in the file

Task 2: VERIFY the fix in isolation
  - npx vitest run test/edge-cases.test.ts -t "E18"   # both green

Task 3: MODIFY VERIFICATION.md — append-only addendum
  - APPEND after the last line of the v2.0 delta section: the addendum line per the pattern above,
    with the REAL final-gate numbers (never fabricate counts)
  - PRESERVE: line 209 BUG-004 row, all prior baselines (671/956/974/1067), the "1096 passed, 2 failed" history line

Task 4: RE-RUN the grep sweep (verification, not editing)
  - grep -n 'by_content_includes\|past tool result\|If wastful' README.md VERIFICATION.md
    → expect exactly one hit (VERIFICATION.md:209, historical — leave it)
  - grep -nE 'any role|three matcher|three-arm' README.md → expect 0
  - If the addendum prose itself introduces any of these literals, reword the addendum (e.g. "the removed substring-matcher arm") and re-grep

Task 5: FINAL FULL GATE
  - Apply the environment workaround for smoke (global extension registration, gotcha above)
  - npm run typecheck && npx vitest run && npm run smoke
  - Expected: clean / 0 failed / 14-14

Task 6: SCOPE CHECK + WRAP-UP NOTES
  - git diff --name-only → only test/edge-cases.test.ts and VERIFICATION.md (+ plan/ harness files)
  - spec/ untouched; README.md untouched; src/ untouched
  - Emit the wrap-up notes verbatim (below) in the final report
```

### Wrap-up notes (deliverable text — reproduce VERBATIM in the final report / commit notes)

```markdown
## Spec staleness — owner patch list (v2.0 current-turn scoping delta)

The v2.0 delta intentionally did NOT edit spec/. Verified stale spots for the owner to patch:

1. spec/05-tools.md §6 (tool registration summary) — SHRINK description string still says 'past tool result'; stale vs §2's v2.0 current-turn scope.
2. spec/05-tools.md §6 — CANCEL description string still lists the removed substring-matcher arm (by_content_includes); stale vs §5's two-arm schema.
3. spec/05-tools.md §5 — purpose prose still enumerates three target arms (minor internal inconsistency with the two-arm schema).
4. spec/10-testing.md §1.11 — the PRD claimed a stale content-arm bullet here; grep found NONE — the PRD's claim is itself stale. No patch needed; noted so the claim isn't re-filed.
5. spec/10-testing.md §1.5/§2.1 — lack explicit current-turn test scenarios; the shipped R5 test sweep (plan/008_1c8ca4d1826d/P1M4T1*) supplies them — consider back-porting the scenario list into the spec.

Interpretation note (no spec change needed): spec/04 §4 has no `matched` field on ShrinkMarker; the PRD's 'persist with matched:false' wording refers to the TOOL RESULT rendering ('Matched: no'), not a persisted field. Do not add a persisted `matched` field.

Source: plan/008_1c8ca4d1826d/architecture/scope_guard_design.md §6 (verified registry).
```

### Integration Points

```yaml
NONE — this is a closing sweep. No config, routes, migrations, or src changes.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit            # or npm run typecheck — clean
```

### Level 2: Unit Tests

```bash
npx vitest run test/edge-cases.test.ts -t "E18" -v   # the two fixed tests green
npx vitest run                                         # FULL suite, 0 failed
```

### Level 3: Full Gate

```bash
# Apply the smoke environment workaround first (see Known Gotchas)
npm run typecheck && npx vitest run && npm run smoke
# Expected: clean / 0 failed / 14 of 14 scenarios passed
```

### Level 4: Documentation Sweep

```bash
grep -n 'by_content_includes\|past tool result\|If wasteful' README.md VERIFICATION.md
# Expected: only VERIFICATION.md:209 (historical BUG-004 row — keep verbatim)
grep -nE 'any role|three matcher|three-arm' README.md   # Expected: no output
git diff --name-only   # Expected: test/edge-cases.test.ts, VERIFICATION.md only
```

## Final Validation Checklist

- [ ] E18's two tests assert the awareness-only tail and pass
- [ ] Full gate 100% green (typecheck clean / vitest 0 failed / smoke 14-14)
- [ ] VERIFICATION.md addendum appended (not rewritten) with honest final gate numbers
- [ ] Grep sweep: only the historical :209 hit remains; addendum prose contains no removed-arm literals
- [ ] No edits to spec/, README.md, or src/
- [ ] Wrap-up notes delivered verbatim in the final report
- [ ] ~/.pi/agent/settings.json restored byte-identically after the smoke workaround

## Anti-Patterns to Avoid

- ❌ Do NOT "fix" src/notes.ts to make the old E18 assertions pass — the src is correct; the assertions are stale
- ❌ Do NOT rewrite or reword VERIFICATION.md history (including the "2 failed" line and BUG-004 row)
- ❌ Do NOT edit spec/ even though the staleness list names specific spots — that is the owner's job
- ❌ Do NOT fabricate gate counts — record real numbers in the addendum
- ❌ Do NOT leave the global pi settings.json modified after smoke

---

**Confidence Score: 9/10** — the delta is two test assertions + one appended paragraph; the exact current tail text, exact failing lines, and the environment workaround are all specified from verified file contents.