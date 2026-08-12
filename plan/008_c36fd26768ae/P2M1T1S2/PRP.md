# PRP — P2.M1.T1.S2: `detectAndCreate` factory (backend detection)

> **Scope:** ONE PRP for this item only. Appends `detectAndCreate()` + `NoOpStore` to the existing
> `src/snapshot/store.ts` (produced by the parallel sibling P2.M1.T1.S1). Does NOT touch git.ts /
> cas.ts (those are P2.M2.T1 / P2.M3.T1, "Planned") — instead it constructs them via forward-compatible
> dynamic imports that resolve once those phases land.

---

## Goal

**Feature Goal**: A single `detectAndCreate(cwd, revertConfig, sessionDir?)` async factory that picks the
correct `SnapshotStore` backend for the current workspace (git → `GitBackend`; non-git + writable storage
→ `CasBackend`; neither → `NoOpStore`) and **fails open** to `NoOpStore` on ANY error (E28).

**Deliverable**: Two exports APPENDED to `src/snapshot/store.ts`:
1. `export async function detectAndCreate(cwd, revertConfig, sessionDir?): Promise<SnapshotStore>`
2. `export class NoOpStore implements SnapshotStore` (backend `"none"`; all ops no-op).
Plus the imports they require (`node:child_process`, `node:util`, `node:fs`, `node:path`, a type-only
`MulliganConfig`).

**Success Definition**: `npm run typecheck` (tsc --noEmit, strict) is clean; `npx vitest run
test/store.test.ts` passes new `detectAndCreate`/`NoOpStore` tests; the factory never throws (always
returns a `SnapshotStore`); and once P2.M2.T1/P2.M3.T1 land, the SAME factory returns real backends with
zero edits to store.ts.

---

## Why

- **Backend selection is the front door to the whole v1.2 revert feature.** The rewind tool
  (rewindExecute, P4.M2.T1) is mode-agnostic — it calls `dirtyCheck`/`restore` on whatever
  `SnapshotStore` it is handed. That hand-off happens once, at `session_start`, via this factory.
- **Fail-open is the safety contract.** Revert is an *opt-in convenience* layered on context rewind.
  If detection or backend init fails for ANY reason (no git, unwritable storage, git binary missing,
  backend module not yet present), the session MUST still work — context rewind proceeds without file
  revert. E28 (PRD h2.109) + PRD h2.142 ("Detection … if the CAS cannot initialize → 'none' … fail-open").
- **Forward-compatibility.** This subtask ships BEFORE its two backend dependencies. The factory must
  compile and pass tests NOW while returning `NoOpStore` for the git/cas branches (the dynamic import
  of a not-yet-present module rejects → caught → `NoOpStore`), then flip to real backends with no code
  change once P2.M2/P2.M3 land. This is the deliberate sequencing in the task tree.

---

## What

`detectAndCreate` decides the backend with this exact decision tree (work-item contract step 3):

```
try:
  1. run `git rev-parse --git-dir` via promisify(execFile) in cwd
       exit code 0  → dynamic-import GitBackend, return new GitBackend(cwd, revertConfig)
       (git missing / non-zero → not git, fall through)
  2. resolve storageDir: revertConfig.storageDir ?? <sessionDir>/mulligan/
       mkdir -p it; fs.access(W_OK)
       writable      → dynamic-import CasBackend, return new CasBackend(cwd, revertConfig, sessionDir)
       unwritable    → return NoOpStore (reason: "no git repo and storage dir not writable")
catch ANY error:
  return NoOpStore (reason: "detection unavailable: <short msg>")
```

`NoOpStore.describe()` returns `{ backend: "none", reason }`; every other method is a no-op
(`capture→null`, `dirtyCheck→[]`, `restore→{reverted:[],deleted:[],failed:[],skipped:[],refused:[]}`,
`has→false`, `retire→void`).

### Success Criteria

- [ ] `detectAndCreate` is `async`, exported, and NEVER throws (always resolves to a `SnapshotStore`).
- [ ] In a real temp `git init` dir, detection reaches the git branch (today: fail-opens to NoOpStore
      because `./git.js` is absent; after P2.M2.T1: returns a `GitBackend`).
