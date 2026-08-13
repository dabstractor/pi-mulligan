# System Context — Detection Safety Hardening (Session 009)

## Base
v1.2 codebase (session 008 shipped the full working-tree-revert feature). This delta retrofits a
non-negotiable safety guard: remove all upward git repo discovery, enforce `realpath(cwd)` as the
workspace root, and add a defense-in-depth `restore()` guard.

## The Hazard Being Closed
Upward discovery (`git rev-parse --show-toplevel`) once resolved the workspace root to the user's
`$HOME` (home is not a git repo → `repoRoot = top || cwd` fell back to `cwd`, which was `$HOME`);
`restore()` then reverted/deleted the **entire home tree**. The fix is structural: workspace root is
**always** `realpath(cwd)` with **no upward traversal anywhere**, plus a forbidden-root refusal and a
`restore()`-entry re-check.

## Current Vulnerable Code Paths (Verified Against Working Tree)

### 1. `src/snapshot/store.ts` — `detectAndCreate()` (lines 437–481)
**Current git probe (VULNERABLE):**
```typescript
// Line ~446 — issues `git rev-parse --git-dir` against the user's repo
await execFile("git", ["rev-parse", "--git-dir"], { cwd });
```
- Exit 0 → constructs `GitBackend(cwd, revertConfig, sessionDir)` (passes raw `cwd`, NOT realpath).
- Doc comments at lines 254, 263, 408, 444 describe this as "the ONLY git command run against the
  user's repo here" — **these must be rewritten**.
- The outer try/catch (E28 fail-open) is preserved — `detectAndCreate` NEVER rejects.
- `NoOpStore` (line ~357) already has a `reason` string constructor arg — the forbidden-root reason
  slots in cleanly as `new NoOpStore("workspace root is forbidden...")`.
- `RestoreResult` interface (line 195): `{ reverted: string[]; deleted: string[]; failed: string[];
  skipped: string[]; refused: string[] }` — `refused` is `string[]`, confirmed.

**Imports at top of store.ts:** `execFile` (promisified), `access, mkdir, constants` from
`node:fs/promises`, `resolve, relative, isAbsolute` from `node:path`. Needs NEW imports:
`realpathSync, existsSync` from `node:fs`, `join` from `node:path`, `isForbiddenRoot` from `./paths.js`.
The `execFile` import can be removed entirely (no more `git rev-parse` in detectAndCreate).

**TARGET STATE:** `realpathSync(cwd)` → forbidden-root gate → `existsSync(join(root, ".git"))` →
GitBackend(root, ...) | CasBackend(root, ...) | NoOpStore. Pass canonical `root` to both constructors.

### 2. `src/snapshot/git.ts` — `GitBackend` (lines 200–300, 746+)
**Constructor (line ~235):** `this.cwd = resolve(cwd)` — `resolve` does NOT resolve symlinks.
Must become `this.cwd = realpathSafe(cwd)`.

**`sourceGitDir` field (lines 215–217):** `private sourceGitDir!: string;` — exists ONLY to record
the rev-parse result. **Must be removed entirely.** Nothing else writes to it.

**`ensureInit()` (lines 282–293) — VULNERABLE:**
```typescript
const top = (await this.exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd })).stdout.trim();
const gitDir = (await this.exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: this.cwd })).stdout.trim();
this.repoRoot = top || this.cwd; // ← THE HAZARD: top can resolve upward to $HOME or beyond
this.sourceGitDir = gitDir;
this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));
```

**TARGET STATE:** Delete both `rev-parse` calls. Set `this.repoRoot = this.cwd` (already canonical
via realpath in constructor). Remove `this.sourceGitDir = gitDir`. Keep the `git init --bare` block
(idempotent `existsSync` gate on `shadowDir`). No upward discovery, no `top || cwd` fallback.

**`shadowKey()` (lines 139–141):** `sha256(repoRoot).slice(0,16)` — function logic unchanged (still
hashes the root string), but `repoRoot` is now `realpath(cwd)`. Doc comment says "repo-root-keyed
so subdirectory launches SHARE one shadow repo" — **this rationale must be rewritten**: shadow repo
is now keyed by launch directory (`realpath(cwd)`), not a resolved repo root.

**Class header comment (lines 37–51) — Guarantee #1:**
Current: "No ref-moving or write command is ever issued against the USER's git. The ONLY command run
against the source repo is the READ-ONLY `git rev-parse --show-toplevel` / `--absolute-git-dir`..."
**TARGET:** "No command of any kind — read or write — is ever issued against the user's git."

**`restore()` entry (line ~746):** No root guard today. `async restore(beforeRef, opts)` acquires
mutex, creates result object, calls `this.ensureInit()`. **Must add forbidden-root check BEFORE
ensureInit / any fs mutation.**

**`shadowEnv()`:** Uses `GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot`. With repoRoot now =
realpath(cwd), GIT_WORK_TREE points at the launch dir. Unchanged mechanism, correct target.

**`has()`:** Uses `git rev-parse --verify <ref>` — targets `shadowEnv()`, NOT the user's repo. **Fine —
no change.**

**Imports at top of git.ts:** `existsSync` from `node:fs` (already imported), `join, resolve` from
`node:path`. Needs NEW: `realpathSync` from `node:fs`, `isForbiddenRoot` from `./paths.js`.

### 3. `src/snapshot/cas.ts` — `CasBackend` (lines 263, 1004+)
**Constructor (line ~263):** `this.cwd = resolve(cwd)` — same as git.ts, `resolve` does not resolve
symlinks. Must become `this.cwd = realpathSafe(cwd)`.

**`restore()` entry (line ~1004):** No root guard today. Same structure as git.ts: acquires mutex,
creates result, reads manifest. **Must add forbidden-root check before any fs write.**

**Imports at top of cas.ts:** Does NOT import `existsSync`. Uses `node:fs/promises` for async ops.
Needs NEW: `realpathSync` from `node:fs`, `isForbiddenRoot` from `./paths.js`.

### 4. `src/snapshot/paths.ts` — Pure helper module
**Current state:** Contains `resolveSafeWorkspacePath`, `normalizeRelPath`, `isDangerousWorkspaceRel`,
`DANGEROUS_DIRS`. Module header documents that the `fs.realpathSync` complement runs in the backends.
Only imports `node:path` (`resolve, relative, isAbsolute, sep`).

**No `isForbiddenRoot` exists** — must be added here. The module's documented intent (line 17, 45)
already references the "fs-layer `fs.realpathSync` complement running in the snapshot backends."

**TARGET:** Add `import { homedir } from "node:os"` and `dirname` from `node:path`. Add pure
`isForbiddenRoot(root: string): boolean` predicate. This is the ONLY new export; all existing
functions are unchanged.

## Files NOT Changed
- `src/snapshot/store.ts` interfaces (`SnapshotStore`, `RestoreOpts`, `RestoreResult`, `AsyncMutex`) —
  these are unchanged; only `detectAndCreate` and `NoOpStore` usage changes.
- `src/config.ts`, `src/index.ts`, tool registrations — **No Pi-surface change.** `ctx.cwd`, `pi.on`,
  etc. are unchanged.
- `src/snapshot/cas.ts` capture/retire/dirtyCheck/gc logic — unchanged in mechanism; only the
  constructor's `resolve→realpathSafe` and the restore guard change.
- `src/snapshot/git.ts` capture/dirtyCheck/has/shadowEnv — unchanged in mechanism; only
  constructor, ensureInit, and restore guard change.