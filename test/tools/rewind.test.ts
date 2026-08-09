/**
 * rewind.test.ts — unit tests for the `mulligan_rewind` tool (src/tools/rewind.ts).
 *
 * Mirrors the house test idiom from test/tools/checkpoint.test.ts + test/markers.test.ts: vitest, hand-rolled
 * `makePi()`/`makeCtx()` fakes (NO vi.fn()), `.js` import paths, `expectTypeOf` for type assertions,
 * `clearAll()` runtime reset before/after each test (nextSeq mutates the shared module-scoped runtime map).
 *
 * Coverage (the PRP Task 6–10 case list):
 *   a) registration metadata (spec/05 §5): name/label/description(parameters).
 *   b) the 4 refusal paths: config-disabled (E14); invalid note (E9); checkpoint not found (E10); maxDepth (E4).
 *   c) success path (the contract): marker persisted with the EXACT payload (granularity, options, excludeToolCallId
 *      === toolCallId, note, ledger, checkpoint — gotcha #1), note left, success text with K.
 *   d) K=0 honesty ("nothing matched to hide"); mutation warning (spec/08 E5 VERBATIM); best-effort ledger
 *      (snapshot-throw → empty ledger + K=0 + still success — E13/E8).
 *   e) never-throws; result shape (details on every path — GOTCHA #4); types (ToolDefinition/AgentToolResult).
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  makeRewindTool,
  RewindParams,
  REWIND_DESC,
  type RewindArgs,
  type RewindDetails,
} from "../../src/tools/rewind.js";
import { NOTE_INVALID_REASON, renderNote } from "../../src/notes.js";
import { clearAll, getRuntime } from "../../src/runtime.js";
import { setConfig } from "../../src/config.js";
import type { RewindMarker, RewindMarkerInput } from "../../src/markers.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// GOTCHA (shared with markers.test.ts): nextSeq mutates the SHARED module-scoped runtime map. clearAll() before
// AND after each test so a previous test's seq can't leak in (appendRewindMarker calls nextSeq internally).
// ALSO reset the config cache to defaults (setConfig(undefined)) — several tests setConfig({rewind:{enabled:false}})
// or custom maxDepth/requireMutationWarning; without the reset, the poisoned cache leaks into sibling tests.
beforeEach(() => {
  clearAll();
  setConfig(undefined); // reset the config cache to validated DEFAULT_CONFIG
});
afterEach(() => {
  clearAll();
  setConfig(undefined);
});

// ── the canonical valid note (4 non-empty fields) ────────────────────────────

const VALID_NOTE = {
  what_happened: "Ran a repo-wide grep that dumped ~38k tokens.",
  avoid: "Don't grep without -l; use the built-in grep tool which truncates.",
  true_current_state: "No files changed on the abandoned span.",
  next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
};

// ── fakes (the markers.test.ts makePi shape + a richer makeCtx that scripts getEntries/getBranch/buildContextEntries) ─

/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel (hand-rolled, no vi.fn()). */
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
    options?: unknown;
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
 * A minimal fake ExtensionContext. Scripts:
 *   - leafId (getLeafId — the captured marker entry id; default "leaf-1")
 *   - sessionId (default "s1")
 *   - entries (getEntries — rewind-marker entries for the depth guard + label entries for checkpoint existence)
 *   - branch (getBranch — SessionEntry[] root→leaf for checkpoint resolution)
 *   - contextEntries (buildContextEntries — SessionEntry[] snapshot flattened to messages for the ledger/K preview)
 * Set throwOnGetEntries / throwOnBuildContext to simulate failures.
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: unknown[];
  branch?: unknown[];
  contextEntries?: unknown[];
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
  throwOnBuildContext?: boolean;
  throwOnGetLeafId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const leafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const entries = opts.entries ?? [];
  const branch = opts.branch ?? [];
  const contextEntries = opts.contextEntries ?? [];
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
    getLeafId() {
      if (opts.throwOnGetLeafId) throw new Error("getLeafId boom");
      return leafId;
    },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return entries;
    },
    getBranch() {
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return branch;
    },
    buildContextEntries() {
      if (opts.throwOnBuildContext) throw new Error("buildContextEntries boom");
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
  params: RewindArgs,
  toolCallId = "call-1",
): Promise<AgentToolResult<RewindDetails>> {
  const tool = makeRewindTool(pi);
  // execute signature: (toolCallId, params, signal, onUpdate, ctx)
  return tool.execute(toolCallId, params, undefined, undefined, ctx);
}

