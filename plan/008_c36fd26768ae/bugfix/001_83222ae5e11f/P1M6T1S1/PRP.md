---
name: "P1.M6.T1.S1 — Close remaining F-revert-* integration test gaps (cas-backend failopen + delete parity)"
description: |
  Audit CONFIRMED all 8 spec/14 §10 / spec/10 §2.1 F-revert-* scenarios are covered and that the
  three PRD-flagged degenerate/missing cases are already fixed by the per-bug subtasks (P1.M1.T1.S2
  reload, P1.M3.T1.S3 explicit, P1.M4.T2.S2 dirtyguard — all Complete). The audit found exactly TWO
  remaining cross-backend parity gaps, both test-only: `CasBackend.restore`'s DISTINCT `failed[]`
  (F-revert-failopen) and `deleted[]` (F-revert-delete) code paths are exercised at integration level
  ONLY through `GitBackend.restore` — the cas-specific implementations (cas.ts:1053 writeFile-EACCES
  → failed[]; cas.ts:1073-1094 cas-mode tree-walk delete → deleted[]) are never driven end-to-end
  through the rewind tool in cas mode.

  THE WORK (exact): ADD THREE `it()` tests to `test/integration/revert-cas.test.ts` inside the
  EXISTING `describe("F-revert-cas/dirtyguard integration …", …)` (L315), placed AFTER the existing
  F-revert-dirtyguard test (before the closing `});` at L502):
    (1) F-revert-failopen (cas): 2 pre-existing files, mutate both in-span, chmod ONE file 0o444,
        rewind → the unlocked file reverted, the locked file STAYS mutated + lands in
        marker.revert.failedFiles, rewind SUCCEEDS (E27 best-effort). Exercises cas.ts:1053.
    (2) F-revert-delete (cas, config OFF): create a file in-span, rewind with
        delete_created_files:true under allowDeleteCreatedFiles:false → file STAYS,
        marker.revert.deletedFiles empty (the cas double-gate cas.ts:1057/1078 blocks it).
    (3) F-revert-delete (cas, config ON): same, under allowDeleteCreatedFiles:true → file GONE,
        marker.revert.deletedFiles ⊇ {new.ts} (cas-mode tree-walk cas.ts:1086/1090 unlinks it).

  THE PATTERN: each test is a clone of its git counterpart (revert-git.test.ts:494 failopen,
  revert-git.test.ts:595/661 delete-off/delete-on) with the git-specific bits swapped for the cas
  house idiom already used 6× in revert-cas.test.ts: `makeNonGitDir` (NOT makeRepo) + NO `git`
  commit + `setConfig({ revert: { enabled:true, nonGitMode:"cas", storageDir } })` + the file's own
  `run`/`firstText`/`rewindMarker`/`makePi`/`makeCtx`/`msgEntry`/`asstWrite`/`result` helpers. NO sed
  needed (mutations via writeFileSync). NO production-source change. NO new file.

  CONTRACT scope: `test/integration/revert-cas.test.ts` ONLY (3 new it() blocks + their section
  comments). NOTHING ELSE. If `git diff --name-only` shows anything else, STOP and revert.

---

## Goal

**Feature Goal**: Close the two remaining F-revert-* integration test gaps surfaced by the P1.M6.T1
audit — `CasBackend.restore`'s `failed[]` (E27 fail-open) and `deleted[]` (span-created-file delete)
code paths are currently exercised end-to-end ONLY through `GitBackend.restore`; add cas-backend
integration tests so every F-revert-* scenario that has a backend-specific restore code path is
exercised in BOTH backends, leaving zero cas.restore behavior validated only via the git backend.

**Deliverable**: THREE new `it()` blocks inside the EXISTING `describe("F-revert-cas/dirtyguard
integration …", …)` at `test/integration/revert-cas.test.ts:315`:
1. `F-revert-failopen (cas)` — drives the REAL rewind tool through `CasBackend.restore` with a
   read-only-locked target file; asserts the locked file is NOT reverted, lands in
   `marker.revert.failedFiles`, and the rewind still SUCCEEDS (E27 best-effort, never blocks).
2. `F-revert-delete (cas, off)` — config gate `allowDeleteCreatedFiles:false` + per-call
   `delete_created_files:true` → created file STAYS, `marker.revert.deletedFiles === []`.
3. `F-revert-delete (cas, on)` — config gate `allowDeleteCreatedFiles:true` + per-call
   `delete_created_files:true` → created file GONE, `marker.revert.deletedFiles ⊇ {new.ts}`.

**Success Definition**:
- All 8 F-revert-* scenarios (spec/10 §2.1) are exercised by integration tests in BOTH backends
  where the backend has a distinct restore code path (failopen + delete now cas-covered; the other
  scenarios are backend-agnostic, single-backend, or already cross-backend — see the audit table).
- `npm test`: full suite green (all 1277+ pre-existing tests + the 3 new tests).
- `npm run typecheck`: 0 errors.
- `git diff --name-only` shows ONLY `test/integration/revert-cas.test.ts`.

## User Persona (if applicable)

N/A — this is a test-hardening item. The "user" is the future maintainer/agent who must be able to
trust that a regression in `CasBackend.restore`'s `failed[]`/`deleted[]` paths is caught (today such
a regression would slip through because only `GitBackend.restore` is exercised for those scenarios).

## Why

- **Closes the audit's only real finding.** The P1.M6.T1 audit (see research/audit_findings.md)
  confirmed all 8 F-revert-* scenarios are covered and the 3 PRD-flagged degenerate cases are fixed
  by the per-bug subtasks. The ONLY remaining gaps are these two cross-backend parity holes: the cas
  backend has DISTINCT restore code paths for fail-open (`failed[]`, cas.ts:1053) and delete
  (`deleted[]`, cas.ts:1073-1094 cas-mode tree-walk) that are never driven through the rewind tool in
  cas mode. A regression in either cas path — e.g. BUG-005's `skipped[]` work touched cas.restore
  around cas.ts:1040-1095 — would pass the current suite because every failopen/delete assertion
  flows through `GitBackend.restore`.
