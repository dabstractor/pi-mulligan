# PRP — P1.M2.T2.S1: Fix spec/10-testing.md:67 F-shrink-preventive threshold from >8KB to >16KB (BUG-003a)

## Goal

**Feature Goal**: Correct the **stale `>8KB`** figure in the **F-shrink-preventive** scenario row of
`spec/10-testing.md` §2.1 to the shipped global default of **`>16KB`** (16384 bytes). After the P2 per-tool
bloat-threshold changeset raised the global default from `8192` (8 KB) to `16384` (16 KB), this one table cell
was left stale, contradicting `spec/07:52`, `spec/09:66`, and `src/config.ts:62,109`.

**Deliverable**: A **single in-place edit** to **exactly one line** of **exactly one file** —
`spec/10-testing.md:67` — changing the substring `>8KB` to `>16KB` inside the middle (`How to drive`) table
cell. No other cell, row, file, code, or test changes.

**Success Definition**: After the edit, (a) `spec/10-testing.md:67` reads `tool_result hook annotates a >16KB
result`; (b) `grep -n '>8KB' spec/10-testing.md` → **0 hits**; (c) the row's other two cells
(`**F-shrink-preventive**` label and the `Pass criteria` cell) are **byte-identical** to before; (d) no file
other than `spec/10-testing.md` is modified.

## User Persona

**Target User**: A developer or QA engineer reading `spec/10-testing.md` §2.1 to learn how to drive the
F-shrink-preventive scenario and what threshold triggers the bloat reminder.

**Use Case**: Following the §2.1 scenario table to reproduce the bloat-reminder annotation (`[mulligan]` text
appended + `turn-metric` `bloatHit:true`).

**Pain Points Addressed**: Today the row says the hook fires on a `>8KB` result — but the real global default is
`16384` (16 KB), so a reader driving the scenario with an ~8–15 KB result would observe **no** annotation and
(wrongly) conclude the bloat reminder is broken.

## Why

- BUG-003(a) is a **documentation defect** — the spec's scenario table contradicts the shipped default and the
  two already-correctly-updated companion specs. Per PRD §0, the companion `spec/*` files concatenate into the
  omnibus specification, so an internal contradiction is a real defect for a future reader/build agent.
- The correct figure is the **global default** `16384` = 16 KB (`src/config.ts:62,109`; `spec/07:52`;
  `spec/09:66`). Per-tool overrides are higher (`read` 20 KB, `bash` 32 KB); the F-shrink-preventive scenario
  describes the generic unlisted-tool case, so `>16KB` is the right number.
- **No business logic, no code, no tests, no build.** Pure documentation fix (Mode A).

## What

One exact substring replacement inside one markdown table cell. The row is a 3-cell line in `spec/10-testing.md`
§2.1 ("### 2.1 Required scenarios & pass criteria"). The change touches ONLY the middle cell's `>8KB` token.

### Success Criteria

- [ ] `spec/10-testing.md:67` reads `tool_result hook annotates a >16KB result`.
- [ ] `grep -n '>8KB' spec/10-testing.md` → **0 hits**.
- [ ] `grep -n '>16KB' spec/10-testing.md` → ≥1 hit (line 67).
- [ ] The F-shrink-preventive row's label cell (`| **F-shrink-preventive** |`) and Pass-criteria cell
      (`| result content has the appended \`[mulligan]\` reminder; \`turn-metric\` records \`bloatHit:true\` |`)
      are byte-identical to before.
