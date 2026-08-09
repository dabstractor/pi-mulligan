# 05 — Tools (the agent-callable API)

> Exact contracts for the five tools Mulligan registers. Each section gives: purpose, the typebox parameter schema (copy-pasteable), the return shape, step-by-step behavior, validation rules, error handling, and a usage example. Implement verbatim — the LLM's reliable use depends on stable names, descriptions, and parameter shapes.

**Shared tool conventions:**
- Every tool's `execute(toolCallId, params, signal, onUpdate, ctx)` wraps its body in try/catch; on error it returns a text result describing the failure (never throws — a thrown tool error is noisy and can confuse the loop).
- Every tool result `content` is `[{ type: "text", text: "…" }]`.
- Tools are **write-only w.r.t. the message list** (they never read/transform `event.messages`); `mulligan_audit` is the single read-only exception and even it does not persist.
- Descriptions are written for the LLM: they state *when* to use the tool and *what* it accomplishes, in plain language, with the cost/benefit framing that nudges correct use.

---

## 1. `mulligan_rewind`

### Purpose
The "mulligan." Shed recent context the agent produced by mistake (a bloated tool interaction, or a whole wrong-direction turn) and leave itself a structured note so the resumed attempt is better-informed. The hidden content disappears from the model's view from the next turn on (permanently) but remains on disk and visible in `/tree`.

### When the agent should use it
After a tool interaction whose output was far larger than useful, or after realizing a recent turn pursued a wrong approach. The cost of a rewind (a short note + tiny overhead) is far smaller than carrying the bloat for the rest of the task. **Do not** rewind trivial spans — if nothing material was wasted, keep going.

### Parameter schema (typebox)

```ts
import { Type } from "typebox";

const RewindParams = Type.Object({
  note: Type.Object({
    what_happened: Type.String({ description:
      "Past tense: what specifically went wrong and wasted context. Be concrete." }),
    avoid: Type.String({ description:
      "Imperative: what NOT to do again on resume." }),
    true_current_state: Type.String({ description:
      "The TRUE current state as of this rewind — files changed, commands run, decisions made on the span being discarded. This prevents redoing work. (A deterministic file ledger is auto-appended.)" }),
    next: Type.String({ description:
      "Imperative: the immediate next action to take when you resume." }),
  }, { description: "The note your resumed self will read. All four fields required." }),

  granularity: Type.Union([
    Type.Literal("last_tool_call_group"),
    Type.Literal("last_turn"),
    Type.Literal("checkpoint"),
  ], { description:
    "last_tool_call_group = hide just the most recent tool interaction (the assistant turn that issued tool calls + their results). Surgical. " +
    "last_turn = hide all your work after the most recent user message, landing back at that prompt to re-attempt the turn. " +
    "checkpoint = hide back to a named checkpoint you set earlier (requires `checkpoint`)." }),

  to_previous_prompt: Type.Optional(Type.Boolean({ description:
    "Only for granularity=last_turn. If true, also discard the most recent user message (nuclear: you abandon the current ask entirely). Default false." })),

  checkpoint: Type.Optional(Type.String({ description:
    "Required when granularity=checkpoint. The name of a checkpoint set via mulligan_checkpoint." })),
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
2. **Validate note:** all four `note.*` fields are non-empty after trim. Else return `"Mulligan: refused — note fields must all be non-empty."` (The structured note is the confabulation defense; half-hearted notes are rejected.)
3. **Validate granularity/target:**
   - `last_tool_call_group` / `last_turn`: always valid (the filter resolves them; if there is nothing to rewind, the filter no-ops and the tool still reports success but with K=0 — see step 7).
   - `checkpoint`: the named checkpoint MUST exist on the current branch (scan `getEntries()` for a label `mulligan:checkpoint:<name>`). Else refuse.
4. **Depth guard:** count active `mulligan:rewind` markers on the branch; if `>= config.rewind.maxDepth`, refuse with a message suggesting `mulligan_shrink` or just continuing. (Prevents runaway marker accumulation.)
   - **Per-prompt retry budget (REQUIRED; spec/08 E22):** additionally count rewinds that re-land at the **same latest user message** — every `last_turn`/`to_previous_prompt` rewind issued since that prompt and not yet advanced past it (a `last_tool_call_group`/`checkpoint` rewind whose resolved target is at/after that user message counts too). If that count is `>= config.rewind.maxRetriesPerPrompt` (default **5**), refuse *before persisting*: `"Mulligan: refused — hit the per-prompt retry budget (<N>/<max> rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again."` This is the hard backstop against same-prompt retry loops: a self-authored note can otherwise re-instruct the resumed self to repeat the exact action that triggered the rewind, so the note's `next` field alone cannot be trusted to break the loop. Distinct from the total-depth cap — it specifically bounds revisiting one prompt. Advancing to a new user prompt resets the budget. A **zero-hide rewind** (`nothing matched to hide`) still counts toward this budget — it is the canonical loop vector.
   - **Out-of-band context-fraction stop (REQUIRED; spec/08 E22):** independent of the marker counts above, before persisting compute the filtered-context total (the same estimate `mulligan_audit` produces, §4) and the model's context window. If it is `>= config.rewind.abortContextFraction` (default **0.9**) of the window, refuse with `"Mulligan: refused — context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result."` This catches the **zero-marker loop vector** — a spin that persists no rewind yet re-bloats each turn (e.g. re-reading the same large files because a bloat nudge keeps re-firing) — which the marker-counting budget cannot see. All three guards (`maxDepth`, `maxRetriesPerPrompt`, `abortContextFraction`) apply independently.
5. **Compose ledger + note:**
   - Resolve the *target span preview* read-only to extract the file ledger. (The tool MAY do a read-only resolution using the same pure helpers the filter uses, operating on a snapshot from `ctx.sessionManager.buildContextEntries()` converted to messages. This is the one place a tool reads entries — but it does not transform the live context; it only extracts the ledger.) If resolution is ambiguous (e.g. before compaction settles), extract over the available span best-effort; the ledger is advisory.
   - `renderNote(note, ledger, granularity)` → the note string.
6. **Persist:**
   - `pi.appendEntry("mulligan:rewind", { schema, v:1, kind:"rewind", id, granularity, options:{ to_previous_prompt, protect }, excludeToolCallId: toolCallId, seq, note, ledger, ts })`.
   - Immediately capture the marker's entry id: `const markerEntryId = ctx.sessionManager.getLeafId()`.
   - `pi.sendMessage({ customType:"mulligan:note", content: renderedNote, display:true, details:{ schema:"pi-mulligan", v:1, kind:"note", rewindId: id } })`.
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
    what_happened: "Ran `grep -r auth .` which returned ~38k tokens I didn't need.",
    avoid: "Don't run repo-wide grep without -l or piping to head; use the built-in grep tool which truncates.",
    true_current_state: "No files changed yet this turn. Had only just started the auth-bug search.",
    next: "Re-run as `grep -rl auth src/` then read only src/auth/session.ts."
  },
  granularity: "last_tool_call_group"
})
```

