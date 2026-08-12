---
name: "P1.M5.T2.S1 — Reset lastCommit in gc() so deleted turn-snapshot commits become unreachable (BUG-006)"
description: |
  Reset `this.lastCommit = null` AND `this.capturesThisTurn = 0` inside `GitBackend.gc()` (src/snapshot/
  git.ts) so that the prompt-boundary GC actually reclaims deleted turn-snapshot commits (spec §5
  "physically reclaims") and the per-turn capture cap stops silently disabling captures in long
  sessions.

  THE TWO DEFECTS (verified: both fields are private and NEVER reset anywhere — grep confirms no
  reassignment site exists):
   1. `lastCommit` (git.ts:218, set at :377, read at :366) chains EVERY commit onto the previous via
      `-p <parent>`. After gc() deletes `refs/mulligan/snapshots/turn/*` refs, those turn commits
      stay REACHABLE through the parent chain of every later commit-tree → `git gc` (which reclaims
      only UNreachable objects) never reclaims them → unbounded within-session shadow-repo growth,
      contradicting spec §5 "physically reclaims". Bounded by session_shutdown (destroy → fsRm).
   2. `capturesThisTurn` (git.ts:219, incremented at :378, checked at :327) is the maxSnapshotsPerTurn
      counter. Its own field-comment claims "reset by lifecycle P3 at turn boundary" but NO reset
      exists → after `maxSnapshotsPerTurn` (default 64) successful captures, EVERY later capture()
      returns null (aborts at the cap check before scan/add). gc() IS the turn-boundary point
      (capture.ts gcTurnSnapshots → rt.store.gc() at turn_start) → the correct reset location.

  THE FIX (exact work-item placement): in gc() (git.ts:636), AFTER the ref-deletion `for` loop (ends
  line 655) and BEFORE the `// (2) physical reclaim` comment (line 657) / the `git gc --auto
  --prune=now` call (line 658), add two field assignments with a BUG-006 comment. gc() already
  acquires the mutex (spec §4.3), so this is safe; the two assignments add NO I/O.

  DEPENDS ON: the EXISTING, already-Complete snapshot subsystem (P2.M2 — git.ts). Does NOT touch
  capture()/restore()/has() pipeline logic, rewind.ts, store.ts, config, or the marker schema. The
  parallel item P1.M5.T1.S1 (BUG-005) also edits git.ts but in capture()+restore() (≈250 lines away)
  — disjoint hunks, no logical conflict, no coordination beyond that guarantee. Docs: [Mode A] —
  gc() JSDoc gains a note that lastCommit/capturesThisTurn are reset here (spec §5 "physically
  reclaims"). No user-facing/config/API surface change.

  CONTRACT scope: src/snapshot/git.ts (production) + test/git.test.ts (unit tests). NOTHING else.

---

## Goal

**Feature Goal**: Make the prompt-boundary GC in `GitBackend.gc()` actually reclaim deleted
turn-snapshot objects (spec §5 "physically reclaims") by breaking the commit parent-chain, AND fix
the latent `capturesThisTurn` counter that silently disables captures after `maxSnapshotsPerTurn`
total captures across a session.

**Deliverable**:
1. `GitBackend.gc()` (src/snapshot/git.ts:636) resets `this.lastCommit = null` and
   `this.capturesThisTurn = 0` after the ref-deletion loop and before `git gc --auto --prune=now`,
   with a BUG-006 comment.
2. gc() JSDoc (src/snapshot/git.ts ~lines 622-635) notes the reset (Mode A — spec §5 "physically
   reclaims").
3. Two behavioral unit tests in test/git.test.ts (a new `describe` inside the existing `GitBackend.gc`
   block) proving the resets via observable capture() behavior through the existing DI-seam fake.

**Success Definition**:
- After gc(), a subsequent capture() issues a commit-tree with NO `-p` parent (the chain is broken) —
  proven by a unit test.
- After gc(), a subsequent capture() that would have been capped by maxSnapshotsPerTurn now succeeds —
  proven by a unit test.
- `npm run typecheck`: 0 errors.
- `npx vitest run test/git.test.ts -v`: green (new tests + all existing; the existing gc test's
  call-sequence assertions are unaffected because the fix adds NO git commands).
- `npm test`: full suite green (no regression).
- `git diff --name-only` shows ONLY `src/snapshot/git.ts` and `test/git.test.ts`.

## Why

- **Closes the BUG-006 retention gap.** PRD §h2.3 Issue 2: "After gc() deletes the refs, the turn
  commits remain REACHABLE via the parent chain of every subsequent commit-tree ... git gc reclaims
  only UNreachable objects, so the deleted turn-snapshot commits are never reclaimed for the rest of
  the session — contradicting the spec's 'physically reclaims' claim." Resetting lastCommit at the
  turn boundary means each turn's commits form an isolated chain rooted at a turn-start capture; once
  gc() drops the turn/* refs, those commits have NO ref AND NO parent chain reaching them from a live
  commit → `git gc --prune=now` reclaims them (their blobs/trees too). Spec §5's described retention
  design ("at each new prompt... reclaims prior turns") then actually holds.
- **Fixes the latent capturesThisTurn leak.** The field's own comment promises a turn-boundary reset
  that never happens. A long session (>maxSnapshotsPerTurn captures cumulative) silently stops
  capturing, so the agent loses working-tree-revert snapshots with no signal. Resetting the counter
  at gc() (the turn boundary) honors the documented design and keeps the cap scoped to a single turn
  as intended.
- **Surgical + safe.** gc() already holds the mutex; the change is two field assignments (instant, no
  I/O). It touches neither the capture() pipeline (only the `lastCommit` it consumes) nor restore(),
  has(), dirtyCheck, changedPaths, retire, or destroy. No upstream consumer (rewind.ts) change.

## What

**User-visible behavior**: None directly (internal backend bookkeeping). Indirectly: shadow-repo
disk growth is now bounded across turns (deleted turn commits are reclaimed), and snapshot capture
keeps working in long sessions. No change to capture()'s return contract, restore(), config, or the
rewind marker.

**Technical change**:
- `gc()` resets `this.lastCommit = null` and `this.capturesThisTurn = 0` between the ref-deletion loop
  and the `git gc --auto --prune=now` call (inside the try, so a ref-deletion failure defers the reset
  to the next successful gc — correct).
- gc() JSDoc gains a sentence noting the reset (spec §5 "physically reclaims").

### Success Criteria

- [ ] `gc()` (src/snapshot/git.ts:636) sets `this.lastCommit = null;` after the ref-deletion loop and
      before the `git gc` call, with the BUG-006 comment.
- [ ] `gc()` sets `this.capturesThisTurn = 0;` in the SAME place (the maxSnapshotsPerTurn counter
      resets at the turn boundary / GC pass).
- [ ] gc() JSDoc documents the lastCommit + capturesThisTurn reset (Mode A — spec §5 "physically
      reclaims").
- [ ] New unit test proves: capture→capture (chained, 2nd has `-p`) → gc() → capture (NO `-p`).
- [ ] New unit test proves: with maxSnapshotsPerTurn:1, capture(succeeds)→capture(null, capped)→gc()
      →capture(succeeds again).
- [ ] `npm run typecheck` 0 errors; `npx vitest run test/git.test.ts` green; `npm test` green.
- [ ] `git diff --name-only` shows ONLY `src/snapshot/git.ts` + `test/git.test.ts`.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the exact
field declarations (git.ts:218-219) and their ONLY set/read/increment sites (cited lines), plus the
grep-verified fact that NO reset exists anywhere; (b) the exact gc() insertion point (after line 655's
loop, before line 657's comment) and the exact two assignments to add; (c) the behavioral test design
(fields are private → prove via capture()'s commit-tree args and null/non-null returns through the
existing `makeBackend`/`makeExec`/`findCmd` DI-seam fake, fully reproduced in the research notes); (d)
the proof that the existing gc test does not regress (the fix adds NO git commands, so call-sequence
assertions stay valid). No inference or guessing required.

### Documentation & References

```yaml
# MUST READ — the bug definition + fix strategy
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-006 (Minor): GitBackend lastCommit chains every commit, defeating GC"
  why: defines BOTH defects (lastCommit never reset → GC can't reclaim; the capturesThisTurn counter
    is the same family of never-reset per-backend accumulator) and the chosen fix (reset lastCommit in
    gc(); the work item extends this to also reset capturesThisTurn at the same site).
  critical: BUG-005 (P1.M5.T1.S1) and BUG-007 (P1.M5.T3.S1) are SEPARATE sibling items — do NOT touch
    capture()'s note logic or has()'s mutex here.

# MUST READ — verified codebase facts (line numbers, grep proofs, test design)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T2S1/research/codebase_facts.md
  why: the exact declaration/set/read lines for both fields; the proof neither is reset anywhere; the
    exact gc() insertion point; the inside-try-vs-finally placement reasoning; the two behavioral test
    designs (lastCommit chain-break + capturesThisTurn cap-reset) with the exact commit-tree args to
    assert; the no-regression proof for the existing gc test.

# PRIMARY EDIT TARGET
- file: src/snapshot/git.ts
  why: the ONLY production file. Field declarations (L218-219); lastCommit set L377 + read L366;
    capturesThisTurn incremented L378 + checked L327; gc() at L636 with the ref-deletion loop ending
    L655 and the `// (2) physical reclaim` comment at L657 / `git gc` call at L658; gc() JSDoc at
    ~L622-635. This item edits gc()'s body (2 assignments) + its JSDoc (1 sentence) ONLY.
  pattern: every store method already uses `const release = await this.mutex.acquire(); try { ... }
    finally { release(); }`. gc() ALREADY follows this — the new assignments go INSIDE the existing
    try, between the loop and the gc call, NOT in a new block. No new mutex acquire.
  gotcha: lastCommit/capturesThisTurn are PRIVATE — tests cannot read them directly. Prove the reset
    via capture()'s observable behavior (commit-tree `-p` presence; null vs non-null return).

# TEST PATTERNS (mirror these DI-seam fakes exactly)
- file: test/git.test.ts
  why: `makeBackend(calls, cfg=BASE_CFG, scan=emptyScan, canned={})` + `makeExec(calls, canned)`
    recording fake + `findCmd(calls, cmd)` + `calls.filter(c => c.args[0] === "<cmd>")`. commit-tree
    returns "COMMIT456"; write-tree returns "TREE123"; rev-parse returns /fake/repo + /fake/repo/.git;
    unknown cmds return "". The existing `describe("GitBackend.gc — ...")` block is at L482 — add the
    new tests there (or a sibling describe in the same file).
  pattern: the existing gc test (L483) shows the exact makeBackend(...) + canned.stdoutByCmd +
    findCmd idiom; mirror it. BASE_CFG (L29) has maxSnapshotsPerTurn:64 — for the capturesThisTurn
    test, pass a cfg with `{...BASE_CFG, maxSnapshotsPerTurn:1}`.

# CONSUMER OF gc() (read-only — confirms gc() is the turn boundary)
- file: src/capture.ts
  why: `gcTurnSnapshots(rt)` (L49) calls `await rt.store.gc()` at turn_start then clears in-memory
    turn/* entries. Confirms gc() IS the spec'd turn-boundary reset point — resetting capturesThisTurn
    here is correct (the counter is meant to be per-turn). READ-ONLY for this item.

# DEPENDENCY (parallel item — disjoint hunks in the same file; no conflict)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T1S1/PRP.md
  why: BUG-005 edits git.ts capture() (note-write ~after L377) + restore() (note-read). This item
    edits gc() (~L640-660). The two methods are ~250 lines apart → disjoint hunks, no logical conflict
    (different methods, no shared mutable state across the edit sites). Both edit git.ts so a merge
    tool may flag adjacency, but there is no textual overlap. No coordination beyond that guarantee.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  git.ts      # EDIT: gc() body (2 field assignments) + gc() JSDoc (1 sentence)
  cas.ts      # READ-ONLY (sibling backend; this item is git-only per the work item)
  store.ts    # READ-ONLY (SnapshotStore interface — gc() already declared)
src/capture.ts # READ-ONLY (confirms gc() runs at turn_start = the reset point)
test/
  git.test.ts # EDIT: add 2 behavioral unit tests inside the existing GitBackend.gc describe (L482)
```

### Desired Codebase tree with files to be changed

```bash
src/snapshot/git.ts   # MODIFIED — gc() resets lastCommit + capturesThisTurn; gc() JSDoc notes it
test/git.test.ts      # MODIFIED — 2 new behavioral tests (chain-break + cap-reset)
# (no new files; no cas.ts/store.ts/capture.ts/rewind.ts/config/marker changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — the reset placement is INSIDE the existing try, AFTER the ref-deletion loop (L655)
//   and BEFORE the `// (2) physical reclaim` comment (L657) / git gc call (L658). Do NOT move it to
//   a finally block: if the ref-deletion loop throws, the reset should be DEFERRED to the next
//   successful gc() (the commits may still be partially ref'd → don't orphan the chain prematurely).
//   If the reset runs and THEN git gc fails, lastCommit is already null → commits unreachable → a
//   future gc reclaims them. Both orderings are safe; the work-item specifies the loop-after/gc-before
//   site — follow it exactly.

// CRITICAL #2 — gc() ALREADY acquires the mutex (`const release = await this.mutex.acquire()` at the
//   top of gc()). The two field assignments run INSIDE the existing try. Do NOT add a second mutex
//   acquire, do NOT add a new try/finally. Just two lines + a comment.

// CRITICAL #3 — lastCommit and capturesThisTurn are PRIVATE. Tests CANNOT assert on them directly.
//   Prove the resets via capture()'s OBSERVABLE behavior:
//     lastCommit reset:  capture→capture→gc()→capture; the 3rd commit-tree call's args have NO "-p".
//     capturesThisTurn:  cfg maxSnapshotsPerTurn:1; capture(ok)→capture(null)→gc()→capture(ok again).

// GOTCHA #4 — capturesThisTurn's cap check is at git.ts:327, BEFORE the scan/add pipeline. So a
//   capped capture issues NO new add/write-tree/commit-tree (ensureInit is memoized after the first
//   capture, so even its rev-parse calls don't re-run). Assert the capped capture's RETURN is null,
//   not the absence of pipeline calls (the first capture's calls are still in the recorded `calls`).

// GOTCHA #5 — the canned commit-tree always returns "COMMIT456" (makeExec L?? — see test/git.test.ts
//   makeExec). So after the first capture, lastCommit === "COMMIT456" and stays "COMMIT456" for every
//   subsequent chained capture. The 2nd capture's commit-tree therefore has -p COMMIT456. After gc()
//   resets lastCommit=null, the 3rd capture's commit-tree has NO -p. This is the assertion that proves
//   the reset. (If makeExec ever changes its canned commit SHA, update the asserted parent value.)

// GOTCHA #6 — the EXISTING gc test (test/git.test.ts:483) asserts the exact call sequence
//   (for-each-ref → update-ref -d ×N → gc). This fix adds NO git commands (just two field assignments),
//   so that test's assertions remain valid. Do NOT need to modify the existing test — only ADD new ones.

// GOTCHA #7 — existsSync(this.shadowDir) is NOT mocked; on a fresh GitBackend the shadow dir path
//   (/fake/store/<sha256>) doesn't exist → ensureInit runs `git init --bare` through the fake (returns
//   ""). This is how the existing gc/restore/retire tests already work — no special handling needed.
//   ensureInit is memoized (initPromise), so across multiple captures/gc in one test it runs ONCE.

// CONVENTION — reset BOTH fields in the SAME spot (the work item requires it: "Also reset
//   this.capturesThisTurn = 0; in the same place"). They are the same family of never-reset per-turn
//   accumulator; gc() is the single turn-boundary reset point. One comment covers both.
```

## Implementation Blueprint

### Data models and structure

No data-model change. No new types, no new exports, no interface change. Two existing private fields
are reassigned inside an existing method. (`capturesThisTurn`'s field comment at git.ts:219 already
SAYS it is "reset by lifecycle P3 at turn boundary" — this item makes that comment TRUE.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts gc() (~L636) — reset lastCommit + capturesThisTurn
  - FIND: the gc() method body. The ref-deletion loop ends at:
        for (const rn of refnames) {
          await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
        }                                            // ← L655
    and is immediately followed by:
        // (2) physical reclaim — self-throttling (cheap no-op under the loose-object threshold).  // L657
        await this.exec("git", ["gc", "--auto", "--prune=now"], this.shadowEnv());                  // L658
  - INSERT between L655 (end of loop) and L657 (the (2) comment):
        // BUG-006: reset the commit chain so deleted turn/* commits become unreachable from future
        // commits → git gc can reclaim them. Also reset the maxSnapshotsPerTurn counter (the turn
        // boundary / GC pass is the spec'd reset point — currently never reset, which could prevent
        // captures after enough turns).
        this.lastCommit = null;
        this.capturesThisTurn = 0;
  - PRESERVE: the `const release = await this.mutex.acquire();` + the outer try/catch/finally. The
    new assignments are INSIDE the try (so a ref-deletion throw defers the reset — correct). Do NOT
    add a new try/finally or a second mutex acquire. Do NOT touch the for-each-ref, the loop, the
    git gc call, the catch, or the finally.
  - NAMING: reuse the EXACT existing field names (`this.lastCommit`, `this.capturesThisTurn`).

Task 2: MODIFY src/snapshot/git.ts gc() JSDoc (~L622-635) — note the reset (Mode A)
  - FIND: the gc() JSDoc block immediately above `async gc(): Promise<void> {`. It currently says
    gc() "Drops EVERY refs/mulligan/snapshots/turn/* ref ... AND physically reclaims via git gc
    --auto --prune=now".
  - ADD one sentence (e.g. after the "physically reclaims" clause) noting: it ALSO resets
    `this.lastCommit = null` (so deleted turn commits become unreachable → reclaimable — BUG-006,
    spec §5 "physically reclaims") and `this.capturesThisTurn = 0` (the maxSnapshotsPerTurn counter
    resets at the turn boundary). Keep the JSDoc's existing tone/style (it references spec §5 + §4.3).
  - PRESERVE: the existing JSDoc sentences about namespace-delete, checkpoint exemption, the mutex,
    best-effort, and the call sites (turn_start hook + session_start GC).

Task 3: ADD unit tests to test/git.test.ts — lastCommit chain-break across gc() (BUG-006)
  - ADD inside the existing `describe("GitBackend.gc — prompt-boundary namespace-delete + reclaim
    (spec/14 §5)", ...)` block (test/git.test.ts:482) — or a sibling describe in the same file.
  - CASE (lastCommit reset): construct `const gb = makeBackend(calls, BASE_CFG, emptyScan)` (calls=[]
    fresh per test). Then:
        await gb.capture("turn");        // commit-tree: ["commit-tree","TREE123","-m","snapshot:turn"] (no -p)
        await gb.capture("turn-after");  // commit-tree: ["commit-tree","TREE123","-p","COMMIT456","-m","snapshot:turn-after"]
        await gb.gc();                   // resets lastCommit = null
        await gb.capture("turn");        // commit-tree: NO -p again (proves reset)
    Assert: collect all commit-tree calls `const cts = calls.filter(c => c.args[0] === "commit-tree");`
    expect(cts).toHaveLength(3);
    expect(cts[0]!.args).toEqual(["commit-tree","TREE123","-m","snapshot:turn"]);           // no -p
    expect(cts[1]!.args).toContain("-p"); expect(cts[1]!.args).toContain("COMMIT456");       // chained
    expect(cts[2]!.args).toEqual(["commit-tree","TREE123","-m","snapshot:turn"]);           // NO -p ⇒ reset
    (The strongest single assertion: `expect(cts[2]!.args).not.toContain("-p");`.)
  - NOTE: gc() runs for-each-ref (emptyScan's canned stdout → "" for for-each-ref unless you set it;
    empty result is fine — the loop body never runs, but the reset STILL runs). update-ref -d is not
    issued when refnames is empty. The git gc call runs. All fine.
  - COVERAGE: proves gc() breaks the parent chain so future captures don't chain onto (and thus keep
    reachable) the deleted turn commits. Follow existing `it("...")` naming.

Task 4: ADD unit tests to test/git.test.ts — capturesThisTurn cap-reset across gc()
  - CASE (cap-reset): construct a cfg with a tight cap:
        const cfg = { ...BASE_CFG, maxSnapshotsPerTurn: 1 };
        const gb = makeBackend(calls, cfg, emptyScan);
        expect(await gb.capture("turn")).toBe("COMMIT456");        // succeeds (capturesThisTurn 0→1)
        expect(await gb.capture("turn-after")).toBeNull();          // capped (1 >= 1 → abort → null)
        await gb.gc();                                              // resets capturesThisTurn = 0
        expect(await gb.capture("turn")).toBe("COMMIT456");         // succeeds again (proves reset)
  - STRENGTHEN (optional): also assert the capped capture returned null BECAUSE of the cap, not some
    other failure — e.g. after the capped capture, `findCmd(calls,"write-tree")` still finds ONLY the
    first capture's write-tree (the cap check at git.ts:327 is before scan/add). A simple count:
    `expect(calls.filter(c => c.args[0] === "write-tree")).toHaveLength(1);` after the 2nd (capped)
    capture, and `.toHaveLength(2)` after the 3rd (post-gc) capture.
  - COVERAGE: proves gc() resets the maxSnapshotsPerTurn counter so long sessions don't silently stop
    capturing. Follow existing `it("...")` naming.

Task 5 (OUT OF SCOPE — do NOT do): NO cas.ts change (this item is git-only per the work item; the cas
  backend has no lastCommit field and its capturesThisTurn is tracked in its own backend — out of
  scope). NO store.ts change (gc() already in the interface). NO capture.ts change (it already calls
  rt.store.gc() at turn_start — that's WHY gc() is the reset point). NO rewind.ts/config/marker change.
  NO has() mutex change (BUG-007 owns that). NO capture()/restore() change (BUG-005 owns that). If
  `git diff --name-only` shows anything beyond {src/snapshot/git.ts, test/git.test.ts}, STOP.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the EXACT gc() insertion (two field assignments inside the existing try, between the
//   ref-deletion loop and the git gc call). BEFORE:
//       for (const rn of refnames) {
//         await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
//       }
//       // (2) physical reclaim ...
//       await this.exec("git", ["gc", "--auto", "--prune=now"], this.shadowEnv());
//   AFTER (the two lines + comment are the ONLY body change):
//       for (const rn of refnames) {
//         await this.exec("git", ["update-ref", "-d", rn], this.shadowEnv());
//       }
//       // BUG-006: reset the commit chain so deleted turn/* commits become unreachable from future
//       // commits → git gc can reclaim them. Also reset the maxSnapshotsPerTurn counter (the turn
//       // boundary / GC pass is the spec'd reset point — currently never reset, which could prevent
//       // captures after enough turns).
//       this.lastCommit = null;
//       this.capturesThisTurn = 0;
//       // (2) physical reclaim ...
//       await this.exec("git", ["gc", "--auto", "--prune=now"], this.shadowEnv());

// PATTERN — behavioral test for a PRIVATE field reset (lastCommit): drive observable capture()
//   behavior through the DI-seam fake and assert on the RECORDED commit-tree call args. The canned
//   makeExec returns "COMMIT456" for commit-tree, so after capture #1 lastCommit==="COMMIT456";
//   capture #2 chains (-p COMMIT456); after gc() capture #3 has NO -p ⇒ reset proven.
//     const cts = calls.filter((c) => c.args[0] === "commit-tree");
//     expect(cts[2]!.args).not.toContain("-p");   // the post-gc capture starts a fresh chain

// PATTERN — behavioral test for a PRIVATE counter reset (capturesThisTurn): drive capture() with a
//   tight maxSnapshotsPerTurn and assert null/non-null returns around a gc() call.
//     expect(await gb.capture("turn")).toBe("COMMIT456");      // ok
//     expect(await gb.capture("turn-after")).toBeNull();        // capped
//     await gb.gc();                                            // reset
//     expect(await gb.capture("turn")).toBe("COMMIT456");       // ok again ⇒ reset proven

// CRITICAL — the reset is SAFE wrt the mutex + ordering. gc() holds the mutex (spec §4.3) for its
//   whole body, so the field assignments are atomic w.r.t. any concurrent capture/restore. A
//   ref-deletion failure defers the reset to the next successful gc() (correct: don't break the chain
//   while commits may still be partially ref'd). A git-gc failure AFTER the reset is harmless
//   (lastCommit already null ⇒ commits unreachable ⇒ reclaimed by a future gc). No new invariant.
```

### Integration Points

```yaml
GC (src/snapshot/git.ts):
  - change: "gc() resets this.lastCommit = null + this.capturesThisTurn = 0 after the ref-deletion
      loop, before git gc --auto --prune=now"
  - mutex: UNCHANGED — gc() already acquires it; the assignments run inside the existing try.
JSDOC (src/snapshot/git.ts gc()):
  - change: "add a sentence noting the lastCommit + capturesThisTurn reset (spec §5 'physically
      reclaims') — Mode A"
CAPTURE (src/snapshot/git.ts): UNCHANGED — capture() still reads lastCommit (L366) + sets it (L377)
  + increments capturesThisTurn (L378). The fix only changes WHEN they reset (at gc() now).
CALLER (src/capture.ts gcTurnSnapshots): UNCHANGED — already calls rt.store.gc() at turn_start,
  which is WHY gc() is the correct reset point.
STORE CONTRACT (src/snapshot/store.ts): UNCHANGED — gc() signature already declared.
CAS BACKEND (src/snapshot/cas.ts): UNCHANGED — out of scope (git-only item).
HAS / CAPTURE / RESTORE: UNCHANGED — BUG-005 (P1.M5.T1.S1) + BUG-007 (P1.M5.T3.S1) own those.
CONFIG / DATABASE / ROUTES / MARKER-SCHEMA: none.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (the two field assignments type-check trivially — both are existing
# private fields; null is assignable to string|null; 0 to number).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.

# Confirm scope:
git diff --name-only
# EXPECTED: exactly { src/snapshot/git.ts, test/git.test.ts }.
# If src/capture.ts, src/snapshot/cas.ts, src/snapshot/store.ts, src/tools/rewind.ts appears → OUT OF
#   SCOPE; revert those hunks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the edited test file (new tests + all existing must pass).
npx vitest run test/git.test.ts -v
# Expected: green. The new lastCommit-chain-break + capturesThisTurn-cap-reset tests pass; the
#   existing gc test (L483) STAYS GREEN because the fix adds NO git commands (its call-sequence
#   assertions remain valid); the existing capture/caps/mutex/dirtyCheck/changedPaths/has/retire/
#   restore tests stay green (no behavioral change to those methods).

# If a test asserts the gc() call sequence and now FAILS — you accidentally added a git command or
#   reordered the loop/gc. The fix adds ONLY two field assignments (no exec calls). Revert any
#   accidental exec change.

# Full snapshot + integration suite (no behavioral regression):
npx vitest run test/git.test.ts test/cas.test.ts test/integration/revert-*.test.ts
# Expected: green. (cas.ts is untouched; integration tests exercise the rewind-tool↔store path which
# is unchanged.)
```

### Level 3: Integration Testing (System Validation)

```bash
# The unit tests in Level 2 ARE the system validation (they drive the REAL gc()+capture() through
# the DI-seam fake for the reset→observable-behavior round-trip). No separate system test is needed.

# OPTIONAL end-to-end sanity (proves physical reclamation, NOT a required gate): in a scratch git
# repo with revert enabled, drive several turns (each turn_start → gc + capture). Inspect the shadow
# repo: BEFORE this fix `git -C <shadow> log --all --oneline` shows an unbroken chain spanning all
# turns; AFTER this fix each turn starts a fresh root commit, and `git gc --auto --prune=now`
# followed by `git count-objects -v` shows prior-turn commits/blobs ARE reclaimed across the prompt
# boundary. (Manual confirmation; the unit tests are sufficient proof for the gate.)
```

### Level 4: Creative & Domain-Specific Validation (correctness reasoning)

```bash
# Reasoning check (no command — the invariants this item establishes):
#   lastCommit reset: gc() sets lastCommit=null → the NEXT capture()'s commit-tree has no -p → it is
#     a fresh root. Prior turn commits had their refs deleted by the SAME gc() → no ref points to
#     them AND no live commit parents onto them → they are UNREACHABLE → git gc --prune=now reclaims
#     them + their exclusive blobs/trees. Spec §5 "physically reclaims" now holds. ✓
#   Within-turn history preserved: captures WITHIN a single turn still chain (capture #2 of a turn
#     has -p <capture #1>) — only the CROSS-turn chain is broken at gc(). This matches the retention
#     design (a turn's captures are a unit; the boundary is the prompt). ✓
#   capturesThisTurn reset: gc() sets it to 0 at the turn boundary → the maxSnapshotsPerTurn cap is
#     now correctly scoped to a SINGLE turn (its documented intent), not cumulative across the
#     session. Long sessions no longer silently stop capturing. ✓
#   Failure ordering: ref-deletion throw → reset deferred to next gc() (commits may still be
#     partially ref'd → don't orphan prematurely); git-gc throw after reset → harmless (lastCommit
#     already null → unreachable → reclaimed later). Both safe. ✓
#   Mutex: gc() holds the mutex for its whole body → the assignments are atomic w.r.t. concurrent
#     capture/restore. No new race. ✓
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`: 0 errors.
- [ ] `npx vitest run test/git.test.ts`: green (new + existing).
- [ ] `npx vitest run test/cas.test.ts test/integration/revert-*.test.ts`: green (no consumer regression).
- [ ] `npm test`: full suite green.
- [ ] `git diff --name-only` shows ONLY the 2 in-scope files.

### Feature Validation

- [ ] gc() sets `this.lastCommit = null` after the ref-deletion loop, before `git gc`, with the
      BUG-006 comment.
- [ ] gc() sets `this.capturesThisTurn = 0` in the SAME place.
- [ ] gc() JSDoc documents the reset (Mode A — spec §5 "physically reclaims").
- [ ] New test: capture→capture(chained)→gc()→capture(NO -p) — proves lastCommit reset.
- [ ] New test: maxSnapshotsPerTurn:1 → capture(ok)→capture(null)→gc()→capture(ok) — proves cap reset.

### Code Quality Validation

- [ ] The two assignments are INSIDE the existing gc() try (not a new try/finally; not a new mutex).
- [ ] No new git exec calls added in gc() (only field assignments) → existing gc test stays green.
- [ ] gc()'s for-each-ref / loop / git gc call / catch / finally are UNCHANGED.
- [ ] No edit to capture()/restore()/has()/cas.ts/store.ts/capture.ts/rewind.ts (BUG-005/BUG-007 scope).

### Documentation & Deployment

- [ ] gc() JSDoc updated (Mode A) — notes lastCommit + capturesThisTurn reset (spec §5).
- [ ] No config / env-var / API-surface / marker-schema change.

---

## Anti-Patterns to Avoid

- ❌ **Don't move the reset to a `finally` block.** If the ref-deletion loop throws, the reset must be
  DEFERRED to the next successful gc() — the commits may still be partially ref'd, so breaking the
  chain prematurely could orphan reachable commits. Inside-try-between-loop-and-gc is the work-item's
  exact spec; follow it.
- ❌ **Don't add a second mutex acquire / a new try-finally.** gc() ALREADY holds the mutex for its
  whole body (spec §4.3). The two field assignments are instant + run inside the existing try. Adding
  locking scaffolding is wrong + would suggest the reset isn't covered by the existing lock.
- ❌ **Don't try to read the private fields in tests.** `lastCommit`/`capturesThisTurn` are PRIVATE.
  Prove the reset via capture()'s OBSERVABLE behavior: commit-tree `-p` presence (lastCommit) and
  null/non-null return under a tight maxSnapshotsPerTurn (capturesThisTurn). Asserting on private
  state would require `// @ts-ignore` / `(gb as any)` hacks — the behavioral tests are stronger AND
  type-safe.
- ❌ **Don't edit cas.ts, store.ts, capture.ts, or rewind.ts.** This is a GIT-ONLY item (the work item
  scopes it to GitBackend). cas.ts has its own capturesThisTurn (a sibling backend, out of scope).
  store.ts already declares gc(). capture.ts already calls rt.store.gc() at turn_start (that's WHY gc()
  is the reset point — no change needed). rewind.ts is upstream and unaffected. Editing them is out of
  scope and risks conflicting with the parallel BUG-005 (P1.M5.T1.S1) / BUG-007 (P1.M5.T3.S1) items.
- ❌ **Don't reorder the gc() pipeline.** The existing gc test (L483) asserts for-each-ref →
  update-ref -d → gc. The reset goes AFTER the loop, BEFORE the gc call — it adds NO commands, so the
  sequence assertion stays valid. If you reorder or insert an exec call, that test breaks.
- ❌ **Don't reset only one field.** The work item explicitly requires BOTH: `this.lastCommit = null`
  AND `this.capturesThisTurn = 0` in the SAME place. They are the same family of never-reset per-turn
  accumulator; resetting only lastCommit leaves the latent capture-cap leak in place.
- ❌ **Don't forget the JSDoc.** Mode A docs require the gc() JSDoc to note the reset (spec §5
  "physically reclaims"). Without it, the comment on capturesThisTurn's field ("reset by lifecycle P3
  at turn boundary") is a lie; with the JSDoc + the reset, the design is self-documenting.

---

## Confidence Score

**9/10** — This is a two-line behavioral fix (plus a one-sentence JSDoc + two behavioral tests) to an
existing method, where: (a) both defects are grep-verified (the fields are private + set/read but
NEVER reset anywhere in src); (b) the insertion point is pinned to the exact lines (after the
ref-deletion loop L655, before the git gc call L658) by the work item's explicit wording and confirmed
against the source; (c) gc() already holds the mutex, so the assignments are safe + atomic, and they
add NO git commands so the existing gc test cannot regress; (d) the reset semantics are simple to
reason about (lastCommit=null → next capture is a fresh root → deleted turn commits unreachable → git
gc reclaims them; capturesThisTurn=0 → cap is per-turn as documented); (e) the test design proves the
resets behaviorally through the existing `makeBackend`/`makeExec`/`findCmd` DI-seam fake with exact
assertable values (commit-tree "-p" presence/absence; null/non-null capture returns under a tight
cap). The one residual risk: a merge-tool adjacency flag with the parallel BUG-005 item (both edit
git.ts) — but the hunks are disjoint (gc() vs capture()+restore(), ~250 lines apart) with no shared
mutable state at the edit sites, so there is no logical conflict and a trivial textual resolve if
flagged. No upstream coordination needed (capture.ts/rewind.ts unchanged).