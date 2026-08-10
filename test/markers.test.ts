import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  appendRewindMarker,
  appendShrinkMarker,
  appendTurnMetric,
  appendCancelMarker,
  leaveNote,
  setCheckpoint,
  type MulliganEnvelope,
  type RewindMarker,
  type RewindMarkerInput,
  type ShrinkMarker,
  type ShrinkMarkerInput,
  type ShrinkTarget,
  type TurnMetric,
  type TurnMetricInput,
  type CancelMarker,
  type CancelMarkerInput,
  type NoteDetails,
  type SetCheckpointResult,
} from "../src/markers.js";
import { clearAll } from "../src/runtime.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// GOTCHA #8: nextSeq mutates the SHARED module-scoped runtime map. clearAll() before AND after each test so a
// previous test's seq sequence can't leak in (mirror test/runtime.test.ts GOTCHA #7).
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (the looper-smoke A1.appendEntry capture pattern, with hand-rolled objects) ─────────

/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel calls (GOTCHA: hand-rolled, no vi.fn()).
 *  Set a throwOn* flag to simulate a Pi failure on any of the three write methods. */
function makePi(opts: {
  throwOnAppend?: boolean;
  throwOnSendMessage?: boolean;
  throwOnSetLabel?: boolean;
} = {}) {
  const appended: { customType: string; data: unknown }[] = [];
  const sent: {
    customType: string;
    content: unknown;
    display: boolean;
    details?: unknown;
    options?: unknown; // captured to assert leaveNote passes NO options (C8)
  }[] = [];
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
    sendMessage(
      message: { customType: string; content: unknown; display: boolean; details?: unknown },
      options?: unknown,
    ) {
      if (opts.throwOnSendMessage) throw new Error("sendMessage boom");
      sent.push({ ...message, options });
    },
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { appended, sent, labels, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionContext. Tracks sessionManager method-call ORDER (for the C7 proof) and scripts the leaf
 * id (default "leaf-1"; pass leafId: null to test the null path; throwOn* to simulate failures). Also scripts
 * getBranch() for setCheckpoint (BUG-003 fix): default branch ends in a stable message whose id == scriptedLeafId,
 * so existing success assertions stay valid; pass an explicit `branch` (ROOT→LEAF) or leafId:null (→ empty branch,
 * no stable message) to exercise the other paths.
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  branch?: unknown[];
  throwOnGetSessionId?: boolean;
  throwOnGetLeafId?: boolean;
  throwOnGetBranch?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const calls: string[] = [];
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  // Default branch (ROOT→LEAF, matching getBranch() / T1's contract): ends in a stable message whose id ==
  // scriptedLeafId, so setCheckpoint's stable anchor id equals the old scripted leaf id (GOTCHA F). leafId:null
  // → empty branch → no stable message → exercises the no-stable-entry path.
  const defaultBranch =
    scriptedLeafId === null
      ? []
      : [
          { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
          { type: "message", id: scriptedLeafId, parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
        ];
  const branch = opts.branch ?? defaultBranch;
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
    getBranch() {
      calls.push("getBranch");
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return branch;
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
    what_happened:
      "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates.",
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

const CANCEL_DATA: CancelMarkerInput = { targetId: "target-uuid-123" };

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

describe("appendCancelMarker — envelope + customType + payload (spec/04 §5½; G3 marker retraction)", () => {
  it("calls pi.appendEntry once with customType 'mulligan:cancel', kind 'cancel', returns leaf id", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const id = appendCancelMarker(pi, ctx, CANCEL_DATA);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:cancel");
    const entry = appended[0].data as CancelMarker;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("cancel");
    expect(entry.targetId).toBe("target-uuid-123"); // carried verbatim from the input payload
    expect(entry.seq).toBe(1); // first marker this session → seq 1 (nextSeq pre-increment)
    expect(typeof entry.ts).toBe("number");
    expect(entry.ts).toBeLessThanOrEqual(Date.now());
    expect(id).toBe("leaf-1");
  });

  it("spreads the caller payload verbatim (targetId is the uuid id of the cancelled marker, NOT the entry id)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendCancelMarker(pi, ctx, { targetId: "uuid-of-rewind-being-cancelled" });
    const entry = appended[0].data as CancelMarker;
    expect(entry.targetId).toBe("uuid-of-rewind-being-cancelled");
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

  it("appendCancelMarker does NOT stamp an `id` (spec/04 §5½ has no id field — a cancel is not itself cancellable)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    appendCancelMarker(pi, ctx, CANCEL_DATA);
    const entry = appended[0].data as Record<string, unknown>;
    expect(entry).not.toHaveProperty("id"); // GOTCHA #4 — mirror of TurnMetric, NOT ShrinkMarker
    expect(entry.kind).toBe("cancel");
    expect(entry).toHaveProperty("targetId", "target-uuid-123");
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
  it("seq increments across marker types within ONE session: rewind 1, shrink 2, turn-metric 3, cancel 4", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    appendRewindMarker(pi, ctx, REWIND_DATA);
    appendShrinkMarker(pi, ctx, SHRINK_DATA);
    appendTurnMetric(pi, ctx, METRIC_DATA);
    appendCancelMarker(pi, ctx, CANCEL_DATA);
    expect((appended[0].data as RewindMarker).seq).toBe(1);
    expect((appended[1].data as ShrinkMarker).seq).toBe(2);
    expect((appended[2].data as TurnMetric).seq).toBe(3);
    expect((appended[3].data as CancelMarker).seq).toBe(4);
  });

  it("cancel participates in the shared per-session nextSeq sequence: rewind 1, cancel 2", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    appendRewindMarker(pi, ctx, REWIND_DATA); // seq 1
    appendCancelMarker(pi, ctx, CANCEL_DATA); // seq 2 (shared counter — proves cancel is NOT isolated)
    expect((appended[0].data as RewindMarker).seq).toBe(1);
    expect((appended[1].data as CancelMarker).seq).toBe(2);
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

  it("all four wrappers return null when getLeafId() is null", () => {
    const { pi } = makePi();
    expect(appendRewindMarker(pi, makeCtx({ leafId: null }).ctx, REWIND_DATA)).toBeNull();
    expect(appendShrinkMarker(pi, makeCtx({ leafId: null }).ctx, SHRINK_DATA)).toBeNull();
    expect(appendTurnMetric(pi, makeCtx({ leafId: null }).ctx, METRIC_DATA)).toBeNull();
    expect(appendCancelMarker(pi, makeCtx({ leafId: null }).ctx, CANCEL_DATA)).toBeNull();
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

  it("appendCancelMarker returns null and does not throw when appendEntry throws (E13 fail-open)", () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    expect(() => appendCancelMarker(pi, ctx, CANCEL_DATA)).not.toThrow();
    expect(appendCancelMarker(pi, ctx, CANCEL_DATA)).toBeNull();
  });

  it("appendCancelMarker returns null and does not throw when getSessionId throws (E13 fail-open)", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetSessionId: true });
    expect(() => appendCancelMarker(pi, ctx, CANCEL_DATA)).not.toThrow();
    expect(appendCancelMarker(pi, ctx, CANCEL_DATA)).toBeNull();
  });

  it("appendCancelMarker returns null and does not throw when getLeafId throws (E13 fail-open)", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetLeafId: true });
    expect(() => appendCancelMarker(pi, ctx, CANCEL_DATA)).not.toThrow();
    expect(appendCancelMarker(pi, ctx, CANCEL_DATA)).toBeNull();
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
    expectTypeOf(appendCancelMarker(pi, ctx, CANCEL_DATA)).toEqualTypeOf<string | null>();
  });

  it("MulliganEnvelope is { schema:'pi-mulligan'; v:1; kind:'rewind'|'shrink'|'turn-metric'|'cancel' }", () => {
    expectTypeOf<MulliganEnvelope>().toEqualTypeOf<{
      schema: "pi-mulligan";
      v: 1;
      kind: "rewind" | "shrink" | "turn-metric" | "cancel";
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

  it("RewindMarker/RewindMarkerInput carry optional hideEntryIds (fix_design.md §Change 1; backward-compat)", () => {
    // RewindMarkerInput is Omit<RewindMarker,…> → hideEntryIds propagates from RewindMarker. Omitted is valid:
    const withoutHide: RewindMarkerInput = REWIND_DATA; // already omits hideEntryIds → compiles (old markers)
    // …and present is valid (new markers):
    const withHide: RewindMarkerInput = { ...REWIND_DATA, hideEntryIds: ["e1", "e2"] };
    expectTypeOf(withHide.hideEntryIds).toEqualTypeOf<string[] | undefined>();
    expectTypeOf(withoutHide.hideEntryIds).toEqualTypeOf<string[] | undefined>();
  });

  it("TurnMetric has NO `id` field and deltaTokens is number | null (GOTCHA #4, #6)", () => {
    const m = {} as TurnMetric;
    expectTypeOf(m).not.toHaveProperty("id");
    expectTypeOf(m.deltaTokens).toEqualTypeOf<number | null>();
    expectTypeOf(m.kind).toEqualTypeOf<"turn-metric">();
  });

  it("CancelMarker extends the envelope and narrows kind to 'cancel' (no id field)", () => {
    const m = {} as CancelMarker;
    expectTypeOf(m.schema).toEqualTypeOf<"pi-mulligan">();
    expectTypeOf(m.v).toEqualTypeOf<1>();
    expectTypeOf(m.kind).toEqualTypeOf<"cancel">();
    expectTypeOf(m).not.toHaveProperty("id"); // GOTCHA #4 — a cancel is not itself cancellable
    expectTypeOf(m.targetId).toEqualTypeOf<string>();
    expectTypeOf(m.seq).toEqualTypeOf<number>();
    expectTypeOf(m.ts).toEqualTypeOf<number>();
  });

  it("CancelMarker is assignable to MulliganEnvelope (the union edit in Task 1 makes this compile)", () => {
    const m: CancelMarker = {
      schema: "pi-mulligan",
      v: 1,
      kind: "cancel",
      targetId: "t",
      seq: 1,
      ts: 0,
    };
    expectTypeOf(m).toMatchTypeOf<MulliganEnvelope>();
  });

  it("CancelMarkerInput equals exactly { targetId: string } (Omit of the wrapper-stamped fields)", () => {
    expectTypeOf<CancelMarkerInput>().toEqualTypeOf<{ targetId: string }>();
    const c: CancelMarkerInput = CANCEL_DATA;
    expectTypeOf(c.targetId).toEqualTypeOf<string>();
    expectTypeOf(c).not.toHaveProperty("seq");
    expectTypeOf(c).not.toHaveProperty("ts");
    expectTypeOf(c).not.toHaveProperty("schema");
    expectTypeOf(c).not.toHaveProperty("v");
    expectTypeOf(c).not.toHaveProperty("kind");
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

// ── leaveNote — sendMessage mulligan:note, in-context, no triggerTurn (spec/04 §3, spec/05 §1 step6; C8) ────

describe("leaveNote — sendMessage mulligan:note, in-context, no triggerTurn (C8)", () => {
  it("calls pi.sendMessage once with customType 'mulligan:note', display:true, content=renderedNote", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "RENDERED NOTE BODY", "rewind-entry-7");
    expect(sent).toHaveLength(1);
    expect(sent[0].customType).toBe("mulligan:note");
    expect(sent[0].content).toBe("RENDERED NOTE BODY");
    expect(sent[0].display).toBe(true);
  });

  it("stamps details envelope {schema, v:1, kind:'note', rewindId} and passes rewindId verbatim", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "x", "leaf-abc");
    expect(sent[0].details).toEqual({
      schema: "pi-mulligan",
      v: 1,
      kind: "note",
      rewindId: "leaf-abc",
    });
  });

  it("does NOT pass options (no triggerTurn) — sendMessage receives NO second arg (C8, GOTCHA #2)", () => {
    const { sent, pi } = makePi();
    leaveNote(pi, "n", "r");
    expect(sent[0].options).toBeUndefined();
  });

  it("does NOT call appendEntry or setLabel (the note is a sendMessage, not a marker/label)", () => {
    const { appended, labels, pi } = makePi();
    leaveNote(pi, "n", "r");
    expect(appended).toHaveLength(0);
    expect(labels).toHaveLength(0);
  });

  it("returns void", () => {
    const { pi } = makePi();
    expectTypeOf(leaveNote(pi, "n", "r")).toEqualTypeOf<void>();
  });

  it("never throws — a throwing sendMessage is swallowed (GOTCHA #1; marker already persisted by caller)", () => {
    const { pi } = makePi({ throwOnSendMessage: true });
    expect(() => leaveNote(pi, "n", "r")).not.toThrow();
    expect(leaveNote(pi, "n", "r")).toBeUndefined();
  });
});

// ── setCheckpoint — setLabel mulligan:checkpoint:<name> (spec/04 §6, spec/05 §3; C9, C1) ────────────────────

describe("setCheckpoint — labels the leaf with 'mulligan:checkpoint:<name>' (spec/04 §6, C9)", () => {
  it("calls pi.setLabel once with (stableId, 'mulligan:checkpoint:'+name) and returns {entryId: stableId}", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: "leaf-9" });
    const res = setCheckpoint(pi, ctx, "before-refactor");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" });
    expect(res).toEqual({ entryId: "leaf-9" });
  });

  it("owns the mulligan:checkpoint: namespace (prefixes); passes the raw name through", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: "L" });
    setCheckpoint(pi, ctx, "x_y-z1");
    expect(labels[0].label).toBe("mulligan:checkpoint:x_y-z1");
  });

  it("returns {error:'no stable entry to checkpoint'} when the branch has no message, and does NOT call setLabel", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null });   // → defaultBranch = [] (no stable message)
    const res = setCheckpoint(pi, ctx, "x");
    expect(res).toEqual({ error: "no stable entry to checkpoint" });
    expect(labels).toHaveLength(0);
  });

  it("never throws — a throwing setLabel yields {error: string} (try/catch)", () => {
    const { pi } = makePi({ throwOnSetLabel: true });
    const { ctx } = makeCtx();
    expect(() => setCheckpoint(pi, ctx, "x")).not.toThrow();
    const res = setCheckpoint(pi, ctx, "x");
    expect("error" in res).toBe(true);
    expect(typeof (res as { error: string }).error).toBe("string");
  });

  it("never throws — a throwing getBranch yields {error: string} (try/catch)", () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetBranch: true });
    expect(() => setCheckpoint(pi, ctx, "x")).not.toThrow();
    const res = setCheckpoint(pi, ctx, "x");
    expect("error" in res).toBe(true);
    expect(typeof (res as { error: string }).error).toBe("string");
  });

  it("writes through pi.setLabel, reads through ctx.sessionManager.getBranch (C1/C9 split — GOTCHA #3)", () => {
    const setLabelCalls: string[] = [];
    const getBranchCalls: string[] = [];
    const pi = {
      setLabel: (id: string, label: string) => {
        setLabelCalls.push(`setLabel:${id}:${label}`);
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      sessionManager: {
        getBranch: () => {
          getBranchCalls.push("getBranch");
          return [
            { type: "message", id: "u", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
            { type: "message", id: "L", parentId: "u", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
          ];
        },
      },
    } as unknown as ExtensionContext;
    const res = setCheckpoint(pi, ctx, "n");
    expect(setLabelCalls).toEqual(["setLabel:L:mulligan:checkpoint:n"]);
    expect(getBranchCalls).toEqual(["getBranch"]);
    expect(res).toEqual({ entryId: "L" });
  });

  it("labels the last real MESSAGE, not a non-message leaf (BUG-003): branch ending in a custom marker", () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: [
      { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
      { type: "message", id: "asst-7", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
      { type: "custom", id: "marker-leaf", parentId: "asst-7", timestamp: "t", customType: "mulligan:rewind", data: {} },
    ] });
    const res = setCheckpoint(pi, ctx, "ckpt");
    expect(res).toEqual({ entryId: "asst-7" });      // the last real MESSAGE, NOT the custom leaf "marker-leaf"
    expect(labels[0].entryId).toBe("asst-7");
    expect(labels[0].label).toBe("mulligan:checkpoint:ckpt");
  });

  it("returns the discriminated union {entryId:string} | {error:string}", () => {
    const { pi } = makePi();
    const ok = setCheckpoint(pi, makeCtx().ctx, "n");
    const fail = setCheckpoint(pi, makeCtx({ leafId: null }).ctx, "n");
    expectTypeOf(ok).toEqualTypeOf<{ entryId: string } | { error: string }>();
    expectTypeOf(fail).toEqualTypeOf<{ entryId: string } | { error: string }>();
  });
});

