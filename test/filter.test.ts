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
vi.mock("../src/transforms.js", () => ({
  filterPipeline: (messages: unknown[], markers: unknown, config: unknown, branchEntries: unknown[]) => {
    pipelineCalls.push({ messages, markers, config, branchEntries });
    return typeof pipelineReturn === "function"
      ? pipelineReturn(messages, markers, config, branchEntries)
      : pipelineReturn;
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
});
afterEach(() => {
  clearAll();
  pipelineCalls.length = 0;
  pipelineReturn = [];
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
function metricData(seq: number, grew = false, bloat = false): Record<string, unknown> {
  return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 5000 : 100,
    bloatHit: bloat, bloatHits: [], grewOverThreshold: grew, turnIndex: seq };
}
/** A custom entry (marker). type 'custom' → NOT in context. */
function customEntry(customType: string, data: unknown): SessionEntry {
  return { type: "custom", id: `e-${customType}-${Math.random()}`, parentId: null,
    timestamp: new Date().toISOString(), customType, data } as unknown as SessionEntry;
}

/** Minimal fake ExtensionContext: scripts getSessionId + getEntries + getBranch (all read FRESH — C12). */
function makeCtx(opts: {
  sessionId?: string;
  entries?: SessionEntry[];
  branch?: SessionEntry[];
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
  throwOnGetSessionId?: boolean;
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
  return { sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"] } as ExtensionContext;
}

/** Minimal fake ExtensionAPI capturing `.on` registrations. */
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      handlers[event] = handler;
    },
  };
  return { handlers, pi: pi as unknown as ExtensionAPI };
}

// ── readMarkers ─────────────────────────────────────────────────────────────────────────────

describe("readMarkers — fresh read, bucket, latest metric (spec/06 §1, api_verification §5)", () => {
  it("returns an empty bundle for an empty entry stream", () => {
    const bundle = readMarkers(makeCtx({ entries: [] }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.shrinks).toEqual([]);
    expect(bundle.metric).toBeNull();
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
      { type: "other", customType: "mulligan:rewind", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry,
    ];
    expect(() => readMarkers(makeCtx({ entries }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ entries }));
    expect(bundle.rewinds).toHaveLength(1);
    expect((bundle.rewinds[0] as { seq: number }).seq).toBe(5);
  });

  it("never throws when getEntries throws (fail-open → empty bundle)", () => {
    expect(() => readMarkers(makeCtx({ throwOnGetEntries: true }))).not.toThrow();
    const bundle = readMarkers(makeCtx({ throwOnGetEntries: true }));
    expect(bundle.rewinds).toEqual([]);
    expect(bundle.metric).toBeNull();
  });
});

// ── contextHandler ──────────────────────────────────────────────────────────────────────────

describe("contextHandler — disabled pass-through, transform+cache, fail-open (spec/06 §1, §03 #4)", () => {
  it("returns undefined (pass-through) and does NOT cache when config.enabled is false", () => {
    // getConfig reads the cached config; default is enabled:true. Force-disable via setConfig (top-level import).
    setConfig({ enabled: false });
    const ctx = makeCtx({ sessionId: "dis" });
    const event = { type: "context" as const, messages: [{ role: "user", content: "hi" }] } as unknown as ContextEvent;
    const result = contextHandler(event, ctx);
    expect(result).toBeUndefined(); // void = pass-through (C4)
    expect(getRuntime("dis").lastFiltered).toBeNull(); // cache untouched
    setConfig({ enabled: true }); // restore default
  });

  it("delegates to filterPipeline with (messages, markers, config, branchEntries) and returns {messages}", () => {
    const filtered = [{ role: "user", content: "FILTERED" }];
    pipelineReturn = filtered;
    const branch = [{ type: "message", id: "b1", parentId: null, timestamp: "" } as unknown as SessionEntry];
    const ctx = makeCtx({ sessionId: "s2", entries: [customEntry("mulligan:rewind", rewindData(1))], branch });
    const event = { type: "context" as const, messages: [{ role: "user", content: "orig" }] } as unknown as ContextEvent;

    const result = contextHandler(event, ctx) as { messages: unknown[] };

    expect(pipelineCalls).toHaveLength(1);
    expect(pipelineCalls[0].messages).toBe(event.messages);          // passes event.messages
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(1); // readMarkers result
    expect(pipelineCalls[0].branchEntries).toBe(branch);            // passes getBranch() fresh
    expect(result.messages).toBe(filtered);                          // returns filterPipeline's result
  });

  it("caches the filtered view in rt.lastFiltered + sets lastFilterTs (spec/06 §7)", () => {
    pipelineReturn = [{ role: "user", content: "F" }];
    const ctx = makeCtx({ sessionId: "s3" });
    contextHandler({ type: "context", messages: [] }, ctx);
    const rt = getRuntime("s3");
    expect(rt.lastFiltered).toEqual([{ role: "user", content: "F" }]);
    expect(rt.lastFilterTs).not.toBeNull();
  });

  it("reads ctx.sessionManager FRESH each fire (no module-scope cache)", () => {
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
    contextHandler({ type: "context", messages: [] }, ctx);
    expect(pipelineCalls[0].branchEntries).toEqual([]);
    expect((pipelineCalls[0].markers as MarkersBundle).rewinds).toHaveLength(0);

    // Fire 2: mutate the LIVE arrays — the handler must see the new data (fresh read).
    live.entries = [customEntry("mulligan:rewind", rewindData(9))];
    live.branch = [{ type: "message", id: "x", parentId: null, timestamp: "" } as unknown as SessionEntry];
    contextHandler({ type: "context", messages: [] }, ctx);
    expect((pipelineCalls[1].markers as MarkersBundle).rewinds).toHaveLength(1); // saw the NEW marker
    expect(pipelineCalls[1].branchEntries).toHaveLength(1);                      // saw the NEW branch
  });

  it("injects the drift nudge when shouldNudge(metric) is true and not suppressed", () => {
    pipelineReturn = [{ role: "user", content: "P" }];
    const ctx = makeCtx({ sessionId: "s5", entries: [customEntry("mulligan:turn-metric", metricData(1, true))] });
    const result = contextHandler({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
    // shouldNudge true (grewOverThreshold) + no markers → not suppressed → 1 nudge appended to the END.
    expect(result.messages).toHaveLength(2);
    const last = result.messages[1] as Record<string, unknown>;
    expect(last.role).toBe("custom");
    expect(last.customType).toBe("mulligan:nudge");
    expect(last.display).toBe(false);
    expect(typeof last.content).toBe("string");
  });

  it("does NOT inject the drift nudge when suppressed by a same-turn rewind marker", () => {
    pipelineReturn = [{ role: "user", content: "P" }];
    // metric.ts=1 + rewind.ts=1 → 1 ∈ (1 − window, 1] → suppressed (shouldNudge true but suppress wins).
    const ctx = makeCtx({
      sessionId: "s5b",
      entries: [
        customEntry("mulligan:turn-metric", metricData(1, true)),
        customEntry("mulligan:rewind", rewindData(2)),
      ],
    });
    const result = contextHandler({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(1); // no nudge
  });

  it("does NOT inject the drift nudge when shouldNudge is false (no growth, no bloat)", () => {
    pipelineReturn = [{ role: "user", content: "P" }];
    const ctx = makeCtx({ sessionId: "s5c", entries: [customEntry("mulligan:turn-metric", metricData(1, false, false))] });
    const result = contextHandler({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
    expect(result.messages).toHaveLength(1); // no nudge
  });

  it("fail-open: a throwing filterPipeline is caught, logged, and returns undefined (pass-through)", () => {
    pipelineReturn = () => { throw new Error("pipeline boom"); };
    const ctx = makeCtx({ sessionId: "s6", entries: [customEntry("mulligan:rewind", rewindData(1))] });
    expect(() => contextHandler({ type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler({ type: "context", messages: [] }, ctx)).toBeUndefined();
  });

  it("fail-open: a throwing getSessionId is caught and returns undefined", () => {
    pipelineReturn = [];
    const ctx = makeCtx({ sessionId: "s7", throwOnGetSessionId: true });
    expect(() => contextHandler({ type: "context", messages: [] }, ctx)).not.toThrow();
    expect(contextHandler({ type: "context", messages: [] }, ctx)).toBeUndefined();
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