# PRP — P1.M1.T1.S1: Refactor `suppressCheck` to a turn-based lower bound (BUG-001 fix)

---

## Goal

**Feature Goal**: Fix BUG-001 — the per-turn drift nudge (Nudge B) is wrongly suppressed for ~10 minutes after ANY rewind/shrink marker. Replace `suppressCheck`'s fixed 10-minute **wall-clock window** (`metric.ts − NUDGE_TURN_WINDOW_MS`) with the spec/07 §5.3 **turn-boundary** mechanism: suppress iff some marker was created *during the metric's turn*, bounded below by the **previous** metric's `ts` (`recentMetrics[1].ts`), now available via `readMarkers`' `recentMetrics`.

**Deliverable**: A modified `src/nudges.ts` — (1) `suppressCheck` gains a `recentMetrics: TurnMetric[]` parameter and computes `lo = recentMetrics[1].ts` (first-turn fallback `lo = 0`); (2) the exported `NUDGE_TURN_WINDOW_MS` constant + its JSDoc are REMOVED (no longer used); (3) the `suppressCheck` JSDoc is rewritten (turn-based lower bound, new param, why wall-clock was replaced). Plus updated `test/drift_nudge.test.ts` (the direct unit tests) for the new signature/logic + a BUG-001 regression test.

**Success Definition**:
- `suppressCheck(latestMetric, [latestMetric, prevMetric], {shrinks:[{ts:prevMetric.ts}]})` returns **false** (a marker from the PREVIOUS turn no longer suppresses — the headline fix). Under the old wall-clock logic this returned `true`.
- `suppressCheck(latestMetric, [latestMetric, prevMetric], {shrinks:[{ts: between prev and latest}]})` returns **true** (a marker created DURING this turn still suppresses).
- `npx vitest run test/drift_nudge.test.ts` — all pass (direct unit tests updated + new regression test green).
- `npx tsc --noEmit` — the ONLY new error is `src/filter.ts:319` (the call site, now missing the 3rd arg — owned by S2 / P1.M1.T1.S2); NO error originates in `src/nudges.ts` itself.
- `NUDGE_TURN_WINDOW_MS` is gone from `src/nudges.ts` (grep clean).

## User Persona (if applicable)

**Target User**: The coding agent relying on Nudge B (the "free ride" drift nudge), and maintainers seeking spec/07 §5.3 compliance.

**Use Case**: The agent issues one `mulligan_shrink` to trim a bloated result. On subsequent, unrelated turns that each grow context, the drift nudge should fire normally (it no longer does under the old code — it stays suppressed for ~10 minutes).

