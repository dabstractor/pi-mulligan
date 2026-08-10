import type { FileLedger } from "./ledger.js";
import type { Granularity } from "./config.js";

/**
 * notes.ts — Mulligan's note validation + rendering (pure helpers).
 * spec/04-data-model.md §2.1 (NoteInput), spec/05-tools.md §1 step 2 (validate note: all three non-empty),
 *   spec/08-edge-cases.md E9 (note field validation failure → refuse), spec/10-testing.md §1.8 (field validation),
 *   spec/03-architecture.md §2.3/§7 + spec/11 §1 (notes.ts = pure helper: validateNote/renderNote/...).
 *
 * DESIGN (read GOTCHA #1–#10 in the PRP):
 * - Pure-helper tier and Pi-FREE. At S1 (THIS task) validateNote imports NOTHING — it is fully unit-testable in
 *   isolation. P1.M2.T3.S2 (renderNote) APPENDS to this module and will ADD `import type { FileLedger } from
 *   "./ledger.js"` + `import type { Granularity } from "./config.js"` — that is EXPECTED and correct: notes.ts is
 *   the PURE-HELPER tier (spec/11 §1), NOT the foundation zero-imports tier (tokens.ts/ledger.ts). So unlike
 *   tokens.ts/ledger.ts, notes.ts is NOT bound to a PERMANENT zero-imports gate; only S1 keeps the count at 0.
 * - validateNote is the rewind tool's runtime guard against a vacuous note (spec/05 §1 step 2, E9). The structured
 *   note is the PRIMARY defense against confabulation (D2); a half-hearted note (any field missing / empty /
 *   whitespace-only) is rejected. The single reason "note fields must all be non-empty" is SPEC-PINNED (spec/05
 *   step 2, E9); the rewind tool prefixes it as "Mulligan: refused — <reason>.".
 * - NEVER throws (rewind-tool hot path; E9/E13 discipline). isRecord guards a null/array/primitive note; readOwn
 *   reads each field WITHOUT triggering a throwing Proxy get-trap. A malformed note or a field that is
 *   missing/non-string/whitespace-only → { valid:false, reason }. `note` is typed NoteInput (all three required
 *   strings) but fields are read as `unknown` via readOwn so the `typeof === 'string'` check is REAL, not dead code.
 *
 * NOTE: P1.M2.T3.S2 (renderNote) + P1.M2.T3.S3 (renderBloatReminder/renderDriftNudge) APPEND to this file next
 *   and REUSE the module-private isRecord/readOwn helpers below (hoisted in this module scope — mirrors how
 *   tokens.ts's S2 reused S1's helpers).
 */

// ── NoteInput (spec/04-data-model.md §2.1 — field names + optionality are load-bearing) ──────────

/**
 * NoteInput — what the agent passes to mulligan_rewind as the `note` (spec/04 §2.1). All three fields are
 * REQUIRED non-empty strings (enforced by validateNote; see spec/05 §1 step 2 + spec/08 E9). The structure is
 * the primary defense against confabulation (D2): the resumed model is told explicitly what happened (and the
 * lesson — what to avoid doing again), the true current state, and what to do next. EXPORTED so the rewind tool,
 * renderNote (S2), and tests share one canonical type. ALSO persisted verbatim in RewindMarker.note (spec/04 §3).
 */
export interface NoteInput {
  /** Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson. */
  what_happened: string;
  /** The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work. */
  true_current_state: string;
  /** The immediate next action to take on resume. Imperative. e.g. "Re-run the search as `grep -rl auth src/`." */
  next: string;
}

/** Result of validateNote. `reason` is present iff `valid` is false (always NOTE_INVALID_REASON). EXPORTED. */
export interface NoteValidation {
  valid: boolean;
  /** Present only when valid===false; always NOTE_INVALID_REASON. */
  reason?: string;
}

/**
 * NOTE_INVALID_REASON — the single, spec-pinned refusal reason (spec/05 §1 step 2: "Mulligan: refused — note
 * fields must all be non-empty."; spec/08 E9: "note fields must all be non-empty."). NO trailing period — the
 * rewind tool adds the prefix "Mulligan: refused — " and the sentence-closing "." when it formats its refusal.
 * EXPORTED so the rewind tool reuses the exact literal (DRY + consistency) and so tests can pin it.
 */
