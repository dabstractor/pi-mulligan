# 08 — Edge cases & failure modes

> Every foreseeable awkward situation and exactly how Mulligan handles it. Implementers: read this before writing the filter. Reviewers: this is the "what about…" index. Each entry gives the **situation**, the **risk**, and the **prescribed behavior**.

---

## E1. Orphaned `toolResult` (no matching `toolCall`)
- **Situation:** `event.messages` contains a `ToolResultMessage` whose `toolCallId` has no preceding `AssistantMessage` toolCall. Can occur transiently during streaming, after partial compaction, or with custom tools.
- **Risk:** hiding one side breaks the API; the model request errors.
- **Behavior:** `partitionIntoUnits` treats an orphan result as its own `plain` unit. **A rewind never removes a unit unless both sides of every pair within it are confirmed present** (§2 of `@06-context-filter.md`). If unsure, hide neither. Log at debug.

## E2. Rewinding the executing turn
- **Situation:** the agent calls `mulligan_rewind` mid-turn; the rewind's own assistant message + result are in the current (incomplete) turn.
- **Risk:** self-referential removal — can't remove the turn while it's executing; would erase the rewind's own call/note.
- **Behavior:** by construction, `resolveLastToolCallGroup` excludes the rewind's own `toolCallId`, and `resolveLastTurn` keeps the rewind's own unit + tail notes. So the rewind always resolves to **completed** turns strictly before the current one. No special case needed; the exclusions handle it. Document for the agent: "rewind targets completed work, not the call you're making right now."