- **Mirrors the existing, proven pattern.** The git-backend counterparts (revert-git.test.ts:494 /
  595 / 661) already exist and pass; the cas house idiom (makeNonGitDir + nonGitMode:"cas") is used
  6× in the same file (F-revert-cas + F-revert-dirtyguard). Each new test is a mechanical
  git→cas-swap clone — no new harness, no new helpers, no new fakes.
- **Honors the spec's both-backend intent.** spec/10 §2.1 rows F-revert-failopen (103) and
  F-revert-delete (104) describe backend-agnostic behavior, but the v1.2 feature ships TWO backends
  with separate implementations; the PRD overview explicitly attributes the original test weakness to
  "integration tests only exercis[ing] degenerate/contrived paths." Exercising both backends for the
  scenarios with backend-specific restore logic is the direct remediation.
- **Cheap and safe.** Pure test additions (no production source touched), no new deps, no new temp-dir
  lifecycle (the file's existing `dirs.push(...)` + afterEach `rmSync` covers cleanup). The 3 tests
  are self-contained, skip under root (failopen — chmod is a no-op for root), and need no `sed`.

## What

**User-visible behavior**: None — test-only item. No production code, config, marker schema, or API
surface changes.

**Technical change**: Add 3 `it()` blocks to `test/integration/revert-cas.test.ts` inside the existing
`describe(...)` at L315, after the F-revert-dirtyguard test (which ends just before the closing `});`
at L502). Each block drives the REAL rewind tool (via the file's `run` helper) against a REAL
non-git temp dir + REAL `CasBackend` (via `detectAndCreate`), asserting `CasBackend.restore`'s
`failed[]` / `deleted[]` contract through the persisted `mulligan:rewind` marker (via `rewindMarker`).

### Success Criteria

- [ ] `test/integration/revert-cas.test.ts` contains a new `it("F-revert-failopen (cas): …")` that
      creates 2 pre-existing files, mutates both, chmods ONE 0o444, rewinds with
      `revert_file_changes:true`, and asserts: unlocked file reverted; locked file NOT reverted
      (stays mutated) + in `marker.revert.failedFiles`; firstText contains "Reverted" and NOT
      "Mulligan: refused". Skips under root (chmod ineffective for root).
- [ ] `test/integration/revert-cas.test.ts` contains a new `it("F-revert-delete (cas, off): …")` that
      creates a file in-span, rewinds with `delete_created_files:true` under
      `allowDeleteCreatedFiles:false`, and asserts: created file STILL EXISTS; `marker.revert.deletedFiles`
      equals `[]`; rewind succeeds.
- [ ] `test/integration/revert-cas.test.ts` contains a new `it("F-revert-delete (cas, on): …")` that
      creates a file in-span, rewinds with `delete_created_files:true` under
      `allowDeleteCreatedFiles:true`, and asserts: created file GONE; `marker.revert.deletedFiles`
      contains the created file's repo-relative path; rewind succeeds.
- [ ] All 3 new tests use the file's EXISTING helpers (makeNonGitDir/makeStorage/setConfig/
      detectAndCreate/getRuntime/makePi/makeCtx/run/firstText/rewindMarker + the msgEntry/asstWrite/
      result factories) — NO new helper, NO new import.
- [ ] `npm test`: full suite green (1277+ pre-existing + 3 new).
- [ ] `npm run typecheck`: 0 errors.
- [ ] `git diff --name-only`: ONLY `test/integration/revert-cas.test.ts`.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the
verbatim git counterparts to clone (revert-git.test.ts:494 failopen, :595/:661 delete-off/delete-on —
reproduced structurally in the Implementation Tasks); (b) the verbatim cas house idiom (the existing
F-revert-cas test at revert-cas.test.ts:321 — same setup, same helpers, same assertions shape); (c)
the verified CasBackend.restore mechanics (failed[] via cas.ts:1053 writeFile-EACCES; deleted[] via
cas.ts:1086/1090 tree-walk; the double-gate at cas.ts:1057/1078); (d) the exact placement (inside the
L315 describe, after the dirtyguard test, before the L502 `});`); (e) the chmod-FILE (not dir) gotcha
for cas (cas writes in-place via fs.writeFile, unlike git checkout which unlinks+recreates). No
inference or guessing required.

### Documentation & References

```yaml
# MUST READ — the scenario definitions this audit closes against
- docfile: spec/10-testing.md
  section: "§2.1 — F-revert-* scenario rows (lines 101–108)"
  why: the 8 F-revert-* scenarios. Rows 103 (F-revert-failopen: lock/chmod → rewind succeeds, locked
    file in failedFiles, rest reverted) and 104 (F-revert-delete: both allowDeleteCreatedFiles
    branches) are the two this item adds cas-backend coverage for.
  critical: the scenarios are backend-agnostic in the spec; this item ensures the cas backend's
    DISTINCT restore implementation of each is actually exercised end-to-end.

# MUST READ — the canonical git counterparts to CLONE (swap git→cas)
- file: test/integration/revert-git.test.ts
  why: the failopen test (L494) + the two delete tests (L595 off, L661 on) are the structural
    templates. Each new cas test mirrors one of these with: makeNonGitDir (not makeRepo) + NO git
    commit + nonGitMode:"cas" + NO .git-byte-identical assertion (cas has no user .git to protect).
  pattern: SETUP (temp repo + pre-span files) → setConfig(revert enabled + storageDir) →
    detectAndCreate → rt.store=store → makePi/makeCtx(contextEntries) → turnStartCaptureHandler →
    [in-span mutation] → agentEndCaptureHandler → run(rewind) → ASSERT files + rewindMarker.
  gotcha: the git failopen test locks a SUBDIR (git checkout unlinks+recreates → dir lock blocks it).
    cas restore writes files IN PLACE via fs.writeFile (cas.ts:1050) → lock the FILE 0o444 instead
    (open(O_WRONLY) EACCES → failed[]). Do NOT copy the git subdir-lock blindly.

# MUST READ — the cas house idiom + helper roster (clone the F-revert-cas test's setup)
- file: test/integration/revert-cas.test.ts
  why: the existing F-revert-cas test (L321) + F-revert-dirtyguard test (L432) are the cas-mode
    setup templates already in THIS file — same helpers, same setConfig, same detectAndCreate→git-less
    flow. The new tests go in the SAME describe (L315), right after the dirtyguard test.
  pattern: makeNonGitDir("rev-xxx-") → writeFileSync pre-span files → makeStorage() →
    setConfig({revert:{enabled:true, nonGitMode:"cas", storageDir}}) → detectAndCreate(repoDir,…)
    (assert backend "cas") → getRuntime(sid); rt.store=store → makePi()/makeCtx() → capture hooks →
    run → rewindMarker(appended).revert?.field assertions.
  gotcha: setConfig MERGES partial over DEFAULT_CONFIG (revert-cas header "CRITICAL #11"). The
    storageDir MUST be a SEPARATE temp dir NOT inside the repo (config rejects inside-cwd → NoOpStore).
    rt.store MUST be assigned BEFORE the capture hooks (they self-gate on rt.store).

# MUST READ — the CasBackend.restore code paths being exercised (proves the tests hit real cas logic)
- file: src/snapshot/cas.ts
  section: "async restore (L1004) — branches (a) skipped (L1035), (b) reverted/failed (L1047-1069),
    (c) cas-mode tree-walk delete (L1073-1094)"
  why: confirms the cas paths the tests target. failed[] is pushed at L1044 (escape), L1053 (writeFile
    EACCES — the failopen target), L1068 (unlink EACCES). deleted[] at L1064 + L1086/L1090 (tree-walk —
    the delete target). The double-gate `opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles`
    is at L1057-1058 and L1078-1079.
  critical: cas restore is BEST-EFFORT (never rejects — the try/catch at the outer level swallows;
    per-path failures go to failed[] and restore still resolves). This is the E27 contract the
    failopen test asserts (rewind SUCCEEDS despite the locked file). cas-mode whole-tree capture at
    turn_start means a file created in-span is ABSENT from the beforeRef manifest → tree-walk (c)
    finds + unlinks it (the delete test's mechanism).

# READ-ONLY — the rewind-tool→store delete plumbing (confirms backend-agnostic)
- file: src/tools/rewind.ts
  why: L818 PROCEED gate `revert_file_changes || delete_created_files`; L880 passes
    `deleteCreatedFiles: params.delete_created_files === true` verbatim to store.restore; the
    allowDeleteCreatedFiles half of the double-gate is INSIDE the backend (L867-869 comment). Confirms
    the delete tests' flow works identically to the git counterparts.
  critical: for a delete-only rewind (revert_file_changes unset), the turn checkpoint's afterRef is
    still set (agent_end capture) so the dirty guard runs — but with no external edits it is CLEAN
    (changedPaths ⊆ afterRef-manifest ⇒ dirtyCheck returns []), so PROCEED → restore. Same as git.

# READ-ONLY — the audit that scoped this item
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M6T1S1/research/audit_findings.md
  why: the full 8-scenario coverage map + the cross-backend gap analysis + the OUT-OF-SCOPE note
    (cas-reload is NOT added — covered by P1.M1.T1.S2; the rebuild path is backend-agnostic).

# PARALLEL ITEM (disjoint — for non-conflict awareness, NOT for editing)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T3S1/PRP.md
  why: P1.M5.T3.S1 (BUG-007) edits src/snapshot/git.ts + src/snapshot/cas.ts has() + test/git.test.ts
    + test/cas.test.ts. Disjoint from this item (which edits ONLY test/integration/revert-cas.test.ts).
    Safe to merge — no file overlap, no shared mutable test state.
```

### Current Codebase tree (relevant slice)

```bash
test/integration/
  revert-git.test.ts        # READ-ONLY — failopen (L494) + delete-off (L595) + delete-on (L661) templates
  revert-cas.test.ts        # EDIT — +3 it() blocks inside the L315 describe (after the dirtyguard test, before L502 `});`)
  revert-edge.test.ts       # READ-ONLY — granularity (L395) + reload (L455), already complete
  revert-explicit.test.ts   # READ-ONLY — explicit-paths (L318/L428), already complete (P1.M3.T1.S3)
src/snapshot/
  cas.ts                    # READ-ONLY — the restore code paths the tests exercise (L1004-1098)
  git.ts                    # READ-ONLY — the parallel restore code paths (already integration-tested)
  store.ts                  # READ-ONLY — SnapshotStore interface + RestoreResult shape
src/tools/
  rewind.ts                 # READ-ONLY — backend-agnostic delete plumbing (L818, L867-880)
```

