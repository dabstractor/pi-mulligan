# Research Findings — P5.M1.T1.S2 (F-revert-cas + F-revert-explicit + F-revert-dirtyguard)

Scope: three integration-test scenarios in ONE new file `test/integration/revert-cas.test.ts`.
Test-only — NO production-source changes. Consumes the COMPLETE v1.2 feature (P1–P4) shipped.

## Verified source seams (read, not reimplemented)

| Seam | File | Key fact |
|------|------|----------|
| `detectAndCreate(cwd, cfg, sessionDir?)` | src/snapshot/store.ts | non-git cwd → `git rev-parse --git-dir` FAILS → CasBackend via dyn-import. Returns `{backend:"cas"}`. storageDir MUST NOT resolve inside cwd (→ NoOpStore). |
| CasBackend `describe()` | src/snapshot/cas.ts | ALWAYS `{backend:"cas"}` (even in explicit-paths mode — the mode is a config knob, not a backend). |
| `capture(label, explicitPaths?)` | src/snapshot/cas.ts | `nonGitMode==="explicit-paths"` → `captureExplicitPaths(label, paths)` (ONLY those paths; bash paths NEVER captured). Else ('cas') → whole-tree walk. ref === label (the manifest filename). |
| `dirtyCheck(afterRef, paths)` | src/snapshot/cas.ts | re-hashes CURRENT file vs afterRef manifest entry; drifted ⇒ path in result. MISSING/corrupt afterRef ⇒ `[]` (allow). |
| `restore(beforeRef, opts)` | src/snapshot/cas.ts | manifest loop: existed:true + revertFileChanges ⇒ reverted[]; existed:false + deleteCreatedFiles && allowDeleteCreatedFiles ⇒ deleted[]. 'cas' mode ALSO tree-walk-deletes present-not-in-manifest. explicit-paths does NOT walk. NEVER throws (5 buckets). |
| `notifyBashUsed()` | src/snapshot/cas.ts | explicit-paths mode ⇒ `console.warn("...explicit-paths mode...")` ONCE per turn (latch `bashWarnedThisTurn`). 'cas' mode ⇒ no-op. PUBLIC (the tool_call hook casts to CasBackend). |
| `turnStartCaptureHandler` / `agentEndCaptureHandler` | src/capture.ts | turn_start: gc() then `store.capture("turn")` (NO explicitPaths) → rt.snapshots.get("turn").beforeRef. agent_end: `store.capture("turn-after")` (NO explicitPaths) → mutates .afterRef in place. BOTH self-gate on getConfig().revert.enabled AND rt.store. |
| `makeRewindTool(pi).execute(toolCallId, params, signal, onUpdate, ctx)` | src/tools/rewind.ts | step 6b: wantRevert → config/granularity/resolve gates → dirtyCheck(afterRef, ledger.modifiedFiles) → drifted>0 ⇒ REFUSE (revertClause text, revertBlock UNDEFINED) else store.restore(beforeRef) → fold RestoreResult into marker.revert + revertSummaryDetails. |

## ⚠️ CRITICAL FINDING #1 — there is NO `pi.on("tool_call",…)` hook

`rg` over src/ + test/ + index.ts: the registered handlers are `context`, `tool_result` (bloat), `turn_end` (metric), `turn_start` (capture), `agent_end` (capture), `session_start`, `session_shutdown`. **NO `tool_call` hook exists.**

CONSEQUENCE for **explicit-paths mode**: the real `turnStartCaptureHandler` calls `store.capture("turn")` with NO `explicitPaths` arg → `captureExplicitPaths("turn", undefined)` → **EMPTY manifest** (no paths). Same for agent_end → empty afterRef. An empty beforeRef means restore reverts NOTHING; an empty afterRef means dirtyCheck reports EVERY existing path as dirty (no baseline) → REFUSE. So explicit-paths is NOT exercised end-to-end by the real capture hooks today.

➡ **F-revert-explicit MUST drive capture DIRECTLY**: `rt.store.capture("turn", [write/edit paths])` + `rt.store.capture("turn-after", [write/edit paths])`, set `rt.snapshots` manually (mirroring what the hooks do), AND call `(store as CasBackend).notifyBashUsed()` for the warning. This simulates the (unwired) tool_call hook. cas.test.ts lines ~720-980 drive capture the SAME way (`cb.capture("turn", ["src/a.ts"])`).

