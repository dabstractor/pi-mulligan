/**
 * transforms.ts — Mulligan's PURE context-filter transforms (the correctness heart).
 * spec/06-context-filter.md §2 (partitionIntoUnits — the cardinal pairing rule), spec/04-data-model.md,
 *   spec/08-edge-cases.md E1 (orphan toolResult → own plain unit), spec/10-testing.md §1.1 (partitionIntoUnits
 *   tier-1 tests), api_verification.md §6.4 (tool-pairing invariant: the model API rejects an orphaned
 *   toolCall/toolResult), spec/01-pi-context-internals.md §5 (the context event + the invariant), spec/03 §2.3/§7
 *   + spec/11 §1/§2 (transforms.ts = PURE, unit-tested without Pi; Step 3 "the most important step").
 *
 * DESIGN (read GOTCHA #1–#13 in the PRP):
 * - Foundation-tier and Pi-FREE. Imports NOTHING — not Pi, not config, not log, not runtime, NOT tokens.ts/ledger.ts.
 *   It is a pure, deterministic, side-effect-free function fully unit-testable in isolation (sibling of tokens.ts +
 *   ledger.ts per spec/11 §1). It defines its OWN local structural types (mirror tokens.ts/ledger.ts) and its OWN
 *   module-private isRecord/readOwn (each pure module keeps its own copy — the established convention).
 * - partitionIntoUnits is THE pairing primitive. Every removal transform (resolveLastToolCallGroup,
 *   resolveLastTurn, applyRewind, applyShrink, filterPipeline — sibling functions added by later P1.M3 subtasks)
 *   operates on UNITS, never raw indices, so pairing is preserved by construction (spec/06 §2: "All removal
 *   operations in Mulligan operate on units, never raw indices. This guarantees pairing by construction."). A unit
 *   is either a single non-tool message (plain) or an assistant message containing toolCalls grouped WITH every
 *   toolResult whose toolCallId matches (toolGroup). Hiding a toolGroup hides the call AND all its results together
 *   → the model API never sees an orphan (api_verification.md §6.4).
 * - NEVER throws (it sits on the context-handler hot path via filterPipeline; E13 fail-open discipline).
 *   isRecord/readOwn swallow Proxy-trap throws; null/non-array messages, malformed blocks, missing/non-string ids,
 *   orphan results, and assistant-with-no-results-yet are all handled defensively (GOTCHA #4–#9).
 *
 * NOTE: later P1.M3 subtasks (T2 resolveLastToolCallGroup/resolveLastTurn, T3 resolveCheckpoint, T4 applyRewind/
 *   applyShrink, T5 filterPipeline) APPEND to this file and REUSE the exported Unit/MessageLike + the module-private
 *   isRecord/readOwn (hoisted here — mirrors how tokens.ts/notes.ts siblings reuse their S1 helpers). This S1 ships
 *   ONLY partitionIntoUnits + Unit + MessageLike + isRecord/readOwn.
 */

// ── local structural types (mirror tokens.ts/ledger.ts; api_verification.md §6.1/§6.2) ────

/** A tool-call content block (assistant only) — partitionIntoUnits reads `.id` to pair call↔result. */
interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Any content block (we only ever inspect toolCall blocks; text/thinking/image are ignored). */
type ContentBlock = ToolCallContent | { type: string; [key: string]: unknown };

/**
 * Minimal structural message shape for partitioning. Any Pi AgentMessage variant (user / assistant / toolResult /
 * custom / bashExecution / branchSummary / compactionSummary) satisfies this. partitionIntoUnits inspects ONLY:
 *   - `role` (to tell assistant/toolResult apart from plain messages),
 *   - assistant `content[]` for toolCall blocks (reading each `.id`),
 *   - toolResult `toolCallId` (via the index signature, read via readOwn).
 * A real Pi AgentMessage[] assigns in with NO cast (structural typing — api_verification.md §6.1/§6.3). EXPORTED so
 * tests + the later sibling resolve* / apply* functions + filter.ts (P1.M4) share one input type.
 */
export interface MessageLike {
  role?: string;
  content?: string | ContentBlock[];
  [key: string]: unknown;
}

/**
 * Unit — a pairing-safe message group (spec/06-context-filter.md §2 canonical shape). A unit is EITHER:
 *   - kind:"plain"     — a single non-tool message (user, text-only assistant, custom, OR an orphan toolResult whose
 *                        toolCallId matches no assistant — spec/08 E1). `indices` ALWAYS has length 1.
 *   - kind:"toolGroup" — an assistant message that issued ≥1 toolCall, grouped WITH every toolResult whose
 *                        toolCallId maps to that assistant. `indices` = [assistant, ...results], sorted ascending.
 *                        (An assistant whose results have not arrived yet — mid-turn — is a toolGroup of just the
 *                        assistant: spec/06 §2 corner case.)
 * `indices` is sorted ascending; units are ordered by `indices[0]` (their minimum index). EXPORTED — it is the
 * return type of partitionIntoUnits AND the input type of every removal transform (resolveLastToolCallGroup,
 * applyRewind, … — sibling functions added by later P1.M3 subtasks).
 */
export interface Unit {
  /** Sorted ascending message indices this unit spans. plain → always exactly [i]; toolGroup → [assistant, ...results]. */
  indices: number[];
  kind: "plain" | "toolGroup";
}

/**
 * partitionIntoUnits — group a message list into pairing-safe units (spec/06 §2; the cardinal rule).
 *
 * ALGORITHM (spec/06 §2, steps a–e):
 *   (a) Walk `messages`; build `toolCallId → assistantIndex` from every assistant message's toolCall blocks (only
 *       blocks whose `.id` is a non-empty string are pairable — GOTCHA #4).
 *   (b)+(c) Group ALL result indices by their paired assistant: for every toolResult whose `.toolCallId` is a
 *       non-empty string AND is in the assistant map, push its index into that assistant's bucket. (Implemented as a
 *       join of callToResult × callToAssistant; uses number[] per assistant so duplicate callIds are orphan-safe —
 *       GOTCHA #9.) A result whose callId matches NO assistant is SKIPPED here → it falls through to a plain unit
 *       in (d) (orphan — spec/08 E1, GOTCHA #6).
 *   For each DISTINCT assistant that issued ≥1 pairable call (deduped via an `assigned` set — GOTCHA #5), form a
 *   toolGroup = {indices: sorted([assistantIndex, ...results]), kind:"toolGroup"}. An assistant with calls but no
 *   results yet → a toolGroup of just the assistant (spec/06 §2 corner case — GOTCHA #7).
 *   (d) Every index NOT in a toolGroup → a plain unit {indices:[i]}. This is where orphan toolResults, user
 *       messages, text-only assistants, and custom messages land.
 *   (e) Units are ordered by their minimum index (indices[0]).
 *
 * WHY (api_verification.md §6.4): the model API rejects a request containing a toolCall without its matching
 * toolResult, or vice versa. Because every removal transform operates on UNITS (never raw indices — spec/06 §2),
 * hiding a toolGroup hides the assistant call AND all its results together, so the filtered view never orphans
 * either side. This function is the correctness foundation for ALL of P1.M3.
 *
 * Pure + defensive: null/undefined/non-array `messages` → []; malformed messages/blocks, missing/non-string/empty
 * ids, duplicate toolCallIds, results appearing before their assistant, and throwing-Proxy messages are all handled
 * gracefully — NEVER throws (E13; context-handler hot path). Duplicate toolCallId across two assistant calls, or
 * two results for one callId: deterministic + orphan-safe (GOTCHA #9); such inputs should not occur in a well-formed
 * Pi context, but the function stays total regardless.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); null/undefined/non-array → []
 * @returns ordered Unit[] (plain + toolGroup), each with ascending indices; [] for empty/null input
 */
export function partitionIntoUnits(messages: MessageLike[] | null | undefined): Unit[] {
  const list = Array.isArray(messages) ? messages : [];

  // (a) toolCallId → assistantIndex, from every assistant's pairable toolCall blocks.
  const callToAssistant = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "assistant") continue;
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || readOwn(block, "type") !== "toolCall") continue; // only toolCall blocks carry a pairable id
      const id = readOwn(block, "id");
      if (typeof id === "string" && id.length > 0) {
        callToAssistant.set(id, i); // duplicate id (shouldn't happen) → last wins (deterministic)
      }
    }
  }

  // (b)+(c) Group ALL result indices by their paired assistant (join of callToResult × callToAssistant). Orphan
  //         results (no matching assistant) are skipped here → they become plain units in step (d) (spec/08 E1).
  //         number[] per assistant (NOT a 1:1 map) so duplicate callIds group together → orphan-safe (GOTCHA #9).
  const assistantToResults = new Map<number, number[]>();
  for (let i = 0; i < list.length; i++) {
    const msg = list[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "toolResult") continue;
    const id = readOwn(msg, "toolCallId");
    if (typeof id !== "string" || id.length === 0) continue;
    const assistantIndex = callToAssistant.get(id);
    if (assistantIndex === undefined) continue; // orphan result → leave for the plain pass (GOTCHA #6)
    let bucket = assistantToResults.get(assistantIndex);
    if (bucket === undefined) {
      bucket = [];
      assistantToResults.set(assistantIndex, bucket);
    }
    bucket.push(i);
  }

  // Build toolGroup units for every assistant that issued ≥1 pairable toolCall (distinct values of callToAssistant).
  // `assigned` dedups: one assistant with N calls appears N× in .values() → ONE toolGroup, not N (GOTCHA #5).
  const assigned = new Set<number>();
  const units: Unit[] = [];
  for (const assistantIndex of callToAssistant.values()) {
    if (assigned.has(assistantIndex)) continue;
    const results = assistantToResults.get(assistantIndex) ?? [];
    const indices = [assistantIndex, ...results].sort((a, b) => a - b); // ascending (GOTCHA #10)
    for (const idx of indices) assigned.add(idx);
    units.push({ indices, kind: "toolGroup" });
  }

  // (d) Every index NOT in a toolGroup → a plain unit. Orphan toolResults land here (their own plain unit).
  for (let i = 0; i < list.length; i++) {
    if (assigned.has(i)) continue;
    units.push({ indices: [i], kind: "plain" });
  }

  // (e) Order units by their minimum index (indices[0]).
  units.sort((a, b) => a.indices[0] - b.indices[0]);
  return units;
}

// ── module-private defensive helpers (mirror tokens.ts/ledger.ts — never throw) ───

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

/**
 * resolveLastToolCallGroup — find the most recent toolGroup unit, EXCLUDING the unit whose
 * assistant message issued the rewind's own toolCall (spec/06-context-filter.md §3).
 *
 * ALGORITHM (spec/06 §3, steps 1–5):
 *   1. Iterate `units` from the END backward to index 0.
 *   2. Skip any `plain` unit (and any malformed record) — they carry no tool calls.
 *   3. For each `toolGroup`, if `excludeToolCallId` is a non-empty string AND that unit's assistant
 *      message issued a toolCall with `id === excludeToolCallId` → SKIP it. That is the rewind's OWN
 *      toolGroup (the assistant message carrying the `mulligan_rewind` toolCall + its result); without
 *      exclusion "last tool-call group" would resolve to the rewind itself (spec/08 E2). The SAME rule
 *      resolves the parallel-tool case conservatively (spec/06 §9, spec/08 E6): if `mulligan_rewind`
 *      shares an assistant message with sibling calls, that whole shared toolGroup is skipped and the
 *      PREVIOUS toolGroup becomes the target (pairing-safe, never an orphan).
 *   4. The first non-skipped toolGroup from the end is the target → return its `indices`.
 *   5. If the loop exhausts with no toolGroup → return `null` (nothing to rewind → applyRewind no-ops → spec/08 E8).
 *
 * WHY exclude: when the agent calls `mulligan_rewind`, that call is itself a toolGroup. The rewind marker
 * carries `excludeToolCallId` (captured from the tool's `execute(toolCallId, params, …)` first argument —
 * spec/05 §1 + api_verification.md "NOTE on execute signature") precisely so the filter can skip it.
 *
 * RETURNS `number[] | null` — the resolved toolGroup's `indices` (NOT a Unit object). The single consumer
 * `filterPipeline` (P1.M3.T5.S1) uses `remove = resolveLastToolCallGroup(units, m, rw.excludeToolCallId) ?? []`
 * (spec/06 §12 pseudocode `u ? u.indices : []` is reference-only and inconsistent with this signature).
 * Returning a unit's indices is what lets `applyRewind` remove the assistant call AND all its results
 * together → the model API never sees an orphaned toolCall/toolResult (api_verification.md §6.4).
 *
 * Pure + defensive: a non-array `units` → null; malformed messages, throwing-Proxy messages, and a
 * non-string/empty `excludeToolCallId` (→ never skip) are all handled gracefully — NEVER throws (E13;
 * context-handler hot path). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param units the partitioned units (from partitionIntoUnits); walked end→start
 * @param messages the message list (for reading assistant toolCall ids, via readOwn)
 * @param excludeToolCallId the rewind's own toolCall id to skip; undefined/empty/non-string → never skip
 * @returns the resolved toolGroup's indices, or null when nothing matches
 */
