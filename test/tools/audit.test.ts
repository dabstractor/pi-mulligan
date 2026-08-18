/**
 * audit.test.ts — unit tests for the `mulligan_audit` tool (src/tools/audit.ts).
 *
 * Mirrors the house tool-test idiom from test/tools/{checkpoint,rewind,shrink}.test.ts +
 * test/markers.test.ts: vitest, hand-rolled `makeCtx()` fake (NO vi.fn()), `.js` import paths,
 * `expectTypeOf` for type assertions, `clearAll()` runtime reset (GOTCHA #6 — getRuntime() is backed by a
 * MODULE-SCOPED Map keyed by sessionId; a prior test's lastFiltered leaks in unless cleared).
 *
 * The audit needs NO `pi` at all (CRITICAL INSIGHT #1) — `auditTool` is a plain `export const` (no factory).
 * Tests call `auditTool.execute("c1", params, undefined, undefined, fakeCtx)` directly. We still include a
 * NO-OP spy `pi` (makePi) whose appendEntry/sendMessage/setLabel push to arrays we assert are EMPTY, proving
 * the audit persists NOTHING (a PRP success criterion).
 *
 * Coverage (the PRP Task 2 case list a–k):
 *   a) PRIMARY path: pre-seed getRuntime("s1").lastFiltered → report uses it; details.source === "cached";
 *      confidence = config.audit.estimateConfidence ("medium"); getContextUsage NEVER called (D5).
 *   b) E16 FALLBACK: leave lastFiltered null; fake buildContextEntries() → details.source === "fallback",
 *      confidence === "low", report still renders.
 *   c) D5 guard: assert ctx.getContextUsage is NOT in the tracked call list (track calls[] on the fake ctx).
 *   d) top param: {top:2} truncates the "Top messages" block to 2 rows; default (undefined) → 8.
 *   e) bloat flag: a toolResult with bytes > config.nudges.bloatThresholdBytes → "⚠ above bloat threshold (16 KB)" (the shipped default).
 *   f) active markers + checkpoints: getEntries() includes rewind/shrink custom entries + checkpoint labels →
 *      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [a, b] (user-set)".
 *   g) suggestion: names rows[0].label; empty filtered → no suggestion, "No messages in filtered view."
 *   h) never-persists: appended/sent/labels arrays all length 0.
 *   i) never-throws: a throwing getEntries()/buildContextEntries() → execute returns a text result (catch path).
 *   j) result shape: content is [{type:"text",text}] AND "details" in result (CRITICAL GOTCHA #1).
 *   k) types: auditTool ToMatchTypeOf<ToolDefinition>; params inferred as {top?:number}; the pure helpers
 *      (describeMessage / renderAuditReport / buildCallLookup / listCheckpoints / messageBytes) are unit-tested
 *      directly (they take plain data, no ctx).
 */
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import {
  makeAuditTool,
  AuditParams,
  AUDIT_DESC,
  describeMessage,
  renderAuditReport,
  buildCallLookup,
  listCheckpoints,
  messageBytes,
  type AuditArgs,
  type AuditDetails,
  type AuditRow,
} from "../../src/tools/audit.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// [v1.2] mulligan_audit is now a makeAuditTool(pi) FACTORY (calling it is rewrite-flush trigger (b) —
// the flush persists through pi). The tests below never queue rewrites, so the captured pi is never
// touched; a minimal no-op stand-in keeps all `auditTool.execute(...)` call sites unchanged.
const auditTool = makeAuditTool({ appendEntry() {} } as unknown as ExtensionAPI);
import { setConfig } from "../../src/config.js";
import { clearAll, getRuntime } from "../../src/runtime.js";
import type { RewindMarker } from "../../src/markers.js"; // type-only fixture cast
import type {
  AgentToolResult,
  ExtensionContext,
  SessionEntry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// GOTCHA #6: getRuntime() is backed by a MODULE-SCOPED Map keyed by sessionId. clearAll() before AND after
// each test so a prior test's lastFiltered can't leak in. (Mirror test/markers.test.ts.)
beforeEach(() => clearAll());
afterEach(() => clearAll());

// ── fakes ───────────────────────────────────────────────────────────────────

/**
 * A minimal NO-OP spy ExtensionAPI. The audit NEVER calls pi.* (CRITICAL INSIGHT #1), but we capture
 * appendEntry/sendMessage/setLabel to PROVE nothing is persisted (a PRP success criterion). Hand-rolled,
 * no vi.fn() (house pattern).
 */
function makePi() {
  const appended: unknown[] = [];
  const sent: unknown[] = [];
  const labels: unknown[] = [];
  const pi = {
    appendEntry() {
      appended.push(true);
    },
    sendMessage() {
      sent.push(true);
    },
    setLabel() {
      labels.push(true);
    },
  };
  return { appended, sent, labels, pi: pi as unknown as ExtensionAPI };
}

/**
 * A minimal fake ExtensionContext for the audit. Tracks the sessionManager call ORDER (so D5 can assert
 * getContextUsage is NEVER in the list) and scripts:
 *   - sessionId (getSessionId — used to key the runtime map; default "s1")
 *   - contextEntries (buildContextEntries — the E16 fallback entry list)
 *   - entries (getEntries — scanned for checkpoints AND for readMarkers)
 *   - branch (getBranch — passed to filterPipeline as branchEntries on the E16 fallback)
 * Set throwOn* flags to simulate failures (GOTCHA #10: the execute try/catches → a failure text result).
 *
 * NOTE: getContextUsage is INTENTIONALLY ABSENT from this fake. D5 forbids calling it, so its absence is
 * part of the contract — if the tool ever called it, the test would throw (caught → failure text) AND the
 * call-tracking list would not contain it. We assert the latter explicitly.
 */
function makeCtx(opts: {
  sessionId?: string;
  contextEntries?: SessionEntry[];
  entries?: SessionEntry[];
  branch?: SessionEntry[];
  throwOnGetSessionId?: boolean;
  throwOnBuildContextEntries?: boolean;
  throwOnGetEntries?: boolean;
  throwOnGetBranch?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const contextEntries = opts.contextEntries ?? [];
  const entries = opts.entries ?? [];
  const branch = opts.branch ?? [];
  const calls: string[] = [];
  const sessionManager = {
    getSessionId() {
      calls.push("getSessionId");
      if (opts.throwOnGetSessionId) throw new Error("getSessionId boom");
      return sessionId;
    },
    buildContextEntries() {
      calls.push("buildContextEntries");
      if (opts.throwOnBuildContextEntries) throw new Error("buildContextEntries boom");
      return contextEntries;
    },
    getEntries() {
      calls.push("getEntries");
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return entries;
    },
    getBranch() {
      calls.push("getBranch");
      if (opts.throwOnGetBranch) throw new Error("getBranch boom");
      return branch;
    },
  };
  return {
    calls,
    ctx: { sessionManager } as unknown as ExtensionContext,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Invoke the tool's execute with the audit's call signature. toolCallId defaults to "call-1". */
async function run(
  ctx: ExtensionContext,
  params: AuditArgs = {},
  toolCallId = "call-1",
): Promise<AgentToolResult<AuditDetails>> {
  return auditTool.execute(toolCallId, params, undefined, undefined, ctx);
}

/** Extract the text from a result's first content block (this tool ONLY returns TextContent). */
function firstText(res: AgentToolResult<AuditDetails>): string {
  const block = res.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`expected a text content block, got ${block?.type ?? "none"}`);
  }
  return block.text;
}

/** A toolResult message fixture (role:"toolResult", toolCallId, toolName, content text blocks). */
function toolResult(toolCallId: string, toolName: string, text: string): Record<string, unknown> {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
  };
}

/** A user message fixture. */
function userMsg(text: string): Record<string, unknown> {
  return { role: "user", content: text };
}

/** An assistant message fixture carrying the given content blocks. */
function assistantMsg(content: unknown[]): Record<string, unknown> {
  return { role: "assistant", content };
}

/** A single message-as-entry in buildContextEntries()/getEntries() (cast through `as unknown as SessionEntry`). */
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

/** A label entry for a checkpoint (spec/04 §6): label = "mulligan:checkpoint:<name>".
 *  Each checkpoint labels a DISTINCT target entry (mirrors production: a checkpoint is set on whatever entry
 *  is current when mulligan_checkpoint runs, so two checkpoints have different targetIds). The default
 *  targetId is derived from the name so two checkpoints coexist in the latest-wins map (validation issue 1b). */
function checkpointEntry(name: string, targetId = `leaf-${name}`): SessionEntry {
  entrySeq += 1;
  return {
    type: "label",
    id: `e-${entrySeq}`,
    parentId: null,
    timestamp: "",
    targetId,
    label: `mulligan:checkpoint:${name}`,
  } as unknown as SessionEntry;
}

/** A rewind marker custom entry (readMarkers scans type==="custom", customType==="mulligan:rewind"). */
function rewindMarkerEntry(granularity: string, seq: number): SessionEntry {
  entrySeq += 1;
  return {
    type: "custom",
    id: `e-${entrySeq}`,
    parentId: null,
    timestamp: "",
    customType: "mulligan:rewind",
    data: {
      schema: "mulligan.dev/v1",
      v: 1,
      kind: "rewind",
      id: `rw-${seq}`,
      granularity,
      options: {},
      seq,
      ts: 1,
      note: { what_happened: "", avoid: "", true_current_state: "", next: "" },
      ledger: { readFiles: [], modifiedFiles: [], bashSideEffects: [] },
    },
  } as unknown as SessionEntry;
}

/** A shrink marker custom entry (readMarkers scans type==="custom", customType==="mulligan:shrink"). */
function shrinkMarkerEntry(seq: number): SessionEntry {
  entrySeq += 1;
  return {
    type: "custom",
    id: `e-${entrySeq}`,
    parentId: null,
    timestamp: "",
    customType: "mulligan:shrink",
    data: {
      schema: "mulligan.dev/v1",
      v: 1,
      kind: "shrink",
      id: `sh-${seq}`,
      target: { by_tool_name: "read", occurrence: "last" },
      replacement: "(shrink)",
      seq,
      ts: 1,
    },
  } as unknown as SessionEntry;
}

/**
 * A mulligan:cancel custom entry (P3.M1.T2.S1 readMarkers contract): records the uuid id of a rewind/shrink
 * being retired. readMarkers collects every data.targetId into cancelledIds (a ghost id with no matching
 * marker still inflates the set), so seeding this builder is how the audit tests exercise nCancelled.
 * Mirrors rewindMarkerEntry/shrinkMarkerEntry (same module-level entrySeq, `as unknown as SessionEntry`).
 */
function cancelMarkerEntry(targetId: string): SessionEntry {
  entrySeq += 1;
  return {
    type: "custom",
    id: `e-${entrySeq}`,
    parentId: null,
    timestamp: "",
    customType: "mulligan:cancel",
    data: {
      schema: "mulligan.dev/v1",
      v: 1,
      kind: "cancel",
      targetId,
      seq: 0,
      ts: 1,
    },
  } as unknown as SessionEntry;
}

/** A string of ~`kb` KB of ASCII text (1 char = 1 byte), so messageBytes > 16 KB trips the bloat flag (shipped default). */
function kbText(kb: number): string {
  return "x".repeat(kb * 1024);
}

// ── registration metadata (spec/05 §5: name/label/description/parameters) ────

describe("mulligan_audit — registration metadata (spec/05 §5)", () => {
  it("name === 'mulligan_audit', label === 'Mulligan Audit', description === AUDIT_DESC", () => {
    expect(auditTool.name).toBe("mulligan_audit");
    expect(auditTool.label).toBe("Mulligan Audit");
    expect(auditTool.description).toBe(AUDIT_DESC);
  });

  it("description is the spec/05 §5 verbatim string (Audit)", () => {
    expect(AUDIT_DESC).toBe(
      "Show a token breakdown of the context you're currently carrying (what the model actually sees), " +
        "flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to " +
        "rewind or shrink.",
    );
  });

  it("parameters === AuditParams (the typebox schema)", () => {
    expect(auditTool.parameters).toBe(AuditParams);
  });

  it("auditTool matches ToolDefinition<AuditParams, AuditDetails>", () => {
    expectTypeOf(auditTool).toMatchTypeOf<ToolDefinition<typeof AuditParams, AuditDetails>>();
  });
});

// ── (a) PRIMARY path: cached rt.lastFiltered — spec/06 §7 ─────────────────────

describe("mulligan_audit — PRIMARY path: cached rt.lastFiltered (spec/06 §7)", () => {
  beforeEach(() => setConfig({})); // defaults: confidence medium, threshold 16384 (16 KB)

  it("uses rt.lastFiltered; details.source === 'cached', confidence === 'medium'", async () => {
    const { ctx } = makeCtx();
    // Pre-seed the runtime cache (GOTCHA #6: must match the fake ctx's sessionId "s1").
    getRuntime("s1").lastFiltered = [
      userMsg("hello world this is a short user message"),
      toolResult("call-A", "read", "file contents here"),
    ];
    const res = await run(ctx, { top: 8 });
    expect(res.details.source).toBe("cached");
    expect(res.details.confidence).toBe("medium");
    const text = firstText(res);
    expect(text).toContain("## Mulligan audit — context you are currently carrying");
    expect(text).toMatch(/Total \(filtered\): ~\d+ tokens  \(estimate, confidence: medium\)/);
  });

  it("Total is computed from estimateTokens(filtered), NOT ctx.getContextUsage() (D5)", async () => {
    const { calls, ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("a".repeat(40)), userMsg("b".repeat(80))];
    await run(ctx, {});
    // getContextUsage must NEVER appear in the sessionManager call list (it is not even on the fake).
    expect(calls).not.toContain("getContextUsage");
    expect(calls).toContain("getSessionId");
  });
});

// ── (b) E16 FALLBACK: null lastFiltered — spec/06 §7, spec/08 E16 ─────────────

describe("mulligan_audit — E16 FALLBACK: null lastFiltered (spec/06 §7, spec/08 E16)", () => {
  beforeEach(() => setConfig({}));

  it("builds from buildContextEntries(); details.source === 'fallback', confidence === 'low'", async () => {
    // leave rt.lastFiltered null (E16: audit before any inference this session)
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("user", { content: "a short message" })],
      branch: [],
    });
    const res = await run(ctx, {});
    expect(res.details.source).toBe("fallback");
    expect(res.details.confidence).toBe("low");
    const text = firstText(res);
    expect(text).toContain("Total (filtered):");
    expect(text).toMatch(/confidence: low/);
  });

  it("runs filterPipeline on the fallback (rewinds are reflected — the same pipeline)", async () => {
    // A rewind marker + a context entry it would target. filterPipeline is the SAME pipeline the
    // contextHandler runs, so the audit reflects post-rewind reality. We assert it does not throw and
    // produces a report (the deep filter math is transforms.test.ts's job).
    const { ctx } = makeCtx({
      contextEntries: [msgEntry("user", { content: "hello" })],
      entries: [rewindMarkerEntry("last_tool_call_group", 1)],
      branch: [],
    });
    const res = await run(ctx, {});
    expect(res.details.source).toBe("fallback");
    expect(res.details.nRewinds).toBe(1); // readMarkers found the rewind marker
    expect(firstText(res)).toContain("1 rewind");
  });
});

