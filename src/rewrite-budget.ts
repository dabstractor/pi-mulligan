/**
 * rewrite-budget.ts — v2 "cap at one moment": per-session cap on REWRITE MOMENTS + queueing of
 * ops until a moment is worth spending (or a free break comes along).
 *
 * WHY v2 (bench findings on r1/v1): v1 counted TOOL OPERATIONS (cap 2), but real sessions almost
 * never exceed 2 operations — the model batches parallel tool calls into one turn — so the cap
 * never bound and queue/flush never fired. What predicts cost is REWRITE MOMENTS: distinct points
 * in time where the outgoing history changes (each breaks the provider's prompt cache and re-bills
 * the rest of the session at full price). Measured: sessions with exactly ONE moment ran 2–13%
 * CHEAPER than no-tool twins; TWO OR MORE moments ran 16–37% more expensive. There is a cliff
 * between one and two. (Under a forced heavy-rewriting arm, the v1 cap mechanism still SAVED
 * 20.6% where uncapped versions lose ~50% — the mechanism protects cost when it binds; v2 fixes
 * the counting unit so it binds in real sessions.)
 *
 * VOCABULARY:
 *   - OPERATION: one mulligan_rewind or mulligan_shrink tool call (a would-be marker).
 *   - MOMENT: a turn in which at least one marker becomes ACTIVE. Five parallel shrinks in one
 *     turn = five operations, ONE moment. Moments are the budgeted unit (maxMoments, default 1).
 *
 * BEHAVIOR (maxMoments=1 default):
 *   a) Ops arriving before any moment is spent are QUEUED (inert: no marker, no context change —
 *      the tool result says so honestly). The allowed moment is SPENT when:
 *        - the queued estimated shed volume strictly exceeds flushShedTokens (4000), OR
 *        - the model calls mulligan_audit (honest moment to apply), OR
 *        - the turn already contains multiple ops (natural batching: the 2nd op in a turn flushes
 *          the whole queue — the batch activates together as ONE moment).
 *   b) After the moment is spent: every further op QUEUES and may only ride breaks that are
 *      already FREE — the provider re-compacting context (detected via the compaction watermark;
 *      the cache is already destroyed there) or an audit call. Volume alone NEVER opens a second
 *      moment.
 *   c) SAFETY VALVE: if the queued volume strictly exceeds safetyValveTokens (16000), spend an
 *      EXTRA moment and flush anyway — pathological sessions must still be able to shed. The
 *      valve is an exception, not a path.
 *
 * MOMENT ACCOUNTING: paid flushes (volume / batch / valve triggers, and an audit flush while the
 * budget is unspent) increment rt.momentsSpent. Compaction-riding flushes NEVER do (the break is
 * free). An audit flush at the cap applies the queue without spending anything further (spec b
 * blesses audit as a free-break rider).
 *
 * SCOPE GUARD: this module does not change WHAT gets shed, target resolution, note/replacement
 * formats, or nudges — only the counting unit, the cap default, and the flush policy. The TOOLS
 * build the exact payloads they always built; the queue stores them and flush replays them
 * verbatim.
 *
 * DESIGN:
 * - Fail-open everywhere (E13): any throw inside submit/flush degrades to "apply immediately" —
 *   the budget must never BLOCK a legitimate op (or crash a turn) on a bookkeeping bug.
 * - Telemetry: JSONL log events "mulligan:rewrite-queued" (op queued — inert) and
 *   "mulligan:rewrite-flush" {count, estimatedTokens, trigger, momentsSpent} (activation — the
 *   only path where markers become active) via src/log.ts (no-op unless log.file is configured).
 * - The seq ordering nuance: markers appended at flush time get seqs from the SAME per-session
 *   counter (nextSeq), so the filter's stableSortBySeq ordering stays monotonic with wall-clock
 *   activation order — exactly as if the ops had been created (in queue order) at flush time.
 * - NEVER auto-flush at shutdown (pointless cost — the session is over).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getRuntime, type SessionRuntime } from "./runtime.js";
import { appendRewindMarker, appendShrinkMarker, consumeCheckpointLabels, leaveNote } from "./markers.js";
import type { RewindMarkerInput, ShrinkMarkerInput } from "./markers.js";
import { getConfig } from "./config.js";
import { logInfo } from "./log.js";

/**
 * FlushTrigger — what caused a flush. "volume" (pre-spend shed threshold), "batch" (2nd+ op in a
 * turn — natural batching), "valve" (safety valve exception; allowed even at the cap), "audit"
 * (the model asked about context), "compaction" (the provider re-compacted — a FREE break).
 */
