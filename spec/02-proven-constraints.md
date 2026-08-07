# 02 — Proven constraints (do not repeat these dead-ends)

> Every item here was **empirically verified** during the feasibility spike on Pi `0.84.0` (`PI_MODEL=glm-5.2`). The smoke harness that produced the evidence is at `@reference/looper-smoke.proto.ts`; the spike's compressed findings are at `@reference/HANDOFF.md`. If you are tempted to do any of the things below, **don't** — they were tried and they fail in exactly the way described.

---

## C1. A tool cannot mutate the session through `ctx.sessionManager`

**Claim:** `ExtensionContext.sessionManager` is typed `ReadonlySessionManager`, a `Pick` of read methods only. `branch`, `branchWithSummary`, `appendMessage`, `appendCustomMessageEntry`, the mutator `setLabel`, etc. are **absent by type**.

**Evidence:** `dist/core/session-manager.d.ts:140`:
```ts
export type ReadonlySessionManager = Pick<SessionManager,
  "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile" |
  "getLeafId" | "getLeafEntry" | "getEntry" | "getLabel" | "getBranch" |
  "buildContextEntries" | "getHeader" | "getEntries" | "getTree" | "getSessionName">;
```

**Implication for Mulligan:** the only write paths available to a tool are the `ExtensionAPI` methods (`pi.appendEntry`, `pi.sendMessage`, `pi.setLabel`). Mulligan's entire design is built on these three. Do not attempt to "just call `sessionManager.branch()`" — it is not on the type and will not compile/run.

## C2. An extension-injected message does NOT dispatch as a command

**Claim:** `pi.sendUserMessage("/anything", { deliverAs: "followUp" })` (from a tool, mid-turn) and `pi.sendUserMessage("/anything")` (from `agent_settled`, idle) both deliver the slash-string to the model as a **user message**. The command handler never runs. The `input` event *does* fire with `source: "extension"`, but the "extension commands checked first" step is **skipped for extension-source messages**.

**Evidence (two independent tests):**
- FollowUp from a tool: the queued `/looper_flag` was persisted as a `user` message that the model answered; the `looper_followup_flag` marker entry count was **0**; no `A6.looper_flag` log line.
- Idle `sendUserMessage` from `agent_settled`: the `/looper_cmdtest` was likewise persisted as a `user` message; `looper_cmdtest_ran` count **0**.

