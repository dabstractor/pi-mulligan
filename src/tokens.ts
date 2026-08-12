/**
 * Token estimation helpers — Mulligan's approximate, no-tokenizer token accounting.
 * spec/03-architecture.md §2.3 (pure helpers), spec/01-pi-context-internals.md §7 (estimate fuzziness +
 *   confidence flag), spec/04-data-model.md §7 (EstimateConfidence), spec/11-build-order.md §1 (tokens.ts),
 *   spec/10-testing.md §1.7 (estimateTokens test tier), spec/05-tools.md §4 (audit consumes estimateTokens).
 *
 * DESIGN (read GOTCHA #1–#9 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log, not runtime. It is a pure,
 *   deterministic, side-effect-free function fully unit-testable in isolation; it honors the work-item contract
 *   ("internal pure helper") and is the consumer of NO other module.
 * - NO tokenizer library (spec/01 §7, spec/03 §2.3, external_deps.md line 114). Tokens are estimated via a
 *   character-count heuristic: ~4 chars ≈ 1 token for English text (OpenAI rule of thumb; see research). This is
 *   intentionally approximate; callers receive a TokenConfidence flag to convey how approximate.
 * - Monotonic in input length, empty → 0, deterministic, and NEVER throws — a malformed message (missing content,
 *   a throwing Proxy trap, circular toolCall.arguments) estimates to ≥0, so it can never crash the
 *   context/turn_end/audit hot path (mirrors log.ts's fail-open discipline).
 *
 * NOTE: P1.M2.T1.S2 (resultBytes + approxTokens) APPENDS to this file next. This module owns estimateTokens +
 * CHARS_PER_TOKEN + the structural types ONLY (GOTCHA #8).
 */

// ── local structural types (api_verification.md §6.1/§6.2) ───────────────────
// The real Pi AgentMessage union lives in @earendil-works/pi-agent-core, which is NOT resolvable here (not
// hoisted; not re-exported — confirmed by the P1.M1.T4S1 PRP GOTCHA #1). estimateTokens INTROSPECTS content
// blocks, so it needs a richer structural shape than runtime.ts's opaque Record<string, unknown> alias. These
// local types match the verified Pi shapes; they are STRUCTURAL — a real Pi AgentMessage[] is assignable to
// MessageLike[] with NO cast.

/** Text content block (user / assistant / toolResult / custom). */
interface TextContent {
  type: "text";
  text: string;
}
/** Thinking content block (assistant only). */
interface ThinkingContent {
  type: "thinking";
  thinking: string;
}
/** Image content block — `data` is base64 (counted at face value; a deliberate overestimate — GOTCHA #4). */
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
/** Tool call block (assistant only) — the substance is name + arguments (id omitted as overhead). */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
/** Any content block across the message roles. */
type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent;

/**
 * Minimal structural message shape for estimation. Any Pi AgentMessage variant (user / assistant / toolResult /
 * custom / bashExecution / branchSummary / compactionSummary) satisfies this: each carries a `content` that is
 * either a plain string or an array of content blocks (api_verification.md §6.1/§6.3). Unknown roles and
 * unsupported content shapes are estimated defensively (GOTCHA #3) — estimation NEVER throws.
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/**
 * Confidence label reported alongside a token estimate — conveys HOW APPROXIMATE the number is, given the
 * estimation method (character heuristic, not a real tokenizer) and content mix (text vs images/tool schemas).
 * spec/04 §7 + spec/09 §2 (config.audit.estimateConfidence), spec/01 §7 ("reports estimates as estimates").
 *
 * Structurally identical to config.ts's EstimateConfidence, so the audit tool can mix values from the two modules
 * with no cast. estimateTokens returns the DEFAULT ("medium"); the audit TOOL overrides it with
 * config.audit.estimateConfidence when rendering (the pure-fn ↔ consumer seam — see PRP GOTCHA #7).
 */
export type TokenConfidence = "low" | "medium" | "high";

