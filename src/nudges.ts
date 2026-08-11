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
 * in-context byte size exceeds config.nudges.bloatThresholdBytes (default 16384 ≈ 4k tokens), the handler
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
import type { MulliganConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import type { SessionRuntime } from "./runtime.js";
import { log } from "./log.js";
import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";
import type { ResultContentBlock } from "./tokens.js";
import { renderBloatReminder, renderDriftNudge } from "./notes.js";
import {
  appendTurnMetric,
  type TurnMetricInput,
  type TurnMetric,
  type RewindMarker,
  type ShrinkMarker,
} from "./markers.js";
import type { MessageLike } from "./transforms.js";

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
 * bloatThresholdFor — resolve Nudge A's bloat threshold per tool (spec/07 §1). PURE: two reads, no I/O,
 * no Pi runtime (so it is unit-testable directly). Priority: if toolName is in
 * config.nudges.bloatThresholdBytesByTool, use that entry; otherwise fall back to the global
 * config.nudges.bloatThresholdBytes. A falsy toolName (undefined / "") also returns the global.
 *
 * `?? {}` is a defensive fallback for a hand-built MulliganConfig: the interface field is optional
 * (`?:`), but validateConfig guarantees it is always a valid Record<string, number> after validation
 * (S2). The lookup is OWN-PROPERTY-guarded: `Object.prototype.hasOwnProperty.call(byTool, toolName)`
 * is used (NOT bare `byTool[toolName] ?? global`), because a bare index read returns INHERITED
 * Object.prototype members (constructor/toString/valueOf/...) as non-null values that `??` would
 * pass through instead of falling back to the global. The own-property guard means a tool whose
 * name collides with a prototype member correctly resolves to the global threshold (BUG-001 fix).
 * `Object.prototype.hasOwnProperty.call` is used rather than `byTool.hasOwnProperty(...)` so an
 * adversarial own key named "hasOwnProperty" cannot shadow the method.
 */
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;
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
    const threshold = bloatThresholdFor(event.toolName, config);
    if (bytes < threshold) return; // under threshold → pass-through, NO recording

    const reminder = renderBloatReminder(event.toolName, bytes);
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

/**
 * shouldNudge — Nudge B Phase 2 gate (spec/07 §2; spec/07 §5.1 Windowed drift signaling, REQUIRED). PURE boolean
 * (no Pi calls, no tokenization). Fires the drift nudge iff the per-turn token delta, SMOOTHED over a rolling
 * window of the last `config.nudges.driftWindowTurns` turns, exceeds `config.nudges.driftThresholdTokens`
 * (DELTA-ONLY when delta data exists). bloatHit is NOT a firing condition when delta data exists — it is a
 * FALLBACK ONLY when no window metric has a usable delta (first turn / post-reload).
 *
 * ALGORITHM — moving average (spec/07 §5.1 "moving-average, or M-of-N"; the item contract + architecture
 * implementation_patterns.md Pattern 8 both RECOMMEND moving average). The window is the first `driftWindowTurns`
 * entries of `recentMetrics` (P3.M3.T3.S1 sorts them NEWEST-FIRST — highest seq at index 0). From that window we
 * collect the `deltaTokens` values that are finite numbers (null/non-number/NaN/±Infinity deltas — first turn /
 * post-reload / a malformed cast — are dropped). If NO window metric has a usable delta, the delta path is skipped
 * and we fall back to the bloat path ALONE (first turn / post-reload — the ONLY path on which bloatHit fires the
 * drift nudge). Otherwise the AVERAGE of the window's usable deltas is compared (strictly greater) to
 * `driftThresholdTokens`, and the result is DELTA-ONLY — bloat is NOT OR'd into this path.
 *
 * WHY bloatHit is demoted (P4.M2.T1.S1 / spec/07 §5.1, §2 Edge cases): the earlier `|| bloatHit` arm fired the
 * drift nudge on ANY single large tool result — redundant with Nudge A (already co-located on that result) and a
 * known stuck-turn-loop amplifier (it produced the live-observed `~0k tokens / N bloated results`
 * self-contradiction: a near-zero-net-growth turn with one big result fired the drift nudge). With bloatHit removed
 * from the delta-available path, a ~0-net-growth turn does NOT fire regardless of how big a result it held.
 * bloatHit survives ONLY in the no-delta fallback so a bloated result on turn 1 (before any baseline exists) still
 * nudges.
 *
 * SPEC-AMBIGUITY RESOLUTION (architecture implementation_patterns.md Pattern 8): spec/07 §5.1 gives two acceptance
 * criteria — (1) a single 8k-token turn amid small turns does NOT fire; (2) three ~4k turns in a row DO — and
 * offers "moving-average, OR M-of-N" with threshold 6000, window 3. Neither pure algorithm satisfies BOTH literally
 * at threshold 6000: moving-average [8k,0.5k,0.5k]=3k<6k→no fire ✓ but [4k,4k,4k]=4k<6k→no fire ✗; sum
 * [8k,0.5k,0.5k]=9k>6k→fire ✗ but [4k,4k,4k]=12k>6k→fire ✓. The PRIMARY intent of §5.1 (and the reason it exists)
 * is to SUPPRESS SINGLE SPIKES — a single heavy turn is routinely legitimate (reading files, pasting docs). Moving
 * average is the algorithm that satisfies that primary intent (criterion 1). Criterion 2 ("three ~4k turns fire")
 * is ILLUSTRATIVE of "sustained growth fires"; with the §5.1-windowing-justified raised threshold of 6000
 * (config.ts: "the §5.1 windowing makes 6000 a quiet, accurate trip point"), three 4k turns averaging 4k correctly
 * do NOT fire — sustained growth whose windowed AVERAGE exceeds 6000 (e.g. three ~7k turns) DOES. Chosen algorithm:
 * MOVING AVERAGE vs threshold, DELTA-ONLY (bloat demoted to the no-delta fallback per P4.M2.T1.S1 / spec/07 §5.1).
 * (Matches the item contract + Pattern 8 FINAL ANSWER, updated for the bloat demotion.)
 *
 * The bloat fallback uses `=== true` (not truthy) so a malformed metric — readMarkers casts raw session data, so
 * `bloatHit` could be undefined/non-boolean — fails safe to "no bloat". Delta values are guarded with
 * `typeof === "number" && Number.isFinite(d)` so a malformed `deltaTokens` (string/NaN/Infinity) is dropped rather
 * than poisoning the average with NaN. An empty window (no metrics) → no usable deltas → bloat fallback over an
 * empty window → false (no nudge).
 *
 * `grewOverThreshold` (the per-turn precomputation from turnEndMetricHandler) is NOT consulted here — the windowed
 * average replaces the single-turn comparison. It is still computed and persisted by turnEndMetricHandler (for
 * audit/back-compat) but is deliberately unused by this gate.
 *
 * @param recentMetrics ALL mulligan:turn-metric entries on the branch, sorted NEWEST-FIRST
 *                       (MarkersBundle.recentMetrics from P3.M3.T3.S1). This function slices the first
 *                       `driftWindowTurns` itself; the caller passes the full array.
 * @param config        the MulliganConfig (reads nudges.driftWindowTurns + nudges.driftThresholdTokens).
 * @returns true iff the windowed moving-average delta > driftThresholdTokens (delta-only when delta data exists);
 *          bloatHit is a fallback ONLY when no window metric has a usable delta (first turn / post-reload).
 */
export function shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean {
  const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);
  const deltas = window
    .map((m) => m.deltaTokens)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (deltas.length === 0) return window.some((m) => m.bloatHit === true);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return avg > config.nudges.driftThresholdTokens;
}