- [ ] Non-git dir + writable storage reaches the cas branch (today: fail-opens; after P2.M3.T1: returns
      a `CasBackend`).
- [ ] Non-git dir + unwritable storage returns `NoOpStore` with a reason mentioning "writable".
- [ ] Any thrown error (bad cwd, missing git binary, import failure) returns `NoOpStore`, never throws.
- [ ] `NoOpStore` satisfies all 6 `SnapshotStore` methods as no-ops and `describe().backend === "none"`.
- [ ] `tsc --noEmit` clean; `test/store.test.ts` green; existing tests still green.

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge": a developer who has never seen this repo gets the exact file to edit, the
exact exports already present (the sibling contract), the exact import lines, the exact decision tree, the
exact forward-compat trick, the exact testable-now assertions, and the validation commands. The only thing
they cannot do is run the git/cas branches to completion today — that is by design (those modules ship
later) and is fail-open'd.

### Documentation & References

```yaml
- url: https://nodejs.org/api/child_process.html#child_processexecfilecommand-args-options-callback
  why: execFile(options.cwd) — the git-detection primitive. spawn a binary WITHOUT a shell (no
       injection surface; cwd passed via options). promisify wraps it so a non-zero exit REJECTS.
  critical: execFile REJECTS on non-zero exit AND on ENOENT (git not installed) — both map to "not git"
       in the catch arm. Do NOT use exec() (spawns a shell — injection risk + unneeded).

- url: https://nodejs.org/api/fs.html#fspromisesmkdirpath-options
  why: fsPromises.mkdir(path, {recursive:true}) — the "mkdir -p" for the storage-writability check.
  critical: recursive:true is idempotent (no EEXIST throw if the dir already exists). Follow with
       fsPromises.access(dir, fs.constants.W_OK) which REJECTS if not writable.

- url: https://nodejs.org/api/util.html#utilpromisifyoriginal
  why: util.promisify(execFile) → Promise that rejects on non-zero exit. The standard, zero-dep pattern.

- file: src/snapshot/store.ts
  why: THE FILE TO EDIT. Already exports SnapshotStore / RestoreOpts / RestoreResult / AsyncMutex (from
       sibling P2.M1.T1.S1). Its header JSDoc VERBATIM reserves room for detectAndCreate ("Leaves clean
       room for detectAndCreate() (P2.M1.T1.S2 … APPENDS to this same file). store.ts does NOT define it
       (GOTCHA #3)"). APPEND to the BOTTOM — do NOT touch the existing exports.
  pattern: mirror the header JSDoc style (spec-section citations + DESIGN bullets; see paths.ts header
       for the model tone).
  gotcha: store.ts is currently import-FREE. This task breaks that purity by ADDING imports — that is
       EXPECTED and pre-sanctioned. Add imports at the very top, above the existing header comment.

- file: src/snapshot/paths.ts
  why: (a) the header-JSDoc + DESIGN-bullets house style to mirror on the new exports; (b) the path-safety
       helpers to use for the defensive storageDir-not-inside-cwd check (resolveSafeWorkspacePath /
       isDangerousWorkspaceRel / normalizeRelPath).
  pattern: import { resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel } from "./paths.js"
       and use them to guard the resolved storage dir against escaping/entering cwd.

- file: src/config.ts
  why: source of the revertConfig TYPE. `MulliganConfig["revert"]` is the 8-field block (enabled,
       allowDeleteCreatedFiles, nonGitMode, storageDir:string|null, maxFileBytes, maxTotalBytes,
       maxSnapshotsPerTurn, excludeGlobs). getConfig() returns MulliganConfig.
  pattern: `import type { MulliganConfig } from "../config.js";` then param type `MulliganConfig["revert"]`.
       TYPE-ONLY import → erased at runtime → no circular-import risk (config.ts does not import store.ts).
  gotcha: there is NO exported `RevertConfig` name — do NOT invent one; index into MulliganConfig.
       storageDir===null means "use the default <sessionDir>/mulligan/".

- file: test/paths.test.ts
  why: the EXACT test idiom to mirror: vitest; `import … from "../src/snapshot/store.js"` (note the .js
       extension — house style even under moduleResolution "Bundler"); `import type` for types; hand-rolled
       fakes; no module-scoped state ⇒ no beforeEach needed. Header comment block explaining coverage.
  pattern: real `node:fs`/`node:os` temp dirs (os.mkdtemp(os.tmpdir()…)) are used freely in this repo
       (test/integration/smoke.ts) — prefer a real `git init` in a tempdir over mocking execFile.

- file: src/markers.ts
  why: confirms RevertCheckpoint.backend is "git"|"cas" (NOT "none") — checkpoints exist only for real
       backends. NoOpStore therefore never participates in checkpoints. (Read-only context; do not edit.)

- docfile: plan/008_c36fd26768ae/architecture/external_deps.md
  section: §1 (Git CLI: "git rev-parse --git-dir → sourceGitDir, ONLY for detection, never written to"),
       §2 (Node fs APIs), §4 (no new npm deps — Node built-ins only).
  why: pins that the ONLY git command in detection is read-only rev-parse, and that child_process/fs are
       the sanctioned, zero-new-dep primitives.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  paths.ts        # P1.M2.T1.S1 — DONE. Pure path-safety helpers (import these).
  store.ts        # P2.M1.T1.S1 — DONE (interface + RestoreOpts + RestoreResult + AsyncMutex).
                  #   ← THIS TASK APPENDS detectAndCreate() + NoOpStore + imports.
  git.ts          # P2.M2.T1 — NOT YET PRESENT (forward-compat dynamic import target).
  cas.ts          # P2.M3.T1 — NOT YET PRESENT (forward-compat dynamic import target).
src/config.ts     # P1.M1.T1.S1 — DONE. MulliganConfig["revert"] type source.
src/markers.ts    # P1.M2.T2.S1 — DONE. RevertCheckpoint (backend "git"|"cas").
src/runtime.ts    # P1.M2.T2.S2 — DONE. SessionRuntime.snapshots?: Map<string,RevertCheckpoint>.
test/store.test.ts  # ← THIS TASK CREATES (new) OR APPENDS to if S1 made one.
```

