# PRP — P3.M3.T4.S1: Change `shouldNudge` signature + compute smoothed windowed delta (spec/07 §5.1)

## Goal

**Feature Goal**: Replace the single-turn `shouldNudge` gate with a **windowed moving-average drift gate**
(spec/07 §5.1, REQUIRED). The new `shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig)` slices the
last `config.nudges.driftWindowTurns` turn-metrics, averages the finite `deltaTokens` values over that window, and
fires when the average **strictly exceeds** `config.nudges.driftThresholdTokens` — OR when **any** window metric has
`bloatHit === true` (bloat signaling is independent of the windowed delta). Single heavy turns are suppressed (a
spike averaged with small turns stays below threshold); sustained growth whose windowed average clears the
threshold fires. The function stays **PURE** (no Pi calls, no tokenization).

**Deliverable**:
- `src/nudges.ts` — modified: rewrite `shouldNudge` (new signature `recentMetrics: TurnMetric[]` + body that slices
  + averages + OR's bloat + full JSDoc documenting the spec-ambiguity resolution). **No new imports**
  (`TurnMetric` + `MulliganConfig` are already imported). `injectNudge`, `suppressCheck`, and the Nudge A /
  turn_end handlers are **UNCHANGED**.
- `src/filter.ts` — modified: the ONE call site in `contextHandler` changes its argument from `markers.metric` to
  `markers.recentMetrics` (shouldNudge slices the window itself); the `markers.metric &&` guard and the
  `suppressCheck(markers.metric, …)` / `injectNudge(messages, markers.metric)` calls stay (they still take the
  single LATEST metric). Comment updated. **P3.M3.T6.S1 completes the broader contextHandler wiring** (high-water
  signal) — this task makes only the minimal, type-safe, behavior-coherent change.
- `test/drift_nudge.test.ts` — modified: the `shouldNudge` `describe` block is REWRITTEN for the windowed signature
  + semantics (single-spike suppression, sustained-growth fire, bloat-only fire, empty-window false, window
  slicing, malformed-delta defensive). `injectNudge` / `suppressCheck` / `NUDGE_TURN_WINDOW_MS` tests UNCHANGED.
- `test/filter.test.ts` — modified: ONE number bumped in the shared `metricData` helper (`grew ? 5000 : 100` →
  `grew ? 7000 : 100`) so the existing `contextHandler` drift-nudge tests stay green under the new moving-average
  logic. No other change.
- `test/nudges.test.ts` — **NO change** (grep-verified: `shouldNudge` is not referenced there; it only tests Nudge A).

**Success Definition**:
- `shouldNudge([m(8000), m(500), m(500)], cfg{window:3,threshold:6000})` → **false** (single 8k spike suppressed;
  MA = 3000 < 6000).
- `shouldNudge([m(7000), m(7000), m(7000)], cfg{window:3,threshold:6000})` → **true** (sustained growth; MA = 7000 > 6000).
- `shouldNudge([m(null, bloatHit:true)], cfg{…})` → **true** (bloat-only path: all deltas null, one bloatHit).
- `shouldNudge([], cfg{…})` → **false** (empty window).
- `shouldNudge([m(500, bloatHit:true)], cfg{…})` → **true** (bloat fires even when MA < threshold).
- `shouldNudge([m(null, bloatHit:false)], cfg{…})` → **false** (no usable delta, no bloat).
- `npx tsc --noEmit` clean; `npm test` green (including the `contextHandler` drift-nudge tests after the metricData bump).

## Why

- **spec/07 §5.1 (Windowed drift signaling, REQUIRED) mandates it.** §5.1: "`shouldNudge` MUST smooth the per-turn
  delta over a rolling window of the last `config.nudges.driftWindowTurns` turns (default 3) before comparing to
  `driftThresholdTokens` — fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold, NOT on
  a single turn's raw delta." Rationale: a single heavy turn is routinely legitimate (reading several files; pasting
  reference docs); *sustained* growth over a window is the actionable signal. The current `shouldNudge` fires on any
  single turn's `grewOverThreshold` — exactly the false-positive the refinement removes.
- **This is the ALGORITHM change at the center of milestone P3.M3 (G1).** P3.M3.T1.S1 (config knobs: `driftWindowTurns`,
  raised threshold 6000) — COMPLETE. P3.M3.T3.S1 (parallel predecessor: `MarkersBundle.recentMetrics` — the full
  newest-first array) — implementing/complete. P3.M3.T4.S1 (this task) — the windowed gate that consumes that array.
  P3.M3.T5.S1 (high-water helpers) + P3.M3.T6.S1 (contextHandler wiring) — later, build on top of this gate.
- **Small, surgical, pure-function change.** One function body + JSDoc, one call-site argument, one test-block rewrite,
  one fixture bump. No new files, no new imports, no config change, no Pi-surface change. The function remains a pure
  boolean (spec/07 §3: deterministic & testable — Tier 1 unit tests, no Pi).

## What

**User-visible behavior**: Indirect, via Nudge B (the one-line drift annotation injected into the in-flight message
copy at `context`). After this change the nudge fires on *sustained* per-turn growth (windowed moving average over
threshold) rather than on a single turn's spike. A single 8k-token turn amid small turns no longer nags; steady
accumulation that clears the threshold on average does. Bloat-result hits still nudge independently (a bloated result
is always actionable). Zero extra requests (rides the existing `context` inference — D4).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. **Signature**: `(metric: TurnMetric, _config: MulliganConfig) → (recentMetrics: TurnMetric[], config: MulliganConfig)`,
   return `: boolean`. The second arg is now **USED** (rename `_config` → `config`).
2. **Slice the window**: `const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);` — `recentMetrics` is
   newest-first (P3.M3.T3.S1), so the first `driftWindowTurns` entries are the most recent turns.
3. **Collect usable deltas**: `const deltas = window.map(m => m.deltaTokens).filter((d): d is number => typeof d ===
   "number" && Number.isFinite(d));` — drop `null` (first turn / post-reload), non-numbers, `NaN`, `±Infinity`
   (defensive: `readMarkers` casts raw session data, so a field can be malformed — never trust a cast field).
4. **Delta path vs bloat path**:
   - If `deltas.length === 0` → `return window.some(m => m.bloatHit === true);` (no usable delta → bloat-only fallback).
   - Else `const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;` → `return avg >
     config.nudges.driftThresholdTokens || window.some(m => m.bloatHit === true);`.
5. **`bloatHit === true`** (strict) — defensive; a malformed `bloatHit` fails safe to "no bloat".
6. **Call site** (`src/filter.ts` contextHandler): change the single argument `markers.metric` → `markers.recentMetrics`
   on the `shouldNudge(…)` line. Keep the `markers.metric &&` guard and the `suppressCheck(markers.metric, …)` /
   `injectNudge(messages, markers.metric)` calls UNCHANGED (still take the latest metric).
7. **Tests**: rewrite the `shouldNudge` `describe` in `test/drift_nudge.test.ts`; bump `metricData` in
   `test/filter.test.ts`. `test/nudges.test.ts` needs NO change.