## E3. Rewinding across a protected message
- **Situation:** a rewind would hide the first user message, or a `user` message that the user has not consented to expose.
- **Risk:** catastrophic amnesia (lose the original task) or silent deletion of the user's steering.
- **Behavior (v1.1 guardrail — `@13` §1):**
  - **`first:user` (the original task) is unconditionally protected** — no consent, no checkpoint, no config can override it. By construction checkpoints sit at/after it and `remove` is strictly `> iTarget`; `protectedOk` (`@06` §8/§12) blocks any rewind whose `min(remove) <= iFirstUser` as defense-in-depth (no-op + warn log).
  - **Other `user` messages** are protected by the guardrail (`@05` §1 step 3b): `last_tool_call_group` and `last_turn` never hide a `user` message (they remove only the agent's own output). A `checkpoint` rewind may hide subsequent user messages, because the user opted in by setting the checkpoint.
  - `last_tool_call_group` and `last_turn` default never hide a `user` message, so they are unaffected.

## E4. Max rewind depth exceeded
- **Situation:** the agent has created `config.rewind.maxDepth` (default 5) active rewind markers and calls another.
- **Risk:** runaway marker accumulation; context devolves into a string of notes.
- **Behavior:** tool refuses with a message naming the count and suggesting `mulligan_shrink` or just continuing. (Markers are permanent — there's no "clear" — so the cap prevents pathological loops.) If the agent is genuinely stuck in a retry loop, the human should intervene; the refusal text says so.

## E5. Rewinding a span that had side effects (writes/bash)
- **Situation:** the rewound turn wrote files or ran mutating bash.
- **Risk:** the resumed agent, not seeing that work in context, may redo it — compounding side effects (double `mkdir`, re-applied edit, duplicate commit).
- **Behavior:** this is why the note's `true_current_state` + the deterministic `FileLedger` exist (D/D17). Additionally, when `config.rewind.requireMutationWarning` is true and the ledger's `modifiedFiles`/`bashSideEffects` is non-empty, the tool result appends a prominent warning, and the note's rendered form includes the `<files-modified>`/`<bash-side-effects>` blocks. The agent is told explicitly: *those effects persist on disk; do not blindly redo them.*
- **Hard retry is never supported** (D1) — Mulligan does not replay tool calls. The resumed agent re-plans from the note.

## E6. Parallel tool mode: `mulligan_rewind` with siblings
- **Situation:** one assistant message contains `mulligan_rewind` plus sibling tool calls (parallel execution).
- **Risk:** can't surgically split one assistant message; hiding siblings vs. the rewind is ambiguous.
- **Behavior:** conservative — keep the entire shared assistant message + all its results; hide the **previous** toolGroup/turn instead. Document that `mulligan_rewind` SHOULD be called solo. See `@06-context-filter.md` §9.

## E7. Compaction summarizes content Mulligan hid
- **Situation:** auto-compaction runs and summarizes a span that included a Mulligan-hidden message; the compaction summary (which the model sees) may reference that content.
- **Risk:** a transient "leak" of hidden content via the summary, until the next compaction.
- **Behavior:** v1 accepts this as a **bounded, transient** limitation (the summary is itself soon superseded). Mitigations already in place: Mulligan reduces context → compaction fires later and over less-important content. Document as known limitation. (Future: optionally strip `mulligan:` references from compaction summaries — not v1.)

## E8. Marker targets nothing (already removed/compacted)
- **Situation:** a rewind/shrink marker's target isn't in the current message list (compacted away, or already removed by an earlier rewind).
- **Risk:** none, really.
- **Behavior:** resolver returns null/empty → the operation is a **no-op for that fire** and silently retried next fire (in case content reappears). This makes Mulligan idempotent and compaction-robust. No error.

## E9. Note field validation failure
- **Situation:** the agent calls `mulligan_rewind` with an empty `note` field (e.g. `what_happened: ""`).
- **Risk:** a vacuous note defeats the confabulation defense.
- **Behavior:** tool refuses: "note fields must all be non-empty." The structured note is non-negotiable.

## E10. Checkpoint name invalid or not found
- **Situation:** `granularity:"checkpoint"` with a name that doesn't match `/^[a-z0-9_-]{1,40}$/` or no such labeled entry exists on the branch.
- **Behavior:** refuse with the reason. The `/mulligan_checkpoint` command validates the name format at creation (v1.1); `mulligan_rewind` validates existence.

## E11. Session reload / `/resume` mid-task
- **Situation:** the session is reloaded (manual `/resume`, restart) after markers were created.
- **Risk:** in-memory caches (token baseline, lastFiltered) are lost.
- **Behavior:** `session_start` reinitializes the runtime map. Markers and notes are persisted entries → survive reload → the filter re-applies them on the first inference. `tokenBaseline` becomes null → the drift nudge falls back to bloat-only until a turn completes. No correctness impact on rewind/shrink.

## E12. `getContextUsage()` undefined (no model / pre-first-inference)
- **Situation:** `ctx.getContextUsage()` returns undefined (e.g. before any assistant message).
- **Behavior:** audit and turn-metric code already tolerate this (fall back to estimate or null). No crash.

## E13. Tool throws internally
- **Situation:** any unexpected exception inside a tool `execute` or an event handler.
- **Risk:** an unhandled throw in a tool surfaces as a tool error to the model; in the `context` handler it could break the turn.
- **Behavior:** **every** tool body and every handler is wrapped in try/catch. Tools return a text result describing the failure; the `context` handler returns nothing (pass-through, fail-open). Always log. Mulligan must never be the reason an agent turn fails.

## E14. Extension disabled via config
- **Situation:** `config.enabled === false` (or a sub-feature disabled).
- **Behavior:** the `context` handler returns immediately (pass-through); tools refuse with "Mulligan is disabled." The extension is a no-op. Allows the human to disable without uninstalling.

## E15. Very large number of accumulated markers/notes (long sessions)
- **Situation:** a long session accumulates many markers, notes, and turn-metrics on disk.
- **Risk:** disk growth (not context growth — markers/metrics are not in context). Filter does O(markers × messages) work per inference.
- **Behavior:** the filter is cheap in practice (few markers; messages bounded by compaction). v1 does no marker GC. Document that markers persist (intentional — audit trail). A future "squash adjacent rewinds" optimization is a non-goal for v1.
  - **Stale-marker retirement + soft cap (REQUIRED):** a pinned shrink whose target entry has been absent for `config.shrink.staleAfterFires` (default 3) consecutive fires MUST be auto-retired (treated as cancelled per E21) so it stops being resolved every fire. Active shrink markers are additionally capped at `config.shrink.maxActive` (default 32, mirroring `rewind.maxDepth`); when exceeded, the oldest is retired. Both bound long-session filter cost. Checkpoints are bounded separately by **auto-expiry on consumption** (`@05-tools.md` §3): a checkpoint used as a rewind target is retired immediately, so only unconsumed checkpoints persist.

## E16. `mulligan_audit` called before any inference
- **Situation:** the agent calls `mulligan_audit` as its very first action (no `context` has fired; `rt.lastFiltered` is null).
- **Behavior:** audit falls back to converting `buildContextEntries()` to messages + applying the pipeline, flagging confidence "low." Still useful; never crashes.

## E17. Two shrinks target the same message
- **Situation:** two `mulligan:shrink` markers match the same target.
- **Behavior:** applied in seq order; **last wins** (its replacement is what's seen). Deterministic.

## E18. The model ignores the nudges
- **Situation:** the agent never heeds the bloat/drift reminders.
- **Behavior:** correct outcome — nudges are advisory (D3). Mulligan does not force behavior. The cost is the ~25–40 token nudge when it fires; bounded.

## E19. Shrink target is a non-`toolResult` message
- **Situation:** `by_content_includes` matches a user/assistant/custom message, not a tool result.
- **Behavior:** `applyShrink` replaces `content` but **preserves `role`**. Shrinking a user message is allowed but unusual; the description steers the agent toward tool results. No special handling beyond role preservation. (Pairing unaffected since it's not a toolResult.)
- **The original is never lost (hard invariant):** shrink is a *view substitution* — the user's actual message stays on disk and is recoverable via `/tree` (D2 / soft-delete). Summarizing user input is acceptable precisely because the original always survives; only the model's in-context copy is replaced.

## E20. `pi.appendEntry` / `pi.sendMessage` ordering race
- **Situation:** the tool calls `appendEntry` then `sendMessage`; could the note land before the marker in the entry order?
- **Behavior:** both are synchronous appends on the same session; they land in call order (marker first, note second). The filter reads markers from `getEntries()` independently of the note's position, so ordering between them doesn't affect correctness. The note appears after the rewind tool's result in context, which is the desired "most-recent" placement.

## E21. Marker retraction — cancel an erroneous/stale marker (REQUIRED; softens D6)

- **Situation:** the agent issues a `mulligan:rewind` or `mulligan:shrink` it needs to undo — a mis-targeted shrink, a rewind that hid something still needed, or any marker issued against the wrong target. Without retraction the unwanted transform applies on every subsequent `context` fire for the rest of the session, and `mulligan_rewind` of the issuing call does **not** retire it: markers are `custom` control entries outside the rewind's `hideEntryIds` span (verified in live use — an erroneous shrink had to be worked around for an entire session because every `read` result kept being re-substituted).
- **Required behavior — retraction:** Mulligan MUST provide an agent-callable way to retire a marker so it stops applying going forward. Implementation: append a *retirement* marker — `mulligan:cancel` carrying the target marker's `id` (equivalently a `cancel: markerId` mode on `mulligan_rewind`/`mulligan_shrink`). `readMarkers` MUST drop any marker whose `id` is listed by a later `mulligan:cancel` before the filter sees it. The `mulligan_cancel` tool takes a **`target`** — the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), resolved live each turn — and retires the most recent active marker (shrink or rewind) whose effect covers the matched message. An explicit `markerId` is accepted as an optional fallback for hosts that surface `details.markerId`. The tool validates that a matching marker exists on the branch, appends the retirement entry, and returns confirmation.
- **Scope — what retraction is NOT:** it only suppresses a control marker in the view going forward. It is **not** a general "undo the rewind's effects": on-disk side effects of the original span persist (D1/E5), and originally-hidden messages do **not** reappear (the retirement removes the marker; it does not replay it). Hidden content stays recoverable by the human via `/tree`.
- **Acceptance:** (a) an agent can cancel any `mulligan:rewind`/`mulligan:shrink` by target (content/role hint) or by explicit `markerId`; (b) on the `context` fire after cancellation the transform no longer applies — unit test: cancel a shrink, assert the original message reappears verbatim in the filtered view; cancel a rewind, assert the hidden messages reappear; (c) `mulligan_audit` lists cancelled markers as retired; (d) cancelling a non-existent/already-cancelled id is a safe no-op that returns a reason and never throws (E13). This amends **D6**: agent markers are no longer irrevocably permanent — a mistaken marker is retractable.

## E22. Same-prompt rewind retry loop — runaway growth (REQUIRED; hard backstop)

- **Situation:** the agent calls `mulligan_rewind` and re-lands at the *same* user prompt, then produces work that again triggers a rewind — frequently because it is dutifully following a **self-authored note** whose `next` field re-instructs the very action that caused the previous rewind, or because the re-attempt re-reads the same huge files / re-runs the same broad `grep` (re-bloating between rewinds). A **retry** = any `mulligan_rewind` whose resumed turn lands back at the most recent user message: every `last_turn`, plus a `last_tool_call_group` or `checkpoint` rewind whose resolved target is at/after that user message. Each iteration appends a new `mulligan:rewind` marker + `mulligan:note` + `mulligan:turn-metric` to the on-disk session. Hidden-from-view spans do **not** shrink the on-disk session, and the notes themselves are context, so the session (and the resulting prompt) grows without bound. (Distinct from the **turn-replay** bug in `FIX_TURN_REPLAY_LOOP.md`, which is a *filter* defect fixed by the `turnHasAdvanced` gate — not a marker/retry problem; do not conflate.)
- **Risk (observed in live use):** a single "update the spec" prompt left the agent retrying the same turn for **hours**, each loop enlarging the session, until the provider rejected the next request as **"Prompt too long"** — at which point the human could not even send a new message to break the loop. This is the most severe Mulligan failure mode: resource runaway ending in an unrecoverable hard stop.
- **Required behavior — per-prompt retry budget:** the rewind tool MUST track, per branch, how many rewinds re-land at the **same latest user message** (count every such rewind created since that prompt and not yet advanced past it). When that count reaches `config.rewind.maxRetriesPerPrompt` (**default 5**), the tool MUST refuse *before persisting* and return: `"Mulligan: refused — hit the per-prompt retry budget (<N>/<max> rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again."` This is distinct from E4's total `maxDepth` cap (which bounds *all* active rewind markers): E22 specifically bounds **revisiting one prompt**, which is the runaway signature. `mulligan_shrink`, `mulligan_audit`, `mulligan_checkpoint`, `mulligan_cancel`, and ordinary non-rewind tool work do **not** consume retry budget.
- **Why the note cannot be trusted to self-correct:** the note is written by the same process that is about to loop, so it can encode the loop's cause as an instruction (`next: "set a checkpoint"` → resumes → sets checkpoint → nudge → rewind → note → …). The budget is therefore a *hard* backstop, not advisory.
- **Required behavior — out-of-band context-fraction stop (catches the zero-marker loop vector):** the marker-counting budget above only counts *recorded* rewinds, so it cannot arrest a loop that persists **zero** net markers — pure intra-turn repetition where the model re-reads the same large files every turn because a bloated-result nudge keeps re-firing. For this worst case, the tool MUST additionally keep a hard wall-clock guard: if the filtered-context estimate (the same total `mulligan_audit` computes, `@05-tools.md` §4) is `>= config.rewind.abortContextFraction` (**default 0.9**) of the model's context window AND a rewind is requested, the tool refuses with `"Mulligan: refused — context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result."` This stops the runaway before the provider rejects the request, regardless of retry accounting. It is independent of both `maxDepth` and `maxRetriesPerPrompt` — all three apply.
- **Advisory repeat-detection hint:** if two consecutive rewinds re-land at the same prompt with substantively identical notes (same `what_happened` after trim/lowercase — which now includes the avoid/lesson), the success text for the second one SHOULD append: `"⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."` This steers; the budget/context-fraction stops above are what ultimately refuse.
- **Acceptance:** (a) the first `maxRetriesPerPrompt−1` rewinds re-landing at a given prompt succeed; the Nth (== budget) refuses with the budget text; (b) advancing to a new user prompt resets the budget and the next rewind succeeds; (c) a **zero-hide rewind** (`nothing matched to hide`) still consumes budget — it is the canonical loop vector; (d) `mulligan_shrink`/`audit`/`checkpoint`/`cancel` remain callable after the budget is hit (only prompt-re-landing rewinds are gated); (e) a rewind requested while filtered context ≥ `abortContextFraction` of the window is refused even if budget remains; (f) reaching the budget never throws (E13) and never prevents a normal text reply; (g) unit test: drive a loop that rewinds `last_turn` at the same prompt repeatedly and assert the call refuses exactly at the budget with the named text, and that a subsequent new user prompt restores the budget.
- **Config:** add `config.rewind.maxRetriesPerPrompt` (integer ≥ 1, default 5) and `config.rewind.abortContextFraction` (number in (0,1], default 0.9) to `@09-configuration.md`. Setting `maxRetriesPerPrompt` very high restores old (loop-prone) behavior; setting it to 1 effectively disables same-prompt re-rewinds.

## E23. `mulligan_checkpoint` — exposed to the wrong actor (RESOLVED in v1.1)

- **Situation (v1):** `mulligan_checkpoint` was an *agent* tool, but a checkpoint only pays off when set *before* a mistake — which requires anticipating it. Agents anticipate mistakes poorly (hindsight-only), so spontaneous adoption was near-zero; the tool needed the *user's* foresight but was exposed to the agent.
- **Resolution (v1.1):** checkpoint moved to a **human slash command** `/mulligan_checkpoint` (`@13-human-facing-surface.md` §2); the agent tool is **removed** (`@05` §3). The actor with the foresight (the user) now sets checkpoints; the agent retains `mulligan_rewind(granularity:"checkpoint")` to rewind *to* them. This is path (a) of the original recommendation. The forgetting risk introduced by a long-lived user-set checkpoint is mitigated by the **active-checkpoint banner** (E26). E23 is **closed**.

## E24. Pinned hide no-ops under compaction (KNOWN LIMITATION; leak, not replay)

- **Situation:** compaction rewrites the message list; a pinned rewind's `hideEntryIds` are walked via `resolvePinnedHide` (`@06-context-filter.md` §12), which returns `[]` when the pinned entries fall in the compacted-away head (they no longer map to any current message).
- **Risk (bounded):** originally-hidden content **reappears** in the model's view for that fire — a transient **leak**, not a replay. It is NOT the turn-replay vector (`FIX_TURN_REPLAY_LOOP.md`), which is fixed by the `turnHasAdvanced` gate on the legacy relative path; the pinned path is unaffected by that bug (tested: a new post-compaction read survives).
- **Behavior (v1):** accepted as a bounded, transient limitation (compaction is itself soon superseded; Mulligan reducing context makes compaction fire later and over less). The `filter.invariant` log (`@06-context-filter.md` §12) distinguishes this case from a replay by showing `mode: pinned` with `remove: []`. No v1 fix; rely on the audit trail (`/tree`) for recovery.

## E25. Redundant re-shrink of already-shrunk content (awareness stamp)

- **Situation:** the model calls `mulligan_shrink`, then — failing to attend to the terse `"Mulligan: shrink recorded…"` tool result — issues a *second* shrink against the same (now already-compact) target in the same or a later turn.
- **Behavior (v1):** no hard per-turn block. Instead the filter applies a **render-time `<context-shrunk>` awareness stamp** (`@06-context-filter.md` §5.1) to every shrink's rendered replacement, so the awareness travels with the shrunk message (survives compaction/scroll, unlike a tool-result line). Two safety properties then hold automatically:
  - **Natural dedup:** after a `by_content_includes` shrink, the targeted substring is gone (replaced by the stamped summary), so a redundant same-target call resolves to nothing and the tool returns an honest `Matched: no` — the model is told the truth rather than double-recording.
  - **No false refusal of distinct targets:** because the stamp is per-message (not a global turn counter), a legitimate second shrink of a *different* bloated result still succeeds. A per-turn `appendShrinkMarker` dedup would wrongly block this case and is intentionally NOT used.
- **Stamp is render-only:** the marker's persisted `replacement` stays raw; cancel/audit/restore see the unwrapped summary. `mulligan_cancel` dropping the marker removes the stamp entirely on the next fire (the original content reappears verbatim).
- **Acceptance:** (a) a single shrink's rendered content is wrapped in exactly one `<context-shrunk>…</context-shrunk>`; (b) the stored `replacement` is the raw model text (assert unchanged after `applyShrink`); (c) two seq-ordered shrinks on the same target produce exactly one stamp (never nested).

---

## E26. Active-checkpoint banner — the user forgets they armed destructive power (v1.1)

- **Situation:** a user-set checkpoint grants the agent cross-prompt rewind power for the checkpoint's lifetime, which may span many turns. A one-time set-time warning is insufficient — beyond a certain point the user forgets the checkpoint is active and the power silently remains armed.
- **Risk:** the user loses track that their subsequent prompts are subject to deletion by the agent; the consent that legitimized the power becomes stale-but-still-armed.
- **Behavior (REQUIRED, v1.1 — `@13` §5):** Mulligan maintains a **persistent above-prompt-box banner** via `ctx.ui.setWidget("mulligan:active-checkpoint", [lines], { placement:"aboveEditor" })` while ≥1 active checkpoint exists, cleared (`setWidget(key, undefined)`) when none remain. Each line names a checkpoint and states the agent may rewind across subsequent prompts back to it, with the revoke command. Refreshed on: checkpoint set, checkpoint revoke, checkpoint consumption (a rewind retires its label), `session_start` (so `/resume` restores it), and — defense-in-depth — every `context` fire (the filter already scans checkpoints; reconcile the banner from the active set). Guarded by `ctx.hasUI` (no-op in print/json); disablable via `config.ui.activeCheckpointBanner` (default `true`).
- **Acceptance:** (a) after `/mulligan_checkpoint x`, the banner is visible above the prompt box and persists across turns; (b) after `/mulligan_checkpoint_revoke x` (or consumption), it updates/clears within one fire; (c) `/resume` of a session with an active checkpoint shows the banner on the first inference; (d) the banner is **never** injected into `event.messages` (UI-only — zero model-context cost).

## E27. Model sends an OBJECT param as a JSON-encoded string (REQUIRED; pre-validation shim)

- **Situation:** some models serialize an object-typed tool parameter as a JSON *string* rather than an object — e.g. `mulligan_shrink` called with `target: "{\"by_tool_call_id\": \"call_bash_pclntab\"}"` instead of the object form. (Why the tool body cannot intervene, and why this is distinct from a normal validation error: `@02-proven-constraints.md` C13 — the host validates args **before** `execute()` runs.)
- **Risk:** the host's `Value.Convert` + compiled `Check` cannot coerce string→object, so the call dies pre-validation with `Validation failed … target: must be object` and the requested transform (shrink / rewind / cancel) is **silently lost** — no marker is written, no error reaches the agent to course-correct. On models that exhibit this, the undefended object-param tools are effectively unusable.
- **Required behavior (REQUIRED):** every tool whose schema has an OBJECT-typed parameter MUST register a `ToolDefinition.prepareArguments` shim that JSON-parses each listed key's value when it is a string, replacing it with the parsed value **only if** that value is a non-null, non-array object (the only shape an object-typed schema accepts). Malformed JSON, arrays, and scalars are passed through untouched so the host's normal validation still reports them honestly (clear schema errors, never a silent swallow). Implementation: `src/prepare-args.ts` `prepareObjectArgs<T>(keys)`, wired into the three object-param tools — `mulligan_rewind` (`note`), `mulligan_shrink` (`target`), `mulligan_cancel` (`target`, whose union is structurally identical to shrink's). Scalar-only tools (`mulligan_audit`) are immune and carry no shim.
- **Acceptance:** (a) a JSON-string object param on any of the three tools is accepted and behaves identically to a proper-object call; (b) a proper-object call is unchanged; (c) a malformed JSON string, or a JSON value that is an array/scalar/null, is **not** coerced — it fails validation with a clear schema error; (d) the shim never throws (E13); (e) regression tests run the exact host pipeline (`prepareArguments` → `Value.Convert` → `Compile.Check`) on the literal field-report args, all three `anyOf` arms, markerId-only cancel calls (no `target` → pass-through), and proper-object passthrough.

## Cross-references
- Filter algorithms that implement these behaviors → `@06-context-filter.md`
- Tool refusal conditions → `@05-tools.md`
- Proven host-validation constraint underpinning E27 → `@02-proven-constraints.md` C13
- Config knobs referenced (maxDepth, maxRetriesPerPrompt, abortContextFraction, thresholds, protect) → `@09-configuration.md`