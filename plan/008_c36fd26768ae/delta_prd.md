# Delta PRD — v1.2 Working-tree revert (opt-in file restoration on rewind)

**Base:** v1.1 codebase (previous session completed P1–P4: guardrail, human-facing surface, banner, shrink-preservation invariant).
**Delta source:** single spec commit `a4767c6f` ("Document v1.2 working-tree snapshot and revert specification") — the ONLY change between the session-7 PRD snapshot and the current PRD.
**Spec reference:** `@spec/14-working-tree-revert.md` (NEW, 242 lines) + v1.2 amendments across `@01`–`@13`. The spec is **already fully written** — this is an **implementation-only** delta. The PRD does not re-spec; it scopes and orders the build against the existing v1.1 codebase.

---

## 1. What changed (diff analysis)

One new feature: **working-tree revert** — an opt-in capability for `mulligan_rewind` to restore the working-tree files a rewound span mutated back to their pre-span state, so the resumed agent need not re-read them (issue #1: weaker models suffer "amnesia" and re-read files, *adding* more context than the rewind shed).

**Net surface delta (D11):** one new component (`SnapshotStore`), two optional params on an existing tool, **no new agent tools**. The session tree is still never mutated; working-tree revert is orthogonal to the soft-delete view model.

### 1.1 Added (new feature)
- **`spec/14-working-tree-revert.md`** — full engineering spec (motivation, opt-in model, `SnapshotStore` interface, `GitBackend` external shadow repo, `CasBackend` + explicit-paths mode, capture lifecycle + prompt-boundary GC, refuse-on-dirty restore semantics, config, edge cases E27–E32, tests).
- **New `src/snapshot/` subsystem** (4 files): `store.ts` (interface + `detectAndCreate` factory + `AsyncMutex`), `git.ts` (shadow repo), `cas.ts` (content-addressed store + explicit-paths mode), `paths.ts` (pure path safety).
- **New config block** `config.revert.*` (8 fields; master switch `enabled` default `false`).
- **New marker field** `RewindMarker.revert?` (audit block: `revertedFiles/deletedFiles/failedFiles/refusedFiles/skipped/backend`).
- **New runtime field** `SessionRuntime.snapshots?: Map<string, RevertCheckpoint>` + the `RevertCheckpoint` type (`@spec/04` §8, `@spec/14` §2).
- **New tool params** on `mulligan_rewind`: `revert_file_changes`, `delete_created_files` (both `Type.Optional(Type.Boolean)`).
- **New behavior step** in `rewindExecute`: step 6b (dirty-guard → restore → fold results into success text + marker).
- **New event hooks** (only when `config.revert.enabled`): `turn_start` capture (the turn's before-ref), `agent_end` capture (the after-ref that powers `dirtyCheck`).
- **New checkpoint behavior** `/mulligan_checkpoint` step 4b: capture a `ckpt:<name>` snapshot so a later `granularity:"checkpoint"` rewind can restore to it.
- **New edge cases** E27 (failopen), E28 (no backend), E29 (caps), E30 (dirty-guard refuses), E31 (index divergence — documented), E32 (reload — **resolved** via persisted refs).
- **New tests**: 8 integration scenarios `F-revert-git/-cas/-explicit/-failopen/-delete/-dirtyguard/-granularity/-reload` + unit tests (paths.ts, CAS hash/manifest, git command construction).
- **New decision** D11 (opt-in, whole-tree-snapshot, best-effort, git-history-safe). New glossary terms (working-tree revert, SnapshotStore, CasBackend, shadow repository).

### 1.2 Modified (existing behavior amended)
- **`E5` mutation warning** (`@spec/08`, `src/tools/rewind.ts`): when step 6b reverted files, the `"⚠ ... effects PERSIST on disk"` warning is **reworded to name ONLY non-filesystem effects** (commits, dependency installs, network/DB, staged index, `failed`/`refused` files). The agent must NOT be told reverted files persist.
- **`REWIND_DESC`** (`src/tools/rewind.ts`): append one sentence advertising `revert_file_changes` (v1.2, opt-in, `last_turn`/`checkpoint` only).
- **`driftThresholdTokens`** default bumped 3000→**6000** in `@spec/04` §7 (already landed in spec; verify the code matches — see §3.6 below).

### 1.3 Removed
None. No existing capability is deleted. v1.2 is purely additive on top of v1.1.

---

## 2. Verified prerequisites (Pi surface + codebase state)

**Pi event surface (verified against installed `@earendil-works/pi-coding-agent` `dist/core/extensions/types.d.ts`):**
- ✅ `pi.on("turn_start", handler)` — `TurnStartEvent { type, turnIndex, timestamp }` (line 886). Used for the before-snapshot capture.
- ✅ `pi.on("agent_end", handler)` — `AgentEndEvent { type, messages }` (line 884). Used for the after-snapshot capture (drift detection).
- ✅ `ctx.cwd: string` (line 217) — the working-tree root for snapshot capture/restore.
- ✅ `ctx.sessionManager` (readonly), `pi.appendEntry`, `pi.setLabel` — already used by v1.1.
- ✅ Pi's own `git-checkpoint.ts` example uses `on("turn_start")` for per-turn `git stash` — confirms the hook is real and idiomatic (`@spec/03` §2.2).

**Current v1.1 codebase state (verified):**
- `src/snapshot/` does **not** exist yet — all 4 files are new.
- `src/config.ts` has **no** `revert` field — must be added.
- `RewindMarker` (`src/markers.ts:54`) has **no** `revert` field — must be added (optional, backward-compat).
- `rewind.ts` `RewindParams` (line 79) has **no** `revert_file_changes`/`delete_created_files` — must be added.
- `index.ts` registers handlers for `context`/`tool_result`/`turn_end`/`session_start`/`session_shutdown` — **no** `turn_start`/`agent_end` yet.
- No `test/snapshot*` or revert-related tests exist — all new.

---

## 3. Requirements (what to build)

> The full engineering detail lives in `@spec/14-working-tree-revert.md`. The PRD states the requirement + names the spec anchor + the Mode-A doc that rides with it. Implementers follow `@14` for the exact algorithms (git shadow-repo commands, CAS hash/manifest, mtime short-circuit, dirty-guard, GC).

### R1 — Configuration: `config.revert.*` block (8 fields)
Add the `revert` config block to `MulliganConfig` + `DEFAULT_CONFIG` + `validateConfig` exactly as `@spec/09` §2/§3/§4 specify. Defaults: `enabled:false`, `allowDeleteCreatedFiles:false`, `nonGitMode:"cas"`, `storageDir:null` (→ `<sessionDir>/mulligan/`), `maxFileBytes:262144`, `maxTotalBytes:33554432`, `maxSnapshotsPerTurn:64`, `excludeGlobs:[.git,node_modules,dist,build,.next,.venv,target]`. Validation: booleans coerce; `nonGitMode` ∈ {`cas`,`explicit-paths`}; `storageDir` must NOT resolve inside `cwd`; numbers finite `>0`; `excludeGlobs` string array. Never throw (per-field fall-back to default + warn log).
- **Mode A docs (ride with work):** JSDoc on the `revert` block + each field in `src/config.ts`, citing `@14` §8.
- **Affected completed work:** `src/config.ts` (additive), `src/settings.ts` (deep-merge already recurses — verify no change needed), `test/config.test.ts` (add revert-block validation tests).

### R2 — Pure helpers + types: `paths.ts`, marker field, runtime field
- **R2a — `src/snapshot/paths.ts` (NEW, pure):** `resolveSafeWorkspacePath`, `normalizeRelPath`, `isDangerousWorkspaceRel` per `@14` §4.3. Reject `..` escape, NUL, directory paths, `.git`/`.pi`/`node_modules`, absolute paths outside workspace root. 0 Pi imports — fully unit-testable.
- **R2b — `RewindMarker.revert?` field (`src/markers.ts`):** add the optional `revert` block `{ revertedFiles, deletedFiles, failedFiles, refusedFiles, skipped, backend }` per `@spec/04` §3. Optional ⇒ old markers type-check unchanged. Add the `RevertCheckpoint` type (`@spec/14` §2: `{ label, backend, beforeRef, afterRef?, turnIndex, ts }`).
- **R2c — `SessionRuntime.snapshots?` (`src/runtime.ts`):** add the optional `snapshots?: Map<string, RevertCheckpoint>` field per `@spec/04` §8. Reset on `session_start` (the existing pattern). Checkpoint refs persist across reload via `mulligan:revert-checkpoint` control entries + on-disk shadow-repo refs (E32).
- **Mode A docs:** JSDoc on each new symbol citing `@14` §2/§4.3 and `@spec/04` §3/§8.
- **Affected completed work:** `src/markers.ts` (additive field), `src/runtime.ts` (additive field + reset), plus tests.

### R3 — `SnapshotStore` backends: `store.ts` + `git.ts` + `cas.ts`
- **R3a — `src/snapshot/store.ts` (NEW):** the `SnapshotStore` interface (`describe/capture/dirtyCheck/restore/has/retire`), the `detectAndCreate(cwd, config)` factory (git-repo → `GitBackend`; non-git writable → `CasBackend`; neither → `"none"` no-op), and a per-store `AsyncMutex` serializing all ops (`@14` §2, §4.3). Backend detection cached per session in `SessionRuntime`.
- **R3b — `src/snapshot/git.ts` (NEW):** `GitBackend` — the **external shadow repository**. `init` with external `GIT_DIR=<storageDir>/<key>` + `GIT_WORK_TREE=<repoRoot>` (one shadow repo per source worktree, keyed by repo root). Capture: `add --all -f` (force gitignored files IN; `.gitignore` deliberately NOT consulted) + pathspec negations from `excludeGlobs` → `write-tree` → `commit-tree` → `update-ref refs/mulligan/snapshots/<label>` (protected ref). Restore: `read-tree` + `checkout -- <paths>` (working-tree only; **never** source index/refs). **Strict git-safety (the five guarantees, `@14` §3):** the ONLY command against `sourceGitDir` is read-only `rev-parse`; all writes target the shadow repo; the user's `.git` is byte-identical after every op (no objects, no reflog/stash entry).
- **R3c — `src/snapshot/cas.ts` (NEW):** `CasBackend` — minimal content-addressed store (~300 LOC: hash + blob + manifest). `"cas"` mode (default): whole-tree walk with mtime/size short-circuit (O(changed-files) steady-state), content dedupe, `{path→hash, existed}` manifest. `"explicit-paths"` mode: capture only `write`/`edit` tool paths at `tool_call` time (bash NOT captured + once-per-turn warning). `dirtyCheck` via hash equality vs the after-manifest. Storage outside `cwd`/`.git`.
- **Mode A docs:** JSDoc on `SnapshotStore`, each backend, each method citing `@14` §2/§3/§4.
- **No completed work affected** — entirely new files.

### R4 — Capture lifecycle: `turn_start` + `agent_end` + checkpoint + GC + teardown
- **R4a — `turn_start` capture hook:** register `pi.on("turn_start", …)` (only active when `config.revert.enabled`). **Prompt-boundary GC runs FIRST** (`@14` §5): delete every `refs/mulligan/snapshots/turn/*` ref + `git gc --auto --prune=now` (CAS analog: delete `turn/*` manifests + mark-sweep unreferenced blobs) — safe because no non-checkpoint rewind crosses a prompt. THEN `capture("turn")` → the turn before-ref, held in `SessionRuntime.snapshots`. `session_start` runs the same GC pass to clear stale `turn/*` refs from a reloaded instance.
- **R4b — `agent_end` capture hook:** register `pi.on("agent_end", …)` (only when `config.revert.enabled`). `capture("turn-after")` → the after-ref stored alongside the before-ref. This is what makes `dirtyCheck` detect post-turn drift (E30).
- **R4c — `/mulligan_checkpoint` step 4b (`src/commands.ts`):** when `config.revert.enabled`, `capture("ckpt:<name>")` → a before-ref persisted in a `mulligan:revert-checkpoint` control entry alongside the label, so it survives reload (E32). Best-effort: a capture failure is logged and never blocks checkpoint creation.
- **R4d — `session_shutdown` teardown:** wipe the shadow repo / CAS dir (both stores deleted entirely — no cross-session buildup; `@14` §5).
- **Mode A docs:** JSDoc on each hook citing `@14` §5; checkpoint command step 4b cites `@spec/13` §2.
- **Affected completed work:** `src/index.ts` (register 2 new handlers + thread the store), `src/commands.ts` (add step 4b to the existing checkpoint command), `src/runtime.ts` (snapshots map + store handle).

### R5 — `mulligan_rewind` integration: new params + step 6b + warning reword + description
- **R5a — `RewindParams` (`src/tools/rewind.ts`):** add `revert_file_changes: Type.Optional(Type.Boolean(...))` and `delete_created_files: Type.Optional(Type.Boolean(...))` per `@spec/05` §1 schema (verbatim descriptions there).
- **R5b — `rewindExecute` step 6b (after marker persist, before mutation warning):** per `@spec/05` §1 step 6b + `@14` §6/§7. Decision tree: neither flag → unchanged (v1.1 path). Flags but `!config.revert.enabled` → ignore + append `"(file revert requested but disabled in config)"`. Flags at `last_tool_call_group` → ignore revert + return the mismatch notice (`@14` §1 granularity scope). Else → resolve the `RevertCheckpoint` for the boundary; run the §6 dirty guard (if any path drifted since `afterRef`, refuse the **whole** file-revert → `refused[]`, context rewind STILL proceeds); otherwise `store.restore(handle, {revertFileChanges, deleteCreatedFiles})` and fold `{reverted,deleted,failed,skipped,refused}` into the success text + the marker's `revert` field. Best-effort: missing handle (disabled at capture / caps) → 0 reverted, rewind still proceeds. Never throws (E13).
- **R5c — step 7 mutation warning reword (E5 amendment):** when step 6b reverted files, the standard E5 `"⚠ ... effects PERSIST on disk"` warning is reworded to name ONLY effects that are NOT working-tree file state (commits made, dependency installs, network/DB/process, staged index changes, `failed`/`refused` files). The agent must not be told reverted files persist (`@spec/05` §1 step 7, `@spec/08` E5).
- **R5d — `REWIND_DESC` update:** append the sentence advertising `revert_file_changes` per `@spec/05` §6 description string.
- **Mode A docs:** JSDoc/param descriptions are the LLM-facing docs (`@spec/05` §1) — ride with the schema change.
- **Affected completed work:** `src/tools/rewind.ts` (params + step 6b + step 7 reword + desc), `src/markers.ts` (the `revert` field is written here), plus tests.

### R6 — Tests: unit + integration
- **R6a — Unit tests:** `paths.ts` (reject `..`/NUL/`.git`/`node_modules`/directory/abs-outside-workspace); CAS (hash, manifest, mtime-short-circuit, dedupe); **git command construction** (assert NO write command ever targets `sourceGitDir` — only `rev-parse`/`ls-files` reads — `@spec/10` §10); `AsyncMutex` serialization; config validation (R1).
- **R6b — Integration scenarios** (`@spec/10` §2.1, all v1.2-tagged): `F-revert-git` (temp git repo, mutate via `write`+`edit`+bash `sed -i`, rewind `last_turn` with `revert_file_changes`, assert files match pre-span AND user's `.git` byte-identical AND shadow repo holds a protected ref that `retire()` clears); `F-revert-cas` (non-git, `nonGitMode:"cas"`); `F-revert-explicit` (`nonGitMode:"explicit-paths"`: write/edit reverted, bash `sed` NOT + warned); `F-revert-failopen` (locked file → `failed[]`, rewind proceeds); `F-revert-delete` (`allowDeleteCreatedFiles` gating — refused when off even with the flag); `F-revert-dirtyguard` (post-`agent_end` external edit → `refused[]`, context rewind proceeds, file NOT overwritten); `F-revert-granularity` (`last_tool_call_group` flags ignored + noticed); `F-revert-reload` (rewind with revert, `/resume`, refs still honored — E32).
- **Mode A docs:** none — test-only.
- **No completed work affected** — new tests; existing tests stay green (v1.2 is opt-in + default-off, so the existing v1.1 suite is untouched).

### R7 — Sync changeset-level documentation (Mode B)
Cross-cutting docs that only make sense once R1–R6 land. Depends on all of the above.
- **README.md:** add a "Working-tree revert (v1.2, opt-in)" section — what it is (opt-in file restoration so the resumed agent needn't re-read), how to enable (`config.revert.enabled`), the per-call flags, the granularity scope (`last_turn`/`checkpoint` only), the git-safety guarantee (never touches the user's `.git`), and the dirty-guard behavior. Mirror the project's existing "soft-delete / visible-in-`/tree`" framing — clarify this feature touches the *working tree*, NOT the session tree.
- **Verify no stale references:** grep README + src for `5 tools`/orphan v1.1 language unaffected; the glossary/decision-log additions are spec-side (already landed in `a4767c6f`), so no code-doc sync beyond README + JSDoc.

---

## 4. Sizing & ordering rationale

This is a **large new feature** (new subsystem: 4 new source files, two non-trivial backends, 2 new event hooks, new tool params + behavior, 8 new test scenarios). A full PRD structure is warranted — but the spec (`@14`) is the authoritative engineering reference, so the PRD stays scoped to *what/why/ordering/doc-impact* and defers algorithm detail to `@14`.

**Proposed breakdown (5 phases):**
1. **Foundation** (R1 config + R2 pure helpers/types) — lands the config knob + the pure `paths.ts` + the marker/runtime field additions. Zero new behavior; everything is inert until `config.revert.enabled` is true. Low risk; unblocks R3.
2. **Backends** (R3 `store.ts`/`git.ts`/`cas.ts`) — the bulk of the new code. Pure-ish (`paths.ts` is pure; the backends are I/O-coupled but the `SnapshotStore` interface keeps them swappable). Unit-testable without Pi for the CAS + paths; git backend needs a real temp repo.
3. **Capture lifecycle** (R4 hooks + checkpoint step 4b + GC + teardown) — wires the store into Pi events. Depends on R2 (runtime field) + R3 (store). The prompt-boundary GC is the subtle part (`@14` §5).
4. **Rewind integration** (R5 params + step 6b + warning reword + desc) — the user-visible behavior. Depends on R3 (store) + R2 (marker field). The dirty-guard refuse-on-drift (E30) is the safety-critical part.
5. **Tests + docs** (R6 + R7) — integration scenarios + README. Depends on all of the above.

Phase 5's tests can be written incrementally alongside R3/R4/R5 (TDD-style, mirroring the existing build order `@spec/11` Step 6c); R7 (README) runs last as the Mode-B sweep.

---

## 5. Proportionality check (self-audit)

- **Actual change size:** 1 spec commit, +361/−8 lines across 11 spec files, including a brand-new 242-line engineering doc (`@14`) and a new `src/snapshot/` subsystem (4 files). This is unambiguously a **large** delta, not a tweak.
- **PRD size match:** 7 requirements + 5 proposed phases. No 9-phase sprawl; each phase maps 1:1 to a cohesive unit of new code. The spec does the heavy lifting (algorithms, exact git commands, GC cadence); the PRD does not duplicate it.
- **Scope discipline:** every requirement traces to a `@spec/14` section or an explicit `@spec/04/05/08/09/10/13` amendment. No invented requirements. No re-litigation of v1.1 decisions (the guardrail, human surface, agent-attributable delta are untouched).

---

## 6. What is explicitly out of scope for this delta
- **Surgical `last_tool_call_group` file-revert** — `@spec/14` §11 lists it as a documented future enhancement (intra-turn group-boundary capture). v1.2 supports only boundary-granular (`last_turn`/`checkpoint`) file revert; group-granularity revert is **refused** (not silently mis-performed) and the tool returns a mismatch notice.
- **Shadow-repo cleanup command** (`/mulligan_revert_cleanup`) — `@spec/14` §11 marks it low-priority / largely redundant given prompt-boundary GC.
- **On-disk CAS spill** for very large working sets (`@spec/14` §11).
- **Any change to the soft-delete view model** — working-tree revert is orthogonal; the session tree stays append-only (D2/principle 2 preserved; `@spec/03` §2.2 amendment).
- **Hard retry / tool-call replay** — still rejected (D1); revert is a state-restore, not a re-execution (`@14` §0).
- **v1.1 surface changes** — the previous session's guardrail, human commands, and agent-attributable drift delta are complete and untouched.