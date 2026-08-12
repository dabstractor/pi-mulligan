---
name: "P1.M4.T2.S1 — Wire store.changedPaths() into rewind.ts step 6b dirty guard (BUG-004 fix)"
description: |
  Replace the heuristic `const affectedPaths = ledger.modifiedFiles;` (src/tools/rewind.ts:849) with the
  spec-mandated snapshot diff `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);` in
  step 6b of `rewindExecute`. This closes the E30 silent-clobber gap: `modifiedFiles` MISSES files mutated
  via `python -c` / `node script.js` / `perl -i` / heredocs / `awk -i inplace` (they land in
  `ledger.bashSideEffects`), so the dirty guard used to inspect a SUBSET of what `restore()` actually
  reverts → a concurrent human edit to such a file was silently overwritten. `changedPaths(beforeRef)`
  returns EVERY workspace path differing between the pre-turn snapshot and the CURRENT tree — exactly the
  set `restore()` will touch (spec/14 §6 step 2 VERBATIM) — so the guard now inspects the true affected set.
  Mode A: ONE production-line swap + a rewritten JSDoc comment (CRITICAL #3). NO new tests (the E30
  bash/python integration test is P1.M4.T2.S2). NO backend/interface work (S1/S2/S3 are ALREADY LANDED —
  verified: store.ts:112/373, git.ts:490, cas.ts:858). NO changes to `dirtyCheck`, `doRestore`,
  `restore()`, the afterRef conditional (BUG-001 — DONE), the `ledger` variable (still used), markers, or
  config. DEPENDS ON (both already Complete): P1.M1.T1.S1 (BUG-001 afterRef conditional — in place at
  rewind.ts:897-905) and P1.M4.T1.S1/S2/S3 (the changedPaths method on all backends).

  PARALLEL CONTEXT: P1.M4.T1.S3 (CasBackend.changedPaths) was being implemented in parallel. It has
  ALREADY LANDED in the working tree (src/snapshot/cas.ts:858) — verified by grep. So `store.changedPaths`
  is callable on every SnapshotStore subtype (GitBackend, CasBackend, NoOpStore) at implementation time.
  This item wires the ONE caller.
---

## Goal

**Feature Goal**: Replace the HEURISTIC dirty-guard affected-set source in `rewindExecute` step 6b with
the spec-mandated snapshot diff. The dirty guard (`store.dirtyCheck`) currently inspects only
`ledger.modifiedFiles` — files parseable from write/edit + a narrow set of bash commands (sed/cp/mv/tee/
redirect). It must instead inspect `store.changedPaths(checkpoint.beforeRef)` — EVERY workspace path that
differs between the pre-turn snapshot and the current working tree, i.e. the EXACT set `restore()` will
touch. This closes the BUG-004 / E30 hole: a concurrent human edit to a file the agent wrote via
`python -c` / `node` / `perl -i` / a heredoc / `awk -i inplace` is now caught by the guard and the whole
file-revert is REFUSED (never silently clobbered), instead of being overwritten by `restore()`.

