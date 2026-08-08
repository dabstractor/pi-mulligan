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
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { appendRewindMarker, leaveNote, type RewindMarkerInput } from "../markers.js"; // GOTCHA #13: .js
import { validateNote, renderNote, NOTE_INVALID_REASON, type NoteInput } from "../notes.js";
import { extractFileLedger, type FileLedger } from "../ledger.js";
import { getConfig, type Granularity } from "../config.js"; // GOTCHA #14: read ONCE at the top of execute
import {
  partitionIntoUnits,
  resolveLastToolCallGroup,
  resolveLastTurn,
  resolveCheckpoint,
  type BranchEntry,
  type MessageLike,
} from "../transforms.js";

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
 * GOTCHA #8: resolveCheckpoint takes branchEntries DATA (getBranch(), leaf→root), NOT ctx.
 * Module-local.
 */
function resolvePreview(
  ctx: ExtensionContext,
  params: RewindArgs,
  toolCallId: string,
): { ledger: FileLedger; k: number } {
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
  return { ledger, k: remove.length };
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
  try {
    // (1) config gate (step 1; E14). GOTCHA #14: read ONCE.
    const config = getConfig();
    if (!config.rewind.enabled) return refusal("rewind is disabled", granularity);

    // (2) note validation (step 2; E9). validateNote never throws; NOTE_INVALID_REASON has NO trailing period
    //     (refusal() adds the ".").
    const nv = validateNote((params?.note ?? {}) as NoteInput);
    if (!nv.valid) return refusal(NOTE_INVALID_REASON, granularity);

    // (3) checkpoint existence (step 3; E10). last_tool_call_group / last_turn are always valid.
    if (granularity === "checkpoint") {
      const name = params.checkpoint;
      if (!name || name.length === 0) {
        return refusal("checkpoint granularity requires a checkpoint name", "checkpoint");
      }
      if (!checkpointExists(ctx, name)) {
        return refusal(`checkpoint '${name}' not found on this branch`, "checkpoint");
      }
    }

    // (4) depth guard (step 4; E4). Markers are permanent → ALL persisted rewind markers count toward maxDepth.
    const depth = countRewindMarkers(ctx);
    if (depth >= config.rewind.maxDepth) {
      return refusal(
        `max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene`,
        granularity,
      );
    }

    // (5) read-only ledger + K preview (step 5; best-effort — GOTCHA #6). A failure falls back to empty ledger +
    //     K=0 + STILL succeeds (the marker spec is what matters; the ledger is ADVISORY).
    let ledger: FileLedger;
    let k: number;
    try {
      ({ ledger, k } = resolvePreview(ctx, params, toolCallId));
    } catch {
      ledger = emptyLedger();
      k = 0;
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
      checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined; spec/04 §3 omits it (cast below)
    };
    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput); // cast: frozen type omits checkpoint
    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId

    // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
    const hasWarning =
      config.rewind.requireMutationWarning &&
      (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);

    // (9) return success (step 8 — K + K=0 honesty via successText).
    const { text } = successText(granularity, k, hasWarning);
    return {
      content: [{ type: "text", text }],
      details: { granularity, k, ledger, markerId },
    };
  } catch (e) {
    // Shared tool convention (E13): never throw — return a text result describing the failure.
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