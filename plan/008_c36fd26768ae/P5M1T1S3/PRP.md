---
name: "P5.M1.T1.S3 — F-revert-granularity + F-revert-reload integration tests"
description: >
  Create test/integration/revert-edge.test.ts — a vitest integration test that drives the REAL v1.2
  working-tree-revert subsystem end-to-end through its real public seams (makeRewindTool, the REAL
  makeCheckpointCommand step-4b checkpoint capture, the REAL capture hooks where used, detectAndCreate,
  getRuntime/resetRuntime, gcTurnSnapshots). Two scenarios:
    F-revert-granularity — rewind granularity:"last_tool_call_group" with revert_file_changes:true → the
    file revert is IGNORED (store.restore never called; marker.data.revert === undefined) AND the
    granularity-mismatch notice is returned in the success text, while the context rewind still completes
    (marker persisted). No store/checkpoint required (branch 3 fires before store resolution).
    F-revert-reload — set a checkpoint (real makeCheckpointCommand step 4b captures ckpt: + persists the
    mulligan:revert-checkpoint control entry + on-disk shadow ref), issue a last_turn rewind-with-revert,
    SIMULATE /resume (resetRuntime + detectAndCreate same-storage + gcTurnSnapshots + rebuild rt.snapshots
    from the persisted control entries — the read-side production does NOT yet perform), then a
    rewind-to-checkpoint-with-revert; assert the persisted ref is still honored (store.has true) and the
    files are restored post-reload (E32). Test-only — NO production-source changes.
---

# PRP — F-revert-granularity + F-revert-reload (P5.M1.T1.S3)

## Goal

**Feature Goal**: Add two passing vitest integration scenarios in a single new file
`test/integration/revert-edge.test.ts` that validate the v1.2 working-tree-revert **granularity-refusal**
contract and the **post-reload snapshot-ref durability** contract (E32) end-to-end through the real public
seams — `makeRewindTool`, the REAL `makeCheckpointCommand` (step-4b checkpoint capture + control-entry
persist), the REAL `turnStartCaptureHandler`/`agentEndCaptureHandler` hooks (for the pre-reload last_turn
revert), `detectAndCreate` (real `GitBackend`), `getRuntime`/`resetRuntime`, and `gcTurnSnapshots` — against a
REAL temporary **git** repo (real files; real `git`) for F-revert-reload, and a plain non-git temp dir for
F-revert-granularity.

**Deliverable**: One new file `test/integration/revert-edge.test.ts` containing exactly two scenarios —
`F-revert-granularity`, `F-revert-reload` — plus the small set of shared fakes/helpers they need (the
`makePi`/`makeCtx`/`makeSessionCtx`/`msgEntry`/`user`/`asst`/`asstWrite`/`result`/`run`/`firstText`/`VALID_NOTE`
shapes copied from `test/tools/rewind.test.ts` + `test/integration/revert-git.test.ts`, plus a richer
shared-backing-array `makeSessionCtx` for F-revert-reload). No production-source changes. No documentation
changes (test-only item, per the contract: "DOCS: none — test-only").

**Success Definition**:
- `npm test` (=`vitest run`) is green with the new file included.
- `npm run typecheck` (=`tsc --noEmit`) is green.
- **F-revert-granularity** asserts ALL of: `firstText(res)` contains the granularity-mismatch notice
  (`"File revert applies to last_turn/checkpoint granularity"`); the mutated file is UNCHANGED on disk
  (revert ignored); a `mulligan:rewind` marker is in `pi.appended` (context rewind happened); the marker's
  `data.revert === undefined` (branch 3 never assigns a revert block).
- **F-revert-reload** asserts ALL of: a `mulligan:revert-checkpoint` control entry was persisted by step 4b;
  after the simulated `/resume` (`resetRuntime` + `detectAndCreate` same-storage + `gcTurnSnapshots` + rebuild
  from control entries), `rt.snapshots.get("ckpt:x")` is restored AND `store.has(beforeRef) === true` (the
  on-disk ref survived); the post-reload `rewind-to-checkpoint with revert` restores the file to its
  pre-checkpoint state (`revertedFiles ⊇ ["a.ts"]`); the marker's `data.revert.backend === "git"`.

## User Persona

**Target User**: The pi-mulligan maintainer + CI. These are non-human regression sentinels.

**Use Case**: Guard two v1.2 contracts against regressions — (a) the granularity refusal (group-granularity
flags are ignored + noticed, never silently file-reverted), and (b) the E32 reload-durability fix (snapshot
refs survive `/resume`, so a post-reload checkpoint rewind still restores files).

## Why

- P1–P4 shipped the revert subsystem with thorough unit coverage, and P5.M1.T1.S1/S2 add the git/cas/explicit/
  failopen/delete/dirtyguard integration scenarios. But no test today drives the **granularity-refusal path**
  through the real `makeRewindTool` (unit tests cover it with a bare execute call, but the integration seam —
  `store.restore` truly never invoked + the notice in the success text + the marker persisted — is unproven),
  and no test proves the **E32 reload claim** (refs live on disk + survive `detectAndCreate` re-detection) by
  actually tearing down the runtime and re-creating the store against the same storage.
- These two scenarios are the load-bearing regression sentinels for the two most non-obvious v1.2 behaviors:
  (1) `revert_file_changes:true` at `last_tool_call_group` granularity is a NO-OP-with-notice (not a silent
  restore, not a refusal of the whole rewind); (2) a checkpoint's snapshot ref is durable across a process
  reload even though the in-memory `snapshots` Map is ephemeral.

## What

A vitest file `test/integration/revert-edge.test.ts` with two scenarios.

- **F-revert-granularity** uses a plain non-git temp dir + a file mutated by the test. It configures
  `revert.enabled:true`, builds a `last_tool_call_group` span (user → `write` toolCall → result → assistant),
  calls the REAL `makeRewindTool` with `revert_file_changes:true`, and asserts the mismatch notice + an
  unchanged file + a persisted marker with `data.revert === undefined`. No store, no checkpoint.
- **F-revert-reload** uses a REAL temp git repo + a SEPARATE temp storage dir. It: (1) sets a checkpoint via
  the REAL `makeCheckpointCommand` (exercises step 4b: capture `ckpt:x` + persist control entry + set label);
  (2) captures turn_start / mutates / captures agent_end via the REAL hooks; (3) issues a `last_turn` rewind
  with revert (pre-reload revert that persists its own marker + proves a clean revert); (4) SIMULATES
  `/resume` (`resetRuntime` + `detectAndCreate` same storage + `gcTurnSnapshots` + rebuild `rt.snapshots` from
  the persisted control entries); (5) mutates the file again post-reload; (6) issues a `rewind-to-checkpoint`
  with revert on a span with NO file-mutating toolCalls (so the dirty guard is skipped → restore proceeds);
  (7) asserts the durable ref is honored + the file is restored post-reload.

