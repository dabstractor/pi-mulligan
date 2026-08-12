import { describe, it, expect } from "vitest";
import {
  shouldNudge,
  injectNudge,
  suppressCheck,
  shouldHighWater,
  renderHighWaterNudge,
  injectHighWaterNudge,
} from "../src/nudges.js";
import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";
import type { MessageLike } from "../src/transforms.js";
import type { SessionRuntime } from "../src/runtime.js";
import type { MulliganConfig } from "../src/config.js";
import { estimateAgentTokens, type MessageLike as TokenMessageLike } from "../src/tokens.js";

// cfg helper (top-level) for injectNudge's windowed sustained-growth clarification tests (Minor #3).
function cfgFor(windowTurns = 3, threshold = 4000): MulliganConfig {
  return { nudges: { driftWindowTurns: windowTurns, driftThresholdTokens: threshold } } as MulliganConfig;
}

// ── pure-function unit tests for Nudge B Phase 2 (spec/07 §2). NO Pi fakes, NO clearAll, NO setConfig. ──
// shouldNudge / injectNudge / suppressCheck are pure helpers (spec/07 §3); these tests exercise them directly
// with hand-built minimal literals. The metric/markers are built as partial literals cast to the marker type
// (these are pure tests, NOT the Pi boundary — the cast is local test scaffolding, not production code).

/** Build a minimal TurnMetric literal (defaults: grewOverThreshold true so shouldNudge is true). */
function metric(opts: Partial<TurnMetric> = {}): TurnMetric {
  return {
    schema: "pi-mulligan",
    v: 1,
    kind: "turn-metric",
    seq: 1,
    ts: 1_000_000,
    deltaTokens: 5000,
    bloatHit: false,
    bloatHits: [],
    grewOverThreshold: true,
    turnIndex: 5,
    ...opts,
  } as TurnMetric;
}

/** Build a minimal RewindMarker literal at a given (seq, ts). */
function rewind(seq: number, ts: number): RewindMarker {
  return {
    schema: "pi-mulligan",
    v: 1,
    kind: "rewind",
    id: `rw-${seq}`,
    granularity: "last_tool_call_group",
    options: {},
    seq,
    note: { what_happened: "p", avoid: "a", true_current_state: "s", next: "n" } as never,
    ledger: { readFiles: [], modifiedFiles: [], bashSideEffects: [] } as never,
    ts,
  } as unknown as RewindMarker;
}

/** Build a minimal ShrinkMarker literal at a given (seq, ts). */
function shrink(seq: number, ts: number): ShrinkMarker {
  return {
    schema: "pi-mulligan",
    v: 1,
    kind: "shrink",
    id: `sh-${seq}`,
    target: { by_tool_call_id: "c1" },
    replacement: "<shrunk>",
    seq,
    ts,
  } as unknown as ShrinkMarker;
}

// ── shouldNudge ─────────────────────────────────────────────────────────────────────────────

