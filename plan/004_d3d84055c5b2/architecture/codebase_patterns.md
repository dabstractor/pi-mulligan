# Codebase Patterns (grounded research) — Delta P4

All file/line references verified against HEAD `0bcaa814`.

## 1. config.ts — how to add a knob (P4.M1.T1)

### Existing rewind interface + defaults
- `MulliganConfig.rewind` interface: `src/config.ts` lines 30–46 (fields: `enabled`,
  `protectedRoles`, `maxDepth`, `requireMutationWarning`).
- `DEFAULT_CONFIG.rewind`: lines 115–120 (object literal — `maxDepth: 5`).
- `validateConfig` rewind block: lines 217–226. Pattern:
  ```ts
  const rewindRaw = safeGet(raw, "rewind");
  if (isRecord(rewindRaw)) {
    v = safeGet(rewindRaw, "maxDepth");
    if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);
    // ...
  }
  ```

### The `coerceNumber` helper (line 319)
```ts
function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) return value;
  warnConfig(field, value);
  return fallback;
}
```
- `maxRetriesPerPrompt` should use `coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true)`
  (mustBePositive=true → `> 0`), THEN `Math.floor` to integer ≥ 1. If the floored result is `< 1`,
  fall back to default + warn.
- **`abortContextFraction` CANNOT use `coerceNumber`** — it needs an UPPER bound `(0,1]` which
  `coerceNumber` does not enforce. Use the **inline pattern** from `highWaterFraction` (lines 256–260),
  adapted from `(0,1)` to `(0,1]`:
  ```ts
  v = safeGet(rewindRaw, "abortContextFraction");
  if (v !== undefined) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) cfg.rewind.abortContextFraction = v;
    else warnConfig("rewind.abortContextFraction", v);
  }
  ```
  NOTE: `highWaterFraction` uses `v < 1` (open interval (0,1)); `abortContextFraction` spec says `(0,1]`
  → use `v <= 1`. This is the single critical difference.

### Helpers available (module-local, lines 285–350)
- `safeGet(obj, key)` → reads a property without throwing (Proxy-safe); `undefined` on absent/throw.
- `warnConfig(field, value)` → `console.warn("[mulligan] config: invalid ...")`, never throws.
- `isRecord(value)` → plain-object guard.
- The whole `validateConfig` body is wrapped in ONE try/catch → `structuredClone(DEFAULT_CONFIG)`
  on any unexpected failure (never throws, line 281).

## 2. tools/rewind.ts — how to add a guard (P4.M1.T2)

### The `refusal` helper (line 171)
```ts
function refusal(reason: string, granularity: Granularity): AgentToolResult<RewindDetails> {
  return { content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }], details: { granularity } };
}
```
Every refusal returns `{ content, details }`. The "Mulligan: refused — <reason>." prefix is added
by this helper — callers pass the reason WITHOUT the prefix and WITHOUT the trailing period.

### `countRewindMarkers(ctx)` — the defensive entry-scan MODEL (lines 210–230)
```ts
function countRewindMarkers(ctx: ExtensionContext): number {
  let count = 0; let entries: unknown;
  try { entries = ctx.sessionManager.getEntries(); } catch { return 0; }
  if (!Array.isArray(entries)) return 0;
  for (const e of entries) {
    if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
    try {
      if ((e as {type?:unknown}).type === "custom" && (e as {customType?:unknown}).customType === "mulligan:rewind") count++;
    } catch { /* skip throwing-Proxy entry */ }
  }
  return count;
}
```
**`countRetriesAtLatestPrompt` (new) must mirror this structure exactly** — try/catch around
`getEntries()`, `Array.isArray` guard, per-entry try/catch, return 0 on any failure.

### The insertion point — step 4 (lines 391–399)
The new guards go AFTER the existing `maxDepth` guard and BEFORE step 5 (`resolvePreview`):
```ts
    // (4) depth guard (step 4; E4) ...
    const depth = countRewindMarkers(ctx);
    if (depth >= config.rewind.maxDepth) { return refusal(`max rewind depth (...) reached ...`, granularity); }

    // ⟵ NEW: (4b) per-prompt retry budget (E22)
    // ⟵ NEW: (4c) context-fraction stop (E22)

    // (5) read-only ledger + K preview ...
```
All three guards apply INDEPENDENTLY (first refusal wins; order is not load-bearing).
**IMPORTANT:** the PRD specifies the retry-budget guard runs before the context-fraction guard,
but both are plain `return refusal(...)` — whichever hits first wins.

