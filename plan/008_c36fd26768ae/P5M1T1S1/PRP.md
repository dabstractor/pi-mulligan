---
name: "P5.M1.T1.S1 — F-revert-git + F-revert-failopen + F-revert-delete integration tests"
description: >
  Create test/integration/revert-git.test.ts — a vitest integration test that drives the REAL v1.2
  working-tree-revert subsystem (GitBackend via detectAndCreate + the REAL capture hooks + the REAL
  makeRewindTool) end-to-end against REAL temp git repos. Three scenarios: F-revert-git (mutate via
  write+edit+bash sed, rewind last_turn with revert_file_changes, assert files restored incl. the sed
  file + user .git byte-identical + shadow ref present/cleared by retire + marker.revert.revertedFiles),
  F-revert-failopen (chmod a file read-only → still reverts the rest, locked file in failedFiles),
  F-revert-delete (allowDeleteCreatedFiles double-gate: deletion REFUSED when config off, deleted when on).
---

# PRP — F-revert-git + F-revert-failopen + F-revert-delete (P5.M1.T1.S1)

## Goal

**Feature Goal**: Add three passing vitest integration scenarios in a single new file
`test/integration/revert-git.test.ts` that validate the v1.2 working-tree-revert subsystem
**end-to-end** through its real public seams — `detectAndCreate` (real `GitBackend`), the real
`turnStartCaptureHandler`/`agentEndCaptureHandler` capture hooks, and the real `makeRewindTool` —
against REAL temporary git repositories (real `git init` + commit, real `git`/`sed`/`chmod`).

**Deliverable**: One new file `test/integration/revert-git.test.ts` containing exactly three `describe`
blocks (or three `it` blocks under one `describe`) — `F-revert-git`, `F-revert-failopen`,
`F-revert-delete` — plus the small set of shared fakes/helpers they need. No production-source changes.
No documentation changes (test-only item).

**Success Definition**:
- `npm test` (=`vitest run`) is green with the new file included.
- `npm run typecheck` (=`tsc --noEmit`) is green.
- F-revert-git asserts ALL of: (a) every mutated file — including the `bash sed -i` file — is restored to
  its pre-span content; (b) the user's `.git` directory is byte-identical before vs after the whole
  capture+mutate+rewind sequence (recursive content hash equal); (c) the shadow repo holds a protected ref
  under `refs/mulligan/snapshots/` and `store.has(beforeRef)` is true, then `false` after `store.retire`;
  (d) the persisted `mulligan:rewind` marker carries `data.revert.revertedFiles` including the reverted paths.
- F-revert-failopen asserts: rewind still SUCCEEDS (not a refusal); the chmod-locked file appears in
  `marker.revert.failedFiles`; the other files are still reverted to pre-span content.
- F-revert-delete asserts BOTH halves of the double-gate: with `config.revert.allowDeleteCreatedFiles:false`
  + `delete_created_files:true` the created file is NOT deleted and `marker.revert.deletedFiles` is empty;
  with `allowDeleteCreatedFiles:true` + `delete_created_files:true` the created file IS deleted and
  `marker.revert.deletedFiles` contains it.

## User Persona

**Target User**: The pi-mulligan maintainer + CI. These are non-human regression sentinels.

**Use Case**: Guard the five git-safety guarantees (spec/14 §3) + the fail-open (E27) + delete double-gate
contracts against regressions, by exercising the REAL stack rather than fakes.

## Why

- P1–P4 shipped the revert subsystem with THOROUGH unit coverage (git.test.ts mocks `exec`; rewind.test.ts
  uses a `makeFakeStore`). But no test today drives a REAL `git` binary + a REAL `GitBackend` + the REAL
  capture hooks + the REAL rewind tool together. This file closes that gap (PRD spec/10 §2 "F-revert-git").
- It pins the load-bearing, non-obvious property that `bash sed -i` edits ARE reverted even though the
  FileLedger only records them under `bashSideEffects` (not `modifiedFiles`) — because `GitBackend.restore`
  diffs the shadow index vs the working tree, not the ledger.
- It pins the user-`.git`-byte-identical safety guarantee with a real recursive hash.

## What

A vitest file `test/integration/revert-git.test.ts` with three scenarios (mirroring the spike table in
spec/10 §2.1 / the PRD §10 F-revert-* rows). Each scenario:
1. Creates a fresh temp directory, runs `git init` (+ an initial commit so `.git` is populated), writes
   the initial file set.
2. Creates a SEPARATE temp directory for snapshot storage (MUST NOT be inside the repo — `config.ts`
   rejects a `storageDir` resolving inside `cwd`).
