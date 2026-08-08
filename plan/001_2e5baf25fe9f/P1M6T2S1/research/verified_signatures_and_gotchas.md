# Verified Signatures & Gotchas — P1.M6.T2.S1 (turn_end metric handler)

Research notes captured live during PRP research. Every signature below is quoted from the actual shipped
source (not the spec pseudocode). The spec/07 §2 pseudocode is a CONTRACT-LEVEL guide, but the codebase API
(`appendTurnMetric` wrapper) diverges from it in three places — each divergence is a GOTCHA below.

---

## 1. The `turn_end` event — VERIFIED (api_verification.md §7.3)

```ts
interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;
  message: AgentMessage;            // the last assistant message
  toolResults: ToolResultMessage[]; // tool results from this turn
}
```
- `TurnEndEvent` IS re-exported at the package root of `@earendil-works/pi-coding-agent` (confirmed:
  `grep "TurnEndEvent" dist/index.d.ts` → it is in the big `export type {...} from "./core/extensions/..."` list).
  Import as `import type { TurnEndEvent } from "@earendil-works/pi-coding-agent";`.
- **turn_end does NOT receive the full message list** (api_verification §7.3 DISCREPANCY NOTE: it has
  `message` + `toolResults` but NOT the full context list). ⟹ we MUST compute the current token count from
  the in-memory cache `rt.lastFiltered` (written by filter.ts each context fire) OR fall back to
  `ctx.getContextUsage()`. The contract's `event.messages` would be `undefined` — do NOT use it.

## 2. `pi.on("turn_end", handler)` — VERIFIED

- `ExtensionAPI.on<E extends keyof Events>(event: E, handler: ExtensionHandler<...>): void` (api_verification §1
  line 49). Returns `void` (NO disposer). `Events` includes `"turn_end"`.
- `ExtensionHandler<E, R> = (event, ctx) => Promise<R | void> | R | void` (P1.M6.T1.S1 PRP). For `turn_end`,
  `R` is `void` — a handler returning `void` is accepted (verified by tsc probe: `pi.on("turn_end", (e,c): void => {})`
  type-checks).
- **GOTCHA — the handler NEEDS `pi`, but the event only hands it `(event, ctx)`.** The handler must call
  `appendTurnMetric(pi, ctx, metric)` (→ `pi.appendEntry`), so it needs a reference to `pi`. The `turn_end`
  callback signature has no `pi` parameter. ⟹ `registerTurnEndMetric(pi)` must create a CLOSURE that captures
  `pi` and delegates to an exported, testable `turnEndMetricHandler(pi, event, ctx)`. (None of the existing
  event handlers — contextHandler, bloatReminderHandler — need `pi`, because they only RETURN a result; this
  is the FIRST handler that writes through `pi`.)

## 3. `appendTurnMetric` — the wrapper that DIVERGES from spec/07 §2 pseudocode (src/markers.ts, SHIPPED)

```ts
export function appendTurnMetric(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: TurnMetricInput,   // = Omit<TurnMetric, "schema"|"v"|"kind"|"seq"|"ts">
): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);                 // <-- wrapper computes seq ITSELF
    const entry: TurnMetric = { ...data, schema: "pi-mulligan", v: 1, kind: "turn-metric", seq, ts: Date.now() };
    pi.appendEntry("mulligan:turn-metric", entry);  // <-- wrapper calls pi.appendEntry
    return ctx.sessionManager.getLeafId();
  } catch { return null; }                          // <-- never throws
}
export type TurnMetricInput = Omit<TurnMetric, "schema" | "v" | "kind" | "seq" | "ts">;
```

- **GOTCHA (CRITICAL) — do NOT call `nextSeq` in the handler; do NOT put `seq`/`ts`/schema/v/kind in the
  metric object.** The contract's LOGIC step 6 builds `{schema, v:1, kind, seq, ts, deltaTokens, ...}` and
  step 7 calls `appendTurnMetric(pi, ctx, metric)` — that mirrors spec/07 §2 which calls
  `pi.appendEntry("mulligan:turn-metric", metric)` DIRECTLY (no wrapper). Our codebase wraps that in
  `appendTurnMetric`, which stamps seq/ts/envelope itself. If the handler (a) called `nextSeq` AND (b) put
  `seq` in the object, then `appendTurnMetric`'s internal `nextSeq` would INCREMENT AGAIN (double-increment,
  wasting seq numbers + breaking "one seq per marker"), and the wrapper would OVERWRITE the handler's seq/ts
  anyway. Correct build = a `TurnMetricInput` with the 5 DATA fields ONLY:
  `{ deltaTokens, bloatHit, bloatHits, grewOverThreshold, turnIndex }`. Pass it to `appendTurnMetric(pi, ctx, input)`.
  (TypeScript excess-property check would ALSO reject an object literal carrying seq/ts — defense-in-depth.)
