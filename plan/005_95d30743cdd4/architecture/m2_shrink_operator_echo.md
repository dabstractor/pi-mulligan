# M2 Architecture — Shrink Operator Echo + Config Knob

## Problem

`mulligan_shrink`'s replacement payload currently has NO operator surface, and the tool result is about to become terse. The replacement needs a `ctx.ui.notify` echo (zero context cost) so the human sees what the model told itself.

## Current state (verified)

### `src/tools/shrink.ts` (327 LOC)

- **Result text:** `feedbackText(matched)` at line ~155 returns:
  ```
  Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes|no)
  ```
  This is the OLD verbose form. The PRD wants the terse `"Mulligan: shrink recorded. Matched: yes/no."`.
- **No `ctx.ui.notify`:** the tool does not call `ctx.ui` anywhere.
- **No cap helper:** no truncation logic for the replacement text.

### `src/config.ts` (417 LOC)

- `MulliganConfig.shrink` interface (lines ~46–57): `{ enabled, maxActive, staleAfterFires }` — **lacks `notifyMaxChars`**.
- `DEFAULT_CONFIG.shrink` (lines ~127–130): `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` — **lacks `notifyMaxChars`**.
- `validateConfig` shrink block (lines ~260–263): validates `enabled`, `maxActive`, `staleAfterFires` — **lacks the `notifyMaxChars` line**.

## Verified Pi API surfaces

| Surface | Location | Signature | Verified |
|---|---|---|---|
| `ctx.ui.notify` | `ExtensionUIContext` (types.d.ts:76) | `notify(message: string, type?: "info" \| "warning" \| "error"): void` | ✅ confirmed |
| `ctx.hasUI` | `ExtensionContext` (types.d.ts:215) | `boolean` — true in TUI and RPC modes | ✅ confirmed |

## Target design

### Config knob `shrink.notifyMaxChars`

**Interface** (`MulliganConfig.shrink`, after `staleAfterFires`):
```ts
notifyMaxChars: number;
```
JSDoc: "Caps the replacement text shown to the operator via ctx.ui.notify (zero context cost). Default 2048."

**Default** (`DEFAULT_CONFIG.shrink`):
```ts
notifyMaxChars: 2048,
```

**Validation** (in `validateConfig`'s shrink block, after `staleAfterFires`):
```ts
v = safeGet(shrinkRaw, "notifyMaxChars");
if (v !== undefined) cfg.shrink.notifyMaxChars = coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true);
```
`mustBePositive: true` → values ≤ 0 fall back to default + warn. This mirrors `maxActive`/`staleAfterFires` exactly (same block, same pattern).

### Terse result + notify echo (`shrink.ts`)

**Step (a): Terse result text.** Replace `feedbackText(matched)`:
```ts
// OLD:
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${matched ? "yes" : "no"})`;
}
// NEW (spec/05 §2 return shape):
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}.`;
}
```
The replacement is **NOT** echoed in the result (echoing would place a second copy in context, defeating the tool).

**Step (b): Notify echo (behavior step 5, spec/05 §2).** After `appendShrinkMarker` (step 4/5 persist), before the return:
```ts
// (5b) operator echo (spec/05 §2 step 5 — zero context cost; NOT in the tool result).
try {
  if (ctx.hasUI) {
    const capped = cap(replacement, config.shrink.notifyMaxChars);
    ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
  }
} catch {
  // E13: a UI failure must never break the tool.
}
```

**Local `cap` helper:**
```ts
function cap(s: string, max: number): string {
  if (typeof s !== "string" || s.length <= max) return s;
  return s.slice(0, max) + `…(${s.length} chars total)`;
}
```

**`describeTarget` helper** (for the notify message — a brief description of what was shrunk):
```ts
function describeTarget(target: ShrinkArgs["target"]): string {
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  if ("by_content_includes" in target) return `message containing "${target.by_content_includes.slice(0, 40)}"`;
  return "message";
}
```

### What stays UNCHANGED

- The `ShrinkParams` schema, `SHRINK_DESC`, `targetIsStructurallyValid`, `resolveTargetEntryId`, `entryIdAtMessageIndex` — all unchanged.
- The persist step (`appendShrinkMarker`) — unchanged.
- The `ShrinkDetails` interface — unchanged.
- The outer try/catch (E13) — unchanged.

## Test fakes for notify capture

`makeCtx` must be extended to include a `ui` fake with a `notify` capture array:
```ts
function makeCtx(opts: { ..., hasUI?: boolean } = {}) {
  const notifyCalls: { message: string; type?: string }[] = [];
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: { notify(message: string, type?: string) { notifyCalls.push({ message, type }); } },
    sessionManager: { ... },
    ...
  };
  return { ctx: ctx as unknown as ExtensionContext, notifyCalls };
}
```
Tests assert `notifyCalls` contents when `hasUI: true`, and that `notifyCalls` is empty when `hasUI: false`.