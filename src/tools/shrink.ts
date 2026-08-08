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
import { resolveShrinkTarget } from "../transforms.js"; // Pi-free (0 imports) — no circular dep
import type { ShrinkTarget } from "../transforms.js"; // structurally identical to markers.ts ShrinkTarget
import type { MessageLike } from "../transforms.js";
import { getConfig } from "../config.js"; // GOTCHA #10: read ONCE per execute

// ── Parameter schema (spec/05 §2 — Typebox, VERBATIM incl. the 3-arm target union + descriptions) ────

/**
 * ShrinkParams — the typebox parameter schema for `mulligan_shrink` (spec/05 §2, verbatim incl. every
 * field description — the LLM reads them). `Static<typeof ShrinkParams>` === `ShrinkMarkerInput` ===
 * `{ target: ShrinkTarget; replacement: string; reason?: string }` (the shared contract with the
 * filter — spec/04 §4). EXPORTED for tests + the index.ts wiring step.
 *
 * The `target` union is copied VERBATIM from spec/05 §2 (the three matcher arms + their descriptions):
 *   - by_tool_call_id         — unique; resolves to the toolResult with that toolCallId.
 *   - by_tool_name+occurrence — semantic; the last (default) or first toolResult with that toolName.
 *   - by_content_includes     — content-based; the first message (any role) whose text contains the substring.
 */