### Desired Codebase tree (files this task adds/changes)

```bash
src/snapshot/store.ts        # MODIFY — append detectAndCreate + NoOpStore + imports (top of file)
test/store.test.ts           # MODIFY/CREATE — add "detectAndCreate" + "NoOpStore" describe() blocks
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — forward-compatible backend construction. git.ts (P2.M2.T1) and cas.ts (P2.M3.T1) DO NOT
// EXIST yet. A STATIC `import { GitBackend } from "./git.js"` makes `tsc --noEmit` FAIL ("Cannot find
// module './git.js'") and vitest/rollup fail to resolve at transform time. Use a DYNAMIC import with a
// NON-LITERAL specifier so TypeScript does NOT statically resolve it (only STRING-LITERAL import()
// args are statically checked) and rollup/vitest skip static analysis:
//     const spec = "./git.js";
//     const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
// Today this rejects (module absent) → caught → NoOpStore (fail-open). After P2.M2/P2.M3 land it
// resolves to the real backend with ZERO edits to store.ts. Do NOT use `// @ts-expect-error` on a
// literal dynamic import (fragile: tsc errors if the directive ever stops matching a real error).

// CRITICAL — E28 fail-open is the WHOLE POINT. Wrap the ENTIRE detectAndCreate body in try/catch and
// return NoOpStore on ANY thrown error. detectAndCreate must NEVER reject. (git binary missing ⇒
// execFile ENOENT ⇒ caught; mkdir/access fail ⇒ caught; dynamic import reject ⇒ caught.)

// CRITICAL — SnapshotStore methods are SYNCHRONOUS (sibling contract GOTCHA #1). NoOpStore's methods
// are sync no-ops (capture returns null, NOT Promise<null>). detectAndCreate itself IS async (it awaits
// execFile + import + mkdir), but the store it returns exposes the sync interface.

// GOTCHA — storageDir resolution. revertConfig.storageDir===null ⇒ default <sessionDir>/mulligan/. The
// caller (index.ts session_start, P3.M1.T2) has ctx.sessionDir, so detectAndCreate takes an OPTIONAL
// 3rd param `sessionDir?: string|null` used ONLY when storageDir is null. This is the faithful,
// minimal extension of the literal `detectAndCreate(cwd, revertConfig)` contract.

