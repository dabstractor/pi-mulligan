/**
 * audit.ts — the `mulligan_audit` agent-callable tool (spec/05 §4; spec/06 §7; spec/08 E16; D5).
 *
 * FOURTH and final Mulligan agent-callable tool (P1.M5.T4.S1). It is the SINGLE read-only exception in the
 * set: it shows the agent a token breakdown of the context THE MODEL ACTUALLY SEES (the *filtered* view),
 * flags the biggest contributors against the bloat threshold, lists active Mulligan markers, and suggests a
 * shrink target. It persists NOTHING and computes its total from the filtered message list — NEVER from
 * `ctx.getContextUsage()` (which counts already-hidden tokens — bookkeeping drift; D5 / GOTCHA #5).
 *
 * DESIGN (read the gotchas + the PRP):
 * - CRITICAL INSIGHT #1: the audit needs NO `pi` at all (unlike checkpoint/rewind/shrink). Every read goes
 *   through `ctx` (readMarkers + buildContextEntries + getEntries + getBranch) or a pure helper
 *   (estimateTokens / resultBytes / getRuntime / getConfig). There is no `makeAuditTool(pi)` factory and no
 *   module-scoped `pi` — `auditTool` is a PLAIN `export const`. index.ts (P1.M7.T1.S1) does
 *   `pi.registerTool(auditTool)` directly (no factory call).
 * - It is the ONLY tool that reads `rt.lastFiltered` (the filter's cached output, spec/06 §7). Using the
 *   cache avoids re-running filterPipeline on the hot path and guarantees the audit reflects exactly what
 *   the model saw on the last inference (spec/06 §7: "rt.lastFiltered … written by the filter each fire").
 * - It is the ONLY place Mulligan deliberately re-runs `filterPipeline` — and ONLY on the rare E16 fallback
 *   (no cached view yet: audit called before any inference this session). This isolation keeps the
 *   "one transform pipeline" invariant (spec/04 §4) intact: the audit never invents a second transform.
 * - NO config gate (GOTCHA #4): there is no `config.audit.enabled` switch and the audit does NOT refuse when
 *   `config.enabled === false`. The audit is always-on diagnostics (read-only). Mirror checkpoint GOTCHA #4.
 * - CRITICAL GOTCHA #1: every `AgentToolResult<T>` return path includes a `details` field (spec/05 §4's
 *   `{ content:[...] }`-only return shape is a SIMPLIFICATION — `details` is REQUIRED by the Pi type; this
 *   file is strict-typechecked by tsconfig, unlike spec/reference/looper-smoke.proto.ts). We surface a small
 *   structured `AuditDetails` object on every path (incl. the catch path) for logs/debug.
 * - Shared tool convention (spec/05 "Shared tool conventions"): the execute body is fail-open to text — it
 *   NEVER throws (GOTCHA #10). The whole body is wrapped in ONE try/catch → failure text + details.error.
 *
 * TYPE NOTE: filterPipeline's 4th arg is `branchEntries?: BranchEntry[]` (transforms.ts), NOT `ctx`. The
 *   E16 fallback passes `ctx.sessionManager.getBranch()` (the same DATA the production contextHandler passes).
 *
 * This item does NOT modify src/index.ts (wiring is P1.M7.T1.S1) or any other module — it only consumes the
 * already-shipped dependencies (tokens, runtime, config, transforms, filter, markers).
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  sessionEntryToContextMessages,
  type AgentToolResult,
  type ExtensionContext,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { estimateTokens, resultBytes } from "../tokens.js"; // GOTCHA #3: .js extension (ESM/Bundler resolution)
import { getRuntime } from "../runtime.js"; // primary path: rt.lastFiltered (the cached filtered view)
import { getConfig } from "../config.js"; // estimateConfidence + bloatThresholdBytes + protectedRoles
import { filterPipeline } from "../transforms.js"; // GOTCHA #2: upstream (E16 fallback only)
import { readMarkers } from "../filter.js"; // GOTCHA #2: upstream (active markers — rewinds/shrinks)
import { bloatThresholdFor } from "../nudges.js"; // per-tool bloat threshold (Nudge A / spec/07 §1)
import type { RewindMarker, ShrinkMarker } from "../markers.js"; // GOTCHA #3: TYPE-ONLY (audit writes nothing)

// ── Parameter schema (spec/05 §4 — Typebox, VERBATIM incl. the field description) ───────────────

/**
 * AuditParams — the typebox parameter schema for `mulligan_audit` (spec/05 §4, verbatim incl. the field
 * description — the LLM reads it). `Static<typeof AuditParams>` === `{ top?: number }`. EXPORTED for tests
 * + the index.ts wiring step (P1.M7.T1.S1).
 */
