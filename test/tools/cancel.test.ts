/**
 * cancel.test.ts — unit tests for the `mulligan_cancel` tool (src/tools/cancel.ts).
 *
 * Mirrors the house tool-test idiom from test/tools/shrink.test.ts + test/tools/rewind.test.ts:
 * vitest, hand-rolled `makePi()`/`makeCtx()` fakes (NO vi.fn()), `.js` import paths, `expectTypeOf` for
 * type assertions, `clearAll()` runtime reset (nextSeq mutates the shared module-scoped runtime map —
 * GOTCHA #8 in markers.test.ts). Reuses the markers.test.ts makePi shape (captures appendEntry).
 *
 * CRITICAL DIFFERENCE vs shrink.test.ts: cancel scans `ctx.sessionManager.getEntries()` FRESH (C12 — the
 * cancel tool's read surface; spec/05 §5 step 2). shrink's makeCtx scripts `buildContextEntries()`; cancel's
 * makeCtx scripts `getEntries()` instead (the SessionEntry[] the tool scans for the markerId→uuid mapping).
 *
 * Coverage (the PRP Task 5 case list — 7 cases):
 *   1. cancel an existing rewind → maps entry id → uuid targetId; appends mulligan:cancel; cancelled:true.
 *   2. cancel an existing shrink → identical to rewind (proves customType∈{rewind,shrink} both work).
 *   3. non-existent markerId → safe no-op; appendEntry NOT called; cancelled:false.
 *   4. already-cancelled marker → safe no-op; appendEntry NOT called; cancelled:false (idempotency).
 *   5. config.enabled===false → refusal text "Mulligan is disabled"; details:{} (E14 master gate).
 *   6. getEntries throws → outer try/catch → refusal text "unexpected error" (never throws — E13).
 *   7. registration metadata: makeCancelTool returns the correct ToolDefinition (name/label/desc/parameters).
 *
 * The DISTINCT entry-id vs data.id(uuid) fixture values (e.g. "entry-rw-1" vs "uuid-rw-1") PROVE the
 * markerId→targetId mapping — a bug that forwards the entry id as targetId would FAIL these assertions.
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  makeCancelTool,
  CancelParams,
  CANCEL_DESC,
  type CancelArgs,
  type CancelDetails,
} from "../../src/tools/cancel.js";
import { setConfig } from "../../src/config.js";
import { clearAll } from "../../src/runtime.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// GOTCHA #8: nextSeq (used INSIDE appendCancelMarker) mutates the SHARED module-scoped runtime map.
// clearAll() before AND after each test so a previous test's seq can't leak in.
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (markers.test.ts makePi shape — cancel only needs appendEntry + getLeafId/getSessionId) ─────

/**
 * A minimal fake ExtensionAPI capturing appendEntry calls (hand-rolled, NO vi.fn() — house pattern).
 * Set `throwOnAppend` to simulate a Pi appendEntry failure (appendCancelMarker swallows it → null).
 */
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
 * A minimal fake ExtensionContext for the CANCEL tool. Scripts:
 *   - sessionId (getSessionId — appendCancelMarker reads it for nextSeq; default "s1")
 *   - leafId (getLeafId — the captured marker entry id; default "leaf-1"; null → appendCancelMarker returns null)
 *   - entries (getEntries — SessionEntry[] the cancel tool scans for the markerId→uuid mapping; C12 FRESH read)
 * Set throwOnGetEntries to prove the outer try/catch wraps step 2 (appendCancelMarker's own catch makes the
 * append-throws path unreachable through the public API — getEntries throwing covers the outer catch).
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: SessionEntry[];
  throwOnGetEntries?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const entries = opts.entries ?? [];
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
    getLeafId() {
      return scriptedLeafId;
    },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return entries;
    },
  };
  return { ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Invoke the tool's execute with a minimal call signature (params + the fakes). toolCallId defaults to "call-1". */
async function run(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: CancelArgs,
  toolCallId = "call-1",
): Promise<AgentToolResult<CancelDetails>> {
  const tool = makeCancelTool(pi);
  // execute signature: (toolCallId, params, signal, onUpdate, ctx)
  return tool.execute(toolCallId, params, undefined, undefined, ctx);
}

/**
 * Extract the text from a result's first content block. This tool ONLY ever returns TextContent (never
 * ImageContent), but `content` is typed `(TextContent | ImageContent)[]` so we narrow with a runtime guard
 * before reading `.text` (shrink.test.ts precedent).
 */
function firstText(res: AgentToolResult<CancelDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

// ── fixture entry builders (DISTINCT entry.id vs data.id(uuid) to PROVE the mapping) ─────────────────

/**
 * A rewind marker entry fixture. The entry.id (what the agent passes as markerId) is DISTINCT from
 * data.id (the uuid that becomes the cancel's targetId) — a bug that forwards the entry id would fail
 * the targetId assertion. Minimal payload: the cancel tool only reads customType + data.id, but we include
 * the envelope fields so the fixture is a realistic CustomEntry (matches the persisted RewindMarker shape).
 */
function makeRewindEntry(entryId: string, uuid: string, seq = 1): SessionEntry {
  return {
    type: "custom",
    id: entryId,
    parentId: null,
    timestamp: "",
    customType: "mulligan:rewind",
    data: {
      schema: "pi-mulligan",
      v: 1,
      kind: "rewind",
      id: uuid,
      granularity: "last_turn",
      options: { to_previous_prompt: false, protect: ["first:user", "latest:user"] },
      excludeToolCallId: "call-1",
      note: {
        what_happened: "x",
        avoid: "y",
        true_current_state: "z",
        next: "w",
      },
      ledger: { readFiles: [], modifiedFiles: [], bashSideEffects: [] },
      seq,
      ts: 1,
    },
  } as unknown as SessionEntry;
}

/**
 * A shrink marker entry fixture. DISTINCT entry.id vs data.id(uuid). Minimal payload matching ShrinkMarker.
 */
function makeShrinkEntry(entryId: string, uuid: string, seq = 1): SessionEntry {
  return {
    type: "custom",
    id: entryId,
    parentId: null,
    timestamp: "",
    customType: "mulligan:shrink",
    data: {
      schema: "pi-mulligan",
      v: 1,
      kind: "shrink",
      id: uuid,
      target: { by_tool_call_id: "call-A" },
      replacement: "(shrink) summary",
      reason: "too big",
      seq,
      ts: 1,
    },
  } as unknown as SessionEntry;
}

/**
 * A cancel marker entry fixture. CancelMarker has NO id field (a cancel isn't cancellable); it carries
 * targetId (the uuid of the rewind/shrink it retired). Used to seed the already-cancelled no-op case.
 */
function makeCancelEntry(targetId: string, seq = 2): SessionEntry {
  return {
    type: "custom",
    id: `cancel-entry-${seq}`,
    parentId: null,
    timestamp: "",
    customType: "mulligan:cancel",
    data: {
      schema: "pi-mulligan",
      v: 1,
      kind: "cancel",
      targetId,
      seq,
      ts: 2,
    },
  } as unknown as SessionEntry;
}

// ── config: master enabled for the default happy-path cases (no config.cancel sub-knob exists) ────────
beforeEach(() => setConfig(undefined)); // DEFAULT_CONFIG: enabled:true

// ── Case 1: cancel an existing rewind → entry id → uuid targetId mapping (CRITICAL GOTCHA #1) ─────────

describe("mulligan_cancel — cancel an existing rewind (entry id → uuid targetId)", () => {
  it("appends a mulligan:cancel with targetId === the marker's uuid data.id (NOT the entry id)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1")] });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" }); // agent passes the ENTRY id

    // CRITICAL GOTCHA #1: targetId is the uuid (data.id), NOT the entry id. This catches the entry-id-as-targetId bug.
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:cancel");
    const entry = appended[0].data as Record<string, unknown>;
    expect(entry.targetId).toBe("uuid-rw-1"); // NOT "entry-rw-1"
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("cancel");
    expect(typeof entry.seq).toBe("number");
    expect(typeof entry.ts).toBe("number");

    // confirmation text + details
    expect(firstText(res)).toBe(
      "Mulligan: marker cancelled. The transform will no longer apply from the next turn on.",
    );
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });
});

