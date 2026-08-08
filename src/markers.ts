/**
 * markers.ts — Mulligan's Pi-coupled persistence wrappers (spec/11 §2 Step 4; spec/03 §7).
 * spec/04-data-model.md §1 (MulliganEnvelope), §3 (RewindMarker), §4 (ShrinkMarker), §5 (TurnMetric),
 *   spec/02-proven-constraints.md C7 (appendEntry returns void), C1 (ReadonlySessionManager), C12 (read fresh),
 *   spec/05-tools.md §1 step 6 (the leaf-capture idiom), spec/06-context-filter.md §1 (readMarkers/stableSortBySeq).
 *
 * DESIGN (read GOTCHA #1–#12 in the PRP):
 * - Pi Integration Layer. This is the FIRST module that imports Pi (ExtensionAPI/ExtensionContext) and PERSISTS
 *   markers. It is thin glue: it wraps pi.appendEntry, captures the new marker's entry id immediately after (C7),
 *   and increments the per-session seq via runtime.ts nextSeq(). The pure helpers (transforms/tokens/ledger/notes)
 *   consume NOTHING from here; the consumers are tools/* (P1.M5) and nudges.ts (P1.M6).
 * - Three wrappers: appendRewindMarker, appendShrinkMarker, appendTurnMetric. Each stamps the versioned envelope
 *   {schema:'pi-mulligan', v:1, kind} + a monotonic per-session seq + ts onto the caller's marker payload, appends
 *   it, and returns the NEW marker's entry id (or null). Rewind + shrink also stamp an `id` (uuid); turn-metric
 *   does NOT (spec/04 §5 has no id — GOTCHA #4).
 * - NEVER throws (fail-open discipline; markers.ts sits on the tool/event hot path). Each whole body is wrapped in
 *   try/catch → returns null on ANY failure (appendEntry throws, getLeafId throws/returns null, etc.).
 *
 * NOTE: P1.M4.T1.S2 (leaveNote = pi.sendMessage mulligan:note; setCheckpoint = pi.setLabel) APPENDS to this file
 *   next and REUSES the MulliganEnvelope / marker interfaces + the capture-after-append idiom defined here.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { nextSeq } from "./runtime.js";
import type { Granularity } from "./config.js";
import type { FileLedger } from "./ledger.js";
import type { NoteInput } from "./notes.js";

// ── Versioning envelope (spec/04-data-model.md §1) ───────────────────────────

/**
 * MulliganEnvelope — the versioning tag stamped into EVERY persisted CustomEntry's `data` (spec/04 §1). `schema`
 * distinguishes Mulligan entries from other extensions' CustomEntries; `v` is the schema version (v1 = this spec);
 * `kind` is the Mulligan-level discriminator inside `data` (distinct from the Pi-level `customType`). EXPORTED so
 * the filter/tools/audit/tests share ONE canonical shape.
 */
export interface MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind" | "shrink" | "turn-metric";
}

// ── Marker: rewind (spec/04-data-model.md §3) ───────────────────────────────

/**
 * RewindMarker — persisted via pi.appendEntry("mulligan:rewind", data) (spec/04 §3, spec/05 §1 step 6). `kind`
 * narrows to "rewind". `id` (uuid) correlates the marker with its mulligan:note CustomMessage. `granularity` is the
 * targeting spec the filter resolves each inference (the canonical `Granularity` union from config.ts — GOTCHA #7:
 * spec/04 §3 lists only the two relative literals, but spec/05 §1 + §6 require "checkpoint"). `excludeToolCallId`
 * lets the filter skip the rewind's own tool-call group (spec/06 §3). `seq` orders markers reliably even if
 * timestamps tie (filter stableSortBySeq — spec/06 §1). `note`/`ledger` duplicate the structured note for audit.
 * EXPORTED for the filter (readMarkers cast) + tools + audit + tests.
 */
