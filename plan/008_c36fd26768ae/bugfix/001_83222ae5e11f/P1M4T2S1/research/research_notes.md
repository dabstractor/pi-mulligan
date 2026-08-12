# Research Notes — P1.M4.T2.S1

## Item
Replace `ledger.modifiedFiles` with `await store.changedPaths(checkpoint.beforeRef)` in
`src/tools/rewind.ts` step 6b (BUG-004 fix — the rewind wiring).

## Key findings (verified against the working tree)

### 1. The contract method is ALREADY FULLY IMPLEMENTED in the working tree
- `src/snapshot/store.ts:112` — interface: `changedPaths(beforeRef: string): Promise<string[]>;` (S1, DONE)
- `src/snapshot/store.ts:373` — NoOpStore stub: `async changedPaths(_beforeRef): Promise<string[]> { return []; }` (S1, DONE)
- `src/snapshot/git.ts:490` — GitBackend.changedPaths (`git diff --name-only <beforeRef>`, mutex-serialized, best-effort) (S2, DONE)
- `src/snapshot/cas.ts:858` — CasBackend.changedPaths (manifest hash-compare + 'cas'-mode tree walk; NO mtime/size short-circuit) (S3, DONE — note: plan_status still marks S3 "Ready" but the code is present)
- ⇒ This item is PURELY the wiring. No backend/interface work remains.

