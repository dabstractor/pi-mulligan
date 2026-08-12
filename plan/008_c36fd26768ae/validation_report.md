# pi-mulligan — Validation Report

**Target:** `pi-mulligan` v1.2 (working-tree-revert feature) · **Pi:** `0.84.1` · **Date:** 2025-08-12
**Checkout validated:** `/home/dustin/projects/pi-mulligan-state-reset` (a git worktree of the `pi-mulligan` repo)

---

## Verdict

**No Critical or Major functional defects.** The codebase is in strong shape: the full
deterministic correctness surface (1309 tests across 31 files) passes, `tsc --noEmit` is clean
(strict, `noImplicitAny`), and the headline v1.2 git-safety guarantee is verified by dedicated
integration tests against real temporary git repositories. Three minor, actionable code/packaging
issues were found; one environmental caveat explains why the model-driven smoke harness cannot run in
*this specific checkout* (it is not a defect in the code under test).

| Phase | Result |
|-------|--------|
| Type check (`tsc --noEmit`) | ✅ PASS |
| Unit + integration tests (`vitest`) | ✅ PASS — **1309/1309** (31 files) |
| v1.2 revert git-safety integration (`revert-git/cas/edge`) | ✅ PASS (9 scenarios) |
| Asset freshness (committed tarball) | ❌ STALE |
| Static hygiene (JSDoc, dead code) | ⚠ 2 minor |
| End-to-end smoke against real `pi` | ⚠ Blocked in this checkout (environmental — see §3) |

---

## 1. How the product was validated

**Real user workflows mirrored (per README §2–§6):**

1. **Zero-config load** — `pi -e ./src/index.ts` must boot with no `mulligan` config. Verified the
   factory wires 4 tools + 3 commands + 5 event handlers and fails-open to `DEFAULT_CONFIG`.
2. **Rewind + shrink + cancel + audit** — the four agent tools, exercised by `test/tools/*.test.ts`
   (225 tests) and the integration smoke (`F-rewind-core`, `F-shrink-persist`, …).
3. **Human commands (v1.1)** — `/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`,
   `/mulligan_audit` + the active-checkpoint banner (`test/commands.test.ts` 46 tests,
   `test/banner.test.ts` 8 tests).
4. **Working-tree revert (v1.2)** — `mulligan_rewind(revert_file_changes/delete_created_files)`
   against **real temp git repos and non-git dirs** via `test/integration/revert-{git,cas,edge}.test.ts`
   (9 scenarios): mutate via `write` + `edit` + bash `sed -i`, rewind `last_turn`, assert files restored
   to pre-span state, `.git` byte-identical, shadow ref present-then-cleared, marker audit block populated.
5. **The two ride-along nudges** — `test/nudges.test.ts` (30) + `test/drift_nudge.test.ts` +
   `test/turn_metric.test.ts`, plus the windowed/high-water logic.
6. **Edge cases (E1–E32)** — `test/edge-cases.test.ts` (51) + `test/bug-replay-repro.test.ts` (7,
   the turn-replay regression).

**Reproduced the full `npm test` + `npm run typecheck` + `npm run smoke` suite from the command line.**

---

## 2. Issues Found

Three minor, actionable issues. All are hygiene/correctness-of-artifacts — none affect the runtime
behavior that the 1309 tests assert.

### Issue 1 — Stale committed tarball (Minor · packaging)

`pi-mulligan-0.1.0.tgz` is **git-tracked** (committed in `4cacd731 "Wire up CI pipeline and npm
release automation"`) and **not in `.gitignore`**, but its contents predate both v1.1 and v1.2:

| Present in tarball? | File | Status |
|---|---|---|
| ❌ missing | `src/snapshot/{store,git,cas,paths}.ts` | entire v1.2 working-tree-revert feature |
| ❌ missing | `src/banner.ts` | v1.1 active-checkpoint banner |
| ❌ missing | `src/commands.ts` | v1.1 human slash commands |
| ⚠ still present | `src/tools/checkpoint.ts` | the v1 *agent* tool **removed** in v1.1 |

**Impact:** Anyone who `npm install`s from this local tarball (or references the committed artifact)
gets a pre-v1.1 build without working-tree revert. The GitHub Actions release workflow
(`release.yml`) runs `npm publish --provenance`, which repacks from the `files` field (`src/`) at
publish time — so **the published npm package is unaffected**; only the committed artifact is stale.
**Suggested fix:** `git rm pi-mulligan-0.1.0.tgz` and add `*.tgz` to `.gitignore` (build artifacts
should not be tracked).

### Issue 2 — Orphaned JSDoc on `gc()` in both snapshot backends (Minor · cosmetic)

In **both** `src/snapshot/git.ts` and `src/snapshot/cas.ts`, the `gc()` method's documentation
comment ("The prompt-boundary reclamation pass") has been separated from the method by the
`destroy()` method. Line layout (identical pattern in both files):

```
git.ts:  L530  /** prompt-boundary reclamation (intended for gc) … */   ← orphaned
         L544  /** Best-effort full teardown (for destroy) … */
         L558  async destroy(): Promise<void> { … }
         L578  async gc(): Promise<void> { … }                           ← no attached doc
```

Because a JSDoc block must *immediately* precede its declaration to attach, `destroy()` correctly
gets its doc, while `gc()` ends up with **no attached documentation** (the L530 comment is dead).
`cas.ts` shows the same ordering (doc L893 → destroy-doc L910 → destroy L921 → gc L934). This is a
copy-paste pattern propagated across both backends.

