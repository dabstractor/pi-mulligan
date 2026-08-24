# Research notes — P1.M1.T2.S2 (enforce issuing-turn span on both shrink paths)

## Verified code state (read, not assumed)

### filterPipeline shrink pass — src/transforms.ts:~1562-1606
- Loop: `for (const sh of stableSortBySeq(shrinks))` operating on reduced array `m`, with `reducedToOrig` (ascending orig indices) and `removedOrig` (Set) maintained by the rewind phases.
- PINNED branch (in filterPipeline itself): `origIdx = resolvePinnedShrink(messages, branch, pinnedId)` (ORIGINAL space) → `removedOrig.has(origIdx)` → binary-search `reducedToOrig` for origIdx → `applyShrinkAt(m, sh, reducedIdx)`. NO span check today.
- LIVE branch: `m = applyShrink(m, sh, branchEntries)` — 3-arg call; applyShrink (:1030) calls 2-arg `resolveShrinkTarget(messages, target)` (unbounded).

### resolveShrinkTarget — transforms.ts:827
- Already accepts optional 3rd `span?: {start,end}`, clamps defensively, searches `[lo,hi)` only, undefined → full range. S1/T1.S2 delivered this. So the LIVE path needs only SPAN THREADING, no resolver change.

### markerTurnSpan — contract from P1M1T2S1/PRP.md (in-flight, treat as done)
- `markerTurnSpan(messages, branchEntries, markerEntryId): {start,end}|null` — ORIGINAL message space, `{start: iLastUserBeforeMarker+1, end: messages.length}`; null on compacted-head/absent/misaligned/non-array. Pure, never throws.
- `ShrinkMarkerLike.markerEntryId?: string`, threaded by readMarkers (filter.ts mulligan:shrink push). Read via `readOwn(sh,"markerEntryId")`.

### Ruling — architecture/scope_guard_design.md §1-2
- Bound = marker's ISSUING turn (NOT fire-time current turn). In-span markers keep applying forever (persistence/cache rationale); guard no-ops markers whose target predates their own turn (malformed/legacy).
- Recommended live-path mechanics: compute span in ORIGINAL space, translate/clamp into reduced space via reducedToOrig; conservative — if boundary can't be translated, no-op; never widen.

### Callers of applyShrink
- Only filterPipeline calls applyShrink (grep confirms single live call site at :1603). Adding an OPTIONAL 4th param `span?` is backward compatible; applyShrinkAt stays 3-arg (index pre-resolved + already span-checked by caller).

### filter.ts stale-retirement pass (:380-410)
- Uses resolvePinnedShrink against pre-filter messages + shrinkMissCounts. NO change needed: a permanently out-of-scope pinned marker misses every fire → auto-retires after staleAfterFires. Document in wrap-up only.

### Testing
- Pure tier: `npx vitest run test/transforms.test.ts` / `test/filter.test.ts`. Scope-guard test LOCK is P1.M1.T3.S2 — this PRP only keeps the suite green.

## Translation math (span → reduced space)
`reducedToOrig` is ascending. lowerBound(arr, v) = first index with arr[i] >= v.
- `rStart = lowerBound(reducedToOrig, span.start)` — first reduced index whose orig >= span.start. Original indices < span.start are excluded (conservative clamp: excludes anything before the boundary, never widens).
- `rEnd = (span.end >= messages.length) ? reducedToOrig.length : lowerBound(reducedToOrig, span.end)`.
- Valid span only if `rStart < rEnd` else no-op (empty reduced span).
- Boundary "cannot be translated" cases: all clamped by lowerBound semantics — the resulting range is always a SUBSET of [span.start, span.end) mapped into survivors; never wider.
- PINNED check is simpler: `origIdx >= span.start && origIdx < span.end` in ORIGINAL space.
- `rEnd` must also be `<= m.length` — lowerBound/reducedToOrig.length guarantees this.