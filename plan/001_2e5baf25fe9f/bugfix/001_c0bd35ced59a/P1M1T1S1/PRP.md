# PRP — P1.M1.T1.S1: Fix resolveCheckpoint walk direction + update tests (BUG-003)

**Work item:** P1.M1.T1.S1 · **Points:** 2 · **Bugfix:** BUG-003 (checkpoint rewind hides nothing)
**Scope:** Correct `resolveCheckpoint` so its entry→message walk goes ROOT→LEAF (matching real `getBranch()`
order), fix the most-recent-label search direction, reorder the 13 unit-test fixtures to root→leaf, and correct
the in-code JSDoc/comments. **No behavioral change to other resolvers; no spec-doc changes.**

---

## Goal

**Feature Goal**: Make `resolveCheckpoint` (`src/transforms.ts`) correctly map a checkpoint label's `targetId`
to a message index when fed the order production actually supplies — `ctx.sessionManager.getBranch()`, which is
**ROOT→LEAF**. Today the function (and its unit tests) wrongly assume branchEntries is leaf→root and internally
`.reverse()` it, which double-reverses the real root→leaf input and makes the walk go backwards — the direct
cause of BUG-003 (checkpoint rewinds always compute an empty/garbage removal set).

**Deliverable**:
1. `src/transforms.ts` — `resolveCheckpoint`: remove the internal `.reverse()` (step 3); change the label
   search (step 2) to scan branchEntries in REVERSE so the most-recent label still wins; rewrite the function's
   JSDoc (`@param branchEntries`, step-2 & step-3 descriptions) to state ROOT→LEAF.
2. `src/transforms.ts:966` — fix the `filterPipeline` `@param branchEntries` doc (same stale "leaf→root" claim).
3. `src/tools/rewind.ts:266` — fix `GOTCHA #8` comment (same stale claim).
4. `test/transforms.test.ts` — reorder all 13 `resolveCheckpoint` fixtures to root→leaf; fix the wrong comment.
5. `test/tools/rewind.test.ts:100` — fix the stale makeCtx doc comment (ride-along consistency).

**Success Definition**: `npx vitest run test/transforms.test.ts -t "resolveCheckpoint"` still reports
**13 passed** (the asserted `remove` arrays are unchanged — they were correct by coincidence before; now correct
by construction against real `getBranch()` order). Full suite `npm test` stays green. The function's JSDoc and
all in-code comments consistently say ROOT→LEAF.

---

## User Persona

**Target User**: The implementing AI agent (this and downstream P1.M1.T2/T3, P1.M3, P1.M4 subtasks).

**Use Case**: Once the walk direction is correct, the LATER bugfix subtasks (P1.M1.T2 stable-checkpoint-entry
labeling; P1.M1.T3 orphan-snap) build on a resolver whose mapping is trustworthy. Without this fix, those
subtasks cannot prove checkpoint hiding because the base mapping is inverted.

**Pain Points Addressed**: Today checkpoint rewinds are silently non-functional in production (always
`remove: []`) while 13 unit tests pass — because the tests feed the wrong order that the buggy code happens to
invert correctly. This PRP makes tests reflect reality so a green suite means a working feature.

---

## Why

- **Root-cause fix for BUG-003's mapping half.** `getBranch()` walks leaf→root then `.reverse()` → returns
  root→leaf (verified: `architecture/pi_session_model.md` Q2, session-manager.js:943-952). `resolveCheckpoint`
  assumes leaf→root and reverses again → walks backwards → `iTarget` lands at the wrong index → removal set is
  empty/garbage. This subtask removes that double-reverse.
- **Tests must mirror production.** The unit tests pass today ONLY because they feed leaf→root (the order the
  buggy code expects). Production feeds root→leaf. Fixing the code without fixing the fixtures would make the
  tests pass for a *different* wrong reason and still not catch the production break. Both must move together.
- **Foundation for downstream fixes.** P1.M1.T2 (stable-entry labeling) and P1.M1.T3 (orphan-snap) both depend
  on a correct entry→message walk; doing them before the walk is fixed would compound errors.

---

## What

A surgical, mechanical change to one pure function and its test fixtures:

1. **Code (`src/transforms.ts:resolveCheckpoint`)**: drop the `[...branchEntries].reverse()` so `ctxEntries` is
   built straight from branchEntries (already root→leaf). Change the step-2 label search from a forward scan to
   a reverse scan (high index → low) so it still returns the **most-recent** (leaf-most) matching label.
