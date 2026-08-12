# Research Findings — P1.M1.T1.S2

**Item**: Strengthen F-revert-reload integration test to exercise real checkpoint file-revert (BUG-001 test)
**Depends on**: P1.M1.T1.S1 (the BUG-001 fix in `src/tools/rewind.ts` step 6b), running in parallel.

## 1. The file under test

`test/integration/revert-edge.test.ts` — ONE `describe` block "F-revert-* edge integration (spec/14 §6 + §2 / spec/08 E32)" with TWO `it` cases:

- **F-revert-granularity** (UNCHANGED by this task): `revert_file_changes` on `last_tool_call_group` → branch 3 (granularity-mismatch) fires before store; tree untouched; `marker.revert === undefined`.
- **F-revert-reload** (THIS task): drives a real git repo through real capture hooks + `makeCheckpointCommand` + `makeRewindTool`, simulates `/resume` (`resetRuntime` + `detectAndCreate`), re-issues a checkpoint-rewind. Currently the checkpoint-rewind at step (h) is DEGENERATE (span has no file toolCalls → `modifiedFiles=[]` → guard trivially clean).

## 2. The BUG-001 fix contract (from S1 PRP — verified against rewind.ts)

Step 6b (`src/tools/rewind.ts` ~lines 843-935), AFTER the S1 fix:

