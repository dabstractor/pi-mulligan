/**
 * cancel.ts — the `mulligan_cancel` agent-callable tool (spec/05 §5; spec/04 §5½; spec/08 E21).
 *
 * FIFTH of the five Mulligan agent-callable tools (P3.M1.T3.S1). It is the agent-facing half of marker
 * retraction (G3 / E21): it appends a `mulligan:cancel` marker that retires a prior `mulligan:rewind` or
 * `mulligan:shrink` marker so the transform no longer applies going forward (amends D6 "agent rewinds are
 * permanent" — a mistaken marker is now retractable). The runtime half (readMarkers dropping cancelled
 * markers by their uuid `data.id`) is P3.M1.T2.S1; the data-model half (CancelMarker + appendCancelMarker)
 * is P3.M1.T1.S1 — BOTH already landed. This tool is pure glue between them.
 *
 * DESIGN (read the gotchas + the PRP):
 * - Thin, typebox-schema'd, fail-open adapter. STRICTLY SIMPLER than shrink: no best-effort match, no
 *   sessionEntryToContextMessages, no resolveShrinkTarget, no note/ledger. It scans getEntries(), maps the
 *   ENTRY id the agent passed (markerId) → the marker's uuid `data.id`, checks the marker is not already
 *   cancelled, and delegates persistence to appendCancelMarker. readMarkers drops the retired marker on the
 *   NEXT context fire.
 * - CRITICAL GOTCHA #1 (the markerId→targetId indirection is the WHOLE point): the agent passes markerId =
 *   the ENTRY id it received as details.markerId from an earlier rewind/shrink (= getLeafId()). But readMarkers
 *   drops by the marker's uuid `data.id` ∈ cancelledIds. So the cancel's targetId MUST be data.id (uuid),
 *   NOT the entry id. The tool MAPS: scan getEntries for entry.id===markerId (customType rewind/shrink) →
 *   read entry.data.id (uuid) → that uuid is targetId. A bug that forwards the entry id makes the cancel a
 *   permanent no-op (readMarkers matches by data.id, never entry id). PROVEN by the tests (distinct fixtures).
 * - CRITICAL GOTCHA #2 (readOwn/isRecord are MODULE-PRIVATE in filter.ts — out of scope to import): this file
 *   defines LOCAL verbatim clones of isRecord/readOwn (~8 lines each, identical to filter.ts's). Defense-in-
 *   depth: a Proxy get-trap may throw → readOwn swallows → undefined → safe skip/no-op. Read entry.id,
 *   customType, data, data.id, data.targetId, data.kind ALL through readOwn — never use the bare property.
 * - CRITICAL GOTCHA #3 (details on EVERY return path): Pi's AgentToolResult<CancelDetails> REQUIRES a
 *   `details` field (strict tsconfig). refusal() returns details:{}; no-ops return details:{cancelled:false};
 *   success returns details:{cancelled:true, markerId}.
 * - CRITICAL GOTCHA #4 (never throws): the WHOLE execute body is wrapped in ONE try/catch →
 *   refusal("unexpected error: <msg>") (E13). This covers a throwing getEntries AND (belt-and-suspenders)
 *   appendCancelMarker, which already never throws internally (returns null).
 * - GOTCHA #5 (FRESH read — C12): read ctx.sessionManager.getEntries() FRESH each invocation; do NOT cache
 *   the sessionManager handle or the entries array across calls (markers.ts wrappers do the same for
 *   getSessionId/getLeafId).
 * - GOTCHA #6 (no config.cancel sub-knob): the gate is the MASTER getConfig().enabled ONLY (retraction is a
 *   safety/escape hatch — always on when mulligan is on). rewind/shrink have sub-feature gates; cancel
 *   intentionally has none. Do NOT add a config.cancel field.
 * - GOTCHA #7 (idempotency): the already-cancelled check re-scans ALL entries for customType==="mulligan:cancel"
 *   && data.targetId===uuid, PREVENTING duplicate cancel entries for the same marker.
 * - GOTCHA #8 (.js ESM import paths): `../markers.js`, `../config.js` (ESM/Bundler resolution; every src file
 *   does this).
 * - Shared tool convention (spec/05 "Shared tool conventions"): the execute body is fail-open to text — it
 *   NEVER throws (E13). `pi` (ExtensionAPI) is captured via the makeCancelTool(pi) factory closure (it is
 *   NOT an execute argument — checkpoint.ts / shrink.ts precedent). toolCallId (the FIRST execute arg) is
 *   UNUSED → named `_toolCallId`.
 *
 * This item does NOT modify markers.ts / filter.ts (already landed, read-only contracts), config.ts (master
 * gate only), or transforms.ts / nudges.ts / runtime.ts.
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import {
  defineTool,
  sessionEntryToContextMessages, // NEW (S2) — SessionEntry → AgentMessage[] for the target-path snapshot
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { appendCancelMarker } from "../markers.js"; // GOTCHA #8: .js extension (ESM/Bundler resolution)
import type { CancelMarkerInput } from "../markers.js";
import { resolveShrinkTarget } from "../transforms.js"; // NEW (S2) — pure resolver (Pi-free; 0 imports → no circular dep)
import type { ShrinkTarget } from "../transforms.js"; // NEW (S2) — ≡ markers.ts ShrinkTarget ≡ CancelParams.target
import type { MessageLike } from "../transforms.js"; // NEW (S2) — Pi-free structural message type
import { getConfig } from "../config.js"; // GOTCHA: read getConfig() ONCE per execute

// ── Parameter schema (spec/05 §5 — Typebox, VERBATIM incl. the markerId description) ──────────────────

/**
 * CancelParams — the typebox parameter schema for `mulligan_cancel` (spec/05 §5, verbatim incl. every field
 * description — the LLM reads them). The agent identifies the marker to retract via `target` (the SAME
 * hint shape `mulligan_shrink` uses — resolved live each turn, robust to compaction) OR via an explicit
 * `markerId` fallback (the ENTRY id received as `details.markerId` from an earlier rewind/shrink; the tool
 * maps that entry id → the marker's uuid `data.id`, CRITICAL GOTCHA #1).
 *
 * DECISION D1 — BOTH `target` and `markerId` are `Type.Optional`. The spec's literal schema shows `target`
 * unwrapped (→ structurally required), but its own prose says "At least one MUST be present" and acceptance-(a)
 * (E21) says cancel works "by target OR by explicit markerId". A required `target` would make `markerId`-ALONE
 * schema-invalid, and Pi's tool runtime rejects schema-invalid calls BEFORE execute runs — silently breaking
 * the documented fallback. The behavioral prose is authoritative, so both params are Optional here and "at
 * least one MUST be present" is enforced in `cancelExecute` (S2 / P1.M1.T1.S2). Side benefit: every existing
 * `{markerId:'…'}` test continues to typecheck and pass unchanged. EXPORTED for tests + index.ts wiring.
 *
 * The `target` union is STRUCTURALLY IDENTICAL to `ShrinkParams.target` (src/tools/shrink.ts) — same 3 arms,
 * same discriminators (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), same literal
 * set for `occurrence`. ONLY the description strings differ. This parity is a HARD requirement: S2 hands
 * `params.target` to `resolveShrinkTarget(messages, target)` (transforms.ts:758, `ShrinkTarget`-typed), so a
 * divergent union would break that handoff's typecheck.
 */