export const AuditParams = Type.Object({
  top: Type.Optional(
    Type.Number({ description: "Report only the top N messages by token size. Default 8." }),
  ),
});

/** AuditArgs — the inferred execute-time params type (`{ top?: number }`). EXPORTED for ergonomics/tests. */
export type AuditArgs = Static<typeof AuditParams>;

// ── The LLM-facing description string (spec/05 §5 — copy VERBATIM) ────────────

/**
 * AUDIT_DESC — the LLM-facing description (spec/05 §5 "Description strings", Mode A LLM-facing docs). This
 * string IS the tool's documentation. Copy verbatim — it drives LLM usage. EXPORTED so the test can assert
 * the exact string (spec/05 §5 line for "Audit").
 */
export const AUDIT_DESC =
  "Show a token breakdown of the context you're currently carrying (what the model actually sees), " +
  "flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to " +
  "rewind or shrink.";

// ── The structured `details` payload (REQUIRED — CRITICAL GOTCHA #1) ─────────

/**
 * AuditRow — a label row in the "Top messages by size" block. EXPORTED so the pure renderer
 * (`renderAuditReport`) is unit-testable in isolation (its inputs are plain data, no `ctx`).
 */
export interface AuditRow {
  /** Per-message token estimate (estimateTokens([msg]).tokens). */
  tokens: number;
  /** The message role (user | assistant | toolResult | custom | …); "?" if unreadable. */
  role: string;
  /** A best-effort human label (describeMessage): e.g. `read src/big.log`, `user "snippet…"`. */
  label: string;
  /** true when the message's in-context bytes exceed the resolved per-tool bloat threshold (bloatThresholdFor). */
  bloaty: boolean;
  /** The resolved per-tool bloat threshold (bytes) used to compute `bloaty` and render the KB flag. */
  thresholdBytes: number;
}

/**
 * AuditDetails — the structured `details` payload surfaced to logs/audit/UI (CRITICAL GOTCHA #1: REQUIRED
 * on every return path, including the catch path). Small enough to be cheap; structured enough to correlate.
 */
export interface AuditDetails {
  /** Total filtered-view token estimate (estimateTokens(filtered).tokens); 0 on the catch path. */
  totalTokens: number;
  /** Honesty label: config.audit.estimateConfidence (cached path) or "low" (E16 fallback / catch). */
  confidence: "low" | "medium" | "high";
  /** Which path produced the filtered view: "cached" (rt.lastFiltered) or "fallback" (buildContextEntries). */
  source: "cached" | "fallback";
  /** Count of active mulligan:rewind markers. */
  nRewinds: number;
  /** Count of active mulligan:shrink markers. */
  nShrinks: number;
  /** Count of mulligan:checkpoint:* labels scanned from getEntries(). */
  nCheckpoints: number;
  /** Count of cancelled (retired) rewind/shrink markers = markers.cancelledIds.size (P3.M1.T4.S1 / E21 (c)). */
  nCancelled: number;
  /** The top-N rows rendered in the "Top messages by size" block. */
  top: AuditRow[];
  /** Present ONLY on the catch path — the failure reason (the execute never throws; GOTCHA #10). */
  error?: string;
}