export function resolveLastToolCallGroup(
  units: Unit[],
  messages: MessageLike[],
  excludeToolCallId?: string,
): number[] | null {
  // Defensive: a non-array units (shouldn't happen) → nothing resolvable.
  if (!Array.isArray(units)) return null;

  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;

  // 1) Walk units from the last to the first.
  for (let k = units.length - 1; k >= 0; k--) {
    const unit = units[k];
    // 2) Skip plain units (+ malformed records). Only toolGroups are candidates.
    if (!isRecord(unit) || unit.kind !== "toolGroup" || !Array.isArray(unit.indices)) continue;

    // 3) If exclusion is active, skip this toolGroup when its assistant issued the rewind's own call
    //    (the rewind's own toolGroup, or a parallel-shared message — spec/06 §9 / spec/08 E6).
    if (hasExclude && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
      continue;
    }

    // 4) First non-skipped toolGroup from the end → return its indices (read-only reference; applyRewind copies).
    return unit.indices;
  }

  // 5) No toolGroup found → nothing to rewind (applyRewind no-ops; spec/08 E8).
  return null;
}

/**
 * Module-private: did the assistant message within this toolGroup issue a toolCall whose id === callId?
 * Defensive (isRecord/readOwn; never throws). `indices` is a toolGroup's member indices (assistant + results).
 * Scans ALL assistant members and ALL their toolCall blocks so a parallel-tool assistant (one message, several
 * calls) is handled (spec/06 §9). Returns false if `messages` is malformed, no assistant is present, or no match.
 */
function assistantIssuedCall(
  messages: MessageLike[] | unknown,
  indices: number[],
  callId: string,
): boolean {
  if (!Array.isArray(messages)) return false;
  for (const i of indices) {
    const msg = messages[i];
    if (!isRecord(msg) || readOwn(msg, "role") !== "assistant") continue;
    const content = readOwn(msg, "content");
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || readOwn(block, "type") !== "toolCall") continue;
      if (readOwn(block, "id") === callId) return true; // this assistant issued the excluded call
    }
  }
  return false;
}

/**
 * resolveLastTurn — find the removal set for a "last_turn" rewind (spec/06-context-filter.md §4).
 *
 * A TURN = a user message plus everything after it up to (not including) the next user message. The last turn
 * begins at iLastUser = index of the last message with role "user".
 *
 * ALGORITHM (spec/06 §4, v1.1):
 *   1. Find iLastUser = index of the last "user" message. If none → { remove: [] } (nothing to rewind — protected).
 *   2. KEEP the user message; remove every message AFTER iLastUser EXCEPT (a) the rewind's OWN unit (the assistant
 *      message that issued `excludeToolCallId` + its results — partitioned via partitionIntoUnits, detected via
 *      assistantIssuedCall from S1), and (b) any `mulligan:*` custom messages at the tail (the note MUST survive so
 *      the resumed model reads it). The surviving tail is [user message] + [mulligan:note] + [rewind assistant +
 *      result]; the model resumes at the current prompt.
 *
 * V1.1 GUARDRAIL (spec/13 §1): last_turn always keeps the user message — it never wipes user input. To rewind
 * across your own subsequent prompts, set a checkpoint first. The removal loop starts at iLastUser + 1, so iLastUser
 * is NEVER pushed → NEVER in `remove` → the guardrail holds BY CONSTRUCTION. (v1.0's wipe-user-message mode is
 * gone; the legacy options field survives on RewindMarkerLike for backward-compat reads of old markers, but the
 * v1.1 resolver ignores it — see RewindMarkerLike.)
 *
 * PAIRING (spec/06 §4 pt 4): removal is index-based but pairing-safe in well-formed input — every assistant+result
 * pair produced in the rewound turn lives entirely after iLastUser, so both sides are removed together. The
 * rewind's OWN unit is kept WHOLE (assistant + all its results via rewindOwnIndices), which ALSO resolves the
 * parallel-tool case conservatively (spec/06 §9, spec/08 E6): if mulligan_rewind shares an assistant message with
 * sibling calls, the entire shared unit is kept (siblings + results survive in the view). excludeToolCallId
 * absent/empty/non-string → the rewind's own unit is not identified → it is removed with the rest (pairing still
 * safe; the note still survives — a real rewind marker always carries a valid excludeToolCallId).
 *
 * RETURNS `{ remove: number[] }` (NOT number[] | null — empty array = no-op/refusal). The single consumer
 * `filterPipeline` (P1.M3.T5.S1) uses `remove = resolveLastTurn(m, excludeId).remove` (spec/06 §12).
 *
 * Pure + defensive: a non-array `messages` → { remove: [] }; malformed messages, throwing-Proxy messages, and a
 * non-string/empty `excludeToolCallId` are all handled gracefully — NEVER throws (E13; context-handler hot path).
 * Every field read goes through the module-private isRecord/readOwn.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → { remove: [] }
 * @param excludeToolCallId the rewind's own toolCall id (its unit is kept); undefined/empty/non-string → not kept
 * @returns { remove: number[] } — ascending message indices to remove; [] for no-op/refusal
 */
export function resolveLastTurn(
  messages: MessageLike[],
  excludeToolCallId?: string,
): { remove: number[] } {
  // Defensive: a non-array messages (shouldn't happen) → nothing to rewind.
  if (!Array.isArray(messages)) return { remove: [] };

  // 1) iLastUser = index of the LAST "user" message.
  let iLastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
  }
  if (iLastUser === -1) return { remove: [] }; // no user message → nothing to rewind (protected)

  // 2) rewindOwnIndices = the set of message indices in the rewind's OWN unit (kept whole). Only when
  //    excludeToolCallId is a non-empty string; the unit is found via partitionIntoUnits + assistantIssuedCall (S1).
  //    This single rule ALSO keeps a parallel-shared assistant message whole (§9/E6) — no special branching.
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    const units = partitionIntoUnits(messages);
    for (const unit of units) {
      if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
        for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
      }
    }
  }

  // 3) Build the removal set, ASCENDING. The loop starts at iLastUser + 1 → iLastUser is NEVER pushed → the
  //    v1.1 guardrail holds BY CONSTRUCTION (last_turn always keeps the latest user message). Every index > iLastUser
  //    is removed except the rewind's own unit and mulligan:* custom messages.
  const remove: number[] = [];
  for (let j = iLastUser + 1; j < messages.length; j++) {
    if (rewindOwnIndices.has(j)) continue; // the rewind's own assistant + results survive
    if (isMulliganCustomMessage(messages[j])) continue; // the note / nudge survives
    remove.push(j);
  }
  return { remove };
}

/**
 * Module-private: is this message a `mulligan:*` custom message (the note / nudge that MUST survive a rewind)?
 * Detected by a `customType` string with the `mulligan:` prefix (a real Pi CustomMessage carries role "custom" +
 * customType — spec/01 line156; the looper-smoke proto detects custom messages by m.customType). Defensive
 * (isRecord/readOwn; never throws).
 */
function isMulliganCustomMessage(msg: unknown): boolean {
  if (!isRecord(msg)) return false;
  const customType = readOwn(msg, "customType");
  return typeof customType === "string" && customType.startsWith("mulligan:");
}

// ── resolveCheckpoint (checkpoint targeting — entry→message mapping; spec/06 §6) ───

/**
 * Minimal structural SessionEntry-like type for resolveCheckpoint's branchEntries param (a real Pi SessionEntry[]
 * from getBranch() assigns in with NO cast — structural typing, mirrors MessageLike/Unit). Purity: resolveCheckpoint
 * takes the DATA it needs (branchEntries + checkpointName), NOT ctx (ExtensionContext) — it never imports Pi.
 * EXPORTED so tests build typed fixtures and filter.ts (P1.M4.T2) passes getBranch() typed as BranchEntry[].
 */
export interface BranchEntry {
  type: string; // "message" | "custom_message" | "compaction" | "branch_summary" | "label" | "custom" | ...
  id: string;
  parentId?: string | null;
  timestamp?: string;
  /** LabelEntry only — the entry this label points at (the checkpointed entry). */
  targetId?: string;
  /** LabelEntry only — the label string, e.g. "mulligan:checkpoint:before-x". */
  label?: string;
  [key: string]: unknown; // message/customType/summary/firstKeptEntryId/... read defensively via readOwn
}

/**
 * resolveCheckpoint — map a named `mulligan:checkpoint:<name>` Pi LabelEntry to a message index, then compute the
 * removal set for a `checkpoint` rewind (spec/06-context-filter.md §6). The ONLY place Mulligan maps entries↔messages
 * (the relative granularities resolve against messages directly).
 *
 * ALGORITHM (spec/06 §6, steps 1–6):
 *   1. Defensive: non-array messages/branchEntries, or checkpointName not a non-empty string → null.
 *   2. Find the FIRST LabelEntry (scanning branchEntries in REVERSE (leaf→root, since branchEntries is
 *      root→leaf) = most-recent) whose label === `mulligan:checkpoint:${checkpointName}`. None → null
 *      (spec/08 E10 not-found → refuse). targetId = its targetId; non-string/empty → null.
 *   3. ctxEntries = branchEntries directly (already root→leaf — getBranch() order; no internal reverse)
 *      filtered to context-producing types (message, custom_message, branch_summary, compaction — spec/06 §6 step 2).
 *   4. Walk ctxEntries with msgCursor (messages consumed). For each entry: yield = entryMessageYield(entry);
 *      yield < 0 (compaction/unknown → indeterminate) OR msgCursor+yield > messages.length (alignment lost) → null.
 *      If entry.id === targetId → iTarget = msgCursor + yield - 1 (the entry's LAST message index — kept); break.
 *      Else msgCursor += yield. Loop end without match → null (targetId labels a non-context-producing entry).
 *   4b. UNIT-SNAP (BUG-003 secondary / spec/06 §2 cardinal pairing): partitionIntoUnits(messages); if iTarget is
 *      inside a toolGroup unit, advance it to that unit's MAX index (so the assistant + ALL its toolResults are
 *      KEPT and `remove` starts strictly after the unit — never orphan a toolCall). Plain (single-message) unit
 *      → no-op (max === iTarget), so user / text-only-assistant checkpoints are unaffected.
 *   5. remove (ascending): for j from (unit-snapped) iTarget+1..end, skip if rewindOwnIndices.has(j) (the rewind's own unit via
 *      partitionIntoUnits + assistantIssuedCall, only when excludeToolCallId is a non-empty string) or
 *      isMulliganCustomMessage(messages[j]) (the note/nudge). Else push. (IDENTICAL to resolveLastTurn's rule —
 *      spec/06 §6 step 5 "same tail-exclusion rules as resolveLastTurn".)
 *   6. Return { remove }.
 *
 * COMPACTION (spec/06 §6 vs installed Pi): spec says compaction yields `1 + retainedTail.length` and "refuse if a
 * compaction entry lacks retainedTail." The installed Pi CompactionEntry has NO retainedTail, AND getBranch() is the
 * RAW path (not compaction-aware) while event.messages is compaction-aware → a compaction on the root→target walk
 * makes the mapping INDETERMINATE. entryMessageYield returns -1 for compaction → this function returns null (refuse
 * safely, never guess — spec/06 §6 end). Compaction AFTER the checkpoint is never walked (we break at target) so it
 * stays aligned. See PRP "Known Gotchas" + research/spec_extracts.md §2 for the full proof.
 *
 * RETURNS `{ remove: number[] } | null` — null = indeterminate/refuse (not-found, non-context-producing target,
 * compaction, overshoot, non-array, bad checkpointName); { remove: [] } = determinable-but-empty (nothing after
 * iTarget, or all after-iTarget excluded). The single consumer filterPipeline (P1.M3.T5.S1) uses
 * `remove = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId)?.remove ?? []` (spec/06 §12).
 *
 * Pure + defensive: null/non-array messages/branchEntries → null; malformed entries, throwing-Proxy objects, and a
 * non-string/empty checkpointName/excludeToolCallId are all handled gracefully — NEVER throws (E13; context-handler
 * hot path). Every field read goes through the module-private isRecord/readOwn. NEVER imports Pi (purity).
 *
 * @param messages the LLM message list (a real Pi AgentMessage[] assigns in with no cast); non-array → null
 * @param branchEntries getBranch() output, ROOT→LEAF (getBranch() order; no internal reverse needed); non-array → null
 * @param checkpointName the checkpoint name (without the `mulligan:checkpoint:` prefix); non-string/empty → null
 * @param excludeToolCallId the rewind's own toolCall id (its unit is kept); undefined/empty/non-string → not kept
 * @returns { remove: number[] } on a determinable mapping (possibly empty), or null when indeterminate/refused
 */
