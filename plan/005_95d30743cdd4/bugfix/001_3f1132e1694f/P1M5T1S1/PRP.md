# PRP — P1.M5.T1.S1: Sync VERIFICATION.md + README.md with BUG-001→BUG-006 summaries

## Goal

**Feature Goal**: Land the changeset-level documentation (Mode B) for the six bug fixes shipped across
P1.M1→M4. `VERIFICATION.md` gets a new self-contained "Bug-fix remediation pass" section recording every fix
(ID, severity, root cause, fix applied, regression test added, post-fix test count). `README.md` gets its
behavioral sections corrected to match the new semantics (notably the BUG-005 contradiction where §3 "Disabling"
still claims audit is always-on) plus a "Resolved bugs" record. No code, no tests, no spec files change — only
prose in the two root docs.

**Deliverable**: **Two file edits only — `VERIFICATION.md` + `README.md`** (both at project root):
1. **VERIFICATION.md** — append a new section `## Bug-fix remediation pass — BUG-001 through BUG-006` (after the
   "Final sequential re-run" section) containing: a one-paragraph intro, a 6-row table
   (Bug · Severity · Root cause · Fix applied · Regression test added), and the post-fix test count sourced from
   a live `npm test` run.
2. **README.md** — (a) correct the **5 behavioral areas** to the new semantics; (b) add a
   `### Resolved bugs (BUG-001–BUG-006)` subsection at the end of §7 "Known Limitations".

**Success Definition**: After the edits, a reader of VERIFICATION.md can see the full remediation record (all
six bugs, severities, fixes, tests, and the real post-fix count) without it rewriting the v1.0 DoD history; and
a reader of README.md finds every behavioral description consistent with the shipped code (audit refuses when
disabled; fractional config knobs floor to ≥1; empty shrink needle matches nothing; nuclear-first-user rewind
refuses; checkpoint consumption retires all matching targets), plus a dated resolved-bugs record.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and operators reading the root docs to understand current behavior and
QA status — and a future build agent that treats README/VERIFICATION as the authoritative behavioral mirror of
`src/`.

**Use Case**: A maintainer who shipped the bug-fix delta opens VERIFICATION.md to confirm what changed and what
regression coverage now exists; an operator reads README §3/§4 to configure and use the corrected tools without
hitting a documented-but-now-wrong behavior.

**User Journey**: README §3 "Disabling" → now correctly says audit refuses when disabled (was wrong) → §4 tool
blurbs reflect corrected semantics → §7 "Resolved bugs" lists the six fixes → VERIFICATION.md remediation
section gives the engineering detail + test count.

**Pain Points Addressed**: The docs currently lag the code in ways that actively mislead — chief among them,
README §3 "Disabling" claims audit stays available when `enabled:false`, which BUG-005 made false. This task
closes all such gaps in one documentation pass.

## Why

- **Code↔doc consistency (the whole point of M5).** Each of BUG-001→006 changed observable behavior in
  `src/tools/{rewind,audit}.ts`, `src/config.ts`, `src/transforms.ts`. The root docs are the one artifact still
  describing the pre-fix behavior. M5 exists to sync them (Mode B: "this IS the documentation task").
- **One active contradiction must be removed.** README §3 "Disabling" says *"…`checkpoint` and `audit` remain
  available as always-on read-only diagnostics."* BUG-005 gated `audit` on `config.enabled` (it now refuses with
  `Mulligan: refused — Mulligan is disabled.`). Leaving that sentence as-is ships a doc that is **wrong** about
  a safety-relevant knob (the master disable switch). This is the highest-value single edit in the task.
- **QA traceability.** VERIFICATION.md is the project's verification record. It currently shows the v1.0 DoD
  baseline (`671 passed`) and has no bug-fix history. The remediation pass needs its own dated, self-contained
  record so the engineering rationale + regression coverage are auditable — **without** rewriting the v1.0
  snapshot (which remains an accurate historical record).
- **Scope discipline.** This is documentation ONLY. The fixes themselves are M1→M4 (Complete / in-flight); this
  task (M5.T1.S1) is the narrow doc-sync that lands after them. No `src/`, `test/`, or `spec/` edits.

## What

