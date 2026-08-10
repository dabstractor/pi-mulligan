# pi-mulligan — Specification

**Status:** Draft 1.0 · **Target:** Pi `0.84.x` · **License:** MIT · **Name origin:** a *mulligan* is a courtesy do-over in golf — a second shot after a bad one, without penalty. That is exactly what this extension gives the agent.

---

## 0. How to read this document

This is the **master document**. It contains the full Product Requirements Document (PRD) and the architectural overview — enough to understand *what* we are building and *why*. The detailed engineering sections live in companion documents and are linked from the **Index** at the very bottom using `@relative/file/path.md` syntax. A build tool may concatenate the master plus every linked file, in index order, to produce one omnibus specification.

This spec is written so that a **naive dev agent can one-shot the implementation**. That means it does not assume prior knowledge of Pi internals: the prerequisite knowledge is included (see `@01-pi-context-internals.md`), the dead-ends discovered during the feasibility spike are called out so they are not repeated (see `@02-proven-constraints.md`), and the build order is prescribed step-by-step (see `@11-build-order.md`).

Throughout, **MUST / SHOULD / MAY** are used in the RFC 2119 sense.

---

## 1. Executive summary

**pi-mulligan** is a Pi extension that gives a coding agent **autonomous, token-cheap control over its own context window** — the ability to shed context it produced by mistake (a giant un-suppressed command output, a too-large file read, a wrong-direction exploration) and to *redo* a turn with a self-authored note, without a human in the loop.

The core insight, established empirically during the feasibility spike (see `@reference/HANDOFF.md`), is that Pi's conversation is an **append-only tree** that an agent *cannot* structurally mutate from a tool, but the agent **can** drop persisted "view instructions" that the `context` event honors on every subsequent inference. Mulligan exploits this: a rewind is not a deletion — it is a **permanent soft-delete**: a persisted instruction that hides a span of messages from every future copy sent to the model, while the originals remain on disk and visible in `/tree` as an audit trail.