export const NOTE_INVALID_REASON = "note fields must all be non-empty";

/** The three required, non-empty note fields, in spec/04 §2.1 order. Drives validateNote's loop (module-local). */
const NOTE_FIELDS: readonly (keyof NoteInput)[] = [
  "what_happened",
  "true_current_state",
  "next",
];

/**
 * validateNote — assert all three NoteInput fields are non-empty strings AFTER TRIM (spec/05 §1 step 2, spec/08 E9,
 * spec/10 §1.8). The rewind tool calls this as step 2 of its behavior, BEFORE persisting the marker + note; a
 * vacuous note is refused so it cannot defeat the confabulation defense (D2).
 *
 * Each field must satisfy `typeof === 'string' && field.trim().length > 0`. Any failure (missing, non-string,
 * empty, or whitespace-only) → { valid:false, reason: NOTE_INVALID_REASON }. All three present + non-empty →
 * { valid:true }. The reason is the SAME single string for every failure (spec-pinned) — we do NOT vary it per
 * field, because the rewind tool shows one refusal text either way.
 *
 * Pure + defensive: NEVER throws (rewind-tool hot path; E9/E13-style discipline). isRecord guards a
 * null/array/primitive note passed as NoteInput; readOwn reads each field WITHOUT triggering a throwing Proxy
 * get-trap. Fields are read as `unknown` via readOwn, so the `typeof === 'string'` check is REAL (not dead code):
 * it catches a runtime-non-string value when a caller violates the NoteInput type.
 *
 * @param note the agent's NoteInput (a real note object assigns in with no cast)
 * @returns { valid:true } or { valid:false, reason: NOTE_INVALID_REASON }
 */
export function validateNote(note: NoteInput): NoteValidation {
  if (!isRecord(note)) {
    // null / primitive / array passed as NoteInput → invalid (defensive; never throws). At the type level
    // NoteInput is always a record, so TS treats this branch as unreachable — that is fine; the runtime guard
    // still executes for a type-violating caller.
    return { valid: false, reason: NOTE_INVALID_REASON };
  }
  for (const field of NOTE_FIELDS) {
    const value = readOwn(note, field);
    // typeof first (short-circuit: avoids .trim() on a non-string); then non-empty after trim.
    if (typeof value !== "string" || value.trim().length === 0) {
      return { valid: false, reason: NOTE_INVALID_REASON };
    }
  }
  return { valid: true };
}

// ── module-private defensive helpers (mirror tokens.ts/ledger.ts — never throw; reused by S2/S3) ────

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

// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M2.T3.S2) — renderNote (spec/04-data-model.md §2.3 — the mulligan:note CustomMessage content)
// APPENDED below the S1 exports (NoteInput, NoteValidation, NOTE_INVALID_REASON, validateNote) and the
// module-private isRecord/readOwn helpers, which are UNCHANGED and REUSED here. This module now imports
// TYPE-ONLY { FileLedger } (from ledger.js) + { Granularity } (from config.js) — erased at compile time, so
// notes.ts stays Pi-free and unit-testable in isolation (notes.ts is the pure-helper tier, NOT a permanent
// zero-imports gate — see S1 PRP GOTCHA #2). renderNote is pure and is unit-tested with snapshot-style cases
// (spec/10 §1.8).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three ledger block descriptors, in spec/04 §2.3 order (read → modified → bash). Each tuple is
 * [rendered-tag, FileLedger-field]. Module-local.
 */
const LEDGER_BLOCKS: ReadonlyArray<readonly [tag: string, field: keyof FileLedger]> = [
  ["files-read", "readFiles"],
  ["files-modified", "modifiedFiles"],
  ["bash-side-effects", "bashSideEffects"],
];

