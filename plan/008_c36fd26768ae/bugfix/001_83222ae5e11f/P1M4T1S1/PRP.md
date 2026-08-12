---
name: "P1.M4.T1.S1 — Add changedPaths to SnapshotStore interface + NoOpStore stub (BUG-004 contract, attempt 2)"
description: |
  Add the `changedPaths(beforeRef: string): Promise<string[]>` method to the `SnapshotStore`
  interface AND a matching no-op stub on `NoOpStore` in `src/snapshot/store.ts` (Mode A: method +
  JSDoc only). This is the contract-first half of the BUG-004 fix (spec/14 §6 step 2): it declares
  the spec-mandated dirty-guard affected set that the rewind tool (P1.M4.T2.S1) will later use to
  replace the heuristic `ledger.modifiedFiles`, closing the E30 silent-clobber gap for
  python/node/perl/heredoc-modified files. GitBackend (S2) and CasBackend (S3) implement it next —
  the 2 resulting "missing changedPaths" typecheck errors are EXPECTED and intentional.

  ATTEMPT 2 REVISION (re-plan trigger): attempt 1 delivered store.ts correctly but its Level 1 gate
  ("exactly 2 typecheck errors") was UNREACHABLE — widening the interface also breaks 4 downstream
  `as CasBackend` CAST expressions (src/capture.ts ×3 + test/integration/revert-explicit.test.ts ×1)
  via TS2352, because the single-cast idiom relies on the `CasBackend implements SnapshotStore`
  subtype relationship that the interface widening temporarily breaks. This revised PRP ADDS a
  fifth, minimal task: harden those 4 casts to the robust `as unknown as CasBackend` double-cast
  form (an established 20+-use codebase idiom). EMPIRICALLY VERIFIED: with the 4 conversions applied,
  `npm run typecheck` emits EXACTLY the 2 expected TS2420 errors (git.ts:201 + cas.ts:224) and
  nothing else. This fix is REQUIRED not just for S1's gate but for S2's gate too (S2 fixes only
  git.ts; leaving the cascade would make S2 land at 5 errors vs its "exactly 1" gate), and is
  forward-compatible with S3 (the double-cast typechecks before AND after CasBackend implements
  changedPaths).
---

## Goal

**Feature Goal**: Ship the `changedPaths(beforeRef: string): Promise<string[]>` **contract** on the
`SnapshotStore` interface (+ a no-op stub on `NoOpStore`) so that the downstream backends (S2 git,
S3 cas) and the eventual rewind-tool wiring (P1.M4.T2.S1) can program against the spec-mandated
BUG-004 affected set — AND harden the 4 downstream `as CasBackend` casts so the contract-first
ordering produces a clean, verifiable typecheck gate (exactly the 2 expected backend errors).

**Deliverable**:
1. `src/snapshot/store.ts` — `changedPaths` added to the `SnapshotStore` interface (after `dirtyCheck`,
   before `restore`) with full 5-point JSDoc; matching `async changedPaths(_beforeRef): Promise<string[]>
   { return []; }` stub on `NoOpStore` (after the `dirtyCheck` stub).
2. `src/capture.ts` — convert the 3 `as CasBackend` cast **expressions** (lines 247, 367, 376) to
   `as unknown as CasBackend`; optionally update the 2 JSDoc comment refs (lines 294, 328) for doc/code consistency.
3. `test/integration/revert-explicit.test.ts` — convert the 1 `as CasBackend` cast **expression**
   (line 502) to `as unknown as CasBackend`.
4. `test/store.test.ts` — the `expectTypeOf` type-shape test for `changedPaths` (mirrors the
   `dirtyCheck` type test).
