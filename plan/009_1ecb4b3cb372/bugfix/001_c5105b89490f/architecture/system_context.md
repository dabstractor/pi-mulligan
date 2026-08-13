# System Context — BUG-001 Hardening

## Premise Mismatch (CRITICAL — read first)

The PRD (`Bug Fix Requirements`) describes BUG-001 as an **unfixed critical defect**:
`delete_created_files` irreversibly deletes pre-existing files exceeding
`revert.maxFileBytes` because they are skipped at capture (absent from the snapshot) yet
indistinguishable from genuine span-created files at restore.

**Reality check result: the primary fix described in the PRD is ALREADY LANDED and tested.**

- Commit `ec5ad32` "Add spare guard for oversize pre-existing files in delete_created_files (BUG-001)"
  introduced a `spare` Set built from the oversize record in BOTH backends' restore delete step.
- The PRD's two recommended fix directions are already implemented:
  1. "restore()'s delete step must treat manifest.skipped / the oversize note as known
     pre-existing files to spare" → **DONE** via `const spare = new Set(result.skipped)` (git.ts:869)
     / `new Set(manifest.skipped ?? [])` (cas.ts:1119), each followed by `if (spare.has(rel)) continue/return`.
  2. "Add an integration test (F-revert-delete-oversize)" → **DONE**:
     - `test/integration/revert-cas.test.ts:750` (cas, real fs)
     - `test/integration/revert-git.test.ts:850` (git, real git)
     - `test/git.test.ts:728` (git unit, fake exec)
     - `test/cas.test.ts` (cas unit, CasFs fake)

**Do NOT re-implement the spare Set.** It exists. The work below targets a genuine
**residual gap** in the same bug class that the spare Set does not close.

## Residual HIGH-Severity Gap (the actual unfixed work)

### The note-write-failure data-loss window (GitBackend only)

**Root cause.** The oversize paths are persisted as a **git note** under
`refs/mulligan/oversize` keyed by `commitSha` (git.ts capture, ~line 418-432). This note
write is **best-effort with its OWN try/catch** — a failure (notes machinery unavailable,
disk error, ref lock contention) is **silently swallowed** and capture still returns the
commitSha (the ref is already pinned by `update-ref`).

