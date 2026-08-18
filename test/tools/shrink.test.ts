/**
 * shrink.test.ts — unit tests for the `mulligan_shrink` tool (src/tools/shrink.ts).
 *
 * Mirrors the house tool-test idiom from test/tools/checkpoint.test.ts + test/tools/rewind.test.ts:
 * vitest, hand-rolled `makePi()`/`makeCtx()` fakes (NO vi.fn()), `.js` import paths, `expectTypeOf` for
 * type assertions, `clearAll()` runtime reset (nextSeq mutates the shared module-scoped runtime map —
 * GOTCHA #8 in markers.test.ts). Reuses the markers.test.ts makePi (captures appendEntry) + a makeCtx
 * that scripts buildContextEntries (the shrink snapshot source — GOTCHA #5/#12).
 *
 * Coverage (the PRP Task 6–10 case list):
 *   a) registration metadata (spec/05 §5): name/label/description(VERBATIM)/parameters.
 *   b) config-disabled refusal (E14) — appendShrinkMarker NOT called.
 *   c) empty-replacement refusal (incl. whitespace-only) — no persistence.
 *   d) structurally-impossible-target refusal (empty/whitespace discriminator, each arm) — no persistence.
 *   e) best-effort match yes (matched:yes on a scripted toolResult by EACH of the 3 matchers) + persistence payload.
 *   f) v2.0 current-turn scope: no IN-TURN match (no-match-anywhere, or a match only in an earlier turn) →
 *      HARD REFUSAL at creation, nothing persisted. A snapshot that can't be verified (throwing
 *      buildContextEntries) still persists matched:no (E13 fail-safe — the filter's scope guard keeps an
 *      unverifiable marker harmless).
 *   g) best-effort failure (throwing buildContextEntries → matched:no + STILL persists — E13).
 *   h) persistence payload exactness ({target, replacement, reason} + envelope {schema, v, kind, id, seq, ts}).
 *   i) markerId in details (getLeafId return; null when leafId null — still success).
 *   j) never-throws (every failure path → text result, execute never rejects).
 *   k) result shape (content is [{type:"text", text:string}] AND details present on EVERY path — GOTCHA #4).
 *   l) types (ToolDefinition<ShrinkParams, ShrinkDetails>; ShrinkArgs === Static<typeof ShrinkParams>).
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  makeShrinkTool,
  ShrinkParams,
  SHRINK_DESC,
  shrinkOrientationLine,
  type ShrinkArgs,
  type ShrinkDetails,
} from "../../src/tools/shrink.js";
import { Value } from "typebox/value";
import { Compile } from "typebox/compile";
import { estimateTokens } from "../../src/tokens.js"; // the SAME estimator the tool uses (v1.2 ~<t> numbers)
import { setConfig } from "../../src/config.js";
import { clearAll } from "../../src/runtime.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// GOTCHA #8: nextSeq (used INSIDE appendShrinkMarker) mutates the SHARED module-scoped runtime map.
// clearAll() before AND after each test so a previous test's seq can't leak in.
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (markers.test.ts makePi shape, trimmed to appendEntry — shrink does NOT use sendMessage/setLabel) ─

/**
 * A minimal fake ExtensionAPI capturing appendEntry calls (hand-rolled, NO vi.fn() — house pattern).
 * Set `throwOnAppend` to simulate a Pi appendEntry failure (appendShrinkMarker swallows it → null).
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
 * A minimal fake ExtensionContext. Scripts:
 *   - sessionId (getSessionId — appendShrinkMarker reads it for nextSeq; default "s1")
 *   - leafId (getLeafId — the captured marker entry id; default "leaf-1"; null → appendShrinkMarker returns null)
 *   - contextEntries (buildContextEntries — SessionEntry[] snapshot flattened to messages for the best-effort match)
 * Set throwOn* flags to simulate failures (GOTCHA #5: the match try/catches → false; appendShrinkMarker try/catches → null).
 */
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  contextEntries?: SessionEntry[];
  throwOnGetSessionId?: boolean;
  throwOnGetLeafId?: boolean;
  throwOnBuildContextEntries?: boolean;
  /** Whether dialog-capable UI is available (ctx.hasUI). Default: true. */
  hasUI?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  // default to "leaf-1" UNLESS leafId is explicitly passed (incl. null) — lets callers test the null return.
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const contextEntries = opts.contextEntries ?? [];
  // Recorded ctx.ui.notify calls (P1.M2.T1.S2 operator echo). Existing `const { ctx } = makeCtx(...)` still works.
  const notifyCalls: { message: string; type?: string }[] = [];
  const sessionManager = {
    getSessionId() {
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    getLeafId() {
      if (opts.throwOnGetLeafId) throw new Error("getLeafId boom");
      return scriptedLeafId;
    },
    buildContextEntries() {
      if (opts.throwOnBuildContextEntries) throw new Error("buildContextEntries boom");
      return contextEntries;
    },
  };
  const ctx = {
    sessionManager,
    hasUI: opts.hasUI ?? true,
    ui: {
      notify(message: string, type?: string) {
        notifyCalls.push({ message, type });
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, notifyCalls };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Invoke the tool's execute with a minimal call signature (params + the fakes). toolCallId defaults to "call-1". */
async function run(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: ShrinkArgs,
  toolCallId = "call-1",
): Promise<AgentToolResult<ShrinkDetails>> {
  const tool = makeShrinkTool(pi);
  // execute signature: (toolCallId, params, signal, onUpdate, ctx)
  return tool.execute(toolCallId, params, undefined, undefined, ctx);
}

// The exact host validation pipeline (pi-ai validateToolArguments): structuredClone →
// prepareArguments (when present) → Value.Convert → compiled Check. Returns Check's boolean.
// (Copied from test/prepare-args.test.ts — C13: host validates BEFORE execute; schema-level arm removal.)
function hostPipelinePasses(
  params: Parameters<typeof Value.Convert>[0],
  args: unknown,
  prepareArguments?: ((raw: unknown) => unknown) | undefined,
): boolean {
  let prepared = structuredClone(args) as Record<string, unknown>;
  if (typeof prepareArguments === "function") {
    prepared = prepareArguments(prepared) as Record<string, unknown>;
  }
  Value.Convert(params as never, prepared as never);
  return Compile(params as never).Check(prepared as never);
}

/**
 * Extract the text from a result's first content block. This tool ONLY ever returns TextContent (never
 * ImageContent), but `content` is typed `(TextContent | ImageContent)[]` so we narrow with a runtime guard
 * before reading `.text` (checkpoint.test.ts / rewind.test.ts precedent).
 */
function firstText(res: AgentToolResult<ShrinkDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/**
 * A single message-as-entry in the snapshot (buildContextEntries returns SessionEntry[]; we cast through
 * `as unknown as SessionEntry`). The tool flattens via the REAL sessionEntryToContextMessages, which returns
 * [entry.message] for a `{type:"message", message:{...}}` entry (verified Pi shape — GOTCHA #12). We build
 * the entry by spreading the role + extra fields (toolCallId/toolName/content) into `message`.
 */
let entrySeq = 0;
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

// ── registration metadata (spec/05 §5: name/label/description/parameters) ────

describe("mulligan_shrink — registration metadata (spec/05 §5)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("name === 'mulligan_shrink', label === 'Mulligan Shrink', description === SHRINK_DESC verbatim", () => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    expect(tool.name).toBe("mulligan_shrink");
    expect(tool.label).toBe("Mulligan Shrink");
    expect(tool.description).toBe(SHRINK_DESC);
  });

  it("description is the v2.0 current-turn string (PRD §2 purpose wording)", () => {
    expect(SHRINK_DESC).toBe(
      "Replace the current turn's tool result with a compact summary you provide, in your view, going forward. " +
        "Use when the call was fine but its output is too big to keep carrying. Only results from THIS turn can be " +
        "shrunk — a target from an earlier turn is refused outright. Unlike rewind, the call stays in context " +
        "(just with your summary as its result).",
    );
    expect(SHRINK_DESC).toContain("current turn");
  });

  it("parameters === ShrinkParams (the typebox schema)", () => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    expect(tool.parameters).toBe(ShrinkParams);
  });
});

