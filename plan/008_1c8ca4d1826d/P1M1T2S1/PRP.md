# PRP — P1.M1.T2.S1: Thread the marker's own ENTRY id + compute the marker's issuing-turn span from `branchEntries`

## Goal

**Feature Goal**: Enable the filter (pure tier, src/transforms.ts) to know WHICH turn a shrink marker was issued in. Two deliverables: (1) widen `ShrinkMarkerLike` with `markerEntryId?: string` and thread the marker's own session-ENTRY id from `readMarkers` (filter.ts — the ONE permitted read-side edit, no behavior change); (2) add an exported pure helper `markerTurnSpan(messages, branchEntries, markerEntryId): { start; end } | null` that computes the marker's **issuing-turn span** in ORIGINAL message space via the established entry→message cursor walk. Consumers (P1.M1.T2.S2 enforcement, P1.M2.T3.S2 cancel live fallback) call it and treat `null` as fail-safe no-op.

**Deliverable**: exported `markerTurnSpan` + widened `ShrinkMarkerLike` in `src/transforms.ts`; the `filter.ts` `readMarkers` threading (copy entry id into each pushed shrink object under `markerEntryId`).

**Success Definition**: `npm run typecheck` passes; `npx vitest run` green (zero behavior change — nothing in the pipeline reads `markerEntryId` yet); `markerTurnSpan` is pure, Pi-free, never throws (E13), returns null on non-locatable/indeterminate inputs; JSDoc cites the PRD §2 issuing-turn ruling + spec/06 §5 v2.0.

## Why

PRD v2.0 mandates the filter independently enforce that a shrink only ever substitutes within **the marker's issuing turn** (defense in depth). Per the binding interpretation ruling (architecture/scope_guard_design.md §1): the bound is the marker's ISSUING turn, NOT the fire-time current turn — a fire-time bound would expire markers at the next prompt and resurrect the shed bloat (persistence is retained). Computing that span requires (a) knowing the marker's stable position on the branch (its ENTRY id — distinct from the marker UUID in `data.id`) and (b) mapping that position to message space. This subtask delivers exactly those primitives; enforcement is P1.M1.T2.S2.

## What