/** Extract the text from a result's first content block (narrows TextContent before reading .text). */
function firstText(res: AgentToolResult<RewindDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/** A rewind marker entry (customType "mulligan:rewind") for the depth guard. */
function rewindEntry(seq = 1): { type: "custom"; customType: "mulligan:rewind"; data: { seq: number } } {
  return { type: "custom", customType: "mulligan:rewind", data: { seq } };
}

/** A turn-metric marker entry (customType "mulligan:turn-metric") with the given turnIndex + seq, for the
 *  P4.M1.T2.S3 refused-rewind flag tests (rewind.ts reads readMarkers(ctx).metric?.turnIndex). */
function metricEntry(turnIndex: number, seq = turnIndex): { type: "custom"; customType: "mulligan:turn-metric"; data: Record<string, unknown> } {
  return {
    type: "custom",
    customType: "mulligan:turn-metric",
    data: { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: 1, turnIndex, deltaTokens: 100,
      bloatHit: false, bloatHits: [], grewOverThreshold: false },
  };
}

/** A checkpoint label entry. */
function checkpointLabelEntry(name: string, targetId = "leaf-1"): {
  type: "label";
  targetId: string;
  label: string;
} {
  return { type: "label", targetId, label: `mulligan:checkpoint:${name}` };
}

/** A single message-as-entry in the snapshot (buildContextEntries returns SessionEntry[]; we cast through unknown).
 *  For the ledger/K preview, the tool flattens via sessionEntryToContextMessages. We pass entries that the REAL
 *  sessionEntryToContextMessages converts: {type:"message", message:{role,content}} (verified Pi shape). */
function msgEntry(message: Record<string, unknown>): { type: "message"; id: string; message: Record<string, unknown> } {
  return { type: "message", id: `e-${Math.random().toString(36).slice(2)}`, message };
}

/** Build an assistant message whose content is a list of toolCall blocks with the given ids (mirror transforms.test.ts). */
function asst(...callIds: string[]): Record<string, unknown> {
  return {
    role: "assistant",
    content: callIds.map((id) => ({ type: "toolCall", id, name: "tool", arguments: {} })),
  };
}

/** Build a toolResult message (mirror transforms.test.ts). */
function result(toolCallId: string): Record<string, unknown> {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: "..." }],
    isError: false,
  };
}

/** Build an assistant message whose toolCall is a `write` to a path (for the mutation-warning ledger test). */
function asstWrite(callId: string, file_path: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "write", arguments: { file_path } }],
  };
}

/** Build an assistant message whose toolCall is a mutating bash command (bashSideEffects). */
function asstBash(callId: string, command: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "bash", arguments: { command } }],
  };
}

/** Build a user message. */
function user(text: string): Record<string, unknown> {
  return { role: "user", content: text };
}

// ── registration metadata (spec/05 §5) ──────────────────────────────────────

