name: "P4.M2.T2.S1 — Conditional E5 mutation warning text for reverted spans"
description: |

---

## Goal

**Feature Goal**: When `mulligan_rewind`'s step 6b **reverted working-tree files** to their pre-span state,
reword the appended **E5 mutation warning** so it no longer falsely claims "those effects PERSIST on disk".
The original `MUTATION_WARNING` is correct when files persist; after a successful revert the FILE-STATE
portion was restored, so the warning must name ONLY the non-filesystem effects that still persist (commits
made, dependency installs, network/DB/process effects, staged index changes) plus any files in the restore's
`failed`/`refused` buckets. This is the v1.2 clause of spec/08 E5 + spec/05 §1 step 7.

**Deliverable**: A modified `src/tools/rewind.ts` — ONE new module-local const (`MUTATION_WARNING_REVERTED`,
verbatim from the item contract), ONE new boolean parameter on `successText()` (`filesReverted = false`),
ONE new line in step 8 that computes `filesWereReverted` from S2's `revertSummaryDetails` signal and threads it
into the `successText` call — plus updated/added tests in `test/tools/rewind.test.ts`. **NO new files. NO new
types. NO marker/details/config changes.** (S2 — P4.M2.T1.S2 — owns the restore wiring + `revertSummary`;
this task CONSUMES it.)

**Success Definition**:
- After a rewind where step 6b reverted ≥1 file (`revertSummary.reverted > 0`), the success text appends the
  **`MUTATION_WARNING_REVERTED`** string verbatim (and does NOT append the original `MUTATION_WARNING`).
- After any rewind where files were NOT reverted (no flags / disabled / `last_tool_call_group` / missing
  checkpoint / dirty-guard REFUSED / restore ran but reverted 0), the success text appends the **original
  `MUTATION_WARNING`** unchanged — byte-identical to today (the `revertRefused` path is handled correctly
  WITHOUT special-casing: refused → no restore → `reverted === 0` → original warning, which is semantically
  right because a refused revert leaves the files on disk).
- `requireMutationWarning === false` or an empty ledger (no `modifiedFiles`/`bashSideEffects`) → NO warning at
  all, regardless of whether files were reverted (`hasWarning` stays the gate; `filesWereReverted` only selects
  the wording).
- The four existing mutation-warning tests (line 614+) stay GREEN UNCHANGED (regression guarantee from the
  `filesReverted = false` default — those paths never revert).
