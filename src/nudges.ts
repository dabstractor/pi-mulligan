/**
 * nudges.ts — Mulligan's preventive nudges (spec/07-preventive-and-nudges.md). This module currently ships
 *   Nudge A — the `tool_result` bloated-result reminder (§1). P1.M6.T2.S1 (turn_end metric) + P1.M6.T2.S2
 *   (shouldNudge/injectNudge) APPEND to this module later.
 *
 * spec/03-architecture.md §3 (design principle #3 zero extra requests, #4 fail open), §2.4 (every handler
 *   wrapped so an exception becomes a logged no-op), §7 (nudges.ts module list);
 * spec/07-preventive-and-nudges.md §1 (Nudge A mechanism, threshold calibration, why-advisory D3);
 * spec/08-edge-cases.md E13 (handler never throws);
 * spec/11 (spec/11 §2 Step 7 — nudges.ts, Nudge A);
 * api_verification.md §7.2 (tool_result Event: handler returns the tool_result result | void; returning
 *   {content} APPENDS-modifies the result; returning void passes it through unchanged);
 * spec/02-proven-constraints.md C4 (void = pass-through), C12 (read sessionManager fresh).
 *
 * NUDGE A — `tool_result` bloated-result reminder. Fires after EVERY tool execution; if a single result's
 * in-context byte size exceeds config.nudges.bloatThresholdBytes (default 8192 ≈ 2k tokens), the handler
 * APPENDS (never replaces — GOTCHA #7) a short reminder to that result's content telling the agent
 * `mulligan_shrink`/`mulligan_rewind` are available, AND records a bloat hit ({toolName, approxTokens})
 * into rt.pendingBloatHits so the per-turn drift nudge (Nudge B, P1.M6.T2.S1) can aggregate it. It skips
 * Mulligan's own mulligan_* tools. The reminder RIDE the result — ZERO extra model requests (D3/D4).
 *
 * NEVER throws (spec/03 #4, spec/08 E13): the ENTIRE body is ONE try/catch → log + return nothing
 * (pass-through). An extension bug can NEVER break a tool result. Read sessionId FIRST inside the try{}
 * so the catch{} can log it (GOTCHA #1). SYNC (ExtensionHandler permits R | void; zero awaits — GOTCHA #11).
 *
 * PREREQUISITE (all shipped, verified): resultBytes + approxTokens (tokens.ts P1.M2.T1.S2),
 * renderBloatReminder (notes.ts P1.M2.T3.S3), getRuntime + BloatHit + SessionRuntime.pendingBloatHits
 * (runtime.ts P1.M1.T4.S1), getConfig (config.ts P1.M1.T2), log (log.ts P1.M1.T3). NO dependency on
 * filter.ts (P1.M4.T2.S1) — nudges.ts is a fresh module.
 */
