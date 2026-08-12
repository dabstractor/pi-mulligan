# PRP — P2.M2.T1.S2: GitBackend `dirtyCheck` + `restore` + `retire` + `has`

> **SCOPE (single PRP):** Implement the 4 remaining `GitBackend` methods that P2.M2.T1.S1 left as throwing
> stubs in `src/snapshot/git.ts`. S1 already shipped `init()` + `capture()` (verified — the file is real and
> read in full). **S2 = replace the 4 throwing stubs with real, git-safe, mutex-serialized implementations +
> unit tests.** This PRP consumes S1's exact output and adds nothing that conflicts with it.

---

## Goal

**Feature Goal**: Complete the `GitBackend` (external shadow-repository) snapshot backend so it satisfies the
FULL `SnapshotStore` interface — `dirtyCheck`, `restore`, `has`, `retire` are real, working-tree-only, and
strictly honor the five git-safety guarantees (spec/14 §3). Every operation targets the SHADOW repo; the user's
`.git` is byte-identical after every call.

**Deliverable**: `src/snapshot/git.ts` with the 4 stubs replaced by real implementations + a modified
`test/git.test.ts` whose "S2 stubs throw" block is replaced by real-behavior unit tests. Consumed downstream by
`detectAndCreate` (already wired in store.ts), the capture hooks (P3.M1.T1), and `rewindExecute` step 6b
(P4.M2.T1).

**Success Definition**: `npx vitest run test/git.test.ts` passes (dirtyCheck/restore/has/retire behave per the
contracts below), `npm run typecheck` is clean, `npm test` stays green, and a test explicitly asserts **no
write command's `env.GIT_DIR` equals the source git dir** (guarantee #1/#2 made mechanical + tested).

---

## User Persona (if applicable)

N/A — internal subsystem. The "user" is the rewind tool (`rewindExecute`, P4.M2.T1) which orchestrates
`dirtyCheck` + `restore` and is mode-agnostic (never knows it ran GitBackend vs CasBackend).

---

## Why

- **Closes the GitBackend contract.** S1 left 4 throwing stubs; until S2 lands, `describe().backend === "git"`
  but the store can't actually detect drift, restore files, check refs, or reclaim snapshots — the rewind
  feature's git backend is inert.
- **Unblocks the dependency chain.** `rewindExecute` step 6b (P4.M2.T1.S2) calls `store.restore()`; the
  `/mulligan_checkpoint` revoke path (P3) calls `store.retire()`; cross-reload ref-honoring (E32) calls
  `store.has()`; the dirty guard (P4.M2.T1.S1) calls `store.dirtyCheck()`. All four are this task.
- **Git-safety is the whole point.** Restore writes working-tree files ONLY (never the source index/refs);
  refuse-on-dirty + delete-created-behind-two-flags are the unrecoverable-edit guards (E30, spec §1 layer 3).

---

## What