// GOTCHA — promisify(execFile) REJECTS on non-zero exit. That is EXACTLY what git detection wants:
// exit 0 ⇒ is-git (no throw); non-zero / git-missing ⇒ throw ⇒ "not git" in the inner catch. Keep the
// git-detection try/catch NARROW (only the execFile call) so its catch unambiguously means "not git",
// distinct from the outer fail-open catch.

// GOTCHA — read-only-only against the user's .git. The single git command run here is `rev-parse
// --git-dir`, which is READ-ONLY. NEVER run any write command (commit/reset/checkout/…) against the
// user's repo. All writes live in the SHADOW repo, and only inside GitBackend (P2.M2.T1) — not here.

// GOTCHA — module cache. Pi loads extensions via jiti (per-extension cache). store.ts is imported by
// index.ts in the SAME extension, so the detectAndCreate you write IS the one called. No cross-module
// cache subtlety here (that matters for the smoke harness, not for this factory).

// GOTCHA — .js import paths are house style under moduleResolution "Bundler" (see test/paths.test.ts,
// every src import in test/integration/smoke.ts). Use "./paths.js", "../config.js", "./git.js".
```

---

## Implementation Blueprint

### Data models and structure

No new persistent data models. The factory returns one of three `SnapshotStore` instances. The only new
TYPE-LEVEL constructs are local constructor-signature interfaces for the forward-compat dynamic-import
casts (not exported — they exist only to type the cast, not to constrain P2.M2/P2.M3):

```ts
// Local (un-exported) ctor shapes so the dynamic-import casts are typed, not `any`.
// These are the S2 → P2.M2/P2.M3 contracts: the backends MUST expose these constructors.
// GitBackend ctor (P2.M2.T1 must satisfy): only needs cwd + revertConfig (repo-root resolution
//   happens INSIDE GitBackend via its own rev-parse --show-toplevel; not detectAndCreate's job).
interface GitBackendCtor {
  new (cwd: string, revertConfig: MulliganConfig["revert"]): SnapshotStore;
}
// CasBackend ctor (P2.M3.T1 must satisfy): cwd + revertConfig; sessionDir threaded so the CAS can
//   resolve its blob store path when storageDir is null. (If P2.M3 prefers to resolve storage
//   internally from sessionDir alone, dropping the 3rd arg is a safe, compatible narrowing — see
//   Integration contract note in Implementation Tasks Task 3.)
interface CasBackendCtor {
  new (cwd: string, revertConfig: MulliganConfig["revert"], sessionDir?: string | null): SnapshotStore;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/store.ts — ADD the imports at the very TOP (above the existing header comment)
  - ADD: `import { execFile as execFileCb } from "node:child_process";`
  - ADD: `import { promisify } from "node:util";`
  - ADD: `import { access, mkdir, constants } from "node:fs/promises";`
  - ADD: `import { resolve, relative, isAbsolute } from "node:path";`
  - ADD: `import { resolveSafeWorkspacePath, isDangerousWorkspaceRel } from "./paths.js";`
  - ADD: `import type { MulliganConfig } from "../config.js";`
  - ADD (top-level const, right after imports): `const execFile = promisify(execFileCb);`
  - PRESERVE: every existing export (SnapshotStore / RestoreOpts / RestoreResult / AsyncMutex) byte-for-byte.
  - GOTCHA: store.ts is currently import-free; adding imports is EXPECTED (sibling S1 sanctioned it).
  - GOTCHA: the `type` modifier on the MulliganConfig import is mandatory (strict + noUnusedLocals-adjacent
    house style; a value import of a type-only module is erased anyway but the modifier is the idiom).

Task 2: MODIFY src/snapshot/store.ts — APPEND the NoOpStore class at the BOTTOM
  - IMPLEMENT: `export class NoOpStore implements SnapshotStore`
  - describe(): return { backend: "none" as const, reason: this.reason }
  - capture(_label: string): null        // always null — revert unavailable
  - dirtyCheck(_afterRef: string, _paths: string[]): []   // no drift info available
  - restore(_beforeRef: string, _opts: RestoreOpts): RestoreResult
      → { reverted: [], deleted: [], failed: [], skipped: [], refused: [] }
  - has(_ref: string): false
  - retire(_ref: string): void { /* no-op */ }
  - CONSTRUCTOR: `constructor(private readonly reason: string) {}` — reason is set by detectAndCreate.
  - JSDoc: cite spec/14 §2 + E28 (fail-open); note NoOpStore is the ONLY store with backend "none" and
    that it never participates in checkpoints (RevertCheckpoint.backend is "git"|"cas" only).
  - FOLLOW pattern: the existing AsyncMutex class for JSDoc density + "EXPORTED so …" footer.

Task 3: MODIFY src/snapshot/store.ts — APPEND detectAndCreate() at the BOTTOM (after NoOpStore)
  - SIGNATURE: `export async function detectAndCreate(cwd: string, revertConfig: MulliganConfig["revert"], sessionDir?: string | null): Promise<SnapshotStore>`
  - BODY (exact decision tree, fail-open):
      try {
        // (1) git detection — NARROW try/catch so its catch unambiguously means "not git"
        try {
          await execFile("git", ["rev-parse", "--git-dir"], { cwd });
          // exit 0 ⇒ is a git repo ⇒ GitBackend
          const spec = "./git.js";                              // non-literal → not statically resolved
          const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
          return new mod.GitBackend(cwd, revertConfig);
        } catch {
          // not git (non-zero exit, or `git` binary missing) — fall through to CAS
        }
        // (2) resolve storage dir + writability check
        const storageDir = resolveStorageDir(revertConfig.storageDir, sessionDir, cwd);
        await mkdir(storageDir, { recursive: true });          // mkdir -p (idempotent)
        await access(storageDir, constants.W_OK);              // rejects if not writable
        // writable ⇒ CasBackend
        const spec = "./cas.js";                               // non-literal → not statically resolved
        const mod = (await import(spec)) as { CasBackend: CasBackendCtor };
        return new mod.CasBackend(cwd, revertConfig, sessionDir);
      } catch (err) {
        // (3) E28 fail-open — ANY error (unwritable storage, import failure, backend ctor throw, …)
        const msg = err instanceof Error ? err.message : String(err);
        return new NoOpStore(summarize(msg));                  // never rethrow
      }
  - NOTE: the "neither git nor writable storage" case is NOT a separate branch — it falls out naturally:
    mkdir/access reject in step (2) ⇒ outer catch ⇒ NoOpStore. If you want a DISTINCT reason for the
    unwritable case (vs a generic error), you MAY narrow step (2): wrap just the mkdir+access in its own
    try/catch and on failure `return new NoOpStore("no git repo and storage dir not writable")`.
    (Either is acceptable; the distinct-reason variant makes the "unwritable" test assertion crisper —
    see Success Criteria.) Pick the distinct-reason variant for testability.
  - DEPENDS: Task 1 (imports) + Task 2 (NoOpStore) + GitBackendCtor/CasBackendCtor (Task 4).

Task 4: MODIFY src/snapshot/store.ts — ADD the two local ctor interfaces + resolveStorageDir + summarize helpers
  - ADD (un-exported, near the top after imports or just above detectAndCreate): GitBackendCtor,
    CasBackendCtor (see "Data models" above).
  - IMPLEMENT `function resolveStorageDir(storageDir: string | null, sessionDir: string | null | undefined, cwd: string): string`:
      - if storageDir (non-null) → resolve(storageDir)
      - else if sessionDir → resolve(sessionDir, "mulligan")   // default <sessionDir>/mulligan/
      - else → throw new Error("no storage dir configured and no session dir provided")
      - DEFENSIVE: verify the resolved dir is NOT inside cwd (would pollute the workspace) — use
        isDangerousWorkspaceRel(normalizeRelPath(cwd, resolved)) OR a relative() containment check;
        if inside cwd → throw (→ fail-open NoOpStore). config.ts already rejects inside-cwd storageDir,
        but this is cheap belt-and-suspenders for the sessionDir-default path.
  - IMPLEMENT `function summarize(msg: string): string`: trim to ~120 chars, strip newlines (keep the
    NoOpStore reason a one-liner — describe().reason feeds the rewind notice/log, not a stack dump).
  - PLACEMENT: keep these as small module-private helpers; do NOT export them.

Task 5: CREATE/APPEND test/store.test.ts — detectAndCreate + NoOpStore unit tests
  - IF test/store.test.ts already exists (S1 may have created it for the interface/AsyncMutex): APPEND
    two new top-level describe() blocks. ELSE create it mirroring test/paths.test.ts header style.
  - IMPORT: `import { detectAndCreate, NoOpStore, type SnapshotStore } from "../src/snapshot/store.js";`
  - IMPORT: `import { describe, it, expect } from "vitest";`
  - IMPORT (real fs/os for temp dirs): `import { mkdtemp, mkdir, rm, chmod, writeFile } from "node:fs/promises";`
    `import { tmpdir } from "node:os";` `import { join } from "node:path";`
    `import { execFile } from "node:child_process";` `import { promisify } from "node:util";`
  - NoOpStore block — assert all 6 no-op behaviors (capture===null, dirtyCheck deep-equals [], restore
    deep-equals the empty RestoreResult, has===false, retire is void, describe().backend==="none").
  - detectAndCreate none-path: tempdir, chmod 0o555 (read-only) as storageDir, cwd=tempdir2 (non-git)
    → expect NoOpStore, describe().backend==="none", reason mentions "writable". (Restore chmod 0o755
    in afterEach to let rm() clean up — GOTCHA: read-only dirs block rm on some platforms.)
  - detectAndCreate git DETECTION: tempdir, `await execFile("git","init")` in it, set that as cwd with a
    writable storageDir → assert describe().backend==="none" TODAY (fail-open: ./git.js absent) AND
    document via a code comment that this flips to "git" after P2.M2.T1. (This pins current behavior so
    the suite stays green now and is a regression sentinel later.)
  - detectAndCreate fail-open: cwd=join(tmpdir(),"nonexistent-xyz-<rnd>") (does not exist) → expect
    NoOpStore, never throws. ALSO: a non-git writable tempdir as cwd → reaches cas branch → ./cas.js
    absent TODAY → NoOpStore (fail-open); comment that it flips to "cas" after P2.M3.T1.
  - detectAndCreate sessionDir default: storageDir===null + a writable sessionDir tempdir → no throw
    (resolves <sessionDir>/mulligan/); assert reaches cas branch (NoOpStore today, "cas" after P2.M3).
  - FOLLOW pattern: test/paths.test.ts (header comment block, no beforeEach unless needed, .js imports,
    `import type`). Use `afterEach`/`afterAll` to rm tempdirs. Guard the git-init test with a SKIP if
    `git` is not on PATH (rare in CI; use `try { await execFile("git",["--version"]) } catch { it.skip(...) }`).
  - COVERAGE: every Success Criterion bullet above maps to ≥1 assertion.
```

### Implementation Patterns & Key Details

```ts
// The git-detection primitive — NARROW try/catch so the catch means ONLY "not git".
async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd });
    return true;                 // exit 0 ⇒ repo
  } catch {
    return false;                // non-zero exit OR `git` not installed (ENOENT)
  }
}
// (Inlined in detectAndCreate is fine; a named helper makes the narrow-catch intent obvious.)