// ── NoteDetails / SetCheckpointResult types ──────────────────────────────────────────────────────────────────

describe("NoteDetails + SetCheckpointResult types (GOTCHA #5 — NoteDetails is NOT a MulliganEnvelope)", () => {
  it("NoteDetails is { schema:'pi-mulligan'; v:1; kind:'note'; rewindId:string }", () => {
    const d = {} as NoteDetails;
    expectTypeOf(d.schema).toEqualTypeOf<"pi-mulligan">();
    expectTypeOf(d.v).toEqualTypeOf<1>();
    expectTypeOf(d.kind).toEqualTypeOf<"note">();
    expectTypeOf(d.rewindId).toEqualTypeOf<string>();
  });

  it("NoteDetails is NOT assignable to MulliganEnvelope (kind 'note' ∉ the marker union)", () => {
    // @ts-expect-error — NoteDetails.kind:'note' is not in MulliganEnvelope.kind's union
    const _: MulliganEnvelope = {} as NoteDetails;
    expectTypeOf(_).toEqualTypeOf<MulliganEnvelope>();
  });

  it("SetCheckpointResult is the discriminated union", () => {
    const ok: SetCheckpointResult = { entryId: "x" };
    const err: SetCheckpointResult = { error: "boom" };
    expectTypeOf(ok).toMatchTypeOf<SetCheckpointResult>();
    expectTypeOf(err).toMatchTypeOf<SetCheckpointResult>();
    expectTypeOf<SetCheckpointResult>().toEqualTypeOf<{ entryId: string } | { error: string }>();
  });
});