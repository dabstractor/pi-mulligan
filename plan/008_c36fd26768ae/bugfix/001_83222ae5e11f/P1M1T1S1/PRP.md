---
name: "P1.M1.T1.S1 — Remove beforeRef fallback for checkpoint dirty guard in rewind.ts step 6b (BUG-001)"
description: >
  Fix the critical BUG-001 defect: checkpoint-granularity `mulligan_rewind(...,revert_file_changes:true)`
  was ALWAYS refused when the span actually changed files (its only useful case), because the dirty-guard
  baseline fell back to `checkpoint.beforeRef` (the pre-checkpoint tree) when `afterRef` was absent.
  Per spec/14 §6 step 3 the dirty guard is CONDITIONAL on `afterRef` existing — checkpoints capture once
  and never set `afterRef`, so the guard must be SKIPPED (and restore proceed) when `afterRef` is absent.
  A single, isolated edit to `src/tools/rewind.ts` step 6b. No new exports. Turn-granularity path stays
  byte-identical (afterRef always exists there).
---

## Goal

**Feature Goal**: `mulligan_rewind(granularity:"checkpoint", checkpoint:X, revert_file_changes:true)`
restores working-tree files to the checkpoint's pre-span state when the span actually contains file
changes — instead of always refusing because the agent's own intervening work is mis-detected as
"drift" against the wrong baseline.

**Deliverable**: A single source edit to `src/tools/rewind.ts` step 6b that:
1. Reads `const afterRef = checkpoint.afterRef;` (NO `?? checkpoint.beforeRef` fallback).
2. Runs the existing dirty guard + refuse/proceed logic ONLY when `afterRef` is truthy (the
   `last_turn` case — `afterRef` is set post-`agent_end`).
3. When `afterRef` is falsy (the `checkpoint` case — checkpoints capture once, no `afterRef`),
   SKIPS the dirty guard entirely and proceeds directly to `store.restore(checkpoint.beforeRef, opts)`
   with the SAME result-folding code.
4. Factors the restore + result-folding block into a local closure (`doRestore`) so it runs on BOTH
   the clean-afterRef branch and the no-afterRef branch — no duplicated body.
5. Updates the JSDoc/inline comment on the `afterRef` resolution line to record the BUG-001 fix and
   the spec/14 §6 step 3 conditional.

**Success Definition**:
- The BUG-001 repro from the analysis (git repo → checkpoint `x` → `write a.ts 'A1\n'` →
  `agent_end` → `mulligan_rewind(granularity:'checkpoint', checkpoint:'x', revert_file_changes:true)`)
  now RESTORES `a.ts` to `'A0\n'` and the result text is the `Reverted 1 file(s)...` proceed clause,
  NOT the `file revert refused: 1 path(s) changed...` clause.
- The `last_turn` path (afterRef always present) is byte-identical in behavior: same `dirtyCheck`
  call, same refuse clause text, same restore call, same proceed clause text.
- `npm run typecheck` (tsc --noEmit) and `npm test` (vitest run, full suite) both pass.
- `dirtyCheck` call signature, the `RestoreResult` folding, the `revertClause` text strings, and the
  `revertBlock`/`revertSummaryDetails` shapes are ALL unchanged.

## Why

- BUG-001 (Critical) makes a headline v1.2 capability silently non-functional. The checkpoint-granularity
  file-revert is the operator's primary power tool ("undo everything since I armed checkpoint X"), and
  today it only proceeds in the degenerate case where the span touched NO files (nothing to revert).
- Root cause is a one-line fallback (`checkpoint.afterRef ?? checkpoint.beforeRef`) that contradicts the
  spec's own conditional ("**if `afterRef` exists**, run dirtyCheck"). Removing the fallback + making the
  guard conditional is the spec-literal, minimal fix (Option A from the analysis — skip the guard when
  `afterRef` is absent; no extra capture I/O).
- The fix unblocks P1.M1.T1.S2 (strengthen the F-revert-reload integration test to exercise a real
  checkpoint span with file changes — currently it deliberately engineers the degenerate empty-span case
  and therefore passes despite the bug).

## What

Replace the step-6b dirty-guard + proceed block so the guard is **conditional on `afterRef` existing**
(spec/14 §6 step 3). When absent (checkpoint granularity), skip straight to restore.

### Success Criteria

