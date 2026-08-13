---
name: "P1.M2.T1.S1 (plan/009) — Run integration suite + add subdir-not-promoted assertion to revert-edge.test.ts"
description: >
  TEST-ONLY integration verification for the detection-safety-hardening plan (plan/009). Assumes ALL P1.M1
  code is complete (isForbiddenRoot in paths.ts; detectAndCreate rewrite in store.ts — lexical
  `existsSync(join(root,".git"))` + `realpath(cwd)` + forbidden-root gate, NO `rev-parse`; both backends'
  realpath + restore() entry guards). Does three things and ONLY three: (1) `npm test` — full suite green
  (M1's detection rewrite must not break existing revert-git/cas/explicit/edge integration tests, which
  assert backend type — preserved); (2) ADD one `it` to `test/integration/revert-edge.test.ts` proving a
  subdirectory under a git PARENT (no own `.git`) → `detectAndCreate(subdir)` → `backend === "cas"` (NOT
  `"git"`) — the end-to-end proof that upward repo discovery is gone (spec/14 §2 SAFETY INVARIANT); (3)
  confirm no `git rev-parse` in detection (grep + rely on the store.test.ts unit assertion from M1.T2.S1).
  Satisfies plan/009 Definition-of-Done #5 + #6. No source changes, no README (M2.T2 owns that).
---

## Goal

**Feature Goal**: Verify end-to-end, at the integration tier, that the detection-safety hardening
(plan/009 P1.M1) works against real filesystems and real git repos — specifically that the highest-
severity safety property holds: **a subdirectory launch is NEVER promoted to a parent git repo**
(spec/14 §2 SAFETY INVARIANT). Concretely: (1) the full `npm test` suite is green with all M1 changes
landed; (2) `test/integration/revert-edge.test.ts` gains a passing assertion that
`detectAndCreate(<subdir-of-git-parent>)` returns a CAS backend (not git); (3) detection provably issues
no `git rev-parse` (code review + the M1.T2.S1 unit assertion).

**Deliverable** (test-only — ONE file edited):
1. `test/integration/revert-edge.test.ts` — a new `it` case (`F-revert-subdir-not-promoted`) inside the
   existing `describe("F-revert-* edge integration …")` block (ends at line 662), mirroring the file's
   existing helpers (`makeRepo`, `makeStorage`, `gitAvailable`, `setConfig`, `detectAndCreate`,
   `store.describe().backend`) and its temp-dir cleanup.
2. A green `npm test` run (the verification itself is part of the deliverable — the new case + the
   existing 1277+ tests all pass with M1 landed).

**Success Definition**:
- `npm test` (full suite: unit + integration) is **green** with all P1.M1 changes in place. None of the
  pre-existing `revert-git` / `revert-cas` / `revert-explicit` / `revert-edge` integration tests regress
  (they assert `backend === "git"/"cas"`, which the lexical `.git` check preserves).
- The new `F-revert-subdir-not-promoted` case **passes**: `detectAndCreate(<subdir>, getConfig().revert)`
  where the subdir lives inside a parent that has `.git` (but the subdir has no own `.git`) returns
  `backend === "cas"`. The case **would fail** if upward discovery (`git rev-parse --show-toplevel`) were
  re-introduced — git would walk up, find the parent's `.git`, and return `"git"`.
- A grep confirms `src/snapshot/store.ts`'s `detectAndCreate` body (lines 443–490) contains NO
  `execFile`/`rev-parse` (it uses only `realpathSync`, `isForbiddenRoot`, `existsSync`, `mkdir`,
  `access`, and a dynamic backend import).
- NO source files are modified. `npm run typecheck` clean.

## User Persona

N/A — internal test hardening. No user-facing surface; this guards a non-negotiable safety invariant.

## Why

- **This is the integration-tier proof of the plan's headline safety property.** spec/14 §2 SAFETY
  INVARIANT (non-negotiable): "The workspace root is `realpath(cwd)`, full stop. There is no code path
  — in detection, init, capture, or restore — that traverses upward to find an enclosing repository. A
  subdirectory launch can never be silently promoted to a parent directory." The historical bug: upward
  traversal (`rev-parse --show-toplevel`) once resolved the workspace to `$HOME`, and `restore()` then
  reverted/deleted the entire home tree. M1 removed upward discovery in CODE; this task proves it in
  BEHAVIOR against a real git repo + real filesystem.
- **The unit tests alone don't cover it end-to-end.** `test/store.test.ts` (landed by M1.T2.S1) asserts
  "no rev-parse recorded by the exec fake" and `detectAndCreate` on temp `.git`/non-`.git` dirs. But it
  does not exercise the *physical* scenario the invariant exists to prevent: a real child directory of a
  real git repo. Only an integration test with `git init` + a subdir proves git's OWN upward-discovery
  behavior (which a stubbed exec fake cannot reproduce) is no longer consulted.