1. **Widen `ShrinkMarkerLike`** (src/transforms.ts ~1141-1159): add
   ```ts
   /**
    * The marker's own session-ENTRY id (readOwn(entry,"id") of the mulligan:shrink custom entry) — NOT the
    * marker UUID in data.id. Threaded by readMarkers (filter.ts) so the filter can compute the marker's
    * issuing-turn span (markerTurnSpan) from branchEntries. Absent on old bundles / when unreadable →
    * markerTurnSpan returns null → callers no-op fail-safe. OPTIONAL. Read via readOwn(sh,"markerEntryId").
    */
   markerEntryId?: string;
   ```
   The real `markers.ts` `ShrinkMarker` does NOT have this field — that is fine because `readMarkers` BUILDS the bundle objects (see #3); a raw `ShrinkMarker` still assigns into `ShrinkMarkerLike` (all new fields optional). Do NOT add `markerEntryId` to `markers.ts`'s persisted `ShrinkMarker` (it is derived at read time, not persisted).

2. **Add `markerTurnSpan`** in src/transforms.ts (place near `resolvePinnedShrink`, ~after :920, reusing `entryMessageYield`, `isRecord`, `readOwn` — module-private, already in scope):
   ```ts
   export function markerTurnSpan(
     messages: MessageLike[],
     branchEntries: BranchEntry[],
     markerEntryId: string,
   ): { start: number; end: number } | null;
   ```
   Algorithm (retained-tail walk — generalizes `resolvePinnedShrink`, transforms.ts:871-910, and mirrors `entryIdAtMessageIndex` tools/shrink.ts:228-243):
   - Guards (mirror resolvePinnedShrink exactly): non-array `messages`/`branchEntries` → null; non-string/empty `markerEntryId` → null.
   - Find `lastCompactionIdx`: scan `branchEntries` END→start for the last entry with `readOwn(e,"type") === "compaction"` (-1 if none) — same loop as resolvePinnedShrink (:886-893).
   - `tailEntries = branchEntries.slice(lastCompactionIdx + 1).filter(e => entryMessageYield(e) > 0)` plus we ALSO need the marker entry itself (a `custom` entry, yield 0 — filtered OUT by that predicate). So locate the marker IN THE FULL slice `branchEntries.slice(lastCompactionIdx + 1)`: scan it for the entry whose `readOwn(e,"id") === markerEntryId` (FIRST match). Not found → null (marker is in the compacted head or absent → indeterminate → fail-safe no-op, mirroring E24).
   - Alignment: entries after the last compaction that yield messages map 1:1 (yield=1 each) to the LAST `tailCount` messages where `tailCount = tailEntries.length`; `tailStartIdx = messages.length - tailCount`; if `tailStartIdx < 0` → null (misalignment beyond recovery — same defensive refusal as resolvePinnedShrink :898-900).
   - Message cursor: walk the post-compaction slice root→leaf accumulating `entryMessageYield(e) > 0 ? yield : 0`; when the walked entry IS the marker entry, record `markerMsgPos = tailStartIdx + cursorAtThatPoint` (the message index where the marker sits — i.e. the position of the NEXT message; the marker itself yields 0 so it occupies a boundary). Since yields are all 1 in the tail, `markerMsgPos = tailStartIdx + (number of message-yielding entries strictly before the marker entry in the slice)`.
   - **Turn bound**: scan `messages` for the LAST index `i < markerMsgPos` with `isRecord(messages[i]) && readOwn(messages[i],"role") === "user"` (same scan as `resolveLastTurn`, transforms.ts:331-337). None → `start = 0` (session-start edge; mirror `currentTurnSpan` from P1.M1.T1.S2). Else `start = i + 1`. `end = messages.length`.
   - Return `{ start, end }`. NEVER throws (E13); no Pi imports; pure/deterministic.
   - **No-compaction case** degenerates to the forward walk (`tailStartIdx === 0`) — the common case.
   - GOTCHA: if a compaction exists AFTER the marker (marker before lastCompactionIdx), the marker is in the compacted head → step "locate the marker in the post-compaction slice" fails → null. That is CORRECT per scope_guard_design.md: compaction-ambiguous spans no-op fail-safe.

3. **Thread the entry id in `readMarkers`** (src/filter.ts:~166-169, the `mulligan:shrink` branch — the ONE permitted read-side edit, zero behavior change):
   ```ts
   } else if (customType === "mulligan:shrink" && kind === "shrink") {
     const entryId = readOwn(entry, "id");
     // Thread the marker's OWN session-entry id (NOT data.id, which is the marker uuid) so the pure tier
     // can compute the marker's issuing-turn span (markerTurnSpan — P1.M1.T2.S1). No behavior change.
     shrinks.push(
       typeof entryId === "string" && entryId.length > 0
         ? { ...(data as Record<string, unknown>), markerEntryId: entryId } as ShrinkMarker
         : (data as unknown as ShrinkMarker),
     );
   }
   ```
   - `markers.ts`'s `ShrinkMarker` type does not declare `markerEntryId`; the spread adds an extra property — use the cast shown (or a small local widening type) so `npm run typecheck` stays green. Prefer NOT editing markers.ts (persisted shape stays untouched); if you find an existing structural type in filter.ts for this, reuse the established cast style already used in that file.
   - `cancelledIds` filtering, seq ordering, and everything else in readMarkers is untouched.
   - Also check whether `filter.test.ts` asserts deep-equality on the shrink bundle objects — if a fixture now sees `markerEntryId`, adjust ONLY that assertion (add the field or use object-contains semantics) with a comment "P1.M1.T2.S1: entry-id threading".

4. **Do NOT consume it**: `filterPipeline`'s shrink pass (transforms.ts:1546-1567), `applyShrink`, and all tools keep their current signatures and behavior. Enforcement is P1.M1.T2.S2; cancel live fallback is P1.M2.T3.S2.

### Success Criteria

- [ ] `ShrinkMarkerLike.markerEntryId?: string` present, JSDoc'd (ENTRY id vs marker-uuid distinction)
- [ ] `markerTurnSpan` exported, pure, zero new imports in transforms.ts (`grep -c '^import' src/transforms.ts` stays 0), never throws
- [ ] Correct spans: marker in turn N → `{ start: iLastUserBeforeMarker + 1, end: messages.length }` in ORIGINAL message space; session-start edge → start 0; marker in compacted head / not found / misaligned / non-array → null
- [ ] readMarkers threads `markerEntryId` with zero behavior change; persisted marker shapes untouched
- [ ] `npm run typecheck` passes; `npx vitest run` green
- [ ] JSDoc on `markerTurnSpan` cites the issuing-turn ruling (PRD §2 / scope_guard_design.md §1) + spec/06 §5 v2.0

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need the exact walk precedents (`resolvePinnedShrink`, `entryIdAtMessageIndex`), the entry-id vs marker-uuid distinction, the readMarkers push site, purity conventions, and the S2 consumer contract. All excerpted below.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: THE main file. resolvePinnedShrink :871-910 (the retained-tail walk to GENERALIZE);
        entryMessageYield :532 (yield semantics: 1 for message/custom_message/branch_summary, -1 compaction);
        ShrinkMarkerLike ~:1141-1159 (to widen); filterPipeline shrink pass :1546-1567 (DO NOT TOUCH — S2);
        resolveLastTurn user scan :331-337 (the role==="user" scan to mirror).
  pattern: plain-primitive returns, isRecord/readOwn for ALL field access, module stays 0-import.
  gotcha: markers are `custom` entries — entryMessageYield(markerEntry) <= 0, so the marker occupies a
          MESSAGE-BOUNDARY position (cursor value), not a message index.

- file: src/filter.ts
  why: readMarkers :118-190; the mulligan:shrink push at ~:166-169 is the ONE permitted edit (thread entry id).
  gotcha: data.id inside the marker is the marker UUID — the ENTRY id is readOwn(entry,"id"). Do not confuse.

- file: src/tools/shrink.ts
  why: entryIdAtMessageIndex :228-243 — the FORWARD cursor walk precedent (entries.flatMap-yield mapping).

- file: plan/008_1c8ca4d1826d/architecture/scope_guard_design.md
  why: §1 the binding issuing-turn ruling; §2 the exact algorithm this PRP implements (cursor walk + fail-safe null).
  section: "2. Where the marker's turn span comes from"

- file: plan/008_1c8ca4d1826d/P1M1T1S2/PRP.md
  why: CONTRACT: currentTurnSpan + 3-arg resolveShrinkTarget exist (or land in parallel). markerTurnSpan is the
        FILTER-side counterpart (issuing turn); it must NOT be conflated with currentTurnSpan (fire-time current
        turn). Keep both exported and distinct.

- spec: spec/06-context-filter.md §5 v2.0 (current-turn scope, defense in depth)
- spec: spec/04-data-model.md §4 (ShrinkMarker; pinnedEntryId holds an ENTRY id — same id namespace as markerEntryId)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: transforms.ts has ZERO imports (grep -c '^import' === 0) — reuse in-scope helpers only.
// CRITICAL: ShrinkMarker.id (data.id) is the marker UUID; markerEntryId is the SESSION entry id. Different
//   namespaces; pinnedEntryId also holds an ENTRY id (message entry), markerEntryId holds the MARKER entry id.
// CRITICAL: a `custom` entry yields NO message — the marker's "message position" is the cursor boundary.
//   Users strictly BEFORE that boundary bound the issuing turn: scan i < markerMsgPos.
// GOTCHA: entryMessageYield returns -1 for compaction — filter with `> 0`, never `!== -1`.
// GOTCHA: spread-adding markerEntryId in filter.ts needs a cast (ShrinkMarker lacks the field by design).
// GOTCHA: never widen the span on ambiguity — null (no-op) is ALWAYS the safe answer (E8/E13 fail-safe).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: WIDEN ShrinkMarkerLike in src/transforms.ts (~:1141)
  - ADD markerEntryId?: string with the JSDoc above (ENTRY id vs uuid distinction)
  - NO other interface changes; markers.ts untouched

Task 2: ADD markerTurnSpan in src/transforms.ts (after resolvePinnedShrink, ~:920)
  - IMPLEMENT the retained-tail algorithm above (guards → lastCompactionIdx → locate marker in
    post-compaction slice → tailStartIdx alignment → markerMsgPos → last-user-before scan → span)
  - JSDoc: issuing-turn bound per PRD §2 ruling (NOT fire-time current turn; cite spec/06 §5 v2.0
    + scope_guard_design.md §1); null = fail-safe no-op contract for callers; degenerate no-compaction case;
    session-start edge (start 0); marker-in-compacted-head → null (correct, E24-adjacent)
  - NAMING: markerTurnSpan (exact, per contract); exported for tests + S2/cancel consumers

Task 3: THREAD entry id in src/filter.ts readMarkers (mulligan:shrink branch, ~:166)
  - Spread + markerEntryId per the snippet above; cast for typecheck; zero behavior change

Task 4: VERIFY
  - grep -c '^import' src/transforms.ts  → 0
  - npm run typecheck && npx vitest run
  - grep -n "markerTurnSpan\|markerEntryId" src/ → the 3 sites + JSDoc only (no pipeline consumption)
  - Optional scratch sanity (NOT committed; S3 tests own the lock): a tsx/vitest scratch asserting
    markerTurnSpan returns {start,end} for a marker mid-branch and null for a compacted-head marker
```

### Implementation Patterns & Key Details

```ts
// Core walk (sketch — follow resolvePinnedShrink's exact guard/scan style):
export function markerTurnSpan(messages, branchEntries, markerEntryId) {
  if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
  if (typeof markerEntryId !== "string" || markerEntryId.length === 0) return null;
  let lastCompactionIdx = -1;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (isRecord(branchEntries[i]) && readOwn(branchEntries[i], "type") === "compaction") { lastCompactionIdx = i; break; }
  }
  const tail = branchEntries.slice(lastCompactionIdx + 1);
  // locate marker + count message-yielding entries before it (single pass)
  let yielded = 0, markerFound = false;
  for (const e of tail) {
    if (isRecord(e) && readOwn(e, "id") === markerEntryId) { markerFound = true; break; }
    const y = entryMessageYield(e);
    yielded += y > 0 ? y : 0;
  }
  if (!markerFound) return null; // compacted head / absent / ambiguous
  const tailCount = tail.filter(e => entryMessageYield(e) > 0 ? true : false) && tail.reduce((n, e) => { const y = entryMessageYield(e); return n + (y > 0 ? y : 0); }, 0);
  const tailStartIdx = messages.length - tailCount;
  if (tailStartIdx < 0) return null; // misalignment (resolvePinnedShrink precedent)
  const markerMsgPos = tailStartIdx + yielded;
  let iLastUser = -1;
  for (let i = 0; i < markerMsgPos && i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
  }
  return { start: iLastUser + 1, end: messages.length }; // iLastUser -1 → start 0 (session-start edge)
}
```
(Implementer: compute `tailCount` and the locate loop cleanly — the sketch's two passes over `tail` are both fine; do NOT try to fuse them at the cost of clarity. Keep every read behind isRecord/readOwn.)

### Integration Points

```yaml
EXPORTS (src/transforms.ts):
  - NEW: markerTurnSpan
  - CHANGED: ShrinkMarkerLike (+ markerEntryId?: string)