export const CancelParams = Type.Object(
  {
    target: Type.Optional(
      Type.Union(
        [
          Type.Object({
            by_tool_call_id: Type.String({ description: "The toolCallId of a message the marker affected." }),
          }),
          Type.Object({
            by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
            occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
          }),
          Type.Object({
            by_content_includes: Type.String({
              description: "Match a marker whose affected message(s) include this substring.",
            }),
          }),
        ],
        {
          description:
            "How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired.",
        },
      ),
    ),
    markerId: Type.Optional(
      Type.String({
        description:
          "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins.",
      }),
    ),
  },
  {
    description:
      "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present.",
  },
);

/** CancelArgs — the inferred execute-time params type (`{ target?: <union>; markerId?: string }`). EXPORTED for ergonomics/tests. */
export type CancelArgs = Static<typeof CancelParams>;

// ── The LLM-facing description string (spec/05 §6 — copy VERBATIM) ────────────

/**
 * CANCEL_DESC — the LLM-facing description (spec/05 §6 "Description strings", Mode A LLM-facing docs). This
 * string IS the tool's documentation. Copy verbatim — it drives LLM usage. Cost/benefit framing mirrors the
 * other four tools.
 */
export const CANCEL_DESC =
  "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
  "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
  "transform would apply on every turn for the rest of the session. Identify the marker by `target` " +
  "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — " +
  "the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. " +
  "The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). " +
  "Cancelling a non-existent or already-cancelled marker is a safe no-op.";

// ── Result builders (always include `details` — CRITICAL GOTCHA #3) ──────────

