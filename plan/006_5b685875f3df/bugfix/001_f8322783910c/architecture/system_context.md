# System Context — pi-mulligan Bug Fix PRP

## Project Overview
pi-mulligan is a Pi coding-agent extension providing autonomous context self-rewind.
It intercepts the Pi `context` event to filter messages (hide/shrink), provides four
agent-callable tools (rewind, shrink, audit, checkpoint, cancel), and rides two
"free-ride" nudge mechanisms (bloat reminder + drift nudge) that never cost an extra
model request.

The codebase is TypeScript (ESM, `.js` import extensions), tested with vitest (955 tests,
all green), typechecked with `tsc --noEmit`. Foundation-tier modules (transforms.ts,
tokens.ts, ledger.ts) are Pi-FREE (zero imports) and unit-tested in isolation.

## Validated Bug Findings

All 7 PRD findings were independently confirmed against the real source code.
The test suite (955 tests) passes at baseline. Each finding is a behavioral/PRD-compliance
deviation, NOT a crash or data-loss bug. Hidden content always remains on disk (soft-delete).

---

### BUG-001 (Major): Drift nudge over-suppressed after rewind/shrink (wall-clock window)

**Root Cause**: `suppressCheck()` (src/nudges.ts:397-411) uses a fixed 10-minute wall-clock
window (`NUDGE_TURN_WINDOW_MS = 10*60*1000`, line 270) instead of the spec's turn-based
mechanism. A marker is treated as "during the metric's turn" iff `marker.ts ∈
(metric.ts − 10min, metric.ts]`. Since agent turns are seconds-to-minutes apart, a single
rewind/shrink suppresses the drift nudge on every subsequent turn for up to 10 minutes.

**Spec Reference**: spec/07-preventive-and-nudges.md §5.3 (REQUIRED, hard rule):
"collect the seqs of every mulligan:rewind/mulligan:shrink marker created during the
metric's turn (turn-boundary → turn_end)". The turn boundary = the PREVIOUS metric's ts.

**Available Data**: `readMarkers` (src/markers.ts via src/filter.ts:114) returns
`recentMetrics: TurnMetric[]` sorted NEWEST-FIRST. The latest metric is `recentMetrics[0]`,
the previous metric is `recentMetrics[1]`. The previous metric's `.ts` is the turn boundary
lower bound. This data IS available but suppressCheck currently ignores it (takes only
`markers.metric` + `{rewinds, shrinks}`).

