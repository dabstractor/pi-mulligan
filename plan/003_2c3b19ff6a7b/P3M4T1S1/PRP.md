name: "P3.M4.T1.S1 — Update README config table + JSON example (new knobs + threshold change)"
description: |
  Docs-only (Mode B) task. Synchronise README.md §3 "Configuration" with `src/config.ts`
  `DEFAULT_CONFIG`: add 4 new knobs to the defaults table, raise the documented
  `nudges.driftThresholdTokens` default 3000→6000 (with rationale), update the commented
  JSON example, and bump the knob-count note 13→17. No source changes, no tests.

---

## Goal

**Feature Goal**: Make README.md §3 "Configuration" exactly reflect the current
`src/config.ts` `DEFAULT_CONFIG`, which already ships the 4 new knobs and the raised
drift threshold (P3.M2.T1.S1 + P3.M3.T1.S1 are COMPLETE). The README currently *lags*
`config.ts` and must be brought into line.

**Deliverable**: An edited `README.md` §3 — the "Defaults table" and the "Minimal example
`settings.json`" — reflecting: `shrink.maxActive=32`, `shrink.staleAfterFires=3`,
`nudges.driftWindowTurns=3`, `nudges.highWaterFraction=0.7`, `nudges.driftThresholdTokens=6000`
(with rationale), and the header note reading "All 17 knobs".

**Success Definition**: (1) Every knob in `config.ts` `DEFAULT_CONFIG` has a matching row in
the README table with the correct default; (2) the JSON example shows all 4 new keys + the
6000 default; (3) `grep -n "3000" README.md` returns nothing; (4) the header note says
"All 17 knobs".

## User Persona (if applicable)

**Target User**: A human (developer / operator) reading the README to configure pi-mulligan.
**Use Case**: Looking up a knob's default and effect before editing `settings.json`.
**Pain Points Addressed**: The README currently omits 4 knobs that already ship and shows a
stale 3000 default, so a human comparing README↔`config.ts` sees drift.

## Why

- **Documentation correctness**: the README is the public config surface; it must match the
  source of truth (`config.ts` `DEFAULT_CONFIG`).
- **Completes P3.M4.T1 (changeset-level docs sync)**: this is task S1 of 3 — S2 adds
  `mulligan_cancel` to §4 (tools list), S3 updates feature blurbs (§2/§5). This PRP does S1
  only; the other two are separate, sequenced tasks and MUST NOT be touched here.
- Low risk: documentation-only, no runtime/build/test impact.

## What

Edit **only** `README.md` §3 "Configuration" (lines ~73–112). Concretely:

1. Header note line: `All 13 knobs` → `All 17 knobs` (13 existing + 4 new).
2. Defaults table — **shrink** section: after the `shrink.enabled` row, add 2 rows
   (`shrink.maxActive`, `shrink.staleAfterFires`).
3. Defaults table — **nudges** section: change the `nudges.driftThresholdTokens` default from
   `3000` to `6000` and rewrite its "What it does" cell to include the raise rationale; then
   append 2 new rows (`nudges.driftWindowTurns`, `nudges.highWaterFraction`).
4. Minimal example `settings.json`: add a `shrink` block with the 2 new keys, add the 2 new
   nudge keys, and change `driftThresholdTokens: 3000` → `6000`.

### Success Criteria

- [ ] `README.md` §3 defaults table contains rows for all 17 knobs with defaults matching `config.ts` `DEFAULT_CONFIG`.
- [ ] `nudges.driftThresholdTokens` row default reads `6000` and its description states it was raised from 3000 (with the §5.1 windowing rationale).
- [ ] JSON example shows `shrink.maxActive`, `shrink.staleAfterFires`, `nudges.driftWindowTurns`, `nudges.highWaterFraction`, and `driftThresholdTokens: 6000`.
- [ ] Header note reads "All 17 knobs".
- [ ] `grep -n "3000" README.md` returns no output.
- [ ] No edits outside README.md §3 (§2, §4, §5 untouched — those belong to S2/S3).

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" → **Yes.** The exact current README text, the exact `config.ts` values, and the exact PRD rationale text are all quoted below. This is a single-file, docs-only edit.

### Documentation & References