// ── config-disabled refusal (spec/05 §2 step 1; spec/08 E14) ────────────────

describe("mulligan_shrink — config-disabled refusal (spec/05 §2 step1; E14)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: false }, rewrites: { flushShedTokens: 0 } }));

  it("refuses with 'shrink is disabled' and does NOT call appendShrinkMarker", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, {
      target: { by_tool_call_id: "call-A" },
      replacement: "(shrink) too big",
    });
    expect(appended).toHaveLength(0); // NO persistence on refusal
    expect(firstText(res)).toBe("Mulligan: refused — shrink is disabled.");
    expect(res.details).toEqual({}); // GOTCHA #4: details present ({}) on refusal
  });

  it("refuses BEFORE attempting the best-effort match (disabled short-circuits step 1)", async () => {
    // Even a throwing buildContextEntries must not block the disabled-refusal (it never reaches the match).
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true });
    await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(appended).toHaveLength(0);
  });
});

// ── empty-replacement refusal (spec/05 §2 step 2) ───────────────────────────

describe("mulligan_shrink — empty-replacement refusal (spec/05 §2 step2)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it.each([
    ["empty string", ""],
    ["whitespace-only '   '", "   "],
    ["whitespace-only '\\t\\n'", "\t\n"],
  ])("refuses on %s replacement with 'replacement must be non-empty'; no persistence", async (_label, replacement) => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
    expect(appended).toHaveLength(0);
    expect(firstText(res)).toBe("Mulligan: refused — replacement must be non-empty.");
    expect(res.details).toEqual({});
  });
});