**Fix Approach**: Change `suppressCheck` to accept `recentMetrics` (or just the previous
metric's ts) and use `recentMetrics[1]?.ts` as the lower bound: a marker is "during the
metric's turn" iff `prevMetric.ts < marker.ts <= metric.ts`. When there is no previous
metric (first turn / post-reload), fall back to no suppression (the marker was likely
created during this first turn anyway — suppressing is the spec-intended behavior for the
creating turn, so fall back to the current window OR suppress since there's only one turn).

**Call Site**: src/filter.ts:319 — `!suppressCheck(markers.metric, markers)`. Must change
to pass `markers.recentMetrics`.

**Files Touched**: src/nudges.ts (suppressCheck signature + logic, deprecate/remove
NUDGE_TURN_WINDOW_MS), src/filter.ts (call site), test/drift_nudge.test.ts (suppressCheck tests).

---

### BUG-002 (Major): Pinned rewinds/shrinks no-op after first compaction

**Root Cause**: `resolvePinnedHide()` (src/transforms.ts:625-660) walks branch entries
forward, and `entryMessageYield()` (transforms.ts:549-552) returns -1 for compaction
entries. When the walk hits ANY compaction entry, resolvePinnedHide returns `[]` (total
surrender). Since `isContextProducingType()` (transforms.ts:555-557) INCLUDES "compaction",
compaction entries are on the walked path. Once the first auto-compaction fires, EVERY
pinned rewind becomes a permanent no-op for the rest of the session — including targets
still in the retained tail. Same bug affects `resolvePinnedShrink()` (transforms.ts:813-842).

**Why Compaction Breaks Alignment**: `getBranch()` returns the RAW path (includes
compacted-away entries + the compaction entry). `event.messages` is compaction-aware
(includes the compaction summary + retained tail, NOT the compacted-away individual
messages). The 1:1 walk between branch entries and messages is fundamentally broken past
a compaction boundary. BUT the retained-tail entries (those AFTER the last compaction)
map 1:1 to the last N messages in event.messages.

**Fix Approach**: Rewrite resolvePinnedHide (and resolvePinnedShrink) to use a
**retained-tail-only walk**: find the LAST compaction entry on the branch; the retained
tail = entries AFTER it. Each retained-tail entry (type message/custom_message/branch_summary)
yields exactly 1 message. The retained tail maps to the LAST `tailEntries.length` messages
in event.messages (tailStartIdx = messages.length - tailEntries.length). Walk the tail
forward, matching pinned entry IDs. Entries in the compacted-away head are simply not
matched (correct — they're gone). When there is NO compaction, this degenerates to the
current forward walk (all entries are the "retained tail").

**Algorithm Sketch** (resolvePinnedHide):
```ts
// 1. Find last compaction index on branch (or -1 if none).
// 2. tailEntries = branch.slice(lastCompactionIdx + 1)
//      .filter(e => type is message/custom_message/branch_summary)  // NOT compaction
// 3. tailStartIdx = messages.length - tailEntries.length
// 4. if tailStartIdx < 0 → return [] (alignment lost — defensive)
// 5. Walk tailEntries: for entry at position k, msgIdx = tailStartIdx + k
//    if entry.id ∈ hideSet → push msgIdx to remove
// 6. return remove
```

This preserves the existing behavior when there is no compaction (the common case) and
fixes the post-compaction case. `entryMessageYield` and `isContextProducingType` for
compaction are NOT changed (resolveCheckpoint still needs the bail-on-compaction behavior
for its contiguous-sweep semantics; only resolvePinnedHide/resolvePinnedShrink change).

**Files Touched**: src/transforms.ts (resolvePinnedHide + resolvePinnedShrink),
test/transforms.test.ts (new compaction test cases).

---

### BUG-003 (Major): Drift nudge does not fire for "three ~4k turns in a row"

**Root Cause**: `shouldNudge()` (src/nudges.ts:326-334) uses moving-average over
driftWindowTurns (default 3) compared strictly `>` to driftThresholdTokens (default 6000).
avg([4000,4000,4000]) = 4000 < 6000 → does NOT fire. This violates spec §5.1 acceptance
criterion (b): "three ~4k turns in a row DO fire."

**Spec Reference**: spec/07 §5.1 acceptance: (a) single 8k turn amid small → NO fire;
(b) three ~4k turns in a row → DO fire; (c) single large result with ~0 net growth → NO fire.

**Fix Options** (implementation agent's choice — both are defensible):

**Option A — Lower threshold**: Change DEFAULT_CONFIG.nudges.driftThresholdTokens from
6000 to 4000 AND change the comparison from `>` to `>=`. Verification:
- (a) avg([8000,500,500])=3000 >= 4000? No ✓
- (b) avg([4000,4000,4000])=4000 >= 4000? Yes ✓
- (c) avg(~0) >= 4000? No ✓
Pros: minimal change (config.ts default + one operator). Cons: the `>=` boundary is
fragile at exactly 4000; the threshold rationale comment needs updating.

**Option B — M-of-N hybrid**: Keep threshold 6000 for the moving-average arm; ADD a
second arm that fires when ALL turns in the full window each exceed a sustained-growth
floor (e.g. floor = driftThresholdTokens * 2/3 = 4000). This catches sustained sub-
threshold growth without a new config knob (derive the floor from the existing threshold).
Pros: robust, no config change, satisfies all three criteria at any threshold. Cons:
slightly more complex algorithm.

**Recommendation**: Option A is simplest and most maintainable. The `>=` boundary is
acceptable because "~4k" is approximate and the nudge is advisory (a false positive at
exactly 4000 costs ~30 tokens, not a correctness issue).

**Test Impact**: test/drift_nudge.test.ts uses an explicit `cfg(3, 6000)` helper, so
lowering the DEFAULT_CONFIG value won't break existing tests that pass their own threshold.
New tests for criterion (b) must be added. Audit any test reading DEFAULT_CONFIG directly.

**Files Touched**: src/config.ts (DEFAULT_CONFIG.nudges.driftThresholdTokens),
src/nudges.ts (shouldNudge comparison operator), test/drift_nudge.test.ts.

---

### BUG-004 (Minor): pendingBloatHits memory leak (bloatReminder=true, perTurnDrift=false)

**Root Cause**: `turnEndMetricHandler()` (src/nudges.ts:200) has an early return
`if (!config.enabled || !config.nudges.perTurnDrift) return;` BEFORE the
`rt.pendingBloatHits = []` clear (line 218). When perTurnDrift=false, the clear never
runs, and pendingBloatHits grows by one entry per bloated result for the entire session.

**Fix**: Move the `rt.pendingBloatHits = []` clear to BEFORE the early return (or
conditionally push only when perTurnDrift is also enabled). Simplest: clear at the top of
the handler body, before the perTurnDrift gate.

**Files Touched**: src/nudges.ts (turnEndMetricHandler), test/nudges.test.ts.

---

### BUG-005 (Minor): Retry budget counts cancelled rewinds

**Root Cause**: `countRetriesAtLatestPrompt()` (src/tools/rewind.ts:247-281) counts ALL
`mulligan:rewind` custom entries after the latest user prompt, with no exclusion for
rewinds retired by a later `mulligan:cancel`. A cancelled rewind never took effect but
still consumes budget.

**Fix**: After counting rewind entries, scan for `mulligan:cancel` entries whose
`data.targetId` matches a counted rewind's `data.id`, and subtract those from the count.
Alternatively, build a cancelled-uuids set first (like readMarkers does) and skip counted
rewinds whose id is in that set.

**Files Touched**: src/tools/rewind.ts (countRetriesAtLatestPrompt), test/tools/rewind.test.ts.

---

### BUG-006 (Minor): Cancel no-op text mismatch ("with that id" for target path)

**Root Cause**: src/tools/cancel.ts:393-398 returns a single hardcoded string
`"Mulligan: no active marker found with that id — nothing to cancel."` for BOTH the
target-not-found and markerId-not-found cases. Spec/05 §5 specifies distinct texts:
target path → "...for that target...", markerId path → "...with that id...".

**Fix**: Track which resolution path was attempted (target vs markerId) and emit the
correct text. The target path text: `"Mulligan: no active marker found for that target —
nothing to cancel."`. The markerId path text stays as-is.

**Files Touched**: src/tools/cancel.ts (step 4 no-op), test/tools/cancel.test.ts
(existing test at cancel.test.ts:560 pins the unified string — must be updated).

---

### BUG-007 (Minor): Checkpoint tool not gated by config.enabled

**Root Cause**: src/tools/checkpoint.ts has NO `getConfig().enabled` check. The other
four tools (rewind, shrink, audit, cancel) all gate on the master switch per spec E14.
checkpoint.ts documents "NO config gate here" as intentional, but E14 says ALL tools
must refuse when disabled.

**Fix**: Add `if (!getConfig().enabled) return refusal("Mulligan is disabled");` at the
top of `checkpointExecute()`, before the name validation. The `refusal()` helper already
exists (checkpoint.ts:84) and returns the correct `{ content, details }` shape.

**Files Touched**: src/tools/checkpoint.ts (checkpointExecute), test/tools/checkpoint.test.ts.

---

## Module Dependency Graph (relevant subset)

```
filter.ts (contextHandler)
  ├── nudges.ts (shouldNudge, suppressCheck, injectNudge, shouldHighWater, injectHighWaterNudge)
  │     ├── config.ts (getConfig, MulliganConfig, DEFAULT_CONFIG)
  │     ├── runtime.ts (getRuntime, SessionRuntime.pendingBloatHits/tokenBaseline)
  │     ├── markers.ts (TurnMetric, RewindMarker, ShrinkMarker types)
  │     └── notes.ts (renderDriftNudge, renderBloatReminder)
  ├── transforms.ts (filterPipeline → resolvePinnedHide, resolvePinnedShrink, applyRewind, applyShrink)
  │     └── (Pi-FREE: zero imports)
  └── markers.ts (readMarkers → MarkersBundle {rewinds, shrinks, metric, recentMetrics, cancelledIds})

tools/rewind.ts (countRetriesAtLatestPrompt, checkpointExists)
tools/cancel.ts (cancelExecute)
tools/checkpoint.ts (checkpointExecute)
```

## Key Conventions
- **Pi-FREE foundation tier**: transforms.ts, tokens.ts, ledger.ts have ZERO imports (not even from each other). They declare local structural types.
- **Fail-open discipline**: Every handler/tool body is one try/catch → log + return safe default (E13).
- **Defensive reads**: All field reads go through `isRecord`/`readOwn` (never bare property access on unknown data).
- **Import style**: `.js` extensions on all relative imports (ESM/Bundler resolution).
- **Test style**: vitest, direct function testing (no Pi mocking for foundation tier; fake pi/ctx for tool/handler tier).
- **Config**: `getConfig()` returns a fresh structuredClone; `setConfig()` validates via `validateConfig()`.