```yaml
# MUST READ — the authoritative config values (source of truth)
- file: src/config.ts
  why: "DEFAULT_CONFIG (search for `export const DEFAULT_CONFIG`) is the single source of truth
        for every default. shrink = {enabled:true, maxActive:32, staleAfterFires:3};
        nudges = {..., driftThresholdTokens:6000, driftWindowTurns:3, highWaterFraction:0.7}.
        VERIFY these values match the README before finishing."
  pattern: "DEFAULT_CONFIG literal — copy defaults verbatim."
  gotcha: "These knobs ALREADY ship in config.ts (P3.M2.T1.S1 + P3.M3.T1.S1 COMPLETE).
           This task only edits README — do NOT touch src/config.ts."

# MUST READ — the authoritative rationale wording (quote/condense from here)
- file: plan/003_2c3b19ff6a7b/prd_snapshot.md
  why: "Heading h2.103 'Rationale per knob' has the exact rationale for each knob; h2.102
        'Schema & defaults' shows the JSON structure/order. The driftThresholdTokens raise
        rationale must come from h2.103."
  section: "h2.102 (schema), h2.103 (rationale table)"

# The ONLY file to edit
- file: README.md
  why: "§3 'Configuration' (lines ~73–112): the 'Defaults table' + 'Minimal example settings.json'."
  pattern: "Existing table rows use `| \`knob.path\` | \`default\` | description |`. Section
            header rows use `| **section** | | |` (e.g. `| **shrink** | | |`). Keep this style."
  gotcha: "Edit ONLY §3. §4 (Tools) is S2's scope; §2/§5 feature blurbs are S3's scope."

# System-context note (architect's pointer to this exact region)
- file: plan/003_2c3b19ff6a7b/architecture/system_context.md
  why: "Confirms 'README.md ~line 91-108 has a config table' and that this is a Mode-B docs task."