---

## 2. `mulligan_shrink`

### Purpose
Replace the content of one specific past tool result (or message) with a compact replacement, persistently, in the model's view — without removing it. Use when a result is too big to carry but too useful to delete entirely, or when only a summary of it is needed going forward.

### When to use it (vs `mulligan_rewind`)
- Use **shrink** when the tool call itself was *fine* but its *output* is bloated and you want a compact version to remain as context (e.g. "the test run failed; here's the summary, not the 12k-token log").
- Use **rewind** when the tool call was a *mistake* and you want it (and its output) gone, replaced by a fresh attempt.

### Parameter schema

```ts
const ShrinkParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink." }) }),
    Type.Object({ by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
                  occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]) }),
    Type.Object({ by_content_includes: Type.String({ description: "Shrink the (first) message whose text contains this substring." }) }),
  ], { description: "How to identify the message to shrink. Resolved live each turn (robust to compaction)." }),

  replacement: Type.String({ description:
    "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on." }),

  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});
```

### Return shape
```ts
{ content: [{ type:"text", text: "Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes/no)" }] }
```

### Behavior
1. Validate config (`config.shrink.enabled`).
2. Validate `replacement` non-empty.
3. **Match now (best-effort):** resolve `target` against the current snapshot to (a) give immediate feedback ("matched: yes/no") and (b) reject obviously-invalid targets (e.g. `by_tool_call_id` that does not exist anywhere) — though note a "no match now" is not a hard refusal, because the content might appear before a compaction settles; in that case accept and let the filter keep trying. Use judgement: refuse only if the target is structurally impossible (e.g. unknown id format), not merely currently-unmatched.
4. `pi.appendEntry("mulligan:shrink", { schema, v:1, kind:"shrink", id, target, replacement, reason, seq, ts })`.
5. Return feedback text.

The filter applies shrinks **after** rewinds and substitutes content in place, preserving `role:"toolResult"`, `toolCallId`, `toolName`, `isError` so the tool pairing invariant holds (C-pairing). Only the `content` array is replaced with `[{type:"text", text: replacement}]`.

---

## 3. `mulligan_checkpoint`

### Purpose
Tag the current position with a name so a later `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` can target it precisely. Use before embarking on a speculative/experimental sub-task you might want to undo in one shot.

### Parameter schema

