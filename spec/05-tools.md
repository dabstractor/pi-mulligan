# 05 — Tools (the agent-callable API)

> Exact contracts for the **four** agent-callable tools Mulligan registers (`mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`, `mulligan_cancel`). v1.1: `mulligan_checkpoint` is **removed** as an agent tool (§3) and is now a human slash command — see `@13-human-facing-surface.md` for the three commands' contracts. Each section gives: purpose, the typebox parameter schema (copy-pasteable), the return shape, step-by-step behavior, validation rules, error handling, and a usage example. Implement verbatim — the LLM's reliable use depends on stable names, descriptions, and parameter shapes.

**Shared tool conventions:**
- Every tool's `execute(toolCallId, params, signal, onUpdate, ctx)` wraps its body in try/catch; on error it returns a text result describing the failure (never throws — a thrown tool error is noisy and can confuse the loop).
- Every tool result `content` is `[{ type: "text", text: "…" }]`.
- Tools are **write-only w.r.t. the message list** (they never read/transform `event.messages`); `mulligan_audit` is the single read-only exception and even it does not persist.
- Descriptions are written for the LLM: they state *when* to use the tool and *what* it accomplishes, in plain language, with the cost/benefit framing that nudges correct use.
- **Object-typed parameters require a `prepareArguments` shim (REQUIRED).** Some models send an OBJECT param as a JSON-encoded *string*; the host validates args **before** `execute()` and cannot coerce string→object, so an undefended object param makes the call die pre-validation with the transform silently lost (proven constraint C13; edge case E27). The three object-param tools — `mulligan_rewind` (`note`), `mulligan_shrink` (`target`), `mulligan_cancel` (`target`) — MUST register `prepareArguments: prepareObjectArgs<T>([key])` from `src/prepare-args.ts`; it JSON-parses a string-valued object param back into an object pre-validation, passing everything else through untouched. Scalar-only tools (`mulligan_audit`) are immune and set no shim. **Adding a new object-typed parameter without the shim reintroduces field-reported BUG-001 silently** (the failure is invisible — the call never reaches `execute()`).

---

## 1. `mulligan_rewind`

### Purpose
The "mulligan." Shed recent context the agent produced by mistake (a bloated tool interaction, or a whole wrong-direction turn) and leave itself a structured note so the resumed attempt is better-informed. The hidden content disappears from the model's view from the next turn on (permanently) but remains on disk and visible in `/tree`. **The structured self-authored note is Mulligan's flagship UX** — it is what turns a hide into a *better-informed retry*: the resumed model reads `what_happened`/`true_current_state`/`next` and re-plans, rather than blindly repeating the discarded work.

### When the agent should use it
After a tool interaction whose output was far larger than useful, or after realizing a recent turn pursued a wrong approach. The cost of a rewind (a short note + tiny overhead) is far smaller than carrying the bloat for the rest of the task. **Do not** rewind trivial spans — if nothing material was wasted, keep going.

### Parameter schema (typebox)

```ts
import { Type } from "typebox";

const RewindParams = Type.Object({
  note: Type.Object({
    what_happened: Type.String({ description:
      "Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson." }),
    true_current_state: Type.String({ description:
      "The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work." }),
    next: Type.String({ description:
      "Imperative: the immediate next action to take when you resume." }),
  }, { description: "The note your resumed self will read. All three fields required." }),

  granularity: Type.Union([
    Type.Literal("last_tool_call_group"),
    Type.Literal("last_turn"),
    Type.Literal("checkpoint"),
  ], { description:
    "last_tool_call_group = hide just the most recent tool interaction (the assistant turn that issued tool calls + their results). Surgical. " +
    "last_turn = hide all your work after the most recent user message, landing back at that prompt to re-attempt the turn. " +
    "checkpoint = hide back to a named checkpoint you set earlier (requires `checkpoint`)." }),

  checkpoint: Type.Optional(Type.String({ description:
    "Required when granularity=checkpoint. The name of a checkpoint set via the /mulligan_checkpoint command." })),
});
```

### Return shape
```ts
{ content: [{ type: "text", text: string }] }
// text on success:
//   "Mulligan: rewound <granularity>. <K> messages will be hidden from your view
//    starting next turn. Note left. <mutation warning if applicable>."
// text on validation/safety failure:
//   "Mulligan: refused — <reason>. (e.g. would cross a protected message; max depth reached; checkpoint not found; per-prompt retry budget reached; context at abort fraction)"
```