The extension is deliberately minimal. It adds **one mechanism** (persisted markers driving a `context`-event view transform) and **two operations** on top of it (*rewind* = remove a span; *shrink* = replace a message's content), plus two cheap, ride-along *nudges* that help the agent notice when it should use them. It does **not** add any human-facing command, any session-tree mutation, or any new model request — all of which were evaluated and rejected as redundant with Pi's existing `/tree`, `/compact`, and `/fork`.

---

## 2. Problem statement (PRD)

### 2.1 The pain

Agents waste context tokens in predictable, recoverable ways:

1. **Unbounded output capture.** The agent runs a command or search whose output is far larger than it needs (`grep -r foo .` over a monorepo, `cat` on a log, a test runner with verbose output). Even though Pi's built-in tools truncate individual results at ~50 KB / 2000 lines, that is still ~10k tokens per result, and several such results in one turn cause real bloat that persists in every subsequent turn.
2. **Wrong-direction work.** The agent pursues an approach across one or more turns, accumulating tool calls and reasoning, then reaches an insight that invalidates the approach. The work is sunk, but its context footprint continues to tax every future inference and distract the model.
3. **Silent accumulation.** No single result is catastrophic, but the turn grew the context substantially. The agent has no built-in signal that it is drifting toward an auto-compaction it would rather avoid.

### 2.2 Why Pi's existing tools don't solve this

Pi already has powerful context machinery: auto-compaction, manual `/compact`, `/tree` branching with summaries, and `/fork`. These are all **either non-autonomous or wrong-direction for this use case**:

- **Compaction summarizes the *head* and *keeps the tail*.** It sheds *old* context to make room. It cannot shed *recent* wrong-direction work — which is the thing the agent actually wants to undo. (Verified: see `@02-proven-constraints.md`.)
- **`/tree`, `/compact`, `/fork` are human-driven.** The agent **cannot** invoke them. The spike proved that an extension-injected message (`pi.sendUserMessage`) bypasses command dispatch entirely (verified twice), so an agent tool has no route to `navigateTree` or command context. See `@02-proven-constraints.md`.
- **There is no agent-callable primitive** for "forget what I just did and try again." The agent's only self-managed recovery today is to keep going and let auto-compaction eventually kick in — which loses the agent's *intent* (what it would do differently) and operates on whatever is oldest, not on what the agent knows was the mistake.

### 2.3 What we build

Mulligan gives the agent that missing primitive. Concretely, the agent gains the ability to:

- **Rewind** — hide either its *last tool-call group* or its *last full turn*, and leave itself a structured note so the resumed attempt is better-informed.
- **Shrink** — replace a specific past tool result (or message) with a compact summary, persistently, in the view.
- **Checkpoint** — tag the current position with a name, so a later rewind can target it precisely (auto-retired once rewound to, so consumed checkpoints don't accumulate).
- **Audit** — see a token breakdown of its own context (computed from the *filtered* view, not Pi's bookkeeping), so its rewind decisions are informed.
- **Be nudged** — automatically, at near-zero token cost, when a tool result is bloated or a turn grew sharply.

### 2.4 Target users

- **Primary:** the agent itself (Mulligan's "user" is the LLM calling its tools).
- **Secondary:** the human operator, who benefits from cheaper, less-distracted agent runs and can inspect any rewind via Pi's native `/tree`.

### 2.5 Success criteria

1. An agent that captures a bloated tool result can, **autonomously and within the same agent loop**, shed it so that no subsequent inference sees it — proven end-to-end.
2. The total token cost of a rewind (the note + any overhead) is **smaller than** the tokens shed, for any rewind of material size; rewinds of trivial size are discouraged by the audit/nudge logic.
3. The extension **adds zero extra model requests** in steady state (the per-turn nudge rides the existing inference).
4. Hidden content is **never silently lost**: it remains in the session JSONL and is visible in `/tree`.
5. The extension is **non-fatal**: any internal error degrades to a no-op + a log line, never breaking the agent loop.

### 2.6 Non-goals (explicitly out of scope)

- **Hard deletion** of messages. Mulligan never removes anything from disk; it only filters the view.
- **Real tree branching** from an agent tool. Proven impossible (and redundant with `/tree`); see `@02-proven-constraints.md`.
- **Hard retry / replay** of prior tool calls. Mulligan supports *soft* retry only (rewind + note + re-plan). Replaying tool calls is dangerous because hidden tool calls' **side effects persist on disk** (files written, commands run) and replay would compound them. See `@08-edge-cases.md`.
- **Undo / un-rewind.** Agent-initiated rewinds are permanent. (A human who wants to explore hidden content uses Pi's native `/tree`.) See decision log in `@reference/HANDOFF.md`.
- **Human-facing commands.** None. The human side is fully served by `/tree` + `/compact` + `/fork`; a Mulligan command would duplicate built-ins.
- **Cross-session or cross-project rewind.** Mulligan operates within a single session only.
- **Auto-summarization of content via a model call.** Mulligan's notes are agent-authored and its file-ledger is extracted deterministically. It does not spend a model request to summarize. (Optional model-summarization of *very large* rewinds is left as a documented future extension, not v1.)

---

## 3. Design principles

1. **Minimal surface.** One mechanism, two operations, two nudges, a few tools. If a feature can be done with Pi's existing UI, Mulligan does not add it.
2. **Soft over hard.** Never mutate the session tree. Hide from the view; persist the originals. Recoverability and auditability are free byproducts.
3. **Zero extra requests.** Anything that nudges the agent must ride an inference that was already happening. A feature that costs a model call per turn is, by definition, counter to the project's purpose.
4. **Fail open.** Every handler is wrapped so that an exception becomes a logged no-op, never a broken agent turn.
5. **The agent is the user.** Tool names, descriptions, and note contracts are optimized for the LLM's reliable use, not for human ergonomics.
6. **Honest bookkeeping.** Token accounting reported to the agent reflects the *filtered* view (what the model actually sees), never Pi's raw `getContextUsage()` which counts hidden tokens.

---

## 4. High-level architecture

Mulligan is a single Pi extension (one entry file, possibly split into internal modules) that registers:

- **4 agent-callable tools:** `mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`, `mulligan_audit`.
- **1 event-driven context filter:** a `context` handler that is the heart of the extension — it reads persisted *markers* and rewrites the message copy sent to the model.
- **2 preventive hooks:** a `tool_result` annotator (bloated-result reminder) and a `turn_end`→`context` per-turn nudge.

All persistent state is stored as **Pi `CustomEntry`s** (via `pi.appendEntry`) — these do *not* participate in LLM context, which is exactly what we want for control state. The agent's self-authored notes are stored as **`CustomMessage`s** (via `pi.sendMessage`) — these *do* participate in context, which is what we want for the note the resumed model must read.

The data flow on a rewind:

```
agent calls mulligan_rewind(note, granularity)
   │
   ├─ pi.appendEntry("mulligan:rewind", { spec, noteRef, ts })   ← control state (NOT in context)
   ├─ pi.sendMessage({ customType:"mulligan:note", content })     ← the note (IN context)
   └─ tool returns a short confirmation

agent loop continues → next inference fires the `context` event
   │
   └─ context handler:
        1. read event.messages (deep copy of the active branch)
        2. read all mulligan:* markers from ctx.sessionManager.getEntries()
        3. resolve each marker's spec against event.messages
           (rewind → remove a span;  shrink → replace a message's content)
        4. return { messages: transformed }
   │
   └─ model sees [kept prefix] + [note] + [rewind confirmation],
      resumes work — auto-prompt is just the normal agent loop
```

The same `context` handler is also where the per-turn nudge injects its one-line annotation (computed at the previous `turn_end`), and where the audit tool could read the filtered set. There is exactly **one** transform pipeline; operations compose as ordered passes over the message copy.

The architecture is fully detailed in `@03-architecture.md`.

---

## 5. The two operations (plain-language summary)

> Full detail: `@05-tools.md` and `@06-context-filter.md`.

- **Rewind** — the "mulligan." The agent hides a recent span and leaves itself a note. Two granularities:
  - **`last_tool_call_group`** — hide the most recent assistant message that issued tool calls, *together with* its tool-result messages. Surgical: keeps the agent's surrounding reasoning, sheds only the bad tool interaction and its output.
  - **`last_turn`** — hide all agent work (assistant + tool-result messages) produced *after* the most recent user message, leaving that user message in place. The model lands back at the current user prompt, ready to re-attempt the turn with the note. (An option, `to_previous_prompt`, discards the most recent user message too, for the nuclear case.)
- **Shrink** — replace the content of one specific past message (typically a bloated `toolResult`) with a compact replacement, in the view. The replacement persists for as long as the marker exists (permanent soft substitution).

Both are **permanent until... nothing** — there is no undo. They persist across reload and `/resume`.

---

## 6. The two nudges (plain-language summary)

> Full detail: `@07-preventive-and-nudges.md`.

- **Bloated-result reminder.** A `tool_result` hook measures each result; if it exceeds a configurable threshold, the hook appends a short reminder to that result's content telling the agent a rewind is available. The threshold is resolved **per tool** — each tool may carry its own override, falling back to a global default (e.g. `read` gets 24 KB; `bash` uses the 16 KB global because it is the primary bloat surface). This rides the result itself — no extra request.
- **Per-turn drift nudge.** At `turn_end`, Mulligan records how much the context grew that turn and whether it crossed a drift threshold. On the *next* inference, the `context` handler injects a one-line annotation into the message copy (e.g. `[mulligan: last turn +4.2k tokens; rewind available]`). This rides the inference that was already going to happen — **zero extra requests**, ~20 tokens when it fires.

---

## 7. Configuration surface (summary)

> Full detail: `@09-configuration.md`.

Mulligan reads `mulligan` from Pi `settings.json` (global or project-local). Key knobs: bloat threshold (a global default plus an optional **per-tool override map** — `bloatThresholdBytes` = 16384/16 KB; out of the box only `read` is overridden, at 24 KB, while `bash` uses the 16 KB global because it is the primary bloat surface), drift threshold, protected roles (messages that can never be rewound past — default: system, first user task, latest user prompt), max rewind depth, and on/off toggles for each nudge. All have safe defaults; the extension works with zero configuration.

---

## 8. Verification strategy (summary)

> Full detail: `@10-testing.md`.

The feasibility spike already produced a proven smoke harness (`@reference/looper-smoke.proto.ts`) that demonstrates every primitive. The testing plan mirrors it: a deterministic command-based suite for the data layer, and model-driven integration runs that prove the `context`-filter takes effect on the next inference and the model auto-continues. Pass/fail criteria are tied to the same observables used in the spike (message counts in the filtered payload, persisted entry shapes in session JSONL).

---

## 9. Decision log (condensed)

The full reasoning lives in `@reference/HANDOFF.md`. The locked decisions:

| # | Decision | Rationale |
|---|---|---|
| D1 | Soft retry only; granularities = `last_tool_call_group` and `last_turn` | Hard replay compounds persisted side effects |
| D2 | Roll-our-own structured note + deterministic file ledger; no model summarizer | Summarizer describes (abandonment); we need to redirect (retry) |
| D3 | Advisory preventive reminders (not auto-shrink) | Auto-shrink risks discarding data the model needs |
| D4 | Per-turn nudge via `context`-event annotation | Zero extra requests — the project's central constraint |
| D5 | Audit tokens computed from filtered view, not `getContextUsage()` | `getContextUsage()` counts hidden tokens (bookkeeping drift) |
| D6 | No undo; agent rewinds are permanent; human uses `/tree` | Simplicity; `/tree` already serves human recovery |
| D7 | Relative targeting for the two granularities | Robust across compaction (which renumbers entries) |
| D8 | No human command; no session-tree mutation | Redundant with Pi's built-in `/tree`/`/compact`/`/fork` |

> **D6 — amended (marker retraction):** agent `mulligan:rewind`/`mulligan:shrink` markers are **retractable**. Per `@08-edge-cases.md` E21, an agent MAY cancel any marker via `mulligan_cancel`, identifying it **by target** (the same hint shape `mulligan_shrink` uses — `by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`, resolved live each turn, robust to compaction) or by explicit `markerId`; the filter then skips it. This softens D6's "permanent" contract — a mistaken marker is no longer irrevocable. Retraction suppresses the marker going forward only; it does NOT undo on-disk side effects (D1/E5) or replay hidden content.

---

## 10. Glossary (summary)

Full glossary in `@12-glossary.md`. Key terms: **marker** (a persisted `CustomEntry` that instructs the context filter), **view transform** (the rewriting of `event.messages`), **soft-delete** (hidden from model view, retained on disk), **granularity** (the unit a rewind targets), **nudge** (a cheap, ride-along reminder), **ledger** (the deterministic file read/modified record extracted from tool calls).

---

## Index

Read in order for a complete specification. The omnibus = this master + every linked file below.

1. Prerequisite knowledge — how Pi's context actually works — # 01 — Pi context internals (prerequisite knowledge)

> **Audience:** the implementer. This document exists so you do not have to read Pi's source to understand the surfaces Mulligan depends on. Everything here was verified against Pi `0.84.0` installed type definitions and runtime behavior. If anything here contradicts the installed `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts`, **the `.d.ts` wins** — file a note and proceed.

---

## 1. What an extension is

A Pi extension is a TypeScript module exporting a default factory function that receives the `ExtensionAPI` (conventionally named `pi`):

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("context", async (event, ctx) => { /* ... */ });
  pi.registerTool({ /* ... */ });
}
```

Extensions are discovered from `~/.pi/agent/extensions/` (global) or `<project>/.pi/extensions/` (project-local), or loaded ad-hoc with `pi -e ./file.ts`. They are transpiled on the fly by jiti, so TypeScript works without a build step. Imports resolvable: `@earendil-works/pi-coding-agent` (types + utilities), `typebox` (schemas), `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and any `node:` built-in. npm dependencies work if a `package.json` sits next to the extension and `node_modules` is installed.

A factory MAY be async; if so, Pi awaits it before startup. **Do not start long-lived resources (timers, sockets, watchers) from the factory** — defer to `session_start` and tear down in `session_shutdown`. (Mulligan has no long-lived resources.)

## 2. The two context objects

Every event handler and tool `execute` receives a context object. There are two shapes; knowing the difference is load-bearing for Mulligan.

### 2.1 `ExtensionContext` — given to event handlers and tools

```ts
interface ExtensionContext {
  ui: ExtensionUIContext;            // notify, confirm, select, setStatus, setWidget, custom, ...
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;                    // true in tui and rpc; false in print/json
  cwd: string;
  sessionManager: ReadonlySessionManager;   // <<< READ-ONLY. See §4.
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  thinkingLevel?: ThinkingLevel;
  signal: AbortSignal | undefined;   // defined during active turns
  isIdle(): boolean;
  isProjectTrusted(): boolean;
  hasPendingMessages(): boolean;
  abort(): void;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;   // see §6
  compact(options?: CompactOptions): void;       // triggers compaction (head-summarization)
  getSystemPrompt(): string;
}
```

### 2.2 `ExtensionCommandContext` — given only to command handlers

Extends `ExtensionContext` with session-control methods that are **unsafe to call from event handlers** (they can deadlock): `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()`, `getSystemPromptOptions()`.

**Mulligan registers no commands and never touches `ExtensionCommandContext`.** This is deliberate: the spike proved an agent tool cannot reach command context anyway (see `@02-proven-constraints.md`), and the human side is served by Pi's native `/tree`. Do not add a command "for completeness."

## 3. `ExtensionAPI` (the `pi` object) — what tools can actually do

The `pi` object passed to the factory is in scope inside `registerTool`'s `execute`. These are the methods Mulligan uses. Signatures verified against `dist/core/extensions/types.d.ts`.

```ts
// Append extension control state. Returns VOID (not an id). Creates a CustomEntry
// that does NOT participate in LLM context. This is how Mulligan persists markers.
pi.appendEntry<T = unknown>(customType: string, data?: T): void;

// Inject a CustomMessage that DOES participate in LLM context. This is how
// Mulligan leaves the note the resumed model must read.
pi.sendMessage<T = unknown>(
  message: { customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: T },
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): void;

// Tag an entry with a human-readable label (visible in /tree). Used by checkpoint.
pi.setLabel(entryId: string, label: string | undefined): void;

// Register an agent-callable tool. Schema via typebox.
pi.registerTool<TParams, TDetails, TState>(tool: ToolDefinition<...>): void;

// Subscribe to lifecycle / model / tool / session events.
pi.on<E extends keyof Events>(event: E, handler: EventHandler<E>): void;
```

Methods Mulligan **does not** use, and why: `pi.sendUserMessage` (extension-injected messages bypass command dispatch — see `@02-proven-constraints.md` — and Mulligan has no command to dispatch); `pi.registerCommand` (no human commands); `pi.registerShortcut`/`registerFlag` (out of scope).

## 4. The session is an append-only tree; `sessionManager` is read-only

### 4.1 The on-disk format

Sessions are JSONL files under `~/.pi/agent/sessions/--<dashed-cwd>--/<timestamp>_<uuid>.jsonl`. Each non-header line is an **entry**. Every entry has `{ type, id, parentId, timestamp }`. Entries link via `parentId` to form a **tree**; the "leaf" is the current position. Branching creates new children of an earlier entry; **nothing is ever deleted.** This is the single most important fact for Mulligan: there is no mutation, only append + view-filtering.

Entry types relevant to Mulligan:

| `type` | Meaning | Produces an LLM message? |
|---|---|---|
| `session` | header (first line, no id/parentId) | no |
| `message` | a conversation message (`UserMessage`, `AssistantMessage`, `ToolResultMessage`, `BashExecutionMessage`) | **yes** |
| `custom_message` | an extension-injected context message (`CustomMessage`) | **yes** |
| `custom` | extension control state (`CustomEntry`) | **no** ← Mulligan markers live here |
| `compaction` | a compaction summary | yes (summary + optional retainedTail) |
| `branch_summary` | a branch-abandonment summary | yes |
| `label` | a bookmark on a target entry | no |
| `model_change`, `thinking_level_change`, `session_info` | metadata | no |

### 4.2 `ReadonlySessionManager` — the read surface

`ctx.sessionManager` is typed `ReadonlySessionManager`, which is:

```ts
type ReadonlySessionManager = Pick<SessionManager,
  | "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile"
  | "getLeafId" | "getLeafEntry" | "getEntry" | "getLabel"
  | "getBranch" | "buildContextEntries" | "getHeader"
  | "getEntries" | "getTree" | "getSessionName">;
```

It is a `Pick` of **read methods only**. `branch`, `branchWithSummary`, `appendMessage`, `appendCustomMessageEntry`, `setLabel` (the mutator), etc. are **physically absent**. A tool cannot mutate the session through `ctx`. This is not a convention; it is the type. (The full `SessionManager` exists internally, but Mulligan never receives it.)

Read methods Mulligan uses:

```ts
sm.getEntries(): SessionEntry[]          // ALL entries (every branch), excluding header
sm.getBranch(fromId?): SessionEntry[]    // entries from leaf (or fromId) walking to root
sm.getLeafId(): string                   // current leaf id
sm.getLeafEntry(): SessionEntry          // current leaf entry
sm.getEntry(id): SessionEntry | undefined
sm.getLabel(id): string | undefined
sm.buildContextEntries(): SessionEntry[] // active-branch entries with compaction applied
```

**Note:** `buildContextEntries()` returns *entries* (including non-message entries, for TUI rendering). It is **not** the LLM message list. The authoritative LLM message list is `event.messages` inside the `context` event (§5). Use `getEntries()`/`getBranch()` to read control state (markers, labels); use `event.messages` to reason about what the model sees.

## 5. The `context` event — Mulligan's primary surface

Fires **before every LLM call**. Receives a deep copy of the active-branch messages; a handler returns `{ messages }` to replace the list. This is non-destructive: it does not persist; it only shapes the one inference. Because it fires every inference, a persisted marker read inside it is **re-applied automatically on every future turn** — that is what makes a Mulligan rewind "permanent" without any mutation.

```ts
pi.on("context", async (event, ctx) => {
  const messages: AgentMessage[] = event.messages; // deep copy, safe to mutate/replace
  // ... read markers from ctx.sessionManager.getEntries() ...
  return { messages: transformed };
});
```

**Composition & ordering:** multiple `context` handlers chain across extensions in load order. Mulligan MUST be a well-behaved citizen: take `event.messages`, transform, return. Do not drop messages Pi depends on (e.g., never drop the system prompt — it isn't in `event.messages` anyway; never drop a `toolResult` without its originating `toolCall`, see `@06-context-filter.md`).

**`AgentMessage` union** (the elements of `event.messages`):

```ts
type AgentMessage =
  | UserMessage              // { role:"user", content: string | ContentBlock[] }
  | AssistantMessage         // { role:"assistant", content: (Text|Thinking|ToolCall)[] }
  | ToolResultMessage        // { role:"toolResult", toolCallId, toolName, content: ContentBlock[], isError }
  | BashExecutionMessage     // { role:"bashExecution", command, output, ... }
  | CustomMessage;           // { role:"custom", customType, content, display, details }
```

Content blocks:

```ts
{ type:"text", text: string }
{ type:"image", data: string, mimeType: string }
{ type:"thinking", thinking: string }
{ type:"toolCall", id: string, name: string, arguments: Record<string,unknown> }
```

**Critical structural invariant — tool pairing:** an `AssistantMessage` may contain `toolCall` blocks each carrying an `id`; the matching `ToolResultMessage` carries `toolCallId` equal to that id. The model API **rejects** a request that orphans either side. Therefore any view transform that hides one side MUST hide the other. Mulligan's filter is pairing-aware (see `@06-context-filter.md` §3).

## 6. The agent loop & "auto-prompt"

A **turn** = one model inference (which may emit several `toolCall`s) followed by execution of those tools. If the model's message contained any `toolCall`, the harness executes the tools, appends their `toolResult`s, and **calls the model again** — automatically. The loop ends when the model emits a message with no `toolCall` (a final answer) or an error/abort.

**Consequence (central to Mulligan):** when an agent calls `mulligan_rewind`, that tool returns a result, and the loop **automatically** issues the next inference — which fires `context`, which applies the rewind. There is no "resume" code to write. "Auto-prompt" is just the normal agent loop. This was verified in the spike (a second assistant message was produced immediately after the rewind tool returned).

A **turn boundary** (per Pi's compaction docs): a turn *starts* at a user message and includes all assistant responses and tool results until the next user message.

## 7. `getContextUsage()` — and why Mulligan must not trust it

```ts
ctx.getContextUsage(): { tokens: number; /* plus cost/pct fields */ } | undefined
```

Returns the current context token count for the active model. It is **exact** when a recent assistant `usage` is available, otherwise **estimated** for trailing messages. Two problems for Mulligan:

1. **Bookkeeping drift:** it reflects Pi's view of the session, which includes messages Mulligan has hidden via the `context` filter. So after a rewind, `getContextUsage()` still counts the hidden tokens. **Mulligan's audit tool MUST NOT use it** to report "what the model sees." It must estimate from the filtered `event.messages` instead. (See `@05-tools.md` audit, and decision D5.)
2. **Estimate fuzziness:** per-message estimates are approximate, more so with images and tool schemas. Mulligan reports estimates as estimates, with a confidence flag.

## 8. Compaction (so Mulligan can coexist with it)

Auto-compaction triggers when `contextTokens > contextWindow - reserveTokens` (default reserve 16384). It summarizes the **oldest** messages up to a cut point (`firstKeptEntryId`) and keeps everything after. Defaults: `keepRecentTokens` = 20000. It never cuts at a `toolResult` (pairing). A compaction reloads the session.

**Mulligan ↔ compaction interaction:** because Mulligan hides messages in the *view*, compaction still *sees* them and may summarize them. This is mostly fine — but it means a span Mulligan hid could also be summarized into a compaction summary that the model *does* see, briefly, until the next compaction. Mulligan's filter runs **after** Pi builds the context, so it operates on the post-compaction message list and will hide any leaked mulligan-note references consistently. The one real risk is "double work" (compaction summarizes content Mulligan also hid); Mulligan mitigates by reducing context so compaction fires later. See `@08-edge-cases.md`.

## 9. Built-in tool truncation (calibrates the "bloat" problem)

Pi's built-in tools (`read`, `grep`, `bash`, ...) truncate individual results at **50 KB / 2000 lines** (whichever first) and spill full output to a temp file. So a naive command does **not** dump megabytes into context — it dumps ≤~10k tokens plus a pointer. The real accumulation problems Mulligan addresses are: (a) several medium results in one turn, (b) `read` on large files, (c) custom tools the user writes that forget to truncate. Mulligan's bloat threshold should default comfortably below the built-in 50 KB cap (e.g. 16 KB in-context) so it catches meaningful-but-not-catastrophic bloat. See `@09-configuration.md`.

## 10. Modes (`ctx.mode`)

`"tui"` | `"rpc"` | `"json"` | `"print"`. `hasUI` is true in tui/rpc, false in print/json. The agent loop and `context` event fire in **all** modes. `pi.sendMessage`/`pi.appendEntry` work in all modes. `pi.sendUserMessage` followUp dispatch of commands does **not** work in print mode (and is unreliable generally — see `@02-proven-constraints.md`); Mulligan avoids it entirely. UI helpers (`ctx.ui.notify`, etc.) are no-ops or default-returning in non-UI modes — guard with `ctx.hasUI` if you call them, but prefer logging to a file for testability.

---

## Cross-references

- What you **cannot** do (and why) → `@02-proven-constraints.md`
- How Mulligan uses these surfaces → `@03-architecture.md`
- Exact message/entry shapes for markers & notes → `@04-data-model.md`
2. Proven constraints from the feasibility spike (do not repeat these dead-ends) — # 02 — Proven constraints (do not repeat these dead-ends)

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
3. Architecture — the unified marker + context-event design — # 03 — Architecture

> This document specifies the **shape** of Mulligan: its components, their responsibilities, how data flows between them, and why this shape (and not the alternatives that were rejected). The precise data shapes are in `@04-data-model.md`; the algorithms are in `@06-context-filter.md` and `@07-preventive-and-nudges.md`.

---

## 1. One-sentence architecture

**Mulligan persists lightweight "markers" as Pi `CustomEntry`s, and a single `context`-event handler reads those markers on every inference and rewrites the message copy sent to the model — hiding spans (rewind), substituting message content (shrink), and injecting a one-line nudge — all without ever mutating the session tree and without ever spending an extra model request.**

## 2. Components

```
┌──────────────────────────────────────────────────────────────────────┐
│  pi-mulligan extension (one entry file, internal modules)             │
│                                                                       │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐ │
│  │  TOOLS (agent-callable)       │   │  EVENT HANDLERS              │ │
│  │  • mulligan_rewind            │   │  • context  (the filter)     │ │
│  │  • mulligan_shrink            │   │  • tool_result (bloat anno.) │ │
│  │  • mulligan_checkpoint        │   │  • turn_end  (drift metric)  │ │
│  │  • mulligan_audit             │   │  • session_start (init)      │ │
│  └───────────┬──────────────────┘   └──────────────┬───────────────┘ │
│              │ writes markers/notes via pi.*        │ reads markers   │
│              ▼                                      ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  PERSISTED STATE (Pi CustomEntries / CustomMessages, in JSONL)   │ │
│  │   mulligan:rewind marker   mulligan:shrink marker                │ │
│  │   mulligan:checkpoint label mulligan:note (context message)      │ │
│  │   mulligan:turn-metric (drift telemetry)                         │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  PURE HELPERS (no Pi surface; unit-testable)                     │ │
│  │   resolveRewind()  resolveShrink()  applyTransforms()            │ │
│  │   extractFileLedger()  estimateTokens()  findToolCallPairs()     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tools (`@05-tools.md`)

Four tools, each a thin wrapper: validate input → write the appropriate marker(s)/note via `pi.*` → return a short confirmation. **Tools never read or transform the message list** — that is the filter's job. Keeping tools write-only and the filter read-only makes the system easy to reason about and unit-test (the transform logic lives in pure helpers).

- `mulligan_rewind(note, granularity, options?)` — append a rewind marker + the note.
- `mulligan_shrink(target, replacement)` — append a shrink marker.
- `mulligan_checkpoint(name)` — label the current leaf.
- `mulligan_audit()` — **read-only exception**: computes a token breakdown from the last-known filtered view and returns it as the tool result. (It does not persist anything; it reads markers + estimates tokens. See `@05-tools.md` §4.)

### 2.2 Event handlers

- **`context` (the filter)** — the heart. On every inference: read all `mulligan:rewind` and `mulligan:shrink` markers from `ctx.sessionManager.getEntries()`; resolve each against `event.messages` via the pure helpers; compose the transforms in a defined order; inject the per-turn nudge if the latest `mulligan:turn-metric` warrants it; return `{ messages }`.
- **`tool_result`** — measures result size; if above the bloat threshold, appends a short reminder line to the result content (advisory, per D3). Optionally (off by default) records a candidate for auto-shrink.
- **`turn_end`** — computes the turn's token delta (using cached "tokens at turn_start" minus "tokens at turn_end", or an estimate) and appends a `mulligan:turn-metric` entry consumed by the next `context` fire for the nudge.
- **`session_start`** — initializes per-session in-memory caches (e.g., the running token baseline). No long-lived resources.

### 2.3 Pure helpers (`@06-context-filter.md`)

All transform logic is extracted into pure functions taking `(messages, marker, config)` and returning a new message array. This is the single most important testability decision: **the entire correctness surface of Mulligan is unit-testable without Pi, without a model, and without a session.** The Pi-facing code is glue.

Key helpers:
- `findToolCallPairs(messages)` — maps every `toolCall` id to its `toolResult` index and vice versa, for pairing-aware hiding.
- `resolveLastToolCallGroup(messages, excludeToolCallIds)` — returns the index range of the most recent assistant message containing tool calls + its result messages.
- `resolveLastTurn(messages, { toPreviousPrompt })` — returns the index range of the most recent turn's agent work.
- `applyRewind(messages, range)` — pairing-aware removal.
- `applyShrink(messages, target, replacement)` — content substitution.
- `extractFileLedger(messages, range)` — deterministic `readFiles`/`modifiedFiles` extraction over a span (for the note's state ledger).
- `estimateTokens(messages, model?)` — character/structure-based estimate with a confidence flag.

## 3. Data flow

### 3.1 A rewind, step by step

```
1. Agent decides its last tool-call group was a mistake.
2. Agent calls mulligan_rewind({
     note: { what_happened, true_current_state, next },
     granularity: "last_tool_call_group"
   }).
3. Tool:
   a. validates the note fields (all three MUST be non-empty — see @05-tools.md).
   b. resolves the target range NOW is not possible (the tool must not read the
      message list — see §2.1). Instead it records the granularity + a timestamp
      + a "turn index at call time" snapshot, and lets the FILTER resolve it
      against the live message list on the next inference.
   c. pi.appendEntry("mulligan:rewind", { id, granularity, note, excludeSelf,
      options, ts, sessionTurn })   ← control state, NOT in context
   d. pi.sendMessage({ customType:"mulligan:note",
        content: renderNote(note, ledger), display:true })   ← IN context
   e. returns { content:[{type:"text", text:"Rewound <granularity>. Note left. <N> messages will be hidden from your view from the next turn."}] }
4. Agent loop continues → next inference → `context` fires.
5. Filter:
   a. messages = event.messages (deep copy)
   b. markers = ctx.sessionManager.getEntries().filter(mulligan:*)
   c. for each rewind marker (oldest first): range = resolve*(messages, marker);
      messages = applyRewind(messages, range)   // pairing-aware
   d. for each shrink marker: messages = applyShrink(messages, ...)
   e. inject nudge if mulligan:turn-metric warrants
   f. return { messages }
6. Model sees [kept prefix] + [mulligan:note] + [rewind confirmation],
   continues the task — auto-prompt is the normal loop (C5).
```

**Why the tool defers resolution to the filter** (rather than resolving the range in the tool and storing absolute indices): absolute indices are **invalidated by compaction** (which renumbers/replaces the message list) and by other transforms. Storing a *spec* (`granularity` + `excludeSelf` + relative anchors) and resolving it fresh on each inference against the *current* message list is robust by construction. This is decision D7 made concrete.

### 3.2 A shrink, step by step

```
1. Agent identifies a specific past result it wants to compact (e.g. a huge read).
2. Agent calls mulligan_shrink({
     target: { match: "last_tool_result_of", toolName: "read" }  // or by content substring
     replacement: "Summarized: <agent-authored summary>"
   }).
3. Tool: pi.appendEntry("mulligan:shrink", { target, replacement, ts }).
4. Next inference → filter: messages = applyShrink(messages, target, replacement).
5. Model sees the compact replacement in place of the original from this turn on.
```

`mulligan_shrink` targets are **matcher-based**, not index-based, for the same compaction-robustness reason. Supported matchers: `{toolCallId}`, `{toolName, occurrence:"last"|"first"}`, `{contentIncludes: substring}`. See `@06-context-filter.md` §5.

### 3.3 The per-turn nudge, step by step (`@07-preventive-and-nudges.md`)

```
1. turn_end fires. Handler computes delta = estimateTokens(event? ) ...
   (turn_end does not receive messages; see §4 of this doc for the metric source.)
   Appends mulligan:turn-metric { deltaTokens, grewOverThreshold, bloatHit }.
2. Next inference → context filter: shouldNudge (windowed; @07 §5.1) fires on
   SUSTAINED total-context growth (windowed deltaTokens > driftThresholdTokens).
   bloatHit is NOT a firing condition when delta data exists (redundant with Nudge A;
   reserved for the no-delta fallback). Append a one-line annotation to the message
   copy: "[mulligan: last turn +4.2k tokens; rewind/shrink available]".
   (Rides the existing inference — zero extra requests.)
```

## 4. Where each piece of information lives

| Information | Stored as | In LLM context? | Lifetime |
|---|---|---|---|
| Rewind marker (spec + note + metadata) | `CustomEntry` via `pi.appendEntry("mulligan:rewind", …)` | **no** | permanent (until... nothing) |
| Shrink marker | `CustomEntry` `mulligan:shrink` | no | permanent |
| The note itself (what the resumed model reads) | `CustomMessage` via `pi.sendMessage({customType:"mulligan:note"})` | **yes** | permanent (it is a real message) |
| Checkpoint | `LabelEntry` via `pi.setLabel` | no | permanent |
| Turn metric (for nudge) | `CustomEntry` `mulligan:turn-metric` | no | ephemeral-in-effect: only the latest is read; old ones ignored (but persist on disk like all entries) |
| Filter transform results | nowhere (recomputed each inference) | — | per-inference |
| In-memory caches (token baseline, etc.) | module-scoped `Map<sessionId, …>` | — | per-session, reset on `session_start` |

**Why markers are `CustomEntry` and notes are `CustomMessage`:** control state must NOT pollute the model's context (a growing list of internal markers would itself be bloat); the note MUST be in context (the resumed model has to read it). Pi's two extension-persistence primitives map perfectly onto these two needs. (C1, C8.)

## 5. Ordering, composition, and idempotency

The filter applies transforms in a **fixed order** so behavior is deterministic regardless of how many markers accumulate:

1. **Resolve & apply rewinds** (oldest marker first). Each removal mutates the working array; later rewinds resolve against the already-reduced array. (Two rewinds compose: the second is resolved on the post-first-removal list.)
2. **Resolve & apply shrinks** (oldest first), on the post-rewind array.
3. **Inject nudge** (append one annotation message), on the post-transform array, only if the latest metric warrants.
4. Return the array.

**Idempotency:** every operation is idempotent w.r.t. re-firing. A rewind marker whose target range has already been removed (e.g. by an earlier rewind in the same pass, or because the span was compacted away) resolves to an empty range and is a no-op. A shrink whose target no longer matches is a no-op. This is essential because the filter runs every inference. (Verified spirit in the spike: the canary was re-dropped each fire.)

**Fail-open:** every stage is wrapped in try/catch; on any exception, log and return the input array unchanged. The model always gets a coherent message list.

## 6. Why this shape (rejected alternatives)

- **"Just mutate the session / branch the tree."** Impossible from a tool (C1, C2, C3). And unnecessary — view-filtering achieves the goal non-destructively with a free audit trail.
- **"Resolve the rewind range in the tool and store absolute indices."** Invalidated by compaction. Store a spec; resolve live. (D7.)
- **"Use `message_end`/`tool_result` to rewrite content for rewind."** Those only fire at production time and cannot retroactively rewrite past messages (C6). Retroactive changes are view-substitutions.
- **"Auto-summarize the abandoned span with a model call for the note."** Costs a request and *describes* rather than *redirects* (D2). The note is agent-authored and prescriptive; the file ledger is extracted deterministically.
- **"Add a human `/mulligan-rewind` command."** Redundant with `/tree`+`/compact`; adds surface for no novel value (D8).
- **"Make the nudge a separate reflection request."** Violates the zero-extra-requests principle (D4). The nudge rides the existing inference.
- **"Persist the filtered message list so the filter doesn't recompute."** Cannot (C1, C4); and recomputing is cheap and guarantees correctness against compaction. Embrace recompute.

## 7. Module layout (internal)

The extension entry (`index.ts`) wires the components; internal modules keep concerns separated and testable:

```
src/
  index.ts            // factory: registers tools + handlers, wires config
  config.ts           // load + validate settings; defaults
  markers.ts          // appendEntry/setLabel/sendMessage wrappers + id capture
  filter.ts           // the context handler + ordering + fail-open
  transforms.ts       // PURE: resolveRewind, resolveShrink, applyRewind, applyShrink, findToolCallPairs
  ledger.ts           // PURE: extractFileLedger (deterministic read/modified files)
  tokens.ts           // PURE: estimateTokens(messages, model?) + confidence
  notes.ts            // PURE: renderNote(note, ledger) + field validation
  tools/
    rewind.ts
    shrink.ts
    checkpoint.ts
    audit.ts
  nudges.ts           // tool_result annotator + turn_end metric + context nudge injection
  log.ts              // structured file logger (testability)
```

Everything under `transforms.ts`/`ledger.ts`/`tokens.ts`/`notes.ts` is **pure and unit-testable without Pi**. The Pi-coupled files (`markers.ts`, `filter.ts`, `tools/*`, `nudges.ts`) are thin and exercised by the integration smoke tests.

## 8. Cross-references

- Exact schemas for every persisted shape → `@04-data-model.md`
- Tool contracts → `@05-tools.md`
- The filter algorithm in full → `@06-context-filter.md`
- Nudges in full → `@07-preventive-and-nudges.md`
4. Data model — markers, notes, ledgers, schemas — # 04 — Data model

> Authoritative schemas for every shape Mulligan persists or passes internally. Implement these **exactly** (field names, casing, optionality) — the filter, the tools, and the tests all depend on them. All persisted shapes are JSON-serializable (they live in JSONL).

---

## 1. Versioning

Every persisted `CustomEntry` written by Mulligan includes a `v` (schema version, integer) and a `schema: "pi-mulligan"` tag inside its `data`. This lets future versions migrate or ignore unknown entries. **v1** is the version specified here.

```ts
interface MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind" | "shrink" | "turn-metric" | "cancel";
  // ...kind-specific fields...
}
```

All `customType` strings are namespaced under `mulligan:`. The `customType` is the entry's *Pi-level* discriminator (what `getEntries()` filters on); `kind` is the *Mulligan-level* discriminator inside `data`.

| Pi `customType` | Pi entry type | `data.kind` | In LLM context? |
|---|---|---|---|
| `mulligan:rewind` | `custom` | `"rewind"` | no |
| `mulligan:shrink` | `custom` | `"shrink"` | no |
| `mulligan:turn-metric` | `custom` | `"turn-metric"` | no |
| `mulligan:cancel` | `custom` | `"cancel"` | no |
| `mulligan:note` | `custom_message` | (n/a — it's a message) | **yes** |
| (checkpoint) | `label` | (n/a) | no |

## 2. The note (input + rendered)

### 2.1 `NoteInput` — what the agent passes to `mulligan_rewind`

All three fields are **required and non-empty** (enforced by the tool; see `@05-tools.md`). Free text, but each field has a mandated purpose. This structure is the primary defense against confabulation (D/D17): the resumed model is told explicitly what happened (and what to avoid), what the true state is, and what to do next.

```ts
interface NoteInput {
  /** What went wrong, concretely (past tense), AND the lesson — what to avoid
   *  doing again. Generalize the lesson. e.g. "Ran `grep -r auth .` and dumped
   *  ~40k tokens I didn't need; don't run repo-wide grep without -l or piping
   *  to head — use the built-in grep tool which truncates." */
  what_happened: string;

  /** The current TRUE world state as of the rewind — task progress, decisions,
   *  and conclusions. This is the state-ledger that prevents redoing work. The
   *  tool AUGMENTS this with a deterministic file ledger (see §3) that
   *  auto-captures files/commands, so focus this field on what the ledger
   *  cannot: decisions and where the task stands. */
  true_current_state: string;

  /** The immediate next action to take on resume. Imperative. e.g. "Re-run the
   *  search as `grep -rl auth src/` and read only the 3 relevant files." */
  next: string;
}
```

### 2.2 `FileLedger` — deterministically extracted, appended to the note

Extracted from the tool calls in the rewound span (NOT a model call). Feeds `true_current_state`. Mirrors the shape Pi's own compaction uses for cumulative file tracking, so it is familiar.

```ts
interface FileLedger {
  readFiles: string[];      // paths appearing in read/grep tool calls in the span
  modifiedFiles: string[];  // paths appearing in write/edit tool calls in the span
  bashSideEffects: string[];// non-read bash commands (heuristic: commands with >, rm, mv, mkdir, git, curl, etc.)
}
```

Extraction rules (`extractFileLedger` in `ledger.ts`, pure):
- `readFiles`: union of `path`/`file_path` args from tool calls whose `name` ∈ {`read`, `grep`, `rg`, `glob`}.
- `modifiedFiles`: union of `path`/`file_path` args from tool calls whose `name` ∈ {`write`, `edit`, `bash`} (for bash, only when the command matches a write heuristic AND a path can be parsed — best-effort; uncertain entries go to `bashSideEffects`).
- `bashSideEffects`: bash commands in the span that are not provably read-only (regex heuristic; when in doubt, include).
- De-duplicated, sorted. Relative to `cwd`.

### 2.3 Rendered note (the `CustomMessage` content)

The tool composes the note the model sees from `NoteInput` + `FileLedger`:

```md
## 🔄 Mulligan rewind (<granularity>)

**What happened:** <what_happened>

**Current true state:** <true_current_state>

<files-read>
path/a.ts
path/b.ts
</files-read>

<files-modified>
path/c.ts
</files-modified>

<bash-side-effects>
git commit -m "wip"
</bash-side-effects>

**Next:** <next>
```

The `<files-read>` / `<files-modified>` / `<bash-side-effects>` block tags mirror Pi's compaction summary convention, so a model accustomed to compaction summaries parses them naturally. If a ledger list is empty, omit its block. The agent-supplied `true_current_state` text is rendered as-is (rendered verbatim; the ledger is the authoritative file/command set, presented separately — so focus this field on decisions and task progress, not files the ledger already covers).

`renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string` is pure and unit-tested with snapshot-style cases.

## 3. Marker: rewind

Stored via `pi.appendEntry("mulligan:rewind", data)`. The `data`:

```ts
interface RewindMarker extends MulliganEnvelope {
  kind: "rewind";
  id: string;                 // mulligan-internal uuid; also used to correlate with the note
  granularity: "last_tool_call_group" | "last_turn";
  options: {
    to_previous_prompt?: boolean;   // only meaningful for "last_turn"; default false
    protect?: string[];             // role list that must not be crossed (default from config)
  };
  /** toolCallId of THIS rewind's own tool call, so the filter can exclude the
   *  rewind's own group when resolving "last tool-call group". Captured from the
   *  tool execute()'s toolCallId argument. */
  excludeToolCallId?: string;
  /** Stable ENTRY IDs of the messages to hide, pinned ONCE at marker-creation time
   *  (by `captureHideEntryIds` in the rewind tool's creation-time snapshot). When
   *  present + non-empty, `filterPipeline` resolves them by identity → current
   *  message indices via `resolvePinnedHide` (`@06-context-filter.md` §12),
   *  guaranteeing PERMANENT soft-delete hiding across session growth (fixes
   *  BUG-001 leak-back + BUG-002 infinite loop: relative specs re-target onto
   *  new work; pinned entry IDs do not). Holds ENTRY ids (stable Pi
   *  SessionEntryBase.id UUIDs), NOT message indices (which shift on compaction).
   *  OPTIONAL for backward compatibility: absent (old markers, or when capture
   *  failed) → `filterPipeline` falls back to granularity-based relative
   *  re-resolution. See `@06-context-filter.md` §3/§4/§6/§11. */
  hideEntryIds?: string[];
  /** Monotonic per-session counter, so the filter can order markers reliably
   *  even if timestamps tie. Maintained in memory + snapshotted in the marker. */
  seq: number;
  /** The note payload, duplicated here for self-containment (the rendered note
   *  also lives in the mulligan:note CustomMessage; this is the structured form
   *  for audit/debugging and potential future tooling). */
  note: NoteInput;
  ledger: FileLedger;
  ts: number;                 // Date.now() at append
}
```

**Why store the note in the marker too?** The marker is control state (not in context); the note is a context message. Storing the structured note in the marker makes the marker self-describing for `/tree` inspection and future tooling, at no context cost. It is a duplicate-by-design.

The `mulligan:note` `CustomMessage` is appended **immediately after** the marker, via `pi.sendMessage`, with `display: true`. Its `details` (the `CustomMessage` details field) carries `{ schema:"pi-mulligan", v:1, kind:"note", rewindId: <marker.id> }` for correlation.

## 4. Marker: shrink

Stored via `pi.appendEntry("mulligan:shrink", data)`:

```ts
type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink";
  id: string;
  target: ShrinkTarget;
  /** The replacement content (text). The filter substitutes the matched
   *  ToolResultMessage's content with [{type:"text", text: replacement}] and
   *  preserves isError/toolName/toolCallId so the API stays valid. */
  replacement: string;
  /** Optional reason, surfaced in audit. */
  reason?: string;
  /**
   * Pinned stable ENTRY id of the message the target matched at marker-creation time (FINDING 3 — pinned shrink).
   * When present, the filter resolves the target by IDENTITY instead of re-resolving the selector live each
   * inference, so `by_tool_name`+`last` / `by_content_includes` no longer drift onto later, unrelated messages as
   * the session grows (the moving-target footgun). Mirrors `RewindMarker.hideEntryIds`. Absent when the target did
   * not match at creation (then the filter falls back to live resolution — backward compat / compaction-robust).
   * Holds an ENTRY id (stable), NOT a message index. OPTIONAL.
   */
  pinnedEntryId?: string;
  seq: number;
  ts: number;
}
```

**Matching semantics** (`@06-context-filter.md` §5): targets resolve against the *current* `event.messages` each inference (compaction-robust). If multiple markers match the same target, the **last** one wins (applied last in order). If a target matches nothing (already removed/compacted), the marker is a no-op for that inference (and silently retried next inference, in case the content reappears — e.g. before a compaction settles).

**Pinned shrinks (FINDING 3).** When the tool resolves the target at marker-creation time it records the matched message's stable ENTRY id as `pinnedEntryId`. The filter then resolves that id by **identity** (not the live selector) on every later inference, locking the substitution to ONE message forever — `by_tool_name`+`last` and `by_content_includes` can no longer silently rewrite a *later*, unrelated message that happens to match (the moving-target footgun). If the pinned entry is no longer present (compaction), the marker no-ops that inference rather than re-resolving the selector (identity-or-nothing, mirroring the rewind `hideEntryIds` precedent). `by_tool_call_id` is already stable, so pinning it is a harmless no-op. Markers without a `pinnedEntryId` (old markers, or a target that did not match at creation) fall back to the live selector as before.

## 5. Turn metric (for the nudge)

Appended at `turn_end` via `pi.appendEntry("mulligan:turn-metric", data)`. Only the **latest** one on the branch is consulted by the filter (older ones are ignored but persist).

```ts
interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric";
  seq: number;
  ts: number;
  deltaTokens: number;        // signed estimate of how much context grew this turn
  bloatHit: boolean;          // any tool_result this turn exceeded bloatThreshold
  bloatHits: { toolName: string; approxTokens: number }[];
  grewOverThreshold: boolean; // deltaTokens > driftThresholdTokens
  /** The turn index this metric describes (from turn_end event.turnIndex). */
  turnIndex: number;
}
```

Because `turn_end` does not receive the message list, `deltaTokens` is computed from the **in-memory token baseline** (captured at `turn_start`/previous `turn_end`) compared to an estimate at `turn_end`. This is inherently approximate; the nudge is advisory, so approximation is acceptable. The baseline is keyed per-session in a module-scoped map, reset on `session_start`. If the baseline is missing (e.g. first turn, or post-reload), `deltaTokens` is `null` and the nudge falls back to `bloatHit`-only signaling.

## 5½. Marker: cancel (marker retraction)

Stored via `pi.appendEntry("mulligan:cancel", data)`. This is the foundational data model for **G3 / marker retraction** (spec `@08-edge-cases.md` E21), which amends decision D6 ("agent rewinds are permanent"): a mistaken `mulligan:rewind` / `mulligan:shrink` is no longer irrevocable — it becomes retractable. The `data`:

```ts
interface CancelMarker extends MulliganEnvelope {
  kind: "cancel";
  /** The uuid `id` field of the rewind/shrink marker being cancelled
   *  (RewindMarker.id / ShrinkMarker.id) — NOT the Pi entry id. */
  targetId: string;
  seq: number;   // monotonic per-session counter (shared with rewind/shrink/turn-metric)
  ts: number;    // Date.now() at append
}
```

**No `id` field** (like `TurnMetric` in §5 — a cancel is not itself cancellable), so `appendCancelMarker` stamps NO uuid.

**`targetId` semantics.** `targetId` holds the **uuid `id` field** of the rewind/shrink marker being cancelled (`RewindMarker.id` / `ShrinkMarker.id`), NOT the Pi entry id. The cancel tool (P3.M1.T3.S1) is responsible for validating that `targetId` exists on the branch; the persistence wrapper does not.

**Retraction semantics** (applied downstream by `readMarkers`, P3.M1.T2.S1): the filter collects all `mulligan:cancel` entries, builds a `cancelledIds: Set<string>` from their `data.targetId` values, and drops any rewind/shrink whose `data.id` is in that set — **before** the filter sees them. This suppresses the cancelled marker going forward only. It does **not** undo on-disk side effects already caused by the rewind/shrink (D1/E5), nor does it replay any hidden content. See `@08-edge-cases.md` E21 for the full retraction contract.

## 6. Checkpoint

A checkpoint is **not** a `CustomEntry`; it is a Pi `LabelEntry` created by `pi.setLabel(leafId, "mulligan:checkpoint:<name>")`. Names MUST match `/^[a-z0-9_-]{1,40}$/`. The `mulligan:checkpoint:` prefix distinguishes Mulligan checkpoints from user/bookmark labels.

```ts
// To set:    pi.setLabel(currentLeafId, `mulligan:checkpoint:${name}`);
// To read:   ctx.sessionManager.getLabel(id)  → string | undefined
// To list:   scan getEntries() for label entries whose label starts with the prefix
```

Checkpoints are **referenced by `mulligan_rewind`** as an alternative targeting mode (see `@05-tools.md`): `granularity: "checkpoint", checkpoint: "<name>"`. The filter resolves a checkpoint target by finding the labeled entry, then mapping it to a position in `event.messages` (see `@06-context-filter.md` §6 for the entry→message mapping algorithm). This is the one place Mulligan must do entry↔message mapping; the relative granularities avoid it.

## 7. Configuration (`mulligan` in settings.json)

Full defaults + rationale in `@09-configuration.md`. Schema summary here so data shapes are co-located:

```ts
interface MulliganConfig {
  enabled: boolean;                  // master switch; default true
  rewind: {
    enabled: boolean;                // default true
    protectedRoles: string[];        // never rewind past; default ["user" (first), "user" (latest)]
    maxDepth: number;                // max simultaneous active rewind markers; default 5
    requireMutationWarning: boolean; // warn (in tool result) if rewinding a span with write tools; default true
  };
  shrink: {
    enabled: boolean;                // default true
  };
  nudges: {
    bloatReminder: boolean;          // tool_result annotation; default true
    perTurnDrift: boolean;           // context nudge; default true
    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)
    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { read: 24576 }
    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
  };
  audit: {
    estimateConfidence: "low" | "medium" | "high"; // reported with estimates; default "medium"
  };
  log: {
    file: string | null;             // structured log path; default null (off). Set for debugging.
  };
}
```

## 8. In-memory (non-persisted) state

```ts
interface SessionRuntime {
  sessionId: string;
  seq: number;                       // monotonic marker counter; persisted INTO each marker
  tokenBaseline: number | null;      // for turn metric delta
  lastTurnIndex: number | null;
}
```

Held in a `Map<string, SessionRuntime>` keyed by `ctx.sessionManager.getSessionId()`. Reset/created on `session_start`. **Never** cache a `sessionManager` handle (C12) — only primitive values.

## 9. Logging shape (for `log.file`)

One JSON line per event, append-only:

```ts
interface LogLine {
  ts: string;                        // ISO
  level: "debug" | "info" | "warn" | "error";
  event: string;                     // e.g. "rewind.applied", "filter.fire", "nudge.inject"
  sessionId: string;
  data?: unknown;
}
```

The logger is the primary observability surface in non-TUI modes and is what the test suite asserts against (`@10-testing.md`).

## 10. Cross-references

- Tools that produce these shapes → `@05-tools.md`
- How the filter consumes them → `@06-context-filter.md`
- Defaults & where config is read from → `@09-configuration.md`
5. Tools — the agent-callable API — # 05 — Tools (the agent-callable API)

> Exact contracts for the five tools Mulligan registers. Each section gives: purpose, the typebox parameter schema (copy-pasteable), the return shape, step-by-step behavior, validation rules, error handling, and a usage example. Implement verbatim — the LLM's reliable use depends on stable names, descriptions, and parameter shapes.

**Shared tool conventions:**
- Every tool's `execute(toolCallId, params, signal, onUpdate, ctx)` wraps its body in try/catch; on error it returns a text result describing the failure (never throws — a thrown tool error is noisy and can confuse the loop).
- Every tool result `content` is `[{ type: "text", text: "…" }]`.
- Tools are **write-only w.r.t. the message list** (they never read/transform `event.messages`); `mulligan_audit` is the single read-only exception and even it does not persist.
- Descriptions are written for the LLM: they state *when* to use the tool and *what* it accomplishes, in plain language, with the cost/benefit framing that nudges correct use.

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
2. **Validate note:** all three `note.*` fields are non-empty after trim. Else return `"Mulligan: refused — note fields must all be non-empty."` (The structured note is the confabulation defense; half-hearted notes are rejected.)
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
{ content: [{ type:"text", text: "Mulligan: shrink recorded. Matched: yes/no." }] }
// The replacement is NOT echoed in the result. Echoing it would place a second
// copy in the model's context — defeating the tool's entire purpose. The operator
// sees the extracted summary via ctx.ui.notify (behavior step 5) at ZERO context
// cost; the model sees only this terse line, then the replacement applied to the
// target message on the next turn.
```

### Behavior
1. Validate config (`config.shrink.enabled`).
2. Validate `replacement` non-empty.
3. **Match now (best-effort):** resolve `target` against the current snapshot to (a) give immediate feedback ("matched: yes/no") and (b) reject obviously-invalid targets (e.g. `by_tool_call_id` that does not exist anywhere) — though note a "no match now" is not a hard refusal, because the content might appear before a compaction settles; in that case accept and let the filter keep trying. Use judgement: refuse only if the target is structurally impossible (e.g. unknown id format), not merely currently-unmatched.
4. `pi.appendEntry("mulligan:shrink", { schema, v:1, kind:"shrink", id, target, replacement, reason, seq, ts })`.
5. **Notify the operator at zero context cost (REQUIRED):** after persisting, surface the extracted summary to the *human* via `ctx.ui` — a pure UI side-channel that is **never** added to the model's context:
```ts
if (ctx.hasUI) ctx.ui.notify(
  `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>`,
  "info");
```
Guard with `ctx.hasUI` (no-op in print/JSON mode — there is no user to show). The tool RESULT (returned to the model) stays terse — the model does not need its own summary echoed back. `config.shrink.notifyMaxChars` (default **2048**) caps the toast for *UI ergonomics only* (not context); over-cap, append `…(<N> chars total)`. **Why not echo in the result / `sendMessage`:** both enter the model's context. `ctx.ui.notify` is the only user-facing channel that costs zero tokens — the whole point of the tool is to reduce context, so the summary must reach the human without re-entering the model's view.

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
5. **Auto-expiry on consumption (REQUIRED):** a checkpoint exists to be rewound *to*. Once a `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` successfully targets it, the checkpoint is **consumed** and MUST be retired — its label cleared (or suppressed via a `mulligan:checkpoint-cancel` entry) so it no longer appears active in `mulligan_audit`. Rationale (live use): a used checkpoint has no further purpose, and unconsumed throwaway checkpoints otherwise linger in the active-marker list indefinitely. Re-creating a checkpoint of the same name after consumption is allowed (sets a fresh label). A checkpoint that is never consumed persists, as today.

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
    Type.Object({ by_content_includes: Type.String({ description: "Match a marker whose affected message(s) include this substring." }) }),
  ], { description: "How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired." }),

  markerId: Type.Optional(Type.String({ description: "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins." })),
}, { description: "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present." });
```

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
pi.registerTool({ name:"mulligan_rewind", label:"Mulligan Rewind", description: RWIND_DESC, parameters: RewindParams, execute: rewindExecute });
pi.registerTool({ name:"mulligan_shrink", label:"Mulligan Shrink",  description: SHRINK_DESC, parameters: ShrinkParams, execute: shrinkExecute });
pi.registerTool({ name:"mulligan_checkpoint", label:"Mulligan Checkpoint", description: CKPT_DESC, parameters: CheckpointParams, execute: checkpointExecute });
pi.registerTool({ name:"mulligan_audit", label:"Mulligan Audit", description: AUDIT_DESC, parameters: AuditParams, execute: auditExecute });
pi.registerTool({ name:"mulligan_cancel", label:"Mulligan Cancel", description: CANCEL_DESC, parameters: CancelParams, execute: cancelExecute });
```

