---
name: "P1.M1.T2.S1 — Rewrite detectAndCreate detection logic + rework store.test.ts detectAndCreate block"
description: >
  Rewrite `detectAndCreate()` in `src/snapshot/store.ts` so workspace selection is LEXICAL +
  forbidden-root-gated + canonical-root, with ZERO git command issued against the user's repo.
  Removes the read-only `git rev-parse --git-dir` probe (the historical regression vector: upward
  repo discovery once resolved the workspace to `$HOME`, and `restore()` then wiped the home tree —
  spec/14 §2 SAFETY INVARIANT). New detection: (1) `realpathSync(cwd)` → fail-safe NoOpStore on throw;
  (2) `isForbiddenRoot(root)` (from P1.M1.T1.S1) → NoOpStore BEFORE backend selection; (3) lexical
  `existsSync(join(root, ".git"))` → GitBackend; (4) else → Cas branch (unchanged flow); (5) pass
  `root` (canonical) to BOTH constructors + resolveStorageDir. Outer E28 fail-open try/catch PRESERVED.
  Rework the `detectAndCreate` describe block in `test/store.test.ts` to real temp dirs (no rev-parse,
  no `git init` — create `.git` via mkdir): WITH `.git`→git, WITHOUT→cas, `$HOME`→none, `/`→none,
  unwritable→none, non-existent cwd→none (NEW behavior), subdir-under-parent-with-`.git`→cas (proves
  no upward walk). Assert no execFile call during detection. Rewrite the 4 stale doc comments + the
  GitBackendCtor doc. The sibling T1.S1 (isForbiddenRoot) is implemented in parallel — consume its
  export as a CONTRACT. Out of scope: git.ts/cas.ts rewrites (T3/T4), integration tests, README.
---

## Goal

**Feature Goal**: `detectAndCreate()` selects the snapshot backend by a **pure lexical** `.git`
check on the **canonical** `realpath(cwd)` workspace root, gated behind `isForbiddenRoot`, and issues
**no git command of any kind** against the user's repository. A home/system-root/`/`/non-existent
workspace is refused to a `NoOpStore` BEFORE any backend is constructed. This closes the highest-
severity regression vector in the v1.2 working-tree-revert feature (spec/14 §2 SAFETY INVARIANT).

**Deliverable** (two file edits, both in scope of THIS subtask only):
1. `src/snapshot/store.ts`:
   - Imports: **remove** the 3 dead `execFile` lines (`execFile as execFileCb`, `promisify`,
     `const execFile = promisify(execFileCb)` — confirmed used ONLY by detectAndCreate); **add**
     `realpathSync, existsSync` from `node:fs`, `join` to the existing `node:path` destructure, and
     `isForbiddenRoot` from `./paths.js`.
   - Rewrite `detectAndCreate()` body to the new 5-step logic (realpath → forbidden gate → lexical
     `.git` → cas branch → fail-open), passing `root` (canonical) to `resolveStorageDir` AND both
     backend constructors. Preserve the outer E28 try/catch (detectAndCreate NEVER rejects).
   - Rewrite the 4 stale doc comments (section header ~253, `GitBackendCtor` ~263, `detectAndCreate`
     JSDoc ~408, body comment ~444) — remove all "rev-parse" / "ONLY git command" language; state the
     lexical `.git` check + forbidden-root gate + `realpath(cwd)` root; cite `@spec/14 §2` Detection +
     SAFETY INVARIANT + `§10`.
2. `test/store.test.ts`:
   - Rework the `detectAndCreate()` describe block (the LAST describe, ~line 279): replace rev-parse /
     `git init` / `git --version` with real temp dirs created via `mkdir` (binary-free). New matrix
     (a)–(h) below. Reuse the existing `REVERT_CFG` (lines 19–30, unchanged).
   - Imports: remove the 3 dead `execFile` lines; add `homedir` to the `node:os` import; add `vi` to the
     vitest import + `import * as child_process from "node:child_process"` (for the no-exec spy).

**Success Definition**:
- `detectAndCreate` issues **zero** `child_process.execFile` calls (no rev-parse, no git at all);
  detection is `realpathSync` + `isForbiddenRoot` + `existsSync` only.
- `detectAndCreate(realGitRepoDir, …)` → backend `"git"` (lexical `.git` dir detected).
- `detectAndCreate(nonGitDir, …)` → backend `"cas"` (`.git` absent → cas branch).
- `detectAndCreate(os.homedir(), …)` → `NoOpStore` `"none"` (forbidden; reason mentions "forbidden").
- `detectAndCreate("/", …)` → `NoOpStore` `"none"` (forbidden).
- `detectAndCreate(nonExistentDir, …)` → `NoOpStore` `"none"` (realpathSync ENOENT → fail-safe).
- `detectAndCreate(subdirUnderGitParent, …)` → backend `"cas"` (subdir has no `.git`; proves NO upward walk).
- A subdir launch is **never** promoted to a parent `.git` (the SAFETY INVARIANT).
- `npm run typecheck`, `npx vitest run test/store.test.ts`, and `npm test` (incl. integration
  `revert-*.test.ts`) all green. The `SnapshotStore`/`RestoreOpts`/`RestoreResult`/`AsyncMutex`/
  `NoOpStore` exports + the non-detectAndCreate describe blocks are UNCHANGED.

## Why

- **It is the core of the P1 detection-safety-hardening milestone.** spec/14 §2 SAFETY INVARIANT:
  "The workspace root is `realpath(cwd)`, full stop. There is **no** code path — in detection, init,
  capture, or restore — that traverses upward to find an enclosing repository. ... Re-introducing
  upward repo discovery anywhere in the snapshot subsystem is a regression of the highest severity."
  The current `git rev-parse --git-dir` probe is exactly that upward-discovery vector (rev-parse walks
  up the tree to find `.git`). Replacing it with a lexical `existsSync(join(root, ".git"))` check +
  a forbidden-root gate makes the regression structurally impossible.
- **It consumes the T1.S1 predicate at the detection site.** `isForbiddenRoot` (P1.M1.T1.S1) was built
  first so detection + both `restore()` guards enforce ONE definition. This task is its first consumer
  (the "fail-safe floor"); T3.S2 / T4.S1 are the per-restore last-line-of-defense consumers.
- **It is prerequisite for the rest of P1.M1.** T3 (GitBackend rewrite) and T4 (CasBackend guard)
  assume detection passes a canonical `root` and never an un-resolved `cwd`. Landing detection first
  pins that contract.

## What

A rewrite of the `detectAndCreate()` factory decision tree + its documentation, plus a rework of the
test block that pins it. The detection algorithm becomes (verbatim from the work-item contract step 3):