// ── structurally-impossible-target refusal (spec/05 §2 step 3; GOTCHA #7) ───

describe("mulligan_shrink — structurally-impossible-target refusal (spec/05 §2 step3; GOTCHA #7)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it.each([
    ["by_tool_call_id empty", { by_tool_call_id: "" }],
    ["by_tool_call_id whitespace", { by_tool_call_id: "   " }],
    ["by_tool_name empty", { by_tool_name: "", occurrence: "last" as const }],
    ["by_tool_name whitespace", { by_tool_name: "  ", occurrence: "first" as const }],
  ])("refuses on %s with 'target discriminator must be non-empty'; no persistence", async (_label, target) => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target, replacement: "(shrink) summary" });
    expect(appended).toHaveLength(0);
    expect(firstText(res)).toBe("Mulligan: refused — target discriminator must be non-empty.");
    expect(res.details).toEqual({});
  });

  it("a NON-empty discriminator passes the structural check — but v2.0: no IN-TURN match (empty snapshot) → hard refusal, no persistence", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [] }); // empty span → no in-turn match
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(appended).toHaveLength(0); // v2.0 §2 step 3: dead markers are refused at creation
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
  });
});

// ── best-effort match: YES for EACH matcher + persistence payload (spec/05 §2 step 3/4/5; spec/04 §4) ────