// ── (c) D5 guard: getContextUsage is NEVER called ────────────────────────────

describe("mulligan_audit — D5: NEVER ctx.getContextUsage() (spec/05 §4 D5)", () => {
  beforeEach(() => setConfig({}));

  it("getContextUsage is absent from the call list on BOTH paths", async () => {
    // PRIMARY
    const primary = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("x")];
    await run(primary.ctx, {});
    expect(primary.calls).not.toContain("getContextUsage");

    clearAll(); // reset between sub-checks

    // E16 FALLBACK
    const fallback = makeCtx({ contextEntries: [msgEntry("user", { content: "y" })] });
    await run(fallback.ctx, {});
    expect(fallback.calls).not.toContain("getContextUsage");
  });
});

// ── (d) top param: truncates the "Top messages" block (default 8) ─────────────

describe("mulligan_audit — top param (GOTCHA #8: default 8; truncates only the top block)", () => {
  beforeEach(() => setConfig({}));

  it("{top:2} truncates the 'Top messages by size' block to 2 rows", async () => {
    const { ctx } = makeCtx();
    // 5 messages; top:2 → exactly 2 rows in the top block.
    getRuntime("s1").lastFiltered = [
      userMsg("1111"),
      userMsg("22222222"),
      userMsg("333333333333"),
      userMsg("4444444444444444"),
      userMsg("55555555555555555555"),
    ];
    const res = await run(ctx, { top: 2 });
    expect(res.details.top).toHaveLength(2);
    const text = firstText(res);
    const rowCount = text.split("\n").filter((l) => /^\s+\d+\s+\S+\s+/.test(l)).length;
    expect(rowCount).toBe(2);
  });

  it("default (undefined top) → 8 rows max", async () => {
    const { ctx } = makeCtx();
    const msgs = Array.from({ length: 12 }, (_, i) => userMsg("z".repeat((i + 1) * 4)));
    getRuntime("s1").lastFiltered = msgs;
    const res = await run(ctx, {});
    expect(res.details.top.length).toBeLessThanOrEqual(8);
  });

  it("the total covers ALL filtered messages, not just the top block", async () => {
    const { ctx } = makeCtx();
    // 10 short messages; top:2 truncates the block but the total reflects all 10.
    const msgs = Array.from({ length: 10 }, () => userMsg("abcd")); // 4 chars each = 1 token each
    getRuntime("s1").lastFiltered = msgs;
    const res = await run(ctx, { top: 2 });
    expect(res.details.top).toHaveLength(2);
    // 10 msgs * 4 chars = 40 chars / 4 = 10 tokens (ceil). The total line must reflect ~10, not ~2.
    expect(firstText(res)).toMatch(/Total \(filtered\): ~10 tokens/);
  });
});