### Success Criteria
- [ ] `shouldNudge` signature is `(recentMetrics: TurnMetric[], config: MulliganConfig): boolean` and is PURE.
- [ ] Moving average over the window's finite `deltaTokens` is compared (strict `>`) to `driftThresholdTokens`.
- [ ] Single 8k spike `[8000,500,500]` (threshold 6000, window 3) → `false`.
- [ ] Sustained growth `[7000,7000,7000]` → `true`.
- [ ] bloatHit-only (all deltas null, one bloatHit) → `true`; bloat fires even when MA < threshold.
- [ ] Empty window → `false`; all-null deltas + no bloat → `false`.
- [ ] `contextHandler` call site passes `markers.recentMetrics`; `suppressCheck`/`injectNudge` still take latest metric.
- [ ] `test/filter.test.ts` `metricData` bumped so contextHandler drift-nudge tests stay green.
- [ ] `npx tsc --noEmit` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the EXACT current `shouldNudge` (signature + body + full JSDoc), the EXACT current
`contextHandler` call-site block (the `if` with its guard + the `suppressCheck`/`injectNudge` calls that must stay),
the EXACT `metricData` helper line to bump, and the EXACT shape of the `shouldNudge` `describe` block to rewrite. It
names the dependencies that already exist (`TurnMetric`, `MulliganConfig` imports; `config.nudges.driftWindowTurns` +
`driftThresholdTokens` knobs from COMPLETE P3.M3.T1.S1; `MarkersBundle.recentMetrics` from parallel P3.M3.T3.S1 —
assumed to land exactly as specified). It walks the spec-ambiguity resolution in full so the implementer can defend
the algorithm choice. An implementer who has never seen this repo can do it from this document + `src/nudges.ts` +
`src/filter.ts` + `test/drift_nudge.test.ts` + `test/filter.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file being edited (shouldNudge lives here)
- file: src/nudges.ts
  why: |
    Contains shouldNudge (the function to rewrite) + injectNudge + suppressCheck (UNCHANGED — still take the single
    latest TurnMetric) + the Nudge A handlers + turnEndMetricHandler. TurnMetric + MulliganConfig are ALREADY
    imported (`import type { … TurnMetric … } from "./markers.js";` and `import type { MulliganConfig } from
    "./config.js";`) — NO new import. The shouldNudge JSDoc is extensive; rewrite it to document the windowed
    algorithm + the spec-ambiguity resolution.
  section: shouldNudge (~lines 270–289, JSDoc starts ~L270)
  pattern: |
    # CURRENT (verbatim) — replace signature + body + JSDoc:
    export function shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean {
      return metric.grewOverThreshold === true || metric.bloatHit === true;
    }
    #   ── becomes (moving average; see "Implementation Patterns" for the full body + JSDoc) ──
    export function shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean {
      const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);
      const deltas = window.map(m => m.deltaTokens)
        .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
      if (deltas.length === 0) return window.some(m => m.bloatHit === true);
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      return avg > config.nudges.driftThresholdTokens || window.some(m => m.bloatHit === true);
    }
  gotcha: |
    The OLD body read metric.grewOverThreshold; the NEW body ignores it entirely (the windowed average replaces the
    single-turn comparison). grewOverThreshold is still computed/persisted by turnEndMetricHandler (for audit) but is
    DELIBERATELY unused by this gate — do not re-introduce a grewOverThreshold check.

# MUST READ — the call site (the only production caller of shouldNudge)
- file: src/filter.ts
  why: |
    contextHandler calls shouldNudge inside the per-turn drift-nudge `if`. shouldNudge is imported
    (`import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`). After the signature change, the
    argument MUST change from markers.metric (TurnMetric|null) to markers.recentMetrics (TurnMetric[]) or tsc errors.
    The markers.metric && guard stays (it guarantees markers.metric is non-null for the downstream
    suppressCheck(markers.metric, …) + injectNudge(messages, markers.metric), which still take the single LATEST
    metric). markers.recentMetrics comes from P3.M3.T3.S1 (parallel predecessor — assumed to land exactly as
    specified).
  section: contextHandler per-turn drift-nudge block (~lines 257–266)
  pattern: |
    # CURRENT (verbatim) — change ONLY the shouldNudge argument + the comment:
        // Per-turn drift nudge (spec/07 §2). shouldNudge/injectNudge/suppressCheck are imported from nudges.ts
        // (P1.M6.T2.S2). Suppress avoids nagging when the agent already acted that turn (…).
        if (
          config.nudges.perTurnDrift &&
          markers.metric &&
          shouldNudge(markers.metric, config) &&
          !suppressCheck(markers.metric, markers)
        ) {
          messages = injectNudge(messages, markers.metric);
        }
    #   ── becomes (ONE functional line changes; guard + suppressCheck + injectNudge UNCHANGED) ──
        // Per-turn drift nudge (spec/07 §2; §5.1 windowed drift signaling, REQUIRED). shouldNudge now takes the
        // FULL recentMetrics window (P3.M3.T3.S1 — sorted newest-first) and slices driftWindowTurns internally,
        // firing on sustained growth (moving average > threshold) or any window bloatHit. injectNudge/suppressCheck
        // still take the single LATEST metric (markers.metric). P3.M3.T6.S1 completes the broader contextHandler
        // integration (high-water signal).
        if (
          config.nudges.perTurnDrift &&
          markers.metric &&
          shouldNudge(markers.recentMetrics, config) &&
          !suppressCheck(markers.metric, markers)
        ) {
          messages = injectNudge(messages, markers.metric);
        }

# MUST READ — the test file whose shouldNudge describe block is REWRITTEN
- file: test/drift_nudge.test.ts
  why: |
    The ONLY direct unit tests of shouldNudge live here (4 its in the "shouldNudge — pure gate (spec/07 §2)"
    describe, ~lines 58–77). They call shouldNudge(metric(...), {} as never) with OLD single-metric semantics.
    Rewrite the describe for the windowed signature. KEEP the file's metric()/rewind()/shrink() helpers + the
    injectNudge / suppressCheck / NUDGE_TURN_WINDOW_MS describes UNCHANGED (they don't call shouldNudge). Add a
    lean local helper inside the new describe for building windowed metrics (deltaTokens + bloatHit + seq).
  section: "shouldNudge — pure gate (spec/07 §2)" describe block (~lines 58–77)
  pattern: |
    # The OLD 4 tests (each passes {} as never as config — config was unused). Replace the WHOLE describe with the
    # windowed describe in "Implementation Tasks Task 4". Example old test to remove:
      it("returns true when grewOverThreshold is true", () => {
        expect(shouldNudge(metric({ grewOverThreshold: true, bloatHit: false }), {} as never)).toBe(true);
      });

# MUST READ — the test file whose metricData helper must be bumped (keeps contextHandler tests green)
- file: test/filter.test.ts
  why: |
    metricData(seq, grew, bloat) is the shared turn-metric fixture builder. The contextHandler drift-nudge tests
    (~L445 "injects the drift nudge when shouldNudge is true", L459 "suppressed", L474 "no nudge when shouldNudge
    false") use metricData(1, true) → deltaTokens 5000. Under the NEW moving-average logic avg([5000]) = 5000 <
    threshold 6000 → shouldNudge FALSE → test L445 breaks (expects a nudge, gets none). BUMP the grew deltaTokens
    5000 → 7000 (7000 > 6000 so a single grew metric still fires; grew=false stays 100 < 6000 → no fire). The
    readMarkers tests that also use metricData only assert seq sorting, not deltaTokens, so the bump is invisible
    to them.
  section: metricData helper (~line 82)
  pattern: |
    # CURRENT (verbatim) — change ONE number (5000 → 7000):
    function metricData(seq: number, grew = false, bloat = false): Record<string, unknown> {
      return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 5000 : 100,
        bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
    }
    #   ── becomes ──
      return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 7000 : 100,
        bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
  gotcha: |
    Do NOT "fix" the contextHandler drift-nudge tests by making them pass multi-metric arrays — that is
    P3.M3.T6.S1's job (contextHandler integration). The minimal, correct fix here is the single-number metricData
    bump, which keeps the EXISTING single-metric fixtures firing under the new logic. (grewOverThreshold in the
    fixture is now cosmetic — left in place, harmlessly unused by shouldNudge.)

# Architecture reference (read-only — the spec-ambiguity analysis + the algorithm decision)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  section: "Pattern 8: Windowed drift (nudges.ts shouldNudge)" (~lines 122–178)
  why: |
    Walks the spec ambiguity (MA vs sum vs M-of-N) against BOTH acceptance criteria with threshold 6000 / window 3,
    and reaches the FINAL ANSWER (L178): "use moving average and compare to the threshold. Document the acceptance
    criteria and choose accordingly." This PRP's algorithm choice + JSDoc mirror Pattern 8's recommendation exactly.
    Read it to defend the choice if challenged. NOTE: Pattern 8's sketch uses `(d): d is number => d != null` for the
    delta filter; this PRP strengthens it to `typeof d === "number" && Number.isFinite(d)` (also drops non-numbers,
    NaN, ±Infinity) to match the codebase's defensive discipline (readMarkers casts raw data — see suppressCheck's
    Number.isFinite guards + shouldNudge's old `=== true`).

# Spec sources (read-only — the authoritative meaning)
- docfile: spec/07-preventive-and-nudges.md
  section: "§5.1 Windowed drift signaling (REQUIRED)"
  why: |
    The source requirement: "shouldNudge MUST smooth the per-turn delta over a rolling window of the last
    driftWindowTurns turns … fire when the windowed (moving-average, or M-of-N) delta crosses the threshold, NOT on
    a single turn's raw delta." Acceptance: single 8k turn does NOT fire; sustained growth does. §2 "Edge cases":
    first turn / post-reload → deltaTokens null → bloat-only fallback (the deltas.length===0 branch).

# Config source (read-only — the knobs already exist; this task adds NONE)
- docfile: src/config.ts
  section: MulliganConfig.nudges (driftThresholdTokens, driftWindowTurns)
  why: |
    Confirms the knobs shouldNudge reads already exist from COMPLETE P3.M3.T1.S1: driftThresholdTokens (default 6000,
    "raised from 3000; the §5.1 windowing makes 6000 a quiet, accurate trip point") and driftWindowTurns (default 3,
    positive integer, floor'd in validateConfig). No config change in this task — shouldNudge only READS them.

# The parallel predecessor (currently being implemented — assume it lands exactly as specified)
- docfile: plan/003_2c3b19ff6a7b/P3M3T3S1/PRP.md
  why: |
    Produces MarkersBundle.recentMetrics: TurnMetric[] — FULL array, sorted NEWEST-FIRST (highest seq at index 0),
    NOT sliced. markers.metric (latest = recentMetrics[0] ?? null) KEPT for backward compat. shouldNudge slices the
    window itself (recentMetrics.slice(0, driftWindowTurns)); the call site passes the FULL markers.recentMetrics.
    If T3.S1 has NOT landed, `markers.recentMetrics` does not exist and this task's call-site edit fails tsc —
    coordinate / ensure T3.S1 lands first (the parallel context says to assume it does).
```

