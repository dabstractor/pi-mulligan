# System Context — Delta 005 (pi-mulligan refinements)

**Base:** HEAD `0bcaa814` (post-P4) · **Delta scope:** 4 independent refinements + README sync · **No new architecture**

## Verified codebase state at HEAD

All file/line references confirmed by direct source reading on 2025-08-10.

### Files targeted by this delta

| File | LOC | Milestone(s) | Current state |
|---|---|---|---|
| `src/tools/cancel.ts` | 275 | M1 | id-only schema; resolution maps `entry.id → data.id` (uuid) |
| `src/tools/shrink.ts` | 327 | M2 | verbose result text; no `ctx.ui.notify`; `feedbackText(matched)` |
| `src/config.ts` | 417 | M2 | `MulliganConfig.shrink` lacks `notifyMaxChars`; validation block missing the knob |
| `src/tools/rewind.ts` | 600 | M3 | checkpoint path has no expiry; `checkpointExists()` at line 293; persist at step 7 (~line 547) |
| `src/tools/audit.ts` | 657 | M3 | `listCheckpoints()` at line 324 scans `mulligan:checkpoint:` labels |
| `src/notes.ts` | 398 | M4 | `renderBloatReminder(toolName, bytes, thresholdBytes)` at line ~278 (3-arg, old text); `renderDriftNudge(metric)` at line ~322 |
| `src/nudges.ts` | 530 | M4 | call site `renderBloatReminder(event.toolName, bytes, threshold)` at line 133; `suppressCheck()` at line ~390 |
| `src/markers.ts` | 460 | M2.T2 | `leaveNote()` at line ~378 already passes `display:true`; comment needs expansion |
| `README.md` | 262 | M5 | config table at line ~73; JSON example at line ~105; tool blurbs at §4 |

### Files NOT modified (confirmed unchanged by this delta)

- `src/filter.ts` (455 LOC) — cancel drop logic keys on uuid `data.id` ∈ `cancelledIds`; **unchanged**
- `src/transforms.ts` (1368 LOC) — `resolveShrinkTarget`, `MessageLike`, `ShrinkTarget` exported; **unchanged** (M1 imports from it)
- `src/tools/checkpoint.ts` (175 LOC) — checkpoint tool delegates to `setCheckpoint()` wrapper; **unchanged**
- `src/index.ts` — tool wiring; **unchanged**

### Parallelizability matrix

| Milestone | Files touched | Overlap with other milestones? |
|---|---|---|
| M1 (cancel target) | `src/tools/cancel.ts` | NONE |
| M2 (shrink echo + config) | `src/tools/shrink.ts`, `src/config.ts` | NONE |
| M3 (checkpoint expiry) | `src/tools/rewind.ts`, `src/tools/audit.ts` | NONE (rewind.ts is M3-only) |
| M4 (nudge text) | `src/notes.ts`, `src/nudges.ts` | NONE |
| M5 (README sync) | `README.md` | DEPENDS on M1–M4 |

All of M1–M4 touch disjoint files and can be parallelized. M5 (README) depends on all of M1–M4.

## Test infrastructure patterns (verified, unchanged from P4 research)

### Test fakes (`makePi` / `makeCtx`)

From `test/tools/cancel.test.ts`:
```ts
// makePi: captures appendEntry calls (hand-rolled, NO vi.fn())
function makePi(opts: { throwOnAppend?: boolean } = {}) {
  const appended: { customType: string; data: unknown }[] = [];
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
  };
  return { appended, pi: pi as unknown as ExtensionAPI };
}

// makeCtx: scripts sessionManager methods per tool's read surface
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: SessionEntry[];
  throwOnGetEntries?: boolean;
} = {}) { ... }
```

### Config validation pattern (`coerceNumber`)

From `src/config.ts` line ~319:
```ts
function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) return value;
  warnConfig(field, value);
  return fallback;
}
```

The shrink block uses `coerceNumber("shrink.<field>", v, cfg.shrink.<field>, true)` — `true` means mustBePositive (> 0).

### Runtime reset pattern

```ts
beforeEach(() => clearAll());
afterEach(() => clearAll());
```
`clearAll()` from `src/runtime.js` resets the shared module-scoped runtime map (nextSeq mutates it).

## Already-done items (NO tasks created)

- **Change 5** (threshold `{read:24576}`): `config.ts` line 146 (`bloatThresholdBytesByTool: { read: 24576 }`) — DONE
- **Change 4 behavior** (rewind note `display:true`): `markers.ts` line ~378 — DONE (only the comment needs alignment, M2.T2)

## Acceptance gate

All existing tests must stay green. The only intentional assertion changes are:
1. Nudge-text snapshot/string assertions (M4.T1/T2)
2. Shrink-result-text assertion (M2.T1.S3)
3. New tests added for M1, M2, M3

No new model request. No tool throws on the hot path (E13).