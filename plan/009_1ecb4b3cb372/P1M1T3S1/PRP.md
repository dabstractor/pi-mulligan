---
name: "P1.M1.T3.S1 — Rewrite GitBackend constructor + ensureInit + remove sourceGitDir + update docs + rework git.test.ts"
description: >
  Rewrite `src/snapshot/git.ts` `GitBackend` so it issues ZERO git commands of any kind against the
  user's repository: the constructor canonicalizes `cwd` via a new `realpathSafe` helper
  (`realpathSync` → `resolve` fallback), `ensureInit()` drops its two `rev-parse --show-toplevel` /
  `--absolute-git-dir` exec calls and sets `this.repoRoot = this.cwd` unconditionally (no upward
  discovery, no `top || cwd` fallback), the dead `sourceGitDir` field is deleted entirely, and the
  shadow repo is now keyed by `realpath(cwd)` (launch-directory keying — NOT repo-root keying). The
  class-header guarantee #1 + `shadowKey`/`init`/`ensureInit` JSDoc are rewritten to state "no
  command — read or write — is ever issued against the user's git". `test/git.test.ts` is reworked:
  the makeExec rev-parse stubs are removed (the fake must NOT match rev-parse for non-shadow
  commands), `expectedShadow` keys by `/fake/cwd`, the GIT_WORK_TREE + source-.git assertions flip
  `/fake/repo`→`/fake/cwd`, the two `throwOn{cmd:"rev-parse",call:3}` has() tests become `call:1`,
  and the "five guarantees" test asserts ZERO non-shadow-env commands. This closes the highest-
  severity regression vector (spec/14 §2 SAFETY INVARIANT: upward repo discovery via rev-parse once
  resolved the workspace to `$HOME`, and `restore()` then wiped the home tree). Out of scope: the
  `restore()` forbidden-root entry guard (T3.S2, consumes `isForbiddenRoot`), cas.ts (T4),
  store.ts detectAndCreate (T2.S1, parallel), README (M2.T2), integration tests (M2.T1).
---

## Goal

**Feature Goal**: `GitBackend` resolves its workspace root to `realpath(cwd)` with **zero git
commands** against the user's repo. The constructor canonicalizes `cwd` defensively; `ensureInit()`
sets `repoRoot = cwd` unconditionally (no `rev-parse`, no upward walk, no `top || cwd` fallback); the
dead `sourceGitDir` field is gone; the shadow repo is keyed by the launch directory. Every doc comment
is rewritten to reflect "no command — read or write — against the user's git" + "realpath(cwd) root" +
"launch-directory keying". The unit tests are reworked to pin all of this.

**Deliverable** (exactly two file edits, both in scope of THIS subtask only):
1. `src/snapshot/git.ts`:
   - Imports: EXTEND line 10 (`import { existsSync } from "node:fs"`) to `existsSync, realpathSync`.
     Add a new **module-private** `realpathSafe` helper. (Decision below: do NOT import
     `isForbiddenRoot` here — see GOTCHA #1.) Lines 1, 2, 11, 26 (execFile/promisify/join+resolve/
     execFileDefault) STAY — they back the DI seam default + storageDir resolution.
   - Constructor (line 235): `this.cwd = resolve(cwd)` → `this.cwd = realpathSafe(cwd)`.
   - `ensureInit()` (lines 282–293): DELETE the two `rev-parse` exec calls; set
     `this.repoRoot = this.cwd;` unconditionally; DELETE `this.sourceGitDir = gitDir;`; KEEP the
     `this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` line (now hashes this.cwd)
     and the `git init --bare` existsSync-gate block (lines 294–303) UNCHANGED.
   - Field (line 216): DELETE `private sourceGitDir!: string;` entirely.
   - Docs: rewrite (a) class-header guarantee #1 (lines 37–38), (b) the REPO-ROOT KEYING block
     (lines 49–51) → LAUNCH-DIRECTORY KEYING, (c) `shadowKey` JSDoc (~133–138), (d) `init()` JSDoc
     (lines 256–260), (e) `ensureInit()` JSDoc (lines 266–277). All five: drop every "rev-parse" /
     "read-only command against the source repo" phrase; state "no command of any kind against the
     user's git" + "realpath(cwd) root" + cite `@spec/14 §3` + SAFETY INVARIANT.
