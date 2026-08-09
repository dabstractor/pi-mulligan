# Research Notes — P4.M2.T1.S2 (flip stale bloat-armed test assertions)

All file/line refs verified against current HEAD (working tree). The contract's line numbers (90-92 / 86-88 /
~919) were measured against an **older** tree; the **actual current** lines are +5 (drift_nudge) / +24
(filter.test.ts). **Match by content, not line number.**

## 1. drift_nudge.test.ts — the two relevant assertions (describe block "shouldNudge — windowed drift gate")

Helpers (top of the block): `m(deltaTokens, bloatHit=false, seq=1)` and `cfg(windowTurns=3, threshold=6000)`.

### (a) The STALE assertion → FLIP (current lines 95-97)
```ts
  it("fires on bloatHit even when the windowed average is below threshold", () => {
    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);   // ⟵ .toBe(true) is now WRONG
  });
```
After P4.M2.T1.S1, `shouldNudge([m(500,true,1)], cfg())`: deltas=[500] (finite), avg 500 < 6000, bloat no
longer OR'd → returns **false**. So `.toBe(true)` must become `.toBe(false)`, and the test title must be
renamed (it currently asserts the OLD behavior). Contract rename: "does NOT fire on bloatHit when delta data
exists and average is below threshold".

### (b) The no-delta fallback → ALREADY GREEN, KEEP (current lines 90-93)
```ts
  it("fires when ANY window metric has bloatHit (independent of the windowed delta) — bloat-only", () => {
    // all deltas null (first turn / post-reload), one bloatHit → true.
    expect(shouldNudge([m(null, true, 1)], cfg())).toBe(true);
  });
```
`m(null,true,1)` → deltas=[] → `if (deltas.length===0) return window.some(m=>m.bloatHit===true)` → true.
This is the ONLY surviving bloat-armed path and **must stay green**. Optional: add a one-line comment that
this is the no-delta fallback (first turn / post-reload), to pair visually with the flipped test above.

### (c) These STAY GREEN (do NOT touch) — confirmed delta-driven:
- "does NOT fire on a single heavy turn amid small turns — [8k,0.5k,0.5k]" → avg 3000 < 6000 → false ✓
- "fires on sustained growth — [7k,7k,7k]" → avg 7000 > 6000 → true ✓
- "returns false for an empty window" / "all null no bloat" / window-slicing / malformed-delta ✓

## 2. filter.test.ts — scan result

### The ONLY stale thing is a COMMENT (current line 943), not an assertion
```ts
941  // ── P3.M3.T6.S1: windowed drift-nudge wiring (spec/07 §5.1, REQUIRED) ───────────────────────────
942  // Thin wiring asserts: contextHandler passes the FULL recentMetrics window (NOT the single metric) to
943  // shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, or any window bloatHit) is
944  // unit-tested in test/drift_nudge.test.ts (P3.M3.T4.S1). ...
```
The "or any window bloatHit" clause on line 943 is now FALSE for the delta-available path. Fix wording →
"delta-only when delta data exists; bloatHit is a no-delta fallback only".

### Why NO filter.test.ts ASSERTION goes stale — `metricData` is delta-driven
```ts
function metricData(seq: number, grew = false, bloat = false): Record<string, unknown> {
  return { ..., deltaTokens: grew ? 7000 : 100, bloatHit: bloat, ... };
}
```
All drift-nudge *injection* tests call `metricData(seq, GREW, [bloat])` with bloat defaulting **false**:
- L453 "injects the drift nudge when shouldNudge(metric) is true": `metricData(1, true)` → delta 7000 > 6000 →
  fires on **delta**, bloat=false → STAYS GREEN ✓
- L482 "does NOT inject ... (no growth, no bloat)": `metricData(1, false, false)` → delta 100 < 6000, bloat
  false → no fire → STAYS GREEN ✓
- L490 "does NOT inject ... rewind was refused": `metricData(1, true)` delta 7000 > 6000 (would fire) but
  suppressed by rewindRefusedTurnIndex flag → STAYS GREEN ✓
- L947 single heavy window `[7000,100,100]` → avg 2400 < 6000 → no fire → STAYS GREEN ✓
- L965 sustained window `[7000,7000,7000]` → avg 7000 > 6000 → fire → STAYS GREEN ✓

NONE assert "bloat fires the drift nudge when delta exists". So filter.test.ts needs **comment wording only**.

## 3. nudges.test.ts — scan result: NO CHANGE

`grep -c shouldNudge test/nudges.test.ts` → **0 matches**. The entire file tests Nudge A
(`bloatReminderHandler`, `registerBloatReminder`, `bloatThresholdFor`) — a different nudge, unrelated to the
drift-nudge bloatHit arm. **No stale bloat-armed assertion exists here.** Document this so the implementer
does not waste time scanning it.

## 4. Validation

- `npm test` (= `vitest run`) is the gate — the edits are entirely in test files. After S1's code change +
  S2's assertion flip + comment fixes, the **entire suite must be green** (S1 left exactly ONE red case; S2
  flips it back to green and nothing else changes color).
- `npx tsc --noEmit` stays green (test-file edits are type-neutral; no signature change).
- There is NO `npm run build` script (package.json). Use `npx tsc --noEmit` + `npm test`.

## 5. Line-number drift note (for the implementer)

The item contract cites lines 90-92 (stale) / 86-88 (fallback) / ~919 (filter comment). The CURRENT tree has
these at **95-97** / **90-93** / **943** respectively (P4.M1.T2.S3's test additions shifted everything down).
The `edit` tool matches by **exact text**, so line drift is harmless — but DO NOT key off the contract's line
numbers; key off the exact `it(...)` titles + `m(...)` / `metricData(...)` calls reproduced above.