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
 * ALGORITHM (spec/06 §4, steps 1–3):
 *   1. Find iLastUser = index of the last "user" message. If none → { remove: [] } (nothing to rewind — protected).
 *   2. DEFAULT (opts.to_previous_prompt !== true): KEEP the user message; remove every message AFTER iLastUser
 *      EXCEPT (a) the rewind's OWN unit (the assistant message that issued `excludeToolCallId` + its results —
 *      partitioned via partitionIntoUnits, detected via assistantIssuedCall from S1), and (b) any `mulligan:*`
 *      custom messages at the tail (the note MUST survive so the resumed model reads it). The surviving tail is
 *      [user message] + [mulligan:note] + [rewind assistant + result]; the model resumes at the current prompt.
 *   3. NUCLEAR (opts.to_previous_prompt === true): ALSO remove the user message at iLastUser (plus the same
 *      after-iLastUser removal with the same exclusions). The model resumes at the PREVIOUS user prompt. REFUSED
 *      (returns { remove: [] }) when iLastUser is the FIRST user message (iFirstUser === iLastUser) — that would
 *      cross the protected first-user / original-task boundary (spec/06 §8, spec/08 E3). The default case is always
 *      protected-safe by construction (min(remove) > iLastUser >= iFirstUser).
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
 * `filterPipeline` (P1.M3.T5.S1) uses `remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove`
 * (spec/06 §12). `rw.options` carries `to_previous_prompt` (snake_case — the persisted marker field, spec/04 §3);
 * this function reads it VERBATIM (NOT spec/06 §4's `toPreviousPrompt`, which is a spec typo — see D1).
 *
 * Pure + defensive: a non-array `messages` → { remove: [] }; malformed messages, throwing-Proxy messages, a
 * non-string/empty `excludeToolCallId`, and malformed `opts` are all handled gracefully — NEVER throws (E13;
 * context-handler hot path). Every field read goes through the module-private isRecord/readOwn.
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → { remove: [] }
 * @param opts { to_previous_prompt?: boolean } — the rewind marker's options, passed verbatim by filterPipeline
 * @param excludeToolCallId the rewind's own toolCall id (its unit is kept); undefined/empty/non-string → not kept
 * @returns { remove: number[] } — ascending message indices to remove; [] for no-op/refusal
 */
export function resolveLastTurn(
  messages: MessageLike[],
  opts: { to_previous_prompt?: boolean } | undefined,
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

  const nuclear = opts !== undefined && opts.to_previous_prompt === true;

  // 3) Nuclear protected check: refuse if iLastUser is the FIRST user message (would cross the original-task line).
  if (nuclear) {
    let iFirstUser = -1;
    for (let i = 0; i < messages.length; i++) {
      if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") {
        iFirstUser = i;
        break;
      }
    }
    if (iFirstUser === iLastUser) return { remove: [] }; // nuclear refused (spec/06 §8, spec/08 E3)
  }

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

  // 4) Build the removal set, ASCENDING. Nuclear removes iLastUser too (pushed first); then every index > iLastUser
  //    except the rewind's own unit and mulligan:* custom messages.
  const remove: number[] = [];
  if (nuclear) remove.push(iLastUser);
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
 *   2. Find the FIRST LabelEntry (scanning branchEntries leaf→root = most-recent) whose
 *      label === `mulligan:checkpoint:${checkpointName}`. None → null (spec/08 E10 not-found → refuse). targetId =
 *      its targetId; non-string/empty → null.
 *   3. ctxEntries = [...branchEntries].reverse() (root→leaf) filtered to context-producing types
 *      (message, custom_message, branch_summary, compaction — spec/06 §6 step 2).
 *   4. Walk ctxEntries with msgCursor (messages consumed). For each entry: yield = entryMessageYield(entry);
 *      yield < 0 (compaction/unknown → indeterminate) OR msgCursor+yield > messages.length (alignment lost) → null.
 *      If entry.id === targetId → iTarget = msgCursor + yield - 1 (the entry's LAST message index — kept); break.
 *      Else msgCursor += yield. Loop end without match → null (targetId labels a non-context-producing entry).
 *   5. remove (ascending): for j from iTarget+1..end, skip if rewindOwnIndices.has(j) (the rewind's own unit via
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
 * @param branchEntries getBranch() output, LEAF→ROOT (we reverse to root→leaf internally); non-array → null
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

  // 2) Find the FIRST (most-recent, leaf→root) LabelEntry with the matching label.
  let targetId: string | undefined;
  for (const e of branchEntries) {
    if (!isRecord(e)) continue;
    if (readOwn(e, "type") !== "label") continue;
    if (readOwn(e, "label") !== needle) continue;
    const tid = readOwn(e, "targetId");
    if (typeof tid === "string" && tid.length > 0) {
      targetId = tid;
      break; // most-recent match wins
    }
  }
  if (targetId === undefined) return null; // not found on this branch (spec/08 E10) or no usable targetId → refuse

  // 3) ctxEntries = reversed (root→leaf) filtered to context-producing types (spec/06 §6 step 2).
  const ctxEntries = [...branchEntries].reverse().filter((e) =>
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

  // 5) remove = indices > iTarget, EXCEPT the rewind's own unit + mulligan:* notes (IDENTICAL to resolveLastTurn).
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    for (const unit of partitionIntoUnits(messages)) {
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