- [ ] No file other than `spec/10-testing.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current line** (target), the **verbatim desired line** (after edit),
the authoritative source-of-truth facts (16384 / 16 KB) with exact file/line citations, an exhaustive grep
proving only one stale site exists, and deterministic grep validation gates. The implementer needs no codebase
exploration beyond opening `spec/10-testing.md` at line 67.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this PRP modifies
- file: spec/10-testing.md
  why: Line 67 is the F-shrink-preventive scenario row; its middle cell carries the stale ">8KB".
  section: "### 2.1 Required scenarios & pass criteria (mirror the spike) — the markdown table; the
            F-shrink-preventive row is line 67."
  pattern: "3-cell markdown table row: | **F-shrink-preventive** | <How to drive> | <Pass criteria> |.
            Edit ONLY the middle cell's >8KB token; leave the | separators and both other cells untouched."
  gotcha: "DO NOT touch the Pass-criteria (right) cell — it is correct. DO NOT touch any other row. DO NOT
           reflow/rewrite the cell — change only the substring >8KB → >16KB."

# MUST READ — authoritative source-of-truth: the global default IS 16384 (16 KB)
- file: src/config.ts
  why: Line 62 (JSDoc 'Default: 16384 (16 KB)') + line 109 (DEFAULT_CONFIG: bloatThresholdBytes: 16384).
        Proves 8192/8 KB is the OLD default and 16384/16 KB is the CURRENT default.
  section: "MulliganConfig.nudges.bloatThresholdBytes JSDoc (~line 55-64) + DEFAULT_CONFIG (~line 109-110).
            READ-ONLY — do NOT edit src/*."
  critical: "16384 (16 KB) is the shipped global default. This single fact makes '>8KB' stale/wrong."

# MUST READ — the two already-correctly-updated companion specs (cross-check the 16 KB figure)
- file: spec/07-preventive-and-nudges.md
  why: Line 52 — 'Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context)'. Confirms 16 KB.
  section: "§'Threshold default & calibration' (~line 51-52). READ-ONLY — already correct."
  critical: "spec/10's new >16KB must AGREE with this line."

- file: spec/09-configuration.md
  why: Line 66 — defaults table: '`16384` (16 KB) | Global catch-all for tools without a per-tool override.'
        Line 67 — per-tool map {bash:32768, read:20480}. Confirms 16 KB global + per-tool overrides.
  section: "§2 defaults table (~line 66-67). READ-ONLY — already correct."
  critical: "spec/10's new >16KB must AGREE with this line. (Per-tool read=20KB/bash=32KB are higher overrides;
             the F-shrink-preventive scenario describes the generic unlisted-tool case → global 16 KB.)"

# MUST READ — the PRD/contract for BUG-003
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/architecture/system_context.md
  why: §BUG-003 'Location 1' prescribes the exact fix: '>8KB result' → '>16KB result (the global default;
        per-tool is 20KB read / 32KB bash)'. Also lists Location 2 (spec/01:197) — OUT OF SCOPE here.
  critical: "This PRP addresses ONLY spec/10-testing.md:67 (Location 1). spec/01:197 (Location 2) is owned by
             the sibling P1.M2.T2.S2 — do NOT touch it."

# CONTEXT — parallel siblings (no file conflict)
- file: plan/002_df93178e6631/bugfix/002_7e5972dda3a9/P1M2T1S1/PRP.md
  why: CONTRACT. Edits spec/04-data-model.md ONLY. No overlap with spec/10-testing.md. Cites the same
        16384 / per-tool source-of-truth; this PRP must cite identical numbers for cross-doc consistency.
```

### Current Codebase tree (the only relevant slice)

