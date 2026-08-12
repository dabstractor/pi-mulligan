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
import {
  describe,
  it,
  expect,
  expectTypeOf,
  beforeEach,
  afterEach,
} from "vitest";
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
import { makeShrinkTool } from "../../src/tools/shrink.js"; // P4.M1.T3.S1 test (d)/(e): shrink stays callable after the rewind budget/context-fraction refuse
import { listCheckpoints } from "../../src/tools/audit.js"; // P1.M3.T1.S2: pure-fn assertions on the consumed-state entries
import type {
  RewindMarker,
  RewindMarkerInput,
  RevertCheckpoint,
} from "../../src/markers.js";
import type {
  SnapshotStore,
  RestoreResult,
  RestoreOpts,
} from "../../src/snapshot/store.js";
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

// ── the canonical valid note (3 non-empty fields — S3: the former 4th field folded into what_happened) ──

const VALID_NOTE = {
  what_happened:
    "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates.",
  true_current_state: "No files changed on the abandoned span.",
  next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
};

// ── fakes (the markers.test.ts makePi shape + a richer makeCtx that scripts getEntries/getBranch/buildContextEntries) ─

/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel (hand-rolled, no vi.fn()). */
function makePi(
  opts: {
    throwOnAppend?: boolean;
    throwOnSendMessage?: boolean;
    throwOnSetLabel?: boolean;
  } = {},
) {
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
      message: {
        customType: string;
        content: unknown;
        display: boolean;
        details?: unknown;
      },
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
function makeCtx(
  opts: {
    sessionId?: string;
    leafId?: string | null;
    entries?: unknown[];
    branch?: unknown[];
    contextEntries?: unknown[];
    /** Script ctx.getContextUsage() so the (4c) context-fraction guard can read `.contextWindow`. ABSENT → the
     *  method is NOT attached → computeFilteredTotal returns windowTokens:0 → (4c) SKIPPED (no regression). */
    contextUsage?: { contextWindow: number };
    /** Override the latest-wins label map that `getLabel(id)` returns, bypassing the derive-from-entries walk.
     *  Keys are targetIds; values are label strings (or undefined for a consumed/cleared target). Lets a test
     *  force the post-consumption state directly (validation issue 1b). */
    labels?: Record<string, string | undefined>;
    throwOnGetEntries?: boolean;
    throwOnGetBranch?: boolean;
    throwOnBuildContext?: boolean;
    throwOnGetLeafId?: boolean;
  } = {},
) {
  const sessionId = opts.sessionId ?? "s1";
  const leafId: string | null =
    opts.leafId === undefined ? "leaf-1" : opts.leafId;
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
    // getLabel — Pi's LATEST-WINS label map (validation issue 1b): a `setLabel(id, undefined)` appends a clear
    // entry, and `_buildIndex` deletes the id from its in-memory map, so getLabel returns undefined for a
    // CONSUMED checkpoint. We mirror that here by walking `entries` and keeping the LAST `label` per targetId
    // (undefined on a clear entry). checkpointExists consults this so the existence check reflects consumption.
    // Optional `opts.labels` (a targetId→label override map) lets a test force the post-consumption state
    // directly without re-deriving from entries.
    getLabel(id: string) {
      if (
        opts.labels &&
        Object.prototype.hasOwnProperty.call(opts.labels, id)
      ) {
        return opts.labels[id];
      }
      let current: string | undefined = undefined;
      let seen = false;
      for (const e of entries) {
        if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
        try {
          const ee = e as {
            type?: unknown;
            targetId?: unknown;
            label?: unknown;
          };
          if (ee.type === "label" && ee.targetId === id) {
            seen = true;
            current = typeof ee.label === "string" ? ee.label : undefined;
          }
        } catch {
          // skip a throwing-Proxy entry
        }
      }
      return seen ? current : undefined;
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
  // Attach getContextUsage ONLY when explicitly opted in. computeFilteredTotal reads `ctx.getContextUsage?.()`
  // (NOT sessionManager's) → undefined when absent → windowTokens:0 → the (4c) guard is skipped (no regression).
  const ctx: {
    sessionManager: typeof sessionManager;
    getContextUsage?: () => unknown;
  } = { sessionManager };
  if (opts.contextUsage !== undefined)
    ctx.getContextUsage = () => opts.contextUsage!;
  return { ctx: ctx as unknown as ExtensionContext };
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
    throw new Error(
      `expected a text content block, got ${block?.type ?? "none"}`,
    );
  }
  return block.text;
}

/** A rewind marker entry (customType "mulligan:rewind") for the depth guard. */
function rewindEntry(seq = 1): {
  type: "custom";
  customType: "mulligan:rewind";
  data: { seq: number };
} {
  return { type: "custom", customType: "mulligan:rewind", data: { seq } };
}

/** A rewind marker entry WITH a data.id (for BUG-005 cancel-exclusion tests: cancellation targets data.id). */
function rewindEntryWithId(
  seq: number,
  id: string,
): {
  type: "custom";
  customType: "mulligan:rewind";
  data: { seq: number; id: string; kind: string };
} {
  return {
    type: "custom",
    customType: "mulligan:rewind",
    data: { seq, id, kind: "rewind" },
  };
}

/** A cancel marker entry (customType "mulligan:cancel"); targetId is the retired marker's data.id (BUG-005). */
function cancelEntry(targetId: string): {
  type: "custom";
  customType: "mulligan:cancel";
  data: { kind: string; targetId: string };
} {
  return {
    type: "custom",
    customType: "mulligan:cancel",
    data: { kind: "cancel", targetId },
  };
}

/** A turn-metric marker entry (customType "mulligan:turn-metric") with the given turnIndex + seq, for the
 *  P4.M1.T2.S3 refused-rewind flag tests (rewind.ts reads readMarkers(ctx).metric?.turnIndex). */
function metricEntry(
  turnIndex: number,
  seq = turnIndex,
): {
  type: "custom";
  customType: "mulligan:turn-metric";
  data: Record<string, unknown>;
} {
  return {
    type: "custom",
    customType: "mulligan:turn-metric",
    data: {
      schema: "pi-mulligan",
      v: 1,
      kind: "turn-metric",
      seq,
      ts: 1,
      turnIndex,
      deltaTokens: 100,
      bloatHit: false,
      bloatHits: [],
      grewOverThreshold: false,
    },
  };
}

/** A checkpoint label entry. */
function checkpointLabelEntry(
  name: string,
  targetId = "leaf-1",
): {
  type: "label";
  targetId: string;
  label: string;
} {
  return { type: "label", targetId, label: `mulligan:checkpoint:${name}` };
}

/** A single message-as-entry in the snapshot (buildContextEntries returns SessionEntry[]; we cast through unknown).
 *  For the ledger/K preview, the tool flattens via sessionEntryToContextMessages. We pass entries that the REAL
 *  sessionEntryToContextMessages converts: {type:"message", message:{role,content}} (verified Pi shape). */
function msgEntry(message: Record<string, unknown>): {
  type: "message";
  id: string;
  message: Record<string, unknown>;
} {
  return {
    type: "message",
    id: `e-${Math.random().toString(36).slice(2)}`,
    message,
  };
}

/** Build an assistant message whose content is a list of toolCall blocks with the given ids (mirror transforms.test.ts). */
function asst(...callIds: string[]): Record<string, unknown> {
  return {
    role: "assistant",
    content: callIds.map((id) => ({
      type: "toolCall",
      id,
      name: "tool",
      arguments: {},
    })),
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
    content: [
      { type: "toolCall", id: callId, name: "write", arguments: { file_path } },
    ],
  };
}

/** Build an assistant message whose toolCall is a mutating bash command (bashSideEffects). */
function asstBash(callId: string, command: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      { type: "toolCall", id: callId, name: "bash", arguments: { command } },
    ],
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
      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only).",
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
    expect(appended).toHaveLength(0); // no marker
    expect(sent).toHaveLength(0); // no note
    expect(res.details).toEqual({ granularity: "last_tool_call_group" });
  });

  it("the disabled refusal does NOT depend on note validity (config gate is step 1, BEFORE note validation)", async () => {
    setConfig({ rewind: { enabled: false } });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      note: { ...VALID_NOTE, what_happened: "" },
      granularity: "last_turn",
    });
    expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "last_turn" });
  });
});

// ── refusal path 2: invalid note (step 2; E9) ───────────────────────────────

describe("mulligan_rewind — refusal: invalid note (step 2; E9)", () => {
  it.each([
    ["empty what_happened", { ...VALID_NOTE, what_happened: "" }],
    [
      "whitespace-only true_current_state",
      { ...VALID_NOTE, true_current_state: "   " },
    ],
    ["empty next", { ...VALID_NOTE, next: "" }],
    ["whitespace-only what_happened", { ...VALID_NOTE, what_happened: "\t\n" }],
  ])(
    "rejects %s → NOTE_INVALID_REASON refusal; no persistence",
    async (_label, note) => {
      const { appended, sent, pi } = makePi();
      const { ctx } = makeCtx();
      const res = await run(pi, ctx, {
        note,
        granularity: "last_tool_call_group",
      });
      expect(firstText(res)).toBe(
        `Mulligan: refused — ${NOTE_INVALID_REASON}.`,
      );
      expect(appended).toHaveLength(0);
      expect(sent).toHaveLength(0);
      expect(res.details).toEqual({ granularity: "last_tool_call_group" });
    },
  );
});

