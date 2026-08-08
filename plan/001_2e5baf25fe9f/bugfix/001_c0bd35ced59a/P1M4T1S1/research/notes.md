# Research Notes — P1.M4.T1.S1: Update spec/06 idempotency + resolver descriptions

**Task type:** Mode B (documentation sync). **Bugfix 001**. P1.M4.T1.S1 = the FINAL doc-sync task of
the P1 rewind-permanence bugfix. Source code (M1 + M2) is LANDED + complete; this task makes the
spec docs match the shipped behavior. Test-only task P1.M3.T2.S1 runs in parallel (test/integration
only — NO overlap with spec/ or src/).

## 1. What the shipped code actually does (the truth the docs must match)

### The pinning mechanism (M2, fixes BUG-001 + BUG-002)
- `RewindMarker.hideEntryIds?: string[]` (src/markers.ts:74, src/transforms.ts:935, src/tools/rewind.ts:159) —
  OPTIONAL field. Holds stable ENTRY ids (Pi SessionEntryBase.id, a permanent UUID), NOT message indices.
- `captureHideEntryIds(entries, remove)` (src/tools/rewind.ts:282) — runs ONCE at rewind-creation time inside
  `resolvePreview`. Maps the resolved MESSAGE-INDEX removal set → the stable ENTRY ids of the entries that
  produced those messages. Mirrors how messages were built (entries.flatMap(sessionEntryToContextMessages)).
  Pins WHOLE units (assistant + all results) → pairing-safe by construction.
- `resolvePinnedHide(messages, branchEntries, hideEntryIds)` (src/transforms.ts:625) — pure resolver. Maps a
  SET of pinned entry ids → CURRENT message indices every fire, by IDENTITY (not position). Generalizes
  resolveCheckpoint's entry→message walk. Returns `number[]` (NEVER null); [] = nothing pinned / refuse.
- `filterPipeline` dispatch (src/transforms.ts:1146-1166): **PINNED FIRST**. `if (Array.isArray(hideEntryIds)
  && hideEntryIds.length > 0) remove = resolvePinnedHide(...)` → else granularity LEGACY branches
  (last_tool_call_group / last_turn / checkpoint). A refused pinned hide returns [] and does NOT fall back
  to relative resolution (control-flow-enforced — that would re-introduce the bug).

### The checkpoint fix (M1, fixes BUG-003)
- `setCheckpoint` (src/markers.ts:345): does NOT label `getLeafId()`. Walks `getBranch()` (ROOT→LEAF) BACKWARDS
  to the last `message` entry with a real `message.role` (a genuine, always-mappable conversation turn). Avoids
  the transient/non-context-producing leaf that made resolveCheckpoint map to the leaf → empty removal set.
- `resolveCheckpoint` (src/transforms.ts:454): takes `(messages, branchEntries, checkpointName,
  excludeToolCallId)`. branchEntries is getBranch() ROOT→LEAF (NO internal reverse). Walks ctxEntries in
  parallel with messages → iTarget. **UNIT-SNAP** (step 4b): if iTarget is inside a toolGroup unit, advance to
  that unit's MAX index (keep assistant + all results → never orphan a toolCall). Returns `{remove} | null`.

### Key correction: the idempotency model
- OLD (FALSE) spec/06 §11 line 232: "across fires the session is unchanged between user prompts."
- TRUTH: within a turn, tool calls APPEND entries between context fires, so relative specs ARE unstable. New
  markers pin stable entry ids at creation → permanent hiding across session growth. This is THE root cause
  of BUG-001 (leak-back) + BUG-002 (infinite loop).

## 2. Exact stale claims located in the specs (the complete set)

### spec/06-context-filter.md
- **§11 line 232** — the FALSE idempotency claim (PRIMARY target). Last clause: "across fires the session is
  unchanged between user prompts." MUST be replaced with the accurate within-turn-pinning statement.
- **§3 (lines 74-95)** `resolveLastToolCallGroup` — describes the RELATIVE resolver only. NO mention of pinning.
  Add a note: new markers capture hideEntryIds at creation; filterPipeline resolves via resolvePinnedHide; this
  relative resolver is the backward-compat fallback for old/capture-failed markers.
