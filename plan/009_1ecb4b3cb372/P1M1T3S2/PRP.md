---
name: "P1.M1.T3.S2 — Add restore() forbidden-root entry guard in git.ts + test"
description: >
  Add the "last line of defense independent of detection" to `GitBackend.restore()` in
  `src/snapshot/git.ts`: immediately after acquiring the mutex and BEFORE `ensureInit()` / any
  filesystem or git mutation, re-check `isForbiddenRoot(this.cwd)` and, if true, release the mutex
  and return `{ reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] }` with
  ZERO filesystem mutation. This is the spec/14 §2 SAFETY INVARIANT's restore-side half
  ("restore() MUST additionally re-check this invariant at its entry and refuse ... if the resolved
  root is forbidden"), consuming `isForbiddenRoot` from `./paths.js` (P1.M1.T1.S1, COMPLETE) on the
  `this.cwd` value canonicalized by `realpathSafe` (P1.M1.T3.S1, landed in source). Add a JSDoc to
  `restore()` citing `@spec/14 §2` + `§6`, and a focused test block in `test/git.test.ts` that
  constructs `GitBackend` directly with `cwd = os.homedir()` (the historical regression vector) and
  `cwd = "/"`, asserting the refused result + an EMPTY exec call log (zero mutation). Out of scope:
  cas.ts (T4 owns its restore guard), store.ts detectAndCreate (T2.S1), README (M2.T2), integration
  tests (M2.T1), and the rest of restore()'s body (UNCHANGED).
---

## Goal

**Feature Goal**: `GitBackend.restore()` refuses to operate when its resolved workspace root
(`this.cwd`, already `realpathSafe`-canonicalized by T3.S1) is a forbidden root — the user's home,
`/`, any depth-1 system dir, or a degenerate value. The refusal happens at the very top of the
method (right after the mutex is acquired, before `ensureInit()` and before any `this.exec` /
`unlink` call), so a forbidden-root restore performs **ZERO filesystem mutation** and returns a
`RestoreResult` whose `refused` bucket names the offending root and whose other four buckets are
empty. This is the restore-side half of the spec/14 §2 SAFETY INVARIANT — a backstop independent of
detection (`detectAndCreate` already refuses such roots → `NoOp`; this re-checks at restore() entry
so a hand-constructed backend, a future caller, or a detection regression cannot bypass it).

**Deliverable** (exactly two file edits, both in scope of THIS subtask only):
1. `src/snapshot/git.ts`:
   - **Import**: extend the existing `from "./paths.js"` destructure (lines 21–24) to add
     `isForbiddenRoot` (the 5th name from that module — T1.S1 export).
   - **Guard**: insert, between `const release = await this.mutex.acquire();` (line 754) and
     `const result: RestoreResult = {` (line 755), a 4-statement guard:
     `if (isForbiddenRoot(this.cwd)) { release(); return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] }; }`
     preceded by a comment citing spec/14 §2 + §6.
   - **JSDoc**: extend the `restore()` JSDoc (lines 722–724) to cite `@spec/14 §2 SAFETY INVARIANT`
     + describe the entry guard ("last line of defense independent of detection; fires before
     ensureInit() and before any fs/git mutation → zero mutation on refuse").
2. `test/git.test.ts`:
   - **Import**: add `import { homedir } from "node:os";` near the top imports (the file does not
     import node:os today).
   - **Test block**: append a new
     `describe("GitBackend.restore — forbidden-root entry guard (spec/14 §2 SAFETY INVARIANT)", ...)`
     with 3 `it` cases: (a) `cwd = homedir()` → `refused:[home]`, all other buckets `[]`, EMPTY exec
     call log; (b) `cwd = "/"` → `refused:["/"]`, EMPTY call log; (c) negative control — the default
     `makeBackend` (`cwd="/fake/cwd"`, depth-2, NOT forbidden) → guard does NOT fire, restore
     proceeds, `refused:[]` and `read-tree` recorded.

**Success Definition**:
- `isForbiddenRoot(homedir())` ⟹ `restore()` returns `{ reverted:[], deleted:[], failed:[], skipped:[], refused:[homedir()] }`
  and the recording exec fake was **never invoked** (`calls.length === 0`) — proving zero fs/git mutation.
- The guard fires BEFORE `ensureInit()` (so the home/`/` tests need NO rev-parse stubs at all).
- For every existing restore test (all use `makeBackend` → `cwd="/fake/cwd"`, which `isForbiddenRoot`
  returns `false` for — depth-2, not home), the guard is a transparent no-op: behavior + assertions
  are byte-identical. `refused` stays `[]` for all non-forbidden restores.
- `npm run typecheck` green; `npx vitest run test/git.test.ts -t "forbidden-root entry guard"` green;
  `npm test` green once T3.S1's test rework has also landed (see GOTCHA — transitional test state).

## User Persona (if applicable)

N/A — internal safety hardening of a snapshot backend. No end-user surface; no config knob.

## Why

- **It closes the highest-severity regression vector at the LAST gate.** spec/14 §2 SAFETY INVARIANT:
  the historical bug was upward repo discovery (`rev-parse --show-toplevel`) resolving the workspace
  to `$HOME`, after which `restore()` reverted/deleted the **entire home tree**. T3.S1 removed the
  upward discovery (root is now `realpath(cwd)`); T2.S1 makes `detectAndCreate` refuse forbidden roots
  → `NoOp`. But defense-in-depth demands restore() ALSO re-check, because (a) a future caller could
  construct `GitBackend` directly bypassing `detectAndCreate`, (b) detection could regress, and
  (c) the invariant is labeled "non-negotiable". This guard is that independent backstop.
- **It is "the last line of defense" verbatim.** spec/14 §2: "restore() MUST additionally re-check
  this invariant at its entry and refuse (returning `{refused:true}` with zero filesystem mutation)
  if the resolved root is forbidden — a last line of defense independent of detection."
- **It consumes the stable T1.S1 contract.** `isForbiddenRoot(root): boolean` is COMPLETE, exported
  from `./paths.js`, and unit-tested. restore() just imports + calls it on its already-canonical
  `this.cwd`. No new logic to design — only wiring + a test.
- **It is the git.ts half of a pair; cas.ts gets the same guard in T4.S1.** Both backends must refuse
  independently (spec/14 §10 testing clause: "restore() against a forbidden root returns refused with
  zero filesystem mutation" — asserted per backend).

## What

A surgical 3-line guard + 1 import + 1 JSDoc sentence + 1 test block. The guard, in context (the
current restore() opening — lines 753–763):

```ts
async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
  const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
  // ── SAFETY INVARIANT entry guard (spec/14 §2) — LAST LINE OF DEFENSE, independent of detection ──
  // detectAndCreate (store.ts) already refuses forbidden roots → NoOp; this re-checks at restore()
  // entry so a hand-constructed backend or a detection regression cannot bypass it. Fires BEFORE
  // ensureInit() and BEFORE any fs/git mutation → ZERO filesystem mutation on refuse. @spec/14 §2/§6.
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
    await this.ensureInit();
    // ... recipe unchanged: read-tree → notes → diff/checkout → ls-files/unlink ...
```

**Placement rationale (verified against the contract):** the work item says "immediately AFTER
`const release = await this.mutex.acquire()` and BEFORE `this.ensureInit()` / any fs/git mutation".
Inserting the guard between the mutex-acquire line and the `const result` line is the most literal
reading AND the most defensive position (the guard is the absolute first statement after the mutex is
held). The guard returns an **inline object literal** (not the `result` variable) and calls
`release()` explicitly — because the `try { ... } finally { release(); }` block is NOT yet entered at
this point, the `finally` would not release the mutex. (Alternative: push `result.refused` + `return
result` inside the `try` so the centralized `finally` releases — acceptable but deviates from the
contract's literal code; use the inline form above to match the contract exactly.)

### Success Criteria

- [ ] `src/snapshot/git.ts` imports `isForbiddenRoot` from `./paths.js` (extends the existing
      destructure; no second `from "./paths.js"` line).
- [ ] `restore()` checks `isForbiddenRoot(this.cwd)` as its first act after `mutex.acquire()`,
      before `const result` and before `ensureInit()`.
- [ ] On a forbidden root: `release()` is called (mutex freed), the method returns
      `{ reverted:[], deleted:[], failed:[], skipped:[], refused:[this.cwd] }`, and `this.exec` /
      `unlink` are NEVER called (zero mutation).
- [ ] The `restore()` JSDoc cites `@spec/14 §2` (SAFETY INVARIANT) in addition to its existing
      §3/§6/§4.3 citations, and describes the guard as "last line of defense independent of detection".
- [ ] `test/git.test.ts` imports `homedir` from `node:os` and has a new describe block whose 3 cases
      pass: home→refused+empty-calls, `/`→refused+empty-calls, `/fake/cwd`→guard-skipped+restore-runs.
- [ ] Every existing restore test (cwd=`/fake/cwd`) is unchanged in behavior (guard is a no-op there).
- [ ] `npm run typecheck` clean; `npx vitest run test/git.test.ts -t "forbidden-root entry guard"` green.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
target lines (verified against current source), the exact import line to extend, the exact guard code
(verbatim), the exact JSDoc sentence to add, the exact test block (3 cases with full assertion
bodies), the spec citations, the contract from T1.S1 (isForbiddenRoot) + T3.S1 (realpathSafe), and
the transitional test-state gotcha are all below.

### Documentation & References

```yaml
# MUST READ — the spec authority for this guard
- file: spec/14-working-tree-revert.md
  why: "§2 SAFETY INVARIANT is THE rule: 'restore() MUST additionally re-check this invariant at its
        entry and refuse (returning {refused:true} with zero filesystem mutation) if the resolved root
        is forbidden — a last line of defense independent of detection.' §6 is the restore-semantics
        section the JSDoc also cites. §10 is the testing safety clause: 'restore() against a forbidden
        root returns refused with zero filesystem mutation' — exactly what the new test asserts."
  section: "§2 (the 'SAFETY INVARIANT — non-negotiable' final sentence + the Detection paragraph),
            §6 (Restore semantics — refuse-on-dirty, then restore), §10 (the 'Safety (non-negotiable)'
            bullet asserting restore() against a forbidden root returns refused with zero mutation)"
  critical: "§2 frames this as INDEPENDENT of detection — the guard must fire even if detectAndCreate
             is bypassed (e.g. a hand-constructed GitBackend in a test, or a future direct caller).
             The phrase 'zero filesystem mutation' is the testable contract: the exec fake's call log
             must be EMPTY (not just free of write commands — empty entirely, because the guard fires
             before ensureInit() which is where the first exec call would happen)."

# MUST READ — THE source file being modified (read it FULLY first)
- file: src/snapshot/git.ts
  why: "THE file modified. paths.js import destructure at lines 21–24 (ADD isForbiddenRoot). restore()
        JSDoc at 720–751 (ADD the §2 sentence near 722–724). restore() method at 753: mutex acquire at
        754, const result at 755–761, try at 762, ensureInit at 763 — the guard inserts between 754 and
        755. The recipe (read-tree/notes/diff/checkout/ls-files/unlink) at 763–865 is UNCHANGED.
        realpathSafe helper at 157; constructor this.cwd=realpathSafe(cwd) at 256 — these are T3.S1's
        output (ALREADY in source) that make this.cwd canonical, so isForbiddenRoot(this.cwd) is sound."
  pattern: "The other mutex-acquiring methods (capture/dirtyCheck/changedPaths/has/retire/gc/destroy
            at lines 330/464/528/567/597/644/682) each do `const release = await this.mutex.acquire();`
            then `try { await this.ensureInit(); ... } finally { release(); }`. restore() is the ONLY
            one that needs the forbidden-root gate because it is the only one that WRITES the user's
            worktree (revert/delete). The guard's shape — acquire → gate(release+return) → try/finally
            — is the established pattern extended with one early-exit branch."
  gotcha: "this.cwd is set ONCE in the constructor (realpathSafe(cwd)) and is `readonly` (private
           readonly cwd). It does NOT change between construction and restore(). So isForbiddenRoot
           re-checking this.cwd is checking the SAME canonical root detection would have refused. Do
           NOT re-realpath or re-normalize inside the guard — this.cwd is already canonical."

# MUST READ — THE test file being modified (append a block; add one import)
- file: test/git.test.ts
  why: "THE test file modified. Imports at lines 1–3 (ADD `import { homedir } from \"node:os\";`).
        The stable helpers this test reuses: `type Call` (39–42), `makeExec` (65 — recording fake),
        `emptyScan` (83), `makeBackend` (89 — HARDCODES cwd='/fake/cwd', used for the negative
        control), `findCmd` (115). The existing restore describe block starts at line 621 — append
        the new block AFTER the last restore `it` (line ~762) and BEFORE the `describe(\"GitBackend.describe()\")`
        at 763, OR at the very end of the file (either is fine; co-locating with restore is cleaner)."
  pattern: "House idiom: each `it` declares `const calls: Call[] = []`, constructs a backend wired to
            `makeExec(calls)`, calls the method, asserts on `res` (the RestoreResult) AND on `calls`
            (the recorded exec log). Canned stdout via `{ stdoutByCmd: { diff: \"a.ts\\n\" } }`. The
            `describe()` test at line 764 shows the DIRECT-construction idiom:
            `new GitBackend(\"/fake/cwd\", BASE_CFG, null, { exec: makeExec([]), scan: emptyScan })` —
            forbidden-root tests use this form with cwd=homedir()/\"/\" instead of \"/fake/cwd\"."
  gotcha: "makeBackend hardcodes cwd='/fake/cwd'. You CANNOT reuse it for the forbidden-root cases
           (they need a forbidden cwd). Construct GitBackend directly (like the describe() test does).
           For the negative control, DO reuse makeBackend (its /fake/cwd is intentionally non-forbidden)."

# CONTRACT — isForbiddenRoot (the symbol this task consumes; COMPLETE — T1.S1 done)
- file: src/snapshot/paths.ts
  why: "Exports `isForbiddenRoot(root: string): boolean` — true iff root is home / `/` / depth-1
        (dirname==='/') / empty / dot. This is the predicate the guard calls. PURE (no fs; homedir()
        reads an env var). Already complete + unit-tested (P1.M1.T1.S1). Just import it."
  pattern: "Import via the EXISTING `from \"./paths.js\"` destructure in git.ts (lines 21–24). Add
            isForbiddenRoot as the 5th name. Do NOT add a second `from \"./paths.js\"` line."
  critical: "The predicate assumes its arg is ALREADY CANONICALIZED (realpath). this.cwd IS — it was
             set by realpathSafe(cwd) in the constructor. So isForbiddenRoot(this.cwd) is correct.
             Do NOT pass raw opts/beforeRef or anything else — pass this.cwd, the workspace root."

# CONTRACT — T3.S1 (realpathSafe + repoRoot=this.cwd; ALREADY landed in source — verified)
- file: plan/009_1ecb4b3cb372/P1M1T3S1/PRP.md
  why: "Defines the constructor canonicalization (this.cwd=realpathSafe(cwd)) and ensureInit
        (repoRoot=this.cwd, no rev-parse) that THIS task builds on. Verified ALREADY in source:
        realpathSafe at line 157, this.cwd at 256, ensureInit repoRoot at 305, NO sourceGitDir.
        T3.S1's GOTCHA #1 explicitly deferred importing isForbiddenRoot to T3.S2 (this task)."
  section: "GOTCHA #1 (do NOT import isForbiddenRoot in T3.S1 — T3.S2 owns it) + the realpathSafe
            definition + the ensureInit rewrite"
  critical: "T3.S1's TEST rework (makeExec stub deletion, expectedShadow /fake/repo→/fake/cwd,
             GIT_WORK_TREE flip) may NOT have landed in test/git.test.ts yet at the time you run.
             See the transitional-state GOTCHA below — your new test block is independent of that flip."

# READ — the canonical change inventory (authoritative for the overall plan)
- file: plan/009_1ecb4b3cb372/architecture/test_strategy.md
  why: "Scopes git.ts restore() guard to T3.S2 ('Add restore() forbidden-root entry guard') and cas.ts
        to T4. Confirms the per-subtask boundary so you do NOT over-reach into cas.ts/store.ts."
  section: "the src/snapshot/git.ts S2 row + the test/git.test.ts forbidden-root row"
  critical: "Do NOT touch cas.ts (T4 owns its restore guard), store.ts (T2), paths.ts (T1 done),
             README (M2.T2), or integration tests (M2.T1)."

# READ — RestoreResult (the return type; store.ts is PURE TS — read to confirm the refused bucket)
- file: src/snapshot/store.ts
  why: "RestoreResult interface (lines 194–200): { reverted, deleted, failed, skipped, refused } all
        string[]. The guard's inline return matches this shape exactly. `refused` is the semantically
        correct bucket (E30 'the WHOLE file-revert refused' — here the whole op is refused because
        the root is forbidden; same 'refuse the whole thing' semantics)."
  section: "RestoreResult interface (194–200) + its doc (181–193, esp. the refused: E30 line)"
  critical: "Do NOT invent a new bucket or a boolean flag. Reuse refused[] (it is already plumumbed
             into the rewind success text + marker by P4). The offending root goes in refused[0]."
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
├── git.ts     # ← THE source file modified: +isForbiddenRoot import; +restore() guard (4 lines); +restore() JSDoc §2 sentence
├── paths.ts   # ← UNCHANGED (T1.S1 COMPLETE — exports isForbiddenRoot; consumed here)
├── store.ts   # ← UNCHANGED (RestoreResult interface is read-only reference here)
└── cas.ts     # ← UNCHANGED (T4.S1 owns its OWN restore guard — do NOT touch)
test/
└── git.test.ts # ← MODIFIED: +import { homedir } from "node:os"; +new describe block (3 it cases)
```

### Desired Codebase tree

```bash
src/snapshot/
└── git.ts      # MODIFIED (+1 import name; +4-line guard; +1 JSDoc sentence — that is the ENTIRE src diff)
test/
└── git.test.ts # MODIFIED (+1 import line; +1 describe block with 3 it cases)
```
No new files. paths.ts / store.ts / cas.ts / README / integration tests are NOT touched.

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — the guard MUST release() the mutex before returning.
// restore() is `const release = await this.mutex.acquire(); ... try { ... } finally { release(); }`.
// The guard runs BEFORE the `try` block, so the `finally { release() }` does NOT cover it. If you
// forget `release()`, the mutex leaks → the NEXT op on this backend deadlocks. The contract's literal
// code calls `release()` then `return { ... }`. (Acceptable alt: move the guard INSIDE try and do
// `result.refused.push(this.cwd); return result;` so the centralized finally releases — but the
// inline form matches the contract verbatim and keeps the guard the absolute first statement.)

// GOTCHA #2 — the guard fires BEFORE ensureInit(). This is LOAD-BEARING for the test.
// The contract: "The restore() guard is tested INDEPENDENTLY of ensureInit (the guard fires before
// ensureInit runs, so no rev-parse stubs are needed for this test)." Because ensureInit never runs
// for a forbidden root, the recording exec fake is NEVER invoked → calls.length === 0. That empty
// call log is the proof of ZERO mutation. Do NOT stub anything for the home/'/' tests.

// GOTCHA #3 — "/fake/cwd" (the makeBackend default) is NOT forbidden.
// isForbiddenRoot("/fake/cwd"): depth-2, not home, not "/", dirname="/fake"≠"/" → FALSE. So the guard
// is a transparent no-op for EVERY existing restore test (they all use makeBackend → /fake/cwd). Only
// the NEW tests (cwd=homedir(), cwd="/") trip it. This is why the change is non-breaking: existing
// assertions (refused:[]) still hold, and no existing it gains a refused entry.

// GOTCHA #4 — transitional test-file state (T3.S1 source landed; T3.S1 test rework may NOT have).
// At impl time, git.ts is POST-T3.S1 (realpathSafe, repoRoot=this.cwd, no sourceGitDir) — VERIFIED.
// But test/git.test.ts may STILL be PRE-T3.S1-rework (makeExec has rev-parse stubs at 76–77;
// expectedShadow default is still "/fake/repo"; GIT_WORK_TREE assertions still "/fake/repo"). That
// makes the EXISTING restore tests RED until T3.S1's rework lands. YOUR new block is INDEPENDENT of
// that flip — it never asserts GIT_DIR/GIT_WORK_TREE/expectedShadow, only the refused result + the
// empty calls log. So isolate your validation:
//   npx vitest run test/git.test.ts -t "forbidden-root entry guard"
// Do NOT assume `npx vitest run test/git.test.ts` (full file) is green until T3.S1's rework also lands.

// GOTCHA #5 — construct GitBackend DIRECTLY for forbidden cwd (makeBackend hardcodes /fake/cwd).
// The forbidden-root tests need cwd=homedir() or "/". makeBackend()/makeBackendWithUnlink() bake in
// "/fake/cwd". So use the DIRECT idiom (mirroring the describe() test at line 764):
//   const gb = new GitBackend(homedir(), BASE_CFG, null, { exec: makeExec(calls), scan: emptyScan });
// For the NEGATIVE control, DO reuse makeBackend (its /fake/cwd is the point — a non-forbidden root
// where the guard must NOT fire).

// GOTCHA #6 — homedir() is DYNAMIC (varies per machine/CI). Never hardcode "/home/dustin".
// realpathSafe(homedir()) → realpathSync(homedir()) succeeds (home exists) → homedir(). So this.cwd
// === homedir() exactly. Compute `const home = homedir();` ONCE per test, use it for BOTH the ctor
// arg AND the refused assertion (`expect(res.refused).toEqual([home])`). Import homedir from node:os.

// GOTCHA #7 — restore() is BEST-EFFORT (never rejects). The forbidden-root guard must also never reject.
// The contract returns a value (not a throw). Do NOT `throw` on a forbidden root — return the refused
// RestoreResult. This matches restore()'s E27 contract and the rewind tool's "revert degradation never
// blocks the context rewind" rule (the refused bucket surfaces in the rewind success text, not as an error).

// GOTCHA #8 — the guard checks this.cwd, NOT this.repoRoot.
// this.repoRoot is resolved LAZILY by ensureInit() — which the guard runs BEFORE. So this.repoRoot is
// still undefined at guard time. this.cwd is set in the CONSTRUCTOR (realpathSafe) and is always
// populated. Check isForbiddenRoot(this.cwd). (After T3.S1, ensureInit just copies cwd→repoRoot, so
// they're equal anyway — but cwd is the one guaranteed populated pre-ensureInit.)

// GOTCHA #9 — POSIX orientation is inherited (not introduced here).
// isForbiddenRoot uses `dirname(root) === "/"` (POSIX). On Windows, drive-roots (C:\) aren't caught by
// the depth check, but the home IS caught (os.homedir() → C:\Users\<user>). This is a documented
// limitation of the predicate (T1.S1), not a defect of this guard. Do NOT add Windows handling here.

// GOTCHA #10 — do NOT widen the guard to other methods.
// Only restore() gets this gate (it is the only method that WRITES the user's worktree — revert/delete).
// capture() writes to the SHADOW repo only (not the worktree); dirtyCheck/changedPaths/has are read-
// only; retire/gc/destroy target the shadow repo. restore() is the one with catastrophic blast radius.
// Adding the guard elsewhere would be dead code (detection already refused → those methods never run
// on a forbidden-root backend in production). Keep the change surgical: restore() only.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `RestoreResult` (store.ts 194–200) already has the `refused: string[]` bucket
the guard populates. `RestoreOpts`, `SnapshotStore`, `AsyncMutex`, `GitBackend` fields, `realpathSafe`,
`shadowKey`, `shadowEnv` are all UNCHANGED. The guard adds zero types — it is 4 statements + 1 import
name + 1 JSDoc sentence.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts — import isForbiddenRoot
  - LOCATE lines 21–24 (the existing destructure from "./paths.js"):
        import {
          normalizeRelPath,
          isDangerousWorkspaceRel,
          resolveSafeWorkspacePath,
          DANGEROUS_DIRS,
        } from "./paths.js";
  - ADD `isForbiddenRoot,` to the destructure (place it right after isDangerousWorkspaceRel — groups
    the two `is*` predicates):
        import {
          normalizeRelPath,
          isDangerousWorkspaceRel,
          isForbiddenRoot,
          resolveSafeWorkspacePath,
          DANGEROUS_DIRS,
        } from "./paths.js";
  - DO NOT add a second `from "./paths.js"` line. DO NOT touch any other import.
  - DEPENDENCIES: none (isForbiddenRoot is exported by T1.S1 — COMPLETE).

Task 2: MODIFY src/snapshot/git.ts — add the restore() entry guard
  - LOCATE restore() (line 753). Current opening:
        async restore(beforeRef: string, opts: RestoreOpts): Promise<RestoreResult> {
          const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
          const result: RestoreResult = {
            ...
  - INSERT between the mutex-acquire line and the `const result` line (verbatim):
        // SAFETY INVARIANT entry guard (spec/14 §2) — the LAST LINE OF DEFENSE, independent of
        // detection (detectAndCreate already refuses forbidden roots → NoOp; this re-checks at
        // restore() entry so a hand-constructed backend or a detection regression cannot bypass it).
        // Fires BEFORE ensureInit() and BEFORE any fs/git mutation → ZERO filesystem mutation on
        // refuse. @spec/14 §2 (SAFETY INVARIANT) + §6 (restore semantics).
        if (isForbiddenRoot(this.cwd)) {
          release();
          return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] };
        }
  - WHY: spec/14 §2 mandates restore() re-check the forbidden-root invariant at entry and refuse with
    zero mutation. release() frees the mutex (the try/finally below isn't entered yet). The inline
    return matches the RestoreResult shape exactly (all 5 buckets; refused names the offending root).
  - GOTCHA #1 (release before return), #2 (fires pre-ensureInit), #7 (return not throw), #8 (this.cwd
    not this.repoRoot).
  - DEPENDENCIES: Task 1 (isForbiddenRoot in scope).

Task 3: MODIFY src/snapshot/git.ts — extend the restore() JSDoc with §2
  - LOCATE the restore() JSDoc opening (lines 722–724):
        * Write working-tree files FROM the `beforeRef` snapshot (restore the pre-span file state).
        * spec/14 §3 (the FIVE git-safety guarantees), §6 (restore semantics). Serialized by the mutex
        * (spec §4.3). CONSUMED BY: rewindExecute step 6b (P4.M2.T1.S2) after the dirty guard passes.
  - REPLACE the §3/§6 sentence (line 723) to ALSO cite §2 + describe the guard. New text:
        * spec/14 §2 (SAFETY INVARIANT — the forbidden-root entry guard: restore() re-checks
        * isForbiddenRoot(this.cwd) as its FIRST act and refuses with ZERO filesystem mutation if the
        * resolved root is forbidden; a last line of defense independent of detection), §3 (the FIVE
        * git-safety guarantees), §6 (restore semantics). Serialized by the mutex (spec §4.3).
  - Keep the rest of the JSDoc (RECIPE, BEST-EFFORT, CONSUMED BY) UNCHANGED.
  - WHY: DOCS requirement #5 (Mode A — JSDoc rides WITH the work). The existing JSDoc omits §2; the
    guard is invisible to a reader without it.
  - DEPENDENCIES: Task 2 (the code it documents is already in place).

Task 4: MODIFY test/git.test.ts — import homedir from node:os
  - LOCATE the import block (lines 1–3):
        import { describe, it, expect } from "vitest";
        import { createHash } from "node:crypto";
        import { GitBackend, type GitExec, type CapScan } from "../src/snapshot/git.js";
  - ADD (match the node:* grouping — place after the node:crypto line):
        import { homedir } from "node:os";
  - WHY: the home-refuse test needs the DYNAMIC home (varies per machine/CI — GOTCHA #6).
  - DEPENDENCIES: none (test-side).

Task 5: MODIFY test/git.test.ts — append the forbidden-root describe block
  - PLACEMENT: append AFTER the existing restore describe block (which ends ~line 762, before the
    `describe("GitBackend.describe()")` at 763). A clear `// ─────` separator matches the file's style.
  - HEADER comment: cite spec/14 §2 SAFETY INVARIANT + §10 + task P1.M1.T3.S2.
  - IMPLEMENT (3 cases — full bodies):

      // ─────────────────────────────────────────────────────────────────────────────
      describe("GitBackend.restore — forbidden-root entry guard (spec/14 §2 SAFETY INVARIANT)", () => {
        // spec/14 §2: "restore() MUST additionally re-check this invariant at its entry and refuse
        // (returning {refused} with zero filesystem mutation) if the resolved root is forbidden — a
        // last line of defense independent of detection." The guard fires BEFORE ensureInit() (so no
        // rev-parse stubs are needed) and BEFORE any fs/git mutation (so the exec call log is empty).
        // makeBackend() hardcodes cwd="/fake/cwd" (depth-2, NOT forbidden) so the home/'/' cases
        // construct GitBackend DIRECTLY (mirroring the describe() test's direct-construction idiom).

        it("refuses when cwd is the user's home — refused:[home], other buckets empty, ZERO mutation", async () => {
          const home = homedir();
          const calls: Call[] = [];
          const gb = new GitBackend(home, BASE_CFG, null, { exec: makeExec(calls), scan: emptyScan });
          const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
          expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: [home] });
          // ZERO mutation: the guard fired before ensureInit() and before any this.exec() / unlink().
          expect(calls).toHaveLength(0);
          expect(findCmd(calls, "read-tree")).toBeUndefined();
          expect(findCmd(calls, "checkout")).toBeUndefined();
          expect(findCmd(calls, "ls-files")).toBeUndefined();
        });

        it("refuses when cwd is '/' (filesystem root) — same refused shape, ZERO mutation", async () => {
          const calls: Call[] = [];
          const gb = new GitBackend("/", BASE_CFG, null, { exec: makeExec(calls), scan: emptyScan });
          const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: true });
          expect(res).toEqual({ reverted: [], deleted: [], failed: [], skipped: [], refused: ["/"] });
          expect(calls).toHaveLength(0);
        });

        it("does NOT fire for a normal (non-forbidden) cwd — restore proceeds (negative control)", async () => {
          // makeBackend → cwd="/fake/cwd" (depth-2, not home, not "/") → isForbiddenRoot === false.
          const calls: Call[] = [];
          const gb = makeBackend(calls, BASE_CFG, emptyScan, { stdoutByCmd: { diff: "a.ts\n" } });
          const res = await gb.restore("BEFORE1", { revertFileChanges: true, deleteCreatedFiles: false });
          expect(res.refused).toEqual([]);            // guard did NOT fire
          expect(res.reverted).toEqual(["a.ts"]);      // restore ran the recipe
          expect(findCmd(calls, "read-tree")).toBeDefined();
        });
      });

  - WHY: the 3 cases pin the contract — (a) the historical regression vector ($HOME), (b) the
    depth-0 root, (c) the no-op-on-normal-paths guarantee (so the guard cannot over-fire and break
    legitimate restores). The empty-calls assertion is the "zero filesystem mutation" proof (§10).
  - GOTCHA #2 (no stubs needed), #5 (direct construction), #6 (dynamic home).
  - DEPENDENCIES: Tasks 1–4 (the guard + import must land for cases a/b to pass; case c needs the
    existing makeBackend/Call/findCmd helpers which are unchanged).

