# 01 — Pi context internals (prerequisite knowledge)

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