5. (Optional polish) update the `NoOpStore` class JSDoc "6 methods" count → 7.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`) emits **EXACTLY TWO** errors, both the expected TS2420
  "Property 'changedPaths' is missing" — at `src/snapshot/git.ts:201` and `src/snapshot/cas.ts:224`.
  **No TS2352 / no other errors anywhere.** (These 2 are intentional — S2/S3 resolve them.)
- `npm test` (`vitest run`) is fully green (1331+ tests) — no behavioral regression. The NoOpStore
  stub is a true no-op and the cast conversion is type-only (runtime-identical).
- `npx vitest run test/store.test.ts` green, including the new `changedPaths` type-shape test.
- `git.ts` / `cas.ts` are UNTOUCHED (S2/S3's job — see Anti-Patterns). `rewind.ts` is UNTOUCHED
  (P1.M4.T2.S1's job).

## Why

- **BUG-004 root cause** (spec/14 §6 step 2; architecture/bug_fix_analysis.md §BUG-004): the rewind
  dirty guard computes its affected set from `ledger.modifiedFiles` (a HEURISTIC extraction from tool
  calls) instead of the spec-mandated snapshot diff. `restore()` reverts EVERY file differing from
  `beforeRef`, but `modifiedFiles` misses files mutated via `python -c` / `node script.js` / `perl -i`
  / heredocs / `awk -i inplace` (those land in `ledger.bashSideEffects`). So the guard inspects a
  SUBSET of what restore touches → a concurrent human edit to such a file is silently clobbered (E30
  violation — "never silently clobbers concurrent edits").
- **This item's role**: declare the contract method `changedPaths(beforeRef)` (the spec-mandated
  affected set) on the interface + a no-op stub, so S2/S3 can implement it and P1.M4.T2.S1 can wire
  `await store.changedPaths(checkpoint.beforeRef)` into `rewind.ts:849` (replacing `ledger.modifiedFiles`).
- **Why the cast hardening is part of THIS item**: the contract-first ordering (interface widens
  before the implementations catch up) temporarily breaks the `CasBackend implements SnapshotStore`
  subtype relationship. The codebase's 4 `as CasBackend` single-casts depend on that relationship, so
  they cascade into TS2352 errors. Hardening them here (the moment the interface widens) is the single,
  principled, up-front fix — it also unblocks S2's gate and is forward-compatible with S3.

## What

**User-visible behavior**: NONE. This is Mode A (interface declaration + JSDoc + a no-op stub). No
config, no API surface, no runtime path changes. `changedPaths` is not yet called by any production
code (P1.M4.T2.S1 wires it). The cast conversions are type-only — runtime-identical.

**Technical change**:
1. `SnapshotStore` interface gains one async method `changedPaths(beforeRef: string): Promise<string[]>`.
2. `NoOpStore` gains the matching no-op stub `return [];`.
3. 4 downstream `as CasBackend` casts become `as unknown as CasBackend` (robust double-cast).
4. One `expectTypeOf` type-shape test is added to `test/store.test.ts`.

### Success Criteria

- [ ] `changedPaths(beforeRef: string): Promise<string[]>` is declared on `SnapshotStore` (after
      `dirtyCheck`, before `restore`) with the full 5-point JSDoc.
- [ ] `NoOpStore` has `async changedPaths(_beforeRef: string): Promise<string[]> { return []; }`.
- [ ] The 4 `as CasBackend` cast expressions (capture.ts:247,367,376; revert-explicit.test.ts:502)
      are converted to `as unknown as CasBackend`.
- [ ] `npm run typecheck` = EXACTLY 2 errors (git.ts:201 + cas.ts:224 TS2420 "missing changedPaths").
- [ ] `npm test` green (1331+); `npx vitest run test/store.test.ts` green incl. the new type test.
- [ ] `git.ts`, `cas.ts`, `rewind.ts` are NOT modified.

## All Needed Context

### Context Completeness Check

_Pass._ A developer who knows nothing about this codebase can implement this from: (a) the exact
file/line targets below, (b) the verbatim JSDoc content, (c) the exact cast-conversion recipe, and
(d) the empirically-verified gate (exactly 2 expected errors). All references are concrete and the
gate was confirmed by running the commands against the attempt-1 working tree.

### Documentation & References

```yaml
# MUST READ — spec + root-cause context
- doc: spec/14-working-tree-revert.md §6 step 2
  why: defines the dirty-guard affected set as "paths that differ between beforeRef and the current
       tree" — this is the exact contract changedPaths must implement. Quote it verbatim in the JSDoc.
  critical: the affected set is the snapshot diff, NOT the heuristic ledger.modifiedFiles.

- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/bug_fix_analysis.md
  section: "## BUG-004 (Major): Dirty guard affected-set uses heuristic ledger"
  why: root cause + the 4 exact change sites (store.ts interface+NoOpStore, git.ts, cas.ts, rewind.ts).
       This item = change site #1 only (store.ts). rewind.ts = P1.M4.T2.S1 (NOT this item).

- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/architecture/system_context.md
  why: the SnapshotStore contract + the contract-first (S1→S2→S3) rollout ordering.

# PRIMARY TARGET FILE
- file: src/snapshot/store.ts
  why: the SnapshotStore interface (line ~112 region) + NoOpStore class (line ~373 region).
  pattern: MIRROR the existing `dirtyCheck` method — same async shape (Promise<string[]>), same
           JSDoc density, same "IMPLEMENTED BY: git/cas." footer. NoOpStore stub mirrors
           `async dirtyCheck(_afterRef, _paths): Promise<string[]> { return []; }` exactly.
  gotcha: All async interface methods return Promise<...>; unused params are `_`-prefixed
          (`_beforeRef`). changedPaths is async (uses the backend's AsyncMutex in S2/S3).

# CAST HARDENING TARGETS (attempt-2 addition)
- file: src/capture.ts
  why: 3 `as CasBackend` cast EXPRESSIONS (lines 247, 367, 376) break (TS2352) once the interface
       widens. Convert each to `as unknown as CasBackend`.
  pattern: the established codebase double-cast idiom — `grep -n "as unknown as" src/` shows 20+ uses
           (commands.ts, filter.ts, cancel.ts, shrink.ts, audit.ts, rewind.ts:602, banner.ts).
  gotcha: lines 294 + 328 are JSDoc COMMENT refs to the cast (prose like
          "`(rt.store as CasBackend).notifyBashUsed()`") — NOT type-checked. Update them to
          `as unknown as CasBackend` for doc/code consistency (optional; does not affect the gate).

- file: test/integration/revert-explicit.test.ts
  why: 1 `as CasBackend` cast EXPRESSION (line 502) — `(store as CasBackend).restore(...)`.
  pattern: convert to `(store as unknown as CasBackend).restore(...)`.

# TEST TARGET FILE
- file: test/store.test.ts
  why: existing type-shape tests use `expectTypeOf<SnapshotStore["X"]>()` (lines ~149-177). Add a
       matching test for `changedPaths` mirroring the `dirtyCheck` test (single string param, Promise<string[]> return).
  pattern: see the verbatim test body in Implementation Task 4 below.
```

### Current Codebase tree (relevant slice)

```bash
src/snapshot/
  store.ts          # SnapshotStore interface + NoOpStore + AsyncMutex + detectAndCreate  ← PRIMARY TARGET
  git.ts            # GitBackend implements SnapshotStore  (line 201)  ← EXPECTED TS2420 (S2 fixes)
  cas.ts            # CasBackend implements SnapshotStore  (line 224)  ← EXPECTED TS2420 (S3 fixes)
src/capture.ts      # 3 `as CasBackend` casts (lines 247, 367, 376)    ← CAST HARDENING
src/tools/rewind.ts # the dirty guard (line 849) — NOT this item (P1.M4.T2.S1)
test/store.test.ts                          # type-shape tests           ← ADD changedPaths test
test/integration/revert-explicit.test.ts    # 1 `as CasBackend` cast (line 502)  ← CAST HARDENING
```

### Desired Codebase tree with files to be changed

```bash
src/snapshot/store.ts                       # MODIFIED — +changedPaths interface method + NoOpStore stub
src/capture.ts                              # MODIFIED — 3 casts → `as unknown as CasBackend`
test/integration/revert-explicit.test.ts    # MODIFIED — 1 cast  → `as unknown as CasBackend`
test/store.test.ts                          # MODIFIED — +changedPaths expectTypeOf test
# (no new files; no deletions)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — the contract-first cascade (the attempt-2 re-plan trigger).
// `rt.store` is typed `SnapshotStore`. The single cast `rt.store as CasBackend` typechecks ONLY
// because `CasBackend implements SnapshotStore` (subtype relationship). The instant S1 adds
// changedPaths to the interface, CasBackend no longer satisfies the interface → no longer a subtype
// → TypeScript rejects the cast with TS2352 "neither type sufficiently overlaps… convert to 'unknown'
// first". FIX: use the robust double-cast `rt.store as unknown as CasBackend` (an established
// codebase idiom — 20+ uses). This typechecks before AND after S3 (the subtype-independence is the
// whole point). DO NOT "fix" it by implementing changedPaths on CasBackend — that is S3's job and
// would erase the EXPECTED cas.ts TS2420.

// CRITICAL #2 — the 2 TS2420 errors in git.ts/cas.ts are INTENTIONAL and EXPECTED.
// `GitBackend`/`CasBackend` `implements SnapshotStore` but do not yet define `changedPaths`. Adding
// the interface method makes tsc emit "Class 'X' incorrectly implements interface 'SnapshotStore'.
// Property 'changedPaths' is missing" at git.ts:201 and cas.ts:224. These are S2/S3's work. Do NOT
// edit git.ts or cas.ts.

// CRITICAL #3 — changedPaths is async (Promise return), like all 7 other mutating/query methods.
// It is serialized via each backend's AsyncMutex in S2/S3 (spec/14 §4.3). Only `describe()` is sync.
// The interface signature is `changedPaths(beforeRef: string): Promise<string[]>;` (NOT a sync return).

// GOTCHA — NoOpStore class JSDoc (~line 334) says "The 6 methods mirror the async SnapshotStore
// interface". After adding changedPaths that count is stale (7). Updating it is optional polish.
```

## Implementation Blueprint

### Data models and structure

No new data models. `changedPaths` exchanges only primitives: an opaque `beforeRef: string` (the same
ref type `restore()`/`dirtyCheck()` take) and returns `string[]` (workspace-relative POSIX paths, the
same shape as every `RestoreResult` bucket and `dirtyCheck`'s return). It references the existing
`SnapshotStore` interface — no new exported types (per the work-item contract: "Export no new types").

### Implementation Tasks (ordered by dependencies)

> **NOTE**: Tasks 1–4 reflect the **attempt-1 working tree state** (store.ts + store.test.ts are
> already correctly modified there). If starting from that tree, VERIFY Tasks 1 & 4 are present and
> correct (diff against the verbatim content below), then do Tasks 2 & 3 (the new cast hardening).
> If starting from a clean checkout, implement all four in order.

```yaml
Task 1: MODIFY src/snapshot/store.ts — interface method (PRIMARY DELIVERABLE)
  - ADD to the `SnapshotStore` interface, placed AFTER `dirtyCheck` and BEFORE `restore` (logical
    grouping: both compute a path-set diff against a ref):
      /**
       * <5-point JSDoc — see verbatim block in Task 1 JSDoc below>
       */
      changedPaths(beforeRef: string): Promise<string[]>;
  - FOLLOW pattern: the existing `dirtyCheck(afterRef, paths): Promise<string[]>` method (same async
    shape, same JSDoc density, same "IMPLEMENTED BY: git/cas." footer convention).
  - NAMING: `changedPaths` (camelCase method); param `beforeRef` (snake... actually camelCase —
    matches `afterRef`/`beforeRef` used by dirtyCheck/restore).
  - PLACEMENT: SnapshotStore interface, after dirtyCheck, before restore.

Task 2: MODIFY src/snapshot/store.ts — NoOpStore stub (PRIMARY DELIVERABLE)
  - ADD to the `NoOpStore` class, placed AFTER the `dirtyCheck` stub and BEFORE the `restore` stub:
      async changedPaths(_beforeRef: string): Promise<string[]> {
        return []; // no snapshot ⇒ no changed paths
      }
  - FOLLOW pattern: `async dirtyCheck(_afterRef: string, _paths: string[]): Promise<string[]> { return []; }`
    (underscore-prefixed unused param, `return [];`, inline comment explaining the no-op).
  - NAMING: param `_beforeRef` (underscore-prefixed = unused, per NoOpStore convention).
  - PLACEMENT: NoOpStore class, after dirtyCheck stub, before restore stub.

Task 3: MODIFY src/capture.ts — harden 3 `as CasBackend` casts (ATTEMPT-2 ADDITION)
  - CONVERT each of these 3 cast EXPRESSIONS (single-cast → robust double-cast):
      line 247:  (rt.store as CasBackend)            →  (rt.store as unknown as CasBackend)
      line 367:  (rt.store as CasBackend)            →  (rt.store as unknown as CasBackend)
      line 376:  (rt.store as CasBackend)            →  (rt.store as unknown as CasBackend)
  - FOLLOW pattern: the established `as unknown as T` idiom — precedent: commands.ts:78/379/387/394/417,
    filter.ts (13 sites), cancel.ts:265, shrink.ts:243, audit.ts (5 sites), rewind.ts:602, banner.ts:52.
  - GOTCHA: do NOT touch git.ts/cas.ts/rewind.ts. The casts reach CasBackend-specific methods
    (`capture` with an extra path-list arg, `appendExplicitPath`, `notifyBashUsed`) that are PUBLIC on
    CasBackend but intentionally NOT on the SnapshotStore interface — the double-cast is the correct,
    documented way to express "I verified describe().backend==='cas', trust me".
  - OPTIONAL POLISH: update the 2 JSDoc comment refs at lines 294 + 328 (prose like
    "`(rt.store as CasBackend).notifyBashUsed()`") to `as unknown as CasBackend` for doc/code
    consistency. These are NOT type-checked (in `*`-comment blocks); updating them does not affect the
    gate but keeps the docs accurate.

Task 4: MODIFY test/integration/revert-explicit.test.ts — harden 1 `as CasBackend` cast (ATTEMPT-2 ADDITION)
  - CONVERT this cast EXPRESSION:
      line 502:  (store as CasBackend)  →  (store as unknown as CasBackend)
  - CONTEXT: the line is `const rr = await (store as CasBackend).restore("turn", {...})` — the test
    deliberately bypasses the rewind dirty guard to test capture behavior directly.
  - FOLLOW pattern: same `as unknown as T` idiom as Task 3.

Task 5: MODIFY test/store.test.ts — type-shape test (RECOMMENDED; attempt-1 already added it)
  - ADD a test mirroring the existing `dirtyCheck` type-shape test, placed adjacent to it:
      it("(type) changedPaths(beforeRef) returns Promise<string[]> (async — spec/14 §6 step 2, BUG-004)", () => {
        expectTypeOf<SnapshotStore["changedPaths"]>().parameters.toEqualTypeOf<[string]>();
        expectTypeOf<SnapshotStore["changedPaths"]>().returns.toEqualTypeOf<Promise<string[]>>();
      });
  - FOLLOW pattern: the `dirtyCheck`/`has`/`retire` `expectTypeOf` tests already in this file
    (assert `.parameters.toEqualTypeOf<[...]>` + `.returns.toEqualTypeOf<Promise<...>>()`).
  - COVERAGE: parameter arity (exactly one string) + return type (Promise<string[]>).
  - PLACEMENT: in the existing interface type-shape `describe` block, near the dirtyCheck test.
```

#### Task 1 JSDoc — verbatim content (5 required points + footer)

```typescript
/**
 * Return the workspace-relative POSIX paths that differ between the `beforeRef` snapshot and the
 * CURRENT working tree — exactly the set of files `restore()` would touch (the affected set the
 * rewind dirty guard must inspect). This is the spec-mandated affected set for the dirty guard —
 * spec/14 §6 step 2: "paths that differ between beforeRef and the current tree".
 *
 * Algorithm: git backend runs `git diff --name-only <beforeRef>` against the shadow-repo ref
 * (lists every tracked path whose current work-tree blob differs from the beforeRef tree blob);
 * cas backend loads the beforeRef manifest and hash-compares each entry against the current file's
 * hash (plus detects files NEW since capture — present in the work tree but absent from the
 * manifest). Both return workspace-relative POSIX paths (POSIX-normalized like restore()'s buckets).
 *
 * Used by rewindExecute step 6b (the BUG-004 fix, P1.M4.T2.S1) to replace the HEURISTIC
 * `ledger.modifiedFiles`, which misses files mutated via `python -c` / `node script.js` /
 * `perl -i` / heredocs / `awk -i inplace` (those land in `ledger.bashSideEffects`, not
 * `modifiedFiles`) — so the guard currently inspects a SUBSET of what restore touches and can
 * silently clobber concurrent human edits (E30). BEST-EFFORT: never rejects — returns `[]` on any
 * error (mirrors restore()'s "NEVER throws" + gc()'s "NEVER rejects" guarantees).
 * IMPLEMENTED BY: git/cas.
 */
changedPaths(beforeRef: string): Promise<string[]>;
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — interface method mirrors dirtyCheck (src/snapshot/store.ts):
//   async, Promise<string[]> return, opaque string ref param, JSDoc with "IMPLEMENTED BY: git/cas." footer.
//   Placement: right after dirtyCheck (both are ref-vs-tree path-set diffs), right before restore.

// PATTERN — NoOpStore stub mirrors the dirtyCheck stub:
//   async, _-prefixed unused param, `return [];`, inline `// no snapshot ⇒ no changed paths` comment.

// PATTERN — the robust double-cast (src/capture.ts + revert-explicit.test.ts):
//   `rt.store` is `SnapshotStore`; we call CasBackend-specific methods after checking describe().backend==='cas'.
//   rt.store.describe().backend === "cas"   // runtime guard first
//     ? await (rt.store as unknown as CasBackend).capture("turn-after", explicitPaths)  // ← double-cast
//   The `unknown` intermediate is the TypeScript-sanctioned way to say "I verified this at runtime;
//   trust me" — it does NOT depend on the (temporarily broken) subtype relationship.

// CRITICAL — why NOT to "fix" the TS2420 in git.ts/cas.ts here:
//   Those 2 errors are the S2/S3 handoff signal. Implementing changedPaths on a backend in S1 would
//   (a) violate dependency ordering, (b) erase the expected error S2/S3 are scoped to resolve, and
//   (c) blur this item's contract-only scope. Leave them.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (no new env vars, no config.ts change)
ROUTES: none
EXPORTS: "Export no new types" (per work-item contract). changedPaths is a method on the existing
         exported `SnapshotStore` interface + `NoOpStore` class — both already exported.
TYPECHECK:
  - expected_state: "EXACTLY 2 errors after this item: git.ts:201 + cas.ts:224 TS2420 (both
    'Property changedPaths is missing'). These are the S2/S3 handoff."
  - cascade_resolved: "the 4 TS2352 cast errors from attempt 1 are ELIMINATED by Tasks 3 & 4."
  - forward_compat: "after S2 lands → 1 error (cas.ts); after S3 lands → 0 errors. The 4 double-casts
    typecheck at every stage."
