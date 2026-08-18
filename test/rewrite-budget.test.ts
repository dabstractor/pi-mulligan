/**
 * rewrite-budget.test.ts — unit tests for the v2 "cap at one moment" rewrite budget
 * (src/rewrite-budget.ts, the shrink/rewind submitRewrite gates, the audit + compaction flush
 * triggers, the turn_end op-counter reset, and the rewrites config plumbing).
 *
 * VOCABULARY UNDER TEST: an OPERATION is one mulligan_rewind/mulligan_shrink call; a MOMENT is a
 * turn in which at least one marker becomes ACTIVE. maxMoments (default 1) caps MOMENTS.
 *
 * REQUIRED COVERAGE (v2 task list):
 *   1. parallel ops in one turn count as ONE moment (2nd op in a turn flushes the batch).
 *   2. op after the moment is spent QUEUES and does not change the outgoing context.
 *   3. queued markers ride a compaction event (free break — no moment spent).
 *   4. safety valve opens an extra moment ONLY strictly above the threshold.
 *   5. flushShedTokens boundary on the pre-spend decision (strictly-above; at-threshold waits).
 *   6. counters reset per session (resetRuntime — the session_start seam) + per-session isolation.
 *   7. fail-open config (garbage values fall back to defaults).
 *   8. maxMoments=0 reproduces "never create markers; audit/cancel still work".
 *   9. turn_end resets opsThisTurn (the natural-batching scope is ONE turn).
 *  10. audit flush: pre-spend it SPENDS the moment; post-spend it applies for free.
 *
 * House idiom (mirrors test/tools/shrink.test.ts): hand-rolled fakes (NO vi.fn()), clearAll()
 * runtime reset, `.js` import paths. Telemetry captured by pointing the JSONL logger at a temp
 * file ("mulligan:rewrite-queued" fires when an op QUEUES; "mulligan:rewrite-flush" — the only
 * path where markers become active — fires on every real activation).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeShrinkTool } from "../src/tools/shrink.js";
import { makeAuditTool } from "../src/tools/audit.js";
import { validateConfig, setConfig } from "../src/config.js";
import { clearAll, getRuntime, resetRuntime, type SessionRuntime } from "../src/runtime.js";
import {
  submitRewrite,
  flushRewrites,
  queuedShedTotal,
  maybeFlushOnCompaction,
  registerRewriteTurnReset,
  type QueuedRewriteArg,
} from "../src/rewrite-budget.js";
import { setLogFile } from "../src/log.js";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// ── shared fixtures ───────────────────────────────────────────────────────────

/** Temp JSONL log destination (telemetry capture). */
const LOG = join(tmpdir(), `mulligan-rewrite-budget-v2-test-${process.pid}.jsonl`);

beforeEach(() => {
  clearAll(); // GOTCHA #8: the shared module-scoped runtime map must not leak across tests
  setConfig(undefined); // fresh DEFAULTS per test (a previous test's setConfig must not leak)
  rmSync(LOG, { force: true });
  setLogFile(LOG);
});
afterEach(() => {
  setLogFile(null); // logging off unless a test re-arms it
  clearAll();
});

/** A minimal fake ExtensionAPI capturing appendEntry + sendMessage + setLabel + on(). */
function makePi() {
  const appended: { customType: string; data: unknown }[] = [];
  const sent: { customType: string; content: unknown }[] = [];
  const labels: { entryId: string; label: string | undefined }[] = [];
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      appended.push({ customType, data });
    },
    sendMessage(message: { customType: string; content: unknown }) {
      sent.push({ customType: message.customType, content: message.content });
    },
    setLabel(entryId: string, label: string | undefined) {
      labels.push({ entryId, label });
    },
    on(event: string, cb: (...a: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
    },
  };
  /** Fire the captured handlers for an event (turn_end simulation). */
  const fire = (event: string, ...args: unknown[]) => {
    for (const cb of handlers[event] ?? []) cb(...args);
  };
  return { appended, sent, labels, fire, pi: pi as unknown as ExtensionAPI };
}