describe("shouldNudge — windowed drift gate (spec/07 §5.1)", () => {
  // Build a minimal turn-metric with explicit deltaTokens + bloatHit (windowed tests need delta control).
  // seq is provided so callers can express newest-first ordering; default grewOverThreshold:false (unused by
  // the gate — the windowed average replaces the single-turn check).
  const m = (deltaTokens: number | null, bloatHit = false, seq = 1): TurnMetric =>
    ({ schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: seq, deltaTokens, bloatHit,
       bloatHits: [], grewOverThreshold: false, turnIndex: seq } as TurnMetric);
  // shouldNudge reads nudges.driftWindowTurns + nudges.driftThresholdTokens; cast a partial literal.
  const cfg = (windowTurns = 3, threshold = 6000): MulliganConfig =>
    ({ nudges: { driftWindowTurns: windowTurns, driftThresholdTokens: threshold } } as MulliganConfig);

  it("does NOT fire on a single heavy turn amid small turns (window smoothing) — [8k,0.5k,0.5k]", () => {
    // newest-first (highest seq at index 0); threshold 6000, window 3 → MA 3000 < 6000 → false.
    expect(shouldNudge([m(8000, false, 3), m(500, false, 2), m(500, false, 1)], cfg())).toBe(false);
  });

  it("fires on sustained growth whose windowed average exceeds threshold — [7k,7k,7k]", () => {
    expect(shouldNudge([m(7000, false, 3), m(7000, false, 2), m(7000, false, 1)], cfg())).toBe(true);
  });

  it("fires on bloatHit ONLY in the no-delta fallback (first turn / post-reload) — bloat-only", () => {
    // all deltas null → deltas.length===0 → bloat fallback arm (the ONLY surviving bloat path).
    expect(shouldNudge([m(null, true, 1)], cfg())).toBe(true);
  });

  it("does NOT fire on bloatHit when delta data exists and average is below threshold (P4.M2.T1)", () => {
    // bloatHit no longer arms the delta-available path (P4.M2.T1.S1 / spec/07 §5.1); deltas=[500],
    // avg 500 < 6000 → false. Only the no-delta fallback (next case) fires on bloat.
    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(false);
  });

  it("returns false for an empty window (no metrics)", () => {
    expect(shouldNudge([], cfg())).toBe(false);
  });

  it("returns false when all window deltas are null and no bloatHit (first turn / post-reload, no bloat)", () => {
    expect(shouldNudge([m(null, false, 1)], cfg())).toBe(false);
  });

  it("slices only the first driftWindowTurns metrics (newest-first)", () => {
    // window 2 over [7k,7k,0] → MA of [7k,7k]=7k > 6k → fire; window 1 over [7k,0,0] → only newest (7k) → fire.
    expect(shouldNudge([m(7000, false, 3), m(7000, false, 2), m(0, false, 1)], cfg(2))).toBe(true);
    expect(shouldNudge([m(7000, false, 3), m(0, false, 2), m(0, false, 1)], cfg(1))).toBe(true);
  });

  it("defensive: a malformed deltaTokens (non-number) is dropped; returns a real boolean", () => {
    const bad = { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq: 1, ts: 1, deltaTokens: "oops",
      bloatHit: false, bloatHits: [], grewOverThreshold: false, turnIndex: 1 } as unknown as TurnMetric;
    const result = shouldNudge([bad], cfg());
    expect(result).toBe(false);
    expect(typeof result).toBe("boolean");
  });

  it("FIRES on three ~4k turns in a row at the lowered default threshold 4000 (BUG-003 / spec/07 §5.1 criterion b)", () => {
    // Lowered default 4000 + `>=`: avg([4k,4k,4k]) = 4000 >= 4000 → fire.
    // (Before the fix: avg 4000 > 6000 → false → criterion (b) violated.)
    expect(shouldNudge([m(4000, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(true);
  });

  it("boundary: windowed average EXACTLY equal to threshold fires (`>=`); one tick below does NOT", () => {
    // avg([4k,4k,4k]) === driftThresholdTokens (4000) → fire (the >= edge that satisfies criterion b).
    expect(shouldNudge([m(4000, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(true);
    // avg([3999,4k,4k]) = 3999.67 < 4000 → no fire.
    expect(shouldNudge([m(3999, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(false);
  });

  it("does NOT fire on a single heavy turn amid small turns at threshold 4000 (criterion a holds at new default)", () => {
    // avg([8k,0.5k,0.5k]) = 3000 >= 4000? No → no fire (criterion a preserved at the lowered default).
    expect(shouldNudge([m(8000, false, 3), m(500, false, 2), m(500, false, 1)], cfg(3, 4000))).toBe(false);
  });

  // ── P1.M2.T1.S3: D10 — F-drift-userexempt-shaped (does NOT require S2) ───────────────────
  it("D10 (F-drift-userexempt-shaped): a 50k-token user paste does NOT trip the drift nudge (agent-attributable delta stays below threshold)", () => {
    // The turn's filtered view: a 50k-token user paste + a ~500-token assistant reply.
    const filteredView = [
      { role: "user", content: "x".repeat(200000) },      // 50000 tokens if counted — EXCLUDED by D10
      { role: "assistant", content: "x".repeat(2000) },    // 500 tokens — agent-attributable
    ] as unknown as TokenMessageLike[];

    // turnEndMetricHandler (post-S2) computes `now` via estimateAgentTokens → the paste contributes 0.
    const agentAttributableNow = estimateAgentTokens(filteredView);
    expect(agentAttributableNow).toBe(500);                // NOT 50500 — the paste is ground-truth, never bloat

    // A window of such turns: the windowed-average delta stays far below the threshold → no drift nudge.
    expect(
      shouldNudge(
        [m(agentAttributableNow, false, 3), m(agentAttributableNow, false, 2), m(agentAttributableNow, false, 1)],
        cfg(3, 6000),
      ),
    ).toBe(false);

    // Contrast (pre-D10 would-have-fired): counting the paste gives a ~50000-token delta → drift nudge FIRES.
    expect(shouldNudge([m(50000, false, 1)], cfg(3, 6000))).toBe(true);
  });
});

// ── injectNudge ─────────────────────────────────────────────────────────────────────────────

describe("injectNudge — pure append, ephemeral (spec/07 §2)", () => {
  it("appends EXACTLY ONE mulligan:nudge message to the END", () => {
    const input: MessageLike[] = [{ role: "user", content: "a" }];
    const result = injectNudge(input, metric({ turnIndex: 7 }));
    expect(result).toHaveLength(2);
    const last = result[1] as Record<string, unknown>;
    expect(last.role).toBe("custom");
    expect(last.customType).toBe("mulligan:nudge");
    expect(last.display).toBe(false);
    const details = last.details as Record<string, unknown>;
    expect(details.ephemeral).toBe(true);
    expect(details.turnIndex).toBe(7);
    expect(typeof last.content).toBe("string");
    expect((last.content as string).length).toBeGreaterThan(0);
    expect(typeof last.timestamp).toBe("number");
  });

  it("returns a NEW array and does NOT mutate the input", () => {
    const input: MessageLike[] = [{ role: "user", content: "a" }];
    const result = injectNudge(input, metric());
    expect(result).not.toBe(input); // a NEW array
    expect(input).toHaveLength(1); // input UNCHANGED (not mutated)
    expect(result).toHaveLength(2);
  });

  it("produces a non-empty string content via renderDriftNudge", () => {
    const result = injectNudge([], metric({ deltaTokens: 4200, bloatHits: [{ toolName: "read", approxTokens: 2100 }] }));
    const last = result[0] as Record<string, unknown>;
    expect(typeof last.content).toBe("string");
    expect((last.content as string).startsWith("Previous turn")).toBe(true);
    expect((last.content as string)).not.toContain("[mulligan]");
  });

  it("does NOT stack when called repeatedly on the ORIGINAL input (ephemeral / recomputed each fire)", () => {
    // The filter calls injectNudge on the FRESH pipeline output each context fire. Verify that calling
    // injectNudge on the ORIGINAL messages twice yields length +1 each time (not +2 — it never stacks).
    const original: MessageLike[] = [{ role: "user", content: "a" }];
    const once = injectNudge(original, metric());
    const twice = injectNudge(original, metric()); // called on `original`, NOT on `once`
    expect(once).toHaveLength(2);
    expect(twice).toHaveLength(2); // NOT 3 — the nudge never accumulates when injected into a fresh copy
  });
});

// ── injectNudge — sustained-growth clarification (Minor #3 / spec/07 §2 advisory UX) ──────────
// The nudge fires on the WINDOWED moving average; the lead reports the LATEST single-turn delta. When the latest
// delta is below the nominal single-turn threshold yet the windowed average tripped, injectNudge threads a
// sustainedOverTurns hint so renderDriftNudge appends " (sustained over the last N turns)".
describe("injectNudge — sustained-growth clarification (Minor #3)", () => {
  it("appends the sustained clause when the windowed average trips but the latest single-turn delta is below threshold", () => {
    // Window [7k,7k,800] (newest-first): MA = (7000+7000+800)/3 = 4933 >= 4000 → fire; latest delta 800 < 4000.
    const config = cfgFor(3, 4000);
    const latest = metric({ deltaTokens: 800, seq: 3, turnIndex: 3 });
    const recent = [
      latest,
      metric({ deltaTokens: 7000, seq: 2, turnIndex: 2 }),
      metric({ deltaTokens: 7000, seq: 1, turnIndex: 1 }),
    ];
    const result = injectNudge([], latest, recent, config);
    const content = (result[0] as Record<string, unknown>).content as string;
    expect(content).toContain("added ~0.8k tokens to your context (sustained over the last 3 turns)");
  });

  it("does NOT append the clause when the latest single-turn delta alone explains the fire (>= threshold)", () => {
    // Latest delta 5000 >= 4000 → the single-turn figure is self-evidently large; no clarification needed.
    const config = cfgFor(3, 4000);
    const latest = metric({ deltaTokens: 5000, seq: 3, turnIndex: 3 });
    const recent = [latest, metric({ deltaTokens: 5000, seq: 2, turnIndex: 2 }), metric({ deltaTokens: 5000, seq: 1, turnIndex: 1 })];
    const result = injectNudge([], latest, recent, config);
    const content = (result[0] as Record<string, unknown>).content as string;
    expect(content).toBe("Previous turn added ~5k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.");
  });

  it("does NOT append the clause when recentMetrics/config are omitted (back-compat with single-metric callers)", () => {
    const latest = metric({ deltaTokens: 800 });
    const result = injectNudge([], latest);
    const content = (result[0] as Record<string, unknown>).content as string;
    expect(content).toBe("Previous turn added ~0.8k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.");
  });

  it("does NOT append the clause when delta is null (bloat-only lead)", () => {
    const config = cfgFor(3, 4000);
    const latest = metric({ deltaTokens: null, bloatHits: [{ toolName: "read", approxTokens: 2048 }], bloatHit: true, seq: 3 });
    const recent = [latest, metric({ deltaTokens: 7000, seq: 2 }), metric({ deltaTokens: 7000, seq: 1 })];
    const result = injectNudge([], latest, recent, config);
    const content = (result[0] as Record<string, unknown>).content as string;
    expect(content).toContain("Previous turn produced 1 bloated result.");
    expect(content).not.toContain("sustained");
  });
});

// ── suppressCheck ───────────────────────────────────────────────────────────────────────────

describe("suppressCheck — §5.3 hard-rule suppress window (mechanism: turn-boundary; spec/07 §5.3, BUG-001 fix)", () => {
  const T_LATEST = 200;
  const T_PREV = 100;
  // Two-turn recentMetrics, newest-first: [0]=latest, [1]=previous (matches readMarkers' sort).
  const recentMetrics = (): TurnMetric[] => [
    metric({ ts: T_LATEST, seq: 3 }),
    metric({ ts: T_PREV, seq: 2 }),
  ];
  const latest = (): TurnMetric => recentMetrics()[0];

  it("returns false when there are no markers", () => {
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [], shrinks: [] })).toBe(false);
  });

  it("returns true when a rewind marker ts is within (prev.ts, latest.ts] — inclusive upper bound", () => {
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [rewind(1, T_LATEST)], shrinks: [] })).toBe(true);
  });

  it("returns true when a marker is created DURING this turn (prev.ts < markerTs <= latest.ts)", () => {
    // marker at ts=150 falls in (100, 200] → created during this turn → suppress.
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [], shrinks: [shrink(1, 150)] })).toBe(true);
  });

  it("returns FALSE when a marker is from the PREVIOUS turn (markerTs <= prev.ts) — BUG-001 fix", () => {
    // marker at ts=100 (== prev.ts) → 100 > 100 is FALSE → not in window → no suppress.
    // Under the old wall-clock logic, 100 was within 10 min of 200 → wrongly suppressed.
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [], shrinks: [shrink(1, T_PREV)] })).toBe(false);
  });

  it("returns false when a marker is from a much older turn (markerTs < prev.ts)", () => {
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [], shrinks: [shrink(1, 50)] })).toBe(false);
  });

  it("returns false when a marker ts is in the future (markerTs > latest.ts) — strict upper bound", () => {
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [rewind(1, 250)], shrinks: [] })).toBe(false);
  });

  it("returns true when a SHRINK marker is within the turn window (not just rewinds)", () => {
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [], shrinks: [shrink(1, T_LATEST)] })).toBe(true);
  });

  it("returns false when a rewind marker ts is non-finite (malformed) — treated as NOT in window", () => {
    const bad = rewind(1, Number.NaN) as RewindMarker & { ts: number };
    bad.ts = Number.NaN;
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [bad], shrinks: [] })).toBe(false);
  });

  it("returns true as soon as ANY marker (rewind or shrink) is in the turn window", () => {
    const oldRewind = rewind(1, 50); // older than prev.ts → not in window
    const freshShrink = shrink(2, 150); // in (prev.ts, latest.ts] → in window
    expect(suppressCheck(latest(), recentMetrics(), { rewinds: [oldRewind], shrinks: [freshShrink] })).toBe(true);
  });

  it("first turn (recentMetrics.length===1): marker <= latest.ts → true (lo=0 fallback)", () => {
    // Only one metric this turn → no previous metric → lo=0 → any marker <= latest.ts suppresses.
    const firstTurn = [metric({ ts: T_LATEST })];
    expect(suppressCheck(latest(), firstTurn, { rewinds: [], shrinks: [shrink(1, T_LATEST)] })).toBe(true);
  });

  it("defensive: non-finite recentMetrics[1].ts → lo=0 (first-turn fallback)", () => {
    // A corrupt previous-metric ts falls back to lo=0 → marker <= latest.ts suppresses.
    const corruptPrev = [metric({ ts: T_LATEST }), metric({ ts: Number.NaN })];
    expect(suppressCheck(latest(), corruptPrev, { rewinds: [], shrinks: [shrink(1, T_LATEST)] })).toBe(true);
  });

  it("treats a non-finite metric.ts as 0 (defensive)", () => {
    // metric.ts = NaN → metricTs = 0 → lo = prev.ts (100). A marker at ts=0 is not in (100, 0] → no suppress.
    const m = metric({ ts: Number.NaN });
    expect(suppressCheck(m, recentMetrics(), { rewinds: [rewind(1, 0)], shrinks: [] })).toBe(false);
  });
});