export function resolveCheckpoint(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  checkpointName: string,
  excludeToolCallId?: string,
): { remove: number[] } | null {
  // 1) Defensive: arrays + a non-empty checkpoint name.
  if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
  if (typeof checkpointName !== "string" || checkpointName.length === 0) return null;

  const needle = `mulligan:checkpoint:${checkpointName}`;

  // 2) Find the FIRST (most-recent) LabelEntry with the matching label. branchEntries is ROOT→LEAF
  //    (getBranch() order), so scan from the END (leaf→root) so the most-recent (leaf-most) match wins.
  let targetId: string | undefined;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const e = branchEntries[i];
    if (!isRecord(e)) continue;
    if (readOwn(e, "type") !== "label") continue;
    if (readOwn(e, "label") !== needle) continue;
    const tid = readOwn(e, "targetId");
    if (typeof tid === "string" && tid.length > 0) {
      targetId = tid;
      break; // most-recent (leaf-most) match wins
    }
  }
  if (targetId === undefined) return null; // not found on this branch (spec/08 E10) or no usable targetId → refuse

  // 3) ctxEntries = branchEntries (already ROOT→LEAF — getBranch() order; no internal reverse) filtered
  //    to context-producing types (spec/06 §6 step 2).
  const ctxEntries = branchEntries.filter((e) =>
    isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined),
  );

  // 4) Walk in parallel with messages; stop at the target entry → iTarget = its last message index.
  let msgCursor = 0;
  let iTarget = -1;
  let found = false;
  for (const e of ctxEntries) {
    const y = entryMessageYield(e); // 1 for message/custom_message/branch_summary; -1 (indeterminate) for compaction/unknown
    if (y < 0) return null; // compaction (or unknown) on the walked range → mapping indeterminate → refuse safely
    if (msgCursor + y > messages.length) return null; // alignment lost (raw branch vs compaction-aware messages) → refuse
    if (isRecord(e) && readOwn(e, "id") === targetId) {
      iTarget = msgCursor + y - 1; // the entry's LAST message index — KEPT (spec/06 §6 "keep the checkpoint point")
      found = true;
      break;
    }
    msgCursor += y;
  }
  if (!found) return null; // targetId labels a non-context-producing entry (filtered out) → refuse (never guess)

  // 4b) UNIT-SNAP (BUG-003 secondary fix / spec/06 §2 cardinal pairing rule): if iTarget lands INSIDE a
  //     toolGroup unit — e.g. the checkpointed entry is an assistant that issued tool calls — that assistant's
  //     sibling toolResult indices (iTarget+1, iTarget+2, …) would otherwise be swept into `remove` by step 5,
  //     KEEPING the toolCall but REMOVING its toolResult → an orphaned toolCall the model API rejects
  //     (spec/06 §2; api_verification §6.4; spec/08 E1). Snap iTarget FORWARD to the END (max index) of
  //     whatever unit contains it: the entire unit (assistant + all its results) is then KEPT, and `remove`
  //     begins strictly AFTER the unit. For a plain (single-message) unit this is a no-op (max === iTarget),
  //     so checkpoints on user / text-only-assistant messages are unaffected.
  const units = partitionIntoUnits(messages);
  for (const unit of units) {
    if (unit.indices.includes(iTarget)) {
      iTarget = Math.max(...unit.indices);
      break;
    }
  }

  // 5) remove = indices > iTarget, EXCEPT the rewind's own unit + mulligan:* notes (IDENTICAL to resolveLastTurn).
  //    Reuses `units` from step 4b (partitionIntoUnits is pure; messages is a const param, never mutated).
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    for (const unit of units) {
      if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
        for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
      }
    }
  }
  const remove: number[] = [];
  for (let j = iTarget + 1; j < messages.length; j++) {
    if (rewindOwnIndices.has(j)) continue; // the rewind's own assistant + results survive
    if (isMulliganCustomMessage(messages[j])) continue; // the note / nudge survives
    remove.push(j);
  }
  return { remove };
}

/**
 * Module-private: how many LLM messages does this branch entry produce? Verified against Pi
 * sessionEntryToContextMessages (session-manager.js): message/custom_message/branch_summary → 1; compaction → 1 in
 * Pi BUT the spec/06 §6 "1 + retainedTail.length" model does not match (no retainedTail) AND a compaction on a RAW
 * getBranch misaligns with compaction-aware messages → returns the INDETERMINATE sentinel (-1) so the caller refuses.
 * Non-context-producing types (label/custom/…) also return -1 (they are filtered out before the walk, so this is a
 * safety net). Defensive (isRecord/readOwn; never throws).
 */
function entryMessageYield(entry: unknown): number {
  const type = isRecord(entry) ? readOwn(entry, "type") : undefined;
  if (type === "message" || type === "custom_message" || type === "branch_summary") return 1;
  return -1; // compaction (indeterminate) OR unknown/non-context-producing → caller refuses
}

/** Module-private: is this entry type one that produces a context message (spec/06 §6 step 2 list)? */
function isContextProducingType(type: unknown): boolean {
  return type === "message" || type === "custom_message" || type === "branch_summary" || type === "compaction";
}

// ── resolvePinnedHide (pinned stable-anchor hiding; fix_design.md §Change 3; fixes BUG-001/BUG-002) ────

/**
 * resolvePinnedHide — map a SET of PINNED stable entry IDs (captured at marker-creation time by captureHideEntryIds,
 * P1.M2.T3) to the CURRENT message-index removal set, for PERMANENT soft-delete hiding (fix_design.md §Change 3;
 * the core fix for BUG-001/BUG-002). GENERALIZES resolveCheckpoint's entry→message walk (above) from "one checkpoint
 * target" to "a set of pinned entry ids", and from resolveCheckpoint's contiguous "remove everything after iTarget"
 * sweep to a discrete "remove exactly the messages whose entry id is pinned" rule.
 *
 * WHY PINNED IDS (fix_design.md; BUG-001/BUG-002 root cause): the legacy resolvers store a RELATIVE spec
 * ('last tool group' / 'last turn') that filterPipeline RE-RESOLVES against the constantly-growing message list on
 * every context fire. The moment the agent resumes work (the documented, intended usage), new messages are appended
 * and the relative spec re-targets onto the NEW (legitimate) work — un-hiding the originally-hidden mistake and
 * hiding the new work (BUG-001), or hiding the agent's own redo on every fire → infinite loop (BUG-002). Pi session
 * entries have PERMANENT, STABLE `id` fields; captureHideEntryIds pins the entry ids of the span to hide AT
 * marker-creation time. This fn resolves those stable ids → current message indices every fire. New work produces
 * NEW entries with NEW ids NOT in the pinned set → their messages are visible (correct permanence). Message INDICES
 * are NOT a stable anchor (they shift on compaction: the message list is compaction-aware; getBranch() is not) —
 * which is exactly why the anchor is entry IDs, not indices.
 *
 * ALGORITHM (retained-tail walk; fixes BUG-002 — architecture/system_context.md §BUG-002):
 *   1. Defensive: non-array messages/branchEntries/hideEntryIds, OR empty hideEntryIds → return [] (safe no-op;
 *      applyRewind(m, []) is the documented idempotent no-op — spec/10 §1.4).
 *   2. Build a Set<string> from hideEntryIds (skip non-string/empty ids; dedupes).
 *   3. Find lastCompactionIdx — the INDEX of the LAST entry on the branch whose type === "compaction" (-1 if none).
 *      getBranch() is the RAW path (carries compacted-away entries + the compaction entry); event.messages is
 *      COMPACTION-AWARE (summary + retained tail). The compacted-away set is unknowable from the compaction entry
 *      (no retainedTail field — architecture/external_deps.md), so a whole-branch walk is fundamentally
 *      unalignable. The entries AFTER the last compaction are the "retained tail" and map 1:1 to the LAST
 *      tailEntries.length messages.
 *   4. tailEntries = branchEntries.slice(lastCompactionIdx + 1) filtered to context-message types ONLY
 *      (entryMessageYield(e) > 0: message/custom_message/branch_summary — each yields exactly 1 message). Do NOT
 *      use isContextProducingType here (it INCLUDES compaction, wrong for the tail).
 *   5. tailStartIdx = messages.length - tailEntries.length. The retained tail maps to the LAST tailEntries.length
 *      messages, so retained-tail entry k ↔ messages[tailStartIdx + k]. If tailStartIdx < 0 → return [] (raw branch
 *      vs compaction-aware messages misalign beyond recovery → refuse safely; the marker persists, content not
 *      hidden this fire, no crash).
 *   6. Walk the tail; push tailStartIdx + k for each entry whose string id ∈ hideSet. Entries pinned in the
 *      COMPACTED-AWAY HEAD are correctly unmatched (they are absent from tailEntries, and absent from messages →
 *      no leak, no error). No-compaction case: lastCompactionIdx === -1 → slice(0) = all entries → tailEntries is
 *      the whole context-message list → tailEntries.length === messages.length → tailStartIdx === 0 → entry k ↔
 *      messages[k] (IDENTICAL to the legacy forward walk — tests (a)/(b) stay green).
 *   7. Return remove (ascending by construction — the tail walk is root→leaf; no sort needed).
 *
 * This UPGRADES spec/08 E24 ("Pinned hide no-ops under compaction" — previously framed as a KNOWN LIMITATION):
 * retained-tail hides now WORK post-compaction; only entries pinned in the compacted-away head no-op (correctly —
 * they are gone from messages). E24 is a leak (not a replay), so the fix is pure correctness (hidden content stays
 * hidden); no new pairing/serialization risk.
 *
 * WHY resolveCheckpoint KEEPS its bail-on-compaction (do NOT change the shared helpers): resolveCheckpoint removes
 * a CONTIGUOUS SWEEP ("everything after iTarget") — a compaction anywhere in its walked range makes the sweep's end
 * indeterminate, so refusing (null) is correct for ITS semantics. resolvePinnedHide removes a DISCRETE set (exactly
 * the pinned entries) — it only needs retained-tail alignment, so it can be compaction-aware without the bail. The
 * two resolvers legitimately need DIFFERENT compaction handling; entryMessageYield + isContextProducingType stay
 * unchanged (resolveCheckpoint reuses them).
 *
 * WHY NO UNIT-SNAP / NO REWIND-OWN / NO NOTE EXCLUSION (unlike resolveCheckpoint): resolveCheckpoint removes a
 * contiguous SWEEP ("everything after iTarget") and so must (a) unit-snap iTarget to avoid orphaning the
 * checkpointed assistant's own results, (b) keep the rewind's own unit, (c) keep mulligan:* notes. resolvePinnedHide
 * removes EXACTLY the pinned entries — a DISCRETE set, not a sweep. Pairing safety comes from the PRODUCER
 * (captureHideEntryIds, P1.M2.T3, resolves at the UNIT level → pins the WHOLE unit's entry ids: assistant + ALL its
 * results), so this resolver removes whole units by construction. The mulligan:note and the rewind's own tool call
 * are NOT in hideEntryIds (capture runs at marker-creation time, BEFORE the marker is persisted + the note sent, and
 * resolves the TARGET span not the rewind's own call) → they are never walked as pinned → never removed.
 *
 * RETURNS `number[]` (NEVER null): the ascending message indices to hide. [] = determinable-but-empty OR refusal
 * (nothing pinned / indeterminate compaction / alignment lost / non-array input). filterPipeline (P1.M2.T4) feeds
 * this straight to applyRewind, where [] is the documented idempotent no-op. Returning [] (not null) is INTENTIONAL:
 * a refused pinned hide must NOT fall back to legacy relative resolution (that re-introduces BUG-001/BUG-002). The
 * P1.M2.T4 dispatch checks `Array.isArray(hideEntryIds) && hideEntryIds.length > 0` BEFORE calling this fn, so the
 * legacy fallback only runs for markers that genuinely LACK hideEntryIds (old markers / capture failure).
 *
 * Pure + defensive: null/non-array messages/branchEntries/hideEntryIds → []; malformed/non-record entries,
 * throwing-Proxy objects, and non-string ids are all handled gracefully — NEVER throws (E13; context-handler hot
 * path via filterPipeline). Every field read goes through the module-private isRecord/readOwn. NEVER imports Pi
 * (purity). REUSES entryMessageYield + isContextProducingType (module-private, hoisted above — do NOT redeclare).
 *
 * @param messages the LLM message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param branchEntries getBranch() output, ROOT→LEAF (getBranch() order; NO internal reverse); non-array → []
 * @param hideEntryIds stable ENTRY ids pinned at marker-creation time (captureHideEntryIds, P1.M2.T3); non-array/empty → []
 * @returns ascending message indices to hide ([] = nothing pinned / refusal / non-array input — safe no-op)
 */