export interface RewindMarker extends MulliganEnvelope {
  kind: "rewind";
  id: string;
  granularity: Granularity;
  options: {
    /** Only for granularity=last_turn. If true, also discard the most recent user message (nuclear). Default false. */
    to_previous_prompt?: boolean;
    /** Role list that must not be crossed (default from config.rewind.protectedRoles). */
    protect?: string[];
  };
  /** toolCallId of THIS rewind's own tool call, so the filter excludes it resolving "last tool-call group" (spec/06 §3). */
  excludeToolCallId?: string;
  /** Monotonic per-session counter (runtime.ts nextSeq); persisted INTO the marker so the filter can order reliably. */
  seq: number;
  /** The structured note (spec/04 §2.1) — duplicated here for self-containment (the rendered note also lives in the
   *  mulligan:note CustomMessage; this is the structured form for audit/debug). */
  note: NoteInput;
  ledger: FileLedger;
  ts: number;
}

/** RewindMarkerInput — the caller-supplied payload for appendRewindMarker (spec/04 §3 MINUS the envelope + id + seq + ts,
 *  which the wrapper stamps on). The mulligan_rewind tool (P1.M5.T1.S1) builds this. */
export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;

// ── Marker: shrink (spec/04-data-model.md §4) ───────────────────────────────

/**
 * ShrinkTarget — how a shrink identifies the message to substitute (spec/04 §4). Discriminated union; the filter
 * (resolveShrinkTarget, P1.M3.T4.S2) resolves it live each inference against event.messages. EXPORTED for the shrink
 * tool's typebox-free type + the filter + tests.
 */
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

/**
 * ShrinkMarker — persisted via pi.appendEntry("mulligan:shrink", data) (spec/04 §4, spec/05 §2 step 4). `replacement`
 * substitutes the matched ToolResultMessage's content (the filter preserves role/toolCallId/toolName/isError so the
 * tool-pairing invariant holds — spec/06 §2). `seq` orders shrinks relative to rewinds (filter applies shrinks AFTER
 * rewinds, oldest-first by seq — spec/06 §1). EXPORTED for the filter/tools/audit/tests.
 */
export interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink";
  id: string;
  target: ShrinkTarget;
  /** The compact text that replaces the matched message's content, going forward. */
  replacement: string;
  /** Optional reason, surfaced in audit. */
  reason?: string;
  seq: number;
  ts: number;
}

/** ShrinkMarkerInput — caller payload for appendShrinkMarker (spec/04 §4 MINUS envelope + id + seq + ts). */
export type ShrinkMarkerInput = Omit<ShrinkMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;

// ── Marker: turn-metric (spec/04-data-model.md §5) ───────────────────────────

/**
 * TurnMetric — appended at turn_end via pi.appendEntry("mulligan:turn-metric", data) (spec/04 §5). Only the LATEST
 * one on the branch is consulted by the filter (older ones persist but are ignored). NOTE (GOTCHA #4): spec/04 §5
 * has NO `id` field (unlike rewind/shrink) — appendTurnMetric does NOT stamp one. NOTE (GOTCHA #6): deltaTokens is
 * widened to `number | null` to match the §5 prose ("deltaTokens is null when baseline missing"). EXPORTED for the
 * turn_end handler (P1.M6.T2.S1) + the filter + tests.
 */
export interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric";
  seq: number;
  ts: number;
  /** Signed estimate of how much context grew this turn. null when the baseline is missing (first turn / post-reload). */
  deltaTokens: number | null;
  /** Any tool_result this turn exceeded the bloat threshold. */
  bloatHit: boolean;
  bloatHits: { toolName: string; approxTokens: number }[];
  /** deltaTokens > driftThresholdTokens (config.nudges.driftThresholdTokens). */
  grewOverThreshold: boolean;
  /** The turn index this metric describes (from turn_end event.turnIndex). */
  turnIndex: number;
}

/** TurnMetricInput — caller payload for appendTurnMetric (spec/04 §5 MINUS envelope + seq + ts; NO id — GOTCHA #4). */
export type TurnMetricInput = Omit<TurnMetric, "schema" | "v" | "kind" | "seq" | "ts">;

// ── Wrappers (Pi appendEntry + leaf-id capture + seq stamp) ──────────────────

