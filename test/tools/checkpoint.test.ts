/**
 * checkpoint.test.ts — unit tests for the `mulligan_checkpoint` tool (src/tools/checkpoint.ts).
 *
 * Mirrors the house test idiom from test/markers.test.ts: vitest, hand-rolled `makePi()`/`makeCtx()`
 * fakes (no vi.fn()), `.js` import paths, `expectTypeOf` for type assertions, `clearAll()` runtime reset.
 * Reuses the SAME `makePi` (captures setLabel via `labels`) shape; `makeCtx` scripts `getBranch()`
 * (BUG-003 fix: setCheckpoint walks the branch to the last real message, NOT getLeafId).
 *
 * Coverage (the PRP Task 2 case list):
 *   a) success text VERBATIM (spec/05 §3) + setLabel called once with the prefixed name.
 *   b) regex accept boundaries: "a", "a-b_c1", a 40-char name → success.
 *   c) regex reject: "" (empty), "With Space", "UPPER", "dot.dot", "name!", a 41-char name → refusal; setLabel NOT called.
 *   d) no-stable-entry: empty branch → {error:"no conversation message to checkpoint"} → refusal; setLabel NOT called.
 *   e) never-throws: a throwing setLabel (setCheckpoint swallows it → {error}) → still a text result, execute does not throw.
 *   f) result shape: content is [{type:"text",text:string}] AND `details` is present on every path.
 *   g) types: makeCheckpointTool(...) ToMatchTypeOf<ToolDefinition>; params inferred as {name:string}; description === CKPT_DESC.
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  makeCheckpointTool,
  CheckpointParams,
  CKPT_DESC,
  validCheckpointName,
  type CheckpointArgs,
  type CheckpointDetails,
} from "../../src/tools/checkpoint.js";
import { clearAll } from "../../src/runtime.js";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// GOTCHA #8 (shared with markers.test.ts): nextSeq mutates the SHARED module-scoped runtime map. clearAll()
// before AND after each test so a previous test's seq can't leak in. (setCheckpoint itself doesn't use
// nextSeq, but we keep the house reset for hygiene and to mirror the sibling test exactly.)
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes (reproduced from test/markers.test.ts, trimmed to the setLabel/getBranch surface) ─────

/**
 * A minimal fake ExtensionAPI capturing setLabel calls (hand-rolled, no vi.fn() — house pattern).
 * Set `throwOnSetLabel` to simulate a Pi setLabel failure.
 */
