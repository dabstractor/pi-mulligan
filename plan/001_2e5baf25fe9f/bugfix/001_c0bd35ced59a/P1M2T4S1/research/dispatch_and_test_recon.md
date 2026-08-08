# Recon — P1.M2.T4.S1 (filterPipeline hideEntryIds dispatch + permanent-hiding regression tests)

VERIFIED LIVE on the current tree. All facts below were read directly from source/test, not inferred.

## 1. Baseline (VERIFIED)

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `npx vitest run` → **18 files / 690 tests green**. (transforms.test.ts is the big one; ~the resolvePinnedHide
  suite added by P1.M2.T2.S1 pushed the count from the original 671 → 676 → 690.)
- `grep -c '^import' src/transforms.ts` → **0** (transforms.ts stays Pi-FREE; my edit MUST NOT add an import).
- No lint/format tool configured (devDeps = typescript + vitest + @types/node). Gate = `tsc` + `vitest` only.

## 2. Dependency-landed state (all three upstream pieces are on disk)

| Piece | Where | State |
|---|---|---|
| `hideEntryIds?: string[]` on `RewindMarker`/`RewindMarkerInput` | `src/markers.ts:72-74` | LANDED (P1.M2.T1.S1) |
| `hideEntryIds?: string[]` on `RewindMarkerLike` | `src/transforms.ts:929-935` | LANDED (P1.M2.T1.S1) |
| `resolvePinnedHide(messages, branchEntries, hideEntryIds): number[]` | `src/transforms.ts:625` | LANDED (P1.M2.T2.S1) |
| `captureHideEntryIds` producer | `src/tools/rewind.ts` | IN-FLIGHT (P1.M2.T3.S1, parallel). Treat as CONTRACT: every NEW rewind marker will carry `hideEntryIds` (possibly `[]`). |
| `filterPipeline` dispatch on `hideEntryIds` | `src/transforms.ts:1124-1154` | **MISSING — this is MY task.** |

## 3. The exact dispatch block to edit (src/transforms.ts:1124-1154) — VERBATIM

```ts
  // 1) REWINDS, oldest-first (stableSortBySeq). Each resolves against the CURRENT m; protectedOk gates each.
  for (const rw of stableSortBySeq(rewinds)) {
    const granularity = readOwn(rw, "granularity");
    const excludeRaw = readOwn(rw, "excludeToolCallId");
    const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;

    let remove: number[];
    if (granularity === "last_tool_call_group") {
      // RE-PARTITION fresh each iteration so unit.indices index the CURRENT m (GOTCHA #2 — the §12 pseudocode's
      // partition-once is a stale-index bug after the first rewind reduces m).
      const units = partitionIntoUnits(m);
      remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
    } else if (granularity === "last_turn") {
      ...
    } else if (granularity === "checkpoint") {
      ...
    } else {
      remove = []; // unknown granularity → no-op
    }

    if (!protectedOk(m, remove, config)) continue;   // UNCHANGED
    m = applyRewind(m, remove);                       // UNCHANGED
  }
```

**The fix (fix_design.md §Change 4, verbatim contract from item_description):** insert a `hideEntryIds` dispatch as the
FIRST branch of the if/else, making the existing relative resolution the ELSE branches (backward-compat legacy
fallback). `protectedOk` + `applyRewind` are UNCHANGED (they operate on `remove` regardless of which resolver
produced it).

```
const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");
let remove: number[];
if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) {
  remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[]);
} else if (granularity === "last_tool_call_group") {  // LEGACY FALLBACK (old markers w/o hideEntryIds)
  ...
}
```

### Why this is the exact right shape (3 invariants from fix_design.md §Change 4 + the resolver JSDoc)
1. **`Array.isArray(...) && length > 0` gate** — matches the resolver's own defensive `length === 0 → return []` AND the
   item_description's exact predicate. `[]` (K=0 marker, or capture failure) falls through to legacy (same behavior as
   an old marker — correct).
2. **`branchEntries` default** — `Array.isArray(branchEntries) ? branchEntries : []`. resolvePinnedHide's defensive
   guard then makes absent/empty branchEntries → `[]` remove → idempotent no-op (safe).
3. **Refusal does NOT fall back to legacy.** resolvePinnedHide returns `[]` on compaction/alignment refusal (NOT null).
   Because the `hideEntryIds.length > 0` gate already fired, the ELSE chain is NOT entered → a refused pinned hide no-ops
   this fire (marker persists, retried next fire). This is INTENTIONAL (resolver JSDoc lines 609-613): falling back to
   legacy relative resolution on refusal would RE-INTRODUCE BUG-001/BUG-002. The marker just waits out the compaction.

## 4. Test idiom (test/transforms.test.ts) — VERBATIM facts

- **Imports (line 2)** already include `resolvePinnedHide`, `filterPipeline`, `RewindMarkerLike`, `MarkerBundle`,
  `ProtectedConfig`, `BranchEntry`, `MessageLike`. NO import change needed for my new tests.
- **Module-scope fixtures (reuse verbatim):** `asst(...callIds)`, `asstText(text)`, `result(toolCallId)`, `user(text)`,
  `custom(customType)`, `entry(id, type, extra)` → `{ type, id, parentId: null, timestamp: "t", ...extra }`.