/** A minimal fake ExtensionContext (session id / entries / context snapshot). */
function makeCtx(opts: { sessionId?: string; entries?: unknown[]; contextEntries?: SessionEntry[] } = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const entries = opts.entries ?? [];
  const contextEntries = opts.contextEntries ?? [];
  const sessionManager = {
    getSessionId() {
      return sessionId;
    },
    getLeafId() {
      return "leaf-1";
    },
    getEntries() {
      return entries;
    },
    getLabel(_id: string) {
      return undefined;
    },
    getBranch() {
      return [] as unknown[];
    },
    buildContextEntries() {
      return contextEntries;
    },
  };
  const ctx = { sessionManager, hasUI: false } as unknown as ExtensionContext;
  return { ctx };
}

/** A message entry wrapping a toolResult (1 message per entry by construction). */
let entrySeq = 0;
function toolResultEntry(toolCallId: string, toolName: string, text: string): SessionEntry {
  return {
    id: `e-${++entrySeq}`,
    type: "message",
    message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }] },
  } as unknown as SessionEntry;
}

/** A shrink op arg for direct submitRewrite calls (precise estimatedTokens for boundary tests). */
function shrinkOp(estimatedTokens: number): QueuedRewriteArg {
  return {
    kind: "shrink",
    payload: { target: { by_tool_call_id: `call-${estimatedTokens}` }, replacement: "(shrink)" },
    estimatedTokens,
  };
}

/** Run one mulligan_shrink tool call against a scripted big matched result (shed ≈ 500 tokens). */
const BIG = "NEEDLE " + "x".repeat(2000); // ~2007 chars ≈ 502 tokens minus the tiny replacement
async function runShrink(pi: ExtensionAPI, ctx: ExtensionContext, toolCallId = "call-s") {
  return makeShrinkTool(pi).execute(
    toolCallId,
    // v2.0 merged: the legacy by_content_includes arm was removed (2-arm union); match the scripted
    // "bash" results by tool name (first occurrence ≈ the old first-substring-match semantics).
    { target: { by_tool_name: "bash", occurrence: "first" as const }, replacement: "(shrink) big" },
    undefined,
    undefined,
    ctx,
  );
}

/** Parse the JSONL telemetry log back into LogLine-shaped records. */
function logEvents(): { event: string; data?: Record<string, unknown> }[] {
  try {
    return readFileSync(LOG, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { event: string; data?: Record<string, unknown> });
  } catch {
    return [];
  }
}
const flushEvents = () => logEvents().filter((e) => e.event === "mulligan:rewrite-flush");

/** Simulate a TURN BOUNDARY (what the turn_end handler does): zero the per-turn counters. */
function nextTurn(rt: SessionRuntime): void {
  rt.opsThisTurn = 0;
  rt.activatedThisTurn = false;
}

/** Count active (appended) markers of a kind. */
const nMarkers = (appended: { customType: string }[], kind: string) =>
  appended.filter((a) => a.customType === kind).length;

// ── 1. parallel ops in one turn count as ONE moment ───────────────────────────

describe("moments, not operations (default maxMoments=1)", () => {
  it("a single small op QUEUES (queue-first: the moment is not spent on a small shed)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [toolResultEntry("c1", "bash", "NEEDLE small")] });
    const res = await runShrink(pi, ctx);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(0); // nothing active
    expect(JSON.stringify(res.content)).toContain("queued");
    expect(JSON.stringify(res.content)).toContain("visible"); // honest: still visible
    expect(res.details).toMatchObject({ queued: true, markerId: null });
    const rt = getRuntime("s1");
    expect(rt.momentsSpent).toBe(0); // the moment is NOT spent
    expect(rt.rewriteQueue).toHaveLength(1);
    expect(flushEvents()).toHaveLength(0); // activation events only fire on real activation
  });

  it("the 2nd op in the SAME turn flushes the whole batch — FIVE ops, ONE moment", async () => {
    const { appended, pi } = makePi();
    const entries = [1, 2, 3, 4, 5].map((i) => toolResultEntry(`c${i}`, "bash", `NEEDLE payload ${i} ${"y".repeat(500)}`));
    const { ctx } = makeCtx({ contextEntries: entries });
    const shrink = makeShrinkTool(pi);
    const ids = [1, 2, 3, 4, 5].map((i) => `c${i}`);
    const target = (i: number) => ({ by_tool_call_id: ids[i - 1] });

    const results = [];
    for (let i = 1; i <= 5; i++) {
      // same turn: no turn_end fires between the parallel calls
      results.push(await shrink.execute(`call-${i}`, { target: target(i), replacement: "(shrink)" }, undefined, undefined, ctx));
    }
    // All five are ACTIVE (the 2nd op's natural-batching trigger flushed; 3-5 rode the same spent
    // moment policy — see below) — but crucially the markers landed and only moments matter.
    expect(nMarkers(appended, "mulligan:shrink")).toBe(5);
    const rt = getRuntime("s1");
    expect(rt.momentsSpent).toBe(1); // ← THE assertion: five operations, ONE moment
    expect(rt.rewriteQueue).toHaveLength(0);
  });
});

