# External Dependencies & Pi API Surface — P3 Delta

## ContextUsage type (critical for §5.2 high-water signal)

Verified from `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:193`:

```typescript
export interface ContextUsage {
    tokens: number | null;
    contextWindow: number;   // ← the model's context window size (e.g. 200000)
    percent: number | null;
}
```

Accessed via `ctx.getContextUsage(): ContextUsage | undefined` (spec/01 §7; extensions/types.d.ts:244).

**For the high-water signal:** `windowTokens = ctx.getContextUsage()?.contextWindow ?? 0`. The high-water fires when `totalFilteredTokens / windowTokens >= highWaterFraction` (default 0.7). If getContextUsage is undefined or contextWindow is 0, the high-water signal must be skipped (fail-open — never break the turn).

**Key constraint (D5):** `getContextUsage().tokens` counts HIDDEN tokens (Pi's view includes rewound messages). For the high-water TOTAL, use `estimateTokens(rt.lastFiltered).tokens` or `estimateTokens(filteredMessages).tokens` — the FILTERED view, exactly like mulligan_audit does. Never use `getContextUsage().tokens` for the total.

## appendEntry / getLeafId / getEntries (markers.ts wrappers)

- `pi.appendEntry(customType: string, data?: unknown): void` — appends a CustomEntry (NOT in LLM context). Returns void (C7).
- `ctx.sessionManager.getLeafId(): string | null` — returns the id of the most-recent entry (the just-appended one). Must be called IMMEDIATELY after appendEntry, before any other append (C7/GOTCHA #5).
- `ctx.sessionManager.getEntries(): SessionEntry[]` — all entries on the branch (read FRESH — C12). Used by readMarkers.
- `ctx.sessionManager.getBranch(): SessionEntry[]` — ROOT→LEAF entries. Used by filterPipeline for pinned resolution.
- `ctx.sessionManager.getSessionId(): string` — read FRESH each call (C12).

## SessionEntry shape (read by readMarkers)

A custom marker entry:
```typescript
{
  type: "custom",           // NOT "message" or "custom_message" or "label"
  customType: "mulligan:rewind" | "mulligan:shrink" | "mulligan:turn-metric" | "mulligan:cancel",
  data: { schema: "pi-mulligan", v: 1, kind: "...", ...markerFields },
  id: "<stable-entry-id>",  // stable across compaction
}
```

readMarkers filters `entry.type === "custom"` + `customType.startsWith("mulligan:")`, then dispatches on `customType` + `data.kind`.

## ToolDefinition / defineTool (tool registration)

```typescript
import { defineTool, type ToolDefinition, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export function makeCancelTool(pi: ExtensionAPI): ToolDefinition<typeof CancelParams, CancelDetails> {
  return defineTool({
    name: "mulligan_cancel",
    label: "Mulligan Cancel",
    description: "...",
    parameters: CancelParams,  // typebox schema
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return cancelExecute(pi, toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
```

`pi` is NOT passed to `execute()` — it must be captured via the factory closure (shrink.ts/checkpoint.ts/rewind.ts precedent). index.ts does `pi.registerTool(makeCancelTool(pi))`.

## Config validation pattern (config.ts)

The established `coerceNumber` pattern for new numeric knobs:
```typescript
// In validateConfig's shrink block:
v = safeGet(shrinkRaw, "maxActive");
if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true); // >0

v = safeGet(shrinkRaw, "staleAfterFires");
if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true); // >0
```

For `highWaterFraction` (fraction in (0,1)), the existing `coerceNumber` doesn't enforce the upper bound < 1. A dedicated coercer or an inline check is needed (finite, > 0, < 1). For `driftWindowTurns`, use `coerceNumber` with mustBePositive and additionally floor to integer.

## Prior research reused
- `plan/002_df93178e6631/architecture/config_validation_design.md` — the `coerceNumber`/`coerceBloatThresholdByTool` merge pattern.
- `plan/002_df93178e6631/architecture/system_context.md` — exact code state of config.ts/filter.ts/markers.ts (from session 002).