```

## Validation Loop

### Level 1: Typecheck (the gate that attempt 1 could not meet — NOW VERIFIED REACHIBLE)

```bash
# THE primary gate. Run after all 4 tasks. Expect EXACTLY these 2 lines and NOTHING else:
npm run typecheck   # = tsc --noEmit

# EXPECTED OUTPUT (verbatim):
#   src/snapshot/cas.ts(224,14): error TS2420: Class 'CasBackend' incorrectly implements interface 'SnapshotStore'.
#                                    Property 'changedPaths' is missing in type 'CasBackend' but required in type 'SnapshotStore'.
#   src/snapshot/git.ts(201,14): error TS2420: Class 'GitBackend' incorrectly implements interface 'SnapshotStore'.
#                                    Property 'changedPaths' is missing in type 'GitBackend' but required in type 'SnapshotStore'.
#
# That is ALL. Exactly 2 errors. If you see ANY TS2352 ("neither type sufficiently overlaps") error
#   → you missed a cast conversion (re-check capture.ts:247,367,376 + revert-explicit.test.ts:502).
# If you see MORE THAN these 2 TS2420 errors → you have a bug in store.ts (check the signature is
#   exactly `changedPaths(beforeRef: string): Promise<string[]>;` and the NoOpStore stub matches).
# If you see FEWER than 2 (e.g. 0) → you (or a prior task) accidentally implemented changedPaths in
#   git.ts/cas.ts; revert that — it is S2/S3's job.
# Exit code will be non-zero (2 errors) — that is EXPECTED and correct for this contract-first item.
```

### Level 2: Unit / Type-Shape Tests (Component Validation)

```bash
# Targeted store test — must be green incl. the new changedPaths type-shape test:
npx vitest run test/store.test.ts