```ts
const affectedPaths = ledger.modifiedFiles;           // BUG-004 NOT yet fixed → still ledger heuristic
const doRestore = async () => {                       // restore+fold factored into a local closure
  const restoreResult = await store.restore(checkpoint.beforeRef, {
    revertFileChanges: params.revert_file_changes === true,
    deleteCreatedFiles: params.delete_created_files === true,
  });
  // ... fold RestoreResult into revertBlock + revertSummaryDetails + revertClause ...
  revertClause = `Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; `
              + `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, `
              + `${restoreResult.refused.length} refused (see log).`;
};
const afterRef = checkpoint.afterRef;                 // NO `?? checkpoint.beforeRef` fallback anymore
if (afterRef) {                                       // turn granularity (has afterRef)
  const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
  if (driftedPaths.length > 0) { revertRefused = true; revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`; }
  else { await doRestore(); }
} else {                                              // checkpoint granularity (NO afterRef)
  await doRestore();                                  // guard SKIPPED (spec/14 §6 step 3 conditional)
}
```

- Checkpoint snapshots (from `src/commands.ts` ~line 217-222 via `/mulligan_checkpoint`) set `{label, backend, beforeRef: ckptRef, turnIndex:-1, ts}` and NEVER set `afterRef` (single capture). Confirmed: `RevertCheckpoint.afterRef?: string` (`src/markers.ts` ~124-125).
- So for checkpoint granularity: `afterRef === undefined` → `doRestore()` runs directly → `store.restore(beforeRef)` reverts the working tree to the pre-checkpoint state.

## 3. Span resolution (why `modifiedFiles` will contain `a.ts`)

`resolvePreview` (`rewind.ts` ~595-621):
- For `granularity:"checkpoint"` → `resolveCheckpoint(messages, branchEntries, params.checkpoint, toolCallId)?.remove` → a `number[]` of MESSAGE INDICES from the checkpoint anchor to the branch leaf.
- `extractFileLedger(messages, remove)` scans those removed messages for `write`/`edit` toolCalls → populates `ledger.modifiedFiles` with the `file_path`/`arguments.path`.

The post-/resume checkpoint span = `[u3, a3, r2]` (from the `a1` anchor to leaf). If `a3` is a `write` to `a.ts`, `modifiedFiles === ["a.ts"]`. (GOTCHA #7/#8 in rewind.ts: `remove` = indices, `resolveCheckpoint` takes branchEntries DATA not ctx.)

## 4. Why the new test FAILS without the fix and PASSES with it

File state entering step (h): `a.ts === "A3-resume\n"` (post-/resume write). Checkpoint `x.beforeRef === R0` (the `A0\n` commit).

- **WITHOUT the fix** (buggy `afterRef = checkpoint.afterRef ?? checkpoint.beforeRef = R0`):
  `dirtyCheck(R0, ["a.ts"])` compares current tree (`A3-resume`) vs `R0` tree (`A0`) → DIFFER → `driftedPaths=["a.ts"]` → **REFUSE** → `a.ts` stays `"A3-resume\n"`. The assertion `a.ts === "A0\n"` **FAILS**. ✓ (the test now genuinely guards the fix)
- **WITH the fix**: `afterRef === undefined` → `else` branch → `doRestore()` → `store.restore(R0)` → `a.ts → "A0\n"`. Assertion **PASSES**. ✓

## 5. Exact change sites in `test/integration/revert-edge.test.ts`

| Lines | Current | Action |
|-------|---------|--------|
| ~17-19 (header) | "dirty-guard BYPASS ... span MUST contain NO file toolCalls (empty modifiedFiles → dirtyCheck→[] → PROCEED)" | REWRITE to describe the post-fix path: checkpoint has NO afterRef → guard SKIPPED → the span CAN (and now DOES) contain real file changes, which ARE reverted. |
| ~567 | "(from the a1 anchor to leaf) then contains NO file toolCalls → empty modifiedFiles → dirty guard bypassed" | REWRITE — now the span contains a real write. |
| ~600-601 | "REBUILD rt2.snapshots ... production NEVER does this read-side — it is the gap E32 leaves" | KEEP the rebuild (cross-reload path retained); UPDATE the comment to reference BUG-002 / P1.M2 as the future production `session_start` rebuild. |
| ~626 (step h heading) | "rewind checkpoint 'x' with revert → 'Reverted'; a.ts 'A2-postreload' → 'A0'" | Keep, the assertion still holds (now via a real write, not the degenerate case). |
| ~631-632 | push `u3` + `a3 = asst("post-resume")` (non-writing) | CHANGE: `a3 = asstWrite("w2","a.ts")` + push `result("w2")` + **mutate `a.ts` to "A3-resume\n"** BEFORE the rewind so the file differs from `R0`. |
| ~635-641 | assertions | ADD: `expect(...).toContain("Reverted")` (PROCEED clause), `expect(...).not.toContain("file revert refused")` (REFUSE clause absent). The existing `a.ts === "A0\n"` + `revertedFiles ∋ "a.ts"` assertions stay. |
| ~628-630 (step h comment) | "CRITICAL #3 ... now contains NO file toolCalls ... dirtyCheck(afterRef=beforeRef, []) → [] → PROCEED" | REWRITE to: span now contains a real write → `modifiedFiles=["a.ts"]`; WITHOUT BUG-001 fix the fallback `afterRef=beforeRef=R0` → `dirtyCheck` flags the agent's own work as drift → REFUSE; WITH the fix `afterRef` is undefined → guard skipped → `doRestore` reverts. |

## 6. Patterns / idioms to follow (verified present in the repo)

- `asstWrite(callId, file_path)` helper is ALREADY defined in this file (~line 230) — produces an assistant message with a `write` toolCall whose `arguments.file_path` is the path. Used in step (e)'s `a2` already. Reuse it.
- `result(toolCallId)` helper defined (~line 245) — produces the paired `toolResult`. Reuse it.
- `appended.push({ type:"message", id, parentId, timestamp:0, message } as never)` is the established push idiom (steps e + h).
- Cross-reload scaffolding (`resetRuntime` → `getRuntime` → `detectAndCreate` → `gcTurnSnapshots` → manual `rt2.snapshots` rebuild loop) is at ~lines 566-625 — RETAIN it (E32 coverage).
- Assertions on the PROCEED clause text + `marker.data.revert.{backend,revertedFiles}` already exist (step e ~548-556) — mirror them at step h.
- `firstText(res)` + `rewindMarker()` / last-marker scan helpers exist.

## 7. Scope boundaries (do NOT do)

- Do NOT change `src/tools/rewind.ts`, `src/commands.ts`, `src/markers.ts`, `src/snapshot/*`, or `src/index.ts` — S1 owns the rewind.ts fix; BUG-002/003/004/005/006/007 are separate milestones (P1.M2–P1.M5). Test-only change here.
- Do NOT remove the E32 cross-reload portion (the `resetRuntime`+`store2`+rebuild) — it is the test's headline coverage and its rebuild is the BUG-002 gap (P1.M2.T1 will add the production read-side; that task owns removing the manual simulation).
- Do NOT widen `affectedPaths` to `store.changedPaths()` (that is BUG-004, P1.M4). The ledger heuristic `modifiedFiles` stays the source — which is exactly why the new write to `a.ts` must be a real `write` toolCall (so the ledger picks it up).

## 8. Validation commands (verified against repo)

- `npm run typecheck` → `tsc --noEmit` (catches the `as never` cast / type issues).
- `npm test` → `vitest run` (runs the whole suite incl. this integration test; `git` on PATH required — the `it` already `gitAvailable()`-guards).
- Targeted: `npx vitest run test/integration/revert-edge.test.ts` (fast feedback on just this file).