// The forward-compat dynamic import — NON-LITERAL specifier (the crux of this task).
async function makeGitBackend(cwd: string, cfg: MulliganConfig["revert"]): Promise<SnapshotStore> {
  const spec = "./git.js";                                  // variable → not statically resolved by tsc/rollup
  const mod = (await import(spec)) as { GitBackend: GitBackendCtor };
  return new mod.GitBackend(cwd, cfg);
}
// Why non-literal: TS resolves `import("./git.js")` (literal) at type-check time → "Cannot find module"
// because git.ts doesn't exist yet. `import(spec)` (variable) is treated as Promise<any> → no resolution.
// vitest/rollup likewise skip static analysis of non-literal specifiers → no transform-time error.

// NoOpStore — the fail-open terminal store (backend "none").
export class NoOpStore implements SnapshotStore {
  constructor(private readonly reason: string) {}
  describe(): { backend: "none"; reason: string } { return { backend: "none", reason: this.reason }; }
  capture(): null { return null; }
  dirtyCheck(): string[] { return []; }
  restore(): RestoreResult { return { reverted: [], deleted: [], failed: [], skipped: [], refused: [] }; }
  has(): boolean { return false; }
  retire(): void { /* no-op */ }
}
```

### Integration Points

```yaml
CONSUMERS (downstream — do NOT implement here, just satisfy the contract):
  - index.ts (P3.M1.T2.S1): `const store = await detectAndCreate(ctx.cwd, getConfig().revert, ctx.sessionDir);`
    cached on SessionRuntime; threaded into the rewind tool + capture hooks. detectAndCreate is called
    ONCE per session (PRD h2.142 "Detection, cached per session in SessionRuntime").
  - rewindExecute (P4.M2.T1.S2): reads `store.describe().backend`; if "none", skips file revert
    (context rewind still proceeds).

