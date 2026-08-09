import { describe, it, expect } from "vitest";
import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS } from "../src/nudges.js";
import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";
import type { MessageLike } from "../src/transforms.js";
import type { MulliganConfig } from "../src/config.js";

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

  it("fires when ANY window metric has bloatHit (independent of the windowed delta) — bloat-only", () => {
    // all deltas null (first turn / post-reload), one bloatHit → true.
    expect(shouldNudge([m(null, true, 1)], cfg())).toBe(true);
  });

  it("fires on bloatHit even when the windowed average is below threshold", () => {
    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);
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
    expect((last.content as string).startsWith("[mulligan]")).toBe(true);
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

// ── suppressCheck ───────────────────────────────────────────────────────────────────────────

describe("suppressCheck — suppress heuristic window (spec/07 §2 Edge cases)", () => {
  const T = 1_000_000;

  it("returns false when there are no markers", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [], shrinks: [] })).toBe(false);
  });

  it("returns true when a rewind marker ts is within (T − window, T] — inclusive upper bound", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [rewind(1, T)], shrinks: [] })).toBe(true);
  });

  it("returns true when a rewind marker ts is just inside the window (T − 1)", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [rewind(1, T - 1)], shrinks: [] })).toBe(true);
  });

  it("returns false when a rewind marker ts is at the lower boundary (T − window) — lower exclusive", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [rewind(1, T - NUDGE_TURN_WINDOW_MS)], shrinks: [] })).toBe(false);
  });

  it("returns false when a rewind marker ts is older than the window (T − window − 1)", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [rewind(1, T - NUDGE_TURN_WINDOW_MS - 1)], shrinks: [] })).toBe(false);
  });

  it("returns false when a rewind marker ts is in the future (T + 1) — strict upper bound", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [rewind(1, T + 1)], shrinks: [] })).toBe(false);
  });

  it("returns true when a SHRINK marker ts is within the window (not just rewinds)", () => {
    expect(suppressCheck(metric({ ts: T }), { rewinds: [], shrinks: [shrink(1, T)] })).toBe(true);
  });

  it("returns false when a rewind marker ts is non-finite (malformed) — treated as NOT in window", () => {
    const bad = rewind(1, Number.NaN) as RewindMarker & { ts: number };
    bad.ts = Number.NaN;
    expect(suppressCheck(metric({ ts: T }), { rewinds: [bad], shrinks: [] })).toBe(false);
  });

  it("returns true as soon as ANY marker (rewind or shrink) is in the window", () => {
    const oldRewind = rewind(1, T - NUDGE_TURN_WINDOW_MS - 1); // too old → not in window
    const freshShrink = shrink(2, T); // in window
    expect(suppressCheck(metric({ ts: T }), { rewinds: [oldRewind], shrinks: [freshShrink] })).toBe(true);
  });

  it("treats a non-finite metric.ts as 0 (defensive)", () => {
    // metric.ts = NaN → metricTs = 0 → lo = −window. A marker at ts=0 is in (−window, 0] → suppress.
    const m = metric({ ts: Number.NaN });
    expect(suppressCheck(m, { rewinds: [rewind(1, 0)], shrinks: [] })).toBe(true);
  });
});

// ── NUDGE_TURN_WINDOW_MS ────────────────────────────────────────────────────────────────────

describe("NUDGE_TURN_WINDOW_MS — exported constant (10 minutes)", () => {
  it("equals 10 minutes in milliseconds", () => {
    expect(NUDGE_TURN_WINDOW_MS).toBe(10 * 60 * 1000);
  });
});