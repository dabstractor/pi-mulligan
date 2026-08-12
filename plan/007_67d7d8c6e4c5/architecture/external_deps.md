# External Dependencies — Pi API Surfaces Verified for v1.1

All surfaces verified against `node_modules/@earendil-works/pi-coding-agent@0.84.1/dist/core/extensions/types.d.ts`.

## 1. `pi.registerCommand` (NEW — v1.1 uses this for 3 slash commands)

**Location:** `types.d.ts:903`
```ts
registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
```

**`RegisteredCommand` shape** (`types.d.ts:851-857`):
```ts
export interface RegisteredCommand {
    name: string;
    sourceInfo: SourceInfo;
    description?: string;
    getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}
```

**Usage pattern** (mirrors tool factory closure pattern):
```ts
pi.registerCommand("mulligan_checkpoint", {
  description: "...",
  handler: async (args, ctx) => { /* ... */ },
});
```

The `Omit<..., "name" | "sourceInfo">` means we pass `{ description?, handler }` (optionally `getArgumentCompletions`).

**C2 does NOT block this** — C2 says an extension-injected *message* (via `sendUserMessage`) does not dispatch as a command. `registerCommand` is a direct registration, not message injection. Verified: commands are user-typed (human invokes `/mulligan_checkpoint`).

## 2. `ctx.ui.setWidget` (NEW — v1.1 banner)

**Location:** `types.d.ts:97-98` (on `ExtensionUIContext`)
```ts
setWidget(key: string, content: string[] | undefined, options?: ExtensionWidgetOptions): void;
```

**`ExtensionWidgetOptions`** (`types.d.ts:45-47`):
```ts
export interface ExtensionWidgetOptions {
    placement?: WidgetPlacement; // defaults to "aboveEditor"
}
export type WidgetPlacement = "aboveEditor" | "belowEditor";
```

**Usage pattern:**
```ts
ctx.ui.setWidget("mulligan:active-checkpoint", ["⚠ ...line..."], { placement: "aboveEditor" });
ctx.ui.setWidget("mulligan:active-checkpoint", undefined); // clear
```

## 3. `ExtensionCommandContext` (NEW — given to command handlers)

**Location:** `types.d.ts:254`
```ts
export interface ExtensionCommandContext extends ExtensionContext {
    getSystemPromptOptions(): BuildSystemPromptOptions;
    waitForIdle(): Promise<void>;
    newSession(...): Promise<...>;
    fork(entryId, ...): Promise<...>;
    navigateTree(targetId, ...): Promise<...>;
    switchSession(sessionPath, ...): Promise<...>;
    reload(): Promise<void>;
    // ...
}
```

**Extends `ExtensionContext`** (`types.d.ts:390+`), which provides:
- `ui: ExtensionUIContext` — has `notify`, `setWidget`, `setStatus`, etc.
- `mode: ExtensionMode` — "tui" | "rpc" | "json" | "print"
- `hasUI: boolean` — true in TUI/RPC, false in print/JSON
- `cwd: string`
- `sessionManager: ReadonlySessionManager` — read-only session tree access
- `model: Model | undefined`
- `getContextUsage(): ContextUsage | undefined`

So command handlers get `ctx.sessionManager` (read-only), `ctx.ui` (notify + setWidget), and `ctx.hasUI` (guard for UI ops).

## 4. `ctx.ui.notify` (existing — used by nudges)

```ts
notify(message: string, type?: "info" | "warning" | "error"): void;
```

Already used in `shrink.ts` and `nudges.ts`. The commands reuse it for user-facing messages.

## 5. `ExtensionContext` (existing — given to event handlers and tools)

Command handlers receive `ExtensionCommandContext extends ExtensionContext`. Event handlers and tools receive `ExtensionContext`. Both share `sessionManager`, `ui`, `hasUI`, `cwd`, `getContextUsage()`.

**IMPORTANT:** `reconcileBanner(ctx)` must accept `ExtensionContext` (not just `ExtensionCommandContext`) because it is called from `contextHandler` (which gets `ExtensionContext`) and `session_start` handler (same). Since `setWidget` is on `ExtensionUIContext` and `hasUI` is on `ExtensionContext`, both are available on the base context.

## 6. `ReadonlySessionManager` (existing — used for checkpoint scans)

Methods used by v1.1 commands:
- `getEntries()` — returns the raw session entry array (includes label entries)
- `getLabel(id)` — latest-wins label resolution; returns `string | undefined`
- `getBranch()` — ROOT→LEAF branch array
- `getLeafId()` — current leaf entry id
- `getSessionId()` — session id string

## Import Availability

The command/banner files can import from `"@earendil-works/pi-coding-agent"`:
- `ExtensionAPI` (type) — for the `pi` parameter
- `ExtensionCommandContext` (type) — for command handler `ctx`
- `ExtensionContext` (type) — for `reconcileBanner(ctx)`

Existing modules already import `ExtensionAPI`, `ExtensionContext`, `defineTool`, `ToolDefinition` from the same package.