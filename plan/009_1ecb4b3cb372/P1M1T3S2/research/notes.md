# Research Notes — P1.M1.T3.S2 (restore() forbidden-root entry guard in git.ts)

## 1. Current source state of `src/snapshot/git.ts` (VERIFIED — T3.S1 already landed)

T3.S1 (the parallel sibling) is ALREADY implemented in the source. Verified facts:

- **Imports** (lines 1–25): `realpathSync` is imported (line 10):
  `import { existsSync, realpathSync } from "node:fs";`
- **paths.js import** (lines 21–24) — the line T3.S2 EXTENDS:
  ```ts
  import {
    normalizeRelPath,
    isDangerousWorkspaceRel,
    resolveSafeWorkspacePath,
    DANGEROUS_DIRS,
  } from "./paths.js";
  ```
  → add `isForbiddenRoot` here. (T3.S1's GOTCHA #1 explicitly deferred this to T3.S2.)
- **`realpathSafe` helper** (line 157): MODULE-PRIVATE, exists:
  `function realpathSafe(cwd: string): string { try { return realpathSync(cwd); } catch { return resolve(cwd); } }`
- **Constructor** (line 256): `this.cwd = realpathSafe(cwd);` — canonicalized.
- **`ensureInit()`** (lines 302–316): sets `this.repoRoot = this.cwd;` (line 305) unconditionally. NO rev-parse. NO sourceGitDir. The git init --bare block is gated by existsSync.
- **`sourceGitDir`** — GREP RETURNS NOTHING (field fully removed by T3.S1).
- **`rev-parse --show-toplevel`/`--absolute-git-dir`** in live code — NONE in init (only `rev-parse --verify` in has() at line 576, which is correct + shadow-env'd).

## 2. `restore()` method — EXACT current structure (lines 720–868)

- **JSDoc** lines 720–751. Opens:
  `Write working-tree files FROM the beforeRef snapshot ... spec/14 §3 (the FIVE git-safety guarantees), §6 (restore semantics). Serialized by the mutex (spec §4.3).`
  Currently cites §3 + §6 + §4.3. **DOES NOT cite §2 SAFETY INVARIANT.** ← T3.S2 adds this.
- **Method signature + body** (lines 753–763):
  ```ts
  async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops   ← LINE 754
    const result: RestoreResult = {                                                ← LINE 755
      reverted: [],
      deleted: [],
      failed: [],
      skipped: [],
      refused: [],
    };
    try {                                                                          ← LINE 762
      await this.ensureInit();                                                     ← LINE 763
      ...
  ```
  → The guard inserts BETWEEN line 754 (mutex acquire) and line 755 (const result), per the contract:
  "immediately AFTER `const release = await this.mutex.acquire()` and BEFORE `this.ensureInit()`".
- **Recipe** (for context, UNCHANGED by T3.S2): read-tree → notes show (oversize) → diff/checkout (revert) → ls-files/unlink (delete). All shadow-env'd. Best-effort (E27): never rejects.
- **finally** (lines ~866–868): `release();` — the mutex release.

## 3. `RestoreResult` interface — `src/snapshot/store.ts` lines 194–200

```ts
export interface RestoreResult {
  reverted: string[];
  deleted: string[];
  failed: string[];
  skipped: string[];
  refused: string[];   // E30 — dirty-guard refuse (paths that drifted since agent_end)
}
```
T3.S2's guard ALSO uses `refused` (the offending root path), consistent with the contract's
`{ refused: [this.cwd], reverted: [], deleted: [], failed: [], skipped: [] }`. The `refused` bucket
is the semantically-correct home for "the whole op was refused" (mirrors E30's "the WHOLE file-revert
refused" semantics — here the whole op is refused because the root is forbidden).

## 4. Test conventions — `test/git.test.ts` (VERIFIED)

- **Imports** (lines 1–3): `vitest`, `createHash` from node:crypto, `GitBackend`/`GitExec`/`CapScan` from `../src/snapshot/git.js`, `MulliganConfig` type. **NO `node:os` import yet** → T3.S2 adds `import { homedir } from "node:os";` (for the dynamic home test case).
- **`type Call`** (lines 39–42): `{ file: string; args: string[]; opts?: { cwd?; env?; maxBuffer? } }`.
- **`makeExec(calls, canned)`** (line 65): recording fake. Pushes every invocation into `calls`. `canned.stdoutByCmd` overrides stdout by args[0]; `canned.throwOn` throws on Nth match. Unknown cmds → `{ stdout: "", stderr: "" }`.
- **`emptyScan`** (line 83): `async () => ({ oversizePaths: [], totalBytes: 0 })`.
- **`makeBackend(calls, cfg=BASE_CFG, scan=emptyScan, canned={})`** (line 89): constructs `new GitBackend("/fake/cwd", cfg, null, { exec, scan })`. **HARDCODES cwd="/fake/cwd"** (NOT forbidden — depth-2). So forbidden-root tests construct GitBackend DIRECTLY (mirroring the `describe()` test at line 764: `new GitBackend("/fake/cwd", BASE_CFG, null, { exec: makeExec([]), scan: emptyScan })`).
- **`makeBackendWithUnlink`** (line 102): same but with recording `unlink` fake.
- **`findCmd(calls, cmd)`** (line 115): `calls.find(c => c.args[0] === cmd)`.
- **`writeCalls(calls)`** (line 120): filters to init/add/write-tree/commit-tree/update-ref.
- **Existing restore describe block** (line 621): `"GitBackend.restore — working-tree only (spec/14 §3/§6)"`. Asserts reverted arrays, read-tree/checkout args + GIT_DIR===shadow, the 5 guarantees, per-path failures, empty-buckets-no-op.

### CRITICAL — transitional test-file state
The SOURCE (git.ts) is POST-T3.S1, but the TEST FILE (git.test.ts) is still PRE-T3.S1-rework:
`makeExec` still has the rev-parse stubs (lines 76–77), `expectedShadow` default is still `/fake/repo`,
GIT_WORK_TREE assertions still `/fake/repo`. This means the EXISTING git.test.ts is currently RED
(the source changed repoRoot to /fake/cwd but the tests still assert /fake/repo). T3.S1's rework
fixes this. **T3.S2's NEW test block is INDEPENDENT of that flip** (it never asserts GIT_DIR /
GIT_WORK_TREE / expectedShadow — only the refused result + empty calls log), so it is correct in
BOTH the transitional and final states. Validation must isolate T3.S2's block: `npx vitest run
test/git.test.ts -t "forbidden-root entry guard"`.

## 5. Key invariant — `"/fake/cwd"` is NOT forbidden
`isForbiddenRoot("/fake/cwd")` → depth-2, not home, not "/", dirname="/fake"≠"/" → **false**.
So the guard is a NO-OP for every existing restore test (all use makeBackend → "/fake/cwd"). Only
T3.S2's new tests (cwd=homedir(), cwd="/") exercise the guard. → ZERO risk of breaking existing tests.

## 6. `isForbiddenRoot` contract (from T1.S1, COMPLETE)
Exported from `./paths.js`. `(root: string) => boolean`. true iff: root===""||"."  ||  root==="/"
||  dirname(root)==="/"  ||  root===homedir(). For homedir(): realpathSafe(homedir())→realpathSync
succeeds→homedir() (real path). So `this.cwd===homedir()` and `isForbiddenRoot(this.cwd)`===true. ✓

## 7. Exact edit sites (all verified against current source)
1. `src/snapshot/git.ts` line 21–24 destructure: add `isForbiddenRoot`.
2. `src/snapshot/git.ts` restore() JSDoc (lines 722–724): add §2 SAFETY INVARIANT sentence.
3. `src/snapshot/git.ts` between line 754 and 755: insert the guard (4 lines: comment + if/release/return).
4. `test/git.test.ts` line 3 area: add `import { homedir } from "node:os";`.
5. `test/git.test.ts`: append new describe block (3 tests: home-refuse, /-refuse, negative-control).