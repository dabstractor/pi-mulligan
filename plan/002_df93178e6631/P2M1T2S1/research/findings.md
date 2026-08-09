# Research Findings — P2.M1.T2.S1 (bloatThresholdFor helper + wiring)

## Scope (from item description — EXACT)
Two edits to `src/nudges.ts` ONLY. Nothing else.
- (a) ADD + `export function bloatThresholdFor(toolName, config)` (verbatim, see below).
- (b) In `bloatReminderHandler`, change ONE line: `const threshold = config.nudges.bloatThresholdBytes;`
  → `const threshold = bloatThresholdFor(event.toolName, config);`. NOTHING else in the handler.
- DOCS = Mode A none (no README/config surface change). No tests (T2.S2 owns them).

## Current code state (verified by direct read + grep)
**S1 and S2 are ALREADY LANDED in the working tree** (this PRP runs in parallel with S2 but S2's
config.ts changes are present):
- `src/config.ts:62-68` — interface field `bloatThresholdBytesByTool?: Record<string, number>` + JSDoc ✓
- `src/config.ts:109-110` — `bloatThresholdBytes: 16384` + `bloatThresholdBytesByTool: { bash: 32768, read: 20480 }` ✓
- `src/config.ts:221-226` — S2's validateConfig wiring (`coerceBloatThresholdByTool`) ✓
- `src/config.ts:298-316` — S2's `coerceBloatThresholdByTool` helper ✓
- `src/nudges.ts:106` — STILL `const threshold = config.nudges.bloatThresholdBytes;` (the line T2.S1 changes)
- NO `bloatThresholdFor` exists anywhere (grep clean) ✓

So after validation, `config.nudges.bloatThresholdBytesByTool` is ALWAYS a valid
`Record<string, number>` (default `{ bash: 32768, read: 20480 }`; merges user overrides; never undefined).

## Imports already present in src/nudges.ts (no new import needed)
- `import type { MulliganConfig } from "./config.js";` (line 26) — the helper's `config: MulliganConfig`
  param type. ✓ No import to add.

## Placement anchors (exact line numbers, src/nudges.ts)
- Line 51: `import type { MessageLike } from "./transforms.js";` (end of imports)
- Line 53-59: `type ToolResultContentBlock` (JSDoc + decl)
- Line 61-73: `interface BloatReminderResult` (JSDoc + interface)
- Line 75: `/**` — START of `bloatReminderHandler` JSDoc
- Line 88: `export function bloatReminderHandler(`
- Line 105: `const bytes = resultBytes(...)`
- **Line 106: `const threshold = config.nudges.bloatThresholdBytes;`** ← CHANGE THIS
- Line 107: `if (bytes < threshold) return;`

RECOMMENDED placement for the helper: **immediately above bloatReminderHandler** (after the
`BloatReminderResult` interface closing `}` at line 73, before the handler JSDoc at line 75) — groups the
pure helper with its sole consumer. The item also allows "after imports, before bloatReminderHandler";
both compile fine.

## CRITICAL TYPE-SAFETY FINDING (resolved — NON-issue, but document it)
tsconfig.json has `"strict": true` + `"noImplicitAny": true` but **NOT `noUncheckedIndexedAccess`**.
Therefore `byTool[toolName]` (where `byTool: Record<string, number>`) is statically typed `number`
(key absence is invisible to the type system). The helper's `byTool[toolName] ?? global` still works
CORRECTLY because `??` is a **runtime** operator: a missing key yields `undefined` at runtime → `?? global`
falls back. `??` on a statically-`number` left operand is NOT a tsc error.

VERIFIED: ran `npx tsc --noEmit` on the EXACT verbatim helper body (with the project flags) → exit 0, no
errors. **The implementer should copy the helper verbatim and NOT "improve" it** (e.g. do not add an
explicit `if (toolName in byTool)` guard, do not cast, do not change `??`). The verbatim code is correct
and compiles.

The other `??` in the helper — `config.nudges.bloatThresholdBytesByTool ?? {}` — is fine because the
interface field is optional (`?:`), so its type is `Record<string, number> | undefined` (genuinely nullable
→ `?? {}` is a legitimate nullable fallback). Keep it (defensive; matches the interface's optional type).

## Test baseline (verified, sets the T2.S1 gates)
- `test/config.test.ts`: **29 passed** (GREEN). S1+S2 landed cleanly. T2.S1 does NOT touch config → must
  stay 29 passed.
- `test/nudges.test.ts`: **10 failed | 10 passed** (RED — EXPECTED). The 10 failures are all threshold-
  fixture tests (over-threshold, boundary, multi-result, register-fires-on-over) whose fixtures
  (9000 / 8192 / 8191 / 10000 / 20000 bytes) are now UNDER the raised global default (16384) and, after
  T2.S1, also under the per-tool thresholds (read=20480, bash=32768). These are OWNED BY T2.S2.
  The 10 PASSING tests are: registration (`registers a handler for 'tool_result'`), config gates (2),
  mulligan_* skip (2: the "still fires for a normal toolName" one uses OVER_TEXT=9000 which is under
  threshold so... actually need care — see note), and the fail-open throwing tests.
- **Does T2.S1 turn any PASSING nudges test into FAILING?** Analyzed: NO. All bash/read fixtures
  (9000/8192/8191/10000/20000) are < 16384 (old global) already, so every over-threshold test that
  expects firing is ALREADY failing. T2.S1 raises bash/read thresholds further (20480/32768) but cannot
  newly break a test that was passing, because no passing test depends on a bash/read result in the
  [16384, 32768) band firing. GATE for implementer: run `test/nudges.test.ts` before AND after; the
  PASSING COUNT must stay ≥ 10 (ideally exactly 10) and no previously-passing test may newly fail.
- Project-wide `npx tsc --noEmit`: **GREEN** (baseline). T2.S1 must keep it green.

## The verbatim helper (spec/07 §1) — compiles as-is
```typescript
export function bloatThresholdFor(toolName: string | undefined, config: MulliganConfig): number {
  const global = config.nudges.bloatThresholdBytes;
  if (!toolName) return global;
  const byTool = config.nudges.bloatThresholdBytesByTool ?? {};
  return byTool[toolName] ?? global;
}
```

## Out-of-scope doc drift (DO NOT fix in T2.S1)
`src/nudges.ts` lines 16 and 77 have JSDoc/comments saying "default 8192" (stale after S1 raised the global
to 16384). These are pre-existing doc drift (S1 was scoped to config.ts and did not touch nudges.ts). The
item is explicit: "This is the ONLY change to the handler" + Mode A none. **Do NOT edit these comments in
T2.S1.** (bloatReminderHandler's JSDoc at line 77 saying "exceeds config.nudges.bloatThresholdBytes" is
still directionally accurate — the global is the fallback.) Leave for a future doc-cleanup pass.

## Downstream consumers (the export's reason to exist)
- P2.M1.T2.S2: unit-tests `bloatThresholdFor` directly (pure fn, no Pi runtime) + resizes nudges fixtures +
  adds per-tool scenarios.
- P2.M1.T2.S3: updates `test/integration/smoke.ts` threshold references.
- P2.M1.T2.S4: README Mode B docs.