# Full suite — NoOpStore stub (a true no-op) + the type-only cast change must break nothing:
npm test   # = vitest run  →  1331+ tests, 31 files, all green

# Capture tests (the cast sites are exercised here) — must stay green:
npx vitest run test/capture.test.ts

# Expected: all green. If capture.test.ts fails, the cast conversion altered runtime behavior — it
# must NOT (double-cast is type-only). Re-check you changed ONLY the cast expression, not the call.
```

### Level 3: Integration Test (Cast-Site Exercise)

```bash
# The reverted cast site's integration test — exercises (store as CasBackend).restore() in non-git
# explicit-paths mode. Must stay green (cast change is type-only):
npx vitest run test/integration/revert-explicit.test.ts

# Expected: green. This confirms the double-cast is runtime-equivalent to the single-cast.
```

### Level 4: Cross-Task Handoff Verification

```bash
# Confirm you did NOT touch the files that belong to S2/S3/T2.S1:
git diff --name-only
# EXPECTED (exactly these 4, nothing else):
#   src/snapshot/store.ts
#   src/capture.ts
#   test/integration/revert-explicit.test.ts
#   test/store.test.ts
# If git.ts, cas.ts, or rewind.ts appear → STOP; you are out of scope. Revert those files.

# Confirm the 2 remaining typecheck errors are EXACTLY the S2/S3 handoff (re-run Level 1).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` = EXACTLY 2 errors (git.ts:201 + cas.ts:224 TS2420). Verified reachable.
- [ ] `npm test` green (1331+ tests); `npx vitest run test/store.test.ts` green.
- [ ] `npx vitest run test/capture.test.ts` green (cast sites exercised, no runtime change).
- [ ] `npx vitest run test/integration/revert-explicit.test.ts` green.
- [ ] `git diff --name-only` shows ONLY: store.ts, capture.ts, revert-explicit.test.ts, store.test.ts.

