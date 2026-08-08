# Codebase recon — unit-snap fix in resolveCheckpoint (P1.M1.T3.S1, BUG-003 secondary)

First-hand analysis of the live repo at `/home/dustin/projects/pi-mulligan` (branch `main`,
HEAD `5b44b48 Fix resolveCheckpoint branch traversal direction` = P1.M1.T1.S1 DONE).
This is a **correctness bugfix** to an existing, fully-built-out extension — `src/transforms.ts`
exists, `resolveCheckpoint` is implemented, and there are **671 passing unit tests**.

## The bug (BUG-003 Secondary Issue)

`resolveCheckpoint` (`src/transforms.ts:450-526`) computes the checkpoint removal set as
`remove = indices > iTarget`, where `iTarget` (step 4, line 493) is **the entry's LAST message
index** (the checkpoint point itself, which is KEPT). **The problem:** if the checkpointed entry
is an **assistant message that issued tool calls**, its sibling `toolResult` messages sit at
`iTarget+1, iTarget+2, …` — they are swept into `remove`, so the assistant toolCall is KEPT but
its toolResult is REMOVED → an **orphaned toolCall** that the model API rejects
(spec/06 §2 cardinal pairing rule, E1). A checkpoint set on any assistant-with-tool-work is
therefore unusable even after T1 (walk) + T2 (labeling) are fixed.

## The fix (work-item contract)

After step 4 computes `iTarget`, **snap it to the END (max index) of its `partitionIntoUnits`
unit** before step 5 builds `remove`:

```ts
const units = partitionIntoUnits(messages);
for (const unit of units) {
  if (unit.indices.includes(iTarget)) { iTarget = Math.max(...unit.indices); break; }
}
```

`partitionIntoUnits` (`src/transforms.ts:109-168`) groups `[assistant, ...results]` into ONE
`toolGroup` unit (`Unit.indices: number[]`, `Unit.kind: "plain" | "toolGroup"` — the EXISTING
pairing-safety primitive; its JSDoc cites api_verification.md §6.4: "the model API rejects a
toolCall without its matching toolResult, or vice versa"). Snapping iTarget to the unit's max
index keeps the WHOLE unit → `remove` begins strictly AFTER it → pairing-safe by construction.
For a **plain** (single-message) unit, `max === iTarget` → **no-op**, so checkpoints on user /
text-only-assistant messages are unaffected.

### Worked example (the contract's case — and an EXISTING test)
`messages = [user(0), asst(c1)(1), result(c1)(2), asstText(3)]`, checkpoint targets the assistant
at index 1.
- **Without snap** (current/buggy): `iTarget=1`, `remove=[2,3]` → `asst(c1)` kept, `result(c1)`
  removed → **orphan toolCall c1** (API rejection).
- **With snap**: `partitionIntoUnits` → `[plain[0], toolGroup[1,2], plain[3]]`; iTarget 1 is in
  `[1,2]` → `iTarget = max(1,2) = 2`; `remove = indices > 2 = [3]` → the WHOLE toolGroup
  `[asst, result]` kept; only `asstText(3)` removed → **pairing-safe.**

## Insertion point (verified exact)

The snap goes BETWEEN step 4's guard and step 5's remove loop:
- step 4 guard: `if (!found) return null;`  (≈ line 501)
- step 5 start: `const rewindOwnIndices = new Set<number>();`  (≈ line 503)

`iTarget` is already declared `let iTarget = -1;` (≈ line 489) → **reassignable**. ✓

**Reuse optimization:** step 5 ALREADY calls `partitionIntoUnits(messages)` (≈ line 505) for the
`excludeToolCallId` rewind-own-unit handling. Compute `const units = partitionIntoUnits(messages);`
ONCE at the snap, then reuse `units` in step 5's exclude loop (identical — `messages` is a const
param, never mutated; `partitionIntoUnits` is pure). This avoids a redundant partition and is the
higher-quality form. The contract's literal snippet (its own `const units`) is preserved in intent.

