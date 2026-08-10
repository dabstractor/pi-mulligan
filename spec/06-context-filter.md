# 06 — The context filter (core algorithm)

> This is the heart of Mulligan. It specifies, in implementable detail, how the `context` event handler transforms `event.messages` given the persisted markers. **All transform logic lives in pure functions** (`transforms.ts`) that take `(messages, marker, config)` and return a new array — fully unit-testable without Pi. The `context` handler itself (`filter.ts`) is thin glue: read markers, call the pure pipeline, return `{ messages }`, fail-open on any error.

---

## 1. The handler (glue)

```ts
pi.on("context", async (event, ctx) => {
  const rt = runtime(ctx);                       // per-session runtime (seq, baseline, lastFiltered)
  try {
    const config = getConfig();
    if (!config.enabled) return;                  // master switch off → pass through

    const markers = readMarkers(ctx);             // { rewinds: RewindMarker[], shrinks: ShrinkMarker[], metric: TurnMetric | null }
    let messages = event.messages as AgentMessage[];

    // 1) rewinds, oldest-first
    for (const m of stableSortBySeq(markers.rewinds)) {
      messages = applyRewindSafe(messages, m, config, ctx);
    }
    // 2) shrinks, oldest-first
    for (const m of stableSortBySeq(markers.shrinks)) {
      messages = applyShrinkSafe(messages, m);
    }
    // 3) nudge injection
    if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
      messages = injectNudge(messages, markers.metric);
    }

    rt.lastFiltered = messages;                   // cache for mulligan_audit (§7)
    rt.lastFilterTs = Date.now();
    return { messages };
  } catch (e) {
    log("error", "filter.fire", ctx, { error: String(e) });
    return;                                       // fail-open: pass through unchanged
  }
});
```

`stableSortBySeq` orders markers by their `seq` (monotonic per-session counter); ties impossible by construction. Ordering oldest-first means earlier decisions are applied first, so a later rewind resolves against an already-reduced list (correct composition).

**Marker retraction (cancel-drop).** `readMarkers` also scans `mulligan:cancel` control entries. Each carries a `targetId` naming the uuid `id` of the rewind/shrink marker being retired. That uuid is the covering marker's `id` — resolved by the `mulligan_cancel` **tool** from the agent's target hint (or explicit `markerId`) per `@05-tools.md` §5; the filter side is unchanged and keys only on the uuid, so this drop logic is identical whether the agent cancelled by hint or by id. After the scan, `readMarkers` drops any rewind/shrink whose `id` is in the collected `cancelledIds` set, so the retired marker no longer applies on subsequent `context` fires (spec/08 E21; amends D6). The drop is order-independent (a full scan precedes the filter), cancels with a non-string/empty `targetId` are skipped, and a marker whose `id` is unreadable is kept (defensive). Cancelled markers stay on disk (audit trail) — they are simply skipped going forward; the returned `MarkersBundle` exposes `cancelledIds: Set<string>` so the pipeline only ever sees the *active* markers, and `mulligan_audit` (§7) / stale-retirement can report or count them.

**Stale-marker retirement (spec/08 E15).** After `filterPipeline` runs, `contextHandler` performs a stale-marker retirement pass: for each *active pinned* shrink, it resolves the pinned target entry against the *pre-filter* `event.messages` + `branchEntries` via `resolvePinnedShrink`. A hit resets that shrink's consecutive-miss counter (`rt.shrinkMissCounts`) to 0; a miss increments it. When a shrink's miss count reaches `config.shrink.staleAfterFires` (default 3), `contextHandler` auto-retires it by appending a `mulligan:cancel` (the same retraction primitive as the `mulligan_cancel` tool) — which takes effect on the *next* `context` fire (`readMarkers` drops the cancelled id), so there is no in-fire mutation. Live shrinks (no `pinnedEntryId`) are never considered: they re-resolve each fire and no-op harmlessly. The whole pass is wrapped in its own try/catch, so a retirement failure can never break an agent turn (E13). (`contextHandler` receives `pi` (threaded through by `registerFilterHandler`) precisely so it can call `appendCancelMarker` here — mirroring `turnEndMetricHandler`.) **Soft cap on active shrinks (spec/08 E15).** In the same retirement pass, contextHandler additionally enforces a soft cap: when the number of active shrink markers exceeds config.shrink.maxActive (default 32), the oldest shrink (lowest seq) is auto-retired by appending a mulligan:cancel — exactly one per fire (bounded, eventual), taking effect on the next fire. Both stale retirement and the cap are wrapped in the same best-effort try/catch (E13).

