# API Verification — pi-mulligan

> All signatures below were verified against the installed Pi `0.84.x` type
> definitions at `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/`.
> The spec (`spec/01-pi-context-internals.md`) says "the .d.ts wins" — this
> document records what the .d.ts actually says and flags any discrepancies.

## 1. Extension Factory

```ts
// File: dist/core/extensions/types.d.ts
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

A Pi extension is a TypeScript module exporting a **default** factory function.
May be sync or async (Pi awaits async factories before startup).

```ts
export default function (pi: ExtensionAPI) {
  pi.on("context", async (event, ctx) => { /* ... */ });
  pi.registerTool({ /* ... */ });
}
```

## 2. ExtensionAPI (`pi` object) — VERIFIED

### 2.1 Write Methods (what Mulligan tools use)

```ts
// File: dist/core/extensions/types.d.ts (ExtensionAPI interface)

// Append extension control state. Returns VOID (not an id). Creates a CustomEntry
// that does NOT participate in LLM context.
appendEntry<T = unknown>(customType: string, data?: T): void;

// Inject a CustomMessage that DOES participate in LLM context.
sendMessage<T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): void;

// Set/clear a label on an entry (visible in /tree). Used for checkpoints.
setLabel(entryId: string, label: string | undefined): void;

// Register an agent-callable tool.
registerTool<TParams extends TSchema, TDetails, TState>(tool: ToolDefinition<...>): void;

// Subscribe to lifecycle/model/tool/session events.
on<E extends keyof Events>(event: E, handler: ExtensionHandler<...>): void;
```

**VERIFIED:** `appendEntry` returns `void` (constraint C7 confirmed).
To capture a freshly-appended marker's entry id: call `ctx.sessionManager.getLeafId()`
or `getLeafEntry()` **immediately after**, in the same synchronous tick.

### 2.2 Methods Mulligan Does NOT Use (confirmed absent from needs)

`sendUserMessage`, `registerCommand`, `registerShortcut`, `registerFlag`,
`registerProvider`, `exec`, `setModel`, `setActiveTools`, etc.

## 3. ExtensionContext — VERIFIED

### 3.1 Full Interface (dist/core/extensions/types.d.ts)

```ts
export interface ExtensionContext {
  ui: ExtensionUIContext;
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;  // READ-ONLY — see §4
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  scopedModels: readonly ScopedModel[];
  thinkingLevel?: ThinkingLevel;
  signal: AbortSignal | undefined;
  isIdle(): boolean;
  isProjectTrusted(): boolean;
  hasPendingMessages(): boolean;
  abort(): void;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}
```

### 3.2 ContextUsage

```ts
export interface ContextUsage {
  tokens: number | null;        // null = unknown (e.g. right after compaction)
  contextWindow: number;
  percent: number | null;
}
```

**NOTE:** `tokens` can be `null` — Mulligan's audit/turn-metric code must handle this
(`?? 0` or explicit null check). The spec says `getContextUsage()?.tokens ?? 0`
which is correct.

### 3.3 ExtensionCommandContext (NOT used by Mulligan)

Extends `ExtensionContext` with: `getSystemPromptOptions()`, `waitForIdle()`,
`newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()`.

**Constraint C3 confirmed:** these methods are on `ExtensionCommandContext`, NOT
`ExtensionContext`. A tool's `execute` receives `ExtensionContext`, so it
**cannot** call `navigateTree`/`fork`/`newSession`. This is by type, not convention.

## 4. ReadonlySessionManager — VERIFIED

```ts
// File: dist/core/session-manager.d.ts
export type ReadonlySessionManager = Pick<SessionManager,
  "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile"
  | "getLeafId" | "getLeafEntry" | "getEntry" | "getLabel"
  | "getBranch" | "buildContextEntries" | "getHeader" | "getEntries"
  | "getTree" | "getSessionName">;
