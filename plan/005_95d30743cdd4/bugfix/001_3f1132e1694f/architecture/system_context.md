# System Context — pi-mulligan Bug Fix (BUG-001 through BUG-006)

## Project Overview

**pi-mulligan** is a Pi coding-agent extension that provides context-management tools (`mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`, `mulligan_cancel`, `mulligan_audit`) and a context-filter pipeline. It intercepts the `context` event before each LLM call, applies persisted rewind/shrink markers, and conditionally injects preventive nudges.

## Architecture Stack

```
src/
├── index.ts          — extension factory + handler registration (wiring)
├── config.ts         — MulliganConfig schema, DEFAULT_CONFIG, validateConfig (fail-safe coercion)
├── runtime.ts        — SessionRuntime (per-session state: lastFiltered, tokenBaseline, flags)
├── settings.ts       — Pi settings.json reader
├── tokens.ts         — estimateTokens, resultBytes (pure token estimation)
├── ledger.ts         — extractFileLedger (pure: messages + indices → file ledger)
├── notes.ts          — validateNote, renderNote, renderBloatReminder, renderDriftNudge
├── markers.ts        — appendRewindMarker, appendShrinkMarker, appendTurnMetric, etc. (Pi-coupled writes)
├── transforms.ts     — PURE transforms: partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn,
│                       resolveCheckpoint, resolvePinnedHide, resolvePinnedShrink, resolveShrinkTarget,
│                       applyRewind, applyShrink, filterPipeline, protectedOk (ZERO Pi imports)
├── filter.ts         — contextHandler (the context event handler), readMarkers (Pi-coupled reads)
├── nudges.ts         — bloatReminderHandler, turnEndMetricHandler, shouldNudge, injectNudge,
│                       shouldHighWater, injectHighWaterNudge, suppressCheck
├── log.ts            — structured JSONL logging
└── tools/
    ├── checkpoint.ts — mulligan_checkpoint tool (makeCheckpointTool(pi) factory)
    ├── rewind.ts     — mulligan_rewind tool (makeRewindTool(pi) factory)
    ├── shrink.ts     — mulligan_shrink tool (makeShrinkTool(pi) factory)
    ├── cancel.ts     — mulligan_cancel tool (makeCancelTool(pi) factory)
    └── audit.ts      — mulligan_audit tool (PLAIN export const — no pi needed)
```

## Key Design Principles

1. **Fail-open (E13)**: Every handler/tool body is wrapped in ONE try/catch → text result. An extension bug NEVER breaks an agent turn.
2. **D7 — Record a spec, not indices**: Rewind markers persist a TARGETING SPEC (granularity + options), resolved AUTHORITATIVELY by the filter on each context fire. New markers also carry `hideEntryIds` (stable ENTRY ids pinned at creation) for permanent hiding.
3. **D5 — Honest bookkeeping**: Token totals use the FILTERED view, never `ctx.getContextUsage().tokens` (which counts hidden tokens).
4. **Soft-over-hard (D2)**: The session tree is NEVER mutated. Only the in-flight context copy is rewritten.
5. **transforms.ts is Pi-FREE**: Zero imports — fully unit-testable in isolation. All Pi interactions happen in filter.ts, markers.ts, and tools/.

## Pi Session Manager API (relevant to bugs)

- `ctx.sessionManager.getEntries()` — raw session entries (append order)
- `ctx.sessionManager.getLabel(targetId)` — latest-wins label resolution (undefined once cleared)
- `ctx.sessionManager.getBranch()` — root→leaf branch entries (carries stable ENTRY ids)
- `ctx.sessionManager.buildContextEntries()` — compaction-aware context entries
- `pi.setLabel(targetId, label)` — set/clear a label on an entry (label=undefined clears)
- **CRITICAL**: Pi's `labelsById` is `Map<targetId, label>` with NO cross-target uniqueness — two distinct targets CAN carry the same label string concurrently.

## Bug Fix Summary

| Bug | Severity | File | Root Cause |
|-----|----------|------|------------|
| BUG-001 | Major | src/tools/rewind.ts:582-623 | Checkpoint consumption loop clears first-found target then breaks; leaves duplicate targets active |
| BUG-002 | Minor | src/config.ts:285-288 | driftWindowTurns floors without `>= 1` guard; 0.5→0 accepted |
| BUG-003 | Minor | src/config.ts:266-269 | maxActive/staleAfterFires not floored; 0.5 accepted verbatim |
| BUG-004 | Minor | src/transforms.ts:789-795 | by_content_includes has no empty-string guard; "" matches messages[0] |
| BUG-005 | Minor | src/tools/audit.ts:545-570 | No config.enabled gate; reports transformed view when disabled |
| BUG-006 | Minor | src/tools/rewind.ts:538-579 | No protected-refusal check between resolvePreview and persist for nuclear-first-user |

## Test Infrastructure

- **Framework**: vitest (`vitest run`)
- **Fakes**: Hand-rolled (NO vi.fn()) — `makePi(opts)` and `makeCtx(opts)` construct plain objects
- **Import paths**: `.js` extensions (ESM/bundler resolution)
- **State reset**: `clearAll()` from runtime.ts + `setConfig(undefined)` in beforeEach/afterEach
- **Naming**: `describe("tool — topic (spec ref)")` → `it("(a) description", ...)`

## Files NOT to Modify

- PRD.md (READ-ONLY)
- .gitignore
- Any source code outside the 4 affected files (rewind.ts, config.ts, transforms.ts, audit.ts)
- Existing tasks.json in other directories