DYNAMIC-IMPORT TARGETS (upstream deps, ship LATER):
  - src/snapshot/git.ts — `export class GitBackend implements SnapshotStore` with ctor
    `(cwd: string, revertConfig: MulliganConfig["revert"])` (P2.M2.T1). This is the GitBackendCtor contract.
  - src/snapshot/cas.ts — `export class CasBackend implements SnapshotStore` with ctor
    `(cwd: string, revertConfig: MulliganConfig["revert"], sessionDir?: string | null)` (P2.M3.T1). This is
    the CasBackendCtor contract.

CONFIG:
  - No config.ts changes. detectAndCreate READS revertConfig (esp. storageDir, nonGitMode selection happens
    INSIDE CasBackend — detectAndCreate just hands config through). nonGitMode is CasBackend's concern.

NO DATABASE / NO ROUTES / NO NEW DEPS. Node built-ins only (architecture/external_deps.md §4).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After appending to store.ts — fix before proceeding. This project's "lint" IS tsc (no eslint/ruff).
npm run typecheck                 # tsc --noEmit (strict + noImplicitAny). MUST be clean.
# Expected: zero errors. CRITICAL CHECK: ./git.js and ./cas.js must NOT produce "Cannot find module"
# errors — if they do, the dynamic-import specifier was a literal string (re-read Known Gotchas #1).

