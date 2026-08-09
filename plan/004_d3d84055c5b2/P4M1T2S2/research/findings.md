# Research findings — P4.M1.T2.S2 (Out-of-band context-fraction stop guard)

All file/line references verified against the working tree (T2.S1 already implemented in-tree).
This is the per-item research notebook for the PRP. Grounded, not speculative.

## 1. config knob is ALREADY shipped (P4.M1.T1.S1 — done)

`src/config.ts`:
- L51: `abortContextFraction: number;` (on `MulliganConfig.rewind`).
- L132: `abortContextFraction: 0.9,` (DEFAULT_CONFIG).
- L244–247: validated inline (NOT via `coerceNumber` — needs the `(0,1]` upper bound):
  ```ts
  v = safeGet(rewindRaw, "abortContextFraction");
  if (v !== undefined) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) cfg.rewind.abortContextFraction = v;
    else warnConfig("rewind.abortContextFraction", v);
  }
  ```
→ The guard reads `config.rewind.abortContextFraction` off the `config` already fetched at `rewindExecute` step 1. **No config work.** No new knob.

## 2. estimateTokens (tokens.ts L114–127) — never throws, defensive

```ts
export function estimateTokens(messages: MessageLike[] | null | undefined, _model?: unknown): TokenEstimate { ... }
```
- Returns `{ tokens, confidence }`; `tokens` is a non-negative int (`Math.ceil(totalChars / CHARS_PER_TOKEN)`).
- NEVER throws (GOTCHA #3; comment L59: "estimation NEVER throws").
- The param-type cast used everywhere in-tree: `type TokenMessages = Parameters<typeof estimateTokens>[0];` then `estimateTokens(x as unknown as TokenMessages).tokens`. audit.ts + filter.ts both use this exact idiom.

## 3. SessionRuntime.lastFiltered + getRuntime (runtime.ts)

- L73: `lastFiltered: AgentMessage[] | null;` — the filter's cached output (written by `filterPipeline`/contextHandler each fire; spec/06 §7).
- L112: `freshRuntime` sets `lastFiltered: null`.
- L128: `export function getRuntime(sessionId: string): SessionRuntime`.
- `ctx.sessionManager.getSessionId()` gives the session id (audit.ts already does `const sessionId = ctx.sessionManager.getSessionId(); const rt = getRuntime(sessionId);`).
- **Staleness:** `rt.lastFiltered` is the PREVIOUS fire's view, read mid-turn from a tool. It predates the current turn's contributions → may UNDER-count the true filtered total. **Accepted** (contract: "the guard errs toward firing LATER/under-counting, the safe direction"). **DO NOT** "fix" by reading `getContextUsage().tokens` — D5 violation (counts hidden/rewound tokens).

## 4. The window-SIZE pattern (filter.ts L311–326) — REFERENCE ONLY, not the shared helper

filter.ts has an EXISTING high-water computation (the drift-nudge edge signal, spec/07 §5.2):
```ts
let totalFilteredTokens = 0; let windowTokens = 0;
try {
  type TokenMessages = Parameters<typeof estimateTokens>[0];
  totalFilteredTokens = estimateTokens(messages as unknown as TokenMessages).tokens;
  const usage = ctx.getContextUsage?.();
  windowTokens = usage?.contextWindow ?? 0;
} catch { /* leave both at 0 → fail-open */ }
```
- This is a **different concern**: it runs per-fire inside `filterPipeline` on the LIVE in-flight `messages` (the context event's working list), NOT on `rt.lastFiltered`. It annotates the drift nudge. **Not directly reusable** as the rewind guard's helper.
- It CONFIRMS the exact pattern the contract specifies: `usage?.contextWindow ?? 0`, the `Parameters<typeof estimateTokens>[0]` cast, the try/catch fail-open. **D5:** `getContextUsage().tokens` is forbidden; `.contextWindow` (the SIZE) is permitted — and filter.ts already uses `.contextWindow`. ✅
- `ExtensionContext.getContextUsage?.()` is optional-chained everywhere in-tree (so a fake ctx without it → `undefined` → `windowTokens 0`). This is the fail-open surface.

## 5. entriesToMessages is module-local in audit.ts → put computeFilteredTotal THERE

- `entriesToMessages(entries: SessionEntry[]): Record<string, unknown>[]` is defined in audit.ts (the "// ── the E16 fallback: entries → messages" block), NOT exported. It is `entries.flatMap(sessionEntryToContextMessages)` defensively (per-entry try/catch).
- **Decision:** put `computeFilteredTotal` in **audit.ts** (it already imports `estimateTokens`, `getRuntime`, and has `entriesToMessages` in scope). Then it reuses `entriesToMessages` WITHOUT exporting it and WITHOUT duplicating the flatMap. Export ONLY `computeFilteredTotal`.
- **No circular import:** rewind.ts will `import { computeFilteredTotal } from "./audit.js";`. audit.ts does NOT import rewind.ts (audit imports: tokens/runtime/config/transforms/filter/nudges/markers). One-way dependency. ✅
- Import uses the `.js` ESM/Bundler convention (in-tree: `"../markers.js"`, `"../tokens.js"`, …).

## 6. The (4b)/(5) anchors in rewind.ts — T2.S1 ALREADY in the tree

- `countRetriesAtLatestPrompt` (the T2.S1 helper) is present (rewind.ts, after `countRewindMarkers`).
- The `(4b)` guard block is present, L453–466:
  ```ts
  // (4b) per-prompt retry budget (step 4; E22 hard backstop #1). ...
  const retries = countRetriesAtLatestPrompt(ctx);
  if (retries >= config.rewind.maxRetriesPerPrompt) {
    return refusal(`hit the per-prompt retry budget (...) ... instead of rewinding again`, granularity);
  }
  ```
- The `(5) read-only ledger + K preview` comment is at L467.
- **The `(4c)` guard inserts BETWEEN the `(4b)` closing `}` (L466) and the `(5)` comment (L467).** This is the exact free spot the T2.S1 PRP left.
- `granularity`, `config`, and `ctx` are ALL in scope at that point (declared at the function top / step 1 / the execute signature). `refusal(reason, granularity)` is the helper to call (adds the `Mulligan: refused — ` prefix + trailing `.`).

## 7. EXISTING tests do NOT break (the proof)

- `test/tools/rewind.test.ts` `makeCtx` (L104+) scripts `sessionId`, `leafId`, `entries` (getEntries), `branch`, `contextEntries` (buildContextEntries), plus `throwOn*` flags. **It does NOT script `getContextUsage`** (grep: zero matches).
- Therefore for EVERY existing rewind test, `ctx.getContextUsage?.()` → `undefined` → `usage?.contextWindow` → `undefined` → `windowTokens = 0` → the `(4c)` guard's `windowTokens > 0` is false → **guard is SKIPPED** → every existing test still succeeds exactly as before.
- This mirrors the T2.S1 "existing tests won't break" proof. The guard is purely additive and fails open.
- **P4.M1.T3.S1 (the test task) MUST add a `contextUsage` opt to `makeCtx`** to exercise the guard (architecture/codebase_patterns.md §7 already notes this). NOT this task's work.

## 8. The OPTIONAL audit refactor — recommend SKIPPING it (fallback-path subtlety)

- The contract says the audit refactor is "optionally ... (low-risk, same numbers)".
- **CAUGHT SUBTLETY:** the fallback paths DIFFER. audit's E16 fallback re-runs `filterPipeline` (accurate, reflects markers); `computeFilteredTotal`'s fallback is the CHEAP `entriesToMessages(entries)` → `estimateTokens` (NO pipeline). So replacing audit's total with `computeFilteredTotal(ctx).totalTokens` would CHANGE audit's E16-fallback numbers (the cached path is identical; the fallback path is not).
- The CACHED path (`rt.lastFiltered` present — the common case) IS identical: `estimateTokens(rt.lastFiltered).tokens`.
- **Recommendation for the PRP:** export `computeFilteredTotal`, use it in rewind's `(4c)` guard, and LEAVE audit's step 1–2 UNCHANGED in this task (zero regression risk; the helper is available for future convergence). The deliberate fallback-path difference (audit=accurate, rewind=cheap) is a design choice, not divergence.

## 9. The fail-open chain (E13)

- `computeFilteredTotal`: ONE try/catch → `{ totalTokens: 0, windowTokens: 0 }` on ANY throw.
- The `(4c)` guard: `if (windowTokens > 0 && totalTokens / windowTokens >= abortContextFraction)` — the `windowTokens > 0` conjunct IS the fail-open (0 window → skip → never block a rewind). Also avoids divide-by-zero.
- `pct = Math.round((totalTokens / windowTokens) * 100)` is computed ONLY inside the refusal branch (the contract: "avoid div display when not refusing").
- The execute body's single outer try/catch (rewindExecute) is the last-resort E13 net; the helper is defensively self-contained (its own try/catch), matching the `countRewindMarkers`/`countRetriesAtLatestPrompt` family.

## 10. refusal() mechanics (rewind.ts L171)

```ts
function refusal(reason: string, granularity: Granularity): AgentToolResult<RewindDetails> {
  return { content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }], details: { granularity } };
}
```
→ Pass the reason with NO trailing period and NO `Mulligan: refused — ` prefix. The contract's reason string ends with `...shrink the largest result` (no period). ✅