### Behavior (step by step)
1. **Validate config:** if `config.rewind.enabled === false`, return a refusal text. (Allows the human to disable.)
2. **Validate note:** all three `note.*` fields are non-empty after trim. Else return `"Mulligan: refused — note fields must all be non-empty."` (The structured note is the confabulation defense; half-hearted notes are rejected.)
3. **Validate granularity/target:**
   - `last_tool_call_group` / `last_turn`: always valid (the filter resolves them; if there is nothing to rewind, the filter no-ops and the tool still reports success but with K=0 — see step 7).
   - `checkpoint`: the named checkpoint MUST exist on the current branch (scan `getEntries()` for a label `mulligan:checkpoint:<name>`). Else refuse.
3b. **Guardrail — no rewind wipes user input (v1.1 — `@13` §1):** a rewind may hide the agent's own output (tool calls, results, reasoning) but must **never** hide a `user` message. The single exception is `granularity:"checkpoint"` — because checkpoints can be created **only** by the human (`/mulligan_checkpoint` — the agent tool is removed, §3), the user's act of setting one is consent for the agent to rewind across their *subsequent* prompts back to that point. No runtime consent gate is needed: there is no agent path that can create a checkpoint, so a checkpoint's existence IS the consent. `first:user` is unconditionally protected regardless (`protectedOk`, `@06` §8). (v1's `to_previous_prompt` option is **removed** — it discarded the latest user message, violating this guardrail; the checkpoint mechanism is the consented way to rewind further.)
4. **Depth guard:** count active `mulligan:rewind` markers on the branch; if `>= config.rewind.maxDepth`, refuse with a message suggesting `mulligan_shrink` or just continuing. (Prevents runaway marker accumulation.)
   - **Per-prompt retry budget (REQUIRED; spec/08 E22):** additionally count rewinds that re-land at the **same latest user message** — every `last_turn` rewind issued since that prompt and not yet advanced past it (a `last_tool_call_group`/`checkpoint` rewind whose resolved target is at/after that user message counts too). If that count is `>= config.rewind.maxRetriesPerPrompt` (default **5**), refuse *before persisting*: `"Mulligan: refused — hit the per-prompt retry budget (<N>/<max> rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again."` This is the hard backstop against same-prompt retry loops: a self-authored note can otherwise re-instruct the resumed self to repeat the exact action that triggered the rewind, so the note's `next` field alone cannot be trusted to break the loop. Distinct from the total-depth cap — it specifically bounds revisiting one prompt. Advancing to a new user prompt resets the budget. A **zero-hide rewind** (`nothing matched to hide`) still counts toward this budget — it is the canonical loop vector.
   - **Out-of-band context-fraction stop (REQUIRED; spec/08 E22):** independent of the marker counts above, before persisting compute the filtered-context total (the same estimate `mulligan_audit` produces, §4) and the model's context window. If it is `>= config.rewind.abortContextFraction` (default **0.9**) of the window, refuse with `"Mulligan: refused — context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result."` This catches the **zero-marker loop vector** — a spin that persists no rewind yet re-bloats each turn (e.g. re-reading the same large files because a bloat nudge keeps re-firing) — which the marker-counting budget cannot see. All three guards (`maxDepth`, `maxRetriesPerPrompt`, `abortContextFraction`) apply independently.
5. **Compose ledger + note:**
   - Resolve the *target span preview* read-only to extract the file ledger. (The tool MAY do a read-only resolution using the same pure helpers the filter uses, operating on a snapshot from `ctx.sessionManager.buildContextEntries()` converted to messages. This is the one place a tool reads entries — but it does not transform the live context; it only extracts the ledger.) If resolution is ambiguous (e.g. before compaction settles), extract over the available span best-effort; the ledger is advisory.
   - `renderNote(note, ledger, granularity)` → the note string.