2. **Fixtures (`test/transforms.test.ts`)**: reverse the order of entries in every `branchEntries`/`branch`
   array literal in the `resolveCheckpoint` describe block so root is first, leaf is last. Keep every
   `expect(...).toEqual(...)` assertion byte-for-byte unchanged.
3. **Comments/JSDoc**: make all five "leaf→root" statements say root→leaf.

This subtask does **NOT** touch: `setCheckpoint`/`markers.ts` (P1.M1.T2), the orphan-snap logic (P1.M1.T3),
`spec/06` (P1.M4.T1), the smoke harness (P1.M3.T2), or any resolver other than `resolveCheckpoint`.

### Success Criteria

- [ ] `resolveCheckpoint` no longer calls `.reverse()` on branchEntries; `ctxEntries` is built from branchEntries
      directly (root→leaf preserved).
- [ ] Step-2 label search scans branchEntries high-index→low-index (most-recent label wins under root→leaf order).
- [ ] All 5 stale "leaf→root" comments/JSDoc now say root→leaf (transforms.ts @param 445, step docs 413-416 &
      466 & 477, filterPipeline @param 966, rewind.ts:266, rewind.test.ts:100).
- [ ] The 13 `resolveCheckpoint` fixtures list entries root→leaf (root first, leaf last); assertions unchanged.
- [ ] `npx vitest run test/transforms.test.ts -t "resolveCheckpoint"` → 13 passed.
- [ ] `npm test` → full suite green (no regressions in filter/rewind/edge-cases tests).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** Every edit site is pinned by file:line with exact old→new text below; the ordering
> proof is cited; the blast radius is enumerated; the validation commands are proven to work in this repo.

### Documentation & References

```yaml
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/research_findings.md
  why: "§CRITICAL FINDING — the verified discrepancy: getBranch() returns ROOT→LEAF but resolveCheckpoint's
        docstring + tests assume LEAF→ROOT; the internal .reverse() double-reverses production input."
  critical: "Names Option (a) — remove the .reverse() — as the chosen fix. Also flags the label-search loop
             finds OLDEST not most-recent under root→leaf, which MUST be reversed."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/pi_session_model.md
  why: "Q2 (lines 50-72) is the AUTHORITATIVE proof: getBranch() collects leaf→root then .reverse() → returns
        root→leaf. Lines 264-272 explicitly call out this latent ordering bug."
  pattern: "Cite this when justifying the root→leaf contract in the rewritten JSDoc."

- file: src/transforms.ts
  why: "resolveCheckpoint lives at line 450 (JSDoc 386-449; body 450-512). filterPipeline @param at 966."
  gotcha: "Step 3 builds ctxEntries via [...branchEntries].reverse().filter(...) — the .reverse() is the bug.
           Step 2's for...of scans forward — must become a reverse-index loop after the fixture reorder."

- file: test/transforms.test.ts
  why: "resolveCheckpoint describe block lines 747-882 (13 tests). Fixtures are leaf→root; the comment at
        752-753 wrongly claims 'getBranch() is LEAF→ROOT'."
  pattern: "Reorder each branchEntries/branch array to root-first/leaf-last; do NOT touch any expect()."

- file: src/tools/rewind.ts
  why: "Line 266 GOTCHA #8 repeats the wrong 'leaf→root' claim. Line 288-289 is a caller that feeds getBranch()
        verbatim (root→leaf) — confirms the caller side needs NO change."

- file: src/filter.ts
  why: "Line 184 — the production contextHandler call: `const branchEntries = ctx.sessionManager.getBranch()`
        passed straight to filterPipeline→resolveCheckpoint. ROOT→LEAF. No change needed here (context only)."
```

### Current Codebase tree (relevant slice)

```bash
pi-mulligan/
├── src/
│   ├── transforms.ts        # resolveCheckpoint @450 (JSDoc 386-449); filterPipeline @971 (@param 966)
│   ├── filter.ts            # line 184: getBranch() → filterPipeline (caller, no change)
│   └── tools/
│       ├── rewind.ts        # line 266 GOTCHA #8 (comment fix); line 288-289 caller (no change)
│       └── audit.ts         # line 502 getBranch() caller (no change)
└── test/
    ├── transforms.test.ts   # resolveCheckpoint block 747-882 (13 fixtures to reorder)
    ├── tools/rewind.test.ts # line 100 makeCtx doc (comment fix only; branch: never populated)
    └── edge-cases.test.ts   # line 619 checkpoint no-op uses [] → unaffected
```

### Desired Codebase tree