- **`entryMessageYield`:** `message`/`custom_message`/`branch_summary` → `1`; `compaction`/unknown → `-1` (refuse).
- **`isContextProducingType`:** `message`/`custom_message`/`branch_summary`/`compaction` → true.
  → In my tests I use `entry("e_x", "message")` for every entry (matches the existing resolvePinnedHide tests exactly:
  `entry("e1", "message")` throughout). 1 message per entry → alignment holds when `branch.length === messages.length`.
- **Existing `mkRewind(seq, granularity, extra)` + `cfg` are CLOSURE-LOCAL** inside `describe("filterPipeline …", …)`
  (lines 1171-1529). My new top-level describe is OUTSIDE that closure → I define a LOCAL `cfg` and build markers inline
  (the item_description gives explicit marker shapes anyway: `{seq, granularity, hideEntryIds, excludeToolCallId}`).
- **Reference-based assertions are the idiom:** existing tests use `expect(out).toBe(msgs[5])` / `expect(out[3]).toBe(...)`
  (applyRewind filters by reference → survivors keep identity). So `expect(out).not.toContain(msgs[1])` is the right
  assertion for "BAD hidden", and `expect(out).toContain(msgs2[6])` for "GOOD visible".

## 5. The missing test pattern (spec_and_test_analysis.md §KEY QUESTION 3) — the CORE regression

The 690-test suite has NO test that does: build msgs1, fire filterPipeline (BAD hidden), GROW to msgs2 (+ new work),
fire again, assert BAD STILL hidden AND new work visible. This is THE test that would have caught BUG-001/002. The
existing "determinism" test (line 1523) fires the SAME msgs twice; "idempotency (shrinks)" (line 1516) fires
`filterPipeline(filterPipeline(m))` for shrinks only. Neither grows the input. My new describe adds exactly this.

### Traced scenario (item_description parts a + b) — hand-verified
msgs1 = `[user, asst('BAD'), result('BAD'), asst('RW'), result('RW'), custom('mulligan:note')]` (6 msgs)
branch1 = `[e_u, e_bad_a, e_bad_r, e_rw_a, e_rw_r, e_note]` (6 "message" entries, 1:1 with msgs)
marker = `{seq:1, granularity:'last_tool_call_group', hideEntryIds:['e_bad_a','e_bad_r'], excludeToolCallId:'RW'}`
- Fire 1: resolvePinnedHide(branch1, ['e_bad_a','e_bad_r']) walks → e_bad_a@idx1, e_bad_r@idx2 → remove=[1,2] →
  applyRewind drops msgs1[1],msgs1[2]. BAD hidden ✓.
- Fire 2: msgs2 = `[...msgs1, asst('GOOD'), result('GOOD')]` (8 msgs); branch2 = `[...branch1, e_good_a, e_good_r]`.
  SAME hideEntryIds → resolvePinnedHide still maps to [1,2] (e_good_* NOT pinned) → remove=[1,2] → applyRewind drops
  msgs2[1],msgs2[2]. BAD STILL hidden (PERMANENT ✓), msgs2[6],msgs2[7] (GOOD) survive (visible ✓).

### CRITICAL test gotcha (would silently fail otherwise)
The pinned path REQUIRES `branchEntries` (4th filterPipeline arg). If omitted, the dispatch passes `[]` →
resolvePinnedHide walks 0 entries → remove=[] → NOTHING hidden → test fails. So BOTH fires MUST pass `branch1`/`branch2`.
(The existing last_tool_call_group/last_turn filterPipeline tests omit branchEntries because the legacy path doesn't
need it — but the pinned path does. This is the #1 trap.)

## 6. Mode-A docs (filterPipeline JSDoc)

The JSDoc above filterPipeline has a `GRANULARITY DISPATCH (…)` bullet block (lines ~1083-1090). I add a PINNED bullet
at the TOP documenting the `hideEntryIds` dispatch-first + backward-compat fallback. This rides WITH the work
(item_description DOCS requirement).

## 7. Out of scope (DO NOT TOUCH — other subtasks own these)

- `resolvePinnedHide` body (P1.M2.T2 — landed).
- `captureHideEntryIds` + the rewind tool payload (P1.M2.T3 — in-flight parallel; treat as contract).
- `hideEntryIds` field on marker types (P1.M2.T1 — landed).
- `resolveCheckpoint`/`setCheckpoint` (P1.M1 — Complete).
- spec/06 idempotency docs (P1.M4 — Planned).
- smoke test assertions (P1.M3.T2 — Planned).

## 8. Parallel-task boundary with P1.M2.T3.S1 (the producer)

T3 (producer) writes `captureHideEntryIds` + threads `hideEntryIds` into the rewind tool payload. T4 (me, consumer)
reads `hideEntryIds` OFF the persisted marker via `readOwn(rw, "hideEntryIds")` in filterPipeline. **No file overlap:**
T3 edits `src/tools/rewind.ts` + `test/tools/rewind.test.ts`; T4 edits `src/transforms.ts` (dispatch + JSDoc) +
`test/transforms.test.ts` (regression describe). Zero merge-conflict surface. My task assumes T3 will land (every NEW
marker carries `hideEntryIds`, possibly `[]`); the `length > 0` gate handles `[]`/absent identically → my dispatch is
correct EVEN IF a marker somehow lacks the field (legacy fallback).