import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  appendRewindMarker,
  appendShrinkMarker,
  appendTurnMetric,
  type MulliganEnvelope,
  type RewindMarker,
  type RewindMarkerInput,
  type ShrinkMarker,
  type ShrinkMarkerInput,
  type ShrinkTarget,
  type TurnMetric,
  type TurnMetricInput,
} from "../src/markers.js";
import { clearAll } from "../src/runtime.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// GOTCHA #8: nextSeq mutates the SHARED module-scoped runtime map. clearAll() before AND after each test so a
// previous test's seq sequence can't leak in (mirror test/runtime.test.ts GOTCHA #7).
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (the looper-smoke A1.appendEntry capture pattern, with hand-rolled objects) ─────────

/** A minimal fake ExtensionAPI capturing appendEntry calls. Set throwOnAppend to simulate a Pi failure. */
function makePi(opts: { throwOnAppend?: boolean } = {}) {
  const appended: { customType: string; data: unknown }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
  };
  return { appended, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionContext. Tracks sessionManager method-call ORDER (for the C7 proof) and scripts the leaf
 * id (default "leaf-1"; pass leafId: null to test the null path; throwOn* to simulate failures).
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  throwOnGetSessionId?: boolean;
  throwOnGetLeafId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const calls: string[] = [];
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const sessionManager = {
    getSessionId() {
      calls.push("getSessionId");
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    getLeafId() {
      calls.push("getLeafId");
      if (opts.throwOnGetLeafId) throw new Error("getLeafId boom");
      return scriptedLeafId;
    },
  };
  return { calls, ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── pinned payloads (spec/04 §3/§4/§5 shapes, minus the wrapper-stamped fields) ─────────────

const REWIND_DATA: RewindMarkerInput = {
  granularity: "last_tool_call_group",
  options: { to_previous_prompt: false },
  excludeToolCallId: "call-rewind-self",
  note: {
    what_happened: "Ran a repo-wide grep that dumped ~38k tokens.",
    avoid: "Don't grep without -l; use the built-in grep tool which truncates.",
    true_current_state: "No files changed on the abandoned span.",
    next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
  },
  ledger: { readFiles: ["src/a.ts"], modifiedFiles: [], bashSideEffects: [] },
};

const SHRINK_DATA: ShrinkMarkerInput = {
  target: { by_tool_name: "read", occurrence: "last" },
  replacement: "(shrink) the big log was ~9k tokens; the bug is on line 42.",
  reason: "too big to keep carrying verbatim",
};

const METRIC_DATA: TurnMetricInput = {
  deltaTokens: 4321,
  bloatHit: true,
  bloatHits: [{ toolName: "read", approxTokens: 9412 }],
  grewOverThreshold: true,
  turnIndex: 3,
};

// ── envelope + customType + seq + ts stamping ────────────────────────────────

describe("appendRewindMarker — envelope + customType + seq + ts stamping (spec/04 §1/§3, spec/05 §1 step6)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:rewind' and the full envelope", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:rewind");
    const entry = appended[0].data as RewindMarker;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("rewind");
    expect(entry.seq).toBe(1); // first marker this session → seq 1 (nextSeq pre-increment)
    expect(typeof entry.ts).toBe("number");
    expect(entry.ts).toBeLessThanOrEqual(Date.now());
    // returns the leaf id captured after append (C7):
    expect(id).toBe("leaf-1");
  });

  it("spreads the caller payload verbatim (granularity/options/excludeToolCallId/note/ledger)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const entry = appended[0].data as RewindMarker;
    expect(entry.granularity).toBe("last_tool_call_group");
    expect(entry.options).toEqual({ to_previous_prompt: false });
    expect(entry.excludeToolCallId).toBe("call-rewind-self");
    expect(entry.note).toEqual(REWIND_DATA.note);
    expect(entry.ledger).toEqual(REWIND_DATA.ledger);
  });
});

describe("appendShrinkMarker — envelope + customType + payload (spec/04 §4, spec/05 §2 step4)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:shrink', kind 'shrink', returns leaf id", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendShrinkMarker(pi, ctx, SHRINK_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:shrink");
    const entry = appended[0].data as ShrinkMarker;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("shrink");
    expect(entry.target).toEqual({ by_tool_name: "read", occurrence: "last" });
    expect(entry.replacement).toBe(SHRINK_DATA.replacement);
    expect(entry.reason).toBe("too big to keep carrying verbatim");
    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); // shrink stamps a uuid `id` (independent of the returned leaf id — see id-rules describe)
    expect(entry.id).not.toBe(id); // entry.id (marker uuid) ≠ returned leaf id — two distinct ids by design
    expect(id).toBe("leaf-1");
  });
});

describe("appendTurnMetric — envelope + customType + payload (spec/04 §5)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:turn-metric', kind 'turn-metric', returns leaf id", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendTurnMetric(pi, ctx, METRIC_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:turn-metric");
    const entry = appended[0].data as TurnMetric;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("turn-metric");
    expect(entry.deltaTokens).toBe(4321);
    expect(entry.bloatHit).toBe(true);
    expect(entry.bloatHits).toEqual([{ toolName: "read", approxTokens: 9412 }]);
    expect(entry.grewOverThreshold).toBe(true);
    expect(entry.turnIndex).toBe(3);
    expect(id).toBe("leaf-1");
  });
});

