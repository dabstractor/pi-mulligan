# Research Notes — P1.M2.T1.S2

## Current state of src/tools/shrink.ts (verified)
- `refusal(reason)` builds `{content:[{type:'text',text:`Mulligan: refused — ${reason}.`}],details:{}}` — returns, never throws.
- `describeTarget` (:~185): has a `by_content_includes` branch returning `message containing "..."` — TO DELETE.
- `targetIsStructurallyValid` (:~215): has a `by_content_includes` branch checking isNonEmpty — TO DELETE.
- `resolveTargetEntryId` (:~258): try/catch → `{entryId, origTokens}`; snapshots via `ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages)`, calls `resolveShrinkTarget(messages, target)` (2-arg, full-range), maps message index → ENTRY id via `entryIdAtMessageIndex`, estimates origTokens via `estimateTokens`.
- `shrinkExecute` step order: config gates → replacement non-empty → structural validity → advisory match+pin → `appendShrinkMarker(pi, ctx, {target, replacement, reason, ...(entryId ? {pinnedEntryId: entryId} : {})})` → ui.notify echo → feedbackText + optional `shrinkOrientationLine(1, tokensShed)` when markerId truthy.
- `feedbackText(matched)` = `Mulligan: shrink recorded. Matched: yes|no.`

## Dependencies shipped
- `currentTurnSpan(messages)` — src/transforms.ts:379, exported, pure: `{start: iLastUser+1, end: length}`; no user msg → start 0; non-array → {0,0}.
- `resolveShrinkTarget(messages, target, span?)` — transforms.ts:827: 3-arg with optional span; both surviving arms search `[start,end)` only; content arm returns null (deleted); span undefined → full range (cancel's full-history usage).
- P1.M2.T1.S1 (parallel, in flight): 2-arm ShrinkParams + current-turn descriptions + SHRINK_DESC reword. Assume it lands; ShrinkArgs target is the 2-arm union. Schema rejects content arm at host validation — but code-level defensiveness in describeTarget/targetIsStructurallyValid still sees unknown shapes at runtime (prepareObjectArgs shim decodes strings to objects before host validation… actually shim runs pre-validation so host still rejects; keep defensive fallbacks).

## Test harness (test/tools/shrink.test.ts)
- `makeCtx({contextEntries, leafId, throwOnBuildContextEntries, hasUI, ...})` scripts `sessionManager.buildContextEntries()`; notifyCalls recorded. No external services.
- Tests currently cover 3-arm matchers; the earlier-turn/no-match hard-refusal tests belong to P1.M2.T2.S1, NOT this item. This item only keeps the existing suite green (some existing cases will need updating to v2.0 semantics — e.g., cases f/g that script out-of-turn matches now hit refusal; align minimally so `npx vitest run` passes without rewriting the full R2 lock).

## Spec anchors (plan/008_1c8ca4d1826d/prd_snapshot.md / delta_prd.md)
- §2 step 3 v2.0: hard refusal text EXACT: `that result is from a previous turn; only this turn's tool calls can be shrunk` → rendered `Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.`
- E8/E13: advisory throw (buildContextEntries throws) → entryId null, origTokens 0 → persist matched:false (orientation ~0 path stays reachable — filter guard makes unverifiable marker safe).
- E13: everything wrapped, never throws.