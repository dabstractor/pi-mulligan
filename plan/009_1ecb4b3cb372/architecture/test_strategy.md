# Test Strategy & Code Inventory

## Test Architecture Overview
- **Tier 1 (Unit, pure helpers):** `test/paths.test.ts` — pure functions, no fs, no Pi. vitest.
- **Tier 1 (Unit, with DI seam):** `test/store.test.ts`, `test/git.test.ts` — use recording exec fakes
  and DI constructor args to isolate git/fs operations.
- **Tier 2 (Integration):** `test/integration/revert-{git,cas,explicit,edge}.test.ts` — real git repos,
  real temp dirs, real fs operations. These verify end-to-end behavior.

## File-by-File Change Inventory

### `src/snapshot/paths.ts` — ADD `isForbiddenRoot`
| What | Detail |
|------|--------|
| New export | `isForbiddenRoot(root: string): boolean` |
| New import | `import { homedir } from "node:os"`, add `dirname` to `node:path` import |
| Logic | `true` iff: root === `os.homedir()`, root === `/`, `dirname(root) === "/"` (depth-1 system dirs: `/home`, `/etc`, `/usr`, `/var`, …), root === `""` or root === `"."` |
| Purity | Pure string predicate, no fs, no Pi. Unit-testable in isolation. |
| JSDoc | Cite `@spec/14` §2 SAFETY INVARIANT + §10. State the exact predicate. |
| Existing code | UNCHANGED — `resolveSafeWorkspacePath`, `normalizeRelPath`, `isDangerousWorkspaceRel`, `DANGEROUS_DIRS` untouched. |

### `src/snapshot/store.ts` — REWRITE `detectAndCreate`
| What | Detail |
|------|--------|
| New imports | `realpathSync, existsSync` from `node:fs`; `join` from `node:path`; `isForbiddenRoot` from `./paths.js` |
| Remove | The `execFile("git", ["rev-parse", "--git-dir"], { cwd })` probe (line ~446). The `execFile` import may be removable if nothing else uses it — **CHECK**: `execFile` is used ONLY in `detectAndCreate`. After removal, the `execFile`/`promisify`/`execFileCb` imports become dead — remove them. |
| New logic | (1) `root = realpathSafe(cwd)` — wrapped try/catch, fail → NoOpStore; (2) `if (isForbiddenRoot(root)) → NoOpStore(reason)`; (3) `if (existsSync(join(root, ".git"))) → GitBackend(root, …)`; (4) else → CAS branch (unchanged); (5) pass `root` (canonical) to both constructors |
| Doc comments | Rewrite lines ~254, 263, 408, 437 — remove "read-only rev-parse"; state lexical `.git` check + forbidden-root gate + `realpath(cwd)`. Cite spec §2 Detection + SAFETY INVARIANT. |
| NoOpStore | UNCHANGED — the class itself is not modified; only how `detectAndCreate` constructs it changes. |
| AsyncMutex/SnapshotStore/RestoreResult/RestoreOpts | UNCHANGED. |

### `src/snapshot/git.ts` — REWRITE constructor + ensureInit + restore guard
| What | Detail |
|------|--------|
| New imports | `realpathSync` from `node:fs`; `isForbiddenRoot` from `./paths.js` |
| Constructor | `this.cwd = resolve(cwd)` → `this.cwd = realpathSafe(cwd)` (try/catch → fallback `resolve(cwd)`) |
| `sourceGitDir` field | **DELETE** the field declaration (lines ~215-217) AND all assignments |
| `ensureInit()` | DELETE the two `rev-parse` exec calls. Set `this.repoRoot = this.cwd` unconditionally. DELETE `this.sourceGitDir = gitDir`. Keep `this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` (now hashing realpath(cwd)). Keep the `git init --bare` idempotent block. |
| `shadowKey()` | Logic unchanged (still hashes the string). Doc comment: "keyed by `realpath(cwd)` (launch directory)" — drop "subdirectory launches share one shadow repo" rationale. |
| Class header (lines 37-51) | Guarantee #1: "No command of any kind — read or write — is ever issued against the user's git." Remove all mention of "read-only rev-parse against the source repo." Remove the "REPO-ROOT KEYING" section or rewrite it as "LAUNCH-DIRECTORY KEYING." |
| `restore()` | ADD forbidden-root guard at entry: after `mutex.acquire()`, before `ensureInit()`, check `isForbiddenRoot(this.cwd)` → return `{refused: [this.cwd], …empty}`. |
| `has()` | UNCHANGED — `rev-parse --verify` targets `shadowEnv()`. |
| `shadowEnv()`, `capture()`, `dirtyCheck()` | UNCHANGED in mechanism. |