export type FlushTrigger = "volume" | "batch" | "valve" | "audit" | "compaction";

/**
 * QueuedRewriteArg — the op description handed to submitRewrite. Structurally the persistable
 * subset of QueuedRewrite (runtime.ts owns the stored shape; this keeps the tools' call sites
 * explicit).
 */
export interface QueuedRewriteArg {
  kind: "shrink" | "rewind";
  /** The EXACT marker payload the tool built (verbatim replay at flush). */
  payload: Record<string, unknown>;
  /** Short reason for telemetry/audit. */
  reason?: string;
  /** The RENDERED note (rewind only) — flushed as the mulligan:note CustomMessage. */
  renderedNote?: string;
  /** Rewind success-text inputs (rewind only). */
  rewindText?: { k: number; hasWarning: boolean; granularity: string };
  /** The op's own toolCallId (rewind only) — the leaveNote rewindId fallback when the marker
   *  append fails inside a flush (mirrors the immediate path's `markerId ?? toolCallId`). */
  toolCallId?: string;
  /** Estimated shed volume (tokens) — drives the volume trigger + the safety valve. */
  estimatedTokens: number;
}

/**
 * SubmitResult — the verdict for one would-be marker-creating op. Narrow on `status`:
 *   - "refused": the budget forbids markers entirely (maxMoments 0). The tool refuses.
 *   - "queued":  the op is stored INERT (still visible; no marker, no event). The tool result
 *                must say so honestly ("queued, still visible, applies at the next free moment").
 *   - "applied": the op (and possibly batch-mates queued before it) became ACTIVE right now —
 *                the flush result carries per-op marker ids. The tool renders its normal
 *                success text.
 * EXPORTED for the tools + tests.
 */
export type SubmitResult =
  | { status: "refused"; reason: string }
  | { status: "queued"; label: string }
  | { status: "applied"; flush: FlushResult };

/**
 * submitRewrite — the single entry point the tools call with a built op. Queue-first policy:
 * EVERY op is queued, then triggers decide whether to spend a moment and flush immediately.
 * NEVER throws (fail-open: on internal error → apply immediately, matching v1's "allow").
 * EXPORTED for the tools + tests.
 */
export function submitRewrite(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  rt: SessionRuntime,
  op: QueuedRewriteArg,
): SubmitResult {
  try {
    const cfg = getConfig().rewrites;
    if (cfg.maxMoments <= 0) {
      // The "never create markers" off switch: refuse regardless of anything else. Queueing an
      // op that can NEVER activate would be a lie. Audit/cancel are unaffected (not ops).
      return {
        status: "refused",
        reason:
          `session rewrite budget forbids markers this session (maxMoments is 0). ` +
          "Run mulligan_audit to review what you are carrying",
      };
    }

    const label = queueRewrite(rt, op);
    rt.opsThisTurn = (Number.isFinite(rt.opsThisTurn) ? rt.opsThisTurn : 0) + 1;
    const total = queuedShedTotal(rt);

    // SAME-TURN RIDE: if markers already became active THIS TURN, this op joins that moment —
    // flush now, free (no NEW cache break beyond the one this turn already took). This is what
    // makes "five parallel shrinks in one turn" ONE moment.
    if (rt.activatedThisTurn) {
      return { status: "applied", flush: flushRewrites(pi, ctx, rt, "batch") };
    }

    // (c) SAFETY VALVE — the exception that outranks the cap. Strictly ABOVE the threshold.
    if (total > cfg.safetyValveTokens) {
      return { status: "applied", flush: flushRewrites(pi, ctx, rt, "valve") };
    }

    // (a) PRE-SPEND triggers — only while the session still has an unspent moment.
    if ((Number.isFinite(rt.momentsSpent) ? rt.momentsSpent : 0) < cfg.maxMoments) {
      // Volume: the queued total REACHES flushShedTokens (>= — at-threshold flushes; threshold 0
      // therefore means "flush every op immediately", the aggressive off-position for the queue).
      if (total >= cfg.flushShedTokens) {
        return { status: "applied", flush: flushRewrites(pi, ctx, rt, "volume") };
      }
      // Natural batching: this is the 2nd+ op of THIS turn → the batch activates together.
      if (rt.opsThisTurn >= 2) {
        return { status: "applied", flush: flushRewrites(pi, ctx, rt, "batch") };
      }
    }

    // (b) POST-SPEND (or under-threshold pre-spend): stay queued — the op rides the next FREE
    //     break (compaction / audit). Volume alone NEVER opens another moment.
    return { status: "queued", label };
  } catch {
    // Fail-open (E13): a budget bug must never block a legitimate op → apply immediately.
    return { status: "applied", flush: flushRewrites(pi, ctx, rt, "valve") };
  }
}