Each `execute` is `(toolCallId, params, signal, onUpdate, ctx) => Promise<ToolResult>` and delegates to its `tools/*.ts` module, which in turn uses `markers.ts` (write) and the pure helpers (read/resolve). Keep `execute` bodies thin. NOTE: `index.ts` uses the **factory form** for the four factories — `pi.registerTool(makeRewindTool(pi))`, `makeShrinkTool(pi)`, `makeCheckpointTool(pi)`, `makeCancelTool(pi)` — capturing `pi` via closure (their `execute()` needs `pi` for `appendXxxMarker(pi, …)` but does not receive it). `auditTool` is a plain const. The summary block above shows the equivalent object-literal form for readability.

### Description strings (craft carefully — they drive LLM usage)
- **Rewind:** `"Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message."`
- **Shrink:** `"Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."`
- **Checkpoint:** `"Name the current position so a later mulligan_rewind can jump straight back to it. Use before a speculative sub-task you might want to undo in one shot."`
- **Audit:** `"Show a token breakdown of the context you're currently carrying (what the model actually sees), flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to rewind or shrink."`
- **Cancel:** `"Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Identify the marker by \`target\` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit \`markerId\` if you have one. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op."`

## 7. Cross-references
- Persisted shapes written by these tools → `@04-data-model.md`
- How the filter consumes the markers → `@06-context-filter.md`
- Edge cases & refusal conditions → `@08-edge-cases.md`
6. The context filter — the core algorithm (granularities, pairing, composition) — # 06 — The context filter (core algorithm)

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
7. Preventive layer & nudges — bloated-result reminder + per-turn drift nudge — # 07 — Preventive layer & nudges