// ── refusal path 3: checkpoint granularity existence (step 3; E10) ──────────

describe("mulligan_rewind — refusal: checkpoint existence (step 3; E10)", () => {
  it("granularity 'checkpoint' with NO checkpoint name → refusal", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
    });
    expect(firstText(res)).toBe(
      "Mulligan: refused — checkpoint granularity requires a checkpoint name.",
    );
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({ granularity: "checkpoint" });
  });

  it("granularity 'checkpoint', name 'nope', NO matching label → refusal", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] }); // no labels
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "nope",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    expect(appended).toHaveLength(1); // marker persisted (existence passed)
  });

  it("last_tool_call_group / last_turn are ALWAYS valid (no checkpoint scan)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [] }); // no labels — irrelevant for relative granularity
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toContain("Mulligan: rewound last_turn.");
    expect(appended).toHaveLength(1);
  });
});

// ── refusal path 4: depth guard (step 4; E4) ────────────────────────────────

describe("mulligan_rewind — refusal: depth guard (step 4; E4; default maxDepth=5)", () => {
  it("exactly maxDepth (5) active rewind markers → refusal naming the count + suggesting shrink/continue", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
        rewindEntry(4),
        rewindEntry(5),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1);
  });

  it("honors a custom maxDepth (set via config)", async () => {
    setConfig({ rewind: { maxDepth: 1 } });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries: [rewindEntry(1)] });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).toContain("max rewind depth (1) reached");
    expect(appended).toHaveLength(0);
  });
});

// ── refusal path 5b: protected message (spec/08 E3; spec/10 §2.1 F-protected) ─────────────────────────

// Note: the v1.0 protected-first-user refusal test (the discarded-latest-user-message rewind) was removed in
// v1.1 — that option no longer exists and last_turn now keeps the latest user message by construction
// (the resolver loop starts at iLastUser + 1). The positive guardrail (user message survives) lives in
// transforms.test.ts; the first:user protectedOk defense-in-depth is covered by edge-cases.test.ts.

// ── P4.M1.T2.S3: refused-rewind flag (rt.rewindRefusedTurnIndex) ────────────

describe("mulligan_rewind — refusal latches rt.rewindRefusedTurnIndex (P4.M1.T2.S3)", () => {
  it("a refused rewind latches rt.rewindRefusedTurnIndex to the latest metric turnIndex (P4.M1.T2.S3)", async () => {
    // Trigger a refusal via an invalid note (E9 path). The latest turn-metric has turnIndex 7 → flag = 7.
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", entries: [metricEntry(7)] });
    const res = await run(pi, ctx, {
      note: { ...VALID_NOTE, what_happened: "" },
      granularity: "last_tool_call_group",
    });
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
    expect(firstText(res)).toContain("Mulligan: rewound"); // success
    expect(getRuntime("s1").rewindRefusedTurnIndex).toBeNull(); // success never sets the flag
  });

  it("a refusal when no turn-metric exists leaves the flag null and never throws (E13)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1", entries: [] }); // NO metric entries → currentTurnIndex null
    const res = await run(pi, ctx, {
      note: { ...VALID_NOTE, what_happened: "" },
      granularity: "last_tool_call_group",
    });
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );

    // marker persisted exactly once
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:rewind");
    const entry = appended[0].data as RewindMarker;
    expect(entry.granularity).toBe("last_tool_call_group");
    expect(entry.options).toEqual({ protect: ["first:user", "latest:user"] });
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
    expect(res.details.k).toBe(2);
    expect(firstText(res)).toContain("2 messages will be hidden");
  });

  it("excludeToolCallId === toolCallId regardless of the toolCallId value", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("call-9")),
        msgEntry(result("call-9")),
      ],
    });
    await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-9",
    );
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    expect(appended).toHaveLength(1);
    // GOTCHA #1 — THE key assertion: the checkpoint name IS persisted (the filter reads rw.checkpoint).
    // (The frozen RewindMarker TYPE omits checkpoint — spec/04 §3 — so read through a widened record, the same way
    // the filter reads it via readOwn. The runtime spread in appendRewindMarker preserves the extra field.)
    expect(
      (appended[0].data as RewindMarker & { checkpoint?: string }).checkpoint,
    ).toBe("anchor");
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).toContain(MUTATION_WARNING_PREFIX);
    expect(firstText(res)).toContain(
      "Those effects PERSIST on disk; do not blindly redo them.",
    );
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).not.toContain(MUTATION_WARNING_PREFIX);
    expect(firstText(res)).toMatch(/Note left\.$/);
  });
});

// ── E5 reverted reword (P4.M2.T2.S1; spec/08 E5 v1.2 clause; spec/05 §1 step 7 v1.2; @14 §7) ────
// When step 6b REVERTED files (revertSummary.reverted > 0), the file-state portion of the hidden span's effects
// was restored, so the appended E5 warning is reworded (MUTATION_WARNING_REVERTED) to name ONLY the
// non-filesystem effects that still persist + any failed/refused files. Every NON-reverted outcome (no flags /
// disabled / group / missing checkpoint / dirty-guard REFUSED / restore ran but reverted 0) keeps the ORIGINAL
// wording unchanged (those file effects DO persist). hasWarning stays the gate; filesWereReverted picks wording.
//
// Reuse: seedProceedLastTurn (line ~2303) seeds a last_turn proceed with `asst("X")` (EMPTY ledger). For the
// reverted-wording tests that need hasWarning true, we build an equivalent seed inline with asstWrite in the span
// (modifiedFiles=["src/a.ts"]) — revert only runs at last_turn/checkpoint (NOT last_tool_call_group).

describe("mulligan_rewind — E5 reverted reword (P4.M2.T2.S1)", () => {
  // (a) FILES REVERTED + side effects → MUTATION_WARNING_REVERTED wording (original 'PERSIST' wording ABSENT).
  it("files REVERTED + side effects → MUTATION_WARNING_REVERTED wording (original 'PERSIST' wording ABSENT)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")), // modifiedFiles=["src/a.ts"] → hasWarning true
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({
      drifted: [], // clean dirtyCheck → S2 proceeds → restore
      restoreResult: {
        reverted: ["src/a.ts"],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      },
      restoreCalls,
    });
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    // REVERTED wording present:
    expect(firstText(res)).toContain("ran side-effecting commands (see note)");
    expect(firstText(res)).toContain("Non-filesystem effects PERSIST on disk");
    expect(firstText(res)).toContain("were reverted to their pre-span state");
    // ORIGINAL wording ABSENT:
    expect(firstText(res)).not.toContain(
      "modified files/ran side-effecting commands",
    );
    expect(firstText(res)).not.toContain(
      "Those effects PERSIST on disk; do not blindly redo them.",
    );
    expect(restoreCalls).toHaveLength(1);
    expect(res.details.revertSummary?.reverted).toBe(1);
  });

  // (b) REVERTED but requireMutationWarning===false → NO warning at all (hasWarning gate).
  it("files REVERTED but requireMutationWarning===false → NO warning at all (hasWarning gate)", async () => {
    // requireMutationWarning is a SIBLING of config.revert (NOT nested inside it) — two top-level keys.
    setConfig({
      revert: { enabled: true },
      rewind: { requireMutationWarning: false },
    });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")), // modifiedFiles non-empty, but requireMutationWarning===false
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({
      drifted: [],
      restoreResult: {
        reverted: ["src/a.ts"],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      },
    });
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).not.toContain("⚠");
    expect(firstText(res)).not.toContain(
      "Non-filesystem effects PERSIST on disk",
    );
    expect(firstText(res)).not.toContain("modified files/ran side-effecting");
    expect(res.details.revertSummary?.reverted).toBe(1); // revert still ran
  });

  // (c) DIRTY-GUARD REFUSED + side effects → ORIGINAL wording (files persist; no special-case branch).
  it("dirty-guard REFUSED + side effects → ORIGINAL wording (files persist; no special-case branch)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")), // modifiedFiles non-empty → hasWarning true
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: ["src/a.ts"] }); // dirtyCheck → drift → S1 refuse → no restore
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "modified files/ran side-effecting commands",
    );
    expect(firstText(res)).toContain(
      "Those effects PERSIST on disk; do not blindly redo them.",
    );
    expect(firstText(res)).not.toContain("Non-filesystem effects PERSIST");
    expect(res.details.revertRefused).toBe(true);
    expect(res.details.revertSummary).toBeUndefined();
  });

  // (d) RESTORE RAN but reverted 0 (all failed) → ORIGINAL wording (files persist).
  it("restore ran but reverted 0 (all failed) → ORIGINAL wording (files persist)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asstWrite("WRITE", "src/a.ts")), // modifiedFiles non-empty → hasWarning true
        msgEntry(result("WRITE")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({
      drifted: [],
      restoreResult: {
        reverted: [], // nothing reverted (all failed)
        deleted: [],
        failed: ["src/a.ts"],
        skipped: [],
        refused: [],
      },
      restoreCalls,
    });
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "Those effects PERSIST on disk; do not blindly redo them.",
    );
    expect(firstText(res)).not.toContain(
      "were reverted to their pre-span state",
    );
    expect(restoreCalls).toHaveLength(1);
    expect(res.details.revertSummary?.reverted).toBe(0);
  });

  // (e) FILES REVERTED but EMPTY ledger (no side effects) → NO warning; the S2 revert clause still appears.
  it("files REVERTED but EMPTY ledger (no side effects) → NO warning; the S2 revert clause still appears", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")), // unknown tool → empty ledger → hasWarning false
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({
      drifted: [],
      restoreResult: {
        reverted: ["src/x.ts"], // files WERE reverted — but hasWarning false ⇒ no warning at all
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      },
    });
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).not.toContain("⚠");
    expect(firstText(res)).toContain("Reverted 1 file(s)"); // the S2 revert clause still appears
    expect(res.details.revertSummary?.reverted).toBe(1);
  });
});

