/**
 * rewind.ts — the `mulligan_rewind` agent-callable tool (spec/05 §1; spec/04 §3; spec/08 E1–E15).
 *
 * THE "MULLIGAN" ITSELF — the headline operation. When the agent realizes a recent tool interaction was a
 * bloated mistake or a whole turn pursued the wrong direction, it calls this tool with a structured three-field
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
import {
  appendRewindMarker,
  leaveNote,
  type RewindMarkerInput,
  type RewindMarker,
  type RevertCheckpoint,
} from "../markers.js"; // GOTCHA #13: .js
import type { RestoreResult } from "../snapshot/store.js"; // [P4.M2.T1.S2] fold the 5-bucket RestoreResult into text + marker
import {
  validateNote,
  renderNote,
  NOTE_INVALID_REASON,
  type NoteInput,
} from "../notes.js";
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
 * RewindParams>` === `{ note: NoteInput, granularity, checkpoint? }`. EXPORTED for tests +
 * the index.ts wiring step.
 */
export const RewindParams = Type.Object({
  note: Type.Object(
    {
      what_happened: Type.String({
        description:
          "Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson.",
      }),
      true_current_state: Type.String({
        description:
          "The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work.",
      }),
      next: Type.String({
        description:
          "Imperative: the immediate next action to take when you resume.",
      }),
    },
    {
      description:
        "The note your resumed self will read. All three fields required.",
    },
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
  checkpoint: Type.Optional(
    Type.String({
      description:
        "Required when granularity=checkpoint. The name of a checkpoint set via mulligan_checkpoint.",
    }),
  ),

  // ── v1.2 working-tree revert (opt-in). See @14-working-tree-revert.md. ──
  revert_file_changes: Type.Optional(
    Type.Boolean({
      description:
        "v1.2 OPT-IN. When true (granularity last_turn/checkpoint), restore the working-tree files you modified in the rewound span to their pre-span state, so you need not re-read them on resume. Best-effort; failures are logged and never block the rewind. Requires revert to be enabled in config. Ignored at last_tool_call_group granularity (noticed in the result).",
    }),
  ),
  delete_created_files: Type.Optional(
    Type.Boolean({
      description:
        "v1.2 OPT-IN, DESTRUCTIVE. When true, DELETE working-tree files the rewound span newly created (files that did not exist before the span). Requires BOTH this flag AND config.revert.allowDeleteCreatedFiles. Best-effort.",
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
  "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only)."; // v1.2 append: spec/05 §6 revert_file_changes advertisement sentence

// ── Mutation warning (spec/08 E5 — VERBATIM warning string) ──────────────────

/**
 * MUTATION_WARNING — the spec/08 E5 VERBATIM warning appended to the success text when the hidden span contained
 * side-effecting work (writes/bash) AND config.rewind.requireMutationWarning is true. The leading space + ⚠ are
 * load-bearing (do NOT rephrase). Module-local.
 */
const MUTATION_WARNING =
  "⚠ The hidden span modified files/ran side-effecting commands (see note). " +
  "Those effects PERSIST on disk; do not blindly redo them.";

/**
 * MUTATION_WARNING_REVERTED — the v1.2 reworded E5 warning (spec/08 E5 v1.2 clause; spec/05 §1 step 7
 * v1.2; @14 §7). Used INSTEAD of MUTATION_WARNING when step 6b REVERTED files
 * (revertSummaryDetails.reverted > 0): the FILE-STATE portion of the hidden span's effects was restored
 * to its pre-span state, so the warning names ONLY the non-filesystem effects that still persist on
 * disk (commits made, dependency installs, network/DB/process effects, staged index changes) + any
 * files in the restore's `failed`/`refused` buckets (which were NOT restored). A reverted `sed` edit
 * persists no more than a reverted `edit` — so the original "Those effects PERSIST" wording would be
 * FALSE after a successful revert. Leading space + ⚠ are load-bearing (do NOT rephrase). Module-local.
 * VERBATIM from the item contract (P4.M2.T2.S1).
 */
const MUTATION_WARNING_REVERTED =
  "⚠ The hidden span ran side-effecting commands (see note). " +
  "Non-filesystem effects PERSIST on disk (commits made, dependency installs, network/DB/process effects, staged index changes). " +
  "Any files in 'failed' or 'refused' were NOT restored — do not blindly redo those. " +
  "All other file modifications were reverted to their pre-span state.";

/**
 * RevertDecision — the outcome of step 6b's working-tree-revert decision tree (spec/05 §1 step 6b;
 * @14 §6/§7). S1 (this item, P4.M2.T1.S1) computes the decision; S2 (P4.M2.T1.S2) consumes the "proceed"
 * variant to call `store.restore` + fold the `RestoreResult` into the marker's `revert` field + the
 * success text. Module-local (NOT exported) — widened to an exported type only when S2 lands. The
 * "refuse"/"skip" variants are terminal in S1 (a notice is appended to the success text; no restore runs).
 *
 * NOTE: in S1 the proceed branch does NOT assign a `RevertDecision` value (it is a comment-seam for S2) —
 * the type is declared for readability + to pin the S2 contract. TS erases unused type declarations, so
 * `noUnusedLocals` (which targets VALUES, not type declarations) does NOT flag it. (CRITICAL #10.)
 */
type RevertDecision =
  | {
      decision: "proceed";
      checkpoint: RevertCheckpoint;
      affectedPaths: string[];
      afterRef: string;
      revertFileChanges: boolean;
      deleteCreatedFiles: boolean;
    }
  | { decision: "refuse"; driftedPaths: string[] }
  | { decision: "skip" };

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
  /** True iff step 6b's dirty guard REFUSED the file-revert (drift detected post-turn — @14 §6 step 3, E30).
   *  Consumed by P4.M2.T2.T1 (the mutation-warning reword) + surfaced in logs/audit. `undefined` on the success
   *  path when the guard did not refuse (no drift / no snapshot / disabled / no flags). True ONLY on the refuse
   *  branch. (P4.M2.T1.S1.) */
  revertRefused?: boolean;
  /**
   * v1.2 working-tree revert summary (step 6b proceed branch only — present iff store.restore ran). Carries the
   * 5-bucket COUNTS + the backend so the E5 mutation-warning reword (P4.M2.T2.T1) can decide whether files were
   * reverted WITHOUT re-reading the persisted marker, and so logs/audit surface the outcome. Undefined on every
   * non-proceed branch (disabled / group-granularity / missing-checkpoint / refuse / no flags). Built from the
   * RestoreResult at the seam (before the skipped COUNT is folded into the marker's `skipped` boolean). (P4.M2.T1.S2.)
   */
  revertSummary?: {
    reverted: number;
    deleted: number;
    failed: number;
    skipped: number;
    refused: number;
    backend: "git" | "cas" | "none";
  };
}

/**
 * refusal — build a fail-open text result for any refusal / wrapper-reported-failure / unexpected-error case.
 * ALWAYS includes `details` (CRITICAL GOTCHA #4). The shared convention prefixes every refusal with
 * "Mulligan: refused — " (and closes the sentence with ".") so the agent can pattern-match a refusal regardless
 * of the underlying reason. NOTE: the caller passes a reason with NO trailing period (NOTE_INVALID_REASON has none);
 * this helper adds the ".".
 */
function refusal(
  reason: string,
  granularity: Granularity,
): AgentToolResult<RewindDetails> {
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
 *
 * [P4.M2.T1.S1] `revertClause` (default "") threads step 6b's terminal-branch notices (skip/refuse) into the text.
 * It is appended AFTER "Note left." and BEFORE the mutation warning (the revert result is more rewind-coupled
 * than the side-effect caveat); the no-flags path passes "" ⇒ byte-identical to the v1.1 output. The "Reverted X
 * file(s)…" proceed-branch clause is P4.M2.T1.S2's responsibility (S2 sets `revertClause` after `store.restore`).
 */
function successText(
  granularity: Granularity,
  k: number,
  hasWarning: boolean,
  revertClause = "",
  filesReverted = false, // [P4.M2.T2.S1] v1.2 reverted-span wording selector
): { text: string } {
  const kClause =
    k === 0
      ? "0 messages will be hidden from your view starting next turn (nothing matched to hide)"
      : `${k} messages will be hidden from your view starting next turn`;
  let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
  if (revertClause) text += " " + revertClause; // [P4.M2.T1.S1] v1.2 revert notice (terminal branches)
  if (hasWarning) {
    // spec/08 E5 VERBATIM; [P4.M2.T2.S1] v1.2: when step 6b reverted files, the file-state portion of
    // the effects was restored → name ONLY the non-filesystem effects that still persist.
    text +=
      " " + (filesReverted ? MUTATION_WARNING_REVERTED : MUTATION_WARNING);
  }
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
 * where `type === "custom" && customType === "mulligan:rewind"`; return the count of ACTIVE markers, EXCLUDING
 * rewinds retired by a `mulligan:cancel` (BUG-004: spec/05 §1 step 4 says "count ACTIVE"). Markers are now
 * retractable via mulligan_cancel (E21 amends D6), so a cancelled rewind (its data.id ∈ the cancel targetIds)
 * does NOT count toward maxDepth — the cancel-then-retry workflow must not be blocked at 5 cumulative rewinds.
 * Mirrors countRetriesAtLatestPrompt's BUG-005 fix and readMarkers' cancelledIds (src/filter.ts). Defensive
 * (never throws; a throwing-Proxy entry or a non-array → the entry is skipped / the count is 0). A rewind with
 * an unreadable data.id is COUNTED (never exclude on bad data). Module-local.
 */
function countRewindMarkers(ctx: ExtensionContext): number {
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return 0; // never let the depth guard throw
  }
  if (!Array.isArray(entries)) return 0;

  // BUG-004: collect the uuid ids of rewinds RETIRED by a mulligan:cancel on the branch, so cancelled rewinds
  // are excluded from the cumulative depth count (spec/05 §1 step 4 "count ACTIVE"). Mirrors the cancel-
  // exclusion in countRetriesAtLatestPrompt (the BUG-005 fix) and readMarkers' cancelledIds (src/filter.ts):
  // scan ALL entries (the depth guard is cumulative across the whole branch, not per-prompt), read
  // data.targetId defensively. A malformed cancel (non-string / empty / missing targetId) is skipped
  // (fail-open, never throw).
  const cancelledRewindIds = new Set<string>();
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as {
        type?: unknown;
        customType?: unknown;
        data?: { targetId?: unknown };
      };
      if (ee.type === "custom" && ee.customType === "mulligan:cancel") {
        const targetId = ee.data?.targetId;
        if (typeof targetId === "string" && targetId.length > 0)
          cancelledRewindIds.add(targetId);
      }
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }

  // Count ACTIVE (non-cancelled) mulligan:rewind markers across the WHOLE branch. A rewind whose data.id ∈
  // cancelledRewindIds is SKIPPED (retired by a cancel). A rewind with an unreadable data.id is COUNTED —
  // never exclude on bad data (defensive polarity matches readMarkers' "keep on bad id" /
  // countRetriesAtLatestPrompt: here "keep" = "count", the conservative direction for a depth guard).
  let count = 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as {
        type?: unknown;
        customType?: unknown;
        data?: { id?: unknown };
      };
      if (ee.type === "custom" && ee.customType === "mulligan:rewind") {
        const id = ee.data?.id;
        if (typeof id === "string" && cancelledRewindIds.has(id)) continue; // cancelled → skip
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
 * AFTER the latest user message = rewinds during this turn that re-land at the prompt), EXCLUDING rewinds
 * retired by a `mulligan:cancel` (BUG-005: a cancelled rewind never took effect → it did not re-land at the
 * prompt, so it must not consume budget). Returns 0 when there is no user-message entry (no prompt → no
 * budget consumption). Defensive (never throws; a throwing-Proxy entry, a non-array, or a throwing getEntries
 * → the entry is skipped / the count is 0). Module-local.
 *
 * CANCEL-EXCLUSION (BUG-005): before counting, scans the same post-prompt slice for `mulligan:cancel` entries
 * and collects their `data.targetId` into a Set (mirrors readMarkers' `cancelledIds` in src/filter.ts — the
 * same uuid-by-targetId mechanism that drops cancelled markers from the filter). A rewind whose `data.id` is
 * in that Set is skipped. Order-independent (full cancel scan, then count). A rewind with an unreadable
 * `data.id` is COUNTED — never exclude on bad data (defensive polarity matches readMarkers' "keep on bad id";
 * here "keep" = "count", the conservative direction for a retry budget).
 *
 * OVER-APPROXIMATION (v1 entry-position): for `last_tool_call_group`/`checkpoint` rewinds this counts a rewind
 * issued THIS turn even if its resolved target was a PRIOR turn's group (the marker is appended at the end
 * regardless). The spec's intent — arrest the same-prompt loop — is met; precise message-list resolution
 * (excluding a tool-group rewind whose target precedes the latest prompt) is a future refinement. (Cancelled
 * rewinds, by contrast, ARE now excluded — see CANCEL-EXCLUSION above.) Advancing to a new user prompt
 * naturally resets the count (the new prompt becomes the latest → prior rewinds are before it).
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
      if (ee.type === "message" && ee.message?.role === "user")
        latestPromptIndex = i;
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption

  // BUG-005: collect the uuid ids of rewinds RETIRED by a mulligan:cancel on the branch, so cancelled rewinds
  // are excluded from the budget (a cancelled rewind never took effect → it did not re-land at the prompt).
  // Mirrors readMarkers' cancelledIds (src/filter.ts): scan ALL cancel entries after the latest prompt
  // (order-independent — a cancel may appear after the rewind it retires), read data.targetId defensively.
  // A malformed cancel (non-string / empty / missing targetId) is skipped (fail-open, never throw).
  const cancelledRewindIds = new Set<string>();
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as {
        type?: unknown;
        customType?: unknown;
        data?: { targetId?: unknown };
      };
      if (ee.type === "custom" && ee.customType === "mulligan:cancel") {
        const targetId = ee.data?.targetId;
        if (typeof targetId === "string" && targetId.length > 0)
          cancelledRewindIds.add(targetId);
      }
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }

  // Count ACTIVE (non-cancelled) mulligan:rewind markers appended AFTER the latest user prompt. A rewind
  // whose data.id ∈ cancelledRewindIds is SKIPPED (retired by a cancel). A rewind with an unreadable data.id
  // is COUNTED — never exclude on bad data (defensive polarity matches readMarkers' "keep on bad id": here
  // "keep" = "count", the conservative direction for a retry budget).
  let count = 0;
  for (let i = latestPromptIndex + 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as {
        type?: unknown;
        customType?: unknown;
        data?: { id?: unknown };
      };
      if (ee.type === "custom" && ee.customType === "mulligan:rewind") {
        const id = ee.data?.id;
        if (typeof id === "string" && cancelledRewindIds.has(id)) continue; // cancelled → skip
        count++;
      }
    } catch {
      // a throwing-Proxy entry → skip (never throw on the tool hot path)
    }
  }
  return count;
}

/**
 * checkpointExists — the checkpoint-existence check (step 3, E10). A checkpoint is ACTIVE iff its label
 * currently maps to the `mulligan:checkpoint:<name>` string in Pi's LATEST-WINS label map. That map is
 * append-only in the raw entry stream (a `setLabel(id, undefined)` appends a clear entry), so scanning raw
 * `getEntries()` for a string match would find the HISTORICAL label even after it was consumed (validation
 * issue 1b). Pi's `ctx.sessionManager.getLabel(id)` applies the latest-wins semantics: it returns `undefined`
 * once a clear entry follows the set, which is exactly the consumed state we must refuse. We therefore walk
 * raw entries to discover candidate `label` targets, then ask `getLabel(targetId)` whether each is CURRENTLY
 * active. Defensive (never throws — a throwing getEntries/getLabel/Proxy trap → false). Module-local.
 *
 * @param ctx  the Pi ExtensionContext (getEntries to discover candidates; getLabel for latest-wins resolution)
 * @param name the checkpoint name (the suffix after `mulligan:checkpoint:`)
 * @returns true iff some entry's label target currently maps to `mulligan:checkpoint:<name>`
 */
function checkpointExists(ctx: ExtensionContext, name: string): boolean {
  const needle = `mulligan:checkpoint:${name}`;
  // Collect candidate targetIds from raw label entries whose label string === needle (a cleared checkpoint
  // still has the historical set entry in the raw stream, so we discover the candidate here and confirm via
  // getLabel below). Use a Set so a target cleared-then-reset is checked once.
  const candidates = new Set<string>();
  let entries: unknown;
  try {
    entries = ctx.sessionManager.getEntries();
  } catch {
    return false; // never let the existence check throw
  }
  if (!Array.isArray(entries)) return false;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
      if (
        ee.type === "label" &&
        ee.label === needle &&
        typeof ee.targetId === "string" &&
        ee.targetId.length > 0
      ) {
        candidates.add(ee.targetId);
      }
    } catch {
      // skip a throwing-Proxy entry
    }
  }
  if (candidates.size === 0) return false;
  // Confirm ACTIVITY via Pi's latest-wins map (validation issue 1b): getLabel returns the CURRENT label,
  // undefined once a clear entry follows the set. getLabel is part of ReadonlySessionManager (always present).
  for (const id of candidates) {
    try {
      if (ctx.sessionManager.getLabel(id) === needle) return true;
    } catch {
      // a throwing getLabel → treat this candidate as inactive (never throw on the tool hot path)
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
function captureHideEntryIds(
  entries: SessionEntry[],
  remove: readonly number[],
): string[] {
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
  const messages = entries.flatMap((e) =>
    sessionEntryToContextMessages(e),
  ) as unknown as MessageLike[];

  let remove: number[];
  if (params.granularity === "last_tool_call_group") {
    const units = partitionIntoUnits(messages); // re-partition FRESH (filterPipeline GOTCHA #2)
    remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
  } else if (params.granularity === "last_turn") {
    remove = resolveLastTurn(messages, toolCallId).remove;
  } else {
    // checkpoint (existence already verified by the caller; resolveCheckpoint is defensive regardless)
    const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[]; // GOTCHA #8: DATA, not ctx
    remove =
      resolveCheckpoint(
        messages,
        branchEntries,
        params.checkpoint ?? "",
        toolCallId,
      )?.remove ?? [];
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
    params &&
    (params.granularity === "last_tool_call_group" ||
      params.granularity === "last_turn" ||
      params.granularity === "checkpoint")
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
    currentTurnIndex =
      readMarkers(ctx).metric?.turnIndex ?? rt.lastTurnIndex ?? null;
  } catch {
    // E13: leave nulls → flag never set this turn (nudge behaves as before; fail-open).
  }
  try {
    // [P4.M1.T2.S3] DRY: every in-try refusal routes through `refuse()` so the flag is set in ONE place
    // (no site missed). The pure refusal() builder is UNCHANGED (adds the prefix + trailing dot). A
    // SUCCESSFUL rewind never calls refuse() → the flag is left whatever it was. The catch (site 9) sets
    // the flag inline (this closure is out of scope there).
    const refuse = (
      reason: string,
      gran: Granularity,
    ): AgentToolResult<RewindDetails> => {
      try {
        if (rt !== null && currentTurnIndex !== null)
          rt.rewindRefusedTurnIndex = currentTurnIndex;
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
    if (!config.rewind.enabled)
      return refuse("rewind is disabled", granularity);

    // (2) note validation (step 2; E9). validateNote never throws; NOTE_INVALID_REASON has NO trailing period
    //     (refusal() adds the ".").
    const nv = validateNote((params?.note ?? {}) as NoteInput);
    if (!nv.valid) return refuse(NOTE_INVALID_REASON, granularity);

    // (3) checkpoint existence (step 3; E10). last_tool_call_group / last_turn are always valid.
    if (granularity === "checkpoint") {
      const name = params.checkpoint;
      if (!name || name.length === 0) {
        return refuse(
          "checkpoint granularity requires a checkpoint name",
          "checkpoint",
        );
      }
      if (!checkpointExists(ctx, name)) {
        return refuse(
          `checkpoint '${name}' not found on this branch`,
          "checkpoint",
        );
      }
    }

    // (4) depth guard (step 4; E4). countRewindMarkers counts ACTIVE rewind markers (cancelled rewinds are excluded — BUG-004; spec/05 §1 step 4 "count active").
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
    if (
      windowTokens > 0 &&
      totalTokens / windowTokens >= config.rewind.abortContextFraction
    ) {
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
    const rendered = renderNote(
      (params.note as NoteInput) ?? ({} as NoteInput),
      ledger,
      granularity,
    );

    // (The step-7 persist block was RELOCATED to AFTER step 6b by P4.M2.T1.S2 so the `revert` field folds into
    //     the ORIGINAL marker entry — the session tree is append-only (C7), so an already-persisted marker cannot
    //     be amended. leaveNote stays paired with persist (correlates via markerId). See step 7 below.)

    // (6b) working-tree revert decision tree — v1.2, opt-in (spec/05 §1 step 6b; @14 §6/§7). Runs AFTER note render
    //      (step 6) and BEFORE marker persist (step 7) + checkpoint consumption (step 7b) + the mutation warning
    //      (step 8). [P4.M2.T1.S2] RE-ORDERED the persist to AFTER 6b so the `revert` block folds into the ORIGINAL
    //      marker entry (the session tree is append-only — C7). S1 (P4.M2.T1.S1) computes the DECISION: gate on
    //      config → gate on granularity → resolve the RevertCheckpoint from rt.snapshots → run the dirty guard
    //      (store.dirtyCheck) against the ledger's modified-file set → produce a proceed/refuse/skip decision + the
    //      success-text notices for every terminal branch. [BUG-001 fix, P1.M1.T1.S1]: the dirty guard is
    //      CONDITIONAL on checkpoint.afterRef existing (spec/14 §6 step 3) — skipped (restore proceeds) for
    //      checkpoint-granularity rewinds, which capture once and have no afterRef. S2 (P4.M2.T1.S2) FILLS the proceed seam: calls
    //      store.restore + folds the RestoreResult into the success text (revertClause) + the marker's revert
    //      block (revertBlock) + RewindDetails.revertSummary. Best-effort: a 6b failure (e.g. a thrown dirtyCheck)
    //      degrades to a skip notice; the rewind ALWAYS completes (E13/E27/E30).
    //      Branch order is LOAD-BEARING (spec/05 §1 step 6b): config → granularity → resolve → guard → proceed.
    //      The Map keys are "turn" (last_turn) + "ckpt:"+name (checkpoint) — NOT "checkpoint:"+name (the runtime
    //      docstrings are imprecise; the actual writers are capture.ts + commands.ts).
    let revertClause = "";
    let revertRefused = false;
    // [P4.M2.T1.S2] accumulators read by BOTH the proceed seam (assigns them) and the relocated persist (step 7,
    //      after this block — reads revertBlock). Declared at 6b-block-top scope (function/try scope) so the
    //      persist site — which now runs AFTER 6b — can see them. `undefined` on every non-proceed branch ⇒ the
    //      marker has NO revert field (JSON.stringify omits it; readOwn falsy) + revertSummary is undefined.
    let revertBlock: RewindMarker["revert"];
    let revertSummaryDetails: RewindDetails["revertSummary"];
    const wantRevert =
      !!params.revert_file_changes || !!params.delete_created_files;
    if (wantRevert) {
      try {
        if (!config.revert.enabled) {
          // branch (2): disabled in config (layer-1 gate) — append the disabled notice; skip.
          revertClause = "(file revert requested but disabled in config)";
        } else if (granularity === "last_tool_call_group") {
          // branch (3): unsupported granularity — last_tool_call_group hides one tool interaction, not a whole
          //     turn's file changes; append the granularity-mismatch notice; skip.
          revertClause =
            "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.";
        } else {
          // branch (4)+(5)+(6): resolve the checkpoint + run the dirty guard.
          const store = rt?.store;
          // CRITICAL #2: the Map keys are "turn" + "ckpt:"+name (NOT "checkpoint:"+name).
          const key =
            granularity === "checkpoint" ? `ckpt:${params.checkpoint}` : "turn";
          const checkpoint = rt?.snapshots?.get(key);
          if (!store || !checkpoint) {
            // branch (4): no store (revert disabled at detection) OR no checkpoint for this boundary → skip with
            //     an honest count (0 reverted); the rewind still proceeds (@14 §6 step 1).
            revertClause =
              "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)";
          } else {
            // branch (5)+(6): resolve the checkpoint + run the (CONDITIONAL) dirty guard + proceed.
            // CRITICAL #3: affectedPaths = ledger.modifiedFiles (the only deterministic file list available at
            //     this point — the SnapshotStore exposes no diff/listChanged method). Best-effort approximation
            //     of "files restore would touch"; documented limitation in the PRP. Passing [] would make git.ts
            //     trivially return [] (guard always passes), so modifiedFiles (possibly empty) is strictly better.
            //     [BUG-004 / P1.M4 will later derive this from store.changedPaths(beforeRef) — left as the
            //     heuristic here, unchanged by BUG-001.]
            const affectedPaths = ledger.modifiedFiles;

            // [BUG-001 fix, P1.M1.T1.S1] Restore + RestoreResult folding. FACTORED into a local async closure
            //   so it runs on BOTH proceed paths: (a) afterRef exists AND dirtyCheck is clean, (b) NO afterRef
            //   (checkpoint granularity — checkpoints capture ONCE, so there is no post-turn baseline to
            //   dirty-check against). store.restore NEVER throws (E27 — per-path failures land in failed[]);
            //   a hypothetical throw is caught by the enclosing inner try/catch → E13 skip notice. restore
            //   ALWAYS uses checkpoint.beforeRef (the PRE-span state), NEVER the dirty-guard afterRef.
            //   allowDeleteCreatedFiles is gated INSIDE the backend (git.ts ~693 `opts.deleteCreatedFiles &&
            //   this.cfg.allowDeleteCreatedFiles`) — pass the per-call flag verbatim; do NOT read
            //   config.revert.allowDeleteCreatedFiles here (double-gate). `revert: revertBlock` rides the
            //   existing `as RewindMarkerInput` cast. skipped string[] → boolean for the marker.
            //   GOTCHA #1: `store`/`checkpoint` are `const`-narrowed → type-check inside this closure.
            const doRestore = async (): Promise<void> => {
              // PROCEED — dirty guard clean. [P4.M2.T1.S2] perform the working-tree restore + fold the
              //     RestoreResult into the success text (revertClause) + the marker's revert block (revertBlock)
              //     + RewindDetails.revertSummary (revertSummaryDetails).
              const restoreResult: RestoreResult = await store.restore(
                checkpoint.beforeRef,
                {
                  revertFileChanges: params.revert_file_changes === true, // CRITICAL #3: no tool-side gate
                  deleteCreatedFiles: params.delete_created_files === true,
                },
              );
              // CRITICAL #2: the revert block rides the spread into the ORIGINAL marker (persist runs after 6b).
              revertBlock = {
                revertedFiles: restoreResult.reverted,
                deletedFiles: restoreResult.deleted,
                failedFiles: restoreResult.failed,
                refusedFiles: restoreResult.refused,
                skipped: restoreResult.skipped.length > 0, // CRITICAL #7: string[] → boolean
                backend: store.describe().backend, // "git" | "cas" | "none" — typed match
              };
              // Stash the COUNT summary for RewindDetails BEFORE the skipped count is folded into the boolean
              //     above (the count is lost once folded). Consumed by P4.M2.T2.T1 (the warning reword) so it need
              //     not re-read the persisted marker.
              revertSummaryDetails = {
                reverted: restoreResult.reverted.length,
                deleted: restoreResult.deleted.length,
                failed: restoreResult.failed.length,
                skipped: restoreResult.skipped.length,
                refused: restoreResult.refused.length,
                backend: revertBlock.backend,
              };
              // CRITICAL #6: NO leading space (successText() does `text += " " + revertClause`). The clause is
              //     VERBATIM spec/05 §1 step 6b + spec/14 §7.
              revertClause =
                `Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; ` +
                `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, ` +
                `${restoreResult.refused.length} refused (see log).`;
            };

            // [BUG-001 fix, P1.M1.T1.S1] afterRef is OPTIONAL (RevertCheckpoint.afterRef?: string). Turns set
            //   it post agent_end; checkpoints NEVER set it (single capture). The PREVIOUS code fell back to
            //   `?? checkpoint.beforeRef` (the pre-checkpoint tree), which made dirtyCheck compare the CURRENT
            //   tree to the PRE-checkpoint tree → the agent's OWN intervening file work was flagged as drift →
            //   the file-revert was REFUSED on every real checkpoint span (BUG-001). Per spec/14 §6 step 3 the
            //   dirty guard is CONDITIONAL on afterRef existing — NO fallback. When afterRef is absent
            //   (checkpoint granularity) the guard is SKIPPED and restore proceeds directly.
            const afterRef = checkpoint.afterRef;
            if (afterRef) {
              // Dirty guard (pre-flight) — REFUSE on ANY drift vs the post-turn baseline (spec/14 §6 step 3).
              // CRITICAL #4: dirtyCheck is ASYNC. Returns the subset of `paths` that drifted vs afterRef.
              const driftedPaths = await store.dirtyCheck(
                afterRef,
                affectedPaths,
              );
              if (driftedPaths.length > 0) {
                // CRITICAL #5: REFUSE THE WHOLE file-revert on ANY drift (not per-path — @14 §6 step 3). The
                //     context rewind still proceeds; only the file-revert is refused. revertRefused=true
                //     signals P4.M2.T2.T1 (the conditional E5 mutation-warning reword).
                revertRefused = true;
                revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`;
              } else {
                // PROCEED — dirty guard clean.
                await doRestore();
              }
            } else {
              // No afterRef (checkpoint granularity) — skip the dirty guard entirely and proceed to restore.
              //   spec/14 §6 step 3: the guard runs only "if afterRef exists"; checkpoints capture once, so
              //   there is no post-span baseline to compare against. (BUG-001 fix — was: refused every time.)
              await doRestore();
            }
          }
        }
      } catch {
        // CRITICAL #7: E13 fail-open for 6b. A thrown dirtyCheck (network/disk IO) degrades to a SKIP notice
        //     rather than bubbling to the outer "unexpected error" refusal (which would mislabel a file-revert
        //     hiccup as a rewind failure). The rewind ALWAYS completes. Only set the notice if no terminal
        //     branch already produced one (defensive — order-independent).
        if (!revertClause)
          revertClause =
            "(file revert skipped: an error occurred — 0 files reverted)";
      }
    }

    // (7) persist (step 7 — GOTCHA #1: checkpoint MUST be in the payload even though the frozen
    //     RewindMarkerInput TYPE omits it; the wrapper spread preserves it at runtime. GOTCHA #2:
    //     excludeToolCallId === toolCallId.) [P4.M2.T1.S2] RELOCATED to AFTER step 6b (was before it in S1) so
    //     the `revert` field (built in 6b's proceed branch) folds into the ORIGINAL marker entry — the session
    //     tree is append-only (C7), so an already-persisted marker cannot be amended (no follow-up audit entry).
    //     CRITICAL #2: `revert: revertBlock` rides the EXISTING `as RewindMarkerInput` cast (the field IS in
    //     RewindMarkerInput). `revert: undefined` (non-proceed branches) is type-safe; JSON.stringify omits it.
    const payload = {
      granularity,
      options: { protect: config.rewind.protectedRoles },
      excludeToolCallId: toolCallId,
      note: params.note,
      ledger,
      // fix_design.md §Change 2: the stable ENTRY ids pinned for permanent hiding. Typed on RewindMarkerInput
      // (P1.M2.T1.S1), so NO cast needed for THIS field — the `as RewindMarkerInput` cast below stays only for
      // `checkpoint` (GOTCHA #1 — spec/04 §3 omits it; it rides the spread). The wrapper's {...data} persists it.
      hideEntryIds,
      checkpoint: params.checkpoint, // GOTCHA #1: persists even when undefined; spec/04 §3 omits it (cast below)
      revert: revertBlock, // [P4.M2.T1.S2] revert audit block; undefined ⇒ omitted in JSON (non-proceed branches)
    };
    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput); // cast: frozen type omits checkpoint
    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId

    // (7b) checkpoint consumption — spec/05 §3 step 5 ("Auto-expiry on consumption (REQUIRED)").
    //      ONLY on the checkpoint-granularity success path (step 7 persist + leaveNote already completed).
    //      A checkpoint label (`mulligan:checkpoint:<name>`) is consumed by the rewind that targets it: clear
    //      the label so a second rewind by the same name can't re-target stale state (single-source downstream
    //      effect). Mirrors checkpointExists' pattern EXACTLY (this file, lines ~302-336): (1) collect candidate
    //      targetIds from raw label entries whose label string === needle; (2) confirm each via
    //      getLabel(id)===needle (Pi's latest-wins map — undefined once a clear follows the set); (3) clear each
    //      CURRENTLY-active target. There is NO break: Pi's labelsById is Map<targetId,label> with NO
    //      cross-target uniqueness, so when the same name is set on two targets BOTH carry the label and BOTH
    //      must be cleared or checkpointExists stays true via the survivor (BUG-001 — the old
    //      break-after-first-clear cleared only the oldest target, while resolveCheckpoint targets the newest).
    //      Defensive inline `(e as {...})` casts + per-entry try/catch (no readOwn/isRecord import — matches
    //      the file's idiom). E13: best-effort, own try/catch + per-candidate try/catch — a label-clear failure
    //      must never undo the rewind (the marker is already persisted at step 7).
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        // (1) collect candidate targetIds whose raw label string === needle (a cleared checkpoint still has
        //     the historical set entry in the raw stream; getLabel below confirms current activity). Set → a
        //     target set twice (or cleared-then-reset) is collected once.
        const candidates = new Set<string>();
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries();
        } catch {
          entries = undefined;
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e))
              continue;
            try {
              const ee = e as {
                type?: unknown;
                label?: unknown;
                targetId?: unknown;
              };
              if (
                ee.type === "label" &&
                ee.label === needle &&
                typeof ee.targetId === "string" &&
                ee.targetId.length > 0
              ) {
                candidates.add(ee.targetId);
              }
            } catch {
              // skip a throwing-Proxy entry
            }
          }
        }
        // (2) clear each candidate whose CURRENT getLabel still maps to the needle (latest-wins; only
        //     ACTUALLY-active targets are cleared — a historical entry already cleared maps to undefined).
        for (const id of candidates) {
          try {
            if (ctx.sessionManager.getLabel(id) === needle)
              pi.setLabel(id, undefined);
          } catch {
            // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
          }
        }
      } catch {
        // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
      }
    }

    // (8) mutation warning (step 7 / E5) — VERBATIM (spec/08 E5) iff configured + the ledger shows side effects.
    //     [P4.M2.T2.S1] when step 6b REVERTED files (revertSummaryDetails.reverted > 0 — the signal S2 exposes),
    //     select MUTATION_WARNING_REVERTED: the FILE-STATE portion of the effects was restored, so the warning
    //     names ONLY non-filesystem effects that still persist (commits/installs/network/DB/process/staged +
    //     failed/refused files). Every NON-reverted outcome (no flags / disabled / group / missing /
    //     dirty-guard REFUSED / restore ran but reverted 0) → revertSummaryDetails is undefined OR .reverted===0
    //     → filesWereReverted false → ORIGINAL warning unchanged (those file effects DO persist). The
    //     dirty-guard refuse is handled HERE, not by a special branch: refused ⇒ no restore ⇒ reverted 0.
    //     hasWarning stays the gate (requireMutationWarning + non-empty ledger); filesWereReverted picks wording.
    const filesWereReverted = !!(
      revertSummaryDetails && revertSummaryDetails.reverted > 0
    );
    const hasWarning =
      config.rewind.requireMutationWarning &&
      (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);

    // (9) return success (step 8 — K + K=0 honesty via successText). revertClause threads the 6b terminal-branch
    //     notices; revertRefused surfaces the refuse flag to logs/audit + P4.M2.T2.T1 (CRITICAL #10: used);
    //     [P4.M2.T1.S2] revertSummary surfaces the 5-bucket COUNTS + backend on the proceed branch (undefined on
    //     every non-proceed branch) for the E5 warning reword (P4.M2.T2.T1) + logs/audit.
    const { text } = successText(
      granularity,
      k,
      hasWarning,
      revertClause,
      filesWereReverted,
    );
    return {
      content: [{ type: "text", text }],
      details: {
        granularity,
        k,
        ledger,
        hideEntryIds,
        markerId,
        revertRefused,
        revertSummary: revertSummaryDetails,
      },
    };
  } catch (e) {
    // Shared tool convention (E13): never throw — return a text result describing the failure.
    // [P4.M1.T2.S3] the refuse() closure is OUT OF SCOPE in this catch → set the flag inline (mirrors refuse()).
    try {
      if (rt !== null && currentTurnIndex !== null)
        rt.rewindRefusedTurnIndex = currentTurnIndex;
    } catch {
      /* E13 — never throw on the flag-set */
    }
    return refusal(
      `unexpected error: ${e instanceof Error ? e.message : String(e)}`,
      granularity,
    );
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
export function makeRewindTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof RewindParams, RewindDetails> {
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