describe("mulligan_rewind — registration metadata (spec/05 §5)", () => {
  it("name === 'mulligan_rewind', label === 'Mulligan Rewind', description === REWIND_DESC verbatim", () => {
    const { pi } = makePi();
    const tool = makeRewindTool(pi);
    expect(tool.name).toBe("mulligan_rewind");
    expect(tool.label).toBe("Mulligan Rewind");
    expect(tool.description).toBe(REWIND_DESC);
  });

  it("description is the spec/05 §5 verbatim string", () => {
    expect(REWIND_DESC).toBe(
      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The hidden content disappears from your view permanently (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message.",
    );
  });

  it("parameters === RewindParams (the typebox Type.Object)", () => {
    const { pi } = makePi();
    const tool = makeRewindTool(pi);
    expect(tool.parameters).toBe(RewindParams);
  });
});

// ── refusal path 1: config disabled (step 1; E14) ───────────────────────────

describe("mulligan_rewind — refusal: config disabled (step 1; E14)", () => {
  it("config.rewind.enabled === false → refusal text; appendRewindMarker NOT called", async () => {
    setConfig({ rewind: { enabled: false } });
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
    expect(appended).toHaveLength(0); // no marker
    expect(sent).toHaveLength(0); // no note
    expect(res.details).toEqual({ granularity: "last_tool_call_group" });
  });

  it("the disabled refusal does NOT depend on note validity (config gate is step 1, BEFORE note validation)", async () => {
    setConfig({ rewind: { enabled: false } });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: { ...VALID_NOTE, what_happened: "" }, granularity: "last_turn" });
    expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "last_turn" });
  });
});

// ── refusal path 2: invalid note (step 2; E9) ───────────────────────────────

describe("mulligan_rewind — refusal: invalid note (step 2; E9)", () => {
  it.each([
    ["empty what_happened", { ...VALID_NOTE, what_happened: "" }],
    ["whitespace-only avoid", { ...VALID_NOTE, avoid: "   " }],
    ["empty true_current_state", { ...VALID_NOTE, true_current_state: "" }],
    ["whitespace-only next", { ...VALID_NOTE, next: "\t\n" }],
  ])("rejects %s → NOTE_INVALID_REASON refusal; no persistence", async (_label, note) => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note, granularity: "last_tool_call_group" });
    expect(firstText(res)).toBe(`Mulligan: refused — ${NOTE_INVALID_REASON}.`);
    expect(appended).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "last_tool_call_group" });
  });
});

// ── refusal path 3: checkpoint granularity existence (step 3; E10) ──────────

describe("mulligan_rewind — refusal: checkpoint existence (step 3; E10)", () => {
  it("granularity 'checkpoint' with NO checkpoint name → refusal", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — checkpoint granularity requires a checkpoint name.",
    );
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "checkpoint" });
  });

  it("granularity 'checkpoint', name 'nope', NO matching label → refusal", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] }); // no labels
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "nope" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — checkpoint 'nope' not found on this branch.",
    );
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "checkpoint" });
  });

  it("a checkpoint that EXISTS → passes the existence check (proceeds to depth/preview/success)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [], // no messages → resolveCheckpoint remove=[] → K=0, empty ledger (still success)
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    expect(appended).toHaveLength(1); // marker persisted (existence passed)
  });

  it("last_tool_call_group / last_turn are ALWAYS valid (no checkpoint scan)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] }); // no labels — irrelevant for relative granularity
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
    expect(firstText(res)).toContain("Mulligan: rewound last_turn.");
    expect(appended).toHaveLength(1);
  });
});

// ── refusal path 4: depth guard (step 4; E4) ────────────────────────────────

describe("mulligan_rewind — refusal: depth guard (step 4; E4; default maxDepth=5)", () => {
  it("exactly maxDepth (5) active rewind markers → refusal naming the count + suggesting shrink/continue", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [rewindEntry(1), rewindEntry(2), rewindEntry(3), rewindEntry(4), rewindEntry(5)],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: refused —");
    expect(firstText(res)).toContain("max rewind depth (5) reached");
    expect(firstText(res)).toContain("5 active rewind marker(s)");
    expect(firstText(res)).toContain("mulligan_shrink");
    expect(appended).toHaveLength(0); // no new marker
    expect(res.details).toEqual({ granularity: "last_tool_call_group" });
  });

  it("fewer than maxDepth (4) → still succeeds (boundary)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [rewindEntry(1), rewindEntry(2), rewindEntry(3), rewindEntry(4)],
      contextEntries: [],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1);
  });

  it("honors a custom maxDepth (set via config)", async () => {
    setConfig({ rewind: { maxDepth: 1 } });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [rewindEntry(1)] });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("max rewind depth (1) reached");
    expect(appended).toHaveLength(0);
  });
});

