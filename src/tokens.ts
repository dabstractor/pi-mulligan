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