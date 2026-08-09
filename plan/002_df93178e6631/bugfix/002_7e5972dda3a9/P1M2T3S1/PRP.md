# PRP — P1.M2.T3.S1: README & Spec Doc Sweep — Final Consistency Verification (Mode B, bugfix 002)

## Goal

**Feature Goal**: Run the **final Mode B documentation-consistency sweep** for bugfix `002_7e5972dda3a9`
(`bloatThresholdFor` proto-key leak + stale-spec sync). This subtask runs **LAST** and depends on all
implementing subtasks: P1.M1.T1.S1 (hasOwnProperty guard ✓), P1.M2.T1.S1 (spec/04 ✓), P1.M2.T2.S1 (spec/10 ✓),
P1.M2.T2.S2 (spec/01, in-progress parallel sibling). It VERIFIES that `README.md` and every `spec/*.md` carry
**no stale `8192` / `8 KB` bloat-threshold references** (modulo the two legitimate historical-context
exceptions) and that per-tool values (32768/20480) are consistent everywhere.

**Deliverable**: A **documentation-only (Mode B) verification** — **expected outcome is "verified — no drift"
with ZERO file edits.** Pre-research (see `research/readme_spec_sweep_audit.md`) found the surface already
consistent. The implementer RE-RUNS the sweep at implementation time to confirm, records the disposition, and
runs the changeset-level convergence gates (`vitest` + `tsc`). If — and only if — the re-scan finds genuine NEW
drift (a doc shifted between research and implementation), apply the smallest targeted fix per the rules below.

**Success Definition**: (a) `grep -rnE '8192|8 ?KB' README.md spec/` returns **only** the two legitimate
historical-context hits (spec/07:52, spec/09:66) — i.e. **zero stale** references; (b) README:91/92/108/204
verified accurate against shipped ground truth (16384 / {bash:32768, read:20480}); (c) `npx vitest run` → all
742+ tests green; `npx tsc --noEmit` → exit 0; (d) the implementation summary records "verified — no drift"
**or** names any targeted edit made.

## User Persona

**Target User**: A future maintainer / build agent reading README + spec to understand the shipped bloat-threshold
behavior (global 16 KB + per-tool overrides + the proto-key-safe resolution).

**Use Case**: Confirming, after the changeset, that no doc still cites the old 8 KB default or contradicts the
per-tool resolution.

**Pain Points Addressed**: Cross-doc contradictions (a spec citing 8 KB while config ships 16 KB) mislead a
reader/build agent into wiring against the wrong threshold.

## Why

- This is the **Mode B changeset-level documentation sweep** (the convergence/verification pass). Its entire job
  is to catch residual cross-doc drift once all code/spec fixes are in. Running it before the implementing
  subtasks would be premature.
- The shipped ground truth: global `bloatThresholdBytes = 16384` (16 KB); per-tool `bloatThresholdBytesByTool =
  { bash: 32768, read: 20480 }` (`src/config.ts:62,109`); resolution is proto-key-safe via
  `Object.prototype.hasOwnProperty.call` (`src/nudges.ts:95`, BUG-001 fix COMPLETE).