### Current Codebase tree (relevant slice)

```bash
src/
  nudges.ts          # <-- MODIFY: rewrite shouldNudge (signature + body + JSDoc). injectNudge/suppressCheck/Nudge A/turn_end UNCHANGED.
  filter.ts          # <-- MODIFY: contextHandler call site — shouldNudge(markers.metric) → shouldNudge(markers.recentMetrics) + comment.
  markers.ts         # read-only (TurnMetric interface: deltaTokens:number|null, bloatHit:boolean; ALREADY imported into nudges.ts)
  config.ts          # read-only (driftThresholdTokens=6000, driftWindowTurns=3 ALREADY exist from P3.M3.T1.S1)
  transforms.ts      # read-only (MessageLike — used by injectNudge, UNCHANGED)
test/
  drift_nudge.test.ts # <-- MODIFY: rewrite the shouldNudge describe block (windowed). injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS UNCHANGED.
  filter.test.ts      # <-- MODIFY: bump metricData deltaTokens 5000→7000 (keeps contextHandler drift-nudge tests green).
  nudges.test.ts      # read-only (NO shouldNudge reference — only tests Nudge A)
spec/
  07-preventive-and-nudges.md  # read-only (§5.1 — the requirement; §2 edge cases — bloat-only fallback)
plan/003_2c3b19ff6a7b/architecture/
  implementation_patterns.md   # read-only (Pattern 8 — spec-ambiguity analysis + MA recommendation)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/nudges.ts        # EDITED in place. shouldNudge is now the windowed moving-average gate (recentMetrics, config).
src/filter.ts        # EDITED in place. One call-site argument changed; guard + suppressCheck + injectNudge unchanged.
test/drift_nudge.test.ts # EDITED in place. shouldNudge describe rewritten for windowed semantics.
test/filter.test.ts  # EDITED in place. metricData deltaTokens 5000→7000 (one number).
# No new files. All changes are edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — the spec is AMBIGUOUS; the contract + Pattern 8 RESOLVE it to MOVING AVERAGE. spec/07 §5.1 offers
//   "moving-average, or M-of-N" with threshold 6000, window 3, and TWO acceptance criteria. Neither pure algorithm
//   satisfies both literally at 6000: MA suppresses the 8k spike (criterion 1 ✓) but [4k,4k,4k] avg 4k < 6k → no
//   fire (criterion 2 ✗); SUM fires [4k,4k,4k] (criterion 2 ✓) but also fires the 8k spike (criterion 1 ✗). The
//   PRIMARY intent of §5.1 is to SUPPRESS SINGLE SPIKES — MA satisfies that. Criterion 2 ("three ~4k turns fire")
//   is ILLUSTRATIVE of "sustained growth fires"; the raised threshold 6000 deliberately keeps the nudge quiet.
//   CHOOSE MOVING AVERAGE. Sustained growth averaging > 6000 (e.g. three ~7k turns) fires. DOCUMENT this in the
//   JSDoc (the contract demands it: "DOCUMENT the chosen algorithm and verify against both criteria").

// CRITICAL — filter.test.ts metricData MUST be bumped or contextHandler drift-nudge tests break. metricData(seq,
//   grew, bloat) sets deltaTokens: grew ? 5000 : 100. Under the new MA logic avg([5000]) = 5000 < 6000 → shouldNudge
//   FALSE → test L445 ("injects the drift nudge when shouldNudge is true") expects a nudge and gets none → FAILS.
//   Fix: grew ? 7000 : 100 (7000 > 6000 so a single grew metric still fires). Do NOT instead rewrite the
//   contextHandler tests to pass arrays — that's P3.M3.T6.S1's scope; this task keeps the fixtures firing via the
//   one-number bump. (The readMarkers tests that also use metricData only assert seq sorting — invisible to them.)

// CRITICAL — test/nudges.test.ts needs NO change. The contract names it, but grep confirms 0 shouldNudge
//   references there (it only tests Nudge A: bloatReminderHandler, registerBloatReminder, bloatThresholdFor).
//   Do NOT hunt for a shouldNudge call that isn't there.

// GOTCHA — the filter.ts call-site change is ONE line. shouldNudge(markers.metric, config) →
//   shouldNudge(markers.recentMetrics, config). KEEP the `markers.metric &&` guard (it guarantees markers.metric is
//   non-null for the downstream suppressCheck(markers.metric, …) + injectNudge(messages, markers.metric), which
//   STILL take the single LATEST metric — they are UNCHANGED). Removing the guard would make suppressCheck(null,…)
//   throw. shouldNudge handles an empty recentMetrics itself (returns false), but the guard is still required for
//   the other two calls.

// GOTCHA — grewOverThreshold is now UNUSED by shouldNudge. The new body reads deltaTokens (windowed), NOT
//   grewOverThreshold. Do NOT re-introduce a grewOverThreshold check (it was a single-turn precomputation; the
//   windowed average replaces it). grewOverThreshold stays in the TurnMetric type + is still computed/persisted by
//   turnEndMetricHandler (audit/back-compat) — out of scope to remove.

// GOTCHA — filter deltas to FINITE NUMBERS, not just non-null. readMarkers casts raw session data, so deltaTokens
//   could be a string / NaN / Infinity. Use (d): d is number => typeof d === "number" && Number.isFinite(d). A bare
//   `d != null` (Pattern 8's sketch) would let a string through → reduce produces NaN → NaN > threshold is false
//   (fails safe but is sloppy + untestable). Negative deltas are LEGITIMATE (a rewind/shrink shrank context) — keep
//   them (they're finite). This mirrors the codebase's defensive discipline (suppressCheck's Number.isFinite guards,
//   shouldNudge's old `=== true`).

// GOTCHA — bloatHit === true (strict), not truthy. readMarkers casts raw data; a malformed bloatHit (undefined /
//   "true" / 1) fails safe to "no bloat". This is the SAME defensive pattern the old body used.

// GOTCHA — empty window → false, naturally. recentMetrics.slice(0, driftWindowTurns) on [] or a short array yields
//   []/short; deltas over it may be empty → deltas.length===0 → window.some(bloatHit) over an empty window → false.
//   No special-case needed; the contract's "empty window → false" is satisfied by the existing branches.

// GOTCHA — no new imports. TurnMetric + MulliganConfig are ALREADY imported into nudges.ts. The second param is
//   renamed _config → config (it is now USED). injectNudge/suppressCheck signatures are UNCHANGED (single latest
//   metric) — do not "fix" them to take arrays; P3.M3.T6.S1 handles the broader wiring.

// GOTCHA — shouldNudge stays PURE (no getConfig, no Pi, no tokenization). The config is PASSED IN (the call site
//   already has `config` in scope: `shouldNudge(markers.recentMetrics, config)`). This matches spec/07 §3
//   (deterministic & testable — Tier 1 unit tests, no Pi) and the existing shouldNudge which never called getConfig.

// GOTCHA — P3.M3.T6.S1 completes the contextHandler integration (high-water signal via shouldHighWater +
//   renderHighWaterNudge, P3.M3.T5.S1). This task makes ONLY the minimal shouldNudge call-site change so tsc passes
//   and the windowed behavior takes effect. Do NOT add high-water logic, do NOT restructure the contextHandler
//   drift-nudge block beyond the one-argument change + comment.
```