6. **Persist:**
   - `pi.appendEntry("mulligan:rewind", { schema, v:1, kind:"rewind", id, granularity, options:{ protect }, excludeToolCallId: toolCallId, seq, note, ledger, ts })`.
   - Immediately capture the marker's entry id: `const markerEntryId = ctx.sessionManager.getLeafId()`.
   - `pi.sendMessage({ customType:"mulligan:note", content: renderedNote, display:true, details:{ schema:"pi-mulligan", v:1, kind:"note", rewindId: id } })`. **(`display:true` is deliberate — it surfaces the note to the operator as well, so the human can see exactly what the model told its resumed self. This is the rewind counterpart of shrink's replacement echo: every self-directed payload is operator-visible.)**
   - Increment the in-memory `seq`.
7. **Mutation warning (if `config.rewind.requireMutationWarning`):** if the ledger's `modifiedFiles` or `bashSideEffects` is non-empty, the success text appends: `"⚠ The hidden span modified files/ran side-effecting commands (see note). Those effects PERSIST on disk; do not blindly redo them."`
8. Return success text (with K = estimated messages to be hidden, computed from the preview resolution; 0 is reported honestly as "nothing matched to hide").

### Notes on resolution timing
The tool records a **spec**, not absolute indices. The filter resolves the spec on each inference against the live message list. So the tool's "K messages" preview is an estimate at call time; the authoritative hiding happens in the filter. This is intentional (D7) and robust to compaction.

### Example
```jsonc
// Agent calls:
mulligan_rewind({
  note: {
    what_happened: "Ran `grep -r auth .` which returned ~38k tokens I didn't need; don't run repo-wide grep without -l or piping to head — use the built-in grep tool which truncates.",
    true_current_state: "No files changed yet this turn. Had only just started the auth-bug search.",
    next: "Re-run as `grep -rl auth src/` then read only src/auth/session.ts."
  },
  granularity: "last_tool_call_group"
})
```

---

## 2. `mulligan_shrink`

### Purpose
Replace the content of one specific tool result **from the current turn** with a compact replacement, persistently, in the model's view — without removing it. Use when a result is too big to carry but too useful to delete entirely, or when only a summary of it is needed going forward. **(v2.0: only current-turn results are eligible — the shrink cannot touch earlier turns.)**

### When to use it (vs `mulligan_rewind`)
- Use **shrink** when the tool call itself was *fine* but its *output* is bloated and you want a compact version to remain as context (e.g. "the test run failed; here's the summary, not the 12k-token log").
- Use **rewind** when the tool call was a *mistake* and you want it (and its output) gone, replaced by a fresh attempt.

### Parameter schema

```ts
const ShrinkParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink — must be a call from the CURRENT turn." }) }),
    Type.Object({ by_tool_name: Type.String({ description: "e.g. 'read', 'bash' — matches only results from the CURRENT turn" }),
                  occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")], { description: "first/last matching result within the current turn" }) }),
  ], { description: "How to identify the CURRENT-TURN tool result to shrink. Only results produced this turn are eligible; earlier turns are out of scope. Resolved live each turn (robust to compaction)." }),

  replacement: Type.String({ description:
    "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on." }),

  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});
```

> **v2.0 — current-turn scope.** The `by_content_includes` arm is **removed**, and both remaining arms resolve **only within the current turn's tool-result span**. A `by_tool_call_id` that resolves in an earlier turn is a **hard refusal**; a `by_tool_name` selector with no match this turn is a **hard refusal** (never a fallback into older history).

### Return shape
```ts
{ content: [{ type:"text", text: "Mulligan: shrink recorded. Matched: yes/no.\nContext updated: 1 result(s) summarized (~<t> tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed." }] }
// The replacement is NOT echoed in the result. Echoing it would place a second
// copy in the model's context — defeating the tool's entire purpose. The operator
// sees the extracted summary via ctx.ui.notify (behavior step 5) at ZERO context
// cost; the model sees only this terse line, then the replacement applied to the
// target message on the next turn. The SECOND line is the v1.2 re-orientation guard
// (bench-stable, exact): it is appended as the FINAL line on every ACTIVE-activation
// path — a persisted marker (k=1 here; a future batched flush emits it once with the
// aggregate k/t) — so the resumed model does not spend turns re-orienting (the bench
// measured +2.4 requests/event without it). Refusals and failed appends never carry
// it (nothing was activated). ~<t> is the NET chars/4 estimate of original minus
// replacement, floored at 0.
```

### Behavior
1. Validate config (`config.shrink.enabled`).
2. Validate `replacement` non-empty.
3. **Match now (best-effort, current-turn-scoped — v2.0 REQUIRED):** resolve `target` against the current snapshot, **restricted to the current turn's tool-result span**. If the selector matches only a result from an EARLIER turn (or `by_tool_call_id` names a call not issued this turn), return a hard refusal: `"Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk."` A currently-unmatched-in-turn selector with a well-formed shape is likewise refused now that scope is exact (there is nothing later in THIS turn it could still match — the pre-v2.0 "might appear before compaction settles" reasoning applied to cross-turn fallbacks, which no longer exist). Structural impossibility (unknown id format, empty tool name) is refused identically.
4. `pi.appendEntry("mulligan:shrink", { schema, v:1, kind:"shrink", id, target, replacement, reason, seq, ts })`.
5. **Notify the operator at zero context cost (REQUIRED):** after persisting, surface the extracted summary to the *human* via `ctx.ui` — a pure UI side-channel that is **never** added to the model's context:
```ts
if (ctx.hasUI) ctx.ui.notify(
  `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>`,
  "info");
```
Guard with `ctx.hasUI` (no-op in print/JSON mode — there is no user to show). The tool RESULT (returned to the model) stays terse — the model does not need its own summary echoed back. `config.shrink.notifyMaxChars` (default **2048**) caps the toast for *UI ergonomics only* (not context); over-cap, append `…(<N> chars total)`. **Why not echo in the result / `sendMessage`:** both enter the model's context. `ctx.ui.notify` is the only user-facing channel that costs zero tokens — the whole point of the tool is to reduce context, so the summary must reach the human without re-entering the model's view.
6. **Return with the re-orientation guard (v1.2, REQUIRED):** the result is the terse feedback line, then — **iff the marker persisted** (`appendShrinkMarker` returned an entry id) — a FIXED final line, verbatim:
```
Mulligan: shrink recorded. Matched: <yes|no>.
Context updated: 1 result(s) summarized (~<t> tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.
```
   The second line is **exact and bench-stable** (a grep contract — do not reword; the exported `shrinkOrientationLine` helper is its single source, so a future batched flush emits the same line once with aggregate `k`/`t` instead of a variant). `~<t>` = NET `estimateTokens` (chars/4) of the matched original minus the replacement, floored at 0 — a persisted-but-currently-unmatched target reports `~0` (the filter live-resolves it later). A failed append persists nothing, so the line MUST NOT appear there; refusal paths (steps 1–3) never reach this step: **"Context updated" must not lie.** Rationale: a bench campaign measured losing sessions averaging **+2.4 requests per rewrite event** re-orienting (re-reading files, re-verifying state); one stable imperative cue at the rewrite point removes that churn. Rewind is deliberately exempt — its orientation travels in the structured self-authored note (`@04-data-model.md` §2.1), which is unchanged.

The filter applies shrinks **after** rewinds and substitutes content in place, preserving `role:"toolResult"`, `toolCallId`, `toolName`, `isError` so the tool pairing invariant holds (C-pairing). Only the `content` array is replaced — and it is wrapped in a render-time `<context-shrunk>` awareness stamp (`@06-context-filter.md` §5.1) so the model has a durable, in-context signal that this message was shrunk and will not redundantly re-shrink already-compact content. The tool result itself stays terse (the stamp is added by the filter at render time, not by the tool); the persisted `replacement` field stays raw.

---

## 3. `mulligan_checkpoint` — REMOVED as an agent tool (v1.1)

> **Moved to a human slash command** — see `@13-human-facing-surface.md` §2. Per E23 (`@08`) a checkpoint only pays off when set *before* a mistake, which needs *foresight* the agent lacks; the actor with the foresight is the **user**. The agent tool is therefore removed. There is **no** agent-callable way to create a checkpoint.
>
> What is **retained**:
> - The agent's `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` (§1) — the agent may rewind *to* a user-set checkpoint.
> - The checkpoint label mechanism (`pi.setLabel(leafId, "mulligan:checkpoint:<name>"`) and **auto-expiry on consumption** (a checkpoint rewound-to is retired so it stops lingering in the active list).

>
> The **guardrail**: a rewind never wipes user input; the one exception is `checkpoint` (the user opted in by setting it). `first:user` stays unconditionally protected. See `@13` §1 and the rewind behavior (§1 step 3b).

---

## 4. `mulligan_audit`

### Purpose (the read-only exception)
Give the agent a token-aware view of its **own** context so its rewind/shrink decisions are informed. Reports per-message token estimates (computed from the *filtered* view — what the model actually sees — NOT `getContextUsage()`), flags outliers, and lists active Mulligan markers. This is the tool that closes the feedback loop: the agent can see "that one read is 9.4k tokens" and decide to shrink it.

### Parameter schema
```ts
const AuditParams = Type.Object({
  top: Type.Optional(Type.Number({ description: "Report only the top N messages by token size. Default 8." })),
});
```

### Return shape
```ts
{ content: [{ type:"text", text: <markdown report> }] }
```
Report format (text):
```md
## Mulligan audit — context you are currently carrying
Total (filtered): ~12,340 tokens  (estimate, confidence: medium)
Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]
Protected: will not rewind past system/first-user/latest-user.

Top messages by size:
  9,412  toolResult  read src/big.log           ⚠ above bloat threshold (20 KB)
  1,840  assistant   (thinking + toolCall x2)
    612  toolResult  grep "auth"
    ...

Suggestion: the `read src/big.log` result is the largest contributor. Consider mulligan_shrink.
```

### Behavior
1. Build the **filtered** message list: take the last `event.messages` snapshot (the filter caches its last output in the session runtime map — `@06-context-filter.md` §7) OR, if unavailable (e.g. audit called before any inference this session), estimate over `buildContextEntries()` converted to messages. Apply the same transforms the filter would, so the audit reflects post-rewind/shrink reality.
2. `estimateTokens` per message; sort desc; take `top`.
3. Read active markers from `getEntries()`.
4. Render the report. Include the suggestion heuristic: any message above its resolved threshold is flagged — `toolResult` messages use their tool's per-tool threshold via `bloatThresholdFor` (`read`: 24 KB, all other tools — including `bash`: the 16 KB global default); every other message uses the global threshold. Each flagged row displays its own resolved threshold; the single largest message is named in the suggestion.
5. Return. **Persist nothing.**

**Why audit must use the filtered view (D5):** `ctx.getContextUsage()` reflects Pi's bookkeeping, which still counts messages Mulligan has hidden. Reporting that number would mislead the agent into thinking a rewind "didn't work." The audit's whole value is honesty about what the model sees.

---

## 5. `mulligan_cancel`

### Purpose (retraction — amends D6)
Retract (cancel) a prior `mulligan_rewind` or `mulligan_shrink` marker so the transform **no longer applies going forward** (spec/08 E21; amends D6 "agent rewinds are permanent" — a mistaken marker is now retractable). The agent identifies the marker to retire **by target** — the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), resolved live each turn. On the **next** `context` fire, `readMarkers` drops the retired marker, so the originally-hidden/shrunk content reappears verbatim in the filtered view (E21 acceptance (b)).

