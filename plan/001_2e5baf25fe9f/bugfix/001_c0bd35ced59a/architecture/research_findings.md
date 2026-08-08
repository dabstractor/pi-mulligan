# Research Findings: Subagent Reports Synthesis

## CRITICAL FINDING: resolveCheckpoint Branch Ordering Bug

### The Discrepancy
- **`getBranch()`** (session-manager.js:943-952) walks leaf→root then `.reverse()` → returns **ROOT→LEAF** order.
- **`resolveCheckpoint` docstring** (transforms.ts) says: `@param branchEntries getBranch() output, LEAF→ROOT`.
- **The tests** (transforms.test.ts:758) construct branchEntries in **LEAF→ROOT** order:
  ```typescript
  // branchEntries LEAF→ROOT (getBranch order):
  const branchEntries = [
    entry("e4", "message"), entry("e3", "message"), labelEntry("eL", "e2", "ckpt"),
    entry("e2", "message"), entry("e1", "message"),  // root is LAST
  ];
  ```
- **Production code** (filter.ts) passes `getBranch()` output directly (ROOT→LEAF) to filterPipeline→resolveCheckpoint.

### Impact
resolveCheckpoint's `[...branchEntries].reverse()` was designed to convert leaf→root → root→leaf.
But when production feeds it root→leaf, the reversal produces leaf→root — the walk goes BACKWARDS.
This is very likely the TRUE root cause (or major contributor) of BUG-003: the entry→message mapping
is inverted, so iTarget lands at the wrong position, and the removal set is wrong/empty.

The unit tests pass because they feed the WRONG order (leaf→root) that happens to make the code work.
Production feeds the CORRECT getBranch() order (root→leaf), which breaks the code.

### Fix
Either:
1. Remove the `.reverse()` in resolveCheckpoint (since getBranch() already returns root→leaf), OR
2. Fix the docstring + tests to use root→leaf order.
Either way, verify the walk goes ROOT→LEAF (matching message array order).

## FINDING: No Transient Entry in Pi (per Scout 1)

Scout 1 analyzed agent-session.js and found that messages are committed on `message_end` events
synchronously, and tool `execute()` runs AFTER the assistant message is committed. Therefore
`getLeafId()` during tool execution returns the **last committed entry** (the assistant message),
NOT a transient in-progress entry.

The PRD's claim of a "transient in-progress entry" may be:
- A mischaracterization of the actual behavior (the real issue is the ordering bug above), OR
- A version-specific behavior in Pi 0.84.1 that differs from the installed dist code.

Either way, the fix for setCheckpoint (label a stable entry found by walking getBranch backwards)
handles both scenarios robustly.

## FINDING: resolvePreview Already Resolves the Target at Creation Time

`src/tools/rewind.ts:resolvePreview` (line ~271) already:
1. Builds a snapshot via `ctx.sessionManager.buildContextEntries()`.
2. Resolves the removal set (message indices) using the SAME resolvers as filterPipeline.
3. Uses the indices only for the advisory K estimate and file ledger.

The `remove` indices ARE available at creation time but are NOT persisted. The fix simply captures
the corresponding entry IDs and persists them in the marker.

## FINDING: Test Gap — No "Rewind → More Work → Re-fire" Test

The ENTIRE test suite (671 unit tests + 14 smoke scenarios) never simulates:
1. Create a rewind marker.
2. Run filterPipeline → assert target hidden.
3. Append new messages (simulating resumed work).
4. Run filterPipeline again → assert target STILL hidden + new work visible.

This is the exact usage pattern that breaks. The determinism test (transforms.test.ts:1478) only tests
same-input twice, NOT grown-input.

## FINDING: Smoke Tests Assert Persistence, Not Hiding

F-rewind-core (smoke.ts:149): creates a last_turn rewind marker, asserts hasRewindMarker:true +
notePresent:true. Does NOT assert that any content is actually hidden.

F-checkpoint (smoke.ts:227): sets a checkpoint + rewinds to it. Does NOT assert that any content
is hidden. Would catch BUG-003 (K=0) if it asserted on the K value or the filtered view.

## FINDING: spec/06 §11 Idempotency Claim

Line 232: "across fires the session is unchanged between user prompts."
This is FALSE within a turn: tool calls append entries between context fires. This is the root of
BUG-001/BUG-002.