### 2. The EXACT target line (src/tools/rewind.ts:849)
```typescript
// CRITICAL #3: affectedPaths = ledger.modifiedFiles (the only deterministic file list available at
//     this point — the SnapshotStore exposes no diff/listChanged method). Best-effort approximation
//     of "files restore would touch"; documented limitation in the PRP. Passing [] would make git.ts
//     trivially return [] (guard always passes), so modifiedFiles (possibly empty) is strictly better.
//     [BUG-004 / P1.M4 will later derive this from store.changedPaths(beforeRef) — left as the
//     heuristic here, unchanged by BUG-001.]
const affectedPaths = ledger.modifiedFiles;
```
→ becomes:
```typescript
const affectedPaths = await store.changedPaths(checkpoint.beforeRef);
```
(+ rewritten CRITICAL #3 JSDoc documenting the change — Mode A DOCS requirement)

### 3. The BUG-001 fix (dependency) is ALREADY APPLIED (P1.M1.T1.S1 = Complete)
Lines ~897-905 in the SAME step-6b block:
```typescript
const afterRef = checkpoint.afterRef;       // NO `?? checkpoint.beforeRef` fallback (BUG-001 removed it)
if (afterRef) {
  const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
  ... // refuse on drift; else proceed
} else {
  await doRestore();                        // checkpoint granularity — guard skipped
}
```
So the combined BUG-001+BUG-004 state (per architecture/bug_fix_analysis.md §"Integration with
BUG-001 and BUG-004") is reached by this single-line swap. The `?? checkpoint.beforeRef` fallback is
already gone — DO NOT reintroduce it.

### 4. Scope variables are in-scope and const-narrowed
Inside branch (5)+(6) of step 6b:
- `const store = rt?.store;` (line 836) — the SnapshotStore; the enclosing `if (!store || !checkpoint)`
  early-return guarantees `store` is defined here. `changedPaths` is on the interface → callable without cast.
- `const checkpoint = rt?.snapshots?.get(key);` (line 839) — has `.beforeRef` (RevertCheckpoint type).
- `affectedPaths` is consumed at EXACTLY ONE site: `store.dirtyCheck(afterRef, affectedPaths)`.
  Changing its source breaks nothing else.

### 5. The `ledger` variable is STILL USED elsewhere — DO NOT remove it
`ledger` usages that remain valid after this change:
- line 786 — `renderNote(params.note, ledger, granularity)` context
- line 957 — marker payload `ledger,` (persisted for audit/rewind-marker contract)
- line 1047 — mutation-warning gate `ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0`
- line 1065 — (also in marker/details path)
- lines 770/774/778 — the step-5 preview assignment + emptyLedger fallback
⇒ Only the `affectedPaths` SOURCE changes. The `ledger` object itself is untouched.

### 6. Async + best-effort semantics (the non-obvious part)
- `changedPaths` is `async` → the assignment needs `await`. The step-6b branch is already in an
  `async` function and already `await`s `store.dirtyCheck`/`store.restore`, so adding `await` is
  structurally consistent.
- `changedPaths` is BEST-EFFORT (E27): it NEVER rejects — returns `[]` on any error (both backends:
  inner catch for missing/corrupt manifest, outer catch warn+[] for anything else).
- Degradation chain when changedPaths fails → `affectedPaths = []` → `dirtyCheck(afterRef, [])`
  → both backends' dirtyCheck early-return `[]` on an empty `paths` array → guard trivially passes →
  restore PROCEEDS. This is FAIL-OPEN (E13/E27: the rewind ALWAYS completes; revert is best-effort).
  This is the CORRECT degradation direction (the revert subsystem's overriding rule forbids a revert
  hiccup from blocking a context rewind). The OLD heuristic (modifiedFiles) was a sync array that never
  "failed"; the NEW one can return [] — but the fail-open behavior matches the subsystem contract.
- Even a hypothetical THROWN changedPaths (shouldn't happen) is caught by the enclosing step-6b inner
  `try/catch` (line ~936) → E13 skip notice "an error occurred — 0 files reverted". Safe.

### 7. Behavioral correctness (why this fixes E30)
OLD affected set = `ledger.modifiedFiles` (write/edit + parseable bash targets: sed/cp/mv/tee/redirect).
Files mutated via `python -c`, `node script.js`, `perl -i`, heredocs, `awk -i inplace` land in
`ledger.bashSideEffects`, NOT modifiedFiles → NOT inspected by dirtyCheck.
NEW affected set = `changedPaths(beforeRef)` = EVERY file differing between the pre-turn snapshot and
the CURRENT tree = exactly what `restore()` will touch (spec/14 §6 step 2 VERBATIM: "paths that differ
between beforeRef and the current tree (the files restore would touch)"). This INCLUDES python/node/
perl/heredoc-modified files. So a concurrent human edit (post agent_end) to such a file now drifts vs
afterRef → dirtyCheck returns it → the WHOLE revert is REFUSED (E30 — never silently clobber).

For files NOT edited by a human post-turn: changedPaths(beforeRef) includes them, but dirtyCheck(afterRef,
[...]) compares them vs the post-turn baseline → they match (clean) → PROCEED. So ordinary (no concurrent
edit) rewinds behave IDENTICALLY — only the silent-clobber case changes (bug → correct refuse).

### 8. Existing-test risk assessment
- `changedPaths` is not yet called by ANY production path (grep confirms only the comment + backend
  defs). So no test currently exercises the wired behavior.
- The change only alters refuse/proceed decisions when there is POST-TURN drift on a file that the
  agent modified via a non-parseable bash command. Per the PRD Overview + h2.2 BUG-004, NO existing
  test sets up that scenario (the E30 gap is what P1.M4.T2.S2 will ADD). Existing F-revert-* tests use
  write/edit tools (whose paths ARE in modifiedFiles) or empty spans → affected set is equivalent →
  no decision flip.
- ⇒ `npm test` is expected to stay fully green. If a revert integration test flips, it is asserting on
  the bug (a post-turn edit being silently reverted) — that test is wrong and should be fixed to match
  the corrected E30 behavior, NOT to re-suppress the guard.

### 9. Scope boundaries (what NOT to do)
- DO NOT add the E30 bash/python integration test → that is P1.M4.T2.S2.
- DO NOT touch store.ts/git.ts/cas.ts (S1/S2/S3 — DONE).
- DO NOT touch the afterRef conditional (BUG-001 — DONE).
- DO NOT touch doRestore / restore() / revertBlock / revertSummaryDetails / revertClause / revertRefused.
- DO NOT remove or alter the `ledger` variable (still used — see #5).
- DO NOT change the dirtyCheck signature or call site (unchanged; it now receives the correct set).

## Spec verbatim (spec/14-working-tree-revert.md §6 step 2)
> 2. **Determine the affected set** = paths that differ between `beforeRef` and the current tree (the files restore would touch).

## Spec E30 (line 213)
> **E30** concurrent/external modification → dirty guard REFUSES the file-revert (`refused[]`); post-turn
> drift (via `agent_end` after-ref) is caught; ...

## Validation commands (verified against package.json scripts)
- `npm run typecheck` (tsc --noEmit) — expect 0 errors.
- `npm test` (vitest run) — full suite green.
- `npx vitest run test/tools/rewind.test.ts` — rewind tool unit tests.
- `npx vitest run test/integration/revert-git.test.ts test/integration/revert-cas.test.ts test/integration/revert-edge.test.ts test/integration/revert-explicit.test.ts` — the F-revert-* integration suite.