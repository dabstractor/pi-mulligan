# PRP — P1.M1.T2.S1: Update spec/05 §4 audit example + clause for per-tool resolution (BUG-003)

## Goal

**Feature Goal**: Bring `spec/05-tools.md` §4 (`mulligan_audit`) into consistency with the shipped per-tool bloat-threshold behavior (P2 + the parallel code fix P1.M1.T1.S1). Remove the stale `8 KB` figure and the global-only clause; replace with per-tool resolution matching `spec/07-preventive-and-nudges.md` §1.

**Deliverable**: A documentation-only edit (Mode A) to **exactly two lines** of `spec/05-tools.md`:
- line 196 — the audit report EXAMPLE markdown row
- line 208 — `### Behavior` clause 4

**Success Definition**: After the edit, `spec/05-tools.md` §4 (a) shows the correct per-tool threshold in its example, (b) clause 4 describes per-row resolution via `bloatThresholdFor`, and (c) the cited thresholds (`bash: 32 KB`, `read: 20 KB`, global `16 KB`) exactly match `spec/07` §1 and `spec/09-configuration.md` §2. No `8 KB` or global-only wording remains in §4.

## Why

- `spec/05-tools.md` is the **authoritative master spec** — "a naive dev agent can one-shot the implementation" from it. The stale `8 KB` example and global-only clause are exactly why the audit tool's per-tool inconsistency (BUG-001, fixed in parallel by P1.M1.T1.S1) was never caught: anyone implementing the audit from this spec would reproduce the global-only bug.
- P2 updated `spec/07` (the nudge) to per-tool but left `spec/05` (the audit) stale. This PRP closes that spec gap so the two specs agree and both agree with shipped behavior.
- **No business logic, no tests, no build.** This is pure documentation.

## What

Two surgical text replacements inside `spec/05-tools.md` §4 (section starts at line 172 `## 4. \`mulligan_audit\``). No structural, heading, or numbering changes. No other sections touched.

### Success Criteria

