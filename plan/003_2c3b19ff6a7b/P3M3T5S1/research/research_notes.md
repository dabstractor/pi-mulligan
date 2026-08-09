# Research Notes — P3.M3.T5.S1: shouldHighWater + renderHighWaterNudge + injectHighWaterNudge

## Task summary (verbatim contract)

Add THREE exported functions to `src/nudges.ts` (spec/07 §5.2 edge-triggered high-water signal):

1. `shouldHighWater(totalFilteredTokens: number, windowTokens: number, rt: SessionRuntime, config: MulliganConfig): boolean`
   — PURE-but-mutates-`rt.aboveHighWater` (edge state). Algorithm (Pattern 9, verified verbatim):
   - `windowTokens <= 0` → return `false` (fail-open; can't compute fraction).
   - `fraction = totalFilteredTokens / windowTokens`.
   - `fraction >= config.nudges.highWaterFraction`: if `!rt.aboveHighWater` → set `rt.aboveHighWater = true`, return `true` (first crossing fires); else return `false` (already above, no re-fire).
   - else (`fraction < threshold`): set `rt.aboveHighWater = false` (cleared on dropping below), return `false`.
2. `renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string` — one-line annotation in
   `renderDriftNudge` style: `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
3. `injectHighWaterNudge(messages: MessageLike[], totalFilteredTokens: number, windowTokens: number): MessageLike[]`
   — mirror `injectNudge`: append ephemeral `mulligan:high-water` CustomMessage. PURE (new array).

## Verified codebase facts (direct read, NOT a subagent summary)

### src/nudges.ts (the file to edit) — 21 KB, ~460 lines
- **Current exports**: `bloatThresholdFor`, `bloatReminderHandler`, `registerBloatReminder`, `turnEndMetricHandler`,
  `registerTurnEndMetric`, `NUDGE_TURN_WINDOW_MS`, `shouldNudge`, `injectNudge`, `suppressCheck`.
- **Imports already present** (NO new import needed EXCEPT the `SessionRuntime` TYPE):
  - `import { getConfig } from "./config.js";`
  - `import type { MulliganConfig } from "./config.js";`
  - `import { getRuntime } from "./runtime.js";`  ← **VALUE only; `SessionRuntime` TYPE NOT imported → ADD `import type { SessionRuntime } from "./runtime.js";`** (the codebase convention is SEPARATE `import type` lines for same-module value+type pairs — see config.js + tokens.js precedent).
  - `import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";`  ← `estimateTokens` ALREADY imported (unused by the nudge funcs today, but imported by turnEndMetricHandler).
  - `import { renderBloatReminder, renderDriftNudge } from "./notes.js";`  ← renderDriftNudge imported.
  - `import { appendTurnMetric, type TurnMetricInput, type TurnMetric, type RewindMarker, type ShrinkMarker } from "./markers.js";`
  - `import type { MessageLike } from "./transforms.js";`  ← MessageLike ALREADY imported.
- **injectNudge verbatim** (the mirror template for injectHighWaterNudge):
  ```ts
  export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[] {
    const line = renderDriftNudge(metric);
    const nudge: MessageLike = {
      role: "custom",
      customType: "mulligan:nudge",
      content: line,
      display: false,
      details: { ephemeral: true, turnIndex: metric.turnIndex },
      timestamp: Date.now(),
    };
    return [...messages, nudge];
  }
  ```
  → for high-water: `customType: "mulligan:high-water"`, `content: renderHighWaterNudge(...)`, `details: { ephemeral: true, totalFilteredTokens, windowTokens }`, same `role/display/timestamp`.
- **shouldNudge currently** = single-metric `(metric, _config) => metric.grewOverThreshold === true || metric.bloatHit === true`. NOTE: the parallel sibling P3.M3.T4.S1 REWRITES this to windowed `(recentMetrics, config)`. Either way, shouldHighWater is INDEPENDENT — it does not touch shouldNudge. No conflict.

### src/notes.ts — renderDriftNudge style reference (VERIFIED verbatim)
- `renderDriftNudge(metric: DriftNudgeInput): string` returns 3 lines joined by `"\n"`:
  - `[mulligan] <first line>.`
  - `If that growth was wasteful, consider \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result).`
  - `Run \`mulligan_audit\` for a breakdown.`
- It is DEFENSIVE — never throws (readOwn + isRecord/Array.isArray guards). The high-water renderer must follow the same discipline.
- `kTokens(delta)` helper exists (delta/1000, 1 decimal) — but high-water uses a PERCENTAGE, not kTokens. Compute `Math.round(fraction * 100)`.
- **High-water format (from the item contract — ONE line, not three)**:
  `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
  `<pct>` = `Math.round((totalFilteredTokens / windowTokens) * 100)`. Guard `windowTokens <= 0` defensively (return a fallback without percentage; shouldHighWater already short-circuits, but the renderer is exported + directly testable).

### src/runtime.ts — SessionRuntime (VERIFIED, P3.M3.T2.S1 COMPLETE)
- `SessionRuntime` interface ALREADY has `aboveHighWater: boolean` with a thorough JSDoc (latch semantics: set true when annotation fires, cleared when total drops below; auto-reset via resetRuntime on session_start + clearAll). Default `false` in `freshRuntime`.
- `getRuntime(sessionId: string): SessionRuntime` returns the LIVE mutable reference (callers mutate fields in place).
- **For shouldHighWater, `rt` is PASSED IN as a parameter** (the contract signature). It does NOT call getRuntime — the caller (contextHandler, P3.M3.T6.S1) already has `rt` in scope. This keeps the function unit-testable with a hand-built rt literal.

### src/config.ts — highWaterFraction (VERIFIED, P3.M3.T1.S1 COMPLETE)
- `MulliganConfig.nudges.highWaterFraction: number` EXISTS with JSDoc: "Fraction of the context window at which the §5.2 high-water annotation fires … Must be in the open interval (0,1). Default: 0.7. Consumed by shouldHighWater (P3.M3.T5) + contextHandler (P3.M3.T6)."
- `DEFAULT_CONFIG.nudges.highWaterFraction = 0.7`. `validateConfig` enforces (0,1), non-finite/non-number → 0.7 default + warn; NOT string-coerced; near-boundary 0.01/0.99 kept. (Verified in test/config.test.ts.)
- → shouldHighWater READS `config.nudges.highWaterFraction`; no config change needed.

### src/tokens.ts — estimateTokens (VERIFIED verbatim)
- `export function estimateTokens(messages: MessageLike[] | null | undefined, _model?: unknown): TokenEstimate` → `{ tokens: number; confidence: TokenConfidence }`. Pure, deterministic, never throws, empty/null → 0.
- **The high-water TOTAL is computed by the CALLER** (contextHandler) via `estimateTokens(messages).tokens` on the FILTERED view (D5 — NOT `getContextUsage().tokens` which counts hidden tokens). shouldHighWater receives `totalFilteredTokens` already computed. injectHighWaterNudge receives it too.
- shouldHighWater/renderHighWaterNudge/injectHighWaterNudge do NOT call estimateTokens (the caller does). So no new tokenization inside the helpers — they are pure arithmetic/composition.

### src/transforms.ts — MessageLike (VERIFIED verbatim)
- `export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown; }`
- Index signature `[key: string]: unknown` → the nudge object literal (role/customType/content/display/details/timestamp) assigns in with NO cast (same as injectNudge). customType is read defensively elsewhere via `readOwn(msg, "customType")`.

### architecture/external_deps.md — ContextUsage (VERIFIED)
- `ContextUsage { tokens: number | null; contextWindow: number; percent: number | null }` (pi dist core/extensions/types.d.ts:193).
- `ctx.getContextUsage(): ContextUsage | undefined`. → **windowTokens** (computed by the caller, P3.M3.T6.S1) = `ctx.getContextUsage()?.contextWindow ?? 0`.
- **D5 critical**: `getContextUsage().tokens` counts HIDDEN tokens. The high-water total MUST be the FILTERED view (`estimateTokens(messages).tokens`), never `getContextUsage().tokens`. The caller enforces this; the helpers receive `totalFilteredTokens` already filtered.

### architecture/implementation_patterns.md — Pattern 9 (VERIFIED verbatim)
```ts
export function shouldHighWater(totalFilteredTokens, windowTokens, rt: SessionRuntime, config: MulliganConfig): boolean {
  if (windowTokens <= 0) return false;
  const fraction = totalFilteredTokens / windowTokens;
  if (fraction >= config.nudges.highWaterFraction) {
    if (!rt.aboveHighWater) { rt.aboveHighWater = true; return true; } // edge-triggered: fire once on crossing
    return false; // already above → don't re-fire
  }
  rt.aboveHighWater = false; // dropped below → clear for next crossing
  return false;
}
```
This matches the item contract EXACTLY. The `windowTokens <= 0` guard is the fail-open (E12: getContextUsage undefined / no model → contextWindow 0).

### test/drift_nudge.test.ts — placement of new tests (VERIFIED)
- Imports: `import { describe, it, expect } from "vitest";` + `import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS } from "../src/nudges.js";` + `import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";` + `import type { MessageLike } from "../src/transforms.js";`
- Helpers: `metric(opts)`, `rewind(seq,ts)`, `shrink(seq,ts)` — partial literals cast to the marker type (pure-test scaffolding).
- → ADD `shouldHighWater, renderHighWaterNudge, injectHighWaterNudge` to the nudges.js import; ADD `import type { SessionRuntime } from "../src/runtime.js";` + `import type { MulliganConfig } from "../src/config.js";`. ADD an `rt()` helper building a minimal SessionRuntime with `aboveHighWater: false` + all other fields defaulted. ADD new `describe` blocks (or one combined) per the contract's mocking scenarios.