> Mulligan's two "ride-along" mechanisms that help the agent notice when it should rewind or shrink — **without ever spending an extra model request**. Both exploit the fact that the `context` event and the `tool_result` event already fire as part of normal operation; we attach cheap computations and annotations to them.

Design principle (D4): *anything that nudges the agent per-turn must ride an inference that was already happening.* A feature that costs a model call per turn is, by definition, counter to the project's purpose and is rejected.

---

## 1. Nudge A — bloated-result reminder (`tool_result` event)

### Purpose
When a single tool result is large, append a short reminder **to that result's own content** telling the agent a rewind/shrink is available. This rides the result itself (no extra request) and is co-located with the offending output, so the agent sees the hint exactly where the bloat is.

### Mechanism
```ts
pi.on("tool_result", async (event, ctx) => {
  try {
    const config = getConfig();
    if (!config.enabled || !config.nudges.bloatReminder) return;
    if (event.toolName?.startsWith("mulligan_")) return;     // don't annotate our own tools

    const bytes = resultBytes(event.content);
    const threshold = bloatThresholdFor(event.toolName, config);  // per-tool override, else global
    if (bytes < threshold) return;                              // under threshold → no-op

    const reminder = renderBloatReminder(event.toolName, bytes);  // threshold gates firing above; no longer rendered
    // Append the reminder to the existing content (do not replace — the agent may need the data).
    const content = [...(event.content ?? []), { type: "text", text: reminder }];
    // Also record a turn-metric contribution so the per-turn nudge (Nudge B) can aggregate.
    recordBloatHit(ctx, event.toolName, approxTokens(bytes));
    return { content };
  } catch (e) {
    log("error", "nudge.bloat", ctx, { error: String(e) });
    // fail-open: return nothing (leave result unchanged)
  }
});
```

