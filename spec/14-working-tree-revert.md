# 14 — Working-tree revert (opt-in file restoration on rewind)

> **v1.2 amendment.** Audience: implementer. This document specifies the opt-in capability for `mulligan_rewind` to restore the working-tree files it mutated back to their pre-span state. It is **orthogonal** to the soft-delete view model (the session tree is never mutated) and **amends E5** (not D1): ALL captured working-tree file state — from `write`/`edit` **or** bash file commands — becomes reversible on opt-in; only non-filesystem effects (git refs/commits, excluded dependency dirs, the index, network/DB/processes) and hard retry remain out of scope. Full design here; integration points in `@04-data-model.md` (marker fields), `@05-tools.md` (tool params/behavior), `@08-edge-cases.md` (E27–E32), `@09-configuration.md` (config).

---

## 0. Motivation & scope

**Motivation (issue #1, verified live):** after a rewind, weaker models suffer "amnesia" — even with a faithful note, they re-read entire files to reorient, *adding* more context than the rewind just shed. The rewind's purpose (a cheap re-attempt) is defeated by the re-read bloat. Restoring the files to their pre-span state removes the need to re-read: the disk matches the model's mental model of "what was there before I started this turn."

**What it is:** an opt-in, best-effort restoration of working-tree files to the state captured just before the rewound span. Snapshots are **whole-working-set**, captured at boundaries — tool-agnostic (`sed`/`awk`/`python`/`npm` are all reverted equally), mirroring how Claude Code and Cursor ship comprehensive undo. The git backend uses an **external shadow repository** (the OpenCode / `pi-undo-redo` technique) so that *nothing* — not even a transient object — is written into the user's `.git`.

**What it is NOT:**
- **Not retry/replay.** No tool call is re-executed. It is a state-restore (D1 stands: hard retry is never supported).
- **Reverts working-tree file state from ANY tool — including bash.** The snapshot is of the working tree and restore rewrites it wholesale, so ALL captured working-tree file changes are undone regardless of source: `write`/`edit` **and** bash file commands (`sed -i`, `awk -i inplace`, `cp`, `mv`, `rm`, heredocs, `python -c` writing files). That tool-agnostic comprehensiveness is the *reason* whole-tree snapshots replaced per-tool enumeration. **Gitignored files are included** (`.env`, secrets, dotfiles) — the snapshot uses its own exclude list (`excludeGlobs`), not `.gitignore`, so a file hidden from VCS is still restored on rewind.
- **Does NOT revert non-filesystem state.** Only working-tree file content is restored. Effects that are not captured file state persist: git refs/history (`git commit`/`push`/`tag` — refs are never touched), excluded dependency/generated dirs (`node_modules`/`.venv`/`dist` — so `npm`/`pip` installs persist), the git index (`git add`), and non-filesystem effects (network, DB, processes).
- **Not session-tree mutation.** The conversation tree stays append-only; this feature touches only the working tree (files on disk). Principle 2 ("never mutate the session tree") is preserved.
- **Not a git operation that touches history.** Pure working-tree restoration; the user's git refs/reflog/HEAD/index/objects are never moved or written.

---

## 1. Opt-in model & guardrails

Three layers of consent, all required:

1. **Config master switch `config.revert.enabled` (default `false`).** When off, the snapshot machinery is entirely inert — no capture, no memory, no overhead. The rewind tool still accepts the flags but ignores them with a one-line notice.
2. **Per-call explicit flags** on `mulligan_rewind`: `revert_file_changes` (restore modified files) and `delete_created_files` (delete files the span newly created). The agent MUST set at least one; they are never inferred.
3. **Deletion kill-switch `config.revert.allowDeleteCreatedFiles` (default `false`).** Even when the agent sets `delete_created_files`, deletion runs only if this config is also `true`. Deletion is the one irreversible action, so it sits behind BOTH the per-call flag AND a global config gate.

**Granularity scope (v1.2):**

| Granularity | File revert supported? | Notes |
|---|---|---|
| `last_turn` | ✅ | Restore to the turn-start snapshot. The natural, common case. |
| `checkpoint` | ✅ | Restore to the checkpoint-creation snapshot. |
| `last_tool_call_group` | ❌ (flags ignored + noticed) | Whole-tree snapshots are boundary-granular; a group-granularity file revert would over-revert to turn-start (undoing earlier good edits in the same turn) — a semantic mismatch the tool refuses rather than silently performing. The context rewind still happens normally. (True surgical group file-revert via intra-turn group-boundary capture is a documented future enhancement — §11.) |

When the agent passes revert flags at `last_tool_call_group` granularity, the tool performs the normal context rewind, ignores the file revert, and returns: `"Mulligan: rewound last_tool_call_group (context only). File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn."`

---

## 2. Architecture — the `SnapshotStore`

A new component, backend-pluggable, selected by detection. The rewind tool orchestrates `dirtyCheck` + `restore` and never knows which backend ran.

```ts
interface SnapshotStore {
  describe(): { backend: "git" | "cas" | "none"; reason?: string };
  capture(label: string): string | null;        // snapshot the working set now → opaque ref (null on failure)
  dirtyCheck(afterRef: string, paths: string[]): string[];        // paths whose CURRENT content ≠ after-snapshot (drift)
  restore(beforeRef: string, opts: RestoreOpts): RestoreResult;   // write working-tree files FROM the before-snapshot
  has(ref: string): boolean;
  retire(ref: string): void;                     // drop a protected ref so its objects can be reclaimed
}
interface RestoreOpts   { revertFileChanges: boolean; deleteCreatedFiles: boolean; }
interface RestoreResult { reverted: string[]; deleted: string[]; failed: string[]; skipped: string[]; refused: string[]; }
```

A **checkpoint** (held in `SessionRuntime`, persisted to the rewind marker / a `mulligan:revert-checkpoint` control entry for cross-reload) pairs a before- and after-ref:

```ts
interface RevertCheckpoint { label: string; backend: "git" | "cas"; beforeRef: string; afterRef?: string; turnIndex: number; ts: number; }
```

**Detection (cached per session in `SessionRuntime`):** git vs CAS is selected by a **lexical** `existsSync(join(cwd, ".git"))` check — **NO upward git discovery is ever performed** (`rev-parse --show-toplevel` / `--git-dir` / `--absolute-git-dir` are forbidden in detection). The workspace root is **always `realpath(cwd)` — the directory the session was launched in**; it is never resolved by walking up the tree. If `realpath(cwd)` is the user's home directory, a system root (`/`, `/home`, `/etc`, `/usr`, `/var`, …), or any path too shallow to be a real project, the backend is **refused** → `"none"` (revert unavailable; fail-safe). Otherwise: a `.git` entry exists lexically in `cwd` → `GitBackend`; else → `CasBackend`; if the CAS cannot initialize (unwritable storage) → `"none"` (revert unavailable; fail-open).

> **SAFETY INVARIANT — non-negotiable.** The workspace root is `realpath(cwd)`, full stop. There is **no** code path — in detection, init, capture, or restore — that traverses upward to find an enclosing repository. A subdirectory launch can **never** be silently promoted to a parent directory. This invariant exists because upward traversal (`rev-parse --show-toplevel`) once resolved the workspace to a user's `$HOME` (home was not a git repo, so `repoRoot = top || cwd` fell back to `cwd`, and `cwd` was `$HOME`); `restore()` then reverted/deleted the entire home tree. Re-introducing upward repo discovery anywhere in the snapshot subsystem is a regression of the highest severity. `restore()` MUST additionally re-check this invariant at its entry and refuse (returning `{refused:true}` with zero filesystem mutation) if the resolved root is forbidden — a last line of defense independent of detection.

**Placement** (`@03-architecture.md` §7 gains a `src/snapshot/` subtree):
```
src/snapshot/
  store.ts     // the SnapshotStore interface + detectAndCreate() factory + the AsyncMutex
  git.ts       // GitBackend (shadow repository)
  cas.ts       // CasBackend (content-addressed store) + the explicit-paths mode
  paths.ts     // PURE: resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel
```
The factory `index.ts` creates the store once and threads it into the rewind tool (closure, mirroring `makeRewindTool(pi)`) and the capture hooks.

---

## 3. `GitBackend` (external shadow repository — preferred in a repo)

The git backend never touches the user's `.git`. It maintains a **separate shadow git repository** whose `GIT_DIR` is external (under `config.revert.storageDir`, **one shadow repo per launch directory** — keyed by `realpath(cwd)`) and whose `GIT_WORK_TREE` points at the launch directory (`realpath(cwd)`) — **never an ancestor of it**. The repo-root-keyed sharing across subdirectory launches is intentionally NOT used: it required upward traversal to resolve the root, which is the hazard closed by the SAFETY INVARIANT above. It owns its own object database and refs (`.gitignore` is not consulted — see Capture).

**Detection & init:**
- `repoRoot = realpath(cwd)` — unconditionally. No `rev-parse` is run against the user's repo to "find" a root; the workspace is exactly where the session was launched. (Upward discovery is forbidden — see the SAFETY INVARIANT.)
- git mode iff a `.git` entry exists **lexically in `cwd`** (`existsSync(join(cwd, ".git"))`); this check does not walk up the tree.
- Lazily `git init` the shadow repo with env `{ GIT_DIR: <storageDir>/<key>, GIT_WORK_TREE: <repoRoot> }` on first use.

**Capture (returns an opaque ref):**
- Stage the current work tree into the **shadow** index, **including gitignored files** (`.env`, secrets, dotfiles): `git --git-dir=<shadow> --work-tree=<repoRoot> add --all -f -- . ':!node_modules' ':!.venv' …`. The `-f` forces gitignored files in; the pathspec negations (built from `config.revert.excludeGlobs`) omit only the heavy/generated dirs. **`.gitignore` is deliberately NOT consulted** — it means "don't commit to VCS", not "don't snapshot", and a gitignored `.env` is exactly the file a revert must restore. (Reads the user's files into the shadow index/objects; does NOT touch the user's git.)
- `write-tree` → tree SHA; then `commit-tree <tree> -m …` → commit SHA; then **`update-ref refs/mulligan/snapshots/<sha> <commit>`** → a *protected ref* in the shadow repo (not dangling, so immune to the shadow repo's own `gc` until explicitly retired).
- **Captured set = everything except `excludeGlobs`** (default `.git`, `node_modules`, `dist`, `build`, `.next`, `.venv`, `target`): tracked + untracked + gitignored-but-not-excluded files alike. This matches the CAS backend, so both backends capture the same file set.

**Dirty check (`dirtyCheck(afterRef, paths)`):** returns the subset of `paths` whose **current** work-tree content differs from the `afterRef` snapshot — i.e. files changed *after* the agent's turn (a human/other process edit). Implemented as a `diff` between the shadow index refreshed from the work tree and the `afterRef` tree, scoped to `paths`.

**Restore (`restore(beforeRef, opts)` — working-tree only, never index/refs):**
- `git --git-dir=<shadow> read-tree <beforeRef>` (shadow index only), then `git checkout <beforeRef> -- <paths>` writes those files into the work tree.
- If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree files present now but absent from the `beforeRef` tree (span creations).
- Per-path failures → `failed[]`; the op never throws (E13).

**Why this is comprehensive AND strictly git-safe — the five guarantees:**
1. **No command of any kind — read or write — is ever issued against the *user's* git.** The workspace root is `realpath(cwd)` and needs no `rev-parse` to resolve it, so the backend never inspects or touches the user's `.git` (previously a read-only `rev-parse --show-toplevel`/`--absolute-git-dir` ran against it; that is removed — see the SAFETY INVARIANT). All writes (`add`, `write-tree`, `commit-tree`, `update-ref`, `read-tree`, `checkout`, `gc`) target the **shadow** repo. Forbidden everywhere: `commit`, `reset`, `checkout <branch>`, `merge`, `stash`, `rebase` against the source.
2. **The user's `.git` is never written — not even a dangling object.** Every blob/tree/commit/ref lives in the external shadow repo. This is strictly cleaner than a `git stash create`-in-source design (which leaves reclaimable dangling objects in the user's `.git/objects`): there is nothing to reclaim from the user's repo because nothing was ever put there. `git status`, `git log`, `git stash list`, and the reflog of the source repo are byte-for-byte unaffected.
3. **Restore writes only working-tree files.** The source index and all source refs are never touched.
4. **`delete_created_files` only deletes files the span created** (present now, absent from `beforeRef`), behind the per-call flag AND `config.revert.allowDeleteCreatedFiles`.
5. **Pre-flight refuse-on-dirty (§6):** before restore, `dirtyCheck` runs; if any affected path drifted since the after-snapshot, the **whole file-revert is refused** (context rewind still proceeds) rather than clobbering the external edit. "Don't steamroll concurrent edits" is a refuse, not a silent skip.

**Exclude policy = `excludeGlobs`, not `.gitignore`** (deliberate): a file gitignored for VCS-secrecy (`.env`) is still wanted in a snapshot, so the snapshot uses its own exclude list. Both backends capture the same file set. **Privacy note:** this copies secrets/dotfiles into local snapshot storage (the shadow repo under `storageDir`, outside `cwd`, wiped on `session_shutdown`) — local and ephemeral, never sent anywhere; acceptable because restoring those files is the feature's job. **Bounded storage:** turn snapshots live under `refs/mulligan/snapshots/turn/*`; checkpoint snapshots under `…/checkpoint/<name>`. Reclamation is a **prompt-boundary GC pass** (§5): at each new prompt all `turn/*` refs are deleted and the shadow repo is gc'd — safe because no non-checkpoint rewind can cross a prompt. Checkpoint refs are exempt until revoked/consumed. git's reachability-based gc preserves any blob still pinned by a surviving checkpoint ref, so the two namespaces share blobs freely with no manual tracking.

---

## 4. `CasBackend` (universal, non-git) + non-git modes

When there is no git repo, snapshot/restore runs on a minimal content-addressed store — a tiny slice of git's object model, not a VCS (~300 LOC: hash + blob store + manifest). Two non-git capture strategies, selected by `config.revert.nonGitMode`:

### 4.1 `"cas"` (default — comprehensive, whole-tree)
- Walk the working set (cwd minus `config.revert.excludeGlobs`); for each file, stat it; if `(mtime, size)` matches the previous manifest, **reuse its hash and skip re-read/re-hash** (git's index-refresh trick). Only changed files are re-read/hashed.
- Store content keyed by hash (`<storeDir>/<hash>`) — identical content stored once globally (dedupe). Record `{path → hash, existed}`. `capture()` returns the manifest ref.
- **Efficiency:** steady-state O(changed-files) I/O, O(working-set) stats per snapshot. First snapshot pays O(working-set) once. Fast non-crypto hash (blake3/xxhash) + byte-length guard as the collision backstop.
- **No untracked-file gotcha** (whole working set as one set). Both backends now capture the same comprehensive set (tracked + untracked + gitignored-minus-excludes); CAS is the universal fallback when there is no git. Storage strictly outside `cwd`/`.git` (e.g. `<sessionDir>/mulligan/cas/<sessionId>/`), cleaned on `session_shutdown`.

### 4.2 `"explicit-paths"` (conservative alternative — the `pi-undo-redo` model)
For users who want bounded scope / lower per-turn cost over comprehensiveness. Does **not** scan the workspace. Snapshots only the explicit `write`/`edit` tool paths captured at `tool_call` time (the tool-call hook reads `event.input.path` and snapshots that path's current state before the tool runs). **Bash file commands are NOT captured and NOT promised restorable** (the tool warns once per turn when bash runs in this mode). `/undo`-equivalent restore touches only the captured explicit paths.
- This is a deliberate, safety-motivated tradeoff — `pi-undo-redo` ships exactly this for non-git dirs and openly says "use a git repository when full capture is required." Mulligan offers it as an opt-in for workspaces where whole-tree scanning is too costly or too broad; `"cas"` remains the default for comprehensiveness.

### 4.3 Cross-cutting implementation requirements (both non-git modes AND path handling)
- **Path safety (`paths.ts`, pure):** explicit paths are normalized relative to the workspace root; relative paths resolve against `ctx.cwd`; absolute paths are accepted only inside the workspace root. **Reject** paths containing NUL, escaping via `..`, directory paths (refuse to snapshot a directory), and dangerous workspace dirs (`.git`, `.pi`, `node_modules`). Windows-style paths normalize to `/`-separated relative paths.
- **Fail-closed large files:** in `explicit-paths` mode, a file exceeding `config.revert.maxFileBytes` is **skipped + warned** (never silently claimed restorable). In `cas` mode the per-file cap skips+logs; the comprehensive backends otherwise handle large files within `maxTotalBytes`.
- **AsyncMutex:** a single mutex per store serializes ALL store operations (`capture`/`dirtyCheck`/`restore`/`retire`/`gc`). Pi preflights sibling `tool_call`s sequentially then runs them concurrently; the mutex makes capture/restore race-free regardless. The prompt-boundary GC pass (§5) ALSO acquires the mutex, so a `git gc` / CAS mark-sweep can never overlap an in-flight `capture`/`restore`/`retire` straddling a turn boundary.
- **Backend parity of behavior:** both non-git modes and the git mode expose the same `SnapshotStore` interface; the rewind tool is mode-agnostic. `dirtyCheck` in non-git compares current content to the after-manifest (hash equality).

---

## 5. Capture lifecycle & retention

**Capture points (only when `config.revert.enabled`):**
- **`turn_start`** — `capture("turn")` → the turn's **before** ref.
- **`agent_end`** — `capture("turn-after")` → the turn's **after** ref. The after-ref is what makes `dirtyCheck` effective (it detects post-turn drift) and gives accurate "files changed this turn" sets.
- **`/mulligan_checkpoint`** — `capture("ckpt:<name>")` → a before ref persisted in a `mulligan:revert-checkpoint` control entry alongside the label, so it survives reload.

A `RevertCheckpoint { beforeRef, afterRef?, … }` is held in `SessionRuntime` for the current turn and (for checkpoints) persisted.

**Retention (bounded):**
- **Caps** (`maxFileBytes`/`maxTotalBytes`/`maxSnapshotsPerTurn`): when hit, capture stops accepting new data and the snapshot is marked partial; restore degrades to best-effort for uncaptured files (`skipped[]`). Never blocks the rewind; never OOMs.
- **Prompt-boundary GC (the primary reclamation strategy):** at each new prompt (`turn_start`), BEFORE capturing the new turn's snapshot, the store deletes every `refs/mulligan/snapshots/turn/*` ref (the just-ended turn's before/after and all prior turns') and gc's the shadow repo. Safe because **no rewind can cross a user prompt** except a `checkpoint` rewind — `last_turn`/`last_tool_call_group` only ever target the current turn, so once a new prompt arrives every prior turn's snapshots are dead. (`session_start` runs the same pass to clear stale `turn/*` refs from a reloaded instance.)
- **Checkpoints are exempt (separate namespace):** checkpoint snapshots live under `refs/mulligan/snapshots/checkpoint/<name>` and are NOT touched by prompt-boundary GC. Held until the checkpoint is revoked (`/mulligan_checkpoint_revoke`) or consumed (a rewind targets it), then its ref is deleted and reclaimed at the next GC — held "no matter what", as required.
- **Why shared blobs don't complicate this:** git's gc reclaims only objects unreachable from ANY surviving ref. A blob shared between a deleted turn snapshot and a surviving checkpoint snapshot is still reachable from the checkpoint ref → automatically preserved. No manual blob-sharing tracking; git's reachability model does the pinning.
- **CAS backend reclamation (the non-git analog):** the `CasBackend` has no native reachability GC, so it runs the SAME prompt-boundary pass as an explicit **mark-sweep**. At each new prompt it deletes every `turn/*` manifest, then deletes any blob referenced by NO surviving manifest (the just-captured turn manifest + active checkpoint manifests). Checkpoint manifests live in a separate namespace and are exempt — mirroring the git backend exactly. Because blobs are content-addressed and globally deduped, the surviving set is precisely the active snapshots' union, so the sweep is cheap set-membership over a handful of manifest hash-sets; no manual ref-counting. (`session_start` runs the same pass; the CAS dir is wiped on `session_shutdown`.)
- **GC cost & cadence:** deleting refs (or CAS manifests) is instant; `git gc` is the only potentially-slow step. The cadence is **every prompt**, as the final step of the prompt-boundary pass (one pass, no separate prune interval): `git gc --auto --prune=now` — self-throttling (a cheap no-op under the loose-object threshold; when it does run, it physically reclaims immediately). The CAS mark-sweep runs in the same pass. At any moment the shadow repo / CAS dir holds only blobs reachable from currently-active snapshots (current turn + active checkpoints), **deduped** (unchanged files share blobs — no whole-tree copies per turn). Both stores are **deleted entirely** on `session_shutdown` (no cross-session buildup). **Fail-open:** a `git gc` or CAS mark-sweep failure is logged and NEVER blocks the turn — refs/manifests still resolve so restore correctness is intact; only disk usage is affected. Worst case the store accumulates unreclaimed objects until a later GC succeeds or `session_shutdown` wipes it.
- **Storage cost is minimal and opt-in:** `config.revert.enabled` default `false` → zero capture, zero storage. When on, per-turn growth is O(changed-files) in NEW blobs (dedup), bounded by `maxFileBytes`/`maxTotalBytes`/`maxSnapshotsPerTurn` — capture stops beyond them (best-effort degrade). The `explicit-paths` non-git mode is the lower-cost option for cost-sensitive workspaces.

**Cross-reload (now supported, was a limitation):** because snapshot refs live on disk (shadow repo protected refs / CAS manifests) and checkpoint refs are persisted (`mulligan:revert-checkpoint` control entries + the rewind marker's `revert` block), reload/`/resume` can re-read the refs and the store still honors them. File-revert survives reload for checkpoints and for already-issued rewinds.

**Fail-open floor:** git repo → `GitBackend`; non-git, writable → `CasBackend` (`"cas"` or `"explicit-paths"`); neither runnable → `"none"` → revert skipped, rewind succeeds with the note (today's behavior). Always a defined behavior; never a crash (E13).

---

## 6. Restore semantics — refuse-on-dirty, then restore

For a rewind at a supported granularity, with revert flags set and `config.revert.enabled`:

1. Resolve the `RevertCheckpoint` for the boundary (`turn_start`+`agent_end` for `last_turn`; the named checkpoint's capture for `checkpoint`). If none (disabled at capture, caps exceeded) → revert skipped with an honest count (0 reverted); the rewind still proceeds.
2. **Determine the affected set** = paths that differ between `beforeRef` and the current tree (the files restore would touch).
3. **Dirty guard (pre-flight, REFUSE not skip):** if `afterRef` exists, run `dirtyCheck(afterRef, affected)`. If any path returned → the file was changed by something other than the agent's turn (a human/other process edit since `agent_end`) → **refuse the entire file-revert**: do NOT restore, do NOT delete. Return `refused[]` naming the dirty paths; the **context rewind still proceeds**. (Rationale: clobbering an unsaved human edit is the one unrecoverable failure; refusing and asking the agent to re-request is safe.)
   - **Mid-turn limitation (documented):** if the rewind fires *before* `agent_end` (no `afterRef` yet), the tool captures a just-in-time after-ref (= current tree), so `dirtyCheck` is trivially satisfied and the guard cannot detect a concurrent edit made during the active turn. Concurrent human edits to the same files during an active agent turn are rare; the post-turn `agent_end` guard covers the common (checkpoint / cross-turn) case. See E30.
4. **Restore:** for each affected path, write its `beforeRef` content (best-effort; failure → `failed[]`, not fatal). If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree files present now but absent from `beforeRef` (span creations).
5. Return `{reverted, deleted, failed, skipped, refused}`; fold into success text + marker.
6. **Never** run a write command against the user's git; **never** touch the source index/refs; **never** delete a file not provably created during the span.

**Index/staged interaction (documented, not "fixed"):** if the agent ran `git add`, the index retains the staged version even after restore writes the working tree. `git status` may then show staged changes diverging from the working tree. This is correct: revert restores working-tree FILE state (from any tool) but does not touch the git index or refs — so a bash `sed -i` on a source file IS reverted, while a `git add`/`commit` (index/refs) is not. The user unstages with `git restore --staged`. Not a bug; see E31.

---

## 7. `mulligan_rewind` integration

**New optional params** (`@05-tools.md` §1 schema): `revert_file_changes`, `delete_created_files` (full text there).

**New behavior step 6b (after marker persist, before the mutation warning):**
- Neither flag set → unchanged (v1.1 path).
- Flags set but `!config.revert.enabled` → ignore, append `"(file revert requested but disabled in config)"`.
- Flags set at `last_tool_call_group` → ignore the revert, return the §1 mismatch notice.
- Else → resolve checkpoint; run the §6 flow (dirty guard → restore); fold `{reverted, deleted, failed, skipped, refused}` into the success text and the marker. If the dirty guard refused, append `"(file revert refused: <N> path(s) changed since the turn ended — not overwritten; re-request if intended)"` and still complete the context rewind.

**Success text additions** (when revert ran): `"Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused (see log)."`

**Mutation-warning interaction (E5):** when `revert_file_changes` reverted files (the actual `revertedFiles` — which may include files the ledger could not parse, e.g. a bash `sed` edit), the standard E5 mutation warning (`"⚠ ... effects PERSIST on disk"`) is **reworded to name ONLY effects that are not working-tree file state** — commits made, dependency installs, network/DB/process effects, staged index changes, and any files in `failed`/`refused`. The agent must not be told that reverted files persist (a reverted `sed` edit persists no more than a reverted `edit`).

**Marker persistence (`@04-data-model.md` §3):** the rewind marker gains an optional `revert` block `{ revertedFiles, deletedFiles, failedFiles, refusedFiles, skipped, backend }` for auditability (recoverable from `/tree`).

---

## 8. Configuration (`@09-configuration.md` §2)

```jsonc
"revert": {
  "enabled": false,                   // master opt-in — DEFAULT OFF
  "allowDeleteCreatedFiles": false,   // global kill-switch on the destructive delete path
  "nonGitMode": "cas",                // "cas" (default, comprehensive whole-tree) | "explicit-paths" (conservative, write/edit only; bash not captured)
  "storageDir": null,                 // shadow-repo / CAS root; null → default (<sessionDir>/mulligan/). NEVER under cwd.
  "maxFileBytes": 262144,             // per-file cap; 256 KB. ALL backends: skip+warn (fail-closed) — a huge gitignored data file is not silently captured.
  "maxTotalBytes": 33554432,          // per-session cap; 32 MB. capture stops beyond it (partial snapshot).
  "maxSnapshotsPerTurn": 64,          // count cap
  "excludeGlobs": [".git","node_modules","dist","build",".next",".venv","target"]  // snapshot excludes for BOTH backends (.gitignore NOT used — .env etc. captured)
}
```
Validation follows the existing `@09` §4 rules (numbers finite/`> 0`; `excludeGlobs` an array of strings; `nonGitMode` one of the two literals; `storageDir` a string that, if set, must NOT resolve inside `cwd`; never throw, fall back to defaults).

---

## 9. Edge cases → `@08-edge-cases.md` E27–E32

- **E27** revert fails best-effort (locked file, permission) → `failed[]`, rewind proceeds.
- **E28** no git AND CAS unwritable → backend `"none"` → revert skipped, rewind succeeds.
- **E29** caps exceeded → partial snapshot → restore degrades, `skipped[]`.
- **E30** concurrent/external modification → dirty guard REFUSES the file-revert (`refused[]`); post-turn drift (via `agent_end` after-ref) is caught; mid-turn concurrent edits are a documented limitation.
- **E31** staged/index divergence after restore → documented (§6), not "fixed".
- **E32** ~~post-reload snapshot loss~~ → **resolved in v1.2**: refs are on-disk + persisted, so file-revert survives reload for checkpoints and issued rewinds.

---

## 10. Testing → `@10-testing.md`

Add integration scenarios: **F-revert-git** (in a temp git repo, mutate via `write`+`edit`+bash `sed`, rewind `last_turn` with `revert_file_changes`, assert files match pre-span AND the user's `.git` is byte-identical — no new objects, no reflog entry, no stash — AND the shadow repo holds a protected ref that `retire()` clears); **F-revert-cas** (same, non-git dir, `nonGitMode:"cas"`, assert files match); **F-revert-explicit** (`nonGitMode:"explicit-paths"`: write/edit reverted, bash `sed` NOT reverted + warned); **F-revert-failopen** (lock a file → rewind still succeeds, file in `failed`); **F-revert-delete** (`allowDeleteCreatedFiles` gating); **F-revert-dirtyguard** (after `agent_end`, edit a file externally, then rewind with revert → file-revert REFUSED with the path in `refused`, context rewind still happens, file NOT overwritten); **F-revert-granularity** (group-granularity flags ignored + noticed); **F-revert-reload** (rewind with revert, `/resume`, assert refs still honored). Unit tests: CAS (hash, manifest, mtime-short-circuit); `paths.ts` (reject `..`/NUL/`.git`/`node_modules`/directory/abs-outside-workspace); git command construction (assert NO command of any kind — read or write — is ever issued against the user's `.git`; that `repoRoot === realpath(cwd)`; and that `rev-parse --show-toplevel`/`--absolute-git-dir` are never issued). **Safety (non-negotiable):** `detectAndCreate($HOME, …)` and `detectAndCreate("/", …)` each return a `none`/NoOp backend (refused); a subdirectory launch whose *parent* contains a `.git` keeps `repoRoot` at the subdir (never promoted to the parent); and `restore()` against a forbidden root returns `refused` with zero filesystem mutation.

---

## 11. Future enhancements (deferred from v1.2)

- **Surgical `last_tool_call_group` file-revert** via intra-turn group-boundary capture (same CAS/shadow machinery; mtime short-circuit keeps it O(changed-files) in I/O). Enables the issue's headline surgical case without over-reverting.
- **Shadow-repo cleanup command** (`/mulligan_revert_cleanup`) — now largely redundant given prompt-boundary GC (§5) reclaims turn snapshots every prompt and checkpoint snapshots on revoke/consume; would only force a prune or reclaim orphaned checkpoint blobs from a very long session. Low priority.
- **On-disk CAS spill** for sessions whose working sets exceed comfortable memory bounds.

---

## 12. Cross-references

- Rewind tool params/behavior → `@05-tools.md` §1
- Marker revert fields → `@04-data-model.md` §3
- Config block → `@09-configuration.md` §2
- Edge cases → `@08-edge-cases.md` E27–E32
- Tests → `@10-testing.md`
- Module layout & build step → `@03-architecture.md` §7, `@11-build-order.md`
- Consent principle (this feature adds a new opt-in surface on the same "explicit consent" model) → `@13-human-facing-surface.md` §1
- **Reference implementation of the shadow-repository + explicit-paths techniques:** `Yueby/pi-undo-redo` (the external-shadow-git + per-path non-git design studied for this revision).