```

### Current Codebase tree (relevant slice)

```bash
README.md            # ← EDIT ONLY this file, §3 (lines ~73–112)
src/config.ts        # ← READ ONLY (source of truth; DEFAULT_CONFIG already correct)
plan/003_2c3b19ff6a7b/prd_snapshot.md   # ← READ ONLY (rationale wording, h2.103)
```

### Desired Codebase tree (no new files)

```bash
README.md            # §3 updated in place — no files added or removed
```

### Exact current README §3 text (the before-state to edit)

Lines 73–96 (Defaults table) and 99–112 (JSON example). The 3 edit regions:

**(A) Header note — line 75:**
```
All 13 knobs (source of truth: `src/config.ts` `DEFAULT_CONFIG`; rationale: `spec/09-configuration.md` §3).
```

**(B) Defaults table — current rows of interest (lines ~86, 93):**
```
| **shrink** | | |
| `shrink.enabled` | `true` | Enable the `mulligan_shrink` tool. |
...
| `nudges.driftThresholdTokens` | `3000` | Per-turn token delta above which the drift nudge fires. |
```
(`shrink.enabled` is the ONLY shrink row; `driftThresholdTokens` is the LAST nudges row.)

**(C) Minimal example `settings.json` — lines ~104–111:**
```jsonc
{
  // "mulligan": {
  //   "enabled": true,
  //   "rewind": { "maxDepth": 5 },
  //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "bash": 32768, "read": 20480 }, "driftThresholdTokens": 3000 }
  // }
}
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Scope boundary. This task = README §3 ONLY. Do NOT edit §4 (mulligan_cancel tools
# list — that is P3.M4.T1.S2) or §2/§5 feature blurbs (P3.M4.T1.S3). Editing them here will
# collide with the sequenced sibling tasks.

# CRITICAL: The 4 new knobs + the 6000 default ALREADY EXIST in src/config.ts DEFAULT_CONFIG
# (P3.M2.T1.S1 and P3.M3.T1.S1 are COMPLETE). This is a docs catch-up — do NOT modify any
# src/ file.

# GOTCHA: Knob count math. Current table has 13 knobs. Adding shrink.maxActive,
# shrink.staleAfterFires, nudges.driftWindowTurns, nudges.highWaterFraction = 17 total.
# Header note "All 13 knobs" → "All 17 knobs".

# GOTCHA: 3000 is referenced ONLY for driftThresholdTokens (table cell + JSON example). After
# the edit, `grep -n "3000" README.md` MUST be empty. (No other 3000 uses exist — verified.)

# GOTCHA: Nudge row order must match config.ts / PRD schema (h2.102) order:
#   ...driftThresholdTokens, driftWindowTurns, highWaterFraction
# So append driftWindowTurns THEN highWaterFraction after the (rewritten) driftThresholdTokens row.

# GOTCHA: README is not imported by any code (grep `README` across src/ → no hits), so there
# is no build/type-check/test impact. `npx tsc --noEmit` and `npm test` are unaffected and
# need NOT be re-run for this docs change (they remain green regardless).
```

## Implementation Blueprint

### Data models and structure

N/A — documentation-only. No data models, schemas, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — header note (line 75)
  - CHANGE: "All 13 knobs (source of truth: ..." → "All 17 knobs (source of truth: ..."
  - WHY: 13 + 4 new knobs = 17.
  - PRESERVE: the rest of the line (source-of-truth + rationale pointers) verbatim.

Task 2: EDIT README.md — shrink section of the defaults table
  - FIND: the single existing row `| \`shrink.enabled\` | \`true\` | Enable the \`mulligan_shrink\` tool. |`
  - ADD 2 rows IMMEDIATELY AFTER it, matching the existing 3-column table style:
      | `shrink.maxActive` | `32` | Cap on simultaneous *active* `mulligan:shrink` markers; the oldest is retired when exceeded. Mirrors `rewind.maxDepth` as a bound on marker accumulation. |
      | `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (`spec/08-edge-cases.md` E15/E21). Stops dead markers being walked every fire. |
  - FOLLOW: the wording style of existing rows (terse first clause; backticked identifiers;
    cross-refs to spec sections where helpful). Source wording condensed from PRD h2.103.

Task 3: EDIT README.md — nudges section of the defaults table
  - FIND: `| \`nudges.driftThresholdTokens\` | \`3000\` | Per-turn token delta above which the drift nudge fires. |`
  - REPLACE WITH (raise default + rationale):
      | `nudges.driftThresholdTokens` | `6000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
  - THEN APPEND 2 rows immediately after it (preserving schema order):
      | `nudges.driftWindowTurns` | `3` | Rolling window (in turns) over which the per-turn token delta is smoothed before thresholding (`spec/07-preventive-and-nudges.md` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. |
      | `nudges.highWaterFraction` | `0.7` | Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered — fires once on crossing, clears when the total drops back below). Catches slow, steady accumulation the delta nudge misses. |
  - NOTE: These 2 new rows go AFTER driftThresholdTokens and BEFORE the `| **audit** | | |` section header.

Task 4: EDIT README.md — Minimal example `settings.json` (lines ~104–111)
  - FIND: the commented `// "nudges": { ... "driftThresholdTokens": 3000 }` line.
  - REPLACE the commented `mulligan` block so it shows the 2 new shrink keys, the 2 new nudge
    keys, and the 6000 default. Target after-state (keep the `// ` comment prefix and jsonc):
      ```jsonc
      {
        // "mulligan": {
        //   "enabled": true,
        //   "rewind": { "maxDepth": 5 },
        //   "shrink": { "maxActive": 32, "staleAfterFires": 3 },
        //   "nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "bash": 32768, "read": 20480 }, "driftThresholdTokens": 6000, "driftWindowTurns": 3, "highWaterFraction": 0.7 }
        // }
      }
      ```
  - PRESERVE: the surrounding prose ("The `mulligan` block is optional...") and the ```jsonc fence.

Task 5: VERIFY (no edits) — see Validation Loop Level 1–2.
```

### Implementation Patterns & Key Details

```markdown
# Table style to match (3 columns: Knob | Default | What it does):
| `nudges.bloatThresholdBytes` | `16384` | Global catch-all: ... (existing long row) |
# Section sub-header rows (bold label, empty cols):
| **shrink** | | |

# Rationale sourcing: condense FROM the PRD h2.103 rows, do not invent wording. The exact PRD
# text for each knob is the authoritative source — keep faithful meaning; minor tightening for
# table-cell length is fine (the table already has long cells, e.g. bloatThresholdBytesByTool).

# driftThresholdTokens rationale (authoritative, from PRD h2.103): "Raised from 3000 after live
# use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes
# 6k a quiet, accurate trip point." — include this point in the rewritten cell.
```

### Integration Points

```yaml
CODE: none — README.md is documentation, imported by nothing.
CONFIG: none — config.ts DEFAULT_CONFIG is already correct; do NOT change it.
TESTS: none — README changes have no test surface; vitest + tsc are unaffected and stay green.
DOCS: this IS the docs change (Mode B). Cross-refs to spec sections (spec/07, spec/08) should
      match the spec file names actually present in the repo (verify with `ls spec/`).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# No linter step exists for markdown in this repo (package.json has only tsc + vitest).
# Validate manually that the markdown table is well-formed (each new row has 3 pipe-separated
# columns) and the jsonc example still parses as comments:

# Render check: ensure table rows have matching column count.
awk '/^\| Knob \|/{p=1} p&&/^\|/{n=gsub(/\|/,"|"); print NR": "n" pipes"} /^\| log\.file/{p=0}' README.md
# Expected: every data row shows the same number of pipes (no broken rows).
```

### Level 2: Content Consistency (the real gate)

```bash
# (a) No stale 3000 anywhere in README (the ONLY 3000 uses were driftThresholdTokens):
grep -n "3000" README.md
# Expected: NO output. If anything prints, a 3000 reference was missed.

# (b) All 4 new knobs + 6000 appear in the table:
grep -nE 'shrink\.maxActive|shrink\.staleAfterFires|nudges\.driftWindowTurns|nudges\.highWaterFraction' README.md
# Expected: 4 distinct row lines (one per knob) in the Defaults table.

# (c) 6000 appears in BOTH the table cell and the JSON example:
grep -n "6000" README.md
# Expected: ≥2 lines (the driftThresholdTokens table row + the JSON example line).

# (d) Header knob-count updated:
grep -n "All 17 knobs" README.md
# Expected: exactly 1 line.
grep -n "All 13 knobs" README.md
# Expected: NO output (old text gone).

# (e) Cross-check the new defaults against the source of truth:
grep -nE 'maxActive: 32|staleAfterFires: 3|driftThresholdTokens: 6000|driftWindowTurns: 3|highWaterFraction: 0.7' src/config.ts
# Expected: each value present in DEFAULT_CONFIG. README values must match these EXACTLY.
```

### Level 3: Integration Testing (System Validation)

```bash
# Docs-only task — no runtime integration to test. Confirm no source file imports README:
grep -rl "README" src/ test/ 2>/dev/null || echo "no code references README (expected)"

# Confirm the build/test baseline is unaffected (should be green before AND after; README
# is not compiled or tested):
npx tsc --noEmit && echo "tsc OK (unaffected by README edit)"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Visual review: open README.md §3 and read the table top-to-bottom. Confirm:
#  - shrink section now has 3 rows (enabled, maxActive, staleAfterFires) in schema order;
#  - nudges section ends with driftThresholdTokens(6000) → driftWindowTurns → highWaterFraction;
#  - JSON example's nudges line lists the same keys in the same order, with 6000;
#  - JSON example now includes a `// "shrink": { "maxActive": 32, "staleAfterFires": 3 }` line;
#  - nothing in §2, §4, §5 was changed (those are S2/S3 scope).

# Optional: render the README in a markdown viewer to confirm the table and the jsonc block
# display correctly (no broken pipes, no unclosed fence).
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: markdown table rows well-formed (matching column counts).
- [ ] Level 2 (a): `grep -n "3000" README.md` → empty.
- [ ] Level 2 (b): all 4 new knobs present in the Defaults table.
- [ ] Level 2 (c): `6000` present in the table cell AND the JSON example.
- [ ] Level 2 (d): "All 17 knobs" present; "All 13 knobs" gone.
- [ ] Level 2 (e): every new README default matches `src/config.ts` `DEFAULT_CONFIG` verbatim.
- [ ] Level 3: no source/test file references README; `npx tsc --noEmit` still green.

### Feature Validation

- [ ] Defaults table now lists all 17 knobs from `config.ts` `DEFAULT_CONFIG`.
- [ ] `nudges.driftThresholdTokens` row reads `6000` and states the raise-from-3000 rationale.
- [ ] JSON example shows all 4 new keys + `driftThresholdTokens: 6000`.
- [ ] Header note reads "All 17 knobs".

### Code Quality Validation

- [ ] New table rows match the existing 3-column style and section-sub-header pattern.
- [ ] Nudge row order matches config.ts / PRD schema order (driftThresholdTokens → driftWindowTurns → highWaterFraction).
- [ ] Cross-references use the correct spec file names (verify with `ls spec/`).
- [ ] No edits to §2, §4, §5, or any `src/` file.

### Documentation & Deployment

- [ ] Rationale wording is faithful to PRD h2.103 (condensed, not invented).
- [ ] No environment variables or config code touched.

---

## Anti-Patterns to Avoid

- ❌ Don't edit §4 (Tools) or §2/§5 (feature blurbs) — those are S2/S3, separate tasks.
- ❌ Don't modify `src/config.ts` or any source file — the knobs already ship; this is docs-only.
- ❌ Don't invent rationale wording — condense faithfully from PRD h2.103.
- ❌ Don't reorder existing rows; only add new rows in schema order and rewrite the driftThresholdTokens cell.
- ❌ Don't leave any `3000` in README after the edit (it's a stale-value signal).
- ❌ Don't re-run `npm test`/`tsc` as a *gate* for a docs change — they're unaffected and stay green; use the grep checks in Level 2 as the real gate.