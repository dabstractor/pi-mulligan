---
name: "P1.M4.T1.S3 — Implement changedPaths in CasBackend (manifest hash-compare) (BUG-004 cas slice)"
description: |
  Implement the `changedPaths(beforeRef: string): Promise<string[]>` method on `CasBackend` in
  src/snapshot/cas.ts. It returns the workspace-relative POSIX paths that differ between the
  `beforeRef` manifest and the CURRENT working tree — exactly the set `restore()` would touch — the
  spec-mandated affected set for the dirty guard (spec/14 §6 step 2, BUG-004). It is MODE-AWARE:
  `'cas'` mode walks the tree (walkTree) and hash-compares each file vs the manifest, plus flags
  manifest entries now missing; `'explicit-paths'` mode checks only the manifest entries' paths (no
  tree walk — conservative, the manifest is the scope). It mirrors `dirtyCheck`'s EXACT
  try/catch/finally/mutex structure, is mutex-serialized (spec §4.3), and is BEST-EFFORT (never
  rejects → `[]`). It resolves the `CasBackend` 'missing changedPaths' typecheck error produced by
  P1.M4.T1.S1 (the cas.ts TS2420). NO GitBackend (S2 — already implemented per its PRP contract),
  NO NoOpStore (S1), NO rewind wiring (P1.M4.T2.S1). Mode A (method + JSDoc + unit tests only).

  PARALLEL CONTEXT: S2 (GitBackend.changedPaths) is being implemented in parallel. Treat its PRP as a
  CONTRACT — assume it lands its `git.ts` fix. This item resolves the remaining `cas.ts` TS2420 so the
  final typecheck state is 0 errors. The double-casts S1 added (`as unknown as CasBackend`) are
  typecheck-clean before AND after this item — do NOT touch them.
---

## Goal

**Feature Goal**: Implement the **CasBackend** half of the BUG-004 contract method `changedPaths(beforeRef)`.
`CasBackend.changedPaths` returns the **workspace-relative POSIX paths that differ between the
`beforeRef` snapshot manifest and the CURRENT working tree** — exactly the set `restore()` would touch.
This is the **spec-mandated affected set** for the dirty guard (spec/14 §6 step 2, BUG-004). It is the
content-addressed (cas) slice of milestone P1.M4.T1: it consumes the interface method that
P1.M4.T1.S1 declared on `SnapshotStore`, implements the manifest hash-compare algorithm, and resolves
the resulting `CasBackend` typecheck failure.

**Deliverable**:
1. `src/snapshot/cas.ts` MODIFIED — add ONE method `async changedPaths(beforeRef: string):
   Promise<string[]>` to the `CasBackend` class, placed **immediately after `dirtyCheck()` and before
   `restore()`'s JSDoc** (matches the interface order in store.ts: dirtyCheck → changedPaths → restore;
   mirrors S2's GitBackend placement). Dense JSDoc citing spec/14 §6 step 2 (verbatim quote) + BUG-004,
   ending with the footer `IMPLEMENTED BY: git/cas.` (matching the interface method footer).