/**
 * injectNudge — Nudge B Phase 2 injection (spec/07 §2 "Phase 2: inject at next context fire"). PURE: composes the
 * one-line annotation via the already-shipped renderDriftNudge (P1.M2.T3.S3 — handles deltaTokens===null first-turn
 * + bloat-only cases) and appends it as an EPHEMERAL mulligan:nudge CustomMessage to a NEW copy of messages. NEVER
 * calls pi.sendMessage — the nudge lives ONLY in the returned copy, which is what the model sees THIS inference; Pi
 * persists the ORIGINAL branch untouched. Each context fire gets a FRESH deep copy from Pi → the nudge is recomputed
 * from the latest metric each fire and REPLACES (never stacks with) the previous (nothing persists to stack).
 *
 * WHY MessageLike[] not AgentMessage[] (GOTCHA #3): the filter.ts call site is
 * `messages = injectNudge(messages, markers.metric)` where `messages` is MessageLike[] (filterPipeline's return;
 * the cast to Pi's AgentMessage[] happens at contextHandler's RETURN boundary). AgentMessage[] would not type-check
 * at the assignment. MessageLike (transforms.ts) has an index signature → the nudge object literal assigns in with
 * NO cast (GOTCHA #4). renderDriftNudge takes the TurnMetric with NO cast (a real TurnMetric is structurally
 * assignable to DriftNudgeInput — GOTCHA #5).
 *
 * @param messages the filtered message copy (MessageLike[] — the in-flight view the model will see).
 * @param metric   the latest turn-metric (shouldNudge(metric) is already true when this is called).
 * @returns a NEW array: [...messages, nudge]. The input is NOT mutated.
 */