3. Enables revert via `setConfig({ revert: { enabled: true, storageDir } })`, builds a REAL store via
   `detectAndCreate(repoDir, getConfig().revert)`, assigns it to `getRuntime(sid).store`.
4. Drives the REAL capture lifecycle (`turnStartCaptureHandler` then, after mutating files,
   `agentEndCaptureHandler`) so `rt.snapshots.get("turn")` gets a real `beforeRef` + `afterRef`.
5. Calls the REAL `makeRewindTool(pi).execute(toolCallId, params, undefined, undefined, ctx)` with the
   revert flags, then asserts on disk state + the captured marker.

### Success Criteria
- [ ] Three scenarios pass under `vitest run`.
- [ ] F-revert-git: sed-edited file restored; `.git` byte-identical; shadow ref present then cleared by `retire`; `marker.revert.revertedFiles` populated.
- [ ] F-revert-failopen: rewind succeeds; locked file in `failedFiles`; other files reverted.
- [ ] F-revert-delete: deletion REFUSED under config-off (file stays); deleted under config-on (`deletedFiles` populated).

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: every seam the test calls (`detectAndCreate`,
`turnStartCaptureHandler`, `agentEndCaptureHandler`, `makeRewindTool`, `getRuntime`, `setConfig`,
`clearAll`), every fake shape (`makePi`/`makeCtx`/`msgEntry`/`asstWrite`/`asstBash`), every assertion
target (`marker.data.revert.*`, `store.has`, `refs/mulligan/snapshots/`), and every gotcha (sed reverted
via index diff; `.git` byte-identical because all writes carry `GIT_DIR=shadow`; delete double-gate) is
specified below with exact file:line references and copy-ready patterns.

### Documentation & References

```yaml
# MUST READ — the contract this test validates (read the relevant rows before writing assertions)
- url: spec/10-testing.md §2.1 (scenario table F-revert-git / F-revert-failopen / F-revert-delete)
  why: the authoritative pass-criteria for each scenario
  critical: "bash file changes ARE reverted" (F-revert-git); failopen => failed[] (F-revert-failopen);
    deletion REFUSED when config gate off even with the flag set (F-revert-delete)
- url: spec/14-working-tree-revert.md §3 (GitBackend + the FIVE git-safety guarantees) + §6 (restore semantics)
  why: guarantee #3 "user .git byte-identical"; restore = read-tree beforeRef then checkout -- per M/D path
- url: spec/08-edge-cases.md E27 (revert fails best-effort) + E30 (dirty guard REFUSES) — failopen scenario basis
  why: per-path restore failure lands in failed[]; op never throws

# MUST READ — exact source seams the test drives (do NOT reimplement; call these)
- file: src/snapshot/store.ts
  why: detectAndCreate(cwd, cfg, sessionDir?) factory + SnapshotStore interface + RestoreResult 5 buckets
  pattern: "const store = await detectAndCreate(repoDir, cfg); store.describe().backend === 'git'"
  gotcha: cfg.storageDir MUST NOT resolve inside cwd (NoOpStore otherwise). Pass a separate mkdtemp.
- file: src/capture.ts
  why: turnStartCaptureHandler(event, ctx) + agentEndCaptureHandler(event, ctx) — the REAL capture hooks
  pattern: "await turnStartCaptureHandler({type:'turn_start',turnIndex:0,timestamp:Date.now()}, ctx)"
  gotcha: both self-gate on getConfig().revert.enabled AND rt.store (assign rt.store BEFORE calling).
    turn_start sets rt.snapshots.get('turn').beforeRef; agent_end mutates .afterRef in place.
- file: src/tools/rewind.ts
  why: makeRewindTool(pi).execute(toolCallId, params, signal, onUpdate, ctx) — step 6b revert decision tree
  pattern: "affectedPaths = ledger.modifiedFiles" feeds ONLY the dirty guard; store.restore diffs the index
  gotcha: step 6b resolves rt.snapshots.get('turn') (key 'turn' for last_turn); needs config.revert.enabled.
    buildContextEntries() must yield the span (write/edit/bash toolCalls) AFTER the user msg for the ledger.
- file: src/runtime.ts
  why: getRuntime(sid).store + .snapshots; clearAll() reset; freshRuntime inits snapshots Map
- file: src/markers.ts (RevertCheckpoint type ~line 121) + src/config.ts (setConfig partial deep-merge)

# MUST COPY — the factory-seam fakes/helpers (verbatim shapes from the existing unit suite)
- file: test/tools/rewind.test.ts
  why: makePi() (appendEntry/sendMessage/setLabel capture), makeCtx({sessionId,contextEntries}),
    msgEntry/asst/asstWrite/asstBash/user, the run() helper, firstText()
  pattern: "rt.store = makeFakeStore(...)" — REPLACE makeFakeStore with a REAL detectAndCreate store
  gotcha: appendEntry captures the persisted marker -> assert appended.find(e=>e.customType==='mulligan:rewind').data.revert
- file: test/store.test.ts (test (d) ~line 245) + test/git.test.ts
  why: how to create a REAL temp git repo in this suite (mkdtemp + execFile git init + git skip-guard)
  pattern: "git --version skip-guard; await execFile('git',['init'],{cwd}); afterEach chmod 0o755 + rm"
- file: test/capture.test.ts (makePi/makeCtx/makeStore ~lines 40-90)
  why: the minimal ctx shape the capture hooks read (sessionManager.getSessionId only)

# Reference — architecture notes (already distilled in research/findings.md)
- docfile: plan/008_c36fd26768ae/architecture/codebase_patterns.md §7 (Test Pattern: factory seams)
- docfile: plan/008_c36fd26768ae/architecture/external_deps.md §1 (git shadow-repo command set + 5 guarantees)
- docfile: plan/008_c36fd26768ae/P5M1T1S1/research/findings.md (the load-bearing sed/index-diff gotcha)
```