describe("mulligan_shrink — best-effort match YES (matched:yes per matcher) + persistence payload", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("by_tool_call_id: matched:yes; persists the marker with {target, replacement} stamped with envelope+id+seq+ts", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      leafId: "leaf-9",
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log..."))],
    });
    const target = { by_tool_call_id: "call-A" };
    const replacement = "(shrink) the big log was ~9k tokens; the bug is on line 42.";
    const res = await run(pi, ctx, { target, replacement });

    // feedback text (spec/05 §2) with the yes slot filled, ENDING with the v1.2 orientation line (exact, k=1,
    // ~<t> = NET shed via the same estimator — see the v1.2 describe block below)
    expect(firstText(res)).toBe(
      `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedShed("big log...", replacement))}`,
    );
    expect(res.details).toEqual({ matched: true, markerId: "leaf-9" });

    // persistence payload (spec/04 §4; appendShrinkMarker stamps envelope + id + seq + ts over the caller payload)
    expect(appended).toHaveLength(1);
    expect(appended[0].customType).toBe("mulligan:shrink");
    const entry = appended[0].data as Record<string, unknown>;
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("shrink");
    expect(entry.target).toEqual(target);
    expect(entry.replacement).toBe(replacement);
    expect(entry.reason).toBeUndefined(); // no reason passed
    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); // uuid
    expect(typeof entry.seq).toBe("number");
    expect(entry.seq).toBe(1); // first marker this session
    expect(typeof entry.ts).toBe("number");
    expect(entry.ts).toBeLessThanOrEqual(Date.now());
  });

  it("by_tool_name+occurrence:last → matched:yes (the LAST read); occurrence:first → matched:yes (the FIRST read)", async () => {
    const entries = [
      msgEntry("toolResult", toolResult("call-1", "read", "first read output")),
      msgEntry("toolResult", toolResult("call-2", "read", "second read output")),
    ];

    // occurrence:last (default) → matched:yes (exact-index resolution is resolveShrinkTarget's tested concern)
    {
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: entries });
      const res = await run(pi, ctx, {
        target: { by_tool_name: "read", occurrence: "last" },
        replacement: "summary",
      });
      expect(firstText(res)).toContain("Matched: yes");
      expect(res.details).toEqual({ matched: true, markerId: "leaf-1" });
      expect(appended[0].data).toMatchObject({ target: { by_tool_name: "read", occurrence: "last" } });
    }
    // occurrence:first → matched:yes
    {
      const { pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: entries });
      const res = await run(pi, ctx, {
        target: { by_tool_name: "read", occurrence: "first" },
        replacement: "summary",
      });
      expect(firstText(res)).toContain("Matched: yes");
      expect(res.details).toEqual({ matched: true, markerId: "leaf-1" });
    }
  });

  it("FINDING 3: matched → marker.pinnedEntryId === the matched ENTRY id (pinned shrink), per matcher", async () => {
    // [v1.2] this test creates FOUR markers in ONE session (one per matcher block) — raise the
    // per-session rewrite cap so all four persist immediately (the cap itself is unit-tested in
    // test/rewrite-budget.test.ts).
    setConfig({ rewrites: { flushShedTokens: 0 } });
    // by_tool_call_id → the single matched entry
    {
      const e = msgEntry("toolResult", toolResult("call-A", "read", "x"));
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: [e] });
      await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "s" });
      expect((appended[0].data as Record<string, unknown>).pinnedEntryId).toBe((e as { id: string }).id);
    }
    // by_tool_name occurrence:last → the LAST matching entry (the live selector's match is what gets PINNED)
    {
      const e1 = msgEntry("toolResult", toolResult("c1", "read", "first"));
      const e2 = msgEntry("toolResult", toolResult("c2", "read", "second"));
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: [e1, e2] });
      await run(pi, ctx, { target: { by_tool_name: "read", occurrence: "last" }, replacement: "s" });
      expect((appended[0].data as Record<string, unknown>).pinnedEntryId).toBe((e2 as { id: string }).id); // LAST
    }
    // by_tool_name occurrence:first → the FIRST matching entry
    {
      const e1 = msgEntry("toolResult", toolResult("c1", "read", "first"));
      const e2 = msgEntry("toolResult", toolResult("c2", "read", "second"));
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: [e1, e2] });
      await run(pi, ctx, { target: { by_tool_name: "read", occurrence: "first" }, replacement: "s" });
      expect((appended[0].data as Record<string, unknown>).pinnedEntryId).toBe((e1 as { id: string }).id); // FIRST
    }
  });

  it("reason persisted when provided; absent when not", async () => {
    const target = { by_tool_call_id: "call-A" };
    const baseEntries = [msgEntry("toolResult", toolResult("call-A", "read", "x"))];

    // WITH reason
    {
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: baseEntries });
      await run(pi, ctx, { target, replacement: "x", reason: "too big" });
      expect((appended[0].data as Record<string, unknown>).reason).toBe("too big");
    }
    // WITHOUT reason
    {
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ contextEntries: baseEntries });
      await run(pi, ctx, { target, replacement: "x" });
      expect((appended[0].data as Record<string, unknown>).reason).toBeUndefined();
    }
  });

  it("markerId in details === getLeafId(); null when leafId null (still success)", async () => {
    const baseEntries = [msgEntry("toolResult", toolResult("call-A", "read", "x"))];
    const target = { by_tool_call_id: "call-A" };

    // scripted leaf → markerId echoes it
    {
      const { pi } = makePi();
      const { ctx } = makeCtx({ leafId: "leaf-42", contextEntries: baseEntries });
      const res = await run(pi, ctx, { target, replacement: "x" });
      expect(res.details).toEqual({ matched: true, markerId: "leaf-42" });
    }
    // null leaf (appendShrinkMarker returns null) → markerId null, STILL success
    {
      const { appended, pi } = makePi();
      const { ctx } = makeCtx({ leafId: null, contextEntries: baseEntries });
      const res = await run(pi, ctx, { target, replacement: "x" });
      expect(appended).toHaveLength(1); // the marker WAS appended; we just can't report its id
      expect(res.details).toEqual({ matched: true, markerId: null });
      expect(firstText(res)).toContain("Matched: yes");
    }
  });
});

// ── v2.0 no-in-turn-match hard refusal + best-effort failure (spec/05 §2 step3; spec/08 E8/E13) ────────

describe("mulligan_shrink — v2.0 no-in-turn-match hard refusal + best-effort failure (E8/E13)", () => {
  // [r1v2 merged] flushShedTokens 0 = flush every op immediately: keeps these single-op v2.0
  // refusal/persistence tests on the IMMEDIATE path (never queued) under the moment-cap budget.
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("v2.0: by_tool_call_id with no IN-TURN match → HARD REFUSAL (exact text), nothing persisted", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))],
    });
    const res = await run(pi, ctx, {
      target: { by_tool_call_id: "does-not-exist" }, // non-empty → structurally valid; no in-turn match
      replacement: "summary",
    });
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
    expect(firstText(res)).not.toContain("Context updated:"); // refusals never carry the orientation line
    expect(res.details).toEqual({});
    expect(appended).toHaveLength(0); // v2.0: a dead marker is refused at creation — nothing persisted
  });

  it("v2.0: target matching only an EARLIER turn (toolResult BEFORE the last user message) → the SAME hard refusal", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [
        msgEntry("toolResult", toolResult("call-A", "read", "x")),
        msgEntry("user", { content: "next turn" }),
      ],
    });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "summary" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
    expect(appended).toHaveLength(0);
  });

  it("best-effort failure (throwing buildContextEntries) → matched:false + STILL success + STILL persists (E13)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true }); // snapshot blows up
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "summary" });
    expect(firstText(res)).toContain("Matched: no"); // match try/catch → false
    expect(res.details).toEqual({ matched: false, markerId: "leaf-1" });
    expect(appended).toHaveLength(1); // a throwing match NEVER blocks persistence (E13 — never block)
  });
});

