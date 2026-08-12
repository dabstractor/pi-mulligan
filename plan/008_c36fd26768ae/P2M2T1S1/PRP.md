# PRP — P2.M2.T1.S1: `GitBackend` init + capture (shadow git repository)

> **Scope:** ONE PRP. Creates `src/snapshot/git.ts` (the `GitBackend` class — `init()` + `capture()` only;
> `dirtyCheck`/`restore`/`has`/`retire` are P2.M2.T1.S2 stubs) + `test/git.test.ts`. **Also** applies a
> bounded, necessary correction to `src/snapshot/store.ts` + `test/store.test.ts`: the `SnapshotStore`
> interface is currently declared **synchronous** (P2.M1.T1.S1/S2), but this task's work-item contract
> requires **async** capture ("async capture", "acquire mutex", "mock execFile" — see Task 1 rationale).
> `describe()` stays sync.

---

## Goal

**Feature Goal**: A `GitBackend implements SnapshotStore` whose `capture(label)` snapshots the ENTIRE
working set (tracked + untracked + gitignored-minus-excludes) into a **separate external shadow git
repository** and returns an opaque commit-SHA ref — **without ever writing to the user's `.git`** (not
even a dangling object). The shadow repo is keyed by repo root (subdirectory launches share it).

**Deliverable**: `src/snapshot/git.ts` exporting `class GitBackend implements SnapshotStore` with a
fully working `async init()` + `async capture(label): Promise<string | null>`, async stubs for the
S2 methods, and a DI test seam. Plus the in-scope interface correction in `store.ts` (async methods) +
`test/git.test.ts` asserting command construction + the **no-write-to-source-git** safety invariant.

**Success Definition**: `npm run typecheck` clean (incl. `GitBackend implements SnapshotStore`);
`npx vitest run test/git.test.ts` + `test/store.test.ts` green; `npm test` (full suite) green (no
regressions from the interface async-ification); capture returns a commit SHA and issues
`add --all -f -- . :!<excludes>`, `write-tree`, `commit-tree [-p <parent>] -m "snapshot:<label>"`,
`update-ref refs/mulligan/snapshots/<ns>/<part> <sha>` against the SHADOW repo only; on ANY git error
capture returns `null` (best-effort, E27); the five git-safety guarantees (spec/14 §3) hold.

---

## Why

- **`GitBackend` is the preferred snapshot backend in a repo** (PRD h2.143). It is the comprehensive,
  tool-agnostic capture mechanism that makes the v1.2 rewind actually undo file edits from ANY tool
  (write/edit **and** bash `sed`/`cp`/`heredoc`), which is the whole motivation for the feature (PRD h2.140).
- **Git-safety is the non-negotiable contract.** The user's `.git` must be byte-for-byte unaffected —
  no moved refs, no written objects, not even a reclaimable dangling blob (guarantee #2, strictly
  cleaner than a `git stash create`-in-source design). Everything lives in the shadow repo under
  `config.revert.storageDir`. This is what makes the feature safe to ship opt-in.
- **This task unblocks the pipeline.** `detectAndCreate` (P2.M1.T1.S2, shipped) dynamic-imports
  `./git.js` and constructs `new GitBackend(cwd, revertConfig)` for any git workspace — today that
  import rejects (module absent) → fail-open `NoOpStore`. Landing `git.ts` flips real git workspaces
  from backend `"none"` to backend `"git"` with ZERO edits to store.ts (the forward-compat dynamic
  import already points here).

---

## What

A new module `src/snapshot/git.ts`:

- `export class GitBackend implements SnapshotStore` — async methods (Promise returns; see Task 1 for
  why the interface is async).
  - **constructor** `(cwd, revertConfig, sessionDir?, deps?)`: stores inputs, resolves `storageDir`
    (`config.storageDir ?? path.join(sessionDir, "mulligan")`), builds an `AsyncMutex`, holds the
    injected/default `exec` (promisified `execFile`) and `scan` (caps pre-walk).
  - **`describe()` (SYNC)** → `{ backend: "git" }`.
  - **`async init()`** (idempotent, also called lazily via private `ensureInit()`): `git rev-parse
    --show-toplevel` → repoRoot; `key = sha256(repoRoot).slice(0,16)`; `shadowDir =
    path.join(storageDir, key)`; `git init --bare` (skip if shadowDir exists).
  - **`async capture(label): Promise<string | null>`**: acquire mutex → ensureInit → caps pre-walk
    (skip oversize files via pathspec negations; abort if `maxTotalBytes`/`maxSnapshotsPerTurn`
    exceeded) → `git add --all -f -- . :!<globs> :!<oversize>` → `git write-tree` → `git commit-tree
    <tree> [-p <parent>] -m "snapshot:<label>"` → `git update-ref refs/mulligan/snapshots/<ns>/<part>
    <commit>` → return commitSha. On ANY error → `null` (best-effort, log + continue).
  - **S2 method stubs** (P2.M2.T1.S2): `async dirtyCheck/restore/has/retire` that throw
    `new Error("GitBackend.<m> not implemented — see P2.M2.T1.S2")`.
- ALL shadow write commands set `env: { ...process.env, GIT_DIR: shadowDir, GIT_WORK_TREE: repoRoot }`.
- The ONLY command against the user's repo is read-only `git rev-parse --show-toplevel` (cwd, no shadow env).

### Success Criteria

- [ ] `GitBackend implements SnapshotStore` type-checks (the interface is async — Task 1 applies it).
- [ ] `capture("turn")` issues, in order: `rev-parse --show-toplevel` → `init --bare` (first only) →
      `add --all -f -- . :!<excludes>` → `write-tree` → `commit-tree <tree> [-p <parent>] -m "snapshot:turn"`
      → `update-ref refs/mulligan/snapshots/turn/turn <commit>`.
- [ ] Every write command's `env.GIT_DIR === shadowDir`; **none** equals the source git dir (guarantee #1/#2).
- [ ] capture returns the commit SHA (trimmed stdout of `commit-tree`); `null` on any git failure (E27).
- [ ] Gitignored files are INCLUDED (`-f`); only `excludeGlobs` (+ oversize + dangerous dirs) are omitted.
- [ ] Caps: files > `maxFileBytes` skipped (pathspec `:!` + warn); `maxTotalBytes` exceeded → `null`;
      `maxSnapshotsPerTurn` exceeded → `null`.
- [ ] `init()` is idempotent — a second capture does NOT re-run `git init --bare`.
- [ ] Mutex serializes: concurrent `capture()` calls never overlap (max-in-flight === 1).
- [ ] `npm run typecheck` clean; `npm test` green (interface async change does not regress other suites).

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge": a developer who has never seen this repo gets the exact files to
create/edit, the EXACT git command sequences with env vars, the exact pathspec-negation syntax, the
exact ref-naming scheme, the DI test seam design, the exact store.ts correction (with rationale + line
regions), the codebase conventions (.js imports, `import type`, header JSDoc citing spec/14 §X,
hand-rolled fakes, vitest), and verified validation commands. The one architectural judgment call
(sync→async) is fully documented with the 3 independent signals that force it.