### `renderBloatReminder(toolName, bytes)`
```md

~<KB> KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.
```

The reminder is **appended**, not replacing — the agent may genuinely need the full output right now; the hint is about *future turns*. It is a single line; modest token cost (~20 tokens) incurred once, only when the threshold is crossed.

### Threshold default & calibration
- Default `bloatThresholdBytes = 16384` (16 KB ≈ 4k tokens in-context), deliberately **below** Pi's built-in 50 KB truncation cap so Mulligan catches meaningful-but-not-catastrophic results that slip under the built-in cap. The previous default was 8192 (8 KB); it was raised after observation showed 8 KB nagging on every routine source-file read (9–17 KB) — i.e. firing on results the agent still needed. 16 KB lets a typical source file through while still catching genuinely catastrophic results (the 50 KB un-redirected `grep`, etc.).
- The threshold is **per tool**: each tool may override the global default via `bloatThresholdBytesByTool`. Resolution is a single helper:
  ```ts
  function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
    const global = config.nudges.bloatThresholdBytes;
    if (!toolName) return global;
    const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
    return byTool[toolName] ?? global;
  }
  ```
  Rationale: legitimate output size differs sharply by tool, so the override map tunes sensitivity per tool. `bash` is the primary bloat surface (large command output), so it is intentionally NOT in the map — it uses the 16 KB global default to stay maximally sensitive. `read` gets a higher bar (24 KB) because large source-file reads are routine and legitimate; an `lsp_hover` payload is a few hundred bytes and needs no override. Shipped defaults: `{ "read": 24576 }`, with all other tools (including `bash`) falling back to the 16 KB global.
  - *Limitation:* the override is keyed by Pi `toolName` (e.g. `"bash"`), not by subcommand — a `git log` and an `echo` both present as `bash`. Sub-command-level sensitivity is out of scope for v1; the `perTurnDrift` nudge (§2) catches aggregate turn growth regardless of which tool produced it.
