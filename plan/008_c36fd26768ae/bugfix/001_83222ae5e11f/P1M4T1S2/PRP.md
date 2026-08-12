---
name: "P1.M4.T1.S2 — Implement changedPaths in GitBackend (git diff --name-only) (BUG-004 git slice)"
description: "Implement the `changedPaths(beforeRef: string): Promise<string[]>` method on `GitBackend` in src/snapshot/git.ts. It runs `git diff --name-only <beforeRef>` via `shadowEnv()` (commit-tree vs current working tree — NO path filter, NO `--diff-filter`) to return the spec-mandated affected set for the dirty guard (spec/14 §6 step 2), mirrors `dirtyCheck`'s exact try/catch/finally/mutex + best-effort structure, is mutex-serialized, and resolves the `GitBackend` 'missing changedPaths' typecheck error produced by P1.M4.T1.S1. NO CasBackend (S3), NO rewind wiring (P1.M4.T2.S1). Mode A (method + JSDoc only)."
---

## Goal

**Feature Goal**: Implement the **GitBackend** half of the BUG-004 contract method `changedPaths(beforeRef)`.
`GitBackend.changedPaths` returns the **workspace-relative POSIX paths that differ between the
`beforeRef` snapshot and the CURRENT working tree** — exactly the set `restore()` would touch — by
running a single `git diff --name-only <beforeRef>` against the **shadow repo** (via `shadowEnv()`).
This is the **spec-mandated affected set** for the dirty guard (spec/14 §6 step 2, BUG-004). It is the
git-backend slice of milestone P1.M4.T1; it consumes the interface method that P1.M4.T1.S1 just
declared and resolves the resulting `GitBackend` typecheck failure.

**Deliverable**: `src/snapshot/git.ts` MODIFIED — add ONE method `async changedPaths(beforeRef: string):
Promise<string[]>` to the `GitBackend` class (placed immediately after `dirtyCheck()`, before `has()`),
with dense JSDoc citing spec/14 §6 step 2 + BUG-004, mirroring `dirtyCheck`'s exact
try/catch/finally/mutex structure. PLUS matching unit tests in `test/git.test.ts` (new
`describe("GitBackend.changedPaths …")` block mirroring the existing `dirtyCheck` test block).

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`): the **GitBackend** `src/snapshot/git.ts` "Property 'changedPaths'
  is missing" error (produced by S1) is now **GONE**. The **CasBackend** `src/snapshot/cas.ts` equivalent
  error **REMAINS** (it is S3's job — P1.M4.T1.S3). **Exactly ONE** typecheck error remains, and it is the
  `cas.ts` one. No OTHER typecheck errors anywhere.
- `npx vitest run test/git.test.ts`: green, including the new `GitBackend.changedPaths` describe block.
- `npm test` (full suite): green (no behavioral regression — `changedPaths` is not yet called by production
  code; the rewind wiring is P1.M4.T2.S1).

## Why

- **Closes the git-backend half of the BUG-004 contract gap**: the rewind tool's dirty guard currently
  uses `affectedPaths = ledger.modifiedFiles` (src/tools/rewind.ts:849), a HEURISTIC extraction that
  MISSES files mutated via `python -c`, `node script.js`, `perl -i`, heredocs, `awk -i inplace`, etc.
  (they land in `ledger.bashSideEffects`, not `modifiedFiles`). `restore()` reverts EVERY file differing
  from beforeRef (`git diff --name-only --diff-filter=MD` after read-tree), so the guard inspects a SUBSET
  of what restore touches → concurrent human edits to bash/python/perl-written files are silently clobbered
  (E30 violation). The fix requires the STORE to compute the real affected set. This item implements the
  **git** algorithm (`git diff --name-only <beforeRef>`); the cas algorithm is S3; the rewind wiring is
  P1.M4.T2.S1.
- **Resolves the S1 handoff**: P1.M4.T1.S1 widened the `SnapshotStore` interface with `changedPaths`,
  which made `GitBackend implements SnapshotStore` typecheck-fail (expected). S2 fulfills the contract
  on GitBackend so the git backend is again type-clean. (CasBackend remains failing by design until S3.)
- **No behavior change in this slice**: `changedPaths` is added to the class but NOT yet called by any
  production code path (rewind.ts still uses `ledger.modifiedFiles` until P1.M4.T2.S1). Zero runtime risk
  to existing users; the method simply exists + is unit-tested.

## What

One surgical insertion of a method (with JSDoc) into `src/snapshot/git.ts`, immediately after
`dirtyCheck()` and before `has()`, mirroring `dirtyCheck`'s structure verbatim. Plus a new
`describe("GitBackend.changedPaths …")` test block in `test/git.test.ts` mirroring the existing
`describe("GitBackend.dirtyCheck …")` block. No data-model change, no new exports, no config, no
API-surface change beyond the added class method.

### Success Criteria

- [ ] `GitBackend` has `async changedPaths(beforeRef: string): Promise<string[]>` placed after
      `dirtyCheck()` and before `has()`, with JSDoc covering all required points (see Task 1).
- [ ] The method issues EXACTLY `["diff", "--name-only", beforeRef]` via `this.shadowEnv()` — **no**
      `--diff-filter` and **no** `--`/pathspec tail.
- [ ] The method mirrors `dirtyCheck`'s structure exactly: `mutex.acquire()` → `try { ensureInit();
      early-return guard; exec; split/trim/filter }` → `catch { warn; return [] }` → `finally { release() }`.
- [ ] `npm run typecheck`: EXACTLY ONE error remains (the `cas.ts` "missing changedPaths"); the
      `git.ts` error is gone. No other errors.
- [ ] `test/git.test.ts` has a new `GitBackend.changedPaths` describe block (≥5 tests) — all pass.
- [ ] `npm test` fully green.
- [ ] NO changes to `store.ts`, `cas.ts`, `rewind.ts`, `RestoreOpts`, `RestoreResult`, `AsyncMutex`,
      `detectAndCreate`, markers, or config. NO new exported types.

## All Needed Context

### Context Completeness Check

_Passed_: an engineer with zero prior knowledge of this repo can implement this from (a) the verbatim
`dirtyCheck` method to clone (quoted below), (b) the exact 3-way diff table (argv / path scope /
diff-filter) that distinguishes changedPaths from dirtyCheck, (c) the verbatim git-diff-docs semantics
confirming `git diff <commit>` = commit-tree-vs-working-tree, (d) the verbatim test-block pattern to
mirror, and (e) the precise typecheck outcome (ONE error remaining = cas.ts). The single non-obvious
trap — that adding `--diff-filter=MD` would RE-INTRODUCE the bug by missing span-created files — is
called out repeatedly below.

### Documentation & References

```yaml
# MUST READ — the spec the new method's JSDoc + behavior cites
- url: spec/14-working-tree-revert.md (§3 GitBackend + five git-safety guarantees; §4.3 AsyncMutex
    serialization; §6 step 2 the affected-set definition — VERBATIM)
  why: §6 step 2 VERBATIM defines the affected set the method must return:
    "**Determine the affected set** = paths that differ between `beforeRef` and the current tree
    (the files restore would touch)."
  critical: §4.3 mandates every IO-bearing store op is AsyncMutex-serialized → changedPaths MUST
    acquire this.mutex. §3 guarantees the ONLY command against the user repo is read-only rev-parse;
    changedPaths's `git diff` MUST go through shadowEnv() (GIT_DIR=shadowDir) — never the source repo.