```bash
spec/
├── 10-testing.md              # ← EDIT line 67 ONLY (F-shrink-preventive middle cell: >8KB → >16KB)
├── 07-preventive-and-nudges.md# READ-ONLY — line 52 already says 16384 (16 KB) — cross-ref source-of-truth
├── 09-configuration.md        # READ-ONLY — lines 66-67 already say 16384 + per-tool map — cross-ref
├── 04-data-model.md           # READ-ONLY — owned by parallel sibling P1.M2.T1.S1 (DO NOT touch)
└── 01-pi-context-internals.md # READ-ONLY — line 197 owned by sibling P1.M2.T2.S2 (DO NOT touch)
src/config.ts                  # READ-ONLY — proves default is 16384 (lines 62, 109)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: this is a SINGLE-SUBSTRING edit inside ONE markdown table cell.
#   FIND:  >8KB
#   REPLACE: >16KB
#   That is the ENTIRE change. Do not reflow the cell, do not reword, do not touch any other token.

# CRITICAL: the global default is 16384 (16 KB) — confirmed:
#   src/config.ts:62,109            -> "Default: 16384 (16 KB)" + DEFAULT_CONFIG bloatThresholdBytes: 16384
#   spec/07-preventive-and-nudges.md:52 -> "Default bloatThresholdBytes = 16384 (16 KB ≈ 4k tokens)"
#   spec/09-configuration.md:66      -> defaults table "16384 (16 KB)"
# So ">8KB" is the OLD (pre-P2) default; ">16KB" is the shipped global default.

# GOTCHA: the F-shrink-preventive scenario describes the GENERIC unlisted-tool case, so the global default
#   (16 KB) is the correct figure to cite. Per-tool overrides are HIGHER (read 20 KB / bash 32 KB), so using
#   >16KB does NOT overstate the bar — an unlisted tool fires at 16 KB. (Do NOT write >20KB or >32KB.)

# GOTCHA: the row is a 3-cell markdown table line. Preserve the leading "| **F-shrink-preventive** |" label
#   cell and the trailing "| result content has the appended `[mulligan]` reminder; `turn-metric` records
#   `bloatHit:true` |" pass-criteria cell EXACTLY. Change ONLY the middle cell's >8KB token.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/01-pi-context-internals.md:197 -> owned by sibling P1.M2.T2.S2.
#   - spec/04-data-model.md:243           -> owned by sibling P1.M2.T1.S1.
#   - spec/07, spec/09                     -> already correct (READ-ONLY reference).
#   - src/*                                -> code, out of scope.
#   - Any other row in the spec/10 §2.1 table.
#   - The pass-criteria (right) cell of the F-shrink-preventive row.
# This PRP edits ONLY spec/10-testing.md:67.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only edit (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

One task; one exact substring replacement. **Verify the `FIND` substring matches verbatim before replacing.**

```yaml
Task 1: EDIT spec/10-testing.md — line 67 (F-shrink-preventive middle cell: >8KB → >16KB)
  - FIND (verbatim current — the FULL line, to anchor unambiguously):
      "| **F-shrink-preventive** | `tool_result` hook annotates a >8KB result | result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |"
  - REPLACE WITH (the FULL line after edit — identical EXCEPT >8KB → >16KB):
      "| **F-shrink-preventive** | `tool_result` hook annotates a >16KB result | result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |"
  - PRECISE SUBSTRING CHANGE: ">8KB"  ->  ">16KB"   (i.e. insert "16" before "KB", keep the leading ">").
  - RATIONALE: the shipped global default is 16384 = 16 KB (src/config.ts:62,109; spec/07:52; spec/09:66).
    The F-shrink-preventive scenario describes the generic unlisted-tool case, so the global default (16 KB)
    is the correct threshold to cite. Per-tool overrides (read 20 KB / bash 32 KB) are higher and are NOT the
    generic case. Matches architecture/system_context.md §BUG-003 'Location 1' prescription verbatim.
  - PRESERVE: the leading "| **F-shrink-preventive** |" label cell; the "`tool_result` hook annotates a" prefix;
    the "result" suffix; BOTH pipe "|" cell separators; the trailing "| result content has the appended
    `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |" pass-criteria cell (BYTE-IDENTICAL).
  - DO NOT: change "8KB" anywhere else, touch the pass-criteria cell, touch any other row, or edit any other
    file. Do NOT reword the cell beyond the >8KB → >16KB token swap.
```

### Implementation Patterns & Key Details

```ts
// The shipped config (source-of-truth) — proves >16KB is correct for the generic case:
//   src/config.ts:109    bloatThresholdBytes: 16384,                         // global default = 16 KB
//   src/config.ts:110    bloatThresholdBytesByTool: { bash: 32768, read: 20480 },  // per-tool overrides
//   bloatThresholdFor(toolName, config): byTool[toolName] ?? global           // unlisted tool → global 16 KB
// So an UNLISTED tool's result exceeding 16384 bytes (16 KB) fires the bloat reminder.
// The F-shrink-preventive row describes exactly this generic case → ">16KB" is correct.
// (Do NOT cite >20KB / >32KB — those are the read/bash overrides, not the generic default.)

// PATTERN (spec-doc fix): keep all surrounding structure; swap only the stale numeric token.
//   Bad:  `tool_result` hook annotates a >8KB result
//   Good: `tool_result` hook annotates a >16KB result
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (the spec row CITES the default but does not change config)
  - ROUTES: none
  - CODE: none (src/* is a READ-ONLY reference; spec/07, spec/09 are already-correct cross-refs)
  - The only "integration" is CROSS-DOC CONSISTENCY: spec/10:67 must AGREE with spec/07:52 / spec/09:66 /
    src/config.ts:62,109 (all 16384 / 16 KB). Validation gates below enforce this via grep.
  - PARALLEL-SIBLING COORDINATION:
      * P1.M2.T1.S1 edits spec/04-data-model.md ONLY — no file overlap.
      * P1.M2.T2.S2 edits spec/01-pi-context-internals.md:197 ONLY — no file overlap.
      All three siblings cite the same 16384 / per-tool source-of-truth.
```