function makePi(opts: { throwOnSetLabel?: boolean } = {}) {
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { labels, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionContext. Scripts getBranch() for setCheckpoint (BUG-003 fix): default branch ends in a
 * stable message whose id == "leaf-1", so tests using the default still anchor on "leaf-1"; pass an explicit
 * `branch` (ROOT→LEAF) to exercise other paths (e.g. [] → no stable message → no-stable-entry). setCheckpoint no
 * longer reads getLeafId, so the fake need not provide it.
 */
function makeCtx(opts: { branch?: unknown[]; throwOnGetBranch?: boolean } = {}) {
  const branch = opts.branch ?? [
    { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
    { type: "message", id: "leaf-1", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
  ];
  const sessionManager = {
    getBranch() {
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return branch;
    },
  };
  return { ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Invoke the tool's execute with a minimal call signature (the params object + the fakes). */
async function run(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): Promise<AgentToolResult<CheckpointDetails>> {
  const tool = makeCheckpointTool(pi);
  // execute signature: (toolCallId, params, signal, onUpdate, ctx)
  return tool.execute("call-1", { name }, undefined, undefined, ctx);
}

/**
 * Extract the text from a result's first content block. This tool ONLY ever returns TextContent (never
 * ImageContent), but `content` is typed `(TextContent | ImageContent)[]` so we narrow with a runtime guard
 * before reading `.text`. Asserting `type === "text"` first keeps the access type-safe AND documents intent.
 */
function firstText(res: AgentToolResult<CheckpointDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/** The VERBATIM success text (spec/05 §3) — single source of truth for the assertion. */
function successText(name: string, entryId: string): string {
  return (
    `Mulligan: checkpoint '${name}' set at entry ${entryId}. ` +
    `Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'${name}').`
  );
}

/**
 * A ROOT→LEAF branch (matching getBranch() / T1's contract) ending in a stable message whose id == leafMsgId,
 * so setCheckpoint anchors on leafMsgId. Keeps existing success assertions valid with ZERO value churn.
 */
function branchEndingInMsg(leafMsgId: string): unknown[] {
  return [
    { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
    { type: "message", id: leafMsgId, parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
  ];
}

const FORTY = "a".repeat(40); // boundary-valid (exactly 40 chars)
const FORTY_ONE = "a".repeat(41); // boundary-invalid (41 chars)

// ── registration metadata (spec/05 §5: name/label/description) ───────────────

describe("mulligan_checkpoint — registration metadata (spec/05 §5)", () => {
  it("name === 'mulligan_checkpoint', label === 'Mulligan Checkpoint', description === CKPT_DESC verbatim", () => {
    const { pi } = makePi();
    const tool = makeCheckpointTool(pi);
    expect(tool.name).toBe("mulligan_checkpoint");
    expect(tool.label).toBe("Mulligan Checkpoint");
    expect(tool.description).toBe(CKPT_DESC);
  });

  it("description is the spec/05 §5 verbatim string", () => {
    expect(CKPT_DESC).toBe(
      "Name the current position so a later mulligan_rewind can jump straight back to it. " +
        "Use before a speculative sub-task you might want to undo in one shot.",
    );
  });

  it("parameters === CheckpointParams (Type.Object({ name: Type.String({...}) }))", () => {
    const { pi } = makePi();
    const tool = makeCheckpointTool(pi);
    expect(tool.parameters).toBe(CheckpointParams);
  });
});

// ── success path (spec/05 §3) ───────────────────────────────────────────────

describe("mulligan_checkpoint — success path (spec/05 §3)", () => {
  it("labels the leaf once with 'mulligan:checkpoint:<name>' and returns the verbatim success text", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("leaf-9") });
    const res = await run(pi, ctx, "before-refactor");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ entryId: "leaf-9", label: "mulligan:checkpoint:before-refactor" });
    expect(res.content).toEqual([
      { type: "text", text: successText("before-refactor", "leaf-9") },
    ]);
    // success details carry the name + entryId (audit/debug intent)
    expect(res.details).toEqual({ name: "before-refactor", entryId: "leaf-9" });
  });

  it("echoes the correct entry id for a different leaf", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("leaf-42") });
    const res = await run(pi, ctx, "pre-experiment");
    expect(labels[0].entryId).toBe("leaf-42");
    expect(firstText(res)).toBe(successText("pre-experiment", "leaf-42"));
  });

  it("does NOT call setLabel with a malformed prefix (the wrapper owns the prefix; tool only passes the raw name)", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    await run(pi, ctx, "x_y-z1");
    expect(labels[0].label).toBe("mulligan:checkpoint:x_y-z1");
  });

  it("labels the last real MESSAGE, not a non-message leaf (BUG-003)", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: [
      { type: "message", id: "u1", parentId: null, timestamp: "t", message: { role: "user", content: [], timestamp: 0 } },
      { type: "message", id: "asst-7", parentId: "u1", timestamp: "t", message: { role: "assistant", content: [], timestamp: 0 } },
      { type: "custom", id: "marker-leaf", parentId: "asst-7", timestamp: "t", customType: "mulligan:rewind", data: {} },
    ] });
    const res = await run(pi, ctx, "pre-experiment");
    expect(labels[0].entryId).toBe("asst-7");          // NOT the custom leaf
    expect(firstText(res)).toBe(successText("pre-experiment", "asst-7"));
    expect(res.details).toEqual({ name: "pre-experiment", entryId: "asst-7" });
  });
});

// ── regex accept boundaries ─────────────────────────────────────────────────

describe("mulligan_checkpoint — name regex ACCEPT boundaries (spec/05 §3 step1, spec/04 §6)", () => {
  it.each([
    ["single char 'a'", "a"],
    ["mixed 'a-b_c1'", "a-b_c1"],
    ["40-char name (boundary-valid)", FORTY],
    ["hyphen-only-ish '---'", "---"],
    ["digits '123'", "123"],
  ])("accepts %s → success; setLabel called once", async (_label, name) => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    const res = await run(pi, ctx, name);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toEqual({ entryId: "L", label: `mulligan:checkpoint:${name}` });
    expect(firstText(res)).toBe(successText(name, "L"));
    expect(res.details).toEqual({ name, entryId: "L" });
  });

  it("validCheckpointName() helper agrees with the accept set", () => {
    expect(validCheckpointName("a")).toBe(true);
    expect(validCheckpointName("a-b_c1")).toBe(true);
    expect(validCheckpointName(FORTY)).toBe(true);
  });
});

// ── regex reject (invalid → refusal; setLabel NEVER called — GOTCHA #3) ──────

describe("mulligan_checkpoint — name regex REJECT (invalid → refusal; setLabel NOT called) (spec/05 §3, E10)", () => {
  it.each([
    ["empty string", ""],
    ["contains a space", "With Space"],
    ["uppercase letters", "UPPER"],
    ["contains a dot", "dot.dot"],
    ["contains '!' special char", "name!"],
    ["41-char name (boundary-invalid)", FORTY_ONE],
  ])("rejects %s → refusal text; setLabel NOT called", async (_label, name) => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    const res = await run(pi, ctx, name);
    // refusal: the tool returns text WITHOUT calling setCheckpoint → setLabel is untouched.
    expect(labels).toHaveLength(0);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(firstText(res)).toContain("Mulligan: refused —");
    // the reason names the regex verbatim so the agent understands the constraint
    expect(firstText(res)).toContain("/^[a-z0-9_-]{1,40}$/");
    // the offending name is echoed back in the refusal (helpful for the agent)
    expect(firstText(res)).toContain(name);
    // refusal details carry the (attempted) name for correlation; NO entryId.
    expect(res.details).toEqual({ name });
    expect(res.details).not.toHaveProperty("entryId");
  });

  it("validCheckpointName() helper agrees with the reject set", () => {
    expect(validCheckpointName("")).toBe(false);
    expect(validCheckpointName("With Space")).toBe(false);
    expect(validCheckpointName("UPPER")).toBe(false);
    expect(validCheckpointName("dot.dot")).toBe(false);
    expect(validCheckpointName("name!")).toBe(false);
    expect(validCheckpointName(FORTY_ONE)).toBe(false);
  });

  it("validCheckpointName() is defensive: a non-string refuses (does not throw)", () => {
    // Impossible post-typebox-validation in production, but the guard's `typeof` check keeps it from
    // throwing in a hand-rolled test.
    expect(() => validCheckpointName(undefined as unknown as string)).not.toThrow();
    expect(validCheckpointName(undefined as unknown as string)).toBe(false);
  });
});

