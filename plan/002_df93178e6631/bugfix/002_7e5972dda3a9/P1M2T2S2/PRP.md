# PRP — P1.M2.T2.S2: Fix spec/01-pi-context-internals.md:197 bloat threshold rationale from 8 KB to 16 KB (BUG-003b)

## Goal

**Feature Goal**: Correct the **stale `8 KB`** figure in the design-rationale sentence of `spec/01-pi-context-internals.md`
§9 ("Built-in tool truncation") to the shipped global default of **`16 KB`** (16384 bytes). After the P2 per-tool
bloat-threshold changeset raised the global default from `8192` (8 KB) to `16384` (16 KB), this one sentence was left
stale, presenting `8 KB` as the default example — contradicting `spec/07:52`, `spec/09:66`, and `src/config.ts:62,109`.

**Deliverable**: A **single in-place edit** to **one substring** on **exactly one line** of **exactly one file** —
`spec/01-pi-context-internals.md:197` — changing the parenthetical substring `(e.g. 8 KB in-context)` to
`(e.g. 16 KB in-context)`. The precise substring swap is `8 KB` → `16 KB` **inside** that parenthetical. No other word,
line, file, code, or test changes.

**Success Definition**: After the edit, (a) `spec/01-pi-context-internals.md:197` reads `(e.g. 16 KB in-context)`;
(b) `grep -n '8 KB' spec/01-pi-context-internals.md` → **0 hits**; (c) every other token on line 197 — the
"50 KB cap" figure, the "meaningful-but-not-catastrophic bloat" tail, and the `See \`@09-configuration.md\`.` link —
is **byte-identical** to before; (d) no file other than `spec/01-pi-context-internals.md` is modified.

## User Persona

**Target User**: A developer or architect reading `spec/01-pi-context-internals.md` §9 to understand the *design
rationale* for why Mulligan's bloat threshold sits where it does relative to Pi's built-in 50 KB truncation cap.

**Use Case**: Reasoning about the bloat-threshold calibration — "the global default is 16 KB because that sits
comfortably below the 50 KB built-in cap but still catches meaningful-but-not-catastrophic bloat."

**Pain Points Addressed**: Today the sentence cites `8 KB` as the example default — but the shipped global default is
`16384` (16 KB), so a reader would reconstruct the wrong threshold / wrong design intent and would find the figure
contradicted by `spec/07`, `spec/09`, and `src/config.ts`.

## Why

- BUG-003(b) is a **documentation defect** — the spec's design-rationale paragraph contradicts the shipped default and
  the two already-correctly-updated companion specs. Per PRD §0, the companion `spec/*` files concatenate into the
  omnibus specification, so an internal contradiction is a real defect for a future reader/build agent.
- The correct figure is the **global default** `16384` = 16 KB (`src/config.ts:62,109`; `spec/07:52`; `spec/09:66`).
  The sentence is a *design-rationale example* ("e.g. ..."), so the global default (16 KB) is the correct number to cite
  — the same single threshold the §9 paragraph has always been about.
- **No business logic, no code, no tests, no build.** Pure documentation fix (Mode A).

## What

One exact substring replacement inside one sentence. The sentence is the final sentence of `spec/01-pi-context-internals.md`
§9. The change touches ONLY the parenthetical `(e.g. 8 KB in-context)` → `(e.g. 16 KB in-context)`.

### Success Criteria

- [ ] `spec/01-pi-context-internals.md:197` reads `... (e.g. 16 KB in-context) so it catches ...`.
- [ ] `grep -n '8 KB' spec/01-pi-context-internals.md` → **0 hits**.
- [ ] `grep -n '16 KB in-context' spec/01-pi-context-internals.md` → ≥1 hit (line 197).
- [ ] The `50 KB cap` figure, the `meaningful-but-not-catastrophic bloat` tail, and the
      `See \`@09-configuration.md\`.` cross-reference on line 197 are **byte-identical** to before.