- [ ] `checkpoint.afterRef ?? checkpoint.beforeRef` (the BUG-001 fallback) is GONE — replaced by
      `const afterRef = checkpoint.afterRef;`.
- [ ] `store.dirtyCheck(...)` runs ONLY inside an `if (afterRef)` block.
- [ ] When `afterRef` is absent, `store.restore(checkpoint.beforeRef, opts)` + the full result folding
      (`revertBlock`, `revertSummaryDetails`, `revertClause`) run via the same code path as the clean
      branch (the `doRestore` closure — no duplicated body).
- [ ] The REFUSE clause text is byte-identical to today.
- [ ] The PROCEED clause text (`Reverted N file(s), deleted M; ... refused (see log).`) is byte-identical.
- [ ] `store.dirtyCheck` call signature unchanged: `store.dirtyCheck(afterRef, affectedPaths)`.
- [ ] `affectedPaths` stays `ledger.modifiedFiles` — BUG-004 (derive from snapshot diff) is a SEPARATE
      milestone (P1.M4) and is OUT OF SCOPE for this task.
- [ ] `npm run typecheck` clean; `npm test` green (full suite).
- [ ] No new exported symbols; no changes outside step 6b of `rewindExecute`.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
before/after code block, the type facts (`RevertCheckpoint.afterRef?: string`), the store method
signatures, the spec citation, and the precise placement (rewind.ts step 6b, branch 5+6) are all below.
The fix touches ONE function in ONE file.

### Documentation & References

```yaml
# MUST READ — the authoritative per-bug diagnosis (root cause, spec violation, exact change site, the
# combined BUG-001+BUG-004 shape so the two fixes don't collide).
- file: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  why: "§BUG-001 has the root cause, the spec/14 §6 step 3 quote, the exact current-code line, and the
        recommended Option-A fix (skip the guard when afterRef is absent). The trailing
        'Integration with BUG-001 and BUG-004' block shows the COMBINED shape — read it to confirm this
        task leaves a clean seam for P1.M4 (BUG-004)."
  critical: "The analysis explicitly recommends Option A (skip the guard) over Option B (capture a
             just-in-time after-ref). Implement Option A — no extra capture I/O, spec-literal."

# MUST READ — the file/function being modified (read the FULL step 6b block first)
- file: src/tools/rewind.ts
  why: "This is the ONLY file modified. The block is `rewindExecute`'s step (6b), currently ~lines
        794-892 (the `let revertClause=''; ... if (wantRevert) { try { ... } }` block). The lines to
        change are the branch-(5)+(6) `else` that resolves `afterRef`, calls `dirtyCheck`, and does the
        refuse/proceed split (currently ~lines 843-889)."
  pattern: "Copy the existing restore+fold body VERBATIM into the new `doRestore` closure — every field
            name, every count, every clause string must match char-for-char (the contract forbids
            changing the folding/clause text)."
  gotcha: "The closure must capture `store` and `checkpoint`, which are `const` (declared just above in
           branch 4+5+6). TypeScript PRESERVES const-narrowing into closures, so `store.restore(...)` /
           `store.describe()` type-check inside `doRestore` without re-narrowing (see Known Gotchas #1).
           `checkpoint` is also const-narrowed to non-undefined. If you instead duplicate the body or
           hoist a module function, you lose that narrowing → type errors."

# MUST READ — the spec authority for the conditional guard
- file: spec/14-working-tree-revert.md
  why: "§6 step 3 is the exact sentence the fix implements: 'if `afterRef` exists, run
        dirtyCheck(afterRef, affected)'. §6 step 3's 'Mid-turn limitation' note confirms the
        no-afterRef path is spec-sanctioned (the guard cannot run; restore proceeds). Cite this in the
        new inline comment."
  section: "§6 Restore semantics — refuse-on-dirty, then restore (steps 1-6 + Mid-turn limitation note)"

# MUST READ — confirm checkpoints NEVER set afterRef (the root cause)
- file: src/commands.ts
  why: "The /mulligan_checkpoint step-4b capture writes `rt.snapshots.set('ckpt:'+name, { label,
        beforeRef: ckptRef, ... })` — NO afterRef field. This is the runtime fact that makes the
        `?? checkpoint.beforeRef` fallback always hit for checkpoints. Read it to confirm; DO NOT change
        it (checkpoints capturing once is correct by design)."
  pattern: "The checkpoint RevertCheckpoint object omits afterRef → RevertCheckpoint.afterRef is
            undefined → the new `if (afterRef)` is false → guard skipped."

# READ — the type facts (afterRef optionality, beforeRef required)
- file: src/markers.ts
  why: "RevertCheckpoint interface: `beforeRef: string; afterRef?: string;` (~line 124-125). Confirms
        afterRef is OPTIONAL — the truthy check `if (afterRef)` is the correct narrowing (string|undefined
        → string). dirtyCheck(afterRef: string, ...) then type-checks inside the block."
  section: "RevertCheckpoint interface (~line 112-126)"

# READ — store method signatures (must NOT change)
- file: src/snapshot/store.ts
  why: "dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>; restore(beforeRef: string,
        opts: RestoreOpts): Promise<RestoreResult>; describe(): {backend,reason?}. These are the exact
        signatures the closure calls — keep them verbatim."
  section: "SnapshotStore interface (~line 61-102), RestoreOpts (~151), RestoreResult (~173)"

# CONTEXT — the degenerate integration test that must still pass (no regression)
- file: test/integration/revert-edge.test.ts
  why: "F-revert-reload currently engineers a checkpoint span with NO file tool calls (empty
        modifiedFiles) → old code: dirtyCheck(beforeRef, []) = [] → PROCEED. New code: afterRef undefined
        → skip guard → doRestore(). BOTH paths call store.restore(checkpoint.beforeRef, opts); with an
        empty span nothing is reverted, so the test's 0-reverted assertion still holds. STRENGTHENING
        this test to a real file-changing span is S2 (a SEPARATE subtask) — NOT this task."
  critical: "S1 must NOT rewrite/expand this integration test. S1 keeps it green. S2 owns the
             strengthening. Do not blur the scope boundary."
```