/**
 * renderNote — compose the markdown note the resumed model reads as the `mulligan:note` CustomMessage content
 * (spec/04-data-model.md §2.3). PURE: it interpolates the (already-validated) NoteInput + the deterministic
 * FileLedger + the Granularity into the pinned markdown shape. Called by tools/rewind.ts step 5 (spec/05 §1)
 * AFTER validateNote has passed (step 2) and the ledger is composed; the returned string becomes
 * `pi.sendMessage({ customType:"mulligan:note", content: <this>, display:true, details:{...} })` (spec/05 §1
 * step 6; spec/04 §3).
 *
 * FORMAT (spec/04 §2.3 — built by joining these sections with a blank line, i.e. "\n\n"):
 *     ## 🔄 Mulligan rewind (<granularity>)
 *     **What happened:** <what_happened>
 *     **Current true state:** <true_current_state>
 *     <files-read>…</files-read>                ← omitted iff ledger.readFiles is empty
 *     <files-modified>…</files-modified>        ← omitted iff ledger.modifiedFiles is empty
 *     <bash-side-effects>…</bash-side-effects>  ← omitted iff ledger.bashSideEffects is empty
 *     **Next:** <next>
 * Each ledger block is `<tag>\n<item1>\n<item2>\n…\n</tag>` (items joined by "\n", one per line). The block tags
 * mirror Pi's compaction summary convention so a model accustomed to compaction parses them naturally (spec/04
 * §2.3). The granularity is interpolated VERBATIM (e.g. "last_turn", NOT "Last turn"). No trailing newline.
 *
 * DEFENSIVE — NEVER throws (rewind-tool hot path; E13 discipline). note fields are read via readOwn (Proxy-safe;
 * a throwing-Proxy get-trap returns undefined, not an exception); a non-record note or non-array ledger list
 * renders gracefully (treated as empty strings / empty block) rather than crashing. renderNote does NOT re-validate
 * the note — validateNote (step 2) already guarantees every field is a non-empty string in real use; this function
 * just renders whatever it is given, defensively. Field VALUES are rendered AS-IS (spec/04 §2.3).
 *
 * @param note        the agent's NoteInput (validateNote has already accepted it)
 * @param ledger      the deterministic FileLedger from extractFileLedger (P1.M2.T2.S1)
 * @param granularity the rewind granularity, interpolated into the header verbatim
 * @returns the markdown string (sections separated by blank lines; NO trailing newline)
 */
export function renderNote(
  note: NoteInput,
  ledger: FileLedger,
  granularity: Granularity,
): string {
  const sections: string[] = [
    `## 🔄 Mulligan rewind (${granularity})`,
    `**What happened:** ${readNoteField(note, "what_happened")}`,
    `**Current true state:** ${readNoteField(note, "true_current_state")}`,
  ];
  for (const [tag, field] of LEDGER_BLOCKS) {
    const items = readLedgerList(ledger, field);
    if (items.length > 0) {
      sections.push(`<${tag}>\n${items.join("\n")}\n</${tag}>`);
    }
  }
  sections.push(`**Next:** ${readNoteField(note, "next")}`);
  return sections.join("\n\n");
}

/**
 * Read a NoteInput field as a string ("" if absent/non-string); defensive, never throws (a Proxy get-trap may
 * throw — readOwn swallows it). Module-private; reuses S1's readOwn. The literal-union key keeps the call sites
 * type-checked against the real NoteInput field names.
 */
function readNoteField(
  note: unknown,
  key: "what_happened" | "true_current_state" | "next",
): string {
  const v = readOwn(note, key);
  return typeof v === "string" ? v : "";
}

/**
 * Read a FileLedger list as a string[] (filtering to string elements; [] if absent/non-array). Defensive, never
 * throws. Module-private; reuses S1's readOwn. The `keyof FileLedger` keeps the call sites type-checked.
 */
function readLedgerList(ledger: unknown, field: keyof FileLedger): string[] {
  const v = readOwn(ledger, field);
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 (P1.M2.T3.S3) — renderBloatReminder + renderDriftNudge (spec/07-preventive-and-nudges.md §1 + §2).
// APPENDED below the S1 exports/helpers + the S2 renderNote block, which are UNCHANGED and REUSED here
// (isRecord/readOwn are hoisted in this module scope; no redeclaration). This module already imports TYPE-ONLY
// { FileLedger } + { Granularity } (S2); S3 adds NO imports — DriftNudgeInput is defined inline, so notes.ts stays
// Pi-free and unit-testable in isolation. These two renderers are the TEXT core of the two nudges (P1.M6): consumed
// by nudges.ts (tool_result annotator + turn_end→context injector) but pure + unit-tested without Pi (spec/07 §3,
// spec/10 §1). This COMPLETES notes.ts (spec/11 §1: "validateNote, renderNote, renderBloatReminder, renderDriftNudge").
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DriftNudgeInput — the minimal projection of TurnMetric (spec/04-data-model.md §5) that renderDriftNudge needs.
 * A real TurnMetric is STRUCTURALLY ASSIGNABLE to this (a mutable `{...}[]` widens to `ReadonlyArray<{...}>`
 * soundly), so nudges.ts / filter.ts pass the full metric with NO cast. EXPORTED so the consumer + tests share one
 * type. `deltaTokens` is `null` when the token baseline is unknown (first turn / post-reload) — renderDriftNudge
 * then drops the "added ~<delta>k tokens" clause and leads with bloat (spec/07 §2 edge cases). Only `.length` of
 * bloatHits is interpolated into the v1 text; the per-hit toolName/approxTokens are reserved for richer nudges.
 */
export interface DriftNudgeInput {
  /** Signed estimate of how much context grew this turn; null when unknown (first turn / post-reload). */
  deltaTokens: number | null;
  /** Bloated tool results recorded this turn (empty array if none). */
  bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }>;
}

