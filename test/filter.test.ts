import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock transforms.js BEFORE importing filter.js so filter.ts's `import { filterPipeline }` resolves to
// the fake. The factory returns a controllable fake + a captured-calls array (GOTCHA #13: vi.mock for an
// internal pure module is idiomatic; the "hand-rolled" convention is about Pi OBJECTS).
const pipelineCalls: {
  messages: unknown[];
  markers: unknown;
  config: unknown;
  branchEntries: unknown[];
}[] = [];
let pipelineReturn: unknown[] | ((...args: unknown[]) => unknown[]) = [];
// resolvePinnedShrink override for the stale-retirement tests. Default returns null (target absent) so a
// pinned shrink with a staleAfterFires threshold WILL retire. Tests that need a "hit" (target present) set
// this to () => 0 (a non-null index); tests that need a throw set it to a throwing fn. See PRP Task 7 GOTCHA.
let resolvePinnedShrinkReturn: ((...args: unknown[]) => number | null) | null = null;
vi.mock("../src/transforms.js", () => ({
  filterPipeline: (messages: unknown[], markers: unknown, config: unknown, branchEntries: unknown[]) => {
    pipelineCalls.push({ messages, markers, config, branchEntries });
    return typeof pipelineReturn === "function"
      ? pipelineReturn(messages, markers, config, branchEntries)
      : pipelineReturn;
  },
  resolvePinnedShrink: (...args: unknown[]) => {
    if (resolvePinnedShrinkReturn === null) return null; // default: target ABSENT (stale)
    return resolvePinnedShrinkReturn(...args);
  },
  // stableSortBySeq — faithful fake of the real transforms.js export (ascending by seq, missing/non-finite
  // → 0, stable). Needed by the soft-cap path (P3.M2.T3.S2) which calls stableSortBySeq to find the oldest
  // (lowest seq) shrink. Mocked here so filter.ts's VALUE import resolves (the factory replaces the module).
  stableSortBySeq: <T extends { seq?: unknown }>(markers: T[]): T[] => {
    if (!Array.isArray(markers)) return [];
    const seqOf = (m: unknown): number => {
      const s = (m as { seq?: unknown })?.seq;
      return typeof s === "number" && Number.isFinite(s) ? s : 0;
    };
    return [...markers].sort((a, b) => seqOf(a) - seqOf(b));
  },
}));

import { setConfig } from "../src/config.js";
import {
  readMarkers,
  contextHandler,
  registerFilterHandler,
  type MarkersBundle,
} from "../src/filter.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import type { ContextEvent, ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// runtime map reset between tests (mirror test/runtime.test.ts GOTCHA #7). Also reset the pipeline mock.
beforeEach(() => {
  clearAll();
  pipelineCalls.length = 0;
  pipelineReturn = [];
  resolvePinnedShrinkReturn = null;
});
afterEach(() => {
  clearAll();
  pipelineCalls.length = 0;
  pipelineReturn = [];
  resolvePinnedShrinkReturn = null;
});

// ── fakes (hand-rolled, no vi.fn for Pi objects — mirror markers.test.ts) ────────────────────

/** Build a rewind marker `data` payload matching markers.ts's envelope (kind 'rewind'). */
function rewindData(seq: number, id = `rw-${seq}`): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "rewind", id, granularity: "last_tool_call_group",
    options: {}, seq, note: { problem: "p", hypothesis: "h", nextStep: "n", evidence: "e" }, ledger: {}, ts: 1 };
}
function shrinkData(seq: number, id = `sh-${seq}`): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "shrink", id, target: { by_tool_call_id: "c1" },
    replacement: "<shrunk>", seq, ts: 1 };
}
/** A PINNED shrink (carries a stable pinnedEntryId) — the only kind eligible for stale retirement (E15). */
function pinnedShrinkData(seq: number, id: string, pinnedEntryId: string): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "shrink", id, target: { by_tool_call_id: "c1" },
    replacement: "<shrunk>", pinnedEntryId, seq, ts: 1 };
}
function metricData(seq: number, grew = false, bloat = false): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 7000 : 100,
    bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
}
/** A custom entry (marker). type 'custom' → NOT in context. */
function customEntry(customType: string, data: unknown): SessionEntry {
  return { type: "custom", id: `e-${customType}-${Math.random()}`, parentId: null,
    timestamp: new Date().toISOString(), customType, data } as unknown as SessionEntry;
}

/** A cancel marker `data` payload (kind 'cancel'; customType 'mulligan:cancel'). */
function cancelData(targetId: string): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq: 0, ts: 1 };
}
/** Convenience: a mulligan:cancel custom entry targeting the given marker uuid id. */
function makeCancelEntry(targetId: string): SessionEntry {
  return customEntry("mulligan:cancel", cancelData(targetId));
}

/** Minimal fake ExtensionContext: scripts getSessionId + getEntries + getBranch (all read FRESH — C12).
 *  OPTIONAL getContextUsage override (default ABSENT) for the high-water tests (P3.M3.T6.S1): the default has
 *  NO such method, so filter.ts's `ctx.getContextUsage?.()` is undefined → windowTokens=0 → shouldHighWater
 *  fail-opens to false → the high-water block is a no-op in every pre-existing test (keeps the suite green). */
function makeCtx(opts: {
  sessionId?: string;
  entries?: SessionEntry[];
  branch?: SessionEntry[];
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
  throwOnGetSessionId?: boolean;
  getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const sessionManager = {
    getSessionId() {
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return opts.entries ?? [];
    },
    getBranch() {
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return opts.branch ?? [];
    },
  };
  // Build the ctx WITHOUT getContextUsage by default (the optional chain in filter.ts handles its absence).
  // Attach getContextUsage ONLY when the opt is provided so the default behavior is byte-identical to before.
  const ctx: { sessionManager: unknown; getContextUsage?: () => unknown } = { sessionManager };
  if (opts.getContextUsage !== undefined) ctx.getContextUsage = opts.getContextUsage;
  return ctx as unknown as ExtensionContext;
}

/** Minimal fake ExtensionAPI capturing `.on` registrations + `.appendEntry` calls. */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const appendCalls: { customType: string; data: unknown }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
    appendEntry(customType: string, data: unknown) {
      appendCalls.push({ customType, data });
    },
  };
  return { handlers, appendCalls, pi: pi as unknown as ExtensionAPI };
}