describe("suppressCheck — spec/07 §5.3 hard rule (acceptance a/b/c): drift nudge MUST NOT fire when the agent already acted", () => {
  // §5.3: "if [the marker set created during the metric's turn] is non-empty, [the drift nudge] returns false
  // for that metric REGARDLESS of delta or bloatHit". The IMPLEMENTATION delegates this to suppressCheck (a
  // separate gate AFTER shouldNudge in filter.ts:319). The §5.3 NET nudge decision is
  // `shouldNudge(recentMetrics, config) && !suppressCheck(metric, markers)` — the guard these tests assert.
  // (Pure helpers — no Pi; the spec/10 F-nudge-drift §5.3 integration scenario is the real-pi mirror, already
  // in test/integration/.)

  // A sustained-growth window whose moving average (7000) exceeds the threshold (6000) → shouldNudge true.
  // newest-first (highest seq at index 0); delta-only path (bloat irrelevant when delta data exists).
  const driftWindow = (): TurnMetric[] => [
    { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:3, ts:3, deltaTokens:7000, bloatHit:false,
      bloatHits:[], grewOverThreshold:false, turnIndex:3 } as TurnMetric,
    { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:2, ts:2, deltaTokens:7000, bloatHit:false,
      bloatHits:[], grewOverThreshold:false, turnIndex:2 } as TurnMetric,
    { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:1, ts:1, deltaTokens:7000, bloatHit:false,
      bloatHits:[], grewOverThreshold:false, turnIndex:1 } as TurnMetric,
  ];
  const cfg = (): MulliganConfig =>
    ({ nudges: { driftWindowTurns: 3, driftThresholdTokens: 6000 } } as MulliganConfig);
  const latest = (): TurnMetric => driftWindow()[0]; // seq 3, ts 3 — bounds the suppress window

  it("(a) >threshold window + same-turn SHRINK → net nudge decision is FALSE (no drift nudge)", () => {
    const sameTurnShrink = shrink(1, latest().ts); // ts === metric.ts → in (prev.ts, ts] → suppress
    const fire = shouldNudge(driftWindow(), cfg()) &&
                 !suppressCheck(latest(), driftWindow(), { rewinds: [], shrinks: [sameTurnShrink] });
    expect(shouldNudge(driftWindow(), cfg())).toBe(true);           // would fire on growth alone
    expect(suppressCheck(latest(), driftWindow(), { rewinds: [], shrinks: [sameTurnShrink] })).toBe(true); // suppressed
    expect(fire).toBe(false);                                      // §5.3 (a): net NO nudge
  });

  it("(b) >threshold window + NO action → net nudge decision is TRUE (fires normally)", () => {
    const fire = shouldNudge(driftWindow(), cfg()) &&
                 !suppressCheck(latest(), driftWindow(), { rewinds: [], shrinks: [] });
    expect(shouldNudge(driftWindow(), cfg())).toBe(true);           // growth fires
    expect(suppressCheck(latest(), driftWindow(), { rewinds: [], shrinks: [] })).toBe(false); // no marker → not suppressed
    expect(fire).toBe(true);                                       // §5.3 (b): fires
  });

  it("(c) >threshold window + same-turn REWIND → net nudge decision is FALSE (no drift nudge)", () => {
    const sameTurnRewind = rewind(1, latest().ts); // ts === metric.ts → in (prev.ts, ts] → suppress
    const fire = shouldNudge(driftWindow(), cfg()) &&
                 !suppressCheck(latest(), driftWindow(), { rewinds: [sameTurnRewind], shrinks: [] });
    expect(suppressCheck(latest(), driftWindow(), { rewinds: [sameTurnRewind], shrinks: [] })).toBe(true); // suppressed
    expect(fire).toBe(false);                                      // §5.3 (c): net NO nudge
  });
});