**Impact:** Cosmetic — affects IDE hover/tooltip and generated API docs for `gc()` only. Runtime
behavior of `gc()` is correct (the implementation is intact and unit-tested). **Suggested fix:** move
the "prompt-boundary reclamation" comment to sit immediately above the `gc()` method in both files.

### Issue 3 — Vestigial dead code: `makeCheckpointTool` (Minor · cleanliness)

`src/tools/checkpoint.ts` still exports `makeCheckpointTool` (plus `CheckpointParams`,
`CheckpointArgs`, `CKPT_DESC`, `CheckpointDetails`) — the **agent tool that was removed in the v1.1
refactor** when checkpoint moved to a human slash command (`src/commands.ts`). It is **not
registered** in `src/index.ts` (grep confirms no `makeCheckpointTool` reference in the factory); only
`validCheckpointName` is imported from this module (by `commands.ts`).

It is still unit-tested (`test/tools/checkpoint.test.ts`), so it compiles and passes — but it is
**dead at runtime** and ships in the published package (`src/` is in `package.json` `files`).

**Impact:** No runtime effect; misleading to readers (a `tools/checkpoint.ts` that looks like a live
agent tool but isn't registered). **Suggested fix:** extract `validCheckpointName` into a small helper
module (e.g. `src/checkpoint-name.ts`) and delete the `makeCheckpointTool` factory + its test, or
delete the factory and keep the name helper in place with a clear module-level note.

---

## 3. Environmental Caveat (NOT a code defect — informational)

`npm run smoke` (the model-driven integration harness) **cannot run in this checkout**, failing all
14 scenarios with `EXTENSION LOAD FAILED`. Root cause, fully diagnosed:

- The cwd (`pi-mulligan-state-reset`) is a **git worktree** of `/home/dustin/projects/pi-mulligan`.
- The user's **global** `~/.pi/agent/settings.json` declares `"../../projects/pi-mulligan"` in its
  `packages` array — so `pi` loads that copy's extension on **every** launch.
- Loading the worktree copy under test (`-e ./src/index.ts`) then collides on the four `mulligan_*`
  tool names: *"Tool 'mulligan_rewind' conflicts with …/pi-mulligan-state-reset/src/index.ts"*.

**This is an environment artifact, not a bug in the code under test.** Verified by isolating the agent
config (`PI_CODING_AGENT_DIR=/tmp/pi-agent-iso` with a minimal settings.json that omits the package):

- The extension then **loads cleanly** (the only subsequent error is the model provider being out of
  credits, unrelated to the extension).
- **7/14 deterministic smoke scenarios PASS** against real `pi` (`F-rewind-core`, `F-shrink-persist`,
  `F-shrink-preventive`, `F-nudge-drift`, `F-maxdepth`, `F-reload`, `E11`) — these assert on the
  persisted session JSONL (marker/entry shapes), which is produced *before* any model call.
- The other 7 scenarios fail only on `pi exit=1` from the provider error (their assertions require a
  working model to produce seed replies / survive turns), **not** from extension errors. Several are
  explicitly covered by unit tests the harness notes are authoritative for.

The harness is designed for an isolated single-install checkout; validating inside a worktree that
shares a repo with a globally-installed copy is what produces the collision. No code change can or
should address this — the recommended workaround is `PI_CODING_AGENT_DIR=/tmp/iso node
test/integration/run-smoke.mjs` (a clean agent dir with no `packages`).

---

## 4. Notable design observations (documented, not defects)

These were investigated and confirmed to be **explicitly documented/accepted** by the spec — listed
for completeness, **not counted as issues**:

- **Dirty-guard affected-set uses a heuristic file list.** `rewindExecute` step 6b passes
  `ledger.modifiedFiles` to `store.dirtyCheck()`, while `store.restore()` reverts via a full
  worktree diff. For `write`/`edit` and common `sed -i prog file` forms the ledger reliably extracts
  the path (sed is in `FILE_MUTATING_COMMANDS`, `looksLikeFilePath` rejects sed programs), so guard
  and restore agree. For complex pipelines (sed via `find -exec`, stdin redirects) the ledger may
  miss a path the restore still reverts — so a concurrent human edit to such a file is not
  dirty-checked. The code comment marks this a "documented limitation" and the spec accepts the
  ledger as best-effort; the mutation warning + note's `true_current_state` are the stated safeguards.
- **No linter configured.** The project relies on `tsc --noEmit` (strict) for static checking plus
  the vitest suite for behavior. There is no ESLint/Prettier config or `lint` script; CI
  (`test.yml`) runs typecheck + tests only. Consistent with the project's documented conventions —
  not a gap unless the team wants lint enforcement.

---

## 5. Recommendation

The codebase is production-ready for its v1.2 feature set. Address the three minor issues at
convenience (they do not gate correctness):
1. Untrack and gitignore the stale tarball.
2. Re-attach the orphaned `gc()` JSDoc in `git.ts` / `cas.ts`.
3. Remove the vestigial `makeCheckpointTool` dead code.

Re-running `./validate.sh` after those changes should yield zero findings (the gating phases already
pass). To exercise the model-driven smoke scenarios end-to-end, run with an isolated agent dir and a
working model provider.

---

*Generated by `./validate.sh` (typecheck + 1309 vitest tests + revert integration suites + asset/static
hygiene checks + best-effort real-`pi` smoke).*