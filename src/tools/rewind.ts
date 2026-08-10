/**
 * rewind.ts — the `mulligan_rewind` agent-callable tool (spec/05 §1; spec/04 §3; spec/08 E1–E15).
 *
 * THE "MULLIGAN" ITSELF — the headline operation. When the agent realizes a recent tool interaction was a
 * bloated mistake or a whole turn pursued the wrong direction, it calls this tool with a structured four-field
 * note + a granularity. The tool: (1) refuses cleanly when disabled / the note is vacuous / a named checkpoint is
 * absent / the max-depth cap is hit; (2) does a BEST-EFFORT read-only resolution of the target span to extract a
 * deterministic FileLedger and estimate K (messages to hide) — purely advisory, never mutating live context;
 * (3) persists a `mulligan:rewind` marker (control state, NOT in context) carrying the targeting SPEC (granularity
 * + options + excludeToolCallId + the checkpoint name); (4) leaves the rendered note as an in-context
 * `mulligan:note` CustomMessage; (5) returns a short confirmation naming K, appending a side-effect warning when
 * the hidden span mutated files/ran bash. The marker is resolved AUTHORITATIVELY by the `context` filter on the
 * NEXT inference (D7 — record a spec, not indices).
 *
 * DESIGN (read the gotchas + the PRP):
 * - Thin, typebox-schema'd, validation-owning adapter on top of `appendRewindMarker`/`leaveNote` (src/markers.ts,
 *   P1.M4.T1 — ALREADY shipped & unit-tested). This tool does NOT reimplement `pi.appendEntry`/`pi.sendMessage`,
 *   note-field validation (validateNote), partitioning/resolution (transforms resolvers), or ledger extraction
 *   (extractFileLedger) — it delegates all of that to the shipped pure/Pi-coupled helpers.
 * - The TOOL owns: config gate, note validation (via validateNote), checkpoint-existence scan, depth guard, the
 *   read-only preview (snapshot → resolvers → ledger → K), the persisted payload (incl. the checkpoint gotcha),
 *   the mutation warning, and the success/refusal text.
 * - The tool is WRITE-ONLY w.r.t. the message list: it NEVER receives/transforms `event.messages` (it is not the
 *   context event). It builds a SNAPSHOT via `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)`
 *   for the ADVISORY ledger + K estimate. If that snapshot/resolution fails, it falls back to an empty ledger +
 *   K=0 + STILL succeeds (the marker spec is what matters; E13/E8 — never let an advisory computation block a
 *   legitimate rewind).
 * - Shared tool convention (spec/05 "Shared tool conventions"): the execute body is fail-open to text — it NEVER
 *   throws (E13). The whole body is wrapped in ONE try/catch → text result on any exception.
 * - CRITICAL GOTCHA #1 (cross-task): RewindMarker / RewindMarkerInput in src/markers.ts (FROZEN, spec/04 §3) have
 *   NO `checkpoint` field — BUT filterPipeline (src/transforms.ts) reads checkpoint granularity via `readOwn(rw,
 *   "checkpoint")` and RewindMarkerLike has `checkpoint?: string`. This tool is the SOLE writer — if it does NOT
 *   persist `checkpoint`, every checkpoint rewind SILENTLY NO-OPS. FIX: include `checkpoint: params.checkpoint`
 *   in the payload; the wrapper spreads `{...data, ...envelope}` so the extra field survives at runtime. The
 *   frozen TYPE omits it → build the payload as a widened local object and cast at the call site.
 * - CRITICAL GOTCHA #2: `toolCallId` is the FIRST execute arg (NOT params). It becomes `excludeToolCallId` on the
 *   marker so the filter skips the rewind's OWN tool-call group (spec/05 §1 step 6; api_verification.md §8 NOTE).
 * - CRITICAL GOTCHA #4: every `AgentToolResult<T>` return path includes a `details` field (spec/05 §1's
 *   `{ content:[...] }`-only shape is a SIMPLIFICATION — `details` is REQUIRED by the Pi type; strict mode).
 * - `pi` (ExtensionAPI) is NOT passed to execute() — it is captured via the `makeRewindTool(pi)` factory closure
 *   (checkpoint.ts precedent). index.ts (P1.M7.T1.S1) does `pi.registerTool(makeRewindTool(pi))`.
 *
 * This item does NOT modify src/index.ts (wiring is P1.M7.T1.S1).
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { appendRewindMarker, leaveNote, type RewindMarkerInput } from "../markers.js"; // GOTCHA #13: .js
import { validateNote, renderNote, NOTE_INVALID_REASON, type NoteInput } from "../notes.js";
import { extractFileLedger, type FileLedger } from "../ledger.js";
import { getConfig, type Granularity } from "../config.js"; // GOTCHA #14: read ONCE at the top of execute
import { getRuntime, type SessionRuntime } from "../runtime.js"; // [P4.M1.T2.S3] latch rewindRefusedTurnIndex
import { readMarkers } from "../filter.js"; // [P4.M1.T2.S3] readMarkers(ctx).metric?.turnIndex (precedent: audit.ts L51)
import {
  partitionIntoUnits,
  resolveLastToolCallGroup,
  resolveLastTurn,
  resolveCheckpoint,
  type BranchEntry,
  type MessageLike,
} from "../transforms.js";
import { computeFilteredTotal } from "./audit.js"; // E22 out-of-band context-fraction stop (shared with mulligan_audit)

// ── Parameter schema (spec/05 §1 — Typebox, VERBATIM incl. every field description) ──────────

/**
 * RewindParams — the typebox parameter schema for `mulligan_rewind` (spec/05 §1, VERBATIM). `Static<typeof
 * RewindParams>` === `{ note: NoteInput, granularity, to_previous_prompt?, checkpoint? }`. EXPORTED for tests +
 * the index.ts wiring step.
 */
