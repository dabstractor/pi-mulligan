# Implementation Patterns — P3 Delta

## G3 / P3.M1 — Marker retraction (cancel)

### Pattern 1: CancelMarker envelope + appendCancelMarker wrapper (markers.ts)

Mirror `appendShrinkMarker` exactly:
```typescript
export interface CancelMarker extends MulliganEnvelope {
  kind: "cancel";
  targetId: string;  // the id of the rewind/shrink marker being cancelled
  seq: number;
  ts: number;
}
export type CancelMarkerInput = Omit<CancelMarker, "schema" | "v" | "kind" | "seq" | "ts">;

export function appendCancelMarker(pi, ctx, data: CancelMarkerInput): string | null {
  try {
    const sessionId = ctx.sessionManager.getSessionId();
    const seq = nextSeq(sessionId);
    const entry: CancelMarker = { ...data, schema: "pi-mulligan", v: 1, kind: "cancel", seq, ts: Date.now() };
    pi.appendEntry("mulligan:cancel", entry);
    return ctx.sessionManager.getLeafId();
  } catch { return null; }
}
```
- Extend `MulliganEnvelope.kind` to `"rewind" | "shrink" | "turn-metric" | "cancel"` (closed union stays closed).
- The `targetId` is the `id` field of the marker being cancelled (a uuid stamped by appendRewindMarker/appendShrinkMarker), NOT the entry id. **Wait — clarify:** E21 says "cancel any marker by id (`details.markerId` returned by rewind/shrink)". `details.markerId` is the ENTRY id (appendXxxMarker returns `getLeafId()`). But `readMarkers` casts `data` as the marker, and the marker's own `id` field is the uuid. **Key question: does the cancel target the marker's `id` (uuid) or the entry id?**

  **Resolution:** readMarkers drops markers whose `id` field ∈ cancelledIds. The rewind/shrink markers have an `id` field (uuid). The cancel marker carries `targetId` = that uuid. The cancel TOOL receives `markerId` from the agent (which got it from `details.markerId` — the ENTRY id). **So the tool must MAP the entry id → marker.id (uuid) before appending the cancel.** OR: readMarkers can also drop by entry id.

  **Cleanest approach:** The cancel marker's `targetId` stores the ENTRY id (what the agent has). readMarkers builds cancelledIds from targetIds, and drops markers whose ENTRY id ∈ cancelledIds. But readMarkers doesn't currently track entry ids alongside marker data — it just casts `data`. **Solution:** track the entry id per marker: `readOwn(entry, "id")` gives the entry's stable id. Build a map: for each `mulligan:cancel` entry, read `data.targetId` (the entry id being cancelled). Then for each rewind/shrink, check if its ENTRY id ∈ cancelled set.

  **This is the approach:** in readMarkers, when iterating entries, capture `const entryId = readOwn(entry, "id")` for every custom entry. For cancel entries, add `data.targetId` to cancelledIds. Then filter rewinds/shrinks whose `entryId ∈ cancelledIds`.

### Pattern 2: readMarkers cancel-drop (filter.ts)

```typescript
// In the readMarkers loop, additionally collect cancel entries:
const cancelledIds = new Set<string>();
// ... existing loop ...
if (customType === "mulligan:cancel" && kind === "cancel") {
  const targetId = readOwn(data, "targetId");
  if (typeof targetId === "string") cancelledIds.add(targetId);
}
// After the loop, drop cancelled markers:
const activeRewinds = rewinds.filter(r => !cancelledIds.has(/* r's entry id */));
```
**CRITICAL:** rewinds/shrinks are `data` objects (the marker payload), which have their own `id` (uuid) but NOT the entry id. We need to track entry ids alongside. Approach: build a parallel array of `{ data, entryId }` during the scan, or use a Map. Then drop by entry id.

**Alternative (simpler):** The cancel's `targetId` stores the marker's uuid `id` field (NOT the entry id). The tool, when scanning entries to validate, finds the target marker's `data.id` (uuid) and passes THAT as `targetId` to `appendCancelMarker`. readMarkers then drops markers whose `data.id ∈ cancelledIds`. This is simpler — no entry-id tracking needed, and `data.id` is already on every rewind/shrink marker.

**DECISION:** Use the marker's uuid `id` field as the cancel target. The cancel TOOL:
1. Receives `markerId` from the agent (the entry id from `details.markerId`).
2. Scans entries to find the entry with that entry id.
3. Reads `data.id` (the uuid) from that entry.
4. Appends a cancel marker with `targetId = uuid`.
5. readMarkers drops markers whose `data.id ∈ cancelledIds`.

