# Bug Fix Analysis — Detailed Per-Bug Breakdown

## BUG-001 (Critical): Checkpoint dirty-guard baseline falls back to beforeRef

### Current Code Location
`src/tools/rewind.ts` — step 6b, the proceed branch:
```ts
// Line ~848
const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;
```

### Root Cause
Checkpoint snapshots (created by `/mulligan_checkpoint` via `src/commands.ts:~226`) capture a SINGLE
`beforeRef` and NEVER set `afterRef` (checkpoints capture once, unlike turns which capture at
turn_start + agent_end). The `?? checkpoint.beforeRef` fallback therefore uses the **pre-checkpoint
tree state** as the dirty baseline.

`dirtyCheck(beforeRef, affectedPaths)` then compares the CURRENT tree (which the agent has modified
between the checkpoint and the rewind) to the pre-checkpoint tree. The agent's OWN intervening file
work is detected as "drift", so the guard REFUSES the whole file-revert every time.

### Spec Violation
spec/14 §6 step 3: *"if `afterRef` exists, run dirtyCheck(afterRef, affected)"* — the guard is
CONDITIONAL on afterRef existing. For checkpoints it does NOT exist, so the guard should be skipped
(or a just-in-time after-ref captured = current tree → trivially clean).

### Fix Strategy
Remove the `?? checkpoint.beforeRef` fallback. When `checkpoint.afterRef` is undefined:
- **Option A (spec-literal):** Skip the dirty guard entirely (dirtyCheck never runs → no drift → proceed).
- **Option B (spec-consistent):** Capture a just-in-time after-ref (= current tree) via `store.capture("jit-after")`,
  then run `dirtyCheck(jitAfterRef, affectedPaths)` which is trivially satisfied (tree ≡ tree).

Option A is simpler and spec-literal. The just-in-time approach (Option B) adds I/O but preserves the
guard's future-proofing. **Recommendation: Option A** (skip the guard when afterRef is absent) — matches
spec §6 step 3's conditional ("if afterRef exists") and avoids extra capture I/O. This also aligns with
the mid-turn limitation documented in spec §6 step 3 and E30.

### Exact Change Site
In `src/tools/rewind.ts`, step 6b branch (5)+(6), replace:
```ts
const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;
const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
if (driftedPaths.length > 0) { ... REFUSE ... }
```
with:
```ts
// BUG-001 fix: skip the dirty guard when no afterRef exists (checkpoint granularity —
// checkpoints capture once, so there is no post-turn baseline to compare against).
const afterRef = checkpoint.afterRef;
if (afterRef) {
  const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
  if (driftedPaths.length > 0) { ... REFUSE ... }
  else { ... PROCEED (restore) ... }
} else {
  ... PROCEED (restore) — no afterRef ⇒ guard skipped (spec §6 step 3 conditional) ...
}
```

### Existing Test Impact
`test/integration/revert-edge.test.ts` F-revert-reload test (line ~18) has a comment stating:
*"the rewind span MUST contain NO file toolCalls (empty modifiedFiles → dirtyCheck→[] → PROCEED)"*.
This degenerate test must be strengthened to exercise a checkpoint span with ACTUAL file changes.

---

## BUG-002 (Major): E32 cross-reload checkpoint snapshots write-only

### Current Code Location
- **Write site:** `src/commands.ts:~226` — `pi.appendEntry("mulligan:revert-checkpoint", {label, ref, backend})`
- **Missing read site:** `src/index.ts` session_start handler (~lines 113-126) — no scan of `getEntries()` for `mulligan:revert-checkpoint` entries

### Root Cause
The `session_start` handler calls `resetRuntime(sid)` (which deletes the runtime → `rt.snapshots`
becomes a fresh empty Map) then `detectAndCreate` + `gcTurnSnapshots`, but NEVER scans
`getEntries()` for `mulligan:revert-checkpoint` entries to repopulate `rt.snapshots`.

After reset, `rt.snapshots.get("ckpt:X")` is `undefined` for every pre-existing checkpoint. A
subsequent checkpoint-granularity rewind hits the "no working-tree snapshot for this boundary"
branch (rewind.ts step 6b, branch 4) and skips the file revert (0 files reverted).

### Fix Strategy
Add a session_start pass (AFTER detectAndCreate, inside the `config.revert.enabled` block) that:
1. Scans `ctx.sessionManager.getEntries()` for entries with `customType === "mulligan:revert-checkpoint"`
2. For each, reconstructs a `RevertCheckpoint` from the persisted `{label, ref, backend}` data
3. Sets it in `rt.snapshots` via `rt.snapshots.set(label, {label, backend, beforeRef: ref, turnIndex: -1, ts: Date.now()})`
4. The `has(ref)` method can optionally verify the snapshot ref still exists in the store

