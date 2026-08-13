# External Dependencies & Node.js APIs

## New APIs Required

### `fs.realpathSync(path)` — Node.js built-in
- **Where used:** `store.ts` (detectAndCreate canonicalization), `git.ts` (constructor defense-in-depth),
  `cas.ts` (constructor defense-in-depth).
- **Why:** Resolves symlinks to get the canonical absolute path. `path.resolve()` does NOT resolve
  symlinks — it only normalizes `.`/`..` segments lexically. The spec requires `realpath(cwd)` as
  the workspace root so a symlinked launch dir can't mask its true location.
- **Error handling:** Throws if the path does not exist or is unreadable. Must be wrapped in a
  try/catch that yields `NoOpStore` (fail-safe) — never propagates the throw to the caller.
- **Pattern:** A module-private `realpathSafe(cwd: string): string` helper:
  ```typescript
  function realpathSafe(cwd: string): string {
    try { return realpathSync(cwd); }
    catch { return resolve(cwd); } // fallback: lexical resolution (no symlink resolution)
  }
  ```
  In `store.ts`, failure should instead yield `NoOpStore` (distinct reason). In `git.ts`/`cas.ts`
  constructors, the fallback to `resolve(cwd)` is acceptable because `detectAndCreate` already
  canonicalized — the constructor's realpath is defense-in-depth for direct-test construction.

### `os.homedir()` — Node.js built-in
- **Where used:** `paths.ts` `isForbiddenRoot` predicate.
- **Why:** The user's home directory is the primary forbidden root — upward traversal resolved to it.
- **Nature:** Reads `$HOME` env var (POSIX) or `os.userInfo().homedir`. Pure read, not fs. Consistent
  with paths.ts's "no fs" constraint.
- **Import:** `import { homedir } from "node:os"`

### `path.dirname(path)` — Node.js built-in
- **Where used:** `paths.ts` `isForbiddenRoot` predicate.
- **Why:** Depth-1 system dirs have `dirname(root) === "/"` (e.g., `dirname("/home") === "/"`). This
  is the spec's "too shallow to be a real project" criterion.
- **Import:** Already imported in cas.ts; ADD to paths.ts's `node:path` import.

### `fs.existsSync(path)` — Node.js built-in
- **Where used:** `store.ts` detectAndCreate — the lexical `.git` check.
- **Why:** Replaces `git rev-parse --git-dir`. `existsSync(join(root, ".git"))` checks whether a `.git`
  entry (file or directory) exists lexically in `cwd`. No upward walk. The `.git` may be a file
  (worktree/submodule pointer) or a directory — `existsSync` covers both.
- **Already imported in:** `git.ts` (for the shadow dir `existsSync` gate). Must be added to `store.ts`.

## APIs Being Removed

### `execFile("git", ["rev-parse", "--git-dir"], ...)` — removed from store.ts
- Was the git-detection probe in `detectAndCreate`. Replaced by `existsSync(join(root, ".git"))`.

### `execFile("git", ["rev-parse", "--show-toplevel"], ...)` — removed from git.ts
- Was in `ensureInit()`. `repoRoot` is now `this.cwd` (= `realpath(cwd)`) unconditionally.

### `execFile("git", ["rev-parse", "--absolute-git-dir"], ...)` — removed from git.ts
- Was in `ensureInit()`. The `sourceGitDir` field it populated is being deleted.

## APIs Unchanged

### `git rev-parse --verify <ref>` in `has()` — KEPT (targets shadow repo)
- This runs against `shadowEnv()` (GIT_DIR=shadowDir), NOT the user's repo. It verifies a ref exists
  in the shadow repo. **No change.** This is the ONLY `rev-parse` that survives in `src/snapshot/`.

## Package Dependencies
- No new npm packages required. All APIs are Node.js built-ins.
- `vitest` is the test runner (already in devDependencies).

## Test Harness Patterns
- `test/git.test.ts` uses a **recording exec fake** (DI seam via `deps.exec`). The fake returns canned
  stdout for specific `git` subcommands. The rev-parse stubs must be removed; the assertion that
  rev-parse is "the only non-shadow command" must flip to "zero non-shadow commands."
- `test/store.test.ts` uses the same exec fake pattern to stub rev-parse exit codes for git vs cas
  selection. These must be reworked to use real temp dirs with/without `.git`.
- Integration tests (`test/integration/revert-*.test.ts`) create real git repos and real temp dirs.
  These run unchanged — lexical `.git` detection keeps them green.