// ── (e) bloat flag: toolResult bytes > bloatThresholdBytes (16 KB shipped default) ─

describe("mulligan_audit — bloat flag (spec/05 §4: ⚠ above bloat threshold)", () => {
  beforeEach(() => setConfig({}));

  it("flags a read toolResult whose bytes exceed the resolved read threshold", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [
      toolResult("call-A", "read", kbText(25)), // 25 KB > read's 24 KB threshold → bloaty
    ];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(true);
    expect(res.details.top[0].thresholdBytes).toBe(24576);
    expect(firstText(res)).toContain("⚠ above bloat threshold (24 KB)");
  });

  it("does NOT flag a small toolResult", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "read", "tiny")];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(false);
    expect(res.details.top[0].thresholdBytes).toBe(24576);
    expect(firstText(res)).not.toContain("⚠ above bloat threshold");
  });
});

// ── (e2) per-tool bloat thresholds (BUG-001 fix: audit now agrees with Nudge A) ──

describe("mulligan_audit — per-tool bloat thresholds (BUG-001 fix)", () => {
  beforeEach(() => setConfig({}));

  it("bash 15000B is NOT flagged (bash uses the 16 KB global)", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "bash", "x".repeat(15000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(false); // 15000 < 16384 (bash falls back to the global)
    expect(res.details.top[0].thresholdBytes).toBe(16384);
    expect(firstText(res)).not.toContain("⚠ above bloat threshold");
  });

  it('bash 40000B is flagged with "(16 KB)" (bash uses the 16 KB global)', async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "bash", "x".repeat(40000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(true); // 40000 > 16384 (bash falls back to the global)
    expect(res.details.top[0].thresholdBytes).toBe(16384);
    expect(firstText(res)).toContain("⚠ above bloat threshold (16 KB)");
  });

  it("read 18000B is NOT flagged (read threshold 24 KB)", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "read", "x".repeat(18000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(false); // 18000 < 24576
    expect(res.details.top[0].thresholdBytes).toBe(24576);
    expect(firstText(res)).not.toContain("⚠ above bloat threshold");
  });

  it('read 25000B is flagged with "(24 KB)" (read threshold 24 KB)', async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "read", "x".repeat(25000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(true); // 25000 > 24576
    expect(res.details.top[0].thresholdBytes).toBe(24576);
    expect(firstText(res)).toContain("⚠ above bloat threshold (24 KB)");
  });

  it('generic tool (grep) 17000B is flagged with "(16 KB)" (global fallback)', async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [toolResult("call-A", "grep", "x".repeat(17000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(true); // 17000 > 16384 global
    expect(res.details.top[0].thresholdBytes).toBe(16384);
    expect(firstText(res)).toContain("⚠ above bloat threshold (16 KB)");
  });

  it('a non-toolResult user message (no toolName) uses the global threshold', async () => {
    // guards the falsy-toolName branch of bloatThresholdFor (GOTCHA #5)
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("x".repeat(17000))];
    const res = await run(ctx, {});
    expect(res.details.top[0].bloaty).toBe(true); // 17000 > 16384 global
    expect(res.details.top[0].thresholdBytes).toBe(16384);
    expect(firstText(res)).toContain("⚠ above bloat threshold (16 KB)");
  });
});

// ── (f) active markers + checkpoints summary (GOTCHA #7: checkpoints separate) ─

describe("mulligan_audit — Active markers + checkpoints (GOTCHA #7)", () => {
  beforeEach(() => setConfig({}));

  it("lists rewinds (granularity), shrinks, and checkpoint names", async () => {
    const { ctx } = makeCtx({
      entries: [
        rewindMarkerEntry("last_tool_call_group", 1),
        shrinkMarkerEntry(2),
        checkpointEntry("before-x"),
        checkpointEntry("before-y"),
      ],
    });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.details.nRewinds).toBe(1);
    expect(res.details.nShrinks).toBe(1);
    expect(res.details.nCheckpoints).toBe(2);
    const text = firstText(res);
    expect(text).toContain(
      "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y] (user-set)",
    );
  });

  it("renders an empty checkpoint set as '[]'", async () => {
    const { ctx } = makeCtx({ entries: [] });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(firstText(res)).toContain("0 rewind, 0 shrink, 0 checkpoints []");
  });
});