### `src/snapshot/cas.ts` — Constructor realpath + restore guard
| What | Detail |
|------|--------|
| New imports | `realpathSync` from `node:fs`; `isForbiddenRoot` from `./paths.js` |
| Constructor | `this.cwd = resolve(cwd)` → `this.cwd = realpathSafe(cwd)` |
| `restore()` | ADD forbidden-root guard at entry: after `mutex.acquire()`, before manifest read, check `isForbiddenRoot(this.cwd)` → return `{refused: [this.cwd], …empty}`. |
| Everything else | UNCHANGED. |

### `test/paths.test.ts` — ADD `isForbiddenRoot` cases
- `os.homedir()` → `true`
- `"/"` → `true`
- `"/home"`, `"/etc"`, `"/usr"`, `"/var"` → `true` (depth-1)
- `"/home/user/projects/foo"` → `false`
- `""` → `true`; `"."` → `true`
- `"/home/dustin/myproject"` → `false` (depth ≥ 2, not home)

### `test/store.test.ts` — REWORK `detectAndCreate` describe block
- Replace rev-parse exit-code stubs with real temp dirs:
  - Temp dir WITH `.git` (create the file/dir) → `describe().backend === "git"`
  - Temp dir WITHOUT `.git` → `describe().backend === "cas"`
  - `detectAndCreate(os.homedir(), …)` → `backend === "none"` (forbidden)
  - `detectAndCreate("/", …)` → `backend === "none"` (forbidden)
  - Storage-unwritable → `none` (unchanged)
  - Subdir whose PARENT has `.git` but subdir itself does NOT → `cas` (proves no upward walk)
- Assert **no** `git rev-parse` call recorded by exec fake.

### `test/git.test.ts` — SUBSTANTIAL REWORK
1. Remove `rev-parse --show-toplevel`/`--absolute-git-dir` canned-stdout stubs from the exec fake.
2. Update `expectedShadow` to key by `realpath(cwd)`.
3. "Five guarantees" test (line ~232): assert **ZERO** commands run without the shadow env (was: "only rev-parse").
4. Add `restore()` forbidden-root test: construct backend with `cwd = os.homedir()`, call `restore(ref, …)`, assert `result.refused` non-empty + no `read-tree`/`checkout`/`unlink` recorded.

### `test/integration/revert-*.test.ts` — RUN UNCHANGED + ADD ONE ASSERTION
- `revert-git.test.ts`, `revert-cas.test.ts`, `revert-explicit.test.ts`, `revert-edge.test.ts` —
  these create real git/non-git dirs and assert `backend === "git"/"cas"`. With lexical `.git`
  detection they still pass. **Run them unchanged.**
- ADD to `revert-edge.test.ts`: `detectAndCreate(tmpSubdirUnderGitRepo, …)` → `cas` (subdir not promoted).

### `README.md` — Mode B safety paragraph
- Add a safety paragraph in the working-tree-revert section: workspace root is `realpath(cwd)` with
  no upward git discovery; home/system-root dirs are refused; no command of any kind issued against
  the user's `.git`.
- Stale-reference sweep: grep for "rev-parse", "show-toplevel", "sourceGitDir", "read-only rev-parse",
  "repo-root-keyed", "share one shadow repo" — confirm none survive outside the SAFETY INVARIANT text.