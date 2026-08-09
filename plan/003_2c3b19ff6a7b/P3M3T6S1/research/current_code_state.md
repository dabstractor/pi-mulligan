# Research Note — P3.M3.T6.S1 (Wire windowed drift + high-water into contextHandler)

Verified current codebase state (read directly from `src/`). This note grounds the PRP.

## 1. Sibling helpers are ALREADY LANDED (treat as hard contract)

`src/nudges.ts` ALREADY exports (verified by reading the file):
- `shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean` — **windowed moving-average**
  (P3.M3.T4.S1 COMPLETE). Body: `window = recentMetrics.slice(0, driftWindowTurns)`;
  `deltas = window.map(m=>m.deltaTokens).filter(number&finite)`; if empty → `window.some(bloatHit===true)`;
  else `avg = mean(deltas)`; return `avg > driftThresholdTokens || window.some(bloatHit===true)`.
- `shouldHighWater(totalFilteredTokens, windowTokens, rt: SessionRuntime, config): boolean` — edge-triggered
  latch (P3.M3.T5.S1). `windowTokens<=0 → false (no rt mutation)`; `fraction=total/window`;
  `fraction>=highWaterFraction` → latch-first-cross fire; else clear latch + false.
- `renderHighWaterNudge(totalFilteredTokens, windowTokens): string` — pure, never-throws.
- `injectHighWaterNudge(messages: MessageLike[], totalFilteredTokens, windowTokens): MessageLike[]` — pure,
  appends `{role:"custom", customType:"mulligan:high-water", content, display:false, details:{ephemeral,totalFilteredTokens,windowTokens}, timestamp}`.

⇒ My task ADDS them to the `from "./nudges.js"` import in filter.ts + CALLS them. No nudges.ts edit.

## 2. Current contextHandler drift-nudge block (the EXACT text to REPLACE)

`src/filter.ts` lines ~165–173 (inside the `try{}` of `contextHandler`, AFTER `filterPipeline`, BEFORE
`rt.lastFiltered = messages`):

```ts
    if (
      config.nudges.perTurnDrift &&
      markers.metric &&
      shouldNudge(markers.recentMetrics, config) &&
      !suppressCheck(markers.metric, markers)
    ) {
      messages = injectNudge(messages, markers.metric);
    }
```

The contract requires the guard tightened to (adds `markers.recentMetrics && markers.recentMetrics.length > 0`,
moves `markers.metric` AFTER `shouldNudge` so the window gate runs first — short-circuit-safe because the new
length>0 guard precedes shouldNudge):

```
config.nudges.perTurnDrift
  && markers.recentMetrics
  && markers.recentMetrics.length > 0
  && shouldNudge(markers.recentMetrics, config)
  && markers.metric
  && !suppressCheck(markers.metric, markers)
```

`markers.recentMetrics` is ALWAYS a present array (MarkersBundle interface; readMarkers returns `[]` on every
fail-open path). `markers.metric === markers.recentMetrics[0] ?? null`. So tightening is belt-and-suspenders but
matches the contract exactly.

## 3. Placement of the NEW high-water block

Contract: "After the drift nudge block, add the high-water check." Insert IMMEDIATELY after the drift-nudge
if-block, BEFORE `rt.lastFiltered = messages`. Consequence: `rt.lastFiltered` (mulligan_audit cache +
turnEndMetricHandler baseline) will include the high-water nudge if it fires (~30 tokens — negligible, and
CONSISTENT with how the drift nudge is already cached post-injection). totalFilteredTokens is computed from
`messages` AFTER the drift nudge but BEFORE the high-water nudge ("post-filterPipeline + post-nudge" per
contract) — correct (the nudge itself must not push the total over the threshold).

## 4. estimateTokens mechanics (for crafting known token totals in tests)

`src/tokens.ts`: `estimateTokens(messages) = Math.ceil(totalChars / CHARS_PER_TOKEN)` where CHARS_PER_TOKEN = 4.
A message's char length = sum of string content lengths. ⇒ To hit T tokens, craft a message whose content string
is `4*T` chars (e.g. `"x".repeat(2800)` → ceil(2800/4) = 700 tokens). NEVER throws on malformed input.

