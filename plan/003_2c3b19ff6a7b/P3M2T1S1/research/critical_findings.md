# Research Notes — P3.M2.T1.S1: shrink.maxActive + shrink.staleAfterFires config knobs

## Task
Add `maxActive: number` (32) and `staleAfterFires: number` (3) to `MulliganConfig.shrink`,
`DEFAULT_CONFIG.shrink`, and the `validateConfig` shrink block. Pure config-plumbing — the consumption
(stale-retirement + soft-cap logic) is a LATER task (P3.M2.T3.S1, Planned). This task defines the knobs only.

## Verified facts (read directly from src/config.ts, test/config.test.ts, architecture/*.md)

### 1. The `coerceNumber` contract (src/config.ts, ~line 200)
```ts
function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) {
    return value;
  }
  warnConfig(field, value);
  return fallback;
}
```
- mustBePositive=true → finite AND > 0 (0 is REJECTED → fallback).
- Both new knobs use mustBePositive=true per the contract (>0).
- Invalid values warn ONCE via `warnConfig("shrink.maxActive", value)` and return the fallback.

### 2. The current shrink block in validateConfig (src/config.ts)
```ts
// shrink.*  (autoOnBloat intentionally NOT honored — reserved, not v1; S1 GOTCHA #1)
const shrinkRaw = safeGet(raw, "shrink");
if (isRecord(shrinkRaw)) {
  v = safeGet(shrinkRaw, "enabled");
  if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
}
```
New lines go INSIDE this `if (isRecord(shrinkRaw))` block, after the enabled line:
```ts
v = safeGet(shrinkRaw, "maxActive");
if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
v = safeGet(shrinkRaw, "staleAfterFires");
if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
```

### 3. autoOnBloat STAYS OUT (hard constraint)
The code comment + test "ignores unknown keys ... incl. shrink.autoOnBloat" enforce this. Do NOT add it.
spec/07 D3 reserves it; v1 deliberately omits it (auto-shrink risks data loss).

## ★★★ CRITICAL: THREE existing test assertions in test/config.test.ts WILL BREAK

Adding fields to DEFAULT_CONFIG.shrink and to validateConfig's shrink output changes the exact shape.
Three EXACT `toEqual` assertions currently assume `shrink` is `{ enabled }` only. They MUST be updated
in the SAME change or `npm test` fails on untouched assertions:

1. **DEFAULT_CONFIG defaults test** (~line 18) — the big `expect(DEFAULT_CONFIG).toEqual({...})`:
   `shrink: { enabled: true }`  →  `shrink: { enabled: true, maxActive: 32, staleAfterFires: 3 }`

2. **"applies a full valid override" test** (~line 62, input at :64 + expected at :68):
   Both the input AND expected `shrink: { enabled: false }` need the new knobs (add maxActive+staleAfterFires
   to the input override for a meaningful "full override" test, and mirror them in the expected output).

3. **"ignores unknown keys ... incl. shrink.autoOnBloat" test** (~line 210):
   `expect(cfg.shrink).toEqual({ enabled: true })`  →  `expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 })`
   (cfg built from `{ shrink: { autoOnBloat: true } }`: enabled absent→true, new fields absent→defaults.)
   The trailing `expect(cfg).toEqual(validateConfig({ rewind: { enabled: false } }))` is FINE (both sides
   route through validateConfig).

## New tests to ADD (per contract §5 MOCKING)
- `validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } })` → maxActive===10, staleAfterFires===5.
- Absent → defaults 32 / 3.
- Invalid (0, -1, NaN, 'abc', Infinity) for EACH knob → falls back to its default (32 / 3); exactly one warn
  naming the field. Use `vi.spyOn(console, "warn")` + mockRestore idiom (see existing bloatThresholdByTool tests).
- `shrink.enabled` behavior unchanged (the existing "ignores unknown keys" test already covers enabled; keep it).

## Scope boundaries
- THIS task: config.ts + config.test.ts ONLY.
- Does NOT touch filter.ts / runtime.ts / markers.ts / any tool / index.ts.
- The consumption (stale retirement + soft cap) is P3.M2.T2.S1 (runtime miss-counts) + P3.M2.T3.S1/S2 (logic).
- No docs change (spec/09 already specifies these knobs — they are the SOURCE of this delta).

## Validation gates (verified from package.json + prior PRPs)
- `npx tsc --noEmit` — strict; adding fields to the MulliganConfig interface is type-checked.
- `npm test` — vitest; the 3 updated assertions + new shrink-knob cases must all pass; no regressions elsewhere.