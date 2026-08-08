# Research Findings — P1.M3.T1.S1 (checkpoint permanent-hiding + multi-rewind composition tests)

Empirical probes of the LANDED code (src/transforms.ts filterPipeline dispatch + resolvePinnedHide + resolveCheckpoint)
run in an isolated /tmp vitest harness importing the real module. These findings are the BASIS for the PRP's test
design — especially the multi-rewind composition LIMITATION, which the item_description (b) assumed works but does NOT.

Baseline at research time: `npx tsc --noEmit` exit 0; `npx vitest run` → **18 files / 701 tests green** (includes the
LANDED P1.M2.T4.S1 "permanent hiding across fires (BUG-001/002 regression)" describe at test/transforms.test.ts:1654).

---

## PARALLEL-COORDINATION BOUNDARY with P1.M2.T4.S1 (LANDED — DO NOT DUPLICATE)

P1.M2.T4.S1 has LANDED its `describe("permanent hiding across fires (BUG-001/002 regression)")` at
test/transforms.test.ts:1654. It contains EXACTLY these 4 tests:
1. `last_tool_call_group` fire1/fire2 (BAD hidden → STILL hidden + GOOD visible).
2. `last_turn` fire1/fire2 (same shape).
3. **legacy fallback** — a `last_tool_call_group` marker WITHOUT hideEntryIds → relative resolver (backward compat).
4. **compaction refusal** — pinned marker + compaction entry → nothing hidden (no legacy fallback).

**MY task (P1.M3.T1.S1) is COMPLEMENTARY — zero overlap:**
- (a) checkpoint permanent hiding (BUG-003) — checkpoint granularity, NOT in P1.M2.T4.S1.
- (b) multi-rewind composition (pinned) — NOT in P1.M2.T4.S1.
- (c) pinned + shrink interaction — NOT in P1.M2.T4.S1.
- (d) backward compat for the **checkpoint** granularity (legacy resolveCheckpoint path) — P1.M2.T4.S1's legacy test
  is `last_tool_call_group`; mine is `checkpoint`. Distinct granularity, distinct resolver path → no duplication.