**Deliverable**:
1. `src/tools/rewind.ts` MODIFIED — exactly TWO changes inside step 6b's branch (5)+(6):
   (a) the assignment line 849 `const affectedPaths = ledger.modifiedFiles;` →
       `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`
   (b) the preceding "CRITICAL #3" JSDoc comment (lines 843-848) REWRITTEN to document the changedPaths
       call, cite spec/14 §6 step 2 + BUG-004 + E30, and explain the best-effort fail-open semantics.
   Nothing else in the file changes.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`): **0 errors**. (`changedPaths` is declared on `SnapshotStore` and
  implemented on all backends — the call typechecks with no cast because `store` is typed `SnapshotStore`.)
- `npm test` (full vitest suite): **green, no behavioral regression.** Ordinary rewinds (no concurrent
  post-turn edit) behave identically; only the silent-clobber E30 case changes (bug → correct refuse),
  and no existing test exercises that case (it is the P1.M4.T2.S2 gap).
- The `ledger` variable, the BUG-001 afterRef conditional, `dirtyCheck`, `doRestore`, `restore()`,
  `revertBlock`/`revertClause`/`revertRefused`/`revertSummaryDetails` are all UNCHANGED.

## Why

- **Closes the E30 silent-clobber of concurrent edits** (spec/14 §6 step 2/3, BUG-004). The revert
  subsystem's overriding guarantee (E30) is "never silently clobbers concurrent edits." `restore()`
  reverts EVERY file differing from `beforeRef` (git: `git diff --diff-filter=MD`; cas: every manifest
  entry + the 'cas'-mode tree walk), but the dirty guard only inspected `ledger.modifiedFiles` — a
  HEURISTIC subset. Files mutated via `python -c`, `node script.js`, `perl -i`, heredocs, or
  `awk -i inplace` are NOT in `modifiedFiles` (they land in `ledger.bashSideEffects`). So the guard
  returned `[]` (clean) for those files even when a human had edited them after `agent_end`, and
  `restore()` then overwrote the human edit. Confirmed at runtime in the PRD (BUG-004 repro): a human edit
  to a python-written file was destroyed to the pre-turn content with "0 refused". This fix derives the
  affected set from the STORE (`store.changedPaths(beforeRef)` = the snapshot diff), which the store CAN
  compute (git already runs `git diff --name-only` inside `restore()`; cas already hashes every manifest
  entry). The limitation was self-imposed, not real.
- **No behavior change for the common case.** For files NOT edited by a human post-turn,
  `changedPaths(beforeRef)` includes them, but `dirtyCheck(afterRef, [...])` compares them vs the
  post-turn baseline → they match (clean) → PROCEED. So a normal rewind proceeds exactly as before. Only
  the (previously broken) concurrent-edit case flips from silent clobber to a clean REFUSE.
- **Best-effort / fail-open preserved.** `changedPaths` is E27 best-effort (never rejects → `[]` on any
  error). An empty affected set makes `dirtyCheck` trivially pass → restore proceeds. This matches the
  revert subsystem's overriding contract (E13/E27: the rewind ALWAYS completes; a revert hiccup never
  blocks it). The degradation direction is correct (restore > block).

## What

**User-visible behavior**: NONE for ordinary rewinds. For the E30 scenario (a human edits a file the agent
modified via a non-parseable bash command, after the agent's turn ended), the tool now REFUSES the
file-revert with `(file revert refused: N path(s) changed since the turn ended — not overwritten;
re-request if intended)` and leaves the human edit intact, instead of silently reverting it. The context
rewind (note hide) still proceeds in both cases.

**Technical change**: ONE production line in `src/tools/rewind.ts` step 6b (line 849) swaps the
affected-set source from `ledger.modifiedFiles` to `await store.changedPaths(checkpoint.beforeRef)`, plus
its preceding JSDoc comment is rewritten (Mode A documentation requirement). No data models, no exports,
no config, no API surface, no marker schema, no new files.

### Success Criteria

- [ ] `src/tools/rewind.ts:849` reads `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`
      (with `await`; using `checkpoint.beforeRef`, NOT `afterRef`).
- [ ] The preceding "CRITICAL #3" JSDoc comment (lines ~843-848) is rewritten to: name the change
      (BUG-004 fix, P1.M4.T2.S1), cite spec/14 §6 step 2 verbatim, explain WHY the heuristic was wrong
      (modifiedFiles misses python/node/perl/heredoc/awk-modified files → E30 silent-clobber), and state
      the best-effort fail-open semantics (`changedPaths` returns `[]` on error → `dirtyCheck` trivially
      passes → restore proceeds — fail-open, E13/E27).
- [ ] The `ledger` variable is NOT removed and is NOT renamed (still used at renderNote line 786, marker
      persist line 957, mutation-warning gate line 1047, + lines 1065/770/774/778). Only the
      `affectedPaths` source changes.
- [ ] The BUG-001 afterRef conditional (lines 897-905) is UNCHANGED — the `?? checkpoint.beforeRef`
      fallback stays REMOVED; do not reintroduce it.
- [ ] `store.dirtyCheck(afterRef, affectedPaths)` call site is UNCHANGED (it now receives the correct set).
- [ ] `npm run typecheck`: 0 errors.
- [ ] `npm test`: full suite green.
- [ ] NO changes to `store.ts`, `git.ts`, `cas.ts`, `dirtyCheck`, `doRestore`, `restore()`,
      `revertBlock`/`revertClause`/`revertRefused`/`revertSummaryDetails`, markers, config, or any test file.

## All Needed Context

### Context Completeness Check

_Passed._ An engineer with zero prior knowledge of this repo can implement this from: (a) the exact line
target (849) and its exact before/after text, (b) the exact in-scope variables (`store`, `checkpoint`,
`affectedPaths`, `ledger` — all already declared in scope), (c) the verbatim replacement JSDoc content,
(d) the spec verbatim quote, (e) the precise scope boundary (what NOT to touch), and (f) the verified
typecheck/test outcomes (0 errors / green). The contract method `changedPaths` is already implemented on
every backend (verified), so the change is a pure single-line swap + comment rewrite — no inference,
guessing, or new code required.

### Documentation & References

```yaml
# MUST READ — the spec the new JSDoc cites VERBATIM
- url: spec/14-working-tree-revert.md (§6 step 2 — the affected-set definition; §6 step 3 — the conditional
    dirty guard; E30 at line 213)
  why: §6 step 2 VERBATIM defines the affected set this line must now use:
    "2. **Determine the affected set** = paths that differ between `beforeRef` and the current tree
    (the files restore would touch)."
  critical: this is THE spec sentence the bug violates and the fix satisfies. E30 (line 213):
    "concurrent/external modification → dirty guard REFUSES the file-revert (`refused[]`)". Quote §6
    step 2 verbatim in the new JSDoc.

