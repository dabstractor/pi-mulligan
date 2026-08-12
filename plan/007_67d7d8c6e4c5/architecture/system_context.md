# System Context — pi-mulligan v1.0 (pre-v1.1 codebase)

## Current State

All tests green. The codebase implements v1.0 of the Mulligan Pi extension. This delta (v1.1) makes six changes against the v1.0 codebase.

## Source Files & Their Roles

| File | Lines | Role | Pi-coupled? |
|------|-------|------|-------------|
| `src/transforms.ts` | ~1569 | Pure-core filter pipeline (0 imports). Hosts `resolveLastTurn`, `resolveCheckpoint`, `protectedOk`, `filterPipeline`, `partitionIntoUnits`. | NO |
| `src/tools/rewind.ts` | ~730 | `mulligan_rewind` agent tool. Hosts `RewindParams` schema, `rewindExecute`, `resolvePreview`, `checkpointExists`. | YES |
| `src/tools/checkpoint.ts` | ~196 | `mulligan_checkpoint` agent tool. Hosts `makeCheckpointTool`, `validCheckpointName`, `NAME_RE`, `CheckpointParams`. | YES |
| `src/tools/audit.ts` | ~707 | `mulligan_audit` agent tool. Hosts `renderAuditReport`, `computeFilteredTotal`, `listCheckpoints`, `auditTool`. | YES |
| `src/tools/shrink.ts` | — | `mulligan_shrink` agent tool. | YES |
| `src/tools/cancel.ts` | — | `mulligan_cancel` agent tool. | YES |
| `src/markers.ts` | ~498 | Pi-coupled persistence layer. Hosts `RewindMarker`, `setCheckpoint`, `appendRewindMarker`. | YES |
| `src/config.ts` | ~390 | Pi-free config validation. Hosts `MulliganConfig`, `DEFAULT_CONFIG`, `validateConfig`, `getConfig`, `setConfig`. **NO `ui` field exists yet.** | NO |
| `src/settings.ts` | ~137 | Pi-coupled settings reader. Hosts `loadMulliganConfig`. | YES |
| `src/tokens.ts` | ~230 | Pure token estimation (0 imports). Hosts `estimateTokens`, `MessageLike`, `messageCharLength`. | NO |
| `src/nudges.ts` | ~560 | Nudge handlers. Hosts `turnEndMetricHandler`, `shouldNudge`, `shouldHighWater`. | YES |
| `src/filter.ts` | ~434 | Context event handler glue. Hosts `contextHandler`, `registerFilterHandler`. | YES |
| `src/index.ts` | ~77 | Factory entry point. Registers 5 tools + 3 event handlers + session lifecycle. | YES |
| `src/runtime.ts` | — | In-memory session runtime state. | NO |
| `src/notes.ts` | — | Note rendering/validation. | NO |
| `src/ledger.ts` | — | File ledger extraction. | NO |
| `src/log.ts` | — | Logging. | NO |

## Tool Registration (index.ts:47-51)

Five tools registered:
1. `mulligan_rewind` — `pi.registerTool(makeRewindTool(pi))`
2. `mulligan_shrink` — `pi.registerTool(makeShrinkTool(pi))`
3. `mulligan_checkpoint` — `pi.registerTool(makeCheckpointTool(pi))` ← **TO BE REMOVED**
4. `mulligan_audit` — `pi.registerTool(auditTool)` (plain const, no pi factory)
5. `mulligan_cancel` — `pi.registerTool(makeCancelTool(pi))`

## Key Architectural Patterns

1. **Tool factories capture `pi` (ExtensionAPI) via closure** — `makeRewindTool(pi)`, `makeShrinkTool(pi)`, `makeCheckpointTool(pi)`, `makeCancelTool(pi)`. `auditTool` is the exception (plain const, no pi needed).
2. **Event handlers** — `contextHandler` (filter), `bloatReminderHandler` (nudge A), `turnEndMetricHandler` (nudge B).
3. **Pure/helpers layer** — `transforms.ts` and `tokens.ts` are 0-import pure modules. They never import Pi.
4. **Markers** — persisted via `pi.appendEntry` as custom entries with `MulliganEnvelope` schema. Read via `ctx.sessionManager.getEntries()`.
5. **Labels** — `pi.setLabel(targetId, labelString)` / `ctx.sessionManager.getLabel(id)`. Checkpoint labels use prefix `mulligan:checkpoint:<name>`.

## No `src/commands.ts` or `src/banner.ts` exist — both are NEW files for v1.1.

## No `config.ui` field exists — must be added for `activeCheckpointBanner`.