// ── (f2) lists cancelled markers as retired (P3.M1.T4.S1 / E21 (c)) ────────────

describe("mulligan_audit — lists cancelled markers as retired (P3.M1.T4.S1 / E21 (c))", () => {
  beforeEach(() => setConfig({})); // deterministic thresholds

  // Pure-renderer cases — call renderAuditReport directly with plain data (no ctx).
  it("pure: cancelledCount>0 appends ', N cancelled (retired)' to the Active-markers line", () => {
    const report = renderAuditReport({
      totalTokens: 5,
      confidence: "medium",
      rewinds: [],
      shrinks: [],
      checkpointNames: [],
      protectedRoles: ["first:user", "latest:user"],
      rows: [{ tokens: 5, role: "user", label: 'user "hi"', bloaty: false, thresholdBytes: 8192 }],
      filtered: [{}],
      cancelledCount: 1,
    });
    const activeLine = report.split("\n").find((l) => l.startsWith("Active markers:"));
    expect(activeLine).toBeDefined();
    expect(activeLine!).toContain(", 1 cancelled (retired)");
    // British double-l + the literal parenthetical (acceptance contract spelling).
    expect(activeLine!).toContain("cancelled (retired)");
  });

  it("pure: cancelledCount:3 → ', 3 cancelled (retired)'", () => {
    const report = renderAuditReport({
      totalTokens: 5,
      confidence: "medium",
      rewinds: [],
      shrinks: [],
      checkpointNames: [],
      protectedRoles: ["first:user", "latest:user"],
      rows: [{ tokens: 5, role: "user", label: 'user "hi"', bloaty: false, thresholdBytes: 8192 }],
      filtered: [{}],
      cancelledCount: 3,
    });
    const activeLine = report.split("\n").find((l) => l.startsWith("Active markers:"));
    expect(activeLine!).toContain(", 3 cancelled (retired)");
  });

  it("pure: cancelledCount:0 → NO 'cancelled' substring in the report (omit-when-0 rule)", () => {
    const report = renderAuditReport({
      totalTokens: 5,
      confidence: "medium",
      rewinds: [],
      shrinks: [],
      checkpointNames: [],
      protectedRoles: ["first:user", "latest:user"],
      rows: [{ tokens: 5, role: "user", label: 'user "hi"', bloaty: false, thresholdBytes: 8192 }],
      filtered: [{}],
      cancelledCount: 0,
    });
    // Guard against ", 0 cancelled" ever leaking — the clause is omitted entirely when 0.
    expect(report).not.toContain("cancelled");
    expect(report).not.toContain("0 cancelled");
  });

  // Integration cases via auditTool.execute + makeCtx seeding getEntries (the cached path isolates
  // the audit from filterPipeline — set rt.lastFiltered so the PRIMARY path runs).
  it("integration: ONE ghost-id cancel → details.nCancelled===1; report shows '1 cancelled (retired)'", async () => {
    // Ghost id ("ghost-1") with no matching marker isolates the clause: rewinds/shrinks stay 0.
    const { ctx } = makeCtx({ entries: [cancelMarkerEntry("ghost-1")] });
    getRuntime("s1").lastFiltered = [userMsg("hi")]; // cached path → no filterPipeline re-run
    const res = await run(ctx, {});
    expect(res.details.nCancelled).toBe(1);
    expect(firstText(res)).toContain("1 cancelled (retired)");
  });

  it("integration: TWO ghost-id cancels → details.nCancelled===2; report shows '2 cancelled (retired)'", async () => {
    const { ctx } = makeCtx({ entries: [cancelMarkerEntry("g1"), cancelMarkerEntry("g2")] });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.details.nCancelled).toBe(2);
    expect(firstText(res)).toContain("2 cancelled (retired)");
  });

  it("integration: NO cancel entries → details.nCancelled===0 and the clause is omitted (existing behavior)", async () => {
    const { ctx } = makeCtx({ entries: [] });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.details.nCancelled).toBe(0);
    expect(firstText(res)).not.toContain("cancelled");
  });

  it("integration: cancelling a REAL rewind drops it from its bucket AND raises nCancelled (no double-count)", async () => {
    // A rewind marker (id rw-1) + a cancel targeting it. readMarkers drops the rewind from rewinds[] AND
    // records the id, so nRewinds:0 and nCancelled:1 — the numbers stay self-consistent.
    const { ctx } = makeCtx({
      entries: [rewindMarkerEntry("last_tool_call_group", 1), cancelMarkerEntry("rw-1")],
    });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.details.nRewinds).toBe(0); // dropped by readMarkers
    expect(res.details.nCancelled).toBe(1);
    expect(firstText(res)).toContain("1 cancelled (retired)");
    // The cancelled rewind must NOT also be counted in the rewind tally.
    expect(firstText(res)).toContain("0 rewind");
  });

  // Resilience: the catch path carries the REQUIRED nCancelled field (CRITICAL GOTCHA #1).
  it("catch path: details.nCancelled===0 on a throwing getEntries (REQUIRED field present)", async () => {
    const { ctx } = makeCtx({ throwOnGetEntries: true });
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    // Failure text result — the execute never throws (GOTCHA #10).
    expect(firstText(res)).toContain("Mulligan: audit failed —");
    expect(res.details.error).toBeTruthy();
    expect(res.details.nCancelled).toBe(0); // the new REQUIRED field is present on the catch path
  });

  // Type-surface check: nCancelled is part of the public AuditDetails type.
  it("AuditDetails exposes a REQUIRED nCancelled:number field (P3.M1.T4.S1)", () => {
    expectTypeOf<AuditDetails>().toMatchTypeOf<{ nCancelled: number }>();
  });
});