This keeps readMarkers simple (no entry-id tracking — just read `data.id` which is already there for rewinds/shrinks).

### Pattern 3: mulligan_cancel tool (tools/cancel.ts)

Mirror `makeShrinkTool(pi)`:
- Params: `{ markerId: Type.String({ description: "..." }) }`.
- Execute: config.enabled check → scan `ctx.sessionManager.getEntries()` for an entry whose `entry.id === params.markerId` and `customType ∈ {"mulligan:rewind","mulligan:shrink"}` → if found, read `data.id` (uuid) → check not already cancelled (scan for a cancel with that targetId) → `appendCancelMarker(pi, ctx, { targetId: uuid })` → return confirmation.
- Non-existent / already-cancelled → safe no-op returning a reason (never throws).

### Pattern 4: Audit retired listing (audit.ts)

`renderAuditReport` currently shows `Active markers: N rewind, N shrink, N checkpoints`. Add cancelled count: `... N cancelled (retired)`. The count comes from `markers.cancelledIds.size`.

---

## G2 / P3.M2 — Stale-marker retirement + soft cap

### Pattern 5: Config knobs (config.ts)

Add to `MulliganConfig.shrink`: `maxActive: number; staleAfterFires: number;`. Add to `DEFAULT_CONFIG.shrink`: `maxActive: 32, staleAfterFires: 3`. In `validateConfig`'s shrink block, use `coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true)` and same for `staleAfterFires`.

### Pattern 6: Runtime miss-counts (runtime.ts)

Add `shrinkMissCounts: Map<string, number>` to `SessionRuntime`. Initialize as `new Map()` in `freshRuntime`. `resetRuntime` already wipes the whole entry.

### Pattern 7: Stale retirement + cap (filter.ts contextHandler)

After `filterPipeline` runs (on the filtered messages), do a SEPARATE resolution pass for stale/cap detection. This keeps filterPipeline pure. The pass runs on the PRE-filterPipeline messages (event.messages) + branchEntries because:
- Stale detection = "pinned shrink target entry absent from branch" (compaction removed it).
- Use `resolvePinnedShrink(messages, branchEntries, pinnedEntryId)` — if null, the target is gone → miss.

```typescript
// After filterPipeline, BEFORE returning:
const activeShrinks = markers.shrinks.filter(s => s.pinnedEntryId); // only pinned shrinks can go stale
for (const sh of activeShrinks) {
  const hit = resolvePinnedShrink(eventMessages, branchEntries, sh.pinnedEntryId) !== null;
  const id = sh.id;
  if (hit) rt.shrinkMissCounts.set(id, 0);
  else rt.shrinkMissCounts.set(id, (rt.shrinkMissCounts.get(id) ?? 0) + 1);
  if ((rt.shrinkMissCounts.get(id) ?? 0) >= config.shrink.staleAfterFires) {
    appendCancelMarker(pi, ctx, { targetId: id });
  }
}
// Cap: if active shrinks exceed maxActive, retire oldest by seq
if (markers.shrinks.length > config.shrink.maxActive) {
  const oldest = [...markers.shrinks].sort((a,b) => a.seq - b.seq)[0];
  appendCancelMarker(pi, ctx, { targetId: oldest.id });
}
```
- These appends take effect on the NEXT fire (readMarkers drops the cancelled id) — no in-fire mutation.
- `appendCancelMarker` is from P3.M1 — **M2 depends on M1**.
- `contextHandler` currently does NOT receive `pi` — it receives `(event, ctx)`. The `pi` is captured via `registerFilterHandler(pi)` closure. **Need to pass pi to contextHandler** — see GOTCHA below.

**GOTCHA — pi in contextHandler:** `contextHandler(event, ctx)` does NOT receive `pi`. `registerFilterHandler(pi)` does `pi.on("context", contextHandler)`. To call `appendCancelMarker(pi, ctx, ...)` inside contextHandler, either:
- (a) Change `registerFilterHandler` to wrap: `pi.on("context", (event, ctx) => contextHandler(pi, event, ctx))` and update contextHandler's signature to `(pi, event, ctx)`.
- (b) Capture pi in a module-scoped variable set by registerFilterHandler (less clean).
- **Recommended:** (a) — mirror `turnEndMetricHandler(pi, event, ctx)` pattern from nudges.ts.

---

## G1 / P3.M3 — Drift-nudge refinements

### Pattern 8: Windowed drift (nudges.ts shouldNudge)