# Confirm the appended file still exports everything the sibling left (sanity):
node --input-type=module -e "import('./src/snapshot/store.ts').then(m => console.log(Object.keys(m)))" 2>/dev/null \
  || echo "(jiti runtime check skipped — rely on vitest + tsc above)"
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: the new factory + NoOpStore.
npx vitest run test/store.test.ts            # verbose; the new describe() blocks must be green.

# Full suite regression (the append must not break sibling S1's interface/AsyncMutex tests or anything else).
npm test                                      # = vitest run
# Expected: ALL green. If test/store.test.ts already existed from S1, your appended blocks coexist.
```

### Level 3: Integration Testing (System Validation)

```bash
# There is no server / DB. The "integration" here is: a real git repo + real fs in the test process
# (Level 2 already does this via os.mkdtemp + real `git init`). No separate Level 3 command needed for
# this subtask — the factory is not yet wired into index.ts (that is P3.M1.T2). Confirm manually that a
# non-git tempdir yields NoOpStore and a `git init` tempdir reaches the git branch (fail-open today):

node --input-type=module -e '
  import("./src/snapshot/store.ts").then(async ({ detectAndCreate }) => {
    const { mkdtemp } = await import("node:fs/promises"); const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const cwd = await mkdtemp(join(tmpdir(), "det-"));
    const store = await detectAndCreate(cwd, { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas",
      storageDir: null, maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
      excludeGlobs:[".git","node_modules"] }, await mkdtemp(join(tmpdir(), "sess-")));
    console.log("non-git store describe():", JSON.stringify(store.describe()));  // expect backend "none" today
  }).catch(e => { console.error("FACTORY THREW — E28 VIOLATION:", e); process.exit(1); });