2. `test/cas.test.ts` MODIFIED — add a new `describe("CasBackend.changedPaths — spec/14 §6 step 2 /
   BUG-004")` block (≥7 tests covering BOTH modes: `'cas'` tree-walk + `'explicit-paths'` manifest-only,
   plus missing/corrupt manifest, best-effort never-rejects, dangerous-path skip, mutex smoke). Mirror
   the existing `describe("CasBackend.dirtyCheck — spec/14 §6 step 3 + §2")` block.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`): the **CasBackend** `src/snapshot/cas.ts` "Property
  'changedPaths' is missing" error (produced by S1) is now **GONE**. **0 typecheck errors remain**
  (assuming S2 landed its `git.ts` fix — see Validation). If a `git.ts` TS2420 still appears, that is
  S2 in-flight, NOT a defect in this item — verify with `grep -n "async changedPaths" src/snapshot/git.ts`.
- `npx vitest run test/cas.test.ts`: green, including the new `CasBackend.changedPaths` describe block.
- `npm test` (full suite): green (no behavioral regression — `changedPaths` is not yet called by
  production code; the rewind wiring is P1.M4.T2.S1).

## Why

- **Closes the cas-backend half of the BUG-004 contract gap**: the rewind tool's dirty guard currently
  uses `affectedPaths = ledger.modifiedFiles` (src/tools/rewind.ts:849), a HEURISTIC extraction that
  MISSES files mutated via `python -c`, `node script.js`, `perl -i`, heredocs, `awk -i inplace`, etc.
  (they land in `ledger.bashSideEffects`, not `modifiedFiles`). `restore()` reverts EVERY file differing
  from beforeRef — in cas mode that is EVERY manifest entry PLUS the 'cas'-mode tree-walk delete of
  present-not-in-manifest files. So the guard inspects a SUBSET of what restore touches → concurrent
  human edits to bash/python/perl-written files are silently clobbered (E30 violation — "never silently
  clobbers concurrent edits"). The fix requires the STORE to compute the real affected set. This item
  implements the **cas** algorithm (manifest hash-compare + 'cas'-mode tree walk); S2 implemented the
  git algorithm; P1.M4.T2.S1 does the rewind wiring.
- **Resolves the S1 handoff**: P1.M4.T1.S1 widened the `SnapshotStore` interface with `changedPaths`,
  which made `CasBackend implements SnapshotStore` typecheck-fail (expected). S3 fulfills the contract
  on CasBackend so the cas backend is again type-clean and the codebase-wide typecheck reaches 0 errors.
- **No behavior change in this slice**: `changedPaths` is added to the class but NOT yet called by any
  production code path (rewind.ts still uses `ledger.modifiedFiles` until P1.M4.T2.S1). Zero runtime
  risk to existing users; the method simply exists + is unit-tested.

## What

One surgical insertion of a method (with JSDoc) into `src/snapshot/cas.ts`, immediately after
`dirtyCheck()` and before `restore()`'s JSDoc, cloning `dirtyCheck`'s structure and adding the
mode-dispatch + 'cas'-mode tree walk. Plus a new `describe("CasBackend.changedPaths …")` test block in
`test/cas.test.ts` mirroring the existing `describe("CasBackend.dirtyCheck …")` block. No data-model
change, no new exports, no config, no API-surface change beyond the added class method.

**Mode-aware behavior** (the core contract):

| mode (`cfg.nonGitMode`) | scope | changed if … |
|---|---|---|
| `'cas'` (default) | whole tree (walkTree) | file present in tree but NOT in manifest (created since); OR in manifest AND current hash ≠ stored hash (modified); OR in manifest `existed:true` but now MISSING (deleted since) |
| `'explicit-paths'` | manifest entries only (NO walk) | entry's current hash ≠ stored hash (modified/created); OR entry `existed:true` but now MISSING (deleted since) |

### Success Criteria

- [ ] `CasBackend` has `async changedPaths(beforeRef: string): Promise<string[]>` placed after
      `dirtyCheck()` and before `restore()`'s JSDoc, with JSDoc covering all required points (see Task 1).
- [ ] The method acquires `this.mutex` (spec §4.3) and `release()`s in `finally` (AsyncMutex GOTCHA #5).
- [ ] `'cas'` mode: `walkTree(this.cwd, excludeSet, …)` hashes each file + compares to manifest, flags
      new/modified; then a second loop flags manifest `existed:true` entries now missing. Returns the union.
- [ ] `'explicit-paths'` mode: iterates `Object.entries(manifest.files)`, hashes each current file,
      flags modified/created (hash differs) or deleted (`existed:true` + now gone). NO tree walk.
- [ ] Missing/corrupt beforeRef manifest ⇒ `[]` (best-effort — same try/catch as dirtyCheck).
- [ ] Any thrown error ⇒ warn + `[]` (E27 best-effort, never rejects — outer catch).
- [ ] Deliberately NO mtime/size short-circuit (a content mutation that preserves mtime must NOT be
      missed — E30 correctness mandate; the sibling dirtyCheck also does full hashing).
- [ ] `npm run typecheck`: 0 errors (cas.ts error gone; git.ts resolved by S2). No TS2352 cast errors.
- [ ] `test/cas.test.ts` has a new `CasBackend.changedPaths` describe block (≥7 tests, BOTH modes) — all pass.
- [ ] `npm test` fully green.
- [ ] NO changes to `store.ts`, `git.ts`, `rewind.ts`, `capture.ts`, `RestoreOpts`, `RestoreResult`,
      `AsyncMutex`, `detectAndCreate`, markers, or config. NO new exported types. The 4 `as unknown as
      CasBackend` casts (added by S1) are UNTOUCHED.

## All Needed Context

### Context Completeness Check

_Passed_: an engineer with zero prior knowledge of this repo can implement this from (a) the verbatim
`dirtyCheck` method to clone (quoted in Implementation Patterns), (b) the mode-dispatch table above,
(c) the verbatim 'cas'-mode tree-walk pattern (quoted from `restore()`), (d) the two test-helper
families and which to use per mode (confirmed empirically — `makeStateFs`'s `readdir` THROWS so it
cannot drive a 'cas' walk; `makeTreeFs` supports `readdir`), (e) the exact typecheck outcome (0 errors),
and (f) the spec verbatim quote. The single non-obvious decision — that NO mtime/size short-circuit may
be used — is called out repeatedly (it would re-open the E30 hole).

### Documentation & References

```yaml
# MUST READ — the spec the new method's JSDoc + behavior cites
- url: spec/14-working-tree-revert.md (§6 step 2 — the affected-set definition, VERBATIM; §4.3
    AsyncMutex serialization; §4.2 the two non-git capture modes this method must mirror; §2 interface)
  why: §6 step 2 VERBATIM defines the affected set the method must return:
    "**Determine the affected set** = paths that differ between `beforeRef` and the current tree
    (the files restore would touch)."
  critical: §4.3 mandates every IO-bearing store op is AsyncMutex-serialized → changedPaths MUST
    acquire this.mutex. §4.2 defines the two modes: 'cas' = whole-tree; 'explicit-paths' = only the
    write/edit tool paths. changedPaths must be mode-aware in EXACTLY the same way capture()/restore()
    are (capture dispatches on nonGitMode; restore's deleteCreatedFiles walk is gated on nonGitMode==='cas').

# MUST READ — root-cause + exact change sites
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-004 (Major): Dirty guard affected-set uses heuristic ledger"
  why: confirms the cas algorithm: "CasBackend: hash-compare the beforeRef manifest entries vs current
    file hashes" + "also detect new files not in manifest". Lists Exact Change Site #3 =
    "src/snapshot/cas.ts — implement: load beforeRef manifest, for each entry compare current hash vs
    stored hash; also detect new files not in manifest". This item does exactly that and nothing more.
  critical: rewind.ts (Change Site #4) is P1.M4.T2.S1 — NOT this item.

- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/system_context.md
  why: the SnapshotStore contract + the S1→S2→S3 rollout ordering + the RevertCheckpoint/CasManifest
    data structures + the mode semantics.

- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/codebase_patterns.md
  section: §2 (AsyncMutex pattern — acquire/try/catch-best-effort-default/finally-release; GOTCHA #5
    forgotten release deadlocks), §3 (best-effort fail-open — never reject → []), §8 (vitest DI test
    convention), §10 (dense JSDoc/comment style)
  why: §2 + §3 are the verbatim patterns the method body follows. §8 is the test convention.

# PRIMARY TARGET FILE
- file: src/snapshot/cas.ts
  why: THE file to edit. Contains the `CasBackend` class. `dirtyCheck()` is the EXACT structural
    template to clone (mutex/try/catch/finally/manifest-read/parseManifest/isDangerousWorkspaceRel/
    resolveSafeWorkspacePath/hashContent-compare/warn-format). `walkTree()` + `manifestPath()` +
    `hashContent()` + `restore()`'s 'cas'-mode tree-walk block are the additional patterns to reuse.
  pattern: Clone `dirtyCheck`, swap `afterRef`→`beforeRef`, drop the `paths` param + its empty-input
    half of the guard, then add the mode dispatch: 'cas' → walkTree hash-compare + missing-entry loop;
    'explicit-paths' → manifest-entry hash-compare loop. Place the method IMMEDIATELY AFTER `dirtyCheck()`
    and BEFORE `restore()`'s JSDoc.
  gotcha: Adding the method resolves the S1-produced `cas.ts` "missing changedPaths" typecheck error —
    that is the success signal. Do NOT touch git.ts (S2), store.ts (S1), capture.ts/rewind.ts (other items).
    The 4 `as unknown as CasBackend` casts from S1 are typecheck-clean before AND after this item —
    leave them.

# CONTRACT FILE (read-only)
- file: src/snapshot/store.ts
  why: the CONTRACT (produced by S1). Read to confirm the exact interface signature
    `changedPaths(beforeRef: string): Promise<string[]>` (line ~112) + the NoOpStore stub (line ~373).
    Do NOT edit store.ts in this item.
  pattern: The CasBackend implementation must match this signature EXACTLY (async, single string
    param, Promise<string[]> return). Mirror the interface JSDoc's spec quote + "IMPLEMENTED BY: git/cas." footer.

# TEST TARGET FILE
- file: test/cas.test.ts
  why: THE test file to extend. The `describe("CasBackend.dirtyCheck — spec/14 §6 step 3 + §2")` block
    (line ~984) is the EXACT pattern to clone for a new `describe("CasBackend.changedPaths …")` block.
  pattern: two helper families — (1) `makeStateFs("/ws","/store",{"a.ts":Buffer.from("original")})` +
    `makeStateBackend(state, {nonGitMode:"explicit-paths"})` → FLAT worktree, `.set/.remove/.read/.exists`,
    `readdir` THROWS (use ONLY for explicit-paths + best-effort/missing-manifest tests). (2)
    `makeTreeFs`/`makeTreeBackend(cwd, storage, tree, cfg)` via `TreeSpec = Record<string,{content:Buffer;mtimeMs:number}|"dir">`
    → supports readdir (use for 'CAS'-MODE tests that need walkTree). `BASE_CFG` fixture available.
  gotcha: changedPaths has NO `paths` param (unlike dirtyCheck) — it discovers the affected set itself.
    So a 'cas'-mode test constructs a tree, captures a beforeRef, mutates the tree, then asserts the
    full changed set (not a caller-supplied subset). For explicit-paths, capture with explicit paths
    then mutate via `state.set/.remove`.

# SIBLING PRP (contract for the parallel git.ts work)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S2/PRP.md
  why: the GitBackend.changedPaths PRP. Treat as a CONTRACT — S2 resolves the git.ts TS2420. After S2,
    exactly 1 typecheck error remains (cas.ts). After THIS item, 0 errors.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S1/PRP.md
  why: the S1 PRP — confirms the interface signature, the NoOpStore stub, and the 4 double-cast conversions
    (capture.ts ×3, revert-explicit.test.ts ×1) that are already landed.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts          # SnapshotStore interface + NoOpStore (DONE by S1 — DO NOT EDIT)
  git.ts            # GitBackend (S2 — assume landed — DO NOT EDIT)
  cas.ts            # ← EDIT: add CasBackend.changedPaths (PRIMARY deliverable)
src/capture.ts      # 4 `as unknown as CasBackend` casts (S1) — DO NOT EDIT
src/tools/
  rewind.ts         # FUTURE consumer (line 849) — NOT edited here (P1.M4.T2.S1)
test/
  cas.test.ts       # ← EDIT: add CasBackend.changedPaths describe block (≥7 tests, both modes)
```

### Desired Codebase tree with files to be added/changed

```bash
src/snapshot/
  cas.ts            # MODIFIED — +changedPaths method (after dirtyCheck, before restore) + JSDoc
test/
  cas.test.ts       # MODIFIED — +describe("CasBackend.changedPaths …") block (≥7 tests)
# (no new files; no deletions)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — NO mtime/size short-circuit (the central correctness decision).
//   CasManifestEntry has {hash, size, mtime}. capture() skips re-hashing when (size,mtime) match the
//   previous manifest. changedPaths MUST NOT do this: a tool that mutates content while preserving
//   (size, mtime) (e.g. a write prefixed by `touch -d <oldtime>`, some editors that reset mtime) would
//   evade detection → the dirty guard would not inspect that file → restore() would overwrite a
//   concurrent human edit → the EXACT E30 silent-clobber this method exists to prevent. Full content
//   hash compare ONLY. The sibling dirtyCheck ALSO does full hashing (it reads+hashes every path) —
//   mirror it. State this in the JSDoc.

// CRITICAL #2 — the method MUST be async (Promise<string[]>) and MUST acquire this.mutex (spec §4.3 —
//   every IO-bearing store op is serialized). Mirror dirtyCheck's `const release = await
//   this.mutex.acquire();` … `finally { release(); }`. Forgetting release() (GOTCHA #5) deadlocks all
//   later acquire()s.

// CRITICAL #3 — BEST-EFFORT (E27): the method MUST NEVER reject. Use dirtyCheck's TWO-layer try/catch:
//   an INNER try to read+parseManifest the beforeRef manifest (missing/corrupt ⇒ parseManifest throws
//   on bad version, or readFile ENOENTs ⇒ return []); an OUTER try/catch that warns + returns [] on
//   any other error. The refuse/allow decision is the caller's (rewindExecute step 6b).

// CRITICAL #4 — 'cas' mode needs the missing-entry loop (the walk alone is insufficient).
//   walkTree visits only files PRESENT now. A file that existed at beforeRef but has since been
//   DELETED is NOT visited by the walk, so a second pass over manifest.files is required: any entry
//   with existed:true that was NOT seen during the walk (and is not dangerous) ⇒ changed (deleted).
//   This is the cas analog of git's `git diff` reporting Deleted paths. Without this loop, deleted
//   files are missed (restore would recreate... actually restore leaves deletes alone unless it's a
//   span-create, but a concurrent delete of a beforeRef file IS a path restore would touch and the
//   guard must inspect). The contract explicitly requires this: "Also check manifest entries whose
//   file is now missing (existed but gone) → changed."

// CRITICAL #5 — the TWO test helpers are NOT interchangeable.
//   makeStateFs: readdir THROWS ("not modeled (explicit-paths does not walk)") — using it for a 'cas'
//   test makes walkTree silently skip the whole tree (readdir error ⇒ subtree skipped) ⇒ changedPaths
//   returns [] regardless of actual changes ⇒ a false-green test. For 'cas' mode use makeTreeFs/
//   makeTreeBackend (supports readdir via a derived childMap). For explicit-paths + best-effort tests
//   use makeStateFs/makeStateBackend (it mirrors the dirtyCheck tests exactly).
//   makeTreeFs is built at construction; to simulate a POST-CAPTURE tree change (new/deleted file),
//   either (a) build the post-change tree and capture first then mutate `fakeFs` state directly, or
//   (b) see the restore 'cas'-mode test (line ~1175+) for the hand-rolled childMap-mutation pattern.
//   Simplest robust approach for changedPaths 'cas' tests: capture beforeRef on tree T1, then assert
//   changedPaths by mutating T1 via direct fakeFs maps — OR capture on T1, then re-point the backend
//   at a T2 tree. Prefer the approach the existing capture/restore 'cas' tests already use.

// CONVENTION #1 — warn message format mirrors dirtyCheck/restore:
//   `[mulligan] snapshot.changedPaths failed: ${err instanceof Error ? err.message : String(err)}`.

// CONVENTION #2 — early-return guard mirrors dirtyCheck's `if (!afterRef || paths.length === 0) return
//   []`. changedPaths has no paths param, so the guard is `if (!beforeRef) return [];` (no baseline ⇒
//   no changed paths; also avoids a wasted manifest read on an empty ref). Place it AFTER mutex acquire
//   + inside the outer try (dirtyCheck orders: acquire → try → guard).

// CONVENTION #3 — return processing is workspace-relative POSIX paths (the `rel` keys from walkTree's
//   visitor + the manifest.files keys — both already posix-rel via normalizeRelPath). No extra
//   normalization needed (unlike git.ts which splits `git diff` stdout).

// CONVENTION #4 — JSDoc density matches dirtyCheck/restore (multi-line block: what it returns + spec
//   cite with verbatim quote + per-mode algorithm + consumer + best-effort + the NO-short-circuit
//   decision). End with "IMPLEMENTED BY: git/cas." (matching the interface method's footer).

// HANDOFF — after this item, `npm run typecheck` shows 0 errors (assuming S2 landed git.ts). The
//   CasBackend subtype relationship is RESTORED the instant this method is added, so S1's 4
//   `as unknown as CasBackend` casts remain typecheck-clean (do NOT revert them to single-cast —
//   that would be wrong now AND re-break later).
```

## Implementation Blueprint

### Data models and structure

No data models. No new types. The only structural change is adding ONE method to an existing class.
The method's signature (which MUST match the interface declared by S1 verbatim):

```typescript
async changedPaths(beforeRef: string): Promise<string[]>;
```

Semantics (encode in JSDoc): returns workspace-relative POSIX paths that differ between the
`beforeRef` snapshot manifest (the `CasManifest` at `manifestPath(beforeRef)`) and the CURRENT working
tree — exactly the set `restore()` would touch (spec/14 §6 step 2). Mode-aware:
- `'cas'` mode: `walkTree(this.cwd, excludeSet, …)` reads+hashes each current file and compares to
  `manifest.files[rel]` — a file NOT in the manifest (created since) OR whose current hash ≠ stored
  hash (modified) is changed; then a second loop flags manifest `existed:true` entries now MISSING
  (deleted since). Returns the union.
- `'explicit-paths'` mode: iterates `Object.entries(manifest.files)`, hashes each current file, flags
  modified/created (hash differs — an `existed:false` entry that now exists has stored hash "" vs a real
  hash, so the compare flags it naturally) or deleted (`existed:true` + now gone). NO tree walk (the
  manifest is the scope — conservative, matches capture's explicit-paths semantics).

Consumed by rewindExecute step 6b (P1.M4.T2.S1) to replace the heuristic `ledger.modifiedFiles`.
Best-effort: never rejects — returns `[]` on any error.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD changedPaths to CasBackend (src/snapshot/cas.ts)
  - FIND: the `dirtyCheck(...)` method. Insert the new method IMMEDIATELY AFTER dirtyCheck's closing
    brace `}` and BEFORE the `restore()` JSDoc (`/**\n   * Write working-tree files FROM the beforeRef
    snapshot`). (Matches the interface order in store.ts — dirtyCheck → changedPaths → restore — and
    groups the two ref-vs-tree path-set query methods; mirrors S2's GitBackend placement.)
  - IMPLEMENT the method body by CLONING dirtyCheck and applying the changes below. The structure
    (mutex/try/catch/finally/manifest-read/parseManifest/warn-format) is IDENTICAL; only the inner
    loop + the mode dispatch differ.
  - WRITE the method (this is the canonical implementation — adapt only if a confirmed codebase
    detail requires it):

      async changedPaths(beforeRef: string): Promise<string[]> {
        const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
        try {
          if (!beforeRef) return []; // no baseline ⇒ no changed paths (mirrors dirtyCheck's empty-ref guard)
          let manifest: CasManifest;
          try {
            const buf = await this.fs.readFile(this.manifestPath(beforeRef));
            manifest = parseManifest(buf.toString("utf8")); // throws on bad version ⇒ [] below
          } catch {
            return []; // missing/corrupt beforeRef ⇒ no changed paths (best-effort). Never rejects.
          }
          const changed: string[] = [];

          if (this.cfg.nonGitMode === "cas") {
            // 'cas' mode (§4.2/§4.1): comprehensive — walk the tree, hash each file, compare to the
            // beforeRef manifest. A file NEW since capture (not in manifest) or MODIFIED (hash differs)
            // is changed. (Deliberately NO mtime/size short-circuit — a content mutation that preserves
            // mtime must NOT evade detection; this method exists to close exactly that E30 hole.)
            const seen = new Set<string>();
            const excludeSet = new Set(
              this.cfg.excludeGlobs.map((g) => g.toLowerCase()),
            );
            await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {
              seen.add(rel); // visited during the walk (used by the missing-entry loop below)
              let currentHash: string;
              try {
                currentHash = await this.hashContent(await this.fs.readFile(abs));
              } catch {
                return; // unreadable file mid-walk ⇒ skip (walkTree already prunes; belt-and-suspenders)
              }
              const entry = manifest.files[rel];
              if (!entry) {
                changed.push(rel); // NEW since beforeRef (not in manifest)
              } else if (currentHash !== entry.hash) {
                changed.push(rel); // MODIFIED (content drifted; also flags an existed:false entry now existing)
              }
            });
            // manifest entries that existed at beforeRef but are now MISSING (deleted since). The walk
            // only visits present files, so a second pass catches deletes (the cas analog of `git diff`
            // reporting Deleted paths). existed:false + still absent ⇒ correctly not changed.
            for (const [rel, entry] of Object.entries(manifest.files)) {
              if (seen.has(rel)) continue; // visited during the walk (already classified above)
              if (isDangerousWorkspaceRel(rel)) continue; // safety floor — never report a dangerous path
              if (entry.existed) changed.push(rel); // was at beforeRef, now gone ⇒ changed
            }
          } else {
            // explicit-paths mode (§4.2): conservative — check ONLY the manifest entries' paths (no
            // tree walk). The manifest is the scope (bash-created files are deliberately NOT promised
            // restorable per §4.2, so they are out of scope here too).
            for (const [rel, entry] of Object.entries(manifest.files)) {
              if (isDangerousWorkspaceRel(rel)) continue; // safety floor
              let currentHash: string | null = null;
              let existsNow = false;
              try {
                const abs = resolveSafeWorkspacePath(this.cwd, rel); // escape ⇒ existsNow stays false
                currentHash = await this.hashContent(await this.fs.readFile(abs));
                existsNow = true;
              } catch {
                existsNow = false; // ENOENT or escape ⇒ file not (safely) readable now
              }
              if (existsNow) {
                if (currentHash !== entry.hash) {
                  changed.push(rel); // MODIFIED (content drifted; existed:false-now-existing ⇒ hash ""≠real ⇒ changed)
                }
              } else if (entry.existed) {
                changed.push(rel); // was at beforeRef, now gone ⇒ deleted ⇒ changed
              }
              // !existsNow && !entry.existed ⇒ absent then, absent now ⇒ not changed (skip)
            }
          }
          return changed;
        } catch (err) {
          // E27 best-effort: any error ⇒ [] (no changed paths detected). Never rejects.
          console.warn(
            `[mulligan] snapshot.changedPaths failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        } finally {
          release();
        }
      }

  - WRITE JSDoc immediately above the method (mirror dirtyCheck/restore density). The JSDoc MUST cover:
      1. Return: workspace-relative POSIX paths that differ between the beforeRef snapshot manifest and
         the CURRENT working tree — exactly the files restore() would touch.
      2. Spec mandate: quote spec/14 §6 step 2 VERBATIM — "paths that differ between beforeRef and the
         current tree (the files restore would touch)". Reference BUG-004 + E30.
      3. Per-mode algorithm: 'cas' mode = walkTree the cwd, hash each file, compare to manifest.files[rel]
         (new/modified), PLUS a second loop flagging manifest existed:true entries now missing (deleted);
         'explicit-paths' mode = iterate manifest.files only (no walk — the manifest is the scope),
         hash-compare, flag modified/deleted. State the NO mtime/size short-circuit decision + WHY
         (a content mutation preserving mtime must not evade detection — E30 mandate; sibling dirtyCheck
         also does full hashing).
      4. Consumer: rewindExecute step 6b (the BUG-004 fix, P1.M4.T2.S1) — replaces the heuristic
         ledger.modifiedFiles so the dirty guard inspects EVERY file restore would touch (closes the E30
         gap for python/node/perl/heredoc-modified files absent from modifiedFiles).
      5. Best-effort + serialization: NEVER rejects — a missing/corrupt beforeRef manifest OR any error
         is caught, warned, returns [] (the dirty guard's own refuse/allow decision is the caller's).
         Serialized by the per-backend AsyncMutex (spec §4.3). End with "IMPLEMENTED BY: git/cas.".
  - NAMING: `changedPaths` (camelCase, matches the work-item + interface VERBATIM). Param `beforeRef`.
  - PRESERVE: every other CasBackend method (capture/appendExplicitPath/dirtyCheck/restore/has/retire/
    destroy/gc), all private fields + helpers (hashContent/storeBlob/readBlob/blobPath/manifestPath/
    loadPrevEntries/walkTree/captureExplicitPaths/notifyBashUsed), the constructor.
  - DO NOT edit store.ts, git.ts, capture.ts, or rewind.ts in this task.

Task 2: ADD the CasBackend.changedPaths unit-test block (test/cas.test.ts)
  - FIND: the `describe("CasBackend.dirtyCheck — spec/14 §6 step 3 + §2", () => { ... })` block (line
    ~984). Add a NEW `describe("CasBackend.changedPaths — spec/14 §6 step 2 / BUG-004", () => { ... })`
    block IMMEDIATELY AFTER it (topological grouping with its sibling diff query). Reuse the existing
    helpers. USE THE RIGHT HELPER PER MODE (CRITICAL #5 above).
  - IMPLEMENT these tests (mirror the dirtyCheck block's shape; adapt for changedPaths discovering the
    set itself — no `paths` param). NOTE: the exact helper+mutation mechanics for the 'cas' tests depend
    on makeTreeFs's mutability; if a direct post-capture mutation of makeTreeFs is awkward, mirror the
    restore 'cas'-mode test's hand-rolled childMap fake (line ~1175+) OR capture on tree T1 then rebuild
    the backend over a mutated tree T2 sharing the SAME storageDir (so the beforeRef manifest persists).

    EXPLICIT-PATHS MODE tests (use makeStateFs/makeStateBackend — mirrors dirtyCheck tests):
      1. it("explicit-paths: returns a manifest path whose current hash ≠ beforeRef (modified since)"):
            const state = makeStateFs("/ws","/store",{ "a.ts": Buffer.from("original") });
            const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
            const beforeRef = await cb.capture("turn", ["a.ts"]);
            state.set("a.ts", Buffer.from("CHANGED")); // drift since beforeRef
            expect(await cb.changedPaths(beforeRef!)).toEqual(["a.ts"]);
      2. it("explicit-paths: returns a manifest path that existed at beforeRef but is gone now (deleted)"):
            (capture a.ts; state.remove("a.ts"); changedPaths ⇒ ["a.ts"])
      3. it("explicit-paths: returns an existed:false entry that now exists (created since) as changed"):
            (capture not-yet-existing "new.ts" existed:false; state.set("new.ts", ...); changedPaths ⇒ ["new.ts"]
             — assert the hash "" vs real hash branch flags it)
      4. it("explicit-paths: returns [] when all manifest paths match beforeRef (clean)"):
            (capture a.ts; no mutation; changedPaths ⇒ [])
      5. it("explicit-paths: skips dangerous paths (never reported)"):
            (capture a.ts; pass nothing — changedPaths has no paths arg; ensure dangerous manifest keys,
             if any, are skipped. Simplest: capture a normal path; changedPaths ⇒ [] or [safe path only];
             assert result does NOT contain ".git/..." or "node_modules/...".)

    'CAS' MODE tests (use makeTreeFs/makeTreeBackend — needs readdir for walkTree):
      6. it("cas mode: returns a NEW file not in the beforeRef manifest (created since)"):
            makeTreeBackend("/ws","/store",{ "a.ts": {content:Buffer.from("a"),mtimeMs:1000} });
            const beforeRef = await cb.capture("turn");  // 'cas' default
            // add a NEW file to the tree (b.ts) — mutate fakeFs so a later readdir sees it
            //   (mirror the capture 'cas' tests' tree mutation, or the restore cas-mode childMap approach)
            const changed = await cb.changedPaths(beforeRef!);
            expect(changed).toEqual(["b.ts"]);  // new since beforeRef
      7. it("cas mode: returns a MODIFIED file (current hash ≠ manifest hash)"):
            (capture tree with a.ts="a"; mutate a.ts to "b" via fakeFs; changedPaths ⇒ ["a.ts"])
      8. it("cas mode: returns a file that existed at beforeRef but is now MISSING (deleted)"):
            (capture tree with a.ts; remove a.ts from fakeFs; changedPaths ⇒ ["a.ts"])
      9. it("cas mode: returns the UNION (new + modified + deleted in one call)"):
            (capture tree {a.ts,b.ts,c.ts}; then: modify a.ts, delete b.ts, add d.ts;
             changedPaths ⇒ contains "a.ts","b.ts","d.ts" and NOT "c.ts")
      10. it("cas mode: excludeGlobs + dangerous dirs are NOT walked (absent from result)"):
            (capture tree with a.ts; add a "dist/x" or ".git/x" file post-capture; changedPaths ⇒ [] or
             only the non-excluded path — assert the excluded/dangerous path is NOT reported)

    CROSS-MODE / ROBUSTNESS tests (use makeStateFs for explicit-paths; behavior is mode-agnostic here):
      11. it("returns [] for an empty beforeRef (no manifest read issued)"):
            const state = makeStateFs("/ws","/store",{ "a.ts": Buffer.from("a") });
            const cb = makeStateBackend(state, { nonGitMode: "explicit-paths" });
            expect(await cb.changedPaths("")).toEqual([]);
      12. it("returns [] when the beforeRef manifest is missing/corrupt (best-effort)"):
            (changedPaths("turn") with no manifest ⇒ []; capture then corrupt the manifest file with
             "{bad" ⇒ changedPaths(afterRef) ⇒ [])
      13. it("never rejects on any error (returns [])"):
            (a throwing readFile fake, mirroring the dirtyCheck "never rejects" test)
      14. it("acquires the mutex (two concurrent calls both complete — §4.3)"):
            (two concurrent cb.changedPaths(...) via Promise.all — must resolve, not hang; mirror the
             capture "mutex serializes concurrent" test)

  - WHY each test matters:
      - #1–#4 pin the explicit-paths per-entry semantics (mirrors the dirtyCheck tests 1:1 — they prove
        the hash-compare + existed:false + clean + deleted branches).
      - #5 + #10 are the safety-floor guards (dangerous/excluded paths never leak into the result —
        critical: the dirty guard must never act on .git/node_modules).
      - #6–#9 pin the 'cas'-mode UNION semantics (new + modified + deleted) — these are the BUG-004
        correctness cases (a python/node-created file is NEW since beforeRef and MUST appear).
      - #11 mirrors dirtyCheck's empty-input guard.
      - #12 + #13 pin the E27 best-effort never-rejects contract (missing/corrupt manifest + arbitrary error).
      - #14 is a mutex smoke — two concurrent calls must both resolve (no deadlock from a forgotten release).
  - NAMING: `describe("CasBackend.changedPaths — spec/14 §6 step 2 / BUG-004")`. `it(...)` titles as above.
  - DO NOT add an integration test here (the E30 bash/python dirty-guard integration test is
    P1.M4.T2.S2 — it requires the rewind wiring which is not present yet).

Task 3: VALIDATE (see Validation Loop) — confirm the EXACT expected typecheck + test outcome.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN A — the sibling method to clone VERBATIM (existing dirtyCheck in src/snapshot/cas.ts):
async dirtyCheck(afterRef: string, paths: string[]): Promise<string[]> {
  const release = await this.mutex.acquire(); // spec §4.3 — serialize ALL store ops
  try {
    if (!afterRef || paths.length === 0) return []; // no drift baseline / nothing to check ⇒ allow
    let manifest: CasManifest;
    try {
      const buf = await this.fs.readFile(this.manifestPath(afterRef));
      manifest = parseManifest(buf.toString("utf8")); // throws on bad version — caught below ⇒ []
    } catch {
      return []; // missing/corrupt afterRef ⇒ allow (best-effort)
    }
    const dirty: string[] = [];
    for (const rel of paths) {
      if (isDangerousWorkspaceRel(rel)) continue;
      const entry = manifest.files[rel];
      let currentHash: string | null = null; let existsNow = false;
      try {
        const abs = resolveSafeWorkspacePath(this.cwd, rel);
        currentHash = await this.hashContent(await this.fs.readFile(abs));
        existsNow = true;
      } catch { existsNow = false; }
      if (existsNow) { /* dirty if !entry || !entry.existed || hash≠ */ }
      else if (entry && entry.existed) { dirty.push(rel); }
    }
    return dirty;
  } catch (err) {
    console.warn(`[mulligan] snapshot.dirtyCheck failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally { release(); }
}
// → changedPaths clones this: swap afterRef→beforeRef; drop the `paths` param + its empty-input half
//   (`if (!beforeRef) return [];`); then wrap the per-path loop in a mode dispatch — 'cas' walks the
//   tree (PATTERN B) + adds the missing-entry loop; 'explicit-paths' keeps dirtyCheck's per-path loop
//   but iterates manifest.files directly (no caller `paths`). Everything else is IDENTICAL.

// PATTERN B — the 'cas'-mode tree walk to reuse VERBATIM (existing restore() cas-mode block):
if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles && this.cfg.nonGitMode === "cas") {
  const excludeSet = new Set(this.cfg.excludeGlobs.map((g) => g.toLowerCase()));
  await this.walkTree(this.cwd, excludeSet, async (rel, abs) => {
    if (manifest.files[rel]) return; // (restore deletes present-not-in-manifest)
    // ...
  });
}
// → changedPaths 'cas' branch uses the SAME excludeSet + walkTree(this.cwd, excludeSet, visit) call,
//   but the visitor hashes+compares (flags new/modified) and records `seen` for the missing-entry loop.
//   walkTree signature: (absDir, excludeSet, visit) where visit(rel, abs, st:{size,mtimeMs}). It PRUNES
//   dangerous dirs + excludeGlobs + symlinks/sockets automatically (no manual filter needed inside visit).

// PATTERN C — the helpers to reuse (all already on `this`):
//   this.manifestPath(ref)       → join(storageDir,"manifests",`${ref}.json`)  (ref === capture label)
//   parseManifest(jsonStr)       → CasManifest; THROWS on version !== 1 (the corrupt-manifest backstop)
//   this.hashContent(Buffer)     → Promise<string> (sha256 hex)
//   this.fs.readFile(abs)        → Promise<Buffer>
//   resolveSafeWorkspacePath(cwd, rel) → abs; THROWS on ../absolute escape
//   isDangerousWorkspaceRel(rel) → boolean (.git/.pi/node_modules/escape)
//   this.cfg.nonGitMode          → "cas" | "explicit-paths";  this.cfg.excludeGlobs → string[]
```

### Integration Points

```yaml
CLASS (src/snapshot/cas.ts — CasBackend):
  - add method: "async changedPaths(beforeRef: string): Promise<string[]> { ... }"
  - placement: immediately after dirtyCheck(), before restore()'s JSDoc
  - implements: the SnapshotStore.changedPaths interface method declared by S1 (resolves its typecheck error)
INTERFACE (src/snapshot/store.ts): UNCHANGED (S1 already declared the method — do NOT re-edit)
TEST (test/cas.test.ts):
  - add describe block: "CasBackend.changedPaths — spec/14 §6 step 2 / BUG-004"
  - placement: immediately after the "CasBackend.dirtyCheck …" describe block
DATABASE / CONFIG / ROUTES / MARKERS: none (Mode A — method + JSDoc + tests only)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# THE primary gate. Run after Task 1. Confirms CasBackend now satisfies the widened interface.
npm run typecheck          # tsc --noEmit
# EXPECTED OUTCOME (the critical check):
#   - The src/snapshot/cas.ts "Class 'CasBackend' incorrectly implements interface 'SnapshotStore'.
#     Property 'changedPaths' is missing" error (produced by S1) is GONE.
#   - ZERO typecheck errors remain (assuming S2 landed its git.ts fix — see parallel-context note).
# If you see the cas.ts TS2420 STILL → the method signature is wrong (typol; not `async`; placed outside
#   the class; missing `Promise<string[]>` return type). Re-check it matches `async changedPaths
#   (beforeRef: string): Promise<string[]>` exactly.
# If you see a TS2352 ("neither type sufficiently overlaps") on an `as CasBackend` cast in capture.ts /
#   revert-explicit.test.ts → a single-cast crept back in. Re-convert it to `as unknown as CasBackend`
#   (S1's form). This item must NOT regress S1's cast hardening.
# If a git.ts TS2420 remains → that is S2 IN-FLIGHT (parallel), NOT a defect in this item. Confirm S2
#   hasn't landed yet with: grep -n "async changedPaths" src/snapshot/git.ts  (empty ⇒ S2 pending).
#   Do NOT edit git.ts here.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: the new changedPaths tests + the full cas.test.ts must be green.
npx vitest run test/cas.test.ts
# Expected: green. The new "CasBackend.changedPaths — spec/14 §6 step 2 / BUG-004" block (≥7 tests)
#   passes across BOTH modes. If a 'cas' test returns [] unexpectedly → you used makeStateFs (readdir
#   throws ⇒ walkTree silently skips the whole tree) instead of makeTreeFs/makeTreeBackend. If a
#   never-rejects test FAILS (a rejection surfaced) → the outer catch is missing or re-throws. If the
#   mutex test TIMES OUT → release() is missing from finally.

# Full suite — no behavioral regression (changedPaths is added but not yet called by production code).
npm test
# Expected: all green. (Any remaining cas.ts/git.ts typecheck error is NOT surfaced by vitest — vitest
#   transpiles per-file; only `npm run typecheck` surfaces it. So the full test suite passes regardless.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this item adds a backend method only; NO production code path calls changedPaths yet
# (rewind.ts still uses ledger.modifiedFiles). The rewind wiring + the E30 bash/python dirty-guard
# integration test are P1.M4.T2.S1 / P1.M4.T2.S2.
```

### Level 4: Domain-Specific Validation

```bash
# Manual sanity (optional): confirm CasBackend.changedPaths behaves on a REAL storage dir + fake tree.
# The DI-fake unit tests (Task 2) are the primary gate (matching the existing dirtyCheck test strategy);
# real-fs validation is only a smoke check. The key scenario to reason about (the BUG-004 case):
#   1. capture a beforeRef over a tree that includes b.ts="original"
#   2. simulate a python-written change: b.ts content rewritten to "agent-version" (a path NOT in any
#      ledger.modifiedFiles — the whole point of BUG-004)
#   3. cb.changedPaths(beforeRef) MUST include "b.ts"  (the dirty guard will now inspect it)
# This is the E30 closure proof. The unit test #7 (cas mode modified) + #9 (union) cover it directly.
```

## Final Validation Checklist

### Technical Validation

- [ ] `src/snapshot/cas.ts`: `CasBackend` has `async changedPaths(beforeRef: string): Promise<string[]>`
      placed after `dirtyCheck()` and before `restore()`'s JSDoc, mirroring dirtyCheck's
      mutex/try/catch/finally structure exactly.
- [ ] The method acquires `this.mutex` + `release()`s in `finally` (AsyncMutex GOTCHA #5).
- [ ] `'cas'` mode: `walkTree(this.cwd, excludeSet, …)` hash-compares + flags new/modified; a second loop
      flags manifest `existed:true` entries now missing (deleted). Returns the union.
- [ ] `'explicit-paths'` mode: iterates `manifest.files`, hash-compares, flags modified/deleted. NO walk.
- [ ] Missing/corrupt beforeRef manifest ⇒ inner-catch `[]`; any other error ⇒ outer-catch warn + `[]`.
- [ ] `npm run typecheck`: 0 errors (cas.ts error gone; git.ts resolved by S2). No TS2352 cast regressions.
- [ ] `npx vitest run test/cas.test.ts`: green, including the new `CasBackend.changedPaths` block (both modes).
- [ ] `npm test`: full suite green.

### Feature Validation

- [ ] JSDoc quotes spec/14 §6 step 2 verbatim ("paths that differ between beforeRef and the current tree
      (the files restore would touch)") and references BUG-004 + E30.
- [ ] JSDoc documents BOTH mode algorithms ('cas' tree-walk + missing-entry loop; 'explicit-paths'
      manifest-only) and states the NO-mtime/size-short-circuit decision with its E30 rationale.
- [ ] JSDoc names the consumer (rewindExecute step 6b, P1.M4.T2.S1) and the heuristic it replaces
      (`ledger.modifiedFiles`), and the E30 gap it closes (python/node/perl/heredoc-modified files).
- [ ] JSDoc states BEST-EFFORT (never rejects → []) + AsyncMutex-serialized (spec §4.3), and ends with
      "IMPLEMENTED BY: git/cas.".
- [ ] The signature is async (`Promise<string[]>`), matching all other IO-bearing CasBackend methods.

### Code Quality Validation

- [ ] JSDoc density + style matches `dirtyCheck`/`restore` (multi-line block, spec cites, gotcha notes).
- [ ] Method placement is logical (immediately after dirtyCheck — groups the two ref-vs-tree path-set
      query methods; mirrors the interface order from S1 + S2's GitBackend placement).
- [ ] No new exported types; `store.ts`/`git.ts`/`capture.ts`/`rewind.ts`/`RestoreOpts`/`RestoreResult`/
      `AsyncMutex`/`detectAndCreate` untouched. The 4 `as unknown as CasBackend` casts (S1) untouched.
- [ ] The unit tests include BOTH modes and the two CRITICAL correctness cases (the 'cas'-mode UNION —
      new+modified+deleted — and the safety-floor guards so dangerous/excluded paths never leak).

### Documentation & Deployment

- [ ] JSDoc is self-documenting (P1.M4.T2.S1 — the rewind wiring — can read it and know the return
      contract: workspace-rel POSIX paths differing from beforeRef vs current tree, best-effort []).
- [ ] No env vars / config / migrations / API-surface change (Mode A).

---

## Anti-Patterns to Avoid

- ❌ **Don't use the mtime/size short-circuit.** `CasManifestEntry` has `{hash,size,mtime}` and capture()
  skips re-hashing when `(size,mtime)` match. A tool that mutates content while preserving mtime (a
  `touch -d`-prefixed write, some editors) would then evade detection — the dirty guard would not
  inspect that file and restore() would overwrite a concurrent human edit, the EXACT E30 silent-clobber
  this method exists to close. Full content-hash compare only (the sibling dirtyCheck also does full
  hashing — mirror it).
- ❌ **Don't forget the 'cas'-mode missing-entry loop.** `walkTree` visits only files PRESENT now; a file
  that existed at beforeRef but was deleted since is never visited. The contract requires: "Also check
  manifest entries whose file is now missing (existed but gone) → changed." Without the second loop,
  deleted files are omitted from the affected set.
- ❌ **Don't conflate the two test helpers.** `makeStateFs`'s `readdir` THROWS ("not modeled (explicit-
  paths does not walk)") — using it for a 'cas' test makes `walkTree` silently skip the whole tree ⇒
  changedPaths returns `[]` regardless ⇒ a false-green test. Use `makeTreeFs`/`makeTreeBackend` for 'cas'
  (supports readdir); `makeStateFs`/`makeStateBackend` for explicit-paths + best-effort tests.
- ❌ **Don't make the method synchronous or skip the mutex.** Every IO-bearing CasBackend method is async
  + AsyncMutex-serialized (spec §4.3). changedPaths reads the manifest + (in 'cas' mode) walks+hashes the
  tree (all IO) → must be async + acquire `this.mutex` (and `release()` in `finally` — GOTCHA #5).
- ❌ **Don't let the method reject.** Use dirtyCheck's TWO-layer try/catch: inner for the
  read+parseManifest (missing/corrupt ⇒ `[]`), outer for any other error (warn + `[]`, E27). A rejecting
  `changedPaths` would propagate into rewindExecute step 6b and could block a context rewind — the
  feature's overriding rule forbids that.
- ❌ **Don't edit `src/snapshot/store.ts`** — S1 already declared the interface method + NoOpStore stub.
  Re-editing it risks colliding with S1's already-landed contract.
- ❌ **Don't edit `src/snapshot/git.ts` to clear a git.ts typecheck error** — that is S2 (in-flight). Its
  error (if still present) is the EXPECTED S2 handoff; the success state for THIS item is "cas.ts error
  gone; 0 errors assuming S2 landed". Verify S2's status with `grep -n "async changedPaths" src/snapshot/git.ts`.
- ❌ **Don't revert the 4 `as unknown as CasBackend` casts** (capture.ts ×3, revert-explicit.test.ts ×1)
  to single-cast. S1 added them precisely because the contract-first ordering temporarily breaks the
  CasBackend subtype relationship. Adding `changedPaths` here RESTORES the subtype, so the double-casts
  are still (and remain) the correct, typecheck-clean form.
- ❌ **Don't wire `changedPaths` into `src/tools/rewind.ts`** (replacing `ledger.modifiedFiles`) — that
  is P1.M4.T2.S1. This item ships the cas method + tests only.
- ❌ **Don't add an E30 bash/python integration test in this item** — it requires the rewind wiring
  (P1.M4.T2.S1) which is not present yet. That test is P1.M4.T2.S2.
- ❌ **Don't walk the tree in explicit-paths mode.** The contract: "explicit-paths doesn't walk, so skip
  this (conservative — the manifest is the scope)." Walking would flag bash-created files as "changed"
  even though explicit-paths never promised to restore them (§4.2) — over-broad, not over-cautious.

---

## Confidence Score

**9.5/10** — This is a single-method addition that clones the existing, well-understood sibling
(`dirtyCheck`) for its mutex/try/catch/finally/manifest-read/hash-compare skeleton, then adds a
mode-dispatch whose two branches each reuse already-proven helpers: the 'cas' branch composes
`walkTree` (proven by capture + restore's cas-mode block) with dirtyCheck's per-file hash-compare, plus
a small missing-entry loop (the only genuinely novel line — and it is a straightforward "entry existed
but not seen during the walk" check); the explicit-paths branch IS dirtyCheck's per-path loop, iterated
over `manifest.files` instead of a caller `paths` array. The two design decisions with the highest
correctness stakes — (1) NO mtime/size short-circuit (E30 mandate) and (2) the 'cas'-mode missing-entry
loop (deletes) — are each called out in the contract, the gotchas, the success criteria, the JSDoc
spec, and dedicated unit tests (#7/#8/#9 + the BUG-004 manual sanity). The typecheck-outcome
expectation (cas.ts error gone → 0 errors assuming S2) is unambiguous, and the most common
implementation traps (wrong test helper for 'cas'; reverting S1's casts; walking in explicit-paths;
missing the missing-entry loop) are each named with a concrete symptom and fix. Downstream P1.M4.T2.S1
(rewind wiring) has an unambiguous, JSDoc-specified contract to build against. The 0.5 reserved for:
the 'cas'-mode test mutation mechanics (makeTreeFs is built at construction; a post-capture tree
mutation may need the restore cas-mode hand-rolled childMap pattern or a shared-storageDir rebuild) —
the implementer should follow whichever approach the existing capture/restore 'cas' tests already use,
which is fully cited.