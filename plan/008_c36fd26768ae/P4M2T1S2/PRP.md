name: "P4.M2.T1.S2 — store.restore + fold RestoreResult into marker.revert + success text"
description: |

---

## Goal

**Feature Goal**: Fill the **proceed seam** that P4.M2.T1.S1 left in `rewindExecute` step 6b
(`src/tools/rewind.ts`). When the decision tree (S1) allows the working-tree revert (flags set +
`config.revert.enabled` + supported granularity + checkpoint resolved + dirty guard clean), this
item calls `store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles})`, folds the
5-bucket `RestoreResult` into (a) the success text (the `"Reverted <X> file(s), deleted <Y>; <Z>
skipped/failed, <W> refused (see log)."` clause, spec/05 §1 step 6b + spec/14 §7 verbatim) and (b)
the persisted marker's `revert` block (`{revertedFiles, deletedFiles, failedFiles, refusedFiles,
skipped, backend}`, spec/04 §3 + spec/14 §7). To get the revert result into the ORIGINAL marker
entry (the session tree is append-only — C7 — so an already-persisted marker cannot be amended),
this item **re-orders the marker persist (step 7) to AFTER step 6b** (option (a) from the item
contract; endorsed by `architecture/codebase_patterns.md §4`: "The payload to appendRewindMarker
includes revert field via spread").

**Deliverable**: A modified `src/tools/rewind.ts` (the filled proceed seam + the relocated persist +
a `revertBlock` accumulator + an optional `RewindDetails.revertSummary`) plus updated/added tests in
`test/tools/rewind.test.ts`. NO new files. Sibling task P4.M2.T2.T1 (the E5 warning reword) consumes
`details.revertSummary`; this item does NOT reword the warning.

**Success Definition**:
- Proceed branch (clean dirty guard): `store.restore(checkpoint.beforeRef, {revertFileChanges:
  params.revert_file_changes === true, deleteCreatedFiles: params.delete_created_files === true})`
  is called EXACTLY ONCE; the success text ends with the verbatim revert clause; the persisted
  marker's `data.revert` block equals `{revertedFiles, deletedFiles, failedFiles, refusedFiles,
  skipped: <bool>, backend: store.describe().backend}`.
- The marker persist (step 7) now runs AFTER step 6b, so `revert` is part of the ORIGINAL marker
  entry (NOT a follow-up amendment). `leaveNote` stays paired with persist (correlates via markerId).
- Non-proceed branches (no flags / disabled / group-granularity / missing-checkpoint / refuse) are
  BYTE-IDENTICAL to S1's output: `revertBlock` stays `undefined`, the marker has NO `revert` field,
  `details.revertSummary` is `undefined`, restore is NEVER called.
- `store.restore` throwing (it never should — E27 — but defensively) degrades to S1's existing
  skip notice; `revertBlock` stays undefined; the rewind STILL completes (E13).
- `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full `npx vitest run` green.

## User Persona

**Target User**: The LLM agent that calls `mulligan_rewind({revert_file_changes: true, ...})`, and the
implementing agent (this PRP's consumer).

**Use Case**: After a wrong-direction turn where the agent also edited files, the agent requests
`revert_file_changes` so the resumed attempt need not re-read the files it changed. S1 DECIDED the
revert can safely proceed; THIS item PERFORMS it (restores the working tree to the pre-span state)
and reports the outcome to the agent (success text) + the operator (marker audit block in `/tree`).

**Pain Points Addressed**: Without S2, the proceed branch is a comment seam (S1 deliberately did not
call restore — scope split) — the feature DECIDES but never ACTS. The agent's edited files persist on
disk and must be re-read on resume, defeating the opt-in's purpose. S2 closes the loop: restore runs,
the result is visible to the agent (text) and auditable (marker).

## Why

- **Completes the v1.2 working-tree-revert primitive**: the params (P4.M1.T1.S1), the decision tree +
  dirty guard (P4.M2.T1.S1), the `rt.snapshots` checkpoints (P3 capture hooks / checkpoint command),
  and the `SnapshotStore` (P2) all converge HERE into one `store.restore` call + a fold. (@14 §7.)
- **The marker is the audit surface**: the `revert` block is "recoverable from `/tree`" (spec/14 §7 +
  spec/04 §3). Folding into the ORIGINAL marker (not an amendment) keeps the audit single-entry and
  keeps readMarkers/filter logic unchanged (no new customType to teach the filter).
- **Best-effort, never blocks the rewind** (the pervasive Mulligan discipline): `store.restore` never
  throws (E27 — failures land in `failed[]`); a restore hiccup degrades to a skip notice via S1's
  existing inner try/catch; the context rewind ALWAYS completes. (@14 §6 step 1, §7; E27/E30.)
- **Scope guard**: this item does the RESTORE + FOLD only. It does NOT reword the E5 mutation warning
  (P4.M2.T2.T1 — sibling) and does NOT touch S1's decision-tree branches (disabled/group/missing/
  refuse). It only fills the proceed seam + relocates persist. Leaving either = scope collision.

## What

Three coordinated edits inside `rewindExecute` (`src/tools/rewind.ts`):

