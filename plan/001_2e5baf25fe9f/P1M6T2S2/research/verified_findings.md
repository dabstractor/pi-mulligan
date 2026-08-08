# P1.M6.T2.S2 — Verified Research Findings (Nudge B Phase 2: shouldNudge / injectNudge / suppressCheck)

Verified live during research. Baseline at research time: `npx tsc --noEmit` exit 0; `npx vitest run` → 15 files / 592 tests green.

## 1. Merge base of `src/nudges.ts` (the file this task APPENDS to)

`src/nudges.ts` ALREADY EXISTS and ships FOUR named exports (P1.M6.T1.S1 + P1.M6.T2.S1 both landed):
`bloatReminderHandler`, `registerBloatReminder`, `turnEndMetricHandler`, `registerTurnEndMetric`.

Its CURRENT import block (top of file) is:
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
This task APPENDS `shouldNudge` / `injectNudge` / `suppressCheck` (pure, Pi-free) below `registerTurnEndMetric`,
and AUGMENTS imports (see PRP Task 1). It does NOT touch the four existing exports.

## 2. `filter.ts` — the stubs to DELETE + the gate to WIRE (lines verified)

- `filter.ts` currently DEFINES + EXPORTS local stubs `shouldNudge` (line 165) and `injectNudge` (line 175).
  Both JSDocs say verbatim: *"P1.M6.T2.S2 will delete this stub and `import { shouldNudge } from "./nudges.js"`"*.
  ⟹ This task DELETES both stubs (their JSDoc + the `// ── Nudge stubs` section header) and adds
  `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`.
- The gate (contextHandler body, ~line 289) is today:
  `if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) { messages = injectNudge(messages, markers.metric); }`
  ⟹ ADD `&& !suppressCheck(markers.metric, markers)`. NOTE: spec/06 §1/§12 pseudocode predates the suppress
  refinement; spec/07 §2 "Edge cases" is the authoritative source for suppress. `markers` (MarkersBundle) is in scope.
- `import type { MulliganConfig } from "./config.js";` (line 47) is used ONLY by the shouldNudge stub → becomes
  UNUSED after the stub is deleted. REMOVE it for cleanliness (tsconfig has no noUnusedLocals so it won't error,
  but remove it anyway). `getConfig` (value import) STAYS.
- `MessageLike` import STAYS — still used at `let messages: MessageLike[] = filterPipeline(...)` (line 212).

## 3. `injectNudge` MUST use `MessageLike[]` (transforms.ts), NOT `AgentMessage[]`

The contract/spec say `AgentMessage[]`, but the ACTUAL call site in filter.ts is
`messages = injectNudge(messages, markers.metric)` where `messages` is `MessageLike[]` (the filterPipeline
output type). If injectNudge returned a different type the assignment would fail to type-check. ⟹ injectNudge is
`(messages: MessageLike[], metric: TurnMetric): MessageLike[]`. `MessageLike` is imported type-only from
`./transforms.js`. transforms.ts imports NOTHING → no cycle.

`MessageLike` (transforms.ts line 53) has an index signature `[key: string]: unknown` + `role?: string` +
`content?: string | ContentBlock[]`. ⟹ the nudge CustomMessage object literal
`{ role:"custom", customType:"mulligan:nudge", content: line, display:false, details:{...}, timestamp:Date.now() }`
is assignable to `MessageLike` with NO cast (string content matches; the rest ride the index signature; verified
structurally — "custom"→string, false→unknown, etc.).

## 4. `renderDriftNudge` is ALREADY SHIPPED (notes.ts, P1.M2.T3.S3) — add to notes import

`renderDriftNudge(metric: DriftNudgeInput): string` is exported from `notes.ts`. `DriftNudgeInput =
{ deltaTokens: number|null; bloatHits: ReadonlyArray<{toolName;approxTokens}> }`. notes.ts JSDoc states a real
`TurnMetric` is STRUCTURALLY ASSIGNABLE to `DriftNudgeInput` (a mutable `{...}[]` widens to ReadonlyArray soundly).
⟹ `injectNudge` calls `renderDriftNudge(metric)` with NO cast. nudges.ts already imports `renderBloatReminder`
from `./notes.js` → MERGE `renderDriftNudge` into that same import line.

## 5. Circular-import safety (all clear)

- `nudges.ts` → `transforms.js` (type-only MessageLike): transforms.ts is Pi-free, 0 imports. ✓
- `nudges.ts` → `markers.js` (already imports appendTurnMetric + TurnMetricInput value/type; ADD TurnMetric,
  RewindMarker, ShrinkMarker type-only): markers.ts does NOT import nudges.ts. ✓
- `filter.ts` → `nudges.js` (shouldNudge/injectNudge/suppressCheck): nudges.ts does NOT import filter.ts. ✓
- `nudges.ts` → `notes.js` (renderDriftNudge): notes.ts does NOT import nudges.ts. ✓

## 6. `suppressCheck` markers param — structural type, do NOT import MarkersBundle