// ── P4.M1.T2.S3: refused-rewind flag (rt.rewindRefusedTurnIndex) ────────────

describe("mulligan_rewind — refusal latches rt.rewindRefusedTurnIndex (P4.M1.T2.S3)", () => {
  it("a refused rewind latches rt.rewindRefusedTurnIndex to the latest metric turnIndex (P4.M1.T2.S3)", async () => {
    // Trigger a refusal via an invalid note (E9 path). The latest turn-metric has turnIndex 7 → flag = 7.
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", entries: [metricEntry(7)] });
    const res = await run(pi, ctx, { note: { ...VALID_NOTE, what_happened: "" }, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: refused —");
    expect(getRuntime("s1").rewindRefusedTurnIndex).toBe(7); // latched to the latest metric turnIndex
  });

  it("a SUCCESSFUL rewind does NOT set the flag (P4.M1.T2.S3)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({
      sessionId: "s1",
      entries: [metricEntry(3)],
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(firstText(res)).toContain("Mulligan: rewound"); // success
    expect(getRuntime("s1").rewindRefusedTurnIndex).toBeNull(); // success never sets the flag
  });

  it("a refusal when no turn-metric exists leaves the flag null and never throws (E13)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", entries: [] }); // NO metric entries → currentTurnIndex null
    const res = await run(pi, ctx, { note: { ...VALID_NOTE, what_happened: "" }, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: refused —");
    expect(getRuntime("s1").rewindRefusedTurnIndex).toBeNull(); // no metric → flag stays null
  });
});

// ── success path: the persisted contract (step 7; gotcha #1 + #2) ───────────

describe("mulligan_rewind — success path: the persisted marker contract (spec/05 §1 step6; gotcha #1/#2)", () => {
  it("persists a mulligan:rewind marker with the EXACT payload (granularity, options, excludeToolCallId === toolCallId, note, ledger, checkpoint)", async () => {
    const { appended, sent, pi } = makePi();
    // snapshot: [user, asst("X"), result("X"), asst("call-1"), result("call-1")].
    // last_tool_call_group excludes the rewind's OWN group (toolCallId "call-1") → resolves to [1,2] → K=2.
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");

    // marker persisted exactly once
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:rewind");
    const entry = appended[0].data as RewindMarker;
    expect(entry.granularity).toBe("last_tool_call_group");
    expect(entry.options).toEqual({ to_previous_prompt: undefined, protect: ["first:user", "latest:user"] });
    expect(entry.excludeToolCallId).toBe("call-1"); // GOTCHA #2: === toolCallId (the execute first arg)
    expect(entry.note).toEqual(VALID_NOTE);
    expect(entry.ledger).toBeDefined(); // a FileLedger object
    // GOTCHA #1: checkpoint field IS present on the persisted marker (even for non-checkpoint granularity, as undefined)
    expect(entry).toHaveProperty("checkpoint", undefined);

    // note left exactly once (mulligan:note)
    expect(sent).toHaveLength(1);
    expect(sent[0].customType).toBe("mulligan:note");
    expect(sent[0].display).toBe(true);
    expect(sent[0].options).toBeUndefined(); // C8: no options arg

    // details present
    expect(res.details.granularity).toBe("last_tool_call_group");
    expect(res.details.k).toBe(2);
    expect(res.details.ledger).toBeDefined();
    expect(res.details.markerId).toBe("leaf-1"); // getLeafId capture
  });

  it("K matches the resolver output (last_tool_call_group → the non-excluded toolGroup's indices)", async () => {
    const { pi } = makePi();
    // two prior toolGroups X(1,2) and Y(3,4); the rewind's own is Z(5,6). exclude "call-1" → resolves Y → [3,4] → K=2.
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("Y")),
        msgEntry(result("Y")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(res.details.k).toBe(2);
    expect(firstText(res)).toContain("2 messages will be hidden");
  });

  it("persisted options.to_previous_prompt === undefined when omitted; === the passed value when set (last_turn)", async () => {
    const { appended, pi } = makePi();
    // last_turn: one user message at index 0; everything after is the rewind's own unit (excluded) → remove=[] → K=0.
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("please do X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn", to_previous_prompt: true }, "call-1");
    const entry = appended[0].data as RewindMarker;
    expect(entry.options).toEqual({ to_previous_prompt: true, protect: ["first:user", "latest:user"] });
    expect(entry.granularity).toBe("last_turn");
  });

  it("excludeToolCallId === toolCallId regardless of the toolCallId value", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry(user("u")), msgEntry(asst("call-9")), msgEntry(result("call-9"))],
    });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-9");
    expect((appended[0].data as RewindMarker).excludeToolCallId).toBe("call-9");
  });
});

