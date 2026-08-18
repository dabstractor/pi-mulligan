/**
 * shrink.ts — the `mulligan_shrink` agent-callable tool (spec/05 §2; spec/04 §4; spec/06 §5).
 *
 * SECOND of the four Mulligan agent-callable tools (P1.M5.T2.S1). It is the sole writer of the
 * `mulligan:shrink` marker (soft substitution). When a past tool result (or message) is too bloated
 * to keep carrying verbatim but too useful to delete, the agent calls this tool with a matcher-based
 * `target` and a compact `replacement`. The tool validates, does a best-effort read-only match for
 * immediate yes/no feedback, persists the shrink marker, and returns the feedback text. The
 * AUTHORITATIVE substitution happens in the `context` filter on the NEXT inference (spec/06 §5) — this
 * tool only records the spec (D7 — record a spec, not content).
 *
 * DESIGN (read the gotchas + the PRP):
 * - Thin, typebox-schema'd, validation-owning adapter on top of `appendShrinkMarker` (src/markers.ts,
 *   P1.M4.T1.S1 — ALREADY shipped & unit-tested). This tool does NOT reimplement `pi.appendEntry`, the
 *   envelope/seq/leaf capture, or matching (`resolveShrinkTarget`, src/transforms.ts — P1.M3.T4.S2) —
 *   it delegates persistence to the marker wrapper and resolution to the pure resolver.
 * - The TOOL owns: config gate (config.shrink.enabled — E14), replacement-non-empty validation,
 *   structural-target-validity validation (the ONE design judgment — refuse ONLY a discriminator that
 *   can provably never match; GOTCHA #7), the best-effort yes/no match (advisory, never blocks —
 *   GOTCHA #6), the persisted payload, and the success/refusal text.
 * - The tool is WRITE-ONLY w.r.t. the message list: it NEVER receives/transforms `event.messages`
 *   (it is not the context event). It builds a SNAPSHOT via
 *   `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)` for the ADVISORY
 *   match. If that snapshot/resolution fails, it falls back to matched:false + STILL persists (the
 *   marker spec is what matters; E13/E8 — never let an advisory computation block a legitimate shrink).
 * - CRITICAL GOTCHA #1 (vs the sibling rewind tool): NO cast, NO note, NO extras. ShrinkMarkerInput in
 *   src/markers.ts (FROZEN, spec/04 §4) is EXACTLY `{ target, replacement, reason? }` — there is NO
 *   field gap (unlike rewind's checkpoint gotcha). The tool builds
 *   `{ target, replacement, reason }` and passes it DIRECTLY to appendShrinkMarker — NO cast, NO extra
 *   field, NO leaveNote call. Do NOT cargo-cult rewind's leaveNote/renderNote/validateNote/ledger
 *   machinery — shrink has none of it.
 * - Shared tool convention (spec/05 "Shared tool conventions"): the execute body is fail-open to text —
 *   it NEVER throws (E13). The whole body is wrapped in ONE try/catch → text result on any exception.
 * - CRITICAL GOTCHA #4: every `AgentToolResult<T>` return path includes a `details` field (spec/05 §2's
 *   `{ content:[...] }`-only return shape is a SIMPLIFICATION — `details` is REQUIRED by the Pi type;
 *   this file is strict-typechecked by tsconfig). We use a small structured object (`{ matched?,
 *   markerId? }`) surfaced to logs/audit/UI on every path.
 * - `pi` (ExtensionAPI) is NOT passed to execute() — it is captured via the `makeShrinkTool(pi)`
 *   factory closure (the checkpoint.ts precedent; no module-scoped mutable state). index.ts
 *   (P1.M7.T1.S1) does `pi.registerTool(makeShrinkTool(pi))`.
 *
 * This item does NOT modify src/index.ts (wiring is P1.M7.T1.S1), src/filter.ts (P1.M4.T2 runs in
 * parallel — this tool WRITES the markers the filter READS), or markers.ts/transforms.ts/config.ts
 * (frozen, consumed).
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  sessionEntryToContextMessages,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { appendShrinkMarker } from "../markers.js"; // GOTCHA #9: .js extension (ESM/Bundler resolution); GOTCHA #1: NO cast
import type { ShrinkMarkerInput } from "../markers.js";
import { currentTurnSpan, resolveShrinkTarget } from "../transforms.js"; // Pi-free (0 imports) — no circular dep
import type { ShrinkTarget } from "../transforms.js"; // structurally identical to markers.ts ShrinkTarget
import type { MessageLike } from "../transforms.js";
import { getConfig } from "../config.js"; // GOTCHA #10: read ONCE per execute
import { estimateTokens } from "../tokens.js"; // pure Pi-free estimator (chars/4 heuristic) — feeds BOTH the orientation line ~<t> and the rewrite-budget shed estimate
import type { MessageLike as EstMessageLike } from "../tokens.js"; // tokens.ts structural flavor (same cast idiom as below)
import { prepareObjectArgs } from "../prepare-args.js"; // string-encoded `target` coercion (host edit.js precedent)

import { getRuntime } from "../runtime.js"; // [v2] per-session rewrite-budget state
import type { SessionRuntime } from "../runtime.js";
import { submitRewrite } from "../rewrite-budget.js"; // [v2] moment-capped queueing (queue-first, flush on triggers)

// ── Parameter schema (spec/05 §2 — Typebox, VERBATIM incl. the 2-arm target union + descriptions) ────

/**
 * ShrinkParams — the typebox parameter schema for `mulligan_shrink` (spec/05 §2, verbatim incl. every
 * field description — the LLM reads them). `Static<typeof ShrinkParams>` === `ShrinkMarkerInput` ===
 * `{ target: ShrinkTarget; replacement: string; reason?: string }` (the shared contract with the
 * filter — spec/04 §4). EXPORTED for tests + the index.ts wiring step.
 *
 * The `target` union is the v2.0 TWO-arm form (parity with `ShrinkTarget` in src/transforms.ts —
 * PRD §2; the legacy content-substring arm was removed in P1.M2.T1.S1):
 *   - by_tool_call_id         — unique; resolves to the current-turn toolResult with that toolCallId.
 *   - by_tool_name+occurrence — semantic; the last (default) or first current-turn toolResult with that toolName.
 */
