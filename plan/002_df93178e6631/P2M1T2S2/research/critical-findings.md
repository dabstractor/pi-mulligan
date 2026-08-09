# P2.M1.T2.S2 Research — Critical Findings

## Finding 1 — EMPTY-MAP CONFIG CANNOT BE BUILT VIA setConfig (BLOCKER for naive impl)

The item description says: *"Construct configWithEmptyMap by setting nudges.bloatThresholdBytesByTool = {}."*

**This does NOT work through setConfig.** Verified in `src/config.ts`:

```typescript
function coerceBloatThresholdByTool(value, fallback) {
  if (!isRecord(value)) { warnConfig(...); return fallback ?? {}; }
  const result: Record<string, number> = { ...(fallback ?? {}) };   // ← MERGES over fallback
  for (const [toolName, threshold] of Object.entries(value)) { ... }
  return result;
}
```

And the call site (line 226) passes `cfg.nudges.bloatThresholdBytesByTool` (which is `{ bash: 32768, read: 20480 }` from the DEFAULT_CONFIG clone) as the fallback. So `setConfig({ nudges: { bloatThresholdBytesByTool: {} } })` yields `{ bash: 32768, read: 20480 }` (defaults PRESERVED), NOT an empty map.

**Therefore** the unit test for `bloatThresholdFor("bash", emptyMapConfig) === 16384` MUST hand-build a MulliganConfig literal that BYPASSES validateConfig:

```typescript
const emptyMapConfig: MulliganConfig = {
  ...DEFAULT_CONFIG,
  nudges: { ...DEFAULT_CONFIG.nudges, bloatThresholdBytesByTool: {} },
};
```

`bloatThresholdFor` is a PURE function taking `(toolName, config)` — it never calls validateConfig, so a hand-built literal works directly.

## Finding 2 — DEFAULT_CONFIG (S1 landed, verified)

`src/config.ts` lines 109-110:
```typescript
bloatThresholdBytes: 16384,
bloatThresholdBytesByTool: { bash: 32768, read: 20480 },
```

## Finding 3 — approxTokens(bytes) = Math.ceil(bytes / 4)

Confirmed indirectly: existing test pins `approxTokens(9000) === 2250` (= ceil(9000/4)). So:
- OVER_BYTES = 21000 → approxTokens = ceil(21000/4) = **5250**
- grep fixture 20000 → ceil(20000/4) = **5000**

## Finding 4 — S1 contract (parallel impl, treat as landed)

`export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number` lands in
src/nudges.ts. Resolution:
```typescript
const global = config.nudges.bloatThresholdBytes;
if (!toolName) return global;
const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
return byTool[toolName] ?? global;
```
Handler line changes `const threshold = config.nudges.bloatThresholdBytes;` →
`const threshold = bloatThresholdFor(event.toolName, config);`.

Resolution table: bash→32768, read→20480, grep/unknown/undefined/""→16384.

## Finding 5 — FULL enumeration of tests that BREAK vs STAY GREEN

### BREAK (need edits):
1. `const THRESHOLD = 8192` — used by read-tool tests which now resolve to 20480. Must become READ_THRESHOLD.
2. `OVER_TEXT = "x".repeat(9000)` (9000 < 20480 → under) → resize to 21000.
3. `OVER_BYTES = 9000` → 21000.
4. Boundary test `"y".repeat(THRESHOLD)` — uses read → must be 20480.
5. justUnder `"z".repeat(THRESHOLD - 1)` → READ_THRESHOLD - 1.
6. renderBloatReminder reuse `renderBloatReminder("read", OVER_BYTES, THRESHOLD)` → READ_THRESHOLD.
7. approxTokens pin `2250` → `5250`.
8. multi-result "first" test: `makeEvent("grep", "y".repeat(10000))` — 10000 < 16384 → under → NO hit. Expects 2 hits. Must resize grep to >16384 (e.g. 20000). approxTokens(20000)=5000.
9. multi-result "mixed" test: `makeEvent("bash", "q".repeat(20000))` — 20000 < 32768 → under → NO hit. Expects 2 hits [read, bash]. Must resize bash to >32768 (e.g. 40000).
10. All comments referencing "8192" / "8KB" / "2k tokens" / "2250" / "9000".

### STAY GREEN (verify, no edit needed):
- config gates (2): short-circuit before threshold via `if (!config.enabled || !config.nudges.bloatReminder) return;`.
- mulligan_* skip (2): returns before threshold via `if (event.toolName.startsWith("mulligan_")) return;`.
- under-threshold "small" test: 5 bytes < any threshold.
- fail-open proxy tests (3): throw before threshold check.
- fail-open healthy-cfg: uses OVER_TEXT — STAYS GREEN after OVER_TEXT resize (21000 > 20480).

## Finding 6 — Per-tool scenario test design (4 cases)

| scenario                                  | toolName  | bytes         | resolved thr | fires? |
|-------------------------------------------|-----------|---------------|--------------|--------|
| bash just under                           | "bash"    | 32767         | 32768        | NO     |
| bash over                                 | "bash"    | 40000         | 32768        | YES    |
| unknown tool over global but under read   | "grep"    | 18000         | 16384        | YES    |
| read over global but under read           | "read"    | 18000         | 20480        | NO     |

The last two are the discriminating pair: same 18000 bytes, different toolName → different outcome. Proves per-tool resolution works.