- [ ] No file other than `spec/01-pi-context-internals.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current line** (target), the **verbatim desired line** (after edit), the
authoritative source-of-truth facts (16384 / 16 KB) with exact file/line citations, an exhaustive grep proving only one
stale site exists in spec/01, and deterministic grep validation gates. The implementer needs no codebase exploration
beyond opening `spec/01-pi-context-internals.md` at line 197.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this PRP modifies
- file: spec/01-pi-context-internals.md
  why: Line 197 is the §9 "Built-in tool truncation" design-rationale paragraph; its last sentence carries the stale
        "(e.g. 8 KB in-context)" parenthetical.
  section: "## 9. Built-in tool truncation (calibrates the \"bloat\" problem) — the single paragraph is line 197."
  pattern: "Prose paragraph, not a table. The target is ONE parenthetical: (e.g. 8 KB in-context). Change ONLY the
            '8 KB' token to '16 KB' inside the parentheses; leave 'e.g.', 'in-context', the parentheses, and every
            other word untouched."
  gotcha: "DO NOT touch the '50 KB / 2000 lines' figure at the START of the same line — that is Pi's BUILT-IN cap and
           is correct. DO NOT touch the 'See @09-configuration.md.' cross-reference. DO NOT reword the sentence —
           change only the substring '8 KB' → '16 KB' within the parenthetical example."

# MUST READ — authoritative source-of-truth: the global default IS 16384 (16 KB)
- file: src/config.ts
  why: Line 62 (JSDoc 'Default: 16384 (16 KB)') + line 109 (DEFAULT_CONFIG: bloatThresholdBytes: 16384).
        Proves 8192/8 KB is the OLD default and 16384/16 KB is the CURRENT default.
  section: "MulliganConfig.nudges.bloatThresholdBytes JSDoc (~line 55-64) + DEFAULT_CONFIG (~line 109-110).
            READ-ONLY — do NOT edit src/*."
  critical: "16384 (16 KB) is the shipped global default. This single fact makes '8 KB' stale/wrong."

# MUST READ — the two already-correctly-updated companion specs (cross-check the 16 KB figure)
- file: spec/07-preventive-and-nudges.md
  why: Line 52 — 'Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context)'. Confirms 16 KB.
  section: "§'Threshold default & calibration' (~line 51-52). READ-ONLY — already correct."
  critical: "spec/01's new '16 KB' must AGREE with this line."

- file: spec/09-configuration.md
  why: Line 66 — defaults table: '`16384` (16 KB) | Global catch-all for tools without a per-tool override.'
        Line 67 — per-tool map {bash:32768, read:20480}. Confirms 16 KB global + per-tool overrides.
  section: "§2 defaults table (~line 66-67). READ-ONLY — already correct."
  critical: "spec/01's new '16 KB' must AGREE with this line. The §9 sentence is a GLOBAL-threshold rationale
             ('comfortably below the built-in 50 KB cap'), so the global default (16 KB) is the right figure —
             NOT the per-tool overrides (read 20 KB / bash 32 KB)."

# MUST READ — the PRD/contract for BUG-003
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/architecture/system_context.md
  why: §BUG-003 'Location 2' (lines 73-75) prescribes the exact fix verbatim:
        Current: `(e.g. 8 KB in-context)` → Should be: `(e.g. 16 KB in-context)`.
        (Location 1 = spec/10:67 is OUT OF SCOPE here — owned by sibling P1.M2.T2.S1.)
  critical: "This PRP addresses ONLY spec/01-pi-context-internals.md:197 (Location 2). spec/10:67 (Location 1) is
             owned by the sibling P1.M2.T2.S1 — do NOT touch it."

# CONTEXT — parallel siblings (no file conflict)
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/P1M2T2S1/PRP.md
  why: CONTRACT. Edits spec/10-testing.md:67 ONLY (the >8KB → >16KB cell). No overlap with spec/01. Cites the same
        16384 / per-tool source-of-truth; this PRP must cite identical numbers for cross-doc consistency.
  critical: "Note the sibling's change uses NO SPACE (>8KB → >16KB). THIS PRP's change uses a SPACE: '8 KB' → '16 KB'
             (matching the existing '8 KB' / '16 KB' / '50 KB' spaced style of spec/01's prose). Do NOT copy the
             sibling's no-space form into spec/01."
```

### Current Codebase tree (the only relevant slice)