export const RewindParams = Type.Object({
  note: Type.Object(
    {
      what_happened: Type.String({
        description:
          "Past tense: what specifically went wrong and wasted context. Be concrete.",
      }),
      avoid: Type.String({
        description: "Imperative: what NOT to do again on resume.",
      }),
      true_current_state: Type.String({
        description:
          "The TRUE current state as of this rewind — files changed, commands run, decisions made on the span being discarded. This prevents redoing work. (A deterministic file ledger is auto-appended.)",
      }),
      next: Type.String({
        description: "Imperative: the immediate next action to take when you resume.",
      }),
    },
    { description: "The note your resumed self will read. All four fields required." },
  ),
  granularity: Type.Union(
    [
      Type.Literal("last_tool_call_group"),
      Type.Literal("last_turn"),
      Type.Literal("checkpoint"),
    ],
    {
      description:
        "last_tool_call_group = hide just the most recent tool interaction (the assistant turn that issued tool calls + their results). Surgical. " +
        "last_turn = hide all your work after the most recent user message, landing back at that prompt to re-attempt the turn. " +
        "checkpoint = hide back to a named checkpoint you set earlier (requires `checkpoint`).",
    },
  ),
  to_previous_prompt: Type.Optional(
    Type.Boolean({
      description:
        "Only for granularity=last_turn. If true, also discard the most recent user message (nuclear: you abandon the current ask entirely). Default false.",
    }),
  ),
  checkpoint: Type.Optional(
    Type.String({
      description:
        "Required when granularity=checkpoint. The name of a checkpoint set via mulligan_checkpoint.",
    }),
  ),
});

/** RewindArgs — the inferred execute-time params type. EXPORTED for ergonomics/tests. */
export type RewindArgs = Static<typeof RewindParams>;

// ── The LLM-facing description string (spec/05 §5 — copy VERBATIM) ────────────

/**
 * REWIND_DESC — the LLM-facing description (spec/05 §5 "Description strings", Mode A LLM-facing docs).
 * This string IS the tool's documentation. Copy verbatim — it drives LLM usage.
 */
export const REWIND_DESC =
  "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The hidden content disappears from your view permanently (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message.";