# MUST READ — root cause + the exact combined BUG-001+BUG-004 post-fix state
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-004 (Major): Dirty guard affected-set uses heuristic ledger"
  why: confirms root cause (modifiedFiles misses python/node/perl/heredoc/awk; restore reverts the broader
    set; guard inspects a subset → E30 clobber) AND change site #4 = "src/tools/rewind.ts — replace
    `const affectedPaths = ledger.modifiedFiles;` with `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`".
    This item IS change site #4 and nothing else.
  critical: the "Integration with BUG-001 and BUG-004" section shows the COMBINED post-fix code — the
    BUG-001 half (afterRef conditional) is already landed; this item lands the BUG-004 half (affectedPaths
    source). The two touch DIFFERENT lines in the same step-6b block.

# PRIMARY TARGET FILE
- file: src/tools/rewind.ts
  why: THE file to edit. Step 6b ("working-tree revert decision tree") runs the dirty guard. Line 849 is
    the affected-set assignment. Lines 843-848 are its JSDoc ("CRITICAL #3"). The BUG-001 afterRef
    conditional (lines 897-905) is already in place. Lines 836 (`const store = rt?.store;`) and 839
    (`const checkpoint = rt?.snapshots?.get(key);`) are the in-scope consts.
  pattern: the dirty guard already `await`s `store.dirtyCheck(afterRef, affectedPaths)` (line ~901) and
    `await doRestore()`/`await store.restore(...)` — so adding `await store.changedPaths(...)` is
    structurally identical. The whole step 6b is wrapped in a try/catch (E13 fail-open).
  gotcha: `store` is typed `SnapshotStore` and `changedPaths` is ON the interface (store.ts:112) — the call
    needs NO cast. `checkpoint.beforeRef` is the PRE-span ref (RevertCheckpoint.beforeRef) — pass THIS, not
    afterRef (afterRef is the dirty-guard baseline, a different concept). Do NOT remove or touch `ledger`.

# CONTRACT (read-only — already landed, do NOT edit)
- file: src/snapshot/store.ts (line 112 interface method; line 373 NoOpStore stub)
  why: confirms the exact signature `changedPaths(beforeRef: string): Promise<string[]>`. The NoOpStore
    stub `return [];` keeps the call safe when revert is disabled at detection (store === NoOpStore).
- file: src/snapshot/git.ts (line 490 — GitBackend.changedPaths)
  why: confirms the git impl (`git diff --name-only <beforeRef>`, mutex-serialized, best-effort []). This
    is the backend that powers the BUG-004 repro scenario in the PRD.
- file: src/snapshot/cas.ts (line 858 — CasBackend.changedPaths)
  why: confirms the cas impl (manifest hash-compare + 'cas'-mode tree walk; deliberately NO mtime/size
    short-circuit so a content mutation preserving mtime is still detected — E30 mandate). Both backends
    are best-effort (never reject), which is what makes the fail-open degradation correct.

# DEPENDENCY PRPs (both Complete — their outputs are already in the tree)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M1T1S1/PRP.md
  why: the BUG-001 fix (afterRef conditional). Its output is the `const afterRef = checkpoint.afterRef;
    if (afterRef) { ... } else { await doRestore(); }` block at rewind.ts:897-905 — ALREADY in place. This
    item MUST NOT touch it and MUST NOT reintroduce the `?? checkpoint.beforeRef` fallback.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S1/PRP.md
  why: the changedPaths interface + NoOpStore stub (store.ts:112/373). ALREADY landed.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S2/PRP.md
  why: GitBackend.changedPaths (git.ts:490). ALREADY landed.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T1S3/PRP.md
  why: CasBackend.changedPaths (cas.ts:858). ALREADY landed (parallel context item; verified present).
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts          # SnapshotStore.changedPaths (line 112) + NoOpStore stub (line 373)  [S1 — DONE]
  git.ts            # GitBackend.changedPaths (line 490)                                  [S2 — DONE]
  cas.ts            # CasBackend.changedPaths (line 858)                                  [S3 — DONE]
src/tools/
  rewind.ts         # ← EDIT line 849 + rewrite JSDoc lines 843-848 (PRIMARY + ONLY deliverable)
test/
  tools/rewind.test.ts                    # rewind unit tests (validate green; do NOT edit)
  integration/revert-git.test.ts          # F-revert-* integration (validate green; do NOT edit)
  integration/revert-cas.test.ts          #   "     "
  integration/revert-edge.test.ts         #   "     "
  integration/revert-explicit.test.ts     #   "     "