---

## 2. Pairing: the cardinal rule

The model API rejects a request that contains a `toolCall` without its matching `toolResult`, or vice versa. **Every transform MUST preserve pairing.** The primitive that enforces this is `findToolCallPairs`:

```ts
// Returns, for the message array, the set of "units" where a unit is either:
//   - a single non-tool message, OR
//   - an assistant message that contains toolCalls, grouped WITH every toolResult
//     whose toolCallId appears in that assistant message.
interface Unit { indices: number[]; kind: "plain" | "toolGroup"; }
function partitionIntoUnits(messages: AgentMessage[]): Unit[]
```

Algorithm:
1. Walk messages; build `toolCallId → assistantIndex` from every `AssistantMessage`'s `toolCall` blocks.
2. Build `toolCallId → resultIndex` from every `ToolResultMessage` (`role:"toolResult"`, `.toolCallId`).
3. A `toolGroup` unit = the assistant message at `assistantIndex` plus all `resultIndex` whose `toolCallId` maps to that assistant. (An assistant may have several toolCalls; all their results join the same unit.)
4. Any message not in a toolGroup is a `plain` unit (single index).
5. Units are ordered by their minimum index.

**Critical corner cases:**
- A `toolResult` whose `toolCallId` has **no** matching assistant (orphan) — can happen transiently during streaming/compaction. Treat it as its own `plain` unit (do not delete it speculatively; the API tolerates an orphan result better than a missing one — but ideally leave both sides untouched if unsure). The safe rule: **if you cannot confirm both sides of a pair, hide neither.**
- An assistant with toolCalls whose results haven't arrived yet (mid-turn, shouldn't appear in a finalized `context` event, but be defensive): treat as a toolGroup unit containing just the assistant; hiding it is allowed only if no partial results exist for it.

All removal operations in Mulligan operate on **units**, never raw indices. This guarantees pairing by construction.

---

## 3. `resolveLastToolCallGroup`

```ts
// Find the most recent toolGroup unit, EXCLUDING the unit that contains the
// rewind's own toolCall (excludeToolCallId). Returns the unit's indices, or null.
function resolveLastToolCallGroup(
  units: Unit[], messages: AgentMessage[], excludeToolCallId?: string
): number[] | null
```

Algorithm:
1. Iterate units from the end backward.
2. Skip any `plain` unit.
3. For each `toolGroup` unit, check whether its assistant message contains a `toolCall` whose `id === excludeToolCallId`. If so, skip it (that's the rewind's own call).
4. The first non-excluded `toolGroup` from the end is the target. Return its indices.
5. If none, return `null` (nothing to rewind → no-op).

**Why exclude the rewind's own call:** when the agent calls `mulligan_rewind`, that call is itself a toolGroup (the assistant message with the `mulligan_rewind` toolCall + its result). Without exclusion, "last tool-call group" would resolve to the rewind itself. The marker carries `excludeToolCallId` (from the tool's `toolCallId` argument) precisely to skip it.

**`applyRewind` for this granularity** = remove the resolved unit's indices from the array (then close the gap).

> **Pinning (permanent hiding):** the relative algorithm above is the **backward-compat fallback**. Markers created by the current `mulligan_rewind` capture the resolved unit's stable **entry IDs** at creation time into `hideEntryIds` (via `captureHideEntryIds`), and `filterPipeline` resolves them by identity every fire via `resolvePinnedHide` (§12). Because entry IDs are stable across session growth, the hidden unit never shifts onto new work — this is what makes the soft-delete permanent (fixes the leak-back of BUG-001). This `resolveLastToolCallGroup` resolver runs only for old markers (or capture failures) that lack `hideEntryIds`. See `@04-data-model.md` §3 for the field and §11 for why pinning is required.

---

## 4. `resolveLastTurn`

Definitions (per Pi): a **turn** = a user message plus everything after it up to (but not including) the next user message. The **current/last turn** is the one beginning at the most recent `UserMessage` (`role:"user"`).

```ts
function resolveLastTurn(
  messages: AgentMessage[], opts: { toPreviousPrompt?: boolean }, excludeToolCallId?: string
): { remove: number[] }
```

