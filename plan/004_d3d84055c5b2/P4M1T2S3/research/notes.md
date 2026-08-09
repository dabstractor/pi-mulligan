# Research Notes — P4.M1.T2.S3 (Suppress drift nudge on refused rewind)

Verified against HEAD `0bcaa814` + plan/004_d3d84055c5b2/architecture/codebase_patterns.md §5/§6.

## 1. runtime.ts — the field model (CONFIRMED)
- `SessionRuntime` interface currently ends with `aboveHighWater: boolean;` (the EXACT model for
  a new `rewindRefusedTurnIndex: number | null`, default `null`).
- `freshRuntime()` returns the object literal ending with `aboveHighWater: false,`. Add
  `rewindRefusedTurnIndex: null,` there.
- `resetRuntime()` deletes the map entry; `clearAll()` clears the map. **NEITHER needs a change**
  — adding a field is automatic (they wipe the whole entry). §5 of architecture doc confirms this.

## 2. markers.ts — TurnMetric.turnIndex (CONFIRMED)
- `markers.ts` line 140 `export interface TurnMetric extends MulliganEnvelope`, line 151–152:
  `/** The turn index this metric describes (from turn_end event.turnIndex). */ turnIndex: number;`
- So `readMarkers(ctx).metric?.turnIndex` is the latest turn-metric's index (the value the filter
  compares against). This is the authoritative source; `rt.lastTurnIndex` is the in-memory fallback
  (set at turn_end, same value during a turn).

## 3. audit.ts imports readMarkers from filter.ts — PRECEDENT (CONFIRMED)
- `src/tools/audit.ts` line 51: `import { readMarkers } from "../filter.js";`
- → rewind.ts importing `readMarkers` from `../filter.js` is the SAME, already-proven pattern.
- No cycle: filter.ts imports transforms/runtime/config/log/tokens/markers/nudges — NONE import
  rewind.ts. One-way edge rewind → filter is safe.

## 4. rewind.ts refusal paths (CONFIRMED — the 9 sites S3 must cover)
`refusal(reason, gran)` is module-local (adds "Mulligan: refused — " prefix + trailing "."). Sites:
1. `!config.enabled` → refusal("Mulligan is disabled", granularity)        [E14]
2. `!config.rewind.enabled` → refusal("rewind is disabled", granularity)
3. invalid note → refusal(NOTE_INVALID_REASON, granularity)                 [E9]
4. checkpoint no name → refusal("checkpoint granularity requires a checkpoint name", "checkpoint")
5. checkpoint not found → refusal(`checkpoint '${name}' not found on this branch`, "checkpoint")  [E10]
6. `depth >= maxDepth` → refusal(`max rewind depth ...`, granularity)       [E4]
7. (4b) retry budget → refusal(`hit the per-prompt retry budget ...`, granularity)   [from S1]
8. (4c) context fraction → refusal(`context is at ${pct}% ...`, granularity)         [from S2]
9. catch-all → refusal(`unexpected error: ...`, granularity)                 [in catch block]

Body is ONE try/catch: `try { steps... } catch (e) { return refusal(unexpected, granularity); }`.
`rewindExecute` currently does NOT call getRuntime — S3 adds it. Imports to add:
`import { getRuntime } from "../runtime.js";` (+ `import type { SessionRuntime }`) and
`import { readMarkers } from "../filter.js";`.

## 5. filter.ts drift-nudge block (CONFIRMED — architecture §6)
Block (rt + markers both already in scope):
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
- Add a conjunct: suppress when `rt.rewindRefusedTurnIndex === markers.metric.turnIndex`
  (safe — the prior conjunct already guarantees `markers.metric` is truthy).
- Add clear logic (run each fire, before the block): if flag set AND metric.turnIndex differs →
  set flag = null. Wrap defensively (E13) so a failure can't take down the whole filter.
- Whole contextHandler is in ONE try/catch (fail-open E13) — but mutating rt there is isolated.

## 6. Test patterns (CONFIRMED)
- **test/runtime.test.ts**: line 23 "exact default shape" assertion object includes `aboveHighWater: false`
  (line 34) — add `rewindRefusedTurnIndex: null`. Line 124 resetRuntime "fresh shape" assertion likewise
  (line ~124). Vitest, clearAll() before/after each. Mirrors the aboveHighWater field exactly.
- **test/tools/rewind.test.ts**: `makeCtx({ sessionId, entries, branch, ... })` scripts getSessionId
  (returns "s1" default, lines 115/121-122) and getEntries. So `getRuntime("s1")` is reachable in tests
  and `readMarkers(ctx)` reads scripted entries. clearAll() + setConfig(undefined) before/after each.
- **test/filter.test.ts**: contextHandler drift-nudge tests at lines 453-490:
  - "injects the drift nudge when shouldNudge(metric) is true and not suppressed" (453)
  - "does NOT inject ... when suppressed by a same-turn rewind marker" (467 — uses suppressCheck, a
    SEPARATE mechanism from our flag; must stay green).
  Pattern: `contextHandler(pi, { type: "context", messages: [] }, ctx)` → cast `{messages}`; assert
  injected length. A test can `getRuntime("s1").rewindRefusedTurnIndex = N` before firing.

## 7. Existing-test safety (no regressions)
- rewindRefusedTurnIndex defaults to `null`. `null !== <number turnIndex>` → conjunct is true → nudge
  proceeds as before. The clear logic is a no-op when flag is null. So ALL existing drift-nudge tests
  (which never set the flag) stay green untouched.
- The flag is read/set only via getRuntime (live ref) — no persistence, no marker, no config knob.

## 8. DRY flag-set strategy (chosen)
Rather than editing 9 refusal sites inline, define a closure `refuse(reason, gran)` at the TOP of the
try body that sets the flag (defensively) then delegates to `refusal(...)`, and rename every in-try
`return refusal(...)` → `return refuse(...)`. The catch's refusal sets the flag inline (out of closure
scope). One mechanical rename + one inline set = centralized, no site can be missed.