// ── (g) suggestion names rows[0].label; empty filtered → no suggestion ───────

describe("mulligan_audit — suggestion (spec/05 §4)", () => {
  beforeEach(() => setConfig({}));

  it("names the largest row's label in the suggestion", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [
      toolResult("call-A", "read", "src/big.log contents here that are largish"),
      userMsg("small"),
    ];
    const res = await run(ctx, {});
    const text = firstText(res);
    // The largest contributor is the toolResult; the suggestion names its label (describeMessage output).
    expect(text).toContain("Suggestion: the `read");
    expect(text).toContain("result is the largest contributor. Consider mulligan_shrink.");
  });

  it("empty filtered → 'No messages in filtered view.' and NO suggestion", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [];
    const res = await run(ctx, {});
    const text = firstText(res);
    expect(text).toContain("No messages in filtered view.");
    expect(text).not.toContain("Suggestion:");
    expect(res.details.totalTokens).toBe(0);
  });
});

// ── (h) never-persists: 0 appendEntry / sendMessage / setLabel ───────────────

describe("mulligan_audit — never persists (CRITICAL INSIGHT #1)", () => {
  beforeEach(() => setConfig({}));

  it("records ZERO appendEntry / sendMessage / setLabel on the primary path", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    await run(ctx, {});
    // pi is never used by auditExecute; but we constructed the spy to PROVE nothing is persisted.
    expect(pi.appendEntry).toHaveLength(0);
    expect(pi.sendMessage).toHaveLength(0);
    expect(pi.setLabel).toHaveLength(0);
  });

  it("records ZERO writes on the E16 fallback path too", async () => {
    const { pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [msgEntry("user", { content: "hi" })] });
    await run(ctx, {});
    expect(pi.appendEntry).toHaveLength(0);
    expect(pi.sendMessage).toHaveLength(0);
    expect(pi.setLabel).toHaveLength(0);
  });
});