Task 6: VALIDATE (no code)
  - RUN: `npm run typecheck` (tsc --noEmit). MUST be clean. Watch for: "Cannot find name
    'isForbiddenRoot'" (Task 1 missed); "Cannot find name 'homedir'" (Task 4 missed).
  - RUN: `npx vitest run test/git.test.ts -t "forbidden-root entry guard"`. The 3 new cases green.
    (Isolate by name — see GOTCHA #4: the full git.test.ts may be RED until T3.S1's rework lands.)
  - RUN: `npm test` (full suite). Expected green once T3.S1's rework is also in; if git.test.ts is
    RED only on PRE-EXISTING restore tests (GIT_WORK_TREE /fake/repo assertions), that is T3.S1's
    transitional state, NOT this task's regression — your 3 new cases must still pass in isolation.
```

### Implementation Patterns & Key Details

```typescript
// THE WHOLE SOURCE DIFF in one glance (git.ts). Three hunks, ~6 lines net:
//
//   (1) import destructure (lines 21–24): + isForbiddenRoot,
//   (2) restore() guard (between the mutex-acquire line 754 and const-result line 755):
//         if (isForbiddenRoot(this.cwd)) {
//           release();
//           return { reverted: [], deleted: [], failed: [], skipped: [], refused: [this.cwd] };
//         }
//   (3) restore() JSDoc (line 723): + "spec/14 §2 (SAFETY INVARIANT — ... entry guard ... last line
//       of defense independent of detection)".
//
// WHY this.cwd (not this.repoRoot): repoRoot is resolved LAZILY by ensureInit(), which the guard
// runs BEFORE. this.cwd is set in the CONSTRUCTOR (realpathSafe(cwd)) and is always populated.
// After T3.S1, ensureInit just copies cwd→repoRoot, so they're equal — but cwd is the one guaranteed
// defined pre-ensureInit. (GOTCHA #8.)
//
// WHY release() before return: restore() is `acquire; ... try { ... } finally { release() }`. The
// guard runs BEFORE the try, so the finally doesn't cover it. Forgetting release() leaks the mutex
// → the next op on this backend deadlocks. (GOTCHA #1.)
//
// WHY refused[] (not a new bucket / not a throw): RestoreResult.refused is ALREADY the "the whole
// op was refused" bucket (E30 dirty-guard uses it the same way). The rewind success text + marker
// already plumb refused into the user-visible result. restore() is best-effort (E27 — never rejects),
// so the guard returns a value, never throws. (GOTCHA #7.)
```

### Integration Points

```yaml
CONSUMERS (unchanged — they call restore() and read RestoreResult):
  - rewindExecute (rewind.ts, P4.M2.T1.S2): calls restore(beforeRef, opts); folds the 5 buckets into
    the rewind success text ("...; <W> refused"). A forbidden-root restore now surfaces as refused=[root]
    in that text — which is the correct, honest outcome (the op was refused; context rewind proceeds).
    NO CHANGE to rewindExecute needed: refused is already a recognized bucket.
  - detectAndCreate (store.ts, T2.S1): in PRODUCTION, refuses forbidden roots → NoOp BEFORE any backend
    is constructed, so GitBackend.restore() is never even called on a forbidden root in the normal
    path. This guard is the INDEPENDENT backstop for the case where detectAndCreate is bypassed
    (hand-constructed backend / future direct caller / detection regression). (spec/14 §2.)

NO DATABASE / NO CONFIG / NO ROUTES / NO NEW ENV VARS:
  - This is a 6-line safety gate. No migration, no config knob, no route, no env var.
  - isForbiddenRoot's forbidden set is hardcoded (home / `/` / depth-1 / degenerate) — it does NOT
    read config.revert.* (paths.ts is config-free by design, T1.S1).

SCOPE GUARDRAILS (do NOT touch — separate subtasks):
  - cas.ts restore() guard → P1.M1.T4.S1 (same pattern, CasBackend).
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
#  - "Cannot find name 'isForbiddenRoot'" → Task 1 (import) missed.
#  - "Cannot find name 'homedir'" → Task 4 (test import) missed.
#  - "Property 'refused' ..." or shape mismatch → the inline return object is malformed (it must
#    have all 5 buckets: reverted/deleted/failed/skipped/refused).
```

> NOTE: this is a TypeScript + vitest project. `package.json` scripts are `test`, `typecheck`,
> `smoke`, `prepublishOnly`. There is no ruff/mypy/eslint/biome — do not invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# THE focused validation for this subtask — isolate by name (GOTCHA #4: the full git.test.ts may be
# RED on pre-existing tests until T3.S1's rework lands; your 3 cases must pass independently).
npx vitest run test/git.test.ts -t "forbidden-root entry guard"
# Expected: 3 cases green:
#   ✓ refuses when cwd is the user's home — refused:[home], other buckets empty, ZERO mutation
#   ✓ refuses when cwd is '/' (filesystem root) — same refused shape, ZERO mutation
#   ✓ does NOT fire for a normal (non-forbidden) cwd — restore proceeds (negative control)
# If the home/'/' cases FAIL with a NON-empty calls log → the guard did NOT fire (Task 2 missed, or
# isForbiddenRoot returned false — check the import resolved + this.cwd is the canonical root).
# If the negative control FAILS (refused:[root]) → the guard OVER-fired (isForbiddenRoot("/fake/cwd")
# must be false — verify paths.ts is the T1.S1 version, not a stale one).
```

### Level 3: Integration Testing (System Validation)

```bash
# Full suite — confirms the additive change broke nothing. NOTE: if git.test.ts is RED ONLY on
# pre-existing restore tests (GIT_WORK_TREE /fake/repo vs /fake/cwd), that is T3.S1's transitional
# test state (GOTCHA #4), NOT this task. Once T3.S1's rework lands, the full file is green.
npm test
# Expected (post-T3.S1-rework): ALL green, including:
#   - the new forbidden-root block (3 cases),
#   - the existing restore block (refused:[] for all /fake/cwd cases — guard is a no-op there),
#   - store.test.ts, paths.test.ts, cas tests, integration revert-*.test.ts.

# Spot-check the guard is wired (manual grep — confidence, not a test):
grep -n "isForbiddenRoot" src/snapshot/git.ts
# Expected: the import line + the guard's `if (isForbiddenRoot(this.cwd))` = 2 matches.
grep -n "refused: \[this.cwd\]" src/snapshot/git.ts
# Expected: 1 match (the guard's return).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Adversarial: prove ZERO mutation by running the predicate + restore directly against a real home.
# (The unit test already pins this via the recording fake; this is a redundant runtime confirmation.)
node --input-type=module -e "
  const { GitBackend } = await import('./src/snapshot/git.js');
  const { homedir } = await import('node:os');
  const calls = [];
  const fakeExec = async (f, a) => { calls.push([f, ...a]); return { stdout: '', stderr: '' }; };
  const gb = new GitBackend(homedir(), { enabled:true, allowDeleteCreatedFiles:true, nonGitMode:'cas', storageDir:'/tmp/x', maxFileBytes:1, maxTotalBytes:1, maxSnapshotsPerTurn:1, excludeGlobs:['.git','node_modules'] }, null, { exec: fakeExec, scan: async () => ({ oversizePaths: [], totalBytes: 0 }) });
  const res = await gb.restore('ANYREF', { revertFileChanges: true, deleteCreatedFiles: true });
  console.log('refused :', JSON.stringify(res.refused), '(expect [\"' + homedir() + '\"])');
  console.log('others  :', [res.reverted.length, res.deleted.length, res.failed.length, res.skipped.length], '(expect [0,0,0,0])');
  console.log('execCalls:', calls.length, '(expect 0 — ZERO mutation)');
"
# Expected: refused = [\"<homedir>\"], others all 0, execCalls 0.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (isForbiddenRoot + homedir resolve; RestoreResult shape valid).
- [ ] `npx vitest run test/git.test.ts -t "forbidden-root entry guard"` — 3 cases green.
- [ ] `npm test` green once T3.S1's test rework is also landed (your 3 cases pass in isolation now).
- [ ] `grep -n "isForbiddenRoot" src/snapshot/git.ts` → exactly 2 matches (import + guard).
- [ ] `grep -n "refused: \[this.cwd\]" src/snapshot/git.ts` → exactly 1 match.

### Feature Validation

- [ ] `restore()` with `cwd=homedir()` returns `{ refused:[homedir()], reverted:[], deleted:[], failed:[], skipped:[] }`.
- [ ] `restore()` with `cwd="/"` returns `{ refused:["/"], ...empty }`.
- [ ] The recording exec fake is NEVER invoked for a forbidden root (`calls.length === 0`).
- [ ] `restore()` with `cwd="/fake/cwd"` (non-forbidden) is UNCHANGED: `refused:[]`, recipe runs.
- [ ] The guard fires BEFORE `ensureInit()` (no rev-parse stubs needed for the home/'/' tests).
- [ ] The guard releases the mutex before returning (no deadlock on a subsequent op).

### Code Quality Validation

- [ ] `isForbiddenRoot` added to the EXISTING `from "./paths.js"` destructure (no second import line).
- [ ] The guard is the FIRST statement after `mutex.acquire()` (before `const result`, before `try`).
- [ ] The guard returns an inline `RestoreResult` literal with all 5 buckets (not a partial object).
- [ ] `release()` is called in the guard branch (the try/finally is not yet entered).
- [ ] The `restore()` JSDoc cites `@spec/14 §2` + describes "last line of defense independent of detection".
- [ ] The recipe (read-tree/notes/diff/checkout/ls-files/unlink), the memo, shadowEnv, and every other
      method are byte-identical (only the guard + the import + the JSDoc sentence are added).
- [ ] The test uses the DYNAMIC `homedir()` (not a hardcoded path); reuses `makeBackend`/`Call`/
      `findCmd`/`makeExec`/`emptyScan`/`BASE_CFG` (no new helpers).

### Documentation & Deployment

- [ ] JSDoc on `restore()` cites `@spec/14 §2` (SAFETY INVARIANT) + §6 (restore semantics) — Mode A.
- [ ] No README change in this subtask (P1.M2.T2.S1 owns the changeset-level safety paragraph — Mode B).
- [ ] No new env vars / config knobs / migrations / API surface change.

---

## Anti-Patterns to Avoid

- ❌ Don't forget `release()` in the guard branch — the `try/finally` below isn't entered yet; a leaked
  mutex deadlocks the next op on this backend (GOTCHA #1).
- ❌ Don't check `this.repoRoot` instead of `this.cwd` — repoRoot is resolved lazily by `ensureInit()`,
  which the guard runs BEFORE; repoRoot is still undefined at guard time (GOTCHA #8).
- ❌ Don't `throw` on a forbidden root — restore() is best-effort (E27, never rejects); return the
  refused `RestoreResult` so the rewind tool surfaces it in the success text, not as an error (GOTCHA #7).
- ❌ Don't add the guard to `capture()`/`dirtyCheck()`/`has()`/etc. — only `restore()` writes the user's
  worktree (revert/delete), so only it has catastrophic blast radius. Elsewhere the guard is dead code
  (detection already refused → those methods never run in production). Keep it surgical (GOTCHA #10).
- ❌ Don't reuse `makeBackend()` for the forbidden-root cases — it hardcodes `cwd="/fake/cwd"` (NOT
  forbidden). Construct `GitBackend` directly with `cwd=homedir()` / `"/"` (GOTCHA #5).
- ❌ Don't hardcode a home path in the test — use the dynamic `homedir()` (varies per machine/CI, GOTCHA #6).
- ❌ Don't assume `npx vitest run test/git.test.ts` (full file) is green at impl time — T3.S1's test
  rework may not have landed, leaving PRE-EXISTING restore tests RED on the /fake/repo→/fake/cwd flip.
  Isolate YOUR block by name (`-t "forbidden-root entry guard"`) — it's independent of that flip (GOTCHA #4).
- ❌ Don't invent a new bucket, boolean flag, or error type — reuse the existing `RestoreResult.refused`
  bucket (E30 uses it for "the whole op was refused"; same semantics here).
- ❌ Don't touch `cas.ts` (T4.S1 owns its restore guard), `store.ts` (T2.S1), `paths.ts` (T1 done),
  README (M2.T2), or integration tests (M2.T1).

---

## Confidence Score: 10/10

**Why 10**: This is a ~6-line source change (1 import name + a 4-statement guard + 1 JSDoc sentence)
plus a focused 3-case test block, against a contract that specifies the exact insertion point (verified
against current source: mutex-acquire at line 754, const-result at 755), the exact guard code
(verbatim from the work item), the exact import to extend (lines 21–24, `from "./paths.js"`), the
exact RestoreResult shape (store.ts 194–200 — all 5 buckets), the exact test idiom (direct
construction mirroring the `describe()` test at line 764), and the spec citations (§2 + §6). The
predicate (`isForbiddenRoot`) and the canonicalizer (`realpathSafe`) are both COMPLETE and verified in
source. The only residual risk — the transitional test-file state where T3.S1's rework hasn't landed —
is fully mitigated by isolating validation to the new block by name (`-t "forbidden-root entry guard"`),
since the new tests never assert GIT_DIR/GIT_WORK_TREE/expectedShadow and are independent of the
/fake/repo→/fake/cwd flip.

**Residual risk**: nil for T3.S2 in isolation. The one thing a careless implementer could miss is the
`release()` call in the guard (GOTCHA #1) or asserting on a hardcoded home path (GOTCHA #6) — both
explicitly called out. Behavioral correctness is fully pinned by the 3 test cases (refused shape +
empty call log + negative control); the non-breaking guarantee is pinned by the negative-control case.