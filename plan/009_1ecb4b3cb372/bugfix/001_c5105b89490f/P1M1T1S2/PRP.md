# PRP — CasBackend: accept walkTree `st` param + add maxFileBytes size guard in restore() delete step (P1.M1.T1.S2)

## Goal

**Feature Goal**: Make CasBackend's `restore()` delete step (`'cas'` whole-tree mode) share the same
deterministic defense-in-depth `maxFileBytes` safety floor as GitBackend (P1.M1.T1.S1): any
delete-candidate whose CURRENT byte size exceeds `cfg.revert.maxFileBytes` is SPARED (skip `unlink`),
independently of the `manifest.skipped` round-trip. This is belt-and-suspenders — CAS is already immune
to the GitBackend note-write-failure window, but the guard makes both backends behave identically on the
safety floor and closes the residual "oversize at restore but absent from manifest.skipped" case.

**Deliverable**: A tiny, surgical edit to `src/snapshot/cas.ts` (one callback signature param + one
`if` line, no DI seam, no interface/type/config change) PLUS one new TDD unit test in `test/cas.test.ts`
that forces the belt-and-suspenders path (oversize delete-candidate NOT in `manifest.skipped`) and proves
it is spared.

**Success Definition**:
- `npm run typecheck` (tsc --noEmit) passes.
- New unit test in `test/cas.test.ts` passes and FAILS without the one-line guard (the oversize
  delete-candidate is unlinked → `fileEntries.has(...)` is false → assertion fails).
- The existing happy-path spare test (`test/cas.test.ts:1441` OVERSIZE-DELETE) and the existing
  integration test (`test/integration/revert-cas.test.ts:750` F-revert-delete-oversize) STILL pass
  unchanged (no behavior change — the new guard runs AFTER the `spare.has(rel)` check).
- `npm test` full suite green. No production file other than `src/snapshot/cas.ts` is touched.

## Why

