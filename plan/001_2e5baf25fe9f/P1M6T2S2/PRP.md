# PRP — P1.M6.T2.S2: Implement `shouldNudge`, `injectNudge`, `suppressCheck` for the context handler

**Work item:** P1.M6.T2.S2 · **Points:** 1 · **Stage:** Preventive Nudges (spec/07-preventive-and-nudges.md §2
"Nudge B — per-turn drift nudge", **Phase 2: inject at next `context` fire**; spec/06-context-filter.md §1/§12
nudge-injection gate; spec/03-architecture.md §6/h2.6 "Per-turn drift nudge"; spec/04-data-model.md §5 TurnMetric).
**Scope:** **APPEND three pure functions to `src/nudges.ts`** (`shouldNudge`, `injectNudge`, `suppressCheck` +
import augmentations + the `NUDGE_TURN_WINDOW_MS` constant), **MODIFY `src/filter.ts`** (delete the local nudge
stubs, import the three functions from `nudges.js`, add `suppressCheck` to the gate), **MODIFY `test/filter.test.ts`**
(remove the now-stale stub import + delete the no-op-stub describe block + replace the stub no-op integration test
with real-behavior tests), and **CREATE one new test file** `test/drift_nudge.test.ts`. **No other file is touched.**

This is **Nudge B Phase 2** — the injection half of Mulligan's per-turn drift nudge. Phase 1 (P1.M6.T2.S1, COMPLETE)
persists a `mulligan:turn-metric` CustomEntry at `turn_end`. Phase 2 (THIS task) READS the latest metric inside the
`context` handler and, when the previous turn grew context over threshold OR hit bloat, injects a one-line
annotation as an EPHEMERAL `mulligan:nudge` CustomMessage appended to the in-flight message copy — **zero extra
model requests** (spec/03 design principle #3/#4; spec/07 §2 "Why this is zero-extra-requests"). The nudge is
suppressed when the agent already acted that turn (a rewind/shrink marker within the turn's time window).

> **PARALLEL-PREDECESSOR CONTRACT:** `src/nudges.ts` was CREATED by **P1.M6.T1.S1** and APPENDED by **P1.M6.T2.S1**
> (both COMPLETE — verified live: the file ships `bloatReminderHandler`, `registerBloatReminder`,
> `turnEndMetricHandler`, `registerTurnEndMetric`). Its import block + the four existing exports are the merge base
> (reproduced verbatim below). If `src/nudges.ts` does NOT contain `turnEndMetricHandler`/`registerTurnEndMetric`,
> STOP — P1.M6.T2.S1 has not landed; this task builds on its output.

> **PREREQUISITE (verified live during research):** every symbol this task consumes is ALREADY SHIPPED.
> `renderDriftNudge` + `DriftNudgeInput` (src/notes.ts — P1.M2.T3.S3 ✅, and a real `TurnMetric` is STRUCTURALLY
> ASSIGNABLE to `DriftNudgeInput` — NO cast), `TurnMetric` / `RewindMarker` / `ShrinkMarker` types (src/markers.ts
> — P1.M4.T1.S1 ✅), `MessageLike` (src/transforms.ts — P1.M3.T1.S1 ✅), `MulliganConfig` (src/config.ts — P1.M1.T2
> ✅). The filter.ts gate + stubs (P1.M4.T2.S1 ✅) are the integration point. **Baseline: `npx tsc --noEmit` exit 0;
> `npx vitest run` → 15 files / 592 tests green.**

---

## Goal

**Feature Goal**: Ship Nudge B Phase 2 — three **PURE, Pi-free** functions (`shouldNudge`, `injectNudge`,
`suppressCheck`) in `src/nudges.ts`, and WIRE them into `src/filter.ts`'s `context` handler so that, on every
`context` fire, when `config.nudges.perTurnDrift` is on and the latest `mulligan:turn-metric` says the previous
turn grew over threshold OR hit bloat, a one-line drift annotation is appended to the in-flight message copy as a
non-persisted `mulligan:nudge` CustomMessage — UNLESS the agent already acted that turn (a rewind/shrink marker
within the turn's time window). Rides the inference that was already happening → **zero extra requests**
(spec/03 #3). ~25–40 tokens when it fires, zero otherwise.

**Deliverable** (APPEND to `src/nudges.ts`; MODIFY `src/filter.ts`; MODIFY `test/filter.test.ts`; CREATE
`test/drift_nudge.test.ts`):
1. **`src/nudges.ts`** — APPEND three named exports (the four existing exports stay untouched):
   - `export function shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean` —
     `metric.grewOverThreshold === true || metric.bloatHit === true`. Pure. (`_config` is the spec signature's
     second arg, unused in v1 — the drift threshold was already applied at turn_end when `grewOverThreshold` was
     computed; mirrors the `renderBloatReminder(_toolName, …)` / `estimateTokens(_, _model?)` convention.)
   - `export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[]` —
     `const line = renderDriftNudge(metric); const nudge: MessageLike = { role:"custom",
     customType:"mulligan:nudge", content: line, display:false, details:{ephemeral:true, turnIndex:metric.turnIndex},
     timestamp: Date.now() }; return [...messages, nudge];`. Pure; NEVER calls `pi.sendMessage`.
   - `export function suppressCheck(metric: TurnMetric, markers: { rewinds: ReadonlyArray<RewindMarker>;
     shrinks: ReadonlyArray<ShrinkMarker> }): boolean` — `true` (suppress) iff ANY rewind/shrink marker has a
     finite `ts` in the half-open window `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`.
   - `export const NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000;` (10 min) — the heuristic window; exported so tests can
     reference the boundary. Plus import augmentations (see Task 1).
2. **`src/filter.ts`** — DELETE the local `shouldNudge` + `injectNudge` stubs (their JSDoc + the
   `// ── Nudge stubs` section header); ADD `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`;
   REMOVE the now-unused `import type { MulliganConfig } from "./config.js";` line; ADD `&& !suppressCheck(markers.metric, markers)`
   to the nudge gate. (`MessageLike` import STAYS — still used by `filterPipeline` call.)
3. **`test/filter.test.ts`** — REMOVE `shouldNudge, injectNudge` from the `../src/filter.js` import (keep
   `readMarkers, contextHandler, registerFilterHandler, type MarkersBundle`); DELETE the
   `describe("shouldNudge / injectNudge — no-op stubs …")` block; REPLACE the
   `it("does NOT inject the nudge (stub no-op) …")` test with three real-behavior tests (injects when
   shouldNudge true + not suppressed; does NOT inject when suppressed; does NOT inject when shouldNudge false).
4. **`test/drift_nudge.test.ts`** — NEW file: pure unit tests for `shouldNudge` / `injectNudge` / `suppressCheck`
   (NO Pi fakes needed — these are pure functions). Covers every success-criteria bullet.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**. (Key type-checks: the nudge object literal assigns to
  `MessageLike` via its index signature — no cast; `renderDriftNudge(metric)` takes a `TurnMetric` with no cast;
  `suppressCheck(markers.metric, markers)` — MarkersBundle is structurally assignable to suppressCheck's
  `{rewinds, shrinks}` param; `shouldNudge`'s `=== true` yields `boolean`.)
- `npx vitest run test/drift_nudge.test.ts` → all drift_nudge tests pass.
- `npx vitest run` → **all-green, no regression** (the filter.test.ts edits keep that file green; nothing else
  changes).
- **`shouldNudge`** returns `true` iff `grewOverThreshold || bloatHit`; returns a real `boolean` for a malformed
  metric (no `undefined`).
- **`injectNudge`** appends EXACTLY ONE `mulligan:nudge` message to the END (`result.length === messages.length + 1`;
  last element has `role:"custom"`, `customType:"mulligan:nudge"`, `display:false`,
  `details:{ephemeral:true, turnIndex:<metric.turnIndex>}`, a string `content`, a number `timestamp`); returns a
  NEW array (does not mutate `messages`); NEVER calls `pi.sendMessage`.
- **`suppressCheck`** returns `true` when a rewind OR shrink marker has `ts` within
  `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`; `false` when there are no markers, when all marker ts are older
  than the window, or when marker ts are `> metric.ts`.
- **The `context` gate** injects the nudge ONLY when `perTurnDrift && metric && shouldNudge && !suppressCheck`.
- **Ephemeral / non-stacking**: the nudge is recomputed from the latest metric each `context` fire and lives only
  in the returned copy (never persisted; the fresh deep copy from Pi each fire means it never stacks).

---

## User Persona

**Target User**: The **agent itself** (design principle #5 — "the agent is the user"). The `context` handler is the
sole consumer of these three functions at runtime; `index.ts` (P1.M7.T1.S1) wires `registerFilterHandler` which
arms `contextHandler`. Secondary consumers: **tests** (the functions are pure + exported → directly unit-testable
with no Pi runtime) and **mulligan_audit** (reads `rt.lastFiltered`, which now includes any injected nudge).

**Use Case**: A turn runs 4 large `read` calls + a long assistant response; the filtered context grew from 8.0k →
12.5k tokens (delta +4.5k > `driftThresholdTokens` 3000). At `turn_end`, Phase 1 persisted a metric with
`grewOverThreshold: true`. On the **next** `context` fire, Phase 2 (this task) reads that metric, `shouldNudge`
returns true, `suppressCheck` returns false (no rewind/shrink this turn), and `injectNudge` appends:
`[mulligan] Previous turn added ~4.5k tokens to your context.\nIf that growth was wasteful, consider …`. The agent
sees the annotation on the inference it was already making — **zero extra requests** — and can choose to
`mulligan_rewind`/`mulligan_shrink`/`mulligan_audit`.

**User Journey**:
1. `index.ts` factory (P1.M7.T1.S1): `registerFilterHandler(pi)` → `pi.on("context", contextHandler)`.
2. Each `context` fire → `contextHandler`: `readMarkers(ctx)` returns `{rewinds, shrinks, metric}` (metric = latest).
3. After `filterPipeline`, the gate evaluates: `perTurnDrift && metric && shouldNudge(metric, config) &&
   !suppressCheck(metric, markers)`. If true → `messages = injectNudge(messages, metric)` (append the ephemeral
   `mulligan:nudge` CustomMessage).
4. The returned `{ messages }` (with the nudge appended) is what the model sees THIS inference. Pi persists the
   ORIGINAL branch untouched (the nudge never reaches the session — `injectNudge` never calls `pi.sendMessage`).

**Pain Points Addressed**: (a) Context drift is invisible to the agent — it never learns a turn blew up context by
4.5k tokens, so it never realizes a rewind/shrink would help. (b) A per-turn nudge that costs a model call would
be self-defeating (spec/03 #3). Riding the `context` event makes it genuinely free. (c) Nagging after the agent
already acted (it just rewound/shrunk) is counterproductive → `suppressCheck` skips the nudge when a marker was
created during the reported turn.

---

## Why

- **This is the project's signature "free ride" nudge, Phase 2 (spec/03 #3; spec/07 §2).** The injection mutates
  ONLY the in-flight copy; the inference was happening regardless. The nudge CustomMessage is constructed INLINE in
  the filter and NEVER appended to the session (`pi.sendMessage` is NOT called) — so it does not accumulate.
  Shipping Phase 2 completes the thesis that a per-turn nudge need not cost a request.
- **`shouldNudge` is the cheap gate (spec/07 §2).** `metric.grewOverThreshold || metric.bloatHit`. Both fields are
  already computed by Phase 1 at `turn_end` — no recomputation, no tokenization, no Pi call. Pure boolean.
- **`suppressCheck` avoids nagging (spec/07 §2 edge cases).** When the agent already acted (a `mulligan:rewind` or
  `mulligan:shrink` marker was created during the metric's turn), the drift was likely already addressed → skip the
  nudge. Best-effort time-window heuristic (the spec's chosen "Simple heuristic: marker ts within the turn's time
  window") — see GOTCHA #7 for the exact resolution.
- **`injectNudge` is the text + transport (spec/07 §2; renderDriftNudge from P1.M2.T3.S3).** It composes the
  one-line annotation via the already-shipped `renderDriftNudge` (which handles `deltaTokens===null` first-turn and
  bloat-only cases) and appends it as a `display:false` CustomMessage — agent-facing, not UI-prominent.
- **Fail-open is inherited, not duplicated (spec/03 #4, spec/08 E13).** These three functions are PURE helpers
  (spec/07 §3 lists `shouldNudge` alongside `renderDriftNudge` as a pure helper). They are CALLED inside
  `contextHandler`'s existing try/catch — a throw here is already caught by the handler's fail-open. The functions
  themselves are defensive (no throws on malformed input) but do not need their own try/catch.

---

## What

APPEND to `src/nudges.ts`, MODIFY `src/filter.ts`, MODIFY `test/filter.test.ts`, CREATE `test/drift_nudge.test.ts`.

### `shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean` (pure)
`return metric.grewOverThreshold === true || metric.bloatHit === true;`
- `=== true` so a malformed metric (readMarkers casts raw session data → a field could be `undefined`) yields a real
  `boolean`, never `undefined` (satisfies the `: boolean` return; defensive).
- `_config` is accepted (the spec/contract signature is `shouldNudge(metric, config)`) but UNUSED in v1 — name it
  `_config` (the established convention for accepted-but-unused params: `renderBloatReminder(_toolName, …)`,
  `estimateTokens(messages, _model?)`).

### `injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[]` (pure; NEVER calls pi.sendMessage)
```ts
const line = renderDriftNudge(metric);                       // TurnMetric → DriftNudgeInput, no cast
const nudge: MessageLike = {
  role: "custom",
  customType: "mulligan:nudge",
  content: line,                                              // string → MessageLike.content (string|ContentBlock[])
  display: false,
  details: { ephemeral: true, turnIndex: metric.turnIndex },  // spec/07 §2 exact shape
  timestamp: Date.now(),
};
return [...messages, nudge];                                  // NEW array; append to END; do NOT mutate messages
```
- `messages` is `MessageLike[]` (transforms.ts) — NOT `AgentMessage[]` — because the filter.ts call site is
  `messages = injectNudge(messages, markers.metric)` where `messages` is `MessageLike[]` (GOTCHA #3). The
  contract/spec say `AgentMessage[]` (semantic intent); the ACTUAL type at the call site is `MessageLike`. Using
  `AgentMessage[]` would fail the assignment type-check.
- The nudge object literal assigns to `MessageLike` with NO cast: `MessageLike` has an index signature
  `[key: string]: unknown` so `customType`/`display`/`details`/`timestamp` ride it; `role:"custom"`→`string`;
  `content: line`→`string|ContentBlock[]` (GOTCHA #4).
- `renderDriftNudge(metric)` takes the `TurnMetric` with NO cast — a real `TurnMetric` is structurally assignable
  to `DriftNudgeInput` (GOTCHA #5).

### `suppressCheck(metric: TurnMetric, markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> }): boolean` (pure)
- Compute `metricTs` = `metric.ts` if it is a finite number, else `0`. Compute `lo = metricTs − NUDGE_TURN_WINDOW_MS`.
- For each marker in `markers.rewinds` then `markers.shrinks`: if its `ts` is a finite number AND `ts > lo` AND
  `ts <= metricTs` → return `true` (suppress). Else continue.
- Return `false` (no marker in window → do not suppress).
- The `markers` param is a STRUCTURAL type — do NOT import `MarkersBundle` from filter.ts (would be circular:
  filter.ts imports these functions from nudges.ts). filter.ts's `MarkersBundle` is structurally assignable
  (GOTCHA #6).

### `export const NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000;` (10 minutes)
- The heuristic window for `suppressCheck`. EXPORTED so tests can reference the boundary. Documented as a tunable
  best-effort heuristic (not config in v1 — config.ts is frozen by sibling PRPs; spec/07 §2 calls suppress a
  "Simple heuristic"). See GOTCHA #7 for why a window (not a pure upper bound) is required.

### `src/filter.ts` changes
- DELETE the entire `// ── Nudge stubs (P1.M6.T2.S2 replaces these …)` section: the section-header comment, the
  `shouldNudge` JSDoc + function, and the `injectNudge` JSDoc + function.
- ADD (with the other `./` imports): `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`
- REMOVE the now-unused `import type { MulliganConfig } from "./config.js";` line (it was used ONLY by the
  shouldNudge stub). Keep `import { getConfig } from "./config.js";` (still used). Keep
  `import type { MessageLike, BranchEntry } from "./transforms.js";` (MessageLike still used by filterPipeline call).
- UPDATE the gate (contextHandler body) from:
  ```ts
  if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
    messages = injectNudge(messages, markers.metric);
  }
  ```
  to:
  ```ts
  if (
    config.nudges.perTurnDrift &&
    markers.metric &&
    shouldNudge(markers.metric, config) &&
    !suppressCheck(markers.metric, markers)
  ) {
    messages = injectNudge(messages, markers.metric);
  }
  ```
  (spec/06 §1/§12 pseudocode predates the suppress refinement; spec/07 §2 "Edge cases" is authoritative — GOTCHA #1.)

### `test/filter.test.ts` changes
- In the `../src/filter.js` import: REMOVE `shouldNudge` and `injectNudge` (filter.js no longer exports them). Keep
  `readMarkers, contextHandler, registerFilterHandler, type MarkersBundle`.
- DELETE the `describe("shouldNudge / injectNudge — no-op stubs (wired in P1.M6.T2.S2)", …)` block (its assertions
  are now wrong; the real unit tests live in `test/drift_nudge.test.ts`).
- REPLACE `it("does NOT inject the nudge (stub no-op) …", …)` with three real-behavior tests inside the
  `contextHandler` describe block:
  - `it("injects the drift nudge when shouldNudge(metric) is true and not suppressed", …)` — entries =
    `[customEntry("mulligan:turn-metric", metricData(1, true))]` (grewOverThreshold true; no markers → not
    suppressed); `pipelineReturn = [{ role:"user", content:"P" }]`; assert `result.messages` has length 2 and the
    last element is the `mulligan:nudge` custom message (customType, display:false, a string content).
  - `it("does NOT inject the drift nudge when suppressed by a same-turn rewind marker", …)` — entries =
    `[customEntry("mulligan:turn-metric", metricData(1, true)), customEntry("mulligan:rewind", rewindData(2))]`
    BUT give BOTH a recent matching ts (the helpers hardcode ts=1; build inline payloads with `ts: Date.now()` OR
    note that ts=1 for both → 1 is within `(1 − window, 1]` → suppressed — simplest: keep helpers as-is, both ts=1
    → suppressed); assert `result.messages` length 1 (no nudge).
  - `it("does NOT inject the drift nudge when shouldNudge is false (no growth, no bloat)", …)` — entries =
    `[customEntry("mulligan:turn-metric", metricData(1, false, false))]`; assert `result.messages` length 1.

This subtask does **NOT**: implement Phase 1 (the `turn_end` metric handler — P1.M6.T2.S1, COMPLETE); call
`pi.sendMessage` (the nudge is ephemeral); persist the nudge to the session; modify `bloatReminderHandler` /
`registerBloatReminder` / `turnEndMetricHandler` / `registerTurnEndMetric` (untouched); modify `config.ts`
(NUDGE_TURN_WINDOW_MS is a nudges.ts constant, not config); add suppress logic to spec/06 (it's a spec/07 §2
edge case — the PRP encodes it in code); wire anything into `index.ts` (P1.M7.T1.S1); or touch any other existing
file beyond filter.ts + filter.test.ts.

### Success Criteria

- [ ] `src/nudges.ts` EXPORTS `shouldNudge`, `injectNudge`, `suppressCheck`, `NUDGE_TURN_WINDOW_MS` (and STILL
      exports the four P1.M6.T1.S1/P1.M6.T2.S1 functions — untouched).
- [ ] `src/filter.ts` NO LONGER defines `shouldNudge`/`injectNudge`; it IMPORTS `shouldNudge`, `injectNudge`,
      `suppressCheck` from `./nudges.js`; the gate includes `&& !suppressCheck(markers.metric, markers)`; the
      unused `MulliganConfig` type import is removed.
- [ ] `test/drift_nudge.test.ts` EXISTS and is all-green; `test/filter.test.ts` is all-green (edited); `npx vitest
      run` is all-green (no regression — still 592+ tests, more added).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **`shouldNudge`**: `true` when `grewOverThreshold`; `true` when `bloatHit` (even if grew false); `false`
      when both false; returns a real `boolean` for a malformed metric.
- [ ] **`injectNudge`**: appends EXACTLY ONE `mulligan:nudge` to the END; returns a NEW array (does not mutate
      `messages`); the nudge has `role:"custom"`, `customType:"mulligan:nudge"`, `display:false`,
      `details:{ephemeral:true, turnIndex:<metric.turnIndex>}`, a string `content`, a number `timestamp`.
- [ ] **`suppressCheck`**: `true` when a rewind OR shrink marker ts is within `(metric.ts − window, metric.ts]`;
      `false` when no markers / all older than window / marker ts `> metric.ts`.
- [ ] **`context` gate** injects iff `perTurnDrift && metric && shouldNudge && !suppressCheck` (verified via the
      three filter.test.ts integration tests).
- [ ] **Ephemeral**: `injectNudge` never references `pi`; the nudge is recomputed each fire (never stacks).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code to APPEND to `src/nudges.ts` (imports + three functions + constant) is
> given verbatim in the Implementation Blueprint (Task 1). The exact edits to `src/filter.ts` (delete stubs, add
> import, remove dead import, update gate) are given verbatim (Task 2). The exact edits to `test/filter.test.ts`
> (remove import names, delete describe block, replace integration test) are specified with the existing helpers
> named (Task 3). The full content of `test/drift_nudge.test.ts` is given verbatim (Task 4). Every type
> (`MessageLike` index signature, `DriftNudgeInput` assignability, `MarkersBundle` structural assignability to
> suppressCheck's param) is quoted from the VERIFIED shipped code. The seven critical gotchas (suppress-window
> necessity, MessageLike-not-AgentMessage, no-cast renderDriftNudge, the index-signature assignment, the structural
> markers param to avoid a circular import, the `_config` convention, no-lint-tool) are called out with exact
> workarounds. No prior knowledge beyond "append three pure functions + rewire the filter gate + fix the three
> stale stub-tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/nudges.ts` (it ALREADY EXISTS, shipping 4 exports).** Do NOT recreate it. Do NOT modify the
  four existing exports. Confirm it landed: `grep -n "registerTurnEndMetric\|export function turnEndMetricHandler"
  src/nudges.ts` MUST print both; if absent, STOP (P1.M6.T2.S1 regressed / not landed).
- **EXACT pre-state of `src/nudges.ts`** (verified live): the import block (top of file) is:
  ```ts
  import type { ToolResultEvent, ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
  import { getConfig } from "./config.js";
  import { getRuntime } from "./runtime.js";
  import { log } from "./log.js";
  import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";
  import type { ResultContentBlock } from "./tokens.js";
  import { renderBloatReminder } from "./notes.js";
  import { appendTurnMetric, type TurnMetricInput } from "./markers.js";
  ```
  followed (in order) by `bloatReminderHandler`, `registerBloatReminder`, `turnEndMetricHandler`,
  `registerTurnEndMetric`. This task APPENDS below `registerTurnEndMetric`.
- **This task's import augmentations** (merge into the existing block; do NOT duplicate lines):
  - `import type { MulliganConfig } from "./config.js";` — NEW line (shouldNudge param).
  - Merge `renderDriftNudge` into the notes import → `import { renderBloatReminder, renderDriftNudge } from "./notes.js";`
  - `import type { MessageLike } from "./transforms.js";` — NEW line (injectNudge param + return). transforms.ts is
    Pi-free (0 imports) → no cycle.
  - Merge into the markers import → `import { appendTurnMetric, type TurnMetricInput, type TurnMetric, type RewindMarker, type ShrinkMarker } from "./markers.js";`
- **MODIFY `src/filter.ts`**: delete the two stubs + their section header; add the nudges import; remove the dead
  `MulliganConfig` type import; add `&& !suppressCheck(...)` to the gate.
- **MODIFY `test/filter.test.ts`**: 3 edits (remove 2 import names; delete 1 describe block; replace 1 integration
  test with 3). See Task 3.
- **CREATE `test/drift_nudge.test.ts`** (NEW file; do NOT append to nudges.test.ts / turn_metric.test.ts). These
  are PURE functions — no Pi fakes, no clearAll, no setConfig needed.
- **ALL upstream deps are SHIPPED (verified).** `grep -n "export function renderDriftNudge\|export interface DriftNudgeInput" src/notes.ts`,
  `grep -n "export interface TurnMetric\|export interface RewindMarker\|export interface ShrinkMarker" src/markers.ts`,
  `grep -n "export interface MessageLike" src/transforms.ts`, `grep -n "export interface MulliganConfig" src/config.ts`
  — every one MUST print a match. If any is absent, STOP.
- **There is NO lint/format tool** (devDeps = typescript + vitest + @types/node only). The type+style gate is
  `tsc --noEmit` (TS strict IS the gate). Test imports use `"../src/nudges.js"` (.js resolves to .ts under Bundler).

### Documentation & References

```yaml
# MUST READ — the authoritative nudge contract (Phase 2 mechanism, the nudge CustomMessage shape, the suppress edge case)
- file: spec/07-preventive-and-nudges.md
  section: "§2 Nudge B — per-turn drift nudge (turn_end → context injection): 'Phase 2: inject at next context fire'
            pseudocode (injectNudge + the exact CustomMessage {role:'custom', customType:'mulligan:nudge', content,
            display:false, details:{ephemeral:true, turnIndex}, timestamp}); 'Why this is zero-extra-requests' (the
            nudge is constructed in the filter and NEVER appended to the session — pi.sendMessage NOT called);
            'Cost' (~25-40 tokens when it fires, zero otherwise); 'Edge cases' (negative delta → grewOverThreshold
            false; suppress if a mulligan:rewind/mulligan:shrink marker was created during the metric's turn —
            'Simple heuristic: if any marker ts is within the turn time window')."
  why: "§2 Phase 2 IS this task. injectNudge's exact CustomMessage shape, the shouldNudge rule
        (metric.grewOverThreshold || metric.bloatHit), and the suppress heuristic are all pinned here."
  critical: "§2 Phase 2 pseudocode types injectNudge as AgentMessage[] and calls renderDriftNudge — but in OUR
            codebase the filter's in-flight copy is MessageLike[] (transforms.ts), so injectNudge MUST use
            MessageLike[] (GOTCHA #3). §2 suppress pseudocode compares 'metric.seq range to marker seqs' OR 'marker
            ts within the turn time window' — neither alone bounds the turn without the PREVIOUS metric (readMarkers
            keeps only the latest); see GOTCHA #7 for the window resolution. §2 renderDriftNudge is ALREADY shipped
            in notes.ts (P1.M2.T3.S3) — do NOT reimplement it."

# MUST READ — the context-handler gate this task rewires
- file: spec/06-context-filter.md
  section: "§1 step 3 'nudge injection' (`if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) { messages = injectNudge(messages, markers.metric); }`)
            + §12 (same gate). 'injectNudge and shouldNudge are specified in @07'."
  why: "§1/§12 IS the gate this task rewires. NOTE: spec/06's pseudocode predates the suppress refinement — it has
        NO suppressCheck. The suppress is a spec/07 §2 edge-case addition; this task ADDS `&& !suppressCheck(...)`."
  critical: "spec/06 types messages as AgentMessage[]; our filterPipeline returns MessageLike[] (transforms.ts) and
            the cast to AgentMessage[] happens at the RETURN boundary of contextHandler — so injectNudge operates on
            MessageLike[] (GOTCHA #3). Follow the verified filter.ts call site, not the spec pseudocode types."

# MUST READ — design principles these functions embody
- file: spec/03-architecture.md
  section: "§3 design principle #3 (zero extra requests — the nudge rides the context event), #4 (fail open — the
        functions are pure helpers called inside contextHandler's existing try/catch), #5 (the agent is the user —
        the nudge is agent-facing text), #6 (honest bookkeeping — grewOverThreshold was computed from the FILTERED
        view at turn_end); §6/h2.6 'Per-turn drift nudge'."
  why: "#3 is WHY the nudge rides context (no model call). #4 is WHY the pure functions need no own try/catch
        (contextHandler already wraps them). §6/h2.6 is the plain-language summary of this nudge."

# MUST READ — the TurnMetric schema these functions read
- file: spec/04-data-model.md
  section: "§5 TurnMetric (kind:'turn-metric', seq, ts, deltaTokens: number|null, bloatHit, bloatHits[],
        grewOverThreshold, turnIndex; 'only the LATEST one is consulted by the filter')."
  why: "§5 IS the type shouldNudge/injectNudge/suppressCheck read. grewOverThreshold + bloatHit drive shouldNudge;
        turnIndex goes into the nudge details; ts drives the suppress window; seq is NOT used by the ts heuristic."

# THE COMPLETE helpers these functions consume (all shipped — treat as contracts)
- file: src/notes.ts
  section: "renderDriftNudge(metric: DriftNudgeInput): string — pure; handles deltaTokens===null (first turn →
        bloat-only) and bloat-only; returns 3 lines. DriftNudgeInput = { deltaTokens: number|null; bloatHits:
        ReadonlyArray<{toolName, approxTokens}> }. A real TurnMetric is STRUCTURALLY ASSIGNABLE to DriftNudgeInput
        (NO cast — the notes.ts JSDoc says so)."
  why: "injectNudge calls renderDriftNudge(metric)."

- file: src/transforms.ts
  section: "export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown; }
        (line 53) — has an INDEX SIGNATURE, so a custom-message object literal assigns in with no cast."
  why: "injectNudge's param + return type. The index signature is WHY the nudge CustomMessage object type-checks
        (GOTCHA #4). transforms.ts is Pi-free (0 imports) → importing MessageLike type-only into nudges.ts is safe."

- file: src/markers.ts
  section: "export interface TurnMetric extends MulliganEnvelope { kind:'turn-metric'; seq; ts; deltaTokens:
        number|null; bloatHit; bloatHits[]; grewOverThreshold; turnIndex; } + RewindMarker { …; seq; ts; } +
        ShrinkMarker { …; seq; ts; }."
  why: "The types shouldNudge/injectNudge/suppressCheck read. markers.ts does NOT import nudges.ts → no cycle."

- file: src/filter.ts
  section: "contextHandler gate (~line 289): `if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) { messages = injectNudge(messages, markers.metric); }`;
        the LOCAL shouldNudge/injectNudge stubs (~lines 159-178) to DELETE; `import type { MulliganConfig }`
        (line 47) to REMOVE; MarkersBundle = { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric|null }."
  why: "The integration point. `markers` (MarkersBundle) is in scope at the gate; pass it to suppressCheck. The
        stubs' JSDocs literally say 'P1.M6.T2.S2 will delete this stub and import { shouldNudge } from ./nudges.js'."

# SIBLING PRPs — the predecessors that CREATE/APPEND to src/nudges.ts (the merge base)
- file: plan/001_2e5baf25fe9f/P1M6T1S1/PRP.md
  section: "'Implementation Patterns' — bloatReminderHandler + registerBloatReminder (untouched by this task)."
- file: plan/001_2e5baf25fe9f/P1M6T2S1/PRP.md
  section: "'Implementation Patterns' — turnEndMetricHandler + registerTurnEndMetric (the Phase 1 that WRITES the
        metric this task READS). 'DOWNSTREAM CONSUMER: P1.M6.T2.S2 shouldNudge/injectNudge inject a drift annotation
        when metric.grewOverThreshold || metric.bloatHit.'"
  why: "Confirms the metric fields Phase 2 reads. NOTE: the P1M6T2S1 PRP loosely says Phase 2 'does NOT live in
        this module [nudges.ts]' — but the SHIPPED filter.ts stub JSDocs (the authoritative contract) say
        'import { shouldNudge } from ./nudges.js'. filter.ts wins (GOTCHA #2)."

# SIBLING PRP — the context handler that owns the gate (COMPLETE — the integration target)
- file: plan/001_2e5baf25fe9f/P1M4T2S1/PRP.md
  section: "contextHandler structure + readMarkers (keeps the LATEST metric by highest seq) + MarkersBundle."
  why: "filter.ts is COMPLETE per plan_status. This task rewires its nudge gate + deletes its stubs."

# VERIFIED RESEARCH NOTES (this task's own research/)
- file: plan/001_2e5baf25fe9f/P1M6T2S2/research/verified_findings.md
  section: "§1 merge base; §3 MessageLike-not-AgentMessage; §4 renderDriftNudge assignability; §6 structural markers
        param (no circular import); §7 the suppress-window resolution; §9 the filter.test.ts impact (3 edits)."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps
│                           #   typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test'].
├── src/
│   ├── index.ts            # no-op stub (registerFilterHandler wired in P1.M7.T1). DO NOT TOUCH.
│   ├── config.ts           # getConfig, MulliganConfig (DO NOT TOUCH — NUDGE_TURN_WINDOW_MS is a nudges.ts const).
│   ├── log.ts / runtime.ts # DO NOT TOUCH.
│   ├── tokens.ts / ledger.ts # DO NOT TOUCH.
│   ├── notes.ts            # renderDriftNudge + DriftNudgeInput (COMPLETE). DO NOT TOUCH.
│   ├── transforms.ts       # MessageLike (Pi-free, 0 imports) + filterPipeline (COMPLETE). DO NOT TOUCH.
│   ├── markers.ts          # TurnMetric / RewindMarker / ShrinkMarker + append* (COMPLETE). DO NOT TOUCH.
│   ├── filter.ts           # context handler (COMPLETE); has LOCAL shouldNudge/injectNudge STUBS. THIS TASK: delete
│   │                       #   stubs + import from nudges.js + add suppressCheck to the gate.
│   └── nudges.ts           # bloatReminderHandler + registerBloatReminder + turnEndMetricHandler + registerTurnEndMetric.
│                           #   THIS TASK APPENDS shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS.
├── test/
│   ├── *.test.ts (14 files)# config/filter/ledger/log/markers/notes/runtime/tokens/transforms + tools/* + nudges + turn_metric.
│   │                       #   Read-only EXCEPT filter.test.ts (THIS TASK edits it: 3 edits).
│   ├── filter.test.ts      # THIS TASK: remove stub imports + delete stub describe block + replace stub no-op test.
│   └── drift_nudge.test.ts # NEW — THIS TASK CREATES (pure-function unit tests; no Pi fakes).
└── spec/                   # 03 §3/§6 + 04 §5 + 06 §1/§12 + 07 §2 + 11 §2 Step7.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 15 files / 592 tests green.
# NOTE: NO eslint/prettier/biome. The type+style gate is `tsc --noEmit` (TS strict).
# NOTE: test imports use "../src/<name>.js" (.js resolves to .ts under Bundler) — established convention.
```

### Desired Codebase tree with files to be CREATED / MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   ├── nudges.ts           # MODIFIED (APPEND): + shouldNudge + injectNudge + suppressCheck + NUDGE_TURN_WINDOW_MS.
│   │                       #   Import augmentations: + MulliganConfig (config.js type), + renderDriftNudge (notes.js),
│   │                       #   + MessageLike (transforms.js type), + TurnMetric/RewindMarker/ShrinkMarker (markers.js type).
│   │                       #   The 4 existing exports UNCHANGED.
│   └── filter.ts           # MODIFIED: DELETE the shouldNudge/injectNudge stubs; ADD import from ./nudges.js;
│                           #   REMOVE dead MulliganConfig type import; ADD `&& !suppressCheck(markers.metric, markers)`.
└── test/
    ├── filter.test.ts      # MODIFIED: remove shouldNudge/injectNudge from the filter.js import; delete the
    │                       #   "no-op stubs" describe block; replace the "stub no-op" integration test with 3 real tests.
    └── drift_nudge.test.ts # NEW: pure unit tests for shouldNudge/injectNudge/suppressCheck (NO Pi fakes; NO clearAll/setConfig).
# No other files touched. test/nudges.test.ts + test/turn_metric.test.ts are LEFT ALONE.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — spec/06 §1/§12's gate pseudocode has NO suppressCheck; spec/07 §2 "Edge cases" ADDS it.
#   The suppress ("avoid nagging after the agent already acted") is a spec/07 §2 refinement. This task ADDS
#   `&& !suppressCheck(markers.metric, markers)` to the gate. Do NOT remove shouldNudge/injectNudge from the gate —
#   they stay; suppressCheck is ADDED as a 4th condition. `markers` (MarkersBundle) is already in scope at the gate.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — WHERE the functions live. The P1M6T2S1 PRP loosely said Phase 2 "does NOT live in this
#   module [nudges.ts]". But the SHIPPED filter.ts stub JSDocs (the authoritative, verified contract) say verbatim:
#   'P1.M6.T2.S2 will delete this stub and `import { shouldNudge } from "./nudges.js"`'. ⟹ shouldNudge/injectNudge/
#   suppressCheck LIVE IN src/nudges.ts and are IMPORTED into filter.ts. filter.ts wins (it is the shipped code).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — injectNudge uses MessageLike[] (transforms.ts), NOT AgentMessage[]. The spec/07 §2 + item
#   contract say AgentMessage[] (semantic intent), but the ACTUAL call site in filter.ts is
#   `messages = injectNudge(messages, markers.metric)` where `messages` is `MessageLike[]` (filterPipeline's return
#   type; the cast to AgentMessage[] happens at the RETURN boundary of contextHandler). If injectNudge returned
#   AgentMessage[] the assignment would NOT type-check. ⟹ `(messages: MessageLike[], metric: TurnMetric): MessageLike[]`.
#   MessageLike is imported type-only from ./transforms.js (Pi-free, 0 imports → no cycle).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — the nudge CustomMessage object literal assigns to MessageLike with NO cast. MessageLike
#   (transforms.ts line 53) = `{ role?: string; content?: string | ContentBlock[]; [key: string]: unknown; }`.
#   `role:"custom"` → string ✓; `content: line` (string) → string|ContentBlock[] ✓; customType/display/details/
#   timestamp ride the `[key: string]: unknown` index signature (each value assignable to unknown). NO `as` needed.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — `renderDriftNudge(metric)` takes a TurnMetric with NO cast. A real TurnMetric is STRUCTURALLY
#   ASSIGNABLE to DriftNudgeInput ({deltaTokens: number|null; bloatHits: ReadonlyArray<{toolName,approxTokens}>}) —
#   a mutable `bloatHits[]` widens to `ReadonlyArray` soundly. The notes.ts JSDoc confirms this. Do NOT add a cast.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — suppressCheck's `markers` param is a STRUCTURAL type; do NOT import MarkersBundle from
#   filter.ts. filter.ts imports shouldNudge/injectNudge/suppressCheck from nudges.ts → nudges.ts importing
#   MarkersBundle from filter.ts would be CIRCULAR. ⟹ type the param as `{ rewinds: ReadonlyArray<RewindMarker>;
#   shrinks: ReadonlyArray<ShrinkMarker> }` (RewindMarker/ShrinkMarker come from markers.ts — already imported).
#   filter.ts's `MarkersBundle { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric|null }` is
#   structurally assignable (array→ReadonlyArray; the extra `metric` field is ignored for assignability-to-param).
#   Call site: `suppressCheck(markers.metric, markers)`.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — the suppress heuristic NEEDS a time window, not a pure upper bound. At nudge-fire time
#   (start of turn N+1, reading turn N's latest metric), readMarkers returns the LATEST metric + ALL accumulated
#   markers. A turn-N marker AND a turn-(N-1) marker BOTH have `ts <= metric.ts` (the metric is the most-recently-
#   stamped entry; no turn-(N+1) markers exist yet at context-fire time) and `seq < metric.seq`. So a pure upper
#   bound (`ts <= metric.ts`) OVER-SUPPRESSES — after ONE rewind ever, the nudge would NEVER fire again. There is no
#   per-turn lower bound available without the PREVIOUS metric (readMarkers keeps only the latest).
#   RESOLUTION (spec/07 §2 "Simple heuristic"): suppress iff some marker.ts ∈ (metric.ts − NUDGE_TURN_WINDOW_MS,
#   metric.ts]. NUDGE_TURN_WINDOW_MS = 10*60*1000 (10 min) — a generous bound on a single agent turn's wall-clock
#   duration; EXPORTED so tests reference the boundary. Read ts defensively (`typeof === 'number' &&
#   Number.isFinite`); a bad ts → treated as NOT in window (no suppress). This is best-effort by design (spec/07 §2
#   frames suppress as a heuristic; the whole nudge subsystem is best-effort). RAPID back-to-back turns within 10 min
#   may over-suppress (a previous turn's rewind suppresses this turn's nudge) — acceptable for a best-effort nudge.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — shouldNudge's `config` arg is UNUSED in v1 → name it `_config`. The drift threshold was already
#   applied at turn_end when the metric's grewOverThreshold was computed (Phase 1). The spec/contract signature is
#   `shouldNudge(metric, config)` so config stays a param; `_config` is the established convention for accepted-but-
#   unused params (renderBloatReminder(_toolName, …), estimateTokens(messages, _model?)). Use `=== true` so a
#   malformed metric (readMarkers casts raw session data) yields a real boolean, never undefined.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — injectNudge NEVER calls pi.sendMessage. It is PURE: it returns `[...messages, nudge]` and the nudge
#   lives ONLY in the returned copy. Pi persists the ORIGINAL branch untouched. Each context fire gets a FRESH deep
#   copy from Pi → the nudge is recomputed from the latest metric each fire and REPLACES (never stacks with) the
#   previous one (there is nothing to stack — it was never persisted). No special de-stacking logic is needed.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — filter.ts's `import type { MulliganConfig } from "./config.js";` (line 47) is used ONLY by the
#   shouldNudge stub. After deleting the stub, REMOVE that import line (clean; tsconfig has no noUnusedLocals so it
#   won't error, but remove it). KEEP `import { getConfig } from "./config.js";` (still used). KEEP
#   `import type { MessageLike, BranchEntry } from "./transforms.js";` (MessageLike still used at the filterPipeline
#   call + the `messages` local; BranchEntry used at the filterPipeline call).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — test/filter.test.ts has THREE spots that assert the CURRENT stub no-op behavior and MUST change
#   (or they go red): (a) the `../src/filter.js` import lists `shouldNudge, injectNudge` — REMOVE them (filter.js
#   no longer exports them); (b) the `describe("shouldNudge / injectNudge — no-op stubs …")` block asserts
#   shouldNudge→false + injectNudge→unchanged — DELETE the block (real unit tests live in drift_nudge.test.ts);
#   (c) `it("does NOT inject the nudge (stub no-op) …")` uses metricData(1, true) (grewOverThreshold true) and
#   asserts NO injection — under real shouldNudge the nudge WILL fire → REPLACE with 3 real-behavior tests
#   (injects / suppressed / shouldNudge-false).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — there is NO lint/format tool (devDeps = typescript + vitest + @types/node). The "Level 1 syntax &
#   style" gate reduces to `tsc --noEmit` (TS strict IS the gate). Do NOT invent eslint/prettier/biome.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — drift_nudge.test.ts needs NO Pi fakes, NO clearAll, NO setConfig (the three functions are pure). It
#   just imports shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS from "../src/nudges.js" and constructs
#   metric/marker objects inline. This is the SIMPLEST test file in the suite. TurnMetric/RewindMarker/ShrinkMarker
#   objects can be built as partial literals cast `as TurnMetric` (etc.) — these are pure tests, not the Pi boundary.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

This task defines ONE new exported constant (`NUDGE_TURN_WINDOW_MS`) and NO new types. It reuses `TurnMetric`,
`RewindMarker`, `ShrinkMarker` (markers.ts — imported type-only), `MessageLike` (transforms.ts — type-only),
`MulliganConfig` (config.ts — type-only), and `DriftNudgeInput` (notes.ts — consumed implicitly via
`renderDriftNudge(metric)` structural assignability). suppressCheck's `markers` param is a STRUCTURAL inline type
(see GOTCHA #6).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES + BASELINE (no edits — run only)
  - RUN: grep -n "registerTurnEndMetric\|export function turnEndMetricHandler" src/nudges.ts   # BOTH must print
        (confirms P1.M6.T2.S1 landed — src/nudges.ts has the 4 exports). If absent, STOP.
  - RUN: grep -n "export function renderDriftNudge\|export interface DriftNudgeInput" src/notes.ts  # BOTH must print.
  - RUN: grep -n "export interface TurnMetric\|export interface RewindMarker\|export interface ShrinkMarker" src/markers.ts # all must print.
  - RUN: grep -n "export interface MessageLike" src/transforms.ts                                 # MUST print.
  - RUN: grep -n "export interface MulliganConfig" src/config.ts                                  # MUST print.
  - RUN: grep -n "export function shouldNudge\|export function injectNudge" src/filter.ts         # BOTH must print (the stubs to delete).
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 15 files / 592 tests green (baseline).

Task 1: APPEND to src/nudges.ts   (exact content below — copy verbatim into the existing file)
  - AUGMENT the import block (see Scope Decision for the pre-state):
      * ADD a NEW line: `import type { MulliganConfig } from "./config.js";`
      * MERGE renderDriftNudge into the notes import: `import { renderBloatReminder, renderDriftNudge } from "./notes.js";`
      * ADD a NEW line: `import type { MessageLike } from "./transforms.js";`
      * MERGE types into the markers import: `import { appendTurnMetric, type TurnMetricInput, type TurnMetric, type RewindMarker, type ShrinkMarker } from "./markers.js";`
  - APPEND (below registerTurnEndMetric): NUDGE_TURN_WINDOW_MS constant + shouldNudge + injectNudge + suppressCheck.
  - CONSTRAINTS:
      * shouldNudge: `return metric.grewOverThreshold === true || metric.bloatHit === true;` — `_config` param
        (unused in v1); `=== true` for boolean robustness.
      * injectNudge: `const line = renderDriftNudge(metric);` (NO cast); build `nudge: MessageLike` with EXACTLY
        { role:"custom", customType:"mulligan:nudge", content: line, display: false,
        details: { ephemeral: true, turnIndex: metric.turnIndex }, timestamp: Date.now() }; `return [...messages, nudge];`
        — NEW array; do NOT mutate messages; NEVER reference pi.
      * suppressCheck: metric param + `{ rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> }`
        param; metricTs = finite metric.ts else 0; lo = metricTs - NUDGE_TURN_WINDOW_MS; for rewinds then shrinks,
        if a finite marker.ts satisfies `ts > lo && ts <= metricTs` return true; else false.
      * NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000; EXPORTED.
  - NAMING/PLACEMENT: append to existing src/nudges.ts. NEW exports: shouldNudge, injectNudge, suppressCheck,
    NUDGE_TURN_WINDOW_MS. The 4 existing exports UNCHANGED.

Task 2: MODIFY src/filter.ts   (delete stubs + rewire gate)
  - DELETE the `// ── Nudge stubs (P1.M6.T2.S2 replaces these with real imports from nudges.ts) ────` section
    header + the shouldNudge JSDoc + the shouldNudge function + the injectNudge JSDoc + the injectNudge function.
  - ADD (with the other ./ imports): `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`
  - REMOVE the line: `import type { MulliganConfig } from "./config.js";` (now unused). KEEP getConfig import.
  - UPDATE the gate (in contextHandler) to add `&& !suppressCheck(markers.metric, markers)` as a 4th condition
    (keep perTurnDrift && markers.metric && shouldNudge(markers.metric, config)).
  - CONSTRAINTS: do NOT touch readMarkers, MarkersBundle, contextHandler's try/catch, registerFilterHandler, or
    any other part of filter.ts. MessageLike + BranchEntry imports STAY.

Task 3: MODIFY test/filter.test.ts   (3 edits — see GOTCHA #11)
  - EDIT the `../src/filter.js` import: remove `shouldNudge` and `injectNudge` (keep `readMarkers, contextHandler,
    registerFilterHandler, type MarkersBundle`).
  - DELETE the entire `describe("shouldNudge / injectNudge — no-op stubs (wired in P1.M6.T2.S2)", () => { … })`
    block (its 2 `it`s are now wrong).
  - REPLACE `it("does NOT inject the nudge (stub no-op) …", …)` with 3 real-behavior tests in the contextHandler
    describe block:
      (a) injects when shouldNudge true + not suppressed — entries=[customEntry("mulligan:turn-metric", metricData(1,true))];
          pipelineReturn=[{role:"user",content:"P"}]; assert result.messages length 2 + last is the mulligan:nudge.
      (b) does NOT inject when suppressed — entries=[customEntry("mulligan:turn-metric", metricData(1,true)),
          customEntry("mulligan:rewind", rewindData(2))] (BOTH ts=1 → 1 ∈ (1−window, 1] → suppressed); assert length 1.
      (c) does NOT inject when shouldNudge false — entries=[customEntry("mulligan:turn-metric", metricData(1,false,false))];
          assert length 1.
  - CONSTRAINTS: reuse the existing metricData/customEntry/rewindData/makeCtx/pipelineReturn helpers (do NOT modify
    them). Do NOT touch any other describe block.

Task 4: CREATE test/drift_nudge.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: pure unit tests for shouldNudge / injectNudge / suppressCheck / NUDGE_TURN_WINDOW_MS. NO Pi fakes,
    NO clearAll, NO setConfig. Import from "../src/nudges.js" + the TurnMetric/RewindMarker/ShrinkMarker types from
    "../src/markers.js" (build partial literals cast `as TurnMetric` etc. — these are pure tests).
  - DESCRIBE blocks:
      shouldNudge: true when grewOverThreshold; true when bloatHit (grew false); false when both false; returns a
        boolean for a malformed metric ({}).
      injectNudge: appends exactly ONE mulligan:nudge to the END (length +1; last element role/customType/display/
        details/content/timestamp correct); returns a NEW array (input unchanged); does not stack on repeated calls
        with a fresh input (call injectNudge on the ORIGINAL messages each time, not on its own output); content is a
        non-empty string (renderDriftNudge output).
      suppressCheck: true when a rewind marker ts ∈ (metric.ts − window, metric.ts]; true when a SHRINK marker in
        window; false when no markers; false when marker ts older than window (metric.ts − window − 1); false when
        marker ts > metric.ts; false when marker ts is non-finite (malformed).
  - COVERAGE: every success-criteria bullet has an assertion.

Task 5: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A for the unit suite. Level 4 = the suppress-window + append-to-
    END + ephemeral assertions.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — Nudge B Phase 2 (shouldNudge + injectNudge + suppressCheck). APPEND into the existing src/nudges.ts.
// IMPORT AUGMENTATIONS (merge into the existing import block — do NOT duplicate lines):
//   import type { ToolResultEvent, ExtensionAPI, ExtensionContext, TurnEndEvent } from "@earendil-works/pi-coding-agent";
//   import { getConfig } from "./config.js";
//   import type { MulliganConfig } from "./config.js";                                   // NEW (shouldNudge param)
//   import { getRuntime } from "./runtime.js";
//   import { log } from "./log.js";
//   import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";
//   import type { ResultContentBlock } from "./tokens.js";
//   import { renderBloatReminder, renderDriftNudge } from "./notes.js";                  // + renderDriftNudge
//   import { appendTurnMetric, type TurnMetricInput, type TurnMetric, type RewindMarker, type ShrinkMarker } from "./markers.js"; // + 3 types
//   import type { MessageLike } from "./transforms.js";                                   // NEW (injectNudge)

// ── bloatReminderHandler / registerBloatReminder / turnEndMetricHandler / registerTurnEndMetric
//    (P1.M6.T1.S1 + P1.M6.T2.S1) stay UNCHANGED above this point ──

/**
 * NUDGE_TURN_WINDOW_MS — the heuristic time window for suppressCheck (spec/07 §2 "Edge cases": suppress if a
 * rewind/shrink marker was created "during the metric's turn"). 10 minutes: a generous bound on a single agent
 * turn's wall-clock duration. A marker created during the turn that produced the metric falls inside
 * (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]; markers from earlier turns fall outside. EXPORTED so tests can
 * reference the exact boundary. Best-effort by design (spec/07 §2 frames suppress as a "Simple heuristic"; the
 * whole nudge subsystem is best-effort). NOT config in v1 (config.ts is frozen by sibling PRPs); a future
 * iteration may expose it as config.nudges.suppressWindowMs.
 */
export const NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * shouldNudge — Nudge B Phase 2 gate (spec/07 §2; spec/06 §1/§12). Pure boolean: fire the drift nudge iff the
 * latest turn-metric grew context over threshold OR recorded a bloated result. Both fields are computed by Phase 1
 * (turnEndMetricHandler, P1.M6.T2.S1) at turn_end from the FILTERED view (design principle #6) — no recomputation,
 * no tokenization, no Pi call here.
 *
 * The `_config` arg is the spec/contract signature's second parameter but is UNUSED in v1: the drift threshold was
 * already applied when the metric's grewOverThreshold was computed at turn_end. Named `_config` per the
 * accepted-but-unused convention (renderBloatReminder(_toolName, …); estimateTokens(messages, _model?)).
 *
 * `=== true` (not just truthy) so a malformed metric — readMarkers casts raw session data, so a field could be
 * undefined/non-boolean — yields a real `boolean` (never `undefined`), satisfying the `: boolean` return and
 * failing safe to "no nudge".
 *
 * @param metric  the latest mulligan:turn-metric (readMarkers keeps the highest-seq one; null is filtered by the
 *                caller's `markers.metric` check before this is called).
 * @param _config the MulliganConfig (ACCEPTED for signature parity; NOT used in v1).
 * @returns true iff metric.grewOverThreshold || metric.bloatHit.
 */
export function shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean {
  return metric.grewOverThreshold === true || metric.bloatHit === true;
}

/**
 * injectNudge — Nudge B Phase 2 injection (spec/07 §2 "Phase 2: inject at next context fire"). PURE: composes the
 * one-line annotation via the already-shipped renderDriftNudge (P1.M2.T3.S3 — handles deltaTokens===null first-turn
 * + bloat-only cases) and appends it as an EPHEMERAL mulligan:nudge CustomMessage to a NEW copy of messages. NEVER
 * calls pi.sendMessage — the nudge lives ONLY in the returned copy, which is what the model sees THIS inference; Pi
 * persists the ORIGINAL branch untouched. Each context fire gets a FRESH deep copy from Pi → the nudge is recomputed
 * from the latest metric each fire and REPLACES (never stacks with) the previous (nothing persists to stack).
 *
 * WHY MessageLike[] not AgentMessage[] (GOTCHA #3): the filter.ts call site is
 * `messages = injectNudge(messages, markers.metric)` where `messages` is MessageLike[] (filterPipeline's return;
 * the cast to Pi's AgentMessage[] happens at contextHandler's RETURN boundary). AgentMessage[] would not type-check
 * at the assignment. MessageLike (transforms.ts) has an index signature → the nudge object literal assigns in with
 * NO cast (GOTCHA #4). renderDriftNudge takes the TurnMetric with NO cast (a real TurnMetric is structurally
 * assignable to DriftNudgeInput — GOTCHA #5).
 *
 * @param messages the filtered message copy (MessageLike[] — the in-flight view the model will see).
 * @param metric   the latest turn-metric (shouldNudge(metric) is already true when this is called).
 * @returns a NEW array: [...messages, nudge]. The input is NOT mutated.
 */
export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[] {
  const line = renderDriftNudge(metric); // TurnMetric → DriftNudgeInput, no cast (GOTCHA #5)
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

/**
 * suppressCheck — Nudge B Phase 2 suppress heuristic (spec/07 §2 "Edge cases": "avoid nagging after the agent
 * already acted"). PURE: returns true (suppress the nudge) iff ANY rewind or shrink marker was created during the
 * metric's turn, approximated as: some marker.ts falls in the half-open window
 * (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]. Returns false otherwise (no markers / all older than the window /
 * marker ts in the future).
 *
 * WHY a window, not a pure upper bound (GOTCHA #7): at nudge-fire time, readMarkers returns the LATEST metric + ALL
 * accumulated markers. A turn-N marker AND a turn-(N-1) marker both have ts <= metric.ts (the metric is the most-
 * recently-stamped entry; no turn-(N+1) markers exist at context-fire). So `ts <= metric.ts` alone OVER-SUPPRESSES
 * (one rewind ever → nudge never fires again). There is no per-turn lower bound without the PREVIOUS metric
 * (readMarkers keeps only the latest), so a wall-clock window is the best-effort resolution the spec calls a
 * "Simple heuristic". Read ts defensively; a non-finite ts → treated as NOT in window (no suppress → fail to nudge,
 * the safe direction for an advisory nudge).
 *
 * WHY a structural markers param (GOTCHA #6): filter.ts imports these functions from nudges.ts, so nudges.ts must
 * NOT import MarkersBundle from filter.ts (circular). The param is `{ rewinds: ReadonlyArray<RewindMarker>;
 * shrinks: ReadonlyArray<ShrinkMarker> }`; filter.ts's MarkersBundle is structurally assignable (the extra `metric`
 * field is ignored for assignability-to-param). Call site: `suppressCheck(markers.metric, markers)`.
 *
 * @param metric  the latest turn-metric (metric.ts bounds the window's upper end).
 * @param markers { rewinds, shrinks } — the persisted rewind/shrink markers on the branch (MarkersBundle shape).
 * @returns true iff some marker.ts ∈ (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts].
 */
export function suppressCheck(
  metric: TurnMetric,
  markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> },
): boolean {
  const metricTs = typeof metric.ts === "number" && Number.isFinite(metric.ts) ? metric.ts : 0;
  const lo = metricTs - NUDGE_TURN_WINDOW_MS;
  for (const m of markers.rewinds) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  for (const m of markers.shrinks) {
    const ts = typeof m.ts === "number" && Number.isFinite(m.ts) ? m.ts : NaN;
    if (Number.isFinite(ts) && ts > lo && ts <= metricTs) return true;
  }
  return false;
}
```

```ts
// PATTERN — the filter.ts gate change (Task 2). BEFORE:
//   if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
//     messages = injectNudge(messages, markers.metric);
//   }
// AFTER (add suppressCheck as a 4th condition):
if (
  config.nudges.perTurnDrift &&
  markers.metric &&
  shouldNudge(markers.metric, config) &&
  !suppressCheck(markers.metric, markers)
) {
  messages = injectNudge(messages, markers.metric);
}
// + DELETE the two stub functions; + `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`
// + REMOVE `import type { MulliganConfig } from "./config.js";` (now unused).
```

```ts
// PATTERN — drift_nudge.test.ts (Task 4). Sketch; full describe blocks in Task 4. NO Pi fakes needed.
import { describe, it, expect } from "vitest";
import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS } from "../src/nudges.js";
import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";

// Build minimal metric/markers literals (partial → cast as the type; these are pure tests).
function metric(opts: Partial<TurnMetric> = {}): TurnMetric {
  return { schema: "pi-mulligan", v: 1, kind: "turn-metric", seq: 1, ts: 1_000_000,
    deltaTokens: 5000, bloatHit: false, bloatHits: [], grewOverThreshold: true, turnIndex: 5, ...opts } as TurnMetric;
}
function rewind(seq: number, ts: number): RewindMarker {
  return { schema: "pi-mulligan", v: 1, kind: "rewind", id: `rw-${seq}`, granularity: "last_tool_call_group",
    options: {}, seq, note: { what_happened: "p", avoid: "a", true_current_state: "s", next: "n" }, ledger: { readFiles: [],
    modifiedFiles: [], bashSideEffects: [] }, ts } as unknown as RewindMarker;
}
// shouldNudge: grewOverThreshold true → true; bloatHit true (grew false) → true; both false → false; {} malformed → false (=== true robustness).
// injectNudge: input [a]; output [a, nudge]; nudge.role==="custom", customType==="mulligan:nudge", display===false,
//   details.ephemeral===true, details.turnIndex===metric.turnIndex, typeof content==="string", typeof timestamp==="number";
//   input array NOT mutated (same length); injectNudge(original) twice does not stack (still +1, not +2) when called on the ORIGINAL each time.
// suppressCheck: metric.ts=1_000_000. rewind ts=1_000_000 → in window → true. rewind ts=1_000_000-1 → true. rewind ts=1_000_000-NUDGE_TURN_WINDOW_MS-1 → false (too old).
//   rewind ts=1_000_000+1 → false (future). shrink in window → true. no markers → false. non-finite ts (NaN) → false.
```

### Integration Points

```yaml
EVENT REGISTRATION (consumed by index.ts, P1.M7.T1.S1 — NOT this task):
  - NOTE: "registerFilterHandler(pi) already arms contextHandler (P1.M4.T2.S1). This task only rewires the gate
    inside contextHandler; no new registration is needed."

CONTEXT GATE (src/filter.ts contextHandler — MODIFIED this task):
  - update: "the nudge gate: `perTurnDrift && markers.metric && shouldNudge(metric, config) && !suppressCheck(metric, markers)` → injectNudge(messages, metric)"

CONFIG (read-only — NOT modified):
  - consume: "config.nudges.perTurnDrift (the gate's first condition; default true)"
  - NOTE: "NUDGE_TURN_WINDOW_MS is a src/nudges.ts CONSTANT (not config) — config.ts is frozen by sibling PRPs."

TYPES (imported type-only into src/nudges.ts):
  - consume: "TurnMetric, RewindMarker, ShrinkMarker (markers.js); MessageLike (transforms.js); MulliganConfig (config.js);
    DriftNudgeInput (implicit via renderDriftNudge structural assignability — no import needed)"

TEST (test/filter.test.ts MODIFIED; test/drift_nudge.test.ts NEW):
  - remove: "shouldNudge, injectNudge from the ../src/filter.js import"
  - delete: "the 'no-op stubs' describe block"
  - replace: "the 'stub no-op' integration test with 3 real-behavior tests"
  - create: "test/drift_nudge.test.ts — pure unit tests (no Pi fakes)"
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# There is NO eslint/prettier/biome (devDeps = typescript + vitest + @types/node). TS strict IS the gate.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output:
#   - "Object literal may only specify known properties … 'customType' …" on the nudge object → you typed the nudge
#     as a NARROWER interface (e.g. tried to return Pi's AgentMessage). Use MessageLike (it has the index signature).
#   - "Property 'renderDriftNudge' does not exist on module" → you forgot to merge renderDriftNudge into the notes import.
#   - "Cannot find name 'MessageLike'" → you forgot `import type { MessageLike } from "./transforms.js";` in nudges.ts.
#   - "Module './nudges.js' has no exported member 'suppressCheck'" (in filter.ts) → you didn't APPEND suppressCheck.
#   - "Argument of type 'MarkersBundle' is not assignable to parameter of type '{ rewinds; shrinks }'" → impossible
#     (structural); re-check RewindMarker/ShrinkMarker are imported type-only in nudges.ts.
#   - "shouldNudge is declared but never read" (filter.ts) → you removed the gate's shouldNudge call instead of adding
#     suppressCheck. shouldNudge STAYS in the gate; suppressCheck is ADDED.
#   - leftover unused `MulliganConfig` import in filter.ts → remove it (not an error under current tsconfig, but clean it).
# Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new pure functions in isolation
npx vitest run test/drift_nudge.test.ts
# Expected: all drift_nudge tests pass.

# The edited filter test (the 3 real-behavior integration tests replace the stub no-op test)
npx vitest run test/filter.test.ts
# Expected: all filter tests pass (the stub describe block is gone; the 3 new integration tests pass).

# Full suite (no regression — should be MORE tests than the 592 baseline)
npx vitest run
# Expected: all-green (16 files now: 15 + drift_nudge.test.ts). If a PRIOR test fails, this task regressed it —
# re-check: (a) filter.ts still imports MessageLike (the filterPipeline call needs it); (b) the gate still calls
# shouldNudge + injectNudge (only suppressCheck was ADDED); (c) filter.test.ts import no longer names shouldNudge/
# injectNudge from filter.js.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for the unit suite — shouldNudge/injectNudge/suppressCheck are pure helpers (spec/07 §3) tested directly in
# Level 2. The contextHandler integration (the gate wiring) is verified by the 3 edited filter.test.ts tests.
# The real end-to-end (a live `pi -e ./src/index.ts` session where a bloated turn → next inference shows the
# [mulligan] annotation) is owned by P1.M7.T2 (smoke harness) — NOT this task.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The heart of this task — verified by assertions in drift_nudge.test.ts + filter.test.ts:
#   - APPEND-TO-END: injectNudge([a], metric) → length 2; result[1].customType === "mulligan:nudge"; input [a] is
#     UNCHANGED (length still 1, same reference). injectNudge(injectNudge([a], m), m) is NOT the contract — the
#     filter calls injectNudge on the FRESH pipeline output each fire, so verify injectNudge([a], m) twice (on [a]
#     both times) yields length 2 each time (no stacking when called on the original).
#   - EPHEMERAL: grep src/nudges.ts for "sendMessage" → MUST be ABSENT (injectNudge never persists). The nudge is
#     constructed inline and returned in the copy only.
#   - NUDGE SHAPE: result nudge has role:"custom", customType:"mulligan:nudge", display:false,
#     details:{ephemeral:true, turnIndex:<metric.turnIndex>}, content is a non-empty string (renderDriftNudge),
#     timestamp is a number.
#   - SUPPRESS WINDOW BOUNDARIES: metric.ts=T. marker.ts=T → suppress (inclusive upper). marker.ts=T-1 → suppress.
#     marker.ts=T-NUDGE_TURN_WINDOW_MS → NOT suppress (lower exclusive). marker.ts=T-NUDGE_TURN_WINDOW_MS-1 → not
#     suppress. marker.ts=T+1 → not suppress (future). A SHRINK in window → suppress (not just rewinds).
#   - shouldNudge ROBUSTNESS: shouldNudge({} as TurnMetric, cfg) === false (=== true yields boolean, not undefined).
# Expected: all domain validations pass.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (Level 1 — the type+style gate; no lint tool exists).
- [ ] `npx vitest run test/drift_nudge.test.ts` passes (Level 2).
- [ ] `npx vitest run test/filter.test.ts` passes (Level 2 — the 3 edited integration tests).
- [ ] `npx vitest run` is all-green, no regression (Level 2 — 16 files).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] `shouldNudge`: true on grewOverThreshold; true on bloatHit; false on both-false; boolean on malformed.
- [ ] `injectNudge`: appends exactly ONE mulligan:nudge to the END; new array (no mutation); correct shape; never
      references pi.
- [ ] `suppressCheck`: true on in-window rewind OR shrink; false on no-markers / too-old / future / non-finite ts.
- [ ] `context` gate: injects iff `perTurnDrift && metric && shouldNudge && !suppressCheck` (3 filter.test.ts tests).
- [ ] Ephemeral / non-stacking: nudge recomputed each fire from the latest metric; never persisted.

### Code Quality Validation

- [ ] APPENDED to src/nudges.ts; the 4 existing exports (P1.M6.T1.S1 + P1.M6.T2.S1) UNCHANGED.
- [ ] filter.ts: stubs deleted; import from ./nudges.js added; dead MulliganConfig type import removed; gate updated.
- [ ] filter.test.ts: stub import names removed; stub describe block deleted; stub no-op test replaced with 3 real tests.
- [ ] Anti-patterns avoided: does NOT call pi.sendMessage; does NOT cast renderDriftNudge(metric); does NOT use
      AgentMessage[] for injectNudge; does NOT import MarkersBundle into nudges.ts (structural param instead);
      does NOT use a pure-upper-bound suppress (uses the window); does NOT touch config.ts / the 4 existing exports /
      test/nudges.test.ts / test/turn_metric.test.ts.
- [ ] Dependencies properly managed: type-only imports for MulliganConfig/MessageLike/TurnMetric/RewindMarker/
      ShrinkMarker; value import for renderDriftNudge (merged into the existing notes import); value import of
      shouldNudge/injectNudge/suppressCheck into filter.ts.
- [ ] SYNC pure functions (no async); no own try/catch (called inside contextHandler's existing fail-open).

### Documentation & Deployment

- [ ] Code is self-documenting (the JSDoc blocks in the Blueprint state the spec refs, the MessageLike/DriftNudgeInput
      assignability rationale, the suppress-window rationale, and each gotcha inline — copy them verbatim).
- [ ] No new environment variables (NUDGE_TURN_WINDOW_MS is a nudges.ts constant).
- [ ] Wiring into `index.ts` is DEFERRED to P1.M7.T1.S1 (registerFilterHandler is already the seam; this task only
      rewires the gate).

---

## Anti-Patterns to Avoid

- ❌ Don't type `injectNudge` as `AgentMessage[]` — the filter.ts call site is `MessageLike[]` (GOTCHA #3); use
  MessageLike[] (transforms.ts) so the assignment `messages = injectNudge(...)` type-checks.
- ❌ Don't cast `renderDriftNudge(metric)` — a real TurnMetric is structurally assignable to DriftNudgeInput (GOTCHA #5).
- ❌ Don't cast the nudge object literal to MessageLike — MessageLike's index signature makes it assign with no cast (GOTCHA #4).
- ❌ Don't import `MarkersBundle` into nudges.ts (circular) — type suppressCheck's markers param structurally (GOTCHA #6).
- ❌ Don't implement suppress as a pure upper bound `marker.ts <= metric.ts` — it over-suppresses (one rewind ever →
  nudge dies forever). Use the `(metric.ts − window, metric.ts]` window (GOTCHA #7).
- ❌ Don't remove `shouldNudge`/`injectNudge` from the filter gate — they STAY; `suppressCheck` is ADDED as a 4th condition.
- ❌ Don't call `pi.sendMessage` in injectNudge — the nudge is ephemeral (lives only in the returned copy) (GOTCHA #9).
- ❌ Don't forget the THREE filter.test.ts edits (import names, stub describe block, stub no-op test) — or the suite
  goes red (GOTCHA #11).
- ❌ Don't recreate src/nudges.ts or touch the 4 existing exports — APPEND only.
- ❌ Don't touch test/nudges.test.ts / test/turn_metric.test.ts — create test/drift_nudge.test.ts (separate file).
- ❌ Don't add a config option for the window — NUDGE_TURN_WINDOW_MS is a nudges.ts constant (config.ts is frozen).

---

## Confidence Score

**9/10** for one-pass implementation success. The task is three small pure functions + a one-line gate rewiring +
three mechanical test edits, all with verbatim code provided. The only judgment call (the suppress time-window
heuristic) is fully specified with rationale and boundary tests. The two risk areas — (1) the `MessageLike` vs
`AgentMessage` type at the filter call site, and (2) the three filter.test.ts edits that would otherwise go red —
are both explicitly called out as gotchas with exact fixes. The -1 is for the inherent approximation in the
suppress heuristic (a best-effort window, not the exact turn boundary) — but that is by-design per spec/07 §2.