```bash
spec/
├── 01-pi-context-internals.md # ← EDIT line 197 ONLY (§9 rationale parenthetical: (e.g. 8 KB in-context) → (e.g. 16 KB in-context))
├── 07-preventive-and-nudges.md# READ-ONLY — line 52 already says 16384 (16 KB) — cross-ref source-of-truth
├── 09-configuration.md        # READ-ONLY — lines 66-67 already say 16384 + per-tool map — cross-ref
├── 04-data-model.md           # READ-ONLY — owned by sibling P1.M2.T1.S1 (DO NOT touch)
└── 10-testing.md              # READ-ONLY — line 67 owned by sibling P1.M2.T2.S1 (DO NOT touch)
src/config.ts                  # READ-ONLY — proves default is 16384 (lines 62, 109)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a SINGLE-SUBSTRING edit inside ONE parenthetical of ONE sentence.
#   FIND:  (e.g. 8 KB in-context)
#   REPLACE: (e.g. 16 KB in-context)
#   Precise token change: "8 KB"  ->  "16 KB"   (i.e. insert "16" before " KB", keep the space).
#   That is the ENTIRE change. Do not reword the sentence, do not touch any other token.

# CRITICAL (STYLE — DO NOT MISMATCH THE SIBLING): spec/01 uses the SPACED form ("8 KB", "16 KB", "50 KB")
#   throughout its prose. The sibling PRP P1.M2.T2.S1 edits spec/10 which uses the NO-SPACE form (>8KB → >16KB).
#   Do NOT blindly copy the sibling's no-space replacement. In THIS file the correct replacement is:
#     "8 KB"  ->  "16 KB"     (space preserved)
#   Verbatim existing parenthetical to match: "(e.g. 8 KB in-context)"
#   Verbatim replacement parenthetical:       "(e.g. 16 KB in-context)"

# CRITICAL: the global default is 16384 (16 KB) — confirmed:
#   src/config.ts:62,109            -> "Default: 16384 (16 KB)" + DEFAULT_CONFIG bloatThresholdBytes: 16384
#   spec/07-preventive-and-nudges.md:52 -> "Default bloatThresholdBytes = 16384 (16 KB ≈ 4k tokens)"
#   spec/09-configuration.md:66      -> defaults table "16384 (16 KB)"
# So "8 KB" is the OLD (pre-P2) default; "16 KB" is the shipped global default.

# GOTCHA: the §9 sentence is a GLOBAL-threshold design rationale ("should default comfortably below the built-in
#   50 KB cap"). It describes the single global default — so the GLOBAL figure (16 KB) is correct to cite, NOT the
#   per-tool overrides (read 20 KB / bash 32 KB). Do NOT write "16 KB / 20 KB / 32 KB" or any per-tool list here;
#   the parenthetical has always been a single "(e.g. <global> in-context)" example.

# GOTCHA: the SAME line 197 opens with "50 KB / 2000 lines" — that is Pi's BUILT-IN truncation cap and is CORRECT.
#   Do NOT change "50 KB". Only the "(e.g. 8 KB in-context)" parenthetical (near the END of the line) is stale.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/10-testing.md:67                -> owned by sibling P1.M2.T2.S1 (>8KB → >16KB).
#   - spec/04-data-model.md:243            -> owned by sibling P1.M2.T1.S1.
#   - spec/07, spec/09                      -> already correct (READ-ONLY reference).
#   - src/*                                 -> code, out of scope.
#   - Any other paragraph/section of spec/01 (only line 197 carries a stale "8 KB").
# This PRP edits ONLY spec/01-pi-context-internals.md:197.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only edit (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

One task; one exact substring replacement. **Verify the `FIND` substring matches verbatim before replacing.** The whole
target sentence is the last sentence of a long single-line paragraph (the entire §9 paragraph is on line 197), so anchor
on the parenthetical to stay surgical.

```yaml
Task 1: EDIT spec/01-pi-context-internals.md — line 197 (§9 rationale parenthetical: 8 KB → 16 KB)
  - FIND (verbatim current — the FULL sentence to anchor unambiguously; it is the LAST sentence of the line):
      "Mulligan's bloat threshold should default comfortably below the built-in 50 KB cap (e.g. 8 KB in-context) so it catches meaningful-but-not-catastrophic bloat. See `@09-configuration.md`."
  - REPLACE WITH (the FULL sentence after edit — identical EXCEPT "8 KB" → "16 KB" inside the parenthetical):
      "Mulligan's bloat threshold should default comfortably below the built-in 50 KB cap (e.g. 16 KB in-context) so it catches meaningful-but-not-catastrophic bloat. See `@09-configuration.md`."
  - PRECISE SUBSTRING CHANGE: "(e.g. 8 KB in-context)"  ->  "(e.g. 16 KB in-context)"
      (equivalently, just "8 KB" → "16 KB" within that parenthetical — space preserved).
  - RATIONALE: the shipped global default is 16384 = 16 KB (src/config.ts:62,109; spec/07:52; spec/09:66).
    The §9 sentence is a GLOBAL-threshold design rationale ("comfortably below the built-in 50 KB cap"), so the
    global default (16 KB) is the correct figure. Per-tool overrides (read 20 KB / bash 32 KB) are higher and are
    NOT what this single-example parenthetical describes. Matches architecture/system_context.md §BUG-003
    'Location 2' prescription verbatim.
  - PRESERVE: the "Mulligan's bloat threshold should default comfortably below the built-in 50 KB cap" prefix
    (including the CORRECT "50 KB" built-in-cap figure); the "e.g." lead-in; the "in-context" qualifier; the
    parentheses themselves; the "so it catches meaningful-but-not-catastrophic bloat." tail; and the
    "See `@09-configuration.md`." cross-reference (BYTE-IDENTICAL).
  - DO NOT: change "8 KB" anywhere else, change "50 KB", touch any other sentence/section, or edit any other file.
    Do NOT reword beyond the "8 KB" → "16 KB" token swap. Do NOT remove the space ("16 KB", NOT "16KB").