1. **Fill the proceed seam** (S1 left a comment seam in step 6b's clean-dirty-guard `else`): call
   `store.restore(checkpoint.beforeRef, opts)`, build `revertBlock`, and set `revertClause`.
2. **Re-order the persist**: move the step-7 block (`const payload = {...}; const markerId =
   appendRewindMarker(...); leaveNote(...);`) from its current location (BEFORE step 6b) to AFTER
   step 6b, and add `revert: revertBlock` to the payload so the revert block rides the
   `{...data, ...envelope}` spread into the ORIGINAL marker entry.
3. **Expose `details.revertSummary`** (optional) so the sibling warning-reword task (P4.M2.T2.T1)
   can decide whether files were reverted WITHOUT re-reading the persisted marker.

### Success Criteria

- [ ] Proceed branch calls `store.restore(checkpoint.beforeRef, {revertFileChanges:
      params.revert_file_changes === true, deleteCreatedFiles: params.delete_created_files === true})`
      exactly once; `checkpoint.beforeRef` is the pre-span ref (NOT afterRef).
- [ ] Success text (proceed) appends, after "Note left." and before any mutation warning, the EXACT
      clause: `Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused (see log).` where
      X=`reverted.length`, Y=`deleted.length`, Z=`skipped.length + failed.length`, W=`refused.length`.
- [ ] Persisted marker `data.revert` (proceed) deep-equals `{revertedFiles, deletedFiles, failedFiles,
      refusedFiles, skipped: <restoreResult.skipped.length > 0>, backend: store.describe().backend}`.
- [ ] Persist runs AFTER step 6b (verified: the marker entry's `data.revert` is populated in the SAME
      entry that `data.id`/`data.seq` live — i.e. ONE marker entry, not a follow-up).
- [ ] Non-proceed branches: `data.revert` is ABSENT (or `undefined`, omitted in JSON); restore NOT
      called; `details.revertSummary` is `undefined`; output byte-identical to S1.
- [ ] `store.restore` throw (defensive) → S1's skip notice; `revertBlock` undefined; rewind completes.
- [ ] `allowDeleteCreatedFiles` is NOT read by the tool (gated inside the backend — git.ts:693); the
      tool passes `deleteCreatedFiles: params.delete_created_files === true` verbatim.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full suite green.

## All Needed Context

### Context Completeness Check

_Pass test_: An implementer who has never seen this codebase is given this PRP + `src/tools/rewind.ts`
(as S1 left it) + `src/snapshot/store.ts` + `src/markers.ts`. They can implement S2 because: the exact
seam to fill (S1's proceed-branch comment), the exact persist block to relocate (named by its current
contents), the exact fold shapes (restore call / text clause / revert block — all pinned with citations),
the `allowDeleteCreatedFiles` gating location (backend, not tool), the no-cast-spread fact
(`RewindMarkerInput` already includes `revert?`), and the test idiom (fakes + seeding recipe) are all
documented with code-level citations. The re-order safety is proven branch-by-branch (research note). ✅

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/05-tools.md
  why: §1 "Behavior (step by step)" step 6b — the success-text clause is LLM-facing + VERBATIM
       ("Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused (see log)."); the Return
       shape (the clause rides the success text). [Mode A — docs ride WITH the work.]
  critical: |
    The clause has NO leading space in the value you assign to revertClause — S1's successText()
    already does `if (revertClause) text += " " + revertClause;`. Assign the bare clause.
- file: spec/14-working-tree-revert.md
  why: §7 "mulligan_rewind integration" (the success-text additions + the marker fold THIS item owns),
       §6 "Restore semantics" (restore consumes beforeRef; the dirty-guard refuse is S1's, the restore
       is S2's; restore never throws — E27), §2 (SnapshotStore.restore + RestoreResult 5 buckets).
  critical: |
    §7: "fold {reverted, deleted, failed, skipped, refused} into the success text AND the marker. The
    store's list result maps to the marker's revertedFiles/deletedFiles/failedFiles/refusedFiles arrays;
    skipped: string[] → revert.skipped: boolean = skipped.length > 0; revert.backend ←
    store.describe().backend." This is the EXACT mapping — implement it verbatim.

# THE FILE TO EDIT
- file: src/tools/rewind.ts
  why: THE file. rewindExecute is the single function (steps 1–9, one try/catch — E13). S1 already
       inserted step 6b (decision tree + dirty guard) BETWEEN step 7b and step 8, with a proceed-branch
       COMMENT SEAM. S1's step 7 (persist: `const payload = {...}; const markerId = appendRewindMarker
       (pi, ctx, payload as RewindMarkerInput); leaveNote(pi, rendered, markerId ?? toolCallId);`) is
       CURRENTLY BEFORE step 6b. S2 fills the seam + relocates step 7 to AFTER step 6b.
  pattern: |
    In-scope-at-the-seam variables (all ALREADY declared earlier in rewindExecute — NO new fetch):
      `store` (const, S1's nested else: `const store = rt?.store;` — truthy, else we'd be in the
        missing-checkpoint branch); `checkpoint` (const, S1: `rt?.snapshots?.get(key)` — the
        RevertCheckpoint; `checkpoint.beforeRef` is the pre-span ref); `params` (the execute arg — has
        revert_file_changes/delete_created_files after P4.M1.T1.S1); `config` (getConfig(), step 1);
      `ledger` (step 5); `pi`, `ctx`, `rendered` (step 6), `granularity` (top of try).
    S1 declared, at the TOP of its 6b block (function/try scope — visible to step 7 & 9):
      `let revertClause = "";` and `let revertRefused = false;`. S2 ADDS `let revertBlock: RewindMarker
      ["revert"];` right beside them (same scope) so the relocated persist can read it.
  gotcha: |
    S1's 6b block has its OWN inner try/catch (E13 fail-open for dirtyCheck). S2's restore call lives
    INSIDE that same inner try (so a hypothetical restore throw lands in the existing catch → skip
    notice). Do NOT add a second try/catch around restore. The restore call is `await`-ed (rewindExecute
    is already async — S1 added `await store.dirtyCheck(...)`; the pattern is established).

# THE TYPES S2 consumes (read-only — do NOT edit)
- file: src/snapshot/store.ts
  why: SnapshotStore.restore signature + RestoreOpts + RestoreResult. `restore(beforeRef: string, opts:
       RestoreOpts): Promise<RestoreResult>`. RestoreOpts = `{revertFileChanges: boolean;
       deleteCreatedFiles: boolean}`. RestoreResult = `{reverted: string[]; deleted: string[]; failed:
       string[]; skipped: string[]; refused: string[]}`. `describe(): {backend: "git"|"cas"|"none";
       reason?}`. RESTORE NEVER THROWS (the contract: "The op NEVER throws — per-path failures land in
       failed[]"; NoOpStore.restore returns 5 empty buckets).
  pattern: S2 imports `type { RestoreResult }` from "../snapshot/store.js" (add to the import block).
  gotcha: |
    NoOpStore has backend "none" — but a NoOpStore NEVER produces a checkpoint (NoOpStore.capture
    returns null → capture hooks set no rt.snapshots entry → S1's missing-checkpoint branch). So the
    proceed branch is reachable ONLY with a real backend (git/cas); `store.describe().backend` in the
    revert block is "git"|"cas" in practice, but the field type "git"|"cas"|"none" matches either way.

# THE MARKER TYPE — confirms revert rides the spread (read-only — do NOT edit)
- file: src/markers.ts
  why: RewindMarker.revert field shape (the block S2 builds) + RewindMarkerInput + appendRewindMarker.
       `RewindMarker.revert?` = `{revertedFiles: string[]; deletedFiles: string[]; failedFiles:
       string[]; refusedFiles: string[]; skipped: boolean; backend: "git"|"cas"|"none"}` (already
       shipped by P1.M2.T2.S1). `RewindMarkerInput = Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"
       |"ts">` → INCLUDES `revert?`. appendRewindMarker does `{...data, schema, v:1, kind, id, seq, ts}`
       → the revert field rides the spread.
  pattern: import `type { RewindMarker }` (ADD — rewind.ts currently imports only `RewindMarkerInput` +
           the `RevertCheckpoint` type S1 added). Use `RewindMarker["revert"]` for the revertBlock type
           (no duplication of the field shape).
  gotcha: |
    UNLIKE `checkpoint` (frozen-omitted from RewindMarkerInput → needs the existing `as
    RewindMarkerInput` cast), `revert` IS in RewindMarkerInput. So `revert: revertBlock` is type-safe
    on the ALREADY-PRESENT cast. Adding a separate cast = noise. `revert: undefined` (non-proceed
    branches) is type-safe; JSON.stringify omits it; readOwn returns falsy — all correct.

# THE BACKEND — confirms allowDeleteCreatedFiles is gated HERE (read-only)
- file: src/snapshot/git.ts
  why: CONFIRMS the delete gate is INSIDE the backend, NOT the tool. git.ts line ~693:
       `if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles)` — the GitBackend ctor receives
       `MulliganConfig["revert"]` so it has allowDeleteCreatedFiles. CasBackend mirrors this.
  critical: |
    The tool must NOT read config.revert.allowDeleteCreatedFiles. Pass `deleteCreatedFiles:
    params.delete_created_files === true` verbatim (the item-contract literal). Adding a tool-side gate
    would DOUBLE-gate (and diverge from the item contract).

# THE RUNTIME — store + snapshots (read-only; S1 already reads these)
- file: src/runtime.ts
  why: `rt.store?: SnapshotStore` + `rt.snapshots?: Map<string, RevertCheckpoint>`. S1 already resolves
       `store` + `checkpoint` from `rt?.store` / `rt?.snapshots?.get(key)` in the proceed else-branch;
       S2 reuses those consts (they are in scope at the seam). Do NOT re-fetch rt.
  gotcha: rt can be null (getRuntime is in a try above the main try). S1 already guards with `rt?.` and
          the proceed branch is only reached when `store` && `checkpoint` are both truthy — so by the
          seam, `store` and `checkpoint` are NON-null. (TS may still see `store` as possibly-undefined
          from the `rt?.store` narrowing; S1's `if (!store || !checkpoint)` guard narrows it.)

# THE TEST IDIOM
- file: test/tools/rewind.test.ts
  why: THE test file. Idiom: vitest; hand-rolled makePi()/makeCtx() fakes (NO vi.fn()); `.js` imports;
       `run(pi, ctx, params, toolCallId)` helper; `firstText(res)`; `VALID_NOTE`; `clearAll()` +
       `setConfig(undefined)` in beforeEach/afterEach. Types `RevertCheckpoint`, `RestoreResult`,
       `SnapshotStore`, `RewindMarker`, `RewindMarkerInput` ALREADY imported. S1 ADDED a
       "mulligan_rewind step 6b decision tree (P4.M2.T1.S1)" describe block incl. a PROCEED test (f)
       that currently asserts restore was NOT called — S2 FLIPS that test + adds the fold assertions.
  pattern: |
    S1 added a `makeFakeStore({drifted?, throwOnCheck?, restoreCalled?})` helper returning a plain
    object `as unknown as SnapshotStore`. S2 EXTENDS it to accept a scripted `restoreResult?:
    RestoreResult` and return it from `restore` (still calling `restoreCalled?.()`). See recipe below.
  gotcha: |
    Each test MUST `setConfig({revert:{enabled:true}})` (beforeEach resets to DEFAULT_CONFIG = revert
    off). Seed rt via `getRuntime(sid)` where sid = makeCtx's sessionId. To ASSERT the persisted marker
    carries the revert block, read `pi.appended` (the fakePi captures every appendEntry): find the
    `customType === "mulligan:rewind"` entry and assert `.data.revert`.
```

### Current Codebase tree (relevant slice — as S1 left it)

```bash
src/
  tools/
    rewind.ts          # EDIT — fill proceed seam + relocate persist + revertBlock + revertSummary
  snapshot/store.ts    # READ ONLY — RestoreResult / RestoreOpts / SnapshotStore.restore
  markers.ts           # READ ONLY — RewindMarker.revert (rides spread) + RewindMarkerInput
  snapshot/git.ts      # READ ONLY — confirms allowDeleteCreatedFiles gated in backend (line ~693)
  runtime.ts           # READ ONLY — rt.store / rt.snapshots (S1 already reads them)
  capture.ts           # READ ONLY — confirms "turn" key (context only)
test/
  tools/
    rewind.test.ts     # EDIT — flip S1's proceed test + add fold-assertion tests
```

### Desired Codebase tree

```bash
# No new files. Two files modified.
src/tools/rewind.ts        # + import RestoreResult + import RewindMarker; + revertBlock accumulator;
                           #   filled proceed seam (restore + fold); RELOCATED persist (after 6b) with
                           #   revert: revertBlock in payload; RewindDetails += revertSummary?
test/tools/rewind.test.ts  # extend makeFakeStore (scripted restoreResult); FLIP proceed test (f) to
                           #   assert restore called + fold; ADD "step 6b restore fold (P4.M2.T1.S2)" tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — RE-ORDER persist to AFTER step 6b (option (a); the item contract's recommended path).
//   The session tree is APPEND-ONLY (C7 — appendEntry returns void; no update-in-place). S1 persists the
//   marker at step 7 BEFORE step 6b runs. You CANNOT fold a revert result into an already-persisted
//   marker. Resolution: MOVE the step-7 block (payload + appendRewindMarker + leaveNote) to AFTER step
//   6b. The revert block (built in 6b's proceed branch) then rides the spread into the ORIGINAL marker.
//   This is SAFE (research note proves it branch-by-branch): every step-4/4b/4c guard + resolvePreview
//   run BEFORE 6b anyway; leaveNote stays paired with persist; step 7b (checkpoint consumption) stays
//   after persist; getLeafId() is unaffected (6b's restore writes to the on-disk snapshot STORE, NOT
//   the session entry tree). FINAL ORDER: 6 (renderNote) → 6b (decision+restore+revertBlock) → 7
//   (persist WITH revert) → 7b (consume) → 8 (hasWarning) → 9 (return).

// CRITICAL #2 — the revert field rides the spread; NO new cast. RewindMarkerInput (the Omit type in
//   markers.ts) INCLUDES revert?. The payload already does `as RewindMarkerInput` (for the frozen-
//   omitted `checkpoint`). So `revert: revertBlock` is type-safe on the EXISTING cast. `revert: undefined`
//   (non-proceed) is type-safe; JSON.stringify omits it; readOwn(rw,"revert") is falsy — all correct.

// CRITICAL #3 — allowDeleteCreatedFiles is gated INSIDE the backend (git.ts ~693:
//   `opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles`). The tool must NOT read
//   config.revert.allowDeleteCreatedFiles. Pass `deleteCreatedFiles: params.delete_created_files ===
//   true` VERBATIM (the item-contract literal). A tool-side gate double-gates + diverges from contract.

// CRITICAL #4 — restore uses checkpoint.beforeRef, NOT afterRef. beforeRef = the pre-span snapshot
//   (turn_start / checkpoint-set). afterRef = post-turn (agent_end). We restore TO the pre-span state.
//   S1 already computed `afterRef = checkpoint.afterRef ?? checkpoint.beforeRef` for the dirty guard;
//   the RESTORE call uses `checkpoint.beforeRef` directly (the item contract: `store.restore
//   (checkpoint.beforeRef, {...})`). Do NOT reuse the dirty-guard `afterRef` local for the restore ref.

// CRITICAL #5 — store.restore NEVER throws (E27). It lives inside S1's EXISTING inner try/catch (the
//   6b block's `catch { if (!revertClause) revertClause = "(file revert skipped: an error occurred — 0
//   files reverted)"; }`). Do NOT add a second try/catch. If restore threw (it won't), revertBlock
//   stays undefined (the assignment never completes) → marker has no revert field → rewind completes.

// CRITICAL #6 — the success-text clause has NO leading space. S1's successText() does `if
//   (revertClause) text += " " + revertClause;`. Assign the BARE clause to revertClause:
//   `Reverted ${n} file(s), deleted ${m}; ${z} skipped/failed, ${w} refused (see log).` (spec h2.147).

// CRITICAL #7 — skipped maps string[] → boolean. RestoreResult.skipped is string[] (the files a cap
//   degraded); RewindMarker.revert.skipped is boolean. Use `restoreResult.skipped.length > 0`. The
//   SUCCESS TEXT, by contrast, uses the COUNT (`skipped.length + failed.length`) — do not conflate.

// CRITICAL #8 — revertBlock must be declared in S1's 6b-block scope (alongside revertClause/
//   revertRefused, at the TOP of the 6b section — function/try scope), so the RELOCATED persist (after
//   6b) can read it. If you declare it inside the `if (wantRevert)` or the nested `else`, it is NOT
//   visible at the persist site. Declare it as `let revertBlock: RewindMarker["revert"];` (undefined
//   until the proceed branch assigns it).

// CRITICAL #9 — DO NOT reword the E5 mutation warning. That is P4.M2.T2.T1 (sibling). S2 only EXPOSES
//   details.revertSummary (a signal) and leaves S1's step-8 comment seam (`// [P4.M2.T2.T1] ...`)
//   UNTOUCHED. hasWarning stays computed exactly as now. Touching the warning = scope collision.

// CRITICAL #10 — DO NOT touch S1's decision-tree branches (disabled / group-granularity / missing-
//   checkpoint / refuse). S2 fills ONLY the proceed `else` (the comment seam). The accumulators
//   (revertClause/revertRefused) are already set by S1 in the other branches; S2 only sets them in the
//   proceed branch + adds revertBlock there. Editing S1's branches = scope collision + regressions.

// QUIRK — `store` and `checkpoint` are `const` in S1's nested proceed-`else`; they are in scope at the
//   seam (the restore call site). `affectedPaths`/`afterRef` (S1 locals) are ALSO in scope but are NOT
//   needed by restore (restore takes beforeRef + opts). Leave them; S2 reads `store` + `checkpoint`.

// QUIRK — revertSummary in RewindDetails is OPTIONAL ("the RewindDetails payload MAY include revert
//   summary"). Include it (low-risk, serves T2) but keep it present ONLY on the proceed branch.
```

## Implementation Blueprint

### Data models and structure

No new EXPORTED types. Two small additions:
- `RewindDetails` (existing exported interface) — ADD an optional `revertSummary?` carrying the
  bucket counts + backend, present ONLY on the proceed branch. Consumed by P4.M2.T2.T1 (the warning
  reword) so it need not re-read the persisted marker.
- A module-local `let revertBlock: RewindMarker["revert"];` accumulator (declared in the 6b section,
  assigned only in the proceed branch; read by the relocated persist).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM PREREQUISITES (read rewind.ts as S1 left it + verify S1's seam + the persist block)
  - READ src/tools/rewind.ts: LOCATE (a) S1's step-6b block (between step 7b and step 8) and its
    proceed-branch COMMENT SEAM (the `else` after the dirty-guard drifted check — a comment like
    `// [P4.M2.T1.S2] store.restore(...) + fold.`); (b) S1's `let revertClause=""; let revertRefused
    = false; const wantRevert = ...;` at the top of the 6b block; (c) the step-7 persist block
    (`const payload = {...}; const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
    leaveNote(pi, rendered, markerId ?? toolCallId);`) currently BEFORE step 6b; (d) step 8
    (`const hasWarning = ...`); (e) step 9 (the success return with successText + details).
  - READ src/snapshot/store.ts: CONFIRM `restore(beforeRef, opts): Promise<RestoreResult>` + the
    RestoreResult 5-bucket shape + RestoreOpts. CONFIRM restore "NEVER throws" (E27).
  - READ src/markers.ts: CONFIRM RewindMarker.revert shape + RewindMarkerInput includes revert?.
  - READ src/snapshot/git.ts ~line 690-720: CONFIRM `if (opts.deleteCreatedFiles && this.cfg.
    allowDeleteCreatedFiles)` (the gate is in the backend).
  - WHY: S2 edits ONE function in ONE file (plus tests). Confirming S1's exact current shape avoids
    guess-work and pinpoints the seam + the block to relocate.

Task 1: EDIT src/tools/rewind.ts — ADD the imports + the revertBlock accumulator declaration
  - ADD to the markers.js import: `type RewindMarker` (rewind.ts currently imports `appendRewindMarker,
    leaveNote, type RewindMarkerInput` — and S1 added `type RevertCheckpoint`; just ADD RewindMarker).
  - ADD a store.js import (type-only): `import type { RestoreResult } from "../snapshot/store.js";`
    (rewind.ts does NOT yet import from store.ts — S1 used the store only structurally via rt.store).
  - EDIT S1's 6b accumulator declarations (at the TOP of the 6b block, beside `let revertClause=""`
    and `let revertRefused=false`): ADD `let revertBlock: RewindMarker["revert"];`.
  - WHY: revertBlock must be visible to BOTH the proceed seam (assigns it) and the relocated persist
    (reads it). Declaring it at S1's 6b-block-top scope (function/try scope) satisfies both.

Task 2: EDIT src/tools/rewind.ts — FILL S1's proceed seam (the restore call + the folds)
  - LOCATE S1's proceed-branch comment seam (the `else` after `if (driftedPaths.length > 0) {...}` in
    the 6b block — currently a comment describing what S2 will do).
  - REPLACE the comment seam with:
        // PROCEED — dirty guard clean. [P4.M2.T1.S2] perform the working-tree restore + fold the
        // RestoreResult into the success text (revertClause) + the marker's revert block (revertBlock).
        // store.restore NEVER throws (E27); this lives inside S1's existing inner try/catch (fail-open).
        // allowDeleteCreatedFiles is gated INSIDE the backend (git.ts ~693) — pass the flag verbatim.
        const restoreResult: RestoreResult = await store.restore(checkpoint.beforeRef, {
          revertFileChanges: params.revert_file_changes === true,   // CRITICAL #3: no tool-side gate
          deleteCreatedFiles: params.delete_created_files === true,
        });
        revertBlock = {                                            // rides the spread into the marker (CRITICAL #2)
          revertedFiles: restoreResult.reverted,
          deletedFiles: restoreResult.deleted,
          failedFiles: restoreResult.failed,
          refusedFiles: restoreResult.refused,
          skipped: restoreResult.skipped.length > 0,               // CRITICAL #7: string[] → boolean
          backend: store.describe().backend,                       // "git"|"cas"|"none" — typed match
        };
        revertClause =                                            // CRITICAL #6: NO leading space (successText adds it)
          `Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; ` +
          `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, ` +
          `${restoreResult.refused.length} refused (see log).`;
  - WHY: the deliverable — the restore + the two folds (text + marker), verbatim from the item contract
    + spec/14 §7 + spec/04 §3. `store`/`checkpoint` are S1 consts already in scope at the seam.
  - GOTCHA: do NOT touch S1's other branches (disabled/group/missing/refuse) — they already set
    revertClause/revertRefused and leave revertBlock undefined. Do NOT add a try/catch (S1's covers it).

Task 3: EDIT src/tools/rewind.ts — RELOCATE the persist block to AFTER step 6b + add revert to payload
  - CUT the step-7 block from its CURRENT location (BEFORE step 6b):
        const payload = { granularity, options: { protect: config.rewind.protectedRoles },
          excludeToolCallId: toolCallId, note: params.note, ledger, hideEntryIds,
          checkpoint: params.checkpoint };                                  // GOTCHA #1: checkpoint rides the cast
        const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
        leaveNote(pi, rendered, markerId ?? toolCallId);
  - PASTE it AFTER the step-6b block (after its closing brace, before step 7b OR after step 7b — see
    GOTCHA). ADD `revert: revertBlock,` to the payload object. Result:
        const payload = {
          granularity,
          options: { protect: config.rewind.protectedRoles },
          excludeToolCallId: toolCallId,
          note: params.note,
          ledger,
          hideEntryIds,
          checkpoint: params.checkpoint,    // GOTCHA #1: frozen-omitted; rides the cast (unchanged)
          revert: revertBlock,              // [P4.M2.T1.S2] revert audit block; undefined ⇒ omitted (JSON)
        };
        const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
        leaveNote(pi, rendered, markerId ?? toolCallId);
  - WHY: CRITICAL #1 — the marker is append-only; to fold revert into the ORIGINAL entry, persist must
    run AFTER 6b computes revertBlock. `revert: revertBlock` rides the existing cast (CRITICAL #2).
  - GOTCHA (placement vs 7b): step 7b (checkpoint-label consumption) is INDEPENDENT of persist timing
    (it clears labels via getLabel/setLabel, reads no marker). For "commit-then-consume" semantics, keep
    7b AFTER persist: place the relocated persist (7) IMMEDIATELY AFTER 6b and BEFORE 7b (i.e. move
    persist up to just after the 6b block, leaving 7b where it is). FINAL ORDER: 6 → 6b → 7 → 7b → 8 → 9.
    If simpler, you may instead move 7b to follow the relocated persist (6 → 6b → 7 → 7b → 8 → 9) — same
    result. Either way: persist BEFORE 7b, both AFTER 6b.

Task 4: EDIT src/tools/rewind.ts — ADD revertSummary to RewindDetails + thread it into the return
  - EDIT the RewindDetails interface: ADD (after S1's `revertRefused?: boolean`):
        /**
         * v1.2 working-tree revert summary (step 6b proceed branch only — present iff store.restore ran).
         * Consumed by the E5 mutation-warning reword (P4.M2.T2.T1) so it need not re-read the persisted
         * marker, and surfaced in logs/audit. Undefined when no revert ran (every non-proceed branch).
         */
        revertSummary?: {
          reverted: number;
          deleted: number;
          failed: number;
          skipped: number;
          refused: number;
          backend: "git" | "cas" | "none";
        };
  - ADD a `let revertSummaryDetails: RewindDetails["revertSummary"];` accumulator at the 6b-block-top
    scope (beside revertBlock). Assign it IN THE PROCEED SEAM (Task 2), directly from `restoreResult`
    — where the skipped COUNT is still available. Do NOT derive it from revertBlock: revertBlock.skipped
    is a BOOLEAN (lost the count), and the success-text Z also needs the count. Building it in the seam
    from restoreResult keeps every field a count:
        revertSummaryDetails = {
          reverted: restoreResult.reverted.length,
          deleted: restoreResult.deleted.length,
          failed: restoreResult.failed.length,
          skipped: restoreResult.skipped.length,   // COUNT (restoreResult.skipped is string[])
          refused: restoreResult.refused.length,
          backend: store.describe().backend,
        };
  - EDIT step 9 (the success return): include `revertSummary: revertSummaryDetails` in details:
        return {
          content: [{ type: "text", text }],
          details: { granularity, k, ledger, hideEntryIds, markerId, revertRefused,
                     revertSummary: revertSummaryDetails },
        };
  - WHY: gives T2 (P4.M2.T2.T1, the warning reword) a clean signal — did revert_file_changes actually
    revert files? `revertSummary.reverted > 0` — without re-reading the persisted marker. Optional per the
    item contract; low-risk. The accumulator stays `undefined` on every non-proceed branch (correct).

Task 5: EDIT test/tools/rewind.test.ts — flip S1's proceed test + add the fold-assertion tests
  - EXTEND makeFakeStore (S1 added it) to accept a scripted restore result + capture the restore call args:
        function makeFakeStore(opts: {
          drifted?: string[]; throwOnCheck?: boolean;
          restoreResult?: RestoreResult; restoreCalls?: { beforeRef: string; opts: RestoreOpts }[];
        }): SnapshotStore {
          return {
            describe: () => ({ backend: "git" }),
            capture: async () => "ref-x",
            dirtyCheck: async () => { if (opts.throwOnCheck) throw new Error("boom"); return [...(opts.drifted ?? [])]; },
            restore: async (beforeRef: string, o: RestoreOpts) => {
              opts.restoreCalls?.push({ beforeRef, opts: o });
              return opts.restoreResult ?? { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
            },
            has: async () => true, retire: async () => {}, gc: async () => {}, destroy: async () => {},
          } as unknown as SnapshotStore;
        }
  - FLIP S1's proceed test (f): it currently asserts restore was NOT called. Change it to: seed a fake
    store with `restoreResult: { reverted: ["src/a.ts"], deleted: [], failed: [], skipped: [], refused:
    [] }` + an empty `restoreCalls: []`; run revert_file_changes:true, last_turn; ASSERT (i) restoreCalls
    has length 1 with beforeRef === the seeded checkpoint.beforeRef AND opts.revertFileChanges === true;
    (ii) firstText contains "Reverted 1 file(s), deleted 0; 0 skipped/failed, 0 refused (see log).";
    (iii) the persisted marker (pi.appended find customType "mulligan:rewind").data.revert.revertedFiles
    deep-equals ["src/a.ts"] AND .backend === "git"; (iv) res.details.revertSummary.reverted === 1.
  - ADD (in the same S1 describe block, or a new "step 6b restore fold (P4.M2.T1.S2)" block):
    (g) DELETIONS: restoreResult deleted:["src/new.ts"] → text "deleted 1"; marker.revert.deletedFiles
        === ["src/new.ts"]; revertSummary.deleted === 1.
    (h) FAILURES+SKIPPED: restoreResult failed:["x"], skipped:["y"] → text "2 skipped/failed";
        marker.revert.failedFiles === ["x"] AND marker.revert.skipped === true.
    (i) REFUSED-from-restore (distinct from dirty-guard refuse): restoreResult refused:["z"] → text
        "1 refused"; marker.revert.refusedFiles === ["z"]. (The dirty-guard refuse is S1's branch, which
        never reaches restore; this tests restore RETURNING refused buckets, e.g. a mid-restore conflict.)
    (j) delete_created_files flag threading: run delete_created_files:true (revert_file_changes false) →
        restoreCalls[0].opts.deleteCreatedFiles === true AND opts.revertFileChanges === false. (Confirms
        CRITICAL #3: the tool does NOT gate on allowDeleteCreatedFiles — the backend does.)
    (k) ONE-MARKER-ENTRY assertion (the re-order): after a proceed rewind, pi.appended contains EXACTLY
        ONE mulligan:rewind entry (not a follow-up amendment) AND that single entry's data.revert is
        populated. (Guards against option (b) drift + confirms the persist relocation.)
    (l) NON-PROCEED regression: each of S1's other branches (disabled/group/missing/refuse) → the
        persisted marker's data.revert is UNDEFINED (absent) AND res.details.revertSummary is undefined
        AND restoreCalls is empty. (Re-assert after the relocate — the move must not leak a revert field.)
    (m) E13 restore-throw fail-open: seed a fake store whose restore THROWS → firstText contains
        "file revert skipped: an error occurred" AND the rewind still succeeds (no throw escapes) AND
        marker.data.revert is undefined. (store.restore never throws per contract, but the guard must
        hold — reuses S1's inner try/catch.)
  - FOLLOW pattern: hand-rolled fakes (NO vi.fn()); `.js` imports; setConfig({revert:{enabled:true}});
    seed `const rt = getRuntime(sid); rt.store = makeFakeStore({...}); rt.snapshots!.set("turn",
    {label:"turn",backend:"git",beforeRef:"rb",afterRef:"ra",turnIndex:0,ts:Date.now()})`.
  - GOTCHA: the success-path tests need a contextEntries snapshot so the rewind reaches 6b (mirror an
    existing last_turn success test's makeCtx setup — a user message + a tool-call group). To read the
    persisted marker, use the fakePi's `appended` array (makePi captures every appendEntry call).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the filled proceed seam (Task 2). Lives inside S1's existing inner try/catch (E13).
//   `store` + `checkpoint` are S1 consts already in scope at the seam (the nested proceed-else).
const restoreResult: RestoreResult = await store.restore(checkpoint.beforeRef, {
  revertFileChanges: params.revert_file_changes === true,   // CRITICAL #3: no tool-side gate
  deleteCreatedFiles: params.delete_created_files === true, //   (backend gates allowDeleteCreatedFiles)
});
revertBlock = {                                              // CRITICAL #2: rides the spread (no cast)
  revertedFiles: restoreResult.reverted,
  deletedFiles: restoreResult.deleted,
  failedFiles: restoreResult.failed,
  refusedFiles: restoreResult.refused,
  skipped: restoreResult.skipped.length > 0,                 // CRITICAL #7: string[] → boolean
  backend: store.describe().backend,
};
revertClause =                                              // CRITICAL #6: NO leading space
  `Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; ` +
  `${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, ` +
  `${restoreResult.refused.length} refused (see log).`;
// (Optional, Task 4) stash the COUNT summary for RewindDetails (skipped count is lost in the boolean fold):
revertSummaryDetails = {
  reverted: restoreResult.reverted.length, deleted: restoreResult.deleted.length,
  failed: restoreResult.failed.length, skipped: restoreResult.skipped.length,
  refused: restoreResult.refused.length, backend: store.describe().backend,
};

// PATTERN — the relocated persist (Task 3). MOVED from before-6b to after-6b; `revert: revertBlock` added.
//   Declared accumulators (Task 1, at the 6b-block top, function/try scope):
//     let revertClause = "";           // (S1)
//     let revertRefused = false;        // (S1)
//     let revertBlock: RewindMarker["revert"];                  // (S2 — Task 1)
//     let revertSummaryDetails: RewindDetails["revertSummary"]; // (S2 — Task 4, optional)
const payload = {
  granularity,
  options: { protect: config.rewind.protectedRoles },
  excludeToolCallId: toolCallId,
  note: params.note,
  ledger,
  hideEntryIds,
  checkpoint: params.checkpoint, // GOTCHA #1 (unchanged): frozen-omitted; rides the cast
  revert: revertBlock,           // [P4.M2.T1.S2] revert audit block; undefined ⇒ omitted in JSON
};
const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
leaveNote(pi, rendered, markerId ?? toolCallId);

// PATTERN — step 9 return (Task 4). Thread revertClause (S1) + revertSummary (S2) into the output.
const { text } = successText(granularity, k, hasWarning, revertClause); // S1's 4th param
return {
  content: [{ type: "text", text }],
  details: { granularity, k, ledger, hideEntryIds, markerId, revertRefused, revertSummary: revertSummaryDetails },
};

// PATTERN — makeFakeStore (Task 5). S1's helper EXTENDED with a scripted restoreResult + call capture.
function makeFakeStore(opts: {
  drifted?: string[]; throwOnCheck?: boolean;
  restoreResult?: RestoreResult; restoreCalls?: { beforeRef: string; opts: RestoreOpts }[];
}): SnapshotStore {
  return {
    describe: () => ({ backend: "git" }),
    capture: async () => "ref-x",
    dirtyCheck: async () => { if (opts.throwOnCheck) throw new Error("boom"); return [...(opts.drifted ?? [])]; },
    restore: async (beforeRef: string, o: RestoreOpts) => {
      opts.restoreCalls?.push({ beforeRef, opts: o });
      return opts.restoreResult ?? { reverted: [], deleted: [], failed: [], skipped: [], refused: [] };
    },
    has: async () => true, retire: async () => {}, gc: async () => {}, destroy: async () => {},
  } as unknown as SnapshotStore;
}
// Seeding + asserting the persisted marker:
//   setConfig({ revert: { enabled: true } });
//   const sid = <makeCtx sessionId>; const rt = getRuntime(sid);
//   const calls: { beforeRef: string; opts: RestoreOpts }[] = [];
//   rt.store = makeFakeStore({ drifted: [], restoreResult: { reverted: ["src/a.ts"], deleted: [], failed: [], skipped: [], refused: [] }, restoreCalls: calls });
//   rt.snapshots!.set("turn", { label: "turn", backend: "git", beforeRef: "rb", afterRef: "ra", turnIndex: 0, ts: Date.now() });
//   const res = await run(pi, ctx, { note: VALID_NOTE, granularity: "last_turn", revert_file_changes: true }, "tc1");
//   expect(firstText(res)).toContain("Reverted 1 file(s), deleted 0; 0 skipped/failed, 0 refused (see log).");
//   expect(calls).toHaveLength(1); expect(calls[0].beforeRef).toBe("rb"); expect(calls[0].opts.revertFileChanges).toBe(true);
//   const marker = pi.appended.find((a) => a.customType === "mulligan:rewind")!.data as any;
//   expect(marker.revert.revertedFiles).toEqual(["src/a.ts"]); expect(marker.revert.backend).toBe("git");
//   expect((res.details as any).revertSummary.reverted).toBe(1);
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO NEW FILES. This item edits ONE source file + ONE test file (.ts, ESM .js imports).
TOOL BODY (src/tools/rewind.ts):
  - FILL S1's proceed seam: store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles})
    + build revertBlock + set revertClause (+ stash revertSummaryDetails).
  - RELOCATE step 7 (persist + leaveNote) to AFTER step 6b; ADD `revert: revertBlock` to the payload.
  - ADD `let revertBlock` (+ `let revertSummaryDetails`) accumulators at S1's 6b-block-top scope.
  - ADD RewindDetails.revertSummary? + include it in the step-9 return.
  - ADD imports: `type { RestoreResult }` (store.js) + `type { RewindMarker }` (markers.js).
STORE (read-only): store.restore(beforeRef, opts) — async; awaited. store.describe().backend — sync.
MARKER: the revert field is folded into the ORIGINAL marker entry (persist relocated AFTER 6b). The
  filter + readMarkers are UNCHANGED (no new customType; revert is just an optional field on the
  existing mulligan:rewind entry, read off data.revert for /tree audit — not consulted by the filter).
CONFIG (read-only): config.rewind.protectedRoles (unchanged, already in payload). NOT allowDeleteCreatedFiles
  (gated in the backend — CRITICAL #3).
HANDOFF: P4.M2.T2.T1 consumes details.revertSummary (the warning reword). S2 does NOT reword the warning.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project. The RestoreResult + RewindMarker type imports, the revertBlock union,
# the `revert: revertBlock` payload field (on the existing cast), the await on store.restore, and the
# RewindDetails.revertSummary addition must all resolve.
npx tsc --noEmit
npx tsc --noEmit 2>&1 | grep -E 'tools/rewind'   # isolate this item's file
# Expected: zero errors. If "Property 'restore' does not exist on type 'never'" → `store` narrowed to
# never inside the nested else (S1's `if (!store || !checkpoint)` guard should narrow it to defined; if
# not, hoist `const s = store;` before the branch). If "Property 'revert' does not exist on type
# RewindMarkerInput" → the markers.ts revert field (P1.M2.T2.S1) is NOT present — verify it shipped.

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/tools/rewind.ts + test/tools/rewind.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/tools/rewind.ts test/tools/rewind.test.ts
# Expected: clean (the additions follow the file's existing multi-line style).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the rewind suite (fast feedback while implementing).
npx vitest run test/tools/rewind.test.ts
# Expected: ALL green. Watch specifically:
#   - S1's NON-proCEED decision-tree tests STILL pass (disabled/group/missing/refuse) — the persist
#     relocation must not change their output (revertBlock stays undefined ⇒ no revert field).
#   - S1's NO-FLAGS regression test STILL passes (byte-identical v1.1 path — no revert clause).
#   - The FLIPPED proceed test (f) now asserts restore WAS called + the fold appears.
#   - The new "step 6b restore fold" tests (g–m) all pass.

# Confirm no cross-breakage in the marker/store/capture suites (this item is read-only on those).
npx vitest run test/markers.test.ts test/store.test.ts test/capture.test.ts test/index.test.ts

# Full suite — confirm no regressions (the persist relocation is the riskiest change; a red suite
# outside rewind.test.ts means an accidental edit — revert it).
npx vitest run
# Expected: full suite green.
```

`test/tools/rewind.test.ts` tests ADDED/MODIFIED by this item:

```yaml
# MODIFIED (flip S1's proceed test):
  - it("PROCEEDS: store.restore called once; success text carries the revert clause; marker carries revert block")
    # (was S1's "PROCEEDS (no clause, no restore yet)"; now asserts restore ran + the fold)
# ADDED ("step 6b restore fold (P4.M2.T1.S2)" describe block, or appended to S1's):
  - it("folds deletions: 'deleted <Y>'; marker.revert.deletedFiles populated; revertSummary.deleted")
  - it("folds failures+skipped: '<Z> skipped/failed'; marker.revert.failedFiles; marker.revert.skipped===true")
  - it("folds refused-from-restore: '<W> refused'; marker.revert.refusedFiles (distinct from dirty-guard refuse)")
  - it("threads delete_created_files through to RestoreOpts.deleteCreatedFiles (no tool-side allowDelete gate)")
  - it("persists EXACTLY ONE mulligan:rewind entry carrying data.revert (re-order, not an amendment)")
  - it("NON-PROCEED branches leave data.revert undefined + revertSummary undefined + restore uncalled")
  - it("E13: a store.restore THROW degrades to 'file revert skipped: an error occurred' (rewind succeeds)")
```

### Level 3: Integration Testing (System Validation)

```bash
# This item is UNIT-tier (test/tools/rewind.test.ts). The end-to-end capture→decision→restore→fold flow
# is validated by the F-revert-* integration scenarios in P5.M1.T1 (Tier 2 — real temp git/non-git dirs,
# real backends, real capture hooks producing real rt.snapshots entries; specifically F-revert-git
# exercises a real git restore + asserts the persisted marker.revert block end-to-end, and F-revert-
# failopen exercises the E27 best-effort path). This item does NOT add those — it makes the restore +
# fold unit-testable via fakes.

# Optional smoke (a real git restore end-to-end): in a temp repo, setCheckpoint, edit+commit a file,
# agent_end, then rewind({revert_file_changes:true, granularity:"last_turn"}) → expect the file restored
# to pre-span content + the success text clause + the marker.revert block (visible in /tree). This is
# the F-revert-git scenario (P5.M1.T1) — optional sanity here, authoritative there.
tmp=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt && git add -A && git commit -qm init
# (build the extension: npm run build) then in a scripted session drive the rewind + assert the fold.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# MANUAL fold audit — confirm the success-text clause + the marker revert block match the spec VERBATIM
# by diffing the test assertions against spec/05 §1 step 6b + spec/14 §7 + spec/04 §3 (rephrase = bug):
#   - clause: "Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused (see log)." (NO leading space)
#   - block:  { revertedFiles, deletedFiles, failedFiles, refusedFiles, skipped: <bool>, backend }

# Confirm the re-order produced ONE marker entry (not an amendment) — inspect the raw session JSONL after
# a proceed rewind: exactly one "mulligan:rewind" custom entry, and its data.revert is populated.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (RestoreResult + RewindMarker imports resolve; revertBlock compiles;
      `revert: revertBlock` on the existing cast type-checks; the await on store.restore type-checks;
      RewindDetails.revertSummary is read into the return).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes (all green incl. the flipped proceed test + new
      fold tests + S1's non-proceed tests still green).
- [ ] `npx vitest run` (full suite) passes — no accidental breakage from the persist relocation.
- [ ] No new lint/format errors on `src/tools/rewind.ts` and `test/tools/rewind.test.ts`.

### Feature Validation

- [ ] Proceed branch: restore called EXACTLY ONCE with `checkpoint.beforeRef` + the verbatim opts.
- [ ] Success text (proceed): the EXACT clause present (no leading space; correct counts).
- [ ] Persisted marker (proceed): `data.revert` deep-equals the 6-field block; `backend` from describe().
- [ ] ONE marker entry (the re-order); its `data.revert` is populated in the SAME entry as id/seq.
- [ ] Non-proceed branches: `data.revert` absent/undefined; `revertSummary` undefined; restore uncalled;
      output byte-identical to S1.
- [ ] `allowDeleteCreatedFiles` NOT read by the tool (flag threaded through verbatim).
- [ ] E13: a store.restore throw degrades to the skip notice; rewind completes; no revert field.

### Code Quality Validation

- [ ] Follows existing codebase patterns (the factory seam; the try/catch fail-open discipline; `.js` imports).
- [ ] File placement matches the desired codebase tree (no new files).
- [ ] Anti-patterns avoided (no double-gating allowDelete; no second try/catch around restore; no
      amendment entry; no mutation-warning reword).
- [ ] Dependencies properly managed (type-only imports for RestoreResult + RewindMarker).
- [ ] The persist relocation is the ONLY structural change; S1's decision-tree branches are untouched.

### Documentation & Deployment

- [ ] Code is self-documenting (the seam comment cites spec/05 §1 step 6b + spec/14 §7 + P4.M2.T1.S2).
- [ ] The revert-block JSDoc / inline comments explain the re-order rationale (append-only tree).
- [ ] No new environment variables or config knobs.

---

## Anti-Patterns to Avoid

- ❌ Don't append a follow-up "amendment" marker entry (option b) — the item contract chose option (a)
  (relocate persist). Two entries would teach the filter a new customType and split the audit surface.
- ❌ Don't read `config.revert.allowDeleteCreatedFiles` in the tool — it is gated inside the backend
  (git.ts:693). A tool-side gate double-gates and diverges from the item contract.
- ❌ Don't add a second try/catch around `store.restore` — it lives inside S1's existing inner try/catch
  (E13 fail-open). restore never throws anyway (E27).
- ❌ Don't reuse the dirty-guard `afterRef` local as the restore ref — restore uses `checkpoint.beforeRef`
  (the PRE-span state). afterRef is the post-turn state used only by dirtyCheck.
- ❌ Don't reword the E5 mutation warning — that is P4.M2.T2.T1. S2 only exposes `revertSummary`.
- ❌ Don't touch S1's non-proceed branches — they already set revertClause/revertRefused correctly.
- ❌ Don't lose the skipped COUNT when folding — `revert.skipped` is a boolean, but the success-text Z
  uses `skipped.length + failed.length` (the count), and revertSummary keeps the count. Mind the mapping.
- ❌ Don't skip validation because "it should work" — run the full suite after the persist relocation
  (the move is the riskiest change; a leaked revert field or a broken markerId flow is a regression).