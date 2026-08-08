# PRP — P1.M3.T1.S1: Checkpoint permanent-hiding + multi-rewind composition + pinned/shrink regression tests

**Work item:** P1.M3.T1.S1 · **Points:** 2 · **Bugfix:** regression tests for BUG-003 (checkpoint) + pinned-hide composition
**Scope:** **APPEND ONE new top-level `describe` block to `test/transforms.test.ts`** (5 tests). **No source edits. No new
files. No new imports. No config/API/spec change.** This is a **test-only subtask** that closes the regression-test gap
for the BUG-003 fix (P1.M1 checkpoint resolution + P1.M2 pinning) and proves pinned-hide composition + pinned/shrink
interaction + checkpoint backward-compat — the scenarios the original 701-test suite never simulated
(spec_and_test_analysis §KEY QUESTION 3/4: "no test asserts checkpoint hiding is permanent; F-checkpoint only checks
marker persistence").

> **PARALLEL-COORDINATION (READ FIRST):** P1.M2.T4.S1 has **LANDED** its `describe("permanent hiding across fires
> (BUG-001/002 regression)")` at **test/transforms.test.ts:1654** (4 tests: `last_tool_call_group` + `last_turn`
> fire1/fire2 permanence, a `last_tool_call_group` legacy-fallback, a compaction-refusal). **My describe is
> COMPLEMENTARY — zero duplication:** I cover the **checkpoint** granularity (a/d), **pinned multi-target composition**
> (b), and **pinned+shrink** (c) — none of which P1.M2.T4.S1 touches. My describe is named **differently** so both
> coexist at end-of-file. See `research/multi_rewind_findings.md` §PARALLEL-COORDINATION BOUNDARY.
>
> **BASELINE (VERIFIED LIVE):** `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → **18 files / 701
> tests green.** This task is pure-additive (appends to ONE test file) → cannot regress the baseline.

---

## ⚠️ KNOWN LIMITATION surfaced by this research (test b) — read before implementing

The item_description (b) assumes "Two rewind markers, each with hideEntryIds … both spans are hidden and compose
correctly." **The LANDED implementation CANNOT do that.** Empirically verified (isolated probe of the real
`filterPipeline` + `resolvePinnedHide`):

- `filterPipeline` applies `applyRewind` (gap-closing) **between** rewinds, but passes the **FULL** `branchEntries`
  to every `resolvePinnedHide`. After the first rewind gap-closes `m`, the second rewind's full-branch walk
  **misaligns** with the shortened `m` (`msgCursor + yield > messages.length`) → `resolvePinnedHide` **safely
  refuses → returns []** → the second marker **no-ops**. Only the FIRST marker's span is hidden.
- This is a **SOFT, SAFE gap** (under-hiding): no crash (E13 holds), no pairing break, no over-hiding. It is
  surprising but not destructive.
- **The SUPPORTED multi-target pattern WORKS:** a **single** pinned marker pinning a **multi-unit span**
  (`hideEntryIds:[a,b,c,d]`) hides ALL pinned spans in one aligned walk. Verified.

**This is NOT fundamentally impossible** (the single-marker multi-span path works; separate-marker union is fixable by
resolving all pinned removals against the ORIGINAL message list before gap-closing). It is **out of scope for a
test-only subtask** (it would require editing `filterPipeline`'s rewind-loop structure — an implementation change).

**How this PRP handles it (honest + all-tests-pass — does NOT ship a failing test):**
- Test **(b-1)** proves the **SUPPORTED** composition: a single pinned marker hiding a multi-unit span (both
  toolGroups hidden, permanent) — satisfies the item's spirit via the working mechanism.
- Test **(b-2)** documents the **LIMITATION**: two separate pinned markers → first hides, second safely no-ops; no
  crash, no pairing break. A crystal-clear comment + this section mark it as a known gap with a fix direction, so a
  future implementer who fixes union-composition knows to **UPDATE** (b-2) into a "both hidden" assertion.

See `research/multi_rewind_findings.md` §FINDING 4 for the full probe trace + root cause.

---

## Goal

**Feature Goal**: Add the **regression tests the original suite lacked** (spec_and_test_analysis §KEY QUESTION 3/4) so
that a regression of BUG-003 (checkpoint hiding), of pinned-hide composition, or of the pinned/shrink interaction is
**caught by the unit suite** — not just by an expensive real-`pi -p` smoke run. Concretely: (a) prove checkpoint
rewinds are **permanent** across session growth (the M1 fix + M2 pinning compose); (b) prove pinned multi-target
composition works AND document the separate-marker limitation; (c) prove a shrink targeting an already-pinned-hidden
message safely no-ops; (d) prove an OLD checkpoint marker (no `hideEntryIds`) still hides via the M1-fixed
`resolveCheckpoint` path (backward compat).

**Deliverable** (APPEND to ONE existing file — do NOT rewrite it):
1. `test/transforms.test.ts` — APPEND a new top-level
   `describe("checkpoint permanent hiding + multi-rewind composition + pinned/shrink (BUG-003 regression + pinned composition)")`
   with 5 tests ((a) checkpoint permanence fire1/fire2; (b-1) single-marker multi-span composition fire1/fire2;
   (b-2) separate-marker limitation; (c) pinned+shrink; (d) checkpoint legacy). Reuse the module-scope
   `asst`/`result`/`user`/`custom`/`entry`/`labelEntry` fixtures + a LOCAL `cfg` (mirrors P1.M2.T4.S1's describe).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (no source change; the new tests type-check under `strict`).
- `npx vitest run` is **all-green** — 701 existing + 5 new = **706 tests**, 18 files (zero regressions; pure append).
- **No duplication** with P1.M2.T4.S1's landed `permanent hiding across fires` describe (distinct describe name;
  distinct granularities/scenarios).
- The 5 tests are the exact regression guards described below; (a)/(b-1)/(c)/(d) assert the CORRECT behavior; (b-2)
  documents the known limitation truthfully (passes).

---

## User Persona

**Target User**: The bugfix maintainer + the CI gate. Today, BUG-003 (checkpoint hides nothing) and the
relative-leak bugs (BUG-001/002) shipped because the unit suite never simulated "rewind → resume work → re-fire" and
the F-checkpoint smoke scenario asserted only marker persistence (spec_and_test_analysis §KEY QUESTION 4). These 5
tests close that gap at the **pure-function tier** (no Pi runtime needed — `filterPipeline` is pure): they would have
caught BUG-003 (checkpoint remove=[] always) and will catch any future regression of the checkpoint fix, the pinned
multi-target composition, or the pinned/shrink ordering.

**Use Case**: A maintainer changes `resolveCheckpoint` or `resolvePinnedHide` or the `filterPipeline` dispatch. The CI
run executes these 5 tests; if the checkpoint fix regressed (remove=[] again), test (a)/(d) fails; if pinned
composition broke (crash/pairing-break/over-hide), test (b-1)/(b-2) fails; if shrink started re-adding removed
content, test (c) fails.

**Pain Points Addressed**: The 701-test suite passed while BUG-003 made checkpoint rewinds hide nothing. These tests
make that class of regression **impossible to ship green** again.

---

## Why

- **Closes the spec_and_test_analysis §KEY QUESTION 3/4 gap directly.** That analysis (the bugfix's own architecture
  doc) names the exact missing tests: "no test simulates rewind → more work → re-fire" and "F-checkpoint never asserts
  anything is hidden." This task adds exactly those, for the checkpoint granularity + composition.
- **Proves the M1 (checkpoint) + M2 (pinning) fixes compose.** BUG-003 was fixed in two layers: P1.M1 fixed
  `resolveCheckpoint`/`setCheckpoint` (branch ordering + stable entry + unit-snap); P1.M2 added `hideEntryIds`
  pinning. Test (a) proves a NEW checkpoint marker (pinned) hides permanently; test (d) proves an OLD checkpoint
  marker (legacy) still hides via the M1-fixed path. Together they pin both layers.
- **Pure-function tier — fast, deterministic, no Pi.** `filterPipeline` is pure; the multi-fire pattern is just two
  calls with a grown input array. No `pi -p`, no observer extension, no session JSONL parsing. (The real-Pi smoke
  enhancement is P1.M3.T2 — out of scope here.)
- **Honest about the multi-rewind limitation.** Rather than ship a failing test or silently enshrine a bug, this task
  proves the SUPPORTED composition (single marker, multi-span) AND documents the separate-marker gap with a clear fix
  direction — giving the orchestrator the information to scope a follow-up.

---

## What

APPEND one `describe` to `test/transforms.test.ts` (5 tests). Each test builds messages + branchEntries + markers,
calls `filterPipeline`, and asserts on the filtered view using **reference-based** assertions (`expect(view).not.toContain(msgs[i])`
/ `.toContain(msgs[i])`) — `applyRewind` filters by reference so survivors keep object identity (P1.M2.T4.S1 idiom).

- **(a) checkpoint permanent hiding (BUG-003 regression)** — `[user, asst(cp), result(cp), asst(read), result(read)]`
  + a checkpoint marker with `hideEntryIds:["e_read_a","e_read_r"]` (what the producer captures for the post-checkpoint
  span). Fire 1 → read work HIDDEN, checkpoint toolGroup KEPT. Fire 2 (append `[asst(new), result(new)]` + branch
  entries) → read STILL hidden (permanent) + new work VISIBLE.
- **(b-1) multi-target composition — SUPPORTED (single pinned marker, multi-unit span)** — `[user, asst(A), result(A),
  asst(B), result(B), note]` + ONE marker `hideEntryIds:[e_a_a,e_a_r,e_b_a,e_b_r]`. Fire 1 → BOTH A and B hidden. Fire
  2 (append `[asst(C), result(C)]`) → A and B STILL hidden (permanent) + C visible. Proves the working composition.
- **(b-2) multi-target composition — KNOWN LIMITATION (two separate pinned markers)** — same messages + TWO markers
  (m1 pins A, m2 pins B). Asserts the ACTUAL safe behavior: A hidden (m1 ran first), B STILL VISIBLE (m2 no-op'd on
  alignment), no crash, pairing intact (asst(B)+result(B) both present). Comment + this PRP mark it as a known gap.
- **(c) pinned rewind + shrink on the removed target → shrink no-ops** — `[user, asst(A), result(A), asst(B),
  result(B)]` + a pinned rewind (hides A incl result A) + a shrink `by_tool_call_id:"A"`. Asserts result(A) removed,
  no "SHRUNK" text appears (shrink found no target → no-op), asst(B)/result(B) kept.
- **(d) checkpoint backward compat (legacy marker, no hideEntryIds)** — `[user, asst(cp), result(cp), asst(read),
  result(read)]` + a `labelEntry` targeting `e_cp_a` + an OLD checkpoint marker (NO `hideEntryIds`). Asserts the
  `resolveCheckpoint` M1-fix path hides the post-checkpoint read work (unit-snapped: checkpoint toolGroup kept).

This subtask does **NOT**: edit `src/transforms.ts` or any source file (test-only); implement a fix for the
separate-marker union limitation (b-2 documents it; a fix is future work); touch `tools/rewind.ts` or `markers.ts`;
add smoke/integration tests (P1.M3.T2); sync spec docs (P1.M4); or duplicate P1.M2.T4.S1's landed tests.

### Success Criteria

- [ ] ONE new top-level `describe` (distinct name) is APPENDED to the END of `test/transforms.test.ts`; the 701
      existing tests are UNCHANGED.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` → **18 files / 706 tests green** (701 + 5 new; zero regressions).
- [ ] **(a)** checkpoint marker with `hideEntryIds` → post-checkpoint work hidden fire 1, STILL hidden fire 2, new
      work visible fire 2.
- [ ] **(b-1)** a SINGLE pinned marker pinning a multi-unit span → BOTH spans hidden fire 1, STILL hidden fire 2,
      new work visible.
- [ ] **(b-2)** TWO separate pinned markers → first span hidden, second span still VISIBLE (limitation documented),
      no crash, pairing intact. Comment marks it a known gap + fix direction.
- [ ] **(c)** pinned rewind removes a span; a shrink targeting a message in that span → no-op (no "SHRUNK" text).
- [ ] **(d)** an OLD checkpoint marker (no `hideEntryIds`) → `resolveCheckpoint` hides post-checkpoint work (unit-snapped
      toolGroup kept) — backward compat with the M1 fix.
- [ ] No duplication with P1.M2.T4.S1's landed `permanent hiding across fires` describe (distinct name + scenarios).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** The exact 5 tests are given VERBATIM below (Task 2), each with the hand-traced `remove` sets and the exact
> fixtures (`asst`/`result`/`user`/`custom`/`entry`/`labelEntry`) quoted from the live test file (lines 16-58, 738-744).
> The `filterPipeline` signature + the pinned/checkpoint dispatch + `resolvePinnedHide`/`resolveCheckpoint` contracts
> are verified on disk (src/transforms.ts). The behavior of all 5 tests was PROBED empirically in an isolated harness
> against the real module (`research/multi_rewind_findings.md`) — (a)/(b-1)/(c)/(d) assert correct behavior; (b-2)
> documents the probed limitation. No prior knowledge beyond "tsc + vitest are green; append one describe" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (1700+ lines, 701 tests).** Add ONE new top-level `describe`
  at the END (after the P1.M2.T4.S1 `permanent hiding across fires` describe at :1654). Do NOT touch any existing test.
- **REUSE the module-scope fixtures** `asst`/`asstText`/`result`/`user`/`custom` (lines 16-50), `entry`/`labelEntry`
  (lines 738-744), and the imports on line 2 (`filterPipeline`, `RewindMarkerLike`, `ShrinkMarkerLike`, `MarkerBundle`,
  `ProtectedConfig`, `BranchEntry`, `MessageLike` are ALL already imported). Do NOT redefine them.
- **Define a LOCAL `cfg`** inside the new describe (the `filterPipeline` describe's `cfg` at :1171+ is closure-local
  and NOT accessible from a top-level describe — mirrors P1.M2.T4.S1's GOTCHA #10): `const cfg = { rewind: { protectedRoles: ["first:user","latest:user"] } } as ProtectedConfig;`.
- **Pass `branchEntries` (4th `filterPipeline` arg) on EVERY pinned-path call.** `resolvePinnedHide`'s first defensive
  guard is `!Array.isArray(branchEntries) → return []`; omitting it → `remove=[]` → nothing hidden → test fails
  (P1.M2.T4.S1 GOTCHA #1). Both fires of (a)/(b-1)/(b-2) MUST pass `branch1`/`branch2`. (The legacy test (d) also needs
  branchEntries — `resolveCheckpoint` requires it.)
- **Reference-based assertions** (P1.M2.T4.S1 GOTCHA #8): `applyRewind` filters by reference → survivors keep identity.
  `msgs2 = [...msgs1, x, y]` ⇒ `msgs2[1] === msgs1[1]`. So `expect(view2).not.toContain(msgs2[1])` and
  `.toContain(msgs2[6])` are correct.
- **1:1 alignment for pinned tests:** one `"message"` entry per message (`entryMessageYield("message")===1`). The
  resolver's alignment check (`msgCursor + yield > messages.length → return []`) passes only when branch length (of
  context-producing entries) ≤ messages length. Build `branchN` with one `"message"` entry per message. (The label
  entry in (d) is `type:"label"` — NOT context-producing — so it's filtered out and does not count toward alignment;
  include it for realism between the entries it labels.)

### Documentation & References

```yaml
# MUST READ — authoritative sources for these tests
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/spec_and_test_analysis.md
  section: "KEY QUESTION 3 (the multi-fire test gap) + KEY QUESTION 4 (F-checkpoint asserts only persistence)"
  why: "THE justification for this task: the 701-test suite has NO 'rewind → more work → re-fire' test and NO test that
        asserts checkpoint hiding actually hides anything. My 5 tests close both gaps at the pure tier."
  critical: "KEY QUESTION 4: 'F-checkpoint … SHOULD assert that the checkpoint rewind actually hides anything (BUG-003)
        … and that the hiding is permanent across subsequent fires.' Test (a) is exactly that, at the pure tier."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M3T1S1/research/multi_rewind_findings.md
  why: "THE empirical basis: probed (a)/(b-1)/(b-2)/(c)/(d) against the real module; CONFIRMS (a)/(b-1)/(c)/(d) work and
        (b-2) is a known limitation. Read FINDING 4 (the separate-marker union gap) before writing (b-2)."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T4S1/PRP.md
  section: "the landed 'permanent hiding across fires' describe (verbatim in its Task 3)"
  why: "P1.M2.T4.S1 LANDED its describe at test/transforms.test.ts:1654. Read it to AVOID DUPLICATION: it covers
        last_tool_call_group + last_turn permanence + last_tool_call_group legacy + compaction refusal. My describe
        covers checkpoint + multi-target composition + pinned/shrink + checkpoint-legacy — COMPLEMENTARY."

- file: src/transforms.ts
  section: "filterPipeline rewind-loop dispatch (~1124-1160) + resolvePinnedHide (625) + resolveCheckpoint (454) +
            RewindMarkerLike (918) + ShrinkMarkerLike/ShrinkTarget + BranchEntry (394)"
  why: "The pure functions under test. The dispatch reads hideEntryIds FIRST (→ resolvePinnedHide) then falls to
        granularity (last_tool_call_group/last_turn/checkpoint). resolveCheckpoint is the M1-fixed legacy checkpoint
        path (unit-snap). RewindMarkerLike.{seq,granularity,excludeToolCallId,hideEntryIds,checkpoint} is the marker
        shape the tests construct."

- file: src/tools/rewind.ts
  section: "captureHideEntryIds (282) + resolvePreview (319)"
  why: "The PRODUCER (P1.M2.T3, landed). resolvePreview computes `remove` (via resolveCheckpoint for checkpoint
        granularity) then captureHideEntryIds maps those indices → stable entry ids → the marker's hideEntryIds. My
        tests SIMULATE the producer by hand-constructing markers with the hideEntryIds the producer would capture."

- file: test/transforms.test.ts
  section: "fixtures (16-58) + entry/labelEntry (738-744) + resolveCheckpoint tests (747-919) + the LANDED
            permanent-hiding describe (1654-1700)"
  why: "THE idiom to mirror: asst('c1')/result('c1')/user/custom/entry('e1','message')/labelEntry('eL','e2','ckpt').
        The P1.M2.T4.S1 describe (1654) is the DIRECT template for the fire1/fire2 multi-fire pattern + the LOCAL cfg +
        reference assertions. Copy its structure; change the scenario to checkpoint/composition."
  pattern: "filterPipeline(msgs, {rewinds:[marker], shrinks:[]}, cfg, branch) → reference assertions."
  gotcha: "Pinned-path calls MUST pass branch (4th arg) or resolvePinnedHide returns [] (nothing hidden)."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  section: "Change 3 (resolvePinnedHide) + Change 4 (filterPipeline dispatch)"
  why: "The design contract for the pinned path: hideEntryIds checked FIRST; non-empty → resolvePinnedHide; refusal
        returns [] (NOT null) → no legacy fallback. Tests (a)/(b)/(c) exercise the pinned path; (d) exercises the
        legacy checkpoint fallback."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'. NO new dep needed.
├── tsconfig.json           # strict, noImplicitAny, moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── transforms.ts       # READ-ONLY (filterPipeline dispatch + resolvePinnedHide + resolveCheckpoint all LANDED).
│   ├── markers.ts          # READ-ONLY (hideEntryIds field LANDED, P1.M2.T1.S1).
│   ├── tools/rewind.ts     # READ-ONLY (captureHideEntryIds + resolvePreview LANDED, P1.M2.T3.S1).
│   └── (config/log/runtime/tokens/ledger/notes/nudges/filter/index/tools/*)  # untouched
└── test/
    └── transforms.test.ts  # APPEND: ONE new top-level describe at the END (after :1654). 701 tests untouched.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / 701 tests green.
# NOTE: no eslint/prettier configured (devDeps = typescript + vitest + @types/node). Gate = `tsc --noEmit` + `vitest run`.
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
└── test/
    └── transforms.test.ts   # +1 top-level describe "checkpoint permanent hiding + multi-rewind composition + pinned/shrink"
                             #   (5 tests: a / b-1 / b-2 / c / d). ~150 new lines at EOF.
# No source edits. No new files. No new deps. No config/API/spec change.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND ONE describe; do NOT rewrite test/transforms.test.ts. 701 tests are GREEN and must
#   stay green. Add the new describe at the END (after the P1.M2.T4.S1 describe at :1654). Reuse the module-scope
#   fixtures (asst/result/user/custom/entry/labelEntry) + the line-2 imports — do NOT redefine or re-import.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — The pinned path REQUIRES branchEntries (4th filterPipeline arg) on EVERY call. resolvePinnedHide
#   returns [] when branchEntries is absent/non-array. Tests (a)/(b-1)/(b-2)/(c) (pinned path) + (d) (checkpoint path)
#   ALL pass branch1/branch2. Omitting it → remove=[] → nothing hidden → test fails. (P1.M2.T4.S1 GOTCHA #1.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — 1:1 alignment: one "message" entry per message. The resolver's alignment guard
#   (`msgCursor + yield > messages.length → return []`) passes only when the count of context-producing branch entries
#   ≤ messages.length. Build branchN with one entry("eN","message") per message. The label entry in (d) is type:"label"
#   (NOT context-producing → filtered out → does not count); place it between the entries it labels for realism.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — (b-2) documents a KNOWN LIMITATION, NOT desired behavior. Two SEPARATE pinned markers do NOT
#   union: the second no-ops on alignment (full branch vs gap-closed m). Assert the ACTUAL safe behavior (first hidden,
#   second visible, no crash, pairing intact). Do NOT assert "both hidden" — it FAILS. Mark it clearly as a known gap
#   with a fix direction in the comment. See research/multi_rewind_findings.md §FINDING 4.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Reference-based assertions (applyRewind filters by reference → survivors keep identity).
#   msgs2 = [...msgs1, x, y] ⇒ msgs2[1] === msgs1[1]. So `expect(view2).not.toContain(msgs2[1])` (STILL hidden) and
#   `.toContain(msgs2[6])` (new work visible) are correct. (P1.M2.T4.S1 GOTCHA #8.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Define a LOCAL cfg inside the describe: `{ rewind: { protectedRoles: ["first:user","latest:user"] } } as
#   ProtectedConfig`. The filterPipeline describe's cfg (:1171+) is closure-local → not accessible from a top-level
#   describe. protectedRoles keeps protectedOk happy (all removals are after the first user → min(remove) > iFirstUser).
#   (P1.M2.T4.S1 GOTCHA #10.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — For the checkpoint permanence test (a), the marker goes through resolvePinnedHide (hideEntryIds present),
#   so NO labelEntry is needed in branch1 (resolvePinnedHide doesn't read labels). Omit the label in pinned-path
#   branches (a)/(b)/(c); INCLUDE it ONLY in the legacy test (d) (resolveCheckpoint reads labelEntry to find the target).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — resolveCheckpoint (test d) UNIT-SNAPS iTarget to the end of the toolGroup. With [user, asst(cp), result(cp),
#   asst(read), result(read)] + label targeting e_cp_a: iTarget=1 → unit-snap → 2 (toolGroup [1,2]); remove=[3,4]. So
#   asst(cp)+result(cp) are KEPT and only the read work is removed. Assert accordingly (do NOT expect result(cp) removed).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — There is NO lint/format tool (devDeps = typescript + vitest + @types/node). The gate is `tsc --noEmit` +
#   `vitest run`. Do NOT invent a ruff/eslint/prettier command — it fails "command not found".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — Do NOT duplicate P1.M2.T4.S1. Its landed describe covers last_tool_call_group + last_turn permanence +
#   last_tool_call_group legacy + compaction refusal. My describe's name + scenarios are DISTINCT (checkpoint + multi-
#   target composition + pinned/shrink + checkpoint-legacy). If you find yourself testing last_tool_call_group/last_turn
#   single-span permanence or last_tool_call_group legacy, STOP — that's P1.M2.T4.S1's job.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No data-model change — this is test-only. The tests construct `RewindMarkerLike` / `ShrinkMarkerLike` fixtures (already
imported) and assert on `filterPipeline`'s `MessageLike[]` output. The key fixture shapes:

```ts
// A NEW checkpoint marker (P1.M2.T3 producer would persist this): hideEntryIds = post-checkpoint entry ids.
const cpMarker: RewindMarkerLike = { seq: 1, granularity: "checkpoint", checkpoint: "cp", hideEntryIds: ["e_read_a", "e_read_r"] };
// An OLD checkpoint marker (legacy, no hideEntryIds) → resolveCheckpoint path:
const legacyCp: RewindMarkerLike = { seq: 1, granularity: "checkpoint", checkpoint: "start" /* hideEntryIds ABSENT */ };
// A pinned last_tool_call_group marker hiding a MULTI-UNIT span (the supported composition pattern):
const multiSpan: RewindMarkerLike = { seq: 1, granularity: "last_tool_call_group", hideEntryIds: ["e_a_a","e_a_r","e_b_a","e_b_r"] };
// A shrink targeting a toolResult by toolCallId:
const shrink: ShrinkMarkerLike = { seq: 2, target: { by_tool_call_id: "A" }, replacement: "SHRUNK" };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + landed-state (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json                  # expect exit 0
  - RUN: npx vitest run                                     # expect 18 files / 701 tests green
  - RUN: grep -n 'permanent hiding across fires' test/transforms.test.ts   # expect 1 (P1.M2.T4.S1 LANDED at :1654)
  - RUN: grep -n 'function entry\|function labelEntry' test/transforms.test.ts  # expect both (reuse — do NOT redefine)

Task 1: APPEND the new describe to test/transforms.test.ts   (exact content below — copy verbatim)
  - APPEND at the END of the file (after the P1.M2.T4.S1 describe): the new top-level describe with 5 tests.
  - CONSTRAINTS:
      * Reuse module-scope asst/result/user/custom/entry/labelEntry + line-2 imports (GOTCHA #1). Define a LOCAL cfg.
      * Pinned-path calls pass branch (4th arg) (GOTCHA #2); 1:1 message-entry alignment (GOTCHA #3).
      * (b-2) asserts the KNOWN LIMITATION (first hidden, second visible, no crash) — NOT "both hidden" (GOTCHA #4).
      * Reference assertions (GOTCHA #5). No labelEntry in pinned branches; labelEntry only in (d) (GOTCHA #7).
      * (d) expects unit-snapped iTarget (asst(cp)+result(cp) KEPT) (GOTCHA #8).
      * NO duplication of P1.M2.T4.S1 (GOTCHA #10).

Task 2: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) + Level 2 (vitest: new describe in isolation, then full suite). Levels 3/4 N/A (pure tests).
```

#### Exact content to APPEND — `test/transforms.test.ts` (at the END, after the P1.M2.T4.S1 describe)

```ts
// ── checkpoint permanent hiding + multi-rewind composition + pinned/shrink (BUG-003 regression + pinned composition) ──
// Complementary to P1.M2.T4.S1's "permanent hiding across fires (BUG-001/002 regression)" describe ABOVE: that one
// covers last_tool_call_group + last_turn single-span permanence + last_tool_call_group legacy + compaction refusal.
// THIS describe covers the CHECKPOINT granularity (BUG-003), pinned MULTI-TARGET composition, the pinned/shrink
// interaction, and CHECKPOINT legacy — none of which P1.M2.T4.S1 touches. See research/multi_rewind_findings.md.

describe("checkpoint permanent hiding + multi-rewind composition + pinned/shrink (BUG-003 regression + pinned composition)", () => {
  // LOCAL cfg (the filterPipeline describe's cfg is closure-local; P1.M2.T4.S1 GOTCHA #10). protectedRoles keeps
  // protectedOk happy: every removal here starts strictly after the first user message → min(remove) > iFirstUser.
  const cfg = { rewind: { protectedRoles: ["first:user", "latest:user"] } } as ProtectedConfig;

  // ── (a) checkpoint permanent hiding (BUG-003 regression; spec_and_test_analysis §KEY QUESTION 4) ──
  it("(a) checkpoint — post-checkpoint work hidden fire 1, STILL hidden fire 2 (PERMANENT), new work VISIBLE", () => {
    // msgs1 = [user, asst(cp), result(cp), asst(read), result(read)]. The checkpoint was set at asst(cp) (e_cp_a).
    // A NEW checkpoint marker carries hideEntryIds = the post-checkpoint entry ids (captureHideEntryIds/resolvePreview,
    // tools/rewind.ts:341 — calls resolveCheckpoint to get remove=[3,4], maps those → e_read_a/e_read_r).
    const msgs1: MessageLike[] = [user("u"), asst("cp"), result("cp"), asst("read"), result("read")];
    // branch1: one "message" entry per message (1:1). NO labelEntry needed — the PINNED path (resolvePinnedHide) does
    // not read labels; it maps hideEntryIds by id directly.
    const branch1: BranchEntry[] = [
      entry("e_u", "message"), entry("e_cp_a", "message"), entry("e_cp_r", "message"),
      entry("e_read_a", "message"), entry("e_read_r", "message"),
    ];
    const marker: RewindMarkerLike = {
      seq: 1, granularity: "checkpoint", checkpoint: "cp", hideEntryIds: ["e_read_a", "e_read_r"],
    };
    // ── Fire 1: resolvePinnedHide maps e_read_a/e_read_r → indices [3,4] → read work HIDDEN; checkpoint toolGroup KEPT.
    const view1 = filterPipeline(msgs1, { rewinds: [marker], shrinks: [] }, cfg, branch1);
    expect(view1).not.toContain(msgs1[3]); // asst(read) HIDDEN
    expect(view1).not.toContain(msgs1[4]); // result(read) HIDDEN
    expect(view1).toContain(msgs1[0]);     // user kept
    expect(view1).toContain(msgs1[1]);     // asst(cp) kept (checkpoint point — NOT pinned)
    expect(view1).toContain(msgs1[2]);     // result(cp) kept (NOT pinned)
    expect(view1).toHaveLength(3);

    // ── Fire 2: the agent resumed — appended NEW work (NEW entries, NEW ids NOT in the pinned set) ──
    const msgs2: MessageLike[] = [...msgs1, asst("new"), result("new")]; // msgs2[5]=new asst, msgs2[6]=new result
    const branch2: BranchEntry[] = [...branch1, entry("e_new_a", "message"), entry("e_new_r", "message")];
    // SAME marker (persisted). resolvePinnedHide STILL maps e_read_a/e_read_r → [3,4]; e_new_* NOT pinned → visible.
    const view2 = filterPipeline(msgs2, { rewinds: [marker], shrinks: [] }, cfg, branch2);
    // THE PERMANENCE ASSERTION: read work STILL hidden (would reappear if the marker re-resolved relatively — BUG-003).
    expect(view2).not.toContain(msgs2[3]); // asst(read) STILL hidden
    expect(view2).not.toContain(msgs2[4]); // result(read) STILL hidden
    // THE NEW-WORK ASSERTION: the agent's resumed work is VISIBLE (no infinite loop, no leak-back).
    expect(view2).toContain(msgs2[5]); // asst(new) visible
    expect(view2).toContain(msgs2[6]); // result(new) visible
    expect(view2).toContain(msgs2[0]); // user kept
    expect(view2).toContain(msgs2[1]); // asst(cp) kept
    expect(view2).toHaveLength(5);
  });

  // ── (b-1) multi-target composition — SUPPORTED: a SINGLE pinned marker hides a MULTI-UNIT span ──
  it("(b-1) single pinned marker hiding a multi-unit span → BOTH spans hidden fire 1, STILL hidden fire 2, new work visible", () => {
    // One marker pinning BOTH toolGroups (A and B) hides them in ONE aligned resolvePinnedHide walk (full msgs ↔ full
    // branch). This is the SUPPORTED multi-target pattern (vs two separate markers — see (b-2)).
    const msgs1: MessageLike[] = [
      user("u"), asst("A"), result("A"), asst("B"), result("B"), custom("mulligan:note"),
    ];
    const branch1: BranchEntry[] = [
      entry("e_u", "message"), entry("e_a_a", "message"), entry("e_a_r", "message"),
      entry("e_b_a", "message"), entry("e_b_r", "message"), entry("e_note", "message"),
    ];
    const marker: RewindMarkerLike = {
      seq: 1, granularity: "last_tool_call_group",
      hideEntryIds: ["e_a_a", "e_a_r", "e_b_a", "e_b_r"], // BOTH toolGroups pinned in ONE marker
    };
    // Fire 1: resolvePinnedHide → remove [1,2,3,4] → view = [user, note]. BOTH spans hidden; no interference.
    const view1 = filterPipeline(msgs1, { rewinds: [marker], shrinks: [] }, cfg, branch1);
    expect(view1).not.toContain(msgs1[1]); // asst(A) hidden
    expect(view1).not.toContain(msgs1[2]); // result(A) hidden
    expect(view1).not.toContain(msgs1[3]); // asst(B) hidden
    expect(view1).not.toContain(msgs1[4]); // result(B) hidden
    expect(view1).toContain(msgs1[0]);     // user kept
    expect(view1).toContain(msgs1[5]);     // note kept
    expect(view1).toHaveLength(2);

    // Fire 2: new work appended → A and B STILL hidden (permanent), new work visible.
    const msgs2: MessageLike[] = [...msgs1, asst("C"), result("C")]; // msgs2[6]=C asst, msgs2[7]=C result
    const branch2: BranchEntry[] = [...branch1, entry("e_c_a", "message"), entry("e_c_r", "message")];
    const view2 = filterPipeline(msgs2, { rewinds: [marker], shrinks: [] }, cfg, branch2);
    expect(view2).not.toContain(msgs2[1]); // A STILL hidden
    expect(view2).not.toContain(msgs2[2]);
    expect(view2).not.toContain(msgs2[3]); // B STILL hidden
    expect(view2).not.toContain(msgs2[4]);
    expect(view2).toContain(msgs2[6]); // C visible
    expect(view2).toContain(msgs2[7]);
    expect(view2).toContain(msgs2[0]); // user kept
    expect(view2).toContain(msgs2[5]); // note kept
    expect(view2).toHaveLength(4);
  });

  // ── (b-2) multi-target composition — KNOWN LIMITATION: two SEPARATE pinned markers do NOT union ──
  // KNOWN LIMITATION (research/multi_rewind_findings.md §FINDING 4): filterPipeline applies applyRewind (gap-closing)
  // BETWEEN rewinds but passes the FULL branchEntries to every resolvePinnedHide. After the first rewind gap-closes m,
  // the second rewind's full-branch walk MISALIGNS with the shortened m (msgCursor + yield > m.length) → resolvePinnedHide
  // SAFELY refuses (returns []) → the second marker NO-OPS. Only the FIRST marker's span is hidden. This is a SOFT,
  // SAFE gap (under-hiding): no crash, no pairing break, no over-hiding. The SUPPORTED multi-target pattern is a SINGLE
  // marker pinning a multi-unit span (see (b-1)). FIX DIRECTION (future work, OUT OF SCOPE for this test-only subtask):
  // union ALL pinned removal sets against the ORIGINAL message list BEFORE gap-closing (resolve every hideEntryIds
  // against the un-reduced m, union the indices, applyRewind once). WHEN THAT FIX LANDS, UPDATE this test to assert
  // both spans are hidden.
  it("(b-2) two SEPARATE pinned markers — first hides, second safely NO-OPS on alignment (KNOWN LIMITATION; no crash/pairing-break)", () => {
    const msgs1: MessageLike[] = [
      user("u"), asst("A"), result("A"), asst("B"), result("B"), custom("mulligan:note"),
    ];
    const branch1: BranchEntry[] = [
      entry("e_u", "message"), entry("e_a_a", "message"), entry("e_a_r", "message"),
      entry("e_b_a", "message"), entry("e_b_r", "message"), entry("e_note", "message"),
    ];
    const m1: RewindMarkerLike = { seq: 1, granularity: "last_tool_call_group", hideEntryIds: ["e_a_a", "e_a_r"] };
    const m2: RewindMarkerLike = { seq: 2, granularity: "last_tool_call_group", hideEntryIds: ["e_b_a", "e_b_r"] };
    // m1 (seq1) runs FIRST: resolvePinnedHide(full msgs1, full branch1, [e_a_a,e_a_r]) → remove [1,2] → m gap-closed.
    // m2 (seq2) runs SECOND: resolvePinnedHide(m=LEN 4, branch1=6 entries, [e_b_a,e_b_r]) → at e_b_r cursor 4: 4+1>4 →
    //   return [] → m2 NO-OPS. Span B stays VISIBLE.
    const out = filterPipeline(msgs1, { rewinds: [m1, m2], shrinks: [] }, cfg, branch1);
    expect(out).not.toContain(msgs1[1]); // asst(A) HIDDEN (m1 ran first)
    expect(out).not.toContain(msgs1[2]); // result(A) HIDDEN
    expect(out).toContain(msgs1[3]);     // asst(B) STILL VISIBLE — the LIMITATION (m2 no-op'd)
    expect(out).toContain(msgs1[4]);     // result(B) STILL VISIBLE — pairing INTACT (B's call+result both present)
    expect(out).toContain(msgs1[0]);     // user kept
    expect(out).toContain(msgs1[5]);     // note kept
    // SAFE properties (the regression guard): no crash (we got here), pairing intact (asst(B)+result(B) both present
    // OR both absent — here both present → no orphan), no over-hiding (note + user survive).
    expect(out.some((m) => (m as MessageLike).role === "assistant" && (m as MessageLike).role !== undefined)).toBe(true);
    // Pairing sanity: for every toolResult present, a matching toolCall assistant is present (no orphan).
    const presentCalls = new Set<string>();
    for (const m of out) {
      const c = (m as MessageLike).content;
      if (Array.isArray(c)) for (const b of c) if (b && typeof b === "object" && (b as Record<string, unknown>).type === "toolCall" && typeof (b as Record<string, unknown>).id === "string") presentCalls.add((b as Record<string, unknown>).id as string);
    }
    for (const m of out) {
      if ((m as MessageLike).role === "toolResult") expect(presentCalls.has((m as MessageLike).toolCallId as string)).toBe(true);
    }
  });

  // ── (c) pinned rewind + shrink on the removed target → shrink NO-OPS (spec/08 E8) ──
  it("(c) pinned rewind removes span A (incl result A); a shrink targeting result A → no-op (target already removed)", () => {
    // filterPipeline order = rewinds FIRST (gap-closing), THEN shrinks on the reduced array. The rewind removes
    // result(A) (e_a_r ∈ hideEntryIds); the subsequent applyShrink → resolveShrinkTarget(by_tool_call_id "A") finds
    // no toolResult with toolCallId "A" in the reduced m → null → no-op (m unchanged). spec/08 E8.
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const branch: BranchEntry[] = [
      entry("e_u", "message"), entry("e_a_a", "message"), entry("e_a_r", "message"),
      entry("e_b_a", "message"), entry("e_b_r", "message"),
    ];
    const rw: RewindMarkerLike = { seq: 1, granularity: "last_tool_call_group", hideEntryIds: ["e_a_a", "e_a_r"] };
    const sh: ShrinkMarkerLike = { seq: 2, target: { by_tool_call_id: "A" }, replacement: "SHRUNK" };
    const out = filterPipeline(msgs, { rewinds: [rw], shrinks: [sh] }, cfg, branch);
    expect(out).not.toContain(msgs[1]); // asst(A) removed by the pinned rewind
    expect(out).not.toContain(msgs[2]); // result(A) removed by the pinned rewind
    // The shrink NO-OP'd: no "SHRUNK" text anywhere (its target — result(A) — was already removed; resolveShrinkTarget → null).
    const hasShrunk = out.some((m) => {
      const c = (m as MessageLike).content;
      if (Array.isArray(c)) return c.some((b) => b && typeof b === "object" && (b as Record<string, unknown>).text === "SHRUNK");
      return false;
    });
    expect(hasShrunk).toBe(false);
    expect(out).toContain(msgs[3]); // asst(B) kept (untouched)
    expect(out).toContain(msgs[4]); // result(B) kept
    expect(out).toHaveLength(3);
  });

  // ── (d) checkpoint backward compat — an OLD marker (no hideEntryIds) uses resolveCheckpoint (the M1-fixed path) ──
  it("(d) checkpoint LEGACY (no hideEntryIds) → resolveCheckpoint hides post-checkpoint work (unit-snapped toolGroup kept)", () => {
    // An OLD checkpoint marker (pre-pin) lacks hideEntryIds → the dispatch falls through to the `checkpoint` branch →
    // resolveCheckpoint (the M1 fix: branch ordering + stable entry + UNIT-SNAP). Proves backward compat: old markers
    // still hide via the fixed relative path.
    const msgs: MessageLike[] = [user("u"), asst("cp"), result("cp"), asst("read"), result("read")];
    // branch: root→leaf, with a labelEntry targeting e_cp_a (the checkpoint point). The label is type:"label" (NOT
    // context-producing → filtered out of the ctxEntries walk → does not count toward alignment).
    const branch: BranchEntry[] = [
      entry("e_u", "message"), entry("e_cp_a", "message"), entry("e_cp_r", "message"),
      labelEntry("eL", "e_cp_a", "start"), // label points at the checkpoint assistant
      entry("e_read_a", "message"), entry("e_read_r", "message"),
    ];
    const legacyMarker: RewindMarkerLike = {
      seq: 1, granularity: "checkpoint", checkpoint: "start",
      // hideEntryIds intentionally ABSENT (old marker) → resolveCheckpoint path
    };
    const out = filterPipeline(msgs, { rewinds: [legacyMarker], shrinks: [] }, cfg, branch);
    // resolveCheckpoint: label → targetId e_cp_a → iTarget=1; UNIT-SNAP → 2 (toolGroup [1,2] = asst(cp)+result(cp));
    // remove = indices > 2 → [3,4] (the read work). The checkpoint toolGroup is KEPT (unit-snapped — no orphan).
    expect(out).not.toContain(msgs[3]); // asst(read) HIDDEN
    expect(out).not.toContain(msgs[4]); // result(read) HIDDEN
    expect(out).toContain(msgs[0]);     // user kept
    expect(out).toContain(msgs[1]);     // asst(cp) KEPT (checkpoint point, unit-snapped)
    expect(out).toContain(msgs[2]);     // result(cp) KEPT (unit-snap avoids orphaning asst(cp)'s call)
    expect(out).toHaveLength(3);
  });

  });
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the multi-fire proof (mirrors P1.M2.T4.S1's landed describe). msgs2 = [...msgs1, NEW]; branch2 = [...branch1,
// NEW entries]; SAME marker (persisted). Reference assertions because applyRewind filters by reference.
const view1 = filterPipeline(msgs1, { rewinds: [marker], shrinks: [] }, cfg, branch1);   // fire 1 (full msgs1)
const msgs2 = [...msgs1, asst("new"), result("new")];                                     // agent resumed work
const branch2 = [...branch1, entry("e_new_a", "message"), entry("e_new_r", "message")];
const view2 = filterPipeline(msgs2, { rewinds: [marker], shrinks: [] }, cfg, branch2);   // fire 2 (grown)
expect(view2).not.toContain(msgs2[3]); // STILL hidden (permanent — the BUG-003/001/002 regression guard)
expect(view2).toContain(msgs2[5]);     // new work VISIBLE (no leak-back / no infinite loop)

// PATTERN (b-2): document a KNOWN LIMITATION truthfully. Do NOT assert the desired-but-unimplemented behavior.
//   Assert the ACTUAL safe behavior (first hidden, second visible, no crash, pairing intact) + a comment marking it
//   a known gap with a fix direction. A future implementer who fixes union-composition UPDATES this test.

// PATTERN (d): the checkpoint LEGACY path needs a labelEntry in the branch (resolveCheckpoint reads it to find the
//   target). The label is type:"label" → filtered out of the ctxEntries walk → does not break 1:1 message alignment.
```

### Integration Points

```yaml
EDITS (this task — confined to test/transforms.test.ts):
  - test/transforms.test.ts: +1 top-level describe "checkpoint permanent hiding + multi-rewind composition + pinned/shrink"
                              (5 tests: a / b-1 / b-2 / c / d). ~150 new lines at EOF.

NO SOURCE EDITS. NO NEW FILES. NO NEW DEPS. NO config/API/spec change.
- transforms.ts / markers.ts / tools/rewind.ts / filter.ts / … : ALL READ-ONLY (the fix code is LANDED).
- P1.M3.T2 (smoke assertion enhancement) + P1.M4 (spec/06 sync): LATER subtasks, out of scope.

PARALLEL-COORDINATION:
  - P1.M2.T4.S1 LANDED its describe at test/transforms.test.ts:1654. My describe is appended AFTER it (end of file).
    Both are independent top-level describes with DISTINCT names → no textual collision. If a merge conflict arises on
    the append (both tasks append at EOF), resolve trivially: KEEP BOTH describes (they are independent).
```

---

## Validation Loop

### Level 1: Type-safety (run after Task 1)

```bash
npx tsc --noEmit -p tsconfig.json          # MUST exit 0 (no source change; the new tests type-check under strict)
# NOTE: no eslint/prettier configured (GOTCHA #9). The type+style gate IS tsc. Do NOT run a lint/format command.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the new describe in isolation first (fast feedback):
npx vitest run test/transforms.test.ts -t "checkpoint permanent hiding"   # expect 5 tests green

# Full suite (confirm no regression — baseline 18 files / 701 tests → now 706):
npx vitest run                                                             # expect 18 files / 706 green

# Confirm NO duplication with P1.M2.T4.S1 (both describes present, distinct names):
grep -c 'describe("permanent hiding across fires' test/transforms.test.ts          # expect 1 (P1.M2.T4.S1)
grep -c 'describe("checkpoint permanent hiding' test/transforms.test.ts           # expect 1 (THIS task)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask. filterPipeline is PURE; the multi-fire proof IS the Level-2 regression test. Real-Pi smoke
# enhancement (asserting checkpoint hiding across real context fires) is P1.M3.T2 — out of scope here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# The domain-specific check for THIS task is the multi-fire PERMANENCE pattern + the pairing invariant, both expressed
# as Level-2 unit tests (already in the describe). (b-2) additionally asserts pairing integrity inline (no orphan
# toolResult). No property/quickcheck test needed — the 5 tests are deterministic + scenario-pinned.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 2 passed: `npx vitest run` → 18 files / 706 tests green (701 + 5 new; zero regressions).
- [ ] No lint/format command invented (GOTCHA #9).

### Feature Validation

- [ ] (a) checkpoint pinned permanence: post-checkpoint work hidden fire 1, STILL hidden fire 2, new work visible.
- [ ] (b-1) single-marker multi-span composition: BOTH spans hidden fire 1, STILL hidden fire 2, new work visible.
- [ ] (b-2) separate-marker LIMITATION documented: first hidden, second visible, no crash, pairing intact.
- [ ] (c) pinned + shrink: shrink no-ops on the already-removed target (no "SHRUNK" text).
- [ ] (d) checkpoint legacy: resolveCheckpoint hides post-checkpoint work (unit-snapped toolGroup kept).
- [ ] No duplication with P1.M2.T4.S1 (distinct describe name + scenarios; both present).

### Code Quality Validation

- [ ] Reuses module-scope fixtures + line-2 imports (no redefinition/re-import).
- [ ] LOCAL cfg defined inside the describe (not the closure-local one).
- [ ] (b-2) clearly marked as a KNOWN LIMITATION with a fix direction (not enshrined as desired behavior).
- [ ] Reference-based assertions throughout (applyRewind filters by reference).
- [ ] Comments cite spec_and_test_analysis §KEY QUESTION 3/4 + research/multi_rewind_findings.md.

### Documentation & Deployment

- [ ] No source/config/API/spec change (test-only).
- [ ] The Known Limitation (b-2) is documented in the test comment + this PRP for a future follow-up task.

---

## Anti-Patterns to Avoid

- ❌ Don't edit ANY source file (test-only subtask; the fix code is LANDED).
- ❌ Don't duplicate P1.M2.T4.S1 (last_tool_call_group/last_turn single-span permanence, last_tool_call_group legacy,
  compaction refusal are all already covered).
- ❌ Don't assert "both spans hidden" for two SEPARATE pinned markers (b-2) — it FAILS; document the limitation instead.
- ❌ Don't omit `branchEntries` (4th filterPipeline arg) on pinned-path calls — resolvePinnedHide returns [] (nothing hidden).
- ❌ Don't redefine `asst`/`result`/`user`/`custom`/`entry`/`labelEntry` or the line-2 imports — reuse them.
- ❌ Don't use the closure-local `cfg` from the filterPipeline describe — define a LOCAL one.
- ❌ Don't include a `labelEntry` in pinned-path branches (a/b/c) — resolvePinnedHide doesn't read labels; it only adds
  noise. Include it ONLY in the legacy test (d).
- ❌ Don't expect `result(cp)` removed in test (d) — unit-snap KEEPS the whole checkpoint toolGroup.
- ❌ Don't skip validation because "tests should pass" — run tsc + vitest after appending.

---

## Confidence Score: 10/10 — VERBATIM TEST CODE PROBED EMPIRICALLY

The exact 5 tests above were PROBED against the LANDED `src/transforms.ts` in an isolated vitest harness (importing the
real module): (a) checkpoint permanence — view len 3 → 5, read STILL hidden, new visible ✓; (b-1) single-marker
multi-span — view len 2 (both hidden) ✓; (b-2) separate markers — first hidden, second visible (limitation) ✓; (c)
pinned+shrink — result(A) removed, no "SHRUNK" text ✓; (d) checkpoint legacy — read hidden, toolGroup kept ✓. All
assertions match the probed behavior, so the appended describe will be green on first run. The only nuance is (b-2),
which documents (not enshrines) a genuine implementation limitation — clearly marked with a fix direction for a future
follow-up task. One-pass success is essentially guaranteed (pure append, no source change, probed assertions).