```ts
export async function detectAndCreate(cwd, revertConfig, sessionDir?): Promise<SnapshotStore> {
  try {
    // (1) Canonicalize — fail-safe: never throws.
    let root: string;
    try { root = realpathSync(cwd); }
    catch { return new NoOpStore("workspace root could not be resolved (path does not exist or is unreadable)"); }
    // (2) Forbidden-root gate — BEFORE any backend selection (spec/14 §2).
    if (isForbiddenRoot(root))
      return new NoOpStore("workspace root is forbidden (home/system root); revert refused");
    // (3) Git detection = LEXICAL (no rev-parse, no upward walk). .git may be a file or dir.
    if (existsSync(join(root, ".git"))) {
      const spec = "./git.js";                       // NON-LITERAL specifier (forward-compat cast)
      const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
      return new mod.GitBackend(root, revertConfig, sessionDir);   // ← root, NOT cwd
    }
    // (4) CAS branch (flow unchanged; resolveStorageDir + mkdir + W_OK).
    const storageDir = resolveStorageDir(revertConfig.storageDir, sessionDir, root);  // ← root
    try { await mkdir(storageDir, { recursive: true }); await access(storageDir, constants.W_OK); }
    catch { return new NoOpStore("no git repo and storage dir not writable"); }
    const spec = "./cas.js";
    const mod = (await import(spec)) as { CasBackend: CasBackendCtor };
    return new mod.CasBackend(root, revertConfig, sessionDir);     // ← root, NOT cwd
  } catch (err) {                                    // (5) E28 fail-open — detectAndCreate NEVER rejects.
    const msg = err instanceof Error ? err.message : String(err);
    return new NoOpStore(summarize(msg));
  }
}
```

### Success Criteria

- [ ] `detectAndCreate` issues zero `execFile` calls (detection is `realpathSync`+`isForbiddenRoot`+`existsSync` only).
- [ ] `detectAndCreate(realGitRepoDir,…)` → `"git"`; `detectAndCreate(nonGitDir,…)` → `"cas"`.
- [ ] `detectAndCreate(os.homedir(),…)` and `detectAndCreate("/",…)` → `NoOpStore` `"none"` (forbidden).
- [ ] `detectAndCreate(nonExistent,…)` → `NoOpStore` `"none"` (realpathSync ENOENT fail-safe).
- [ ] `detectAndCreate(subdirUnderParentWithGit,…)` → `"cas"` (NO upward walk — subdir not promoted).
- [ ] `root` (canonical `realpath(cwd)`) is passed to `resolveStorageDir` AND both backend constructors.
- [ ] Outer E28 try/catch preserved — `detectAndCreate` NEVER rejects.
- [ ] The 4 stale doc comments + `GitBackendCtor` doc rewritten (no "rev-parse" / "ONLY git command").
- [ ] `npm run typecheck` + `npx vitest run test/store.test.ts` + `npm test` (incl. `revert-*.test.ts`) green.
- [ ] The `SnapshotStore`/`RestoreOpts`/`RestoreResult`/`AsyncMutex`/`NoOpStore` exports + the other
      describe blocks (AsyncMutex, type shapes, NoOpStore) are byte-identical; change is localized.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
target function (current body read), the exact imports to add/remove (grep-confirmed execFile is used
only in detectAndCreate), the exact new body, the exact 4 doc-comment strings to rewrite (located by
line), the exact test matrix, and the spec citations are all below. The T1.S1 dependency is stated as a
contract (`isForbiddenRoot` exported from `./paths.js`).

### Documentation & References

```yaml
# MUST READ — the spec authority for the rewrite
- file: spec/14-working-tree-revert.md
  why: "§2 is the SAFETY INVARIANT this rewrite enforces: workspace root = realpath(cwd); NO upward
        discovery; forbidden cases (home / `/` / `/home` / `/etc` / `/usr` / `/var` / too-shallow) →
        refused 'none'; detection = lexical existsSync(join(cwd,'.git')); cas when .git absent or CAS
        unwritable → 'none'. §10 is the testing safety clause: detectAndCreate($HOME) and ('/') each
        return none; a subdir whose parent has .git stays at the subdir (never promoted)."
  section: "§2 Architecture — the SnapshotStore (the 'SAFETY INVARIANT — non-negotiable' block +
            the 'Detection' paragraph), §10 Testing (the 'Safety (non-negotiable)' bullet)"
  critical: "§2 explicitly FORBIDS rev-parse --show-toplevel / --git-dir / --absolute-git-dir in
             detection. The current rev-parse probe is the regression vector this task removes. The
             'Detection, cached per session in SessionRuntime' paragraph is the decision tree to
             implement verbatim."

# MUST READ — the file being rewritten (read it FULLY first, esp. lines ~250–481)
- file: src/snapshot/store.ts
  why: "THE source file modified. detectAndCreate is at lines ~437–481. The 3 dead imports to remove
        are lines 1, 2, 7 (execFile/promisify). The imports to extend: node:path (add join) + add
        node:fs (realpathSync, existsSync) + add ./paths.js (isForbiddenRoot). 4 doc-comment regions
        to rewrite: section header ~254, GitBackendCtor ~263, detectAndCreate JSDoc ~408, body ~444.
        NoOpStore (~357) ALREADY has a `reason: string` ctor — reuse it as-is (do NOT modify the class).
        RestoreResult (~195) already has `refused: string[]`. resolveStorageDir + summarize are
        MODULE-PRIVATE helpers — keep them (only the arg passed to resolveStorageDir changes: root not cwd)."
  pattern: "Mirror the existing dynamic-import forward-compat cast (`const spec = './git.js';
            const mod = (await import(spec)) as { GitBackend: GitBackendCtor }`) for BOTH backends —
            keep the NON-LITERAL specifier (string in a const) so tsc/rollup/vitest don't statically
            resolve it. Preserve the NARROW inner try/catch + the OUTER E28 try/catch shape."
  gotcha: "execFile is used ONLY by detectAndCreate (grep-confirmed). Removing the rev-parse call makes
           the execFile/promisify/execFileCb imports DEAD — remove all 3 or tsc may warn / lint flags
           unused. The SnapshotStore-interface JSDoc at lines ~53-54 mentions execFile (AsyncMutex
           rationale about the backends) — that stays (it describes the backends' async shape, not
           detection); do NOT delete it."

# MUST READ — the test file being reworked (the LAST describe block, ~line 279+)
- file: test/store.test.ts
  why: "THE test file modified. REVERT_CFG (lines 19–30) is REUSED unchanged. The detectAndCreate
        describe block (~279+) is REWORKED (see Implementation Tasks Task 8). The other 3 describe
        blocks (AsyncMutex, type shapes, NoOpStore) + REVERT_CFG + microDelay are UNCHANGED."
  pattern: "House idiom: REAL temp dirs (os.mkdtemp) + REAL fs ops — NOT mocks. afterEach restores
            chmod 0o755 before rm() (read-only dirs block rm on some platforms). Lettered (a)/(b)/…
            test names. Imports from '../src/snapshot/store.js' (ESM .js convention)."
  gotcha: "BEHAVIOR CHANGE: the OLD test (a) asserted non-existent cwd → 'cas' (via execFile ENOENT
           → not git). The NEW logic makes non-existent cwd → 'none' (realpathSync ENOENT). That old
           assertion is now WRONG — replace it (new test (g) captures the NEW fail-safe behavior). The
           OLD test (d) used `git init` + a `git --version` PATH guard; the NEW tests create `.git` via
           mkdir (binary-free) — so the execFile/promisify/execFileCb imports in the TEST become DEAD too;
           remove them. Add `homedir` to the node:os import + `vi` to the vitest import + a child_process
           namespace import for the no-exec spy."

# MUST READ — the canonical change inventory + test matrix (authoritative for THIS plan)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "§'src/snapshot/store.ts — REWRITE detectAndCreate' is the exact spec (imports to add/remove,
        new logic, doc comments to rewrite, NoOpStore UNCHANGED). §'test/store.test.ts — REWORK' is the
        canonical test matrix to follow (WITH .git→git, WITHOUT→cas, $HOME→none, /→none, unwritable→none,
        subdir-under-parent→cas, assert no rev-parse)."
  section: "the store.ts table + the test/store.test.ts bullet list"
  critical: "It confirms execFile is used ONLY in detectAndCreate and that the imports become dead. It
             also scopes the OTHER files (git.ts/cas.ts/README/integration) to SEPARATE subtasks — do
             NOT touch them here."

# CONTRACT — the dependency implemented in parallel (P1.M1.T1.S1)
- file: plan/009_1ecb4b3cb372/P1M1T1S1/PRP.md
  why: "Defines isForbiddenRoot EXACTLY: `export function isForbiddenRoot(root: string): boolean`
        returning true for homedir()/`/`/depth-1(dirname==='/')/empty/dot. Import it from './paths.js'.
        Treat it as a black-box boolean gate. Do NOT re-implement it here."
  pattern: "T1.S1 adds `import { homedir } from 'node:os'` + `dirname` to node:path in paths.ts and
            exports isForbiddenRoot as the 5th export. Your import: `import { isForbiddenRoot } from './paths.js';`"

# READ — the backends your factory constructs (ctor contract; NOT modified in this subtask)
- file: src/snapshot/git.ts
  why: "Confirms GitBackend ctor signature: `constructor(cwd, revertConfig, sessionDir?, deps?)`.
        T3.S1 will change `this.cwd = resolve(cwd)` → realpathSafe; passing an ALREADY-canonical root
        makes resolve(root) idempotent → smooth handoff, no conflict. describe() returns {backend:'git'}."
  section: "constructor (line ~229) + describe() (line ~247)"
- file: src/snapshot/cas.ts
  why: "Same ctor shape; describe() returns {backend:'cas'}. Confirms the 3-arg call works (deps optional)."
  section: "constructor (line ~257)"
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
├── store.ts     # ← REWRITE detectAndCreate + doc comments + imports (THE source file)
├── paths.ts     # ← UNCHANGED here; exports isForbiddenRoot (T1.S1) — CONSUMED via ./paths.js
├── git.ts       # ← UNCHANGED here (T3 rewrites it); ctor takes (cwd, revertConfig, sessionDir?, deps?)
└── cas.ts       # ← UNCHANGED here (T4 guards it); ctor takes (cwd, revertConfig, sessionDir?, deps?)
test/
└── store.test.ts # ← REWORK the detectAndCreate describe block + imports (THE test file)
```

