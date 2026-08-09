# PRP — P1.M2.T2.S1: Update stale '8 KB default' comments/titles in test/tokens.test.ts & test/notes.test.ts (BUG-004)

## Goal

**Feature Goal**: Correct three **factually-wrong comments/test-titles** in `test/tokens.test.ts` and
`test/notes.test.ts` that still call `8192` / "8 KB" **"the default"** bloat threshold. After P2 raised the
global default from `8192` to `16384` (16 KB), these comments/titles are stale. The test **CODE is correct**
(it passes `8192` as an **explicit argument** to the pure helpers `approxTokens` / `renderBloatReminder` —
that is valid test input); only the **prose** ("default") is wrong and must be fixed so a future reader is not
misled into thinking `8192` is still the default.

**Deliverable**: A **comment-and-title-only** edit (Mode A, documentation fix) to **exactly two files**:
- `test/tokens.test.ts` — **1 comment** (line 334)
- `test/notes.test.ts` — **2 test `it(...)` titles** (lines 411 and 474)

No assertions, no `expect(...)` calls, no helper arguments, no imports, no other files.

**Success Definition**: After the edit, (a) all three sites no longer claim `8192`/8 KB is "the default"; (b) an
exhaustive grep for `default bloatThresholdBytes|8 KB default threshold` across the two files returns **0 hits**;
(c) `npx vitest run test/tokens.test.ts test/notes.test.ts` **still passes unchanged** (no behavioral change);
(d) no file other than these two test files is modified; (e) no test assertion or helper argument is changed.

## User Persona

**Target User**: A future developer/QA engineer reading the test suite to understand bloat-threshold behavior.

**Use Case**: Reading `test/tokens.test.ts` / `test/notes.test.ts` to learn how `approxTokens` /
`renderBloatReminder` behave and what the current bloat-threshold default is.

**Pain Points Addressed**: Today the comments say `8192`/8 KB is "the default", but the real default is
`16384` (16 KB) — a reader is misled into wiring or reasoning against the wrong number.

## Why

- BUG-004 is a **documentation defect in the test files** (test comments/titles ARE documentation for future
  readers). Stale "default" wording can mislead a future reader into thinking `8192` is still the global
  bloat-threshold default and wiring logic/spec against it.
- The current global default is `16384` (16 KB); per-tool overrides are `bash: 32768` (32 KB) /
  `read: 20480` (20 KB) — confirmed in `src/config.ts:62` and `spec/09-configuration.md:35,66,67`.
- The test code is **correct as-is**: `8192` is passed as an **explicit argument** to pure helpers
  (`approxTokens`, `renderBloatReminder`); that is a valid test input regardless of the default. We do **not**
  need to change any assertion or argument — only the misleading prose.
- **No business logic, no code, no new tests.** Pure documentation/comment fix (Mode A). Validated by running
  the two affected test files (green stays green).

## What

Three surgical **text-only** edits (1 comment + 2 test titles). No line is moved, renumbered, or structurally
changed. The `8192` numeric literals inside the assertions/titles are **preserved** (they are correct test
inputs); only the word "default" / the "the default bloatThresholdBytes" claim is removed/rephrased.

### Success Criteria

- [ ] `test/tokens.test.ts:334` comment no longer calls `8192` "the default bloatThresholdBytes".
- [ ] `test/notes.test.ts:411` title no longer contains "8 KB default threshold".
- [ ] `test/notes.test.ts:474` title no longer contains "8 KB default threshold".
- [ ] `grep -nE 'default bloatThresholdBytes|8 KB default threshold' test/tokens.test.ts test/notes.test.ts`
      → **0 hits**.
- [ ] `npx vitest run test/tokens.test.ts test/notes.test.ts` → **all green** (unchanged from before).
- [ ] No `expect(...)` call, helper argument, import, or assertion is modified.
- [ ] No file other than `test/tokens.test.ts` and `test/notes.test.ts` is touched.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current text** of all three target lines, the **verbatim desired
replacement text**, the authoritative source-of-truth fact (default is now `16384`), and deterministic
grep + vitest validation gates. The implementer needs no codebase exploration beyond opening the two test files.

### Documentation & References

```yaml
# MUST EDIT — the only two files this PRP modifies (comment/title only)
- file: test/tokens.test.ts
  why: Line 334 carries a stale comment "// the default bloatThresholdBytes → ~2k tokens" next to
        approxTokens(8192). 8192 is no longer the default; the comment misleads.
  section: "describe(\"approxTokens …\") block, the test that reproduces spec/07 §1's 8 KB≈2k equivalence."
  pattern: "pure helper test; 8192 is an EXPLICIT arg, not the default. Keep the assertion; fix only the comment."
  gotcha: "DO NOT change `approxTokens(8192)` or `.toBe(2048)` — both are correct. Edit ONLY the `// …` comment."

