# Research — P1.M2.T3.S2 covering-marker check upgrade

## Current state (src/tools/cancel.ts)
- `resolveTargetUuid(ctx, entries, target)` at ~:256-316; call site ~:387.
- Snapshot: `ctx.sessionManager.buildContextEntries()` flat-mapped via `sessionEntryToContextMessages` → `MessageLike[]` (double-cast GOTCHA).
- Shrink covering check (current): `resolveShrinkTarget(messages, shrinkTarget) === matchedIndex` — LIVE unspanned resolution, deliberately not `pinnedEntryId` (documented :241 — that doc comment must be REWRITTEN by this item).
- Rewind covering: `entryIdAtMessageIndex(snapshotEntries, matchedIndex)` ∈ `data.hideEntryIds`.
- LIFO by `data.seq`; malformed markers skipped; whole body try/catch → null (E13).
- markerId path, idempotency (step 5), no-op/success texts: UNTOUCHED.

## Upstream contracts (assume landed)
- **P1.M1.T1.S2**: `resolveShrinkTarget(messages, target, span?)` — 3rd optional `{start,end}` span; out-of-span → null; omitted = full range.
- **P1.M1.T2.S1**: `markerTurnSpan(messages, branchEntries, markerEntryId)` exported from src/transforms.ts → `{start,end}|null` (marker's ISSUING-turn span, ORIGINAL message space; null = indeterminable: compacted head, not found, misaligned). `ShrinkMarkerLike.markerEntryId?` threaded by filter.ts readMarkers — but cancel reads markers from `getEntries()` directly, so cancel reads `readOwn(entry,"id")` itself (the marker's ENTRY id, NOT `data.id` uuid).
- **P1.M2.T3.S1** (parallel): CancelParams is now 2-arm; `cancelExecute`/`resolveTargetUuid` untouched — this item's edits don't touch schema/strings.

## Branch-read surface
filter.ts:252 uses `ctx.sessionManager.getBranch()` (root→leaf, RAW — carries compacted-away + compaction + tail). markerTurnSpan is designed for exactly that input (see resolvePinnedShrink/resolveLastTurn alignment precedent). Use the same read inside resolveTargetUuid; wrap in the existing try/catch.

## Semantics decision (per item contract + @05 §5 v2.0 / E21)
- covers(shrink, matchedIndex) =
  1. `pinnedEntryId` is a non-empty string AND `pinnedEntryId === matchedEntryId` → PINNED IDENTITY (preferred);
  2. else LIVE fallback: `span = markerTurnSpan(snapshotMessages, branchEntries, shrinkEntryId)`; if span !== null → `resolveShrinkTarget(messages, shrinkTarget, span) === matchedIndex`; if span === null → UNCHANGED unspanned `resolveShrinkTarget(messages, shrinkTarget) === matchedIndex` (cancel is retraction — prefer reachability; document the choice).
- Hint resolution (step ii, resolving params.target) stays FULL-HISTORY: `resolveShrinkTarget(messages, target)` with NO span — cancel acts on the marker, not the old content (@05 §5 v2.0 note: marker resolution is NOT current-turn-scoped).
- Rewind covering, LIFO, idempotency, texts, never-throws: unchanged.

## Consumers
P1.M2.T4.S1 writes the test lock (tests are NOT this item's deliverable beyond keeping suite green).