FILTER SIDE (src/filter.ts):
  - readMarkers mulligan:shrink push now spreads markerEntryId (entry id)
CONSUMERS (NOT this subtask):
  - P1.M1.T2.S2: filterPipeline shrink pass — both paths check membership in markerTurnSpan(...) ?? fail-open
  - P1.M2.T3.S2: mulligan_cancel live covering-check fallback bound
TESTS: lock is P1.M1.T3.S2 (scope-guard tests) — here only keep vitest green
```

## Validation Loop

### Level 1: Type check

```bash
npm run typecheck    # tsc --noEmit — 0 errors (note: T1.S2 lands in parallel; joint gate at merge)
```

### Level 2: Tests

```bash
npx vitest run       # all green — zero behavior change expected; fix only filter.test.ts fixture
                     # assertions forced by the added markerEntryId field
```

### Level 3: Contract assertions

```bash
grep -c '^import' src/transforms.ts                 # 0
grep -n "markerTurnSpan" src/transforms.ts          # export + JSDoc, no pipeline call sites
grep -n "markerEntryId" src/transforms.ts src/filter.ts  # type + threading only
grep -n "markerEntryId" src/markers.ts              # expect NOTHING (persisted shape untouched)
```

## Final Validation Checklist

- [ ] `npm run typecheck` passes; `npx vitest run` green
- [ ] `markerTurnSpan` exported, Pi-free, never throws, null on all indeterminate inputs
- [ ] `ShrinkMarkerLike.markerEntryId?` added; markers.ts untouched
- [ ] filter.ts threads the ENTRY id (not the uuid) with zero behavior change
- [ ] No consumption wired into filterPipeline/tools (deferred to T2.S2 / M2.T3.S2)
- [ ] JSDoc documents the issuing-turn ruling (PRD §2, spec/06 §5 v2.0) and the null fail-safe contract
- [ ] Only src/transforms.ts + src/filter.ts (+ any test-forced fixture touch) modified

## Anti-Patterns to Avoid

- ❌ Do NOT enforce the span in filterPipeline — that is P1.M1.T2.S2
- ❌ Do NOT persist markerEntryId into the mulligan:shrink marker data — it is derived at read time
- ❌ Do NOT confuse markerEntryId (marker's entry) with pinnedEntryId (target message's entry) or data.id (uuid)
- ❌ Do NOT add imports to transforms.ts or throw anywhere in the new helper
- ❌ Do NOT return a "best guess" span on misalignment — null (no-op) is the contract