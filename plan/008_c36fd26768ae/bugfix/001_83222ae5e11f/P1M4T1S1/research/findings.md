# Research Notes — P1.M4.T1.S1 (changedPaths interface + NoOpStore stub)

## Task Scope
Add a NEW method `changedPaths(beforeRef: string): Promise<string[]>` to the `SnapshotStore`
interface AND a matching no-op stub on `NoOpStore` in `src/snapshot/store.ts`. Mode A (JSDoc only).
NO changes to `GitBackend` (git.ts) or `CasBackend` (cas.ts) — they land in S2/S3.

## ATTEMPT 2 REVISION — the typecheck-cascade root cause + fix (EMPIRICALLY VERIFIED)

### What attempt 1 got right (DO NOT redo — already correct in working tree)
- `src/snapshot/store.ts`: `changedPaths` interface method (line ~112, after `dirtyCheck`, before
  `restore`) + full 5-point JSDoc + `IMPLEMENTED BY: git/cas.` footer. ✅ correct.
- `src/snapshot/store.ts`: NoOpStore stub `async changedPaths(_beforeRef: string): Promise<string[]>
  { return []; }` (line ~373, after `dirtyCheck` stub). ✅ correct.
- `test/store.test.ts`: type-shape test (lines 173-175) using `expectTypeOf`. ✅ correct.
- `npm test` green: 1331 tests, 31 files. ✅ runtime behavior perfect.

### What attempt 1's gate got WRONG (the re-plan trigger)
The original gate claimed widening the interface produces "EXACTLY 2 errors" (git.ts + cas.ts TS2420).
FALSE. It produces **6** (verified: `npm run typecheck` against the attempt-1 working tree):
- 2 EXPECTED: `git.ts:201` + `cas.ts:224` TS2420 "Property 'changedPaths' is missing".
- 4 UNEXPECTED cascade: TS2352 "neither type sufficiently overlaps" at 4 `as CasBackend` CASTS:
  - `src/capture.ts:247` → `(rt.store as CasBackend).capture(...)`
  - `src/capture.ts:367` → `(rt.store as CasBackend).appendExplicitPath("turn", path)`
  - `src/capture.ts:376` → `(rt.store as CasBackend).notifyBashUsed()`
  - `test/integration/revert-explicit.test.ts:502` → `(store as CasBackend).restore(...)`

### WHY the cascade happens (root cause)
A single cast `supertype as Subtype` only typechecks when `Subtype` is structurally a subtype of
`supertype` — which holds ONLY because `CasBackend implements SnapshotStore`. The instant S1 widens
the interface, `CasBackend` stops satisfying the interface (it lacks `changedPaths`), so it is no
longer a subtype. TypeScript's structural-overlap check then rejects all 4 casts (TS2352). The
cascade self-heals at S3 (when `CasBackend` implements `changedPaths` → subtype restored).

### WHY fixing this in S1 (not S2/S3) is REQUIRED — cross-task gate analysis
- Sibling **P1.M4.T1.S2** (GitBackend) gate = "EXACTLY ONE error remains (cas.ts); no OTHER errors
  anywhere." S2 fixes ONLY git.ts. If S1 leaves the 4 cascade errors, S2 lands at **5** errors
  (cas.ts + 4 cascades) → **S2's gate is unreachable too.**
- The cascade only self-heals at S3 (CasBackend). So the casts MUST be hardened before/independent
  of S3. Doing it in S1 (where the interface widens) is the principled, single, up-front fix.
- The robust form `rt.store as unknown as CasBackend` does NOT depend on the subtype invariant →
  typechecks before S3 AND after S3. It is strictly more correct than the fragile single cast.

### THE FIX (Option B — convert the 4 cast EXPRESSIONS to the robust double-cast)
Convert the 4 cast EXPRESSIONS (NOT the 2 JSDoc comment refs at capture.ts:294,328 — those are
prose; update them for doc/code consistency but they are not type-checked) to `as unknown as`:
- `src/capture.ts:247`: `(rt.store as CasBackend)` → `(rt.store as unknown as CasBackend)`
- `src/capture.ts:367`: `(rt.store as CasBackend)` → `(rt.store as unknown as CasBackend)`
- `src/capture.ts:376`: `(rt.store as CasBackend)` → `(rt.store as unknown as CasBackend)`
- `test/integration/revert-explicit.test.ts:502`: `(store as CasBackend)` → `(store as unknown as CasBackend)`

### PRECEDENT (this is an established codebase idiom — 20+ uses)
`grep -rn "as unknown as" src/ test/` → banner.ts:52, commands.ts:78/379/387/394/417, filter.ts
(13 sites), cancel.ts:265, shrink.ts:243, audit.ts (5 sites), rewind.ts:602, banner.test.ts:82/170.

### EMPIRICAL PROOF the revised gate is reachable
Applied the 4 conversions to the attempt-1 working tree → `npm run typecheck` emitted EXACTLY:
- `src/snapshot/cas.ts(224,14): error TS2420: ... Property 'changedPaths' is missing`
- `src/snapshot/git.ts(201,14): error TS2420: ... Property 'changedPaths' is missing`
(Then reverted the experiment; `npm test` = 1331 green.) **Gate: exactly 2 errors, both expected.**

## Codebase facts (verified)

### `src/snapshot/store.ts` structure
- `SnapshotStore` interface: `describe` (sync) + 7 async (`capture`, `dirtyCheck`, `restore`, `has`,
  `retire`, `gc`, `destroy`). All async methods return `Promise<...>`. `changedPaths` is the 8th
  method (async), placed after `dirtyCheck`, before `restore` (logical grouping: both compute a
  path-set diff against a ref; dirtyCheck vs afterRef/working-tree-drift, changedPaths vs
  beforeRef/current-tree-affected-set).
- `NoOpStore implements SnapshotStore` (~line 334). Unused params prefixed `_` (`_label`, `_afterRef`).
- `NoOpStore` class JSDoc says "The 6 methods mirror the async SnapshotStore interface" — becomes
  stale (7 now); updating to 7 is optional polish.

### Backend implementations (will FAIL typecheck — EXPECTED, the 2 errors)
- `src/snapshot/git.ts:201` → `export class GitBackend implements SnapshotStore {`
- `src/snapshot/cas.ts:224` → `export class CasBackend implements SnapshotStore {`
- Neither defines `changedPaths`. The implementing agent MUST NOT "fix" git.ts/cas.ts (S2/S3's job).

### Consumer (rewind.ts) — NOT this item's job, but informs JSDoc
- `src/tools/rewind.ts:849` → `const affectedPaths = ledger.modifiedFiles;` (the BUG-004 root cause).
- Wiring (replace → `await store.changedPaths(checkpoint.beforeRef)`) is **P1.M4.T2.S1**, a LATER item.

## Validation commands (verified from package.json)
- `npm run typecheck` → `tsc --noEmit` (expect EXACTLY 2 errors: git.ts:201 + cas.ts:224 TS2420)
- `npm test` → `vitest run` (full suite; 1331+ green — NoOpStore stub + cast change break nothing)
- `npx vitest run test/store.test.ts` → targeted interface/AsyncMutex/NoOpStore tests green

## Cross-item coordination
- S1 (this) lands at 2 typecheck errors. S2 (GitBackend) → 1 error. S3 (CasBackend) → 0 errors.
- The 4 cast conversions are forward-compatible: typecheck before AND after S3 (superset cast).
- BUG-001 fix (P1.M1.T1.S1, COMPLETE) restructured step 6b's afterRef resolution; the changedPaths
  call site (rewind.ts:849) is in the same block but a different line → no collision with T2.S1.