# Test Impact Analysis — Delta 002

## Critical Breakage: `test/nudges.test.ts`

The existing nudges tests have hardcoded fixtures that will **BREAK** when the default threshold
changes from `8192` to `16384` and per-tool resolution is added.

### Current test constants (test/nudges.test.ts):
```typescript
const THRESHOLD = 8192;
const OVER_TEXT = "x".repeat(9000);  // 9000 bytes — over 8192
const UNDER_TEXT = "y".repeat(5);    // 5 bytes — well under 8192
```

Tests use `makeEvent("read", text)` — so `toolName` is always `"read"`.

### After the change:
- `THRESHOLD` for "read" = `20480` (per-tool default)
- `OVER_TEXT` (9000 bytes) < 20480 → would be **UNDER threshold** for "read"
- ALL existing over-threshold tests would fail (they expect the bloat reminder to fire)

### Required test updates:

1. **Resize `THRESHOLD` and fixtures** to account for per-tool resolution:
   - Either keep `makeEvent("read", ...)` and resize OVER_TEXT to >20480 bytes
   - Or use a toolName with known threshold (e.g., unknown tool → global 16384)
   - Or override the threshold via `setConfig({ nudges: { bloatThresholdBytes: X } })`

2. **Boundary test** (line ~183): `atText = "y".repeat(THRESHOLD)` — must use the resolved
   threshold for whatever toolName is used.

3. **New per-tool scenario tests** needed:
   - `bash` result fires only above 32 KB (32768)
   - `read` result fires only above 20 KB (20480)
   - unknown tool fires above global 16 KB (16384)
   - `undefined` toolName → uses global
   - custom override via `bloatThresholdBytesByTool` config

4. **`bloatThresholdFor` unit test** (new, standalone):
   - Import `bloatThresholdFor` from `src/nudges.js`
   - Test: `bloatThresholdFor("bash", config)` → 32768
   - Test: `bloatThresholdFor("read", config)` → 20480
   - Test: `bloatThresholdFor("unknown_tool", config)` → 16384
   - Test: `bloatThresholdFor(undefined, config)` → 16384
   - Test: empty override map → global

## Test Updates: `test/config.test.ts`

### Literal 8192 → 16384 updates (~8 places):
1. **DEFAULT_CONFIG toEqual** — change `bloatThresholdBytes: 8192` to `16384`, add `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }`
2. **"validates numbers" test** — fallback assertions reference 8192 → 16384
3. **"does NOT warn for ABSENT fields" test** — may reference threshold
4. **getConfig/setConfig cache tests** — `setConfig({nudges:{bloatThresholdBytes:-5}})` expects 8192 → 16384
5. **"applies a full valid override" test** — nudges block needs bloatThresholdBytesByTool

### New test coverage needed:
- Default `bloatThresholdBytesByTool` equals `{ bash: 32768, read: 20480 }`
- Partial override merge: `{ bash: 99999 }` → bash=99999, read=20480 (merge, not replace)
- Invalid map value dropped with warn: `{ bash: -1, read: 20480 }` → bash dropped, read kept
- Non-object map → discarded, default used, one warn

## Test Updates: `test/integration/smoke.ts`

### Comment updates (~4 places):
- Line 14: `>8KB canary result` comment → update to reflect new thresholds
- Line 136: `>8KB exceeds config.nudges.bloatThresholdBytes (default 8192)` → 16384 or per-tool
- Line 198: `bloatThresholdBytes (8KB)` → updated value
- Line 493: `>8KB canary result` comment

### Scenario impact:
The smoke test uses `mulligan_smoke_big` which returns a >8KB canary. With the new defaults:
- If toolName is `bash`-like → needs >32KB to trigger
- The smoke test may need to produce a larger canary or target a known-threshold tool

**NOTE**: The smoke test's bloat detection is already noted as model-driven (the handler fires on
`tool_result` events from actual model tool calls, not from registerTool registration). The comments
need updating regardless, but the scenario behavior may not change since it already notes the
model-driven limitation.

## Documentation Updates: `README.md`

### Config table (line 91):
Current: `| nudges.bloatThresholdBytes | 8192 | description (8 KB) |`
New: `| nudges.bloatThresholdBytes | 16384 | description (16 KB) |`
Add row: `| nudges.bloatThresholdBytesByTool | { "bash": 32768, "read": 20480 } | description |`

### Example JSON (line 107):
Current: `"nudges": { "bloatThresholdBytes": 8192, "driftThresholdTokens": 3000 }`
New: `"nudges": { "bloatThresholdBytes": 16384, "bloatThresholdBytesByTool": { "bash": 32768, "read": 20480 }, "driftThresholdTokens": 3000 }`

### How-It-Works bullet (line 203):
Current: `... any result exceeding bloatThresholdBytes.`
New: `... any result exceeding the per-tool bloat threshold (bash: 32 KB, read: 20 KB, others: 16 KB).`