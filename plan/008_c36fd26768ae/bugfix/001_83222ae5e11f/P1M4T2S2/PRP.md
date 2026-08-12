---
name: "P1.M4.T2.S2 — Add E30 dirty-guard integration test for bash/python-modified file with post-turn human edit (BUG-004 test)"
description: |
  Add ONE new integration test to `test/integration/revert-git.test.ts` that proves the BUG-004 fix
  (P1.M4.T2.S1 — `affectedPaths = await store.changedPaths(checkpoint.beforeRef)`) closes the E30
  silent-clobber hole. The scenario: a git repo; turn_start capture; the AGENT mutates `b.ts` via a
  bash command that is NOT parseable into `ledger.modifiedFiles` (a `python3 -c "open('b.ts','w')
  .write('agent-version')"` command → lands in `ledger.bashSideEffects`, `modifiedFiles=[]`); agent_end
  capture; a HUMAN then edits `b.ts='HUMAN-EDIT\n'` (the E30 concurrent-edit drift); a `last_turn`
  rewind with `revert_file_changes:true` MUST REFUSE the file-revert and leave `b.ts='HUMAN-EDIT\n'`
  intact (NOT clobber it back to 'original').

  The test is the VERIFICATION artifact for S1. It MUST FAIL on the OLD code (`affectedPaths =
  ledger.modifiedFiles` = [] → `dirtyCheck(afterRef, [])` early-returns [] → PROCEED → clobber) and
  PASS on the NEW code (`affectedPaths = changedPaths(beforeRef)` = ['b.ts'] → `dirtyCheck(afterRef,
  ['b.ts'])` = ['b.ts'] → REFUSE → b.ts preserved). It proves this BOTH at the store level
  (direct `changedPaths` + `dirtyCheck` micro-assertions showing [] vs ['b.ts']) AND end-to-end through
  the REAL `makeRewindTool` + REAL `GitBackend` (assert the refuse clause + the preserved file).

  DEPENDS ON (must be in the tree at implementation time): P1.M4.T2.S1 (the rewind.ts:849 source
  swap — IMPLEMENTING in parallel; treat its PRP as a CONTRACT), P1.M4.T1.S1/S2/S3 (changedPaths on
  the SnapshotStore interface + GitBackend + CasBackend + NoOpStore — ALL Complete), and
  P1.M1.T1.S1 (the BUG-001 afterRef conditional at rewind.ts:908-931 — Complete). NO production code
  changes. NO new files. ONE new `it()` inside the existing `describe`. Docs: none (test-only).

  CONTRACT FROM S1: after S1 lands, `src/tools/rewind.ts:849` reads
  `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);` and step 6b runs
  `const afterRef = checkpoint.afterRef; if (afterRef) { drifted = await store.dirtyCheck(afterRef,
  affectedPaths); if (drifted.length > 0) { revertRefused=true; revertClause="(file revert refused: N
  path(s) changed since the turn ended — not overwritten; re-request if intended)"; } else { await
  doRestore(); } } else { await doRestore(); }`. This test verifies that contract holds for the E30
  python/bash case.
---

## Goal

**Feature Goal**: Add an automated integration test that codifies the E30 guarantee ("never silently
clobbers concurrent edits") for the exact BUG-004 reproduction from the PRD: an agent mutates a file
via a bash command whose path is NOT extracted into `ledger.modifiedFiles` (a `python3 -c` write),
then a human edits that same file after `agent_end`. The test proves the dirty guard now (post-S1)
REFUSES the file-revert and preserves the human edit, and it proves the store-level mechanics
(`changedPaths` detects the file; `dirtyCheck` catches the drift) that distinguish the fixed code
from the buggy code.

**Deliverable**: ONE new `it(...)` test inside the existing
`describe("F-revert-* integration (spec/10 §2.1 / spec/14)", ...)` block in
`test/integration/revert-git.test.ts`. The test reuses ALL existing module-local scaffolding
(`makeRepo`, `setConfig`, `detectAndCreate`, `getRuntime`, the REAL capture hooks, `makeRewindTool`
via `run()`, `asstBash`, etc.) — NO new helpers, NO new files. The test name follows the existing
`F-revert-*` convention, e.g. `"F-revert-dirtyguard (E30): concurrent human edit to a python/bash-modified file is REFUSED, not clobbered"`.

**Success Definition**:
- `npx vitest run test/integration/revert-git.test.ts`: **green** (the new test passes on the S1-fixed
  code, and every existing F-revert-* test stays green — no regression).
- `npm test` (full suite): **green.**
- `npm run typecheck`: **0 errors** (the new test uses only existing types/helpers).
- The new test, if run against a `rewind.ts` with the OLD line
  (`const affectedPaths = ledger.modifiedFiles;`), would FAIL (the file gets clobbered to 'original'
  and the text does NOT contain the refuse clause). This is the "proves the fix" property — verify it
  mentally via the store-level micro-assertions (`dirtyCheck(afterRef, [])` === `[]` is the OLD
  behavior that would clobber).
- `git diff --name-only` shows ONLY `test/integration/revert-git.test.ts` (test-only; NO production
  changes).

## Why

- **Closes the verification gap the PRD explicitly flags.** The Recommendations section
  (selected_prd_content §h2.5) lists verbatim: "add an E30 dirty-guard test for a bash/python-modified
  file with a post-turn human edit." spec/14 §10 specifies an F-revert-dirtyguard test. The full
  1277-test suite passed BEFORE the bug was found precisely because NO test exercised the
  concurrent-edit-on-bash-side-effect-file case — the exact regression this test prevents from
  recurring.
- **Proves the S1 fix end-to-end + at the store level.** S1 (P1.M4.T2.S1) is a one-line production
  swap (`ledger.modifiedFiles` → `await store.changedPaths(checkpoint.beforeRef)`). Without this
  test, that swap is unverified at the integration level — a future refactor could silently revert it
  and re-open the E30 hole with all tests green. This test makes the E30 behavior a hard, codified
  invariant.
- **Documents the OLD-vs-NEW contrast IN the test** via the store-level micro-assertions
  (`dirtyCheck(afterRef, [])` → `[]` [old, would clobber] vs `dirtyCheck(afterRef, ['b.ts'])` →
  `['b.ts']` [new, catches drift]). A reader of the test sees exactly WHY the heuristic was wrong.

## What

**User-visible behavior**: NONE (test-only change; zero production code modified).

**Technical change**: ONE new `it()` added to the existing `describe` in
`test/integration/revert-git.test.ts`. The test mirrors the F-revert-git scenario structure (real
temp git repo, real `detectAndCreate` → `GitBackend`, real capture hooks, real `makeRewindTool`)
with these differences: (a) the agent's mutation is recorded as a `python3 -c` bash command (→
`bashSideEffects`, `modifiedFiles=[]` — the heuristic gap), (b) a HUMAN edits the file post-turn
(the E30 drift), (c) the rewind is asserted to REFUSE the file-revert and PRESERVE the human edit.
It also includes direct `store.changedPaths` + `store.dirtyCheck` micro-assertions that prove the
affected-set + drift mechanics.