### Desired Codebase tree

```bash
src/snapshot/
└── store.ts       # MODIFIED (detectAndCreate body + 4 doc comments + imports: −execFile, +realpathSync/existsSync/join/isForbiddenRoot)
test/
└── store.test.ts  # MODIFIED (detectAndCreate describe block reworked + imports: −execFile, +homedir/vi/child_process)
```
No new files. paths.ts / git.ts / cas.ts / README / integration tests are NOT touched (separate subtasks).

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — execFile is used ONLY by detectAndCreate (grep-confirmed: line 446 is the sole call site).
// After removing the rev-parse probe, THREE import lines become dead: line 1 (`execFile as execFileCb`),
// line 2 (`promisify`), line 7 (`const execFile = promisify(execFileCb)`). Remove ALL THREE or tsc/lint
// will flag unused imports. NOTE: the SnapshotStore-interface JSDoc at lines ~53-54 MENTIONS execFile
// in prose ("await child_process.execFile without freezing the Pi event loop") — that describes the
// BACKENDS' async shape (why the interface methods are async), NOT detection. LEAVE it; do not delete.

// GOTCHA #2 — node:fs (SYNC) vs node:fs/promises (ASYNC) are DIFFERENT modules. The current file imports
// `access, mkdir, constants` from "node:fs/promises" (ASYNC — used by the cas branch). The NEW imports
// `realpathSync, existsSync` come from "node:fs" (SYNC). Both coexist. Do NOT add realpathSync/existsSync
// to the node:fs/promises import (they're not promises). Keep the two import lines separate + grouped.

// GOTCHA #3 — join goes into the EXISTING node:path destructure, NOT a new import line:
//   BEFORE: import { resolve, relative, isAbsolute } from "node:path";
//   AFTER:  import { resolve, relative, isAbsolute, join } from "node:path";
// (Mirror the T1.S1 convention of extending the destructure rather than adding a second from-line.)

// GOTCHA #4 — isForbiddenRoot is imported from "./paths.js" (ESM .js specifier convention), NOT "./paths".
// All cross-snapshot-module imports in this codebase use the .js extension (store.ts already imports
// "../config.js"; git.ts/cas.ts import "./paths.js"). Match it: `import { isForbiddenRoot } from "./paths.js";`

// GOTCHA #5 — PASS `root` (canonical) NOT raw `cwd` to resolveStorageDir AND both constructors.
// resolveStorageDir does a containment check `relative(resolve(cwd), candidate)`; passing the canonical
// root makes that check authoritative against realpath(cwd) (the SAFETY INVARIANT). Tested: the inside-cwd
// case (test f) still returns "none" (relative(root, insideDir) → "nested-store" → insideCwd → throw).
// The work item explicitly says "PASS root to BOTH backend constructors"; extend the same to resolveStorageDir.

// GOTCHA #6 — the dynamic-import specifiers MUST stay NON-LITERAL (a string in a `const`), e.g.
//   const spec = "./git.js"; const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
// tsc/rollup/vitest only statically resolve STRING-LITERAL import() args. A literal `"./git.js"` inside
// import() would make tsc --noEmit try to resolve the module type at compile time. Keep the const form
// EXACTLY as the current code has it (both the git and cas branches). Do NOT "simplify" to a literal.

// GOTCHA #7 — `.git` may be a FILE (git worktree / submodule gitdir pointer) OR a directory. `existsSync`
// returns true for BOTH — that is why existsSync is chosen over statSync().isDirectory(). A worktree's
// `.git` is a text file like `gitdir: /path/to/main/.git/worktrees/x`; detection must still select GitBackend.
// (Add a test case creating `.git` as a file to pin this — see Task 8 test (a2).)

