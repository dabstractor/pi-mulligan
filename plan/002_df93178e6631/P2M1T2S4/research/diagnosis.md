# Research Notes — P2.M1.T2.S4 (Attempt 2/3 re-plan)

## TL;DR
Attempt 1 was README-only and fully correct, but left `npm test` red on 1 test in
`test/tools/audit.test.ts`. Root cause: the test-impact analysis that drove the task breakdown
**omitted `test/tools/audit.test.ts`**, so no subtask (S1–S3) owned it. S4's "final cross-cutting
docs sweep" mandate is the correct home for the fix. The revised PRP sweeps ALL surviving stale
`8192`/`8 KB` doc references (README verify + the failing test + stale src JSDoc).

## Evidence

### 1. README.md is already correct (Attempt 1's work is intact in the working tree)
```
$ grep -nE "8192|8 KB|8KB" README.md
(empty)
```
- Header: "All 13 knobs" ✓
- Config-table row `nudges.bloatThresholdBytes | 16384 | … 16 KB … per-tool precedence` ✓
- New row `nudges.bloatThresholdBytesByTool | { "bash": 32768, "read": 20480 } | …` ✓
- Commented jsonc example has all three keys with new defaults ✓
- How-It-Works bullet: per-tool resolution (bash 32 KB / read 20 KB / others 16 KB) ✓
→ README needs **verify-only** in the revised PRP.

### 2. The failing test (the actual issue)
`npm test` output (pre-fix):
```
✗ test/tools/audit.test.ts > … > flags a toolResult whose bytes exceed config.nudges.bloatThresholdBytes
  → expected false to be true   (audit.test.ts:425)
Test Files  1 failed | 17 passed (18)   Tests  1 failed | 721 passed (722)
```
Failing test body (audit.test.ts:416-426):
```ts
beforeEach(() => setConfig({}));                       // → DEFAULT_CONFIG: bloatThresholdBytes = 16384
…
getRuntime("s1").lastFiltered = [
  toolResult("call-A", "read", kbText(10)),            // kbText(10) = 10*1024 = 10240 bytes
];
const res = await run(ctx, {});
expect(res.details.top[0].bloaty).toBe(true);          // FAILS: 10240 < 16384 → bloaty=false
expect(firstText(res)).toContain("⚠ above bloat threshold (8 KB)");
```

### 3. WHY it fails — audit bloat flag is GLOBAL, not per-tool
`src/tools/audit.ts:520-529`:
```ts
const threshold = config.nudges.bloatThresholdBytes;   // GLOBAL default 16384 (raised by S1)
…
bloaty: messageBytes(msg) > threshold,
```
So the `toolName: "read"` in the fixture is IRRELEVANT — the audit flag uses the global value.
Per-tool resolution (`bloatThresholdFor`) lives ONLY in the nudge handler (wired by S1, P2.M1.T2.S1).
The fix is therefore: resize the fixture above **16384** (global), not above 20480 (read).
`kbText(20)` = 20480 > 16384 → `bloaty=true` → test passes. Flag string becomes `"(16 KB)"`
(16384/1024 = 16; built at audit.ts:418 `⚠ above bloat threshold (${kb} KB)`).

### 4. The test-impact analysis MISSED this file
`plan/002_df93178e6631/architecture/test_impact_analysis.md` enumerates updates for:
- `test/nudges.test.ts` → S2 ✓ (done, 29 tests pass)
- `test/config.test.ts` → S1/S2 ✓ (done)
- `test/integration/smoke.ts` → S3 ✓ (done)
- `README.md` → S4 ✓ (done)
- **`test/tools/audit.test.ts` → NOT MENTIONED** ← the gap

### 5. Stale vs intentional `8192` occurrences (the precision-critical map)
CHANGE (stale default refs): `audit.test.ts:289,421,422,426`; `src/tools/audit.ts:301`;
`src/notes.ts:275`; `src/nudges.ts:16`.
LEAVE (intentional, passing — a blanket replace BREAKS these):
- `test/notes.test.ts` — `renderBloatReminder("read", 8192, 8192)` etc. (explicit threshold arg)
- `test/tokens.test.ts:334` — `approxTokens(8192)).toBe(2048)` (math identity)
- `test/config.test.ts:97` — string `"8192"` not coerced → default 16384 (non-coercion test)
- `test/tools/audit.test.ts:684,714,734` — `renderAuditReport` explicit `thresholdBytes:8192` → "(8 KB)" correct
- `src/notes.ts:346`, `src/tokens.ts:284` — function-behavior math examples at fixed input

## External references
None needed — this is an internal doc/test sync against `src/config.ts` DEFAULT_CONFIG. No library
docs required (TS/Vitest, already in the project).

## Validation command ground-truth (verified on this machine)
- `npm test` → 1 failed (pre-fix). After Task 1 fix → expect 0 failed.
- `grep -nE "8192|8 KB|8KB" README.md` → empty (already).
- `package.json` scripts = `{ test, smoke }` → **no `build` script** (Attempt 1 noted this; confirmed).