// ── id rules (GOTCHA #4): rewind+shrink stamp a uuid; turn-metric stamps NONE ─

describe("id stamping — rewind+shrink get a uuid; turn-metric gets NONE (spec/04 §3/§4/§5, GOTCHA #4)", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("appendRewindMarker stamps an `id` that is a uuid string", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const entry = appended[0].data as RewindMarker;
    expect(typeof entry.id).toBe("string");
    expect(entry.id).toMatch(UUID_RE); // crypto.randomUUID is a v4 uuid
  });

  it("appendShrinkMarker stamps an `id` that is a uuid string", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendShrinkMarker(pi, ctx, SHRINK_DATA);
    const entry = appended[0].data as ShrinkMarker;
    expect(typeof entry.id).toBe("string");
    expect(entry.id).toMatch(UUID_RE);
  });

  it("appendTurnMetric does NOT stamp an `id` (spec/04 §5 has no id field)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendTurnMetric(pi, ctx, METRIC_DATA);
    const entry = appended[0].data as Record<string, unknown>;
    expect(entry).not.toHaveProperty("id"); // GOTCHA #4 — the whole point
    expect(entry.kind).toBe("turn-metric");
  });

  it("two rewind markers get DISTINCT ids", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    appendRewindMarker(pi, ctx, REWIND_DATA);
    const a = (appended[0].data as RewindMarker).id;
    const b = (appended[1].data as RewindMarker).id;
    expect(a).not.toBe(b);
  });
});

// ── seq monotonic per session (nextSeq) ──────────────────────────────────────

describe("seq — monotonic per session, stamped before append (spec/04 §3 seq; runtime.ts nextSeq)", () => {
  it("seq increments across marker types within ONE session: rewind 1, shrink 2, turn-metric 3", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    appendRewindMarker(pi, ctx, REWIND_DATA);
    appendShrinkMarker(pi, ctx, SHRINK_DATA);
    appendTurnMetric(pi, ctx, METRIC_DATA);
    expect((appended[0].data as RewindMarker).seq).toBe(1);
    expect((appended[1].data as ShrinkMarker).seq).toBe(2);
    expect((appended[2].data as TurnMetric).seq).toBe(3);
  });

  it("seq is ISOLATED per session — a second session starts at 1 (nextSeq contract)", () => {
    const { pi } = makePi();
    const { ctx: ctxA } = makeCtx({ sessionId: "A" });
    const { ctx: ctxB } = makeCtx({ sessionId: "B" });
    appendRewindMarker(pi, ctxA, REWIND_DATA); // A → 1
    appendRewindMarker(pi, ctxA, REWIND_DATA); // A → 2
    const { appended, pi: piB } = makePi();
    appendRewindMarker(piB, ctxB, REWIND_DATA); // B → 1 (fresh session)
    expect((appended[0].data as RewindMarker).seq).toBe(1);
  });

  it("seq is stamped onto the persisted entry (read back from the appended data)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appended[0].data).toHaveProperty("seq", 1);
  });
});

// ── C7 leaf-id capture ordering (GOTCHA #5) ──────────────────────────────────

describe("C7 — leaf id captured IMMEDIATELY after appendEntry, same tick (spec/02 C7, GOTCHA #5)", () => {
  it("call order is getSessionId → appendEntry → getLeafId; return == getLeafId()", () => {
    const order: string[] = [];
    const pi = {
      appendEntry: () => {
        order.push("appendEntry");
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: {
        getSessionId: () => {
          order.push("getSessionId");
          return "s1";
        },
        getLeafId: () => {
          order.push("getLeafId");
          return "leaf-after-append";
        },
      },
    } as unknown as ExtensionContext;
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(id).toBe("leaf-after-append");
    expect(order).toEqual(["getSessionId", "appendEntry", "getLeafId"]); // nothing between appendEntry and getLeafId
  });

  it("appendEntry is called exactly once (no double-append, no sendMessage in the wrapper)", () => {
    let appendCount = 0;
    const pi = { appendEntry: () => { appendCount++; } } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: { getSessionId: () => "s1", getLeafId: () => "leaf-1" },
    } as unknown as ExtensionContext;
    appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(appendCount).toBe(1);
  });
});

// ── leaf-null return + never-throws (GOTCHA #2, #3) ──────────────────────────

describe("leaf-null return — getLeafId() returns null → wrapper returns null (no throw)", () => {
  it("appendRewindMarker returns null when getLeafId() is null (marker still appended)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null });
    const id = appendRewindMarker(pi, ctx, REWIND_DATA);
    expect(id).toBeNull();
    expect(appended).toHaveLength(1); // the marker WAS appended; we just can't report its id
  });

  it("all three wrappers return null when getLeafId() is null", () => {
    const { pi } = makePi();
    expect(appendRewindMarker(pi, makeCtx({ leafId: null }).ctx, REWIND_DATA)).toBeNull();
    expect(appendShrinkMarker(pi, makeCtx({ leafId: null }).ctx, SHRINK_DATA)).toBeNull();
    expect(appendTurnMetric(pi, makeCtx({ leafId: null }).ctx, METRIC_DATA)).toBeNull();
  });
});