import type {
  ToolResultEvent,
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import { log } from "./log.js";
import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";
import type { ResultContentBlock } from "./tokens.js";
import { renderBloatReminder } from "./notes.js";
import { appendTurnMetric, type TurnMetricInput } from "./markers.js";

/**
 * ToolResultContentBlock — the element type of `ToolResultEvent["content"]` (TextContent | ImageContent). Pi's
 * `TextContent`/`ImageContent` are NOT re-exported at the package root, so the indexed-access type names them
 * without importing them (GOTCHA #2). The handler's appended reminder block and its returned `content` array
 * are typed off this so NO unexported symbol is ever named.
 */
type ToolResultContentBlock = ToolResultEvent["content"][number];

/**
 * BloatReminderResult — the return shape of bloatReminderHandler. STRUCTURALLY IDENTICAL to Pi's own
 * `ToolResultEventResult` (`{ content?: (TextContent|ImageContent)[]; details?; isError?; usage? }`), which is
 * exported from Pi's core/extensions/types but NOT re-exported at the package root. Mirrors the filter.ts
 * `ContextEventResult` technique (define the result type locally, structurally identical, so the
 * `pi.on("tool_result", handler)` overload resolves cleanly). `content`'s element type is derived from
 * `ToolResultEvent["content"][number]` so it tracks Pi's exact block type with no hand-naming.
 */
interface BloatReminderResult {
  content?: ToolResultContentBlock[];
  details?: unknown;
  isError?: boolean;
}

/**
 * bloatReminderHandler — Nudge A (spec/07 §1). Fires after every tool execution; if the result's
 * in-context byte size exceeds config.nudges.bloatThresholdBytes, APPENDS a short reminder to the
 * result's content (advisory; the agent may need the data now) and records a bloat hit for the per-turn
 * drift nudge (Nudge B). Skips mulligan_* tools. Rides the result — zero extra requests (D3/D4).
 *
 * NEVER throws (spec/03 #4, spec/08 E13): the WHOLE body is ONE try/catch → log + return nothing
 * (pass-through). Read sessionId FIRST so the catch can log it. SYNC (ExtensionHandler permits R|void).
 *
 * @param event the tool_result event ({type, toolCallId, input, content, isError, toolName}).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12).
 * @returns `{ content: [...original, {type:"text", text:reminder}] }` when over threshold; undefined otherwise.
 */
export function bloatReminderHandler(
  event: ToolResultEvent,
  ctx: ExtensionContext,
): BloatReminderResult | void {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first, so the catch can log it
    const config = getConfig();
    // GOTCHA #8: BOTH gates short-circuit BEFORE any measurement/recording (Nudge B must never fire on
    // bloat when Nudge A is off).
    if (!config.enabled || !config.nudges.bloatReminder) return;

    if (event.toolName.startsWith("mulligan_")) return; // skip our own tools (GOTCHA #3)

    // tokens.ts's ResultContentBlock is BROADER than Pi's (TextContent|ImageContent) (it has an index
    // signature); the narrow Pi type does not assign in to the broader one without a cast. Cast through
    // unknown at this single boundary — mirrors filter.ts's MessageLike boundary (never throws either way).
    const bytes = resultBytes(event.content as unknown as ResultContentBlock[]);
    const threshold = config.nudges.bloatThresholdBytes;
    if (bytes < threshold) return; // under threshold → pass-through, NO recording

    const reminder = renderBloatReminder(event.toolName, bytes, threshold);
    // GOTCHA #2: TextContent|ImageContent are NOT re-exported by the pi package → use the indexed-access
    // type ToolResultEvent["content"][number]. APPEND, never replace (GOTCHA #7) — original blocks preserved.
    const block: ToolResultContentBlock = { type: "text", text: reminder };
    const content: ToolResultContentBlock[] = [...event.content, block];

    // GOTCHA #4: recordBloatHit is PSEUDOCODE (spec/07 §1) — "record a bloat hit" = inline push. DO NOT
    // clear pendingBloatHits here; it accumulates across the turn and is read+cleared by Nudge B (turn_end).
    const rt = getRuntime(sessionId);
    rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) });

    return { content };
  } catch (e) {
    // FAIL-OPEN (spec/03 #4, spec/08 E13): log + return nothing (the result is delivered UNCHANGED).
    // GOTCHA #1: log() takes sessionId: string, NOT ctx (spec/07 §1 pseudocode passing ctx is WRONG here).
    try {
      log("error", "nudge.bloat", sessionId, { error: String(e) });
    } catch {
      /* log() never throws, but be safe */
    }
    // fall through → return undefined (pass-through)
  }
}