// ── module-private defensive helpers (mirror tokens.ts/filter.ts — never throw) ───────────────

/** True for plain records (and Object.create(null)); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable. */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/** A string field read defensively; fallback if absent/unreadable/non-string (never throws). */
function readStr(obj: unknown, key: string): string | undefined {
  const v = readOwn(obj, key);
  return typeof v === "string" ? v : undefined;
}

/** Truncate a string to `max` chars with an ellipsis; pass-through for non-strings (returns ""). */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** A short text snippet of a string: `"first 40 chars…"`. Empty string for empty/non-string input. */
function snippet(s: unknown): string {
  if (typeof s !== "string" || s.length === 0) return "";
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length === 0) return "";
  return ` "${truncate(t, 40)}"`;
}

// ── pure label helpers (best-effort; spec/05 §4 example; fully unit-testable, no `ctx`) ────────

/**
 * The first text-like content of a message: a plain-string content, OR the first `text`/`thinking` block's
 * text. Used for the `user "snippet…"` label. Defensive (never throws — reads via readOwn).
 */
function contentFirstText(msg: unknown): unknown {
  const content = readOwn(msg, "content");
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      const t = readOwn(block, "type");
      if (t === "text" || t === "thinking") {
        const s = readOwn(block, t === "thinking" ? "thinking" : "text");
        if (typeof s === "string") return s;
      }
    }
  }
  return "";
}

/**
 * A one-line summary of an assistant message's content blocks: counts of each block type, e.g.
 * `"(thinking + toolCall x2)"`. Best-effort and defensive (never throws). Mirrors the spec/05 §4 example
 * `(thinking + toolCall x2)`. Empty/unknown content → `"(assistant)"`.
 */
function summarizeAssistantContent(content: unknown): string {
  if (!Array.isArray(content)) return "(assistant)";
  let text = 0;
  let thinking = 0;
  let toolCall = 0;
  let other = 0;
  for (const block of content) {
    const t = readOwn(block, "type");
    if (t === "text") text++;
    else if (t === "thinking") thinking++;
    else if (t === "toolCall") toolCall++;
    else other++;
  }
  const parts: string[] = [];
  if (thinking) parts.push("thinking");
  if (toolCall) parts.push(`toolCall${toolCall > 1 ? ` x${toolCall}` : ""}`);
  if (text) parts.push(`text${text > 1 ? ` x${text}` : ""}`);
  if (other) parts.push(`${other} other`);
  return parts.length ? `(${parts.join(" + ")})` : "(assistant)";
}

/**
 * Pick the most label-useful argument from a tool call, in precedence order (the common, human-meaningful
 * identifiers): path / file_path → command → query / pattern / search_query. Truncated to 40 chars. Returns
 * the raw value (already a string) or "" if none found. Best-effort (never throws).
 */
function pickArg(args: unknown): string {
  if (!isRecord(args)) return "";
  for (const key of ["path", "file_path", "command", "query", "pattern", "search_query"]) {
    const v = readOwn(args, key);
    if (typeof v === "string" && v.length > 0) return truncate(v, 40);
  }
  return "";
}

/**
 * The brief-args suffix for a toolResult label: prefers the MATCHED toolCall's arguments (callLookup), else
 * falls back to any string-ish field on the result itself. Returns just the arg string (no leading space).
 * Best-effort (never throws).
 */
function briefArgs(
  call: { name: string; args: Record<string, unknown> } | undefined,
  msg: Record<string, unknown>,
): string {
  if (call) {
    const a = pickArg(call.args);
    if (a) return a;
  }
  // fallback: a toolResult sometimes carries its own identifier-ish fields (defensive; never throws)
  const a = pickArg(msg);
  return a;
}

