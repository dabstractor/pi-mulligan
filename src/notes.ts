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