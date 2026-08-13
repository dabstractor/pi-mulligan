# Delta PRD — Detection safety hardening (remove upward repo discovery in revert)

**Base:** v1.2 codebase (previous session 008 completed P1–P5: the full working-tree-revert feature — `SnapshotStore`, `GitBackend`, `CasBackend`, capture lifecycle, rewind step 6b, 8 integration scenarios).
**Delta source:** single spec commit `6e326d2` ("spec: harden detection safety and remove upward repo discovery in revert") — the ONLY change between the session-8 PRD snapshot and the current PRD.
**Spec reference:** `@spec/14-working-tree-revert.md` §2 (Detection + new SAFETY INVARIANT), §3 (GitBackend init + guarantee #1), §10 (Testing) + a one-line amendment in `@spec/11-build-order.md` Step 6c. The spec is **already fully written** — this is an **implementation-only** delta that retrofits an existing, shipped feature with a non-negotiable safety guard.

---

## 1. What changed (diff analysis)

`git show 6e326d2 --stat` → **2 spec files, +9 / −6 lines.** A surgical, single-concern change: the working-tree-revert **detection** no longer performs upward git discovery and no longer issues any `git rev-parse` command against the user's repo.

### Why it matters (the hazard the spec closes)
Upward discovery (`git rev-parse --show-toplevel`) once resolved the workspace to a user's `$HOME` (home was not a git repo, so `repoRoot = top || cwd` fell back to `cwd`, and `cwd` was `$HOME`); `restore()` then reverted/deleted the **entire home tree**. This is the most severe failure mode in the subsystem. The fix is structural: the workspace root is **always `realpath(cwd)`** with **no upward traversal anywhere**, plus a forbidden-root refusal and a `restore()`-entry defense-in-depth re-check.

### 1.1 Added (new spec requirements, no new feature surface)
- **New SAFETY INVARIANT block** (`@spec/14` §2, after Detection): non-negotiable. The workspace root is `realpath(cwd)`; **no** code path in detection/init/capture/restore traverses upward. A subdirectory launch can **never** be promoted to a parent. `restore()` MUST re-check the invariant at entry and refuse (zero filesystem mutation) if the resolved root is forbidden.
- **Forbidden-root refusal at detection** (`@spec/14` §2 Detection): if `realpath(cwd)` is the user's home, a system root (`/`, `/home`, `/etc`, `/usr`, `/var`, …), or any path too shallow to be a real project → backend refused → `"none"` (fail-safe).
- **New testing clause** (`@spec/14` §10, "Safety (non-negotiable)"): `detectAndCreate($HOME, …)` and `detectAndCreate("/", …)` each return a `none`/NoOp backend; a subdirectory launch whose parent contains `.git` keeps `repoRoot` at the subdir; `restore()` against a forbidden root returns `refused` with zero filesystem mutation.

### 1.2 Modified (existing shipped behavior tightened)
- **Detection (`@spec/14` §2)**: `git rev-parse --show-toplevel` + `--absolute-git-dir` → **lexical `existsSync(join(cwd, ".git"))`**, no upward walk. Workspace root = `realpath(cwd)`.
- **GitBackend intro (`@spec/14` §3)**: "one shadow repo per source worktree — keyed by the resolved repo root" → **"one shadow repo per launch directory — keyed by `realpath(cwd)`"**. `GIT_WORK_TREE` points at the launch dir, **never an ancestor**. The repo-root-keyed sharing is intentionally dropped (it required upward traversal).
- **GitBackend Detection & init (`@spec/14` §3)**: `git -C <cwd> rev-parse --show-toplevel/--absolute-git-dir` → **`repoRoot = realpath(cwd)` unconditionally** + git mode iff `.git` exists lexically in `cwd`.
- **Guarantee #1 (`@spec/14` §3, the five git-safety guarantees)**: "No ref-moving or write command … only read-only `rev-parse`" → **"No command of any kind — read or write — is ever issued against the user's git."**
- **Unit-test assertion (`@spec/14` §10)**: git command construction asserts **NO command of any kind** (read or write) against the user's `.git`; `repoRoot === realpath(cwd)`; `rev-parse --show-toplevel`/`--absolute-git-dir` are **never issued**.
- **Build order Step 6c (`@spec/11`)**: `git.ts` description amended "NO write command ever targets the source `.git`, only `rev-parse`/`ls-files` reads" → **"NO command of any kind, read or write, targets the user's `.git`"** + "the workspace root is `realpath(cwd)` with no upward repo discovery — see the SAFETY INVARIANT".

### 1.3 Removed
- `git rev-parse --git-dir` from `detectAndCreate` (store.ts).
- `git rev-parse --show-toplevel` and `--absolute-git-dir` from `GitBackend.ensureInit` (git.ts).
- The `sourceGitDir` field + the repo-root-keyed shadow sharing.

No user-facing tool/config/param changes. No new agent tools. The feature's contract is unchanged; only its **detection mechanism** and a **defense-in-depth restore guard** change.

---

## 2. Verified prerequisites (codebase state)

The feature is **already shipped** (session 008). The vulnerable detection lives in two files; both were confirmed against the working tree:

- **`src/snapshot/store.ts` `detectAndCreate`** (lines 437–481): currently runs `await execFile("git", ["rev-parse", "--git-dir"], { cwd })` (line 446) as its git probe. Doc comments (lines 254, 263, 408, 444) describe this rev-parse as "the ONLY git command run against the user's repo here" — these must be rewritten. `NoOpStore` (line 357) already carries a `reason` string, so the new forbidden-root reason slots in cleanly.
- **`src/snapshot/git.ts` `GitBackend`** (lines 282–293): `ensureInit` issues `rev-parse --show-toplevel` + `--absolute-git-dir` against `this.cwd`; sets `this.repoRoot = top || this.cwd`; stores `this.sourceGitDir` (fields at 215–217); keys the shadow repo via `shadowKey(this.repoRoot)` (line 139–141, sha256(repoRoot)). Constructor does `this.cwd = resolve(cwd)` (line 235) — note `resolve` does **not** resolve symlinks; must become `realpath`. `restore()` entry (line 746) has no root guard today.
- **`src/snapshot/cas.ts`**: `CasBackend` uses `this.cwd = resolve(cwd)` (line 263); `restore()` entry (line 1004) has no root guard. Needs the same defense-in-depth guard for parity (the forbidden check at detection already protects it, but the spec's "last line of defense independent of detection" applies to restore broadly).
- **`src/snapshot/paths.ts`**: has `resolveSafeWorkspacePath`/`normalizeRelPath`/`isDangerousWorkspaceRel` + `DANGEROUS_DIRS` (lines 37, 54, 75, 91). Its module header (line 17, 45) already documents an intended `fs.realpathSync` complement running "in the snapshot backends" — but **no `isForbiddenRoot` predicate exists yet**. Adding it here is consistent with the module's documented intent.
- **`test/store.test.ts`**: `detectAndCreate` describe block (line 279+) stubs rev-parse exit codes to select git vs cas; tests at lines 355–360 assert the git branch is reached via rev-parse. These flip to `.git`-existence + forbidden-root assertions.
- **`test/git.test.ts`**: the recording exec fake (lines 75–76, 255–256, 305–306) returns canned stdout for `rev-parse --show-toplevel`/`--absolute-git-dir`; `expectedShadow` (line 127) keys by repoRoot; the "five guarantees" tests (line 219+, esp. 232 "the ONLY command without the shadow env is the read-only rev-parse") assert rev-parse IS issued. These must be reworked to assert rev-parse is **never** issued against the user repo.
- **`test/integration/revert-git.test.ts`**: creates a real git repo (`.git` present) and asserts `store.describe().backend === "git"` (lines 380, 531, 615). Detection via lexical `.git` keeps these passing. The test's OWN use of `git rev-parse --show-toplevel` (line 116) is test-harness logic, not production code — unaffected.

**No Pi-surface change.** `ctx.cwd`, `pi.on`, etc. are unchanged.

---

## 3. Requirements (what to build)

> Full engineering detail is in `@spec/14-working-tree-revert.md` §2 (Detection + SAFETY INVARIANT), §3 (GitBackend), §10 (Testing). The PRD states the requirement + names the spec anchor + the Mode-A doc that rides with it.

### R1 — Pure `isForbiddenRoot` helper (paths.ts)
Add a **pure** string predicate to `src/snapshot/paths.ts` (no fs) — the shared logic both `detectAndCreate` and the `restore()` guards call.

- **Input:** an absolute, canonicalized path string (the realpath of the workspace root).
- **Logic:** return `true` (forbidden) iff the root is: the user's home directory (`os.homedir()`); `/`; any depth-1 system dir (`dirname(root) === "/"`, covering `/home`, `/etc`, `/usr`, `/var`, … — the spec's named examples); or empty/`"."` (defensive). Covers every case in `@spec/14` §10's safety clause (`$HOME`, `/`). "Too shallow to be a real project" = depth ≤ 1.
- **Output:** `boolean`. Pure + unit-testable in isolation (no Pi, no fs).
- **Mode A docs (ride WITH the work):** JSDoc on `isForbiddenRoot` citing `@spec/14` §2 SAFETY INVARIANT + §10. State the exact predicate (home / `/` / depth-1 / empty).

### R2 — Rewrite `detectAndCreate` (store.ts) to the lexical + forbidden-root model
Replace the `git rev-parse --git-dir` probe with the spec's detection tree (`@spec/14` §2).

- **Canonicalize first:** `const root = realpathSafe(cwd)` — `fs.realpathSync(cwd)` wrapped so a failure (non-existent / unreadable path) yields a `NoOpStore` with a distinct reason (fail-safe), never a throw.
- **Forbidden-root gate:** `if (isForbiddenRoot(root)) return new NoOpStore("workspace root is forbidden (home/system root); revert refused");` — **before** any backend selection. This is the front-door guard the spec §10 test (`detectAndCreate($HOME,…)` → none; `detectAndCreate("/",…)` → none) asserts.
- **Git detection = lexical:** `if (existsSync(join(root, ".git"))) → GitBackend(root, …)`. **No `rev-parse`, no upward walk.** `.git` may be a file (worktree/submodule pointer) or a dir — `existsSync` covers both.
- **Else → CasBackend** (unchanged: resolve storageDir, `mkdir -p`, `W_OK` check → cas or NoOpStore).
- **Pass `root` (canonical), not raw `cwd`, to both backend constructors** so their stored workspace root is already canonicalized and matches the spec's "`realpath(cwd)`".
- **E28 fail-open preserved:** the outer try/catch still returns a `NoOpStore` on any error.
- **Mode A docs (ride WITH the work):** rewrite the `detectAndCreate` doc-comment decision tree (store.ts lines ~408, 437) — remove "read-only rev-parse"; state the lexical `.git` check + forbidden-root gate + `realpath(cwd)` root. Cite `@spec/14` §2 Detection + SAFETY INVARIANT.

### R3 — Rewrite `GitBackend` init + keying + guarantee #1 (git.ts)
Remove every `rev-parse` call against the user's repo and re-anchor the workspace root to `realpath(cwd)` (`@spec/14` §3).

- **Constructor:** `this.cwd = realpathSafe(cwd)` (the canonical root already produced by `detectAndCreate`; realpath here is defense-in-depth if constructed directly in tests). Drop reliance on `resolve`.
- **`ensureInit` rewrite:** delete the two `rev-parse --show-toplevel` / `--absolute-git-dir` calls. Set `this.repoRoot = this.cwd` (already canonical) unconditionally — **no upward discovery, no `top || cwd` fallback**. Remove the `sourceGitDir` field entirely (it existed only to record the rev-parse result; nothing writes to it). `this.shadowDir = join(this.storageDir, shadowKey(this.repoRoot))` where `shadowKey` now hashes `realpath(cwd)` (launch directory), not a resolved repo root — so the spec's "one shadow repo per launch directory" holds and subdirectory launches are **never** promoted to a parent.
- **`shadowKey` doc:** update to "keyed by `realpath(cwd)` (launch directory)" and drop the "subdirectory launches share one shadow repo" rationale (that sharing required upward traversal — the hazard the SAFETY INVARIANT closes).
- **Guarantee #1 doc:** rewrite to "No command of any kind — read or write — is ever issued against the user's git" (`@spec/14` §3). The class header comment (git.ts lines 37–51) must stop describing rev-parse against the source repo.
- **Capture/restore bodies:** unchanged in mechanism (still `shadowEnv()` with `GIT_DIR=shadowDir` + `GIT_WORK_TREE=repoRoot`); only `repoRoot` is now `realpath(cwd)` and `sourceGitDir` is gone. `has()` still uses `rev-parse --verify` **against the shadow repo** (that is fine — it targets `shadowEnv()`, never the user's git).
- **Mode A docs (ride WITH the work):** JSDoc on `ensureInit`, the class header, and guarantee #1 citing `@spec/14` §3 + the SAFETY INVARIANT.

### R4 — `restore()` entry safety re-check (git.ts + cas.ts) — defense in depth
Per the SAFETY INVARIANT's "`restore()` MUST additionally re-check this invariant at its entry", add a guard at the top of both `GitBackend.restore` and `CasBackend.restore`.

- **Logic:** immediately after acquiring the mutex + before `ensureInit()`/any fs write, compute the canonical root and `if (isForbiddenRoot(root))` return a `RestoreResult` with `refused: [root]` (and all other buckets empty) — **zero filesystem mutation**. This is the last line of defense independent of detection (a backend constructed with a forbidden root must never write/delete).
- **RestoreResult shape note:** the spec says "`{refused:true}`"; the concrete `RestoreResult` interface (`store.ts`) has `refused: string[]`. Interpret as: populate `refused` with the offending root string, leave `reverted/deleted/failed/skipped` empty. The `@spec/14` §10 test asserts "`refused` with zero filesystem mutation" — this satisfies it.
- **Mode A docs (ride WITH the work):** JSDoc on `restore()` citing `@spec/14` §2 SAFETY INVARIANT ("last line of defense independent of detection").

### R5 — Tests (unit + integration verification)
**Mode A:** unit tests ride with each source requirement above. The substantial rework is `test/git.test.ts` (its exec fake was built around rev-parse stubs).

- **R5a — `test/paths.test.ts`:** add `isForbiddenRoot` cases — `os.homedir()` → true; `"/"` → true; `"/home"`, `"/etc"`, `"/usr"`, `"/var"` (depth-1) → true; `"/home/user/projects/foo"` → false; `""`/`"."` → true.
- **R5b — `test/store.test.ts`:** rewrite the `detectAndCreate` describe block. Replace the rev-parse-based git/cas selection with: a temp dir WITH `.git` (lexical) → git; WITHOUT `.git` → cas; `detectAndCreate(os.homedir(), …)` → none (forbidden); `detectAndCreate("/", …)` → none; storage-unwritable → none (unchanged); a subdirectory whose **parent** has `.git` stays cas (the subdir has no lexical `.git` — proves no upward walk). Assert **no** `git rev-parse` call is recorded by the exec fake.
- **R5c — `test/git.test.ts`:** (1) remove the `rev-parse --show-toplevel`/`--absolute-git-dir` canned-stdout stubs from the exec fake — `ensureInit` no longer issues them; (2) update `expectedShadow` to key by `realpath(cwd)`; (3) the "five guarantees" test (line 232) now asserts **zero** commands run without the shadow env (was: "only rev-parse"); (4) add `restore()` forbidden-root test: construct a backend with `cwd = os.homedir()` (or inject a forbidden root), call `restore(ref, …)`, assert `result.refused` is non-empty and **no** `read-tree`/`checkout`/`unlink` was recorded (zero fs mutation).
- **R5d — integration verification:** `test/integration/revert-git.test.ts`, `revert-cas.test.ts`, `revert-explicit.test.ts`, `revert-edge.test.ts` already create real git/non-git dirs and assert `backend === "git"/"cas"` via `detectAndCreate`. With lexical `.git` detection these still pass. **Run them unchanged** to confirm no regression; add one assertion to `revert-edge.test.ts` (or a new case) covering `detectAndCreate(tmpNonGitSubdirUnderGitRepo, …)` → `cas` (proves the subdirectory is not promoted to the parent git repo — the core safety property).

### R6 — Sync changeset-level documentation (Mode B)
Cross-cutting docs that only make sense once R1–R5 land.

- **`README.md`:** in the working-tree-revert (v1.2) section, add a short **safety** paragraph stating the workspace root is `realpath(cwd)` with **no upward git discovery**, that home/system-root directories are refused, and that **no command of any kind** (read or write) is issued against the user's `.git`. Mirror the project's existing framing (the feature touches the working tree, not the session tree).
- **Stale-reference sweep:** grep `README.md` + `src/snapshot/*` for "rev-parse", "show-toplevel", "sourceGitDir", "read-only rev-parse", "repo-root-keyed", "share one shadow repo" and confirm none survive outside the SAFETY INVARIANT's explanatory "why" text. (The SAFETY INVARIANT *mentions* the old behavior by name to explain the hazard — that reference is intentional and stays.)

---

## 4. Build order (single phase, TDD-ordered)

One phase — this is a focused safety retrofit, not a feature. The order ensures each step is independently verifiable.

### P1 — Detection safety hardening (remove upward repo discovery; enforce realpath(cwd) root)

**M1 — Code: pure helper + detection rewrite + restore guards + unit tests**
- T1.S1 `isForbiddenRoot` in `paths.ts` (R1) + `test/paths.test.ts` cases (R5a). *[pure, unblocks the rest]*
- T2.S1 `detectAndCreate` rewrite in `store.ts` (R2) + `test/store.test.ts` rework (R5b).
- T3.S1 `GitBackend` init/keying/guarantee#1 rewrite in `git.ts` (R3) + `test/git.test.ts` rework (R5c, incl. restore forbidden-root test R4).
- T4.S1 `restore()` entry guard in `cas.ts` (R4). *[git.ts guard lands with T3.S1]*
- **Verify:** `npm test` green; the exec fake records **zero** `rev-parse` calls against the user repo across all git/store tests; `detectAndCreate($HOME,…)`/`detectAndCreate("/",…)` → none; subdirectory-under-git-parent → cas.

**M2 — Integration verification + changeset docs (Mode B)**
- T1.S1 Run `test/integration/revert-*.test.ts` unchanged → green; add the subdirectory-not-promoted assertion (R5d).
- T2.S1 `README.md` safety paragraph + stale-reference sweep (R6).
- **Verify:** full suite green; no `rev-parse`/`sourceGitDir`/`repo-root-keyed` survives outside the SAFETY INVARIANT's explanatory text.

---

## 5. Definition of done

1. **No `git rev-parse` against the user's repo anywhere in `src/`** (grep `rev-parse` in `src/snapshot/` returns only the shadow-repo `rev-parse --verify` in `has()`, which targets `shadowEnv()`).
2. Workspace root is `realpath(cwd)` in both backends; `sourceGitDir` field is gone; shadow repo keyed by `realpath(cwd)`.
3. `detectAndCreate($HOME, …)` and `detectAndCreate("/", …)` return `NoOpStore` (backend `none`).
4. `restore()` against a forbidden root returns `refused` populated + zero filesystem mutation (both backends).
5. A subdirectory launch whose parent contains `.git` resolves to `cas` (never promoted to the parent) — the core safety property.
6. All existing unit + integration tests green (no behavior regression for real git/cas projects).
7. `README.md` documents the safety guarantee; no stale v1.2-detection language survives.

---

## 6. Cross-references
- Spec: `@spec/14-working-tree-revert.md` §2 (Detection + SAFETY INVARIANT), §3 (GitBackend init + guarantee #1), §10 (Testing safety clause); `@spec/11-build-order.md` Step 6c (one-line amendment).
- Prior session: `plan/008_c36fd26768ae/delta_prd.md` (the v1.2 feature this hardens); `plan/008_c36fd26768ae/architecture/external_deps.md` §1 (git command inventory — now amended).
- Implemented files: `src/snapshot/{store,git,cas,paths}.ts` + `test/{store,git,paths}.test.ts` + `test/integration/revert-*.test.ts`.