### Feature Validation

- [ ] `changedPaths` declared on `SnapshotStore` interface with full 5-point JSDoc + footer.
- [ ] NoOpStore stub is `async changedPaths(_beforeRef): Promise<string[]> { return []; }`.
- [ ] 4 `as CasBackend` casts converted to `as unknown as CasBackend` (capture.ts ×3, test ×1).
- [ ] The new `changedPaths` `expectTypeOf` test passes (param `[string]`, return `Promise<string[]>`).
- [ ] git.ts / cas.ts / rewind.ts UNTOUCHED (S2/S3/T2.S1 scope).

### Code Quality Validation

- [ ] Interface method placement (after dirtyCheck, before restore) and JSDoc density match `dirtyCheck`.
- [ ] NoOpStore stub mirrors the `dirtyCheck` stub exactly (underscore param, `return [];`, comment).
- [ ] Cast conversions follow the established `as unknown as T` idiom (20+ precedents in the codebase).
- [ ] No new exported types (per work-item contract).

### Documentation

- [ ] changedPaths interface JSDoc quotes spec/14 §6 step 2 verbatim + references BUG-004 + E30.
- [ ] (Optional) NoOpStore class JSDoc "6 methods" count updated to 7.
- [ ] (Optional) capture.ts JSDoc comment refs (lines 294, 328) updated to `as unknown as CasBackend`.

