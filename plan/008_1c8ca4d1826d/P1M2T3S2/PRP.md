---
name: "P1.M2.T3.S2 — Covering-marker check: pinned identity first, marker-span live fallback, full-history hints"
---

## Goal

**Feature Goal**: Upgrade the shrink covering-check inside `resolveTargetUuid` (src/tools/cancel.ts) so that a `mulligan:shrink` marker covers the matched message when (1) the shrink has a non-empty `pinnedEntryId` and it EQUALS the matched message's ENTRY id (pinned identity, preferred), or (2) for markers without a pin, the shrink's own selector resolves — via the 3-arg `resolveShrinkTarget` bounded by the MARKER'S OWN issuing-turn span (`markerTurnSpan`) — to the matched index. If the marker's span is indeterminable (null), fall back to today's UNCHANGED unspanned live resolution rather than failing the cancel. Hint resolution of `params.target` itself stays FULL-HISTORY (no span). Everything else in `mulligan_cancel` — rewind covering rule, LIFO by seq, markerId fallback path, idempotency, refusal/no-op/success texts, never-throws (E13) — is UNCHANGED.

**Deliverable**: Edited `src/tools/cancel.ts` only (`resolveTargetUuid` shrink arm + its JSDoc, incl. rewriting the now-stale "deliberately not pinnedEntryId" note at ~:241). Mode A docs ride with the work as JSDoc.

**Success Definition**: `npm test` and `npm run typecheck` green; grep confirms `markerTurnSpan` imported and `pinnedEntryId` read in cancel.ts; a pinned shrink whose `pinnedEntryId` matches the target's entry id is now cancellable even when its live selector would resolve elsewhere; a live (unpinned) shrink only covers within its own turn span; full-history hint resolution unchanged (a last-turn marker is cancellable by content/role hint); the whole body still never throws.

## Why

Under v2.0 the filter resolves pinned shrinks by IDENTITY and live shrinks within the marker's issuing turn — but cancel's covering check still uses the OLD unspanned live selector, so (a) a pinned shrink may be UNCOVERABLE when its selector no longer resolves to the pinned message (selector drift), blocking retraction of exactly the marker most likely to be a mistake, and (b) an unpinned shrink can be cancelled via a match on content that lives OUTSIDE the marker's turn — inconsistent with the filter's scope model. This item brings the covering check into lockstep with the filter's resolution model (identity-or-span), while keeping hint resolution deliberately full-history: cancel acts on the MARKER, not on the old content (@05 §5 v2.0 — marker resolution is NOT current-turn-scoped).

## What

### Exact change — `resolveTargetUuid` shrink arm (src/tools/cancel.ts ~:256-316)

Current (to replace):
```ts
if (ct === "mulligan:shrink") {
  const shrinkTarget = readOwn(data, "target");
  const resolved = resolveShrinkTarget(messages, shrinkTarget as ShrinkTargetRead);
  covers = resolved === matchedIndex; // SHRINK: own target resolves to the matched index (live, not pinned)
}
```

New logic:
```ts
if (ct === "mulligan:shrink") {
  // ARM 1 — PINNED IDENTITY (preferred). Matches the filter's identity-lock resolution.
  const pinnedEntryId = readOwn(data, "pinnedEntryId");
  if (typeof pinnedEntryId === "string" && pinnedEntryId.length > 0) {
    covers = pinnedEntryId === matchedEntryId; // matchedEntryId may be null → false (no cover)
  } else {
    // ARM 2 — LIVE fallback, bounded by the MARKER'S OWN issuing-turn span.
    // markerEntryId = the shrink ENTRY's own session id (readOwn(e,"id")), NOT data.id (uuid).
    // markerTurnSpan null (compacted head / not found / misaligned) → UNSPANNEDED fallback
    // (today's behavior) — cancel is retraction, prefer reachability; document the choice.
    const span = markerTurnSpan(messages, snapshotBranchEntries, shrinkEntryId);
    const resolved =
      span !== null
        ? resolveShrinkTarget(messages, shrinkTarget as ShrinkTargetRead, span)
        : resolveShrinkTarget(messages, shrinkTarget as ShrinkTargetRead);
    covers = resolved === matchedIndex;
  }
}
```

