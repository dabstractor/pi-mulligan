# Research Notes — P1.M5.T1.S1 (BUG-005: populate RestoreResult.skipped)

## The bug (one sentence)
Both backends init `result.skipped = []` in `restore()` and never push to it. The rewind layer is
already wired to consume `result.skipped` (success text + marker + count) — only the backends fail
to POPULATE it, so E29 caps-degradation is invisible to the agent.

## rewind.ts — ZERO changes needed (confirmed)
`src/tools/rewind.ts` already consumes `RestoreResult.skipped` in three places, all inside the
`doRestore` closure (step 6b):
- **L905** success-text clause: `` `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed,` ``
- **L889** marker block: `skipped: restoreResult.skipped.length > 0` (string[] → boolean)
- **L899** RewindDetails count: `skipped: restoreResult.skipped.length`

So once the backends push to `result.skipped`, the agent sees "N skipped/failed" > 0 and the marker's
`revert.skipped` flips to true automatically. **No rewind.ts edit.**

## RestoreResult contract (store.ts — read-only, unchanged)
`RestoreResult.skipped: string[]` — JSDoc: "E29 — file uncaptured because a cap
(maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn) was hit." Already declared; already in NoOpStore.
The bucket EXISTS; it is simply never written.

## CAS backend (src/snapshot/cas.ts)
- `CasManifest` type (L118-129): `{ version: 1; label; turnIndex; ts; files: Record<string,CasManifestEntry> }`.
  No `skipped` field. → ADD optional `skipped?: string[]`.
- `serializeManifest`/`parseManifest` (L138/151): `parseManifest` only checks `version === 1`. So an
  added optional field is backward-compatible (old manifests parse fine; `m.skipped` → undefined).
- `captureExplicitPaths` (L457-527): loops explicit paths; skips on `st.size > maxFileBytes` (L479,
  `continue`) and on `totalBytes + st.size > maxTotalBytes` (L486, `continue`). Both warn; neither
  records the rel. → track `const skipped: string[]=[]`, push `rel` on both, set `manifest.skipped`.
- `capture` (L551-635, whole-tree 'cas' mode): inside walkTree callback, skips on `maxFileBytes`
  (L579, `return`) and `maxTotalBytes` (L598, `return`). Neither records. → same tracking.
- `appendExplicitPath` (L693-740): incremental explicit-paths capture. Reads manifest, on oversize
  (L718) warns + `return` WITHOUT rewriting → oversize path lost. → push to `manifest.skipped` and
  rewrite manifest before returning.
- `restore` (L970-1065): reads manifest (L984-996), iterates `manifest.files`. Never reads skipped.
  → after parse, push `(manifest.skipped ?? [])` into `result.skipped`.
- DI seam: `this.fs: CasFs` (readFile/writeFile/mkdir/access/stat/readdir/unlink). test/cas.test.ts
  injects a recording fake; `makeTreeFs(cwd, storageDir, tree)` builds a fake fs from a TreeSpec.

## Git backend (src/snapshot/git.ts)
- Capture is ATOMIC: `totalBytes > maxTotalBytes` → ABORT → return null (L338-342) → no snapshot →
  restore never runs → skipped moot for the budget case. Oversize files → `:!` pathspec negation
  (L352) so they're absent from the tree, but the snapshot STILL succeeds (returns commitSha).
  → these oversize files ARE the git skipped set.
- `scanForCaps` returns `{ oversizePaths: string[]; totalBytes }` (workspace-relative POSIX paths).
- `capture` (L322-388): computes commitSha at L376, `update-ref` at L372, `this.lastCommit = commitSha`.
- `restore` (L702-790): early-return guard (L714) if neither flag; then `read-tree beforeRef` (L726);
  never knows about oversize.
- DI seam: `this.exec: GitExec` (recording fake in test/git.test.ts with `canned.stdoutByCmd`).
- fs imports (L1-10): ONLY `readdir/stat/unlink/rm` + `existsSync`. NO writeFile/readFile/mkdir.
  → a sidecar-JSON-file approach would need NEW fs imports + a new DI seam. **PREFER git notes.**

### Git-notes design (chosen)
Persist oversizePaths as a git NOTE on the commit, namespace `refs/mulligan/oversize`:
- capture (after update-ref, before `return commitSha`): if `oversizePaths.length > 0`,
  `git notes --ref=refs/mulligan/oversize add -f -m <JSON.stringify(oversizePaths)> <commitSha>`
  via `shadowEnv()`. Best-effort (own try/catch — a note failure must NOT fail capture).
- restore (after the early-return guard, before read-tree): best-effort
  `git notes --ref=refs/mulligan/oversize show <beforeRef>`; on exit 0 parse JSON string[] → push
  each to `result.skipped`; on non-zero (no note) swallow silently.

### Why notes over a sidecar JSON file
1. Goes through `this.exec` (existing DI seam) → unit-testable with `canned.stdoutByCmd:{notes:...}`.
   No new imports, no new DI surface.
2. Keyed by commit SHA = `beforeRef` → directly addressable in restore.
3. `destroy()` already does `fsRm(shadowDir)` → notes wiped at session_shutdown (no special cleanup).
4. Item description explicitly suggests "a ref note".

### Notes do NOT pin commits (verified reasoning)
A note is stored as a blob at path `=<commit-sha>` under `refs/notes/mulligan/oversize`. The path
names the SHA lexically; it is NOT a graph edge. `git gc --prune=now` reclaims an unreachable commit
even if a note names it (the note tree stays reachable, the commit doesn't). So this does NOT
exacerbate BUG-006. Orphaned notes accumulate under the notes ref (tiny JSON, bounded by session,
wiped by destroy) — acceptable for a best-effort/minor fix; gc note-pruning is out of scope.

## Test patterns (confirmed)
- test/git.test.ts: `makeExec(calls, canned)` + `makeBackend(calls, cfg, scan, canned)` +
  `findCmd`. `scan` fake returns canned `CapScan`. `canned.stdoutByCmd:{cmd:stdout}` for S2 cmds.
  Existing "skips oversize files via :! negation + still captures" (L265) is the base to extend.
- test/cas.test.ts: `makeBackend(fs?)` + `makeTreeFs(cwd, storageDir, tree)` + `makeTreeBackend`.
  Recording CasFs fake tracks writeFile/readFile/stat. `parseManifest(manifestBuffer)` to inspect
  the written manifest's `skipped` field. capture/restore describe at L370.
- Both: vitest, `.js` imports, no beforeEach (per-instance backends), `BASE_CFG` fixture.

## Scope boundaries (do NOT touch)
- rewind.ts (already consumes skipped — read-only).
- store.ts RestoreResult (already has skipped — read-only).
- gc() (BUG-006 owns lastCommit reset; orphaned-note cleanup out of scope here).
- has() mutex (BUG-007 owns that).
- No config / API / user-facing surface change (Mode A docs only).