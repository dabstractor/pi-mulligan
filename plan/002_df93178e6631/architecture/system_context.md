# System Context — Delta 002: Per-Tool Bloat Threshold

## Overview

This is a **surgical ~6-line behavioral change** to Nudge A (the bloated-result reminder). The
global byte threshold (`bloatThresholdBytes`, currently `8192`) must resolve **per tool** via an
optional override map (`bloatThresholdBytesByTool`), falling back to a raised global default.

## Current Code State (verified by direct read)

### `src/config.ts`

**Interface `MulliganConfig.nudges`** (lines ~55–66):
```typescript
bloatReminder: boolean;        // default: true
perTurnDrift: boolean;          // default: true
bloatThresholdBytes: number;    // default: 8192  ← RAISE to 16384
driftThresholdTokens: number;   // default: 3000
// NO bloatThresholdBytesByTool field exists
```

**`DEFAULT_CONFIG.nudges`** (lines ~102–105):
```typescript
bloatReminder: true,
perTurnDrift: true,
bloatThresholdBytes: 8192,    // ← change to 16384
driftThresholdTokens: 3000,
// ← ADD: bloatThresholdBytesByTool: { bash: 32768, read: 20480 }
```

**`validateConfig`** (lines ~209–218): reads nudges fields from `nudgesRaw` via `safeGet()`, coerces each:
```typescript
const nudgesRaw = safeGet(raw, "nudges");
if (isRecord(nudgesRaw)) {
  v = safeGet(nudgesRaw, "bloatReminder");
  if (v !== undefined) cfg.nudges.bloatReminder = coerceBoolean(v, cfg.nudges.bloatReminder);
  // ... perTurnDrift ...
  v = safeGet(nudgesRaw, "bloatThresholdBytes");
  if (v !== undefined) cfg.nudges.bloatThresholdBytes = coerceNumber("nudges.bloatThresholdBytes", v, cfg.nudges.bloatThresholdBytes, true);
  // ... driftThresholdTokens ...
}
```
No handling for `bloatThresholdBytesByTool` exists. The new coercion must be added inside the
`if (isRecord(nudgesRaw))` block.

### `src/nudges.ts` — `bloatReminderHandler` (exported)

The exact line to change:
```typescript
const threshold = config.nudges.bloatThresholdBytes;  // ← REPLACE
```
Target:
```typescript
const threshold = bloatThresholdFor(event.toolName, config);
```

Everything downstream is already parameterized on `threshold`:
- `renderBloatReminder(event.toolName, bytes, threshold)` — takes threshold as param ✓
- `if (bytes < threshold) return;` — comparison uses resolved threshold ✓
- `rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) })` ✓

No `bloatThresholdFor` helper exists — must be **added and exported** for unit testing.

### `src/notes.ts` — `renderBloatReminder`

Already takes `(toolName, bytes, thresholdBytes)`. **No change needed.**

## Target Design (from spec/07 §1 and spec/09)

### `bloatThresholdFor` helper (spec/07 §1, exact code):
```typescript
function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;
}
```

### Defaults (spec/09 §2):
- `bloatThresholdBytes`: `16384` (raised from `8192`)
- `bloatThresholdBytesByTool`: `{ "bash": 32768, "read": 20480 }`

### Resolution priority:
1. If `toolName` is in `bloatThresholdBytesByTool` → use that value
2. Otherwise → use global `bloatThresholdBytes`

## Files Touched

| File | Change |
|------|--------|
| `src/config.ts` | Interface + DEFAULT_CONFIG + validateConfig coercion + JSDoc |
| `src/nudges.ts` | Add + export `bloatThresholdFor`; wire into `bloatReminderHandler` |
| `test/config.test.ts` | Update 8192→16384 literals; add map validation coverage |
| `test/nudges.test.ts` | Resize fixtures; update THRESHOLD constant; add per-tool scenarios |
| `test/integration/smoke.ts` | Update threshold comments |
| `README.md` | Config table + example + How-It-Works bullet |

## NOT Touched

- `src/notes.ts` (renderBloatReminder already parameterized)
- `src/tokens.ts`, `src/filter.ts`, `src/transforms.ts`, `src/markers.ts`
- Drift nudge (Nudge B)
- Tool implementations (rewind/shrink/checkpoint/audit)
- `event.toolName` contract or `renderBloatReminder` text format