describe("never throws — every failure mode yields null (GOTCHA #3)", () => {
  it("a throwing pi.appendEntry → null, no throw", () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    expect(() => appendRewindMarker(pi, ctx, REWIND_DATA)).not.toThrow();
    expect(appendRewindMarker(pi, ctx, REWIND_DATA)).toBeNull();
  });

  it("a throwing getSessionId → null, no throw", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetSessionId: true });
    expect(() => appendShrinkMarker(pi, ctx, SHRINK_DATA)).not.toThrow();
    expect(appendShrinkMarker(pi, ctx, SHRINK_DATA)).toBeNull();
  });

  it("a throwing getLeafId → null, no throw", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetLeafId: true });
    expect(() => appendTurnMetric(pi, ctx, METRIC_DATA)).not.toThrow();
    expect(appendTurnMetric(pi, ctx, METRIC_DATA)).toBeNull();
  });

  it("a throwing appendEntry in appendTurnMetric → null, no throw (and no id stamp issue)", () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    expect(() => appendTurnMetric(pi, ctx, METRIC_DATA)).not.toThrow();
    expect(appendTurnMetric(pi, ctx, METRIC_DATA)).toBeNull();
  });
});

// ── types ────────────────────────────────────────────────────────────────────

describe("types (GOTCHA #2 — string | null)", () => {
  it("all three wrappers return string | null", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    expectTypeOf(appendRewindMarker(pi, ctx, REWIND_DATA)).toEqualTypeOf<string | null>();
    expectTypeOf(appendShrinkMarker(pi, ctx, SHRINK_DATA)).toEqualTypeOf<string | null>();
    expectTypeOf(appendTurnMetric(pi, ctx, METRIC_DATA)).toEqualTypeOf<string | null>();
  });

  it("MulliganEnvelope is { schema:'pi-mulligan'; v:1; kind:'rewind'|'shrink'|'turn-metric' }", () => {
    expectTypeOf<MulliganEnvelope>().toEqualTypeOf<{
      schema: "pi-mulligan";
      v: 1;
      kind: "rewind" | "shrink" | "turn-metric";
    }>();
  });

  it("RewindMarker extends the envelope and narrows kind to 'rewind'", () => {
    const m = {} as RewindMarker;
    expectTypeOf(m.schema).toEqualTypeOf<"pi-mulligan">();
    expectTypeOf(m.kind).toEqualTypeOf<"rewind">();
    expectTypeOf(m.id).toEqualTypeOf<string>();
    expectTypeOf(m.seq).toEqualTypeOf<number>();
    expectTypeOf(m.ts).toEqualTypeOf<number>();
  });

  it("TurnMetric has NO `id` field and deltaTokens is number | null (GOTCHA #4, #6)", () => {
    const m = {} as TurnMetric;
    expectTypeOf(m).not.toHaveProperty("id");
    expectTypeOf(m.deltaTokens).toEqualTypeOf<number | null>();
    expectTypeOf(m.kind).toEqualTypeOf<"turn-metric">();
  });

  it("ShrinkTarget is the 3-arm discriminated union", () => {
    // Each arm is assignable to ShrinkTarget (the `: ShrinkTarget` annotations prove it at compile time) …
    const a: ShrinkTarget = { by_tool_call_id: "x" };
    const b: ShrinkTarget = { by_tool_name: "read", occurrence: "last" };
    const c: ShrinkTarget = { by_content_includes: "substr" };
    // … and ShrinkTarget is exactly the 3-arm discriminated union (assert on the type, house pattern). A single
    // arm is assignable to but NOT equal to the full union, so the equality assertion is on `ShrinkTarget` itself.
    expectTypeOf<ShrinkTarget>().toEqualTypeOf<
      | { by_tool_call_id: string }
      | { by_tool_name: string; occurrence: "last" | "first" }
      | { by_content_includes: string }
    >();
    expectTypeOf(a).toMatchTypeOf<ShrinkTarget>();
    expectTypeOf(b).toMatchTypeOf<ShrinkTarget>();
    expectTypeOf(c).toMatchTypeOf<ShrinkTarget>();
  });

  it("the *Input types are the marker MINUS the wrapper-stamped fields", () => {
    // RewindMarkerInput omits schema/v/kind/id/seq/ts but keeps granularity/note/ledger/etc.
    const r: RewindMarkerInput = REWIND_DATA;
    expectTypeOf(r.granularity).toEqualTypeOf<RewindMarker["granularity"]>();
    // TurnMetricInput omits schema/v/kind/seq/ts (and has NO id to begin with)
    const t: TurnMetricInput = METRIC_DATA;
    expectTypeOf(t.deltaTokens).toEqualTypeOf<number | null>();
    expectTypeOf(t).not.toHaveProperty("seq");
    const s: ShrinkMarkerInput = SHRINK_DATA;
    expectTypeOf(s.target).toEqualTypeOf<ShrinkTarget>();
  });
});