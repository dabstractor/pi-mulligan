# PRP — P1.M2.T3.S1: README.md & Overview-Doc Sweep for Per-Tool Bloat-Threshold Consistency (Mode B)

## Goal

**Feature Goal**: Run the **Mode B changeset-level documentation sweep** (SOW §5) that runs **LAST** and
**depends on all implementing subtasks** (P1.M1.T1.S1 audit per-tool fix ✓, P1.M1.T2.S1 spec/05 ✓,
P1.M2.T1.S1 scenarios.md ✓, P1.M2.T2.S1 test comments ✓). Verify `README.md` and every top-level overview
doc / capability list are **consistent with the shipped per-tool bloat-threshold behavior**, and apply the
**one** small qualifier edit the sweep identifies (README line 171). If the sweep concludes line 171 is already
fine, make **no edit** and record "verified — no drift" instead.

**Deliverable**: A **documentation-only** (Mode B) review + at-most-one single-substring edit to
`README.md` line 171. No code, no spec, no test, no config changes. Specifically:
- **Primary edit (recommended)**: `README.md` line 171 — `flags results above the bloat threshold`
  → `flags results above the per-tool bloat threshold` (consistency with line 204 + the shipped audit fix).
- **Sweep verification**: re-confirm README lines 89, 91, 92, 108, 171, 204 and all other root-level /
  overview docs (`VERIFICATION.md`, `spec/*`, `.pi-subagents/*`) against the shipped ground truth.

**Success Definition**: (a) README's audit description is consistent with its own bloat-reminder description
(line 204) and with the shipped per-tool audit resolution; (b) no shipped overview doc contains stale bloat
threshold / audit wording; (c) the full test suite is green (changeset-level convergence check, since this
subtask runs last); (d) the implementation summary explicitly states either the edit made OR "verified — no drift".

## User Persona

**Target User**: A developer / future maintainer / end-user reading the README to understand what the audit
tool does and how the bloat threshold works after P2 + this changeset.

**Use Case**: Reading `README.md` §4 (the tools) and §5 (how it works) to learn the audit's bloat-flagging
behavior and how it relates to the per-tool bloat reminder.

**Pain Points Addressed**: README line 171 says the audit "flags results above the **bloat threshold**" while
line 204 says the reminder fires on "the **per-tool** bloat threshold" — an internal inconsistency that could
make a reader think the audit uses a single global threshold (it does not, after BUG-001).

## Why

- This is the **Mode B changeset-level documentation sweep** mandated by SOW §5. It exists specifically to
  catch exactly this class of cross-doc drift once all code/spec/test fixes are in. Running it before the
  implementing subtasks would be premature; it must run LAST.
- The shipped ground truth (after this changeset): the audit **resolves the bloat threshold per tool** via
  `bloatThresholdFor(readStr(msg,'toolName'), config)` (`src/tools/audit.ts:52,96-98`, BUG-001 fix COMPLETE).
  README line 204 already documents the reminder as "per-tool bloat threshold". Line 171's generic
  "the bloat threshold" is the only wording that has not caught up.
- **No business logic, no code, no spec, no test, no config.** Pure documentation consistency (Mode B).
  Validated by grep + a full-suite run (the convergence check).

## What

A documentation-only sweep of `README.md` plus a re-scan of all other markdown at / near the repo root and
any top-level capability list. The sweep found **exactly one** candidate edit; all other bloat/threshold/audit
mentions are already accurate. The implementer may either (a) apply the recommended edit below, or
(b) — if, after re-reading the file at implementation time, they judge line 171 is already accurate — make
**no edit** and record "verified — no drift" in the implementation summary. Both are acceptable per the task
contract; do **not** invent additional edits.

### Success Criteria

- [ ] README line 171 reads "flags results above the **per-tool** bloat threshold" (recommended edit applied)
      **OR** the implementation summary records "verified — no drift" with rationale that line 171 is accurate.
- [ ] README lines 91, 92, 108, 204 verified accurate against shipped ground truth (16384 / 32768 / 20480).
- [ ] No other shipped overview doc contains stale bloat-threshold or audit wording.
- [ ] `npm test` → all green (changeset-level convergence; nothing regressed across the whole changeset).
- [ ] No `src/*`, `test/*`, `spec/*`, `config` file, or `.pi-subagents/*` file is modified. Only `README.md`
      may be touched (one line, at most).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: (1) the **verbatim** current text of the one candidate edit line (171), (2) the
