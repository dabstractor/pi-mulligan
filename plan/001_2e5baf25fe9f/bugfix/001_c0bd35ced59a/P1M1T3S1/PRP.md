# PRP — P1.M1.T3.S1: Snap iTarget to unit boundary in resolveCheckpoint (BUG-003 secondary)

**Work item:** P1.M1.T3.S1 · **Points:** 1 · **Bugfix:** BUG-003 secondary issue (orphaned toolCall on checkpoint rewind)
**Scope:** EDIT ONE function, `resolveCheckpoint` (`src/transforms.ts:450-526`), to **snap `iTarget` to the END of
its `partitionIntoUnits` unit** before the removal set is built, so a checkpoint on an assistant-with-tool-calls
keeps the assistant AND all its toolResults together (pairing-safe). Update the resolveCheckpoint **algorithm JSDoc**
(Mode A). Update the **3 existing tests** that assert the buggy un-snapped behavior, and **add 1 orphan-prevention
regression test**. **No signature change; no new files; no spec-doc change; do NOT touch `markers.ts` (T2, in
parallel) or `resolveCheckpoint`'s walk/label logic (T1, done).**

---

## Goal

**Feature Goal**: Make `resolveCheckpoint` **never produce a removal set that orphans a toolCall/toolResult pair**.
Today, when a checkpoint labels an assistant message that issued tool calls, step 4 sets `iTarget` to that
assistant's index and step 5 builds `remove = indices > iTarget` — which sweeps the assistant's own toolResults
(they sit at `iTarget+1, iTarget+2, …`) into the removal set, keeping the toolCall but removing its toolResult →
an **orphaned toolCall the model API rejects** (spec/06 §2 cardinal pairing rule, E1). The fix snaps `iTarget`
**forward to the maximum index of its `partitionIntoUnits` unit** before `remove` is built: the whole unit
(assistant + all results) is then KEPT, and removal begins strictly AFTER the unit. For a plain (single-message)
unit the snap is a no-op (`max === iTarget`), so checkpoints on user / text-only-assistant messages are unchanged.

**Deliverable** (all edits in place — no new files):
1. `src/transforms.ts` — insert a **unit-snap block** between resolveCheckpoint step 4 (`if (!found) return null;`)
   and step 5 (`const rewindOwnIndices …`); reuse the partitioned `units` in step 5's existing exclude loop. Update
   the resolveCheckpoint **algorithm JSDoc** (add step 4b; tweak step 5 intro). No other function touched.