/** Result of estimateTokens. */
export interface TokenEstimate {
  /** Non-negative integer token estimate (Math.ceil(totalChars / CHARS_PER_TOKEN)). */
  tokens: number;
  /** Honesty label; defaults to "medium". The audit tool overrides via config.audit.estimateConfidence. */
  confidence: TokenConfidence;
}

/**
 * CHARS_PER_TOKEN — the character-count heuristic ratio. ~4 characters of English text ≈ 1 token (OpenAI rule of
 * thumb; verified in research/external_best_practices.md). EXPORTED so P1.M2.T1.S2 (resultBytes/approxTokens) and
 * tests can reference the same ratio transparently.
 */
export const CHARS_PER_TOKEN = 4;

/** The confidence estimateTokens returns by default (spec/04 §7, spec/09 §2). The audit config is the user knob. */
const DEFAULT_TOKEN_CONFIDENCE: TokenConfidence = "medium";

/**
 * estimateTokens — approximate the in-context token cost of a message list via a character-count heuristic.
 *
 * spec/03-architecture.md §2.3, spec/05-tools.md §4 (audit), spec/06-context-filter.md (turn metric), spec/10
 * §1.7. For each message it stringifies the content (a plain string OR an array of content blocks: text, thinking,
 * toolCall name+arguments, image base64 data), sums the character lengths, and returns
 * Math.ceil(totalChars / CHARS_PER_TOKEN). Monotonic in input length; an empty list → 0. Deterministic. NEVER
 * throws (GOTCHA #3).
 *
 * The estimate is intentionally approximate (no tokenizer; images/tool schemas are fuzzier — spec/01 §7). The
 * returned `confidence` ("medium" default) conveys that; the audit TOOL tunes the REPORTED label via
 * config.audit.estimateConfidence (GOTCHA #7). The `model` parameter is accepted for forward-compatible,
 * model-specific calibration but is NOT used in v1 (the heuristic is model-agnostic).
 *
 * @param messages the message list (a single message is estimated via estimateTokens([msg]))
 * @param model OPTIONAL model descriptor (v1: unused; reserved for future model-specific calibration)
 * @returns { tokens, confidence } — tokens is a non-negative integer; confidence defaults to "medium"
 */
export function estimateTokens(
  messages: MessageLike[] | null | undefined,
  _model?: unknown,
): TokenEstimate {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const msg of list) {
    chars += messageCharLength(msg);
  }
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  return { tokens, confidence: DEFAULT_TOKEN_CONFIDENCE };
}

/**
 * estimateAgentTokens — the AGENT-ATTRIBUTABLE token count of a message list: the sum of estimateTokens
 * over every message whose `role !== "user"` (D10 — spec/07 §2, spec/04 §5). User prompts are intentional
 * ground-truth input, never bloat to shed, and the drift nudge prescribes rewind/shrink (which can only
 * legitimately target agent output) — so a large user-supplied paste must NOT inflate the drift delta.
 * Consumed by turnEndMetricHandler (P1.M2.T1.S2) as the agent-attributable `now` for the drift delta.
 *
 * Semantics: sums estimateTokens([msg]).tokens per non-user message (each message is ceiling-rounded
 * independently — see estimateTokens' GOTCHA #5). A message with no `role` (or a non-record) is NOT "user" →
 * counted (when in doubt, attribute to the agent). Pure, Pi-free, 0-import (reuses module-private readOwn).
 * NEVER throws (estimateTokens + readOwn are both defensive — mirrors messageCharLength's discipline).
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → 0
 * @returns the agent-attributable token estimate (non-negative integer); empty/non-array → 0
 */
export function estimateAgentTokens(messages: MessageLike[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    if (readOwn(msg, "role") !== "user") total += estimateTokens([msg]).tokens;
  }
  return total;
}

/**
 * messageCharLength — the character length of one message's stringified content. Pure + defensive: a message with
 * no content / non-array blocks / a throwing accessor contributes ≥0 and never throws (GOTCHA #3). Module-local
 * (not exported); callers use estimateTokens([msg]) for per-message estimates (GOTCHA #5: divide once, at the top).
 */