export function resolvePinnedHide(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  hideEntryIds: string[],
): number[] {
  // 1) Defensive: all three must be arrays; hideEntryIds must be non-empty.
  if (!Array.isArray(messages) || !Array.isArray(branchEntries) || !Array.isArray(hideEntryIds)) return [];
  if (hideEntryIds.length === 0) return [];

  // 2) O(1) membership lookup (skips non-string/empty ids; dedupes).
  const hideSet = new Set<string>();
  for (const id of hideEntryIds) {
    if (typeof id === "string" && id.length > 0) hideSet.add(id);
  }
  if (hideSet.size === 0) return []; // hideEntryIds held no usable string ids → nothing to hide

  // 3) RETAINED-TAIL WALK (compaction-aware; fixes BUG-002). getBranch() is RAW (compacted-away + compaction +
  //    tail); event.messages is compaction-aware. The entries AFTER the LAST compaction are the "retained tail"
  //    and map 1:1 to the LAST tailEntries.length messages. resolveCheckpoint KEEPS its bail-on-compaction
  //    (contiguous-sweep semantics) — it is NOT touched here.
  let lastCompactionIdx = -1;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
    if (t === "compaction") {
      lastCompactionIdx = i;
      break;
    }
  }

  // 4) tailEntries = retained tail (entries AFTER the last compaction), context-message types ONLY. Reuse
  //    entryMessageYield as the predicate (1 for message/custom_message/branch_summary; -1 otherwise → excluded).
  //    Do NOT use isContextProducingType here — it INCLUDES compaction, which is wrong for the tail.
  const tailEntries = branchEntries.slice(lastCompactionIdx + 1).filter((e) => entryMessageYield(e) > 0);

  // 5) Retained tail ↔ the LAST tailEntries.length messages. If the tail is longer than messages → refuse safely.
  const tailStartIdx = messages.length - tailEntries.length;
  if (tailStartIdx < 0) return []; // raw branch vs compaction-aware messages misalign beyond recovery

  // 6) Walk the tail; hide exactly the pinned entries. No-compaction case: tailStartIdx === 0 (legacy walk).
  const remove: number[] = [];
  tailEntries.forEach((e, k) => {
    const id = isRecord(e) ? readOwn(e, "id") : undefined;
    if (typeof id === "string" && hideSet.has(id)) {
      remove.push(tailStartIdx + k); // this retained-tail entry ↔ messages[tailStartIdx + k]
    }
  });

  // 7) remove is ascending by construction (tail walk is root→leaf; msgIdx monotonic). Return it.
  return remove;
}

/**
 * applyRewind — the PURE gap-closing index-removal helper for rewind application (spec/06-context-filter.md
 * §3, §4, §12). The DUMB half of rewind: the resolvers (resolveLastToolCallGroup / resolveLastTurn /
 * resolveCheckpoint — sibling functions above) compute UNIT-AWARE `remove` index sets; `applyRewind` filters
 * those indices out and closes the gap. Pairing is preserved BY CONSTRUCTION because the caller already removed
 * whole units (a toolGroup's [assistant, ...results] go together — never orphaning either side — spec/06 §3/§4
 * "applyRewind for this granularity = remove the resolved unit's indices, then close the gap").
 *
 * CONTRACT (spec/06 §12 call site, `m = applyRewind(m, remove)`):
 *   - INPUT: `messages` (a real Pi AgentMessage[] assigns in with no cast via the MessageLike[] param), `remove`
 *     (a number[] of message indices to drop — ascending, from a resolver; possibly empty).
 *   - EMPTY `remove` (or a remove with no numeric entries) → return `messages` UNCHANGED (SAME reference). This
 *     is the documented idempotent no-op (spec/10 §1.4; spec/06 §12 reaches here with remove=[] whenever a
 *     resolver returns null/empty — spec/08 E8). Same-reference matches the applyShrink precedent (spec/06 §5
 *     L133) and is safe for the `lastFiltered` cache + mulligan_audit (content consumers — spec/06 §7 L174).
 *   - NON-ARRAY `messages` → return `[]` (defensive; mirrors partitionIntoUnits L113). NON-ARRAY `remove` → treat
 *     as no removal → return `messages` unchanged (same reference).
 *   - OUT-OF-RANGE / negative / non-number / duplicate entries in `remove` → harmless (they never match a valid
 *     array index). The resolvers never emit those, but the function stays TOTAL regardless.
 *
 * WHY filter (not a hand-rolled splice loop): `Array.filter` returns a CONTIGUOUS new array → the gap is closed
 * for free (spec/06 §3/§4 "close the gap"). The callback IGNORES the element (`_msg`) so a throwing-Proxy message
 * element's get-trap NEVER fires → applyRewind NEVER throws on malformed/proxy messages (spec/08 E13) even though
 * it uses no isRecord/readOwn — it is the ONE transform that touches no message internals (trivially safe vs the
 * siblings, which read role/content/customType).
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-array/empty remove → messages unchanged; out-of-range/
 * negative/non-number/duplicate indices → harmless; throwing-Proxy elements → never read → never throws (E13;
 * context-handler hot path via filterPipeline T5.S1). Side-effect-free (never mutates `messages`). NO new imports
 * (reuses MessageLike already in module scope; `grep -c '^import' src/transforms.ts` stays 0).
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param remove ascending message indices to drop (from a resolver); empty/non-array → messages unchanged
 * @returns a NEW array with `remove` indices dropped (gap closed); the SAME array reference when nothing is removed
 */
export function applyRewind(messages: MessageLike[], remove: number[]): MessageLike[] {
  // Defensive: a non-array messages (shouldn't happen) → []. Non-array/empty remove → messages unchanged (no-op).
  if (!Array.isArray(messages)) return [];
  if (!Array.isArray(remove) || remove.length === 0) return messages;

  // Build a Set of NUMERIC removal indices. Non-numbers / out-of-range / negatives / NaN never match a valid
  // array index → harmless (the resolvers never emit those, but stay total). Dedup is free. NaN is excluded
  // because typeof NaN === "number" but NaN is never a usable array index (NaN !== NaN) — excluding it keeps
  // a remove like [NaN, "x"] a true no-op (same-reference) per the spec/10 §1.4 contract.
  const removeSet = new Set<number>();
  for (const r of remove) {
    if (typeof r === "number" && !Number.isNaN(r)) removeSet.add(r);
  }
  if (removeSet.size === 0) return messages; // no valid indices → unchanged (idempotent)

  // Filter out the indices to remove; Array.filter yields a contiguous new array (gap closed — spec/06 §3/§4).
  // The callback IGNORES the element → a throwing-Proxy element's get-trap never fires → never throws (E13).
  return messages.filter((_msg, i) => !removeSet.has(i));
}

/**
 * ShrinkTarget — how a shrink identifies the message whose content to substitute (spec/04-data-model.md §4;
 * spec/06-context-filter.md §5). Discriminated union; resolveShrinkTarget resolves it LIVE each inference against
 * the current event.messages (compaction-robust — spec/04 §4 "targets resolve against the current messages each
 * inference"). STRUCTURALLY IDENTICAL to markers.ts's ShrinkTarget (a real markers.ts ShrinkTarget / ShrinkMarker.target
 * assigns in with NO cast) — declared LOCALLY here so transforms.ts stays Pi-FREE (0 imports; it must NOT import from
 * markers.ts, which pulls in Pi). This mirrors the MessageLike convention (a local structural type, not AgentMessage).
 * EXPORTED so the shrink tool (P1.M5.T2), filterPipeline (T5.S1), and tests share one shape at the pure tier.
 */
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

/**
 * resolveShrinkTarget — resolve a ShrinkTarget to a single message index, LIVE against the current messages
 * (spec/06-context-filter.md §5; spec/04-data-model.md §4). Returns the matched index or null (no match → the
 * shrink no-ops this fire and retries next fire — compaction-robust; spec/06 §5:133, spec/04 §4).
 *
 * MATCHER STRATEGIES (spec/06 §5 L126-128):
 *   - by_tool_call_id: return the index of the FIRST toolResult message whose `toolCallId === id` (toolCallId is
 *     unique → at most one), else null.
 *   - by_tool_name + occurrence: among toolResult messages whose `toolName === name`, return the LAST index
 *     (occurrence:"last", the default for any non-"first" value — GOTCHA #6) or the FIRST index (occurrence:"first"),
 *     else null.
 *   - by_content_includes: return the index of the FIRST message (ANY role — spec/08 E19) whose stringified `content`
 *     includes the NON-EMPTY substring (an empty needle resolves to null — defense-in-depth, BUG-004;
 *     stringifyContent: string→verbatim, array→JSON.stringify), else null.
 *
 * The FIRST present non-empty-string discriminator key decides the variant (by_tool_call_id → by_tool_name →
 * by_content_includes); a target with no recognizable discriminator, or a non-string/empty id/name/needle, resolves to null.
 *
 * Pure + defensive: a non-array `messages` → null; a non-record `target` → null; malformed messages, throwing-Proxy
 * messages, and non-string/empty discriminator values are all handled gracefully — NEVER throws (E13; context-handler
 * hot path via filterPipeline T5.S1). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → null
 * @param target the ShrinkTarget (discriminated union); non-record → null
 * @returns the matched message index, or null when nothing matches
 */
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null {
  if (!Array.isArray(messages)) return null;
  if (!isRecord(target)) return null;

  // by_tool_call_id: first toolResult whose toolCallId === id (unique → at most one).
  const callId = readOwn(target, "by_tool_call_id");
  if (typeof callId === "string" && callId.length > 0) {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!isRecord(m) || readOwn(m, "role") !== "toolResult") continue;
      if (readOwn(m, "toolCallId") === callId) return i;
    }
    return null;
  }

  // by_tool_name + occurrence: among toolResults with toolName === name, last (default) or first index.
  const name = readOwn(target, "by_tool_name");
  if (typeof name === "string" && name.length > 0) {
    const wantFirst = readOwn(target, "occurrence") === "first"; // anything else (incl. missing) → last (GOTCHA #6)
    let found = -1;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!isRecord(m) || readOwn(m, "role") !== "toolResult") continue;
      if (readOwn(m, "toolName") === name) {
        if (wantFirst) return i; // first match wins immediately
        found = i;               // keep scanning → last match wins
      }
    }
    return found === -1 ? null : found;
  }

  // by_content_includes: first message (ANY role — E19) whose stringified content includes a NON-EMPTY substring.
  const needle = readOwn(target, "by_content_includes");
  if (typeof needle === "string" && needle.length > 0) {
    for (let i = 0; i < messages.length; i++) {
      if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
    }
    return null;
  }

  return null; // no recognizable discriminator key
}