// ── success path: checkpoint granularity persists the checkpoint name (gotcha #1 — THE key assertion) ──

describe("mulligan_rewind — checkpoint success: data.checkpoint === name (gotcha #1)", () => {
  it("granularity 'checkpoint' with an EXISTING label → success + data.checkpoint === 'anchor'", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [msgEntry(user("u"))], // branch messages — resolveCheckpoint will no-op (no target walk match)
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    expect(appended).toHaveLength(1);
    // GOTCHA #1 — THE key assertion: the checkpoint name IS persisted (the filter reads rw.checkpoint).
    // (The frozen RewindMarker TYPE omits checkpoint — spec/04 §3 — so read through a widened record, the same way
    // the filter reads it via readOwn. The runtime spread in appendRewindMarker preserves the extra field.)
    expect((appended[0].data as RewindMarker & { checkpoint?: string }).checkpoint).toBe("anchor");
    expect(res.details.granularity).toBe("checkpoint");
  });
});

// ── success text: K + K=0 honesty + Note left. (spec/05 §1 Return shape + step 8) ──

describe("mulligan_rewind — success text (K + K=0 honesty + Note left.)", () => {
  it("K>0 → '<K> messages will be hidden ... Note left.'", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toBe(
      "Mulligan: rewound last_tool_call_group. 2 messages will be hidden from your view starting next turn. Note left.",
    );
  });

  it("K=0 (only the rewind's own toolGroup in the snapshot) → '0 messages ... (nothing matched to hide)'", async () => {
    const { pi } = makePi();
    // snapshot: only the rewind's own group → resolveLastToolCallGroup returns null → remove=[] → K=0.
    const { ctx } = makeCtx({
      contextEntries: [msgEntry(asst("call-1")), msgEntry(result("call-1"))],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toBe(
      "Mulligan: rewound last_tool_call_group. 0 messages will be hidden from your view starting next turn (nothing matched to hide). Note left.",
    );
    expect(res.details.k).toBe(0);
  });
});

// ── mutation warning (spec/08 E5 VERBATIM) ──────────────────────────────────

describe("mulligan_rewind — mutation warning (spec/08 E5 VERBATIM; requireMutationWarning)", () => {
  const MUTATION_WARNING_PREFIX = "⚠ The hidden span modified files";

  it("ledger.modifiedFiles non-empty + requireMutationWarning true → VERBATIM warning appended", async () => {
    const { pi } = makePi();
    // snapshot: a `write` toolCall in the non-excluded toolGroup → modifiedFiles=["src/a.ts"].
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")),
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain(MUTATION_WARNING_PREFIX);
    expect(firstText(res)).toContain("Those effects PERSIST on disk; do not blindly redo them.");
    expect(res.details.ledger?.modifiedFiles).toEqual(["src/a.ts"]);
  });

  it("ledger.bashSideEffects non-empty (mutating bash) + requireMutationWarning true → warning appended", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstBash("BASH", "mkdir -p build")),
        msgEntry(result("BASH")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain(MUTATION_WARNING_PREFIX);
    expect(res.details.ledger?.bashSideEffects).toEqual(["mkdir -p build"]);
  });

  it("requireMutationWarning === false → NO warning even when modifiedFiles non-empty", async () => {
    setConfig({ rewind: { requireMutationWarning: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")),
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).not.toContain(MUTATION_WARNING_PREFIX);
    expect(firstText(res)).toMatch(/Note left\.$/); // no trailing warning
  });

  it("empty ledger (no side effects) → NO warning even when requireMutationWarning true", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")), // 'tool' is unknown → no read/modify/bash classification → empty ledger
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).not.toContain(MUTATION_WARNING_PREFIX);
    expect(firstText(res)).toMatch(/Note left\.$/);
  });
});