## Implementation Blueprint

### Data models and structure

```typescript
// NO data-model change. TurnMetric (src/markers.ts) already has deltaTokens: number | null and bloatHit: boolean.
// MulliganConfig.nudges already has driftThresholdTokens (6000) + driftWindowTurns (3) from COMPLETE P3.M3.T1.S1.
// MarkersBundle.recentMetrics: TurnMetric[] comes from parallel P3.M3.T3.S1 (assumed to land as specified).
// This task changes ONLY function behavior + one call argument + test fixtures. No interface/type/schema change.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/nudges.ts — rewrite shouldNudge (signature + body + JSDoc)
  - LOCATE the shouldNudge function + its JSDoc (the JSDoc starts ~L270 with "shouldNudge — Nudge B Phase 2 gate";
    the function is `export function shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean { return
    metric.grewOverThreshold === true || metric.bloatHit === true; }`).
  - REPLACE the signature + body with the windowed moving-average gate (see "Implementation Patterns & Key Details"
    for the verbatim new body). The new signature is `(recentMetrics: TurnMetric[], config: MulliganConfig):
    boolean`.
  - REPLACE the JSDoc with the full windowed-algorithm JSDoc (see "Implementation Patterns & Key Details") — it
    MUST document: the moving-average algorithm, the bloat-independent OR, the deltas.length===0 bloat-only
    fallback, the spec-ambiguity resolution (MA chosen; criterion 1 satisfied; criterion 2 illustrative; raised
    threshold 6000 keeps it quiet), the defensive finite-number delta filter + `=== true` bloat guard, and that
    grewOverThreshold is deliberately unused.
  - NAMING: `recentMetrics` (camelCase — match the contract + MarkersBundle.recentMetrics), `config` (was `_config`;
    now USED). `window`, `deltas`, `avg` locals.
  - GOTCHA: do NOT touch injectNudge, suppressCheck, bloatThresholdFor, bloatReminderHandler, registerBloatReminder,
    turnEndMetricHandler, registerTurnEndMetric, NUDGE_TURN_WINDOW_MS — all UNCHANGED.

Task 2: MODIFY src/filter.ts — contextHandler call site (ONE argument + comment)
  - LOCATE the per-turn drift-nudge block in contextHandler (~L257–266): the `if (config.nudges.perTurnDrift &&
    markers.metric && shouldNudge(markers.metric, config) && !suppressCheck(markers.metric, markers)) { messages =
    injectNudge(messages, markers.metric); }` + the comment above it.
  - CHANGE the shouldNudge argument: `shouldNudge(markers.metric, config)` → `shouldNudge(markers.recentMetrics,
    config)`. (ONE functional line.)
  - UPDATE the comment above the block to reference §5.1 windowed drift + that shouldNudge now takes the full
    recentMetrics window (see the Documentation pattern for the verbatim new comment). Note P3.M3.T6.S1 completes
    the broader wiring.
  - KEEP: the `markers.metric &&` guard, the `!suppressCheck(markers.metric, markers)` call, and the
    `messages = injectNudge(messages, markers.metric);` call — ALL UNCHANGED (still take the single latest metric).
  - GOTCHA: if tsc errors "Property 'recentMetrics' does not exist on type 'MarkersBundle'" → P3.M3.T3.S1 has not
    landed; coordinate (the parallel context says to assume it does). The `markers.metric &&` guard is REQUIRED to
    keep markers.metric non-null for suppressCheck/injectNudge — do not remove it.

Task 3: MODIFY test/filter.test.ts — bump metricData deltaTokens (one number)
  - LOCATE the metricData helper (~L82): `return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1,
    deltaTokens: grew ? 5000 : 100, bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };`.
  - CHANGE `grew ? 5000 : 100` → `grew ? 7000 : 100` (one number; 7000 > threshold 6000 so a single grew metric
    still fires shouldNudge under the new MA logic).
  - WHY: the contextHandler drift-nudge tests (L445/L459/L474) use metricData(1, true) and depend on shouldNudge
    returning true for a grew metric; under the new MA logic avg([5000]) = 5000 < 6000 would break them. The bump
    preserves test intent with zero structural change. (The readMarkers tests using metricData only assert seq
    sorting — unaffected.)
  - GOTCHA: do NOT rewrite the contextHandler drift-nudge tests themselves (that is P3.M3.T6.S1's scope). The
    metricData bump is the complete fix for THIS task. grewOverThreshold: grew stays in the fixture (cosmetic now;
    harmlessly unused by shouldNudge).

Task 4: MODIFY test/drift_nudge.test.ts — REWRITE the shouldNudge describe block (windowed)
  - LOCATE the `describe("shouldNudge — pure gate (spec/07 §2)", () => { … })` block (~L58–77; 4 its). REPLACE the
    ENTIRE describe with the windowed describe below. KEEP the file's `metric()` / `rewind()` / `shrink()` helpers
    AND the injectNudge / suppressCheck / NUDGE_TURN_WINDOW_MS describes UNCHANGED (they don't call shouldNudge).
  - RENAME the describe to reference §5.1: `describe("shouldNudge — windowed drift gate (spec/07 §5.1)", () => { … })`.
  - ADD a lean local helper at the top of the new describe for building windowed metrics:
        // Build a minimal turn-metric with explicit deltaTokens + bloatHit (windowed tests need delta control).
        // seq is provided so callers can express newest-first ordering; default grewOverThreshold:false (unused by
        // the gate — the windowed average replaces the single-turn check).
        const m = (deltaTokens: number | null, bloatHit = false, seq = 1): TurnMetric =>
          ({ schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: seq, deltaTokens, bloatHit,
             bloatHits: [], grewOverThreshold: false, turnIndex: seq } as TurnMetric);
    ADD a tiny config helper (shouldNudge reads nudges.driftWindowTurns + nudges.driftThresholdTokens; cast a
    partial literal — shouldNudge only reads those two fields):
        const cfg = (windowTurns = 3, threshold = 6000): MulliganConfig =>
          ({ nudges: { driftWindowTurns: windowTurns, driftThresholdTokens: threshold } } as MulliganConfig);
    (Import `MulliganConfig` type: `import type { … } from "../src/config.js"` — add to the existing markers import
    line OR a new line. The file already imports TurnMetric from markers; config import is NEW but type-only.)
  - WRITE these its (each exercises one branch / acceptance criterion):
    (a) "does NOT fire on a single heavy turn amid small turns (window smoothing) — [8k,0.5k,0.5k]":
        // newest-first (highest seq at index 0); threshold 6000, window 3 → MA 3000 < 6000 → false.
        expect(shouldNudge([m(8000,false,3), m(500,false,2), m(500,false,1)], cfg())).toBe(false);
    (b) "fires on sustained growth whose windowed average exceeds threshold — [7k,7k,7k]":
        expect(shouldNudge([m(7000,false,3), m(7000,false,2), m(7000,false,1)], cfg())).toBe(true);
    (c) "fires when ANY window metric has bloatHit (independent of the windowed delta) — bloat-only":
        // all deltas null (first turn / post-reload), one bloatHit → true.
        expect(shouldNudge([m(null,true,1)], cfg())).toBe(true);
    (d) "fires on bloatHit even when the windowed average is below threshold":
        expect(shouldNudge([m(500,true,1)], cfg())).toBe(true);
    (e) "returns false for an empty window (no metrics)":
        expect(shouldNudge([], cfg())).toBe(false);
    (f) "returns false when all window deltas are null and no bloatHit (first turn / post-reload, no bloat)":
        expect(shouldNudge([m(null,false,1)], cfg())).toBe(false);
    (g) "slices only the first driftWindowTurns metrics (newest-first)":
        // window 2 over [7k,7k,0] → MA of [7k,7k]=7k > 6k → fire; window 1 over [7k,0,0] → only newest (7k) → fire.
        expect(shouldNudge([m(7000,false,3), m(7000,false,2), m(0,false,1)], cfg(2))).toBe(true);
        expect(shouldNudge([m(7000,false,3), m(0,false,2), m(0,false,1)], cfg(1))).toBe(true);
    (h) "defensive: a malformed deltaTokens (non-number) is dropped; returns a real boolean":
        const bad = { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:1, ts:1, deltaTokens:"oops",
          bloatHit:false, bloatHits:[], grewOverThreshold:false, turnIndex:1 } as unknown as TurnMetric;
        const result = shouldNudge([bad], cfg());
        expect(result).toBe(false); expect(typeof result).toBe("boolean");
  - GOTCHA: the OLD 4 tests are DELETED (replaced by a–h). Do not leave stale tests calling shouldNudge(metric(…),
    {} as never) — they would fail tsc (wrong signature) and fail at runtime (old semantics).
  - GOTCHA: import MulliganConfig as a TYPE. If the file has `import type { TurnMetric, RewindMarker, ShrinkMarker
    } from "../src/markers.js";` and `import type { MessageLike } from "../src/transforms.js";`, ADD
    `import type { MulliganConfig } from "../src/config.js";` (one line). It is type-only (erased at runtime).

Task 5: VERIFY test/nudges.test.ts needs NO change
  - GREP `grep -c shouldNudge test/nudges.test.ts` → 0 (already verified). Do NOT edit nudges.test.ts. The contract
    names it, but shouldNudge is not referenced there (it only tests Nudge A).

Task 6 (OPTIONAL — none): no docs/README/spec change. The windowed drift algorithm is already specified in spec/07
  §5.1 (the source of this delta). README config-table sync for the knobs is the separate P3.M4.T1.S1 task.
```