# MUST READ — authoritative git-diff semantics (cited in the method's JSDoc)
- url: https://git-scm.com/docs/git-diff  (section "git diff [<options>] <commit> [--] [<path>…<path>]")
  why: Confirms `git diff <commit>` (single commit arg) = "view the changes you have in your working
    tree relative to the named <commit>" i.e. compares the COMMIT'S TREE against the WORKING TREE,
    WITHOUT consulting the index → robust to a polluted shadow index (e.g. a prior restore()'s read-tree).
  critical: Default `--diff-filter` includes Added/Deleted/Modified (+Rename/Copy). Do NOT add
    `--diff-filter=MD` — that would MISS span-created (Added) files, re-introducing the BUG-004
    under-coverage. No filter = full coverage of what restore touches.

- file: src/snapshot/git.ts
  why: THE file to edit. Contains the `GitBackend` class. `dirtyCheck()` (~the method after
    `shadowEnv()`) is the EXACT structural pattern to clone (mutex/try/catch/finally/shadowEnv/
    split-trim-filter). `shadowEnv()` is the env helper to reuse. `ensureInit()` is the init guard to
    call first inside the try.
  pattern: Clone `dirtyCheck` and make the 3 changes in the diff table below. Place the new method
    IMMEDIATELY AFTER `dirtyCheck()` and BEFORE `has()`.
  gotcha: Adding the method resolves the S1-produced `git.ts` "missing changedPaths" typecheck error —
    that is the success signal. The `cas.ts` error REMAINS (S3's job); do NOT touch cas.ts.

- file: src/snapshot/store.ts
  why: The CONTRACT (produced by P1.M4.T1.S1). Read ONLY to confirm the exact interface signature
    `changedPaths(beforeRef: string): Promise<string[]>` + the NoOpStore stub style. Do NOT edit
    store.ts in this item.
  pattern: The GitBackend implementation must match this signature EXACTLY (async, single string
    param, Promise<string[]> return).

- file: test/git.test.ts
  why: THE test file to extend. The `describe("GitBackend.dirtyCheck — spec/14 §3/§6")` block is the
    EXACT pattern to clone for a new `describe("GitBackend.changedPaths …")` block. Helpers to reuse:
    `makeBackend(calls, cfg, scan, canned)`, `findCmd(calls, cmd)`, `expectedShadow(storageDir)`,
    `BASE_CFG`, `emptyScan`, and the `ExecCanned` shape (`stdoutByCmd` keys by `args[0]`; `throwOn`
    simulates a non-zero exit).
  pattern: `makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\nb.ts\n" } })` then
    assert on `findCmd(calls, "diff")`. Both dirtyCheck and changedPaths emit `args[0]==="diff"`, so the
    same `stdoutByCmd.diff` key drives both. Mirror the dirtyCheck tests: argv assertion, empty-input
    early-return, never-rejects-on-error (via `throwOn`).
  gotcha: For changedPaths, the argv assertion is `["diff", "--name-only", "BEFORE1"]` (NO `--`, NO
    paths, NO `--diff-filter`). Add explicit `not.toContain("--diff-filter")` + `not.toContain("--")`
    assertions — these are the CRITICAL correctness guards (they pin that the method does NOT
    accidentally narrow the affected set).

- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md (§BUG-004)
  why: Confirms the git algorithm: "GitBackend: `git diff --name-only <beforeRef>` against the current
    working tree (shadow repo)" and that restore touches the broader set (`--diff-filter=MD` after
    read-tree) — so the affected set must be the UNFILTERED diff.
  critical: Lists Exact Change Site #2 = "src/snapshot/git.ts — implement: `git diff --name-only
    <beforeRef>` (shadowEnv, mutex-serialized)". This item does exactly that and nothing more.

- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/codebase_patterns.md (§2 mutex,
    §3 best-effort, §5 shadow-env, §8 test, §10 comment style)
  why: §2 is the verbatim mutex pattern (acquire/try/catch-best-effort-default/finally-release —
    GOTCHA #5 forgotten release deadlocks). §3 is best-effort fail-open (never reject → []).
    §5 is shadowEnv (every write carries GIT_DIR=shadowDir + GIT_WORK_TREE=repoRoot). §8 is the test
    convention (vitest, DI exec fake). §10 is the dense JSDoc/comment style to match.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts          # SnapshotStore interface + NoOpStore (DONE by S1 — DO NOT EDIT)
  git.ts            # ← EDIT: add GitBackend.changedPaths (PRIMARY deliverable)
  cas.ts            # CasBackend (unchanged → EXPECTED typecheck failure remains until S3)
src/tools/
  rewind.ts         # FUTURE consumer (line 849) — NOT edited here (P1.M4.T2.S1)
test/
  git.test.ts       # ← EDIT: add GitBackend.changedPaths describe block
```

### Desired Codebase tree with files to be added/changed

```bash
src/snapshot/
  git.ts            # MODIFIED — +changedPaths method (after dirtyCheck, before has) + JSDoc
test/
  git.test.ts       # MODIFIED — +describe("GitBackend.changedPaths …") block (≥5 tests)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — do NOT add `--diff-filter=MD`. That filter is restore()'s index-vs-worktree step AFTER
//   read-tree (git.ts restore step b), where the shadow index === beforeRef so MD = modified/deleted
//   vs beforeRef. For changedPaths (a standalone beforeRef-vs-worktree query) it would MISS span-created
//   (Added) files — created files are deleted by restore (step c) but would NEVER be inspected by the
//   dirty guard. That re-introduces the EXACT BUG-004 under-coverage gap this method exists to close.
//   The default (no) filter includes A/D/M/R/C → full coverage. Use `git diff --name-only <beforeRef>`.

// CRITICAL — do NOT add a `--` separator. `--` is only needed to disambiguate pathspecs from revisions.
//   changedPaths passes NO paths, so `["diff", "--name-only", beforeRef]` is the minimal correct form.
//   (dirtyCheck adds `--` because it follows with caller-supplied paths; changedPaths has none.)

// CRITICAL — `git diff <commit>` does NOT consult the index. With GIT_DIR=shadowDir + GIT_WORK_TREE=
//   repoRoot (shadowEnv), it compares the beforeRef COMMIT'S TREE against the repoRoot WORKING TREE.
//   This is robust to a polluted shadow index — e.g. if a prior restore() ran `read-tree` (which loads
//   beforeRef into the shadow index), changedPaths is unaffected because it diffs the COMMIT, not the
//   index. (Confirmed: https://git-scm.com/docs/git-diff — "changes you have in your working tree
//   relative to the named <commit>".)

// CRITICAL — the method MUST be async (Promise<string[]>) and MUST acquire this.mutex (spec §4.3 —
//   every IO-bearing store op is serialized). Mirror dirtyCheck's `const release = await
//   this.mutex.acquire();` … `finally { release(); }`. Forgetting release() (GOTCHA #5) deadlocks all
//   later acquire()s.

// CRITICAL — BEST-EFFORT (E27): the method MUST NEVER reject. Any git error (bad beforeRef → git exits
//   128, exec failure) → caught → `console.warn(...)` → `return []`. The JSDoc must state this. (Mirrors
//   dirtyCheck's "any git error ⇒ []" + restore()'s "NEVER throws" + gc()'s "NEVER rejects".)

// CONVENTION — the early-return guard mirrors dirtyCheck's `if (!afterRef || paths.length === 0) return
//   []`. changedPaths has no paths param, so the guard is `if (!beforeRef) return [];` (no baseline ⇒ no
//   changed paths; also avoids a wasted exec on an empty ref). Place it AFTER ensureInit() (dirtyCheck
//   orders ensureInit first, then the guard).

// CONVENTION — warn message format mirrors dirtyCheck's:
//   `[mulligan] snapshot.changedPaths failed: ${err instanceof Error ? err.message : String(err)}`.
//   (dirtyCheck uses `[mulligan] snapshot.dirtyCheck failed: …`.)

// CONVENTION — return processing is the SAME one-liner dirtyCheck uses:
//   `out.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);`

// CONVENTION — JSDoc density matches dirtyCheck/restore (multi-line block: what it returns + spec cite
//   with verbatim quote + algorithm + consumer + best-effort). End with "IMPLEMENTED BY: git/cas."
//   (matching the interface method's footer from S1).

// HANDOFF — after this item, `npm run typecheck` shows EXACTLY ONE error (cas.ts "missing changedPaths").
//   That remaining error is the EXPECTED handoff to S3 (P1.M4.T1.S3). Do NOT edit cas.ts to clear it.
```

## Implementation Blueprint

### Data models and structure

No data models. No new types. The only structural change is adding ONE method to an existing class.
The method's signature (which MUST match the interface declared by S1 verbatim):

```typescript
async changedPaths(beforeRef: string): Promise<string[]>;
```

Semantics (encode in JSDoc): returns workspace-relative POSIX paths that differ between the `beforeRef`
snapshot (a shadow-repo commit SHA from `capture()`) and the CURRENT working tree — exactly the set
`restore()` would touch (spec/14 §6 step 2). git algorithm: `git diff --name-only <beforeRef>` via
`shadowEnv()` (GIT_DIR=shadowDir + GIT_WORK_TREE=repoRoot); single-commit-arg `git diff` compares the
commit's tree against the working tree without consulting the index; default diff-filter includes
Added/Deleted/Modified → full coverage. Consumed by rewindExecute step 6b (P1.M4.T2.S1) to replace the
heuristic `ledger.modifiedFiles`. Best-effort: never rejects — returns `[]` on any error.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD changedPaths to GitBackend (src/snapshot/git.ts)
  - FIND: the `dirtyCheck(...)` method (immediately after `shadowEnv()`, before `has()`). Insert the new
    method IMMEDIATELY AFTER dirtyCheck's closing brace and BEFORE the `has()` JSDoc. (Mirrors the
    interface placement from S1 — "after dirtyCheck, before restore" — and groups the two diff-based
    query methods.)
  - IMPLEMENT the method body by CLONING dirtyCheck and applying the 3 changes in the table below.
      dirtyCheck:                                  changedPaths:
      argv:     ["diff","--name-only",afterRef,    ["diff","--name-only",beforeRef]   # NO "--", NO paths
                 "--", ...paths]
      guard:    if (!afterRef || paths.length===0) if (!beforeRef) return [];          # no paths param
                 return [];
      ref:      afterRef                           beforeRef
      (diff-filter: NONE in both — do NOT add --diff-filter=MD)
  - WRITE the method:
      async changedPaths(beforeRef: string): Promise<string[]> {
        const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
        try {
          await this.ensureInit();
          if (!beforeRef) return []; // no baseline ⇒ no changed paths (mirrors dirtyCheck's empty-ref guard)
          const out = await this.exec(
            "git",
            ["diff", "--name-only", beforeRef],
            this.shadowEnv(),
          );
          return out.stdout
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } catch (err) {
          // E27 best-effort: any git error ⇒ [] (no changed paths detected). Never rejects.
          console.warn(
            `[mulligan] snapshot.changedPaths failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        } finally {
          release();
        }
      }
  - WRITE JSDoc immediately above the method (mirror dirtyCheck/restore density). The JSDoc MUST cover:
      1. Return: workspace-relative POSIX paths that differ between the beforeRef snapshot and the
         CURRENT working tree — the files restore() would touch.
      2. Spec mandate: quote spec/14 §6 step 2 VERBATIM — "paths that differ between beforeRef and the
         current tree (the files restore would touch)". Reference BUG-004.
      3. git algorithm: `git diff --name-only <beforeRef>` via shadowEnv(); single-commit-arg git diff
         compares the commit's tree vs the working tree (NOT the index) — robust to a prior restore()'s
         read-tree. State that NO --diff-filter is applied (default includes A/D/M) and WHY (do NOT use
         --diff-filter=MD — it would miss span-created files, re-introducing BUG-004). NO path filter.
      4. Consumer: rewindExecute step 6b (the BUG-004 fix, P1.M4.T2.S1) — replaces the heuristic
         ledger.modifiedFiles so the dirty guard inspects EVERY file restore would touch (closes the E30
         gap for bash/python/perl/heredoc-modified files absent from modifiedFiles).
      5. Best-effort + serialization: NEVER rejects — any git error (bad beforeRef, exec failure) is
         caught, warned, returns [] (the dirty guard's own refuse/allow decision is the caller's).
         Serialized by the per-backend AsyncMutex (spec §4.3).
      End the JSDoc with "IMPLEMENTED BY: git/cas." (matching the interface method footer).
  - NAMING: `changedPaths` (camelCase, matches the work-item + interface VERBATIM). Param `beforeRef`.
  - PRESERVE: every other GitBackend method (capture/shadowEnv/dirtyCheck/has/retire/destroy/gc/restore),
    all private fields, the constructor, and all helper functions (refForLabel/shadowKey/scanForCaps).
  - DO NOT edit store.ts, cas.ts, or rewind.ts in this task.

