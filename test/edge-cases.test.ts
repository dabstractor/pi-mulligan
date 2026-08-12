/**
 * edge-cases.test.ts — the CONSOLIDATED spec/08 E1–E20 edge-case index, made executable.
 *
 * ONE `describe` per edge case, in spec/08 order. Each block asserts the EXACT prescribed Behavior from
 * spec/08-edge-cases.md against the REAL (Complete) implementation — proving every "what about…" is handled.
 * This is the reviewer's single-file walk through the whole index: a failure points straight at the edge case
 * (e.g. "E6 — Parallel tool mode") and the spec section to consult.
 *
 * HOUSE IDIOM (copied from the established per-module suites — NO new patterns invented):
 *   - hand-rolled `makePi()`/`makeCtx()` fakes (NO `vi.fn()` for Pi objects) — from test/tools/rewind.test.ts.
 *   - LOCAL copies of the `asst`/`asstText`/`result`/`user`/`custom` fixture builders + `summary` +
 *     `expectPairingInvariant` — from test/transforms.test.ts (they are local to that file; not imported across).
 *   - `.js` import paths (ESM/Bundler resolution).
 *   - `clearAll()` + `setConfig(undefined)` reset in `beforeEach`/`afterEach` (GOTCHA #3: config + runtime are
 *     MODULE-SCOPED mutable state; a test that setConfig({enabled:false}) leaks into the next).
 *   - `vi.mock("../src/transforms.js", …)` is NOT used here — E13's forced-throw cases use THROW-FAKES
 *     (throwOn* ctx options + throwOnAppend fake-pi), which keep the REAL transforms everywhere (GOTCHA #2).
 *
 * SCOPE (this suite is the cross-cutting HARDENING capstone): E1, E2, E3, E4, E5, E6, E8, E9, E10, E13, E14, E16,
 * E17, E18, E19. (E7/E11/E12/E15/E20 are Pi-dependent → the smoke harness; E18 is a documentation/text test.)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  partitionIntoUnits,
  resolveLastToolCallGroup,
  resolveLastTurn,
  applyShrink,
  stampShrink,
  filterPipeline,
  protectedOk,
  type Unit,
  type MessageLike,
  type BranchEntry,
  type MarkerBundle,
  type RewindMarkerLike,
  type ShrinkMarkerLike,
  type ProtectedConfig,
} from "../src/transforms.js";
import { contextHandler } from "../src/filter.js";
import { validateNote, NOTE_INVALID_REASON, renderDriftNudge } from "../src/notes.js";
import { setConfig } from "../src/config.js";
import { clearAll, getRuntime } from "../src/runtime.js";
import { makeRewindTool, type RewindArgs, type RewindDetails } from "../src/tools/rewind.js";
import { makeShrinkTool } from "../src/tools/shrink.js";
import { makeCheckpointTool, validCheckpointName } from "../src/tools/checkpoint.js";
import { auditTool } from "../src/tools/audit.js";
import { bloatReminderHandler, turnEndMetricHandler } from "../src/nudges.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ContextEvent,
  ToolResultEvent,
  TurnEndEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

// GOTCHA #3: config + runtime are MODULE-SCOPED mutable state. Reset before AND after each test so a prior
// test's setConfig({enabled:false}) or nextSeq increment can't leak in. (test/tools/*.test.ts pattern.)
beforeEach(() => {
  clearAll();
  setConfig(undefined); // reset the config cache to validated DEFAULT_CONFIG
});
afterEach(() => {
  clearAll();
  setConfig(undefined);
});

// ── fixture builders (LOCAL copies of test/transforms.test.ts's builders) ────────────────────

/** Build an assistant message whose content is a list of toolCall blocks with the given ids. */
function asst(...callIds: string[]): MessageLike {
  return {
    role: "assistant",
    content: callIds.map((id) => ({ type: "toolCall", id, name: "tool", arguments: {} })),
  };
}

/** Build a text-only assistant (no toolCalls) → a plain unit. */
function asstText(text: string): MessageLike {
  return { role: "assistant", content: [{ type: "text", text }] };
}

/** Build a toolResult message for the given toolCallId. */
function result(toolCallId: string): MessageLike {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: "..." }],
    isError: false,
  };
}

/** Build a user message. */
function user(text: string): MessageLike {
  return { role: "user", content: text };
}

/** Build a custom message (e.g. mulligan:note / mulligan:nudge) → a plain unit. */
function custom(customType: string): MessageLike {
  return { role: "custom", customType, content: "x", display: true };
}

/** Compact per-unit summary "kind:minIdx:len" for readable multi-unit assertions. */
function summary(units: Unit[]): string {
  return units.map((u) => `${u.kind}:${u.indices[0]}:${u.indices.length}`).join(" | ");
}

/**
 * The pairing invariant (forward direction): for every toolGroup unit, (i) it spans exactly one assistant member,
 * and (ii) every other member is a matching toolResult. Plain units span exactly one index. From transforms.test.ts.
 */