export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[] {
  const line = renderDriftNudge(metric); // TurnMetric → DriftNudgeInput, no cast (GOTCHA #5)
  const nudge: MessageLike = {
    role: "custom",
    customType: "mulligan:nudge",
    content: line,
    display: false,
    details: { ephemeral: true, turnIndex: metric.turnIndex },
    timestamp: Date.now(),
  };
  return [...messages, nudge];
}

/**
 * suppressCheck — Nudge B Phase 2 suppress gate, implementing spec/07 §5.3 (REQUIRED, hard rule): the drift nudge
 * MUST NOT fire for a turn in which the agent already issued a mulligan:rewind or mulligan:shrink that addressed
 * the bloat/drift the nudge would describe — REGARDLESS of delta or bloatHit. PURE: returns true (suppress the
 * nudge) iff ANY rewind or shrink marker was created DURING the metric's turn, i.e. some marker.ts falls in the
 * half-open turn window (lo, metric.ts], where lo is the PREVIOUS metric's ts (recentMetrics[1]). Returns false
 * otherwise (no markers / all markers from earlier turns / marker ts in the future). Call site (filter.ts): the
 * nudge fires iff `shouldNudge(recentMetrics, config) && !suppressCheck(markers.metric, markers.recentMetrics,
 * markers)` — suppressCheck is the §5.3 gate AFTER shouldNudge (§5.1), composing with the E22 refusal-suppression rule.
 *
 * TURN-BOUNDARY LOWER BOUND (replaces the old 10-min wall-clock window — BUG-001 fix): the lower bound `lo` is the
 * PREVIOUS metric's ts (recentMetrics[1], now available via readMarkers' recentMetrics). This bounds "this turn"
 * exactly — a marker created during the PREVIOUS turn (ts <= prevMetric.ts) does NOT suppress a later turn. The
 * old code used `metricTs - NUDGE_TURN_WINDOW_MS` (a fixed 10-minute wall-clock window), which over-suppressed for
 * ~10 minutes after any single marker — exactly the window where sustained context growth is most likely and the
 * nudge is most valuable. First turn (recentMetrics.length < 2) OR a non-finite previous-metric ts → lo=0 (any
 * marker with ts <= metric.ts was created during this first turn → suppress). Read ts defensively; a non-finite
 * marker ts → treated as NOT in window (no suppress → fail to nudge, the safe direction for an advisory nudge).
 *
 * WHY a structural markers param (GOTCHA #6): filter.ts imports these functions from nudges.ts, so nudges.ts must
 * NOT import MarkersBundle from filter.ts (circular). The param is `{ rewinds: ReadonlyArray<RewindMarker>;
 * shrinks: ReadonlyArray<ShrinkMarker> }`; filter.ts's MarkersBundle is structurally assignable (the extra `metric`
 * field is ignored for assignability-to-param). Call site: `suppressCheck(markers.metric, markers.recentMetrics, markers)`.
 *
 * @param metric        the latest turn-metric (recentMetrics[0]; bounds the window's upper end).
 * @param recentMetrics ALL turn-metrics, newest-first ([0]=latest=metric, [1]=previous). The previous metric's ts
 *                      bounds the turn's lower end; <2 entries → first-turn (lo=0).
 * @param markers       { rewinds, shrinks } — the persisted rewind/shrink markers on the branch (MarkersBundle shape).
 * @returns true iff some marker.ts ∈ (lo, metric.ts] where lo = recentMetrics[1].ts (or 0 on first turn).
 */
