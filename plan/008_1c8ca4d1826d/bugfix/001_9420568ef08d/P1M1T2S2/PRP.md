# PRP — P1.M1.T2.S2: Wire the E22 identical-note advisory into rewindExecute's success text (spec-verbatim, appended after k-clause/MUTATION_WARNING)

## Goal

**Feature Goal**: Implement BUG-002's remaining half (the advisory half of spec/08 E22): when two consecutive rewinds re-land at the same prompt with substantively identical `note.what_happened` (identical after `trim().toLowerCase()`), the SECOND rewind's success text appends the spec-verbatim warning `"⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."` — a SHOULD-level steer only; it NEVER refuses and never alters the k-clause, MUTATION_WARNING, or the MUST backstops (steps 4b/4c).

**Deliverable**: (1) an `IDENTICAL_NOTE_ADVISORY` const + `prevNote === current` comparison in `rewindExecute` computed BEFORE step 7's `appendRewindMarker`; (2) `successText` extended with an `identicalNote` flag appending the advisory AFTER the k-clause and MUTATION_WARNING; (3) the seven required unit tests (a)–(g) in test/tools/rewind.test.ts.

**Success Definition**: `npm test` green; `npx tsc --noEmit` clean; advisory fires only on a consecutive same-prompt rewind with normalized-identical what_happened; backstops at rewind.ts:570-581 (4b) and 583-612 (4c) byte-identical; grep finds the advisory string exactly once in src/.

## Why

Spec/08-edge-cases.md:117 (E22, "Advisory repeat-detection hint"): "if two consecutive rewinds re-land at the same prompt with substantively identical notes (same `what_happened` after trim/lowercase — which now includes the avoid/lesson), the success text for the second one SHOULD append: '⚠ …'. This steers; the budget/context-fraction stops above are what ultimately refuse." The MUST backstops are implemented and tested; without the advisory the agent burns up to (budget−1) wasted re-attempts in a note-identical loop before the hard refusal. P1.M1.T2.S1 delivered the read primitive (`prevRewindNoteAtLatestPrompt`); this subtask is the one-line comparison + string wiring + tests.

## What

1. **Add the const** in src/tools/rewind.ts next to `MUTATION_WARNING` (~:137):
   ```ts
   /** IDENTICAL_NOTE_ADVISORY — the spec/08 E22 (line 117) VERBATIM SHOULD-level advisory appended to the
    *  success text when the previous same-prompt rewind's what_happened (trim+lowercase) is identical to the
    *  current one. Steers only — the maxRetriesPerPrompt budget (step 4b) and abortContextFraction stop (4c)
    *  are the MUST-level backstops that ultimately refuse. */
   const IDENTICAL_NOTE_ADVISORY =
     "⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again.";
   ```
   (Copy the string EXACTLY — em-dashes and the ⚠ — from spec/08-edge-cases.md:117.)

2. **Compute the flag in `rewindExecute` BEFORE step 7** (appendRewindMarker at :631 persists the CURRENT marker — the helper must see only PRIOR markers). Place it just after the step-4c guard block / before step 5, wrapped E13-style:
   ```ts
   // (4d) E22 SHOULD-level identical-note advisory flag (spec/08:117). Computed BEFORE step 7 so "previous"
   //      means the prior marker (the current one is persisted at step 7). Steers only — never refuses.
   let identicalNote = false;
   try {
     const prev = prevRewindNoteAtLatestPrompt(ctx);
     const cur = params?.note?.what_happened;
     identicalNote = prev !== null && typeof cur === "string" && prev === cur.trim().toLowerCase();
   } catch {
     /* E13 — advisory is best-effort; on any failure simply omit it */
   }
   ```
   (The helper itself never throws, but the field read on `params` is defensive per house style.)