## CRITICAL blast-radius finding: 3 existing tests assert the BUGGY behavior

These tests in `test/transforms.test.ts` (resolveCheckpoint describe block, lines 747-886) were
written to the OLD (buggy) un-snapped contract and **WILL FAIL after the fix** — they MUST be
updated. Each was re-derived by hand against the fixed algorithm:

| line | test name (abbr.) | msgs (idx) | checkpoint target | old expected `remove` | NEW expected `remove` | why |
|------|-------------------|-----------|-------------------|-----------------------|-----------------------|-----|
| 767 | "(clean) basic mapping" | user0, asst(c1)1, result(c1)2, asstText3 | asst @ idx1 | `[2,3]` | **`[3]`** | iTarget 1→2 (unit [1,2]); result now KEPT |
| 778 | "keeps the checkpoint point itself" | user0, asst(c)1, result(c)2 | asst @ idx1 | `[2]` | **`[]`** | iTarget 1→2; nothing > 2 |
| 829 | "compaction AFTER the checkpoint" | user0, asst(c)1, result(c)2, asstText3 | asst @ idx1 | `[2,3]` | **`[3]`** | iTarget 1→2; result now KEPT |

The contract's "Write a test" case IS test #1's scenario verbatim — so the work is: **add the snap,
UPDATE these 3 tests' expected values, ADD a dedicated orphan-prevention regression test** (clearer
name + asserts pairing survival explicitly).

## Tests CONFIRMED unaffected (snap is a no-op or unreachable there)

| test | location | why unaffected |
|------|----------|----------------|
| tail-exclusion: rewind's own unit | transforms.test.ts:784 | checkpoint at **user** (idx0); user is plain unit → snap no-op |
| tail-exclusion: note/nudge | :798 | checkpoint at user (idx0); plain → no-op |
| nothing after iTarget → `[]` | :846 | checkpoint at asst(c) with **no result** → toolGroup of just `[1]` → snap no-op |
| excludeToolCallId absent → own unit removed | :866 | checkpoint at user (idx0); plain → no-op |
| compaction-between → null | :807 | returns null in step 4 (before snap) |
| not-found / non-context target → null | :832,837 | null in step 4 (before snap) |
| defensive non-array → null | :856 | null in step 1 |
| throwing-Proxy → no throw | :877 | null in step 2 (label scan); snap never reached |
| type union | :884 | checkpoint at user → plain → no-op; type-only assertion |
| **filterPipeline "checkpoint through pipeline"** | **transforms.test.ts:1311** | all msgs are `user`/`asstText` (NO toolCalls) → ALL plain units → snap no-op → `remove=[2,3]` unchanged ✓ |
| edge-cases label-absent no-op | edge-cases.test.ts:619 | resolveCheckpoint returns null → remove=[] |
| rewind tool: requires-name / not-found / exists-no-msgs | rewind.test.ts:300-328 | refusal or null path; snap never reached |

## JSDoc update (Mode A — rides WITH the work)

The resolveCheckpoint algorithm JSDoc (≈ lines 417-435) lists steps 1-6. **Add a step 4b**
describing the unit-snap (BUG-003 secondary / spec/06 §2 cardinal pairing), and tweak step 5's
intro to note iTarget is unit-snapped before `remove` is built. `setCheckpoint`'s JSDoc is T2's
(being implemented in parallel) — do NOT touch markers.ts.

## Validation gates (project-proven)

```bash
npx tsc --noEmit -p tsconfig.json     # exit 0 (strict; the snap reuses typed Unit[].indices)
npm test                               # full suite green (3 updated tests + 1 new test)
npx vitest run test/transforms.test.ts -t resolveCheckpoint   # the resolveCheckpoint block green
```

No external research needed — this is an internal correctness fix; the pairing invariant is fully
documented in-repo (`partitionIntoUnits` JSDoc → spec/06 §2 + api_verification.md §6.4 + spec/10 §1.1).