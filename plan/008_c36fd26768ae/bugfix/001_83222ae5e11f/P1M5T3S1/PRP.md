---
name: "P1.M5.T3.S1 — Acquire the mutex inside has() in GitBackend + CasBackend (BUG-007)"
description: |
  Wrap `has()` in BOTH backends in the standard `const release = await this.mutex.acquire(); try{…}
  catch{return false;} finally{release();}` structure that EVERY other store op already uses, so
  `has()` honors spec/14 §4.3's "a single mutex per store serializes ALL store operations
  (capture/dirtyCheck/restore/retire/gc)" contract.

  THE DEFECT (verified by grep): `has()` is the ONLY store operation that does NOT acquire the mutex.
  - src/snapshot/git.ts `has()` (method body L528-538): the JSDoc (L524-527) explicitly says "NOT
    mutex-serialized (spec §4.3 omits `has`…)" and the body runs `git rev-parse --verify <ref>` with
    no acquire/release.
  - src/snapshot/cas.ts `has()` (method body L1082-1091): same — JSDoc (L1077-1081) says "NOT
    mutex-serialized … parity with git.ts" and the body runs `fs.access(manifestPath(ref))` with no
    acquire/release.
  Spec §4.3 ALSO specifies the prompt-boundary GC pass "ALSO acquires the mutex, so a git gc / CAS
  mark-sweep can never overlap an in-flight capture/restore/retire" — an unguarded `has()` invoked
  concurrently with gc()/destroy() can read the store mid-mutation (after gc deletes refs but before
  prune, or while destroy's fsRm is removing the shadow/manifest dir), returning a transiently
  inconsistent boolean. Low impact (has is best-effort, returns a boolean used only for cross-reload
  ref-honoring), but it is a deviation from the spec's serialization contract and a latent race.

  THE FIX (exact): in each `has()` body, INSERT `const release = await this.mutex.acquire();` as the
  first statement with the comment "BUG-007: serialized per spec §4.3 (ALL store operations acquire
  the mutex)", wrap the existing try in `try { …existing… } catch { return false; } finally { release();
  }`. The existing catch stays binding-less (`catch {`) — has() does NOT log (best-effort silent
  false), unlike dirtyCheck/restore which catch `(err)` to warn. REMOVE the "NOT mutex-serialized"
  JSDoc paragraph from both and document BUG-007 + spec §4.3 compliance (Mode A).

  CONTRACT scope: src/snapshot/git.ts (has body + JSDoc) + src/snapshot/cas.ts (has body + JSDoc) +
  test/git.test.ts (1 new smoke test) + test/cas.test.ts (1 new smoke test + fix the L1550 test's
  now-false title/comment that asserts "has is NOT serialized"). NOTHING else.

---

## Goal

**Feature Goal**: Make `has()` in BOTH `GitBackend` and `CasBackend` acquire (and always release)
the per-instance `AsyncMutex`, so that every store operation — now including `has()` — is serialized
per spec/14 §4.3's "ALL store operations" contract, closing the latent read-during-gc/destroy race.

**Deliverable**:
1. `GitBackend.has()` (src/snapshot/git.ts:528) acquires the mutex, runs the existing body under the
   lock, and releases in a `finally`. JSDoc removes the "NOT mutex-serialized" paragraph and documents
   BUG-007 + spec §4.3 compliance (Mode A).
2. `CasBackend.has()` (src/snapshot/cas.ts:1082) — identical treatment.
3. `test/cas.test.ts:1550` test title + comment corrected (it currently asserts "has is NOT
   serialized" / "has does NOT acquire it" — now false).
4. One new "acquires the mutex" smoke test in each of `test/git.test.ts` (in the existing
   `describe("GitBackend.has — spec/14 §2", …)` at L408) and `test/cas.test.ts` (in the existing
   `describe("CasBackend.has — spec/14 §2", …)` at L1498), mirroring the established
   "two concurrent both complete" idiom (git.test.ts:400 / git.test.ts:542 / cas.test.ts:1263).

**Success Definition**:
- Both `has()` bodies begin with `const release = await this.mutex.acquire();` and end with
  `finally { release(); }`.
- The "NOT mutex-serialized" paragraph is GONE from both JSDocs; each has() JSDoc states it is
  serialized per spec §4.3 (BUG-007).
- `cas.test.ts:1550` no longer claims has is unserialized.
- `npm run typecheck`: 0 errors.
- `npx vitest run test/git.test.ts test/cas.test.ts -v`: green (new tests + all existing has tests
  stay green — single-call has() acquires+releases cleanly with no contention).
- `npm test`: full suite green (no regression).
- `git diff --name-only` shows ONLY `src/snapshot/git.ts`, `src/snapshot/cas.ts`, `test/git.test.ts`,
  `test/cas.test.ts`.

## Why

- **Closes the BUG-007 spec-deviation.** PRD §h2.3 Issue 3: "spec/14 §4.3 states 'a single mutex per
  store serializes ALL store operations (capture/dirtyCheck/restore/retire/gc)' … Both backends
  explicitly OMIT `has()` from the mutex … an unguarded `has()` invoked concurrently with gc()/
  destroy() can read the store mid-mutation." The fix makes the §4.3 contract literally true (every
  store op now acquires the mutex), and removes the latent race where `has()` could observe a
  half-deleted shadow repo (git) or manifest dir (cas) between gc()'s ref deletion and prune, or
  during destroy()'s `fsRm`.
- **Self-documenting honesty.** The "NOT mutex-serialized" JSDoc + the cas.test.ts:1550 assertion are
  now false statements about the code. Leaving them would mislead every future reader (and agent) into
  believing `has()` is deliberately unserialized — the exact misimpression that let BUG-007 persist.
  Mode A (changeset docs) requires the JSDoc to reflect the real behavior.
- **Surgical + safe.** `has()` is already `async` and returns `Promise<boolean>` — NO signature
  change. The mutex is REAL and already constructed (`private readonly mutex = new AsyncMutex()`).
  The change adds one acquire + one `finally { release(); }`; the existing try/catch and its
  best-effort `return false` are preserved verbatim. `ensureInit()` ordering is unchanged (acquire
  first, ensureInit inside the try — exactly like capture/dirtyCheck/restore/retire/gc).
- **Does not touch the parallel items.** BUG-005 (P1.M5.T1.S1) edits git.ts/cas.ts capture()+restore();
  BUG-006 (P1.M5.T2.S1) edits git.ts gc(). Those are disjoint methods with no shared mutable state at
  the edit sites — no conflict.

## What

**User-visible behavior**: None. `has()` is an internal read used for cross-reload ref-honoring; it
still returns `Promise<boolean>`, still best-effort (never rejects), still returns `false` on any
error. The only behavioral change is that a `has()` call now serializes against concurrent
capture/dirtyCheck/restore/retire/gc/destroy (it waits for the mutex instead of reading under them).

**Technical change**:
- `has()` body: acquire mutex → try { existing body } catch { return false; } finally { release(); }.
- has() JSDoc: remove the "NOT mutex-serialized" paragraph; add a sentence stating has() IS now
  serialized per spec §4.3 (BUG-007) — same mutex as capture/dirtyCheck/restore/retire/gc/destroy.
- Inline comment on the acquire line: "BUG-007: serialized per spec §4.3 (ALL store operations acquire
  the mutex)".

### Success Criteria

- [ ] `GitBackend.has()` (src/snapshot/git.ts:528) acquires `this.mutex`, runs the body under the lock,
      and `release()`s in a `finally`. Catch stays binding-less `catch { return false; }`.
- [ ] `CasBackend.has()` (src/snapshot/cas.ts:1082) — identical structure.
- [ ] Both has() JSDocs: the "NOT mutex-serialized" paragraph is REMOVED; a BUG-007 + spec §4.3
      serialization note is ADDED (Mode A).
- [ ] The acquire line in both carries the comment: "BUG-007: serialized per spec §4.3 (ALL store
      operations acquire the mutex)".
- [ ] `test/cas.test.ts:1550` title no longer says "has is NOT serialized"; its comment no longer says
      "has does NOT acquire it". (Body assertions unchanged.)
- [ ] New smoke test in `test/git.test.ts` (in the `GitBackend.has` describe): two concurrent `has()`
      both complete (no deadlock) and both issued `rev-parse --verify` ⇒ has acquired+released.
- [ ] New smoke test in `test/cas.test.ts` (in the `CasBackend.has` describe): two concurrent `has()`
      both complete (no deadlock) ⇒ has acquired+released.
- [ ] `npm run typecheck` 0 errors; `npx vitest run test/git.test.ts test/cas.test.ts` green;
      `npm test` green.
- [ ] `git diff --name-only` shows ONLY the 4 in-scope files.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the EXACT
current `has()` bodies + JSDoc (reproduced verbatim in the research notes — git.ts:520-538,
cas.ts:1077-1091); (b) the canonical acquire/release pattern, reproduced verbatim from the existing
`dirtyCheck` (git.ts:426-455), which every sibling op already follows; (c) the contract's exact
target shape (`const release = await this.mutex.acquire(); try{…} catch{return false;} finally
{release();}`); (d) the verified test helpers (`makeBackend`/`makeExec`/`findCmd` for git;
`makeStateFs`/`makeStateBackend` for cas) and the verbatim "acquires the mutex" smoke-test idiom from
git.test.ts:400/542 + cas.test.ts:1263; (e) the one existing test (cas.test.ts:1550) whose title/
comment becomes false and must be corrected. No inference or guessing required.

### Documentation & References

```yaml
# MUST READ — the bug definition + fix strategy (BUG-007 section)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-007 (Minor): has() not mutex-serialized"
  why: defines the defect (both has() omit the mutex) + the chosen fix (add acquire/release mirroring
    capture/dirtyCheck/restore/retire/gc/destroy) + the race being closed (has vs gc()/destroy()).
  critical: the fix is ADD an acquire/release around the EXISTING body — do NOT rewrite has()'s logic,
    do NOT change its return contract (still best-effort boolean), do NOT add logging to the catch.

# MUST READ — the canonical serialization pattern to copy
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/codebase_patterns.md
  section: "## 2. AsyncMutex Serialization Pattern"
  why: the EXACT `const release = await this.mutex.acquire(); try{…} catch{…} finally{release();}`
    shape, with the GOTCHA #5 reminder that a forgotten release() deadlocks every later acquire().

# MUST READ — verified codebase facts (verbatim current source + line numbers + test idioms)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T3S1/research/codebase_facts.md
  why: the verbatim has() bodies + JSDoc to edit (git.ts:520-538, cas.ts:1077-1091); the verbatim
    dirtyCheck reference pattern; the mutex field decl; the verbatim "acquires the mutex" test idiom
    from git.test.ts:400/542 + cas.test.ts:1263; the cas.test.ts:1550 title/comment that must be
    corrected; the scope/non-conflict proof vs the parallel BUG-005/BUG-006 items.

# PRIMARY EDIT TARGETS (production)
- file: src/snapshot/git.ts
  why: GitBackend.has() body (L528-538) + its JSDoc (L520-527). Insert acquire as first statement,
    wrap body in try/catch/finally. The "NOT mutex-serialized" JSDoc paragraph is at L524-527.
  pattern: mirror dirtyCheck (L426-455): `const release = await this.mutex.acquire(); try { await
    this.ensureInit(); … } catch { … } finally { release(); }`.
  gotcha: keep the EXISTING binding-less `catch {` (has does NOT log). keep the existing inline
    comments verbatim. ensureInit stays INSIDE the try (acquire-before-ensureInit, like every sibling).

- file: src/snapshot/cas.ts
  why: CasBackend.has() body (L1082-1091) + its JSDoc (L1077-1081). Identical treatment. The
    "NOT mutex-serialized" paragraph is at L1077-1081.
  pattern: mirror git.ts has() after the fix (both backends use the SAME pattern).

# TEST EDIT TARGETS
- file: test/git.test.ts
  why: `describe("GitBackend.has — spec/14 §2", …)` at L408. ADD one "acquires the mutex" smoke test
    inside it (mirror the changedPaths idiom at L400). The 3 existing has tests (L412/423/428) are
    UNAFFECTED (single-call → acquire+release cleanly).
  pattern: `it("acquires the mutex (two concurrent both complete — §4.3 / BUG-007)", async () => {
    const calls: Call[] = []; const gb = makeBackend(calls); await Promise.all([gb.has("COMMIT456"),
    gb.has("COMMIT456")]); const verify = calls.filter(c => c.args[0]==="rev-parse" &&
    c.args[1]==="--verify"); expect(verify).toHaveLength(2); });`
  gotcha: ensureInit is memoized → across 2 concurrent has() it runs ONCE, so exactly 2 `rev-parse
    --verify` calls are recorded (the filter is the same one the existing L412 test uses).

- file: test/cas.test.ts
  why: (1) `describe("CasBackend.has — spec/14 §2", …)` at L1498 — ADD one "acquires the mutex" smoke
    test. (2) the mutex-parity describe at L1547 has `it("concurrent ops are serialized (max-in-flight
    1) — has is NOT serialized", …)` at L1550 whose TITLE + comment are now FALSE — correct them.
  pattern (new smoke test): capture("turn",["a.ts"]) to write the manifest, then `await Promise.all([
    cb.has("turn"), cb.has("turn")])` (both must resolve — proves acquire+release, no deadlock).
  gotcha: the L1550 test BODY fires only capture/dirtyCheck/restore/retire (NOT has) and asserts
    maxInFlight===1 — that assertion STAYS VALID; ONLY the title suffix "— has is NOT serialized" and
    the comment clause "has does NOT acquire it" are wrong and must be removed/rewritten.

# CONSUMER (read-only — confirms has() is called cross-reload, justifying the race fix)
- file: src/snapshot/store.ts
  why: the SnapshotStore interface declares `has(ref): Promise<boolean>`. NO interface change needed
    (signature unchanged). READ-ONLY for this item.
- file: src/index.ts  (session_start rebuild path from BUG-002 / P1.M2)
  why: the cross-reload checkpoint rebuild calls `store.has(ref)` to verify a rebuilt snapshot ref
    still exists. READ-ONLY — confirms has() runs at session_start, the exact window where a
    concurrent gc()/destroy() could race it. Justifies the fix; no edit here.

# PARALLEL ITEMS (disjoint — for non-conflict awareness, NOT for editing)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T2S1/PRP.md
  why: BUG-006 edits git.ts gc() (~L636, ~80 lines below has()). Disjoint method, no shared mutable
    state at the edit sites. Safe to merge. DO NOT edit gc() in this item.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  git.ts      # EDIT: has() body (L528) + has() JSDoc (L524-527) — add acquire/release + BUG-007 note
  cas.ts      # EDIT: has() body (L1082) + has() JSDoc (L1077-1081) — identical
  store.ts    # READ-ONLY (SnapshotStore interface — has() signature unchanged)
test/
  git.test.ts # EDIT: +1 "acquires the mutex" smoke test inside the GitBackend.has describe (L408)
  cas.test.ts # EDIT: +1 "acquires the mutex" smoke test inside CasBackend.has describe (L1498);
              #       fix L1550 test title + comment (drop the false "has is NOT serialized" claim)
```

### Desired Codebase tree with files to be changed

```bash
src/snapshot/git.ts   # MODIFIED — has() acquires+releases the mutex; has() JSDoc BUG-007 note (Mode A)
src/snapshot/cas.ts   # MODIFIED — same
test/git.test.ts      # MODIFIED — +1 smoke test (two concurrent has() both complete)
test/cas.test.ts      # MODIFIED — +1 smoke test; L1550 title + comment corrected
# (no new files; no store.ts/rewind.ts/capture.ts/config/marker changes)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — the catch stays BINDING-LESS. The existing has() catch is `catch {` (no `err`),
//   because has() is best-effort silent-false and does NOT log. dirtyCheck/restore catch `(err)` to
//   warn; has() does not. Do NOT add an `(err)` binding or a console.warn — that would change has()'s
//   best-effort contract. Keep `catch { return false; }`.

// CRITICAL #2 — release() MUST go in a `finally`. AsyncMutex GOTCHA #5 (cas.ts:678 JSDoc): a
//   forgotten release() deadlocks every later acquire(). The contract's shape is
//   `try{…} catch{return false;} finally{release();}` — the finally guarantees release even on the
//   catch's `return false` (finally runs before the return completes). Do NOT release() inside the
//   try or the catch alone.

// CRITICAL #3 — acquire BEFORE ensureInit, ensureInit INSIDE the try. Every sibling op
//   (capture/dirtyCheck/restore/retire/gc/changedPaths) does `const release = await
//   this.mutex.acquire(); try { await this.ensureInit(); …}`. ensureInit is idempotent + memoized
//   (initPromise) so calling it under the lock is safe and a no-op after the first capture. Do NOT
//   move ensureInit above the acquire.

// CRITICAL #4 — the "NOT mutex-serialized" JSDoc paragraph (git.ts:524-527, cas.ts:1077-1081) must
//   be REMOVED, not just appended-to. Leaving it would be a self-contradicting JSDoc. Replace it
//   with a sentence stating has() IS serialized per spec §4.3 (BUG-007). Mode A docs accuracy.

// CRITICAL #5 — cas.test.ts:1550 title + comment become FALSE. The test
//   `it("concurrent ops are serialized (max-in-flight 1) — has is NOT serialized", …)` and its
//   comment "has does NOT acquire it" are now wrong (has DOES acquire it). The BODY (fires only
//   capture/dirtyCheck/restore/retire, asserts maxInFlight===1) stays valid. Fix the title (drop
//   "— has is NOT serialized") + comment (drop the "has does NOT acquire it" clause). REQUIRED, not
//   optional — a test that lies in its title misleads every future reader/agent.

// GOTCHA #6 — the mutex is REAL in tests (test/git.test.ts L15 comment: "AsyncMutex: REAL"). Adding
//   the acquire does NOT break the 3 existing git has() tests or the 2 cas has() tests: they are
//   single-call, so acquire+release is instant with no contention. No mock of the mutex is needed
//   (and none exists).

// GOTCHA #7 — for the new git smoke test, ensureInit is memoized across the two concurrent has()
//   calls, so it issues its 2 rev-parse calls (show-toplevel, absolute-git-dir) only ONCE; the
//   `rev-parse --verify` is issued TWICE (once per has()). Filter `c.args[0]==="rev-parse" &&
//   c.args[1]==="--verify"` to get exactly 2 — the SAME filter the existing L412 test uses.

// GOTCHA #8 — has()'s return contract is UNCHANGED: still Promise<boolean>, still never rejects,
//   still false-on-any-error. The throwOn:{cmd:"rev-parse",call:3} fake in git.test.ts:423/428 still
//   works because the mutex adds NO git commands (the throw is the 3rd rev-parse = --verify). The
//   call-counts are identical pre/post fix.

// CONVENTION — both backends must use the IDENTICAL pattern (parity is called out in their existing
//   JSDocs: cas.ts says "parity with git.ts"). Keep them in lockstep: same comment text on the
//   acquire line, same JSDoc BUG-007 sentence, same try/catch/finally shape.
```

## Implementation Blueprint

### Data models and structure

No data-model change. No new types, no new exports, no interface change (SnapshotStore.has signature
is unchanged — still `has(ref: string): Promise<boolean>`). The `AsyncMutex` field already exists in
both backends (`private readonly mutex = new AsyncMutex()`). This is a body+JSDoc edit of one existing
method per file, plus two test additions and one test-title correction.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/snapshot/git.ts GitBackend.has() (L528-538) — add mutex acquire/release
  - FIND the has() method body (L528):
        async has(ref: string): Promise<boolean> {
          try {
            await this.ensureInit();
            await this.exec("git", ["rev-parse", "--verify", ref], this.shadowEnv());
            return true;
          } catch {
            // non-zero exit (missing ref ⇒ exit 128) or init failure ⇒ false. Never rejects.
            return false;
          }
        }
  - REPLACE with (the acquire line + the finally block are the ONLY structural changes; the body's
    two statements + the catch + its comment are preserved verbatim):
        async has(ref: string): Promise<boolean> {
          const release = await this.mutex.acquire(); // BUG-007: serialized per spec §4.3 (ALL store operations acquire the mutex)
          try {
            await this.ensureInit();
            await this.exec("git", ["rev-parse", "--verify", ref], this.shadowEnv());
            return true;
          } catch {
            // non-zero exit (missing ref ⇒ exit 128) or init failure ⇒ false. Never rejects.
            return false;
          } finally {
            release();
          }
        }
  - PRESERVE: the binding-less `catch {`; the existing inline comments; ensureInit INSIDE the try.
  - NAMING: `release` (matches every sibling op — do not rename).

Task 2: MODIFY src/snapshot/git.ts has() JSDoc (L524-527) — remove "NOT mutex-serialized" (Mode A)
  - FIND the JSDoc paragraph that begins (L524):
        * NOT mutex-serialized (spec §4.3 omits `has` from the serialized list — it is a fast read-only
        * existence check; serializing it would add latency to the cross-reload ref-honoring path for no
        * correctness benefit, since it writes nothing and mutates no state). BEST-EFFORT: never rejects.
  - REPLACE with a serialized-per-§4.3 note, e.g.:
        * Serialized by the per-backend AsyncMutex (spec §4.3 — EVERY store op acquires the mutex,
        * including `has`; BUG-007). `has()` is read-only but the prompt-boundary GC pass (gc()) and
        * destroy() ALSO acquire the mutex, so serializing `has` prevents it from observing a
        * half-deleted shadow repo (refs deleted but pre-prune, or mid fsRm). BEST-EFFORT: never rejects.
  - PRESERVE: the rest of the has() JSDoc (the `git rev-parse --verify <ref>` implementation note,
    the `ref` is-a-SHA note, exit-0⇒true / exit-128⇒false semantics).

Task 3: MODIFY src/snapshot/cas.ts CasBackend.has() (L1082-1091) + JSDoc (L1077-1081) — same as Tasks 1+2
  - FIND the has() body (L1082):
        async has(ref: string): Promise<boolean> {
          try {
            await this.fs.access(this.manifestPath(ref)); // rejects if absent
            return true;
          } catch {
            return false; // missing/corrupt ⇒ false. Never rejects.
          }
        }
  - REPLACE the body with (acquire + finally; body + catch preserved verbatim):
        async has(ref: string): Promise<boolean> {
          const release = await this.mutex.acquire(); // BUG-007: serialized per spec §4.3 (ALL store operations acquire the mutex)
          try {
            await this.fs.access(this.manifestPath(ref)); // rejects if absent
            return true;
          } catch {
            return false; // missing/corrupt ⇒ false. Never rejects.
          } finally {
            release();
          }
        }
  - REMOVE the "NOT mutex-serialized" JSDoc paragraph (L1077-1081) and replace with the same kind of
    serialized-per-§4.3 BUG-007 note as Task 2 (adapt "shadow repo"→"manifest dir" / "fsRm removes the
    manifest dir"). Keep the `@14 §2` tag if the existing JSDoc carries it.
  - PRESERVE: the `fs.access(manifestPath(ref))` implementation note; the `ref` is-a-manifest-label
    note; the catch comment.

Task 4: CORRECT test/cas.test.ts:1550 — the test title + comment are now false
  - FIND (L1550):
        it("concurrent ops are serialized (max-in-flight 1) — has is NOT serialized", async () => {
          // Use a fake that tracks in-flight concurrency via a counter. capture/dirtyCheck/restore/retire
          // all acquire the mutex; their bodies must never overlap. has does NOT acquire it.
  - REPLACE the title with (drop the false suffix):
        it("concurrent ops are serialized (max-in-flight 1) — capture/dirtyCheck/restore/retire", async () => {
  - REPLACE the comment's last sentence (drop "has does NOT acquire it."):
          // Use a fake that tracks in-flight concurrency via a counter. capture/dirtyCheck/restore/retire
          // all acquire the mutex; their bodies must never overlap. (has ALSO acquires the mutex — BUG-007;
          // see the dedicated has smoke test in the CasBackend.has describe.)
  - PRESERVE: the test BODY (the `wrap`/`inFlight`/`maxInFlight` instrumentation, the 4-op
    `Promise.all`, the `expect(maxInFlight).toBe(1)` assertion) — UNCHANGED. Only the title + comment.

Task 5: ADD a "acquires the mutex" smoke test to test/git.test.ts — inside the GitBackend.has describe (L408)
  - ADD after the existing 3 has tests (after L428), mirroring the changedPaths idiom (L400):
        it("acquires the mutex (two concurrent both complete — §4.3 / BUG-007)", async () => {
          const calls: Call[] = [];
          const gb = makeBackend(calls);
          // two concurrent has() must BOTH resolve — a forgotten release() (GOTCHA #5) would deadlock
          // the 2nd acquire forever. Both issuing rev-parse --verify proves acquire+release each.
          await Promise.all([gb.has("COMMIT456"), gb.has("COMMIT456")]);
          const verify = calls
            .filter((c) => c.args[0] === "rev-parse")
            .filter((c) => c.args[1] === "--verify");
          expect(verify).toHaveLength(2); // both ran (mutex acquired + released per call)
        });
  - COVERAGE: proves has() now acquires AND releases the mutex (no deadlock ⇒ release() ran). Uses the
    SAME rev-parse --verify filter as the existing L412 test.

Task 6: ADD a "acquires the mutex" smoke test to test/cas.test.ts — inside the CasBackend.has describe (L1498)
  - ADD after the existing 2 has tests (after L1510), mirroring the cas L1263 idiom:
        it("acquires the mutex (two concurrent both complete — §4.3 / BUG-007)", async () => {
          const state = makeStateFs("/ws", "/store", { "a.ts": Buffer.from("a") });
          const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
          await cb.capture("turn", ["a.ts"]); // write manifests/turn.json so has()→true
          // two concurrent has() must BOTH resolve — a forgotten release() (GOTCHA #5) would deadlock
          // the 2nd acquire forever. (BUG-007: has now serializes like every other store op.)
          await Promise.all([cb.has("turn"), cb.has("turn")]);
          expect(await cb.has("turn")).toBe(true); // sanity: the manifest is still readable
        });
  - COVERAGE: proves has() now acquires AND releases the mutex (no deadlock ⇒ release() ran).

Task 7 (OUT OF SCOPE — do NOT do): NO SnapshotStore/store.ts change (has() signature unchanged). NO
  rewind.ts / capture.ts / config / marker change. NO change to capture()/restore()/dirtyCheck()/
  retire()/gc()/destroy() in either backend (those already acquire the mutex). NO edit to git.ts gc()
  (BUG-006 / P1.M5.T2.S1 owns it) or to capture()/restore() note logic (BUG-005 / P1.M5.T1.S1 owns
  it). If `git diff --name-only` shows anything beyond {src/snapshot/git.ts, src/snapshot/cas.ts,
  test/git.test.ts, test/cas.test.ts}, STOP and revert those hunks.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the EXACT has() transformation (git.ts; cas.ts is structurally identical, swap the inner
//   exec line for fs.access). BEFORE:
//     async has(ref: string): Promise<boolean> {
//       try {
//         await this.ensureInit();
//         await this.exec("git", ["rev-parse", "--verify", ref], this.shadowEnv());
//         return true;
//       } catch {
//         // non-zero exit (missing ref ⇒ exit 128) or init failure ⇒ false. Never rejects.
//         return false;
//       }
//     }
//   AFTER (only the acquire line + the finally block are added; the body + catch are unchanged):
//     async has(ref: string): Promise<boolean> {
//       const release = await this.mutex.acquire(); // BUG-007: serialized per spec §4.3 (ALL store operations acquire the mutex)
//       try {
//         await this.ensureInit();
//         await this.exec("git", ["rev-parse", "--verify", ref], this.shadowEnv());
//         return true;
//       } catch {
//         // non-zero exit (missing ref ⇒ exit 128) or init failure ⇒ false. Never rejects.
//         return false;
//       } finally {
//         release();
//       }
//     }

// PATTERN — the "acquires the mutex" smoke test (git; cas mirror is in the PRP Task 5/6). Two
//   concurrent calls must BOTH resolve (forgotten release ⇒ 2nd acquire deadlocks) AND both run
//   their side effect:
//     await Promise.all([gb.has("COMMIT456"), gb.has("COMMIT456")]);
//     const verify = calls.filter((c) => c.args[0] === "rev-parse" && c.args[1] === "--verify");
//     expect(verify).toHaveLength(2); // both ran ⇒ mutex acquired + released per call

// CRITICAL — the catch's `return false` STILL triggers the finally. JS semantics: when a catch
//   block `return`s, the finally runs before the function actually returns. So `release()` is called
//   on the false-path too. This is why the contract specifies `try{…} catch{return false;}
//   finally{release();}` (release in finally, NOT in the catch). A release() only inside the try
//   would leak the lock on the rev-parse/access rejection path.

// CRITICAL — has() is STILL best-effort and STILL never rejects. The mutex adds latency (has now
//   waits for any in-flight capture/restore/gc) but no behavioral change to the boolean it returns.
//   The cross-reload ref-honoring caller (session_start rebuild, BUG-002) is unaffected — it calls
//   has() once per rebuilt snapshot, not in a hot loop.
```

### Integration Points

```yaml
MUTEX (src/snapshot/git.ts + src/snapshot/cas.ts):
  - change: "has() acquires this.mutex and releases in a finally — the 7th store op to do so"
  - contract: spec/14 §4.3 "ALL store operations (capture/dirtyCheck/restore/retire/gc)" now literally
      includes has() — the deviation is closed.
HAS JSDOC (src/snapshot/git.ts:524-527 + src/snapshot/cas.ts:1077-1081):
  - change: "remove the 'NOT mutex-serialized' paragraph; add the BUG-007 serialized-per-§4.3 note"
SNAPSHOTSTORE (src/snapshot/store.ts): UNCHANGED — has(ref): Promise<boolean> signature unchanged.
CALLERS (src/index.ts session_start rebuild, src/tools/rewind.ts): UNCHANGED — has() return contract
  is identical (boolean, best-effort); it just now serializes.
TESTS (test/git.test.ts + test/cas.test.ts):
  - add: one "acquires the mutex" smoke test in each has describe.
  - correct: test/cas.test.ts:1550 title + comment (drop the false "has is NOT serialized" claim).
PARALLEL ITEMS: NO overlap — BUG-005 (capture/restore note logic), BUG-006 (git.ts gc()) edit
  disjoint methods; no shared mutable state at the edit sites.
CONFIG / DATABASE / ROUTES / MARKER-SCHEMA: none.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (adding acquire/release is type-clean: release is `() => void`,
# assignable in a finally block; has() already returns Promise<boolean>).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.

# Confirm scope:
git diff --name-only
# EXPECTED: exactly { src/snapshot/git.ts, src/snapshot/cas.ts, test/git.test.ts, test/cas.test.ts }.
# If src/snapshot/store.ts, src/tools/rewind.ts, src/capture.ts, src/index.ts appears → OUT OF SCOPE;
#   revert those hunks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the edited test files (new tests + all existing has/mutex tests must pass).
npx vitest run test/git.test.ts test/cas.test.ts -v
# Expected: green. The 2 new "acquires the mutex" smoke tests pass (two concurrent has() both resolve,
#   both run their side effect ⇒ mutex acquired + released). The existing has tests (git L412/423/428,
#   cas L1503/1509) stay green (single-call → acquire+release instant, no contention; the throwOn
#   call-counts are unaffected because the mutex adds NO git/fs commands). The corrected cas.test.ts:1550
#   test stays green (its BODY assertion maxInFlight===1 is unchanged). The git mutex-serialization
#   test (L298) + the cas mutex-parity describe (L1547) stay green (they fire capture/…/retire, not has).

# If the new smoke test HANGS — you forgot `release()` in the finally (GOTCHA #5). The 2nd has() is
#   deadlocked on acquire(). Add the `finally { release(); }`.

# If the new smoke test fails with verify.length !== 2 — ensureInit is memoized so it runs once; check
#   your filter is `c.args[0]==="rev-parse" && c.args[1]==="--verify"` (not just args[0]==="rev-parse",
#   which would also count the 2 ensureInit rev-parse calls).

# Full snapshot + integration suite (no behavioral regression):
npx vitest run test/git.test.ts test/cas.test.ts test/integration/revert-*.test.ts
# Expected: green. (Integration tests exercise the rewind-tool↔store path; has()'s return contract
# is unchanged, only its locking, so they are unaffected.)
```

### Level 3: Integration Testing (System Validation)

```bash
# The unit tests in Level 2 ARE the system validation (they drive the REAL AsyncMutex + the REAL
# has() through the DI-seam fake for the acquire/release round-trip). No separate system test needed.

# OPTIONAL end-to-end sanity (NOT a required gate): in a scratch repo with revert enabled, drive a
# turn (turn_start → gc + capture) and, in parallel from another async path, call store.has(ref). With
# this fix, has() waits for the mutex instead of racing gc()/destroy(); without it, has() could
# transiently read a half-deleted shadow repo. (Manual/concurrency-stress confirmation; the unit smoke
# tests are sufficient proof for the gate.)
```

### Level 4: Creative & Domain-Specific Validation (correctness reasoning)

```bash
# Reasoning check (no command — the invariant this item establishes):
#   Serialization: has() now acquires the same per-instance mutex as capture/dirtyCheck/restore/retire/
#     gc/destroy/changedPaths. Two store ops can NEVER overlap. The §4.3 "ALL store operations"
#     contract is now literally true. ✓
#   Race closed: has() can no longer observe gc()'s intermediate state (refs deleted, pre-prune) or
#     destroy()'s mid-fsRm — it waits for the mutex, then reads a quiescent store. ✓
#   Best-effort preserved: has() still returns Promise<boolean>, still never rejects, still false on
#     any error. The mutex catch path still `return false` and the finally STILL runs (JS: a catch
#     `return` executes the finally first) so release() is called on the false-path. ✓
#   No deadlock: the new smoke tests fire two concurrent has() and assert both resolve — a forgotten
#     release would deadlock the 2nd forever. ✓
#   No regression: the mutex adds NO git/fs commands, so the existing has tests' throwOn call-counts
#     and the mutex-serialization/parity tests' assertions are unaffected. ✓
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck`: 0 errors.
- [ ] `npx vitest run test/git.test.ts test/cas.test.ts`: green (new + existing).
- [ ] `npx vitest run test/integration/revert-*.test.ts`: green (no consumer regression).
- [ ] `npm test`: full suite green.
- [ ] `git diff --name-only` shows ONLY the 4 in-scope files.

### Feature Validation

- [ ] `GitBackend.has()` (git.ts:528) acquires `this.mutex`, runs the body under the lock, `release()`s
      in a `finally`; the catch stays binding-less `catch { return false; }`.
- [ ] `CasBackend.has()` (cas.ts:1082) — identical structure.
- [ ] Both has() JSDocs: "NOT mutex-serialized" paragraph REMOVED; BUG-007 + spec §4.3 serialization
      note ADDED (Mode A).
- [ ] Both acquire lines carry: "BUG-007: serialized per spec §4.3 (ALL store operations acquire the mutex)".
- [ ] test/cas.test.ts:1550 title no longer claims has is unserialized; comment no longer says "has
      does NOT acquire it".
- [ ] New git smoke test: two concurrent has() both resolve + both issued `rev-parse --verify`.
- [ ] New cas smoke test: two concurrent has() both resolve (no deadlock).

### Code Quality Validation

- [ ] The acquire/release shape EXACTLY matches dirtyCheck/restore (acquire-first, ensureInit-inside-
      try, finally-release) — no new locking idiom invented.
- [ ] The catch remains binding-less and silent (has() does NOT log) — best-effort contract preserved.
- [ ] No new git/fs commands added inside has() (only acquire + finally) → existing tests unaffected.
- [ ] Both backends use the IDENTICAL pattern + comment text (parity, as their JSDocs promise).
- [ ] No edit to store.ts / rewind.ts / capture.ts / index.ts / config / marker (scope respected).
- [ ] No edit to capture()/restore()/dirtyCheck()/retire()/gc()/destroy() (BUG-005/BUG-006 scope).

### Documentation & Deployment

- [ ] has() JSDoc updated in BOTH backends (Mode A) — BUG-007 + spec §4.3 serialization compliance.
- [ ] cas.test.ts:1550 title + comment corrected (test no longer makes a false claim).
- [ ] No config / env-var / API-surface / marker-schema change.

---

## Anti-Patterns to Avoid

- ❌ **Don't release() only inside the try or the catch.** The contract is `finally { release(); }`.
  JS guarantees the finally runs on the catch's `return false` (before the function returns). A
  release() only in the try leaks the lock on the rev-parse/access rejection path; one only in the
  catch leaks it on the success path. AsyncMutex GOTCHA #5: a leaked lock deadlocks every later
  acquire() — which would hang the new smoke tests (and, in production, hang the whole store).
- ❌ **Don't add `(err)` to the catch or a console.warn.** has() is best-effort silent-false — it does
  NOT log (unlike dirtyCheck/restore which catch `(err)` to warn). Keep the binding-less `catch {`.
  Adding logging changes the best-effort contract and would spam on every cross-reload `has` of a
  retired ref.
- ❌ **Don't move ensureInit above the acquire, or drop it from the try.** Every sibling op does
  acquire-then-ensureInit-inside-try; ensureInit is idempotent + memoized so it is safe under the
  lock. Reordering breaks parity and risks calling ensureInit unlocked.
- ❌ **Don't rewrite has()'s body or change its return contract.** This is a locking fix: the two
  inner statements (`git rev-parse --verify` / `fs.access`) and the `return true`/`return false` are
  preserved verbatim. has() still returns Promise<boolean>, still never rejects.
- ❌ **Don't leave the "NOT mutex-serialized" JSDoc paragraph in place.** It is now a lie. Mode A
  requires removing it and documenting BUG-007 + spec §4.3. A self-contradicting JSDoc is worse than
  no JSDoc — every future reader/agent would be misled into thinking has() is deliberately
  unserialized.
- ❌ **Don't skip the test/cas.test.ts:1550 correction.** That test's title asserts "has is NOT
  serialized" and its comment says "has does NOT acquire it" — both now false. Leaving them makes the
  suite internally inconsistent with the production code. Fix the title + comment (the BODY assertion
  stays valid).
- ❌ **Don't invent a new test idiom.** The codebase already has a standard "acquires the mutex"
  smoke test (git.test.ts:400/542, cas.test.ts:1263): two concurrent calls, assert both resolve + both
  ran their side effect. Mirror it verbatim. A custom concurrency probe (inFlight counter on fs.access)
  is overkill for a 0.5-point locking fix and risks flakiness.
- ❌ **Don't edit git.ts gc(), capture(), restore(), cas.ts capture()/restore(), store.ts, rewind.ts,
  or capture.ts.** Those are owned by the parallel BUG-005/BUG-006 items or are out of scope. This
  item touches ONLY has() (both backends) + the 2 test files. If your diff shows more, revert.
- ❌ **Don't make the two backends diverge.** Their JSDocs explicitly promise "parity with git.ts".
  Use the SAME acquire-line comment, the SAME try/catch/finally shape, and a parallel JSDoc note in
  both.

---

## Confidence Score

**9/10** — This is a one-method-per-file locking fix (acquire + finally) plus a one-sentence JSDoc
rewrite in each, a test-title correction, and two small smoke tests, where: (a) the defect is
grep-verified (has() is the ONLY store op without the mutex — every sibling op's acquire line is
cited); (b) the exact current source of both has() bodies + JSDocs is reproduced verbatim in the
research notes, so the edit is mechanical (insert acquire line, wrap in finally, swap one JSDoc
paragraph); (c) the target shape is pinned by the work item's explicit contract
(`const release = await this.mutex.acquire(); try{…} catch{return false;} finally{release();}`) and
matches the canonical dirtyCheck pattern line-for-line; (d) the mutex is REAL and already constructed,
so the change is type-clean and adds NO git/fs commands (existing tests' throwOn call-counts and the
mutex-serialization/parity assertions are unaffected); (e) the test design is the verbatim established
"acquires the mutex" idiom with assertable side effects (2× `rev-parse --verify` for git; both-resolve
for cas), and the one test that becomes false (cas.test.ts:1550) is identified with the exact title/
comment to correct. The one residual risk: a merge adjacency flag with the parallel BUG-006 item (both
edit git.ts) — but the hunks are disjoint (has() at L528 vs gc() at L636, ~108 lines apart, different
methods, no shared mutable state) so there is no logical conflict and a trivial textual resolve if
flagged. No upstream coordination needed (store.ts/rewind.ts/capture.ts/index.ts unchanged).

---