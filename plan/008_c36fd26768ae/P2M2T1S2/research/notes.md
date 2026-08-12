# Research Notes — P2.M2.T1.S2 (GitBackend dirtyCheck + restore + retire + has)

## State of the world (verified by reading actual files)

### S1 ALREADY SHIPPED `src/snapshot/git.ts` (18840 bytes, status "Implementing" but file is real)
`GitBackend` class — working `init()` + `capture()`; **4 THROWING STUBS** (dirtyCheck/restore/has/retire) at
the bottom of the class. S2 = replace those 4 stubs with real implementations.

Key S1 internals S2 builds on (read in full):
- **Private fields**: `cwd`, `cfg` (`MulliganConfig["revert"]`), `storageDir`, `sessionDir`, `mutex: AsyncMutex`,
  `exec: GitExec`, `scan`, `repoRoot!`, `sourceGitDir!`, `shadowDir!`, `lastCommit`, `capturesThisTurn`, `initPromise`.
- **`private shadowEnv()`** → `{ env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot }, maxBuffer: 16MB }`.
  EVERY write command goes through this helper (guarantees #1/#2 made mechanical).
- **`private ensureInit()`** → memoized: read-only `rev-parse --show-toplevel` / `--absolute-git-dir` (cwd, NO
  shadow env = guarantee #1) then `git init --bare` against shadow iff `!existsSync(shadowDir)`. Resets memo on failure.
- **Module-private `refForLabel(label)`** → `ckpt:<n>` ⇒ `refs/mulligan/snapshots/checkpoint/<n>`; else
  `refs/mulligan/snapshots/turn/<label>`. Shared contract with the P3 GC pass + retire.
- **`capture()` returns the COMMIT SHA** (trimmed `commit-tree` stdout), NOT the refname. → **THE critical S2
  reconciliation**: `has(ref)`/`retire(ref)` receive a SHA. `git update-ref -d <sha>` is INVALID (update-ref -d
  deletes a REFERENCE). S1's design note confirms: retire = **`for-each-ref --points-at <sha>` → refnames →
  `update-ref -d <refname>`**.
- **DI seam** `GitBackendDeps { exec?: GitExec; scan?: ... }`. Production omits → real impls. Tests inject
  recording fake. S2 ADDS `unlink?: (path)=>Promise<void>` (default fs/promises.unlink) — needed to unit-test
  restore's delete path without `vi.mock`.

### store.ts interface (S1 made it ASYNC — confirmed by test/store.test.ts expectTypeOf assertions)
- `describe(): {backend:"git"}` (sync); all 5 IO methods return Promise.
- `RestoreOpts = { revertFileChanges: boolean; deleteCreatedFiles: boolean }`.
- `RestoreResult = { reverted, deleted, failed, skipped, refused }` (all `string[]`).

### paths.ts exports S2 needs (add to git.ts imports)
- `resolveSafeWorkspacePath(root, rel): string` — THROWS on escape; used for the unlink target.
- `normalizeRelPath(root, abs): string` — POSIX rel.
- `isDangerousWorkspaceRel(rel): boolean` — true for NUL/absolute/trailing-sep/`..`/`.git`/`.pi`/`node_modules`.
- `DANGEROUS_DIRS = [".git",".pi","node_modules"]` (readonly) — for the ls-files `:!` pathspec.

### config defaults (src/config.ts lines 205–215)
- `allowDeleteCreatedFiles: false`
- `excludeGlobs: [".git","node_modules","dist","build",".next",".venv","target"]`

### test/git.test.ts (S1, 15547 bytes) — S2 MODIFIES this file
Idiom: `makeExec(calls)` recording fake pushes `{cmd,args,opts}`; `findCmd(calls,"add")`; `BASE_CFG`;
`emptyScan`; `expectedShadow(storageDir)`; line 292 `describe("GitBackend — S2 stubs throw")` block to REMOVE
once stubs are real. New blocks reuse `makeExec` + add an `unlink` fake.

## Design decisions pinned (resolve contract ambiguities)

1. **retire(SHA)** — `for-each-ref --points-at <sha> --format='%(refname)' refs/mulligan/snapshots/` [shadow]
   → for each refname: `update-ref -d <refname>` [shadow]. Best-effort, never throws.
2. **has(SHA)** — `rev-parse --verify <sha>` [shadow] exit0⇒true else false. ensureInit first. NO mutex
   (spec §4.3 omits has from the serialized list; it's a fast read-only existence check).
3. **dirtyCheck(afterRef, paths)** — null/empty afterRef ⇒ `[]`; empty paths ⇒ `[]`; else
   `git diff --name-only <afterRef> -- <paths>` [shadow] → stdout lines. Best-effort: on git error warn+`[]`
   (feature's overriding rule = "revert degradation never blocks the context rewind"; the refuse/allow call is
   rewindExecute's in P4, not here). Acquire mutex + ensureInit.
4. **restore(beforeRef, opts)** — reconcile: interface is `restore(beforeRef, opts)` (NO afterRef), so
   delete-created uses **PRD §6 "files present NOW but absent from beforeRef tree"** (≈ work-item's
   "afterRef-but-not-beforeRef" since the dirty guard refuses if worktree drifted from afterRef):
   - acquire mutex + ensureInit; result = 5 empty buckets; if neither flag set → return result.
   - `git read-tree <beforeRef>` [shadow] (shadow index only — NEVER source index). On failure → warn + return
     empty result (E27, never throws).
   - revert (if `revertFileChanges`): revert set = `git diff --name-only --diff-filter=MD` [shadow]
     (index=beforeRef vs worktree; M=modified, D=deleted-from-worktree). Per path (safety: normalizeRelPath +
     !isDangerousWorkspaceRel): `git checkout -- <path>` [shadow] → reverted[] / failed[] (per-path try/catch).
   - delete (if `deleteCreatedFiles && cfg.allowDeleteCreatedFiles`): created set =
     `git ls-files --others -- . :!<each excludeGlob> :!<each DANGEROUS_DIR>` [shadow] (the `:!` negations +
     per-path isDangerousWorkspaceRel are the TWO safety layers — without them node_modules would be listed and
     we'd unlink it). Per safe path: `unlink(resolveSafeWorkspacePath(repoRoot, path))` → deleted[] (ENOENT⇒skip)
     / failed[].
   - finally release.
5. **Five guarantees** — every command in all 4 methods carries `env.GIT_DIR=shadowDir` (via shadowEnv); the ONLY
   source-repo touch anywhere is ensureInit's read-only rev-parse. restore uses read-tree + checkout (NOT source
   index/refs). Test asserts no command's env.GIT_DIR === sourceGitDir.

## Validation commands (verified in package.json)
- `npm run typecheck` (tsc --noEmit)
- `npx vitest run test/git.test.ts` (the S2-modified file)
- `npm test` (full suite — must stay green; store.test.ts's git-branch detection STILL returns NoOpStore "none"
  until P3.M1.T2 wires detectAndCreate into index.ts, so no cross-file breakage expected)

## Confidence: 9/10 — S1 is real and read; the one genuine ambiguity (retire on a SHA) is resolved with the
## for-each-ref --points-at approach S1 itself anticipated; restore's no-afterRef gap is resolved by PRD §6.