// ── Mutation warning (spec/08 E5 — VERBATIM warning string) ──────────────────

/**
 * MUTATION_WARNING — the spec/08 E5 VERBATIM warning appended to the success text when the hidden span contained
 * side-effecting work (writes/bash) AND config.rewind.requireMutationWarning is true. The leading space + ⚠ are
 * load-bearing (do NOT rephrase). Module-local.
 */
const MUTATION_WARNING =
  "⚠ The hidden span modified files/ran side-effecting commands (see note). " +
  "Those effects PERSIST on disk; do not blindly redo them.";

// ── Result builders (always include `details` — CRITICAL GOTCHA #4) ──────────

/** RewindDetails — the structured `details` payload surfaced to logs/audit/UI on every return path. EXPORTED. */
export interface RewindDetails {
  /** The requested granularity (present on EVERY path for correlation). */
  granularity: Granularity;
  /** Estimated messages to hide (success path only). */
  k?: number;
  /** The extracted file ledger (success path only; empty on best-effort failure). */
  ledger?: FileLedger;
  /** Stable ENTRY ids pinned for permanent hiding at marker-creation time (fix_design.md §Change 2; audit surface).
   *  Present on the success path (possibly []); omitted on refusal paths. Read by filterPipeline (P1.M2.T4) off the
   *  persisted marker and resolved by resolvePinnedHide (P1.M2.T2). Holds ENTRY ids (stable), NOT message indices. */
  hideEntryIds?: string[];
  /** The persisted marker's entry id (success path; null/omitted when append returned null). */
  markerId?: string | null;
}

/**
 * refusal — build a fail-open text result for any refusal / wrapper-reported-failure / unexpected-error case.
 * ALWAYS includes `details` (CRITICAL GOTCHA #4). The shared convention prefixes every refusal with
 * "Mulligan: refused — " (and closes the sentence with ".") so the agent can pattern-match a refusal regardless
 * of the underlying reason. NOTE: the caller passes a reason with NO trailing period (NOTE_INVALID_REASON has none);
 * this helper adds the ".".
 */
function refusal(reason: string, granularity: Granularity): AgentToolResult<RewindDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }],
    details: { granularity },
  };
}

/**
 * successText — build the success text (spec/05 §1 Return shape + step 8 K=0 honesty). Returns just the `text`
 * (the caller wraps it into the content block + details). K=0 appends "(nothing matched to hide)" so the agent is
 * not misled (GOTCHA #12). The mutation warning is appended VERBATIM (spec/08 E5) when hasWarning is true.
 * Module-local.
 */
function successText(granularity: Granularity, k: number, hasWarning: boolean): { text: string } {
  const kClause =
    k === 0
      ? "0 messages will be hidden from your view starting next turn (nothing matched to hide)"
      : `${k} messages will be hidden from your view starting next turn`;
  let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
  if (hasWarning) text += " " + MUTATION_WARNING; // spec/08 E5 VERBATIM
  return { text };
}

// ── Pure read-only preview helpers (snapshot → resolvers → ledger → K; best-effort) ──────────

/**
 * emptyLedger — the fail-open fallback ({ readFiles:[], modifiedFiles:[], bashSideEffects:[] }). Module-local.
 * Used when the read-only preview throws (resolvePreview catch) so the rewind STILL proceeds with an honest K=0.
 */
function emptyLedger(): FileLedger {
  return { readFiles: [], modifiedFiles: [], bashSideEffects: [] };
}

/**
 * countRewindMarkers — the depth-guard source (GOTCHA #9). Scan `ctx.sessionManager.getEntries()` for entries
 * where `type === "custom" && customType === "mulligan:rewind"`; return the count. Markers are permanent (never
 * cleared), so ALL persisted rewind markers count toward maxDepth. Defensive (never throws; a throwing-Proxy
 * entry or a non-array → the entry is skipped / the count is 0). Module-local.
 */
function countRewindMarkers(ctx: ExtensionContext): number {
  let count = 0;
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the depth guard throw
  }
  if (!Array.isArray(entries)) return 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      if ((e as { type?: unknown }).type === "custom" && (e as { customType?: unknown }).customType === "mulligan:rewind") {
        count++;
      }
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}