// GOTCHA #8 — detectAndCreate MUST NEVER reject (E28 fail-open is the contract). The OUTER try/catch is
// PRESERVED verbatim. The NEW inner try/catch around realpathSync is a NARROW fail-safe (returns NoOpStore
// with the "could not be resolved" reason). The forbidden gate returns BEFORE backend selection. Do NOT
// remove the outer catch, and do NOT let realpathSync's throw escape (the inner catch swallows it).

// GOTCHA #9 — NoOpStore is NOT modified. It ALREADY has `constructor(private readonly reason: string)`.
// The new forbidden + could-not-resolve reasons slot in as `new NoOpStore("<reason string>")`. The exact
// reason strings are SPECIFIED by the work item:
//   - "workspace root could not be resolved (path does not exist or is unreadable)"  (realpathSync throw)
//   - "workspace root is forbidden (home/system root); revert refused"               (isForbiddenRoot)
//   - "no git repo and storage dir not writable"                                     (cas branch, UNCHANGED)
// Use these EXACT strings (a test asserts the forbidden reason mentions "forbidden"; the unwritable one
// mentions "writable" — both already do).

// GOTCHA #10 — the integration tests (test/integration/revert-{git,cas,explicit,edge}.test.ts) call
// detectAndCreate(realRepoDir, …) and assert backend "git"/"cas". With lexical .git detection they STILL
// PASS (a real `git init`'d repo has a .git dir → existsSync true → GitBackend). Run `npm test` to confirm
// ZERO integration regressions. If one breaks, it is NOT this task's detection logic at fault unless it
// relied on a non-existent cwd resolving to cas (it doesn't — they use real repos).

// GOTCHA #11 — the T1.S1 isForbiddenRoot predicate assumes a CANONICALIZED input (realpath of the root).
// detectAndCreate passes `root` (the realpathSync result) — never raw cwd — so the predicate's contract
// holds. Do NOT pass cwd to isForbiddenRoot (cwd may be relative / a symlink / un-resolved).

