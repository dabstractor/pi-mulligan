# Research Notes — P5.M1.T1.S1 (F-revert-git + F-revert-failopen + F-revert-delete)

Integration tests for the v1.2 working-tree-revert pipeline. NEW file `test/integration/revert-git.test.ts`.
These are VITEST factory-seam tests (NOT the smoke.ts `pi -e …` process harness). They exercise REAL git
repos + REAL `GitBackend` + the REAL `rewindExecute` step-6b pipeline through the same fake-pi/fake-ctx
seam the unit tests use (`test/tools/rewind.test.ts`). Three scenarios from spec/10 §2.1 + @14 §9.

---

## 1. The integration seam (the whole architecture in one paragraph)

The existing `test/integration/smoke.ts` + `run-smoke.mjs` harness spawns REAL `pi` processes
(`pi -e ./src/index.ts -e ./test/integration/smoke.ts …`) and drives scenarios via a `/mulligan_smoke`
command — that is for **Pi-integration** (filter events, session JSONL, model turns). The F-revert-*
scenarios are DIFFERENT: they are about **the file-revert backend behavior** (git shadow repo, dirty
guard, restore, delete gating) which can be tested at the **vitest factory-seam level** with REAL temp
git repos + REAL backends + the REAL `rewindExecute`. So `revert-git.test.ts` = the
`test/tools/rewind.test.ts` idiom (hand-rolled fakes) BUT pointed at REAL git repos + a REAL store
(instead of `makeFakeStore`). The item contract confirms: *"The existing test convention uses factory
seams: `makeRewindTool(fakePi).execute(params, fakeCtx)`"*.

### The fake seam (REUSE from test/tools/rewind.test.ts — copy the helpers, do NOT import the test file)
- `makePi()` → `{ appended: {customType,data}[], sent, labels, pi }` (appendEntry/sendMessage/setLabel fakes)
- `makeCtx({ sessionId, contextEntries })` → `{ ctx }`; ctx.sessionManager has getSessionId()→sid,
  getLeafId()→"leaf-1", getEntries(), getLabel(id), getBranch(), buildContextEntries()→contextEntries
- `run(pi, ctx, params, toolCallId="call-1")` = `makeRewindTool(pi).execute(toolCallId, params, undefined, undefined, ctx)`
- `firstText(res)` = res.content[0].text
- message builders: `msgEntry(msg)`, `asst(...callIds)`, `result(toolCallId)`, `asstWrite(callId, file_path)`
  (name:"write"→modifiedFiles), `asstBash(callId, command)` (name:"bash"→bashSideEffects), `user(text)`
- `VALID_NOTE`, `setConfig({revert:{…}})`, `getRuntime(sid)`, `clearAll()` in beforeEach/afterEach
- `.js` import paths (ESM Bundler convention — GOTCHA, mandatory)

### What the fakes do NOT provide (and we don't need)
makeCtx's sessionManager has NO mutator (no appendEntry on it — that's `pi`); the capture handlers only
READ `ctx.sessionManager.getSessionId()`. So the fakes are sufficient for the real handlers.

---

## 2. The REAL revert pipeline (rewindExecute step 6b — src/tools/rewind.ts ~793–920)

Branch order (LOAD-BEARING): **config.revert.enabled → granularity (last_turn/checkpoint only) →
resolve checkpoint from `rt.snapshots` → dirty guard → proceed (store.restore) → fold RestoreResult**.

```
(1) if !config.revert.enabled           → revertClause = "(file revert requested but disabled in config)"
(2) if granularity === last_tool_call_group → revertClause = "(File revert applies to last_turn/checkpoint …)"
(3) checkpoint = rt.snapshots.get("turn" | `ckpt:${name}`)   // MISSING → skip notice
(4) affectedPaths = ledger.modifiedFiles                       // CRITICAL #3: ONLY modifiedFiles
    driftedPaths = await store.dirtyCheck(checkpoint.afterRef ?? beforeRef, affectedPaths)
    if driftedPaths.length > 0 → revertRefused = true; revertClause = "(file revert refused: N …)"
(5) ELSE (clean guard):
      restoreResult = await store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles})
      marker.revert = { revertedFiles: restoreResult.reverted, deletedFiles, failedFiles,
                        refusedFiles, skipped: <bool>, backend: store.describe().backend }
      revertSummaryDetails = { reverted: N, deleted, failed, skipped, refused, backend }
      revertClause = "Reverted N file(s), deleted M; X skipped/failed, Y refused (see log)."
(6) E13 fail-open: a THROWN dirtyCheck/restore → degrade to a skip notice (rewind STILL succeeds).
```