export const ShrinkParams = Type.Object({
  target: Type.Union(
    [
      Type.Object({
        by_tool_call_id: Type.String({
          description: "The toolCallId of the result to shrink — must be a call from the CURRENT turn.",
        }),
      }),
      Type.Object({
        by_tool_name: Type.String({
          description: "e.g. 'read', 'bash' — matches only results from the CURRENT turn",
        }),
        occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")], {
          description: "first/last matching result within the current turn",
        }),
      }),
    ],
    {
      description:
        "How to identify the CURRENT-TURN tool result to shrink. Only results produced this turn are eligible; earlier turns are out of scope. Resolved live each turn (robust to compaction).",
    },
  ),
  replacement: Type.String({
    description:
      "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on.",
  }),
  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});

/** ShrinkArgs — the inferred execute-time params type. EXPORTED for ergonomics/tests. */
export type ShrinkArgs = Static<typeof ShrinkParams>;

// ── The LLM-facing description string (spec/05 §5 — copy VERBATIM) ────────────

/**
 * SHRINK_DESC — the LLM-facing description (Mode A LLM-facing docs). Normative source: PRD §2 purpose
 * text (the spec §5 "Description strings" wording is INTERNALLY STALE — do not copy it). This string
 * IS the tool's documentation: it teaches the current-turn scope + the hard refusal for earlier turns.
 */
