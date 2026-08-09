# Research Notes — P3.M3.T4.S1 (windowed shouldNudge)

## Scope (from item contract)
Change `shouldNudge` in `src/nudges.ts` from a single-metric gate
`(metric: TurnMetric, _config: MulliganConfig) => metric.grewOverThreshold || metric.bloatHit`
to a windowed moving-average gate over `recentMetrics: TurnMetric[]`. Update the one call site in
`filter.ts` contextHandler + all tests.

## Algorithm decision: MOVING AVERAGE (documented, not sum)
spec/07 §5.1 offers "moving-average, or M-of-N" with threshold 6000, window 3, and TWO acceptance criteria:
(1) single 8k turn amid small turns does NOT fire; (2) three ~4k turns DO fire.

- MA `[8k,0.5k,0.5k]` = 3k < 6k → no fire ✓ ; `[4k,4k,4k]` = 4k < 6k → no fire ✗
- SUM `[8k,0.5k,0.5k]` = 9k > 6k → fire ✗ ; `[4k,4k,4k]` = 12k > 6k → fire ✓

Neither pure algorithm satisfies BOTH literally at threshold 6000. The PRIMARY intent of §5.1 is to
SUPPRESS SINGLE SPIKES (a heavy turn is routinely legitimate). Moving average satisfies that primary
intent (criterion 1). Criterion 2 is ILLUSTRATIVE of "sustained growth fires"; the raised threshold 6000
(config.ts: "the §5.1 windowing makes 6000 a quiet, accurate trip point") deliberately keeps the nudge
quiet, so three 4k turns correctly do NOT fire — sustained growth averaging > 6000 (e.g. three ~7k turns)
does. **CHOSEN: moving average vs threshold; bloatHit OR'd in.**

Sources: item contract RESEARCH NOTE; `architecture/implementation_patterns.md` Pattern 8 FINAL ANSWER
(line 178: "use moving average and compare to the threshold. Document the acceptance criteria").

## Exact current code (verified by read)
- `src/nudges.ts` ~L270–289: `shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean { return metric.grewOverThreshold === true || metric.bloatHit === true; }` (JSDoc above).
- `src/filter.ts` ~L263 call site (inside contextHandler):
  `shouldNudge(markers.metric, config) &&` — guarded by `markers.metric &&`, followed by
  `!suppressCheck(markers.metric, markers)` and `injectNudge(messages, markers.metric)` (both still take the
  single LATEST metric — UNCHANGED).
- `injectNudge(messages, metric)` + `suppressCheck(metric, markers)` — UNCHANGED (still single latest metric).

## Types (verified)
- `TurnMetric` (markers.ts): `{ deltaTokens: number | null; bloatHit: boolean; ... }`. deltaTokens is
  `number | null` (null = first turn / post-reload).
- `MulliganConfig.nudges.driftThresholdTokens` = 6000 (raised by P3.M3.T1.S1, COMPLETE);
  `driftWindowTurns` = 3 (positive int, floor'd in validateConfig); `highWaterFraction` = 0.7.
- Both knobs already exist in config.ts (P3.M3.T1.S1 COMPLETE). No config change in this task.

## Parallel predecessor dependency: P3.M3.T3.S1
Produces `MarkersBundle.recentMetrics: TurnMetric[]` — FULL array, sorted NEWEST-FIRST (highest seq at
index 0), NOT sliced. `markers.metric` (latest = recentMetrics[0] ?? null) KEPT for backward compat.
T4.S1's call site passes the FULL `markers.recentMetrics`; shouldNudge slices `driftWindowTurns` itself.

## Tests (verified by grep — `grep -rn shouldNudge src/ test/`)
- **Direct callers (rewrite needed):** `test/drift_nudge.test.ts` L60–76 — 4 tests calling
  `shouldNudge(metric(...), {} as never)`. These use the OLD single-metric semantics; rewrite to windowed.
- **Production call site:** `src/filter.ts:263` (ONE site).
- **`test/nudges.test.ts`:** 0 occurrences of shouldNudge (only tests Nudge A: bloatReminderHandler,
  registerBloatReminder, bloatThresholdFor). **NO change needed** despite the contract naming it.
- **`test/filter.test.ts`:** contextHandler tests (L445–479) do NOT call shouldNudge directly — they exercise
  contextHandler, which calls shouldNudge internally. They WILL break under the new logic unless the fixture
  is bumped (see below).

## CRITICAL GOTCHA — filter.test.ts metricData breaks under MA logic
`test/filter.test.ts` L82: `metricData(seq, grew, bloat)` returns `deltaTokens: grew ? 5000 : 100`.
The contextHandler drift-nudge tests (L445 "injects nudge when shouldNudge true", L459 "suppressed",
L474 "no nudge when shouldNudge false") use `metricData(1, true)` → deltaTokens 5000.
Under the NEW moving-average logic: avg([5000]) = 5000 < threshold 6000 → shouldNudge returns FALSE →
test L445 expects a nudge but gets none → FAILS.

**Fix:** bump `metricData`'s grew deltaTokens 5000 → 7000 (7000 > 6000 so a single grew metric fires,
preserving test intent; `grew=false` stays 100 < 6000 → no fire). One-number change; the readMarkers
tests that also use metricData only assert `seq` sorting, not deltaTokens, so the bump is invisible there.

## Validation commands (verified working)
- `npx tsc --noEmit` (strict:true) — type gate.
- `npx vitest run test/drift_nudge.test.ts` + `npx vitest run test/filter.test.ts` — affected files.
- `npm test` (= `vitest run`) — full suite (must stay green; the metricData bump keeps contextHandler
  tests green).
- No linter/formatter configured; no separate build script.

## No external research needed
The algorithm is fully specified (MA) by the item contract + Pattern 8. The spec §5.1 text and the
in-repo pattern are authoritative. No library docs / online examples add value for this pure-function change.