// ── never-throws (shared tool convention; GOTCHA #5/E13) ─────────────────────

describe("mulligan_shrink — never throws (spec/05 shared tool convention; GOTCHA #5/E13)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("a throwing getSessionId (inside appendShrinkMarker → returns null) → tool STILL succeeds with markerId:null", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))],
      throwOnGetSessionId: true, // appendShrinkMarker swallows → null
    });
    await expect(run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" })).resolves.toBeDefined();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(appended).toHaveLength(0); // appendShrinkMarker threw BEFORE appendEntry → nothing appended
    expect(res.details).toEqual({ matched: true, markerId: null }); // still success, markerId null
    expect(firstText(res)).toContain("Matched: yes");
  });

  it("a throwing getLeafId → appendShrinkMarker returns null → tool STILL succeeds (markerId:null)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))],
      throwOnGetLeafId: true,
    });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(appended).toHaveLength(1); // the marker WAS appended; the leaf capture threw → null return
    expect(res.details).toEqual({ matched: true, markerId: null });
  });

  it("a throwing appendEntry → appendShrinkMarker returns null → tool STILL succeeds (markerId:null)", async () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))],
    });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(res.details).toEqual({ matched: true, markerId: null });
    expect(firstText(res)).toContain("Matched: yes");
  });

  it("malformed params (target undefined) → structural-validity refusal (no throw)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    // params.target undefined → targetIsStructurallyValid returns false → refusal; never throws.
    await expect(
      run(pi, ctx, { target: undefined as unknown as ShrinkArgs["target"], replacement: "x" }),
    ).resolves.toBeDefined();
    const res = await run(pi, ctx, {
      target: undefined as unknown as ShrinkArgs["target"],
      replacement: "x",
    });
    expect(appended).toHaveLength(0);
    expect(firstText(res)).toBe("Mulligan: refused — target discriminator must be non-empty.");
  });

  it("execute resolves to a text result on EVERY path (never rejects)", async () => {
    const { pi } = makePi();
    // refusal path
    await expect(
      run(pi, makeCtx().ctx, { target: { by_tool_call_id: "x" }, replacement: "" }),
    ).resolves.toBeDefined();
    // success path
    await expect(
      run(pi, makeCtx().ctx, { target: { by_tool_call_id: "x" }, replacement: "y" }),
    ).resolves.toBeDefined();
  });
});

// ── result shape (incl. `details` on EVERY path — CRITICAL GOTCHA #4) ────────

describe("mulligan_shrink — result shape (CRITICAL GOTCHA #4: `details` REQUIRED on every path)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("success: content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))] });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "x" });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
  });

  it("refusal (disabled): content is [{type:'text', text:string}] AND details present", async () => {
    setConfig({ shrink: { enabled: false }, rewrites: { flushShedTokens: 0 } });
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "x" }, replacement: "y" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
  });

  it("refusal (empty replacement): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "x" }, replacement: "" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });

  it("refusal (structurally impossible target): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "" }, replacement: "y" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });

  it("best-effort failure path: content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "x" }, replacement: "y" });
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });
});

// ── types (ToolDefinition + ShrinkParams inference) ──────────────────────────

describe("mulligan_shrink — types (ToolDefinition + ShrinkParams inference)", () => {
  it("makeShrinkTool(...) is a ToolDefinition<typeof ShrinkParams, ShrinkDetails>", () => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    // The factory's declared return type is exactly the parameterized ToolDefinition.
    expectTypeOf(tool).toEqualTypeOf<ToolDefinition<typeof ShrinkParams, ShrinkDetails>>();
    // narrower: the params schema is exactly ShrinkParams.
    expectTypeOf(tool.parameters).toEqualTypeOf(ShrinkParams);
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });

  it("ShrinkArgs (Static<typeof ShrinkParams>) is the { target; replacement; reason? } shape", () => {
    const args = {} as ShrinkArgs;
    expectTypeOf(args.target).toEqualTypeOf<
      { by_tool_call_id: string } | { by_tool_name: string; occurrence: "last" | "first" }
    >();
    expectTypeOf(args.replacement).toEqualTypeOf<string>();
    expectTypeOf(args.reason).toEqualTypeOf<string | undefined>();
    // (f) the removed v2.0 content-substring arm is not assignable to the target union —
    //     compile-time lock lives in test/markers.test.ts (not.toMatchTypeOf idiom).
  });

  it("execute returns AgentToolResult<ShrinkDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, { target: { by_tool_call_id: "x" }, replacement: "y" });
    expectTypeOf(res).toEqualTypeOf<AgentToolResult<ShrinkDetails>>();
  });
});

// ── operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5) ─────────────────────
// P1.M2.T1.S3: locks the S2 contract — terse result never echoes the replacement, and the
// replacement reaches the HUMAN via ctx.ui.notify (zero-context-cost) iff ctx.hasUI, capped at
// config.shrink.notifyMaxChars (default 2048).
// ── v2.0 current-turn scoping lock (R2 — P1.M2.T2.S1 cases a–d) ─────────────

describe("mulligan_shrink — v2.0 current-turn scoping (R2 lock)", () => {
  // [r1v2 merged] flushShedTokens 0 keeps these scoping tests on the IMMEDIATE path (no queueing).
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  // (a) a toolResult that lives ONLY before the last user message → HARD refusal, exact text, zero persistence
  it("(a) by_tool_call_id matching only an EARLIER turn → exact hard refusal; nothing persisted", async () => {
    const { appended, pi } = makePi();
    const e = msgEntry("toolResult", toolResult("call-A", "read", "big output"));
    const u0 = msgEntry("user", { content: "u0" });
    const u1 = msgEntry("user", { content: "u1" });
    const { ctx } = makeCtx({ contextEntries: [u0, e, u1] });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "s" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({});
  });

  // (b) by_tool_name: earlier-turn-only match AND a no-match-anywhere variant — same refusal
  it.each([
    ["earlier-turn-only match", { by_tool_name: "read", occurrence: "last" as const }, "call-A"],
    ["no match anywhere", { by_tool_name: "read", occurrence: "last" as const }, "call-ZZZ"],
  ])("(b) %s → exact hard refusal; nothing persisted", async (_label, target, toolCallId) => {
    const { appended, pi } = makePi();
    const u0 = msgEntry("user", { content: "u0" });
    const e = msgEntry("toolResult", toolResult(toolCallId, "read", "big output"));
    const u1 = msgEntry("user", { content: "u1" });
    const { ctx } = makeCtx({ contextEntries: [u0, e, u1] });
    const res = await run(pi, ctx, { target, replacement: "s" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
    expect(appended).toHaveLength(0);
    expect(res.details).toEqual({});
  });

  it("(b') no-match-anywhere by_tool_call_id → the same hard refusal", async () => {
    const { appended, pi } = makePi();
    const u0 = msgEntry("user", { content: "u0" });
    const { ctx } = makeCtx({ contextEntries: [u0] }); // no toolResult anywhere
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-ZZZ" }, replacement: "s" });
    expect(firstText(res)).toBe(
      "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.",
    );
    expect(appended).toHaveLength(0);
  });

  // (c) in-span success + pin + payload snapshot
  it("(c) by_tool_call_id matching a toolResult AFTER the last user message → matched:yes + orientation line + pinnedEntryId + exact payload envelope", async () => {
    const { appended, pi } = makePi();
    const origText = "big output";
    const replacement = "(shrink) summarized";
    const u0 = msgEntry("user", { content: "u0" });
    const e = msgEntry("toolResult", toolResult("call-A", "read", origText));
    const { ctx } = makeCtx({ leafId: "leaf-9", contextEntries: [u0, e] }); // e AFTER the user → in-span
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
    expect(firstText(res)).toBe(
      `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedShed(origText, replacement))}`,
    );
    expect(appended).toHaveLength(1);
    const entry = appended[0].data as Record<string, unknown>;
    expect(appended[0].customType).toBe("mulligan:shrink");
    expect(entry.schema).toBe("pi-mulligan");
    expect(entry.v).toBe(1);
    expect(entry.kind).toBe("shrink");
    expect(entry.target).toEqual({ by_tool_call_id: "call-A" });
    expect(entry.replacement).toBe(replacement);
    expect(entry.reason).toBeUndefined();
    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(entry.seq).toBe(1);
    expect(typeof entry.ts).toBe("number");
    expect(entry.pinnedEntryId).toBe((e as { id: string }).id); // pinned to the matched ENTRY
  });

  // (d) advisory throw → persists with the ~0 orientation line (v1.2 behavior, unchanged)
  it("(d) throwing buildContextEntries → matched:no persisted with shrinkOrientationLine(1, 0)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "s" });
    expect(appended).toHaveLength(1);
    expect(firstText(res)).toContain("Matched: no");
    expect(firstText(res)).toBe(`Mulligan: shrink recorded. Matched: no.\n${shrinkOrientationLine(1, 0)}`);
  });
});

// ── schema (typebox) rejects the removed content arm (C13) — case (e) ────────

describe("mulligan_shrink — schema (typebox) rejects the removed content arm (C13)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true } }));

  const REMOVED_ARM = ["by_content", "_includes"].join("_"); // the arm v2.0 deleted from the union

  it("a target using the REMOVED content-substring arm fails host validation — execute never runs", () => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    expect(
      hostPipelinePasses(
        ShrinkParams,
        { target: { [REMOVED_ARM]: "x" }, replacement: "r" },
        tool.prepareArguments,
      ),
    ).toBe(false);
  });

  it.each([
    { by_tool_call_id: "call-A" },
    { by_tool_name: "read", occurrence: "last" as const },
  ])("proper 2-arm target %o passes host validation", (target) => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    expect(hostPipelinePasses(ShrinkParams, { target, replacement: "r" }, tool.prepareArguments)).toBe(true);
  });
});