- file: test/notes.test.ts
  why: Lines 411 and 474 carry two test titles containing '8 KB default threshold'. renderBloatReminder is
        called with 8192 as an EXPLICIT threshold arg; 8192 is not the default.
  section: "describe(\"renderBloatReminder …\") and describe(\"renderBloatReminder — snapshot-style …\")."
  pattern: "pure helper tests; the 8192 threshold is passed explicitly to renderBloatReminder. Keep the
            assertions/args; fix ONLY the `it(\"…\")` title strings."
  gotcha: "Line 411 title is long and contains an arrow (→) and an escaped \\\\n---\\\\n sequence. When
           replacing, preserve everything in the title EXCEPT the phrase '8 KB result at the 8 KB default
           threshold' → '8 KB result at an 8 KB threshold'. Do NOT alter the assertion body or args."

# MUST READ — authoritative source-of-truth: the current default IS 16384 (not 8192)
- file: src/config.ts
  why: Line 62 documents `Default: 16384 (16 KB). Per-tool overrides in bloatThresholdBytesByTool`. Proves
        8192 is NOT the default.
  section: "bloatThresholdBytes field JSDoc (~line 62). READ-ONLY — do NOT edit src/*."
  critical: "8192 (8 KB) is the OLD default; 16384 (16 KB) is the CURRENT global default. This is the single
             fact that makes the three comments/titles wrong."

# MUST READ — the defaults table (cross-check the KB figures)
- file: spec/09-configuration.md
  why: Line 35 (`\"bloatThresholdBytes\": 16384`), line 66 (defaults table: 16384), line 67 (per-tool
        bash 32768 / read 20480). Confirms why "8 KB default" is stale.
  section: "§2 defaults table + §4 config example. READ-ONLY — do NOT edit spec/* (spec/05 owned by P1.M1.T2.S1)."

# MUST READ — the PRD/contract for BUG-004
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/architecture/bug_analysis.md
  why: BUG-004 section lists the three affected sites + fix approach (drop the "default" claim; do NOT change
        assertions or the 8192 args).
  critical: "Notes the PRD typo 'test/notes.ts:474' — the real file is test/notes.test.ts:474 (no test/notes.ts)."

# CONTEXT — the parallel sibling (no file conflict; cites same threshold source-of-truth)
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/P1M2T1S1/PRP.md
  why: CONTRACT. Edits ONLY test/integration/scenarios.md. No overlap with this PRP's files. Cites the same
        thresholds (16384 / 32768 / 20480); this PRP must cite identical numbers for cross-doc consistency.
```

### Current Codebase tree (the only relevant slice)

```bash
test/
├── tokens.test.ts   # ← EDIT line 334 comment ONLY (1 edit)
├── notes.test.ts    # ← EDIT lines 411 and 474 test titles ONLY (2 edits)
└── integration/
    └── scenarios.md # READ-ONLY — owned by parallel sibling P1.M2.T1.S1 (DO NOT touch)
src/config.ts        # READ-ONLY — proves default is 16384 (line 62)
spec/09-configuration.md  # READ-ONLY — defaults table (16/32/20 KB)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a COMMENT/TITLE-ONLY edit. The test code is CORRECT.
#   - 8192 is passed as an EXPLICIT argument to pure helpers (approxTokens, renderBloatReminder).
#   - That is valid test input regardless of the config default. DO NOT change any 8192 literal, any
#     .toBe(...) assertion, any renderBloatReminder(...) call, or any import.

# CRITICAL: the real default is now 16384 (16 KB) — confirmed:
#   src/config.ts:62         -> "Default: 16384 (16 KB)"
#   spec/09-configuration.md  -> bloatThresholdBytes: 16384; per-tool bash 32768 / read 20480
# So 8192 (8 KB) is the OLD default. The prose claiming 8192 is "the default" is factually wrong.

# GOTCHA: PRD/bug_analysis references "test/notes.ts:474" — there is NO test/notes.ts.
#   The real file is test/notes.test.ts:474. (src/notes.ts is the source file, not under test/.)