```ts
const CheckpointParams = Type.Object({
  name: Type.String({ description:
    "Checkpoint name. lowercase, digits, hyphen, underscore only; max 40 chars. e.g. 'before-refactor-experiment'." }),
});
```

### Return shape
```ts
{ content: [{ type:"text", text: "Mulligan: checkpoint '<name>' set at entry <id>. Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'<name>')." }] }
```

### Behavior
1. Validate `name` matches `/^[a-z0-9_-]{1,40}$/`. Else refuse.
2. `const leafId = ctx.sessionManager.getLeafId();`
3. `pi.setLabel(leafId, \`mulligan:checkpoint:${name}\`);` (overwrites a prior checkpoint of the same name — labels are unique-per-target; setting the same label on a new target moves it. Acceptable.)
4. Return text with the entry id.

**Design note — exposed to the wrong actor (spec/08 E23):** a checkpoint only pays off if set *before* a mistake, which requires anticipating it. Agents anticipate mistakes poorly (they recognize them only in hindsight), so spontaneous checkpoint adoption will be near-zero; the tool effectively needs the *user's* foresight but is exposed only to the agent. v1 therefore relies on the per-prompt retry budget (E22) as the real backstop and does **not** depend on checkpoints for correctness. A future version should either surface checkpoint to the user directly, or fold its use into the nudge channel (suggest a checkpoint at risky moments, the way the bloat reminder already nudges shrink/rewind).

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
4. Render the report. Include the suggestion heuristic: any message above its resolved threshold is flagged — `toolResult` messages use their tool's per-tool threshold via `bloatThresholdFor` (`bash`: 32 KB, `read`: 20 KB, all other tools: the 16 KB global default); every other message uses the global threshold. Each flagged row displays its own resolved threshold; the single largest message is named in the suggestion.
5. Return. **Persist nothing.**

**Why audit must use the filtered view (D5):** `ctx.getContextUsage()` reflects Pi's bookkeeping, which still counts messages Mulligan has hidden. Reporting that number would mislead the agent into thinking a rewind "didn't work." The audit's whole value is honesty about what the model sees.

---

## 5. `mulligan_cancel`

### Purpose (retraction — amends D6)
Retract (cancel) a prior `mulligan_rewind` or `mulligan_shrink` marker so the transform **no longer applies going forward** (spec/08 E21; amends D6 "agent rewinds are permanent" — a mistaken marker is now retractable). The agent passes the `markerId` it received in `details.markerId` from the issuing `mulligan_rewind` / `mulligan_shrink` call. On the **next** `context` fire, `readMarkers` drops the retired marker, so the originally-hidden/shrunk content reappears verbatim in the filtered view (E21 acceptance (b)).

**What retraction is NOT (forward-only):** cancelling suppresses the marker from the filtered view going forward only. It does **not** undo on-disk side effects (D1/E5 — file edits, bash commands, etc. PERSIST) and does **not** replay hidden content into the live turn. Cancelled markers stay on disk for the audit trail; only the drop from the filtered view takes effect next fire.

