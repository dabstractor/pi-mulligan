# 12 — Glossary & references

## Glossary

- **Agent loop** — Pi's turn cycle: one model inference (possibly emitting several `toolCall`s) → tool execution → next inference. Ends when the model emits no `toolCall`. The reason "auto-prompt after rewind" is free.
- **Append-only tree** — Pi's session model: entries link via `parentId` into a tree; nothing is ever deleted; branching creates new children. The foundation that makes Mulligan's soft-delete safe and auditable.
- **Audit trail** — the guarantee that hidden content remains on disk and visible in `/tree`, so no rewind is ever silently lost.
- **Bloat reminder** — Nudge A: a `tool_result` annotation appended when a single result exceeds `bloatThresholdBytes`, pointing the agent at `mulligan_shrink`/`mulligan_rewind`.
- **Bookkeeping drift** — the fact that `ctx.getContextUsage()` counts messages Mulligan has hidden, so it cannot be used for honest token reporting. The reason `mulligan_audit` computes from the filtered view (D5).
- **Canary** — a known injected message used in tests to prove a transform took effect (from the spike harness).
- **Checkpoint** — a named label (`mulligan:checkpoint:<name>`) on an entry, targetable by `mulligan_rewind(granularity:"checkpoint")`.
- **`context` event** — the Pi lifecycle hook firing before every LLM call, giving a deep copy of the active-branch messages; returning `{ messages }` replaces that copy for the inference. Mulligan's primary surface.
- **CustomEntry (`custom`)** — an extension-persistence entry that does **not** participate in LLM context. Where Mulligan stores markers and turn-metrics (`pi.appendEntry`).
- **CustomMessage (`custom_message`)** — an extension-injected message that **does** participate in LLM context. Where Mulligan stores the note (`pi.sendMessage`).
- **Drift nudge** — Nudge B: a per-turn, zero-extra-request annotation injected into the `context` copy when the previous turn grew context past `driftThresholdTokens` or hit bloat.
- **File ledger** — the deterministic `{readFiles, modifiedFiles, bashSideEffects}` extracted from tool calls in a span; part of the note's `true_current_state`.
- **Free ride** — the principle (D4) that any per-turn nudge must attach to an inference already happening, costing zero extra model requests.
- **Granularity** — the unit a rewind targets: `last_tool_call_group`, `last_turn`, or `checkpoint`.
- **Hard retry** — replaying prior tool calls with new args. **Rejected** (D1); side effects persist on disk and replay compounds them.
- **Marker** — a persisted `CustomEntry` that instructs the `context` filter (`mulligan:rewind`, `mulligan:shrink`). Control state, not in context.
- **Mulligan** — a courtesy do-over in golf; the project's namesake and its core operation.
- **Nudge** — a cheap, advisory, ride-along reminder (Nudge A or B). Never forces behavior (D3).
- **Pairing (tool pairing)** — the invariant that every `toolCall` has its `toolResult` and vice versa in the message list; the model API rejects orphans. The filter is pairing-aware.
- **Protected message** — a message a rewind may never cross (default: first user message, latest user message).
- **Pure helper** — a function with no Pi dependency, taking data in and returning data out; unit-testable without Pi/​model/​session. Mulligan's correctness lives here.
- **`ReadonlySessionManager`** — the read-only `Pick` of `SessionManager` exposed on `ExtensionContext`. No mutation methods. (C1.)
- **Seq** — the per-session monotonic counter stamped on every marker, used to order transforms deterministically.
- **Shrink** — the operation of replacing a message's content with a compact replacement in the view (`mulligan_shrink`).
- **Soft delete / soft rewind** — hiding messages from the model's view while retaining them on disk. Mulligan's only deletion semantics.
- **Soft retry** — rewind + note + re-plan (no replay). Mulligan's only retry semantics (D1).
- **Span** — a contiguous range of messages targeted by a rewind.
- **State ledger** — the note's `true_current_state` field + file ledger; prevents the resumed agent from redoing side-effectful work (D17).
- **Turn** — per Pi compaction: a user message plus all assistant responses and tool results until the next user message.
- **Turn metric** — a `mulligan:turn-metric` entry recording a turn's token delta + bloat hits; consumed by the drift nudge.
- **Unit (toolGroup)** — the pairing-aware grouping the filter removes atomically: an assistant message containing tool calls + all its result messages.
- **View transform** — the rewriting of `event.messages` by the `context` handler (rewind removal, shrink substitution, nudge injection).
- **`/tree`** — Pi's native interactive browser of the session tree; the human's view into everything Mulligan has hidden.
- **Guardrail (v1.1)** — no rewind wipes user input; the only exception is a checkpoint rewind (the user opted in by setting it). `first:user` is never wiped. (`@13` §1.)
- **Active-checkpoint banner (v1.1)** — the persistent above-prompt-box reminder (`ctx.ui.setWidget(placement:"aboveEditor")`) shown while a user-set checkpoint is armed, so the user does not forget they granted destructive cross-prompt rewind power. (`@13` §5, `@08` E26.)
- **Agent-attributable delta (v1.1)** — the drift nudge's measured token growth excluding `user` messages; only content the agent produced counts as sheddable bloat. (D10, `@07` §2.)
- **Operation (v2.1)** — one `mulligan_rewind` or `mulligan_shrink` tool call (a would-be marker). NOT the budgeted unit.
- **Moment (v2.1)** — a turn in which at least one marker becomes ACTIVE (five parallel shrinks in one turn = five operations, ONE moment). Each moment breaks the provider's prompt cache and re-bills the session tail — the budgeted unit (`rewrites.maxMoments`).
- **Rewrite queue (v2.1)** — per-session list of queued, INERT marker-creating ops (no marker, no event, content fully visible) waiting for a flush trigger. (`@04` §8, `@08` E28.)
- **Flush (v2.1)** — activating ALL queued markers at once (one cache break, not N). Triggers: volume, same-turn batch, audit, compaction (free), safety valve. (`@05` §4, `@08` E28.)
- **Free break (v2.1)** — a point where the cache is already destroyed: a provider compaction, or an audit call at the cap. Queued ops may ride it without spending a moment. (`@06` §10.)
- **Safety valve (v2.1)** — `rewrites.safetyValveTokens`: queued volume strictly above it spends an EXTRA moment and flushes even at the cap, so pathological sessions can still shed. (`@09` §2.)

