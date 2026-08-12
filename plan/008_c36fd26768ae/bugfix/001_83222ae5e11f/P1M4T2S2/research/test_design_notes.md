# Research Notes — P1.M4.T2.S2 (E30 dirty-guard integration test)

## The scenario (BUG-004 / E30) — from PRD §h2.2/h3.3 + architecture §BUG-004

Agent mutates a file via a bash command that is NOT parseable into `ledger.modifiedFiles`
(`python -c` / `node -e` / `perl -i` / heredoc / `awk -i inplace` → lands in
`ledger.bashSideEffects`). A HUMAN then edits that same file after `agent_end`.
On a `last_turn` rewind with `revert_file_changes:true`, the dirty guard MUST refuse the
file-revert (E30 — "never silently clobber concurrent edits") and leave the human edit intact.

## Root cause the test must distinguish (OLD code → FAIL vs NEW code → PASS)

- **OLD (pre-S1):** `const affectedPaths = ledger.modifiedFiles;` (rewind.ts:849). For a
  python/node mutation `modifiedFiles=[]` → `dirtyCheck(afterRef, [])` → git.ts early-returns
  `[]` on empty paths → guard ALWAYS passes → `restore()` reverts b.ts back to `original`,
  destroying the human edit (E30 violation). **Test MUST fail on this.**
- **NEW (post-S1, P1.M4.T2.S1):** `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`
  → `git diff --name-only <beforeRef>` returns `['b.ts']` (differs from the pre-turn snapshot) →
  `dirtyCheck(afterRef, ['b.ts'])` returns `['b.ts']` (current `HUMAN-EDIT` differs from the
  post-turn baseline `agent-version`) → REFUSE → b.ts stays `HUMAN-EDIT`. **Test MUST pass on this.**

## Which bash commands simulate the heuristic gap (verified — src/ledger.ts:101)

`FILE_MUTATING_COMMANDS` = {rm, rmdir, mv, cp, mkdir, touch, chmod, chown, chgrp, ln, tee,
truncate, install, patch, **sed**, split, csplit, curl, wget}. Comment at ledger.ts:99-100
VERBATIM: "git/node/npm/make are intentionally ABSENT: their path-like args (script.js, build
target) are NOT reliable 'modified files' → bashSideEffects only". `python`/`perl`/`awk` are
ALSO absent → `python3 -c "..."` → bashSideEffects ONLY, modifiedFiles empty. (Confirmed by
ledger.test.ts:107-113: `sed -i 's/a/b/' f.ts` → modifiedFiles=['f.ts']; a python/node command
→ modifiedFiles=[]).

➡ **Test choice:** record `asstBash("p1", "python3 -c \"open('b.ts','w').write('agent-version')\"")`
in `contextEntries` (parsed → bashSideEffects, NOT modifiedFiles). The ledger is parsed from the
**recorded command STRING**, not executed — so NO python3 binary is needed. The actual file
mutation is done via `writeFileSync(b.ts, "agent-version\n")` in the test body, exactly mirroring
the existing F-revert-git idiom (it records `asstBash("s1", "sed -i ...")` then mutates via
`execFile("sed",...)` or a `writeFileSync` fallback). This keeps the test hermetic + cross-platform.

## The exact APIs the test exercises (verified signatures + behavior)

- `store.changedPaths(beforeRef): Promise<string[]>` — git.ts:490. `git diff --name-only
  <beforeRef>` via shadowEnv (GIT_DIR=shadow + GIT_WORK_TREE=repoRoot). Single-commit-arg diff
  compares the commit's tree vs the WORKING TREE (no index) → robust to a polluted shadow index.
  No `--diff-filter` → full A/D/M/R/C coverage. Best-effort `[]` on any error.
- `store.dirtyCheck(afterRef, paths): Promise<string[]>` — git.ts:426. **EARLY-RETURNS `[]` if
  `paths.length === 0`** (git.ts:433 guard) — this is the OLD-behavior contrast lever. Else
  `git diff --name-only <afterRef> -- <paths...>` → the subset of `paths` that differ from afterRef.
- `store.restore(beforeRef, opts)` — git.ts. NOT called on the refuse path (doRestore() is gated
  behind a clean dirtyCheck).
- Capture hooks: `turnStartCaptureHandler` (writes rt.snapshots["turn"].beforeRef) +
  `agentEndCaptureHandler` (sets rt.snapshots["turn"].afterRef in place). REAL hooks, no fakes.

## The refuse signal on the rewind tool (verified — src/tools/rewind.ts:928-931)

On driftedPaths.length > 0: `revertRefused = true; revertClause = "(file revert refused:
${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if
intended)"`. The rewind tool itself SUCCEEDS (successText appends the clause; it is NOT a
"Mulligan: refused — ..." tool-level refusal). So:
- text MUST contain "file revert refused: 1 path(s) changed since the turn ended"
- text MUST NOT contain "Mulligan: refused" (the rewind completes; only the file-revert is refused)
- b.ts stays 'HUMAN-EDIT\n' (restore() was never called)

Marker on refuse path: `doRestore()` is skipped → `revertBlock` is never assigned from a
RestoreResult → its buckets are empty/absent. `RewindDetails.revertRefused` is `true`
(rewind.ts:230 type, set at 930). So assert `res.details?.revertRefused === true` if details is
populated — but the TEXT + file-content assertions are the robust primary checks (details shape
can vary across result paths).

## Existing test pattern to mirror VERBATIM (test/integration/revert-git.test.ts)

All scaffolding is module-local and reusable: `makeRepo`, `makeStorage`, `setConfig`,
`detectAndCreate`, `getRuntime`, `turnStartCaptureHandler`, `agentEndCaptureHandler`, `makePi`,
`makeCtx`, `run`, `firstText`, `rewindRevert`, `asstBash`, `msgEntry`, `user`, `result`, `asst`,
`VALID_NOTE`, `git`, `gitAvailable`, the `dirs[]` + `beforeEach/afterEach` cleanup. The new `it()`
slots into the SAME `describe("F-revert-* integration ...")` block. NO new helpers needed.