### When the agent should use it
When you issued a `mulligan_rewind` or `mulligan_shrink` against the **wrong target** and need to undo it. Without this tool, the mistaken transform would apply on every turn for the rest of the session (a `mulligan_rewind` of the issuing call does NOT retire a marker — markers are `custom` control entries outside the rewind's `hideEntryIds` span). Cancelling a non-existent or already-cancelled id is a safe no-op — call it freely if unsure.

### Parameter schema (typebox)

```ts
import { Type } from "typebox";

const CancelParams = Type.Object({
  markerId: Type.String({ description:
    "The marker id to cancel (the markerId value returned by mulligan_rewind or mulligan_shrink in details.markerId)." }),
});
```

### Return shape
```ts
{ content: [{ type: "text", text: string }], details: { cancelled?: boolean; markerId?: string | null } }
// text on success:
//   "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: <the new cancel marker's entry id, or null> }
// text on no-op (non-existent markerId):
//   "Mulligan: no active marker found with that id — nothing to cancel."
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
3. **Find the target entry (the markerId→uuid mapping):** scan `entries` for a custom entry whose `entry.id === params.markerId` AND `customType ∈ {"mulligan:rewind", "mulligan:shrink"}` (this guard excludes notes/turn-metric/cancel). Read the marker's uuid `data.id` via the defensive `readOwn` helper. A marker whose `data.id` is unreadable/non-string/empty is treated as not found (malformed marker → safe no-op).
4. **Not-found no-op:** if no such entry → return the `"no active marker found"` no-op text + `details:{cancelled:false}`. `appendCancelMarker` is NOT called.
5. **Already-cancelled check (idempotency):** re-scan ALL entries for `customType === "mulligan:cancel"` AND `data.targetId === <the marker's uuid>`. If found → return the `"already cancelled"` no-op text + `details:{cancelled:false}` (prevents duplicate cancel entries). `appendCancelMarker` is NOT called.
6. **Persist:** `appendCancelMarker(pi, ctx, { targetId: <uuid> })` — the `targetId` is the marker's uuid `data.id` (**NOT** the entry id). The wrapper stamps `{schema, v, kind:"cancel", seq, ts}` and calls `pi.appendEntry("mulligan:cancel", entry)`; it never throws (returns `null` on failure). It returns the cancel marker's new entry id (or `null`).
7. **Return:** confirmation text + `details:{cancelled:true, markerId}`. (`cancelled` stays `true` even when `markerId` is `null` — the intent was recorded best-effort.)

The WHOLE body is wrapped in ONE try/catch → refusal `"unexpected error: <msg>"` on any exception (E13 — the tool never throws on the hot path).

### The markerId→targetId indirection (critical)
The agent passes `markerId` = the **ENTRY id** it received as `details.markerId` (= `getLeafId()`) from an earlier rewind/shrink. But `readMarkers` (the `context` filter) drops markers by their uuid `data.id` ∈ `cancelledIds`. So the cancel's `targetId` **MUST** be the marker's uuid `data.id`, never the entry id. The tool **maps**: `entry.id (markerId arg)` → `entry.data.id (uuid)` → that uuid is `targetId`. On the next context fire, `readMarkers` builds `cancelledIds` from every cancel's `data.targetId` and drops the retired rewind/shrink before the pipeline sees it (E21 acceptance (b)).

### Refusal / no-op conditions
- **Disabled** (`config.enabled === false`): refusal text + `details:{}`.
- **Non-existent markerId** (no matching rewind/shrink entry, or a malformed marker): safe no-op, `details:{cancelled:false}` (not a refusal — call returns a reason, never throws).
- **Already-cancelled** (a `mulligan:cancel` with `data.targetId === uuid` exists): safe no-op, `details:{cancelled:false}` (idempotent).

### Example
```jsonc
// Agent issued a mis-targeted shrink, then retracts it:
mulligan_cancel({ markerId: "entry-sh-1" })   // the markerId from the shrink's details.markerId
// → "Mulligan: marker cancelled. The transform will no longer apply from the next turn on."
//   details: { cancelled: true, markerId: "entry-cancel-2" }
// Next context fire: the originally-shrunk message reappears verbatim in the filtered view.
```

---

## 6. Tool registration summary (for `index.ts`)

```ts
pi.registerTool({ name:"mulligan_rewind", label:"Mulligan Rewind", description: RWIND_DESC, parameters: RewindParams, execute: rewindExecute });
pi.registerTool({ name:"mulligan_shrink", label:"Mulligan Shrink",  description: SHRINK_DESC, parameters: ShrinkParams, execute: shrinkExecute });
pi.registerTool({ name:"mulligan_checkpoint", label:"Mulligan Checkpoint", description: CKPT_DESC, parameters: CheckpointParams, execute: checkpointExecute });
pi.registerTool({ name:"mulligan_audit", label:"Mulligan Audit", description: AUDIT_DESC, parameters: AuditParams, execute: auditExecute });
pi.registerTool({ name:"mulligan_cancel", label:"Mulligan Cancel", description: CANCEL_DESC, parameters: CancelParams, execute: cancelExecute });
```

Each `execute` is `(toolCallId, params, signal, onUpdate, ctx) => Promise<ToolResult>` and delegates to its `tools/*.ts` module, which in turn uses `markers.ts` (write) and the pure helpers (read/resolve). Keep `execute` bodies thin. NOTE: `index.ts` uses the **factory form** for the four factories — `pi.registerTool(makeRewindTool(pi))`, `makeShrinkTool(pi)`, `makeCheckpointTool(pi)`, `makeCancelTool(pi)` — capturing `pi` via closure (their `execute()` needs `pi` for `appendXxxMarker(pi, …)` but does not receive it). `auditTool` is a plain const. The summary block above shows the equivalent object-literal form for readability.

### Description strings (craft carefully — they drive LLM usage)
- **Rewind:** `"Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The hidden content disappears from your view permanently (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message."`
- **Shrink:** `"Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."`
- **Checkpoint:** `"Name the current position so a later mulligan_rewind can jump straight back to it. Use before a speculative sub-task you might want to undo in one shot."`
- **Audit:** `"Show a token breakdown of the context you're currently carrying (what the model actually sees), flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to rewind or shrink."`
- **Cancel:** `"Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."`

## 7. Cross-references
- Persisted shapes written by these tools → `@04-data-model.md`
- How the filter consumes the markers → `@06-context-filter.md`
- Edge cases & refusal conditions → `@08-edge-cases.md`