describe("operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5)", () => {
  // [r1v2 merged] flushShedTokens 0 keeps these on the IMMEDIATE path (no queueing).
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));
  // shared matched:yes setup — clone of the by_tool_call_id matched case (see L279-289).
  // hasUI defaults to true (matches ctx.hasUI in TUI/RPC modes).
  const matchedYes = ({ hasUI = true }: { hasUI?: boolean } = {}) => {
    const { appended, pi } = makePi();
    const { ctx, notifyCalls } = makeCtx({
      leafId: "leaf-9",
      hasUI,
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log..."))],
    });
    const target = { by_tool_call_id: "call-A" };
    return { appended, pi, ctx, notifyCalls, target };
  };

  it("(a) success result text is the terse form and does NOT echo the replacement", async () => {
    const { pi, ctx, target } = matchedYes();
    const replacement = "COMPACT-9f2a only keep the summary"; // distinctive; must NOT appear in the result
    const res = await run(pi, ctx, { target, replacement });
    expect(firstText(res)).toBe(
      `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedShed("big log...", replacement))}`,
    );
    // echoing the replacement into the result would re-bloat context — the tool's whole purpose. Guard it:
    expect(firstText(res)).not.toContain(replacement);
  });

  it("(b) notifies the operator with the replacement when hasUI:true; silent when hasUI:false", async () => {
    const replacement = "the bug is on line 42";

    // hasUI:true → the replacement reaches the human at zero context cost (spec/05 §2 step 5)
    {
      const { pi, ctx, notifyCalls } = matchedYes({ hasUI: true });
      const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
      expect(firstText(res)).toBe(
        `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedShed("big log...", replacement))}`,
      );
      expect(notifyCalls).toHaveLength(1);
      expect(notifyCalls[0].message).toContain(replacement); // replacement is in the toast
      expect(notifyCalls[0].type).toBe("info");
    }

    // hasUI:false → no user to show; notify is a no-op (print/JSON mode)
    {
      const { pi, ctx, notifyCalls } = matchedYes({ hasUI: false });
      const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
      expect(firstText(res)).toBe(
        `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedShed("big log...", replacement))}`,
      );
      expect(notifyCalls).toHaveLength(0);
    }
  });

  it("(c) notify text is capped at notifyMaxChars (default 2048): replacement>2048 → '…(<N> chars total)'", async () => {
    const replacement = "X".repeat(3000); // > default 2048 → capped in the toast
    const { pi, ctx, notifyCalls } = matchedYes({ hasUI: true });
    await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
    expect(notifyCalls).toHaveLength(1);
    // cap suffix present — U+2026 ellipsis "…", NOT three dots (see Known Gotchas)
    expect(notifyCalls[0].message).toContain(`…(${replacement.length} chars total)`);
    // the FULL uncapped replacement is NOT in the toast (it was actually truncated to 2048 chars):
    expect(notifyCalls[0].message).not.toContain(replacement);
  });
});

// ── v1.2 re-orientation guard: the FIXED final line on every ACTIVE-activation path (bench-stable) ────────────

/**
 * Mirror of the tool's v1.2 NET-shed arithmetic (shrink.ts): max(0, estimateTokens(original) - estimateTokens(replacement)).
 * The toolResult fixture's content is ONE text block, and messageCharLength counts content ONLY (role/toolCallId/
 * toolName contribute nothing), so a bare {content:[{type:"text",text}]} estimates identically. Using the SAME
 * estimateTokens keeps the expected numbers deterministic without re-implementing the heuristic.
 */
function expectedShed(origText: string, replacement: string): number {
  const orig = estimateTokens([{ content: [{ type: "text", text: origText }] }]).tokens;
  const repl = estimateTokens([{ content: replacement }]).tokens;
  return Math.max(0, orig - repl);
}

