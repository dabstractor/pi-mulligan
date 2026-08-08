# Fix Design: Pinning Stable Anchors at Marker Creation Time

## Problem Statement

The three bugs share one root cause: **rewind markers store RELATIVE specs that `filterPipeline`
re-resolves against the constantly-growing message list on every context fire.** When the agent
resumes work after a rewind (the documented, intended usage), new messages are appended, and the
relative spec re-targets onto the wrong content.

## Recommended Fix (per PRD §Recommendations)

> "Pin rewind targets at marker-creation time (e.g. capture the entry ids / a stable anchor of the
> span to hide) instead of re-resolving a relative spec every fire."

## Design: Pin Entry IDs at Rewind-Creation Time

### Core Insight

Pi session entries have **permanent, stable `id` fields**. Messages are derived from entries via
`sessionEntryToContextMessages`. If we capture the **entry ids** of the messages to hide at
rewind-creation time, those ids remain stable as the session grows. New work produces NEW entries
with NEW ids that are NOT in the pinned set → their messages are visible (correct).

### Why NOT one-shot?

A one-shot marker (consumed after first application) is **incompatible** with "permanent soft-delete"
in this architecture: the filtered view is REBUILT every fire from the original message list + markers.
If the marker is consumed after one fire, subsequent fires rebuild from the original messages with no
marker → content leaks back. Permanent hiding requires a marker that persists AND targets stably.

### Why entry IDs (not message indices)?

Message indices can shift after compaction (the message list is compaction-aware; `getBranch()` is not).
Entry IDs are permanent anchors. The entry→message mapping at filter time uses the SAME walk as
`resolveCheckpoint` (root→leaf, counting 1 message per context-producing entry), which already handles
compaction by refusing safely.

---

## Change 1: RewindMarker gains `hideEntryIds` field

**File**: `src/markers.ts` — `RewindMarker` interface + `RewindMarkerInput` type.

```typescript
export interface RewindMarker extends MulliganEnvelope {
  // ... existing fields ...
  /** NEW: Stable entry IDs of the messages to hide, pinned at marker-creation time.
   *  When present, filterPipeline resolves these IDs → current message indices and removes them.
   *  Absent (old markers) → falls back to relative re-resolution (backward compat). */
  hideEntryIds?: string[];
}
```

**File**: `src/transforms.ts` — `RewindMarkerLike` interface (the structural slice filterPipeline reads).

```typescript
export interface RewindMarkerLike {
  // ... existing fields ...
  hideEntryIds?: string[];  // NEW — pinned stable anchors
}
```

**Impact**: Additive only. Old markers without `hideEntryIds` still work (backward-compat fallback).
No existing tests break (the field is optional).

---

## Change 2: Rewind tool captures entry IDs at creation time

**File**: `src/tools/rewind.ts` — `resolvePreview` function.

Currently `resolvePreview` builds a snapshot via `ctx.sessionManager.buildContextEntries()`, resolves
the removal set (message indices), and returns `{ ledger, k }`. The fix: ALSO map those message indices
back to session entry IDs.

**Algorithm** (new helper, `captureHideEntryIds`):
```
entries = ctx.sessionManager.buildContextEntries()  // compaction-aware snapshot
messages = entries.flatMap(sessionEntryToContextMessages)
// resolve removal set (existing code — works correctly against CURRENT snapshot)
remove = resolveByGranularity(messages, ...)  // message indices
// map remove indices → entry ids
hideEntryIds = []
cursor = 0
for each entry in entries:
  yield = sessionEntryToContextMessages(entry).length  // typically 1
  if any index in [cursor, cursor+yield) is in remove set:
    hideEntryIds.push(entry.id)
  cursor += yield
return hideEntryIds
```

Store `hideEntryIds` in the rewind marker payload (alongside existing `granularity`, `options`, etc.).

**Key property**: The removal set is resolved ONCE at creation time against the CURRENT snapshot —
the correct session state. The entry IDs are then stable forever.

---

## Change 3: New resolver `resolvePinnedHide` at filter time

**File**: `src/transforms.ts` — new exported function.

```typescript
export function resolvePinnedHide(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  hideEntryIds: string[],
): number[]
```

