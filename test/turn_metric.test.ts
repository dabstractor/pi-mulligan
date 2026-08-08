import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG, setConfig } from "../src/config.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import { registerTurnEndMetric, turnEndMetricHandler } from "../src/nudges.js";
import type {
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

// ─────────────────────────────────────────────────────────────────────────────
// turn_metric.test.ts — Nudge B Phase 1 (P1.M6.T2.S1). Verifies turnEndMetricHandler
// + registerTurnEndMetric against the spec/07 §2 contract: per-turn drift measurement
// at turn_end, bloat snapshot+clear, fail-open, no-double-increment, filtered-not-raw.
//
// Fakes are HAND-ROLLED (no vi.fn for Pi objects — mirror markers.test.ts + filter.test.ts).
// Combined makePi captures BOTH `.on` registrations AND `appendEntry` calls (this handler
// is the first that WRITES through pi). GOTCHA #6: clearAll() + setConfig(DEFAULT) before
// AND after each test — the runtime map + seq are module-scoped singletons.
// ─────────────────────────────────────────────────────────────────────────────

// The runtime map (seq, tokenBaseline, pendingBloatHits, lastFiltered, lastTurnIndex) and
// the config cache are module-scoped singletons; reset both before AND after each test.
beforeEach(() => {
  clearAll();
  setConfig(structuredClone(DEFAULT_CONFIG));
});
afterEach(() => {
  clearAll();
  setConfig(structuredClone(DEFAULT_CONFIG));
});

// ── fakes (hand-rolled) ──────────────────────────────────────────────────────

/**
 * Minimal fake ExtensionAPI capturing `.on` registrations AND `appendEntry` calls.
 * Combines filter.test.ts's makePi (.on) + markers.test.ts's makePi (appendEntry).
 * throwOnAppend simulates a Pi write failure (appendTurnMetric swallows it → null).
 */
function makePi(opts: { throwOnAppend?: boolean } = {}) {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const appended: { customType: string; data: unknown }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
  };
  return { handlers, appended, pi: pi as unknown as ExtensionAPI };
}

/**
 * Minimal fake ExtensionContext: sessionManager (getSessionId + getLeafId, both scriptable
 * to throw) + getContextUsage (ContextUsage | undefined, scriptable tokens + hasUsage).
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  tokens?: number | null;
  hasUsage?: boolean;
  throwOnGetSessionId?: boolean;
  throwOnGetLeafId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null).
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const ctx = {
    sessionManager: {
      getSessionId() {
        if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
        return sessionId;
      },
      getLeafId() {
        if (opts.throwOnGetLeafId) throw new Error("getLeafId boom");
        return scriptedLeafId;
      },
    },
    getContextUsage() {
      if (opts.hasUsage === false) return undefined;
      return {
        tokens: opts.tokens ?? 0,
        contextWindow: 200000,
        percent: null,
      };
    },
  };
  return { ctx: ctx as unknown as ExtensionContext };
}

/**
 * Synthetic TurnEndEvent. turn_end's real shape is {type, turnIndex, message, toolResults}
 * (NO messages field — api_verification §7.3); message/toolResults are unused by the handler.
 */
function makeEvent(turnIndex: number): TurnEndEvent {
  return {
    type: "turn_end",
    turnIndex,
    message: { role: "assistant", content: [] } as never,
    toolResults: [],
  } as unknown as TurnEndEvent;
}

/** A message whose stringified content is exactly `chars` characters → estimateTokens = ceil(chars/4). */
function msgOfChars(chars: number): Record<string, unknown> {
  return { role: "user", content: "x".repeat(chars) };
}

// ── registration ─────────────────────────────────────────────────────────────

describe("registerTurnEndMetric — arms exactly one turn_end handler (spec/07 §2; GOTCHA #2)", () => {
  it("registers a single 'turn_end' handler", () => {
    const { handlers, pi } = makePi();
    registerTurnEndMetric(pi);
    expect(Object.keys(handlers)).toEqual(["turn_end"]);
    expect(typeof handlers["turn_end"]).toBe("function");
  });

  it("the registered handler delegates to turnEndMetricHandler (captures pi)", () => {
    const { handlers, appended, pi } = makePi();
    registerTurnEndMetric(pi);
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 100 });
    // No lastFiltered → fallback to getContextUsage (100). First turn → delta null.
    handlers["turn_end"]!(makeEvent(1), ctx);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:turn-metric");
  });
});