### Success Criteria

- [ ] A new `it(...)` exists inside `describe("F-revert-* integration (spec/10 §2.1 / spec/14)", ...)`
      in `test/integration/revert-git.test.ts`, gated by `if (!(await gitAvailable())) { skip }` like
      its siblings.
- [ ] The test sets up a real git repo with `b.ts='original\n'` committed, enables revert
      (`setConfig({ revert: { enabled: true, storageDir } })`), `detectAndCreate` → `GitBackend`,
      wires it into `getRuntime(sid).store`, and captures turn_start (`turnStartCaptureHandler`).
- [ ] The test's `contextEntries` include the agent's mutation as `asstBash("p1", "python3 -c
      \"open('b.ts','w').write('agent-version')\"")` (parsed → `bashSideEffects`, NOT
      `modifiedFiles`), then mutates `b.ts` to `'agent-version\n'` via `writeFileSync` (mirroring the
      recorded command's effect), then captures agent_end (`agentEndCaptureHandler`) so
      `rt.snapshots.get("turn").afterRef` is set.
- [ ] The test includes DIRECT store-level micro-assertions proving the fix mechanics:
      `expect(await store.changedPaths(beforeRef)).toContain('b.ts')` (the NEW affected set detects
      the file) AND `expect(await store.dirtyCheck(afterRef, []))).toEqual([])` (the OLD
      `modifiedFiles=[]` behavior that would clobber) AND, AFTER the human edit,
      `expect(await store.dirtyCheck(afterRef, ['b.ts'])).toContain('b.ts')` (drift detected — the
      NEW code catches it).
- [ ] The test simulates the HUMAN edit: `writeFileSync(join(repoDir, "b.ts"), "HUMAN-EDIT\n")`
      (post-turn drift vs `afterRef`).
- [ ] The test drives the REAL rewind tool via `run(pi, ctx, { note: VALID_NOTE, granularity:
      "last_turn", revert_file_changes: true }, "final")`.
- [ ] The test ASSERTS (end-to-end): `firstText(res)` contains `"file revert refused: 1 path(s)
      changed since the turn ended"`; `firstText(res)` does NOT contain `"Mulligan: refused"` (the
      rewind itself succeeds; only the file-revert is refused); `readFileSync(b.ts)` ===
      `'HUMAN-EDIT\n'` (E30 satisfied — the human edit is NOT clobbered to 'original').
- [ ] `npx vitest run test/integration/revert-git.test.ts`: green (new test + all existing).
- [ ] `npm test`: full suite green. `npm run typecheck`: 0 errors.
- [ ] `git diff --name-only` shows ONLY `test/integration/revert-git.test.ts`.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the exact
target file + `describe` block, (b) the complete reusable-scaffolding inventory (every helper is
already module-local and named), (c) the exact scenario steps (commit → capture → bash-recorded
mutation → capture → human edit → rewind → assert), (d) the exact store-method return shapes
(`changedPaths`/`dirtyCheck` both `Promise<string[]>` of workspace-relative POSIX paths), (e) the
exact refuse-clause text string to assert against (`rewind.ts:931`), (f) the verified ledger
classification (`python3` is absent from `FILE_MUTATING_COMMANDS` → bashSideEffects-only — so the
recorded command string reliably produces `modifiedFiles=[]` regardless of whether python3 is
installed, because `extractFileLedger` parses the STRING, it does not EXECUTE it). No inference or
guessing required.

### Documentation & References

```yaml
# MUST READ — the bug this test verifies + the exact repro steps
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-004 (Major): Dirty guard affected-set uses heuristic ledger"
  why: defines the EXACT repro this test codifies (python-written file + post-turn human edit → old
    code clobbers, new code refuses) AND the "Integration with BUG-001 and BUG-004" combined post-fix
    step-6b code (which IS what S1 produces and what this test exercises).
  critical: the OBSERVED (buggy) result is "Reverted 1 file(s)... 0 refused; b.ts → original
    (HUMAN-EDIT destroyed)"; EXPECTED (fixed) is "dirty guard refuses; b.ts stays HUMAN-EDIT". The
    test must assert the EXPECTED state.

# MUST READ — the contract for the production code under test (S1, parallel/implementing)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T2S1/PRP.md
  why: defines EXACTLY what rewind.ts step 6b looks like post-fix: line 849
    `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);` + the BUG-001 afterRef
    conditional + the refuse clause at rewind.ts:931. This test verifies THAT contract holds for the
    E30 python case. Do NOT re-derive the expected behavior — read it from S1's PRP.
  critical: S1's PRP states the test "must FAIL on the old code (modifiedFiles=[]) and PASS on the
    fixed code (changedPaths)". The store-level micro-assertions below make that contrast explicit.

# MUST READ — the spec the E30 guarantee + the §6 step-2/step-3 dirty guard come from
- url: spec/14-working-tree-revert.md (§6 step 2 — affected set = changedPaths(beforeRef);
    §6 step 3 — conditional dirty guard; §10 — F-revert-dirtyguard test spec; E30 line ~213)
  why: §6 step 2 VERBATIM ("paths that differ between beforeRef and the current tree") is the
    invariant changedPaths computes; E30 ("concurrent/external modification → dirty guard REFUSES the
    file-revert") is the guarantee this test codifies.

# PRIMARY TARGET FILE (the ONLY file this item edits)
- file: test/integration/revert-git.test.ts
  why: the existing F-revert-* integration suite. ALL scaffolding is module-local + reusable (see
    "Current Codebase tree" below). The new `it()` slots into the existing `describe`. NO new helpers.
  pattern: mirror the F-revert-git scenario STRUCTURE exactly (makeRepo → commit → setConfig →
    detectAndCreate → getRuntime().store = store → makePi/makeCtx with contextEntries →
    turnStartCaptureHandler → mutate → agentEndCaptureHandler → run() rewind → assert). The ONLY
    differences: (1) the mutation is recorded as a `python3 -c` bash command (bashSideEffects, NOT
    modifiedFiles), (2) a human edit is applied post-agent_end, (3) the assertions check REFUSE +
    preservation instead of PROCEED + restoration.
  gotcha: the `contextEntries` ledger source must use `asstBash(...)` with a `python3 -c` command
    string so `extractFileLedger` produces `modifiedFiles=[]` / `bashSideEffects=['python3 -c ...']`.
    Do NOT use `sed`/`cp`/`mv`/`tee`/a redirect — those ARE parsed into `modifiedFiles`
    (FILE_MUTATING_COMMANDS at src/ledger.ts:101) and would NOT reproduce the heuristic gap (the
    guard would catch them even on the OLD code). `python3`/`node`/`perl`/`awk`/`git`/`npm`/`make` are
    intentionally ABSENT from that set (ledger.ts:99-100 comment).

# CONTRACT (read-only — already landed; the APIs the micro-assertions call)
- file: src/snapshot/git.ts (changedPaths ~line 490; dirtyCheck ~line 426)
  why: confirms the exact behavior the micro-assertions rely on. `changedPaths(beforeRef)` runs
    `git diff --name-only <beforeRef>` vs the WORKING tree (single-commit-arg diff, no index, no
    --diff-filter → full A/D/M/R/C coverage) → returns `['b.ts']` whenever b.ts differs from the
    pre-turn snapshot. `dirtyCheck(afterRef, paths)` EARLY-RETURNS `[]` when `paths.length === 0`
    (git.ts:433) — this is the OLD-behavior contrast lever (`dirtyCheck(afterRef, [])` === `[]`).
    Else `git diff --name-only <afterRef> -- <paths...>` → the subset differing from afterRef.
  gotcha: both are best-effort (never reject → `[]` on error). For a healthy temp git repo they are
    deterministic. `changedPaths` returns WORKSPACE-RELATIVE POSIX paths (so 'b.ts', not an abs path).

# CONTRACT (read-only — the rewind-tool refuse signal under test)
- file: src/tools/rewind.ts (step 6b refuse branch ~line 928-931; successText ~line 288)
  why: confirms the EXACT refuse-clause text to assert: `(file revert refused: ${driftedPaths.length}
    path(s) changed since the turn ended — not overwritten; re-request if intended)` — for 1 drifted
    path that is `(file revert refused: 1 path(s) changed since the turn ended — not overwritten;
    re-request if intended)`. successText appends revertClause via `text += " " + revertClause`
    (rewind.ts:288) — so the clause appears in `firstText(res)`. The rewind itself does NOT emit
    "Mulligan: refused" on this path (only the file-revert is refused; the context rewind completes).
  gotcha: `RewindDetails.revertRefused` is `true` on this path (rewind.ts:230 type, set at :930), but
    `details` may be `undefined` on some result shapes — assert it ONLY if present; the TEXT +
    file-content assertions are the robust primary checks.

# DEPENDENCY PRPs (their outputs are the production code this test exercises)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T2S1/PRP.md
  why: the S1 production swap (rewind.ts:849) — MUST be in the tree for this test to PASS. If S1 has
    NOT landed, this test will FAIL (clobber) — which is the intended "proves the fix" property, but
    it means S1 must merge first.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M1T1S1/PRP.md
  why: the BUG-001 afterRef conditional (rewind.ts:908-931) — Complete; the test relies on afterRef
    being set (a TURN has afterRef) so the dirty guard actually runs. (Checkpoints have no afterRef →
    guard skipped; this test uses last_turn granularity precisely so afterRef exists.)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S2/PRP.md
  why: GitBackend.changedPaths (git.ts:490) — Complete; the API the micro-assertion calls.
```