```bash
# No files added/removed. Five EXISTING files edited in place:
#   src/transforms.ts        — resolveCheckpoint code+JSDoc, filterPipeline @param
#   src/tools/rewind.ts      — GOTCHA #8 comment
#   test/transforms.test.ts  — 13 fixtures reordered + 1 comment
#   test/tools/rewind.test.ts — 1 makeCtx doc comment
# (test/edge-cases.test.ts is NOT edited — its checkpoint test is order-independent.)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA A (THE bug): resolveCheckpoint double-reverses getBranch().
// getBranch() returns ROOT→LEAF (session-manager.js collects leaf→root then .reverse()).
// resolveCheckpoint ASSUMES leaf→root and does [...branchEntries].reverse() → production input
// (root→leaf) is flipped to leaf→root → the entry→message walk goes BACKWARDS → iTarget wrong.
// FIX: drop the .reverse(); branchEntries is already root→leaf.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA B: the label search must STILL return the most-recent (leaf-most) match.
// Today `for (const e of branchEntries)` scans forward and, with leaf→root fixtures, that yields the
// leaf-most (most-recent) label first — correct by accident. After reordering fixtures to root→leaf, a
// forward scan would return the OLDEST label. FIX: scan high-index→low-index. (No current test has >1
// matching label, so this is forward-compat for P1.M3.T1 multi-rewind tests; no assertion flips today.)
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA C: do NOT "fix" the test ASSERTIONS — only the fixture ORDER.
// Buggy-code(leaf→root fixture) and fixed-code(root→leaf fixture) produce the IDENTICAL walk, so every
// expected `remove` array is already correct. Changing an assertion would be wrong and would mask regressions.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA D: rewind.test.ts / edge-cases.test.ts checkpoint tests are ORDER-INDEPENDENT — leave them.
// Their `branch:` is never populated (K=0 no-ops, throwing getBranch, or empty-branch absent-label).
// Only their stale *comments* (rewind.test.ts:100) repeat the leaf→root myth — fix the comment, not logic.
// ────────────────────────────────────────────────────────────────────────────
// GOTCHA E: the `[...branchEntries]` spread was only there because .reverse() mutates in place.
// Once .reverse() is gone, `branchEntries.filter(...)` already returns a fresh array and does NOT mutate the
// input — the spread is no longer needed. Either `branchEntries.filter(...)` or `[...branchEntries].filter(...)`
// is acceptable; prefer the former for clarity. NEVER add .reverse() back.
// ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

> N/A — no type changes. `BranchEntry` (transforms.ts:396) and the function signature are unchanged. This is a
> logic + fixture + comment fix only.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/transforms.ts — resolveCheckpoint step 2 (label search → reverse scan)
  - FILE: src/transforms.ts
  - CURRENT (≈line 462-475):
        // 2) Find the FIRST (most-recent, leaf→root) LabelEntry with the matching label.
        let targetId: string | undefined;
        for (const e of branchEntries) {
          if (!isRecord(e)) continue;
          if (readOwn(e, "type") !== "label") continue;
          if (readOwn(e, "label") !== needle) continue;
          const tid = readOwn(e, "targetId");
          if (typeof tid === "string" && tid.length > 0) {
            targetId = tid;
            break; // most-recent match wins
          }
        }
  - REPLACE WITH:
        // 2) Find the FIRST (most-recent) LabelEntry with the matching label. branchEntries is ROOT→LEAF
        //    (getBranch() order), so scan from the END (leaf→root) so the most-recent (leaf-most) match wins.
        let targetId: string | undefined;
        for (let i = branchEntries.length - 1; i >= 0; i--) {
          const e = branchEntries[i];
          if (!isRecord(e)) continue;
          if (readOwn(e, "type") !== "label") continue;
          if (readOwn(e, "label") !== needle) continue;
          const tid = readOwn(e, "targetId");
          if (typeof tid === "string" && tid.length > 0) {
            targetId = tid;
            break; // most-recent (leaf-most) match wins
          }
        }
  - WHY: see GOTCHA B. Behavioral no-op for current tests (one label each); corrects multi-label semantics.

Task 2: EDIT src/transforms.ts — resolveCheckpoint step 3 (drop the .reverse())
  - FILE: src/transforms.ts
  - CURRENT (≈line 476-479):
        // 3) ctxEntries = reversed (root→leaf) filtered to context-producing types (spec/06 §6 step 2).
        const ctxEntries = [...branchEntries].reverse().filter((e) =>
          isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined),
        );
  - REPLACE WITH:
        // 3) ctxEntries = branchEntries (already ROOT→LEAF — getBranch() order; no internal reverse) filtered
        //    to context-producing types (spec/06 §6 step 2).
        const ctxEntries = branchEntries.filter((e) =>
          isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined),
        );
  - WHY: THE core fix (GOTCHA A/E). branchEntries is root→leaf in production; the old .reverse() double-reversed it.

Task 3: EDIT src/transforms.ts — resolveCheckpoint JSDoc (step-2/3 description + @param)
  - FILE: src/transforms.ts
  - EDIT 3a — step 2 docstring (≈line 412-414). CURRENT:
        *   2. Find the FIRST LabelEntry (scanning branchEntries leaf→root = most-recent) whose
        *      label === `mulligan:checkpoint:${checkpointName}`. None → null (spec/08 E10 not-found → refuse). targetId =
        *      its targetId; non-string/empty → null.
    REPLACE "scanning branchEntries leaf→root = most-recent" with
        "scanning branchEntries in REVERSE (leaf→root, since branchEntries is root→leaf) = most-recent".
  - EDIT 3b — step 3 docstring (≈line 416-417). CURRENT:
        *   3. ctxEntries = [...branchEntries].reverse() (root→leaf) filtered to context-producing types
        *      (message, custom_message, branch_summary, compaction — spec/06 §6 step 2).
    REPLACE "[...branchEntries].reverse() (root→leaf)" with
        "branchEntries directly (already root→leaf — getBranch() order; no internal reverse)".
  - EDIT 3c — @param (≈line 445). CURRENT:
        * @param branchEntries getBranch() output, LEAF→ROOT (we reverse to root→leaf internally); non-array → null
    REPLACE WITH:
        * @param branchEntries getBranch() output, ROOT→LEAF (getBranch() order; no internal reverse needed); non-array → null
  - MODE A doc update — rides WITH the work (per contract DOCS clause).

Task 4: EDIT src/transforms.ts — filterPipeline @param branchEntries doc (≈line 966)
  - CURRENT: `* @param branchEntries getBranch() output for checkpoint rewinds (leaf→root); optional — absent → checkpoint no-ops`
  - REPLACE WITH: `* @param branchEntries getBranch() output for checkpoint rewinds (root→leaf — getBranch() order); optional — absent → checkpoint no-ops`
  - WHY: same stale claim, same file, describes the same param — consistency ride-along.

Task 5: EDIT src/tools/rewind.ts — GOTCHA #8 comment (≈line 266)
  - CURRENT: ` * GOTCHA #8: resolveCheckpoint takes branchEntries DATA (getBranch(), leaf→root), NOT ctx.`
  - REPLACE WITH: ` * GOTCHA #8: resolveCheckpoint takes branchEntries DATA (getBranch(), root→leaf), NOT ctx.`
  - WHY: same stale claim at the primary non-pipeline caller — consistency ride-along.