```

### Desired Codebase tree with files to be added/changed

```bash
src/tools/rewind.ts   # MODIFIED — line 849 source swap + lines 843-848 JSDoc rewrite (2 edits, same file)
# (no new files; no test edits; no backend/interface edits)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — the `await` is REQUIRED (changedPaths is async). The OLD line was a synchronous array
//   read (`ledger.modifiedFiles`); the NEW one is an async store call. Omitting `await` would assign a
//   Promise<string[]> to `affectedPaths`, which `dirtyCheck(afterRef, Promise)` would then mis-handle
//   (paths would be a Promise object, `.length` undefined → dirtyCheck returns [] early → guard ALWAYS
//   passes → E30 hole re-opens AND tsc would error on the type mismatch). ALWAYS `await store.changedPaths(...)`.

// CRITICAL #2 — pass `checkpoint.beforeRef` (the PRE-span ref), NOT `afterRef` (the post-span ref). They
//   are DIFFERENT concepts: `beforeRef` = the snapshot restore reverts TO (the affected set = files
//   differing from THIS); `afterRef` = the dirty-guard baseline dirtyCheck compares against. The current
//   dirtyCheck call `store.dirtyCheck(afterRef, affectedPaths)` is CORRECT and UNCHANGED — only the
//   affectedPaths SOURCE swaps to `checkpoint.beforeRef`. (Spec/14 §6 step 2: "paths that differ between
//   beforeRef and the current tree".)

// CRITICAL #3 — `store` needs NO cast. `store` is typed `SnapshotStore`; `changedPaths` is declared on
//   that interface (store.ts:112). Unlike the `(store as unknown as CasBackend)` casts elsewhere (which
//   reach CasBackend-ONLY methods like capture-with-explicitPaths / appendExplicitPath / notifyBashUsed),
//   `changedPaths` is part of the public contract — call it directly: `store.changedPaths(...)`. Adding a
//   cast here would be wrong AND would defeat the interface contract S1 established.

// CRITICAL #4 — the `ledger` variable is STILL USED. Do NOT remove it, rename it, or delete the
//   `extractFileLedger` import. After this change `ledger` still drives: renderNote (line 786), the marker
//   payload persist (line 957 — `ledger,`), the mutation-warning gate (line 1047 —
//   `ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0`), and the step-5 preview +
//   emptyLedger fallback (lines 770/774/778). ONLY the single `affectedPaths` source changes.

// CRITICAL #5 — fail-open is CORRECT, do not "harden" it. If `changedPaths` errors it returns `[]`
//   (E27 best-effort, both backends). `affectedPaths = []` → `dirtyCheck(afterRef, [])` → both backends
//   early-return `[]` on empty paths → guard trivially passes → restore PROCEEDS. This is the intended
//   degradation: a snapshot-diff IO hiccup must NOT block the context rewind (E13/E27). A hypothetical
//   THROWN changedPaths (shouldn't happen) is caught by the enclosing step-6b try/catch (E13 skip notice).
//   Do NOT add a separate try/catch around the changedPaths call — the existing step-6b try/catch already
//   covers it, and failing-open matches every other store call in this block (dirtyCheck, restore).

// CRITICAL #6 — the BUG-001 afterRef conditional (lines 897-905) is DONE. This item does NOT touch it.
//   The `?? checkpoint.beforeRef` fallback is GONE — keep it gone. After this item the step-6b guard reads:
//     const affectedPaths = await store.changedPaths(checkpoint.beforeRef);   // BUG-004 (this item)
//     const afterRef = checkpoint.afterRef;                                   // BUG-001 (already landed)
//     if (afterRef) { drifted = await store.dirtyCheck(afterRef, affectedPaths); ... }
//     else { await doRestore(); }                                             // checkpoint granularity — guard skipped
//   This is the COMBINED post-fix state in architecture/bug_fix_analysis.md §"Integration with BUG-001
//   and BUG-004".

// CONVENTION #1 — JSDoc style matches the surrounding step-6b comments (dense multi-line `//` blocks,
//   spec cites with @14/§N notation, [BUG-NNN fix, P1.MX.TY.SZ] attribution tags, CRITICAL #N markers).
//   Keep the "CRITICAL #3:" label (it is referenced conceptually) but update its body. The existing tag
//   "[BUG-004 / P1.M4 will later derive this from store.changedPaths(beforeRef) — left as the heuristic
//   here, unchanged by BUG-001.]" is now STALE — it described the pre-fix state; rewrite it to describe
//   the post-fix state.