// ── best-effort ledger (E8/E13): snapshot failure → empty ledger + K=0 + STILL success ──

describe("mulligan_rewind — best-effort ledger (E8/E13: snapshot failure never blocks)", () => {
  it("a THROWING buildContextEntries → empty ledger + K=0 + STILL persists marker + note + success", async () => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContext: true });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    // success path (the preview failure is swallowed → empty ledger + K=0)
    expect(firstText(res)).toContain("Mulligan: rewound last_tool_call_group.");
    expect(firstText(res)).toContain("0 messages will be hidden");
    expect(appended).toHaveLength(1); // marker STILL persisted
    expect(sent).toHaveLength(1); // note STILL left
    expect(res.details.k).toBe(0);
    expect(res.details.ledger).toEqual({
      readFiles: [],
      modifiedFiles: [],
      bashSideEffects: [],
    });
  });

  it("a THROWING getBranch (checkpoint granularity) → still success (preview swallowed)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      throwOnGetBranch: true,
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
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
    await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect((sent[0].details as { rewindId: string }).rewindId).toBe("leaf-77");
  });

  it("appendRewindMarker returns null (leafId null) → leaveNote rewindId falls back to toolCallId", async () => {
    const { sent, pi } = makePi();
    const { ctx } = makeCtx({ leafId: null, contextEntries: [] });
    await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-fallback",
    );
    expect((sent[0].details as { rewindId: string }).rewindId).toBe(
      "call-fallback",
    );
  });
});

// ── never-throws (shared tool convention; E13) ──────────────────────────────

describe("mulligan_rewind — never throws (spec/05 shared tool convention; E13)", () => {
  it("a THROWING getEntries (depth guard) → execute resolves to a text result, no throw (countRewindMarkers is defensive → proceeds fail-open)", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetEntries: true });
    // countRewindMarkers is defensive: a throwing getEntries → 0 markers (never propagates) → depth guard passes
    // → the rewind proceeds. The contract is "never rejects → text result", which holds either way.
    await expect(
      run(pi, ctx, { note: VALID_NOTE, granularity: "last_tool_call_group" }),
    ).resolves.toBeDefined();
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(res.content[0].type).toBe("text");
    expect(firstText(res)).toContain("Mulligan:"); // a text result (success) — never a rejection
  });

  it("a THROWING appendEntry (inside appendRewindMarker → returns null → leaveNote still fires) → success, no throw", async () => {
    const { sent, pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({ contextEntries: [] });
    // appendRewindMarker swallows the throw → returns null → markerId=null → leaveNote(toolCallId). Still success.
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
    expect(res.details).toEqual({ granularity: "last_turn" });
  });

  it("refusal (invalid note): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      note: { ...VALID_NOTE, next: "" },
      granularity: "checkpoint",
      checkpoint: "x",
    });
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
    expectTypeOf(tool).toEqualTypeOf<
      ToolDefinition<typeof RewindParams, RewindDetails>
    >();
    expectTypeOf(tool.parameters).toEqualTypeOf(RewindParams);
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });

  it("RewindArgs (Static<typeof RewindParams>) has note + granularity + checkpoint + v1.2 revert fields", () => {
    const args = {} as RewindArgs;
    expectTypeOf(args.note).toEqualTypeOf<{
      what_happened: string;
      true_current_state: string;
      next: string;
    }>();
    expectTypeOf(args.granularity).toEqualTypeOf<
      "last_tool_call_group" | "last_turn" | "checkpoint"
    >();
    expectTypeOf(args.checkpoint).toEqualTypeOf<string | undefined>();
    // [P4.M1.T1.S1] v1.2 working-tree revert params — optional booleans (Type.Optional → boolean | undefined).
    expectTypeOf(args.revert_file_changes).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(args.delete_created_files).toEqualTypeOf<
      boolean | undefined
    >();
  });

  it("execute returns AgentToolResult<RewindDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
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
    await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    // reconstruct the expected ledger from the same snapshot (the non-excluded toolGroup [1,2] → write src/a.ts)
    const expectedLedger = {
      readFiles: [],
      modifiedFiles: ["src/a.ts"],
      bashSideEffects: [],
    };
    const expected = renderNote(
      VALID_NOTE,
      expectedLedger,
      "last_tool_call_group",
    );
    expect(sent[0].content).toBe(expected);
  });
});

// ── hideEntryIds capture (fix_design.md §Change 2; PRODUCER half of permanent hiding — BUG-001/002) ──────

/** Like msgEntry but with a DETERMINISTIC id (needed to assert which entry ids were captured). Mirrors msgEntry's shape. */
function msgEntryId(
  id: string,
  message: Record<string, unknown>,
): { type: "message"; id: string; message: Record<string, unknown> } {
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn" },
      "call-1",
    );
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
      contextEntries: [
        msgEntryId("e_rw", asst("call-1")),
        msgEntryId("e_rrw", result("call-1")),
      ],
    });
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
    expect(res.details.k).toBe(0);
    const entry = appended[0].data as RewindMarker;
    expect(Array.isArray(entry.hideEntryIds)).toBe(true); // present (every new marker has it)
    expect(entry.hideEntryIds).toEqual([]);
    expect(res.details.hideEntryIds).toEqual([]);
  });

  it("snapshot failure (buildContextEntries throws) → catch → hideEntryIds === [] + marker STILL persisted", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContext: true });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1); // marker persisted despite the preview failure
    const entry = appended[0].data as RewindMarker;
    expect(entry.hideEntryIds).toEqual([]); // best-effort: nothing captured
    expect(res.details.hideEntryIds).toEqual([]);
    expect(res.details.ledger).toEqual({
      readFiles: [],
      modifiedFiles: [],
      bashSideEffects: [],
    });
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
    await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
    expect(appended).toHaveLength(1);
    expect(Array.isArray((appended[0].data as RewindMarker).hideEntryIds)).toBe(
      true,
    );
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_tool_call_group" },
      "call-1",
    );
    expect(res.details.k).toBe(2);
    expect((appended[0].data as RewindMarker).hideEntryIds).toEqual([
      "e_B",
      "e_rB",
    ]); // root→leaf order
  });
});

describe("mulligan_rewind — RewindDetails.hideEntryIds type (fix_design.md §Change 2 audit surface)", () => {
  it("RewindDetails has hideEntryIds?: string[]", () => {
    expectTypeOf<RewindDetails>().toMatchTypeOf<{ hideEntryIds?: string[] }>();
  });
});

// ── P4.M1.T3.S1: retry budget + context-fraction + never-throw (spec/08 E22 a–f, spec/10 §1.10) ───────
// These blocks assert the two E22 hard backstops landed in P4.M1.T2.S1 (per-prompt retry budget) +
// P4.M1.T2.S2 (context-fraction stop). They drive makeRewindTool against the existing makePi/makeCtx fakes
// and PRE-SEED the rewind markers (the fakes' entries array is static; we do NOT simulate the loop by calling
// rewind 4×). countRetriesAtLatestPrompt scans getEntries() — see spec/08 E22 (g) for the loop-contract framing.

/** A valid mulligan_shrink call (mirrors test/tools/shrink.test.ts). Shrink is never retry-budget-gated, so a
 *  non-empty discriminator + non-empty replacement returns a NON-refusal (matched:yes or matched:no, but never
 *  "Mulligan: refused"). Used by tests (d)/(e) to prove the non-rewind tools stay callable. */
async function shrinkCall(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  const tool = makeShrinkTool(pi);
  return tool.execute(
    "call-shrink",
    { target: { by_tool_call_id: "call-A" }, replacement: "(shrink) summary" },
    undefined,
    undefined,
    ctx,
  );
}

// (a) RETRY BUDGET — refuses at exactly the budget with the named text and persists nothing (spec/08 E22 a).
describe("mulligan_rewind — retry budget: per-prompt cap (P4.M1.T3.S1 / spec/08 E22 a, spec/10 §1.10)", () => {
  it("refuses at exactly the budget (maxRetriesPerPrompt:3) with the named text and persists nothing", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { appended, pi } = makePi();
    // countRetriesAtLatestPrompt: latest user at idx 0 → 3 rewind markers AFTER it → 3 >= 3 → refuse (3/3).
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("update the spec")),
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toContain("per-prompt retry budget");
    expect(firstText(res)).toContain("3/3"); // ${retries}/${maxRetriesPerPrompt}
    expect(appended.length).toBe(0); // refused BEFORE persisting
  });
});

// (b) ZERO-HIDE STILL COUNTS — countRetriesAtLatestPrompt counts markers, not what they hid (spec/08 E22 c).
describe("mulligan_rewind — retry budget: zero-hide markers still count (P4.M1.T3.S1 / spec/08 E22 c)", () => {
  it("a rewind marker that hid nothing still counts toward the budget", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { appended, pi } = makePi();
    // countRetriesAtLatestPrompt does NOT inspect hideEntryIds — it counts customType:"mulligan:rewind"
    // unconditionally. These 3 markers represent zero-hide rewinds; if they did NOT count, the next rewind
    // would succeed. Assert it is refused → proves zero-hide markers count.
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("loop again")),
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toContain("per-prompt retry budget");
    expect(appended.length).toBe(0);
  });
});