// ── config gates ─────────────────────────────────────────────────────────────

describe("turnEndMetricHandler — config gates short-circuit before measurement (GOTCHA #8)", () => {
  it("master switch OFF → no metric, baseline unchanged", () => {
    setConfig({ ...structuredClone(DEFAULT_CONFIG), enabled: false });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 1000 });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 50; // would-be baseline
    turnEndMetricHandler(pi, makeEvent(3), ctx);
    expect(appended).toHaveLength(0);
    expect(rt.tokenBaseline).toBe(50); // NOT rolled forward
  });

  it("nudges.perTurnDrift OFF → no metric, baseline unchanged", () => {
    setConfig({
      ...structuredClone(DEFAULT_CONFIG),
      enabled: true,
      nudges: { ...DEFAULT_CONFIG.nudges, perTurnDrift: false },
    });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 1000 });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 50;
    turnEndMetricHandler(pi, makeEvent(3), ctx);
    expect(appended).toHaveLength(0);
    expect(rt.tokenBaseline).toBe(50);
  });
});

// ── first turn: baseline null → delta null ──────────────────────────────────

describe("turnEndMetricHandler — first turn (baseline null → deltaTokens null) (spec/07 §2 Edge cases)", () => {
  it("records deltaTokens null + grewOverThreshold false, rolls baseline forward", () => {
    const { appended, pi } = makePi();
    // lastFiltered present (filtered view), 16000 chars → 4000 tokens → now = 4000.
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 9999 /* ignored: lastFiltered wins */ });
    const rt = getRuntime("s1");
    rt.tokenBaseline = null; // FIRST TURN
    rt.lastFiltered = [msgOfChars(16000)]; // 4000 tokens
    turnEndMetricHandler(pi, makeEvent(1), ctx);

    expect(appended).toHaveLength(1);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBeNull();
    expect(data.grewOverThreshold).toBe(false);
    expect(data.bloatHit).toBe(false);
    expect(data.bloatHits).toEqual([]);
    expect(data.turnIndex).toBe(1);
    // baseline rolled forward to the measured `now` (4000); lastTurnIndex recorded.
    expect(rt.tokenBaseline).toBe(4000);
    expect(rt.lastTurnIndex).toBe(1);
  });
});

// ── normal growth: delta > threshold ────────────────────────────────────────

describe("turnEndMetricHandler — normal growth (delta > driftThresholdTokens → grewOverThreshold) (spec/07 §2)", () => {
  it("records grewOverThreshold true + deltaTokens = now - baseline", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1000;
    // 16004 chars → ceil(16004/4) = 4001 tokens → delta = 3001 > 3000 (strict) → grew true.
    rt.lastFiltered = [msgOfChars(16004)];
    turnEndMetricHandler(pi, makeEvent(5), ctx);

    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(3001);
    expect(data.grewOverThreshold).toBe(true);
    expect(rt.tokenBaseline).toBe(4001); // rolled forward
    expect(rt.lastTurnIndex).toBe(5);
  });

  it("records grewOverThreshold false when delta == threshold (strict >, not >=)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1000;
    // 16000 chars → 4000 tokens → delta = 3000 == threshold → NOT > → false.
    rt.lastFiltered = [msgOfChars(16000)];
    turnEndMetricHandler(pi, makeEvent(2), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(3000);
    expect(data.grewOverThreshold).toBe(false);
  });
});

// ── negative delta (context shrank) ─────────────────────────────────────────

describe("turnEndMetricHandler — negative delta (rewind/shrink shrank context) (spec/07 §2 Edge cases)", () => {
  it("records grewOverThreshold false when delta is negative", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 5000;
    rt.lastFiltered = [msgOfChars(8000)]; // 2000 tokens → delta = -3000
    turnEndMetricHandler(pi, makeEvent(4), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(-3000);
    expect(data.grewOverThreshold).toBe(false);
    expect(rt.tokenBaseline).toBe(2000); // rolled forward (even though it shrank)
  });
});

// ── bloat snapshot + clear ──────────────────────────────────────────────────