### Current Codebase tree (relevant slice — run `tree` / `ls` to confirm)

```bash
test/integration/
  revert-git.test.ts      # ← EDIT: add ONE `it()` to the existing `describe` (PRIMARY + ONLY deliverable)
  revert-cas.test.ts      # cas-backend F-revert-* (do NOT edit)
  revert-edge.test.ts     # edge F-revert-reload etc. (do NOT edit)
  revert-explicit.test.ts # explicit-paths F-revert-* (do NOT edit)
src/snapshot/
  git.ts                  # changedPaths (490) + dirtyCheck (426) + restore — CONTRACT (read-only)
  store.ts                # SnapshotStore interface — CONTRACT (read-only)
src/tools/
  rewind.ts               # step 6b refuse branch (928-931) — the code under test (read-only; S1 edits it)
src/ledger.ts             # extractFileLedger + FILE_MUTATING_COMMANDS (101) — read-only (explains the gap)
```

### Desired Codebase tree with files to be added/changed

```bash
test/integration/revert-git.test.ts   # MODIFIED — ONE new `it()` added inside the existing `describe`
# (no new files; no production changes; no helper changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — the bash command STRING recorded in contextEntries drives the ledger, NOT the real
//   mutation. `extractFileLedger(msgs, turnIndexes)` PARSES the recorded command text; it never
//   executes it. So `asstBash("p1", "python3 -c \"open('b.ts','w').write('agent-version')\"")`
//   produces `modifiedFiles: []` / `bashSideEffects: ['python3 -c "open(...)..."']` REGARDLESS of
//   whether python3 is installed. The REAL file mutation is a separate `writeFileSync(b.ts,
//   "agent-version\n")` in the test body (mirroring the recorded command's intent). This is EXACTLY
//   how the existing F-revert-git test works (it records `asstBash("s1", "sed -i ...")` then mutates
//   via `execFile("sed", ...)` or a `writeFileSync` fallback). Keep them in sync: the recorded command
//   and the writeFileSync must target the SAME file + content.

// CRITICAL #2 — use a command that is ABSENT from FILE_MUTATING_COMMANDS (src/ledger.ts:101). That set
//   is {rm,rmdir,mv,cp,mkdir,touch,chmod,chown,chgrp,ln,tee,truncate,install,patch,SED,split,csplit,
//   curl,wget}. Using `sed`/`cp`/`mv`/`tee`/a `> file` redirect would parse the path into
//   `modifiedFiles` → the OLD code's affected set would INCLUDE b.ts → the guard would catch the drift
//   EVEN ON THE OLD CODE → the test would NOT distinguish old-vs-new (it would pass on both). Use
//   `python3 -c`, `node -e`, `perl -e`, or `awk -i inplace` — all intentionally absent (ledger.ts:99-
//   100) → bashSideEffects-only → modifiedFiles=[] → reproduces the heuristic gap. `python3 -c` matches
//   the PRD BUG-004 repro verbatim.

// CRITICAL #3 — use `last_turn` granularity, NOT `checkpoint`. A TURN has both beforeRef AND afterRef
//   (turn_start + agent_end captures), so the BUG-001 afterRef conditional (rewind.ts:908) takes the
//   `if (afterRef)` branch and the dirty guard RUNS. A checkpoint has NO afterRef (single capture) →
//   the guard is SKIPPED (the else branch) → the test would never exercise the refuse path. The PRD
//   repro is explicitly a `last_turn` rewind. Pass `granularity: "last_turn"`.

// CRITICAL #4 — assert the refuse CLAUSE substring, not a tool-level refusal. On drift the rewind tool
//   emits revertClause = "(file revert refused: 1 path(s) changed since the turn ended — not
//   overwritten; re-request if intended)" appended to the SUCCESS text (rewind.ts:288, 931). It is NOT
//   a "Mulligan: refused — ..." (that prefix is reserved for hard refusals like crossing the first
//   user message). So: `expect(text).toContain("file revert refused: 1 path(s) changed since the turn
//   ended")` AND `expect(text).not.toContain("Mulligan: refused")`. Do NOT assert "0 files reverted"
//   literally — the proceed-branch success clause ("Reverted N file(s)...") is NOT produced on the
//   refuse path (doRestore is skipped), so it is simply absent; asserting its absence is fine but the
//   refuse-clause presence is the robust positive signal.

// CRITICAL #5 — the human edit MUST differ from the afterRef snapshot content for dirtyCheck to detect
//   drift. afterRef was captured when b.ts='agent-version\n'. Write b.ts='HUMAN-EDIT\n' (distinct from
//   both 'original\n' [beforeRef] and 'agent-version\n' [afterRef]) so: changedPaths(beforeRef)
//   detects it (≠ original), dirtyCheck(afterRef, ['b.ts']) detects it (≠ agent-version), and the
//   final file is unambiguously the HUMAN edit. Do NOT write 'original\n' (that would match beforeRef
//   → changedPaths might still list it but the "preserved" assertion would be ambiguous).

// CRITICAL #6 — the dirty guard REFUSES THE WHOLE file-revert on ANY drift (rewind.ts:929-930,
//   spec/14 §6 step 3), it does NOT do per-path partial reverts. So after the refuse, b.ts is
//   UNTOUCHED by restore (restore is never called) → b.ts stays exactly 'HUMAN-EDIT\n'. This is the
//   E30 guarantee. Assert `readFileSync(b.ts, "utf8") === "HUMAN-EDIT\n"`.

// CONVENTION #1 — gate the test with `if (!(await gitAvailable())) { console.warn(...); return; }`
//   like its siblings (real `git init` needs the binary). The existing module-local `gitAvailable()`
//   helper does exactly this.

// CONVENTION #2 — push the repoDir + storageDir onto the module-local `dirs[]` array (the
//   afterEach chmod-restores + rm's every entry). This is mandatory: the test creates real temp git
//   repos + storage dirs that must be cleaned up. Every sibling test does `dirs.push(repoDir)` +
//   `dirs.push(storageDir)`.

// CONVENTION #3 — use a UNIQUE sessionId per test (`const sid = "s-dirtyguard";`) and
//   `const rt = getRuntime(sid); rt.store = store;` to wire the real store BEFORE the capture hooks
//   (they self-gate on `rt.store`). The `beforeEach`/`afterEach` call `clearAll()` + `setConfig
//   (undefined)` to reset runtimes + config between tests.
```

## Implementation Blueprint

### Data models and structure

No data models. No types. No new exports. No new helpers. The test reuses the existing
module-local scaffolding in `test/integration/revert-git.test.ts` and exercises three already-landed
store methods (`changedPaths`, `dirtyCheck`, `restore`-via-the-rewind-tool) that exchange only
primitive `string` refs + `string[]` workspace-relative POSIX paths.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD one new `it(...)` to the existing `describe` in test/integration/revert-git.test.ts
  - FIND: the `describe("F-revert-* integration (spec/10 §2.1 / spec/14)", () => { ... })` block.
    Add the new `it(...)` as a new sibling INSIDE it (after the F-revert-delete tests, before the
    closing `});`). Do NOT add a new `describe`; do NOT add a new file; do NOT add new imports (every
    helper is already imported module-locally: `makeRepo`, `makeStorage`, `setConfig`, `getConfig`,
    `detectAndCreate`, `getRuntime`, `clearAll`, `turnStartCaptureHandler`,
    `agentEndCaptureHandler`, `makeRewindTool` (via `run`), `makePi`, `makeCtx`, `run`, `firstText`,
    `rewindRevert`, `asstBash`, `msgEntry`, `user`, `result`, `asst`, `VALID_NOTE`, `writeFileSync`,
    `readFileSync`, `existsSync`, `join`, `git`, `gitAvailable`, `dirs`, `RevertCheckpoint` type).
  - IMPLEMENT the scenario in this exact order (mirror F-revert-git's structure):

    // ── F-revert-dirtyguard (spec/14 §6 step 2/3 + E30; PRD BUG-004) ─────────
    it("F-revert-dirtyguard (E30): concurrent human edit to a python/bash-modified file is REFUSED, not clobbered", async () => {
      if (!(await gitAvailable())) {
        console.warn("[revert-git] git not on PATH — skipping F-revert-dirtyguard");
        return;
      }

      // SETUP: real git repo, commit b.ts='original\n' (so beforeRef snapshots a known pre-span state).
      const repoDir = await makeRepo("rev-dirtyguard-");
      dirs.push(repoDir);
      writeFileSync(join(repoDir, "b.ts"), "original\n");
      await git(repoDir, ["add", "-A"]);
      await git(repoDir, ["config", "user.email", "test@example.com"]);
      await git(repoDir, ["config", "user.name", "Test"]);
      await git(repoDir, ["commit", "-m", "init"]);

      // SEPARATE storage dir (must NOT resolve inside cwd — config rejects that → NoOpStore).
      const storageDir = makeStorage();
      dirs.push(storageDir);
      setConfig({ revert: { enabled: true, storageDir } });

      // REAL store via detectAndCreate (GitBackend).
      const store = await detectAndCreate(repoDir, getConfig().revert);
      expect(store.describe().backend).toBe("git");

      // WIRE the store into the runtime BEFORE the capture hooks (they self-gate on rt.store).
      const sid = "s-dirtyguard";
      const rt = getRuntime(sid);
      rt.store = store;

      const { pi } = makePi();

      // The span contextEntries (ledger source). CRITICAL: the agent's mutation is a `python3 -c`
      // bash command — extractFileLedger parses the command STRING and classifies python3 as NOT a
      // FILE_MUTATING_COMMAND (src/ledger.ts:99-101) → modifiedFiles=[] / bashSideEffects=['python3
      // -c "open(...)..."']. This is the BUG-004 heuristic gap: the OLD affected set (modifiedFiles)
      // MISSES b.ts even though the agent wrote it. (The string is PARSED, not executed — no python3
      // binary needed.)
      const contextEntries = [
        msgEntry(user("rewrite b.ts via a script")),
        msgEntry(asstBash("p1", "python3 -c \"open('b.ts','w').write('agent-version')\"")),
        msgEntry(result("p1")),
        msgEntry(asst("final")),
        msgEntry(result("final")),
      ];
      const { ctx } = makeCtx({ sessionId: sid, contextEntries });

      // CAPTURE turn_start (REAL hook) → rt.snapshots.get("turn").beforeRef (b.ts='original\n').
      await turnStartCaptureHandler(
        { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
        ctx,
      );
      const turnCp = rt.snapshots?.get("turn") as RevertCheckpoint | undefined;
      expect(turnCp?.beforeRef).toBeTruthy();
      const beforeRef = turnCp!.beforeRef;

      // MUTATE b.ts (the agent's write — the effect of the recorded python3 command).
      writeFileSync(join(repoDir, "b.ts"), "agent-version\n");

      // CAPTURE agent_end (REAL hook) → sets turn checkpoint .afterRef in place (b.ts='agent-version\n').
      await agentEndCaptureHandler({ type: "agent_end", messages: [] }, ctx);
      expect(rt.snapshots?.get("turn")?.afterRef).toBeTruthy();
      const afterRef = (rt.snapshots?.get("turn") as RevertCheckpoint).afterRef!;

      // ── STORE-LEVEL MICRO-ASSERTIONS: prove the fix mechanics (old-vs-new contrast) ──
      // (1) NEW affected set: changedPaths(beforeRef) DETECTS b.ts (it differs from the pre-turn
      //     'original\n' snapshot). This is the set the FIXED rewind.ts:849 uses.
      const changed = await store.changedPaths(beforeRef);
      expect(changed).toContain("b.ts");

      // (2) OLD-behavior contrast: dirtyCheck(afterRef, []) EARLY-RETURNS [] (git.ts:433 empty-paths
      //     guard). This is EXACTLY what the OLD affectedPaths=modifiedFiles=[] produced → guard
      //     passed → restore clobbered the human edit (BUG-004).
      expect(await store.dirtyCheck(afterRef, [])).toEqual([]);

      // ── SIMULATE THE HUMAN EDIT (the E30 concurrent-edit drift) ──
      // b.ts now differs from BOTH beforeRef ('original') and afterRef ('agent-version').
      writeFileSync(join(repoDir, "b.ts"), "HUMAN-EDIT\n");

      // (3) NEW drift detection: dirtyCheck(afterRef, ['b.ts']) now returns ['b.ts'] — the current
      //     'HUMAN-EDIT\n' differs from the post-turn baseline 'agent-version\n'. This is what the
      //     FIXED guard sees → REFUSE.
      expect(await store.dirtyCheck(afterRef, ["b.ts"])).toContain("b.ts");

      // ── DRIVE THE REAL REWIND TOOL (end-to-end) ──
      const res = await run(
        pi,
        ctx,
        { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true },
        "final",
      );

      // ── END-TO-END ASSERTIONS ──
      const text = firstText(res);
      // (a) the file-revert is REFUSED with the spec/14 §6 step-3 clause (rewind.ts:931).
      expect(text).toContain("file revert refused: 1 path(s) changed since the turn ended");
      // (b) the rewind ITSELF succeeds (only the file-revert is refused; context rewind completes).
      expect(text).not.toContain("Mulligan: refused");
      // (c) E30 SATISFIED — the human edit is PRESERVED (restore was never called; b.ts untouched).
      expect(readFileSync(join(repoDir, "b.ts"), "utf8")).toBe("HUMAN-EDIT\n");
      // (d) optional marker/details check: revertRefused is true on this path (rewind.ts:230/930).
      //     Guard on details presence — the text + file assertions above are the robust primary checks.
      // (omit if RewindDetails shape is not reliably populated; the three assertions above are sufficient)
    });

  - VERIFY the test compiles + passes (see Validation Loop).

Task 2: VALIDATE (see Validation Loop) — confirm the new test passes + the full suite stays green +
  typecheck is clean + git diff is test-only.

Task 3 (OUT OF SCOPE — do NOT do): NO production code changes (rewind.ts/git.ts/store.ts/cas.ts/
  ledger.ts are all read-only for this item — S1 owns the rewind.ts edit; S1/S2/S3 own the store
  methods). NO new test file. NO new helpers. NO changes to the other revert-* integration tests.
  NO marker-schema changes. NO docs (test-only change).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the test mirrors F-revert-git's setup STRUCTURE exactly; only the mutation type + the
//   human edit + the assertions differ. Reuse every module-local helper. The skeleton:
//     repoDir = await makeRepo(prefix); dirs.push(repoDir);
//     writeFileSync(join(repoDir,"b.ts"), "original\n");
//     await git(repoDir, ["add","-A"]); await git(repoDir,["config",...]); await git(repoDir,["commit","-m","init"]);
//     storageDir = makeStorage(); dirs.push(storageDir);
//     setConfig({ revert: { enabled: true, storageDir } });
//     store = await detectAndCreate(repoDir, getConfig().revert);  // → GitBackend
//     rt = getRuntime(sid); rt.store = store;
//     { pi } = makePi();
//     contextEntries = [ user, asstBash(python3...), result, asst(final), result ];
//     { ctx } = makeCtx({ sessionId: sid, contextEntries });
//     await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()}, ctx);
//     ... mutate, capture agent_end, human edit, run() rewind, assert ...

// PATTERN — the store-level micro-assertions are the "proves the fix" heart of the test. They make
//   the old-vs-new contrast EXPLICIT and legible:
//     changedPaths(beforeRef) ⊇ ['b.ts']      // NEW: the snapshot diff detects the file (BUG-004 fix)
//     dirtyCheck(afterRef, []) === []          // OLD: empty affected set → guard passes → clobber
//     dirtyCheck(afterRef, ['b.ts']) ⊇ ['b.ts'] // NEW: with the real affected set, drift is caught
//   A reader sees exactly WHY the heuristic was wrong (modifiedFiles=[] misses python-written files)
//   and WHY changedPaths fixes it (it diffs the actual tree).

// PATTERN — the recorded bash command STRING (in contextEntries) and the writeFileSync mutation are
//   SEPARATE concerns: the string feeds extractFileLedger (produces modifiedFiles=[] /
//   bashSideEffects=['python3 -c ...']); the writeFileSync produces the real bytes the snapshot
//   captures. They must target the SAME file + content. Do NOT exec the python3 command for real
//   (no binary needed; keep the test hermetic).

// CRITICAL — why this test FAILS on old code + PASSES on new code (the "proves the fix" property):
//   OLD (pre-S1, affectedPaths = ledger.modifiedFiles = []):
//     dirtyCheck(afterRef, []) → git.ts:433 empty-paths early-return → [] → guard passes →
//     doRestore() → git restore reverts b.ts to 'original\n' → HUMAN-EDIT destroyed.
//     → text contains "Reverted 1 file(s)..." NOT the refuse clause; b.ts === 'original\n'. TEST FAILS.
//   NEW (post-S1, affectedPaths = await store.changedPaths(beforeRef) = ['b.ts']):
//     dirtyCheck(afterRef, ['b.ts']) → 'HUMAN-EDIT' ≠ 'agent-version' → ['b.ts'] → drifted.length>0 →
//     revertRefused=true; revertClause="file revert refused: 1 path(s) changed..."; doRestore SKIPPED.
//     → text contains the refuse clause; b.ts === 'HUMAN-EDIT\n'. TEST PASSES.
```