2. `test/transforms.test.ts` — **UPDATE 3 tests** in the resolveCheckpoint describe block whose `remove` assertions
   encode the buggy behavior (lines 767, 778, 829); **ADD 1** explicit orphan-prevention regression test.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npm test` is **fully green** (671 + the new test), with the 3 updated tests now asserting the pairing-safe
  (unit-snapped) `remove` and the new regression test passing.
- `resolveCheckpoint` contains a unit-snap loop (`unit.indices.includes(iTarget)` → `iTarget = Math.max(...unit.indices)`).
- A checkpoint targeting an assistant-with-tool-calls **keeps the whole `[assistant, …results]` toolGroup** in the
  filtered view (the new regression test proves it: `asst(c1)` + `result(c1)` both survive).

---

## User Persona

**Target User**: (a) The implementing AI agent (this + downstream P1.M3 regression / P1.M4 doc subtasks), and
(b) the end agent that calls `mulligan_checkpoint` before speculative tool work, then `mulligan_rewind` back to it.

**Use Case**: The agent sets a checkpoint, does some tool work (reads, edits), then rewinds to the checkpoint to
redo. With T1 (walk) + T2 (labeling, in parallel) the checkpoint now maps to a real message index and hides later
work — BUT if that later work or the checkpointed message involves tool calls, the un-snapped `remove` set would
orphan a toolCall/toolResult and the model API would reject the filtered request. This fix guarantees every
checkpoint removal is **unit-aligned** (whole toolGroups stay or go together), so the filtered view is always
API-valid.

**Pain Points Addressed**: Without the snap, a checkpoint rewind is either silently broken (API rejection of the
filtered context) or hides the wrong indices — the very "soft over hard / never mutate the session tree" guarantee
(spec/03 principle #2) is undermined because the agent's turn breaks on an API error rather than recovering
cleanly.

---

## Why

- **Closes the BUG-003 secondary issue end-to-end.** T1 fixed the walk DIRECTION; T2 (parallel) fixes WHICH entry
  is labeled; **T3 (this) fixes the orphaning** once a correct `iTarget` is finally computed. The three are
  independent, ordered fixes; this is the unit-alignment step that makes a checkpointed assistant-with-tool-work
  usable. (system_context.md §BUG-003: "a checkpoint target on an assistant message with toolCalls would keep the
  assistant but remove its toolResult → orphaned toolCall → model API rejection.")
- **Reuses the EXISTING pairing primitive.** `partitionIntoUnits` (transforms.ts:109) is already THE pairing-safety
  mechanism for every other removal transform (resolveLastToolCallGroup/resolveLastTurn operate on units). The
  checkpoint resolver was the lone holdout that built `remove` from a raw index boundary — snapping it to a unit
  boundary brings it into line with the rest of the module for free. (partitionIntoUnits JSDoc: "the model API
  rejects a toolCall without its matching toolResult … hiding a toolGroup hides the assistant call AND all its
  results together, so the filtered view never orphans either side.")
- **No-op-safe for non-tool targets.** A checkpoint on a user message or a text-only assistant lands in a plain
  unit `{indices:[i]}`, so `Math.max(...[i]) === i` → iTarget is unchanged → behavior identical to today. This is
  why only 3 tests change (the ones whose checkpoint target is an assistant that HAS results) and the other ~10
  resolveCheckpoint tests + the filterPipeline checkpoint test are untouched (verified — see *Known Gotchas*).

---

## What

A single, surgical edit to `resolveCheckpoint` plus its JSDoc and tests:

1. **The snap** (insert between `if (!found) return null;` and step 5): `const units = partitionIntoUnits(messages);`
   then a loop that finds the unit whose `indices` include `iTarget` and sets `iTarget = Math.max(...unit.indices); break;`.
2. **Reuse `units`** in step 5's existing `for (const unit of partitionIntoUnits(messages))` exclude loop (replace
   the inline call with the hoisted `units` — identical result, no double partition).
3. **JSDoc** (Mode A): add a step **4b** to the algorithm comment describing the unit-snap; tweak step 5's intro to
   note iTarget is unit-snapped.
4. **Tests**: update the 3 assertions that encode the buggy `remove`; add 1 regression test that names the
   orphan-prevention behavior explicitly.

This subtask does **NOT** touch: `markers.ts` / `setCheckpoint` (T2, in parallel), the walk/label logic in
`resolveCheckpoint` steps 1-4 (T1, done), `partitionIntoUnits` / `applyRewind` / `applyShrink` / `filterPipeline`,
`filter.ts`, any tool, `spec/06` (P1.M4.T1), the smoke harness (P1.M3.T2), or any other resolver. No signature
change, no type change, no new files.

### Success Criteria

- [ ] `resolveCheckpoint` contains `unit.indices.includes(iTarget)` and `iTarget = Math.max(...unit.indices)`.
- [ ] Step 5's exclude loop reuses the hoisted `units` (no second `partitionIntoUnits(messages)` call).
- [ ] The 3 tests (lines 767, 778, 829) assert the **unit-snapped** `remove` (`[3]`, `[]`, `[3]` respectively).
- [ ] The new regression test asserts a checkpoint on `asst(c1)` keeps BOTH `asst(c1)` and `result(c1)` (orphan-safe).
- [ ] `npx tsc --noEmit -p tsconfig.json` → 0 errors.
- [ ] `npm test` → full suite green.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact old→new source block is given verbatim (the snap + the `units` reuse). The
> exact 3 test-assertion edits (with line numbers + old→new values, hand-derived against the fixed algorithm) are
> given verbatim. The new regression test is given verbatim. The bug mechanism is grounded in the live
> `resolveCheckpoint` step 4/5 (`iTarget = msgCursor + y - 1` then `remove = indices > iTarget`). The blast radius
> (which tests change vs. which are no-ops) is fully enumerated and verified by reading every checkpoint-touching
> test in the repo. `partitionIntoUnits` and `Unit` are reproduced so no other file needs reading.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: "resolveCheckpoint @450-526 is THE function to edit. Step 4 (@493) sets iTarget; step 5 (@503-525) builds
        remove = indices > iTarget (the bug). The snap inserts between @501 (`if (!found) return null;`) and @503.
        iTarget is `let` (@489) → reassignable."
  critical: "Step 5 ALREADY calls partitionIntoUnits(messages) @505 for excludeToolCallId. Hoist that to a single
        `const units = partitionIntoUnits(messages)` at the snap and reuse it in step 5 — identical, no double work."

- file: src/transforms.ts  # partitionIntoUnits + Unit (the pairing primitive to reuse)
  section: "Unit interface @71-74; partitionIntoUnits @109-168"
  why: "Unit = { indices: number[] (ascending); kind: 'plain'|'toolGroup' }. partitionIntoUnits groups
        [assistant, ...results] into ONE toolGroup (ascending indices). Its JSDoc (@120-127) is the authority for
        the pairing rule: 'the model API rejects a toolCall without its matching toolResult … hiding a toolGroup
        hides the assistant AND all its results together.' This is WHY snapping iTarget to the unit max is correct."
  pattern: "resolveLastToolCallGroup (@223) and resolveLastTurn (@319) ALREADY operate on units; the snap brings
        resolveCheckpoint into line with them."
  gotcha: "A toolGroup may be just the assistant (no results yet) → indices:[a]; max===a → no-op. An orphan result
        (no matching assistant) is its OWN plain unit → never joined. Both are handled correctly by the snap."

- file: test/transforms.test.ts
  why: "The resolveCheckpoint describe block @747-886. THREE tests assert the buggy remove (lines 767, 778, 829) —
        UPDATE them. The new regression test goes in this same block. Helpers: entry(id,type,extra) @738,
        labelEntry(id,targetId,name) @742, asst(...callIds) @9, result(toolCallId) @22, user(text) @33, asstText @17."
  critical: "Test 1 @752 ('(clean) basic mapping') IS the contract's worked example. Its assertion @767
        `toEqual([2,3])` becomes `toEqual([3])`. The comment @766 must be updated too."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/system_context.md
  section: "§BUG-003 'Secondary issue' (lines 39-40)"
  why: "Grounds the bug: 'Even if the label were fixed, a checkpoint target on an assistant message with toolCalls
        would keep the assistant but remove its toolResult → orphaned toolCall → model API rejection.'"

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T1S1/PRP.md
  why: "THE CONTRACT for the walk fix (DONE, applied at HEAD 5b44b48). Establishes: branchEntries are ROOT→LEAF,
        step 4 computes iTarget = the entry's LAST message index, step 5 = remove indices > iTarget. THIS PRP
        assumes that post-T1 shape and only inserts the snap. Do NOT re-touch the walk."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T2S1/PRP.md
  why: "THE parallel sibling (setCheckpoint labeling). It edits markers.ts ONLY; it explicitly leaves resolveCheckpoint
        to T3 (this). Confirm NO overlap: this PRP edits transforms.ts + transforms.test.ts; T2 edits markers.ts +
        checkpoint.test.ts + markers.test.ts. No shared edit sites."
  gotcha: "T2 is being implemented IN PARALLEL — do NOT touch markers.ts / setCheckpoint / its JSDoc. The resolveCheckpoint
        JSDoc you DO edit is in transforms.ts (a different file), so there is no collision."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T3S1/research/codebase_recon.md
  why: "Full blast-radius table: which 3 tests change and why; which ~11 tests are confirmed no-ops (snap no-op for
        user/text/asst-no-result checkpoints, or null-path unreachable); the worked example; the exact insertion point."

# AUTHORITATIVE pairing rule (spec/06 §2 + partitionIntoUnits JSDoc + api_verification §6.4):
#   "the model API rejects a request containing a toolCall without its matching toolResult, or vice versa.
#    Because every removal transform operates on UNITS (never raw indices), hiding a toolGroup hides the
#    assistant call AND all its results together, so the filtered view never orphans either side."
# The snap makes resolveCheckpoint honor this rule (it was the lone resolver that built remove from a raw index).
```