### grep — NO existing shouldHighWater/renderHighWaterNudge/injectHighWaterNudge/mulligan:high-water anywhere
- Confirmed: only `highWaterFraction` (config.ts + test/config.test.ts) and `aboveHighWater` (runtime.ts) exist. No implementation collision. Clean greenfield addition.

## External research
**Not required.** This is pure TypeScript arithmetic + string composition + array spread — no external library, no API, no new dependency. The contract + Pattern 9 + the verified codebase interfaces are the complete specification. No URLs to cite.

## Key decisions / gotchas
1. **shouldHighWater is the ONLY impure function** (mutates rt.aboveHighWater). The contract is explicit: "shouldHighWater mutates rt — it is NOT purely functional despite taking simple args; this is intentional (edge-trigger state must live in the session runtime)." renderHighWaterNudge + injectHighWaterNudge are PURE.
2. **Edge-trigger semantics are stateful**: must test the FULL lifecycle (cross → re-fire-blocked → drop-below-clears → re-cross-fires-again) on the SAME rt, in order. This is the contract's mocking point (a)–(d).
3. **fail-open at windowTokens <= 0**: return false WITHOUT mutating rt.aboveHighWater (Pattern 9 returns early before the latch). Decision: leave rt.aboveHighWater UNCHANGED on the fail-open path (Pattern 9's `return false` before any state touch). Document it.
4. **renderHighWaterNudge must never throw** (defensive like renderDriftNudge). Guard windowTokens <= 0 → fallback string without percentage (shouldHighWater prevents this in prod, but the renderer is exported + directly testable).
5. **injectHighWaterNudge is PURE** — returns `[...messages, nudge]`, input NOT mutated (mirror injectNudge).
6. **customType = "mulligan:high-water"** (distinct from "mulligan:nudge" so the drift nudge and high-water nudge are individually detectable/dedup-able by mulligan-aware code via the `customType.startsWith("mulligan:")` check in transforms.ts isMulliganCustom).
7. **No call-site change in THIS task** — contextHandler wiring (computing totalFilteredTokens + windowTokens + calling shouldHighWater/injectHighWaterNudge) is P3.M3.T6.S1. This task exports the helpers only; tests exercise them directly.
8. **No config.ts / runtime.ts / markers.ts change** — knobs + state already exist (COMPLETE P3.M3.T1.S1 + P3.M3.T2.S1).
9. **JSDoc-heavy** — match the existing nudges.ts export style (extensive JSDoc on every export documenting spec citations, algorithm, edge cases, defensive notes).
10. **`>=` not `>`** for the fraction comparison (Pattern 9 + contract: "fraction >= highWaterFraction" fires). At exactly 0.7 of the window, it fires. Document.