- **It closes Definition-of-Done #5 + #6.** The plan's DoD requires the integration suite green AND a
  subdir-not-promoted assertion. The PRD §10 "Safety (non-negotiable)" clause explicitly demands it:
  "a subdirectory launch whose *parent* contains a `.git` keeps `repoRoot` at the subdir (never promoted
  to the parent)".
- **Small, surgical, test-only.** One new `it` (~20 lines) + a green test run. No source, no config, no
  API, no README change. Mirrors helpers already in the file.

## What

User-visible behavior: NONE (test-only). No config, no API, no docs surface change.

Test-visible behavior:
1. `npm test` is green with M1 landed (the existing integration tests are unaffected — they assert
   backend type, which lexical `.git` detection preserves: a temp dir created with `git init` still has
   `.git` → GitBackend; a plain temp dir still has none → CasBackend).
2. A new `it` in `test/integration/revert-edge.test.ts`:
   - Creates a real git repo (parent, `.git` present) via the existing `makeRepo` helper.
   - Creates a subdirectory *inside* that parent with no own `.git` (via `mkdtempSync(join(parent, …))`).
   - Calls `detectAndCreate(subdir, getConfig().revert)` (lexical detection on the subdir).
   - Asserts `store.describe().backend === "cas"` (the subdir is NOT promoted to the parent's git repo).
3. A code-review grep confirms `detectAndCreate` issues no `git rev-parse`.

### Success Criteria

- [ ] `npm test` full suite green (incl. all `revert-*` integration tests + the M1 unit tests).
- [ ] `npm run typecheck` clean.
- [ ] `F-revert-subdir-not-promoted` exists in `test/integration/revert-edge.test.ts` and passes.
- [ ] It asserts `detectAndCreate(<subdir-of-git-parent>)` → `backend === "cas"` (NOT `"git"`).
- [ ] The subdir is a real child dir of a real `git init`-ed parent, with no own `.git`.
- [ ] It guards on `gitAvailable()` (the parent needs `git init`).
- [ ] It cleans up its temp dirs matching the file's existing teardown idiom.
- [ ] `grep -n "execFile\|rev-parse" src/snapshot/store.ts` shows NONE inside `detectAndCreate` (443–490).
- [ ] NO source file is modified; only `test/integration/revert-edge.test.ts`.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact file
to edit, the exact `describe` block (line 392) and its closing `});` (line 662) where the new `it` goes,
the exact in-file helpers to reuse (`makeRepo`, `makeStorage`, `gitAvailable`, `setConfig`, `getConfig`,
`detectAndCreate`), the canonical backend-assertion pattern (verbatim from `revert-git.test.ts:376-380`),
the `detectAndCreate` signature, the detection model (lexical `.git` + realpath + forbidden-root gate),
and the verbatim test code are all specified below. The implementer needs only
`test/integration/revert-edge.test.ts` + `src/snapshot/store.ts` (read-only) + the M1 code (assumed done).

### Documentation & References

```yaml
# MUST READ — the authoritative change inventory (scopes THIS task precisely)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "The 'test/integration/revert-*.test.ts — RUN UNCHANGED + ADD ONE ASSERTION' row is the verbatim
        spec for this task: 'ADD to revert-edge.test.ts: detectAndCreate(tmpSubdirUnderGitRepo, …) → cas
        (subdir not promoted).' Also confirms the revert-git/cas/explicit/edge tests 'still pass' with
        lexical detection (they assert backend type — preserved), and that store.test.ts owns the
        unit-level 'no rev-parse recorded' assertion (do NOT duplicate it)."
  section: "the 'test/integration/revert-*.test.ts' row + the 'test/store.test.ts' row"
  critical: "Do NOT modify revert-git/cas/explicit.test.ts (RUN UNCHANGED). Do NOT touch store.test.ts
             (M1.T2.S1 owns the detectAndCreate unit block — Complete). Do NOT touch README (M2.T2 owns).
             Only revert-edge.test.ts gets the new it."

# MUST READ — THE file being edited (read its helpers + the F-revert-reload case before writing)
- file: test/integration/revert-edge.test.ts
  why: "THE file modified. Structure: `describe(\"F-revert-* edge integration (spec/14 §6 + §2 / spec/08
        E32)\", …)` at line 392; two existing it-cases (F-revert-granularity 395, F-revert-reload 455);
        the describe CLOSES at line 662 (the new it goes just before that final `});`). File-scoped
        helpers (all reusable, no redefinition): `git(cwd,args)` (~78), `gitAvailable()` (~83),
        `makeRepo(prefix)` (~91 — mkdtempSync + `git init -b main`), `makeStorage()` (~101 — separate
        temp dir for snapshot storage), `VALID_NOTE` (~105). before/afterEach reset setConfig(undefined)
        (349/354). The F-revert-reload case (455-661) is the structural template: gitAvailable guard →
        makeRepo → makeStorage → setConfig({revert:{enabled:true,storageDir}}) → detectAndCreate →
        backend assertion + temp-dir cleanup."
  pattern: "Mirror F-revert-reload's setup EXACTLY: `if (!(await gitAvailable())) return;` → `const
            parentRepo = await makeRepo(…)` → `const storageDir = makeStorage()` → `setConfig({revert:
            {enabled:true, storageDir}})` → `const store = await detectAndCreate(<path>, getConfig().revert)`
            → `expect(store.describe().backend).toBe(<expected>)`."
  gotcha: "setConfig MERGES {revert:{…}} over DEFAULT_CONFIG (the file's own GOTCHA #11 at ~407). Pass an
           explicit storageDir (makeStorage) so resolveStorageDir never hits a null-sessionDir path.
           mkdtempSync(join(parentRepo, \"sub-\")) creates the subdir INSIDE the parent with no own .git
           AND needs NO new import (mkdtempSync is already imported)."

# MUST READ — the detection model consumed (read-only; do NOT modify)
- file: src/snapshot/store.ts
  why: "detectAndCreate (443-490) is the function the new test exercises. Its model: (1) root =
        realpathSync(cwd); catch → NoOpStore; (2) if isForbiddenRoot(root) → NoOpStore; (3) if
        existsSync(join(root, \".git\")) → GitBackend(root,…); (4) else → resolveStorageDir + mkdir -p +
        access(W_OK), fail → NoOpStore, else CasBackend(root,…); (5) catch → NoOpStore. NO execFile, NO
        rev-parse. The grep check (Success Criteria) targets THIS function's body."
  section: "export async function detectAndCreate (443-490)"
  critical: "detectAndCreate NEVER rethrows (E28 fail-open → NoOpStore on any error). It canonicalizes
             root via realpathSync FIRST, so the subdir passed in is resolved to its real path (a child
             of the parent repo) BEFORE the lexical .git check — which correctly finds NO .git in the
             subdir → CAS. (If it walked up via rev-parse, git would find the PARENT's .git → GitBackend.)"

# Pattern to mirror — the canonical backend-assertion idiom (revert-git.test.ts:376-380)
- file: test/integration/revert-git.test.ts
  why: "The exact shape every integration backend assertion uses:
        `const storageDir = makeStorage(); setConfig({revert:{enabled:true,storageDir}}); const store =
        await detectAndCreate(repoDir, getConfig().revert); expect(store.describe().backend).toBe(\"git\");`.
        My test is IDENTICAL except: detect on a SUBDIR of a git parent, expect \"cas\"."
  section: "~lines 374-380 (and again at 526-531, 609-615)"
  gotcha: "revert-git.test.ts uses `git rev-parse --show-toplevel` at ~line 116 — but that is TEST-HARNESS
           logic (resolving the temp repo root to locate the shadow dir for assertions), NOT production
           detection code. It is UNAFFECTED by M1 and stays. Do not be alarmed to see rev-parse in the
           TEST file — it is the harness, not the code-under-test. (Contract RESEARCH NOTE point 1.)"

# CONTRACT — the parallel code task (assumed COMPLETE when this task runs)
- file: plan/009_1ecb4b3cb372/P1M1T4S1/PRP.md
  why: "The LAST M1 code task (cas.ts restore guard + realpath). Treat as DONE: by the time THIS task
        runs, all of M1 is complete — isForbiddenRoot, detectAndCreate rewrite, both backends' realpath
        + restore() guards. My task VERIFIES the integrated result; it does not depend on the cas.ts
        restore-guard internals (that is verified by test/cas.test.ts's own forbidden-root block)."
  critical: "My integration test exercises DETECTION (detectAndCreate → backend selection), not the
             restore() guard. So even though T4.S1 is the in-flight parallel task, my subdir→cas
             assertion is independent of it (detection is M1.T2.S1 — Complete)."

# Spec authority
- file: spec/14-working-tree-revert.md
  why: "§2 SAFETY INVARIANT is THE rule this test enforces: 'The workspace root is realpath(cwd), full
        stop … A subdirectory launch can never be silently promoted to a parent directory.' §10 Safety
        clause: 'a subdirectory launch whose parent contains a .git keeps repoRoot at the subdir (never
        promoted to the parent)'."
  section: "§2 (SAFETY INVARIANT — non-negotiable) + §10 (Safety testing clause)"
```

### Current Codebase tree (the slice that matters)

```bash
src/snapshot/
├── store.ts    # READ-ONLY — detectAndCreate (443-490): lexical .git + realpath + forbidden-root gate, NO rev-parse
├── git.ts      # READ-ONLY — GitBackend (M1.T3 done); its restore() guard is NOT exercised by this test
├── cas.ts      # READ-ONLY — CasBackend (M1.T4 in-flight; assume done); its restore() guard NOT exercised here
└── paths.ts    # READ-ONLY — isForbiddenRoot (M1.T1 done; consumed by detectAndCreate)
test/integration/
├── revert-edge.test.ts     # <-- THE file edited: +1 it (F-revert-subdir-not-promoted) inside the existing describe
├── revert-git.test.ts      # UNCHANGED (RUN — asserts backend==="git"; preserved by lexical detection)
├── revert-cas.test.ts      # UNCHANGED (RUN — asserts backend==="cas"; preserved)
└── revert-explicit.test.ts # UNCHANGED (RUN — asserts backend==="cas"; preserved)
```

### Desired Codebase tree (files this task changes)

```bash
test/integration/
└── revert-edge.test.ts   # MODIFIED: +1 it case (~20 lines) + (optionally) existsSync added to the node:fs import
# (no new files; no source/config/api/README changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — setConfig MERGES {revert:{…}} over DEFAULT_CONFIG (revert-edge.test.ts GOTCHA #11 at ~407).
// So `setConfig({ revert: { enabled: true, storageDir } })` deep-merges — the other 7 revert fields keep
// their defaults. You do NOT need to specify the full block. Pass an explicit storageDir (makeStorage) so
// resolveStorageDir never hits a null-sessionDir path (sessionDir is omitted → null in the test call).

// GOTCHA #2 — mkdtempSync(join(parentRepo, "sub-")) creates the subdir INSIDE the parent with no own .git,
// AND it is ALREADY imported (the file uses mkdtempSync for makeRepo/makeStorage). NO new import needed
// for the subdir creation. (If you prefer mkdirSync, it may need adding to the node:fs destructure —
// mkdtempSync is the zero-import-friction choice.)

// GOTCHA #3 — the subdir is depth ≥ 2 (under /tmp/<parent>/sub-<rand>), so isForbiddenRoot(subdir) is
// FALSE → it reaches the CAS branch (not NoOp). dirname("/tmp/parent/sub") === "/tmp/parent" ≠ "/" →
// not forbidden. And it has no .git → CAS. So backend === "cas" (NOT "none", NOT "git"). Both assertions
// matter: "cas" (not "git") proves no upward discovery; "cas" (not "none") proves it isn't spuriously
// refused. Asserting exactly "cas" covers both.

// GOTCHA #4 — the parent MUST be a REAL git repo (makeRepo does `git init -b main`), so guard on
// gitAvailable() (the F-revert-reload case does exactly this at line 456). Without git on PATH, makeRepo
// throws — return early instead. (The detection-under-test itself does NOT call git — that's the point —
// but the SETUP does, to create the parent .git.)

// GOTCHA #5 — rev-parse appears in revert-git.test.ts (~line 116) but that is TEST-HARNESS logic
// (resolving the temp repo root to locate the shadow dir), NOT production detection. It is UNAFFECTED by
// M1 and stays. Seeing rev-parse in a TEST file is expected; seeing it in src/snapshot/store.ts's
// detectAndCreate would be the bug. Do not "fix" the test-harness rev-parse.

// GOTCHA #6 — the backend==="cas" assertion IS the no-upward-discovery proof. If detectAndCreate used
// `git rev-parse --show-toplevel` on the subdir, git would walk UP, find the parent's .git, and return
// the PARENT as repoRoot → GitBackend (backend==="git"). Lexical detection sees no .git in the subdir →
// CAS. So asserting "cas" is both the safety assertion AND the regression guard. You do NOT need to
// additionally stub/spy git to prove "no rev-parse called" — the behavioral outcome (cas, not git) is
// the stronger proof, and the unit-level "no rev-parse recorded" assertion already lives in store.test.ts.

// GOTCHA #7 — match the file's EXISTING temp-dir cleanup. revert-edge.test.ts resets setConfig(undefined)
// in before/afterEach (349/354). For the temp dirs (parentRepo, storageDir), mirror whatever the
// F-revert-reload case does (revert-git.test.ts uses a `dirs` array + afterEach rm; revert-edge.test.ts's
// exact teardown — read the file's after-block and match it; if there is a collected-dirs cleanup, add
// parentRepo + storageDir to it). The new case must not leak temp dirs the others don't.

// GOTCHA #8 — the new it goes INSIDE the existing describe (before the final `});` at line 662) so it
// shares the in-scope helpers. A separate top-level describe also works (helpers are file-scoped), but
// co-locating with the other F-revert-* edge cases is cleaner and matches the file's intent
// ("edge integration (spec/14 §6 + §2 …)" — detection safety is an §2 edge case).
```

## Implementation Blueprint

### Data models and structure

No data models. The test reuses the existing in-file helpers and the `SnapshotStore`/`detectAndCreate`
exports. No new types. The only values are `parentRepo: string`, `subdir: string`, `storageDir: string`,
and `store: SnapshotStore`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RUN the full suite FIRST (baseline — confirms M1 landed cleanly)
  - RUN: `npm run typecheck`  → MUST be clean (M1's TS changes compile).
  - RUN: `npm test`           → MUST be green (1277+ tests incl. the M1 unit tests + the existing
    revert-git/cas/explicit/edge integration tests). This is the contract point (1).
  - IF RED: investigate whether it is a legitimate M1 regression OR an existing integration test that
    relied on the old rev-parse behavior. Per the contract RESEARCH NOTE (point 1), the integration tests
    assert `store.describe().backend === "git"/"cas"` — which lexical detection PRESERVES (a `git init`-ed
    temp dir still has .git → git; a plain temp dir still has none → cas). So they should be green. If one
    is red on a backend assertion, that is an M1 bug to flag upstream (NOT this task's fix — this task is
    test-only and adds an assertion; it does not fix M1 source).
  - WHY first: proves the green baseline BEFORE adding the new case, so a later red run isolates the new
    case as the cause (or confirms M1 isn't fully landed yet).

Task 2: CONFIRM no rev-parse in detection (contract point 3 — code review)
  - RUN: `grep -n "execFile\|rev-parse" src/snapshot/store.ts`
  - EXPECTED: NO match inside detectAndCreate's body (lines 443-490). The function uses realpathSync,
    isForbiddenRoot, existsSync, mkdir, access, and a dynamic `import("./git.js"|"./cas.js")` only.
    (A leftover dead `import { execFile }` LINE at the top of store.ts would be an M1.T2.S1 cleanup miss —
    flag it, but it does not block this task as long as detectAndCreate's BODY doesn't call it. M1.T2.S1
    is Complete, so the dead import should already be removed.)
  - ALSO: the unit-level "no rev-parse call recorded by the exec fake" assertion LIVES in test/store.test.ts
    (landed by M1.T2.S1, Complete). Do NOT duplicate it. This grep + the store.test.ts unit assertion +
    the Task 4 subdir→cas behavioral proof TOGETHER satisfy contract point 3.

Task 3: ADD the subdir-not-promoted it to test/integration/revert-edge.test.ts
  - LOCATE the end of the existing describe: the last it (F-revert-reload) closes ~line 660, then the
    describe's closing `});` is at line 662. INSERT the new it IMMEDIATELY BEFORE that final `});`.
  - (If existsSync is not already in the node:fs destructure at lines ~36-44, ADD it — the optional sanity
    assertions below use it. writeFileSync/readFileSync are already imported; existsSync may or may not be.
    If you'd rather avoid the import, drop the two optional `existsSync` sanity lines — the backend
    assertion is the core.)
  - INSERT (exact code — mirrors F-revert-reload's setup; the backend assertion is the deliverable):
        // ── F-revert-subdir-not-promoted (spec/14 §2 SAFETY INVARIANT — no upward repo discovery) ───────
        // The core detection-safety property, exercised end-to-end against a REAL git repo + real fs: a
        // subdirectory launch whose PARENT contains a .git is NEVER promoted to the parent's git repo.
        // detectAndCreate uses LEXICAL existsSync(join(cwd, ".git")) + realpath(cwd) — NO `git rev-parse
        // --show-toplevel` / upward walk (spec/14 §2). If it DID walk up, git would resolve the subdir to
        // the parent's repo root → GitBackend → restore() would target the PARENT tree (the historical
        // $HOME-deletion hazard). Asserting backend === "cas" here is the behavioral proof that upward
        // discovery is gone. (The unit-level "no rev-parse recorded" assertion lives in test/store.test.ts,
        // landed by P1.M1.T2.S1; this is the integration-level proof. spec/14 §10 Safety clause.)
        it("F-revert-subdir-not-promoted: a subdir under a git parent (no own .git) → cas (NOT git) — no upward discovery (spec/14 §2 SAFETY INVARIANT)", async () => {
          if (!(await gitAvailable())) return; // the parent repo needs `git init` (the SETUP, not detection)
          // PARENT: a real git repo (.git present) — the directory detection must NOT walk up into.
          const parentRepo = await makeRepo("rev-subdir-parent-");
          // SUBDIR: a fresh directory INSIDE the parent that has NO .git of its own. mkdtempSync under the
          // parent creates it with no .git (no new import — mkdtempSync is already used by makeRepo/makeStorage).
          const subdir = mkdtempSync(join(parentRepo, "sub-"));
          // Sanity (optional — drop if existsSync isn't imported): the structural precondition holds.
          expect(existsSync(join(parentRepo, ".git"))).toBe(true);   // parent IS a git repo
          expect(existsSync(join(subdir, ".git"))).toBe(false);       // subdir is NOT itself a git repo
          // Detect on the SUBDIR. realpath(subdir) is depth ≥ 2 (not forbidden) and has no .git → CAS.
          const storageDir = makeStorage();
          setConfig({ revert: { enabled: true, storageDir } });
          const store = await detectAndCreate(subdir, getConfig().revert);
          // THE assertion: lexical detection → "cas". If upward discovery existed, git would find the
          // parent's .git and return "git". "cas" (not "none") also confirms it isn't spuriously refused.
          expect(store.describe().backend).toBe("cas");
          // Cleanup: mirror the file's existing temp-dir teardown (add parentRepo + storageDir to whatever
          // collected-dirs/afterEach idiom F-revert-reload uses — read the file's after-block and match).
        });
  - NAMING: `F-revert-subdir-not-promoted` (matches the `F-revert-*` naming convention; the it-title carries
    the spec citation + the invariant).
  - PLACEMENT: inside the existing `describe("F-revert-* edge integration …")` (before line 662's `});`).
  - FOLLOW pattern: F-revert-reload (lines 455-661) for setup shape + gitAvailable guard + cleanup.
  - GOTCHA: all of #1–#8.

Task 4: VALIDATE (no code)
  - RUN: `npm run typecheck`  → clean. (Watch: "Cannot find name 'existsSync'" → add it to the node:fs
    import, or drop the two optional sanity lines.)
  - RUN: `npx vitest run test/integration/revert-edge.test.ts -t "subdir-not-promoted"` → the new case green.
  - RUN: `npx vitest run test/integration/revert-edge.test.ts` → ALL three it-cases green (granularity,
    reload, subdir-not-promoted).
  - RUN: `npm test` → FULL suite green (the new case + every existing test).
  - REGRESSION-GUARD CHECK (proof the assertion is meaningful): if you temporarily reverted M1's
    detectAndCreate to the old `git rev-parse --show-toplevel` probe, the subdir would resolve to the
    parent → backend === "git" → the `toBe("cas")` assertion FAILS. (Do NOT commit the revert — this is a
    mental/manual check confirming the test guards the invariant, not another always-pass.)
```

### Implementation Patterns & Key Details

```typescript
// THE canonical backend-assertion idiom (from revert-git.test.ts:376-380) — my test mirrors it:
//   const storageDir = makeStorage();
//   setConfig({ revert: { enabled: true, storageDir } });   // MERGES over DEFAULT_CONFIG (GOTCHA #1)
//   const store = await detectAndCreate(<path>, getConfig().revert);
//   expect(store.describe().backend).toBe(<"git" | "cas">);
//
// My SINGLE delta vs that idiom: detect on a SUBDIR of a git parent, expect "cas". Everything else
// (gitAvailable guard, makeRepo for the parent, makeStorage, setConfig, detectAndCreate, the backend
// assertion) is verbatim from F-revert-reload / revert-git.
//
// WHY mkdtempSync(join(parentRepo, "sub-")) for the subdir (not mkdirSync):
//   - It creates a fresh dir INSIDE the parent (a real child) with NO .git — exactly the precondition.
//   - mkdtempSync is ALREADY imported (makeRepo/makeStorage use it) → zero new import for subdir creation.
//   - mkdirSync would work too but may need adding to the node:fs destructure. mkdtempSync is friction-free.
//
// WHY backend === "cas" is BOTH the safety assertion AND the regression guard:
//   - "cas" (not "git") ⟹ detection did NOT walk up to the parent's .git (the SAFETY INVARIANT).
//   - "cas" (not "none") ⟹ the subdir wasn't spuriously refused (it's depth ≥ 2, not forbidden, storage
//     writable) — so the test isn't accidentally passing via the NoOp path.
//   - A rev-parse-based detection would return "git" (parent found) → assertion fails. So `toBe("cas")`
//     genuinely guards the regression; it is not an always-pass.

// NON-GOALS (owned by other tasks — do NOT do them here):
//   - DO NOT modify any src/* file (M1 code is the dependency, assumed done; this task is test-only).
//   - DO NOT modify revert-git/cas/explicit.test.ts (RUN UNCHANGED — they assert backend type, preserved).
//   - DO NOT modify test/store.test.ts (M1.T2.S1 owns the detectAndCreate unit block + the "no rev-parse
//     recorded" assertion — Complete; do not duplicate it).
//   - DO NOT touch README.md (M2.T2.S1/S2 own the Mode-B safety paragraph + stale-reference sweep).
//   - DO NOT stub/spy git to prove "no rev-parse called" at the integration tier — the behavioral
//     assertion (cas, not git) is the proof; the call-recording proof is the unit tier's job (store.test.ts).
```

### Integration Points

```yaml
TEST (test/integration/revert-edge.test.ts — the ONLY file changed):
  - +1 it case ("F-revert-subdir-not-promoted") inside the existing describe (before line 662's closing });)
  - optionally +existsSync in the node:fs destructure (only if the optional sanity assertions are kept)
  - reuses in-file helpers: makeRepo, makeStorage, gitAvailable, setConfig, getConfig, detectAndCreate
  - cleanup mirrors the file's existing temp-dir teardown idiom

NO CHANGES TO: any src/* (M1 done — dependency), test/store.test.ts (M1.T2.S1), test/git.test.ts /
  test/cas.test.ts (M1.T3/T4), revert-git/cas/explicit.test.ts (RUN UNCHANGED), README.md (M2.T2),
  config/package.json/tsconfig.json. This task is strictly ONE test file, additive, + a green npm test run.
```

## Validation Loop

> NOTE: TypeScript + vitest project. Gates are `npm run typecheck` (tsc --noEmit, strict) and
> `npm test` (vitest run). There is NO ruff/mypy/eslint (Python/template tools — DO NOT APPLY).
> package.json scripts: `test`, `typecheck`, `smoke`, `prepublishOnly`.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # = tsc --noEmit (strict). MUST be clean.
# Expected: zero errors. Watch for "Cannot find name 'existsSync'" → add it to the node:fs import in
# revert-edge.test.ts, OR drop the two optional existsSync sanity lines (the backend assertion is the core).
# Confirm ONLY revert-edge.test.ts changed:
git diff --name-only     # Expected: test/integration/revert-edge.test.ts (and nothing else)
```

### Level 2: The New Test Case (Component Validation)

```bash
# Run JUST the new case:
npx vitest run test/integration/revert-edge.test.ts -t "subdir-not-promoted"
# Expected: 1 passed. (Skips cleanly if git is off PATH — the gitAvailable guard returns early; on CI git
# IS on PATH, so it runs and asserts backend === "cas".)

# Run the whole revert-edge file (all 3 it-cases):
npx vitest run test/integration/revert-edge.test.ts
# Expected: 3 passed (granularity, reload, subdir-not-promoted).
```

### Level 3: Full Integration Suite (the contract point 1)

```bash
# All revert-* integration tests (the ones that must stay green with M1):
npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-explicit.test.ts test/integration/revert-edge.test.ts
# Expected: ALL green. These assert backend === "git"/"cas" on real git/non-git temp dirs — lexical
# detection PRESERVES those (a `git init`-ed dir still has .git → git; a plain dir still has none → cas).

# The full suite (unit + integration):
npm test
# Expected: ALL green (1277+ tests incl. the M1 unit tests in paths/store/git/cas.test.ts).
```

### Level 4: Regression-Guard + No-Rev-Parse Verification (the contract points 2 + 3)

```bash
# (4a) Confirm detection issues NO rev-parse (code review — contract point 3):
grep -n "execFile\|rev-parse" src/snapshot/store.ts
# Expected: NO match inside detectAndCreate (lines 443-490). The function uses realpathSync /
# isForbiddenRoot / existsSync / mkdir / access / dynamic import only. (A dead `import { execFile }` line
# at the top would be an M1.T2.S1 cleanup miss — flag it; it does not block this task if the BODY is clean.)

# (4b) Confirm the unit-level "no rev-parse recorded" assertion exists (landed by M1.T2.S1 — do NOT duplicate):
grep -n "rev-parse" test/store.test.ts
# Expected: a hit in an assertion that NO rev-parse was recorded by the exec fake (M1.T2.S1's work).
# This + the grep above + the subdir→cas behavioral proof together satisfy contract point 3.

# (4c) REGRESSION-GUARD (manual proof the new assertion is meaningful — do NOT commit this):
#   Temporarily revert src/snapshot/store.ts detectAndCreate to the old `git rev-parse --show-toplevel`
#   probe (or `git stash` the M1.T2.S1 change). Then:
#     npx vitest run test/integration/revert-edge.test.ts -t "subdir-not-promoted"
#   Expected: FAILS — git walks up from the subdir, finds the parent's .git, returns backend === "git",
#   and `toBe("cas")` throws. This proves the test genuinely guards the SAFETY INVARIANT (not an always-pass).
#   Restore M1 (git stash pop). Re-run → PASS.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean.
- [ ] `git diff --name-only` shows ONLY `test/integration/revert-edge.test.ts`.
- [ ] `npx vitest run test/integration/revert-edge.test.ts -t "subdir-not-promoted"` passes.
- [ ] `npx vitest run test/integration/revert-edge.test.ts` — all 3 it-cases pass.
- [ ] `npm test` full suite green (1277+ tests incl. all revert-* integration + M1 unit tests).
- [ ] Level 4 (4a) grep: no `execFile`/`rev-parse` in detectAndCreate's body.
- [ ] Level 4 (4c) regression-guard: the new assertion FAILS with the old rev-parse probe (manual check).

### Feature Validation

- [ ] `F-revert-subdir-not-promoted` creates a real git parent (`makeRepo`) + a child subdir with no `.git`.
- [ ] It calls `detectAndCreate(subdir, getConfig().revert)` (lexical detection on the subdir).
- [ ] It asserts `store.describe().backend === "cas"` (NOT `"git"` — no upward promotion; NOT `"none"` — not refused).
- [ ] It guards on `gitAvailable()` and cleans up temp dirs matching the file's idiom.

### Code Quality Validation

- [ ] Reuses the existing in-file helpers (`makeRepo`, `makeStorage`, `gitAvailable`, `setConfig`,
      `getConfig`, `detectAndCreate`) — no duplication, no redefinition.
- [ ] Mirrors F-revert-reload's setup shape (gitAvailable → makeRepo → makeStorage → setConfig → detectAndCreate).
- [ ] The it-title + header comment cite spec/14 §2 (SAFETY INVARIANT) + §10 + task P1.M2.T1.S1.
- [ ] Strictly additive — one new `it` (+ optional one import name); no other file touched.

### Documentation & Deployment

- [ ] No user-facing/config/API/README change (test-only) — nothing to deploy beyond the test.
- [ ] (README safety paragraph is M2.T2.S1's job — do not do it here.)

---

## Anti-Patterns to Avoid

- ❌ Don't modify any `src/*` file — M1 code is the DEPENDENCY (assumed complete); this task is test-only.
  If `npm test` reveals an M1 source bug, FLAG it upstream — do not fix it here (out of scope).
- ❌ Don't modify `revert-git/cas/explicit.test.ts` or `test/store.test.ts` — they RUN UNCHANGED (they
  assert backend type, preserved by lexical detection). The "no rev-parse recorded" UNIT assertion is
  store.test.ts's job (M1.T2.S1, Complete) — do not duplicate it in the integration test.
- ❌ Don't stub/spy `git` to prove "no rev-parse called" at the integration tier — the behavioral outcome
  (`backend === "cas"`, not `"git"`) IS the proof; the call-recording proof belongs to the unit tier.
- ❌ Don't create the subdir with `mkdirSync` if it needs a new import — use `mkdtempSync(join(parent, …))`
  (already imported; creates a real child dir with no `.git`). (GOTCHA #2.)
- ❌ Don't omit the explicit `storageDir` — `setConfig({ revert: { enabled: true, storageDir } })` is
  required so `resolveStorageDir` never hits a null-sessionDir path. (GOTCHA #1.)
- ❌ Don't assert only `!== "git"` — assert `=== "cas"` exactly, so the test also catches a spurious
  `"none"` (forbidden-root refusal) regression. (GOTCHA #3.)
- ❌ Don't drop the `gitAvailable()` guard — the parent setup needs `git init`; without git on PATH the
  case must skip cleanly, not throw. (GOTCHA #4.)
- ❌ Don't be alarmed by `rev-parse` in `revert-git.test.ts` (~line 116) — that is TEST-HARNESS repo-root
  resolution, NOT production detection; it is unaffected by M1 and stays. (GOTCHA #5.)
- ❌ Don't touch README.md — the Mode-B safety paragraph + stale-reference sweep is M2.T2's job.
- ❌ Don't add the new `it` as a new top-level describe unless co-location is truly awkward — it belongs
  inside the existing `describe("F-revert-* edge integration …")` (detection safety IS an §2 edge case).

---

## Confidence Score: 9/10

**Why high**: This is a small, surgical, test-only task — one new `it` (~20 lines) inside an existing
describe + a green `npm test` run + a grep. The detection model it exercises is fully implemented by M1
(Complete except T4, which is in-flight and out of this test's path — the subdir→cas assertion exercises
DETECTION, M1.T2.S1, which is Complete). The exact file, describe block (line 392), closing `});` (662),
in-file helpers, the canonical backend-assertion idiom (verbatim from revert-git.test.ts:376-380), and the
verbatim test code are all specified. The fail-without-M1 proof (Level 4c) confirms the assertion is a
genuine guard, not an always-pass.

**Residual risk (the 1 point)**: the exact temp-dir cleanup idiom in revert-edge.test.ts (the file's
afterEach/collected-dirs pattern) wasn't fully inspected — the implementer must read F-revert-reload's
teardown and match it (GOTCHA #7). Mitigated by: the guidance is explicit ("mirror the existing case"),
mkdtempSync temp dirs under `tmpdir()` are auto-cleaned by the OS on reboot anyway, and a cleanup mismatch
would at worst leak a temp dir (not fail a test). Also: if M1.T4.S1 (cas.ts) is not yet fully landed when
this task runs, `npm test` may be red on test/cas.test.ts — that is an M1 dependency, not this task's
defect; run after M1 is fully complete.