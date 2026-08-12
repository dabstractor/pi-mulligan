# Audit Findings — P1.M6.T1.S1 (F-revert-* integration test gap closure)

## Method
Read all four `test/integration/revert-*.test.ts` files in full (revert-git 841L,
revert-cas 502L, revert-edge 662L, revert-explicit 513L) + the 8 F-revert-* scenario
definitions in `spec/10-testing.md` §2.1 (rows 101–108) + `spec/14-working-tree-revert.md`
§10. Cross-checked against the per-bug test subtasks (P1.M1.T1.S2, P1.M3.T1.S3,
P1.M4.T2.S2 — all Complete). Verified the CasBackend.restore code paths via grep + read
of `src/snapshot/cas.ts:1004-1098`.

## F-revert-* Coverage Map (all 8 spec/10 §2.1 scenarios)

| # | Scenario | Test file:line | Backend(s) | Real/Non-degenerate? | Covered by per-bug subtask? |
|---|----------|----------------|------------|----------------------|-----------------------------|
| 1 | F-revert-git | revert-git.test.ts:349 | git | ✓ write+edit+bash sed all reverted; .git byte-identical; shadow ref present→cleared; marker.revert.revertedFiles | no (pre-existing) |
| 2 | F-revert-cas | revert-cas.test.ts:321 | cas | ✓ write+edit+bash sed all restored (whole-tree); backend 'cas'; revertedFiles ⊇ {a,b,c}.ts | no (pre-existing) |
| 3 | F-revert-explicit | revert-explicit.test.ts:318 + :428 | cas (explicit-paths) | ✓ REAL hook chain (toolCallCaptureHandler); write+edit reverted (write), bash NOT reverted + warning (bash) | **P1.M3.T1.S3** ✓ |
| 4 | F-revert-failopen | revert-git.test.ts:494 | **git ONLY** | ✓ chmod-locked subdir → failedFiles; rest reverted; rewind succeeds (E27) | no (pre-existing) |
| 5 | F-revert-delete | revert-git.test.ts:595 (off) + :661 (on) | **git ONLY** | ✓ both double-gate branches (config off→refused, config on→performed) | no (pre-existing) |
| 6 | F-revert-dirtyguard | revert-cas.test.ts:432 + revert-git.test.ts:739 | cas + git | ✓ post-agent_end external edit refused (cas); python3 changedPaths refused (git, BUG-004) | **P1.M4.T2.S2** ✓ |
| 7 | F-revert-granularity | revert-edge.test.ts:395 | plain dir | ✓ revert_file_changes on last_tool_call_group SKIPS working tree; marker.revert undefined | no (pre-existing) |
| 8 | F-revert-reload | revert-edge.test.ts:455 | git | ✓ ckpt ref survives resetRuntime+detectAndCreate; REAL checkpoint file-revert (BUG-001 regression); production rebuildCheckpointSnapshots path (BUG-002) | **P1.M1.T1.S2** ✓ |

## Conclusion: the three PRD-flagged degenerate/missing cases are ALL fixed
- F-revert-reload degenerate empty-modifiedFiles case → FIXED by P1.M1.T1.S2 (now exercises
  a checkpoint span with a REAL `write` toolCall to a.ts; asserts a.ts A3-resume→A0).
- F-revert-explicit missing entirely → ADDED by P1.M3.T1.S3 (revert-explicit.test.ts, REAL hooks).
- F-revert-dirtyguard E30 bash/python gap → ADDED by P1.M4.T2.S2 (revert-git.test.ts:739, python3).

The remaining pre-existing scenarios (git, cas, granularity) are already real + non-degenerate.

## REMAINING GAPS (not covered by any per-bug subtask): cross-backend parity

Two CasBackend.restore code paths are exercised at integration level ONLY through
GitBackend.restore. The cas backend has DISTINCT, cas-specific implementations that are
untested end-to-end through the rewind tool:

### GAP 1 — F-revert-failopen cas variant (CasBackend.restore `failed[]` path)
- GitBackend.restore's failed[] path (git.ts:812, 846) is integration-tested (revert-git:494).
- CasBackend.restore's failed[] path (cas.ts:1044 escape, **cas.ts:1053** writeFile-EACCES in
  the reverted branch, cas.ts:1068 unlink-EACCES in the deleted branch) is NOT exercised
  end-to-end through the rewind tool in cas mode.