---

## Anti-Patterns to Avoid

- ❌ **Do NOT implement `changedPaths` on `GitBackend` or `CasBackend`** in this item — that is S2/S3's
  job. Doing so erases the EXPECTED TS2420 errors and violates dependency ordering. The 2 errors are
  the S2/S3 handoff signal; they are correct.
- ❌ **Do NOT wire `changedPaths` into `rewind.ts`** (replace `ledger.modifiedFiles`) — that is
  P1.M4.T2.S1's job. This item ships the contract + stub only; no production caller yet.
- ❌ **Do NOT leave the 4 `as CasBackend` casts as single-casts.** The original gate was unreachable
  precisely because they cascade into TS2352. The double-cast `as unknown as CasBackend` is the fix
  (an established codebase idiom). Without it, BOTH this item's gate AND the sibling S2 item's gate
  ("exactly 1 error, no others") are unreachable until S3.
- ❌ **Do NOT use `// @ts-expect-error` / `// @ts-ignore` on the cast sites or the git.ts/cas.ts
  errors.** The double-cast is the clean, documented solution; suppression directives are fragile and
  hide real errors. The 2 TS2420 errors are intentional and must remain visible (not suppressed).
- ❌ **Do NOT change runtime behavior with the cast conversion.** `as unknown as T` is type-only;
  `rt.store` still holds the same CasBackend instance at runtime. If any test's runtime behavior
  changes, you altered more than the cast expression — re-check.
- ❌ **Do NOT edit git.ts, cas.ts, or rewind.ts.** Verify with `git diff --name-only`.