// ── 2. op after the moment is spent queues; no context change ─────────────────

describe("after the moment is spent", () => {
  it("a further op QUEUES (no marker, no activation event) — volume alone never opens a 2nd moment", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s1");

    // Spend the moment: queue one op then trigger the volume flush (flushShedTokens default 4000).
    let r = submitRewrite(pi, ctx, rt, shrinkOp(4001));
    expect(r.status).toBe("applied"); // reaches 4000 → volume flush
    expect(rt.momentsSpent).toBe(1);
    nextTurn(rt); // the next op arrives in a LATER turn

    // Post-spend: a BIG op (would exceed flushShedTokens AND more) still only QUEUES.
    r = submitRewrite(pi, ctx, rt, shrinkOp(15000)); // under the 16000 valve → queue
    expect(r.status).toBe("queued");
    expect(nMarkers(appended, "mulligan:shrink")).toBe(1); // unchanged outgoing context
    expect(rt.momentsSpent).toBe(1); // no second moment
    expect(rt.rewriteQueue).toHaveLength(1);
    expect(flushEvents()).toHaveLength(1); // no new activation event
  });

  it("the tool result stays honest: queued + still visible (content unchanged)", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [toolResultEntry("c1", "bash", BIG), toolResultEntry("c2", "bash", BIG)] });
    // 1st + 2nd op in one turn → batch flush spends the moment.
    await runShrink(pi, ctx, "call-1");
    await runShrink(pi, ctx, "call-2");
    expect(getRuntime("s1").momentsSpent).toBe(1);

    // A third op NEXT turn (turn boundary — see the turn_end suite) queues.
    nextTurn(getRuntime("s1"));
    const res = await runShrink(pi, ctx, "call-3");
    expect(nMarkers(appended, "mulligan:shrink")).toBe(2); // the 3rd changed nothing
    expect(JSON.stringify(res.content)).toContain("queued");
    expect(JSON.stringify(res.content)).toContain("visible");
    expect(JSON.stringify(res.content)).not.toContain("Context updated"); // no orientation lie
  });
});

// ── 3. queued markers ride a compaction event (free break) ────────────────────