### Current Codebase tree (relevant slice)

```bash
src/
  capture.ts                 # turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots  [REAL, call these]
  config.ts                  # setConfig(partial) deep-merge; getConfig(); DEFAULT_CONFIG
  runtime.ts                 # getRuntime(sid).store / .snapshots; clearAll(); resetRuntime()
  markers.ts                 # RevertCheckpoint type (label/backend/beforeRef/afterRef?/turnIndex/ts)
  snapshot/
    store.ts                 # detectAndCreate(cwd,cfg,sessionDir?) -> SnapshotStore; RestoreResult(5 buckets)
    git.ts                   # GitBackend (shadow repo; restore via read-tree+checkout; retire via for-each-ref+update-ref -d)
  tools/rewind.ts            # makeRewindTool(pi); step 6b revert decision tree; RewindDetails.revertSummary
test/
  tools/rewind.test.ts       # TEMPLATE: makePi/makeCtx/msgEntry/asstWrite/asstBash/run/firstText + makeFakeStore/seedTurnCheckpoint
  store.test.ts              # TEMPLATE: real `git init` temp repo + skip-guard + afterEach chmod/rm
  capture.test.ts            # TEMPLATE: minimal ctx for the capture hooks
  integration/
    run-smoke.mjs            # (existing Pi-process smoke harness — NOT a vitest file; do not modify)
    smoke.ts                 # (existing Pi extension helper — NOT a vitest file; do not modify)
    scenarios.md             # (existing scenario docs — do not modify)
```

### Desired Codebase tree (files to ADD)

```bash
test/integration/
    revert-git.test.ts       # NEW — the three vitest scenarios + shared fakes/helpers (self-contained)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — sed-edited files ARE reverted even though the ledger never names them.
//   ledger.modifiedFiles (from write/edit toolCalls) feeds ONLY store.dirtyCheck (the dirty guard).
//   store.restore (GitBackend) does `git read-tree <beforeRef>` then diffs shadow-index vs worktree and
//   `git checkout -- <path>` each M/D path. So a `bash sed -i` file (recorded under bashSideEffects, NOT
//   modifiedFiles) is reverted by the index diff. THIS IS THE CENTRAL ASSERTION of F-revert-git.
//
// CRITICAL #2 — the user's `.git` is byte-identical because ALL git writes carry shadowEnv()
//   {GIT_DIR:<storageDir>/<sha256(repoRoot).slice(0,16)>, GIT_WORK_TREE:repoRoot}. The ONLY command against
//   the user's .git is read-only `git rev-parse`. Assert via recursive content hash of `<repoDir>/.git`.
//
// CRITICAL #3 — capture hooks self-gate on rt.store. Assign rt.store = store BEFORE calling
//   turnStartCaptureHandler, else it no-ops (rt.store undefined -> return). Mirror index.ts session_start.
//
// CRITICAL #4 — last_turn resolution removes every message AFTER the last user message. So contextEntries
//   must be [user, <write toolCall>, <result>, <edit toolCall>, <result>, <bash toolCall>, <result>, ...].
//   If the user message is last, K=0 and the ledger is empty -> revert path still runs (wantRevert true)
//   but the scenario is not faithful. Put the span AFTER the user msg.
//
// CRITICAL #5 — delete is DOUBLE-gated inside GitBackend.restore: opts.deleteCreatedFiles && cfg
//   .allowDeleteCreatedFiles. The rewind tool passes the per-call flag VERBATIM and does NOT read the
//   config knob (no tool-side gate). So set config.revert.allowDeleteCreatedFiles to test each half.
//
// CRITICAL #6 — config.storageDir resolving INSIDE cwd is rejected (config.ts + resolveStorageDir re-check
//   -> NoOpStore). Use a SEPARATE mkdtemp for storage, never nested under the repo dir.
//
// CRITICAL #7 — chmod 0o444 on the FILE (not the dir) blocks `git checkout -- <file>` (EACCES on write).
//   The GitBackend is best-effort (E27): the path lands in restoreResult.failed[] and restore NEVER throws.
//   Restore chmod 0o755 in afterEach or rm() fails on read-only files. Run as the test user (not root —
//   root ignores chmod; CI is non-root so this is fine).
//
// CRITICAL #8 — setConfig MERGES a partial over DEFAULT_CONFIG. setConfig(undefined) resets to default.
//   clearAll() wipes the module-scoped runtime map. Call both in beforeEach/afterEach (seq is shared).
//
// GOTCHA #9 — .js import paths from test/integration/: "../../src/snapshot/store.js" etc. (ESM + tsc output).
//
// GOTCHA #10 — do NOT attach ctx.getContextUsage (computeFilteredTotal -> windowTokens 0 -> the (4c)
//   context-fraction guard is skipped). The default makeCtx omits it; keep it omitted.
```