- The threshold is in **bytes of the in-context text representation** (sum of `.text` lengths across content blocks, UTF-8 byte length). Not model tokens (we don't tokenize here — keep it cheap and deterministic).
- Configurable; a project that routinely handles large legitimate outputs (log analysis) may raise either the global value or a specific tool's entry.

### Interaction with shrink/rewind
- If the agent heeds the reminder and shrinks, the shrink marker substitutes the content (including the appended reminder) with the agent's replacement on the next turn — so the reminder disappears automatically once acted on. Clean.
- If the agent rewinds the tool-call group, the whole result (reminder included) is hidden. Clean.
- If ignored, the reminder persists in context (a ~40-token cost). Acceptable; it's a one-time cost per bloated result.

### Why advisory, not auto-shrink (D3)
Auto-shrinking would risk discarding data the model needs right now (e.g. a large test output the model is actively diagnosing). The reminder preserves agent agency: the model decides, with full information, whether the bloat is a problem. Auto-shrink is a future opt-in mode (`config.shrink.autoOnBloat`, **not in v1**).

---

## 2. Nudge B — per-turn drift nudge (`turn_end` → `context` injection)

### Purpose
At the start of each turn, if context has grown *sustainedly* over the rolling window, inject a one-line annotation into the message copy so the agent is aware of drift and remembers rewind/shrink exist. Rides the existing next inference — **zero extra requests**.

This is the non-obvious mechanism the project pivoted on (see `@reference/HANDOFF.md` Q5). The user's insight: a per-turn nudge seems to require an extra request, which would defeat the project — but the `context` event is a free ride, so the nudge can piggyback.

### Mechanism — two phases

**Phase 1: measure at `turn_end`.**
```ts
pi.on("turn_end", async (event, ctx) => {
  try {
    const config = getConfig();
    if (!config.enabled || !config.nudges.perTurnDrift) return;
    const rt = runtime(ctx);

    // Estimate current context tokens from the filtered view if available, else from getContextUsage.
    const now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens
                                : (ctx.getContextUsage()?.tokens ?? 0);
    const baseline = rt.tokenBaseline;       // captured at previous turn_end (or session_start)
    const delta = baseline == null ? null : now - baseline;
    const bloat = rt.pendingBloatHits ?? []; // collected by Nudge A this turn
    rt.pendingBloatHits = [];

    const metric: TurnMetric = {
      schema:"pi-mulligan", v:1, kind:"turn-metric",
      seq: nextSeq(rt), ts: Date.now(),
      deltaTokens: delta,
      bloatHit: bloat.length > 0,
      bloatHits: bloat,
      grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens,
      turnIndex: event.turnIndex,
    };
    pi.appendEntry("mulligan:turn-metric", metric);
    rt.tokenBaseline = now;                   // roll baseline forward
    rt.lastTurnIndex = event.turnIndex;
  } catch (e) { log("error","nudge.turn_end", ctx, { error:String(e) }); }
});
```

**Phase 2: inject at next `context` fire.**
The filter (§1 of `@06-context-filter.md`) reads the last `config.nudges.driftWindowTurns` `mulligan:turn-metric` entries on the branch and calls the windowed `shouldNudge` (§5.1). The drift nudge fires on **sustained total-context growth** — the windowed-average `deltaTokens` crossing `driftThresholdTokens`. The `bloatHit` arm is **not** a firing condition when delta data is available: a single big tool result is already covered by Nudge A (co-located on that result), so re-announcing it one turn later adds nothing and, observed live, can itself drive a stuck-turn loop. `bloatHit` is retained **only as a fallback** when *no* turn in the window has delta data (first turn / post-reload — see Edge cases), so the nudge still has some signal before a baseline exists. If true:
```ts
function injectNudge(messages: AgentMessage[], metric: TurnMetric): AgentMessage[] {
  const line = renderDriftNudge(metric);
  // Append as a lightweight CustomMessage that is NOT persisted (it's in the copy only).
  // We construct it inline; it never touches the session.
  const nudge: AgentMessage = {
    role: "custom", customType: "mulligan:nudge",
    content: line, display: false,
    details: { ephemeral: true, turnIndex: metric.turnIndex },
    timestamp: Date.now(),
  };
  return [...messages, nudge];
}
```
`renderDriftNudge`:
```md
Previous turn added ~<delta>k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.
```

### Why this is zero-extra-requests
- The metric computation at `turn_end` is pure arithmetic over already-known numbers (no model call).
- The injection at `context` mutates only the in-flight copy; the inference was happening regardless.
- The nudge `CustomMessage` is constructed **in the filter** and **never appended to the session** (`pi.sendMessage` is NOT called) — so it does not accumulate. Each turn's nudge is recomputed from the latest metric and replaces (not stacks with) the previous one (because it's not persisted, there's nothing to stack).

### Cost
- ~25–40 tokens per turn **when it fires** (only when the sustained-drift threshold is crossed, or — before any baseline exists — a bloated result appears). Zero otherwise.
- The metric `CustomEntry` is persisted (small, JSONL), but it is **not** in context (it's a `custom`, not `custom_message`), so it costs no model tokens. Old metrics accumulate on disk (like all entries) but only the latest is read; this is acceptable (matches Pi's append-only model). A future "garbage collect old metrics" is a non-goal for v1.

### Edge cases
- **First turn / post-reload:** `tokenBaseline` is null → `deltaTokens` null → with no delta data in the window, `shouldNudge` falls back to `bloatHit`-only signaling (still useful; a bloated result on turn 1 still nudges). This is the **only** path on which `bloatHit` fires the drift nudge.
- **Negative delta** (a rewind/shrink shrank context): the windowed delta is non-positive → `shouldNudge` does not fire (it keys on positive sustained growth). Additionally, per §5.3, the drift nudge is **hard-suppressed** whenever a `mulligan:rewind` or `mulligan:shrink` marker was created during the metric's turn — so a since-shrunk or since-rewound result never re-triggers the cross-turn nudge. (`bloatHit` is no longer a firing condition when delta data exists.)
- **Bloat counts are cosmetic now, not a firing trigger (known rough edge):** `pendingBloatHits` are collected at `tool_result` time and are not subtracted when a later `mulligan_rewind` hides those same results. Previously a near-zero-delta turn with a big result could fire the drift nudge as `~0k tokens / N bloated results` (self-contradictory); with `bloatHit` removed from the firing condition (§2/§5.1 — delta-only), that contradiction no longer occurs — a ~0-net-growth turn does not fire regardless of how big a result it held. The rendered drift nudge no longer carries a bloat clause at all (see `renderDriftNudge`), so stale counts cannot appear in it — the rough edge is closed at the rendering layer too. (`pendingBloatHits` are still collected only to drive the no-delta fallback firing decision in §5.1; they are never rendered.) The nudge SHOULD additionally be suppressed for the remainder of any turn in which a rewind was refused (any reason), so a capped/stuck turn stops being poked (`@08-edge-cases.md` E22).
- **`turn_end` not firing in print mode for the final turn:** acceptable; the nudge is best-effort.

---

## 3. Determinism & testability
Both nudges are driven by pure helpers (`renderBloatReminder`, `renderDriftNudge`, `shouldNudge`, `resultBytes`, `approxTokens`) that are unit-tested without Pi. The Pi-coupled glue (`tool_result`/`turn_end`/`context` handlers) is exercised by the integration smoke tests (`@10-testing.md`), which assert on the log lines and on injected annotation presence in the filtered payload.

## 4. Cross-references
- Turn-metric schema → `@04-data-model.md` §5
- Filter pipeline that calls `injectNudge` → `@06-context-filter.md` §1, §12
- Config defaults → `@09-configuration.md`

---

## 5. Drift-nudge refinements (REQUIRED)

These refine Nudge B (§2) to cut false positives and catch slow accumulation. Both ride the existing `context` event (D4 — zero extra requests).

### 5.1 Windowed drift signaling (REQUIRED)
`shouldNudge` MUST smooth the per-turn delta over a rolling window of the last `config.nudges.driftWindowTurns` turns (default 3) before comparing to `driftThresholdTokens` — fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold, NOT on a single turn's raw delta. Rationale (live use): a single heavy turn is routinely legitimate (reading several source files; the user pasting reference docs to read) — *sustained* growth over a window is the actionable signal. The turn metric (`@04-data-model.md` §5) carries the raw per-turn delta; the window is computed in the filter from the last N `mulligan:turn-metric` entries on the branch. The firing condition is **delta-only when delta data is available**: `avg(window.deltaTokens) > driftThresholdTokens`. The earlier `|| bloatHit` arm is **dropped** — it fired the drift nudge on any single large tool result, redundant with Nudge A (already co-located on that result) and a known stuck-turn-loop amplifier (it produced the live-observed `~0k tokens / N bloated results` self-contradiction). `bloatHit` remains a firing condition *only* in the no-delta fallback: a window with zero finite deltas fires iff any metric has `bloatHit` (first turn / post-reload). Acceptance: (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire; (c) a single large result (>threshold) with ~0 net growth does NOT fire the drift nudge even though it does trigger Nudge A.

### 5.2 Edge-triggered high-water signal (REQUIRED)
In addition to the delta nudge, the filter MUST inject a one-line annotation the first time the **total filtered** context crosses a high-water fraction of the window (`config.nudges.highWaterFraction`, default 0.7), using the same filtered-total `mulligan_audit` computes (`@05-tools.md` §4). It MUST be **edge-triggered** — fire once on crossing, not every turn while above — by tracking `rt.aboveHighWater` (set true when the annotation fires, cleared only when the total drops back below the fraction) in the session runtime. This catches slow, steady accumulation that no single-turn delta nudge sees, without nagging.

### 5.3 Suppress the drift nudge when the agent already acted (REQUIRED)
The drift nudge (§2) MUST NOT fire for a turn in which the agent already issued a `mulligan:shrink` or `mulligan:rewind` that addressed the bloat/drift the nudge would describe. Rationale (live use): in observed sessions the agent shrank a bloated result *in the same turn* it was produced, yet the drift nudge still re-announced the bloat at the next turn's start — pure redundancy that cost ~25–40 tokens and risked poking a stuck turn. The §2 edge-case ts-window heuristic is promoted here to a hard rule and sharpened: collect the `seq`s of every `mulligan:rewind`/`mulligan:shrink` marker created during the metric's turn (turn-boundary → `turn_end`); if that set is non-empty, `shouldNudge` returns false for that metric **regardless** of delta or `bloatHit`. This makes Nudge A (inline, co-located) and Nudge B (cross-turn) strictly non-overlapping: Nudge A fires at most once per bloated result; Nudge B fires only when the agent did **not** self-correct. Acceptance: (a) a turn that produces a >threshold result AND shrinks it does NOT fire the drift nudge next turn; (b) a turn that produces a >threshold result and does nothing fires normally; (c) a turn that rewinds also does not fire. Composes with §5.1 (windowing) and the E22 refusal-suppression rule.
8. Edge cases & failure modes — # 08 — Edge cases & failure modes

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

## E20. `pi.appendEntry` / `pi.sendMessage` ordering race
- **Situation:** the tool calls `appendEntry` then `sendMessage`; could the note land before the marker in the entry order?
- **Behavior:** both are synchronous appends on the same session; they land in call order (marker first, note second). The filter reads markers from `getEntries()` independently of the note's position, so ordering between them doesn't affect correctness. The note appears after the rewind tool's result in context, which is the desired "most-recent" placement.

## E21. Marker retraction — cancel an erroneous/stale marker (REQUIRED; softens D6)

- **Situation:** the agent issues a `mulligan:rewind` or `mulligan:shrink` it needs to undo — a mis-targeted shrink, a rewind that hid something still needed, or any marker issued against the wrong target. Without retraction the unwanted transform applies on every subsequent `context` fire for the rest of the session, and `mulligan_rewind` of the issuing call does **not** retire it: markers are `custom` control entries outside the rewind's `hideEntryIds` span (verified in live use — an erroneous shrink had to be worked around for an entire session because every `read` result kept being re-substituted).
- **Required behavior — retraction:** Mulligan MUST provide an agent-callable way to retire a marker so it stops applying going forward. Implementation: append a *retirement* marker — `mulligan:cancel` carrying the target marker's `id` (equivalently a `cancel: markerId` mode on `mulligan_rewind`/`mulligan_shrink`). `readMarkers` MUST drop any marker whose `id` is listed by a later `mulligan:cancel` before the filter sees it. The `mulligan_cancel` tool takes a **`target`** — the same hint shape `mulligan_shrink` uses (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), resolved live each turn — and retires the most recent active marker (shrink or rewind) whose effect covers the matched message. An explicit `markerId` is accepted as an optional fallback for hosts that surface `details.markerId`. The tool validates that a matching marker exists on the branch, appends the retirement entry, and returns confirmation.
- **Scope — what retraction is NOT:** it only suppresses a control marker in the view going forward. It is **not** a general "undo the rewind's effects": on-disk side effects of the original span persist (D1/E5), and originally-hidden messages do **not** reappear (the retirement removes the marker; it does not replay it). Hidden content stays recoverable by the human via `/tree`.
- **Acceptance:** (a) an agent can cancel any `mulligan:rewind`/`mulligan:shrink` by target (content/role hint) or by explicit `markerId`; (b) on the `context` fire after cancellation the transform no longer applies — unit test: cancel a shrink, assert the original message reappears verbatim in the filtered view; cancel a rewind, assert the hidden messages reappear; (c) `mulligan_audit` lists cancelled markers as retired; (d) cancelling a non-existent/already-cancelled id is a safe no-op that returns a reason and never throws (E13). This amends **D6**: agent markers are no longer irrevocably permanent — a mistaken marker is retractable.

## E22. Same-prompt rewind retry loop — runaway growth (REQUIRED; hard backstop)

- **Situation:** the agent calls `mulligan_rewind` and re-lands at the *same* user prompt, then produces work that again triggers a rewind — frequently because it is dutifully following a **self-authored note** whose `next` field re-instructs the very action that caused the previous rewind, or because the re-attempt re-reads the same huge files / re-runs the same broad `grep` (re-bloating between rewinds). A **retry** = any `mulligan_rewind` whose resumed turn lands back at the most recent user message: every `last_turn` (and `to_previous_prompt`), plus a `last_tool_call_group` or `checkpoint` rewind whose resolved target is at/after that user message. Each iteration appends a new `mulligan:rewind` marker + `mulligan:note` + `mulligan:turn-metric` to the on-disk session. Hidden-from-view spans do **not** shrink the on-disk session, and the notes themselves are context, so the session (and the resulting prompt) grows without bound. (Distinct from the **turn-replay** bug in `FIX_TURN_REPLAY_LOOP.md`, which is a *filter* defect fixed by the `turnHasAdvanced` gate — not a marker/retry problem; do not conflate.)
- **Risk (observed in live use):** a single "update the spec" prompt left the agent retrying the same turn for **hours**, each loop enlarging the session, until the provider rejected the next request as **"Prompt too long"** — at which point the human could not even send a new message to break the loop. This is the most severe Mulligan failure mode: resource runaway ending in an unrecoverable hard stop.
- **Required behavior — per-prompt retry budget:** the rewind tool MUST track, per branch, how many rewinds re-land at the **same latest user message** (count every such rewind created since that prompt and not yet advanced past it). When that count reaches `config.rewind.maxRetriesPerPrompt` (**default 5**), the tool MUST refuse *before persisting* and return: `"Mulligan: refused — hit the per-prompt retry budget (<N>/<max> rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again."` This is distinct from E4's total `maxDepth` cap (which bounds *all* active rewind markers): E22 specifically bounds **revisiting one prompt**, which is the runaway signature. `mulligan_shrink`, `mulligan_audit`, `mulligan_checkpoint`, `mulligan_cancel`, and ordinary non-rewind tool work do **not** consume retry budget.
- **Why the note cannot be trusted to self-correct:** the note is written by the same process that is about to loop, so it can encode the loop's cause as an instruction (`next: "set a checkpoint"` → resumes → sets checkpoint → nudge → rewind → note → …). The budget is therefore a *hard* backstop, not advisory.
- **Required behavior — out-of-band context-fraction stop (catches the zero-marker loop vector):** the marker-counting budget above only counts *recorded* rewinds, so it cannot arrest a loop that persists **zero** net markers — pure intra-turn repetition where the model re-reads the same large files every turn because a bloated-result nudge keeps re-firing. For this worst case, the tool MUST additionally keep a hard wall-clock guard: if the filtered-context estimate (the same total `mulligan_audit` computes, `@05-tools.md` §4) is `>= config.rewind.abortContextFraction` (**default 0.9**) of the model's context window AND a rewind is requested, the tool refuses with `"Mulligan: refused — context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result."` This stops the runaway before the provider rejects the request, regardless of retry accounting. It is independent of both `maxDepth` and `maxRetriesPerPrompt` — all three apply.
- **Advisory repeat-detection hint:** if two consecutive rewinds re-land at the same prompt with substantively identical notes (same `what_happened` after trim/lowercase — which now includes the avoid/lesson), the success text for the second one SHOULD append: `"⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."` This steers; the budget/context-fraction stops above are what ultimately refuse.
- **Acceptance:** (a) the first `maxRetriesPerPrompt−1` rewinds re-landing at a given prompt succeed; the Nth (== budget) refuses with the budget text; (b) advancing to a new user prompt resets the budget and the next rewind succeeds; (c) a **zero-hide rewind** (`nothing matched to hide`) still consumes budget — it is the canonical loop vector; (d) `mulligan_shrink`/`audit`/`checkpoint`/`cancel` remain callable after the budget is hit (only prompt-re-landing rewinds are gated); (e) a rewind requested while filtered context ≥ `abortContextFraction` of the window is refused even if budget remains; (f) reaching the budget never throws (E13) and never prevents a normal text reply; (g) unit test: drive a loop that rewinds `last_turn` at the same prompt repeatedly and assert the call refuses exactly at the budget with the named text, and that a subsequent new user prompt restores the budget.
- **Config:** add `config.rewind.maxRetriesPerPrompt` (integer ≥ 1, default 5) and `config.rewind.abortContextFraction` (number in (0,1], default 0.9) to `@09-configuration.md`. Setting `maxRetriesPerPrompt` very high restores old (loop-prone) behavior; setting it to 1 effectively disables same-prompt re-rewinds.

## E23. `mulligan_checkpoint` — exposed to the wrong actor (DESIGN NOTE; not a v1 blocker)

- **Situation:** `mulligan_checkpoint` is a *pre-commitment* tool — it only pays off if invoked *before* a mistake, i.e. it requires anticipating a mistake that has not happened yet.
- **Risk:** agents anticipate mistakes poorly (they recognize them only in hindsight), so an agent has almost no native reason to set one. The tool therefore effectively needs the *user's* foresight but is exposed only to the agent → near-zero spontaneous adoption.
- **Behavior (design tension, unresolved):** v1 ships the tool as-is, documents the low expected adoption, and relies on the E22 retry budget + context-fraction stop as the backstop that makes proactive checkpointing less critical. A future version should take one of two paths: (a) surface a **user-facing** way to set a checkpoint before delegating risky work, or (b) fold checkpoint *use* into the **nudge channel** (`@07-preventive-and-nudges.md`) — have the system suggest setting a checkpoint at risky moments, the same way the bloat reminder already nudges shrink/rewind. Either change moves the trigger from "agent foresight" (unreliable) to "external prompt" (the pattern that already works for the reactive tools).

## E24. Pinned hide no-ops under compaction (KNOWN LIMITATION; leak, not replay)

- **Situation:** compaction rewrites the message list; a pinned rewind's `hideEntryIds` are walked via `resolvePinnedHide` (`@06-context-filter.md` §12), which returns `[]` when the pinned entries fall in the compacted-away head (they no longer map to any current message).
- **Risk (bounded):** originally-hidden content **reappears** in the model's view for that fire — a transient **leak**, not a replay. It is NOT the turn-replay vector (`FIX_TURN_REPLAY_LOOP.md`), which is fixed by the `turnHasAdvanced` gate on the legacy relative path; the pinned path is unaffected by that bug (tested: a new post-compaction read survives).
- **Behavior (v1):** accepted as a bounded, transient limitation (compaction is itself soon superseded; Mulligan reducing context makes compaction fire later and over less). The `filter.invariant` log (`@06-context-filter.md` §12) distinguishes this case from a replay by showing `mode: pinned` with `remove: []`. No v1 fix; rely on the audit trail (`/tree`) for recovery.

---

## Cross-references
- Filter algorithms that implement these behaviors → `@06-context-filter.md`
- Tool refusal conditions → `@05-tools.md`
- Config knobs referenced (maxDepth, maxRetriesPerPrompt, abortContextFraction, thresholds, protect) → `@09-configuration.md`
9. Configuration — settings schema & defaults — # 09 — Configuration

> Mulligan reads a `mulligan` object from Pi's `settings.json` (global `~/.pi/agent/settings.json` and/or project-local `<project>/.pi/settings.json`, with project-local overriding global). It works with **zero configuration** — every option has a safe default. This document specifies the schema, defaults, where each is read, and the rationale per knob.

---

## 1. Where config is read

- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
  - _Implementation note:_ Pi's extension API (v0.84.x) does not expose a settings accessor to extensions. Mulligan therefore reads the `settings.json` files directly from disk — the global file via `getAgentDir()` and the project-local file from the session `cwd` (`.pi/settings.json`) — deep-merges them internally (matching Pi's own `deepMergeObjects` semantics), and extracts `settings.mulligan`. The user-visible merge behavior is identical to Pi's normal merge.
