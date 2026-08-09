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
  return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, deltaTokens: grew ? 5000 : 100,
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