### Implementation Patterns & Key Details

```typescript
// THE new shouldNudge (src/nudges.ts) — signature + body (verbatim). The full JSDoc follows below.

export function shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean {
  const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);
  const deltas = window
    .map((m) => m.deltaTokens)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (deltas.length === 0) return window.some((m) => m.bloatHit === true);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);
}

// THE new shouldNudge JSDoc (src/nudges.ts) — replace the old JSDoc entirely.

/**
 * shouldNudge — Nudge B Phase 2 gate (spec/07 §2; spec/07 §5.1 Windowed drift signaling, REQUIRED). PURE boolean
 * (no Pi calls, no tokenization). Fires the drift nudge iff the per-turn token delta, SMOOTHED over a rolling
 * window of the last `config.nudges.driftWindowTurns` turns, exceeds `config.nudges.driftThresholdTokens`, OR any
 * metric in that window recorded a bloated result.
 *
 * ALGORITHM — moving average (spec/07 §5.1 "moving-average, or M-of-N"; the item contract + architecture
 * implementation_patterns.md Pattern 8 both RECOMMEND moving average). The window is the first `driftWindowTurns`
 * entries of `recentMetrics` (P3.M3.T3.S1 sorts them NEWEST-FIRST — highest seq at index 0). From that window we
 * collect the `deltaTokens` values that are finite numbers (null/non-number/NaN/±Infinity deltas — first turn /
 * post-reload / a malformed cast — are dropped). If NO window metric has a usable delta, the delta path is skipped
 * and we fall back to the bloat path alone. Otherwise the AVERAGE of the window's usable deltas is compared
 * (strictly greater) to `driftThresholdTokens`. Bloat is INDEPENDENT of the windowed delta: if ANY window metric
 * has `bloatHit === true`, the nudge fires regardless (a bloated result is actionable even on the first turn / amid
 * small deltas).
 *
 * SPEC-AMBIGUITY RESOLUTION (architecture implementation_patterns.md Pattern 8): spec/07 §5.1 gives two acceptance
 * criteria — (1) a single 8k-token turn amid small turns does NOT fire; (2) three ~4k turns in a row DO — and offers
 * "moving-average, OR M-of-N" with threshold 6000, window 3. Neither pure algorithm satisfies BOTH literally at
 * threshold 6000: moving-average [8k,0.5k,0.5k]=3k<6k→no fire ✓ but [4k,4k,4k]=4k<6k→no fire ✗; sum
 * [8k,0.5k,0.5k]=9k>6k→fire ✗ but [4k,4k,4k]=12k>6k→fire ✓. The PRIMARY intent of §5.1 (and the reason it exists)
 * is to SUPPRESS SINGLE SPIKES — a single heavy turn is routinely legitimate (reading files, pasting docs). Moving
 * average is the algorithm that satisfies that primary intent (criterion 1). Criterion 2 ("three ~4k turns fire")
 * is ILLUSTRATIVE of "sustained growth fires"; with the §5.1-windowing-justified raised threshold of 6000
 * (config.ts: "the §5.1 windowing makes 6000 a quiet, accurate trip point"), three 4k turns averaging 4k correctly
 * do NOT fire — sustained growth whose windowed AVERAGE exceeds 6000 (e.g. three ~7k turns) DOES. Chosen algorithm:
 * MOVING AVERAGE vs threshold, with bloat OR'd in. (Matches the item contract recommendation + Pattern 8 FINAL ANSWER.)
 *
 * The bloat path uses `=== true` (not truthy) so a malformed metric — readMarkers casts raw session data, so
 * `bloatHit` could be undefined/non-boolean — fails safe to "no bloat". Delta values are guarded with
 * `typeof === "number" && Number.isFinite(d)` so a malformed `deltaTokens` (string/NaN/Infinity) is dropped rather
 * than poisoning the average with NaN. An empty window (no metrics) → no usable deltas → bloat path over an empty
 * window → false (no nudge).
 *
 * `grewOverThreshold` (the per-turn precomputation from turnEndMetricHandler) is NOT consulted here — the windowed
 * average replaces the single-turn comparison. It is still computed and persisted by turnEndMetricHandler (for
 * audit/back-compat) but is deliberately unused by this gate.
 *
 * @param recentMetrics ALL mulligan:turn-metric entries on the branch, sorted NEWEST-FIRST
 *                       (MarkersBundle.recentMetrics from P3.M3.T3.S1). This function slices the first
 *                       `driftWindowTurns` itself; the caller passes the full array.
 * @param config        the MulliganConfig (reads nudges.driftWindowTurns + nudges.driftThresholdTokens).
 * @returns true iff the windowed moving-average delta > driftThresholdTokens OR any window metric has
 *          bloatHit === true.
 */

// WHY moving average not sum: single spikes must be suppressed (the false-positive §5.1 removes). MA of
//   [8k,0.5k,0.5k] = 3k < 6k → no fire (a sum of 9k would fire — the exact false positive we're removing).
// WHY strict `>` not `>=`: matches the old per-turn semantics (`delta > driftThresholdTokens` in
//   turnEndMetricHandler's grewOverThreshold) and avoids boundary thrash at exactly the threshold.
// WHY drop non-finite deltas (not just null): readMarkers casts raw session data (`data as unknown as TurnMetric`),
//   so deltaTokens could be a string/NaN. A bare `d != null` would let a string through → reduce → NaN →
//   NaN > threshold is false (fails safe but sloppy + untestable). The finite guard is the defensive discipline
//   used elsewhere (suppressCheck's Number.isFinite ts guards, shouldNudge's old `=== true`).
// WHY negative deltas are kept: a rewind/shrink can shrink context (negative delta); it's a finite number, so the
//   filter keeps it. It correctly lowers the windowed average (growth net of the shrink).
// WHY `=== true` on bloatHit: defensive (readMarkers cast). A malformed bloatHit → no bloat (safe for an advisory nudge).
// WHY the `markers.metric &&` guard stays in the call site: suppressCheck + injectNudge still take the single
//   latest metric; the guard guarantees it is non-null. shouldNudge's own empty-window handling is separate.

// THE call-site edit (src/filter.ts contextHandler) — ONE functional line + comment (see Task 2 verbatim).
//   shouldNudge(markers.metric, config)  →  shouldNudge(markers.recentMetrics, config)

// THE metricData bump (test/filter.test.ts L82) — ONE number.
//   deltaTokens: grew ? 5000 : 100  →  deltaTokens: grew ? 7000 : 100
```

