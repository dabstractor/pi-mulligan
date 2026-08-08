/**
 * checkpoint.ts — the `mulligan_checkpoint` agent-callable tool (spec/05 §3; spec/04 §6).
 *
 * THIRD of the four Mulligan agent-callable tools (P1.M5.T3.S1). It is the sole writer of the
 * `mulligan:checkpoint:` label namespace: the agent names the current transcript position so a
 * later `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` (P1.M5.T1.S1) can target
 * it precisely in one shot — an anchor neither relative granularity can express.
 *
 * DESIGN (read the gotchas + the PRP):
 * - Thin, typebox-schema'd, validation-owning adapter on top of `setCheckpoint` (src/markers.ts, P1.M4.T1.S2 —
 *   ALREADY complete & shipped & unit-tested). This tool does NOT reimplement `pi.setLabel`,
 *   `getLeafId()`, the `mulligan:checkpoint:` prefix, or the null-leaf check — it delegates all of that.
 * - The TOOL owns name-format validation (`/^[a-z0-9_-]{1,40}$/`, spec/05 §3 step 1, spec/04 §6, spec/08 E10);
 *   the wrapper TRUSTS the name (markers.ts GOTCHA #7). Invalid names are refused with text and NEVER reach
 *   setCheckpoint.
 * - Shared tool convention (spec/05 "Shared tool conventions"): the execute body is fail-open to text — it
 *   NEVER throws (setCheckpoint never throws either, but the tool wraps its OWN body in try/catch for
 *   defense-in-depth, e.g. a regex-engine surprise).
 * - CRITICAL GOTCHA #1: every `AgentToolResult<T>` return path includes a `details` field (spec/05 §3's
 *   `{ content:[...] }`-only return shape is a SIMPLIFICATION — `details` is REQUIRED by the Pi type; this
 *   file is strict-typechecked by tsconfig, unlike spec/reference/looper-smoke.proto.ts). We use a small
 *   structured object (`{ name, entryId? }`) for audit/debug intent.
 * - `pi` (ExtensionAPI) is NOT passed to execute() — it is captured via the `makeCheckpointTool(pi)`
 *   factory closure (the recommended testable shape; no module-scoped mutable state). index.ts
 *   (P1.M7.T1.S1) will do `pi.registerTool(makeCheckpointTool(pi))`.
 *
 * NO config gate here (GOTCHA #4): there is no `config.checkpoint.enabled` switch (spec/09 has no checkpoint
 * config section); checkpoints are inert labels, there is nothing to disable. This item does NOT modify
 * src/index.ts (wiring is P1.M7.T1.S1).
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { setCheckpoint } from "../markers.js"; // GOTCHA #2: .js extension (ESM/Bundler resolution)

// ── Parameter schema (spec/05 §3 — Typebox) ─────────────────────────────────

/**
 * CheckpointParams — the typebox parameter schema for `mulligan_checkpoint` (spec/05 §3, verbatim).
 * `Static<typeof CheckpointParams>` === `{ name: string }`. EXPORTED for tests + the index.ts wiring step.
 */
export const CheckpointParams = Type.Object({
  name: Type.String({
    description:
      "Checkpoint name. lowercase, digits, hyphen, underscore only; max 40 chars. e.g. 'before-refactor-experiment'.",
  }),
});

/** CheckpointArgs — the inferred execute-time params type (`{ name: string }`). EXPORTED for ergonomics/tests. */
export type CheckpointArgs = Static<typeof CheckpointParams>;

// ── Name-format guard (spec/05 §3 step 1; spec/04 §6; spec/08 E10) — THE TOOL OWNS THIS (GOTCHA #3) ──

/** NAME_RE — the checkpoint-name format regex (spec/05 §3 step 1; spec/04 §6). lowercase, digits, hyphen, underscore; 1-40 chars. */
const NAME_RE = /^[a-z0-9_-]{1,40}$/;

/**
 * validCheckpointName — the TOOL-owned name-format guard (GOTCHA #3: validation is the tool's job, NOT
 * setCheckpoint's — the wrapper trusts the caller's name and only prefixes it). Defensive `typeof` check
 * so a non-string (impossible after typebox validation in production, but possible in a hand-rolled test)
 * refuses cleanly rather than throwing on `.test()`.
 */
export function validCheckpointName(name: string): boolean {
  return typeof name === "string" && NAME_RE.test(name);
}

// ── The LLM-facing description string (spec/05 §5 — copy VERBATIM) ────────────

/**
 * CKPT_DESC — the LLM-facing description (spec/05 §5 "Description strings", Mode A LLM-facing docs).
 * This string IS the tool's documentation. Copy verbatim — it drives LLM usage.
 */