// ── Case 2: cancel an existing shrink → identical behavior (customType∈{rewind,shrink}) ──────────────

describe("mulligan_cancel — cancel an existing shrink (identical to rewind)", () => {
  it("appends a mulligan:cancel with targetId === the shrink's uuid data.id", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [makeShrinkEntry("entry-sh-1", "uuid-sh-1")] });

    const res = await run(pi, ctx, { markerId: "entry-sh-1" });

    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:cancel");
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-1"); // the shrink's uuid
    expect(firstText(res)).toMatch(/marker cancelled/);
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });
});

// ── Case 3: non-existent markerId → safe no-op (appendEntry NOT called) ───────────────────────────────

describe("mulligan_cancel — non-existent markerId is a safe no-op (E21 (d) / E13)", () => {
  it("returns the no-op text, cancelled:false, and does NOT call appendEntry", async () => {
    const { appended, pi } = makePi();
    // a rewind exists, but the agent passes an id that matches nothing
    const { ctx } = makeCtx({ entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1")] });

    const res = await run(pi, ctx, { markerId: "nope" });

    expect(appended).toHaveLength(0); // appendCancelMarker NOT called
    expect(firstText(res)).toBe("Mulligan: no active marker found with that id — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });

  it("an entry whose data.id (uuid) is unreadable/missing is treated as not found (malformed marker)", async () => {
    const { appended, pi } = makePi();
    // a custom entry with the right id+customType but a malformed data (no id) → readOwn → undefined → skip
    const malformed: SessionEntry = {
      type: "custom",
      id: "entry-rw-1",
      parentId: null,
      timestamp: "",
      customType: "mulligan:rewind",
      data: { schema: "pi-mulligan", v: 1, kind: "rewind" }, // NO id (uuid) field
    } as unknown as SessionEntry;
    const { ctx } = makeCtx({ entries: [malformed] });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" });

    expect(appended).toHaveLength(0); // safe no-op — never persists a junk cancel
    expect(firstText(res)).toBe("Mulligan: no active marker found with that id — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });
});

// ── Case 4: already-cancelled marker → safe no-op (idempotency — GOTCHA #7) ───────────────────────────

describe("mulligan_cancel — already-cancelled marker is a safe no-op (idempotency)", () => {
  it("returns the already-cancelled text, cancelled:false, and does NOT call appendEntry again", async () => {
    const { appended, pi } = makePi();
    // a rewind marker + an existing cancel pointing at its uuid → already cancelled
    const { ctx } = makeCtx({
      entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1"), makeCancelEntry("uuid-rw-1")],
    });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" });

    expect(appended).toHaveLength(0); // NO duplicate cancel entry (idempotency)
    expect(firstText(res)).toBe("Mulligan: that marker is already cancelled.");
    expect(res.details).toEqual({ cancelled: false });
  });

  it("a cancel whose targetId points at a DIFFERENT uuid does NOT count as already-cancelled", async () => {
    const { appended, pi } = makePi();
    // the existing cancel targets a different marker → the rewind is still active → this cancel proceeds
    const { ctx } = makeCtx({
      entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1"), makeCancelEntry("uuid-some-other")],
    });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" });

    expect(appended).toHaveLength(1); // a NEW cancel is appended (the existing one targets a different uuid)
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-rw-1");
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });
});

// ── Case 5: config.enabled===false → refusal (E14 master gate; NO config.cancel sub-knob) ─────────────

describe("mulligan_cancel — config.enabled===false refuses (spec/08 E14)", () => {
  beforeEach(() => setConfig({ enabled: false }));
  afterEach(() => setConfig(undefined)); // reset to DEFAULT_CONFIG so the master-disabled state doesn't bleed

  it("refuses with 'Mulligan is disabled' and does NOT call appendEntry (details:{})", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1")] });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" });

    expect(appended).toHaveLength(0); // NO persistence on refusal
    expect(firstText(res)).toBe("Mulligan: refused — Mulligan is disabled.");
    expect(res.details).toEqual({}); // GOTCHA #3: details present ({}) on refusal — no `cancelled` field
  });
});

// ── Case 6: getEntries throws → outer try/catch → refusal (never throws — E13) ─────────────────────────

describe("mulligan_cancel — never throws (outer try/catch; spec/08 E13)", () => {
  it("a throwing getEntries → step-2 inner catch → [] → safe no-op (execute never rejects; E13)", async () => {
    // PRP step 2: getEntries() is wrapped in its OWN inner try/catch → [] (defense-in-depth). So a throwing
    // getEntries does NOT reach the OUTER catch — the scan runs over [], finds nothing, and returns the
    // "no active marker found" no-op. This is the intended (friendlier) behavior: a transient getEntries blip
    // yields a no-op rather than a refusal. The OUTER catch still guards everything else (appendCancelMarker's
    // own catch makes the append-throws path unreachable through the public API — covered by the next case).
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetEntries: true });

    await expect(run(pi, ctx, { markerId: "entry-rw-1" })).resolves.toBeDefined(); // never rejects
    const res = await run(pi, ctx, { markerId: "entry-rw-1" });
    expect(appended).toHaveLength(0); // nothing appended (the scan ran over [] and found nothing)
    expect(firstText(res)).toBe("Mulligan: no active marker found with that id — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false }); // no-op path (not a refusal)
  });

  it("a throwing appendEntry (inside appendCancelMarker → null) → tool STILL succeeds (cancelled:true, markerId:null)", async () => {
    // appendCancelMarker swallows the appendEntry throw and returns null — the tool reports cancelled:true
    // with markerId:null (the intent was recorded best-effort; mirrors how rewind/shrink report a failed leaf).
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({ entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1")] });

    const res = await run(pi, ctx, { markerId: "entry-rw-1" });
    expect(firstText(res)).toBe(
      "Mulligan: marker cancelled. The transform will no longer apply from the next turn on.",
    );
    expect(res.details).toEqual({ cancelled: true, markerId: null }); // still success; markerId null
  });
});

// ── Case 7: registration metadata (spec/05 §5: name/label/description/parameters) ────────────────────

describe("mulligan_cancel — registration metadata (spec/05 §5)", () => {
  it("name === 'mulligan_cancel', label === 'Mulligan Cancel', description === CANCEL_DESC verbatim", () => {
    const { pi } = makePi();
    const tool = makeCancelTool(pi);
    expect(tool.name).toBe("mulligan_cancel");
    expect(tool.label).toBe("Mulligan Cancel");
    expect(tool.description).toBe(CANCEL_DESC);
  });

  it("description is the spec/05 §5 verbatim string", () => {
    expect(CANCEL_DESC).toBe(
      "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
        "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
        "transform would apply on every turn for the rest of the session. Pass the markerId you received in details " +
        "when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on " +
        "disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.",
    );
  });

  it("parameters === CancelParams (the typebox schema)", () => {
    const { pi } = makePi();
    const tool = makeCancelTool(pi);
    expect(tool.parameters).toBe(CancelParams);
  });
});

// ── result shape (incl. `details` on EVERY path — CRITICAL GOTCHA #3) ────────────────────────────────

describe("mulligan_cancel — result shape (CRITICAL GOTCHA #3: `details` REQUIRED on every path)", () => {
  it("success: content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ entries: [makeRewindEntry("entry-rw-1", "uuid-rw-1")] });
    const res = await run(pi, ctx, { markerId: "entry-rw-1" });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
  });

  it("no-op (non-existent): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ entries: [] });
    const res = await run(pi, ctx, { markerId: "nope" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });

  it("refusal (disabled): content is [{type:'text', text:string}] AND details present", async () => {
    setConfig({ enabled: false });
    afterEach(() => setConfig(undefined));
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { markerId: "x" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });
});

// ── types (ToolDefinition + CancelParams inference) ──────────────────────────

describe("mulligan_cancel — types (ToolDefinition + CancelParams inference)", () => {
  it("makeCancelTool(...) is a ToolDefinition<typeof CancelParams, CancelDetails>", () => {
    const { pi } = makePi();
    const tool = makeCancelTool(pi);
    // The factory's declared return type is exactly the parameterized ToolDefinition.
    expectTypeOf(tool).toEqualTypeOf<ToolDefinition<typeof CancelParams, CancelDetails>>();
    // narrower: the params schema is exactly CancelParams.
    expectTypeOf(tool.parameters).toEqualTypeOf(CancelParams);
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });

  it("CancelArgs (Static<typeof CancelParams>) is { markerId: string }", () => {
    const args = {} as CancelArgs;
    expectTypeOf(args.markerId).toEqualTypeOf<string>();
  });

  it("execute returns AgentToolResult<CancelDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { markerId: "x" });
    expectTypeOf(res).toEqualTypeOf<AgentToolResult<CancelDetails>>();
  });
});