At restore time, the note is read back into `result.skipped` (git.ts ~line 811-824), and the
`spare` Set is built from `result.skipped`. **If the note was never written, `result.skipped`
is empty, the spare Set is empty, and `git ls-files --others` lists the oversize file
(never staged → untracked vs the read-tree'd beforeRef index) → it is unlinked.**

The design comment explicitly accepts "no note ⇒ no skipped signal" as the E29 best-effort
contract — but it conflated a **reporting concern** ("the agent won't see the incomplete
revert") with a **data-integrity concern** ("a pre-existing file gets deleted"). The latter
is the BUG-001 defect re-opening through a different trigger.

**Trace (confirmed by code reading):**
1. Capture: `oversizePaths=["big.bin"]` → excluded via `:!` pathspec (never staged) →
   `git notes ... add` THROWS → catch swallows → returns `commitSha`.
2. Restore(commitSha, {deleteCreatedFiles:true}):
   - `read-tree commitSha` (shadow index lacks big.bin)
   - `git notes show commitSha` → non-zero exit → catch → `result.skipped = []`
   - `git ls-files --others` → `big.bin\nnew.ts\n`
   - `spare = new Set([])` → `spare.has("big.bin")` = false → **`unlink(big.bin)` → DATA LOSS**

### Why CAS is immune to the note-write failure (but still gets the belt-and-suspenders guard)

The CAS manifest write failure aborts capture (returns `null` — cas.ts ~line 546-560 is inside
the outer try; a `writeFile` throw is caught → `null`). A `null` ref cannot be restored from,
so there is no orphan ref with a missing oversize record. Additionally, the CAS restore
`walkTree` already computes `st` via `this.fs.stat(abs)` (cas.ts:411-440) and passes it as the
**third positional argument** to the `visit` callback — so a size check needs **no new DI seam**,
just accepting the already-passed `st` in the restore callback (currently dropped at cas.ts:1123).

## Recommended Fix — Defense-in-Depth Restore-Time Size Guard

Add an **independent, deterministic** size check in the restore delete step of BOTH backends:
any delete-candidate whose current byte size exceeds `cfg.revert.maxFileBytes` is **spared**
(skip unlink), regardless of whether the note/manifest round-trip succeeded.

**Why this is correct and safe:**
- A file the agent genuinely created during the span that happens to be > maxFileBytes would
  also be spared — this is **fail-SAFE** (a leftover file the agent can manually remove is far
  better than irreversible deletion of a pre-existing user file). The whole feature is sold on
  "delete_created_files only deletes files the span created"; when we cannot be CERTAIN
  (missing note), we must not delete.
- It is **belt-and-suspenders**: even in the happy path (note present), the size guard is
  harmless — files already in the spare Set are skipped before the size check runs, so the
  guard only adds coverage for the note-failure path.
- It does NOT depend on the best-effort note round-trip, so it closes the window permanently.

### Per-backend implementation notes

**GitBackend (git.ts, restore delete step ~line 887):**
- Needs a `stat` DI seam added to `GitBackendDeps` (default: real `node:fs/promises.stat`),
  mirroring the existing `unlink` seam (git.ts:117-122). The delete step currently iterates
  `git ls-files --others` paths with NO size info, so it must stat each candidate.
- Existing unit tests use fake paths (`/fake/cwd/...`) with a fake `exec` + fake `unlink`.
  With the production-default `stat`, those fake paths ENOENT → the size-guard try/catch is
  swallowed → the existing unlink logic runs unchanged. **No existing test breaks.**
- The note-write-failure regression test injects a `stat` fake returning
  `{ size: > maxFileBytes }` to prove the guard fires.

**CasBackend (cas.ts, restore delete step ~line 1123):**
- `walkTree`'s `visit` callback type is `(rel, abs, st: {size, mtimeMs})` — `st` is ALREADY
  computed and passed positionally. The restore callback currently declares `async (rel, abs) =>`
  (drops `st`). Change to `async (rel, abs, st) =>` and add `if (st.size > this.cfg.maxFileBytes) return;`
  after the `spare.has(rel)` check. **No new DI seam needed.**

## Key File/Line References (verified this session)

| Concern | Location |
|---|---|
| GitBackend spare Set (existing fix) | `src/snapshot/git.ts:869` (`const spare = new Set(result.skipped)`), `:887` (`if (spare.has(rel)) continue`) |
| GitBackend note write (best-effort, the gap) | `src/snapshot/git.ts` ~418-432 |
| GitBackend note read into result.skipped | `src/snapshot/git.ts` ~811-824 |
| GitBackend deps DI seam (exec/scan/unlink) | `src/snapshot/git.ts:104-122`, constructor ~272 (`this.unlink = deps?.unlink ?? fsUnlink`) |
| CasBackend spare Set (existing fix) | `src/snapshot/cas.ts:1119` (`const spare = new Set(manifest.skipped ?? [])`), `:1125` (`if (spare.has(rel)) return`) |
| CasBackend walkTree (computes + passes st) | `src/snapshot/cas.ts:411-440` (visit signature `(rel, abs, st:{size,mtimeMs})`) |
| CasBackend restore callback (currently drops st) | `src/snapshot/cas.ts:1123` (`async (rel, abs) =>`) |
| CasBackend manifest write (failure → null) | `src/snapshot/cas.ts` ~546-560 |
| RestoreResult (5 buckets) | `src/snapshot/store.ts:194-201` |
| RestoreOpts | `src/snapshot/store.ts` ~172 |
| Config revert block + defaults | `src/config.ts:108` (maxFileBytes field), `:210` (default 262144) |
| Git unit test helpers | `test/git.test.ts` ~66 (`makeExec`), ~87 (`makeBackend`), ~100 (`makeBackendWithUnlink`) |
| Existing spare-guard test (git unit) | `test/git.test.ts:728` |
| Existing note-failure capture test | `test/git.test.ts:876` (capture survives note-add failure — but restore uses `deleteCreatedFiles:false`) |
| Oversize integration tests | `test/integration/revert-git.test.ts:850`, `test/integration/revert-cas.test.ts:750` |

## Test Framework & Conventions

- **vitest** (`npx vitest run`).
- **Unit tests** (test/git.test.ts, test/cas.test.ts): fake `exec` (canned stdout via
  `stdoutByCmd`, sabotage via `throwOn:{cmd,call}`), fake `unlink` (recording array), CasFs
  fake (`makeStateFs`/`makeStateBackend`). No real files on disk for git unit tests.
- **Integration tests** (test/integration/revert-*.test.ts): REAL filesystem + REAL `git`
  binary. Hand-rolled `makePi()`/`makeCtx()` fakes (no `vi.fn`). Helper idiom copied verbatim
  across the 3 integration files.
- Every implementation subtask implies TDD: write the failing test → implement → pass.