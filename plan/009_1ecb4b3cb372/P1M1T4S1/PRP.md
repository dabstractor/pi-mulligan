---
name: "P1.M1.T4.S1 — Add restore() entry guard + constructor realpath in cas.ts + test"
description: >
  Add the "last line of defense independent of detection" to `CasBackend.restore()` in
  `src/snapshot/cas.ts`: immediately after acquiring the mutex and BEFORE any manifest read / fs
  write, re-check `isForbiddenRoot(this.cwd)` and, if true, release the mutex and return
  `{ reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] }` with ZERO filesystem
  mutation. This is the spec/14 §2 SAFETY INVARIANT's restore-side half for the CAS backend
  ("restore() MUST additionally re-check this invariant at its entry and refuse ... if the resolved
  root is forbidden"), consuming `isForbiddenRoot` from `./paths.js` (P1.M1.T1.S1, COMPLETE) on a
  `this.cwd` value that THIS task canonicalizes via `realpathSafe` (cas.ts's constructor currently
  uses bare `resolve(cwd)` — NOT yet realpath'd; this task mirrors the realpathSafe pattern git.ts
  landed in P1.M1.T3.S1). Add JSDoc to `restore()` citing `@spec/14 §2` (SAFETY INVARIANT) + §6, and
  a focused test block in `test/cas.test.ts` that constructs `CasBackend` directly with
  `cwd = os.homedir()` and `cwd = "/"`, asserting the refused result + an EMPTY fs call log (zero
  mutation) via the DI `CasFs` fake. Out of scope: git.ts (T3.S2 owns its restore guard — assume
  COMPLETE), store.ts detectAndCreate (T2.S1), paths.ts (T1.S1 done), README (M2.T2), integration
  tests (M2.T1), and the rest of cas.ts (UNCHANGED).
---

## Goal

**Feature Goal**: `CasBackend.restore()` refuses to operate when its resolved workspace root
(`this.cwd`, canonicalized by THIS task's constructor change from `resolve(cwd)` → `realpathSafe(cwd)`)
is a forbidden root — the user's home, `/`, any depth-1 system dir, or a degenerate value. The
refusal happens at the very top of the method (right after the mutex is acquired, before the manifest
`readFile` and before any `writeFile`/`unlink`), so a forbidden-root restore performs **ZERO
filesystem mutation** and returns a `RestoreResult` whose `refused` bucket names the offending root
and whose other four buckets are empty. This is the restore-side half of the spec/14 §2 SAFETY
INVARIANT for the CAS backend — a backstop independent of detection (`detectAndCreate` already
refuses such roots → `NoOp`; this re-checks at restore() entry so a hand-constructed backend, a
future caller, or a detection regression cannot bypass it). Parity with `GitBackend.restore()`
(P1.M1.T3.S2).

**Deliverable** (two file edits, both in scope of THIS subtask only):
1. `src/snapshot/cas.ts`:
   - **NEW import**: `import { realpathSync } from "node:fs";` (cas.ts imports only
     `node:fs/promises` today — the SYNC `realpathSync` lives in `node:fs`; place this import
     before the existing `from "node:fs/promises"` block).
   - **NEW module-private helper**: `realpathSafe(cwd)` (try `realpathSync` → catch → fallback
     `resolve(cwd)`) — copied verbatim from git.ts (P1.M1.T3.S1). Place it near the top of the module
     (after the imports, before `realFs`/the types — mirror git.ts's placement).
   - **Constructor**: change line 263 `this.cwd = resolve(cwd);` → `this.cwd = realpathSafe(cwd);`.
   - **Import (paths)**: extend the existing `from "./paths.js"` destructure (line 23) to add
     `isForbiddenRoot`.
   - **Guard**: insert, between `const release = await this.mutex.acquire();` (line 1005) and
     `const result: RestoreResult = {` (line 1006), a 4-statement guard:
     `if (isForbiddenRoot(this.cwd)) { release(); return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] }; }`
     preceded by a comment citing spec/14 §2 + §6.
   - **JSDoc**: extend the `restore()` JSDoc (immediately above line 1004) to cite
     `@spec/14 §2 SAFETY INVARIANT` + describe the entry guard ("last line of defense independent of
     detection; fires before any fs read/write → zero mutation on refuse").
2. `test/cas.test.ts`:
   - **Import**: add `import { homedir } from "node:os";` near the top imports (the file does not
     import node:os today).
   - **Test block**: append a new
     `describe("CasBackend.restore — forbidden-root entry guard (spec/14 §2 SAFETY INVARIANT)", ...)`
     with 3 `it` cases: (a) `cwd = homedir()` → `refused:[home]`, all other buckets `[]`, ZERO fs
     calls (the recording `CasFs` fake's readFile/writeFile/unlink arrays all empty); (b) `cwd = "/"`
     → `refused:["/"]`, ZERO fs calls; (c) negative control — `makeStateBackend` with
     `cwd="/ws"` (depth-2, NOT forbidden), capture→mutate→restore → guard does NOT fire (`refused:[]`),
     restore proceeds (`reverted` non-empty).

**Success Definition**:
- `isForbiddenRoot(homedir())` ⟹ `restore()` returns `{ reverted:[], deleted:[], failed:[], skipped:[], refused:[homedir()] }`
  and the recording `CasFs` fake was **never invoked** for `readFile`/`writeFile`/`unlink` — proving
  zero fs mutation.
- The guard fires BEFORE the manifest `readFile` (so the home/`/` tests need NO pre-seeded manifest
  — the first fs op is the manifest read, which never runs because the guard returns first).
- For every existing restore test (all use `cwd="/ws"` or `cwd="/fake/cwd"` — depth-2, NOT home, NOT
  forbidden), the guard is a transparent no-op: behavior + assertions are byte-identical. `refused`
  stays `[]` for all non-forbidden restores.
- The constructor now canonicalizes `this.cwd` via `realpathSafe` (resolves symlinks); `realpathSync`
  succeeds for real paths (homedir, `/`, and every test cwd under `/`) → `this.cwd` is the canonical
  real path. Direct-test construction with a non-existent cwd (`/fake/cwd`) falls through to the
  `resolve(cwd)` fallback (catch) — same as git.ts.
- `npm run typecheck` green; `npx vitest run test/cas.test.ts -t "forbidden-root entry guard"` green;
  `npm test` green.

## User Persona (if applicable)

N/A — internal safety hardening of a snapshot backend. No end-user surface; no config knob.

## Why

- **It closes the highest-severity regression vector at the LAST gate — for the universal non-git
  fallback.** spec/14 §2 SAFETY INVARIANT: the historical bug was upward repo discovery
  (`rev-parse --show-toplevel`) resolving the workspace to `$HOME`, after which `restore()`
  reverted/deleted the **entire home tree**. The CAS backend is the fallback when there is NO git repo
  (spec/14 §4) — i.e. the backend that runs precisely in the environments where a user is MOST likely
  to have launched Pi from a shallow/wrong directory. T1.S1 added the predicate; T2.S1 makes
  `detectAndCreate` refuse forbidden roots → `NoOp`. But defense-in-depth demands restore() ALSO
  re-check, because (a) a future caller could construct `CasBackend` directly bypassing
  `detectAndCreate`, (b) detection could regress, and (c) the invariant is labeled
  "non-negotiable". This guard is that independent backstop — and it brings cas.ts to full parity with
  git.ts (P1.M1.T3.S2), so NEITHER backend can be made to mutate a forbidden root.
- **It is "the last line of defense" verbatim.** spec/14 §2: "restore() MUST additionally re-check
  this invariant at its entry and refuse (returning `{refused:true}` with zero filesystem mutation)
  if the resolved root is forbidden — a last line of defense independent of detection."
- **It consumes the stable T1.S1 contract.** `isForbiddenRoot(root): boolean` is COMPLETE, exported
  from `./paths.js`, and unit-tested. restore() just imports + calls it. No new logic to design —
  only wiring + the constructor canonicalization + a test.
- **It canonicalizes the root the guard checks.** The guard checks `isForbiddenRoot(this.cwd)`, and
  the predicate ASSUMES its arg is already realpath'd (it does a `dirname(root) === "/"` depth test +
  a `root === homedir()` equality test — both meaningless against an un-resolved/symlinked path). So
  the constructor MUST canonicalize cwd via `realpathSafe` BEFORE the guard can trust it. This is the
  exact pairing git.ts landed (T3.S1 realpathSafe + T3.S2 guard); cas.ts does BOTH in this one task.
- **It is the cas.ts half of the pair.** spec/14 §10 testing clause: "restore() against a forbidden
  root returns refused with zero filesystem mutation" — asserted PER backend. git.ts done (T3.S2);
  cas.ts here.

## What

A surgical change: +1 import line (node:fs), +1 module-private helper (~5 lines, copied from git.ts),
+1 constructor line change (`resolve`→`realpathSafe`), +1 import name (paths.js), +4-line guard,
+1 JSDoc sentence, +1 test import, +1 test block (3 cases). The guard, in context (the current
restore() opening — lines 1004–1007):

```ts
async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
  const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
  // ── SAFETY INVARIANT entry guard (spec/14 §2) — LAST LINE OF DEFENSE, independent of detection ──
  // detectAndCreate (store.ts) already refuses forbidden roots → NoOp; this re-checks at restore()
  // entry so a hand-constructed backend or a detection regression cannot bypass it. Fires BEFORE the
  // manifest readFile and BEFORE any writeFile/unlink → ZERO filesystem mutation on refuse. @spec/14 §2/§6.
  if (isForbiddenRoot(this.cwd)) {
    release();
    return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] };
  }
  // ── end guard ──
  const result: RestoreResult = {
    reverted: [],
    deleted: [],
    failed: [],
    skipped: [],
    refused: [],
  };
  try {
    if (!opts.revertFileChanges && !opts.deleteCreatedFiles) return result;
    // ... first fs op: const buf = await this.fs.readFile(this.manifestPath(beforeRef)); ...
```

**Placement rationale (verified against the contract + current source):** the work item says
"immediately AFTER `const release = await this.mutex.acquire()` and BEFORE any manifest read/fs write".
cas.ts's restore() reads the manifest via `this.fs.readFile(this.manifestPath(beforeRef))` as its
first act INSIDE the `try` (line ~1013). Inserting the guard between the mutex-acquire line (1005) and
the `const result` line (1006) is the most literal reading AND the most defensive position (the guard
is the absolute first statement after the mutex is held, before the `try` block and before the manifest
read). The guard returns an **inline object literal** (not the `result` variable) and calls `release()`
explicitly — because the `try { ... } finally { release(); }` block is NOT yet entered at this point,
the `finally` would not release the mutex.

### Success Criteria

- [ ] `src/snapshot/cas.ts` imports `realpathSync` from `node:fs` (a NEW import line — cas.ts imports
      only `node:fs/promises` today) and defines the module-private `realpathSafe` helper.
- [ ] The constructor canonicalizes `this.cwd = realpathSafe(cwd);` (replaces the bare `resolve(cwd)`
      at line 263).
- [ ] `src/snapshot/cas.ts` imports `isForbiddenRoot` from `./paths.js` (extends the existing
      destructure at line 23; no second `from "./paths.js"` line).
- [ ] `restore()` checks `isForbiddenRoot(this.cwd)` as its first act after `mutex.acquire()`, before
      `const result` and before the manifest `readFile`.
- [ ] On a forbidden root: `release()` is called (mutex freed), the method returns
      `{ reverted:[], deleted:[], failed:[], skipped:[], refused:[this.cwd] }`, and `this.fs.readFile` /
      `writeFile` / `unlink` are NEVER called (zero mutation).
- [ ] The `restore()` JSDoc cites `@spec/14 §2` (SAFETY INVARIANT) in addition to its existing §6
      citation, and describes the guard as "last line of defense independent of detection".
- [ ] `test/cas.test.ts` imports `homedir` from `node:os` and has a new describe block whose 3 cases
      pass: home→refused+zero-fs-calls, `/`→refused+zero-fs-calls, normal cwd→guard-skipped+restore-runs.
- [ ] Every existing restore test (cwd=`/ws` or `/fake/cwd`) is unchanged in behavior (guard is a no-op).
- [ ] `npm run typecheck` clean; `npx vitest run test/cas.test.ts -t "forbidden-root entry guard"` green.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
target lines (verified against current source: constructor at 263, restore() at 1004, acquire at 1005,
const-result at 1006, imports at 11/13/23), the exact new import line (node:fs — NOT present today),
the exact `realpathSafe` helper (copied verbatim from git.ts), the exact guard code (verbatim from the
work item), the exact JSDoc sentence to add, the exact test block (3 cases with full assertion bodies
+ the recording CasFs fake), the spec citations, the contract from T1.S1 (isForbiddenRoot), and the
parity reference from T3.S2 (git.ts — assume COMPLETE) are all below.

### Documentation & References

```yaml
# MUST READ — the spec authority for this guard
- file: spec/14-working-tree-revert.md
  why: "§2 SAFETY INVARIANT is THE rule: 'restore() MUST additionally re-check this invariant at its
        entry and refuse (returning {refused:true} with zero filesystem mutation) if the resolved root
        is forbidden — a last line of defense independent of detection.' §6 is the restore-semantics
        section the JSDoc also cites. §10 is the testing safety clause: 'restore() against a forbidden
        root returns refused with zero filesystem mutation' — exactly what the new test asserts. §4 is
        the CasBackend design (the universal non-git fallback — WHY this backend is the one that most
        needs the guard)."
  section: "§2 (the 'SAFETY INVARIANT — non-negotiable' final sentence + the Detection paragraph),
            §4 (CasBackend + non-git modes), §6 (Restore semantics — refuse-on-dirty, then restore),
            §10 (the 'Safety (non-negotiable)' bullet asserting restore() against a forbidden root
            returns refused with zero mutation)"
  critical: "§2 frames this as INDEPENDENT of detection — the guard must fire even if detectAndCreate
             is bypassed (e.g. a hand-constructed CasBackend in a test, or a future direct caller).
             The phrase 'zero filesystem mutation' is the testable contract: the recording CasFs fake's
             readFile/writeFile/unlink call arrays must ALL be empty (not just free of writes — empty,
             because the guard fires before the manifest readFile, which is the FIRST fs op). §4 frames
             CasBackend as the FALLBACK when there is no git — the backend that runs where a bad launch
             dir is most likely."

# MUST READ — THE source file being modified (read it FULLY first — esp. imports + constructor + restore)
- file: src/snapshot/cas.ts
  why: "THE file modified. Imports: node:fs/promises block ends at line 11 (realpathSync is NOT in it
        — it lives in the SYNC node:fs module → ADD a NEW import line BEFORE line 1). node:path at
        line 13 ({ join, resolve, dirname }). ./paths.js destructure at lines 19–23 (ADD isForbiddenRoot).
        constructor at lines ~256–289: line 263 `this.cwd = resolve(cwd);` → CHANGE to realpathSafe(cwd).
        restore() JSDoc ~990–1003 + method at 1004: mutex acquire at 1005, const result at 1006–1012,
        try at 1013, first fs op (manifest readFile) ~1019 — the guard inserts between 1005 and 1006.
        The recipe (manifest read → manifest loop readBlob/writeFile/unlink → cas-mode walkTree) is
        UNCHANGED. NO ensureInit() in CasBackend (storageDir resolved in constructor; CasBackend has no
        shadow repo) — so restore()'s first fs op is the manifest readFile, NOT an init."
  pattern: "The other mutex-acquiring methods (capture 572, appendExplicitPath 718, dirtyCheck 799,
            changedPaths 893, restore 1005, has 1125, retire 1148, destroy 1177, gc 1207) each do
            `const release = await this.mutex.acquire(); try { ... } finally { release(); }`. restore()
            is the ONLY one that needs the forbidden-root gate because it is the only one that WRITES
            the user's worktree (revert/delete). The guard's shape — acquire → gate(release+return) →
            try/finally — mirrors git.ts T3.S2 exactly."
  gotcha: "this.cwd is set ONCE in the constructor and is `readonly` (private readonly cwd). It does NOT
           change between construction and restore(). So isForbiddenRoot re-checking this.cwd is checking
           the SAME canonical root detection would have refused. After THIS task's constructor change,
           this.cwd is the realpath of cwd — canonical — so isForbiddenRoot(this.cwd) is sound. Do NOT
           re-realpath or re-normalize inside the guard."

# CONTRACT — realpathSafe pattern (copy verbatim from git.ts; P1.M1.T3.S1, ALREADY in git.ts source)
- file: src/snapshot/git.ts
  why: "git.ts defines the MODULE-PRIVATE `realpathSafe` helper at ~line 157 — the exact pattern to
        copy into cas.ts. Defense-in-depth: detectAndCreate (store.ts, T2.S1) ALREADY realpathSync's
        cwd before constructing the backend, so the production path's realpathSync never throws; the
        catch fallback exists for direct-test construction (e.g. cwd='/fake/cwd' which does not exist)
        AND for the homedir()/`/` test cwds (which DO exist → realpathSync succeeds → canonical)."
  pattern: |
    function realpathSafe(cwd: string): string {
      try {
        return realpathSync(cwd);
      } catch {
        return resolve(cwd);
      }
    }
  critical: "Place it MODULE-PRIVATE (NOT a class method) near the top of cas.ts — after the imports,
             before the `realFs` const (line ~95) / the type exports. Mirror git.ts's placement. It
             needs `realpathSync` from node:fs (NEW import) and `resolve` from node:path (already
             imported at line 13). DO NOT make it a class method — it's a pure helper called once in
             the constructor."

# MUST READ — THE test file being modified (append a block; add one import)
- file: test/cas.test.ts
  why: "THE test file modified. Imports at lines 29–39 (ADD `import { homedir } from \"node:os\";`
        after the node:path import at line 31). The stable helpers: `BASE_CFG` (~line 36), `makeBackend`
        (~line 50 — hardcodes cwd='/fake/cwd'), `makeStateFs` + `makeStateBackend` (mutable worktree
        fake — the recording CasFs pattern used by the restore describe at line 1279), `makeRecordingFs`
        (inside the storeBlob describe — a recording CasFs that tracks writeFile/access/mkdir calls:
        the TEMPLATE for the forbidden-root test's recording fake). The restore describe block starts
        at line 1279 — append the new block AFTER it (e.g. after the last restore `it`, or at the very
        end of the file; co-locating with restore is cleaner)."
  pattern: "House idiom: each `it` constructs a CasBackend wired to a CasFs fake via the `deps.fs` DI
            seam, calls the method, asserts on `res` (the RestoreResult) AND on the fake's recorded
            call arrays. The `makeRecordingFs()` helper (storeBlob describe) shows the recording-fake
            shape: a `calls` object with per-method arrays. The forbidden-root tests build a MINIMAL
            recording CasFs (all 7 CasFs methods instrumented to push to arrays + return safe defaults)
            so an EMPTY call log proves zero mutation. Direct construction idiom:
            `new CasBackend(cwd, cfg, null, { fs: recordingFake })`."
  gotcha: "makeBackend hardcodes cwd='/fake/cwd'. You CANNOT reuse it for the forbidden-root cases
           (they need a forbidden cwd). Construct CasBackend directly (like the dirtyCheck
           `throwingFs` test at ~line 1015: `new CasBackend(\"/ws\", {...BASE_CFG, ...}, null, { fs })`).
           For the negative control, DO reuse makeStateBackend (its /ws cwd is intentionally
           non-forbidden — capture→mutate→restore round-trips)."

# CONTRACT — isForbiddenRoot (the symbol this task consumes; COMPLETE — T1.S1 done)
- file: src/snapshot/paths.ts
  why: "Exports `isForbiddenRoot(root: string): boolean` — true iff root is home / `/` / depth-1
        (dirname==='/') / empty / dot. This is the predicate the guard calls. PURE (no fs; homedir()
        reads an env var). Already complete + unit-tested (P1.M1.T1.S1). Just import it."
  pattern: "Import via the EXISTING `from \"./paths.js\"` destructure in cas.ts (lines 19–23). Add
            isForbiddenRoot as the 4th name (after resolveSafeWorkspacePath). Do NOT add a second
            `from \"./paths.js\"` line."
  critical: "The predicate assumes its arg is ALREADY CANONICALIZED (realpath). this.cwd IS — after THIS
             task's constructor change (realpathSafe(cwd)). So isForbiddenRoot(this.cwd) is correct.
             Do NOT pass raw opts/beforeRef or anything else — pass this.cwd, the workspace root."

# PARITY REFERENCE — the git.ts sibling (P1.M1.T3.S2 — assume COMPLETE)
- file: plan/009_1ecb4b3cb372/P1M1T3S2/PRP.md
  why: "T3.S2 is the IDENTICAL-pattern task for git.ts: restore() forbidden-root entry guard + a
        3-case test block. THIS task is its cas.ts mirror. The guard code, the gotchas (release before
        return; fires before init/manifest-read → zero mutation; /fake/cwd not forbidden; check this.cwd;
        construct directly; dynamic homedir; return not throw; only restore()), and the test shape
        (home→refused+empty-log, '/'→refused+empty-log, negative-control→guard-skipped+restore-runs)
        ALL carry over. The ONLY deltas: (1) cas.ts needs the constructor realpathSafe change too
        (git.ts got it in T3.S1); (2) cas.ts needs a NEW node:fs import (it imports only
        node:fs/promises today); (3) cas.ts's DI seam is this.fs (CasFs), not exec — so 'zero mutation'
        = empty readFile/writeFile/unlink arrays, not an empty exec log."
  critical: "Treat T3.S2's PRP as the structural template. The guard code is verbatim-identical; only
             the surrounding plumbing (constructor change + node:fs import + CasFs-vs-exec test fake)
             differs."

# CONTRACT — RestoreResult (the return type; store.ts is PURE TS — read to confirm the refused bucket)
- file: src/snapshot/store.ts
  why: "RestoreResult interface (lines 194–200): { reverted, deleted, failed, skipped, refused } all
        string[]. The guard's inline return matches this shape exactly. `refused` (line 199) is the
        semantically correct bucket (E30 'the WHOLE file-revert refused' — here the whole op is
        refused because the root is forbidden; same 'refuse the whole thing' semantics)."
  section: "RestoreResult interface (194–200) + its doc (181–193, esp. the refused: E30 line 189)"
  critical: "Do NOT invent a new bucket or a boolean flag. Reuse refused[] (it is already plumbed into
             the rewind success text + marker by P4). The offending root goes in refused[0]."

# READ — the canonical change inventory (authoritative for the overall plan)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "Scopes cas.ts restore() guard to T4.S1. Confirms the per-subtask boundary so you do NOT
        over-reach into git.ts (T3.S2 — its OWN restore guard) or store.ts (T2.S1)."
  section: "the src/snapshot/cas.ts T4.S1 row + the test/cas.test.ts forbidden-root row"
  critical: "Do NOT touch git.ts (T3.S2 owns its restore guard), store.ts (T2.S1), paths.ts (T1 done),
             README (M2.T2), or integration tests (M2.T1)."
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
├── git.ts     # ← REFERENCE ONLY (realpathSafe helper to COPY; its restore() guard is the PATTERN — landed by T3.S2). DO NOT EDIT.
├── cas.ts     # ← THE source file modified: +node:fs import; +realpathSafe helper; constructor resolve→realpathSafe; +isForbiddenRoot import; +restore() guard (4 lines); +restore() JSDoc §2 sentence
├── paths.ts   # ← UNCHANGED (T1.S1 COMPLETE — exports isForbiddenRoot; consumed here)
└── store.ts   # ← UNCHANGED (RestoreResult interface is read-only reference here)
test/
└── cas.test.ts # ← MODIFIED: +import { homedir } from "node:os"; +new describe block (3 it cases)
```

### Desired Codebase tree

```bash
src/snapshot/
└── cas.ts      # MODIFIED (+1 node:fs import line; +~5-line realpathSafe helper; ctor 1-line change;
                #  +1 paths.js import name; +4-line guard; +1 JSDoc sentence — that is the ENTIRE src diff)
test/
└── cas.test.ts # MODIFIED (+1 import line; +1 describe block with 3 it cases + a recording CasFs helper)
```
No new files. git.ts / paths.ts / store.ts / README / integration tests are NOT touched.

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — the guard MUST release() the mutex before returning.
// restore() is `const release = await this.mutex.acquire(); ... try { ... } finally { release(); }`.
// The guard runs BEFORE the `try` block, so the `finally { release() }` does NOT cover it. If you
// forget `release()`, the mutex leaks → the NEXT op on this backend deadlocks. The contract's literal
// code calls `release()` then `return { ... }`. (Acceptable alt: move the guard INSIDE try and do
// `result.refused.push(this.cwd); return result;` so the centralized finally releases — but the
// inline form matches the contract verbatim and keeps the guard the absolute first statement.)

// GOTCHA #2 — the guard fires BEFORE the manifest readFile. This is LOAD-BEARING for the test.
// cas.ts has NO ensureInit() (unlike git.ts). restore()'s first fs op is
// `this.fs.readFile(this.manifestPath(beforeRef))` inside the try block. The guard runs BEFORE that
// try, so the recording CasFs fake's readFile/writeFile/unlink are NEVER invoked → all call arrays
// empty. That empty log is the proof of ZERO mutation. Do NOT pre-seed a manifest for the home/'/'
// tests — the guard returns before it would ever be read.

// GOTCHA #3 — "/fake/cwd" and "/ws" (the makeBackend / makeStateBackend defaults) are NOT forbidden.
// isForbiddenRoot("/fake/cwd"): depth-2, not home, not "/", dirname="/fake"≠"/" → FALSE.
// isForbiddenRoot("/ws"): depth-1?! dirname("/ws")==="/" → TRUE?! NO — wait: "/ws" has dirname==="/",
// so isForbiddenRoot("/ws") IS true. THIS IS A TRAP. The existing cas.test.ts restore/dirtyCheck
// tests use cwd="/ws" (depth-1). If you naively reuse makeStateBackend(cwd="/ws") for the negative
// control, the guard WILL fire and refused will be ["/ws"] — breaking the existing-test no-op claim
// AND making your negative control wrong. VERIFY: isForbiddenRoot("/ws") → dirname("/ws")==="/" → TRUE.
// So cwd="/ws" IS forbidden! Use a depth-≥-2 cwd for the negative control (e.g. "/ws/proj" or
// "/fake/cwd"). NOTE: this ALSO means the constructor change + guard, once landed, would make
// EVERY existing cas.test.ts test that constructs with cwd="/ws" (makeTreeBackend/makeStateBackend
// default to "/ws") trip the guard on restore()! See GOTCHA #3b for the resolution.

// GOTCHA #3b — CRITICAL (VERIFIED): the existing cas.test.ts restore tests use cwd="/ws" which IS
// forbidden. VERIFIED: dirname("/ws") === "/" → isForbiddenRoot("/ws") === TRUE (confirmed by node -e).
// There are 94 occurrences of "/ws" in test/cas.test.ts. makeTreeFs/makeTreeBackend/makeStateFs take
// cwd as a REQUIRED param (NO default) — the "/ws" is passed EXPLICITLY in every call.
// BLAST RADIUS: the guard is restore()-ONLY, so ONLY tests that CALL restore() with cwd="/ws" break.
// capture/dirtyCheck/changedPaths/has/retire/gc tests use cwd="/ws" too but NEVER call restore() → they
// are UNAFFECTED (those methods have no guard). The breakage is confined to the restore describe block
// (line ~1279) + any round-trip test (capture→restore) in the caps-tracking describe (~1945) + the
// mutex describe (~1559) if it calls restore. Run `npx vitest run test/cas.test.ts` after landing the
// guard — the RED tests are EXACTLY the restore() callers; each will show refused:["/ws"].
// RESOLUTION (mechanical, IN SCOPE for T4.S1): in each RED restore() test, change the makeStateFs /
// makeStateBackend / makeTreeBackend cwd argument from "/ws" to "/ws/proj" (depth-2: dirname="/ws"≠"/"
// → NOT forbidden). Workspace-REL manifest keys (e.g. "src/a.ts") are INDEPENDENT of cwd, so capture
// assertions on manifest keys stay green. This is NOT a defect of the guard — it's a latent fixture
// bug (the tests used a forbidden cwd because no guard existed to catch it). BEFORE WRITING the new
// test block: land Tasks 1–6, run `npx vitest run test/cas.test.ts`, grep the RED output for
// refused:["/ws"], bump those cwds to "/ws/proj", re-run until green.

// GOTCHA #4 — construct CasBackend DIRECTLY for forbidden cwd (makeBackend hardcodes /fake/cwd).
// The forbidden-root tests need cwd=homedir() or "/". makeBackend() bakes in "/fake/cwd". So use the
// DIRECT idiom (mirroring the dirtyCheck throwingFs test ~line 1015):
//   const cb = new CasBackend(home, BASE_CFG, null, { fs: recordingFake });
// For the NEGATIVE control, construct with a depth-≥-2 non-forbidden cwd (NOT "/ws" — see #3b):
//   new CasBackend("/fake/cwd", BASE_CFG, null, { fs: recordingFake })  OR reuse makeStateBackend
//   with an explicit depth-2 cwd.

// GOTCHA #5 — homedir() is DYNAMIC (varies per machine/CI). Never hardcode "/home/dustin".
// realpathSafe(homedir()) → realpathSync(homedir()) succeeds (home exists) → homedir(). So this.cwd
// === homedir() exactly. Compute `const home = homedir();` ONCE per test, use it for BOTH the ctor
// arg AND the refused assertion (`expect(res.refused).toEqual([home])`). Import homedir from node:os.

// GOTCHA #6 — restore() is BEST-EFFORT (never rejects). The forbidden-root guard must also never reject.
// The contract returns a value (not a throw). Do NOT `throw` on a forbidden root — return the refused
// RestoreResult. This matches restore()'s E27 contract and the rewind tool's "revert degradation never
// blocks the context rewind" rule (the refused bucket surfaces in the rewind success text, not as an error).

// GOTCHA #7 — the guard checks this.cwd, and THIS task makes this.cwd canonical.
// Before this task: this.cwd = resolve(cwd) (does NOT resolve symlinks — same bug git.ts had pre-T3.S1).
// After: this.cwd = realpathSafe(cwd) (realpath, with a resolve() fallback for non-existent test cwds).
// The isForbiddenRoot predicate's depth test (dirname==="/") + home test (root===homedir()) are only
// meaningful against a canonical path. The constructor change is what makes the guard SOUND. Do not
// add the guard without the constructor change (a symlinked home would evade the depth/home checks).

// GOTCHA #8 — NEW node:fs import line (cas.ts imports only node:fs/promises today).
// `realpathSync` is a SYNCHRONOUS function in the `node:fs` module — DISTINCT from `node:fs/promises`
// (which cas.ts imports at lines 1–11). You MUST add a separate import line:
//   import { realpathSync } from "node:fs";
// Place it BEFORE the `from "node:fs/promises"` block (alphabetical/grouped node: import style —
// mirror git.ts, which has `from "node:fs"` then `from "node:fs/promises"`). Do NOT try to pull
// realpathSync from node:fs/promises — it is not there.

// GOTCHA #9 — do NOT widen the guard to other methods.
// Only restore() gets this gate (it is the only method that WRITES the user's worktree — revert/delete).
// capture()/appendExplicitPath() write to the BLOB STORE only (not the worktree); dirtyCheck/
// changedPaths/has are read-only; retire/gc/destroy target the blob/manifest store. restore() is the
// one with catastrophic blast radius. Adding the guard elsewhere would be dead code (detection already
// refused → those methods never run on a forbidden-root backend in production). Keep it surgical.

// GOTCHA #10 — POSIX orientation is inherited (not introduced here).
// isForbiddenRoot uses `dirname(root) === "/"` (POSIX). On Windows, drive-roots (C:\) aren't caught by
// the depth check, but the home IS caught (os.homedir() → C:\Users\<user>). This is a documented
// limitation of the predicate (T1.S1), not a defect of this guard. Do NOT add Windows handling here.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `RestoreResult` (store.ts 194–200) already has the `refused: string[]` bucket
the guard populates. `RestoreOpts`, `SnapshotStore`, `AsyncMutex`, `CasBackend` fields, `CasFs`,
`CasManifest` are all UNCHANGED. The guard adds zero types — it is a constructor 1-line change + a
~5-line helper + 1 node:fs import + 1 paths.js import name + 4 statements + 1 JSDoc sentence.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/cas.ts — add the node:fs import (realpathSync)
  - LOCATE the import block (lines 1–13). Current top:
        import { createHash } from "node:crypto";
        import {
          readFile as fsReadFile,
          ...
          rm as fsRm,
        } from "node:fs/promises";
        import { join, resolve, dirname } from "node:path";
  - ADD (a NEW line — node:fs is the SYNC module, distinct from node:fs/promises) IMMEDIATELY AFTER
    the `from "node:crypto"` line and BEFORE the `from "node:fs/promises"` block:
        import { realpathSync } from "node:fs";
  - WHY: realpathSafe (Task 3) needs realpathSync. cas.ts imports only node:fs/promises today; the
    SYNC realpathSync is in node:fs. Mirror git.ts's import grouping (node:fs before node:fs/promises).
  - GOTCHA #8.
  - DEPENDENCIES: none.

Task 2: MODIFY src/snapshot/cas.ts — add the isForbiddenRoot import (paths.js)
  - LOCATE the existing destructure from "./paths.js" (lines 19–23):
        import {
          normalizeRelPath,
          isDangerousWorkspaceRel,
          resolveSafeWorkspacePath,
        } from "./paths.js";
  - ADD `isForbiddenRoot,` to the destructure (place it after resolveSafeWorkspacePath — or grouped
    with the `is*` predicate isDangerousWorkspaceRel; either reads fine):
        import {
          normalizeRelPath,
          isDangerousWorkspaceRel,
          isForbiddenRoot,
          resolveSafeWorkspacePath,
        } from "./paths.js";
  - DO NOT add a second `from "./paths.js"` line. DO NOT touch any other import.
  - DEPENDENCIES: none (isForbiddenRoot is exported by T1.S1 — COMPLETE).

Task 3: MODIFY src/snapshot/cas.ts — add the module-private realpathSafe helper
  - LOCATE a placement point AFTER the imports + type exports but BEFORE the `realFs` const (~line
    95) / the CasBackend class. A natural spot: right after the `CasBackendDeps` interface (just
    before `const realFs`). Mirror git.ts (where realpathSafe sits after the GitBackendDeps-ish
    helpers, before the class).
  - INSERT (verbatim — copied from git.ts):
        /**
         * Canonicalize `cwd` to its real absolute path WITHOUT following-symlinks surprises:
         * `realpathSync` resolves the whole chain; on ANY failure (ENOENT / unreadable / symlink-loop —
         * e.g. a direct unit test constructing CasBackend with a non-existent /fake/cwd) it falls back
         * to `resolve(cwd)`. Defense-in-depth: detectAndCreate (P1.M1.T2.S1) ALREADY realpathSync's cwd
         * before constructing CasBackend, so the production path's realpathSync never throws; the
         * fallback exists for direct-test construction + any future caller. MODULE-PRIVATE.
         */
        function realpathSafe(cwd: string): string {
          try {
            return realpathSync(cwd);
          } catch {
            return resolve(cwd);
          }
        }
  - WHY: the constructor (Task 4) calls realpathSafe; isForbiddenRoot (Task 6 guard) assumes a
    canonicalized root. This is the exact pairing git.ts landed (T3.S1 realpathSafe + T3.S2 guard),
    done in ONE task here for cas.ts.
  - DEPENDENCIES: Task 1 (realpathSync in scope).

Task 4: MODIFY src/snapshot/cas.ts — constructor: resolve → realpathSafe
  - LOCATE the constructor body (line 263):
        this.cwd = resolve(cwd);
  - CHANGE to:
        this.cwd = realpathSafe(cwd);
  - WHY: resolve() does NOT resolve symlinks (the same issue git.ts had pre-T3.S1). A symlinked home
    or a shallow dir reached via a symlink would evade isForbiddenRoot's depth/home tests. realpathSafe
    canonicalizes first (realpath), with a resolve() fallback for non-existent test cwds.
  - GOTCHA #7. NO other constructor line changes (storageDir/sessionDir/fs resolution unchanged).
  - DEPENDENCIES: Task 3 (realpathSafe defined).

Task 5: MODIFY src/snapshot/cas.ts — add the restore() entry guard
  - LOCATE restore() (line 1004). Current opening (1004–1006):
        async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
          const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
          const result: RestoreResult = {
  - INSERT between the mutex-acquire line (1005) and the `const result` line (1006) (verbatim):
        // SAFETY INVARIANT entry guard (spec/14 §2) — the LAST LINE OF DEFENSE, independent of
        // detection (detectAndCreate already refuses forbidden roots → NoOp; this re-checks at
        // restore() entry so a hand-constructed backend or a detection regression cannot bypass it).
        // Fires BEFORE the manifest readFile and BEFORE any writeFile/unlink → ZERO filesystem mutation
        // on refuse. @spec/14 §2 (SAFETY INVARIANT) + §6 (restore semantics).
        if (isForbiddenRoot(this.cwd)) {
          release();
          return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] };
        }
  - WHY: spec/14 §2 mandates restore() re-check the forbidden-root invariant at entry and refuse with
    zero mutation. release() frees the mutex (the try/finally below isn't entered yet). The inline
    return matches the RestoreResult shape exactly (all 5 buckets; refused names the offending root).
    cas.ts has NO ensureInit() — the first fs op is the manifest readFile inside the try, which the
    guard precedes.
  - GOTCHA #1 (release before return), #2 (fires pre-manifest-read), #6 (return not throw), #7
    (this.cwd is canonical after Task 4), #9 (restore() only).
  - DEPENDENCIES: Tasks 2 (isForbiddenRoot) + 4 (this.cwd canonical).

Task 6: MODIFY src/snapshot/cas.ts — extend the restore() JSDoc with §2
  - LOCATE the restore() JSDoc opening (immediately above line 1004). Current first ~3 lines:
        * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state).
        * spec/14 §6 (restore semantics), §2 (the interface). Serialized by the mutex (spec §4.3).
        * CONSUMED BY: rewindExecute step 6b (P4.M2.T1.S2) after the dirty guard passes.
  - REPLACE the §6/§2-interface sentence (line 2) to ALSO cite §2 SAFETY INVARIANT + describe the
    guard. New text:
        * spec/14 §2 (SAFETY INVARIANT — the forbidden-root entry guard: restore() re-checks
        * isForbiddenRoot(this.cwd) as its FIRST act and refuses with ZERO filesystem mutation if the
        * resolved root is forbidden; a last line of defense independent of detection), §6 (restore
        * semantics), §2 (the interface). Serialized by the mutex (spec §4.3).
  - Keep the rest of the JSDoc (RECIPE, BEST-EFFORT, CONSUMED BY) UNCHANGED.
  - WHY: DOCS requirement #5 (Mode A — JSDoc rides WITH the work). The existing JSDoc cites §2 only
    as "the interface"; the guard's SAFETY-INVARIANT meaning is invisible without this.
  - DEPENDENCIES: Task 5 (the code it documents is already in place).

Task 7: AUDIT + FIX existing cas.test.ts restore() cwds (GOTCHA #3b — VERIFIED: "/ws" IS forbidden)
  - VERIFIED FACT: isForbiddenRoot("/ws") === TRUE (dirname("/ws")===" /"). The guard is restore()-ONLY,
    so ONLY existing tests that CALL restore() with cwd="/ws" break (capture/dirtyCheck/changedPaths
    tests use cwd="/ws" too but never call restore() → UNAFFECTED). makeTreeFs/makeTreeBackend/makeStateFs
    take cwd as a REQUIRED param (no default) — "/ws" is passed explicitly in each call.
  - AFTER landing Tasks 1–6 (before writing the new test), RUN `npx vitest run test/cas.test.ts`. The RED
    tests are EXACTLY the restore() callers; each fails on `refused` unexpectedly containing ["/ws"].
  - FIX (mechanical): in each RED restore() test, change the makeStateFs/makeStateBackend/
    makeTreeBackend cwd argument from "/ws" to "/ws/proj" (depth-2: dirname="/ws"≠"/" → NOT forbidden).
    Workspace-REL manifest keys (e.g. "src/a.ts", "a.ts") are INDEPENDENT of cwd, so capture→restore
    round-trip assertions on file keys + reverted/deleted rel-path arrays stay GREEN unchanged.
  - SCOPE: do NOT mass-replace all 94 "/ws" occurrences — only the restore() callers that went RED.
    (A blanket replace would churn capture/dirtyCheck tests for no benefit; they're green as-is.)
  - RE-VERIFY `npx vitest run test/cas.test.ts` (full file) green BEFORE writing the new block.
  - WHY: the guard is only a "transparent no-op for non-forbidden cwds" if the restore() fixtures
    actually use non-forbidden cwds. "/ws" is forbidden. This audit is IN SCOPE for T4.S1 (the
    constructor canonicalization + guard expose the latent fixture bug).
  - GOTCHA #3, #3b. DEPENDENCIES: Tasks 1–6 (guard in place to reveal the breakage).
  - WHY: the guard is only a "transparent no-op for non-forbidden cwds" if the test fixtures actually
    use non-forbidden cwds. "/ws" is forbidden. This audit is IN SCOPE for T4.S1 (the constructor
    canonicalization + guard expose the latent fixture bug).
  - GOTCHA #3, #3b.
  - DEPENDENCIES: Tasks 1–6 (guard in place to reveal the breakage).

Task 8: MODIFY test/cas.test.ts — import homedir from node:os
  - LOCATE the import block (lines 29–39):
        import { describe, it, expect, vi } from "vitest";
        import { createHash } from "node:crypto";
        import { join, resolve, sep } from "node:path";
        import { CasBackend, ... } from "../src/snapshot/cas.js";
  - ADD (match the node:* grouping — place after the node:path line):
        import { homedir } from "node:os";
  - WHY: the home-refuse test needs the DYNAMIC home (varies per machine/CI — GOTCHA #5).
  - DEPENDENCIES: none (test-side).

Task 9: MODIFY test/cas.test.ts — append the forbidden-root describe block
  - PLACEMENT: append AFTER the existing restore describe block (which ends before
    `describe("CasBackend.has — spec/14 §2")` at line 1498). A clear `// ─────` separator matches the
    file's style.
  - HEADER comment: cite spec/14 §2 SAFETY INVARIANT + §10 + task P1.M1.T4.S1.
  - IMPLEMENT (3 cases — full bodies, with a local recording CasFs helper):

      // ─────────────────────────────────────────────────────────────────────────────
      // A RECORDING CasFs that pushes EVERY method call to an array + returns safe defaults.
      // For the forbidden-root cases, an EMPTY call log (readFile/writeFile/unlink never invoked)
      // is the proof of ZERO filesystem mutation (spec/14 §10). The guard fires before the manifest
      // readFile, so even readFile is never called.
      function makeRecordingCasFs() {
        const calls = {
          readFile: [] as string[],
          writeFile: [] as Array<{ path: string; data: Buffer }>,
          unlink: [] as string[],
          mkdir: [] as string[],
          access: [] as string[],
          stat: [] as string[],
          readdir: [] as string[],
        };
        const fakeFs: CasFs = {
          readFile: async (p) => { calls.readFile.push(p); return Buffer.from(""); },
          writeFile: async (p, d) => { calls.writeFile.push({ path: p, data: d }); },
          unlink: async (p) => { calls.unlink.push(p); },
          mkdir: async (p) => { calls.mkdir.push(p); },
          access: async (p) => { calls.access.push(p); },
          stat: async (p) => { calls.stat.push(p); return { size: 0, mtimeMs: 0 }; },
          readdir: async (p) => { calls.readdir.push(p); return []; },
        };
        return { fakeFs, calls };
      }

      describe("CasBackend.restore — forbidden-root entry guard (spec/14 §2 SAFETY INVARIANT)", () => {
        // spec/14 §2: "restore() MUST additionally re-check this invariant at its entry and refuse
        // (returning {refused} with zero filesystem mutation) if the resolved root is forbidden — a
        // last line of defense independent of detection." The guard fires BEFORE the manifest readFile
        // (so no manifest stub is needed) and BEFORE any writeFile/unlink (so the CasFs call log is
        // empty). makeBackend/makeStateBackend default to a NON-forbidden cwd, so the home/'/' cases
        // construct CasBackend DIRECTLY (mirroring the dirtyCheck throwingFs test's direct idiom).

        it("refuses when cwd is the user's home — refused:[home], other buckets empty, ZERO mutation", async () => {
          const home = homedir();
          const { fakeFs, calls } = makeRecordingCasFs();
          const cb = new CasBackend(home, BASE_CFG, null, { fs: fakeFs });
          const res = await cb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
          expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [home] });
          // ZERO mutation: the guard fired before the manifest readFile and before any writeFile/unlink.
          expect(calls.readFile).toEqual([]);
          expect(calls.writeFile).toEqual([]);
          expect(calls.unlink).toEqual([]);
          expect(calls.access).toEqual([]);
        });

        it("refuses when cwd is '/' (filesystem root) — same refused shape, ZERO mutation", async () => {
          const { fakeFs, calls } = makeRecordingCasFs();
          const cb = new CasBackend("/", BASE_CFG, null, { fs: fakeFs });
          const res = await cb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
          expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: ["/"] });
          expect(calls.readFile).toEqual([]);
          expect(calls.writeFile).toEqual([]);
          expect(calls.unlink).toEqual([]);
        });

        it("does NOT fire for a normal (non-forbidden) cwd — restore proceeds (negative control)", async () => {
          // a depth-≥-2 cwd (dirname !== "/") is NOT forbidden. Use makeStateBackend with a capture→
          // mutate→restore round-trip so the negative control proves the guard is a transparent no-op
          // AND restore still runs its recipe. cwd here is non-forbidden (depth-2).
          const state = makeStateFs("/ws/proj", "/store", { "a.ts": Buffer.from("original") });
          const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
          const beforeRef = await cb.capture("turn", ["a.ts"]);
          state.set("a.ts", Buffer.from("CHANGED BY AGENT"));
          const res = await cb.restore(beforeRef!, { revertFileChanges: true, deleteCreatedFiles: false });
          expect(res.refused).toEqual([]);            // guard did NOT fire
          expect(res.reverted).toEqual(["a.ts"]);      // restore ran the recipe
          expect(state.read("a.ts")?.toString()).toBe("original");  // worktree reverted
        });
      });

  - WHY: the 3 cases pin the contract — (a) the historical regression vector ($HOME), (b) the
    depth-0 root, (c) the no-op-on-normal-paths guarantee (so the guard cannot over-fire and break
    legitimate restores). The empty-calls assertion is the "zero filesystem mutation" proof (§10).
  - GOTCHA #2 (no manifest stub needed), #4 (direct construction), #5 (dynamic home), #3b (negative
    control uses depth-2 cwd "/ws/proj", NOT "/ws").
  - DEPENDENCIES: Tasks 1–8 (the guard + imports must land for cases a/b to pass; case c needs the
    existing makeStateFs/makeStateBackend helpers + a non-forbidden cwd — see Task 7).