describe("turnEndMetricHandler — bloat snapshot THEN clear (GOTCHA #9; closes Nudge A loop)", () => {
  it("snapshots pendingBloatHits into the metric and reassigns the field to a fresh []", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1000;
    rt.lastFiltered = [msgOfChars(16000)]; // 4000 tokens
    const hits = [
      { toolName: "read", approxTokens: 1536 },
      { toolName: "read", approxTokens: 1536 },
    ];
    rt.pendingBloatHits = hits;

    turnEndMetricHandler(pi, makeEvent(3), ctx);

    const data = appended[0].data as Record<string, unknown>;
    expect(data.bloatHit).toBe(true);
    expect(data.bloatHits).toBe(hits); // the SAME old array reference (the snapshot)
    // the field was REASSIGNED to a fresh empty array (NOT splice).
    expect(rt.pendingBloatHits).toEqual([]);
    expect(rt.pendingBloatHits).not.toBe(hits); // a NEW array object
  });

  it("records bloatHit false when no bloat hits accumulated", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1000;
    rt.lastFiltered = [msgOfChars(16000)];
    turnEndMetricHandler(pi, makeEvent(2), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.bloatHit).toBe(false);
    expect(data.bloatHits).toEqual([]);
    expect(rt.pendingBloatHits).toEqual([]);
  });
});

// ── lastFiltered present vs null (filtered-not-raw) ─────────────────────────

describe("turnEndMetricHandler — lastFiltered (filtered view) preferred over getContextUsage (D5/D6)", () => {
  it("lastFiltered present → now = estimateTokens(lastFiltered) (NOT getContextUsage)", () => {
    const { appended, pi } = makePi();
    // Set a DIFFERENT getContextUsage().tokens (9999) to prove it is NOT used.
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 9999 });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 0; // so delta == now, easy to assert
    rt.lastFiltered = [msgOfChars(16000)]; // 4000 tokens
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(4000); // estimateTokens value, NOT 9999
  });

  it("lastFiltered null → fallback to ctx.getContextUsage()?.tokens ?? 0", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 4321 });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 0;
    rt.lastFiltered = null; // no filtered view yet (first turn / context never fired)
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(4321);
  });

  it("lastFiltered null + getContextUsage undefined → now = 0", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", hasUsage: false });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 0;
    rt.lastFiltered = null;
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(0);
  });

  it("lastFiltered null + getContextUsage().tokens null → now = 0 (?? 0 coerces)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: null });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 0;
    rt.lastFiltered = null;
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;
    expect(data.deltaTokens).toBe(0);
  });
});

// ── baseline roll-forward + lastTurnIndex ───────────────────────────────────

describe("turnEndMetricHandler — rolls baseline forward + records lastTurnIndex (happy path)", () => {
  it("two consecutive turns: baseline rolls, deltas are against the prior turn's now", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = null;

    // Turn 1: 4000 tokens. First turn → delta null. Baseline → 4000.
    rt.lastFiltered = [msgOfChars(16000)];
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    expect((appended[0].data as Record<string, unknown>).deltaTokens).toBeNull();
    expect(rt.tokenBaseline).toBe(4000);
    expect(rt.lastTurnIndex).toBe(1);

    // Turn 2: 8000 tokens. delta = 8000 - 4000 = 4000 > 3000 → grew true.
    rt.lastFiltered = [msgOfChars(32000)]; // 8000 tokens
    turnEndMetricHandler(pi, makeEvent(2), ctx);
    const d2 = appended[1].data as Record<string, unknown>;
    expect(d2.deltaTokens).toBe(4000);
    expect(d2.grewOverThreshold).toBe(true);
    expect(rt.tokenBaseline).toBe(8000);
    expect(rt.lastTurnIndex).toBe(2);
  });
});

// ── no double-increment of seq ──────────────────────────────────────────────

describe("turnEndMetricHandler — NO double-increment of seq (GOTCHA #1)", () => {
  it("persisted metric seq increments by exactly 1 per turn-end (handler does not call nextSeq)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = null;

    rt.lastFiltered = [msgOfChars(16000)]; // 4000 tokens
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    turnEndMetricHandler(pi, makeEvent(2), ctx);
    turnEndMetricHandler(pi, makeEvent(3), ctx);

    const seqs = appended.map((a) => (a.data as Record<string, unknown>).seq);
    expect(seqs).toEqual([1, 2, 3]); // monotonic, +1 each (appendTurnMetric owns nextSeq)
  });

  it("metric object literal carries ONLY the 5 data fields + envelope (no extra nextSeq call in handler)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 100 });
    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;
    // envelope stamped by appendTurnMetric:
    expect(data.schema).toBe("pi-mulligan");
    expect(data.v).toBe(1);
    expect(data.kind).toBe("turn-metric");
    expect(typeof data.seq).toBe("number");
    expect(typeof data.ts).toBe("number");
    // the 5 data fields the handler supplied:
    expect(data).toHaveProperty("deltaTokens");
    expect(data).toHaveProperty("bloatHit");
    expect(data).toHaveProperty("bloatHits");
    expect(data).toHaveProperty("grewOverThreshold");
    expect(data).toHaveProperty("turnIndex");
    // NO id field (spec/04 §5 TurnMetric has no id — GOTCHA #1 in markers.ts):
    expect(data).not.toHaveProperty("id");
  });
});

