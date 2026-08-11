# Research Notes — P1.M1.T1.S2: Update filter.ts suppressCheck call site to pass recentMetrics

## Dependency on S1 (assumed implemented)
S1 (P1.M1.T1.S1) modifies src/nudges.ts: suppressCheck signature → `(metric, recentMetrics, markers)`;
turn-boundary lower bound `lo = recentMetrics[1].ts` (length>=2) else `lo=0`; NUDGE_TURN_WINDOW_MS REMOVED.
**S1 ALSO fully updates test/drift_nudge.test.ts**: removes NUDGE_TURN_WINDOW_MS import, rewrites ALL
suppressCheck calls to 3-arg (mechanism describe 170-220 + acceptance a/b/c describe 222-265), adds BUG-001
regression. → drift_nudge.test.ts is S1's; S2 does NOT touch it (would cause merge conflicts).

## S2 scope: src/filter.ts ONLY — one-line call-site change (+ optional comment touch-up). 1 point.

## The call site (filter.ts:314-322, the contextHandler drift-nudge if-block)
```
if (
  config.nudges.perTurnDrift &&
  markers.recentMetrics &&
  markers.recentMetrics.length > 0 &&      // ← GUARANTEES recentMetrics non-empty before suppressCheck
  shouldNudge(markers.recentMetrics, config) &&
  markers.metric &&
  !suppressCheck(markers.metric, markers) &&   // ← LINE 319 — THE CHANGE
  rt.rewindRefusedTurnIndex !== markers.metric.turnIndex
) {
  messages = injectNudge(messages, markers.metric);
}
```
CHANGE line 319: `!suppressCheck(markers.metric, markers)` → `!suppressCheck(markers.metric, markers.recentMetrics, markers)`.
Nothing else in the if-condition changes (shouldNudge, markers.metric, rewindRefusedTurnIndex stay).

## Why it's safe (typecheck + runtime)
- MarkersBundle (filter.ts:88-114) has `{rewinds, shrinks, metric, cancelledIds, recentMetrics}`. suppressCheck's
  3rd param is typed `{rewinds, shrinks}` → MarkersBundle is STRUCTURALLY ASSIGNABLE (extra fields ignored). ✓
- `markers.recentMetrics` is ALWAYS an array (readMarkers fail-open returns `[]`, filter.ts:147). And line 316
  guards `length > 0` before suppressCheck runs → recentMetrics is guaranteed NON-EMPTY at the call site. ✓
- suppressCheck handles length===1 (first turn) → lo=0 fallback (S1's logic). So passing a length-1 array is fine. ✓
- `markers.metric` is truthy (line 318 guard) before suppressCheck → arg 1 is non-null. ✓

## The S1 intermediate failure mode (what S2 fixes at runtime)
After S1 but BEFORE S2: filter.ts:319 calls `suppressCheck(markers.metric, markers)` — 3rd arg `recentMetrics`
is `undefined` at runtime → `recentMetrics.length` throws TypeError inside suppressCheck → the if-condition
evaluation throws → caught by contextHandler's OUTER try/catch (line 236 try / line 435 catch) →
`messages = injectNudge(...)` NEVER runs → the drift nudge SILENTLY no-ops (fail-open, no crash).
→ test/filter.test.ts:454 "injects the drift nudge when shouldNudge(metric) is true and not suppressed" FAILS.
S2's one-line fix makes recentMetrics a real array → no throw → nudge injects → that test goes GREEN.

## tsc gate
After S1, `npx tsc --noEmit` reports EXACTLY ONE new error: `src/filter.ts:319` TS2554 (Expected 3 arguments,
but got 2). S2's change resolves it. After S2: tsc is fully clean (the only outstanding bugfix-series error
elsewhere is unrelated to this task — verify no NEW error cites filter.ts).

## Validation gates for S2
- `npx tsc --noEmit` → ZERO errors (the filter.ts:319 TS2554 is resolved). [S1 left this one error; S2 clears it.]
- `npx vitest run test/drift_nudge.test.ts` → green (S1's tests; S2 confirms NO regression — these are direct
  unit tests of suppressCheck, not the filter path).
- `npx vitest run` FULL suite → GREEN. This is S2's UNIQUE gate: filter.test.ts:454 (drift-nudge injection
  through contextHandler) goes RED→GREEN. (filter.test.ts:470 "does NOT inject when suppressed by same-turn
  rewind" also exercises the path — passes under both S1 and S2, confirms the suppress branch.)

## Optional comment touch-up (filter.ts:310-312)
The comment block says "injectNudge/suppressCheck still take the single LATEST metric (markers.metric) for the
text + the time-window suppress heuristic." After S2, suppressCheck ALSO takes recentMetrics (for the turn-boundary
lower bound). Update this comment to avoid staleness: note suppressCheck now takes recentMetrics too. (Lines
105-107 + 193 in the MarkersBundle JSDoc also mention "suppressCheck ... still use the single latest metric" —
those are slightly stale too but lower priority; the line 310-312 comment is the one adjacent to the change.)

## Reconciliation: item says "update drift_nudge.test.ts acceptance tests" — but S1 already does
The S2 item description says "update them to use the new 3-arg signature." But S1's CONTRACT (Task 4c) already
updates the acceptance a/b/c describe (lines 222-265) to 3-arg. Per the parallel_execution_context directive
("Do NOT duplicate or conflict with work specified in the previous PRP"), S2 does NOT edit drift_nudge.test.ts.
S2 VERIFIES those tests pass (they're S1's deliverable). S2's real test contribution is the FULL-suite green
gate (the filter integration path). Documented as Decision D1.