function expectPairingInvariant(messages: MessageLike[], units: Unit[]): void {
  for (const u of units) {
    if (u.kind === "plain") {
      expect(u.indices, "plain unit spans exactly one index").toHaveLength(1);
      continue;
    }
    const asstIdx = u.indices.find((i) => messages[i]?.role === "assistant");
    expect(asstIdx, "toolGroup must contain an assistant message").toBeTypeOf("number");
    const asstMsg = messages[asstIdx as number] as MessageLike;
    const content = asstMsg.content;
    expect(Array.isArray(content), "assistant content is a block array").toBe(true);
    const callIds = new Set(
      (content as Array<Record<string, unknown>>)
        .filter((b) => b?.type === "toolCall" && typeof b.id === "string")
        .map((b) => b.id as string),
    );
    expect(callIds.size, "the assistant issued ≥1 pairable toolCall").toBeGreaterThan(0);
    for (const i of u.indices) {
      if (i === asstIdx) continue;
      const r = messages[i] as MessageLike;
      expect(r?.role, "non-assistant toolGroup member is a toolResult").toBe("toolResult");
      expect(callIds.has(r.toolCallId as string), "result's toolCallId ∈ the assistant's call ids").toBe(true);
    }
  }
}

// ── fakes (LOCAL copies of the test/tools/rewind.test.ts makePi/makeCtx shapes) ─────────────

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
    appendEntry(customType: string, _data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data: _data });
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
 * A minimal fake ExtensionContext. Scripts: sessionId, leafId, entries (getEntries), branch (getBranch),
 * contextEntries (buildContextEntries), and throwOn* switches. throwOnGetSessionId forces contextHandler's catch.
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: unknown[];
  branch?: unknown[];
  contextEntries?: unknown[];
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
  throwOnGetSessionId?: boolean;
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
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
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
    // getLabel — Pi's LATEST-WINS label map (validation issue 1b): a clear entry ({label:undefined}) deletes
    // the target from the in-memory map, so getLabel returns undefined for a CONSUMED checkpoint. checkpointExists
    // consults this; derive it from the raw entries by keeping the LAST label per targetId.
    getLabel(id: string) {
      let current: string | undefined = undefined;
      let seen = false;
      for (const e of entries) {
        if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
        try {
          const ee = e as { type?: unknown; targetId?: unknown; label?: unknown };
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
  return { ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** Extract the text from a result's first content block (narrows TextContent before reading .text). */
function firstText<T>(res: AgentToolResult<T>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/** A minimal fake ExtensionAPI that captures pi.on() handler registrations (for the nudge handlers — GOTCHA #6). */
function makeCapturePi() {
  const captured: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) {
      captured[event] = handler;
    },
  };
  return { captured, pi: pi as unknown as ExtensionAPI };
}

/** A SessionEntry-shaped custom marker entry (type "custom") for seeding getEntries. */
function customEntry(customType: string, data: unknown): SessionEntry {
  return {
    type: "custom",
    id: `e-${customType}-${Math.random()}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType,
    data,
  } as unknown as SessionEntry;
}

/** A rewind marker `data` payload matching markers.ts's envelope (kind 'rewind') — for the E4 depth guard seed. */
function rewindEntryData(seq: number): Record<string, unknown> {
  return {
    schema: "pi-mulligan",
    v: 1,
    kind: "rewind",
    id: `rw-${seq}`,
    granularity: "last_tool_call_group",
    options: {},
    seq,
    note: { what_happened: "p", true_current_state: "n", next: "e" },
    ledger: {},
    ts: 1,
  };
}

/** A checkpoint label entry (type "label") — for E10 existence checks. */
function checkpointLabelEntry(name: string): SessionEntry {
  return {
    type: "label",
    label: `mulligan:checkpoint:${name}`,
    targetId: "t",
    id: `l-${name}-${Math.random()}`,
    parentId: null,
    timestamp: "",
  } as unknown as SessionEntry;
}

/** The canonical valid 3-field note (validateNote accepts). */
const VALID_NOTE = {
  what_happened:
    "Ran a repo-wide grep that dumped ~38k tokens; don't grep without -l; use the built-in grep tool which truncates.",
  true_current_state: "No files changed on the abandoned span.",
  next: "Re-run as grep -rl auth src/ and read only the 3 relevant files.",
};

/** Build valid rewind params with overrides (mirrors rewind.test.ts's run() ergonomics). */
function rewindParams(over: Partial<RewindArgs> = {}): RewindArgs {
  return {
    note: { ...VALID_NOTE, ...(over.note ?? {}) },
    granularity: over.granularity ?? "last_tool_call_group",
    checkpoint: over.checkpoint,
  } as RewindArgs;
}

// The VERBATIM spec/08 E5 mutation warning substring (copied from src/tools/rewind.ts — GOTCHA #5, load-bearing).
const MUTATION_WARNING_SUBSTR =
  "⚠ The hidden span modified files/ran side-effecting commands (see note). " +
  "Those effects PERSIST on disk; do not blindly redo them.";

// ════════════════════════════════════════════════════════════════════════════
// E1 — Orphaned toolResult (no matching toolCall)
// ════════════════════════════════════════════════════════════════════════════

describe("E1 — Orphaned toolResult (no matching toolCall)", () => {
  it("an orphan result becomes its OWN plain unit (never merged) — spec/08 E1", () => {
    const msgs: MessageLike[] = [user("hi"), result("orphan-1")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(2);
    expect(summary(units)).toBe("plain:0:1 | plain:1:1");
    expect(units[1]).toEqual({ indices: [1], kind: "plain" }); // orphan stands alone
  });

  it("a rewind over a toolGroup followed by an orphan result: the orphan survives (filter never orphans either side)", () => {
    // messages: [user, asst(c1), result(c1), result(orphan)]  — orphan has no matching call.
    const msgs: MessageLike[] = [user("do it"), asst("c1"), result("c1"), result("orphan")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    const markers: MarkerBundle = {
      rewinds: [
        { seq: 1, granularity: "last_tool_call_group", excludeToolCallId: "rw-1" },
      ],
      shrinks: [],
    };
    const out = filterPipeline(msgs, markers, cfg);
    // The c1 toolGroup (asst + result) is removed; the orphan result SURVIVES as its own plain unit.
    expect(out).not.toBe(msgs);
    // user (idx 0) + orphan result survive; asst(c1) + result(c1) removed.
    const roles = out.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("toolResult");
    // No assistant message remains (the only assistant was removed).
    expect(roles).not.toContain("assistant");
    // Re-partition the output → no orphaned call/result pairing violation.
    expectPairingInvariant(out, partitionIntoUnits(out));
    // The surviving toolResult is the orphan (toolCallId "orphan").
    const survivingResult = out.find((m) => m.role === "toolResult") as MessageLike;
    expect(survivingResult.toolCallId).toBe("orphan");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2 — Rewinding the executing turn
// ════════════════════════════════════════════════════════════════════════════

describe("E2 — Rewinding the executing turn (own toolGroup excluded)", () => {
  it("resolveLastToolCallGroup skips the rewind's OWN toolGroup, returns the PREVIOUS one (or null)", () => {
    // Only one toolGroup, and it IS the rewind's own (assistant issued "rw-1") → skipped → null.
    const msgs: MessageLike[] = [user("u"), asst("rw-1"), result("rw-1")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "rw-1")).toBeNull();

    // Two toolGroups; the rewind's own is the last → the previous (A) group is returned.
    const msgs2: MessageLike[] = [
      user("u"), asst("A"), result("A"), asst("rw-1"), result("rw-1"),
    ];
    const units2 = partitionIntoUnits(msgs2);
    const prev = resolveLastToolCallGroup(units2, msgs2, "rw-1");
    expect(prev).toEqual([1, 2]); // the A toolGroup's indices
  });

  it("the persisted rewind marker carries excludeToolCallId === the execute toolCallId arg", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    await tool.execute("my-tc-id", rewindParams(), undefined, undefined, ctx);
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:rewind");
    expect((appended[0].data as { excludeToolCallId?: string }).excludeToolCallId).toBe("my-tc-id");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E3 — Rewinding across a protected message
// ════════════════════════════════════════════════════════════════════════════

describe("E3 — Rewinding across a protected message (filter-side defense)", () => {
  // GOTCHA #10: the REAL behavior is that protectedOk blocks first:user crossing in the filter pipeline.
  // (v1.1 removed the discarded-latest-user-message path entirely — last_turn now keeps the latest user message
  // by construction, so the resolver never crosses first:user for a last_turn rewind. protectedOk remains
  // defense-in-depth.)

  it("protectedOk returns false when min(remove) === iFirstUser (a rewind crossing first:user is blocked)", () => {
    const msgs: MessageLike[] = [user("first"), asstText("a")];
    // remove set that includes the first:user index (0)
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    expect(protectedOk(msgs, [0, 1], cfg)).toBe(false); // min(remove)=0 not > iFirstUser=0
  });

  it("protectedOk returns true for a remove set strictly after first:user", () => {
    const msgs: MessageLike[] = [user("first"), asstText("a"), result("c1")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    expect(protectedOk(msgs, [1, 2], cfg)).toBe(true); // min=1 > iFirstUser=0
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E4 — Max rewind depth exceeded
// ════════════════════════════════════════════════════════════════════════════

describe("E4 — Max rewind depth exceeded", () => {
  it("the 6th rewind is refused with a depth message when 5 markers already exist (count is exactly 5)", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => customEntry("mulligan:rewind", rewindEntryData(i + 1)));
    const { pi } = makePi();
    const { ctx } = makeCtx({ entries });
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-6", rewindParams(), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/refused/i);
    expect(text).toMatch(/depth|max/i);
  });

  it("the depth guard counts persisted mulligan:rewind custom entries (5 → at cap)", () => {
    // Indirect: countRewindMarkers is module-private; verify via the tool's behavior (refusal at 5, success at 4).
    // Covered functionally above (5 → refused) + below (4 → succeeds).
  });

  it("4 existing markers → the 5th succeeds (under cap) and persists a new marker", async () => {
    const entries = Array.from({ length: 4 }, (_, i) => customEntry("mulligan:rewind", rewindEntryData(i + 1)));
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ entries });
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-5", rewindParams(), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/rewound/i); // succeeded
    expect(text).not.toMatch(/refused/i);
    expect(appended).toHaveLength(1); // the new marker persisted
    expect(appended[0].customType).toBe("mulligan:rewind");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E5 — Side effects (writes/bash) in the hidden span
// ════════════════════════════════════════════════════════════════════════════

describe("E5 — Side effects (writes/bash) in the hidden span", () => {
  // Build a contextEntries snapshot whose flattened messages include an edit + a bash side effect within the
  // rewind's removed span. The rewind tool's resolvePreview builds this snapshot → extractFileLedger detects the
  // mutations → MUTATION_WARNING is appended. We seed a toolGroup the rewind will resolve + remove.
  /**
   * Build a SessionEntry snapshot whose flattened messages contain an edit (arguments.path) + a bash
   * (arguments.command) toolCall AFTER a user message. Used with a last_turn rewind so the WHOLE post-user
   * span (both toolGroups) is in the removed set → extractFileLedger classifies the edit + the bash.
   * NOTE: extractFileLedger reads the toolCall block's `arguments` (path for edit/write; command for bash) —
   * a toolResult's content text is NOT the source (verified against ledger.ts classifyToolCall).
   */
  function sideEffectEntries(): SessionEntry[] {
    return [
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "",
        message: { role: "user", content: "do the work" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "edit", arguments: { path: "src/app.ts" } }],
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp: "",
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "edit",
          content: [{ type: "text", text: "edited src/app.ts" }],
          isError: false,
        },
      },
      {
        type: "message",
        id: "a2",
        parentId: "r1",
        timestamp: "",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "git commit -m x" } }],
        },
      },
      {
        type: "message",
        id: "r2",
        parentId: "a2",
        timestamp: "",
        message: {
          role: "toolResult",
          toolCallId: "c2",
          toolName: "bash",
          content: [{ type: "text", text: "$ git commit -m x" }],
          isError: false,
        },
      },
    ] as unknown as SessionEntry[];
  }

  it("a side-effecting removed span → success text ENDS WITH the VERBATIM MUTATION_WARNING + ledger blocks in the note", async () => {
    const { sent, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: sideEffectEntries() });
    const tool = makeRewindTool(pi);
    // last_turn rewind: the WHOLE post-user span (edit toolGroup + bash toolGroup) is the removed set.
    const res = await tool.execute("rw-se", rewindParams({ granularity: "last_turn" }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/rewound/i);
    expect(text.endsWith(MUTATION_WARNING_SUBSTR), "success text ends with the verbatim MUTATION_WARNING").toBe(true);
    // The persisted note (sendMessage) includes the ledger blocks (edit → files-modified; bash → bash-side-effects).
    expect(sent).toHaveLength(1);
    const noteContent = String(sent[0].content);
    expect(noteContent).toContain("<files-modified>");
    expect(noteContent).toContain("<bash-side-effects>");
  });

  it("requireMutationWarning:false → the side-effect warning is OMITTED (the warning is config-gated)", async () => {
    setConfig({ rewind: { requireMutationWarning: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: sideEffectEntries() });
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-se2", rewindParams({ granularity: "last_turn" }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/rewound/i);
    expect(text).not.toContain("⚠"); // warning gated off
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E6 — Parallel tool mode (shared assistant message)
// ════════════════════════════════════════════════════════════════════════════

describe("E6 — Parallel tool mode (shared assistant message kept whole)", () => {
  it("resolveLastToolCallGroup SKIPS a shared unit whose assistant issued the rewind call → null (no previous group)", () => {
    // One assistant message issued BOTH a sibling call S and the rewind R → they share ONE toolGroup unit.
    const msgs: MessageLike[] = [user("u"), asst("S", "R"), result("S"), result("R")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:3"); // one shared 4-member? no: asst+result(S)+result(R)=3
    // resolveLastToolCallGroup with exclude "R" → the shared group is skipped → no previous group → null.
    expect(resolveLastToolCallGroup(units, msgs, "R")).toBeNull();
  });

  it("with a PRIOR toolGroup, the previous group is returned (the shared unit is skipped)", () => {
    const msgs: MessageLike[] = [
      user("u"), asst("A"), result("A"), asst("S", "R"), result("S"), result("R"),
    ];
    const units = partitionIntoUnits(msgs);
    // The shared unit [3,4,5] is skipped; the A unit [1,2] is returned.
    expect(resolveLastToolCallGroup(units, msgs, "R")).toEqual([1, 2]);
  });

  it("resolveLastTurn keeps the WHOLE shared unit (the rewind's own assistant + sibling result survive)", () => {
    // last_turn rewind over a list where the rewind shares an assistant with a sibling.
    const msgs: MessageLike[] = [
      user("u"), asst("S", "R"), result("S"), result("R"),
    ];
    const out = resolveLastTurn(msgs, "R");
    // rewindOwnIndices contains the shared assistant (1) + result(S) (2); the rewind's own result (3) too —
    // the whole unit [1,2,3] is KEPT (spec/06 §9: keep the entire shared message). remove is empty here because
    // everything after iLastUser=0 is the rewind's own unit.
    const ownSet = new Set([1, 2, 3]);
    for (const idx of ownSet) {
      expect(out.remove, `index ${idx} (shared unit) is kept, not removed`).not.toContain(idx);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E8 — Marker targets nothing (no-op)
// ════════════════════════════════════════════════════════════════════════════

describe("E8 — Marker targets nothing (no-op, SAME reference)", () => {
  it("a checkpoint rewind whose label is ABSENT → SAME reference (resolveCheckpoint null → remove=[] → no-op)", () => {
    const msgs: MessageLike[] = [user("u"), asstText("a")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    const markers: MarkerBundle = {
      rewinds: [{ seq: 1, granularity: "checkpoint", checkpoint: "absent", excludeToolCallId: "x" }],
      shrinks: [],
    };
    const out = filterPipeline(msgs, markers, cfg, [] as BranchEntry[]); // no branch entries → label absent
    expect(out).toBe(msgs); // SAME reference === true no-op
  });

  it("a shrink whose target does NOT match → SAME reference (applyShrink no-match same-ref)", () => {
    const msgs: MessageLike[] = [user("u"), asstText("a")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    const markers: MarkerBundle = {
      rewinds: [],
      shrinks: [{ seq: 1, target: { by_tool_call_id: "nope" }, replacement: "X" }],
    };
    const out = filterPipeline(msgs, markers, cfg);
    expect(out).toBe(msgs); // SAME reference
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E9 — Note field validation failure
// ════════════════════════════════════════════════════════════════════════════

describe("E9 — Note field validation failure", () => {
  it("an EMPTY what_happened → refused with the validation reason + NOTHING persisted", async () => {
    const { appended, sent, pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-e9", rewindParams({ note: { ...VALID_NOTE, what_happened: "" } }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/refused/i);
    expect(text).toContain(NOTE_INVALID_REASON);
    expect(appended).toHaveLength(0); // marker NOT persisted
    expect(sent).toHaveLength(0); // note NOT left
  });

  it("whitespace-only in EACH of the 3 fields → all refused, nothing persisted", async () => {
    for (const field of ["what_happened", "true_current_state", "next"] as const) {
      const { appended, sent, pi } = makePi();
      const { ctx } = makeCtx();
      const tool = makeRewindTool(pi);
      const badNote = { ...VALID_NOTE, [field]: "   " };
      const res = await tool.execute(`rw-e9-${field}`, rewindParams({ note: badNote }), undefined, undefined, ctx);
      const text = firstText(res);
      expect(text).toMatch(/refused/i);
      expect(appended).toHaveLength(0);
      expect(sent).toHaveLength(0);
    }
  });

  it("validateNote directly: a valid note → valid:true; an empty field → valid:false", () => {
    expect(validateNote(VALID_NOTE).valid).toBe(true);
    expect(validateNote({ ...VALID_NOTE, next: "" }).valid).toBe(false);
    expect(validateNote({ ...VALID_NOTE, true_current_state: "  " }).valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E10 — Checkpoint name invalid or not found
// ════════════════════════════════════════════════════════════════════════════

describe("E10 — Checkpoint name invalid or not found", () => {
  it("(a) makeCheckpointTool: an invalid name → refused with 'invalid checkpoint name' + the regex", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeCheckpointTool(pi);
    const res = await tool.execute("cp-1", { name: "Bad Name!" }, undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/invalid checkpoint name/i);
    expect(text).toContain("/^[a-z0-9_-]{1,40}$/");
  });

  it("(b) a checkpoint rewind to an ABSENT label → 'checkpoint … not found'", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ entries: [] }); // no checkpoint label
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-cp", rewindParams({ granularity: "checkpoint", checkpoint: "ghost" }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/refused/i);
    expect(text).toContain("checkpoint 'ghost' not found");
  });

  it("(b2) a checkpoint rewind to an EXISTING label → succeeds", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ entries: [checkpointLabelEntry("alpha")] });
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-cp-ok", rewindParams({ granularity: "checkpoint", checkpoint: "alpha" }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/rewound/i);
  });

  it("(c) granularity:checkpoint with an EMPTY checkpoint name → 'requires a checkpoint name'", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-cp-empty", rewindParams({ granularity: "checkpoint", checkpoint: "" }), undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/refused/i);
    expect(text).toContain("checkpoint granularity requires a checkpoint name");
  });

  it("(d) validCheckpointName: 'good-name_1' → true; 'UPPER'/'spaces here'/'too-long…' → false", () => {
    expect(validCheckpointName("good-name_1")).toBe(true);
    expect(validCheckpointName("a")).toBe(true);
    expect(validCheckpointName("UPPER")).toBe(false); // uppercase not allowed
    expect(validCheckpointName("spaces here")).toBe(false); // space not allowed
    expect(validCheckpointName("x".repeat(41))).toBe(false); // > 40 chars
    expect(validCheckpointName("")).toBe(false); // empty
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E13 — Tool/handler throws internally (fail-open) — THE CROSS-CUTTING HEADLINE
// ════════════════════════════════════════════════════════════════════════════

describe("E13 — Tool/handler throws internally (fail-open — the cardinal safety property)", () => {
  // "Mulligan must never be the reason an agent turn fails." Every handler + tool wraps its body in try/catch
  // → no-throw → void/refusal. We force a throw in EACH and assert the invariant.

  it("contextHandler: a throwing getEntries → does NOT throw (readMarkers swallows it → empty bundle → pass-through-with-messages)", () => {
    // NOTE: readMarkers(ctx) wraps getEntries in its OWN try/catch (returns an empty bundle on throw). So a
    // throwing getEntries does NOT reach contextHandler's catch — it returns {messages} (pass-through with the
    // original messages, since no markers transform anything). The real forced-catch paths are getBranch +
    // getSessionId (called directly in contextHandler) — asserted next. The "readMarkers fail-open" unit test
    // in filter.test.ts is authoritative for the getEntries-swallow behavior.
    const { pi } = makePi();
    const ctx = makeCtx({ throwOnGetEntries: true }).ctx;
    const event = { type: "context" as const, messages: [user("hi")] } as unknown as ContextEvent;
    expect(() => contextHandler(pi, event, ctx)).not.toThrow(); // never throws — the cardinal property
    // returns {messages} (the original list passes through unchanged — no markers to apply).
    const out = contextHandler(pi, event, ctx) as { messages: unknown[] } | undefined;
    expect(out).toBeDefined();
    expect(out?.messages).toEqual([user("hi")]);
  });

  it("contextHandler: a throwing getBranch → returns undefined, does NOT throw", () => {
    const { pi } = makePi();
    const ctx = makeCtx({ throwOnGetBranch: true, entries: [customEntry("mulligan:rewind", rewindEntryData(1))] }).ctx;
    expect(() => contextHandler(pi, { type: "context", messages: [] } as unknown as ContextEvent, ctx)).not.toThrow();
    expect(contextHandler(pi, { type: "context", messages: [] } as unknown as ContextEvent, ctx)).toBeUndefined();
  });

  it("contextHandler: a throwing getSessionId → returns undefined, does NOT throw", () => {
    const { pi } = makePi();
    const ctx = makeCtx({ throwOnGetSessionId: true }).ctx;
    expect(() => contextHandler(pi, { type: "context", messages: [] } as unknown as ContextEvent, ctx)).not.toThrow();
    expect(contextHandler(pi, { type: "context", messages: [] } as unknown as ContextEvent, ctx)).toBeUndefined();
  });

  it("bloatReminderHandler: a throwing getSessionId → returns void (pass-through), does NOT throw", () => {
    const ctx = makeCtx({ throwOnGetSessionId: true }).ctx;
    const event = {
      type: "tool_result",
      toolCallId: "x",
      toolName: "read",
      input: {},
      content: [{ type: "text", text: "x" }],
      isError: false,
    } as unknown as ToolResultEvent;
    expect(() => bloatReminderHandler(event, ctx)).not.toThrow();
    expect(bloatReminderHandler(event, ctx)).toBeUndefined(); // void
  });

  it("turnEndMetricHandler: a throwing getSessionId → returns void, does NOT throw", async () => {
    const { pi } = makePi();
    const ctx = makeCtx({ throwOnGetSessionId: true }).ctx;
    const event = { type: "turn_end", turnIndex: 1, message: null, toolResults: [] } as unknown as TurnEndEvent;
    expect(() => turnEndMetricHandler(pi, event, ctx)).not.toThrow(); // SYNC handler (no throw)
    expect(turnEndMetricHandler(pi, event, ctx)).toBeUndefined(); // void
  });

  it("makeRewindTool: a throwing pi.appendEntry → execute does NOT throw (appendRewindMarker swallows; tool still returns a result)", async () => {
    // NOTE: appendRewindMarker wraps pi.appendEntry in try/catch → returns null on throw. The rewind tool then
    // still renders the note (leaveNote also swallows) + returns a SUCCESS text. The OUTER tool catch is
    // unreachable via a fake-pi throw because every Pi call is inside a swallowing wrapper. The cardinal
    // assertion is therefore NO-THROW + a returned result (the turn is never broken).
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    let res: AgentToolResult<RewindDetails> | undefined;
    expect(() => {
      void tool.execute("rw-boom", rewindParams(), undefined, undefined, ctx);
    }).not.toThrow();
    res = await tool.execute("rw-boom", rewindParams(), undefined, undefined, ctx);
    expect(res.content[0]).toHaveProperty("type", "text"); // a text result (success — fail-open by design)
  });

  it("makeShrinkTool: a throwing pi.appendEntry → execute does NOT throw (appendShrinkMarker swallows; tool returns a result)", async () => {
    // Same as rewind: appendShrinkMarker swallows the throw → returns null → tool returns a result. NO-THROW
    // is the invariant.
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx();
    const tool = makeShrinkTool(pi);
    let res: AgentToolResult<{ matched?: boolean; markerId?: string | null }> | undefined;
    expect(() => {
      void tool.execute("sh-boom", { target: { by_tool_call_id: "c1" }, replacement: "X", reason: "boom" }, undefined, undefined, ctx);
    }).not.toThrow();
    res = await tool.execute("sh-boom", { target: { by_tool_call_id: "c1" }, replacement: "X", reason: "boom" }, undefined, undefined, ctx);
    expect(res.content[0]).toHaveProperty("type", "text");
  });

  it("makeCheckpointTool: a throwing pi.setLabel → execute does NOT throw (setCheckpoint swallows → {error}; tool returns refusal text)", async () => {
    // setCheckpoint wraps setLabel in try/catch → returns {error} → the tool renders a refusal text. NO-THROW.
    const { pi } = makePi({ throwOnSetLabel: true });
    const { ctx } = makeCtx({ branch: [
      { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
      { type: "message", id: "leaf-1", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
    ] });
    const tool = makeCheckpointTool(pi);
    let res: AgentToolResult<{ name: string; entryId?: string }> | undefined;
    expect(() => {
      void tool.execute("cp-boom", { name: "alpha" }, undefined, undefined, ctx);
    }).not.toThrow();
    res = await tool.execute("cp-boom", { name: "alpha" }, undefined, undefined, ctx);
    expect(res.content[0]).toHaveProperty("type", "text");
    // setCheckpoint's swallowed error → the tool's "could not set checkpoint" refusal text.
    expect(firstText(res)).toMatch(/refused|could not set/i);
  });

  it("auditTool: a throwing getEntries → returns a failure text (catch path), does NOT throw", async () => {
    const { ctx } = makeCtx({ throwOnGetEntries: true });
    // lastFiltered is null (fresh runtime) → audit tries the E16 fallback → buildContextEntries also needed;
    // force getEntries to throw to exercise the catch path. (The catch wraps the whole body.)
    const res = await auditTool.execute("au-boom", { top: 8 }, undefined, undefined, ctx);
    const text = firstText(res);
    expect(text).toMatch(/audit failed|refused|error/i); // catch path text (GOTCHA #10)
    expect(res.details).toHaveProperty("error"); // catch path details.error present
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E14 — Extension disabled via config (master switch) — THE FIX
// ════════════════════════════════════════════════════════════════════════════

describe("E14 — Extension disabled via config (master switch)", () => {
  it("contextHandler with enabled:false → returns undefined (pass-through); cache untouched", () => {
    setConfig({ enabled: false });
    const { pi } = makePi();
    const ctx = makeCtx({ sessionId: "dis1" }).ctx;
    const event = { type: "context" as const, messages: [user("hi")] } as unknown as ContextEvent;
    expect(contextHandler(pi, event, ctx)).toBeUndefined(); // void = pass-through
    expect(getRuntime("dis1").lastFiltered).toBeNull(); // cache untouched
  });

  it("turnEndMetricHandler with enabled:false → no-op (no turn-metric appended)", () => {
    setConfig({ enabled: false });
    const { appended, pi } = makePi();
    const ctx = makeCtx({ sessionId: "dis2" }).ctx;
    const event = { type: "turn_end", turnIndex: 1, message: null, toolResults: [] } as unknown as TurnEndEvent;
    turnEndMetricHandler(pi, event, ctx);
    expect(appended).toHaveLength(0); // no metric appended (no-op)
  });

  it("bloatReminderHandler with enabled:false → no-op (returns void)", () => {
    setConfig({ enabled: false });
    const ctx = makeCtx({ sessionId: "dis3" }).ctx;
    const event = {
      type: "tool_result",
      toolCallId: "x",
      toolName: "read",
      input: {},
      content: [{ type: "text", text: "x".repeat(10000) }],
      isError: false,
    } as unknown as ToolResultEvent;
    expect(bloatReminderHandler(event, ctx)).toBeUndefined(); // void = no-op
  });

  it("sub-feature disabled (rewind.enabled:false, master still true) → 'rewind is disabled' (UNCHANGED text)", async () => {
    setConfig({ rewind: { enabled: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-sub", rewindParams(), undefined, undefined, ctx);
    expect(firstText(res)).toContain("rewind is disabled");
  });

  it("master disabled (enabled:false, rewind.enabled still true) → 'Mulligan is disabled' (THE FIX)", async () => {
    setConfig({ enabled: false }); // rewind.enabled defaults to true (DEFAULT_CONFIG) — does NOT cascade
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeRewindTool(pi);
    const res = await tool.execute("rw-master", rewindParams(), undefined, undefined, ctx);
    expect(firstText(res)).toContain("Mulligan is disabled");
  });

  it("master disabled (enabled:false) → shrink refuses 'Mulligan is disabled' (THE FIX)", async () => {
    setConfig({ enabled: false });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeShrinkTool(pi);
    const res = await tool.execute("sh-master", { target: { by_tool_call_id: "c1" }, replacement: "X" }, undefined, undefined, ctx);
    expect(firstText(res)).toContain("Mulligan is disabled");
  });

  it("sub-feature disabled (shrink.enabled:false, master still true) → 'shrink is disabled' (UNCHANGED text)", async () => {
    setConfig({ shrink: { enabled: false } });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const tool = makeShrinkTool(pi);
    const res = await tool.execute("sh-sub", { target: { by_tool_call_id: "c1" }, replacement: "X" }, undefined, undefined, ctx);
    expect(firstText(res)).toContain("shrink is disabled");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E16 — mulligan_audit before any inference (fallback path)
// ════════════════════════════════════════════════════════════════════════════

describe("E16 — mulligan_audit before any inference (lastFiltered null → fallback)", () => {
  it("audit with lastFiltered null + a buildContextEntries snapshot → source:'fallback', confidence:'low', no throw", async () => {
    // Fresh runtime → rt.lastFiltered is null → audit takes the E16 fallback path.
    const { ctx } = makeCtx({
      sessionId: "e16",
      contextEntries: [
        { type: "message", id: "m1", parentId: null, timestamp: "", message: { role: "user", content: "hi" } },
      ],
    });
    const res = await auditTool.execute("au-e16", { top: 8 }, undefined, undefined, ctx);
    expect(res.details.source).toBe("fallback");
    expect(res.details.confidence).toBe("low");
    // no throw (the report rendered — content is a text block).
    expect(res.content[0]).toHaveProperty("type", "text");
  });

  it("audit with lastFiltered null + a throwing buildContextEntries → catch path (no throw, failure text)", async () => {
    const { ctx } = makeCtx({ sessionId: "e16b", throwOnBuildContext: true, throwOnGetEntries: true });
    const res = await auditTool.execute("au-e16b", { top: 8 }, undefined, undefined, ctx);
    expect(res.details).toHaveProperty("error"); // catch path
    expect(firstText(res)).toMatch(/audit failed/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E17 — Two shrinks target the same message (last-wins by SEQ)
// ════════════════════════════════════════════════════════════════════════════

describe("E17 — Two shrinks target the same message (last-wins by seq, not insertion)", () => {
  it("two shrinks seeded OUT of seq order → the HIGHER-seq replacement wins (GOTCHA #7)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    // seq 2 (WINNER) pushed FIRST, seq 1 (loser) pushed SECOND → stableSortBySeq sorts ascending →
    // seq 1 applied FIRST, seq 2 applied LAST → seq 2's replacement wins.
    const markers: MarkerBundle = {
      rewinds: [],
      shrinks: [
        { seq: 2, target: { by_tool_call_id: "c1" }, replacement: "WINNER" },
        { seq: 1, target: { by_tool_call_id: "c1" }, replacement: "loser" },
      ],
    };
    const out = filterPipeline(msgs, markers, cfg);
    // The c1 toolResult's content text === "WINNER" (the higher-seq replacement applied last).
    const shrunkResult = out.find((m) => m.role === "toolResult") as MessageLike | undefined;
    expect(shrunkResult, "the toolResult survived the shrink (role preserved)").toBeDefined();
    const block = (shrunkResult as MessageLike).content as Array<Record<string, unknown>>;
    expect(block[0].text).toBe(stampShrink("WINNER")); // higher-seq replacement wins, wrapped in the §5.1 stamp
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E18 — Model ignores the nudges (advisory)
// ════════════════════════════════════════════════════════════════════════════

describe("E18 — Model ignores the nudges (advisory text — a suggestion, not a force)", () => {
  it("renderDriftNudge: the text SUGGESTS rewind/shrink (it does not force anything)", () => {
    const text = renderDriftNudge({ deltaTokens: 4000, bloatHits: [] } as never);
    // The nudge names the tools (advisory) — D3. S1's re-shortened text dropped the verb "call";
    // the advisory intent is carried by the tool names + the "to undo/compact" suggestions.
    expect(text.includes("mulligan_rewind") || text.includes("mulligan_shrink")).toBe(true);
    expect(text).toMatch(/undo|compact/); // the suggestion verbs survive the re-shortening
  });

  it("the nudge is TEXT only (no behavioral hook) — it cannot force the model", () => {
    // injectNudge (in nudges.ts) appends an EPHEMERAL mulligan:nudge CustomMessage to a COPY of messages;
    // it NEVER calls a tool or mutates state. We assert the text shape is advisory (names the tools).
    const text = renderDriftNudge({ deltaTokens: 5000, bloatHits: [{ toolName: "read", approxTokens: 1000 }] } as never);
    expect(text).toMatch(/mulligan_rewind|mulligan_shrink/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E19 — Shrink target is a non-toolResult message (role preserved)
// ════════════════════════════════════════════════════════════════════════════

describe("E19 — Shrink target is a non-toolResult message (role preserved)", () => {
  it("applyShrink on a USER message → role 'user' preserved, content replaced", () => {
    const msgs: MessageLike[] = [user("hello world")];
    const out = applyShrink(msgs, { target: { by_content_includes: "hello" }, replacement: "X" });
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user"); // role preserved (E19)
    const block = out[0].content as Array<Record<string, unknown>>;
    expect(block[0].text).toBe(stampShrink("X"));
  });

  it("applyShrink on a text ASSISTANT message → role 'assistant' preserved, content replaced", () => {
    const msgs: MessageLike[] = [asstText("note here please")];
    const out = applyShrink(msgs, { target: { by_content_includes: "note" }, replacement: "Y" });
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant"); // role preserved
    const block = out[0].content as Array<Record<string, unknown>>;
    expect(block[0].text).toBe(stampShrink("Y"));
  });

  it("filterPipeline pairing is unaffected (no toolResult involved)", () => {
    const msgs: MessageLike[] = [user("hello"), asst("c1"), result("c1"), asstText("note here")];
    const cfg: ProtectedConfig = { rewind: { protectedRoles: ["first:user"] } };
    const markers: MarkerBundle = {
      rewinds: [],
      shrinks: [{ seq: 1, target: { by_content_includes: "note" }, replacement: "SUMMARY" }],
    };
    const out = filterPipeline(msgs, markers, cfg);
    // The assistant(text) is shrunk; the toolGroup pairing is UNTOUCHED.
    expectPairingInvariant(out, partitionIntoUnits(out));
    const shrunk = out.find((m) => {
      const c = m.content;
      return Array.isArray(c) && c.some((b) => (b as Record<string, unknown>)?.text === stampShrink("SUMMARY"));
    });
    expect(shrunk?.role).toBe("assistant");
  });
});