// GOTCHA #12 — POSIX orientation is BY DESIGN (inherited from isForbiddenRoot: dirname(root)==="/").
// On Windows, drive-roots (C:\) are not caught — a documented limitation, NOT a defect. Do NOT add
// Windows drive-root handling in detection (that would broaden the safety gate silently). The spec's
// named examples are all POSIX.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `SnapshotStore`, `RestoreOpts`, `RestoreResult`, `AsyncMutex`, `NoOpStore`,
`GitBackendCtor`, `CasBackendCtor`, `resolveStorageDir`, `summarize` are all UNCHANGED. Only the
`detectAndCreate` function body + its doc comments + imports change.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/store.ts — imports (remove dead, add new)
  - REMOVE line 1: `import { execFile as execFileCb } from "node:child_process";`
  - REMOVE line 2: `import { promisify } from "node:util";`
  - REMOVE line 7: `const execFile = promisify(execFileCb);`
    (grep-confirmed: execFile is used ONLY at line 446 in detectAndCreate. GOTCHA #1.)
  - EXTEND the node:path import to add `join`:
      BEFORE: import { resolve, relative, isAbsolute } from "node:path";
      AFTER:  import { resolve, relative, isAbsolute, join } from "node:path";
  - ADD (new line, grouped with node built-ins): `import { realpathSync, existsSync } from "node:fs";`
    (SYNC fs — GOTCHA #2; do NOT add to the node:fs/promises import.)
  - ADD: `import { isForbiddenRoot } from "./paths.js";`
    (ESM .js specifier — GOTCHA #4. The T1.S1 export, treated as a black-box boolean gate.)
  - WHY: realpathSync for canonicalization; existsSync + join for lexical .git; isForbiddenRoot for the
    gate. Removing the 3 dead execFile lines keeps the import block honest (tsc/lint-clean).
  - DEPENDENCIES: none (this is the foundation for Task 2).

Task 2: MODIFY src/snapshot/store.ts — rewrite detectAndCreate body
  - LOCATE the current detectAndCreate body (lines ~437–481): the inner `try { await execFile("git",
    ["rev-parse","--git-dir"], { cwd }); ... GitBackend(cwd,...) } catch {}` block + the cas branch.
  - REPLACE the ENTIRE try-block body with the new 5-step algorithm (see "What" section for the verbatim
    body). Key shape:
      try {
        let root: string;
        try { root = realpathSync(cwd); }
        catch { return new NoOpStore("workspace root could not be resolved (path does not exist or is unreadable)"); }
        if (isForbiddenRoot(root))
          return new NoOpStore("workspace root is forbidden (home/system root); revert refused");
        if (existsSync(join(root, ".git"))) {
          const spec = "./git.js";
          const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
          return new mod.GitBackend(root, revertConfig, sessionDir);   // root, NOT cwd
        }
        const storageDir = resolveStorageDir(revertConfig.storageDir, sessionDir, root);  // root, NOT cwd
        try { await mkdir(storageDir, { recursive: true }); await access(storageDir, constants.W_OK); }
        catch { return new NoOpStore("no git repo and storage dir not writable"); }
        const spec = "./cas.js";
        const mod = (await import(spec)) as { CasBackend: CasBackendCtor };
        return new mod.CasBackend(root, revertConfig, sessionDir);     // root, NOT cwd
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new NoOpStore(summarize(msg));
      }
  - PRESERVE: the OUTER `try { ... } catch (err) { ... NoOpStore(summarize(msg)) }` (E28 fail-open —
    detectAndCreate NEVER rejects; GOTCHA #8). The function signature + JSDoc @param block are unchanged
    (only the DECISION TREE prose inside the JSDoc changes — Task 4).
  - GOTCHA #5 (root to resolveStorageDir + both ctors), #6 (non-literal specifiers), #7 (existsSync for
    file-or-dir .git), #8 (outer catch preserved), #9 (exact NoOpStore reason strings), #11 (canonical
    root to isForbiddenRoot).
  - DEPENDENCIES: Task 1 (imports must be in scope: realpathSync, existsSync, join, isForbiddenRoot).

Task 3: MODIFY src/snapshot/store.ts — rewrite the GitBackendCtor interface doc (~line 263)
  - CURRENT: "...Repo-root resolution happens INSIDE GitBackend (its own `rev-parse --show-toplevel`);
    detectAndCreate only proves the workspace is a git repo, it does NOT locate the repo root."
  - REPLACE the last two sentences with: "detectAndCreate passes the CANONICAL workspace root
    (`realpath(cwd)`); GitBackend keys its shadow repo on THAT launch directory (never an upward-walked
    repo root — spec/14 §2 SAFETY INVARIANT). detectAndCreate selects the git backend by a LEXICAL
    `existsSync(join(root, '.git'))` check — it issues NO git command against the user's repo."
  - WHY: the old doc describes rev-parse repo-root resolution that NO LONGER HAPPENS (and that T3.S1 is
    removing from git.ts). Stale doc = reviewer flag + contradicts the new detection.
  - DEPENDENCIES: none (doc-only).

Task 4: MODIFY src/snapshot/store.ts — rewrite the section-header comment (~line 254) + the
         detectAndCreate JSDoc decision tree (~line 408) + the body comment (~line 444)
  - SECTION HEADER (~254–261): the line that says "This is the ONLY git I/O in detection (a read-only
    `git rev-parse --git-dir`); all writes live in the SHADOW repo inside GitBackend (P2.M2.T1)." →
    REPLACE with: "Detection is LEXICAL + PURE-SYNC: `realpathSync(cwd)` → `isForbiddenRoot` gate →
    `existsSync(join(root,'.git'))`. It issues NO git command of ANY kind against the user's repo (no
    rev-parse, read or write — spec/14 §2 SAFETY INVARIANT). All git writes live in the SHADOW repo
    inside GitBackend (P2.M2.T1). spec/14 §2 ('Detection'), spec/14 §8."
  - detectAndCreate JSDoc DECISION TREE (~408–436): rewrite the numbered list. NEW:
      "DECISION TREE (spec/14 §2 'Detection' + SAFETY INVARIANT; Mode A doc rides with this work):
        1. Canonicalize: root = realpathSync(cwd). Throw (ENOENT/unreadable) ⇒ NoOpStore ('could not be
           resolved') — fail-safe, never propagates.
        2. Forbidden-root gate: isForbiddenRoot(root) (home / `/` / depth-1 system dir / degenerate)
           ⇒ NoOpStore ('workspace root is forbidden … revert refused') — BEFORE any backend selection.
        3. Git detection = LEXICAL: existsSync(join(root, '.git')) (.git may be a file or dir) ⇒ GitBackend.
           NO upward git discovery is ever performed; rev-parse --show-toplevel/--git-dir/--absolute-git-dir
           are FORBIDDEN in detection (spec/14 §2). Workspace root is ALWAYS realpath(cwd) — never walked up.
        4. Else ⇒ CAS branch: resolveStorageDir + mkdir -p + W_OK. Writable ⇒ CasBackend; unwritable ⇒ NoOpStore.
        5. ANY remaining thrown error ⇒ NoOpStore. detectAndCreate NEVER rejects (E28 fail-open)."
    Keep the FORWARD-COMPAT paragraph (the non-literal dynamic-import explanation) + the
    Integration-contract-note paragraph + the @param block + the EXPORTED-so-index.ts line UNCHANGED.
  - BODY COMMENT (~444): the `// (1) git detection — NARROW try/catch ... Read-only rev-parse: no writes.`
    comment is DELETED (replaced by the new inline comments in Task 2's body — the realpath try/catch,
    the forbidden gate, the lexical .git check each get a one-line comment citing spec §2).
  - WHY: all four currently describe rev-parse / "ONLY git command", which is now FALSE. spec/14 §2 + §10
    citations required (GOTCHA: cite @spec/14 §2 Detection + SAFETY INVARIANT + §10).
  - DEPENDENCIES: Task 2 (the body comment must match the new code).

Task 5: VALIDATE source (no test changes yet)
  - RUN: `npm run typecheck` (tsc --noEmit). Confirms the import edits resolve + the new body type-checks
    + the removed execFile doesn't leave a dangling reference. PRIMARY gate.
  - RUN: `npx vitest run test/store.test.ts`. EXPECT some detectAndCreate tests to FAIL now (old (a)
    asserts 'cas' for non-existent cwd; old (d) used git init) — that is EXPECTED until Task 8 lands.
    The AsyncMutex + type-shapes + NoOpStore blocks MUST stay green (they're untouched).
  - WHY: confirm the source compiles + only the intended tests are affected, BEFORE reworking the tests.

Task 6: MODIFY test/store.test.ts — imports (remove dead, add for spy + homedir)
  - REMOVE: `import { execFile as execFileCb } from "node:child_process";`,
    `import { promisify } from "node:util";`, `const execFile = promisify(execFileCb);`
    (the old test (d) was the only user — git init + git --version guard — both replaced by mkdir(.git)).
  - EXTEND the vitest import to add `vi`:
      BEFORE: import { describe, it, expect, expectTypeOf, afterEach } from "vitest";
      AFTER:  import { describe, it, expect, expectTypeOf, afterEach, vi } from "vitest";
  - EXTEND the node:os import to add `homedir`:
      BEFORE: import { tmpdir } from "node:os";
      AFTER:  import { tmpdir, homedir } from "node:os";
  - ADD: `import * as child_process from "node:child_process";` (namespace import for the no-exec spy).
  - KEEP: `import { mkdtemp, mkdir, rm, chmod, access } from "node:fs/promises";` + `import { join } from "node:path";`
    (all still used by the reworked tests).
  - DEPENDENCIES: Task 6 is independent of store.ts; can land anytime. Do it right before Task 8.

Task 7: MODIFY test/store.test.ts — reuse REVERT_CFG (NO change)
  - REVERT_CFG (lines 19–30) is REUSED AS-IS across all reworked tests. Do NOT modify it. (GOTCHA: it has
    storageDir: null; the forbidden tests pass a real temp sessionDir/storageDir; the git/cas tests pass a
    real temp storageDir so the cas branch can mkdir it.)

Task 8: MODIFY test/store.test.ts — REWORK the detectAndCreate describe block (~line 279)
  - LOCATE: `describe("detectAndCreate() — spec/14 §2 detection tree + E28 fail-open", () => { ... })`
    (the LAST describe block). Keep the `dirs[]` + `afterEach` cleanup scaffold (it still applies).
  - REPLACE its `it(...)` cases with the new matrix below. Header comment: update to cite spec/14 §2
    Detection + SAFETY INVARIANT + §10 (testing safety clause), task P1.M1.T2.S1, and note the BEHAVIOR
    CHANGE (non-existent cwd: was 'cas', now 'none').
  - NEW MATRIX (lettered to match the file's convention):
    (a) temp dir WITH .git (mkdir(join(dir,".git"))) + writable storage → backend "git"
        (lexical .git detection; NO git init, NO rev-parse). + SUB-CASE (a2): create `.git` as a FILE
        (write `gitdir: ...\n`) → backend "git" (existsSync covers file-or-dir — GOTCHA #7).
    (b) temp dir WITHOUT .git + writable storage → backend "cas".
    (c) detectAndCreate(os.homedir(), REVERT_CFG, tempSessionDir) → NoOpStore "none"; reason mentions
        "forbidden" (forbidden-root gate — spec/14 §2 + §10).
    (d) detectAndCreate("/", REVERT_CFG, tempSessionDir) → NoOpStore "none"; reason mentions "forbidden".
    (e) non-git dir + UNWRITABLE storage (chmod 0o555) → NoOpStore "none"; reason mentions "writable"
        (UNCHANGED from the old test (b) — the cas-branch fail-open path).
    (f) subdir whose PARENT has .git but subdir does NOT → backend "cas" (proves NO upward walk —
        spec/14 §2 SAFETY INVARIANT + §10; the regression vector this whole task closes).
    (g) NON-EXISTENT cwd → NoOpStore "none"; reason mentions "resolved"/"exist" (realpathSync ENOENT →
        fail-safe). DOCUMENTS the behavior change (old (a) asserted 'cas').
    (h) detection issues ZERO execFile calls (no git command of any kind): create a git dir (mkdir .git),
        `const spy = vi.spyOn(child_process, "execFile"); await detectAndCreate(gitDir,...);
        expect(spy).not.toHaveBeenCalled(); spy.mockRestore();` — the explicit "no rev-parse" sentinel.
  - IMPLEMENTATION DETAIL for each (see Pattern block below for the exact temp-dir setup). Reuse the
    existing `dirs.push(...)` + afterEach chmod/rm pattern. For (c)/(d)/(g) you do NOT need a git repo or
    storage — push the temp sessionDir to dirs[] for cleanup.
  - NAMING: keep the lettered (a)–(h) style; each `it()` title cites what it proves (lexical/forbidden/
    no-upward-walk/fail-safe/no-exec). Match the file's existing comment density (a one-line // above each).
  - DEPENDENCIES: Task 6 (imports: vi, homedir, child_process) must land first.
  - GOTCHA: the forbidden tests (c)/(d) MUST pass a real temp sessionDir (or storageDir) even though the
    gate short-circuits before resolveStorageDir — so cleanup is uniform + to avoid any edge case. (The
    forbidden gate returns before storage resolution regardless, but a real temp dir keeps the test honest.)

Task 9: VALIDATE (full)
  - RUN: `npm run typecheck` → clean (confirms test import edits + the spy typing + the reworked block).
  - RUN: `npx vitest run test/store.test.ts` → the reworked (a)–(h) green AND the AsyncMutex + type-shapes
    + NoOpStore blocks green (untouched). PRIMARY behavioral gate.
  - RUN: `npm test` → FULL suite green, including test/integration/revert-{git,cas,explicit,edge}.test.ts
    (GOTCHA #10 — they call detectAndCreate on real repos; lexical .git keeps them passing).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the reworked detectAndCreate body (see Task 2; this is the canonical reference shape):
export async function detectAndCreate(
  cwd: string,
  revertConfig: MulliganConfig["revert"],
  sessionDir?: string | null,
): Promise<SnapshotStore> {
  try {
    // (1) Canonicalize the workspace root. Fail-safe: realpathSync throws on ENOENT/unreadable → NoOpStore.
    let root: string;
    try {
      root = realpathSync(cwd);
    } catch {
      return new NoOpStore(
        "workspace root could not be resolved (path does not exist or is unreadable)",
      );
    }
    // (2) Forbidden-root gate — BEFORE any backend selection (spec/14 §2 SAFETY INVARIANT).
    if (isForbiddenRoot(root)) {
      return new NoOpStore(
        "workspace root is forbidden (home/system root); revert refused",
      );
    }
    // (3) Git detection = LEXICAL. .git may be a file (worktree/submodule) or dir — existsSync covers both.
    //     NO rev-parse, NO upward walk. Workspace root is realpath(cwd), full stop (spec/14 §2).
    if (existsSync(join(root, ".git"))) {
      const spec = "./git.js"; // NON-LITERAL specifier (forward-compat cast) — GOTCHA #6
      const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
      return new mod.GitBackend(root, revertConfig, sessionDir); // ← root (canonical), NOT cwd
    }
    // (4) CAS branch — flow unchanged; resolveStorageDir + mkdir -p + W_OK (spec/14 §2, §8).
    const storageDir = resolveStorageDir(revertConfig.storageDir, sessionDir, root); // ← root
    try {
      await mkdir(storageDir, { recursive: true });
      await access(storageDir, constants.W_OK);
    } catch {
      return new NoOpStore("no git repo and storage dir not writable");
    }
    const spec = "./cas.js";
    const mod = (await import(spec)) as { CasBackend: CasBackendCtor };
    return new mod.CasBackend(root, revertConfig, sessionDir); // ← root (canonical), NOT cwd
  } catch (err) {
    // (5) E28 fail-open — detectAndCreate NEVER rejects.
    const msg = err instanceof Error ? err.message : String(err);
    return new NoOpStore(summarize(msg));
  }
}

// PATTERN — test (a) lexical .git detection (binary-free; create .git via mkdir, NOT git init):
it("(a) temp dir WITH .git → GitBackend (lexical .git detection; no rev-parse, no git init)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hasgit-"));
  dirs.push(dir);
  await mkdir(join(dir, ".git"));           // ← lexical .git (empty dir is enough; no git binary needed)
  const storageDir = await mkdtemp(join(tmpdir(), "git-store-"));
  dirs.push(storageDir);
  const cfg = { ...REVERT_CFG, storageDir };
  const store = await detectAndCreate(dir, cfg, null);
  expect(store.describe().backend).toBe("git");
});

// PATTERN — test (a2) .git as a FILE (worktree/submodule gitdir pointer) — existsSync covers both:
it("(a2) .git as a FILE (worktree/submodule) → GitBackend (existsSync covers file-or-dir)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtgit-"));
  dirs.push(dir);
  await mkdir(join(dir, ".git"));                         // ensure parent path exists if needed
  // overwrite .git with a FILE containing a gitdir pointer (as a real worktree's .git looks):
  await (await import("node:fs/promises")).writeFile(join(dir, ".git"), "gitdir: /tmp/whatever/.git/wt\n");
  const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "wt-store-")) };
  dirs.push(cfg.storageDir!);
  const store = await detectAndCreate(dir, cfg, null);
  expect(store.describe().backend).toBe("git");
});

