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
- **Situation:** a `last_turn`/`to_previous_prompt`/checkpoint rewind would remove the first user message or the latest user message.
- **Risk:** catastrophic amnesia (lose the original task or the current ask).
- **Behavior:** the tool refuses before persisting (returns a refusal text). The filter also enforces `min(remove) > iFirstUser` as defense-in-depth (no-op + warn log). See `@06-context-filter.md` §8.

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
- **Behavior:** refuse with the reason. `mulligan_checkpoint` validates the name format at creation; `mulligan_rewind` validates existence.

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

## E20. `pi.appendEntry` / `pi.sendMessage` ordering race
- **Situation:** the tool calls `appendEntry` then `sendMessage`; could the note land before the marker in the entry order?
- **Behavior:** both are synchronous appends on the same session; they land in call order (marker first, note second). The filter reads markers from `getEntries()` independently of the note's position, so ordering between them doesn't affect correctness. The note appears after the rewind tool's result in context, which is the desired "most-recent" placement.

---

## Cross-references
- Filter algorithms that implement these behaviors → `@06-context-filter.md`
- Tool refusal conditions → `@05-tools.md`
- Config knobs referenced (maxDepth, thresholds, protect) → `@09-configuration.md`