### Integration Points

```yaml
TEST SUITE (test/integration/revert-git.test.ts — existing `describe`):
  - change: "add ONE new `it(...)` sibling inside `describe('F-revert-* integration ...')`"
  - depends_on: "S1 (rewind.ts:849 swap — must be in tree for PASS), P1.M4.T1.S2 (GitBackend.
    changedPaths — Complete), P1.M1.T1.S1 (BUG-001 afterRef conditional — Complete)"
PRODUCTION CODE: UNCHANGED (read-only — src/tools/rewind.ts is S1's edit; src/snapshot/*.ts are
  S1/S2/S3's). git diff --name-only must show ONLY test/integration/revert-git.test.ts.
HELPERS: UNCHANGED (reuse makeRepo/makeStorage/setConfig/detectAndCreate/getRuntime/turnStartCapture
  Handler/agentEndCaptureHandler/makePi/makeCtx/run/firstText/asstBash/msgEntry/user/result/asst/
  VALID_NOTE/git/gitAvailable/dirs — all already module-local + imported).
LEDGER (src/ledger.ts): UNCHANGED (read-only — its FILE_MUTATING_COMMANDS classification is what
  makes `python3 -c` land in bashSideEffects; the test RELIES on this, it does not change it).
DATABASE / CONFIG / ROUTES / MARKERS: none (test-only).
TYPECHECK: expected_state "0 errors" (the new test uses only existing types: RevertCheckpoint from
  src/markers.js, the run()/firstText() helpers, store.changedPaths/dirtyCheck on SnapshotStore).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (the new test uses existing types; tsc --noEmit covers .test.ts).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.
# If you see TS2339 "Property 'changedPaths' does not exist on type 'SnapshotStore'" → S1/S2/S3 did
#   not land; verify `grep -n "changedPaths" src/snapshot/store.ts src/snapshot/git.ts`. If missing,
#   STOP — this item's dependencies are incomplete.
# If you see TS2532 "Object is possibly 'undefined'" on beforeRef/afterRef → the non-null assertions
#   (`turnCp!.beforeRef`, `(...).afterRef!`) are guarded by the preceding `expect(...).toBeTruthy()`
#   but tsc can't see through expect(); use the `!` non-null assertion (the existing tests do this) OR
#   narrow with an `if (!turnCp?.beforeRef) throw new Error(...)` guard.

# Lint (if the project lints test files — check package.json scripts; mirror what siblings use).
# The existing revert-git.test.ts already passes lint, so an identically-structured new `it()` will too.

# Confirm the change is test-only:
git diff --name-only
# EXPECTED: exactly `test/integration/revert-git.test.ts`. If src/tools/rewind.ts or any src/ file
#   appears, STOP — you are out of scope (S1 owns production; this item is test-only).
```