3. **Extend `successText`** (rewind.ts:179-187) with a 4th parameter and append AFTER the MUTATION_WARNING clause:
   ```ts
   function successText(
     granularity: Granularity, k: number, hasWarning: boolean, identicalNote = false,
   ): { text: string } {
     const kClause = /* unchanged */;
     let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
     if (hasWarning) text += " " + MUTATION_WARNING;      // spec/08 E5 VERBATIM — UNCHANGED
     if (identicalNote) text += " " + IDENTICAL_NOTE_ADVISORY; // spec/08 E22 VERBATIM — appended LAST
     return { text };
   }
   ```
   Default `= false` keeps the signature backward compatible (there are no other callers, but defaults are house style). Update the JSDoc: mention the E22 clause and that all three clauses can coexist (k-clause → note → E5 warning → E22 advisory).

4. **Pass the flag at step 9** (rewind.ts:~699-704): `const { text } = successText(granularity, k, hasWarning, identicalNote);` — the ONLY other change on the success path.

5. **UNCHANGED (byte-identical)**: step 4b refusal text/logic (:570-581), step 4c (:583-612), the depth guard, refusal(), MUTATION_WARNING const, REWIND_DESC/param schema (P1.M1.T1.S1 territory), and `prevRewindNoteAtLatestPrompt` itself (S1 territory). No config knob (rides existing config; E22 advisory fires regardless of budget settings). No exported-type surface changes.

### Success Criteria

- [ ] Second consecutive same-prompt rewind with normalized-identical what_happened → advisory appended to success text
- [ ] Different note / new user prompt between rewinds / previous rewind cancelled → NO advisory
- [ ] Case/whitespace-only differences → advisory fires (normalization on both sides)
- [ ] Advisory coexists with MUTATION_WARNING (appended after it) and with a k=0 k-clause (zero-hide still advises — E22 (c))
- [ ] Steps 4b/4c byte-identical; advisory never refuses; comparison runs before step 7's persist
- [ ] `npm test` green; `npx tsc --noEmit` clean

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need the exact successText/step-9 sites, the timing constraint (before step 7), the S1 helper contract, the spec-verbatim string, and the test harness (makePi/makeCtx/run/firstText/fixtures). All below.

### Documentation & References