// PATTERN — test (c) forbidden home (spec/14 §2 + §10):
it("(c) detectAndCreate(os.homedir(), …) → NoOpStore 'none' (forbidden root gate — spec §2/§10)", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "sess-"));
  dirs.push(sessionDir);
  const store = await detectAndCreate(homedir(), { ...REVERT_CFG, storageDir: null }, sessionDir);
  expect(store).toBeInstanceOf(NoOpStore);
  const desc = store.describe();
  expect(desc.backend).toBe("none");
  expect((desc.reason ?? "").toLowerCase()).toContain("forbidden");
});

// PATTERN — test (f) subdir under a parent WITH .git → cas (proves NO upward walk — the regression vector):
it("(f) subdir whose PARENT has .git but subdir does NOT → 'cas' (NO upward walk — spec §2 SAFETY INVARIANT)", async () => {
  const parent = await mkdtemp(join(tmpdir(), "gitparent-"));
  dirs.push(parent);
  await mkdir(join(parent, ".git"));        // parent IS a git repo (lexically)
  const subdir = join(parent, "subdir");
  await mkdir(subdir);                        // subdir is NOT (no .git inside it)
  const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "sub-store-")) };
  dirs.push(cfg.storageDir!);
  const store = await detectAndCreate(subdir, cfg, null);
  expect(store.describe().backend).toBe("cas"); // NOT promoted to parent → proves no upward walk
});