/**
 * appendRewindMarker — persist a rewind marker, return its new entry id (or null).
 *
 * STEPS (spec/05 §1 step 6; spec/02 C7; the item contract):
 *   1. sessionId = ctx.sessionManager.getSessionId()  — read FRESH each call (C12; GOTCHA #10).
 *   2. seq = nextSeq(sessionId)                        — monotonic per-session counter (runtime.ts; pre-increment → first is 1).
 *   3. Build the entry: { ...data, schema, v:1, kind:"rewind", id: randomUUID(), seq, ts: Date.now() }.
 *   4. pi.appendEntry("mulligan:rewind", entry)        — appends a CustomEntry (NOT in LLM context). Returns void (C7).
 *   5. IMMEDIATELY (same synchronous tick, before any other append — C7/GOTCHA #5): return ctx.sessionManager.getLeafId().
 *
 * NEVER throws: the whole body is wrapped in try/catch → returns null on ANY failure (appendEntry throws,
 * getSessionId/getLeafId throw, or getLeafId returns null). The id+seq+ts stamp BEFORE appendEntry so the persisted
 * marker is always complete even if the leaf capture later fails (we just return null then). Writes through `pi`;
 * reads through `ctx.sessionManager` (C1).
 *
 * @param pi   the Pi ExtensionAPI (appendEntry lives here, not on ctx — spec/02 C1/C9).
 * @param ctx  the Pi ExtensionContext (sessionManager is ReadonlySessionManager — read-only; spec/02 C1).
 * @param data the rewind payload (granularity, options, excludeToolCallId, note, ledger).
 * @returns the new marker's entry id, or null on failure / when the session has no leaf.
 */
export function appendRewindMarker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: RewindMarkerInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: RewindMarker = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "rewind",
      id: randomUUID(),
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:rewind", entry);
    // C7: appendEntry returns void — capture the new leaf id IMMEDIATELY, before any other append.
    return ctx.sessionManager.getLeafId();
  } catch {
    return null; // never throw on the tool/event hot path
  }
}

/**
 * appendShrinkMarker — persist a shrink marker, return its new entry id (or null). Same shape/contract as
 * appendRewindMarker (kind "shrink", customType "mulligan:shrink", id stamped). Consumed by tools/shrink.ts (P1.M5.T2).
 */
export function appendShrinkMarker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: ShrinkMarkerInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: ShrinkMarker = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "shrink",
      id: randomUUID(),
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:shrink", entry);
    return ctx.sessionManager.getLeafId();
  } catch {
    return null;
  }
}

/**
 * appendTurnMetric — persist a turn-metric marker, return its new entry id (or null). kind "turn-metric",
 * customType "mulligan:turn-metric". NOTE (GOTCHA #4): spec/04 §5 TurnMetric has NO `id` field, so this wrapper
 * does NOT stamp one (unlike rewind/shrink). Consumed by the nudges.ts turn_end handler (P1.M6.T2.S1).
 */
export function appendTurnMetric(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: TurnMetricInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: TurnMetric = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "turn-metric",
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:turn-metric", entry);
    return ctx.sessionManager.getLeafId();
  } catch {
    return null;
  }
}

// ── Note details envelope (spec/04-data-model.md §3 — the mulligan:note CustomMessage details) ─────────────

/**
 * NoteDetails — the `details` payload of the mulligan:note CustomMessage (spec/04 §3 end). Correlates the in-context
 * note back to the rewind marker that produced it. EXPORTED so the rewind tool (P1.M5.T1.S1), audit (P1.M5.T4), and
 * tests share ONE shape.
 *
 * NOTE (GOTCHA #5): this is NOT a `MulliganEnvelope` — `kind:"note"` is the message-level discriminator and is
 * intentionally OUTSIDE the marker kind union ("rewind"|"shrink"|"turn-metric"). The note is a CustomMessage
 * (custom_message entry, IN LLM context); markers are CustomEntrys (NOT in context).
 */
export interface NoteDetails {
  schema: "pi-mulligan";
  v: 1;
  kind: "note";
  /** Correlates the note to its rewind marker. The rewind tool passes appendRewindMarker's return value (the marker's
   *  entry id); spec/04 §3 literally names `<marker.id>` (uuid). Both are unique-per-entry, so correlation holds either
   *  way — see the PRP's interface note. */
  rewindId: string;
}

// ── leaveNote: append the rewind note as an in-context CustomMessage (spec/04 §3, spec/05 §1 step6; C8) ─────

