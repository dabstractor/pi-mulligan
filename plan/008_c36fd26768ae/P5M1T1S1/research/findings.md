# Research Findings — P5.M1.T1.S1 (F-revert-git + F-revert-failopen + F-revert-delete)

Integration test file to create: `test/integration/revert-git.test.ts` (vitest).
All `*.test.ts` are picked up by `npm test` (`vitest run`) — no separate vitest config; the
`test/integration/` path is already inside the default glob.

## 1. How the v1.2 revert pipeline actually runs (end-to-end, verified in source)

**Capture lifecycle** (`src/capture.ts`):
- `turnStartCaptureHandler(event, ctx)` — async. Gates on `getConfig().revert.enabled` then
  `getRuntime(sid).store` then `backend!=="none"`. Runs `gcTurnSnapshots(rt)` FIRST, then
  `rt.store.capture("turn")` and sets `rt.snapshots.set("turn", {label:"turn", backend, beforeRef, turnIndex, ts})`.
- `agentEndCaptureHandler(event, ctx)` — async. capture("turn-after") → MUTATES the existing
  `rt.snapshots.get("turn")` in place: `existing.afterRef = afterRef`.
- Both read `ctx.sessionManager.getSessionId()` FRESH (C12). Both NEVER throw (E27).

**Store creation** (`src/index.ts` session_start + `src/snapshot/store.ts`):
- `detectAndCreate(cwd, cfg, sessionDir?)` → `SnapshotStore`. For a real `git init` dir → `GitBackend`
  (backend "git"). `cfg` = `MulliganConfig["revert"]`. `cfg.storageDir` MUST NOT resolve inside cwd
  (config.ts rejects; resolveStorageDir re-checks → NoOpStore). Use a separate mkdtemp for storage.
- `index.ts` session_start: `rt.store = await detectAndCreate(ctx.cwd, getConfig().revert)`. We mirror
  this in the test (create store, assign to rt.store, THEN call the capture handlers).

**Rewind step 6b** (`src/tools/rewind.ts` rewindExecute, ~line 760-940):
- `wantRevert = revert_file_changes || delete_created_files`.
- Gates: `config.revert.enabled` → granularity!=="last_tool_call_group" → resolve checkpoint from
  `rt.snapshots.get(granularity==="checkpoint" ? "ckpt:"+name : "turn")`.