### The whole execute body is in ONE try/catch (line 349 → 449)
```ts
  try { ...all steps... } catch (e) {
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, granularity);
  }
```
So a helper that throws is caught and becomes a refusal — BUT the spec (E13) and the PRD (risk #1)
require the NEW helpers themselves to be defensive (return 0 / skip-guard), NOT to rely on this
outer catch for their normal failure modes.

### Reading the config + runtime inside the tool
- `getConfig()` is called once at step 1 (line 368) → `config.rewind.maxRetriesPerPrompt`,
  `config.rewind.abortContextFraction`.
- The session id: `ctx.sessionManager.getSessionId()` (used in audit; rewind does not currently
  read it but can). `getRuntime(sessionId)` → `rt` (for `rt.lastFiltered`, `rt.rewindRefusedTurnIndex`).

## 3. tools/audit.ts — the filtered-total computation to SHARE (P4.M1.T2.S2)

### `auditExecute` step 1–2 (lines 496–524)
```ts
const rt = getRuntime(sessionId);
let filtered; let source;
if (Array.isArray(rt.lastFiltered)) {           // PRIMARY: cached filtered view
  filtered = rt.lastFiltered;  source = "cached";
} else {                                        // E16 fallback: rebuild + re-run pipeline
  const entries = ctx.sessionManager.buildContextEntries();
  const base = entriesToMessages(entries);
  const branch = ctx.sessionManager.getBranch();
  filtered = filterPipeline(base, readMarkers(ctx), config, branch);
  source = "fallback";
}
type TokenMessages = Parameters<typeof estimateTokens>[0];
const totalTokens = estimateTokens(filtered as unknown as TokenMessages).tokens;
```
- **`estimateTokens`** is imported from `../tokens.js` and is defensive (never throws).
- **`rt.lastFiltered`** is the filter's cached output (written by `contextHandler` each fire).
  It is the PREVIOUS fire's view mid-turn (stale estimate — acceptable; the guard errs toward
  firing later / under-counting, the safe direction).
- **window size:** `ctx.getContextUsage()?.contextWindow ?? 0` (filter.ts line 326 pattern). D5
  forbids `.tokens` only; `.contextWindow` is the SIZE and is permitted.