/** CancelDetails — the structured `details` payload surfaced to logs/audit/UI. Present on every path. */
export interface CancelDetails {
  /** true when a mulligan:cancel marker was appended; false on no-op paths. Omitted on refusal (details:{}). */
  cancelled?: boolean;
  /** The new cancel marker's ENTRY id (appendCancelMarker's return; null when append threw / no leaf).
   *  Success path only (omitted on no-op/refusal). */
  markerId?: string | null;
}

/**
 * refusal — build a fail-open text result for a config-disabled / unexpected-error case. ALWAYS includes
 * `details` (CRITICAL GOTCHA #3). The shared convention prefixes every refusal with "Mulligan: refused —
 * <reason>." so the agent can pattern-match a refusal regardless of the underlying reason (spec/08 E14
 * framing; checkpoint.ts + rewind.ts + shrink.ts precedent). `reason` is emitted WITHOUT a trailing period —
 * the helper adds it.
 */
function refusal(reason: string): AgentToolResult<CancelDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }],
    details: {},
  };
}

// ── defensive read helpers (LOCAL clones of filter.ts's private isRecord/readOwn — CRITICAL GOTCHA #2) ──

/**
 * isRecord — true for plain records (and Object.create(null)); false for null, primitives, and arrays. Verbatim
 * clone of filter.ts's module-private helper (filter.ts is out of scope to import from; defense-in-depth).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * readOwn — read an own property without throwing (a Proxy get-trap may throw); undefined if absent/unreadable.
 * Verbatim clone of filter.ts's module-private helper. Every entry/data field read in this tool goes through
 * readOwn so a malformed/Proxy-guarded entry degrades to a safe skip/no-op (E13).
 */
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

// ── target-path helpers (S2 / P1.M1.T1.S2 — cancel-by-target resolution) ────

/**
 * entryIdAtMessageIndex — map a resolved MESSAGE index back to the ENTRY id of the snapshot entry that produced
 * it (verbatim clone of shrink.ts's module-private helper — it is NOT exported there, so this file keeps its own
 * copy; D4). Cursor-walks `entries` using the SAME `entries.flatMap(sessionEntryToContextMessages)` mapping that
 * built `messages`, so entry `e` ↔ messages[cursor..cursor+yield) is EXACT BY CONSTRUCTION (no position math).
 * Used by the cancel target path to check rewind hideEntryIds membership — those hold ENTRY ids, NOT message
 * indices (GOTCHA #4), so the matched message index MUST be mapped to its entry id first.
 *
 * Defensive: non-array `entries` / non-finite/negative `index` → null; a throwing sessionEntryToContextMessages
 * → null (alignment indeterminate → safe no-cover). The entry id is read via the LOCAL readOwn (more defensive
 * than shrink.ts's cast; both correct). Returns null on no-match or a non-string/empty id.
 */
function entryIdAtMessageIndex(entries: SessionEntry[], index: number): string | null {
  if (!Array.isArray(entries) || typeof index !== "number" || !Number.isFinite(index) || index < 0) return null;
  let cursor = 0;
  for (const e of entries) {
    let y: number;
    try {
      y = sessionEntryToContextMessages(e).length; // typically 1 (message/custom_message/branch_summary)
    } catch {
      return null; // a throwing mapping → alignment indeterminate → null (safe no-cover, E13)
    }
    if (index < cursor + y) {
      const id = readOwn(e, "id");
      return typeof id === "string" && id.length > 0 ? id : null;
    }
    cursor += y;
  }
  return null;
}

