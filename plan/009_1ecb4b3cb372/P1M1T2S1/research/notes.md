# Research Notes — P1.M1.T2.S1 (rewrite detectAndCreate + rework store.test.ts block)

## Files verified in-scope

- `src/snapshot/store.ts` — the `detectAndCreate` factory (lines ~437–481) + its doc comments + the
  section-header comment (~253) + the `GitBackendCtor` interface doc (~263). Also the top imports.
- `test/store.test.ts` — the `detectAndCreate()` describe block (the LAST describe, starting ~line 279).
- `REVERT_CFG` (test lines 19–30) is REUSED (unchanged).

## Confirmed facts (read directly, not assumed)

### store.ts — execFile is used ONLY by detectAndCreate
```
1: import { execFile as execFileCb } from "node:child_process";
2: import { promisify } from "node:util";
7: const execFile = promisify(execFileCb);
446:   await execFile("git", ["rev-parse", "--git-dir"], { cwd });
```
grep confirms: the ONLY call site of `execFile` is line 446 (inside detectAndCreate). Lines 53–54 only
mention `execFile` in a JSDoc string (AsyncMutex rationale). → After removing the rev-parse probe, the
3 import lines (1, 2, 7) become DEAD → remove them. Lines 53–54 JSDoc mention is in the SnapshotStore
interface doc (AsyncMutex context) — it stays (it's describing the backends' async shape, not detection).

### store.ts — current imports to KEEP / ADD / REMOVE
- KEEP: `import { access, mkdir, constants } from "node:fs/promises";`
- KEEP: `import { resolve, relative, isAbsolute } from "node:path";` → EXTEND with `join`.
- ADD: `import { realpathSync, existsSync } from "node:fs";`  (SYNC fs, not promises)
- ADD: `import { isForbiddenRoot } from "./paths.js";`  (from P1.M1.T1.S1)
- REMOVE: the 3 execFile/promisify lines (1, 2, 7).

### Backends exist + ship (dynamic imports resolve to real backends)
- `src/snapshot/git.ts` (42KB) — `constructor(cwd, revertConfig, sessionDir?, deps?)`, `this.cwd = resolve(cwd)`.
- `src/snapshot/cas.ts` (66KB) — same ctor shape, `this.cwd = resolve(cwd)`.
- → detection's dynamic `import("./git.js")` / `import("./cas.js")` RESOLVE → tests assert `backend === "git"|"cas"`.
- T3.S1/T4.S1 will change `resolve(cwd)`→`realpathSafe(cwd)` inside the backends; passing an ALREADY-canonical
  `root` to the ctors makes `resolve(root)` a no-op (idempotent) → no conflict, smooth handoff.

### Behavior CHANGE to capture in tests (important!)
- OLD test (a): non-existent cwd → execFile(ENOENT on cwd) → "not git" → cas branch → `"cas"`.
- NEW logic: `realpathSync(nonExistentCwd)` throws ENOENT → inner try/catch → `NoOpStore("…could not be resolved…")` → `"none"`.
- → The reworked block MUST include a "non-existent cwd → none (fail-safe)" test (call it (g)).
  The old (a) "→ cas" assertion is now WRONG and would fail if left as-is.

### resolveStorageDir arg: cwd vs root (refinement decision)
- `resolveStorageDir(storageDir, sessionDir, cwd)` does a containment check: `relative(resolve(cwd), candidate)`.
- Work item says "CAS branch unchanged" + "pass root to BOTH ctors". The SAFEST, most-canonical choice is to
  pass `root` (realpath) to resolveStorageDir TOO, so the containment check is against the canonical workspace
  root (matches the SAFETY INVARIANT "workspace root is always realpath(cwd)"). Tested: the inside-cwd test (f)
  still returns "none" with root (relative(root, insideDir) → "nested-store" → insideCwd → throw → NoOpStore).
  → RECOMMEND passing `root` to resolveStorageDir AND both ctors.

### Doc comments to rewrite (exact current text located)
1. Section header (~lines 254–261): "...This is the ONLY git I/O in detection (a read-only `git rev-parse --git-dir`); all writes live in the SHADOW repo..."
2. `GitBackendCtor` doc (~263–270): "Repo-root resolution happens INSIDE GitBackend (its own `rev-parse --show-toplevel`); detectAndCreate only proves the workspace is a git repo, it does NOT locate the repo root."
3. `detectAndCreate` JSDoc (~408–436): the big "DECISION TREE ... 1. `git rev-parse --git-dir` (read-only — the ONLY git command run against the user's repo here...)" block.
4. detectAndCreate body comment (~444): "// (1) git detection — NARROW try/catch ... Read-only rev-parse: no writes."
- All four: remove rev-parse / "ONLY git command" language; state lexical `existsSync(join(root,".git"))`
  + forbidden-root gate + `realpath(cwd)` root; cite @spec/14 §2 Detection + SAFETY INVARIANT + §10.

### test/store.test.ts — imports to restructure
- REMOVE (dead after rework): `import { execFile as execFileCb } from "node:child_process"`,
  `import { promisify } from "node:util"`, `const execFile = promisify(execFileCb);`
  (the old test (d) used execFile for `git init` + `git --version` guard — both replaced by `mkdir(.git)`).
- KEEP: `mkdtemp, mkdir, rm, chmod, access` (node:fs/promises), `tmpdir` (node:os), `join` (node:path).
- EXTEND: `import { tmpdir, homedir } from "node:os";` (add homedir for forbidden-home test).
- ADD: `vi` to the vitest import (for the no-exec spy), and a child_process namespace import for the spy.

### "no git command during detection" assertion — robustness decision
- store.test.ts uses REAL exec (not an exec fake). Detection no longer imports execFile AT ALL after this
  change → the import removal is the authoritative STRUCTURAL proof.
- The work item asks for an explicit runtime assertion. PRIMARY: `vi.spyOn(child_process, "execFile")` in one
  dedicated test → `expect(spy).not.toHaveBeenCalled()`. Works because detection (realpathSync + existsSync +
  isForbiddenRoot) makes zero exec calls, and the dynamic import + `new GitBackend(...)` ctor don't call exec
  either (init is deferred to first capture).
- BINARY-FREE PROOF (inherent): the new detection tests create `.git` via `mkdir` and assert backend selection
  WITHOUT requiring the `git` binary on PATH (old test (d) needed `git --version` guard + `git init`). Removing
  that guard is itself proof detection issues no git command. Fallback if spy-on-built-in is flaky.

### Spec citations (already in selected_prd_content h2.142 + h2.150)
- §2 Detection: "lexical `existsSync(join(cwd, '.git'))` ... NO upward git discovery ... workspace root is
  always `realpath(cwd)` ... home / `/` / `/home` / `/etc` / `/usr` / `/var` / too-shallow → refused 'none'."
- §2 SAFETY INVARIANT: "workspace root is `realpath(cwd)`, full stop. There is NO code path ... that
  traverses upward ... A subdirectory launch can NEVER be silently promoted to a parent."
- §10 Safety clause: "detectAndCreate($HOME, …) and detectAndCreate('/', …) each return a none/NoOp backend
  (refused); a subdirectory launch whose parent contains a `.git` keeps repoRoot at the subdir."

## Validation commands (confirmed from package.json + T1 PRP)
- `npm run typecheck` → tsc --noEmit (strict, ESNext). PRIMARY type gate.
- `npx vitest run test/store.test.ts` → focused suite.
- `npm test` → full suite (catches cross-file regression; integration revert-*.test.ts must stay green).
- No ruff/mypy/eslint/biome — do NOT invent lint commands.