### Success Criteria
- [ ] Two scenarios pass under `vitest run`.
- [ ] F-revert-granularity: mismatch notice in text; file unchanged; marker persisted; `data.revert === undefined`.
- [ ] F-revert-reload: control entry persisted by step 4b; post-reload `rt.snapshots.get("ckpt:x")` rebuilt +
      `store.has(beforeRef)===true`; post-reload checkpoint rewind restores the file; `data.revert.backend==="git"`.

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: every seam the test calls (`makeRewindTool`, `makeCheckpointCommand`,
`turnStartCaptureHandler`, `agentEndCaptureHandler`, `detectAndCreate`, `getRuntime`, `resetRuntime`,
`clearAll`, `gcTurnSnapshots`, `setConfig`/`getConfig`), every fake shape (`makePi`/`makeCtx`/`makeSessionCtx`/
`msgEntry`/`user`/`asst`/`asstWrite`/`result`/`run`/`firstText`/`VALID_NOTE`), every assertion target
(`firstText` mismatch-notice substring, file contents, `pi.appended` marker `data.revert`, control entry,
`store.has`, `rt.snapshots.get`), and ALL FIVE critical findings (granularity branch 3 fires before store;
reload re-read is NOT in production → test simulates it; checkpoint dirty-guard tension → resolved by an
empty-modifiedFiles span; richer shared-backing-array ctx for the checkpoint label; ckpt:* survives GC +
re-detection) are specified below with exact file:line references and copy-ready patterns. See
`plan/008_c36fd26768ae/P5M1T1S3/research/findings.md` for the full distilled research.

### Documentation & References