// PATTERN — test (h) no exec during detection (the explicit "no rev-parse" sentinel):
it("(h) detection issues ZERO execFile calls (no git command of any kind — spec §2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "noexec-"));
  dirs.push(dir);
  await mkdir(join(dir, ".git"));
  const cfg = { ...REVERT_CFG, storageDir: await mkdtemp(join(tmpdir(), "ne-store-")) };
  dirs.push(cfg.storageDir!);
  const spy = vi.spyOn(child_process, "execFile");
  try {
    await detectAndCreate(dir, cfg, null);
    expect(spy).not.toHaveBeenCalled();      // detection is realpathSync + existsSync + isForbiddenRoot only
  } finally {
    spy.mockRestore();
  }
});
// NOTE on (h): vi.spyOn(child_process, "execFile") wraps the namespace export. Detection makes zero exec
// calls, and the dynamic import + `new GitBackend(...)` ctor don't call exec either (init is deferred to
// first capture), so the spy stays uncalled. If spy-on-a-Node-built-in proves flaky in this vitest
// version, the BINARY-FREE design of tests (a)/(b)/(f) is itself the proof — they create .git via mkdir
// and assert backend selection WITHOUT requiring the git binary, which is impossible if detection called
// git. Drop test (h) to that framing rather than leaving a flaky spy.
```

### Integration Points

```yaml
CODE (src/snapshot/store.ts — the ONLY source file changed):
  - imports:  − `execFile as execFileCb` (node:child_process), − `promisify` (node:util),
              − `const execFile = promisify(execFileCb)` (all 3 dead after removing the rev-parse probe)
              + `join` in the node:path destructure
              + `import { realpathSync, existsSync } from "node:fs"` (SYNC fs)
              + `import { isForbiddenRoot } from "./paths.js"` (T1.S1 export)
  - detectAndCreate body: rewritten to realpath → forbidden gate → lexical .git → cas branch → fail-open;
              passes `root` (canonical) to resolveStorageDir + both ctors; outer E28 catch preserved
  - docs:     section header (~254), GitBackendCtor (~263), detectAndCreate JSDoc (~408), body (~444)
              rewritten — no "rev-parse"/"ONLY git command"; cite @spec/14 §2 + §10

TESTS (test/store.test.ts — reworked):
  - imports:  − execFile/promisify/execFileCb (dead); + `vi` in vitest import; + `homedir` in node:os;
              + `import * as child_process from "node:child_process"` (spy)
  - detectAndCreate describe block: reworked to (a)–(h) matrix (lexical/forbidden/no-upward-walk/fail-safe/no-exec)
  - REVERT_CFG + AsyncMutex + type-shapes + NoOpStore blocks: UNCHANGED