- [ ] Line 196 example row flag changes from `(8 KB)` to `(20 KB)` (read's per-tool threshold 20480).
- [ ] Line 208 clause 4 describes **per-row resolution**: `toolResult` messages use their tool's per-tool threshold via `bloatThresholdFor`; other messages use the global; each flagged row displays its own resolved threshold.
- [ ] The thresholds cited in clause 4 (`bash: 32 KB`, `read: 20 KB`, global default `16 KB`) match `spec/07` §1 and `spec/09` §2 verbatim.
- [ ] `grep -n '8 KB' spec/05-tools.md` returns **no hits in §4** (lines 172–213) after the edit.
- [ ] `grep -n 'config.nudges.bloatThresholdBytes\`) is flagged' spec/05-tools.md` returns **no hits** (the global-only phrasing is gone).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text of both target lines, the verbatim desired replacement text, the authoritative cross-spec references with exact line citations, and the exact validation grep commands. The implementer needs no codebase exploration beyond opening `spec/05-tools.md`.

### Documentation & References

```yaml
# MUST READ — the file being edited
- file: spec/05-tools.md
  why: The ONLY file this PRP modifies. §4 = lines 172–213. Two edits at line 196 and line 208.
  section: "§4 mulligan_audit (Return shape report-format block line 196; Behavior clause 4 line 208)"
  gotcha: "Line 196 is INSIDE a fenced ```md block — preserve the leading spaces and the ⚠ glyph exactly; only the '(8 KB)'→'(20 KB)' token changes. Do NOT touch column alignment or the other example rows."

# MUST READ — the authoritative per-tool definition this spec must match
- file: spec/07-preventive-and-nudges.md
  why: §1 'Threshold default & calibration' is the source of truth for bloatThresholdFor + shipped defaults. spec/05 must cite the SAME numbers.
  section: "§1, lines ~53–62 (bloatThresholdFor helper) + 'Shipped defaults: { bash: 32768, read: 20480 }, all other tools falling back to the 16 KB global'"
  pattern: "Per-tool resolution: falsy/missing toolName → global; else byTool[toolName] ?? global."

# MUST READ — the defaults table (cross-check the KB figures)
- file: spec/09-configuration.md
  why: §2 defaults table (lines 66–67) + config example (lines 35–38) confirm: global 16384 (16 KB); bash 32768 (32 KB); read 20480 (20 KB).
  section: "§2 defaults table; §4 validation (line 77) — NOTE spec/09 §4 has a separate wording nit ('discard entirely') that is OUT OF SCOPE here; do not touch spec/09."

# SHOULD READ — the implementation contract (proves the audit resolves per-row)
- file: src/nudges.ts
  why: bloatThresholdFor(toolName, config) (lines 86–91) — pure helper. Confirms falsy toolName → global. This is the function clause 4 must name.
  pattern: "export function bloatThresholdFor(toolName, config): const global = config.nudges.bloatThresholdBytes; if (!toolName) return global; const byTool = config.nudges.bloatThresholdBytesByTool ?? {}; return byTool[toolName] ?? global;"

# CONTEXT — the parallel code fix that establishes the shipped behavior this spec must describe
- file: plan/002_df93178e6631/bugfix/001_4ac005217ade/P1M1T1S1/PRP.md
  why: CONTRACT. T1.S1 makes audit.ts resolve threshold per-row via bloatThresholdFor(readStr(msg,'toolName'), config). toolResult rows → per-tool; non-toolResult rows → global (toolName absent). Each flagged row renders its own KB. clause 4 must describe BOTH cases. T1.S1 also edits a code-internal JSDoc example (separate surface); no file conflict with this spec edit.
  critical: "Do NOT duplicate T1.S1's work (audit.ts/test). This PRP edits ONLY spec/05-tools.md."
```

### Current Codebase tree (the only relevant slice)

```bash
spec/
├── 05-tools.md          # ← THIS PRP edits §4 (lines 196, 208)
├── 07-preventive-and-nudges.md   # READ-ONLY reference (already correct after P2)
└── 09-configuration.md           # READ-ONLY reference (defaults table)
src/nudges.ts                     # READ-ONLY reference (bloatThresholdFor impl)
```

### Known Gotchas & Conventions

```python
# CRITICAL: line 196 lives INSIDE a fenced ```md block in spec/05.
# Preserve EXACT whitespace: two leading spaces, the '9,412  toolResult  read src/big.log'
# run, the gap spaces, and the ⚠ glyph. Change ONLY the '(8 KB)' → '(20 KB)' token.
# Do not reflow/realign the example table.

# CRITICAL: clause 4 must describe BOTH toolResult AND non-toolResult cases.
# The shipped audit flags ALL messages, resolving threshold per row:
#   toolResult → bloatThresholdFor(toolName, config)   [per-tool or global fallback]
#   non-toolResult (assistant/user/system) → global    [toolName absent → falsy → global]
# A clause that says only "toolResult messages are flagged" would be INACCURATE and
# contradict the shipped code (see P1.M1.T1.S1 PRP contract).

# OUT OF SCOPE (do NOT touch in this subtask):
#   - spec/09-configuration.md §4 line 77 wording nit ("discard entirely" vs default-map)
#     → that's the 'Additional Observation', a separate future fix.
#   - src/tools/audit.ts, test/tools/audit.test.ts → owned by P1.M1.T1.S1.
#   - test/integration/scenarios.md, test/tokens.test.ts, test/notes.test.ts
#     → owned by P1.M2.* subtasks.
# This PRP edits ONLY spec/05-tools.md.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — documentation-only (Mode A). No code, no types, no migrations._

### Implementation Tasks (ordered by dependencies)

There is exactly one file and two edits. They are independent and may be applied in either order.

```yaml
Task 1: EDIT spec/05-tools.md  — line 196 (audit report EXAMPLE, inside §4 Return shape ```md block)
  - FIND (verbatim current):
      "  9,412  toolResult  read src/big.log           ⚠ above bloat threshold (8 KB)"
  - REPLACE WITH:
      "  9,412  toolResult  read src/big.log           ⚠ above bloat threshold (20 KB)"
  - RATIONALE: read's per-tool threshold is 20480 bytes = 20 KB (spec/07 §1, spec/09 §2).
    The row's toolName is 'read' → its resolved threshold is 20 KB, not the old 8 KB global.
  - PRESERVE: leading two spaces, the '9,412', 'toolResult', 'read src/big.log' text,
    the gap spaces, and the ⚠ glyph EXACTLY. Change ONLY the '(8 KB)' → '(20 KB)' token.
  - DO NOT: re-align columns, edit any other example row, or touch the 'Total (filtered)'
    line or the 'Suggestion' line (read src/big.log is still the largest contributor at 9,412).