Four async methods added to the existing `GitBackend` class (replacing S1's throwing stubs), plus one additive
DI-seam field (`unlink`) for testability:

1. `dirtyCheck(afterRef, paths): Promise<string[]>` — `git diff --name-only <afterRef> -- <paths>` against the
   shadow repo; returns drifted paths; `[]` on null/empty afterRef.
2. `restore(beforeRef, opts): Promise<RestoreResult>` — `read-tree <beforeRef>` + per-path `checkout -- <path>`
   (revert), and `ls-files --others` + `fs.unlink` (delete created), all against the shadow repo, best-effort,
   never throws.
3. `has(ref): Promise<boolean>` — `git rev-parse --verify <ref>` (shadow) → boolean.
4. `retire(ref): Promise<void>` — resolve SHA→refname via `for-each-ref --points-at`, then `update-ref -d`.
5. `GitBackendDeps.unlink?: (path) => Promise<void>` (default `fs/promises.unlink`) — DI seam for restore's delete path.

### Success Criteria

- [ ] `dirtyCheck` issues `git diff --name-only <afterRef> -- <paths>` with `env.GIT_DIR=shadowDir`, returns the
      stdout lines, returns `[]` when `afterRef` is null/empty, and never rejects.
- [ ] `restore` issues `git read-tree <beforeRef>` then per-path `git checkout -- <path>` (revert) — both with
      `env.GIT_DIR=shadowDir` — and NEVER issues a command whose `env.GIT_DIR === sourceGitDir`.
- [ ] `restore` honors `opts.deleteCreatedFiles && cfg.allowDeleteCreatedFiles` (the TWO-flag AND) before any
      `unlink`; a missing either flag performs zero deletions.
- [ ] `restore` never rejects (E27 best-effort); per-path checkout/unlink failures land in `failed[]`.
- [ ] `restore`'s created-file enumeration excludes `excludeGlobs` AND `DANGEROUS_DIRS` via `:!` pathspec
      negations (so `node_modules`/`.git` are never unlink targets).
- [ ] `has` issues `git rev-parse --verify <ref>` (shadow) → exit 0 ⇒ `true`, else `false`; never rejects.
- [ ] `retire` issues `git for-each-ref --points-at <ref>` then `git update-ref -d <refname>` (shadow) for each
      resolved refname; never rejects.
- [ ] All four methods `await ensureInit()` first; `dirtyCheck`/`restore`/`retire` acquire the mutex (spec §4.3);
      `has` does NOT acquire it (§4.3 omits has — fast read-only check).
- [ ] `npm run typecheck` clean; `npm test` green.

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge": the exact S1 class shape (fields, `shadowEnv()`, `ensureInit()`, `refForLabel`),
the store.ts interface (async), the paths.ts helpers, the config defaults, and the test idiom (`makeExec`
recording fake) are all cited below with file:line precision. The one genuine ambiguity (retire receives a SHA
but `update-ref -d` needs a refname) is resolved with the `for-each-ref --points-at` approach S1 itself
anticipated — see Implementation Tasks Task 4.

### Documentation & References

```yaml
# MUST READ — the authoritative specs for this task
- url: spec/14-working-tree-revert.md  §3   # h2.143 GitBackend (external shadow repo) + the FIVE git-safety guarantees
  why: the exact restore recipe (read-tree + checkout, working-tree only) + dirty-check semantics + five guarantees
  critical: "Restore writes only working-tree files. The source index and all source refs are never touched." + the delete-behind-two-flags rule

- url: spec/14-working-tree-revert.md  §6   # h2.146 Restore semantics — refuse-on-dirty, then restore
  why: the RestoreResult 5-bucket contract + "delete work-tree files present now but absent from beforeRef tree"
  critical: restore(beforeRef,opts) has NO afterRef param — so delete-created uses "present NOW absent from beforeRef" (NOT afterRef). This reconciles the work-item's "afterRef-but-not-beforeRef" wording with the fixed interface.

- url: spec/14-working-tree-revert.md  §2   # h2.142 the SnapshotStore interface (ASYNC — S1 made it async)
  why: the exact method signatures + RestoreOpts/RestoreResult shapes S2 must match
  critical: capture() returns the commit SHA — so has/retire receive a SHA, not a refname. retire cannot do `update-ref -d <sha>`.

- url: plan/008_c36fd26768ae/architecture/external_deps.md  §1   # Git CLI shadow-repo command shape
  why: the exact `git diff`/`read-tree`/`checkout`/`rev-parse`/`update-ref` invocations + the five git-safety guarantees
  critical: "NEVER touches source index/refs — the five git-safety guarantees"; all writes carry GIT_DIR=<shadow>

# MUST READ — the files S2 modifies / builds on (cited with line anchors)
- file: src/snapshot/git.ts   # S1 SHIPPED this — read in full before editing
  why: THE file S2 edits. Replace the 4 throwing stubs at the bottom of the `GitBackend` class (search "P2.M2.T1.S2 stubs").
  pattern: capture()'s structure is the template for S2 methods — `acquire mutex → ensureInit → exec(...)→shadowEnv → try/finally release`.
  gotcha: "capture() RETURNS the commit SHA (trimmed commit-tree stdout)" → has/retire receive a SHA. retire MUST resolve SHA→refname via for-each-ref --points-at BEFORE update-ref -d.

- file: src/snapshot/store.ts   # the SnapshotStore interface + RestoreOpts + RestoreResult + AsyncMutex
  why: the EXACT interface S2's methods must satisfy (async signatures, the 5-bucket RestoreResult shape)
  pattern: SnapshotStore.dirtyCheck(afterRef:string,paths:string[]):Promise<string[]>; restore(beforeRef:string,opts:RestoreOpts):Promise<RestoreResult>; has(ref:string):Promise<boolean>; retire(ref:string):Promise<void>
  gotcha: do NOT add an afterRef param to restore() — the interface is fixed by S1; use "present-now-absent-from-beforeRef" for delete.

- file: src/snapshot/paths.ts   # PURE safety helpers S2 imports
  why: resolveSafeWorkspacePath (unlink target, throws on escape), normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS=[".git",".pi",".node_modules"]
  pattern: for each candidate path → normalizeRelPath → isDangerousWorkspaceRel gate → resolveSafeWorkspacePath before unlink
  gotcha: DANGEROUS_DIRS + excludeGlobs are BOTH applied to `ls-files --others` as `:!` pathspecs — WITHOUT them node_modules would be enumerated and unlinked (catastrophic).

- file: src/config.ts   # lines 205-215 — revert config defaults
  why: cfg.allowDeleteCreatedFiles (default false) is the delete gate; cfg.excludeGlobs drives the ls-files pathspec
  pattern: access via this.cfg.allowDeleteCreatedFiles / this.cfg.excludeGlobs (already on the GitBackend instance as this.cfg)

- file: test/git.test.ts   # S1's test file — S2 MODIFIES it
  why: reuse the makeExec(calls) recording fake + findCmd + BASE_CFG + emptyScan + expectedShadow idiom; REMOVE the "S2 stubs throw" describe block (line ~292) and ADD real-behavior blocks
  pattern: makeExec returns a GitExec that records {cmd,args,opts} into `calls` and returns canned stdout per cmd; findCmd(calls,"add") picks one out; assert c.opts.env.GIT_DIR === expectedShadow(BASE_CFG.storageDir)
  gotcha: the recording fake must also be extended to record/return for diff/read-tree/checkout/ls-files/rev-parse/for-each-ref/update-ref. Add an `unlink` fake to the DI deps object.
```

### Current Codebase tree (relevant slice)

```
src/snapshot/
  store.ts     # SnapshotStore interface (ASYNC) + RestoreOpts + RestoreResult + AsyncMutex + NoOpStore + detectAndCreate  (DONE)
  git.ts       # GitBackend — init()+capture() DONE; dirtyCheck/restore/has/retire = THROWING STUBS (S1)  ← S2 EDITS THIS
  paths.ts     # PURE helpers: resolveSafeWorkspacePath, normalizeRelPath, isDangerousWorkspaceRel, DANGEROUS_DIRS  (DONE)
  cas.ts       # (not yet — P2.M3.T1)
test/
  git.test.ts  # S1's tests for init/capture + "S2 stubs throw" block  ← S2 EDITS THIS
  store.test.ts  # interface type-shape tests + detectAndCreate (DONE — do not touch)
```

### Desired Codebase tree with files to be added/modified

```
src/snapshot/git.ts       # MODIFY — replace 4 throwing stubs with real impls; add `unlink` to GitBackendDeps; import DANGEROUS_DIRS + resolveSafeWorkspacePath from paths.js
test/git.test.ts          # MODIFY — remove "S2 stubs throw" block; add dirtyCheck/restore/has/retire real-behavior blocks + guarantee test
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: capture() returns the COMMIT SHA, not the refname (S1 design).
// `git update-ref -d <sha>` is INVALID — update-ref -d deletes a REFERENCE name.
// retire MUST resolve SHA → refname(s) via `for-each-ref --points-at <sha> --format='%(refname)' refs/mulligan/snapshots/`
// THEN `update-ref -d <refname>` for each. S1's own design note anticipates exactly this.

// CRITICAL: restore(beforeRef, opts) has NO afterRef param (interface fixed by S1/store.ts).
// The work-item wording "files that existed in afterRef but not beforeRef" is satisfied by
// PRD §6's "files present NOW but absent from beforeRef tree" — because the dirty guard (rewindExecute, P4)
// REFUSES if the worktree drifted from afterRef, so present-now ≈ afterRef at restore time.

// CRITICAL: `git ls-files --others` after read-tree lists ALL untracked files INCLUDING node_modules/dist/etc.
// WITHOUT `:!` pathspec negations (excludeGlobs + DANGEROUS_DIRS) + a per-path isDangerousWorkspaceRel gate,
// restore(delete) would try to unlink node_modules — catastrophic. Two safety layers, mirroring capture's caps walk.

// GOTCHA: `git checkout -- <path>` (the `--` form, no tree/commit arg) checks out FROM THE INDEX into the
// working tree. After `read-tree <beforeRef>` the index === beforeRef, so this writes beforeRef's content.
// Do NOT use `git checkout <beforeRef> -- <path>` (that form can move refs / is heavier); the read-tree-then-
// checkout-from-index two-step is the spec's exact recipe and is index-local.

// GOTCHA: `git diff --name-only --diff-filter=MD` (no tree arg) compares the INDEX vs the WORKING TREE.
// After read-tree <beforeRef>, index===beforeRef, so M=modified vs beforeRef, D=deleted-from-worktree vs beforeRef.
// (Untracked/created files do NOT appear here — that's why delete uses `ls-files --others` separately.)
// git diff auto-refreshes stale stat info by default; the DI exec fake controls stdout in unit tests anyway.

// GOTCHA: Node execFile rejects on non-zero exit. has/retire/dirtyCheck must catch non-zero (rev-parse --verify
// of a missing ref exits 128) → has returns false / retire no-ops / dirtyCheck returns [].

// GOTCHA: paths passed to dirtyCheck are workspace-relative POSIX strings; pass them verbatim as `--` pathspecs
// to `git diff` (execFile — no shell, so special chars are safe). Filter empty strings.
```

---

## Implementation Blueprint

### Data models and structure

No new types. S2 reuses (already defined in store.ts, the fixed contract):
- `RestoreOpts { revertFileChanges: boolean; deleteCreatedFiles: boolean }`
- `RestoreResult { reverted, deleted, failed, skipped, refused }` (all `string[]`)

One additive DI-seam field on S1's `GitBackendDeps` (src/snapshot/git.ts):
```typescript
export interface GitBackendDeps {
  exec?: GitExec;                                              // (S1)
  scan?: (...) => Promise<CapScan>;                            // (S1)
  /** Default: fs/promises.unlink. Tests inject a recording fake asserting unlink targets. */
  unlink?: (path: string) => Promise<void>;                    // ← S2 ADDS (optional, backward-compatible)
}
```
Constructor stores `this.unlink = deps?.unlink ?? (await import bound) fs/promises.unlink`. Import `unlink as fsUnlink`
from `node:fs/promises` at module top.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts — imports + DI seam
  - ADD to the `node:fs/promises` import: `unlink as fsUnlink`
  - ADD to the `import { ... } from "./paths.js"` line: `resolveSafeWorkspacePath, DANGEROUS_DIRS`
    (S1 already imports normalizeRelPath, isDangerousWorkspaceRel — extend that same import statement)
  - ADD field `unlink?: (path:string)=>Promise<void>` to `GitBackendDeps` (optional, default fsUnlink)
  - ADD private field `private readonly unlink: (path:string)=>Promise<void>` to the GitBackend class
  - ADD in the constructor body: `this.unlink = deps?.unlink ?? fsUnlink;`
  - WHY FIRST: the four methods depend on this.unlink + the paths imports + (already-present) this.repoRoot/
    this.sourceGitDir/this.shadowDir/this.cfg/this.mutex/this.shadowEnv()/this.ensureInit().
  - FOLLOW pattern: the existing `this.exec = deps?.exec ?? ...` line in the constructor.

Task 2: IMPLEMENT `dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>`
  - BODY: `const release = await this.mutex.acquire(); try { await this.ensureInit();`
      if (!afterRef || paths.length === 0) return [];
      const out = await this.exec("git", ["diff","--name-only",afterRef,"--",...paths.filter(p=>p)], this.shadowEnv());
      return out.stdout.split("\n").map(s=>s.trim()).filter(s=>s.length>0);
    } catch (err) { console.warn(`[mulligan] snapshot.dirtyCheck failed: ${msg}`); return []; }
    finally { release(); }
  - FOLLOW pattern: capture()'s `acquire → ensureInit → exec(shadowEnv) → try/catch-null/finally-release`.
  - NAMING: the method name + signature are FIXED by the interface — do not rename.
  - PLACEMENT: replace S1's throwing `dirtyCheck` stub in the class.
  - GOTCHA: `git diff <afterRef> -- <paths>` (shadow env) compares the afterRef TREE to the WORKING TREE scoped
    to paths; includes files new-vs-afterRef (shown). null/empty afterRef ⇒ [] (no drift baseline ⇒ allow).
    Never rejects (catch ⇒ [] + warn).