Algorithm:
1. Find `iLastUser` = index of the last message with `role:"user"`. If none, return `{ remove: [] }` (nothing to rewind — protected).
2. Default (`to_previous_prompt === false`): **keep** the user message; remove all messages after `iLastUser` **except** the rewind's own unit (the assistant message containing `excludeToolCallId` and its result) and any `mulligan:note`/`mulligan:` custom messages at the tail (the note must survive). Concretely:
   - `remove = indices j where j > iLastUser AND j not in rewindOwnUnit AND messages[j] is not a mulligan:* custom message`.
   - The surviving tail = `[user message] + [mulligan:note] + [rewind assistant + result]`, so the model resumes at the user's prompt with the note immediately available.
3. Nuclear (`to_previous_prompt === true`): also remove the user message at `iLastUser` (and everything after, same exclusions). The model resumes at the *previous* user prompt. Refuse if `iLastUser` is the **first** user message and `protectedRoles` would be crossed (see §8 protected messages).
4. **Pairing:** because removal operates on `partitionIntoUnits`, any assistant+results removed together stay paired. But the "keep the rewind's own unit" exclusion interacts with pairing: the rewind's assistant message might share a unit with sibling tool calls from the same inference (parallel tools). In parallel-tool mode, one assistant message can carry `mulligan_rewind` AND sibling tool calls. Hiding the siblings but keeping the rewind requires **surgical** handling — see §9 (parallel tools). Default: treat the whole assistant message as the rewind's unit only if ALL its toolCalls are `mulligan_rewind`; otherwise fall back to "keep the entire assistant message + all its results" (safe, less surgical).

**`applyRewind` for `last_turn`** = remove `remove` indices (gap-closed), unit-aware.

> **Pinning (permanent hiding):** like `resolveLastToolCallGroup` above, this relative resolver is the **backward-compat fallback**. Current `last_turn` markers pin the entry IDs of the removed span at creation time (`hideEntryIds` via `captureHideEntryIds`) and `filterPipeline` resolves them by identity every fire via `resolvePinnedHide` (§12). This is essential for `last_turn`: without pinning, the agent's own "redo" work lands after the last user message and is hidden on every subsequent fire, trapping the agent in a loop (BUG-002). Pinning makes the redo visible (its entries have new IDs not in the pinned set) while the shed span stays hidden. See `@04-data-model.md` §3 and §11.

---

## 5. `applyShrink` — content substitution

Shrinks do **not** remove messages; they replace content. Matchers resolve against the current `messages` each fire:

```ts
function resolveShrinkTarget(messages: AgentMessage[], target: ShrinkTarget): number | null
```
- `by_tool_call_id`: return index of the `ToolResultMessage` with `toolCallId === id`, else null.
- `by_tool_name` + `occurrence`: among `ToolResultMessage`s with `toolName === name`, return last (or first) index, else null.
- `by_content_includes`: return index of the first message whose stringified content includes the substring, else null.

```ts
function applyShrink(messages: AgentMessage[], marker: ShrinkMarker): AgentMessage[] {
  const i = resolveShrinkTarget(messages, marker.target);
  if (i === null) return messages;                 // no match this fire → no-op (retry next fire)
  const orig = messages[i];
  const replacement: AgentMessage =
    orig.role === "toolResult"
      ? { ...orig, content: [{ type: "text", text: marker.replacement }] }   // preserve role/toolCallId/toolName/isError
      : { ...orig, content: [{ type: "text", text: marker.replacement }] };  // generic message: replace content, keep role
  return messages.map((m, j) => (j === i ? replacement : m));
}
```

**Pinned shrinks (FINDING 3).** `applyShrink` resolves the target **pinned-first**: when the marker carries a `pinnedEntryId` (the stable ENTRY id the target matched at marker-creation time — recorded by the tool), it resolves that id by **identity** via `resolvePinnedShrink(messages, branchEntries, pinnedEntryId)` (the single-id counterpart of `resolvePinnedHide`), NOT the live selector. This locks the substitution to ONE message forever, so `by_tool_name`+`last` and `by_content_includes` can no longer drift onto a later, unrelated message that merely happens to match (the moving-target footgun). If the pinned entry is no longer present (compaction), the shrink no-ops that inference rather than re-resolving the selector — identity-or-nothing, mirroring the rewind `hideEntryIds` precedent. `by_tool_call_id` is already stable, so pinning is a harmless no-op there. Markers without a `pinnedEntryId` (old markers, or a target that did not match at creation) fall back to the live `resolveShrinkTarget` above (compaction-robust as before).