---

## Validation Loop

This is a one-token markdown edit to a `.md` spec file. Validation = grep that `>8KB` is gone, `>16KB` is
present, the row's other cells are byte-identical, and the new figure matches the source-of-truth. No build,
no tests, no runtime affected.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm the edit landed and the row is structurally intact (still 3 cells / 2 inner pipes + 2 outer pipes):
sed -n '67p' spec/10-testing.md
```
Expected: the line now reads `| **F-shrink-preventive** | \`tool_result\` hook annotates a >16KB result |
result content has the appended \`[mulligan]\` reminder; \`turn-metric\` records \`bloatHit:true\` |` — same
pipe structure, only `>8KB` → `>16KB` changed.

### Level 2: Stale-content gate (the core BUG-003a checks)

```bash
# (a) No stale ">8KB" left anywhere in the file:
grep -n '>8KB' spec/10-testing.md && echo "FAIL: stale >8KB remains" || echo "PASS: no >8KB"

# (b) The corrected ">16KB" is present:
grep -n '>16KB' spec/10-testing.md          # expect ≥1 hit at line 67

# (c) Confirm we did NOT accidentally change the pass-criteria cell or the row label:
grep -n 'F-shrink-preventive' spec/10-testing.md     # label cell intact
grep -n 'bloatHit:true' spec/10-testing.md           # pass-criteria cell intact
```
Expected: (a) PASS (0 hits for `>8KB`); (b) ≥1 hit for `>16KB`; (c) both the `F-shrink-preventive` label and
the `bloatHit:true` pass-criteria still present unchanged.

### Level 3: Cross-doc consistency (system validation)

```bash
# spec/10:67's new >16KB must match the source-of-truth (16384 / 16 KB) in spec/07, spec/09, src/config.ts.
echo "--- spec/10 (the corrected line) ---"
sed -n '67p' spec/10-testing.md

echo "--- spec/07 (already-correct cross-ref) ---"
grep -n 'bloatThresholdBytes = 16384' spec/07-preventive-and-nudges.md   # expect a hit (~line 52)

echo "--- spec/09 (already-correct defaults table) ---"
grep -n '`16384` (16 KB)' spec/09-configuration.md                      # expect a hit (~line 66)

echo "--- src/config.ts (shipped default — the ultimate source of truth) ---"
grep -n 'Default: 16384' src/config.ts                                   # expect a hit (~line 62)
grep -n 'bloatThresholdBytes: 16384' src/config.ts                       # expect a hit (~line 109)
```
Expected: spec/10:67 says `>16KB`; spec/07:52, spec/09:66, and src/config.ts:62,109 all confirm `16384` (16 KB).

### Level 4: Scope-discipline gate (no collateral edits)