```

**Constraint C1 confirmed:** `branch`, `branchWithSummary`, `appendMessage`,
`appendCustomMessageEntry`, the mutator `setLabel`, etc. are **physically absent**
from `ReadonlySessionManager`. A tool cannot mutate the session through `ctx`.

### Key read methods used by Mulligan:

```ts
getEntries(): SessionEntry[]          // ALL entries (every branch), excluding header
getBranch(fromId?): SessionEntry[]    // entries from leaf (or fromId) walking to root
getLeafId(): string | null            // current leaf id (can be null)
getLeafEntry(): SessionEntry | undefined
getEntry(id: string): SessionEntry | undefined
getLabel(id: string): string | undefined
buildContextEntries(): SessionEntry[]  // active-branch entries with compaction applied
getSessionId(): string
```

**NOTE:** `getLeafId()` returns `string | null` — Mulligan's markers.ts must handle
null (e.g. checkpoint: `const leafId = ctx.sessionManager.getLeafId(); if (!leafId) return refusal`).

## 5. SessionEntry Types — VERIFIED

```ts
// File: dist/core/session-manager.d.ts

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

// Message entry (produces an LLM message)
interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

// Extension control state (does NOT participate in LLM context)
interface CustomEntry<T> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}

// Extension-injected context message (DOES participate in LLM context)
interface CustomMessageEntry<T> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}

// Label entry (bookmark — does NOT participate in LLM context)
interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

// Compaction entry
interface CompactionEntry<T> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  usage?: Usage;
  fromHook?: boolean;
}

// Branch summary entry
interface BranchSummaryEntry<T> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  usage?: Usage;
  fromHook?: boolean;
}

type SessionEntry = SessionMessageEntry | ThinkingLevelChangeEntry
  | ModelChangeEntry | CompactionEntry | BranchSummaryEntry | CustomEntry
  | CustomMessageEntry | LabelEntry | SessionInfoEntry;
```

**Key for filter:** markers are found by scanning `getEntries()` for
`type === "custom" && customType.startsWith("mulligan:")`.

**Key for checkpoint:** checkpoints are `LabelEntry` with
`label === "mulligan:checkpoint:<name>"` and `targetId` pointing at the checkpointed entry.

## 6. AgentMessage Union — VERIFIED

```ts
// From pi-agent-core (extended by pi-coding-agent via declaration merging):
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
// = UserMessage | AssistantMessage | ToolResultMessage
//   | BashExecutionMessage | CustomMessage | BranchSummaryMessage | CompactionSummaryMessage
```

### 6.1 Message Types (from pi-ai)

```ts
interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  // ...plus: api, provider, model, usage, stopReason, timestamp
}

interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  usage?: Usage;
  isError: boolean;
  timestamp: number;
}
```

### 6.2 Content Blocks (from pi-ai)

```ts
interface TextContent { type: "text"; text: string; }
interface ThinkingContent { type: "thinking"; thinking: string; }
interface ImageContent { type: "image"; data: string; mimeType: string; }
interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, any>; }
```

### 6.3 CustomMessage (from pi-coding-agent messages.ts)

```ts
interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}
```

**This is what the nudge injects** (constructed inline in the filter, never persisted):
```ts
const nudge: AgentMessage = {
  role: "custom", customType: "mulligan:nudge",
  content: line, display: false,
  details: { ephemeral: true, turnIndex: metric.turnIndex },
  timestamp: Date.now(),
};
```

### 6.4 Critical: Tool Pairing Invariant

`AssistantMessage.content[]` contains `ToolCall` blocks with `.id`.
`ToolResultMessage.toolCallId` equals that `.id`.
**The model API rejects a request that orphans either side.**
Every filter transform MUST preserve pairing.

## 7. Event Signatures — VERIFIED

### 7.1 `context` Event (Mulligan's primary surface)

```ts
interface ContextEvent {
  type: "context";
  messages: AgentMessage[];  // deep copy, safe to mutate/replace
}
interface ContextEventResult {
  messages?: AgentMessage[];  // optional — undefined/void = pass-through
}
// Handler type: (event, ctx) => Promise<ContextEventResult | void> | ContextEventResult | void
```

**DISCREPANCY NOTE:** The spec (`spec/06-context-filter.md` §1) shows
`return { messages }` and `return;` for fail-open. Both are correct —
`ContextEventResult.messages` is optional, so `return;` (void) = pass-through.

### 7.2 `tool_result` Event

```ts
// Base for all tool_result variants:
interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  usage?: Usage;
}
// Variants add toolName + details: BashToolResultEvent, ReadToolResultEvent, etc.
// Union: ToolResultEvent = BashToolResultEvent | ReadToolResultEvent | ... | CustomToolResultEvent

interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  usage?: Usage;
}
```

The bloat-reminder nudge returns `{ content: [...existing, { type: "text", text: reminder }] }`.

### 7.3 `turn_end` Event

```ts
interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;
  message: AgentMessage;          // the last assistant message
  toolResults: ToolResultMessage[]; // tool results from this turn
}
```

**DISCREPANCY NOTE:** The spec says "turn_end does not receive the message list."
Technically it receives `message` (the last assistant message) and `toolResults`
(an array), but NOT the full context message list. The spec's approach of using
an in-memory token baseline + lastFiltered is still correct — the `message` and
`toolResults` fields don't give enough to compute the full context token count.

### 7.4 `turn_start` Event

```ts
interface TurnStartEvent {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}
```

### 7.5 `session_start` Event

```ts
interface SessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}
```

### 7.6 `session_shutdown` Event

```ts
interface SessionShutdownEvent {
  type: "session_shutdown";
  reason: "quit" | "reload" | "new" | "resume" | "fork";
  targetSessionFile?: string;
}
```

## 8. ToolDefinition — VERIFIED

```ts
interface ToolDefinition<TParams extends TSchema, TDetails, TState> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  constrainedSampling?: false | ConstrainedSamplingConfig;
  renderShell?: "default" | "self";
  prepareArguments?: (args: unknown) => Static<TParams>;
  executionMode?: ToolExecutionMode;  // "sequential" | "parallel"
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult<TDetails>>;
  renderCall?: ...;
  renderResult?: ...;
}
```

**NOTE on execute signature:** The first argument is `toolCallId` (string).
Mulligan's `mulligan_rewind` tool uses this to set `excludeToolCallId` on the
rewind marker — so the filter can skip the rewind's own tool-call group.

**AgentToolResult shape (what execute returns):**
```ts
// From pi-agent-core
interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError?: boolean;
  usage?: Usage;
}
```

Mulligan tools return `{ content: [{ type: "text", text: "..." }] }`.

## 9. Proven Constraints Summary (from spec §02, all verified against .d.ts)

| Constraint | Status | Detail |
|---|---|---|
| C1: ReadonlySessionManager | ✅ Verified | No mutation methods on the type |
| C2: Extension messages bypass command dispatch | ✅ (empirically proven in spike) | sendUserMessage delivers as user text, not command |
| C3: navigateTree etc. command-context-only | ✅ Verified | On ExtensionCommandContext, not ExtensionContext |
| C4: context event is non-destructive per-inference | ✅ Verified | ContextEventResult.messages is optional |
| C7: appendEntry returns void | ✅ Verified | Signature: `void` |
| C8: sendMessage from tool is safe | ✅ (empirically proven) | Creates custom_message entry |
| C9: setLabel/getLabel round-trip works | ✅ Verified | setLabel on ExtensionAPI, getLabel on sessionManager |
| C12: Never cache sessionManager handle | ✅ Design constraint | Read fresh each invocation |

## 10. Discrepancies Found (Spec vs. .d.ts)

1. **`ContextUsage.tokens` is `number | null`** — The spec's `@01` §7 shows it as `number`.
   Mulligan must handle `null` (already does via `?? 0`).

2. **`getLeafId()` returns `string | null`** — The spec implies it returns `string`.
   Mulligan's checkpoint code must null-check.

3. **`TurnEndEvent`** has `message` and `toolResults` fields — The spec says
   "turn_end does not receive the message list." It's technically partially incorrect
   (it receives some messages), but the design approach (in-memory baseline) is still
   correct because turn_end doesn't receive the FULL context list.

4. **`AssistantMessage` has many fields** beyond `content` (api, provider, model,
   usage, stopReason, etc.) — When the filter preserves/shrinks messages, it should
   spread the original (`{ ...orig, content: [...] }`) to avoid losing fields.

These are minor and already handled by the spec's design (defensive code).
No architectural changes needed.