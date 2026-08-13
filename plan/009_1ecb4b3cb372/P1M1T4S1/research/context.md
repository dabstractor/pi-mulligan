# Research Notes — P1.M1.T4.S1 (cas.ts restore() guard + constructor realpath + test)

## Task
Mirror the P1.M1.T3.S2 git.ts forbidden-root restore() guard into `src/snapshot/cas.ts`,
PLUS add the constructor `realpathSafe` canonicalization (cas.ts's constructor currently uses bare
`resolve(cwd)` — NOT yet realpath'd, unlike git.ts which T3.S1 already converted). Add a focused
test block in `test/cas.test.ts`.

## Verified source facts (cas.ts — current state)

### Imports (lines 1–23)
- `node:fs/promises` (line 11): `readFile as fsReadFile`, `writeFile as fsWriteFile`, `mkdir as
  fsMkdir`, `access as fsAccess`, `stat as fsStat`, `readdir as fsReaddir`, `unlink as fsUnlink`,
  `rm as fsRm`.
- **DOES NOT import `node:fs`** (the SYNC module — `realpathSync`/`existsSync` live there). cas.ts
  only imports the promise-based `node:fs/promises`. → NEW import line needed for `realpathSync`.
- `node:path` (line 13): `{ join, resolve, dirname }`.
- `./store.js`: `{ AsyncMutex, SnapshotStore, RestoreOpts, RestoreResult }`.
- `./paths.js` (line 23): `{ normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath }`.
  → ADD `isForbiddenRoot` here (5th name).
- `../config.js`: `MulliganConfig` (type-only).

### Constructor (line 263)
`this.cwd = resolve(cwd);` ← CHANGE to `this.cwd = realpathSafe(cwd);`
- `cwd` field is `private readonly cwd: string`.
- Constructor ONLY throws when `storageDir` is null AND no sessionDir (NOT for forbidden cwd).
  With BASE_CFG (storageDir set), constructing `new CasBackend(homedir(), BASE_CFG, …)` succeeds.
- **No `ensureInit()`** in CasBackend (storageDir resolved in constructor; CasBackend has no shadow
  repo to lazily create). → restore()'s first fs op is `this.fs.readFile(this.manifestPath(beforeRef))`
  inside the `try`. The guard fires BEFORE that.

### restore() method (line 1004)
```
1004: async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
1005:   const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
1006:   const result: RestoreResult = { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
1007:   try {
1008:     if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result;
        ...
        const buf = await this.fs.readFile(this.manifestPath(beforeRef));  // first fs op
```
→ Guard inserts BETWEEN line 1005 (acquire) and line 1006 (const result), BEFORE the try block.
  Same placement as git.ts (T3.S2). release() must be called explicitly (try/finally not entered).

### restore() JSDoc (immediately above line 1004)
Currently cites `spec/14 §6 (restore semantics), §2 (the interface)`. Does NOT cite §2 SAFETY
INVARIANT. → ADD the §2 SAFETY INVARIANT sentence (Mode A docs ride WITH the work).

## realpathSafe template (from git.ts — module-private helper, line ~157)
```ts
function realpathSafe(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}
```
- Defense-in-depth: detectAndCreate ALREADY realpathSync's cwd before constructing CasBackend, so
  the production path's realpathSync never throws; the catch fallback exists for direct-test
  construction with a non-existent cwd (e.g. "/fake/cwd") AND `homedir()`/`/` which DO exist.
- For the test: `realpathSafe(homedir())` → realpathSync succeeds → `homedir()`.
  `realpathSafe("/")` → realpathSync succeeds → `/`. So `this.cwd === homedir()` / `"/"` exactly.

## Contracts consumed (COMPLETE — no logic to design, just wiring)
- `isForbiddenRoot(root: string): boolean` — from `./paths.js` (P1.M1.T1.S1, COMPLETE). PURE.
  True iff root is home / `/` / depth-1 (dirname==='/') / empty / dot. Assumes arg is ALREADY
  canonicalized (realpath). After constructor change, `this.cwd` IS canonical → sound.
- `RestoreResult` (store.ts 194–199): `{ reverted, deleted, failed, skipped, refused }` all
  `string[]`. `refused` is the E30 "whole op refused" bucket — reuse it (don't invent a new one).

## Test idiom (test/cas.test.ts — 2107 lines)
- vitest `describe`/`it`/`expect`/`vi`.
- `BASE_CFG` fixture (line ~36): `{ enabled, allowDeleteCreatedFiles:false, nonGitMode:"cas",
  storageDir:"/fake/store", maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
  excludeGlobs:[".git","node_modules"] }`.
- `makeBackend(fs?)` (line ~50): hardcodes `cwd="/fake/cwd"` (depth-2, NOT forbidden).
- `makeStateFs(cwd, storageDir, worktree)` + `makeStateBackend(state, cfgOverrides)`: mutable
  worktree fake for capture→restore round trips. Used by restore tests (describe at line 1279).
- `makeRecordingFs()` (inside storeBlob describe): records writeFile/access/mkdir calls — the
  recording-fake template for "assert X was/wasn't called".
- Direct construction idiom: `new CasBackend(cwd, cfg, null, { fs: fakeFs })`.
- restore describe block at line 1279 (`CasBackend.restore — spec/14 §6 + §2`).

### Test plan (3 cases — mirror git.ts T3.S2 shape, adapt to CasFs DI seam)
The DI seam is `this.fs` (CasFs), NOT `exec`. So "zero mutation" = `readFile`/`writeFile`/`unlink`
never invoked on the injected fake. Build a minimal RECORDING CasFs that tracks ALL method calls;
forbidden-root cases assert the call arrays are empty.
- (a) cwd = homedir() → restore → `refused:[home]`, other buckets `[]`, ZERO fs calls.
- (b) cwd = "/" → restore → `refused:["/"]`, ZERO fs calls.
- (c) negative control: cwd = "/fake/cwd" (via makeStateBackend, capture→mutate→restore) →
  `refused:[]`, restore proceeds (reverted non-empty). Proves guard is a transparent no-op.

## Validation commands (project = tsc + vitest only; NO eslint/ruff/biome)
- `npm run typecheck` (tsc --noEmit). Watch: "Cannot find name 'realpathSync'" (missed node:fs
  import), "Cannot find name 'isForbiddenRoot'" (missed paths.js destructure), "Cannot find name
  'homedir'" (missed test import).
- `npx vitest run test/cas.test.ts -t "forbidden-root entry guard"` — isolate the new block.
- `npm test` — full suite (cas.test.ts is self-consistent, unlike git.test.ts which has T3.S1
  transitional state; so the full file should be green).

## Scope guardrails (do NOT touch)
- git.ts restore guard → P1.M1.T3.S2 (the parallel sibling — assume COMPLETE).
- store.ts detectAndCreate → P1.M1.T2.S1.
- paths.ts isForbiddenRoot → P1.M1.T1.S1 (COMPLETE — consumed, not modified).
- README safety paragraph → P1.M2.T2.S1 (Mode B docs).
- integration tests → P1.M2.T1.S1.

## Gotchas (carry-over from git.ts T3.S2, adapted)
1. release() before return (try/finally not entered yet → leaked mutex deadlocks next op).
2. Guard fires BEFORE the manifest readFile → ZERO fs mutation (empty call log is the proof).
3. /fake/cwd (makeBackend/makeStateBackend default) is NOT forbidden → guard no-op (non-breaking).
4. Check `this.cwd` (constructor-set, always populated).
5. Construct CasBackend DIRECTLY for forbidden cwd (makeBackend hardcodes /fake/cwd).
6. Use DYNAMIC `homedir()` (varies per machine/CI) — never hardcode a home path.
7. restore() is best-effort (E27) → return refused RestoreResult, never throw.
8. Only restore() gets the guard (only method that WRITES user's worktree — revert/delete).
9. NEW node:fs import line needed for realpathSync (cas.ts imports only node:fs/promises today).