/**
 * describeMessage — a PURE, best-effort, one-line label for one message (spec/05 §4 example). EXPORTED so
 * the test can assert label construction directly (it takes no `ctx`). Reads every field defensively via
 * readOwn (GOTCHA #9 — a throwing Proxy trap never crashes it).
 *
 *   - toolResult → `${toolName} ${briefArgs}` (e.g. `read src/big.log`); `?` if no toolName.
 *   - assistant  → block-count summary (e.g. `(thinking + toolCall x2)`).
 *   - user       → `user "snippet…"` (snippet of the first text content).
 *   - custom     → the customType (e.g. `mulligan:note`), else `"custom"`.
 *   - anything else → the role, else `"message"`.
 */
export function describeMessage(
  msg: Record<string, unknown>,
  callLookup: Map<string, { name: string; args: Record<string, unknown> }>,
): string {
  const role = readStr(msg, "role");
  if (role === "toolResult") {
    const toolName = readStr(msg, "toolName") ?? "?";
    const callId = readStr(msg, "toolCallId");
    const call = callId ? callLookup.get(callId) : undefined;
    const args = briefArgs(call, msg);
    return args ? `${toolName} ${args}` : toolName;
  }
  if (role === "assistant") return summarizeAssistantContent(readOwn(msg, "content"));
  if (role === "user") return `user${snippet(contentFirstText(msg))}`;
  if (role === "custom") return readStr(msg, "customType") ?? "custom";
  return role ?? "message";
}

/**
 * buildCallLookup — a PURE helper: scan a message list for assistant toolCall blocks and build a
 * toolCallId → {name, args} map so toolResult labels can name the call. EXPORTED for direct unit testing.
 * Defensive (never throws — reads via readOwn). Multiple toolCall blocks in one assistant message are all
 * indexed (a single assistant turn can fan out several calls).
 */
export function buildCallLookup(
  messages: Record<string, unknown>[],
): Map<string, { name: string; args: Record<string, unknown> }> {
  const map = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const msg of messages) {
    if (readStr(msg, "role") !== "assistant") continue;
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (readOwn(block, "type") !== "toolCall") continue;
      const id = readStr(block, "id");
      const name = readStr(block, "name") ?? "?";
      const argsRaw = readOwn(block, "arguments");
      const args = isRecord(argsRaw) ? argsRaw : {};
      if (id) map.set(id, { name, args });
    }
  }
  return map;
}

/**
 * messageBytes — the UTF-8 BYTE size of a message's in-context content, reusing tokens.ts `resultBytes` for
 * array content (the bloat flag's canonical unit is BYTES — spec/07 §1). String content is measured via
 * Buffer.byteLength (multibyte-aware); any other shape contributes 0. Pure + defensive (never throws).
 *
 * Reuses `resultBytes` (tokens.ts) so the audit and the nudge handler agree on what "bytes" means — no
 * byte-logic duplication (the PRP pattern). The bloat flag compares this to
 * the resolved per-tool threshold via `bloatThresholdFor`.
 */
export function messageBytes(msg: Record<string, unknown>): number {
  const content = readOwn(msg, "content");
  if (typeof content === "string") {
    try {
      return Buffer.byteLength(content, "utf8");
    } catch {
      return 0;
    }
  }
  if (Array.isArray(content)) {
    return resultBytes(content); // tokens.ts: text→UTF-8 bytes, image→base64 len, else 0
  }
  return 0;
}

/**
 * listCheckpoints — scan a session's entries for `mulligan:checkpoint:` LabelEntries and return the
 * checkpoint NAMES (the prefix stripped, spec/04 §6 / GOTCHA #7). readMarkers does NOT return checkpoints
 * (it scans `type === "custom"` entries; checkpoints are `type === "label"`), so the audit scans them
 * itself. Names are returned in entry order (stable, deterministic). Defensive (never throws).
 *
 * EXPORTED so the test can assert prefix-stripping directly. Takes the raw SessionEntry[] (the same array
 * `getEntries()` returns) — kept pure by taking data, not `ctx`.
 */