Task 6: EDIT test/transforms.test.ts — reorder ALL 13 fixtures to root→leaf + fix the block comment
  - FILE: test/transforms.test.ts (describe block lines 747-882)
  - RULE (apply to every `branchEntries:`/`branch:` array in the block): reverse the element order so the
    ROOT entry (the one with no later parentId dependency / the chronologically first message) is FIRST and
    the LEAF entry is LAST. Keep labelEntry() calls in place (their array position is irrelevant to the walk
    since type "label" is filtered out, BUT keep them physically near their targetId entry for readability).
  - DO NOT change any expect(...)/toEqual(...) — see GOTCHA C.
  - EXAMPLE — the first test (≈line 751-766). CURRENT:
        // branchEntries LEAF→ROOT (getBranch order):
        const branchEntries: BranchEntry[] = [
          entry("e4", "message"), entry("e3", "message"), labelEntry("eL", "e2", "ckpt"),
          entry("e2", "message"), entry("e1", "message"),
        ];
    REPLACE WITH:
        // branchEntries ROOT→LEAF (getBranch() order):
        const branchEntries: BranchEntry[] = [
          entry("e1", "message"), entry("e2", "message"), labelEntry("eL", "e2", "ckpt"),
          entry("e3", "message"), entry("e4", "message"),
        ];
        // (assertions below UNCHANGED — see PRP GOTCHA C)
  - Apply the SAME root↔leaf reversal to the remaining fixtures (≈lines 768, 782, 795, 806, 815, 829, 833,
    842, 864, 881). For single-element or empty-branch fixtures (829 "not found", 833 "non-context-producing",
    881 typecheck) the order is trivially already root→leaf or has one entry — verify and leave as-is if already
    root-first; only reverse multi-entry arrays that are currently leaf-first.
  - FIX the block comment at ≈line 752-753. CURRENT:
        // NOTE: getBranch() is LEAF→ROOT; we build branchEntries in that order. Each context-producing entry yields
        // exactly 1 message, so messages[k] corresponds 1:1 to the k-th context-producing entry (root→leaf).
    REPLACE WITH:
        // NOTE: getBranch() returns ROOT→LEAF (it collects leaf→root then .reverse() — see
        // architecture/pi_session_model.md Q2). We build branchEntries in that root→leaf order. Each
        // context-producing entry yields exactly 1 message, so messages[k] ↔ k-th context-producing entry.