/**
 * resolveTargetUuid — the TARGET path of step 3 (spec/05 §5 step 3 — target-preferred, markerId-wins-when-both).
 * Resolves `target` against the compaction-aware message snapshot → the matched message index → the MOST RECENT
 * active rewind/shrink whose effect COVERS that message (LIFO by seq) → that marker's uuid `data.id`. Returns null
 * when `target` matches nothing OR no active marker covers it (→ step 4 no-op). Mirrors shrink.ts's
 * resolveTargetEntryId snapshot build (INLINED here — NOT a shared cross-file helper; D4) + the
 * entryIdAtMessageIndex cursor-walk.
 *
 * COVERING RULES (spec/05 §5 step 3 — the covering ternary IS the entire rule):
 *  - SHRINK covers index i: resolving the shrink's OWN `data.target` against the SAME snapshot yields i (LIVE
 *    resolution — compaction-robust; NOT `pinnedEntryId`, which is the filter's identity-lock — GOTCHA #5, D3).
 *  - REWIND covers index i: the matched message's entry id (entryIdAtMessageIndex) is a member of the rewind's
 *    `data.hideEntryIds` (GOTCHA #4 — hideEntryIds hold ENTRY ids, NOT message indices; a rewind with no/absent
 *    hideEntryIds covers nothing → skip).
 *  - LIFO: among covering markers, the one with the HIGHEST `data.seq` wins (latest-issued = likely mistake;
 *    GOTCHA #6). Non-finite/non-number seq coerces to 0 (a real marker is always stamped, so 0 only affects a
 *    malformed marker — it loses to any well-formed one).
 *  - Malformed markers (no/empty uuid, unreadable target/hideEntryIds/seq) are SKIPPED — never throws (the whole
 *    body is wrapped in try/catch → null; the outer cancelExecute try/catch also covers it, E13).
 *
 * `entries` is the step-2 getEntries() result (markers live there, passed in — do NOT re-read getEntries here;
 * C12 is satisfied once per execute). `snapshotEntries` is a SEPARATE fresh buildContextEntries() read — the
 * message snapshot + the index→entry mapping MUST come from the SAME surface, so entryIdAtMessageIndex gets
 * snapshotEntries (NOT entries) for exact alignment (GOTCHA #3).
 */
function resolveTargetUuid(
  ctx: ExtensionContext,
  entries: SessionEntry[],
  target: ShrinkTarget,
): string | null {
  try {
    // (i) build the message snapshot (mirror shrink.ts:resolveTargetEntryId — INLINED, not a shared helper).
    const snapshotEntries = ctx.sessionManager.buildContextEntries();
    // sessionEntryToContextMessages returns Pi's AgentMessage[]; transforms.ts MessageLike is a Pi-free structural
    // type → the `as unknown as MessageLike[]` double-cast is REQUIRED (GOTCHA #10 — same idiom shrink.ts:220 uses).
    const messages = snapshotEntries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
    // (ii) resolve params.target → matched message index (the SAME pure resolver shrink uses; never throws).
    const matchedIndex = resolveShrinkTarget(messages, target);
    if (matchedIndex === null) return null; // target matched nothing → no covering marker
    // (iii) map the matched message index → its entry id (for the rewind hideEntryIds membership check — GOTCHA #4).
    const matchedEntryId = entryIdAtMessageIndex(snapshotEntries, matchedIndex);
    // (iv) collect covering markers (active rewind/shrink) + pick the most recent by seq (LIFO).
    let bestUuid: string | null = null;
    let bestSeq = -Infinity;
    for (const e of entries) {
      const ct = readOwn(e, "customType");
      if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue; // excludes notes/turn-metric/cancel
      const data = readOwn(e, "data");
      const uuid = readOwn(data, "id");
      if (typeof uuid !== "string" || uuid.length === 0) continue; // malformed marker → skip
      let covers = false;
      if (ct === "mulligan:shrink") {
        const shrinkTarget = readOwn(data, "target");
        // unknown → ShrinkTarget assertion is allowed; resolveShrinkTarget re-validates isRecord(target) → null.
        const resolved = resolveShrinkTarget(messages, shrinkTarget as ShrinkTarget);
        covers = resolved === matchedIndex; // SHRINK: own target resolves to the matched index (live, not pinned)
      } else {
        const hideEntryIds = readOwn(data, "hideEntryIds");
        // REWIND: matched msg's entry id ∈ hidden span (a rewind with no/absent hideEntryIds covers nothing).
        if (matchedEntryId !== null && Array.isArray(hideEntryIds)) {
          covers = hideEntryIds.includes(matchedEntryId);
        }
      }
      if (!covers) continue;
      const seq = readOwn(data, "seq");
      const seqNum = typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
      if (seqNum > bestSeq) {
        bestSeq = seqNum;
        bestUuid = uuid;
      }
    }
    return bestUuid;
  } catch {
    return null; // throwing buildContextEntries/sessionEntryToContextMessages/resolveShrinkTarget → null (E13)
  }
}

// ── execute (spec/05 §5 behavior; shared tool convention = never throws) ─────