**verbatim** replacement substring, (3) the **shipped ground truth** it must agree with (threshold values + the
per-row audit resolution), (4) an **exhaustive list** of every other bloat/threshold/audit mention in README
and every other candidate doc with its disposition, and (5) deterministic grep + full-suite validation gates.
A pre-researched sweep table is in `research/readme_sweep_audit.md` for re-confirmation.

### Documentation & References

```yaml
# MUST EDIT (the only file this PRP may modify; at most one line)
- file: README.md
  why: Line 171 describes mulligan_audit as "flags results above the bloat threshold" — no per-tool qualifier,
        inconsistent with line 204 ("per-tool bloat threshold") and with the shipped per-tool audit fix.
  section: "§4 Tools → ### mulligan_audit → 'When to use it' paragraph (~line 171)."
  pattern: "One-substring in-place edit: 'flags results above the bloat threshold' -> 'flags results above the
            per-tool bloat threshold'. Do NOT touch any other word on the line."
  gotcha: "This substring is UNIQUE in README.md (appears only on line 171). Do NOT match line 204 — it already
           says 'per-tool'. The FIND substring is the lowercase generic phrase only."

# MUST READ — the sibling line that already got the wording right (the consistency target)
- file: README.md
  why: Line 204 (§5 Bloated-result reminder) already says "exceeding the per-tool bloat threshold (bash: 32 KB,
        read: 20 KB, others: the 16 KB global default)". Line 171 should match this phrasing.
  section: "§5 How It Works → 'Two ride-along nudges' → item 1 (~line 204)."
  critical: "Line 204 is the canonical per-tool wording in README. Do NOT edit it; use it as the style target."

# MUST READ — shipped ground truth (the audit resolves per-tool after BUG-001)
- file: src/tools/audit.ts
  why: Line 52 imports bloatThresholdFor; lines 96-98 document AuditRow.bloaty / thresholdBytes as resolved
        per-tool via bloatThresholdFor. Proves "per-tool bloat threshold" is the accurate phrase for the audit.
  section: "import line 52; AuditRow JSDoc lines 96-98."
  critical: "READ-ONLY — do NOT edit src/*. This is the proof that line 171's edit is accurate, not cosmetic-only."

# MUST READ — the config defaults that every README number must match
- file: src/config.ts
  why: bloatThresholdBytes default 16384; bloatThresholdBytesByTool { bash: 32768, read: 20480 }.
  section: "DEFAULT_CONFIG.nudges (~line 62). READ-ONLY — do NOT edit src/*."
  critical: "README lines 91/92/108 must show exactly 16384 / 32768 / 20480. If any differs, THAT is drift to fix."

# MUST READ — spec source of truth (already aligned by P1.M1.T2.S1, COMPLETE)
- file: spec/09-configuration.md
  why: "bloatThresholdBytes": 16384; per-tool bash 32768 / read 20480 (defaults table). Confirms README numbers.
  section: "§2 defaults table + §4 config example. READ-ONLY — spec/* is owned by other tasks; do NOT edit."

# MUST READ — the exhaustive pre-researched sweep (re-confirm at implementation time)
- docfile: plan/002_df93178e6631/bugfix/001_4ac005217ade/P1M2T3S1/research/readme_sweep_audit.md
  why: Full README bloat/threshold/audit landscape table + disposition of VERIFICATION.md / .pi-subagents / spec.
  section: "Sections 1 (README table), 2 (other docs), 3 (de-risking), 4 (ground truth)."
  critical: "Docs may have shifted by implementation time. RE-RUN the grep gates in this PRP, do not trust the
             note blindly — but use it as the checklist of what to look at."

# CONTRACT — parallel sibling (must not conflict)
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/P1M2T2S1/PRP.md
  why: Edits ONLY test/tokens.test.ts + test/notes.test.ts (comment/title only). No overlap with README.md.
  critical: "Both run in parallel; no file conflict. P1.M2.T1.S1 owns test/integration/scenarios.md — also no
             README overlap."
```

### Current Codebase tree (the only relevant slice)

