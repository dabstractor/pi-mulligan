# Research notes — P3.M4.T1.S1 (README config table + JSON example sync)

## Task
Update README.md §3 "Configuration": (a) add 4 knobs to the defaults table, (b) change
`nudges.driftThresholdTokens` default 3000→6000 + add rationale, (c) update the commented
JSON example. DOCS-ONLY (Mode B). No src/ changes.

## Scope boundaries (CRITICAL — do NOT expand)
- THIS task = README §3 only: the "Defaults table" (lines 73–96) + "Minimal example
  settings.json" (lines 99–112).
- P3.M4.T1.S2 = add `mulligan_cancel` to §4 Tools list — DO NOT TOUCH.
- P3.M4.T1.S3 = feature blurbs in §2/§5 (windowed drift, high-water, marker retraction) — DO NOT TOUCH.

## Current README.md state (verified by reading lines 73–112)
- Line 75: `All 13 knobs (source of truth: \`src/config.ts\` \`DEFAULT_CONFIG\`...).`
- Defaults table rows currently present (13 knobs):
  - enabled; rewind.{enabled,protectedRoles,maxDepth,requireMutationWarning};
    shrink.enabled (ONLY — shrink.maxActive / shrink.staleAfterFires MISSING);
    nudges.{bloatReminder,perTurnDrift,bloatThresholdBytes,bloatThresholdBytesByTool,
    driftThresholdTokens=`3000`}; audit.estimateConfidence; log.file.
  - `nudges.driftWindowTurns` / `nudges.highWaterFraction` MISSING.
- JSON example (lines 104–111): commented mulligan block with
  `rewind: {maxDepth:5}` + `nudges: {... driftThresholdTokens: 3000}`; NO shrink block.

## config.ts DEFAULT_CONFIG (verified — the SOURCE OF TRUTH, lines ~95–120)
```ts
shrink: { enabled: true, maxActive: 32, staleAfterFires: 3 },
nudges: {
  bloatReminder: true, perTurnDrift: true,
  bloatThresholdBytes: 16384,
  bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
  driftThresholdTokens: 6000,   // <-- already 6000 (P3.M3.T1.S1 COMPLETE)
  driftWindowTurns: 3,          // <-- already present
  highWaterFraction: 0.7,       // <-- already present
},
```
=> README LAGS config.ts. The 4 new knobs + 6000 all already ship in DEFAULT_CONFIG.
P3.M2.T1.S1 (shrink knobs) and P3.M3.T1.S1 (nudge knobs + raise) are COMPLETE.
This task is purely a docs catch-up.

## Knob count: 13 → 17
13 existing + 4 new (shrink.maxActive, shrink.staleAfterFires, nudges.driftWindowTurns,
nudges.highWaterFraction) = 17. Line 75 "All 13 knobs" → "All 17 knobs".
(Verified: only line 75 mentions "13 knobs"; grep found no other stale knob-count.)

## PRD rationale text (authoritative source — plan/.../prd_snapshot.md h2.103)
- shrink.maxActive (32): "Bounds long-session filter cost and marker accumulation; the oldest
  shrink is retired when exceeded. Mirrors rewind.maxDepth."
- shrink.staleAfterFires (3): "Auto-retire a pinned shrink whose target has been absent this
  many consecutive fires (E15/E21). Stops dead markers from being walked every fire."
- nudges.driftThresholdTokens (6000): "Windowed (§5.1) per-turn token delta that triggers the
  drift nudge. Raised from 3000 after live use showed 3k false-positived on routine multi-file
  reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point."
- nudges.driftWindowTurns (3): "Rolling window over which the drift delta is smoothed before
  thresholding (§5.1). Turns a noisy single-turn signal into a sustained-growth signal."
- nudges.highWaterFraction (0.7): "Fraction of the context window at which the §5.2 high-water
  annotation fires (edge-triggered). Catches slow steady accumulation the delta nudge misses."

## Nudges row ORDER (match config.ts / PRD schema h2.102 order)
After the existing `nudges.driftThresholdTokens` row, append `nudges.driftWindowTurns` then
`nudges.highWaterFraction`. (Schema order: ...driftThresholdTokens, driftWindowTurns,
highWaterFraction.)

## Validation (docs-only — no test framework for README)
1. Read updated README §3, confirm table reflects config.ts DEFAULT_CONFIG exactly.
2. Grep: `grep -n "3000" README.md` → expect ZERO hits (the only 3000 refs are driftThresholdTokens).
3. Grep: `grep -nE "maxActive|staleAfterFires|driftWindowTurns|highWaterFraction|6000" README.md`
   → each new knob appears in BOTH the table AND the JSON example; 6000 in both.
4. Confirm "All 17 knobs" on the header note line.
5. NO `npx tsc --noEmit` / `npm test` impact — README is not imported by any code.
   (Confirmed: grep `README` across src/ → no source file imports/reads README.md.)

## No external research needed
Pure internal docs sync; PRD h2.102 (schema) + h2.103 (rationale table) supply all content.
The mulligan extension IS loaded (mulligan_shrink tool used to compact a bloated read).