NO CHANGES TO: src/snapshot/{paths,git,cas}.ts, README.md, test/integration/*, any other src/test file.
  - git.ts ctor/ensureInit rewrite + restore guard = P1.M1.T3.S1/S2 (separate subtask).
  - cas.ts realpath ctor + restore guard = P1.M1.T4.S1 (separate subtask).
  - integration subdir assertion = P1.M2.T1.S1; README safety paragraph = P1.M2.T2 (Mode B docs).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The single source gate (TS + vitest project; NO ruff/mypy/eslint configured — do not invent lint cmds):
npm run typecheck        # = tsc --noEmit (strict, ESNext)
# Expected: zero errors. Confirms: the import edits resolve (realpathSync/existsSync/join/isForbiddenRoot);
# the removed execFile leaves no dangling reference; the non-literal dynamic-import cast still type-checks;
# the test's `vi`/`child_process`/`homedir` imports resolve; the spy typing is valid.
# If tsc errors "Cannot find name 'realpathSync'/'existsSync'/'join'/'isForbiddenRoot'" → Task 1 import edits
# didn't land. If "X is declared but never read" on execFile/promisify → you left a dead import (remove it).
```

> NOTE: this is a TypeScript + vitest project. `package.json` scripts are `test`, `typecheck`, `smoke`,
> `prepublishOnly`. There is no ruff/mypy/eslint/biome — do not invent lint commands. Use
> `npm run typecheck` for the type gate and `npm test` for the behavioral gate.

### Level 2: Unit Tests (Component Validation)

```bash
# The focused suite (this task's deliverable):
npx vitest run test/store.test.ts
# Expected: the reworked detectAndCreate (a)–(h) block is fully green AND the pre-existing AsyncMutex,
# type-shapes, and NoOpStore describe blocks remain green (they are untouched). If (c)/(d) fail with
# backend 'git'/'cas' instead of 'none' → the forbidden gate isn't reached BEFORE backend selection
# (Task 2 ordering bug). If (g) returns 'cas' → realpathSync's catch isn't returning NoOpStore. If (h)
# shows spy.toHaveBeenCalled → some residual exec call remains (should be impossible after removing execFile).

# Full suite (catches any cross-file regression — esp. the integration revert-*.test.ts):
npm test                 # = vitest run (all test files)
# Expected: all green, INCLUDING test/integration/revert-{git,cas,explicit,edge}.test.ts. Those call
# detectAndCreate(realRepoDir, …) and assert backend "git"/"cas" — with lexical .git detection a real
# `git init`'d repo has a .git dir → existsSync true → GitBackend → still passes. If an integration test
# breaks, it is NOT this detection logic (they use real repos) unless it relied on non-existent-cwd→cas.
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the detection safety invariants hold at runtime (the spec/14 §10 "Safety (non-negotiable)" clause):
node --input-type=module -e "
  import { detectAndCreate } from './src/snapshot/store.js';
  import { homedir } from 'node:os';
  import { mkdtemp, mkdir } from 'node:fs/promises';
  import { join } from 'node:path';
  const cfg = { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:'cas', storageDir:null,
    maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64, excludeGlobs:['.git','node_modules'] };
  const sess = await mkdtemp(join((await import('node:os')).tmpdir(),'sess-'));
  console.log('home   :', (await detectAndCreate(homedir(), cfg, sess)).describe().backend, '(expect none)');
  console.log('/      :', (await detectAndCreate('/', cfg, sess)).describe().backend, '(expect none)');
  console.log('noexist :', (await detectAndCreate('/no/such/dir', cfg, sess)).describe().backend, '(expect none)');
  const gitdir = await mkdtemp(join((await import('node:os')).tmpdir(),'git-'));
  await mkdir(join(gitdir,'.git'));
  console.log('gitdir :', (await detectAndCreate(gitdir, cfg, sess)).describe().backend, '(expect git)');
"
# Expected: none / none / none / git. (OPTIONAL — the vitest block is authoritative; this is a sanity check.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the diff is LOCALIZED — only detectAndCreate + doc comments + imports changed in store.ts:
git diff src/snapshot/store.ts
# Expected: the diff shows ONLY (1) the import edits (−execFile×3, +join/realpathSync/existsSync/isForbiddenRoot),
# (2) the detectAndCreate body rewrite, (3) the 4 doc-comment rewrites. It must NOT touch SnapshotStore /
# RestoreOpts / RestoreResult / AsyncMutex / NoOpStore / GitBackendCtor / CasBackendCtor / resolveStorageDir /
# summarize. If it does, revert that hunk (those are UNCHANGED).

# Confirm NO rev-parse / execFile survives in store.ts (the regression vector is gone):
grep -nE "rev-parse|execFile|promisify|child_process" src/snapshot/store.ts
# Expected: the ONLY match is the SnapshotStore-interface JSDoc prose at lines ~53-54 ("await
# child_process.execFile without freezing the Pi event loop") — that describes the BACKENDS' async shape,
# NOT detection, and stays. There must be NO `execFile(` call, NO `rev-parse`, NO `promisify`, NO import of
# child_process/promisify. If any real call survives, detection still issues a git command (regression).

# Adversarial: confirm detection makes zero git calls by grepping for ANY git-CLI invocation path:
grep -nE '"git"' src/snapshot/store.ts
# Expected: ZERO matches (the rev-parse probe was the only `"git"` literal; it is gone).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (imports resolve; no dangling execFile; spy typing valid).
- [ ] `npx vitest run test/store.test.ts` green (reworked (a)–(h) + all pre-existing blocks).
- [ ] `npm test` (full suite) green — including `test/integration/revert-*.test.ts`.

### Feature Validation

- [ ] `detectAndCreate` issues zero `execFile` calls (grep `"git"` in store.ts → no matches; test (h) spy green).
- [ ] Temp dir WITH `.git` (dir OR file) → backend `"git"`.
- [ ] Temp dir WITHOUT `.git` → backend `"cas"`.
- [ ] `detectAndCreate(os.homedir(),…)` → `NoOpStore` `"none"`, reason mentions "forbidden".
- [ ] `detectAndCreate("/",…)` → `NoOpStore` `"none"`, reason mentions "forbidden".
- [ ] `detectAndCreate(nonExistentDir,…)` → `NoOpStore` `"none"` (realpathSync ENOENT fail-safe).
- [ ] `detectAndCreate(subdirUnderGitParent,…)` → `"cas"` (NO upward walk — the regression vector closed).
- [ ] `root` (canonical) passed to `resolveStorageDir` + both backend constructors (grep `GitBackend(root` / `CasBackend(root`).
- [ ] Outer E28 try/catch preserved — `detectAndCreate` NEVER rejects.

### Code Quality Validation

- [ ] The 3 dead execFile imports removed from store.ts; the 4 doc comments + GitBackendCtor doc rewritten.
- [ ] Doc comments cite `@spec/14 §2` Detection + SAFETY INVARIANT + `§10`; no "rev-parse"/"ONLY git command".
- [ ] Non-literal dynamic-import specifiers preserved (GOTCHA #6) for both backends.
- [ ] NoOpStore class is byte-identical (only how detectAndCreate constructs it changed — GOTCHA #9).
- [ ] REVERT_CFG + AsyncMutex + type-shapes + NoOpStore describe blocks in store.test.ts are byte-identical.
- [ ] Reason strings match the spec exactly ("…could not be resolved…", "…forbidden (home/system root); revert refused", "no git repo and storage dir not writable").

### Documentation & Deployment

- [ ] Mode A doc comments (in-code) rewritten to match the new detection (rides with this work — DOCS clause).
- [ ] No README change here (P1.M2.T2 owns the Mode B safety paragraph — separate subtask).
- [ ] No user-facing/config/API surface change (detectAndCreate signature + return type unchanged).

---

## Anti-Patterns to Avoid

- ❌ Don't touch `git.ts`/`cas.ts`/`paths.ts`/README/integration tests — those are P1.M1.T1.S1 (done in
  parallel) / P1.M1.T3 / P1.M1.T4 / P1.M2.T1 / P1.M2.T2. This task is store.ts + store.test.ts ONLY.
- ❌ Don't re-implement `isForbiddenRoot` in store.ts — import it from `./paths.js` (T1.S1 contract). The
  forbidden set is the predicate's job; detection just branches on the boolean.
- ❌ Don't pass raw `cwd` to `isForbiddenRoot` or the backend constructors — pass `root` (the realpathSync
  result). The predicate's contract assumes a canonicalized input; the backends key on the launch dir.
- ❌ Don't remove the outer E28 try/catch (detectAndCreate MUST NEVER reject) — and don't let realpathSync's
  throw escape (the inner NARROW catch returns NoOpStore "could not be resolved").
- ❌ Don't replace the non-literal dynamic-import specifier (`const spec = "./git.js"`) with a literal —
  tsc/rollup/vitest statically resolve literal import() args and would fail/transform eagerly (GOTCHA #6).
- ❌ Don't use `statSync().isDirectory()` for `.git` detection — `.git` may be a FILE (worktree/submodule);
  `existsSync` covers both (GOTCHA #7). Pin this with test (a2).
- ❌ Don't leave the dead `execFile`/`promisify`/`execFileCb` imports in store.ts (or store.test.ts) —
  tsc/lint flags unused imports; they're the tell-tale of an incomplete rewrite (GOTCHA #1).
- ❌ Don't keep the old test (a) assertion "non-existent cwd → cas" — it's now WRONG (realpathSync ENOENT
  → none). The behavior change is deliberate; capture it in test (g).
- ❌ Don't run `git init` in the reworked tests — create `.git` via `mkdir` (binary-free; that itself proves
  detection issues no git command). The old `git --version` PATH guard is gone too.
- ❌ Don't "fix" Windows drive-roots in detection — the forbidden predicate is POSIX-oriented by design
  (dirname==="/"); broadening it silently changes safety semantics (GOTCHA #12).
- ❌ Don't forget the 4 doc-comment rewrites (section header, GitBackendCtor, detectAndCreate JSDoc, body
  comment) — leaving "rev-parse"/"ONLY git command" prose is a stale-doc contradiction a reviewer flags.

---

## Confidence Score: 9/10

**Why 9**: The exact current `detectAndCreate` body, the exact dead imports (grep-confirmed execFile is
used ONLY at line 446), the exact new algorithm (verbatim from the work-item contract), the exact 4 doc-
comment regions to rewrite (located by line + quoted), the exact test matrix (from the plan's
test_strategy.md), and the spec citations (§2 + §10 already in the PRD context) are all pinned. The
backends are confirmed to exist + ship (dynamic imports resolve → tests assert real "git"/"cas"). The
T1.S1 dependency is stated as a clean import contract.

**The −1 (residual risk)**: two spots require judgment on first pass:
1. The `vi.spyOn(child_process, "execFile")` no-exec sentinel (test h). Spying on a Node built-in's
   namespace export usually works in vitest, but if it's flaky in this version, the implementer falls back
   to the binary-free framing (the import removal in store.ts is the authoritative structural proof —
   documented in the test's NOTE). Either path satisfies the work item's "no rev-parse" requirement.
2. The behavior change (non-existent cwd: 'cas' → 'none') is deliberate but must be captured in test (g)
   and the describe-block header comment, or a future reader may "restore" the old (wrong) assertion.

Behavioral correctness is fully pinned by the reworked (a)–(h) matrix; structural correctness (no exec)
is pinned by the grep validation + the import removal. No design decision is left to the implementer's
discretion beyond the two flagged judgments, both with documented fallbacks.