/**
 * resolvePinnedShrink — the single-id identity resolver for PINNED shrinks (FINDING 3 fix; mirrors resolvePinnedHide
 * for ONE id → ONE message index). When a ShrinkMarker carries a `pinnedEntryId` (the stable ENTRY id the target
 * matched at marker-creation time), applyShrink calls THIS instead of re-resolving the live selector, so the
 * substitution locks to ONE message by identity forever — `by_tool_name`+`last` and `by_content_includes` can no
 * longer drift onto later, unrelated messages as the session grows (the moving-target footgun that motivated the
 * rewind hideEntryIds fix).
 *
 * ALGORITHM (retained-tail walk — fixes BUG-002; mirrors resolvePinnedHide, adapted for ONE id → ONE index):
 *   1. Find lastCompactionIdx: scan branchEntries END→start for the LAST entry whose type === "compaction" (-1 if none).
 *   2. tailEntries = branchEntries.slice(lastCompactionIdx + 1) filtered to context-message types via entryMessageYield > 0
 *      (message/custom_message/branch_summary only; EXCLUDES compaction — do NOT use isContextProducingType, which
 *      includes compaction and would be wrong for the tail).
 *   3. tailStartIdx = messages.length - tailEntries.length. The retained tail maps 1:1 to the LAST tailEntries.length
 *      messages (getBranch() is RAW = compacted-away + compaction + tail; event.messages is compaction-aware). If
 *      tailStartIdx < 0 → null (defensive: raw branch vs compaction-aware messages misalign beyond recovery).
 *   4. Walk the tail; return tailStartIdx + k on the FIRST (only) entry whose id === pinnedEntryId; else null.
 * Entries in the compacted-away head are correctly unmatched (absent from messages → null, no leak, no error).
 * No-compaction case (lastCompactionIdx === -1) degenerates to the legacy forward walk: tailStartIdx === 0 → entry k
 * ↔ messages[k]. This UPGRADES spec/08 E24 for shrinks (retained-tail targets now resolve post-compaction; only
 * compacted-head entries no-op). See §BUG-002 in architecture/system_context.md and T2.S1 (resolvePinnedHide — same
 * algorithm). resolveCheckpoint KEEPS its bail-on-compaction (contiguous-sweep semantics) — it is NOT touched here.
 * Returning null (NOT falling back to live resolution) is deliberate: once a target is pinned we want identity-or-
 * nothing, matching the rewind precedent — substituting a DIFFERENT message that happens to currently match the
 * selector would re-introduce the very moving-target bug pinning exists to prevent.
 *
 * Pure + defensive + TOTAL: non-array messages/branchEntries, or a non-string/empty pinnedEntryId → null; every
 * field read via isRecord/readOwn (readOwn is throw-safe, so the direct call in the lastCompactionIdx scan NEVER
 * throws on a throwing-Proxy entry — E13). NEVER throws (sits on the context-handler hot path via filterPipeline
 * T5.S1). NO new imports (reuses MessageLike + BranchEntry + entryMessageYield + isRecord/readOwn).
 * EXPORTED so applyShrink, filterPipeline, and tests share one shape at the pure tier.
 *
 * @param messages      the CURRENT message list (a real Pi AgentMessage[] assigns in); non-array → null
 * @param branchEntries root→leaf branch entries (getBranch() DATA — carries stable ENTRY ids); non-array → null
 * @param pinnedEntryId the stable ENTRY id to resolve by identity; non-string/empty → null
 * @returns the FIRST message index of the pinned entry, or null when absent / alignment indeterminate (no-op)
 */
export function resolvePinnedShrink(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  pinnedEntryId: string,
): number | null {
  if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
  if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) return null;

  // 3) RETAINED-TAIL WALK (compaction-aware; fixes BUG-002 — mirrors resolvePinnedHide, adapted for ONE id).
  //    getBranch() is the RAW path (carries compacted-away entries + the compaction entry); event.messages is
  //    compaction-aware. The entries AFTER the LAST compaction are the "retained tail" and map 1:1 to the LAST
  //    tailEntries.length messages. resolveCheckpoint keeps its bail-on-compaction (contiguous-sweep) — NOT touched.
  let lastCompactionIdx = -1;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
    if (t === "compaction") {
      lastCompactionIdx = i;
      break;
    }
  }

  // 4) tailEntries = retained tail (entries AFTER the last compaction), context-message types ONLY. Reuse
  //    entryMessageYield as the predicate (1 for message/custom_message/branch_summary; -1 otherwise → excluded).
  //    Do NOT use isContextProducingType here — it INCLUDES compaction, which is wrong for the tail.
  const tailEntries = branchEntries.slice(lastCompactionIdx + 1).filter((e) => entryMessageYield(e) > 0);

  // 5) Retained tail ↔ the LAST tailEntries.length messages. If the tail is longer than messages → refuse safely.
  const tailStartIdx = messages.length - tailEntries.length;
  if (tailStartIdx < 0) return null; // defensive: raw branch vs compaction-aware messages misalign beyond recovery

  // 6) Walk the tail; return the FIRST (only) entry whose id === pinnedEntryId. No-compaction case: tailStartIdx === 0
  //    (legacy forward walk). Entry ids are unique, so there is at most one match — early return avoids walking the rest.
  for (let k = 0; k < tailEntries.length; k++) {
    const id = isRecord(tailEntries[k]) ? readOwn(tailEntries[k], "id") : undefined;
    if (typeof id === "string" && id === pinnedEntryId) {
      return tailStartIdx + k; // this retained-tail entry ↔ messages[tailStartIdx + k]
    }
  }

  // 7) Pinned entry not in the retained tail (compacted away / wrong branch) → no-op this fire (identity-or-nothing).
  return null;
}

/**
 * applyShrink — substitute the matched message's content with a compact replacement (spec/06-context-filter.md §5).
 * The replacement PERSISTS for as long as the marker exists (permanent soft substitution). SHRINKS DO NOT REMOVE
 * MESSAGES — they replace content, preserving role/toolCallId/toolName/isError (and every other field via the
 * spread) so the model API stays valid: a toolResult KEEPS its toolCallId → its assistant call stays paired
 * (spec/06 §5:145 "pairing untouched"); a non-toolResult keeps its role (spec/08 E19).
 *
 * ALGORITHM (spec/06 §5 L131-140):
 *   1. Resolve the target to a message index. PINNED-FIRST (FINDING 3): if marker.pinnedEntryId is a non-empty
 *      string, i = resolvePinnedShrink(messages, branchEntries, pinnedEntryId) (identity-by-stable-entry-id); else
 *      i = resolveShrinkTarget(messages, marker.target) (live re-resolution). null/out-of-range → return messages
 *      UNCHANGED (SAME reference) — the documented no-op (spec/06 §5:133). This is ALSO the "shrink-after-rewind-
 *      removed-target" no-op (spec/06 §5:143) and the compaction-removed-target no-op (spec/04 §4 — retried next
 *      fire; PINNED shrinks no-op rather than re-resolving — identity-or-nothing, the rewind precedent).
 *   2. replacement = { ...orig, content: [{ type:"text", text: replacement }] }. The spread preserves EVERY other
 *      field (role, toolCallId, toolName, isError, customType, …). The spec's §5:136-138 ternary has IDENTICAL
 *      branches (both spread orig + override content — only the comment differs); written as ONE expression here
 *      (DRY — GOTCHA #11). Wrapped in try/catch: a throwing-Proxy orig could make {...orig} throw → minimal fallback
 *      {role, content} (never throws, preserves role — E13 + E19 — GOTCHA #5).
 *   3. Return a NEW array with index i replaced (messages.map). Non-matched elements copied BY REFERENCE (never
 *      read/spread → throwing-Proxy-safe — GOTCHA #12).
 *
 * COMPOSITION (spec/06 §5:143, spec/08 E17): "Multiple shrinks same target → applied in seq order, last wins." This
 * is achieved NATURALLY by sequential application — NO special last-wins code (GOTCHA #7): each applyShrink
 * re-resolves against the CURRENT messages (the second call sees the already-shrunk message), matches it again
 * (by_tool_call_id is stable — the spread preserved toolCallId), and overwrites its content → last replacement wins.
 *
 * CONTRACT (spec/06 §1 pipeline, `messages = applyShrinkSafe(messages, m)`; filterPipeline T5.S1 calls THIS fn):
 *   - INPUT: `messages` (a real Pi AgentMessage[] assigns in with no cast via MessageLike[]), `marker`
 *     ({target, replacement, pinnedEntryId?} — a real markers.ts ShrinkMarker assigns in with NO cast; only the
 *     three fields applyShrink reads are in the structural type — GOTCHA #2), and OPTIONAL `branchEntries`
 *     (getBranch() DATA — needed only for the PINNED path; filterPipeline always passes it). NO import from
 *     markers.ts (Pi-free).
 *   - NO MATCH (resolve returns null, marker is a non-record, or messages is a non-array) → messages UNCHANGED
 *     (SAME reference) for the null/marker paths; non-array messages → [] (defensive, mirrors applyRewind/
 *     partitionIntoUnits — GOTCHA #4).
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-record marker → messages unchanged; no match → messages
 * unchanged (same ref); a throwing-Proxy MATCHED message → the {...orig} spread is try/caught with a minimal fallback
 * → NEVER throws (E13). Side-effect-free (never mutates `messages`). NO new imports (reuses MessageLike + ContentBlock
 * + isRecord/readOwn already in module scope; `grep -c '^import' src/transforms.ts` stays 0).
 *
 * @param messages       the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param marker         { target, replacement, pinnedEntryId? } (a real ShrinkMarker assigns in with no cast)
 * @param branchEntries  OPTIONAL root→leaf branch entries (getBranch() DATA); PINNED shrinks resolve by identity
 *                       via resolvePinnedShrink — absent → a pinned shrink no-ops this fire (live shrinks ignore it)
 * @returns a NEW array with the matched message's content substituted; the SAME array reference on a no-op
 */

/**
 * stampShrink — wrap a shrink's RAW replacement in the render-time `<context-shrunk>` awareness envelope (spec/06
 * §5.1; spec/08 E25). Gives the model a durable, in-context signal that a shrink occurred HERE — co-located with
 * the artifact it scans when deciding what else to reclaim, so it does not redundantly re-shrink already-compact
 * content (the original substring is gone after a shrink → a redundant same-target call resolves to nothing → the
 * tool returns an honest `Matched: no`).
 *
 * RENDER-ONLY: this wrapper is applied ONLY to the rendered content array emitted by applyShrink/applyShrinkAt; it
 * is NEVER persisted onto the marker. The marker's stored `replacement` field stays the raw model-authored summary
 * (audit / cancel target resolution / any future restore see it unwrapped — spec/04 §4, spec/05 §2). FIXED format
 * (not configurable); ~3 tokens, negligible vs. the context saved. A non-string/empty replacement still stamps
 * (yielding an empty-body envelope) — harmless and still signals "shrunk".
 */
const SHRUNK_OPEN = "<context-shrunk>";
const SHRUNK_CLOSE = "</context-shrunk>";
/** EXPORTED so tests + audit can reference the SAME render format (single source of truth — spec/06 §5.1). */
export function stampShrink(rep: string): string {
  return `${SHRUNK_OPEN}\n${rep}\n${SHRUNK_CLOSE}`;
}