// CONVENTION #2 — the assignment line stays a single `const` (not `let`). `affectedPaths` is never
//   reassigned; it is read once by `dirtyCheck`. The old line was `const affectedPaths = ...;` — keep
//   `const`.
```

## Implementation Blueprint

### Data models and structure

No data models. No types. No new exports. `changedPaths` exchanges only primitives already defined by the
landed S1/S2/S3 work: `beforeRef: string` (the same opaque ref type `restore()`/`dirtyCheck()` take) →
`Promise<string[]>` (workspace-relative POSIX paths, the same shape as every `RestoreResult` bucket and
`dirtyCheck`'s return). The `affectedPaths` local keeps its existing type (`string[]`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — swap the affectedPaths source (line 849) + rewrite its JSDoc (lines 843-848)
  - FIND: step 6b, branch (5)+(6), the block starting `// CRITICAL #3: affectedPaths = ledger.modifiedFiles ...`
    through `const affectedPaths = ledger.modifiedFiles;` (currently lines ~843-849). It sits AFTER the
    `} else {` that opened branch (5)+(6) (the `const store = rt?.store;` / `const checkpoint =
    rt?.snapshots?.get(key);` / `if (!store || !checkpoint) {...} else {...` resolution) and BEFORE the
    `doRestore` async-closure definition.
  - REPLACE the 6-line JSDoc comment + the assignment with the post-fix versions below. Do this as ONE
    edit (the comment and the assignment are contiguous and the comment references the assignment).

    OLD (verbatim, lines ~843-849 — match exactly):
            // CRITICAL #3: affectedPaths = ledger.modifiedFiles (the only deterministic file list available at
            //     this point — the SnapshotStore exposes no diff/listChanged method). Best-effort approximation
            //     of "files restore would touch"; documented limitation in the PRP. Passing [] would make git.ts
            //     trivially return [] (guard always passes), so modifiedFiles (possibly empty) is strictly better.
            //     [BUG-004 / P1.M4 will later derive this from store.changedPaths(beforeRef) — left as the
            //     heuristic here, unchanged by BUG-001.]
            const affectedPaths = ledger.modifiedFiles;

    NEW (verbatim replacement — cite spec §6 step 2, explain BUG-004 + fail-open):
            // CRITICAL #3 [BUG-004 fix, P1.M4.T2.S1]: affectedPaths = the snapshot diff
            //     store.changedPaths(checkpoint.beforeRef) — the spec-mandated affected set (spec/14 §6 step 2
            //     VERBATIM: "paths that differ between beforeRef and the current tree (the files restore would
            //     touch)"). REPLACES the heuristic ledger.modifiedFiles (BUG-004): modifiedFiles MISSES files
            //     mutated via python -c / node / perl -i / heredocs / awk -i inplace (those land in
            //     ledger.bashSideEffects), so the guard used to inspect a SUBSET of what restore() reverts → a
            //     concurrent human edit to such a file was silently clobbered (E30 — "never silently clobbers
            //     concurrent edits"). changedPaths returns EVERY workspace path differing between the pre-span
            //     snapshot and the current tree — exactly what restore() will touch — so the guard now inspects
            //     the true affected set. It is async + BEST-EFFORT (E27): returns [] on any error → dirtyCheck
            //     trivially passes → restore proceeds (fail-open, E13 — a snapshot-diff hiccup never blocks the
            //     rewind; a hypothetical throw is caught by the enclosing step-6b try/catch → skip notice). The
            //     `ledger` var is STILL used elsewhere (note render, mutation warning, marker persist) — only
            //     the affectedPaths source changes here. store.dirtyCheck(afterRef, affectedPaths) below is
            //     UNCHANGED; it now receives the correct affected set. (checkpoint.beforeRef is the PRE-span ref
            //     restore reverts TO; afterRef is the dirty-guard baseline — different concepts.)
            const affectedPaths = await store.changedPaths(checkpoint.beforeRef);

  - VERIFY after the edit:
      grep -n "affectedPaths" src/tools/rewind.ts
      # EXPECTED: exactly two hits — the new assignment (await store.changedPaths) + the dirtyCheck call.
      # NO remaining `ledger.modifiedFiles` read in the affectedPaths context (the mutation-warning gate at
      # ~line 1047 still reads ledger.modifiedFiles — that is CORRECT and unrelated; leave it).
      grep -n "ledger.modifiedFiles" src/tools/rewind.ts
      # EXPECTED: hits only at the mutation-warning gate (~line 1047) — NOT at the affectedPaths line.

Task 2: VALIDATE (see Validation Loop) — confirm 0 typecheck errors + full green suite.

Task 3 (OUT OF SCOPE — do NOT do): NO new test, NO E30 integration test (that is P1.M4.T2.S2 — it requires
  this wiring to be in place first, which is exactly what this item provides). NO backend/interface edits
  (S1/S2/S3 are landed). NO ledger removal. NO afterRef / doRestore / restore() / marker changes.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — the change is a single-line source swap. The OLD line and its successor in the SAME block:
//   OLD:  const affectedPaths = ledger.modifiedFiles;                                   // heuristic, sync
//   NEW:  const affectedPaths = await store.changedPaths(checkpoint.beforeRef);          // snapshot diff, async
//
// Both `store` and `checkpoint` are already `const`-declared + non-null-narrowed earlier in branch (5)+(6):
//     const store = rt?.store;                         // line 836 — SnapshotStore, non-null after the
//                                                       //   `if (!store || !checkpoint) {...}` early return
//     const checkpoint = rt?.snapshots?.get(key);      // line 839 — RevertCheckpoint, has .beforeRef
// `store.changedPaths` needs NO cast (it is on the SnapshotStore interface). `checkpoint.beforeRef` is the
//   pre-span ref (the same ref `store.restore(checkpoint.beforeRef, ...)` uses inside doRestore).

