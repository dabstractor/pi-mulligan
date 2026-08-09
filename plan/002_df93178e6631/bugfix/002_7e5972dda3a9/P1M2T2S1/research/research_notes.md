# Research Notes — P1.M2.T2.S1: Fix spec/10-testing.md:67 F-shrink-preventive threshold >8KB → >16KB (BUG-003a)

## Scope
Mode A (documentation-only). A single in-place edit to ONE line of ONE markdown table in ONE spec file.
`>8KB` → `>16KB`. Nothing else changes.

## The single target site (verbatim, confirmed via sed/grep 2025)
`spec/10-testing.md` line 67:
```
| **F-shrink-preventive** | `tool_result` hook annotates a >8KB result | result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |
```
- This is a 3-cell markdown table row in §2.1 ("Required scenarios & pass criteria").
- The MIDDLE cell (`How to drive`) contains the stale `>8KB`.
- The RIGHT cell (`Pass criteria`) is CORRECT and must NOT change.

## Exact change
- FIND substring: `>8KB`
- REPLACE substring: `>16KB`
- The full row becomes:
  ```
  | **F-shrink-preventive** | `tool_result` hook annotates a >16KB result | result content has the appended `[mulligan]` reminder; `turn-metric` records `bloatHit:true` |
  ```

## Why >16KB is correct (source-of-truth)
The global default `bloatThresholdBytes` is `16384` = 16 KB. Confirmed in three places:
- `spec/07-preventive-and-nudges.md:52` — "Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context)"
- `spec/09-configuration.md:66` — defaults table: "`16384` (16 KB) | Global catch-all for tools without a per-tool override."
- `src/config.ts:62,109` — JSDoc "Default: 16384 (16 KB)" + DEFAULT_CONFIG `bloatThresholdBytes: 16384`.

The F-shrink-preventive scenario describes the GENERIC case (an unlisted tool exceeds the global default),
so `>16KB` is the correct figure. Per-tool (read 20 KB / bash 32 KB) are higher overrides; the global default
is what an unlisted tool triggers. `architecture/system_context.md` §BUG-003 prescribes exactly this: "Should
be: `>16KB result` (the global default; per-tool is 20KB read / 32KB bash)."

## Exhaustive grep (no other stale sites in this file)
`grep -n '>8KB\|>8 KB\|>8kb' spec/10-testing.md` → returns ONLY line 67. So there is exactly one edit.

## Parallel-sibling coordination (no file overlap)
- **P1.M2.T1.S1** (parallel, currently implementing): edits `spec/04-data-model.md` ONLY (config schema
  8192→16384 + add bloatThresholdBytesByTool field). Does NOT touch spec/10.
- **P1.M2.T2.S2** (planned): edits `spec/01-pi-context-internals.md:197` ONLY (`(e.g. 8 KB in-context)` →
  `(e.g. 16 KB in-context)`). Does NOT touch spec/10.
- This PRP (P1.M2.T2.S1) edits `spec/10-testing.md:67` ONLY. No file overlap with either sibling.

## Tech stack / validation
- spec/10-testing.md is a markdown documentation file. NO code, NO tests touched.
- No build/test step is required for this change itself. Validation = grep that `>8KB` is gone, `>16KB` is
  present, and the row's other cells are byte-identical.
- Cross-doc consistency check: the new `>16KB` figure must match spec/07:52 / spec/09:66 / src/config.ts
  (16384 / 16 KB).

## Out of scope (do NOT touch)
- `spec/01-pi-context-internals.md:197` → owned by P1.M2.T2.S2.
- `spec/04-data-model.md:243` → owned by P1.M2.T1.S1.
- `spec/07`, `spec/09` → already correct (READ-ONLY reference).
- `src/*` → code, out of scope.
- Any other row in the spec/10 §2.1 table.
- The pass-criteria cell of the F-shrink-preventive row.