`filter.ts` ALREADY imports `estimateTokens` (line 48: `import { estimateTokens } from "./tokens.js";`) and uses
a `type TokenMessages = Parameters<typeof estimateTokens>[0];` cast pattern in the observability log — REUSE that
exact cast in the high-water block (estimateTokens defines its OWN narrower MessageLike; the cast through
`unknown` is established + type-safe).

## 5. getContextUsage — present on ExtensionContext; absent on the test fake

External_deps.md (verified from Pi's `extensions/types.d.ts`): `ctx.getContextUsage(): ContextUsage | undefined`
where `ContextUsage { tokens: number|null; contextWindow: number; percent: number|null }`.

The test fake `makeCtx()` (test/filter.test.ts) builds a minimal `{ sessionManager: {...} }` — it does NOT define
`getContextUsage`. ⇒ In filter.ts use `ctx.getContextUsage?.()` (optional chaining): on the real ctx the method
exists (called normally); on the fake it is `undefined` → `?.` short-circuits → `undefined?.contextWindow ?? 0`
→ `0` → `shouldHighWater(_, 0, …)` → `false`. **This keeps ALL existing tests green with ZERO changes to
makeCtx.** New high-water tests ADD an optional `getContextUsage` override to makeCtx (default absent).

D5 (NEVER use getContextUsage().tokens for the total): the high-water TOTAL is the FILTERED view
(`estimateTokens(messages).tokens`), exactly like mulligan_audit. getContextUsage().tokens counts HIDDEN/rewound
tokens. windowTokens (the denominator) DOES come from getContextUsage().contextWindow — that is correct (it is the
model's window SIZE, not a token count of active content).

## 6. Test patterns (test/filter.test.ts)

- `vi.mock("../src/transforms.js", …)` replaces filterPipeline + resolvePinnedShrink + stableSortBySeq.
  `pipelineReturn` controls filterPipeline's output array. `pipelineCalls` captures calls.
- `makeCtx({ sessionId, entries, branch, throwOnGetEntries, ... })` — fake ExtensionContext (sessionManager only).
- `makePi()` — fake ExtensionAPI capturing `.on` + `.appendEntry`.
- `setConfig({...})` / restore default; `clearAll()` in beforeEach/afterEach.
- Builder helpers: `rewindData(seq,id)`, `shrinkData(seq,id)`, `metricData(seq, grew=false, bloat=false)` →
  metricData(true) sets deltaTokens=7000 (fires moving-avg>6000); metricData(false) → deltaTokens=100 (no fire).
  `customEntry(customType, data)` → a `{type:"custom", ...}` SessionEntry.
- Existing drift-nudge test pattern: `pipelineReturn = [{role:"user",content:"P"}]`; assert `result.messages`
  length + last element `customType`. The default makeCtx (no getContextUsage) ⇒ high-water never fires in these
  existing tests ⇒ they stay length 2 (drift nudge only) — UNCHANGED.
- For high-water tests: set pipelineReturn to a message with a KNOWN content length to control
  totalFilteredTokens, and extend makeCtx with a `getContextUsage` opt returning `{tokens:.., contextWindow:..,
  percent:..}` or undefined. Assert the mulligan:high-water customType + rt.aboveHighWater transitions across
  sequential fires (the edge-trigger lifecycle needs ONE session id across fires because the latch lives in rt).

## 7. PREREQUISITES already complete (verified)
- P3.M3.T1.S1 (config: `driftWindowTurns`=3, `highWaterFraction`=0.7, `driftThresholdTokens`=6000) — COMPLETE.
- P3.M3.T2.S1 (runtime: `SessionRuntime.aboveHighWater: boolean`) — COMPLETE.
- P3.M3.T3.S1 (readMarkers: `recentMetrics: TurnMetric[]` newest-first) — COMPLETE.
- P3.M3.T4.S1 (shouldNudge windowed) — COMPLETE.
- P3.M3.T5.S1 (shouldHighWater + renderHighWaterNudge + injectHighWaterNudge) — landed in nudges.ts (verify import
  resolves; the helpers are exported).