```bash
# Confirm the only change in the whole repo's spec/ tree is the one token on spec/10:67.
# (If using git, the diff should be exactly: - annotates a >8KB result  + annotates a >16KB result.)
git -C . diff -- spec/10-testing.md | head -40
# Also assert siblings' files were NOT touched by this edit:
git -C . diff --name-only -- spec/04-data-model.md spec/01-pi-context-internals.md spec/07-preventive-and-nudges.md spec/09-configuration.md
# Expected: no changes to those four files from THIS PRP (siblings edit their own files in their own sessions).
```
Expected: the only hunk is `>8KB` → `>16KB` on spec/10-testing.md:67; no other spec file is modified by this task.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '67p' spec/10-testing.md` shows `>16KB` in the middle cell; row structure (3 cells) intact.
- [ ] Level 2(a): `grep -n '>8KB' spec/10-testing.md` → **0 hits**.
- [ ] Level 2(b): `grep -n '>16KB' spec/10-testing.md` → ≥1 hit (line 67).
- [ ] Level 2(c): `F-shrink-preventive` label and `bloatHit:true` pass-criteria cell unchanged.
- [ ] Level 3: `>16KB` matches spec/07:52 / spec/09:66 / src/config.ts:62,109 (all `16384` / 16 KB).
- [ ] Level 4: `git diff -- spec/10-testing.md` shows exactly one hunk (`>8KB` → `>16KB`); no other spec file touched.

### Feature Validation
- [ ] `spec/10-testing.md:67` reads `tool_result hook annotates a >16KB result`.
- [ ] The pass-criteria cell (`result content has the appended \`[mulligan]\` reminder; \`turn-metric\` records
      \`bloatHit:true\``) is byte-identical to before.
- [ ] A QA engineer driving the F-shrink-preventive scenario with a >16 KB result now sees the `[mulligan]`
      reminder + `bloatHit:true` as documented (16 KB is the shipped generic default).

### Code Quality / Scope Discipline
- [ ] Did NOT touch `spec/01-pi-context-internals.md:197` (owned by sibling P1.M2.T2.S2).
- [ ] Did NOT touch `spec/04-data-model.md` (owned by sibling P1.M2.T1.S1).
- [ ] Did NOT touch `spec/07`, `spec/09` (already correct; READ-ONLY reference).
- [ ] Did NOT touch `src/*` (code, out of scope).
- [ ] Did NOT touch any other row in the spec/10 §2.1 table.
- [ ] Did NOT reword the cell beyond the `>8KB` → `>16KB` token swap.

### Documentation
- [ ] spec/10 §2.1 now agrees with spec/07:52, spec/09:66, and src/config.ts:62,109 (16384 / 16 KB).
- [ ] No internal contradiction remains in the F-shrink-preventive scenario's stated trigger threshold.

---

## Anti-Patterns to Avoid

- ❌ Don't cite `>20KB` or `>32KB` — those are the read/bash per-tool overrides, NOT the generic default. The
  F-shrink-preventive scenario describes the generic unlisted-tool case → global 16 KB is correct.
- ❌ Don't reword the cell ("exceeds its resolved per-tool threshold" etc.) — the contract prescribes a
  minimal `>8KB` → `>16KB` token swap. Keep the existing phrasing.
- ❌ Don't touch the pass-criteria (right) cell, the row label, any other row, or any other file.
- ❌ Don't edit `spec/01-pi-context-internals.md:197` (sibling P1.M2.T2.S2 owns it) or `spec/04-data-model.md`
  (sibling P1.M2.T1.S1 owns it).
- ❌ Don't change `8 KB` / `8KB` anywhere else in the file even if you notice other mentions — this PRP's scope
  is strictly the F-shrink-preventive `>8KB` on line 67 (the only stale `>8KB` in spec/10 per exhaustive grep).
- ❌ Don't run/change code or tests — this is a documentation-only (Mode A) fix; no runtime surface is affected.

---

## Confidence Score

**10/10** for one-pass implementation success. This is a single-token markdown edit (`>8KB` → `>16KB`) on one
line of one file, with the verbatim full-line FIND and REPLACE strings, the authoritative source-of-truth fact
(global default `16384` = 16 KB, proven in `src/config.ts:62,109`, `spec/07:52`, `spec/09:66`), an exhaustive
grep confirming exactly one stale site, the explicit `architecture/system_context.md` §BUG-003 prescription
matching the change verbatim, and deterministic grep + git-diff validation gates. The parallel-sibling
contracts (P1.M2.T1.S1 edits `spec/04`; P1.M2.T2.S2 edits `spec/01:197`) are non-overlapping. The only residual
risk — accidentally editing the pass-criteria cell or another row — is explicitly called out as a DO-NOT and
caught by the Level 2(c) / Level 4 checks.