### Exact Change Site
In `src/index.ts`, inside the `session_start` handler's `if (getConfig().revert.enabled)` block,
after `rt.store = await detectAndCreate(...)`, add the rebuild loop.

### Existing Test Impact
`test/integration/revert-edge.test.ts` F-revert-reload test (~line 600) manually simulates the rebuild
with a comment: *"REBUILD rt2.snapshots from the persisted mulligan:revert-checkpoint control entries
(production NEVER does this read-side — it is the gap E32 leaves)"*. This manual simulation must be
removed and replaced with a test that verifies the production rebuild path works.

---

## BUG-003 (Major): explicit-paths non-git mode non-functional

### Current Code Location
- `src/snapshot/cas.ts:~465` — `captureExplicitPaths(label, explicitPaths)` loops `explicitPaths ?? []` (always empty)
- Missing hook: `src/index.ts` does not register a `tool_call` handler
- `src/capture.ts` calls `rt.store.capture("turn")` with NO second `explicitPaths` arg

### Root Cause
The `CasBackend.capture(label, explicitPaths?)` accepts explicit paths for the `explicit-paths` mode,
but NO caller ever passes them:
- `capture.ts`: `rt.store.capture("turn")` — no explicitPaths
- `capture.ts`: `rt.store.capture("turn-after")` — no explicitPaths
- `commands.ts`: `rt.store.capture("ckpt:" + name)` — no explicitPaths

And no `tool_call` hook is registered to collect write/edit paths from tool events.

### Fix Strategy
1. **Create a tool_call hook** in `src/capture.ts` that:
   - Fires on `pi.on("tool_call", handler)` 
   - Checks `config.revert.enabled` and the backend is CasBackend with `nonGitMode === "explicit-paths"`
   - Extracts `event.input.path` from WriteToolCallEvent / EditToolCallEvent
   - Accumulates paths into the runtime (e.g., `rt.pendingExplicitPaths: string[]`)
   - Also calls `notifyBashUsed()` when a BashToolCallEvent fires (the once-per-turn bash warning)

2. **Thread the paths through capture** — modify `capture.ts` to pass `rt.pendingExplicitPaths` as
   the second arg to `rt.store.capture("turn")` and `rt.store.capture("turn-after")`

3. **Register the hook** in `src/index.ts` alongside the other capture hooks

4. **Clear the accumulator** at turn_start (in the GC pass or capture hook)

### Key Pi API Details
- `pi.on("tool_call", handler)` — fires BEFORE the tool runs (spec §4.2: "snapshots that path's current state before the tool runs")
- `WriteToolInput = { path: string, content: string }` → `event.input.path`
- `EditToolInput = { path: string, edits: [...] }` → `event.input.path`
- `isToolCallEventType("write"/"edit", event)` type guard available
- `ToolCallEvent` is a union: BashToolCallEvent | WriteToolCallEvent | EditToolCallEvent | ...

### Important: The tool_call event is typed as `ToolCallEvent` (not narrowed). The handler must
discriminate on `event.toolName === "write"` or `event.toolName === "edit"` and read `event.input.path`.

---

## BUG-004 (Major): Dirty guard affected-set uses heuristic ledger

### Current Code Location
`src/tools/rewind.ts:~844`:
```ts
const affectedPaths = ledger.modifiedFiles;
```

### Root Cause
`ledger.modifiedFiles` is a HEURISTIC extraction from tool calls (write/edit + parseable bash
commands like sed/cp/mv/tee). Files modified via `python -c`, `node script.js`, `perl -i`,
heredocs, `awk -i inplace`, etc. are NOT in `modifiedFiles` — they land in `ledger.bashSideEffects`.

But `restore()` reverts EVERY file differing from beforeRef (git: `git diff --diff-filter=MD`; cas:
every manifest entry + tree walk). So the dirty guard inspects a SUBSET of what restore touches,
leaving bash/python/perl-modified files unguarded — a concurrent human edit to such a file is silently
clobbered (E30 violation).

### Fix Strategy
Add a `changedPaths(beforeRef): Promise<string[]>` method to `SnapshotStore` that returns paths
differing between `beforeRef` and the current tree (the files restore WOULD touch):
- **GitBackend:** `git diff --name-only <beforeRef>` against the current working tree (shadow repo)
- **CasBackend:** hash-compare the beforeRef manifest entries vs current file hashes

Then in `rewind.ts`, replace `ledger.modifiedFiles` with `await store.changedPaths(checkpoint.beforeRef)`.

### Exact Change Sites
1. `src/snapshot/store.ts` — add `changedPaths(beforeRef: string): Promise<string[]>` to the interface + NoOpStore
2. `src/snapshot/git.ts` — implement: `git diff --name-only <beforeRef>` (shadowEnv, mutex-serialized)
3. `src/snapshot/cas.ts` — implement: load beforeRef manifest, for each entry compare current hash vs stored hash; also detect new files not in manifest
4. `src/tools/rewind.ts` — replace `const affectedPaths = ledger.modifiedFiles;` with `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`