**Why target-based, not id-based:** the toolkit's own operations (`shrink`/`rewind`) can hide the very message that carried an opaque `markerId`, so an id captured at issue-time is fragile *by construction* in this system. A content/role hint re-resolves live each turn — the same compaction-robustness `mulligan_shrink`'s target already enjoys. An explicit `markerId` is accepted as an optional fallback for hosts that surface one.

**What retraction is NOT (forward-only):** cancelling suppresses the marker from the filtered view going forward only. It does **not** undo on-disk side effects (D1/E5 — file edits, bash commands, etc. PERSIST) and does **not** replay hidden content into the live turn. Cancelled markers stay on disk for the audit trail; only the drop from the filtered view takes effect next fire.

### When the agent should use it
When you issued a `mulligan_rewind` or `mulligan_shrink` against the **wrong target** and need to undo it. Without this tool, the mistaken transform would apply on every turn for the rest of the session (a `mulligan_rewind` of the issuing call does NOT retire a marker — markers are `custom` control entries outside the rewind's `hideEntryIds` span). Cancelling a non-existent or already-cancelled id is a safe no-op — call it freely if unsure.

### Parameter schema (typebox)

```ts
import { Type } from "typebox";

const CancelParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of a message the marker affected." }) }),
    Type.Object({ by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
                  occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]) }),
  ], { description: "How to identify the marker to cancel — the SAME (two-arm, v2.0) hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired." }),

  markerId: Type.Optional(Type.String({ description: "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins." })),
}, { description: "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present." });
```

> **v2.0 note:** cancel keeps the two remaining shrink hint arms (`by_tool_call_id`, `by_tool_name`+`occurrence`); `by_content_includes` is removed in lockstep with the shrink tool. Cancel's *marker* resolution is unaffected by the current-turn scope (a marker issued in a previous turn may still be retracted — the marker, not the old content, is what cancel acts on).

### Return shape
```ts
{ content: [{ type: "text", text: string }], details: { cancelled?: boolean; markerId?: string | null } }
// text on success:
//   "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: <the new cancel marker's entry id, or null> }
// text on no-op (no marker matched the target / unknown markerId):
//   "Mulligan: no active marker found for that target — nothing to cancel."
//   details: { cancelled: false }
// text on no-op (already cancelled):
//   "Mulligan: that marker is already cancelled."
//   details: { cancelled: false }
// text on refusal (disabled / unexpected error):
//   "Mulligan: refused — <reason>."   details: {}
```

### Behavior (step by step)
1. **Config gate (E14):** if `config.enabled === false`, refuse with `"Mulligan is disabled"`. There is **no** `config.cancel` sub-knob — retraction is a safety/escape hatch, always available when Mulligan is enabled.
2. **Read entries FRESH (C12):** `entries = ctx.sessionManager.getEntries()`, wrapped in try/catch → `[]` on throw (defense-in-depth; a transient blip yields a no-op, not a refusal).
3. **Resolve the marker to retire:**
   - **Preferred — `target`:** resolve `params.target` against the current message snapshot using the **same pure resolver** `mulligan_shrink` uses (live each turn, robust to compaction). Then collect candidate markers — every active `mulligan:rewind`/`mulligan:shrink` whose effect covers the matched message: a *shrink* covers the message its own `target` resolves to; a *rewind* covers any message in its hidden span (resolved read-only). Pick the **most recent** candidate by `seq` (LIFO — the latest-issued marker affecting that content is the likely mistake). Read its uuid `data.id` via `readOwn`.
   - **Fallback — explicit `markerId`:** if `params.markerId` is set (or `target` resolved to nothing and `markerId` is present), scan `entries` for a custom entry whose `entry.id === params.markerId` AND `customType ∈ {"mulligan:rewind", "mulligan:shrink"}` (excludes notes/turn-metric/cancel); read its uuid `data.id`. If both `target` and `markerId` are given, `markerId` wins.
   - A marker whose `data.id` is unreadable/non-string/empty is treated as not found (malformed marker → safe no-op).
4. **Not-found no-op:** if no marker resolved (target matched no covering marker, and no explicit markerId matched) → return the `"no active marker found for that target"` no-op text + `details:{cancelled:false}`. `appendCancelMarker` is NOT called.
5. **Already-cancelled check (idempotency):** re-scan ALL entries for `customType === "mulligan:cancel"` AND `data.targetId === <the marker's uuid>`. If found → return the `"already cancelled"` no-op text + `details:{cancelled:false}` (prevents duplicate cancel entries). `appendCancelMarker` is NOT called.
6. **Persist:** `appendCancelMarker(pi, ctx, { targetId: <uuid> })` — the `targetId` is the marker's uuid `data.id` (**NOT** the entry id). The wrapper stamps `{schema, v, kind:"cancel", seq, ts}` and calls `pi.appendEntry("mulligan:cancel", entry)`; it never throws (returns `null` on failure). It returns the cancel marker's new entry id (or `null`).
7. **Return:** confirmation text + `details:{cancelled:true, markerId}`. (`cancelled` stays `true` even when `markerId` is `null` — the intent was recorded best-effort.)

The WHOLE body is wrapped in ONE try/catch → refusal `"unexpected error: <msg>"` on any exception (E13 — the tool never throws on the hot path).

### Target resolution → marker uuid (critical)
The agent identifies the marker *by the content it affected* (a `target` hint, same as `mulligan_shrink`), but `readMarkers` drops markers by their uuid `data.id` ∈ `cancelledIds`. So the cancel tool MUST map: `target hint → matched message → covering marker → marker.data.id (uuid)` — and that uuid is the persisted `targetId`. The explicit `markerId` path short-circuits the first two hops (`entry.id → entry.data.id`) for hosts that surface `details.markerId`. Either way, what is persisted is the marker's uuid, **never** an entry id. On the next context fire, `readMarkers` builds `cancelledIds` from every cancel's `data.targetId` and drops the retired rewind/shrink before the pipeline sees it (E21 acceptance (b)).

### Refusal / no-op conditions
- **Disabled** (`config.enabled === false`): refusal text + `details:{}`.
- **No matching marker** (target resolved to no covering rewind/shrink, or an unknown/malformed explicit `markerId`): safe no-op, `details:{cancelled:false}` (not a refusal — call returns a reason, never throws).
- **Already-cancelled** (a `mulligan:cancel` with `data.targetId === uuid` exists): safe no-op, `details:{cancelled:false}` (idempotent).

### Example
```jsonc
// Agent issued a mis-targeted shrink on the last `read`, then retracts it BY TARGET:
mulligan_cancel({ target: { by_tool_name: "read", occurrence: "last" } })
// → "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: "entry-cancel-2" }
// Next context fire: the originally-shrunk message reappears verbatim in the filtered view.

// Explicit-id fallback (only when the host actually surfaces details.markerId):
mulligan_cancel({ markerId: "entry-sh-1" })
```

---

## 6. Tool registration summary (for `index.ts`)

```ts
// 4 agent-callable tools (v1.1: checkpoint removed — now a human command)
pi.registerTool({ name:"mulligan_rewind", label:"Mulligan Rewind", description: RWIND_DESC, parameters: RewindParams, execute: rewindExecute });
pi.registerTool({ name:"mulligan_shrink", label:"Mulligan Shrink",  description: SHRINK_DESC, parameters: ShrinkParams, execute: shrinkExecute });
pi.registerTool({ name:"mulligan_audit", label:"Mulligan Audit", description: AUDIT_DESC, parameters: AuditParams, execute: auditExecute });
pi.registerTool({ name:"mulligan_cancel", label:"Mulligan Cancel", description: CANCEL_DESC, parameters: CancelParams, execute: cancelExecute });

// 3 human slash commands (v1.1 — handlers receive ExtensionCommandContext; capture `pi` via closure)
pi.registerCommand("mulligan_checkpoint",        { description: "Set a named checkpoint. Until revoked, the agent may rewind across your subsequent prompts back to this point.", handler: checkpointCommand });
pi.registerCommand("mulligan_checkpoint_revoke", { description: "Revoke a checkpoint; the agent can no longer rewind to it.", handler: checkpointRevokeCommand });
pi.registerCommand("mulligan_audit",             { description: "Show a token/bloat breakdown of the current context.", handler: auditCommand });
```

Each tool `execute` is `(toolCallId, params, signal, onUpdate, ctx) => Promise<ToolResult>` and delegates to its `tools/*.ts` module, which in turn uses `markers.ts` (write) and the pure helpers (read/resolve). Keep `execute` bodies thin. NOTE: `index.ts` uses the **factory form** for the three tool factories — `pi.registerTool(makeRewindTool(pi))`, `makeShrinkTool(pi)`, `makeCancelTool(pi)` — capturing `pi` via closure (their `execute()` needs `pi` for `appendXxxMarker(pi, …)` but does not receive it). `auditTool` is a plain const. (v1.1: `makeCheckpointTool` is removed — checkpoint is now a human command.) The summary block above shows the equivalent object-literal form for readability. In the real factory form, the three object-param factories additionally set a `prepareArguments` shim (`prepareObjectArgs`) on rewind/shrink/cancel — see "Shared tool conventions" above and C13/E27; `mulligan_audit` takes only scalars and sets none. (Omitted from the readable block because it is a host-compatibility concern, not part of the tool's behavioral contract.)

The three `registerCommand` handlers are `(args: string, ctx: ExtensionCommandContext) => Promise<void>`; they capture `pi` via closure at registration. They are **write-only w.r.t. the model's context** — none injects into `event.messages`. Full command contracts: `@13-human-facing-surface.md`.

### Description strings (craft carefully — they drive LLM usage)
- **Rewind:** `"Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message. granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it)."`
- **Shrink:** `"Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."`
- **Audit:** `"Show a token breakdown of the context you're currently carrying (what the model actually sees), flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to rewind or shrink."`
- **Cancel:** `"Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Identify the marker by \`target\` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit \`markerId\` if you have one. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."`

> (v1.1: the Checkpoint description is removed — checkpoint is now `/mulligan_checkpoint`, a human command described in `@13` §2.)

## 7. Cross-references
- Persisted shapes written by these tools → `@04-data-model.md`
- How the filter consumes the markers → `@06-context-filter.md`
- Edge cases & refusal conditions → `@08-edge-cases.md`
- Proven host constraint requiring the `prepareArguments` shim on object params → `@02-proven-constraints.md` C13 (see also `@08-edge-cases.md` E27)