// ── BUG-001 regression ──────────────────────────────────────────────────────────────────────

it("BUG-001: a marker from a PRIOR turn does NOT suppress a later turn (no 10-min blackout)", () => {
  // Two turns: latest at T+120s (seq 3), previous at T (seq 2). A shrink created during the PREVIOUS turn
  // (ts=T) must NOT suppress the drift nudge on the latest turn. Under the old wall-clock logic this wrongly
  // suppressed for ~10 min after the marker.
  const T = 1_000_000;
  const latestMetric = metric({ ts: T + 120_000, seq: 3 });
  const prev = metric({ ts: T, seq: 2 });
  const recentMetrics = [latestMetric, prev];
  const priorTurnShrink = { ...shrink(1, T) }; // created during the PREVIOUS turn
  expect(suppressCheck(latestMetric, recentMetrics, { rewinds: [], shrinks: [priorTurnShrink] })).toBe(false);
  // And a marker created DURING this turn still suppresses:
  const thisTurnShrink = { ...shrink(2, T + 60_000) }; // between prev.ts and latest.ts
  expect(suppressCheck(latestMetric, recentMetrics, { rewinds: [], shrinks: [thisTurnShrink] })).toBe(true);
});

// ── pure-function unit tests for the §5.2 edge-triggered high-water signal (spec/07 §5.2). ──
// shouldHighWater / renderHighWaterNudge / injectHighWaterNudge are pure-ish helpers (spec/07 §3); these tests
// exercise them directly with hand-built minimal literals. shouldHighWater MUTATES rt.aboveHighWater (the
// intentional edge-trigger latch); the lifecycle its exercise that mutation in place on ONE rt.