- **§4 (lines 97-118)** `resolveLastTurn` — same: relative resolver, no pinning mention. Same note.
- **§6 (lines 149-166)** Checkpoint — describes the entry→message mapping; NO pinning mention + stale signature
  `resolveCheckpoint(messages, ctx, checkpointName)` vs real `(messages, branchEntries, checkpointName,
  excludeToolCallId)`. Add pinning note + keep mapping description (resolveCheckpoint still used as the
  checkpoint-granularity producer + legacy fallback; resolvePinnedHide generalizes it).
- **§12 (lines 236-266)** pseudocode — `filterPipeline` loop dispatches on granularity ONLY; no hideEntryIds
  branch; `resolveCheckpoint(m, ctx, ...)` stale signature; `partitionIntoUnits` called ONCE before loop
  (the real code re-partitions fresh each iteration). MUST add the pinned-first dispatch branch.

### spec/04-data-model.md
- **§3 (lines 109-140)** `RewindMarker` interface — MISSING the `hideEntryIds` field entirely (has
  excludeToolCallId @125, seq @128). MUST add `hideEntryIds?: string[]` with a doc comment.

### NOT stale (do NOT touch — intentional behavior):
- spec/06 §5 (line 121): "Matchers resolve against the current `messages` each fire" — this is SHRINKS.
  Shrinks are content substitution, intentionally re-resolved each fire, and are NOT affected by BUG-001/002.
  Pinning applies ONLY to rewind hiding. Touching this would be a correctness regression.
- spec/06 §1 line 42: "a later rewind resolves against an already-reduced list" — still TRUE (within-fire
  composition; ordering oldest-first). Correct.
- spec/06 §6 line 163 "relative granularities are the default" — refers to which granularity the agent picks,
  not the resolution model. Leave the prose; just add the pinning note.

## 3. JSDoc sweep — as-verified state of the 6 modified functions

| Function | Location | JSDoc accurate? |
|---|---|---|
| `resolveCheckpoint` | src/transforms.ts:454 | YES — documents ROOT→LEAF branchEntries, unit-snap, BUG-003, returns {remove}\|null |
| `resolvePinnedHide` | src/transforms.ts:625 | YES — documents pinned ids, BUG-001/002, generalize resolveCheckpoint, returns number[] (never null) |
| `filterPipeline` | src/transforms.ts:1115 | YES — GRANULARITY DISPATCH block documents PINNED FIRST then legacy; idempotency caveat (GOTCHA #8) |
| `setCheckpoint` | src/markers.ts:345 | YES — documents BUG-003 anchor selection (walk getBranch backwards to last real message entry) |
| `captureHideEntryIds` | src/tools/rewind.ts:282 | YES — documents fix_design.md §Change 2, stable entry ids, whole-unit pinning |
| `resolvePreview` | src/tools/rewind.ts:315 | YES — returns {ledger, k, hideEntryIds}; documents the snapshot + dispatch + capture call |

**Conclusion:** All 6 functions ALREADY have accurate, detailed JSDoc (written as part of M1/M2 per their PRPs).
The (e) sweep is therefore a VERIFICATION task — correct ONLY if a discrepancy is found. As-verified, it is
expected to be a no-op (or at most a trivial touch-up). The PRP lists each function + what "accurate" must
contain so the implementer can confirm in ~minutes, then proceeds to the spec edits (the real deliverable).

## 4. Scope boundaries (no-collision verification)

- P1.M3.T2.S1 (parallel) modifies test/integration/smoke.ts + run-smoke.mjs ONLY. No spec/ or src/ overlap.
- M1 + M2 source is LANDED + complete → no source-behavior drift to worry about; docs must match shipped code.
- This task is the LAST in P1. No downstream milestone depends on these docs (they are descriptive, not consumed
  by code). Low risk.
- No test framework change needed (docs task). Validation = tsc (src/ JSDoc edits don't break compile) + vitest
  (must stay green) + a grep proving no stale claim remains + markdown sanity.

## 5. Validation approach (docs task — adapted)
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (only matters if src/ JSDoc touched; JSDoc edits can't change
  types but confirm no accidental code/comment corruption).
- `npx vitest run` → green (docs can't break tests; baseline 18 files / 706-711).
- `grep -ni "unchanged between user prompts" spec/06` → NO matches (proves the false claim is gone).
- `grep -ni "hideEntryIds" spec/04 spec/06` → matches present (proves the field + dispatch are documented).
- Spec code fences are illustrative TS (in ``` fences) — NOT compiled; just keep them accurate + internally
  consistent with the real filterPipeline.