### Desired Codebase tree with files to be changed

```bash
test/integration/revert-cas.test.ts   # MODIFIED — +3 it() blocks (failopen cas; delete cas off; delete cas on)
# (no new files; no production-source change; no config/marker/API change)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — cas failopen locks the FILE, not the dir. CasBackend.restore writes pre-existing
//   manifest files back IN PLACE via `await this.fs.writeFile(abs, content)` (cas.ts:1050). To make
//   that fail → chmod the FILE 0o444 (open with O_WRONLY|O_CREAT|O_TRUNC → EACCES → failed[] at
//   cas.ts:1053). The git failopen test (revert-git:494) locks a SUBDIR because `git checkout`
//   unlinks+recreates (dir lock blocks the unlink) — DO NOT copy that subdir approach for cas; a
//   read-only dir does NOT block an in-place writeFile to an existing file.

// CRITICAL #2 — skip the failopen test under root. chmod 0o444 is a no-op for root (root ignores the
//   read-only bit → the file WOULD revert and failedFiles would be empty, failing the assertions).
//   Mirror the git failopen root guard: `if (process.getuid && process.getuid() === 0) { console.warn(
//   "[revert-cas] running as root — skipping F-revert-failopen (chmod is ineffective for root)");
//   return; }`. The two delete tests do NOT need the root guard (no chmod).

// CRITICAL #3 — setConfig MERGES partial over DEFAULT_CONFIG (revert-cas header "CRITICAL #11").
//   `{revert:{enabled:true, nonGitMode:"cas", storageDir}}` deep-merges; you do NOT need to restate
//   the other revert fields. But the file's beforeEach does setConfig(undefined) + clearAll() before
//   each test, so each new test starts from a clean DEFAULT_CONFIG — set the config you need at the
//   top of each test.

// CRITICAL #4 — storageDir MUST be a SEPARATE temp dir, NOT inside the repo. config rejects a
//   storageDir that resolves inside cwd → NoOpStore (backend "none"). Use the file's makeStorage()
//   helper (a fresh `mkdtempSync(join(tmpdir(),"mulligan-store-"))`) and push it onto `dirs` for
//   afterEach cleanup. Same as every existing test in this file.

// CRITICAL #5 — assign rt.store BEFORE the capture hooks. The capture hooks self-gate on
//   `rt.store` being defined (they no-op otherwise). Pattern: `const rt = getRuntime(sid);
//   rt.store = store;` BEFORE turnStartCaptureHandler. Same as revert-cas:321.

// CRITICAL #6 — the "refused" substring trap. The rewind PROCEED summary line contains
//   "0 refused (see log)" even on success. To assert NON-refusal, check the REFUSAL PREFIX
//   "Mulligan: refused" (never bare "refused"). To assert a refuse, check the specific clause. The
//   git tests (revert-git:590/729) document this. For these 3 cas tests, all three PROCEED (no
//   refusal), so assert `firstText(res)` does NOT contain "Mulligan: refused" AND contains "Reverted".

// CRITICAL #7 — the cas delete target file must be created AFTER turn_start and BEFORE agent_end
//   (the span). Cas-mode turn_start capture walks the WHOLE tree (§4.1), so a file present at
//   turn_start IS in the beforeRef manifest (would NOT be deleted). Creating it in-span keeps it
//   OUT of the beforeRef manifest → the cas tree-walk delete (cas.ts:1073-1094) finds it
//   (present-now, not-in-manifest) and unlinks it. Same in-span-create sequencing as the git delete
//   tests (revert-git:625/691).

// CRITICAL #8 — marker field access via rewindMarker. The revert-cas file uses `rewindMarker(appended)`
//   and reads `.revert?.field` (see revert-cas:485-488). For failedFiles use
//   `rewindMarker(appended).revert?.failedFiles`; for deletedFiles use `.revert?.deletedFiles`.
//   (revert-git additionally has a rewindRevert helper that returns the revert block directly — that
//   helper is NOT in revert-cas; use rewindMarker + .revert?. here.)

// GOTCHA #9 — repo-relative POSIX paths. extractFileLedger records file_path verbatim from the tool
//   call input, and CasBackend.restore restores repo-relative paths. Use POSIX relative paths in the
//   contextEntries (e.g. "a.ts", "new.ts") and the same in marker assertions. (The git delete tests
//   use "new.ts"; mirror that.)

// GOTCHA #10 — NO sed needed for any of the 3 tests. All mutations are writeFileSync. The
//   sedAvailable() guard + sed() helper are NOT needed. (F-revert-cas and F-revert-dirtyguard in
//   this file use sed; the new tests do not.)

// GOTCHA #11 — the afterEach cleanup. The file's afterEach rmSync's every dir pushed onto `dirs`.
//   Push BOTH makeNonGitDir(...) and makeStorage() results onto `dirs` so they are cleaned up. Same
//   as every existing test.
```

## Implementation Blueprint

### Data models and structure

No data-model change. No new types, no new exports, no production change. This is three `it()` blocks
added to an existing `describe` in an existing test file, using the file's existing helpers. The
`RestoreResult` shape (`{reverted, deleted, failed, skipped, refused}`) and the `mulligan:rewind`
marker's `revert` block (`{backend, revertedFiles, deletedFiles, failedFiles, …}`) are unchanged and
already consumed by the existing tests.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the F-revert-failopen (cas) test to test/integration/revert-cas.test.ts
  - PLACE: inside the describe at L315, AFTER the F-revert-dirtyguard test (before the closing `});`
    at L502). Precede it with a `// ── F-revert-failopen (spec/10 §2.1 row F-revert-failopen / E27) ─`
    section comment (mirror the existing section-comment style in revert-git.test.ts:491).
  - CLONE the structure of revert-git.test.ts:494 (git failopen) but swap git→cas:
      * SETUP: `const repoDir = makeNonGitDir("rev-cas-failopen-"); dirs.push(repoDir);` + TWO
        pre-existing files `a.ts`="A1\n" and `b.ts`="B1\n" (NO makeRepo, NO git add/commit — non-git).
      * `const preSpan = { a: readFileSync(join(repoDir,"a.ts"),"utf8"), b: readFileSync(join(repoDir,"b.ts"),"utf8") };`
      * `const storageDir = makeStorage(); dirs.push(storageDir);`
      * `setConfig({ revert: { enabled: true, nonGitMode: "cas", storageDir } });`
      * `const store = await detectAndCreate(repoDir, getConfig().revert);`
        `expect(store.describe().backend).toBe("cas");`
      * `const sid = "s-cas-failopen"; const rt = getRuntime(sid); rt.store = store;`
      * `const { appended, pi } = makePi();`
      * contextEntries: two writes so ledger.modifiedFiles = [a.ts, b.ts]:
          msgEntry(user("rewrite the files")), msgEntry(asstWrite("w1","a.ts")), msgEntry(result("w1")),
          msgEntry(asstWrite("w2","b.ts")), msgEntry(result("w2")), msgEntry(asst("final")), msgEntry(result("final"))
      * `const { ctx } = makeCtx({ sessionId: sid, contextEntries });`
      * ROOT GUARD (FIRST, before setup — mirror revert-git:500): `if (process.getuid &&
        process.getuid()===0){ console.warn("[revert-cas] running as root — skipping
        F-revert-failopen (chmod is ineffective for root)"); return; }`
      * CAPTURE turn_start: `await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()},ctx);`
        `expect(rt.snapshots?.get("turn")?.beforeRef).toBe("turn");`
      * MUTATE both in-span: writeFileSync(a.ts,"A2\n"); writeFileSync(b.ts,"B2\n");
      * LOCK b.ts (the failopen target): `chmodSync(join(repoDir,"b.ts"), 0o444);`
        (import chmodSync from "node:fs" — ADD it to the existing node:fs import block at L54-60).
      * CAPTURE agent_end: `await agentEndCaptureHandler({type:"agent_end",messages:[]},ctx);`
        `expect(rt.snapshots?.get("turn")?.afterRef).toBe("turn-after");`
      * DRIVE: `const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn",
        revert_file_changes: true }, "final");`
      * ASSERT rewind SUCCEEDS (E27 best-effort): `expect(firstText(res)).not.toContain("Mulligan:
        refused");` `expect(firstText(res)).toContain("Reverted");`
      * ASSERT a.ts (unlocked) REVERTED: `expect(readFileSync(join(repoDir,"a.ts"),"utf8")).toBe(preSpan.a);`
      * ASSERT b.ts (locked) NOT reverted (stays the mutated "B2\n"):
        `expect(readFileSync(join(repoDir,"b.ts"),"utf8")).not.toBe(preSpan.b);`
        `expect(readFileSync(join(repoDir,"b.ts"),"utf8")).toBe("B2\n");`
      * ASSERT marker: `const revert = rewindMarker(appended).revert;`
        `expect(revert?.backend).toBe("cas");`
        `expect(revert?.failedFiles).toEqual(expect.arrayContaining(["b.ts"]));`
        `expect(revert?.revertedFiles).toEqual(expect.arrayContaining(["a.ts"]));`
      * CLEANUP the lock so afterEach rmSync does not EACCES: wrap the chmod'd file in a try/finally
        that restores 0o644 on b.ts (e.g. `try { … } finally { chmodSync(join(repoDir,"b.ts"),0o644); }`
        around the assertions, OR chmod back before the test returns). If omitted, the afterEach
        rmSync(repoDir) may fail to remove the read-only b.ts on some platforms.
  - NAMING: `it("F-revert-failopen (cas): read-only-locked file lands in failedFiles; the rest
    reverted; rewind SUCCEEDS (E27 — CasBackend.restore best-effort)", async () => { … });`
  - COVERAGE: exercises CasBackend.restore's failed[] push at cas.ts:1053 (writeFile EACCES in the
    reverted branch) end-to-end through the rewind tool — currently only GitBackend.restore's failed[]
    path is integration-tested.