/**
 * Build a minimal SessionRuntime literal for the high-water edge-trigger lifecycle tests. aboveHighWater starts
 * false (the freshRuntime default); the lifecycle its mutate it in place to exercise the latch.
 */
function rt(above = false): SessionRuntime {
  return {
    sessionId: "s1",
    seq: 0,
    tokenBaseline: null,
    lastTurnIndex: null,
    lastFiltered: null,
    lastFilterTs: null,
    pendingBloatHits: [],
    shrinkMissCounts: new Map(),
    aboveHighWater: above,
    rewindRefusedTurnIndex: null,
  } as SessionRuntime;
}

/**
 * Build a minimal MulliganConfig literal for shouldHighWater (reads nudges.highWaterFraction). shouldHighWater
 * only reads that one field, so a partial literal cast to MulliganConfig is sufficient (pure-test scaffolding).
 */
const hcfg = (fraction = 0.7): MulliganConfig =>
  ({ nudges: { highWaterFraction: fraction } } as MulliganConfig);

// ── shouldHighWater ─────────────────────────────────────────────────────────────────────────

describe("shouldHighWater — edge-triggered latch (spec/07 §5.2)", () => {
  it("fires on the first upward crossing and latches aboveHighWater true", () => {
    const r = rt(false); // window 200000, total 140000 → fraction 0.7 → fire
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
    expect(r.aboveHighWater).toBe(true);
  });

  it("does NOT re-fire while already above (edge-triggered)", () => {
    const r = rt(true); // already latched from a prior crossing
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(false);
    expect(r.aboveHighWater).toBe(true); // unchanged
  });

  it("clears the latch when the total drops back below the fraction", () => {
    const r = rt(true); // was above; total 100000 → fraction 0.5 < 0.7 → clear
    expect(shouldHighWater(100000, 200000, r, hcfg(0.7))).toBe(false);
    expect(r.aboveHighWater).toBe(false);
  });

  it("fires again after dropping below and re-crossing (re-armed)", () => {
    const r = rt(false); // simulate: was cleared, now crosses up again
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
    expect(r.aboveHighWater).toBe(true);
  });

  it("full lifecycle on one rt: cross→latch→no-refire→drop→clear→re-cross→fire", () => {
    const r = rt(false);
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
    expect(r.aboveHighWater).toBe(true);
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(false);
    expect(r.aboveHighWater).toBe(true);
    expect(shouldHighWater(100000, 200000, r, hcfg(0.7))).toBe(false);
    expect(r.aboveHighWater).toBe(false);
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
    expect(r.aboveHighWater).toBe(true);
  });

  it("returns false at windowTokens <= 0 WITHOUT mutating aboveHighWater (fail-open, E12)", () => {
    const r = rt(true); // latched above; window unknown → must not fire NOR clear the latch
    expect(shouldHighWater(140000, 0, r, hcfg(0.7))).toBe(false);
    expect(r.aboveHighWater).toBe(true); // UNCHANGED — fail-open does not touch the latch
    const r2 = rt(false);
    expect(shouldHighWater(140000, -5, r2, hcfg(0.7))).toBe(false);
    expect(r2.aboveHighWater).toBe(false); // UNCHANGED
  });

  it("fires at exactly the fraction (>= comparison): total/window === highWaterFraction", () => {
    const r = rt(false);
    expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true); // 0.7 >= 0.7 → fire
  });

  it("honors a custom fraction (0.9): 0.7 < 0.9 → no fire", () => {
    const r = rt(false);
    expect(shouldHighWater(140000, 200000, r, hcfg(0.9))).toBe(false); // 0.7 < 0.9
    expect(r.aboveHighWater).toBe(false); // cleared (below)
  });
});

