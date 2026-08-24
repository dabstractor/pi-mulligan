---
name: "P1.M3.T2.S1 — VERIFICATION.md: re-record gates (smoke 19/19, unit count, tsc) + a dated 'v2.0 post-validation fixes' entry"
---

## Goal

**Feature Goal**: Update `VERIFICATION.md` so it accurately reflects the state of the tree after the v2.0 post-validation bug-fix changeset (BUG-001 REWIND_DESC/checkpoint-param docs, BUG-002 E22 identical-note advisory, BUG-003 five v1.1 smoke scenarios, plus the checkpoint.ts `@deprecated` deprecation from P1.M3.T1.S1). Spec @11 §3 DoD #2 ("All F-* integration scenarios green against a real pi -p run") becomes fully satisfied at **19/19**.

**Deliverable**: A modified `VERIFICATION.md` — updated gate numbers and a NEW dated section titled **"v2.0 post-validation fixes — BUG-001 through BUG-003"**. This is the ONLY file modified.

**Success Definition**: Every number in VERIFICATION.md matches an actually-observed run (from `plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md` or a fresh run); the new entry follows the established remediation-table format; ALL prior historical entries (v1.0 DoD 671, round-1 956, round-2 974, field-report 1067, v2.0 delta 1098/1104, and README §7's older BUG-001–005) remain byte-for-byte intact and clearly distinguished.

## Why

- VERIFICATION.md is the canonical DoD gate-evidence file for human reviewers and CI-followers (system_context.md §Docs landscape). It currently records the v2.0 delta gate as `npm run smoke → 14/14` and the unit suite at 1098/1104 — both now stale after the changeset.
- The PRD's three minor issues were all fixed by the sibling subtasks (all Complete except P1.M2.T6.S1 gate, Implementing; P1.M3.T1.S1 running in parallel per its PRP contract — assume it lands exactly as specified: `@deprecated` JSDoc on `makeCheckpointTool` / `CKPT_DESC` / `CheckpointParams` / `CheckpointDetails`, zero behavior change).
- Mode B: this subtask IS documentation — the changeset-level record, running last per its dependencies.

## What

1. **Re-record the smoke gate as 19/19**: wherever VERIFICATION.md states the current gate result for `npm run smoke` (the "v2.0 current-turn scoping delta" section tail and any summary table rows), record **19/19 scenarios passed** (14 prior: F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7, E11, E12, E15, E20 — **plus the five v1.1 scenarios F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt**).
2. **Refresh the unit-test count and tsc result**: record the observed total (expected ≥ 1104 + new tests from P1.M1.T2 BUG-002 advisory/fixture tests; take the exact number from the gate evidence) and `npx tsc --noEmit` exit 0. Prior baselines (671 / 956 / 974 / 1067 / 1098 / 1104) are PRESERVED as history, never rewritten — the established convention in this file is "prior baselines preserved as accurate history".
3. **Add a dated entry**: a new section **"v2.0 post-validation fixes — BUG-001 through BUG-003"** following the exact table format of the existing remediation-pass sections (columns: Bug | Severity | Root cause | Fix applied | Regression test added), covering:
   - **BUG-001 (Minor)** — REWIND_DESC omitted the spec @05 §6 'Description strings' checkpoint-granularity sentence; the `checkpoint` param description referenced the removed agent tool `mulligan_checkpoint` instead of the `/mulligan_checkpoint` command. Fixed in `src/tools/rewind.ts` (P1.M1.T1.S1): spec-verbatim sentence restored; param description corrected. Regression: `test/tools/rewind.test.ts` description-pin tests.
   - **BUG-002 (Minor)** — spec @08 E22 SHOULD-level identical-note advisory absent from the rewind success path. Fixed (P1.M1.T2.S1/S2): `prevRewindNoteAtLatestPrompt` pure helper (cancel-aware, same-prompt slice) + spec-verbatim warning appended after the k-clause/MUTATION_WARNING in `rewindExecute` success text. Regression: new unit tests.
   - **BUG-003 (Minor)** — the five v1.1 REQUIRED integration scenarios (spec @10 §2.1) existed only as unit tests. Fixed (P1.M2.T1–T5): smoke harness extended with banner/checkpoint/user-visibility/high-water observables; five scenarios registered, driven, and asserted — smoke gate now 19/19, fully satisfying DoD #2.
   - **Also note**: `src/tools/checkpoint.ts` deprecation (P1.M3.T1.S1, PRD recommendation #4) — `@deprecated` JSDoc on the four exports, zero behavior change; the module survives for `validCheckpointName` (live, used by `src/commands.ts`) and the smoke harness.
   End the section with the observed `npm test` total and `npm run smoke` result line, matching the established pattern (e.g. "`npm test` → **N passed, 0 failed** … prior baselines … preserved as accurate history").

### Success Criteria

- [ ] VERIFICATION.md records smoke as 19/19 naming all five v1.1 scenarios
- [ ] Unit-test total and tsc result match the actual gate evidence (P1.M2.T6.S1)
- [ ] New dated section exists with the 4-row changeset record in the established table format
- [ ] ZERO prior entries/tables modified or renumbered (verify with `git diff VERIFICATION.md` — only additions/updates to current-gate lines plus the new section)
- [ ] The section explicitly disambiguates this BUG-001..003 numbering from the earlier rounds (matching the existing convention: "the bug numbers below are THIS round's numbering and are DISTINCT from…")

## All Needed Context

### Context Completeness Check

A no-prior-knowledge implementer needs: the file's established conventions (baseline-preservation, table format, round-disambiguation sentence), the exact fixes shipped by each sibling, and the observed gate numbers. All provided below.

### Documentation & References

```yaml
- file: VERIFICATION.md
  why: THE file to edit. Read fully first — 273 lines. Key structures:
        (1) top DoD table (historical v1.0 — do NOT touch), (2) gate-command cheat sheet
        (update the DoD #2 comment "9 F-* + 5 E-*" → note the five v1.1 additions), (3) four
        remediation-pass sections each ending in an "npm test → N passed" baseline line,
        (4) final "v2.0 current-turn scoping delta — verification summary" section whose
        closing lines currently read smoke 14/14 and npm test 1098 — this is where the
        refresh lands.
  pattern: append-style history — every round ADDS a section and ADDS a new baseline line;
        earlier lines are never edited except where they describe "current" state
  gotcha: NEVER renumber or overwrite historical BUG-001..005/007 entries — each round
        re-numbers its own findings and says so explicitly in prose

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md
  why: the authoritative observed numbers (smoke 19/19 + exit code, unit pass total + file
        count, tsc exit 0) recorded by the gate subtask. Use THESE numbers; do not invent.
  fallback: if the file is missing/incomplete, RUN the gates yourself (npm run smoke after
        clearing smoke session files, npm test, npx tsc --noEmit) and record what you observe.

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M3T1S1/PRP.md
  why: contract for the parallel deprecation subtask — assume its output exists exactly as
        specified (@deprecated on 4 exports, no behavior change) when describing it in the
        changeset entry.
  gotcha: do not describe it as a deletion; the module stays for validCheckpointName + harness

- file: README.md  (~:261-283)
  why: §7 already documents FOUR historical BUG rounds with re-used BUG-001.. numbering —
        precedent and hazard. Your new entry must present itself as a distinct dated
        changeset, never merging with these. (Editing README is P1.M3.T2.S2's job, NOT yours.)

- files: sibling PRPs under plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M1T1S1/,
        P1M1T2S1/, P1M1T2S2/, P1M2T2S1/ … P1M2T5S1/
  why: one-line summaries of what each shipped (for the Fix-applied column)
```

### Current Codebase tree (relevant excerpt)

```bash
VERIFICATION.md            # ← the ONLY file to modify (273 lines)
README.md                  # read-only for this subtask (S2 owns it)
test/integration/run-smoke.mjs   # 19-entry SCENARIOS array (post P1.M2)
plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md  # gate numbers
```

### Known Gotchas

```python
# NAMING HAZARD (PRD-contract): this repo has FOUR prior BUG-numbering rounds (README §7
#   lists "BUG-001–005" v1.0, "BUG-001–004" v1.1, "BUG-001" field report; VERIFICATION.md
#   lists BUG-001..006 round-1 and BUG-001..007 round-2). The PRD's BUG-001..003 are NEWER,
#   DIFFERENT defects. Present as a distinct dated changeset with an explicit
#   disambiguation sentence, exactly like round-2 did.
# NUMBERS: never fabricate counts — pull from gate-evidence.md or run the gates.
#   The unit total depends on how many tests P1.M1.T2 added to the 1104 baseline.
# SMOKE FLAKE: if re-running, clear state first:
#   rm -f ~/.pi/agent/sessions/<proj>/*smoke-*.jsonl && rm -rf /tmp/mulligan-smoke
#   (run-scoped RUN_ID session ids fixed most of this, but the documented clean-run
#   convention still applies)
# SCOPE: touch ONLY VERIFICATION.md. README.md and scenarios.md belong to S2/S3.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: GATHER EVIDENCE
  - READ plan/.../P1M2T6S1/research/gate-evidence.md for observed numbers
  - IF missing: RUN (in order, clean state) `npm run smoke` (expect 19/19), `npm test`
    (record N passed, 0 failed), `npx tsc --noEmit` (exit 0) and use those numbers
  - CONFIRM P1.M3.T1.S1 output present: grep -n "@deprecated" src/tools/checkpoint.ts
    → ≥4 hits (makeCheckpointTool, CKPT_DESC, CheckpointParams, CheckpointDetails)

Task 2: REFRESH CURRENT-GATE LINES in VERIFICATION.md
  - UPDATE the closing lines of the "v2.0 current-turn scoping delta" section:
    smoke → 19/19 (naming the five v1.1 scenarios), npm test → observed total,
    add tsc/npx tsc --noEmit exit 0 if not current
  - UPDATE the cheat-sheet DoD #2 comment line to reflect 19 scenarios
    (14 prior + F-consent/F-ckptcmd/F-banner/F-useraudit/F-drift-userexempt)
  - DO NOT touch the v1.0 DoD table or any historical baseline line

Task 3: ADD the dated changeset section "v2.0 post-validation fixes — BUG-001 through BUG-003"
  - PLACE: after the "v2.0 current-turn scoping delta" section (end of file, after the
    P1.M4.T2.S2 addendum paragraph)
  - FORMAT: 1 short intro paragraph (dated; 0 Critical/Major, 3 Minor; state the numbering
    disambiguation) + the 4-column table (Bug|Severity|Root cause|Fix applied|Regression
    test added) with rows BUG-001, BUG-002, BUG-003 + a deprecation note row/paragraph
    for checkpoint.ts (P1.M3.T1.S1, zero behavior change) + closing gate line
    "`npm test` → **N passed, 0 failed**; `npm run smoke` → **19/19 scenarios passed**;
    `npx tsc --noEmit` → exit 0 (prior baselines … preserved as accurate history)"
  - CONTENT SOURCES: per-bug Root cause / Fix from PRD h3.0/h3.1/h3.2 + sibling PRP summaries

Task 4: SELF-CHECK
  - git diff VERIFICATION.md → only current-gate refresh + one appended section
  - grep the new section for the disambiguation sentence
  - confirm no historical baseline numbers changed (671/956/974/1067/1098/1104 all still present)
```

### Implementation Patterns & Key Details

```markdown
<!-- New section skeleton (follow round-2's exact shape) -->
## v2.0 post-validation fixes — BUG-001 through BUG-003

<DATE> end-to-end PRD validation of the v2.0 current-turn implementation found three Minor
issues (0 Critical, 0 Major; no data-loss), plus one deprecation follow-up. All three were
fixed with regression coverage. NOTE: the bug numbers below are THIS round's numbering and
are DISTINCT from the prior rounds' "BUG-001–005/006/007" tables above and from README §7's
historical rounds — each remediation round re-numbers its findings.

| Bug | Severity | Root cause | Fix applied | Regression test added |
|---|---|---|---|---|
| BUG-001 | Minor | ... (REWIND_DESC/checkpoint-param docs drift, src/tools/rewind.ts) | ... | test/tools/rewind.test.ts ... |
| BUG-002 | Minor | ... (E22 identical-note advisory absent) | prevRewindNoteAtLatestPrompt + spec-verbatim warning | ... |
| BUG-003 | Minor | ... (five v1.1 scenarios unit-only) | five scenarios in run-smoke.mjs + smoke.ts | smoke 19/19 |
| — | — | checkpoint.ts dead agent-tool surface (recommendation #4) | @deprecated JSDoc, zero behavior change | n/a |

`npm test` → **N passed, 0 failed**; `npm run smoke` → **19/19 scenarios passed**
(F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt added);
`npx tsc --noEmit` → exit 0. Prior baselines (671/956/974/1067/1098/1104) preserved above
as accurate history.
```

## Validation Loop

### Level 1: Accuracy (this is a docs task — accuracy IS the gate)

```bash
# Every number in the new/updated lines must match observed reality
cat plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md
# cross-check each number cited in VERIFICATION.md against it (or your own fresh run)

# Regression of repo state (docs-only change must not break anything)
npx tsc --noEmit && npm test 2>&1 | tail -3
```

### Level 2: Diff hygiene

```bash
git diff VERIFICATION.md
# Expect: current-gate line updates + ONE appended section. No deletions of history.
grep -c "956\|974\|1067\|671 passed" VERIFICATION.md   # prior baselines still present
grep -n "THIS round's numbering" VERIFICATION.md        # disambiguation present
grep -n "19/19" VERIFICATION.md                          # new gate recorded
```

## Final Validation Checklist

- [ ] Smoke recorded as 19/19 with the five v1.1 scenario names spelled out
- [ ] Unit total + tsc result match gate evidence (no fabricated numbers)
- [ ] New dated section present, table format consistent with prior rounds
- [ ] Disambiguation sentence present; zero historical entries altered
- [ ] Only VERIFICATION.md modified (`git status` shows 1 changed file)
- [ ] `npx tsc --noEmit` and `npm test` still green (docs-only confirmation)

## Anti-Patterns to Avoid

- ❌ Renumbering/merging historical BUG rounds (README §7 hazard called out in the contract)
- ❌ Editing stale numbers inside historical narrative sections — they are snapshots, only "current-gate" lines update
- ❌ Touching README.md or scenarios.md (S2/S3 own them)
- ❌ Writing a count you didn't observe

---

**Confidence Score**: 9/10 — the only uncertainty is the exact observed unit-test total (depends on P1.M2.T6.S1's completed run); the PRP mandates pulling it from gate evidence or a fresh run, never guessing.