- Unit-level: test/cas.test.ts:1293 covers a per-path read failure via a MOCK fs (EACCES on a
  read), NOT a real filesystem lock + NOT through the rewind tool. It does not exercise the
  E27 best-effort "rewind still SUCCEEDS with the file in failedFiles" contract end-to-end in
  the cas backend.
- SPEC F-revert-failopen (spec/10 §2.1 row 103): "lock/chmod one target file → rewind still
  succeeds; the locked file in revert.failedFiles; the rest reverted." Currently satisfied only
  by the git path.

### GAP 2 — F-revert-delete cas variant (CasBackend.restore `deleted[]` path, cas-mode tree-walk)
- GitBackend.restore's deleted[] path (git.ts:842) is integration-tested (revert-git:595/661).
- CasBackend.restore has a CAS-MODE-ONLY tree-walk delete (cas.ts:1073-1094:
  `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles && nonGitMode==='cas'` → walkTree,
  unlink present-not-in-beforeRef). This DISTINCT path is NOT exercised end-to-end.
- The cas double-gate (cas.ts:1057-1058 + 1078-1079: `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles`)
  is verified in source but not integration-tested for the cas backend.
- SPEC F-revert-delete (spec/10 §2.1 row 104): both branches (allowDeleteCreatedFiles off→refused,
  on→performed). Currently satisfied only by the git path.

## OUT OF SCOPE (documented, NOT to be added — avoids scope creep)
- **F-revert-reload cas variant.** Reload is COVERED by per-bug subtask P1.M1.T1.S2 (git). The
  rebuild path (rebuildCheckpointSnapshots in capture.ts) is backend-agnostic (reads control
  entries → rt.snapshots.set), so the git test already exercises the production read-path. Cas
  manifest .json durability is a CasBackend.has()/unit concern, not a distinct integration gap.
  Adding a cas reload test would duplicate the rebuild coverage. → DO NOT ADD.

## Verified CasBackend.restore mechanics (for the new tests)
- failed[]: cas.ts:1044 (resolveSafeWorkspacePath escape), **1053** (writeFile EACCES, reverted
  branch — the path the failopen test targets), 1068 (unlink EACCES, deleted branch).
- deleted[]: cas.ts:1064 (manifest existed:false entry, explicit-paths path) + **1086/1090**
  (cas-mode tree-walk present-not-in-beforeRef — the path the cas delete test targets).
- skipped[]: cas.ts:1035 (BUG-005 caps-degradation surface — NOT targeted by this item).
- The cas reverted branch writes pre-existing manifest files back via fs.writeFile (cas.ts:1050).
  Locking the FILE read-only (0o444) → open(O_WRONLY) EACCES → failed[] (NOT a dir lock — cas
  writes in-place, unlike git checkout which unlinks+recreates).
- cas-mode turn_start capture walks the WHOLE tree (§4.1), so a file created in-span (after
  turn_start) is ABSENT from the beforeRef manifest → the tree-walk delete (c) finds + unlinks it.
- The rewind-tool→store delete plumbing is backend-agnostic: rewind.ts:818 PROCEED gate is
  `revert_file_changes || delete_created_files`; rewind.ts:880 passes
  `deleteCreatedFiles: params.delete_created_files === true` verbatim; the allowDeleteCreatedFiles
  half of the double-gate is INSIDE the backend (cas.ts:1057/1078), per the rewind.ts:867-869 comment.

## Helpers available in test/integration/revert-cas.test.ts (file-local, house idiom)
makeNonGitDir, makeStorage, sed, sedAvailable, VALID_NOTE, makePi, makeCtx, run, firstText,
rewindMarker, msgEntry, user, asst, asstWrite, asstEdit, asstBash, result. Imports: detectAndCreate
(store.js), CasBackend (cas.js), turnStartCaptureHandler/agentEndCaptureHandler (capture.js),
makeRewindTool (tools/rewind.js — wrapped by the file's `run`), setConfig/getConfig (config.js),
getRuntime/clearAll (runtime.js). NO sed needed for the 2 gap tests (mutations via writeFileSync).