### Integration Points

```yaml
FUNCTION (src/nudges.ts shouldNudge):
  - signature: (metric: TurnMetric, _config: MulliganConfig) → (recentMetrics: TurnMetric[], config: MulliganConfig)
  - body: single-metric grewOverThreshold||bloatHit → windowed moving-average + bloat OR
  - JSDoc: rewritten (algorithm + spec-ambiguity resolution + defensive notes + grewOverThreshold-unused note)
  - NO new import (TurnMetric + MulliganConfig already imported); _config renamed config (now USED)

CALL SITE (src/filter.ts contextHandler, ~L257–266):
  - shouldNudge(markers.metric, config) → shouldNudge(markers.recentMetrics, config)   # ONE line
  - markers.metric && guard KEPT (suppressCheck/injectNudge still take the single latest metric)
  - suppressCheck(markers.metric, markers) + injectNudge(messages, markers.metric) UNCHANGED
  - comment updated to reference §5.1 + note P3.M3.T6.S1 completes the wiring

TESTS (test/drift_nudge.test.ts):
  - REPLACE the "shouldNudge — pure gate" describe with "shouldNudge — windowed drift gate (spec/07 §5.1)"
  - 8 its: single-spike-suppress, sustained-fire, bloat-only-fire, bloat-under-threshold-fire, empty-window-false,
    all-null-no-bloat-false, window-slicing, malformed-delta-defensive
  - ADD `import type { MulliganConfig } from "../src/config.js";` (type-only)
  - injectNudge / suppressCheck / NUDGE_TURN_WINDOW_MS describes + metric()/rewind()/shrink() helpers UNCHANGED

TESTS (test/filter.test.ts):
  - metricData deltaTokens: grew ? 5000 : 100 → grew ? 7000 : 100   # ONE number; keeps contextHandler tests green

NO config.ts CHANGE (driftThresholdTokens=6000 + driftWindowTurns=3 already exist from P3.M3.T1.S1 — COMPLETE).
NO markers.ts CHANGE (TurnMetric interface unchanged).
NO transforms.ts / runtime.ts / index.ts / tools/* CHANGE.
NO nudges.test.ts CHANGE (grep-verified: 0 shouldNudge references).
DOCS: none — the windowed drift algorithm is already specified in spec/07 §5.1 (the source). README config-table
  sync is the separate P3.M4.T1.S1 task.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (strict:true; no separate build/lint script).
npx tsc --noEmit
# Expected: ZERO errors. If tsc errors on src/filter.ts "Argument of type 'TurnMetric | null' is not assignable to
#   parameter of type 'TurnMetric[]'" → you forgot the call-site edit (Task 2: shouldNudge(markers.metric) →
#   shouldNudge(markers.recentMetrics)). If it errors "Property 'recentMetrics' does not exist on type
#   'MarkersBundle'" → P3.M3.T3.S1 has not landed; coordinate. If it errors on test/drift_nudge.test.ts about the
#   old shouldNudge calls → you left a stale test calling shouldNudge(metric(…), {} as never) (Task 4: replace the
#   whole describe). If it errors about MulliganConfig not imported in drift_nudge.test.ts → add the type import.
# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback) — the rewritten shouldNudge tests.
npx vitest run test/drift_nudge.test.ts
# Expected: ALL pass. Watch especially:
#   - "does NOT fire on a single heavy turn … [8k,0.5k,0.5k]" → false. If it's true, you used SUM not MA.
#   - "fires on sustained growth … [7k,7k,7k]" → true. If false, the avg comparison or threshold read is wrong.
#   - "bloat-only (all deltas null, one bloatHit)" → true. If false, the deltas.length===0 branch is missing.
#   - "empty window" → false. If it throws, .slice on undefined → recentMetrics isn't an array (shouldn't happen).
#   - "window slicing" with cfg(2)/cfg(1) → verifies slice(0, driftWindowTurns) honors the config knob.
#   - "malformed deltaTokens" → false + typeof boolean (the finite-number filter drops the string).

# Run the contextHandler test file — proves the metricData bump kept the drift-nudge tests green.
npx vitest run test/filter.test.ts
# Expected: ALL pass. Watch especially:
#   - "injects the drift nudge when shouldNudge(metric) is true and not suppressed" (L445): now uses metricData(1,
#     true) → deltaTokens 7000 > 6000 → shouldNudge true → 1 nudge appended. If NO nudge, you forgot the metricData
#     bump (Task 3) OR set 7000 below threshold.
#   - "does NOT inject the drift nudge when suppressed" (L459): metricData(1,true) + in-window rewind → shouldNudge
#     true but suppress wins → no nudge. (Bump is invisible here — still fires, still suppressed.)
#   - "does NOT inject … when shouldNudge is false" (L474): metricData(1,false,false) → deltaTokens 100 < 6000 →
#     shouldNudge false → no nudge. (Unaffected by the bump.)

# Full suite — proves no regression.
npm test
# Expected: ALL green. nudges.test.ts (Nudge A) is untouched; turn_metric.test.ts / markers.test.ts / tools/* are
# unaffected (they don't call shouldNudge). filter.test.ts readMarkers tests using metricData only assert seq
# sorting — the 5000→7000 bump is invisible to them.
```