Task 7: EDIT test/tools/rewind.test.ts — makeCtx doc comment (≈line 100)
  - CURRENT: `*   - branch (getBranch — SessionEntry[] leaf→root for checkpoint resolution)`
  - REPLACE WITH: `*   - branch (getBranch — SessionEntry[] root→leaf for checkpoint resolution)`
  - WHY: same stale claim in a test helper doc — consistency ride-along. (No `branch:` fixture is populated in
    this file, so no logic/fixture change — GOTCHA D.)

Task 8: VALIDATE — run the gates in the Validation Loop. No further edits.
```

### Implementation Patterns & Key Details

```ts
// The fix is two lines of logic + mechanical fixture reorder. The invariant to HOLD:
//   ctxEntries must be ROOT→LEAF and in the SAME order as the messages they yield (1:1 for
//   message/custom_message/branch_summary; compaction → refuse via entryMessageYield == -1).
// Before: [...branchEntries].reverse() turned production root→leaf INTO leaf→root (the bug).
// After:  branchEntries is consumed as-is (root→leaf). The walk's msgCursor now advances
//   e1→e2→e3→e4 matching messages[0]→[1]→[2]→[3]. iTarget = the target entry's LAST message index.

// Most-recent label selection — under root→leaf input, "most-recent" = highest array index:
for (let i = branchEntries.length - 1; i >= 0; i--) { /* ...break on first match... */ }
```

### Integration Points

```yaml
NO INTEGRATION CHANGES:
  - resolveCheckpoint signature: UNCHANGED (messages, branchEntries, checkpointName, excludeToolCallId?).
  - BranchEntry type: UNCHANGED.
  - filterPipeline 4th param: UNCHANGED (still optional BranchEntry[]).
  - All callers (filter.ts:184, rewind.ts:288, audit.ts:502, transforms.ts:1010): UNCHANGED — they already
    feed getBranch() verbatim, which is exactly the root→leaf this fix now expects.
  - markers.ts setCheckpoint: UNCHANGED here (that's P1.M1.T2 — labels a stable entry next).
DOWNSTREAM DEPENDENCIES ENABLED:
  - P1.M1.T2.S1 (setCheckpoint stable entry) can now trust the entry→message mapping.
  - P1.M1.T3.S1 (orphan-snap) snaps a correctly-computed iTarget.
  - P1.M3.T1.S1 (multi-rewind composition) depends on the most-recent-label fix (Task 1).
```

---

## Validation Loop

### Level 1: Syntax & Style (after each edit)

```bash
# Type-check the two touched source files + the test file (tsc is the project's only static gate; no ruff/eslint).
npx tsc --noEmit -p tsconfig.json
# Expected: zero errors. (No types change; if tsc errors, you altered a signature — revert and re-apply textually.)
```

### Level 2: Unit Tests (the core proof)

```bash
# BEFORE-fix baseline (proves the 13 tests pass for the WRONG reason today):
npx vitest run test/transforms.test.ts -t "resolveCheckpoint"
# Expected now: 13 passed | 119 skipped.  (Record this as your baseline.)

# >>> apply Tasks 1-7 <<<

# AFTER-fix — the SAME 13 must pass, now for the RIGHT reason (root→leaf fixtures + no-reverse):
npx vitest run test/transforms.test.ts -t "resolveCheckpoint"
# Expected: 13 passed | 119 skipped. If any expected `remove` array changed, you edited an ASSERTION by
# mistake — see GOTCHA C; revert the assertion, keep only the fixture reorder.
```

```bash
# Full suite — confirm no regressions in filter/rewind/edge-cases (their checkpoint tests are order-independent):
npm test
# Expected: all green. If rewind.test.ts or edge-cases.test.ts checkpoint tests fail, you accidentally changed
# logic/fixtures there — those files get ONLY a comment fix (Tasks 5 & 7), nothing else.
```

### Level 3: Integration Testing

> N/A for this unit-level fix. The smoke harness (F-checkpoint) is enhanced in P1.M3.T2.S1, not here. Do NOT
> run the smoke harness as an S1 gate — its current assertions check marker persistence, not hiding (a known
> gap fixed by a later subtask).

### Level 4: Targeted correctness probe (optional but recommended)

```bash
# Sanity: prove the walk now goes root→leaf by checking a mid-branch checkpoint hides strictly-later work.
# This is exactly the first test (basic mapping) — if it prints [2,3] the walk direction is correct:
npx vitest run test/transforms.test.ts -t "basic mapping" 2>&1 | grep -E "passed|failed"
# Expected: 1 passed.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` → zero errors.
- [ ] `npx vitest run test/transforms.test.ts -t "resolveCheckpoint"` → **13 passed** (same count as baseline).
- [ ] `npm test` → full suite green.
- [ ] `grep -rn "leaf→root\|LEAF→ROOT\|leaf-root\|leaf to root" src/ test/` returns NO remaining stale claims
      tied to branchEntries/getBranch (the only valid remaining "leaf→root" mentions would be in
      architecture/ research docs describing getBranch()'s *internal* collection before its .reverse() — those
      are correct and must stay).

### Feature Validation
- [ ] `resolveCheckpoint` body contains NO `.reverse()` call on branchEntries.
- [ ] Step-2 label search uses a reverse-index loop (`for (let i = branchEntries.length - 1; i >= 0; i--)`).
- [ ] Every `branchEntries`/`branch` fixture in the resolveCheckpoint describe block lists the root entry first.
- [ ] No `expect(...).toEqual(...)` assertion in that block was altered (only array element order changed).

### Code Quality Validation
- [ ] All 5 stale comments/JSDoc now say root→leaf (transforms.ts @param 445; step docs 413-416/466/477;
      filterPipeline @param 966; rewind.ts:266; rewind.test.ts:100).
- [ ] The `[...branchEntries]` spread was dropped (now just `branchEntries.filter(...)`) — no leftover dead spread.
- [ ] No changes outside the named edit sites (markers.ts, spec/, smoke harness, other resolvers untouched).

### Documentation & Deployment
- [ ] resolveCheckpoint JSDoc `@param branchEntries` and step-2/3 descriptions state ROOT→LEAF (Mode A, rides with work).
- [ ] No new env vars, no config changes.

---

## Anti-Patterns to Avoid

- ❌ Don't change any test **assertion** — only fixture **order**. The buggy code + leaf→root fixture and the
  fixed code + root→leaf fixture yield the identical walk; assertions are already correct (GOTCHA C).
- ❌ Don't "also fix" `setCheckpoint` (markers.ts) or add orphan-snap here — those are P1.M1.T2/T3. Mixing them
  in risks an unreviewable changeset and defeats the per-subtask validation gates.
- ❌ Don't edit `test/edge-cases.test.ts` logic — its checkpoint test passes `[]` and is order-independent (GOTCHA D).
- ❌ Don't reintroduce `.reverse()` "for safety" — it IS the bug. branchEntries is root→leaf in every caller.
- ❌ Don't add a forward `for...of` scan for labels "because there's only one label in tests" — use the
  reverse-index loop so multi-checkpoint (P1.M3.T1) works without another fix (GOTCHA B).
- ❌ Don't modify `PRD.md`, `tasks.json`, `prd_snapshot.md`, `.gitignore`, or any `spec/` file (PRP rules +
  P1.M4.T1 owns spec/06). This subtask edits only the 4 named src/test files.
- ❌ Don't broaden the `.reverse()` removal to other resolvers — `resolveLastToolCallGroup`/`resolveLastTurn`
  operate on `messages` directly, not branchEntries; they are unaffected and must not be touched.

---

## Confidence Score: 9/10

The fix is mechanical and fully pinned: two logic edits (drop `.reverse()`, reverse the label-scan loop),
verbatim JSDoc rewrites, and a root↔leaf reorder of 13 fixtures whose assertions provably stay valid. The blast
radius is exhaustively verified — no walk-direction-dependent fixture exists outside `transforms.test.ts`, and
all production callers already feed the root→leaf order this fix expects. The −1 reserves for the small chance a
fixture's label-entry physical position (irrelevant to logic but touched during reorder) is mis-edited; the
Level-2 gate catches that immediately with a clear diff.