- **When:** loaded lazily on first use and cached for the session; re-read on `/reload`. `getConfig()` returns the validated, defaulted config.
- **Validation:** unknown keys are ignored (forward-compat). Type-mismatched values fall back to the default with a warn log. This must never throw.

## 2. Schema & defaults

```jsonc
{
  "mulligan": {
    "enabled": true,                  // master switch (false → entire extension is a no-op)

    "rewind": {
      "enabled": true,
      "protectedRoles": ["first:user", "latest:user"],  // selectors never rewound past
      "maxDepth": 5,                  // max simultaneous active mulligan:rewind markers
      "maxRetriesPerPrompt": 5,       // max consecutive rewinds re-landing at the same user prompt before refusal (E22)
      "abortContextFraction": 0.9,    // refuse any rewind once filtered context reaches this fraction of the window (E22 zero-marker guard)
      "requireMutationWarning": true  // append side-effect warning when rewinding mutating spans
    },

    "shrink": {
      "enabled": true,
      "maxActive": 32,              // cap on simultaneous active mulligan:shrink markers; oldest retired when exceeded
      "staleAfterFires": 3,         // auto-retire a pinned shrink whose target has been absent this many consecutive fires
      "notifyMaxChars": 2048,        // cap on the replacement shown to the operator via ctx.ui.notify (ZERO context cost)
      // "autoOnBloat": false         // NOT in v1; reserved. Auto-shrink would risk data loss.
    },

    "nudges": {
      "bloatReminder": true,          // tool_result annotation when a result exceeds threshold
      "perTurnDrift": true,           // context-annotation when a turn grew past threshold
      "bloatThresholdBytes": 16384,   // 16 KB in-context → reminder (global catch-all; below Pi's 50 KB built-in cap)
      "bloatThresholdBytesByTool": {  // OPTIONAL per-tool overrides (keyed by toolName); fall back to bloatThresholdBytes
        "read": 24576                 // 24 KB — large source-file reads are routine and legitimate
      },                              // (bash is intentionally omitted: it uses the 16 KB global to stay sensitive)
      "driftThresholdTokens": 6000,   // windowed turn-token delta → drift nudge (see @07 §5.1)
      "driftWindowTurns": 3,          // rolling window for §5.1 windowed drift signaling
      "highWaterFraction": 0.7        // §5.2 edge-triggered high-water signal (fraction of context window)
    },

    "audit": {
      "estimateConfidence": "medium"  // "low"|"medium"|"high" — reported with token estimates
    },

    "log": {
      "file": null                    // null = off. Absolute path to append-only JSONL log for debugging.
    }
  }
}
```

## 3. Rationale per knob