describe("mulligan_shrink — v1.2 orientation line (fixed final line on ACTIVE activation; guard)", () => {
  beforeEach(() => setConfig({ shrink: { enabled: true }, rewrites: { flushShedTokens: 0 } }));

  it("shrinkOrientationLine: EXACT bench-stable text — single (k=1) AND aggregate (k>1) forms", () => {
    // single form (every shrink activation today). Literal-string assertion: this line is the contract.
    expect(shrinkOrientationLine(1, 42)).toBe(
      "Context updated: 1 result(s) summarized (~42 tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.",
    );
    // aggregate form — the BATCHED/FLUSH seam (reserved for future work): the flush result carries the
    // SAME line ONCE with aggregate numbers. Locked here so the flush cannot drift to a variant.
    expect(shrinkOrientationLine(3, 1250)).toBe(
      "Context updated: 3 result(s) summarized (~1250 tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.",
    );
  });

  it("single ACTIVE activation (matched:yes, persisted): the line is the FINAL line with NET ~<t> (orig minus replacement)", async () => {
    const { pi } = makePi();
    const origText = "X".repeat(4000); // 4000 chars / 4 = 1000 tokens
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", origText))],
    });
    const replacement = "compact"; // ceil(7/4) = 2 tokens → NET 998
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
    expect(expectedShed(origText, replacement)).toBe(998); // pin the arithmetic
    expect(firstText(res)).toBe(
      `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, 998)}`,
    );
    // the line ENDS the tool result (the resumed model's last-read cue) — full-equality above already proves it;
    // endsWith makes the intent explicit for future edits:
    expect(firstText(res).endsWith(shrinkOrientationLine(1, 998))).toBe(true);
  });

  it("v2.0: the throwing-snapshot path (E13) persists matched:false → line present with ~0 (the filter's scope guard makes an unverifiable marker safe)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true }); // snapshot throws → E13 carve-out
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "compact" });
    expect(appended).toHaveLength(1); // persisted → ACTIVE
    expect(firstText(res)).toBe(
      `Mulligan: shrink recorded. Matched: no.\n${shrinkOrientationLine(1, 0)}`,
    );
  });

  it("refusals keep their OWN honest text — NO orientation line (nothing was activated)", async () => {
    const mk = () => {
      const { pi } = makePi();
      const { ctx } = makeCtx();
      return { pi, ctx };
    };

    // (a) master disabled (E14)
    {
      setConfig({ enabled: false });
      const { pi, ctx } = mk();
      const res = await run(pi, ctx, { target: { by_tool_call_id: "c1" }, replacement: "X" });
      expect(firstText(res)).toMatch(/^Mulligan: refused — Mulligan is disabled\.$/);
      expect(firstText(res)).not.toContain("Context updated:");
    }
    // (b) shrink sub-feature disabled (E14)
    {
      setConfig({ shrink: { enabled: false }, rewrites: { flushShedTokens: 0 } });
      const { pi, ctx } = mk();
      const res = await run(pi, ctx, { target: { by_tool_call_id: "c1" }, replacement: "X" });
      expect(firstText(res)).toMatch(/^Mulligan: refused — shrink is disabled\.$/);
      expect(firstText(res)).not.toContain("Context updated:");
    }
    // (c) empty replacement (spec/05 §2 step 2) — re-enable first: setConfig MERGES, so (b)'s disabled
    //     sub-feature would otherwise leak into this sub-block
    {
      setConfig({ enabled: true, shrink: { enabled: true } });
      const { pi, ctx } = mk();
      const res = await run(pi, ctx, { target: { by_tool_call_id: "c1" }, replacement: "   " });
      expect(firstText(res)).toMatch(/^Mulligan: refused — replacement must be non-empty\.$/);
      expect(firstText(res)).not.toContain("Context updated:");
    }
    // (d) structurally-impossible target (GOTCHA #7)
    {
      setConfig({ enabled: true, shrink: { enabled: true } });
      const { pi, ctx } = mk();
      const res = await run(pi, ctx, { target: { by_tool_call_id: "  " }, replacement: "X" });
      expect(firstText(res)).toMatch(/^Mulligan: refused — target discriminator must be non-empty\.$/);
      expect(firstText(res)).not.toContain("Context updated:");
    }
  });

  it("append FAILED (markerId null → NO active marker) → terse text only, NO line ('Context updated' must not lie)", async () => {
    const { pi } = makePi({ throwOnAppend: true });
    const { ctx } = makeCtx({ contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log..."))] });
    const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "compact" });
    expect(firstText(res)).toBe("Mulligan: shrink recorded. Matched: yes."); // pre-existing terse form, unchanged
    expect(firstText(res)).not.toContain("Context updated:");
    expect(res.details.matched).toBe(true);
    expect(res.details.markerId).toBeNull(); // the honest signal that nothing persisted
  });
});