```yaml
- file: src/tools/rewind.ts
  why: THE file. successText :179-187 (extend signature + append clause); MUTATION_WARNING const :137 (place
        IDENTICAL_NOTE_ADVISORY next to it); rewindExecute steps: 4b :570-581 and 4c :583-612 (BYTE-IDENTICAL —
        do not touch); step 5 preview ~:615; step 7 appendRewindMarker :631 (the comparison MUST precede it);
        step 8 hasWarning :~695; step 9 successText call :~699-704 (pass the 4th arg).
  pattern: consts for verbatim strings with spec-citing JSDoc; `text += " " + …` clause append style.
  gotcha: compute identicalNote BEFORE step 7 — after appendRewindMarker the CURRENT marker is in
          getEntries() and would compare against itself.

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M1T2S1/PRP.md
  why: CONTRACT — exported prevRewindNoteAtLatestPrompt(ctx): string | null (last surviving, cancel-excluded,
        same-prompt slice, normalized trim().toLowerCase(), never throws) + the rewindEntryWithNote(seq,
        whatHappened, id?) fixture in test/tools/rewind.test.ts. Both land in parallel; consume as-is.

- file: spec/08-edge-cases.md
  why: line 117 (E22 Advisory repeat-detection hint) — the VERBATIM advisory string and the SHOULD framing
        ("This steers; the budget/context-fraction stops above are what ultimately refuse").

- file: test/tools/rewind.test.ts
  why: Harness: setConfig / makePi()→{appended,pi} / makeCtx({entries}) / run(pi,ctx,{note,granularity}) /
        firstText(res) — the retry-budget describes at ~:1001-1060 are the EXACT style to mirror. Fixtures:
        msgEntry(user("…")), rewindEntry(seq) (no note), rewindEntryWithNote (S1), cancel entry
        {type:"custom",customType:"mulligan:cancel",data:{targetId}}. VALID_NOTE at :53 (spread +
        what_happened override for the "different note" case).

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/prd_snapshot.md
  why: BUG-002 (Minor Issues → Issue 2) — the defect statement + repro expectations.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the comparison MUST run before step 7 (appendRewindMarker :631) — the helper reads
//   ctx.sessionManager.getEntries(), which after the persist would include the CURRENT marker.
// CRITICAL: normalize BOTH sides with trim().toLowerCase() (the helper returns normalized; you normalize
//   params.note.what_happened) — case/whitespace-only differences MUST still fire the advisory.
// CRITICAL: the advisory string is spec-VERBATIM including "⚠", em-dashes "—", and the trailing period —
//   copy from spec/08:117, do not retype the punctuation.
// GOTCHA: rewindEntry(seq) fixtures carry NO note → the helper returns null → no advisory. Advisory tests
//   must seed rewindEntryWithNote AND pass the same what_happened in the call's note (it must also pass
//   validateNote — non-empty, valid NoteInput shape; the run harness validates before any comparison).
// GOTCHA: default param `identicalNote = false` — the E5 MUTATION_WARNING append stays BEFORE the advisory
//   append so the clauses coexist in a fixed order.
// GOTCHA: vitest does not typecheck tests, but tsc --noEmit does cover src/ — keep the 4th param typed.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD IDENTICAL_NOTE_ADVISORY const in src/tools/rewind.ts (next to MUTATION_WARNING, ~:137)
  - VERBATIM string from spec/08:117; JSDoc citing spec/08 E22 + SHOULD-level steer-only framing

Task 2: WIRE the flag in rewindExecute (src/tools/rewind.ts, after step 4c / before step 5)
  - IMPLEMENT the (4d) block from "What" #2 (try/catch, defensive field read); NO behavior coupling to
    the refusal paths

Task 3: EXTEND successText (:179) + pass the flag at step 9 (:~699-704)
  - 4th param identicalNote = false; append " " + IDENTICAL_NOTE_ADVISORY AFTER the MUTATION_WARNING append
  - Update successText JSDoc (three coexisting clauses; E22 citation)

Task 4: ADD unit tests in test/tools/rewind.test.ts — new describe
  "mulligan_rewind — E22 identical-note advisory (P1.M1.T2.S2 / spec/08:117)" mirroring the retry-budget
  describe style (:1001-1060): setConfig default, makePi, makeCtx({entries}), run, firstText assertions.
  Cases (all from "What"/item description):
  (a) [msgEntry(user("p")), rewindEntryWithNote(1, SAME)] + call note what_happened === SAME →
      firstText contains "reproducing the mistake" AND "rewound last_turn"
  (b) same seed but call note what_happened different (spread VALID_NOTE with a different string) →
      firstText NOT contains "reproducing the mistake"
  (c) seed note "  The Read FAILED  " vs call note "the read failed" → advisory fires (normalization)
  (d) [msgEntry(user("old")), rewindEntryWithNote(1, SAME), msgEntry(user("new"))] → no advisory
      (new prompt slices the previous rewind away)
  (e) seed rewindEntryWithNote(1, SAME, "id-1") + cancel entry targeting "id-1" → no advisory
      (helper returns null on all-cancelled)
  (f) coexistence with MUTATION_WARNING — assert both substrings present and advisory comes AFTER the
      warning (compare indexOf) in a fixture that triggers hasWarning; if end-to-end hasWarning is hard
      to seed (ledger comes from resolvePreview), a direct successText-level test is acceptable ONLY if
      successText is exported — prefer end-to-end: seed a bash toolResult entry per the existing E5 test
      fixtures (grep test file for the mutation-warning test and reuse its entries shape)
  (g) zero-hide: entries [msgEntry(user("p")), rewindEntryWithNote(1, SAME)] with NOTHING to hide →
      k=0 text "(nothing matched to hide)" present AND advisory present (E22 (c): zero-hide rewinds are
      the canonical loop vector and still consume budget)

Task 5: VERIFY
  - npx tsc --noEmit
  - npm test  (full suite; S1's helper tests run in the same file — both must be green)
  - grep -c "reproducing the mistake" src/tools/rewind.ts  → 1 (const only)
  - git diff on steps 4b/4c region → unchanged
```