// (c) NEW PROMPT RESETS BUDGET — a later user message makes countRetries find 0 rewinds after it (spec/08 E22 b/g).
describe("mulligan_rewind — retry budget: a new prompt resets it (P4.M1.T3.S1 / spec/08 E22 b, spec/10 §1.10)", () => {
  it("a LATER user message resets the budget → the next rewind succeeds", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { appended, pi } = makePi();
    // The NEW user message is AFTER the rewind markers → countRetriesAtLatestPrompt finds the NEW user and
    // counts 0 rewinds after it → budget NOT hit → rewind succeeds (persists a marker, possibly K=0).
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("old prompt")),
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
        msgEntry(user("NEW prompt")), // <-- latest user is now AFTER the rewind markers
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(appended.length).toBeGreaterThan(0); // marker persisted = success (K may be 0; appended>0 is the signal)
    expect(firstText(res)).not.toContain("per-prompt retry budget");
  });
});

// (d) NON-REWIND TOOLS UNAFFECTED — after the budget is hit, mulligan_shrink returns a non-refusal (spec/08 E22 d).
describe("mulligan_rewind — retry budget: non-rewind tools unaffected (P4.M1.T3.S1 / spec/08 E22 d)", () => {
  it("after the retry budget is hit, mulligan_shrink still returns a non-refusal", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("budget hit")),
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
      ],
    });
    // 1) rewind IS refused (budget exhausted)
    const rew = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(rew)).toContain("per-prompt retry budget");
    // 2) mulligan_shrink is NOT gated by the retry budget → returns a non-refusal (matched:yes/no, never "refused")
    const shrinkRes = await shrinkCall(pi, ctx);
    expect((shrinkRes.content[0] as { type?: string }).type).toBe("text");
    expect((shrinkRes.content[0] as { text?: string }).text).not.toContain(
      "Mulligan: refused",
    );
  });
});

// (e) CONTEXT-FRACTION STOP — refuses when filtered context ≥ abortContextFraction even though the budget
// remains; shrink still callable (spec/08 E22 e). maxRetriesPerPrompt is set HIGH so ONLY (4c) refuses here.
describe("mulligan_rewind — context-fraction stop (P4.M1.T3.S1 / spec/08 E22 e, spec/10 §1.10)", () => {
  it("refuses when filtered context ≥ abortContextFraction of the window even though budget remains; shrink still callable", async () => {
    // HIGH budget → (4b) won't fire first; ONLY the context-fraction (4c) refuses here.
    setConfig({
      rewind: { maxRetriesPerPrompt: 100, abortContextFraction: 0.9 },
    });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextUsage: { contextWindow: 10000 }, // windowTokens=10000 → (4c) is armed (not skipped)
      entries: [msgEntry(user("bloated loop"))],
    });
    // Drive totalTokens via rt.lastFiltered — the PRIMARY path computeFilteredTotal reads.
    // estimateTokens ≈ chars/4 → 50000 chars ≈ 12500 tokens ≥ 0.9*10000 = 9000. Oversized to be ratio-safe.
    getRuntime("s1").lastFiltered = [
      { role: "user", content: [{ type: "text", text: "x".repeat(50000) }] },
    ] as unknown as {
      role: string;
      content: { type: string; text: string }[];
    }[];
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toContain("context is at");
    expect(firstText(res)).toContain("% of the window");
    expect(appended.length).toBe(0);
    // shrink still callable (budget was NOT the reason; only prompt-re-landing rewinds are gated):
    const shrinkRes = await shrinkCall(pi, ctx);
    expect((shrinkRes.content[0] as { text?: string }).text).not.toContain(
      "Mulligan: refused",
    );
  });
});

// (f) NEVER THROW / NEVER BLOCK TEXT — the guards are defensive; every result is a text block (E13; spec/08 E22 f).
describe("mulligan_rewind — guards never throw; refusals are always text blocks (P4.M1.T3.S1 / spec/08 E22 f, E13)", () => {
  it("a throwing getEntries → countRetriesAtLatestPrompt returns 0 (no crash); execute resolves to a text result", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { pi } = makePi();
    // throwOnGetEntries makes BOTH countRewindMarkers AND countRetriesAtLatestPrompt return 0 (both defensive)
    // → the rewind passes (4b) and proceeds (may succeed). The assertion is ONLY "no throw + text block".
    const { ctx } = makeCtx({
      entries: [msgEntry(user("x"))],
      throwOnGetEntries: true,
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect((res.content[0] as { type?: string }).type).toBe("text"); // never throws; always a text block (E13)
  });

  it("a throwing getContextUsage → context-fraction guard skipped (no crash)", async () => {
    setConfig({
      rewind: { maxRetriesPerPrompt: 100, abortContextFraction: 0.9 },
    });
    const { pi } = makePi();
    // computeFilteredTotal's try/catch → {0,0} → windowTokens:0 → (4c) skipped. No throw either way.
    const { ctx } = makeCtx({ entries: [msgEntry(user("x"))] });
    (ctx as unknown as { getContextUsage: () => unknown }).getContextUsage =
      () => {
        throw new Error("getContextUsage boom");
      };
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect((res.content[0] as { type?: string }).type).toBe("text"); // no throw
  });

  it("every refusal result is content:[{type:'text'}] (E13 — never blocks a normal text reply)", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 3 } });
    const { pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("x")),
        rewindEntry(1),
        rewindEntry(2),
        rewindEntry(3),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content.length).toBeGreaterThan(0);
    expect((res.content[0] as { type?: string }).type).toBe("text");
    expect(typeof (res.content[0] as { text?: string }).text).toBe("string");
  });
});

// ── BUG-005: cancelled rewinds excluded from the retry budget (spec/08 E22 — a cancelled rewind never re-landed) ─
// countRetriesAtLatestPrompt scans the same post-prompt slice for mulligan:cancel entries and skips rewinds
// whose data.id is targeted by one. Mirrors readMarkers' cancelledIds (src/filter.ts). Backward-compatible:
// id-less rewinds (rewindEntry(seq)) are still COUNTED (defensive — never exclude on bad data).
describe("mulligan_rewind — retry budget: cancelled rewinds excluded (BUG-005 / spec/08 E22)", () => {
  it("a rewind retired by a later mulligan:cancel does NOT consume budget", async () => {
    setConfig({ rewind: { maxRetriesPerPrompt: 2 } });
    const { appended, pi } = makePi();
    // countRetriesAtLatestPrompt: after the user prompt there are TWO mulligan:rewind markers (rw1, rw2),
    // but rw1 is retired by a mulligan:cancel(targetId=rw1). WITHOUT the fix → count=2 → 2>=2 → refuse.
    // WITH the fix → count=1 (only rw2 active) → 1<2 → succeed (marker persisted).
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("wrong target then right target")),
        rewindEntryWithId(1, "rw1"),
        cancelEntry("rw1"),
        rewindEntryWithId(2, "rw2"),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).not.toContain("per-prompt retry budget");
    expect(appended.length).toBeGreaterThan(0); // succeeded (not refused) → marker persisted
  });
});

// ── BUG-004: cancelled rewinds excluded from the cumulative depth (spec/05 §1 step 4 "count ACTIVE") ─────
// countRewindMarkers scans ALL entries (cumulative depth guard) for mulligan:cancel and skips rewinds whose
// data.id is targeted by one. Mirrors countRetriesAtLatestPrompt's BUG-005 fix + readMarkers' cancelledIds.
// Backward-compatible: id-less rewinds (rewindEntry(seq)) are still COUNTED (defensive — never exclude on bad data).
describe("mulligan_rewind — depth guard: cancelled rewinds excluded (BUG-004 / spec/05 §1 step 4 'count active')", () => {
  it("5 rewinds each retired by a mulligan:cancel → 0 active → a new rewind SUCCEEDS (not depth-refused)", async () => {
    const { appended, pi } = makePi();
    // countRewindMarkers scans ALL entries (cumulative depth guard). WITHOUT the fix → counts 5 rewind markers
    // → 5>=maxDepth(5) → refuse. WITH the fix → excludes the 5 cancelled (data.id ∈ cancel targetIds) → 0
    // active → 0<5 → succeed (marker persisted). Default maxDepth=5 (no setConfig needed).
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("cancel-then-retry workflow")),
        rewindEntryWithId(1, "rew-1"),
        cancelEntry("rew-1"),
        rewindEntryWithId(2, "rew-2"),
        cancelEntry("rew-2"),
        rewindEntryWithId(3, "rew-3"),
        cancelEntry("rew-3"),
        rewindEntryWithId(4, "rew-4"),
        cancelEntry("rew-4"),
        rewindEntryWithId(5, "rew-5"),
        cancelEntry("rew-5"),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_tool_call_group",
    });
    expect(firstText(res)).not.toContain("max rewind depth (5) reached");
    expect(firstText(res)).not.toContain("5 active rewind marker(s)");
    expect(firstText(res)).toContain("Mulligan: rewound");
    expect(appended).toHaveLength(1); // succeeded → one new marker persisted
  });
});

