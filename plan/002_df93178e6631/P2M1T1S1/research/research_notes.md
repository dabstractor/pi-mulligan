# Research Notes — P2.M1.T1.S1

## Task
Add `bloatThresholdBytesByTool?: Record<string, number>` to `MulliganConfig.nudges`,
raise global `bloatThresholdBytes` default 8192→16384, add default map
`{ bash: 32768, read: 20480 }`, update JSDoc, update `test/config.test.ts` literals.

## Verified current state (direct reads)

### src/config.ts
- Interface `MulliganConfig.nudges` (lines 55-66): `bloatReminder`, `perTurnDrift`,
  `bloatThresholdBytes` (line 63), `driftThresholdTokens`. **NO** `bloatThresholdBytesByTool`.
- JSDoc on `bloatThresholdBytes` (lines 60-62): says "Default: 8192 (8 KB)".
- `DEFAULT_CONFIG.nudges` (lines ~102-105): `bloatThresholdBytes: 8192`.
- `validateConfig` (lines ~209-218): reads the 4 nudges fields via safeGet/coerceNumber.
  **No** handling for `bloatThresholdBytesByTool` — that coercion is **S2**, not S1.

### test/config.test.ts — ALL 7 occurrences of `8192` (CRITICAL: item text names only 2)
1. Line 26 — `DEFAULT_CONFIG` toEqual: `bloatThresholdBytes: 8192` (+ needs new field added)
2. Line 92 — 'validates numbers': `bloatThresholdBytes: -1` → `.toBe(8192)` (fallback)
3. Line 93 — 'validates numbers': `bloatThresholdBytes: 0` → `.toBe(8192)`
4. Line 94 — 'validates numbers': `bloatThresholdBytes: NaN` → `.toBe(8192)`
5. Line 95 — 'validates numbers': `bloatThresholdBytes: Infinity` → `.toBe(8192)`
6. Line 96 — 'validates numbers': input `"8192"` string (STAYS), output `.toBe(8192)` (changes)
7. Line 183 — setConfig cache test: invalid `-5` → `.toBe(8192)` (fallback)

ALL of 2-7 must become `.toBe(16384)` or they FAIL (fallback default changed).
- 'applies a full valid override' expected output (line 75) needs new field added (default map,
  because the deep-cloned DEFAULT_CONFIG carries it; input line 67 stays unchanged).
- 'deep-merges partial' (line 56) and 'does NOT warn for ABSENT' (line 152) use field-specific
  asserts, NOT toEqual → unaffected. ✓

## Scope boundary — CONFIRMED breaks are EXPECTED & out of S1 scope
Other test files call `setConfig({})` (re-validate from DEFAULT_CONFIG) and hardcode 8192:
- test/nudges.test.ts: `THRESHOLD=8192`, `OVER_TEXT="x".repeat(9000)`, boundary `"y".repeat(8192)`
- test/tools/audit.test.ts: comment "threshold 8192", relies on default
- test/integration/smoke.ts: comments "default 8192", >8KB canary

After S1 raises default → 16384, 9000 bytes is UNDER threshold → these tests BREAK.
Per `architecture/test_impact_analysis.md` + plan tree, these are **T2.S2 / T2.S3** scope.
⇒ S1 validation gate = `npx vitest run test/config.test.ts` (passes).
⇒ `npx vitest run` (full suite) WILL show expected failures in nudges/audit/smoke — NOT S1's job.

## S1 vs S2 distinction
- S1 (THIS): field in interface + DEFAULT_CONFIG + JSDoc + config.test.ts literal updates only.
  validateConfig does NOT yet read `bloatThresholdBytesByTool` from raw input → a user-provided
  map is silently ignored in S1 (coercion added in S2). DEFAULT_CONFIG's default map flows
  through via deep-clone, so DEFAULT_CONFIG + 'full override' expected outputs carry it. ✓
- S2 (next): adds `bloatThresholdBytesByTool` coercion to validateConfig + new validation tests
  (partial-merge, invalid-value-drop, non-object-discard).

## Validation environment
- TS project, vitest. package.json scripts: `test: vitest run`, `smoke`.
- NO linter script (no eslint/prettier). Type check = `npx tsc --noEmit`.
- No upstream dependency (foundation subtask).

## Downstream consumers (verify field name chosen here matches)
- P2.M1.T1.S2: validateConfig reads `config.nudges.bloatThresholdBytesByTool`
- P2.M1.T2.S1: `bloatThresholdFor(toolName, config)` reads `config.nudges.bloatThresholdBytesByTool ?? {}`
- spec/07 §1 + spec/09 §2 are source of truth for the exact field name + defaults.