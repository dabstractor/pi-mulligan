# Research Notes — P1.M1.T1.S2: `cancelExecute` target resolution

## Dependency on S1 (assumed implemented)
`src/tools/cancel.ts` CancelParams schema rewritten (both target + markerId `Type.Optional`);
`CancelArgs = { target?: ShrinkTarget-shaped-union; markerId?: string }`.
CANCEL_DESC rewritten. cancelExecute UNCHANGED in S1 (still reads only params.markerId).

## S2 scope: rewrite cancelExecute STEP 3 only (steps 1,2,4-7 AS-IS) + add helpers + imports + JSDoc.

## Verified APIs (runtime)
- `resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null` — transforms.ts:758,
  EXPORTED, pure, Pi-free. Returns matched message INDEX or null. Used by shrink.ts:resolveTargetEntryId.
- `ShrinkTarget` union — transforms.ts:728 (≡ markers.ts ShrinkTarget ≡ CancelParams.target after S1).
- `MessageLike` — transforms.ts:53 (Pi-free structural type; AgentMessage[] assigns in via `as unknown as MessageLike[]`).
- `sessionEntryToContextMessages(e: SessionEntry): AgentMessage[]` — re-exported from pi package index
  (dist/index.d.ts:19, dist/index.js:23). shrink.ts imports it from "@earendil-works/pi-coding-agent".
- `buildContextEntries(): SessionEntry[]` on ctx.sessionManager — compaction-aware snapshot.
- `getEntries(): SessionEntry[]` on ctx.sessionManager — raw entries (markers live here; already read in step 2).
- shrink.ts private `entryIdAtMessageIndex(entries, index)` (shrink.ts:187) — cursor-walk mapping message index→entry id.
  S2 duplicates this LOCALLY in cancel.ts (~15 lines, uses sessionEntryToContextMessages(e).length per entry).

## Marker data shapes (markers.ts — what cancel reads via readOwn)
- RewindMarker.data: {schema,v,kind:"rewind", id(uuid), granularity, options, excludeToolCallId?, hideEntryIds?:string[], seq, note, ledger, ts}
- ShrinkMarker.data: {schema,v,kind:"shrink", id(uuid), target:ShrinkTarget, replacement, reason?, pinnedEntryId?, seq, ts}
- CancelMarker.data: {schema,v,kind:"cancel", targetId, seq, ts} — NO id (not cancellable)
- Entry-level: entry.id (Pi entry id), entry.customType ("mulligan:rewind"/"shrink"/"cancel"/"turn-metric"/"note")

## Resolution ordering decision (D1): markerId-wins
Spec §5 says "preferred target, fallback markerId" BUT also "markerId wins if both given". These tension only when
both present. Cleanest honoring "markerId wins": if markerId present+non-empty → markerId path (sole/authoritative);
else if target present → target path; else (neither) → no-op fallthrough (no new refusal; E21(d) fail-open).
This preserves every existing test (they all pass {markerId:'…'} → markerId path → buildContextEntries NEVER called).

## Covering logic (target path)
Given matched message index i (resolveShrinkTarget on the snapshot):
- SHRINK covers i: resolve the shrink's OWN data.target against the SAME snapshot → === i (live resolution,
  matches item description; pinnedEntryId is the filter's identity-lock, NOT used here — documented as a choice).
- REWIND covers i: matchedEntryId = entryIdAtMessageIndex(snapshotEntries, i); rewind covers if matchedEntryId ∈ data.hideEntryIds.
- LIFO: among covering markers, highest data.seq wins (latest-issued = likely mistake). Non-number seq → 0.
- Malformed marker (no/empty uuid, unreadable target/hideEntryIds) → skipped (safe no-cover).
- Whole resolveTargetUuid helper wrapped in try/catch → null (throwing buildContextEntries/sessionEntryToContextMessages → no-op).

## Existing-test preservation (validation gate)
All existing cancel.test.ts cases pass {markerId:'…'} → enter markerId path (verbatim current step-3 logic) →
buildContextEntries() NEVER invoked. makeCtx need NOT script buildContextEntries for existing tests. S3 (target tests)
will extend makeCtx. Case 6 (throwOnGetEntries) → step-2 catch → entries=[] → no-op (unchanged by S2).

## Imports S2 adds to cancel.ts (mirror shrink.ts:48-61)
- add `sessionEntryToContextMessages` to the @earendil-works/pi-coding-agent destructure
- add `import { resolveShrinkTarget } from "../transforms.js";`
- add `import type { ShrinkTarget, MessageLike } from "../transforms.js";`

## tsc bar
Only NEW errors from cancel.ts matter. Watch: `unknown as ShrinkTarget` cast for shrink's data.target (allowed —
unknown→anything via assertion); params.target → ShrinkTarget param assignability (structural identity, S1 guarantee).