### Documentation & References

```yaml
# ── AUTHORITATIVE: the spec for this exact backend ──
- file: spec/14-working-tree-revert.md
  section: §3 GitBackend (external shadow repository)  — lines 79–108
  why: THE design for init/capture/restore/dirtyCheck + the FIVE git-safety guarantees. Capture flow:
       `add --all -f -- . ':!node_modules' ':!.venv'` → `write-tree` → `commit-tree -m …` →
       `update-ref refs/mulligan/snapshots/<…> <commit>`. `-f` forces gitignored files IN (`.gitignore`
       deliberately NOT consulted). Captured set = everything except `excludeGlobs`.
  critical: guarantee #1 — "No ref-moving or write command is ever issued against the user's git. The
       only command run against sourceGitDir is the READ-ONLY rev-parse." guarantee #2 — "The user's
       .git is never written — not even a dangling object." These two are what the unit tests assert.

- file: spec/14-working-tree-revert.md
  section: §5 Capture lifecycle & retention  — lines 132–155
  why: ref namespaces. turn snapshots → `refs/mulligan/snapshots/turn/*` (GC'd at prompt boundary);
       checkpoint → `refs/mulligan/snapshots/checkpoint/<name>` (GC-exempt). Caps (maxFileBytes /
       maxTotalBytes / maxSnapshotsPerTurn) → "capture stops accepting new data; snapshot marked
       partial; restore degrades to best-effort skipped[]" (E29). capture is best-effort, never blocks.

- file: spec/14-working-tree-revert.md
  section: §2 Architecture (the SnapshotStore) — lines 42–77
  why: the interface + detectAndCreate + placement tree (`src/snapshot/git.ts`). Note §2's TS notation
       `capture(label): string | null` is ILLUSTRATIVE shorthand — the actual contract (this task) is
       async (see Task 1 rationale). `RevertCheckpoint.backend` is `"git" | "cas"`.

- file: spec/14-working-tree-revert.md
  section: §4.3 AsyncMutex serialization contract — line 127
  why: "a single mutex per store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc).
       Pi preflights sibling tool_calls sequentially then runs them concurrently; the mutex makes
       capture/restore race-free." → capture MUST acquire the AsyncMutex (async).

# ── THE IMPLEMENTED CONTRACT this task consumes (read-only context; verify, don't assume) ──
- file: src/snapshot/store.ts
  why: (a) the SnapshotStore interface to `implements` (currently SYNC — Task 1 makes it async);
       (b) `AsyncMutex` (constructed per-backend; `acquire(): Promise<() => void>`); (c) `detectAndCreate`
       (P2.M1.T1.S2) dynamic-imports `./git.js` and does `new mod.GitBackend(cwd, revertConfig)` — Task 1
       adds `sessionDir`; (d) `GitBackendCtor` (local cast, ~line 223) — Task 1 adds `sessionDir?`.
  pattern: header JSDoc citing spec/14 §X + "DESIGN" bullets + "EXPORTED so …" footer (mirror this tone
       exactly on GitBackend). `import type { MulliganConfig } from "../config.js"`. `.js` import paths.
  gotcha: store.ts ALREADY imports `execFile as execFileCb` + `promisify` + `mkdir/access/constants` +
       `resolve/relative/isAbsolute` + `paths.js` + type `MulliganConfig` (S2 added them). git.ts adds
       its OWN `node:crypto` + `node:fs/promises` imports — do NOT rely on store.ts's.

- file: src/snapshot/paths.ts
  why: PURE path-safety helpers for the caps pre-walk. `isDangerousWorkspaceRel(rel)` (reject `.git`/
       `.pi`/`node_modules`/`..`/absolute/NUL) + `normalizeRelPath(root, abs)` (→ POSIX rel) +
       `resolveSafeWorkspacePath(root, rel)`. `DANGEROUS_DIRS` const. The caps walk MUST skip dangerous
       dirs in ADDITION to config.excludeGlobs (two independent layers — safety floor + perf filter).
  pattern: `import { normalizeRelPath, isDangerousWorkspaceRel } from "./paths.js"`.

- file: src/config.ts
  why: source of the `revertConfig` TYPE. `MulliganConfig["revert"]` is the 8-field block. There is NO
       exported `RevertConfig` name — index into `MulliganConfig["revert"]`. Fields used by capture:
       `storageDir: string | null`, `excludeGlobs: string[]`, `maxFileBytes`, `maxTotalBytes`,
       `maxSnapshotsPerTurn` (all numbers, validated > 0 by config.ts).
  pattern: `import type { MulliganConfig } from "../config.js";` (type-only → erased, no cycle).

- file: src/markers.ts
  why: `RevertCheckpoint { label; backend: "git"|"cas"; beforeRef; afterRef?; turnIndex; ts }`. The
       `capture()` return value (commitSha) becomes `beforeRef`/`afterRef`. backend is `"git"` here.
       Read-only context (do not edit).

- file: src/log.ts
  why: structured JSONL logger. NOTE: `logWarn(event, sessionId, data?)` requires a sessionId GitBackend
       does not have at capture time. DECISION: use `console.warn` for the rare caps warnings (matches
       `config.ts` warnConfig idiom) — structured logging is added when sessionId is threaded (P3).

- file: test/store.test.ts
  why: the EXACT test idiom (vitest, `.js` imports, `import type`, `expectTypeOf`, hand-rolled fakes,
       no `beforeEach` unless stateful). Task 1 UPDATES the 5 `expectTypeOf<SnapshotStore[…]>().returns`
       assertions (sync → Promise) + any NoOpStore behavior assertions (`await store.capture()`).

- file: test/tools/rewind.test.ts  +  test/commands.test.ts
  why: `vi.mock` IS available in this repo (commands.test.ts `vi.mock("../src/banner.js", …)` +
       `vi.mocked(...)` spies). So `vi.mock("node:child_process", …)` is a VALID alternative to the DI
       seam — but the DI seam (constructor-injected `exec`) is RECOMMENDED for arg-assertion clarity.

- docfile: plan/008_c36fd26768ae/architecture/external_deps.md
  section: §1 Git CLI (shadow repo) + the five git-safety guarantees; §4 no new npm deps (Node built-ins)
  why: pins the EXACT env-var command shape: `GIT_DIR=<shadow> GIT_WORK_TREE=<repoRoot> git …`, the
       `git init --bare`, the pathspec negation `:!glob`, the protected ref namespace, and that
       `child_process.execFile` + `crypto` + `fs.promises` are the sanctioned zero-dep primitives.

- docfile: plan/008_c36fd26768ae/P2M1T1S2/PRP.md
  section: detectAndCreate decision tree + GitBackendCtor contract + NoOpStore
  why: the factory that CONSTRUCTS GitBackend. Its git branch is `new mod.GitBackend(cwd, revertConfig)`.
       Task 1 aligns it to pass `sessionDir`. NoOpStore must be made async in lockstep with the interface.

- url: https://git-scm.com/docs/git-commit-tree
  why: `git commit-tree <tree> [-p <parent>] -m <msg>` → writes a commit object, prints its SHA. NO ref
       is moved by commit-tree (unlike `git commit`). This is why it is git-SAFE: it creates an object in
       the shadow object DB without touching any ref; the ref is set separately by `update-ref`.
  critical: `commit-tree` needs GIT_DIR pointing at the SHADOW repo or the object lands in the user's .git
       (guarantee #2 violation). Every capture command MUST carry the shadow env.

- url: https://git-scm.com/docs/git-add#_pathspec
  why: `:(exclude)pattern` / `:!pattern` pathspec magic — the exclusion syntax for `add -- . :!node_modules`.
  critical: a literal `:`-prefixed pathspec must be passed as a SINGLE argv element (`':!node_modules'`),
       not split. `--all -f` stages gitignored + untracked files (`.gitignore` ignored by `-f` semantics
       here because the SHADOW repo has no .gitignore of its own and we do not consult the user's).

- url: https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback
  why: `execFile` (no shell → no injection surface) + `options.env` override. `promisify` → rejects on
       non-zero exit (maps to "capture failed → null"). `options.maxBuffer` may need raising for large
       `write-tree`/`add` output (default 1 MB; set `maxBuffer: 16 * 1024 * 1024`).
```

### Current Codebase tree (relevant slice — verified)

```bash
src/snapshot/
  paths.ts        # P1.M2.T1.S1 — DONE. Pure path helpers (import normalizeRelPath, isDangerousWorkspaceRel).
  store.ts        # P2.M1.T1.S1+S2 — DONE (interface + AsyncMutex + detectAndCreate + NoOpStore).
                  #   ← Task 1 makes the interface methods ASYNC + adds sessionDir to GitBackendCtor.
  git.ts          # P2.M2.T1.S1 — ← THIS TASK CREATES (GitBackend: init + capture).
  cas.ts          # P2.M3.T1 — NOT YET PRESENT.
src/config.ts     # P1.M1.T1.S1 — DONE. MulliganConfig["revert"] (8 fields).
src/markers.ts    # P1.M2.T2.S1 — DONE. RevertCheckpoint (backend "git"|"cas").
src/log.ts        # DONE. console.warn used for caps warnings (no sessionId at capture time).
test/store.test.ts  # DONE (S1+S2). ← Task 1 updates the 5 expectTypeOf return assertions (+ NoOpStore await).
test/git.test.ts     # ← THIS TASK CREATES.
```

### Desired Codebase tree (files this task adds/changes)

```bash
src/snapshot/git.ts        # CREATE — GitBackend class (init + capture; S2-method stubs).
src/snapshot/store.ts      # MODIFY — interface methods → async (5); NoOpStore → async (5);
                           #          GitBackendCtor += sessionDir?; detectAndCreate git branch passes sessionDir.
test/store.test.ts         # MODIFY — 5 expectTypeOf return types sync→Promise; NoOpStore asserts await.
test/git.test.ts           # CREATE — capture command construction + git-safety invariant + caps + mutex.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the interface MUST be async (Task 1). store.ts currently declares capture() etc. SYNC
// (P2.M1.T1.S1 GOTCHA #1). This task's work-item contract says "async capture" + "acquire mutex" +
// "mock execFile". AsyncMutex.acquire() returns Promise — unusable in a sync method. execFileSync would
// freeze the TUI event loop. Therefore: make the 5 IO-bearing SnapshotStore methods return Promise
// (describe() stays sync), make NoOpStore's 5 methods async, fix the 5 test/store.test.ts expectTypeOf
// assertions. This is a bounded, in-scope correction — see Task 1 for exact edits + rationale.

// CRITICAL — every shadow write command carries env.GIT_DIR=shadowDir + GIT_WORK_TREE=repoRoot. The
// ONLY command against the user's repo is read-only `git rev-parse --show-toplevel` (cwd=this.cwd,
// NO GIT_DIR override). A capture that runs `add`/`write-tree`/`commit-tree`/`update-ref` WITHOUT the
// shadow env would write into the USER'S .git → guarantee #2 violation → the #1 thing tests catch.

// GOTCHA — execFile REJECTS on non-zero exit (promisify). That is the capture "best-effort → null"
// path: wrap the whole capture body in try/catch; on ANY thrown git error, log + return null (E27).
// Do NOT let capture reject — the SnapshotStore contract is "null on failure".

// GOTCHA — `commit-tree` does NOT move a ref (unlike `commit`). It writes one commit object + prints
// its SHA. The ref is set separately by `update-ref`. This two-step is WHY capture is git-safe: no ref
// is ever moved in the user's repo; the object lives in the shadow DB; the ref lives in the shadow refs.

// GOTCHA — pathspec negations are SINGLE argv elements: `':!node_modules'` (NOT two args). Quote so the
// shell is bypassed (execFile has no shell anyway, but the `!` must survive as one token). `--all -f`
// forces gitignored files in. Pass `--` then `.` then the `:!glob` excludes.

// GOTCHA — init() is NOT on the SnapshotStore interface. It is a GitBackend-specific method (lazy via
// private ensureInit, memoized as a stored Promise so concurrent first-captures share ONE init). Public
// `async init()` delegates to ensureInit (the work-item names init() explicitly).

// GOTCHA — key is hashed from REPO ROOT (`rev-parse --show-toplevel`), NOT cwd. PRD §3: "keyed by the
// resolved repo root, so subdirectory launches share it." Fall back to resolved cwd if rev-parse fails.

// GOTCHA — no sessionId at capture time (capture is called from turn_start/agent_end which HAVE ctx,
// but capture() only receives `label`). Caps warnings use console.warn (matches config.ts warnConfig);
// structured log.ts logging is added in P3 when sessionId is threaded. Do NOT invent a sessionId.

// GOTCHA — `execFile` default `maxBuffer` is 1 MB. `write-tree` / `add` output is tiny, but be safe:
// pass `maxBuffer: 16 * 1024 * 1024` on every git call so a large repo never aborts capture spuriously.

// GOTCHA — `.js` import paths are house style under moduleResolution "Bundler" (see test/paths.test.ts,
// every src import in test/integration/smoke.ts). `import type` for MulliganConfig. `node:` prefixes.
// tsconfig is strict + noImplicitAny → no `any` without a comment justifying it.
```

---

## Implementation Blueprint

### Data models and structure

No persistent data models beyond what `markers.ts` (`RevertCheckpoint`) + `store.ts` already define.
The new module-local types:

```ts
import type { ExecFileException } from "node:child_process";
import type { MulliganConfig } from "../config.js";

/** A promisified-execFile shape — the DI test seam (real default = promisify(execFile)). */
type GitExec = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