`RewindDetails` surfaces (assertion targets on the result):
- `res.details.revertRefused` (boolean — true iff dirty guard refused)
- `res.details.revertSummary` (`{reverted,deleted,failed,skipped,refused,backend}` — present iff proceed)
The persisted marker (`pi.appendEntry("mulligan:rewind", data)` → captured in makePi's `appended[]`):
- `appended.find(a=>a.customType==="mulligan:rewind").data.revert` =
  `{ revertedFiles[], deletedFiles[], failedFiles[], refusedFiles[], skipped:boolean, backend }`

---

## 3. THE LOAD-BEARING INSIGHT — why bash `sed -i` changes ARE reverted

`SnapshotStore.restore(beforeRef, opts)` has **NO paths parameter** — `RestoreOpts` is just
`{revertFileChanges:boolean, deleteCreatedFiles:boolean}` (src/snapshot/store.ts). The `GitBackend`
computes the affected files **itself** by diffing `beforeRef` against the current working tree
(`git diff --name-only beforeRef` with `GIT_WORK_TREE=repoRoot`). So EVERY file that differs from the
pre-span snapshot is restored — INCLUDING a file mutated by `bash sed -i`, even though `sed` appears only
in `bashSideEffects` (not in `ledger.modifiedFiles`, which is what feeds dirtyCheck's `affectedPaths`).

⇒ This is exactly the F-revert-git contract: *"files match pre-span content (including sed-edited file)"*.
The sed file is reverted because git's tree-diff finds it, NOT because the ledger listed it.

(Ledger detail: `WRITE_TOOL_NAMES={write,edit}`→modifiedFiles; `BASH_TOOL_NAMES={bash}`→bashSideEffects.
`sed` IS in the precision mutator list, so a parseable `sed -i f` MAY also land `f` in modifiedFiles — but
the revert correctness does NOT depend on that; it depends on the git tree-diff. src/ledger.ts.)

---

## 4. GitBackend internals (src/snapshot/git.ts) — the five git-safety guarantees

Constructor: `new GitBackend(cwd, revertConfig, sessionDir?, deps?)`. **Omit `deps`** → uses REAL
`execFile` (real `git` binary). The 4th `deps:{exec,scan,unlink}` arg is the DI unit-test seam
(test/git.test.ts) — NOT for us.
- `repoRoot = git rev-parse --show-toplevel` (resolved abs path)
- `sourceGitDir = git rev-parse --absolute-git-dir` (READ-ONLY — the only source-.git access)
- `shadowDir = join(storageDir, sha256(repoRoot).slice(0,16))`  ← keyed by repoRoot
- `shadowEnv()` = `{ env: { ...process.env, GIT_DIR: shadowDir, GIT_WORK_TREE: repoRoot } }`
- **EVERY write command** (init/add/write-tree/commit-tree/update-ref/read-tree/checkout/diff/gc) runs
  with `GIT_DIR=shadowDir` → redirects the object DB + refs to the SHADOW repo. ONLY `rev-parse
  --show-toplevel` / `--absolute-git-dir` (ensureInit) run WITHOUT the shadow env, against source cwd,
  and they are READ-ONLY.
- **GUARANTEE**: the source `.git` is NEVER written (no reset/commit/merge/stash/reflog against source).
  ⇒ The F-revert-git "user's .git is byte-identical" assertion holds.
- `capture(label)` → add+write-tree+commit-tree → returns commit SHA; pins `refs/mulligan/snapshots/<label-ish>`.
- `dirtyCheck(afterRef, paths)` → `git diff --name-only afterRef -- <paths>` (shadow env); best-effort,
  NEVER rejects (errors → `[]` allow).
- `restore(beforeRef, opts)` → `git read-tree beforeRef` then per-path `git checkout -- <path>` for each
  diffed file; created-file delete when `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles`
  (two-flag gate, gated INSIDE the backend); per-path failures → `failed[]`; **NEVER rejects** (E27).
- `retire(ref)` → `for-each-ref --points-at <sha> refs/mulligan/snapshots/` → `update-ref -d <each>`;
  resolves SHA→refname (update-ref -d deletes a refname, not an object).
- `has(ref)` → `git rev-parse --verify <ref>` (shadow) → bool.
- `gc()` → drop all `refs/mulligan/snapshots/turn/*` (checkpoint/* exempt) + `git gc --auto --prune=now`.
- `destroy()` → `rm -rf shadowDir` (the per-repo subdir, NOT the shared storageDir).

`detectAndCreate(cwd, revertConfig, sessionDir?)` (src/snapshot/store.ts) → runs `git rev-parse --git-dir`
(read-only); exit 0 ⇒ `new GitBackend(...)`; else falls to CasBackend/NoOpStore. NEVER rejects.

---

## 5. The capture lifecycle (src/capture.ts — EXPORTED handlers)

`turnStartCaptureHandler(event, ctx)` and `agentEndCaptureHandler(event, ctx)` are EXPORTED. They read
`getConfig().revert.enabled` + `getRuntime(ctx.sessionManager.getSessionId())` + `rt.store`. This is the
FAITHFUL integration seam — drive the REAL handlers with the fake ctx (makeCtx provides getSessionId):

- `turnStartCaptureHandler({type:"turn_start", turnIndex:0, timestamp:0}, ctx)`:
  (1) `gcTurnSnapshots(rt)` → `rt.store.gc()` (no-op on a fresh store — no prior turn refs),
  (2) `beforeRef = await rt.store.capture("turn")` → `rt.snapshots.set("turn", {label:"turn", backend,
      beforeRef, turnIndex, ts})`.
- `agentEndCaptureHandler({type:"agent_end", messages:[]}, ctx)`:
  `afterRef = await rt.store.capture("turn-after")` → mutates `rt.snapshots.get("turn").afterRef = afterRef`.

⇒ For the integration test: setConfig({revert:{enabled:true}}); getRuntime(sid).store = realStore;
await turnStartCaptureHandler(event, ctx); <mutate files>; await agentEndCaptureHandler(event, ctx);
then `run(pi, ctx, {note, granularity:"last_turn", revert_file_changes:true, …}, toolCallId)`.

FALLBACK (if the real handlers misbehave with the fake ctx): directly capture + seed:
`const beforeRef = await store.capture("turn"); rt.snapshots.set("turn",{label:"turn",backend:store.describe().backend,beforeRef,turnIndex:0,ts:Date.now()});`
then after mutations `const afterRef = await store.capture("turn-after"); rt.snapshots.get("turn")!.afterRef = afterRef;`.
This mirrors the unit-test `seedTurnCheckpoint` helper but with a REAL store + REAL refs.

---

## 6. The three scenarios — exact flows + assertions

### Common harness helpers (build once, reuse)
- `makeTempGitRepo(initialFiles)` → `{ repoRoot, cleanup }`: mkdtempSync(os.tmpdir()…); execFile
  `git init -q`; write initial files; `git add -A`; `git -c user.email=t@t -c user.name=t commit -qm init`.
  Return cleanup (rm -rf) to call in afterEach/finally. Set `GIT_AUTHOR/COMMITTER` env to avoid flakiness.
- `hashDir(dir)` → recursive sha256 of all files under dir (sorted), for the .git byte-identical check.
- `forEachRef(shadowDir)` → `git --git-dir=<shadowDir> for-each-ref refs/mulligan/snapshots/` (stdout lines).
- `shadowDirFor(storageDir, repoRoot)` → `join(storageDir, createHash("sha256").update(fs.realpathSync(repoRoot)).digest("hex").slice(0,16))`.
  NOTE: repoRoot must be the RESOLVED abs path (`git rev-parse --show-toplevel`), so realpathSync the temp dir.

### F-revert-git (the main scenario — git backend, clean dirty guard, sed reverted, .git untouched)
1. `repo = makeTempGitRepo({"a.txt":"a\n","b.txt":"b\n","c.txt":"c\n"})`; storageDir = mkdtempSync.
2. setConfig({revert:{enabled:true, storageDir, allowDeleteCreatedFiles:false, …defaults}}).
3. store = await detectAndCreate(repoRoot, getConfig().revert, sessionDir); rt = getRuntime(sid); rt.store = store.
4. `dotGitHashBefore = hashDir(join(repoRoot,".git"))`  (snapshot source .git BEFORE any capture).
5. await turnStartCaptureHandler({turnIndex:0,timestamp:0}, ctx)  → captures "turn" (pre-span: a\n/b\n/c\n).
6. MUTATE: write a.txt→"A\n" (fs); edit b.txt→"B\n" (fs); bash `sed -i 's/c/CC/' c.txt` (execFile git? NO — real
   `sed -i` via execFile("sh",["-c","sed -i 's/c/CC/' c.txt"],{cwd:repoRoot})).  (These are real fs ops.)
7. await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx)  → captures "turn-after" (mutated state).
8. Build contextEntries for the rewound span so the ledger is non-empty (drives the mutation warning +
   dirtyCheck's affectedPaths): [msgEntry(asstWrite("w1","a.txt")), msgEntry(result("w1")),
   msgEntry(asst(<name:"edit" toolCall on b.txt>)), msgEntry(result("e1")),
   msgEntry(asstBash("b1","sed -i 's/c/CC/' c.txt")), msgEntry(result("b1")),
   msgEntry(asst("call-1")), msgEntry(result("call-1"))]. (toolCallId to rewind = "call-1".)
   (Re-wrap in a fresh makeCtx whose contextEntries = that span. setConfig + getRuntime + rt.store RE-SET
   on the new sid. The capture already happened on the SAME store + runtime, so re-bind rt.store.)
9. res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true}, "call-1").
10. ASSERTIONS:
    - files match pre-span: `fs.readFileSync(join(repoRoot,"a.txt"),"utf8")==="a\n"` (and b.txt==="b\n",
      c.txt==="c\n"). **incl. the sed file c.txt reverted to "c\n"** (the load-bearing insight §3).
    - `res.details.revertRefused === false`; success text contains "Reverted " + does not contain "refused".
    - marker: `appended.find(a=>a.customType==="mulligan:rewind").data.revert.backend==="git"` AND
      `.revertedFiles` contains a.txt, b.txt, c.txt (the git tree-diff found all three).
    - **.git byte-identical**: `hashDir(join(repoRoot,".git")) === dotGitHashBefore`.
    - **shadow repo holds a protected ref**: `forEachRef(shadowDir).length > 0` (non-empty after capture).
    - **retire() clears it**: `await store.retire(beforeRef)` (read beforeRef from rt.snapshots.get("turn")
      or re-derive); then `forEachRef(shadowDir).length === 0` (or `store.has(beforeRef)===false`).

### F-revert-failopen (locked file → failed[]; others reverted; rewind STILL succeeds)
1. repo = makeTempGitRepo({"a.txt":"a\n","b.txt":"b\n"}); setConfig + store + rt as above.
2. await turnStartCaptureHandler(...).
3. MUTATE a.txt→"A\n" and b.txt→"B\n" (both via fs write).
4. await agentEndCaptureHandler(...).
5. **LOCK a.txt** AFTER agent_end (external post-turn permission change, not a content change):
   `fs.chmodSync(join(repoRoot,"a.txt"), 0o444)` (read-only). (0o000 also works; 0o444 keeps it readable
   for dirtyCheck's `git diff` so the guard stays clean → proceeds → checkout write fails → failed[].
   ALWAYS chmod back to 0o644 in finally/cleanup so the temp dir can be rm -rf'd.)
6. Build contextEntries with asstWrite for a.txt + b.txt; rewind last_turn + revert_file_changes:true.
7. ASSERTIONS:
    - `res.details.revertRefused === false` (guard clean — chmod isn't a content drift) AND success text
      contains "Reverted " (rewind STILL succeeds — failopen).
    - `res.details.revertSummary.failed >= 1` AND a.txt ∈ failedFiles (the marker's
      data.revert.failedFiles). b.txt ∈ revertedFiles.
    - b.txt content restored to "b\n"; a.txt content is whatever it is (NOT guaranteed restored — it's in
      failed). The contract: "locked file in revert.failedFiles; other files reverted" → assert b.txt reverted.
    - cleanup: chmod 0o644 a.txt before rm -rf.

### F-revert-delete (two-flag delete gating: allowDeleteCreatedFiles config × delete_created_files param)
TWO sub-cases sharing one repo setup (or two fresh repos to avoid interference):
SETUP: repo = makeTempGitRepo({"keep.txt":"k\n"}); setConfig; store; rt; await turnStartCaptureHandler(...).
MUTATE: CREATE a new file `new.txt` (fs writeFileSync "NEW\n") — it did NOT exist at turn_start capture.
await agentEndCaptureHandler(...) (afterRef includes new.txt).

CASE A — deletion REFUSED (config gate OFF):
- setConfig({revert:{enabled:true, storageDir, **allowDeleteCreatedFiles:false**, …}}).
- rewind {delete_created_files:true, revert_file_changes:true, granularity:"last_turn"}.
- ASSERT: `fs.existsSync(join(repoRoot,"new.txt")) === true` (NOT deleted); marker.data.revert.deletedFiles
  is EMPTY; `res.details.revertSummary.deleted === 0`.

CASE B — deletion performed (config gate ON):
- setConfig({revert:{enabled:true, storageDir, **allowDeleteCreatedFiles:true**, …}}).
- rewind {delete_created_files:true, revert_file_changes:true, granularity:"last_turn"}.
- ASSERT: `fs.existsSync(join(repoRoot,"new.txt")) === false` (deleted); marker.data.revert.deletedFiles
  contains "new.txt"; `res.details.revertSummary.deleted === 1`.
- NEGATIVE (optional): under :true but delete_created_files param FALSE → NOT deleted (two-flag AND).

NOTE the two-flag gate is evaluated INSIDE GitBackend.restore (`opts.deleteCreatedFiles &&
this.cfg.allowDeleteCreatedFiles`); rewindExecute passes the per-call flag verbatim and does NOT read
config.allowDeleteCreatedFiles (no double-gate). So the config flip between CASE A/B is what toggles it.

---

## 7. Gotchas & verification commands

- **config is NOT re-read per call** — setConfig mutates the cached config; setConfig BEFORE turn_start
  + rewind. clearAll()+setConfig(undefined) in beforeEach/afterEach (nextSeq + config-cache hygiene — same
  as test/tools/rewind.test.ts).
- **rt.store must be re-set after clearAll()** — clearAll wipes the runtime map; each test re-creates
  getRuntime(sid) + rt.store = store.
- **makeCtx sessionId must equal the getRuntime sid** the capture handlers resolve. Use ONE `sid` const.
- **storageDir must be OUTSIDE repoRoot** (config.ts rejects a storageDir resolving inside cwd;
  resolveStorageDir re-validates). Use a separate mkdtempSync dir. (GitBackend's shadow repo lives there.)
- **realpathSync repoRoot** before computing the shadowKey — `git rev-parse --show-toplevel` returns the
  resolved path; mkdtempSync may return an un-resolved (e.g. /var vs /private/var on macOS) path.
- **git needs identity** for commit: pass `-c user.email -c user.name` OR set GIT_AUTHOR/COMMITTER env.
- **restore perms in cleanup** for the failopen chmod'd file (0o444 blocks rm -rf of the temp dir on some
  systems if the dir is owned but the file is read-only — chmod 0o644 first).
- **vitest concurrency**: these tests spawn real git + real fs; run sequentially (no `it.concurrent`) or
  give each test a unique sid + unique temp dirs (the helpers already do via mkdtempSync).
- **validate**: `npx tsc --noEmit` (the new file must type-check); `npx vitest run
  test/integration/revert-git.test.ts`; then full `npx vitest run`.

## 8. File references (the implementer's reading list)
- src/tools/rewind.ts — rewindExecute step 6b (lines ~793–920); the proceed/refuse/skip decision tree.
- src/snapshot/git.ts — GitBackend (constructor ~229; ensureInit ~277; capture ~322; dirtyCheck ~426;
  restore ~620; retire ~500; has ~470; gc ~600; destroy ~560). The shadowEnv + GIT_DIR guarantee.
- src/snapshot/store.ts — SnapshotStore interface, RestoreOpts, RestoreResult, detectAndCreate, NoOpStore.
- src/capture.ts — turnStartCaptureHandler / agentEndCaptureHandler (EXPORTED) + gcTurnSnapshots.
- src/markers.ts — RewindMarker.revert shape (lines ~83–105); RevertCheckpoint (lines ~121–135).
- src/config.ts — config.revert.* block (8 fields: enabled, allowDeleteCreatedFiles, nonGitMode,
  storageDir, maxFileBytes, maxTotalBytes, maxSnapshotsPerTurn, excludeGlobs).
- src/runtime.ts — SessionRuntime.store + SessionRuntime.snapshots (the threading targets).
- src/ledger.ts — extractFileLedger classification (WRITE_TOOL_NAMES={write,edit}; bash→bashSideEffects).
- test/tools/rewind.test.ts — the fake seam to copy (makePi/makeCtx/run/firstText/asst/asstWrite/asstBash/
  msgEntry/result/user/VALID_NOTE) + the S1/S2 step-6b decision-tree tests (line ~1885+) as the closest
  pattern (they use makeFakeStore; we swap in a REAL GitBackend + REAL git repo).
- test/git.test.ts — BASE_CFG canonical revert config; the shadow-dir formula; the git-safety invariants
  (uses MOCKED exec DI seam — we use REAL git).
- spec/10-testing.md §2.1 (F-revert-* table); spec/14-working-tree-revert.md §3 (GitBackend), §5 (capture
  lifecycle), §6 (restore semantics), §9 (E27–E32).