// ── P1.M3.T1.S2: checkpoint consumption (spec/05 §3 step 5 "Auto-expiry on consumption (REQUIRED)") ──
// These tests verify the S1 hook (src/tools/rewind.ts step 7b): a successful checkpoint rewind CONSUMES its
// target checkpoint — pi.setLabel(targetId, undefined) clears the label so mulligan_audit no longer lists it
// active, and a second rewind by the same name refuses (not found). Re-creating the checkpoint sets a fresh
// label. A non-checkpoint rewind never touches labels. A setLabel throw during consumption is swallowed (E13).
//
// GOTCHA #1 (the fake's entries array is STATIC): makeCtx().entries is NOT mutated by setLabel (setLabel only
//   pushes to makePi.labels). So scenarios (b)/(c) construct a FRESH ctx whose entries simulate the post-
//   consumption / post-re-create state, mirroring how the real session looks after the clear.
// GOTCHA #2 (labels captures the clear as { entryId, label: undefined }): assert via toContainEqual with
//   label: undefined (NOT a string). The default checkpointLabelEntry targetId is "leaf-1".
describe("mulligan_rewind — checkpoint consumption (spec/05 §3 step 5)", () => {
  it("(a) a successful checkpoint rewind clears the label → listCheckpoints drops it", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")], // label present (consumable)
      contextEntries: [msgEntry(user("u"))], // branch non-empty → resolveCheckpoint no-op
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success
    expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined }); // the CLEAR was captured
    // pure-fn assertion of the consumed state (what mulligan_audit would see post-clear):
    expect(
      listCheckpoints([
        { type: "label", targetId: "leaf-1", label: undefined },
      ]),
    ).not.toContain("anchor");
  });

  it("(b) a second rewind to the consumed name refuses 'not found'", async () => {
    const { pi } = makePi();
    // first rewind consumes "anchor"
    const { ctx: ctx1 } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [msgEntry(user("u"))],
    });
    await run(pi, ctx1, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    // second rewind: FRESH ctx whose entries simulate the consumed state (label gone)
    const { ctx: ctx2 } = makeCtx({
      entries: [],
      contextEntries: [msgEntry(user("u"))],
    });
    const res2 = await run(pi, ctx2, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res2)).toContain(
      "Mulligan: refused — checkpoint 'anchor' not found on this branch.",
    );
  });

  it("(c) re-creating the checkpoint sets a fresh label; a subsequent rewind works", async () => {
    const { labels, pi } = makePi();
    // first rewind consumes "x"
    const { ctx: ctx1 } = makeCtx({
      entries: [checkpointLabelEntry("x")],
      contextEntries: [msgEntry(user("u"))],
    });
    await run(pi, ctx1, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "x",
    });
    // simulate a re-create: a FRESH ctx whose entries contain a new checkpointLabelEntry("x")
    const { ctx: ctx2 } = makeCtx({
      entries: [checkpointLabelEntry("x")],
      contextEntries: [msgEntry(user("u"))],
    });
    const res2 = await run(pi, ctx2, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "x",
    });
    expect(firstText(res2)).toContain("Mulligan: rewound checkpoint."); // succeeds again
    expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined }); // the NEW clear was captured
    expect(labels).toHaveLength(2); // two clears total — one per rewind
  });

  it("(d) a non-checkpoint rewind does NOT consume — the checkpoint persists", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("persist")], // a checkpoint exists but won't be touched
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("c1")),
        msgEntry(result("c1")),
      ], // last_turn resolves
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toContain("Mulligan: rewound"); // the last_turn rewind succeeded
    expect(labels).toEqual([]); // NO setLabel call on a non-checkpoint path
    expect(listCheckpoints([checkpointLabelEntry("persist")])).toContain(
      "persist",
    ); // still active
  });

  it("(e) a setLabel throw during consumption is swallowed (E13) — rewind still succeeds", async () => {
    const { appended, pi } = makePi({ throwOnSetLabel: true }); // setLabel throws "setLabel boom"
    const { ctx } = makeCtx({
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [msgEntry(user("u"))],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success (NOT refusal)
    expect(firstText(res)).not.toContain("refused"); // not inverted to a failure
    expect(appended).toHaveLength(1); // marker still persisted (E13: clear failure never undoes the rewind)
  });

  // ── REGRESSION (validation issues #1a + #1b + #5): realistic multi-entry consumption ────────────────
  // The original suite masked two defects because scenario (a) used a SINGLE-element `entries` array where the
  // checkpoint label was entries[0] (so the buggy unconditional `break` happened to work) and scenario (b)
  // simulated the consumed state by swapping in a FRESH ctx instead of reflecting the clear in the SAME session.
  // These three tests use a REALISTIC multi-entry session (user msg, assistant, toolResult, THEN the checkpoint
  // label — i.e. the label is NOT entries[0]) and assert the full consumption contract end-to-end.

  it("(f) [regression 1a] a checkpoint rewind clears the label when the label is NOT the first entry", async () => {
    // Reproduces validation issue #1a: the buggy unconditional `break` exited the loop after entries[0] (a user
    // message), so pi.setLabel was never reached when the checkpoint label came later in the stream.
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("what files exist?")), // entries[0] — a user message (NOT the checkpoint)
        msgEntry(asst("call-1")), // entries[1] — assistant turn
        msgEntry(result("call-1")), // entries[2] — tool result
        checkpointLabelEntry("anchor"), // entries[3] — the checkpoint label (the buggy loop never reached here)
      ],
      contextEntries: [msgEntry(user("u"))], // branch non-empty → resolveCheckpoint no-op
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success
    // The label-clear MUST have been captured (the buggy code recorded 0 setLabel calls here).
    expect(labels).toContainEqual({ entryId: "leaf-1", label: undefined });
  });

  it("(g) [regression 1b] listCheckpoints drops a consumed checkpoint; a second rewind by name refuses", async () => {
    // Reproduces validation issue #1b: even with the loop fixed, scanning raw entries for a string match would
    // re-surface the HISTORICAL label after the clear entry was appended. Pi's getLabel (latest-wins) returns
    // undefined once a clear follows the set — checkpointExists + listCheckpoints must honor that.
    const { labels, pi } = makePi();
    // A realistic session WITH the clear entry appended (what getEntries() looks like AFTER consumption):
    //   [user, asst, toolResult, <checkpoint set>, ..., <checkpoint clear>]
    const { ctx } = makeCtx({
      entries: [
        msgEntry(user("what files exist?")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
        checkpointLabelEntry("anchor"), // the historical SET entry (string label)
        { type: "label", targetId: "leaf-1", label: undefined }, // the CLEAR entry (consumption)
      ],
      contextEntries: [msgEntry(user("u"))],
    });
    // (1) checkpointExists must see this checkpoint as CONSUMED → a rewind by the same name refuses.
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "anchor",
    });
    expect(firstText(res)).toContain(
      "Mulligan: refused — checkpoint 'anchor' not found on this branch.",
    );
    // (2) listCheckpoints (the mulligan_audit surface) must NOT list a consumed checkpoint.
    expect(listCheckpoints(ctx.sessionManager.getEntries())).not.toContain(
      "anchor",
    );
    // (3) no clear should have been recorded (the rewind refused before step 7b).
    expect(labels).toHaveLength(0);
  });

  it("(h) [regression 1b] a re-set checkpoint (set, clear, set-again) is active again", async () => {
    // The latest-wins map must RESURRECT a cleared target when it's re-set under the same name (re-create flow).
    const { pi } = makePi();
    const { ctx } = makeCtx({
      entries: [
        checkpointLabelEntry("x"), // set
        { type: "label", targetId: "leaf-1", label: undefined }, // cleared (consumed)
        { type: "label", targetId: "leaf-1", label: "mulligan:checkpoint:x" }, // re-set (re-created)
      ],
      contextEntries: [msgEntry(user("u"))],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "x",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // active again → succeeds
    expect(listCheckpoints(ctx.sessionManager.getEntries())).toContain("x");
  });

  it("(i) [regression BUG-001] two targets share a checkpoint name → BOTH cleared (no break)", async () => {
    // Reproduces BUG-001: Pi's labelsById is Map<targetId,label> with NO cross-target uniqueness, so when a
    // checkpoint name is set on two distinct targets BOTH carry the label. The old consumption loop cleared
    // ONLY the first-found (oldest) target then `break`ed, leaving the survivor labeled → checkpointExists
    // stayed true → a second rewind succeeded instead of refusing "not found" (spec/05 §3 step 5 violation).
    const { labels, pi } = makePi();
    // Two label entries with the same name on DIFFERENT targetIds (both currently active):
    const { ctx } = makeCtx({
      entries: [
        checkpointLabelEntry("x", "msg-a"), // targetA (older); resolveCheckpoint scans REVERSE → targets msg-b
        checkpointLabelEntry("x", "msg-b"), // targetB (newer)
      ],
      contextEntries: [msgEntry(user("u"))], // branch non-empty → resolveCheckpoint no-op (success path)
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "x",
    });
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint."); // success
    // BUG-001 contract: BOTH targets cleared (the old code cleared only msg-a, then broke):
    expect(labels).toContainEqual({ entryId: "msg-a", label: undefined });
    expect(labels).toContainEqual({ entryId: "msg-b", label: undefined });
    // A second rewind by the same name refuses "not found" (both targets now consumed):
    const { ctx: ctx2 } = makeCtx({
      entries: [
        checkpointLabelEntry("x", "msg-a"),
        checkpointLabelEntry("x", "msg-b"),
      ],
      labels: { "msg-a": undefined, "msg-b": undefined }, // override → simulate post-consumption (both cleared)
      contextEntries: [msgEntry(user("u"))],
    });
    const res2 = await run(pi, ctx2, {
      note: VALID_NOTE,
      granularity: "checkpoint",
      checkpoint: "x",
    });
    expect(firstText(res2)).toContain(
      "Mulligan: refused — checkpoint 'x' not found on this branch.",
    );
  });
});
// ── P4.M1.T1.S1: v1.2 working-tree revert params (schema additions; logic is P4.M2.T1) ──────
// RewindParams gained two Type.Optional(Type.Boolean(...)) fields: revert_file_changes + delete_created_files.
// This item is schema + description ONLY — the params are CARRIED but NOT yet acted on (step 6b is P4.M2.T1).
// These tests prove: (a) backward-compat (omitting the new fields still works), (b) schema presence
// (both keys are present + boolean at the typebox level), (c) a positive-path call that DOES pass
// revert_file_changes:true is accepted but NOT yet reverted (no premature step-6b wiring).