/**
 * countRetriesAtLatestPrompt — the E22 per-prompt retry-budget counter (step 4b). Finds the LAST entry whose
 * `type === "message"` AND whose `message.role === "user"` (the latest user prompt), then counts entries at
 * index > that index where `type === "custom" && customType === "mulligan:rewind"` (rewind markers appended
 * AFTER the latest user message = rewinds during this turn that re-land at the prompt). Returns 0 when there
 * is no user-message entry (no prompt → no budget consumption). Defensive (never throws; a throwing-Proxy
 * entry, a non-array, or a throwing getEntries → the entry is skipped / the count is 0). Module-local.
 *
 * OVER-APPROXIMATION (v1 entry-position): for `last_tool_call_group`/`checkpoint` rewinds this counts a rewind
 * issued THIS turn even if its resolved target was a PRIOR turn's group (the marker is appended at the end
 * regardless). The spec's intent — arrest the same-prompt loop — is met; precise message-list resolution
 * (excluding a tool-group rewind whose target precedes the latest prompt) is a future refinement. Advancing
 * to a new user prompt naturally resets the count (the new prompt becomes the latest → prior rewinds are
 * before it).
 */
function countRetriesAtLatestPrompt(ctx: ExtensionContext): number {
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the retry-budget guard throw (E13)
  }
  if (!Array.isArray(entries)) return 0;

  // Find the INDEX of the LAST user-prompt entry (type:"message" with message.role:"user").
  let latestPromptIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; message?: { role?: unknown } };
      if (ee.type === "message" && ee.message?.role === "user") latestPromptIndex = i;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption

  // Count mulligan:rewind markers appended AFTER the latest user prompt.
  let count = 0;
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; customType?: unknown };
      if (ee.type === "custom" && ee.customType === "mulligan:rewind") count++;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}

/**
 * checkpointExists — the checkpoint-existence check (step 3, E10). Scan `ctx.sessionManager.getEntries()` for an
 * entry where `type === "label" && label === \`mulligan:checkpoint:${name}\``; return found. Defensive (never
 * throws; a malformed name naturally returns false). Module-local.
 */
function checkpointExists(ctx: ExtensionContext, name: string): boolean {
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return false; // never let the existence check throw
  }
  if (!Array.isArray(entries)) return false;
  const needle = `mulligan:checkpoint:${name}`;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      if ((e as { type?: unknown }).type === "label" && (e as { label?: unknown }).label === needle) {
        return true;
      }
    } catch {
      // skip a throwing-Proxy entry
    }
  }
  return false;
}

/**
 * captureHideEntryIds — map the resolved MESSAGE-INDEX removal set back to the STABLE ENTRY ids of the entries that
 * produced those messages, for PERMANENT pinned hiding (fix_design.md §Change 2; the PRODUCER half of the BUG-001/
 * BUG-002 fix; consumed at filter time by resolvePinnedHide, P1.M2.T2, via the persisted marker's hideEntryIds).
 *
 * ALGORITHM (fix_design.md §Change 2; mirrors how `messages` was built): walk `entries` with a `cursor`; for each
 * entry `e`, `yield = sessionEntryToContextMessages(e).length` (typically 1 for message/custom_message/branch_summary);
 * if ANY index in `[cursor, cursor+yield)` is in `remove`, push `e.id` ONCE and break; then `cursor += yield`. Because
 * `messages = entries.flatMap(sessionEntryToContextMessages)` (resolvePreview, above), entry `e` ↔ `messages[cursor..cursor+yield)`
 * is EXACT BY CONSTRUCTION — no position math. The captured ids are the STABLE anchors Pi gives us (SessionEntryBase.id
 * is a permanent UUID; survives compaction/reload/growth), which is precisely why pinned hiding is permanent where the
 * relative re-resolution model (BUG-001/002) failed.
 *
 * Defensive: non-array `entries`/`remove` → []. Does NOT itself try/catch: it runs inside `resolvePreview` inside
 * rewindExecute's best-effort catch, so a throwing `sessionEntryToContextMessages(e)` propagates → hideEntryIds=[] +
 * emptyLedger + K=0 + the rewind STILL proceeds (E13/E8). Per-entry try/catch is intentionally AVOIDED — it would risk
 * misaligning the cursor (a throwing entry that yields >0 messages would shift every later mapping). Module-local
 * (tested via the tool execute path, like resolvePreview/countRewindMarkers/checkpointExists).
 *
 * @param entries the buildContextEntries() snapshot resolvePreview already built (root→leaf); each e.id is a stable string
 * @param remove  the MESSAGE-INDEX removal set resolvePreview already resolved (number[]); non-array → []
 * @returns the stable ENTRY ids of the entries whose message(s) are in `remove` (each entry at most once); [] if nothing
 */