/** Result of the caps pre-walk (sizes only — no content read). */
interface CapScan {
  /** Workspace-relative POSIX paths exceeding maxFileBytes (added as :! negations). */
  oversizePaths: string[];
  /** Sum of NON-oversize file sizes (compared against maxTotalBytes). */
  totalBytes: number;
}

/** Constructor DI seam (all optional; production omits → real impls). */
interface GitBackendDeps {
  /** Default: promisify(execFile). Tests inject a recording fake asserting argv + env. */
  exec?: GitExec;
  /** Default: real recursive fs walk. Tests inject a canned {oversizePaths,totalBytes}. */
  scan?: (repoRoot: string, excludeGlobs: readonly string[]) => Promise<CapScan>;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/store.ts — make the SnapshotStore interface + NoOpStore ASYNC
  WHY (re-read before editing): the work-item contract for P2.M2.T1.S1 says "async capture" +
    "acquire mutex" + "mock execFile". AsyncMutex.acquire() returns Promise — UNUSABLE in a sync method.
    execFileSync would freeze the Pi event loop. The sync interface (S1 GOTCHA #1) was a downstream
    misread of spec/14 §2's illustrative TS notation. This correction is REQUIRED for GitBackend to
    implement the interface truthfully. Bounded: ~15 lines.
  - EDIT the SnapshotStore interface (5 methods → Promise returns; describe() UNCHANGED — stays sync):
      capture(label: string): Promise<string | null>;
      dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>;
      restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult>;
      has(ref: string): Promise<boolean>;
      retire(ref: string): Promise<void>;
      describe(): { backend: "git" | "cas" | "none"; reason?: string };   # unchanged (sync — pure metadata)
  - EDIT the per-method JSDoc: change "SYNCHRONOUS" / "GOTCHA #1" wording to "ASYNC (Promise return);
    serialized via AsyncMutex — spec/14 §4.3". (Keep the rest of each JSDoc.)
  - EDIT NoOpStore (5 methods → async no-ops):
      async capture(_label: string): Promise<null> { return null; }
      async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> { return []; }
      async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> { return {reverted:[],deleted:[],failed:[],skipped:[],refused:[]}; }
      async has(_ref: string): Promise<boolean> { return false; }
      async retire(_ref: string): Promise<void> { /* no-op */ }
    (describe() unchanged — sync.)
  - EDIT GitBackendCtor (~line 223): add the sessionDir param the default-storageDir path needs:
      interface GitBackendCtor { new (cwd: string, revertConfig: MulliganConfig["revert"], sessionDir?: string | null): SnapshotStore; }
    (Update its JSDoc: "sessionDir? — used only when storageDir is null, to resolve <sessionDir>/mulligan/.")
  - EDIT detectAndCreate's git branch (~line 374): pass sessionDir:
      return new mod.GitBackend(cwd, revertConfig, sessionDir);
  - PRESERVE: every other export (RestoreOpts/RestoreResult/AsyncMutex/resolveStorageDir/summarize/
    detectAndCreate signature/CasBackendCtor) byte-for-byte. detectAndCreate is ALREADY async — no change
    to its body except the one GitBackend construction line.
  - GOTCHA: AsyncMutex itself is UNCHANGED (it was always async — that's why it couldn't be used in a
    sync method; now it CAN be, which is the whole point of this correction).

Task 2: MODIFY test/store.test.ts — update the type + NoOpStore assertions for async
  - EDIT the 5 `expectTypeOf<SnapshotStore[…]>().returns.toEqualTypeOf<…>()` assertions:
      capture   → Promise<string | null>
      dirtyCheck → Promise<string[]>
      restore   → Promise<RestoreResult>
      has       → Promise<boolean>
      retire    → Promise<void>
    (describe assertion unchanged.)
  - IF the file (S2) added NoOpStore BEHAVIOR assertions (not just type), make them `await`:
      e.g. `expect(await noop.capture("x")).toBe(null);` / `expect(await noop.restore(...)).toEqual({...})`.
      If S2 only has type assertions, only the 5 edits above are needed. Inspect the file first.
  - GOTCHA: the AsyncMutex behavioral tests (acquire/release/serialization) are UNAFFECTED (the mutex was
    always async). Do not touch them.

Task 3: CREATE src/snapshot/git.ts — GitBackend (init + capture)
  - IMPORTS (top of file, node: prefixes, .js for project modules):
      import { execFile as execFileCb } from "node:child_process";
      import { promisify } from "node:util";
      import { createHash } from "node:crypto";
      import { readdir, stat } from "node:fs/promises";
      import { existsSync } from "node:fs";
      import { join, resolve, relative, sep } from "node:path";
      import { AsyncMutex, type SnapshotStore, type RestoreOpts, type RestoreResult } from "./store.js";
      import { normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS } from "./paths.js";
      import type { MulliganConfig } from "../config.js";
      const execFileDefault = promisify(execFileCb);
  - HEADER JSDoc: cite spec/14 §3 (GitBackend + the FIVE git-safety guarantees), §5 (capture lifecycle),
      §4.3 (AsyncMutex), external_deps.md §1; "DESIGN" bullets explaining: shadow-repo isolation, repo-root
      keying, lazy idempotent init, capture pipeline, caps pre-walk, async/DI-seam rationale; "EXPORTED so
      detectAndCreate (P2.M1.T1.S2) dynamic-imports ./git.js" footer. Mirror store.ts header density.
  - TYPES: GitExec, CapScan, GitBackendDeps (see "Data models" above).
  - MODULE-PRIVATE helpers:
      function refForLabel(label: string): string {
        if (label.startsWith("ckpt:")) return `refs/mulligan/snapshots/checkpoint/${label.slice(5)}`;
        return `refs/mulligan/snapshots/turn/${label}`;   // "turn" | "turn-after" → turn/*
      }
      function shadowKey(repoRoot: string): string {   // 16-hex; repo-root-keyed (subdir launches share)
        return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
      }
  - CLASS:
      export class GitBackend implements SnapshotStore {
        private readonly cwd: string;
        private readonly cfg: MulliganConfig["revert"];
        private readonly storageDir: string;
        private readonly sessionDir: string | null;
        private readonly mutex = new AsyncMutex();
        private readonly exec: GitExec;
        private readonly scan: (root: string, globs: readonly string[]) => Promise<CapScan>;
        // resolved lazily by ensureInit:
        private repoRoot!: string;
        private sourceGitDir!: string;
        private shadowDir!: string;
        private lastCommit: string | null = null;   // optional -p <parent> chaining
        private capturesThisTurn = 0;               // maxSnapshotsPerTurn cap (reset by lifecycle P3)
        private initPromise: Promise<void> | null = null;

        constructor(cwd, revertConfig, sessionDir?, deps?) {
          this.cwd = resolve(cwd);
          this.cfg = revertConfig;
          this.sessionDir = sessionDir ?? null;
          this.storageDir = revertConfig.storageDir ?? (sessionDir ? join(sessionDir, "mulligan") : (() => { throw new Error("GitBackend: storageDir null and no sessionDir"); })());
          this.exec = deps?.exec ?? (execFileDefault as GitExec);
          this.scan = deps?.scan ?? scanForCaps;
        }

        describe(): { backend: "git" } { return { backend: "git" }; }

        async init(): Promise<void> { await this.ensureInit(); }

        private ensureInit(): Promise<void> {
          if (this.initPromise) return this.initPromise;   // memoize: concurrent first-calls share ONE init
          this.initPromise = (async () => {
            // (1) read-only resolve against the USER's repo — cwd, NO shadow env. Guarantee #1.
            const top = (await this.exec("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd })).stdout.trim();
            const gitDir = (await this.exec("git", ["rev-parse", "--absolute-git-dir"], { cwd: this.cwd })).stdout.trim();
            this.repoRoot = top || this.cwd;       // PRD: repo-root-keyed; fallback cwd
            this.sourceGitDir = gitDir;
            this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot));
            // (2) lazily init the SHADOW repo (idempotent — skip if it already exists)
            if (!existsSync(this.shadowDir)) {
              await this.exec("git", ["init", "--bare"], this.shadowEnv());
            }
          })().catch((e) => { this.initPromise = null; throw e; });   // a failed init can retry next call
          return this.initPromise;
        }

        async capture(label: string): Promise<string | null> {
          const release = await this.mutex.acquire();   // spec/14 §4.3 — serialize ALL store ops
          try {
            await this.ensureInit();
            // CAPS (E29): pre-walk for sizes. Oversize → pathspec negation + warn; budget → abort.
            if (this.capturesThisTurn >= this.cfg.maxSnapshotsPerTurn) {
              console.warn(`[mulligan] snapshot.capture: maxSnapshotsPerTurn (${this.cfg.maxSnapshotsPerTurn}) reached — skipping`);
              return null;
            }
            const { oversizePaths, totalBytes } = await this.scan(this.repoRoot, this.cfg.excludeGlobs);
            if (totalBytes > this.cfg.maxTotalBytes) {
              console.warn(`[mulligan] snapshot.capture: maxTotalBytes (${this.cfg.maxTotalBytes}) exceeded (${totalBytes}) — aborting`);
              return null;
            }
            for (const p of oversizePaths) console.warn(`[mulligan] snapshot.capture: skipping oversize file (> ${this.cfg.maxFileBytes} B): ${p}`);
            // PATHSPECS: include all (.), then exclude globs + oversize, as :! single-argv elements.
            const pathspecs = [".",
              ...this.cfg.excludeGlobs.map((g) => `:!${g}`),
              ...oversizePaths.map((p) => `:!${p}`),
            ];
            // (3) stage into the SHADOW index — gitignored files INCLUDED via -f (spec §3).
            await this.exec("git", ["add", "--all", "-f", "--", ...pathspecs], this.shadowEnv());
            // (4) write-tree → tree SHA (shadow DB).
            const treeSha = (await this.exec("git", ["write-tree"], this.shadowEnv())).stdout.trim();
            // (5) commit-tree → commit SHA (shadow DB; no ref moved). Optional -p parent for history.
            const commitArgs = ["commit-tree", treeSha];
            if (this.lastCommit) commitArgs.push("-p", this.lastCommit);
            commitArgs.push("-m", `snapshot:${label}`);
            const commitSha = (await this.exec("git", commitArgs, this.shadowEnv())).stdout.trim();
            // (6) pin via a protected ref in the SHADOW repo (namespace: turn/* | checkpoint/<name>).
            await this.exec("git", ["update-ref", refForLabel(label), commitSha], this.shadowEnv());
            this.lastCommit = commitSha;
            this.capturesThisTurn++;
            return commitSha;
          } catch (err) {
            // E27 best-effort: ANY git error → null (capture never rejects). Guarantees capture is non-fatal.
            console.warn(`[mulligan] snapshot.capture failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          } finally {
            release();
          }
        }

        private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
          return { env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot }, maxBuffer: 16 * 1024 * 1024 };
        }

        // ── P2.M2.T1.S2 stubs (dirtyCheck/restore/has/retire) — NOT implemented here. ──
        async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> { throw new Error("GitBackend.dirtyCheck not implemented — see P2.M2.T1.S2"); }
        async restore(_beforeRef: string, _opts: RestoreOpts): Promise<RestoreResult> { throw new Error("GitBackend.restore not implemented — see P2.M2.T1.S2"); }
        async has(_ref: string): Promise<boolean> { throw new Error("GitBackend.has not implemented — see P2.M2.T1.S2"); }
        async retire(_ref: string): Promise<void> { throw new Error("GitBackend.retire not implemented — see P2.M2.T1.S2"); }
      }

  - scanForCaps (module-private, default scan): recursive readdir walk of repoRoot; skip entries whose
      normalizeRelPath is isDangerousWorkspaceRel OR matches any excludeGlob (segment/substring test —
      keep simple); for each file, stat().size; if > maxFileBytes → push to oversizePaths; else +=
      totalBytes. Return {oversizePaths, totalBytes}. (GOTCHA: uses this.cfg inside the class default —
      pass maxFileBytes via closure OR make scanForCaps take (root, globs, maxFileBytes); prefer the
      latter so the DI seam signature stays clean. Adjust the deps.scan type + default accordingly.)
  - GOTCHA: `initPromise` memoization + the `.catch(reset)` lets a TRANSIENT init failure (e.g. disk
      full) retry on the next capture rather than permanently bricking the backend. Keep it.
  - GOTCHA: the stubs THROW (not silent no-ops) so a premature caller fails loud. detectAndCreate is not
    wired into index.ts until P3.M1.T2 (after S2 lands), so no live code hits them.

Task 4: CREATE test/git.test.ts — capture command construction + git-safety + caps + mutex
  - IMPORTS (house style):
      import { describe, it, expect } from "vitest";
      import { GitBackend, type GitExec, type CapScan } from "../src/snapshot/git.js";
      import { AsyncMutex } from "../src/snapshot/store.js";
  - HEADER comment: spec/14 §3 (capture flow + 5 guarantees), §5 (caps), §4.3 (mutex); what's mocked
      (exec + scan via DI) vs what's real (AsyncMutex); P2.M2.T1.S1 scope (init+capture; S2 stubs throw).
  - SHARED fake-exec builder:
      type Call = { file: string; args: string[]; opts?: { cwd?: string; env?: NodeJS.ProcessEnv } };
      function makeExec(calls: Call[]): GitExec {
        return async (file, args, opts) => {
          calls.push({ file, args, opts });
          if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { stdout: "/fake/repo\n", stderr: "" };
          if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir") return { stdout: "/fake/repo/.git\n", stderr: "" };
          if (args[0] === "write-tree") return { stdout: "TREE123\n", stderr: "" };
          if (args[0] === "commit-tree") return { stdout: "COMMIT456\n", stderr: "" };
          return { stdout: "", stderr: "" };
        };
      }
    (Tests assert on `calls`.)
  - describe("GitBackend.capture — command construction (spec/14 §3)"):
      - it("issues rev-parse --show-toplevel against the USER repo (cwd, NO shadow GIT_DIR)"): construct
        with makeExec, storageDir set (sessionDir null), scan=()=>({oversizePaths:[],totalBytes:0});
        await capture("turn"); find the rev-parse call → assert opts.cwd === cwd AND
        (opts.env?.GIT_DIR === undefined OR === process.env.GIT_DIR) — i.e. NOT the shadow dir.
      - it("issues git init --bare ONCE against the SHADOW repo (GIT_DIR=shadow), then NOT again"):
        capture twice; count init --bare calls === 1; assert that call's env.GIT_DIR === expected shadow
        (join(storageDir, sha256("/fake/repo").slice(0,16))).
      - it("capture('turn') runs add --all -f + write-tree + commit-tree + update-ref in order, ALL with
        GIT_DIR=shadow"): after capture, filter calls by args[0] in {add,write-tree,commit-tree,update-ref};
        assert each present, in that relative order, and EACH opts.env.GIT_DIR === shadowDir AND
        opts.env.GIT_WORK_TREE === "/fake/repo".
      - it("add pathspec includes '.' and ':!<each excludeGlob>'"): assert the add call's args contain
        "--", ".", and `':!'+g` for each g in the passed excludeGlobs. (Pass excludeGlobs:["node_modules",
        ".venv"] in the revertConfig fixture.)
      - it("commit-tree carries -m 'snapshot:<label>' and -p <prevCommit> on the 2nd capture"): 2nd
        capture's commit-tree args include "-m","snapshot:turn-after" and "-p","COMMIT456".
      - it("update-ref writes refs/mulligan/snapshots/turn/<label> for turn labels, checkpoint/<name> for
        ckpt:"): capture("turn") → ref "refs/mulligan/snapshots/turn/turn"; capture("ckpt:foo") →
        "refs/mulligan/snapshots/checkpoint/foo".
      - it("returns the commit SHA (trimmed commit-tree stdout)"): await capture("turn") === "COMMIT456".
  - describe("GitBackend — the five git-safety guarantees (spec/14 §3)"):
      - it("GUARANTEE #1/#2: NO write command's env.GIT_DIR is the SOURCE git dir"): for every call whose
        args[0] in {add,write-tree,commit-tree,update-ref,init}, assert opts.env.GIT_DIR === shadowDir
        (strictly ≠ "/fake/repo/.git"). This is the marquee assertion — if it ever fails, capture is
        writing into the user's .git.
      - it("the ONLY command without the shadow env is the read-only rev-parse"): assert exactly the
        rev-parse calls have cwd set + no shadow GIT_DIR; every other call has the shadow env.
  - describe("GitBackend.capture — best-effort + caps (E29/E27)"):
      - it("returns null when git add fails (exec rejects)"): make exec throw on "add"; await capture →
        null; capture did NOT reject.
      - it("skips oversize files via :! negation + still captures"): scan=()=>({oversizePaths:["big.bin"],
        totalBytes:10}); capture → the add pathspecs include ":!big.bin".
      - it("returns null when totalBytes > maxTotalBytes"): scan=()=>({oversizePaths:[], totalBytes: 999});
        cfg.maxTotalBytes=100; capture → null AND no add/write-tree/commit-tree issued (abort before add).
      - it("returns null when capturesThisTurn >= maxSnapshotsPerTurn"): set maxSnapshotsPerTurn=0;
        capture → null (no git calls beyond ensureInit).
  - describe("GitBackend — mutex serialization (spec/14 §4.3)"):
      - it("concurrent capture() never overlap (max-in-flight 1)"): an exec that records active count
        (increment on entry, await a microDelay, decrement on exit); Promise.all 5 captures; assert
        maxActive === 1. (Reuse the AsyncMutex test idiom from test/store.test.ts.)
  - describe("GitBackend — S2 stubs throw (P2.M2.T1.S2 scope)"):
      - it("dirtyCheck/restore/has/retire throw 'not implemented — see P2.M2.T1.S2'"): await
        expect(gb.dirtyCheck(...)).rejects.toThrow(/P2\.M2\.T1\.S2/); (×4).
  - GOTCHA: to make capture reach the add/commit-tree calls WITHOUT real git, the DI exec fake must
    return canned stdout for write-tree/commit-tree (above) AND scan must be injected (else the real
    fs walk runs against /fake/repo which does not exist → capture aborts). ALWAYS inject BOTH exec + scan.
```

### Implementation Patterns & Key Details

```ts
// The shadow-env helper — EVERY write command goes through it. This is guarantee #1/#2 made mechanical.
private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
  return {
    env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot },
    maxBuffer: 16 * 1024 * 1024,   // avoid spurious abort on large repos
  };
}
// USAGE: await this.exec("git", ["add","--all","-f","--",...pathspecs], this.shadowEnv());
//        await this.exec("git", ["rev-parse","--show-toplevel"], { cwd: this.cwd });  // ← NO shadowEnv (source read)

// Pathspec negation — single argv element per exclude. `--` then `.` (all) then the `:!` excludes.
const pathspecs = [".", ...excludeGlobs.map(g => `:!${g}`), ...oversize.map(p => `:!${p}`)];
await this.exec("git", ["add","--all","-f","--", ...pathspecs], this.shadowEnv());

// The two-step object+ref write — WHY capture is git-safe (commit-tree moves NO ref):
const treeSha = (await this.exec("git", ["write-tree"], this.shadowEnv())).stdout.trim();
const commitSha = (await this.exec("git", ["commit-tree", treeSha, /*opt -p parent,*/ "-m", `snapshot:${label}`], this.shadowEnv())).stdout.trim();
await this.exec("git", ["update-ref", refForLabel(label), commitSha], this.shadowEnv());

// Lazy memoized init — concurrent first-captures share ONE init; a transient failure retries next call.
private ensureInit(): Promise<void> {
  if (this.initPromise) return this.initPromise;
  this.initPromise = (async () => { /* rev-parse → repoRoot; sha256 key; git init --bare if !exists */ })()
    .catch((e) => { this.initPromise = null; throw e; });
  return this.initPromise;
}

// capture's whole body is one try/finally (mutex) with an inner try/catch (best-effort → null).
async capture(label: string): Promise<string | null> {
  const release = await this.mutex.acquire();
  try { /* ensureInit; caps; add; write-tree; commit-tree; update-ref; return commitSha */ }
  catch (err) { console.warn(...); return null; }   // E27 — capture NEVER rejects
  finally { release(); }
}
```

### Integration Points

```yaml
CONSUMERS (downstream — satisfy the contract, do NOT implement here):
  - detectAndCreate (store.ts, P2.M1.T1.S2 — shipped): dynamic-imports ./git.js; Task 1 aligns its git
    branch to `new mod.GitBackend(cwd, revertConfig, sessionDir)`. After git.ts lands, real git
    workspaces return backend "git" instead of fail-open "none" — with ZERO further store.ts edits.
  - turn_start / agent_end hooks (P3.M1.T1): call `await store.capture("turn")` / `capture("turn-after")`.
  - /mulligan_checkpoint step 4b (P3.M2.T1): `await store.capture("ckpt:<name>")`.
  - capture() return (commitSha) → RevertCheckpoint.beforeRef / .afterRef (markers.ts).

PRODUCES (upstream deps — ship LATER, this task stubs them):
  - P2.M2.T1.S2: dirtyCheck (git diff --name-only <afterRef> -- <paths>), restore (read-tree + checkout
    -- <paths>), has (rev-parse / cat-file -e), retire (for-each-ref --points-at + update-ref -d).
  - P3.M1.T1.S1: prompt-boundary GC — `update-ref -d refs/mulligan/snapshots/turn/*` + `git gc --auto
    --prune=now`. MUST agree on refForLabel's turn/* namespace (documented in the helper's JSDoc).
  - P3: resets `capturesThisTurn` at the turn boundary (the cap counter's lifecycle owner).

CONFIG: no config.ts changes. capture READS revertConfig (storageDir, excludeGlobs, maxFileBytes,
  maxTotalBytes, maxSnapshotsPerTurn). storageDir===null → default <sessionDir>/mulligan/ (needs the
  sessionDir Task 1 threads into GitBackendCtor).

NO DATABASE / NO ROUTES / NO NEW DEPS. Node built-ins only (child_process, crypto, fs, path, util) +
  the existing AsyncMutex + paths.ts helpers. (architecture/external_deps.md §4.)
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating git.ts + editing store.ts/test. This project's "lint" IS tsc (no eslint/ruff).
npm run typecheck                 # tsc --noEmit (strict + noImplicitAny). MUST be clean.
# CRITICAL CHECKS:
#   - "GitBackend" incorrectly implements "SnapshotStore" → a method signature mismatch (async vs sync);
#     if seen, Task 1's interface edit was incomplete (re-check all 5 methods + NoOpStore).
#   - "Cannot find name 'GitExec'/'CapScan'" → forgot to export the DI-seam types from git.ts for tests.
#   - No "any" without justification (strict). The `as GitExec` cast on promisify(execFile) is intentional.

npx vitest run test/git.test.ts test/store.test.ts   # the two files this task owns/touches.
npm test                                            # FULL suite — must stay green (the async change is localized).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: capture command construction + the git-safety invariant + caps + mutex.
npx vitest run test/git.test.ts -v
# Expected: all green. The marquee test ("NO write command's env.GIT_DIR is the SOURCE git dir") MUST pass
# — it is the mechanical enforcement of guarantees #1/#2.

# Regression: the interface async-ification must not break other suites.
npm test
# Expected: ALL green. If a non-snapshot test broke, Task 1 over-reached (re-check it touched ONLY the 5
# SnapshotStore methods + NoOpStore + GitBackendCtor + detectAndCreate's one construction line).
```

### Level 3: Integration Testing (System Validation)

```bash
# Real-git smoke: construct a GitBackend against a REAL temp git repo + real storageDir, capture, and
# verify the SHADOW repo (not the user's .git) holds the objects. Proves the dynamic-import contract +
# guarantee #2 end-to-end. (No server/DB in this project — "integration" = real git + real fs.)
node --input-type=module -e '
  import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
  import { tmpdir } from "node:os"; import { join } from "node:path";
  import { execFile } from "node:child_process"; import { promisify } from "node:util";
  const x = promisify(execFile);
  const repo = await mkdtemp(join(tmpdir(), "repo-")); const store = await mkdtemp(join(tmpdir(), "store-"));
  await x("git", ["init"], { cwd: repo });
  await writeFile(join(repo, "a.txt"), "hello");
  await writeFile(join(repo, ".env"), "SECRET=1");          // gitignored-style file MUST be captured
  const { GitBackend } = await import("./src/snapshot/git.ts");
  const gb = new GitBackend(repo, { enabled:true, allowDeleteCreatedFiles:false, nonGitMode:"cas",
    storageDir: store, maxFileBytes:262144, maxTotalBytes:33554432, maxSnapshotsPerTurn:64,
    excludeGlobs:[".git","node_modules","dist","build",".next",".venv","target"] });
  const sha = await gb.capture("turn");
  console.log("captured ref:", sha);
  // Guarantee #2: the user's .git objects are byte-identical (no dangling blob from capture).
  const beforeObjs = (await x("git", ["count-objects","-v"], { cwd: join(repo,".git") })).stdout;
  console.log("user .git count-objects (should show NO in-flight growth from capture):", beforeObjs.trim());
  // The shadow repo exists under store/ and holds the commit:
  const shadowKey = (await import("node:crypto")).createHash("sha256").update(repo).digest("hex").slice(0,16);
  console.log("shadow repo exists:", (await readdir(store)).includes(shadowKey));
  await rm(repo, { recursive:true, force:true }); await rm(store, { recursive:true, force:true });
' 2>&1 | tail -20
# Expected: "captured ref: <40-hex sha>"; shadow repo exists: true; user .git count-objects shows NO
# growth attributable to capture (the .env blob is in the SHADOW repo, not the user's).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# git-safety sentinel — prove NO write command ever targeted the source .git. Run the real-git smoke
# above but intercept: easier path is the unit test's marquee assertion (Level 2). Additionally, verify
# the user's `git status` / `git log` are byte-for-byte unaffected after a capture:
node --input-type=module -e '
  import { mkdtemp, writeFile, rm } from "node:fs/promises"; import { tmpdir } from "node:os";
  import { join } from "node:path"; import { execFile } from "node:child_process"; import { promisify } from "node:util";
  const x = promisify(execFile);
  const repo = await mkdtemp(join(tmpdir(),"repo-")); const store = await mkdtemp(join(tmpdir(),"store-"));
  await x("git",["init"],{cwd:repo}); await x("git",["config","user.email","t@t"],{cwd:repo});
  await x("git",["config","user.name","t"],{cwd:repo});
  await x("git",["commit","--allow-empty","-m","baseline"],{cwd:repo});   // establish a baseline commit
  const statusBefore = (await x("git",["status","--porcelain"],{cwd:repo})).stdout;
  const logBefore = (await x("git",["rev-list","--all","--count"],{cwd:repo})).stdout;
  const { GitBackend } = await import("./src/snapshot/git.ts");
  await writeFile(join(repo,"b.txt"),"x");
  await (new GitBackend(repo,{enabled:true,allowDeleteCreatedFiles:false,nonGitMode:"cas",storageDir:store,
    maxFileBytes:262144,maxTotalBytes:33554432,maxSnapshotsPerTurn:64,excludeGlobs:["node_modules"]})).capture("turn");
  const statusAfter = (await x("git",["status","--porcelain"],{cwd:repo})).stdout;
  const logAfter = (await x("git",["rev-list","--all","--count"],{cwd:repo})).stdout;
  console.log("git status unchanged by capture:", statusBefore === statusAfter, "(b.txt still shows as ?? b.txt — NOT staged/committed into user repo)");
  console.log("user git commit count unchanged by capture:", logBefore === logAfter);
  await rm(repo,{recursive:true,force:true}); await rm(store,{recursive:true,force:true});
' 2>&1 | tail -5
# Expected: "git status unchanged: true" + "user git commit count unchanged: true". If either is false,
# capture wrote into the user's .git → guarantee violation → STOP and audit every call's env.GIT_DIR.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: `npm run typecheck` clean — incl. `GitBackend implements SnapshotStore` (async interface).
- [ ] Level 2: `npx vitest run test/git.test.ts` green; `npm test` (full suite) green (no regressions).
- [ ] Level 3: the real-git smoke prints a 40-hex ref + `shadow repo exists: true` + no user-.git growth.
- [ ] Level 4: `git status` + `git rev-list --count` byte-identical before/after capture (guarantees #2/#3).

### Feature Validation

- [ ] `capture("turn")` issues the exact 6-command pipeline (rev-parse → init --bare → add -f → write-tree → commit-tree → update-ref) in order.
- [ ] Every write command carries `env.GIT_DIR === shadowDir`; NO write command's env.GIT_DIR is the source git dir (marquee unit assertion + Level 4).
- [ ] Gitignored files (`.env`) ARE captured (`-f`); only `excludeGlobs` (+ oversize + dangerous dirs) are omitted (Level 3 confirms `.env` is in the shadow repo).
- [ ] Oversize files skipped (`:!` negation + warn); `maxTotalBytes`/`maxSnapshotsPerTurn` exceeded → `null`.
- [ ] capture returns the commit SHA; returns `null` on any git error (never rejects — E27).
- [ ] `init()` idempotent (2nd capture does not re-run `git init --bare`); concurrent captures serialized by the mutex (max-in-flight 1).
- [ ] ref namespaces correct: `turn`/`turn-after` → `refs/mulligan/snapshots/turn/*`; `ckpt:<name>` → `…/checkpoint/<name>`.

### Code Quality Validation

- [ ] Header JSDoc cites spec/14 §3 (incl. the five guarantees) + §5 + §4.3 + external_deps §1; "DESIGN" bullets + "EXPORTED so …" footer (mirrors store.ts density).
- [ ] `.js` import paths; `import type` for MulliganConfig; `node:` prefixes on all built-ins; no unjustified `any`.
- [ ] DI seam (`deps.exec` / `deps.scan`) is OPTIONAL with real defaults — production construction omits it.
- [ ] Task 1's store.ts edits are MINIMAL: only the 5 interface methods + NoOpStore's 5 + GitBackendCtor's sessionDir + detectAndCreate's one construction line. AsyncMutex + RestoreOpts/RestoreResult + resolveStorageDir/summarize/CasBackendCtor untouched.

### Documentation & Deployment

- [ ] [Mode A] JSDoc on `GitBackend` class + `capture` cites spec/14 §3's five git-safety guarantees (item contract DOCS — "rides WITH the work").
- [ ] `refForLabel` JSDoc documents the turn/*/checkpoint namespace contract that GC (P3) + retire (S2) depend on.
- [ ] The S2-method stubs' error messages name P2.M2.T1.S2 so the next implementer finds this file.

---

## Anti-Patterns to Avoid

- ❌ Don't run ANY write command (`add`/`write-tree`/`commit-tree`/`update-ref`/`init`/`gc`) WITHOUT the
  shadow env (`GIT_DIR=shadowDir`). A single bare `git add` writes into the USER's `.git` → guarantee #2
  violation. The `shadowEnv()` helper exists so every write goes through it — use it religiously.
- ❌ Don't make capture sync / use `execFileSync` — it freezes the Pi event loop AND breaks the
  "acquire mutex" + "mock execFile" contract. The interface is async (Task 1); honor it.
- ❌ Don't let `capture()` reject — wrap the body in try/catch and return `null` on ANY git error (E27).
- ❌ Don't consult `.gitignore` — `-f` deliberately forces gitignored files IN; a gitignored `.env` is
  exactly the file a revert must restore (spec §3). Exclude ONLY via `excludeGlobs` (+ caps + DANGEROUS_DIRS).
- ❌ Don't split a pathspec negation into two argv tokens — `':!node_modules'` is ONE element.
- ❌ Don't hash `cwd` for the storage key — hash the REPO ROOT (`rev-parse --show-toplevel`) so
  subdirectory launches share one shadow repo (PRD §3).
- ❌ Don't over-reach in Task 1 (store.ts) — touch ONLY the 5 interface methods + NoOpStore + GitBackendCtor
  + detectAndCreate's one line. AsyncMutex / RestoreOpts / RestoreResult / resolveStorageDir are OFF-LIMITS.
- ❌ Don't implement dirtyCheck/restore/has/retire here — they are P2.M2.T1.S2. Ship throwing stubs.
- ❌ Don't invent a sessionId for log.ts — use `console.warn` for the rare caps warnings (config.ts idiom);
  structured logging is threaded when capture's callers pass sessionId (P3).

---

## Confidence Score: 8/10

One-pass success is likely. The design is fully pinned (exact commands, env vars, pathspec syntax, ref
names, caps logic, DI seam, test assertions, store.ts correction with rationale). The two residual risks:

1. **The store.ts interface async-ification (Task 1)** is a deliberate, in-scope correction of S1/S2's
   "sync" decision — it is justified by 3 independent contract signals (async capture / acquire mutex /
   mock execFile) and is bounded (~15 lines), but it DOES touch S1/S2's shipped surface. If the
   implementer hesitates, the rationale + exact edits in Task 1 resolve it; the alternative (sync
   execFileSync) is architecturally wrong and breaks the contract. Mitigated by clear docs.
2. **detectAndCreate's git branch currently omits sessionDir** — Task 1 adds it. Without it, a git
   workspace with `storageDir===null` would fail-open (GitBackend ctor throws → NoOpStore). The one-line
   alignment in Task 1 fixes this. Forward-compatible (S2's existing call still compiles).

Neither risk threatens the core (capture pipeline + git-safety + caps + tests), which is fully
implementable and verifiable in isolation.