**Algorithm** (generalizes `resolveCheckpoint`'s entry→message walk):
```
1. Build a Set of hideEntryIds for O(1) lookup.
2. ctxEntries = [...branchEntries].reverse()  // root→leaf
     .filter(isContextProducingType)
3. Walk ctxEntries with msgCursor (messages consumed):
   for each entry:
     yield = entryMessageYield(entry)  // 1 for message/custom_message/branch_summary
     if yield < 0 (compaction/unknown) → return []  (refuse safely — alignment indeterminate)
     if msgCursor + yield > messages.length → return []  (alignment lost)
     if entry.id ∈ hideEntryIds:
       for j in [msgCursor, msgCursor+yield):
         remove.push(j)
     msgCursor += yield
4. Return remove (ascending message indices).
```

This is **pairing-safe by construction**: it removes WHOLE entries (each entry = 1 message). An
assistant message + its toolResults are separate entries, but the rewind tool's `resolvePreview`
already resolves at the UNIT level (resolveLastToolCallGroup returns unit indices, resolveLastTurn
returns unit-aware indices). So the captured entry IDs correspond to whole units, not partial ones.

**Compaction handling**: Identical to resolveCheckpoint — if a compaction entry is on the walk,
return `[]` (refuse safely, fail-open). The rewind effectively no-ops until the session stabilizes.

---

## Change 4: filterPipeline dispatches on `hideEntryIds` first

**File**: `src/transforms.ts` — `filterPipeline` rewind loop.

```typescript
for (const rw of stableSortBySeq(rewinds)) {
  const hideEntryIds = readOwn(rw, "hideEntryIds");
  let remove: number[];

  if (Array.isArray(hideEntryIds) && hideEntryIds.length > 0) {
    // NEW PATH: pinned stable anchors — permanent hiding across session growth
    remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIds);
  } else if (granularity === "last_tool_call_group") {
    // LEGACY FALLBACK: relative re-resolution (old markers without hideEntryIds)
    remove = resolveLastToolCallGroup(...) ?? [];
  } else if (granularity === "last_turn") {
    // LEGACY FALLBACK
    remove = resolveLastTurn(...).remove;
  } else if (granularity === "checkpoint") {
    // LEGACY FALLBACK
    remove = resolveCheckpoint(...)?.remove ?? [];
  }

  if (!protectedOk(m, remove, config)) continue;
  m = applyRewind(m, remove);
}
```

**Backward compatibility**: Old markers (no `hideEntryIds`) use the legacy relative resolution. They're
still buggy, but they were created by the buggy code. New markers always have `hideEntryIds`.

---

## Change 5: Fix `setCheckpoint` to label a stable entry (BUG-003 root)

**File**: `src/markers.ts` — `setCheckpoint` function.

**Problem**: `getLeafId()` at tool-execute time returns a transient in-progress entry. Labeling it
causes `resolveCheckpoint` to map it to the last message index → empty removal set.

**Fix**: Instead of labeling `getLeafId()` directly, walk `getBranch()` backwards to find the last
**stable context-producing entry** (an entry of `type: "message"` that has a real `message` field
with `role`/`content` — NOT the transient leaf). Label THAT entry's id.

```typescript
export function setCheckpoint(pi, ctx, name): SetCheckpointResult {
  try {
    const branch = ctx.sessionManager.getBranch();  // root→leaf order
    // Walk backwards (leaf→root) to find the last stable message entry
    let stableId: string | null = null;
    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i];
      if (e.type === "message" && e.message && e.message.role) {
        stableId = e.id;
        break;
      }
      // Also accept custom_message entries as stable checkpoints
      if (e.type === "custom_message") {
        stableId = e.id;
        break;
      }
    }
    if (!stableId) return { error: "no stable entry to checkpoint" };
    pi.setLabel(stableId, `mulligan:checkpoint:${name}`);
    return { entryId: stableId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
```

**Why this works**: The stable entry is a REAL message with content. When `resolveCheckpoint` walks
the branch to map it to a message index, it lands on an actual message (not the transient leaf),
giving a correct `iTarget` and a non-empty removal set.

---

## Change 6: Checkpoint orphan prevention (snap to unit boundary)

**File**: `src/transforms.ts` — `resolveCheckpoint` function (step 5, removal computation).

**Problem**: If the checkpoint target is an assistant message with toolCalls, `iTarget` is the
assistant's index, but its toolResults are at `iTarget+1...` and get removed → orphaned toolCall.

**Fix**: After computing `iTarget`, use `partitionIntoUnits` to find the unit containing `iTarget`.
Snap `iTarget` to the END of that unit (so the whole unit — assistant + results — is kept). Then
remove everything after the snapped boundary.

```typescript
// After iTarget is found (step 4):
// Snap iTarget to the end of its unit (keep the whole unit containing the checkpoint target)
const units = partitionIntoUnits(messages);
for (const unit of units) {
  if (unit.indices.includes(iTarget)) {
    iTarget = Math.max(...unit.indices);  // snap to unit end
    break;
  }
}
// Then remove = indices > iTarget (existing step 5 code)
```

**Why**: Keeping the whole unit prevents orphaning. If the checkpoint is on an assistant with
toolCalls, we keep the assistant AND its results. Everything after is still removed.

---

## Testing Strategy

### Pure-function tests (transforms.test.ts)

New test groups that simulate the **"rewind then resume work" pattern**:

1. **`resolvePinnedHide` — basic**: Given branchEntries + hideEntryIds, correctly maps to message indices.
2. **`resolvePinnedHide` — growth stability**: Same hideEntryIds against a GROWN message list
   (new entries appended) → originally-hidden messages still removed, new work NOT removed.
3. **`filterPipeline` — permanent hiding across fires**: Create a rewind marker with hideEntryIds.
   Fire 1: messages = [u, a(BAD), r(BAD), a(RW), r(RW), note] → BAD hidden.
   Fire 2: messages = [u, a(BAD), r(BAD), a(RW), r(RW), note, a(GOOD), r(GOOD)] → BAD STILL hidden, GOOD visible.
4. **`resolveCheckpoint` — unit snap**: Checkpoint on assistant with toolCalls → whole unit kept.
5. **`setCheckpoint` — stable entry**: Walk getBranch() backwards, skip transient leaf, label stable entry.

### Integration pattern (simulated multi-fire)

The key test pattern that was MISSING from the original suite:

```typescript
it("rewind stays permanent after agent resumes work (BUG-001 regression)", () => {
  // Fire 1: right after rewind
  const msgs1 = [user("do"), asst("READ_HOSTNAME"), result("READ_HOSTNAME"),
                 asst("RW1"), result("RW1"), note("mulligan:note")];
  const branch1 = makeBranch(msgs1);  // entries with ids
  const marker = { seq:1, granularity:"last_tool_call_group", hideEntryIds: ["e1","e2"], excludeToolCallId:"RW1" };
  const view1 = filterPipeline(msgs1, { rewinds:[marker], shrinks:[] }, config, branch1);
  expect(view1).not.toContain(msgs1[1]);  // READ_HOSTNAME hidden

  // Fire 2: agent read /etc/os-release (NEW work appended)
  const msgs2 = [...msgs1, asst("READ_OS"), result("READ_OS")];
  const branch2 = [...branch1, makeEntry("READ_OS"), makeEntry("READ_OS_result")];
  const view2 = filterPipeline(msgs2, { rewinds:[marker], shrinks:[] }, config, branch2);
  // READ_HOSTNAME STILL hidden (permanent!), READ_OS visible (new work)
  expect(view2).not.toContain(msgs2[1]);  // READ_HOSTNAME still hidden
  expect(view2).toContain(msgs2[6]);      // READ_OS visible
});
```

### Smoke test enhancement

The F-rewind-core and F-checkpoint smoke scenarios currently only assert that markers PERSIST
(hasRewindMarker:true + notePresent:true). They should ALSO assert that the filtered view actually
hides the target content across subsequent fires. The deterministic path can be enhanced to check
`resultCanaryPresent:false` on the observing inference (the canary is in the hidden span).

---

## File Change Summary

| File | Change | Lines (est.) |
|------|--------|-------------|
| `src/transforms.ts` | Add `resolvePinnedHide`; update `RewindMarkerLike`; update `filterPipeline` dispatch; fix `resolveCheckpoint` unit-snap | ~80 new, ~20 modified |
| `src/markers.ts` | Add `hideEntryIds` to `RewindMarker`/`RewindMarkerInput`; fix `setCheckpoint` stable-entry walk | ~30 new, ~15 modified |
| `src/tools/rewind.ts` | Add `captureHideEntryIds` helper; include `hideEntryIds` in marker payload | ~30 new, ~5 modified |
| `test/transforms.test.ts` | New test groups: `resolvePinnedHide`, permanent-hiding-across-fires, checkpoint unit-snap | ~200 new |
| `test/tools/rewind.test.ts` | Test that `hideEntryIds` is captured and persisted | ~40 new |
| `test/tools/checkpoint.test.ts` | Test that `setCheckpoint` labels a stable entry | ~30 new |
| `test/integration/smoke.ts` | Enhance F-rewind-core/F-checkpoint assertions | ~20 modified |

## Risks & Mitigations

1. **Compaction between rewind-creation and filter**: `resolvePinnedHide` refuses (returns `[]`)
   if a compaction entry is on the walk — fail-open, same as `resolveCheckpoint`. The rewind
   effectively no-ops until the session stabilizes. Acceptable (compaction is rare after a rewind).
2. **Entry ID mismatch after session reload**: Entry IDs are persisted in JSONL and stable across
   reloads (they're UUIDs). No risk.
3. **Backward compat**: Old markers without `hideEntryIds` use the legacy path. They're still buggy
   but were created by buggy code. New markers always have `hideEntryIds`.
4. **Shrink interaction**: Shrinks re-resolve live each fire (by design — they target by content/id,
   not position). A shrink applied to a message that's also hidden by a pinned rewind: the rewind
   removes the message first, then the shrink's target is absent → no-op. This is correct (the
   shrink can't substitute content that's already hidden).