export const SHRINK_DESC =
  "Replace the current turn's tool result with a compact summary you provide, in your view, going forward. " +
  "Use when the call was fine but its output is too big to keep carrying. Only results from THIS turn can be " +
  "shrunk — a target from an earlier turn is refused outright. Unlike rewind, the call stays in context " +
  "(just with your summary as its result).";

// ── Result builders (always include `details` — CRITICAL GOTCHA #4) ──────────

/** ShrinkDetails — the structured `details` payload surfaced to logs/audit/UI. Present on every path. */
export interface ShrinkDetails {
  /** Best-effort "does the target match a message right now" result. true/false on the success path;
   *  omitted on refusal (no match attempted). Drives the "(Matched now: yes|no)" feedback + audit correlation. */
  matched?: boolean;
  /** The persisted marker's ENTRY id (appendShrinkMarker's return; null when append threw / no leaf). Success path. */
  markerId?: string | null;
  /** [v1.2] true when the op was QUEUED for batched application (no marker yet — the content stays
   *  visible until a flush activates the whole queue). Present ONLY on the queued path. */
  queued?: boolean;
  /** [v1.2] the flush size when queueing this op IMMEDIATELY crossed the flushShedTokens threshold
   *  (trigger (a)): the batch (incl. this op) activated in the same turn. Present ONLY on that path. */
  flushed?: number;
}

/**
 * refusal — build a fail-open text result for a config-disabled / invalid-replacement /
 * structurally-impossible-target / unexpected-error case. ALWAYS includes `details` (CRITICAL GOTCHA #4).
 * The shared convention prefixes every refusal with "Mulligan: refused — <reason>." so the agent can
 * pattern-match a refusal regardless of the underlying reason (spec/08 E14 framing; checkpoint.ts +
 * rewind.ts precedent). `reason` is emitted WITHOUT a trailing period — the helper adds it.
 */
function refusal(reason: string): AgentToolResult<ShrinkDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }],
    details: {},
  };
}

