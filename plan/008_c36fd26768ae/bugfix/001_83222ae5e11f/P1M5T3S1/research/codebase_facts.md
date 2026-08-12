# Codebase Facts — P1.M5.T3.S1 (BUG-007: mutex-serialize has())

All facts below were grep/read-verified against the working tree at research time. Line numbers are
current (they DIFFER from the item description's "~560"/"~855" estimates — use these).

## 1. The two `has()` targets (exact current source)

### GitBackend.has() — src/snapshot/git.ts:520-538 (method body L528-538)

JSDoc (L520-527) currently ENDS with this paragraph (the text to remove in Mode A):
```
 * NOT mutex-serialized (spec §4.3 omits `has` from the serialized list — it is a fast read-only
 * existence check; serializing it would add latency to the cross-reload ref-honoring path for no
 * correctness benefit, since it writes nothing and mutates no state). BEST-EFFORT: never rejects.
```
Method body (L528-538) — NO mutex:
```ts
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
```

### CasBackend.has() — src/snapshot/cas.ts:1077-1091 (method body L1082-1091)

JSDoc (L1077-1081) currently ENDS with this paragraph (the text to remove in Mode A):
```
 * NOT mutex-serialized (spec §4.3 omits `has` from the serialized list — parity with git.ts — it
 * is a fast read-only existence check; serializing it would add latency to the cross-reload
 * ref-honoring path for no correctness benefit, since it writes nothing and mutates no state).
 * BEST-EFFORT: never rejects. @14 §2.
```
Method body (L1082-1091) — NO mutex:
```ts
  async has(ref: string): Promise<boolean> {
    try {
      await this.fs.access(this.manifestPath(ref)); // rejects if absent
      return true;
    } catch {
      return false; // missing/corrupt ⇒ false. Never rejects.
    }
  }
```

## 2. The mutex field + the reference acquire/release pattern

- Field declaration (identical in both): `private readonly mutex = new AsyncMutex();`
  - git.ts:206, cas.ts: (search `private readonly mutex`).
  - `AsyncMutex` imported from the shared `./store.js` (git.ts:13 `AsyncMutex,`).
- Reference pattern — EVERY other store op uses this EXACT structure. Canonical example:
  `GitBackend.dirtyCheck` (git.ts:426-455):
```ts
  async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
    const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
    try {
      await this.ensureInit();
      // ... work ...
    } catch (err) {
      // best-effort: return safe default
      return [];
    } finally {
      release(); // AsyncMutex GOTCHA #5 — forgotten release deadlocks all later acquire()s
    }
  }
```
- `capture` (git.ts:323 / cas.ts:555), `restore` (git.ts:703 / cas.ts:971), `retire`
  (git.ts:556 / cas.ts:1103), `destroy` (git.ts:603 / cas.ts:1132), `gc` (git.ts:637 /
  cas.ts:1162), `changedPaths` (BUG-004, git.ts:491 / cas.ts:859) ALL follow this pattern.
- `has()` is the ONLY store op that does NOT. (grep `async has` + `mutex.acquire` confirms.)

## 3. The exact transformation (the contract's prescribed shape)

The work item prescribes:
> wrap the body in `const release = await this.mutex.acquire(); try { ... existing body ... }
> catch { return false; } finally { release(); }`. Remove the 'NOT mutex-serialized' comment and
> replace with a comment: 'BUG-007: serialized per spec §4.3 (ALL store operations acquire the mutex).'

Resulting git.ts.has() (body):
```ts
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
```
Resulting cas.ts.has() (body):
```ts
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
```
NOTE: `catch` keeps its EXISTING binding-less form (`catch {`) — has() does NOT log (best-effort
silent false), unlike dirtyCheck/restore which catch `(err)` to warn. Keep the existing inline
comments verbatim; only ADD the acquire line + the finally block.

## 4. ensureInit ordering — SAFE to acquire-before-ensureInit

All sibling ops acquire the mutex FIRST, then call `await this.ensureInit()` INSIDE the try.
`ensureInit()` is idempotent + memoized (`initPromise`) — safe to call under the lock; it is a
no-op after the first capture. Placing `this.mutex.acquire()` before `this.ensureInit()` (as the
contract specifies) matches capture/dirtyCheck/restore/retire/gc exactly. Do NOT re-order.

## 5. Existing has() tests (must stay green + one must be corrected)

### git.test.ts — `describe("GitBackend.has — spec/14 §2", ...)` at L408
- L412 `it("issues git rev-parse --verify <ref> ...; exit0⇒true")` — `gb.has("COMMIT456")` → true;
  filters `calls.filter(c => c.args[0]==="rev-parse").find(c => c.args[1]==="--verify")`.
- L423 `it("returns false when rev-parse --verify rejects (missing ref ⇒ exit 128)")` — uses
  `{ throwOn: { cmd: "rev-parse", call: 3 } }` (the 3rd rev-parse = --verify).
- L428 `it("never rejects")` — same throwOn, asserts `.resolves.toBe(false)`.
- These are UNAFFECTED by adding the mutex (single-call, no contention → acquire+release cleanly).
  The throwOn call-counts are unaffected (mutex adds NO git commands).

### cas.test.ts — `describe("CasBackend.has — spec/14 §2", ...)` at L1498
- L1503 `it("returns true for an existing manifest ref")` — capture("turn",["a.ts"]) then
  `cb.has("turn")` → true.
- L1509 `it("returns false for a missing ref; never rejects")` — `cb.has("turn")` → false.
- UNAFFECTED by the mutex (single-call).

### ⚠️ cas.test.ts:1550 — TITLE + COMMENT are now FACTUALLY WRONG (must be corrected)
```ts
  it("concurrent ops are serialized (max-in-flight 1) — has is NOT serialized", async () => {
    // Use a fake that tracks in-flight concurrency via a counter. capture/dirtyCheck/restore/retire
    // all acquire the mutex; their bodies must never overlap. has does NOT acquire it.
```
- The BODY fires only `capture/dirtyCheck/restore/retire` (NOT has) and asserts `maxInFlight===1`.
- After BUG-007, `has` IS serialized. The title suffix "— has is NOT serialized" and the comment
  clause "has does NOT acquire it" become FALSE. The body's assertion (maxInFlight===1 for the 4
  ops) REMAINS VALID. So: fix the TITLE (drop "— has is NOT serialized") + the COMMENT (drop/rewrite
  the "has does NOT acquire it" clause). No assertion change required.