/**
 * registerBloatReminder — arm Nudge A. index.ts (P1.M7.T1.S1) calls this once at startup:
 *   `registerBloatReminder(pi);  // arm Nudge A`
 * P1.M6.T2.S1 (turn_end metric) + P1.M6.T2.S2 (shouldNudge/injectNudge) APPEND to this module later.
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerBloatReminder(pi: ExtensionAPI): void {
  pi.on("tool_result", bloatReminderHandler);
}

/**
 * turnEndMetricHandler — Nudge B Phase 1 (spec/07 §2). Fires at the end of every turn; measures how much the
 * FILTERED context grew this turn (delta vs the in-memory tokenBaseline), snapshots the bloat hits collected by
 * bloatReminderHandler (Nudge A) into a persisted turn-metric CustomEntry, clears the bloat accumulator, and
 * rolls the baseline forward. Rides the turn_end notification — zero extra model requests (D3/D4).
 *
 * The metric is INTERNAL TELEMETRY: a `custom` entry (NOT in LLM context). Only the LATEST one is read by the
 * filter's drift-nudge injection (P1.M6.T2.S2); older ones persist on disk but are ignored.
 *
 * NEVER throws (spec/03 #4, spec/08 E13): the WHOLE body is ONE try/catch → log + return (the turn is never
 * broken). Read sessionId FIRST so the catch can log it. deltaTokens is null on the first turn / post-reload
 * (baseline missing) → the downstream nudge falls back to bloat-only signaling. SYNC (every dependency is sync).
 *
 * WHY pi is a parameter (GOTCHA #2): the turn_end callback only receives (event, ctx), but this handler must
 * call appendTurnMetric(pi, ctx, …) (→ pi.appendEntry). registerTurnEndMetric captures pi in a closure and
 * passes it here, so the exported handler is directly testable with a fake pi.
 *
 * @param pi    the Pi ExtensionAPI (appendTurnMetric → pi.appendEntry lives here).
 * @param event { type:"turn_end"; turnIndex; message; toolResults } — NO messages field (api_verification §7.3).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12; getContextUsage fallback).
 * @returns void (turn_end is a notification event).
 */
export function turnEndMetricHandler(
  pi: ExtensionAPI,
  event: TurnEndEvent,
  ctx: ExtensionContext,
): void {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it (GOTCHA #4)

    const config = getConfig();
    if (!config.enabled || !config.nudges.perTurnDrift) return; // both gates BEFORE measurement (GOTCHA #8)

    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)

    // (3) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw
    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet
    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),
    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).
    const now = rt.lastFiltered
      ? estimateTokens(rt.lastFiltered).tokens
      : (ctx.getContextUsage()?.tokens ?? 0);

    // (4) Delta vs the baseline captured at the previous turn_end (or session_start). null on first turn.
    const delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline;

    // (5) Snapshot + CLEAR the bloat hits collected this turn by bloatReminderHandler (Nudge A). Grab the OLD
    //     array reference (the metric's frozen snapshot), then REASSIGN the field to a fresh [] for next turn.
    const bloat = rt.pendingBloatHits;
    rt.pendingBloatHits = [];

    // (6) Build TurnMetricInput — the 5 DATA fields ONLY (GOTCHA #1: appendTurnMetric stamps schema/v/kind/seq/ts;
    //     do NOT call nextSeq or add seq — it would double-increment). grewOverThreshold uses driftThresholdTokens.
    const metric: TurnMetricInput = {
      deltaTokens: delta,
      bloatHit: bloat.length > 0,
      bloatHits: bloat,
      grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens,
      turnIndex: event.turnIndex,
    };

    // (7) Persist the turn-metric CustomEntry (NOT in LLM context). appendTurnMetric stamps the envelope + seq +
    //     ts and never throws (returns null on failure — acceptable; missing one metric is non-fatal).
    appendTurnMetric(pi, ctx, metric);

    // (8) Roll the baseline forward + record the turn index. UNCONDITIONAL in the happy path (appendTurnMetric
    //     never throws, so we always reach here). A throw EARLIER skips this → baseline untouched → delta retries
    //     next turn (correct). NOT in the catch path.
    rt.tokenBaseline = now;
    rt.lastTurnIndex = event.turnIndex;
  } catch (e) {
    log("error", "nudge.turn_end", sessionId, { error: String(e) }); // GOTCHA #4: sessionId, NOT ctx
    // fail-open: return nothing (the turn is unaffected)
  }
}

/**
 * registerTurnEndMetric — arm Nudge B Phase 1. index.ts (P1.M7.T1.S1) calls this once at startup.
 * The closure CAPTURES `pi` (GOTCHA #2): the turn_end callback only receives (event, ctx), but the handler
 * needs pi for appendTurnMetric. P1.M6.T2.S2 (shouldNudge/injectNudge — Phase 2, in filter.ts) READS the metric
 * this handler writes; it does NOT live in this module.
 *
 * @param pi the Pi ExtensionAPI (on() lives here).
 */
export function registerTurnEndMetric(pi: ExtensionAPI): void {
  pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext): void => {
    turnEndMetricHandler(pi, event, ctx);
  });
}