// ── renderHighWaterNudge ───────────────────────────────────────────────────────────────────

describe("renderHighWaterNudge — one-line annotation (spec/07 §5.2)", () => {
  it("returns a non-empty string containing the rounded percentage", () => {
    const s = renderHighWaterNudge(140000, 200000); // 0.7 → 70%
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain("~70%");
    expect(s).toContain("[mulligan]");
    expect(s).toContain("mulligan_shrink");
    expect(s).toContain("mulligan_rewind");
  });

  it("rounds the percentage (0.75 → 75%, 0.666 → 67%)", () => {
    expect(renderHighWaterNudge(150000, 200000)).toContain("~75%"); // 0.75
    expect(renderHighWaterNudge(133333, 200000)).toContain("~67%"); // 0.6666 → 67
  });

  it("never throws + returns a percentage-free fallback when windowTokens <= 0", () => {
    expect(() => renderHighWaterNudge(140000, 0)).not.toThrow();
    const s = renderHighWaterNudge(140000, 0);
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toContain("%"); // no NaN/Infinity%
    expect(s).toContain("mulligan_shrink"); // still recommends the tools
  });
});

// ── injectHighWaterNudge ───────────────────────────────────────────────────────────────────

describe("injectHighWaterNudge — pure injection (spec/07 §5.2, mirror injectNudge)", () => {
  it("returns a NEW array of length input+1 with a mulligan:high-water custom message appended", () => {
    const before: MessageLike[] = [{ role: "user", content: "hi" }];
    const out = injectHighWaterNudge(before, 140000, 200000);
    expect(out).not.toBe(before); // new array (PURE)
    expect(out.length).toBe(2); // input untouched + 1
    const nudge = out[1];
    expect(nudge.role).toBe("custom");
    expect(nudge.customType).toBe("mulligan:high-water");
    expect(typeof nudge.content).toBe("string");
    expect((nudge.content as string).length).toBeGreaterThan(0);
    expect(nudge.display).toBe(false);
    expect(nudge.details).toMatchObject({
      ephemeral: true,
      totalFilteredTokens: 140000,
      windowTokens: 200000,
    });
    expect(typeof nudge.timestamp).toBe("number");
  });

  it("does NOT mutate the input array", () => {
    const before: MessageLike[] = [{ role: "user", content: "hi" }];
    injectHighWaterNudge(before, 140000, 200000);
    expect(before.length).toBe(1); // untouched
    expect(before[0]).toEqual({ role: "user", content: "hi" });
  });

  it("delegates the text to renderHighWaterNudge (content matches)", () => {
    const out = injectHighWaterNudge([], 140000, 200000);
    expect(out[0].content).toBe(renderHighWaterNudge(140000, 200000));
  });
});