Task 2: ADD the F-revert-delete (cas, config OFF) test to test/integration/revert-cas.test.ts
  - PLACE: after Task 1's test, with a `// ── F-revert-delete (spec/10 §2.1 row F-revert-delete — the
    double-gate) ─` section comment.
  - CLONE revert-git.test.ts:595 (git delete-off) but swap git→cas:
      * SETUP: `const repoDir = makeNonGitDir("rev-cas-delete-off-"); dirs.push(repoDir);` + ONE
        pre-existing file `existing.txt`="E1\n" (so the tree is non-empty; NO git commit).
      * `const storageDir = makeStorage(); dirs.push(storageDir);`
      * `setConfig({ revert: { enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: false,
        storageDir } });`  (config gate OFF)
      * detectAndCreate → assert backend "cas"; getRuntime + rt.store = store; makePi().
      * contextEntries: a single write of the in-span-created file:
          msgEntry(user("create a file")), msgEntry(asstWrite("w1","new.ts")), msgEntry(result("w1")),
          msgEntry(asst("final")), msgEntry(result("final"))
      * makeCtx; CAPTURE turn_start (beforeRef — new.ts does NOT exist yet); mutate: create the file
        `writeFileSync(join(repoDir,"new.ts"),"CREATED\n");`; CAPTURE agent_end.
      * DRIVE: `const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn",
        delete_created_files: true }, "final");`  (per-call flag ON, config gate OFF)
      * ASSERT created file STILL EXISTS: `expect(existsSync(join(repoDir,"new.ts"))).toBe(true);`
      * ASSERT marker.deletedFiles empty: `const revert = rewindMarker(appended).revert;`
        `expect(revert?.deletedFiles).toEqual([]);`
      * ASSERT rewind succeeds: `expect(firstText(res)).not.toContain("Mulligan: refused");`
  - NAMING: `it("F-revert-delete (cas, off): deletion REFUSED when allowDeleteCreatedFiles is false
    (file stays; deletedFiles empty)", async () => { … });`
  - COVERAGE: exercises the cas double-gate (cas.ts:1057-1058 AND 1078-1079) —
    deleteCreatedFiles:true but cfg.allowDeleteCreatedFiles:false ⇒ NO unlink ⇒ deletedFiles empty.

Task 3: ADD the F-revert-delete (cas, config ON) test to test/integration/revert-cas.test.ts
  - PLACE: after Task 2's test (same section comment group).
  - CLONE revert-git.test.ts:661 (git delete-on) but swap git→cas (mirror Task 2 exactly EXCEPT):
      * SEPARATE repo/store/runtime: `makeNonGitDir("rev-cas-delete-on-")` + a fresh makeStorage()
        + a fresh sid "s-cas-delete-on" (do NOT reuse Task 2's captured refs — a second turn_start
        would GC the prior turn/* refs).
      * `setConfig({ revert: { enabled: true, nonGitMode: "cas", allowDeleteCreatedFiles: true,
        storageDir } });`  (config gate ON)
      * same contextEntries (write new.ts); CAPTURE turn_start; create new.ts in-span; CAPTURE agent_end.
      * DRIVE: `const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn",
        delete_created_files: true }, "final");`  (both flags ON)
      * ASSERT created file GONE: `expect(existsSync(join(repoDir,"new.ts"))).toBe(false);`
      * ASSERT marker.deletedFiles populated: `const revert = rewindMarker(appended).revert;`
        `expect(revert?.deletedFiles).toEqual(expect.arrayContaining(["new.ts"]));`
      * ASSERT rewind succeeds: `expect(firstText(res)).not.toContain("Mulligan: refused");`
  - NAMING: `it("F-revert-delete (cas, on): deletion PERFORMED when allowDeleteCreatedFiles is true
    (file gone; deletedFiles populated)", async () => { … });`
  - COVERAGE: exercises CasBackend.restore's CAS-MODE-ONLY tree-walk delete (cas.ts:1073-1094: walkTree
    unlinks present-not-in-beforeRef files) end-to-end through the rewind tool — currently only
    GitBackend.restore's deleted[] path (git.ts:842 ls-files --others) is integration-tested.

Task 4 (IMPORT): ADD chmodSync to the node:fs import block (test/integration/revert-cas.test.ts L54-60)
  - FIND: the existing `import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from
    "node:fs";`
  - REPLACE with: `import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync }
    from "node:fs";`
  - WHY: Task 1's failopen test chmods b.ts 0o444 (and restores 0o644 in finally). No other new import.

Task 5 (OUT OF SCOPE — do NOT do): NO production-source change (cas.ts/git.ts/rewind.ts/capture.ts/
  store.ts untouched). NO new test file. NO change to revert-git.test.ts / revert-edge.test.ts /
  revert-explicit.test.ts (their coverage is already complete). NO cas-reload test (reload is covered
  by P1.M1.T1.S2; the rebuild path is backend-agnostic — see research/audit_findings.md OUT OF SCOPE).
  NO unit-test change (test/cas.test.ts already covers the failed[] path via a mock at L1293; this
  item adds the end-to-end-through-rewind-tool coverage, not more unit coverage). If `git diff
  --name-only` shows anything beyond test/integration/revert-cas.test.ts, STOP and revert those hunks.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the cas test setup skeleton (clone from revert-cas.test.ts:321 F-revert-cas). Every new
//   test in this describe follows this shape (git-less, REAL CasBackend, REAL hooks, REAL rewind tool):
//   const repoDir = makeNonGitDir("rev-cas-XXX-"); dirs.push(repoDir);
//   writeFileSync(join(repoDir, "<pre-span file>"), "<content>\n");           // pre-span state
//   const storageDir = makeStorage(); dirs.push(storageDir);                  // SEPARATE, not in repo
//   setConfig({ revert: { enabled: true, nonGitMode: "cas", <gates>, storageDir } });
//   const store = await detectAndCreate(repoDir, getConfig().revert);
//   expect(store.describe().backend).toBe("cas");
//   const sid = "s-cas-XXX"; const rt = getRuntime(sid); rt.store = store;    // BEFORE the hooks
//   const { appended, pi } = makePi();
//   const contextEntries = [ msgEntry(user("…")), msgEntry(asstWrite("w1","…")), msgEntry(result("w1")),
//                            msgEntry(asst("final")), msgEntry(result("final")) ];
//   const { ctx } = makeCtx({ sessionId: sid, contextEntries });
//   await turnStartCaptureHandler({type:"turn_start",turnIndex:0,timestamp:Date.now()}, ctx);
//   /* …in-span mutation(s)… */
//   await agentEndCaptureHandler({type:"agent_end",messages:[]}, ctx);
//   const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn", /* revert/delete flags */ }, "final");
//   /* …assertions on readFileSync + firstText(res) + rewindMarker(appended).revert?.field… */

// CRITICAL — failopen: chmod the FILE, restore perms in finally. cas restore writes b.ts IN PLACE
//   (cas.ts:1050 fs.writeFile); a 0o444 file blocks the open(O_WRONLY) ⇒ EACCES ⇒ failed[] (cas.ts:1053).
//   The read-only file would ALSO block the afterEach rmSync(repoDir) on strict platforms, so restore
//   0o644 in a finally:
//   chmodSync(join(repoDir,"b.ts"), 0o444);
//   try {
//     const res = await run(pi, ctx, { note: VALID_NOTE, granularity:"last_turn", revert_file_changes:true }, "final");
//     /* …assertions… */
//   } finally {
//     chmodSync(join(repoDir,"b.ts"), 0o644);   // let afterEach rmSync clean up
//   }

// CRITICAL — delete: the created file must be absent from the beforeRef manifest. Cas-mode turn_start
//   capture walks the WHOLE tree (§4.1), so create new.ts AFTER turnStartCaptureHandler (in-span).
//   On restore with both flags ON, the cas tree-walk (cas.ts:1073-1094) finds new.ts present-now +
//   not-in-beforeRef-manifest ⇒ unlink ⇒ deleted[]. With the config gate OFF, the double-gate
//   (cas.ts:1057/1078) is false ⇒ no unlink ⇒ file stays, deletedFiles empty.

// CRITICAL — all 3 tests PROCEED (no refusal). Assert the NON-refusal PREFIX, never bare "refused"
//   (the PROCEED summary line contains "0 refused (see log)"):
//   expect(firstText(res)).not.toContain("Mulligan: refused");
//   expect(firstText(res)).toContain("Reverted");   // or "rewound last_turn"
```

### Integration Points

```yaml
TEST FILE (test/integration/revert-cas.test.ts):
  - add: 3 it() blocks inside the existing describe at L315 (after the dirtyguard test, before L502 `});`).
  - add: chmodSync to the node:fs import block (L54-60) — the ONLY import change.
PRODUCTION SOURCE: UNCHANGED — no src/ file is touched. CasBackend.restore's failed[]/deleted[] paths
  (cas.ts:1053, 1086/1090) are EXERCISED by the new tests, not modified.
CONFIG: the new tests call setConfig per-test (merging over DEFAULT_CONFIG); no DEFAULT_CONFIG change.
MARKER SCHEMA: UNCHANGED — the tests READ marker.revert.failedFiles / deletedFiles (already populated
  by rewind.ts on the PROCEED branch); no schema field added.
PARALLEL ITEMS: NO overlap — P1.M5.T3.S1 (BUG-007) edits src/snapshot/{git,cas}.ts + test/{git,cas}.test.ts
  (disjoint from this item's single integration-test-file scope). Safe to merge.
DATABASE / ROUTES / API SURFACE: none.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (test files ARE typechecked; the new it() blocks use existing typed
# helpers, and chmodSync is already exported by node:fs — type-clean).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.

# Lint the edited file (the repo's lint config covers test/integration/*.test.ts).
npx eslint test/integration/revert-cas.test.ts   # if the repo lints tests; else skip
# (If the repo has no eslint or does not lint tests, this is a no-op — confirm via package.json scripts.)

# Confirm scope:
git diff --name-only
# EXPECTED: exactly test/integration/revert-cas.test.ts. If src/**, test/git.test.ts, test/cas.test.ts,
#   or any other revert-*.test.ts appears → OUT OF SCOPE; revert those hunks.
```

### Level 2: Unit/Component Tests (the edited file)

```bash
# Run the edited integration file in isolation (the 3 new tests + the 2 existing cas tests must pass).
npx vitest run test/integration/revert-cas.test.ts -v
# Expected: green. The new F-revert-failopen (cas) passes under non-root CI (chmod 0o444 blocks the
#   in-place writeFile → b.ts in failedFiles, a.ts reverted, rewind succeeds). Under root it SKIPS
#   (the root guard returns early — vitest reports it as passed/skipped, NOT failed). The 2 delete
#   tests pass unconditionally: off → new.ts stays + deletedFiles []; on → new.ts gone + deletedFiles
#   ⊇ {new.ts}. The 2 existing cas tests (F-revert-cas, F-revert-dirtyguard) stay green (unchanged).

# If failopen fails with b.ts REVERTED (failedFiles empty) under non-root — you chmod'd the wrong
#   target. cas restore writes the FILE in place (cas.ts:1050); chmod the FILE 0o444, NOT the dir.
#   (A read-only dir does NOT block an in-place writeFile to an existing file.)
# If failopen fails in afterEach with EACCES removing b.ts — you forgot to restore 0o644 in a finally.
#   Add `finally { chmodSync(join(repoDir,"b.ts"),0o644); }` around the assertions.
# If a delete test fails with new.ts still present under config-ON — new.ts was in the beforeRef
#   manifest (you created it BEFORE turn_start). Create it AFTER turnStartCaptureHandler (in-span).

# Run all 4 integration files together (no cross-test regression — separate sids + separate temp dirs).
npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-edge.test.ts test/integration/revert-explicit.test.ts -v
# Expected: green. The git/edge/explicit tests are UNCHANGED; the cas file has +3 tests.
```

### Level 3: Full Suite (System Validation)

```bash
# The full vitest suite — ALL pre-existing tests (1277+) + the 3 new tests.
npm test
# Expected: green. The bugfix work (P1.M1–P1.M5) is already merged/complete; this item adds only
#   tests, so the full suite count rises by exactly 3 (or 2 if failopen skips under root).
#   If ANY pre-existing test regresses, it is a symptom of an accidental production-source edit —
#   check `git diff --name-only` (should be ONLY test/integration/revert-cas.test.ts).
```

### Level 4: Creative & Domain-Specific Validation (audit re-verification)

```bash
# Re-verify the audit claim: every F-revert-* scenario is now exercised in BOTH backends where the
#   backend has a distinct restore code path. (Reasoning check — no command needed, but the grep
#   confirms the test count rose by 3 in the cas file:)
npx vitest run test/integration/revert-cas.test.ts 2>&1 | grep -cE "F-revert-(failopen|delete)"
# Expected: 3 (the 3 new tests' titles). (The 2 pre-existing cas tests are F-revert-cas +
#   F-revert-dirtyguard, which this grep excludes.)

# Coverage parity check (manual reasoning — the invariant this item establishes):
#   F-revert-failopen: git (revert-git:494) + cas (NEW) ✓ — both backends' failed[] paths exercised.
#   F-revert-delete:   git (revert-git:595/661) + cas (NEW) ✓ — both backends' deleted[] paths exercised.
#   F-revert-git/cas/explicit/dirtyguard/granularity/reload: already covered (audit table) ✓.
#   ⇒ All 8 spec/10 §2.1 F-revert-* scenarios exercised; no cas.restore code path validated only via git.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`: 0 errors.
- [ ] `npx vitest run test/integration/revert-cas.test.ts -v`: green (3 new + 2 existing).
- [ ] `npx vitest run test/integration/revert-*.test.ts -v`: green (no cross-file regression).
- [ ] `npm test`: full suite green (1277+ pre-existing + 3 new).
- [ ] `git diff --name-only`: ONLY `test/integration/revert-cas.test.ts`.

### Feature Validation

- [ ] New `F-revert-failopen (cas)` test: read-only-locked file in `marker.revert.failedFiles`, the
      unlocked file reverted, rewind SUCCEEDS (no "Mulligan: refused"); skips cleanly under root.
- [ ] New `F-revert-delete (cas, off)` test: created file STAYS, `marker.revert.deletedFiles === []`,
      rewind succeeds.
- [ ] New `F-revert-delete (cas, on)` test: created file GONE, `marker.revert.deletedFiles ⊇ {new.ts}`,
      rewind succeeds.
- [ ] All 3 tests reuse the file's existing helpers + cas house idiom (makeNonGitDir/nonGitMode:"cas")
      — no new helper, no new import beyond chmodSync.
- [ ] Audit re-verified: every F-revert-* scenario exercised; no cas.restore path validated only via git.

### Code Quality Validation

- [ ] The 3 new tests mirror their git counterparts' structure (clone-and-swap git→cas) — no new test
      pattern invented.
- [ ] Each new test is self-contained (separate repo + storage + sid; pushes both dirs onto `dirs` for
      afterEach cleanup).
- [ ] The failopen test restores the chmod'd file to 0o644 in a finally (no leaked read-only file that
      breaks afterEach rmSync).
- [ ] The delete tests create the target file IN-SPAN (after turn_start) so it is absent from the
      beforeRef manifest (the cas tree-walk delete mechanism).
- [ ] "Mulligan: refused" (the refusal PREFIX) is used for non-refusal assertions, never bare "refused".
- [ ] No production source, config, marker-schema, or API-surface change (scope respected).

### Documentation & Deployment

- [ ] No README / docs change (test-only item — the item's DOCS field is "none — test-only change").
- [ ] No config / env-var / API-surface / marker-schema change.
- [ ] Section comments precede each new test (mirror the existing `// ── F-revert-* ─` style).

---

## Anti-Patterns to Avoid

- ❌ **Don't lock the DIRECTORY for the cas failopen test.** CasBackend.restore writes pre-existing
  manifest files IN PLACE via `fs.writeFile(abs, content)` (cas.ts:1050); an in-place write to an
  existing file is NOT blocked by a read-only directory (dir perms only gate create/unlink). Lock the
  FILE 0o444 so `open(O_WRONLY|O_CREAT|O_TRUNC)` returns EACCES → failed[] (cas.ts:1053). The git
  failopen test (revert-git:494) locks a subdir ONLY because `git checkout` unlinks+recreates — that
  rationale does not transfer to cas.
- ❌ **Don't forget the root guard on the failopen test.** chmod 0o444 is a no-op for root (root
  ignores the read-only bit → b.ts WOULD revert → failedFiles empty → assertions fail). Mirror
  revert-git:500: `if (process.getuid && process.getuid()===0){ console.warn(…); return; }`. The 2
  delete tests need NO root guard (no chmod).
- ❌ **Don't forget to restore 0o644 in a finally.** A read-only b.ts can make the file's afterEach
  `rmSync(repoDir)` fail with EACCES on strict platforms (rm -rf honors the file's perms if the dir
  has the sticky bit / restricted delete). `try { …assertions… } finally { chmodSync(b.ts, 0o644); }`
  guarantees cleanup regardless of assertion outcome.
- ❌ **Don't create the delete target file before turn_start.** Cas-mode turn_start capture walks the
  WHOLE tree (§4.1); a file present at turn_start IS in the beforeRef manifest and would NOT be
  deleted by the tree-walk (cas.ts:1083 skips manifest files). Create new.ts AFTER
  turnStartCaptureHandler (in-span) so it is absent from the beforeRef manifest.
- ❌ **Don't reuse the delete-off test's repo/store/sid for delete-on.** A second turn_start on the
  same runtime GCs the prior turn/* refs. Use a fresh makeNonGitDir + makeStorage + sid for delete-on
  (mirror revert-git:661, which sets up a fully separate repo from :595).
- ❌ **Don't assert bare "refused".** The rewind PROCEED summary contains "0 refused (see log)" even on
  success. Use the REFUSAL PREFIX "Mulligan: refused" for non-refusal assertions (CRITICAL #6). All 3
  new tests PROCEED, so assert NOT "Mulligan: refused" AND contains "Reverted".
- ❌ **Don't add a cas-reload test or any production change.** Reload is COVERED by P1.M1.T1.S2
  (backend-agnostic rebuild path). This item is test-only, single-file (revert-cas.test.ts), +3 tests.
  If `git diff --name-only` shows src/** or another test file, revert.
- ❌ **Don't invent a new test harness.** The file already has makeNonGitDir/makeStorage/makePi/makeCtx/
  run/firstText/rewindMarker + the msgEntry/asstWrite/result factories. Reuse them verbatim — clone the
  F-revert-cas test (revert-cas:321) or the F-revert-dirtyguard test (revert-cas:432) for setup shape.
- ❌ **Don't add sedAvailable/sed to these tests.** All mutations are writeFileSync; sed is not needed.
  Adding a sedAvailable guard would needlessly skip the tests on systems without sed (the delete/failopen
  contracts have nothing to do with sed).

---

## Confidence Score

**9/10** — This is a test-only, single-file, +3-`it()`-block item where: (a) the audit is complete and
verified (all 8 F-revert-* scenarios mapped to exact file:line; the 3 PRD-flagged degenerate cases
confirmed fixed by per-bug subtasks; the 2 cross-backend gaps confirmed via reading
CasBackend.restore's source — failed[] at cas.ts:1053, deleted[] tree-walk at cas.ts:1073-1094, the
double-gate at cas.ts:1057/1078); (b) the 3 new tests are mechanical git→cas clones of EXISTING,
passing git counterparts (revert-git:494/595/661) using the cas house idiom already used 6× in the
target file (revert-cas:321/432); (c) the gotchas are pinned and non-obvious but mechanical
(chmod-FILE-not-dir for cas; root guard; restore-0o644-in-finally; create-delete-target-in-span;
separate repo per delete branch; "Mulligan: refused" prefix); (d) the rewind-tool→store delete
plumbing is verified backend-agnostic (rewind.ts:818/880 passes the per-call flag verbatim; the
allowDeleteCreatedFiles half-gate is inside the backend). The one residual risk: the failopen test's
chmod-0o444 → EACCES → failed[] chain depends on POSIX file-permission semantics that hold on all
non-root Linux/macOS CI but are SKIPPED under root (handled by the root guard) — so the test is
robust but root-CI runs only exercise 2 of the 3 new tests (the delete pair). No upstream
coordination needed (no production change; P1.M5.T3.S1 edits disjoint files).