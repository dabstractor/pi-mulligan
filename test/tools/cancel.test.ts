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
// S3: ShrinkTarget is the structural type for a shrink/cancel `target` selector (imported to type the
// makeShrinkEntry opts.target param). `as unknown as ShrinkTarget` is NOT needed at the fixture level —
// a plain object literal with a discriminator key assigns in structurally (no cast), matching shrink.test.ts.
import type { ShrinkTarget } from "../../src/transforms.js";
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
  /** buildContextEntries() return — the message snapshot the TARGET path flattens (S3). */
  contextEntries?: SessionEntry[];
  throwOnGetEntries?: boolean;
  /** a throwing buildContextEntries → resolveTargetUuid's try/catch → null → step-4 no-op (S3). */
  throwOnBuildContextEntries?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const entries = opts.entries ?? [];
  const contextEntries = opts.contextEntries ?? [];
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
    // S3: the TARGET path calls buildContextEntries() (then flatMaps it via sessionEntryToContextMessages).
    // Structurally identical to shrink.test.ts's makeCtx arm (the verified precedent). The markerId path
    // NEVER calls this, so defaulting to [] keeps every existing markerId-path case unchanged.
    buildContextEntries() {
      if (opts.throwOnBuildContextEntries) throw new Error("buildContextEntries boom");
      return contextEntries;
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
 *
 * S3: `opts.hideEntryIds` lets a rewind COVER a matched message (the rewind-covering check is
 * `matchedEntryId ∈ data.hideEntryIds`). `opts.seq` parameterizes the LIFO tiebreak (default 1). The legacy
 * positional `seq` 3rd-arg form (number) is preserved so the existing markerId-path cases compile unchanged.
 */
function makeRewindEntry(
  entryId: string,
  uuid: string,
  seqOrOpts: number | { seq?: number; hideEntryIds?: string[] } = {},
): SessionEntry {
  const opts = typeof seqOrOpts === "number" ? { seq: seqOrOpts } : seqOrOpts;
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
      hideEntryIds: opts.hideEntryIds ?? [],
      seq: opts.seq ?? 1,
      ts: 1,
    },
  } as unknown as SessionEntry;
}

/**
 * A shrink marker entry fixture. DISTINCT entry.id vs data.id(uuid). Minimal payload matching ShrinkMarker.
 *
 * S3: `opts.target` parameterizes the shrink's OWN selector (a shrink COVERS the matched message iff
 * resolving its own target against the snapshot === matchedIndex — so set its target to the same selector
 * the cancel is using, or one resolving to the same message). `opts.seq` parameterizes the LIFO tiebreak.
 * The legacy positional `seq` 3rd-arg form (number) is preserved so the existing markerId-path cases compile
 * unchanged (default target {by_tool_call_id:"call-A"}).
 */
