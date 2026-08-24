# Spec verification brief — pi-mulligan v2.0 delta (READ-ONLY)

Repo: `/home/dustin/projects/pi-mulligan-current-turn-only`. All quotes verbatim from `spec/`. Line numbers approximate (verified by grep offsets where given).

## 1. spec/05-tools.md

### §2 `mulligan_shrink` — current-turn scoping
- Purpose (§2, purpose block): "**(v2.0: only current-turn results are eligible — the shrink cannot touch earlier turns.)**"
- Param schema descriptions: `by_tool_call_id`: "The toolCallId of the result to shrink — must be a call from the CURRENT turn."; `by_tool_name`: "e.g. 'read', 'bash' — matches only results from the CURRENT turn" with `occurrence`: "first/last matching result within the current turn". Target union description: "How to identify the CURRENT-TURN tool result to shrink. Only results produced this turn are eligible; earlier turns are out of scope. Resolved live each turn (robust to compaction)."
- v2.0 note (blockquote after schema, verbatim):
  > **v2.0 — current-turn scope.** The `by_content_includes` arm is **removed**, and both remaining arms resolve **only within the current turn's tool-result span**. A `by_tool_call_id` that resolves in an earlier turn is a **hard refusal**; a `by_tool_name` selector with no match this turn is a **hard refusal** (never a fallback into older history).
- Behavior step 3: "**Match now (best-effort, current-turn-scoped — v2.0 REQUIRED):** resolve `target` against the current snapshot, **restricted to the current turn's tool-result span**. If the selector matches only a result from an EARLIER turn (or `by_tool_call_id` names a call not issued this turn), return a hard refusal: `\"Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.\"` A currently-unmatched-in-turn selector with a well-formed shape is likewise refused now that scope is exact…"

### §5 `mulligan_cancel` — two-arm note
- Purpose first paragraph still enumerates "(the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`))" — one stale enumeration in prose.
- Schema target description (updated): "How to identify the marker to cancel — the SAME (two-arm, v2.0) hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired."
- v2.0 note (verbatim):
  > **v2.0 note:** cancel keeps the two remaining shrink hint arms (`by_tool_call_id`, `by_tool_name`+`occurrence`); `by_content_includes` is removed in lockstep with the shrink tool. Cancel's *marker* resolution is unaffected by the current-turn scope (a marker issued in a previous turn may still be retracted — the marker, not the old content, is what cancel acts on).
- Persistence language: SPEC.md §6 has "persists for as long as the marker exists"; in 05 §5 the equivalent is: "the transform **no longer applies going forward**" / "Cancelled markers stay on disk for the audit trail; only the drop from the filtered view takes effect next fire." (Exact string "persists for as long as the marker exists" appears in SPEC.md:165, not 05-tools.md.)

### §6 description strings — STALE (confirms PRD)
- **Shrink (stale — no current-turn mention):**
  > `"Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."`
- **Cancel (stale — still lists by_content_includes):**
  > `… Identify the marker by \`target\` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; …`
- Rewind and Audit descriptions appear current (no v2.0 conflict).

## 2. spec/06-context-filter.md §5 (scope guard)

- `resolveShrinkTarget(messages, target, turnSpan)` — both arms "**inside `turnSpan`**".
- v2.0 block (verbatim):
  > **v2.0 — current-turn scope (defense in depth).** `turnSpan` is the CURRENT turn's tool-result span (everything after the most recent `user` message, matching rewind's `last_turn` resolution). The tool already refuses out-of-scope targets at creation; the filter independently enforces the same bound at every fire — a target that resolves only outside `turnSpan` returns null (no-op), and a pinned marker whose entry falls outside `turnSpan` no-ops for that fire. Scope holds under all circumstances: neither selector drift, nor pinning, nor compaction re-entry can apply a shrink to an earlier turn. `by_content_includes` no longer exists.
