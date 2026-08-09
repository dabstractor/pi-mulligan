# Research Notes — P3.M3.T1.S1

## Task scope
Add two config knobs (`driftWindowTurns`, `highWaterFraction`) to `MulliganConfig.nudges`, raise
`driftThresholdTokens` default 3000→6000, add validation, fix all affected tests. **Pure config.ts +
test edits — no behavior change in nudges.ts/filter.ts.**

## config.ts (the ONLY src file touched)
- `MulliganConfig.nudges` interface (~lines 60-80): currently has bloatReminder, perTurnDrift,
  bloatThresholdBytes, bloatThresholdBytesByTool?, driftThresholdTokens. **ADD** `driftWindowTurns: number`
  + `highWaterFraction: number`. Update driftThresholdTokens JSDoc (says "Default: 3000" → 6000).
- `DEFAULT_CONFIG.nudges` (~line 113-122): `driftThresholdTokens: 3000` → **6000**. **ADD**
  `driftWindowTurns: 3`, `highWaterFraction: 0.7`.
- `validateConfig` nudges block (~lines 232-239): **ADD** after the driftThresholdTokens line:
  - driftWindowTurns: `coerceNumber(...,true)` then `Math.floor` (defensive ternary).
  - highWaterFraction: dedicated inline `(0,1)` check → `warnConfig` on invalid.
- Helpers to reuse: `safeGet`, `coerceNumber(field, value, fallback, mustBePositive)`, `warnConfig(field, value)`.

## The contract's exact validation code (verbatim from item description)
```typescript
// driftWindowTurns (positive integer):
v = safeGet(nudgesRaw, "driftWindowTurns");
if (v !== undefined) {
  const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
  cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
}
// highWaterFraction (fraction in open interval (0,1)):
v = safeGet(nudgesRaw, "highWaterFraction");
if (v !== undefined) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;
  else warnConfig("nudges.highWaterFraction", v);
}
```
Note: after coerceNumber, `n` is ALWAYS finite (it returns either a finite>0 value or the finite
fallback) → `Number.isFinite(n)` is always true → always floors. The ternary is defensive
belt-and-suspenders (keep it verbatim per contract).

## HIGH-VALUE (0,1) boundary verification for highWaterFraction
| input   | typeof number? | finite? | >0? | <1? | result            |
|---------|----------------|---------|-----|-----|-------------------|
| 0       | yes            | yes     | NO  | yes | invalid → 0.7 + warn |
| 1       | yes            | yes     | yes | NO  | invalid → 0.7 + warn |
| -0.5    | yes            | yes     | NO  | yes | invalid → 0.7 + warn |
| 1.5     | yes            | yes     | yes | NO  | invalid → 0.7 + warn |
| NaN     | yes            | NO      | -   | -   | invalid → 0.7 + warn |
| "0.7"   | NO (string)    | -       | -   | -   | invalid → 0.7 + warn (NO string coercion) |
| 0.5     | yes            | yes     | yes | yes | VALID → 0.5 |
| 0.01    | yes            | yes     | yes | yes | VALID → 0.01 |

## ⚠️ CRITICAL GOTCHA — turn_metric.test.ts breaks (NOT in contract's explicit scope)
`src/nudges.ts:225`: `grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens`.
`test/turn_metric.test.ts` beforeEach: `setConfig(structuredClone(DEFAULT_CONFIG))` → uses the DEFAULT
threshold. Three tests construct deltas against 3000:
- **Line 190** "records grewOverThreshold true": delta 3001, asserts `grewOverThreshold === true`.
  With 6000 → `3001 > 6000` FALSE → **BREAKS** (expects true).
- **Line 206** "delta == threshold → false": delta 3000, asserts false. With 6000 → `3000 > 6000` false
  → still PASSES but the "== threshold" comment is STALE (now it's "< threshold").
- **Line 341** (multi-turn, describe ~330): turn 2 delta 4000, asserts `grewOverThreshold === true`.
  With 6000 → `4000 > 6000` FALSE → **BREAKS** (expects true).

### Fix (robust, intent-preserving): PIN the threshold in these boundary tests
The INTENT of these tests = verify strict `>` at a controlled threshold, NOT verify the default value.
Pin `driftThresholdTokens: 3000` via `setConfig({ nudges: { driftThresholdTokens: 3000 } })` as the first
line of the two expecting-true tests (190, 341) and the boundary test (206). This:
- keeps the existing deltas (3001/3000/4000) meaningful (> 3000),
- keeps the existing comments accurate ("delta = 3001 > 3000"),
- decouples the boundary test from the global default (won't break on future default changes).
setConfig deep-merges per-leaf → `{ nudges: { driftThresholdTokens: 3000 } }` alone is sufficient
(all other nudges — incl. new knobs — stay default).

## Other files referencing 3000 (NON-breaking for `npm test`, optional accuracy)
- `test/integration/smoke.ts:221` — COMMENT "default 3000" → update to 6000 (comment only).
- `test/integration/scenarios.md:181,196` — markdown "3000" → 6000 (not run by vitest).
- These do NOT affect `npm test` (vitest run only runs *.test.ts; smoke = separate `npm run smoke`).
  Listed as optional cleanup. Contract says "DOCS: none" (referring to spec/ Mode-A docs).

## Tests confirmed UNAFFECTED (build grewOverThreshold literals, don't read config threshold)
- `test/drift_nudge.test.ts` — shouldNudge unit tests, pass `{} as never` for config, set grewOverThreshold on the literal directly.
- `test/filter.test.ts:72` — builds TurnMetric with grewOverThreshold passed in.
- `test/markers.test.ts:143,216` — metric literals.
No references to driftWindowTurns/highWaterFraction anywhere in src/test (consumers are future T4/T5/T6).

## config.test.ts — existing assertions to UPDATE (all use 3000 → 6000)
1. DEFAULT_CONFIG toEqual (~line 28): nudges needs `driftThresholdTokens: 6000` + `driftWindowTurns: 3, highWaterFraction: 0.7`.
2. "deep-merges partial valid overrides" (~line 59): `.toBe(3000)` → `.toBe(6000)`.
3. "applies a full valid override" (~lines 68-76): expected nudges toEqual object MUST add
   `driftWindowTurns: 3, highWaterFraction: 0.7` (deep-equality fails otherwise; input doesn't set them → default).
4. "does NOT warn for ABSENT fields" (~line 216): `.toBe(3000)` → `.toBe(6000)`.

## config.test.ts — NEW describe block (mirror the shrink.maxActive P3.M2.T1.S1 pattern)
Cases per contract MOCKING section + boundary coverage. Use vi.spyOn(console,"warn") for warn counts.

## Validation commands (verified)
- `npx tsc --noEmit` — type check (no separate build script).
- `npm test` → `vitest run` — full suite.
- No linter/formatter configured (package.json scripts: "test", "smoke" only).

## Architecture doc confirmation
- `architecture/system_context.md` §config.ts: "DEFAULT_CONFIG.nudges.driftThresholdTokens = 3000 — P3 delta: raise to 6000";
  "nudges — P3 delta: add driftWindowTurns: 3, highWaterFraction: 0.7".
- `architecture/external_deps.md` §Config validation pattern: confirms coerceNumber pattern + the note
  that highWaterFraction needs a dedicated (0,1) check (coerceNumber doesn't enforce <1), driftWindowTurns
  needs coerceNumber(true) + floor to integer. MATCHES the contract exactly.