### Level 2: Unit + Integration Tests (Component Validation)

```bash
# Run the target suite — the new test + all existing F-revert-* tests in this file.
npx vitest run test/integration/revert-git.test.ts -t "F-revert-dirtyguard"
# Expected: the new test PASSES (on the S1-fixed code). If it FAILS with b.ts==='original\n' (clobber)
#   and the text lacks the refuse clause → S1's rewind.ts:849 swap is NOT in the tree (still
#   `ledger.modifiedFiles`); verify `grep -n "affectedPaths = " src/tools/rewind.ts`. If it shows
#   `ledger.modifiedFiles`, S1 must land first.

# Run the FULL revert-git suite (no regression in the sibling F-revert-git/failopen/delete tests):
npx vitest run test/integration/revert-git.test.ts
# Expected: ALL green (4 tests now: the 3 existing + the 1 new).

# Run the full revert-* integration suite (the cas/edge/explicit siblings must stay green — this
# item touches only revert-git.test.ts, but confirm no cross-file coupling):
npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-edge.test.ts test/integration/revert-explicit.test.ts
# Expected: green.

# Full suite — no behavioral regression anywhere (this is a pure test addition; production unchanged):
npm test
# Expected: all green (the new test is +1 to the count).
```

### Level 3: Integration Testing (System Validation)