export function listCheckpoints(entries: unknown[]): string[] {
  const names: string[] = [];
  if (!Array.isArray(entries)) return names;
  const PREFIX = "mulligan:checkpoint:";
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (readOwn(entry, "type") !== "label") continue;
    const label = readOwn(entry, "label");
    if (typeof label !== "string") continue;
    if (label.startsWith(PREFIX)) {
      names.push(label.slice(PREFIX.length));
    }
  }
  return names;
}

// ── the PURE report renderer (spec/05 §4 format; fully unit-testable, no `ctx`) ───────────────

/**
 * describeProtected — render the "Protected:" line's role list. The spec example shows
 * `system/first-user/latest-user`; the ACTUAL roles come from `config.rewind.protectedRoles`
 * (default `["first:user", "latest:user"]`). We render the configured roles joined with "/" so the line
 * always reflects reality. Empty list → "none" (defensive; never throws).
 */
function describeProtected(roles: string[]): string {
  if (!Array.isArray(roles) || roles.length === 0) return "none";
  return roles.join("/");
}

/**
 * renderAuditReport — the PURE report renderer (spec/05 §4 format). EXPORTED for direct unit testing (it
 * takes plain data, no `ctx`). Produces EXACTLY the spec/05 §4 markdown:
 *
 * ```md
 * ## Mulligan audit — context you are currently carrying
 * Total (filtered): ~12,340 tokens  (estimate, confidence: medium)
 * Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]
 * Protected: will not rewind past first:user/latest:user.
 *
 * Top messages by size:
 *    9412  toolResult  read src/big.log  ⚠ above bloat threshold (20 KB)
 *    1840  assistant   (thinking + toolCall x2)
 *
 * Suggestion: the `read src/big.log` result is the largest contributor. Consider mulligan_shrink.
 * ```
 *
 * Notes:
 *   - The total line is "~N tokens  (estimate, confidence: <c>)" — TWO spaces before "(estimate" (spec).
 *   - Active markers: rewinds (with their distinct granularities comma-joined) + shrink count + checkpoint
 *     count + names. An empty checkpoint set renders "[]".
 *   - Each top row: right-aligned 6-wide token count, 11-wide padded role, label, and (if bloaty) the flag.
 *     Each flagged row renders its OWN resolved per-tool threshold (bloatThresholdFor) as the KB value.
 *   - The suggestion names rows[0].label (the largest). OMITTED when filtered is empty (→ "No messages …").
 */
export function renderAuditReport(args: {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  checkpointNames: string[];
  protectedRoles: string[];
  rows: AuditRow[];
  filtered: unknown[];
  /** Count of cancelled (retired) markers — appended as ", N cancelled (retired)" when > 0 (P3.M1.T4.S1 / E21 (c)). */
  cancelledCount: number;
}): string {
  const L: string[] = [];
  L.push("## Mulligan audit — context you are currently carrying");
  L.push(`Total (filtered): ~${args.totalTokens} tokens  (estimate, confidence: ${args.confidence})`);

  // Active markers: distinct rewind granularities + shrink count + checkpoint count + names.
  const granularities = [...new Set(args.rewinds.map((r) => readStr(r, "granularity")).filter((g): g is string => !!g))];
  const gran = granularities.join(", ");
  const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []";
  // P3.M1.T4.S1 / E21 (c): append ", N cancelled (retired)" ONLY when there are retired markers. Omitted when 0
  // so the line stays clean AND the pre-existing exact-string active-markers assertions stay byte-identical.
  const cancelledClause = args.cancelledCount > 0 ? `, ${args.cancelledCount} cancelled (retired)` : "";
  L.push(
    `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
      `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}${cancelledClause}`,
  );

  L.push(`Protected: will not rewind past ${describeProtected(args.protectedRoles)}.`);

  L.push(""); // blank line before the top block (spec)

  if (args.filtered.length === 0) {
    L.push("No messages in filtered view.");
    // No suggestion when there are no messages (spec/05 §4 + the PRP "Suggestion names rows[0].label; empty
    // filtered → 'No messages in filtered view.' + no suggestion").
    return L.join("\n");
  }

  L.push("Top messages by size:");
  for (const r of args.rows) {
    const flag = r.bloaty ? `  ⚠ above bloat threshold (${Math.round(r.thresholdBytes / 1024)} KB)` : "";
    L.push(`  ${String(r.tokens).padStart(6)}  ${r.role.padEnd(11)} ${r.label}${flag}`);
  }

  L.push(""); // blank line before the suggestion (spec)
  const target = args.rows[0]?.label ?? "message";
  L.push(`Suggestion: the \`${target}\` result is the largest contributor. Consider mulligan_shrink.`);
  return L.join("\n");
}

