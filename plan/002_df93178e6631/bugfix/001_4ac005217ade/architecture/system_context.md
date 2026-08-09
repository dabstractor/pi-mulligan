# System Context — P2 Per-Tool Bloat Threshold Integration Gap

## Project
`pi-mulligan` — a Pi coding-agent extension providing context management tools (rewind, shrink, checkpoint, audit) and preventive nudges (bloat reminder, drift nudge).

## Baseline State (verified 2025-01-23)
- **TypeScript**: compiles clean (`tsc --noEmit` → no errors).
- **Test suite**: 733 tests pass (`vitest run` → 18 files, 733 passed). NOTE: PRD states 722 as baseline; working tree has uncommitted WIP that added tests. Both counts pass.
- **P2 Feature**: Complete and correct in its own deliverables:
  - `config.ts`: `bloatThresholdBytesByTool` interface field + `DEFAULT_CONFIG.nudges.bloatThresholdBytesByTool = { bash: 32768, read: 20480 }` + global raised `8192 → 16384`.
  - `coerceBloatThresholdByTool`: merge semantics with per-entry drop+warn, never throws. Returns cloned default map for non-object input.
  - `bloatThresholdFor(toolName, config)`: exported from `nudges.ts`, pure, two reads + fallback. Used by `bloatReminderHandler` at `nudges.ts:124`.
  - README + smoke.ts fully synced.

## The Integration Gap (BUG-001)
P2 propagated per-tool threshold resolution to the **bloat reminder** (`bloatReminderHandler` in `nudges.ts`) but NOT to the **audit tool** (`mulligan_audit` in `src/tools/audit.ts`). These are the TWO consumers of the bloat threshold. The nudge system correctly resolves per-tool; the audit does not.

### Consumer 1: Bloat Reminder (CORRECT — per-tool)
- File: `src/nudges.ts`
- Function: `bloatReminderHandler(event, ctx)` at line ~108
- Threshold resolution: `const threshold = bloatThresholdFor(event.toolName, config);` at line ~124
- Skips `mulligan_*` tools entirely (GOTCHA #3)
- **Result**: bash 20000B → no reminder (20000 < 32768); read 18000B → no reminder (18000 < 20480)

### Consumer 2: Audit Tool (BUGGY — global only)
- File: `src/tools/audit.ts`
- Function: `auditExecute(toolCallId, params, signal, onUpdate, ctx)` at line ~480
- Threshold resolution: `const threshold = config.nudges.bloatThresholdBytes;` (line ~520) — GLOBAL ONLY
- Bloaty computation: `bloaty: messageBytes(msg) > threshold` (line ~529) — single threshold for ALL rows
- Rendering: `renderAuditReport` takes `thresholdBytes: number` and renders `const kb = Math.round(args.thresholdBytes / 1024)` — single KB for ALL flagged rows
- **Result**: bash 20000B → flagged bloated (20000 > 16384) AND shows "(16 KB)" instead of "(32 KB)"; read 18000B → flagged bloated (18000 > 16384) AND shows "(16 KB)" instead of "(20 KB)"

## Architecture Invariants (must preserve)
1. **`auditTool` is a PLAIN `export const`** — no `pi` factory, no module-scoped `pi`. Every read goes through `ctx` or pure helpers.
2. **Never throws** — the whole `auditExecute` body is wrapped in ONE try/catch → failure text + `details.error`.
3. **`details` is REQUIRED** on every return path (CRITICAL GOTCHA #1).
4. **Never persists** — no `pi.*` calls (appendEntry/sendMessage/setLabel).
5. **Filtered view** — total computed from `estimateTokens(filtered)`, NEVER `ctx.getContextUsage()` (D5).
6. **`bloatThresholdFor` is PURE** — two reads from config, no I/O, no Pi runtime. Safe to call in the audit hot path.

## Key Interfaces

### AuditRow (src/tools/audit.ts) — CURRENT (needs modification)
```ts
export interface AuditRow {
  tokens: number;
  role: string;
  label: string;
  bloaty: boolean;  // currently: messageBytes(msg) > globalThreshold
}
```

### AuditRow — TARGET (add thresholdBytes)
```ts
export interface AuditRow {
  tokens: number;
  role: string;
  label: string;
  bloaty: boolean;
  thresholdBytes: number;  // NEW: the per-row resolved threshold for display
}
```

### bloatThresholdFor (src/nudges.ts) — ALREADY EXPORTED, NO CHANGES NEEDED
```ts
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;
}
```

### renderAuditReport (src/tools/audit.ts) — SIGNATURE CHANGE
- CURRENT: takes `thresholdBytes: number` as a single arg, renders all rows with the same KB
- TARGET: remove `thresholdBytes` from args; each `AuditRow` carries its own `thresholdBytes` for rendering

## Existing Audit Test Patterns (test/tools/audit.test.ts)
- Uses vitest, hand-rolled `makeCtx()` fake (no vi.fn()), `.js` import paths
- `clearAll()` runtime reset in beforeEach/afterEach (GOTCHA #6)
- `kbText(kb)` helper: `"x".repeat(kb * 1024)` — produces exact byte counts
- `toolResult(toolCallId, toolName, text)` fixture: creates `{role:"toolResult", toolCallId, toolName, content:[{type:"text",text}]}`
- Bloat flag tests at section "(e) bloat flag": currently test with 20 KB read result → bloaty=true + "(16 KB)"
  - **WILL BREAK after fix**: 20 KB = 20480 bytes = read threshold exactly → NOT > threshold → bloaty=false
  - Must update to use sizes that cross the CORRECT per-tool threshold

## File Dependency Graph (for this bugfix)
```
src/nudges.ts
  └── exports bloatThresholdFor (PURE, no changes needed)

src/tools/audit.ts  ← MAIN FIX TARGET
  ├── imports: estimateTokens, resultBytes (tokens.ts)
  ├── imports: getConfig (config.ts)
  ├── imports: filterPipeline (transforms.ts) — E16 fallback only
  ├── imports: readMarkers (filter.ts)
  ├── NEEDS: import { bloatThresholdFor } from "../nudges.js"
  └── AuditRow interface + auditExecute + renderAuditReport

test/tools/audit.test.ts  ← TEST UPDATES
  └── Update existing bloat flag tests + add per-tool discrimination tests
```