**User Journey**: Agent shrinks at turn N → turns N+1, N+2, N+3 each add >threshold tokens → after the moving-average window exceeds `driftThresholdTokens`, `shouldNudge` returns true AND `suppressCheck` now returns false (no marker was created during N+3's turn) → the drift nudge fires. (Old behavior: `suppressCheck` returned true for ~10 min → nudge never fired.)

**Pain Points Addressed**: A single rewind/shrink disabled Nudge B for 10 minutes — exactly the scenarios where sustained context growth is most likely. The PRD calls Nudge B "the non-obvious mechanism the project pivoted on."

## Why

- **Business value / user impact**: Major. Restores the drift nudge's responsiveness after any rewind/shrink. Without it, the project's signature "free ride" feature is effectively disabled for ~10 minutes after the marker — the precise window where sustained growth is most likely and the nudge is most valuable.
- **Integration with existing features**: `suppressCheck` is the §5.3 gate composed in `filter.ts` contextHandler as `fire = shouldNudge(...) && !suppressCheck(metric, recentMetrics, markers)`. The previous-metric data (`recentMetrics[1]`) is now available — `readMarkers` (`src/markers.ts` / `src/filter.ts`) returns `recentMetrics: TurnMetric[]` sorted newest-first (P3.M3.T3.S1 added it). The old code's own comment admitted "There is no per-turn lower bound without the PREVIOUS metric" — that excuse is now stale.
- **Problems this solves and for whom**: BUG-001 (Major). For the agent: Nudge B fires when it should. For maintainers: spec/07 §5.3 compliance (the hard rule prescribes a turn-based mechanism, not a wall-clock window).

## What

User-visible behavior: after a rewind/shrink, the drift nudge resumes firing on the *next* turn (once `shouldNudge` is true), instead of waiting ~10 minutes. No behavior change for a marker created during the *current* turn (still suppressed — that's the §5.3 intent).

### Success Criteria

- [ ] `suppressCheck` signature is `(metric: TurnMetric, recentMetrics: TurnMetric[], markers: {rewinds, shrinks})`.
- [ ] The lower bound `lo` = `recentMetrics[1].ts` when `recentMetrics.length >= 2` (with a finite-`ts` guard); else `lo = 0` (first-turn / single-metric / corrupt-prev-ts fallback).
- [ ] A marker is "during this turn" iff `marker.ts > lo && marker.ts <= metric.ts` (both `ts` read defensively; non-finite → not in window → no suppress).
- [ ] `NUDGE_TURN_WINDOW_MS` constant + its JSDoc are REMOVED from `src/nudges.ts` (no longer referenced).
- [ ] The `suppressCheck` JSDoc documents the turn-based lower bound, the `recentMetrics` param, and why the wall-clock window was replaced; the stale "WHY a window / GOTCHA #7 / no per-turn lower bound" justification is removed.
- [ ] `test/drift_nudge.test.ts` updated: `NUDGE_TURN_WINDOW_MS` import removed; all `suppressCheck` calls pass the 3rd `recentMetrics` arg; the mechanism tests rewritten to turn-boundary semantics; a BUG-001 regression test added.
- [ ] `src/filter.ts:319` is UNCHANGED in S1 (it's S2's scope) — its expected TS2554 error is documented, not chased.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current `suppressCheck` body, the exact target body, the constant to remove, the JSDoc to rewrite, the test fixtures (`metric`/`rewind`/`shrink`) and the exact test scenarios (including the headline BUG-001 case), and — critically — tells the implementer that the `filter.ts:319` call-site breakage is EXPECTED and owned by S2.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/nudges.ts
  why: "THE file. suppressCheck is at lines 397-411 (body) + 378-396 (JSDoc). NUDGE_TURN_WINDOW_MS is line 270 (const) + 266-271 (its JSDoc). The defensive ts reads (typeof === 'number' && Number.isFinite) STAY."
  pattern: "CURRENT body: `const metricTs = ... ? metric.ts : 0; const lo = metricTs - NUDGE_TURN_WINDOW_MS;` then two loops checking `ts > lo && ts <= metricTs`. TARGET: replace the `lo` computation with the turn-boundary (recentMetrics[1].ts); keep the two loops + defensive reads EXACTLY as-is."
  gotcha: "The suppressCheck JSDoc (~378-396) has a 'WHY a window, not a pure upper bound (GOTCHA #7)' paragraph that JUSTIFIES the wall-clock window by claiming 'There is no per-turn lower bound without the PREVIOUS metric (readMarkers keeps only the latest)'. That claim is now FALSE (recentMetrics carries the previous metric). REMOVE that paragraph entirely when rewriting the JSDoc."

- file: src/markers.ts
  why: "Defines TurnMetric (lines 140-153): { kind:'turn-metric', seq, ts, deltaTokens:number|null, bloatHit, bloatHits, grewOverThreshold, turnIndex }. `ts` is `Date.now()` stamped by appendTurnMetric (line ~278). suppressCheck reads ONLY `.ts` from the metric and the markers — no other field."
  pattern: "TurnMetric.ts: number (Date.now() at append). RewindMarker.ts / ShrinkMarker.ts: number (Date.now() at append — markers.ts:221,250). All three share the MulliganEnvelope `ts: number`."

- file: src/filter.ts
  why: "The CALL SITE + the data source. readMarkers (line ~197-204) returns `recentMetrics: TurnMetric[]` sorted NEWEST-FIRST (`recentMetrics[0]` = latest = `metric`; `recentMetrics[1]` = previous). The call site is line 319: `!suppressCheck(markers.metric, markers)`. After S1 changes the signature to 3 args, THIS line has a tsc TS2554 error (expected, owned by S2). S2 will change it to `!suppressCheck(markers.metric, markers.recentMetrics, markers)`."
  pattern: "recentMetrics sort (line 197): `allMetrics.sort((a,b) => b.seq - a.seq)` → newest-first by seq. `metric = recentMetrics[0] ?? null` (line 202). So `markers.metric === markers.recentMetrics[0]` — the `metric` param is REDUNDANT with recentMetrics[0], but the signature keeps it (minimal disruption to the call site)."
  critical: "DO NOT edit filter.ts in S1 — it is S2 (P1.M1.T1.S2). The expected TS2554 + the runtime undefined-recentMetrics issue are S2's to fix. S1's gate is the UNIT level (drift_nudge.test.ts)."

- file: test/drift_nudge.test.ts
  why: "THE test file. Imports suppressCheck + NUDGE_TURN_WINDOW_MS (lines 5-6). Fixture builders: `metric(opts: Partial<TurnMetric>)` (defaults seq:1, ts:1_000_000, turnIndex:5); `rewind(seq, ts)`; `shrink(seq, ts)`. The suppressCheck tests are at lines 170-265: a 'mechanism' describe (170-220) + an 'acceptance a/b/c' describe (222-265)."
  pattern: "Existing calls are 2-arg: `suppressCheck(metric({ts:T}), {rewinds:[rewind(1,T)], shrinks:[]})`. After S1 these become 3-arg: `suppressCheck(metric({ts:T_LATEST}), [metric({ts:T_LATEST}), metric({ts:T_PREV})], {rewinds:[...], shrinks:[...]})`. Build recentMetrics as `[metric({ts:latestTs, seq:N}), metric({ts:prevTs, seq:N-1})]`."
  gotcha: "The 'mechanism' tests at lines 188/192/210 use NUDGE_TURN_WINDOW_MS to probe the 10-min boundary. That constant is GONE after S1, and the boundary concept no longer exists — those tests must be REWRITTEN to turn-boundary semantics (a marker from a PRIOR turn must NOT suppress even if < 10 min old). Add the BUG-001 regression test here."

- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: "§BUG-001 confirms the bug end-to-end: location (nudges.ts:270 + 397-411), the repro (suppressCheck({ts:T+2min}, {shrinks:[{ts:T}]}) === true under the old code), and the spec/07 §5.3 prescription ('collect the seqs of every marker created during the metric's turn (turn-boundary → turn_end)')."
  critical: "The recommendation (h2.5) offers two approaches: (1) lower bound = 2nd-newest metric's ts, or (2) stamp each marker with the turnIndex of its creating turn. This PRP uses approach (1) — it requires NO schema change to the markers (no new turnIndex stamping on RewindMarker/ShrinkMarker) and reuses the already-available recentMetrics. Approach (2) would touch markers.ts (schema + append wrappers) — out of scope."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  nudges.ts   # ← MODIFY: suppressCheck (397-411) + its JSDoc (378-396); REMOVE NUDGE_TURN_WINDOW_MS (266-271)
  filter.ts   # ← S2's scope (call site line 319); UNCHANGED in S1
  markers.ts  # ← READ-ONLY: TurnMetric shape; recentMetrics already produced by readMarkers (no change)
test/
  drift_nudge.test.ts   # ← MODIFY: drop NUDGE_TURN_WINDOW_MS import; 3-arg suppressCheck calls; rewrite mechanism tests; add BUG-001 regression
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S1 MODIFIES exactly two existing files:
src/nudges.ts            # suppressCheck signature+logic, NUDGE_TURN_WINDOW_MS removal, JSDoc rewrite
test/drift_nudge.test.ts # import fix, 3-arg call updates, mechanism-test rewrite, BUG-001 regression test
# src/filter.ts is S2 (P1.M1.T1.S2) — NOT touched here.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S1 is the SOURCE DOMINO — the filter.ts call site breaks, EXPECTED, owned by S2).
//   suppressCheck's signature gains a 2nd param (recentMetrics). The call site src/filter.ts:319
//   `!suppressCheck(markers.metric, markers)` now has a TS2554 error (3 args expected, 2 got) AND, at runtime,
//   passes `undefined` as recentMetrics (which would make `recentMetrics.length` throw). BOTH are owned by
//   S2 (P1.M1.T1.S2 — "Update filter.ts suppressCheck call site to pass recentMetrics"). S1's bar: the direct
//   unit tests (drift_nudge.test.ts) pass; suppressCheck itself is correct; no new error in nudges.ts. Do NOT
//   touch filter.ts (scope creep across a tracked task boundary). S2's exact fix: change line 319 to
//   `!suppressCheck(markers.metric, markers.recentMetrics, markers)`.

// CRITICAL GOTCHA #2 (NUDGE_TURN_WINDOW_MS is EXPORTED — removing it breaks the test import).
//   `export const NUDGE_TURN_WINDOW_MS = 10*60*1000;` (line 270) is imported by test/drift_nudge.test.ts:6.
//   Removing the export breaks that import. You MUST remove `NUDGE_TURN_WINDOW_MS` from the test's import
//   list (line 6) AND delete/rewrite the 3 mechanism tests that reference it (lines 188, 192, 210). Grep
//   `NUDGE_TURN_WINDOW_MS` repo-wide after the edit — it must appear NOWHERE.

// CRITICAL GOTCHA #3 (the `metric` param is REDUNDANT with recentMetrics[0] — keep it anyway).
//   readMarkers sets `metric = recentMetrics[0] ?? null`, so the caller's `metric` IS recentMetrics[0]. The
//   new signature keeps `metric` as the 1st param (the contract specifies it) for minimal call-site disruption
//   — S2 passes `markers.metric` (already in scope). The NEW lower bound comes from recentMetrics[1] (the
//   PREVIOUS metric), which `metric` alone cannot provide. Do NOT drop the `metric` param or try to derive it
//   from recentMetrics inside the function (the signature is fixed by the contract).

// CRITICAL GOTCHA #4 (defensive ts handling STAYS — never throws; fail to nudge on corrupt data).
//   The existing pattern: `typeof m.ts === 'number' && Number.isFinite(m.ts) ? m.ts : NaN`, then
//   `Number.isFinite(ts) && ts > lo && ts <= metricTs`. A non-finite marker.ts → NaN → not in window → no
//   suppress (fail to nudge — the safe direction for an advisory nudge). KEEP this for both marker loops.
//   For the NEW lower bound: read recentMetrics[1].ts the SAME defensive way; a non-finite previous-metric
//   ts → fall back to lo=0 (first-turn behavior — consistent with length < 2). Never throw.

// CRITICAL GOTCHA #5 (first-turn semantics: lo=0 means "any marker <= metric.ts suppresses").
//   On the first turn (recentMetrics.length < 2), there is no previous metric to bound the turn. The contract
//   says lo=0: any marker with ts <= metric.ts was created during this (first) turn → suppress. This is correct
//   (the only markers that can exist on turn 1 were created during turn 1). Date.now() ts is always > 0, so
//   `ts > 0 && ts <= metricTs` ≡ `ts <= metricTs` in practice.

// CRITICAL GOTCHA #6 (remove the stale 'WHY a window' GOTCHA #7 from the JSDoc).
//   The suppressCheck JSDoc (~line 384) has a paragraph: "WHY a window, not a pure upper bound (GOTCHA #7):
//   ... There is no per-turn lower bound without the PREVIOUS metric (readMarkers keeps only the latest), so a
//   wall-clock window is the best-effort resolution..." This justification is now FALSE (recentMetrics carries
//   the previous metric). DELETE this paragraph when rewriting the JSDoc. Replace it with the turn-based
//   rationale: the lower bound is the previous metric's ts, which bounds "this turn" exactly (spec/07 §5.3).
```

## Implementation Blueprint

### Data models and structure

**No data-model changes.** `TurnMetric`, `RewindMarker`, `ShrinkMarker` are all untouched (approach (1) from the arch recommendation — no new `turnIndex` stamping on markers). `NUDGE_TURN_WINDOW_MS` (a `const number`) is DELETED. The only structural change is `suppressCheck`'s parameter list (+1 param).

```typescript
// TARGET signature (the `metric` param stays; `recentMetrics` is new):
export function suppressCheck(
  metric: TurnMetric,
  recentMetrics: TurnMetric[],
  markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> },
): boolean
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REMOVE NUDGE_TURN_WINDOW_MS from src/nudges.ts (const + JSDoc, lines 266-271)
  - DELETE the JSDoc block (lines ~266-269) that introduces the constant, INCLUDING any "best-effort by design"
    / "NOT config in v1" / "suppressWindowMs" prose (it all justified the now-removed wall-clock window).
  - DELETE the line `export const NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes` (line 270).
  - VERIFY: `grep -n "NUDGE_TURN_WINDOW_MS" src/nudges.ts` → zero matches. (The test import + 3 test references
    are fixed in Task 4.)
  - DEPENDENCIES: none.

Task 2: REWRITE suppressCheck — new signature + turn-boundary lower bound (lines 397-411)
  - REPLACE the function. CURRENT (397-411):
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
    TARGET:
      export function suppressCheck(
        metric: TurnMetric,
        recentMetrics: TurnMetric[],
        markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> },
      ): boolean {
        const metricTs = typeof metric.ts === "number" && Number.isFinite(metric.ts) ? metric.ts : 0;
        // Turn-boundary lower bound (spec/07 §5.3): a marker suppresses iff created DURING this turn,
        // bounded below by the PREVIOUS metric's ts. recentMetrics is newest-first: [0]=latest(=metric),
        // [1]=previous. <2 entries (first turn) OR a non-finite previous ts → lo=0 (any marker with
        // ts <= metric.ts was created during this turn → suppress). Replaces the old 10-min wall-clock window.
        const prev = recentMetrics.length >= 2 ? recentMetrics[1] : undefined;
        const lo =
          prev && typeof prev.ts === "number" && Number.isFinite(prev.ts) ? prev.ts : 0;
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
  - PRESERVE: both marker loops' defensive ts reads (typeof + Number.isFinite → NaN on corrupt), the
    `ts > lo && ts <= metricTs` half-open-window test, the two-loop structure (rewinds then shrinks).
  - NAMING: `prev`, `lo` (local). Param order: metric, recentMetrics, markers (per the contract).
  - DEPENDENCIES: Task 1 (NUDGE_TURN_WINDOW_MS removed so the `lo = metricTs - NUDGE_TURN_WINDOW_MS` line is gone).

Task 3: REWRITE the suppressCheck JSDoc (lines ~378-396)
  - LOCATE the JSDoc block above suppressCheck. It currently:
      * opens with a summary of the wall-clock ts-window,
      * has a "WHY a window, not a pure upper bound (GOTCHA #7)" paragraph claiming "There is no per-turn
        lower bound without the PREVIOUS metric (readMarkers keeps only the latest)",
      * has a "WHY a structural markers param (GOTCHA #6)" paragraph (KEEP — still true),
      * @param metric / @param markers / @returns referencing NUDGE_TURN_WINDOW_MS.
  - REWRITE to document the turn-based mechanism:
      * Summary: suppress iff some rewind/shrink marker was created DURING the metric's turn (spec/07 §5.3),
        i.e. its ts ∈ (prevMetric.ts, metric.ts] where prevMetric = recentMetrics[1].
      * REMOVE the entire "WHY a window / GOTCHA #7" paragraph (GOTCHA #6 above) — its premise is now false.
      * Replace with a short rationale: the turn-boundary lower bound is the PREVIOUS metric's ts
        (recentMetrics[1], available via readMarkers); this replaced the old fixed 10-min wall-clock window,
        which over-suppressed for ~10 min after any single marker (BUG-001). First turn (no previous metric)
        → lo=0 (any marker <= metric.ts was created this turn).
      * KEEP the "WHY a structural markers param (GOTCHA #6)" paragraph (circular-dep avoidance — still true).
      * @param metric       the latest turn-metric (recentMetrics[0]; bounds the window's upper end).
      * @param recentMetrics ALL turn-metrics, newest-first ([0]=latest=metric, [1]=previous). The previous
                           metric's ts bounds the turn's lower end; <2 entries → first-turn (lo=0).
      * @param markers      { rewinds, shrinks } — persisted markers (MarkersBundle shape).
      * @returns true iff some marker.ts ∈ (lo, metric.ts] where lo = recentMetrics[1].ts (or 0 on first turn).
  - DEPENDENCIES: Task 2.

Task 4: UPDATE test/drift_nudge.test.ts — imports + 3-arg calls + rewritten mechanism tests + BUG-001 regression
  - (a) IMPORTS (line 6): remove `NUDGE_TURN_WINDOW_MS` from the `../src/nudges.js` import list (keep
        shouldNudge/injectNudge/suppressCheck/shouldHighWater/renderHighWaterNudge/injectHighWaterNudge).
  - (b) "mechanism" describe (lines 170-220): REWRITE to turn-boundary semantics. Build recentMetrics with the
        existing metric() builder. Replace the NUDGE_TURN_WINDOW_MS-based boundary tests (188/192/210) with:
          * "marker created DURING this turn (prevTs < markerTs <= metricTs) → suppress true":
              recentMetrics = [metric({ts:200, seq:3}), metric({ts:100, seq:2})]; shrink at ts=150 → true.
          * "marker from the PREVIOUS turn (markerTs <= prevTs) → suppress FALSE (BUG-001)":
              recentMetrics = [metric({ts:200, seq:3}), metric({ts:100, seq:2})]; shrink at ts=100 → false.
            (THE HEADLINE FIX — under the old wall-clock logic 100 was within 10 min of 200 → wrongly true.)
          * "marker from a much older turn → false": shrink at ts=50 → false.
          * "marker in the future (markerTs > metricTs) → false": shrink at ts=250 → false.
          * "no markers → false": {rewinds:[], shrinks:[]} → false.
          * "first turn (recentMetrics.length===1): marker <= metricTs → true": recentMetrics=[metric({ts:200})];
            shrink at ts=200 → true (lo=0).
          * "defensive: non-finite marker.ts → no suppress": rewind with ts=NaN → false.
          * "defensive: non-finite recentMetrics[1].ts → lo=0 (first-turn fallback)":
              recentMetrics=[metric({ts:200}), metric({ts:NaN})]; shrink at ts=200 → true.
        All calls are 3-arg: `suppressCheck(latestMetric, recentMetrics, {rewinds:[...], shrinks:[...]})`.
        The `latestMetric` you pass as arg 1 should === recentMetrics[0] (mirror the real call site).
  - (c) "acceptance a/b/c" describe (lines 222-265): these compose `shouldNudge(...) && !suppressCheck(...)`.
        Update each `suppressCheck(latest(), {rewinds, shrinks})` → `suppressCheck(latest(), RECENT, {rewinds, shrinks})`
        where RECENT is a recentMetrics array appropriate to the scenario (typically `[latest(), prevMetric()]`).
        The "sameTurnShrink/sameTurnRewind" cases (marker ts == latest.ts) → still suppress true; the empty
        case → still false. Keep the composed-expression assertions.
  - (d) ADD a dedicated BUG-001 regression test (top-level or in the mechanism describe):
          it("BUG-001: a marker from a PRIOR turn does NOT suppress a later turn (no 10-min blackout)", () => {
            // Two turns: latest at T+120s (seq 3), previous at T (seq 2). A shrink was created during the
            // PREVIOUS turn (ts=T). Under the old wall-clock logic this wrongly suppressed for ~10 min.
            const T = 1_000_000;
            const latest = metric({ ts: T + 120_000, seq: 3 });
            const prev = metric({ ts: T, seq: 2 });
            const recentMetrics = [latest, prev];
            const priorTurnShrink = { ...shrink(1, T) }; // created during the PREVIOUS turn
            expect(suppressCheck(latest, recentMetrics, { rewinds: [], shrinks: [priorTurnShrink] })).toBe(false);
            // And a marker created DURING this turn still suppresses:
            const thisTurnShrink = { ...shrink(2, T + 60_000) }; // between prev.ts and latest.ts
            expect(suppressCheck(latest, recentMetrics, { rewinds: [], shrinks: [thisTurnShrink] })).toBe(true);
          });
  - NAMING: test titles name the turn-boundary rule + BUG-001. Use the existing metric()/rewind()/shrink() builders.
  - DEPENDENCIES: Tasks 1-3 (the new suppressCheck must be in place).

Task 5: VALIDATE (no new code)
  - GREP: `grep -rn "NUDGE_TURN_WINDOW_MS" src/ test/` → zero matches (constant gone everywhere).
  - RUN `npx vitest run test/drift_nudge.test.ts` → all pass (3-arg calls, turn-boundary semantics, BUG-001
    regression green). If a test fails, re-check the `lo` computation (prev.ts fallback) and the half-open
    window `ts > lo && ts <= metricTs`.
  - RUN `npx tsc --noEmit` → EXPECTED: `src/filter.ts:319` TS2554 (expected 3 args, got 2). That is S2's.
    Confirm NO error cites `src/nudges.ts` or `test/drift_nudge.test.ts`.
  - DO NOT run the FULL `npx vitest run` expecting green until S2 lands: filter.ts:319 passes `undefined` as
    recentMetrics at runtime → `recentMetrics.length` throws inside suppressCheck → contextHandler's drift
    block degrades (nudge silently no-ops). Any integration test asserting a drift nudge FIRES may fail until
    S2 fixes the call site. Those failures are EXPECTED — owned by S2.
  - DEPENDENCIES: Tasks 1-4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): the turn-boundary lower bound — one line replaces the wall-clock window.
//   OLD:  const lo = metricTs - NUDGE_TURN_WINDOW_MS;            // 10-min wall-clock
//   NEW:  const prev = recentMetrics.length >= 2 ? recentMetrics[1] : undefined;
//         const lo = prev && typeof prev.ts === "number" && Number.isFinite(prev.ts) ? prev.ts : 0;
//   The two marker loops are UNCHANGED — they already test `ts > lo && ts <= metricTs`. Only `lo` changed.

// PATTERN (Task 4): build recentMetrics newest-first with the existing metric() builder.
//   const latest = metric({ ts: 200, seq: 3 });
//   const prev   = metric({ ts: 100, seq: 2 });
//   const recentMetrics = [latest, prev];   // [0]=latest, [1]=previous (matches readMarkers' sort)
//   suppressCheck(latest, recentMetrics, { rewinds: [], shrinks: [...] });
//   NOTE: pass `latest` as arg 1 (=== recentMetrics[0]) to mirror the real filter.ts call site.

// CRITICAL walk-through (the headline fix):
//   latest.ts=200, prev.ts=100 → lo=100. A shrink at ts=100 (created during the PREVIOUS turn):
//     100 > 100 → FALSE → not in window → suppress=false. ✓ (old wall-clock: 200-600000 < 100 <= 200 → TRUE, BUG)
//   A shrink at ts=150 (created DURING this turn): 150 > 100 && 150 <= 200 → TRUE → suppress. ✓

// CRITICAL: never throw on corrupt data. recentMetrics could be undefined (if S2 hasn't landed — but that's a
//   tsc error S2 fixes, not a runtime path in production) or short. The `recentMetrics.length >= 2` guard +
//   the `prev && typeof prev.ts ...` guard make lo=0 the universal fallback. marker.ts NaN → not finite → no
//   suppress. suppressCheck stays a pure, total boolean.
```

### Integration Points

```yaml
CODE:
  - modify: src/nudges.ts — suppressCheck (signature+logic), NUDGE_TURN_WINDOW_MS removal, JSDoc rewrite
  - modify: test/drift_nudge.test.ts — imports, 3-arg calls, rewritten mechanism tests, BUG-001 regression
  - untouched: src/markers.ts (TurnMetric already has ts; recentMetrics already produced by readMarkers)
DOWNSTREAM (S2 — NOT this subtask):
  - src/filter.ts:319 — change `!suppressCheck(markers.metric, markers)` → `!suppressCheck(markers.metric, markers.recentMetrics, markers)`
    (markers.recentMetrics is already on the MarkersBundle — readMarkers returns it at line 204). S2 also
    resolves the expected TS2554 + the runtime undefined-recentMetrics issue.
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config knob (NUDGE_TURN_WINDOW_MS was a const, not config); no persistence change; no registration.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Cheapest gate — the constant is fully gone:
grep -rn "NUDGE_TURN_WINDOW_MS" src/ test/   # EXPECTED: zero matches (constant + all references removed)

# Typecheck — EXPECTED downstream error, NOT a clean run:
npx tsc --noEmit
# EXPECTED: `src/filter.ts:319` — TS2554 (Expected 3 arguments, but got 2). That is S2's (P1.M1.T1.S2).
# YOUR bar: NO error cites `src/nudges.ts` or `test/drift_nudge.test.ts`. If nudges.ts appears in an error,
#   you left a dangling NUDGE_TURN_WINDOW_MS reference or a signature/internal mismatch — fix YOUR file.
# Do NOT "fix" the filter.ts:319 error here (it's S2).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The direct unit tests — this is S1's PRIMARY gate.
npx vitest run test/drift_nudge.test.ts
# EXPECTED: all pass. The 3-arg calls typecheck (vitest transpiles); the turn-boundary mechanism tests pass;
#   the BUG-001 regression (prior-turn marker → false) is green. If a mechanism test fails, re-check the `lo`
#   computation (recentMetrics[1].ts fallback to 0) and the half-open `ts > lo && ts <= metricTs` test.

# DO NOT expect the FULL suite green until S2:
npx vitest run   # ← will likely FAIL: filter.ts:319 passes undefined as recentMetrics at runtime →
                #   suppressCheck throws on recentMetrics.length → contextHandler's drift block degrades →
#   any integration test asserting a drift nudge FIRES may fail. Those failures are EXPECTED, owned by S2.
# (You MAY run it to CONFIRM the only failures are drift-nudge-firing integration tests — a useful sanity
#  check that nothing ELSE broke. But it is NOT an S1 gate.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1: the end-to-end "drift nudge fires on the turn after a shrink" path goes through filter.ts:319,
# which S2 hasn't updated yet. That validation belongs to S2 (after the call site passes recentMetrics).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green (optional): BEFORE applying Task 2, add the BUG-001 regression test (Task 4d) and run it
# against the OLD suppressCheck (temporarily keep the 2-arg call). It FAILS (old wall-clock suppresses the
# prior-turn marker). Then apply Tasks 1-2 → it PASSES. The red→green transition proves the test locks in
# the fix. (Skip if the 2-arg/3-arg signature churn makes this awkward — the post-fix green run suffices.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -rn "NUDGE_TURN_WINDOW_MS" src/ test/` → zero matches.
- [ ] `npx vitest run test/drift_nudge.test.ts` → all pass (incl. the BUG-001 regression).
- [ ] `npx tsc --noEmit` → the ONLY new error is `src/filter.ts:319` (TS2554, owned by S2); no error in `src/nudges.ts` or `test/drift_nudge.test.ts`.

### Feature Validation

- [ ] `suppressCheck` signature is `(metric, recentMetrics, markers)`.
- [ ] `lo = recentMetrics[1].ts` when length >= 2 (finite-guarded); else `lo = 0`.
- [ ] A prior-turn marker (ts <= prevMetric.ts) → suppress **false** (BUG-001 fix); a this-turn marker (prevMetric.ts < ts <= metric.ts) → suppress **true**.
- [ ] First-turn (length < 2): marker <= metric.ts → suppress true (lo=0).
- [ ] Defensive ts reads preserved (non-finite marker.ts → no suppress; non-finite prev.ts → lo=0).
- [ ] `NUDGE_TURN_WINDOW_MS` constant + JSDoc removed; the stale "WHY a window / GOTCHA #7" JSDoc paragraph removed.

### Code Quality Validation

- [ ] The two marker loops' bodies are UNCHANGED (only `lo` changed).
- [ ] Only `src/nudges.ts` + `test/drift_nudge.test.ts` modified — NO edit to `src/filter.ts` (S2), `src/markers.ts`, or any other file.
- [ ] Approach (1) used (recentMetrics[1].ts lower bound) — NO schema change to RewindMarker/ShrinkMarker (approach (2), turnIndex-stamping, is out of scope).

### Documentation & Deployment

- [ ] `suppressCheck` JSDoc documents the turn-based lower bound, the `recentMetrics` param, and why the wall-clock window was replaced (Mode A — rides with the code).
- [ ] No README/spec change in S1 (changeset doc sync is P1.M3.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/filter.ts:319` — that's S2 (P1.M1.T1.S2). The expected TS2554 + runtime undefined-recentMetrics are S2's to fix. Touching it here crosses a tracked task boundary (GOTCHA #1). S2's exact fix is documented in Integration Points.
- ❌ Don't keep `NUDGE_TURN_WINDOW_MS` "just in case" — it's dead after the refactor, and leaving an exported-but-unused constant plus its now-false JSDoc justification is worse than removing it. Delete the const + JSDoc + all references (GOTCHA #2).
- ❌ Don't take approach (2) (stamping a `turnIndex` onto RewindMarker/ShrinkMarker) — that requires a markers.ts schema change + append-wrapper edits, far beyond S1's scope. Approach (1) (recentMetrics[1].ts lower bound) needs NO marker schema change and reuses already-available data (GOTCHA in arch doc).
- ❌ Don't drop the `metric` param or derive it from `recentMetrics[0]` inside the function — the contract fixes the signature as `(metric, recentMetrics, markers)`, and keeping `metric` as arg 1 minimizes S2's call-site churn (it already passes `markers.metric`). The param IS redundant with recentMetrics[0] by design (GOTCHA #3).
- ❌ Don't weaken the defensive ts reads — keep `typeof === 'number' && Number.isFinite ? ts : NaN` for both marker loops AND the new prev.ts read. suppressCheck must stay a pure, total boolean (never throws); corrupt data → fail to nudge (GOTCHA #4).
- ❌ Don't leave the stale "WHY a window / no per-turn lower bound" GOTCHA #7 paragraph in the JSDoc — its premise ("readMarkers keeps only the latest") is now false. Removing the constant without removing its justification leaves a doc that lies about the implementation (GOTCHA #6).
- ❌ Don't expect a green full `npx vitest run` — filter.ts:319's runtime undefined-recentMetrics will break drift-nudge-firing integration tests until S2. S1's gate is `test/drift_nudge.test.ts` (the direct unit tests), not the full suite (GOTCHA #1).
- ❌ Don't write the BUG-001 regression test against the wall-clock semantics — it must assert the TURN-BOUNDARY behavior (prior-turn marker → false), which is the actual fix. A test that just re-asserts "marker <= 10 min → true" would lock in the bug.