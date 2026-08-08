# P1.M1.T1.S1 — Blast-Radius Verification Notes

## Confirmed root cause (matches research_findings.md §CRITICAL FINDING)
- `getBranch()` (session-manager.js:943-952) collects leaf→root then `.reverse()` → **returns ROOT→LEAF**
  (verified in architecture/pi_session_model.md Q2, lines 50-72).
- `resolveCheckpoint` (src/transforms.ts:450) docstring/code ASSUME branchEntries is **LEAF→ROOT** and do an
  internal `[...branchEntries].reverse()` (line 477) to "get root→leaf".
- Production callers feed `getBranch()` VERBATIM (root→leaf), so the internal reverse flips it to leaf→root →
  the entry→message walk goes BACKWARDS → iTarget lands wrong → BUG-003 (empty/garbage removal set).

## ALL callers of resolveCheckpoint (and their branchEntries order)
Every production caller feeds `getBranch()` output directly = ROOT→LEAF. NONE pre-reverses to leaf→root:
| caller | site | order fed |
|---|---|---|
| filterPipeline dispatch | src/transforms.ts:1010 | branchEntries param (4th arg) ← filter.ts:184 `getBranch()` |
| resolvePreview (rewind tool) | src/tools/rewind.ts:288-289 | `ctx.sessionManager.getBranch()` |
| contextHandler | src/filter.ts:184 | `ctx.sessionManager.getBranch()` → filterPipeline |
| audit tool (re-run) | src/tools/audit.ts:502 | `ctx.sessionManager.getBranch()` → filterPipeline |
➜ Removing the internal `.reverse()` is consistent across ALL call sites. No caller breaks.

## Test fixtures that are WALK-DIRECTION-DEPENDENT (must be reordered to root→leaf)
ONLY in `test/transforms.test.ts` — the `resolveCheckpoint` describe block (13 tests, lines 747-882).
Each fixture currently lists entries LEAF→ROOT (leaf first, root last) with a comment claiming
"getBranch() is LEAF→ROOT" (line 752-753 — WRONG). Fix: reverse each fixture array to root→leaf, keep all
assertions identical (verified: the buggy code's `.reverse()` + leaf→root fixture = no-reverse + root→leaf
fixture produce the SAME walk → every expected `remove` array is unchanged).

## Tests that are NOT walk-direction-dependent (do NOT touch)
- `test/tools/rewind.test.ts` checkpoint tests (lines ~324, ~474, ~610): `branch` is NEVER populated
  (`grep "branch:"` returns empty); all use `contextEntries: []` / single-msg / throwing-getBranch → K=0 no-ops.
  No walk-direction assertion. (Only stale COMMENT at line 100: "SessionEntry[] leaf→root" — fix as ride-along.)
- `test/edge-cases.test.ts:619`: passes `[] as BranchEntry[]` (empty → label absent → null → no-op).
  makeCtx doc at line 177 says only "branch (getBranch)" — neutral, no ordering claim.

## The most-recent label search (step 2) — ALSO must change
Current step-2 loop `for (const e of branchEntries)` iterates FORWARD. With leaf→root fixtures that found the
most-recent (leaf-most) label first. After reorder to root→leaf, a forward scan finds the OLDEST label first.
FIX: iterate branchEntries in REVERSE (index high→low) so most-recent still wins. NONE of the 13 current tests
have >1 matching label, so this is forward-compatible only (exercised later by P1.M3.T1.S1 multi-rewind tests).
No current assertion flips.

## Additional stale "leaf→root" comments (ride-along consistency — same factual claim being corrected)
Leaving these would make the codebase self-contradictory immediately after the fix:
- src/transforms.ts:966 — filterPipeline `@param branchEntries ... (leaf→root)` → fix to ROOT→LEAF
- src/tools/rewind.ts:266 — `GOTCHA #8: ... getBranch(), leaf→root` → fix to ROOT→LEAF
- test/tools/rewind.test.ts:100 — makeCtx doc "SessionEntry[] leaf→root" → fix to root→leaf

## Baseline test result (PROOF tests pass for the wrong reason today)
`npx vitest run test/transforms.test.ts -t "resolveCheckpoint"` → **13 passed | 119 skipped (132)**.
After the fix (root→leaf fixtures + no-reverse + reverse label scan) the SAME 13 must pass — proving the fix
corrects the mechanism without changing the (already-correct-by-coincidence) asserted outputs.

## Exact edit sites (line numbers current as of this research)
transforms.ts: @param 445; step-2/3 docstring 413-416; step-2 inline 466; step-3 inline 477 + code;
               filterPipeline @param 966.
test/transforms.test.ts: comment 752-753; 7 fixtures in describe block 747-882 (reorder arrays).
test/tools/rewind.test.ts:100 (comment), src/tools/rewind.ts:266 (comment).

## Out of scope (other subtasks)
- P1.M1.T2.S1 — setCheckpoint labeling a stable entry (markers.ts:327-333).
- P1.M1.T3.S1 — orphan prevention (snap iTarget to unit boundary).
- P1.M4.T1.S1 — spec/06 idempotency + resolver DESCRIPTIONS (spec docs, separate).
This S1 = walk direction + fixtures + in-code JSDoc/comments ONLY.