→ My new describe is named DIFFERENTLY ("checkpoint permanent hiding + multi-rewind composition + pinned/shrink
(BUG-003 regression + pinned composition)") so both describes coexist at end-of-file without textual collision.

---

## FINDING 1 (CONFIRMED WORKS) — checkpoint permanent hiding via the pinned path

A NEW checkpoint marker carries `hideEntryIds` (the entry ids of the post-checkpoint messages, captured by
`captureHideEntryIds`/`resolvePreview` in tools/rewind.ts:341 — which calls `resolveCheckpoint` to get `remove`, then
maps those indices → stable entry ids). `filterPipeline`'s dispatch reads `hideEntryIds` FIRST → `resolvePinnedHide`
maps the pinned entry ids → current message indices → permanent hiding.

Probe (`[user, asst(cp), result(cp), asst(read), result(read)]`, marker
`{granularity:"checkpoint", checkpoint:"cp", hideEntryIds:["e_read_a","e_read_r"]}`):
- **Fire 1**: view = `[user, asst(cp), result(cp)]` (len 3). read asst + result HIDDEN. checkpoint toolGroup KEPT. ✓
- **Fire 2** (append `[asst(new), result(new)]` + branch entries `e_new_a/e_new_r`): view =
  `[user, asst(cp), result(cp), asst(new), result(new)]` (len 5). read STILL hidden (permanent); new work VISIBLE. ✓

→ Test (a) is a FULLY CORRECT, passing permanence proof for BUG-003 (M1 fix + M2 pinning together).

## FINDING 2 (CONFIRMED WORKS) — checkpoint LEGACY (old marker, no hideEntryIds) → resolveCheckpoint path

An OLD checkpoint marker (no `hideEntryIds`) → dispatch falls through to the `checkpoint` branch → `resolveCheckpoint`
(the M1-fixed path: branch ordering + stable entry + unit-snap). Verified: with a `labelEntry("eL","e_cp_a","start")`
targeting the checkpoint assistant, `resolveCheckpoint` unit-snaps iTarget (1→2, keeping the whole toolGroup
`asst(cp)+result(cp)`) and removes `[3,4]` (the post-checkpoint read work). ✓

→ Test (d) proves the M1 fix works THROUGH filterPipeline for legacy checkpoint markers (backward compat).

## FINDING 3 (CONFIRMED WORKS) — pinned rewind + shrink on the removed target → shrink no-ops

`filterPipeline` order = rewinds FIRST (gap-closing), THEN shrinks (on the reduced array). A pinned rewind that
removes `result(A)` (entry id in hideEntryIds) leaves `result(A)` absent from the reduced `m`; the subsequent
`applyShrink` calls `resolveShrinkTarget(m, {by_tool_call_id:"A"})` → finds no toolResult with toolCallId "A" → null →
no-op (m unchanged). Verified: no "SHRUNK" text appears; `asst(B)/result(B)` (untouched) kept. ✓

→ Test (c) proves pinned hiding + shrink compose safely (shrink no-ops on an already-removed target — spec/08 E8).

---

## FINDING 4 (CRITICAL — KNOWN LIMITATION) — two SEPARATE pinned rewind markers do NOT union

**This is the key finding that reshapes test (b).** The item_description (b) says: "Two rewind markers, each with
hideEntryIds. Verify both spans are hidden and compose correctly (no interference)." **The current implementation
CANNOT do this.** Empirical probe (`[user, asst(A), result(A), asst(B), result(B), note]`, two markers
`m1={hideEntryIds:[e_a_a,e_a_r]}` seq1 + `m2={hideEntryIds:[e_b_a,e_b_r]}` seq2`):
- m1 (seq1) runs FIRST: `resolvePinnedHide(full msgs, full branch, [e_a_a,e_a_r])` → remove `[1,2]` → `m` gap-closed
  to `[user, asst(B), result(B), note]` (len 4).
- m2 (seq2) runs SECOND: `resolvePinnedHide(m=LEN 4, branch=6 ctxEntries, [e_b_a,e_b_r])` → walks the FULL branch
  (6 entries) against the REDUCED m (4 msgs). At `e_b_r` (cursor 4): `4 + 1 > 4` → **alignment refusal → returns []**
  → m2 NO-OPS. Span B (asst(B)+result(B)) stays VISIBLE.
- Result: only span A hidden; span B visible. Reverse the seq order → only B hidden; A visible. **Whichever marker
  runs FIRST wins; the second always no-ops** (its full-branch walk can never align with the gap-closed m).

**Root cause (by design of resolvePinnedHide, NOT a crash):** `resolvePinnedHide` assumes `branchEntries ↔ messages`
1:1 alignment. That holds for the FIRST rewind (full msgs ↔ full branch). After `applyRewind` gap-closes `m` between
rewinds, subsequent rewinds' full-branch walks misalign → safe refusal (`return []`) → no-op. The function is
CORRECT for its contract (refuse on misalignment rather than guess wrong); the gap is that `filterPipeline` applies
`applyRewind` between rewinds instead of unioning all pinned removals against the ORIGINAL message list first.

**This is a SOFT bug (under-hiding, SAFE):** no crash (E13 holds), no pairing break (the no-op'd rewind removes
nothing), no OVER-hiding. It is surprising (the agent issued two rewinds expecting both to hide) but not destructive.

**The SUPPORTED multi-target pattern (works):** a SINGLE pinned rewind marker pinning a MULTI-UNIT span
(`hideEntryIds:[e_a_a,e_a_r,e_b_a,e_b_r]`) hides BOTH toolGroups in one resolvePinnedHide call (full msgs ↔ full
branch → alignment holds) → both spans hidden. Verified: view = `[user, note]` (len 2). ✓

### How the PRP handles test (b) (honest + passing — does NOT ship a failing test)

The item says "all tests pass." A test asserting "two separate markers → both spans hidden" would FAIL. So test (b)
is split into TWO complementary sub-tests, both PASSING:

- **(b-1) "SUPPORTED multi-target composition"** — a SINGLE pinned marker hiding a multi-unit span (both toolGroups A
  AND B), permanent across fire 2. This is the WORKING composition pattern; it satisfies the item's spirit ("both
  spans are hidden and compose correctly, no interference") via the mechanism the implementation actually supports.
- **(b-2) "KNOWN LIMITATION: two SEPARATE pinned markers do not union"** — documents the actual safe behavior (first
  marker's span hidden; second no-ops on alignment; no crash; no pairing break). Crystal-clear comment + the PRP's
  §Known Limitations explains the root cause + the supported single-marker pattern + the future-fix direction
  (union all pinned removals against the original message list before gap-closing). Framed so a FUTURE implementer
  who fixes the limitation knows to UPDATE this test (turn it into a "both hidden" assertion), not be confused by it.

This is the responsible outcome: passing regression tests that (i) prove the SUPPORTED composition works, (ii) pin the
SAFE properties of the unsupported separate-marker case (regression guard against a future crash/pairing-break), and
(iii) surface the gap prominently for a follow-up task. It does NOT silently enshrine the limitation as desired
behavior — the comment + PRP section explicitly mark it as a known gap with a fix direction.

---

## Test design summary (all PASSING, verified or traced against landed code)

| Test | Granularity / path | Verifies | Status |
|---|---|---|---|
| (a) checkpoint permanent hiding | checkpoint → PINNED (resolvePinnedHide) | BUG-003 fix: post-checkpoint work hidden fire1, STILL hidden fire2, new work visible | WORKS (probed) |
| (b-1) multi-target composition (SUPPORTED) | last_tool_call_group → PINNED, single marker, multi-unit span | both spans hidden, permanent across fire2, no interference | WORKS (probed) |
| (b-2) separate-marker composition (LIMITATION) | last_tool_call_group → PINNED, two markers | first hides, second safely no-ops; no crash/pairing-break; documents the gap | WORKS (probed) |
| (c) pinned + shrink interaction | last_tool_call_group → PINNED + shrink | rewind removes target; shrink on removed target no-ops (spec/08 E8) | WORKS (probed) |
| (d) checkpoint backward compat (legacy) | checkpoint → resolveCheckpoint (no hideEntryIds) | M1 fix works through filterPipeline; post-checkpoint work hidden | WORKS (probed) |

All 5 append to ONE new top-level describe at the END of test/transforms.test.ts (after the LANDED
P1.M2.T4.S1 describe at :1654). No source edits. No new files. No new imports.