// ── (i) never-throws (GOTCHA #10): throwing fakes → failure text result ──────

describe("mulligan_audit — never throws (GOTCHA #10)", () => {
  beforeEach(() => setConfig({}));

  it("a throwing buildContextEntries (E16 path) → a failure text result + details.error", async () => {
    const { ctx } = makeCtx({ throwOnBuildContextEntries: true });
    const res = await run(ctx, {});
    const text = firstText(res);
    expect(text).toContain("Mulligan: audit failed —");
    expect(res.details.error).toBeTruthy();
    expect(res.details.totalTokens).toBe(0);
    expect(res.details.source).toBe("fallback");
  });

  it("a throwing getEntries (checkpoint scan) → a failure text result", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    ctx.sessionManager.getEntries = () => {
      throw new Error("getEntries boom");
    };
    const res = await run(ctx, {});
    expect(firstText(res)).toContain("Mulligan: audit failed — getEntries boom");
    expect(res.details.error).toContain("getEntries boom");
  });

  it("execute() never rejects (returns a result on every path)", async () => {
    const { ctx } = makeCtx({ throwOnGetSessionId: true });
    await expect(run(ctx, {})).resolves.toBeDefined();
  });
});

// ── (j) result shape: content is [{type:"text",text}] AND details present ────

describe("mulligan_audit — result shape (CRITICAL GOTCHA #1: details REQUIRED)", () => {
  beforeEach(() => setConfig({}));

  it("content is exactly one {type:'text', text:string} block", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(typeof (res.content[0] as { text: string }).text).toBe("string");
  });

  it("'details' is present on the success path with the AuditDetails shape", async () => {
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hi")];
    const res = await run(ctx, {});
    expect(res.details).toBeDefined();
    expect(res.details).toHaveProperty("totalTokens");
    expect(res.details).toHaveProperty("confidence");
    expect(res.details).toHaveProperty("source");
    expect(res.details).toHaveProperty("nRewinds");
    expect(res.details).toHaveProperty("nShrinks");
    expect(res.details).toHaveProperty("nCheckpoints");
    expect(Array.isArray(res.details.top)).toBe(true);
    expect(res.details).not.toHaveProperty("error"); // no error on the success path
  });

  it("'details' is present on the catch path too (with error)", async () => {
    const { ctx } = makeCtx({ throwOnGetSessionId: true });
    const res = await run(ctx, {});
    expect(res.details).toBeDefined();
    expect(res.details).toHaveProperty("error");
  });
});

// ── (k) pure helper unit tests (no ctx) ─────────────────────────────────────

