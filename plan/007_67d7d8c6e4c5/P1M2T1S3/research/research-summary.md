# P1.M2.T1.S3 — Research Summary

## Item
Tests for agent-attributable drift delta (D10). Test-only. Consumes S1 (estimateAgentTokens, COMPLETE)
+ S2 (turnEndMetricHandler `now` swap, IMPLEMENTING in parallel).

## Verified current state (read directly from repo @ HEAD)

### src/tokens.ts — S1 COMPLETE ✅
`estimateAgentTokens` at lines 142-150, EXACT body:
```ts
export function estimateAgentTokens(messages: MessageLike[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;          // non-array / null / undefined → 0
  let total = 0;
  for (const msg of messages) {
    if (readOwn(msg, "role") !== "user") total += estimateTokens([msg]).tokens;  // missing role → COUNTED
  }
  return total;
}
```
- Pure, 0-import (reuses module-private readOwn + estimateTokens). NEVER throws.
- Per-message: `role !== "user"` → counted; a message with NO role is counted ("when in doubt, attribute to agent").
- Each message ceiling-rounded independently (estimateTokens GOTCHA #5).
- `estimateTokens(msgs).tokens = ceil(totalChars/4)`; `CHARS_PER_TOKEN = 4`.
  - "x".repeat(200000) → 50000 tokens (if counted); "x".repeat(2000) → 500 tokens; "abcd" → 1.

### src/nudges.ts — S2 NOT YET LANDED (mid-flight) ⏳
- L42: still `import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";`
- L223-225: `now` STILL `estimateTokens(rt.lastFiltered).tokens` (S2 will swap → `estimateAgentTokens(rt.lastFiltered)`).
- `turnEndMetricHandler(pi, event, ctx)` at L196; delta at L228 (`rt.tokenBaseline == null ? null : now - rt.tokenBaseline`);
  baseline roll `rt.tokenBaseline = now;` at L247.
- `shouldNudge(recentMetrics: TurnMetric[], config: MulliganConfig): boolean` at L321: window = `recentMetrics.slice(0, config.nudges.driftWindowTurns)` (NEWEST-FIRST); firing = `avg(window finite deltaTokens) >= config.nudges.driftThresholdTokens` (delta-only when delta data exists; bloatHit only as no-delta fallback).
- PRP treats S2's contract as target state (now = estimateAgentTokens).

### test/tokens.test.ts — unit-test file, NO beforeEach (no module-scoped state)
- Imports from "../src/tokens.js": estimateTokens, CHARS_PER_TOKEN, resultBytes, approxTokens, type MessageLike, ...
  *** S3 ADDS `estimateAgentTokens` to this import list.
- Style: `describe("estimateTokens — spec/10 §1.7 contract (...)", () => { it("...", ...) })`; MessageLiteral fixtures;
  exact ceil(chars/4) assertions; defensive-never-throws discipline.
- S3 SCOPE: ADD a new describe block "estimateAgentTokens — D10 agent-attributable (...)". Do NOT touch existing blocks.

### test/turn_metric.test.ts — beforeEach+afterEach: clearAll() + setConfig(structuredClone(DEFAULT_CONFIG))
- Fakes (hand-rolled, no vi.fn): makePi({throwOnAppend?})→{handlers,appended,pi}; makeCtx({sessionId?,tokens?,hasUsage?,...})→{ctx}
  (getContextUsage() returns {tokens:opts.tokens??0,contextWindow:200000}); makeEvent(turnIndex)→TurnEndEvent.
- **msgOfChars(chars) → { role:"user", content:"x".repeat(chars) }** ← USER message. ⚠️ After S2, existing deltaTokens
  assertions using msgOfChars BREAK (user excluded → now=0). **S2 owns updating those** (S2 Test-impact note). S3 ADDS ONE
  new D10 test with a MIXED user+assistant fixture; S3 does NOT touch existing assertions.
- Delta idiom: `const rt=getRuntime("s1"); rt.tokenBaseline=…; rt.lastFiltered=[…]; turnEndMetricHandler(pi,makeEvent(n),ctx);
  const data=appended[0].data; expect(data.deltaTokens).toBe(…); expect(rt.tokenBaseline).toBe(…);`

### test/drift_nudge.test.ts — PURE function file, NO beforeEach/clearAll/setConfig/Pi fakes
- Imports shouldNudge (etc.) from "../src/nudges.js"; MessageLike from transforms.js; TurnMetric from markers.js; MulliganConfig from config.js.
  *** S3 ADDS `import { estimateAgentTokens } from "../src/tokens.js";` (additive).
- Helpers: metric(opts)→TurnMetric; m(deltaTokens, bloatHit=false, seq=1)→TurnMetric; cfg(windowTurns=3, threshold=6000)→partial MulliganConfig.
- shouldNudge NEWEST-FIRST; delta-only firing.
- S3 SCOPE: ADD ONE it() (F-drift-userexempt-shaped). Uses m()+cfg()+estimateAgentTokens. Do NOT touch existing its.

## Token math (load-bearing for exact assertions)
- assistant "x".repeat(2000) → ceil(2000/4) = 500 tokens (COUNTED).
- user "x".repeat(200000) → would be 50000 tokens, EXCLUDED.
- estimateAgentTokens([user 200000, assistant 2000]) = 500 (NOT 50500).
- shouldNudge([m(500),m(500),m(500)], cfg(3,6000)) → avg 500 < 6000 → false.
- shouldNudge([m(50000)], cfg(3,6000)) → avg 50000 >= 6000 → true (the pre-D10 would-have-fired contrast).

## Validation commands (verified in package.json)
- `npm test` → `vitest run` (full suite)
- targeted: `npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts`
- `npm run typecheck` → `tsc --noEmit`

## External research
None needed — vitest patterns + the D10 mechanism are fully demonstrated in-file. No new libraries/APIs.