export function suppressCheck(
  metric: TurnMetric,
  recentMetrics: TurnMetric[],
  markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> },
): boolean {
  const metricTs = typeof metric.ts === "number" && Number.isFinite(metric.ts) ? metric.ts : 0;
  // Turn-boundary lower bound (spec/07 §5.3): a marker suppresses iff created DURING this turn,
  // bounded below by the PREVIOUS metric's ts. recentMetrics is newest-first: [0]=latest(=metric),
  // [1]=previous. <2 entries (first turn) OR a non-finite previous ts → lo=0 (any marker with
  // ts <= metric.ts was created during this turn → suppress). Replaces the old 10-min wall-clock window (BUG-001).
  const prev = recentMetrics.length >= 2 ? recentMetrics[1] : undefined;
  const lo =
    prev && typeof prev.ts === "number" && Number.isFinite(prev.ts) ? prev.ts : 0;
  for (const m of markers.rewinds) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  for (const m of markers.shrinks) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  return false;
}

/**
 * shouldHighWater — §5.2 edge-triggered high-water gate (spec/07-preventive-and-nudges.md §5.2, REQUIRED). Returns
 * true iff the TOTAL filtered context just crossed above `config.nudges.highWaterFraction` of the window, EDGE-
 * TRIGGERED (fires once on the upward crossing, not every turn while above).
 *
 * STATUS — PURE EXCEPT it MUTATES `rt.aboveHighWater` (the edge-trigger latch that lives in the session runtime).
 * This is intentional (spec/07 §5.2: "tracked via rt.aboveHighWater — set true when the annotation fires, cleared
 * only when the total drops back below the fraction"). The other two high-water helpers (renderHighWaterNudge,
 * injectHighWaterNudge) ARE purely functional; only this gate carries the latch.
 *
 * ALGORITHM (architecture implementation_patterns.md Pattern 9):
 *   1. windowTokens <= 0 → return false (fail-open — E12: ctx.getContextUsage() undefined / no model / pre-first-
 *      inference → contextWindow 0). Do NOT mutate rt.aboveHighWater on this path (failing open must not clobber a
 *      real "above" state nor falsely arm a re-fire).
 *   2. fraction = totalFilteredTokens / windowTokens.
 *   3. fraction >= highWaterFraction → if the latch was false, set it true and return true (first upward crossing
 *      fires); else return false (already above → edge-triggered, no re-fire).
 *   4. fraction < highWaterFraction → set the latch false (cleared on dropping below, re-arming for the next
 *      crossing) and return false.
 *
 * The `>=` (not `>`) means a total at EXACTLY the fraction (e.g. 140000/200000 = 0.7) fires.
 *
 * INPUTS (computed by the CALLER — contextHandler, P3.M3.T6.S1):
 *   - totalFilteredTokens = estimateTokens(filteredMessages).tokens — the FILTERED view (D5: NEVER
 *     ctx.getContextUsage().tokens, which counts hidden/rewound tokens). This is the same filtered total
 *     mulligan_audit reports.
 *   - windowTokens = ctx.getContextUsage()?.contextWindow ?? 0 — the model's context window size.
 * This function does NOT tokenize, does NOT call getContextUsage, does NOT call getRuntime — all inputs are passed
 * in, keeping it a cheap, deterministic, unit-testable gate.
 *
 * @param totalFilteredTokens the filtered-view token total (estimateTokens(messages).tokens).
 * @param windowTokens        the model's context window size (getContextUsage()?.contextWindow).
 * @param rt                  the live per-session runtime (aboveHighWater is mutated in place as the latch).
 * @param config              the MulliganConfig (reads nudges.highWaterFraction).
 * @returns true iff the total just crossed above the fraction this turn (the annotation should fire once).
 */
export function shouldHighWater(
  totalFilteredTokens: number,
  windowTokens: number,
  rt: SessionRuntime,
  config: MulliganConfig,
): boolean {
  if (windowTokens <= 0) return false; // fail-open (E12); do NOT touch rt.aboveHighWater
  const fraction = totalFilteredTokens / windowTokens;
  if (fraction >= config.nudges.highWaterFraction) {
    if (!rt.aboveHighWater) {
      rt.aboveHighWater = true; // latch: first upward crossing fires
      return true;
    }
    return false; // already above → edge-triggered, do NOT re-fire
  }
  rt.aboveHighWater = false; // dropped below → clear the latch (re-arm for next crossing)
  return false;
}

