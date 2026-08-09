# Research Notes — P1.M1.T2.S1 (BUG-003 spec alignment, doc-only)

## Target
`spec/05-tools.md` §4 (`## 4. \`mulligan_audit\``) — the authoritative audit-tool spec.
Two stale sites, both predate the P2 per-tool bloat threshold change.

## Confirmed exact current text (verbatim from file)

**Line 196** — inside the `### Return shape` report-format ` ```md ` block (§4 starts at line 172; Return shape at 184; Behavior at 204):
```
  9,412  toolResult  read src/big.log           ⚠ above bloat threshold (8 KB)
```
`cat -A` confirms leading 2 spaces, then `9,412`, 2 spaces, `toolResult`, 2 spaces, `read src/big.log`, then a run of spaces before `⚠`. The `(8 KB)` is the OLD default (8192). read's correct per-tool threshold is 20480 = **20 KB**.

**Line 208** — `### Behavior` clause 4:
```
4. Render the report. Include the suggestion heuristic: any message above `config.nudges.bloatThresholdBytes` is flagged; the single largest is named in the suggestion.
```
This defines the bloat flag as GLOBAL-ONLY. Must become per-tool.

**Sweep**: awk over lines 170–215 found ONLY these two stale sites (region lines 27→196, 39→208). No other `8 KB`/global-only wording in §4.

## Authoritative references (cross-spec consistency targets)

- **spec/07-preventive-and-nudges.md §1 "Threshold default & calibration"** (already correct after P2):
  - global default `bloatThresholdBytes = 16384` (16 KB)
  - per-tool via `bloatThresholdFor(toolName, config)`: falsy/missing toolName → global; else `byTool[toolName] ?? global`
  - shipped overrides `{ "bash": 32768, "read": 20480 }`, all others fall back to 16 KB global
  - rationale: legitimate output size differs by tool (bash builds/logs tens of KB; lsp payloads tiny)

- **spec/09-configuration.md §2** (defaults table lines 66–67) + config example lines 35–38:
  - `bloatThresholdBytes: 16384` (16 KB)
  - `bloatThresholdBytesByTool: { bash: 32768 (32 KB), read: 20480 (20 KB) }`
  - Note §4 line 77 says non-object input → "discard entirely (use global only)"; implementation actually returns DEFAULT MAP. This is the separate "Additional Observation" — OUT OF SCOPE for this subtask (do not touch spec/09 here).

- **src/nudges.ts** `bloatThresholdFor` (lines 86–91): pure helper, `if (!toolName) return global; ... byTool[toolName] ?? global`. Confirms falsy toolName → global.

## Parallel dependency: P1.M1.T1.S1 (the CODE fix, running in parallel)
- Modifies ONLY `src/tools/audit.ts` + `test/tools/audit.test.ts` (NOT spec files).
- Shipped audit behavior after T1.S1: resolves threshold PER ROW via `bloatThresholdFor(readStr(msg,"toolName"), config)`.
  - `toolResult` messages → their toolName's per-tool threshold (bash 32 KB / read 20 KB / others 16 KB).
  - non-toolResult messages (assistant/user/system) → global 16 KB (toolName absent → falsy → global).
  - Each flagged row renders its OWN resolved threshold KB: `Math.round(r.thresholdBytes/1024) KB`.
- T1.S1 ALSO updates the code-INTERNAL JSDoc example string inside audit.ts to "(20 KB)". That is a separate surface from spec/05. Both must end up consistent. No file conflict (different files).
- IMPLICATION for clause 4 wording: must describe BOTH toolResult (per-tool) AND non-toolResult (global) cases to match shipped audit — not toolResult-only.

## Design decision: example row change
- The example row `9,412  toolResult  read src/big.log` → its flag must read `(20 KB)` (read's 20480 → 20 KB), NOT `(8 KB)`.
- The "Suggestion" line (region line ~31) names `read src/big.log` as the largest contributor — stays valid (9,412 is still largest). If adding an optional bash `(32 KB)` row, it must slot in ranked order WITHOUT exceeding the 9,412-token read row (so read remains "largest"). Keep optional-bash simple.

## Validation approach (doc-only → grep + cross-check, no tests)
1. grep spec/05-tools.md for `(8 KB)` → expect ZERO hits in §4 after edit.
2. grep spec/05-tools.md for the global-only phrase `config.nudges.bloatThresholdBytes) is flagged` → expect ZERO hits.
3. grep for `(20 KB)` and `bloatThresholdFor` → expect the new content present.
4. Cross-check: the thresholds cited (bash 32 KB, read 20 KB, global 16 KB) match spec/07 §1 and spec/09 §2.