describe("mulligan_rewind — v1.2 revert params (P4.M1.T1.S1)", () => {
  // (a) BACKWARD-COMPAT — calling with ONLY {note, granularity} (no new fields) behaves exactly as before.
  // Easiest robust variant: a config-disabled refusal (no snapshot needed) so we assert the NORMAL refusal text.
  it("calling with {note, granularity} (NO new fields) still behaves normally (backward-compat)", async () => {
    setConfig({ rewind: { enabled: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
    });
    expect(firstText(res)).toBe("Mulligan: refused — rewind is disabled.");
  });

  // (b) SCHEMA PRESENCE — the typebox schema carries both keys, each a boolean.
  it("RewindParams.properties carries revert_file_changes + delete_created_files as booleans", () => {
    const props = RewindParams.properties as Record<string, { type?: string }>;
    expect(props).toHaveProperty("revert_file_changes");
    expect(props).toHaveProperty("delete_created_files");
    expect(props.revert_file_changes?.type).toBe("boolean");
    expect(props.delete_created_files?.type).toBe("boolean");
  });

  // (c) POSITIVE-PATH — a call that DOES pass revert_file_changes:true is accepted but NOT yet reverted
  //     (the param is ignored until P4.M2.T1). Guards against prematurely wiring step-6b logic.
  it("passing revert_file_changes:true is accepted but does NOT yet revert (success text has no 'Reverted')", async () => {
    const { pi } = makePi();
    // seed a minimal snapshot so the success path resolves (a user msg + a non-excluded toolGroup → K>0)
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const res = await run(pi, ctx, {
      note: VALID_NOTE,
      granularity: "last_turn",
      revert_file_changes: true,
    });
    expect(firstText(res)).toContain("Mulligan: rewound"); // accepted (not refused)
    // CRITICAL #5: NO step-6b logic in this item → the success text must NOT contain a "Reverted" clause
    // (that wording lands in P4.M2.T1).
    expect(firstText(res)).not.toContain("Reverted");
  });
});

// ── P4.M2.T1.S1: step 6b working-tree-revert decision tree (spec/05 §1 step 6b; @14 §6/§7) ─────
//
// The decision tree: gate on config → gate on granularity → resolve checkpoint → dirty guard → proceed.
// Each terminal branch appends an EXACT notice string to the success text; the proceed branch is a comment
// seam for S2 (P4.M2.T1.S2 does the actual store.restore). These tests SEED rt.store + rt.snapshots via the
// hand-rolled makeFakeStore (NO vi.fn() — closure-driven) so the resolve/guard branches are unit-testable.
// The success path needs a contextEntries snapshot so the rewind reaches step 6b (mirror the existing success
// test idiom: a user msg + a non-excluded toolGroup so resolveLastTurn returns a non-empty remove set; K may
// be 0, that is fine — 6b runs regardless of K as long as the rewind is not refused earlier).

/**
 * makeFakeStore — a hand-rolled SnapshotStore fake for the 6b tests (mirrors the file's idiom: NO vi.fn()).
 * Scripts `dirtyCheck` via a closure: `drifted` is the list it returns; `throwOnCheck` makes it throw (E13).
 * [P4.M2.T1.S2] EXTENDED for the restore fold: `restoreResult` is the scripted RestoreResult restore returns
 * (defaults to 5 empty buckets); `restoreCalls` captures every restore invocation ({beforeRef, opts}) so the
 * proceed tests can assert the call happened EXACTLY ONCE with the verbatim opts (CRITICAL #3). `restoreThrows`
 * makes restore throw (the E27/E13 fail-open test). `restoreCalled` (S1) kept for backward-compat.
 */
function makeFakeStore(opts: {
  drifted?: string[];
  throwOnCheck?: boolean;
  restoreCalled?: () => void;
  restoreResult?: RestoreResult;
  restoreCalls?: { beforeRef: string; opts: RestoreOpts }[];
  restoreThrows?: boolean;
}): SnapshotStore {
  return {
    describe: () => ({ backend: "git" }),
    capture: async () => "ref-x",
    dirtyCheck: async (_afterRef: string, _paths: string[]) => {
      if (opts.throwOnCheck) throw new Error("dirtyCheck boom");
      return [...(opts.drifted ?? [])];
    },
    restore: async (beforeRef: string, o: RestoreOpts) => {
      opts.restoreCalled?.();
      opts.restoreCalls?.push({ beforeRef, opts: o });
      if (opts.restoreThrows) throw new Error("restore boom");
      return (
        opts.restoreResult ?? {
          reverted: [],
          deleted: [],
          failed: [],
          skipped: [],
          refused: [],
        }
      );
    },
    has: async () => true,
    retire: async () => {
      /* no-op */
    },
    gc: async () => {
      /* no-op */
    },
    destroy: async () => {
      /* no-op */
    },
  } as unknown as SnapshotStore;
}

/** Seed a "turn" checkpoint into rt.snapshots (the last_turn key). */
function seedTurnCheckpoint(rt: {
  snapshots?: Map<string, RevertCheckpoint>;
}): void {
  rt.snapshots!.set("turn", {
    label: "turn",
    backend: "git",
    beforeRef: "rb",
    afterRef: "ra",
    turnIndex: 0,
    ts: Date.now(),
  });
}

/** Seed a checkpoint-granularity checkpoint into rt.snapshots under the "ckpt:<name>" key. */
function seedCkptCheckpoint(
  rt: { snapshots?: Map<string, RevertCheckpoint> },
  name: string,
): void {
  rt.snapshots!.set(`ckpt:${name}`, {
    label: `ckpt:${name}`,
    backend: "git",
    beforeRef: "rb",
    // checkpoints capture once → NO afterRef (the afterRef ?? beforeRef fallback exercises the checkpoint path)
    turnIndex: 0,
    ts: Date.now(),
  });
}

describe("mulligan_rewind step 6b decision tree (P4.M2.T1.S1)", () => {
  // (a) NO FLAGS REGRESSION — NEITHER revert flag set ⇒ step 6b skipped entirely; byte-identical v1.1 path.
  it("skips 6b entirely when NEITHER revert flag is set (byte-identical v1.1 path; no 'file revert' text)", async () => {
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn" },
      "call-1",
    );
    // the EXACT v1.1 string (K=2, no warning, no revert clause)
    expect(firstText(res)).toBe(
      "Mulligan: rewound last_turn. 2 messages will be hidden from your view starting next turn. Note left.",
    );
    expect(firstText(res)).not.toContain("file revert"); // 6b never ran
    expect(res.details.revertRefused).toBe(false); // flag stays false (never refused; not undefined — it is always present on the success path)
  });

  // (b) DISABLED — flags set but config.revert.enabled=false → disabled notice; skip.
  it("appends '(file revert requested but disabled in config)' when flags set but config.revert.enabled=false", async () => {
    setConfig({ revert: { enabled: false } });
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
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert requested but disabled in config)",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // rewind STILL succeeds
  });

  // (c) GROUP GRANULARITY — flags set at last_tool_call_group → granularity-mismatch notice; skip.
  it("appends the granularity-mismatch notice when flags set at last_tool_call_group", async () => {
    setConfig({ revert: { enabled: true } });
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
    const res = await run(
      pi,
      ctx,
      {
        note: VALID_NOTE,
        granularity: "last_tool_call_group",
        revert_file_changes: true,
      },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.",
    );
    expect(res.details.revertRefused).toBe(false); // granularity skip ≠ refuse (false, not undefined — always present on the success path)
  });

  // (d) MISSING SNAPSHOT — flags set + enabled + supported granularity but NO rt.snapshots entry → skip notice.
  it("appends the skip notice (0 reverted) when the checkpoint is MISSING (no rt.snapshots entry)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: [] }); // store present but NO "turn" checkpoint seeded
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // rewind STILL succeeds
    expect(firstText(res)).not.toContain("refused");
  });

  // (e) NO STORE — rt.store is undefined (store never created at session_start) → same skip notice.
  it("appends the skip notice when rt.store is undefined (store never created)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    seedTurnCheckpoint(rt); // checkpoint present but NO store
    rt.store = undefined;
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)",
    );
  });

  // (f) DIRTY GUARD REFUSE — dirtyCheck returns drifted paths → refuse notice + details.revertRefused===true.
  it("REFUSES the whole file-revert when dirtyCheck returns drifted paths; details.revertRefused===true", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: ["src/a.ts", "src/b.ts"] });
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert refused: 2 path(s) changed since the turn ended — not overwritten; re-request if intended)",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // the REWIND still proceeds (only the file-revert refused)
    expect(res.details.revertRefused).toBe(true);
  });

  // (g) PROCEED — [P4.M2.T1.S2] dirty guard clean → store.restore called EXACTLY ONCE; the success text carries
  //     the VERBATIM revert clause; the persisted marker carries the revert block; revertSummary is populated.
  //     (FLIPPED from S1's "must NOT call restore" assertion — S2 fills the seam.)
  it("PROCEEDS: store.restore called once with checkpoint.beforeRef + verbatim opts; success text carries the clause; marker carries the revert block", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    rt.store = makeFakeStore({
      drifted: [],
      restoreResult: {
        reverted: ["src/a.ts"],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      },
      restoreCalls,
    });
    seedTurnCheckpoint(rt); // beforeRef "rb"
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // rewind succeeds
    // the VERBATIM revert clause (no leading space — spec/05 §1 step 6b + spec/14 §7)
    expect(firstText(res)).toContain(
      "Reverted 1 file(s), deleted 0; 0 skipped/failed, 0 refused (see log).",
    );
    expect(firstText(res)).not.toContain("file revert refused"); // clean guard → proceeds (not refused)
    expect(res.details.revertRefused).toBe(false); // guard ran + was clean (explicitly false, not undefined)
    // restore called EXACTLY ONCE with checkpoint.beforeRef (NOT afterRef) + the verbatim opts (CRITICAL #3/#4)
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0].beforeRef).toBe("rb"); // checkpoint.beforeRef (the PRE-span ref)
    expect(restoreCalls[0].opts.revertFileChanges).toBe(true);
    expect(restoreCalls[0].opts.deleteCreatedFiles).toBe(false);
    // the persisted marker carries the revert block (folded into the ORIGINAL entry — see test (k))
    const marker = appended.find((a) => a.customType === "mulligan:rewind")!
      .data as RewindMarker;
    expect(marker.revert).toBeDefined();
    expect(marker.revert!.revertedFiles).toEqual(["src/a.ts"]);
    expect(marker.revert!.deletedFiles).toEqual([]);
    expect(marker.revert!.failedFiles).toEqual([]);
    expect(marker.revert!.refusedFiles).toEqual([]);
    expect(marker.revert!.skipped).toBe(false); // skipped.length > 0 → false
    expect(marker.revert!.backend).toBe("git"); // store.describe().backend
    // revertSummary surfaced for P4.M2.T2.T1 (the warning reword) + logs/audit
    expect(res.details.revertSummary).toBeDefined();
    expect(res.details.revertSummary!.reverted).toBe(1);
    expect(res.details.revertSummary!.deleted).toBe(0);
    expect(res.details.revertSummary!.failed).toBe(0);
    expect(res.details.revertSummary!.skipped).toBe(0);
    expect(res.details.revertSummary!.refused).toBe(0);
    expect(res.details.revertSummary!.backend).toBe("git");
  });

  // (h) CHECKPOINT KEY — granularity "checkpoint" resolves via the "ckpt:<name>" key (NOT "checkpoint:<name>").
  it("resolves checkpoint granularity via the 'ckpt:<name>' key (NOT 'checkpoint:<name>')", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      // checkpointExists needs an active label entry for "anchor" to pass the step-3 existence check
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [msgEntry(user("u"))], // branch messages for resolveCheckpoint
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: [] }); // clean guard → proceeds
    seedCkptCheckpoint(rt, "anchor"); // seed under "ckpt:anchor" (the CORRECT key)
    const res = await run(
      pi,
      ctx,
      {
        note: VALID_NOTE,
        granularity: "checkpoint",
        checkpoint: "anchor",
        revert_file_changes: true,
      },
      "call-1",
    );
    expect(firstText(res)).toContain("Mulligan: rewound checkpoint.");
    // the checkpoint resolved via "ckpt:anchor" → clean guard → proceeds → NO skip/dirty-guard-refuse notice.
    // [P4.M2.T1.S2] the proceed branch now appends the revert clause (with its own "0 refused (see log)" text),
    // so assert the DIRTY-GUARD refuse notice is absent (not the bare word "refused", which the clause contains).
    expect(firstText(res)).not.toContain("no working-tree snapshot");
    expect(firstText(res)).not.toContain("file revert refused");
    expect(res.details.revertRefused).toBe(false);
  });

  // (i) WRONG CHECKPOINT KEY — seeding under "checkpoint:<name>" (the WRONG key) hits the missing-snapshot branch.
  it("hits the missing-snapshot branch when the checkpoint key is wrong ('checkpoint:<name>' does not resolve)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      entries: [checkpointLabelEntry("anchor")],
      contextEntries: [msgEntry(user("u"))],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: [] });
    // seed under the WRONG key ("checkpoint:anchor") → the code reads "ckpt:anchor" → misses → skip notice
    rt.snapshots!.set("checkpoint:anchor", {
      label: "checkpoint:anchor",
      backend: "git",
      beforeRef: "rb",
      turnIndex: 0,
      ts: Date.now(),
    });
    const res = await run(
      pi,
      ctx,
      {
        note: VALID_NOTE,
        granularity: "checkpoint",
        checkpoint: "anchor",
        revert_file_changes: true,
      },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)",
    );
  });

  // (j) E13 FAIL-OPEN — a dirtyCheck THROW degrades to the skip notice; the rewind completes (no throw escapes).
  it("E13 fail-open: a dirtyCheck THROW degrades to 'file revert skipped: an error occurred' (rewind succeeds)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ throwOnCheck: true }); // dirtyCheck THROWS
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert skipped: an error occurred — 0 files reverted)",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // rewind STILL completes
    expect(firstText(res)).not.toContain("refused");
    expect(res.details.revertRefused).toBe(false); // NOT the refuse path (the throw degraded to skip)
  });
});
// ── P4.M2.T1.S2: step 6b restore fold (spec/05 §1 step 6b; @14 §6/§7) ──────────────────────────
//
// S2 fills the proceed seam: store.restore(checkpoint.beforeRef, opts) runs + the RestoreResult folds into
// (a) the success text (the verbatim "Reverted X file(s), deleted Y; Z skipped/failed, W refused (see log)." clause)
// and (b) the persisted marker's `revert` block ({revertedFiles, deletedFiles, failedFiles, refusedFiles, skipped,
// backend}). Because the session tree is append-only (C7), the persist (step 7) was RELOCATED to AFTER step 6b so
// the revert block rides the spread into the ORIGINAL marker entry (verified by the one-marker-entry test below).
// These tests extend the hand-rolled makeFakeStore (scripted restoreResult + restoreCalls capture).