- Pre-research confirms README + every spec/* already agree with this. So the expected result is a clean
  verification, not an edit. (The 2 `8 KB` mentions that remain are deliberate "raised from 8 KB" rationale, not
  staleness.)
- **No business logic, no code, no test, no config.** Pure documentation verification (Mode B).

## What

A read-only sweep of `README.md` + `spec/*.md` for stale `8192`/`8 KB`/`8KB` references and per-tool value
drift, followed by the changeset-level convergence gates. **Expected: no edits.** The two known `8 KB` mentions
(spec/07:52 "previous default was 8192 (8 KB)"; spec/09:66 "Raised from 8 KB") are **legitimate historical
context** explaining the calibration rationale — they MUST NOT be "fixed". Per-tool values (32768/20480/32 KB/20
KB) are verified consistent across README:92/108/204, spec/04:244, spec/05, spec/07:62, spec/09:37/38/67,
spec/SPEC.md:155.

### Success Criteria

- [ ] `grep -rnE '8192|8 ?KB' README.md spec/` → **only** spec/07:52 + spec/09:66 (both legitimate "raised from"
      historical context); **zero stale** references.
- [ ] README:91/92/108/204 verified accurate (16384 / {bash:32768, read:20480} / per-tool wording).
- [ ] `npx vitest run` → all green (742+ tests); `npx tsc --noEmit` → exit 0.
- [ ] Implementation summary records "verified — no drift" **OR** names any targeted edit (only if re-scan found
      genuine new drift).
- [ ] No `spec/01`, `spec/04`, `spec/10` edit by THIS task (sibling-owned). No `src/*`, `test/*`, config change.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: (1) the exact sweep command + its expected output (the 2 legitimate hits, verbatim
file:line), (2) the full list of every bloat/threshold mention in README + spec with its verified disposition,
(3) the shipped ground truth (16384 / {bash:32768, read:20480} / proto-key guard) with exact citations, (4) the
two historical-context exceptions the implementer MUST NOT "fix", and (5) deterministic grep + full-suite
validation gates. A complete pre-researched audit is in `research/readme_spec_sweep_audit.md`.

### Documentation & References

```yaml
# MUST RUN — the sweep (read-only). Scope: README.md + spec/ (+ docs/ which does not exist).
- command: "grep -rnE '8192|8 ?KB' README.md spec/"
  why: The core BUG-003/BUG-002 contract sweep. Finds every 8192 / 8 KB / 8KB reference.
  expected: "EXACTLY 2 hits — spec/07-preventive-and-nudges.md:52 and spec/09-configuration.md:66 — BOTH
             legitimate 'raised from 8 KB' historical-context rationale. ZERO stale references."
  critical: "If a THIRD hit appears (e.g. spec/01, spec/04, spec/10, README), that IS drift. But note: the
             siblings P1.M2.T1.S1 (spec/04), P1.M2.T2.S1 (spec/10), P1.M2.T2.S2 (spec/01) are responsible for
             those files — see 'If genuine drift is found' before editing anything."

# MUST NOT "FIX" — the 2 legitimate historical-context exceptions (the contract explicitly excepts these)
- file: spec/07-preventive-and-nudges.md
  why: Line 52 — "The previous default was 8192 (8 KB); it was raised after observation showed 8 KB nagging…".
        This is INTENTIONAL design history explaining WHY the default was raised. Removing it destroys the
        calibration rationale.
  critical: "READ-ONLY. Do NOT change this '8192 (8 KB)' / '8 KB' — it is correct historical context, not a bug."

- file: spec/09-configuration.md
  why: Line 66 — "Raised from 8 KB after observation: the 8 KB default nagged on every routine source-file
        read…". Same intentional "raised from" rationale.
  critical: "READ-ONLY. Do NOT change this '8 KB' — it is correct historical context, not a bug."

# MUST VERIFY — README (expected already-correct; no edit)
- file: README.md
  why: Lines 91 (bloatThresholdBytes=16384 + per-tool note), 92 (bloatThresholdBytesByTool={bash:32768,
        read:20480}), 108 (settings.json example), 171 (audit "per-tool bloat threshold"), 204 (reminder
        "per-tool bloat threshold; bash 32 KB, read 20 KB, others 16 KB global default").
  critical: "All ALREADY correct as of research. If any number differs from 16384/32768/20480, that is the one
             edit to make. Pre-research says none will differ."

# MUST READ — shipped ground truth (the values every README/spec number must match)
- file: src/config.ts
  why: Line 62 (JSDoc 'Default: 16384 (16 KB)') + line 109 (DEFAULT_CONFIG: bloatThresholdBytes 16384 +
        bloatThresholdBytesByTool {bash:32768, read:20480}). The ultimate source of truth.
  section: "MulliganConfig.nudges.bloatThresholdBytes JSDoc (~line 55-64) + DEFAULT_CONFIG (~line 109-110).
            READ-ONLY — do NOT edit src/*."
  critical: "16384 (16 KB) global + {bash:32768, read:20480} per-tool = the shipped truth."

- file: src/nudges.ts
  why: Lines 91-95 — bloatThresholdFor uses Object.prototype.hasOwnProperty.call (BUG-001 proto-key guard,
        COMPLETE). Confirms the shipped resolution behavior the docs describe.
  section: "bloatThresholdFor (~line 76-95). READ-ONLY — do NOT edit src/*."
  critical: "The guard is an IMPLEMENTATION detail; docs need not describe it. The sweep only verifies the
             threshold VALUES + per-tool behavior are correctly documented."

# CONTRACT — parallel sibling (spec/01, in-progress). This sweep must NOT touch spec/01.
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/P1M2T2S2/PRP.md
  why: CONTRACT. Edits spec/01-pi-context-internals.md:197 ONLY ("(e.g. 8 KB in-context)" → "(e.g. 16 KB
        in-context)", space preserved). git status shows spec/01 already `M` (edit applied/in-progress).
  critical: "spec/01:197 is the sibling's file. If your sweep sees spec/01:197 still saying '8 KB', that means
             the sibling hasn't finished — do NOT edit spec/01 yourself; note it and let the sibling complete.
             (Pre-research: spec/01:197 already reads '16 KB in-context' — sibling done.)"

# CONTEXT — other parallel siblings (spec/04, spec/10 — both COMPLETE). This sweep must NOT touch them.
- note: "P1.M2.T1.S1 edits spec/04-data-model.md (COMPLETE — line 243-244 correct). P1.M2.T2.S1 edits
         spec/10-testing.md:67 (COMPLETE — '>16KB result'). Neither overlaps README. Do NOT edit spec/04 or
         spec/10 even if your sweep flags them — report to the sibling/parent instead."

# MUST READ — the exhaustive pre-researched sweep (re-confirm at implementation time)
- docfile: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/P1M2T3S1/research/readme_spec_sweep_audit.md
  why: Full sweep results: the 2 legitimate hits, the per-tool consistency table, the README landscape, the
        sibling states, the BUG-001 guard, the source-of-truth facts.
  critical: "Docs may have shifted by implementation time. RE-RUN the grep gates in this PRP; use the note as
             the checklist of what to look at, not as a substitute for re-running."
```

### Current Codebase tree (the only relevant slice)

```bash
README.md                 # VERIFY 91/92/108/171/204 (expected already-correct; edit only if a number drifted)
spec/
├── 01-pi-context-internals.md  # SIBLING-OWNED (P1.M2.T2.S2) — DO NOT EDIT; verify only
├── 04-data-model.md            # SIBLING-OWNED (P1.M2.T1.S1, COMPLETE) — DO NOT EDIT
├── 05-tools.md                 # READ-ONLY — per-tool audit spec (correct)
├── 07-preventive-and-nudges.md # READ-ONLY — line 52 = legitimate historical context (the "8 KB" exception)
├── 09-configuration.md         # READ-ONLY — line 66 = legitimate historical context; 67 = source of truth
├── 10-testing.md               # SIBLING-OWNED (P1.M2.T2.S1, COMPLETE) — DO NOT EDIT
└── SPEC.md                     # READ-ONLY — line 155 correct
src/config.ts                   # READ-ONLY — ground truth (16384 / {bash:32768, read:20480})
src/nudges.ts                   # READ-ONLY — bloatThresholdFor hasOwnProperty guard (BUG-001 COMPLETE)
# NOTE: there is NO docs/ directory in the repo. The contract's `docs/` operand is a no-op.
VERIFICATION.md                 # OUT OF SCOPE — frozen v1.0 DoD report; grep confirmed 0 threshold staleness
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a Mode B VERIFICATION sweep. The EXPECTED outcome is "verified — no drift" with ZERO edits.
#   Pre-research found the README + spec surface already consistent. Do NOT invent edits "to be thorough".

# CRITICAL: the 2 '8 KB' / '8192' hits (spec/07:52, spec/09:66) are LEGITIMATE "raised from 8 KB" historical
#   context — the calibration rationale. They are NOT staleness. Do NOT "fix" them. The contract EXPLICITLY
#   excepts these two lines.

# CRITICAL (SCOPE — DO NOT TOUCH SIBLING FILES): spec/01 (P1.M2.T2.S2, in-progress), spec/04 (P1.M2.T1.S1,
#   COMPLETE), spec/10 (P1.M2.T2.S1, COMPLETE) are sibling-owned. If your sweep flags a stale reference in one
#   of them, do NOT edit it — that is the sibling's responsibility. Record it and let the sibling/parent handle.
#   (Pre-research: all three already read '16 KB' / '16384' / '>16KB' — siblings are done.)

# GOTCHA: README:171 ALREADY says "flags results above the per-tool bloat threshold" (it has the "per-tool"
#   qualifier). Unlike bugfix 001 (where 171 needed that qualifier added), here it is ALREADY correct. Do NOT
#   look for a README edit — there is none.

# GOTCHA: there is NO docs/ directory. `ls docs/` -> not found. The contract sweep operand `docs/` is a no-op.

# GOTCHA: VERIFICATION.md is a FROZEN v1.0 DoD report ("Generated by P1.M7.T4.S2"). grep confirms 0 threshold
#   staleness in it. It is OUT OF the contract scope (README + spec/ + docs/). Do NOT edit it.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/01, spec/04, spec/10  -> sibling-owned (P1.M2.T2.S2 / T1.S1 / T2.S1).
#   - spec/07, spec/09           -> already correct (the 8 KB hits there are legitimate history; source of truth).
#   - spec/05, spec/SPEC.md      -> already correct (read-only reference).
#   - src/*                      -> code (config.ts, nudges.ts) — out of scope.
#   - test/*                     -> out of scope.
#   - VERIFICATION.md            -> frozen report, out of scope.
# This PRP edits AT MOST README.md, and only if a number genuinely drifted (pre-research: it has not).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only verification (Mode B). No code, types, migrations, or config._

### Implementation Tasks (ordered by dependencies)

**Two phases**: (A) re-run the sweep + README/spec verification (read-only), then (B) record the disposition
("verified — no drift" OR a targeted edit if genuine drift surfaced). Run Phase A before judging Phase B.

```yaml
Phase A — RE-CONFIRM THE SWEEP (read-only; run all, then judge)

Task A1: RUN the core 8192/8KB sweep
  - RUN: grep -rnE '8192|8 ?KB' README.md spec/
  - EXPECT (verbatim): EXACTLY these 2 hits, BOTH legitimate historical context:
      spec/07-preventive-and-nudges.md:52: ...The previous default was 8192 (8 KB); it was raised...
      spec/09-configuration.md:66:        ...Raised from 8 KB after observation: the 8 KB default nagged...
  - JUDGE:
      * If the output is EXACTLY those 2 hits → PASS, no stale references. Proceed to A2.
      * If a THIRD hit appears anywhere (README, spec/01/04/05/10/SPEC) → see "If genuine drift is found" below.

Task A2: VERIFY README accuracy (read-only)
  - RUN: grep -niE 'bloat|mulligan_audit|threshold' README.md
  - JUDGE each hit (expected all already-correct):
      91  bloatThresholdBytes = 16384 + per-tool override note .... MUST be 16384
      92  bloatThresholdBytesByTool {bash:32768,read:20480} ...... MUST be 32768/20480
      108 settings.json example (16384/32768/20480) .............. MUST match
      171 audit "flags results above the per-tool bloat threshold"  MUST contain "per-tool"
      204 reminder "per-tool bloat threshold (bash: 32 KB, read: 20 KB, others: 16 KB global default)" MUST match
      (lines 89/90/93/125/129/149 are generic/drift prose — ignore.)
  - IF any of 91/92/108/204 shows a number other than 16384/32768/20480, or 171 lacks "per-tool": THAT is the
    one README edit to make (smallest targeted fix to match src/config.ts:62,109). Pre-research: none will differ.

Task A3: VERIFY per-tool value consistency (read-only)
  - RUN: grep -rnE '32768|20480|32 ?KB|20 ?KB' README.md spec/
  - EXPECT: all hits consistent — {bash:32768, read:20480} / "32 KB" bash / "20 KB" read, across README:92/108/204,
    spec/04:244, spec/05, spec/07:62, spec/09:37/38/67, spec/SPEC.md:155. No mismatched values.

Task A4: CONFIRM no test pins README/spec content (de-risk — defensive)
  - RUN: grep -rniE 'readme|spec/0|spec/SPEC' test/ src/ --include='*.ts' | grep -iE 'readme|spec/'
  - EXPECT: empty or only code/test-internal references (no test asserts README/spec prose). A doc edit cannot
    break vitest/tsc. (This task expects NO edit anyway.)

Phase B — RECORD DISPOSITION (or apply the single targeted edit if genuine drift surfaced)

Task B1 (EXPECTED — the normal path): RECORD "verified — no drift"
  - IF Phase A confirmed only the 2 legitimate historical hits and README/spec values all match ground truth:
    WRITE in the implementation summary a one-line verification:
      "verified — no drift. grep '8192|8 KB' README.md spec/ → only spec/07:52 + spec/09:66 (legitimate
       'raised from' historical context). README:91/92/108/171/204 + per-tool values (32768/20480/32KB/20KB)
       consistent with src/config.ts:62,109. spec/01/04/10 fixed by siblings. No edits required."
  - No file change in this branch.

Task B2 (DEFENSIVE — only if Task A1/A2/A3 found genuine NEW drift): APPLY ONE smallest targeted edit
  - Only if a README number genuinely drifted (e.g. README:91 says 8192 instead of 16384): edit that ONE token
    to match src/config.ts:62,109 (16384 global / {bash:32768, read:20480} per-tool). Smallest possible change.
  - DO NOT edit spec/01, spec/04, spec/10 (sibling-owned — record for the sibling/parent instead).
  - DO NOT edit spec/07:52 or spec/09:66 (legitimate historical context — NEVER "fix" these).
  - DO NOT invent edits beyond fixing a genuinely-stale number/word the sweep found.
  - THEN record the edit made in the summary.
```

### Implementation Patterns & Key Details

```ts
// The sweep is read-only verification. The expected outcome is "verified — no drift" (no file change).
// Ground truth every README/spec number must match:
//   src/config.ts:62   -> JSDoc "Default: 16384 (16 KB)"
//   src/config.ts:109  -> bloatThresholdBytes: 16384
//   src/config.ts:110  -> bloatThresholdBytesByTool: { bash: 32768, read: 20480 }
//   src/nudges.ts:95   -> Object.prototype.hasOwnProperty.call(byTool, toolName)  (BUG-001 guard, COMPLETE)
// Resolution: byTool[toolName] ?? global   (unlisted tool -> global 16 KB; proto-key-safe)

// PATTERN (Mode B verification): re-run the grep sweep; compare against ground truth; record disposition.
//   Do NOT "fix" the 2 legitimate historical-context hits:
//     spec/07:52  "...The previous default was 8192 (8 KB); it was raised..."  <- INTENTIONAL rationale
//     spec/09:66  "...Raised from 8 KB after observation..."                  <- INTENTIONAL rationale
//   These explain WHY the default was raised; removing them would lose calibration history.

// CRITICAL — README:171 already reads "flags results above the per-tool bloat threshold". Unlike bugfix 001
//   (where that qualifier was missing), here it is ALREADY present. There is NO README edit to make.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only verification (Mode B).
  - DATABASE: none
  - CONFIG: none (the sweep VERIFIES docs cite config correctly; it does not change config)
  - ROUTES: none
  - CODE: none (src/*, spec/* are READ-ONLY references; sibling-owned specs are off-limits)
  - The only "integration" is CROSS-DOC CONSISTENCY: README + spec agree with src/config.ts:62,109 /
    src/nudges.ts:95. Validation gates enforce this via grep + full-suite convergence.
  - CHANGESET CONVERGENCE: this subtask runs LAST. `npx vitest run` (Level 3) is the whole-changeset green
    check (BUG-001 guard + BUG-002 spec/04 + BUG-003 spec/01/spec/10 fixes + this sweep together).
  - PARALLEL-SIBLING COORDINATION: P1.M2.T2.S2 edits spec/01 ONLY; P1.M2.T1.S1 edited spec/04 (done);
    P1.M2.T2.S1 edited spec/10 (done). None touch README. This sweep edits at most README (and pre-research
    says it will edit nothing).
```

---

## Validation Loop

This is a documentation verification sweep. Validation = (1) the grep sweep returns only the 2 legitimate
historical hits; (2) README numbers match ground truth; (3) full-suite + tsc as the changeset convergence gate.

### Level 1: the core sweep (the contract check)

```bash
# The BUG-003/BUG-002 contract sweep. Expect EXACTLY 2 hits — both legitimate "raised from" historical context.
grep -rnE '8192|8 ?KB' README.md spec/
```
Expected: only `spec/07-preventive-and-nudges.md:52` and `spec/09-configuration.md:66`, both containing
"raised … from 8 KB" / "previous default was 8192 (8 KB)" rationale. **Zero stale references.** If a third hit
appears, that is drift — but check it is not a sibling-owned file (spec/01/04/10) before considering an edit.

### Level 2: README accuracy + per-tool consistency + de-risk (read-only)

```bash
# (a) README landscape — verify 91/92/108/171/204 against ground truth.
echo "--- README bloat/threshold/audit mentions ---"
grep -niE 'bloat|mulligan_audit|threshold' README.md | grep -E '16384|32768|20480|per-tool bloat threshold|bloatThresholdBytes'

# (b) Ground-truth defaults (every README/spec number must match these).
echo "--- source of truth ---"
grep -n 'Default: 16384' src/config.ts                                   # expect 1 hit (~line 62)
grep -n 'bloatThresholdBytes: 16384' src/config.ts                       # expect 1 hit (~line 109)
grep -n 'bash: 32768, read: 20480' src/config.ts                         # expect 1 hit (~line 110)

# (c) Per-tool value consistency across README + spec (expect uniform 32768/20480 / 32 KB / 20 KB).
echo "--- per-tool values across docs ---"
grep -rnE '32768|20480|32 ?KB|20 ?KB' README.md spec/ | sort

# (d) De-risk: no test pins README/spec prose (a doc edit cannot break the suite).
echo "--- README/spec references in tests (expect none asserting prose) ---"
grep -rniE 'readme|spec/0|spec/SPEC' test/ src/ --include='*.ts' | grep -iE 'readme|spec/' || echo "PASS: no prose-pinning"
```
Expected: README numbers = 16384/32768/20480; line 171 + 204 contain "per-tool bloat threshold"; per-tool values
uniform; ground truth confirmed in src/config.ts; no test pins doc prose.

### Level 3: Full-suite convergence (this subtask runs LAST — the whole-changeset green check)

```bash
# The Mode B sweep is the final changeset gate. Run the FULL suite to confirm ALL prior subtasks' fixes
# (BUG-001 hasOwnProperty guard, BUG-002 spec/04, BUG-003 spec/01/spec/10) are green together with this sweep.
# Baseline per system_context.md §Tech Stack: 742 tests, all passing pre-fix.
npx vitest run
# Equivalent: npm test

# Belt-and-suspenders: confirm the tree still type-checks (the BUG-001 guard lives in src/nudges.ts).
npx tsc --noEmit
```
Expected: `npx vitest run` → all tests pass (0 failures); `npx tsc --noEmit` → exit 0. Since this task expects
NO code/doc edit, a failure here means an EARLIER subtask regressed — investigate root cause; do NOT attribute
it to this verification sweep.

### Level 4: Creative & Domain-Specific Validation
_N/A — documentation-only verification. No MCP/server/browser/perf/security validation applies._

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `grep -rnE '8192|8 ?KB' README.md spec/` → **only** spec/07:52 + spec/09:66 (legitimate history).
- [ ] Level 2(a): README:91/92/108/171/204 verified (16384 / {bash:32768, read:20480} / "per-tool" wording).
- [ ] Level 2(b): `src/config.ts` ground truth confirmed (16384 / {bash:32768, read:20480}).
- [ ] Level 2(c): per-tool values uniform across README + spec (32768/20480 / 32 KB / 20 KB).
- [ ] Level 3: `npx vitest run` → **all pass**; `npx tsc --noEmit` → **exit 0**.

### Feature Validation
- [ ] No stale `8192`/`8 KB` reference remains anywhere in README + spec (modulo the 2 legitimate exceptions).
- [ ] README + spec consistent with the shipped 16384 global + {bash:32768, read:20480} per-tool + proto-key guard.
- [ ] Implementation summary records "verified — no drift" **OR** names any targeted edit (only if re-scan found drift).

### Code Quality / Scope Discipline
- [ ] Made **at most** one smallest-targeted README edit (only if a number genuinely drifted); pre-research: none needed.
- [ ] Did NOT edit `spec/01` (sibling P1.M2.T2.S2), `spec/04` (sibling P1.M2.T1.S1), `spec/10` (sibling P1.M2.T2.S1).
- [ ] Did NOT "fix" spec/07:52 or spec/09:66 (legitimate "raised from" historical context).
- [ ] Did NOT touch `src/*`, `test/*`, config, VERIFICATION.md, or `.pi-subagents/*`.
- [ ] Did NOT invent edits beyond what the re-scan genuinely found.

### Documentation
- [ ] Cross-doc consistency confirmed (README ↔ spec ↔ src/config.ts ↔ src/nudges.ts).
- [ ] A future reader/build agent sees no internal contradiction on the bloat threshold.

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" spec/07:52 ("previous default was 8192 (8 KB)") or spec/09:66 ("Raised from 8 KB") — these are
  **legitimate historical context** explaining the calibration rationale. The contract explicitly excepts them.
- ❌ Don't edit `spec/01` (P1.M2.T2.S2), `spec/04` (P1.M2.T1.S1), or `spec/10` (P1.M2.T2.S1) — sibling-owned. If
  your sweep flags one, record it for the sibling/parent; do not edit it yourself.
- ❌ Don't look for a README:171 "per-tool" edit — it ALREADY says "per-tool bloat threshold". (That was bugfix
  001's concern, not 002's; here it is already correct.)
- ❌ Don't invent edits "to be thorough." The expected outcome is "verified — no drift" with ZERO edits. Only
  fix a number the re-scan proves genuinely drifted.
- ❌ Don't edit VERIFICATION.md (frozen v1.0 DoD report; grep confirmed 0 threshold staleness; out of scope).
- ❌ Don't edit `.pi-subagents/*` (internal agent scratch; not shipped docs).
- ❌ Don't skip the `npx vitest run` + `npx tsc --noEmit` convergence gates — this subtask runs LAST to prove
  the whole changeset is green together.
- ❌ Don't treat the research note as a substitute for re-running the grep — docs may have shifted; re-run Level 1/2.

---

## Confidence Score

**10/10** for one-pass implementation success. The sweep is exhaustive and pre-researched: the contract grep
returns **exactly** the 2 legitimate historical-context hits (verbatim file:line documented), per-tool values are
verified uniform across all 9 doc sites, README is confirmed fully correct (incl. line 171 already "per-tool"),
the shipped ground truth (16384 / {bash:32768, read:20480} / hasOwnProperty guard at nudges.ts:95) is cited, the
sibling-owned files (spec/01/04/10) are explicitly fenced off, and the expected outcome ("verified — no drift",
zero edits) is unambiguous. The convergence gates (vitest 742+ / tsc) are deterministic. Residual risk — docs
shifting between research and implementation — is handled by Phase A's mandatory re-scan before any disposition,
with a defensive single-edit branch (B2) bounded by strict scope rules (never the 2 historical exceptions, never
sibling files).