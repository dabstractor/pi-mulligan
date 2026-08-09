# System Context — P3 Delta (spec refinements from commit `0ea555ed`)

## Current codebase state (verified by reading every file in `src/`)

### markers.ts (386 lines) — Pi-coupled persistence wrappers
- `MulliganEnvelope` interface: `{ schema: "pi-mulligan"; v: 1; kind: "rewind" | "shrink" | "turn-metric" }`.
  - **P3 delta:** extend `kind` to include `"cancel"`.
- Three wrappers, all identical in shape: `appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric`.
  - Pattern: read `sessionId` fresh → `nextSeq(sessionId)` → build entry `{ ...data, schema, v:1, kind, id: randomUUID(), seq, ts }` → `pi.appendEntry("mulligan:<kind>", entry)` → return `ctx.sessionManager.getLeafId()` → never throws (try/catch → null).
  - `appendTurnMetric` does NOT stamp `id` (spec/04 §5 has no id field).
- `leaveNote(pi, content, rewindId)` — appends a CustomMessage (IN context). `setCheckpoint(pi, ctx, name)` — labels an entry.
- **P3 delta:** add `appendCancelMarker(pi, ctx, targetMarkerId)` mirroring `appendShrinkMarker`. The cancel marker envelope: `{ schema, v:1, kind:"cancel", targetId, seq, ts }`. No `id` needed on the marker itself (like turn-metric) — but the WRAPPER returns the entry id via getLeafId for the tool to echo. customType = `"mulligan:cancel"`.

### filter.ts (253 lines) — context event handler
- `readMarkers(ctx)`: scans `ctx.sessionManager.getEntries()` → filters `type === "custom"` + customType starts with `"mulligan:"` → buckets by customType+kind into `rewinds[]`, `shrinks[]`, `metric` (latest turn-metric only, highest seq).
- `MarkersBundle`: `{ rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric | null }`.
  - **P3 delta (M1):** collect `mulligan:cancel` entries → build `cancelledIds: Set<string>` → drop rewinds/shrinks whose `id` ∈ set → expose `cancelledIds` on `MarkersBundle`.
  - **P3 delta (M3):** expose `recentMetrics: TurnMetric[]` (last N, up to `driftWindowTurns`) instead of just the latest `metric`. Keep `metric` for backward compat (latest = recentMetrics[0] or last element).
- `contextHandler(event, ctx)`: reads config, `readMarkers`, `getBranch()`, delegates to `filterPipeline`, conditionally `shouldNudge`/`injectNudge`, caches `rt.lastFiltered`, returns `{ messages }`. Wrapped in ONE try/catch (fail-open).
  - **P3 delta (M2):** after `filterPipeline`, walk active pinned shrinks to track hit/miss → auto-retire stale ones + cap.
  - **P3 delta (M3):** compute windowed drift signal from `recentMetrics` + inject high-water annotation.

### config.ts (355 lines) — Pi-free config
- `MulliganConfig` interface, `DEFAULT_CONFIG`, `validateConfig(raw)`.
- Coercion pattern: `coerceNumber(field, value, fallback, mustBePositive)` → finite number >0 (or >=0), else warn + fallback. `coerceBoolean`, `coerceBloatThresholdByTool` (merges over fallback).
- `DEFAULT_CONFIG.nudges.driftThresholdTokens = 3000` — **P3 delta:** raise to `6000`.
- `shrink` currently has only `{ enabled: true }` — **P3 delta:** add `maxActive: 32`, `staleAfterFires: 3`.
- `nudges` — **P3 delta:** add `driftWindowTurns: 3`, `highWaterFraction: 0.7`.

### nudges.ts (362 lines) — preventive nudges
- `shouldNudge(metric: TurnMetric, _config: MulliganConfig): boolean` — returns `metric.grewOverThreshold || metric.bloatHit`. `_config` is UNUSED in v1.
  - **P3 delta:** change signature to accept the recent-metrics window; compute smoothed (moving-average) delta over the window; compare to `driftThresholdTokens`.
- `injectNudge(messages, metric)` — appends ephemeral `mulligan:nudge` CustomMessage to a copy. PURE.
- `suppressCheck(metric, markers)` — suppresses nudge if a rewind/shrink was created during the metric's turn (time window heuristic).
- `turnEndMetricHandler(pi, event, ctx)` — Nudge B Phase 1; computes delta, snapshots bloat, persists turn-metric, rolls baseline.
- **P3 delta:** add `shouldHighWater(totalFilteredTokens, windowTokens, rt, config)` + `renderHighWaterNudge()` for §5.2.