- BUG-001 (plan/009 PRD): `delete_created_files` silently deletes pre-existing files that exceed
  `revert.maxFileBytes` (irreversible data loss; spec/14 §2 guarantee #4 violation). The PRIMARY fix
  (the `spare` Set built from `manifest.skipped`) is ALREADY LANDED (commit `ec5ad32`) in both backends.
- The residual gap R1 (GitBackend note-write-failure window) is closed by sibling task **P1.M1.T1.S1**
  (GitBackend `stat` DI seam + size guard). CAS is immune to R1 (its manifest `writeFile` is the last
  step before `return label`; a failure → capture returns `null` → no ref to restore from → delete step
  never runs). See `architecture/system_context.md` §"Why CAS is immune".
- THIS task (S2) adds the CasBackend mirror of the size guard purely for **uniformity** ("makes both
  backends share the same deterministic safety floor"). It costs one signature tweak + one line. It also
  closes the minor residual case where a delete-candidate is oversize AT RESTORE yet absent from
  `manifest.skipped` (e.g. a file absent at capture that grew beyond `maxFileBytes` by restore, or any
  manifest drift) — for which the `spare` Set offers no protection.

## What

User-visible behavior: NONE (internal implementation detail; no config/API/exported-type change).

Code-visible behavior of CasBackend `restore()` step (c), the `'cas'`-mode `deleteCreatedFiles` walk:
- The `walkTree` visit callback now ACCEPTS the already-computed `st: {size, mtimeMs}` (it was being
  dropped).
- Immediately after the existing `if (spare.has(rel)) return;` (manifest.skipped happy-path spare), an
  oversize candidate (`st.size > this.cfg.maxFileBytes`) is SPARED (`return`), so it is never `unlink`-ed
  and never pushed to `result.deleted`. This is independent of the manifest round-trip.

### Success Criteria

- [ ] `cas.ts:1123` callback is `async (rel, abs, st) =>` (accepts `st`).
- [ ] After `if (spare.has(rel)) return;` (cas.ts:1125), `if (st.size > this.cfg.maxFileBytes) return;`
      is present (defense-in-depth spare).
- [ ] New unit test in `test/cas.test.ts` proves an oversize delete-candidate NOT in `manifest.skipped`
      is spared (not in `result.deleted`, `unlink` not called); a small span creation in the same restore
      IS deleted (guard did not over-fire).
- [ ] Existing `OVERSIZE-DELETE` test (`test/cas.test.ts:1441`) + `F-revert-delete-oversize`
      (`test/integration/revert-cas.test.ts:750`) still pass.
- [ ] `npm run typecheck` + `npm test` green; only `src/snapshot/cas.ts` + `test/cas.test.ts` changed.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase gets, from this PRP + the referenced files: the exact
file and line numbers to edit, the exact one-line insertion and signature change, the proof that `st` is
already passed by `walkTree` (no DI seam), the verified mutable-`CasFs` test idiom to mirror (with the
actual helper names `BASE_CFG`/`makeBackend`/inline `fileEntries`+`childMap` fake — correcting the task
brief's "makeStateFs/makeStateBackend" names), the exact new-test scenario + assertions, and the reason
the bare `return` is chosen over a `result.skipped` push.

### Documentation & References

```yaml
# MUST READ — the authoritative fix direction (CasBackend section is this task's spec)
- docfile: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/architecture/residual_risk_analysis.md
  why: "Fix Direction — CasBackend" gives the EXACT one-line change; "CAS contrast" proves CAS is immune to R1.
  section: "Fix Direction — Restore-Time maxFileBytes Size Guard" → "CasBackend implementation (src/snapshot/cas.ts)"
  critical: |
    Prescribes: change `async (rel, abs) =>` → `async (rel, abs, st) =>`; after `if (spare.has(rel)) return;`
    add `if (st.size > this.cfg.maxFileBytes) return;`. NO new DI seam — `st` is already passed positionally.

- docfile: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/architecture/system_context.md
  why: "Why CAS is immune" + "Residual HIGH-Severity Gap" — explains why this is belt-and-suspenders only.
  section: "Why CAS is immune to the note-write failure" + "Recommended Fix — Defense-in-Depth"
  critical: CAS manifest writeFile is the LAST step before `return label` → throw ⇒ null ⇒ no restore ref.

- file: src/snapshot/cas.ts
  why: THE file under edit. Verified line-exact this session.
  section: "walkTree (~411-440)" + "restore() delete step (~1110-1145)" + "capture oversize→skipped (~617-621)" + "manifest write (~546-560)"
  pattern: |
    walkTree visit type: (rel, abs, st:{size,mtimeMs}) — already calls this.fs.stat(abs) + passes st (line ~437).
    restore delete callback (~1123): `async (rel, abs) =>` DROPS st. spare Set at ~1119 from manifest.skipped.
    `if (manifest.files[rel]) return;` (~1124) then `if (spare.has(rel)) return;` (~1125).
    capture: `if (st.size > this.cfg.maxFileBytes) { skipped.push(rel); console.warn(...); return; }` (~617-621).
    result.skipped already populated from manifest.skipped at ~1065 (`result.skipped.push(...(manifest.skipped ?? []))`).
  gotcha: |
    The 'cas'-mode delete walk is GATED on `opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles &&
    this.cfg.nonGitMode === "cas"` — explicit-paths mode does NOT walk (its created files are existed:false entries).
    So the test MUST use nonGitMode:"cas".

- file: test/cas.test.ts
  why: THE test file. Verified helper names + mutable-fake idiom (task brief's "makeStateFs" names are wrong).
  section: "BASE_CFG (~46-55)" + "makeBackend (~59)" + "mutable CasFs fake (~1361, ~1441)"
  pattern: |
    BASE_CFG: MulliganConfig["revert"] { enabled:true, nonGitMode:"cas", allowDeleteCreatedFiles:false,
      storageDir:"/fake/store", maxFileBytes:262144, ... }. Override per-test: { ...BASE_CFG, maxFileBytes:256, ... }.
    Inline mutable CasFs fake: `fileEntries: Map<absPath,Buffer>` + `childMap: Map<parentAbs,Map<name,"file"|"dir">>`;
    `stat` returns { size: c.length, mtimeMs }; `unlink` deletes from both maps; `addFile(rel,Buffer)` helper.
    The OVERSIZE-DELETE test at :1441 is the direct template — MIRROR its fake, differ only in WHEN the big file is added.

- file: test/integration/revert-cas.test.ts
  why: existing happy-path integration test that MUST still pass (no edit needed — just don't break it).
  section: "F-revert-delete-oversize (cas) (~750)"
  pattern: preexisting-big.bin = "X".repeat(1000), maxFileBytes:256 → in manifest.skipped → survives; res.skipped ∋ it.

- file: src/snapshot/store.ts
  why: RestoreResult shape (read-only — NOT changed by this task).
  section: "RestoreResult (~194-201)" — { reverted, deleted, failed, skipped, refused } all string[].
```

### Current Codebase tree (the slice that matters)

```bash
src/snapshot/
  cas.ts          # <-- EDIT: restore() delete-step callback (~1123) + one guard line after ~1125
  git.ts          # READ-ONLY (sibling S1 owns the GitBackend guard; do NOT touch)
  store.ts        # READ-ONLY (SnapshotStore interface, RestoreResult — unchanged)
test/
  cas.test.ts                       # <-- ADD one it() (belt-and-suspenders unit test)
  integration/revert-cas.test.ts    # READ-ONLY (existing :750 happy-path test must stay green)
```

### Desired Codebase tree with files to be added/changed

```bash
src/snapshot/cas.ts    # MODIFIED (2 lines: callback signature + guard) — NO new file/type/export
test/cas.test.ts       # MODIFIED (1 new it() block) — NO new file
# (no production files added; no config/interface/API change)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// 1. `st` is ALREADY computed and passed by walkTree (cas.ts ~437: `await visit(rel, abs, st)`).
//    The restore callback merely needs to ACCEPT it (`async (rel, abs, st) =>`). TypeScript infers
//    st: {size:number; mtimeMs:number} from walkTree's visit type; a callback may accept FEWER or ALL
//    params, so the current 2-param form compiles and the new 3-param form compiles too.

// 2. The 'cas'-mode delete walk is GATED on THREE flags (cas.ts ~1111):
//      opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles && this.cfg.nonGitMode === "cas"
//    The test MUST set nonGitMode:"cas" AND allowDeleteCreatedFiles:true AND call restore with
//    deleteCreatedFiles:true, or the walk (and the guard) never runs.

// 3. ORDER MATTERS — insert the size guard AFTER `if (spare.has(rel)) return;` (~1125), NOT before it.
//    The spare Set (manifest.skipped) is the happy path; the size guard is the independent fallback that
//    runs only for candidates the spare Set did not catch. Placing it after keeps the happy path unchanged
//    (the existing :1441 / :750 tests assert no behavior change).

// 4. BARE `return` — do NOT push to result.skipped here. The task brief and residual_risk_analysis both
//    prescribe the bare return. Happy-path oversize visibility is ALREADY handled at cas.ts ~1065
//    (`result.skipped.push(...(manifest.skipped ?? []))`). GitBackend (S1) does push to skipped because it
//    is the PRIMARY defense for its R1 window; CAS's guard is belt-and-suspenders only. Both backends now
//    share the same deterministic SPARE (safety floor) — the stated goal.

// 5. NO new DI seam. Unlike GitBackend (S1 adds a `stat` dep because its `git ls-files` loop has no size),
//    CasBackend's walkTree already stats every file. Do NOT add a constructor arg / CasBackendDeps field.

// 6. The task brief calls the fake helpers "makeStateFs/makeStateBackend" — those names do NOT exist in
//    test/cas.test.ts. The real helpers are BASE_CFG + makeBackend + the INLINE mutable CasFs fake defined
//    inside the :1361 and :1441 it-blocks. Mirror the :1441 fake; do not search for the wrong names.
```

## Implementation Blueprint

### Data models and structure

No new data models. `RestoreResult.skipped: string[]` already exists (the 5-bucket outcome); `MulliganConfig["revert"].maxFileBytes` already exists (default 262144). `walkTree`'s `visit` type already includes `st: {size; mtimeMs}`. **No type/config/interface change.**

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/cas.ts — accept `st` in the restore delete-step callback (~line 1123)
  - FIND: inside restore() step (c), the 'cas'-mode walk:
        await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {
  - CHANGE the callback signature to ACCEPT the already-passed stat object:
        await this.walkTree(this.cwd, excludeSet, async (rel, abs, st) => {
  - WHY: walkTree (cas.ts ~411-440) already calls this.fs.stat(abs) and passes st positionally (line ~437).
    The 2-param form was simply dropping it. (TypeScript infers st:{size:number; mtimeMs:number}.)
  - NAMING: bare `st` (matches walkTree's visit param name; no annotation needed).

Task 2: MODIFY src/snapshot/cas.ts — add the maxFileBytes size guard AFTER the spare check (~line 1125)
  - FIND (immediately after the callback open-brace + the two early returns):
        if (manifest.files[rel]) return;            // ~1124 in beforeRef ⇒ not span-created
        if (spare.has(rel)) return;                 // ~1125 OVERSIZE-DELETE spare (manifest.skipped happy path)
  - INSERT one line directly after `if (spare.has(rel)) return;`:
        if (st.size > this.cfg.maxFileBytes) return; // SPARE — defense-in-depth, independent of manifest
  - WHY: a delete-candidate whose CURRENT size exceeds cfg.revert.maxFileBytes may be a pre-existing
    oversize file that was never captured (absent from both manifest.files AND manifest.skipped). When we
    cannot be certain it is span-created, the only safe action is to NOT delete (fail-SAFE — a leftover
    file is recoverable; a deleted pre-existing file is not). Independent of the manifest round-trip.
  - PRESERVE: the subsequent `if (isDangerousWorkspaceRel(rel)) return;` and the try/unlink/result.deleted
    block UNCHANGED. The spare Set (line ~1119) and manifest.skipped transport UNCHANGED.
  - GOTCHA: place AFTER `if (spare.has(rel)) return;`, never before (see Known Gotchas #3).

Task 3: ADD a TDD unit test in test/cas.test.ts — belt-and-suspenders path (oversize NOT in manifest.skipped)
  - PLACEMENT: in the same describe() block that holds the 'cas'-mode delete tests (alongside the
    OVERSIZE-DELETE test at :1441). it() title e.g.:
      "OVERSIZE-DELETE (belt-and-suspenders): 'cas' deleteCreatedFiles SPARES a delete-candidate whose
       CURRENT size > maxFileBytes even when it is ABSENT from manifest.skipped (size guard fires
       independently of the spare Set)"
  - FOLLOW pattern: the mutable CasFs fake in the OVERSIZE-DELETE test at test/cas.test.ts:1441
    (fileEntries: Map<abs,Buffer> + childMap + readdir/stat/readFile/writeFile/access/unlink; addFile helper).
  - SCENARIO (mirror :1441, but add the big file AFTER capture):
      const cwd = "/ws/proj"; const storage = "/store";
      cfg = { ...BASE_CFG, storageDir: storage, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256 };
      // baseline at capture: ONLY small.ts (so it is in manifest.files). NO oversize file at capture.
      addFile("small.ts", Buffer.from("ok"));
      const beforeRef = await cb.capture("turn");              // manifest.files = { small.ts }; manifest.skipped = []
      // inject AFTER capture — these are NOT in the beforeRef manifest:
      addFile("created.ts", Buffer.from("created"));           // size 7 ≤ 256 → genuine small span creation
      addFile("created-big.bin", Buffer.alloc(300));           // size 300 > 256; NOT in manifest.skipped
      const res = await cb.restore(beforeRef, { revertFileChanges:false, deleteCreatedFiles:true });
  - ASSERT:
      expect(res.deleted).toContain("created.ts");                         // small span creation IS deleted
      expect(res.deleted).not.toContain("created-big.bin");               // oversize SPARED by size guard
      expect(fileEntries.has(absOf("created-big.bin"))).toBe(true);        // NOT unlinked
      expect(fileEntries.has(absOf("created.ts"))).toBe(false);            // unlinked
  - REGRESSION PROOF: without the Task-2 guard, created-big.bin passes both early returns (not in
    manifest.files; not in spare Set) → unlink → fileEntries.has(...) becomes false → test FAILS. With the
    guard, the size check returns early → spared → test PASSES.
  - NAMING/COVERAGE: positive (created.ts deleted) + negative (created-big.bin spared) in one restore call.

Task 4: VERIFY no regression to the happy-path spare tests
  - RUN: npx vitest run test/cas.test.ts
    - The existing OVERSIZE-DELETE test (:1441) MUST still pass: big.bin is in manifest.skipped →
      spare.has(rel) returns at :1125 BEFORE the size guard → no behavior change.
  - RUN: npx vitest run test/integration/revert-cas.test.ts
    - The existing F-revert-delete-oversize (:750) MUST still pass (preexisting-big.bin in manifest.skipped).
  - No edits to those tests.
```

### Implementation Patterns & Key Details

```ts
// ── src/snapshot/cas.ts — restore() step (c), the 'cas'-mode delete walk (CONCEPTUAL DIFF) ──

// BEFORE (drops st; spares only via manifest.skipped):
const spare = new Set(manifest.skipped ?? []);
await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {           // ← st dropped
  if (manifest.files[rel]) return;
  if (spare.has(rel)) return;                                              // happy-path oversize spare
  if (isDangerousWorkspaceRel(rel)) return;
  try { await this.fs.unlink(abs); result.deleted.push(rel); }
  catch (e) { const code = (e as NodeJS.ErrnoException)?.code; if (code !== "ENOENT") result.failed.push(rel); }
});

// AFTER (accepts st; adds independent size guard — belt-and-suspenders):
const spare = new Set(manifest.skipped ?? []);
await this.walkTree(this.cwd, excludeSet, async (rel, abs, st) => {       // ← accept st (already passed)
  if (manifest.files[rel]) return;
  if (spare.has(rel)) return;                                              // happy-path oversize spare
  if (st.size > this.cfg.maxFileBytes) return;                             // ← NEW: SPARE, independent of manifest
  if (isDangerousWorkspaceRel(rel)) return;
  try { await this.fs.unlink(abs); result.deleted.push(rel); }
  catch (e) { const code = (e as NodeJS.ErrnoException)?.code; if (code !== "ENOENT") result.failed.push(rel); }
});
```

```ts
// ── test/cas.test.ts — the new it() (mirror the :1441 mutable CasFs fake; differ on WHEN big file is added) ──
// cfg: { ...BASE_CFG, storageDir: storage, nonGitMode: "cas", allowDeleteCreatedFiles: true, maxFileBytes: 256 }
// capture("turn") with ONLY small.ts present  → manifest.files={small.ts}, manifest.skipped=[]
// THEN addFile("created.ts", Buffer.from("created"))      // small span creation
// THEN addFile("created-big.bin", Buffer.alloc(300))      // oversize, NOT in manifest.skipped
// restore(beforeRef, { revertFileChanges:false, deleteCreatedFiles:true })
// → created.ts deleted; created-big.bin SPARED (size guard); asserts fileEntries.has(...) reflects that.
```

### Integration Points

```yaml
NO INTERFACE / CONFIG / API CHANGES — internal implementation detail.
- src/snapshot/cas.ts:        EDIT (callback signature + 1 guard line). NO new export/type/constructor arg.
- src/snapshot/git.ts:        DO NOT EDIT (sibling S1 owns; GitBackend already gets its stat-seam guard there).
- src/snapshot/store.ts:      DO NOT EDIT (SnapshotStore/RestoreResult/RestoreOpts unchanged).
- config.ts / paths.ts:       DO NOT EDIT (maxFileBytes already exists; defaults unchanged).
- README.md / spec/14:        DO NOT EDIT (P1.M1.T2.S1 owns the Mode-B doc sync).
- The guard consumes ONLY already-available state: `st` (from walkTree) + `this.cfg.maxFileBytes` (constructor-stored config).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check (the callback param change + the guard must compile; st.size must type-resolve)
npm run typecheck
# Expected: zero errors. (st is inferred {size:number; mtimeMs:number} from walkTree's visit type.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new belt-and-suspenders test + the existing OVERSIZE-DELETE spare test (:1441)
npx vitest run test/cas.test.ts
# Expected: ALL pass. The new it() FAILS if you revert the Task-2 guard (created-big.bin gets unlinked).

# Regression check on the existing happy-path integration test (real fs, no edit)
npx vitest run test/integration/revert-cas.test.ts
# Expected: F-revert-delete-oversize (:750) still green (preexisting-big.bin in manifest.skipped → spared at :1125).
```

### Level 3: Regression-Guard Verification (THE key check for this task)

```bash
# PROVE the new test FAILS without the guard (temporary manual check — do NOT commit this):
#   1. Temporarily remove ONLY the Task-2 line (`if (st.size > this.cfg.maxFileBytes) return;`)
#      (leave the Task-1 `st` param — it's harmless on its own).
#   2. npx vitest run test/cas.test.ts -t "belt-and-suspenders"
#      Expected: FAIL — created-big.bin is unlinked (conflated with a span creation) →
#                `fileEntries.has(absOf("created-big.bin"))` is false → assertion throws.
#   3. Restore the Task-2 line. Re-run → PASS.
# This proves the test is a genuine guard for the belt-and-suspenders path, not an always-pass.
```

### Level 4: Full Suite

```bash
npm test   # vitest run — all suites
# Expected: all green (no collateral; the change is additive and runs strictly after the existing spare check).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` passes (zero TS errors; `st.size` resolves).
- [ ] `npx vitest run test/cas.test.ts` passes (new test + existing :1441 spare test).
- [ ] `npx vitest run test/integration/revert-cas.test.ts` passes (:750 unchanged).
- [ ] `npm test` full suite passes.
- [ ] Level 3 check: new test FAILS with the Task-2 guard line removed.

### Feature Validation

- [ ] `cas.ts:1123` callback accepts `st` (`async (rel, abs, st) =>`).
- [ ] `if (st.size > this.cfg.maxFileBytes) return;` present immediately after `if (spare.has(rel)) return;`.
- [ ] New test asserts oversize delete-candidate NOT in `result.deleted` + `unlink` not called.
- [ ] New test asserts a small span creation in the SAME restore IS deleted (guard does not over-fire).
- [ ] Existing happy-path spare tests (:1441 unit, :750 integration) unchanged and green.

### Code Quality Validation

- [ ] No new DI seam / constructor arg / exported type / config (uses already-passed `st` + existing `maxFileBytes`).
- [ ] No production file other than `src/snapshot/cas.ts` touched.
- [ ] Guard placed AFTER the `spare.has(rel)` check (happy path unchanged).
- [ ] Comment density matches house style (WHY the guard; spec/14 §2 guarantee #4; BUG-001 defense-in-depth).
- [ ] Bare `return` (no `result.skipped` push) — matches task brief + residual_risk_analysis.

### Documentation & Deployment

- [ ] No user-facing/config/API/exported-type change (internal only) — nothing to deploy.
- [ ] README/spec doc sync owned by P1.M1.T2.S1 (Mode B) — NOT this task.

---

## Anti-Patterns to Avoid

- ❌ Don't add a `stat` DI seam / `CasBackendDeps` field — `walkTree` already stats every file and passes `st`.
- ❌ Don't place the size guard BEFORE `if (spare.has(rel)) return;` — that changes the happy path (the :1441
  and :750 tests assert no behavior change; the spare Set is the intended happy-path spare).
- ❌ Don't push to `result.skipped` in the guard — happy-path visibility is already handled at cas.ts ~1065
  (`result.skipped.push(...(manifest.skipped ?? []))`); the bare `return` matches the spec.
- ❌ Don't touch `git.ts` (sibling S1), `store.ts`, `config.ts`, `paths.ts`, or the rewind tool.
- ❌ Don't search for "makeStateFs/makeStateBackend" — those names don't exist; the real helpers are
  `BASE_CFG` + `makeBackend` + the INLINE mutable `CasFs` fake at `test/cas.test.ts:1441`.
- ❌ Don't use `nonGitMode:"explicit-paths"` in the new test — that mode does NOT tree-walk (the guard never
  runs); the test MUST use `nonGitMode:"cas"`.
- ❌ Don't add the oversize file BEFORE capture in the new test — that would put it in `manifest.skipped`
  (the happy path the :1441 test already covers). Add it AFTER capture to force the belt-and-suspenders path.

---

**Confidence Score: 9/10** — one-pass success is highly likely. The production change is two lines (one
callback param + one guard) against code verified line-exact this session, with no DI seam, type, config, or
interface change. The test mirrors an existing, verified mutable-`CasFs` fake (`test/cas.test.ts:1441`) and
differs only in WHEN the oversize file is added (after capture → absent from `manifest.skipped` → forces the
guard). The fail-without/pass-with proof is explicit, and the no-regression contract on the two existing
spare tests is spelled out. The only residual risk is a test-author misnaming the fake helpers — explicitly
called out in the gotchas.