## ⚠️ CRITICAL FINDING #2 — REFUSE branch does NOT populate `marker.revert.refusedFiles`

rewind.ts step 6b (~src/tools/rewind.ts:849-905):
```ts
const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
if (driftedPaths.length > 0) {
  revertRefused = true;
  revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`;
} else {
  // PROCEED — ONLY here is revertBlock assigned:
  const restoreResult = await store.restore(checkpoint.beforeRef, {...});
  revertBlock = { revertedFiles, deletedFiles, failedFiles, refusedFiles: restoreResult.refused, ... };
}
```
On REFUSE, `revertBlock` is NEVER assigned ⇒ the persisted `mulligan:rewind` marker has **NO `revert` field** (`rw.data.revert === undefined`). `store.restore` is never called, so the `RestoreResult.refused` bucket is never populated either.

The item description's literal assertion *"drifted path in revert.refusedFiles"* is **NOT satisfiable against the current implementation** (refusedFiles is only ever populated on the PROCEED branch by store.restore). The refusal is observable via: (a) the revertClause TEXT (firstText contains "refused"); (b) the file NOT being overwritten; (c) the rewind still persisting its marker (context rewind happened). spec/14 §6 step 3 says "Return refused[] naming the dirty paths" but the impl signals refusal via the clause text + an undefined revert block instead — a documented spec/impl divergence.

➡ **F-revert-dirtyguard MUST assert the OBSERVABLE refuse contract** (text + file-not-overwritten + context-rewind-happened + revert-block-absent), NOT `marker.revert.refusedFiles`. This is test-only-safe (no source change).

## Driving-pattern summary per scenario

| Scenario | Mode | Capture driven how | Hooks used | Key assertion |
|----------|------|--------------------|-----------|---------------|
| F-revert-cas | cas (default) | REAL hooks (turnStart + agentEnd) — whole-tree walk populates manifests | YES (real) | a.ts+b.ts+c.ts ALL reverted; backend "cas"; revertedFiles ⊇ all 3 |
| F-revert-explicit | explicit-paths | DIRECT `store.capture("turn",[a,b])` + `capture("turn-after",[a,b])` + manual rt.snapshots + `notifyBashUsed()` | NO (simulated tool_call hook) | a.ts+b.ts reverted; c.ts NOT reverted; warn once "explicit-paths"; backend "cas" |
| F-revert-dirtyguard | cas | REAL hooks; external edit AFTER agent_end | YES (real) | firstText "refused"; a.ts NOT overwritten (==external edit); marker persisted (context rewind); `rw.data.revert` undefined |

## Fakes/helpers to copy verbatim from test/tools/rewind.test.ts (also documented in the S1 PRP)

`makePi()` (captures appendEntry/sendMessage/setLabel), `makeCtx({sessionId,contextEntries})` (sessionManager.{getSessionId,getLeafId,getEntries,getLabel,getBranch,buildContextEntries}; NO getContextUsage), `msgEntry(message)`, `user(text)`, `asst(...callIds)`, `asstWrite(callId,file_path)`, `asstBash(callId,command)`, `result(callId)`, `run(pi,ctx,params,toolCallId)`, `firstText(res)`, `VALID_NOTE`.

`asstEdit(callId,file_path)` is NOT in rewind.test.ts — author the trivial analog of asstWrite with toolCall name `"edit"` (ledger.ts treats write+edit identically → both in modifiedFiles).

## sed / chmod / environment guards

- `sed -i` is universally available on Linux/macOS. Use `execFile("sed",["-i","s/C1/C2/",path])` (promisified). Fallback not needed on CI.
- No chmod needed for these 3 scenarios (failopen/delete are S1's domain). No root-guard needed.
- Temp dirs: mkdtempSync(tmpdir, prefix). Clean in afterEach (rmSync force). storageDir MUST be a SEPARATE mkdtemp (never inside repoDir — config rejects inside-cwd → NoOpStore).
- Non-git means NO `git init`. detectAndCreate detects non-git via `git rev-parse --git-dir` failing. (Optionally assert `!existsSync(join(repoDir,".git"))` to prove non-git-ness.)