**Implication for Mulligan:** this kills the entire "tool → follow-up command → command-context operation" pattern. In particular it means:
- An agent tool **cannot reach `ExtensionCommandContext`** — therefore cannot call `navigateTree`, `fork`, `newSession`, `waitForIdle`.
- The documented `reload-runtime.ts` example (which queues `/reload-runtime` as a followUp) is **misleading** — it does not actually dispatch its command either; it hands the string to the model.
- **Real tree-branching rewind is not autonomously triggerable.** Mulligan does not attempt it. (If a human wants a real branch, they use Pi's native `/tree`.)

Mulligan has **no commands** and **never calls `pi.sendUserMessage`**. This is not a limitation we work around; it is a constraint we design around (the `context`-event view filter is the workaround, and it is strictly better for our purpose).

## C3. `navigateTree` is command-context-only (and thus unreachable by the agent)

**Claim:** `navigateTree`, `fork`, `newSession`, `switchSession`, `waitForIdle`, `reload`, `getSystemPromptOptions` exist only on `ExtensionCommandContext`, not `ExtensionContext`.

**Evidence:** `dist/core/extensions/types.d.ts` — `ExtensionContext` ends at `getSystemPrompt()`; `ExtensionCommandContext extends ExtensionContext` adds the session-control methods.

**Implication:** even setting aside C2 (which already blocks reaching command context), these methods are simply not on the context object a tool receives. Mulligan does not use any of them. `navigateTree` was confirmed (via a human-driven command test) to create real, recoverable branches in the JSONL tree — but that only matters to humans, and humans have `/tree`.

## C4. The `context` event is non-destructive and per-inference — and that is exactly what we want

**Claim:** returning `{ messages }` from a `context` handler replaces the list **for that one inference only**. It does not persist to the session. On the next inference, Pi rebuilds `event.messages` from the session afresh.

**Evidence (the core rewind proof):** a "canary" message injected at session start reappeared in every `context.fire` log; once a rewind marker existed, the handler dropped it each time (`context.filter before:5 after:4`, then again `before:7 after:6` on the following inference). The canary never reached the model, but it was re-presented to the handler every turn.

**Implication:** a Mulligan rewind is "permanent" **because the marker persists and the filter re-applies every turn**, not because anything was deleted. This is the design. Do not try to make the filter "stick" by mutating the session — you can't (C1), and you don't need to.

## C5. The filter takes effect on the *next* inference in the same loop, and the model auto-continues

**Claim:** when a tool writes a marker mid-turn, the **next** inference's `context` event sees it and applies it. The model continues automatically (normal agent loop).

**Evidence:** the rewind tool ran (`tool.looper_rewind PASS`), then a second `context.fire` occurred with the marker present and the canary dropped, then a second assistant message was produced. No resume/continuation code was needed.

**Implication:** "auto-prompt after rewind" is free. Do not build a resume mechanism.

## C6. `tool_result` / `message_end` rewrites persist — but only at production time

**Claim:** a `tool_result` handler returning `{ content }` (or `message_end` returning `{ message }`) replaces the stored content, and the replacement **persists to the session JSONL** and reaches subsequent turns.

**Evidence (shrink proof):** a tool returned 2021 chars containing a canary; the `tool_result` handler replaced it with a 46-char `SHRUNK-RESULT`; the model's next turn saw `SHRUNK-RESULT`; the session JSONL stored the 46-char version.

**Implication & caveat:** this is great for **preventive** shrinking (rewrite a bloated result *as it is produced*). But it CANNOT rewrite a **past** result retroactively — by the time the agent decides to shrink an old result, that result is already stored and the `tool_result` event for it has long since fired. **Retroactive shrink is therefore implemented as a view substitution** (a marker the `context` handler honors), not as a real JSONL rewrite. Mulligan exposes both: an optional preventive auto-shrink at `tool_result` time (off by default per D3), and the agent-callable retroactive `mulligan_shrink` (a view substitution). See `@05-tools.md`, `@06-context-filter.md`.

## C7. `pi.appendEntry` returns `void`, not an id

**Claim:** the signature is `appendEntry<T>(customType: string, data?: T): void`.

**Evidence:** the first smoke-test iteration assumed it returned an id and looked the entry up by that id — it failed with an empty result; the entry had nonetheless been appended (the leaf advanced). Fixed by reading `getLeafEntry()` after the call.

**Implication:** to capture a freshly-appended marker's id, call `ctx.sessionManager.getLeafId()` (or `getLeafEntry()`) **immediately after** `pi.appendEntry(...)`, within the same synchronous tick, before any other append. (Markers do not strictly need their own id — they are found by `customType` on read — but the checkpoint feature uses labels which need a target id.)

## C8. `pi.sendMessage` from within a tool is safe and synchronous-ish

**Claim:** calling `pi.sendMessage({customType, content, display})` inside a tool's `execute` appends a `CustomMessage` to the live session, visible as a `custom_message` entry that participates in context, without recursing the agent loop destructively.

**Evidence:** `A2.sendMessage PASS` — `leafType: "custom_message"`, `customType: "looper_probe"`; and the note appeared in subsequent `context.fire` logs (`notePresent: true`).

**Implication:** this is how Mulligan leaves the note. Do not pass `triggerTurn: true` from inside a tool (we are mid-turn); the default behavior is correct. The note becomes the most-recent context the resumed model sees, which satisfies "immediately fed."

## C9. `pi.setLabel` / `getLabel` round-trip works from a tool

**Claim:** `pi.setLabel(entryId, label)` then `ctx.sessionManager.getLabel(entryId)` returns the label.

**Evidence:** `A4.setLabel PASS`. (See `@reference/looper-smoke.proto.ts` `bookmark`-style usage.)

**Implication:** checkpoints are trivial. A checkpoint is just a label on the current leaf. Note `setLabel` is on `ExtensionAPI` (the `pi` object), not on `ReadonlySessionManager` — consistent with C1 (writes go through `pi`, reads through `ctx.sessionManager`).

## C10. Extension-injected messages traverse the `input` event

**Claim:** a message sent via `pi.sendUserMessage` does fire the `input` event (with `source: "extension"`); it simply is not dispatched as a command (C2).

**Evidence:** `input.fire` logged `{ text:"/looper_flag", source:"extension", streamingBehavior:"followUp" }`.

**Implication:** if Mulligan ever wants to *observe* what the agent is being handed (for the nudge or audit), the `input` event is a valid observation point. Mulligan v1 does not need it, but it is available.

## C11. Compaction summarizes the head, not the tail — rewind is a distinct primitive

**Claim:** compaction finds a cut point by accumulating recent tokens (`keepRecentTokens`, default 20k) from the newest message backward, then summarizes everything *older* than the cut and *keeps* everything after.

**Evidence:** `docs/compaction.md` (read during spike) + the `compact()` signature ("Aborts current agent operation first").

**Implication:** "rewind recent wrong-direction work" (shed the tail) is the **opposite direction** from compaction. Mulligan cannot implement rewind as a flavored `/compact`. It is a distinct primitive. (Decision D-affirmation.) Mulligan *can*, however, reduce context so that auto-compaction fires later and over less-important content — a beneficial side effect.

## C12. The session rebinds after certain operations — captured references go stale

**Claim:** after session-replacement flows (`navigateTree`, `fork`, `newSession`, `reload`), previously-captured `ctx.sessionManager` / `SessionManager` handles point at **old** state. This is documented in `docs/extensions.md` ("Session replacement lifecycle and footguns").

**Evidence:** in the `navigateTree` test, the in-command `getBranch()` readback after navigation returned a nonsensical 3-entry list; the **actual** post-navigation topology (read from the JSONL on disk) was a clean branch with the expected structure.

**Implication for Mulligan:** Mulligan does not trigger any rebind operation, so this footgun does not bite us in normal operation. But the **audit** and **filter** code must always read fresh from `ctx.sessionManager.getEntries()` **inside the handler** on each invocation — never cache a session handle across turns. (The filter already does this by design.)

---

## Summary table — what a Mulligan tool may and may not do

| Want | Reachable from a tool? | How |
|---|---|---|
| Persist control state (not in context) | ✅ | `pi.appendEntry(customType, data)` |
| Leave a note (in context) | ✅ | `pi.sendMessage({customType, content, display})` |
| Tag a checkpoint | ✅ | `pi.setLabel(entryId, label)` |
| Read session entries / leaf / labels | ✅ | `ctx.sessionManager.getEntries()` etc. |
| Read token usage (filtered view) | ⚠️ | compute from `event.messages`, **not** `getContextUsage()` |
| Trigger compaction | ✅ (but wrong direction) | `ctx.compact()` — not used for rewind |
| Hide messages from the model | ✅ | `context` event → `{messages}` |
| Rewrite a result at production time | ✅ | `tool_result` event → `{content}` |
| Rewrite a *past* result on disk | ❌ | use view substitution instead |
| Branch the tree | ❌ | command-context only (C3) + unreachable (C2) |
| Dispatch a slash command | ❌ | extension messages bypass dispatch (C2) |
| Mutate `ctx.sessionManager` | ❌ | `ReadonlySessionManager` (C1) |

---

## Cross-references

- Prerequisite surfaces → `@01-pi-context-internals.md`
- How Mulligan uses the reachable surfaces → `@03-architecture.md`