// A reusable last_turn success-path seed (a user msg + a non-excluded toolGroup so K may be 0 — 6b runs regardless).
// Threads a scripted restoreResult + a restoreCalls capture into the fake store + seeds the "turn" checkpoint.
function seedProceedLastTurn(
  sid: string,
  restoreResult: RestoreResult,
  restoreCalls: { beforeRef: string; opts: RestoreOpts }[],
): { ctx: ExtensionContext; rt: ReturnType<typeof getRuntime> } {
  const { ctx } = makeCtx({
    sessionId: sid,
    contextEntries: [
      msgEntry(user("u")),
      msgEntry(asst("X")),
      msgEntry(result("X")),
      msgEntry(asst("call-1")),
      msgEntry(result("call-1")),
    ],
  });
  const rt = getRuntime(sid);
  rt.store = makeFakeStore({ drifted: [], restoreResult, restoreCalls });
  seedTurnCheckpoint(rt);
  return { ctx, rt };
}

describe("mulligan_rewind step 6b restore fold (P4.M2.T1.S2)", () => {
  // (a) DELETIONS — restoreResult.deleted:["src/new.ts"] → text "deleted 1"; marker.revert.deletedFiles populated.
  it("folds deletions: 'deleted 1' in text; marker.revert.deletedFiles === [path]; revertSummary.deleted === 1", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = seedProceedLastTurn(
      "s1",
      {
        reverted: [],
        deleted: ["src/new.ts"],
        failed: [],
        skipped: [],
        refused: [],
      },
      restoreCalls,
    );
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "Reverted 0 file(s), deleted 1; 0 skipped/failed, 0 refused (see log).",
    );
    const marker = appended.find((a) => a.customType === "mulligan:rewind")!
      .data as RewindMarker;
    expect(marker.revert!.deletedFiles).toEqual(["src/new.ts"]);
    expect(marker.revert!.revertedFiles).toEqual([]);
    expect(res.details.revertSummary!.deleted).toBe(1);
  });

  // (b) FAILURES + SKIPPED — failed:["x"], skipped:["y"] → text "2 skipped/failed"; marker.revert.skipped===true.
  it("folds failures+skipped: '<Z> skipped/failed' with the COUNT; marker.revert.failedFiles + skipped===true", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = seedProceedLastTurn(
      "s1",
      {
        reverted: [],
        deleted: [],
        failed: ["src/x.ts"],
        skipped: ["src/y.ts"],
        refused: [],
      },
      restoreCalls,
    );
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    // Z = skipped.length + failed.length = 2
    expect(firstText(res)).toContain(
      "Reverted 0 file(s), deleted 0; 2 skipped/failed, 0 refused (see log).",
    );
    const marker = appended.find((a) => a.customType === "mulligan:rewind")!
      .data as RewindMarker;
    expect(marker.revert!.failedFiles).toEqual(["src/x.ts"]);
    expect(marker.revert!.skipped).toBe(true); // skipped.length > 0 → true
    expect(res.details.revertSummary!.failed).toBe(1);
    expect(res.details.revertSummary!.skipped).toBe(1); // the COUNT is preserved in revertSummary
  });

  // (c) REFUSED-FROM-RESTORE — distinct from the dirty-guard refuse (which never reaches restore). restore returning
  //     refused:["z"] (e.g. a mid-restore conflict) → text "1 refused"; marker.revert.refusedFiles populated.
  it("folds refused-from-restore: '<W> refused' in text; marker.revert.refusedFiles populated (distinct from dirty-guard refuse)", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = seedProceedLastTurn(
      "s1",
      {
        reverted: [],
        deleted: [],
        failed: [],
        skipped: [],
        refused: ["src/z.ts"],
      },
      restoreCalls,
    );
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "Reverted 0 file(s), deleted 0; 0 skipped/failed, 1 refused (see log).",
    );
    const marker = appended.find((a) => a.customType === "mulligan:rewind")!
      .data as RewindMarker;
    expect(marker.revert!.refusedFiles).toEqual(["src/z.ts"]);
    expect(res.details.revertSummary!.refused).toBe(1);
  });

  // (d) delete_created_files threading — the tool passes deleteCreatedFiles verbatim (NO tool-side allowDelete gate;
  //     the backend gates config.revert.allowDeleteCreatedFiles — CRITICAL #3).
  it("threads delete_created_files through to RestoreOpts.deleteCreatedFiles (no tool-side allowDelete gate; CRITICAL #3)", async () => {
    setConfig({ revert: { enabled: true } });
    const { pi } = makePi();
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = seedProceedLastTurn(
      "s1",
      { reverted: [], deleted: [], failed: [], skipped: [], refused: [] },
      restoreCalls,
    );
    // delete_created_files:true, revert_file_changes OMITTED (false) — confirms the flag threads through verbatim
    await run(
      pi,
      ctx,
      {
        note: VALID_NOTE,
        granularity: "last_turn",
        delete_created_files: true,
      },
      "call-1",
    );
    expect(restoreCalls).toHaveLength(1);
    expect(restoreCalls[0].opts.deleteCreatedFiles).toBe(true);
    expect(restoreCalls[0].opts.revertFileChanges).toBe(false);
  });

  // (e) ONE-MARKER-ENTRY — the re-order: the revert block rides the SAME entry as id/seq (NOT a follow-up amendment).
  it("persists EXACTLY ONE mulligan:rewind entry carrying data.revert (re-order, not an amendment)", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
    const { ctx } = seedProceedLastTurn(
      "s1",
      {
        reverted: ["src/a.ts"],
        deleted: [],
        failed: [],
        skipped: [],
        refused: [],
      },
      restoreCalls,
    );
    await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    // EXACTLY ONE mulligan:rewind entry (NOT two — no follow-up amendment — the persist relocation).
    const rewindEntries = appended.filter(
      (a) => a.customType === "mulligan:rewind",
    );
    expect(rewindEntries).toHaveLength(1);
    // that single entry's data.revert IS populated (proves persist ran AFTER 6b, not before).
    const marker = rewindEntries[0].data as RewindMarker;
    expect(marker.revert).toBeDefined();
    expect(marker.revert!.revertedFiles).toEqual(["src/a.ts"]);
  });

  // (f) NON-PROCEED regression — each of S1's terminal branches leaves data.revert undefined + revertSummary
  //     undefined + restore uncalled (the persist relocation must not leak a revert field on these paths).
  it("NON-PROCEED branches leave data.revert undefined + revertSummary undefined + restore uncalled", async () => {
    setConfig({ revert: { enabled: true } });

    // (1) disabled branch
    {
      const { appended, pi } = makePi();
      const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
      const { ctx } = seedProceedLastTurn(
        "s1",
        {
          reverted: ["should-not-happen.ts"],
          deleted: [],
          failed: [],
          skipped: [],
          refused: [],
        },
        restoreCalls,
      );
      // OVERRIDE config to disabled AFTER seeding (seedProceedLastTurn does not touch config)
      setConfig({ revert: { enabled: false } });
      const res = await run(
        pi,
        ctx,
        {
          note: VALID_NOTE,
          granularity: "last_turn",
          revert_file_changes: true,
        },
        "call-1",
      );
      const marker = appended.find((a) => a.customType === "mulligan:rewind")!
        .data as RewindMarker;
      expect(marker.revert).toBeUndefined();
      expect(res.details.revertSummary).toBeUndefined();
      expect(restoreCalls).toHaveLength(0);
      setConfig({ revert: { enabled: true } }); // restore for the next sub-case
    }

    // (2) NO FLAGS (the byte-identical v1.1 path) — step 6b never runs at all
    {
      const { appended, pi } = makePi();
      const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
      const { ctx } = seedProceedLastTurn(
        "s1",
        {
          reverted: ["no.ts"],
          deleted: [],
          failed: [],
          skipped: [],
          refused: [],
        },
        restoreCalls,
      );
      const res = await run(
        pi,
        ctx,
        { note: VALID_NOTE, granularity: "last_turn" },
        "call-1",
      );
      const marker = appended.find((a) => a.customType === "mulligan:rewind")!
        .data as RewindMarker;
      expect(marker.revert).toBeUndefined();
      expect(res.details.revertSummary).toBeUndefined();
      expect(restoreCalls).toHaveLength(0);
    }

    // (3) missing-snapshot branch (no "turn" checkpoint)
    {
      const { appended, pi } = makePi();
      const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
      const { ctx } = makeCtx({
        sessionId: "s2",
        contextEntries: [
          msgEntry(user("u")),
          msgEntry(asst("X")),
          msgEntry(result("X")),
          msgEntry(asst("call-1")),
          msgEntry(result("call-1")),
        ],
      });
      const rt = getRuntime("s2");
      rt.store = makeFakeStore({ restoreCalls }); // store present but NO "turn" checkpoint seeded
      const res = await run(
        pi,
        ctx,
        {
          note: VALID_NOTE,
          granularity: "last_turn",
          revert_file_changes: true,
        },
        "call-1",
      );
      const marker = appended.find((a) => a.customType === "mulligan:rewind")!
        .data as RewindMarker;
      expect(marker.revert).toBeUndefined();
      expect(res.details.revertSummary).toBeUndefined();
      expect(restoreCalls).toHaveLength(0);
    }

    // (4) dirty-guard refuse branch
    {
      const { appended, pi } = makePi();
      const restoreCalls: { beforeRef: string; opts: RestoreOpts }[] = [];
      const { ctx } = makeCtx({
        sessionId: "s3",
        contextEntries: [
          msgEntry(user("u")),
          msgEntry(asst("X")),
          msgEntry(result("X")),
          msgEntry(asst("call-1")),
          msgEntry(result("call-1")),
        ],
      });
      const rt = getRuntime("s3");
      rt.store = makeFakeStore({ drifted: ["src/drift.ts"], restoreCalls });
      seedTurnCheckpoint(rt);
      const res = await run(
        pi,
        ctx,
        {
          note: VALID_NOTE,
          granularity: "last_turn",
          revert_file_changes: true,
        },
        "call-1",
      );
      const marker = appended.find((a) => a.customType === "mulligan:rewind")!
        .data as RewindMarker;
      expect(marker.revert).toBeUndefined();
      expect(res.details.revertSummary).toBeUndefined();
      expect(restoreCalls).toHaveLength(0);
    }
  });

  // (g) E13 restore-throw fail-open — store.restore THROWS → degrades to S1's skip notice; revertBlock stays
  //     undefined (no marker.revert); the rewind STILL completes. (store.restore never throws per E27, but the
  //     guard must hold — reuses S1's existing inner try/catch; no second try/catch added.)
  it("E13: a store.restore THROW degrades to 'file revert skipped: an error occurred' (rewind succeeds; no revert field)", async () => {
    setConfig({ revert: { enabled: true } });
    const { appended, pi } = makePi();
    const sid = "s1";
    const { ctx } = makeCtx({
      sessionId: sid,
      contextEntries: [
        msgEntry(user("u")),
        msgEntry(asst("X")),
        msgEntry(result("X")),
        msgEntry(asst("call-1")),
        msgEntry(result("call-1")),
      ],
    });
    const rt = getRuntime(sid);
    rt.store = makeFakeStore({ drifted: [], restoreThrows: true }); // clean guard → proceeds → restore THROWS
    seedTurnCheckpoint(rt);
    const res = await run(
      pi,
      ctx,
      { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
      "call-1",
    );
    expect(firstText(res)).toContain(
      "(file revert skipped: an error occurred — 0 files reverted)",
    );
    expect(firstText(res)).toContain("Mulligan: rewound last_turn."); // rewind STILL completes
    expect(firstText(res)).not.toContain("Reverted"); // the clause never fired (restore threw before the fold)
    expect(firstText(res)).not.toContain("file revert refused");
    // revertBlock stayed undefined → marker has NO revert field; revertSummary undefined
    const marker = appended.find((a) => a.customType === "mulligan:rewind")!
      .data as RewindMarker;
    expect(marker.revert).toBeUndefined();
    expect(res.details.revertSummary).toBeUndefined();
  });
});