Supporting edits inside `resolveTargetUuid`:
1. Read branch entries ONCE at the top (same read surface filter.ts:252 uses): 
   `const snapshotBranchEntries = ctx.sessionManager.getBranch() as unknown as BranchEntry[];` — wrap-protected by the existing try/catch (a throw → return null, E13). Add the `BranchEntry` import from `../transforms.js` if not already imported in cancel.ts (check current imports; it is exported from transforms.ts per P1.M1.T2.S1). Import `markerTurnSpan` from `../transforms.js`.
2. Capture the marker's own entry id inside the loop, before the covering ternary: `const shrinkEntryId = readOwn(e, "id");` (guard: non-string/empty → span is indeterminable → unspanned fallback; equivalently pass it to markerTurnSpan which guards itself and returns null).
3. `matchedEntryId` (already computed at step iii via `entryIdAtMessageIndex(snapshotEntries, matchedIndex)`) is reused for BOTH the rewind membership check AND the new pinned-identity check — no new mapping needed.

### What stays EXACTLY as-is
- Step (i)–(iii) snapshot construction: `buildContextEntries()` + `sessionEntryToContextMessages` double-cast; hint resolution `resolveShrinkTarget(messages, target)` — **NO third arg, FULL history** (cancel acts on the marker, not the old content).
- Rewind covering: `matchedEntryId !== null && Array.isArray(hideEntryIds) && hideEntryIds.includes(matchedEntryId)`.
- LIFO: highest `data.seq` wins (non-finite → 0); malformed markers (no uuid, unreadable data) skipped.
- `cancelExecute` steps 1–7, markerId path (3a), target-path call site (~:387 — signature of `resolveTargetUuid` may stay `(ctx, entries, target)`; branch entries read INSIDE), idempotency scan, all result texts, `details` shapes, `prepareArguments` wiring.
- Never throws: the single outer try/catch in `resolveTargetUuid` already covers the new `getBranch()`/`markerTurnSpan` calls.

### JSDoc (Mode A — rides with the work)
- Rewrite the `resolveTargetUuid` covering-rules doc block: replace the "SHRINK covers index i: … LIVE resolution — NOT pinnedEntryId (GOTCHA #5, D3)" bullet with the two-arm rule above, and add the note: *"Per @05 §5 v2.0: the `target` HINT resolves FULL-HISTORY (cancel acts on the marker, not the old content — marker resolution is NOT current-turn-scoped); only the shrink's OWN live fallback is bounded to the marker's issuing turn (markerTurnSpan). When the marker's span is indeterminable (null — compacted head, not found, misaligned), the unspanned live resolution is used rather than failing the cancel: retraction prefers reachability."*
- Also update the stale inline comment at ~:241 (`LIVE resolution … NOT pinnedEntryId … documented at :241`) if it appears on the call-site/doc region — it now describes the OLD rule.

### Success Criteria