```bash
# The vitest run in Level 2 IS the system validation (it drives the REAL git repo + REAL GitBackend +
# REAL capture hooks + REAL makeRewindTool end-to-end). No separate system test is needed.

# OPTIONAL manual sanity (proves the old-vs-new contrast by hand) — run the new test against a
# temporarily-reverted rewind.ts:849 to confirm it FAILS (then restore S1's line). This is the
# "proves the fix" property made executable:
#   1. git stash src/tools/rewind.ts to its pre-S1 state (affectedPaths = ledger.modifiedFiles)
#   2. npx vitest run test/integration/revert-git.test.ts -t "F-revert-dirtyguard"   # EXPECTED: FAIL
#   3. git stash pop  # restore S1's changedPaths line
#   4. npx vitest run test/integration/revert-git.test.ts -t "F-revert-dirtyguard"   # EXPECTED: PASS
# (This manual step is OPTIONAL verification, not a required gate — the store-level micro-assertions
#  already document the contrast inline.)
```

### Level 4: Domain-Specific Validation (correctness reasoning — the E30 closure proof)

```bash
# Reasoning check (no command — this is the invariant the test codifies):
#   AGENT writes b.ts via `python3 -c "open('b.ts','w').write('agent-version')"` → ledger:
#     modifiedFiles=[] (python3 ∉ FILE_MUTATING_COMMANDS), bashSideEffects=['python3 -c ...'].
#   HUMAN edits b.ts='HUMAN-EDIT\n' post-agent_end (the E30 concurrent-edit drift).
#   last_turn rewind with revert_file_changes:true:
#     BEFORE S1: affectedPaths = ledger.modifiedFiles = [] → dirtyCheck(afterRef, []) = [] →
#       PROCEED → restore reverts b.ts to 'original\n' → HUMAN-EDIT DESTROYED (BUG-004 / E30 violation).
#     AFTER  S1: affectedPaths = store.changedPaths(beforeRef) = ['b.ts'] → dirtyCheck(afterRef,
#       ['b.ts']) = ['b.ts'] (HUMAN-EDIT ≠ agent-version) → REFUSE → b.ts stays 'HUMAN-EDIT\n'
#       (E30 SATISFIED). Context rewind still completes (not a tool-level refusal).
#   The test asserts the AFTER state + documents the BEFORE state via the store-level micro-assertions.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`: 0 errors (new test uses existing types + `!` non-null assertions guarded by
      `expect(...).toBeTruthy()`).