- `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full `npx vitest run` green.

## User Persona

**Target User**: The LLM agent that calls `mulligan_rewind({revert_file_changes:true, ...})` and then RESUMES.

**Use Case**: The agent took a wrong-direction turn that ALSO edited files (and/or ran `git commit`, `npm
install`, etc.), then called rewind with `revert_file_changes:true`. Step 6b (S2) restored the file state.
The resumed agent reads the success text and must be told ACCURATELY what still needs handling: the file
edits are gone (restored), but the commit/install/network effects persist — and any files in `failed`/`refused`
were NOT restored.

**Pain Points Addressed**: Without this reword, the resumed agent sees *"those effects PERSIST on disk; do not
blindly redo them"* after a SUCCESSFUL revert — which is FALSE for the file edits (they were reverted) and
trips the exact E5 hazard the warning exists to prevent: the agent, believing the edits persist, either
blindly redoes them (compounding) or wastes effort. The reworded warning states the truth per effect-class.

## Why

- **Closes E5's v1.2 clause** (spec h2.86 / spec/05 §1 step 7): "when the agent requested working-tree revert
  and it succeeded, the FILE-STATE portion of these effects is restored … so the warning is reworded to name
  only the non-filesystem effects that still persist." P4.M2.T1.S2 wired the RESTORE; this task wires the
  WORDING. Without it, the restore's value is undercut by a contradictory, false warning.
- **Scope-tight**: this task owns EXACTLY three surgical edits in `rewind.ts` (const + param + signal line) +
  tests. It does NOT touch step 6b, the marker payload, `RewindDetails`, config, or the restore call (S2 owns
  those; touching them = scope collision). It does NOT reword the non-reverted path (unchanged).
- **The signal already exists by design**: S2 (P4.M2.T1.S2, parallel) explicitly built `details.revertSummary`
  + the `revertSummaryDetails` accumulator "so T2 need not re-read the persisted marker". This task is the
  intended consumer — a clean read of `revertSummaryDetails.reverted > 0`, no marker re-read, no string-parsing.

## What

Three edits inside `src/tools/rewind.ts` (the post-S2 state of the file — see HARD DEPENDENCY below):

1. **Add the `MUTATION_WARNING_REVERTED` const** (module-local), placed immediately after `MUTATION_WARNING`,
   with the EXACT text from the item contract.
2. **Add a `filesReverted = false` parameter to `successText()`** and branch the appended warning:
   `filesReverted ? MUTATION_WARNING_REVERTED : MUTATION_WARNING`.
3. **Compute `filesWereReverted` in step 8** from S2's in-scope accumulator and pass it as the 5th arg:
   `const filesWereReverted = !!(revertSummaryDetails && revertSummaryDetails.reverted > 0);` then
   `successText(granularity, k, hasWarning, revertClause, filesWereReverted);`.

### Success Criteria

- [ ] `MUTATION_WARNING_REVERTED` const exists, module-local, character-identical to the item-contract string
      (em-dash `—`, single quotes around `'failed'`/`'refused'`, `⚠` prefix).
- [ ] `successText()` gains a trailing `filesReverted = false` param; appends `MUTATION_WARNING_REVERTED` when
      `hasWarning && filesReverted`, else the original `MUTATION_WARNING` when `hasWarning`.
- [ ] Step 8 computes `filesWereReverted` from `revertSummaryDetails` (S2's accumulator) and passes it to
      `successText`.
- [ ] Files reverted (`revertSummary.reverted > 0`) + `hasWarning` → success text contains the REVERTED wording
      AND does NOT contain the original "modified files/ran side-effecting commands … Those effects PERSIST".
- [ ] Every non-reverted outcome (incl. dirty-guard `revertRefused`) → ORIGINAL warning unchanged (asserted
      for: refused-with-side-effects; restore-ran-reverted-0).
- [ ] `requireMutationWarning === false` OR empty ledger → NO warning even when files were reverted.
- [ ] The four pre-existing mutation-warning tests (line 614+) pass UNCHANGED.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full suite green.

## All Needed Context

### Context Completeness Check

_Pass test_: An implementer who has never seen this codebase, given this PRP + the post-S2 `src/tools/rewind.ts`
+ `src/snapshot/store.ts` (for `RestoreResult`, read-only) + `test/tools/rewind.test.ts`, can implement it
because: the exact const text (pinned verbatim), the exact `successText` signature + the one call site to edit
(named by current contents), the exact step-8 signal expression + the accumulator it reads (S2's
`revertSummaryDetails`, with the S2 PRP cited as the contract that guarantees it), the branch-by-branch
correctness proof (the table — no special-casing needed), the test idiom (fakes + seeding recipe + the
`asstWrite` trick to make `hasWarning` fire), and the validated commands are all documented with code-level
citations. ✅

### Documentation & References

```yaml
# MUST READ — the authoritative spec clauses for this task
- file: spec/08-edge-cases.md
  why: E5 ("Rewinding a span that had side effects") — the v1.2 clause: "when the agent requested working-tree
       revert and it succeeded, the FILE-STATE portion of these effects is restored … so the warning is
       reworded to name only the non-filesystem effects that still persist; see @14-working-tree-revert.md."
       [Mode A — LLM-facing docs ride WITH the work; the warning text IS the contract.]
  critical: |
    The ORIGINAL warning ("⚠ The hidden span modified files/ran side-effecting commands … Those effects PERSIST
    on disk; do not blindly redo them.") becomes FALSE after a successful revert for the file-state portion.
    A reverted `sed` edit persists no more than a reverted `edit` — so the wording MUST switch.

- file: spec/05-tools.md
  why: §1 "Behavior (step by step)" step 7 (Mutation warning) — the v1.2 parenthetical: "when step 6b reverted
       files, reword to name ONLY effects that are not working-tree file state — commits made, dependency
       installs, network/DB/process effects, staged index changes, and any files in `failed`; do not tell the
       agent that reverted files persist."
  critical: |
    The selection is GATED on "step 6b reverted files" (revertResult.reverted.length > 0). Every other 6b
    outcome keeps the ORIGINAL wording. The spec explicitly lists the non-fs effect classes the reworded text
    must name — they are baked into the item-contract string verbatim.

- file: spec/14-working-tree-revert.md
  why: §7 "mulligan_rewind integration" (the success-text additions + the revert fold S2 owns) — confirms the
       fold produces the signal this task consumes (reverted count). @14 §6 confirms a refused revert leaves
       files on disk (→ original wording is correct there).

# THE FILE TO EDIT
- file: src/tools/rewind.ts
  why: THE file. rewindExecute is the single function (steps 1–9). THREE surgical edits: (1) add the
       MUTATION_WARNING_REVERTED const right after the existing MUTATION_WARNING const (~line 155); (2) add the
       `filesReverted = false` param to successText() (~line 230) + branch the appended warning; (3) in step 8
       (~line 829) compute `filesWereReverted` from `revertSummaryDetails` and thread it into the successText
       call (~line 838). successText is MODULE-LOCAL with exactly ONE call site (step 9) — adding a defaulted
       5th param is safe and preserves every existing test.
  pattern: |
    The on-disk step-8 comment seam (REPLACE it — it currently says "[P4.M2.T2.T1] … out of scope here;
    hasWarning is left unchanged"):
        // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
        //     [P4.M2.T2.T1] when revertRefused OR files were reverted, reword the E5 warning to name only
        //     non-working-tree effects — out of scope here; hasWarning is left unchanged.
        const hasWarning =
          config.rewind.requireMutationWarning &&
          (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);
        ...
        const { text } = successText(granularity, k, hasWarning, revertClause);
  gotcha: |
    This task starts from the POST-S2 state (see HARD DEPENDENCY). After S2: (a) `let revertSummaryDetails:
    RewindDetails["revertSummary"];` is declared at the 6b-block-top scope (beside `revertClause`/`revertRefused`)
    — this is the variable step 8 reads; (b) step 9's return already includes `revertSummary: revertSummaryDetails`.
    If `revertSummaryDetails` is NOT in scope at step 8, S2 has not landed yet — STOP and confirm S2 is complete.

# THE SIGNAL SOURCE (read-only — do NOT edit) — S2's contract
- file: plan/008_c36fd26768ae/P4M2T1S2/PRP.md
  why: P4.M2.T1.S2 (sibling, parallel) is the CONTRACT for the signal this task consumes. S2 GUARANTEES:
       (1) `RewindDetails.revertSummary?: {reverted:number; deleted:number; failed:number; skipped:number;
       refused:number; backend:"git"|"cas"|"none"}` — present ONLY on the proceed branch (undefined otherwise);
       (2) `let revertSummaryDetails: RewindDetails["revertSummary"];` declared at the 6b-block-top scope
       (visible to step 8); (3) step 9 return includes `revertSummary: revertSummaryDetails`; (4) the proceed
       seam sets `revertSummaryDetails = { reverted: restoreResult.reverted.length, ... }`.
  critical: |
    S2's PRP Task 4 LITERALLY states the intent: "gives T2 (P4.M2.T2.T1, the warning reword) a clean signal —
    did revert_file_changes actually revert files? `revertSummary.reverted > 0`". (P4.M2.T2.T1 == P4.M2.T2.S1 —
    notation drift; same task.) This task IS that consumer. Read `revertSummaryDetails.reverted > 0`; do NOT
    re-read the persisted marker and do NOT parse `revertClause`.

- file: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  why: §4 "Tool Factory Pattern" — confirms the success-text extension surface: "`successText()` is extended to
       include revert results" and "The payload to appendRewindMarker includes `revert` field via spread" (S2).
       This task extends `successText()` ONE more notch (the warning wording) — the sanctioned seam.

# CONFIG (read-only)
- file: src/config.ts
  why: `config.rewind.requireMutationWarning` (default `true`, line 197) — the existing `hasWarning` gate. This
       task does NOT touch config; `requireMutationWarning` stays the master gate for ANY warning.

# THE TEST IDIOM
- file: test/tools/rewind.test.ts
  why: THE test file. Idiom: vitest; hand-rolled makePi()/makeCtx() fakes (NO vi.fn()); `.js` imports;
       `run(pi, ctx, params, toolCallId)` helper; `firstText(res)`; `VALID_NOTE`; `clearAll()` + `setConfig(
       undefined)` in beforeEach/afterEach. Existing mutation-warning describe block at line 614 (uses
       `asstWrite("WRITE","src/a.ts")` to make `modifiedFiles` non-empty → the trick to make `hasWarning` fire).
       Existing S1 revert describe block at line ~1534 incl. `makeFakeStore` (line 1444) + `seedTurnCheckpoint`
       (line 1483); S2 EXTENDS `makeFakeStore` with `restoreResult?: RestoreResult` + `restoreCalls?` — my tests
       use that. Types `RevertCheckpoint`, `RestoreResult`, `RestoreOpts`, `SnapshotStore`, `RewindDetails`
       ALREADY imported.
  pattern: |
    To test the REVERTED wording I need (a) `hasWarning` true (a `write`/`bash` toolCall in the rewound span →
    modifiedFiles/bashSideEffects non-empty) AND (b) step 6b to proceed-and-revert (revert_file_changes:true,
    last_turn, seeded turn checkpoint, fake store with restoreResult.reverted non-empty, clean dirtyCheck).
    Revert only runs at last_turn/checkpoint (NOT last_tool_call_group), so the reverted-warning tests use
    `granularity:"last_turn"` even though the existing mutation-warning tests use last_tool_call_group.
  gotcha: |
    Seed: `setConfig({revert:{enabled:true}}); const rt = getRuntime(sid); rt.store = makeFakeStore({drifted:[],
    restoreResult:{reverted:["src/a.ts"],deleted:[],failed:[],skipped:[],refused:[]}}); seedTurnCheckpoint(rt);`
    (the sid === makeCtx's sessionId). `details.revertSummary?.reverted` is the test-visible signal (S2).
```

### Current Codebase tree (relevant slice — as S2 leaves it)

```bash
src/
  tools/
    rewind.ts          # EDIT — add MUTATION_WARNING_REVERTED const; successText += filesReverted param;
                       #   step 8 computes filesWereReverted from revertSummaryDetails + threads into successText
  config.ts            # READ ONLY — config.rewind.requireMutationWarning (the existing hasWarning gate)
  snapshot/store.ts    # READ ONLY — RestoreResult shape (reverted: string[]) — context only
test/
  tools/
    rewind.test.ts     # EDIT — add "E5 reverted reword (P4.M2.T2.S1)" describe block; assert REVERTED wording +
                       #   the non-reverted regressions (refused / restore-ran-reverted-0 / requireMutationWarning-false)
```

### Desired Codebase tree

```bash
# No new files. Two files modified.
src/tools/rewind.ts        # + MUTATION_WARNING_REVERTED const; successText(+filesReverted=false); step 8
                           #   filesWereReverted signal line + 5th arg to successText
test/tools/rewind.test.ts  # + reverted-wording tests + non-reverted regression tests (refused, reverted-0,
                           #   requireMutationWarning-false); existing mutation-warning tests UNCHANGED
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — HARD DEPENDENCY on P4.M2.T1.S2 (sibling, parallel). This task starts from the POST-S2
//   rewind.ts. S2 GUARANTEES (per its PRP): `let revertSummaryDetails: RewindDetails["revertSummary"];`
//   declared at the 6b-block-top scope (visible to step 8), `RewindDetails.revertSummary?` shipped, step 9
//   return includes `revertSummary: revertSummaryDetails`, and the proceed seam sets it from
//   `restoreResult.reverted.length`. If `revertSummaryDetails` is NOT in scope at step 8 when you start,
//   S2 has not landed — STOP and confirm S2 is complete before proceeding (the parallel_execution_context
//   confirms S2 is being implemented first). Do NOT implement a fallback signal (re-reading the marker or
//   parsing revertClause) — that would diverge from the intended S2 handoff and create dead code once S2 lands.

// CRITICAL #2 — the contract logic is COMPLETE without special-casing revertRefused. The on-disk comment seam
//   says "when revertRefused OR files were reverted", but the item CONTRACT (authoritative) specifies the
//   single expression `(reverted && revertResult.reverted.length > 0)`. This naturally handles revertRefused:
//   refused → NO restore ran → revertSummaryDetails stays undefined → reverted === 0 → filesWereReverted false
//   → ORIGINAL warning, which is SEMANTICALLY CORRECT (a refused revert leaves the files on disk, so "those
//   effects PERSIST" is true). Do NOT add a `revertRefused` branch — it would diverge from the contract and
//   is unnecessary. (See the correctness table in research/notes.md.)

// CRITICAL #3 — copy MUTATION_WARNING_REVERTED VERBATIM from the item contract. Load-bearing characters:
//   • leading "⚠ " (U+26A0 + space) — same prefix as the original.
//   • em-dash "—" (U+2014) in "were NOT restored — do not". (The original uses ";" — do NOT unify.)
//   • single quotes around 'failed' and 'refused' (NOT double quotes, NOT backticks).
//   • "Non-filesystem effects PERSIST on disk (...)" with the parenthetical effect list.
//   • "All other file modifications were reverted to their pre-span state." (closing sentence).
//   Rephrasing = bug (the warning text is the LLM-facing Mode-A contract).

// CRITICAL #4 — successText is MODULE-LOCAL with exactly ONE call site (step 9). Adding a defaulted 5th param
//   `filesReverted = false` preserves the default-argument behavior for every path that does not pass it — but
//   since step 9 is the only caller, you MUST also update that one call site to pass `filesWereReverted`. Do
//   not assume the default covers the new behavior at the call site.

// CRITICAL #5 — hasWarning STAYS THE GATE; filesWereReverted only selects the WORDING. Do NOT move the
//   requireMutationWarning or the empty-ledger check. A reverted span with requireMutationWarning===false or
//   an empty ledger must append NO warning (asserted in tests). The selection expression is
//   `hasWarning ? (filesReverted ? MUTATION_WARNING_REVERTED : MUTATION_WARNING) : <none>`.

// CRITICAL #6 — DO NOT touch step 6b, the marker payload, RewindDetails, config, or the restore call. S2 owns
//   all of those. This task owns ONLY: the new const, the successText param, the step-8 signal line, the
//   successText call-site arg, and tests. Editing S2's territory = scope collision + regressions.

// CRITICAL #7 — revertSummaryDetails can be undefined (every non-proceed branch) AND can be present with
//   reverted===0 (restore ran, nothing reverted — all failed/refused). BOTH must select the ORIGINAL warning.
//   Use `!!(revertSummaryDetails && revertSummaryDetails.reverted > 0)` — the `&&` guards the undefined case
//   and the `> 0` guards the zero case. Do NOT use truthiness on the object alone.

// QUIRK — the existing mutation-warning tests (line 614+) use last_tool_call_group (no revert possible there).
//   They MUST stay green UNCHANGED — they never set revert flags, so filesReverted stays false (default) and
//   the original wording is selected. This is the regression guarantee. Do not modify them.
```

## Implementation Blueprint

### Data models and structure

**NO new types. NO exported additions.** `RewindDetails.revertSummary` already exists (S2). This task adds:
- ONE module-local `const MUTATION_WARNING_REVERTED` (string, verbatim).
- ONE trailing defaulted parameter on the module-local `successText()` function.
- ONE local `const filesWereReverted` in step 8.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM PREREQUISITES (verify S2 landed + locate the exact edit sites)
  - READ src/tools/rewind.ts and CONFIRM the POST-S2 state:
      (a) `let revertSummaryDetails: RewindDetails["revertSummary"];` is declared at the 6b-block-top scope
          (search for `revertSummaryDetails` — it MUST appear as a `let` near `let revertClause`/`let
          revertRefused`, AND be assigned in the proceed seam, AND be returned in step 9's `details`). If it
          is absent → S2 has NOT landed — STOP (CRITICAL #1).
      (b) the existing `MUTATION_WARNING` const (~line 155).
      (c) the `successText()` signature (~line 230) + its ONE call site in step 9 (~line 838).
      (d) step 8's `hasWarning` computation + the `[P4.M2.T2.T1] … out of scope here` comment seam (~line 829).
  - READ test/tools/rewind.test.ts: CONFIRM S2 EXTENDED `makeFakeStore` with `restoreResult?: RestoreResult`
      + `restoreCalls?` (line ~1444). If makeFakeStore still only has `{drifted, throwOnCheck, restoreCalled}`
      → S2's test changes are not in — STOP.
  - WHY: this task is three surgical edits. Confirming the post-S2 shape avoids guess-work and pinpoints the
    exact oldText strings for the edits. If S2 is not yet present, implementing now produces uncompilable code.

Task 1: EDIT src/tools/rewind.ts — ADD the MUTATION_WARNING_REVERTED const
  - LOCATE the existing `const MUTATION_WARNING = ...` block (~line 155, immediately after its JSDoc).
  - INSERT, directly AFTER the `MUTATION_WARNING` const declaration (and its trailing `;`), a new JSDoc + const:
        /**
         * MUTATION_WARNING_REVERTED — the v1.2 reworded E5 warning (spec/08 E5 v1.2 clause; spec/05 §1 step 7
         * v1.2; @14 §7). Used INSTEAD of MUTATION_WARNING when step 6b REVERTED files
         * (revertSummaryDetails.reverted > 0): the FILE-STATE portion of the hidden span's effects was restored
         * to its pre-span state, so the warning names ONLY the non-filesystem effects that still persist on
         * disk (commits made, dependency installs, network/DB/process effects, staged index changes) + any
         * files in the restore's `failed`/`refused` buckets (which were NOT restored). A reverted `sed` edit
         * persists no more than a reverted `edit` — so the original "Those effects PERSIST" wording would be
         * FALSE after a successful revert. Leading space + ⚠ are load-bearing (do NOT rephrase). Module-local.
         * VERBATIM from the item contract (P4.M2.T2.S1).
         */
        const MUTATION_WARNING_REVERTED =
          "⚠ The hidden span ran side-effecting commands (see note). " +
          "Non-filesystem effects PERSIST on disk (commits made, dependency installs, network/DB/process effects, staged index changes). " +
          "Any files in 'failed' or 'refused' were NOT restored — do not blindly redo those. " +
          "All other file modifications were reverted to their pre-span state.";
  - WHY: the deliverable const. CRITICAL #3 — copy character-for-character (em-dash, single quotes, ⚠).
  - GOTCHA: place it RIGHT AFTER MUTATION_WARNING so the two warnings sit together (readability + the
    successText branch reads naturally). Do NOT place it inside successText (module-local const, top-level).

Task 2: EDIT src/tools/rewind.ts — ADD the filesReverted param to successText() + branch the warning
  - EDIT the successText signature (add a trailing defaulted param):
      OLD:  function successText(
              granularity: Granularity,
              k: number,
              hasWarning: boolean,
              revertClause = "",
            ): { text: string } {
      NEW:  function successText(
              granularity: Granularity,
              k: number,
              hasWarning: boolean,
              revertClause = "",
              filesReverted = false,
            ): { text: string } {
  - EDIT the warning-append line inside successText:
      OLD:  if (hasWarning) text += " " + MUTATION_WARNING; // spec/08 E5 VERBATIM
      NEW:  if (hasWarning) {
              // spec/08 E5 VERBATIM; [P4.M2.T2.S1] v1.2: when step 6b reverted files, the file-state portion of
              // the effects was restored → name ONLY the non-filesystem effects that still persist.
              text += " " + (filesReverted ? MUTATION_WARNING_REVERTED : MUTATION_WARNING);
            }
  - WHY: the selection surface. CRITICAL #4/#5 — hasWarning stays the gate; filesReverted selects the wording.
    The defaulted param preserves every path that does not pass it (and the existing mutation-warning tests).

Task 3: EDIT src/tools/rewind.ts — compute filesWereReverted in step 8 + thread it into the successText call
  - EDIT step 8 (REPLACE the `[P4.M2.T2.T1] … out of scope here` comment seam + add the signal line; keep the
    hasWarning computation; update the successText call). The post-S2 step-8/step-9 region looks like:
        // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
        //     [P4.M2.T2.T1] when revertRefused OR files were reverted, reword the E5 warning to name only
        //     non-working-tree effects — out of scope here; hasWarning is left unchanged.
        const hasWarning =
          config.rewind.requireMutationWarning &&
          (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);

        // (9) return success (step 8 — K + K=0 honesty via successText). revertClause threads the 6b terminal-branch
        //     notices; revertRefused surfaces the refuse flag to logs/audit + P4.M2.T2.T1 (CRITICAL #10: used).
        const { text } = successText(granularity, k, hasWarning, revertClause);
    REPLACE WITH:
        // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
        //     [P4.M2.T2.S1] when step 6b REVERTED files (revertSummaryDetails.reverted > 0 — the signal S2 exposes),
        //     select MUTATION_WARNING_REVERTED: the FILE-STATE portion of the effects was restored, so the warning
        //     names ONLY non-filesystem effects that still persist (commits/installs/network/DB/process/staged +
        //     failed/refused files). Every NON-reverted outcome (no flags / disabled / group / missing /
        //     dirty-guard REFUSED / restore ran but reverted 0) → revertSummaryDetails is undefined OR .reverted===0
        //     → filesWereReverted false → ORIGINAL warning unchanged (those file effects DO persist). The
        //     dirty-guard refuse is handled HERE, not by a special branch: refused ⇒ no restore ⇒ reverted 0.
        //     hasWarning stays the gate (requireMutationWarning + non-empty ledger); filesWereReverted picks wording.
        const filesWereReverted = !!(revertSummaryDetails && revertSummaryDetails.reverted > 0);
        const hasWarning =
          config.rewind.requireMutationWarning &&
          (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);

        // (9) return success (step 8 — K + K=0 honesty via successText). revertClause threads the 6b terminal-branch
        //     notices; revertRefused surfaces the refuse flag to logs/audit + P4.M2.T2.T1 (CRITICAL #10: used).
        const { text } = successText(granularity, k, hasWarning, revertClause, filesWereReverted);
  - WHY: the deliverable signal line + the threaded arg. CRITICAL #1 (revertSummaryDetails must be in scope —
    S2's guarantee) + CRITICAL #7 (the `&&` + `> 0` guard both the undefined and the zero cases).
  - GOTCHA: do NOT touch step 9's `details` object (S2 already added `revertSummary: revertSummaryDetails`
    there). Only the successText CALL gains the 5th arg. If S2's step-9 return does NOT yet include
    `revertSummary: revertSummaryDetails`, S2 is incomplete — STOP.

Task 4: EDIT test/tools/rewind.test.ts — add the reverted-wording tests + non-reverted regressions
  - ADD a new describe block "mulligan_rewind — E5 reverted reword (P4.M2.T2.S1)" (place it after the existing
    "mutation warning" describe block at line ~614, or after the S1/S2 revert describe blocks). Tests:
    (a) FILES REVERTED + side effects → REVERTED wording (NOT original):
        - setConfig({revert:{enabled:true}}); seed a write in the span (asstWrite("WRITE","src/a.ts")) so
          ledger.modifiedFiles=["src/a.ts"] → hasWarning true; last_turn + revert_file_changes:true; fake store
          restoreResult:{reverted:["src/a.ts"],deleted:[],failed:[],skipped:[],refused:[]}; clean dirtyCheck.
        - ASSERT firstText contains "ran side-effecting commands (see note)" + "Non-filesystem effects PERSIST
          on disk" + "were reverted to their pre-span state"; ASSERT it does NOT contain "modified files/ran
          side-effecting commands" (the original prefix) NOR "Those effects PERSIST on disk; do not blindly
          redo them." (the original tail); ASSERT res.details.revertSummary?.reverted === 1.
    (b) REVERTED but requireMutationWarning===false → NO warning at all:
        - setConfig({ revert: { enabled: true }, rewind: { requireMutationWarning: false } }) — NOTE:
          `requireMutationWarning` lives under the TOP-LEVEL `config.rewind` key (config.ts line 56/197), which
          is a SIBLING of `config.revert` (NOT nested inside it). So you MUST pass TWO sibling top-level keys.
          Mirror the existing test at line 651 (`setConfig({ rewind: { requireMutationWarning: false } })`) but
          ALSO set `revert:{enabled:true}` so the revert still proceeds. Same snapshot/store setup as (a).
        - ASSERT firstText does NOT contain "⚠" warning text AND matches /Note left\.$/ OR /Note left\. …/
          (no mutation warning). (hasWarning gate — requireMutationWarning false ⇒ hasWarning false ⇒ no warning.)
    (c) DIRTY-GUARD REFUSED + side effects → ORIGINAL wording (files persist; the contract handles this w/o a
        special branch):
        - setConfig({ revert: { enabled: true } }); write in the span (modifiedFiles non-empty); fake store
          drifted:["src/a.ts"] (dirtyCheck returns drift → S1's refuse branch → no restore → reverted 0).
        - ASSERT firstText contains the ORIGINAL "modified files/ran side-effecting commands" + "Those effects
          PERSIST on disk; do not blindly redo them." AND does NOT contain "Non-filesystem effects PERSIST";
          ASSERT res.details.revertRefused === true AND res.details.revertSummary === undefined.
    (d) RESTORE RAN but reverted 0 (all failed) → ORIGINAL wording:
        - setConfig({revert:{enabled:true}}); write in the span; fake store restoreResult:{reverted:[],
          deleted:[],failed:["src/a.ts"],skipped:[],refused:[]}; clean dirtyCheck.
        - ASSERT firstText contains the ORIGINAL "Those effects PERSIST on disk; do not blindly redo them." AND
          does NOT contain "were reverted to their pre-span state"; ASSERT res.details.revertSummary?.reverted === 0.
    (e) FILES REVERTED but EMPTY ledger (no side effects) → NO warning (hasWarning gate):
        - setConfig({revert:{enabled:true}}); use asst("X") (unknown tool → empty ledger → hasWarning false);
          last_turn + revert_file_changes:true; fake store restoreResult.reverted:["src/x.ts"]; clean dirtyCheck.
        - ASSERT firstText does NOT contain "⚠" AND contains "Reverted 1 file(s)" (the S2 revert clause still
          appears) AND no mutation warning. (Confirms hasWarning is the gate, not filesWereReverted.)
  - FOLLOW pattern: hand-rolled fakes (NO vi.fn()); `.js` imports; setConfig({revert:{enabled:true}}); seed
    `const rt = getRuntime(sid); rt.store = makeFakeStore({...}); seedTurnCheckpoint(rt);` (sid === makeCtx
    sessionId). Mirror S1/S2's proceed/refuse tests for the snapshot shape.
  - GOTCHA: revert only runs at last_turn/checkpoint — use granularity "last_turn" (NOT last_tool_call_group).
    The `asstWrite("WRITE", file)` helper (line 269) classifies as a write → modifiedFiles=[file]. To keep the
    rewind's OWN tool-call group out of the span, the rewound span is [asstWrite, result(WRITE), asst("call-1"),
    result("call-1")] with toolCallId "call-1" (mirror S1's proceed test g).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the new const (Task 1). VERBATIM from the item contract. Lives right after MUTATION_WARNING.
const MUTATION_WARNING_REVERTED =
  "⚠ The hidden span ran side-effecting commands (see note). " +
  "Non-filesystem effects PERSIST on disk (commits made, dependency installs, network/DB/process effects, staged index changes). " +
  "Any files in 'failed' or 'refused' were NOT restored — do not blindly redo those. " +
  "All other file modifications were reverted to their pre-span state.";

// PATTERN — successText (Task 2). One defaulted param; hasWarning stays the gate; filesReverted picks wording.
function successText(
  granularity: Granularity,
  k: number,
  hasWarning: boolean,
  revertClause = "",
  filesReverted = false, // [P4.M2.T2.S1] v1.2 reverted-span wording selector
): { text: string } {
  const kClause =
    k === 0
      ? "0 messages will be hidden from your view starting next turn (nothing matched to hide)"
      : `${k} messages will be hidden from your view starting next turn`;
  let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
  if (revertClause) text += " " + revertClause; // [P4.M2.T1.S1] v1.2 revert notice (terminal branches)
  if (hasWarning) {
    // spec/08 E5 VERBATIM; [P4.M2.T2.S1] v1.2: when step 6b reverted files, the file-state portion of the
    // effects was restored → name ONLY the non-filesystem effects that still persist.
    text += " " + (filesReverted ? MUTATION_WARNING_REVERTED : MUTATION_WARNING);
  }
  return { text };
}

// PATTERN — step 8 signal (Task 3). revertSummaryDetails is S2's accumulator, in scope at the 6b-block-top.
//   CRITICAL #7: the `&&` guards undefined (non-proceed branches); `> 0` guards the zero case (restore ran,
//   nothing reverted). BOTH select the ORIGINAL warning — correct (files persist in both).
const filesWereReverted = !!(revertSummaryDetails && revertSummaryDetails.reverted > 0);
const hasWarning =
  config.rewind.requireMutationWarning &&
  (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);
// ... step 9:
const { text } = successText(granularity, k, hasWarning, revertClause, filesWereReverted);

// PATTERN — reverted-wording test (Task 4a). The `asstWrite` makes modifiedFiles non-empty (hasWarning true);
//   the fake store's restoreResult.reverted makes filesWereReverted true → MUTATION_WARNING_REVERTED.
setConfig({ revert: { enabled: true } });
const { pi } = makePi();
const sid = "s1";
const { ctx } = makeCtx({
  sessionId: sid,
  contextEntries: [
    msgEntry(user("u")),
    msgEntry(asstWrite("WRITE", "src/a.ts")), // modifiedFiles=["src/a.ts"] → hasWarning true
    msgEntry(result("WRITE")),
    msgEntry(asst("call-1")),
    msgEntry(result("call-1")),
  ],
});
const rt = getRuntime(sid);
rt.store = makeFakeStore({
  drifted: [], // clean dirtyCheck → S2 proceeds → restore
  restoreResult: { reverted: ["src/a.ts"], deleted: [], failed: [], skipped: [], refused: [] },
});
seedTurnCheckpoint(rt);
const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true }, "call-1");
expect(firstText(res)).toContain("ran side-effecting commands (see note)"); // REVERTED wording
expect(firstText(res)).toContain("Non-filesystem effects PERSIST on disk");
expect(firstText(res)).toContain("were reverted to their pre-span state");
expect(firstText(res)).not.toContain("modified files/ran side-effecting commands"); // ORIGINAL prefix ABSENT
expect(firstText(res)).not.toContain("Those effects PERSIST on disk; do not blindly redo them."); // ORIGINAL tail ABSENT
expect(res.details.revertSummary?.reverted).toBe(1);
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO NEW FILES / NO NEW TYPES / NO CONFIG CHANGES. This item edits ONE source file +
ONE test file (.ts, ESM .js imports).
TOOL BODY (src/tools/rewind.ts):
  - ADD const MUTATION_WARNING_REVERTED (module-local, after MUTATION_WARNING).
  - ADD successText param `filesReverted = false`; branch the appended warning on it.
  - ADD step-8 `const filesWereReverted = !!(revertSummaryDetails && revertSummaryDetails.reverted > 0);`.
  - PASS filesWereReverted as the 5th arg to the ONE successText call site (step 9).
SIGNAL (read-only): revertSummaryDetails — S2's 6b-block-top accumulator (the in-scope variable). Equivalent
  test surface: res.details.revertSummary?.reverted (S2 returns it in details).
CONFIG (read-only): config.rewind.requireMutationWarning stays the hasWarning gate — UNCHANGED.
MARKER (read-only): the persisted marker's revert block (S2) is NOT consulted by this task. S2's revertSummary
  is the sanctioned signal precisely to avoid a marker re-read here.
HANDOFF: this task CONSUMES S2 (P4.M2.T1.S2). It produces nothing downstream beyond the corrected LLM-facing
  warning text (Mode A). P5.M1.T1 (integration tests F-revert-*) will assert the wording end-to-end.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project. The new const, the successText param, the filesWereReverted local, the
# `revertSummaryDetails` read (S2's accumulator), and the 5th successText arg must all resolve.
npx tsc --noEmit
npx tsc --noEmit 2>&1 | grep -E 'tools/rewind'   # isolate this item's file
# Expected: zero errors. If "Cannot find name 'revertSummaryDetails'" → S2 has NOT landed (CRITICAL #1) — STOP.
# If "Property 'reverted' does not exist on type 'undefined'" → drop the optional chaining / the `&&` guard is
#   wrong; revertSummaryDetails is `RewindDetails["revertSummary"]` = `{reverted:number;...} | undefined` — the
#   `revertSummaryDetails && ...` narrowing must make `.reverted` reachable.

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/tools/rewind.ts + test/tools/rewind.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/tools/rewind.ts test/tools/rewind.test.ts
# Expected: clean (the const + the param + the signal line follow the file's existing multi-line style).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the rewind suite (fast feedback while implementing).
npx vitest run test/tools/rewind.test.ts
# Expected: ALL green. Watch specifically:
#   - the four PRE-EXISTING mutation-warning tests (line 614+) STILL pass UNCHANGED (filesReverted defaults
#     false → original wording; they never set revert flags). This is the regression guarantee.
#   - S2's proceed/restore-fold tests STILL pass (this task does not touch step 6b / the marker / details).
#   - the NEW "E5 reverted reword (P4.M2.T2.S1)" tests (a–e) all pass.

# Full suite — confirm no regressions (this task is read-only on every module except rewind.ts).
npx vitest run
# Expected: full suite green. A red suite outside rewind.test.ts means an accidental edit — revert it.
```

`test/tools/rewind.test.ts` tests ADDED by this item:

```yaml
# ADDED ("mulligan_rewind — E5 reverted reword (P4.M2.T2.S1)" describe block):
  - it("files REVERTED + side effects → MUTATION_WARNING_REVERTED wording (original 'PERSIST' wording ABSENT)")
  - it("files REVERTED but requireMutationWarning===false → NO warning at all (hasWarning gate)")
  - it("dirty-guard REFUSED + side effects → ORIGINAL wording (files persist; no special-case branch)")
  - it("restore ran but reverted 0 (all failed) → ORIGINAL wording (files persist)")
  - it("files REVERTED but EMPTY ledger → NO warning; the S2 revert clause still appears (hasWarning gate)")
```

### Level 3: Integration Testing (System Validation)

```bash
# This item is UNIT-tier (test/tools/rewind.test.ts). The end-to-end "revert succeeded → agent sees the
# reworded warning" flow is validated by the F-revert-* integration scenarios in P5.M1.T1 (Tier 2 — real temp
# git/non-git dirs, real backends, real capture hooks; specifically a reverted-span-with-side-effects scenario
# asserts the REVERTED wording appears end-to-end). This item does NOT add those — it makes the wording
# unit-testable via fakes (S2's extended makeFakeStore).

# Optional smoke (a real git revert + the reworded warning): in a temp repo, setCheckpoint, edit+commit a file,
# agent_end, then rewind({revert_file_changes:true, granularity:"last_turn"}) → expect the file restored + the
# success text carries MUTATION_WARNING_REVERTED (visible to the resumed agent). This is an F-revert-git
# variant (P5.M1.T1) — optional sanity here, authoritative there.
tmp=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt && git add -A && git commit -qm init
# (build the extension: npm run build) then in a scripted session drive the rewind + assert the wording.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# MANUAL wording audit — confirm MUTATION_WARNING_REVERTED matches the item-contract string VERBATIM by
# diffing the const against the contract (rephrase = bug — the warning text is the Mode-A LLM-facing contract):
#   ⚠ The hidden span ran side-effecting commands (see note). Non-filesystem effects PERSIST on disk (commits
#   made, dependency installs, network/DB/process effects, staged index changes). Any files in 'failed' or
#   'refused' were NOT restored — do not blindly redo those. All other file modifications were reverted to
#   their pre-span state.

# Confirm the selection table holds by running the 5 new tests — each pins one row of the correctness table
# (research/notes.md): reverted→REVERTED; refused→ORIGINAL; reverted-0→ORIGINAL; requireMutationWarning-false
# →none; empty-ledger→none.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (the const, the successText param, the filesWereReverted local, the
      `revertSummaryDetails` read with correct narrowing, and the 5th successText arg all resolve).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes (all green incl. the 5 new reword tests + the four
      unchanged mutation-warning tests + S2's proceed/restore-fold tests).
- [ ] `npx vitest run` (full suite) passes — no accidental breakage (this task is read-only outside rewind.ts).
- [ ] No new lint/format errors on `src/tools/rewind.ts` and `test/tools/rewind.test.ts`.

### Feature Validation

- [ ] `MUTATION_WARNING_REVERTED` const is character-identical to the item-contract string (em-dash, single
      quotes, ⚠ prefix — diff-checked).
- [ ] Files reverted (`revertSummary.reverted > 0`) + `hasWarning` → success text carries the REVERTED wording
      and NOT the original "modified files/ran side-effecting commands … Those effects PERSIST".
- [ ] Every non-reverted outcome (incl. dirty-guard `revertRefused` and restore-ran-reverted-0) → ORIGINAL
      wording unchanged.
- [ ] `requireMutationWarning === false` OR empty ledger → NO warning even when files were reverted.
- [ ] The four pre-existing mutation-warning tests pass UNCHANGED (regression guarantee).

### Code Quality Validation

- [ ] Follows existing codebase patterns (module-local const beside its sibling; module-local successText with
      a defaulted trailing param; `.js` imports; hand-rolled test fakes).
- [ ] File placement matches the desired codebase tree (no new files / types).
- [ ] Anti-patterns avoided (no revertRefused special-case branch; no marker re-read; no revertClause parsing;
      no edits to S2's step-6b / marker / details / config territory).
- [ ] The selection is a SINGLE expression `!!(revertSummaryDetails && revertSummaryDetails.reverted > 0)`.

### Documentation & Deployment

- [ ] Code is self-documenting (the const JSDoc cites spec/08 E5 v1.2 + spec/05 §1 step 7 + @14 §7 + the item
      contract; the step-8 comment explains why revertRefused needs no special branch).
- [ ] No new environment variables or config knobs.

---

## Anti-Patterns to Avoid

- ❌ Don't special-case `revertRefused`. The item contract's single expression `(reverted && revertResult.
  reverted.length > 0)` already handles it correctly (refused ⇒ no restore ⇒ reverted 0 ⇒ original wording,
  which is semantically right — a refused revert leaves files on disk). Adding a branch diverges from the
  contract and is dead weight.
- ❌ Don't re-read the persisted marker or parse `revertClause` to derive the signal. S2 built
  `revertSummaryDetails` precisely so this task avoids both — consume it directly.
- ❌ Don't reword `MUTATION_WARNING` itself or unify its punctuation with the reverted variant. The two strings
  are DISTINCT contracts (the original uses ";"; the reverted uses "—" and a different opening). Copy each
  verbatim.
- ❌ Don't touch step 6b, the marker payload, `RewindDetails`, `config`, or the restore call — S2 owns them.
  This task owns ONLY the const, the successText param, the step-8 signal line, the call-site arg, and tests.
- ❌ Don't implement a "fallback" signal for the case where S2 hasn't landed. If `revertSummaryDetails` is not
  in scope, STOP — S2 is a hard prerequisite (CRITICAL #1). A fallback creates dead code and a divergent path.
- ❌ Don't gate the warning on `filesWereReverted` alone. `hasWarning` (requireMutationWarning + non-empty
  ledger) STAYS the gate; `filesWereReverted` only selects WHICH warning. A reverted span with no side effects
  must show NO mutation warning (only the S2 revert clause).