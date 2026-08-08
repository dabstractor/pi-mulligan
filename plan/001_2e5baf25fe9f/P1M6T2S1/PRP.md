# PRP — P1.M6.T2.S1: `turn_end` metric handler — compute delta, append turn-metric entry

**Work item:** P1.M6.T2.S1 · **Points:** 1 · **Stage:** Preventive Nudges (spec/11 §2 Step 7 — `nudges.ts`,
Nudge B Phase 1; spec/03 §189; spec/07-preventive-and-nudges.md §2 "Phase 1: measure at turn_end";
spec/04-data-model.md §5 TurnMetric).
**Scope:** **APPEND two new exports to `src/nudges.ts`** (`turnEndMetricHandler` + `registerTurnEndMetric`,
plus import augmentations) and **CREATE one new test file** `test/turn_metric.test.ts`. **No other file is
touched.** This is **Nudge B Phase 1** — the measurement half of Mulligan's per-turn drift nudge. It fires at
`turn_end`, computes how much the *filtered* context grew this turn (delta vs an in-memory baseline), snapshots
any bloat hits collected by Nudge A (`bloatReminderHandler`, P1.M6.T1.S1) into a persisted `turn-metric`
CustomEntry, clears the bloat accumulator, and rolls the baseline forward — **zero extra model requests**
(spec/03 design principle #3/#4). P1.M6.T2.S2 (later) implements Phase 2 (the `context` injection that READS
the metric this task writes).

> **PARALLEL-PREDECESSOR CONTRACT:** `src/nudges.ts` is CREATED by **P1.M6.T1.S1** (running concurrently),
> which ships `bloatReminderHandler` + `registerBloatReminder`. Its PRP explicitly states: *"P1.M6.T2.S1
> (turn_end metric) + P1.M6.T2.S2 (shouldNudge/injectNudge) APPEND to this module later."* ⟹ **This task
> APPENDS to `src/nudges.ts`** — it does NOT recreate it, does NOT touch `bloatReminderHandler` /
> `registerBloatReminder`. The EXACT pre-state of `src/nudges.ts` (reproduced verbatim in the Scope Decision
> below) is the merge base. If `src/nudges.ts` does not yet contain `registerBloatReminder`, STOP —
> P1.M6.T1.S1 has not landed; this task builds on its output.