function captureHideEntryIds(entries: SessionEntry[], remove: readonly number[]): string[] {
  if (!Array.isArray(entries) || !Array.isArray(remove)) return [];
  const removeSet = new Set<number>(remove);
  const ids: string[] = [];
  let cursor = 0;
  for (const e of entries) {
    const y = sessionEntryToContextMessages(e).length; // typically 1 (message/custom_message/branch_summary)
    for (let j = cursor; j < cursor + y; j++) {
      if (removeSet.has(j)) {
        if (e.id) ids.push(e.id); // SessionEntryBase.id is a stable string; guard rejects the empty-string edge
        break; // capture each entry at most once (matters if a future entry type yields >1 message)
      }
    }
    cursor += y;
  }
  return ids;
}

/**
 * resolvePreview — the read-only ledger + K preview (step 5; GOTCHA #5/#6/#7/#8). Builds a SNAPSHOT via
 * `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)` (NOT event.messages — the tool
 * is write-only w.r.t. messages), then mirrors filterPipeline's granularity dispatch (spec/06 §12) to resolve the
 * removal set, and feeds it to extractFileLedger. Returns `{ ledger, k }`.
 *
 * The CALLER wraps this in try/catch → { ledger: emptyLedger(), k: 0 } on ANY failure (GOTCHA #6 — the ledger is
 * ADVISORY; never let an advisory computation block a legitimate rewind). This helper is therefore NOT itself
 * responsible for catching — it lets exceptions propagate to the single caller try/catch. (Keeps the logic readable.)
 *
 * GOTCHA #7: extractFileLedger's `range` is a number[] of MESSAGE INDICES (NOT a [start,end) tuple). The resolver's
 * removal set IS that index list.
 * GOTCHA #8: resolveCheckpoint takes branchEntries DATA (getBranch(), root→leaf), NOT ctx.
 * Module-local.
 */
function resolvePreview(
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId: string,
): { ledger: FileLedger; k: number; hideEntryIds: string[] } {
  const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
  // sessionEntryToContextMessages returns Pi's AgentMessage[]; transforms.ts MessageLike is a Pi-free
  // structural type with a narrower content-block index signature that TS rejects across the boundary.
  // Cast through unknown at this single boundary (the established filter.ts idiom — runtime-identical).
  const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];

  let remove: number[];
  if (params.granularity === "last_tool_call_group") {
    const units = partitionIntoUnits(messages); // re-partition FRESH (filterPipeline GOTCHA #2)
    remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
  } else if (params.granularity === "last_turn") {
    remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;
  } else {
    // checkpoint (existence already verified by the caller; resolveCheckpoint is defensive regardless)
    const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[]; // GOTCHA #8: DATA, not ctx
    remove = resolveCheckpoint(messages, branchEntries, params.checkpoint ?? "", toolCallId)?.remove ?? [];
  }
  const ledger = extractFileLedger(messages, remove); // GOTCHA #7: remove = message indices
  // Pin the STABLE ENTRY ids of the removed messages (fix_design.md §Change 2): the removal set is resolved ONCE
  // against this current snapshot (the correct session state); the captured entry ids are stable forever, so the
  // filter can re-resolve them by identity every later fire (permanent hiding — BUG-001/002 fix).
  const hideEntryIds = captureHideEntryIds(entries, remove);
  return { ledger, k: remove.length, hideEntryIds };
}