## References

### Pi documentation (read during the spike; authoritative for the surfaces used)
- Extensions: `docs/extensions.md` (events, `ExtensionContext`, `ExtensionCommandContext`, custom tools, state, UI).
- Session format: `docs/session-format.md` (entry types, `AgentMessage` union, `SessionManager` API, tree structure).
- Compaction: `docs/compaction.md` (head-summarization, `firstKeptEntryId`, cut rules, summary format, file-tracking).
- Settings: `docs/settings.md`.
- Packages: `docs/packages.md` (distributing as a pi package).
- Installed type definitions: `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` (authoritative for signatures).

### Pi examples referenced
- `examples/extensions/truncated-tool.ts` — built-in truncation utilities (`truncateHead`, `DEFAULT_MAX_BYTES/LINES`); calibrates the bloat problem.
- `examples/extensions/send-user-message.ts` — `pi.sendUserMessage` semantics (and, per C2, why commands can't be dispatched this way).
- `examples/extensions/trigger-compact.ts` — `ctx.compact()` from an event handler; `getContextUsage()` usage.
- `examples/extensions/bookmark.ts` — `pi.setLabel` / `getLabel` (checkpoint basis).
- `examples/extensions/custom-compaction.ts` — `session_before_compact` custom summary (not used by v1, but informs the file-ledger shape).

### Project-internal references
- `@SPEC.md` — this spec's master (PRD + overview + index).
- `@reference/HANDOFF.md` — the compressed feasibility-spike findings; the "why" behind every constraint.
- `@reference/looper-smoke.proto.ts` — the proven prototype harness (uses `looper_*` names; the precursor to `mulligan_*`). Adapt it for the integration tests (`@10-testing.md`).

### Decision log (one-line each; full reasoning in `@reference/HANDOFF.md` and `@SPEC.md` §9)
- **D1** Soft retry only; granularities = `last_tool_call_group` + `last_turn`.
- **D2** Roll-our-own structured note + deterministic file ledger; no model summarizer.
- **D3** Advisory preventive reminders (never auto-shrink).
- **D4** Per-turn nudge rides the `context` event (zero extra requests).
- **D5** Audit tokens from the filtered view, never `getContextUsage()`.
- **D6** No undo; agent rewinds permanent; human recovery via native `/tree`. *(Amended by E21: markers are retractable via `mulligan_cancel`.)*
- **D7** Relative targeting for the two granularities (compaction-robust).
- **D8** No human command; no session-tree mutation. *(v1.1: amended — a narrow human slash-command surface + banner are added; session-tree mutation stays forbidden. Full spec `@13`.)*
- **D9** (v1.1) Checkpoint is user-owned; the agent keeps rewind-to-checkpoint, legitimized by the user's opt-in. Checkpoint needs foresight only the user has (E23).
- **D10** (v1.1) Drift/shed-nudges measure agent-attributable growth only; user prompts are exempt (ground-truth, never sheddable bloat).

---

*End of specification. The omnibus document is `SPEC.md` + files `01`–`13` in index order, plus `reference/HANDOFF.md` and `reference/looper-smoke.proto.ts` as proven artifacts. (File `13` and the v1.1 amendments across `01`–`12` introduce the human-facing surface, consent model, active-checkpoint banner, and agent-attributable drift delta.)*