> **PREREQUISITE (verified live during research):** every symbol this task imports is ALREADY SHIPPED.
> `estimateTokens` (src/tokens.ts — P1.M2.T1.S1 ✅), `appendTurnMetric` + `TurnMetricInput` (src/markers.ts —
> P1.M4.T1.S1 ✅), `getRuntime` (src/runtime.ts — P1.M1.T4.S1 ✅; NOTE: **`nextSeq` is NOT imported** —
> `appendTurnMetric` stamps seq itself — see GOTCHA #1), `getConfig` (src/config.ts — P1.M1.T2 ✅), `log`
> (src/log.ts — P1.M1.T3 ✅). The only Pi type added is `TurnEndEvent` (re-exported at the package root —
> verified). **No dependency on filter.ts (P1.M4.T2) or any P1.M5 tool.**

---

## Goal

**Feature Goal**: Ship Mulligan's **`turn_end` event handler** — Phase 1 of the per-turn drift nudge (Nudge B).
It fires at the end of every turn and, when enabled, (1) measures the current *filtered* context token count
(`rt.lastFiltered` via `estimateTokens`, falling back to `ctx.getContextUsage()?.tokens ?? 0` when no filtered
view exists yet); (2) computes the delta vs the in-memory `tokenBaseline` captured at the previous `turn_end`
(or `session_start`) — `null` on the first turn / post-reload so the downstream nudge falls back to bloat-only;
(3) snapshots `rt.pendingBloatHits` (accumulated this turn by `bloatReminderHandler`) into the metric and
**clears** the accumulator; (4) persists a `mulligan:turn-metric` CustomEntry (NOT in LLM context — internal
telemetry) via `appendTurnMetric`; (5) rolls the baseline forward + records `lastTurnIndex`. The ENTIRE body is
wrapped in try/catch — on ANY exception it logs and returns (fail-open), so an extension bug can NEVER break an
agent turn. The metric records `grewOverThreshold = delta != null && delta > config.nudges.driftThresholdTokens`.

**Deliverable** (APPEND to `src/nudges.ts`; CREATE `test/turn_metric.test.ts`):
1. **`src/nudges.ts`** — APPEND two named exports (build on P1.M6.T1.S1's `bloatReminderHandler` /
   `registerBloatReminder`, which stay untouched):
   - `export function turnEndMetricHandler(pi: ExtensionAPI, event: TurnEndEvent, ctx: ExtensionContext): void`
     — the handler logic (steps 1–9 below), wrapped in ONE try/catch (fail-open). Takes `pi` as its FIRST
     parameter (GOTCHA #2) so it can call `appendTurnMetric(pi, ctx, ...)`; exported so the test calls it
     directly with fakes (no Pi runtime needed).
   - `export function registerTurnEndMetric(pi: ExtensionAPI): void` — `pi.on("turn_end", (event, ctx) =>
     turnEndMetricHandler(pi, event, ctx))`. The closure CAPTURES `pi` (the `turn_end` callback only receives
     `(event, ctx)`, not `pi` — GOTCHA #2). Consumed by `index.ts` (P1.M7.T1.S1).
   - Plus: augment the import block — add `TurnEndEvent` to the pi-package type import; add `estimateTokens`
     to the existing `./tokens.js` import; add a NEW `./markers.js` import (`appendTurnMetric` value +
     `TurnMetricInput` type). No circular import (markers.js does not import nudges.js).
2. **`test/turn_metric.test.ts`** — NEW file (NOT appended to P1.M6.T1.S1's `test/nudges.test.ts` — that
   file's fakes lack `pi.appendEntry` / `ctx.getLeafId` / `ctx.getContextUsage`). Self-contained hand-rolled
   fakes (`makePi` capturing `.on` + `appendEntry`; `makeCtx` with `getSessionId` + `getLeafId` +
   `getContextUsage`); `clearAll()` + `setConfig(DEFAULT)` before/after. Describe blocks for: registration;
   config gates (master off; perTurnDrift off); first-turn (baseline null → deltaTokens null); normal growth
   (delta > threshold → grewOverThreshold true); bloat snapshot + clear; `lastFiltered` fallback path
   (null → `getContextUsage`); negative delta (shrank → grewOverThreshold false); baseline roll-forward;
   fail-open on each throwing dependency; `appendTurnMetric` stamps seq/envelope (handler passes 5 fields only).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (`turnEndMetricHandler(pi, event, ctx)` matches the
  `ExtensionHandler<TurnEndEvent, void>` overload via the closure; `estimateTokens(rt.lastFiltered)` needs
  NO cast — GOTCHA #3; `TurnMetricInput` has 5 fields — GOTCHA #1).
- `npx vitest run test/turn_metric.test.ts` → all turn_metric tests pass.
- `npx vitest run` → **all-green, no regression** (this task appends to nudges.ts + adds 1 new test file; it
  touches nothing else).
- **`registerTurnEndMetric` calls `pi.on("turn_end", …)` exactly once**, and the registered callback delegates
  to `turnEndMetricHandler(pi, event, ctx)` (capturing `pi`).
- **First turn** (`rt.tokenBaseline == null`): metric persisted with `deltaTokens: null`,
  `grewOverThreshold: false`; `rt.tokenBaseline` rolled forward to the measured `now`; `rt.lastTurnIndex`
  = `event.turnIndex`.
- **Normal growth** (`delta > config.nudges.driftThresholdTokens`): metric persisted with
  `grewOverThreshold: true`, `deltaTokens: <now - baseline>`.
- **Bloat snapshot + clear**: `rt.pendingBloatHits = [{toolName, approxTokens}]` BEFORE the handler → metric
  has `bloatHit: true`, `bloatHits: [<that hit>]`; AFTER, `rt.pendingBloatHits === []` (fresh empty array).
- **`lastFiltered` present** ⟹ `now = estimateTokens(rt.lastFiltered).tokens` (D5 honest bookkeeping — the
  FILTERED view, NOT raw `getContextUsage`).
- **`lastFiltered` null** ⟹ `now = ctx.getContextUsage()?.tokens ?? 0` (fallback path).
- **Fail-open**: a throwing `getSessionId` / `getConfig` / `getRuntime` / `estimateTokens` is caught →
  `log("error", "nudge.turn_end", sessionId, {error})` → returns `void`; **`rt.tokenBaseline` is NOT rolled
  forward** (so the delta retries next turn) and `pendingBloatHits` is NOT cleared (the throw precedes the
  snapshot). The agent turn is never broken (spec/03 #4, spec/08 E13).
- **NO double-increment of seq**: the handler does NOT call `nextSeq`; the persisted metric's `seq` increments
  by exactly 1 per turn-end (stamped by `appendTurnMetric`).

---

## User Persona

**Target User**: Two consumers. (1) **`index.ts` (P1.M7.T1.S1)** — the extension factory calls
`registerTurnEndMetric(pi)` once at startup to arm the measurement. (2) **Nudge B Phase 2 (P1.M6.T2.S2)** —
the `context` handler (`filter.ts`) reads the LATEST `mulligan:turn-metric` entry this task persists and, via
`shouldNudge`/`injectNudge`, injects a one-line drift annotation into the next inference. Secondary: **mulligan
itself** — the `turn_end` event fires at the end of every turn (verified: api_verification.md §7.3).

**Use Case**: A turn runs 4 large `read` calls (each ~6 KB, under Pi's 50 KB cap so untruncated) and the
assistant's response adds prose. At `turn_end`, the handler measures the filtered context grew from 8.0k →
12.5k tokens (delta +4.5k > `driftThresholdTokens` 3000). It snapshots the 2 bloat hits `bloatReminderHandler`
recorded, persists a `mulligan:turn-metric` entry `{deltaTokens: 4500, bloatHit: true, bloatHits: [{read,1536},
{read,1536}], grewOverThreshold: true, turnIndex: 5}`, clears `pendingBloatHits`, and rolls the baseline to
12.5k. Next inference, Phase 2 reads that metric and injects "[mulligan] Previous turn added ~4.5k tokens…
consider `mulligan_rewind`/`mulligan_shrink`". **Zero extra requests** — the measurement is pure arithmetic,
and the injection rides the inference that was already happening.

**User Journey**:
1. `index.ts` factory: `registerTurnEndMetric(pi)` → `pi.on("turn_end", (e,c) => turnEndMetricHandler(pi,e,c))`.
2. Agent loop completes a turn → Pi fires `turn_end` with `{type, turnIndex, message, toolResults}`.
3. `turnEndMetricHandler(pi, event, ctx)`: `getSessionId()` (fresh) → `getConfig()` → (disabled? return) →
   `rt = getRuntime(sessionId)` → `now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens :
   ctx.getContextUsage()?.tokens ?? 0` → `delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline`
   → snapshot `bloat = rt.pendingBloatHits; rt.pendingBloatHits = []` → build `TurnMetricInput` (5 fields) →
   `appendTurnMetric(pi, ctx, metric)` → `rt.tokenBaseline = now; rt.lastTurnIndex = event.turnIndex`.
4. The metric persists as a `custom` entry (NOT in LLM context). Phase 2 reads it next turn.

**Pain Points Addressed**: (a) Context drift is invisible — the agent never gets a per-turn "you grew context
by X" signal, so it never realizes a rewind/shrink would help. (b) A per-turn nudge that costs a model call
would be self-defeating (spec/03 #3). The `turn_end` event + the `context` ride-along make the nudge genuinely
free. This task is the MEASUREMENT half (Phase 1); Phase 2 (P1.M6.T2.S2) is the injection.

---

## Why

- **This is the project's signature "free ride" nudge, Phase 1 (spec/03 design principle #3 zero extra requests;
  spec/07 §2).** The metric computation at `turn_end` is pure arithmetic over already-known numbers (the cached
  filtered view + an in-memory baseline) — NO model call. Shipping Phase 1 is a prerequisite for Phase 2's
  injection (which rides the next `context` fire). Together they prove the thesis that a per-turn nudge need
  not cost a request.
- **Honest bookkeeping (spec/03 design principle #6; spec/01 §7).** `now` is measured from `rt.lastFiltered`
  (the FILTERED view — what the model actually saw) via `estimateTokens`, NOT from Pi's raw `getContextUsage()`
  (which counts hidden tokens). The `getContextUsage` fallback is used ONLY when no filtered view exists yet
  (first turn / context never fired). This keeps the delta honest.
- **Feeds Nudge B Phase 2 + closes the bloat accumulator loop (spec/07 §2).** The bloat hits recorded by
  `bloatReminderHandler` (Nudge A, P1.M6.T1.S1) into `rt.pendingBloatHits` are snapshotted + cleared HERE —
  without this handler, that array would grow unboundedly and the metric's `bloatHit`/`bloatHits` fields could
  never fire. The two nudges are decoupled (different events) but share this accumulator.
- **Fail-open is a hard product guarantee (spec/03 #4, spec/08 E13).** The handler sits on the turn-end path.
  A throw here could corrupt per-turn state. The entire body is one try/catch → log + return. Critically, the
  baseline is rolled forward ONLY in the happy path (step 8, after appendTurnMetric) — a throw before step 8
  leaves the baseline untouched so the delta retries next turn (no lost accounting).
- **The metric is internal telemetry (spec/07 §2 cost).** It persists as a `custom` entry (NOT in LLM context),
  so it costs ZERO model tokens. Old metrics accumulate on disk (append-only, like all entries) but only the
  latest is read by Phase 2; garbage-collecting old metrics is an explicit non-goal for v1.

---

## What

APPEND to `src/nudges.ts` (P1.M6.T1.S1's `bloatReminderHandler` + `registerBloatReminder` stay untouched) and
CREATE `test/turn_metric.test.ts`. Behavior of `turnEndMetricHandler(pi, event, ctx)` (ONE try/catch over the
whole body; SYNC — every dependency is sync):

1. `let sessionId = "";` then inside try: `sessionId = ctx.sessionManager.getSessionId();` — read FRESH, FIRST
   (so the catch can log it; C12: never cache the sessionManager handle). `let` (not `const`) so it can start
   `""` and be assigned inside try.
2. `const config = getConfig();` `if (!config.enabled || !config.nudges.perTurnDrift) return;` — BOTH gates
   short-circuit BEFORE any measurement/recording. (`getConfig()` never throws — returns defaults.)
3. `const rt = getRuntime(sessionId);` — the mutable per-session runtime.
4. `const now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens : (ctx.getContextUsage()?.tokens ?? 0);`
   — measure the current FILTERED token count (D5 honest bookkeeping). `rt.lastFiltered` is `AgentMessage[]`
   (`Record<string,unknown>[]`), structurally assignable to `estimateTokens`'s `MessageLike[]` — **NO cast
   needed** (GOTCHA #3, verified by tsc). Fallback to `getContextUsage` ONLY when `lastFiltered` is null.
5. `const delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline;` — `== null` catches both null
   and undefined (defensive). `null` on the first turn / post-reload → downstream nudge falls back to bloat-only.
6. `const bloat = rt.pendingBloatHits; rt.pendingBloatHits = [];` — snapshot the bloat accumulator into `bloat`
   (frozen), then REASSIGN the field to a fresh empty array (NOT splice — reassignment is cleaner and matches
   spec/07 §2 `rt.pendingBloatHits = [];`). Do NOT clear before snapshotting.
7. `const metric: TurnMetricInput = { deltaTokens: delta, bloatHit: bloat.length > 0, bloatHits: bloat,
   grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens, turnIndex: event.turnIndex };`
   — build the 5-field `TurnMetricInput` ONLY (GOTCHA #1: do NOT add `seq`/`ts`/schema/v/kind —
   `appendTurnMetric` stamps them; calling `nextSeq` here would double-increment).
8. `appendTurnMetric(pi, ctx, metric);` — persist the `mulligan:turn-metric` CustomEntry (NOT in LLM context).
   `appendTurnMetric` never throws (returns null on failure — acceptable; missing one metric is non-fatal).
9. `rt.tokenBaseline = now; rt.lastTurnIndex = event.turnIndex;` — roll the baseline forward + record the turn
   index. UNCONDITIONAL (appendTurnMetric never throws, so we always reach here). A throw EARLIER skips this
   (baseline untouched → delta retries next turn — correct).
10. `catch (e)`: `log("error", "nudge.turn_end", sessionId, { error: String(e) });` then fall through (return
    void). `log()` takes `sessionId: string`, NOT `ctx` (GOTCHA #4).

`registerTurnEndMetric(pi)`: `pi.on("turn_end", (event, ctx) => { turnEndMetricHandler(pi, event, ctx); });` —
the closure CAPTURES `pi` (GOTCHA #2). Returns void.

This subtask does **NOT**: implement `shouldNudge`/`injectNudge` (P1.M6.T2.S2 — those are LOCAL no-op stubs in
filter.ts now; this task does not touch them); implement the `context` injection (P1.M6.T2.S2); call `nextSeq`
(GOTCHA #1); put `seq`/`ts` in the metric object (GOTCHA #1); wire anything into `index.ts` (P1.M7.T1.S1);
mutate `bloatReminderHandler`/`registerBloatReminder` (P1.M6.T1.S1's exports — untouched); clear
`pendingBloatHits` before snapshotting; roll the baseline in the catch path; or touch any other existing file.

### Success Criteria

- [ ] `src/nudges.ts` EXPORTS `turnEndMetricHandler` + `registerTurnEndMetric` (and STILL exports
      `bloatReminderHandler` + `registerBloatReminder` from P1.M6.T1.S1 — untouched).
- [ ] `test/turn_metric.test.ts` EXISTS and is all-green; `npx vitest run` is all-green (no regression).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **`registerTurnEndMetric` calls `pi.on("turn_end", …)` exactly once**; the registered callback delegates
      to `turnEndMetricHandler(pi, event, ctx)`.
- [ ] **First turn** (`tokenBaseline == null`): metric `deltaTokens: null`, `grewOverThreshold: false`;
      baseline rolled to `now`; `lastTurnIndex = event.turnIndex`.
- [ ] **Normal growth** (`delta > driftThresholdTokens`): metric `grewOverThreshold: true`, `deltaTokens:
      now - baseline`.
- [ ] **Bloat snapshot + clear**: pre-set `pendingBloatHits` → metric `bloatHit: true`, `bloatHits: [<hits>]`;
      post `rt.pendingBloatHits === []`.
- [ ] **`lastFiltered` present**: `now = estimateTokens(rt.lastFiltered).tokens` (filtered view, NOT
      `getContextUsage`).
- [ ] **`lastFiltered` null**: `now = ctx.getContextUsage()?.tokens ?? 0` (fallback).
- [ ] **Negative delta** (context shrank via rewind/shrink): `grewOverThreshold: false`.
- [ ] **NO double-increment**: handler does NOT call `nextSeq`; persisted metric `seq` increments by exactly 1.
- [ ] **Never throws**: a thrown `getSessionId`/`getConfig`/`getRuntime`/`estimateTokens` is caught, logged via
      `log("error","nudge.turn_end",sessionId,{error:String(e)})`, returns void; baseline NOT rolled forward.
      `log` called with `sessionId` (string), NOT `ctx`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code to APPEND to `src/nudges.ts` (import augmentations + the two new
> functions) is given verbatim in the Implementation Blueprint (Task 1), and the exact fakes + describe blocks
> for `test/turn_metric.test.ts` are given verbatim (Task 2). Every Pi signature (`on("turn_end")` overload,
> `TurnEndEvent`, `ExtensionHandler`, `ExtensionAPI`, `ExtensionContext`, `getContextUsage`, `ContextUsage`) is
> quoted from the **verified installed `.d.ts`** (research/verified_signatures_and_gotchas.md §1–5). The four
> critical gotchas — (1) `appendTurnMetric` stamps seq so do NOT call `nextSeq`/add seq, (2) the handler needs
> `pi` so `registerTurnEndMetric` captures it in a closure, (3) `estimateTokens(rt.lastFiltered)` needs NO cast,
> (4) `log` takes `sessionId` not `ctx` — are called out with the exact workaround. Every upstream helper
> signature is pinned with its file + line. No prior knowledge beyond "append the turn_end handler as thin
> fail-open glue over the COMPLETE shipped helpers + appendTurnMetric" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/nudges.ts` (it ALREADY EXISTS from P1.M6.T1.S1).** Do NOT recreate it. Do NOT modify
  `bloatReminderHandler` / `registerBloatReminder`. Confirm it landed: `grep -n "registerBloatReminder\|export
  function bloatReminderHandler" src/nudges.ts` MUST print matches; if absent, STOP (P1.M6.T1.S1 regressed /
  not landed).
- **EXACT pre-state of `src/nudges.ts` (from the P1.M6.T1.S1 PRP "Implementation Patterns")** — this is the
  merge base. The import block (top of file) looks like:
  ```ts
  import type { ToolResultEvent, ToolResultEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
  import { getConfig } from "./config.js";
  import { getRuntime } from "./runtime.js";
  import { log } from "./log.js";
  import { resultBytes, approxTokens } from "./tokens.js";
  import { renderBloatReminder } from "./notes.js";
  ```
  followed by `bloatReminderHandler` + `registerBloatReminder`.
- **This task's import augmentations** (merge into the existing block; do NOT duplicate the pi-package line):
  - In the `import type { … } from "@earendil-works/pi-coding-agent";` line: **add `TurnEndEvent`**.
  - In the `import { resultBytes, approxTokens } from "./tokens.js";` line: **add `estimateTokens`** (→
    `import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";`).
  - **ADD a new line**: `import { appendTurnMetric } from "./markers.js";` and `import type { TurnMetricInput } from "./markers.js";`
    (combine into one line if preferred: `import { appendTurnMetric, type TurnMetricInput } from "./markers.js";`).
    markers.js does NOT import nudges.js → **no circular dependency**.
- **CREATE `test/turn_metric.test.ts`** (NEW file — do NOT append to P1.M6.T1.S1's `test/nudges.test.ts`; its
  fakes lack `pi.appendEntry` / `ctx.getLeafId` / `ctx.getContextUsage`). vitest picks up all `*.test.ts`.
- **ALL upstream deps are SHIPPED (verified).** `grep -n "export function estimateTokens" src/tokens.ts`,
  `grep -n "export function appendTurnMetric\|export type TurnMetricInput" src/markers.ts`,
  `grep -n "export function getRuntime\|export function clearAll" src/runtime.ts`,
  `grep -n "export function getConfig\|export function setConfig" src/config.ts`, `grep -n "export function log" src/log.ts`
  — every one MUST print a match. If any is absent, STOP.
- **`appendTurnMetric` stamps seq/ts/envelope itself** (GOTCHA #1). Build a `TurnMetricInput` (5 fields:
  `deltaTokens`, `bloatHit`, `bloatHits`, `grewOverThreshold`, `turnIndex`). Do NOT call `nextSeq` (would
  double-increment — appendTurnMetric's internal `nextSeq(sessionId)` already does it). Do NOT add
  `seq`/`ts`/`schema`/`v`/`kind` to the object literal (TS excess-property check rejects them AND the wrapper
  overwrites them).
- **The `turn_end` callback does NOT receive `pi`** (GOTCHA #2). Its signature is `(event: TurnEndEvent, ctx:
  ExtensionContext) => void`. But the handler needs `pi` for `appendTurnMetric(pi, ctx, …)`. ⟹
  `registerTurnEndMetric(pi)` registers a CLOSURE `(event, ctx) => turnEndMetricHandler(pi, event, ctx)` that
  captures `pi`. The exported testable handler's signature is `(pi, event, ctx) => void`. (No existing event
  handler needs `pi` — contextHandler/bloatReminderHandler only RETURN a result; this is the first that WRITES
  through `pi`.)
- **`estimateTokens(rt.lastFiltered)` needs NO cast** (GOTCHA #3, verified by tsc). `rt.lastFiltered` is
  `AgentMessage[]` (`Record<string,unknown>[]`), structurally assignable to `estimateTokens`'s `MessageLike[]`.
  This DIFFERS from filter.ts (lines 234-239) / audit.ts (lines 510-513), which cast because they pass
  transforms.ts's `MessageLike` (a different interface). Do NOT add the cast here.
- **`log()` takes `sessionId: string`, NOT `ctx`** (GOTCHA #4, verified: src/log.ts). The catch logs
  `log("error", "nudge.turn_end", sessionId, { error: String(e) })`. Read `sessionId` FIRST inside try{} (it
  starts `""` via `let`, so a throwing `getSessionId` → catch logs `""`).
- **Handler is SYNC** (not async). `ExtensionHandler` permits a `void` return (no Promise required) and there
  are zero awaits. A sync try/catch is the cleanest fail-open (no unhandled-rejection path). The spec/07 §2
  pseudocode shows `async` — that is also valid, but sync is specified here.
- **There is NO lint/format tool** (devDeps = typescript + vitest + @types/node only). The type+style gate is
  `tsc --noEmit` (TS strict IS the gate). Test imports use `"../src/nudges.js"` (.js resolves to .ts under
  Bundler) — established convention.

### Documentation & References

```yaml
# MUST READ — the authoritative nudge contract (Phase 1 mechanism, baseline semantics, edge cases)
- file: spec/07-preventive-and-nudges.md
  section: "§2 Nudge B — per-turn drift nudge (turn_end → context injection): 'Phase 1: measure at turn_end'
            pseudocode; 'Why this is zero-extra-requests'; 'Cost' (metric is custom, NOT in context); 'Edge cases'
            (first turn/post-reload → deltaTokens null → bloat-only; negative delta → grewOverThreshold false)"
  why: "§2 Phase 1 IS this task. The handler logic (config check → rt → now from lastFiltered/getContextUsage →
        delta vs baseline → snapshot+clear pendingBloatHits → build metric → appendEntry → roll baseline) is the
        9-step plan. §2 'Edge cases' pins the null-delta and negative-delta behaviors."
  critical: "§2 Phase 1 pseudocode calls pi.appendEntry('mulligan:turn-metric', metric) DIRECTLY and builds the
            full metric {schema,v,kind,seq,ts,...}. Our codebase wraps that in appendTurnMetric (markers.ts),
            which stamps seq/ts/envelope ITSELF — so do NOT replicate seq/ts (GOTCHA #1). §2 pseudocode also
            passes ctx to log() — WRONG for our codebase (log takes sessionId — GOTCHA #4). §2 reads rt via
            runtime(ctx) — our getRuntime takes sessionId (GOTCHA #5). Follow the verified signatures, not the
            pseudocode."

# MUST READ — the verified Pi event contract
- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§7.3 turn_end Event (TurnEndEvent { type, turnIndex, message, toolResults }; DISCREPANCY NOTE:
            'does not receive the full message list') + §3.1 getContextUsage(): ContextUsage | undefined +
            §3.2 ContextUsage.tokens: number | null ('?? 0') + §1 on()<E>(event,handler): void + §9 C12/C4"
  why: "§7.3 is THE verified .d.ts source for this event. Confirms turn_end has NO messages field (⟹ use the
        cached rt.lastFiltered). §3.1/§3.2 confirm ctx.getContextUsage()?.tokens ?? 0 type-checks to number.
        Confirms the handler returns void (turn_end is a notification event)."
  critical: "§7.3 confirms turn_end's callback is (event, ctx) — NO pi parameter (GOTCHA #2)."

# MUST READ — design principles this handler embodies
- file: spec/03-architecture.md
  section: "§3 design principle #3 (zero extra requests), #4 (fail open), #6 (honest bookkeeping — filtered view,
        not raw getContextUsage), §2.4 (fail open — every handler wrapped so an exception becomes a logged no-op),
        §7 module list (nudges.ts = tool_result annotator + turn_end metric + context nudge injection)"
  why: "#3 is WHY the measurement rides turn_end (pure arithmetic, no model call). #4/§2.4 is the fail-open
        mandate: the WHOLE handler body is ONE try/catch. #6 is WHY now uses rt.lastFiltered (filtered) not
        ctx.getContextUsage() (raw, counts hidden tokens). §7 confirms nudges.ts is the canonical module."

# MUST READ — the fail-open edge case + the TurnMetric schema
- file: spec/08-edge-cases.md
  section: "E13 (fail-open: handler never throws)"
  why: "E13 is the explicit fail-open edge case this handler must satisfy."
- file: spec/04-data-model.md
  section: "§5 TurnMetric (schema, kind:'turn-metric', seq, ts, deltaTokens: number|null, bloatHit, bloatHits[],
        grewOverThreshold, turnIndex; 'only the LATEST one is consulted by the filter')"
  why: "§5 IS the persisted shape. deltaTokens is number|null (null = baseline missing). NOTE §5 has NO id field
        (unlike rewind/shrink) — appendTurnMetric does NOT stamp one (already correct in markers.ts)."

# THE COMPLETE helpers this handler consumes (all shipped — treat as contracts)
- file: src/markers.ts
  section: "appendTurnMetric(pi, ctx, data: TurnMetricInput): string|null — stamps {schema,v,kind,seq,ts} via
        nextSeq(sessionId) + Date.now(); calls pi.appendEntry('mulligan:turn-metric', entry); returns
        ctx.sessionManager.getLeafId(); NEVER throws (whole body try/catch → null). TurnMetricInput =
        Omit<TurnMetric,'schema'|'v'|'kind'|'seq'|'ts'> (5 fields)."
  why: "The persistence wrapper. CRITICAL: it stamps seq ITSELF — do NOT pass seq (GOTCHA #1). It needs pi (→
        appendEntry) + ctx (→ getSessionId, getLeafId)."

- file: src/tokens.ts
  section: "estimateTokens(messages: MessageLike[] | null | undefined, _model?): { tokens: number; confidence }
        — Math.ceil(totalChars/4); NEVER throws (defensive readOwn/try-catch). tokens.ts MessageLike has
        [key:string]:unknown index signature."
  why: "Measures the filtered token count. rt.lastFiltered (AgentMessage[] = Record<string,unknown>[]) is
        structurally assignable to MessageLike[] — NO cast needed (GOTCHA #3, verified by tsc)."

- file: src/runtime.ts
  section: "getRuntime(sessionId): SessionRuntime (MUTABLE ref; same id → same live object; never throws);
        SessionRuntime.tokenBaseline: number|null, .lastFiltered: AgentMessage[]|null,
        .pendingBloatHits: BloatHit[], .lastTurnIndex: number|null; BloatHit = {toolName, approxTokens};
        clearAll() for tests."
  why: "The baseline + bloat accumulator + filtered-view cache. Snapshot pendingBloatHits then REASSIGN [].
        Module-scoped map → tests MUST clearAll() before/after (GOTCHA #6)."

- file: src/config.ts
  section: "getConfig(): MulliganConfig (defensive clone each call; NEVER throws); MulliganConfig.enabled,
            .nudges.perTurnDrift (default true), .nudges.driftThresholdTokens (default 3000). setConfig(raw)
            for tests."
  why: "The two gates (master switch + perTurnDrift switch) + the drift threshold. Read config AFTER sessionId."

- file: src/log.ts
  section: "log(level, event, sessionId, data?) — VERIFIED third arg is sessionId: string (NOT ctx); never
        throws; no-op when no log file set (default)."
  why: "The fail-open catch logs via log('error','nudge.turn_end',sessionId,{error:String(e)})."

# SIBLING PRP — the PARALLEL predecessor that CREATES src/nudges.ts (the merge base)
- file: plan/001_2e5baf25fe9f/P1M6T1S1/PRP.md
  section: "'Implementation Patterns' — the verbatim src/nudges.ts content (bloatReminderHandler +
            registerBloatReminder + the exact import block). 'P1.M6.T2.S1 APPEND to this module later.'"
  why: "This is the EXACT pre-state of src/nudges.ts this task builds on. The import block (reproduced in the
        Scope Decision) is what you augment. bloatReminderHandler's structure (read sessionId first; ONE
        try/catch; log(sessionId) in catch; both config gates before measurement; SYNC) is the pattern to MIRROR
        for turnEndMetricHandler."

# SIBLING PRP — the closest pi.on() handler analog (fail-open structure, registration test)
- file: plan/001_2e5baf25fe9f/P1M4T2S1/PRP.md
  section: "contextHandler structure (ONE try/catch; read sessionId first; log('error',...,sessionId,...) in
            catch; return void on fail), registerFilterHandler(pi) = pi.on('context',...), the makePi/makeCtx
            fake idiom"
  why: "filter.ts is the established pattern for a fail-open pi.on() handler + its unit test. Mirror its structure
        and its hand-rolled-fake test idiom (filter.ts is COMPLETE per plan_status). NOTE: filter.ts's handler
        does NOT need pi; turnEndMetricHandler DOES (GOTCHA #2) — that is the one structural difference."

# DOWNSTREAM CONSUMER (Phase 2 — NOT this task)
- file: plan/001_2e5baf25fe9f/P1M6T2S2/PRP.md   (planned; shouldNudge/injectNudge)
  section: "shouldNudge(metric, config) = metric.grewOverThreshold || metric.bloatHit; injectNudge appends an
            ephemeral mulligan:nudge CustomMessage to the in-flight copy"
  why: "Defines the DOWNSTREAM consumer of the metric this task persists. Confirms the metric fields
        (grewOverThreshold, bloatHit) are exactly what Phase 2 reads. This task does NOT implement Phase 2."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps
│                           #   typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler',
│                           #   include:['src','test'], target ES2022. exit 0 VERIFIED.
├── src/
│   ├── index.ts            # no-op stub (registerTurnEndMetric wired in P1.M7.T1). DO NOT TOUCH.
│   ├── config.ts           # getConfig, setConfig, MulliganConfig (enabled/nudges.perTurnDrift/driftThresholdTokens). DO NOT TOUCH.
│   ├── log.ts              # log(level,event,sessionId,data?) — VERIFIED sessionId arg. DO NOT TOUCH.
│   ├── runtime.ts          # getRuntime, clearAll, SessionRuntime (tokenBaseline/lastFiltered/pendingBloatHits/lastTurnIndex). DO NOT TOUCH.
│   ├── tokens.ts           # estimateTokens (COMPLETE). DO NOT TOUCH.
│   ├── ledger.ts / notes.ts# renderBloatReminder lives in notes.ts. DO NOT TOUCH.
│   ├── transforms.ts       # pure filter core. DO NOT TOUCH.
│   ├── markers.ts          # appendTurnMetric + TurnMetricInput + TurnMetric (COMPLETE). DO NOT TOUCH.
│   ├── filter.ts           # context handler (COMPLETE); has LOCAL shouldNudge/injectNudge stubs (P1.M6.T2.S2 swaps them). DO NOT TOUCH.
│   └── nudges.ts           # CREATED by P1.M6.T1.S1 (bloatReminderHandler + registerBloatReminder). THIS TASK APPENDS.
├── test/
│   ├── *.test.ts (9-10 files) # config/filter/ledger/log/markers/notes/runtime/tokens/transforms + tools/*. Read-only.
│   ├── nudges.test.ts      # CREATED by P1.M6.T1.S1 (Nudge A tests). DO NOT TOUCH / APPEND.
│   └── turn_metric.test.ts # NEW — THIS TASK CREATES (Nudge B Phase 1 tests).
└── spec/                   # 03 §2.4/§3/§6/§7 + 04 §5 + 07 §2 + 08 E13 + 11 §2 Step7.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → ~10 files all-green.
# NOTE: NO eslint/prettier/biome. The type+style gate is `tsc --noEmit` (TS strict).
# NOTE: test imports use "../src/<name>.js" (.js resolves to .ts under Bundler) — established convention.
# NOTE: the hand-rolled-fake (no vi.fn for Pi objects) convention comes from test/markers.test.ts + test/filter.test.ts.
```

### Desired Codebase tree with files to be CREATED / MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── nudges.ts           # MODIFIED (APPEND): + turnEndMetricHandler(pi, event, ctx) + registerTurnEndMetric(pi).
│                           #   Import augmentations: + TurnEndEvent (type), + estimateTokens (./tokens.js),
│                           #   + appendTurnMetric + TurnMetricInput (./markers.js). bloatReminderHandler/
│                           #   registerBloatReminder UNCHANGED.
└── test/
    └── turn_metric.test.ts # NEW: hand-rolled makePi (.on + appendEntry) + makeCtx (getSessionId + getLeafId +
                            #   getContextUsage); clearAll()+setConfig(DEFAULT) before/after; describe blocks for
                            #   registration, config gates, first-turn null delta, normal growth, bloat snapshot+
                            #   clear, lastFiltered vs getContextUsage fallback, negative delta, baseline roll,
                            #   no-double-increment, fail-open on each throwing dep.
# No other files touched. P1.M6.T1.S1's test/nudges.test.ts is LEFT ALONE (separate file avoids a parallel edit).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — `appendTurnMetric` stamps seq/ts/envelope ITSELF; do NOT call nextSeq; do NOT put
#   seq/ts/schema/v/kind in the metric. The contract's LOGIC step 6 (`metric = {schema, v:1, kind, seq, ts, …}`)
#   + step 7 (`appendTurnMetric(pi, ctx, metric)`) mirrors spec/07 §2 which calls `pi.appendEntry(…)` DIRECTLY.
#   Our codebase wraps that in `appendTurnMetric(pi, ctx, data: TurnMetricInput)` (src/markers.ts), which does:
#       const seq = nextSeq(sessionId);
#       const entry = { ...data, schema:'pi-mulligan', v:1, kind:'turn-metric', seq, ts: Date.now() };
#       pi.appendEntry('mulligan:turn-metric', entry);
#   TurnMetricInput = Omit<TurnMetric,'schema'|'v'|'kind'|'seq'|'ts'> = the 5 DATA fields. So the handler builds
#   ONLY {deltaTokens, bloatHit, bloatHits, grewOverThreshold, turnIndex}. If it ALSO called nextSeq, seq would
#   double-increment (the wrapper increments AGAIN); and TS excess-property check would reject an object literal
#   carrying seq/ts. NOTE: this means nextSeq is NOT imported by this task (the contract lists it as an input, but
#   the codebase API makes it unnecessary — appendTurnMetric owns it).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — the `turn_end` callback does NOT receive `pi`. Its signature is
#   `(event: TurnEndEvent, ctx: ExtensionContext) => void`. But the handler must call `appendTurnMetric(pi, ctx, …)`
#   (→ pi.appendEntry), so it NEEDS pi. SOLUTION: `registerTurnEndMetric(pi)` registers a CLOSURE
#   `(event, ctx) => turnEndMetricHandler(pi, event, ctx)` that captures pi. The EXPORTED testable handler's
#   signature is `(pi: ExtensionAPI, event: TurnEndEvent, ctx: ExtensionContext): void`. No existing event handler
#   needs pi (contextHandler/bloatReminderHandler only RETURN a result) — this is the first that WRITES through pi.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — `estimateTokens(rt.lastFiltered)` needs NO cast. `rt.lastFiltered` is `AgentMessage[]`
#   where `AgentMessage = Record<string, unknown>` (src/runtime.ts local opaque alias). `Record<string,unknown>[]`
#   IS structurally assignable to tokens.ts's `MessageLike[]` (both have `[key: string]: unknown`; MessageLike's
#   named props role/content are OPTIONAL). VERIFIED by an in-project tsc probe (a control broken line errored;
#   `estimateTokens(rt.lastFiltered)` produced ZERO errors). This DIFFERS from filter.ts (lines 234-239) and
#   audit.ts (lines 510-513), which cast `as unknown as Parameters<typeof estimateTokens>[0]` — THOSE casts are
#   needed because those call sites pass transforms.ts's MessageLike (a DIFFERENT interface). Do NOT add the cast
#   here (it would be dead noise); the contract's `estimateTokens(rt.lastFiltered).tokens` is correct as-is.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — `log()` takes `sessionId: string`, NOT `ctx` (src/log.ts, VERIFIED). The spec/07 §2 pseudocode
#   `log("error","nudge.turn_end",ctx,{...})` is WRONG for this codebase and will NOT type-check. Read sessionId
#   FIRST inside try{} (start it as `let sessionId = "";` so a throwing getSessionId → catch logs ""). log() never
#   throws (its own try/catch) and is a no-op when no log file is set (default) → tests don't pollute the FS.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — the spec/07 §2 pseudocode reads the runtime via `runtime(ctx)` / `const rt = runtime(ctx)`. In OUR
#   codebase it is `getRuntime(sessionId)` (takes the sessionId STRING, not ctx). Read sessionId first (step 1),
#   then `const rt = getRuntime(sessionId);`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — the runtime map is MODULE-SCOPED (runtime.ts). Tests MUST clearAll() in beforeEach AND afterEach
#   (mirror test/markers.test.ts + test/runtime.test.ts), AND setConfig to defaults, or a prior test's
#   tokenBaseline/pendingBloatHits/lastFiltered/seq leaks in. Because getRuntime(id) returns the SAME live object,
#   the test can `const rt = getRuntime(id); rt.tokenBaseline = X;` BEFORE calling the handler and the handler's
#   internal getRuntime(id) sees the same X.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — the ENTIRE handler body is ONE try/catch (fail-open, spec/03 #4 / spec/08 E13). On ANY
#   throw (getSessionId, getConfig, getRuntime, estimateTokens), log + fall through (return void). An extension
#   bug must NEVER break an agent turn. CRITICAL ORDERING: step 9 (roll baseline) runs ONLY in the happy path
#   (after appendTurnMetric). A throw BEFORE step 9 leaves rt.tokenBaseline untouched (so the delta retries next
#   turn — correct) and pendingBloatHits uncleared (the throw precedes the snapshot — correct, the hits retry too).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — gate ORDER matters: read sessionId first (for the catch log), then getConfig, then BOTH config
#   gates (enabled && nudges.perTurnDrift) short-circuit BEFORE measurement/recording. Recording a metric when
#   perTurnDrift is off would waste an appendEntry + leave a stale metric that Phase 2 would (wrongly) inject.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — Snapshot THEN clear pendingBloatHits, in that order: `const bloat = rt.pendingBloatHits;
#   rt.pendingBloatHits = [];`. Grabbing the reference first means `bloat` holds the (now-detached) OLD array
#   (the metric's snapshot); reassigning the field resets it for next turn. Do NOT clear before snapshotting
#   (you'd snapshot an empty array). Do NOT splice (reassignment is cleaner + matches spec/07 §2).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — `now` uses rt.lastFiltered (the FILTERED view) when present, NOT raw ctx.getContextUsage()
#   (design principle #6 honest bookkeeping — getContextUsage counts hidden tokens). The ternary
#   `rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens : (ctx.getContextUsage()?.tokens ?? 0)` encodes
#   that: filtered-first, raw-fallback-only. Note `getContextUsage()?.tokens` is `number | null`; `?? 0` coerces.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — there is NO lint/format tool (devDeps = typescript + vitest + @types/node only). The "Level 1
#   syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent
#   eslint/prettier/biome — "command not found".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — the test imports from "../src/nudges.js" (.js extension; resolves to .ts under Bundler) and
#   "../src/runtime.js" (for getRuntime/clearAll), "../src/config.js" (for setConfig). Established convention.
#   turn_metric.test.ts is a NEW file; do not modify other tests.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — APPEND to src/nudges.ts; do NOT recreate it and do NOT touch bloatReminderHandler /
#   registerBloatReminder (P1.M6.T1.S1's exports). The test file is SEPARATE (test/turn_metric.test.ts), NOT
#   appended to P1.M6.T1.S1's test/nudges.test.ts (its fakes lack pi.appendEntry/ctx.getLeafId/ctx.getContextUsage).
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

This task defines NO new types. It reuses `TurnEndEvent` (type-only, from the pi package — added to the import),
`TurnMetricInput` (type-only, from markers.js), `ExtensionAPI`/`ExtensionContext` (already imported by
P1.M6.T1.S1's nudges.ts), and the shipped helpers. The persisted `TurnMetric` shape (spec/04 §5) is produced by
`appendTurnMetric` (markers.ts stamps the envelope + seq + ts); this task supplies only the 5 data fields.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES + BASELINE (no edits — run only)
  - RUN: grep -n "registerBloatReminder\|export function bloatReminderHandler" src/nudges.ts   # BOTH must print
        (confirms P1.M6.T1.S1 landed — src/nudges.ts exists). If absent, STOP.
  - RUN: grep -n "export function estimateTokens" src/tokens.ts                                # MUST print.
  - RUN: grep -n "export function appendTurnMetric\|export type TurnMetricInput" src/markers.ts # BOTH must print.
  - RUN: grep -n "export function getRuntime\|export function clearAll" src/runtime.ts          # BOTH must print.
  - RUN: grep -n "export function getConfig\|export function setConfig" src/config.ts            # BOTH must print.
  - RUN: grep -n "export function log" src/log.ts                                               # MUST print.
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect all-green (baseline).

Task 1: APPEND to src/nudges.ts   (exact content below — copy verbatim into the existing file)
  - AUGMENT the import block (see Scope Decision for the pre-state):
      * Add TurnEndEvent to the pi-package `import type { … }` line.
      * Add estimateTokens to the existing `import { resultBytes, approxTokens } from "./tokens.js";` line.
      * Add a NEW `import { appendTurnMetric, type TurnMetricInput } from "./markers.js";` line.
  - APPEND (below registerBloatReminder): turnEndMetricHandler(pi, event, ctx) (ONE try/catch; steps 1–9 +
    catch) + registerTurnEndMetric(pi) (closure capturing pi — GOTCHA #2).
  - CONSTRAINTS:
      * `let sessionId = "";` then FIRST inside try{} assign from ctx.sessionManager.getSessionId() (GOTCHA #4).
      * getConfig() AFTER sessionId; BOTH gates (enabled && nudges.perTurnDrift) short-circuit BEFORE
        measurement (GOTCHA #8).
      * rt = getRuntime(sessionId) — STRING arg, not ctx (GOTCHA #5).
      * now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens : (ctx.getContextUsage()?.tokens ?? 0)
        — NO cast on estimateTokens(rt.lastFiltered) (GOTCHA #3).
      * delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline.
      * bloat = rt.pendingBloatHits; rt.pendingBloatHits = []; — snapshot THEN clear (GOTCHA #9).
      * metric: TurnMetricInput = {deltaTokens:delta, bloatHit:bloat.length>0, bloatHits:bloat,
        grewOverThreshold: delta!=null && delta>config.nudges.driftThresholdTokens, turnIndex:event.turnIndex}
        — 5 fields ONLY; NO seq/ts/schema/v/kind; do NOT call nextSeq (GOTCHA #1).
      * appendTurnMetric(pi, ctx, metric) — pi is the handler's first param (GOTCHA #2).
      * rt.tokenBaseline = now; rt.lastTurnIndex = event.turnIndex; — ONLY in happy path (GOTCHA #7).
      * catch: log("error","nudge.turn_end",sessionId,{error:String(e)}); then fall through (return void).
      * SYNC function (no async — see GOTCHA / P1.M6.T1.S1 precedent).
  - NAMING/PLACEMENT: append to existing src/nudges.ts. NEW exports: turnEndMetricHandler, registerTurnEndMetric.
    P1.M6.T1.S1's bloatReminderHandler + registerBloatReminder UNCHANGED.

Task 2: CREATE test/turn_metric.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: hand-rolled makePi (captures `.on` registrations AND `appendEntry` calls), makeCtx (getSessionId
    + getLeafId + getContextUsage, all configurable incl. throwOn*), makeEvent (synthetic TurnEndEvent);
    clearAll() + setConfig(structuredClone(DEFAULT_CONFIG)) before/afterEach (GOTCHA #6). Describe blocks:
    registration (handlers['turn_end'] is a fn that delegates to turnEndMetricHandler); config gates (master
    off; perTurnDrift off → no appendEntry, baseline unchanged); first-turn null delta; normal growth
    (delta>threshold → grewOverThreshold true); bloat snapshot + clear; lastFiltered present (estimateTokens
    path, NOT getContextUsage); lastFiltered null (getContextUsage fallback); negative delta (grewOverThreshold
    false); baseline roll-forward + lastTurnIndex; NO double-increment (handler passes 5 fields; persisted seq
    increments by exactly 1); fail-open on each throwing dep (getSessionId / getConfig / getRuntime / a
    Proxy content that throws in estimateTokens) → returns void, baseline NOT rolled, log via sessionId.
  - CONSTRAINTS: hand-rolled fakes for Pi objects (no vi.fn). clearAll() + setConfig(DEFAULT) before/afterEach.
    Reuse the markers.test.ts makePi (appendEntry) + filter.test.ts makePi (.on) idiom — COMBINE them. To set
    rt state, `const rt = getRuntime(sessionId); rt.tokenBaseline = X; rt.lastFiltered = [...]; rt.pendingBloatHits=[...]`
    BEFORE calling the handler. Assert on fake pi.appendEntry[0].data (the persisted TurnMetric: schema, v, kind,
    seq, ts, + the 5 data fields).
  - COVERAGE: every success-criteria bullet has an assertion.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A for the unit suite (Pi-coupled glue; the real end-to-end is
    the integration smoke harness P1.M7.T2). Level 4 = the fail-open + snapshot-clear + no-double-increment +
    filtered-not-raw assertions.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the turn_end metric handler (fail-open, Nudge B Phase 1). APPEND into the existing src/nudges.ts.
// IMPORT AUGMENTATIONS (merge into the existing import block — do NOT duplicate the pi-package line):
//   import type { ToolResultEvent, ToolResultEventResult, ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
//   import { getConfig } from "./config.js";
//   import { getRuntime } from "./runtime.js";
//   import { log } from "./log.js";
//   import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";          // + estimateTokens
//   import { renderBloatReminder } from "./notes.js";
//   import { appendTurnMetric, type TurnMetricInput } from "./markers.js";            // NEW

// ── bloatReminderHandler + registerBloatReminder (P1.M6.T1.S1) stay UNCHANGED above this point ──

/**
 * turnEndMetricHandler — Nudge B Phase 1 (spec/07 §2). Fires at the end of every turn; measures how much the
 * FILTERED context grew this turn (delta vs the in-memory tokenBaseline), snapshots the bloat hits collected by
 * bloatReminderHandler (Nudge A) into a persisted turn-metric CustomEntry, clears the bloat accumulator, and
 * rolls the baseline forward. Rides the turn_end notification — zero extra model requests (D3/D4).
 *
 * The metric is INTERNAL TELEMETRY: a `custom` entry (NOT in LLM context). Only the LATEST one is read by the
 * filter's drift-nudge injection (P1.M6.T2.S2); older ones persist on disk but are ignored.
 *
 * NEVER throws (spec/03 #4, spec/08 E13): the WHOLE body is ONE try/catch → log + return (the turn is never
 * broken). Read sessionId FIRST so the catch can log it. deltaTokens is null on the first turn / post-reload
 * (baseline missing) → the downstream nudge falls back to bloat-only signaling. SYNC (every dependency is sync).
 *
 * WHY pi is a parameter (GOTCHA #2): the turn_end callback only receives (event, ctx), but this handler must
 * call appendTurnMetric(pi, ctx, …) (→ pi.appendEntry). registerTurnEndMetric captures pi in a closure and
 * passes it here, so the exported handler is directly testable with a fake pi.
 *
 * @param pi    the Pi ExtensionAPI (appendTurnMetric → pi.appendEntry lives here).
 * @param event { type:"turn_end"; turnIndex; message; toolResults } — NO messages field (api_verification §7.3).
 * @param ctx   the Pi ExtensionContext (sessionManager.getSessionId read FRESH — C12; getContextUsage fallback).
 * @returns void (turn_end is a notification event).
 */
export function turnEndMetricHandler(
  pi: ExtensionAPI,
  event: TurnEndEvent,
  ctx: ExtensionContext,
): void {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first so the catch can log it (GOTCHA #4)

    const config = getConfig();
    if (!config.enabled || !config.nudges.perTurnDrift) return; // both gates BEFORE measurement (GOTCHA #8)

    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)

    // (3) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw
    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet
    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),
    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).
    const now = rt.lastFiltered
      ? estimateTokens(rt.lastFiltered).tokens
      : (ctx.getContextUsage()?.tokens ?? 0);

    // (4) Delta vs the baseline captured at the previous turn_end (or session_start). null on first turn.
    const delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline;

    // (5) Snapshot + CLEAR the bloat hits collected this turn by bloatReminderHandler (Nudge A). Grab the OLD
    //     array reference (the metric's frozen snapshot), then REASSIGN the field to a fresh [] for next turn.
    const bloat = rt.pendingBloatHits;
    rt.pendingBloatHits = [];

    // (6) Build TurnMetricInput — the 5 DATA fields ONLY (GOTCHA #1: appendTurnMetric stamps schema/v/kind/seq/ts;
    //     do NOT call nextSeq or add seq — it would double-increment). grewOverThreshold uses driftThresholdTokens.
    const metric: TurnMetricInput = {
      deltaTokens: delta,
      bloatHit: bloat.length > 0,
      bloatHits: bloat,
      grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens,
      turnIndex: event.turnIndex,
    };

    // (7) Persist the turn-metric CustomEntry (NOT in LLM context). appendTurnMetric stamps the envelope + seq +
    //     ts and never throws (returns null on failure — acceptable; missing one metric is non-fatal).
    appendTurnMetric(pi, ctx, metric);

    // (8) Roll the baseline forward + record the turn index. UNCONDITIONAL in the happy path (appendTurnMetric
    //     never throws, so we always reach here). A throw EARLIER skips this → baseline untouched → delta retries
    //     next turn (correct). NOT in the catch path.
    rt.tokenBaseline = now;
    rt.lastTurnIndex = event.turnIndex;
  } catch (e) {
    log("error", "nudge.turn_end", sessionId, { error: String(e) }); // GOTCHA #4: sessionId, NOT ctx
    // fail-open: return nothing (the turn is unaffected)
  }
}

/**
 * registerTurnEndMetric — arm Nudge B Phase 1. index.ts (P1.M7.T1.S1) calls this once at startup.
 * The closure CAPTURES `pi` (GOTCHA #2): the turn_end callback only receives (event, ctx), but the handler
 * needs pi for appendTurnMetric. P1.M6.T2.S2 (shouldNudge/injectNudge — Phase 2, in filter.ts) READS the metric
 * this handler writes; it does NOT live in this module.
 */
export function registerTurnEndMetric(pi: ExtensionAPI): void {
  pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext): void => {
    turnEndMetricHandler(pi, event, ctx);
  });
}
```

```ts
// PATTERN — the test fake idiom (combine markers.test.ts makePi + filter.test.ts makePi). Sketch; full file in Task 2.
import { DEFAULT_CONFIG, setConfig } from "../src/config.js";
import { getRuntime, clearAll } from "../src/runtime.js";
import { registerTurnEndMetric, turnEndMetricHandler } from "../src/nudges.js";
import type { ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";

function makePi(opts: { throwOnAppend?: boolean } = {}) {
  const onHandlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const appended: { customType: string; data: unknown }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) { onHandlers[event] = handler; },
    appendEntry(customType: string, data?: unknown) {
      if (opts.throwOnAppend) throw new Error("appendEntry boom");
      appended.push({ customType, data });
    },
  };
  return { onHandlers, appended, pi: pi as unknown as ExtensionAPI };
}
function makeCtx(opts: {
  sessionId?: string; leafId?: string | null; tokens?: number | null; hasUsage?: boolean;
  throwOnGetSessionId?: boolean; throwOnGetLeafId?: boolean;
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const leafId = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const ctx = {
    sessionManager: {
      getSessionId() { if (opts.throwOnGetSessionId) throw new Error("boom"); return sessionId; },
      getLeafId() { if (opts.throwOnGetLeafId) throw new Error("boom"); return leafId; },
    },
    getContextUsage() {
      if (opts.hasUsage === false) return undefined;
      return { tokens: opts.tokens ?? 0, contextWindow: 200000, percent: null };
    },
  };
  return { ctx: ctx as unknown as ExtensionContext };
}
function makeEvent(turnIndex: number): TurnEndEvent {
  return { type: "turn_end", turnIndex, message: { role: "assistant" } as never, toolResults: [] } as unknown as TurnEndEvent;
}
// BEFORE EACH: clearAll(); setConfig(structuredClone(DEFAULT_CONFIG));
// Set rt state: const rt = getRuntime("s1"); rt.tokenBaseline = 1000; rt.lastFiltered = [{role:"user",content:"x".repeat(16000)}]; rt.pendingBloatHits=[{toolName:"read",approxTokens:2000}];
//   (16000 chars → estimateTokens = ceil(16000/4) = 4000 tokens → now=4000 → delta=3000 → NOT > 3000 (strict). Use 16004 chars → 4001 → delta 3001 > 3000 → grewOverThreshold true.)
// Invoke directly: turnEndMetricHandler(pi, makeEvent(5), ctx);  // no Pi runtime needed.
// Assert appended[0].data: { schema:'pi-mulligan', v:1, kind:'turn-metric', seq:<n>, ts:<n>, deltaTokens, bloatHit, bloatHits, grewOverThreshold, turnIndex }.
```

### Integration Points

```yaml
EVENT REGISTRATION (consumed by index.ts, P1.M7.T1.S1 — NOT this task):
  - add to: src/index.ts (factory)   [DEFERRED to P1.M7.T1.S1 — this task only SHIPS registerTurnEndMetric]
  - pattern: "registerTurnEndMetric(pi);  // arm Nudge B Phase 1"

RUNTIME STATE (read/write, in-memory; baseline + accumulator + cache):
  - read+write: "rt.tokenBaseline (baseline delta), rt.lastTurnIndex (turnIndex echo)"
  - read: "rt.lastFiltered (filter's cached output — D5 honest bookkeeping), rt.pendingBloatHits (Nudge A's accumulator)"
  - write+clear: "rt.pendingBloatHits = [] (snapshot taken first into the metric)"

PERSISTENCE (via the appendTurnMetric wrapper — NOT a direct appendEntry):
  - persist: "appendTurnMetric(pi, ctx, metric) → pi.appendEntry('mulligan:turn-metric', {…metric, schema,v,kind,seq,ts})"
  - NOTE: "the metric is a `custom` entry — NOT in LLM context (internal telemetry, zero model-token cost)"

CONFIG (read-only):
  - consume: "config.enabled, config.nudges.perTurnDrift, config.nudges.driftThresholdTokens (default 3000)"

DOWNSTREAM CONSUMER (P1.M6.T2.S2 — NOT this task):
  - read: "filter.ts readMarkers keeps the LATEST mulligan:turn-metric (highest seq); Phase 2 shouldNudge/injectNudge
    inject a drift annotation when metric.grewOverThreshold || metric.bloatHit"
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# There is NO eslint/prettier/biome (devDeps = typescript + vitest + @types/node). TS strict IS the gate.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output:
#   - "Object literal may only specify known properties, and 'seq'/'ts'/'schema' …" → you added seq/ts/etc. to
#     the metric object literal; remove them (GOTCHA #1 — appendTurnMetric stamps them).
#   - "Property 'appendEntry' does not exist on type 'ExtensionAPI'" / "Argument of type 'X' is not assignable
#     to parameter of type 'ExtensionAPI'" → impossible (verified); re-check you imported ExtensionAPI type-only.
#   - "Expected 3 arguments, but got 2" on appendTurnMetric → you forgot the pi arg (GOTCHA #2).
#   - "Cannot find name 'TurnEndEvent'" → you forgot to add it to the pi-package type import.
#   - "Property 'getContextUsage' does not exist on type 'ExtensionContext'" → impossible (verified §3.1); re-check.
# Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new handler in isolation
npx vitest run test/turn_metric.test.ts
# Expected: all turn_metric tests pass.

# Full suite (no regression)
npx vitest run
# Expected: all-green (one more file than baseline). If a PRIOR test fails, it is a regression caused by this
# task — but this task only APPENDS to nudges.ts (does not modify bloatReminderHandler/registerBloatReminder)
# and adds 1 new test file, so a prior failure means this task accidentally mutated bloatReminderHandler or a
# shared module. Re-check that the import augmentations did not break bloatReminderHandler's deps.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for the unit suite — turnEndMetricHandler is Pi-coupled glue exercised by the integration smoke harness
# (P1.M7.T2, spec/10). The handler IS directly invokable in the unit test via the captured .on handler +
# turnEndMetricHandler(pi, event, ctx) (Level 2), which is the equivalent of an integration call without a live
# Pi runtime.
#
# The real end-to-end (a live `pi -e ./src/index.ts` session that runs a turn and observes a persisted
# mulligan:turn-metric custom entry in the session file) is owned by P1.M7.T2 (smoke harness) — NOT this task.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Fail-open + snapshot-clear + no-double-increment + filtered-not-raw assertions (the heart of this handler):
#   - assert a THROWING getSessionId (ctx.sessionManager.getSessionId = () => { throw }) → handler returns void,
#     AND rt.tokenBaseline is UNCHANGED (NOT rolled forward — the throw precedes step 9), AND
#     rt.pendingBloatHits is UNCHANGED (NOT cleared — the throw precedes the snapshot), AND log received "".
#   - assert a THROWING getConfig (setConfig with a value that makes getConfig throw — note getConfig never
#     throws in practice; simulate by stubbing) → handler returns void, baseline unchanged.
#   - assert a THROWING estimateTokens (rt.lastFiltered = a Proxy whose every get throws) → fail-open, baseline
#     unchanged. (estimateTokens is defensive and normally swallows Proxy traps internally, so this may not
#     throw at all — if it doesn't, the handler proceeds normally; that's also fine. The outer try/catch is the
#     hard guarantee regardless.)
#   - assert the SNAPSHOT-THEN-CLEAR order: pre-set rt.pendingBloatHits = [{toolName:'read', approxTokens:2000}];
#     after the handler, appended[0].data.bloatHit === true, appended[0].data.bloatHits has that hit, AND
#     rt.pendingBloatHits === [] (a FRESH empty array, length 0).
#   - assert NO DOUBLE-INCREMENT: call the handler for two consecutive turns (same sessionId, roll baseline
#     naturally); the two persisted metrics have seq values that differ by EXACTLY 1 (e.g. 1 then 2) — proving
#     the handler does not call nextSeq (appendTurnMetric does it once each).
#   - assert FILTERED-NOT-RAW: when rt.lastFiltered is set, `now` reflects estimateTokens(lastFiltered) (e.g.
#     16000 chars → 4000 tokens), NOT ctx.getContextUsage().tokens. Cross-check by setting a DIFFERENT
#     getContextUsage().tokens (e.g. 9999) and asserting the metric's implied `now` (= baseline+delta) is the
#     estimateTokens value, not 9999.
#   - assert FIRST-TURN null delta: rt.tokenBaseline = null → appended[0].data.deltaTokens === null AND
#     grewOverThreshold === false; AND rt.tokenBaseline is now set to `now` (rolled forward).
#   - assert NEGATIVE delta: rt.tokenBaseline = 5000; lastFiltered giving now=2000 → delta = -3000 →
#     grewOverThreshold === false.
# Expected: all domain validations pass.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (Level 1 — the type+style gate; no lint tool exists).
- [ ] `npx vitest run test/turn_metric.test.ts` passes (Level 2).
- [ ] `npx vitest run` is all-green, no regression (Level 2).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] `registerTurnEndMetric` registers exactly one `turn_end` handler; it delegates to `turnEndMetricHandler(pi, event, ctx)`.
- [ ] First turn (baseline null): metric `deltaTokens: null`, `grewOverThreshold: false`; baseline rolled forward.
- [ ] Normal growth (delta > threshold): metric `grewOverThreshold: true`.
- [ ] Bloat snapshot + clear: metric carries the pre-set hits; `rt.pendingBloatHits === []` after.
- [ ] `lastFiltered` present ⟹ `now` from `estimateTokens` (filtered view); null ⟹ `getContextUsage` fallback.
- [ ] Negative delta ⟹ `grewOverThreshold: false`.
- [ ] NO double-increment: handler does not call nextSeq; persisted seq increments by exactly 1 per turn.
- [ ] Fail-open: every throwing dependency → void + unchanged baseline/accumulator + `log("error","nudge.turn_end",sessionId,...)`.
- [ ] `log` called with `sessionId` (string), never `ctx`.

### Code Quality Validation

- [ ] APPENDED to src/nudges.ts; bloatReminderHandler + registerBloatReminder (P1.M6.T1.S1) UNCHANGED.
- [ ] File placement matches the desired tree (`src/nudges.ts` appended; `test/turn_metric.test.ts` new).
- [ ] Anti-patterns avoided: does NOT call nextSeq; does NOT add seq/ts/schema/v/kind to the metric; does NOT
      cast estimateTokens(rt.lastFiltered); does NOT pass ctx to log; does NOT clear pendingBloatHits before
      snapshotting; does NOT roll the baseline in the catch path; does NOT touch test/nudges.test.ts.
- [ ] Dependencies properly managed: type-only imports for TurnEndEvent + TurnMetricInput; value imports for
      estimateTokens + appendTurnMetric; reused getConfig/getRuntime/log from P1.M6.T1.S1's import block.
- [ ] SYNC handler (no spurious async); ONE try/catch over the whole body; the closure captures pi cleanly.

### Documentation & Deployment

- [ ] Code is self-documenting (the module + function JSDoc blocks in the Blueprint state the spec refs, the
      fail-open guarantee, the pi-closure rationale, and each gotcha inline — copy them verbatim).
- [ ] No new environment variables (driftThresholdTokens is `config.nudges.driftThresholdTokens`, already in config.ts).
- [ ] Wiring into `index.ts` is DEFERRED to P1.M7.T1.S1 (this task only ships the registration function).

---

## Anti-Patterns to Avoid

- ❌ Don't call `nextSeq` or add `seq`/`ts`/schema/v/kind to the metric — `appendTurnMetric` stamps them (would
  double-increment + trip the excess-property check). Build a `TurnMetricInput` (5 fields only).
- ❌ Don't register `pi.on("turn_end", turnEndMetricHandler)` directly — the callback signature is `(event, ctx)`,
  not `(pi, event, ctx)`. Wrap in a closure that captures pi (GOTCHA #2).
- ❌ Don't cast `estimateTokens(rt.lastFiltered)` — `AgentMessage[]` is assignable to `MessageLike[]` (GOTCHA #3,
  verified by tsc). The filter.ts/audit.ts casts are for a different MessageLike.
- ❌ Don't clear `rt.pendingBloatHits` before snapshotting it into the metric — snapshot THEN clear (GOTCHA #9).
- ❌ Don't roll `rt.tokenBaseline` forward in the catch path — only the happy path rolls it (a throw leaves it
  untouched so the delta retries next turn; GOTCHA #7).
- ❌ Don't recreate `src/nudges.ts` or modify `bloatReminderHandler`/`registerBloatReminder` (P1.M6.T1.S1's
  exports) — APPEND only.
- ❌ Don't append to `test/nudges.test.ts` — create `test/turn_metric.test.ts` (P1.M6.T1.S1's fakes are unusable
  for this handler's write path; a separate file avoids a parallel-edit conflict).
- ❌ Don't pass `ctx` to `log()` — it takes `sessionId: string` (GOTCHA #4).
- ❌ Don't use `event.messages` (turn_end has no messages field) — use the cached `rt.lastFiltered` +
  `getContextUsage` fallback.