// ── the E16 fallback: entries → messages (spec/06 §7) ────────────────────────

/**
 * entriesToMessages — the E16 fallback's entry→message conversion (spec/06 §7: "convert
 * buildContextEntries() to messages via the same logic Pi uses"). We DELEGATE to Pi's canonical
 * `sessionEntryToContextMessages` (the exact same helper buildSessionContext uses) so the audit never
 * invents a divergent conversion. Each entry yields ≥0 messages; non-yielding entry types
 * (compaction/branch_summary/label/…) contribute nothing here (their effect is already baked into the
 * buildContextEntries() list). Defensive (never throws — a throwing entry contributes []).
 */
function entriesToMessages(entries: SessionEntry[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of entries) {
    try {
      const msgs = sessionEntryToContextMessages(entry);
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (isRecord(m)) out.push(m);
        }
      }
    } catch {
      // best-effort (spec/06 §7 "best-effort; flag confidence low") — a throwing entry contributes []
    }
  }
  return out;
}

/**
 * computeFilteredTotal — the shared filtered-context total + context-window SIZE estimate (spec/05 §4 step 2;
 * spec/08 E22 out-of-band context-fraction stop). Returns the SAME total `mulligan_audit` reports and the
 * model's window SIZE, so the rewind tool's context-fraction stop guard (P4.M1.T2.S2) and the audit never
 * diverge. EXPORTED so audit + rewind share one computation (and tests can assert it directly).
 *
 * D5 compliance: the total is computed on the FILTERED view (rt.lastFiltered — what the model actually sees),
 * NEVER ctx.getContextUsage().tokens (which counts hidden/rewound tokens — bookkeeping drift). The window SIZE
 * (`.contextWindow`) IS read and permitted — D5 forbids `.tokens` only (filter.ts L326 already reads .contextWindow).
 *
 * rt.lastFiltered is the PREVIOUS context-fire's cached view (written by filterPipeline each fire). Read
 * mid-turn from a tool, it is a STALE estimate (predates the current turn's contributions) — ACCEPTED for a
 * STOP guard: staleness errs toward UNDER-counting → the guard fires LATER / lets more rewinds through, the
 * safe direction. DO NOT "fix" the staleness by reading getContextUsage().tokens — D5 violation.
 *
 * Fail-open (E13): ONE try/catch around the WHOLE body → on ANY failure returns { totalTokens: 0, windowTokens: 0 }.
 * The rewind guard treats windowTokens === 0 as "skip" (no model [E12] / undefined usage / throw → never block a
 * rewind). Module-local entriesToMessages keeps this helper self-contained without an extra export.
 */
export function computeFilteredTotal(ctx: ExtensionContext): { totalTokens: number; windowTokens: number } {
  try {
    const rt = getRuntime(ctx.sessionManager.getSessionId());
    let filtered;
    if (Array.isArray(rt.lastFiltered)) {
      filtered = rt.lastFiltered;
    } else {
      // E16-style fallback: entries → messages. CHEAPER than audit's fallback (no filterPipeline re-run) — the
      // rewind guard is on the hot path and only needs an estimate. (Audit keeps its own more-accurate fallback.)
      const entries = ctx.sessionManager.buildContextEntries();
      filtered = entriesToMessages(entries);
    }
    type TM = Parameters<typeof estimateTokens>[0];
    const totalTokens = estimateTokens(filtered as unknown as TM).tokens; // estimateTokens never throws (GOTCHA #3)
    const usage = ctx.getContextUsage?.();
    const windowTokens = usage?.contextWindow ?? 0; // D5: .contextWindow (the SIZE) is permitted; .tokens is not
    return { totalTokens, windowTokens };
  } catch {
    // fail-open sentinel — windowTokens 0 makes the rewind guard SKIP (never block a rewind — E13)
    return { totalTokens: 0, windowTokens: 0 };
  }
}