## Implementation Blueprint

### Data models and structure

No new data models. The test consumes existing exports:

```typescript
// Reuse these exact types (do NOT redefine):
import { detectAndCreate, type SnapshotStore, type RestoreResult } from "../../src/snapshot/store.js";
import { turnStartCaptureHandler, agentEndCaptureHandler } from "../../src/capture.js";
import { makeRewindTool, type RewindArgs, type RewindDetails } from "../../src/tools/rewind.js";
import { setConfig, DEFAULT_CONFIG } from "../../src/config.js";
import { getRuntime, clearAll } from "../../src/runtime.js";
import type { RevertCheckpoint } from "../../src/markers.js";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/integration/revert-git.test.ts — shared scaffolding (top of file)
  - IMPORTS: vitest {describe,it,expect,beforeEach,afterEach}; node:fs {mkdtempSync,rmSync,writeFileSync,
    readFileSync,chmodSync,existsSync,readdirSync,statSync}; node:os {tmpdir}; node:path {join};
    node:child_process {execFile as execFileCb} + util.promisify; node:crypto {createHash}.
    The src seams listed in "Data models" above (ALL via .js paths).
  - IMPLEMENT helper `git(cwd, args)` = `execFile("git", args, {cwd, maxBuffer: 1<<22})` (promisified).
  - IMPLEMENT helper `hashDir(dir)` = recursive SHA-256 over every regular file under dir (sort paths
    deterministically; concat `<relpath>\0<sha256(filebytes)>\n`; return createHash("sha256").digest()).
    USED to assert the user's .git is byte-identical. Follow the readdirSync/isDirectory walk pattern.
  - COPY the fakes from test/tools/rewind.test.ts VERBATIM (adjust nothing): makePi() (captures
    appendEntry/sendMessage/setLabel), makeCtx({sessionId,contextEntries}) (sessionManager.getSessionId/
    getEntries->[]/getLabel/getBranch->[]/buildContextEntries->contextEntries; NO getContextUsage),
    msgEntry(message), asst(...callIds), asstWrite(callId,file_path), asstBash(callId,command),
    user(text), result(callId) [takes a toolCallId -> {role:'toolResult',toolCallId,toolName:'tool',
    content:[{type:'text',text:'...'}],isError:false}], the run(pi,ctx,params,toolCallId) helper,
    firstText(res).
  - AUTHOR asstEdit(callId,file_path): NOT present in rewind.test.ts — write the trivial analog of
    asstWrite with the toolCall name "edit" (the ledger's write/edit -> modifiedFiles contract in
    src/ledger.ts treats both identically): {role:'assistant', content:[{type:'toolCall', id:callId,
    name:'edit', arguments:{file_path}]}}.
  - IMPLEMENT helper `makeRepo(prefix)` = mkdtempSync(tmpdir, prefix); git init -b main (fallback `git init`
    if -b unsupported); returns {repoDir}. IMPLEMENT `makeStorage()` = mkdtempSync(tmpdir,"mulligan-store-").
  - VALID_NOTE const (copy from rewind.test.ts: 3 non-empty fields).
  - beforeEach: clearAll(); setConfig(undefined). afterEach: clearAll(); setConfig(undefined); (per-test
    cleanup of temp dirs handled inside each it via a tracked dirs[] + chmod 0o755 + rmSync force, mirror
    store.test.ts).
  - git SKIP-GUARD: a top-level `const GIT = await gitOk()` once, or a helper `gitAvailable()` run at the
    start of each it -> `if (!await gitAvailable()) return;` (console.warn skip). Mirror store.test.ts (d).
  - NAMING: describe("F-revert-* integration (spec/10 §2.1 / spec/14)", () => { ... }).
  - PLACEMENT: test/integration/revert-git.test.ts.

Task 2: IMPLEMENT scenario "F-revert-git" (spec/10 §2.1 row F-revert-git)
  - SETUP: repoDir = makeRepo("rev-git-"); write a.ts="A1\n", b.ts="B1\n", c.ts="C1\n"; git add -A; git
    commit -m init (so .git is populated). Record preSpan = {a:read(a.ts), b:read(b.ts), c:read(c.ts)}.
    storageDir = makeStorage(). setConfig({revert:{enabled:true, storageDir}}).
  - STORE + RUNTIME: store = await detectAndCreate(repoDir, getConfig().revert);
    expect(store.describe().backend).toBe("git"). const sid="s1"; rt=getRuntime(sid); rt.store=store.
    const {pi}=makePi(); const ctx=makeCtx({sessionId:sid, contextEntries: SPAN}) — define SPAN after
    mutation but build the ctx object before driving (contextEntries is read at execute time, so order is
    fine; or build ctx right before run()).
  - .git HASH BEFORE: const dotGitBefore = hashDir(join(repoDir,".git")).
  - CAPTURE turn_start (REAL hook): await turnStartCaptureHandler({type:"turn_start",turnIndex:0,
    timestamp:Date.now()}, ctx). ASSERT rt.snapshots.get("turn")?.beforeRef is a non-empty string.
  - MUTATE (the span): writeFileSync(join(repoDir,"a.ts"),"A2-rewritten\n"); edit b.ts in place to
    "B2-rewritten\n" (use node fs rewrite OR an `edit`-equivalent; the LEDGER entry is what matters — build
    asstEdit for the contextEntries); run the REAL bash sed: await execFile("sed",["-i","s/C1/C2-edited/",
    join(repoDir,"c.ts")]). (If sed is missing, fall back to writeFileSync but prefer real sed — the
    scenario name is F-revert-git and the PRD says "bash sed".)
  - CAPTURE agent_end (REAL hook): await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx).
    ASSERT rt.snapshots.get("turn")?.afterRef is a non-empty string.
  - BUILD SPAN contextEntries (the ledger source): [
      msgEntry(user("rewrite the files")),
      msgEntry(asstWrite("w1","a.ts")), msgEntry(result("w1")),
      msgEntry(asstEdit("e1","b.ts")),  msgEntry(result("e1")),
      msgEntry(asstBash("s1","sed -i s/C1/C2-edited/ c.ts")), msgEntry(result("s1")),
      msgEntry(asst("final")), msgEntry(result("final")),
    ]. (Paths are workspace-relative POSIX — the ledger/git layer expects repo-relative. If asstWrite
    stores absolute paths, store relative here to match how extractFileLedger/resolveSafeWorkspacePath
    normalize. CHECK extractFileLedger in src/ledger.ts: it records the raw toolCall file_path verbatim.
    GitBackend restore resolves paths against repoRoot, so relative POSIX paths are correct.)
  - DRIVE the REAL rewind tool:
      const res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true}, "final");
  - ASSERT success (not a refusal): expect(firstText(res)).not.toContain("refused");
    expect(firstText(res)).toContain("Reverted");  // the S2 clause
  - ASSERT FILES RESTORED (incl. sed file): expect(readFileSync(a.ts,"utf8")).toBe(preSpan.a);
    expect(readFileSync(b.ts,"utf8")).toBe(preSpan.b); expect(readFileSync(c.ts,"utf8")).toBe(preSpan.c).
  - ASSERT .git BYTE-IDENTICAL: expect(hashDir(join(repoDir,".git"))).toEqual(dotGitBefore).
  - ASSERT shadow ref present + retire clears it:
      const beforeRef = getRuntime(sid).snapshots.get("turn")!.beforeRef;
      expect(await store.has(beforeRef)).toBe(true);
      // raw shadow check: list refs/mulligan/snapshots/* via for-each-ref against the shadow dir
      const shadowDir = join(storageDir, shadowKey(repoDir));  // shadowKey = sha256(repoDir).slice(0,16)
      const refs = (await execFile("git",["for-each-ref","--format=%(refname)","refs/mulligan/snapshots/"],
        {env:{...process.env,GIT_DIR:shadowDir}})).stdout.trim();
      expect(refs.split("\n").filter(Boolean).length).toBeGreaterThan(0);
      await store.retire(beforeRef); expect(await store.has(beforeRef)).toBe(false);
  - ASSERT marker carries revertedFiles:
      const rw = pi.appended.find(e=>e.customType==="mulligan:rewind");
      expect(rw).toBeTruthy(); expect(rw.data.revert?.revertedFiles).toEqual(expect.arrayContaining(
        ["a.ts","b.ts","c.ts"]));  // git restore reverted all three via the index diff
  - CLEANUP: tracked dirs[] -> afterEach. (If using inline cleanup, chmod + rm both repoDir + storageDir.)

Task 3: IMPLEMENT scenario "F-revert-failopen" (spec/10 §2.1 row F-revert-failopen / E27)
  - SETUP: repoDir = makeRepo("rev-failopen-"); a.ts="A1\n", b.ts="B1\n"; git add -A; git commit -m init.
    preSpan recorded. storageDir = makeStorage(). setConfig({revert:{enabled:true, storageDir}}).
    store=detectAndCreate -> "git"; rt.store=store; sid; {pi}=makePi().
  - CAPTURE turn_start; MUTATE both files (writeFileSync a.ts="A2\n"; writeFileSync b.ts="B2\n"); then
    LOCK b.ts: chmodSync(join(repoDir,"b.ts"), 0o444). CAPTURE agent_end.
  - SPAN contextEntries: [user, asstWrite("w1","a.ts"), result, asstWrite("w2","b.ts"), result,
    asst("final"), result]. (Two writes so the ledger.modifiedFiles = [a.ts, b.ts].)
  - DRIVE: res = run(pi,ctx,{note,granularity:"last_turn",revert_file_changes:true},"final").
  - ASSERT rewind SUCCEEDS: expect(firstText(res)).not.toContain("refused"); expect(firstText(res)).toContain("Reverted");
  - ASSERT a.ts REVERTED (the unlocked one): expect(readFileSync(a.ts,"utf8")).toBe(preSpan.a).
  - ASSERT b.ts in failedFiles (the locked one was NOT reverted; its content is still "B2\n" OR the chmod
    blocked the checkout — either way it is NOT restored to preSpan.b): expect(readFileSync(b.ts,"utf8"))
    .not.toBe(preSpan.b); // still mutated
      const rw = pi.appended.find(e=>e.customType==="mulligan:rewind");
      expect(rw.data.revert?.failedFiles).toEqual(expect.arrayContaining(["b.ts"]));
      expect(rw.data.revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
  - CLEANUP: chmodSync(b.ts,0o755) BEFORE rm (read-only file blocks rm). Track in dirs[].
  - NOTE: if running as root, chmod is ignored -> the file WOULD revert and failedFiles would be empty.
    Guard: `if (process.getuid && process.getuid()===0) { console.warn("skip failopen under root"); return; }`.

Task 4: IMPLEMENT scenario "F-revert-delete" (spec/10 §2.1 row F-revert-delete — double-gate)
  - SUB-CASE A (deletion REFUSED — config off):
      repoDir = makeRepo("rev-delete-off-"); initial: existing.txt="E1\n"; git add -A; git commit.
      storageDir=makeStorage(). setConfig({revert:{enabled:true, allowDeleteCreatedFiles:false, storageDir}}).
      store->"git"; rt.store=store; {pi}=makePi(); ctx.
      CAPTURE turn_start (beforeRef — new.ts does NOT exist yet).
      CREATE the file in-span: writeFileSync(join(repoDir,"new.ts"),"CREATED\n").
      CAPTURE agent_end (afterRef — new.ts exists).
      SPAN contextEntries: [user, asstWrite("w1","new.ts"), result, asst("final"), result].
      DRIVE: res = run(pi,ctx,{note,granularity:"last_turn", delete_created_files:true},"final").
      ASSERT NOT deleted (file still on disk): expect(existsSync(join(repoDir,"new.ts"))).toBe(true).
      ASSERT marker: const rw=find rewind; expect(rw.data.revert?.deletedFiles).toEqual([]).
  - SUB-CASE B (deletion PERFORMED — config on): SEPARATE repo/store/setup (do not reuse sub-case A's
      captured refs — a second turn_start would GC them).
      repoDir2 = makeRepo("rev-delete-on-"); same initial commit. storageDir2=makeStorage().
      setConfig({revert:{enabled:true, allowDeleteCreatedFiles:true, storageDir:storageDir2}}).
      store2=detectAndCreate; rt2 (clearAll first or new sid "s2"); rt2.store=store2; {pi2}=makePi(); ctx2.
      CAPTURE turn_start; CREATE new.ts; CAPTURE agent_end.
      SPAN contextEntries (same shape). DRIVE: res = run(pi2,ctx2,{note,granularity:"last_turn",
        delete_created_files:true},"final").
      ASSERT DELETED: expect(existsSync(join(repoDir2,"new.ts"))).toBe(false).
      ASSERT marker: const rw=find rewind; expect(rw.data.revert?.deletedFiles).toEqual(
        expect.arrayContaining(["new.ts"])).
  - STRUCTURE: two it() blocks ("REFUSED when allowDeleteCreatedFiles is false", "deleted when true") OR
    one it() with both sub-cases — either is acceptable; two its is cleaner (independent temp state).
  - NOTE on delete + revert_file_changes: the dirty guard runs on ledger.modifiedFiles (=[new.ts]); since
    nothing drifted externally after agent_end, dirtyCheck([]-effective) passes and restore proceeds. The
    created-file detection in GitBackend.restore (untracked-vs-beforeRef) handles deletion. If the
    scenario also sets revert_file_changes:true it is fine; the PRD row only requires delete_created_files.
```