```bash
README.md                 # ← EDIT line 171 ONLY (one substring, at most). Verify 89/91/92/108/204.
VERIFICATION.md           # READ-ONLY — frozen v1.0 DoD report; NO bloat/threshold staleness; OUT OF SCOPE
spec/                     # READ-ONLY — spec/05 owned by P1.M1.T2.S1 (DONE); spec/07/09 = source of truth
src/config.ts             # READ-ONLY — proves defaults (16384 / 32768 / 20480)
src/tools/audit.ts        # READ-ONLY — proves audit resolves per-tool (BUG-001 fix, lines 52/96-98)
.pi-subagents/artifacts/  # OUT OF SCOPE — internal agent scratch (stale 8192); NOT a shipped overview doc
test/**                   # OUT OF SCOPE — owned by P1.M2.T1/T2.S1
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a documentation-only (Mode B) sweep. The ONLY file you may modify is README.md,
#   and the ONLY edit is the one substring on line 171 (or no edit + "verified — no drift").

# CRITICAL: do NOT "fix" VERIFICATION.md's test count (671). It is a FROZEN historical record of the v1.0
#   DoD pass — "All gates were green on first run". It predates this changeset. Updating its snapshot count
#   would misrepresent a past verification. It contains NO stale bloat-threshold or audit wording anyway.

# CRITICAL: do NOT edit .pi-subagents/artifacts/**. Those files contain stale `bloatThresholdBytes: 8192`
#   but they are INTERNAL AGENT RESEARCH SCRATCH, not shipped overview docs or capability lists. Out of scope.

# GOTCHA: editing README.md cannot break tests. Verified: `grep -rniE 'readme|\.md' test/ src/ --include='*.ts'
#   | grep -i readme` -> NO README references in src/ or test/. No test asserts any README string. Re-run this
#   grep yourself (Validation Level 2) to re-confirm before relying on it.

# GOTCHA: the FIND substring 'flags results above the bloat threshold' is UNIQUE in README.md (line 171 only).
#   Line 204 says 'exceeding the per-tool bloat threshold' — a DIFFERENT substring. Do not conflate them.

# GOTCHA: README uses the em dash (—) and arrow (→) in places; the candidate line 171 has both. Your edit
#   touches NEITHER — you only insert 'per-tool ' (8 chars incl. trailing space) before 'bloat threshold'.
#   Leave the rest of the line byte-identical.

# OUT OF SCOPE (do NOT touch):
#   - spec/*              -> spec/05 owned by P1.M1.T2.S1 (COMPLETE); spec/07/09 = source of truth.
#   - src/*               -> code (config.ts, nudges.ts, audit.ts) — out of scope.
#   - test/*              -> owned by P1.M2.T1/T2.S1.
#   - VERIFICATION.md     -> frozen historical report; no staleness; out of scope.
#   - .pi-subagents/*     -> internal scratch; not a shipped doc; out of scope.
#   - Any config / settings / package file.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only sweep (Mode B). No code, types, migrations, or config._

### Implementation Tasks (ordered by dependencies)

The sweep has **two phases**: (A) re-run the grep audit to confirm the pre-researched findings still hold at
implementation time, then (B) either apply the single recommended edit or record "verified — no drift".
**Run Phase A before Phase B** — if docs shifted, follow what the grep shows, not the note.