- [ ] Pinned shrink with `pinnedEntryId === matchedEntryId` covers even if its live selector resolves elsewhere (drift case).
- [ ] Unpinned shrink covers only when its selector resolves to the matched index WITHIN `markerTurnSpan(...)` (when the span is determinable).
- [ ] Span indeterminable → unspanned fallback (today's behavior); documented in JSDoc.
- [ ] Hint resolution unspanned/full-history — no span argument at the `params.target` resolution call.
- [ ] Rewind rule, LIFO, markerId path, idempotency, texts unchanged; tool never throws.
- [ ] `npm test` + `npm run typecheck` green.

## All Needed Context

### Context Completeness Check

An implementer reading only this PRP + the four files below has the full picture: exact code shape to replace, exact upstream signatures (`markerTurnSpan`, 3-arg `resolveShrinkTarget`), the branch-read precedent, and the test conventions.

### Documentation & References

```yaml
- file: src/tools/cancel.ts
  why: THE file. resolveTargetUuid ~:256-316 (shrink arm ~:296-301); call site ~:387; stale doc note ~:241; try/catch wrapper (E13); markerId path steps 3a
  pattern: readOwn-based defensive reads; INLINED snapshot build (NOT a shared helper, D4); `as unknown as MessageLike[]` double-cast (GOTCHA #10)
  gotcha: do NOT add a span to the params.target hint resolution — full history is the spec'd behavior

- file: src/transforms.ts
  why: exports markerTurnSpan (P1.M1.T2.S1, placed near resolvePinnedShrink ~:920): (messages, branchEntries, markerEntryId) => {start,end}|null — issuing-turn span in ORIGINAL message space; null = indeterminable. Also 3-arg resolveShrinkTarget (P1.M1.T1.S2) with optional {start,end}; BranchEntry structural type (~:403)
  gotcha: markerTurnSpan expects branchEntries ROOT→LEAF (getBranch() order) and locates the marker by ENTRY id among post-compaction entries; marker in compacted head → null (correct: fail-safe)

- file: src/filter.ts
  why: branch-read precedent — :252 `ctx.sessionManager.getBranch()` cast `as unknown as BranchEntry[]`; :391-404 resolvePinnedShrink consumption shows the pinned/live split the covering check now mirrors
  pattern: same read path, same cast idiom — use the identical surface in cancel.ts

- file: src/tools/shrink.ts
  why: pinnedEntryId WRITE side (P1.M2.T1.S2 match-now pin) + resolveTargetEntryId/entryIdAtMessageIndex cursor-walk (:228-243) that matchedEntryId already reuses
  gotcha: pinnedEntryId holds an ENTRY id (stable), NOT a message index — compare against matchedEntryId, never matchedIndex

- file: test/tools/cancel.test.ts
  why: existing covering-check tests (makeCtx with entries + contextEntries fakes, hand-rolled — NO vi.fn(), .js import paths). Verify none assert the OLD live-only shrink rule in a way the new logic breaks; if one does, align it minimally (the full test LOCK is P1.M2.T4.S1 — do not write the new tests here beyond keeping green)
  gotcha: fakes' sessionManager must tolerate a getBranch() call if the test makeCtx lacks it — check makeCtx; if absent, add a minimal getBranch() to the fake returning the entries (comment: P1.M2.T3.S2)

- file: plan/008_1c8ca4d1826d/P1M2T3S1/PRP.md
  why: PARALLEL item — schema/desc only, explicitly does NOT touch resolveTargetUuid. Assume it landed as written; zero conflict with this item

- file: plan/008_1c8ca4d1826d/architecture/_scouts/tools.md
  why: §2 documents the cancel covering-check design (live resolution, LIFO, markerId fallback, idempotency) — background for the rewrite
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pinnedEntryId (data) vs markerEntryId (entry.id) vs data.id (marker UUID) — THREE different ids.
//   Pin compare: data.pinnedEntryId === matchedEntryId. Span: markerTurnSpan(..., entry.id). Cancel marker: data.id.
// CRITICAL: markerTurnSpan's `messages` must be the SAME snapshot used for matchedIndex/resolveShrinkTarget
//   (the buildContextEntries() flat-map) — spans are in that message space.
// GOTCHA: getBranch() is RAW (compacted-away + compaction + tail) while the message snapshot is compaction-aware —
//   markerTurnSpan internally handles the alignment (retained-tail walk); do NOT pre-filter branchEntries.
// GOTCHA: never let a null span fail the cancel — fall back to unspanned live resolution (retraction prefers reachability).
// GOTCHA: hand-rolled test fakes (no vi.fn()); test files import via ".js" paths; if makeCtx lacks getBranch, add it.
// GOTCHA: cancel.ts must not re-read getEntries()/buildContextEntries() beyond what it already does (C12) —
//   getBranch() is ONE fresh read inside resolveTargetUuid, same pattern as filter.ts:252.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/tools/cancel.ts — imports
  - ADD markerTurnSpan (+ BranchEntry type if needed) to the ../transforms.js import list

Task 2: EDIT src/tools/cancel.ts — resolveTargetUuid
  - READ branch entries once: const snapshotBranchEntries = ctx.sessionManager.getBranch() as unknown as BranchEntry[]
    (inside the existing try; a throw → catch → null, E13)
  - CAPTURE shrinkEntryId = readOwn(e, "id") in the marker loop
  - REPLACE the shrink covering arm with the two-arm rule (pinned identity → spanned live → unspanned fallback) per "What"
  - KEEP rewind arm, LIFO, malformed-skip, hint resolution (unspanned) untouched

Task 3: EDIT src/tools/cancel.ts — JSDoc
  - REWRITE the covering-rules doc block + purge the stale "deliberately not pinnedEntryId" note (~:241 region)
  - CITE @05 §5 v2.0: hint resolution full-history; live fallback bounded by the marker's OWN turn span; null span → unspanned fallback (retraction prefers reachability)

Task 4: CHECK test/tools/cancel.test.ts
  - Run the suite; align ONLY tests broken by the new rule (likely none/minimal); if makeCtx's fake sessionManager
    lacks getBranch, add it returning the same entries fixture. Full test lock is P1.M2.T4.S1 — do not author it here

Task 5: VALIDATE (below); fix anything red
```

### Implementation Patterns & Key Details

```ts
// The entire new logic lives INSIDE the existing try/catch of resolveTargetUuid — no new throw paths (E13).
// Decision precedence inside the shrink arm (exhaustive, no fall-through gaps):
//   pinned (non-empty string)  → identity compare ONLY (never live-resolve; matches filter's identity-or-nothing)
//   !pinned && span !== null   → spanned live resolve
//   !pinned && span === null   → unspanned live resolve (legacy behavior, documented choice)
```

## Validation Loop

```bash
npx vitest run test/tools/cancel.test.ts    # existing cancel suite green (minimal alignments only)
npm test                                    # full suite green
npm run typecheck                           # tsc --noEmit
grep -n "markerTurnSpan" src/tools/cancel.ts          # imported + called
grep -n "pinnedEntryId" src/tools/cancel.ts           # read in the covering arm (+ JSDoc)
# Manual reasoning checks (no harness needed — P1.M2.T4.S1 owns the automated lock):
#   (a) pinned shrink, selector drifted → still cancellable by hint on the pinned message
#   (b) unpinned shrink, selector matches only OUTSIDE marker's span → NOT covered (no cancel via that marker)
#   (c) marker's entry in compacted head → unspanned fallback applies (cancel still reachable)
#   (d) params.target hint on a message from an earlier turn → resolves (full history) and finds covering marker
```

## Final Validation Checklist

- [ ] All validation commands green; tool never throws (single try/catch intact)
- [ ] Pinned-identity preferred; live fallback span-bounded by the MARKER's turn; null span → unspanned fallback
- [ ] Hint resolution full-history (no span on the params.target resolution)
- [ ] Rewind rule / LIFO / markerId path / idempotency / texts / prepareArguments untouched
- [ ] JSDoc rewrites done, citing @05 §5 v2.0; stale "not pinnedEntryId" note removed
- [ ] No new files; no changes outside src/tools/cancel.ts (+ minimal test alignment if required)

## Anti-Patterns to Avoid

- ❌ Don't add a turn span to the params.target hint resolution — full history is the contract
- ❌ Don't fail/return null when markerTurnSpan returns null — fall back to unspanned live resolution
- ❌ Don't compare pinnedEntryId to a message INDEX — it's an ENTRY id
- ❌ Don't write the P1.M2.T4.S1 test lock, change CancelParams/CANCEL_DESC (P1.M2.T3.S1 owns those), or refactor the snapshot build into a shared helper (D4 keeps it inlined)
- ❌ Don't re-read getEntries() inside resolveTargetUuid (C12 — branch read via getBranch() is the one fresh read)

**Confidence Score: 9/10** — single-file logic upgrade with the exact replacement shape, upstream helpers already landed and specified in prior PRPs, and a defensive fallback that preserves all existing behaviors.