// ── best-effort ledger (E8/E13): snapshot failure → empty ledger + K=0 + STILL success ──

describe("mulligan_rewind — best-effort ledger (E8/E13: snapshot failure never blocks)", () => {
  it("a THROWING buildContextEntries → empty ledger + K=0 + STILL persists marker + note + success", async () => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContext: true });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    // success path (the preview failure is swallowed → empty ledger + K=0)
    expect(firstText(res)).toContain("Mulligan: rewound last_tool_call_group.");
    expect(firstText(res)).toContain("0 messages will be hidden");
    expect(appended).toHaveLength(1); // marker STILL persisted
    expect(sent).toHaveLength(1); // note STILL left
    expect(res.details.k).toBe(0);
    expect(res.details.ledger).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
  });

  it("a THROWING getBranch (checkpoint granularity) → still success (preview swallowed)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      throwOnGetBranch: true,
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "checkpoint", checkpoint: "anchor" });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    expect(appended).toHaveLength(1);
    expect(res.details.k).toBe(0);
  });
});

// ── leaveNote correlates to the marker entry id (GOTCHA #10) ─────────────────

describe("mulligan_rewind — leaveNote rewindId === marker entry id (GOTCHA #10)", () => {
  it("note.details.rewindId === the captured marker entry id (getLeafId)", async () => {
    const { sent, pi } = makePi();
    const { ctx } = makeCtx({ leafId: "leaf-77", contextEntries: [] });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect((sent[0].details as { rewindId: string }).rewindId).toBe("leaf-77");
  });

  it("appendRewindMarker returns null (leafId null) → leaveNote rewindId falls back to toolCallId", async () => {
    const { sent, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null, contextEntries: [] });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-fallback");
    expect((sent[0].details as { rewindId: string }).rewindId).toBe("call-fallback");
  });
});

// ── never-throws (shared tool convention; E13) ──────────────────────────────