// ── no-stable-entry refusal (setCheckpoint returns {error:"no conversation message to checkpoint"}; tool does NOT call getLeafId itself) ──

describe("mulligan_checkpoint — no-stable-entry refusal (setCheckpoint returns {error:'no conversation message to checkpoint'})", () => {
  it("branch with no message → refusal text with actionable guidance; setLabel NOT called", async () => {
    const { labels, pi } = makePi();
    const { ctx } = makeCtx({ branch: [] });   // empty branch → no stable message
    const res = await run(pi, ctx, "before-refactor");
    expect(labels).toHaveLength(0);
    expect(firstText(res)).toContain("Mulligan: refused —");
    expect(firstText(res)).toContain("could not set checkpoint");
    // MINOR-1 fix: the error now tells the agent WHY (no prior conversation) and WHAT TO DO (emit a message first).
    expect(firstText(res)).toContain("no conversation message to checkpoint");
    expect(firstText(res)).toContain("emit a message first");
    expect(res.details).toEqual({ name: "before-refactor" });
  });
});

// ── never-throws (shared tool convention; GOTCHA #5) ─────────────────────────

describe("mulligan_checkpoint — never throws (spec/05 shared tool convention; GOTCHA #5)", () => {
  it("a throwing setLabel → setCheckpoint swallows it ({error}); tool returns refusal text, no throw", async () => {
    const { pi } = makePi({ throwOnSetLabel: true });
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    await expect(run(pi, ctx, "x")).resolves.toBeDefined();
    const res = await run(pi, ctx, "x");
    expect(res.content[0].type).toBe("text");
    expect(firstText(res)).toContain("Mulligan: refused —");
    expect(firstText(res)).toContain("could not set checkpoint");
    expect(res.details).toEqual({ name: "x" });
  });

  it("a throwing getBranch → setCheckpoint swallows it ({error}); tool returns refusal text, no throw", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ throwOnGetBranch: true });
    await expect(run(pi, ctx, "x")).resolves.toBeDefined();
    const res = await run(pi, ctx, "x");
    expect(firstText(res)).toContain("Mulligan: refused —");
  });
});

// ── result shape (incl. `details` on EVERY path — CRITICAL GOTCHA #1) ────────

describe("mulligan_checkpoint — result shape (CRITICAL GOTCHA #1: `details` REQUIRED on every path)", () => {
  it("success: content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    const res = await run(pi, ctx, "ok");
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
  });

  it("refusal (invalid name): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ branch: branchEndingInMsg("L") });
    const res = await run(pi, ctx, "BAD NAME!");
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof firstText(res)).toBe("string");
    expect("details" in res).toBe(true);
  });

  it("refusal (no stable entry): content is [{type:'text', text:string}] AND details present", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ branch: [] });
    const res = await run(pi, ctx, "ok");
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect("details" in res).toBe(true);
  });
});

// ── types ───────────────────────────────────────────────────────────────────

describe("mulligan_checkpoint — types (ToolDefinition + CheckpointParams inference)", () => {
  it("makeCheckpointTool(...) is a ToolDefinition<typeof CheckpointParams, CheckpointDetails>", () => {
    const { pi } = makePi();
    const tool = makeCheckpointTool(pi);
    // The factory's declared return type is exactly the parameterized ToolDefinition.
    expectTypeOf(tool).toEqualTypeOf<
      ToolDefinition<typeof CheckpointParams, CheckpointDetails>
    >();
    // narrower: the params schema is exactly CheckpointParams.
    expectTypeOf(tool.parameters).toEqualTypeOf(CheckpointParams);
    expectTypeOf(tool.name).toEqualTypeOf<string>();
  });

  it("CheckpointArgs (Static<typeof CheckpointParams>) is { name: string }", () => {
    const args = {} as CheckpointArgs;
    expectTypeOf(args).toEqualTypeOf<{ name: string }>();
  });

  it("execute returns AgentToolResult<CheckpointDetails>", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    const res = await run(pi, ctx, "ok");
    expectTypeOf(res).toEqualTypeOf<AgentToolResult<CheckpointDetails>>();
  });
});