### Current Codebase tree (relevant slice — post-T1 HEAD 5b44b48)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts        # resolveCheckpoint @450-526 (EDIT: insert snap @~501 + reuse units in step5; JSDoc @417-435)
│                            #   partitionIntoUnits @109 (REUSE — unchanged), Unit @71 (unchanged)
│                            #   applyRewind @574 (unchanged — consumes remove unchanged), filterPipeline @972 (unchanged)
└── test/
    └── transforms.test.ts   # resolveCheckpoint block @747-886: UPDATE 3 asserts (@767,@778,@829); ADD 1 regression test
                             #   filterPipeline checkpoint test @1311 (UNAFFECTED — all plain msgs → snap no-op)
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → 0; `npm test` → all green.
```

### Desired Codebase tree

```bash
# No files added/removed. EDIT IN PLACE:
#   src/transforms.ts        — resolveCheckpoint snap block + JSDoc (THE fix)
#   test/transforms.test.ts  — 3 assertion updates + 1 new regression test
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #1 (THE bug): iTarget is an INDEX, but a toolCall+toolResult are TWO indices.
// A checkpoint labels a `message` ENTRY (T2 guarantees a real message). Each message entry yields exactly ONE
// message (resolveCheckpoint step 4: iTarget = msgCursor + yield - 1, yield=1 → the entry's single index). If that
// entry is an assistant that issued calls, its toolResults are SEPARATE entries at iTarget+1, iTarget+2… → swept
// into `remove`. The snap moves iTarget to the unit's MAX index so the whole toolGroup survives.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #2: the snap is a NO-OP for plain units (user / text-only assistant / orphan result).
// partitionIntoUnits puts those in {indices:[i]} → Math.max(...[i]) === i → iTarget unchanged. This is WHY only the
// 3 tests whose checkpoint target is an assistant WITH results change; the ~11 other resolveCheckpoint tests
// (user/text targets, or null-path returns) are byte-for-byte unaffected. Verify by reading each — see recon table.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #3: REUSE the partitioned units in step 5 (don't call partitionIntoUnits twice).
// Step 5 ALREADY calls partitionIntoUnits(messages) for the excludeToolCallId rewind-own-unit handling. Hoist it to
// `const units = partitionIntoUnits(messages);` at the snap and reuse `units` in step 5. partitionIntoUnits is PURE
// and `messages` is a const param (never mutated), so reusing the same array is identical to re-calling. This avoids
// a redundant O(n) partition and matches resolveLastTurn's single-partition style.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #4 (CRITICAL — the hidden test updates): 3 existing tests assert the BUGGY remove.
// transforms.test.ts @767 (`[2,3]`→`[3]`), @778 (`[2]`→`[]`), @829 (`[2,3]`→`[3]`). These tests were written to the
// un-snapped contract; after the fix they FAIL. They MUST be updated (hand-derived in the recon table). Missing any
// one → `npm test` red. The contract's "write a test" case IS test @752's scenario, so the net work is update-3 + add-1.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #5: a toolGroup may be a SINGLE index (assistant with calls but no results yet).
// partitionIntoUnits corner case (spec/06 §2): an assistant that issued ≥1 pairable call but has no results forms a
// toolGroup {indices:[a]}. The snap's max===a → no-op. resolveCheckpoint test @846 ("nothing after iTarget → []")
// hits exactly this (asst(c) with no result) and is therefore UNAFFECTED. Don't "fix" that test.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #6: the snap MUST run on the post-step-4 iTarget, BEFORE step 5 builds remove.
// If you place it after step 5, remove is already built from the un-snapped iTarget (the bug). Insert it strictly
// between `if (!found) return null;` and `const rewindOwnIndices = new Set<number>();`.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #7: NEVER throws / stay defensive — partitionIntoUnits already is.
// partitionIntoUnits is total (null/non-array → []; throwing-Proxy → []; see its own test block). The snap loop
// (`for (const unit of units) if (unit.indices.includes(iTarget)) …`) adds no throwing surface. No try/catch needed
// around the snap. (resolveCheckpoint's overall E13 never-throws contract is preserved.)
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA #8: do NOT touch markers.ts / setCheckpoint (T2, parallel) or the walk (T1, done).
// This PRP edits ONLY transforms.ts + transforms.test.ts. The resolveCheckpoint JSDoc you update lives in
// transforms.ts (no collision with T2's markers.ts JSDoc edits). setCheckpoint's labeling is T2's concern; the
// orphan-snap is this PRP's. They compose: T2 gives a correct iTarget, this PRP makes its removal pairing-safe.
// ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

