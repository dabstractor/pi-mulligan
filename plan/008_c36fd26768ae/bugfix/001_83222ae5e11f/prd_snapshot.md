# Bug Fix Requirements

## Overview
Tested the v1.2 working-tree-revert feature (Phases P1–P4 marked Complete; P5 planned) against spec/14-working-tree-revert.md, spec/05 §1 step 6b, spec/08 E27–E32, and spec/10 F-revert-* scenarios. The full existing suite (1277 tests) passes, but the integration tests only exercise degenerate/contrived paths and four real correctness defects slip through. I wrote three focused vitest reproductions (run from the project test dir, then removed) confirming each: (1) CRITICAL — checkpoint-granularity file revert is always refused when the span actually changed files (its only useful case), because the dirty-guard baseline falls back to beforeRef for checkpoints that have no afterRef; (2) MAJOR — E32 cross-reload for checkpoint snapshots is write-only (mulligan:revert-checkpoint is persisted but never read; session_start never rebuilds rt.snapshots); (3) MAJOR — explicit-paths non-git mode is non-functional (no tool_call hook feeds write/edit paths, so every capture writes an empty manifest); (4) MAJOR — the dirty guard's affected set uses the heuristic ledger (ledger.modifiedFiles) instead of the spec-mandated snapshot diff, so bash/python/perl-modified files are reverted by restore but never guarded by dirtyCheck — an E30 silent-clobber of concurrent human edits (confirmed: a human edit to a python-written file was overwritten to the pre-turn content). Plus three minor issues: the RestoreResult.skipped bucket is never populated (E29 caps-degradation invisible), git capture's lastCommit chaining defeats prompt-boundary GC reclamation, and has() is not mutex-serialized per spec §4.3. Overall: the architecture is sound and the git/cas backends are substantially built, but the rewind-tool↔store integration has a wrong dirty-baseline for checkpoints, an incomplete cross-reload read path, a fully-missing explicit-paths capture hook, and an under-broad dirty-guard affected set — each of which silently breaks a documented guarantee or feature.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

### Issue 1: Checkpoint-granularity working-tree file revert is always refused when the span actually changed files (its only useful case)
**Severity**: Critical
**ID**: BUG-001
**Location**: src/tools/rewind.ts:848 (afterRef fallback `checkpoint.afterRef ?? checkpoint.beforeRef`)

**Description**:
The v1.2 `mulligan_rewind(granularity:"checkpoint", checkpoint:X, revert_file_changes:true)` file revert is unusable for its intended purpose. In rewind.ts step 6b the dirty-guard baseline is computed as `afterRef = checkpoint.afterRef ?? checkpoint.beforeRef`. Checkpoint snapshots (created by `/mulligan_checkpoint` step 4b) capture a SINGLE beforeRef and NEVER set an afterRef (checkpoints capture once). The fallback therefore uses beforeRef (the pre-checkpoint tree state) as the dirty baseline. dirtyCheck(beforeRef, affectedPaths) then compares the CURRENT tree (which the agent has modified between the checkpoint and the rewind) to the pre-checkpoint tree — and the agent's OWN intervening file work is detected as 'drift', so the guard REFUSES the whole file-revert every time. This violates spec/14 §6 step 3 ('if `afterRef` exists, run dirtyCheck(afterRef, affected)') — for checkpoints afterRef does NOT exist, so per spec the guard should be skipped or capture a just-in-time after-ref (= current tree); instead it incorrectly uses beforeRef. The only checkpoint-revert-with-files path that proceeds is the degenerate one where the span contains NO file tool calls (empty modifiedFiles → dirtyCheck gets [] → trivially clean), which means there is nothing to revert anyway. The shipped F-revert-reload integration test (test/integration/revert-edge.test.ts) only passes because it deliberately engineers that degenerate case (its own comment states: 'the rewind span MUST contain NO file toolCalls ... → PROCEED'). Net effect: the entire checkpoint-granularity file-revert feature — a headline v1.2 capability (spec/14 §1 granularity table, D11) — silently never restores files.

