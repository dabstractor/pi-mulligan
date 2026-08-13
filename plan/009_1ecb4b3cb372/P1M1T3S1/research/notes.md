# P1.M1.T3.S1 — Research Notes

Verified-against-current-source facts (line numbers current as of this session; T2.S1 parallel
work touches store.ts ONLY, NOT git.ts/git.test.ts, so these are stable).

## git.ts — verified line numbers

| Element | Line | Action |
|---|---|---|
| `import { execFile as execFileCb }` | 1 | KEEP (execFileDefault default) |
| `import { promisify }` | 2 | KEEP (execFileDefault) |
| `import { existsSync }` | 10 | EXTEND → `existsSync, realpathSync` |
| `import { join, resolve }` | 11 | KEEP (resolve still used: storageDir resolve) |
| `const execFileDefault = promisify(execFileCb)` | 26 | KEEP (DI seam default) |
| header comment DESIGN: guarantee #1 | 35-41 | REWRITE (lines 37-38) |
| header comment REPO-ROOT KEYING | 49-51 | REWRITE → LAUNCH-DIRECTORY KEYING |
| `function shadowKey(repoRoot)` | 139 (+JSDoc ~133-138) | doc REWRITE |
| `private sourceGitDir!: string` | 216 | DELETE |
| constructor `this.cwd = resolve(cwd)` | 235 | → `this.cwd = realpathSafe(cwd)` |
| init() JSDoc "sourceGitDir via read-only rev-parse" | 256-260 | REWRITE |
| ensureInit() JSDoc "Step (1) is the ONLY command against the USER's repo" | 266-277 | REWRITE |
| `await this.exec("git", ["rev-parse","--show-toplevel"], {cwd: this.cwd})` | 282 | DELETE |
| `gitDir = await this.exec("git", ["rev-parse","--absolute-git-dir"]...)` | 287 | DELETE |
| `this.repoRoot = top || this.cwd` | 291 | → `this.repoRoot = this.cwd` |
| `this.sourceGitDir = gitDir` | 292 | DELETE |
| `this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` | 293 | KEEP (now hashes this.cwd) |
| `git init --bare` existsSync-gate block | 294-303 | KEEP unchanged |

## sourceGitDir — confirmed deletable (only 4 refs, all in git.ts)
```
216:  private sourceGitDir!: string;     // field decl
259:   * sourceGitDir via read-only rev-parse...   // init() JSDoc (rewrite)
268:   * Lazy memoized init — the SINGLE source of repoRoot/sourceGitDir/shadowDir... // ensureInit JSDoc (rewrite)
292:      this.sourceGitDir = gitDir;    // assignment (delete)
```
Nothing in store.ts / cas.ts / test / integration reads sourceGitDir. Safe to delete entirely.

## isForbiddenRoot import — DECISION
- tsconfig.json: `strict`, `noImplicitAny` ONLY — **NO `noUnusedLocals`**.
- No eslint/biome/ruff config in repo (only `tsc --noEmit` = `npm run typecheck`).
- Work-item RESEARCH NOTE lists isForbiddenRoot as a "new import", but the LOGIC steps
  (constructor/ensureInit/shadowKey/docs/test) consume ONLY realpathSafe.
- isForbiddenRoot is consumed by T3.S2 (restore() entry guard — separate planned subtask).
- **DECISION: T3.S1 imports ONLY realpathSync.** Defer isForbiddenRoot to T3.S2 (which extends the
  existing `from "./paths.js"` destructure trivially). Keeps this diff honest (every imported symbol
  used). Harmless if imported now (no noUnusedLocals) but a reviewer would flag it unused.

## test/git.test.ts — verified rework inventory

### makeExec rev-parse stubs to DELETE (the fake must NOT match rev-parse for non-shadow cmds)
- L75-77: `if (cmd === "rev-parse" && args[1] === "--show-toplevel") return {stdout:"/fake/repo\n"}`
          + `--absolute-git-dir` → `/fake/repo/.git`
- L255-257: SAME stubs duplicated inline in `throwingExec` (capture best-effort test)
- L305-307: SAME stubs duplicated inline in `racingExec` (mutex serialization test)

### expectedShadow default repoRoot to flip
- L126-127: doc + `repoRoot = "/fake/repo"` → `"/fake/cwd"`
  (realpathSafe("/fake/cwd") → realpathSync throws ENOENT → fallback resolve → "/fake/cwd")

### GIT_WORK_TREE assertions (now repoRoot === "/fake/cwd")
- L166: `expect(...GIT_WORK_TREE).toBe("/fake/repo")` → "/fake/cwd"
- L378: `expect(diff.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo")` → "/fake/cwd"

### "NEVER the source git dir" negative assertions (source .git is now /fake/cwd/.git)
- L228, L639, L654, L804: `.not.toBe("/fake/repo/.git")` → `.not.toBe("/fake/cwd/.git")`
  (These assert GIT_DIR !== the user's .git; the user's .git is now under /fake/cwd.)

### throwOn rev-parse call:N — has() tests (ensureInit no longer issues 2 rev-parse calls first)
- L422, L427: `{ throwOn: { cmd: "rev-parse", call: 3 } }` → `call: 1`
  (After rework the FIRST rev-parse call IS has()'s --verify; was the 3rd.)

### Test #1 (L132-141) + "five guarantees" test #2 (L232) — full rework
- L133 test "issues rev-parse --show-toplevel against the USER repo" → premise GONE.
  REPLACE with: "issues ZERO commands against the user's git (no rev-parse --show-toplevel/--absolute-git-dir)".
- L232 test "the ONLY command without the shadow env is the read-only rev-parse" → premise GONE.
  REPLACE with: "ZERO commands run without the shadow env" — assert no call has cwd-only opts
  (every call carries env.GIT_DIR=shadow).

## Files NOT touched (scope boundary)
- store.ts (T2.S1 owns detectAndCreate), cas.ts (T4), paths.ts (T1.S1 done),
  README (M2.T2), integration tests (M2.T1).

## build commands (package.json verified)
- `npm run typecheck` → `tsc --noEmit`
- `npm test` → `vitest run`
- single file: `npx vitest run test/git.test.ts`