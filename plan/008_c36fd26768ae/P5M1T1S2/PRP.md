---
name: "P5.M1.T1.S2 — F-revert-cas + F-revert-explicit + F-revert-dirtyguard integration tests"
description: >
  Create test/integration/revert-cas.test.ts — a vitest integration test that drives the REAL v1.2
  working-tree-revert subsystem (CasBackend via detectAndCreate + the REAL capture hooks where they
  apply + the REAL makeRewindTool) end-to-end against REAL non-git temp directories. Three scenarios:
  F-revert-cas (non-git, nonGitMode "cas", mutate via write+edit+bash sed → ALL restored via the
  whole-tree manifest; backend "cas"); F-revert-explicit (nonGitMode "explicit-paths" → write/edit
  restored, bash sed NOT restored + once-per-turn warning; backend "cas"); F-revert-dirtyguard
  (after agent_end, edit a file externally → file-revert REFUSED, file NOT overwritten, context
  rewind still happens). Test-only — NO production-source changes.
---

# PRP — F-revert-cas + F-revert-explicit + F-revert-dirtyguard (P5.M1.T1.S2)

## Goal

**Feature Goal**: Add three passing vitest integration scenarios in a single new file
`test/integration/revert-cas.test.ts` that validate the v1.2 working-tree-revert **CasBackend**
subsystem end-to-end through its real public seams — `detectAndCreate` (real `CasBackend`), the real
`turnStartCaptureHandler`/`agentEndCaptureHandler` capture hooks (for cas-mode scenarios), and the real
`makeRewindTool` — against REAL temporary **non-git** directories (real files; real `sed`).

**Deliverable**: One new file `test/integration/revert-cas.test.ts` containing exactly three scenarios —
`F-revert-cas`, `F-revert-explicit`, `F-revert-dirtyguard` — plus the small set of shared fakes/helpers
they need (copied verbatim from `test/tools/rewind.test.ts`). No production-source changes. No
documentation changes (test-only item, per the contract: "DOCS: none — test-only").

**Success Definition**:
- `npm test` (=`vitest run`) is green with the new file included.
- `npm run typecheck` (=`tsc --noEmit`) is green.
- F-revert-cas asserts ALL of: every mutated file — including the `bash sed -i` file — is restored to its
  pre-span content; `store.describe().backend==="cas"`; the persisted `mulligan:rewind` marker carries
  `data.revert.backend==="cas"` and `data.revert.revertedFiles` ⊇ {a.ts, b.ts, c.ts}.
- F-revert-explicit asserts: write/edit files (a.ts, b.ts) restored to pre-span; the bash `sed` file
  (c.ts) NOT restored (still the sed result); a once-per-turn bash warning was logged containing
  "explicit-paths"; `data.revert.backend==="cas"` and `revertedFiles` ⊇ {a.ts, b.ts} but NOT c.ts.
- F-revert-dirtyguard asserts: rewind SUCCEEDS (context rewind happened — `mulligan:rewind` marker
  persisted); `firstText(res)` contains "refused"; the externally-edited file is NOT overwritten (still
  the external-edit content); the marker's `data.revert` is `undefined` (the refuse branch assigns no
  revert block — see CRITICAL FINDING #2).

## User Persona

**Target User**: The pi-mulligan maintainer + CI. These are non-human regression sentinels.

**Use Case**: Guard the CAS-backend contract (spec/14 §4.1 comprehensive restore, §4.2 explicit-paths
scoping + bash-not-captured warning, §6 refuse-on-dirty guard) against regressions, by exercising the
REAL CasBackend + REAL capture/restore seams rather than fakes.

## Why

- P1–P4 shipped the revert subsystem with THOROUGH unit coverage (cas.test.ts uses a `StateFs`/`TreeFs`
  fake fs; rewind.test.ts uses a `makeFakeStore`). But no test today drives a REAL `CasBackend` (via
  `detectAndCreate`) + the REAL capture hooks + the REAL rewind tool together against a real non-git
  directory with real files. This file closes that gap (PRD spec/10 §2 "F-revert-cas/explicit/dirtyguard").
- It pins the load-bearing, non-obvious distinction between the two non-git modes: in **cas mode** a
  `bash sed -i` edit IS restored (the whole-tree manifest captured it), whereas in **explicit-paths
  mode** the same edit is NOT restored (only write/edit tool paths are captured; bash is deliberately
  not promised restorable + warned).
- It pins the refuse-on-dirty guarantee (E30 / spec/14 §6 step 3): a post-`agent_end` external edit
  REFUSES the file-revert (the file is not clobbered), while the context rewind still completes.

## What