**Steps to Reproduce**:
1. git init a repo; commit a.ts = 'A0\n'. 2. setConfig({revert:{enabled:true,storageDir:<outside-repo>}}). 3. detectAndCreate → GitBackend; rt.store = store. 4. /mulligan_checkpoint x → rt.snapshots.get('ckpt:x') = {beforeRef:<commit>, afterRef:UNDEFINED}. 5. turn_start capture. 6. write a.ts = 'A1\n' (an assistant write toolCall to a.ts, so ledger.modifiedFiles=['a.ts']). 7. agent_end capture. 8. mulligan_rewind({note, granularity:'checkpoint', checkpoint:'x', revert_file_changes:true}). OBSERVED: result text = 'Mulligan: rewound checkpoint ... (file revert refused: 1 path(s) changed since the turn ended — not overwritten; re-request if intended)'; a.ts stays 'A1\n'. EXPECTED (spec/14 §6): a.ts reverted to 'A0\n'. (Confirmed via a vitest repro: file remained 'A1\n'.)


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: E32 cross-reload for checkpoint snapshots is write-only — session_start never rebuilds rt.snapshots from persisted mulligan:revert-checkpoint entries
**Severity**: Major
**ID**: BUG-002
**Location**: src/index.ts (session_start handler, ~lines 113-126: no read of mulligan:revert-checkpoint); write-only entry at src/commands.ts:226

**Description**:
spec/14 §5 / E32 ('post-reload snapshot loss → RESOLVED in v1.2') claims a /resume 're-reads the refs and the store still honors them' for checkpoints, backed by a persisted `mulligan:revert-checkpoint` control entry {label, ref, backend} written by /mulligan_checkpoint (src/commands.ts:226). However the READ side is missing: index.ts session_start (the only reload entry point) only calls detectAndCreate + gcTurnSnapshots — it NEVER scans getEntries() for `mulligan:revert-checkpoint` entries to repopulate rt.snapshots. A grep confirms `revert-checkpoint` appears ONLY at the write site (commands.ts:226) and in comments — there is no read site in production. After resetRuntime on session_start, rt.snapshots is a fresh empty Map, so rt.snapshots.get('ckpt:X') is undefined for every pre-existing checkpoint. A subsequent checkpoint-granularity rewind with revert_file_changes then hits the 'no working-tree snapshot for this boundary' branch (rewind.ts step 6b, branch 4) and skips the file revert (0 files reverted). The F-revert-reload test passes ONLY because it manually simulates the rebuild that production does not do — its own comment states verbatim: 'REBUILD rt2.snapshots from the persisted mulligan:revert-checkpoint control entries (production NEVER does this read-side — it is the gap E32 leaves)'. So E32 is not actually resolved in shipped code; checkpoint file-revert is broken across /resume.

**Steps to Reproduce**:
1. In a session with revert enabled, /mulligan_checkpoint x (writes mulligan:revert-checkpoint + sets rt.snapshots['ckpt:x']). 2. Capture, mutate a file, agent_end. 3. Simulate /resume: resetRuntime(sid) (as session_start does) + re-detectAndCreate on the same storage. 4. Observe rt.snapshots.get('ckpt:x') is now UNDEFINED (no production code rebuilds it). 5. mulligan_rewind(granularity:'checkpoint', checkpoint:'x', revert_file_changes:true) → result contains '(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)'; file is NOT restored. Contrast with the F-revert-reload test which manually re-populates rt.snapshots and then succeeds.

### Issue 2: explicit-paths non-git mode (revert.nonGitMode:'explicit-paths') is non-functional — capture always produces EMPTY manifests
**Severity**: Major
**ID**: BUG-003
**Location**: src/snapshot/cas.ts:465 (captureExplicitPaths loops `explicitPaths ?? []` — always empty); missing tool_call hook not registered in src/index.ts