Task 10: VALIDATE (no code)
  - RUN: `npm run typecheck` (tsc --noEmit). MUST be clean. Watch for: "Cannot find name
    'realpathSync'" (Task 1 missed); "Cannot find name 'isForbiddenRoot'" (Task 2 missed); "Cannot
    find name 'homedir'" (Task 8 missed); "Cannot find name 'realpathSafe'" (Task 3 missed).
  - RUN: `npx vitest run test/cas.test.ts -t "forbidden-root entry guard"`. The 3 new cases green.
  - RUN: `npx vitest run test/cas.test.ts` (FULL file). MUST be green — including the existing
    restore tests IF Task 7's cwd audit/fix landed. If existing restore tests are RED on
    refused:["/ws"], Task 7 is incomplete (bump their cwd to "/ws/proj").
  - RUN: `npm test` (full suite). Expected ALL green.
```

### Implementation Patterns & Key Details

```typescript
// THE WHOLE SOURCE DIFF in one glance (cas.ts). Six hunks, ~12 lines net:
//
//   (1) NEW import (after node:crypto): `import { realpathSync } from "node:fs";`
//   (2) paths.js destructure (lines 19–23): + isForbiddenRoot,
//   (3) NEW module-private helper (after CasBackendDeps, before realFs): realpathSafe() ~5 lines
//       (copied verbatim from git.ts).
//   (4) constructor (line 263): `this.cwd = resolve(cwd);` → `this.cwd = realpathSafe(cwd);`
//   (5) restore() guard (between the mutex-acquire line 1005 and const-result line 1006):
//         if (isForbiddenRoot(this.cwd)) {
//           release();
//           return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] };
//         }
//   (6) restore() JSDoc (line ~1001): + "spec/14 §2 (SAFETY INVARIANT — ... entry guard ... last line
//       of defense independent of detection)".
//
// WHY this.cwd (not some lazy field): cas.ts has NO ensureInit() (unlike git.ts). this.cwd is set in
// the CONSTRUCTOR (realpathSafe(cwd) after this task) and is `readonly` — always populated + canonical.
// (GOTCHA #7.)
//
// WHY release() before return: restore() is `acquire; ... try { ... } finally { release() }`. The
// guard runs BEFORE the try, so the finally doesn't cover it. Forgetting release() leaks the mutex
// → the next op on this backend deadlocks. (GOTCHA #1.)
//
// WHY refused[] (not a new bucket / not a throw): RestoreResult.refused is ALREADY the "the whole op
// was refused" bucket (E30 dirty-guard uses it the same way). The rewind success text + marker already
// plumb refused into the user-visible result. restore() is best-effort (E27 — never rejects), so the
// guard returns a value, never throws. (GOTCHA #6.)
//
// WHY the constructor change is MANDATORY with the guard: isForbiddenRoot's depth test
// (dirname==="/") + home test (root===homedir()) are only meaningful against a CANONICAL path. Bare
// resolve() does NOT resolve symlinks — a symlinked home or a shallow dir reached via a symlink would
// evade both checks. realpathSafe canonicalizes first (realpath, with a resolve() fallback for
// non-existent test cwds like /fake/cwd). The guard is only SOUND because the constructor changed.
// (GOTCHA #7.)
```

### Integration Points

```yaml
CONSUMERS (unchanged — they call restore() and read RestoreResult):
  - rewindExecute (rewind.ts, P4.M2.T1.S2): calls restore(beforeRef, opts); folds the 5 buckets into
    the rewind success text ("...; <W> refused"). A forbidden-root restore now surfaces as refused=[root]
    in that text — which is the correct, honest outcome (the op was refused; context rewind proceeds).
    NO CHANGE to rewindExecute needed: refused is already a recognized bucket.
  - detectAndCreate (store.ts, T2.S1): in PRODUCTION, refuses forbidden roots → NoOp BEFORE any backend
    is constructed, so CasBackend.restore() is never even called on a forbidden root in the normal
    path. This guard is the INDEPENDENT backstop for the case where detectAndCreate is bypassed
    (hand-constructed backend / future direct caller / detection regression). (spec/14 §2.)