// PATTERN — the dirty-guard call site is UNCHANGED (it was already async-awaiting; it now just gets a
//   correct affected set):
//     const afterRef = checkpoint.afterRef;             // BUG-001 (already landed) — no ?? beforeRef fallback
//     if (afterRef) {
//       const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);   // affectedPaths now the diff
//       if (driftedPaths.length > 0) { /* REFUSE whole revert — E30 */ }
//       else { await doRestore(); }
//     } else {
//       await doRestore();                               // checkpoint granularity — guard skipped (BUG-001)
//     }

// CRITICAL — why this is fail-safe by construction:
//   - `changedPaths` is E27 best-effort on BOTH backends (git.ts:507 + cas.ts:932 warn + return [] on any
//     error; inner catch for missing/corrupt manifest). So `affectedPaths` is ALWAYS a string[] (never a
//     rejected Promise) → `dirtyCheck(afterRef, string[])` is well-typed and well-behaved.
//   - The `await` keeps `affectedPaths` a `string[]` at runtime (not a Promise) → `dirtyCheck`'s
//     `paths.length` check works. Forgetting `await` (GOTCHA #1) is the one error that would both re-open
//     the hole AND fail typecheck.
```

### Integration Points

```yaml
REWIND TOOL (src/tools/rewind.ts — step 6b, branch (5)+(6)):
  - change: "line 849 `const affectedPaths = ledger.modifiedFiles;` →
    `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`"
  - sibling change: "rewrite the preceding CRITICAL #3 JSDoc (lines 843-848) to document the swap"
  - depends_on: "P1.M1.T1.S1 (BUG-001 afterRef conditional — landed at lines 897-905) +
    P1.M4.T1.S1/S2/S3 (changedPaths on store.ts/git.ts/cas.ts — landed)"