/**
 * feedbackText — the TERSE success text (P1.M2.T1.S2): just the yes/no outcome, no prose. The full
 * replacement is NOT echoed here (it would bloat the tool result / context); instead the operator gets
 * a capped echo via `ctx.ui.notify` in step (5b) at zero context cost (the model never sees it). The
 * `(Matched: yes|no)` slot reflects the best-effort match from resolveTargetEntryId (advisory; never blocks).
 */
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}.`;
}

/**
 * shrinkOrientationLine — the v1.2 re-orientation guard's FIXED final line, appended as the LAST line of the
 * shrink success tool result (k=1, the single-activation form). EXACT TEXT, do not reword: the bench greps it
 * ("Context updated: <k> result(s) summarized (~<t> tokens shed). Continue exactly where you left off — no
 * re-verification or re-reading is needed."). WHY: an earlier bench campaign found losing sessions averaged
 * +2.4 requests after each rewrite event re-orienting (re-reading files, re-verifying state); one stable,
 * imperative cue at the rewrite point keeps the resumed model on-task. Rewind gets its orientation from the
 * structured note (src/notes.ts — unchanged); shrink has no note, so its cue lives here. EXPORTED so a future
 * BATCHED/FLUSH activation can emit the SAME line ONCE with the AGGREGATE numbers (k = total results flushed, t = total tokens shed) instead of re-inventing a variant.
 *
 * `t` is the NET heuristic estimate (estimateTokens: ~chars/4) of original matched content minus the
 * replacement, floored at 0 — "~" conveys the approximation.
 */
export function shrinkOrientationLine(k: number, tokensShed: number): string {
  return `Context updated: ${k} result(s) summarized (~${tokensShed} tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.`;
}

// ── pure validation + match helpers (module-private; never throw) ────────────

/**
 * cap — clamp a string to `max` chars for operator display, appending an ellipsis + total-length note
 * when truncated (P1.M2.T1.S2 operator echo). Defensive: returns `s` unchanged if it is not a string or is
 * already within the cap. Uses the U+2026 ellipsis (`…`) per spec/05 §2 step 5b formatting.
 */
function cap(s: string, max: number): string {
  if (typeof s !== "string" || s.length <= max) return s;
  return s.slice(0, max) + `…(${s.length} chars total)`;
}

/**
 * describeTarget — a short human-readable label for the shrink target (P1.M2.T1.S2 operator echo).
 * Defensive: returns "message" for a non-record target. Mirrors the two matcher arms from ShrinkParams
 * (v2.0, P1.M2.T1.S2: the legacy content-substring arm is fully gone — schema, resolver, and here).
 */
function describeTarget(target: ShrinkArgs["target"]): string {
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  return "message"; // defensive: unrecognized shape (schema-rejected) — still never throw
}

/**
 * isNonEmpty — true for a non-blank string; false for a blank string or a non-string (defensive — never
 * throws). Used for the replacement AND the target discriminator (GOTCHA #7).
 */
function isNonEmpty(s: unknown): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

/**
 * targetIsStructurallyValid — the "structurally impossible target" operationalization (GOTCHA #7). The
 * ONE design judgment in this tool: refuse ONLY when the target can NEVER match. A target is structurally
 * invalid when its present discriminator (by_tool_call_id / by_tool_name — whichever
 * is a string) is EMPTY or WHITESPACE-ONLY after trim. Verified reasoning against resolveShrinkTarget
 * (transforms.ts) internals:
 *   - by_tool_call_id:"" / by_tool_name:"" → resolveShrinkTarget skips the arm (length>0 check) → null forever.
 * Both are noise → refuse. A NON-empty-but-currently-unmatched target is NOT refused here (the v2.0 §2
 * step 3 hard refusal — "that result is from a previous turn; only this turn's tool calls can be shrunk"
 * — owns that case, AFTER this check). Defensive (non-record target → false; never throws). occurrence is
 * typebox-constrained to "last"|"first"; resolveShrinkTarget defaults non-"first" to "last" → do NOT validate occurrence.
 */
function targetIsStructurallyValid(target: ShrinkArgs["target"] | undefined): boolean {
  if (!target || typeof target !== "object") return false; // non-record → no recognizable discriminator
  if ("by_tool_call_id" in target) return isNonEmpty(target.by_tool_call_id);
  if ("by_tool_name" in target) return isNonEmpty(target.by_tool_name);
  return false; // no recognizable discriminator key (v2.0: legacy content arm removed — P1.M2.T1.S2)
}

/**
 * entryIdAtMessageIndex — map a resolved MESSAGE index back to the STABLE ENTRY id of the entry that produced it
 * (mirrors captureHideEntryIds in rewind.ts, for a SINGLE index). Walks `entries` with a cursor using the SAME
 * `entries.flatMap(sessionEntryToContextMessages)` mapping that built `messages` (resolveTargetEntryId, below), so
 * entry `e` ↔ messages[cursor..cursor+yield) is EXACT BY CONSTRUCTION — no position math. Returns null on no-match /
 * a non-string/empty entry id (defensive). Called inside resolveTargetEntryId's try/catch → null on throw (E13).
 */
function entryIdAtMessageIndex(entries: SessionEntry[], index: number): string | null {
  if (!Array.isArray(entries) || typeof index !== "number" || !Number.isFinite(index) || index < 0) return null;
  let cursor = 0;
  for (const e of entries) {
    const y = sessionEntryToContextMessages(e).length; // typically 1 (message/custom_message/branch_summary)
    if (index < cursor + y) {
      const id = (e as { id?: unknown }).id; // SessionEntryBase.id is a stable string; guard rejects empty/non-string
      return typeof id === "string" && id.length > 0 ? id : null;
    }
    cursor += y;
  }
  return null;
}

/**
 * resolveTargetEntryId — the ADVISORY read-only match that ALSO captures the matched message's STABLE ENTRY id
 * (FINDING 3 fix; supersedes the old boolean bestEffortMatch) and its TOKEN ESTIMATE ([v1.2] — the
 * flush-trigger shed volume; estimation ONLY, it never gates persistence). It builds a SNAPSHOT via
 * `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)` (NOT event.messages — the tool
 * is write-only w.r.t. messages), computes the CURRENT TURN's span (`currentTurnSpan`, transforms.ts), feeds BOTH
 * to the PURE 3-arg resolver `resolveShrinkTarget(messages, target, span)` — v2.0 §2 step 3: the match resolves
 * ONLY within the current turn's span — and — on a match — maps the resolved MESSAGE index back to its ENTRY id
 * via entryIdAtMessageIndex.
 *
 * Return contract (v2.0 §2 step 3 + E13):
 *   - `{ snapshotOk: true, index: <number>, entryId, origTokens }` — IN-SPAN match. `index` is the resolved
 *     message index; `entryId` is the stable ENTRY id (or null when unmappable).
 *   - `{ snapshotOk: true, index: undefined, entryId: null, origTokens: 0 }` — NO match within the current
 *     turn's span (earlier-turn-only match, no match at all, or an empty span). The caller issues the hard
 *     refusal "that result is from a previous turn; only this turn's tool calls can be shrunk".
 *   - `{ snapshotOk: false, entryId: null, origTokens: 0 }` — the snapshot itself THREW (E13 carve-out):
 *     the caller persists with matched:false (never block a legitimate shrink on an advisory computation).
 *
 * The captured ENTRY id becomes the marker's `pinnedEntryId`: at filter time applyShrink resolves it by IDENTITY
 * (resolvePinnedShrink) instead of re-resolving the live selector, so a selector can no
 * longer drift onto later messages as the session grows (the moving-target footgun). The AUTHORITATIVE
 * substitution happens in the filter on the next inference (D7).
 */
function resolveTargetEntryId(
  ctx: ExtensionContext,
  target: ShrinkArgs["target"],
): { entryId: string | null; origTokens: number; index?: number; snapshotOk: boolean } {
  try {
    const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
    // sessionEntryToContextMessages returns Pi's AgentMessage[]; transforms.ts MessageLike is a Pi-free
    // structural type — a real AgentMessage[] assigns in with NO cast (GOTCHA #5, api_verification.md §6.1/§6.3).
    const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
    // v2.0 §2 step 3: bind the match to the CURRENT TURN's span (last role:"user" index + 1 → end). With no
    // user message in the snapshot the span starts at 0 (everything is "this turn"); an empty history gives
    // an empty span → no in-turn match → the caller refuses.
    const span = currentTurnSpan(messages);
    const i = resolveShrinkTarget(messages, target as ShrinkTarget, span); // PURE 3-arg resolver (transforms.ts)
    if (i === null) return { entryId: null, origTokens: 0, snapshotOk: true };
    // v1.2: estimate the matched original's tokens IN THE SAME SNAPSHOT (feeds the orientation line's ~<t>;
    // estimateTokens never throws — tokens.ts GOTCHA #3 — and a missing messages[i] estimates to 0).
    const origTokens = estimateTokens([messages[i]] as unknown as EstMessageLike[]).tokens;
    return { entryId: entryIdAtMessageIndex(entries, i), origTokens, index: i, snapshotOk: true }; // message index → stable ENTRY id
  } catch {
    return { entryId: null, origTokens: 0, snapshotOk: false }; // E13: the snapshot threw — the caller persists matched:false
  }
}

// ── execute (spec/05 §2 behavior; shared tool convention = never throws) ─────

/**
 * shrinkExecute — the tool body. Steps (spec/05 §2 steps 1–5):
 *   1. config (step 1; E14): getConfig() once; `config.shrink.enabled`? false → refuse "shrink is disabled".
 *   2. replacement (step 2): empty/whitespace-only after trim? → refuse "replacement must be non-empty".
 *   3. structural target (step 3 — the "structurally impossible" refusal; GOTCHA #7): the present
 *      discriminator empty after trim? → refuse "target discriminator must be non-empty".
 *   4. v2.0 §2 step 3 hard refusal: resolve the target ONLY within `currentTurnSpan` (3-arg
 *      resolveShrinkTarget). No in-span match — whether the target matches an EARLIER turn or nothing at
 *      all — → refuse "that result is from a previous turn; only this turn's tool calls can be shrunk"
 *      (ONE exact string for both classifications; NOTHING is persisted). The E13 carve-out: when the
 *      snapshot itself THREW (snapshotOk:false), the tool instead persists with matched:false (never
 *      block a legitimate shrink on an advisory computation).
 *   5. persist (step 4; GOTCHA #1 — NO cast, NO leaveNote): appendShrinkMarker(pi, ctx, {target,
 *      replacement, reason}) → markerId (the ENTRY id, or null).
 *   6. return (step 5): feedbackText(matched) + details:{ matched, markerId }.
 *
 * The WHOLE body is wrapped in ONE try/catch → refusal text on ANY exception (GOTCHA #5: never throw on
 * the tool hot path — E13). `pi` is captured by the `makeShrinkTool(pi)` factory closure (it is NOT an
 * execute argument — checkpoint.ts precedent). `toolCallId` (the FIRST execute arg) is UNUSED — the target
 * is explicit (GOTCHA #2; named `_toolCallId`).
 */
async function shrinkExecute(
  pi: ExtensionAPI,
  _toolCallId: string,
  params: ShrinkArgs,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<ShrinkDetails>> {
  try {
    // (1) config (spec/05 §2 step 1; E14). GOTCHA #10: read getConfig() ONCE. Master switch FIRST
    //     (E14 master-disable), then the sub-feature gate. The master `enabled:false` makes the WHOLE
    //     extension a no-op (context pass-through + nudges no-op + tools refuse "Mulligan is disabled").
    const config = getConfig();
    if (!config.enabled) return refusal("Mulligan is disabled"); // E14 master switch
    if (!config.shrink.enabled) return refusal("shrink is disabled");

    // (2) replacement non-empty (spec/05 §2 step 2).
    if (!isNonEmpty(params?.replacement)) return refusal("replacement must be non-empty");

    // (3) structural target validity (spec/05 §2 step 3 — "structurally impossible"; GOTCHA #7).
    //     A non-empty-but-currently-unmatched target is NOT refused here (that is advisory feedback, step 3/4).
    if (!targetIsStructurallyValid(params?.target)) return refusal("target discriminator must be non-empty");

    // (4) v2.0 §2 step 3 — span-bound match + HARD REFUSAL + PIN the matched entry id. resolveTargetEntryId
    //     resolves the target ONLY within currentTurnSpan (3-arg resolveShrinkTarget) and returns
    //     { entryId, origTokens, index?, snapshotOk }. Three outcomes:
    //       - snapshotOk:false  → the SNAPSHOT threw (E13 carve-out): persist with matched:false below — a
    //                             throwing advisory computation must never block a legitimate shrink.
    //       - snapshotOk:true && index === undefined → NO match within the current turn (earlier-turn-only
    //                             OR no match at all — ONE refusal string for both): HARD REFUSAL, nothing
    //                             persisted, no orientation line. A dead marker that can never fire within
    //                             its turn span is refused at creation instead ("Matched: yes" must not lie).
    //       - snapshotOk:true && index is a number → in-span match: entryId (may be null when unmappable)
    //                             becomes the marker's pinnedEntryId so applyShrink resolves by identity at
    //                             filter time (FINDING 3 fix — no moving-target drift). Inner try/catch is
    //                             belt-and-suspenders (resolveTargetEntryId already catches — E13).
    let entryId: string | null;
    let origTokens = 0;
    let snapshotOk = true;
    let index: number | undefined;
    try {
      ({ entryId, origTokens, index, snapshotOk } = resolveTargetEntryId(ctx, params.target));
    } catch {
      entryId = null;
      snapshotOk = false; // E13: treat a throw exactly like resolveTargetEntryId's own catch
    }
    if (snapshotOk && index === undefined) {
      // v2.0 §2 step 3 hard refusal — exact spec text; earlier-turn and no-match share ONE string.
      // Nothing is persisted and no orientation line is attached ("Context updated" must not lie).
      // [v1.2 merged] nothing counted/queued either — a refused op creates no marker, so it never
      // touched the rewrite budget (decideRewrite/countRewrite only run on the persist path below).
      return refusal("that result is from a previous turn; only this turn's tool calls can be shrunk");
    }
    const matched = snapshotOk ? entryId !== null : false; // snapshotOk:false → E13 persist path, matched:false
    // v1.2 (merged): ONE net-shed estimate — the orientation line's ~<t> and the flush trigger share it
    // (original matched content minus the replacement, floored at 0; estimateTokens never throws).
    const tokensShed = Math.max(0, origTokens - estimateTokens([{ content: params.replacement }]).tokens);

    // (4b) [v2] rewrite budget — "cap at one moment": EVERY op is submitted to the budget
    //      (queue-first). submitRewrite refuses (maxMoments 0), queues (inert — still visible,
    //      rides the next free moment), or applies NOW (a trigger spent the moment and flushed
    //      the queue, possibly with batch-mates from this same turn). No runtime (E13 fail-open)
    //      → apply immediately with no budget bookkeeping.
    let rt: SessionRuntime | null = null;
    try {
      rt = getRuntime(ctx.sessionManager.getSessionId());
    } catch {
      rt = null; // fail-open: no runtime → apply immediately (E13)
    }

    // (5) the persisted payload (spec/05 §2 step 4; GOTCHA #1 — NO cast, NO leaveNote; ShrinkMarkerInput matches EXACTLY).
    //     pinnedEntryId is included ONLY when the target matched at creation (absent → the filter falls back to live
    //     resolution — backward compat / compaction-robust). A non-matching target STILL persists (E8).
    const shrinkInput: ShrinkMarkerInput = {
      target: params.target,
      replacement: params.replacement,
      reason: params.reason,
      ...(entryId ? { pinnedEntryId: entryId } : {}),
    };

    let markerId: string | null;
    /** [v2] when the op applied via a flush: the batch size (for the AGGREGATE orientation line);
     *  undefined on the fail-open immediate path (no budget) and null-markerId paths. */
    let flushShrinks: number | null = null;
    let flushShed: number | null = null;

    if (rt === null) {
      markerId = appendShrinkMarker(pi, ctx, shrinkInput); // E13 fail-open: no budget bookkeeping
    } else {
      const r = submitRewrite(pi, ctx, rt, {
        kind: "shrink",
        payload: shrinkInput as unknown as Record<string, unknown>,
        reason: params.reason,
        estimatedTokens: tokensShed,
      });
      if (r.status === "refused") return refusal(r.reason);
      if (r.status === "queued") {
        const label = r.label;
        // INERT — no marker, no context change yet (events mean "now active"). Honest wording:
        // queued, still visible, applies at the next free moment.
        try {
          if (ctx.hasUI) {
            const capped = cap(params.replacement, config.shrink.notifyMaxChars);
            ctx.ui.notify(`QUEUED shrink (batch pending) ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
          }
        } catch {
          // E13: a UI failure must never break the tool.
        }
        return {
          content: [
            {
              type: "text",
              text:
                `Mulligan: shrink queued — ${label} — the content stays fully visible in your context for now ` +
                "(no change yet). It applies at the next free moment: your next mulligan_audit call, a context " +
                "compaction, or when the queued batch is worth spending the session's rewrite moment on. " +
                "Do not try to shed the same content again in the meantime",
            },
          ],
          details: { matched, markerId: null, queued: true },
        };
      }
      // applied — a trigger spent the moment and flushed the queue (incl. this op).
      const mine = r.flush.applied.length > 0 ? r.flush.applied[r.flush.applied.length - 1] : null;
      markerId = mine ? mine.markerId : null;
      flushShrinks = Math.max(1, r.flush.applied.filter((a) => a.kind === "shrink").length);
      flushShed = r.flush.estimatedTokens;
    }

    // (5b) operator echo (spec/05 §2 step 5 — zero context cost; the replacement is NOT in the tool result).
    //      P1.M2.T1.S2: surface a capped copy of the replacement to the operator via ctx.ui.notify so the
    //      human can audit what the model recorded, without the model itself paying context for the echo.
    //      E13: a UI failure must NEVER break the tool — the marker is already persisted (own try/catch).
    try {
      if (ctx.hasUI) {
        const capped = cap(params.replacement, config.shrink.notifyMaxChars);
        ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
      }
    } catch {
      // E13: a UI failure must never break the tool — the marker is already persisted.
    }

    // (6) return (spec/05 §2 step 5) — feedback text (yes/no from the best-effort match) + details. v1.2 guard:
    //     when the marker ACTUALLY persisted (markerId truthy → it is ACTIVE), the result ENDS with the fixed
    //     orientation line — the AGGREGATE form when a flush batched multiple shrink results (k = shrink ops in
    //     the flush, t = the batch's total shed estimate), else the single form (k=1, this op's `tokensShed` —
    //     ONE estimate shared with the rewrite-budget triggers). Append FAILED (markerId null) → NO marker →
    //     nothing is active → NO line ("Context updated" must not lie). Refusal/queued paths never reach here
    //     (they have their own honest text).
    const orientation = markerId
      ? `\n${shrinkOrientationLine(flushShrinks ?? 1, flushShed ?? tokensShed)}`
      : "";
    return {
      content: [{ type: "text", text: feedbackText(matched) + orientation }],
      details: { matched, markerId },
    };
  } catch (e) {
    // Shared tool convention: never throw — return a text result describing the failure (GOTCHA #5, E13).
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Factory: the testable `pi`-injection seam (recommended in the PRP) ───────

/**
 * makeShrinkTool — the tool factory. Captures `pi` (ExtensionAPI) via closure so `shrinkExecute` can call
 * `appendShrinkMarker(pi, ctx, …)` WITHOUT `pi` being an execute argument (the Pi ExtensionAPI is passed to
 * the extension FACTORY in src/index.ts, not to each tool's execute()). `defineTool` preserves
 * `ShrinkParams` inference when assigning to a variable (checkpoint.ts precedent).
 *
 * index.ts (P1.M7.T1.S1) will do: `pi.registerTool(makeShrinkTool(pi));`.
 * Unit tests do: `const tool = makeShrinkTool(fakePi);`.
 */
export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails> {
  return defineTool({
    name: "mulligan_shrink",
    label: "Mulligan Shrink",
    description: SHRINK_DESC, // spec/05 §5 VERBATIM
    parameters: ShrinkParams,
    // Some models send the OBJECT-typed `target` as a JSON-ENCODED STRING (observed live:
    // target:"{\"by_tool_call_id\": \"call_bash_pclntab\"}"). The host validates args BEFORE execute() runs
    // and Value.Convert cannot coerce string→object, so without this shim every anyOf arm fails ("must be
    // object" ×3) and the call is dead on arrival. prepareArguments is the sanctioned pre-validation hook
    // (host edit.js precedent for the identical failure class).
    prepareArguments: prepareObjectArgs<ShrinkArgs>(["target"]),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return shrinkExecute(pi, toolCallId, params, signal, onUpdate, ctx); // pi captured via closure
    },
  });
}