- [ ] `npx vitest run test/integration/revert-git.test.ts -t "F-revert-dirtyguard"`: the new test PASSES.
- [ ] `npx vitest run test/integration/revert-git.test.ts`: ALL green (3 existing + 1 new).
- [ ] `npm test`: full suite green (no regression).
- [ ] `git diff --name-only` shows ONLY `test/integration/revert-git.test.ts`.

### Feature Validation

- [ ] The new test is gated by `if (!(await gitAvailable())) { skip }` (consistent with siblings).
- [ ] The new test pushes `repoDir` + `storageDir` onto `dirs[]` (cleanup correctness).
- [ ] The `contextEntries` use `asstBash("p1", "python3 -c ...")` (NOT sed/cp/mv/tee/redirect — those
      parse into modifiedFiles and would NOT reproduce the gap).
- [ ] The granularity is `"last_turn"` (so afterRef exists and the dirty guard RUNS).
- [ ] The store-level micro-assertions are present and correct:
      `changedPaths(beforeRef)` ⊇ `['b.ts']`; `dirtyCheck(afterRef, [])` === `[]`;
      `dirtyCheck(afterRef, ['b.ts'])` ⊇ `['b.ts']` (after the human edit).
- [ ] The end-to-end assertions are present and correct: text contains "file revert refused: 1
      path(s) changed since the turn ended"; text does NOT contain "Mulligan: refused";
      `readFileSync(b.ts)` === `"HUMAN-EDIT\n"`.