```yaml
# MUST READ — the contract these tests validate (read the relevant rows before writing assertions)
- url: spec/10-testing.md §2.1 (scenario table F-revert-granularity / F-revert-reload)
  why: the authoritative pass-criteria for each scenario
  critical: "file revert IGNORED + the mismatch notice returned; the context rewind still happens" (granularity);
    "persisted refs still honored; files restored post-reload (E32 resolved)" (reload)
- url: spec/08-edge-cases.md E32 (post-reload snapshot loss → RESOLVED in v1.2: refs on disk + control entries
    persisted; reload re-reads refs; file-revert survives reload for checkpoints and already-issued rewinds)
  why: the F-revert-reload scenario basis + the reload-durability contract
- url: spec/14-working-tree-revert.md §5 (capture lifecycle; checkpoint namespace GC-exempt), §6 (restore/
    refuse-on-dirty semantics), §7 (mulligan_rewind integration — step 6b granularity refusal)
  why: the mode behaviors + the granularity-refusal + restore contracts these tests pin

# MUST READ — exact source seams the tests drive (do NOT reimplement; call these)
- file: src/tools/rewind.ts (step 6b ~lines 790-840; step 7 persist; step 7b checkpoint consumption)
  why: makeRewindTool(pi).execute(toolCallId, params, signal, onUpdate, ctx) — step 6b branch order is
    LOAD-BEARING: config → granularity → resolve-checkpoint → dirty-guard → proceed.
  pattern: "const tool = makeRewindTool(pi); const res = await tool.execute('rw1', params, undefined, undefined, ctx)"
  gotcha: branch (3) — `else if (granularity === 'last_tool_call_group') { revertClause = 'File revert applies
    to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.'; }` fires BEFORE the
    store/checkpoint resolution (branch 4). So at group granularity, store.restore is NEVER called and
    revertBlock stays undefined (F-revert-granularity). Branch (4): checkpoint rewinds resolve the key
    `ckpt:${params.checkpoint}` from rt.snapshots (FINDING: checkpoints have NO afterRef → dirty baseline is
    beforeRef → FINDING 3 tension). On REFUSE: revertRefused=true + revertClause set, but NO revertBlock (S2
    FINDING #2). step 7b CONSUMES the checkpoint label on a checkpoint-rewind success (pi.setLabel(id, undefined)).
- file: src/commands.ts (makeCheckpointCommand ~lines 185-245; step 4b ~lines 209-232)
  why: makeCheckpointCommand(pi).handler("x", ctx) — the REAL checkpoint setter; step 4b is the capture+persist.
  pattern: "const cmd = makeCheckpointCommand(pi); await cmd.handler('x', ctx);"
  gotcha: setCheckpoint (markers.ts) anchors on the LAST real message in getBranch() — the branch MUST contain
    a user/assistant message or step 4b never runs ({error}). step 4b: `if (getConfig().revert.enabled) { ...
    if (rt.store) { ... if (backend!=='none') { const ckptRef = await rt.store.capture('ckpt:'+name);
    rt.snapshots.set('ckpt:'+name, {...}); pi.appendEntry('mulligan:revert-checkpoint', {label, ref, backend}); } } }`.
    notify + reconcileBanner run AFTER; both are SKIPPED when ctx.hasUI===false (simplest fake).
- file: src/capture.ts (turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots — all EXPORTED)
  why: the REAL capture hooks for the pre-reload last_turn revert; gcTurnSnapshots is reused for the /resume sim.
  pattern: "await turnStartCaptureHandler({type:'turn_start',turnIndex:0,timestamp:Date.now()}, ctx);
    await agentEndCaptureHandler({type:'agent_end',messages:[]}, ctx);"
  gotcha: both self-gate on getConfig().revert.enabled AND rt.store (assign rt.store BEFORE calling).
    turn_start calls gc() then capture("turn") → rt.snapshots.get("turn").beforeRef. agent_end capture("turn-after")
    → mutates the existing "turn" entry's .afterRef IN PLACE. gcTurnSnapshots clears ONLY keys starting with "turn"
    (ckpt:* preserved).
- file: src/snapshot/store.ts (detectAndCreate factory; SnapshotStore.has/restore/dirtyCheck/describe)
  why: detectAndCreate(repoDir, cfg) → GitBackend for a git cwd. detectAndCreate NEVER rejects.
  pattern: "rt.store = await detectAndCreate(repoDir, getConfig().revert); store.describe().backend==='git'"
  gotcha: cfg.storageDir MUST NOT resolve inside cwd (config rejects → NoOpStore/backend "none"). Pass a SEPARATE
    mkdtemp. After resetRuntime + a SECOND detectAndCreate with the SAME storageDir, the new store reads the SAME
    on-disk refs ⇒ store.has(beforeRef)===true + store.restore works (E32 durability — the core of F-revert-reload).
- file: src/snapshot/git.ts (dirtyCheck verified: `git diff --name-only afterRef -- paths`; empty paths ⇒ [])
  why: confirms FINDING 3 — at empty affectedPaths the dirty guard is SKIPPED ⇒ PROCEED ⇒ restore runs.
    refForLabel("ckpt:x")→refs/mulligan/snapshots/checkpoint/x (GC-exempt — git.ts:130/588).
- file: src/runtime.ts (getRuntime, resetRuntime EXPORTED, clearAll; snapshots?: Map<string,RevertCheckpoint>;
    freshRuntime initializes snapshots to a fresh empty Map)
  why: resetRuntime(sid) is the /resume-sim step that wipes the in-memory snapshots Map (so the rebuild is
    observable). getRuntime(sid) re-creates it fresh.
- file: src/markers.ts (setCheckpoint — walks getBranch() backwards to last real message; pi.setLabel;
    RevertCheckpoint{label,backend:"git"|"cas",beforeRef,afterRef?,turnIndex,ts})

# MUST COPY — the factory-seam fakes/helpers (verbatim shapes from the existing suite)
- file: test/tools/rewind.test.ts
  why: makePi() (appendEntry/sendMessage/setLabel capture), makeCtx({sessionId,contextEntries}) (the SIMPLE
    ctx — getEntries→[], getLabel→undefined; sufficient for F-revert-granularity), msgEntry(message),
    user(text), asst(...callIds), asstWrite(callId,file_path), result(callId), run(pi,ctx,params,toolCallId),
    firstText(res), VALID_NOTE.
- file: test/integration/revert-git.test.ts (S1 — the sibling)
  why: the git helpers (git(cwd,args), makeRepo(prefix), makeStorage(), gitAvailable(), shadowKey, hashDir)
    + the SAME makePi/makeCtx/VALID_NOTE shapes (S1 copied them verbatim too). F-revert-reload reuses git mode.

# Reference — the parallel sibling PRPs (their fakes/helpers are identical; S1 ships revert-git.test.ts)
- docfile: plan/008_c36fd26768ae/P5M1T1S1/PRP.md  (the git-mode sibling — reuse its git helpers + fake shapes)
- docfile: plan/008_c36fd26768ae/P5M1T1S2/PRP.md  (the cas-mode sibling — its CRITICAL FINDING #2 precedent:
  assert the OBSERVABLE contract, not a literal field that the impl never populates; applies to BOTH our scenarios)
- docfile: plan/008_c36fd26768ae/P5M1T1S3/research/findings.md  (the 7 distilled findings for THIS item)
```

### Current Codebase tree (relevant slice)

```bash
src/
  commands.ts                # makeCheckpointCommand (step 4b: capture ckpt: + persist control entry + setLabel)  [REAL, call for reload]
  capture.ts                 # turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots (ALL exported)  [REAL]
  runtime.ts                 # getRuntime, resetRuntime, clearAll; snapshots?: Map<string,RevertCheckpoint>  [REAL]
  markers.ts                 # setCheckpoint (walks getBranch→last real message); RevertCheckpoint type
  config.ts                  # setConfig(partial) deep-merge; getConfig(); DEFAULT_CONFIG.revert{nonGitMode:"cas",...}
  snapshot/store.ts          # detectAndCreate(cwd,cfg) -> SnapshotStore; RestoreResult(5 buckets); has/restore/dirtyCheck
  snapshot/git.ts            # GitBackend — describe()={backend:"git"}; capture; dirtyCheck (git diff --name-only); restore; refForLabel (ckpt→checkpoint/x, GC-exempt)
  tools/rewind.ts            # makeRewindTool(pi); step 6b branch order: config→granularity(3)→resolve(4)→guard→proceed
test/
  tools/rewind.test.ts       # TEMPLATE: makePi/makeCtx/msgEntry/user/asst/asstWrite/result/run/firstText + VALID_NOTE
  integration/
    revert-git.test.ts       # S1 sibling: git helpers (git/makeRepo/makeStorage/gitAvailable/shadowKey/hashDir) + fakes
    run-smoke.mjs / smoke.ts / scenarios.md   # (existing Pi-process smoke harness — NOT vitest; do not modify)
```

### Desired Codebase tree (files to ADD)

```bash
test/integration/
    revert-edge.test.ts      # NEW — the two vitest scenarios + shared fakes/helpers (self-contained)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — F-revert-granularity is the SIMPLE scenario. rewind.ts step 6b branch (3) fires when
//   granularity==="last_tool_call_group" && wantRevert, BEFORE the store/checkpoint resolution (branch 4).
//   So NO store, NO checkpoint, NO temp git repo is required — only config.revert.enabled:true + a
//   last_tool_call_group span + revert_file_changes:true. store.restore is NEVER called; revertBlock stays
//   undefined; the mismatch notice rides the success TEXT. Assert: text contains the notice, file unchanged,
//   marker persisted, marker.data.revert === undefined.
//
// CRITICAL #2 — the reload re-read is NOT implemented in production. commands.ts:226 WRITES the
//   "mulligan:revert-checkpoint" control entry, but NOTHING in src/ re-reads it (grep-verified: the only
//   occurrence is the write). index.ts session_start does resetRuntime + detectAndCreate + gcTurnSnapshots but
//   does NOT rebuild rt.snapshots from control entries. The item contract ANTICIPATES this ("simulate /resume
//   (re-read mulligan:revert-checkpoint entries + restore snapshots Map)") — so F-revert-reload PERFORMS the
//   rebuild as a SIMULATION. What the test therefore validates is the DATA DURABILITY: the control entries +
//   on-disk refs survive resetRuntime + detectAndCreate (same storage) + gcTurnSnapshots, and a rebuilt Map +
//   re-detected store still honor store.restore(beforeRef) post-reload. (Spec/impl divergence of the SAME shape
//   as S2 FINDING #2 — assert the observable contract.)
//
// CRITICAL #3 — the checkpoint dirty-guard tension. Checkpoints have NO afterRef (commands.ts step 4b captures
//   ONCE). rewind.ts step 6b: `const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef` → dirty baseline is
//   beforeRef. git dirtyCheck: `git diff --name-only beforeRef -- <paths>`; guard `if (!afterRef || paths.length===0)
//   return []`. So a checkpoint rewind whose span mutated files ⇒ dirtyCheck(beforeRef, [mutated]) ⇒ working tree
//   ≠ beforeRef ⇒ REFUSE. RESOLUTION: the post-reload checkpoint-rewind SPAN must have NO file-mutating toolCalls
//   (so ledger.modifiedFiles === [] ⇒ affectedPaths === [] ⇒ dirtyCheck returns [] ⇒ dirty guard SKIPPED ⇒
//   PROCEED ⇒ store.restore(beforeRef) runs). The working tree IS mutated (by a direct writeFileSync post-reload,
//   representing accumulated state the revert restores) ⇒ restore restores it ⇒ revertedFiles populated. This
//   ISOLATES the reload-durability question (dirty-guard-refuses is S2's F-revert-dirtyguard concern).
//
// CRITICAL #4 — F-revert-reload needs a RICHER ctx than makeCtx. checkpointExists (rewind step 3) + readMarkers
//   + resolveCheckpoint read ctx.sessionManager.getEntries() + getLabel(); setCheckpoint walks getBranch(). The
//   simple makeCtx returns getEntries()→[] + getLabel()→undefined ⇒ checkpointExists===false ⇒ the checkpoint
//   rewind REFUSES at step 3. BUILD makeSessionCtx with a SHARED mutable `entries` array backing BOTH pi
//   (appendEntry/setLabel PUSH to it) AND ctx.sessionManager (getEntries/getBranch/buildContextEntries READ it;
//   getLabel = latest-wins scan over label entries). ctx.hasUI===false ⇒ notify + reconcileBanner no-op. This
//   shared array is what makes the "reload" natural: it PERSISTS across resetRuntime + detectAndCreate.
//
// CRITICAL #5 — setCheckpoint anchors on the LAST real message in getBranch() (BUG-003 fix). So the branch MUST
//   contain a user/assistant message BEFORE calling makeCheckpointCommand, or step 4b never runs
//   ({error:"no conversation message to checkpoint"}). Seed the shared entries with a user+assistant exchange.
//
// CRITICAL #6 — getLabel MUST implement latest-wins (Pi's label semantics, mirrored by checkpointExists /
//   clearCheckpointByName): walk entries; the LAST {type:"label", targetId:id} wins; a setLabel(id, undefined)
//   appends {label:undefined} ⇒ getLabel returns undefined (cleared). After makeCheckpointCommand sets the label,
//   getLabel(targetId)==="mulligan:checkpoint:x" ⇒ checkpointExists===true. After a checkpoint-rewind's step 7b
//   consumes it (pi.setLabel(id, undefined)), getLabel returns undefined ⇒ consumed.
//
// CRITICAL #7 — ckpt:* refs SURVIVE resetRuntime + detectAndCreate(same storage) + gcTurnSnapshots. git:
//   refForLabel("ckpt:x")→refs/mulligan/snapshots/checkpoint/x (git.ts:130); gcTurnSnapshots deletes only
//   refs/mulligan/snapshots/turn/* (git.ts:588). So post-reload store.has(beforeRef)===true. This is the core of
//   E32 the test validates (FINDING 5).
//
// CRITICAL #8 — the pre-reload "rewind with revert" (last_turn) does NOT have the checkpoint tension: it has a
//   real afterRef (agent_end capture) ⇒ dirty guard compares working tree vs afterRef (the agent's final state)
//   ⇒ they match ⇒ PROCEED ⇒ restore(beforeRef) reverts to turn-start. This is the proven S1/S2 pattern.
//
// GOTCHA #9 — .js import paths from test/integration/: "../../src/commands.js", "../../src/capture.js",
//   "../../src/snapshot/store.js", "../../src/tools/rewind.js", "../../src/runtime.js", "../../src/config.js" (ESM + tsc).
//
// GOTCHA #10 — do NOT attach ctx.getContextUsage (computeFilteredTotal → windowTokens 0 → the (4c)
//   context-fraction guard is skipped). The default makeCtx/makeSessionCtx omits it; keep it omitted.
//
// GOTCHA #11 — setConfig MERGES a partial over DEFAULT_CONFIG. setConfig(undefined) resets to default.
//   clearAll() wipes the module-scoped runtime map. Call both in beforeEach/afterEach (state is shared across the
//   whole suite). DEFAULT_CONFIG.revert = {enabled:false, allowDeleteCreatedFiles:false, nonGitMode:"cas",
//   storageDir:null, maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
//   excludeGlobs:[.git,node_modules,dist,build,.next,.venv,target]}.
//
// GOTCHA #12 — for a last_tool_call_group span, resolveLastToolCallGroup pairs the LAST assistant-turn toolCall
//   group with its results. Span = [user, asstWrite(w1,a.ts), result(w1), asst(final)]. Pass a rewind toolCallId
//   NOT in the span (e.g. "rw1"). The ledger's modifiedFiles=[a.ts] but revert is SKIPPED at group granularity
//   regardless (branch 3 fires first).
//
// GOTCHA #13 — F-revert-reload git mode: cfg.storageDir MUST be a SEPARATE mkdtemp (never inside repoDir —
//   config rejects inside-cwd storageDir → NoOpStore/backend "none"). Use gitAvailable() skip-guard (mirror S1):
//   `gitAvailable()` false ⇒ `it.skip(...)` (NOT a failure; git is universally present on Linux/macOS CI).
//
// GOTCHA #14 — resetRuntime is EXPORTED from runtime.ts (used by index.ts session_start). Import it for the
//   /resume simulation. After resetRuntime(sid), getRuntime(sid) returns a FRESH runtime with an EMPTY snapshots
//   Map + store undefined — so re-assign rt.store + rebuild snapshots explicitly.
```

## Implementation Blueprint

### Data models and structure

No new data models. The test consumes existing exports:

```typescript
// Reuse these exact types (do NOT redefine):
import { makeRewindTool, type RewindArgs, type RewindDetails } from "../../src/tools/rewind.js";
import { makeCheckpointCommand } from "../../src/commands.js"; // REAL checkpoint setter (step 4b)
import { turnStartCaptureHandler, agentEndCaptureHandler, gcTurnSnapshots } from "../../src/capture.js";
import { detectAndCreate, type SnapshotStore } from "../../src/snapshot/store.js";
import { getRuntime, resetRuntime, clearAll } from "../../src/runtime.js"; // resetRuntime is EXPORTED
import { setConfig, getConfig } from "../../src/config.js";
import type { RevertCheckpoint } from "../../src/markers.js";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/integration/revert-edge.test.ts — shared scaffolding (top of file)
  - IMPORTS: vitest {describe,it,expect,beforeEach,afterEach}; node:fs {mkdtempSync,rmSync,writeFileSync,
    readFileSync,existsSync}; node:os {tmpdir}; node:path {join}; node:child_process {execFile as execFileCb};
    node:util {promisify}; node:crypto (NONE needed unless you add a hashDir sanity probe — optional).
    The src seams listed in "Data models" above (ALL via .js paths).
  - IMPLEMENT `const execFile = promisify(execFileCb)` + git helpers (copy from S1 revert-git.test.ts VERBATIM):
    `git(cwd, args)` = execFile("git", args, {cwd, maxBuffer:1<<22}); `gitAvailable()` = try execFile("git",
    ["--version"]) → true / catch → false; `makeRepo(prefix)` = mkdtempSync + `git init -b main`.
  - IMPLEMENT `makeStorage()` = `mkdtempSync(join(tmpdir(), "mulligan-store-"))` (SEPARATE from any repo dir).
  - COPY the fakes from test/tools/rewind.test.ts VERBATIM (adjust nothing): makePi() (captures
    appendEntry/sendMessage/setLabel), makeCtx({sessionId,contextEntries}) (sessionManager.getSessionId/
    getLeafId/getEntries→[]/getLabel→undefined/getBranch→[]/buildContextEntries; NO getContextUsage),
    msgEntry(message), user(text), asst(...callIds), asstWrite(callId,file_path), result(callId), run(pi,ctx,
    params,toolCallId), firstText(res).
  - IMPLEMENT `makeSessionCtx({sessionId, seedEntries})` — the RICHER ctx for F-revert-reload (CRITICAL #4):
      const entries = [...seedEntries];   // shared mutable backing array (the "persisted JSONL")
      const pi = { appendEntry(customType, data){ entries.push({type:"custom", id:`e-${entries.length}`,
          customType, data}); },                       // appendEntry pushes a custom entry WITH a stable id
        sendMessage(message, options){ /* capture if needed; unused by these scenarios */ },
        setLabel(targetId, label){ entries.push({type:"label", targetId, label}); } };
      const sessionManager = { getSessionId(){return sessionId;}, getLeafId(){return `e-${entries.length-1}`;},
        getEntries(){return entries;}, getBranch(){return entries;}, buildContextEntries(){return entries;},
        getLabel(id){ let cur=undefined; for(const e of entries){ if(e.type==="label"&&e.targetId===id) cur=e.label; }
          return cur; } };                              // CRITICAL #6: latest-wins
      return { pi: pi as unknown as ExtensionAPI, ctx: { sessionManager, hasUI:false } as unknown as ExtensionContext,
        entries };
    NOTE: appendEntry MUST stamp a stable `id` on each custom entry (msgEntry already does; the control entries +
    markers need ids too — setCheckpoint/appendRewindMarker read e.id). Use `e-<n>` (monotonic).
  - VALID_NOTE const (copy from rewind.test.ts: 3 non-empty fields — what_happened/true_current_state/next).
  - beforeEach: clearAll(); setConfig(undefined). afterEach: clearAll(); setConfig(undefined); tracked dirs[]
    → rmSync(force). 
  - NAMING: describe("F-revert-granularity + F-revert-reload integration (spec/10 §2.1 / spec/08 E32 / spec/14 §6/§7)", () => { ... }).
  - PLACEMENT: test/integration/revert-edge.test.ts.

Task 2: IMPLEMENT scenario "F-revert-granularity" (spec/10 §2.1 row F-revert-granularity / spec/14 §7; CRITICAL #1)
  - SETUP: tmpDir = mkdtempSync(join(tmpdir(),"rev-gran-")); const aPath=join(tmpDir,"a.ts");
    writeFileSync(aPath,"A0\n"); record preSpan="A0\n". (NO git init — revert is skipped anyway; a plain dir proves
    "revert IGNORED".)
  - CONFIG: setConfig({revert:{enabled:true, nonGitMode:"cas"}});  // CRITICAL #1: enabled is enough; store UNNEEDED.
    const {pi}=makePi();
  - BUILD the last_tool_call_group SPAN (CRITICAL #12): the span is the last assistant toolCall group + its result.
      const SPAN = [
        msgEntry(user("rewrite a.ts")),
        msgEntry(asstWrite("w1","a.ts")), msgEntry(result("w1")),
        msgEntry(asst("final")),          msgEntry(result("final")),
      ];
    const {ctx}=makeCtx({sessionId:"s1", contextEntries: SPAN});
  - MUTATE the file DIRECTLY (simulating the span's effect — revert would restore this IF it ran):
      writeFileSync(aPath,"A1-mutated\n");
  - DRIVE the REAL rewind tool (revert_file_changes:true at group granularity — the mismatch path):
      const tool=makeRewindTool(pi);
      const res=await tool.execute("rw1", {note:VALID_NOTE, granularity:"last_tool_call_group",
        revert_file_changes:true}, undefined, undefined, ctx);
  - ASSERT the granularity-mismatch NOTICE in the success text (CRITICAL #1):
      expect(firstText(res)).toContain("File revert applies to last_turn/checkpoint granularity");
  - ASSERT the file revert was IGNORED (file UNCHANGED — branch 3 never called store.restore):
      expect(readFileSync(aPath,"utf8")).toBe("A1-mutated\n");   // NOT restored
  - ASSERT the context rewind STILL happened (the marker persisted despite the skipped revert):
      const rw=pi.appended.find(e=>e.customType==="mulligan:rewind"); expect(rw).toBeTruthy();
  - ASSERT the marker has NO revert block (branch 3 never assigns revertBlock — S2 FINDING #2 shape):
      expect(rw.data.revert).toBeUndefined();
  - CLEANUP: track tmpDir in dirs[] for afterEach.

Task 3: IMPLEMENT scenario "F-revert-reload" (spec/10 §2.1 row F-revert-reload / spec/08 E32; CRITICAL #2-#8)
  - SKIP-GUARD (CRITICAL #13): wrap the body in `if (!(await gitAvailable())) { it.skip("git unavailable"); return; }`
    — OR use a `it("F-revert-reload ...", async () => { ... ; (await gitAvailable()) || expect.fail("needs git"); })`
    pattern with an early return. Simplest: `const hasGit = await gitAvailable(); (hasGit ? it : it.skip)("F-revert-reload ...", async () => {...})`.
  - SETUP: repoDir=await makeRepo("rev-reload-"); const aPath=join(repoDir,"a.ts"); writeFileSync(aPath,"A0\n");
    + an initial commit so the git repo has a HEAD: `await git(repoDir,["add","-A"]); await git(repoDir,["commit",
    "-m","init","--allow-empty"])` (the shadow repo is separate, but a real commit makes the repo a clean baseline;
    optional — the shadow repo captures the tree regardless). Record preCkpt="A0\n". storageDir=makeStorage().
  - CONFIG: setConfig({revert:{enabled:true, nonGitMode:"cas", storageDir}});  // storageDir on config is fine;
    detectAndCreate is ALSO passed cfg explicitly below (mirror S1).
  - BUILD the shared-session ctx (CRITICAL #4/#5): seed with a user→assistant exchange so setCheckpoint can anchor.
      const {pi, ctx, entries} = makeSessionCtx({ sessionId:"s1", seedEntries: [
        msgEntry(user("start work")), msgEntry(asst("ok")) ] });
  - STORE + RUNTIME:
      const store=await detectAndCreate(repoDir, getConfig().revert); expect(store.describe().backend).toBe("git");
      const sid="s1"; const rt=getRuntime(sid); rt.store=store;     // CRITICAL: assign BEFORE the hooks/command
  - (a) SET CHECKPOINT via the REAL command (exercises step 4b — CRITICAL #5):
      const cmd=makeCheckpointCommand(pi); await cmd.handler("x", ctx);
    ASSERT step 4b ran: a control entry was persisted + the in-memory snapshot was set.
      const ctrl=entries.find(e=>e.type==="custom" && e.customType==="mulligan:revert-checkpoint");
      expect(ctrl).toBeTruthy(); expect(ctrl.data.label).toBe("ckpt:x");
      const ckpt0=rt.snapshots.get("ckpt:x"); expect(ckpt0).toBeTruthy(); expect(ckpt0.backend).toBe("git");
      const R0=ckpt0.beforeRef;   // the pre-checkpoint ref (S0 = a.ts="A0")
    ASSERT the checkpoint label is active (getLabel latest-wins — CRITICAL #6):
      const labelEntries=entries.filter(e=>e.type==="label"); expect(labelEntries.some(e=>e.label==="mulligan:checkpoint:x")).toBe(true);
  - (b) CAPTURE turn_start (REAL hook — beforeRef for the pre-reload last_turn revert):
      await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()}, ctx);
      expect(rt.snapshots.get("turn")?.beforeRef).toBe("turn");
  - (c) MUTATE (the span the pre-reload rewind will revert):
      writeFileSync(aPath,"A1\n");
  - (d) CAPTURE agent_end (REAL hook — afterRef; dirty guard will compare working tree vs this → match → PROCEED):
      await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx);
      expect(rt.snapshots.get("turn")?.afterRef).toBe("turn-after");
  - (e) "REWIND WITH REVERT" (last_turn — CRITICAL #8: clean revert via real afterRef): build a span whose
    after-last-user section includes the write toolCall (so ledger.modifiedFiles=[a.ts] feeds dirtyCheck, which
    matches afterRef → PROCEED). RE-BUILD ctx.contextEntries to reflect THIS rewind's session view. NOTE: the
    rewind reads ctx.sessionManager.buildContextEntries(); makeSessionCtx returns it bound to the SAME `entries`.
    For the ledger to include the write, the write toolCall must be a message in the span. Push the span messages
    into `entries` (they are the "session" the rewind sees):
      entries.push(msgEntry(user("do it")));          // a 2nd user prompt → last_turn rewinds after it
      entries.push(msgEntry(asstWrite("w1","a.ts"))); entries.push(msgEntry(result("w1")));
      const rwTool=makeRewindTool(pi);
      const res1=await rwTool.execute("rw1", {note:VALID_NOTE, granularity:"last_turn",
        revert_file_changes:true}, undefined, undefined, ctx);
      expect(firstText(res1)).toContain("Reverted");
      expect(readFileSync(aPath,"utf8")).toBe("A0\n");   // pre-reload last_turn revert restored to turn-start
      const rw1=entries.find(e=>e.type==="custom"&&e.customType==="mulligan:rewind"); expect(rw1).toBeTruthy();
      expect(rw1.data.revert?.backend).toBe("git");      // marker1.revert persisted (the "already-issued rewind")
  - (f) MUTATE AGAIN post-revert (so the post-reload checkpoint revert is MEANINGFUL):
      writeFileSync(aPath,"A2-postreload\n");
  - (g) SIMULATE /resume (CRITICAL #2/#14): tear down the runtime + re-create the store + rebuild snapshots.
      resetRuntime(sid);                                // wipes the in-memory snapshots Map (fresh empty Map)
      const rt2=getRuntime(sid);                         // fresh runtime, store undefined, snapshots empty
      rt2.store=await detectAndCreate(repoDir, getConfig().revert);  // NEW store, SAME storageDir → reads same refs
      await gcTurnSnapshots(rt2);                        // clears turn/* (ckpt:x preserved — CRITICAL #7)
    ASSERT the on-disk ckpt ref SURVIVED (the core of E32):
      expect(await rt2.store.has(R0)).toBe(true);       // CRITICAL #7: ref durable across re-detection
    REBUILD rt2.snapshots from the persisted control entries (the read-side production does NOT perform — CRITICAL #2):
      for(const e of entries){ if(e.type==="custom" && e.customType==="mulligan:revert-checkpoint"){
        rt2.snapshots.set(e.data.label, { label:e.data.label, backend:e.data.backend,
          beforeRef:e.data.ref, turnIndex:-1, ts:Date.now() } as RevertCheckpoint); } }
      expect(rt2.snapshots.get("ckpt:x")?.beforeRef).toBe(R0);   // rebuilt Map carries the same ref
  - (h) "REWIND-TO-CHECKPOINT WITH REVERT" (granularity:checkpoint — CRITICAL #3: span has NO file toolCalls →
    dirty guard skipped → PROCEED → restore(R0)). Build a span with NO write/edit toolCalls in the checkpoint→now
    range (so ledger.modifiedFiles=[] → affectedPaths=[] → dirtyCheck([])→[] → PROCEED). Push plain text msgs:
      entries.push(msgEntry(user("resume and reconsider")));   // a 3rd user prompt (checkpoint rewind target)
      const res2=await rwTool.execute("rw2", {note:VALID_NOTE, granularity:"checkpoint", checkpoint:"x",
        revert_file_changes:true}, undefined, undefined, ctx);
    ASSERT the durable ref was HONORED + files RESTORED post-reload:
      expect(firstText(res2)).toContain("Reverted");
      expect(readFileSync(aPath,"utf8")).toBe("A0\n");          // A2-postreload → A0 (restored post-reload)
      const rw2=entries.filter(e=>e.type==="custom"&&e.customType==="mulligan:rewind").at(-1);
      expect(rw2.data.revert?.backend).toBe("git");
      expect(rw2.data.revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));
  - CLEANUP: track repoDir + storageDir in dirs[] for afterEach.

Task 4: VALIDATE (see Validation Loop) — run JUST the new file, then the full suite, then typecheck.
```

### Implementation Patterns & Key Details

```typescript
// (1) The richer shared-session ctx for F-revert-reload (CRITICAL #4/#6). pi + ctx share ONE `entries` array;
//     getLabel is latest-wins; appendEntry stamps a stable id. The array PERSISTS across the /resume simulation.
function makeSessionCtx({sessionId, seedEntries}) {
  const entries = [...seedEntries];
  const pi = {
    appendEntry(customType, data){ entries.push({type:"custom", id:`e-${entries.length}`, customType, data}); },
    sendMessage(_m, _o){ /* unused */ },
    setLabel(targetId, label){ entries.push({type:"label", targetId, label}); },
  };
  const sessionManager = {
    getSessionId(){ return sessionId; },
    getLeafId(){ return `e-${entries.length-1}`; },
    getEntries(){ return entries; },
    getBranch(){ return entries; },
    buildContextEntries(){ return entries; },
    getLabel(id){ let cur=undefined; for(const e of entries){ if(e.type==="label"&&e.targetId===id) cur=e.label; } return cur; },
  };
  return { pi: pi as unknown as ExtensionAPI, ctx: {sessionManager, hasUI:false} as unknown as ExtensionContext, entries };
}

// (2) The /resume simulation (CRITICAL #2/#14). Mirrors index.ts session_start (resetRuntime + detectAndCreate +
//     gcTurnSnapshots) PLUS the rebuild-from-control-entries that production does NOT perform.
async function simulateResume(sid, repoDir, entries) {
  resetRuntime(sid);
  const rt = getRuntime(sid);
  rt.store = await detectAndCreate(repoDir, getConfig().revert);   // SAME storageDir → SAME on-disk refs
  await gcTurnSnapshots(rt);                                       // turn/* cleared; ckpt:* preserved
  for (const e of entries) {                                        // THE missing read-side (simulated)
    if (e.type === "custom" && e.customType === "mulligan:revert-checkpoint") {
      rt.snapshots.set(e.data.label, { label:e.data.label, backend:e.data.backend,
        beforeRef:e.data.ref, turnIndex:-1, ts:Date.now() } as RevertCheckpoint);
    }
  }
  return rt;
}

// (3) The granularity-refusal assertion (CRITICAL #1). Branch 3 fires before store resolution; NO store needed.
//   firstText(res) ⊇ "File revert applies to last_turn/checkpoint granularity"; file UNCHANGED;
//   marker persisted; marker.data.revert === undefined.

// (4) The checkpoint-rewind dirty-guard bypass (CRITICAL #3). The checkpoint→now span has NO write/edit
//   toolCalls ⇒ ledger.modifiedFiles === [] ⇒ affectedPaths === [] ⇒ dirtyCheck([]) → [] ⇒ PROCEED ⇒
//   store.restore(R0) restores the directly-mutated file. (The dirty-guard-REFUSES behavior is S2's domain.)
```

### Integration Points

```yaml
NO production-source changes. This is a test-only item.
- file added: test/integration/revert-edge.test.ts
- picked up by: "npm test" (vitest run) — test/integration/*.test.ts is inside the default glob
- typecheck: "npm run typecheck" (tsc --noEmit) — tsconfig includes ["src","test"]
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating the file — fix before proceeding.
npm run typecheck          # tsc --noEmit (zero errors). The .js import paths + the ExtensionAPI/
                            # ExtensionContext casts + the RevertCheckpoint cast + the makeSessionCtx shape
                            # must type-check. The it.skip dynamic dispatch (`(hasGit ? it : it.skip)(...)`)
                            # must type-check against vitest's It type.
# (No separate linter configured — typecheck + vitest are the gates.)
```

### Level 2: Unit/Integration Tests (the deliverable itself)

```bash
# Run JUST the new file (fast feedback while iterating).
npx vitest run test/integration/revert-edge.test.ts

# Expected: 2 scenarios pass (F-revert-granularity always; F-revert-reload when git is present,
#   else it is reported skipped). If F-revert-granularity fails: confirm config.revert.enabled===true +
#   granularity==="last_tool_call_group" + revert_file_changes===true (branch 3), and that firstText
#   carries the mismatch notice. If F-revert-reload fails: check, in order — (a) step 4b persisted the
#   control entry (entries has mulligan:revert-checkpoint); (b) getLabel is latest-wins (checkpointExists
#   true at the checkpoint rewind); (c) the checkpoint-rewind span has NO write/edit toolCalls (else
#   dirtyCheck refuses — CRITICAL #3); (d) rt2.store.has(R0)===true post-reload (CRITICAL #7).
```

### Level 3: Full Suite (no regressions)

```bash
# The whole suite must stay green (the new file must not break sibling tests — no shared-state leak).
npm test                   # vitest run (all test/**/*.test.ts + test/*.test.ts)
# Expected: all green, including the new integration file + the S1 revert-git.test.ts + S2 revert-cas.test.ts
# siblings. clearAll()+setConfig(undefined) in beforeEach/afterEach prevents runtime/config leakage.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the reload actually tore down + re-created the store (not the same object). A quick sanity probe
# (optional, not a gate): after simulateResume, assert rt2.store !== store (a NEW store at the same storage).
# Confirm git is available (universally true on Linux/macOS CI; the F-revert-reload scenario uses it):
command -v git && git --version

# Confirm the ckpt shadow ref is GC-exempt (optional manual probe — proves CRITICAL #7 on disk):
# After the full F-revert-reload run, the shadow repo at <storageDir>/<shadowKey>/ holds
# refs/mulligan/snapshots/checkpoint/x (NOT deleted by the prompt-boundary GC).
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npx vitest run test/integration/revert-edge.test.ts` — F-revert-granularity passes; F-revert-reload passes (or skips when git is absent).
- [ ] `npm test` — full suite green (no regressions, no shared-state leak, no conflict with the S1/S2 siblings).

### Feature Validation
- [ ] **F-revert-granularity**: `firstText(res)` contains `"File revert applies to last_turn/checkpoint granularity"`;
      the mutated file is UNCHANGED (still `"A1-mutated\n"`); a `mulligan:rewind` marker is in `pi.appended`
      (context rewind happened); `marker.data.revert === undefined` (branch 3 never assigns a revert block).
- [ ] **F-revert-reload**: step 4b persisted a `mulligan:revert-checkpoint` control entry (`{label:"ckpt:x",ref,backend}`);
      the pre-reload `last_turn` rewind-with-revert restored `a.ts` to `"A0\n"` + persisted `marker.data.revert.backend==="git"`;
      after `simulateResume`, `rt2.store.has(R0)===true` (durable ref — CRITICAL #7) AND `rt2.snapshots.get("ckpt:x").beforeRef===R0`
      (rebuilt Map — CRITICAL #2); the post-reload `rewind-to-checkpoint` with revert restored `a.ts` from `"A2-postreload\n"`
      to `"A0\n"` (files restored post-reload); the checkpoint marker's `data.revert.backend==="git"` + `revertedFiles ⊇ ["a.ts"]`.

### Code Quality Validation
- [ ] Follows existing test idioms: vitest, hand-rolled makePi/makeCtx/makeSessionCtx (no vi.fn), `.js` imports,
      `clearAll()` + `setConfig(undefined)` before/after each, real files via writeFileSync, real `git` via promisified execFile.
- [ ] Reuses the rewind.test.ts/revert-git.test.ts fake/helper SHAPES verbatim (makePi/makeCtx/msgEntry/asst/asstWrite/
      user/result/run/firstText/VALID_NOTE + git/makeRepo/makeStorage/gitAvailable) — does NOT reimplement the tool,
      the store, the checkpoint command, or the capture hooks.
- [ ] Temp dirs cleaned up in afterEach (rmSync force). storageDir is a SEPARATE mkdtemp (never inside repoDir).
- [ ] F-revert-granularity does NOT instantiate a store (it is unneeded — branch 3 fires first).
- [ ] F-revert-reload's checkpoint-rewind span has NO file-mutating toolCalls (so the dirty guard is skipped — CRITICAL #3),
      NOT asserting a refusedFiles bucket.
- [ ] Documents (top-of-file comment) the two spec/impl divergences these tests navigate: (a) the reload re-read is
      simulated (production write-side exists, read-side does not — CRITICAL #2); (b) the checkpoint dirty-guard tension
      is bypassed via an empty-modifiedFiles span (CRITICAL #3), isolating durability from the dirty-guard-refuses behavior.

### Documentation & Deployment
- [ ] No production-source changes (test-only item — DOCS: none per the contract).
- [ ] The file's top-of-file comment cites spec/10 §2.1 + spec/08 E32 + spec/14 §6/§7 + the scenario names + the
      critical findings (granularity branch 3 fires first; reload re-read simulated; checkpoint dirty-guard bypassed
      via empty modifiedFiles; richer shared-backing-array ctx; ckpt:* GC-exempt + survives re-detection).

---

## Anti-Patterns to Avoid

- ❌ Don't reimplement the rewind tool, the store, the checkpoint command, the capture hooks, or the reload
  rebuild logic in PRODUCTION source — this is a test-only item. The rebuild runs IN THE TEST (CRITICAL #2).
- ❌ Don't instantiate a store / temp git repo for F-revert-granularity — it is unnecessary (branch 3 fires
  before store resolution). A plain non-git temp dir + one mutated file proves "revert IGNORED".
- ❌ Don't make F-revert-granularity's checkpoint-rewind span mutate files via toolCalls (there is no checkpoint
  there) — and don't expect the file to be restored at group granularity (it is NOT; branch 3 skips restore).
- ❌ Don't use the simple `makeCtx` (getEntries→[], getLabel→undefined) for F-revert-reload — `checkpointExists`
  would return false and the checkpoint rewind would REFUSE at step 3. Use `makeSessionCtx` with a shared backing
  `entries` array + latest-wins `getLabel` (CRITICAL #4/#6).
- ❌ Don't forget to seed `makeSessionCtx` with a real user→assistant message BEFORE calling `makeCheckpointCommand`
  — `setCheckpoint` anchors on the last real message in `getBranch()` (BUG-003 fix); an empty branch ⇒ step 4b
  never runs (CRITICAL #5).
- ❌ Don't give the F-revert-reload checkpoint-rewind span any `write`/`edit` toolCalls — `ledger.modifiedFiles`
  would be non-empty ⇒ `dirtyCheck(beforeRef, [mutated])` ⇒ working tree ≠ beforeRef ⇒ REFUSE (CRITICAL #3). Keep
  that span as plain user/assistant text; mutate the file via direct `writeFileSync` instead.
- ❌ Don't assert `marker.data.revert` on a REFUSE path — the refuse branch never assigns a revert block (S2
  FINDING #2). F-revert-reload's rewinds are PROCEED paths (restore ran) so `data.revert` IS present there;
  F-revert-granularity is a SKIP path so `data.revert === undefined` (assert undefined, not a bucket).
- ❌ Don't re-create the store with a DIFFERENT storageDir in `simulateResume` — the on-disk refs would be absent
  ⇒ `store.has(R0)===false`. Re-use the SAME `getConfig().revert` (same storageDir) so the new store reads the
  same shadow repo / CAS dir (CRITICAL #7).
- ❌ Don't place `storageDir` inside `repoDir` (config rejects inside-cwd storageDir → NoOpStore/backend "none").
- ❌ Don't forget `gitAvailable()` skip-guard for F-revert-reload (mirror S1) — git is universally present on
  Linux/macOS CI but the guard makes the suite robust (a skip, not a failure).
- ❌ Don't assign `rt.store` AFTER calling the capture hooks / checkpoint command — both self-gate on `rt.store`
  (undefined ⇒ no-op). Assign `rt.store = store` FIRST (CRITICAL: see the git.ts/cas.ts/commands.ts gate order).

---

## Confidence Score: 9/10

One-pass success is highly likely: every seam, fake shape (including the richer `makeSessionCtx`), assertion
target, and ALL FIVE critical findings (granularity branch 3 fires before store; reload re-read is simulated
because production never wired the read-side; checkpoint dirty-guard tension bypassed via an empty-modifiedFiles
span; richer shared-backing-array ctx with latest-wins getLabel; ckpt:* survives GC + re-detection) are pinned to
exact source references with copy-ready patterns. The two non-obvious properties this file pins — `revert_file_changes`
at group granularity is a no-op-with-notice (not a silent restore, not a whole-rewind refusal), and a checkpoint's
snapshot ref is durable across a real `resetRuntime` + `detectAndCreate` re-detection — are spelled out with the
precise assertion each scenario must make. The two spec/impl divergences (reload read-side missing; checkpoint
dirty-guard tension) are navigated exactly as S2 navigated its own divergence (assert the OBSERVABLE contract).
Residual risks: (a) git availability — mitigated by the skip-guard; (b) the exact `git restore` revertedFiles
reporting — trusted because S1's F-revert-git already asserts the same `revertedFiles ⊇ [...]` shape against the
same backend. No production code changes reduce blast radius to "does the new test file pass."