```yaml
Phase A — RE-CONFIRM THE SWEEP (read-only; run all, then judge)

Task A1: RE-SCAN README.md bloat/threshold/audit landscape
  - RUN: grep -niE 'bloat|threshold|mulligan_audit' README.md
  - JUDGE: every hit against the table in research/readme_sweep_audit.md §1.
    Expected hits & dispositions (re-confirm each is still accurate):
      89  nudges.bloatReminder "exceeding the byte threshold" ........ generic, FINE
      91  bloatThresholdBytes = 16384 + per-tool override note ...... must be ACCURATE
      92  bloatThresholdBytesByTool {bash:32768,read:20480} ........ must be ACCURATE
      108 settings.json example (16384 / 32768 / 20480) ............ must be ACCURATE
      167 ### mulligan_audit (header) ............................... n/a
      171 "flags results above the bloat threshold" ................ CANDIDATE EDIT (Phase B)
      204 "per-tool bloat threshold (bash: 32 KB, read: 20 KB, others: 16 KB global default)" .. must be ACCURATE
    (lines 125/129/149 are generic "bloated" prose — ignore.)
  - IF any of 91/92/108/204 shows a DIFFERENT number than 16384/32768/20480: that IS drift — fix THAT line
    to match src/config.ts:62 + spec/09-configuration.md. (Pre-research says none will.)

Task A2: RE-SCAN other root-level / overview docs for stale bloat or audit wording
  - RUN: grep -rniE 'bloat.?threshold|bloatThreshold|flags results above|above the .* threshold' \
          README.md VERIFICATION.md
    (Intentionally EXCLUDE spec/, src/, test/, plan/, node_modules/, .pi-subagents/ from this scan:
     spec is source-of-truth / owned; src/test are code; plan/.pi-subagents are internal.)
  - EXPECT: README.md:171 (the candidate), README.md:204 (accurate), README.md:91/92/108 (accurate).
    VERIFICATION.md: at most non-stale mentions ("bloat nudge" gating, "bloatHit:true" smoke marker) —
    NO threshold-value or audit-threshold-flagging staleness.
  - JUDGE: if VERIFICATION.md shows stale wording, STOP and reconsider (it should not — it is a frozen
    report). Do NOT edit frozen historical content.

Task A3: RE-CONFIRM no test pins README content (de-risk the edit)
  - RUN: grep -rniE 'readme|\.md' test/ src/ --include='*.ts' | grep -iE 'readme'
  - EXPECT: empty (no output). If non-empty, investigate before editing README.

Phase B — APPLY (or explicitly SKIP) THE SINGLE EDIT

Task B1: EDIT README.md line 171 — add the "per-tool" qualifier (RECOMMENDED)
  - FIND (verbatim substring; unique on line 171):
      "flags results above the bloat threshold"
  - REPLACE WITH:
      "flags results above the per-tool bloat threshold"
  - RATIONALE: line 204 already uses "per-tool bloat threshold"; the shipped audit resolves per-tool
    (src/tools/audit.ts:52,96-98, BUG-001 fix). Insert "per-tool " before "bloat threshold" for
    internal consistency + accuracy. Change ONLY those 8 characters; leave the rest of line 171 identical
    (including the em dash —, the arrow →, and the "9.4k → shrink it" example).
  - ALTERNATIVE (equally acceptable): if, after Phase A, you judge "the bloat threshold" is already
    adequately scoped by the surrounding §4/§5 context, make NO edit and instead record in the
    implementation summary: "verified — no drift: README line 171 accurate; per-tool resolution is
    documented at line 204 and in spec/05/spec/09." (Task B2.)
  - DO NOT: edit any other README line, any spec, any src/test file, VERIFICATION.md, or .pi-subagents/*.

Task B2 (only if Task B1 was skipped): RECORD "verified — no drift"
  - WRITE in the implementation summary: a one-line statement that the sweep found no edit needed, naming
    the lines reviewed (89/91/92/108/171/204) and the ground truth (src/config.ts, spec/09) they were
    checked against, plus the note that VERIFICATION.md and .pi-subagents/* were reviewed and are out of
    scope. No file change in this branch.
```

### Implementation Patterns & Key Details

```ts
// The edit is a single-substring in-place change. Markdown is not compiled, not tested against, and not
// asserted by any test (Validation Level 2 proves this). So the change is provably non-behavioral.
//
// Before (README.md:171, the audit "When to use it" paragraph):
//   "... The report ranks the top messages by size (`top`, default `8`), flags results above the bloat
//    threshold, and lists active rewind/shrink markers + checkpoints — closing the feedback loop ..."
// After:
//   "... The report ranks the top messages by size (`top`, default `8`), flags results above the per-tool
//    bloat threshold, and lists active rewind/shrink markers + checkpoints — closing the feedback loop ..."
//
// The consistency target is README.md:204 (§5, already correct):
//   "Bloated-result reminder — a `tool_result` hook appends a short reminder to any result exceeding the
//    per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default)."
//
// The accuracy target is src/tools/audit.ts (BUG-001 fix, COMPLETE):
//   line 52:  import { bloatThresholdFor } from "../nudges.js"; // per-tool bloat threshold (Nudge A / spec/07 §1)
//   lines 96-98: AuditRow.bloaty = bytes > resolved per-tool threshold; thresholdBytes carried per row.
//
// PATTERN (Mode B doc sweep): re-confirm the sweep with grep FIRST, then apply at most one smallest-possible
//   consistency edit, then record the disposition (edit made OR "verified — no drift"). Never invent edits.

// CRITICAL — do NOT touch line 204, 91, 92, or 108. They are already correct. Do NOT "modernize" the em dashes
//   or arrows. Do NOT reflow line 171. Insert exactly the substring "per-tool " before "bloat threshold".
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only (Mode B).
  - DATABASE: none
  - CONFIG: none (README *documents* config; it does not change it)
  - ROUTES: none
  - CODE: none (src/*, spec/*, test/* are READ-ONLY references; owned elsewhere / out of scope)
  - The only "integration" is CROSS-DOC CONSISTENCY: README's audit description must agree with
    README:204 (per-tool reminder), src/tools/audit.ts (per-row resolution), and spec/05/spec/09 (source of
    truth). Validation gates below enforce this via grep + full-suite convergence.
  - CHANGESET CONVERGENCE: this subtask runs LAST. `npm test` (Level 3) is the whole-changeset green check
    (BUG-001/002/003/004 fixes + this doc sweep together). It must be green.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T2.S1 edits test/tokens.test.ts + test/notes.test.ts only;
    P1.M2.T1.S1 edits test/integration/scenarios.md only. Neither touches README.md. No conflict.
```