Task 2: EDIT spec/05-tools.md  — line 208 (§4 ### Behavior, clause 4)
  - FIND (verbatim current):
      "4. Render the report. Include the suggestion heuristic: any message above `config.nudges.bloatThresholdBytes` is flagged; the single largest is named in the suggestion."
  - REPLACE WITH:
      "4. Render the report. Include the suggestion heuristic: any message above its resolved threshold is flagged — `toolResult` messages use their tool's per-tool threshold via `bloatThresholdFor` (`bash`: 32 KB, `read`: 20 KB, all other tools: the 16 KB global default); every other message uses the global threshold. Each flagged row displays its own resolved threshold; the single largest message is named in the suggestion."
  - RATIONALE: matches the shipped per-row resolution from P1.M1.T1.S1
    (auditExecute calls bloatThresholdFor(readStr(msg,'toolName'), config) per row) and
    matches spec/07 §1 (defaults bash 32768, read 20480, global 16384).
  - ACCURACY: clause must cover BOTH toolResult (per-tool) and non-toolResult (global) —
    the audit flags all messages, not only toolResult ones.
  - DO NOT: change clause numbering, other clauses (1,2,3,5), or the 'Why audit must use the
    filtered view (D5)' note that follows.

Task 3 (OPTIONAL polish — only if the two edits above are confirmed clean):
  - ADD an illustrative bash row to the example block, directly under the read row, to show
    per-tool differences. Slot it in RANKED ORDER (must be ≤ 9,412 tokens so read stays 'largest'):
      "  7,620  toolResult  bash npm run build          ⚠ above bloat threshold (32 KB)"
  - RATIONALE: bash's per-tool threshold is 32768 = 32 KB; demonstrating two different
    per-tool thresholds in one example makes the per-tool behavior self-evident.
  - GOTCHA: if added, the 'Total (filtered): ~12,340 tokens' figure and the
    'Suggestion: the read src/big.log result is the largest contributor' line must remain
    consistent (read is still largest; total is illustrative). If in ANY doubt, SKIP Task 3 —
    Tasks 1–2 alone fully satisfy the success criteria.
```

### Implementation Patterns & Key Details

The exact `bloatThresholdFor` semantics clause 4 must reflect (from `src/nudges.ts` lines 86–91):

```ts
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;           // 16384 = 16 KB
  if (!toolName) return global;                               // non-toolResult messages
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;                          // bash→32768, read→20480, else global
}
```

Therefore the audit's per-row resolution is: **every** message gets a threshold; `toolResult` rows use their tool's per-tool threshold (or global fallback), all other rows use the global. The clause 4 replacement text encodes exactly this.

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only change (Mode A).
  - DATABASE: none
  - CONFIG: none (this spec cites config defaults but does not change them)
  - ROUTES: none
  - CODE: none (audit.ts is owned by P1.M1.T1.S1; this PRP must not touch it)
  - The only "integration" is CROSS-SPEC CONSISTENCY: spec/05 §4 must agree with
    spec/07 §1 and spec/09 §2. Validation gates below enforce this via grep.
```

---

## Validation Loop

This is a markdown doc change. Validation = grep-based consistency checks + cross-spec diff. No build, no tests.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Markdown sanity — the file still parses (no broken fence from the edit).
# The edit is internal to an existing ```md block; verify fence count is unchanged.
grep -c '```' spec/05-tools.md   # note the count BEFORE and AFTER; must be identical

# Confirm the edit landed (should print the updated lines):
sed -n '196p;208p' spec/05-tools.md
```
Expected: line 196 now ends `... bloat threshold (20 KB)`; line 208 now contains `bloatThresholdFor` and the per-tool phrasing.

### Level 2: Stale-content gate (the core BUG-003 check)

```bash
# (a) No '8 KB' left in §4 (lines 172–213):
awk 'NR>=172 && NR<=213' spec/05-tools.md | grep -n '8 KB' && echo "FAIL: stale 8 KB in §4" || echo "PASS: no 8 KB in §4"