export const ShrinkParams = Type.Object({
  target: Type.Union(
    [
      Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink." }) }),
      Type.Object({
        by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
        occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
      }),
      Type.Object({
        by_content_includes: Type.String({
          description: "Shrink the (first) message whose text contains this substring.",
        }),
      }),
    ],
    { description: "How to identify the message to shrink. Resolved live each turn (robust to compaction)." },
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
 * SHRINK_DESC — the LLM-facing description (spec/05 §5 "Description strings", Mode A LLM-facing docs).
 * This string IS the tool's documentation. Copy verbatim — it drives LLM usage. (spec/05 §5 line 79.)
 */
export const SHRINK_DESC =
  "Replace a specific past tool result with a compact summary you provide, in your view, going forward. " +
  "Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in " +
  "context (just with your summary as its result).";

// ── Result builders (always include `details` — CRITICAL GOTCHA #4) ──────────

/** ShrinkDetails — the structured `details` payload surfaced to logs/audit/UI. Present on every path. */
export interface ShrinkDetails {
  /** Best-effort "does the target match a message right now" result. true/false on the success path;
   *  omitted on refusal (no match attempted). Drives the "(Matched now: yes|no)" feedback + audit correlation. */
  matched?: boolean;
  /** The persisted marker's ENTRY id (appendShrinkMarker's return; null when append threw / no leaf). Success path. */
  markerId?: string | null;
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
 * feedbackText — the spec/05 §2 VERBATIM feedback text with the yes/no slot filled from the best-effort
 * match. Copy verbatim incl. the "from the next turn on" clause and the `(Matched now: yes|no)` slot.
 */
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${
    matched ? "yes" : "no"
  })`;
}

// ── pure validation + match helpers (module-private; never throw) ────────────

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
 * invalid when its present discriminator (by_tool_call_id / by_tool_name / by_content_includes — whichever
 * is a string) is EMPTY or WHITESPACE-ONLY after trim. Verified reasoning against resolveShrinkTarget
 * (transforms.ts) internals:
 *   - by_tool_call_id:"" / by_tool_name:"" → resolveShrinkTarget skips the arm (length>0 check) → null forever.
 *   - by_content_includes:"" → NO length check → degenerate match on the FIRST message (every string includes "").
 * Both are noise → refuse. A NON-EMPTY-but-currently-unmatched target is NOT refused (compaction-robust;
 * content may appear before a compaction settles — E8; the marker persists and the filter re-resolves it
 * each inference). Defensive (non-record target → false; never throws). occurrence is typebox-constrained to
 * "last"|"first"; resolveShrinkTarget defaults non-"first" to "last" → do NOT validate occurrence.
 */
function targetIsStructurallyValid(target: ShrinkArgs["target"] | undefined): boolean {
  if (!target || typeof target !== "object") return false; // non-record → no recognizable discriminator
  if ("by_tool_call_id" in target) return isNonEmpty(target.by_tool_call_id);
  if ("by_tool_name" in target) return isNonEmpty(target.by_tool_name);
  if ("by_content_includes" in target) return isNonEmpty(target.by_content_includes);
  return false; // no recognizable discriminator key
}

/**
 * bestEffortMatch — the ADVISORY read-only yes/no match (GOTCHA #5/#6). Builds a SNAPSHOT via
 * `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)` (NOT event.messages —
 * the tool is write-only w.r.t. messages), feeds it to the PURE resolver `resolveShrinkTarget`
 * (transforms.ts), and returns whether the target matched. ADVISORY ONLY — it NEVER gates persistence (a
 * matched:false STILL persists + returns "(Matched now: no)" — spec/05 §2 step 3; E8). Wrapped in try/catch
 * → false (a throwing buildContextEntries / sessionEntryToContextMessages must never block a legitimate
 * shrink — E13). The AUTHORITATIVE substitution happens in the filter on the next inference (D7).
 */
function bestEffortMatch(ctx: ExtensionContext, target: ShrinkArgs["target"]): boolean {
  try {
    const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
    // sessionEntryToContextMessages returns Pi's AgentMessage[]; transforms.ts MessageLike is a Pi-free
    // structural type — a real AgentMessage[] assigns in with NO cast (GOTCHA #5, api_verification.md §6.1/§6.3).
    const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
    return resolveShrinkTarget(messages, target as ShrinkTarget) !== null; // PURE resolver (transforms.ts)
  } catch {
    return false; // GOTCHA #6: never block a legitimate shrink on an advisory computation (E13)
  }
}

// ── execute (spec/05 §2 behavior; shared tool convention = never throws) ─────

/**
 * shrinkExecute — the tool body. Steps (spec/05 §2 steps 1–5):
 *   1. config (step 1; E14): getConfig() once; `config.shrink.enabled`? false → refuse "shrink is disabled".
 *   2. replacement (step 2): empty/whitespace-only after trim? → refuse "replacement must be non-empty".
 *   3. structural target (step 3 — the "structurally impossible" refusal; GOTCHA #7): the present
 *      discriminator empty after trim? → refuse "target discriminator must be non-empty". (A non-empty-but-
 *      currently-unmatched target is NOT refused — E8.)
 *   3/4. best-effort match (step 3 — the yes/no feedback; advisory, never blocks; GOTCHA #6): snapshot →
 *        resolveShrinkTarget → matched boolean. try/catch → false (belt-and-suspenders; bestEffortMatch
 *        already catches — E13).
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
    // (1) config (spec/05 §2 step 1; E14). GOTCHA #10: read getConfig() ONCE.
    const config = getConfig();
    if (!config.shrink.enabled) return refusal("shrink is disabled");

    // (2) replacement non-empty (spec/05 §2 step 2).
    if (!isNonEmpty(params?.replacement)) return refusal("replacement must be non-empty");

    // (3) structural target validity (spec/05 §2 step 3 — "structurally impossible"; GOTCHA #7).
    //     A non-empty-but-currently-unmatched target is NOT refused here (that is advisory feedback, step 3/4).
    if (!targetIsStructurallyValid(params?.target)) return refusal("target discriminator must be non-empty");

    // (3/4) best-effort yes/no match (spec/05 §2 step 3 — ADVISORY; never blocks persistence — GOTCHA #6).
    //       Inner try/catch is belt-and-suspenders (bestEffortMatch already catches → false — E13).
    let matched: boolean;
    try {
      matched = bestEffortMatch(ctx, params.target);
    } catch {
      matched = false;
    }

    // (5) persist (spec/05 §2 step 4; GOTCHA #1 — NO cast, NO leaveNote; ShrinkMarkerInput matches EXACTLY).
    const markerId = appendShrinkMarker(pi, ctx, {
      target: params.target,
      replacement: params.replacement,
      reason: params.reason,
    } satisfies ShrinkMarkerInput);

    // (6) return (spec/05 §2 step 5) — feedback text (yes/no from the best-effort match) + details.
    return {
      content: [{ type: "text", text: feedbackText(matched) }],
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
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return shrinkExecute(pi, toolCallId, params, signal, onUpdate, ctx); // pi captured via closure
    },
  });
}