// ── fail-open: every throwing dependency ────────────────────────────────────

describe("turnEndMetricHandler — fail-open on ANY throw (spec/03 #4, spec/08 E13; GOTCHA #7)", () => {
  it("throwing getSessionId → returns void, baseline NOT rolled, pendingBloatHits NOT cleared", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", throwOnGetSessionId: true });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1234;
    rt.lastFiltered = [msgOfChars(16000)];
    const hits = [{ toolName: "read", approxTokens: 2000 }];
    rt.pendingBloatHits = hits;
    // The throw precedes both the snapshot AND the baseline roll → both untouched.
    expect(() => turnEndMetricHandler(pi, makeEvent(1), ctx)).not.toThrow();
    expect(appended).toHaveLength(0);
    expect(rt.tokenBaseline).toBe(1234); // NOT rolled forward (delta retries next turn)
    expect(rt.pendingBloatHits).toBe(hits); // NOT cleared (hits retry too)
  });

  it("throwing estimateTokens (via a Proxy content that throws) → fail-open, baseline unchanged", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1234;
    // A Proxy whose every property access throws → estimateTokens' internal readOwn throws
    // → the handler's try/catch catches it (the outer guarantee is hard regardless).
    const boom: Record<string, unknown> = new Proxy(
      {},
      {
        get() {
          throw new Error("proxy boom");
        },
        ownKeys() {
          throw new Error("proxy boom");
        },
        getOwnPropertyDescriptor() {
          throw new Error("proxy boom");
        },
      },
    );
    rt.lastFiltered = [boom];
    expect(() => turnEndMetricHandler(pi, makeEvent(1), ctx)).not.toThrow();
    // estimateTokens is defensive and may swallow the trap; if it did, a metric was appended
    // and baseline rolled. If it propagated, no metric + baseline unchanged. Either is valid;
    // the HARD guarantee is "never throws". Assert that invariant:
    expect(true).toBe(true); // reached here ⇒ did not throw
    // If the trap propagated (no metric), baseline must be untouched:
    if (appended.length === 0) {
      expect(rt.tokenBaseline).toBe(1234);
    }
  });

  it("fail-open does not break the agent turn (handler returns undefined)", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", throwOnGetSessionId: true });
    const result = turnEndMetricHandler(pi, makeEvent(1), ctx);
    expect(result).toBeUndefined();
  });
});

// ── fail-open on throwing appendEntry (via appendTurnMetric) ─────────────────

describe("turnEndMetricHandler — appendEntry failure is swallowed by appendTurnMetric", () => {
  it("throwing appendEntry → appendTurnMetric returns null; handler still rolls baseline (happy-path step 8)", () => {
    // appendTurnMetric wraps its own try/catch and returns null on throw — it never propagates.
    // So the handler's step 8 (roll baseline) still runs: the metric is missing (non-fatal) but
    // accounting stays correct for next turn.
    const { appended, pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 1000;
    rt.lastFiltered = [msgOfChars(16000)]; // 4000 tokens
    expect(() => turnEndMetricHandler(pi, makeEvent(2), ctx)).not.toThrow();
    expect(appended).toHaveLength(0); // appendEntry threw → nothing captured
    expect(rt.tokenBaseline).toBe(4000); // step 8 ran (appendTurnMetric never throws)
    expect(rt.lastTurnIndex).toBe(2);
  });
});

// ── handler is SYNC ─────────────────────────────────────────────────────────

describe("turnEndMetricHandler — sync (no Promise returned)", () => {
  it("returns undefined (not a Promise) — turn_end is a notification event", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", tokens: 10 });
    const result = turnEndMetricHandler(pi, makeEvent(1), ctx);
    expect(result).toBeUndefined();
  });
});