---

## Validation Loop

This is a markdown documentation sweep. Validation = (1) grep that the edit landed and is internally
consistent; (2) grep that no test pins README content (re-confirm de-risk); (3) full-suite run as the
**changeset-level convergence check** (this subtask runs LAST). No TypeScript build step is affected by a
README edit, but `tsc` is included as a cheap belt-and-suspenders gate.

### Level 1: confirm the edit landed (or the no-op is recorded)

```bash
# If Task B1 applied — print the updated line:
sed -n '171p' README.md
# Expect: "... flags results above the per-tool bloat threshold, and lists active rewind/shrink markers ..."
# (the substring "per-tool bloat threshold" must now appear on line 171.)

# Grep proof the edit is present (FAIL = still the old generic phrase):
grep -n 'flags results above the per-tool bloat threshold' README.md   # expect exactly 1 hit, line ~171

# Grep proof the OLD generic phrase is gone from line 171 (it may still be acceptable elsewhere, but should
# be gone from the audit description):
grep -n 'flags results above the bloat threshold' README.md \
  && echo "FAIL: old generic phrase still present on line 171" || echo "PASS: audit description updated"
```
Expected (Task B1 branch): line 171 shows "per-tool bloat threshold"; the grep for the old generic phrase
returns nothing. Expected (Task B2 "verified — no drift" branch): the implementation summary records the
no-op with rationale; Level 1 grep then simply confirms line 171 is accurate as-is.

### Level 2: README internal consistency + de-risk (read-only checks)

```bash
# (a) README:171 now agrees with README:204 — both should mention "per-tool bloat threshold".
echo "--- README per-tool bloat threshold mentions (expect BOTH 171 and 204) ---"
grep -n 'per-tool bloat threshold' README.md     # expect 2 hits: ~171 and ~204

# (b) README numbers match shipped ground truth (src/config.ts, spec/09).
echo "--- ground-truth defaults ---"
grep -n 'Default: 16384' src/config.ts                                   # expect 1 hit (~line 62)
grep -nE '16384|32768|20480' README.md | grep -iE 'bloat'                # expect lines 91/92/108 (+204 KB form)

# (c) DE-RISK: confirm no test pins README content (so the edit cannot have broken anything).
echo "--- README references in src/ and test/ (expect EMPTY) ---"
grep -rniE 'readme|\.md' test/ src/ --include='*.ts' | grep -iE 'readme' \
  && echo "WARN: README referenced in tests — inspect before trusting green" || echo "PASS: no test pins README content"

# (d) Other overview docs: confirm VERIFICATION.md has no stale bloat-THRESHOLD wording.
echo "--- VERIFICATION.md bloat-threshold staleness scan (expect only gating/marker mentions) ---"
grep -niE 'bloatThresholdBytes|bloat.?threshold' VERIFICATION.md \
  && echo "INSPECT: VERIFICATION.md mentions threshold — confirm not stale" || echo "PASS: no threshold staleness in VERIFICATION.md"
```
Expected: README:171 and :204 both contain "per-tool bloat threshold"; README numbers = 16384/32768/20480;
no test references README; VERIFICATION.md has no `bloatThresholdBytes`/threshold staleness.

### Level 3: Full-suite convergence (this subtask runs LAST — the whole-changeset green check)

```bash
# The Mode B sweep is the final changeset gate. Run the FULL suite to confirm ALL prior subtasks'
# fixes (BUG-001 audit per-tool, BUG-002 scenarios.md, BUG-003 spec/05, BUG-004 test comments) are green
# together with this doc sweep. (Baseline per system_context.md: 733 pass; PRD baseline 722 — both pass.)
npx vitest run
# Equivalent: npm test

# Belt-and-suspenders: README edits do not affect compilation, but confirm the tree still type-checks.
npx tsc --noEmit
```
Expected: `npx vitest run` → all tests pass (0 failures); `npx tsc --noEmit` → exit 0. Because a README edit
cannot affect vitest/tsc, a failure here means an EARLIER subtask regressed — investigate root cause, do NOT
"fix" it by reverting this README edit.