2. `test/git.test.ts`:
   - `makeExec` (lines 75–77): DELETE the two `rev-parse --show-toplevel` / `--absolute-git-dir`
     canned-stdout stubs (the fake must NOT match rev-parse for non-shadow commands).
   - DELETE the SAME duplicated stubs inline in `throwingExec` (lines 255–257) and `racingExec`
     (lines 305–307).
   - `expectedShadow` (line 127): default `repoRoot = "/fake/repo"` → `"/fake/cwd"` + update its doc.
   - Flip `GIT_WORK_TREE` assertions `/fake/repo`→`/fake/cwd` (lines 166, 378).
   - Flip "NEVER the source git dir" negative assertions `/fake/repo/.git`→`/fake/cwd/.git`
     (lines 228, 639, 654, 804).
   - Flip `throwOn { cmd: "rev-parse", call: 3 }` → `call: 1` in BOTH has() tests (lines 422, 427)
     (ensureInit no longer issues 2 rev-parse calls before has()'s --verify).
   - Rework test #1 (lines 132–141): "issues rev-parse --show-toplevel against the USER repo" →
     assert ZERO `rev-parse --show-toplevel`/`--absolute-git-dir` calls + ZERO cwd-only-env commands.
   - Rework "five guarantees" test #2 (line 232): "the ONLY command without the shadow env is the
     read-only rev-parse" → assert ZERO commands run without the shadow env.

**Success Definition**:
- `ensureInit()` issues **zero** `rev-parse` calls and **zero** commands whose `opts` lack the shadow
  `GIT_DIR`/`GIT_WORK_TREE` env — every exec goes through `shadowEnv()`.
- `this.repoRoot === realpathSafe(this.cwd)` (the canonicalized launch dir); `sourceGitDir` no longer
  exists in the file (grep returns nothing).
- `shadowDir === join(storageDir, sha256(realpath(cwd)).slice(0,16))`.
- `git.test.ts` is green after rework; `npm run typecheck` + `npm test` (incl. integration
  `revert-*.test.ts`) all green. `capture`/`dirtyCheck`/`changedPaths`/`has`/`retire`/`restore`/`gc`/
  `destroy`/`describe`/`shadowEnv` mechanism is UNCHANGED (only what they read for repoRoot changed).

## User Persona (if applicable)

N/A — this is internal safety-hardening of a snapshot backend (no end-user surface).

## Why

- **It removes the regression vector of highest severity.** spec/14 §2 SAFETY INVARIANT:
  "There is **no** code path — in detection, init, capture, or restore — that traverses upward to
  find an enclosing repository. ... Re-introducing upward repo discovery anywhere in the snapshot
  subsystem is a regression of the highest severity." The current `ensureInit()` issues
  `git rev-parse --show-toplevel` (which walks UP the tree to find `.git`) and sets
  `repoRoot = top || cwd`. This is exactly the hazard: when `cwd` was `$HOME` (not a git repo),
  `top` was empty → `repoRoot = $HOME` → a later `restore()` reverted/deleted the entire home tree.
  Setting `repoRoot = realpath(cwd)` unconditionally makes the hazard structurally impossible.
- **It completes guarantee #1's upgrade from "read-only exception" to "no command at all".** spec/14
  §3 guarantee #1 now reads: "No command of any kind — read or write — is ever issued against the
  *user's* git. The workspace root is `realpath(cwd)` and needs no `rev-parse` to resolve it." The old
  GitBackend allowed ONE read-only `rev-parse` exception; this removes it entirely.
- **It rides with the detection rewrite (T2.S1).** `detectAndCreate` (parallel) now passes the
  canonical `realpath(cwd)` root to the `GitBackend` constructor and selects git by a LEXICAL
  `existsSync(join(root,".git"))` — no rev-parse. GitBackend must match: it must NOT re-introduce
  rev-parse in init. The two halves together make the SAFETY INVARIANT end-to-end.
- **It is prerequisite for T3.S2.** The `restore()` forbidden-root entry guard (T3.S2) consumes
  `isForbiddenRoot(repoRoot)`; that guard is only correct if `repoRoot` is the canonical launch dir
  (not an upward-walked repo root). This task pins `repoRoot = realpath(cwd)` so T3.S2's guard holds.

## What

A surgical rewrite of `GitBackend`'s root-resolution + its docs + the tests that pin them. The new
`ensureInit()` body (verbatim shape — the memo/catch scaffolding is UNCHANGED):

```ts
private ensureInit(): Promise<void> {
  if (this.initPromise) return this.initPromise;            // memoize: concurrent first-calls share ONE init
  this.initPromise = (async () => {
    // repoRoot is the canonical launch directory — NO rev-parse, NO upward discovery (spec/14 §2).
    // this.cwd was already canonicalized by realpathSafe() in the constructor.
    this.repoRoot = this.cwd;
    this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));   // keyed by launch dir
    // lazily init the SHADOW repo (idempotent — skip if it already exists on disk). GIT_DIR alone
    // redirects the new object DB + refs to the shadow repo → guarantee #2.
    if (!existsSync(this.shadowDir)) {
      await this.exec("git", ["init", "--bare"], {
        env: { ...process.env, GIT_DIR: this.shadowDir },
        maxBuffer: 16 * 1024 * 1024,
      });
    }
  })().catch((e) => {
    this.initPromise = null;                                  // a failed init can retry next call
    throw e;
  });
  return this.initPromise;
}
```

The new module-private helper (place it near `shadowKey`, ~line 142):

```ts
/**
 * Canonicalize `cwd` to its real absolute path WITHOUT following-symlinks surprises:
 * `realpathSync` resolves the whole chain; on ANY failure (ENOENT / unreadable / symlink-loop —
 * e.g. a direct unit test constructing GitBackend with a non-existent /fake/cwd) it falls back to
 * `resolve(cwd)`. Defense-in-depth: detectAndCreate (P1.M1.T2.S1) ALREADY realpathSync's cwd before
 * constructing GitBackend, so the production path's realpathSync never throws; the fallback exists
 * for direct-test construction + any future caller. MODULE-PRIVATE.
 */
function realpathSafe(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}
```

### Success Criteria

- [ ] `ensureInit()` issues **zero** `rev-parse` calls (grep the test: no `rev-parse` with
      `--show-toplevel`/`--absolute-git-dir` in recorded calls; only `rev-parse --verify` from `has()`,
      and it carries the shadow env).
- [ ] **Zero** recorded commands lack the shadow env — every `this.exec(...)` outside `ensureInit`'s
      (now-removed) rev-parse goes through `shadowEnv()`.
- [ ] `this.repoRoot === realpathSafe(this.cwd)`; `sourceGitDir` does not exist in git.ts (grep empty).
- [ ] `shadowDir` keys by `sha256(realpath(cwd)).slice(0,16)` — `expectedShadow` in tests uses `/fake/cwd`.
- [ ] The 5 doc regions (header guarantee #1, REPO→LAUNCH keying block, `shadowKey` JSDoc, `init()`
      JSDoc, `ensureInit()` JSDoc) contain NO "rev-parse against the source/user repo" language and
      cite `@spec/14 §2` (SAFETY INVARIANT) + `§3` (guarantee #1).
- [ ] `npm run typecheck`, `npx vitest run test/git.test.ts`, and `npm test` (incl. integration
      `revert-*.test.ts`) all green.
- [ ] `capture`/`dirtyCheck`/`changedPaths`/`has`/`retire`/`restore`/`gc`/`destroy`/`describe`/
      `shadowEnv`/`refForLabel`/`scanForCaps` are byte-identical except for reading the now-canonical
      `this.repoRoot`.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
target lines (verified against current source), the exact old→new text for every edit, the new
`ensureInit` body verbatim, the new `realpathSafe` helper verbatim, the exact 5 doc regions to
rewrite (located by line), the complete test-rework inventory (8 distinct change sites, each with
its line number + old/new value), and the spec citations are all below. The T2.S1 dependency is
stated as a contract (detectAndCreate passes canonical `root`; GitBackend's realpathSafe makes that
idempotent).

### Documentation & References

```yaml
# MUST READ — the spec authority for the rewrite
- file: spec/14-working-tree-revert.md
  why: "§2 SAFETY INVARIANT is THE rule this rewrite enforces: workspace root = realpath(cwd); NO
        upward discovery; rev-parse --show-toplevel/--git-dir/--absolute-git-dir are FORBIDDEN in
        detection/init. §3 GitBackend + the FIVE git-safety guarantees: guarantee #1 is now 'No
        command of any kind — read or write — is ever issued against the user's git' (the old
        read-only-rev-parse exception is REMOVED); the repo-root keying paragraph is rewritten to
        launch-directory keying ('one shadow repo per launch directory — keyed by realpath(cwd) ...
        The repo-root-keyed sharing across subdirectory launches is intentionally NOT used: it
        required upward traversal ... which is the hazard closed by the SAFETY INVARIANT'). §10 is
        the testing safety clause: 'git command construction (assert NO command of any kind — read or
        write — is ever issued against the user's .git; that repoRoot === realpath(cwd); and that
        rev-parse --show-toplevel/--absolute-git-dir are never issued)'."
  section: "§2 (the 'SAFETY INVARIANT — non-negotiable' block + the GitBackend 'Detection & init'
            bullets + the 'five guarantees' #1), §3 (GitBackend, esp. the 'REPO-ROOT KEYING → launch
            dir' change + guarantee #1), §10 (the 'git command construction' unit-test bullet)"
  critical: "§3 EXPLICITLY states the shadow repo is 'one shadow repo per launch directory — keyed by
             realpath(cwd)' and that repo-root sharing is 'intentionally NOT used'. The class-header
             guarantee #1 + shadowKey doc must say exactly this. Do NOT re-introduce 'repo-root
             keying' or 'subdirectory launches share one shadow repo' anywhere."

# MUST READ — THE source file being rewritten (read it FULLY first)
- file: src/snapshot/git.ts
  why: "THE file modified. Imports at lines 1/2/10/11/26. Header DESIGN comment 33-51 (guarantee #1
        at 37-38; REPO-ROOT KEYING at 49-51). shadowKey + its JSDoc at 133-141. sourceGitDir field
        at 216 (DELETE). Constructor this.cwd=resolve(cwd) at 235. init() JSDoc 256-260. ensureInit()
        JSDoc 266-277 + body 278-304 (the 2 rev-parse calls at 282+287; repoRoot assignment at 291;
        sourceGitDir assignment at 292; shadowDir join at 293; git init --bare block 294-303 KEEP).
        shadowEnv() (mechanism UNCHANGED) reads this.repoRoot + this.shadowDir. The capture/dirty/
        changedPaths/has/retire/restore/gc/destroy methods all call ensureInit() first then use
        this.repoRoot via shadowEnv() — UNCHANGED."
  pattern: "The memoized-ensureInit shape (`if (this.initPromise) return this.initPromise; this.initPromise = (async()=>{...})().catch(e=>{this.initPromise=null;throw e;})`) is PRESERVED — only the inner async body's first 3 statements change (delete 2 rev-parse calls; repoRoot=this.cwd; delete sourceGitDir assignment). The git init --bare existsSync-gate block is UNCHANGED."
  gotcha: "resolve (line 11) is STILL USED — the constructor resolves storageDir via resolve(): `this.storageDir = resolve(revertConfig.storageDir)` / `resolve(sessionDir,'mulligan')`. Do NOT drop resolve from the node:path import. realpathSafe itself falls back to resolve(). execFile/promisify/execFileDefault (lines 1/2/26) STAY — they back the DI-seam default (`this.exec = deps?.exec ?? execFileDefault`); capture/dirty/restore/etc. all use this.exec."

# MUST READ — THE test file being reworked
- file: test/git.test.ts
  why: "THE test file modified. makeExec rev-parse stubs at 75-77 (DELETE). expectedShadow at 126-127
        (default repoRoot /fake/repo → /fake/cwd). GIT_WORK_TREE assertions at 166+378 (/fake/repo →
        /fake/cwd). 'NEVER source git dir' negative assertions at 228+639+654+804 (/fake/repo/.git →
        /fake/cwd/.git). throwOn{cmd:'rev-parse',call:3} at 422+427 (→ call:1). Duplicated rev-parse
        stubs in throwingExec(255-257)+racingExec(305-307) (DELETE). Test #1 'issues rev-parse
        --show-toplevel against the USER repo' at 132-141 + 'five guarantees' test #2 'the ONLY
        command without the shadow env is the read-only rev-parse' at 232 — both PREMISES are now
        FALSE; rework (see Implementation Tasks Task 8)."
  pattern: "House idiom: DI seam (deps.exec recording fake) + canned stdout by args[0]; NO real fs,
            NO real git. Tests assert on recorded `calls` (file/args/opts). The shadow-env + maxBuffer
            live in `opts.env`/`opts.maxBuffer`. findCmd(calls,cmd) + writeCalls(calls) helpers. BASE_CFG
            + CFG_WITH_EXCLUDES + emptyScan + makeBackend/makeBackendWithUnlink are REUSED unchanged."
  gotcha: "BEHAVIOR CHANGE — the test's cwd is '/fake/cwd' (a non-existent path). realpathSafe('/fake/cwd')
           → realpathSync throws ENOENT → fallback resolve('/fake/cwd')='/fake/cwd'. So repoRoot IS
           '/fake/cwd' (NOT '/fake/repo' as the old rev-parse stub fabricated). expectedShadow + every
           GIT_WORK_TREE + source-.git assertion MUST flip to /fake/cwd. The has() throwOn tests: with
           the 2 rev-parse stubs gone, the FIRST rev-parse call is has()'s --verify — so call:3 (which
           assumed 2 preceding rev-parse calls) becomes call:1. LEAVING call:3 makes the throw never
           fire → has() wrongly returns true → test fails."

# CONTRACT — the parallel sibling (P1.M1.T2.S1) that feeds this backend
- file: plan/009_1ecb4b3cb372/P1M1T2S1/PRP.md
  why: "Defines detectAndCreate's NEW behavior: realpathSync(cwd)→root; isForbiddenRoot(root) gate;
        lexical existsSync(join(root,'.git'))→GitBackend; passes the CANONICAL `root` to
        `new GitBackend(root, revertConfig, sessionDir)`. Because root is already realpath'd,
        GitBackend's realpathSafe(root) is IDEMPOTENT (realpathSync of an already-real path returns
        it unchanged) — smooth handoff, no double-resolution cost, no conflict. Treat as CONTRACT:
        assume it lands exactly as specified."
  section: "Goal (the 5-step decision tree) + GOTCHA #5 ('PASS root to BOTH backend constructors')"
  critical: "detectAndCreate passes `root` (canonical) as the ctor's `cwd` param. Your realpathSafe
             makes that idempotent. Do NOT change the ctor SIGNATURE (`cwd, revertConfig, sessionDir?,
             deps?`) — T2.S1 calls `new GitBackend(root, revertConfig, sessionDir)` (3 args, no deps)."

# CONTRACT — isForbiddenRoot (the symbol T3.S2 consumes; NOT imported here — see GOTCHA #1)
- file: plan/009_1ecb4b3cb372/P1M1T1S1/PRP.md
  why: "Defines isForbiddenRoot EXACTLY (true for homedir()/`/`/depth-1/empty/dot; exported from
        ./paths.js). It is consumed by T3.S2's restore() entry guard — NOT by T3.S1. Listed here so
        the implementer knows why it is NOT imported in this subtask."
  pattern: "T3.S2 will extend the existing `import {...} from './paths.js'` (line 23) to add
            isForbiddenRoot when wiring the restore() guard. Do NOT import it now."

# READ — the canonical change inventory (authoritative for the overall plan)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "Scopes git.ts to T3 (S1 = init/keying/guarantee/docs+tests; S2 = restore guard) and cas.ts to
        T4, store.ts to T2, README to M2.T2, integration to M2.T1. Confirms the per-subtask boundary
        so you do NOT over-reach into another subtask's file."
  section: "the src/snapshot/git.ts table (S1 vs S2 split)"
  critical: "Do NOT touch cas.ts, store.ts, paths.ts, README, or integration tests — each is a
             separate subtask with its own PRP."
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
├── git.ts       # ← REWRITE constructor + ensureInit + delete sourceGitDir + 5 doc regions + imports (THE source file)
├── paths.ts     # ← UNCHANGED (T1.S1 done; exports isForbiddenRoot — consumed by T3.S2, NOT here)
├── store.ts     # ← UNCHANGED HERE (T2.S1 parallel owns detectAndCreate; passes canonical root to GitBackend ctor)
└── cas.ts       # ← UNCHANGED HERE (T4 owns its restore guard)
test/
└── git.test.ts  # ← REWORK makeExec stubs + expectedShadow + GIT_WORK_TREE/source-.git/throwOn/call:N + 2 guarantee tests
```

### Desired Codebase tree

```bash
src/snapshot/
└── git.ts       # MODIFIED (constructor realpathSafe; ensureInit: −2 rev-parse, repoRoot=this.cwd, −sourceGitDir; −sourceGitDir field; +realpathSafe helper; +realpathSync import; 5 doc rewrites)
test/
└── git.test.ts  # MODIFIED (−3× rev-parse stubs; expectedShadow /fake/cwd; GIT_WORK_TREE×2 /fake/cwd; source-.git×4 /fake/cwd/.git; throwOn call:3→1 ×2; 2 guarantee tests reworked)
```
No new files. paths.ts / store.ts / cas.ts / README / integration tests are NOT touched (separate subtasks).

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — DECISION: do NOT import isForbiddenRoot in THIS subtask.
// The work-item RESEARCH NOTE lists it under "new imports", but the LOGIC steps (constructor/
// ensureInit/shadowKey/docs/test) consume ONLY realpathSafe. isForbiddenRoot is used by T3.S2's
// restore() entry guard (a SEPARATE planned subtask). tsconfig.json has NO noUnusedLocals (only
// strict + noImplicitAny) and there is NO eslint/biome config (only `tsc --noEmit`), so an unused
// import would NOT break the build — but it WOULD be flagged by a reviewer as dead. Keep this diff
// honest: import ONLY realpathSync. T3.S2 will trivially extend the existing
// `import { normalizeRelPath, isDangerousWorkspaceRel, resolveSafeWorkspacePath, DANGEROUS_DIRS }
//  from "./paths.js"` (line 23) to add isForbiddenRoot when it wires the guard.

// GOTCHA #2 — resolve (node:path) is STILL USED after this rewrite. The constructor resolves
// storageDir: `this.storageDir = resolve(revertConfig.storageDir)` and `resolve(sessionDir,'mulligan')`.
// realpathSafe's fallback is ALSO `resolve(cwd)`. Do NOT drop resolve from line 11's destructure
// (`import { join, resolve } from "node:path"` stays AS-IS). ONLY line 10 changes (add realpathSync).

// GOTCHA #3 — execFile/promisify/execFileDefault (lines 1/2/26) STAY. They back the DI-seam default:
// `this.exec = deps?.exec ?? (execFileDefault as GitExec)`. capture/dirtyCheck/changedPaths/has/retire/
// restore/gc/destroy ALL call this.exec. Removing them would break the default + every test that omits
// deps.exec (there are none that omit it, but production construction via detectAndCreate omits deps →
// gets execFileDefault). The rev-parse removal touches ensureInit's BODY, not the exec machinery.

// GOTCHA #4 — the memoized-ensureInit SCAFFOLDING is PRESERVED verbatim:
//   if (this.initPromise) return this.initPromise;
//   this.initPromise = (async () => { ...inner... })().catch((e) => { this.initPromise = null; throw e; });
//   return this.initPromise;
// ONLY the inner async body's FIRST statements change (delete 2 rev-parse exec calls; repoRoot=this.cwd;
// delete sourceGitDir assignment). The git init --bare existsSync-gate block at the END of the inner
// body is UNCHANGED. Do NOT restructure the memo/catch — concurrent first-captures depend on it.

// GOTCHA #5 — realpathSafe must be MODULE-PRIVATE (no `export`). It is a defense-in-depth fallback
// only: detectAndCreate (T2.S1) ALREADY realpathSync's cwd before constructing GitBackend, so the
// production realpathSync never throws. The fallback exists for DIRECT unit-test construction with a
// non-existent path (e.g. new GitBackend("/fake/cwd", …) in test/git.test.ts — realpathSync throws
// ENOENT → fallback resolve("/fake/cwd")). Place realpathSafe near shadowKey (~line 142).

// GOTCHA #6 — the test cwd "/fake/cwd" does NOT exist on disk → realpathSync THROWS → fallback
// resolve("/fake/cwd") = "/fake/cwd". So repoRoot === "/fake/cwd" (NOT the old rev-parse fabrication
// "/fake/repo"). This is WHY expectedShadow's default flips to "/fake/cwd" and every GIT_WORK_TREE +
// source-.git assertion flips too. If you forget ONE of these, a test asserts the wrong hash/path.

// GOTCHA #7 — the has() throwOn tests. OLD: ensureInit issued 2 rev-parse calls (show-toplevel +
// absolute-git-dir) BEFORE has()'s --verify, so the --verify was the 3rd rev-parse → throwOn call:3.
// NEW: ensureInit issues ZERO rev-parse, so has()'s --verify is the 1st rev-parse → throwOn call:1.
// Leaving call:3 means the throw NEVER fires → has() wrongly returns true → test fails. BOTH has()
// throwOn tests (lines 422 + 427) must flip to call:1.

// GOTCHA #8 — the makeExec fake must NOT match rev-parse --show-toplevel/--absolute-git-dir for
// non-shadow commands, because such commands NO LONGER EXIST. If you leave the stubs, the tests still
// pass (harmless canned stdout) BUT they would NOT catch a regression that re-introduces rev-parse
// (the fake would silently satisfy it). The spec §10 test clause demands the fake reject rev-parse
// for non-shadow commands — so DELETE the stubs (lines 75-77) AND the duplicated inline stubs in
// throwingExec (255-257) + racingExec (305-307). After deletion, makeExec returns "" for rev-parse
// (the default fallthrough), which is fine: has()'s --verify ignores stdout (only success/throw).

// GOTCHA #9 — capture()'s pipeline stubs (write-tree→"TREE123", commit-tree→"COMMIT456") STAY. They
// are NOT rev-parse; they back the capture/restore/retire/gc pipelines. Only the TWO rev-parse
// stubs (show-toplevel, absolute-git-dir) are deleted.

// GOTCHA #10 — the doc rewrite must use EXACT phrases. spec/14 §3 guarantee #1 is now verbatim:
//   "No command of any kind — read or write — is ever issued against the user's git."
// Do NOT soften to "no write command" (that was the OLD guarantee; the rev-parse exception is gone).
// The REPO-ROOT KEYING block becomes LAUNCH-DIRECTORY KEYING: "the shadow repo is keyed by
// realpath(cwd) (the launch directory)" + DROP the "subdirectory launches share one shadow repo"
// rationale (that rationale REQUIRED upward traversal — the hazard). Cite @spec/14 §2 + §3.

// GOTCHA #11 — shadowEnv() is UNCHANGED. It reads this.repoRoot + this.shadowDir and returns
// { env:{...process.env, GIT_DIR:this.shadowDir, GIT_WORK_TREE:this.repoRoot}, maxBuffer }. Since
// repoRoot is now realpath(cwd), GIT_WORK_TREE points at the launch dir — exactly what the spec wants.
// Do NOT touch shadowEnv(). Its JSDoc (which mentions repoRoot) stays accurate.

// GOTCHA #12 — POSIX orientation is BY DESIGN (inherited from isForbiddenRoot + realpath). On
// Windows, drive-roots are not specially handled — a documented limitation, NOT a defect. Do NOT add
// Windows handling here.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `SnapshotStore`, `RestoreOpts`, `RestoreResult`, `AsyncMutex`, `GitExec`,
`CapScan`, `GitBackendDeps`, `refForLabel`, `scanForCaps`, `shadowKey`, `shadowEnv` are all
UNCHANGED in shape. The `GitBackend` class loses ONE private field (`sourceGitDir`) and gains ONE
module-private helper (`realpathSafe`). `repoRoot` is still `private repoRoot!: string` — only its
assignment changes (`top || cwd` → `this.cwd`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts — imports (add realpathSync)
  - LOCATE line 10: `import { existsSync } from "node:fs";`
  - REPLACE with: `import { existsSync, realpathSync } from "node:fs";`
  - KEEP line 11 `import { join, resolve } from "node:path";` UNCHANGED (resolve still used — GOTCHA #2).
  - KEEP lines 1, 2, 26 (execFile/promisify/execFileDefault) — DI-seam default (GOTCHA #3).
  - DO NOT import isForbiddenRoot (GOTCHA #1 — T3.S2 owns it).
  - DEPENDENCIES: none (foundation for Task 2's realpathSafe).

Task 2: MODIFY src/snapshot/git.ts — add module-private realpathSafe helper
  - PLACE: immediately AFTER shadowKey() (after line 141, before scanForCaps) — co-located with the
    other root-resolution helper.
  - ADD (verbatim, from the "What" section above):
      /**
       * Canonicalize `cwd` ... (see "What" section). MODULE-PRIVATE.
       */
      function realpathSafe(cwd: string): string {
        try { return realpathSync(cwd); }
        catch { return resolve(cwd); }
      }
  - GOTCHA #5 (module-private, defense-in-depth fallback only).
  - DEPENDENCIES: Task 1 (realpathSync in scope).

Task 3: MODIFY src/snapshot/git.ts — constructor canonicalizes cwd
  - LOCATE line 235: `this.cwd = resolve(cwd);`
  - REPLACE with: `this.cwd = realpathSafe(cwd);`
  - WHY: realpath (not just resolve) — defense-in-depth (detectAndCreate already realpath'd, but direct
    test construction may pass non-canonical paths). GOTCHA #5/#6.
  - DEPENDENCIES: Task 2 (realpathSafe defined).

Task 4: MODIFY src/snapshot/git.ts — delete sourceGitDir field
  - LOCATE line 216: `  private sourceGitDir!: string;`
  - DELETE the entire line.
  - WHY: nothing reads it (grep-confirmed: only the field decl + 1 assignment + 2 doc-comment mentions,
    all removed in this PRP). The work item: "exists ONLY to record the rev-parse result; DELETE entirely."
  - DEPENDENCIES: none (the assignment that writes it is deleted in Task 5).

Task 5: MODIFY src/snapshot/git.ts — rewrite ensureInit() inner body
  - LOCATE the inner async body of ensureInit() (lines 280-303). Current first statements:
        const top = (await this.exec("git", ["rev-parse","--show-toplevel"], { cwd: this.cwd })).stdout.trim();
        const gitDir = (await this.exec("git", ["rev-parse","--absolute-git-dir"], { cwd: this.cwd })).stdout.trim();
        this.repoRoot = top || this.cwd;
        this.sourceGitDir = gitDir;
        this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));
  - REPLACE those 5 statements with 2:
        this.repoRoot = this.cwd;                                    // canonical launch dir — NO rev-parse (spec/14 §2)
        this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));
  - KEEP the trailing `if (!existsSync(this.shadowDir)) { await this.exec("git", ["init","--bare"], {env:{...process.env, GIT_DIR:this.shadowDir}, maxBuffer:16*1024*1024}); }` block UNCHANGED.
  - KEEP the memo/catch scaffolding (lines 279, 304-307) UNCHANGED — GOTCHA #4.
  - WHY: removes the ONLY commands against the user's git (guarantee #1 upgrade); repoRoot is now the
    canonical launch dir (SAFETY INVARIANT). The shadowKey now hashes realpath(cwd) (launch keying).
  - DEPENDENCIES: Task 4 (sourceGitDir field gone so the assignment can't linger).

Task 6: MODIFY src/snapshot/git.ts — rewrite class-header guarantee #1 (lines 37-38)
  - CURRENT (lines 36-38):
      "1. No ref-moving or write command is ever issued against the USER's git. The ONLY command run
         against the source repo is the READ-ONLY `git rev-parse --show-toplevel` /
         `--absolute-git-dir` (cwd, NO shadow env). All writes (`add`/`write-tree`/`commit-tree`/
         `update-ref`/`init`/`gc`) target the SHADOW repo via the `shadowEnv()` helper."
  - REPLACE with:
      "1. No command of any kind — read OR write — is ever issued against the USER's git. The workspace
         root is `realpath(cwd)` and needs no `rev-parse` to resolve it, so the backend never inspects
         or touches the user's `.git` (the old read-only `rev-parse --show-toplevel`/`--absolute-git-dir`
         is REMOVED — spec/14 §2 SAFETY INVARIANT + §3 guarantee #1). All git commands (`init`/`add`/
         `write-tree`/`commit-tree`/`update-ref`/`read-tree`/`checkout`/`gc`) target the SHADOW repo via
         `shadowEnv()` (`env.GIT_DIR === shadowDir`)."
  - GOTCHA #10 (exact phrase "No command of any kind — read or write"; cite §2 + §3).

Task 7: MODIFY src/snapshot/git.ts — rewrite REPO-ROOT KEYING block → LAUNCH-DIRECTORY KEYING (lines 49-51)
  - CURRENT (lines 49-51):
      "- REPO-ROOT KEYING (PRD §3 / spec §3): the shadow repo is keyed by the resolved repo root
         (`git rev-parse --show-toplevel` → `sha256(root).slice(0,16)`), so subdirectory launches of the
         same repo SHARE one shadow repo. Fall back to resolved cwd if rev-parse fails."
  - REPLACE with:
      "- LAUNCH-DIRECTORY KEYING (spec/14 §2 + §3): the shadow repo is keyed by `realpath(cwd)` (the
         launch directory) via `sha256(realpath(cwd)).slice(0,16)`. The repo-root-keyed sharing across
         subdirectory launches is intentionally NOT used: it required upward traversal (`rev-parse
         --show-toplevel`) to resolve the root, which is the hazard closed by the SAFETY INVARIANT
         (spec/14 §2). One shadow repo per launch directory — never an ancestor of it."
  - GOTCHA #10 (drop "subdirectory launches share" rationale; cite §2 + §3).

Task 8: MODIFY src/snapshot/git.ts — rewrite shadowKey JSDoc (~lines 133-138)
  - CURRENT: "Derive the 16-hex shadow-repo storage key from the resolved repo root (sha256, first 16
    hex chars). Repo-root-keyed (NOT cwd) so subdirectory launches of the same repo SHARE one shadow
    repo (PRD §3 / spec §3). MODULE-PRIVATE."
  - REPLACE with: "Derive the 16-hex shadow-repo storage key from the launch directory
    (`sha256(realpath(cwd)).slice(0,16)`). Launch-directory-keyed (NOT repo-root-keyed) — one shadow
    repo per launch dir; subdirectory launches do NOT share (that required upward traversal — the
    hazard closed by spec/14 §2 SAFETY INVARIANT). The arg is `repoRoot`, which after the constructor's
    realpathSafe + ensureInit's `repoRoot = this.cwd` IS realpath(cwd). MODULE-PRIVATE."
  - NOTE: the `function shadowKey(repoRoot: string)` SIGNATURE is UNCHANGED (only the doc changes).

Task 9: MODIFY src/snapshot/git.ts — rewrite init() JSDoc (lines 256-260) + ensureInit() JSDoc (266-277)
  - init() JSDoc CURRENT (256-260): "Initialize the shadow repo (idempotent — safe to call multiple
    times). Resolves repoRoot + sourceGitDir via read-only rev-parse against the USER's repo, derives
    the shadow key, and runs `git init --bare` against the SHADOW repo if it does not yet exist.
    Delegates to the memoized `ensureInit()` so concurrent first-captures share ONE init."
  - init() JSDoc NEW: "Initialize the shadow repo (idempotent — safe to call multiple times). Sets
    `repoRoot = realpath(cwd)` (the launch directory — NO rev-parse, NO upward discovery; spec/14 §2
    SAFETY INVARIANT), derives the shadow key, and runs `git init --bare` against the SHADOW repo if
    it does not yet exist. Delegates to the memoized `ensureInit()` so concurrent first-captures share
    ONE init. @spec/14 §3 (GitBackend init) + §3 guarantee #1."
  - ensureInit() JSDoc CURRENT (266-277): mentions "the SINGLE source of repoRoot/sourceGitDir/
    shadowDir resolution" + "Step (1) is the ONLY command against the USER's repo — read-only rev-parse,
    cwd, NO shadow env (guarantee #1). Step (2) runs `git init --bare` against the SHADOW repo only if
    `shadowDir` does not already exist."
  - ensureInit() JSDoc NEW: "Lazy memoized init — the SINGLE source of repoRoot/shadowDir resolution.
    Concurrent first-captures share ONE init (the memoized `initPromise`). A FAILED init resets the
    memo so the NEXT capture retries rather than permanently bricking the backend. MODULE-PRIVATE.
    Issues NO command against the USER's repo (spec/14 §2 SAFETY INVARIANT + §3 guarantee #1): repoRoot
    is set to `this.cwd` (already canonicalized by the constructor's realpathSafe) — no `rev-parse`, no
    upward walk. The ONLY git command here is `git init --bare` against the SHADOW repo (GIT_DIR only),
    gated by `existsSync` so a second capture never re-inits."
  - WHY: both JSDocs currently describe rev-parse + sourceGitDir that NO LONGER HAPPEN.
  - DEPENDENCIES: Tasks 4-5 (the code they document is already rewritten).

Task 10: MODIFY test/git.test.ts — delete makeExec rev-parse stubs
  - LOCATE lines 75-77 in makeExec:
        if (cmd === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
        if (cmd === "rev-parse" && args[1] === "--absolute-git-dir")
          return { stdout: "/fake/repo/.git\n", stderr: "" };
  - DELETE both. (makeExec's trailing `return { stdout: "", stderr: "" }` now handles rev-parse —
    has()'s --verify ignores stdout. GOTCHA #8/#9.)
  - LOCATE the SAME stubs duplicated in throwingExec (lines 255-257) + racingExec (305-307) — DELETE both.
  - DEPENDENCIES: none (test-side; independent of src edits but logically follows Task 5).

Task 11: MODIFY test/git.test.ts — flip expectedShadow default + GIT_WORK_TREE + source-.git assertions
  - LOCATE line 126-127 (expectedShadow):
        /** The expected shadow dir for the /fake/repo fixture: <storageDir>/<sha256("/fake/repo").slice(0,16)>. */
        function expectedShadow(storageDir: string, repoRoot = "/fake/repo"): string {
  - REPLACE with: doc "…for the /fake/cwd fixture (realpathSafe falls back to resolve since /fake/cwd
    does not exist on disk): <storageDir>/<sha256("/fake/cwd").slice(0,16)>." + default `repoRoot = "/fake/cwd"`.
  - LOCATE line 166: `expect(c.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo");` → `"/fake/cwd"`.
  - LOCATE line 378: `expect(diff.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo");` → `"/fake/cwd"`.
  - LOCATE lines 228, 639, 654, 804: `.not.toBe("/fake/repo/.git")` → `.not.toBe("/fake/cwd/.git")`.
  - WHY: repoRoot is now realpathSafe("/fake/cwd")="/fake/cwd" (GOTCHA #6). GIT_WORK_TREE + the user's
    .git are both under /fake/cwd now.

Task 12: MODIFY test/git.test.ts — flip has() throwOn call:3 → call:1
  - LOCATE line 422: `const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 3 } });`
    → `call: 1`.
  - LOCATE line 427: `const gb = makeBackend([], BASE_CFG, emptyScan, { throwOn: { cmd: "rev-parse", call: 3 } });`
    → `call: 1`.
  - WHY: ensureInit no longer issues 2 rev-parse calls before has()'s --verify (GOTCHA #7).
  - Also UPDATE the comment at line 420 ("The first two rev-parse calls (show-toplevel, absolute-git-dir)
    in ensureInit succeed; the 3rd rev-parse (--verify) throws") → "ensureInit issues NO rev-parse; has()'s
    --verify is the FIRST rev-parse call → throwOn call:1 makes it throw → has returns false."

Task 13: MODIFY test/git.test.ts — rework test #1 (lines 132-141) + "five guarantees" test #2 (line 232)
  - TEST #1 (132-141) CURRENT title: "issues rev-parse --show-toplevel against the USER repo (cwd, NO shadow GIT_DIR)".
    Its body asserts findCmd(calls,"rev-parse") is defined + opts.cwd==="/fake/cwd" + no GIT_DIR.
    REPLACE title + body with: "issues ZERO commands against the user's git (no rev-parse --show-toplevel/--absolute-git-dir)":
        const calls: Call[] = [];
        const gb = makeBackend(calls);
        await gb.capture("turn");
        // NO rev-parse --show-toplevel / --absolute-git-dir is ever issued (spec/14 §3 guarantee #1).
        const showTop = calls.find((c) => c.args[0] === "rev-parse" && c.args[1] === "--show-toplevel");
        const absGitDir = calls.find((c) => c.args[0] === "rev-parse" && c.args[1] === "--absolute-git-dir");
        expect(showTop).toBeUndefined();
        expect(absGitDir).toBeUndefined();
        // NO command runs against the user's repo at all — every capture command carries the shadow env.
        for (const c of calls) {
          expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
        }
  - "FIVE GUARANTEES" TEST #2 (232) CURRENT title: "the ONLY command without the shadow env is the read-only rev-parse".
    Its body asserts revParses.length > 0 + cwd==="/fake/cwd" + every non-rev-parse call has shadow env.
    REPLACE title + body with: "ZERO commands run without the shadow env (no command touches the user's git)":
        const calls: Call[] = [];
        const gb = makeBackend(calls);
        await gb.capture("turn");
        // spec/14 §3 guarantee #1: NO command of any kind — read or write — against the user's git.
        // Every recorded command (init/add/write-tree/commit-tree/update-ref) carries the shadow GIT_DIR.
        expect(calls.length).toBeGreaterThan(0);
        for (const c of calls) {
          expect(c.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
          expect(c.opts?.cwd).toBeUndefined();     // no cwd-only (user-repo) command exists anymore
        }
  - WHY: both old tests' PREMISES (a read-only rev-parse exception exists) are now FALSE — guarantee #1
    was upgraded to "no command at all". GOTCHA #8/#10.
  - DEPENDENCIES: Tasks 10-11 (makeExec stubs gone + expectedShadow flipped, so these tests compile +
    compute the right hash).
```

### Implementation Patterns & Key Details

```typescript
// The PRESERVED memoized-ensureInit scaffolding (DO NOT restructure — GOTCHA #4):
private ensureInit(): Promise<void> {
  if (this.initPromise) return this.initPromise;                       // memoize concurrent first-calls
  this.initPromise = (async () => {
    // ── CHANGED REGION (was: 2 rev-parse calls + top||cwd fallback + sourceGitDir) ──
    this.repoRoot = this.cwd;                                          // canonical launch dir — NO rev-parse
    this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));  // keyed by realpath(cwd)
    // ── END changed region ──
    if (!existsSync(this.shadowDir)) {                                 // UNCHANGED idempotent init gate
      await this.exec("git", ["init", "--bare"], {
        env: { ...process.env, GIT_DIR: this.shadowDir },
        maxBuffer: 16 * 1024 * 1024,
      });
    }
  })().catch((e) => { this.initPromise = null; throw e; });            // UNCHANGED retry-on-failure
  return this.initPromise;
}

// realpathSafe — the defense-in-depth canonicalizer (Task 2). NOTE: detectAndCreate (T2.S1) already
// realpathSync's cwd, so production never hits the catch; the fallback is for direct-test construction
// with non-existent paths (test/git.test.ts uses "/fake/cwd").
function realpathSafe(cwd: string): string {
  try { return realpathSync(cwd); }
  catch { return resolve(cwd); }   // ENOENT / unreadable / symlink-loop → string-normalize fallback
}

// shadowEnv() — UNCHANGED (GOTCHA #11). It reads this.repoRoot (now realpath(cwd)) so GIT_WORK_TREE
// points at the launch dir. Every capture/dirty/restore/etc. command goes through this → guarantee #1/#2.
private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
  return { env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot }, maxBuffer: 16*1024*1024 };
}
```

### Integration Points

```yaml
CONSUMERS (unchanged — they read this.repoRoot via shadowEnv()/directly):
  - detectAndCreate (store.ts, T2.S1): calls `new GitBackend(root, revertConfig, sessionDir)` where root
    is already realpath(cwd). realpathSafe(root) is idempotent → smooth handoff. NO signature change.
  - rewindExecute (rewind.ts): calls capture()/dirtyCheck()/changedPaths()/restore()/has()/retire() —
    all UNCHANGED; they now operate on the canonical launch-dir repoRoot.

NO DATABASE / NO CONFIG / NO ROUTES:
  - This is a pure in-memory + shadow-repo-filesystem change. No migration, no config knob, no route.
  - config.revert.storageDir is read as before (constructor resolves it). No new env vars.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the edited files (project uses tsc --noEmit; NO eslint/biome/ruff).
npm run typecheck
# Expected: zero errors. Watch specifically for:
#  - "Property 'sourceGitDir' does not exist" → you left a read of the deleted field (shouldn't happen;
#    grep confirmed only 4 refs, all removed).
#  - "Cannot find name 'realpathSync'" → forgot Task 1's import.
#  - "realpathSafe is declared but never read" → won't fire (no noUnusedLocals), but means Task 3 missed.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The reworked git.test.ts — THE primary validation for this subtask.
npx vitest run test/git.test.ts
# Expected: ALL green. If failing, the most likely causes (in order):
#  1. expectedShadow still keys by /fake/repo (Task 11 missed) → every GIT_DIR assertion wrong hash.
#  2. A GIT_WORK_TREE still asserts /fake/repo (lines 166/378) → Task 11 missed.
#  3. A has() throwOn still call:3 (lines 422/427) → Task 12 missed → has() returns true not false.
#  4. A rev-parse stub still in makeExec (Task 10 missed) → harmless but test #1's new
#     "showTop/absGitDir undefined" assertion would FAIL (the stub returns "/fake/repo").
#  5. sourceGitDir referenced (Task 4/5 incomplete) → would be a typecheck error, not a test failure.
```

### Level 3: Integration Testing (System Validation)

```bash
# Full suite — confirms NO regression in store.test.ts (T2.S1 parallel), cas tests, paths tests, and
# the integration revert-*.test.ts suite (which calls detectAndCreate → GitBackend on real git repos).
npm test
# Expected: ALL green. The integration revert-git.test.ts does a real `git init` + capture + restore;
# with repoRoot now realpath(tmpdir) (a real path → realpathSync succeeds → no fallback), the shadow
# repo keys by the real tmpdir and capture/restore work identically. If revert-git.test.ts FAILS, the
# most likely cause is a leftover / stale assumption in git.ts (not the integration test) — re-check
# ensureInit did not drop the git init --bare block (Task 5 PRESERVES it).

# Spot-check the regression vector is closed (manual grep — NOT a test, just confidence):
grep -nE "rev-parse.*(show-toplevel|absolute-git-dir)" src/snapshot/git.ts
# Expected: ZERO matches outside doc comments that DESCRIBE the removal (acceptable in doc prose).
# The live code must contain NONE.
grep -n "sourceGitDir" src/snapshot/git.ts
# Expected: ZERO matches (field decl + assignment + 2 doc mentions all removed).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Safety-invariant spot check — prove the GitBackend never issues a cwd-only (user-repo) command.
# (This is what spec/14 §10 demands: "assert NO command of any kind — read or write — is ever issued
#  against the user's .git". The reworked test #1 + guarantee test #2 already encode this; this is a
# redundant manual confirmation via the recording exec fake.)
npx vitest run test/git.test.ts -t "ZERO commands"
# Expected: the reworked "ZERO commands run without the shadow env" test passes → every recorded
# command in a capture() carries env.GIT_DIR === shadowDir; none has a bare opts.cwd against the user repo.

# Confirm the launch-directory keying end-to-end (the shadow key is sha256(realpath(cwd))):
node -e "const{createHash}=require('node:crypto');console.log(createHash('sha256').update('/fake/cwd').digest('hex').slice(0,16));"
# Compare to the shadowDir a capture() records (expectedShadow(BASE_CFG.storageDir!) in the tests) —
# they MUST match. (The test asserts this implicitly via expectedShadow.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` green (zero errors).
- [ ] `npx vitest run test/git.test.ts` green (all describe blocks).
- [ ] `npm test` green (incl. `test/store.test.ts`, `test/paths.test.ts`, `test/integration/revert-*.test.ts`).
- [ ] `grep -nE "rev-parse.*(show-toplevel|absolute-git-dir)" src/snapshot/git.ts` → zero live-code
      matches (doc prose describing the removal is acceptable).
- [ ] `grep -n "sourceGitDir" src/snapshot/git.ts` → zero matches.

### Feature Validation

- [ ] `ensureInit()` issues zero `rev-parse` calls + zero commands lacking the shadow env.
- [ ] `this.repoRoot === realpathSafe(this.cwd)`; `sourceGitDir` gone; `shadowDir` keys by realpath(cwd).
- [ ] The 5 doc regions rewritten (no "rev-parse against source/user repo"; cite spec/14 §2 + §3).
- [ ] test/git.test.ts: expectedShadow + GIT_WORK_TREE + source-.git flipped to /fake/cwd; throwOn
      call:1; makeExec rev-parse stubs gone; test #1 + guarantee #2 reworked to "ZERO commands".
- [ ] capture/dirtyCheck/changedPaths/has/retire/restore/gc/destroy/describe/shadowEnv UNCHANGED
      (only the repoRoot they read changed).
- [ ] The constructor signature `(cwd, revertConfig, sessionDir?, deps?)` is UNCHANGED (T2.S1 calls it).

### Code Quality Validation

- [ ] realpathSafe is module-private (no `export`); placed near shadowKey.
- [ ] isForbiddenRoot NOT imported here (deferred to T3.S2 — GOTCHA #1).
- [ ] resolve (node:path) retained in the import (still used for storageDir + realpathSafe fallback).
- [ ] execFile/promisify/execFileDefault retained (DI-seam default).
- [ ] The memoized-ensureInit scaffolding (memo + catch + retry-reset) is byte-identical.

### Documentation & Deployment

- [ ] JSDoc on ensureInit + init() cite `@spec/14 §3` + SAFETY INVARIANT (§2).
- [ ] Class-header guarantee #1 uses the exact spec phrase "No command of any kind — read or write".
- [ ] LAUNCH-DIRECTORY KEYING block replaces REPO-ROOT KEYING (no "subdirectory launches share" rationale).
- [ ] No new env vars / config knobs / migrations.

---

## Anti-Patterns to Avoid

- ❌ Don't import `isForbiddenRoot` in this subtask — it's unused here (T3.S2 consumes it). An unused
  import is dead weight even though `tsc` won't flag it (no `noUnusedLocals`).
- ❌ Don't drop `resolve` from `node:path` — the constructor + realpathSafe's fallback still use it.
- ❌ Don't touch `shadowEnv()`, `capture()`, `restore()`, etc. — they're correct as-is; only the
  `repoRoot` they read changed (now realpath(cwd)).
- ❌ Don't restructure the memoized `ensureInit` scaffolding — concurrent first-captures depend on the
  memo + catch + retry-reset shape.
- ❌ Don't leave ANY `rev-parse --show-toplevel`/`--absolute-git-dir` stub in `makeExec` — the fake
  must reject rev-parse for non-shadow commands so a future regression is caught, not silently fed.
- ❌ Don't "simplify" guarantee #1's doc to "no write command" — the read-only rev-parse exception is
  GONE; the spec phrase is "No command of any kind — read or write".
- ❌ Don't re-introduce repo-root keying or the "subdirectory launches share one shadow repo" rationale
  — that required upward traversal, which is the hazard this task closes.
- ❌ Don't touch cas.ts / store.ts / paths.ts / README / integration tests — each is a separate subtask.