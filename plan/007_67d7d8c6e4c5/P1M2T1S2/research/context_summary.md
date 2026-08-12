# P1.M2.T1.S2 Research — nudges.ts turnEndMetricHandler: use estimateAgentTokens (D10)

## Scope (one sentence)
In `src/nudges.ts` `turnEndMetricHandler`, switch the per-turn `now` token count from the TOTAL
`estimateTokens(rt.lastFiltered).tokens` to the AGENT-ATTRIBUTABLE `estimateAgentTokens(rt.lastFiltered)`
(so a large user paste does not inflate the drift delta — D10). One-file, ~3-edit surgical change.

## The S1 CONTRACT (what S2 consumes)
S1 (P1.M2.T1.S1) adds to `src/tokens.ts`, after `estimateTokens` (line ~126):
```ts
export function estimateAgentTokens(messages: MessageLike[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    if (readOwn(msg, "role") !== "user") total += estimateTokens([msg]).tokens;
  }
  return total;
}
```
- Pure, 0-import (uses module-private `readOwn`). D10: user prompts EXCLUDED (ground-truth, never bloat).
- S1 edits ONLY src/tokens.ts. Does NOT touch nudges.ts (S2's job) or tests (S3's job).
- **S1 NOT yet landed** (grep: only `estimateTokens` exported at tokens.ts:114). S2 REQUIRES S1 applied, else
  the `estimateAgentTokens` import fails tsc and the call is undefined at runtime.

## The EXACT current state of nudges.ts (verified by grep + read, lines 218–247)
- **Import (line 42):** `import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";`
- **`now` computation (lines 218–225)** — comment block + the ternary:
  ```ts
      // (4) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw
      //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet
      //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),
      //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).
      const now = rt.lastFiltered
        ? estimateTokens(rt.lastFiltered).tokens
        : (ctx.getContextUsage()?.tokens ?? 0);
  ```
- **Line 247:** `rt.tokenBaseline = now;` (rolls baseline forward — unchanged CODE; semantics now agent-attributable).

## CRITICAL: `estimateTokens` becomes UNUSED in nudges.ts after S2 — replace it in the import
- grep `estimateTokens\(` in nudges.ts → ONLY line 224 is real CODE (440/447 are JSDoc comments in
  shouldHighWater, which takes `totalFilteredTokens` as a PARAM and never calls estimateTokens itself).
- After S2 swaps line 224 → `estimateAgentTokens`, `estimateTokens` has ZERO code usages in nudges.ts.
- tsconfig has `strict:true` but **NO `noUnusedLocals`** → a leftover import won't fail tsc, but it is dead
  code / lint smell. **Cleanest one-pass action: REPLACE `estimateTokens` with `estimateAgentTokens` in the
  import** → `import { resultBytes, approxTokens, estimateAgentTokens } from "./tokens.js";`
  (Adding both and leaving estimateTokens dead is also tsc-safe but not clean — prefer the replace.)

## The 3 edits (all in src/nudges.ts)
1. **Import (L42):** `estimateTokens` → `estimateAgentTokens` (replace; estimateTokens is now unused in code).
2. **`now` (L224):** `estimateTokens(rt.lastFiltered).tokens` → `estimateAgentTokens(rt.lastFiltered)`.
   The `: (ctx.getContextUsage()?.tokens ?? 0)` fallback STAYS (contract + arch §Change 4: "Keep unchanged").
   The ternary structure STAYS (only the truthy-branch expression changes).
3. **Comment block (L218–222):** rewrite to cite D10 (agent-attributable; user prompts excluded as
   ground-truth; fallback counts raw session, acceptable pre-baseline). Reference estimateAgentTokens.

## What STAYS UNCHANGED (do NOT touch)
- `rt.tokenBaseline = now;` (L247) — same code; now stores an agent-attributable baseline (correct: next delta
  is agent-attributable too — apples-to-apples).
- The `ctx.getContextUsage()?.tokens ?? 0` fallback — it counts the RAW session (includes user), acceptable as a
  pre-baseline fallback ONLY on the no-filtered-view path (first turn / context never fired); the no-delta path
  is unaffected (delta is null on first turn anyway).
- `shouldHighWater` (~L400+) and its caller `contextHandler` — the high-water signal measures TOTAL filtered
  context (unchanged). D10 cleanly separates "agent should shed" (delta) from "window is full" (high-water total).
- Everything else in nudges.ts (bloatReminderHandler, shouldNudge, injectNudge, suppressCheck, etc.).

## Cross-item dependencies
- **S2 → S1 (hard):** S2 imports `estimateAgentTokens`, which S1 exports. Without S1: tsc error (not exported)
  + runtime undefined. Assume S1 applied (parallel_execution_context). Files disjoint (S1=tokens.ts; S2=nudges.ts).
- **S2 → S3 (tests):** S3 owns NEW agent-attributable-delta tests. S2 is the CODE change. Existing
  turnEndMetricHandler tests that PIN a numeric deltaTokens with USER messages in the fixture WILL change value
  after S2 (user contributions now excluded) — see PRP's test-impact note. Keeping the existing suite green by
  adjusting now-stale deltaTokens assertions is S2's (mirrors the "fix what you break" rule); NEW D10 coverage is S3.

## Baseline (verified live, pre-S1)
- `src/tokens.ts`: only `estimateTokens` exported (L114). `estimateAgentTokens` absent → S1 not yet landed.
- `src/nudges.ts`: `now` uses `estimateTokens(rt.lastFiltered).tokens` (L224). Pre-D10 (total, includes user).