> N/A — no type changes. `resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?)` signature
> is unchanged; its return type `{ remove: number[] } | null` is unchanged. The snap only reassigns the local `let
> iTarget`. `Unit` (`{ indices: number[]; kind: "plain" | "toolGroup" }`) and `partitionIntoUnits` are reused as-is.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0 (post-T1 HEAD is green)
  - RUN: npm test                                     # expect all green (the 3 tests-to-update currently PASS — they assert the bug)

Task 1: EDIT src/transforms.ts — insert the unit-snap + reuse units in step 5 (THE fix)
  - FIND (resolveCheckpoint, ≈ lines 501-513 — step 4 guard through step 5 exclude loop):
        if (!found) return null; // targetId labels a non-context-producing entry (filtered out) → refuse (never guess)

        // 5) remove = indices > iTarget, EXCEPT the rewind's own unit + mulligan:* notes (IDENTICAL to resolveLastTurn).
        const rewindOwnIndices = new Set<number>();
        const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
        if (hasExclude) {
          for (const unit of partitionIntoUnits(messages)) {
            if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
              for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
            }
          }
        }
  - REPLACE WITH (note: the snap is inserted, and step 5 reuses the hoisted `units`):
        if (!found) return null; // targetId labels a non-context-producing entry (filtered out) → refuse (never guess)

        // 4b) UNIT-SNAP (BUG-003 secondary fix / spec/06 §2 cardinal pairing rule): if iTarget lands INSIDE a
        //     toolGroup unit — e.g. the checkpointed entry is an assistant that issued tool calls — that assistant's
        //     sibling toolResult indices (iTarget+1, iTarget+2, …) would otherwise be swept into `remove` by step 5,
        //     KEEPING the toolCall but REMOVING its toolResult → an orphaned toolCall the model API rejects
        //     (spec/06 §2; api_verification §6.4; spec/08 E1). Snap iTarget FORWARD to the END (max index) of
        //     whatever unit contains it: the entire unit (assistant + all its results) is then KEPT, and `remove`
        //     begins strictly AFTER the unit. For a plain (single-message) unit this is a no-op (max === iTarget),
        //     so checkpoints on user / text-only-assistant messages are unaffected.
        const units = partitionIntoUnits(messages);
        for (const unit of units) {
          if (unit.indices.includes(iTarget)) {
            iTarget = Math.max(...unit.indices);
            break;
          }
        }

        // 5) remove = indices > iTarget, EXCEPT the rewind's own unit + mulligan:* notes (IDENTICAL to resolveLastTurn).
        //    Reuses `units` from step 4b (partitionIntoUnits is pure; messages is a const param, never mutated).
        const rewindOwnIndices = new Set<number>();
        const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
        if (hasExclude) {
          for (const unit of units) {
            if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
              for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
            }
          }
        }
  - WHY: GOTCHA #1/#6. iTarget is `let` (@489) → reassignable. `unit.indices` is a non-empty number[] (the
         containing unit has at least iTarget) → Math.max is safe. The exclude loop's `units` reuse is identical to
         the old inline `partitionIntoUnits(messages)` (GOTCHA #3). No new throwing surface (GOTCHA #7).

Task 2: EDIT src/transforms.ts — resolveCheckpoint algorithm JSDoc (Mode A, rides WITH the work)
  - FIND the JSDoc step list (≈ lines 421-435). The current step 4 + step 5:
        *   4. Walk ctxEntries with msgCursor (messages consumed). For each entry: yield = entryMessageYield(entry);
        *      yield < 0 (compaction/unknown → indeterminate) OR msgCursor+yield > messages.length (alignment lost) → null.
        *      If entry.id === targetId → iTarget = msgCursor + yield - 1 (the entry's LAST message index — kept); break.
        *      Else msgCursor += yield. Loop end without match → null (targetId labels a non-context-producing entry).
        *   5. remove (ascending): for j from iTarget+1..end, skip if rewindOwnIndices.has(j) (the rewind's own unit via
        *      partitionIntoUnits + assistantIssuedCall, only when excludeToolCallId is a non-empty string) or
        *      isMulliganCustomMessage(messages[j]) (the note/nudge). Else push. (IDENTICAL to resolveLastTurn's rule —
        *      spec/06 §6 step 5 "same tail-exclusion rules as resolveLastTurn".)
  - EDIT 2a — append a NEW step 4b bullet right after the step-4 bullet (after "...labels a non-context-producing entry."):
        *   4b. UNIT-SNAP (BUG-003 secondary / spec/06 §2 cardinal pairing): partitionIntoUnits(messages); if iTarget is
        *      inside a toolGroup unit, advance it to that unit's MAX index (so the assistant + ALL its toolResults are
        *      KEPT and `remove` starts strictly after the unit — never orphan a toolCall). Plain (single-message) unit
        *      → no-op (max === iTarget), so user / text-only-assistant checkpoints are unaffected.
  - EDIT 2b — tweak the step-5 opening to note iTarget is unit-snapped. CHANGE:
        *   5. remove (ascending): for j from iTarget+1..end, ...
        *   5. remove (ascending): for j from (unit-snapped) iTarget+1..end, ...
     (i.e. insert "(unit-snapped) " before "iTarget+1".)

Task 3: EDIT test/transforms.test.ts — UPDATE the 3 tests that assert the buggy remove
  - EDIT 3a — test "(clean) basic mapping" (≈ line 767). CHANGE:
        expect(res!.remove).toEqual([2, 3]); // e3(result) + e4(text asst); e2 (the checkpoint) KEPT at idx1
    TO:
        expect(res!.remove).toEqual([3]); // UNIT-SNAP (BUG-003): iTarget snapped 1→2 (unit [1,2]); result(c1) idx2 now KEPT → only asstText idx3 removed; pairing-safe
    (Also update the leading block comment at ≈ line 766 if it says "e3 result → removed" — change to note the unit-snap keeps the result.)
  - EDIT 3b — test "keeps the checkpoint point itself …" (≈ lines 771-778). CHANGE the comment + assertion:
        // checkpoint targets e_asst (idx1). iTarget=1. remove=[2].
        ...
        expect(res!.remove).toEqual([2]);
    TO:
        // checkpoint targets e_asst (idx1). UNIT-SNAP (BUG-003): iTarget 1→2 (unit [1,2]); remove=[]. Whole toolGroup kept.
        ...
        expect(res!.remove).toEqual([]); // iTarget snapped to 2 → nothing > 2; asst+result both KEPT (orphan-safe)
    (Keep the `not.toContain(1)` / `not.toContain(0)` lines — they still pass on [].)
  - EDIT 3c — test "compaction AFTER the checkpoint …" (≈ line 829). CHANGE:
        expect(res!.remove).toEqual([2, 3]); // result(idx2) + post-compaction asst(idx3) removed; checkpoint asst(idx1) kept
    TO:
        expect(res!.remove).toEqual([3]); // UNIT-SNAP (BUG-003): iTarget 1→2 (unit [1,2]); result(c1) idx2 now KEPT → only post-compaction asstText idx3 removed

Task 4: EDIT test/transforms.test.ts — ADD the orphan-prevention regression test
  - ADD this `it(...)` inside the resolveCheckpoint describe block (after the "keeps the checkpoint point itself"
    test, ≈ line 787, so the pairing-safety case sits with the basic-mapping cases):
        it("UNIT-SNAP (BUG-003 secondary): a checkpoint on an assistant WITH tool calls keeps the WHOLE toolGroup — no orphaned toolCall", () => {
          // messages: user0, asst(c1)1, result(c1)2, asstText3. checkpoint labels the asst entry (iTarget=1).
          // WITHOUT the snap: remove=[2,3] → asst(c1) KEPT, result(c1) REMOVED → orphaned toolCall c1 → model API rejects.
          // WITH the snap: toolGroup [1,2]; iTarget snapped 1→2; remove=[3] → asst(c1) AND result(c1) both KEPT.
          const msgs: MessageLike[] = [user("u1"), asst("c1"), result("c1"), asstText("junk")];
          const branch: BranchEntry[] = [
            entry("e1", "message"), entry("e2", "message"), labelEntry("eL", "e2", "ckpt"),
            entry("e3", "message"), entry("e4", "message"),
          ];
          const res = resolveCheckpoint(msgs, branch, "ckpt");
          expect(res).not.toBeNull();
          expect(res!.remove).toEqual([3]);          // only asstText idx3 removed
          expect(res!.remove).not.toContain(1);      // asst(c1) KEPT
          expect(res!.remove).not.toContain(2);      // result(c1) KEPT — pairing preserved (THE point of the fix)
        });

        it("UNIT-SNAP: a checkpoint on an assistant with MULTIPLE parallel results keeps the whole multi-result toolGroup", () => {
          // messages: user0, asst(p1,p2)1, result(p1)2, result(p2)3, asstText4. checkpoint labels asst (iTarget=1).
          // toolGroup [1,2,3]; iTarget snapped 1→3; remove=[4] → asst + BOTH results KEPT.
          const msgs: MessageLike[] = [user("u"), asst("p1", "p2"), result("p1"), result("p2"), asstText("tail")];
          const branch: BranchEntry[] = [
            entry("eu", "message"), entry("ea", "message"), labelEntry("eL", "ea", "m"),
            entry("er1", "message"), entry("er2", "message"), entry("et", "message"),
          ];
          const res = resolveCheckpoint(msgs, branch, "m");
          expect(res!.remove).toEqual([4]);          // only the trailing asstText removed
          expect(res!.remove).not.toContain(1);
          expect(res!.remove).not.toContain(2);
          expect(res!.remove).not.toContain(3);      // both results survive → no orphan
        });

Task 5: VALIDATE — run the gates in the Validation Loop. No further edits.
```

### Implementation Patterns & Key Details

```ts
// ── THE fix: snap iTarget to its unit's MAX index, then reuse units in step 5 ──
// (inserted between `if (!found) return null;` and step 5)
const units = partitionIntoUnits(messages);        // the EXISTING pairing primitive (spec/06 §2)
for (const unit of units) {
  if (unit.indices.includes(iTarget)) {            // the unit that owns the checkpoint point
    iTarget = Math.max(...unit.indices);           // snap to the unit's END → whole unit survives
    break;
  }
}
// step 5 now: `for (const unit of units)` (reuses the hoisted array; was `partitionIntoUnits(messages)`)

// WHY it's pairing-safe: partitionIntoUnits groups [assistant, ...results] into ONE toolGroup. Snapping iTarget to
// the toolGroup's max index means `remove = indices > max` starts STRICTLY AFTER the unit, so the assistant call AND
// every one of its toolResults are all KEPT. (spec/06 §2; api_verification §6.4 — "hiding a toolGroup hides the
// assistant call AND all its results together, so the filtered view never orphans either side.")

// WHY it's a no-op for plain targets: user / text-asst / orphan-result → {indices:[i]} → max===i → iTarget unchanged.

// ANTI-PATTERN (do NOT):
//   - build `remove` BEFORE the snap (GOTCHA #6)              → still orphans
//   - call partitionIntoUnits twice (GOTCHA #3)               → redundant; reuse `units`
//   - "fix" the unaffected tests (GOTCHA #2/#5)               → they're already correct (snap no-op / single-idx toolGroup)
//   - touch markers.ts / setCheckpoint (GOTCHA #8)            → T2 (parallel); this PRP is transforms.ts only
//   - change the resolveCheckpoint signature / return type    → unchanged
```

### Integration Points

```yaml
NO INTEGRATION / SIGNATURE CHANGES:
  - resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?) — UNCHANGED signature.
  - returns { remove: number[] } | null — UNCHANGED type (only the values change: remove is now unit-aligned).
  - partitionIntoUnits / applyRewind / applyShrink / filterPipeline / filter.ts:1013 caller — UNCHANGED.
  - applyRewind consumes `remove` unchanged (it just filters indices + closes the gap); pairing-safe remove → pairing-safe result.