'
# Expected: prints a describe() with backend "none" (./cas.js absent today). MUST NOT print "FACTORY THREW".
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Sentinel for the FORWARD-COMPAT contract — proves the non-literal dynamic import was used (not a static
# import). A static import of ./git.js would make tsc fail TODAY; a passing typecheck IS the proof.
npm run typecheck && echo "TYPECHECK OK → forward-compat dynamic import confirmed (no static ./git.js or ./cas.js resolution)"
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean — INCLUDING no "Cannot find module './git.js'" / './cas.js' errors.
- [ ] Level 2: `npx vitest run test/store.test.ts` green; `npm test` (full suite) green (no regressions).
- [ ] Level 3: the manual `node -e` snippet prints `backend "none"` and never throws.
- [ ] Level 4: typecheck proves forward-compat (no static backend imports).

### Feature Validation

- [ ] `detectAndCreate` is async, exported, and the `node -e` probe proves it NEVER throws.
- [ ] Non-git + unwritable storage → `NoOpStore`, reason mentions "writable".
- [ ] Real `git init` tempdir → reaches git branch (fail-open NoOpStore today; flips to GitBackend post-P2.M2).
- [ ] Writable non-git tempdir → reaches cas branch (fail-open NoOpStore today; flips to CasBackend post-P2.M3).
- [ ] `NoOpStore` satisfies all 6 `SnapshotStore` methods as no-ops; `describe().backend === "none"`.
- [ ] `storageDir===null` + `sessionDir` → default `<sessionDir>/mulligan/` resolved (no throw).

### Code Quality Validation

- [ ] APPENDED to the existing store.ts — the sibling's SnapshotStore/RestoreOpts/RestoreResult/AsyncMutex
      exports are byte-for-byte unchanged.
- [ ] Header-JSDoc + DESIGN-bullet house style (mirror paths.ts / the existing store.ts header).
- [ ] `.js` import paths; `import type` for MulliganConfig; `node:` prefixes on all built-in imports.
- [ ] Defensive storageDir-not-inside-cwd check present (belt-and-suspenders alongside config.ts validation).
- [ ] No new npm dependencies (Node built-ins only).

### Documentation & Deployment

- [ ] JSDoc on `detectAndCreate` cites spec/14 §2 + E28 (Mode A — rides with the work, per item contract DOCS).
- [ ] Tests' header comment documents the TODAY-vs-AFTER-P2.M2/P2.M3 behavior flip (so future maintainers
      know the "backend none today" assertions are intentional, not bugs).

---

## Anti-Patterns to Avoid

- ❌ Don't STATIC-import `./git.js` or `./cas.js` — tsc fails today and the forward-compat contract breaks.
  Use a non-literal dynamic `import(spec)`.
- ❌ Don't `// @ts-expect-error` a literal dynamic import — fragile (breaks if the error shape changes) and
  unnecessary given the non-literal pattern.
- ❌ Don't let `detectAndCreate` throw — E28 fail-open is the contract. The body is one big try/catch.
- ❌ Don't widen the git-detection try/catch to include the CAS branch — its catch must mean ONLY "not git".
- ❌ Don't run any write git command against the user's repo (only read-only `rev-parse` here).
- ❌ Don't invent an exported `RevertConfig` type or edit config.ts — index into `MulliganConfig["revert"]`.
- ❌ Don't make NoOpStore's methods async (the interface is synchronous — sibling contract GOTCHA #1).
- ❌ Don't mock `child_process`/`fs` in tests when a real tempdir + real `git init` is the house idiom and
  exercises the real fail-open path (including the genuine import-reject of an absent module).

---

## Confidence Score: 9/10

One-pass success is very likely. The only residual risk is the exact CasBackend constructor arity
(P2.M3.T1 not yet written): S2 passes `(cwd, revertConfig, sessionDir)`; if P2.M3 settles on a different
signature, a one-line tweak to the `CasBackendCtor` cast / the `new mod.CasBackend(...)` call is needed.
This is explicitly flagged as the "Integration contract note" in Task 3 and is a trivial, localized change
— it does not threaten the core (detection + fail-open + NoOpStore), which is fully implementable and
testable today.