Two doc files, prose only. (A) VERIFICATION.md gains one new appended section. (B) README.md gets targeted
behavioral corrections + one new subsection. Full detail in Implementation Tasks.

### Success Criteria

- [ ] **VERIFICATION.md** has a new section `## Bug-fix remediation pass — BUG-001 through BUG-006` appended
      after the "Final sequential re-run" section, containing a 6-row table (one row per bug) with columns
      **Bug · Severity · Root cause · Fix applied · Regression test added**, plus the post-fix test count taken
      from a live `npm test` run (not a hardcoded guess).
- [ ] The new VERIFICATION.md section explicitly notes the v1.0 DoD `671 passed` above is the v1.0 baseline
      (the remediation count is separate and larger) — it does NOT rewrite the historical 671 snapshots.
- [ ] **README.md §3 "Disabling"** no longer claims audit is always-on — it reflects that `audit` now refuses
      when `enabled:false` (only `checkpoint` remains always-on). *(BUG-005)*
- [ ] **README.md §3 config table** rows for `nudges.driftWindowTurns`, `shrink.maxActive`,
      `shrink.staleAfterFires` note that a fractional value floors to a minimum of 1 (silent fallback). *(BUG-002/003)*
- [ ] **README.md §4 `mulligan_shrink`** `by_content_includes` matcher notes an empty substring matches nothing
      (resolves to null). *(BUG-004)*
- [ ] **README.md §4 `mulligan_audit`** blurb notes it refuses when disabled (while staying read-only).
      *(BUG-005)*
- [ ] **README.md §4 `mulligan_rewind`** `to_previous_prompt` notes it is refused when there is no prior user
      message (would cross the protected first user message). *(BUG-006)*
- [ ] **README.md §4 `mulligan_checkpoint`** (or §5) notes a consumed checkpoint is retired, and the match
      clears all concurrently-labeled targets. *(BUG-001)*
- [ ] **README.md §7** gains a `### Resolved bugs (BUG-001–BUG-006)` subsection (clearly labeled RESOLVED,
      distinct from the ongoing-limitation bullets) summarizing the six fixes.
