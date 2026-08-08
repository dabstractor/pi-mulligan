# PRP — P1.M2.T4.S1: `filterPipeline` `hideEntryIds` dispatch + permanent-hiding regression tests (the CONSUMER half of permanent hiding)

**Work item:** P1.M2.T4.S1 · **Points:** 2 · **Bugfix:** fix_design.md §Change 4 (filterPipeline dispatches on `hideEntryIds` first)
**Scope:** **EDIT `src/transforms.ts`** (insert the `hideEntryIds` dispatch as the FIRST branch of the `filterPipeline`
rewind if/else — the existing relative resolution becomes the legacy ELSE fallback; add a Mode-A JSDoc bullet) +
**APPEND a permanent-hiding regression describe block** to `test/transforms.test.ts`. **No other file touched. No new
files. No new imports (transforms.ts must stay Pi-FREE — `grep -c '^import' === 0`).** This is the **CONSUMER**: it
reads `hideEntryIds` off each persisted marker via `readOwn(rw, "hideEntryIds")` and, when non-empty, calls the LANDED
`resolvePinnedHide` (transforms.ts:625) to map the pinned stable entry IDs → current message indices → `applyRewind`
hides them — **permanent soft-delete across session growth** (fixes BUG-001 leak-back + BUG-002 infinite loop).

> **Dependency state (VERIFIED LIVE):** all three upstream pieces have landed on disk.
> - `hideEntryIds?: string[]` is on `RewindMarker`/`RewindMarkerInput` (**markers.ts:74** — P1.M2.T1.S1 Complete) and on
>   `RewindMarkerLike` (**transforms.ts:935** — P1.M2.T1.S1).
> - `resolvePinnedHide` exists (**transforms.ts:625** — P1.M2.T2.S1 landed; exported, imported into tests, fully tested).
> - The producer `captureHideEntryIds` (P1.M2.T3.S1) is **in-flight in parallel** — treated as a CONTRACT: every NEW
>   rewind marker will carry `hideEntryIds` (possibly `[]` for K=0 / capture failure). My `length > 0` gate handles `[]`
>   and absent identically (legacy fallback), so the dispatch is correct regardless of when T3 lands.
> - Baseline: `tsc` exit 0; `vitest` 18 files / **690 tests green**.
> **OUT OF SCOPE:** `resolvePinnedHide` (landed), the producer (T3), the marker field (T1 landed),
> `resolveCheckpoint`/`setCheckpoint` (P1.M1 Complete), spec/06 idempotency docs (P1.M4), smoke tests (P1.M3.T2).
> My edits are CONFINED to `src/transforms.ts` (the `filterPipeline` dispatch + its JSDoc) + `test/transforms.test.ts`.

---

## Goal