Task 2: ADD the GitBackend.changedPaths unit-test block (test/git.test.ts)
  - FIND: the `describe("GitBackend.dirtyCheck — spec/14 §3/§6", () => { ... })` block. Add a NEW
    `describe("GitBackend.changedPaths — spec/14 §6 step 2 / BUG-004", () => { ... })` block IMMEDIATELY
    AFTER it (topical grouping with its sibling diff query). Reuse the existing helpers: `makeBackend`,
    `findCmd`, `expectedShadow`, `BASE_CFG`, `emptyScan`, `Call` type.
  - IMPLEMENT these tests (mirror the dirtyCheck block's shape):
      1. it("issues `git diff --name-only <beforeRef>` (NO --, NO paths, NO --diff-filter) with
         env.GIT_DIR===shadow"):
            const calls: Call[] = [];
            const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\nb.ts\n" } });
            const changed = await gb.changedPaths("BEFORE1");
            expect(changed).toEqual(["a.ts", "b.ts"]);
            const diff = findCmd(calls, "diff")!;
            expect(diff.args).toEqual(["diff", "--name-only", "BEFORE1"]);
            expect(diff.args).not.toContain("--diff-filter"); // CRITICAL: full A/D/M coverage, not just MD
            expect(diff.args).not.toContain("--");             // CRITICAL: no path filter (unlike dirtyCheck)
            expect(diff.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
            expect(diff.opts?.env?.GIT_WORK_TREE).toBe("/fake/repo");
      2. it("returns [] when beforeRef is empty (no diff issued)"):
            const calls: Call[] = [];
            const gb = makeBackend(calls);
            await expect(gb.changedPaths("")).resolves.toEqual([]);
            expect(findCmd(calls, "diff")).toBeUndefined();
      3. it("trims + drops blank stdout lines"):
            const calls: Call[] = [];
            const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: " a.ts \n\nb.ts\n  \n" } });
            expect(await gb.changedPaths("BEFORE1")).toEqual(["a.ts", "b.ts"]);
      4. it("never rejects on a git error (warn + [])"):
            const calls: Call[] = [];
            const gb = makeBackend(calls, BASE_CFG, emptyScan, { throwOn: { cmd: "diff", call: 1 } });
            await expect(gb.changedPaths("BEFORE1")).resolves.toEqual([]); // NOT a rejection
      5. it("acquires the mutex (two concurrent both complete — §4.3)"):
            const calls: Call[] = [];
            const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
            await Promise.all([gb.changedPaths("B1"), gb.changedPaths("B2")]); // must not hang
            expect(calls.filter((c) => c.args[0] === "diff")).toHaveLength(2);
  - WHY each test matters:
      - #1 pins the EXACT argv (the two `not.toContain` assertions are the BUG-004 correctness guards —
        they prevent a future refactor from accidentally re-adding `--diff-filter=MD` or a path filter).
      - #2 mirrors dirtyCheck's empty-input early-return.
      - #3 pins the split/trim/filter return processing (a trailing newline / blank line must not yield
        a spurious "" entry).
      - #4 pins the E27 best-effort never-rejects contract.
      - #5 is a mutex smoke (mirrors the gc() "acquires the mutex" test) — two concurrent calls must
        both complete (no deadlock from a forgotten release()).
  - NAMING: `describe("GitBackend.changedPaths — spec/14 §6 step 2 / BUG-004")`. `it(...)` titles as above.
  - DO NOT add an integration test here (the E30 bash/python dirty-guard integration test is
    P1.M4.T2.S2 — it requires the rewind wiring which is not present yet).

