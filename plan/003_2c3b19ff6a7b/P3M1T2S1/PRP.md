# PRP — P3.M1.T2.S1: Collect cancel entries, build cancelledIds, drop cancelled markers, expose on MarkersBundle

## Goal

**Feature Goal**: Extend `readMarkers(ctx)` in `src/filter.ts` so that it (a) collects `mulligan:cancel` control entries into a new `cancelledIds: Set<string>`, (b) drops any rewind/shrink whose uuid `id` field is in that set, and (c) exposes `cancelledIds` on the `MarkersBundle` interface. After this change, the context pipeline (and every consumer of `readMarkers`) only ever sees the *active* markers — a cancelled marker stops applying on every subsequent `context` fire, even though it stays on disk. This is the runtime half of G3/marker-retraction; the data-model + persistence half is P3.M1.T1.S1 (treated as an already-landed contract here).

**Deliverable**:
- `src/filter.ts` — modified: `MarkersBundle` interface gains `cancelledIds: Set<string>`; `readMarkers` gains the cancel-collection branch + the post-loop drop filter; both return statements carry `cancelledIds`.
- `test/filter.test.ts` — modified: new `cancelData`/`makeCancelEntry` helpers + a `readMarkers — cancel-drop` describe block (cancel a shrink, cancel a rewind, cancel a non-existent id, multiple cancels, order-independence, malformed-cancel fail-open, `cancelledIds`-always-present, defensive keep-on-unreadable-id).
- `spec/06-context-filter.md` — modified: §1 gains a short prose note documenting the cancel-drop (Mode A: doc rides with the work).

**Success Definition**:
- `readMarkers` returns `{ rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }`.
- A rewind/shrink whose `data.id` equals a cancel's `targetId` is absent from the returned arrays; its id is in `cancelledIds`.
- Cancelling a non-existent id drops nothing; cancelling never throws; malformed cancels (non-string/empty/missing `targetId`) are skipped.
- The drop is order-independent (cancel-before-target still drops — full scan, then filter).
- `MarkersBundle` is still structurally assignable to `filterPipeline`'s `markers` param (`MarkerBundle` = `{rewinds,shrinks}`) and to `nudges.ts suppressCheck`'s param — no tsc errors.
- `npx tsc --noEmit` clean; `npm test` green (no regressions in markers/audit/edge/drift tests).

## Why

