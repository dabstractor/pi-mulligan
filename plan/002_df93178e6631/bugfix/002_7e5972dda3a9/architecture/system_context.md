# System Context — Bugfix 002: bloatThresholdFor Proto-Key Leak & Stale Spec Sync

## Overview

Three minor bugs found during a bug-hunt of the P2 (Per-Tool Bloat Threshold) changeset.
All are non-critical; none affect built-in Pi tools at runtime.

## BUG-001: Prototype-Key Leak in bloatThresholdFor

**Location**: `src/nudges.ts:86-91` — function `bloatThresholdFor(toolName, config)`

**Current code** (the bug):
```ts
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;  // BUG: no hasOwnProperty guard
}
```

**Root cause**: `byTool[toolName]` reads inherited `Object.prototype` properties for keys like
`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"isPrototypeOf"`, `"toLocaleString"`.
The `?? global` operator only catches `null`/`undefined`, not inherited functions. So for a tool named
`"constructor"`, `byTool[toolName]` returns `Object` (the constructor function), not `undefined`.

**Downstream impact**:
1. `bloatReminderHandler` (src/nudges.ts:124): `if (bytes < threshold) return;` evaluates
   `number < function` → always `false` → reminder fires on EVERY result regardless of size.
2. `renderBloatReminder`: `Math.round(threshold / 1024)` → `NaN` → reminder text says "(threshold NaN KB)".
3. `audit.ts:528`: `bloatThresholdFor(toolName, config)` per-row → same NaN KB rendering in audit output.

**Fix**: Replace `byTool[toolName] ?? global` with:
```ts
return Object.prototype.hasOwnProperty.call(byTool, toolName) ? byTool[toolName] : global;
```

**Test file**: `test/nudges.test.ts` — existing `bloatThresholdFor` tests at lines 133-172.
The test file uses vitest. Tests construct configs using `getConfig()` (returns DEFAULT_CONFIG)
or hand-built `MulliganConfig` literals (to bypass `validateConfig` merge behavior).

**Transitive impact on audit.ts**: `src/tools/audit.ts:52` imports `bloatThresholdFor` from `../nudges.js`
and calls it at line 528. NO direct code change needed in audit.ts — fixing the function in nudges.ts
fixes the transitive bug. The audit test file is `test/tools/audit.test.ts`.

**No proto pollution in config.ts**: `coerceBloatThresholdByTool()` already uses safe spread
`{...(fallback ?? {})}` and iterates with `Object.entries()`. The bug is isolated to the lookup function.

## BUG-002: Stale Data-Model Config Schema

**Location**: `spec/04-data-model.md:243`

**Current (stale)**:
```
nudges: {
  bloatReminder: boolean;          // tool_result annotation; default true
  perTurnDrift: boolean;           // context nudge; default true
  bloatThresholdBytes: number;     // default 8192 (in-context bytes of a single result)
  driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
};
```

**Should match** src/config.ts (DEFAULT_CONFIG) and spec/09-configuration.md:
- `bloatThresholdBytes` default → `16384` (not `8192`)
- Add `bloatThresholdBytesByTool?: Record<string, number>` with default `{ bash: 32768, read: 20480 }`

## BUG-003: Stale "8 KB" Prose

**Location 1**: `spec/10-testing.md:67` — F-shrink-preventive table row:
- Current: `tool_result hook annotates a >8KB result`
- Should be: `>16KB result` (the global default; per-tool is 20KB read / 32KB bash)

**Location 2**: `spec/01-pi-context-internals.md:197` — design rationale:
- Current: `(e.g. 8 KB in-context)`
- Should be: `(e.g. 16 KB in-context)`

## Already-Correct References (NOT bugs)

- `spec/07-preventive-and-nudges.md:52` — already says `16384` (16 KB)
- `spec/09-configuration.md:66-67` — already says `16384` + `{bash:32768, read:20480}`
- `README.md:91-92,108,204` — already updated with 16384 + bloatThresholdBytesByTool
- `src/config.ts` — DEFAULT_CONFIG already correct (16384 + map)

## Tech Stack

- **Language**: TypeScript (strict mode, ESM `.js` imports)
- **Test runner**: vitest (`vitest run`)
- **Build check**: `npx tsc --noEmit`
- **Full test suite**: 742 tests, all passing pre-fix