/**
 * renderHighWaterNudge — §5.2 high-water one-line annotation (spec/07-preventive-and-nudges.md §5.2, REQUIRED).
 * PURE, never throws. Composes the single-line annotation in the renderDriftNudge style (notes.ts): leading
 * "[mulligan] " prefix, recommends mulligan_shrink/mulligan_rewind, NO trailing newline, ~25–40 tokens. The text
 * format is PINNED by the item contract:
 *   `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
 * where `<pct>` = `Math.round((totalFilteredTokens / windowTokens) * 100)` (round, not floor/trunc — the contract
 * example "~70%" for 0.7 needs Math.round(0.7*100)=70).
 *
 * DEFENSIVE (mirrors renderDriftNudge/renderBloatReminder's never-throws discipline — spec/07 §2/§1, E13):
 * `windowTokens <= 0` cannot compute a percentage, so it returns a FALLBACK line WITHOUT a percentage (never let
 * NaN%/Infinity% leak). shouldHighWater short-circuits this case in prod, but this renderer is EXPORTED + directly
 * callable/testable, so it must be TOTAL on its own.
 *
 * @param totalFilteredTokens the filtered-view token total (for the percentage numerator).
 * @param windowTokens        the model's context window size (the percentage denominator).
 * @returns the one-line annotation string (or a percentage-free fallback when windowTokens <= 0).
 */
export function renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string {
  if (!(windowTokens > 0)) {
    // Defensive: can't compute a percentage. shouldHighWater short-circuits this in prod, but this renderer is
    // exported + directly callable — never let NaN/Infinity% leak. Fail to a percentage-free line (mirrors
    // renderDriftNudge/renderBloatReminder's never-throws discipline — spec/07 §2/§1, E13).
    return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";
  }
  const pct = Math.round((totalFilteredTokens / windowTokens) * 100);
  return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;
}

/**
 * injectHighWaterNudge — §5.2 high-water injection (spec/07-preventive-and-nudges.md §5.2, REQUIRED). Mirrors
 * injectNudge: PURE — returns a NEW array `[...messages, nudge]` with an EPHEMERAL `mulligan:high-water`
 * CustomMessage appended; the input is NOT mutated. NEVER calls pi.sendMessage — the nudge lives ONLY in the
 * returned copy, which is what the model sees THIS inference; Pi persists the ORIGINAL branch untouched (zero
 * persistence — each context fire gets a fresh deep copy from Pi so the annotation is recomputed/replaced, never
 * stacked). Rides the context inference — D4 zero extra model requests.
 *
 * WHY MessageLike[] not AgentMessage[] (mirrors injectNudge GOTCHA #3): the filter.ts call site is
 * `messages = injectHighWaterNudge(messages, totalFilteredTokens, windowTokens)` where `messages` is
 * MessageLike[] (filterPipeline's return). MessageLike (transforms.ts) has an index signature → the nudge object
 * literal assigns in with NO cast (same as injectNudge).
 *
 * WHY a DISTINCT customType "mulligan:high-water" (not "mulligan:nudge"): the drift nudge (§5.1, per-turn delta)
 * and the high-water nudge (§5.2, absolute total level) serve different purposes and must be individually
 * detectable by mulligan-aware code via the customType.startsWith("mulligan:") check (transforms.ts
 * isMulliganCustom) for any future dedup/audit logic.
 *
 * Called by contextHandler (P3.M3.T6.S1) ONLY when shouldHighWater returned true.
 *
 * @param messages             the filtered message copy (MessageLike[] — the in-flight view the model will see).
 * @param totalFilteredTokens  the filtered-view token total (rendered into the annotation + recorded in details).
 * @param windowTokens         the model's context window size (rendered into the annotation + recorded in details).
 * @returns a NEW array: [...messages, nudge]. The input is NOT mutated.
 */
export function injectHighWaterNudge(
  messages: MessageLike[],
  totalFilteredTokens: number,
  windowTokens: number,
): MessageLike[] {
  const line = renderHighWaterNudge(totalFilteredTokens, windowTokens);
  const nudge: MessageLike = {
    role: "custom",
    customType: "mulligan:high-water",
    content: line,
    display: false,
    details: { ephemeral: true, totalFilteredTokens, windowTokens },
    timestamp: Date.now(),
  };
  return [...messages, nudge];
}