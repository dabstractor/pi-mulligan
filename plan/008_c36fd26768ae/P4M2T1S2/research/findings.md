# Research Findings — P4.M2.T1.S2 (store.restore + fold into marker.revert + success text)

Scope: fill S1's proceed seam in `rewindExecute` (step 6b) and fold the `RestoreResult`
into the success text + the persisted marker's `revert` field.

## The central design decision — RE-ORDER persist to AFTER step 6b (option (a))

The item description offers two ways to get the revert result into the marker:
- (a) move `appendRewindMarker` AFTER step 6b so `revert` is in the ORIGINAL marker entry; or
- (b) append a follow-up amendment entry.

**(a) is chosen** — the item description calls it cleaner, and
`architecture/codebase_patterns.md §4` confirms: "The payload to appendRewindMarker includes
revert field via spread." The marker tree is APPEND-ONLY (C7 — `appendEntry` returns void, no
update), so you cannot fold into an already-persisted marker; you must persist after computing
the revert block.

### Why the re-order is SAFE (verified against rewind.ts step dependencies)

| consumer of persist-order | runs when | affected by moving persist later? |
|---|---|---|
| depth guard (step 4) / retry budget (4b) | BEFORE 6b/persist; read `getEntries()` | NO — already ran; never see current rewind's marker either way |
| context-fraction stop (4c) `computeFilteredTotal` | BEFORE 6b | NO — reads filtered view, not entries |
| `resolvePreview` ledger/K (step 5) | BEFORE 6b | NO |
| `leaveNote` | paired WITH persist (needs markerId) | NO — moves with it |
| step 7b checkpoint-label consumption | after persist (clears label) | NO — independent of persist timing; keep after persist |
| `markerId` in return details (step 9) | after persist | NO — still in scope |
| `getLeafId()` inside `appendRewindMarker` | at persist | **NO** — 6b's restore writes to the on-disk snapshot STORE, NOT the session entry tree, so the leaf is unchanged when persist runs |

Final order: 6 (renderNote) → **6b (decision + restore + revertBlock)** → 7 (persist WITH
`revert`) → 7b (consume) → 8 (hasWarning) → 9 (return).

## allowDeleteCreatedFiles is gated INSIDE the backend — rewindExecute passes the flag through

`src/snapshot/git.ts` line 693: `if (opts.deleteCreatedFiles && this.cfg.allowDeleteCreatedFiles)`.
The GitBackend ctor receives `MulliganConfig["revert"]` so it has `allowDeleteCreatedFiles`.
**Therefore the rewind tool does NOT read `config.revert.allowDeleteCreatedFiles`** — it passes
`deleteCreatedFiles: params.delete_created_files === true` verbatim (matches the item description
verbatim). Adding a gate in the tool would DOUBLE-gate. (Same applies to CasBackend.)

## The revert field rides the spread — NO cast needed (unlike `checkpoint`)

- `RewindMarker` has `revert?: {...}` (markers.ts, P1.M2.T2.S1 — already shipped).
- `RewindMarkerInput = Omit<RewindMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">` → INCLUDES `revert?`.
- The existing payload already does `as RewindMarkerInput` (for the frozen-omitted `checkpoint`).
- So adding `revert: revertBlock` (where `revertBlock: RewindMarker["revert"] | undefined`) is
  type-safe on the existing cast. `undefined` is omitted by `JSON.stringify` + falsy in `readOwn`
  → matches spec "present only when ... revert ran".

## Exact fold shapes (from item description + spec h2.147 + markers.ts)

Restore call:
```ts
const restoreResult = await store.restore(checkpoint.beforeRef, {
  revertFileChanges: params.revert_file_changes === true,
  deleteCreatedFiles: params.delete_created_files === true,
});
```
Success-text clause (NO leading space — S1's `successText` adds `" "` before revertClause):
```
Reverted ${restoreResult.reverted.length} file(s), deleted ${restoreResult.deleted.length}; ${restoreResult.skipped.length + restoreResult.failed.length} skipped/failed, ${restoreResult.refused.length} refused (see log).
```
Marker revert block (matches `RewindMarker["revert"]` EXACTLY):
```ts
revertBlock = {
  revertedFiles: restoreResult.reverted,
  deletedFiles: restoreResult.deleted,
  failedFiles: restoreResult.failed,
  refusedFiles: restoreResult.refused,
  skipped: restoreResult.skipped.length > 0,   // string[] → boolean
  backend: store.describe().backend,            // "git"|"cas"|"none" — typed match
};
```

## `store.restore` NEVER throws (E27) — but keep S1's inner try/catch

store.ts restore contract: "The op NEVER throws — per-path failures land in failed[]". So the
proceed-branch restore call is safe. It already lives inside S1's step-6b inner try/catch (the
`catch { if (!revertClause) revertClause = "(file revert skipped: an error occurred — 0 files reverted)"; }`),
so a hypothetical throw degrades to a skip notice and `revertBlock` stays undefined → marker has
no revert field → rewind still completes. Do NOT remove that try/catch.

## Sibling-task boundary (do NOT do these)

- **P4.M2.T2.T1** owns the E5 mutation-warning REWORD (when files were reverted). S2 only EXPOSES
  the signal (`details.revertSummary`) — it does NOT reword the warning. Leave S1's step-8 comment
  seam (`// [P4.M2.T2.T1] ...`) untouched.
- S2 does NOT touch the decision-tree branches S1 already wired (disabled / group-granularity /
  missing-checkpoint / refuse). It only fills the PROCEED seam + relocates persist.

## Test idiom (test/tools/rewind.test.ts — confirmed)

- Hand-rolled `makePi`/`makeCtx` fakes (NO `vi.fn()`), `.js` imports, `clearAll()` +
  `setConfig(undefined)` in beforeEach/afterEach.
- `RevertCheckpoint`, `RestoreResult`, `SnapshotStore`, `RewindMarker`, `RewindMarkerInput`
  already imported as types.
- `makeFakeStore` (S1 added it) currently returns empty buckets + a `restoreCalled` callback. S2
  extends it to return a SCRIPTED `RestoreResult` per test.
- S1's proceed test (f) currently asserts restore was NOT called — S2 FLIPS it to assert restore
  WAS called + the fold appears in text + marker.
- Seed pattern: `setConfig({revert:{enabled:true}})`; `const rt = getRuntime(sid); rt.store =
  makeFakeStore({...}); rt.snapshots!.set("turn", {...})`.