function messageCharLength(msg: MessageLike): number {
  const content = readOwn(msg, "content");
  if (typeof content === "string") {
    return content.length;
  }
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      n += blockCharLength(block);
    }
    return n;
  }
  return 0; // content absent / null / unsupported shape → contributes nothing (defensive)
}

/** Character length of a single content block (defensive — never throws). */
function blockCharLength(block: unknown): number {
  if (!isRecord(block)) return 0;
  const type = readOwn(block, "type");
  switch (type) {
    case "text":
      return stringLength(readOwn(block, "text"));
    case "thinking":
      return stringLength(readOwn(block, "thinking"));
    case "toolCall": {
      // substance = name + JSON(arguments); the id is overhead and omitted. arguments may be circular/BigInt →
      // safeStringify swallows the TypeError (GOTCHA #3).
      const name = stringLength(readOwn(block, "name"));
      const args = safeStringLength(readOwn(block, "arguments"));
      return name + args;
    }
    case "image":
      // base64 data counted at face value → an OVERESTIMATE of image token cost (a screenshot's base64 is huge but
      // vision tokens are small). Counting it keeps the estimate monotonic + simple; the confidence flag carries
      // the honesty (spec/01 §7). See GOTCHA #4.
      return stringLength(readOwn(block, "data"));
    default:
      return 0; // unknown block type → contributes nothing (forward-compat, defensive)
  }
}

// ── module-private defensive helpers (never throw — GOTCHA #3) ───────────────

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