```

### Implementation Patterns & Key Details

```ts
// The shipped config (source-of-truth) — proves "16 KB" is correct for the global-rationale sentence:
//   src/config.ts:109    bloatThresholdBytes: 16384,                         // global default = 16 KB
//   src/config.ts:110    bloatThresholdBytesByTool: { bash: 32768, read: 20480 },  // per-tool overrides
//   bloatThresholdFor(toolName, config): byTool[toolName] ?? global           // unlisted tool → global 16 KB
// The §9 sentence ("should default comfortably below the built-in 50 KB cap (e.g. ? in-context)") describes the
// GLOBAL default, so "16 KB" is the correct example to cite.
// (Do NOT cite 20 KB / 32 KB — those are the read/bash overrides, not the global default.)

// PATTERN (spec-doc fix): keep all surrounding structure; swap only the stale numeric token, preserving style.
//   spec/01 prose style is SPACED ("8 KB", "16 KB", "50 KB"). So:
//   Bad:  ... (e.g. 8 KB in-context) ...        // stale OLD default
//   Good: ... (e.g. 16 KB in-context) ...       // current global default; space preserved
//   Wrong:(e.g. 16KB in-context)                // mismatched no-space style from sibling spec/10 — AVOID
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the spec sentence CITES the default but does not change config)
  - ROUTES: none
  - CODE: none (src/* is a READ-ONLY reference; spec/07, spec/09 are already-correct cross-refs)
  - The only "integration" is CROSS-DOC CONSISTENCY: spec/01:197 must AGREE with spec/07:52 / spec/09:66 /
    src/config.ts:62,109 (all 16384 / 16 KB). Validation gates below enforce this via grep.
  - PARALLEL-SIBLING COORDINATION:
      * P1.M2.T1.S1 edits spec/04-data-model.md ONLY — no file overlap.
      * P1.M2.T2.S1 edits spec/10-testing.md:67 ONLY — no file overlap.
      All three siblings cite the same 16384 / per-tool source-of-truth.
```

---

## Validation Loop

This is a one-token markdown edit to a `.md` spec file. Validation = grep that `8 KB` is gone, `16 KB in-context` is
present, the sentence's other figures (50 KB) and cross-reference are byte-identical, and the new figure matches the
source-of-truth. No build, no tests, no runtime affected.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm the parenthetical changed and the surrounding sentence is structurally intact (the 50 KB cap figure,
# the "so it catches ..." tail, and the @09 cross-reference are all still there):
grep -n 'should default comfortably below' spec/01-pi-context-internals.md
```
Expected: line 197 now contains `(e.g. 16 KB in-context)` — same sentence structure, only `8 KB` → `16 KB` changed.

### Level 2: Stale-content gate (the core BUG-003b checks)

```bash
# (a) No stale "8 KB" (spaced) left anywhere in the file:
grep -n '8 KB' spec/01-pi-context-internals.md && echo "FAIL: stale '8 KB' remains" || echo "PASS: no '8 KB'"

# (b) The corrected "16 KB in-context" is present:
grep -n '16 KB in-context' spec/01-pi-context-internals.md     # expect ≥1 hit at line 197

# (c) Confirm we did NOT accidentally change the 50 KB cap figure, the rationale tail, or the @09 cross-reference:
grep -n '50 KB cap' spec/01-pi-context-internals.md            # built-in cap figure intact
grep -n 'meaningful-but-not-catastrophic bloat' spec/01-pi-context-internals.md   # rationale tail intact
grep -n 'See `@09-configuration.md`' spec/01-pi-context-internals.md              # cross-reference intact
```
Expected: (a) PASS (0 hits for `8 KB`); (b) ≥1 hit for `16 KB in-context`; (c) the `50 KB cap`, the
`meaningful-but-not-catastrophic bloat` tail, and the `See \`@09-configuration.md\`` cross-reference all still present
unchanged.

### Level 3: Cross-doc consistency (system validation)

```bash
# spec/01:197's new 16 KB must match the source-of-truth (16384 / 16 KB) in spec/07, spec/09, src/config.ts.
echo "--- spec/01 (the corrected parenthetical) ---"
sed -n '197p' spec/01-pi-context-internals.md | grep -o '(e.g. 16 KB in-context)'

echo "--- spec/07 (already-correct cross-ref) ---"
grep -n 'bloatThresholdBytes = 16384' spec/07-preventive-and-nudges.md   # expect a hit (~line 52)

echo "--- spec/09 (already-correct defaults table) ---"
grep -n '`16384` (16 KB)' spec/09-configuration.md                      # expect a hit (~line 66)

echo "--- src/config.ts (shipped default — the ultimate source of truth) ---"
grep -n 'Default: 16384' src/config.ts                                   # expect a hit (~line 62)
grep -n 'bloatThresholdBytes: 16384' src/config.ts                       # expect a hit (~line 109)
```
Expected: spec/01:197 parenthetical now reads `(e.g. 16 KB in-context)`; spec/07:52, spec/09:66, and
src/config.ts:62,109 all confirm `16384` (16 KB).

### Level 4: Scope-discipline gate (no collateral edits)

```bash
# Confirm the only change in the whole repo's spec/ tree is the one token on spec/01:197.
# (If using git, the diff should be exactly: - (e.g. 8 KB in-context)  + (e.g. 16 KB in-context).)
git -C . diff -- spec/01-pi-context-internals.md | head -40
# Also assert siblings' files were NOT touched by this edit:
git -C . diff --name-only -- spec/04-data-model.md spec/10-testing.md spec/07-preventive-and-nudges.md spec/09-configuration.md
# Expected: no changes to those four files from THIS PRP (siblings edit their own files in their own sessions).
```
Expected: the only hunk is `8 KB` → `16 KB` on spec/01-pi-context-internals.md:197; no other spec file is modified by
this task.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `grep -n 'should default comfortably below' spec/01-pi-context-internals.md` shows `(e.g. 16 KB in-context)`;
      sentence structure intact (50 KB cap + rationale tail + @09 cross-reference).
- [ ] Level 2(a): `grep -n '8 KB' spec/01-pi-context-internals.md` → **0 hits**.
- [ ] Level 2(b): `grep -n '16 KB in-context' spec/01-pi-context-internals.md` → ≥1 hit (line 197).
- [ ] Level 2(c): `50 KB cap`, `meaningful-but-not-catastrophic bloat`, and `See \`@09-configuration.md\`` unchanged.
- [ ] Level 3: `16 KB` matches spec/07:52 / spec/09:66 / src/config.ts:62,109 (all `16384` / 16 KB).
- [ ] Level 4: `git diff -- spec/01-pi-context-internals.md` shows exactly one hunk (`8 KB` → `16 KB`); no other spec file touched.

### Feature Validation
- [ ] `spec/01-pi-context-internals.md:197` reads `(e.g. 16 KB in-context)`.
- [ ] The `50 KB / 2000 lines` built-in-cap figure and the `See \`@09-configuration.md\`.` cross-reference are
      byte-identical to before.
- [ ] An architect reading §9 now sees a global-rationale example (16 KB) consistent with the shipped 16384 default.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `spec/10-testing.md:67` (owned by sibling P1.M2.T2.S1).
- [ ] Did NOT touch `spec/04-data-model.md` (owned by sibling P1.M2.T1.S1).
- [ ] Did NOT touch `spec/07`, `spec/09` (already correct; READ-ONLY reference).
- [ ] Did NOT touch `src/*` (code, out of scope).
- [ ] Did NOT touch any other paragraph/section of spec/01 (only line 197 is stale).
- [ ] Did NOT reword the sentence beyond the `8 KB` → `16 KB` token swap (space preserved — `16 KB`, NOT `16KB`).
- [ ] Did NOT remove the space to match the sibling's no-space `>16KB` style (spec/01 prose is spaced).

### Documentation
- [ ] spec/01 §9 now agrees with spec/07:52, spec/09:66, and src/config.ts:62,109 (16384 / 16 KB).
- [ ] No internal contradiction remains in the §9 design-rationale parenthetical.

---

## Anti-Patterns to Avoid

- ❌ Don't write `16KB` (no space) — spec/01 prose uses the SPACED form ("8 KB", "16 KB", "50 KB"). The sibling
  spec/10 fix uses the no-space form (`>8KB` → `>16KB`); do NOT blindly copy that into spec/01. Here it is `8 KB` → `16 KB`.
- ❌ Don't cite `20 KB` or `32 KB` — those are the read/bash per-tool overrides, NOT the global default. The §9 sentence
  is a GLOBAL-threshold design rationale ("comfortably below the built-in 50 KB cap") → the global 16 KB is correct.
- ❌ Don't touch the `50 KB / 2000 lines` built-in-cap figure at the start of line 197 — that is Pi's built-in truncation
  cap and is correct.
- ❌ Don't reword the sentence ("defaults to 16 KB" etc.) — the contract prescribes a minimal `8 KB` → `16 KB` token swap.
  Keep the existing "(e.g. <n> in-context)" phrasing.
- ❌ Don't touch the `See \`@09-configuration.md\`.` cross-reference or the `so it catches meaningful-but-not-catastrophic
  bloat.` tail.
- ❌ Don't edit `spec/10-testing.md:67` (sibling P1.M2.T2.S1 owns it) or `spec/04-data-model.md` (sibling P1.M2.T1.S1 owns it).
- ❌ Don't change `8 KB` / `8192` anywhere else in the file even if you notice other mentions — exhaustive grep confirms
  line 197 is the ONLY `8 KB`/`8192` occurrence in spec/01.
- ❌ Don't run/change code or tests — this is a documentation-only (Mode A) fix; no runtime surface is affected.

---

## Confidence Score

**10/10** for one-pass implementation success. This is a single-token markdown edit (`8 KB` → `16 KB`, space preserved)
inside one parenthetical on one line of one file, with the verbatim full-sentence FIND and REPLACE strings, the
authoritative source-of-truth fact (global default `16384` = 16 KB, proven in `src/config.ts:62,109`, `spec/07:52`,
`spec/09:66`), an exhaustive grep confirming exactly one stale site in spec/01, the explicit
`architecture/system_context.md` §BUG-003 'Location 2' prescription matching the change verbatim, and deterministic
grep + git-diff validation gates. The parallel-sibling contracts (P1.M2.T1.S1 edits `spec/04`; P1.M2.T2.S1 edits
`spec/10:67`) are non-overlapping. The only residual risks — (a) accidentally matching the sibling's no-space `16KB`
style instead of spec/01's spaced `16 KB`, (b) touching the `50 KB` built-in-cap figure — are explicitly called out as
DO-NOTs and caught by the Level 2(b)/Level 2(c) / Level 4 checks.