A vitest file `test/integration/revert-cas.test.ts` with three scenarios. Each scenario uses a fresh
non-git temp directory + a SEPARATE temp storage directory, builds a REAL `CasBackend` via
`detectAndCreate`, assigns it to `getRuntime(sid).store`, drives the capture lifecycle (real hooks for
cas-mode scenarios; direct `store.capture` calls for the explicit-paths scenario — see CRITICAL
FINDING #1), then calls the REAL `makeRewindTool` and asserts on disk state + the persisted marker.

### Success Criteria
- [ ] Three scenarios pass under `vitest run`.
- [ ] F-revert-cas: a.ts + b.ts + c.ts (incl. the sed file) restored; backend "cas"; revertedFiles ⊇ all 3.
- [ ] F-revert-explicit: a.ts + b.ts restored; c.ts NOT restored; warn-once fired; backend "cas".
- [ ] F-revert-dirtyguard: rewind succeeds (marker persisted); firstText "refused"; file NOT overwritten; `data.revert` undefined.

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: every seam the test calls (`detectAndCreate`,
`turnStartCaptureHandler`, `agentEndCaptureHandler`, `makeRewindTool`, `getRuntime`, `setConfig`,
`clearAll`, `CasBackend.capture`/`notifyBashUsed`), every fake shape (`makePi`/`makeCtx`/`msgEntry`/
`asstWrite`/`asstEdit`/`asstBash`/`result`/`run`/`firstText`/`VALID_NOTE`), every assertion target
(`store.describe().backend`, `marker.data.revert.backend`/`.revertedFiles`, `firstText` "refused",
file contents), and BOTH critical gotchas (no tool_call hook → explicit-paths drives capture directly;
refuse branch leaves `data.revert` undefined) are specified below with exact file:line references and
copy-ready patterns.

### Documentation & References

```yaml
# MUST READ — the contract this test validates (read the relevant rows before writing assertions)
- url: spec/10-testing.md §2.1 (scenario table F-revert-cas / F-revert-explicit / F-revert-dirtyguard)
  why: the authoritative pass-criteria for each scenario
  critical: "CAS restore matches pre-span content; revert.backend==='cas'" (F-revert-cas);
    "write/edit files reverted; bash sed NOT reverted (+ once-per-turn warning); backend 'cas'" (F-revert-explicit);
    "file-revert REFUSED; drifted path … context rewind still happens; file NOT overwritten" (F-revert-dirtyguard)
- url: spec/14-working-tree-revert.md §4.1 ("cas" default — whole-tree capture+restore), §4.2 ("explicit-paths" —
    write/edit paths only, bash NOT captured + warned once per turn), §6 (restore/refuse-on-dirty semantics)
  why: the mode behaviors + the dirty-guard REFUSE contract this test pins
- url: spec/08-edge-cases.md E30 (concurrent/external modification → dirty guard REFUSES the file-revert;
    refused[]; file not overwritten) + E27 (revert best-effort, never blocks the rewind)
  why: the F-revert-dirtyguard scenario basis

# MUST READ — exact source seams the test drives (do NOT reimplement; call these)
- file: src/snapshot/store.ts
  why: detectAndCreate(cwd, cfg, sessionDir?) factory → CasBackend for a non-git cwd; SnapshotStore interface
  pattern: "const store = await detectAndCreate(repoDir, getConfig().revert); store.describe().backend === 'cas'"
  gotcha: cfg.storageDir MUST NOT resolve inside cwd (resolveStorageDir rejects → NoOpStore/backend "none").
    Pass a SEPARATE mkdtemp for storage. detectAndCreate NEVER rejects.
- file: src/snapshot/cas.ts
  why: CasBackend — the backend under test. describe()={backend:"cas"} ALWAYS (both non-git modes).
    capture(label, explicitPaths?) — 'explicit-paths' ⇒ captureExplicitPaths(only those paths); 'cas' ⇒ whole-tree.
    dirtyCheck(afterRef,paths), restore(beforeRef,opts) 5 buckets, notifyBashUsed() once-per-turn warn, has/retire.
  pattern: "const beforeRef = await rt.store.capture('turn', ['a.ts','b.ts']);  // ref === 'turn'"
  gotcha: in 'cas' mode capture ignores explicitPaths (whole-tree walk). In 'explicit-paths' mode capture with
    NO explicitPaths arg ⇒ EMPTY manifest (this is why the explicit scenario drives capture directly — see
    CRITICAL FINDING #1). notifyBashUsed is PUBLIC on CasBackend (cast `store as CasBackend`).
- file: src/capture.ts
  why: turnStartCaptureHandler(event, ctx) + agentEndCaptureHandler(event, ctx) — the REAL capture hooks
  pattern: "await turnStartCaptureHandler({type:'turn_start',turnIndex:0,timestamp:Date.now()}, ctx)"
  gotcha: both self-gate on getConfig().revert.enabled AND rt.store (assign rt.store BEFORE calling).
    turn_start calls gc() then capture("turn") (NO explicitPaths arg) → rt.snapshots.get("turn").beforeRef.
    agent_end calls capture("turn-after") (NO explicitPaths) → mutates .afterRef in place.
- file: src/tools/rewind.ts (step 6b, ~lines 790-905)
  why: makeRewindTool(pi).execute(toolCallId, params, signal, onUpdate, ctx) — step 6b revert decision tree
  pattern: "affectedPaths = ledger.modifiedFiles" feeds dirtyCheck; store.restore diffs the manifest
  gotcha: step 6b resolves rt.snapshots.get("turn") (key 'turn' for last_turn); needs config.revert.enabled.
    On REFUSE (driftedPaths.length>0): sets revertClause text, sets revertRefused=true, but does NOT assign
    revertBlock and does NOT call store.restore → the persisted marker has NO `revert` field (see FINDING #2).
    On PROCEED: store.restore(beforeRef) → folds RestoreResult into marker.revert {revertedFiles,deletedFiles,
    failedFiles,refusedFiles,backend}. buildContextEntries() must yield the span AFTER the user msg.
- file: src/runtime.ts
  why: getRuntime(sid).store + .snapshots (a Map<string,RevertCheckpoint>); clearAll() reset
  pattern: "rt.snapshots.set('turn', {label:'turn', backend:'cas', beforeRef, turnIndex:0, ts:Date.now()})"
  gotcha: RevertCheckpoint.backend is 2-valued ("git"|"cas"); the snapshot Map keys are "turn" + "ckpt:"+name.
- file: src/markers.ts (RevertCheckpoint ~line 121; RewindMarker.revert?: {...}) + src/config.ts (setConfig partial
    deep-merge; DEFAULT_CONFIG.revert block) + src/ledger.ts (extractFileLedger: write/edit → modifiedFiles,
    bash → bashSideEffects)

# MUST COPY — the factory-seam fakes/helpers (verbatim shapes from the existing unit suite)
- file: test/tools/rewind.test.ts
  why: makePi() (appendEntry/sendMessage/setLabel capture), makeCtx({sessionId,contextEntries})
    (sessionManager.{getSessionId,getLeafId,getEntries,getLabel,getBranch,buildContextEntries}; NO getContextUsage),
    msgEntry(message), user(text), asst(...callIds), asstWrite(callId,file_path), asstBash(callId,command),
    result(callId), run(pi,ctx,params,toolCallId), firstText(res), VALID_NOTE
  pattern: "rt.store = makeFakeStore(...)" — REPLACE makeFakeStore with a REAL detectAndCreate store
  gotcha: appendEntry captures the persisted marker → assert
    appended.find(e=>e.customType==='mulligan:rewind').data.revert
- file: test/cas.test.ts (explicit-paths capture tests ~lines 720-810; dirtyCheck ~990-1090; restore ~1100+)
  why: the proven DIRECT-capture driving pattern for explicit-paths mode
    (cb.capture("turn", ["src/a.ts"]) — the explicit paths arg). The integration scenario mirrors this but
    against a REAL non-git dir + the REAL rewind tool.

# Reference — the parallel sibling PRP (its fakes/helpers are identical; it ships revert-git.test.ts)
- docfile: plan/008_c36fd26768ae/P5M1T1S1/PRP.md  (the git-mode sibling; reuse its makePi/makeCtx/asstEdit/run shapes)
- docfile: plan/008_c36fd26768ae/architecture/external_deps.md §2 (CAS blob/manifest layout, node:fs surface)
- docfile: plan/008_c36fd26768ae/P5M1T1S2/research/findings.md (the two critical findings distilled)
```

### Current Codebase tree (relevant slice)

```bash
src/
  capture.ts                 # turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots  [REAL, call for cas/dirtyguard]
  config.ts                  # setConfig(partial) deep-merge; getConfig(); DEFAULT_CONFIG.revert{nonGitMode:"cas",...}
  runtime.ts                 # getRuntime(sid).store / .snapshots; clearAll(); resetRuntime()
  markers.ts                 # RevertCheckpoint{label,backend:"git"|"cas",beforeRef,afterRef?,turnIndex,ts}; RewindMarker.revert?
  ledger.ts                  # extractFileLedger: write/edit → modifiedFiles; bash → bashSideEffects
  snapshot/
    store.ts                 # detectAndCreate(cwd,cfg,sessionDir?) -> SnapshotStore; RestoreResult(5 buckets)
    cas.ts                   # CasBackend — describe()={backend:"cas"}; capture(label,explicitPaths?); dirtyCheck; restore; notifyBashUsed
  tools/rewind.ts            # makeRewindTool(pi); step 6b revert decision tree (proceed assigns revertBlock; REFUSE does NOT)
test/
  tools/rewind.test.ts       # TEMPLATE: makePi/makeCtx/msgEntry/asstWrite/asstBash/run/firstText + VALID_NOTE (+ makeFakeStore — NOT used here)
  cas.test.ts                # TEMPLATE: the explicit-paths DIRECT-capture driving pattern (cb.capture("turn",["src/a.ts"]))
  integration/
    run-smoke.mjs / smoke.ts / scenarios.md   # (existing Pi-process smoke harness — NOT vitest files; do not modify)
```

### Desired Codebase tree (files to ADD)

```bash
test/integration/
    revert-cas.test.ts       # NEW — the three vitest scenarios + shared fakes/helpers (self-contained)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — there is NO `pi.on("tool_call",…)` hook (verified in src/index.ts). The real
//   turnStartCaptureHandler/agentEndCaptureHandler call store.capture("turn")/"turn-after" with NO
//   explicitPaths arg. In 'cas' mode that is fine (whole-tree walk populates the manifest). In
//   'explicit-paths' mode it produces an EMPTY manifest (no tool_call hook supplies the write/edit
//   paths) → restore would revert nothing + dirtyCheck would REFUSE (empty afterRef baseline ⇒ every
//   existing path reports dirty). THEREFORE F-revert-explicit MUST drive capture DIRECTLY:
//     rt.store.capture("turn", ["a.ts","b.ts"]) + rt.store.capture("turn-after", ["a.ts","b.ts"]),
//   set rt.snapshots manually (mirroring what the hooks write), AND call (store as CasBackend)
//   .notifyBashUsed() for the warning. This simulates the (unwired) tool_call hook. See cas.test.ts
//   lines ~720-810 for the proven direct-capture pattern. F-revert-cas and F-revert-dirtyguard use
//   the REAL hooks (cas-mode whole-tree capture works through them).
//
// CRITICAL #2 — the REFUSE branch of step 6b does NOT assign `revertBlock` and does NOT call
//   store.restore. So the persisted mulligan:rewind marker has data.revert === undefined on refuse,
//   and refusedFiles is NEVER populated (that bucket is only filled by store.restore on PROCEED).
//   The item description's literal "drifted path in revert.refusedFiles" is NOT satisfiable against
//   the current implementation (a documented spec/impl divergence). F-revert-dirtyguard MUST assert
//   the OBSERVABLE refuse contract instead: (a) firstText(res) contains "refused"; (b) the externally-
//   edited file is NOT overwritten; (c) the rewind still persisted its mulligan:rewind marker
//   (context rewind happened); (d) data.revert === undefined. This is test-only-safe (no source change).
//
// CRITICAL #3 — CasBackend.describe().backend === "cas" in BOTH non-git modes. The mode ("cas" vs
//   "explicit-paths") is a config knob, NOT a backend. So F-revert-explicit asserts backend === "cas"
//   (NOT "explicit-paths"). The marker.data.revert.backend is likewise "cas".
//
// CRITICAL #4 — in 'cas' mode the bash sed file IS restored (the whole-tree manifest captured it,
//   and restore reverts every existed:true entry). In 'explicit-paths' mode the sed file is NOT
//   restored (it was never captured — only the explicit write/edit paths were). THIS IS THE CENTRAL
//   DISTINCTION between the two scenarios' assertions on c.ts.
//
// CRITICAL #5 — affectedPaths = ledger.modifiedFiles feeds ONLY store.dirtyCheck (the dirty guard).
//   modifiedFiles comes from write/edit toolCalls' file_path. A bash sed file is in bashSideEffects,
//   NOT modifiedFiles. For the dirty guard to detect a drift on a.ts, the span must include an
//   asstWrite/asstEdit("…","a.ts") so a.ts ∈ modifiedFiles (else dirtyCheck is not asked about a.ts).
//
// CRITICAL #6 — last_turn resolution removes every message AFTER the last user message. So
//   contextEntries must be [user, <write toolCall>, <result>, <edit toolCall>, <result>, <bash toolCall>,
//   <result>, <final assistant>, <result>]. Put the span AFTER the user msg or the ledger is empty.
//
// CRITICAL #7 — config.storageDir resolving INSIDE cwd is rejected (config.ts + resolveStorageDir re-check
//   → NoOpStore, backend "none"). Use a SEPARATE mkdtemp for storage, never nested under the repo dir.
//
// CRITICAL #8 — setConfig MERGES a partial over DEFAULT_CONFIG. setConfig(undefined) resets to default.
//   clearAll() wipes the module-scoped runtime map. Call both in beforeEach/afterEach (seq is shared
//   across the whole suite). DEFAULT_CONFIG.revert = {enabled:false, allowDeleteCreatedFiles:false,
//   nonGitMode:"cas", storageDir:null, maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
//   excludeGlobs:[.git,node_modules,dist,build,.next,.venv,target]}.
//
// GOTCHA #9 — .js import paths from test/integration/: "../../src/snapshot/store.js" etc. (ESM + tsc output).
//
// GOTCHA #10 — do NOT attach ctx.getContextUsage (computeFilteredTotal -> windowTokens 0 -> the (4c)
//   context-fraction guard is skipped). The default makeCtx omits it; keep it omitted.
//
// GOTCHA #11 — the capture hooks read ctx.sessionManager.getSessionId() (NOT ctx.sessionId) and are
//   read FRESH (C12). makeCtx binds sessionId into sessionManager.getSessionId(). Build ONE ctx per
//   scenario and use it for BOTH the capture hooks (which ignore contextEntries) and the rewind tool
//   (which reads contextEntries via buildContextEntries for the ledger).
//
// GOTCHA #12 — 'cas'-mode capture is a whole-tree walk that PRUNES .git/.pi/node_modules + excludeGlobs.
//   A non-git temp dir has no .git, so the walk captures the repo files you wrote. Captures increment
//   capturesThisTurn (turn + turn-after = 2, well under maxSnapshotsPerTurn=64).
```

## Implementation Blueprint

### Data models and structure

No new data models. The test consumes existing exports:

```typescript
// Reuse these exact types (do NOT redefine):
import { detectAndCreate, type SnapshotStore, type RestoreResult } from "../../src/snapshot/store.js";
import { CasBackend } from "../../src/snapshot/cas.js"; // for the notifyBashUsed cast in F-revert-explicit
import { turnStartCaptureHandler, agentEndCaptureHandler } from "../../src/capture.js";
import { makeRewindTool, type RewindArgs, type RewindDetails } from "../../src/tools/rewind.js";
import { setConfig, getConfig } from "../../src/config.js";
import { getRuntime, clearAll } from "../../src/runtime.js";
import type { RevertCheckpoint } from "../../src/markers.js";
import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/integration/revert-cas.test.ts — shared scaffolding (top of file)
  - IMPORTS: vitest {describe,it,expect,beforeEach,afterEach,vi}; node:fs {mkdtempSync,rmSync,writeFileSync,
    readFileSync,existsSync}; node:os {tmpdir}; node:path {join}; node:child_process {execFile as
    execFileCb} + a `const execFile = promisify(execFileCb)`; node:util {promisify}.
    The src seams listed in "Data models" above (ALL via .js paths).
  - IMPLEMENT helper `sed(path, expr)` = `execFile("sed", ["-i", expr, path])` (promisified; universally
    available on Linux/macOS CI). USED for the bash mutation in F-revert-cas + F-revert-explicit.
  - IMPLEMENT helper `makeNonGitDir(prefix)` = `mkdtempSync(join(tmpdir(), prefix))` (NO git init — this is
    the non-git case). Returns repoDir.
  - IMPLEMENT helper `makeStorage()` = `mkdtempSync(join(tmpdir(), "mulligan-store-"))` (SEPARATE from repoDir).
  - COPY the fakes from test/tools/rewind.test.ts VERBATIM (adjust nothing): makePi() (captures
    appendEntry/sendMessage/setLabel), makeCtx({sessionId,contextEntries}) (sessionManager.getSessionId/
    getLeafId/getEntries/getLabel/getBranch/buildContextEntries; NO getContextUsage), msgEntry(message),
    user(text), asst(...callIds), asstWrite(callId,file_path), asstBash(callId,command), result(callId)
    (takes a toolCallId → {role:'toolResult',toolCallId,toolName:'tool',content:[{type:'text',text:'...'}],
    isError:false}), run(pi,ctx,params,toolCallId) helper, firstText(res).
  - AUTHOR asstEdit(callId,file_path): NOT in rewind.test.ts — write the trivial analog of asstWrite with
    the toolCall name "edit" (ledger.ts treats write+edit identically → both in modifiedFiles):
    {role:'assistant', content:[{type:'toolCall', id:callId, name:'edit', arguments:{file_path}}]}.
  - VALID_NOTE const (copy from rewind.test.ts: 3 non-empty fields — what_happened/true_current_state/next).
  - beforeEach: clearAll(); setConfig(undefined). afterEach: clearAll(); setConfig(undefined); tracked
    dirs[] → rmSync(force) (no chmod needed for these 3 scenarios — read-only locking is S1's domain).
  - NAMING: describe("F-revert-cas/explicit/dirtyguard integration (spec/10 §2.1 / spec/14 §4/§6)", () => { ... }).
  - PLACEMENT: test/integration/revert-cas.test.ts.

Task 2: IMPLEMENT scenario "F-revert-cas" (spec/10 §2.1 row F-revert-cas / spec/14 §4.1)
  - SETUP: repoDir = makeNonGitDir("rev-cas-"); writeFileSync(a.ts,"A1\n"); b.ts="B1\n"; c.ts="C1\n".
    (Optionally assert !existsSync(join(repoDir,".git")) to prove non-git-ness.) Record
    preSpan = {a:"A1\n", b:"B1\n", c:"C1\n"}. storageDir = makeStorage().
  - CONFIG + STORE + RUNTIME:
      setConfig({revert:{enabled:true, nonGitMode:"cas", storageDir}});   // 'cas' is the default; set explicitly
      const store = await detectAndCreate(repoDir, getConfig().revert);
      expect(store.describe().backend).toBe("cas");
      const sid="s1"; const rt=getRuntime(sid); rt.store=store;             // CRITICAL #11: before the hooks
      const {pi}=makePi();
  - CAPTURE turn_start (REAL hook — cas-mode whole-tree walk):
      const ctx=makeCtx({sessionId:sid, contextEntries: SPAN});   // build SPAN after mutation (read at execute time)
      await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()}, ctx);
      expect(rt.snapshots.get("turn")?.beforeRef).toBeTruthy();   // ref === "turn"
  - MUTATE (the span): writeFileSync(join(repoDir,"a.ts"),"A2-rewritten\n");
      writeFileSync(join(repoDir,"b.ts"),"B2-rewritten\n");   // the "edit" — content mutated in place
      await sed(join(repoDir,"c.ts"),"s/C1/C2-edited/");       // REAL bash sed -i
  - CAPTURE agent_end (REAL hook — whole-tree afterRef):
      await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx);
      expect(rt.snapshots.get("turn")?.afterRef).toBe("turn-after");
  - BUILD SPAN contextEntries (the ledger source — paths are repo-relative POSIX):
      const SPAN = [
        msgEntry(user("rewrite the files")),
        msgEntry(asstWrite("w1","a.ts")),  msgEntry(result("w1")),
        msgEntry(asstEdit("e1","b.ts")),   msgEntry(result("e1")),
        msgEntry(asstBash("s1","sed -i s/C1/C2-edited/ c.ts")), msgEntry(result("s1")),
        msgEntry(asst("final")),           msgEntry(result("final")),
      ];
      (NOTE: build the ctx with this SPAN — makeCtx reads contextEntries at execute() time, so order vs the
      hooks is fine. The hooks ignore contextEntries; only the rewind tool reads them.)
  - DRIVE the REAL rewind tool:
      const res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true}, "final");
  - ASSERT success + files restored (incl. the sed file — CRITICAL #4):
      expect(firstText(res)).toContain("Reverted");
      expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe(preSpan.a);
      expect(readFileSync(join(repoDir,"b.ts"),"utf8")).toBe(preSpan.b);
      expect(readFileSync(join(repoDir,"c.ts"),"utf8")).toBe(preSpan.c);   // sed file RESTORED in cas mode
  - ASSERT backend + marker:
      const rw = pi.appended.find(e=>e.customType==="mulligan:rewind");
      expect(rw).toBeTruthy();
      expect(rw.data.revert?.backend).toBe("cas");    // CRITICAL #3: "cas" in BOTH non-git modes
      expect(rw.data.revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts","b.ts","c.ts"]));
  - CLEANUP: track repoDir + storageDir in dirs[] for afterEach.

Task 3: IMPLEMENT scenario "F-revert-explicit" (spec/10 §2.1 row F-revert-explicit / spec/14 §4.2)
  - SETUP: repoDir = makeNonGitDir("rev-explicit-"); a.ts="A1\n"; b.ts="B1\n"; c.ts="C1\n". preSpan recorded.
      storageDir = makeStorage().
  - CONFIG + STORE + RUNTIME:
      setConfig({revert:{enabled:true, nonGitMode:"explicit-paths", storageDir}});
      const store = await detectAndCreate(repoDir, getConfig().revert);
      expect(store.describe().backend).toBe("cas");   // CRITICAL #3: still "cas" (the mode is a config knob)
      const sid="s1"; const rt=getRuntime(sid); rt.store=store; const {pi}=makePi();
  - DRIVE CAPTURE DIRECTLY (CRITICAL #1 — NO tool_call hook; real hooks would produce EMPTY manifests):
      // capture the write/edit paths' PRE-span state (simulate the tool_call-time capture)
      const beforeRef = await rt.store.capture("turn", ["a.ts","b.ts"]);
      expect(beforeRef).toBe("turn");
      rt.snapshots.set("turn", {label:"turn", backend:"cas", beforeRef, turnIndex:0, ts:Date.now()} as RevertCheckpoint);
  - MUTATE (the span): writeFileSync(a.ts,"A2\n"); writeFileSync(b.ts,"B2\n"); await sed(c.ts,"s/C1/C2/");
  - CAPTURE afterRef DIRECTLY (so dirtyCheck has a baseline; CRITICAL #1):
      const afterRef = await rt.store.capture("turn-after", ["a.ts","b.ts"]);
      expect(afterRef).toBe("turn-after");
      rt.snapshots.get("turn")!.afterRef = afterRef;   // mirror agentEndCaptureHandler's in-place mutation
  - BASH WARNING (simulate the tool_call hook's notifyBashUsed on the bash toolCall — CRITICAL #1):
      const warn = vi.spyOn(console,"warn").mockImplementation(()=>{});
      (store as CasBackend).notifyBashUsed();           // explicit-paths mode ⇒ warns ONCE this turn
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("explicit-paths"));
      warn.mockRestore();
  - BUILD ctx + SPAN (write a.ts, edit b.ts, bash sed c.ts) — same shape as Task 2's SPAN.
  - DRIVE: const res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true}, "final");
  - ASSERT write/edit RESTORED, sed NOT reverted (CRITICAL #4):
      expect(firstText(res)).toContain("Reverted");
      expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe(preSpan.a);   // reverted
      expect(readFileSync(join(repoDir,"b.ts"),"utf8")).toBe(preSpan.b);   // reverted
      expect(readFileSync(join(repoDir,"c.ts"),"utf8")).toBe("C2\n");      // NOT reverted (still the sed result)
  - ASSERT backend + marker:
      const rw = pi.appended.find(e=>e.customType==="mulligan:rewind");
      expect(rw.data.revert?.backend).toBe("cas");
      expect(rw.data.revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts","b.ts"]));
      expect(rw.data.revert?.revertedFiles).not.toContain("c.ts");
  - CLEANUP: track dirs.

Task 4: IMPLEMENT scenario "F-revert-dirtyguard" (spec/10 §2.1 row F-revert-dirtyguard / spec/14 §6 + E30)
  - SETUP: repoDir = makeNonGitDir("rev-dirty-"); a.ts="A1\n" (pre-span). storageDir = makeStorage().
  - CONFIG + STORE + RUNTIME:
      setConfig({revert:{enabled:true, nonGitMode:"cas", storageDir}});   // cas mode → real hooks work
      const store = await detectAndCreate(repoDir, getConfig().revert);
      expect(store.describe().backend).toBe("cas");
      const sid="s1"; const rt=getRuntime(sid); rt.store=store; const {pi}=makePi();
  - BUILD ctx + SPAN (write a.ts — so a.ts ∈ ledger.modifiedFiles → dirtyCheck is asked about a.ts, CRITICAL #5):
      const ctx = makeCtx({sessionId:sid, contextEntries:[
        msgEntry(user("edit a.ts")), msgEntry(asstWrite("w1","a.ts")), msgEntry(result("w1")),
        msgEntry(asst("final")), msgEntry(result("final")),
      ]});
  - CAPTURE turn_start (REAL hook — whole-tree beforeRef):
      await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()}, ctx);
      expect(rt.snapshots.get("turn")?.beforeRef).toBe("turn");
  - MUTATE (the agent's span): writeFileSync(join(repoDir,"a.ts"),"A2-agent\n");
  - CAPTURE agent_end (REAL hook — afterRef captures the AGENT's mutated state):
      await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx);
      expect(rt.snapshots.get("turn")?.afterRef).toBe("turn-after");
  - EXTERNAL EDIT AFTER agent_end (the human/other-process drift — E30):
      writeFileSync(join(repoDir,"a.ts"),"HUMAN-EDIT\n");   // <-- the drift; NOT the agent's "A2-agent\n"
  - DRIVE: const res = await run(pi, ctx, {note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true}, "final");
  - ASSERT REFUSE (CRITICAL #2 — observable contract, NOT refusedFiles):
      expect(firstText(res)).toContain("refused");   // the revertClause text
      expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe("HUMAN-EDIT\n");  // NOT overwritten (E30)
  - ASSERT context rewind STILL happened (the rewind persisted its marker despite the file-revert refuse):
      const rw = pi.appended.find(e=>e.customType==="mulligan:rewind");
      expect(rw).toBeTruthy();
  - ASSERT the refuse branch left NO revert block (CRITICAL #2):
      expect(rw.data.revert).toBeUndefined();   // refuse branch never assigns revertBlock / never calls restore
  - CLEANUP: track dirs.
  - NOTE: the item description's literal "drifted path in revert.refusedFiles" is NOT how the current
    implementation signals refusal (refusedFiles is only populated on the PROCEED branch by store.restore).
    The refusal is observable via the revertClause TEXT + the file-not-overwritten state + the absent revert
    block. Asserting refusedFiles would always fail — do NOT assert it. See research/findings.md FINDING #2.
```

### Implementation Patterns & Key Details

```typescript
// The cas-mode end-to-end driving pattern (F-revert-cas + F-revert-dirtyguard — REAL hooks work).
async function driveCasCycle({ repoDir, storageDir, sid, spanEntries, revertCfg, mutate, rewindParams }) {
  setConfig({ revert: { enabled: true, nonGitMode: "cas", ...revertCfg } });     // CRITICAL #8: partial merge
  const store = await detectAndCreate(repoDir, getConfig().revert);              // REAL CasBackend
  expect(store.describe().backend).toBe("cas");
  const rt = getRuntime(sid); rt.store = store;                                  // CRITICAL #11: before the hooks
  const { pi } = makePi();
  const ctx = makeCtx({ sessionId: sid, contextEntries: spanEntries });
  await turnStartCaptureHandler({ type:"turn_start", turnIndex:0, timestamp:Date.now() }, ctx);  // REAL hook
  expect(rt.snapshots.get("turn")?.beforeRef).toBe("turn");
  await mutate(repoDir);
  await agentEndCaptureHandler({ type:"agent_end", messages:[] }, ctx);          // REAL hook → afterRef
  expect(rt.snapshots.get("turn")?.afterRef).toBe("turn-after");
  const res = await run(pi, ctx, rewindParams, "final");
  return { res, pi, rt, store };
}

// The explicit-paths driving pattern (F-revert-explicit — capture driven DIRECTLY, CRITICAL #1).
async function driveExplicitCycle({ repoDir, storageDir, sid, spanEntries, mutate, paths, rewindParams }) {
  setConfig({ revert: { enabled: true, nonGitMode: "explicit-paths", storageDir } });
  const store = await detectAndCreate(repoDir, getConfig().revert);
  const rt = getRuntime(sid); rt.store = store; const { pi } = makePi();
  // capture the write/edit paths' PRE-span state directly (simulate the unwired tool_call hook)
  const beforeRef = await rt.store.capture("turn", paths);
  rt.snapshots.set("turn", { label:"turn", backend:"cas", beforeRef, turnIndex:0, ts:Date.now() } as RevertCheckpoint);
  await mutate(repoDir);
  const afterRef = await rt.store.capture("turn-after", paths);                  // baseline for dirtyCheck
  rt.snapshots.get("turn")!.afterRef = afterRef;
  (store as CasBackend).notifyBashUsed();                                        // the bash warning
  const ctx = makeCtx({ sessionId: sid, contextEntries: spanEntries });
  const res = await run(pi, ctx, rewindParams, "final");
  return { res, pi, rt, store };
}

// The dirtyguard REFUSE flow — assert the OBSERVABLE contract, NOT refusedFiles (CRITICAL #2).
//   firstText(res) must contain "refused"; the file must NOT be overwritten; data.revert must be undefined.
//   (The REFUSE branch sets the revertClause text + revertRefused=true but never assigns revertBlock.)
```

### Integration Points

```yaml
NO production-source changes. This is a test-only item.
- file added: test/integration/revert-cas.test.ts
- picked up by: "npm test" (vitest run) — test/integration/*.test.ts is inside the default glob
- typecheck: "npm run typecheck" (tsc --noEmit) — tsconfig includes ["src","test"]
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the file — fix before proceeding.
npm run typecheck          # tsc --noEmit (zero errors). The .js import paths + fake casts + the
                            # CasBackend cast (store as CasBackend) + RevertCheckpoint cast must type-check.
# (No separate linter configured — typecheck + vitest are the gates.)
```

### Level 2: Unit/Integration Tests (the deliverable itself)

```bash
# Run JUST the new file (fast feedback while iterating).
npx vitest run test/integration/revert-cas.test.ts

# Expected: 3 scenarios pass (F-revert-cas, F-revert-explicit, F-revert-dirtyguard).
# If a scenario fails, READ the assertion that failed + firstText(res) + pi.appended marker to localize.
# F-revert-dirtyguard: if firstText does NOT contain "refused", the dirty guard did not fire — confirm the
#   external edit happened AFTER agent_end and that a.ts ∈ ledger.modifiedFiles (the span has asstWrite w1 a.ts).
```

### Level 3: Full Suite (no regressions)

```bash
# The whole suite must stay green (the new file must not break sibling tests — e.g. no shared-state leak).
npm test                   # vitest run (all test/**/*.test.ts + test/*.test.ts)
# Expected: all green, including the new integration file + the P5.M1.T1.S1 revert-git.test.ts sibling.
# clearAll()+setConfig(undefined) in beforeEach/afterEach prevents runtime/config leakage (CRITICAL #8).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the non-git path is genuinely exercised (not silently a NoOpStore). After a green F-revert-cas run,
# the CasBackend MUST have written manifests. Quick manual probe (optional sanity, not a gate):
ls "<storageDir>/manifests/"        # turn.json + turn-after.json exist after the capture hooks ran
ls "<storageDir>/blobs/"            # sharded blob dirs (<2-hex>/<hash>) exist (deduped content)

# Confirm sed is available (universally true on Linux/macOS; the scenarios use it directly):
command -v sed && sed --version | head -1
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npx vitest run test/integration/revert-cas.test.ts` — all 3 scenarios pass.
- [ ] `npm test` — full suite green (no regressions, no shared-state leak, no conflict with revert-git.test.ts).

### Feature Validation
- [ ] **F-revert-cas**: a.ts + b.ts + c.ts (incl. the sed file) all restored to pre-span; `store.describe().backend==="cas"`;
      `marker.data.revert.backend==="cas"`; `revertedFiles` ⊇ {a.ts,b.ts,c.ts}. (Uses the REAL capture hooks.)
- [ ] **F-revert-explicit**: a.ts + b.ts restored; c.ts NOT restored (still the sed result, e.g. "C2\n"); the
      once-per-turn bash warning fired containing "explicit-paths"; `revertedFiles` ⊇ {a.ts,b.ts} but NOT c.ts;
      `backend==="cas"`. (Drives capture DIRECTLY — CRITICAL #1.)
- [ ] **F-revert-dirtyguard**: `firstText(res)` contains "refused"; the externally-edited file is NOT overwritten
      (still the external-edit content); the rewind persisted its `mulligan:rewind` marker (context rewind happened);
      `marker.data.revert === undefined` (refuse branch assigns no revert block — CRITICAL #2). (Uses REAL hooks.)

### Code Quality Validation
- [ ] Follows existing test idioms: vitest, hand-rolled makePi/makeCtx (no vi.fn), `.js` imports,
      `clearAll()` + `setConfig(undefined)` before/after each, real files via writeFileSync, real `sed` via promisified execFile.
- [ ] Reuses the rewind.test.ts fake/helper SHAPES verbatim (makePi/makeCtx/msgEntry/asstWrite/asstEdit/asstBash/
      user/result/run/firstText/VALID_NOTE) — does NOT reimplement the tool or the store.
- [ ] Temp dirs cleaned up in afterEach (rmSync force). storageDir is a SEPARATE mkdtemp (never inside repoDir).
- [ ] Does NOT assert `marker.data.revert.refusedFiles` for F-revert-dirtyguard (always undefined on refuse);
      asserts the observable refuse contract instead.

### Documentation & Deployment
- [ ] No production-source changes (test-only item — DOCS: none per the contract).
- [ ] The file's top-of-file comment cites spec/10 §2.1 + spec/14 §4.1/§4.2/§6 + the scenario names + the two
      critical findings (no tool_call hook; refuse leaves data.revert undefined).

---

## Anti-Patterns to Avoid

- ❌ Don't reimplement the rewind tool, the store, the CAS backend, or the capture hooks — CALL the real ones
  (this is an integration test; the unit suites cas.test.ts/rewind.test.ts already cover them with fakes).
- ❌ Don't use `makeFakeStore` here — the whole point is a REAL `CasBackend` via `detectAndCreate`.
- ❌ Don't place `storageDir` inside `repoDir` (config rejects inside-cwd storageDir → NoOpStore/backend "none").
- ❌ Don't forget to assign `rt.store = store` BEFORE calling the capture hooks (they self-gate on rt.store).
- ❌ Don't drive F-revert-explicit through the REAL turn_start/agent_end hooks — they pass NO explicitPaths, so
  the manifest is EMPTY (no tool_call hook supplies the write/edit paths). Drive `store.capture("turn",[paths])`
  and `store.capture("turn-after",[paths])` DIRECTLY + set rt.snapshots manually (CRITICAL #1).
- ❌ Don't assert `marker.data.revert.refusedFiles` in F-revert-dirtyguard — the refuse branch never assigns
  `revertBlock` (so data.revert is undefined) and never calls store.restore (so refusedFiles is never populated).
  Assert firstText "refused" + file-not-overwritten + data.revert undefined instead (CRITICAL #2).
- ❌ Don't expect `backend === "explicit-paths"` — CasBackend.describe().backend is `"cas"` in BOTH non-git
  modes (CRITICAL #3). The mode is a config knob, not a backend identifier.
- ❌ Don't forget that in 'cas' mode the sed file (c.ts) IS restored (whole-tree manifest) while in
  'explicit-paths' mode it is NOT — assert each scenario's c.ts outcome accordingly (CRITICAL #4).
- ❌ Don't make the dirtyguard span omit the write to a.ts — dirtyCheck is only asked about `ledger.modifiedFiles`,
  so a.ts must appear there (an `asstWrite("w1","a.ts")` in the span) for the drift to be detected (CRITICAL #5).
- ❌ Don't put the user message last in the span — last_turn removes everything AFTER the last user message;
  put the toolCalls AFTER the user msg or the ledger is empty (CRITICAL #6).

---

## Confidence Score: 9/10

One-pass success is highly likely: every seam, fake shape, assertion target, and BOTH critical gotchas (no
tool_call hook → explicit-paths drives capture directly; refuse branch leaves `data.revert` undefined) are
pinned to exact source references with copy-ready patterns. The two non-obvious properties this file pins —
cas-mode restores a sed edit while explicit-paths does not, and the dirty guard refuses via text (not a
refusedFiles bucket) — are spelled out with the precise assertion each scenario must make. The only residual
risk is an environment without `sed`, which is universally present on Linux/macOS CI. No production code
changes reduce blast radius to "does the new test file pass."

---