### The shared helper to extract: `computeFilteredTotal(ctx): { totalTokens, windowTokens }`
- Extract this exact computation so audit and rewind do not diverge.
- `totalTokens` = `estimateTokens(filtered).tokens` where `filtered` = `rt.lastFiltered` (preferred)
  else `buildContextEntries()` → (rewind does NOT re-run filterPipeline — keep it cheap; the PRD
  says the fallback can be `buildContextEntries()` → `estimateTokens` WITHOUT re-running the
  pipeline, OR re-use the same fallback. The simplest correct option matching audit: prefer
  `rt.lastFiltered`, else `buildContextEntries()` → `estimateTokens`. Do NOT call filterPipeline
  in the rewind tool — it's on the hot path and the spec only requires the same *estimate*.)
- `windowTokens` = `ctx.getContextUsage()?.contextWindow ?? 0`.
- **Wrap the whole thing in try/catch → on any failure, return a sentinel that makes the guard
  SKIP (fail-open).** Recommended: return `{ totalTokens: 0, windowTokens: 0 }` and guard on
  `windowTokens > 0` (a 0 window → skip the guard).

### Refactoring audit to call it (low-risk, optional per PRD)
audit.ts can be refactored so its step 1–2 calls `computeFilteredTotal(ctx)`. Same numbers;
keeps the two consumers from diverging. The audit still needs `filtered` (the array) for the
per-message breakdown, so `computeFilteredTotal` returns only the totals — the audit keeps its
own `filtered` resolution OR `computeFilteredTotal` also returns `filtered`. DESIGN CHOICE for
the implementer: simplest is a helper returning `{ filtered, totalTokens, windowTokens }`.

## 4. nudges.ts — the bloatHit demotion (P4.M2.T1)

### `shouldNudge` (lines 316–323)
```ts
export function shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean {
  const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);
  const deltas = window.map((m) => m.deltaTokens).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (deltas.length === 0) return window.some((m) => m.bloatHit === true);  // KEEP — no-delta fallback
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);  // ⟵ REMOVE the || arm
}
```
**The single change:** line 323 → `return avg > config.nudges.driftThresholdTokens;`
The `deltas.length === 0` fallback (line 321) is UNCHANGED.

### JSDoc update (lines 271–315)
Update the function JSDoc: "delta-only when delta data exists; bloatHit is a no-delta fallback only."
The big algorithm block (lines 280–290) currently says "Bloat is INDEPENDENT of the windowed
delta: if ANY window metric has bloatHit === true, the nudge fires regardless" — this is now
FALSE for the delta-available path. Rewrite to match spec/07 §5.1 (delta-only when delta exists).

## 5. runtime.ts — the `rewindRefusedTurnIndex` model (P4.M1.T2.S3)

### `SessionRuntime` interface (lines 59–90) + `freshRuntime` (lines 110–119)
Existing in-memory fields: `sessionId, seq, tokenBaseline, lastTurnIndex, lastFiltered,
lastFilterTs, pendingBloatHits, shrinkMissCounts, aboveHighWater`.
- `aboveHighWater: boolean` (lines 85–89) is the EXACT model for a new `rewindRefusedTurnIndex: number | null`:
  - added to the interface + `freshRuntime` (default `null`).
  - auto-reset by `resetRuntime` (session_start) and `clearAll` (shutdown) — these already wipe
    the whole entry, so adding a field is automatic.
- `lastTurnIndex` (line 69) is the turn-index source for comparing in `filter.ts`.

### `resetRuntime` (line 160) + `clearAll` (line 168)
Both delete the runtime entry → adding a field needs NO change to these (they wipe the map entry).
Just add the field to the interface + `freshRuntime`.

## 6. filter.ts — the drift-nudge suppression gate (P4.M1.T2.S3)

### The drift-nudge block (lines 290–305)
```ts
if (
  config.nudges.perTurnDrift &&
  markers.recentMetrics && markers.recentMetrics.length > 0 &&
  shouldNudge(markers.recentMetrics, config) &&
  markers.metric && !suppressCheck(markers.metric, markers)
) {
  messages = injectNudge(messages, markers.metric);
}
```
**The T2.S3 gate:** add a conjunct that suppresses when `rt.rewindRefusedTurnIndex === latestMetricTurnIndex`.
`markers.metric.turnIndex` is the latest metric's turn index. When a rewind was refused THIS turn,
`rt.rewindRefusedTurnIndex` was set to that turn index → skip injection. Clear it when the turn
advances (the next `contextHandler` fire sees a different `markers.metric.turnIndex`).

### Setting the flag in rewind.ts
Every `refusal(...)` path in `rewindExecute` sets `rt.rewindRefusedTurnIndex = <currentTurnIndex>`.
The current turn index: `markers.metric.turnIndex` from the latest `mulligan:turn-metric` on the
branch (read via `readMarkers(ctx).metric?.turnIndex`), or `rt.lastTurnIndex` as fallback.

## 7. Test patterns (grounded)

### `test/tools/rewind.test.ts` — fakes (lines 58–138)
- `makePi(opts)` → captures `appendEntry`/`sendMessage`/`setLabel` into `appended`/`sent`/`labels` arrays.
- `makeCtx(opts)` → scripts `sessionId`, `leafId`, `entries` (getEntries), `branch` (getBranch),
  `contextEntries` (buildContextEntries), plus `throwOn*` flags. **Does NOT currently script
  `getContextUsage`** — T3.S1 test (e) must ADD a `contextUsage` opt to `makeCtx` so the
  context-fraction guard can read `.contextWindow`.
- Each test: `const { appended, sent, pi } = makePi(); const { ctx } = makeCtx({ entries: [...] });`
  then `const res = await tool.execute("call-1", params, undefined, undefined, ctx);`
- Reset config cache: `setConfig(...)` before each test (the cache poisoning guard, line 39).

### `test/config.test.ts` — validation cases (lines 47+)
- `validateConfig({ rewind: { ... } })` returns a config; assert `.rewind.maxRetriesPerPrompt` etc.
- Invalid-present → default + warn pattern: `validateConfig({ rewind: { abortContextFraction: 1.5 } })`
  → `.rewind.abortContextFraction === 0.9`.

### `test/drift_nudge.test.ts` — the `m()` helper + stale assertion (lines 67–98)
```ts
const m = (deltaTokens, bloatHit = false, seq = 1) => ({ schema:"pi-mulligan", v:1, kind:"turn-metric",
  seq, ts:seq, deltaTokens, bloatHit, bloatHits:[], grewOverThreshold:false, turnIndex:seq });
const cfg = (windowTurns = 3, threshold = 6000) => ({ nudges:{ driftWindowTurns:windowTurns, driftThresholdTokens:threshold } });
```
**The stale assertion to FLIP (lines 90–92):**
```ts
it("fires on bloatHit even when the windowed average is below threshold", () => {
  expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);   // ⟵ FLIP to .toBe(false)
});
```
The no-delta fallback assertion (lines 86–88) `shouldNudge([m(null, true, 1)], cfg())` → `true`
ALREADY PASSES and must stay green. Also scan `test/filter.test.ts` (~line 919 comment
"or any window bloatHit") and `test/nudges.test.ts` for any other stale bloat-armed assertion.

## 8. README.md — Mode B locations (P4.M3)

- **Config table:** rows 81–85. Add two rows AFTER `rewind.maxDepth` (line 84), BEFORE
  `rewind.requireMutationWarning` (line 85) — OR after requireMutationWarning; either keeps the
  rewind block contiguous. The JSON knob order in spec/09 is maxDepth, maxRetriesPerPrompt,
  abortContextFraction, requireMutationWarning — match that order.
- **JSON example:** line 111 `"rewind": { "maxDepth": 5 }` → add the two knobs.
- **Feature blurb:** line 242 (the E15 / "Markers accumulate" note) or nearby — add one sentence
  on the two hard backstops pointing to `spec/08-edge-cases.md` E22.