export function applyShrink(
  messages: MessageLike[],
  marker: { target: ShrinkTarget; replacement: string; pinnedEntryId?: string },
  branchEntries?: BranchEntry[],
): MessageLike[] {
  // Defensive: non-array messages → [] (mirrors applyRewind/partitionIntoUnits); non-record marker → no-op (same ref).
  if (!Array.isArray(messages)) return [];
  if (!isRecord(marker)) return messages;

  // Resolve the target to a message index. PINNED-FIRST (FINDING 3 fix — mirrors rewind hideEntryIds): when the
  // marker carries a pinnedEntryId (the stable ENTRY id the target matched at creation), resolve by IDENTITY via
  // resolvePinnedShrink instead of re-resolving the live selector. This LOCKS the substitution to one message, so
  // by_tool_name+last / by_content_includes no longer drift onto later messages (the moving-target footgun). null
  // (pinned entry gone / no branchEntries / compaction) → no-op this fire — we deliberately do NOT fall back to live
  // resolution, matching the rewind precedent (identity-or-nothing). No pinnedEntryId → live resolution (backward
  // compat for old markers + targets that did not match at creation — compaction-robust; spec/06 §5:133).
  const pinnedId = readOwn(marker, "pinnedEntryId");
  let i: number | null;
  if (typeof pinnedId === "string" && pinnedId.length > 0) {
    i = Array.isArray(branchEntries) ? resolvePinnedShrink(messages, branchEntries, pinnedId) : null;
    if (i === null) return messages; // SAME reference (no-op — identity-or-nothing, like rewind)
  } else {
    // LIVE: read marker.target via readOwn (throwing-Proxy safe); cast — resolveShrinkTarget re-validates isRecord.
    i = resolveShrinkTarget(messages, readOwn(marker, "target") as ShrinkTarget);
  }
  if (i === null || i < 0 || i >= messages.length) return messages;

  const orig = messages[i];
  const rep = readOwn(marker, "replacement");
  const text = stampShrink(typeof rep === "string" ? rep : "");   // spec/06 §5.1 — render-time awareness stamp (raw replacement stays unstamped on the marker)
  const newContent: ContentBlock[] = [{ type: "text", text }];

  // Clone orig's fields via spread + override content. {...orig} preserves role/toolCallId/toolName/isError/customType/…
  // → pairing intact (toolResult keeps toolCallId — spec/06 §5:145) + role preserved (spec/08 E19). The spec §5 ternary
  // has identical branches → ONE expression (GOTCHA #11). try/catch: a throwing-Proxy orig could make {...orig} throw
  // → minimal fallback preserves the safely-read role (E13 + E19 — GOTCHA #5).
  const role = readOwn(orig, "role");
  let replacement: MessageLike;
  try {
    replacement = { ...(orig as MessageLike), content: newContent };
  } catch {
    replacement = { role: typeof role === "string" ? role : undefined, content: newContent };
  }

  // New array with index i replaced; other elements copied BY REFERENCE (never read → throwing-Proxy-safe — GOTCHA #12).
  return messages.map((m, j) => (j === i ? replacement : m));
}

/**
 * applyShrinkAt — substitute the message at a PRE-RESOLVED index with the marker's replacement text. This is the
 * COMPOSITION-RESOLVED twin of applyShrink's pinned branch: filterPipeline resolves the pinned target against the
 * ORIGINAL message list (aligned with branchEntries) and TRANSLATES that index onto the post-rewind reduced array; it
 * then hands the reduced index here for substitution. Used ONLY by filterPipeline's pinned-shrink-after-rewind path
 * (the fix for MAJOR-1b). Everything else routes through applyShrink (which resolves its own index).
 *
 * IDENTICAL substitution body to applyShrink (DRY-by-intent: the clone+override logic is duplicated rather than shared
 * via an extra parameter so applyShrink's tested public signature + behavior stay untouched — GOTCHA #11). Defensive +
 * total: non-array messages → []; non-record marker → messages UNCHANGED; out-of-range index → messages UNCHANGED
 * (same-ref no-op, mirroring applyShrink's spec/06 §5:133 contract). NEVER throws (throws → minimal role-preserving
 * fallback; E13 + E19). Pure: returns a NEW array on a hit (other elements copied BY REFERENCE — GOTCHA #12).
 *
 * @param messages the CURRENT (post-rewind) message list; non-array → []
 * @param marker   { replacement } (a real ShrinkMarkerLike structurally assigns in; only `replacement` is read here
 *                since the index is already resolved)
 * @param i        the pre-resolved reduced-array index of the message to substitute; out-of-range → no-op (same ref)
 * @returns a NEW array with index i substituted, or the SAME array reference on a no-op
 */
function applyShrinkAt(
  messages: MessageLike[],
  marker: { replacement?: unknown },
  i: number,
): MessageLike[] {
  if (!Array.isArray(messages)) return [];
  if (!isRecord(marker)) return messages;
  if (typeof i !== "number" || Number.isNaN(i) || i < 0 || i >= messages.length) return messages;

  const orig = messages[i];
  const rep = readOwn(marker, "replacement");
  const text = stampShrink(typeof rep === "string" ? rep : "");   // spec/06 §5.1 — render-time awareness stamp (DRY twin of applyShrink's; raw replacement stays unstamped on the marker)
  const newContent: ContentBlock[] = [{ type: "text", text }];

  // Clone orig's fields via spread + override content (pairing + role preserved — spec/06 §5:145 / spec/08 E19).
  // try/catch: a throwing-Proxy orig could make {...orig} throw → minimal fallback preserves the safely-read role.
  const role = readOwn(orig, "role");
  let replacement: MessageLike;
  try {
    replacement = { ...(orig as MessageLike), content: newContent };
  } catch {
    replacement = { role: typeof role === "string" ? role : undefined, content: newContent };
  }

  // New array with index i replaced; other elements copied BY REFERENCE (never read → throwing-Proxy-safe — GOTCHA #12).
  return messages.map((m, j) => (j === i ? replacement : m));
}

/**
 * Module-private: stringify a message's `content` for by_content_includes substring search (spec/06 §5 L128
 * "stringified content"). A string content → verbatim; an array content (content blocks) → JSON.stringify (so `text`
 * fields are searchable, e.g. `[{"type":"text","text":"ENOSPC at /disk"}]` includes "ENOSPC"); anything else
 * (undefined / throwing-Proxy / circular) → "". Wrapped in try/catch → never throws (JSON.stringify of a
 * throwing-Proxy/circular value returns "" via the catch). NOT exported.
 */
function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  return "";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// COMPOSITION CORE — filterPipeline + stableSortBySeq + protectedOk (P1.M3.T5.S1)
// The single PURE entry point the context handler (filter.ts, P1.M4.T2) calls:
// `return { messages: filterPipeline(event.messages, readMarkers(ctx), config, branchEntries) }`.
// Reuses partitionIntoUnits / resolveLastToolCallGroup / resolveLastTurn / resolveCheckpoint / applyRewind /
// applyShrink / ShrinkTarget / MessageLike / BranchEntry + the module-private isRecord / readOwn — all in scope.
// ZERO new imports (the module is Pi-FREE; `grep -c '^import'` stays 0). The four marker/config types are declared
// LOCALLY (structurally identical to markers.ts/config.ts exports — a real one assigns in with NO cast — GOTCHA #1).
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * RewindMarkerLike — the structural slice of a persisted RewindMarker that filterPipeline READS (spec/04 §3; spec/06
 * §1/§12). Declared LOCALLY (structurally identical to markers.ts's RewindMarker) so transforms.ts stays Pi-FREE
 * (0 imports — it must NOT import from markers.ts, which pulls in Pi). This mirrors the MessageLike / ShrinkTarget /
 * BranchEntry convention. A real markers.ts RewindMarker assigns in with NO cast. EXPORTED so filter.ts (P1.M4.T2),
 * the audit tool, and tests share one shape at the pure tier.
 *
 * NOTE: spec/04 §3 RewindMarker lists granularity as only the two relative literals, but spec/05 §1/§6 + config.ts's
 * Granularity union require "checkpoint"; and spec/04 §3 has NO `checkpoint` field though spec/06 §12 + spec/05 require
 * it for checkpoint granularity. This type includes BOTH (granularity union + optional checkpoint) — a real checkpoint
 * rewind marker (built by the rewind tool P1.M5.T1) assigns in; filterPipeline reads checkpoint defensively via readOwn
 * (absent → checkpoint rewind no-ops).
 */
export interface RewindMarkerLike {
  /** Monotonic per-session counter (runtime.ts nextSeq); orders markers oldest-first (stableSortBySeq). */
  seq: number;
  /** The targeting spec the filter resolves each inference (config.ts Granularity union). */
  granularity: "last_tool_call_group" | "last_turn" | "checkpoint";
  /** Legacy v1.0 field; ignored by the v1.1 resolver (last_turn always keeps the latest user message by
   * construction). Kept optional for backward-compat reads of old persisted markers. */
  options?: { to_previous_prompt?: boolean };
  /** toolCallId of THIS rewind's own tool call (filter skips its group for last_tool_call_group; keeps its unit for
   *  last_turn/checkpoint). Absent/empty/non-string → not skipped/kept. */
  excludeToolCallId?: string;
  /**
   * Stable entry IDs of the messages to hide, pinned at marker-creation time (fix_design.md §Change 1). filterPipeline
   * dispatches on this FIRST: when it is a non-empty array, resolvePinnedHide maps the IDs → current message indices
   * and removes them (permanent hiding across session growth — fixes BUG-001/BUG-002). Absent/empty (old markers, or
   * capture failure) → falls back to granularity-based relative re-resolution (backward compat). Read defensively via
   * readOwn(rw,"hideEntryIds"). OPTIONAL. Holds ENTRY ids (stable), NOT message indices (which shift on compaction).
   */
  hideEntryIds?: string[];
  /** checkpoint only — the checkpoint name (without the mulligan:checkpoint: prefix). Absent → checkpoint rewind no-ops. */
  checkpoint?: string;
}

/**
 * ShrinkMarkerLike — the structural slice of a persisted ShrinkMarker that filterPipeline READS + ORDERS (spec/04 §4;
 * spec/06 §5). Structurally identical to markers.ts's ShrinkMarker minus the envelope/id/ts/reason; adds `seq` (which
 * applyShrink's {target, replacement} param does not name) so stableSortBySeq can order shrinks oldest-first. A real
 * ShrinkMarker assigns in with NO cast; ShrinkMarkerLike is ASSIGNABLE to applyShrink's {target, replacement} param
 * (extra `seq` is fine for a non-literal argument — GOTCHA #4). EXPORTED.
 */
export interface ShrinkMarkerLike {
  seq: number;
  target: ShrinkTarget;
  replacement: string;
  /**
   * Stable ENTRY id the target matched at marker-creation time (FINDING 3 — pinned shrink). When present, applyShrink
   * resolves the target by IDENTITY via resolvePinnedShrink (needs `branchEntries`, which filterPipeline passes) — the
   * substitution locks to ONE message forever (no moving-target drift). Mirrors RewindMarkerLike.hideEntryIds.
   * Absent → live re-resolution (backward compat / compaction-robust). OPTIONAL. Read via readOwn(sh,"pinnedEntryId").
   */
  pinnedEntryId?: string;
}

/**
 * MarkerBundle — the marker set filterPipeline transforms (spec/06 §1 readMarkers output, MINUS the turn-metric which
 * the nudge injector consumes — NOT this pipeline). rewinds are applied oldest-first (stableSortBySeq) BEFORE shrinks
 * (spec/03 §5; spec/06 §1/§12). EXPORTED so filter.ts (P1.M4.T2) types its readMarkers return + tests build typed fixtures.
 */
export interface MarkerBundle {
  rewinds: RewindMarkerLike[];
  shrinks: ShrinkMarkerLike[];
}

/**
 * ProtectedConfig — the structural slice of MulliganConfig that protectedOk READS (spec/06 §8; spec/04 §7
 * config.rewind.protectedRoles). Declared LOCALLY (a real MulliganConfig from config.ts assigns in with NO cast) so
 * transforms.ts stays Pi-FREE (0 imports — config.ts is Pi-free BUT importing it would break the foundational 0-import
 * invariant). v1 protectedRoles selectors: "first:user", "latest:user". EXPORTED.
 */
export interface ProtectedConfig {
  rewind: { protectedRoles: string[] };
}

/**
 * stableSortBySeq — return a NEW array of markers sorted ASCENDING by `seq` (oldest-first), preserving input order for
 * equal seq (stable). seq is a monotonic per-session counter (runtime.ts nextSeq — ties impossible by construction, but
 * the sort is stable regardless). Used by filterPipeline to apply rewinds then shrinks oldest-first (spec/06 §1
 * "stableSortBySeq orders markers by their seq"; spec/03 §5 "oldest marker first … later rewinds resolve against the
 * already-reduced array").
 *
 * Defensive + TOTAL: a non-array `markers` → []; a marker whose seq is not a finite number is treated as 0 (sorted
 * first); a throwing-Proxy marker's seq is read via readOwn (never throws — E13). NEVER mutates the input (returns a
 * shallow copy via [...markers]; the marker OBJECTS are shared by reference — filterPipeline does not mutate them).
 *
 * @param markers the marker array (rewinds OR shrinks); non-array → []
 * @returns a NEW array, sorted ascending by seq (stable); the input array is unchanged
 */
export function stableSortBySeq<T extends { seq?: unknown }>(markers: T[]): T[] {
  if (!Array.isArray(markers)) return [];
  // Shallow copy (do NOT mutate the input) then stable ascending sort by seq. Array.prototype.sort is stable in Node
  // (ES2019-mandated) so equal-seq markers keep input order (ties impossible by construction, but stable regardless).
  return [...markers].sort((a, b) => readOwnSeq(a) - readOwnSeq(b));
}

/** Module-private: read a marker's `seq` as a finite number (0 if missing/non-finite/throwing-Proxy). Never throws. */
function readOwnSeq(marker: unknown): number {
  const s = readOwn(marker, "seq");
  return typeof s === "number" && Number.isFinite(s) ? s : 0;
}

/**
 * protectedOk — the FILTER's defense-in-depth protected-message check for a rewind's removal set (spec/06 §8; spec/03
 * §3). Returns true when the rewind is ALLOWED to remove `remove`; false when it must be SKIPPED (the pipeline no-ops
 * the rewind; filter.ts logs a warn).
 *
 * RULE (spec/06 §8, verbatim): "compute iFirstUser and iLatestUser in messages. A rewind's remove set MUST satisfy
 * min(remove) > iFirstUser." This function enforces the FIRST:USER boundary — a rewind may not remove the original-task
 * user message (or anything at/before it). The LATEST:USER boundary is enforced BY CONSTRUCTION in resolveLastTurn
 * (the removal loop starts at iLastUser + 1, so the latest user message is never in `remove` — v1.1 guardrail,
 * spec/13 §1). protectedOk is the filter's DOUBLE-CHECK (spec/06 §8 "the filter double-checks and no-ops as
 * defense-in-depth") so a buggy/adversarial resolver cannot cross the line (GOTCHA #7: the real resolvers never cross
 * iFirstUser by construction, so this block is defense-in-depth).
 *
 * v1 config.rewind.protectedRoles supports exactly ["first:user","latest:user"] (spec/04 §7; config.ts KNOWN set). This
 * function honors "first:user" when present (the default — always present in a valid config). An empty/absent/malformed
 * protectedRoles → STILL enforce first:user (FAIL SAFE: when in doubt, protect the original task — never silently remove
 * it — GOTCHA #10). A non-empty protectedRoles that explicitly OMITS "first:user" → protection disabled (→ true). NEVER
 * throws (every read via isRecord/readOwn).
 *
 * @param messages the CURRENT message list (a real Pi AgentMessage[] assigns in); non-array → true (vacuous)
 * @param remove the rewind's removal index set; empty/non-array → true (nothing to remove → vacuously ok)
 * @param config the config slice (rewind.protectedRoles); missing/malformed → enforce first:user (fail safe)
 * @returns true if the rewind may proceed; false if it must be skipped (crosses the first:user boundary)
 */
export function protectedOk(
  messages: MessageLike[],
  remove: number[],
  config: ProtectedConfig | undefined,
): boolean {
  // Nothing to remove → vacuously allowed (resolver returned [] — a no-op/refused rewind).
  if (!Array.isArray(remove) || remove.length === 0) return true;
  if (!Array.isArray(messages)) return true; // vacuous (filterPipeline guards non-array → [] upstream)

  // Does the config protect the FIRST user message? Default YES (v1 always includes "first:user"). FAIL SAFE: enforce
  // UNLESS protectedRoles is a NON-EMPTY array that explicitly OMITS "first:user" (GOTCHA #10).
  let protectFirstUser = true;
  const rewindCfg = isRecord(config) ? readOwn(config, "rewind") : undefined;
  const roles = isRecord(rewindCfg) ? readOwn(rewindCfg, "protectedRoles") : undefined;
  if (Array.isArray(roles) && roles.length > 0) {
    protectFirstUser = roles.some((r) => r === "first:user");
  }
  if (!protectFirstUser) return true; // config explicitly disables first:user protection → allow

  // iFirstUser = index of the FIRST "user" message (the original task).
  let iFirstUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") {
      iFirstUser = i;
      break;
    }
  }
  if (iFirstUser === -1) return true; // no user message → nothing protected by first:user → allow

  // min(remove) MUST be > iFirstUser (spec/06 §8). Non-number/NaN entries are ignored (never a valid array index).
  let minRemove = Infinity;
  for (const r of remove) {
    if (typeof r === "number" && !Number.isNaN(r) && r < minRemove) minRemove = r;
  }
  if (!Number.isFinite(minRemove)) return true; // no numeric remove entries → vacuous
  return minRemove > iFirstUser;
}