### Code Quality Validation

- [ ] The test mirrors the F-revert-git scenario structure (same helper usage, same ordering, same
      comment density/style with spec cites).
- [ ] No new helpers, no new imports, no new files, no new `describe`.
- [ ] The human-edit content (`'HUMAN-EDIT\n'`) is distinct from both beforeRef (`'original\n'`) and
      afterRef (`'agent-version\n'`) content (unambiguous drift + unambiguous preservation).
- [ ] Comments explain the BUG-004 heuristic gap + the old-vs-new contrast (a future reader
      understands WHY python3 is used and WHY changedPaths is the fix).

### Documentation & Deployment

- [ ] No docs (test-only change — the item description explicitly states "DOCS: none").
- [ ] No env vars / config / migrations / API-surface change.

---

## Anti-Patterns to Avoid

- ❌ **Don't use `sed`/`cp`/`mv`/`tee`/a `> file` redirect as the recorded bash command.** Those ARE
  in `FILE_MUTATING_COMMANDS` (src/ledger.ts:101) → `extractFileLedger` parses their path into
  `modifiedFiles` → the OLD code's affected set would INCLUDE b.ts → the guard would catch the drift
  EVEN ON THE OLD CODE → the test would pass on both old and new (it would NOT prove the fix). Use
  `python3 -c` / `node -e` / `perl -e` / `awk -i inplace` — all intentionally absent from that set
  (ledger.ts:99-100) → `modifiedFiles=[]` → reproduces the heuristic gap.
- ❌ **Don't actually execute the python3 command.** `extractFileLedger` parses the recorded command
  STRING; it never runs it. Use `writeFileSync(b.ts, "agent-version\n")` for the real mutation (this
  also avoids a python3-binary dependency — the test is hermetic + cross-platform). The recorded
  string + the writeFileSync must target the same file + content.
- ❌ **Don't use `checkpoint` granularity.** Checkpoints capture ONCE (no afterRef) → the BUG-001
  conditional (rewind.ts:908) takes the `else` branch → the dirty guard is SKIPPED → the refuse path
  is never reached → the test cannot assert refusal. Use `last_turn` (turns have afterRef → guard runs).
- ❌ **Don't assert "Mulligan: refused".** That prefix is for HARD tool-level refusals (e.g. crossing
  the first user message). The dirty-guard refuse is a SOFT refuse: the rewind SUCCEEDS, only the
  file-revert is refused, and the clause "(file revert refused: N path(s) changed...)" is appended to
  the SUCCESS text (rewind.ts:288/931). Assert the clause substring + assert `not.toContain("Mulligan:
  refused")`.
- ❌ **Don't set the human edit to 'original\n'.** That would match beforeRef → the "preserved"
  assertion (`b.ts === 'HUMAN-EDIT\n'`) would be impossible and changedPaths/dirtyCheck results would
  be ambiguous. Use 'HUMAN-EDIT\n' (distinct from both 'original\n' and 'agent-version\n').
- ❌ **Don't edit production code.** This item is TEST-ONLY. `git diff --name-only` must show only
  `test/integration/revert-git.test.ts`. rewind.ts is S1's edit; git.ts/store.ts/cas.ts are S1/S2/S3's;
  ledger.ts is read-only. If you find yourself "fixing" production code to make the test pass, STOP —
  that's S1's job (and S1 must land first).
- ❌ **Don't add a new test file or new helpers.** The existing `test/integration/revert-git.test.ts`
  already has every helper you need (module-local). Add ONE `it()` to the existing `describe`.
- ❌ **Don't drop the store-level micro-assertions.** They are the "proves the fix" heart: they make
  the old-vs-new contrast (`dirtyCheck(afterRef, []) === []` vs `dirtyCheck(afterRef, ['b.ts']) ⊇
  ['b.ts']`) explicit and legible. Without them the test is just another green check; with them it
  DOCUMENTS why the heuristic was wrong and why changedPaths fixes it.
- ❌ **Don't forget `dirs.push(repoDir)` + `dirs.push(storageDir)`.** The test creates real temp git
  repos + storage dirs; the module-level `afterEach` chmod-restores + rm's every entry in `dirs[]`.
  Omitting the push leaks temp dirs (and on CI can exhaust the temp partition).

---

## Confidence Score

**9/10** — This is a single new integration test added to an existing, heavily-scaffolded suite,
where: (a) EVERY helper it needs is already module-local and battle-tested by the sibling F-revert-*
tests (the new `it()` is a structural clone of F-revert-git with a different mutation type + a human
edit + refuse assertions); (b) the exact APIs it exercises (`store.changedPaths`,
`store.dirtyCheck`, the REAL capture hooks, `makeRewindTool` via `run()`) are all already landed and
verified (git.ts:490/426, capture.ts, rewind.ts); (c) the exact refuse-clause text to assert is
known verbatim (rewind.ts:931); (d) the ledger classification that makes `python3 -c` land in
`bashSideEffects` (not `modifiedFiles`) is verified (src/ledger.ts:99-101 + ledger.test.ts), and
critically the ledger parses the command STRING (not executes it), so NO python3 binary is needed —
the test is hermetic; (e) the test is gated by `gitAvailable()` like its siblings. The one dependency
risk is ordering: the test PASSES only once S1's `rewind.ts:849` swap is in the tree (before that it
FAILS — which is the intended "proves the fix" property, but means S1 must merge first). The remaining
1 point is residual risk around the `RewindDetails` shape (whether `details.revertRefused` is reliably
populated) — mitigated by making the text + file-content assertions the PRIMARY checks and the
details/marker check optional/guarded.