# GOTCHA (vitest v1): test `it("title")` strings are NOT asserted on — editing a title never fails a test.
#   Likewise `// comments` are ignored. So this edit is provably non-behavioral; the suite stays green.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/05-tools.md        -> owned by P1.M1.T2.S1 (already COMPLETE).
#   - spec/07, spec/09        -> read-only reference.
#   - src/* (incl. src/config.ts, src/nudges.ts, src/tools/audit.ts) -> code, out of scope.
#   - test/integration/scenarios.md -> owned by parallel sibling P1.M2.T1.S1.
#   - Any other test/*.test.ts file.
#   - Any test assertion / expect() / helper argument / import.
# This PRP edits ONLY test/tokens.test.ts and test/notes.test.ts (comment/titles).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — comment/title-only edit (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

Three independent exact find/replace edits. **Verify each `FIND` string matches verbatim before replacing.**
Apply in any order (they are independent and in different files / non-adjacent lines).

```yaml
Task 1: EDIT test/tokens.test.ts — line 334 (stale comment next to approxTokens(8192))
  - FIND (verbatim current — note the 4-space indent and the → arrow):
      "    expect(approxTokens(8192)).toBe(2048); // the default bloatThresholdBytes → ~2k tokens"
  - REPLACE WITH:
      "    expect(approxTokens(8192)).toBe(2048); // explicit 8 KB (old default) → ~2k tokens"
  - RATIONALE: 8192 is no longer the default (now 16384); it is passed as an EXPLICIT arg to approxTokens.
    Drop the "the default bloatThresholdBytes" claim; note it is the old default for historical context.
  - ACCEPTABLE ALTERNATIVES (equally valid): "// explicit 8 KB → ~2k tokens"  OR
    "// 8192 bytes (old default) → ~2k tokens". Any wording that does NOT call 8192 the current default.
  - PRESERVE: the 4-space leading indent, the full assertion `expect(approxTokens(8192)).toBe(2048);`,
    and the `→ ~2k tokens` suffix. Change ONLY the comment wording.
  - DO NOT: alter the 8192 literal or the 2048 expectation — both are correct.

Task 2: EDIT test/notes.test.ts — line 411 (renderBloatReminder test title)
  - FIND (verbatim current — the title is long; match the WHOLE it(...) opening line):
      "  it(\"8 KB result at the 8 KB default threshold → '~8 KB … (threshold 8 KB)'; leading \\\\n---\\\\n; no trailing newline\", () => {"
  - REPLACE WITH (change ONLY the leading title phrase; keep the rest of the line byte-identical):
      "  it(\"8 KB result at an 8 KB threshold → '~8 KB … (threshold 8 KB)'; leading \\\\n---\\\\n; no trailing newline\", () => {"
  - RATIONALE: renderBloatReminder(\"read\", 8192, 8192) passes 8192 as an EXPLICIT threshold; 8192 is not
    the default. Drop the word "default".
  - PRECISE SUBSTRING CHANGE: "8 KB result at the 8 KB default threshold"  ->  "8 KB result at an 8 KB threshold"
    (i.e. "at the 8 KB default threshold" -> "at an 8 KB threshold"). Everything after the arrow (→) is UNCHANGED.
  - PRESERVE: the 2-space indent, the `it(\"…\", () => {` wrapper, the arrow `→`, the quoted fragment
    `'~8 KB … (threshold 8 KB)'`, the `leading \\n---\\n; no trailing newline` clause, and the entire
    test BODY (the renderBloatReminder(...) call + expect(...) chain). Edit ONLY the title string.
  - DO NOT: change the 8192 args to renderBloatReminder or any expectation.

Task 3: EDIT test/notes.test.ts — line 474 (renderBloatReminder snapshot-style test title)
  - FIND (verbatim current):
      "  it(\"representative 30 KB read at the 8 KB default threshold\", () => {"
  - REPLACE WITH:
      "  it(\"representative 30 KB read at an 8 KB threshold\", () => {"
  - RATIONALE: renderBloatReminder(\"read\", 30720, 8192) passes 8192 as an EXPLICIT threshold; 8192 is not
    the default. Drop the word "default".
  - PRECISE SUBSTRING CHANGE: "representative 30 KB read at the 8 KB default threshold"
    -> "representative 30 KB read at an 8 KB threshold"
    (i.e. "at the 8 KB default threshold" -> "at an 8 KB threshold"). The "30 KB read" framing stays — 30720
    bytes is the test's explicit result size.
  - PRESERVE: the 2-space indent, the `it(\"…\", () => {` wrapper, and the entire test BODY (the
    renderBloatReminder(\"read\", 30720, 8192) call + the toMatchInlineSnapshot(`…`) block). Edit ONLY the title.
  - DO NOT: change the 30720 or 8192 args, or touch the inline snapshot.
```

### Implementation Patterns & Key Details

```ts
// The pure helpers under test take EXPLICIT numeric args — 8192 is valid input, just not "the default":
//   approxTokens(bytes: number): number                       // test/tokens.test.ts:334 -> approxTokens(8192)
//   renderBloatReminder(toolName, bytes, thresholdBytes): string
//       // test/notes.test.ts:411 -> renderBloatReminder("read", 8192, 8192)
//       // test/notes.test.ts:474 -> renderBloatReminder("read", 30720, 8192)
// The CURRENT default threshold lives in config, not in these calls:
//   src/config.ts:62  -> Default: 16384 (16 KB). Per-tool overrides in bloatThresholdBytesByTool (bash/read).

// PATTERN (comment/title edit): keep all numbers and assertions; reword only the misleading prose.
//   Bad:  "// the default bloatThresholdBytes → ~2k tokens"
//   Good: "// explicit 8 KB (old default) → ~2k tokens"
//   Bad:  "8 KB result at the 8 KB default threshold …"
//   Good: "8 KB result at an 8 KB threshold …"

// CRITICAL — do NOT "fix" the tests by changing 8192 -> 16384. The 8192 inputs are intentional explicit
// args; the tests assert specific pinned output for an 8 KB case. Changing the input would alter the
// pinned snapshot/expectations and break them. The ONLY defect is the word "default" in the prose.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — comment/title-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the comments CITE the old default but do not change config)
  - ROUTES: none
  - CODE: none (src/*, spec/* are READ-ONLY references; owned elsewhere / out of scope)
  - The only "integration" is CROSS-DOC CONSISTENCY: the test prose must agree with src/config.ts:62 and
    spec/09-configuration.md (default is 16384, not 8192). Validation gates below enforce this via grep.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S1 edits test/integration/scenarios.md ONLY — no file overlap
    with this PRP. Both cite the same threshold source-of-truth (16384 / 32768 / 20480).
```

---

## Validation Loop

This is a comment/title edit to two `.test.ts` files. Validation = (1) grep that the stale wording is gone;
(2) vitest run confirming the two affected test files still pass (no behavioral change). No build step needed.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm each edit landed (print the updated lines):
sed -n '334p' test/tokens.test.ts
sed -n '411p' test/notes.test.ts
sed -n '474p' test/notes.test.ts
```
Expected: line 334 comment no longer says "the default bloatThresholdBytes"; line 411 and 474 titles now read
"8 KB result at an 8 KB threshold" and "representative 30 KB read at an 8 KB threshold" respectively.

### Level 2: Stale-content gate (the core BUG-004 checks)

```bash
# (a) No stale "default" wording remains in EITHER file (the three target sites):
grep -nE 'default bloatThresholdBytes|8 KB default threshold' test/tokens.test.ts test/notes.test.ts \
  && echo "FAIL: stale default wording remains" || echo "PASS: no stale default wording"

# (b) Sanity: the three edit sites still reference the (correct) 8192/8 KB inputs we did NOT remove:
grep -n 'approxTokens(8192)' test/tokens.test.ts            # expect 1 hit at ~line 334
grep -n 'renderBloatReminder("read", 8192, 8192)' test/notes.test.ts    # expect a hit at ~line 412 (body)
grep -n 'renderBloatReminder("read", 30720, 8192)' test/notes.test.ts   # expect a hit at ~line 475 (body)
```
Expected: (a) PASS (0 hits for the stale phrases); (b) the 8192 inputs and helper calls are still present
(we did NOT change any argument).

### Level 3: Unit Tests (component validation — prove no behavioral change)

```bash
# Run the two affected test files (vitest v1). Expect: ALL PASS, unchanged from before.
npx vitest run test/tokens.test.ts test/notes.test.ts

# Equivalent alternative via npm script:
# npm run test -- test/tokens.test.ts test/notes.test.ts
```
Expected: all tests in both files pass. Because we changed only a comment and two `it("title")` strings
(vitest does not assert on titles or comments), the result MUST be identical to the pre-edit run. If any test
fails, a comment/title was accidentally edited into an assertion/arg — re-read the diff and fix.

### Level 4: Cross-doc consistency (system validation)

```bash
# The corrected prose must agree with the source-of-truth default (16384, not 8192).
echo "--- source of truth: current default ---"
grep -n 'Default: 16384' src/config.ts                       # expect a hit (~line 62)
grep -n '"bloatThresholdBytes": 16384' spec/09-configuration.md   # expect a hit (~line 35)

echo "--- confirm the two test files no longer claim 8 KB is the default ---"
grep -niE 'default.*8 ?KB|8 ?KB.*default' test/tokens.test.ts test/notes.test.ts \
  && echo "FAIL: still claims 8 KB default" || echo "PASS: test prose agrees with 16384 default"

echo "--- confirm PRD-typo file does not exist (real file is test/notes.test.ts) ---"
ls test/notes.ts 2>/dev/null && echo "FAIL: unexpected test/notes.ts" || echo "PASS: no test/notes.ts"
```
Expected: source-of-truth shows `16384`; the two test files have no "8 KB … default" / "default … 8 KB" claim;
no `test/notes.ts` exists.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '334p' test/tokens.test.ts` and `sed -n '411p;474p' test/notes.test.ts` show updated prose.
- [ ] Level 2(a): `grep -nE 'default bloatThresholdBytes|8 KB default threshold' test/tokens.test.ts test/notes.test.ts`
      → **0 hits**.
- [ ] Level 2(b): the `approxTokens(8192)` and `renderBloatReminder(..., 8192[, 8192])` calls are still present.
- [ ] Level 3: `npx vitest run test/tokens.test.ts test/notes.test.ts` → **all pass** (unchanged).

### Feature Validation
- [ ] `test/tokens.test.ts:334` comment no longer claims 8192 is the default.
- [ ] `test/notes.test.ts:411` title reads "8 KB result at an 8 KB threshold …" (no "default").
- [ ] `test/notes.test.ts:474` title reads "representative 30 KB read at an 8 KB threshold" (no "default").
- [ ] No `expect(...)`, assertion, helper argument, import, or test body changed.
- [ ] No file other than `test/tokens.test.ts` and `test/notes.test.ts` modified.

### Code Quality / Scope Discipline
- [ ] Did NOT change any `8192` / `2048` / `30720` literal or any `renderBloatReminder(...)` / `approxTokens(...)`
      call — these are correct test inputs.
- [ ] Did NOT touch `spec/*` (spec/05 owned by P1.M1.T2.S1 [complete]; spec/07, spec/09 read-only).
- [ ] Did NOT touch `src/*` (config.ts, nudges.ts, audit.ts — out of scope).
- [ ] Did NOT touch `test/integration/scenarios.md` (owned by parallel sibling P1.M2.T1.S1).
- [ ] Did NOT touch any other `test/*.test.ts` file.
- [ ] Did NOT "fix" the tests by changing `8192` → `16384` (that would break pinned assertions/snapshots).

### Documentation
- [ ] Test prose now agrees with the shipped default (`16384` per `src/config.ts:62` / `spec/09-configuration.md`).
- [ ] A future reader is no longer misled into thinking `8192`/8 KB is the current default.

---

## Anti-Patterns to Avoid

- ❌ Don't change `8192` → `16384` in the test inputs — the 8192 args are **intentional explicit** test inputs
  with pinned output; changing them breaks the assertions / inline snapshot. The ONLY defect is the word
  "default" in the prose.
- ❌ Don't alter any `expect(...)`, `.toBe(...)`, `.toContain(...)`, or `.toMatchInlineSnapshot(...)` — the test
  CODE is correct; only the comment/titles are wrong.
- ❌ Don't edit any file other than `test/tokens.test.ts` and `test/notes.test.ts`.
- ❌ Don't edit `test/integration/scenarios.md` (parallel sibling P1.M2.T1.S1 owns it).
- ❌ Don't leave ANY of the three sites still containing "default" — all three must be fixed (grep gate enforces).
- ❌ Don't reword beyond dropping "default" / "the default bloatThresholdBytes" — keep the existing
  phrasing style and the `→ ~2k tokens` / `30 KB read` framings intact.

---

## Confidence Score

**10/10** for one-pass implementation success. This is a 3-spot comment/title edit with verbatim find/replace
strings for every spot, the authoritative source-of-truth fact (default is `16384`, proven in `src/config.ts:62`
and `spec/09-configuration.md:35,66`), exhaustive grep confirming exactly 3 sites (no others), the
parallel-sibling contract (P1.M2.T1.S1 edits a non-overlapping file), and deterministic grep + vitest
validation gates. The change is provably non-behavioral (vitest does not assert on titles or comments), so the
suite is guaranteed to stay green. The only residual risk — accidentally editing an assertion/arg instead of
just the prose — is explicitly called out as a DO-NOT in every task and caught by the Level 2(b) grep + Level 3
vitest run.