/**
 * RewindDiag — one entry per rewind marker per context fire, pushed into the OPTIONAL `diag` sink passed to
 * filterPipeline (BUG: turn-replay-loop invariant log). Pure data; filter.ts reads it to WARN when a rewind hides
 * the freshest messages (the replay signature). EXPORTED so filter.ts types its sink + tests can assert on it.
 */
export interface RewindDiag {
  /** The marker's seq (monotonic; orders markers oldest-first). Identifies WHICH marker acted. */
  seq: number;
  /** The marker's granularity, if readable. */
  granularity?: string;
  /** How this rewind was resolved this fire:
   *  - "pinned"               hideEntryIds present → resolvePinnedHide (the production path; only ever touches the OLD pinned span).
   *  - "legacy-run"           no pin + creating/resume fire (turnHasAdvanced false) → the relative resolver ran (intended, single fire).
   *  - "legacy-noop-advanced" no pin + the turn advanced past the rewind's own toolGroup → NO-OP (the replay guard fired).
   *  - "unknown-noop"         unrecognized granularity → no-op. */
  mode: "pinned" | "legacy-run" | "legacy-noop-advanced" | "unknown-noop";
  /** Message indices this rewind removed, resolved against the array of length `resolvedLen` (the already-reduced m at
   *  dispatch — rewinds run oldest-first, so later rewinds see a shorter array). Empty = no-op this fire. */
  remove: number[];
  /** Length of the array `remove` was resolved against (interprets the indices; max(remove) near resolvedLen-1 = the
   *  freshest work was targeted = the replay signature). */
  resolvedLen: number;
}

/**
 * ownGroupEndIndex — the max message index of the toolGroup that issued `excludeToolCallId` (this rewind's OWN
 * toolGroup: the assistant message carrying the mulligan_rewind call + its result). Used by `turnHasAdvanced` to anchor
 * "has the turn advanced past this rewind?". Returns -1 when `excludeToolCallId` is absent/empty/non-string, when
 * `messages` is not an array, or when no toolGroup issued that id (the rewind's own call isn't present — e.g. it was
 * itself removed by an earlier rewind in this pass). Pure + defensive (reuses partitionIntoUnits + assistantIssuedCall
 * + isRecord/readOwn; never throws — E13). Module-private.
 */
function ownGroupEndIndex(messages: MessageLike[] | unknown, excludeToolCallId?: string): number {
  if (!Array.isArray(messages)) return -1;
  if (typeof excludeToolCallId !== "string" || excludeToolCallId.length === 0) return -1;
  const units = partitionIntoUnits(messages);
  let end = -1;
  for (const unit of units) {
    if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
      end = Math.max(end, ...unit.indices); // the rewind's own group may have results after the assistant
    }
  }
  return end;
}

/**
 * turnHasAdvanced — SAFETY predicate for the legacy relative-resolution fallback (BUG: turn-replay-loop).
 * Returns true ("the turn has advanced past this rewind; do NOT re-resolve relatively") when EITHER the rewind's own
 * toolGroup cannot be located (no excludeToolCallId / not present) OR any NON-`mulligan:*` message follows it. Returns
 * false only when the rewind's own toolGroup is present and the only messages after it are `mulligan:*` notes/nudges —
 * i.e. this is the creating/resume fire, before the agent appends new work. Pure + defensive; never throws (E13).
 * Module-private.
 */
function turnHasAdvanced(messages: MessageLike[] | unknown, excludeToolCallId?: string): boolean {
  const end = ownGroupEndIndex(messages, excludeToolCallId);
  if (end < 0) return false; // can't locate the rewind's own group (absent/no-match excludeToolCallId) → assume the
  //   creating/resume fire and ALLOW the legacy resolver. Production markers ALWAYS carry excludeToolCallId AND
  //   hideEntryIds (→ the PINNED branch, never here), so this only affects degenerate/old markers; the replay guard
  //   below is what protects the realistic legacy case (excludeToolCallId present + new work appended after it).
  for (let j = end + 1; j < (messages as MessageLike[]).length; j++) {
    if (!isMulliganCustomMessage((messages as MessageLike[])[j])) return true; // new non-note work appended
  }
  return false; // only mulligan:* notes follow → creating/resume fire, safe to resolve relatively
}

/**
 * filterPipeline — Mulligan's composition core: apply persisted markers to a message list, returning the filtered view
 * the model sees (spec/06-context-filter.md §1, §5, §8, §11, §12; spec/03 §5 ordering/composition/idempotency). The
 * single PURE entry point the context handler (filter.ts, P1.M4.T2) calls: `return { messages: filterPipeline(...) }`.
 *
 * ORDER (FIXED — spec/03 §5; spec/06 §1/§12):
 *   1. REWINDS oldest-first (stableSortBySeq). For each rewind: resolve its removal set by granularity AGAINST THE
 *      CURRENT (already-reduced) array, check protectedOk (defense-in-depth — skip on false), then applyRewind
 *      (gap-closing index removal). Each rewind mutates the working array; later rewinds resolve against the
 *      already-reduced array (spec/03 §5).
 *   2. SHRINKS oldest-first (stableSortBySeq), on the post-rewind array: applyShrink per marker (content substitution).
 *   3. Return the array. (Nudge injection — spec/06 §1 step 3 / §12 — is filter.ts's concern, NOT this pure pipeline;
 *      filterPipeline transforms markers ONLY. GOTCHA #13.)
 *
 * GRANULARITY DISPATCH (fix_design.md §Change 4 — PINNED FIRST, then granularity legacy):
 *   - PINNED (hideEntryIds present + non-empty): NEW markers carry stable ENTRY ids pinned at marker-creation time
 *     (captureHideEntryIds, P1.M2.T3) for PERMANENT soft-delete hiding (fixes BUG-001 leak-back + BUG-002 infinite
 *     loop). resolvePinnedHide(m, branchEntries, hideEntryIds) maps those stable ids → current message indices by
 *     IDENTITY (not position) → the hidden set is invariant across session growth: the originally-hidden mistake stays
 *     hidden every fire; the agent's NEW work (new entries, new ids NOT in the pinned set) stays visible. Pairing-safe
 *     by construction (producer pins whole-unit ids). On compaction/alignment REFUSAL it returns [] (NOT null) →
 *     applyRewind(m,[]) is the idempotent no-op THIS fire; the marker persists and retries next fire. A refused pinned
 *     hide MUST NOT fall back to the relative branches (that re-introduces the bug) — enforced by control flow (the
 *     length>0 gate already fired, so the else-if chain is skipped). Backward compat: old markers / K=0 / capture-
 *     failure (hideEntryIds absent or []) fall through to the granularity branches below.
 *   - "last_tool_call_group" (LEGACY FALLBACK): RE-PARTITION the current array FRESH (partitionIntoUnits(m)), then
 *     resolveLastToolCallGroup(units, m, excludeToolCallId). (The §12 pseudocode partitions ONCE before the loop — a
 *     stale-index bug after the first rewind reduces m, because resolveLastToolCallGroup returns unit.indices that index
 *     the partitioned array. Re-partitioning each iteration keeps them valid against the current m.)
 *   - "last_turn": resolveLastTurn(m, excludeToolCallId).remove. (v1.1: the resolver keeps the latest user
 *     message by construction — no options read; spec/13 §1.)
 *   - "checkpoint": resolveCheckpoint(m, branchEntries ?? [], rw.checkpoint, excludeToolCallId)?.remove ?? []. (Takes
 *     branchEntries DATA, NOT ctx — GOTCHA #6.)
 *
 * IDEMPOTENCY (spec/03 §5; spec/06 §11): re-firing the pipeline on the SAME input reproduces the SAME output
 * (deterministic — the spec's "re-firing on the same session reproduces the same result"). Shrinks are STRICTLY
 * idempotent under filterPipeline∘filterPipeline (re-substituting the same replacement = same result). Rewinds are
 * idempotent in the common single-mistake case (after removal, no further non-excluded group remains → second pass
 * no-ops); the general filterPipeline(filterPipeline(m))===filterPipeline(m) does NOT hold for multi-group
 * last_tool_call_group rewinds under live re-resolution (GOTCHA #8). See research/verification.md §4.
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-record markers → pass-through (rewinds/shrinks default to []);
 * protectedOk false → rewind skipped (no throw); a throwing-Proxy message never crashes (every read via
 * isRecord/readOwn; applyRewind never reads message internals; applyShrink is already try/caught — GOTCHA #12).
 * Side-effect-free (never mutates `messages` or the markers). NO new imports (reuses everything already in module
 * scope; the Pi-free `grep -c '^import'` invariant stays 0).
 *
 * @param messages      the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param markers       { rewinds, shrinks } (a real readMarkers output assigns in); undefined/non-record → pass-through
 * @param config        the config slice protectedOk reads (rewind.protectedRoles); undefined → enforce first:user
 * @param branchEntries getBranch() output for checkpoint rewinds (root→leaf — getBranch() order); optional — absent → checkpoint no-ops
 * @returns the filtered message array; the SAME reference as `messages` when no marker transforms anything
 */
