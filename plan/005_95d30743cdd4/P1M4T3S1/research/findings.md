# Research findings — P1.M4.T3.S1 (suppressCheck §5.3 JSDoc + test align)

## The function under edit (src/nudges.ts:390)

`suppressCheck(metric, markers)` is PURE and returns `true` (suppress) iff some rewind/shrink
`marker.ts` falls in the half-open window `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`.
**Mechanism = ts-window, NOT seq-based.** Per item contract point (c): DO NOT rewrite to seq-based
(the spec itself frames suppress as a "Simple heuristic"; only rewrite if a test shows mis-fires —
none do).

```ts
export function suppressCheck(
  metric: TurnMetric,
  markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> },
): boolean {
  const metricTs = typeof metric.ts === "number" && Number.isFinite(metric.ts) ? metric.ts : 0;
  const lo = metricTs - NUDGE_TURN_WINDOW_MS;
  for (const m of markers.rewinds) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  for (const m of markers.shrinks) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  return false;
}
```

## JSDoc that needs the §5.3 citation (2 spots)

### `suppressCheck` JSDoc — first paragraph (src/nudges.ts:367)
CURRENT cites **only** `spec/07 §2 "Edge cases"`. NEEDS to cite **§5.3** as the hard rule + the
"regardless of delta or bloatHit" framing. KEEP §2 as the ORIGIN note (§5.3 *promotes* the §2
edge-case heuristic to a hard rule). KEEP the GOTCHA #6/#7 paragraphs unchanged.

### `NUDGE_TURN_WINDOW_MS` JSDoc (src/nudges.ts:260)
CURRENT: `"...for suppressCheck (spec/07 §2 \"Edge cases\": suppress if a rewind/shrink marker was
created \"during the metric's turn\")..."`. The window IS the §5.3 mechanism → cite §5.3 as the rule
it implements (keep §2 origin for consistency).

## Existing test coverage (grep-verified)

### test/drift_nudge.test.ts:171 — `describe("suppressCheck — suppress heuristic window (spec/07 §2 Edge cases)")`
10 unit tests proving the ts-window MECHANISM: no markers→false; rewind at T/T−1→true; rewind at
T−window→false (lower exclusive); rewind at T−window−1→false; rewind at T+1→false (future, strict
upper); **shrink at T→true**; non-finite ts→false; any-marker→true; non-finite metric.ts→0.
These prove suppressCheck returns true for same-turn shrink/rewind, but are (a) labeled §2 not §5.3,
and (b) do NOT assert the COMBINED §5.3 semantic.

**Helpers in the file (reuse, do NOT re-create):**
- MODULE-LEVEL (reusable across describes): `metric(opts)`, `rewind(seq,ts)`, `shrink(seq,ts)`.
- LOCAL to `describe("shouldNudge…")`: `m(deltaTokens,bloatHit,seq)` + `cfg(windowTurns,threshold)`.
  → a new §5.3 describe must define its OWN `driftWindow()` + `cfg()` (it cannot see the shouldNudge-
  scoped `m`/`cfg`).

### test/filter.test.ts:453–510 — integration-level drift-suppression (contextHandler + makeCtx)
- L453 `"injects the drift nudge when shouldNudge true and not suppressed"` → **§5.3 (b)** at the
  integration level (fires normally, no marker).
- L467 `"does NOT inject … suppressed by a same-turn rewind marker"` (metric.ts=1+rewind.ts=1) →
  **§5.3 (c)** at the integration level (rewind). Uses a REWIND — so **(a) [shrink] is NOT covered
  at integration level** (only at unit level via drift_nudge.test.ts:199).
- L482 shouldNudge-false; L490/502 refused-rewind mute (E22, orthogonal to §5.3).
- These use `metricData(turnIndex, grew)` + `customEntry("mulligan:rewind", rewindData(seq))`.
  Mechanism UNCHANGED → they pass as-is (architecture note: "should already pass").

## §5.3 acceptance mapping (spec/07 §5.3 + spec/10 F-nudge-drift L88)

§5.3 frames the rule as "`shouldNudge` returns false for that metric regardless of delta or
`bloatHit`" — but the IMPLEMENTATION delegates to a SEPARATE `suppressCheck` gate called AFTER
`shouldNudge` in the pipeline (filter.ts:319). So the §5.3 NET nudge decision is:
`shouldNudge(recentMetrics, config) && !suppressCheck(metric, markers)`. The new explicit §5.3
acceptance tests assert THAT combined guard for:

- **(a)** >threshold window + same-turn SHRINK → net `false` (no nudge). [gap — add at unit level]
- **(b)** >threshold window + NO action → net `true` (fires normally). [exists @ filter.test.ts:453]
- **(c)** >threshold window + same-turn REWIND → net `false` (no nudge). [exists @ filter.test.ts:467]

spec/10 F-nudge-drift (test/integration/scenarios.md:177 + smoke.ts:220 + run-smoke.mjs:492) is the
Tier-2 REAL-pi integration mirror — ALREADY EXISTS, not in scope to write. The unit-level (a)/(b)/(c)
tests in drift_nudge.test.ts are the deterministic foundation for it.

## filter.ts call site (src/filter.ts:319) — READ ONLY (proves the combined guard)
```ts
if (
  config.nudges.perTurnDrift &&
  markers.recentMetrics && markers.recentMetrics.length > 0 &&
  shouldNudge(markers.recentMetrics, config) &&
  markers.metric &&
  !suppressCheck(markers.metric, markers) &&                    // ← §5.3 gate
  rt.rewindRefusedTurnIndex !== markers.metric.turnIndex        // E22 (orthogonal)
) {
  messages = injectNudge(messages, markers.metric);
}
```
This is the authoritative shape the §5.3 acceptance tests mirror (`shouldNudge && !suppressCheck`).

## Decision
- src/nudges.ts: JSDoc edits ONLY on `suppressCheck` (L367) + `NUDGE_TURN_WINDOW_MS` (L260). NO body change.
- test/drift_nudge.test.ts: relabel the L171 describe to cite §5.3; ADD a focused §5.3 (a)/(b)/(c)
  acceptance describe asserting the combined `shouldNudge && !suppressCheck` guard. Test COUNT +3.
- test/filter.test.ts: OPTIONAL §5.3 traceability comments on L453/L467 (mechanism unchanged → no
  logic edit; pure labeling for spec cross-ref). Include as a defined-but-low-risk task.
- DOCS [Mode A]: the suppressCheck JSDoc IS the doc. No separate .md.

## Scope boundary (do NOT touch)
- The suppressCheck FUNCTION BODY (point (c) — mechanism stays ts-window).
- renderDriftNudge / renderBloatReminder (T1, T2 — parallel siblings).
- renderHighWaterNudge / shouldHighWater (§5.2 — different nudge).
- README (M5), config, spec/*.