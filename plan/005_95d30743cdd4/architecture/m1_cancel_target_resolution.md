# M1 Architecture — `mulligan_cancel` Target-Based API (Headline Change)

## Problem

An id captured at issue-time (`markerId` = `getLeafId()` entry id) is fragile **by construction**: the toolkit's own operations (`shrink`/`rewind`) can hide the very message that carried the opaque `markerId`. A content/role `target` hint re-resolves live each turn (same compaction-robustness `mulligan_shrink` already enjoys).

## Current state (verified)

`src/tools/cancel.ts` (275 LOC):

- **Schema:** `CancelParams = Type.Object({ markerId: Type.String({...}) })` — id-only
- **Resolution (step 3):** scans `ctx.sessionManager.getEntries()` for `entry.id === params.markerId` ∧ `customType ∈ {"mulligan:rewind","mulligan:shrink"}` → reads `data.id` (the uuid) via `readOwn`
- **Steps 4–7:** operate on the uuid (`targetUuid`):
  - Step 4: not-found → no-op (`cancelled:false`)
  - Step 5: already-cancelled → idempotent no-op
  - Step 6: `appendCancelMarker(pi, ctx, {targetId: targetUuid})`
  - Step 7: return `cancelled:true, markerId`
- **Filter side (`filter.ts` readMarkers):** drops by uuid `data.id` ∈ `cancelledIds` — **UNCHANGED**

## Target design

### New `CancelParams` schema (spec/05 §5 verbatim)

```ts
export const CancelParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({...}) }),
    Type.Object({
      by_tool_name: Type.String({...}),
      occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
    }),
    Type.Object({ by_content_includes: Type.String({...}) }),
  ], { description: "..." }),
  markerId: Type.Optional(Type.String({...})),
}, { description: "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present." });
```

This is **structurally identical** to `ShrinkParams.target` in `shrink.ts` (verified — same 3-arm union).

### Target resolution → marker uuid (step 3 rewrite)

The core challenge: resolve the `target` hint → a matched message → find the **active marker that covers that message** → read its uuid `data.id`.

#### Reuse — `resolveShrinkTarget` (transforms.ts, line 758, EXPORTED)

```ts
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null
```

Pure resolver. Returns a message INDEX or null. Already used by `shrink.ts:resolveTargetEntryId`. **No new resolver code needed.**

#### Message snapshot builder (mirror `shrink.ts:resolveTargetEntryId`)

`shrink.ts` builds its snapshot via:
```ts
const entries = ctx.sessionManager.buildContextEntries();
const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
```

Cancel must build the SAME snapshot. **Option A:** duplicate the 2-liner inline in cancel.ts (simplest, no new exports). **Option B:** extract a shared `buildMessageSnapshot(ctx)` helper (mirrors the P4 `computeFilteredTotal` extraction precedent). **Recommended: Option A** (only 2 lines; extraction adds ceremony for minimal DRY benefit — the snapshot is used differently in each tool).

#### Covering logic — which markers "cover" a matched message?

Given a matched message at index `i`, scan active markers:

1. **Shrink markers:** a shrink covers the message its OWN `target` resolves to. For each active `mulligan:shrink` marker, resolve `marker.target` against the same snapshot → if it yields index `i`, that marker covers the message. (Also check `marker.pinnedEntryId` — if the pinned entry's messages include index `i`, it covers.)

2. **Rewind markers:** a rewind covers ALL messages in its hidden span (`hideEntryIds`). For each active `mulligan:rewind` marker, check if the message at index `i` maps to an entry id in `marker.hideEntryIds`.

3. **LIFO selection:** among all covering markers, pick the **most recent** by `seq` (highest seq = most recent).

#### Reading marker fields defensively

All marker reads go through the existing local `readOwn`/`isRecord` clones (already in cancel.ts). Fields to read per marker entry:
- `entry.id` — the entry id
- `entry.customType` — `"mulligan:rewind"` or `"mulligan:shrink"`
- `entry.data.id` — the uuid (target for cancel)
- `entry.data.target` — the shrink target (for covering check)
- `entry.data.pinnedEntryId` — pinned shrink target
- `entry.data.hideEntryIds` — rewind hidden span
- `entry.data.seq` — for LIFO ordering
- `entry.customType === "mulligan:cancel"` — already-cancelled check (step 5)

#### Entry ID ↔ message index mapping

To check if a marker covers a message, we need to map message indices back to entry ids. `shrink.ts` has `entryIdAtMessageIndex(entries, index)` (module-private). For cancel, we need the reverse: given the matched message index, what entry id produced it? This is exactly `entryIdAtMessageIndex` — but it's private in shrink.ts.

**Recommendation:** duplicate the small `entryIdAtMessageIndex` helper in cancel.ts (it's ~15 lines, same cursor-walk logic). Or, for the rewind covering check, simply check if any message produced by an entry in `hideEntryIds` includes index `i` — this can be done by building an `entryId → messageIndices` map once from the snapshot.

### markerId fallback

If `params.markerId` is set (or target matched nothing and markerId present), scan for `entry.id === markerId` ∧ `customType ∈ {rewind,shrink}` → read `data.id`. **If both given, `markerId` wins.**

### What stays UNCHANGED

- Steps 4 (not-found no-op), 5 (already-cancelled idempotency), 6 (persist uuid as `targetId`), 7 (return) — they operate on the uuid.
- `CANCEL_DESC` gets updated wording (the string IS the LLM-facing doc).
- `CancelDetails`, `refusal()`, `readOwn`/`isRecord` — unchanged.
- The outer try/catch (E13) — unchanged.
- `filter.ts` cancel-drop logic — UNCHANGED (drops by uuid `data.id`).

## API surfaces verified

| Surface | Location | Signature | Notes |
|---|---|---|---|
| `resolveShrinkTarget` | `transforms.ts:758` | `(messages: MessageLike[], target: ShrinkTarget) => number \| null` | EXPORTED, pure, Pi-free |
| `MessageLike` | `transforms.ts:53` | structural type (index signature) | EXPORTED |
| `ShrinkTarget` | `transforms.ts:728` | discriminated union (3 arms) | EXPORTED |
| `sessionEntryToContextMessages` | `@earendil-works/pi-coding-agent` | `(e: SessionEntry) => AgentMessage[]` | re-exported by pi |
| `buildContextEntries` | `ctx.sessionManager` | `() => SessionEntry[]` | compaction-aware snapshot |
| `getEntries` | `ctx.sessionManager` | `() => SessionEntry[]` | raw entries (cancel already uses this) |
| `readOwn` / `isRecord` | cancel.ts (local clones) | defensive read helpers | already present |

## Risks & mitigations

1. **Covering logic complexity:** the shrink-covering check requires resolving each shrink's `target` against the snapshot — this is O(n×m) where n = markers, m = messages. Bounded (markers ≤ maxActive/maxDepth; messages are session-bounded). Acceptable.

2. **Rewind hideEntryIds covering:** `hideEntryIds` holds ENTRY ids, not message indices. To check covering, map the matched message index → its entry id (via the cursor walk), then check membership in `hideEntryIds`. This is the reverse of `entryIdAtMessageIndex`.

3. **No active marker covers:** safe no-op (`cancelled:false`, nothing appended) — step 4 behavior.