### Current Codebase tree (relevant slice)

```bash
src/
└── tools/
    └── rewind.ts        # ← THE file modified: step 6b, branch (5)+(6) inside rewindExecute (~lines 843-889)
test/
├── tools/rewind.test.ts
└── integration/revert-edge.test.ts   # degenerate F-revert-reload — must stay GREEN (unchanged in S1)
```

### Desired Codebase tree

```bash
src/
└── tools/rewind.ts      # MODIFIED: step 6b — afterRef fallback removed, guard made conditional,
                         #   restore+fold factored into a `doRestore` closure shared by both branches,
                         #   inline JSDoc updated to cite BUG-001 + spec/14 §6 step 3
```
No new files. No test changes in S1.

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 — TypeScript preserves const-narrowing into closures (THE reason to use a closure).
// `store` is `const store = rt?.store;` (narrowed to SnapshotStore in the `else` after the
// `if (!store || !checkpoint)` guard) and `checkpoint` is `const checkpoint = rt?.snapshots?.get(key);`
// (narrowed to RevertCheckpoint). Inside an `async () => {...}` arrow closure that captures them, TS
// KEEPS the narrowed types BECAUSE they are `const` (never reassigned) — so `store.restore(...)` and
// `store.describe()` type-check WITHOUT re-narrowing. If you instead:
//   - duplicate the body → fine but violates DRY (the contract prefers the factored closure);
//   - hoist a module-level helper → you LOSE the narrowing (store/checkpoint become optional there) →
//     type errors + you'd have to re-narrow by hand.
// => USE the local closure `const doRestore = async () => {...}` declared INSIDE the branch-(5)+(6)
//    else block, after `checkpoint` and `store` are in scope and narrowed.

// GOTCHA #2 — `if (afterRef)` is the correct narrowing for `string | undefined`.
// afterRef is `string | undefined` (RevertCheckpoint.afterRef?). A truthy check `if (afterRef)`
// narrows to `string` (the empty-string "" case can't arise from real refs, so `if (afterRef)` and
// `if (afterRef !== undefined)` are equivalent in practice). dirtyCheck(afterRef: string, ...) then
// type-checks. Do NOT use `if (afterRef != null)` — identical runtime, but `if (afterRef)` reads as
// "a ref exists" which matches the spec's "if afterRef exists".

