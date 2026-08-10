# M4 Architecture — Nudge Text Simplification + §5.3 Alignment

## Problem

The `[mulligan]` prefix and the bloat clause in the drift nudge were noise. The bloat clause in particular could surface stale counts (a since-shrunk result still announced as "N bloated result(s)"). Simplifying both render functions removes the noise and closes the stale-count rough edge at the rendering layer.

## Current state (verified)

### `src/notes.ts` — `renderBloatReminder` (line ~278)

**Current signature (3 args):**
```ts
export function renderBloatReminder(
  _toolName: string,
  bytes: number,
  thresholdBytes: number,
): string { ... }
```

**Current text (4-line body, `[mulligan]` prefix, threshold mention, "stays on disk"):**
```
\n---\n[mulligan] This result is ~<KB> KB in your context (threshold <T> KB).
If you don't need the full output going forward, call `mulligan_shrink` with a
summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole
call was a mistake. (The hidden/shrunk content stays on disk for the human.)
```

### `src/notes.ts` — `renderDriftNudge` (line ~322)

**Current text (3 lines, `[mulligan]` prefix, bloat clause in first line):**
```
[mulligan] <first line>.
If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).
Run `mulligan_audit` for a breakdown.
```
Where `<first line>` varies: delta-only, delta+bloat, bloat-only, or fallback.

### `src/nudges.ts` — call site (line 133)

```ts
const reminder = renderBloatReminder(event.toolName, bytes, threshold);
```
The `threshold` arg is passed — needs to be dropped (the threshold still GATES firing at line 130-131, it's just no longer RENDERED).

### `src/nudges.ts` — `suppressCheck` (line ~390)

Already functionally implements spec/07 §5.3: returns `true` (suppress) iff a rewind/shrink marker's `ts` falls in `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`. JSDoc cites spec/07 §2 "Edge cases" but NOT §5.3 explicitly.

## Target design

### M4.T1 — `renderBloatReminder` rewrite

**New signature (2 args, threshold dropped):**
```ts
export function renderBloatReminder(toolName: string, bytes: number): string { ... }
```
Note: `toolName` loses the `_` prefix — it's now `toolName` (still not interpolated in v1 text per spec, but the spec signature names it without underscore).

**New text (single line, no prefix, no threshold, no "stays on disk"):**
```
\n---\nThis result added ~<KB> KB to your context. If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole call was a mistake.
```
~30 tokens (was ~40).

**Call site update** (`nudges.ts:133`):
```ts
// OLD:
const reminder = renderBloatReminder(event.toolName, bytes, threshold);
// NEW:
const reminder = renderBloatReminder(event.toolName, bytes);
```
The `threshold` variable is still computed and used for the GATE (line 130-131: `if (bytes < threshold) return;`), just not passed to the renderer.

### M4.T2 — `renderDriftNudge` rewrite

**New text (no `[mulligan]` prefix, no bloat clause in the delta-available path):**

When `delta != null` (the normal path):
```
Previous turn added ~<delta>k tokens to your context. If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
```
Condensed to ~2 lines (was 3). The bloat clause is GONE from this path.

When `delta == null` (first-turn no-baseline fallback — bloat-aware lead ONLY here):
```
Previous turn produced <N> bloated result(s). If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.
```
The no-delta fallback KEEPS a bloat-aware lead so it still has signal.

**First-line collapse:** the old 4-branch if/else over `(delta != null) × (bloat)` collapses:
- `delta != null` → delta line (NO bloat mention)
- `delta == null && bloat > 0` → bloat-only line (the fallback)
- both empty → totality fallback (unreachable; keep a deterministic string)

### M4.T3 — §5.3 JSDoc + test align

**JSDoc update** (`suppressCheck`, nudges.ts ~line 367):
- Change the citation from "spec/07 §2 Edge cases" to **"spec/07 §5.3"** explicitly.
- Add the §5.3 framing: "hard rule — drift nudge MUST NOT fire for a turn in which the agent already issued a rewind/shrink, regardless of delta or bloatHit".

**Test:** confirm the §5.3 negative test exists: a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn. If the existing `suppressCheck` test already covers this (it keys on marker ts in-window), assert the §5.3 acceptance (a)/(b)/(c) explicitly.

**Do NOT rewrite suppressCheck to be seq-based** unless a test reveals the ts-window mis-fires.

## What stays UNCHANGED

- `bytesToKb`, `kTokens`, `resultWord`, `readDelta`, `readBloatHits` — all reused (module-private helpers).
- The `never-throws` discipline (all renderers are fail-open).
- `injectNudge`, `injectHighWaterNudge` — unchanged (they consume the renderer output).
- The `bloatReminderHandler` gating logic (line 130-131: `if (bytes < threshold) return;`) — the threshold still gates FIRING, it's just not passed to the renderer.
- `renderHighWaterNudge` / `shouldHighWater` — unchanged (not part of this delta).

## Test impact

- `test/notes.test.ts`: snapshot/string assertions for `renderBloatReminder` and `renderDriftNudge` MUST be updated to the new text. These are intentional assertion changes.
- `test/nudges.test.ts`: the call-site change means `renderBloatReminder` is called with 2 args — any mock/spy assertions need updating.
- `test/drift_nudge.test.ts`: the §5.3 test assertions need explicit alignment.
- `test/filter.test.ts`: if it asserts drift nudge suppression behavior, it should already pass (mechanism unchanged).