### Interaction with BUG-001
BUG-001 changes the `afterRef` resolution; BUG-004 changes the `affectedPaths` source. Both modify
step 6b but at different lines. BUG-004's fix (P1.M4.T2.S1) depends on BUG-001's fix (P1.M1.T1.S1)
being applied first, since they touch the same code block.

---

## BUG-005 (Minor): RestoreResult.skipped bucket never populated

### Current Code Location
- `src/snapshot/git.ts:~650` — `skipped: []` initialized, never pushed to
- `src/snapshot/cas.ts:~749` — `skipped: []` initialized, never pushed to

### Root Cause
Both backends initialize `result.skipped = []` but never push to it. Capture can write a PARTIAL
manifest when caps are exceeded (git aborts → returns null; CAS continues file-by-file → partial).
On restore, uncaptured files are simply absent (neither in reverted nor in skipped), so the agent
receives no signal that a requested revert was incomplete due to caps (E29 invisible).

### Fix Strategy
This is inherently best-effort — the simplest viable approach:
- **CAS:** During captureExplicitPaths/capture, record paths that were SKIPPED due to maxFileBytes or
  maxTotalBytes in a sidecar (e.g., embed a `skipped[]` field in the manifest). On restore, read this
  field and populate `result.skipped`.
- **Git:** git capture is atomic (aborts on budget overrun → returns null → no snapshot at all).
  Oversize files are skipped via pathspec negation during capture but not recorded. For git, oversize
  files are simply not in the tree → not reverted. To populate skipped, record oversize paths during
  the caps pre-walk and persist them alongside the ref.

Given the "Minor" severity and best-effort nature, the simplest implementation is to track
oversize/over-budget paths during capture and persist them as metadata, then surface them on restore.

---

## BUG-006 (Minor): GitBackend lastCommit chains every commit, defeating GC

### Current Code Location
`src/snapshot/git.ts:~366` and `:377`:
```ts
if (this.lastCommit) commitArgs.push("-p", this.lastCommit);
// ...
this.lastCommit = commitSha;
```

### Root Cause
Every capture chains onto the previous via `-p <parent>`, and `lastCommit` is NEVER reset (not cleared
by gc() or turn boundaries). After gc() deletes `refs/mulligan/snapshots/turn/*` refs, the turn commits
remain REACHABLE via the parent chain of every subsequent commit-tree. `git gc` reclaims only
UNreachable objects, so deleted turn-snapshot commits are never reclaimed — contradicting spec §5's
"physically reclaims" claim and causing unbounded within-session shadow-repo growth.

### Fix Strategy
Reset `this.lastCommit = null` inside `gc()` (after the ref deletion + before/at gc) so the next
capture starts a fresh commit chain. Deleted turn-snapshot commits become unreachable and `git gc`
can reclaim them. This is a one-line addition in `gc()`.

Alternatively, drop the unconditional parent chaining entirely (capture without `-p`), but that loses
the commit history which may be useful for debugging.

---

## BUG-007 (Minor): has() not mutex-serialized

### Current Code Location
- `src/snapshot/git.ts` has() (~line 560) — comment: `// NOT mutex-serialized`
- `src/snapshot/cas.ts` has() (~line 855) — same

### Root Cause
Both backends explicitly omit `has()` from the mutex. While `has` is read-only, spec §4.3 specifies
the prompt-boundary GC "ALSO acquires the mutex, so a git gc / CAS mark-sweep can never overlap an
in-flight capture/restore/retire". An unguarded `has()` invoked concurrently with gc()/destroy() can
read the store mid-mutation (after gc deletes refs but before prune, or while destroy's fsRm runs).

### Fix Strategy
Add `const release = await this.mutex.acquire()` at the top of has() and `release()` in a finally
block, mirroring the pattern used by capture/dirtyCheck/restore/retire/gc/destroy.

---

## Integration with BUG-001 and BUG-004

Both BUG-001 and BUG-004 modify `rewind.ts` step 6b. The combined code after both fixes:

```ts
// BUG-004 fix: derive affected set from snapshot diff
const affectedPaths = await store.changedPaths(checkpoint.beforeRef);

// BUG-001 fix: only run dirty guard when afterRef exists
const afterRef = checkpoint.afterRef;
if (afterRef) {
  const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
  if (driftedPaths.length > 0) {
    revertRefused = true;
    revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed ...)`;
  } else {
    // PROCEED — restore
    const restoreResult = await store.restore(checkpoint.beforeRef, opts);
    // ... fold into text + marker ...
  }
} else {
  // No afterRef (checkpoint granularity) — skip dirty guard, proceed to restore
  const restoreResult = await store.restore(checkpoint.beforeRef, opts);
  // ... fold into text + marker ...
}
```