/**
 * renderBloatReminder — Nudge A's text (spec/07-preventive-and-nudges.md §1). Composes the short reminder the
 * tool_result handler APPENDS to a result's content when its byte size exceeds the threshold. The returned string
 * is the `text` of a `{type:"text"}` content block appended via `[...(event.content ?? []), {type:"text",
 * text:reminder}]`. ~30 tokens, incurred once per bloated result; advisory (D3) — appended, not replacing.
 *
 * FORMAT (spec/07 §1 — VERBATIM; leading "\n---\n" is a markdown horizontal rule; single line):
 *     \n---\nThis result added ~<KB> KB to your context. If you don't need the full output, call
 *     `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if
 *     the whole call was a mistake.
 * <KB> = bytesToKb(bytes). NO [mulligan] prefix, NO threshold mention, NO "stays on disk" clause.
 * NO trailing newline.
 *
 * `toolName` is ACCEPTED (the handler passes event.toolName) but is NOT interpolated into the v1 text (the spec
 * text has no <toolName> placeholder) — RESERVED for future personalization. Named `toolName` without underscore
 * per spec/07 §1 signature; bare-unused is safe — no noUnusedParameters, no eslint (GOTCHA #1).
 *
 * DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §1; E13). Non-finite/negative bytes render as 0 KB
 * (a public helper may receive arbitrary input; resultBytes never yields these but the guard keeps the function total).
 *
 * @param toolName  the tool that produced the result (ACCEPTED, NOT used in v1 text; reserved for future use)
 * @param bytes     the result's UTF-8 byte size (from resultBytes — spec/07 §1)
 * @returns the reminder string (leading "\n---\n" + single-line body; NO trailing newline)
 */
export function renderBloatReminder(toolName: string, bytes: number): string {
  const resultKb = bytesToKb(bytes);
  return `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake.`;
}

/**
 * renderDriftNudge — Nudge B's text (spec/07-preventive-and-nudges.md §2). Composes the annotation the context
 * handler injects as a NON-persisted `mulligan:nudge` custom message (via injectNudge — spec/06 §1 + spec/07 §2)
 * when the previous turn grew context over threshold OR produced bloated results. ~25–40 tokens, only when it fires.
 *
 * FORMAT (spec/07 §2 — VERBATIM; a SINGLE physical string with NO embedded "\n"; the LEAD varies by input,
 * the tail after "<lead>." is FIXED in all cases):
 *     <lead>. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
 * <lead> is a 3-branch selection (delta WINS regardless of bloat):
 *   - delta != null:         "Previous turn added ~<k> tokens to your context"   (NO bloat mention)
 *   - delta == null, bloat>0: "Previous turn produced <N> bloated <resultWord>"   (the only bloat path)
 *   - both empty:            "Previous turn changed your context"                 (unreachable; totality fallback)
 * <k> = kTokens(delta) (delta/1000, 1 decimal: 4200→"4.2k", 3000→"3k"); <N> = bloatHits.length;
 * resultWord = resultWord(N) (1→"result", else "results"). NO [mulligan] prefix. NO trailing newline.
 * NO embedded newline. The "consider"→"call" + "; run"-joined tail condenses the old 3-line form to one line.
 *
 * BLOAT IS COSMETIC ON THE DELTA PATH: pendingBloatHits are collected at tool_result time and are NOT subtracted
 * when a later mulligan_rewind/shrink hides those results, so a bloat count on the delta path could surface stale
 * figures (a since-shrunk result re-announced one turn later). The delta path therefore NEVER renders bloat —
 * bloat is retained ONLY as the no-baseline fallback LEAD (first turn / post-reload, deltaTokens===null), where
 * it is the sole available signal. (Per spec/07 §2 edge cases: the rough edge is closed at the rendering layer too.)
 *
 * DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §2; E13). deltaTokens/bloatHits are read via readOwn
 * + isRecord/Array.isArray guards (mirrors S2's readLedgerList); a malformed/throwing-Proxy metric renders
 * gracefully. renderDriftNudge is reached ONLY when shouldNudge is true (grewOverThreshold || bloatHit — spec/06 §1),
 * so the both-empty case is unreachable in practice; it still returns a deterministic string so the pure function
 * is total. deltaTokens===null means UNKNOWN (first turn) — it is NOT rendered as "~0k" (a lie); the delta clause
 * is dropped and bloat leads.
 *
 * @param metric the drift metric projection (DriftNudgeInput — deltaTokens + bloatHits)
 * @returns the nudge string (a SINGLE physical line; NO embedded "\n"; NO trailing newline)
 */