### Implementation Patterns & Key Details

```ts
// The only rewindExecute addition (placed after the 4c guard block, before step 5):
// (4d) E22 identical-note advisory flag — BEFORE step 7 so "previous" excludes the current call's marker.
let identicalNote = false;
try {
  const prev = prevRewindNoteAtLatestPrompt(ctx);   // S1: normalized or null, cancel-aware, never throws
  const cur = params?.note?.what_happened;
  identicalNote = prev !== null && typeof cur === "string" && prev === cur.trim().toLowerCase();
} catch { /* E13 — omit the advisory on any failure */ }

// Step 9 (only change on the success path):
const { text } = successText(granularity, k, hasWarning, identicalNote);
```

### Integration Points

```yaml
src/tools/rewind.ts:
  - NEW const: IDENTICAL_NOTE_ADVISORY (module-local, next to MUTATION_WARNING)
  - CHANGED: successText signature (+ identicalNote = false, module-local, no export needed)
  - CHANGED: rewindExecute step 4d flag + step 9 call
NO changes: markers.ts, config.ts (no knob), schema, REWIND_DESC (T1.S1), helper (T2.S1), filter,
  backstop texts 4b/4c.
CONSUMERS downstream: P1.M2.T6.S1 smoke gate observes it end-to-end; P1.M3.T2.S1/S2 docs summarize it.
TESTS: 7 new cases (a)-(g) in test/tools/rewind.test.ts, reusing S1's rewindEntryWithNote fixture.
```

## Validation Loop

### Level 1: Types

```bash
npx tsc --noEmit    # 0 errors (S1 lands in parallel — disjoint regions; joint gate at merge)
```

### Level 2: Tests

```bash
npx vitest run test/tools/rewind.test.ts   # targeted
npm test                                    # full suite green
```

### Level 3: Contract assertions

```bash
grep -c "reproducing the mistake" src/tools/rewind.ts          # 1 (the const only)
grep -n "IDENTICAL_NOTE_ADVISORY" src/tools/rewind.ts          # const + successText append (+ maybe step-9 comment)
git diff src/tools/rewind.ts | grep -E "^[+-].*(per-prompt retry budget|context is at)"   # expect NO +/- lines (4b/4c untouched)
```

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean; `npm test` green (including S1's helper tests in the same file)
- [ ] Advisory string spec-verbatim (⚠, em-dashes, trailing period) and appears exactly once in src/
- [ ] Comparison computed before step 7; normalized both sides; helper-null → no advisory
- [ ] All 7 test cases (a)-(g) present and green; (g) pins k=0 + advisory coexistence
- [ ] Steps 4b/4c, refusal(), MUTATION_WARNING, schema, config untouched; no refusal ever from the advisory
- [ ] Only src/tools/rewind.ts + test/tools/rewind.test.ts modified

## Anti-Patterns to Avoid

- ❌ Do NOT compute identicalNote after step 7 — the marker would compare against itself (always-advisory bug)
- ❌ Do NOT retype the advisory string from memory — copy spec/08:117 verbatim (em-dash/⚠ subtleties)
- ❌ Do NOT gate the advisory behind a new config knob or make it refuse — SHOULD-level steer only
- ❌ Do NOT modify prevRewindNoteAtLatestPrompt or S1's tests — consume the helper as-is
- ❌ Do NOT reorder the MUTATION_WARNING append — the advisory comes strictly AFTER it