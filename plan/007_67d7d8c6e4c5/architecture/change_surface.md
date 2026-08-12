# Change Surface — v1.1 Delta

## Verified Touchpoints (exact line numbers from codebase research)

### Change 1: Remove `mulligan_checkpoint` agent tool

**`src/index.ts`:**
- Line 10: `import { makeCheckpointTool } from "./tools/checkpoint.js";` — REMOVE
- Line 49: `pi.registerTool(makeCheckpointTool(pi));` — REMOVE
- Line 17 JSDoc: "all 5 agent-callable tools" — UPDATE to "4"
- Line 44 comment: "Register all 5 agent-callable tools" — UPDATE to "4"

**`src/tools/checkpoint.ts`:** Do NOT delete yet (Phase 2 extracts `validCheckpointName` + `NAME_RE`). Exports used:
- `validCheckpointName` (line 74) — EXPORTED, reusable
- `NAME_RE` (line 66) — module-private (`/^[a-z0-9_-]{1,40}$/`), needs export or re-export
- `makeCheckpointTool` (line 182) — still used by `test/integration/smoke.ts` + `test/tools/checkpoint.test.ts` (leave as dead code or extract then delete)

**Tests affected:**
- `test/index.test.ts:66-80` — asserts 5 tools registered → update to 4
- `test/integration/smoke.ts:40,253,269` — imports/calls `makeCheckpointTool` → repurpose or remove
- `test/tools/checkpoint.test.ts` — leave (Phase 2 will repurpose/delete)
- `test/edge-cases.test.ts` — references to "5 tools" → update
- `test/tools/audit.test.ts` — references to checkpoint-as-agent-tool → update

### Change 2: Remove `to_previous_prompt` (39 test occurrences across 6 files)

**`src/transforms.ts` (the core):**
- Lines 319-323: `resolveLastTurn` signature — REMOVE `opts` parameter → `resolveLastTurn(messages, excludeToolCallId?)`
- Line 332: `const nuclear = ...` — REMOVE
- Lines 334-344: nuclear refusal block (`iFirstUser` scan) — REMOVE
- Line 373: `if (nuclear) remove.push(iLastUser)` — REMOVE
- Lines 286-318: JSDoc — UPDATE (remove nuclear language, state v1.1 guardrail)
- Line 1123: `RewindMarkerLike.options` type — keep `to_previous_prompt?` optional (legacy reads), add JSDoc "legacy v1.0 field"
- Lines 1491-1495: `filterPipeline` call — DROP `rw.options` arg → `resolveLastTurn(m, excludeId)`

**`src/tools/rewind.ts`:**
- Lines 109-114: `RewindParams.to_previous_prompt` — REMOVE
- Line 444: `resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId)` — UPDATE to `resolveLastTurn(messages, toolCallId)`
- Lines 605-610: BUG-006 refusal block — REMOVE (dead code)
- Lines 618-629: `payload.options` — stop emitting `to_previous_prompt`; emit `{ protect: config.rewind.protectedRoles }` only

**`src/markers.ts`:**
- Line 60: `options.to_previous_prompt?: boolean` — keep OPTIONAL, add JSDoc "legacy v1.0 field; ignored by v1.1 resolver"

**Test files (39 occurrences):**
- `test/transforms.test.ts` (13) — remove nuclear test cases, update `resolveLastTurn` calls, strengthen guardrail assertions
- `test/tools/rewind.test.ts` (11) — remove nuclear BUG-006 test, update RewindArgs type test, update persisted options assertions
- `test/edge-cases.test.ts` (8) — remove nuclear cases, update rewindParams helper
- `test/integration/smoke.ts` (4) — update rewindNow helper, remove F-protected nuclear scenario
- `test/markers.test.ts` (2) — update options assertions
- `test/tools/cancel.test.ts` (1) — update options assertion

### Change 3: Guardrail (principle 7) — enforced by construction

No code change needed beyond #2. `protectedOk` already only enforces `first:user` (verified `transforms.ts:1230-1267`). Once `to_previous_prompt` is gone, `last_turn` always keeps the latest user message by construction.

### Change 4: Agent-attributable drift delta (D10)

**`src/tokens.ts`:** ADD `estimateAgentTokens(messages: MessageLike[]): number` — sum of `estimateTokens` over messages where `role !== "user"`. Pure, 0-import, unit-testable.

**`src/nudges.ts:223-225`:** In `turnEndMetricHandler`, replace `estimateTokens(rt.lastFiltered).tokens` with `estimateAgentTokens(rt.lastFiltered)`. Keep `ctx.getContextUsage()?.tokens ?? 0` fallback unchanged.

### Change 5: `/mulligan_audit` human command

**`src/commands.ts` (NEW):** `makeAuditCommand(pi)` — reuses `renderAuditReport`, `computeFilteredTotal`, `listCheckpoints` from `src/tools/audit.ts`. Output to `ctx.ui` (notify/transcript), NEVER `event.messages`.

**`src/index.ts`:** `pi.registerCommand("mulligan_audit", { description, handler })`.

### Change 6: Active-checkpoint banner

**`src/config.ts`:** ADD `ui: { activeCheckpointBanner: boolean }` to `MulliganConfig` + `DEFAULT_CONFIG` (default `true`).
**`src/settings.ts`:** No change needed (deep merge handles nested keys).

**`src/banner.ts` (NEW):** `reconcileBanner(ctx)` — scans active checkpoints, sets/clears widget `mulligan:active-checkpoint`.

**Hook points:**
- `src/commands.ts` checkpoint set/revoke → call `reconcileBanner(ctx)` after mutation
- `src/index.ts` `session_start` handler → call `reconcileBanner(ctx)` after `resetRuntime`
- `src/filter.ts` `contextHandler` → call `reconcileBanner(ctx)` at tail (before `return { messages }`)

### index.ts Multi-Touch Coordination

`index.ts` is touched by:
1. P1.M3.T1.S1 — remove checkpoint tool import + registration
2. P2.M1.T1.S2 — register `/mulligan_checkpoint` + `/mulligan_checkpoint_revoke`
3. P2.M2.T1.S2 — register `/mulligan_audit`
4. P2.M3.T1.S3 — add `reconcileBanner(ctx)` to `session_start` handler

**Dependency order:** P1.M3 → P2.M1 → P2.M2 → P2.M3

### src/tools/checkpoint.ts lifecycle

- Phase 1: unregistered dead code (exports still used by tests)
- Phase 2: extract `validCheckpointName` + `NAME_RE` into `commands.ts` (or shared util), then delete checkpoint.ts + checkpoint.test.ts
- Decision: **re-export from checkpoint.ts** into commands.ts (avoid churn); the file stays until Phase 2.M1 extracts and then it can be deleted.

## Backward Compatibility

- Old persisted markers with `options.to_previous_prompt` are read harmlessly (field stays optional; resolver ignores it). No migration.
- Old `mulligan:checkpoint:` labels set by v1.0 agent tool still work as rewind targets (label mechanism unchanged).
- `RewindMarkerLike.options` type keeps `to_previous_prompt?` for type-compat with old persisted data.