### Level 4: Creative & Domain-Specific Validation
_N/A — documentation-only sweep. No MCP/server/browser/perf/security validation applies._

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '171p' README.md` shows "per-tool bloat threshold" **OR** summary records "verified — no drift".
- [ ] Level 2(a): `grep -n 'per-tool bloat threshold' README.md` returns **both** ~171 and ~204.
- [ ] Level 2(b): README bloat numbers = 16384 / 32768 / 20480 (match `src/config.ts` + `spec/09`).
- [ ] Level 2(c): no test references README content (re-confirmed de-risk).
- [ ] Level 2(d): `VERIFICATION.md` has no stale `bloatThresholdBytes` / threshold wording.
- [ ] Level 3: `npx vitest run` → **all pass**; `npx tsc --noEmit` → **exit 0**.

### Feature Validation
- [ ] README's audit description is consistent with README:204 and with the shipped per-tool audit resolution.
- [ ] No shipped overview doc contains stale bloat-threshold or audit wording.
- [ ] Implementation summary explicitly states the edit made **OR** "verified — no drift" with rationale.
- [ ] `.pi-subagents/*` reviewed and correctly left untouched (internal scratch, out of scope).

### Code Quality / Scope Discipline
- [ ] Modified **at most** `README.md` line 171 (one substring). No other line, no other file.
- [ ] Did NOT touch `spec/*` (spec/05 owned by P1.M1.T2.S1 [COMPLETE]; spec/07/09 source of truth).
- [ ] Did NOT touch `src/*` (config.ts, nudges.ts, audit.ts — out of scope, READ-ONLY).
- [ ] Did NOT touch `test/*` (owned by P1.M2.T1/T2.S1).
- [ ] Did NOT edit `VERIFICATION.md` (frozen historical report; no staleness).
- [ ] Did NOT edit `.pi-subagents/*` (internal scratch; not a shipped doc).
- [ ] Did NOT "modernize" em dashes / arrows / reflow line 171 — inserted only "per-tool ".

### Documentation
- [ ] README audit description now matches the per-tool behavior shipped in this changeset.
- [ ] A future reader is not misled into thinking the audit uses a single global threshold.
- [ ] Implementation summary names the lines reviewed and the ground truth checked against.

---

## Anti-Patterns to Avoid

- ❌ Don't edit any file other than `README.md` (and only line 171 at most). No spec, src, test, config.
- ❌ Don't edit `VERIFICATION.md`'s test count (671) — it is a **frozen record** of the v1.0 DoD pass; it
  predates this changeset and contains no bloat-threshold staleness. Updating it misrepresents a past verification.
- ❌ Don't edit `.pi-subagents/artifacts/**` despite their stale `8192` — they are internal agent scratch,
  not shipped overview docs.
- ❌ Don't "modernize" README line 171 beyond inserting "per-tool " — leave em dashes (—), arrows (→), and
  the "9.4k → shrink it" example byte-identical.
- ❌ Don't conflate the line 171 substring ("flags results above the bloat threshold") with line 204's
  ("exceeding the per-tool bloat threshold") — they are different; only 171 is the candidate.
- ❌ Don't invent additional edits to "be thorough." The sweep found exactly one candidate; if Phase A
  confirms the others are accurate, leave them. (Or, if you judge even line 171 needs nothing, record
  "verified — no drift" — both branches are explicitly permitted by the contract.)
- ❌ Don't skip the `npx vitest run` convergence gate — this subtask runs LAST specifically to prove the
  whole changeset is green together.

---

## Confidence Score

**10/10** for one-pass implementation success. The sweep is exhaustive and pre-researched (every README
bloat/threshold/audit mention enumerated with disposition in `research/readme_sweep_audit.md`); the one
candidate edit has a verbatim unique FIND substring and a verbatim replacement; the shipped ground truth
(per-row audit resolution in `src/tools/audit.ts:52,96-98`; defaults 16384/32768/20480 in `src/config.ts` +
`spec/09`) is cited as the consistency target; the edit is provably non-behavioral (verified: **no test
references README content**, so it cannot break vitest/tsc); and the parallel siblings touch non-overlapping
files. The contract explicitly permits either the small qualifier edit or a "verified — no drift" no-op, so
the implementer cannot be wrong on the judgment call as long as Phase A re-confirms the sweep. Residual risk
— docs shifting between research and implementation — is handled by Phase A's mandatory re-scan before any
edit.