### Implementation Patterns & Key Details

```typescript
// The end-to-end driving pattern (one turn cycle). This is the heart of every scenario.
async function driveRevertCycle({
  repoDir, storageDir, sid, revertCfg, mutate, spanEntries, rewindParams,
}) {
  setConfig({ revert: { enabled: true, ...revertCfg } });           // CRITICAL #8: partial merge
  const store = await detectAndCreate(repoDir, getConfig().revert); // REAL GitBackend
  expect(store.describe().backend).toBe("git");
  const rt = getRuntime(sid); rt.store = store;                     // CRITICAL #3: before the hooks
  const { pi } = makePi();
  const ctx = makeCtx({ sessionId: sid, contextEntries: spanEntries });
  const dotGitBefore = hashDir(join(repoDir, ".git"));              // CRITICAL #2: snapshot user .git

  await turnStartCaptureHandler(                                    // REAL hook -> rt.snapshots.get("turn").beforeRef
    { type: "turn_start", turnIndex: 0, timestamp: Date.now() }, ctx);
  expect(rt.snapshots.get("turn")?.beforeRef).toBeTruthy();

  await mutate(repoDir);                                            // write/edit/sed/lock/create per scenario

  await agentEndCaptureHandler(                                     // REAL hook -> mutates .afterRef in place
    { type: "agent_end", messages: [] }, ctx);
  expect(rt.snapshots.get("turn")?.afterRef).toBeTruthy();

  const res = await run(pi, ctx, rewindParams, "final");           // REAL makeRewindTool.execute
  return { res, pi, rt, store, dotGitBefore };
}

// hashDir — deterministic recursive content hash (the .git byte-identical assertion)
function hashDir(dir: string): string {
  const out: string[] = [];
  const walk = (d: string, rel = "") => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name), r = rel ? `${rel}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, r);
      else out.push(`${r}\0${createHash("sha256").update(readFileSync(abs)).digest("hex")}\n`);
    }
  };
  walk(dir);
  return createHash("sha256").update(out.join("")).digest("hex");
}