- This is a Mode-A docs-accuracy requirement, not optional.

## 6. The "acquires the mutex" smoke-test idiom (exact, from existing tests)

The codebase's standard proof that an op acquires+releases the mutex: fire TWO concurrent calls and
assert BOTH complete (a forgotten `release()` would deadlock the 2nd forever) + BOTH ran their side
effect. Examples to mirror:
- git.test.ts:400 — `it("acquires the mutex (two concurrent both complete — §4.3)")` for changedPaths:
  `await Promise.all([gb.changedPaths("B1"), gb.changedPaths("B2")]); expect(calls.filter(c=>c.args[0]==="diff")).toHaveLength(2);`
- git.test.ts:542 — `it("acquires the mutex (serialized with capture/restore/retire — §4.3)")` for gc:
  `await Promise.all([gb.gc(), gb.gc()]);` then assert both ran for-each-ref.
- cas.test.ts:1263 — `it("acquires the mutex (two concurrent calls both complete — §4.3)")` with
  comment "two concurrent calls must both resolve (no deadlock from a forgotten release)".

New has() smoke tests follow this idiom verbatim (see PRP Task 3 & 4).

## 7. Test DI seams (verbatim — reuse these helpers)

- git.test.ts: `makeBackend(calls, cfg=BASE_CFG, scan=emptyScan, canned={})` builds a GitBackend with
  a recording `GitExec` fake (`makeExec`). `findCmd(calls, "<cmd>")` returns the first matching call.
  Canned: commit-tree→"COMMIT456", write-tree→"TREE123", rev-parse→"/fake/repo" + "/fake/repo/.git",
  unknown→"". The mutex is REAL (test L15 comment). ensureInit is memoized → across 2 concurrent has()
  calls ensureInit runs ONCE, so exactly 2 `rev-parse --verify` calls are recorded.
- cas.test.ts: `makeStateFs("/ws","/store",{<files>})` → state with `state.fakeFs`; `makeStateBackend
  (state, cfg)` → CasBackend. capture("turn",["a.ts"]) writes manifests/turn.json so has()→true.

## 8. Scope / non-conflict with parallel items

- BUG-006 (P1.M5.T2.S1) edits git.ts `gc()` body (~L636, ~80 lines below has()) — disjoint method,
  no shared mutable state at the edit sites, no textual overlap. Safe to merge.
- BUG-005 (P1.M5.T1.S1) edits git.ts capture()/restore() note logic (~L377, ~650) and cas.ts capture/
  restore — also disjoint from has() (different methods). No conflict with this item.
- This item edits: `has()` body + JSDoc in git.ts and cas.ts; one test title/comment in cas.test.ts;
  adds one smoke test each in git.test.ts and cas.test.ts. NOTHING else.

## 9. Validation commands (verified present in package.json)

- `npm run typecheck` → `tsc --noEmit` (zero errors expected — adding acquire/release is type-clean;
  `release` is `() => void`, assignable in finally).
- `npx vitest run test/git.test.ts test/cas.test.ts -v` → the snapshot unit suites.
- `npm test` → `vitest run` (full suite, 1277+ tests).
- `git diff --name-only` → expect exactly {src/snapshot/git.ts, src/snapshot/cas.ts,
  test/git.test.ts, test/cas.test.ts}.