**Description**:
spec/14 §4.2 specifies that 'explicit-paths' mode 'Snapshots only the explicit write/edit tool paths captured at tool_call time (the tool-call hook reads event.input.path and snapshots that path's current state before the tool runs).' The CasBackend supports this via capture(label, explicitPaths?) which delegates to captureExplicitPaths(label, explicitPaths). HOWEVER no such tool_call hook is registered anywhere: index.ts registers only `context`, `tool_result`, `turn_end`, `turn_start`, `agent_end`, and `session_start`/`session_shutdown`. Every capture() call site passes NO explicitPaths: capture.ts calls `rt.store.capture('turn')` and `rt.store.capture('turn-after')`; commands.ts calls `rt.store.capture('ckpt:'+name)`. So in explicit-paths mode captureExplicitPaths(label, undefined) iterates `explicitPaths ?? []` = [] and writes a manifest with an EMPTY files map. Consequently restore() iterates zero manifest entries and reverts/deletes nothing; the cas-mode-only tree-walk delete (gated on nonGitMode==='cas') is skipped. The entire `revert.nonGitMode:'explicit-paths'` option — a documented user-facing config knob (spec/14 §4.2, §8) — silently does nothing: snapshots are empty and file revert is a no-op. A grep for `explicitPaths` / `captureExplicitPaths` / `as CasBackend` outside cas.ts returns ZERO hits, confirming no caller ever feeds paths.

**Steps to Reproduce**:
1. A non-git temp dir with a.ts='A0\n'. 2. setConfig({revert:{enabled:true,storageDir,nonGitMode:'explicit-paths'}}). 3. detectAndCreate → CasBackend (backend 'cas'). 4. turn_start capture (calls capture('turn') with no explicitPaths). 5. mutate a.ts='A1\n'; agent_end capture. 6. store.restore(turnSnap.beforeRef, {revertFileChanges:true}). OBSERVED: RestoreResult = {reverted:[],deleted:[],failed:[],skipped:[],refused:[]}; a.ts stays 'A1\n'. EXPECTED (spec/14 §4.2): a.ts → 'A0\n'. (Confirmed via vitest repro.)

### Issue 3: Dirty guard's affected-set uses the heuristic ledger subset, not the snapshot diff — E30 'never silently clobber concurrent edits' is violated for bash/python/perl-modified files
**Severity**: Major
**ID**: BUG-004
**Location**: src/tools/rewind.ts:844 (affectedPaths = ledger.modifiedFiles); restore touches the broader set in src/snapshot/git.ts:~700 (diff --diff-filter=MD) and src/snapshot/cas.ts:~760 (manifest loop)

**Description**:
spec/14 §6 step 2 defines the dirty-guard affected set as 'paths that differ between beforeRef and the current tree (the files restore would touch)'. The implementation instead uses `affectedPaths = ledger.modifiedFiles` (rewind.ts:844), a HEURISTIC extraction from tool calls. The two sets diverge: restore() in BOTH backends reverts EVERY file differing from beforeRef (git.ts: `git diff --diff-filter=MD` after read-tree; cas.ts: every manifest entry + the cas-mode tree walk), but modifiedFiles only contains paths parseable from write/edit and a narrow set of bash file-mutating commands (sed/cp/mv/tee/redirect). Files modified via `python -c`, `node script.js`, `perl -i`, heredocs, `awk -i inplace`, etc. are NOT in modifiedFiles (they land in bashSideEffects). Therefore dirtyCheck(afterRef, affectedPaths) never inspects those files, returns [] (clean), and restore() proceeds to overwrite them — silently clobbering any human/external edit made to such a file between agent_end and the rewind. This is exactly the failure E30 / spec §6 step 3 / spec §3 guarantee #5 exist to prevent ('never silently clobbers concurrent edits'). The SnapshotStore CAN compute the real affected set (the git backend literally runs `git diff --name-only` in restore), so the limitation is self-imposed, not a real constraint. Confirmed at runtime: agent modified b.ts via `python -c "open('b.ts','w').write('agent-version')"`; human then edited b.ts to 'HUMAN-EDIT'; last_turn rewind with revert_file_changes produced 'Reverted 1 file(s)... 0 refused' and overwrote b.ts back to 'original', destroying the human edit.