/**
 * cancelExecute — the tool body. Steps (the work-item contract steps 1–8):
 *   1. config gate (step 1; E14): getConfig() once; master `enabled`? false → refuse "Mulligan is disabled".
 *      NO config.cancel sub-knob (GOTCHA #6 — retraction is a safety hatch, always on when mulligan is on).
 *   2. read getEntries() FRESH (step 2; C12): try/catch → [] on throw (defense-in-depth; the outer try/catch
 *      also covers this, but an explicit fallback keeps the scan deterministic on a throwing getEntries).
 *   3. resolve the marker to retire (step 3; target-preferred, markerId-wins-when-both — Decision D1): if
 *      `params.markerId` is a non-empty string, scan entries for entry.id===markerId ∧ customType∈
 *      {rewind,shrink} → read data.id (uuid) [MARKERID PATH, verbatim — the only path the existing tests use].
 *      ELSE if `params.target`, build the message snapshot (buildContextEntries().flatMap(
 *      sessionEntryToContextMessages)), resolveShrinkTarget → matched index, then pick the MOST RECENT active
 *      rewind/shrink whose effect COVERS that message (shrink: its own data.target resolves to the index;
 *      rewind: the index's entry id ∈ data.hideEntryIds; LIFO by seq) → read data.id (uuid) [TARGET PATH,
 *      resolveTargetUuid]. ELSE (neither) targetUuid stays null → step 4 no-op (fail-open; Decision D2 — no new
 *      refusal path). A non-string/empty/malformed uuid → not found (step 4). Either path yields targetUuid
 *      (the marker's uuid data.id) or null; both feed the UNCHANGED steps 4-7.
 *   4. not-found no-op (step 4): return the "no active marker found" no-op text + details:{cancelled:false};
 *      appendCancelMarker NOT called.
 *   5. already-cancelled check (step 5; GOTCHA #7 idempotency): re-scan ALL entries for customType===
 *      "mulligan:cancel" && data.targetId===uuid → return the "already cancelled" no-op text +
 *      details:{cancelled:false}; appendCancelMarker NOT called.
 *   6. persist (step 6; GOTCHA #1 — pass the uuid as targetId, NOT the entry id): appendCancelMarker(pi, ctx,
 *      {targetId: uuid}) → markerId (the cancel marker's ENTRY id, or null). Never throws (try/catch→null).
 *   7. return (step 7): confirmation text + details:{cancelled:true, markerId}.
 *
 * The WHOLE body is wrapped in ONE try/catch → refusal text on ANY exception (CRITICAL GOTCHA #4 — never
 * throw on the tool hot path, E13). `pi` is captured by the makeCancelTool(pi) factory closure (NOT an execute
 * argument — checkpoint.ts / shrink.ts precedent). `toolCallId` (the FIRST execute arg) is UNUSED → named
 * `_toolCallId` (shrink does the same).
 */