// ── execute (spec/05 §4 behavior; shared tool convention = never throws) ─────

/**
 * auditExecute — the tool body. Steps (spec/05 §4 "Behavior" 1–5):
 *   1. Resolve the FILTERED view:
 *      - PRIMARY: rt.lastFiltered (the filter's cached output) when it is a non-null array → source="cached",
 *        confidence = config.audit.estimateConfidence.
 *      - E16 FALLBACK: rt.lastFiltered is null → buildContextEntries() → messages → filterPipeline (the SAME
 *        pipeline the contextHandler runs, so the audit reflects post-rewind/shrink reality), confidence="low".
 *        NEVER ctx.getContextUsage() for the total (D5 / GOTCHA #5).
 *   2. estimateTokens per message; sort desc; take `top` (default 8 — GOTCHA #8). The TOTAL is over ALL
 *      filtered messages (estimateTokens(filtered)); only the "Top messages" block is truncated to `top`.
 *   3. Read active markers (readMarkers) + checkpoints (scanned from getEntries() — GOTCHA #7).
 *   4. Render the spec/05 §4 report; the suggestion names rows[0].label (omitted if filtered empty).
 *   5. Return { content:[{type:"text",text:report}], details }. Persist NOTHING.
 *
 * The WHOLE body is wrapped in ONE try/catch → failure text + details.error (GOTCHA #10: the audit never
 * throws — it sits on the tool hot path; a throwing getEntries()/buildContextEntries()/Proxy trap must not
 * crash the turn). `auditTool` is a PLAIN `export const` (CRITICAL INSIGHT #1) — there is no `pi` here.
 */