- Turn-span computation: "everything after the most recent `user` message, matching rewind's `last_turn` resolution" (§4 `resolveLastTurn`).
- §5.1 headers: "## 5. Render-time awareness stamp (`stampShrink`)" → subsection "## 5.1 Render-time awareness stamp (`stampShrink`)" including "Pinned shrinks (FINDING 3)". Note: the subsection numbered 5.1 sits under §5 `applyShrink`; the task's "5.1/5.2/5.3" numbering matches **07** below.

## 3. spec/07-preventive-and-nudges.md

### §2 Nudge B — v2.0 block (verbatim, after Purpose):
> **v2.0 — awareness-only.** The drift nudge fires at the next inference about the PREVIOUS turn's growth — and under current-turn scoping (`@05` §2) the previous turn is out of scope for modification. It therefore **must not prescribe rewind/shrink of past content**; its message is awareness and forward-looking advice only (keep current-turn outputs lean — pipe, slice, summarize at creation time). **Nudge A (§1) is the only prescribing nudge** and is inherently compliant: it rides the bloated result inside the very turn that produced it, when the shrink is still issuable. The high-water annotation (§5.2) was already awareness-only and is unchanged.

### `renderDriftNudge` tail text (§2, verbatim):
> `Previous turn added ~<delta>k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
Labeled "(v2.0 — awareness-only; no rewind/shrink prescription, since the reported turn is out of modification scope)".

### §5.1/5.2/5.3 headers:
- "### 5.1 Windowed drift signaling (REQUIRED)" — delta-only firing, `bloatHit` only as no-delta fallback.
- "### 5.2 Edge-triggered high-water signal (REQUIRED)"
- "### 5.3 Suppress the drift nudge when the agent already acted (REQUIRED)"

## 4. spec/08-edge-cases.md

- **E19 (verbatim):**
  > **v2.0: MOOT.** With `by_content_includes` removed and both remaining target arms restricted to the current turn's tool-result span, a shrink can only ever match a `toolResult`. A shrink of a user/assistant/custom message is no longer expressible. (Historical v1 behavior, retained here for the record: `applyShrink` replaced `content` but preserved `role`; the original was never lost — shrink was a *view substitution* and the user's actual message stayed on disk, recoverable via `/tree`.)
- **E8 (silence precedent):** "resolver returns null/empty → the operation is a **no-op for that fire** and silently retried next fire (in case content reappears). This makes Mulligan idempotent and compaction-robust. No error."
- **E13:** "**every** tool body and every handler is wrapped in try/catch. Tools return a text result describing the failure; the `context` handler returns nothing (pass-through, fail-open). Always log." — Note: E13 does not itself state a "matched:false persist rule"; that rule lives in 05 §2 step 6 ("a persisted-but-currently-unmatched target reports `~0`") and 10 §1.12 ("Persisted-but-unmatched target (`Matched: no`, E8): line present with `~0`"). 05 §5 cancel's no-op paths return `cancelled:false` without appending.

## 5. spec/04-data-model.md §4 (shrink marker)

- `ShrinkTarget` (two arms) with comment (verbatim):
  > // v2.0: `by_content_includes` REMOVED. Both remaining arms resolve ONLY within the
  > // CURRENT turn's tool-result span (see Matching semantics below) — a shrink may never
  > // target a message from an earlier turn.
- Fields present: `id`, `target`, `replacement` (stored RAW), `reason?`, `pinnedEntryId?` ("Pinned stable ENTRY id of the message the target matched at marker-creation time (FINDING 3 — pinned shrink). … Holds an ENTRY id (stable), NOT a message index. OPTIONAL."), `seq`, `ts`.
- **No `matched` field exists on the marker** — "Matched: yes/no" is a tool-result rendering concern (05 §2), not persisted. PRD's mention of a `matched` field does not match spec.
- Matching semantics: "The current-turn bound is enforced at BOTH creation (the tool refuses out-of-scope targets) and resolution (the filter drops out-of-scope matches) — scope holds under all circumstances."

## 6. spec/10-testing.md

- **§1.11** — bullets list only `by_tool_call_id`, `by_tool_name:"read", occurrence:"last"`, LIFO, no-op, `markerId` fallback, post-cancel verbatim reappear. **No `by_content_includes` bullet found** — grep for `by_content_includes` in 10-testing.md returns zero matches. **PRD claim "still has a by_content_includes bullet" is NOT true of the current spec text.**
- **§1.5 `applyShrink`** — bullets: by_tool_call_id match preserves role/toolCallId/toolName/isError; no match → no-op; two shrinks last-wins, stamp exactly once; render-time stamp, stored replacement RAW. No current-turn-scope-specific unit bullet (scope-guard tests are not enumerated in §1.5).
- **§2.1** — scenario table includes F-shrink-persist, F-nudge-drift (with §5.3 non-overlap negatives), F-cancel, F-retrycap, F-abortfraction, F-drift-userexempt, etc. No explicit current-turn-refusal scenario (e.g. "shrink earlier-turn target → refusal") is present in the table.

## 7. spec/SPEC.md

- §6 example nudge (verbatim): "injects a one-line annotation into the message copy (e.g. `[mulligan: last turn +4.2k tokens; keep current-turn outputs lean]`)" — SPEC.md:176. This example is consistent with v2.0 awareness-only.
- v2.0 amendment §4 (top-of-file amendment block, item 4, verbatim):
  > **Supersedes the unspec'd "rewrite budget" work** (r1): its queue/moment-cap machinery existed to batch mid-history rewrites across turns; with no mid-history rewrites there is nothing to cap. The v1.2 aggregate orientation line (k>1 shrinks within one turn) is retained.
- Amendment net line: "shrink target union 3 arms → 2 (both current-turn-scoped); `by_content_includes` removed from shrink and cancel; Nudge B re-worded awareness-only; filter gains a scope guard; no tool added or removed."

## 8. Contradictions / stale spots found (spec vs PRD interpretation)

**Issuing-turn vs fire-time bound:** the spec is unambiguous and consistent — scope is computed as "everything after the most recent `user` message" **at each fire** (06 §5: "the filter independently enforces the same bound at every fire"), with creation-time hard refusal in the tool. Under the marker's own turn the bound is trivially satisfied; the fire-time enforcement means a marker from turn N never applies once the turn advances. No text contradicts an issuing-turn-bound interpretation; the spec actually mandates *both* creation-time refusal and fire-time no-op (04 §4 "enforced at BOTH creation … and resolution"). No contradiction with the PRD ruling found.

Stale/inconsistent spec text (facts only):
1. **05 §6 SHRINK description string** — says "a specific past tool result", no current-turn scoping. STALE (matches PRD claim).
2. **05 §6 CANCEL description string** — still lists "by_content_includes" as a hint arm. STALE (matches PRD claim).
3. **05 §5 Purpose first paragraph** — enumerates three arms including `by_content_includes` in prose (schema + v2.0 note below it are correct two-arm). Minor internal inconsistency.
4. **10 §1.11** — PRD claims a stale `by_content_includes` bullet; none exists. PRD claim is itself stale w.r.t. the spec.
5. **10 §1.5 / §2.1** — no explicit current-turn-scope refusal/no-op test scenarios enumerated (gap, not contradiction).
6. **04 §4** — no `matched` field on ShrinkMarker; if the PRD requires one, that's a PRD-vs-spec delta, not stale spec.
7. (Runtime observation, outside spec/) the live-injected drift nudge I received this session reads "…`mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result" — the pre-v2.0 prescribing wording. Indicates `src/` lags the spec; spec itself has the v2.0 text.
8. SPEC.md:165 "persists for as long as the marker exists (permanent soft substitution)" and SPEC.md:70 current-turn language are consistent with 05/06.

**Conclusion:** spec/ is at v2.0 target state for the substantive sections (05 §2/§5 schema+notes, 06 §5 guard, 07 §2 + §5.x, 08 E8/E13/E19, 04 §4, SPEC amendments). The only stale text is the two §6 description strings (05) plus one prose enumeration (05 §5 intro). Those are the spec-side deltas; everything else needs no spec edits.