describe("compaction rider (the free break)", () => {
  it("a NEW compaction entry flushes the queue WITHOUT spending a moment; the first observation only initializes", () => {
    const { appended, pi } = makePi();
    const rt = getRuntime("s1");
    // Queue two ops post-spend (moment already spent by a valve-free path: spend it first).
    setConfig({ rewrites: { flushShedTokens: 1 } });
    let r = submitRewrite(pi, ctxOf({ entries: [{ type: "compaction", id: "k0" }] }), rt, shrinkOp(500));
    expect(r.status).toBe("applied"); // volume trigger (flushShedTokens:1)
    expect(rt.momentsSpent).toBe(1);
    setConfig(undefined); // back to defaults for the rider test
    nextTurn(rt); // the rider op arrives in a LATER turn

    // A queued op rides:
    r = submitRewrite(pi, ctxOf({ entries: [{ type: "compaction", id: "k0" }] }), rt, shrinkOp(100));
    expect(r.status).toBe("queued");

    // Fire 1: watermark initializes at the CURRENT count (1) — no flush (predates the queue).
    const ctx1 = ctxOf({ entries: [{ type: "message", id: "m1" }, { type: "compaction", id: "k0" }] });
    maybeFlushOnCompaction(pi, ctx1, rt);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(1); // not yet

    // Fire 2 with NO new compaction → still queued.
    maybeFlushOnCompaction(pi, ctx1, rt);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(1);

    // Fire 3: the provider re-compacted (a NEW compaction entry) → the queue rides the free break.
    const ctx2 = ctxOf({ entries: [{ type: "compaction", id: "k0" }, { type: "compaction", id: "k1" }] });
    maybeFlushOnCompaction(pi, ctx2, rt);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(2); // activated
    expect(rt.momentsSpent).toBe(1); // FREE — a compaction break costs no moment
    expect(rt.rewriteQueue).toHaveLength(0);
    const evts = flushEvents();
    expect(evts.at(-1)?.data).toMatchObject({ trigger: "compaction" });
    function ctxOf(o: { entries: unknown[] }) {
      return makeCtx(o).ctx;
    }
  });
});

// ── 4. safety valve — an extra moment ONLY strictly above the threshold ───────

describe("safety valve (safetyValveTokens=16000 default)", () => {
  it("queued volume AT or UNDER the threshold never opens a second moment", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s1");
    // Spend the one moment first.
    expect(submitRewrite(pi, ctx, rt, shrinkOp(4001)).status).toBe("applied");
    expect(rt.momentsSpent).toBe(1);
    nextTurn(rt); // later turn

    // Exactly at 16000 (total) → queued (strictly-above required).
    expect(submitRewrite(pi, ctx, rt, shrinkOp(11999)).status).toBe("queued"); // total 11999
    expect(submitRewrite(pi, ctx, rt, shrinkOp(4001)).status).toBe("queued"); // total 16000 EXACTLY
    expect(rt.momentsSpent).toBe(1);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(1);
  });

  it("queued volume strictly ABOVE the threshold spends an EXTRA moment and flushes", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s1");
    expect(submitRewrite(pi, ctx, rt, shrinkOp(4001)).status).toBe("applied"); // moment 1
    nextTurn(rt); // later turn
    const r = submitRewrite(pi, ctx, rt, shrinkOp(16001)); // total 16001 > 16000 → valve
    expect(r.status).toBe("applied");
    expect(rt.momentsSpent).toBe(2); // the exception moment
    expect(rt.rewriteQueue).toHaveLength(0);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(2);
    expect(flushEvents().at(-1)?.data).toMatchObject({ trigger: "valve" });
  });
});

// ── 5. flushShedTokens boundary on the PRE-SPEND decision ─────────────────────

describe("flushShedTokens boundary (pre-spend; default 4000)", () => {
  it("queued volume UNDER the threshold waits; REACHING it flushes (>= — at-threshold flushes; 0 = flush every op)", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s2");
    const ctx2 = makeCtx({ sessionId: "s2" }).ctx;
    expect(submitRewrite(pi, ctx2, rt, shrinkOp(3999)).status).toBe("queued"); // 3999 < 4000 → wait
    expect(rt.momentsSpent).toBe(0);
    // one more token REACHES the threshold → volume flush spends the moment
    expect(submitRewrite(pi, ctx2, rt, shrinkOp(1)).status).toBe("applied"); // 4000 >= 4000
    expect(rt.momentsSpent).toBe(1);
    expect(flushEvents().at(-1)?.data).toMatchObject({ trigger: "volume" });
    // threshold 0 = the aggressive off-position: every op flushes immediately (even 0-shed)
    setConfig({ rewrites: { flushShedTokens: 0 } });
    const rt3 = getRuntime("s3");
    const ctx3 = makeCtx({ sessionId: "s3" }).ctx;
    expect(submitRewrite(pi, ctx3, rt3, shrinkOp(0)).status).toBe("applied");
    expect(nMarkers(appended, "mulligan:shrink")).toBe(3); // 2 (the s2 batch flushed TOGETHER) + 1 (s3)
  });
});

// ── 6. counters reset per session ─────────────────────────────────────────────