NO DATABASE / NO CONFIG / NO ROUTES / NO NEW ENV VARS:
  - This is a ~12-line safety gate + constructor canonicalization. No migration, no config knob, no
    route, no env var.
  - isForbiddenRoot's forbidden set is hardcoded (home / `/` / depth-1 / degenerate) — it does NOT
    read config.revert.* (paths.ts is config-free by design, T1.S1).

SCOPE GUARDRAILS (do NOT touch — separate subtasks):
  - git.ts restore() guard → P1.M1.T3.S2 (the parallel sibling — assume COMPLETE).
  - store.ts detectAndCreate → P1.M1.T2.S1 (the detection-side refuse).
  - paths.ts isForbiddenRoot → P1.M1.T1.S1 (COMPLETE — consumed, not modified).
  - README safety paragraph → P1.M2.T2.S1 (Mode B docs).
  - integration tests → P1.M2.T1.S1.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check (project uses tsc --noEmit; NO eslint/biome/ruff).
npm run typecheck
# Expected: zero errors. Watch specifically for:
#  - "Cannot find name 'realpathSync'"   → Task 1 (node:fs import) missed.
#  - "Cannot find name 'isForbiddenRoot'" → Task 2 (paths.js destructure) missed.
#  - "Cannot find name 'realpathSafe'"   → Task 3 (helper) missed or mis-placed (must be module-scope).
#  - "Cannot find name 'homedir'"        → Task 8 (test import) missed.
#  - "Property 'refused' ..." or shape mismatch → the inline return object is malformed (it must
#    have all 5 buckets: reverted/deleted/failed/skipped/refused).
```

> NOTE: this is a TypeScript + vitest project. `package.json` scripts are `test`, `typecheck`,
> `smoke`, `prepublishOnly`. There is no ruff/mypy/eslint/biome — do not invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# THE focused validation for this subtask — isolate by name.
npx vitest run test/cas.test.ts -t "forbidden-root entry guard"
# Expected: 3 cases green:
#   ✓ refuses when cwd is the user's home — refused:[home], other buckets empty, ZERO mutation
#   ✓ refuses when cwd is '/' (filesystem root) — same refused shape, ZERO mutation
#   ✓ does NOT fire for a normal (non-forbidden) cwd — restore proceeds (negative control)
# If the home/'/' cases FAIL with a NON-empty readFile/writeFile/unlink array → the guard did NOT
# fire (Task 5 missed, or isForbiddenRoot returned false — check the import resolved + this.cwd is
# the canonical root). If the negative control FAILS (refused:[cwd]) → the cwd WAS forbidden
# (GOTCHA #3b: did you use "/ws"? switch to "/ws/proj" — depth-2).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full cas.test.ts — confirms the additive change broke nothing + Task 7's cwd audit is complete.
npx vitest run test/cas.test.ts
# Expected: ALL green, including:
#   - the new forbidden-root block (3 cases),
#   - the existing restore block (refused:[] for all non-forbidden cwds — guard is a no-op there).
# IF the existing restore tests go RED on refused:["/ws"] → Task 7 is incomplete: bump their cwd
# (and/or the makeTreeBackend/makeStateFs default) from "/ws" to "/ws/proj" (depth-2, non-forbidden).

# Full suite — confirms no cross-file breakage.
npm test
# Expected: ALL green, including cas.test.ts, git.test.ts (T3.S2's block if landed), paths.test.ts,
# store.test.ts, integration revert-*.test.ts.

# Spot-check the guard is wired (manual grep — confidence, not a test):
grep -n "isForbiddenRoot" src/snapshot/cas.ts
# Expected: the import line + the guard's `if (isForbiddenRoot(this.cwd))` = 2 matches.
grep -n "realpathSafe" src/snapshot/cas.ts
# Expected: the helper definition (2 lines: signature + 1 call in constructor) = 3 matches total
# (1 `function realpathSafe` def, 1 `return realpathSync` inside it is NOT realpathSafe-named,
# 1 `this.cwd = realpathSafe(cwd)` in the ctor) → grep realpathSafe = 2 matches (def + ctor call).
grep -n "refused: \[this.cwd\]" src/snapshot/cas.ts
# Expected: 1 match (the guard's return).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Adversarial: prove ZERO mutation by running the predicate + restore directly against a real home,
# using the REAL node:fs (no fake) — confirms realpathSafe(homedir()) succeeds + the guard fires.
# (The unit test already pins this via the recording fake; this is a redundant runtime confirmation.)
node --input-type=module -e "
  const { CasBackend } = await import('./src/snapshot/cas.js');
  const { homedir } = await import('node:os');
  // a recording fs fake (real node:fs would have nothing to read — but the guard fires before any read)
  const calls = { r:0, w:0, u:0 };
  const fakeFs = {
    readFile: async () => { calls.r++; return Buffer.from(''); },
    writeFile: async () => { calls.w++; },
    unlink: async () => { calls.u++; },
    mkdir: async () => {},
    access: async () => {},
    stat: async () => ({ size: 0, mtimeMs: 0 }),
    readdir: async () => [],
  };
  const cfg = { enabled:true, allowDeleteCreatedFiles:true, nonGitMode:'cas', storageDir:'/tmp/x',
    maxFileBytes:1, maxTotalBytes:1, maxSnapshotsPerTurn:1, excludeGlobs:['.git','node_modules'] };
  const gb = new CasBackend(homedir(), cfg, null, { fs: fakeFs });
  const res = await gb.restore('ANYREF', { revertFileChanges: true, deleteCreatedFiles: true });
  console.log('refused :', JSON.stringify(res.refused), '(expect [\"' + homedir() + '\"])');
  console.log('others  :', [res.reverted.length, res.deleted.length, res.failed.length, res.skipped.length], '(expect [0,0,0,0])');
  console.log('fsCalls :', calls, '(expect {r:0,w:0,u:0} — ZERO mutation)');
"
# Expected: refused = ["<homedir>"], others all 0, fsCalls {r:0,w:0,u:0}.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (realpathSync + isForbiddenRoot + homedir resolve; RestoreResult shape valid).
- [ ] `npx vitest run test/cas.test.ts -t "forbidden-root entry guard"` — 3 cases green.
- [ ] `npx vitest run test/cas.test.ts` (full file) green — incl. existing restore tests (Task 7 cwd audit done).
- [ ] `npm test` green (full suite).
- [ ] `grep -n "isForbiddenRoot" src/snapshot/cas.ts` → exactly 2 matches (import + guard).
- [ ] `grep -n "realpathSafe" src/snapshot/cas.ts` → exactly 2 matches (def + constructor call).
- [ ] `grep -n "refused: \[this.cwd\]" src/snapshot/cas.ts` → exactly 1 match.

### Feature Validation

- [ ] Constructor canonicalizes `this.cwd = realpathSafe(cwd)` (realpath, resolve() fallback).
- [ ] `restore()` with `cwd=homedir()` returns `{ refused:[homedir()], reverted:[], deleted:[], failed:[], skipped:[] }`.
- [ ] `restore()` with `cwd="/"` returns `{ refused:["/"], ...empty }`.
- [ ] The recording `CasFs` fake is NEVER invoked (readFile/writeFile/unlink all empty) for a forbidden root.
- [ ] `restore()` with a depth-≥-2 non-forbidden cwd (e.g. `/ws/proj`, `/fake/cwd`) is UNCHANGED:
      `refused:[]`, recipe runs.
- [ ] The guard fires BEFORE the manifest `readFile` (no manifest stub needed for the home/'/' tests).
- [ ] The guard releases the mutex before returning (no deadlock on a subsequent op).

### Code Quality Validation

- [ ] `realpathSync` imported from `node:fs` as a NEW line (cas.ts previously imported only node:fs/promises).
- [ ] `realpathSafe` is MODULE-PRIVATE (not a class method), placed after the type exports / before realFs.
- [ ] `isForbiddenRoot` added to the EXISTING `from "./paths.js"` destructure (no second import line).
- [ ] The guard is the FIRST statement after `mutex.acquire()` (before `const result`, before `try`).
- [ ] The guard returns an inline `RestoreResult` literal with all 5 buckets (not a partial object).
- [ ] `release()` is called in the guard branch (the try/finally is not yet entered).
- [ ] The `restore()` JSDoc cites `@spec/14 §2` (SAFETY INVARIANT) + describes "last line of defense independent of detection".
- [ ] The recipe (manifest read → manifest loop readBlob/writeFile/unlink → cas-mode walkTree), `realpathSafe`,
      and every other method are byte-identical except the constructor's this.cwd assignment.
- [ ] The test uses the DYNAMIC `homedir()` (not a hardcoded path); the negative control uses a
      depth-≥-2 non-forbidden cwd (NOT "/ws").
- [ ] Existing cas.test.ts restore tests use a non-forbidden cwd (Task 7 audit — "/ws/proj" not "/ws").

### Documentation & Deployment

- [ ] JSDoc on `restore()` cites `@spec/14 §2` (SAFETY INVARIANT) + §6 (restore semantics) — Mode A.
- [ ] No README change in this subtask (P1.M2.T2.S1 owns the changeset-level safety paragraph — Mode B).
- [ ] No new env vars / config knobs / migrations / API surface change.

---

## Anti-Patterns to Avoid

- ❌ Don't add the guard WITHOUT the constructor realpathSafe change — isForbiddenRoot's depth/home
  tests are meaningless against an un-resolved/symlinked cwd. The two changes are a PAIR (git.ts did
  them across T3.S1+T3.S2; cas.ts does BOTH in this one task). (GOTCHA #7.)
- ❌ Don't import `realpathSync` from `node:fs/promises` — it is NOT there. It is a SYNCHRONOUS fn in
  the `node:fs` module. Add a separate `import { realpathSync } from "node:fs";` line. (GOTCHA #8.)
- ❌ Don't forget `release()` in the guard branch — the `try/finally` below isn't entered yet; a leaked
  mutex deadlocks the next op on this backend (GOTCHA #1).
- ❌ Don't `throw` on a forbidden root — restore() is best-effort (E27, never rejects); return the
  refused `RestoreResult` so the rewind tool surfaces it in the success text, not as an error (GOTCHA #6).
- ❌ Don't add the guard to `capture()`/`appendExplicitPath()`/`dirtyCheck()`/`has()`/etc. — only
  `restore()` writes the user's worktree (revert/delete). Keep it surgical (GOTCHA #9).
- ❌ Don't reuse `makeBackend()` / `makeStateBackend(cwd="/ws")` for the forbidden-root cases —
  makeBackend hardcodes `/fake/cwd` (NOT forbidden, wrong for a forbidden test); "/ws" IS forbidden
  (dirname==="/") so it would trip the guard unexpectedly. Construct CasBackend directly with
  `cwd=homedir()` / `"/"` for the forbidden cases; use a depth-≥-2 cwd (`/ws/proj`) for the negative
  control (GOTCHA #4, #3, #3b).
- ❌ Don't hardcode a home path in the test — use the dynamic `homedir()` (varies per machine/CI, GOTCHA #5).
- ❌ Don't assume the existing cas.test.ts restore tests stay green untouched — "/ws" is forbidden
  (GOTCHA #3b). Audit + fix their cwd (Task 7) or they'll go RED on refused:["/ws"].
- ❌ Don't invent a new bucket, boolean flag, or error type — reuse the existing `RestoreResult.refused`
  bucket (E30 uses it for "the whole op was refused"; same semantics here).
- ❌ Don't touch `git.ts` (T3.S2 owns its restore guard), `store.ts` (T2.S1), `paths.ts` (T1 done),
  README (M2.T2), or integration tests (M2.T1).

---

## Confidence Score: 9/10

**Why 9**: This is a ~12-line source change (1 node:fs import + ~5-line realpathSafe helper copied
verbatim from git.ts + 1 constructor line + 1 paths.js import name + 4-statement guard + 1 JSDoc
sentence) plus a focused 3-case test block, against a contract that specifies the exact insertion
points (verified against current source: constructor at line 263, restore() at 1004, acquire at 1005,
const-result at 1006, imports at 11/13/23), the exact guard code (verbatim from the work item, mirrored
from git.ts T3.S2), the exact realpathSafe helper (copied from git.ts), the exact RestoreResult shape
(store.ts 194–200 — all 5 buckets), and the spec citations (§2 + §6). The predicate (`isForbiddenRoot`)
is COMPLETE and verified in source. The test idiom (direct construction + recording CasFs fake) is
taken from the existing dirtyCheck throwingFs test + the storeBlob makeRecordingFs helper.

**The one residual risk (the reason it's 9 not 10): GOTCHA #3b.** The existing `cas.test.ts` restore
tests (and the makeTreeBackend/makeStateFs defaults) use `cwd="/ws"`, which is a **depth-1 path**
(`dirname("/ws")==="/"`) → `isForbiddenRoot("/ws")` returns **TRUE**. Once the guard lands, those
existing restore tests would receive `refused:["/ws"]` + zero mutation and FAIL their `reverted`/
`deleted` assertions. This is NOT a defect of this task's guard — it's a latent fixture bug (the tests
accidentally used a forbidden cwd because no guard existed to catch it). The PRP makes this an
EXPLICIT Task 7 (audit + fix the cwd to a depth-2 path like `/ws/proj`) so the implementer does not
get blindsided. The fix is mechanical (change `"/ws"` → `"/ws/proj"` in the defaults / affected calls;
capture tests assert REL workspace-rel keys so they stay green). Behavioral correctness of the guard
itself is fully pinned by the 3 new test cases (refused shape + empty fs call log + negative control);
the non-breaking guarantee is pinned by the negative-control case + the Task 7 audit.

**Residual risk after Task 7**: nil for T4.S1 in isolation. The change is additive to restore()
semantics (a new early-exit for a previously-unreachable-in-tests condition) and canonicalizing to the
constructor (realpath of a real path is the same string; realpath of a non-existent test path falls
back to resolve() — identical to the prior behavior for `/fake/cwd`).