Importing `MarkersBundle` from `filter.js` into `nudges.js` would be CIRCULAR (filter.ts imports the nudge fns
from nudges.ts). ⟹ suppressCheck takes a STRUCTURAL type: `{ rewinds: ReadonlyArray<RewindMarker>;
shrinks: ReadonlyArray<ShrinkMarker> }`. filter.ts's `MarkersBundle { rewinds: RewindMarker[]; shrinks:
ShrinkMarker[]; metric: TurnMetric|null }` is assignable to it (array→ReadonlyArray ✓; the extra `metric` field
is ignored for assignability-to-param). Call site: `suppressCheck(markers.metric, markers)`.

## 7. The suppress time-window heuristic (spec/07 §2 "Edge cases" — chosen resolution)

Spec edge case: *"the filter suppresses the nudge if a mulligan:rewind or mulligan:shrink marker was created
during the metric's turn … Simple heuristic: if any marker's ts is within the turn's time window, skip the nudge."*

PROBLEM: at nudge-fire time (start of turn N+1, reading turn N's latest metric), readMarkers returns ONLY the
latest metric + ALL accumulated markers. A turn-N marker AND a turn-(N-1) marker both have `ts <= metric.ts`
and `seq < metric.seq` (the metric is the most-recently-stamped entry). So a pure upper bound
(`ts <= metric.ts`) OVER-SUPPRESSES — after ONE rewind ever, the nudge would never fire again. There is no
per-turn lower bound available without the PREVIOUS metric (readMarkers keeps only the latest).

RESOLUTION (best-effort, matches spec's "Simple heuristic" framing): suppress iff some marker.ts falls in the
half-open window `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]`. `NUDGE_TURN_WINDOW_MS = 10 * 60 * 1000`
(10 min) — exported module constant; a generous bound on a single agent turn's wall-clock duration; documented
as a tunable heuristic (not config in v1 — config.ts is frozen by sibling PRPs). Catches markers created during
the same turn while ignoring markers from earlier turns. Read ts defensively (`typeof === 'number' &&
Number.isFinite`), defaulting a bad ts to "not in window" (no suppress).

## 8. `shouldNudge` — config param unused in v1 (mirrors established `_param` convention)

`shouldNudge(metric, config) = metric.grewOverThreshold || metric.bloatHit`. The `config` arg is part of the
spec/contract signature but UNUSED (the drift threshold was already applied when the metric's grewOverThreshold
was computed at turn_end). ⟹ name it `_config` — the SAME convention as `renderBloatReminder(_toolName, …)`
(notes.ts) and `estimateTokens(messages, _model?)` (tokens.ts). Use `metric.grewOverThreshold === true ||
metric.bloatHit === true` so a malformed metric (readMarkers casts raw session data) yields a real `boolean`,
never `undefined` (robust + satisfies the `: boolean` return).

## 9. `filter.test.ts` IMPACT — three edits REQUIRED (tests assert the current stub no-op)

- Lines 27-28: `import { … shouldNudge, injectNudge, type MarkersBundle } from "../src/filter.js";` → after the
  swap, filter.js NO LONGER EXPORTS shouldNudge/injectNudge ⟹ REMOVE them from this import (keep readMarkers,
  contextHandler, registerFilterHandler, MarkersBundle). The pure-fn unit tests move to `test/drift_nudge.test.ts`.
- Lines 279-288: the `describe("shouldNudge / injectNudge — no-op stubs …")` block asserts `shouldNudge → false`
  and `injectNudge → unchanged`. Both become WRONG under real impls ⟹ DELETE the whole describe block.
- Lines 234-240: `it("does NOT inject the nudge (stub no-op) …")` uses `metricData(1, true)` (grewOverThreshold
  true) and asserts NO injection. Under real shouldNudge the nudge WILL fire ⟹ REPLACE with three real-behavior
  tests: (a) injects when shouldNudge true + not suppressed; (b) does NOT inject when suppressed (a same-window
  rewind marker); (c) does NOT inject when shouldNudge false. Helpers `metricData(seq,grew,bloat)` (ts=1),
  `rewindData(seq)` (ts=1), `customEntry`, `makeCtx({entries})` already exist. For (a)/(c) use a metric only
  (no markers → no suppress). For (b) give metric + rewind the SAME recent ts (e.g. `Date.now()`) so they're
  within the window. `pipelineReturn` controls filterPipeline's output; assert `result.messages` length/content.

## 10. `DriftNudgeInput` assignability & nudge-token cost

- TurnMetric → DriftNudgeInput: structural, no cast (§4). renderDriftNudge handles deltaTokens===null (first
  turn) by dropping the delta clause and leading with bloat — already implemented + tested in notes.test.ts.
- Nudge fires ONLY when `shouldNudge && !suppressCheck` → ~25–40 tokens when it fires (the renderDriftNudge
  text is 3 lines), ZERO otherwise. Ephemeral (never persisted): injectNudge returns `[...messages, nudge]` and
  NEVER calls `pi.sendMessage`. Each context fire gets a FRESH deep copy from Pi → the nudge never stacks
  (recomputed from the latest metric each fire, replaces the previous by construction).