# Research — P1.M5.T1.S1: README config table + JSON example

**Task type:** Mode B (changeset-level documentation sync). Touches **README.md ONLY**.
**Scope sibling:** P1.M5.T1.S2 ("Feature blurbs for four behavior changes") owns §4 tool blurbs +
§5/§6/§7 prose — NOT this task. Do not touch those.

## Source-of-truth values (confirmed by direct read, 2025-08-10)

### `src/config.ts` — the knob this task documents (already shipped in M2.T1.S1)
- Interface field (line 73): `notifyMaxChars: number;` (REQUIRED, no `?`), JSDoc lines 69–72:
  *"Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded — a pure UI
  side-channel with ZERO context cost (the tool result itself stays terse). Must be > 0."*
- DEFAULT_CONFIG (line 146): `notifyMaxChars: 2048,`
- Validation (line 271): `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)` (4th arg
  `true` = mustBePositive `>0`; invalid ≤0/non-number → 2048 + warn).
- Consumer (already shipped in M2.T1.S2, `src/tools/shrink.ts` lines 320–326): `cap(params.replacement,
  config.shrink.notifyMaxChars)` → `ctx.ui.notify(...)`.

### `spec/09-configuration.md` — the rationale source the README cites (READ-ONLY, already correct)
- §2 schema (line 34): `"notifyMaxChars": 2048,        // cap on the replacement shown to the operator via ctx.ui.notify (ZERO context cost)`
- §3 rationale (line 75, the row the README must mirror):
  `| shrink.notifyMaxChars | 2048 | Caps the replacement text shown to the operator via ctx.ui.notify when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). @05-tools.md §2. |`
- **§3 already lists 20 knobs** (notifyMaxChars included). The README currently lists 19 — it is behind. This
  makes the "All 19 knobs → All 20 knobs" bump a mechanical corollary, verified by counting both tables.

## README.md — exact current text at every edit/confirm site (with line numbers)

### EDIT 1 — knob-count caption (line 75)
- Current:  `All 19 knobs (source of truth: \`src/config.ts\` \`DEFAULT_CONFIG\`; rationale: \`spec/09-configuration.md\` §3).`
- Target:   `All 20 knobs (source of truth: \`src/config.ts\` \`DEFAULT_CONFIG\`; rationale: \`spec/09-configuration.md\` §3).`
- WHY: adding the notifyMaxChars row (EDIT 2) takes the table from 19 → 20 rows. Git history shows this count is
  actively maintained (commit `338dc161 "Fix stale knob count..."`), so leaving it at 19 is a regression.

### EDIT 2 — new config-table row (insert between line 91 and line 92)
- Line 91 (current, KEEP): `| \`shrink.staleAfterFires\` | \`3\` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires (\`spec/08-edge-cases.md\` E15/E21). Stops dead markers being walked every fire. |`
- Line 92 (current, KEEP): `| **nudges** | | |`   ← section subheader; new row goes ABOVE it
- INSERT (new row, mirrors spec/09 §3 rationale; README uses `spec/...` not `@...` refs):
  `| \`shrink.notifyMaxChars\` | \`2048\` | Caps the replacement text shown to the operator via \`ctx.ui.notify\` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). See \`spec/05-tools.md\` §2. |`
- Contract's short gist was *"Caps the replacement shown to the operator via ctx.ui.notify; zero context cost."*
  → expanded to spec/09 §3 text to match every other README row (they mirror spec/09 §3 one-for-one; e.g.
  `shrink.staleAfterFires` README row ≈ spec/09 §3 row). The §2/§3 cross-refs match README convention.

### EDIT 3 — JSON example shrink block (line 114)
- Line 113 (current, KEEP — confirmation target (d)):  `  //   "rewind": { "maxDepth": 5, "maxRetriesPerPrompt": 5, "abortContextFraction": 0.9 },`
- Line 114 (current, EDIT):  `  //   "shrink": { "maxActive": 32, "staleAfterFires": 3 },`
- Target:                    `  //   "shrink": { "maxActive": 32, "staleAfterFires": 3, "notifyMaxChars": 2048 },`
- Matches the contract verbatim and spec/09 §2 (which has `"notifyMaxChars": 2048` in the shrink block).

## Confirmations (NO edits — contract items (b) and (d), already present)
- (b) Line 96: `| \`nudges.bloatThresholdBytesByTool\` | \`{ "read": 24576 }\` | …` ✓ already correct (shipped in
  a prior delta — system_context.md "Already-done items, Change 5").
- (d) Line 113: rewind JSON example already has `maxRetriesPerPrompt` + `abortContextFraction` ✓ (P4 work).
- For both: a `grep` confirmation in the validation loop proves they remain intact post-edit.

## Knob-count reconciliation (the proof EDIT 1 is correct)
Count README table rows after EDIT 2 and compare to spec/09 §3:

| section   | README rows (post-edit)              | spec/09 §3 rows                      |
|-----------|--------------------------------------|--------------------------------------|
| master    | enabled                              | enabled                              |
| rewind    | enabled, protectedRoles, maxDepth, maxRetriesPerPrompt, abortContextFraction, requireMutationWarning | (same 6) |
| shrink    | enabled, maxActive, staleAfterFires, **notifyMaxChars** | (same 4, incl notifyMaxChars) |
| nudges    | bloatReminder, perTurnDrift, bloatThresholdBytes, bloatThresholdBytesByTool, driftThresholdTokens, driftWindowTurns, highWaterFraction | (same 7) |
| audit     | estimateConfidence                   | estimateConfidence                   |
| log       | file                                 | file                                 |
| **TOTAL** | **20**                               | **20**                               |

→ "All 20 knobs" is correct. Both sources agree.

## Tooling / validation environment
- `package.json` scripts: `test` (vitest), `smoke` (integration), `typecheck` (tsc). **No markdown linter** (no
  remark/prettier/textlint config in repo root). So validation is **grep + manual cross-check** — there is no
  `npm run` gate for README. `tsc`/`vitest` are irrelevant (no code change).
- README is git-tracked (unmodified at HEAD relative to this delta).

## No external research needed
This is an internal-docs sync against an already-shipped, already-specified knob. No library docs, no external
patterns. All three sources (src/config.ts, spec/09 §2/§3, README) are read and reconciled above.