import { describe, it, expect } from "vitest";
import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS } from "../src/nudges.js";
import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";
import type { MessageLike } from "../src/transforms.js";

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

describe("shouldNudge — pure gate (spec/07 §2)", () => {
  it("returns true when grewOverThreshold is true", () => {
    expect(shouldNudge(metric({ grewOverThreshold: true, bloatHit: false }), {} as never)).toBe(true);
  });

  it("returns true when bloatHit is true (even if grewOverThreshold is false)", () => {
    expect(shouldNudge(metric({ grewOverThreshold: false, bloatHit: true }), {} as never)).toBe(true);
  });

  it("returns false when both grewOverThreshold and bloatHit are false", () => {
    expect(shouldNudge(metric({ grewOverThreshold: false, bloatHit: false }), {} as never)).toBe(false);
  });

  it("returns a real boolean (false) for a malformed metric — === true robustness", () => {
    // readMarkers casts raw session data; a field could be undefined. === true yields a boolean, not undefined.
    const result = shouldNudge({} as TurnMetric, {} as never);
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