export const CKPT_DESC =
  "Name the current position so a later mulligan_rewind can jump straight back to it. " +
  "Use before a speculative sub-task you might want to undo in one shot.";

// ── Result builders (always include `details` — CRITICAL GOTCHA #1) ──────────

/** CheckpointDetails — the structured `details` payload surfaced to logs/audit/UI. */
export interface CheckpointDetails {
  /** The (validated, or attempted) checkpoint name. Present on every path for correlation. */
  name: string;
  /** The labeled entry id on success; undefined on refusal/failure. */
  entryId?: string;
}

/**
 * refusal — build a fail-open text result for an invalid-name / wrapper-reported-failure / unexpected-error
 * case. ALWAYS includes `details` (CRITICAL GOTCHA #1). The shared convention prefixes every refusal with
 * "Mulligan: refused — " so the agent can pattern-match a refusal regardless of the underlying reason.
 */
function refusal(reason: string, name: string): AgentToolResult<CheckpointDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}` }],
    details: { name },
  };
}

// ── execute (spec/05 §3 behavior; shared tool convention = never throws) ─────

/**
 * checkpointExecute — the tool body. Steps (spec/05 §3):
 *   1. Validate `name` format — refuse (text) if it fails. THE TOOL OWNS THIS (GOTCHA #3).
 *   2. Delegate to `setCheckpoint(pi, ctx, name)` (markers.ts: null-checks getLeafId, prefixes with
 *      `mulligan:checkpoint:`, try/catches; trusts the caller's name).
 *   3a. On `{ entryId }` → success text (verbatim spec/05 §3) + `{ name, entryId }` details.
 *   3b. On `{ error }` (e.g. "no leaf" or a swallowed setLabel throw) → refusal text + `{ name }` details.
 * The whole body is wrapped in try/catch → failure text (GOTCHA #5: never throw on the tool hot path).
 *
 * `pi` is captured by the `makeCheckpointTool(pi)` factory closure (it is NOT an execute argument).
 */
async function checkpointExecute(
  pi: ExtensionAPI,
  _toolCallId: string,
  params: CheckpointArgs,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<CheckpointDetails>> {
  const name = params?.name;
  try {
    // (1) Validate name format (spec/05 §3 step 1; spec/04 §6; spec/08 E10). THE TOOL OWNS THIS (GOTCHA #3).
    if (!validCheckpointName(name)) {
      return refusal(
        `invalid checkpoint name '${name}' — must match /^[a-z0-9_-]{1,40}$/ (lowercase, digits, hyphen, underscore; 1-40 chars).`,
        name,
      );
    }
    // (2) Delegate (markers.ts setCheckpoint: null-checks getLeafId, prefixes, try/catches; trusts the name).
    const res = setCheckpoint(pi, ctx, name);
    if ("entryId" in res) {
      // (3a) success — spec/05 §3 return text, VERBATIM (apostrophes around the name; the literal rewind wording).
      const text =
        `Mulligan: checkpoint '${name}' set at entry ${res.entryId}. ` +
        `Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'${name}').`;
      return {
        content: [{ type: "text", text }],
        details: { name, entryId: res.entryId },
      };
    }
    // (3b) wrapper-reported failure (e.g. {error:"no leaf"} or a swallowed setLabel throw).
    return refusal(`could not set checkpoint: ${res.error}`, name);
  } catch (e) {
    // Shared tool convention: never throw — return a text result describing the failure (GOTCHA #5).
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, name);
  }
}

// ── Factory: the testable `pi`-injection seam (recommended in the PRP) ───────

/**
 * makeCheckpointTool — the tool factory. Captures `pi` (ExtensionAPI) via closure so `checkpointExecute`
 * can call `setCheckpoint(pi, ctx, name)` WITHOUT `pi` being an execute argument (the Pi ExtensionAPI is
 * passed to the extension FACTORY in src/index.ts, not to each tool's execute()). `defineTool` preserves
 * `CheckpointParams` inference when assigning to a variable.
 *
 * index.ts (P1.M7.T1.S1) will do: `pi.registerTool(makeCheckpointTool(pi));`.
 * Unit tests do: `const tool = makeCheckpointTool(fakePi);`.
 */
export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<typeof CheckpointParams, CheckpointDetails> {
  return defineTool({
    name: "mulligan_checkpoint",
    label: "Mulligan Checkpoint",
    description: CKPT_DESC,
    parameters: CheckpointParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return checkpointExecute(pi, toolCallId, params, signal, onUpdate, ctx);
    },
  });
}