describe("counters reset across sessions (resetRuntime — the session_start seam)", () => {
  it("after resetRuntime the budget is fresh; different session ids are independent", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s1");
    submitRewrite(pi, ctx, rt, shrinkOp(4001)); // spend s1's moment
    expect(rt.momentsSpent).toBe(1);

    resetRuntime("s1"); // what session_start does (index.ts wiring)
    const fresh = getRuntime("s1");
    expect(fresh.momentsSpent).toBe(0);
    expect(fresh.opsThisTurn).toBe(0);
    expect(fresh.compactionWatermark).toBeNull();
    expect(fresh.rewriteQueue).toHaveLength(0);

    // and the fresh session can spend its moment again
    expect(submitRewrite(pi, ctx, fresh, shrinkOp(4001)).status).toBe("applied");
    expect(getRuntime("s1").momentsSpent).toBe(1);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(2);
  });
});

// ── 8. maxMoments=0 — never create markers; audit/cancel still work ───────────

describe("maxMoments=0 (never create markers)", () => {
  it("every op refuses; nothing persists or queues; audit still works", async () => {
    setConfig({ rewrites: { maxMoments: 0 } });
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [toolResultEntry("c1", "bash", BIG)] });

    const res = await runShrink(pi, ctx);
    expect(JSON.stringify(res.content)).toContain("refused");
    expect(JSON.stringify(res.content)).toContain("mulligan_audit");
    expect(appended).toHaveLength(0);
    expect(getRuntime("s1").rewriteQueue).toHaveLength(0); // refused, NOT queued
    expect(getRuntime("s1").momentsSpent).toBe(0);

    // audit still works (and flushes nothing — the queue is empty).
    const audit = await makeAuditTool(pi).execute("au", { top: 8 }, undefined, undefined, ctx);
    expect(JSON.stringify(audit.content)).toContain("Mulligan audit");
    expect(audit.details.flushedRewrites).toBeUndefined();
    expect(flushEvents()).toHaveLength(0);
  });
});

// ── 9. turn_end resets opsThisTurn ────────────────────────────────────────────

describe("turn_end resets the per-turn op counter (registerRewriteTurnReset)", () => {
  it("a 2nd op in a LATER turn does NOT batch-flush (opsThisTurn was reset)", () => {
    const { appended, pi, fire } = makePi();
    const { ctx } = makeCtx();
    registerRewriteTurnReset(pi); // the index.ts wiring (registers pi.on("turn_end", …))

    const rt = getRuntime("s1");
    expect(submitRewrite(pi, ctx, rt, shrinkOp(100)).status).toBe("queued"); // op 1 this turn
    expect(rt.opsThisTurn).toBe(1);

    // turn boundary: the registered handler zeroes the counter (ctx carries the session id),
    // exactly as Pi would fire it between turns.
    fire("turn_end", { type: "turn_end" }, ctx);
    expect(rt.opsThisTurn).toBe(0);

    expect(submitRewrite(pi, ctx, rt, shrinkOp(100)).status).toBe("queued"); // op 1 of the NEW turn
    expect(nMarkers(appended, "mulligan:shrink")).toBe(0); // no batch trigger fired
    expect(rt.momentsSpent).toBe(0);
  });
});

// ── 10. audit flush: pre-spend spends the moment; post-spend rides free ───────

describe("audit flush trigger", () => {
  it("pre-spend: the audit call applies the queue AND spends the moment", async () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ contextEntries: [toolResultEntry("c1", "bash", "NEEDLE small")] });
    await runShrink(pi, ctx); // queues (small, single)
    expect(getRuntime("s1").momentsSpent).toBe(0);

    const res = await makeAuditTool(pi).execute("au", { top: 8 }, undefined, undefined, ctx);
    expect(nMarkers(appended, "mulligan:shrink")).toBe(1); // applied by the audit
    expect(getRuntime("s1").momentsSpent).toBe(1); // the audit SPENT the budgeted moment
    expect(JSON.stringify(res.content)).toContain("rewrite batch applied");
    expect(res.details.flushedRewrites).toMatchObject({ count: 1 });
    expect(flushEvents().at(-1)?.data).toMatchObject({ trigger: "audit" });
  });

  it("post-spend: the audit call still applies the queue — WITHOUT spending anything further", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx();
    const rt = getRuntime("s1");
    expect(submitRewrite(pi, ctx, rt, shrinkOp(4001)).status).toBe("applied"); // moment spent
    nextTurn(rt); // later turn
    expect(submitRewrite(pi, ctx, rt, shrinkOp(100)).status).toBe("queued"); // post-spend queue

    // audit (called synchronously — the tool is async but flushRewrites runs at its start)
    flushRewrites(pi, ctx, rt, "audit");
    expect(nMarkers(appended, "mulligan:shrink")).toBe(2);
    expect(rt.momentsSpent).toBe(1); // NOT 2 — the post-spend audit rides free (spec b)
  });
});