Task 3: VALIDATE (see Validation Loop) — confirm the EXACT expected typecheck + test outcome.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN A — the sibling method to clone VERBATIM (existing dirtyCheck in src/snapshot/git.ts):
async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
  const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
  try {
    await this.ensureInit();
    if (!afterRef || paths.length === 0) return []; // no drift baseline / nothing to check ⇒ allow
    const out = await this.exec(
      "git",
      ["diff", "--name-only", afterRef, "--", ...paths.filter((p) => p.length > 0)],
      this.shadowEnv(),
    );
    return out.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  } catch (err) {
    // E27 best-effort: any git error ⇒ [] (no drift detected ⇒ allow restore). Never rejects.
    console.warn(`[mulligan] snapshot.dirtyCheck failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    release();
  }
}
// → changedPaths clones this and makes ONLY: argv drops `--` + paths; guard drops the paths-length
//   half; afterRef → beforeRef. Everything else (mutex/try/catch/finally/shadowEnv/ensureInit/
//   split-trim-filter/warn-format) is IDENTICAL.

// PATTERN B — the env helper to reuse VERBATIM (existing private shadowEnv in src/snapshot/git.ts):
private shadowEnv(): { env: NodeJS.ProcessEnv; maxBuffer: number } {
  return {
    env: { ...process.env, GIT_DIR: this.shadowDir, GIT_WORK_TREE: this.repoRoot },
    maxBuffer: 16 * 1024 * 1024,
  };
}
// → changedPaths passes this.shadowEnv() as the 3rd arg to this.exec (identical to dirtyCheck).
//   GIT_DIR=shadowDir → the diff reads the shadow object DB (where capture() wrote beforeRef).
//   GIT_WORK_TREE=repoRoot → the diff's "working tree" is the user's repo. Guarantees #1/#2.

// PATTERN C — the test block to clone (existing dirtyCheck tests in test/git.test.ts), with the
// 3 changedPaths-specific changes (argv = NO "--" + NO paths; + two not.toContain correctness guards):
it("issues `git diff --name-only <afterRef> -- <paths>` with env.GIT_DIR===shadow", async () => {
  const calls: Call[] = [];
  const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\nb.ts\n" } });
  const drifted = await gb.dirtyCheck("AFTER1", ["a.ts", "b.ts", "c.ts"]);
  expect(drifted).toEqual(["a.ts", "b.ts"]);
  const diff = findCmd(calls, "diff")!;
  expect(diff.args).toEqual(["diff", "--name-only", "AFTER1", "--", "a.ts", "b.ts", "c.ts"]);
  expect(diff.opts?.env?.GIT_DIR).toBe(expectedShadow(BASE_CFG.storageDir!));
});
// → changedPaths test: gb.changedPaths("BEFORE1"); assert args === ["diff","--name-only","BEFORE1"];
//   assert not.toContain("--diff-filter"); not.toContain("--"); same GIT_DIR/GIT_WORK_TREE assertions.
```

### Integration Points

```yaml
CLASS (src/snapshot/git.ts — GitBackend):
  - add method: "async changedPaths(beforeRef: string): Promise<string[]> { ... }"
  - placement: immediately after dirtyCheck(), before has()
  - implements: the SnapshotStore.changedPaths interface method declared by S1 (resolves its typecheck error)
INTERFACE (src/snapshot/store.ts): UNCHANGED (S1 already declared the method — do NOT re-edit)
TEST (test/git.test.ts):
  - add describe block: "GitBackend.changedPaths — spec/14 §6 step 2 / BUG-004"
  - placement: immediately after the "GitBackend.dirtyCheck …" describe block
DATABASE / CONFIG / ROUTES / MARKERS: none (Mode A — method + JSDoc + tests only)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm git.ts parses + GitBackend now satisfies the widened interface.
npm run typecheck          # tsc --noEmit
# EXPECTED OUTCOME (the critical, counterintuitive check):
#   - The src/snapshot/git.ts "Class 'GitBackend' incorrectly implements interface 'SnapshotStore'.
#     Property 'changedPaths' is missing" error (produced by S1) is GONE.
#   - EXACTLY ONE error REMAINS: the src/snapshot/cas.ts "Class 'CasBackend' incorrectly implements
#     interface 'SnapshotStore'. Property 'changedPaths' is missing" error. This is the EXPECTED
#     handoff to S3 (P1.M4.T1.S3). Do NOT edit cas.ts to clear it.
#   - ZERO other errors (git.ts itself must be clean; store.ts must be clean).
# If you see ANY error OTHER than the single cas.ts one → you have a bug in git.ts (wrong signature,
#   typo, stray brace, method placed outside the class). Fix it. If you see ONLY the cas.ts one → SUCCESS.

# Lint + format the touched files.
npx eslint src/snapshot/git.ts test/git.test.ts   # (if the repo uses eslint; else skip)
# Match existing formatting (the repo uses prettier-style 2-space indent + double quotes — see git.ts).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: the new changedPaths tests + the full git.test.ts must be green.
npx vitest run test/git.test.ts
# Expected: green. The new "GitBackend.changedPaths — spec/14 §6 step 2 / BUG-004" block (≥5 tests)
#   passes. If the argv test (#1) fails, the diff command drifted from ["diff","--name-only",beforeRef]
#   — re-check you did NOT add "--" / paths / "--diff-filter". If the never-rejects test (#4) fails, the
#   catch is missing or re-throws. If the mutex test (#5) times out, release() is missing from finally.

# Full suite — no behavioral regression (changedPaths is added but not yet called by production code).
npm test
# Expected: all green. (The cas.ts typecheck error is NOT surfaced by vitest — vitest transpiles
#   per-file; only `npm run typecheck` surfaces it. So the full test suite passes despite the cas.ts
#   type error remaining.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this item adds a backend method only; NO production code path calls changedPaths yet
# (rewind.ts still uses ledger.modifiedFiles). The rewind wiring + the E30 bash/python dirty-guard
# integration test are P1.M4.T2.S1 / P1.M4.T2.S2.
```

### Level 4: Domain-Specific Validation

```bash
# Manual sanity (optional): confirm GitBackend.changedPaths behaves on a REAL shadow repo. This mirrors
# how the existing dirtyCheck integration is reasoned about; the DI-fake unit tests are the primary gate.
# (Only run if a real-git sandbox is convenient — the unit tests are sufficient for sign-off.)

# 1. Create a git repo + a real GitBackend (production construction, no DI):
node -e "
import('./src/snapshot/git.js').then(async ({GitBackend}) => {
  // (sketch — adapt to a temp repo; omitted to avoid touching the user's filesystem)
  // capture a beforeRef, mutate a file, then:
  //   const changed = await gb.changedPaths(beforeRef);
  //   console.log(changed); // → lists the mutated file (and any added/deleted since capture)
});
"
# Expected: lists every file differing from beforeRef (modified + deleted + added), workspace-relative
# POSIX paths. A concurrent python-written change (BUG-004 scenario) MUST appear in the list.
```

## Final Validation Checklist

### Technical Validation

- [ ] `src/snapshot/git.ts`: `GitBackend` has `async changedPaths(beforeRef: string): Promise<string[]>`
      placed after `dirtyCheck()` and before `has()`, mirroring dirtyCheck's mutex/try/catch/finally
      structure exactly.
- [ ] The method issues EXACTLY `["diff", "--name-only", beforeRef]` via `this.shadowEnv()` — no
      `--diff-filter`, no `--`, no pathspec tail.
- [ ] The method returns `out.stdout.split("\n").map(s=>s.trim()).filter(s=>s.length>0)`.
- [ ] The method has `if (!beforeRef) return [];` after `ensureInit()`, and a `catch` that warns +
      returns `[]` (E27 best-effort, never rejects).
- [ ] `npm run typecheck`: the git.ts "missing changedPaths" error is GONE; EXACTLY ONE error remains
      (the cas.ts one — the S3 handoff). No other errors.
- [ ] `npx vitest run test/git.test.ts`: green, including the new `GitBackend.changedPaths` block.
- [ ] `npm test`: full suite green.

### Feature Validation

- [ ] JSDoc quotes spec/14 §6 step 2 verbatim ("paths that differ between beforeRef and the current
      tree (the files restore would touch)") and references BUG-004.
- [ ] JSDoc states the git algorithm (`git diff --name-only <beforeRef>` via shadowEnv), explains that
      single-commit `git diff` compares commit-tree vs working tree (not the index), and explains WHY no
      `--diff-filter` is used (default includes A/D/M; `--diff-filter=MD` would miss span-created files
      and re-introduce BUG-004).
- [ ] JSDoc names the consumer (rewindExecute step 6b, P1.M4.T2.S1) and the heuristic it replaces
      (`ledger.modifiedFiles`), and the E30 gap it closes (bash/python/perl/heredoc-modified files).
- [ ] JSDoc states BEST-EFFORT (never rejects → []) + AsyncMutex-serialized (spec §4.3), and ends with
      "IMPLEMENTED BY: git/cas.".
- [ ] The signature is async (`Promise<string[]>`), matching all other IO-bearing GitBackend methods.

### Code Quality Validation

- [ ] JSDoc density + style matches `dirtyCheck`/`restore` (multi-line block, spec cites, gotcha notes).
- [ ] Method placement is logical (immediately after dirtyCheck — groups the two diff-based query
      methods; mirrors the interface order from S1).
- [ ] No new exported types; `store.ts`/`cas.ts`/`rewind.ts`/`RestoreOpts`/`RestoreResult`/`AsyncMutex`/
      `detectAndCreate` untouched.
- [ ] The 5 unit tests include the two CRITICAL correctness assertions (`not.toContain("--diff-filter")`
      and `not.toContain("--")`) that prevent regression of the BUG-004 fix.

### Documentation & Deployment

- [ ] JSDoc is self-documenting (P1.M4.T2.S1 — the rewind wiring — can read it and know the return
      contract: workspace-rel POSIX paths differing from beforeRef vs current tree, best-effort []).
- [ ] No env vars / config / migrations / API-surface change (Mode A).

---

## Anti-Patterns to Avoid

- ❌ Don't add `--diff-filter=MD` (or any `--diff-filter`). That filter is restore()'s index-vs-worktree
  step AFTER read-tree; for a standalone beforeRef-vs-worktree query it would MISS span-created (Added)
  files — created files would be reverted/deleted by restore but never inspected by the dirty guard,
  re-introducing the EXACT BUG-004 under-coverage this method exists to close. Default (no) filter =
  full A/D/M coverage. Use `git diff --name-only <beforeRef>`.
- ❌ Don't add a `--` separator or a pathspec tail. changedPaths has NO path scope (unlike dirtyCheck,
  which scopes to caller paths). `["diff", "--name-only", beforeRef]` is the minimal correct form.
- ❌ Don't make the method synchronous or skip the mutex. Every IO-bearing GitBackend method is async +
  AsyncMutex-serialized (spec §4.3). changedPaths runs `git diff` (IO) → must be async + acquire
  `this.mutex` (and `release()` in `finally` — GOTCHA #5).
- ❌ Don't let the method reject. The `catch` must warn + `return []` (E27 best-effort), matching
  dirtyCheck/restore/gc. A rejecting `changedPaths` would propagate into rewindExecute step 6b and could
  block a context rewind — the feature's overriding rule forbids that.
- ❌ Don't edit `src/snapshot/store.ts` — S1 already declared the interface method + NoOpStore stub.
  Re-editing it risks colliding with S1's already-landed contract.
- ❌ Don't edit `src/snapshot/cas.ts` to clear its typecheck error — that is S3 (P1.M4.T1.S3). Its
  remaining error is the EXPECTED handoff; the success state for THIS item is "exactly one typecheck
  error remains and it is the cas.ts one".
- ❌ Don't wire `changedPaths` into `src/tools/rewind.ts` (replacing `ledger.modifiedFiles`) — that is
  P1.M4.T2.S1, and depends on S3 (CasBackend.changedPaths) landing too. This item ships the git method
  + tests only.
- ❌ Don't add an E30 bash/python integration test in this item — it requires the rewind wiring
  (P1.M4.T2.S1) which is not present yet. That test is P1.M4.T2.S2.
- ❌ Don't ignore a typecheck error OTHER than the single cas.ts one — that one is the S3 handoff
  (success); anything else is a real bug in git.ts that must be fixed before this item is done.

---

## Confidence Score

**9.5/10** — This is a single-method addition that clones an existing, well-understood sibling
(`dirtyCheck`) with exactly three specified changes (drop `--`+paths from argv; drop the paths half of
the guard; afterRef→beforeRef). The git semantics (`git diff <commit>` = commit-tree vs working tree,
no index consulted, default filter includes A/D/M) are authoritatively documented and identical to the
proven dirtyCheck mechanism — changedPaths just drops the path scope. The only judgment call — that no
`--diff-filter` is correct — is precisely the BUG-004 correctness requirement, called out in the JSDoc,
the gotchas, the success criteria, and two dedicated `not.toContain` test assertions. The
typecheck-outcome expectation (git.ts error gone, cas.ts error remains as the S3 handoff) is
unambiguous and the single most common implementation trap is named in every relevant section.
Downstream S3 (CasBackend) and P1.M4.T2.S1 (rewind wiring) have an unambiguous, JSDoc-specified
contract to build against. The 0.5 reserved for: real-git integration is only smoke-validated (the DI
unit tests are the primary gate, matching the existing dirtyCheck test strategy).