/**
 * queueRewrite — store one op in the session's rewriteQueue (INERT: no marker, no context change
 * yet) + emit the "mulligan:rewrite-queued" telemetry event. Returns a short human/model-readable
 * label for the queued op ("shrink of read src/big.log"). NEVER throws. Module-scoped behavior is
 * exported for tests via submitRewrite; kept internal otherwise.
 */
function queueRewrite(rt: SessionRuntime, op: QueuedRewriteArg): string {
  let label = op.kind === "shrink" ? "shrink" : "rewind";
  try {
    const queued: import("./runtime.js").QueuedRewrite = {
      kind: op.kind,
      payload: op.payload,
      ...(op.reason !== undefined ? { reason: op.reason } : {}),
      ...(op.renderedNote !== undefined ? { renderedNote: op.renderedNote } : {}),
      ...(op.rewindText !== undefined ? { rewindText: op.rewindText } : {}),
      ...(op.toolCallId !== undefined ? { toolCallId: op.toolCallId } : {}),
      estimatedTokens: Number.isFinite(op.estimatedTokens) && op.estimatedTokens > 0 ? op.estimatedTokens : 0,
    };
    rt.rewriteQueue.push(queued);
    label = describeQueued(queued);
    logInfo("mulligan:rewrite-queued", rt.sessionId, {
      kind: op.kind,
      reason: op.reason,
      estimatedTokens: queued.estimatedTokens,
      queued: rt.rewriteQueue.length,
    });
  } catch {
    /* fail-open: queueing must never break the tool hot path */
  }
  return label;
}

/** A short label for a queued op (best-effort; used in the tool result + flush telemetry). */
function describeQueued(op: import("./runtime.js").QueuedRewrite): string {
  try {
    const t = op.payload && typeof op.payload === "object" ? (op.payload as Record<string, unknown>).target : undefined;
    if (op.kind === "shrink" && t && typeof t === "object") {
      const tt = t as Record<string, unknown>;
      if (typeof tt.by_tool_call_id === "string") return `shrink of tool call ${tt.by_tool_call_id}`;
      if (typeof tt.by_tool_name === "string") return `shrink of ${tt.by_tool_name} result`;
      if (typeof tt.by_content_includes === "string")
        return `shrink of message containing "${String(tt.by_content_includes).slice(0, 40)}"`;
    }
    if (op.kind === "rewind" && op.rewindText) return `${op.rewindText.granularity} rewind`;
  } catch {
    /* best-effort label */
  }
  return op.kind;
}

/**
 * queuedShedTotal — the summed estimated shed volume (tokens) of the session's queued ops. 0 when
 * the queue is empty. Defensive (non-finite entries contribute 0). EXPORTED for tests + audit.
 */