### Level 3: Integration Testing (System Validation)

```bash
# This task changes a pure function's behavior + its single call argument; there is NO new I/O or Pi surface. The
# integration smoke harness exercises contextHandler end-to-end (which now calls the windowed shouldNudge):
npm run smoke   # optional — passes if the filter still transforms + (when metrics warrant) nudges, with no throw.
# Expected: no change in harness shape. The nudge may fire less often on single heavy turns (the intended effect);
#   sustained growth still fires. Skip unless validating the broader read/inject path.

# Manual spot-check (no real model needed) — the pure gate is fully exercised by Level 2. If you want a one-liner:
node -e "import('./src/nudges.js').then(n => { const m=(d,b=false,s=1)=>({schema:'pi-mulligan',v:1,kind:'turn-metric',seq:s,ts:s,deltaTokens:d,bloatHit:b,bloatHits:[],grewOverThreshold:false,turnIndex:s}); const cfg={nudges:{driftWindowTurns:3,driftThresholdTokens:6000}}; console.log('spike',n.shouldNudge([m(8000),m(500),m(500)],cfg),'sustained',n.shouldNudge([m(7000),m(7000),m(7000)],cfg),'bloatOnly',n.shouldNudge([m(null,true)],cfg),'empty',n.shouldNudge([],cfg)); })"
# Expected: spike false sustained true bloatOnly true empty false
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the Level 2 unit tests (the real gate for the windowed algorithm):
#   - single-spike suppression: [8k,0.5k,0.5k] (threshold 6000, window 3) → false  (criterion 1 ✓)
#   - sustained fire: [7k,7k,7k] → true                                         (criterion 2 intent ✓)
#   - bloat-only fire: all deltas null + one bloatHit → true                    (bloat-independent path ✓)
#   - bloat-under-threshold fire: MA < threshold + bloatHit → true              (OR semantics ✓)
#   - empty window → false; all-null-no-bloat → false                           (edge cases ✓)
#   - window slicing: cfg(2)/cfg(1) honors driftWindowTurns                     (config knob ✓)
#   - malformed deltaTokens dropped → real boolean                              (defensive ✓)
# Acceptance criteria reconciliation (documented in the JSDoc): criterion 1 (single 8k spike does NOT fire) is
#   satisfied literally. Criterion 2 ("three ~4k turns DO fire") is NOT satisfied literally at threshold 6000
#   (MA 4k < 6k) — this is the documented spec-ambiguity resolution: criterion 2 is illustrative of "sustained
#   growth fires," and the raised threshold 6000 (justified by §5.1 windowing) deliberately keeps three 4k turns
#   quiet. Sustained growth averaging > 6000 fires. The contract + Pattern 8 explicitly endorse this resolution.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (shouldNudge new signature + call-site arg + test edits type-clean).
- [ ] `npx vitest run test/drift_nudge.test.ts` — all pass (8 rewritten shouldNudge its + unchanged injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS its).
- [ ] `npx vitest run test/filter.test.ts` — all pass (metricData bump keeps the 3 contextHandler drift-nudge its green; readMarkers its unaffected).
- [ ] `npm test` — full suite green (no regression in nudges/turn_metric/markers/tools/edge-cases/transforms).

### Feature Validation
- [ ] Single 8k spike `[8000,500,500]` (threshold 6000, window 3) → `false`.
- [ ] Sustained growth `[7000,7000,7000]` → `true`.
- [ ] bloat-only (all deltas null, one bloatHit) → `true`; bloat fires even when MA < threshold.
- [ ] Empty window → `false`; all-null deltas + no bloat → `false`.
- [ ] Window slicing honors `driftWindowTurns` (cfg(2)/cfg(1) tests).
- [ ] Malformed `deltaTokens` (non-number) dropped → returns real `boolean`.
- [ ] `contextHandler` passes `markers.recentMetrics`; `suppressCheck`/`injectNudge` still take the latest metric.

### Code Quality Validation
- [ ] `shouldNudge` is PURE (no `getConfig`/Pi/tokenization); `config` is passed in (renamed from `_config`).
- [ ] JSDoc documents the moving-average algorithm + the spec-ambiguity resolution + defensive guards + grewOverThreshold-unused note.
- [ ] Delta filter is `typeof === "number" && Number.isFinite(d)` (not bare `!= null`); `bloatHit === true` (strict).
- [ ] No changes outside `src/nudges.ts`, `src/filter.ts`, `test/drift_nudge.test.ts`, `test/filter.test.ts`.
- [ ] `injectNudge` / `suppressCheck` / Nudge A handlers / `turnEndMetricHandler` UNCHANGED.

### Documentation & Deployment
- [ ] No docs required (the windowed drift algorithm is already specified in spec/07 §5.1 — the source of this delta).
- [ ] No README change (README config-table sync for the knobs is the separate P3.M4.T1.S1 task).
- [ ] No config change (the knobs already exist from COMPLETE P3.M3.T1.S1).

---

## Anti-Patterns to Avoid

- ❌ Do NOT use SUM of deltas — a sum fires on the single 8k spike (9k > 6k), which is the exact false positive §5.1 removes. Use MOVING AVERAGE.
- ❌ Do NOT reintroduce a `grewOverThreshold` check. The new body reads `deltaTokens` (windowed); `grewOverThreshold` is a single-turn precomputation that the windowed average replaces. It stays in the type/handler for audit but is unused here.
- ❌ Do NOT filter deltas with bare `d != null` (Pattern 8's sketch). `readMarkers` casts raw data; a string/NaN `deltaTokens` would slip through and poison the average. Use `typeof d === "number" && Number.isFinite(d)`.
- ❌ Do NOT drop negative deltas. A rewind/shrink legitimately shrinks context (negative delta); it's finite and should lower the windowed average. The filter keeps finite numbers (negatives included).
- ❌ Do NOT remove the `markers.metric &&` guard in the `contextHandler` call site. `suppressCheck(markers.metric, …)` and `injectNudge(messages, markers.metric)` still take the single LATEST metric; the guard guarantees it is non-null. Removing it → `suppressCheck(null, …)` throws.
- ❌ Do NOT change `injectNudge` or `suppressCheck` to take arrays. They still take the single latest metric (for the nudge text + the suppress time-window). Their signatures are UNCHANGED. The broader `contextHandler` integration is P3.M3.T6.S1.
- ❌ Do NOT rewrite the `contextHandler` drift-nudge tests to pass multi-metric arrays — that's P3.M3.T6.S1's scope. The `metricData` 5000→7000 bump is the complete fix for THIS task.
- ❌ Do NOT edit `test/nudges.test.ts`. The contract names it, but grep confirms 0 `shouldNudge` references (it only tests Nudge A). There is nothing to update.
- ❌ Do NOT call `getConfig()` inside `shouldNudge`. It stays PURE — the config is passed in (the call site already has `config` in scope). This matches spec/07 §3 (Tier 1 unit-testable, no Pi).
- ❌ Do NOT add high-water logic or restructure the `contextHandler` drift-nudge block beyond the one-argument change + comment. P3.M3.T5.S1 (high-water helpers) + P3.M3.T6.S1 (full wiring) own that.
- ❌ Do NOT change `config.ts` or `markers.ts`. The knobs (`driftThresholdTokens=6000`, `driftWindowTurns=3`) already exist (P3.M3.T1.S1 COMPLETE); the `TurnMetric` interface is unchanged.

---

## Confidence Score

**9.5 / 10** — one-pass success is highly likely. This is a small, surgical, pure-function change: one function body +
JSDoc rewrite, one call-site argument swap (with the guard + sibling calls explicitly preserved), one test-block
rewrite, and one one-number fixture bump. The algorithm is fully specified (moving average) by BOTH the item
contract's RESEARCH NOTE and `architecture/implementation_patterns.md` Pattern 8's FINAL ANSWER — no guesswork. The
spec-ambiguity (MA vs sum vs M-of-N against two acceptance criteria at threshold 6000) is resolved explicitly and
the resolution is documented in the JSDoc the implementer writes, so there is no hidden decision to get wrong. The
dependencies all exist: `TurnMetric` + `MulliganConfig` are already imported in `nudges.ts`; `driftThresholdTokens` +
`driftWindowTurns` exist in config (P3.M3.T1.S1 COMPLETE); `MarkersBundle.recentMetrics` comes from parallel
P3.M3.T3.S1 (assumed to land as specified). The one non-trivial trap — the `filter.test.ts` `metricData` helper's
`5000` being below the raised threshold 6000, which would silently break the `contextHandler` drift-nudge tests — is
identified, verified by reading the fixtures + the tests, and fixed by a single-number bump with a clear rationale.
The second trap — `nudges.test.ts` being named in the contract but containing no `shouldNudge` call — is
grep-verified and explicitly called out so the implementer doesn't waste time. All edits are to existing files; no
new files, no new imports beyond a type-only `MulliganConfig` import in the test file; no Pi-surface change; the
function stays a pure Tier-1-testable boolean. The 0.5 deduction is for the cross-task ordering dependency on
P3.M3.T3.S1 (if it hasn't landed, the call-site edit fails tsc — but the parallel context says to assume it does).