**Steps to Reproduce**:
1. git repo; commit b.ts='original\n'. 2. revert enabled (git backend). 3. turn_start capture (beforeRef: b.ts=original). 4. agent runs a bash toolCall `python -c "open('b.ts','w').write('agent-version')"` (write b.ts='agent-version'); this command's path is NOT extracted into modifiedFiles — extractFileLedger returns modifiedFiles:[] / bashSideEffects:['python -c ...']). 5. agent_end capture (afterRef: b.ts=agent-version). 6. HUMAN edits b.ts='HUMAN-EDIT' (the E30 concurrent-edit scenario). 7. mulligan_rewind(granularity:'last_turn', revert_file_changes:true). OBSERVED: 'Reverted 1 file(s)... 0 refused'; b.ts → 'original' (HUMAN-EDIT destroyed). EXPECTED (E30): dirty guard refuses; b.ts stays 'HUMAN-EDIT'.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: RestoreResult.skipped bucket is never populated — E29 caps-degradation is invisible to the agent
**Severity**: Minor
**ID**: BUG-005
**Location**: src/snapshot/git.ts:650 (skipped:[] init, never pushed); src/snapshot/cas.ts:749 (skipped:[] init, never pushed)

**Description**:
spec/04 §3 defines the rewind marker's `revert.skipped: boolean` and spec/14 §6 RestoreResult documents the `skipped[]` bucket for 'E29 — file uncaptured because a cap (maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn) was hit'. Both backends initialize `result.skipped = []` but NEVER push to it (git.ts restore collects reverted/deleted/failed only; cas.ts restore likewise). Capture can write a PARTIAL manifest when maxTotalBytes is exceeded (cas.ts captureExplicitPaths/capture set `partial=true` but record only the captured files — uncaptured files simply are absent). On restore those absent files are silently not reverted (they are neither in reverted nor in skipped), the marker's `revert.skipped` is always `false`, and the success-text clause 'N skipped/failed' only ever counts failures. The agent thus receives no signal that a requested revert was incomplete due to caps — it believes the revert fully succeeded. (Bounded, best-effort by contract, so minor — but the E29 observability hook is non-functional.)

**Steps to Reproduce**:
Grep shows `result.skipped` is initialized to [] at src/snapshot/git.ts and src/snapshot/cas.ts and never reassigned/pushed. Drive a capture that exceeds maxTotalBytes (partial manifest) then restore: the success text reports '0 skipped/failed' even though files were uncaptured.

### Issue 2: GitBackend capture chains every commit via lastCommit parent, defeating prompt-boundary GC object reclamation (unbounded within-session storage growth)
**Severity**: Minor
**ID**: BUG-006
**Location**: src/snapshot/git.ts:366 (commitArgs.push('-p', this.lastCommit)) and :377 (this.lastCommit = commitSha) — never reset