/**
 * leaveNote — append the agent's self-authored rewind note as an in-context CustomMessage (spec/04 §3, spec/05 §1
 * step 6; constraint C8). The note IS in LLM context — the resumed model reads it as its most-recent context and uses
 * it to re-attempt the turn better-informed. The control marker (NOT in context) is persisted SEPARATELY by
 * appendRewindMarker BEFORE this call (the rewind tool calls appendRewindMarker first, then leaveNote).
 *
 * CRITICAL (C8 / GOTCHA #2): do NOT pass `options.triggerTurn:true` — leaveNote runs from inside a tool (we are
 * mid-turn); the default mid-turn behavior is correct. The wrapper passes ONLY the message object (no second arg).
 *
 * `display:true` (spec/04 §3) so the note is visible in the UI transcript (/tree). `content` is the rendered note
 * string (notes.renderNote output).
 *
 * Returns void. NEVER throws (markers.ts hot-path discipline, matching appendRewindMarker/appendShrinkMarker/
 * appendTurnMetric): a throwing `sendMessage` is swallowed (GOTCHA #1). This is SAFE because the rewind marker — the
 * authoritative control state — is already persisted by the caller; a failed note only means the resumed model has one
 * fewer hint, never a broken agent turn.
 *
 * @param pi       the Pi ExtensionAPI (sendMessage lives here — C8).
 * @param content  the rendered note string (notes.renderNote output).
 * @param rewindId correlates the note to its marker (rewindId-agnostic; see the PRP interface note).
 */
export function leaveNote(pi: ExtensionAPI, content: string, rewindId: string): void {
  try {
    const details: NoteDetails = { schema: "pi-mulligan", v: 1, kind: "note", rewindId };
    // C8: NO second `options` arg — we are mid-turn; triggerTurn must stay default (false).
    pi.sendMessage({ customType: "mulligan:note", content, display: true, details });
  } catch {
    // never throw on the tool hot path — the rewind marker is already persisted; a failed note is non-fatal (GOTCHA #1)
  }
}

// ── setCheckpoint: label the current leaf as a named checkpoint (spec/04 §6, spec/05 §3; C9, C1) ───────────

/**
 * SetCheckpointResult — the discriminated return of setCheckpoint. Success carries the labeled entry id (the checkpoint
 * tool echoes this to the agent); failure carries a short reason. Narrow with `"entryId" in r` / `"error" in r`.
 * EXPORTED for the checkpoint tool (P1.M5.T3.S1) + tests.
 */
export type SetCheckpointResult = { entryId: string } | { error: string };

/**
 * setCheckpoint — label the current leaf as a named checkpoint (spec/04 §6, spec/05 §3; constraints C9, C1).
 *
 * A checkpoint is a Pi `LabelEntry` (NOT a CustomEntry) — it does NOT participate in LLM context. It is resolved by
 * the context filter (P1.M4.T2, spec/06 §6) ONLY when a later `mulligan_rewind(granularity:"checkpoint",
 * checkpoint:"<name>")` targets it (the filter maps the labeled entry → a position in event.messages). The label uses
 * the `mulligan:checkpoint:` prefix so Mulligan checkpoints are distinct from user/bookmark labels.
 *
 * Writes through `pi.setLabel` (ExtensionAPI — C9/C1/GOTCHA #3: setLabel is on `pi`, NOT on ReadonlySessionManager);
 * reads the target leaf id through `ctx.sessionManager.getLeafId()` (`string | null` — GOTCHA #4: must null-check).
 * Reads `ctx.sessionManager` FRESH each call (C12/GOTCHA #10).
 *
 * Returns `{entryId: leafId}` on success, `{error: "no leaf"}` when `getLeafId()` is null (and does NOT call setLabel),
 * or `{error: <msg>}` on any thrown failure (try/catch). NEVER throws.
 *
 * NOTE (GOTCHA #7): `name` validation (`/^[a-z0-9_-]{1,40}$/`, spec/05 §3 step 1) is the checkpoint TOOL's job, NOT
 * this wrapper's — the wrapper trusts the caller's `name` and only prefixes it.
 *
 * @param pi   the Pi ExtensionAPI (setLabel lives here).
 * @param ctx  the Pi ExtensionContext (sessionManager.getLeafId lives here — read-only, C1).
 * @param name the checkpoint name (ALREADY validated by the caller); the wrapper prefixes it with `mulligan:checkpoint:`.
 */
export function setCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): SetCheckpointResult {
  try {
    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return { error: "no leaf" };
    pi.setLabel(leafId, `mulligan:checkpoint:${name}`);
    return { entryId: leafId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}