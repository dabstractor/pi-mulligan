# Research: The target→marker covering contract (S2 → S3)

S2's `resolveTargetUuid(ctx, entries, target)` is the code under test for the 7 new cases. This document
records EXACTLY what it does, derived from the S2 PRP contract + transforms.ts:resolveShrinkTarget +
shrink.ts:entryIdAtMessageIndex (all read directly).

## The resolution pipeline (step by step)

1. `snapshotEntries = ctx.sessionManager.buildContextEntries()` — the message snapshot (compaction-aware).
2. `messages = snapshotEntries.flatMap(e => sessionEntryToContextMessages(e))` — flattened to MessageLike[].
3. `matchedIndex = resolveShrinkTarget(messages, target)` — a message INDEX, or null (no match).
   - `by_tool_call_id`: first toolResult with `toolCallId === id`.
   - `by_tool_name`+`occurrence`: among toolResults with `toolName === name`, LAST (default) or FIRST index.
   - `by_content_includes`: FIRST message (ANY role) whose stringified content includes the substring.
4. `matchedEntryId = entryIdAtMessageIndex(snapshotEntries, matchedIndex)` — cursor-walks snapshotEntries,
   returns the ENTRY id of the entry that produced message[matchedIndex].
5. Scan `entries` (getEntries — the markers live HERE) for COVERING markers; LIFO by `data.seq`.

## What "covers" means (THE core logic)

For each entry in `entries` (getEntries result):
- skip unless `customType ∈ {"mulligan:rewind", "mulligan:shrink"}` (notes/turn-metric/cancel excluded).
- read uuid = `data.id` (string, non-empty; else skip — malformed marker).
- **SHRINK covers** iff `resolveShrinkTarget(messages, marker.data.target as ShrinkTarget) === matchedIndex`.
  (The shrink's OWN target resolves to the same matched message.)
- **REWIND covers** iff `Array.isArray(marker.data.hideEntryIds) && marker.data.hideEntryIds.includes(matchedEntryId)`.
  (The matched message's ENTRY id is in the rewind's hidden span.)
- **LIFO**: track `bestUuid` + `bestSeq` (init -Infinity). Replace when `seqNum(0 for malformed) > bestSeq`.
  → the HIGHEST-seq covering marker wins (most recent = most likely the mistake).

Return `bestUuid` (or null if nothing covered). Never throws (try/catch → null).

## What this means for fixtures (DISTINCT ids prove the mapping)

Use DISTINCT values for entry.id vs data.id(uuid) EVERYWHERE:
- Rewind fixture: `id:"entry-rw-1"`, `data.id:"uuid-rw-1"`. The cancel's persisted `targetId` must be
  `"uuid-rw-1"` (NEVER `"entry-rw-1"`). A bug forwarding the entry id fails the assertion.
- Shrink fixture: `id:"entry-sh-1"`, `data.id:"uuid-sh-1"`.

### Rewind fixture needs `hideEntryIds` + `seq`

The existing `makeRewindEntry(entryId, uuid, seq)` hardcodes the note/ledger envelope but NOT `hideEntryIds`.
Extend it to accept `hideEntryIds: string[]`:

```ts
function makeRewindEntry(entryId, uuid, opts: { seq?: number; hideEntryIds?: string[] } = {}): SessionEntry {
  return { ..., data: { ..., id: uuid, hideEntryIds: opts.hideEntryIds ?? [], seq: opts.seq ?? 1, ts:1 } };
}
```

`hideEntryIds` holds ENTRY ids. To make a rewind cover a matched message, put the message's ENTRY id
(the `id` from the contextEntries msgEntry) into `hideEntryIds`.

### Shrink fixture needs a parameterized `target` + `seq`

The existing `makeShrinkEntry(entryId, uuid, seq)` hardcodes `target:{by_tool_call_id:"call-A"}`. Extend it:

```ts
function makeShrinkEntry(entryId, uuid, opts: { seq?: number; target?: ShrinkTarget } = {}): SessionEntry {
  return { ..., data: { ..., id: uuid, target: opts.target ?? {by_tool_call_id:"call-A"}, seq: opts.seq ?? 1, ts:1 } };
}
```

A shrink covers iff resolving ITS target against the snapshot === matchedIndex. So set its `target` to the
same selector the cancel is using (or one that resolves to the same message).

## The markerId path is UNCHANGED (S2 keeps it byte-for-byte)

`if (typeof params.markerId === "string" && params.markerId.length > 0)` → old for-loop (entry.id === markerId
∧ customType ∈ {rewind,shrink} → read data.id). This path NEVER calls buildContextEntries. The existing
cancel.test.ts markerId cases (Cases 1–4, parts of 5/6/7) pass UNCHANGED.

## Idempotency + not-found (steps 4–5, shared with markerId path)

- Step 4 (not-found): `targetUuid === null` → no-op text "no active marker found for that target" +
  `{cancelled:false}`. NO append. (Note: S2's target-path no-op text says "for that target"; markerId-path
  says "with that id" — they are DIFFERENT strings. Verify against the implemented cancel.ts at S3 time.)
- Step 5 (already-cancelled): re-scan ALL entries for `customType==="mulligan:cancel" && data.targetId===uuid`
  → no-op text "already cancelled" + `{cancelled:false}`. NO append. Seed with a `makeCancelEntry(uuid)`.

## ⚠️ VERIFY-AT-IMPLEMENTATION: no-op text wording

The current (pre-S2) cancel.ts not-found text is `"no active marker found with that id — nothing to cancel."`.
The PRD §5 `mulligan_cancel` return shape says the TARGET no-op should read
`"no active marker found for that target — nothing to cancel."`. Whether S2 keeps one string or branches on
the path is an S2 implementation choice — S3 must READ the actual cancel.ts string(s) after S2 lands and match
the test assertions to them verbatim. Prefer asserting the distinguishing substring (`/no active marker found/`)
when the exact branch wording is uncertain, but pin the full string when stable.