### runtime.ts (154 lines) — Pi-free per-session state
- `SessionRuntime`: `{ sessionId, seq, tokenBaseline, lastTurnIndex, lastFiltered, lastFilterTs, pendingBloatHits }`.
- `getRuntime(sessionId)` → mutable reference (creates fresh on first access). `nextSeq` → pre-increment. `resetRuntime(sessionId)` → delete from map (session_start). `clearAll` → wipe all.
- `freshRuntime(sessionId)` constructs defaults; each gets its OWN `pendingBloatHits: []` array.
- **P3 delta (M2):** add `shrinkMissCounts: Map<string, number>` (keyed by shrink marker id).
- **P3 delta (M3):** add `aboveHighWater: boolean` (default false).
- `resetRuntime` already wipes the entire entry, so new fields are automatically reset on session_start.

### transforms.ts (1268 lines) — Pi-free pure pipeline
- `filterPipeline(messages, markers, config, branchEntries)` — rewinds oldest-first, then shrinks oldest-first. Returns `MessageLike[]`.
- `applyShrink(messages, marker, branchEntries)` — PINNED-FIRST: if `marker.pinnedEntryId`, resolve via `resolvePinnedShrink`; else `resolveShrinkTarget`. No-match → same reference (no-op).
- `resolvePinnedShrink(messages, branchEntries, pinnedEntryId)` → `number | null` — resolves a stable ENTRY id to a message index by identity.
- `resolveShrinkTarget(messages, target)` → `number | null` — live resolution of the 3-arm ShrinkTarget union.
- `MessageLike`, `BranchEntry`, `MarkerBundle`, `ShrinkMarkerLike`, `RewindMarkerLike` — structural types (0 imports from Pi).
- **P3 delta:** filterPipeline stays Pi-free. The stale-retirement logic lives in filter.ts's contextHandler (Pi-coupled). It can reuse `resolvePinnedShrink` (already exported) to check if a pinned shrink's target is present.

### tools/shrink.ts (327 lines) — reference for mulligan_cancel tool pattern
- `makeShrinkTool(pi): ToolDefinition<typeof ShrinkParams, ShrinkDetails>` — factory captures `pi` via closure.
- `refusal(reason)` → `{ content: [{type:"text", text: "Mulligan: refused — <reason>."}], details: {} }`.
- Execute body: config gate → validation → advisory match → persist → return feedback. ONE try/catch → refusal on any exception (E13).
- Every return path includes `details` (required by Pi type).

### tools/audit.ts (605 lines) — renderAuditReport
- `renderAuditReport({totalTokens, confidence, rewinds, shrinks, checkpointNames, protectedRoles, rows, filtered})` — PURE.
- "Active markers" line: `${rewinds.length} rewind (${gran}), ${shrinks.length} shrink, ${checkpoints.length} checkpoints [names]`.
- **P3 delta:** extend to list cancelled markers as retired (acceptance c). `readMarkers` now returns `cancelledIds`.

### index.ts (57 lines) — wiring
- `pi.registerTool(makeRewindTool(pi))`, `makeShrinkTool(pi)`, `makeCheckpointTool(pi)`, `auditTool` (plain const, no factory).
- `registerFilterHandler(pi)`, `registerBloatReminder(pi)`, `registerTurnEndMetric(pi)`.
- `session_start` → `resetRuntime(sessionId)`. `session_shutdown` → `clearAll()`.
- **P3 delta:** add `pi.registerTool(makeCancelTool(pi))`.

## Test patterns (vitest)
- Tests live in `test/` with per-file fakes: `makePi()` (hand-rolled fake ExtensionAPI capturing appendEntry/sendMessage/setLabel), `makeCtx()` (fake ExtensionContext with scripted sessionManager).
- `clearAll()` before/after each test (shared runtime map).
- `vi.mock("../src/transforms.js", ...)` in filter.test.ts to control filterPipeline.
- Builder helpers: `rewindData(seq, id)`, `shrinkData(seq, id)`, `metricData(seq, grew, bloat)`, `customEntry(customType, data)`.

## Not implemented anywhere in src/ (confirmed via grep)
No `cancel`, `driftWindowTurns`, `highWaterFraction`, `maxActive`, `staleAfterFires`, `aboveHighWater`, `shrinkMissCounts` — all three feature groups are greenfield.