DOWNSTREAM ENABLED / COMPOSES:
  - T2 (setCheckpoint, parallel) gives a correct iTarget; THIS PRP makes that iTarget's removal pairing-safe.
  - P1.M3.T1.S1 (checkpoint permanent-hiding regression tests) + P1.M3.T2.S1 (F-checkpoint smoke): can now assert
    hiding actually occurs AND the filtered view is API-valid (no orphan) — only meaningful once T1+T2+T3 are all in.
  - P1.M4.T1 (spec/06 doc sync): should note resolveCheckpoint now unit-snaps iTarget (this PRP's JSDoc is the source).
```

---

## Validation Loop

### Level 1: Type-safety (after Task 1)

```bash
# tsc is the project's only static gate. The snap reuses typed Unit[].indices (number[]) and reassigns `let iTarget`.
npx tsc --noEmit -p tsconfig.json
# Expected: zero errors. (If it errors on `Math.max(...unit.indices)`, you dropped the Unit import or the unit is
# mistyped — but Unit.indices is number[] and Math.max accepts it under strict. No new types are introduced.)
```

### Level 2: Unit tests (THE core proof — after Tasks 1-4)

```bash
# The resolveCheckpoint block in isolation (the 3 updated tests + the 2 new regression tests must be green):
npx vitest run test/transforms.test.ts -t resolveCheckpoint

# THE orphan-prevention regression guards (FAIL on the un-fixed code, PASS after the snap):
npx vitest run test/transforms.test.ts -t "UNIT-SNAP"
# Expected: 2 passed (the assistant-with-one-result + the assistant-with-parallel-results cases).

# Full suite — confirm NO regression in any other checkpoint path (filterPipeline, edge-cases, rewind tool, etc.):
npm test
# Expected: all green. If a test OTHER than the 3 named in Task 3 fails, you over-edited — re-check GOTCHA #2/#5
# (a no-op-target test should NOT change). The filterPipeline "checkpoint through pipeline" test @1311 must stay
# green unchanged (all its messages are plain → snap no-op).
```

### Level 3: Targeted correctness probe (after Task 5)

```bash
# Confirm the snap is present and step 5 reuses the hoisted units (no double partitionIntoUnits in resolveCheckpoint):
grep -nE 'unit\.indices\.includes\(iTarget\)|iTarget = Math\.max' src/transforms.ts   # expect the snap (2 matches in one block)
grep -cE 'for \(const unit of units\)' src/transforms.ts                              # expect 1 (step 5 reuse)
# Confirm resolveCheckpoint has exactly ONE partitionIntoUnits(messages) call now (the hoist), not two:
awk '/^export function resolveCheckpoint/,/^}/' src/transforms.ts | grep -c 'partitionIntoUnits(messages)'   # expect 1
```

### Level 4: Integration / runtime

> N/A for this unit-level fix. The F-checkpoint smoke scenario is enhanced in P1.M3.T2.S1 (it currently only asserts
> marker persistence, a known gap). The fix is proven by the Level-2 regression tests + the pairing-rule reasoning in
> *Why*. Do NOT run the smoke harness as an S1 gate.

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` → zero errors.
- [ ] `npx vitest run test/transforms.test.ts -t resolveCheckpoint` → green (3 updated + 2 new tests).
- [ ] `npm test` → full suite green (no regressions outside the 3 named assertions).

### Feature Validation (the fix)
- [ ] `resolveCheckpoint` snaps iTarget: `unit.indices.includes(iTarget)` → `iTarget = Math.max(...unit.indices)`.
- [ ] Step 5 reuses the hoisted `units` (exactly ONE `partitionIntoUnits(messages)` call in resolveCheckpoint).
- [ ] The 3 tests (767/778/829) assert the unit-snapped `remove` (`[3]` / `[]` / `[3]`).
- [ ] The new regression tests prove a checkpoint on an assistant-with-results keeps the WHOLE toolGroup (no orphan).
- [ ] A checkpoint on a user / text-only-assistant / no-result-assistant is UNCHANGED (the unaffected tests stay green).

### Code Quality Validation
- [ ] resolveCheckpoint JSDoc (Mode A) documents the step-4b unit-snap (Task 2).
- [ ] No edits outside transforms.ts + transforms.test.ts (markers.ts untouched — T2, parallel; walk untouched — T1).
- [ ] No signature/type change; `units` reuse avoids a redundant partition; no new throwing surface.

### Documentation & Deployment
- [ ] Mode-A JSDoc rides WITH the work (Task 2). No spec/06 edit here (that's P1.M4.T1); the JSDoc is the source for it.

---

## Anti-Patterns to Avoid

- ❌ Don't build `remove` before snapping iTarget (GOTCHA #6) — that's the bug, just relocated.
- ❌ Don't call `partitionIntoUnits(messages)` twice — hoist `units` once and reuse it in step 5 (GOTCHA #3).
- ❌ Don't "fix" the unaffected tests (GOTCHA #2/#5) — user/text/no-result-assistant checkpoints are already no-ops
  (`max === iTarget`); only the 3 assistant-WITH-results assertions change.
- ❌ Don't touch `markers.ts` / `setCheckpoint` (GOTCHA #8) — T2 owns it in parallel; this PRP is transforms.ts only.
- ❌ Don't change the resolveCheckpoint signature or return type — unchanged.
- ❌ Don't add a try/catch around the snap (GOTCHA #7) — partitionIntoUnits is already total; the snap adds no throws.
- ❌ Don't forget to update the 3 buggy-assertion tests (GOTCHA #4) — `npm test` goes red until you do.
- ❌ Don't modify `PRD.md`, `tasks.json`, `prd_snapshot.md`, `.gitignore`, or any `spec/` file (PRP rules; spec/06 is
  P1.M4.T1's). This subtask edits only `src/transforms.ts` + `test/transforms.test.ts`.

---

## Confidence Score: 9/10

The fix is ~6 lines (a snap loop + a hoist), grounded in the live `resolveCheckpoint` step 4/5 and the EXISTING
`partitionIntoUnits` pairing primitive (already the correctness foundation for the sibling resolvers). The exact
old→new source block is given verbatim. The non-obvious risk — the **3 existing tests that assert the buggy
behavior** — is fully enumerated with line numbers + hand-derived old→new `remove` values, so the implementer cannot
miss them. The −1 reserves for the human-derived test-value arithmetic (the recon table cross-checks each against
`partitionIntoUnits`, but a sign/index slip in the 3 updates would surface immediately as a clear vitest diff).