// ── 7. fail-open config ───────────────────────────────────────────────────────

describe("rewrites config fail-open (validateConfig)", () => {
  it("absent → defaults {maxMoments:1, flushShedTokens:4000, safetyValveTokens:16000}", () => {
    const d = { maxMoments: 1, flushShedTokens: 4000, safetyValveTokens: 16000 };
    expect(validateConfig({}).rewrites).toEqual(d);
    expect(validateConfig(undefined).rewrites).toEqual(d);
    expect(validateConfig({ rewrites: {} }).rewrites).toEqual(d);
  });

  it("garbage falls back to defaults; v1 keys are retired (ignored)", () => {
    expect(validateConfig({ rewrites: { maxMoments: "one" } }).rewrites.maxMoments).toBe(1);
    expect(validateConfig({ rewrites: { maxMoments: NaN } }).rewrites.maxMoments).toBe(1);
    expect(validateConfig({ rewrites: { maxMoments: -3 } }).rewrites.maxMoments).toBe(1);
    expect(validateConfig({ rewrites: { flushShedTokens: 0 } }).rewrites.flushShedTokens).toBe(0); // 0 = flush immediately (valid)
    expect(validateConfig({ rewrites: { flushShedTokens: -1 } }).rewrites.flushShedTokens).toBe(4000);
    expect(validateConfig({ rewrites: { safetyValveTokens: "huge" } }).rewrites.safetyValveTokens).toBe(16000);
    expect(validateConfig({ rewrites: "nope" }).rewrites).toEqual({
      maxMoments: 1,
      flushShedTokens: 4000,
      safetyValveTokens: 16000,
    });
    // v1 keys silently ignored (unknown-key policy) → new defaults apply
    expect(validateConfig({ rewrites: { maxPerSession: 9, batching: false } }).rewrites).toEqual({
      maxMoments: 1,
      flushShedTokens: 4000,
      safetyValveTokens: 16000,
    });
  });

  it("valid values pass through: 0 is a VALID maxMoments; fractions floor", () => {
    expect(validateConfig({ rewrites: { maxMoments: 0 } }).rewrites.maxMoments).toBe(0); // off switch
    expect(validateConfig({ rewrites: { maxMoments: 3 } }).rewrites.maxMoments).toBe(3);
    expect(validateConfig({ rewrites: { maxMoments: 1.9 } }).rewrites.maxMoments).toBe(1); // floor
    expect(validateConfig({ rewrites: { flushShedTokens: 250.5 } }).rewrites.flushShedTokens).toBe(250.5);
    expect(validateConfig({ rewrites: { safetyValveTokens: 32000 } }).rewrites.safetyValveTokens).toBe(32000);
  });
});

// ── housekeeping: queuedShedTotal defensive behavior ──────────────────────────

describe("queuedShedTotal", () => {
  it("sums positive finite estimates; ignores garbage", () => {
    const rt = getRuntime("s1");
    rt.rewriteQueue.push(
      { kind: "shrink", payload: {}, estimatedTokens: 10 },
      { kind: "rewind", payload: {}, estimatedTokens: 15 },
      { kind: "shrink", payload: {}, estimatedTokens: -5 },
      { kind: "shrink", payload: {}, estimatedTokens: Number.NaN },
    );
    expect(queuedShedTotal(rt)).toBe(25);
  });
});