async function auditExecute(
  _toolCallId: string,
  params: Static<typeof AuditParams>,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AuditDetails>> {
  try {
    const config = getConfig();
    const sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12)
    const rt = getRuntime(sessionId);

    // (1) Resolve the FILTERED view. NEVER ctx.getContextUsage() (D5 / GOTCHA #5).
    let filtered: Record<string, unknown>[];
    let source: "cached" | "fallback";
    let confidence: "low" | "medium" | "high";
    if (Array.isArray(rt.lastFiltered)) {
      // PRIMARY: the filter's cached output (spec/06 §7 — "written by the filter each fire").
      filtered = rt.lastFiltered;
      source = "cached";
      confidence = config.audit.estimateConfidence;
    } else {
      // E16 fallback (spec/06 §7, spec/08 E16): entries → messages → re-run the SAME pipeline. The ONLY
      // place filterPipeline is re-run intentionally. filterPipeline's 4th arg is branchEntries (getBranch),
      // NOT ctx (transforms.ts signature).
      const entries = ctx.sessionManager.buildContextEntries();
      const base = entriesToMessages(entries);
      const branch = ctx.sessionManager.getBranch();
      filtered = filterPipeline(
        base,
        readMarkers(ctx),
        config,
        branch as unknown as Parameters<typeof filterPipeline>[3],
      );
      source = "fallback";
      confidence = "low";
    }

    // (2) Total from the filtered view (NOT getContextUsage — D5). estimateTokens is defensive (never throws).
    type TokenMessages = Parameters<typeof estimateTokens>[0];
    const totalTokens = estimateTokens(filtered as unknown as TokenMessages).tokens;

    // Top-N rows. `top` defaults to 8 (GOTCHA #8); only the "Top messages" block is truncated.
    const top = typeof params?.top === "number" && params.top > 0 ? Math.floor(params.top) : 8;
    const callLookup = buildCallLookup(filtered);
    const ranked = filtered
      .map((m) => ({ tokens: estimateTokens([m] as unknown as TokenMessages).tokens, msg: m }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, top);
    const rows: AuditRow[] = ranked.map(({ tokens, msg }) => {
      const toolName = readStr(msg, "toolName");
      const rowThreshold = bloatThresholdFor(toolName, config);
      return {
        tokens,
        role: readStr(msg, "role") ?? "?",
        label: describeMessage(msg, callLookup),
        bloaty: messageBytes(msg) > rowThreshold,
        thresholdBytes: rowThreshold,
      };
    });

    // (3) Active markers (readMarkers) + checkpoints (scanned separately — GOTCHA #7: readMarkers returns
    //     only custom-entry markers; checkpoints are LabelEntries).
    const markers = readMarkers(ctx);
    const checkpointNames = listCheckpoints(ctx.sessionManager.getEntries() as unknown as unknown[]);

    // (4) Render the spec/05 §4 report. The suggestion names rows[0].label (omitted if filtered empty).
    const report = renderAuditReport({
      totalTokens,
      confidence,
      rewinds: markers.rewinds as RewindMarker[],
      shrinks: markers.shrinks as ShrinkMarker[],
      checkpointNames,
      protectedRoles: config.rewind.protectedRoles,
      rows,
      filtered,
      cancelledCount: markers.cancelledIds.size, // P3.M1.T4.S1 — retired-marker count (E21 (c))
    });

    // (5) Return. `details` is REQUIRED (CRITICAL GOTCHA #1). Persist NOTHING (no pi.* calls — CRITICAL INSIGHT #1).
    return {
      content: [{ type: "text" as const, text: report }],
      details: {
        totalTokens,
        confidence,
        source,
        nRewinds: markers.rewinds.length,
        nShrinks: markers.shrinks.length,
        nCheckpoints: checkpointNames.length,
        nCancelled: markers.cancelledIds.size, // P3.M1.T4.S1 — retired-marker count (E21 (c))
        top: rows,
      },
    };
  } catch (e) {
    // Shared tool convention: never throw — return a text result describing the failure (GOTCHA #10).
    const reason = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text" as const, text: `Mulligan: audit failed — ${reason}` }],
      details: {
        totalTokens: 0,
        confidence: "low",
        source: "fallback",
        nRewinds: 0,
        nShrinks: 0,
        nCheckpoints: 0,
        nCancelled: 0, // P3.M1.T4.S1 — REQUIRED field present on the catch path too (CRITICAL GOTCHA #1)
        top: [],
        error: reason,
      },
    };
  }
}

// ── The tool definition (PLAIN `export const` — CRITICAL INSIGHT #1: no `pi` factory) ─────────

/**
 * auditTool — the `mulligan_audit` tool definition (spec/05 §4/§5). A PLAIN `export const` (NOT a
 * `makeAuditTool(pi)` factory): the audit needs NO `pi` at all — every read goes through `ctx` or a pure
 * helper (CRITICAL INSIGHT #1). `defineTool` preserves `AuditParams`/`AuditDetails` inference.
 *
 * index.ts (P1.M7.T1.S1) does: `pi.registerTool(auditTool);` (NO factory call — unlike
 * makeCheckpointTool/makeRewindTool/makeShrinkTool which capture `pi`).
 * Unit tests do: `const res = await auditTool.execute("c1", {top:8}, undefined, undefined, fakeCtx);`.
 */
export const auditTool: ToolDefinition<typeof AuditParams, AuditDetails> = defineTool({
  name: "mulligan_audit",
  label: "Mulligan Audit",
  description: AUDIT_DESC, // spec/05 §5 VERBATIM
  parameters: AuditParams,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return auditExecute(toolCallId, params, signal, onUpdate, ctx);
  },
});