SNAPSHOT STORE (src/snapshot/*.ts): UNCHANGED (S1/S2/S3 already landed the method + impls).
LEDGER (src/ledger.ts): UNCHANGED (the `ledger` var + FileLedger type stay; only the affectedPaths
  consumer of ledger.modifiedFiles changes — and only THAT one read site).
DATABASE / CONFIG / ROUTES / MARKERS: none (Mode A — one production line + one comment block).
TYPECHECK: expected_state "0 errors" (changedPaths is declared on SnapshotStore and implemented on all
  backends; the call typechecks with no cast; `store` is non-null-narrowed in scope).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# THE primary gate. Run after Task 1. Confirms the async call typechecks (changedPaths is on the interface)
# and that no `await` was forgotten (a missing await → `affectedPaths: Promise<string[]>` → type error
# at the dirtyCheck call site).
npm run typecheck          # tsc --noEmit
# EXPECTED: ZERO errors.
# If you see TS2339 "Property 'changedPaths' does not exist on type 'SnapshotStore'" → S1 did not land;
#   verify `grep -n "changedPaths" src/snapshot/store.ts` returns the interface method (line 112). If it
#   is missing, STOP — this item's dependency (P1.M4.T1.S1) is not complete; it must land first.
# If you see TS2322 "Type 'Promise<string[]>' is not assignable to type 'string[]'" at the affectedPaths
#   line → you forgot `await`. Add it: `const affectedPaths = await store.changedPaths(...)`.
# If you see TS2345 "Argument of type 'X' is not assignable to parameter of type 'string'" at the
#   changedPaths call → you passed `afterRef` instead of `checkpoint.beforeRef` (or a typo). Use
#   `checkpoint.beforeRef`.

# Confirm the edit is surgical (only rewind.ts changed):
git diff --name-only
# EXPECTED: exactly `src/tools/rewind.ts` — nothing else. If store.ts/git.ts/cas.ts/any test file appears,
#   STOP — you are out of scope; revert those files.
```

### Level 2: Unit + Integration Tests (Component Validation)

```bash
# The rewind tool unit tests (exercises rewindExecute end-to-end including step 6b):
npx vitest run test/tools/rewind.test.ts
# Expected: green. If a test asserts the OLD heuristic behavior (e.g. a bash-modified file NOT being
#   guarded), that test is asserting on the BUG and is wrong — fix the TEST to match corrected E30 behavior
#   (the file should now be refused if it drifted). But per the PRD no such test exists (the E30 gap is the
#   P1.M4.T2.S2 item). Ordinary rewinds (write/edit tools, or empty spans) behave identically.

# The F-revert-* integration suite (the dirty-guard + restore paths, both backends):
npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-edge.test.ts test/integration/revert-explicit.test.ts
# Expected: green. These exercise the proceed/refuse/skip branches. A flip here would mean a test set up a
#   post-turn edit on a bash-side-effect file and asserted it was silently reverted — that is the bug; the
#   test should be corrected (not the code reverted). None is expected to exist per the PRD.

# Full suite — no behavioral regression anywhere:
npm test
# Expected: all green (1331+ tests). changedPaths was previously uncalled; wiring it changes refuse/proceed
#   ONLY for the E30 concurrent-edit-on-bash-modified-file case, which no existing test covers.
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable for a production-line wiring with no new test (the E30 integration test is P1.M4.T2.S2,
# which consumes this item's output). The unit + F-revert-* suite above IS the system validation for this
# change. The targeted manual E30 repro (a python-written file + a post-turn human edit → now refused)
# belongs in P1.M4.T2.S2.
```

### Level 4: Domain-Specific Validation (manual reasoning check — the BUG-004 closure proof)

```bash
# Reasoning check (no command needed — this is the correctness argument the P1.M4.T2.S2 test will codify):
#   BEFORE this item: agent writes b.ts via `python -c "open('b.ts','w').write('agent-version')"`.
#     → extractFileLedger: modifiedFiles=[] (python -c is a bashSideEffect, not parseable).
#     → affectedPaths = ledger.modifiedFiles = [] → dirtyCheck(afterRef, []) = [] → PROCEED.
#     → human then edits b.ts='HUMAN-EDIT' (drift vs afterRef) → still PROCEED → restore overwrites it.
#     → BUG: HUMAN-EDIT destroyed (E30 violation).
#   AFTER this item: same scenario.
#     → affectedPaths = await store.changedPaths(beforeRef) = ['b.ts'] (b.ts differs from pre-turn snapshot).
#     → dirtyCheck(afterRef, ['b.ts']) compares current 'HUMAN-EDIT' vs afterRef 'agent-version' → ['b.ts'].
#     → driftedPaths.length > 0 → REFUSE the whole file-revert; b.ts stays 'HUMAN-EDIT'; context rewind
#       still proceeds. → E30 SATISFIED.
#   This is exactly the closure the PRD BUG-004 repro demands. P1.M4.T2.S2 writes the automated test.
```

## Final Validation Checklist

### Technical Validation

- [ ] `src/tools/rewind.ts:849` is `const affectedPaths = await store.changedPaths(checkpoint.beforeRef);`
      (with `await`; using `checkpoint.beforeRef`; `const` not `let`).
- [ ] The preceding "CRITICAL #3" JSDoc (lines ~843-848) is rewritten to cite spec/14 §6 step 2 verbatim,
      explain the BUG-004 heuristic error + E30, and document the best-effort fail-open semantics.
- [ ] `npm run typecheck`: 0 errors.
- [ ] `npm test`: full suite green (1331+).
- [ ] `npx vitest run test/tools/rewind.test.ts`: green.
- [ ] `npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-edge.test.ts test/integration/revert-explicit.test.ts`: green.
- [ ] `git diff --name-only` shows ONLY `src/tools/rewind.ts`.

### Feature Validation

- [ ] The `ledger` variable is untouched (still used at renderNote line 786, marker persist line 957,
      mutation-warning gate line 1047, + step-5 preview/fallback). `grep -n "\bledger\b" src/tools/rewind.ts`
      shows the same hits as before.
- [ ] The BUG-001 afterRef conditional (lines 897-905) is unchanged — the `?? checkpoint.beforeRef`
      fallback is NOT reintroduced.
- [ ] `store.dirtyCheck(afterRef, affectedPaths)` is unchanged (now receives the snapshot-diff set).
- [ ] `doRestore` / `store.restore()` / `revertBlock` / `revertClause` / `revertRefused` /
      `revertSummaryDetails` are unchanged.
- [ ] No cast was added to the `store.changedPaths(...)` call (it is on the public interface).

### Code Quality Validation

- [ ] The JSDoc matches the surrounding step-6b comment style (dense `//` block, spec cites with @14/§N,
      [BUG-NNN fix, P1.MX.TY.SZ] attribution, CRITICAL #N marker).
- [ ] The stale "[BUG-004 / P1.M4 will later derive this… left as the heuristic here]" tag is GONE
      (it described the pre-fix state; the new comment describes the post-fix state).
- [ ] No new exported types; no new files; no test edits; no backend/interface edits.

### Documentation & Deployment

- [ ] The rewritten CRITICAL #3 JSDoc is self-documenting: a future reader sees WHY changedPaths is used,
      WHAT it replaces, and WHY it is fail-open (no need to cross-reference the PRP).
- [ ] No env vars / config / migrations / API-surface change (Mode A).

---

## Anti-Patterns to Avoid

- ❌ **Don't forget `await`.** `changedPaths` is async (`Promise<string[]>`). Without `await`,
  `affectedPaths` becomes a `Promise<string[]>`, `dirtyCheck(afterRef, <Promise>)` reads `paths.length` as
  `undefined` → returns `[]` early → the guard ALWAYS passes → the E30 hole re-opens. `tsc` WILL catch this
  (TS2322 at the assignment), so a green typecheck is the proof `await` is present. Always write
  `await store.changedPaths(checkpoint.beforeRef)`.
- ❌ **Don't pass `afterRef` instead of `checkpoint.beforeRef`.** They are different: `beforeRef` is the
  pre-span snapshot (the set of files differing from THIS is the affected set); `afterRef` is the
  dirty-guard baseline. Spec/14 §6 step 2 mandates `beforeRef`. The dirtyCheck call (unchanged) correctly
  uses `afterRef` as ITS baseline. Don't conflate the two.
- ❌ **Don't add a cast to `store.changedPaths(...)`.** `changedPaths` is declared on the `SnapshotStore`
  interface (store.ts:112); `store` is typed `SnapshotStore`. A cast (`as GitBackend` / `as CasBackend` /
  `as unknown as X`) is both unnecessary and wrong here — it would defeat the public contract S1
  established. (The `as unknown as CasBackend` casts elsewhere in the codebase reach CasBackend-ONLY
  methods like `capture`-with-explicitPaths / `appendExplicitPath` / `notifyBashUsed`; changedPaths is NOT
  such a method.)
- ❌ **Don't remove or rename the `ledger` variable.** It is still used for note rendering, marker
  persistence, and the mutation-warning gate. Only the single `affectedPaths` read of
  `ledger.modifiedFiles` is replaced. Removing `ledger` would break the marker contract (RewindMarker.ledger)
  and the E5 mutation warning.
- ❌ **Don't "harden" the fail-open behavior.** If `changedPaths` errors it returns `[]` (E27 best-effort,
  both backends). `affectedPaths = []` → `dirtyCheck` trivially passes → restore proceeds. This is the
  CORRECT degradation (a snapshot-diff IO hiccup must not block the rewind — E13/E27). Do NOT wrap the call
  in its own try/catch that refuses-on-error — that would make a transient IO error silently disable file
  revert for the user (worse than fail-open). The enclosing step-6b try/catch already covers a throw.
- ❌ **Don't touch the BUG-001 afterRef conditional.** P1.M1.T1.S1 (Complete) removed the
  `?? checkpoint.beforeRef` fallback and made the guard conditional on `afterRef`. Do NOT reintroduce the
  fallback (it re-introduces BUG-001 — checkpoint reverts refused). This item and BUG-001 touch DIFFERENT
  lines in the same block; leave the afterRef lines alone.
- ❌ **Don't write the E30 integration test here.** That is P1.M4.T2.S2 (it consumes this item's output —
  the wiring must be in place first). This item ships ONE production line + ONE comment block only.
- ❌ **Don't edit `store.ts` / `git.ts` / `cas.ts`.** S1/S2/S3 are already landed. `git diff --name-only`
  must show only `src/tools/rewind.ts`.
- ❌ **Don't change `dirtyCheck`, `doRestore`, `restore()`, or the revert accumulators.** The dirtyCheck
  call is unchanged — it now simply receives the correct affected set. The proceed/refuse/skip branches,
  the success-text clause, and the marker revert block are all unchanged.

---

## Confidence Score

**9.5/10** — This is a single production-line swap (`ledger.modifiedFiles` → `await store.changedPaths
(checkpoint.beforeRef)`) plus a comment rewrite, where: (a) the contract method is ALREADY fully
implemented on all backends (verified by grep: store.ts:112/373, git.ts:490, cas.ts:858), so the call
typechecks with no cast; (b) the BUG-001 dependency it shares the step-6b block with is ALREADY landed
(afterRef conditional at lines 897-905), so the combined post-fix state is reached by this one edit; (c)
both in-scope variables (`store`, `checkpoint`) are already const-declared and non-null-narrowed earlier in
the same branch; (d) the call is structurally identical to the already-present `await store.dirtyCheck(...)`
in the same block (async, inside the existing try/catch); (e) the behavioral change is provably limited to
the E30 concurrent-edit-on-bash-modified-file case (ordinary rewinds proceed identically — files match
afterRef so dirtyCheck returns []), and no existing test exercises that case (it is the P1.M4.T2.S2 gap).
The two highest-stakes traps — omitting `await` (re-opens the hole, but tsc catches it) and passing
`afterRef` instead of `checkpoint.beforeRef` (wrong affected set) — are both covered by explicit typecheck
expectations in the Validation Loop. The remaining 0.5 is residual risk that an existing revert integration
test sets up the exact E30 scenario and asserts the buggy PROCEED (none is expected per the PRD, but it
would surface immediately in the Level 2 suite with a clear correction path: fix the test to assert REFUSE).