| Knob | Default | Why |
|---|---|---|
| `enabled` | `true` | Feature should work out of the box; the human can disable without uninstalling. |
| `rewind.enabled` | `true` | Core feature. |
| `rewind.protectedRoles` | `["first:user","latest:user"]` | Prevent catastrophic amnesia of the original task or the current ask. v1 supports these two selectors. |
| `rewind.maxDepth` | `5` | Generous enough for legitimate retry cascades; tight enough to surface a stuck agent (the refusal text tells the agent/human something is wrong). Markers are permanent, so the cap bounds accumulation. |
| `rewind.maxRetriesPerPrompt` | `5` | Caps *consecutive* rewinds that re-land at the same latest user prompt — the runaway-loop bound (`@08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers): the loop can persist while re-bloating between rewinds, so depth alone can't stop it. 5 matches `maxDepth`'s precedent and is enough for a legitimately flaky turn while still arresting a true loop. |
| `rewind.abortContextFraction` | `0.9` | Wall-clock backstop: refuse any rewind once the filtered-context estimate reaches this fraction of the model's window (`@08` E22). Catches the **zero-marker loop vector** (pure intra-turn re-reading driven by a re-firing bloat nudge) that the marker-counting budget cannot see. 0.9 leaves headroom below the provider's "Prompt too long" rejection. |
| `rewind.requireMutationWarning` | `true` | Side-effect safety: the agent must be told hidden writes persist. Cheap, high value. |
| `shrink.enabled` | `true` | Core feature. |
| `shrink.maxActive` | `32` | Bounds long-session filter cost and marker accumulation; the oldest shrink is retired when exceeded. Mirrors `rewind.maxDepth`. |
| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent this many consecutive fires (`@08-edge-cases.md` E15/E21). Stops dead markers from being walked every fire. |
| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). `@05-tools.md` §2. |
| `nudges.bloatReminder` | `true` | Advisory; cheap; co-located with the problem. High value. |
| `nudges.perTurnDrift` | `true` | The signature "free ride" mechanism; cheap. High value. |
| `nudges.bloatThresholdBytes` | `16384` (16 KB) | Global catch-all for tools without a per-tool override. Raised from 8 KB after observation: the 8 KB default nagged on every routine source-file read (9–17 KB) — i.e. it fired on results the agent still needed. 16 KB lets a typical source file through while still catching genuinely catastrophic results (the 50 KB un-redirected `grep`, etc.). |
| `nudges.bloatThresholdBytesByTool` | `{ "read": 24576 }` | `bash` is the primary bloat surface, so it is intentionally NOT listed — it falls back to the 16 KB global to stay maximally sensitive. `read` of a large source file is normal, so it gets a higher 24 KB bar. Resolution: look up `event.toolName` in the map; on miss (including `bash`), use `bloatThresholdBytes`. |
| `nudges.driftThresholdTokens` | `6000` | Windowed (`@07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
| `nudges.driftWindowTurns` | `3` | Rolling window over which the drift delta is smoothed before thresholding (`@07` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. |
| `nudges.highWaterFraction` | `0.7` | Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered). Catches slow steady accumulation the delta nudge misses. |
| `audit.estimateConfidence` | `"medium"` | Honest default; token estimates are approximate. |
| `log.file` | `null` | Off by default (no disk chatter). Enable for debugging/testing. |

## 4. Validation rules (in `config.ts`)

- Booleans: coerce with `!!`; invalid → default.
- Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.
- `protectedRoles`: must be an array of known selector strings (`"first:user"`, `"latest:user"`); unknown entries ignored (with warn). v1 does not support arbitrary role rules.
- `bloatThresholdBytesByTool`: if present, must be an object mapping tool-name strings to finite numbers `> 0`. Non-object → discard entirely (use global only). Any non-numeric or `<= 0` value in the map is dropped with a warn (the rest of the map is kept). Unknown tool names are permitted (forward-compat — the map is only consulted when a matching `event.toolName` arrives).
- `estimateConfidence`: must be one of `"low"|"medium"|"high"`; else default.
- `log.file`: if set, must be a string; opening is deferred to first write (and wrapped — a bad path must not crash the extension).
- `rewind.maxRetriesPerPrompt`: integer ≥ 1; non-integer or `<1` → default.
- `rewind.abortContextFraction`: number in (0,1]; out of range or non-number → default.
- On any per-field validation failure: log a warn naming the field and the value, use the default, continue. **Never throw.**

## 5. Environment overrides (optional, v1.1 — not required for v1)

Reserved for future: `MULLIGAN_DISABLED=1` (force-disable), `MULLIGAN_LOG=/path` (force log). Not required for v1; documented as future.

## 6. Cross-references
- Where knobs are enforced → `@05-tools.md` (enabled flags, maxRetriesPerPrompt, abortContextFraction), `@06-context-filter.md` (protect, maxDepth), `@07-preventive-and-nudges.md` (thresholds).
10. Testing & verification — # 10 — Testing & verification

> Mulligan's correctness surface is **mostly pure functions** (transforms, ledger, tokens, notes, render). Those get fast unit tests with no Pi, no model, no session. The Pi-coupled glue (the `context` handler, the tools, the nudges) is verified by an integration smoke harness that drives real `pi -p` runs and asserts on a structured log + the session JSONL. This two-tier strategy mirrors the feasibility spike that already proved every primitive (`@reference/looper-smoke.proto.ts`).

---

## 1. Tier 1 — Unit tests (pure helpers, no Pi)

Target files: `transforms.ts`, `ledger.ts`, `tokens.ts`, `notes.ts`. Framework: any (Vitest/node:test). These are the bulk of correctness.

### 1.1 `partitionIntoUnits` (pairing)
- `[user, assistant(1 toolCall), result, assistant(text)]` → 3 units (the assistant+result is one toolGroup, the text assistant is plain, user is plain).
- Orphan result (no matching toolCall) → its own plain unit; never merged.
- Assistant with 3 toolCalls + 3 results → one toolGroup unit with 4 indices.
- **Invariant test:** for every toolGroup unit, every result index's `toolCallId` is in the assistant's toolCall ids, and vice versa.

### 1.2 `resolveLastToolCallGroup`
- Given `[u, a(call A), r(A), a(call B, big), r(B)]` with `excludeToolCallId = undefined` → returns the `a(B)+r(B)` unit.
- With `excludeToolCallId = B` → returns the `a(A)+r(A)` unit (skips the rewind's own).
- No toolGroup at all → `null`.

### 1.3 `resolveLastTurn`
- `[u0, a, r, u1, a, r]`, default → remove indices after `u1` (keep u1).
- `to_previous_prompt:true` → also remove `u1`.
- `u1` is the first user → `to_previous_prompt` refused by protected check.

### 1.4 `applyRewind`
- Removing a toolGroup unit keeps pairing intact (no orphan results/calls remain).
- Removing `last_turn` keeps the rewind's own unit + mulligan notes at the tail.
- Empty `remove` → input unchanged (idempotent).

### 1.5 `applyShrink`
- `by_tool_call_id` match → content replaced, `role/toolCallId/toolName/isError` preserved.
- No match → input unchanged (no-op).
- Two shrinks same target, seq order → last wins.

### 1.6 `extractFileLedger`
- A span with `read(path="a.ts")`, `edit(path="b.ts")`, `bash(command="git commit")`, `bash(command="ls")` → `readFiles:["a.ts"]`, `modifiedFiles:["b.ts"]`, `bashSideEffects:["git commit"]` (`ls` is read-only → omitted). De-dup + sort.
- Empty span → all lists empty.

### 1.7 `estimateTokens`
- Monotonic in input length; empty → 0; confidence flag present.
- A known string yields a stable estimate (snapshot test).

### 1.8 `renderNote` / field validation
- All three fields present → renders with ledger blocks; empty ledger lists → their blocks omitted.
- Any empty field → validation refuses (returns a structured error, not a rendered note).
- Snapshot tests for representative notes.

### 1.9 Pipeline composition (`filterPipeline`)
- Two rewinds compose to the example in `@06-context-filter.md` §11 (assert exact resulting index set).
- Rewind-then-shrink-on-removed-target → shrink no-ops.
- Protected message → rewind skipped + warn.
- **Legacy-gate regression (`turnHasAdvanced`; `test/bug-replay-repro.test.ts`):** a marker with **no** `hideEntryIds` resolves on the creating/resume fire but **no-ops once the turn has advanced** past the rewind's own toolGroup — assert a legacy `last_tool_call_group`/`last_turn` marker hides nothing on the continuation fire after new work is appended (the turn-replay bug, `FIX_TURN_REPLAY_LOOP.md`). A **pinned** marker (with `hideEntryIds`) is unaffected and keeps hiding its span across continuation fires; assert it does NOT replay under compaction either (pinned → `[]`, a leak).
- **`diag` sink:** passing an optional 5th `diag` argument to `filterPipeline` collects `{seq, mode, remove, resolvedLen}` per rewind; assert it WARNs when any rewind's `max(remove) >= resolvedLen-3` (the replay signature). The full suite stays green when `diag` is omitted (opt-in, pure — no Pi).

### 1.10 Retry-cap & context-fraction guards (E22)
- `maxRetriesPerPrompt: 3`, 3 consecutive `last_turn` rewinds re-landing at the same prompt → the 4th is refused with the budget reason and persists nothing.
- A zero-hide rewind (`nothing matched to hide`) still increments the per-prompt counter.
- A `last_tool_call_group`/`checkpoint` rewind whose resolved target is at/after the latest user message counts toward the budget.
- A new user message resets the counter; the next rewind succeeds.
- `mulligan_shrink`/`mulligan_audit`/`mulligan_checkpoint`/`mulligan_cancel` remain callable after the budget is hit.
- A rewind requested while filtered context ≥ `abortContextFraction` of the window is refused even if the budget remains.
- All refusals return a reason and never throw (E13), and never block a normal text reply.

### 1.11 Cancel target resolution (E21, target-based)
- `by_tool_call_id` hint → retires the uuid of the (single) marker whose matched message / `hideEntryIds` carries that id.
- `by_tool_name:"read", occurrence:"last"` → retires the most-recent active shrink or rewind whose covered span includes the last `read` result.
- `by_content_includes:"<substr>"` → retires the most-recent active marker covering a message whose text contains the substring.
- Several markers cover the match → **most recent by `seq`** is retired (LIFO); the rest stay active.
- No active marker covers the match → safe no-op (`cancelled:false`); nothing appended.
- Explicit `markerId` fallback → retires that exact marker; unknown id → safe no-op.
- After a successful cancel, the next `context` fire shows the originally-hidden/shrunk content verbatim (E21 (b)); the retired marker stays on disk.

---

## 2. Tier 2 — Integration smoke harness (real `pi`)

Adapt `@reference/looper-smoke.proto.ts` (rename `looper_*` → `mulligan_*`, restructure into the Mulligan module layout). It registers the tools/handlers, logs structured JSONL to a temp file, and is driven by `pi -e ./dist/index.ts -p "..."` in known scenarios. Assertions read the log + the resulting session JSONL.

### 2.1 Required scenarios & pass criteria (mirror the spike)

| Scenario | How to drive | Pass criteria |
|---|---|---|
| **F-rewind-core** | inject a canary `CustomMessage` at `session_start`; prompt the agent to call `mulligan_rewind(granularity:"last_tool_call_group")` after a bloated tool call | `context.fire` log shows canary present then dropped on the next inference (`context.filter before:N after:N-1`); a second assistant message is produced (auto-prompt); session JSONL has `mulligan:rewind` + `mulligan:note` entries |
| **F-shrink-persist** | prompt agent to call a tool returning a large canary result, then `mulligan_shrink` it | next inference's filtered view shows the replacement; session JSONL toolResult is the original (shrink is a view-substitution, not a JSONL rewrite — **assert the original is still on disk and the substitution appears in the filtered cache**) |
| **F-shrink-preventive** | `tool_result` hook annotates a >16KB result | result content has the appended bloat reminder ("~… KB added to your context…"); `turn-metric` records `bloatHit:true` |
| **F-nudge-drift** | sustained growth: 3 consecutive turns each adding ~4k tokens | after the 3rd turn the next inference's filtered view ends with a `mulligan:nudge` custom message (ephemeral; NOT in session JSONL). Negatives MUST also pass: a single ~8k-token turn amid small turns does NOT fire, and a single >threshold result with ~0 net growth does NOT fire the drift nudge (it only triggers Nudge A); and a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn (§5.3 — Nudge A and B are non-overlapping) |
| **F-protected** | attempt `mulligan_rewind(granularity:"last_turn", to_previous_prompt:true)` when it's the first user message | tool returns refusal text; no marker created |
| **F-maxdepth** | create 5 rewinds, attempt a 6th | 6th refuses with depth message |
| **F-checkpoint** | `mulligan_checkpoint("x")`, then `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` | label entry exists; rewind hides back to the labeled point (assert filtered message count drops to prefix); **checkpoint is consumed on use — `mulligan_audit` no longer lists it active and a second rewind to `"x"` refuses (not found) unless re-created (spec/05 §3 step 5)** |
| **F-cancel** | create a `mulligan_shrink`, then `mulligan_cancel({target:{by_tool_name:"read", occurrence:"last"}})` | next `context` fire the originally-shrunk message reappears verbatim in the filtered view; session JSONL has both `mulligan:shrink` and `mulligan:cancel` entries (shrink is skipped, not deleted) |
| **F-failopen** | force an exception inside the filter (test hook) | handler returns pass-through; no turn break; error logged |
| **F-reload** | create a rewind, then re-open the session (`--session-id`) and run one more turn | filter still hides the canary (marker survived reload) |
| **F-retrycap** | `maxRetriesPerPrompt: 2`; drive repeated `last_turn` rewinds at the same prompt | the 3rd rewind is refused with the budget text and persists nothing; a fresh user prompt restores the budget |
| **F-abortfraction** | force filtered context ≥ `abortContextFraction`, then request a rewind | rewind refused with the context-fraction text even though budget remains; shrink/audit still callable |

### 2.2 Driving reliability
- Use a deterministic, instruction-following model if available; otherwise phrase prompts to force the tool call (the spike used `glm-5.2` successfully with explicit instructions). Provide a fallback "deterministic command" path (`/mulligan_smoke <scenario>`) that invokes the tools/handlers directly for scenarios that don't need model judgment (F-shrink-persist, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload).
- Log every `context.fire` with `{ count, canaryPresent, notePresent, hasRewindMarker }` (as the spike did) — these are the primary assertions.

### 2.3 Session JSONL assertions
Use the parsing approach from the spike (`@reference/looper-smoke.proto.ts`): walk entries, assert on `type`/`customType`/`role`/`parentId`/content. Key invariants:
- `mulligan:rewind` and `mulligan:shrink` are `custom` entries (not `custom_message`) — i.e. not in context.
- `mulligan:note` is a `custom_message` (in context).
- `mulligan:nudge` is **never** persisted (it's constructed in the filter copy only) — assert zero `mulligan:nudge` entries on disk.
- Checkpoints are `label` entries with `mulligan:checkpoint:` prefix.

---

## 3. Property/invariant tests (optional, high-value)

- **Pairing invariant (property):** for any random message list and any sequence of rewind/shrink markers, the filtered output never contains an orphan `toolCall` or `toolResult`. Quickcheck-style.
- **Idempotency (property):** `filterPipeline(filterPipeline(m)) === filterPipeline(m)` for stable inputs.
- **Monotonic shrinkage:** applying a rewind never *increases* the message count.

---

## 4. Manual / TUI smoke
- Load in interactive mode: `pi -e ./dist/index.ts`. Trigger a big `read`, observe the bloat reminder; call `mulligan_audit`; call `mulligan_rewind`; confirm via `/tree` that hidden content is still visible (audit trail) while the model's behavior reflects the rewind.
- Verify `/reload` preserves markers.

## 5. Cross-references
- The proven harness to adapt → `@reference/looper-smoke.proto.ts`
- Behaviors under test → `@06-context-filter.md`, `@07-preventive-and-nudges.md`, `@08-edge-cases.md`
11. File layout & build order — # 11 — File layout & build order

> The exact files to create and a prescriptive, TDD-flavored build sequence. Follow it top-to-bottom and you will have a working Mulligan. Each step is independently verifiable. Do not skip the unit-test tiers — the pure helpers are where ~all the correctness lives.

---

## 1. Repository layout

```
pi-mulligan/
├── spec/                       # this specification (read-only reference for the implementer)
│   ├── SPEC.md
│   ├── 01-…12-….md
│   └── reference/
│       ├── HANDOFF.md
│       └── looper-smoke.proto.ts
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                # extension factory: wiring
│   ├── config.ts               # load + validate + default settings
│   ├── log.ts                  # structured JSONL logger
│   ├── runtime.ts              # per-session runtime map (seq, baseline, lastFiltered)
│   ├── markers.ts              # pi.appendEntry / setLabel / sendMessage wrappers + id capture
│   ├── filter.ts               # the `context` handler (thin glue) + pipeline ordering + fail-open
│   ├── transforms.ts           # PURE: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline
│   ├── ledger.ts               # PURE: extractFileLedger
│   ├── tokens.ts               # PURE: estimateTokens, resultBytes, approxTokens
│   ├── notes.ts                # PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge
│   ├── nudges.ts               # tool_result annotator + turn_end metric + shouldNudge/injectNudge
│   └── tools/
│       ├── rewind.ts
│       ├── shrink.ts
│       ├── checkpoint.ts
│       └── audit.ts
├── test/
│   ├── transforms.test.ts
│   ├── ledger.test.ts
│   ├── tokens.test.ts
│   ├── notes.test.ts
│   ├── pipeline.test.ts        # composition + protected + idempotency
│   └── integration/
│       ├── smoke.ts            # the integration harness (adapted from reference/looper-smoke.proto.ts)
│       └── scenarios.md        # how to run each F-* scenario from @10-testing.md
└── .pi/
    └── extensions/             # symlink or copy for auto-discovery during dev
```

### 1.1 `package.json` (minimum viable)
```jsonc
{
  "name": "pi-mulligan",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "pi": { "extensions": ["./src/index.ts"] },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",   // resolved by pi at load
    "typebox": "*"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^1"                            // or node:test
  },
  "scripts": {
    "test": "vitest run",
    "smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""
  }
}
```
> Note: at runtime, pi resolves `@earendil-works/pi-coding-agent` and `typebox` from its own install (extensions are jiti-loaded in pi's process). Declaring them here is for editor type-resolution and dev ergonomics; use `npm install` in the extension dir if you need local `node_modules` for IntelliSense, and consult `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` for exact signatures (the spec reproduces them, but the `.d.ts` is authoritative).

### 1.2 `tsconfig.json` (minimum)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noImplicitAny": true, "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

---

## 2. Build order (do these in sequence; verify before proceeding)

### Step 0 — Scaffold & types (15 min)
- Create the files above as stubs. Get `pi -e ./src/index.ts -p "hi"` to load and print a `session_start` log line without error. **Verify:** no load error; a no-op extension runs.

### Step 1 — `config.ts` + `log.ts` + `runtime.ts` (30 min)
- Implement config load/validate/default (§09) and the structured logger (§04 §9).
- Implement `runtime(ctx)` returning the per-session `SessionRuntime`, created on `session_start`.
- **Verify:** a unit test that feeds a partial/invalid `mulligan` settings object and asserts the defaulted+validated output; bad values don't throw.

### Step 2 — Pure helpers: `tokens.ts`, `ledger.ts`, `notes.ts` (1–2 h)
- Implement `estimateTokens`, `resultBytes`, `approxTokens`.
- Implement `extractFileLedger` per `@04-data-model.md` §2.2.
- Implement `validateNote`, `renderNote`, `renderBloatReminder`, `renderDriftNudge`.
- **Verify:** the Tier-1 unit tests in `@10-testing.md` §1.6–1.8 pass. These have **zero Pi dependency**.

### Step 3 — Pure core: `transforms.ts` (2–3 h — the bulk)
- Implement `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`, `applyRewind`, `applyShrink`, `filterPipeline` exactly per `@06-context-filter.md`.
- **Verify:** Tier-1 §1.1–1.5 and §1.9 (composition, protected, idempotency) pass. Add the property tests (§3): pairing invariant, idempotency, monotonic shrinkage. **This is the most important step; do not proceed until the pairing invariant holds on randomized inputs.**

### Step 4 — `markers.ts` (30 min)
- Thin wrappers: `appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric`, `leaveNote`, `setCheckpoint`, each capturing the leaf id immediately after `pi.appendEntry` (C7) and incrementing `seq`.
- **Verify:** a tiny integration snippet that appends a marker and reads it back via `ctx.sessionManager.getEntries()`; assert shape + that it's a `custom` (not `custom_message`).

### Step 5 — `filter.ts` (1 h)
- Wire the `context` handler: read markers, call `filterPipeline`, cache `lastFiltered`, inject nudge, fail-open.
- **Verify (integration):** the F-rewind-core scenario — inject a canary, drive a rewind, assert the canary drops on the next `context.fire` and a second assistant message is produced. This is the spike's central proof, reproduced.

### Step 6 — Tools: `tools/rewind.ts`, `shrink.ts`, `checkpoint.ts`, `audit.ts` (2 h)
- Implement per `@05-tools.md`. Rewind composes ledger + note, persists marker + note, returns confirmation/warnings. Shrink validates + persists. Checkpoint labels the leaf. Audit reads `lastFiltered` and renders.
- **Verify (integration):** F-shrink-persist, F-protected, F-maxdepth, F-checkpoint, F-failopen scenarios pass.

### Step 7 — `nudges.ts` (1 h)
- `tool_result` annotator (bloat reminder) + `turn_end` metric + the `context` nudge injection path.
- **Verify (integration):** F-shrink-preventive and F-nudge-drift scenarios pass; assert `mulligan:nudge` is **never** persisted.

### Step 8 — `index.ts` wiring + edge pass (1 h)
- Register all tools; attach all handlers; wire config. Run through `@08-edge-cases.md` as a checklist (E1–E20) with targeted tests/scenarios.
- **Verify:** F-reload (markers survive `--session-id` re-open); full TUI manual smoke (§10 §4).

### Step 9 — Polish
- README (install, configure, usage). Decision-log link to `spec/`. Confirm `pi -e ./src/index.ts` with no `mulligan` config works out of the box (all defaults).
- Optional: package as a pi package (`pi install`) per `docs/packages.md`.

---

## 3. "Definition of done"

1. All Tier-1 unit tests green, including the pairing-invariant property test on randomized inputs.
2. All F-* integration scenarios green against a real `pi -p` run (log + JSONL assertions).
3. `mulligan:nudge` is provably never persisted (JSONL grep returns 0 across all scenarios).
4. Disabling via `config.enabled=false` makes the extension a pure no-op (no `context` transform, tools refuse cleanly).
5. An intentional filter exception does not break an agent turn (F-failopen).
6. README documents install, the four tools, configuration, and the "soft-delete / visible-in-`/tree`" guarantee.

## 4. Cross-references
- What each module implements → `@03-architecture.md` §7, `@04-data-model.md`, `@05-tools.md`, `@06-context-filter.md`, `@07-preventive-and-nudges.md`
- How to verify each → `@10-testing.md`
12. Glossary & references — # 12 — Glossary & references

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
- **D6** No undo; agent rewinds permanent; human recovery via native `/tree`.
- **D7** Relative targeting for the two granularities (compaction-robust).
- **D8** No human command; no session-tree mutation (redundant with `/tree`/`/compact`/`/fork`).

---

*End of specification. The omnibus document is `SPEC.md` + files `01`–`12` in index order, plus `reference/HANDOFF.md` and `reference/looper-smoke.proto.ts` as proven artifacts.*

Reference artifacts (not part of the narrative, but proven and authoritative):

- Feasibility spike handoff (compressed findings) — `@reference/HANDOFF.md`
- Proven smoke harness (prototype; uses `looper_*` names, the precursor to `mulligan_*`) — `@reference/looper-smoke.proto.ts`