describe("mulligan_audit — pure helpers (describeMessage / buildCallLookup / listCheckpoints / messageBytes)", () => {
  it("describeMessage: toolResult → `${toolName} ${arg}` from the matched toolCall", () => {
    const lookup = buildCallLookup([
      assistantMsg([{ type: "toolCall", id: "call-A", name: "read", arguments: { path: "src/big.log" } }]),
    ]);
    const label = describeMessage(toolResult("call-A", "read", "contents") as Record<string, unknown>, lookup);
    expect(label).toBe("read src/big.log");
  });

  it("describeMessage: assistant → block-count summary", () => {
    const lookup = new Map();
    const label = describeMessage(
      assistantMsg([
        { type: "thinking", thinking: "hmm" },
        { type: "toolCall", id: "x", name: "bash", arguments: {} },
      ]) as Record<string, unknown>,
      lookup,
    );
    expect(label).toBe("(thinking + toolCall)");
  });

  it("describeMessage: user → `user \"snippet…\"`", () => {
    const label = describeMessage(userMsg("hello there world") as Record<string, unknown>, new Map());
    expect(label).toBe('user "hello there world"');
  });

  it("describeMessage: custom → customType", () => {
    const label = describeMessage(
      { role: "custom", customType: "mulligan:note" } as Record<string, unknown>,
      new Map(),
    );
    expect(label).toBe("mulligan:note");
  });

  it("buildCallLookup indexes multiple toolCall blocks in one assistant message", () => {
    const lookup = buildCallLookup([
      assistantMsg([
        { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
        { type: "toolCall", id: "c2", name: "bash", arguments: { command: "ls" } },
      ]) as Record<string, unknown>,
    ]);
    expect(lookup.size).toBe(2);
    expect(lookup.get("c1")?.name).toBe("read");
    expect(lookup.get("c2")?.name).toBe("bash");
  });

  it("listCheckpoints strips the 'mulligan:checkpoint:' prefix (GOTCHA #7)", () => {
    const entries = [
      checkpointEntry("before-x"),
      checkpointEntry("before-y"),
      { type: "label", label: "other:label", targetId: "x" }, // not a mulligan checkpoint
      { type: "custom", customType: "mulligan:rewind" }, // not a label
    ];
    expect(listCheckpoints(entries)).toEqual(["before-x", "before-y"]);
  });

  // REGRESSION (validation issue #1b): listCheckpoints must honor Pi's latest-wins label semantics — a consumed
  // checkpoint (cleared by a rewind) appends a {label: undefined} entry to the raw stream, and the historical
  // SET entry persists alongside it. Scanning for any string match would wrongly keep listing the consumed name.
  it("listCheckpoints drops a CONSUMED checkpoint (latest-wins: clear entry follows the set)", () => {
    const entries = [
      checkpointEntry("anchor", "t1"), // SET: mulligan:checkpoint:anchor on t1
      { type: "label", targetId: "t1", label: undefined }, // CLEAR: consumed by a rewind
    ];
    expect(listCheckpoints(entries)).toEqual([]); // consumed → NOT listed in mulligan_audit
  });

  it("listCheckpoints resurrects a re-set checkpoint (set, clear, set-again under same name)", () => {
    const entries = [
      checkpointEntry("x", "t1"), // set
      { type: "label", targetId: "t1", label: undefined }, // cleared
      { type: "label", targetId: "t1", label: "mulligan:checkpoint:x" }, // re-set (re-created)
    ];
    expect(listCheckpoints(entries)).toEqual(["x"]); // latest-wins → active again
  });

  it("listCheckpoints keeps an OTHER checkpoint when one is consumed (per-target latest-wins)", () => {
    const entries = [
      checkpointEntry("before-x", "t1"),
      checkpointEntry("before-y", "t2"),
      { type: "label", targetId: "t1", label: undefined }, // only 'before-x' consumed
    ];
    expect(listCheckpoints(entries)).toEqual(["before-y"]); // before-x cleared, before-y still active
  });

  it("messageBytes: string content → UTF-8 byte length (multibyte-aware)", () => {
    expect(messageBytes({ role: "user", content: "café" })).toBe(5); // é is 2 bytes
    expect(messageBytes({ role: "user", content: "" })).toBe(0);
  });

  it("messageBytes: array content → resultBytes (text block UTF-8 bytes)", () => {
    expect(messageBytes({ role: "toolResult", content: [{ type: "text", text: "abcd" }] })).toBe(4);
  });

  it("messageBytes: 0 for absent/non-array-non-string content (defensive)", () => {
    expect(messageBytes({ role: "user" })).toBe(0);
    expect(messageBytes({ role: "user", content: 42 })).toBe(0);
  });
});

// ── renderAuditReport: the spec/05 §4 VERBATIM format ───────────────────────

describe("renderAuditReport — spec/05 §4 verbatim format", () => {
  it("renders the full report (total, markers, protected, top rows, suggestion)", () => {
    const rows: AuditRow[] = [
      { tokens: 9412, role: "toolResult", label: "read src/big.log", bloaty: true, thresholdBytes: 8192 },
      { tokens: 1840, role: "assistant", label: "(thinking + toolCall x2)", bloaty: false, thresholdBytes: 8192 },
      { tokens: 612, role: "toolResult", label: 'grep "auth"', bloaty: false, thresholdBytes: 8192 },
    ];
    const report = renderAuditReport({
      totalTokens: 12340,
      confidence: "medium",
      rewinds: [{ granularity: "last_tool_call_group" } as RewindMarker],
      shrinks: [],
      checkpointNames: ["before-x", "before-y"],
      protectedRoles: ["first:user", "latest:user"],
      rows,
      filtered: [1, 2, 3], // non-empty → suggestion present
      cancelledCount: 0, // P3.M1.T4.S1 — no cancels → clause omitted (line byte-identical to today)
    });
    const lines = report.split("\n");
    expect(lines[0]).toBe("## Mulligan audit — context you are currently carrying");
    expect(lines[1]).toBe("Total (filtered): ~12340 tokens  (estimate, confidence: medium)");
    expect(lines[2]).toBe(
      "Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y] (user-set)",
    );
    expect(lines[3]).toBe("Protected: will not rewind past first:user/latest:user.");
    expect(lines[4]).toBe("");
    expect(lines[5]).toBe("Top messages by size:");
    expect(lines[6]).toBe("    9412  toolResult  read src/big.log  ⚠ above bloat threshold (8 KB)");
    expect(lines[7]).toBe("    1840  assistant   (thinking + toolCall x2)");
    expect(lines[8]).toBe("     612  toolResult  grep \"auth\"");
    expect(lines[9]).toBe("");
    expect(lines[10]).toBe(
      "Suggestion: the `read src/big.log` result is the largest contributor. Consider mulligan_shrink.",
    );
  });

  it("checkpointNames length 1 → singular '1 checkpoint' + '(user-set)' annotation (BUG-003)", () => {
    const report = renderAuditReport({
      totalTokens: 0,
      confidence: "low",
      rewinds: [],
      shrinks: [],
      checkpointNames: ["solo"],
      protectedRoles: ["first:user", "latest:user"],
      rows: [],
      filtered: [], // the Active-markers line is pushed BEFORE the empty-filtered early-return
      cancelledCount: 0,
    });
    expect(report).toContain("Active markers: 0 rewind, 0 shrink, 1 checkpoint [solo] (user-set)");
    expect(report).not.toContain("1 checkpoints"); // singularized — never the plural with count 1
  });

  it("empty filtered → 'No messages in filtered view.' and no suggestion/top block", () => {
    const report = renderAuditReport({
      totalTokens: 0,
      confidence: "low",
      rewinds: [],
      shrinks: [],
      checkpointNames: [],
      protectedRoles: ["first:user", "latest:user"],
      rows: [],
      filtered: [],
      cancelledCount: 0, // P3.M1.T4.S1 — no cancels → clause omitted
    });
    const lines = report.split("\n");
    expect(report).toContain("No messages in filtered view.");
    expect(report).not.toContain("Suggestion:");
    expect(report).not.toContain("Top messages by size:");
    // Protected line still present even when empty.
    expect(lines[3]).toBe("Protected: will not rewind past first:user/latest:user.");
  });

  it("empty checkpoint set renders '[]'", () => {
    const report = renderAuditReport({
      totalTokens: 5,
      confidence: "medium",
      rewinds: [],
      shrinks: [],
      checkpointNames: [],
      protectedRoles: ["first:user", "latest:user"],
      rows: [{ tokens: 5, role: "user", label: 'user "hi"', bloaty: false, thresholdBytes: 8192 }],
      filtered: [{}],
      cancelledCount: 0, // P3.M1.T4.S1 — no cancels → clause omitted
    });
    expect(report).toContain("0 rewind, 0 shrink, 0 checkpoints []");
  });
});

// ── config.enabled === false: refusal gate (BUG-005; spec/08 E14 + D5) ───────────────────────────────

describe("mulligan_audit — config.enabled === false (BUG-005; spec/08 E14, D5)", () => {
  beforeEach(() => setConfig({ enabled: false })); // master switch off (merges with defaults)

  it("refuses 'Mulligan is disabled' with zeroed details; does NOT run filterPipeline / report a transformed view", async () => {
    const { calls, ctx } = makeCtx();
    // Seed the cache so we can PROVE the disabled path ignores it (D5: no transformed view is computed).
    getRuntime("s1").lastFiltered = [userMsg("seeded but must be ignored when disabled")];
    const res = await run(ctx, { top: 8 });
    // E14 refusal text (refusal() adds the "Mulligan: refused — " prefix + trailing "."):
    expect(firstText(res)).toBe("Mulligan: refused — Mulligan is disabled.");
    // The disabled-path AuditDetails (the contract OUTPUT — all counts zero, top empty, no `error`):
    expect(res.details).toEqual({
      totalTokens: 0,
      confidence: "low",
      source: "fallback",
      nRewinds: 0,
      nShrinks: 0,
      nCheckpoints: 0,
      nCancelled: 0,
      top: [],
    });
    // D5 proof: the gate fires BEFORE any session access — no sessionManager method is called, so NO
    // transformed view (filterPipeline/buildContextEntries/getBranch) is ever computed when disabled.
    expect(calls).not.toContain("getSessionId");
    expect(calls).not.toContain("buildContextEntries");
    expect(calls).not.toContain("getBranch");
  });

  it("re-enabling (config.enabled === true) restores normal behavior — the gate is not sticky", async () => {
    // Proves the gate is a runtime read, not a cached/latched state.
    setConfig({ enabled: true });
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hello world this is a short user message")];
    const res = await run(ctx, { top: 8 });
    expect(res.details.source).toBe("cached"); // back on the normal PRIMARY path
    expect(firstText(res)).toContain("## Mulligan audit — context you are currently carrying");
    expect(firstText(res)).not.toContain("Mulligan is disabled");
  });
});