- `appendTurnMetric` NEVER throws (whole body try/catch → returns null). So the handler's own try/catch is
  belt-and-suspenders (defense-in-depth; the guarantee is that the turn is never broken).
- `appendTurnMetric` calls `ctx.sessionManager.getLeafId()` → the test fake `ctx` must script `getLeafId()`
  (return a string, e.g. "leaf-1"; null is the failure path — acceptable, the metric still persists).

## 4. `estimateTokens(rt.lastFiltered)` — VERIFIED: NO cast needed (unlike filter.ts/audit.ts)

```ts
export function estimateTokens(messages: MessageLike[] | null | undefined, _model?: unknown): TokenEstimate
export interface TokenEstimate { tokens: number; confidence: TokenConfidence; }
// tokens.ts MessageLike: { role?: string; content?: string | ContentBlock[]; [key: string]: unknown }
```
- `rt.lastFiltered` is `AgentMessage[] | null` where `AgentMessage = Record<string, unknown>` (src/runtime.ts
  local opaque alias). `Record<string, unknown>[]` IS structurally assignable to tokens.ts's `MessageLike[]`
  (both have the `[key: string]: unknown` index signature; MessageLike's named props are optional). ⟹
  `estimateTokens(rt.lastFiltered).tokens` type-checks with NO cast. **VERIFIED by an in-project tsc probe**
  (a control broken line errored as expected; `estimateTokens(rt.lastFiltered)` produced zero errors).
- This DIFFERS from filter.ts (lines 234-239) and audit.ts (lines 510-513), which cast `as unknown as
  Parameters<typeof estimateTokens>[0]`. THOSE casts are needed because those call sites pass
  `transforms.ts`'s `MessageLike` (a DIFFERENT interface with richer ContentBlock types) → tokens.ts's
  `MessageLike`. Here we pass the opaque `AgentMessage[]`, which is the looser `Record<string, unknown>[]` and
  is directly assignable. Do NOT add the cast (it would be dead noise); the contract's
  `estimateTokens(rt.lastFiltered).tokens` is correct as-is.

## 5. `ctx.getContextUsage()` — VERIFIED (api_verification §3.1, §3.2)

```ts
getContextUsage(): ContextUsage | undefined;   // on ExtensionContext
interface ContextUsage { tokens: number | null; contextWindow: number; percent: number | null; }
```
- `ctx.getContextUsage()?.tokens ?? 0` type-checks to `number` (verified by tsc probe). `tokens` is
  `number | null`; `?? 0` coerces null/undefined → 0. api_verification §3.2 explicitly endorses this form.
- This is the FALLBACK path: used only when `rt.lastFiltered` is null (first turn / context never fired).
  Design principle #6 (honest bookkeeping) PREFERS the filtered view (`rt.lastFiltered`) over raw
  `getContextUsage()` (which counts hidden tokens) — the contract's ternary `rt.lastFiltered ? estimateTokens(...) : getContextUsage()` encodes that preference correctly.

## 6. SessionRuntime fields used (src/runtime.ts, SHIPPED)

```ts
export function getRuntime(sessionId: string): SessionRuntime;   // MUTABLE ref; never throws
export function clearAll(): void;                                 // tests ONLY
interface SessionRuntime {
  tokenBaseline: number | null;    // READ + WRITE here (baseline delta)
  lastFiltered: AgentMessage[] | null;  // READ (filter's cached output)
  pendingBloatHits: BloatHit[];    // READ (snapshot) + REASSIGN [] (clear)
  lastTurnIndex: number | null;    // WRITE (event.turnIndex)
  ...
}
interface BloatHit { toolName: string; approxTokens: number; }  // == TurnMetric.bloatHits[*] shape
```
- **Snapshot + clear pendingBloatHits**: `const bloat = rt.pendingBloatHits; rt.pendingBloatHits = [];` —
  grab the reference into `bloat` (frozen snapshot for the metric), then REASSIGN `rt.pendingBloatHits` to a
  fresh empty array (NOT splice — reassignment is cleaner and matches spec/07 §2 `rt.pendingBloatHits = [];`).
  The OLD array (held by `bloat`) is what goes into the metric; the field is reset for next turn's bloat hits
  (pushed by `bloatReminderHandler`, P1.M6.T1.S1).
- **Module-scoped map** ⟹ tests MUST `clearAll()` in beforeEach AND afterEach (or a prior test's
  tokenBaseline/pendingBloatHits leaks in). Mirror test/markers.test.ts + test/runtime.test.ts.
- `getRuntime(sessionId)` returns the SAME live object across calls ⟹ the test can `const rt = getRuntime(id);
  rt.tokenBaseline = X;` BEFORE calling the handler, and the handler's internal `getRuntime(id)` sees the same X.

## 7. `getConfig` + `setConfig` (src/config.ts, SHIPPED)

```ts
export function getConfig(): MulliganConfig;       // defensive clone each call; NEVER throws
export function setConfig(raw: unknown): void;     // tests: replace the cached config
// MulliganConfig.nudges.perTurnDrift (default true), .driftThresholdTokens (default 3000), .enabled (default true)
```
- Gate: `if (!config.enabled || !config.nudges.perTurnDrift) return;` — BOTH gates BEFORE measurement (mirror
  bloatReminderHandler's gate order). Test control via `setConfig({...})`.

## 8. `log` (src/log.ts, SHIPPED) — takes `sessionId`, NOT `ctx`

```ts
export function log(level: Level, event: string, sessionId: string, data?: unknown): void;
```
- **GOTCHA — `log` takes `sessionId: string`, NOT `ctx`** (same as bloatReminderHandler GOTCHA #1). The
  catch logs `log("error", "nudge.turn_end", sessionId, { error: String(e) })`. Read `sessionId` FIRST inside
  the try{} (right after the opening brace) so the catch can log it even when getSessionId throws (then
  sessionId stays "").
- `log` is a no-op when no log file is set (default) ⟹ tests don't pollute the filesystem and the fail-open
  path's log call is harmless.

## 9. Module placement: APPEND to src/nudges.ts (created by P1.M6.T1.S1 — PARALLEL item)

- **P1.M6.T1.S1 (the parallel predecessor) CREATES `src/nudges.ts`** with `bloatReminderHandler` +
  `registerBloatReminder`. Its PRP explicitly states "P1.M6.T2.S1 (turn_end metric) + P1.M6.T2.S2
  (shouldNudge/injectNudge) APPEND to this module later." ⟹ **this task APPENDS `turnEndMetricHandler` +
  `registerTurnEndMetric` to `src/nudges.ts`** (do NOT touch bloatReminderHandler / registerBloatReminder).
- The exact pre-state of `src/nudges.ts` (from the P1.M6.T1.S1 PRP "Implementation Patterns" section) is
  reproduced in the PRP's "Scope decision" so the implementer can merge cleanly. The import augmentations
  this task makes: add `TurnEndEvent` to the pi-package type import; add `estimateTokens` to the existing
  `./tokens.js` import (or add a new line); add a NEW `./markers.js` import (`appendTurnMetric` value +
  `TurnMetricInput` type). No circular import (markers.js does not import nudges.js).
- **Tests go in a NEW file `test/turn_metric.test.ts`** (NOT appended to P1.M6.T1.S1's `test/nudges.test.ts`).
  Rationale: P1.M6.T1.S1's `makePi` only captures `.on` (not `appendEntry`) and its `makeCtx` only has
  `getSessionId` (not `getLeafId` / `getContextUsage`) — unusable for this handler's write path. A separate
  file with self-contained fakes is cleaner AND avoids a parallel-edit conflict with `test/nudges.test.ts`.

## 10. Baseline roll-forward ordering

- Step 8 (`rt.tokenBaseline = now; rt.lastTurnIndex = event.turnIndex;`) runs AFTER `appendTurnMetric` and is
  UNCONDITIONAL (appendTurnMetric never throws, so we always reach it). The baseline rolls forward whether or
  not the metric persisted (acceptable — missing one metric is non-fatal; we do NOT want a stale baseline
  causing an inflated delta next turn). If anything EARLIER throws (getSessionId/getConfig/estimateTokens),
  the catch fires BEFORE step 8 → baseline is NOT rolled forward (correct: we retry the delta next turn).

## 11. No lint/format tool

- devDeps = typescript + vitest + @types/node only. The type+style gate is `npx tsc --noEmit -p tsconfig.json`
  (TS strict IS the gate). Do NOT invent eslint/prettier/biome. Test imports use `"../src/nudges.js"` (.js
  resolves to .ts under Bundler) — established convention.