export function renderDriftNudge(metric: DriftNudgeInput): string {
  const delta = readDelta(metric);
  const hits = readBloatHits(metric);
  let lead: string;
  if (delta != null) {
    lead = `Previous turn added ~${kTokens(delta)} tokens to your context`;
  } else if (hits.length > 0) {
    lead = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else {
    lead = "Previous turn changed your context"; // unreachable via shouldNudge; totality fallback
  }
  return `${lead}. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.`;
}

// ── S3 module-private helpers (mirror S2's readLedgerList; reuse S1's isRecord/readOwn) ─────────────

/**
 * bytesToKb — convert a byte count to an integer KB value for display (spec/07 §1 "<KB> KB"). Math.round(n/1024);
 * non-finite (NaN/±Infinity) or negative → 0. `bytesToKb(8192)=8`, `bytesToKb(30720)=30` (the spec's "30 KB
 * read"), `bytesToKb(8704)=9`. Module-private. NEVER throws.
 */
function bytesToKb(n: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.round(n / 1024) : 0;
}

/**
 * kTokens — render a token delta as a "k" string (spec/07 §2 "~<delta>k"). Round to 1 decimal place: 4200→"4.2k",
 * 3000→"3k", 9800→"9.8k" (the spec h2.6 example shows "4.2k"; JS drops the trailing ".0" naturally). Module-private.
 */
function kTokens(delta: number): string {
  return `${Math.round((delta / 1000) * 10) / 10}k`;
}

/**
 * resultWord — pluralize "result" for the drift nudge bloat clause (spec/07 §2 "result(s)"). 1→"result",
 * else→"results". Module-private.
 */
function resultWord(n: number): string {
  return n === 1 ? "result" : "results";
}

/**
 * readDelta — read metric.deltaTokens as a finite number, else null (null = "unknown", e.g. first turn — spec/07 §2
 * edge cases). Defensive, never throws (a Proxy get-trap may throw — readOwn swallows it). Module-private; reuses
 * S1's readOwn. `deltaTokens === 0` is a real number (returns 0, not null); only a missing/non-number → null.
 */
function readDelta(metric: unknown): number | null {
  const v = readOwn(metric, "deltaTokens");
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * readBloatHits — read metric.bloatHits as a filtered array of {toolName, approxTokens} (only records with a string
 * toolName + finite number approxTokens survive; [] if absent/non-array). The COUNT (renderDriftNudge uses .length)
 * is therefore robust to malformed entries. Defensive, never throws. Module-private; reuses S1's isRecord/readOwn
 * (mirrors S2's readLedgerList).
 */
function readBloatHits(metric: unknown): Array<{ toolName: string; approxTokens: number }> {
  const v = readOwn(metric, "bloatHits");
  if (!Array.isArray(v)) return [];
  const out: Array<{ toolName: string; approxTokens: number }> = [];
  for (const hit of v) {
    if (isRecord(hit)) {
      const toolName = readOwn(hit, "toolName");
      const approxTokens = readOwn(hit, "approxTokens");
      if (typeof toolName === "string" && typeof approxTokens === "number" && Number.isFinite(approxTokens)) {
        out.push({ toolName, approxTokens });
      }
    }
  }
  return out;
}