- `affectedPaths = ledger.modifiedFiles` (CRITICAL #3 — the ONLY deterministic file list at this point;
  a `bash sed` edit is NOT here, it's in ledger.bashSideEffects).
- `afterRef = checkpoint.afterRef ?? checkpoint.beforeRef`.
- `driftedPaths = await store.dirtyCheck(afterRef, affectedPaths)` — if ANY drift → REFUSE whole revert
  (revertClause + revertRefused=true), context rewind still proceeds.
- Else `store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles})` → RestoreResult
  (5 buckets). Folded into `marker.revert = {revertedFiles, deletedFiles, failedFiles, refusedFiles,
  skipped:boolean, backend}` + `revertSummary` in details.

## 2. CRITICAL GOTCHA — why the sed-edited file IS reverted (the F-revert-git crux)

`store.restore` for GitBackend (`src/snapshot/git.ts` ~line 644) is NOT driven by `ledger.modifiedFiles`.
It does `git read-tree <beforeRef>` (shadow index === beforeRef) then diffs **shadow-index vs working
tree** (M=modified, D=deleted, plus untracked/created detection) and `git checkout -- <path>` each.
So a file mutated by `bash sed -i` (which is in `bashSideEffects`, NOT `modifiedFiles`) IS reverted by
the index diff. The integration test validates exactly this: bash file changes ARE reverted even though
the ledger never named them. (`affectedPaths=ledger.modifiedFiles` only feeds the DIRTY GUARD, not the
restore file set.)

## 3. The five git-safety guarantees (assertable in F-revert-git)

`src/snapshot/git.ts` — ALL writes carry `shadowEnv()` = `{env:{...process.env,
GIT_DIR:<storageDir>/<sha256(repoRoot).slice(0,16)>, GIT_WORK_TREE:repoRoot}}`. The ONLY command against
the user's `.git` is read-only `rev-parse --absolute-git-dir`/`--show-toplevel`. ⇒ After capture + restore
the user's `.git` is byte-identical. Assert by recursive-content-hash of `.git` before vs after.

Protected refs live at `refs/mulligan/snapshots/turn/<label>` (`refForLabel`, git.ts ~line 130) in the
SHADOW repo. Assert via `git --git-dir=<shadowDir> for-each-ref refs/mulligan/snapshots/` (non-empty) and
`store.has(beforeRef)`===true. `store.retire(ref)` resolves SHA→refname via for-each-ref then
`update-ref -d` each ⇒ `store.has(ref)`===false after.

## 4. Factory seam (how to drive the real rewind tool) — from test/tools/rewind.test.ts

- `makeRewindTool(pi)` returns `{execute(toolCallId, params, signal, onUpdate, ctx)}`. `pi` captured by
  closure. Call: `await makeRewindTool(pi).execute("call-1", params, undefined, undefined, ctx)`.
- `makePi()` fake: captures `appendEntry(customType,data)` (THE marker persist site — assert
  `data.revert.revertedFiles` here), `sendMessage` (note), `setLabel`.
- `makeCtx({sessionId, contextEntries})` fake: `sessionManager.getSessionId()` → sid; `getEntries()` → []
  (depth 0); `buildContextEntries()` → contextEntries (the span messages → ledger). Do NOT attach
  `getContextUsage` (so the (4c) context-fraction guard is skipped: windowTokens 0).
- `setConfig({revert:{enabled:true, storageDir, allowDeleteCreatedFiles?:true}})` — PARTIAL deep-merge over
  DEFAULT_CONFIG. `setConfig(undefined)` resets. `clearAll()` resets the runtime map (call before/after).
- Ledger entry builders (verbatim from rewind.test.ts): `asstWrite(callId, file_path)`, `asstEdit`,
  `asstBash(callId, command)`, `user(text)`, `msgEntry(message)`. contextEntries must place the span
  AFTER the user message (last_turn removes everything after the last user message).

## 5. F-revert-failopen mechanism

GitBackend.restore is best-effort (E27): a per-path `git checkout -- <path>` failure (EACCES on a
`chmod 0o444` file) lands the path in `restoreResult.failed[]` (never throws). Rewind still succeeds;
marker.revert.failedFiles carries the path; OTHER files still reverted. Restore chmod in afterEach
(read-only dirs block rm). chmod 0o444 on the FILE (not dir) reliably blocks git's write on Linux.

## 6. F-revert-delete double-gate

GitBackend restore gates deletion on `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles` (the
per-call flag AND the config knob). So:
- config.allowDeleteCreatedFiles:false + delete_created_files:true → file NOT deleted (stays); marker
  .revert.deletedFiles empty.
- config.allowDeleteCreatedFiles:true + delete_created_files:true → file deleted; marker.revert
  .deletedFiles includes the path; file gone on disk.
"Created file" = exists in worktree but NOT in beforeRef's tree (untracked-vs-beforeRef detection in
restore). Each sub-case needs its own temp repo + store + capture cycle (independent it() blocks).

## 7. Conventions verified
- vitest, ESM, `.js` import paths from `test/integration/` → `../../src/*.js`.
- Real temp dirs via `mkdtempSync(join(tmpdir(), "..."))`; cleanup `rmSync({recursive,force})` in
  afterEach; chmod-restore before rm (read-only dirs block rm).
- Real `git` via `execFile` (promisified). Skip-guard on `git --version` (rare CI miss) — mirror
  store.test.ts test (d).
- Node >=22.19.0 built-ins only (fs, child_process, crypto, path, os). No new deps.