// ── readMarkers ─────────────────────────────────────────────────────────────────────────────

describe("readMarkers — fresh read, bucket, latest metric (spec/06 §1, api_verification §5)", () => {
  it("returns an empty bundle for an empty entry stream", () => {
    const bundle = readMarkers(makeCtx({ entries: [] }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.shrinks).toEqual([]);
    expect(bundle.metric).toBeNull();
    expect(bundle.recentMetrics).toEqual([]);
  });

  it("buckets mulligan:rewind and mulligan:shrink custom entries", () => {
    const entries = [customEntry("mulligan:rewind", rewindData(1)), customEntry("mulligan:shrink", shrinkData(2))];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect(bundle.shrinks).toHaveLength(1);
    expect((bundle.rewinds[0] as { seq: number }).seq).toBe(1);
    expect((bundle.shrinks[0] as { seq: number }).seq).toBe(2);
  });

  it("keeps only the LATEST turn-metric (highest seq)", () => {
    const entries = [
      customEntry("mulligan:turn-metric", metricData(1)),
      customEntry("mulligan:turn-metric", metricData(3, true)),
      customEntry("mulligan:turn-metric", metricData(2)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.metric).not.toBeNull();
    expect((bundle.metric as { seq: number }).seq).toBe(3);
    expect(bundle.recentMetrics).toHaveLength(3);
    expect((bundle.recentMetrics[0] as { seq: number }).seq).toBe(3); // newest-first
    expect(bundle.metric).toBe(bundle.recentMetrics[0]);              // latest === recentMetrics[0]
  });

  it("ignores custom_message (notes) and label (checkpoints) — type!=='custom'", () => {
    const entries = [
      { type: "custom_message", customType: "mulligan:note", content: "NOTE", display: true,
        details: {}, id: "n1", parentId: null, timestamp: "" } as unknown as SessionEntry,
      { type: "label", label: "mulligan:checkpoint:x", targetId: "t", id: "l1", parentId: null,
        timestamp: "" } as unknown as SessionEntry,
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.shrinks).toEqual([]);
    expect(bundle.metric).toBeNull();
  });

  it("skips malformed/unknown mulligan:* entries without throwing", () => {
    const entries = [
      customEntry("mulligan:rewind", { kind: "shrink" }),        // wrong kind → skip
      customEntry("mulligan:future", { kind: "x" }),             // unknown customType → skip
      customEntry("mulligan:rewind", null),                       // non-record data → skip
      customEntry("mulligan:rewind", rewindData(5)),             // valid → kept
      customEntry("mulligan:cancel", { kind: "shrink" }),        // cancel w/ wrong kind → skip (P3.M1.T2.S1)
      { type: "other", customType: "mulligan:rewind", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry,
    ];
    expect(() => readMarkers(makeCtx({ entries }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect((bundle.rewinds[0] as { seq: number }).seq).toBe(5);
    expect(bundle.cancelledIds.size).toBe(0); // wrong-kind cancel not collected
  });

  it("never throws when getEntries throws (fail-open → empty bundle)", () => {
    expect(() => readMarkers(makeCtx({ throwOnGetEntries: true }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ throwOnGetEntries: true }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.metric).toBeNull();
    expect(bundle.cancelledIds).toBeInstanceOf(Set); // cancelledIds always present (catch path)
    expect(bundle.cancelledIds.size).toBe(0);
    expect(bundle.recentMetrics).toEqual([]); // recentMetrics always present on the fail-open path
  });
});

// ── readMarkers — cancel-drop (marker retraction, spec/08 E21) ──────────────────────────────

describe("readMarkers — cancel-drop (marker retraction, spec/08 E21)", () => {
  it("cancelling a shrink drops it from shrinks and records its id in cancelledIds", () => {
    const entries = [
      customEntry("mulligan:shrink", shrinkData(1, "sh-1")),
      makeCancelEntry("sh-1"),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.shrinks).toHaveLength(0);
    expect(bundle.cancelledIds).toEqual(new Set(["sh-1"]));
  });

  it("cancelling a rewind drops it from rewinds and records its id", () => {
    const entries = [
      customEntry("mulligan:rewind", rewindData(1, "rw-1")),
      makeCancelEntry("rw-1"),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(0);
    expect(bundle.cancelledIds).toEqual(new Set(["rw-1"]));
  });

  it("cancelling a non-existent id drops no markers (safe no-op)", () => {
    const entries = [
      customEntry("mulligan:rewind", rewindData(1, "rw-1")),
      customEntry("mulligan:shrink", shrinkData(2, "sh-2")),
      makeCancelEntry("nope"),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect(bundle.shrinks).toHaveLength(1);
    expect(bundle.cancelledIds).toEqual(new Set(["nope"])); // id still recorded
  });

  it("multiple cancels drop all targeted markers; untargeted markers survive", () => {
    const entries = [
      customEntry("mulligan:rewind", rewindData(1, "rw-1")),
      customEntry("mulligan:rewind", rewindData(2, "rw-2")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-keep")),
      makeCancelEntry("rw-1"),
      makeCancelEntry("sh-3"),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds.map(m => (m as { id: string }).id)).toEqual(["rw-2"]);
    expect(bundle.shrinks.map(m => (m as { id: string }).id)).toEqual(["sh-keep"]);
    expect(bundle.cancelledIds).toEqual(new Set(["rw-1", "sh-3"]));
  });

  it("drop is order-independent: a cancel BEFORE its target still drops it", () => {
    const entries = [
      makeCancelEntry("sh-1"),
      customEntry("mulligan:shrink", shrinkData(1, "sh-1")),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.shrinks).toHaveLength(0);
    expect(bundle.cancelledIds).toEqual(new Set(["sh-1"]));
  });

  it("skips malformed cancel entries (non-string/empty/missing targetId) without throwing", () => {
    const entries = [
      customEntry("mulligan:cancel", { schema: "pi-mulligan", v: 1, kind: "cancel", targetId: 123, seq: 0, ts: 1 }), // non-string
      customEntry("mulligan:cancel", { schema: "pi-mulligan", v: 1, kind: "cancel", targetId: "", seq: 0, ts: 1 }),   // empty
      customEntry("mulligan:cancel", { schema: "pi-mulligan", v: 1, kind: "cancel", seq: 0, ts: 1 }),                  // missing
    ];
    expect(() => readMarkers(makeCtx({ entries }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.cancelledIds.size).toBe(0);
    expect(bundle.rewinds).toHaveLength(0); // malformed cancels never pushed into marker arrays
    expect(bundle.shrinks).toHaveLength(0);
  });

  it("cancelledIds is always a (possibly empty) Set on the bundle", () => {
    const bundle = readMarkers(makeCtx({ entries: [] }));
    expect(bundle.cancelledIds).toBeInstanceOf(Set);
    expect(bundle.cancelledIds.size).toBe(0);
    // also covers the getEntries-threw catch path
    const thrownBundle = readMarkers(makeCtx({ throwOnGetEntries: true }));
    expect(thrownBundle.cancelledIds).toBeInstanceOf(Set);
    expect(thrownBundle.cancelledIds.size).toBe(0);
  });

  it("does NOT drop a marker lacking a readable id field (defensive — keep on bad data)", () => {
    // rewind `data` with NO id field + a cancel targeting an unrelated id → kept (id unreadable)
    const noIdRewind = { schema: "pi-mulligan", v: 1, kind: "rewind",
      granularity: "last_tool_call_group", options: {}, seq: 1,
      note: { problem: "p", hypothesis: "h", nextStep: "n", evidence: "e" }, ledger: {}, ts: 1 };
    const entries = [
      customEntry("mulligan:rewind", noIdRewind),
      makeCancelEntry("anything"),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1); // kept — id unreadable, never dropped on bad data
    expect(bundle.cancelledIds).toEqual(new Set(["anything"]));
  });
});

// ── readMarkers — recentMetrics window (P3.M3.T3.S1 / spec/07 §5.1) ───────────────────────────

describe("readMarkers — recentMetrics window (P3.M3.T3.S1 / spec/07 §5.1)", () => {
  it("exposes recentMetrics sorted NEWEST-FIRST (highest seq at index 0)", () => {
    const entries = [
      customEntry("mulligan:turn-metric", metricData(1)),
      customEntry("mulligan:turn-metric", metricData(3, true)),
      customEntry("mulligan:turn-metric", metricData(2)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.recentMetrics).toHaveLength(3);
    expect(bundle.recentMetrics.map(m => (m as { seq: number }).seq)).toEqual([3, 2, 1]); // descending
  });

  it("metric (latest) === recentMetrics[0] (backward compat)", () => {
    const entries = [
      customEntry("mulligan:turn-metric", metricData(1)),
      customEntry("mulligan:turn-metric", metricData(3, true)),
      customEntry("mulligan:turn-metric", metricData(2)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.metric).not.toBeNull();
    expect(bundle.metric).toBe(bundle.recentMetrics[0]);              // SAME object (toBe), not a copy
    expect((bundle.metric as { seq: number }).seq).toBe(3);
  });

  it("recentMetrics contains ALL turn-metrics on the branch (readMarkers does NOT slice)", () => {
    const entries = [
      customEntry("mulligan:turn-metric", metricData(1)),
      customEntry("mulligan:turn-metric", metricData(2)),
      customEntry("mulligan:turn-metric", metricData(3)),
      customEntry("mulligan:turn-metric", metricData(4)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.recentMetrics).toHaveLength(4); // full array — NO slicing to driftWindowTurns here
    expect(bundle.recentMetrics.map(m => (m as { seq: number }).seq)).toEqual([4, 3, 2, 1]);
  });

  it("recentMetrics is always an array (empty when no turn-metrics; [] on getEntries-throws)", () => {
    const empty = readMarkers(makeCtx({ entries: [] }));
    expect(Array.isArray(empty.recentMetrics)).toBe(true);
    expect(empty.recentMetrics).toEqual([]);
    const thrown = readMarkers(makeCtx({ throwOnGetEntries: true }));
    expect(Array.isArray(thrown.recentMetrics)).toBe(true);
    expect(thrown.recentMetrics).toEqual([]); // fail-open path → []
  });

  it("defensive: a turn-metric with a non-number seq is INCLUDED (sorted to the end)", () => {
    const malformed = { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq: "oops", ts: 1,
      deltaTokens: 1, bloatHit: false, bloatHits: [], grewOverThreshold: false, turnIndex: 0 };
    const entries = [
      customEntry("mulligan:turn-metric", metricData(5)),
      customEntry("mulligan:turn-metric", malformed),   // non-number seq → coerced to -Infinity → end
      customEntry("mulligan:turn-metric", metricData(10)),
    ];
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.recentMetrics).toHaveLength(3);                       // malformed still included
    expect((bundle.recentMetrics[0] as { seq: number }).seq).toBe(10);  // valid highest first
    expect((bundle.recentMetrics[1] as { seq: number }).seq).toBe(5);   // valid next
    expect(bundle.recentMetrics[2]).toBe(malformed);                    // malformed last (same object)
  });
});

// ── contextHandler ──────────────────────────────────────────────────────────────────────────

describe("contextHandler — disabled pass-through, transform+cache, fail-open (spec/06 §1, §03 #4)", () => {
  it("returns undefined (pass-through) and does NOT cache when config.enabled is false", () => {
    // getConfig reads the cached config; default is enabled:true. Force-disable via setConfig (top-level import).
    setConfig({ enabled: false });
    const { pi } = makePi();
    const ctx = makeCtx({ sessionId: "dis" });
    const event = { type: "context" as const, messages: [{ role: "user", content: "hi" }] } as unknown as ContextEvent;
    const result = contextHandler(pi, event, ctx);
    expect(result).toBeUndefined(); // void = pass-through (C4)
    expect(getRuntime("dis").lastFiltered).toBeNull(); // cache untouched
    setConfig({ enabled: true }); // restore default
  });

  it("delegates to filterPipeline with (messages, markers, config, branchEntries) and returns {messages}", () => {
    const { pi } = makePi();
    const filtered = [{ role: "user", content: "FILTERED" }];
    pipelineReturn = filtered;
    const branch = [{ type: "message", id: "b1", parentId: null, timestamp: "" } as unknown as SessionEntry];
    const ctx = makeCtx({ sessionId: "s2", entries: [customEntry("mulligan:rewind", rewindData(1))], branch });
    const event = { type: "context" as const, messages: [{ role: "user", content: "orig" }] } as unknown as ContextEvent;

    const result = contextHandler(pi, event, ctx) as { messages: unknown[] };

    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0].messages).toBe(event.messages);          // passes event.messages
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(1); // readMarkers result
    expect(pipelineCalls[0].branchEntries).toBe(branch);            // passes getBranch() fresh
    expect(result.messages).toBe(filtered);                          // returns filterPipeline's result
  });

  it("caches the filtered view in rt.lastFiltered + sets lastFilterTs (spec/06 §7)", () => {
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const ctx = makeCtx({ sessionId: "s3" });
    contextHandler(pi, { type: "context", messages: [] }, ctx);
    const rt = getRuntime("s3");
    expect(rt.lastFiltered).toEqual([{ role: "user", content: "F" }]);
    expect(rt.lastFilterTs).not.toBeNull();
  });

  it("reads ctx.sessionManager FRESH each fire (no module-scope cache)", () => {
    const { pi } = makePi();
    pipelineReturn = [];
    // Mutable live arrays the fake reads on EACH call — proves the handler does not cache the handle.
    const live: { entries: SessionEntry[]; branch: SessionEntry[] } = { entries: [], branch: [] };
    const ctx = {
      sessionManager: {
        getSessionId: () => "s4",
        getEntries: () => live.entries,
        getBranch: () => live.branch,
      },
    } as unknown as ExtensionContext;

    // Fire 1: empty markers + empty branch.
    contextHandler(pi, { type: "context", messages: [] }, ctx);
    expect(pipelineCalls[0].branchEntries).toEqual([]);
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(0);

    // Fire 2: mutate the LIVE arrays — the handler must see the new data (fresh read).
    live.entries = [customEntry("mulligan:rewind", rewindData(9))];
    live.branch = [{ type: "message", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry];
    contextHandler(pi, { type: "context", messages: [] }, ctx);
    expect((pipelineCalls[1].markers as MarkersBundle).rewinds).toHaveLength(1); // saw the NEW marker
    expect(pipelineCalls[1].branchEntries).toHaveLength(1);                      // saw the NEW branch
  });

  // §5.3 acceptance (b): >threshold + no action → fires normally (integration-level mirror).
  it("injects the drift nudge when shouldNudge(metric) is true and not suppressed", () => {
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "P" }];
    const ctx = makeCtx({ sessionId: "s5", entries: [customEntry("mulligan:turn-metric", metricData(1, true))] });
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx) as { messages: unknown[] };
    // shouldNudge true (grewOverThreshold) + no markers → not suppressed → 1 nudge appended to the END.
    expect(result.messages).toHaveLength(2);
    const last = result.messages[1] as Record<string, unknown>;
    expect(last.role).toBe("custom");
    expect(last.customType).toBe("mulligan:nudge");
    expect(last.display).toBe(false);
    expect(typeof last.content).toBe("string");
  });

  // §5.3 acceptance (c): >threshold + same-turn rewind → suppressed (integration-level mirror).
  //     (§5.3 acceptance (a) [shrink] is covered at the unit tier in test/drift_nudge.test.ts.)
  it("does NOT inject the drift nudge when suppressed by a same-turn rewind marker", () => {
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "P" }];
    // metric.ts=1 + rewind.ts=1 → 1 ∈ (1 − window, 1] → suppressed (shouldNudge true but suppress wins).
    const ctx = makeCtx({
      sessionId: "s5b",
      entries: [
        customEntry("mulligan:turn-metric", metricData(1, true)),
        customEntry("mulligan:rewind", rewindData(2)),
      ],
    });
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(1); // no nudge
  });

  it("does NOT inject the drift nudge when shouldNudge is false (no growth, no bloat)", () => {
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "P" }];
    const ctx = makeCtx({ sessionId: "s5c", entries: [customEntry("mulligan:turn-metric", metricData(1, false, false))] });
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(1); // no nudge
  });

  it("does NOT inject the drift nudge for the remainder of a turn in which a rewind was refused (P4.M1.T2.S3)", () => {
    // A rewind was refused THIS turn (turnIndex 1, matching the latest metric) → filter must mute Nudge B
    // for the rest of the turn. shouldNudge would fire (grew=true) but the refused-rewind flag wins.
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "P" }];
    const sessionId = "s5d";
    const ctx = makeCtx({ sessionId, entries: [customEntry("mulligan:turn-metric", metricData(1, true))] });
    getRuntime(sessionId).rewindRefusedTurnIndex = 1; // latch: a rewind was refused at turnIndex 1
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(1); // no nudge — muted by the refused-rewind flag
  });

  it("clears the flag and re-enables the nudge once the turn advances (P4.M1.T2.S3)", () => {
    // Flag latched to an OLD turnIndex (7); latest metric is now turnIndex 8 (advanced) → clear + nudge fires.
    const { pi } = makePi();
    pipelineReturn = [{ role: "user", content: "P" }];
    const sessionId = "s5e";
    const ctx = makeCtx({ sessionId, entries: [customEntry("mulligan:turn-metric", metricData(8, true))] });
    getRuntime(sessionId).rewindRefusedTurnIndex = 7; // stale: refused at a PRIOR turn
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(2); // nudge re-enabled (flag cleared: 7 !== 8)
    expect(getRuntime(sessionId).rewindRefusedTurnIndex).toBeNull(); // cleared on turn advance
  });

  it("fail-open: a throwing filterPipeline is caught, logged, and returns undefined (pass-through)", () => {
    const { pi } = makePi();
    pipelineReturn = () => { throw new Error("pipeline boom"); };
    const ctx = makeCtx({ sessionId: "s6", entries: [customEntry("mulligan:rewind", rewindData(1))] });
    expect(() => contextHandler(pi, { type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler(pi, { type: "context", messages: [] }, ctx)).toBeUndefined();
  });

  it("fail-open: a throwing getSessionId is caught and returns undefined", () => {
    const { pi } = makePi();
    pipelineReturn = [];
    const ctx = makeCtx({ sessionId: "s7", throwOnGetSessionId: true });
    expect(() => contextHandler(pi, { type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler(pi, { type: "context", messages: [] }, ctx)).toBeUndefined();
  });
});

// ── registerFilterHandler ───────────────────────────────────────────────────────────────────

describe("registerFilterHandler — arms pi.on('context', contextHandler)", () => {
  it("calls pi.on('context', <function>) exactly once", () => {
    const { handlers, pi } = makePi();
    registerFilterHandler(pi);
    expect(typeof handlers["context"]).toBe("function");
  });

  it("the registered handler is contextHandler (delegates to filterPipeline)", () => {
    pipelineReturn = [{ role: "user", content: "Z" }];
    const { handlers, pi } = makePi();
    registerFilterHandler(pi);
    const ctx = makeCtx({ sessionId: "s8", entries: [customEntry("mulligan:rewind", rewindData(1))] });
    const result = (handlers["context"] as (e: unknown, c: unknown) => unknown)(
      { type: "context", messages: [] }, ctx,
    ) as { messages: unknown[] };
    expect(result.messages).toEqual([{ role: "user", content: "Z" }]);
    expect(pipelineCalls).toHaveLength(1);
  });
});

// ── contextHandler — stale-marker retirement (P3.M2.T3.S1 / spec/08 E15) ─────────────────────
// A PINNED shrink whose target ENTRY has been absent for config.shrink.staleAfterFires (default 3)
// consecutive fires is auto-retired: a mulligan:cancel is appended (the SAME retraction primitive the
// mulligan_cancel tool uses). resolvePinnedShrink is mocked (null = absent by default; override per-test).

describe("contextHandler — stale-marker retirement (P3.M2.T3.S1 / spec/08 E15)", () => {
  it("retires a pinned shrink absent for staleAfterFires consecutive fires (appends mulligan:cancel)", () => {
    // staleAfterFires default = 3. resolvePinnedShrink defaults to null (target absent) → miss each fire.
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [customEntry("mulligan:shrink", pinnedShrinkData(1, "sh-1", "entry-gone"))];
    const ctx = makeCtx({ sessionId: "retire1", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    contextHandler(pi, event, ctx); // fire 1: miss → 1 (no cancel yet)
    expect(appendCalls).toHaveLength(0);
    contextHandler(pi, event, ctx); // fire 2: miss → 2 (no cancel yet)
    expect(appendCalls).toHaveLength(0);
    contextHandler(pi, event, ctx); // fire 3: miss → 3 → RETIRE (append mulligan:cancel)

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].customType).toBe("mulligan:cancel");
    expect((appendCalls[0].data as { targetId: string }).targetId).toBe("sh-1");
    expect(getRuntime("retire1").shrinkMissCounts.get("sh-1")).toBe(3);
  });

  it("does NOT retire a pinned shrink whose target IS present (miss count resets to 0)", () => {
    // resolvePinnedShrink returns a non-null index (target present) → HIT → reset each fire.
    resolvePinnedShrinkReturn = () => 0;
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [customEntry("mulligan:shrink", pinnedShrinkData(1, "sh-2", "entry-here"))];
    const ctx = makeCtx({ sessionId: "retire2", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(0); // never retired
    expect(getRuntime("retire2").shrinkMissCounts.get("sh-2")).toBe(0); // reset each fire
  });

  it("rt.shrinkMissCounts resets on a hit after misses (a miss-run then a hit clears it)", () => {
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [customEntry("mulligan:shrink", pinnedShrinkData(1, "sh-3", "entry-maybe"))];
    const ctx = makeCtx({ sessionId: "retire3", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    // Fire 1 + 2: target absent (default null) → misses climb 1, 2.
    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);
    expect(getRuntime("retire3").shrinkMissCounts.get("sh-3")).toBe(2);
    // Fire 3: target now present → HIT → reset to 0.
    resolvePinnedShrinkReturn = () => 0;
    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(0); // never reached the threshold (reset cleared it)
    expect(getRuntime("retire3").shrinkMissCounts.get("sh-3")).toBe(0);
  });

  it("does NOT consider live shrinks (no pinnedEntryId) — never counted, never retired", () => {
    // shrinkData produces a LIVE shrink (no pinnedEntryId). Even with the branch empty + default null
    // resolvePinnedShrink, it must never be counted or retired.
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [customEntry("mulligan:shrink", shrinkData(1, "sh-live"))]; // LIVE — no pinnedEntryId
    const ctx = makeCtx({ sessionId: "retire4", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    // Fire staleAfterFires+1 = 4 times.
    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);
    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(0); // never retired
    expect(getRuntime("retire4").shrinkMissCounts.has("sh-live")).toBe(false); // never written
  });

  it("never throws: a throwing resolvePinnedShrink is swallowed and the turn still returns {messages}", () => {
    // resolvePinnedShrink THROWS → the inner retirement try/catch swallows it; the already-computed
    // filter transform is PRESERVED (the result is {messages}, NOT undefined / pass-through).
    resolvePinnedShrinkReturn = () => { throw new Error("resolvePinnedShrink boom"); };
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "OK" }];
    const entries = [customEntry("mulligan:shrink", pinnedShrinkData(1, "sh-throw", "entry-x"))];
    const ctx = makeCtx({ sessionId: "retire5", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    let result: { messages: unknown[] } | undefined;
    expect(() => { result = contextHandler(pi, event, ctx) as { messages: unknown[] } | undefined; }).not.toThrow();
    expect(result).toBeDefined(); // NOT pass-through (void) — the transform is preserved (E13 isolation)
    expect(result?.messages).toEqual([{ role: "user", content: "OK" }]);
    expect(appendCalls).toHaveLength(0); // retirement failed before reaching appendCancelMarker
  });

  it("appendCancelMarker failure is tolerated (appendEntry throwing does not break the turn)", () => {
    // A pi whose appendEntry THROWS on the 3rd fire (the retire attempt). Both appendCancelMarker's own
    // try/catch AND the inner retirement try/catch hold → the turn still returns {messages}.
    let appendCallCount = 0;
    const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
    const appendCalls: { customType: string; data: unknown }[] = [];
    const pi = {
      on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
      appendEntry(customType: string, data: unknown) {
        appendCallCount++;
        if (customType === "mulligan:cancel") throw new Error("appendEntry boom");
        appendCalls.push({ customType, data });
      },
    } as unknown as ExtensionAPI;
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [customEntry("mulligan:shrink", pinnedShrinkData(1, "sh-append-throw", "entry-y"))];
    const ctx = makeCtx({ sessionId: "retire6", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    // Fire 1 + 2: misses climb 1, 2 (no appendEntry for cancel yet).
    expect(() => contextHandler(pi, event, ctx)).not.toThrow();
    expect(() => contextHandler(pi, event, ctx)).not.toThrow();
    // Fire 3: miss → 3 → appendCancelMarker → pi.appendEntry THROWS → swallowed by both try/catches.
    let result: { messages: unknown[] } | undefined;
    expect(() => { result = contextHandler(pi, event, ctx) as { messages: unknown[] } | undefined; }).not.toThrow();
    expect(result).toBeDefined(); // transform preserved — NOT pass-through
    expect(result?.messages).toEqual([{ role: "user", content: "F" }]);
    expect(getRuntime("retire6").shrinkMissCounts.get("sh-append-throw")).toBe(3); // count still climbed
  });
});

// ── soft cap on active shrinks (P3.M2.T3.S2 / spec/08 E15) ───────────────────────────────────
// The soft cap retires the OLDEST active shrink (lowest seq) when the active count exceeds
// config.shrink.maxActive — exactly ONE per fire (bounded, eventual), taking effect NEXT fire.
// Uses LIVE shrinks (shrinkData — no pinnedEntryId) so the stale-retirement for-loop skips them,
// isolating the cap path. setConfig({ shrink: { maxActive: N } }) deep-merges (keeps staleAfterFires
// default). Restored to defaults via setConfig({}) at the end of each test (module-level cache).
describe("contextHandler — soft cap (spec/08 E15)", () => {
  it("retires the OLDEST shrink (lowest seq) when active count exceeds maxActive", () => {
    // maxActive=2, 3 LIVE shrinks (seq 5,3,4) → cap fires → retire oldest = seq 3 ("sh-3").
    setConfig({ shrink: { maxActive: 2 } });
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
    ];
    const ctx = makeCtx({ sessionId: "cap1", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].customType).toBe("mulligan:cancel");
    expect((appendCalls[0].data as { targetId: string }).targetId).toBe("sh-3");
    setConfig({}); // restore defaults
  });

  it("boundary equal does NOT exceed → no cancel (maxActive=3, 3 shrinks → 0; also 2 shrinks → 0)", () => {
    // STRICT `>`: count == maxActive is NOT a retirement. Both 3-of-3 and 2-of-3 stay put.
    setConfig({ shrink: { maxActive: 3 } });
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const ctxA = makeCtx({
      sessionId: "cap2a",
      entries: [
        customEntry("mulligan:shrink", shrinkData(1, "sh-1")),
        customEntry("mulligan:shrink", shrinkData(2, "sh-2")),
        customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      ],
    });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    contextHandler(pi, event, ctxA);
    expect(appendCalls).toHaveLength(0); // 3 == maxActive 3 → not > → no retire

    const ctxB = makeCtx({
      sessionId: "cap2b",
      entries: [
        customEntry("mulligan:shrink", shrinkData(1, "sh-1")),
        customEntry("mulligan:shrink", shrinkData(2, "sh-2")),
      ],
    });
    contextHandler(pi, event, ctxB);
    expect(appendCalls).toHaveLength(0); // 2 < maxActive 3 → no retire
    setConfig({}); // restore defaults
  });

  it("retires exactly ONE per fire (not all-over, not a loop)", () => {
    // maxActive=1, 3 shrinks → ONE fire retires exactly ONE (the oldest), never two.
    setConfig({ shrink: { maxActive: 1 } });
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
    ];
    const ctx = makeCtx({ sessionId: "cap3", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(1); // exactly ONE, not 2 (count - maxActive)
    expect((appendCalls[0].data as { targetId: string }).targetId).toBe("sh-3"); // oldest first
    setConfig({}); // restore defaults
  });

  it("over N fires retires oldest-first, one per fire (bounded, eventual)", () => {
    // maxActive=1; start [sh-5,sh-3,sh-4]. fake pi.appendEntry does NOT feed back into makeCtx, so we
    // MANUALLY append a makeCancelEntry(id) between fires (readMarkers cancel-drops it next fire).
    setConfig({ shrink: { maxActive: 1 } });
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    // Fire 1: [sh-5,sh-3,sh-4] → oldest = sh-3.
    let entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
    ];
    contextHandler(pi, event, makeCtx({ sessionId: "cap4", entries }));
    expect(appendCalls).toHaveLength(1);
    expect((appendCalls[0].data as { targetId: string }).targetId).toBe("sh-3");

    // Fire 2: append cancel for sh-3 → readMarkers drops it → active [sh-5,sh-4] (len 2 > 1) → oldest = sh-4.
    entries = [...entries, makeCancelEntry("sh-3")];
    contextHandler(pi, event, makeCtx({ sessionId: "cap4", entries }));
    expect(appendCalls).toHaveLength(2);
    expect((appendCalls[1].data as { targetId: string }).targetId).toBe("sh-4");

    // Fire 3: append cancel for sh-4 → active [sh-5] (len 1, NOT > 1) → no new cancel.
    entries = [...entries, makeCancelEntry("sh-4")];
    contextHandler(pi, event, makeCtx({ sessionId: "cap4", entries }));
    expect(appendCalls).toHaveLength(2); // unchanged — back under the cap
    setConfig({}); // restore defaults
  });

  it("operates on the ACTIVE set (cancel-dropped shrinks don't count toward the cap)", () => {
    // maxActive=2; 3 shrinks BUT one (sh-3) already has a mulligan:cancel on the branch → readMarkers
    // drops sh-3 → active len = 2 → NOT > 2 → no new cancel.
    setConfig({ shrink: { maxActive: 2 } });
    const { pi, appendCalls } = makePi();
    pipelineReturn = [{ role: "user", content: "F" }];
    const entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
      makeCancelEntry("sh-3"), // sh-3 is already retired on-disk → active set is [sh-5,sh-4]
    ];
    const ctx = makeCtx({ sessionId: "cap5", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    contextHandler(pi, event, ctx);

    expect(appendCalls).toHaveLength(0); // active len 2 == maxActive 2 → not > → no retire
    setConfig({}); // restore defaults
  });

  it("never throws: a cap-path failure is swallowed and the turn still returns {messages} (E13)", () => {
    // 3 LIVE shrinks (no pinnedEntryId → stale for-loop skips them, so ONLY the cap path runs). A pi whose
    // appendEntry THROWS → appendCancelMarker swallows → inner retirement try/catch also holds → {messages}.
    setConfig({ shrink: { maxActive: 1 } });
    const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
    const appendCalls: { customType: string; data: unknown }[] = [];
    const pi = {
      on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
      appendEntry() { throw new Error("boom"); },
    } as unknown as ExtensionAPI;
    pipelineReturn = [{ role: "user", content: "OK" }];
    const entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
    ];
    const ctx = makeCtx({ sessionId: "cap6", entries });
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    let result: { messages: unknown[] } | undefined;
    expect(() => { result = contextHandler(pi, event, ctx) as { messages: unknown[] } | undefined; }).not.toThrow();
    expect(result).toBeDefined(); // NOT pass-through (void) — the transform is PRESERVED (E13 isolation)
    expect(result?.messages).toEqual([{ role: "user", content: "OK" }]);
    expect(appendCalls).toHaveLength(0); // appendEntry threw before push
    setConfig({}); // restore defaults
  });
});

// ── P3.M3.T6.S1: edge-triggered high-water signal wiring (spec/07 §5.2, REQUIRED) ────────────────
// The edge-trigger latch lives in the PER-SESSION rt.aboveHighWater. clearAll() in beforeEach wipes rt, so a
// TRUE end-to-end lifecycle (cross → latch → no-refire → drop → clear → re-cross → fire) MUST reuse ONE
// sessionId across sequential contextHandler fires INSIDE ONE it(). control totalFilteredTokens via
// pipelineReturn (a message whose content is 4*tokens 'x' chars → estimateTokens === tokens, since
// estimateTokens = ceil(chars/4)). control windowTokens via makeCtx({getContextUsage}). These assert the
// WIRING (contextHandler calls shouldHighWater/injectHighWaterNudge correctly); shouldHighWater's OWN behavior
// is unit-tested in test/drift_nudge.test.ts (P3.M3.T5.S1).
describe("contextHandler — edge-triggered high-water signal (P3.M3.T6.S1 / spec/07 §5.2)", () => {
  // A single user message whose content is 4*tokens 'x' chars → estimateTokens === tokens (ceil(4t/4)=t).
  const msgTokens = (tokens: number): unknown[] => [{ role: "user", content: "x".repeat(4 * tokens) }];
  // A getContextUsage fake returning the given contextWindow (window SIZE, the denominator). tokens/percent
  // are irrelevant to the high-water math (filter.ts reads ONLY .contextWindow) — set them to null/0 defensively.
  const usage = (contextWindow: number) =>
    () => ({ tokens: null, contextWindow, percent: null });

  it("full lifecycle on one session: cross→latch→no-refire→drop→clear→re-cross→fire", () => {
    const sid = "hw-life";
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;

    // fire 1: cross 0.7 (700/1000) → fire + latch rt.aboveHighWater=true
    pipelineReturn = msgTokens(700);
    let r = contextHandler(pi, event, makeCtx({ sessionId: sid, getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(2); // filtered + high-water nudge
    expect((r.messages[1] as Record<string, unknown>).customType).toBe("mulligan:high-water");
    expect(getRuntime(sid).aboveHighWater).toBe(true); // latched

    // fire 2: same total, already above → edge-triggered, NO re-fire (latch still true)
    r = contextHandler(pi, event, makeCtx({ sessionId: sid, getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(1); // no high-water nudge
    expect(getRuntime(sid).aboveHighWater).toBe(true); // unchanged

    // fire 3: drop below (0.5) → clear latch, no fire
    pipelineReturn = msgTokens(500);
    r = contextHandler(pi, event, makeCtx({ sessionId: sid, getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(1); // no high-water nudge
    expect(getRuntime(sid).aboveHighWater).toBe(false); // cleared (re-armed)

    // fire 4: re-cross 0.7 → fire AGAIN (re-armed)
    pipelineReturn = msgTokens(700);
    r = contextHandler(pi, event, makeCtx({ sessionId: sid, getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(2); // high-water nudge appended again
    expect((r.messages[1] as Record<string, unknown>).customType).toBe("mulligan:high-water");
    expect(getRuntime(sid).aboveHighWater).toBe(true); // latched again
  });

  it("the high-water nudge text reports ~70% (Math.round(700/1000*100)=70)", () => {
    pipelineReturn = msgTokens(700); // 0.7 of 1000
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const r = contextHandler(pi, event, makeCtx({ sessionId: "hw-text", getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    const last = r.messages[1] as Record<string, unknown>;
    expect(last.customType).toBe("mulligan:high-water");
    expect(typeof last.content).toBe("string");
    expect(last.content).toContain("~70%");
    expect(last.display).toBe(false); // ephemeral CustomMessage (never shown in the transcript)
  });

  it("fail-open: getContextUsage undefined (default makeCtx) → no high-water nudge AND aboveHighWater unchanged", () => {
    // default makeCtx has NO getContextUsage → ctx.getContextUsage?.() === undefined → windowTokens=0
    pipelineReturn = msgTokens(700);
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const r = contextHandler(pi, event, makeCtx({ sessionId: "hw-undef" })) as { messages: unknown[] };
    expect(r.messages).toHaveLength(1); // no high-water nudge
    expect(getRuntime("hw-undef").aboveHighWater).toBe(false); // unchanged (fail-open does NOT mutate rt)
  });

  it("fail-open: contextWindow === 0 → no high-water nudge (shouldHighWater returns false, no rt mutation)", () => {
    pipelineReturn = msgTokens(700);
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const r = contextHandler(pi, event, makeCtx({ sessionId: "hw-zero", getContextUsage: usage(0) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(1); // no high-water nudge
    expect(getRuntime("hw-zero").aboveHighWater).toBe(false); // unchanged
  });

  it("does NOT fire high-water when well below the fraction (0.3 → 300/1000)", () => {
    pipelineReturn = msgTokens(300);
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const r = contextHandler(pi, event, makeCtx({ sessionId: "hw-low", getContextUsage: usage(1000) })) as {
      messages: unknown[];
    };
    expect(r.messages).toHaveLength(1); // no high-water nudge
    expect(getRuntime("hw-low").aboveHighWater).toBe(false);
  });
});

// ── P3.M3.T6.S1: windowed drift-nudge wiring (spec/07 §5.1, REQUIRED) ───────────────────────────
// Thin wiring asserts: contextHandler passes the FULL recentMetrics window (NOT the single metric) to
// shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, delta-only when delta
// data exists; bloatHit is a no-delta fallback only — P4.M2.T1 / spec/07 §5.1) is
// unit-tested in test/drift_nudge.test.ts (P3.M3.T4.S1). These use the DEFAULT makeCtx (no getContextUsage)
// so the high-water block is a no-op (the single "P"-content message is ~1 token, far below any fraction).
describe("contextHandler — windowed drift-nudge wiring (P3.M3.T6.S1 / spec/07 §5.1)", () => {
  it("does NOT inject the drift nudge for a single heavy-turn window (windowed: moving-avg 2400 < 6000)", () => {
    // window = [heavy(7000), small(100), small(100)] → moving-avg = 2400 < 6000 → no fire (a single 8k turn
    // amid small turns does NOT fire — spec/07 §5.1). metricData(grew=true) ⇒ deltaTokens=7000.
    pipelineReturn = [{ role: "user", content: "P" }];
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const ctx = makeCtx({
      sessionId: "wd-single",
      entries: [
        customEntry("mulligan:turn-metric", metricData(3, true)), // 7000 (heavy, latest)
        customEntry("mulligan:turn-metric", metricData(2, false)), // 100
        customEntry("mulligan:turn-metric", metricData(1, false)), // 100
      ],
    });
    const r = contextHandler(pi, event, ctx) as { messages: unknown[] };
    expect(r.messages).toHaveLength(1); // no drift nudge (avg 2400 < 6000); no markers → no high-water either
  });

  it("injects the drift nudge for a sustained-growth window (windowed: moving-avg 7000 > 6000)", () => {
    // window = [7000, 7000, 7000] → moving-avg = 7000 > 6000 → fire (sustained growth fires — spec/07 §5.1).
    pipelineReturn = [{ role: "user", content: "P" }];
    const { pi } = makePi();
    const event = { type: "context" as const, messages: [] } as unknown as ContextEvent;
    const ctx = makeCtx({
      sessionId: "wd-sustained",
      entries: [
        customEntry("mulligan:turn-metric", metricData(3, true)),
        customEntry("mulligan:turn-metric", metricData(2, true)),
        customEntry("mulligan:turn-metric", metricData(1, true)),
      ],
    });
    const r = contextHandler(pi, event, ctx) as { messages: unknown[] };
    expect(r.messages).toHaveLength(2); // drift nudge appended
    expect((r.messages[1] as Record<string, unknown>).customType).toBe("mulligan:nudge");
  });
});