Task 3: IMPLEMENT `has(ref: string): Promise<boolean>`
  - BODY: `try { await this.ensureInit(); await this.exec("git", ["rev-parse","--verify",ref], this.shadowEnv());
            return true; } catch { return false; }`
  - NO mutex (spec §4.3 omits has from the serialized list — it is a fast read-only existence check).
  - FOLLOW pattern: ensureInit-then-exec; catch non-zero exit (rev-parse --verify of a missing ref ⇒ exit 128).
  - GOTCHA: ref is a commit SHA (capture's return). `rev-parse --verify <sha>` ⇒ exit 0 iff the object exists in
    the shadow DB. Never rejects.
  - PLACEMENT: replace S1's throwing `has` stub.

Task 4: IMPLEMENT `retire(ref: string): Promise<void>`
  - BODY: `const release = await this.mutex.acquire(); try { await this.ensureInit();
        const out = await this.exec("git",
          ["for-each-ref","--points-at",ref,"--format=%(refname)","refs/mulligan/snapshots/"], this.shadowEnv());
        const refnames = out.stdout.split("\n").map(s=>s.trim()).filter(s=>s.length>0);
        for (const rn of refnames) { await this.exec("git", ["update-ref","-d",rn], this.shadowEnv()); }
      } catch (err) { console.warn(`[mulligan] snapshot.retire failed: ${msg}`); }
      finally { release(); }`
  - FOLLOW pattern: acquire → ensureInit → exec(shadowEnv) → try/finally-release; never rejects (E27).
  - CRITICAL: ref is a SHA — `update-ref -d <sha>` is INVALID. Resolve SHA→refname(s) via for-each-ref --points-at
    scoped to refs/mulligan/snapshots/ (the ONLY namespace capture pins refs into, via refForLabel), THEN
    update-ref -d each refname. Empty result (already retired / GC'd) ⇒ no-op. This is the S2 design reconciliation.
  - PLACEMENT: replace S1's throwing `retire` stub.

Task 5: IMPLEMENT `restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult>`
  - BODY (see "Implementation Patterns" below for the full reference):
      const release = await this.mutex.acquire();
      const result: RestoreResult = { reverted:[], deleted:[], failed:[], skipped:[], refused:[] };
      try {
        await this.ensureInit();
        if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result;
        // (a) load beforeRef tree into the SHADOW index (NEVER source index). Best-effort.
        await this.exec("git", ["read-tree", beforeRef], this.shadowEnv());
        // (b) REVERT (modified + deleted-from-worktree vs beforeRef)
        if (opts.revertFileChanges) {
          const diff = (await this.exec("git",
            ["diff","--name-only","--diff-filter=MD"], this.shadowEnv())).stdout;
          for (const rel of diff.split("\n").map(s=>s.trim()).filter(Boolean)) {
            if (isDangerousWorkspaceRel(rel)) continue;            // safety floor: never revert a dangerous path
            try { await this.exec("git", ["checkout","--",rel], this.shadowEnv()); result.reverted.push(rel); }
            catch { result.failed.push(rel); }                      // per-path best-effort (E27)
          }
        }
        // (c) DELETE created files (present now, absent from beforeRef) — TWO-flag AND
        if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles) {
          const othersSpecs = [".", ...this.cfg.excludeGlobs.map(g=>`:!${g}`), ...DANGEROUS_DIRS.map(d=>`:!${d}`)];
          const others = (await this.exec("git", ["ls-files","--others","--",...othersSpecs], this.shadowEnv())).stdout;
          for (const rel of others.split("\n").map(s=>s.trim()).filter(Boolean)) {
            if (isDangerousWorkspaceRel(rel)) continue;            // belt-and-suspenders (ls-files :! already filters)
            try {
              const abs = resolveSafeWorkspacePath(this.repoRoot, rel);  // throws on escape → caught below
              await this.unlink(abs); result.deleted.push(rel);
            } catch (e) { if (e is ENOENT) { /* already gone — skip */ } else result.failed.push(rel); }
          }
        }
        return result;
      } catch (err) {            // read-tree failed (bad ref) or resolveSafeWorkspacePath escape — best-effort
        console.warn(`[mulligan] snapshot.restore partial: ${msg}`);
        return result;           // never rejects (E27); whatever was collected so far is returned
      } finally { release(); }
  - FOLLOW pattern: capture()'s acquire→ensureInit→exec(shadowEnv)→try/catch-null/finally-release; the per-path
    inner try/catch mirrors the "collect reverted/failed" requirement in the work-item contract.
  - CRITICAL guarantees: read-tree + checkout use shadowEnv (env.GIT_DIR=shadowDir) — NEVER the source index/refs.
    The created-set enumeration applies excludeGlobs + DANGEROUS_DIRS as `:!` pathspecs (two layers). restore is
    best-effort: a read-tree failure (bad beforeRef) ⇒ warn + return whatever was collected (all-empty) — NEVER rejects.
  - PLACEMENT: replace S1's throwing `restore` stub.

Task 6: MODIFY test/git.test.ts — replace "S2 stubs throw" with real-behavior tests
  - REMOVE the `describe("GitBackend — S2 stubs throw (P2.M2.T1.S2 scope)")` block (~line 292).
  - ADD `describe("GitBackend.dirtyCheck — spec/14 §3/§6")`:
      • issues `git diff --name-only <afterRef> -- <paths>` with env.GIT_DIR===expectedShadow; returns the stdout lines.
      • returns [] when afterRef is null/""; returns [] when paths is []; never rejects on a git error (warn+[]).
  - ADD `describe("GitBackend.has — spec/14 §2")`:
      • issues `git rev-parse --verify <ref>` (shadow); exit0⇒true, reject/throw⇒false; never rejects.
  - ADD `describe("GitBackend.retire — SHA→refname resolution")`:
      • issues `git for-each-ref --points-at <sha> --format='%(refname)' refs/mulligan/snapshots/` then
        `git update-ref -d <each refname>` (shadow); all with env.GIT_DIR===expectedShadow; never rejects;
        empty for-each-ref result ⇒ no update-ref issued (already retired).
  - ADD `describe("GitBackend.restore — working-tree only (spec/14 §3/§6)")`:
      • issues `git read-tree <beforeRef>` then per-path `git checkout -- <path>` — assert BOTH carry
        env.GIT_DIR===expectedShadow and NEITHER carries the source git dir.
      • no write command's env.GIT_DIR === sourceGitDir (the five-guarantees test, scoped to restore).
      • honors the delete two-flag AND: deleteCreatedFiles:false (even if allowDeleteCreatedFiles:true) ⇒ no ls-files/unlink;
        allowDeleteCreatedFiles:false ⇒ no unlink even if deleteCreatedFiles:true.
      • when delete runs: issues `git ls-files --others -- . :!<excludeGlobs> :!<DANGEROUS_DIRS>`; the recorded
        `unlink` fake is called only for non-dangerous paths; node_modules/.git are NEVER unlink targets
        (assert the fake was NOT called with any path under node_modules or .git).
      • per-path checkout failure ⇒ path lands in failed[]; restore still resolves (never rejects).
      • read-tree failure (exec rejects) ⇒ restore resolves to a 5-bucket result (reverted possibly empty), never rejects.
      • neither flag set ⇒ returns 5 empty buckets, issues no read-tree.
  - FOLLOW pattern: reuse makeExec(calls) / findCmd(calls,"read-tree") / BASE_CFG / emptyScan / expectedShadow.
    Extend the DI deps object with a recording `unlink` fake (push its args into a list). For the diff/checkout
    stdout, the makeExec fake returns canned lines.
  - NAMING: `describe("GitBackend.<method> — <spec anchor>")`; `it("<behavior in present tense>")`.
  - COVERAGE: every method's command shape + env.GIT_DIR + best-effort (never-rejects) + the delete two-flag AND
    + the node_modules-never-unlinked safety assertion.
  - PLACEMENT: replace the removed block; keep S1's init/capture/guarantee blocks ABOVE untouched.

Task 7: VALIDATE (see Validation Loop) — typecheck, the git.test.ts run, full suite.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: every S2 method mirrors capture()'s shape — acquire mutex → ensureInit → exec(shadowEnv) → try/finally-release.
// shadowEnv() is S1's helper: { env:{...process.env, GIT_DIR:this.shadowDir, GIT_WORK_TREE:this.repoRoot}, maxBuffer:16MB }.
// Using it for EVERY command is what makes guarantees #1/#2 mechanical.

// PATTERN (restore revert): read-tree loads beforeRef into the SHADOW index; `git checkout -- <path>` (the `--`
// form, no tree arg) then writes that path's INDEX content (= beforeRef) into the working tree. Per-path loop
// → reverted[]/failed[]. Do NOT use `git checkout <beforeRef> -- <path>` (heavier, can be mistaken for ref ops).

// PATTERN (restore delete): `git ls-files --others -- . :!<g1> :!<g2> ... :!<DANGEROUS>` enumerates files present
// in the work tree but NOT in the beforeRef index (= span creations), EXCLUDING heavy/dangerous dirs. Then per
// safe path: unlink(resolveSafeWorkspacePath(repoRoot, rel)). The `:!` pathspecs + the isDangerousWorkspaceRel
// gate are the TWO safety layers (mirrors capture's caps-walk two-layer approach).

// PATTERN (retire SHA→refname): the ONLY namespace capture pins refs into is refs/mulligan/snapshots/ (turn/* and
// checkpoint/*). for-each-ref --points-at <sha> scoped there yields the refname(s) pointing at that commit; update-ref
// -d each. Robust to a SHA pinned under multiple labels (revokes all) and to an already-retired SHA (empty ⇒ no-op).

// BEST-EFFORT (E27): dirtyCheck/has/retire/restore NEVER reject. dirtyCheck⇒[] on error; has⇒false; retire⇒void;
// restore⇒whatever-was-collected (5-bucket result, possibly all-empty). The feature's overriding rule: revert
// degradation never blocks the context rewind (PRD §6 step 1). The refuse/allow decision is rewindExecute's (P4).
```

### Integration Points

```yaml
NO DATABASE: this is a local shadow git repo + fs; no DB/migration.
CONFIG: reads this.cfg.allowDeleteCreatedFiles + this.cfg.excludeGlobs (already on the instance from S1).
ROUTES: none — S2 adds no tool/endpoint. The store is consumed by detectAndCreate (already wired in store.ts)
        + the P3 capture hooks + P4 rewindExecute (later tasks). No index.ts edit in S2.
DEPS: no new npm dep. Adds node:fs/promises `unlink` + paths.js `resolveSafeWorkspacePath`/`DANGEROUS_DIRS` imports.
FORWARD-COMPAT: store.ts's detectAndCreate already dynamic-imports ./git.js and constructs GitBackend — S2 makes
        its backend "git" actually functional (today the stubs throw, but no live caller exists until P3.M1.T2).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck            # tsc --noEmit — expect zero errors
# (no eslint/ruff in this repo; package.json scripts = test, smoke, typecheck, prepublishOnly)
# Expected: clean. If errors, READ them — most likely a missed import or a RestoreResult bucket typo.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run test/git.test.ts -t "dirtyCheck"   # then -t "has", -t "retire", -t "restore"
npx vitest run test/git.test.ts                   # the full S2-modified file
# Expected: all pass. The S1 init/capture/guarantee blocks must STILL pass (do not regress them).
```

### Level 3: Integration Testing (System Validation)

```bash
npm test                                          # full suite — must stay green
# Expected: store.test.ts STILL asserts detectAndCreate returns NoOpStore "none" for the git branch TODAY
#   (that only flips to "git" in P3.M1.T2 when detectAndCreate is wired into index.ts — out of S2 scope).
#   No other test file touches GitBackend, so no cross-file breakage is expected.
```

### Level 4: Creative & Domain-Specific Validation (git-safety, the heart of this task)

The git-safety guarantees are NOT expressible as a passing assertion alone — they are the absence of certain
commands. Cover them with explicit unit-test assertions (Task 6):
- **Guarantee #1/#2 (no source writes):** after a `restore`, assert NO recorded command's `opts.env.GIT_DIR`
  equals the source git dir (capture's existing guarantee test is the template — extend it over the restore call set).
- **Guarantee #3 (working-tree only):** assert `restore` issues `read-tree` + `checkout -- <path>` and NEVER
  `reset`/`commit`/`checkout <branch>`/`merge`/`stash`.
- **Guarantee #4 (delete-behind-two-flags):** assert `unlink` is called ONLY when BOTH
  `opts.deleteCreatedFiles` AND `cfg.allowDeleteCreatedFiles` are true.
- **Node_modules never unlinked:** assert the recording `unlink` fake was never called with a path under
  `node_modules`/`.git`/`.pi` (the `:!` pathspecs + isDangerousWorkspaceRel gate).
- **retire resolves SHA→refname:** assert `for-each-ref --points-at <sha>` precedes `update-ref -d <refname>`
  (i.e. `update-ref -d`'s arg is a `refs/mulligan/snapshots/…` refname, NOT the raw SHA).

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run test/git.test.ts` — all S2 blocks pass; S1's init/capture/guarantee blocks still pass.
- [ ] `npm test` — full suite green (no regression in store.test.ts / other files).

### Feature Validation

- [ ] dirtyCheck: `git diff --name-only <afterRef> -- <paths>` (shadow env); `[]` on null/empty afterRef; never rejects.
- [ ] has: `git rev-parse --verify <ref>` (shadow) → boolean; never rejects.
- [ ] retire: `for-each-ref --points-at <sha>` → `update-ref -d <refname>` (shadow); never rejects; no-op if already retired.
- [ ] restore: `read-tree <beforeRef>` + per-path `checkout -- <path>` (revert) + `ls-files --others`+`unlink` (delete);
      best-effort (never rejects); the delete two-flag AND honored; node_modules/.git never unlinked.
- [ ] Every command in all 4 methods carries `env.GIT_DIR=shadowDir` (no source-dir write).

### Code Quality Validation

- [ ] Follows S1's `acquire → ensureInit → exec(shadowEnv) → try/catch-null/finally-release` pattern.
- [ ] Reuses S1's `shadowEnv()` helper for every command (no hand-built env).
- [ ] DI `unlink` seam added to `GitBackendDeps` (optional, default real `fsUnlink`) — backward-compatible.
- [ ] No new npm dependency; only `node:fs/promises` + `./paths.js` additions.

### Documentation & Deployment

- [ ] JSDoc on dirtyCheck/restore/has/retire citing spec/14 §3/§6 + the five guarantees + the SHA→refname
      retire rationale (Mode A — rides WITH the work; no separate doc file in S2).

---

## Anti-Patterns to Avoid

- ❌ Don't `git update-ref -d <sha>` — retire MUST resolve the SHA to refname(s) first (for-each-ref --points-at).
- ❌ Don't add an `afterRef` param to `restore()` — the interface is fixed by S1; use PRD §6 "present-now-absent-from-beforeRef".
- ❌ Don't enumerate created files without `:!` excludeGlobs + DANGEROUS_DIRS pathspecs — `ls-files --others` would
  list node_modules and restore would unlink it.
- ❌ Don't skip the per-path `isDangerousWorkspaceRel` gate (belt-and-suspenders for the ls-files filter).
- ❌ Don't make has acquire the mutex — spec §4.3 omits it; it's a fast read-only check.
- ❌ Don't let any of the 4 methods reject — they are all best-effort (E27): revert degradation never blocks the rewind.
- ❌ Don't use `git checkout <beforeRef> -- <path>` (can be mistaken for ref ops); use read-tree + `git checkout -- <path>` (index-local).
- ❌ Don't touch S1's working `init()`/`capture()`/`describe()` or the store.ts interface.

---

**Confidence Score: 9/10** — S1 is fully shipped and read in full (no assumptions); the store.ts interface is
fixed and async (verified via store.test.ts type assertions); the one genuine ambiguity (retire on a SHA) is
resolved with the for-each-ref --points-at approach S1's own design note anticipates; the restore no-afterRef gap
is resolved by PRD §6's "present-now" wording; the test idiom (`makeExec` recording fake) is established. The -1
is for the inherent nuance of the git diff/ls-files pathspec edge cases, which the gotchas + Level-4 assertions
make explicit and testable.