- This implements the **runtime retraction** promised by spec/08 E21 ("Marker retraction — cancel an erroneous/stale marker (REQUIRED; softens D6)"). Without it, a mistaken `mulligan:rewind`/`mulligan:shrink` applies on every subsequent `context` fire for the rest of the session, and a `mulligan_rewind` of the issuing call does NOT retire it (markers are `custom` control entries outside the rewind's `hideEntryIds` span — verified in live use). `readMarkers` is the single chokepoint every transform reads through, so retiring a marker here retires it everywhere downstream.
- It is the immediate consumer of the `CancelMarker` data model + `appendCancelMarker` wrapper produced by P3.M1.T1.S1. It produces the `cancelledIds` surface that audit.ts (P3.M1.T4.S1 — "lists cancelled count") and the stale-retirement logic (P3.M2.T3.S1 — appends a cancel to retire a marker) will read.
- Amends decision D6: agent markers are no longer irrevocably permanent. (Retraction suppresses the marker going forward only; it does NOT undo on-disk side effects D1/E5 or replay hidden content — E21 "what retraction is NOT".)

## What

**User-visible behavior**: None directly — this is a foundational read-layer change. The agent never calls `readMarkers`; the `mulligan_cancel` tool (P3.M1.T3.S1, a sibling task) will append the cancel marker, and on the *next* `context` fire this `readMarkers` drops it. The observable effect is: after cancellation, the originally-hidden/shrunk content reappears verbatim in the filtered view (E21 acceptance (b)).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. Extend `MarkersBundle` with `cancelledIds: Set<string>`.
2. In the `readMarkers` entry-scan loop, add an `else if (customType === "mulligan:cancel" && kind === "cancel")` branch: read `targetId` via `readOwn(data, "targetId")`; if it is a non-empty string, add it to a new `cancelledIds` Set declared alongside `rewinds`/`shrinks`/`metric`.
3. After the loop, filter rewinds/shrinks with the EXACT predicate from the contract:
   `rewinds.filter(r => { const id = readOwn(r, "id"); return typeof id !== "string" || !cancelledIds.has(id); })` — same for shrinks.
4. Return `{ rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }` at the end of the function, and `{ rewinds, shrinks, metric, cancelledIds }` in the `getEntries`-threw catch (all empty there).

### Success Criteria
- [ ] `MarkersBundle.cancelledIds: Set<string>` exists and is always present on the returned bundle (empty Set when no cancels).
- [ ] Cancelling a shrink (by its uuid `id`) → absent from `readMarkers().shrinks`; id present in `cancelledIds`.
- [ ] Cancelling a rewind (by its uuid `id`) → absent from `readMarkers().rewinds`; id present in `cancelledIds`.
- [ ] Cancelling a non-existent id → no markers dropped; id still recorded in `cancelledIds`.
- [ ] Multiple cancels → all targeted markers dropped; `cancelledIds` holds every target.
- [ ] Drop is order-independent (a cancel entry positioned BEFORE its target marker still drops it).
- [ ] Malformed cancel (non-string / empty / missing `targetId`) is SKIPPED — no throw, not added to `cancelledIds`.
- [ ] A marker lacking a readable `id` field is KEPT (defensive — never drop on bad data).
- [ ] `readMarkers` never throws (existing fail-open discipline continues).
- [ ] `spec/06-context-filter.md` §1 has a cancel-drop note.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes** — provided they read `src/filter.ts` (the EXACT file to edit: the `readMarkers` function + `MarkersBundle` interface are both there and self-contained) and follow the four bullet-level requirements above. The cancel-collection branch is a near-verbatim clone of the existing `mulligan:turn-metric` dispatch branch (same `customType === "..." && kind === "..."` guard, same `readOwn(data, ...)` read); the drop filter is a one-liner whose predicate is pinned verbatim by the work-item contract. The defensive `readOwn`/`isRecord` helpers already exist at the top of `filter.ts` and are reused unchanged. The test fakes (`rewindData`/`shrinkData`/`customEntry`/`makeCtx`) already exist in `test/filter.test.ts` and are reused; only a small `cancelData`/`makeCancelEntry` helper is added. The sibling P3.M1.T1.S1 (data model + `appendCancelMarker`) is treated as already-landed — its `CancelMarker` shape (`kind:"cancel"`, `targetId:string`, no own `id`) is the contract this PRP reads against, but THIS task never imports from markers.ts beyond what filter.ts already imports (`RewindMarker`, `ShrinkMarker`, `TurnMetric`).

### Documentation & References

```yaml
# MUST READ — the EXACT file to edit (readMarkers + MarkersBundle live here, lines ~64-154)
- file: src/filter.ts
  why: |
    Contains (1) the MarkersBundle interface (the export consumed by the test + audit + structurally by
    filterPipeline/nudges), (2) the readMarkers entry-scan loop with the existing customType+kind dispatch
    (rewind/shrink/turn-metric) — the new mulligan:cancel branch slots in as a 4th else-if, and (3) the two
    return statements (end-of-function + the getEntries-threw catch) that BOTH must carry cancelledIds.
  pattern: |
    // existing dispatch to clone (the turn-metric branch is the closest template):
    } else if (customType === "mulligan:turn-metric" && kind === "turn-metric") {
      const candidate = data as unknown as TurnMetric;
      ... keep latest by seq ...
    }
    // the cancel branch is simpler — just collect the targetId:
    } else if (customType === "mulligan:cancel" && kind === "cancel") {
      const targetId = readOwn(data, "targetId");
      if (typeof targetId === "string" && targetId.length > 0) cancelledIds.add(targetId);
    }
  section: MarkersBundle interface (~line 64) + readMarkers function (~lines 94-154)
  gotcha: |
    readOwn/isRecord are MODULE-PRIVATE helpers already defined at the top of filter.ts — reuse them; do NOT
    re-declare. The drop predicate must use readOwn(r, "id") (a Proxy get-trap may throw) — never `r.id`.

# MUST READ — the test file to extend (fakes + assertion idioms live here)
- file: test/filter.test.ts
  why: |
    Reuse the existing rewindData(seq, id), shrinkData(seq, id), customEntry(customType, data), makeCtx(),
    and the readMarkers describe-block style. The whole file vi.mocks transforms.js so filterPipeline is a
    controllable fake — your new tests call readMarkers DIRECTLY (no pipeline needed), exactly like the
    existing "buckets mulligan:rewind and mulligan:shrink" test.
  pattern: |
    function cancelData(targetId: string): Record<string, unknown> {
      return { schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq: 0, ts: 1 };
    }
    function makeCancelEntry(targetId: string): SessionEntry {
      return customEntry("mulligan:cancel", cancelData(targetId));
    }
    // test body:
    const bundle = readMarkers(makeCtx({ entries: [
      customEntry("mulligan:shrink", shrinkData(1, "sh-1")), makeCancelEntry("sh-1"),
    ]}));
    expect(bundle.shrinks).toHaveLength(0);
    expect(bundle.cancelledIds).toEqual(new Set(["sh-1"]));
  gotcha: |
    clearAll() runs in beforeEach/afterEach (resets runtime seq map) — fine, cancels carry no seq dependency
    here. rewindData/shrinkData already accept an explicit `id` arg (default `rw-${seq}`/`sh-${seq}`) — pass
    explicit ids to control what a cancel targets.

# CONTRACT — the sibling data-model task this consumes (treat as already-landed)
- file: src/markers.ts
  why: |
    Defines RewindMarker/ShrinkMarker (BOTH carry an `id: string` uuid field stamped by appendRewindMarker/
    appendShrinkMarker — this is what cancelledIds matches against). P3.M1.T1.S1 ADDS CancelMarker
    { kind:"cancel"; targetId:string; seq; ts } (NO own id — a cancel is not itself cancellable),
    CancelMarkerInput, appendCancelMarker, customType "mulligan:cancel", and extends MulliganEnvelope.kind
    to include "cancel". THIS TASK does NOT import CancelMarker — it reads data defensively via readOwn, so
    it is decoupled from the exact interface. But it MUST agree that targetId = the marker's uuid `id`.
  section: RewindMarker.id, ShrinkMarker.id, CancelMarker.targetId (added by P3.M1.T1.S1)
  gotcha: |
    targetId = the marker's uuid `id` field, NOT the Pi entry id. readMarkers drops markers whose data.id ∈
    cancelledIds. (P3.M1.T1.S1's PRP fixed this contract; the implementation_patterns.md "entry id"
    alternative is OVER-RULED — do NOT switch to entry-id matching.)

# MUST UPDATE — the spec doc (Mode A: doc rides with the work)
- file: spec/06-context-filter.md
  why: §1 is "The handler (glue)"; its code block calls readMarkers(ctx). The cancel-drop behavior of
        readMarkers is currently undocumented. Add a short prose note immediately after the §1 code block
        (after the `stableSortBySeq` paragraph, before the §2 divider) so the readMarkers contract is complete.
  section: §1 (after the code block + stableSortBySeq paragraph)

# CONSUMER-SAFETY (validated — adding cancelledIds does NOT break these; do NOT edit them)
- file: src/transforms.ts
  why: |
    MarkerBundle (note singular, line ~1037) = { rewinds: RewindMarkerLike[]; shrinks: ShrinkMarkerLike[] }
    is the structural param type of filterPipeline. filter.ts's MarkersBundle stays assignable after adding
    cancelledIds: markers is a VARIABLE (the readMarkers result), not a fresh object literal, so TS excess-
    property checks do NOT fire. No edit needed.
- file: src/tools/audit.ts
  why: |
    Calls readMarkers(ctx) (line ~540) and reads ONLY markers.rewinds / markers.shrinks. Adding cancelledIds
    is additive. Beneficial side effect: audit now naturally reports ACTIVE-ONLY counts (cancelled dropped),
    which is exactly what P3.M1.T4.S1 builds on. No edit needed THIS task.
- file: src/nudges.ts
  why: |
    suppressCheck's markers param is { rewinds; shrinks } (ReadonlyArray). filter.ts's MarkersBundle is
    structurally assignable (extra metric/cancelledIds ignored). No edit needed.

# Architecture delta notes (Pattern 2 is the canonical sketch for THIS task)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  why: "Pattern 2 (readMarkers cancel-drop) sketches the exact loop branch + post-loop filter. Use the
        predicate it gives (verbatim). NOTE: that doc also floats an 'entry id' alternative for targetId
        — OVER-RULED by the work-item contract (targetId = the marker's uuid id). Ignore the alternative."
  section: "G3 / P3.M1 — Pattern 2"

# Re-planning contract (the previous task's PRP — defines what exists when this task starts)
- docfile: plan/003_2c3b19ff6a7b/P3M1T1S1/PRP.md
  why: P3.M1.T1.S1 lands CancelMarker/CancelMarkerInput/appendCancelMarker. This task consumes the resulting
        persisted mulligan:cancel entries but does not depend on importing the new types.
```

### Current Codebase tree (relevant slice)

```bash
src/
  filter.ts           # <-- MODIFY: MarkersBundle + readMarkers (cancel-collect + drop filter)
  markers.ts          # read-only dep (RewindMarker/ShrinkMarker/TurnMarker; CancelMarker added by P3.M1.T1.S1)
  transforms.ts       # NO CHANGE — MarkerBundle stays assignable (consumer-safety validated)
  tools/audit.ts      # NO CHANGE — reads markers.rewinds/shrinks; now sees active-only (correct)
  nudges.ts           # NO CHANGE — suppressCheck param stays assignable
test/
  filter.test.ts      # <-- MODIFY: cancelData/makeCancelEntry helpers + cancel-drop describe block
spec/
  06-context-filter.md # <-- MODIFY: §1 cancel-drop note (Mode A)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/filter.ts            # EXTENDED in place (no new file). MarkersBundle.cancelledIds + readMarkers cancel-drop.
test/filter.test.ts      # EXTENDED in place. cancelData/makeCancelEntry + new describe block.
spec/06-context-filter.md # EXTENDED in place. §1 prose note.
# No new files are created. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: targetId = the marker's uuid `id` field (RewindMarker.id / ShrinkMarker.id), NOT the Pi entry id.
// The drop matches data.id ∈ cancelledIds(targetIds). P3.M1.T1.S1's PRP fixes this; the implementation_patterns.md
// "entry id" alternative is OVER-RULED. Do NOT switch to entry-id matching — it would require tracking entry ids
// alongside marker data (readMarkers never does) and would diverge from the contract.

// CRITICAL: the drop predicate must use readOwn(r, "id") — a Proxy get-trap may throw, and readOwn swallows it.
// Never use `r.id` directly. The predicate `typeof id !== "string" || !cancelledIds.has(id)` KEEPS a marker when
// its id is unreadable (defensive — never drop on bad data) and DROPS it only when id is a string in the set.

// CRITICAL: declare `const cancelledIds = new Set<string>()` BEFORE the try block (alongside rewinds/shrinks/metric)
// so it is in scope for BOTH the getEntries-threw catch return AND the end-of-function return. The catch path
// returns an all-empty bundle { rewinds:[], shrinks:[], metric:null, cancelledIds:new Set() } — consistent shape.

// CRITICAL: the drop is order-independent BY CONSTRUCTION. The loop scans ALL entries in one pass (collecting
// rewinds/shrinks into arrays AND targetIds into the set), THEN the filter runs AFTER the loop. So a cancel entry
// positioned BEFORE its target marker in getEntries() still drops it. Do not add ordering logic.

// CRITICAL: MarkersBundle is consumed STRUCTURALLY by filterPipeline (transforms.ts MarkerBundle = {rewinds,shrinks})
// and by nudges.ts suppressCheck ({rewinds,shrinks}). Adding cancelledIds is fine: markers is a variable (not a
// fresh object literal) so TS excess-property checks don't fire, and the extra field is simply ignored by both.
// Validated — do not "fix" a non-existent type error by removing cancelledIds from the pipeline call.

// CRITICAL: cancelled markers STAY ON DISK. readMarkers just stops returning them in rewinds/shrinks. This is the
// audit trail (E21). Do not attempt to delete entries — ctx.sessionManager is READ-ONLY (C1) and readMarkers never
// writes. The cancel marker itself is a separate custom entry; it is NOT pushed into rewinds/shrinks (distinct
// customType+kind), so it never appears as an "active" marker.

// GOTCHA: the turn-metric marker has NO `id` field (GOTCHA #4 from markers.ts), so it can never be cancelled —
// and it is NOT in the rewinds/shrinks arrays, so the drop filter never sees it. No special-casing needed.

// GOTCHA: filter.test.ts vi.mocks "../src/transforms.js" at the top — filterPipeline is a fake. New readMarkers
// cancel-drop tests call readMarkers DIRECTLY (no pipeline invocation), like the existing "buckets rewind/shrink"
// test, so the mock is irrelevant to them. Do not try to assert cancel-drop effects through contextHandler/the
// pipeline mock — assert at the readMarkers return level (that is the unit under test).

// GOTCHA: a cancel entry that targets its OWN (non-existent) data.id, or an empty-string/non-string targetId,
// is a malformed/pointless cancel — skip it (do not add to cancelledIds). The contract pins "non-empty string".
```

## Implementation Blueprint

### Data models and structure

Only the `MarkersBundle` interface changes (one field added). No new types are introduced in this task.

```typescript
// src/filter.ts — extend the existing MarkersBundle interface (one line):
export interface MarkersBundle {
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  metric: TurnMetric | null;
  /** uuid `id`s of rewind/shrink markers retired by a mulligan:cancel entry (P3.M1.T2.S1 / E21).
   *  readMarkers drops any marker whose data.id ∈ this set BEFORE returning, so the pipeline only sees the
   *  active markers. Always present (empty Set when there are no cancels on the branch). */
  cancelledIds: Set<string>;
}
```

`cancelledIds` is intentionally a `Set<string>` (not an array): membership test is O(1), duplicates (two cancels of the same id) collapse, and it is the natural shape for "is this id retired?".

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/filter.ts — extend the MarkersBundle interface
  - EDIT: the existing `export interface MarkersBundle { ... }` block (around line 64).
  - ADD: `cancelledIds: Set<string>;` as the 4th field (after `metric`). Include the JSDoc above.
  - WHY: the interface is the contract the test + audit + structural pipeline consumers read; one additive field.
  - NAMING/PLACEMENT: in-place edit on the existing interface; do not move it.

Task 2: MODIFY src/filter.ts — collect cancels + drop retired markers in readMarkers
  - This is the core change. Five small edits inside readMarkers (function spans ~lines 94-154):
  - EDIT A: declare the set. Add `const cancelledIds = new Set<string>();` immediately after
            `const shrinks: ShrinkMarker[] = [];` and `let metric: TurnMetric | null = null;` (top of the
            function body, BEFORE the `let entries: SessionEntry[]` / try block). This keeps it in scope for
            both return paths.
  - EDIT B: the getEntries-threw catch. Change `return { rewinds, shrinks, metric };` (around line 128) to
            `return { rewinds, shrinks, metric, cancelledIds };` (all empty here — fail-open empty bundle).
  - EDIT C: the loop dispatch. Add a 4th else-if branch AFTER the turn-metric branch and BEFORE the trailing
            `// else: future/unknown mulligan:* custom entry → skip` comment:
            ```typescript
            } else if (customType === "mulligan:cancel" && kind === "cancel") {
              // P3.M1.T2.S1 / E21: collect the uuid id of the rewind/shrink being retired. readMarkers drops
              // any marker whose data.id ∈ cancelledIds AFTER the scan (order-independent: full scan, then filter).
              const targetId = readOwn(data, "targetId");
              if (typeof targetId === "string" && targetId.length > 0) cancelledIds.add(targetId);
              // else: malformed cancel (non-string / empty / missing targetId) → skip (fail-open, never throw)
            }
            ```
  - EDIT D: the post-loop drop filter. AFTER the closing `}` of the `for (const entry of entries)` loop and
            BEFORE the final return, add:
            ```typescript
            // P3.M1.T2.S1 / E21: drop any marker retired by a mulligan:cancel (by its uuid id). A marker whose
            // id is unreadable (defensive) is KEPT — never drop on bad data. Cancelled markers stay on disk
            // (audit trail); they are simply skipped going forward.
            const activeRewinds = rewinds.filter(r => {
              const id = readOwn(r, "id");
              return typeof id !== "string" || !cancelledIds.has(id);
            });
            const activeShrinks = shrinks.filter(s => {
              const id = readOwn(s, "id");
              return typeof id !== "string" || !cancelledIds.has(id);
            });
            ```
            (The predicate is pinned VERBATIM by the work-item contract — do not rephrase it.)
  - EDIT E: the final return. Change `return { rewinds, shrinks, metric };` (around line 154) to
            `return { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds };`
  - FOLLOW pattern: the existing `mulligan:turn-metric` dispatch branch (same guard shape, same readOwn idiom).
  - GOTCHA: do NOT change the function signature, the `type === "custom"` filter, the `customType.startsWith
    ("mulligan:")` guard, or the `isRecord(data)` guard — the cancel branch rides the SAME defensive scaffolding.
  - NAMING: activeRewinds / activeShrinks (local consts); cancelledIds (matches the MarkersBundle field name).

Task 3: MODIFY test/filter.test.ts — add cancel-drop tests
  - ADD helpers near the existing rewindData/shrinkData/metricData/customEntry helpers:
    ```typescript
    /** A cancel marker `data` payload (kind 'cancel'; customType 'mulligan:cancel'). */
    function cancelData(targetId: string): Record<string, unknown> {
      return { schema: "pi-mulligan", v: 1, kind: "cancel", targetId, seq: 0, ts: 1 };
    }
    /** Convenience: a mulligan:cancel custom entry targeting the given marker uuid id. */
    function makeCancelEntry(targetId: string): SessionEntry {
      return customEntry("mulligan:cancel", cancelData(targetId));
    }
    ```
  - ADD a new describe block "readMarkers — cancel-drop (marker retraction, spec/08 E21)" AFTER the existing
    "readMarkers — fresh read, bucket, latest metric ..." block. Mirror its style (call readMarkers directly,
    assert on the bundle). Cases (one `it` each):
    1. "cancelling a shrink drops it from shrinks and records its id in cancelledIds" — entries: shrink(id "sh-1")
       + makeCancelEntry("sh-1"); assert shrinks.length===0, cancelledIds===new Set(["sh-1"]).
    2. "cancelling a rewind drops it from rewinds and records its id" — entries: rewind(id "rw-1") + makeCancelEntry
       ("rw-1"); assert rewinds.length===0, cancelledIds===new Set(["rw-1"]).
    3. "cancelling a non-existent id drops no markers (safe no-op)" — entries: rewind("rw-1"), shrink("sh-2"),
       makeCancelEntry("nope"); assert rewinds.length===1, shrinks.length===1, cancelledIds===new Set(["nope"]).
    4. "multiple cancels drop all targeted markers; untargeted markers survive" — entries: rewind("rw-1"),
       rewind("rw-2"), shrink("sh-3"), shrink("sh-keep"), makeCancelEntry("rw-1"), makeCancelEntry("sh-3");
       assert rewinds.map(m=>m.id)===["rw-2"], shrinks.map(m=>m.id)===["sh-keep"],
       cancelledIds===new Set(["rw-1","sh-3"]).
    5. "drop is order-independent: a cancel BEFORE its target still drops it" — entries: makeCancelEntry("sh-1"),
       shrink("sh-1"); assert shrinks.length===0. (Proves the full-scan-then-filter design.)
    6. "skips malformed cancel entries (non-string/empty/missing targetId) without throwing" — three cancel
       entries: targetId:123 (number), targetId:"" (empty), no targetId field; assert no throw AND
       cancelledIds.size===0 AND they are NOT pushed into rewinds/shrinks.
    7. "cancelledIds is always a (possibly empty) Set on the bundle" — readMarkers(makeCtx({entries:[]}));
       assert bundle.cancelledIds instanceof Set and size===0. (Also covers the getEntries-threw path: assert the
       same for readMarkers(makeCtx({throwOnGetEntries:true})).)
    8. "does NOT drop a marker lacking a readable id field (defensive — keep on bad data)" — a rewind `data` with
       NO id field + makeCancelEntry("anything"); assert rewinds.length===1 (kept — id unreadable).
  - OPTIONAL but recommended: add to the existing "skips malformed/unknown mulligan:* entries" test an extra
    `customEntry("mulligan:cancel", { kind: "shrink" })` (wrong kind) and assert it is still skipped and
    cancelledIds stays empty — proves the kind guard on the cancel branch.
  - FOLLOW pattern: the existing "buckets mulligan:rewind and mulligan:shrink" test (direct readMarkers call,
    field-level assertions via casts like `(bundle.shrinks[0] as { id: string }).id`).
  - NO IMPORT CHANGES: MarkersBundle is already imported (type-only); cancelData/makeCancelEntry are local.

Task 4: MODIFY spec/06-context-filter.md — document the cancel-drop (Mode A: rides with the work)
  - ADD a prose note immediately AFTER the §1 code block's trailing `stableSortBySeq` paragraph and BEFORE the
    `---` divider that starts §2. Suggested text (adapt to the file's tone):
    > **Marker retraction (cancel-drop).** `readMarkers` also scans `mulligan:cancel` control entries. Each
    > carries a `targetId` naming the uuid `id` of a rewind/shrink marker being retired (the value returned as
    > the marker's `id` at creation). After the scan, `readMarkers` drops any rewind/shrink whose `id` is in the
    > collected `cancelledIds` set, so the retired marker no longer applies on subsequent `context` fires
    > (spec/08 E21; amends D6). The drop is order-independent (a full scan precedes the filter), cancels with a
    > non-string/empty `targetId` are skipped, and a marker whose `id` is unreadable is kept (defensive).
    > Cancelled markers stay on disk (audit trail) — they are simply skipped going forward; the returned
    > `MarkersBundle` exposes `cancelledIds: Set<string>` so the pipeline only ever sees the *active* markers,
    > and `mulligan_audit` (§7) / stale-retirement can report or count them.
  - WHY: §1 is the authoritative readMarkers contract; without this note the cancel-drop is undocumented.
  - Do NOT renumber §2+ — insert as a trailing paragraph of §1.
```

### Implementation Patterns & Key Details

```typescript
// The cancel-collection branch is a stripped clone of the turn-metric dispatch branch (same guard + readOwn):
//   } else if (customType === "mulligan:cancel" && kind === "cancel") {
//     const targetId = readOwn(data, "targetId");
//     if (typeof targetId === "string" && targetId.length > 0) cancelledIds.add(targetId);
//   }
// It does NOT keep "latest by seq" (cancels aren't ordered against rewinds/shrinks for application) — it just
// collects every targetId. Duplicate cancels of the same id collapse naturally (Set semantics).

// The drop filter predicate (PINNED VERBATIM by the contract — do not rephrase):
//   rewinds.filter(r => { const id = readOwn(r, "id"); return typeof id !== "string" || !cancelledIds.has(id); })
// Truth table:
//   id is not a string (undefined/missing) → `typeof id !== "string"` is true  → KEEP (defensive)
//   id is a string AND id ∈ cancelledIds    → `!cancelledIds.has(id)` is false → DROP
//   id is a string AND id ∉ cancelledIds    → `!cancelledIds.has(id)` is true  → KEEP

// readOwn(r, "id") — r is a RewindMarker/ShrinkMarker (cast from data). readOwn goes through isRecord + a
// try/catch'd obj[key] access, so a Proxy-trap throw on a hostile marker object is swallowed → undefined → KEEP.
// This is the SAME defense-in-depth that lets readMarkers survive malformed entries today (E13).

// Both return paths carry cancelledIds (same shape contract):
//   catch (getEntries threw): { rewinds, shrinks, metric, cancelledIds }  // all empty
//   end of function:          { rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }
```

### Integration Points

```yaml
TYPES (src/filter.ts):
  - extend: "MarkersBundle += cancelledIds: Set<string>" (one field; exported)

NO DATABASE / NO CONFIG / NO ROUTES / NO NEW FILES / NO INDEX.TS CHANGES THIS TASK.
  - markers.ts CancelMarker/appendCancelMarker is a DIFFERENT task (P3.M1.T1.S1) — already-landed contract.
  - tools/cancel.ts (mulligan_cancel tool) is a DIFFERENT task (P3.M1.T3.S1).
  - audit.ts cancelled-count listing is a DIFFERENT task (P3.M1.T4.S1).
  - Do NOT touch markers.ts, transforms.ts, tools/, nudges.ts, config.ts, runtime.ts, or index.ts.

DOCS (spec/06-context-filter.md):
  - §1: trailing prose note (after the code block + stableSortBySeq paragraph) documenting the cancel-drop.

DOWNSTREAM CONSUMERS (no edit needed; documented for awareness):
  - contextHandler (filter.ts): reads markers.rewinds/.shrinks/.metric — now sees active-only. Correct.
  - audit.ts renderAuditReport: reads markers.rewinds/.shrinks — now reports active-only counts (the
    cancelled-count row is added in P3.M1.T4.S1, which will ALSO read markers.cancelledIds).
  - stale-retirement (P3.M2.T3.S1): will read markers.cancelledIds to skip already-retired shrinks.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: zero errors. Adding cancelledIds to MarkersBundle is additive; filterPipeline's MarkerBundle param
# ({rewinds,shrinks}) and nudges.ts suppressCheck param ({rewinds,shrinks}) stay structurally assignable because
# markers is passed as a variable (not a fresh literal). If a type error appears, it is NOT from this change's
# design — re-check you didn't break the readMarkers return shape (both returns must carry cancelledIds).

# (No linter/formatter is configured in this repo — package.json has only "test" and "smoke" scripts.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the filter test file (fast feedback loop while iterating).
npx vitest run test/filter.test.ts
# Expected: all EXISTING tests pass (they assert fields, not full-object shape, so the new cancelledIds field
# is invisible to them) + all NEW cancel-drop tests pass.

# Then run the FULL suite to confirm no downstream regressions (markers/audit/edge/drift/nudges).
npm test
# Expected: all green. Specific files to eyeball:
#   test/markers.test.ts     — unaffected (does not import MarkersBundle).
#   test/tools/audit.test.ts — unaffected (its fixtures have no cancels, so nRewinds/nShrinks are unchanged;
#                              if a fixture DID add a cancel it would now see active-only — none do).
#   test/edge-cases.test.ts  — the "throwing getEntries → empty bundle" test (line ~742) only asserts out.messages,
#                              not the bundle shape, so it is unaffected.
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds no tool registration and no event-handler signature change (contextHandler is untouched
# beyond reading the now-filtered markers). The integration smoke harness (test/integration/) is unaffected.
# Optional sanity check:
npm run smoke   # optional — should pass unchanged (no cancel markers in the smoke scenarios yet)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof via the new unit tests (the real gate for this read-layer change):
#   - cancel a shrink → shrink absent from readMarkers().shrinks; id in cancelledIds
#   - cancel a rewind → rewind absent from readMarkers().rewinds; id in cancelledIds
#   - cancel a non-existent id → nothing dropped
#   - multiple cancels → all targeted dropped; untargeted survive
#   - cancel BEFORE its target → still drops (order-independence)
#   - malformed cancel (non-string/empty/missing targetId) → skipped, no throw
#   - marker with unreadable id → kept (defensive)
# These are the unit-level mirror of E21 acceptance (b) ("on the context fire after cancellation the transform
# no longer applies"). The pipeline-level "original message reappears verbatim" assertion is satisfied
# transitively: if the marker is absent from the bundle, filterPipeline never applies it, so the original
# message passes through unchanged. `npx vitest run test/filter.test.ts` covers them.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (MarkersBundle still assignable to filterPipeline/nudges params).
- [ ] `npx vitest run test/filter.test.ts` — all tests pass (existing + new cancel-drop block).
- [ ] `npm test` — full suite green (no regressions in markers/audit/edge/drift/nudges).

### Feature Validation
- [ ] `readMarkers` returns `{ rewinds: activeRewinds, shrinks: activeShrinks, metric, cancelledIds }`.
- [ ] Cancelled rewind/shrink (matched by uuid id) is absent from the returned arrays; id is in `cancelledIds`.
- [ ] Cancelling a non-existent id drops nothing; multiple cancels drop all targeted; order-independent.
- [ ] Malformed cancels skipped; marker with unreadable id kept; never throws; `cancelledIds` always a Set.
- [ ] Both return paths (end-of-function + getEntries-threw catch) carry `cancelledIds`.
- [ ] `spec/06-context-filter.md` §1 has the cancel-drop note.

### Code Quality Validation
- [ ] The cancel branch mirrors the existing dispatch style (same guard + readOwn idiom + trailing skip comment).
- [ ] The drop predicate is the contract's verbatim predicate (not rephrased).
- [ ] `cancelledIds` declared once at function top (in scope for both returns); no duplicate declarations.
- [ ] No changes outside `src/filter.ts`, `test/filter.test.ts`, `spec/06-context-filter.md`.

### Documentation & Deployment
- [ ] JSDoc on `cancelledIds` states it is the uuid-id set, always present, drives the active-only view.
- [ ] `spec/06-context-filter.md` note states targetId = marker uuid id, order-independent, defensive, on-disk retained.

---

## Anti-Patterns to Avoid

- ❌ Do NOT match cancels by the Pi **entry id** — the contract pins `targetId` = the marker's uuid `id` field. (implementation_patterns.md floated an entry-id alternative; it is OVER-RULED.)
- ❌ Do NOT rephrase the drop predicate — use `typeof id !== "string" || !cancelledIds.has(id)` verbatim. Rewording it (e.g. `cancelledIds.has(id) === false`) subtly breaks the defensive keep-on-unreadable-id behavior.
- ❌ Do NOT use `r.id` directly — use `readOwn(r, "id")` (a Proxy get-trap may throw; readOwn swallows it → undefined → keep).
- ❌ Do NOT filter inside the loop or attempt ordering logic — collect ALL targetIds in the single pass, then filter AFTER the loop. (A cancel before its target must still drop it.)
- ❌ Do NOT add `cancelledIds` only to one return path — both the end-of-function return AND the getEntries-threw catch must carry it (same shape contract).
- ❌ Do NOT push the cancel entry into rewinds/shrinks — it is a distinct `customType+kind`; it must never appear as an active marker.
- ❌ Do NOT delete cancelled entries from disk or write through ctx.sessionManager (read-only, C1) — readMarkers never writes; cancelled markers stay for the audit trail (E21).
- ❌ Do NOT modify markers.ts, transforms.ts, tools/, nudges.ts, config.ts, runtime.ts, or index.ts — this task is filter.ts + its test + the spec doc only.
- ❌ Do NOT create a new file — all changes are additive edits to existing files.
- ❌ Do NOT over-couple to the CancelMarker type — read data defensively via readOwn (filter.ts must not gain a runtime import dependency on the new marker interface; it already imports only RewindMarker/ShrinkMarker/TurnMetric from markers.ts).

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. The change is a small, well-bounded extension of an existing, heavily-commented function (`readMarkers`) with a verbatim-pinned predicate and a cloned dispatch branch. The consumer-safety analysis (transforms.ts `MarkerBundle`, audit.ts, nudges.ts `suppressCheck`) is validated: adding `cancelledIds` is structurally additive with zero required edits elsewhere. The test fakes already exist and are reused; only two small local helpers are added. The sole residual risk is a missed assertion in an existing test that does a full-object `toEqual` on a readMarkers bundle — ruled out by reading filter.test.ts / edge-cases.test.ts (they assert fields, not shapes).