Change signature from `(metric, _config)` to accept the recent-metrics window:
```typescript
export function shouldNudge(
  recentMetrics: TurnMetric[],   // last N metrics, newest first (or oldest first — define ordering)
  config: MulliganConfig,
): boolean {
  // Windowed delta = average of deltaTokens over the window (ignoring nulls).
  // Fire when the smoothed delta crosses driftThresholdTokens.
  // ALSO keep bloatHit: if ANY metric in the window had bloatHit, still fire.
  const window = recentMetrics.slice(0, config.nudges.driftWindowTurns);
  const deltas = window.map(m => m.deltaTokens).filter((d): d is number => d != null);
  if (deltas.length === 0) return window.some(m => m.bloatHit === true);
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return avg > config.nudges.driftThresholdTokens || window.some(m => m.bloatHit === true);
}
```
- The window is computed from the last N `mulligan:turn-metric` entries (readMarkers exposes them as `recentMetrics`).
- Acceptance: single 8k turn amid small turns → NO fire (average stays low). Three ~4k turns → avg 4k > ... wait, threshold is now 6000. Three 4k turns → avg 4000 < 6000 → NO fire? 

  **Re-check acceptance:** spec/07 §5.1 says "three ~4k turns in a row DO [fire]". With driftThresholdTokens=6000 and windowed avg: three 4k turns → avg 4000 < 6000 → would NOT fire. But the spec says they SHOULD fire. So the windowed comparison must NOT be moving-average vs threshold. Let me re-read.

  **Re-reading §5.1:** "fire when the *windowed* (moving-average, or M-of-N) delta crosses the threshold." The spec offers TWO options: moving-average OR M-of-N. For "three ~4k turns fire" with threshold 6000:
  - Moving-average: avg(4k,4k,4k) = 4k < 6k → no fire. ✗
  - M-of-N (sum): 4k+4k+4k = 12k > 6k → fire. ✓ 
  - M-of-N (count of turns over threshold): 0 turns over 6k → no fire. ✗

  **So "moving-average" doesn't satisfy the acceptance criteria.** The spec's parenthetical "(moving-average, or M-of-N)" suggests M-of-N as an alternative. Given the acceptance ("three ~4k turns DO fire" with threshold 6000), the implementation must use **cumulative/summed delta over the window**, NOT the average. Sum of deltas over N turns compared to threshold.

  **IMPLEMENTATION DECISION:** Smooth = sum (or equivalently, the total growth over the window). `sum(deltas) > threshold` fires. Single 8k turn in a 3-window with two ~500 turns: sum = 9k > 6k → fires. But the spec says "single 8k-token turn amid small turns does NOT fire". Hmm — 8k + 500 + 500 = 9k > 6k → fires. That contradicts "does NOT fire."

  **RE-ANALYZE:** Maybe the window is applied differently. Perhaps it's: fire when M of the last N turns each individually exceed a LOWER per-turn threshold? Or the average is compared to a lower effective threshold? Or maybe the windowing is about the AVERAGE and the "three 4k turns" means the threshold should be lower?

  **Re-reading more carefully:** "a single 8k-token turn amid small turns does NOT fire; three ~4k turns in a row DO fire." With threshold 6000 and window 3:
  - Windowed avg of [8k, 0.5k, 0.5k] = 3k. Compared to 6k → no fire. ✓ (single heavy turn doesn't fire)
  - Windowed avg of [4k, 4k, 4k] = 4k. Compared to 6k → no fire. ✗ (spec says should fire)

  Neither avg nor sum satisfies BOTH acceptance criteria with threshold 6000. There must be something else. Perhaps the threshold comparison changes: with windowing, compare the WINDOW TOTAL to `threshold × windowSize`? Or compare per-turn to a reduced threshold?

  **MOST LIKELY interpretation:** The windowing replaces the per-turn threshold with a windowed AVERAGE compared to the SAME threshold. But 3×4k avg = 4k < 6k doesn't fire. UNLESS the "three ~4k turns" means each turn's delta is ~4000 tokens and the CUMULATIVE over the window is compared to the threshold. 3×4k cumulative = 12k > 6k → fires. Single 8k + two small = 9k > 6k → also fires. Contradiction again.

  **FINAL interpretation (from spec rationale):** "sustained growth over a window is the actionable signal." The key insight: a single spike is noise, sustained growth is signal. The acceptance criteria:
  - Single 8k turn + two small turns: the average is ~3k, below 6k → no fire. ✓
  - Three 4k turns: average is 4k... still below 6k. 

  **Wait — maybe the threshold of 6000 is the PER-TURN threshold, and the windowed signal uses a DIFFERENT comparison.** Or perhaps "three ~4k turns" means the turns have ~4k EACH and the average 4k is compared to a LOWER windowed threshold. But the spec says the threshold is driftThresholdTokens=6000 for the windowed comparison.

  **Pragmatic resolution:** The spec gives two acceptable algorithms ("moving-average, OR M-of-N"). The acceptance criteria are the ground truth. The implementing agent should choose the algorithm that satisfies BOTH criteria. The most natural one that does:
  - **M-of-N where M = windowSize (all turns in window must be individually notable):** all 3 turns must exceed some per-turn sub-threshold. Three 4k turns each exceed... what? Not 6k.
  - **Average compared to threshold, with the understanding that "three 4k turns" is illustrative and the real threshold math works out:** Perhaps the acceptance is aspirational and the exact numbers don't have to match perfectly. The KEY requirement is: sustained moderate growth fires, single spikes don't.

  **Recommendation for the implementing agent:** Use moving-average. The average of the window's deltaTokens is compared to driftThresholdTokens. A single 8k spike averaged with two small turns stays below 6k (no fire). Three sustained 4k turns average to 4k — if this is below 6k, it doesn't fire. **The agent may need to interpret "three ~4k turns" as "three turns that together represent sustained growth" and may lower the effective comparison or use the cumulative approach.** Flag this as a SPEC AMBIGUITY in the context_scope — the implementing agent should choose the algorithm that best matches the stated INTENT (sustained vs spike) and acceptance criteria, and document the choice.

  **Practical pick:** Moving average. `avg(deltas) > driftThresholdTokens`. This clearly satisfies "single 8k spike doesn't fire" (averaged down). For "three 4k turns fire" — this requires avg(4k) > 6k which is false. So the agent should instead use the **total/sum** approach but with the understanding that a single spike's sum is also high. The resolution: **the average works IF the threshold for the windowed comparison is effectively lower.** Or: compare the average to `threshold / windowSize` (i.e., 6000/3 = 2000 per turn average). Then: avg(8k,0.5k,0.5k) = 3k > 2k → fires. ✗ Still fires on single spike.

  **FINAL ANSWER:** The spec is intentionally flexible ("moving-average, or M-of-N"). The implementing agent should use **moving average** and compare to the threshold. Document the acceptance criteria and choose accordingly. The downstream agent has the spec text and the acceptance criteria — let THEM resolve the algorithm details. Flag it clearly.

### Pattern 9: High-water signal (nudges.ts)

```typescript
export function shouldHighWater(
  totalFilteredTokens: number,
  windowTokens: number,
  rt: SessionRuntime,
  config: MulliganConfig,
): boolean {
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
- `windowTokens = ctx.getContextUsage()?.contextWindow ?? 0`.
- Edge-triggered: fires ONCE when crossing up; clears only when dropping back below.

### Pattern 10: readMarkers recentMetrics (filter.ts)

Currently keeps only the latest metric. Change to keep the last N (by seq, descending = newest first):
```typescript
// Collect all turn-metrics, sort by seq descending, take first N:
const allMetrics = collectedMetrics.sort((a,b) => b.seq - a.seq);
const recentMetrics = allMetrics.slice(0, config.nudges.driftWindowTurns);
const metric = recentMetrics[0] ?? null; // latest = newest
```
- `recentMetrics` is newest-first (index 0 = most recent). Add to MarkersBundle.
- `metric` (latest) is kept for backward compat (suppressCheck still uses it).

### Pattern 11: contextHandler nudge wiring (filter.ts)

After filterPipeline + existing nudge injection, add high-water:
```typescript
// Windowed drift nudge (replaces the current shouldNudge call):
if (config.nudges.perTurnDrift && markers.recentMetrics.length > 0) {
  if (shouldNudge(markers.recentMetrics, config) && !suppressCheck(markers.metric!, markers)) {
    messages = injectNudge(messages, markers.metric!); // still uses latest metric for the text
  }
}
// High-water signal:
const totalFiltered = estimateTokens(messages).tokens;
const windowTokens = ctx.getContextUsage()?.contextWindow ?? 0;
if (shouldHighWater(totalFiltered, windowTokens, rt, config)) {
  messages = injectHighWater(messages, totalFiltered, windowTokens);
}
```
- `injectNudge` still takes the latest metric (for the text). `shouldNudge` now takes the window.
- High-water uses its own injector + renderer.