# (b) The global-only clause phrasing is gone from the whole file:
grep -n 'config.nudges.bloatThresholdBytes`) is flagged' spec/05-tools.md && echo "FAIL: global-only clause remains" || echo "PASS: global-only clause removed"

# (c) New per-tool content is present in clause 4:
grep -n 'bloatThresholdFor' spec/05-tools.md   # expect ≥1 hit at line ~208
grep -n '20 KB' spec/05-tools.md               # expect a hit in the example (line ~196)
```
Expected: all three PASS / present.

### Level 3: Cross-spec consistency (system validation)

```bash
# The thresholds cited in the new clause 4 must match spec/07 §1 and spec/09 §2.
echo "--- spec/07 shipped defaults ---"
grep -nE 'bash.*32768|read.*20480|16 KB global' spec/07-preventive-and-nudges.md

echo "--- spec/09 defaults ---"
grep -nE '16384|32768|20480' spec/09-configuration.md

echo "--- spec/05 new clause (should cite 32 KB / 20 KB / 16 KB) ---"
sed -n '208p' spec/05-tools.md
```
Expected: spec/05's `bash: 32 KB, read: 20 KB, ... 16 KB global` figures equal spec/07 and spec/09 exactly.

### Level 4: Creative & Domain-Specific Validation

```bash
# Render/preview is optional. If a markdown previewer is handy, confirm the §4 example
# table and the numbered Behavior list render without malformed list items.
# (No automated gate required for a 2-line prose edit.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: ```` ``` ```` fence count unchanged before/after the edit.
- [ ] Level 1: `sed -n '196p;208p' spec/05-tools.md` shows the updated text.
- [ ] Level 2(a): no `8 KB` in §4 (lines 172–213).
- [ ] Level 2(b): global-only clause phrasing gone from the whole file.
- [ ] Level 2(c): `bloatThresholdFor` and `20 KB` present in §4.
- [ ] Level 3: cited thresholds (32 KB / 20 KB / 16 KB) match spec/07 §1 and spec/09 §2.

### Feature Validation
- [ ] Line 196 example flag reads `(20 KB)` (read's per-tool threshold), whitespace/⚠ preserved.
- [ ] Line 208 clause 4 describes per-row resolution covering BOTH toolResult (per-tool) and other (global) messages; names `bloatThresholdFor`; cites bash 32 KB / read 20 KB / global 16 KB.
- [ ] Clause numbering (1–5) and the D5 note after Behavior are untouched.
- [ ] No edits to any file other than `spec/05-tools.md`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `src/tools/audit.ts` or `test/tools/audit.test.ts` (owned by P1.M1.T1.S1).
- [ ] Did NOT touch `spec/09-configuration.md` (separate 'Additional Observation' nit — out of scope).
- [ ] Did NOT touch `spec/07`, test files, or `scenarios.md` (owned by other subtasks).
- [ ] No reflow/realignment of the example table beyond the required token swap.

### Documentation
- [ ] The spec is now internally consistent: §4 example, §4 clause, spec/07 §1, spec/09 §2 all agree.
- [ ] A naive dev agent reading only spec/05 §4 would now implement the audit with correct per-tool resolution.

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite the whole §4 section — this is a 2-line surgical fix.
- ❌ Don't change the example's token counts, column alignment, or the "largest contributor" suggestion — only the `(8 KB)`→`(20 KB)` flag token (and the optional bash row, if added carefully).
- ❌ Don't make clause 4 toolResult-only — the audit flags ALL messages; non-toolResult rows resolve to the global. Describe both.
- ❌ Don't invent threshold numbers — use exactly `bash: 32 KB`, `read: 20 KB`, global `16 KB` from spec/07/spec/09.
- ❌ Don't touch spec/09's §4 "discard entirely" wording, audit.ts, or any test file — those belong to other subtasks.
- ❌ Don't add tests — this is documentation-only (Mode A); there is no executable surface to test.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 2-line markdown edit with verbatim find/replace text, exact line citations, a parallel-code contract (P1.M1.T1.S1) establishing the precise behavior to document, and deterministic grep validation gates. The only residual risk is whitespace fidelity on line 196 (mitigated by the explicit "change ONLY the `(8 KB)`→`(20 KB)` token" instruction and the fence-count gate).