// GOTCHA #3 — doRestore is async; call it with await.
// The closure returns Promise<void> (it awaits store.restore). Both call sites MUST `await doRestore()`.
// The enclosing step-6b body is already async (rewindExecute is async), so `await` is fine. Forgetting
// `await` would fire-and-forget the restore → revertBlock/revertClause set after the function returns →
// wrong text + undefined revert field. The existing inner try/catch (the catch that sets the skip
// notice) covers a thrown restore (E13 fail-open) — `await` keeps it inside that try.

// GOTCHA #4 — the existing inner try/catch is the E13 fail-open; the closure lives INSIDE it.
// doRestore must be declared and called INSIDE the existing `try { ... } catch { if (!revertClause)
// revertClause = "(file revert skipped: an error occurred — 0 files reverted)"; }` so a thrown restore
// still degrades to the skip notice (E13/E27). Do not move the restore outside this try.

// GOTCHA #5 — affectedPaths stays ledger.modifiedFiles in THIS task.
// BUG-004 (derive affectedPaths from store.changedPaths(beforeRef)) is P1.M4.T2 — a LATER milestone,
// and its analysis note says BUG-001's fix must land first "since they touch the same code block."
// Leave `const affectedPaths = ledger.modifiedFiles;` exactly as-is. The `doRestore` closure does NOT
// use affectedPaths (restore's affected set is backend-internal), so BUG-004 can later change the
// `affectedPaths` line without touching the closure.

// GOTCHA #6 — the REFUSE and PROCEED clause strings are byte-locked by the contract.
// REFUSE: `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`
// PROCEED: `Reverted ${reverted.length} file(s), deleted ${deleted.length}; ${skipped+failed} skipped/failed, ${refused} refused (see log).`
// Copy both VERBATIM (note the em dash — and the backticks). The F-revert integration tests and the
// E5 warning reword (P4.M2.T2) pattern-match these.

