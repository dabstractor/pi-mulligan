import type { FileLedger } from "./ledger.js";
import type { Granularity } from "./config.js";

/**
 * notes.ts — Mulligan's note validation + rendering (pure helpers).
 * spec/04-data-model.md §2.1 (NoteInput), spec/05-tools.md §1 step 2 (validate note: all four non-empty),
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
 *   missing/non-string/whitespace-only → { valid:false, reason }. `note` is typed NoteInput (all four required
 *   strings) but fields are read as `unknown` via readOwn so the `typeof === 'string'` check is REAL, not dead code.
 *
 * NOTE: P1.M2.T3.S2 (renderNote) + P1.M2.T3.S3 (renderBloatReminder/renderDriftNudge) APPEND to this file next
 *   and REUSE the module-private isRecord/readOwn helpers below (hoisted in this module scope — mirrors how
 *   tokens.ts's S2 reused S1's helpers).
 */

// ── NoteInput (spec/04-data-model.md §2.1 — field names + optionality are load-bearing) ──────────

/**
 * NoteInput — what the agent passes to mulligan_rewind as the `note` (spec/04 §2.1). All four fields are
 * REQUIRED non-empty strings (enforced by validateNote; see spec/05 §1 step 2 + spec/08 E9). The structure is
 * the primary defense against confabulation (D2): the resumed model is told explicitly what happened, what to
 * avoid, the true current state, and what to do next. EXPORTED so the rewind tool, renderNote (S2), and tests
 * share one canonical type. ALSO persisted verbatim in RewindMarker.note (spec/04 §3).
 */
export interface NoteInput {
  /** What went wrong, concretely. Past tense. e.g. "Ran `grep -r auth .` and dumped ~40k tokens I didn't need." */
  what_happened: string;
  /** What NOT to do again. Imperative. e.g. "Do not run grep without --quiet, -c, or piping to head." */
  avoid: string;
  /** The current TRUE world state as of the rewind — files changed, commands run, decisions made on the span. */
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

/** The four required, non-empty note fields, in spec/04 §2.1 order. Drives validateNote's loop (module-local). */
const NOTE_FIELDS: readonly (keyof NoteInput)[] = [
  "what_happened",
  "avoid",
  "true_current_state",
  "next",
];

/**
 * validateNote — assert all four NoteInput fields are non-empty strings AFTER TRIM (spec/05 §1 step 2, spec/08 E9,
 * spec/10 §1.8). The rewind tool calls this as step 2 of its behavior, BEFORE persisting the marker + note; a
 * vacuous note is refused so it cannot defeat the confabulation defense (D2).
 *
 * Each field must satisfy `typeof === 'string' && field.trim().length > 0`. Any failure (missing, non-string,
 * empty, or whitespace-only) → { valid:false, reason: NOTE_INVALID_REASON }. All four present + non-empty →
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
 *     **Avoid:** <avoid>
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
    `**Avoid:** ${readNoteField(note, "avoid")}`,
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
  key: "what_happened" | "avoid" | "true_current_state" | "next",
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