describe("mulligan_rewind — never throws (spec/05 shared tool convention; E13)", () => {
  it("a THROWING getEntries (depth guard) → execute resolves to a text result, no throw (countRewindMarkers is defensive → proceeds fail-open)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetEntries: true });
    // countRewindMarkers is defensive: a throwing getEntries → 0 markers (never propagates) → depth guard passes
    // → the rewind proceeds. The contract is "never rejects → text result", which holds either way.
    await expect(run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" })).resolves.toBeDefined();
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(res.content[0].type).toBe("text");
    expect(firstText(res)).toContain("Mulligan:"); // a text result (success) — never a rejection
  });

  it("a THROWING appendEntry (inside appendRewindMarker → returns null → leaveNote still fires) → success, no throw", async () => {
    const { sent, pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({ contextEntries: [] });
    // appendRewindMarker swallows the throw → returns null → markerId=null → leaveNote(toolCallId). Still success.
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(firstText(res)).toContain("Note left.");
    expect(sent).toHaveLength(1); // note was still left (rewindId = toolCallId fallback)
    expect(res.details.markerId).toBeNull();
  });
});

// ── result shape (CRITICAL GOTCHA #4: `details` REQUIRED on every path) ──────

describe("mulligan_rewind — result shape (CRITICAL GOTCHA #4: details on every path)", () => {
  it("success: content is [{type:'text', text:string}] AND details present (granularity, k, ledger, markerId)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry(user("u")), msgEntry(asst("X")), msgEntry(result("X")), msgEntry(asst("call-1")), msgEntry(result("call-1"))],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
    expect(res.details.granularity).toBe("last_tool_call_group");
    expect(typeof res.details.k).toBe("number");
    expect(res.details.ledger).toBeDefined();
    expect(typeof res.details.markerId).toBe("string");
  });

  it("refusal (disabled): content is [{type:'text', text:string}] AND details present", async () => {
    setConfig({ rewind: { enabled: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
    expect(res.details).toEqual({ granularity: "last_turn" });
  });

  it("refusal (invalid note): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: { ...VALID_NOTE, next: "" }, granularity: "checkpoint", checkpoint: "x" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });
});

// ── types (ToolDefinition + RewindParams inference + AgentToolResult) ────────

describe("mulligan_rewind — types (ToolDefinition + RewindParams inference)", () => {
  it("makeRewindTool(...) is a ToolDefinition<typeof RewindParams, RewindDetails>", () => {
    const { pi } = makePi();
    const tool = makeRewindTool(pi);
    expectTypeOf(tool).toEqualTypeOf<ToolDefinition<typeof RewindParams, RewindDetails>>();
    expectTypeOf(tool.parameters).toEqualTypeOf(RewindParams);
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });

  it("RewindArgs (Static<typeof RewindParams>) has note + granularity + optional to_previous_prompt + checkpoint", () => {
    const args = {} as RewindArgs;
    expectTypeOf(args.note).toEqualTypeOf<{
      what_happened: string;
      avoid: string;
      true_current_state: string;
      next: string;
    }>();
    expectTypeOf(args.granularity).toEqualTypeOf<"last_tool_call_group" | "last_turn" | "checkpoint">();
    expectTypeOf(args.to_previous_prompt).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(args.checkpoint).toEqualTypeOf<string | undefined>();
  });

  it("execute returns AgentToolResult<RewindDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expectTypeOf(res).toEqualTypeOf<AgentToolResult<RewindDetails>>();
  });
});

// ── renderNote is the note left (sanity: the persisted note content) ────────

describe("mulligan_rewind — the note left is renderNote(note, ledger, granularity)", () => {
  it("sent note content === renderNote(note, extractedLedger, granularity)", async () => {
    const { sent, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")),
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    // reconstruct the expected ledger from the same snapshot (the non-excluded toolGroup [1,2] → write src/a.ts)
    const expectedLedger = { readFiles: [], modifiedFiles: ["src/a.ts"], bashSideEffects: [] };
    const expected = renderNote(VALID_NOTE, expectedLedger, "last_tool_call_group");
    expect(sent[0].content).toBe(expected);
  });
});

// ── hideEntryIds capture (fix_design.md §Change 2; PRODUCER half of permanent hiding — BUG-001/002) ──────

/** Like msgEntry but with a DETERMINISTIC id (needed to assert which entry ids were captured). Mirrors msgEntry's shape. */
function msgEntryId(id: string, message: Record<string, unknown>): { type: "message"; id: string; message: Record<string, unknown> } {
  return { type: "message", id, message };
}

describe("mulligan_rewind — hideEntryIds capture (fix_design.md §Change 2; permanent-hiding producer)", () => {
  it("last_tool_call_group → hideEntryIds === the removed toolGroup's entry ids (the X group; NOT the rewind's own, NOT the user)", async () => {
    const { appended, pi } = makePi();
    // snapshot: u(e_u), asst(X)(e_X), result(X)(e_rX), asst(call-1)(e_rw), result(call-1)(e_rrw).
    // last_tool_call_group excludes the rewind's OWN group (call-1) → resolves the X group → remove=[1,2] → K=2.
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("u")),
        msgEntryId("e_X", asst("X")),
        msgEntryId("e_rX", result("X")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(appended).toHaveLength(1);
    const entry = appended[0].data as RewindMarker;
    // the removed messages are at indices 1,2 → their entries are e_X, e_rX (the whole bad toolGroup)
    expect(entry.hideEntryIds).toEqual(["e_X", "e_rX"]);
    expect(entry.hideEntryIds).not.toContain("e_u"); // user kept
    expect(entry.hideEntryIds).not.toContain("e_rw"); // rewind's own assistant kept
    expect(entry.hideEntryIds).not.toContain("e_rrw"); // rewind's own result kept
    // result audit surface carries the same ids
    expect(res.details.hideEntryIds).toEqual(["e_X", "e_rX"]);
    expect(res.details.k).toBe(2);
  });

  it("last_turn → hideEntryIds === the BAD toolGroup's entry ids (rewind's own unit kept)", async () => {
    const { appended, pi } = makePi();
    // snapshot: u(e_u), asst(BAD)(e_bad), result(BAD)(e_rbad), asst(call-1)(e_rw), result(call-1)(e_rrw).
    // last_turn removes everything after the last user msg (idx 0) EXCEPT the rewind's own unit + notes → remove=[1,2].
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("please do X")),
        msgEntryId("e_bad", asst("BAD")),
        msgEntryId("e_rbad", result("BAD")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn" }, "call-1");
    const entry = appended[0].data as RewindMarker;
    expect(entry.hideEntryIds).toEqual(["e_bad", "e_rbad"]);
    expect(entry.hideEntryIds).not.toContain("e_rw");
    expect(entry.hideEntryIds).not.toContain("e_rrw");
    expect(res.details.hideEntryIds).toEqual(["e_bad", "e_rbad"]);
  });

  it("K=0 (only the rewind's own group in the snapshot) → remove=[] → hideEntryIds === [] (PRESENT, not undefined)", async () => {
    const { appended, pi } = makePi();
    // snapshot: only the rewind's own group → resolveLastToolCallGroup returns null → remove=[] → K=0.
    const { ctx } = makeCtx({
      contextEntries: [msgEntryId("e_rw", asst("call-1")), msgEntryId("e_rrw", result("call-1"))],
    });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(res.details.k).toBe(0);
    const entry = appended[0].data as RewindMarker;
    expect(Array.isArray(entry.hideEntryIds)).toBe(true); // present (every new marker has it)
    expect(entry.hideEntryIds).toEqual([]);
    expect(res.details.hideEntryIds).toEqual([]);
  });

  it("snapshot failure (buildContextEntries throws) → catch → hideEntryIds === [] + marker STILL persisted", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContext: true });
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1); // marker persisted despite the preview failure
    const entry = appended[0].data as RewindMarker;
    expect(entry.hideEntryIds).toEqual([]); // best-effort: nothing captured
    expect(res.details.hideEntryIds).toEqual([]);
    expect(res.details.ledger).toEqual({ readFiles: [], modifiedFiles: [], bashSideEffects: [] });
    expect(res.details.k).toBe(0);
  });

  it("every persisted success marker HAS a hideEntryIds array (the contract: 'every new rewind marker has hideEntryIds populated')", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntryId("e_u", user("u")),
        msgEntryId("e_X", asst("X")),
        msgEntryId("e_rX", result("X")),
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(appended).toHaveLength(1);
    expect(Array.isArray((appended[0].data as RewindMarker).hideEntryIds)).toBe(true);
  });

  it("hideEntryIds order follows entry order (root→leaf cursor walk) and is deterministic for the same snapshot", async () => {
    const { appended, pi } = makePi();
    const snap = [
      msgEntryId("e_u", user("u")),
      msgEntryId("e_A", asst("A")),
      msgEntryId("e_rA", result("A")),
      msgEntryId("e_B", asst("B")),
      msgEntryId("e_rB", result("B")),
      msgEntryId("e_rw", asst("call-1")),
      msgEntryId("e_rrw", result("call-1")),
    ];
    const { ctx } = makeCtx({ contextEntries: snap });
    // last_tool_call_group excludes call-1 → resolves the B group (most-recent non-excluded) → remove=[3,4]
    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }, "call-1");
    expect(res.details.k).toBe(2);
    expect((appended[0].data as RewindMarker).hideEntryIds).toEqual(["e_B", "e_rB"]); // root→leaf order
  });
});

describe("mulligan_rewind — RewindDetails.hideEntryIds type (fix_design.md §Change 2 audit surface)", () => {
  it("RewindDetails has hideEntryIds?: string[]", () => {
    expectTypeOf<RewindDetails>().toMatchTypeOf<{ hideEntryIds?: string[] }>();
  });
});