// ── execute (spec/05 §1 behavior; shared tool convention = never throws — E13) ─────

/**
 * rewindExecute — the tool body (spec/05 §1 steps 1–9, in order). The WHOLE body is wrapped in ONE try/catch so
 * the tool NEVER throws (E13); any unexpected exception becomes a refusal text describing the failure.
 *
 * `pi` is captured by the `makeRewindTool(pi)` factory closure (it is NOT an execute argument). The execute first
 * arg `toolCallId` becomes `excludeToolCallId` on the persisted marker (GOTCHA #2).
 */
async function rewindExecute(
  pi: ExtensionAPI,
  toolCallId: string,
  params: RewindArgs,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<RewindDetails>> {
  // Defensive: if a caller violates the type and omits params, normalize the granularity for the catch fallback.
  const granularity: Granularity =
    params && (params.granularity === "last_tool_call_group" || params.granularity === "last_turn" || params.granularity === "checkpoint")
      ? params.granularity
      : "last_tool_call_group";
  // [P4.M1.T2.S3] latch the turn index so filter.ts can mute the drift nudge (Nudge B) for the rest of this
  // turn on a refusal. Declared OUTSIDE the main try so the catch (site 9) can also set the flag. The metric
  // is the FILTER's source of truth (the exact value filter.ts will compare against), so read it FROM the
  // same readMarkers(ctx).metric?.turnIndex; rt.lastTurnIndex is the in-memory fallback (same value mid-turn,
  // null post-reload before the first turn_end → metric-first is more robust). E13: any throw leaves nulls
  // → the flag is never set this turn (nudge behaves as before; fail-open).
  let rt: SessionRuntime | null = null;
  let currentTurnIndex: number | null = null;
  try {
    rt = getRuntime(ctx.sessionManager.getSessionId());
    currentTurnIndex = readMarkers(ctx).metric?.turnIndex ?? rt.lastTurnIndex ?? null;
  } catch {
    // E13: leave nulls → flag never set this turn (nudge behaves as before; fail-open).
  }
  try {
    // [P4.M1.T2.S3] DRY: every in-try refusal routes through `refuse()` so the flag is set in ONE place
    // (no site missed). The pure refusal() builder is UNCHANGED (adds the prefix + trailing dot). A
    // SUCCESSFUL rewind never calls refuse() → the flag is left whatever it was. The catch (site 9) sets
    // the flag inline (this closure is out of scope there).
    const refuse = (reason: string, gran: Granularity): AgentToolResult<RewindDetails> => {
      try {
        if (rt !== null && currentTurnIndex !== null) rt.rewindRefusedTurnIndex = currentTurnIndex;
      } catch {
        /* E13 — never throw on the flag-set */
      }
      return refusal(reason, gran);
    };
    // (1) config gate (step 1; E14). GOTCHA #14: read ONCE. Master switch FIRST (E14 master-disable),
    //     then the sub-feature gate. The master `enabled:false` makes the WHOLE extension a no-op
    //     (context pass-through + nudges no-op + tools refuse "Mulligan is disabled").
    const config = getConfig();
    if (!config.enabled) return refuse("Mulligan is disabled", granularity); // E14 master switch
    if (!config.rewind.enabled) return refuse("rewind is disabled", granularity);

    // (2) note validation (step 2; E9). validateNote never throws; NOTE_INVALID_REASON has NO trailing period
    //     (refusal() adds the ".").
    const nv = validateNote((params?.note ?? {}) as NoteInput);
    if (!nv.valid) return refuse(NOTE_INVALID_REASON, granularity);

    // (3) checkpoint existence (step 3; E10). last_tool_call_group / last_turn are always valid.
    if (granularity === "checkpoint") {
      const name = params.checkpoint;
      if (!name || name.length === 0) {
        return refuse("checkpoint granularity requires a checkpoint name", "checkpoint");
      }
      if (!checkpointExists(ctx, name)) {
        return refuse(`checkpoint '${name}' not found on this branch`, "checkpoint");
      }
    }

    // (4) depth guard (step 4; E4). Markers are permanent → ALL persisted rewind markers count toward maxDepth.
    const depth = countRewindMarkers(ctx);
    if (depth >= config.rewind.maxDepth) {
      return refuse(
        `max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene`,
        granularity,
      );
    }

    // (4b) per-prompt retry budget (step 4; E22 hard backstop #1). The marker-counting budget: count
    //     mulligan:rewind markers appended AFTER the latest user-prompt entry (rewinds re-landing at this
    //     prompt). Refuse BEFORE persisting when the count reaches the budget — a self-authored note can
    //     re-instruct the loop's cause, so the note cannot self-correct; only a hard count can arrest it.
    //     Independent of the maxDepth cumulative cap (4) and the context-fraction stop (4c, P4.M1.T2.S2):
    //     all three apply; first refusal wins. countRetriesAtLatestPrompt is defensive (never throws — E13).
    const retries = countRetriesAtLatestPrompt(ctx);
    if (retries >= config.rewind.maxRetriesPerPrompt) {
      return refuse(
        `hit the per-prompt retry budget (${retries}/${config.rewind.maxRetriesPerPrompt} rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again`,
        granularity,
      );
    }

    // (4c) out-of-band context-fraction stop (step 4; E22 hard backstop #2). Catches the ZERO-MARKER loop
    //     vector — a spin that persists no rewind yet re-bloats the filtered context each turn (e.g. re-reading
    //     the same large files because a bloated-result nudge keeps re-firing) — which the marker-counting
    //     budget (4b) CANNOT see. If the filtered-context total is >= abortContextFraction of the window,
    //     rewinding hides near nothing relative to the bloat and just grows the session with another marker +
    //     note → refuse and steer to mulligan_shrink. Independent of maxDepth (4) and the retry budget (4b):
    //     all three apply; first refusal wins. computeFilteredTotal is fail-open (returns {0,0} on any throw);
    //     the windowTokens > 0 check IS the fail-open (no model / undefined usage [E12] / throw → SKIP, never
    //     block a rewind — E13). D5: the total is the FILTERED view, NOT getContextUsage().tokens.
    //
    //     KNOWN ONE-TURN LAG: computeFilteredTotal reads the LAST context-fire's filtered view (snapshot
    //     handed to the previous assistant turn), which EXCLUDES the current turn's just-produced tool
    //     results. So in the exact re-bloat loop this guard targets — a spin that produces fresh large
    //     results each turn — the total it compares is one turn stale and may not yet exceed the fraction.
    //     This is spec-consistent (the current turn's results are not filtered-view-visible until the next
    //     context fire) and the per-prompt retry budget (4b) catches repeated rewinds at the same prompt as
    //     a complementary backstop; documented here so future maintainers don't mistake the lag for a bug.
    const { totalTokens, windowTokens } = computeFilteredTotal(ctx);
    if (windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction) {
      const pct = Math.round((totalTokens / windowTokens) * 100);
      return refuse(
        `context is at ${pct}% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result`,
        granularity,
      );
    }

    // (5) read-only ledger + K preview (step 5; best-effort — GOTCHA #6). A failure falls back to empty ledger +
    //     K=0 + STILL succeeds (the marker spec is what matters; the ledger is ADVISORY).
    let ledger: FileLedger;
    let k: number;
    let hideEntryIds: string[];
    try {
      ({ ledger, k, hideEntryIds } = resolvePreview(ctx, params, toolCallId));
    } catch {
      // Snapshot/resolution failure → best-effort: empty ledger + K=0 + hideEntryIds=[] + STILL proceed (E13/E8).
      // (captureHideEntryIds itself doesn't try/catch — a throw inside resolvePreview lands here.)
      ledger = emptyLedger();
      k = 0;
      hideEntryIds = [];
    }

    // (6) render note (step 6 — note already validated by step 2; renderNote does NOT re-validate).
    const rendered = renderNote((params.note as NoteInput) ?? ({} as NoteInput), ledger, granularity);

    // (7) persist (step 7 — GOTCHA #1: checkpoint MUST be in the payload even though the frozen
    //     RewindMarkerInput TYPE omits it; the wrapper spread preserves it at runtime. GOTCHA #2:
    //     excludeToolCallId === toolCallId.)
    const payload = {
      granularity,
      options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
      excludeToolCallId: toolCallId,
      note: params.note,
      ledger,
      // fix_design.md §Change 2: the stable ENTRY ids pinned for permanent hiding. Typed on RewindMarkerInput
      // (P1.M2.T1.S1), so NO cast needed for THIS field — the `as RewindMarkerInput` cast below stays only for
      // `checkpoint` (GOTCHA #1 — spec/04 §3 omits it; it rides the spread). The wrapper's {...data} persists it.
      hideEntryIds,
      checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined; spec/04 §3 omits it (cast below)
    };
    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput); // cast: frozen type omits checkpoint
    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId

    // (7b) checkpoint consumption — spec/05 §3 step 5 ("Auto-expiry on consumption (REQUIRED)").
    //      ONLY on the checkpoint-granularity success path (step 7 persist + leaveNote already completed).
    //      A checkpoint label (`mulligan:checkpoint:<name>`) is consumed by the rewind that targets it: clear
    //      the label so a second rewind by the same name can't re-target stale state (single-source downstream
    //      effect). Mirrors checkpointExists' defensive scan style (inline `(e as {...})` casts, per-entry
    //      try/catch — no readOwn/isRecord import). E13: the clear is best-effort and its own try/catch — a
    //      label-clear failure must never undo the rewind (the marker is already persisted at step 7).
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries();
        } catch {
          entries = undefined;
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            let isMatch = false;
            let targetId: unknown = undefined;
            try {
              const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
              isMatch = ee.type === "label" && ee.label === needle;
              targetId = ee.targetId;
            } catch {
              continue;
            }
            if (isMatch && typeof targetId === "string" && targetId.length > 0) {
              pi.setLabel(targetId, undefined);
            }
            break;
          }
        }
      } catch {
        // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
      }
    }

    // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
    const hasWarning =
      config.rewind.requireMutationWarning &&
      (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);

    // (9) return success (step 8 — K + K=0 honesty via successText).
    const { text } = successText(granularity, k, hasWarning);
    return {
      content: [{ type: "text", text }],
      details: { granularity, k, ledger, hideEntryIds, markerId },
    };
  } catch (e) {
    // Shared tool convention (E13): never throw — return a text result describing the failure.
    // [P4.M1.T2.S3] the refuse() closure is OUT OF SCOPE in this catch → set the flag inline (mirrors refuse()).
    try {
      if (rt !== null && currentTurnIndex !== null) rt.rewindRefusedTurnIndex = currentTurnIndex;
    } catch {
      /* E13 — never throw on the flag-set */
    }
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, granularity);
  }
}

// ── Factory: the testable `pi`-injection seam (checkpoint.ts precedent) ───────

/**
 * makeRewindTool — the tool factory. Captures `pi` (ExtensionAPI) via closure so `rewindExecute` can call
 * `appendRewindMarker(pi, ctx, …)` / `leaveNote(pi, …)` WITHOUT `pi` being an execute argument. `defineTool`
 * preserves `RewindParams` inference when assigning to a variable.
 *
 * index.ts (P1.M7.T1.S1) will do: `pi.registerTool(makeRewindTool(pi));`.
 * Unit tests do: `const tool = makeRewindTool(fakePi);`.
 */
export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails> {
  return defineTool({
    name: "mulligan_rewind",
    label: "Mulligan Rewind",
    description: REWIND_DESC, // spec/05 §5 VERBATIM
    parameters: RewindParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx); // pi captured via closure
    },
  });
}