async function cancelExecute(
  pi: ExtensionAPI,
  _toolCallId: string,
  params: CancelArgs,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<CancelDetails>> {
  try {
    // (1) config gate (spec/05 §5 step 1; E14). Master switch ONLY — NO config.cancel sub-knob (GOTCHA #6).
    //     The master `enabled:false` makes the WHOLE extension a no-op (tools refuse "Mulligan is disabled").
    if (!getConfig().enabled) return refusal("Mulligan is disabled"); // E14 master switch

    // (2) read getEntries() FRESH (spec/05 §5 step 2; C12 — GOTCHA #5). Defense-in-depth: a throwing
    //     getEntries → [] so the scan is deterministic (the outer catch would also catch it, but the explicit
    //     fallback yields a no-op rather than a refusal, which is the friendlier behavior for a transient blip).
    let entries: SessionEntry[];
    try {
      entries = ctx.sessionManager.getEntries();
    } catch {
      entries = [];
    }

    // (3) resolve the marker to retire (spec/05 §5 step 3 — target-preferred, markerId-wins-when-both; Decision D1).
    //     markerId path: when markerId is present + non-empty, it is AUTHORITATIVE ("markerId wins if both given";
    //     also the sole path for markerId-only calls). target path: resolve target → matched message → covering
    //     marker (shrink|rewind, LIFO by seq) → uuid. Either yields targetUuid (the marker's data.id uuid) or null;
    //     both feed the UNCHANGED steps 4-7.
    let targetUuid: string | null = null;
    if (typeof params.markerId === "string" && params.markerId.length > 0) {
      // (3a) MARKERID PATH (verbatim current logic — preserved byte-for-byte so existing tests pass unchanged;
      //     GOTCHA #2). The agent passed the ENTRY id; we MAP it to the marker's uuid `data.id` (what readMarkers
      //     drops by — cancelledIds holds uuids, never entry ids; CRITICAL GOTCHA #1).
      for (const e of entries) {
        if (readOwn(e, "id") !== params.markerId) continue;
        const ct = readOwn(e, "customType");
        if (ct !== "mulligan:rewind" && ct !== "mulligan:shrink") continue;
        const data = readOwn(e, "data");
        const uuid = readOwn(data, "id");
        if (typeof uuid === "string" && uuid.length > 0) {
          targetUuid = uuid; // the uuid `data.id` of the rewind/shrink being cancelled
          break;
        }
      }
    } else if (params.target) {
      // (3b) TARGET PATH — resolve target → covering marker → uuid (resolveTargetUuid never throws → null on
      //     no-match; step 2's getEntries() `entries` is passed in — buildContextEntries() is read fresh inside).
      targetUuid = resolveTargetUuid(ctx, entries, params.target);
    }
    // else: neither markerId nor target → targetUuid stays null → step 4 no-op (Decision D2 — no new refusal).

    // (4) not-found no-op (spec/05 §5 step 4; E21 (d) — safe no-op, never throws). appendCancelMarker NOT called.
    //     BUG-006: emit path-specific text. markerId path keeps "with that id"; target/neither path uses
    //     the spec/05 §5 verbatim "for that target" text (Decision D1 — markerId wins when both are given).
    const usedMarkerId = typeof params.markerId === "string" && params.markerId.length > 0;
    if (targetUuid === null) {
      return {
        content: [
          {
            type: "text",
            text: usedMarkerId
              ? "Mulligan: no active marker found with that id — nothing to cancel."
              : "Mulligan: no active marker found for that target — nothing to cancel.",
          },
        ],
        details: { cancelled: false },
      };
    }

    // (5) already-cancelled check (spec/05 §5 step 5 — GOTCHA #7 idempotency). Re-scan ALL entries for an
    //     existing cancel whose data.targetId === this marker's uuid. PREVENTS duplicate cancel entries.
    //     A cancel could appear anywhere in the list → full scan (cheap; sessions are bounded).
    for (const e of entries) {
      if (readOwn(e, "customType") !== "mulligan:cancel") continue;
      if (readOwn(readOwn(e, "data"), "targetId") === targetUuid) {
        return {
          content: [{ type: "text", text: "Mulligan: that marker is already cancelled." }],
          details: { cancelled: false },
        };
      }
    }

    // (6) persist (spec/05 §5 step 6 — GOTCHA #1: pass the uuid as targetId, NOT the entry id). appendCancelMarker
    //     stamps envelope {schema,v,kind:"cancel"} + seq + ts, calls pi.appendEntry("mulligan:cancel", entry), and
    //     returns ctx.sessionManager.getLeafId() (the cancel marker's ENTRY id) — or null (it never throws).
    const markerId = appendCancelMarker(pi, ctx, { targetId: targetUuid } satisfies CancelMarkerInput);

    // (7) return (spec/05 §5 step 7) — confirmation text + details. cancelled stays true even if markerId is
    //     null (append threw / no leaf): the intent was recorded best-effort (mirrors how rewind/shrink report
    //     markerId:null on a failed leaf capture).
    return {
      content: [
        {
          type: "text",
          text: "Mulligan: marker cancelled. The transform will no longer apply from the next turn on.",
        },
      ],
      details: { cancelled: true, markerId },
    };
  } catch (e) {
    // Shared tool convention: never throw — return a text result describing the failure (CRITICAL GOTCHA #4, E13).
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Factory: the testable `pi`-injection seam (recommended in the PRP) ───────

/**
 * makeCancelTool — the tool factory. Captures `pi` (ExtensionAPI) via closure so `cancelExecute` can call
 * `appendCancelMarker(pi, ctx, …)` WITHOUT `pi` being an execute argument (the Pi ExtensionAPI is passed to
 * the extension FACTORY in src/index.ts, not to each tool's execute()). `defineTool` preserves `CancelParams`
 * inference when assigning to the typed return (checkpoint.ts / shrink.ts precedent).
 *
 * index.ts (P3.M1.T3.S1) does: `pi.registerTool(makeCancelTool(pi));`.
 * Unit tests do: `const tool = makeCancelTool(fakePi);`.
 */
export function makeCancelTool(pi: ExtensionAPI): ToolDefinition<typeof CancelParams, CancelDetails> {
  return defineTool({
    name: "mulligan_cancel",
    label: "Mulligan Cancel",
    description: CANCEL_DESC, // spec/05 §5 VERBATIM
    parameters: CancelParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return cancelExecute(pi, toolCallId, params, signal, onUpdate, ctx); // pi captured via closure
    },
  });
}