function makeShrinkEntry(
  entryId: string,
  uuid: string,
  seqOrOpts: number | { seq?: number; target?: ShrinkTarget } = {},
): SessionEntry {
  const opts = typeof seqOrOpts === "number" ? { seq: seqOrOpts } : seqOrOpts;
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
      target: opts.target ?? { by_tool_call_id: "call-A" },
      replacement: "(shrink) summary",
      reason: "too big",
      seq: opts.seq ?? 1,
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

// ── snapshot-entry builders (S3: buildContextEntries() fixtures — shrink.test.ts GOTCHA #12 idiom) ─────

/**
 * A module-scoped counter for snapshot entry ids (mirrors shrink.test.ts's `entrySeq`). Reset per-test via
 * `resetSnapshotSeq()` (called from the S3 describe's beforeEach) so two tests can't collide on `e-1`.
 */
let entrySeq = 0;
function resetSnapshotSeq() {
  entrySeq = 0;
}

/**
 * A single message-as-entry in the snapshot (buildContextEntries returns SessionEntry[]; we cast through
 * `as unknown as SessionEntry`). The tool flattens via the REAL sessionEntryToContextMessages, which returns
 * [entry.message] for a `{type:"message", message:{...}}` entry (verified Pi shape — GOTCHA #12). We build
 * the entry by spreading the role + extra fields (toolCallId/toolName/content) into `message`. The entry.id
 * (e.g. "e-1") is what rewind-covering checks (`matchedEntryId ∈ hideEntryIds`) match against.
 */
function msgEntry(role: string, extra: Record<string, unknown> = {}): SessionEntry {
  entrySeq += 1;
  return {
    type: "message",
    id: `e-${entrySeq}`,
    parentId: null,
    timestamp: "",
    message: { role, ...extra },
  } as unknown as SessionEntry;
}

/** Build a toolResult message fixture (role:"toolResult", toolCallId, toolName, content blocks). */
function toolResult(toolCallId: string, toolName: string, text: string): Record<string, unknown> {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
  };
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

  it("description is the spec/05 §6 verbatim string", () => {
    expect(CANCEL_DESC).toBe(
      "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
        "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
        "transform would apply on every turn for the rest of the session. Identify the marker by `target` " +
        "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — " +
        "the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. " +
        "The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). " +
        "Cancelling a non-existent or already-cancelled marker is a safe no-op.",
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

  it("CancelArgs (Static<typeof CancelParams>) is { target?: <union>; markerId?: string } (Decision D1)", () => {
    const args = {} as CancelArgs;
    // Both target and markerId are Optional per Decision D1 (markerId-ALONE must remain a valid call).
    expectTypeOf(args.markerId).toEqualTypeOf<string | undefined>();
    expectTypeOf(args.target).toEqualTypeOf<CancelArgs["target"]>();
  });

  it("execute returns AgentToolResult<CancelDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { markerId: "x" });
    expectTypeOf(res).toEqualTypeOf<AgentToolResult<CancelDetails>>();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// S3 / P1.M1.T1.S3 — cancel-by-TARGET resolution (spec/10 §1.11 cases (a)-(g)).
//
// The TARGET path (resolveTargetUuid in src/tools/cancel.ts) is the code under test. It builds a message
// snapshot (buildContextEntries().flatMap(sessionEntryToContextMessages)), resolves params.target → a
// matched message INDEX (resolveShrinkTarget), maps that index → its ENTRY id (entryIdAtMessageIndex), then
// scans the marker `entries` (getEntries) for the MOST RECENT active rewind/shrink whose effect COVERS that
// message (shrink: its OWN data.target resolves to the index; rewind: the index's entry id ∈ data.hideEntryIds;
// LIFO by data.seq) → that marker's uuid data.id is the cancel's targetId.
//
// `contextEntries` = the snapshot (buildContextEntries). `entries` = the markers (getEntries). They are
// SEPARATE arrays in the fake but ALIGNED by the entry-id invariant (a rewind's hideEntryIds must hold the
// snapshot entry's id that yields the matched message). DISTINCT entry.id vs data.id(uuid) EVERYWHERE proves
// the uuid mapping (a bug forwarding the entry id fails the assertion). nextSeq leaks across tests via the
// shared runtime map → clearAll() in the global beforeEach/afterEach (GOTCHA #8) + resetSnapshotSeq() here.
//
// BUG-006 (fixed): cancel.ts emits PATH-SPECIFIC not-found text. The markerId path returns "with that id"
// (unchanged); the target path returns the spec/05 §5 verbatim "for that target" text. The target-path
// no-op cases below pin the target-specific string (markerId-path cases above pin "with that id").
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe("mulligan_cancel — target path (spec/10 §1.11 (a)-(g))", () => {
  beforeEach(() => resetSnapshotSeq()); // per-test isolation: no two tests collide on `e-1`

  // ── Case (a): by_tool_call_id → single covering marker (shrink OR rewind) ────────────────────────────

  it("(a1) by_tool_call_id: a shrink whose own target resolves to the matched message → covers → retired", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log"))], // → msg idx 0, entry id e-1
      entries: [
        makeShrinkEntry("entry-sh-1", "uuid-sh-1", {
          target: { by_tool_call_id: "call-A" }, // shrink's own target resolves to idx 0 === matchedIndex
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:cancel");
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-1"); // the shrink's uuid
    expect(firstText(res)).toBe(
      "Mulligan: marker cancelled. The transform will no longer apply from the next turn on.",
    );
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  it("(a2) by_tool_call_id: a rewind whose hideEntryIds includes the matched message's ENTRY id → covers → retired", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log"))], // msg idx 0, entry id e-1
      entries: [
        makeRewindEntry("entry-rw-1", "uuid-rw-1", {
          hideEntryIds: ["e-1"], // the matched message's ENTRY id → this rewind covers idx 0
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(1);
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-rw-1"); // the rewind's uuid
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  // ── Case (b): by_tool_name + occurrence → most-recent covering the LAST/FIRST of that name ───────────

  it("(b-last) by_tool_name:'read', occurrence:'last' → covers the SECOND read (idx 1), not the first", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry("toolResult", toolResult("c1", "read", "first")), // idx 0, entry id e-1
        msgEntry("toolResult", toolResult("c2", "read", "second")), // idx 1, entry id e-2
      ],
      entries: [
        makeShrinkEntry("entry-sh-2", "uuid-sh-2", {
          target: { by_tool_name: "read", occurrence: "last" }, // resolves to idx 1 === matchedIndex
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_name: "read", occurrence: "last" } });

    expect(appended).toHaveLength(1);
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-2"); // covers the LAST read
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  it("(b-first) by_tool_name:'read', occurrence:'first' → the selector is HONORED (covers idx 0, not idx 1)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry("toolResult", toolResult("c1", "read", "first")), // idx 0, entry id e-1
        msgEntry("toolResult", toolResult("c2", "read", "second")), // idx 1, entry id e-2
      ],
      entries: [
        // a shrink whose target resolves to idx 0 (FIRST read) — covers a {occurrence:'first'} cancel
        makeShrinkEntry("entry-sh-first", "uuid-sh-first", {
          target: { by_tool_name: "read", occurrence: "first" },
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_name: "read", occurrence: "first" } });

    expect(appended).toHaveLength(1);
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-first");
    expect(res.details.cancelled).toBe(true);
  });

  // ── Case (c): by_content_includes → most-recent covering a message with the substring ────────────────

  it("(c) by_content_includes: a message whose content includes the substring → covering marker retired", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry("toolResult", toolResult("call-A", "bash", 'df -h ... "ENOSPC at /disk"')),
      ],
      entries: [
        makeShrinkEntry("entry-sh-enospc", "uuid-sh-enospc", {
          target: { by_content_includes: "ENOSPC" }, // resolves to idx 0 === matchedIndex
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_content_includes: "ENOSPC" } });

    expect(appended).toHaveLength(1);
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-enospc");
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  it("(c-neg) by_content_includes with an absent substring → no message matches → no-op (covered in case e)", async () => {
    // This is the NEGATIVE arm of (c): an unmatched substring drives matchedIndex===null → no marker covers.
    // Asserted fully as case (e) below (same no-op path); here we just confirm the substring truly doesn't match.
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "bash", 'all good'))],
      entries: [],
    });

    await run(pi, ctx, { target: { by_content_includes: "ZZZ-NOT-PRESENT" } });
    expect(appended).toHaveLength(0); // no match → no marker covers → nothing appended
  });

  // ── Case (d): several markers cover → MOST RECENT by seq (LIFO); rest stay active ────────────────────

  it("(d1) TWO shrinks both cover → the HIGHER-seq (newer) one is retired; exactly ONE cancel appended", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))], // idx 0, entry id e-1
      entries: [
        makeShrinkEntry("entry-sh-old", "uuid-sh-old", {
          target: { by_tool_call_id: "call-A" },
          seq: 1, // OLDER
        }),
        makeShrinkEntry("entry-sh-new", "uuid-sh-new", {
          target: { by_tool_call_id: "call-A" },
          seq: 5, // NEWER → wins (LIFO by seq)
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(1); // EXACTLY ONE cancel (the older marker is NOT retired by this call)
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-new"); // higher seq wins
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  it("(d2) cross-marker-type LIFO: a rewind (seq 5) beats a shrink (seq 1) when BOTH cover", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))], // idx 0, entry id e-1
      entries: [
        makeShrinkEntry("entry-sh-low", "uuid-sh-low", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
        makeRewindEntry("entry-rw-high", "uuid-rw-high", {
          hideEntryIds: ["e-1"],
          seq: 5, // higher seq → wins even though it's a DIFFERENT marker type than the shrink
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(1);
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-rw-high"); // rewind wins (seq 5 > 1)
    expect(res.details.cancelled).toBe(true);
  });

  // ── Case (e): no active marker covers → safe no-op (cancelled:false); nothing appended ───────────────

  it("(e1) target matches a message, but NO marker covers it → no-op (cancelled:false, nothing appended)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))], // matchedIndex=0
      entries: [
        // a shrink whose target resolves to a DIFFERENT index (call-B) → does NOT cover idx 0
        makeShrinkEntry("entry-sh-other", "uuid-sh-other", {
          target: { by_tool_call_id: "call-B" },
          seq: 1,
        }),
        // a rewind hiding a DIFFERENT entry id (e-9) → does NOT cover the matched entry id e-1
        makeRewindEntry("entry-rw-other", "uuid-rw-other", {
          hideEntryIds: ["e-9"],
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(0); // markers EXIST but none COVER → no-op
    expect(firstText(res)).toBe("Mulligan: no active marker found for that target — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });

  it("(e2) target matches NOTHING (matchedIndex null) → no marker can cover → no-op", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-Z", "read", "unrelated"))], // call-A unmatched
      entries: [
        makeShrinkEntry("entry-sh-a", "uuid-sh-a", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(0);
    expect(firstText(res)).toBe("Mulligan: no active marker found for that target — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });

  it("(e3) empty snapshot (contextEntries:[]) → matchedIndex null → no-op (nothing covers)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [], // no messages → resolveShrinkTarget returns null
      entries: [
        makeShrinkEntry("entry-sh-a", "uuid-sh-a", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(0);
    expect(firstText(res)).toBe("Mulligan: no active marker found for that target — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });

  // ── Case (f): explicit markerId fallback — does NOT call buildContextEntries (the markerId path) ─────
  // (markerId-only success/no-op are already covered by Cases 1 & 3 above; this case adds the
  // markerId-WINS-OVER-target ordering — Decision D1.)

  it("(f) markerId WINS when both target and markerId are given → the markerId marker is retired (NOT the target one)", async () => {
    const { appended, pi } = makePi();
    // target would resolve to uuid-sh-target, BUT markerId points at a DIFFERENT marker (uuid-rw-markerId).
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))], // target resolves to idx 0
      entries: [
        makeShrinkEntry("entry-sh-target", "uuid-sh-target", {
          target: { by_tool_call_id: "call-A" },
          seq: 9, // high seq — would win IF the target path ran
        }),
        makeRewindEntry("entry-rw-markerId", "uuid-rw-markerId", { seq: 1 }), // markerId points HERE
      ],
    });

    const res = await run(pi, ctx, {
      target: { by_tool_call_id: "call-A" },
      markerId: "entry-rw-markerId", // markerId wins → the target path is NEVER consulted
    });

    expect(appended).toHaveLength(1);
    // the markerId marker's uuid — NOT the target-resolved shrink's uuid (proves markerId-wins ordering)
    expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-rw-markerId");
    expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  });

  // ── Case (g): integrity of the appended cancel entry (layered onto a representative success) ─────────

  it("(g) success appends a well-formed mulligan:cancel: schema/v/kind/targetId(uuid)/seq/ts", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))],
      entries: [
        makeShrinkEntry("entry-sh-1", "uuid-sh-1", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(res.details.cancelled).toBe(true);
    expect(res.details.markerId).toBe("leaf-1"); // the fake's getLeafId
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:cancel");
    const data = appended[0].data as Record<string, unknown>;
    expect(data.schema).toBe("pi-mulligan");
    expect(data.v).toBe(1);
    expect(data.kind).toBe("cancel");
    expect(data.targetId).toBe("uuid-sh-1"); // the uuid (data.id), NEVER the entry id
    expect(typeof data.seq).toBe("number"); // stamped by nextSeq (first marker → 1)
    expect(typeof data.ts).toBe("number");
    expect(data.ts).toBeLessThanOrEqual(Date.now());
  });

  // ── Case (g-extra): target-path already-cancelled marker is a safe no-op (idempotency; GOTCHA #7) ────

  it("(g-idempotent) an existing cancel targeting the resolved uuid → no-op (no duplicate cancel appended)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))], // idx 0
      entries: [
        makeShrinkEntry("entry-sh-1", "uuid-sh-1", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
        makeCancelEntry("uuid-sh-1"), // an existing cancel whose targetId === the shrink's uuid
      ],
    });

    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });

    expect(appended).toHaveLength(0); // already cancelled → NO duplicate cancel (idempotency)
    expect(firstText(res)).toBe("Mulligan: that marker is already cancelled.");
    expect(res.details).toEqual({ cancelled: false });
  });

  // ── Case (g-error): a throwing buildContextEntries → resolveTargetUuid try/catch → null → no-op ──────

  it("(g-error) a throwing buildContextEntries → resolveTargetUuid catches → null → step-4 no-op (never throws)", async () => {
    // resolveTargetUuid wraps its body in try/catch → null on a throwing buildContextEntries. That null feeds
    // step 4 (not-found no-op) — NOT the outer refusal (the outer catch only fires for something resolveTargetUuid
    // doesn't cover). So this is the friendly no-op text, with cancelled:false (E13 — execute never rejects).
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      throwOnBuildContextEntries: true, // buildContextEntries() blows up inside resolveTargetUuid
      entries: [
        makeShrinkEntry("entry-sh-1", "uuid-sh-1", {
          target: { by_tool_call_id: "call-A" },
          seq: 1,
        }),
      ],
    });

    await expect(run(pi, ctx, { target: { by_tool_call_id: "call-A" } })).resolves.toBeDefined();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });
    expect(appended).toHaveLength(0); // null targetUuid → no-op
    expect(firstText(res)).toBe("Mulligan: no active marker found for that target — nothing to cancel.");
    expect(res.details).toEqual({ cancelled: false });
  });
});