// shadowKey — mirror GitBackend's repo-root key (src/snapshot/git.ts shadowKey)
function shadowKey(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
}
// NOTE: GitBackend resolves repoRoot via `git rev-parse --show-toplevel` (may canonicalize symlinks).
// If hashDir(.git) is fine but for-each-ref can't find the shadow dir, print store's shadowDir by
// re-deriving with the TOPLEVEL path (run `git -C repoDir rev-parse --show-toplevel`).
```

### Integration Points

```yaml
NO production-source changes. This is a test-only item.
- file added: test/integration/revert-git.test.ts
- picked up by: "npm test" (vitest run) — test/integration/*.test.ts is inside the default glob
- typecheck: "npm run typecheck" (tsc --noEmit) — tsconfig includes ["src","test"]
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the file — fix before proceeding.
npm run typecheck          # tsc --noEmit (zero errors). The .js import paths + fake casts must type-check.
# (No separate linter configured — typecheck + vitest are the gates.)
```

### Level 2: Unit/Integration Tests (the deliverable itself)

```bash
# Run JUST the new file (fast feedback while iterating).
npx vitest run test/integration/revert-git.test.ts

# Expected: 3 scenarios pass (F-revert-git, F-revert-failopen, F-revert-delete [+ its 2 sub-cases]).
# If a scenario fails, READ the assertion that failed + the res.details / pi.appended marker to localize.
```

### Level 3: Full Suite (no regressions)

```bash
# The whole suite must stay green (the new file must not break sibling tests — e.g. no shared-state leak).
npm test                   # vitest run (all test/**/*.test.ts + test/*.test.ts)
# Expected: all green, including the new integration file. clearAll()+setConfig(undefined) in
# beforeEach/afterEach prevents runtime/config leakage across suites (CRITICAL #8).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm git is actually exercised (not silently skipped). After a green run, the F-revert-git scenario
# MUST have created a shadow repo. Quick manual probe (optional sanity, not a gate):
ls "<storageDir>/<sha256(repoRoot).slice(0,16)>"   # the shadow repo dir exists during a run
git --git-dir="<that dir>" for-each-ref refs/mulligan/snapshots/   # lists turn/turn + turn/turn-after

# Root-detection guard for F-revert-failopen (chmod is ignored under root):
node -e "console.log(process.getuid && process.getuid()===0 ? 'ROOT (failopen chmod ineffective)' : 'ok')"
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npx vitest run test/integration/revert-git.test.ts` — all scenarios pass.
- [ ] `npm test` — full suite green (no regressions, no shared-state leak).

### Feature Validation
- [ ] **F-revert-git**: sed-edited file (c.ts) restored to pre-span; a.ts + b.ts restored; user `.git`
      recursive hash UNCHANGED before vs after; `store.has(beforeRef)` true then false after `retire`;
      shadow `refs/mulligan/snapshots/` non-empty; `marker.data.revert.revertedFiles` ⊇ {a.ts,b.ts,c.ts}.
- [ ] **F-revert-failopen**: rewind text contains "Reverted" (NOT "refused"); a.ts restored; b.ts NOT
      restored (still mutated); `marker.data.revert.failedFiles` ⊇ {b.ts}; `revertedFiles` ⊇ {a.ts}.
      (Skipped under root with a console.warn — chmod ineffective there.)
- [ ] **F-revert-delete**: config-off sub-case — new.ts still exists, `deletedFiles === []`; config-on
      sub-case — new.ts gone, `deletedFiles` ⊇ {new.ts}.

### Code Quality Validation
- [ ] Follows existing test idioms: vitest, hand-rolled makePi/makeCtx (no vi.fn), `.js` imports,
      `clearAll()` + `setConfig(undefined)` before/after each, real `git` via promisified execFile.
- [ ] Reuses the rewind.test.ts fake/helper SHAPES verbatim (makePi/makeCtx/msgEntry/asstWrite/asstBash/
      run/firstText) — does NOT reimplement the tool or the store.
- [ ] Temp dirs cleaned up in afterEach (chmod 0o755 before rmSync force — read-only files block rm).
- [ ] git skip-guard present (`git --version` -> `return` on failure), mirroring store.test.ts (d).

### Documentation & Deployment
- [ ] No production-source changes (test-only item — DOCS: none per the contract).
- [ ] The file's top-of-file comment cites spec/10 §2.1 + spec/14 §3/§6 + the scenario names.

---

## Anti-Patterns to Avoid

- ❌ Don't reimplement the rewind tool, the store, or the capture hooks — CALL the real ones (this is an
  integration test; the unit suites already cover them with fakes).
- ❌ Don't use `makeFakeStore` here — the whole point is a REAL `GitBackend` via `detectAndCreate`.
- ❌ Don't place `storageDir` inside `repoDir` (config rejects inside-cwd storageDir -> NoOpStore).
- ❌ Don't forget to assign `rt.store = store` BEFORE calling the capture hooks (they self-gate on it).
- ❌ Don't assert the sed file is in `ledger.modifiedFiles` — it is NOT (it's in `bashSideEffects`); assert
  it is RESTORED (the git index diff reverts it). Asserting otherwise will fail.
- ❌ Don't leave a chmod-0o444 file un-restored before `rmSync` (it throws EACCES / EPERM on cleanup).
- ❌ Don't share captured refs across the two F-revert-delete sub-cases (a second `turn_start` GCs turn/*);
  use separate repo + store + runtime per sub-case.
- ❌ Don't run F-revert-failopen assertions under root without a skip-guard (chmod is a no-op for root).

---

## Confidence Score: 9/10

One-pass success is highly likely: every seam, fake shape, assertion target, and gotcha (especially the
sed-via-index-diff property and the .git byte-identical guarantee) is pinned to exact source references
with copy-ready patterns. The only residual risk is environment-specific: `sed`/`chmod` behavior under
unusual CI users (root) — explicitly guarded. No production code changes reduce blast radius to "does the
new test file pass."