// GOTCHA #7 — no test encodes the buggy behavior (verified).
// grep of test/ for the REFUSE clause / "checkpoint" revert assertions: all "refused" hits are about
// depth/protected/validation refusals — NONE assert checkpoint file-revert being refused. So the fix
// cannot break a test that encoded the bug. The degenerate F-revert-reload still proceeds (just via the
// new no-afterRef path instead of the clean-dirtyCheck path). Confirm by running `npm test` after.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `RevertCheckpoint.afterRef?: string` is already optional (markers.ts:125) and is
already omitted by checkpoint creation (commands.ts:217-222). This task changes only control flow.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/tools/rewind.ts — refactor step 6b branch (5)+(6) to make the dirty guard conditional
  - LOCATE: `rewindExecute`, step (6b), the inner `else` block (currently ~lines 843-889) that currently
    reads, in order: `const affectedPaths = ledger.modifiedFiles;` → `const afterRef = checkpoint.afterRef
    ?? checkpoint.beforeRef;` → `const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);`
    → `if (driftedPaths.length > 0) { REFUSE } else { PROCEED (restore + fold) }`.
  - REPLACE that whole branch-(5)+(6) `else` body with the EXACT structure below. (This is the entire
    code change; everything outside this `else` is untouched.)

      } else {
        // branch (5)+(6): resolve the checkpoint + run the (CONDITIONAL) dirty guard + proceed.
        // CRITICAL #3: affectedPaths = ledger.modifiedFiles (BUG-004 — P1.M4 — will later derive this
        //     from store.changedPaths(beforeRef); left as the heuristic here, unchanged by BUG-001).
        const affectedPaths = ledger.modifiedFiles;

        // [BUG-001 fix, P1.M1.T1.S1] Restore + RestoreResult folding. FACTORED into a local async closure
        //   so it runs on BOTH proceed paths: (a) afterRef exists AND dirtyCheck is clean, (b) NO afterRef
        //   (checkpoint granularity — checkpoints capture ONCE, so there is no post-turn baseline to
        //   dirty-check against). store.restore NEVER throws (E27 — per-path failures land in failed[]);
        //   a hypothetical throw is caught by the enclosing inner try/catch → E13 skip notice. restore
        //   ALWAYS uses checkpoint.beforeRef (the PRE-span state), NEVER the dirty-guard afterRef.
        //   allowDeleteCreatedFiles is gated INSIDE the backend (git.ts ~693 `opts.deleteCreatedFiles &&
        //   this.cfg.allowDeleteCreatedFiles`) — pass the per-call flag verbatim; do NOT read
        //   config.revert.allowDeleteCreatedFiles here (double-gate). `revert: revertBlock` rides the
        //   existing `as RewindMarkerInput` cast. skipped string[] → boolean for the marker.
        //   GOTCHA #1: `store`/`checkpoint` are `const`-narrowed → type-check inside this closure.
        const doRestore = async (): Promise<void> => {
          const restoreResult: RestoreResult = await store.restore(
            checkpoint.beforeRef,
            {
              revertFileChanges: params.revert_file_changes === true, // CRITICAL #3: no tool-side gate
              deleteCreatedFiles: params.delete_created_files === true,
            },
          );
          // CRITICAL #2: the revert block rides the spread into the ORIGINAL marker (persist runs after 6b).
          revertBlock = {
            revertedFiles: restoreResult.reverted,
            deletedFiles: restoreResult.deleted,
            failedFiles: restoreResult.failed,
            refusedFiles: restoreResult.refused,
            skipped: restoreResult.skipped.length > 0, // CRITICAL #7: string[] → boolean
            backend: store.describe().backend, // "git" | "cas" | "none" — typed match
          };
          // Stash the COUNT summary for RewindDetails BEFORE the skipped count is folded into the boolean
          //     above (the count is lost once folded). Consumed by P4.M2.T2.T1 (the warning reword).
          revertSummaryDetails = {
            reverted: restoreResult.reverted.length,
            deleted: restoreResult.deleted.length,
            failed: restoreResult.failed.length,
            skipped: restoreResult.skipped.length,
            refused: restoreResult.refused.length,
            backend: revertBlock.backend,
          };
          // CRITICAL #6: NO leading space (successText() does `text += " " + revertClause`). The clause is
          //     VERBATIM spec/05 §1 step 6b + spec/14 §7.
          revertClause =
            `Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; ` +
            `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, ` +
            `${restoreResult.refused.length} refused (see log).`;
        };

        // [BUG-001 fix, P1.M1.T1.S1] afterRef is OPTIONAL (RevertCheckpoint.afterRef?: string). Turns set
        //   it post agent_end; checkpoints NEVER set it (single capture). The PREVIOUS code fell back to
        //   `?? checkpoint.beforeRef` (the pre-checkpoint tree), which made dirtyCheck compare the CURRENT
        //   tree to the PRE-checkpoint tree → the agent's OWN intervening file work was flagged as drift →
        //   the file-revert was REFUSED on every real checkpoint span (BUG-001). Per spec/14 §6 step 3 the
        //   dirty guard is CONDITIONAL on afterRef existing — NO fallback. When afterRef is absent
        //   (checkpoint granularity) the guard is SKIPPED and restore proceeds directly.
        const afterRef = checkpoint.afterRef;
        if (afterRef) {
          // Dirty guard (pre-flight) — REFUSE on ANY drift vs the post-turn baseline (spec/14 §6 step 3).
          // CRITICAL #4: dirtyCheck is ASYNC. Returns the subset of `paths` that drifted vs afterRef.
          const driftedPaths = await store.dirtyCheck(
            afterRef,
            affectedPaths,
          );
          if (driftedPaths.length > 0) {
            // CRITICAL #5: REFUSE THE WHOLE file-revert on ANY drift (not per-path — @14 §6 step 3). The
            //     context rewind still proceeds; only the file-revert is refused. revertRefused=true
            //     signals P4.M2.T2.T1 (the conditional E5 mutation-warning reword).
            revertRefused = true;
            revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`;
          } else {
            // PROCEED — dirty guard clean.
            await doRestore();
          }
        } else {
          // No afterRef (checkpoint granularity) — skip the dirty guard entirely and proceed to restore.
          //   spec/14 §6 step 3: the guard runs only "if afterRef exists"; checkpoints capture once, so
          //   there is no post-span baseline to compare against. (BUG-001 fix — was: refused every time.)
          await doRestore();
        }
      }

  - FOLLOW pattern: the existing code's comment discipline (spec citations, CRITICAL #n callouts).
  - PRESERVE: dirtyCheck call signature `store.dirtyCheck(afterRef, affectedPaths)`; the REFUSE clause
    text; the PROCEED clause text; the revertBlock/revertSummaryDetails field names + the
    skipped.length>0 boolean fold; the `params.revert_file_changes === true` verbatim-flag pass-through.
  - GOTCHA #1 (const narrowing), #3 (await doRestore), #4 (stays inside the inner try/catch), #5
    (affectedPaths unchanged), #6 (clause strings byte-locked).

Task 2: MODIFY src/tools/rewind.ts — update the JSDoc on the afterRef resolution (Mode A docs)
  - The new inline comments above `const afterRef = checkpoint.afterRef;` (in Task 1) ARE the JSDoc
    update: they record (a) the fallback was removed per BUG-001, (b) the guard is now conditional on
    afterRef, (c) the spec/14 §6 step 3 citation, (d) what each branch does. No separate doc edit needed.
  - ALSO sweep the surrounding step-6b block header comment (~line 794-803) for any phrase implying the
    guard ALWAYS runs (e.g. "run the dirty guard (store.dirtyCheck) against the ledger's modified-file set
    → produce a proceed/refuse/skip decision") and, if it states the guard is unconditional, append a
    one-line note: "BUG-001 fix (P1.M1.T1.S1): the dirty guard is CONDITIONAL on checkpoint.afterRef
    existing (spec/14 §6 step 3) — skipped (restore proceeds) for checkpoint-granularity rewinds, which
    capture once and have no afterRef." If the header is already accurate, leave it.

Task 3: VALIDATE (no code) — typecheck + full suite green
  - RUN: `npm run typecheck` (tsc --noEmit). MUST be clean. This is the primary risk gate — the closure's
    capture of const-narrowed store/checkpoint is what the typecheck confirms (GOTCHA #1).
  - RUN: `npm test` (vitest run, full suite). MUST be green. Confirms: no regression on the turn-granularity
    path (afterRef always present → identical behavior), and the degenerate F-revert-reload checkpoint
    test still proceeds (now via the no-afterRef path → doRestore with empty span → 0 reverted, unchanged).
  - DO NOT add/modify integration tests in S1 — that is S2's explicit scope (P1.M1.T1.S2). If you want a
    quick confidence check that BUG-001 is actually fixed before S2, run the analysis's vitest repro as a
    THROWAWAY (write → run → delete), mirroring how the bug was confirmed. Do not commit it.
```

### Implementation Patterns & Key Details

```typescript
// THE SHAPE OF THE CHANGE — before vs after (branch 5+6, inside the existing inner try/catch):
//
// BEFORE (BUGGY): guard is UNCONDITIONAL; afterRef falls back to beforeRef.
//   const affectedPaths = ledger.modifiedFiles;
//   const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;   // ← BUG-001
//   const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
//   if (driftedPaths.length > 0) { REFUSE } else { PROCEED-restore+fold }
//
// AFTER (FIXED): guard is CONDITIONAL on afterRef; restore+fold shared via `doRestore`.
//   const affectedPaths = ledger.modifiedFiles;
//   const doRestore = async () => { /* PROCEED-restore+fold body, byte-identical to the old else */ };
//   const afterRef = checkpoint.afterRef;                          // ← NO fallback (BUG-001 fix)
//   if (afterRef) {
//     const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
//     if (driftedPaths.length > 0) { REFUSE } else { await doRestore(); }
//   } else {
//     await doRestore();   // checkpoint granularity — guard skipped (spec/14 §6 step 3)
//   }
//
// INVARIANT: the old `else { PROCEED }` body and the new `doRestore` body are TEXTUALLY IDENTICAL
// (same restore call, same revertBlock fields, same revertSummaryDetails, same revertClause string).
// The only structural change is wrapping that body in a closure + making its invocation conditional.
// This makes the turn-granularity proceed path byte-for-byte the same code, just invoked via `doRestore()`.

// NON-GOAL (do NOT do these in S1):
//   - Do NOT change affectedPaths to store.changedPaths(beforeRef) — that is BUG-004 / P1.M4.T2.
//   - Do NOT strengthen/rewrite test/integration/revert-edge.test.ts — that is S2 / P1.M1.T1.S2.
//   - Do NOT capture a just-in-time after-ref (analysis Option B) — Option A (skip the guard) is the fix.
//   - Do NOT touch commands.ts, store.ts, markers.ts, git.ts, cas.ts, or any other file.
//   - Do NOT change the dirtyCheck signature, RestoreResult folding, or either clause string.
```

### Integration Points

```yaml
CODE (src/tools/rewind.ts — the ONLY file changed):
  - step (6b), branch (5)+(6) `else` body (~lines 843-889):
      + remove `?? checkpoint.beforeRef` fallback
      + add `const doRestore = async () => {...}` closure (the old PROCEED body, verbatim)
      + wrap dirtyCheck in `if (afterRef)`; call `await doRestore()` from both the clean + no-afterRef paths
      + update inline comments (BUG-001 citation + spec/14 §6 step 3)
  - step (6b) block header comment (~line 794-803): append a one-line BUG-001 note IF it states the guard
    is unconditional (otherwise leave)

NO CHANGES TO:
  - src/commands.ts (checkpoint captures once — by design; afterRef stays unset)
  - src/markers.ts (RevertCheckpoint.afterRef is already optional)
  - src/snapshot/{store,git,cas,paths}.ts (store API unchanged)
  - src/capture.ts, src/index.ts, src/config.ts, src/runtime.ts
  - ANY test file in S1 (S2 owns the integration-test strengthening)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The single source gate for this change (TS + vitest project; no ruff/mypy/eslint):
npm run typecheck        # = tsc --noEmit (strict, ESNext)
# Expected: zero errors. PRIMARY RISK: the `doRestore` closure's capture of const-narrowed
# `store`/`checkpoint` (GOTCHA #1). If tsc complains "Object is possibly 'undefined'" inside doRestore,
# you have NOT kept the closure local to the const-narrowing scope — re-declare it INSIDE the branch-(5)+(6)
# else block (after `store`/`checkpoint` are declared + narrowed), not at module/function-top scope.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The relevant existing suites (confirm no regression — these encode the turn-granularity path + the
# degenerate checkpoint path, both of which must stay green):
npx vitest run test/tools/rewind.test.ts
npx vitest run test/integration/revert-edge.test.ts   # F-revert-* incl. the degenerate F-revert-reload
# Full suite (catches any cross-cutting regression):
npm test                 # = vitest run (all test files)
# Expected: ALL green. If a revert-edge test fails, READ whether it asserted the OLD buggy refuse
# behavior (it should not — see GOTCHA #7; grep found no such assertion). If it did, that test encoded
# the bug and the S2 task will rewrite it — but in S1 do NOT edit the test; flag it in your summary.
```

### Level 3: Integration Testing (System Validation)

```bash
# S1 has NO new integration test (S2 owns it). For a self-contained BUG-001 confirmation WITHOUT a
# permanent test, run the analysis's vitest repro as a THROWAWAY (then delete the file):
cat > test/_bug001_repro.test.ts <<'EOF'
// THROWAWAY — confirms BUG-001 is fixed; DELETE before committing (S2 adds the permanent test).
import { describe, it, expect } from "vitest";
// ... mirror the analysis BUG-001 "Steps to Reproduce": git init → commit a.ts='A0\n' →
// setConfig revert.enabled → /mulligan_checkpoint x → capture → write a.ts='A1\n' → agent_end capture →
// mulligan_rewind({granularity:'checkpoint',checkpoint:'x',revert_file_changes:true}) →
// expect a.ts === 'A0\n' and result text MATCHES /Reverted 1 file\(s\)/ (NOT /refused/).
EOF
npx vitest run test/_bug001_repro.test.ts && rm test/_bug001_repro.test.ts
# Expected: the repro PASSES (a.ts restored to A0, proceed clause in text) then the file is removed.
# (This step is OPTIONAL — the permanent proof is S2's strengthened F-revert-reload. Skip if confident.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the turn-granularity path (afterRef present) is byte-identical in behavior — a diff of the
# ONLY branch whose body changed materially (the clean-afterRef proceed → now via doRestore):
git diff src/tools/rewind.ts
# Expected: the diff shows (1) the `doRestore` closure wrapping the OLD else-body verbatim, (2) the
# `if (afterRef)` wrapper, (3) comment changes. It should NOT show any change to the REFUSE clause, the
# PROCEED clause, the revertBlock fields, the dirtyCheck call args, or the restore() call args. If it
# does, you changed something the contract locked — revert that hunk.

# Adversarial: confirm restore errors still degrade to the E13 skip notice (the inner try/catch must
# still enclose doRestore — GOTCHA #4). With wantRevert + config.revert.enabled + a store whose
# restore() throws, the result text should be "(file revert skipped: an error occurred — 0 files
# reverted)" and revertBlock undefined. (Existing E13 test or a quick repro covers this.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (the closure-const-narrowing risk is cleared).
- [ ] `npm test` (full suite) green — zero regressions.
- [ ] `npx vitest run test/integration/revert-edge.test.ts` green (degenerate F-revert-reload proceeds).

### Feature Validation

- [ ] `checkpoint.afterRef ?? checkpoint.beforeRef` fallback is removed (BUG-001 root cause gone).
- [ ] `store.dirtyCheck` runs ONLY inside `if (afterRef)`.
- [ ] Checkpoint granularity (no afterRef) → guard skipped → `await doRestore()` runs the restore + fold.
- [ ] Turn granularity (afterRef present) → identical to before: dirtyCheck runs, REFUSE on drift, else PROCEED.
- [ ] BUG-001 repro (throwaway): checkpoint span with a real `write a.ts 'A1\n'` → restored to `'A0\n'`,
      proceed clause in text (NOT the refused clause).
- [ ] dirtyCheck signature, RestoreResult folding, REFUSE clause text, PROCEED clause text all unchanged.

### Code Quality Validation

- [ ] `doRestore` is a LOCAL async closure inside branch (5)+(6) (captures const-narrowed store/checkpoint).
- [ ] No duplicated restore body (single closure, two call sites).
- [ ] `await doRestore()` at both call sites (no fire-and-forget — GOTCHA #3).
- [ ] doRestore lives INSIDE the existing inner try/catch (E13 fail-open preserved — GOTCHA #4).
- [ ] `affectedPaths = ledger.modifiedFiles` unchanged (BUG-004 is out of scope — GOTCHA #5).
- [ ] Inline comments cite BUG-001 + spec/14 §6 step 3 (Mode A docs ride with the change).

### Documentation & Deployment

- [ ] No config/API/user-facing surface change (config.revert.enabled gating unchanged; checkpoint
      creation unchanged; no new exports).
- [ ] No new env vars; no README change in S1 (P1.M6.T2 owns changeset docs).

---

## Anti-Patterns to Avoid

- ❌ Don't DUPLICATE the restore+fold body under an `else` — the contract prefers the factored closure
  (GOTCHA #1), and duplication invites the two copies drifting (esp. when BUG-004 later edits affectedPaths).
- ❌ Don't hoist `doRestore` to module/function-top scope — you lose const-narrowing of `store`/`checkpoint`
  → type errors (GOTCHA #1). Keep it LOCAL to the branch-(5)+(6) else block.
- ❌ Don't forget `await` on `doRestore()` — fire-and-forget leaves revertBlock/revertClause unset at
  persist time (GOTCHA #3).
- ❌ Don't change `affectedPaths` to `store.changedPaths(beforeRef)` here — that's BUG-004 / P1.M4 (GOTCHA #5).
  It's a LATER milestone whose analysis explicitly says it depends on THIS fix landing first.
- ❌ Don't implement Option B (just-in-time after-ref capture) — the analysis recommends Option A (skip the
  guard); Option B adds I/O for no behavioral gain and more failure surface.
- ❌ Don't touch any test file in S1 — the integration-test strengthening is S2's scope (P1.M1.T1.S2).
- ❌ Don't alter the dirtyCheck call, the RestoreResult folding, or either clause string — the contract
  locks them (GOTCHA #6); the E5 warning reword and F-revert tests pattern-match them.
- ❌ Don't change commands.ts (checkpoints capture once by design) or markers.ts (afterRef already optional).

---

## Confidence Score: 9/10

**Why high**: The defect is a single-line fallback with a precise spec citation ("if afterRef exists,
run dirtyCheck") and a one-paragraph root cause. The fix is a localized control-flow edit in ONE function
of ONE file, with the restore body merely re-housed (not rewritten) so the turn-granularity path is
textually identical. TypeScript const-narrowing makes the closure approach type-safe. No test encodes the
buggy behavior, so `npm test` is a clean no-regression gate.

**Residual risk (the 1 point)**: the closure's capture of const-narrowed `store`/`checkpoint` is the one
non-trivial TypeScript mechanism here — if the implementer hoists the closure out of the narrowed scope,
tsc errors. Mitigated by GOTCHA #1 + the `npm run typecheck` gate + the before/after shape diagram. The
behavioral correctness is ultimately proven by S2's strengthened integration test (P1.M1.T1.S2); S1's
optional throwaway repro (Level 3) provides interim confirmation.