# Research Notes — P1.M1.T2.S1

## Verified code facts (2024 build of the repo, read directly)

- `filterPipeline(messages, markers: MarkerBundle|undefined, config, branchEntries?: BranchEntry[], diag?: RewindDiag[])` at src/transforms.ts:~1390. Shrink pass at ~1546-1567. `branch = Array.isArray(branchEntries) ? branchEntries : []`.
- `ShrinkMarkerLike` (transforms.ts ~1141-1159): `{ seq; target: ShrinkTargetRead; replacement: string; pinnedEntryId?: string }` — NO entry-id field today.
- `MarkerBundle` (transforms.ts:1168): `{ rewinds: RewindMarkerLike[]; shrinks: ShrinkMarkerLike[] }`.
- `resolvePinnedShrink(messages, branchEntries, pinnedEntryId)` (transforms.ts:871): retained-tail walk — finds lastCompactionIdx, tailEntries = entries after it filtered `entryMessageYield(e) > 0`, `tailStartIdx = messages.length - tailEntries.length`, walks tail comparing entry `id`. Returns FIRST message index of the entry, else null. THIS is the cursor-walk precedent to generalize: instead of comparing entry.id === pinnedEntryId and returning the index, we want the index of the entry with id === markerEntryId (marker position), then find last user-role message before it.
- `entryMessageYield(entry)` (transforms.ts:532): 1 for message/custom_message/branch_summary, 2? for compaction? — actually returns -1 (indeterminate) for compaction/unknown. CHECK at impl: JSDoc at :526 says "compaction → 1 in" (compaction entry itself yields the summary message); the function returns -1 for compaction per comments at :476/:657. Use the function's actual return semantics: > 0 = yields that many messages, -1 = indeterminate.
- `entryIdAtMessageIndex(entries, index)` (tools/shrink.ts:228): forward cursor walk `cursor += sessionEntryToContextMessages(e).length`. Reverse problem of ours.
- `readMarkers(ctx)` (filter.ts:118-190): scans `ctx.sessionManager.getEntries()`, `type === "custom"`, customType `mulligan:shrink` → pushes `data` (NOT the entry) into `shrinks`. The marker's own ENTRY id is `readOwn(entry, "id")` — currently DROPPED. So the ONE permitted filter.ts edit: also copy entry id into the bundle object: `shrinks.push({ ...(data as object), markerEntryId: entryId })` or set field — must remain structurally assignable; safest is building a shallow object adding the id under the new `markerEntryId` key.
- `markers.ts` ShrinkMarker has `id: string` = the marker UUID stored in `data.id` — NOT the entry id. Hence the new field must be named distinctly (contract says `markerEntryId?`).
- transforms.ts is Pi-FREE, ZERO imports (hard invariant). isRecord/readOwn module-private, reused.
- Tests live in `test/` (vitest, `npm run test`); typecheck `npm run typecheck` (tsc --noEmit).
- Contract naming: `markerTurnSpan(messages: MessageLike[], branchEntries: BranchEntry[], markerEntryId: string): { start: number; end: number } | null`.

## Key design decisions from scope_guard_design.md §2 (architecture)
- Span computed in ORIGINAL message space: cursor-walk branchEntries (root→leaf) accumulating yields → marker's message position; then scan messages for last `role === "user"` with index < markerMsgPos; span = [iLastUser+1, messages.length).
- Compaction: marker entry is a `custom` entry (yield 0 — not context-producing) so the cursor walk skips it without consuming messages; but the retained-tail alignment trick is needed if a compaction sits before the marker: walk tail-aligned like resolvePinnedShrink. Simplest faithful approach: reuse resolvePinnedShrink-style tail walk to find the marker entry's message-position region; if tailStartIdx < 0 → null (misalignment).
- Marker entry never yields a message → its "position" is the message cursor value when reached. Use `< markerCursor` for user scan (users at/before the marker's turn).
- Fail-safe: null on non-locatable/indeterminate → caller no-ops (P1.M1.T2.S2).