export function queuedShedTotal(rt: SessionRuntime): number {
  try {
    let total = 0;
    for (const op of rt.rewriteQueue) {
      if (Number.isFinite(op.estimatedTokens) && op.estimatedTokens > 0) total += op.estimatedTokens;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * FlushResult — what one flush did. `applied` mirrors each op's immediate-creation result: the
 * markerId (entry id or null) per op, in queue order. `text` is the flush summary line used by
 * the AUDIT result ("" when nothing was applied).
 */
export interface FlushResult {
  /** How many queued ops were activated. */
  count: number;
  /** Summed estimated shed tokens across activated ops. */
  estimatedTokens: number;
  /** Per-op marker entry ids (queue order; null mirrors the wrapper's failure return). */
  applied: { kind: "shrink" | "rewind"; markerId: string | null; label: string }[];
  /** True when at least one op produced a non-null markerId. */
  ok: boolean;
  /** The flush summary text ("" when count === 0). */
  text: string;
}

/**
 * flushRewrites — activate ALL queued markers at once (one cache break, not N): persist each
 * queued op's marker verbatim (queue order), leave each rewind's note, consume checkpoint labels
 * for checkpoint-granularity rewinds, do the MOMENT ACCOUNTING for `trigger`, emit
 * "mulligan:rewrite-flush" {count, estimatedTokens, trigger, momentsSpent}, and return the
 * summary. NEVER auto-flushes at shutdown. NEVER throws (count-0 flush on error).
 *
 * MOMENT ACCOUNTING by trigger:
 *   - "volume" | "batch": paid — called only while a moment is unspent; increments momentsSpent.
 *   - "valve":            paid exception — allowed even at the cap; increments momentsSpent
 *                         (possibly beyond maxMoments — it records the extra break honestly).
 *   - "audit":            spends the budgeted moment IF one is unspent (a real cache break);
 *                         at the cap it applies for free (spec (b) blesses audit as a rider).
 *   - "compaction":       always FREE (the provider destroyed the cache itself); never increments.
 *
 * Fail-open polarity: a failing append for one op does NOT stop the others (per-op try/catch).
 * Flushed ops leave the queue regardless of append success (re-attempting would double-append).
 * EXPORTED for the audit tool, the compaction hook, and tests.
 */
export function flushRewrites(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  rt: SessionRuntime,
  trigger: FlushTrigger,
): FlushResult {
  const result: FlushResult = { count: 0, estimatedTokens: 0, applied: [], ok: false, text: "" };
  try {
    const queue = rt.rewriteQueue;
    if (!Array.isArray(queue) || queue.length === 0) return result;
    // Drain FIRST (per-session in-memory state; a crash mid-flush must not re-activate the same
    // ops on a later trigger — appendEntry always appends; markers are idempotent-hostile).
    const ops = queue.splice(0, queue.length);

    for (const op of ops) {
      let markerId: string | null = null;
      try {
        if (op.kind === "shrink") {
          markerId = appendShrinkMarker(pi, ctx, op.payload as unknown as ShrinkMarkerInput);
        } else {
          markerId = appendRewindMarker(pi, ctx, op.payload as unknown as RewindMarkerInput);
          if (typeof op.renderedNote === "string") {
            // rewindId fallback mirrors the immediate path's `markerId ?? toolCallId` (GOTCHA #10).
            leaveNote(pi, op.renderedNote, markerId ?? (typeof op.toolCallId === "string" ? op.toolCallId : ""));
          }
          const checkpoint = op.payload && typeof op.payload === "object" ? (op.payload as Record<string, unknown>).checkpoint : undefined;
          if (typeof checkpoint === "string" && checkpoint.length > 0) {
            consumeCheckpointLabels(pi, ctx, checkpoint); // single consumption (verbatim rewind step 7b)
          }
        }
      } catch {
        markerId = null; // fail-open: one op's failure never stops the batch
      }
      result.count++;
      result.estimatedTokens += Number.isFinite(op.estimatedTokens) && op.estimatedTokens > 0 ? op.estimatedTokens : 0;
      result.applied.push({ kind: op.kind, markerId, label: describeQueued(op) });
    }
    result.ok = result.applied.some((a) => a.markerId !== null);

    // Moment accounting (see the doc block). A flush spends a NEW moment iff it is the FIRST
    // activation of this turn AND it is not riding a free break:
    //   - "compaction": always FREE (the provider destroyed the cache itself) — never spends.
    //   - "audit":      spends the budgeted moment iff one is unspent (a real break); at the cap
    //                    it applies for free (spec (b) blesses audit as a rider).
    //   - "volume" | "batch": the pre-spend / same-turn triggers — spend iff this turn had no
    //                    activation yet (same-turn rides are part of the moment already counted).
    //   - "valve":      the exception — spends a moment even at the cap (recorded honestly, even
    //                    beyond maxMoments), but still not twice in one turn.
    // Every flush marks the turn as activated (same-turn rides above).
    try {
      const maxMoments = getConfig().rewrites.maxMoments;
      const spent = Number.isFinite(rt.momentsSpent) ? rt.momentsSpent : 0;
      const firstOfTurn = !rt.activatedThisTurn;
      if (firstOfTurn) {
        if (trigger === "valve") {
          rt.momentsSpent = spent + 1; // exception moment — even at the cap
        } else if (trigger !== "compaction" && spent < maxMoments) {
          rt.momentsSpent = spent + 1; // volume / batch / pre-spend audit: the budgeted moment
        }
        // compaction, or audit at the cap: free — no increment.
      }
      rt.activatedThisTurn = true;
    } catch {
      /* E13 */
    }

    const labels = result.applied.map((a) => a.label).join(", ");
    result.text =
      `Mulligan: rewrite batch applied — ${result.count} queued operation(s) now active ` +
      `(~${result.estimatedTokens} tokens to be shed next turn): ${labels}.`;
    logInfo("mulligan:rewrite-flush", rt.sessionId, {
      count: result.count,
      estimatedTokens: result.estimatedTokens,
      trigger,
      momentsSpent: rt.momentsSpent,
    });
    return result;
  } catch {
    return result; // fail-open (E13): a flush bug must never crash the audit/tool hot path
  }
}

/**
 * maybeFlushOnCompaction — the FREE-BREAK rider, called from the context filter on every fire.
 * Detects that the provider re-compacted context (a NEW `type:"compaction"` entry on the branch
 * since the last observation) and, if ops are queued, flushes them with trigger "compaction"
 * (never spending a moment — the cache is already destroyed there). The FIRST observation only
 * initializes the watermark (a compaction that predates the queue must not flush anything).
 * NEVER throws (returns silently on any error). EXPORTED for filter.ts + tests.
 */
export function maybeFlushOnCompaction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  rt: SessionRuntime,
): void {
  try {
    const entries = ctx.sessionManager.getEntries();
    if (!Array.isArray(entries)) return;
    let count = 0;
    for (const e of entries) {
      if (typeof e === "object" && e !== null && !Array.isArray(e)) {
        try {
          if ((e as { type?: unknown }).type === "compaction") count++;
        } catch {
          /* a throwing-Proxy entry contributes nothing */
        }
      }
    }
    const prev = rt.compactionWatermark;
    rt.compactionWatermark = count;
    if (prev !== null && count > prev && rt.rewriteQueue.length > 0) {
      flushRewrites(pi, ctx, rt, "compaction");
    }
  } catch {
    /* E13: the compaction rider must never break the context handler */
  }
}

/**
 * registerRewriteTurnReset — wire the per-turn op counter reset: `turn_end` zeroes
 * rt.opsThisTurn so the natural-batching trigger ("2nd op THIS turn") is scoped to a single
 * turn. Registered from index.ts alongside the other handlers. NEVER throws.
 * EXPORTED for index.ts + tests.
 */
export function registerRewriteTurnReset(pi: ExtensionAPI): void {
  try {
    pi.on("turn_end", (_event: unknown, ctx: ExtensionContext) => {
      try {
        const rt = getRuntime(ctx.sessionManager.getSessionId());
        rt.opsThisTurn = 0;
        rt.activatedThisTurn = false; // a new turn can be a NEW moment if it activates
      } catch {
        /* E13 */
      }
    });
  } catch {
    /* E13: registration failure must never break the extension factory */
  }
}