**Multiple shrinks on the same target:** applied in seq order, so the last one wins (its replacement is what's seen). **Shrink after rewind:** if a rewind already removed the target message, the shrink no-ops (resolve returns null) — harmless.

**Pairing:** shrink preserves `toolCallId`/`role`, so pairing is untouched. Safe.

---

## 6. Checkpoint targeting (entry → message mapping)

The only place Mulligan maps entries to messages. Algorithm:

```ts
function resolveCheckpoint(messages: AgentMessage[], branchEntries: SessionEntry[], checkpointName: string, excludeToolCallId?: string): { remove: number[] } | null
```
1. Find the `LabelEntry` with `label === \`mulligan:checkpoint:${name}\`` on the current branch (scan `getEntries()`; the label's `targetId` is the checkpointed entry).
2. Build the ordered list of **context-producing entries** on the branch up to the leaf, in order: filter `getBranch()` (leaf→root, then reverse) to entries of types that produce a message (`message`, `custom_message`, `compaction`, `branch_summary`). Call this `ctxEntries`.
3. Find `k` = position of `targetId` in `ctxEntries`.
4. The corresponding message index is `k` **only approximately**, because `compaction`/`branch_summary` entries expand to multiple messages (summary + retainedTail). To map precisely: walk `ctxEntries` in parallel with `messages`, advancing the message cursor by the number of messages each entry yields (message→1, custom_message→1, compaction→ 1 + retainedTail.length, branch_summary→1). Stop at the checkpoint entry; the cursor is the message index `iTarget`.
5. Remove all messages with index `> iTarget` (keep the checkpoint point and everything before), with the same tail-exclusion rules as `resolveLastTurn` (keep the rewind's own unit + mulligan notes).
6. Refuse if `iTarget` falls at/before a protected message (§8).

This mapping is intrinsically fiddlier than the relative granularities; that's why relative granularities are the default and checkpoint is the advanced mode. If the mapping cannot be determined confidently (e.g. a compaction entry lacks `retainedTail`), **refuse safely** and log — never guess.

> **Pinning (permanent hiding):** checkpoint rewinds ALSO pin at creation time. `captureHideEntryIds` runs inside `resolvePreview` (the rewind tool's creation-time snapshot) and captures the entry IDs of the resolved removal set into `hideEntryIds`; `filterPipeline` then resolves them by identity every fire via `resolvePinnedHide`, which generalizes this section's entry→message walk from "one checkpoint target" to "a set of pinned entry IDs". The relative `resolveCheckpoint` above remains the **backward-compat fallback** (old markers / capture failures) AND the producer used at creation time to compute the removal set. Note also: `setCheckpoint` labels the last *real* `message` entry on the branch (walking `getBranch()` backwards), not the raw leaf — this avoids labeling a transient/non-context-producing entry that would make the walk map to the leaf and hide nothing (BUG-003). See `@04-data-model.md` §3 and §11.

---

## 7. Caching the filtered view for `mulligan_audit`

`mulligan_audit` must report the *filtered* view. The filter already computes it every inference; cache it:

```ts
interface SessionRuntime {
  // ...
  lastFiltered: AgentMessage[] | null;   // written by the filter each fire
  lastFilterTs: number | null;
}
```

`mulligan_audit` reads `rt.lastFiltered` (if fresh, i.e. a filter has fired this session). If `null` (audit called before any inference — possible if the agent calls it as a first action in print mode), audit falls back to: convert `ctx.sessionManager.buildContextEntries()` to messages via the same logic Pi uses (best-effort; flag confidence "low"), apply the transform pipeline, and report. **Never** use `ctx.getContextUsage()` for the total (D5).

---

## 8. Protected messages

The filter and tools enforce `config.rewind.protectedRoles`. Defaults: the **system** (not in messages anyway), the **first user message** (the original task), and the **latest user message** (the current ask). Concretely, a rewind that would remove a message at or before the first user message, or that would remove the latest user message (unless `to_previous_prompt` explicitly and it isn't the first), is **refused** (the tool refuses before persisting; the filter double-checks and no-ops as defense-in-depth).

Implementation: compute `iFirstUser` and `iLatestUser` in `messages`. A rewind's `remove` set MUST satisfy `min(remove) > iFirstUser`. For `last_turn` default, `iLatestUser` is kept by construction (we only remove after it). For `to_previous_prompt`, refuse if `iLatestUser === iFirstUser`.

Protected roles are **configurable**: `config.rewind.protectedRoles` is a list of selectors. Minimal v1 supports `["first:user", "latest:user"]` semantics; a future version may allow arbitrary role rules. Keep v1 simple.

---

## 9. Parallel-tool-mode corner case

In Pi's default parallel tool execution, one `AssistantMessage` may contain **several** `toolCall` blocks executed concurrently (e.g. `mulligan_rewind` + a sibling `read`). The `mulligan_rewind`'s own assistant message is therefore shared with siblings.

Policy:
- `mulligan_rewind` SHOULD be called **solo** (its description tells the agent so). The filter does not require it.
- If the rewind's assistant message has sibling toolCalls, `resolveLastToolCallGroup`'s exclusion of `excludeToolCallId` cannot surgically split one assistant message. Safe fallback: when resolving `last_tool_call_group`, if the would-be-target assistant message contains the rewind's own `toolCallId`, skip to the previous toolGroup; if the rewind shares a message with the *actual* target, treat the whole shared message as kept (do not hide it) and hide the *previous* toolGroup instead. Log a "surgical-split unavailable" info line.
- For `last_turn`, the "keep the rewind's own unit" rule keeps the entire shared assistant message + all its results, so siblings survive in the view (their results remain). This is correct: the agent sees its sibling work and the note; only the prior turn's work is hidden.

Net effect: parallel mode is handled conservatively (never breaks pairing; may be slightly less surgical than solo mode). Document this; recommend solo use.

---

## 10. Interaction with compaction

Compaction rewrites the message list Pi hands to `context` (summarizing the head). Mulligan's filter runs **after** Pi builds that list, so:
- Rewinds/shrinks resolve against the **post-compaction** list. If compaction already removed/summarized a span a marker targeted, the marker no-ops for that fire (good).
- A marker targeting the **retained tail** still works (tail messages have stable roles/ids).
- Risk: compaction may summarize content Mulligan hid into a compaction summary the model sees. Mitigations: (a) Mulligan reduces context, so compaction fires later and over less; (b) the filter could optionally strip `mulligan:` references from compaction summaries — **v1 does not** (keep it simple; the leak is bounded and transient). Document as a known limitation in `@08-edge-cases.md`.
- `seq` ordering survives compaction (markers are entries on the branch; compaction keeps entries after `firstKeptEntryId`, which includes recent markers).

---

## 11. Composition & idempotency (recap with example)

Two rewinds in sequence:
```
messages: [u0, a1(grep call), r1(big), a2(read call), r2, a3(rewind#1 call), res3, note, a4(rewind#2 call), res4]
markers (seq order): rewind#1 (last_tool_call_group, exclude res3's call), rewind#2 (last_tool_call_group, exclude res4's call)

Filter pass:
  rewind#1: resolve last toolGroup excluding res3's call → the a2/r2 unit (the read). Remove → [u0,a1,r1,a3,res3,note,a4,res4]
  rewind#2: resolve last toolGroup excluding res4's call → the a1/r1 unit (the grep). Remove → [u0,a3,res3,note,a4,res4]
Result the model sees: [u0, a3(rewind#1)+res3, note, a4(rewind#2)+res4]
```
Wait — that removed both the grep AND the read, and the rewinds' own calls remain. The note remains. The model resumes at u0 with the note. Correct: both mistakes shed; note + rewind confirmations kept; pairing intact.

(If the agent intended only one removal, it would issue one rewind. Two markers = two removals. Deterministic.)

Idempotency: re-firing the filter on the same session reproduces the same result (markers resolve against the same session each time until the session changes). No double-removal because removed messages are absent from subsequent passes within the same fire.

**Within a turn, the session is NOT static across fires.** A tool call appends entries between one `context` fire and the next, so a rewind marker that stores a *relative* spec ("last tool-call group" / "last turn") and is re-resolved against the live message list every fire is unstable: the moment the agent resumes work after a rewind, the relative spec re-targets onto the NEW work, un-hiding the originally-hidden mistake (BUG-001) and/or hiding the agent's own redo on every fire (BUG-002). For this reason, **new markers pin stable entry IDs at creation time** (`hideEntryIds`, captured by `captureHideEntryIds` — see §3/§4/§6 and `@04-data-model.md` §3) and `filterPipeline` resolves them by *identity* every fire via `resolvePinnedHide` (§12). The hidden set is therefore invariant across session growth: the originally-hidden mistake stays hidden every fire; the agent's new work (new entries, new IDs not in the pinned set) stays visible. The relative resolvers below remain ONLY as a backward-compat fallback for old markers (or capture failures) that lack `hideEntryIds`. That backward-compat fallback is further **gated** by `turnHasAdvanced` so it can never re-target the agent's resumed work (see the pseudocode note in §12 and `FIX_TURN_REPLAY_LOOP.md`; tested in `@10-testing.md` §1.9). (Idempotency of the pure pipeline on identical input still holds; the instability was always about re-resolution against a *growing* input, which pinning eliminates.)

---

## 12. Pseudocode: the full pipeline (reference)

```ts
function filterPipeline(messages: AgentMessage[], markers, config, branchEntries, ctx): AgentMessage[] {
  let m = messages;
  for (const rw of stableSortBySeq(markers.rewinds)) {
    let remove: number[];

    // PINNED PATH (permanent hiding — fixes BUG-001/BUG-002): new markers carry stable ENTRY ids captured once
    // at creation time (captureHideEntryIds). resolvePinnedHide maps them by IDENTITY to current message indices
    // every fire, so the hidden set never shifts onto new work. A refused pinned hide returns [] and does NOT
    // fall back to the relative branches below (that would re-introduce the bug). branchEntries is getBranch()
    // output, ROOT→LEAF (no reverse).
    const pinned = Array.isArray(rw.hideEntryIds) ? rw.hideEntryIds : [];
    if (pinned.length > 0) {
      remove = resolvePinnedHide(m, branchEntries, pinned);
    } else {
      // LEGACY FALLBACK (old markers / capture failures): relative re-resolution. GATED to the creating/resume fire
      // by turnHasAdvanced(m, rw.excludeToolCallId): once any non-note work exists past the rewind's own toolGroup,
      // the relative resolver MUST no-op (remove=[]) rather than re-target the agent's new work every fire and
      // replay the turn (FIX_TURN_REPLAY_LOOP.md). Production markers carry hideEntryIds → take the PINNED branch
      // above, so this guard only matters for old/k=0/capture-failed markers. (If the rewind's own group can't be
      // located, e.g. an old marker lacking excludeToolCallId, turnHasAdvanced returns false/allow so it doesn't
      // over-suppress — production never reaches here.)
      if (turnHasAdvanced(m, rw.excludeToolCallId)) {
        remove = [];
      } else if (rw.granularity === "last_tool_call_group") {
        // Re-partition FRESH each rewind (a pre-loop partition indexes a stale array after the first rewind reduces m).
        const u = resolveLastToolCallGroup(partitionIntoUnits(m), m, rw.excludeToolCallId);
        remove = u ? u.indices : [];
      } else if (rw.granularity === "last_turn") {
        remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove;
      } else { // checkpoint
        const res = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId);
        remove = res ? res.remove : [];
      }
    }
    if (!protectedOk(m, remove, config)) { log("warn","rewind.protected",...); continue; }
    m = removeIndices(m, remove);
  }
  for (const sh of stableSortBySeq(markers.shrinks)) {
    m = applyShrink(m, sh);   // shrinks intentionally re-resolve against m each fire (§5) — NOT pinned.
  }
  if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
    m = injectNudge(m, markers.metric);
  }
  return m;
}
```

**Legacy-resolution gate (`turnHasAdvanced`).** `turnHasAdvanced(messages, excludeToolCallId)` locates the rewind's own toolGroup (the assistant message carrying `excludeToolCallId`) and returns true iff any **non-`mulligan:*`-note** message exists past that group. On the creating/resume fire (nothing but notes follows the rewind's own group) it returns false → the relative resolver runs once. The instant the agent appends real work, it returns true → the relative resolver no-ops forever after, so it can never re-target the resumed turn and replay it (`FIX_TURN_REPLAY_LOOP.md`).

**Invariant log + `diag` sink.** `filterPipeline` accepts an optional 5th argument `diag: (d: RewindDiag) => void` (pure, opt-in; the unit suite omits it). The `context` handler passes a sink that logs `filter.invariant` per fire, per rewind, with `{ seq, mode, remove, resolvedLen }`, and **WARNs when any rewind's `max(remove) >= resolvedLen-3`** — the replay signature (a rewind hiding the freshest messages). This makes a live recurrence diagnosable from logs alone: it distinguishes the empty-`hideEntryIds` re-target vector (fixed by `turnHasAdvanced`) from a pinned/compaction misalignment (see `@08-edge-cases.md` E24).

`injectNudge` and `shouldNudge` are specified in `@07-preventive-and-nudges.md`.

## 13. Cross-references
- Marker shapes consumed here → `@04-data-model.md`
- Tool contracts that produce markers → `@05-tools.md`
- Nudge mechanics → `@07-preventive-and-nudges.md`
- Edge cases (compaction leak, parallel mode, orphans) → `@08-edge-cases.md`