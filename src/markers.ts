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
 * - Four wrappers: appendRewindMarker, appendShrinkMarker, appendTurnMetric, appendCancelMarker. Each stamps the
 *   versioned envelope {schema:'pi-mulligan', v:1, kind} + a monotonic per-session seq + ts onto the caller's marker
 *   payload, appends it, and returns the NEW marker's entry id (or null). Rewind + shrink also stamp an `id` (uuid);
 *   turn-metric + cancel do NOT (spec/04 §5/§5½ have no id — GOTCHA #4).
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
  kind: "rewind" | "shrink" | "turn-metric" | "cancel";
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
  /**
   * Stable entry IDs of the messages to hide, pinned at marker-creation time (fix_design.md §Change 1). When present,
   * filterPipeline resolves these IDs → current message indices via resolvePinnedHide and removes them — permanent
   * hiding across session growth (fixes BUG-001/BUG-002; root cause: relative specs re-target onto new work). Absent
   * (old markers, or when capture failed) → filterPipeline falls back to granularity-based relative re-resolution.
   * OPTIONAL for backward compatibility. Holds ENTRY ids (stable), NOT message indices (which shift on compaction).
   * Populated by captureHideEntryIds (P1.M2.T3); read by filterPipeline via readOwn(rw,"hideEntryIds") (P1.M2.T4).
   */
  hideEntryIds?: string[];
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
  /**
   * Stable ENTRY id of the message the target matched at marker-creation time (FINDING 3 fix — pinned shrink).
   * When present, the filter resolves the target by IDENTITY (resolvePinnedShrink) instead of re-resolving the
   * selector live each inference. This locks the substitution to ONE message forever, so `by_tool_name`+`last` /
   * `by_content_includes` no longer drift onto later, unrelated messages as the session grows (the moving-target
   * footgun). Mirrors RewindMarker.hideEntryIds. Absent when the target did not match at creation time (then the
   * filter falls back to live resolution — backward compat / compaction-robust). Holds an ENTRY id (stable), NOT a
   * message index. OPTIONAL.
   */
  pinnedEntryId?: string;
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

// ── Marker: cancel (spec/04-data-model.md §5½) ───────────────────────────────

/**
 * CancelMarker — persisted via pi.appendEntry("mulligan:cancel", data) (spec/04 §5½; G3 / marker retraction,
 * amends D6 "agent rewinds are permanent"). `kind` narrows to "cancel". `targetId` is the uuid `id` field of the
 * rewind/shrink marker being cancelled (RewindMarker.id / ShrinkMarker.id) — NOT the Pi entry id. readMarkers
 * (P3.M1.T2.S1) builds cancelledIds from all cancel targetIds and drops rewinds/shrinks whose data.id ∈ that set
 * BEFORE the filter sees them. NOTE (GOTCHA #4 applied to a second marker type): CancelMarker has NO `id` field
 * (like TurnMetric) — a cancel is not itself cancellable, so appendCancelMarker stamps NO uuid. EXPORTED for the
 * cancel tool (P3.M1.T3.S1) + the filter + audit + tests.
 */
export interface CancelMarker extends MulliganEnvelope {
  kind: "cancel";
  /** The uuid `id` field of the rewind/shrink marker being cancelled (NOT the entry id). readMarkers drops markers
   *  whose data.id ∈ the set of cancel targetIds. */
  targetId: string;
  /** Monotonic per-session counter (runtime.ts nextSeq), shared with rewind/shrink/turn-metric. */
  seq: number;
  /** Date.now() at append. */
  ts: number;
}

/** CancelMarkerInput — caller payload for appendCancelMarker (spec/04 §5½ MINUS envelope + seq + ts; NO id — GOTCHA #4).
 *  Equals exactly { targetId: string }. */
export type CancelMarkerInput = Omit<CancelMarker, "schema" | "v" | "kind" | "seq" | "ts">;

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

/**
 * appendCancelMarker — persist a cancel marker, return its new entry id (or null). kind "cancel", customType
 * "mulligan:cancel". Same shape/contract as appendShrinkMarker EXCEPT (GOTCHA #4 applied to a second marker type):
 * this wrapper does NOT stamp an `id: randomUUID()` line — CancelMarker has no id field (a cancel is not itself
 * cancellable; mirror appendTurnMetric, not appendRewindMarker/appendShrinkMarker). The payload is exactly
 * { targetId } where targetId is the uuid `id` field of the rewind/shrink being cancelled (NOT the entry id).
 *
 * STEPS (spec/02 C7; the item contract):
 *   1. sessionId = ctx.sessionManager.getSessionId()  — read FRESH each call (C12; GOTCHA #10).
 *   2. seq = nextSeq(sessionId)                        — monotonic per-session counter (shared with rewind/shrink/turn-metric).
 *   3. Build the entry: { ...data, schema, v:1, kind:"cancel", seq, ts: Date.now() }.
 *   4. pi.appendEntry("mulligan:cancel", entry)         — appends a CustomEntry (NOT in LLM context). Returns void (C7).
 *   5. IMMEDIATELY (same synchronous tick, before any other append — C7/GOTCHA #5): return ctx.sessionManager.getLeafId().
 *
 * NEVER throws: the whole body is wrapped in try/catch → returns null on ANY failure (appendEntry throws,
 * getSessionId/getLeafId throw, or getLeafId returns null). The wrapper does NOT validate that targetId exists on
 * the branch — that is the mulligan_cancel tool's job (P3.M1.T3.S1); this wrapper is dumb persistence. Writes
 * through `pi`; reads through `ctx.sessionManager` (C1). Consumed by the cancel tool (P3.M1.T3.S1).
 *
 * @param pi   the Pi ExtensionAPI (appendEntry lives here, not on ctx — spec/02 C1/C9).
 * @param ctx  the Pi ExtensionContext (sessionManager is ReadonlySessionManager — read-only; spec/02 C1).
 * @param data the cancel payload ({ targetId } — the uuid id of the rewind/shrink being cancelled).
 * @returns the new marker's entry id, or null on failure / when the session has no leaf.
 */
export function appendCancelMarker(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: CancelMarkerInput,
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: CancelMarker = {
      ...data,
      schema: "pi-mulligan",
      v: 1,
      kind: "cancel",
      seq,
      ts: Date.now(),
    };
    pi.appendEntry("mulligan:cancel", entry);
    // C7: appendEntry returns void — capture the new leaf id IMMEDIATELY, before any other append.
    return ctx.sessionManager.getLeafId();
  } catch {
    return null; // never throw on the tool/event hot path (E13)
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
 * `display:true` (spec/04 §3; spec/05 §1 step 6) is DELIBERATE: it surfaces the note to the OPERATOR as well as
 * the model — the human sees exactly what the model told its resumed self via the rewind note (visible in the UI
 * transcript, /tree). This is the rewind counterpart of shrink's replacement echo (`ctx.ui.notify` in shrink.ts
 * step 5b): every self-directed payload is operator-visible, mirroring the note's in-context role for the resumed
 * model (spec/05 §1 Purpose — "the structured self-authored note is Mulligan's flagship UX"). `content` is the
 * rendered note string (notes.renderNote output).
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
 * setCheckpoint — label the last REAL message entry on the branch as a named checkpoint (spec/04 §6,
 * spec/05 §3; constraints C9, C1; BUG-003 fix).
 *
 * A checkpoint is a Pi `LabelEntry` (NOT a CustomEntry) — it does NOT participate in LLM context. It is resolved by
 * the context filter (P1.M4.T2, spec/06 §6) ONLY when a later `mulligan_rewind(granularity:"checkpoint",
 * checkpoint:"<name>")` targets it (the filter maps the labeled entry → a position in event.messages). The label uses
 * the `mulligan:checkpoint:` prefix so Mulligan checkpoints are distinct from user/bookmark labels.
 *
 * Anchor selection (BUG-003): the wrapper does NOT label `getLeafId()`. It walks
 * `ctx.sessionManager.getBranch()` (ROOT→LEAF) BACKWARDS to the last `message` entry whose `message.role` is a
 * non-empty string — a deterministic, always-context-producing, genuine conversation turn. `getLeafId()` after
 * any Mulligan write is a `custom`/`label`/note entry that `resolveCheckpoint` (spec/06 §6) cannot map (its walk
 * filters to context-producing types and refuses), which made checkpoint rewinds silently no-op. A transient
 * no-role message is also skipped by the role guard.
 *
 * Writes through `pi.setLabel` (ExtensionAPI — C9/C1/GOTCHA #3: setLabel is on `pi`, NOT on ReadonlySessionManager);
 * reads the branch through `ctx.sessionManager.getBranch()` (ROOT→LEAF `SessionEntry[]` — read-only, C1).
 * Reads `ctx.sessionManager` FRESH each call (C12/GOTCHA #10).
 *
 * Returns `{entryId: stableId}` (the labeled message entry id) on success; `{error: "no conversation message to checkpoint"}`
 * when the branch has no `message` entry with a real role (the agent called mulligan_checkpoint before any real
 * user→assistant exchange — there is nothing stable to anchor; the agent should emit a message first and retry) and
 * does NOT call setLabel; or `{error: <msg>}` on any thrown failure (try/catch — e.g. a throwing getBranch). NEVER throws.
 *
 * NOTE (GOTCHA #7): `name` validation (`/^[a-z0-9_-]{1,40}$/`, spec/05 §3 step 1) is the checkpoint TOOL's job, NOT
 * this wrapper's — the wrapper trusts the caller's `name` and only prefixes it.
 *
 * @param pi   the Pi ExtensionAPI (setLabel lives here).
 * @param ctx  the Pi ExtensionContext (sessionManager.getBranch lives here — read-only, C1).
 * @param name the checkpoint name (ALREADY validated by the caller); the wrapper prefixes it with `mulligan:checkpoint:`.
 */
export function setCheckpoint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  name: string,
): SetCheckpointResult {
  try {
    // BUG-003 fix: label the last REAL message entry, NOT the raw getLeafId() leaf.
    // After any Mulligan write the leaf is a non-context-producing entry (a `custom` marker / `label` /
    // note `custom_message`) that resolveCheckpoint CANNOT map (its walk filters to context-producing types
    // and refuses — "targetId labels a non-context-producing entry → null"). A transient no-role message is
    // also not a genuine turn. Walking getBranch() (ROOT→LEAF) BACKWARDS to the last `message` entry with a
    // real role guarantees a deterministic, always-mappable checkpoint anchor.
    const branch = ctx.sessionManager.getBranch();
    let stableId: string | null = null;
    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i];
      if (
        e.type === "message" &&
        e.message &&
        typeof e.message.role === "string" &&
        e.message.role.length > 0
      ) {
        stableId = e.id;
        break;
      }
    }
    if (!stableId) {
      // No real conversation message on the branch yet (the agent called mulligan_checkpoint as its very first
      // action, before any user→assistant exchange). There is nothing stable to anchor: the only entries present
      // are the session header / non-context-producing Mulligan writes, none of which resolveCheckpoint can map.
      // Tell the agent WHY (no prior conversation) and WHAT TO DO (emit a message first, then retry) so it can
      // recover instead of looping on the refusal. We deliberately do NOT fall back to labeling the raw leaf —
      // that would create an unmappable checkpoint and just defer the failure to rewind time (BUG-003).
      return { error: "no conversation message to checkpoint (emit a message first, then retry)" };
    }
    pi.setLabel(stableId, `mulligan:checkpoint:${name}`);
    return { entryId: stableId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}