**Feature Goal**: Make `filterPipeline` **prefer pinned stable entry IDs over relative re-resolution** for every rewind
marker that carries them. When `hideEntryIds` is a non-empty array, the dispatch calls `resolvePinnedHide` (identity-
based: map the pinned entry IDs → current message indices) INSTEAD of the broken relative resolvers
(`resolveLastToolCallGroup`/`resolveLastTurn`, which re-target onto the agent's NEW work every fire — BUG-001/002 root
cause). Because the pinned IDs are stable across session growth, the hidden set is **invariant**: the originally-hidden
mistake stays hidden on every later fire, and the agent's new work (new entries, new IDs) stays visible. This is the
**consumer half** of the root-cause fix; together with the producer (T3) it delivers "permanent soft-delete"
(PRD §1, §2.5 #1).

**Deliverable** (edits to two existing files, no new files):
1. `src/transforms.ts` — `filterPipeline` rewind loop: insert `const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");`
   before the if/else, and add a FIRST branch `if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0)
   { remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[]); }`
   making the existing `granularity` branches the `else if` legacy fallback. `protectedOk` + `applyRewind` UNCHANGED.
   Plus a Mode-A JSDoc bullet on the GRANULARITY DISPATCH block documenting the dispatch-first + backward-compat.
2. `test/transforms.test.ts` — APPEND a new top-level `describe("permanent hiding across fires (BUG-001/002 regression)")
   ` block containing THE missing test pattern: fire 1 hides the BAD toolGroup; fire 2 (GROWN session + new GOOD work)
   asserts BAD is STILL hidden (permanent) AND GOOD is visible (new work not hidden) — for BOTH `last_tool_call_group`
   and `last_turn`. Plus a legacy-fallback test (old marker w/o `hideEntryIds` still uses relative resolution) and a
   compaction-refusal no-op test (pinned hide refuses → `[]` → no fallback to legacy).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (dispatch is type-sound under `strict`; `hideEntryIdsRaw as string[]`
  cast is safe behind the `Array.isArray` guard; no new import → Pi-free invariant holds).
- `npx vitest run` is **all-green** — the new regression tests AND all 690 existing tests (zero regressions; the
  dispatch is additive — a marker WITHOUT `hideEntryIds` falls through to the unchanged legacy branches).
- `grep -n "resolvePinnedHide" src/transforms.ts` → the resolver def (1) + the filterPipeline call site (≥1) + JSDoc.
- `grep -c '^import' src/transforms.ts` → **0** (still Pi-free).
- **THE regression proof:** the new "permanent hiding across fires" test asserts that after a rewind over the BAD
  toolGroup, appending GOOD work and re-firing leaves BAD hidden AND GOOD visible — for both granularities. This is the
  exact test the original suite lacked (spec_and_test_analysis §KEY QUESTION 3).

---

## User Persona

**Target User**: The resumed agent. Today (BUG-001), the moment the agent does ANY new tool work after a
`last_tool_call_group` rewind, `resolveLastToolCallGroup` re-targets onto the NEW (legitimate) work (the "most recent
non-excluded toolGroup" is a moving target) — UN-HIDING the original mistake and HIDING the new work. With
BUG-002 (`last_turn`), the agent's own "redo" lands after the last user message and is hidden every fire → infinite loop
(29+ fires stuck). The fix: the marker now carries `hideEntryIds` (T3 producer) pinned AT creation time against the
correct snapshot; `filterPipeline` (this task) resolves those stable IDs by identity every fire → the hidden set never
shifts → the agent sees its new work and never re-sees the shed mistake.

**Use Case**: Agent runs a bloated `read /etc/hostname` (entries `e_bad_a`, `e_bad_r`), calls
`mulligan_rewind(granularity:"last_tool_call_group")`. T3's `captureHideEntryIds` pins `hideEntryIds:["e_bad_a","e_bad_r"]`
into the marker. Agent then reads `/etc/os-release` (NEW entries `e_good_a`, `e_good_r` — NOT pinned). On EVERY later
fire, the dispatch (this task) reads `hideEntryIds` → `resolvePinnedHide` → removes the hostname messages (still pinned)
and KEEPS the os-release messages (new IDs). **Permanent hiding achieved; recovery enabled.**

**User Journey**:
1. Agent calls `mulligan_rewind` → T3 producer captures + persists `hideEntryIds` (stable entry IDs of the span to hide).
2. Every later `context` fire: `filter.ts` → `filterPipeline(messages, markers, config, branchEntries)` (this task).
3. For each rewind marker: dispatch reads `readOwn(rw, "hideEntryIds")`; non-empty → `resolvePinnedHide` → identity
   resolution → `applyRewind` hides exactly the pinned entries. Empty/absent → legacy relative resolution (backward
   compat).

**Pain Points Addressed**: relative specs (`granularity`) are POSITIONAL and re-resolve against the grown message list
every fire → "last" shifts as new work is appended → leak-back (BUG-001) / infinite loop (BUG-002). Pinning stable entry
IDs at creation + resolving by identity at filter time removes the moving target entirely.

---

## Why

- **This IS the consumer half of the root-cause fix.** PRD §Recommendations: *"Pin rewind targets at marker-creation
  time … instead of re-resolving a relative spec every fire."* The producer (T3) persists the pinned IDs; **without this
  dispatch, the persisted IDs are never READ** — the marker would carry the fix but `filterPipeline` would still re-resolve
  the relative spec (the bug). The dispatch closes the loop.
- **fix_design.md §Change 4 is the exact contract** for this dispatch: `hideEntryIds` checked FIRST; non-empty →
  `resolvePinnedHide`; the existing relative resolution becomes the ELSE (legacy fallback for old markers). The
  item_description restates this verbatim.
- **Backward compatible by construction.** `hideEntryIds` is OPTIONAL (P1.M2.T1.S1). Old markers lack it; `[]` markers
  (K=0 / capture failure) have length 0. Both fall through to the unchanged legacy branches — identical behavior to
  today. Only NEW markers with a real pinned span take the new path.
- **Refusal must NOT fall back to legacy** (resolver JSDoc lines 609-613, critical invariant). `resolvePinnedHide`
  returns `[]` on compaction/alignment refusal; because the `length > 0` gate already fired, the ELSE chain is NOT
  entered → the marker no-ops THIS fire (idempotent `applyRewind(m, [])`) and retries next fire. Falling back to legacy
  on refusal would RE-INTRODUCE BUG-001/002. This is enforced by the control-flow shape (not a separate check).
- **Pairing-safe + protected-safe by reuse.** `resolvePinnedHide` returns whole-unit indices (the producer pins
  whole-unit entry IDs); `protectedOk` + `applyRewind` operate on `remove` identically regardless of which resolver
  produced it. No new safety logic needed.

---

## What

EDIT `src/transforms.ts` (2 surgical edits — the dispatch insertion + the JSDoc bullet) + APPEND a regression describe
block to `test/transforms.test.ts`.

- **Dispatch insertion**: inside `filterPipeline`'s rewind `for` loop, AFTER the `excludeId` line and BEFORE
  `let remove: number[];`, add `const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");`. Change the FIRST `if` from
  `if (granularity === "last_tool_call_group")` to
  `if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) { remove = resolvePinnedHide(...); } else if (granularity === "last_tool_call_group") {…unchanged…}`.
  The `last_turn` / `checkpoint` / else branches stay byte-identical (they become later `else if`s).
- **JSDoc**: add a PINNED bullet at the TOP of the `GRANULARITY DISPATCH (…)` bullet block above `filterPipeline`,
  documenting dispatch-first + backward-compat fallback + refusal-no-fallback.
- **Tests**: a new top-level `describe("permanent hiding across fires (BUG-001/002 regression)")` at the END of
  `test/transforms.test.ts`, with fire1/fire2 assertions for `last_tool_call_group` AND `last_turn`, plus a legacy-
  fallback test and a compaction-refusal no-op test.

This subtask does **NOT**: edit `resolvePinnedHide` (landed), the rewind tool/producer (T3), the marker field (T1
landed), `resolveCheckpoint`/`setCheckpoint` (P1.M1), the typebox schema, spec docs (P1.M4), smoke tests (P1.M3.T2);
add any import to `transforms.ts` (Pi-free invariant); mutate inputs; or add a runtime dep.

### Success Criteria

- [ ] `filterPipeline` rewind loop reads `readOwn(rw, "hideEntryIds")` and, when it is a non-empty array, calls
      `resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[])` as the
      FIRST branch (the existing relative branches become `else if` legacy fallback).
- [ ] `protectedOk(m, remove, config)` + `m = applyRewind(m, remove)` are UNCHANGED and run for BOTH paths.
- [ ] The JSDoc `GRANULARITY DISPATCH` block documents the pinned dispatch-first + backward-compat + refusal-no-fallback.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (690 existing + new regression tests; zero regressions).
- [ ] `grep -c '^import' src/transforms.ts` is still **0**.
- [ ] **Regression (last_tool_call_group):** fire1 hides BAD (msgs1[1],msgs1[2]); fire2 (msgs2 = msgs1 + GOOD) asserts
      BAD STILL hidden AND GOOD (msgs2[6],msgs2[7]) visible.
- [ ] **Regression (last_turn):** the same fire1/fire2 shape with `granularity:"last_turn"` + the same pinned IDs.
- [ ] **Legacy fallback:** a marker WITHOUT `hideEntryIds` (old marker) still uses relative resolution (unchanged
      behavior — proves backward compat).
- [ ] **Compaction refusal no-op:** a pinned marker whose branch contains a `compaction` entry → `resolvePinnedHide`
      returns `[]` → nothing hidden this fire (does NOT fall back to legacy).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** Both source edits are given as exact `oldText`/`newText` (Tasks 2–3) hand-traced against the current
> `filterPipeline` text (quoted verbatim — it is the oldText source). The dispatch shape is fix_design.md §Change 4
> restated verbatim in the item_description. The test block (Task 4) is given in full, with the hand-traced
> remove-sets and the exact fixtures (`asst`/`result`/`user`/`custom`/`entry`) quoted from the live test file. The
> resolver contract (`resolvePinnedHide` signature + defensive guards + refusal-returns-`[]`-not-null) is verified on
> disk. No prior knowledge beyond "tsc + vitest are green; the 3 upstream pieces have landed" is required.

### Scope decision (READ BEFORE CODING)

- **EDIT `src/transforms.ts` ONLY** (the `filterPipeline` dispatch + its JSDoc) plus the test file. Do NOT edit
  `resolvePinnedHide` (landed), the rewind tool/producer (T3), `markers.ts` (field landed), `resolveCheckpoint`/
  `setCheckpoint` (P1.M1), or `filter.ts`.
- **Do NOT add an import to `transforms.ts`.** The Pi-free invariant (`grep -c '^import' === 0`) is load-bearing — the
  whole module-private `isRecord`/`readOwn`/`partitionIntoUnits`/`resolvePinnedHide` family lives in this one module.
  `resolvePinnedHide` is already in scope (same file). `readOwn` reads `hideEntryIds` defensively off the marker.
- **Do NOT change `protectedOk` or `applyRewind`.** They operate on `remove: number[]` identically regardless of which
  resolver produced it. The dispatch's ONLY job is to compute `remove`; the rest of the loop body is untouched.
- **Do NOT make the refusal fall back to legacy.** `resolvePinnedHide` returns `[]` on compaction/alignment refusal.
  Because `hideEntryIdsRaw.length > 0` already passed, the ELSE chain is skipped → `remove=[]` → `applyRewind(m, [])`
  is the idempotent no-op (same ref). The marker retries next fire. This is INTENTIONAL (re-introducing legacy on
  refusal re-introduces the bug). It is enforced by control flow — do NOT add an `else` that calls legacy after the
  pinned branch.
- **Do NOT change the `excludeId` computation.** It stays where it is (read before the if/else); it is consumed by the
  legacy `last_tool_call_group`/`last_turn`/`checkpoint` branches. The pinned branch does NOT use it (correct — pinned
  resolution is identity-based, not exclusion-based). Removing the `excludeId` read would break legacy.
- **Do NOT mutate the marker.** `readOwn(rw, "hideEntryIds")` is a READ; the marker object is shared by reference and
  must not be touched (existing purity test, transforms.test.ts:1357).
- **Do NOT change the test's import line.** `resolvePinnedHide`, `filterPipeline`, `RewindMarkerLike`, `MarkerBundle`,
  `ProtectedConfig`, `BranchEntry`, `MessageLike` are ALL already imported (test line 2).

### Documentation & References

```yaml
# MUST READ — authoritative sources for the dispatch + the regression test
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  section: "Change 4: filterPipeline dispatches on hideEntryIds first"
  why: "THE design doc for this exact change. Gives the dispatch pseudocode (readOwn hideEntryIds; if non-empty →
        resolvePinnedHide; else granularity legacy), the backward-compat rationale, and the test pattern (Fire1/Fire2)."
  critical: "The pseudocode's `Array.isArray(hideEntryIds) && hideEntryIds.length > 0` gate is the EXACT predicate to use.
        The existing relative branches become the ELSE (legacy fallback). protectedOk + applyRewind unchanged."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/spec_and_test_analysis.md
  section: "KEY QUESTION 3 (the test gap) + KEY QUESTION 1 (why §11 idempotency is wrong within a turn)"
  why: "Documents that the 690-test suite has NO 'rewind → more work → re-fire' test — exactly what my new describe adds.
        KEY QUESTION 1 proves the root cause (session grows between fires within a turn → relative spec re-targets)."

- file: src/transforms.ts
  section: "filterPipeline rewind loop (≈1124-1154) + resolvePinnedHide (625) + RewindMarkerLike (918-935) + GRANULARITY DISPATCH JSDoc (≈1083-1090)"
  why: "THE file you EDIT. The dispatch loop is the edit target; resolvePinnedHide is the in-scope fn you CALL (already
        exported, same file, no import); RewindMarkerLike.hideEntryIds is the field you read; the JSDoc bullet block is
        the doc target. All quoted verbatim in the Implementation Blueprint."
  pattern: "readOwn(rw, 'field') defensive read + Array.isArray guard (mirrors how excludeToolCallId/granularity/options/checkpoint are read in the SAME loop)."
  gotcha: "transforms.ts is Pi-FREE (0 imports) — do NOT add an import. resolvePinnedHide is in-scope already."

- file: src/transforms.ts
  section: "resolvePinnedHide JSDoc lines 609-613 (refusal does NOT fall back)"
  why: "The resolver RETURNS [] (not null) on compaction/alignment refusal, AND its JSDoc explicitly states the T4
        dispatch checks `Array.isArray(hideEntryIds) && hideEntryIds.length > 0` BEFORE calling it — so a refused pinned
        hide no-ops (does NOT hit legacy). CONFIRMS the control-flow shape my dispatch must take."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T2S1/PRP.md   # the resolver PRP (landed)
  why: "Defines resolvePinnedHide (the fn my dispatch calls). Its contract: pairing-safe-by-construction (producer pins
        whole-unit ids), refuses safely on compaction (returns []), reads branchEntries ROOT→LEAF (NO reverse). My
        dispatch passes branchEntries straight through (the resolver handles root→leaf internally)."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T3S1/PRP.md   # the producer PRP (in-flight parallel — CONTRACT)
  why: "Defines what the marker will carry: hideEntryIds = stable ENTRY ids of the removed messages' entries, captured
        at creation time. ALWAYS present on new markers (even [] for K=0 / capture failure). My `length > 0` gate treats
        [] and absent identically → my dispatch is correct regardless of when T3 lands."

- file: test/transforms.test.ts
  section: "fixtures (9-58: asst/asstText/result/user/custom) + entry (738) + filterPipeline describe (1171-1529) + resolvePinnedHide tests (1533-1650)"
  why: "THE test idiom to mirror. asst('BAD')→{role:assistant,content:[{type:toolCall,id:'BAD',name:'tool',arguments:{}}]};
        result('BAD')→{role:toolResult,toolCallId:'BAD',toolName:'tool',content:[...],isError:false}; user/custom as named;
        entry(id,'message')→{type:'message',id,parentId:null,timestamp:'t'}. Reference-based assertions (applyRewind
        filters by reference → survivors keep identity): expect(out).not.toContain(msgs[1]); expect(out).toContain(msgs2[6])."
  pattern: "mkRewind exists but is closure-LOCAL (inside the filterPipeline describe, lines 1171-1529). My new describe is
        top-level (outside that closure) → build markers inline (the item_description gives explicit marker shapes). Define a local cfg."
  gotcha: "resolvePinnedHide REQUIRES branchEntries (4th filterPipeline arg). Existing last_tool_call_group/last_turn
        filterPipeline tests OMIT it (legacy path doesn't need it). The pinned path DOES — omitting it → resolvePinnedHide
        gets [] → remove=[] → nothing hidden → test fails. BOTH fires MUST pass branch1/branch2. (GOTCHA #1.)"

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T4S1/research/dispatch_and_test_recon.md
  why: "First-hand recon: dependency-landed state, verbatim dispatch block, test idiom, hand-traced fire1/fire2, the
        branchEntries-must-be-passed trap, parallel-task boundary with T3 (zero file overlap)."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'. NO new dep needed.
├── tsconfig.json           # strict, noImplicitAny, moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── transforms.ts       # EDIT: filterPipeline dispatch (≈1124-1154) + GRANULARITY DISPATCH JSDoc (≈1083-1090).
│   ├── markers.ts          # READ-ONLY (hideEntryIds field at :74 — P1.M2.T1.S1 landed).
│   ├── tools/rewind.ts     # READ-ONLY (captureHideEntryIds — P1.M2.T3.S1 in-flight parallel; my CONTRACT input).
│   ├── tools/{checkpoint,shrink,audit}.ts / filter.ts / nudges.ts / config.ts / log.ts / runtime.ts / tokens.ts / ledger.ts / notes.ts / index.ts  # untouched
├── test/
│   └── transforms.test.ts  # APPEND: a permanent-hiding regression describe at the END. Existing 690 tests untouched.
└── plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md  # §Change 4 = authoritative dispatch
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / 690 tests green.
# NOTE: no eslint/prettier configured (devDeps = typescript + vitest + @types/node). The gate is `tsc --noEmit` + `vitest run`.
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts        # +hideEntryIds dispatch branch (FIRST if); existing branches → else if legacy; +JSDoc bullet. ~8 new lines.
└── test/
    └── transforms.test.ts   # +1 new top-level describe (permanent hiding across fires, last_tool_call_group + last_turn
                             #   + legacy fallback + compaction refusal). ~110 new lines.
# No new files. No new deps. No package.json change. No spec-doc change (P1.M4 owns spec/06 sync).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — The pinned path REQUIRES branchEntries (4th filterPipeline arg). resolvePinnedHide's FIRST
#   defensive guard is `!Array.isArray(branchEntries) → return []`, and the dispatch passes
#   `Array.isArray(branchEntries) ? branchEntries : []`. If a test OMITS branchEntries, the dispatch passes [] → the
#   resolver walks 0 entries → remove=[] → NOTHING hidden → test fails. The existing last_tool_call_group/last_turn
#   filterPipeline tests OMIT branchEntries (legacy path doesn't read it) — DO NOT copy that omission into the pinned
#   regression tests. BOTH fires MUST pass branch1 / branch2.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — Refusal must NOT fall back to legacy. resolvePinnedHide returns [] (NOT null) on compaction/
#   alignment refusal. Because `hideEntryIdsRaw.length > 0` already passed the gate, the ELSE chain is NOT entered →
#   remove=[] → applyRewind(m,[]) is the idempotent no-op (same ref) → the marker retries next fire. DO NOT add an
#   `else` after the pinned branch that calls legacy — that re-introduces BUG-001/002 on compaction. Control flow enforces this.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — transforms.ts is Pi-FREE (grep -c '^import' === 0). Do NOT add ANY import. resolvePinnedHide
#   is in the SAME file (in scope). readOwn/isRecord/Array.isArray are all in scope. The dispatch is a pure local edit.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — The `excludeId` read STAYS before the if/else (the legacy branches consume it). The pinned branch does
#   NOT use excludeId (identity resolution, not exclusion) — that's correct; do NOT delete the excludeId read or the
#   legacy last_tool_call_group/last_turn/checkpoint branches break.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — `hideEntryIdsRaw as string[]` cast is SAFE because it is behind `Array.isArray(hideEntryIdsRaw)`.
#   readOwn returns `unknown`; the guard narrows to "array"; the resolver re-validates element types (non-string/empty
#   ids ignored). No runtime risk. tsc strict accepts the cast post-Array.isArray.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — The existing `last_tool_call_group`/`last_turn`/`checkpoint`/`else` branches must stay BYTE-IDENTICAL
#   (they become the else-if legacy fallback). Do NOT refactor their bodies or comments. Only the FIRST `if` line +
#   the new branch + the `else if` keyword change. The 690 existing tests assert these legacy paths unchanged.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — entry(id,'message') yields EXACTLY 1 message (entryMessageYield). So branch.length MUST === messages.length
#   for the resolver's alignment check (`msgCursor + yield > messages.length → return []`) to pass. Build branchN with
#   one "message" entry per message (the existing resolvePinnedHide tests use entry('e1','message') throughout — copy it).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — applyRewind filters by REFERENCE (survivors keep object identity). So reference assertions are the idiom:
#   `expect(out).not.toContain(msgs1[1])` (BAD hidden), `expect(out).toContain(msgs2[6])` (GOOD visible). And
#   `msgs2 = [...msgs1, ...]` means msgs2[1] === msgs1[1] (same ref) — so fire2 can assert against msgs2 indices directly.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The type+style
#   gate is `tsc --noEmit` (TS strict). Do NOT invent a ruff/eslint/prettier command — it would fail "command not found".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — The new regression describe is TOP-LEVEL (after the resolvePinnedHide tests, end of file). mkRewind + cfg
#   are closure-LOCAL to the filterPipeline describe (1171-1529) — NOT accessible from top-level. So define a LOCAL cfg
#   (`{ rewind: { protectedRoles: ['first:user','latest:user'] } } as ProtectedConfig`) and build markers INLINE
#   (the item_description gives explicit shapes). This keeps the regression test self-contained + decoupled.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — The purity test (transforms.test.ts:1357) asserts filterPipeline never mutates `messages` or the markers.
#   readOwn(rw,'hideEntryIds') is a READ (no mutation) → purity holds. Do NOT write back to the marker.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — A marker with hideEntryIds:[] (K=0 / capture failure) takes the LEGACY path (length > 0 is false).
#   This is CORRECT and intended: a [] marker behaves like an old marker. The legacy resolver for that granularity runs
#   (and may no-op too). The compaction-refusal test is the DIFFERENT case: hideEntryIds is NON-EMPTY but the branch
#   contains a compaction entry → resolver returns [] → remove=[] → no-op (does NOT fall to legacy — GOTCHA #2).
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No data-model change in THIS subtask — `hideEntryIds?: string[]` is already on `RewindMarkerLike` (transforms.ts:935,
P1.M2.T1.S1). This task only changes `filterPipeline`'s CONTROL FLOW (which resolver computes `remove`) + adds tests.

```ts
// filterPipeline rewind loop — BEFORE (current, transforms.ts:1124-1154):
//   let remove: number[];
//   if (granularity === "last_tool_call_group") { ... } else if (granularity === "last_turn") { ... }
//   else if (granularity === "checkpoint") { ... } else { remove = []; }
//
// AFTER (this task — fix_design.md §Change 4):
//   const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");
//   let remove: number[];
//   if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) {
//     remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[]);
//   } else if (granularity === "last_tool_call_group") { ...UNCHANGED... }   // ← now LEGACY FALLBACK
//   else if (granularity === "last_turn") { ...UNCHANGED... }
//   else if (granularity === "checkpoint") { ...UNCHANGED... }
//   else { remove = []; }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + dependency-landed state (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json                  # expect exit 0
  - RUN: npx vitest run test/transforms.test.ts             # expect all-green (the resolver + filterPipeline suites)
  - RUN: grep -n "hideEntryIds?: string\[\]" src/transforms.ts   # expect ≥1 (RewindMarkerLike — P1.M2.T1.S1 landed)
  - RUN: grep -n "^export function resolvePinnedHide" src/transforms.ts  # expect 1 (P1.M2.T2.S1 landed)
  - RUN: grep -c "resolvePinnedHide" src/transforms.ts      # expect ≥3 (def + JSDoc refs; the CALL SITE will make it +1)
  - RUN: grep -c '^import' src/transforms.ts                # expect 0 (Pi-free — MUST stay 0)

Task 1: EDIT src/transforms.ts — add the hideEntryIds JSDoc bullet (Mode-A docs; exact oldText/newText below)
  - FIND: the `* GRANULARITY DISPATCH (spec/06 §12, with the re-partition FIX — GOTCHA #2):` line + its FIRST bullet.
  - INSERT: a PINNED bullet BEFORE the "last_tool_call_group" bullet, documenting dispatch-first + backward-compat +
    refusal-no-fallback. (No code change here — pure doc.)

Task 2: EDIT src/transforms.ts — insert the hideEntryIds dispatch branch (the core edit; exact oldText/newText below)
  - FIND: the `const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;` line, the blank line, and
    the `let remove: number[];\n    if (granularity === "last_tool_call_group") {` block.
  - INSERT: `const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");` after the blank line; change the `if` to the pinned
    branch + `else if (granularity === "last_tool_call_group")`. The existing branch body (partitionIntoUnits +
    resolveLastToolCallGroup) stays byte-identical (it is now the legacy fallback).
  - CONSTRAINTS: `Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0` gate; `hideEntryIdsRaw as string[]`
    cast (safe post-Array.isArray — GOTCHA #5); `Array.isArray(branchEntries) ? branchEntries : []` default
    (mirrors the existing checkpoint branch's idiom); NO new import (GOTCHA #3); protectedOk + applyRewind UNCHANGED.

Task 3: APPEND to test/transforms.test.ts — the permanent-hiding regression describe (exact content below)
  - APPEND a top-level `describe("permanent hiding across fires (BUG-001/002 regression)", () => { … })` at the END of
    the file (after the resolvePinnedHide types describe). Define a LOCAL cfg; build markers inline; reuse the
    module-scope asst/result/user/custom/entry fixtures.
  - TESTS: (1) last_tool_call_group fire1/fire2 (BAD hidden → BAD STILL hidden + GOOD visible); (2) last_turn fire1/fire2
    (same shape); (3) legacy fallback (marker w/o hideEntryIds uses relative resolution — backward compat); (4) compaction
    refusal no-op (pinned marker + compaction entry → nothing hidden, no legacy fallback).
  - NO change to the 690 existing tests (the dispatch is additive — markers w/o hideEntryIds take the unchanged legacy path).

Task 4: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + grep gates) and Level 2 (full vitest run). Level 3 N/A (filterPipeline is PURE — the multi-fire
    proof IS the Level-2 regression test; real Pi-runtime smoke is P1.M3.T2, out of scope).
```

#### Exact edits — `src/transforms.ts`

**Task 1 — Mode-A JSDoc: add the PINNED dispatch bullet** (`edit` tool). Target the GRANULARITY DISPATCH header + first
bullet; insert a pinned bullet before the `last_tool_call_group` bullet.

oldText:
```
 * GRANULARITY DISPATCH (spec/06 §12, with the re-partition FIX — GOTCHA #2):
 *   - "last_tool_call_group": RE-PARTITION the current array FRESH (partitionIntoUnits(m)), then
```
newText:
```
 * GRANULARITY DISPATCH (fix_design.md §Change 4 — PINNED FIRST, then granularity legacy):
 *   - PINNED (hideEntryIds present + non-empty): NEW markers carry stable ENTRY ids pinned at marker-creation time
 *     (captureHideEntryIds, P1.M2.T3) for PERMANENT soft-delete hiding (fixes BUG-001 leak-back + BUG-002 infinite
 *     loop). resolvePinnedHide(m, branchEntries, hideEntryIds) maps those stable ids → current message indices by
 *     IDENTITY (not position) → the hidden set is invariant across session growth: the originally-hidden mistake stays
 *     hidden every fire; the agent's NEW work (new entries, new ids NOT in the pinned set) stays visible. Pairing-safe
 *     by construction (producer pins whole-unit ids). On compaction/alignment REFUSAL it returns [] (NOT null) →
 *     applyRewind(m,[]) is the idempotent no-op THIS fire; the marker persists and retries next fire. A refused pinned
 *     hide MUST NOT fall back to the relative branches (that re-introduces the bug) — enforced by control flow (the
 *     length>0 gate already fired, so the else-if chain is skipped). Backward compat: old markers / K=0 / capture-
 *     failure (hideEntryIds absent or []) fall through to the granularity branches below.
 *   - "last_tool_call_group" (LEGACY FALLBACK): RE-PARTITION the current array FRESH (partitionIntoUnits(m)), then
```

**Task 2 — the dispatch insertion** (`edit` tool). oldText = the `excludeId` line + blank line + `let remove` + the
`if (granularity === "last_tool_call_group")` header + its body's first 2 lines + the `} else if (granularity ===
"last_turn")` line (enough to be unique + cover the insertion seam). newText inserts the pinned branch and converts the
`if` to `else if`. The `last_tool_call_group` branch BODY is unchanged (only its `if`→`else if` keyword + comments).

oldText:
```
    const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;

    let remove: number[];
    if (granularity === "last_tool_call_group") {
      // RE-PARTITION fresh each iteration so unit.indices index the CURRENT m (GOTCHA #2 — the §12 pseudocode's
      // partition-once is a stale-index bug after the first rewind reduces m).
      const units = partitionIntoUnits(m);
      remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
    } else if (granularity === "last_turn") {
```
newText:
```
    const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;

    // fix_design.md §Change 4: dispatch on PINNED hideEntryIds FIRST (permanent hiding across session growth — fixes
    // BUG-001/BUG-002). New markers carry hideEntryIds (captureHideEntryIds, P1.M2.T3) — the stable ENTRY ids of the
    // span to hide, captured ONCE at marker-creation time. resolvePinnedHide maps those ids → current message indices
    // by IDENTITY every fire → the hidden set never shifts as the session grows (the agent's NEW work has NEW ids NOT
    // in the pinned set → visible). On compaction/alignment refusal resolvePinnedHide returns [] (NOT null) → no-op
    // this fire; it does NOT fall back to the relative branches (that re-introduces the bug). Old markers / K=0 /
    // capture-failure (hideEntryIds absent or []) fall through to the granularity LEGACY branches below.
    const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");
    let remove: number[];
    if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) {
      // PINNED PATH: stable anchors → permanent hiding. branchEntries default [] is safe (resolver returns [] on absent).
      remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[]);
    } else if (granularity === "last_tool_call_group") {
      // LEGACY FALLBACK: relative re-resolution (old markers without hideEntryIds). "Last" = newest toolGroup = the
      // moving target that caused BUG-001 — present only for backward compat. RE-PARTITION fresh each iteration so
      // unit.indices index the CURRENT m (GOTCHA #2 — the §12 pseudocode's partition-once is a stale-index bug).
      const units = partitionIntoUnits(m);
      remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
    } else if (granularity === "last_turn") {
```

> NOTE: the `last_turn`, `checkpoint`, and `else` branches below this edit are UNTOUCHED (they remain `else if` /
> `else` as before). `protectedOk(m, remove, config)` + `m = applyRewind(m, remove)` below the if/else are UNCHANGED.

#### Exact edits — `test/transforms.test.ts` (Task 3 — APPEND)

Append the following to the END of `test/transforms.test.ts` (after the `resolvePinnedHide — types` describe). The
module-scope `asst`/`asstText`/`result`/`user`/`custom`/`entry` fixtures + the imports (`filterPipeline`,
`RewindMarkerLike`, `MarkerBundle`, `ProtectedConfig`, `BranchEntry`, `MessageLike`) are ALREADY defined above — reuse
them. Define a LOCAL `cfg` (the filterPipeline describe's `cfg` is closure-local and not accessible here — GOTCHA #10).

```ts
// ── permanent hiding across fires (fix_design.md §Change 4; THE BUG-001/002 regression — spec_and_test_analysis §KEY QUESTION 3) ──

describe("permanent hiding across fires (BUG-001/002 regression)", () => {
  // LOCAL cfg (the filterPipeline describe's cfg is closure-local). protectedRoles keeps the first:user guard satisfied
  // for these removals (all removals are after the first user → protectedOk true → rewind applied, not skipped).
  const cfg = { rewind: { protectedRoles: ["first:user", "latest:user"] } } as ProtectedConfig;

  it("last_tool_call_group — BAD hidden on fire 1, STILL hidden on fire 2 (PERMANENT), and GOOD new work is VISIBLE", () => {
    // ── Fire 1: right after the rewind. msgs1 = [user, asst('BAD'), result('BAD'), asst('RW'), result('RW'), note] ──
    const msgs1: MessageLike[] = [
      user("u"), asst("BAD"), result("BAD"), asst("RW"), result("RW"), custom("mulligan:note"),
    ];
    // branch1: one "message" entry per message (1:1 alignment; entryMessageYield('message') === 1).
    const branch1: BranchEntry[] = [
      entry("e_u", "message"), entry("e_bad_a", "message"), entry("e_bad_r", "message"),
      entry("e_rw_a", "message"), entry("e_rw_r", "message"), entry("e_note", "message"),
    ];
    // The marker the PRODUCER (P1.M2.T3) would persist: pinned entry ids of the BAD toolGroup + the rewind's own exclude.
    const marker: RewindMarkerLike = {
      seq: 1, granularity: "last_tool_call_group", excludeToolCallId: "RW", hideEntryIds: ["e_bad_a", "e_bad_r"],
    };
    const view1 = filterPipeline(msgs1, { rewinds: [marker], shrinks: [] }, cfg, branch1);
    // Fire 1: BAD toolGroup (msgs1[1] asst, msgs1[2] result) is HIDDEN. resolvePinnedHide → remove=[1,2].
    expect(view1).not.toContain(msgs1[1]); // BAD assistant hidden
    expect(view1).not.toContain(msgs1[2]); // BAD result hidden
    expect(view1).toContain(msgs1[0]);     // user kept
    expect(view1).toContain(msgs1[3]);     // rewind's own assistant kept
    expect(view1).toContain(msgs1[5]);     // note kept

    // ── Fire 2: the agent resumed work — read /etc/os-release (NEW entries, NEW ids NOT in the pinned set) ──
    // msgs2 = [...msgs1, asst('GOOD'), result('GOOD')] → msgs2[6]=GOOD asst, msgs2[7]=GOOD result. (msgs2[1..5] === msgs1.)
    const msgs2: MessageLike[] = [...msgs1, asst("GOOD"), result("GOOD")];
    const branch2: BranchEntry[] = [...branch1, entry("e_good_a", "message"), entry("e_good_r", "message")];
    // SAME marker (persisted). resolvePinnedHide still maps ['e_bad_a','e_bad_r'] → [1,2]; e_good_* NOT pinned → visible.
    const view2 = filterPipeline(msgs2, { rewinds: [marker], shrinks: [] }, cfg, branch2);
    // THE PERMANENCE ASSERTION: BAD STILL hidden (would have LEAKED BACK under the old relative resolver — BUG-001).
    expect(view2).not.toContain(msgs2[1]); // BAD assistant STILL hidden
    expect(view2).not.toContain(msgs2[2]); // BAD result STILL hidden
    // THE NEW-WORK ASSERTION: GOOD (the agent's redo) is VISIBLE (would have been HIDDEN under the old resolver — BUG-001).
    expect(view2).toContain(msgs2[6]); // GOOD assistant visible
    expect(view2).toContain(msgs2[7]); // GOOD result visible
    expect(view2).toContain(msgs2[0]); // user kept
    expect(view2).toContain(msgs2[5]); // note kept
  });

  it("last_turn — same permanence: BAD hidden on fire 1, STILL hidden on fire 2, GOOD new work VISIBLE", () => {
    // Same message shape; granularity differs but the PINNED path ignores granularity (hideEntryIds wins). The producer
    // (T3) captures the same BAD entries for last_turn (resolveLastTurn removes idx 1,2 → entry ids e_bad_a,e_bad_r).
    const msgs1: MessageLike[] = [
      user("u"), asst("BAD"), result("BAD"), asst("RW"), result("RW"), custom("mulligan:note"),
    ];
    const branch1: BranchEntry[] = [
      entry("e_u", "message"), entry("e_bad_a", "message"), entry("e_bad_r", "message"),
      entry("e_rw_a", "message"), entry("e_rw_r", "message"), entry("e_note", "message"),
    ];
    const marker: RewindMarkerLike = {
      seq: 1, granularity: "last_turn", excludeToolCallId: "RW", hideEntryIds: ["e_bad_a", "e_bad_r"],
    };
    const view1 = filterPipeline(msgs1, { rewinds: [marker], shrinks: [] }, cfg, branch1);
    expect(view1).not.toContain(msgs1[1]); // BAD hidden
    expect(view1).not.toContain(msgs1[2]);

    // Fire 2: new GOOD work appended. Under the OLD last_turn resolver, GOOD (after the last user msg) would be HIDDEN
    // every fire → infinite loop (BUG-002). The pinned path keeps GOOD visible.
    const msgs2: MessageLike[] = [...msgs1, asst("GOOD"), result("GOOD")];
    const branch2: BranchEntry[] = [...branch1, entry("e_good_a", "message"), entry("e_good_r", "message")];
    const view2 = filterPipeline(msgs2, { rewinds: [marker], shrinks: [] }, cfg, branch2);
    expect(view2).not.toContain(msgs2[1]); // BAD STILL hidden (permanent)
    expect(view2).not.toContain(msgs2[2]);
    expect(view2).toContain(msgs2[6]); // GOOD visible — the agent can SEE its own redo (no infinite loop)
    expect(view2).toContain(msgs2[7]);
  });

  it("legacy fallback — a marker WITHOUT hideEntryIds uses the relative resolver (backward compat; unchanged behavior)", () => {
    // An OLD marker (pre-fix) lacks hideEntryIds → the dispatch falls through to the granularity branch. This proves
    // backward compatibility: the dispatch is additive; old markers behave EXACTLY as before.
    const msgs: MessageLike[] = [
      user("u0"), asst("cM"), result("cM"), asst("cR1"), result("cR1"), custom("mulligan:note"),
    ];
    // last_tool_call_group, exclude cR1 → resolveLastToolCallGroup resolves the cM group (idx 1,2) → remove=[1,2].
    const legacyMarker: RewindMarkerLike = {
      seq: 1, granularity: "last_tool_call_group", excludeToolCallId: "cR1",
      // hideEntryIds intentionally ABSENT (old marker)
    };
    const out = filterPipeline(msgs, { rewinds: [legacyMarker], shrinks: [] }, cfg);
    expect(out).not.toContain(msgs[1]); // cM assistant removed by the LEGACY relative resolver
    expect(out).not.toContain(msgs[2]); // cM result removed
    expect(out).toHaveLength(4);
  });

  it("compaction refusal — pinned marker whose branch contains a compaction entry → nothing hidden (refuse; NO legacy fallback)", () => {
    // resolvePinnedHide returns [] when a compaction entry is on the walk (entryMessageYield('compaction') === -1 → refuse).
    // Because hideEntryIds.length > 0 already passed the dispatch gate, the ELSE chain is NOT entered → remove=[] → no-op.
    // This fire the marker hides nothing; it retries next fire. (Falling back to legacy here would re-introduce BUG-001.)
    const msgs: MessageLike[] = [user("u"), asst("BAD"), result("BAD"), asst("RW"), result("RW"), custom("mulligan:note")];
    const branchWithCompaction: BranchEntry[] = [
      entry("e_u", "message"), entry("e_bad_a", "message"), entry("eC", "compaction"), // compaction between pinned ids
      entry("e_bad_r", "message"), entry("e_rw_a", "message"), entry("e_rw_r", "message"), entry("e_note", "message"),
    ];
    const marker: RewindMarkerLike = {
      seq: 1, granularity: "last_tool_call_group", excludeToolCallId: "RW", hideEntryIds: ["e_bad_a", "e_bad_r"],
    };
    const out = filterPipeline(msgs, { rewinds: [marker], shrinks: [] }, cfg, branchWithCompaction);
    // Refused → remove=[] → applyRewind no-op → SAME reference, nothing hidden this fire (no crash, no legacy fallback).
    expect(out).toBe(msgs);
    expect(out).toContain(msgs[1]); // BAD NOT hidden this fire (refusal); retries next fire when session stabilizes
    expect(out).toContain(msgs[2]);
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the dispatch is a read-then-gate (mirrors how excludeToolCallId/granularity/options/checkpoint are read in
// the SAME loop — readOwn + typeof/Array.isArray narrowing). resolvePinnedHide is in-scope (same file); no import.
const hideEntryIdsRaw = readOwn(rw, "hideEntryIds");       // defensive read (Proxy-safe; unknown)
let remove: number[];
if (Array.isArray(hideEntryIdsRaw) && hideEntryIdsRaw.length > 0) {     // GOTCHA #5: cast safe post-Array.isArray
  remove = resolvePinnedHide(m, Array.isArray(branchEntries) ? branchEntries : [], hideEntryIdsRaw as string[]);
} else if (granularity === "last_tool_call_group") {        // LEGACY FALLBACK (old markers / K=0 / capture failure)
  const units = partitionIntoUnits(m);
  remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
} else if (granularity === "last_turn") { /* unchanged */ }
// … protectedOk + applyRewind UNCHANGED — they consume `remove` regardless of which resolver produced it.

// PATTERN: reference-based test assertions (applyRewind filters by reference → survivors keep identity).
//   msgs2 = [...msgs1, x, y]  →  msgs2[1] === msgs1[1] (same object). So:
//     expect(view2).not.toContain(msgs2[1]);  // BAD STILL hidden (permanent — would leak under the old resolver)
//     expect(view2).toContain(msgs2[6]);      // GOOD visible (would be hidden under the old resolver → BUG-001/002)
```

### Integration Points

```yaml
EDITS (this task — confined to src/transforms.ts + test/transforms.test.ts):
  - src/transforms.ts:  +hideEntryIds dispatch branch (FIRST if) in filterPipeline; existing branches → else if legacy;
                        +GRANULARITY DISPATCH JSDoc bullet (Mode-A docs).
  - test/transforms.test.ts: +1 top-level describe "permanent hiding across fires (BUG-001/002 regression)"
                              (last_tool_call_group + last_turn fire1/fire2 + legacy fallback + compaction refusal).

UPSTREAM (LANDED — consumed, NOT edited):
  - src/markers.ts:74 + src/transforms.ts:935  hideEntryIds?: string[] on RewindMarker / RewindMarkerLike (P1.M2.T1.S1).
  - src/transforms.ts:625  resolvePinnedHide (P1.M2.T2.S1) — the resolver my dispatch calls.

UPSTREAM (IN-FLIGHT PARALLEL — CONTRACT):
  - src/tools/rewind.ts  captureHideEntryIds + payload threading (P1.M2.T3.S1) — populates hideEntryIds on NEW markers.
    My `length > 0` gate treats [] and absent identically → correct regardless of when T3 lands.

DOWNSTREAM (LATER subtasks — do NOT implement here):
  - P1.M3.T1  checkpoint permanent-hiding + multi-rewind composition regression tests.
  - P1.M3.T2  enhance F-rewind-core / F-checkpoint smoke assertions (real Pi runtime).
  - P1.M4     sync spec/06 idempotency + resolver descriptions.

NO DATABASE / NO ROUTES / NO CONFIG / NO NEW DEPS — pure control-flow change in one pure function + tests. No spec-doc
change (P1.M4 owns spec/06 sync). No Pi BEHAVIOR change for old markers (additive dispatch). Zero file overlap with T3
(T3 edits rewind.ts + rewind.test.ts; this task edits transforms.ts + transforms.test.ts).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Tasks 1–2)

```bash
# Type-check the whole project (the dispatch must be type-sound under strict):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# The dispatch landed: resolvePinnedHide is now CALLED from filterPipeline (was def + JSDoc refs only):
grep -n "resolvePinnedHide" src/transforms.ts   # expect the def (625) + ≥1 JSDoc ref + the NEW call site in filterPipeline

# Pi-free invariant holds (NO new import):
grep -c '^import' src/transforms.ts             # MUST be 0

# The dispatch reads hideEntryIds via readOwn (defensive — matches the loop's other reads):
grep -c "readOwn(rw, \"hideEntryIds\")" src/transforms.ts   # expect 1 (the dispatch)

# Expected: tsc exit 0; resolvePinnedHide has a call site in filterPipeline; 0 imports; hideEntryIds read once.
```

### Level 2: Unit tests (run after all edits)

```bash
# The directly-relevant suite (filterPipeline composition + resolvePinnedHide + the NEW regression describe):
npx vitest run test/transforms.test.ts         # MUST be all-green

# Full regression — the dispatch is additive; NOTHING else should change:
npx vitest run                                   # MUST be all-green (690 + new; zero regressions)

# Expected: every test green. If a PRE-EXISTING test fails, you almost certainly edited a legacy branch body or deleted
#   the excludeId read — revert and re-read GOTCHA #4/#6. The ONLY behavioral change is: markers WITH non-empty
#   hideEntryIds now take the pinned path (none of the 690 existing tests construct such a marker → all unchanged).
```

### Level 3: Integration / runtime (N/A for this pure task)

`filterPipeline` is PURE — the multi-fire permanence proof IS the Level-2 regression test (fire1 hides BAD; fire2 on a
GROWN session asserts BAD still hidden + GOOD visible). Real Pi-runtime smoke (F-rewind-core asserting permanent hiding
across actual `context.fire`s) is P1.M3.T2 — out of scope. Nothing to run at the Pi-runtime level here.

### Level 4: Creative / domain-specific validation (hand-trace — optional but recommended)

```bash
# Hand-trace the last_tool_call_group fire2 scenario to confirm remove=[1,2] and the permanence:
# msgs2 = [user, asst('BAD'), result('BAD'), asst('RW'), result('RW'), note, asst('GOOD'), result('GOOD')]  (8 msgs)
# branch2 = [e_u, e_bad_a, e_bad_r, e_rw_a, e_rw_r, e_note, e_good_a, e_good_r]  (8 "message" entries, 1:1)
# hideEntryIds = ['e_bad_a','e_bad_r'];  hideSet = {e_bad_a, e_bad_r}
# resolvePinnedHide walk (msgCursor=0, each entry yields 1):
#   e_u: id∉set; cursor 0→1
#   e_bad_a: id∈set → push 1; cursor 1→2
#   e_bad_r: id∈set → push 2; cursor 2→3
#   e_rw_a: id∉set; cursor 3→4
#   e_rw_r: id∉set; cursor 4→5
#   e_note: id∉set; cursor 5→6
#   e_good_a: id∉set; cursor 6→7
#   e_good_r: id∉set; cursor 7→8
# → remove=[1,2]  → applyRewind drops msgs2[1],msgs2[2] → [user, asst('RW'), result('RW'), note, asst('GOOD'), result('GOOD')]
# BAD (msgs2[1],msgs2[2]) NOT in view (PERMANENT ✓); GOOD (msgs2[6],msgs2[7]) IN view (visible ✓).
# (Under the OLD relative resolver, remove would be [6,7] — the GOOD group — and BAD would leak back: BUG-001.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (690 existing + new regression tests; zero regressions).
- [ ] `filterPipeline` dispatch reads `readOwn(rw, "hideEntryIds")`; non-empty → `resolvePinnedHide`; else → legacy.
- [ ] `grep -c '^import' src/transforms.ts` is still **0** (Pi-free invariant — GOTCHA #3).
- [ ] `protectedOk` + `applyRewind` are UNCHANGED (they run for both paths).
- [ ] The legacy `last_tool_call_group`/`last_turn`/`checkpoint`/`else` branch bodies are byte-identical (GOTCHA #6).

### Feature Validation

- [ ] **last_tool_call_group permanence:** fire1 hides BAD; fire2 (grown + GOOD) → BAD STILL hidden AND GOOD visible.
- [ ] **last_turn permanence:** the same fire1/fire2 shape (would have looped under the old resolver — BUG-002).
- [ ] **Legacy fallback:** a marker WITHOUT `hideEntryIds` uses the relative resolver (backward compat — unchanged).
- [ ] **Compaction refusal:** pinned marker + compaction entry → nothing hidden this fire, NO legacy fallback (GOTCHA #2).
- [ ] The 690 existing tests are UNCHANGED and green (additive dispatch — GOTCHA #6).

### Code Quality Validation

- [ ] Dispatch mirrors the loop's existing read-then-gate idiom (`readOwn` + `Array.isArray` narrowing).
- [ ] `hideEntryIdsRaw as string[]` cast is behind the `Array.isArray` guard (GOTCHA #5).
- [ ] Mode-A JSDoc documents dispatch-first, backward-compat, and refusal-no-fallback.
- [ ] No new import, no new dep, no mutation of inputs (purity holds — GOTCHA #11).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] JSDoc `GRANULARITY DISPATCH` block explains the pinned path + why refusal does not fall back.
- [ ] No spec-doc change required here (P1.M4 owns spec/06 sync).
- [ ] No new environment variables; no new deps.

---

## Anti-Patterns to Avoid

- ❌ **Adding an import to `transforms.ts`** — it is Pi-FREE (`grep -c '^import' === 0`); `resolvePinnedHide` is in-scope (GOTCHA #3).
- ❌ **Making refusal fall back to legacy** — re-introduces BUG-001/002; control flow must skip the else-if chain on refusal (GOTCHA #2).
- ❌ **Changing `protectedOk` / `applyRewind`** — they consume `remove` identically for both paths; leave them alone.
- ❌ **Deleting the `excludeId` read** — the legacy branches still consume it (GOTCHA #4).
- ❌ **Omitting `branchEntries` in a pinned-path test** — `resolvePinnedHide` needs it; omitting → `[]` → nothing hidden → test fails (GOTCHA #1).
- ❌ **Editing a legacy branch body** — the 690 tests assert them unchanged; only the `if`→`else if` keyword changes (GOTCHA #6).
- ❌ **Building branchN with ≠ messages.length entries** — the resolver's alignment guard returns `[]` on mismatch → test fails (GOTCHA #7).
- ❌ **Using `mkRewind`/`cfg` from the filterPipeline closure in the new top-level describe** — they're closure-local; define a local `cfg` + inline markers (GOTCHA #10).
- ❌ **Inventing a lint/format command** — none is configured; the gate is `tsc` + `vitest` (GOTCHA #9).
- ❌ **Touching `resolvePinnedHide` / the producer / markers.ts / spec docs** — all out of scope.

---

## Confidence Score

**9/10** for one-pass implementation success. The change is a minimal, well-specified control-flow edit to one pure
function (fix_design.md §Change 4 restated verbatim in the item_description), all three upstream pieces are verified
landed on disk (field + resolver + JSDoc already documenting the T4 dispatch predicate), the resolver's contract is
verified (returns `[]` on refusal, reads branchEntries root→leaf, pairing-safe by construction), and every edit is given
as exact `oldText`/`newText` + a hand-traced, fully-quoted regression test block. The −1 is for the two subtleties a
careless implementer could trip on: (1) the new pinned-path tests MUST pass `branchEntries` (GOTCHA #1 — the existing
legacy tests omit it, an easy copy-paste trap), and (2) refusal must not fall back to legacy (GOTCHA #2 — enforced by
control flow, easy to break with a careless `else`). Both are spelled out explicitly.

**Confidence Score**: 9/10