export function filterPipeline(
  messages: MessageLike[],
  markers: MarkerBundle | undefined,
  config: ProtectedConfig | undefined,
  branchEntries?: BranchEntry[],
  /** OPTIONAL diagnostics sink (BUG: turn-replay-loop invariant log). When passed, one RewindDiag is pushed per
   *  rewind marker each fire (mode + remove-index set + the length of the array it resolved against). Pure: the sink
   *  is only appended to, never read; omit it (the whole unit-test suite does) for zero overhead. */
  diag?: RewindDiag[],
): MessageLike[] {
  // Defensive: a non-array messages → [] (mirrors partitionIntoUnits/applyRewind/applyShrink).
  if (!Array.isArray(messages)) return [];

  // Read the marker arrays defensively (non-record markers / missing arrays → []).
  const bundle = isRecord(markers) ? markers : undefined;
  const rewindsRaw = bundle ? readOwn(bundle, "rewinds") : undefined;
  const shrinksRaw = bundle ? readOwn(bundle, "shrinks") : undefined;
  const rewinds: RewindMarkerLike[] = Array.isArray(rewindsRaw) ? (rewindsRaw as RewindMarkerLike[]) : [];
  const shrinks: ShrinkMarkerLike[] = Array.isArray(shrinksRaw) ? (shrinksRaw as ShrinkMarkerLike[]) : [];

  // ── COMPOSITION MODEL (composition-bug fix: pinned markers are IDENTITY-based, so they resolve against the
  //    ORIGINAL message list and their effects UNION — they are INDEPENDENT of one another and of relative position.
  //    The legacy relative resolvers, by contrast, are POSITION-based and MUST resolve against the reducing array per
  //    spec/03 §5 — those stay sequential. The prior implementation ran EVERY rewind (incl. pinned) in one sequential
  //    loop against the gap-closing `m`; after the first rewind shrank `m`, a later pinned rewind's branchEntries walk
  //    misaligned (msgCursor+y > m.length) and refused → only the OLDEST pinned marker applied. Same defect broke a
  //    pinned shrink whose target lived after a rewind's span: it walked the full branch against the shortened `m`
  //    and no-op'd. The fix: PINNED rewinds + PINNED shrinks resolve by identity against the ORIGINAL `messages`, and
  //    their index sets / substitution targets are TRANSLATED onto the reduced array via the index map maintained
  //    below. Legacy rewinds stay sequential on `m`, exactly as before.) ──
  let m = messages;

  // reducedToOrig[k] === the ORIGINAL-array index of the message currently at reduced position k. Tracked across every
  // rewind (pinned OR legacy) so that (a) a legacy rewind's reduced-space `remove` indices can be recorded in original
  // space (for shrink target-removal detection), and (b) a pinned shrink's original-space target index can be mapped
  // to its current reduced position (or detected as removed). Ascending by construction; rebuilt on each removal.
  let reducedToOrig: number[] = messages.map((_v, i) => i);

  // removedOrig — ORIGINAL-array indices dropped by ANY rewind this fire. A pinned shrink whose original-space target
  // is in this set NO-OPS (its target was already removed — spec/06 §5:143 "shrink after rewind-removed-target … no-ops").
  const removedOrig = new Set<number>();

  const orderedRewinds = stableSortBySeq(rewinds);
  const branch = Array.isArray(branchEntries) ? branchEntries : [];

  // 1a) PINNED REWINDS FIRST — resolve EVERY pinned rewind against the ORIGINAL `messages` (the only array 1:1-aligned
  //     with the full branchEntries), UNION their removal-index sets, then apply ONE applyRewind. This is the fix for
  //     MAJOR-1a (two pinned rewinds / N pinned rewinds collapse to only the oldest): because all pinned resolvers see
  //     the SAME unreduced array, their walks never misalign, and the union hides every pinned span. diag.resolvedLen
  //     for pinned rewinds is messages.length (the array their indices are relative to — matches the single-rewind case).
  const pinnedRemove: number[] = [];
  for (const rw of orderedRewinds) {
    const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");
    if (!(Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0)) continue; // LEGACY — handled in phase 1b
    const granularity = readOwn(rw, "granularity");
    const remove = resolvePinnedHide(messages, branch, hideEntryIdsRaw as string[]);

    if (Array.isArray(diag)) {
      diag.push({
        seq: readOwnSeq(rw),
        granularity: typeof granularity === "string" ? granularity : undefined,
        mode: "pinned",
        remove: remove.slice(),
        resolvedLen: messages.length,
      });
    }

    // Defense-in-depth: skip rewinds that cross the protected first:user boundary (checked against the ORIGINAL array,
    // which is where the pinned indices live). A refused rewind contributes nothing to the union.
    if (!protectedOk(messages, remove, config)) continue;

    for (const idx of remove) pinnedRemove.push(idx);
  }
  if (pinnedRemove.length > 0) {
    m = applyRewind(m, pinnedRemove);
    const drop = new Set(pinnedRemove);
    for (const idx of pinnedRemove) removedOrig.add(idx);
    reducedToOrig = reducedToOrig.filter((_orig, i) => !drop.has(i));
  }

  // 1b) LEGACY REWINDS — old markers WITHOUT hideEntryIds (capture-failed / pre-pinning). POSITION-based: each resolves
  //     against the CURRENT (post-pinned-removal) `m`, gated by turnHasAdvanced (the replay guard). Per spec/03 §5 a
  //     later rewind resolves against the already-reduced list, so these stay sequential on `m`. (Production markers
  //     ALWAYS carry hideEntryIds → phase 1a → never here; this loop only affects the rare old/capture-failed marker.)
  for (const rw of orderedRewinds) {
    const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");
    if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) continue; // PINNED — handled in phase 1a
    const granularity = readOwn(rw, "granularity");
    const excludeRaw = readOwn(rw, "excludeToolCallId");
    const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;
    const advanced = turnHasAdvanced(m, excludeId);
    let remove: number[];
    let mode: RewindDiag["mode"];
    if (advanced) {
      // SAFETY (BUG: turn-replay-loop): the turn advanced past this rewind's own toolGroup → the relative resolvers
      // would re-target the agent's NEW work every fire and replay the turn. No-op instead.
      remove = [];
      mode = "legacy-noop-advanced";
    } else if (granularity === "last_tool_call_group") {
      // CREATING/RESUME FIRE ONLY: relative re-resolution. RE-PARTITION fresh so unit.indices index the CURRENT m.
      const units = partitionIntoUnits(m);
      remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
      mode = "legacy-run";
    } else if (granularity === "last_turn") {
      // CREATING/RESUME FIRE ONLY. last_turn no longer reads options — the resolver keeps the latest user
      // message by construction (v1.1 guardrail, spec/13 §1).
      remove = resolveLastTurn(m, excludeId).remove;
      mode = "legacy-run";
    } else if (granularity === "checkpoint") {
      // CREATING/RESUME FIRE ONLY. resolveCheckpoint takes branchEntries DATA, not ctx (GOTCHA #6).
      const cpRaw = readOwn(rw, "checkpoint");
      const cpName = typeof cpRaw === "string" ? cpRaw : "";
      remove = resolveCheckpoint(m, branch, cpName, excludeId)?.remove ?? [];
      mode = "legacy-run";
    } else {
      remove = []; // unknown granularity → no-op
      mode = "unknown-noop";
    }

    if (Array.isArray(diag)) {
      diag.push({
        seq: readOwnSeq(rw),
        granularity: typeof granularity === "string" ? granularity : undefined,
        mode,
        remove: remove.slice(),
        resolvedLen: m.length,
      });
    }

    // Defense-in-depth: skip rewinds that cross the protected first:user boundary. (filter.ts logs the warn.)
    if (!protectedOk(m, remove, config)) continue;
    if (remove.length === 0) continue;

    // Record the removed ORIGINAL indices (for pinned-shrink target-removal detection) BEFORE gap-closing, via the
    // current reducedToOrig map. A legacy rewind's `remove` indices are in reduced-array space; map each to its origin.
    for (const j of remove) {
      if (j >= 0 && j < reducedToOrig.length) removedOrig.add(reducedToOrig[j]);
    }
    m = applyRewind(m, remove);
    const dropSet = new Set(remove);
    reducedToOrig = reducedToOrig.filter((_orig, i) => !dropSet.has(i));
  }

  // 2) SHRINKS, oldest-first (stableSortBySeq), on the post-rewind array. applyShrink is defensive + total.
  //    `branchEntries` is passed so PINNED shrinks (FINDING 3 — pinnedEntryId) can resolve by identity via
  //    resolvePinnedShrink; live shrinks ignore it. (A real ShrinkMarkerLike is structurally assignable to applyShrink's
  //    {target, replacement, pinnedEntryId?} param — GOTCHA #4.)
  //
  //    COMPOSITION FIX (MAJOR-1b — pinned shrink after a rewind): a pinned shrink resolves its target by IDENTITY
  //    against branchEntries, which is 1:1-aligned ONLY with the ORIGINAL `messages`, NOT the post-rewind reduced `m`.
  //    So we resolve the pinned id against `messages` (original space); if that original index was removed by ANY
  //    rewind this fire, the shrink no-ops (target gone — spec/06 §5:143). Otherwise we substitute at the TRANSLATED
  //    reduced-array index (binary search of reducedToOrig — it is ascending). Live shrinks resolve against `m` as
  //    before (no identity, no branchEntries alignment requirement).
  for (const sh of stableSortBySeq(shrinks)) {
    const pinnedId = readOwn(sh, "pinnedEntryId");
    if (typeof pinnedId === "string" && pinnedId.length > 0) {
      // PINNED: resolve against the ORIGINAL messages (aligned with branchEntries). null/absent → no-op this fire
      // (identity-or-nothing — the rewind precedent; NEVER fall back to live resolution).
      const origIdx = resolvePinnedShrink(messages, branch, pinnedId);
      if (origIdx === null) continue;
      if (removedOrig.has(origIdx)) continue; // target removed by a rewind → no-op (spec/06 §5:143)
      // Translate original index → reduced index. reducedToOrig is ascending; binary search for origIdx.
      let lo = 0;
      let hi = reducedToOrig.length - 1;
      let reducedIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = reducedToOrig[mid];
        if (v === origIdx) { reducedIdx = mid; break; }
        if (v < origIdx) lo = mid + 1; else hi = mid - 1;
      }
      if (reducedIdx < 0) continue; // defensively not found (shouldn't happen post removedOrig check) → no-op
      m = applyShrinkAt(m, sh, reducedIdx);
    } else {
      // LIVE: re-resolve the selector against the current reduced `m` (compaction-robust; spec/06 §5).
      m = applyShrink(m, sh, branchEntries);
    }
  }

  return m;
}