**Description**:
spec/14 §5 states the prompt-boundary GC 'physically reclaims (git gc --auto --prune=now)'. However capture() (git.ts:366-377) uses `this.lastCommit` as a `-p <parent>` for commit-tree, so EVERY capture chains onto the previous one, and lastCommit is a per-backend field that is NEVER reset (not cleared by gc() or by turn boundaries). After gc() deletes the refs/mulligan/snapshots/turn/* refs, the turn commits remain REACHABLE via the parent chain of every subsequent commit-tree (each new commit's history includes all prior turn commits). git gc reclaims only UNreachable objects, so the deleted turn-snapshot commits (and their exclusive blobs) are never reclaimed for the rest of the session — contradicting the spec's 'physically reclaims' claim and causing unbounded within-session shadow-repo growth. Bounded by session_shutdown (which deletes the whole shadow dir), so minor, but the retention design described in spec §5 ('at each new prompt... reclaims prior turns') does not hold in practice.

**Steps to Reproduce**:
In a git repo with revert enabled: drive several turns (each turn_start → gc + capture). Inspect the shadow repo: `git -C <shadow> log --all --oneline` shows an unbroken commit chain spanning all turns; `git gc --auto --prune=now` followed by `git count-objects -v` shows turn commits/blobs NOT reclaimed across the prompt boundary because each new commit parents onto the previous via lastCommit.

### Issue 3: SnapshotStore.has() is not mutex-serialized, contrary to spec §4.3's 'ALL store operations' contract
**Severity**: Minor
**ID**: BUG-007
**Location**: src/snapshot/git.ts has() (~line 560) and src/snapshot/cas.ts has() (line 855) — neither acquires the mutex

**Description**:
spec/14 §4.3 states 'a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc)'. Both backends explicitly OMIT `has()` from the mutex (git.ts: `// NOT mutex-serialized`; cas.ts: same). While `has` is read-only, spec §4.3 also specifies the prompt-boundary GC pass 'ALSO acquires the mutex, so a git gc / CAS mark-sweep can never overlap an in-flight capture/restore/retire' — an unguarded `has()` invoked concurrently with gc()/destroy() can read the store mid-mutation (e.g. after gc deletes refs but before prune, or while destroy's fsRm is removing the shadow dir), returning transiently-inconsistent results. Low impact (has is best-effort and returns a boolean used only for cross-reload ref-honoring), but it is a deviation from the spec's serialization contract and a latent race. Marking minor.

**Steps to Reproduce**:
Static: both has() implementations lack `const release = await this.mutex.acquire()`. Concurrent has() + gc()/destroy() could observe a half-deleted shadow repo / manifest dir.

## Testing Summary
- Total bugs found: 7
- Critical: 1
- Major: 3
- Minor: 3

## Recommendations
- BUG-001 fix: when the resolved checkpoint has no afterRef (checkpoint-granularity), do NOT use beforeRef as the dirty baseline — either skip the dirty guard for checkpoints (spec §6 step 3 is conditional on afterRef existing) or capture a just-in-time after-ref (= current tree) so the guard is trivially satisfied for the agent's own committed work. Remove the `?? checkpoint.beforeRef` fallback at rewind.ts:848.
- BUG-002 fix: add a session_start pass that reads mulligan:revert-checkpoint control entries from getEntries() and rebuilds rt.snapshots (the rebuild the F-revert-reload test already simulates) so checkpoint snapshots survive /resume in production, not just in the test.
- BUG-003 fix: register a tool_call (or tool_start) hook that, when config.revert.enabled and the backend is CasBackend in explicit-paths mode, collects write/edit tool paths and feeds them to captureExplicitPaths (e.g. accumulate per-turn and pass at capture time), OR change explicit-paths capture to snapshot a recorded path set maintained across the turn.
- BUG-004 fix: derive the dirty-guard affected set from the store, not the ledger — add a SnapshotStore method (e.g. changedPaths(beforeRef)) that returns paths differing between beforeRef and the current tree (git: `git diff --name-only beforeRef`; cas: hash-compare the beforeRef manifest vs the current tree), and pass THAT to dirtyCheck. This closes the E30 gap for python/node/perl/heredoc-modified files.
- BUG-005: have both backends populate RestoreResult.skipped for files present at capture-time budget/cap exhaustion (record oversize/over-budget paths during capture and surface them on restore), so the marker.revert.skipped flag and the success text reflect E29 degradation.
- BUG-006: reset this.lastCommit at the turn boundary (or after gc()) so deleted turn-snapshot commits become unreachable and git gc can reclaim them; or drop the unconditional parent chaining.
- BUG-007: acquire the mutex inside has() in both backends to honor the spec §4.3 'ALL store operations' serialization contract.
- Strengthen the F-revert-* integration tests: F-revert-reload should exercise a checkpoint span that ACTUALLY contains file tool calls (the real use case), not the degenerate empty-modifiedFiles case; add an explicit-paths integration test; add an E30 dirty-guard test for a bash/python-modified file with a post-turn human edit.
