# P2.M2.T1.S1 — Key Research Decisions

## 1. THE sync/async resolution (most important finding)

### The tension
- `store.ts` (P2.M1.T1.S1 = Complete; P2.M1.T1.S2 = shipped) declares the `SnapshotStore`
  interface methods **synchronous** (`capture(label): string | null`, NOT `Promise<...>`).
  S1's PRP "GOTCHA #1" was emphatic: "METHOD SIGNATURES ARE SYNCHRONOUS."
- BUT the **work-item contract for THIS task** (P2.M2.T1.S1) says verbatim:
  `async capture(label: string): acquire mutex; run git add ...`. And: "Write unit tests: **mock execFile**,
  assert command construction." And the AsyncMutex (S1) `acquire()` returns `Promise<() => void>`.

### Why async is the only correct answer (3 independent signals)
1. **"acquire mutex" is impossible in a sync method.** `AsyncMutex.acquire()` returns a `Promise`.
   You cannot `await` it inside a function declared to return `string | null`. To honor the
   contract's "acquire mutex", capture() MUST be async.
2. **"mock execFile" (not execFileSync).** The work item envisions mocking the **promisified
   `execFile`** (`store.ts` already does `promisify(execFileCb)`). A sync backend would use
   `execFileSync` and the test instruction would say "mock execFileSync."
3. **Non-blocking I/O is a system requirement.** `git add --all -f` on a large repo is ~0.3–1.5s.
   A SYNC backend (`execFileSync`) freezes the ENTIRE Pi event loop (TUI, agent loop) at every
   turn boundary. The `CasBackend` (P2.M3, same interface) does whole-tree walks + hashing — sync
   would freeze for many seconds. Sync is unacceptable for an interactive TUI extension.

### Conclusion: the interface MUST be async; the S1/S2 "sync" was a downstream misinterpretation
The spec/14 §2 interface notation `capture(label): string | null` is **illustrative TypeScript
shorthand**, not a prescriptive ban on `Promise`. The actual backend tasks (this one + P2.M3)
require async. **This PRP includes a bounded, in-scope correction**: make the 5 IO-bearing
`SnapshotStore` methods return `Promise<...>` (describe() stays sync), update `NoOpStore` (S2) to
async no-ops, update `GitBackendCtor` to carry `sessionDir`, and update `test/store.test.ts`'s 5
`expectTypeOf` return-type assertions. ~20 lines across 2 files. Justified + documented in PRP Task 1.

## 2. Constructor signature (forward-compatible widening of S2's GitBackendCtor)

`constructor(cwd, revertConfig, sessionDir?, deps?: { exec?; scan? })`

- `sessionDir?` — REQUIRED for default `<sessionDir>/mulligan/` storageDir when `storageDir===null`
  (PRD §8). detectAndCreate's git branch must pass it (`new mod.GitBackend(cwd, revertConfig, sessionDir)`).
  Currently S2 calls `new mod.GitBackend(cwd, revertConfig)` — one-line alignment needed.
- `deps.exec?` / `deps.scan?` — DI test seams (default to real `promisify(execFile)` / real fs walk).
  Lets tests assert command construction without `vi.mock` (matches the repo's hand-rolled-fake idiom;
  `vi.mock` is also available per test/commands.test.ts but DI is cleaner for arg assertion).

Forward-compatible: optional params mean S2's existing call site still type-checks; the
`GitBackendCtor` cast is satisfied (a ctor `(a,b,c?,d?)` is assignable to `new (a,b): SnapshotStore`).

## 3. Key derivation — hash the REPO ROOT (not cwd)

PRD §3: "one shadow repo per source worktree — keyed by the **resolved repo root**, so subdirectory
launches share it." So `key = sha256(repoRoot).slice(0,16)`, where repoRoot comes from
`git rev-parse --show-toplevel` (resolved in init()). Falls back to resolved cwd if rev-parse fails.
16 hex = 64 bits → collision-safe for storage keys. `shadowDir = path.join(storageDir, key)`.

## 4. Ref naming (the GC/retire contract for downstream tasks)

`refForLabel(label)`:
- `ckpt:<name>` → `refs/mulligan/snapshots/checkpoint/<name>`  (GC-exempt, per §5)
- `turn` / `turn-after` → `refs/mulligan/snapshots/turn/<label>`  (deleted by prompt-boundary GC `turn/*`)

capture returns the **commitSha** (the opaque ref per store.ts JSDoc). retire (S2) resolves the ref
from a commitSha via `git for-each-ref refs/mulligan/snapshots --points-at <sha>` then `update-ref -d`.

## 5. init() is internal + lazy (not on the interface)

No `init()` on `SnapshotStore`. GitBackend exposes a private `ensureInit()` (memoized promise —
concurrent first-calls share one init) called at the top of capture/dirtyCheck/restore. Public
`async init()` also provided (work-item names it) delegating to ensureInit, for explicit use.
Idempotent: `git rev-parse --show-toplevel` → repoRoot; skip `git init --bare` if shadowDir exists.

## 6. Caps enforcement needs a pre-walk (scanForCaps)

git has no native per-file-size cap. `scanForCaps(repoRoot)` = async recursive walk (respecting
`excludeGlobs` + `DANGEROUS_DIRS` from paths.ts) returning `{oversizePaths, totalBytes}`. Oversize
files (> maxFileBytes) → pathspec negations (`:!path`) + console.warn. If `totalBytes >
maxTotalBytes` → return null (abort best-effort). `maxSnapshotsPerTurn` → counter checked in capture
(reset by lifecycle P3; S1 checks + increments). Cost: O(working-set) stats per capture — inherent
(both backends capture the whole set); acceptable at opt-in turn boundaries.

## 7. S2 methods (dirtyCheck/restore/has/retire) are THROWS in this PRP

`implements SnapshotStore` requires all 6 methods present to type-check. S1 implements
capture (init) fully; dirtyCheck/restore/has/retire are P2.M2.T1.S2. S1 ships them as async stubs
that `throw new Error("GitBackend.<m> not implemented — see P2.M2.T1.S2")`. Safe: detectAndCreate
isn't wired into index.ts until P3.M1.T2, which follows S2. Fail-loud placeholder, documented.

## 8. The git() helper + safety invariant (what tests assert)

All SHADOW write commands (add/write-tree/commit-tree/update-ref) run with
`env: {...process.env, GIT_DIR: shadowDir, GIT_WORK_TREE: repoRoot}`. The ONLY command against the
source repo is read-only `git rev-parse --show-toplevel` (cwd=this.cwd, NO GIT_DIR override). Tests
assert: for every write command, `env.GIT_DIR === shadowDir` (≠ sourceGitDir); rev-parse has no
shadow GIT_DIR. This IS guarantee #1 + #2 of the five git-safety guarantees (spec/14 §3).