/** Length of a value when it is a string; 0 otherwise (content fields may be missing/mistyped). */
function stringLength(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

/** Length of JSON.stringify(value); 0 if value is not stringifiable (circular refs / BigInt → TypeError). */
function safeStringLength(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P1.M2.T1.S2 additions — byte-level result measurement + byte→token conversion.
// spec/07-preventive-and-nudges.md §1 (bloated-result reminder; threshold in BYTES of in-context text),
// spec/04-data-model.md §5 (TurnMetric.bloatHits[].approxTokens), spec/03 §2.3 (pure helpers),
// spec/11-build-order.md §1 (tokens.ts holds estimateTokens + resultBytes + approxTokens), spec/10 §1.
//
// These two helpers are the measurement core of Nudge A (P1.M6.T1.S1): the tool_result handler calls
// resultBytes(event.content), compares to config.nudges.bloatThresholdBytes (bytes), and stores
// approxTokens(bytes) in the persisted turn-metric bloatHits. They are APPENDED to S1's module and REUSE:
//   - the exported CHARS_PER_TOKEN (= 4) in approxTokens (one canonical ratio; the S1 PRP exports it for S2 reuse),
//   - the module-private isRecord / readOwn / stringLength (same module scope; hoisted — no redeclaration).
// S2 adds ZERO imports (Buffer is a Node global; Math/JSON are builtins), so the tokens.ts zero-imports gate
// (S1 GOTCHA #2) stays green. The new module-private helper stringByteLength measures UTF-8 BYTE length for the
// text case (the image case reuses stringLength because base64 is ASCII → char length == byte length — GOTCHA #3).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A content block as carried by a Pi `tool_result` (api_verification.md §7.2: `content` is
 * `(TextContent | ImageContent)[]`). `resultBytes` inspects ONLY `type`, `text`, `data`, so this deliberately
 * LOOSE structural shape captures exactly what it needs and is permissive enough that a real
 * `(TextContent | ImageContent)[]` assigns in with no cast. The index signature accepts extra fields (e.g.
 * `mimeType`) and lets unknown/future block types flow through (they simply contribute 0 bytes — forward-compat).
 *
 * This is BROADER than S1's module-local `TextContent`/`ImageContent` (which are not exported); resultBytes must
 * not over-tighten its input, because the downstream nudge handler hands it `event.content` directly.
 */
export interface ResultContentBlock {
  type: string;
  /** Present on `text` blocks. */
  text?: string;
  /** Present on `image` blocks (base64). */
  data?: string;
  [key: string]: unknown;
}

/**
 * resultBytes — the UTF-8 BYTE size of a tool_result's in-context content (spec/07 §1: "the threshold is in
 * BYTES of the in-context text representation … UTF-8 byte length").
 *
 * For each content block: a `text` block contributes `Buffer.byteLength(text, "utf8")` (multibyte-aware — a
 * 16 KB CJK log reads as 16 KB, NOT ~6 KB chars); an `image` block contributes `data?.length ?? 0` (base64 is
 * ASCII, so char length == byte length); any other `type` contributes 0. The result is a non-negative integer.
 *
 * Pure + defensive: non-array content (null/undefined/string/number) → 0; non-record block elements are skipped;
 * a throwing-Proxy block contributes 0 (reuses S1's `readOwn`, which swallows the trap). NEVER throws — it sits
 * on the tool_result hot path and feeds the persisted turn-metric.
 *
 * @param content the tool_result content array (a single block via `resultBytes([block])`)
 * @returns non-negative integer byte count
 */
export function resultBytes(content: ResultContentBlock[] | null | undefined): number {
  if (!Array.isArray(content)) {
    return 0; // absent / null / non-array (string|number|object) → 0 (defensive; tool_result content is always an array)
  }
  let bytes = 0;
  for (const block of content) {
    if (!isRecord(block)) {
      continue; // null / primitive element → skip (contributes 0)
    }
    const type = readOwn(block, "type");
    if (type === "text") {
      // TEXT → UTF-8 BYTE length. Multibyte-aware: "café"=5 bytes, NOT 4. (GOTCHA #3 — do NOT use .length here.)
      bytes += stringByteLength(readOwn(block, "text"));
    } else if (type === "image") {
      // IMAGE → base64 char length. Base64 is ASCII → char length == byte length; .length is correct + cheaper on a
      // potentially-huge blob. (GOTCHA #3 — do NOT switch to Buffer.byteLength; match the contract.)
      bytes += stringLength(readOwn(block, "data"));
    }
    // unknown type → contributes 0 (forward-compat: future block types are measured as nothing until taught).
  }
  return bytes;
}

/**
 * approxTokens — convert a byte count to an approximate token count (spec/04 §5: stored in
 * `TurnMetric.bloatHits[].approxTokens`; spec/07 §1: "8 KB ≈ 2k tokens in-context").
 *
 * Formula: `Math.ceil(bytes / CHARS_PER_TOKEN)` — reuses S1's exported `CHARS_PER_TOKEN = 4` (the OpenAI
 * "~4 chars ≈ 1 token" rule of thumb; for ASCII bytes==chars so bytes/4 is the same heuristic on the byte count).
 * `approxTokens(8192) = 2048` reproduces the spec's own "8 KB ≈ 2k tokens" equivalence EXACTLY — strong
 * confirmation this is the intended formula. `Math.ceil` (not floor) so a non-empty result reports ≥1 token.
 *
 * Defensive: non-finite (`NaN`/`±Infinity`) or negative `bytes` → 0 (Math.ceil would otherwise yield
 * `NaN`/`Infinity`/a negative — all nonsense token counts; resultBytes never yields these, but approxTokens is a
 * public helper that may be called with arbitrary input). NEVER throws.
 *
 * @param bytes a non-negative byte count (typically resultBytes(content))
 * @returns non-negative integer approximate token count
 */
export function approxTokens(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 0; // NaN / ±Infinity / negative → 0 (defensive; approxTokens is a public helper)
  }
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

/**
 * stringByteLength — the UTF-8 BYTE length of a value when it is a string; 0 otherwise. Module-private (not
 * exported). Uses the Node global `Buffer.byteLength` (no import — GOTCHA #2). `Buffer.byteLength("café","utf8")`
 * = 5, `"😀"` = 4, `""` = 0. Mirrors S1's `stringLength` (char length) for the byte-length case (GOTCHA #3).
 */
function stringByteLength(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
}