- [ ] No file other than `VERIFICATION.md` and `README.md` is modified.

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains, for each of the six bugs: the ID, severity, exact root-cause file:line, the one-line
root cause, the precise fix applied, and the regression test added (file + what it asserts) — sourced from the
PRD and the six implementing subtask PRPs. It also contains the verbatim current text of every README section to
edit (with the specific clauses to add/change), the current VERIFICATION.md section structure, the BUG-005
contradiction spelled out, and the rule for the test count (run `npm test`, don't guess). The implementer opens
only the two doc files.

### Documentation & References

```yaml
# MUST EDIT — deliverable 1 (the QA record)
- file: VERIFICATION.md
  why: append the remediation section after "Final sequential re-run". Currently shows v1.0 DoD baseline
        (`671 passed`, no bug history). Sections in order: Header → "DoD criteria — status" → "Gate-command
        cheat sheet" → "Notes" → "Fixes applied during this pass" → "Final sequential re-run" → result line.
  pattern: "the existing sections use a '## H2' header + a Markdown table for status; mirror that. The
            'DoD criteria' table has columns | # | Criterion | Gate command | Observed result | Status | —
            follow the same table discipline (pipe-delimited, one row per item)."
  gotcha: "do NOT rewrite the in-body `671 passed` numbers (table row 1, cheat-sheet line 32, notes lines
           125/148/163, final re-run line 179) — they are the accurate v1.0 snapshot. The new section records
           the post-fix count SEPARATELY and explicitly labels the 671 as the v1.0 baseline."

# MUST EDIT — deliverable 2 (the primary docs)
- file: README.md
  why: correct the 5 behavioral areas + add the resolved-bugs subsection. ~262 lines; relevant anchors: §3
        Configuration (config table + "Disabling" subsection), §4 Tools (mulligan_rewind/shrink/audit/
        checkpoint blurbs), §7 Known Limitations.
  pattern: "prose style = short imperative sentences, spec cross-refs as `spec/NN-name.md §X`, tool names in
            backticks, refusal text quoted verbatim with the em-dash (Mulligan: refused — …). The config table
            rows mirror spec/09 §3 wording."
  gotcha: "the §3 'Disabling' subsection currently says 'checkpoint and audit remain available as always-on
           read-only diagnostics' — BUG-005 made the 'audit' half of that FALSE (audit now refuses when
           disabled). This is the single most important prose fix; do not leave it."

# SOURCE OF TRUTH — the six fixes (the bug table content comes from here)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/system_context.md
  why: "Bug Fix Summary" table gives Bug · Severity · File · Root Cause for all six (BUG-001 Major @rewind.ts
        582-623; BUG-002 Minor @config.ts 285-288; BUG-003 Minor @config.ts 266-269; BUG-004 Minor @transforms.ts
        789-795; BUG-005 Minor @audit.ts 545-570; BUG-006 Minor @rewind.ts 538-579).
  section: "## Bug Fix Summary (the 6-row table)."

# SOURCE OF TRUTH — the recommendations that BECAME the fixes (root cause + intended fix, authoritative)
- file: PRD (bug-fix requirements) §Issues (h2.1-h2.3) + §Recommendations (h2.5) + §Overview (h2.0)
  why: §Overview classifies 6 bugs (1 Major, 5 Minor); §Issues gives each root cause; §Recommendations gives the
        fix applied per bug. §Testing Summary (h2.4): Total 6, Critical 0, Major 1, Minor 5.
  critical: "the PRD says the suite was 949 at bug-verification time; the remediation adds more tests. Use the
             live `npm test` count, not 949."

# CONTRACT — the six implementing PRPs (fix-applied + test-added detail, per bug)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M3T1S1/PRP.md   # BUG-001 (Major): remove break; clear ALL getLabel-matching targets; +1 test (case i) in rewind.test.ts
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M1T1S1/PRP.md   # BUG-002: Math.floor>=1 guard on driftWindowTurns; +1 test (0.5→3) in config.test.ts
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M1T2S1/PRP.md   # BUG-003: floor>=1 block on maxActive & staleAfterFires; +2 tests (0.5→32, 0.5→3) in config.test.ts
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M2T1S1/PRP.md   # BUG-004: needle.length>0 guard in resolveShrinkTarget; rewrite 1 + 2 assertions in transforms.test.ts
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M4T1S1/PRP.md   # BUG-005: config.enabled gate + refusal() in auditExecute; new describe in audit.test.ts (PARALLEL — treats as contract)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M3T2S1/PRP.md   # BUG-006 [re-plan v2]: step-5b guarded refusal in rewindExecute; rewrite edge-cases.test.ts:447-456
  why: each PRP's Goal + Success Criteria state the exact fix and the exact regression test. The bug-table
        "Fix applied" and "Regression test added" columns are distilled from these.
  gotcha: "these PRPs are about the CODE. This PRP is about the DOCS. Do NOT re-derive code changes; only
           summarize them in prose for VERIFICATION.md/README.md."

# CONTRACT — the parallel item (confirms no doc-file overlap)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M4T1S1/PRP.md
  why: BUG-005 edits src/tools/audit.ts + test/tools/audit.test.ts ONLY. Does NOT touch VERIFICATION.md or
        README.md (those are this task's). Confirms the BUG-005 semantic I must document: audit refuses with
        `Mulligan: refused — Mulligan is disabled.` when config.enabled===false.
```

### Current Codebase tree (the only relevant slice)

```bash
VERIFICATION.md   # ← EDIT: append "## Bug-fix remediation pass — BUG-001 through BUG-006" section (1 new section)
README.md         # ← EDIT: 5 behavioral-area corrections + 1 new "### Resolved bugs" subsection under §7
plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/system_context.md   # READ-ONLY (bug summary table)
plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M{1T1,1T2,2T1,3T1,3T2,4T1}S1/PRP.md  # READ-ONLY (per-bug fix+test)
src/  test/  spec/   # READ-ONLY — NOT touched by a documentation task
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing root docs:
VERIFICATION.md   # +1 appended section (remediation record: 6-row table + post-fix test count)
README.md         # +~6 small prose corrections (5 behavioral areas + checkpoint note) + 1 new subsection (§7 Resolved bugs)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- GOTCHA #1 (the contract's characterization of the docs is PARTLY WRONG — verify, don't trust it). The
     contract says both docs "already document the 949-test suite and BUG-001/002/003." DIRECT READ shows:
     VERIFICATION.md documents 671 (the v1.0 baseline) and has NO bug-history section; README.md has ZERO
     mentions of any test count or BUG-00x. So: (a) you ADD the remediation section fresh to VERIFICATION.md;
     (b) you do NOT assume a 949 statement exists to update — it doesn't. -->

<!-- GOTCHA #2 (test count is LIVE, not hardcoded). The post-fix test count must come from a fresh `npm test`.
     Cross-checks: PRD §Overview says 949 at bug-verification time; grep ≈ 924 it-blocks (formatting-dependent);
     the remediation adds BUG-001(+1), BUG-002(+1), BUG-003(+2), BUG-004(rewrite 1 + 2 new), BUG-005(+describe),
     BUG-006(rewrite edge-cases). Record whatever `npm test` prints. NEVER write "949" or "671" as the
     remediation count without confirming via the actual run. -->

<!-- GOTCHA #3 (do NOT rewrite the v1.0 DoD "671" snapshots). VERIFICATION.md's in-body 671 figures (table row 1,
     cheat-sheet, notes, final re-run) are an accurate v1.0 historical record. The remediation section records
     the NEW count separately and explicitly labels 671 as the v1.0 baseline. Rewriting history = bad. -->

<!-- GOTCHA #4 (the BUG-005 contradiction is a SAFETY doc bug — fix it fully). README §3 "Disabling" currently
     says "checkpoint and audit remain available as always-on read-only diagnostics." BUG-005 made audit refuse
     when disabled. The corrected sentence must move audit into the gated group (only checkpoint stays
     always-on). The refusal text is `Mulligan: refused — Mulligan is disabled.` (em-dash U+2014, not a hyphen).
     Match the exact string the tools emit. -->

<!-- GOTCHA #5 (resolved bugs ≠ ongoing limitations — keep them separate). README §7 "Known Limitations" lists
     deliberate non-behaviors (compaction leak, no general undo, no hard retry, markers accumulate). The six
     bug fixes are RESOLVED corrections, not limitations. Add a clearly-labeled `### Resolved bugs
     (BUG-001–BUG-006)` subsection at the END of §7 (or just before §8 License) — do NOT append them as
     limitation bullets or they read as ongoing problems. -->

<!-- GOTCHA #6 (BUG-006 is a re-plan v2 — document it as resolved, note the edge-cases test). BUG-006's PRP is a
     re-plan: Attempt 1 failed because its non-regression audit missed test/edge-cases.test.ts:447-456 (which
     encoded the pre-fix behavior and broke). The re-plan preserved the already-applied rewind.ts fix + the
     rewind.test.ts snapshot and only rewrote edge-cases.test.ts. In the bug table, record BUG-006's test as
     the edge-cases.test.ts rewrite (refusal + no-persist), and do NOT imply the rewind.ts fix is incomplete. -->

<!-- GOTCHA #7 (refusal text / em-dash is load-bearing for verbatim accuracy). Several fixes emit a refusal
     string the docs may quote: `Mulligan: refused — Mulligan is disabled.` (rewind/shrink/cancel AND now audit
     — BUG-005) and `Mulligan: refused — would cross a protected message (…).` (BUG-006). The separator is an
     em-dash (U+2014), not `-`. If you quote these in README, copy the exact glyph. -->

<!-- GOTCHA #8 (spec cross-ref style is `spec/NN-name.md §X` in README, not `@NN-name.md`). The README convention
     (see existing rows/blurbs) is `spec/05-tools.md`, `spec/08-edge-cases.md` E3, etc. Do not import the spec's
     internal `@NN` reference form into README prose. -->
```

## Implementation Blueprint

### Data models and structure

N/A — pure documentation. The only "model" is the new VERIFICATION.md table row shape, which mirrors the
existing "DoD criteria" table:

```markdown
| Bug | Severity | Root cause | Fix applied | Regression test added |
|-----|----------|------------|-------------|-----------------------|
```

And the README resolved-bugs subsection uses the project's standard subsection + bullet style.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CAPTURE the post-fix test count (do this FIRST — it feeds Task 1)
  - RUN: `npm test` (or `npx vitest run`) and read the final summary line, e.g. "Test Files  N passed  ...
          Tests  M passed".
  - RECORD the integer M (total tests passed). This is the number for Task 1's table footer. Do NOT proceed to
    Task 1 without a real number — GOTCHA #2.
  - WHY: VERIFICATION.md must state the actual post-fix count; guessing (949/671) is forbidden.

Task 1: EDIT VERIFICATION.md — append the "Bug-fix remediation pass" section
  - LOCATE the end of the "## Final sequential re-run" section (the final result line: "**Result: pi-mulligan
    v1.0 meets all 6 Definition-of-Done criteria. The extension is releaseable.**").
  - APPEND AFTER it a new section:
      "## Bug-fix remediation pass — BUG-001 through BUG-006\n\n<intro paragraph>\n\n<table>\n\n<count line>"
  - INTRO paragraph (≈2 sentences): a creative end-to-end PRD validation pass found six issues in edge cases the
    v1.0 671-test suite did not cover (1 Major, 5 Minor; 0 Critical, 0 data-loss). All six were fixed with
    regression tests added; the suite is now <M> tests (the v1.0 DoD `671` above remains the v1.0 baseline).
  - TABLE (6 rows — exact content from the research/source_of_truth.md bug table; columns Bug | Severity |
    Root cause | Fix applied | Regression test added):
      BUG-001 | Major  | rewind.ts checkpoint-consumption loop cleared only the first-found target then broke, leaving a duplicate-labeled target active | Remove the break; clear ALL candidate targetIds whose current getLabel===needle | rewind.test.ts "checkpoint consumption" case (i): two targets same name → both cleared, 2nd rewind refuses
      BUG-002 | Minor  | config.ts driftWindowTurns floored without a >=1 guard; 0.5→0 collapsed the drift window | Math.floor(n)>=1 guard mirroring maxRetriesPerPrompt | config.test.ts: 0.5→3 (silent)
      BUG-003 | Minor  | config.ts maxActive/staleAfterFires used bare coerceNumber with no floor; 0.5 accepted verbatim | 3-line floored >=1 block mirroring maxRetriesPerPrompt | config.test.ts: 0.5→32 and 0.5→3 (silent)
      BUG-004 | Minor  | transforms.ts resolveShrinkTarget by_content_includes had no empty-needle guard; "" matched messages[0] | Add needle.length>0 → empty needle returns null (defense-in-depth) | transforms.test.ts: rewrite E13 throw-test + 2 assertions locking empty→null
      BUG-005 | Minor  | audit.ts auditExecute had no config.enabled gate; reported a transformed view when disabled | refusal() helper + config.enabled gate as 2nd statement; disabled path touches no sessionManager | audit.test.ts: new "config.enabled===false" describe (refusal text + zeroed details)
      BUG-006 | Minor  | rewind.ts had no protected-refusal check before persist; nuclear last_turn on the first/only user message persisted a no-op marker | step-5b guarded refusal before persist (detects crossing first:user) | edge-cases.test.ts:447-456 rewritten to assert refusal + no-persist
  - COUNT line: "`npm test` → **<M> passed, 0 failed** (post-remediation; the v1.0 DoD `671 passed` above is the
    v1.0 baseline)."
  - DO NOT: rewrite any in-body 671 figure (GOTCHA #3); add a code change; touch README (Task 2).

Task 2: EDIT README.md — correct the 5 behavioral areas + checkpoint note
  Apply each as a small, surgical prose edit (append/adjust a clause). Verbatim anchors + the change:
    2a. §3 "Disabling" subsection — BUG-005 (MANDATORY — the contradiction):
        FIND: "...the three mutating tools — `rewind`, `shrink`, `cancel` — gate on the master switch; `checkpoint` and `audit` remain available as always-on read-only diagnostics)."
        CHANGE: move audit into the gated group. New sense: the four tools `rewind`, `shrink`, `cancel`, AND
        `audit` gate on the master switch (audit refuses with `Mulligan: refused — Mulligan is disabled.`);
        only `checkpoint` remains an always-on read-only diagnostic. Keep the rest of the paragraph.
    2b. §3 config table — BUG-002/003:
        rows `nudges.driftWindowTurns`, `shrink.maxActive`, `shrink.staleAfterFires`: append a clause that a
        fractional value floors to a minimum of 1 (silent fallback to the default if it would floor below 1).
    2c. §4 mulligan_shrink `by_content_includes` matcher — BUG-004:
        append "; an empty substring matches nothing (resolves to null)."
    2d. §4 mulligan_audit blurb — BUG-005:
        after "The audit is read-only and persists nothing.", add "It refuses with the standard disabled
        message when `enabled: false`."
    2e. §4 mulligan_rewind `to_previous_prompt` — BUG-006:
        append "It is refused if there is no prior user message (it would otherwise cross the protected first
        user message)."
    2f. §4 mulligan_checkpoint (or §5 data-flow) — BUG-001:
        add a one-line note that a checkpoint is retired when a rewind consumes it, and the match clears all
        concurrently-labeled targets (a name can be set on more than one target).
  - DO NOT: reformat sections; touch knobs not affected by the bugs; import `@NN` spec refs (use `spec/NN`).

Task 3: EDIT README.md §7 — add the "Resolved bugs" subsection
  - LOCATE the end of §7 "Known Limitations" (after its 4 bullets, before "## 8. License").
  - APPEND a new subsection:
      "### Resolved bugs (BUG-001–BUG-006)\n\nA short paragraph + a compact list: BUG-001 checkpoint
      consumption now clears all matching targets (Major); BUG-002/003 config integer validation floors
      fractional knobs to ≥1; BUG-004 empty shrink needle matches nothing; BUG-005 audit refuses when disabled;
      BUG-006 nuclear rewind on the first user message refuses. All six have regression tests (see
      VERIFICATION.md)."
  - WHY: §7 is the closest existing home for "things to know about behavior edges"; clearly labeling them
    RESOLVED keeps them distinct from the ongoing limitations (GOTCHA #5).
  - DO NOT: append them as limitation bullets; duplicate the full VERIFICATION.md table here (keep it a summary).
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN: VERIFICATION.md tables mirror the existing "DoD criteria" table (| col | col | ... |). Use the
     same pipe-delimited style and keep cells concise (root cause + fix each ≤ ~1 line; the per-bug PRPs hold
     the depth). -->

<!-- PATTERN: README behavioral edits are SURGICAL — append or adjust one clause per area, preserving the
     surrounding sentence and the doc's voice (short imperatives, backticked identifiers, spec/NN refs). Do
     not rewrite whole sections. -->

<!-- PATTERN: refusal strings are quoted verbatim with the em-dash (U+2014). The four gated tools
     (rewind/shrink/cancel/audit) emit `Mulligan: refused — Mulligan is disabled.`; BUG-006 emits
     `Mulligan: refused — would cross a protected message (…).`. Copy the glyph exactly. -->

<!-- ORDERING: Task 0 (npm test) must precede Task 1 (the count feeds the table footer). Tasks 1/2/3 are
     otherwise independent and can be applied in any order; apply all three. -->
```

### Integration Points

```yaml
CODE:        none — no source files touched.
TESTS:       none — no tests touch these docs; `npm test` is RUN (Task 0) only to read the count, not as a gate
             for the doc change.
SPEC:        none — spec/* are READ-ONLY.
CONFIG/DB:   none.
REGISTRATION: none.
DOCS:
  - modify: VERIFICATION.md — +1 appended section (remediation record + post-fix count).
  - modify: README.md — 5 behavioral-area corrections + checkpoint note + §7 "Resolved bugs" subsection.
  - this IS the Mode B changeset-level documentation task for the BUG-001→006 remediation. No other doc is in
    scope (spec/ docs are already correct; PRP files are owned by the orchestrator).
```

## Validation Loop

> Documentation-only change. There is no `tsc`/`vitest` gate that exercises these docs (no markdown linter is
> configured). `npm test` is RUN to capture a count (Task 0), not to gate the edit. Validation is grep +
> cross-check + render sanity.

### Level 1: Edit landing (grep — proves the edits applied)

```bash
# VERIFICATION.md — new section present, count line uses the live number.
grep -n "Bug-fix remediation pass — BUG-001 through BUG-006" VERIFICATION.md   # expect 1 hit (new section header)
grep -ncE "BUG-00[1-6]" VERIFICATION.md                                        # expect ≥ 6 (one per table row)
grep -nE "post-remediation|v1.0 baseline" VERIFICATION.md                      # expect the count/baseline note

# README.md — the BUG-005 contradiction is fixed (audit no longer "remain available").
grep -n "audit.*remain available\|audit.*always-on" README.md                  # expect NO hit in the Disabling section (old false claim gone)
grep -nE "audit.*(refuses|disabled)|refused — Mulligan is disabled" README.md  # expect a hit (new correct claim)
# README.md — the other 4 behavioral edits landed.
grep -niE "empty (substring|needle).*null|matches nothing" README.md           # BUG-004 (shrink matcher)
grep -niE "floor|minimum of 1|≥ 1" README.md                                   # BUG-002/003 (config knobs)
grep -niE "no prior user message|cross the protected first" README.md          # BUG-006 (nuclear rewind)
grep -niE "Resolved bugs" README.md                                            # the new §7 subsection
```
Expected: every "expect" holds. A miss ⇒ an edit was skipped.

### Level 2: Behavioral-consistency cross-check (proves the prose matches the shipped code)

```bash
# BUG-005: README's audit/disabling claim matches the actual gate now in audit.ts.
grep -n '!config.enabled\|Mulligan is disabled' src/tools/audit.ts             # expect the new gate + refusal (BUG-005 landed)
# BUG-002/003: README's "floors to ≥1" claim matches config.ts.
grep -nE 'Math\.floor\(n\) >= 1' src/config.ts                                 # expect 3 hits (maxRetriesPerPrompt + driftWindowTurns + maxActive/staleAfterFires)
# BUG-004: README's "empty needle → null" matches transforms.ts.
grep -nE 'needle\.length > 0' src/transforms.ts                                # expect 1 hit (resolveShrinkTarget arm)
# BUG-006: README's "refuses if no prior user message" matches rewind.ts.
grep -niE 'would cross a protected|protected.*refus' src/tools/rewind.ts       # expect the guarded refusal
```
Expected: every grep returns its hit — the documented behavior is the shipped behavior. (These confirm the docs
are now accurate; they do NOT modify code.)

### Level 3: VERIFICATION.md count integrity (proves the count is real + history preserved)

```bash
# The remediation count equals a fresh `npm test` (re-run and compare the integer).
N=$(npm test 2>&1 | grep -oE '[0-9]+ passed' | head -1); echo "live: $N"
grep -n "$N" VERIFICATION.md                                                   # expect the count line to contain it
# The v1.0 baseline 671 is preserved (not rewritten) AND labeled as baseline.
grep -n "671 passed" VERIFICATION.md | head                                    # still present (DoD row 1 etc.)
grep -niE "671.*baseline|baseline.*671|v1.0 baseline" VERIFICATION.md          # the new section labels it
```
Expected: the live count appears in the remediation section; the 671 figures remain untouched and are labeled
as the v1.0 baseline.

### Level 4: Render sanity (markdown still parses)

```bash
# README headings still ascend correctly; the new ### subsection sits under ## 7.
grep -nE '^##+ ' README.md | grep -A1 -B1 "Resolved bugs"                       # ### Resolved bugs under a ## heading
# VERIFICATION.md table rows have consistent column counts.
sed -n '/Bug-fix remediation pass/,/^## /p' VERIFICATION.md | grep -E '^\| BUG' | awk -F'|' '{print NF-2" cells"}' | sort -u
# expect a single value (= consistent columns across all 6 bug rows).
```
Expected: heading hierarchy intact; all 6 bug-table rows share one column count. (Final check is a human
eyeball of both rendered sections.)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: new VERIFICATION.md section present with all 6 BUG-00x rows; README BUG-005 contradiction gone
      and replaced; the other 4 behavioral edits + §7 subsection present.
- [ ] Level 2: every README behavioral claim has a matching code anchor (audit gate, floor guards, needle
      guard, protected refusal).
- [ ] Level 3: remediation count == live `npm test`; v1.0 `671` preserved and labeled as baseline.
- [ ] Level 4: heading hierarchy intact; bug-table column counts consistent.

### Feature Validation
- [ ] VERIFICATION.md records all six fixes (ID, severity, root cause, fix, regression test) + post-fix count.
- [ ] README §3 "Disabling" no longer claims audit is always-on (BUG-005 contradiction removed).
- [ ] README §3/§4 reflect: fractional knobs floor to ≥1 (002/003); empty shrink needle → null (004); audit
      refuses when disabled (005); nuclear-first-user rewind refuses (006); checkpoint consumption retires all
      matching targets (001).
- [ ] README §7 has a clearly-labeled "Resolved bugs" subsection (resolved, not ongoing limitations).
- [ ] Contract LOGIC fully met: (a) VERIFICATION.md new section; (b) README behavioral updates; (c) bug entries
      added (as Resolved subsection, the faithful home given §7 "Known Limitations").

### Code Quality / Scope Discipline
- [ ] ONLY `VERIFICATION.md` and `README.md` modified — no `src/`, `test/`, `spec/`, or PRP files touched.
- [ ] Did NOT rewrite the v1.0 DoD `671` snapshots (GOTCHA #3) — only added the remediation record.
- [ ] Did NOT hardcode the test count — used the live `npm test` number (GOTCHA #2).
- [ ] Resolved-bugs entries are separate from ongoing-limitation bullets (GOTCHA #5).
- [ ] Refusal strings use the em-dash (U+2014) verbatim where quoted (GOTCHA #7).
- [ ] Did NOT import `@NN` spec refs into README (used `spec/NN`) (GOTCHA #8).
- [ ] Documented BUG-006 as resolved (re-plan v2 preserved the rewind.ts fix; only edge-cases test changed)
      (GOTCHA #6) — did not imply any fix is incomplete.

### Documentation
- [ ] Both docs are internally consistent and consistent with shipped code.
- [ ] No new env vars / code / behavior change — prose is the entire deliverable.

---

## Anti-Patterns to Avoid

- ❌ Don't trust the contract's claim that the docs "already document 949 / BUG-001/002/003" — direct read
  shows VERIFICATION.md says 671 and has no bug history, and README has neither. Add fresh; verify, don't assume.
- ❌ Don't hardcode the test count (949/671/924) — run `npm test` and record the real post-fix number.
- ❌ Don't rewrite the v1.0 DoD `671` figures — they're an accurate v1.0 snapshot; add the remediation record
  separately and label 671 as the baseline.
- ❌ Don't leave README §3 "Disabling" claiming audit is always-on — BUG-005 made that false; it's the single
  most important prose fix.
- ❌ Don't mix resolved bug fixes into the §7 "Known Limitations" bullets — they'd read as ongoing problems.
  Use a clearly-labeled "Resolved bugs" subsection.
- ❌ Don't duplicate the full VERIFICATION.md bug table into README (or vice versa) — VERIFICATION.md is the
  engineering record; README's Resolved-bugs subsection is a concise summary that points to it.
- ❌ Don't quote refusal strings with a hyphen instead of the em-dash (U+2014) — copy the exact glyph.
- ❌ Don't run `tsc`/`vitest` as a gate FOR the doc change — no code changed. `npm test` is run only to read the
  count. The gates are the grep + cross-check commands above.
- ❌ Don't touch any code/test/spec file "while you're at it" — this is documentation only; out-of-scope edits
  belong to M1–M4.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a two-file documentation sync against six fully-shipped
(or contract-specified, for the parallel BUG-005) fixes, each with its root cause, fix, and regression test
captured verbatim from the PRD + the six implementing PRPs. The non-obvious risks are all surfaced: (1) the
contract's inaccurate characterization of the docs (GOTCHA #1 — verified by direct read); (2) the live-vs-hardcoded
test count (GOTCHA #2 — Task 0 captures it first); (3) preserving the v1.0 `671` history (GOTCHA #3); (4) the
BUG-005 safety contradiction (GOTCHA #4 — the highest-value edit); (5) resolved-vs-ongoing categorization in §7
(GOTCHA #5); (6) BUG-006's re-plan nuance (GOTCHA #6); (7) em-dash verbatim refusal text (GOTCHA #7); (8) spec
ref style (GOTCHA #8). All are caught by the Level 1–3 grep gates. Residual risk: an implementer skips Task 0
and guesses the count — mitigated by making Task 0 the explicit first step and by Level 3's live-count
comparison. No dependency risk from the parallel BUG-005 item (it edits code/test files only, not the two docs).