# PRP — P1.M2.T2.S1: `resolvePinnedHide` (pinned stable-anchor hiding — the BUG-001/BUG-002 core fix)

**Work item:** P1.M2.T2.S1 · **Points:** 2 · **Bugfix:** fix_design.md §Change 3 (permanent-hiding resolver)
**Scope:** **APPEND one exported pure function** (`resolvePinnedHide`) to `src/transforms.ts` (between
`isContextProducingType` and `applyRewind`) + **APPEND a new `describe` block** of tests to
`test/transforms.test.ts` (and add `resolvePinnedHide` to the existing import line). **No new files; no new deps;
0 new imports; no other file touched.** This is the pure resolver that turns a marker's PINNED stable entry IDs into
the message-index removal set — the mechanism that makes rewind hiding **permanent across session growth**.

> This is the **resolver** half of the permanent-hiding fix. The PRODUCER (`captureHideEntryIds`, P1.M2.T3) and the
> DISPATCH (`filterPipeline` reads `readOwn(rw,"hideEntryIds")` then calls this fn, P1.M2.T4) are **separate,
> later subtasks — OUT OF SCOPE here**. This task ships ONLY the pure `resolvePinnedHide` + its unit tests.

---

## Goal

**Feature Goal**: Give Mulligan a **pure, Pi-free, never-throws** resolver that maps a SET of stable Pi session
**entry IDs** (pinned at rewind-creation time by `captureHideEntryIds`) to the **current** message-index removal
set, so that hiding is **permanent across session growth** — the root-cause fix for BUG-001 (last_tool_call_group
leak-back) and BUG-002 (last_turn infinite loop). It generalizes `resolveCheckpoint`'s entry→message walk from
"one checkpoint target" to "a set of pinned entry ids", reusing the SAME `entryMessageYield` + `isContextProducingType`
helpers already in the module.

**Deliverable** (append to two existing files, no new files):
1. `src/transforms.ts` — APPEND `export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]` immediately after `isContextProducingType` (line ~559), before the `applyRewind` JSDoc (line ~561). Comprehensive JSDoc (Mode A — docs ride with the work). Reuses `entryMessageYield`/`isContextProducingType`/`isRecord`/`readOwn` (module-private, hoisted). **0 new imports.**
2. `test/transforms.test.ts` — EDIT the import line (add `resolvePinnedHide`) + APPEND a new `describe("resolvePinnedHide — …")` block covering the 5 contract cases (basic, growth stability, compaction refusal, defensive, empty) PLUS alignment-loss refusal, whole-toolGroup pairing-safety, label-id-in-hideSet (caller error), purity/never-throws, and a type test.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the new `resolvePinnedHide` tests **AND** all existing tests (transforms was 134; full suite 671+). Zero regressions.
- `src/transforms.ts` still has **0 imports** (`grep -cE '^import|^from' src/transforms.ts` unchanged — adding a function that reuses module-private helpers adds none).
- `grep -n "export function resolvePinnedHide" src/transforms.ts` → exactly 1 hit.
- The **5 pinned contract cases** pass exactly: (a) basic `[e1,e3]→[0,2]`; (b) growth stability `[e1,e2]→[0,1]` with 2 NEW trailing entries NOT removed; (c) compaction entry → `[]`; (d) non-array inputs → `[]`; (e) empty `hideEntryIds` → `[]`.

---

## User Persona

**Target User**: The implementing AI agents for the two downstream permanent-hiding subtasks:
- **P1.M2.T4** (`filterPipeline` dispatch) — the SOLE caller: `const hide = readOwn(rw, "hideEntryIds"); if (Array.isArray(hide) && hide.length > 0) remove = resolvePinnedHide(m, branchEntries, hide); else <legacy relative fallback>`.
- **P1.M2.T3** (`captureHideEntryIds`) — the PRODUCER whose output (`hideEntryIds: string[]`) this resolver consumes; both sides agree on "stable ENTRY ids, NOT message indices".

**Use Case**: An agent rewinds a bloated `read`. At marker-creation time `captureHideEntryIds` pins the read's
entry id (`e_read`) into `hideEntryIds: ["e_read"]`. The agent then resumes work — reads a DIFFERENT file, which
produces a NEW entry (`e_read2`) with a NEW id. On every subsequent context fire, `filterPipeline` calls
`resolvePinnedHide(messages, branchEntries, ["e_read"])`. Because `e_read2` is NOT in the pinned set, the new
(read-2) message is **visible** (the agent sees its own work), while `e_read` is **still hidden** (permanent). This
is the permanence BUG-001/BUG-002 violated.

**User Journey**:
1. Agent calls `mulligan_rewind(granularity:"last_tool_call_group")`.
2. Tool runs `captureHideEntryIds` → `hideEntryIds: ["e_asst_bad", "e_result_bad"]` (the whole bad toolGroup, pinned as stable entry ids).
3. Tool persists the marker with `hideEntryIds`.
4. Agent resumes → new tool call → new entries (`e_asst_good`, `e_result_good`) appended.
5. Every subsequent `context` fire: `filterPipeline` (P1.M2.T4) sees `hideEntryIds` non-empty → calls `resolvePinnedHide(messages, branchEntries, ["e_asst_bad","e_result_bad"])` → returns the indices of the bad group's messages (STILL the bad group, because ids are stable) → `applyRewind(m, remove)` hides them. The new good work (new ids) is untouched. **Permanent hiding achieved.**

**Pain Points Addressed**: Today, the legacy relative resolvers (`resolveLastToolCallGroup`/`resolveLastTurn`) re-target onto the newest work every fire, so the originally-hidden mistake leaks back and the new work is hidden instead (BUG-001), or the agent's own redo is hidden every fire → infinite loop (BUG-002). `resolvePinnedHide` resolves STABLE ids (not a moving relative spec), so the hidden set is invariant across session growth.

---

## Why

- **This IS the core fix.** fix_design.md's headline recommendation (PRD §Recommendations) is *"Pin rewind targets at marker-creation time (capture the entry ids) instead of re-resolving a relative spec every fire."* `resolvePinnedHide` is the resolver that makes that pinning translate into hidden messages every fire. Without it, the pinned ids are dead data.
- **Entry ids are the stable anchor Pi gives us.** fix_design.md: *"Pi session entries have permanent, stable `id` fields. Messages are derived from entries via `sessionEntryToContextMessages. If we capture the entry ids of the messages to hide at rewind-creation time, those ids remain stable as the session grows. New work produces NEW entries with NEW ids that are NOT in the pinned set → their messages are visible (correct)."* Message INDICES shift on compaction (the message list is compaction-aware; `getBranch()` is not) — which is exactly why the anchor is ids, not indices.
- **Compaction-safe by refusing.** Like `resolveCheckpoint`, the walk refuses (returns `[]`) the moment alignment becomes indeterminate (a compaction entry on the walked range, or the raw branch overshooting the compaction-aware message list). The marker persists and retries next fire; once the session stabilizes the mapping is determinate again. Fail-open, never crashes the turn (spec/08 E13).
- **Cheapest, purest possible change.** One pure function + tests. Reuses the two helpers `resolveCheckpoint` already proved correct. 0 imports, 0 deps, 0 Pi coupling. Fully unit-testable without a session (spec/10 Tier-1).

---

## What

APPEND `resolvePinnedHide` to `src/transforms.ts`. The function:

- **Defensive**: non-array `messages`/`branchEntries`/`hideEntryIds`, or empty `hideEntryIds` → return `[]` (safe no-op; `applyRewind(m, [])` is the documented idempotent no-op — spec/10 §1.4).
- **Builds a `Set<string>`** from `hideEntryIds` (skips non-string/empty ids; dedupes).
- **Filters `branchEntries`** to context-producing types via `isContextProducingType` (message/custom_message/branch_summary/compaction). **NO reverse** — `branchEntries` is already root→leaf (getBranch() order; P1.M1.T1.S1 convention — see GOTCHA #1).
- **Walks ctxEntries with `msgCursor`** (messages consumed so far). For each entry: `yield = entryMessageYield(entry)`; if `yield < 0` (compaction/unknown) → `return []` (refuse); if `msgCursor + yield > messages.length` → `return []` (alignment lost); if the entry's `id` (string) is in the hideSet → push ALL indices `[msgCursor, msgCursor+yield)` into `remove`; then `msgCursor += yield`.
- **Returns `remove`** (ascending by construction — root→leaf walk + monotonic cursor). NEVER null.

This subtask does **NOT**: touch `resolveCheckpoint`/`filterPipeline`/`captureHideEntryIds`/`RewindMarkerLike` (other subtasks' scope); reverse branchEntries; add a unit-snap / rewind-own / note-exclusion step (resolvePinnedHide removes a discrete pinned set, not a contiguous sweep — pairing safety comes from the PRODUCER, see GOTCHA #4); import anything; mutate inputs; or return null.

### Success Criteria

- [ ] `resolvePinnedHide` is **appended** to `src/transforms.ts` between `isContextProducingType` (~559) and `applyRewind` (~561).
- [ ] Signature is EXACTLY `export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]`.
- [ ] Reuses `entryMessageYield` + `isContextProducingType` + `isRecord` + `readOwn` (module-private, hoisted — NOT redeclared).
- [ ] `src/transforms.ts` still has **0 imports** after the append.
- [ ] `test/transforms.test.ts` import line includes `resolvePinnedHide`; a new `describe` block is appended; all-green.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (zero regressions).
- [ ] **(a) basic**: 3 message-entries, hide `[e1,e3]` → `[0,2]`.
- [ ] **(b) growth stability**: hide `[e1,e2]` against a branch with 2 MORE trailing entries → `[0,1]`; the new 2 (idx 2,3) NOT removed (the permanence proof).
- [ ] **(c) compaction refusal**: a branch containing a `compaction` entry → `[]` (entryMessageYield returns -1 → refuse).
- [ ] **(d) defensive**: non-array `messages`/`branchEntries`/`hideEntryIds` → `[]` each.
- [ ] **(e) empty `hideEntryIds`** → `[]`.
- [ ] **alignment loss**: a branch whose entries imply more messages than `messages.length` → `[]`.
- [ ] **whole-toolGroup pairing**: hide `[e_asst, e_result]` → `[1,2]` (both removed → no orphaned toolCall).
- [ ] **label-id-in-hideSet (caller error)**: `hideEntryIds` contains a `label` entry's id → `[]` (label filtered out, never walked).
- [ ] **never throws (E13)**: throwing-Proxy entries / malformed entries → `[]`, no throw.
- [ ] Comprehensive JSDoc documents the algorithm, compaction refusal, and the root→leaf no-reverse walk (Mode A).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `resolvePinnedHide` body to append is given verbatim below (Task 1) and the
> exact tests (Task 2), hand-traced against all 5 contract cases + 4 extras. The two helpers it reuses
> (`entryMessageYield`, `isContextProducingType`) are quoted verbatim with their semantics. The one non-obvious
> landmine — that fix_design.md §Change 3 says `[...].reverse()` but the live code (post-P1.M1.T1.S1) does NOT
> reverse — is documented with line-number evidence (GOTCHA #1). The test fixtures (`entry`, `user`, `asst`,
  `result`, `asstText`, `custom`) are quoted with their exact signatures. No prior knowledge beyond
  "tsc + vitest pass on the current tree; transforms.ts is a 0-import pure module" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — do NOT modify `resolveCheckpoint`, `filterPipeline`, or `RewindMarkerLike`.**
  `resolveCheckpoint` (lines 454–526) is owned by P1.M1.T3.S1 (Complete). `filterPipeline` dispatch + the
  `hideEntryIds` read is P1.M2.T4. `RewindMarkerLike.hideEntryIds` is P1.M2.T1.S1 (in-flight, parallel). Your edit
  is a NEW function in a DISJOPT region (between line ~559 and ~561) — no collision with any of them.
- **Do NOT reverse `branchEntries`.** It is ALREADY root→leaf (getBranch() order). P1.M1.T1.S1 established this for
  `resolveCheckpoint`; the item_description confirms it. fix_design.md §Change 3's `.reverse()` is SUPERSEDED
  (GOTCHA #1 — read it).
- **Do NOT add unit-snap / rewind-own / note-exclusion steps.** Those exist in `resolveCheckpoint` because it
  removes a contiguous SWEEP ("everything after iTarget"). `resolvePinnedHide` removes a DISCRETE pinned SET —
  pairing safety comes from the PRODUCER (`captureHideEntryIds` pins whole units), not this resolver (GOTCHA #4).
- **Do NOT redeclare `entryMessageYield`/`isContextProducingType`/`isRecord`/`readOwn`.** They are module-private
  function declarations, hoisted — reusing them is correct; redeclaring is a TS duplicate-function error.
- **Do NOT make `resolvePinnedHide` return `null`.** Return `number[]` always — `[]` on every refusal. The dispatch
  (P1.M2.T4) checks `Array.isArray(hideEntryIds) && length>0` BEFORE calling, so refusal `[]` must NOT fall back to
  legacy relative resolution (that would re-introduce BUG-001/BUG-002). `[]` → `applyRewind(m,[])` = no-op = the
  pinned marker silently retries next fire (fail-open).
- **Do NOT implement `captureHideEntryIds` or the `filterPipeline` dispatch.** Those are P1.M2.T3 / P1.M2.T4.

### The no-reverse crux (read this — it is the #1 landmine)

`fix_design.md §Change 3` step 2 says: `ctxEntries = [...branchEntries].reverse() // root→leaf`. That comment
ASSUMED `getBranch()` returns leaf→root (hence the `.reverse()` to get root→leaf). **P1.M1.T1.S1 (Complete) then
proved `getBranch()` returns ROOT→LEAF and fixed `resolveCheckpoint` to NOT reverse.** Evidence in the LIVE code:
- transforms.ts:416 — `"ctxEntries = branchEntries directly (already root→leaf — getBranch() order; no internal reverse)"`
- transforms.ts:449 — `"@param branchEntries getBranch() output, ROOT→LEAF … no internal reverse needed"`
- test/transforms.test.ts:748 — `"getBranch() returns ROOT→LEAF (it collects leaf→root then .reverse())"`

**The item_description is authoritative**: *"branchEntries from getBranch() is ROOT→LEAF order (do NOT reverse —
walk in the natural root→leaf order that matches the messages array)."* So `resolvePinnedHide` filters
`branchEntries` DIRECTLY (no `.reverse()`), exactly like the live `resolveCheckpoint`. If you reverse, the walk
maps entry ids to the WRONG message indices and EVERY test fails.

### Documentation & References

```yaml
# MUST READ — authoritative sources for resolvePinnedHide
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  section: "Change 3: New resolver resolvePinnedHide at filter time"
  why: "THE design doc for this exact function. Gives the signature, the algorithm (build Set → filter → walk with
        msgCursor → push [cursor,cursor+yield) for pinned ids → return ascending), the compaction-refuse-on-yield<0
        rule, and the pairing-safety-by-construction rationale."
  critical: "fix_design's step-2 `[...].reverse()` is SUPERSEDED — the live code (P1.M1.T1.S1) does NOT reverse.
        branchEntries is already root→leaf. See GOTCHA #1 + the no-reverse crux above. Implement the algorithm but
        DROP the .reverse()."

- file: src/transforms.ts
  section: "resolveCheckpoint (454-526) + entryMessageYield (549) + isContextProducingType (557)"
  why: "resolvePinnedHide GENERALIZES resolveCheckpoint's walk. Read 454-526 to see the EXACT walk pattern this fn
        mirrors (filter by isContextProducingType, NO reverse, walk with msgCursor, entryMessageYield per entry,
        refuse on yield<0 / overshoot). Read 549 + 557 for the two helpers to REUSE verbatim."
  pattern: "Mirror resolveCheckpoint's defensive style: `if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return <sentinel>`; read every field via isRecord/readOwn; refuse on yield<0."
  gotcha: "resolveCheckpoint returns {remove}|null and BREAKS at the single target. resolvePinnedHide returns number[] (never null), does NOT break (walks the WHOLE branch — a SET may be pinned), and needs NO unit-snap/rewind-own/note exclusion (GOTCHA #4)."

- file: src/transforms.ts
  section: "BranchEntry interface (394) + MessageLike (53)"
  why: "The two exported types resolvePinnedHide's signature uses. A real Pi SessionEntry[] assigns to BranchEntry[]
        with NO cast; a real AgentMessage[] assigns to MessageLike[] with NO cast. transforms.ts is Pi-FREE (0 imports)
        precisely because these are LOCAL structural types."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M1T1S1/PRP.md   # the checkpoint walk-direction fix (Complete)
  why: "Established the root→leaf no-reverse convention that resolvePinnedHide MUST follow. Its research/ dir proves
        getBranch() is root→leaf. Read to understand WHY fix_design's .reverse() was wrong."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T1S1/PRP.md   # the parallel data-model PRP (in-flight)
  why: "Defines the hideEntryIds field shape this resolver consumes. NOTE: resolvePinnedHide takes hideEntryIds as a
        PLAIN parameter (string[]) — it does NOT read the marker field, so it is INDEPENDENT of whether T1.S1 has
        landed. No conflict, no dependency at the function level."

- file: test/transforms.test.ts
  section: "resolveCheckpoint describe block (747+) + fixture builders entry (738), user/asst/result/asstText/custom (9-52)"
  why: "Mirror these EXACT fixtures for the resolvePinnedHide tests. `entry(id, type, extra={})` builds a BranchEntry;
        the message builders are hoisted module-scope. Branches built ROOT→LEAF (test comment at 748 confirms)."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M2T2S1/research/research_summary.md
  why: "First-hand recon: the no-reverse override, the two reusable helpers quoted verbatim, why resolvePinnedHide is
        simpler than resolveCheckpoint (no unit-snap/rewind-own/note exclusion — pairing safety from the producer),
        the insertion point, the 8 traced test cases, the parallel-task boundary."

# AUTHORITATIVE resolvePinnedHide contract (implement EXACTLY this — append to src/transforms.ts):
#   export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]
#     // non-array messages/branchEntries/hideEntryIds OR empty hideEntryIds → [].
#     // hideSet = Set of string ids in hideEntryIds (skip non-string/empty).
#     // ctxEntries = branchEntries.filter(e => isContextProducingType(readOwn(e,"type")))  // NO reverse.
#     // walk msgCursor=0: yield=entryMessageYield(e); yield<0 → return []; msgCursor+yield>len → return [];
#     //   if string id of e ∈ hideSet → push [msgCursor,msgCursor+yield); msgCursor+=yield.
#     // return remove (ascending). NEVER throws. 0 new imports. Reuses entryMessageYield/isContextProducingType.
```

### Current Codebase tree (state at this subtask's start — verified live)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, moduleResolution:'Bundler', include:['src','test']
├── src/
│   ├── transforms.ts       # APPEND resolvePinnedHide between isContextProducingType (~559) and applyRewind (~561).
│   │                       #   Reuses entryMessageYield(549)+isContextProducingType(557)+isRecord(173)+readOwn(178).
│   │                       #   resolveCheckpoint(454)=P1.M1.T3.S1(Complete) DO NOT TOUCH. RewindMarkerLike(814)=P1.M2.T1.S1(parallel) DO NOT TOUCH. filterPipeline(993)=P1.M2.T4 DO NOT TOUCH.
│   ├── markers.ts          # untouched (P1.M2.T1.S1 adds hideEntryIds here, parallel — not our concern).
│   ├── tools/rewind.ts / filter.ts / nudges.ts / config.ts / log.ts / runtime.ts / tokens.ts / ledger.ts / notes.ts / index.ts   # untouched
├── test/
│   └── transforms.test.ts  # EDIT import line (+resolvePinnedHide) + APPEND a describe block. Fixtures: entry(738), user/asst/result/asstText/custom(9-52).
└── plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md  # §Change 3 = authoritative (DROP the .reverse())
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0;
#   `npx vitest run test/transforms.test.ts` → 134 passed. (hideEntryIds/resolvePinnedHide NOT present yet — grep empty.)
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── transforms.ts       # +resolvePinnedHide (exported pure fn + JSDoc). 0 new imports.
└── test/
    └── transforms.test.ts  # +resolvePinnedHide in the import; +1 describe block.
# No new files. No new deps. No package.json change. No spec-doc change (P1.M4 owns spec sync).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — Do NOT reverse branchEntries. fix_design.md §Change 3 step 2 says `[...].reverse()`, but
#   P1.M1.T1.S1 (Complete) PROVED getBranch() is ROOT→LEAF and fixed resolveCheckpoint to NOT reverse. Evidence:
#   transforms.ts:416 + 449, test/transforms.test.ts:748. The item_description confirms: "do NOT reverse — walk in
#   the natural root→leaf order." Filter branchEntries DIRECTLY (ctxEntries = branchEntries.filter(...)). If you
#   reverse, the walk maps ids to the WRONG indices and EVERY test fails.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — REUSE entryMessageYield + isContextProducingType + isRecord + readOwn. They are module-
#   private function declarations (hoisted) ALREADY in the file (549/557/173/178). Reusing them is correct;
#   redeclaring them is a TS duplicate-function error. resolvePinnedHide ADDS ZERO imports (it reuses module scope).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — Return number[] ALWAYS; NEVER null. [] is the refusal/no-op sentinel. resolveCheckpoint
#   returns {remove}|null because its SINGLE consumer does `?.remove ?? []`; resolvePinnedHide returns number[]
#   because its consumer (P1.M2.T4 dispatch) feeds it straight to applyRewind, where [] is the documented idempotent
#   no-op. Returning null would force the dispatch to null-check AND would risk a fallback to legacy relative
#   resolution (which re-introduces BUG-001/BUG-002). Always [].
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — Do NOT add unit-snap / rewind-own / note-exclusion (unlike resolveCheckpoint). Those exist
#   in resolveCheckpoint because it removes a contiguous SWEEP ("everything after iTarget"). resolvePinnedHide
#   removes a DISCRETE pinned SET — pairing safety comes from the PRODUCER (captureHideEntryIds, P1.M2.T3, resolves
#   at UNIT level → pins the WHOLE unit's entry ids: assistant + all its results). So this resolver removes whole
#   units by construction. The mulligan:note + the rewind's own call are NOT in hideEntryIds (capture runs at
#   marker-creation time, BEFORE the note is sent and before the rewind's own call is recorded) → never walked as
#   pinned → never need explicit exclusion.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Compaction refusal rides the entryMessageYield -1 sentinel. compaction IS in isContextProducingType's
#   list (so it passes the filter) BUT entryMessageYield returns -1 for it → the walk returns [] (refuse). This is
#   IDENTICAL to resolveCheckpoint's compaction handling. Test (c) relies on this. Do NOT special-case compaction
#   separately — entryMessageYield already does.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — Do NOT break the walk at the first pinned match. resolveCheckpoint BREAKS at its single checkpoint
#   target; resolvePinnedHide must walk the ENTIRE branch because a SET of entries may be pinned (a whole toolGroup
#   = assistant + results = multiple ids). Push every pinned entry's indices; advance msgCursor every iteration.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — remove is ascending BY CONSTRUCTION (root→leaf walk + strictly-increasing msgCursor). Do NOT sort it
#   (redundant). The `[msgCursor, msgCursor+yield)` push loop preserves order.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — Read entry.id defensively: `const id = isRecord(e) ? readOwn(e, "id") : undefined; if (typeof id ===
#   "string" && hideSet.has(id))`. A non-string/missing id can't be in the string Set → contributes nothing. A
#   throwing-Proxy entry's readOwn swallow returns undefined → contributes nothing, never throws (E13).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — transforms.ts MUST stay Pi-FREE (0 imports). Adding a function that reuses module-local types/helpers
#   CANNOT add an import — verify after: `grep -cE '^import|^from' src/transforms.ts` is unchanged from baseline.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — The insertion point is BETWEEN isContextProducingType (ends ~559) and the applyRewind JSDoc (starts
#   ~561). Do NOT insert inside resolveCheckpoint, inside applyRewind, or at EOF (keep it grouped with the other
#   entry→message resolver + the helpers it reuses). Anchor the edit on the isContextProducingType closing brace.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

```ts
// resolvePinnedHide reuses EXISTING exported types (no new types needed):
//   export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown }   // transforms.ts:53
//   export interface BranchEntry { type: string; id: string; parentId?: string | null; ...; [key: string]: unknown }  // transforms.ts:394
// And reuses EXISTING module-private helpers (hoisted — do NOT redeclare):
//   function entryMessageYield(entry): number   // 1 for message/custom_message/branch_summary; -1 for compaction/unknown
//   function isContextProducingType(type): boolean  // true for message/custom_message/branch_summary/compaction
//   function isRecord(value): value is Record<string, unknown>
//   function readOwn(obj, key): unknown   // Proxy-trap-safe own-property read
// Signature (NEW):
//   export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json                       # expect exit 0
  - RUN: npx vitest run test/transforms.test.ts                  # expect 134 passed
  - RUN: grep -n "export function resolvePinnedHide" src/transforms.ts   # expect NO match (we are ADDING it)
  - RUN: grep -nE "function (entryMessageYield|isContextProducingType)\b" src/transforms.ts  # confirm the 2 helpers exist (reuse, don't redeclare)
  - RUN: grep -cE '^import|^from' src/transforms.ts              # record baseline import count (MUST stay unchanged)

Task 1: APPEND resolvePinnedHide to src/transforms.ts (exact content below — copy verbatim)
  - INSERT: immediately AFTER isContextProducingType's closing brace (~line 559), BEFORE the applyRewind JSDoc (~561).
  - REUSE (do NOT redeclare): entryMessageYield, isContextProducingType, isRecord, readOwn.
  - CONSTRAINTS:
      * Signature EXACTLY: export function resolvePinnedHide(messages: MessageLike[], branchEntries: BranchEntry[], hideEntryIds: string[]): number[]
      * NO reverse of branchEntries (GOTCHA #1). Return number[] ALWAYS, never null (GOTCHA #3).
      * No unit-snap/rewind-own/note exclusion (GOTCHA #4). Compaction refusal via entryMessageYield -1 (GOTCHA #5).
      * Walk the WHOLE branch — do NOT break at first match (GOTCHA #6). remove ascending by construction (GOTCHA #7).
      * Defensive id read via isRecord/readOwn (GOTCHA #8). NEVER throws. 0 new imports (GOTCHA #9).
  - NAMING/PLACEMENT: src/transforms.ts, grouped right after isContextProducingType (the resolver that mirrors resolveCheckpoint).

Task 2: EDIT + APPEND to test/transforms.test.ts
  - EDIT: the existing `from "../src/transforms.js"` import line (line 2) — add `resolvePinnedHide` (alphabetically/
    near the other resolve* fns). ONE import line; do NOT add a second `from` (duplicate-import TS error).
  - APPEND: a new `describe("resolvePinnedHide — …")` block at EOF — exact content below.
  - REUSE fixtures: entry(id, type, extra={}) (line 738), user/asst/result/asstText/custom (lines 9-52). Hoisted.
  - COVERAGE: the 5 contract cases (a-e) + alignment-loss + whole-toolGroup pairing + label-id caller-error +
    purity/never-throws + a type test.
  - NO beforeEach (pure, stateless).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + 0-imports grep) and Level 2 (full vitest run). Levels 3/4 N/A (pure helper, no Pi runtime).
```

#### Exact content to APPEND — `src/transforms.ts` (Task 1 — insert AFTER `isContextProducingType`, BEFORE `applyRewind` JSDoc)

```ts
// ── resolvePinnedHide (pinned stable-anchor hiding; fix_design.md §Change 3; fixes BUG-001/BUG-002) ────

/**
 * resolvePinnedHide — map a SET of PINNED stable entry IDs (captured at marker-creation time by captureHideEntryIds,
 * P1.M2.T3) to the CURRENT message-index removal set, for PERMANENT soft-delete hiding (fix_design.md §Change 3;
 * the core fix for BUG-001/BUG-002). GENERALIZES resolveCheckpoint's entry→message walk (above) from "one checkpoint
 * target" to "a set of pinned entry ids", and from resolveCheckpoint's contiguous "remove everything after iTarget"
 * sweep to a discrete "remove exactly the messages whose entry id is pinned" rule.
 *
 * WHY PINNED IDS (fix_design.md; BUG-001/BUG-002 root cause): the legacy resolvers store a RELATIVE spec
 * ('last tool group' / 'last turn') that filterPipeline RE-RESOLVES against the constantly-growing message list on
 * every context fire. The moment the agent resumes work (the documented, intended usage), new messages are appended
 * and the relative spec re-targets onto the NEW (legitimate) work — un-hiding the originally-hidden mistake and
 * hiding the new work (BUG-001), or hiding the agent's own redo on every fire → infinite loop (BUG-002). Pi session
 * entries have PERMANENT, STABLE `id` fields; captureHideEntryIds pins the entry ids of the span to hide AT
 * marker-creation time. This fn resolves those stable ids → current message indices every fire. New work produces
 * NEW entries with NEW ids NOT in the pinned set → their messages are visible (correct permanence). Message INDICES
 * are NOT a stable anchor (they shift on compaction: the message list is compaction-aware; getBranch() is not) —
 * which is exactly why the anchor is entry IDs, not indices.
 *
 * ALGORITHM (fix_design.md §Change 3; mirrors resolveCheckpoint steps 3–4, generalized):
 *   1. Defensive: non-array messages/branchEntries/hideEntryIds, OR empty hideEntryIds → return [] (safe no-op;
 *      applyRewind(m, []) is the documented idempotent no-op — spec/10 §1.4).
 *   2. Build a Set<string> from hideEntryIds (skip non-string/empty ids; dedupes).
 *   3. ctxEntries = branchEntries filtered to context-producing types (isContextProducingType: message/
 *      custom_message/branch_summary/compaction). branchEntries is ALREADY ROOT→LEAF (getBranch() order; P1.M1.T1.S1
 *      established the no-reverse convention — see resolveCheckpoint's step-3 comment at its line ~416). Do NOT
 *      reverse. (fix_design.md §Change 3's `[...].reverse()` is SUPERSEDED.)
 *   4. Walk ctxEntries with msgCursor (messages consumed so far). For each entry:
 *        yield = entryMessageYield(entry); // 1 for message/custom_message/branch_summary; -1 (indeterminate) for compaction/unknown
 *        if yield < 0 → return [] (compaction/unknown on the walk → entry→message alignment INDETERMINATE → refuse
 *           safely, identical to resolveCheckpoint; the marker persists, content not hidden this fire, no crash).
 *        if msgCursor + yield > messages.length → return [] (raw branch vs compaction-aware messages misalign → refuse).
 *        if the entry's string id ∈ hideSet → push ALL indices [msgCursor, msgCursor+yield) into remove (yield is 1
 *           in practice, so one index per hidden entry; the range is forward-compatible if a future entry type
 *           yields >1 message).
 *        msgCursor += yield. (Do NOT break — a SET of entries may be pinned, e.g. a whole toolGroup.)
 *   5. Return remove (ascending — the root→leaf walk + monotonic msgCursor guarantee it; no sort needed).
 *
 * WHY NO UNIT-SNAP / NO REWIND-OWN / NO NOTE EXCLUSION (unlike resolveCheckpoint): resolveCheckpoint removes a
 * contiguous SWEEP ("everything after iTarget") and so must (a) unit-snap iTarget to avoid orphaning the
 * checkpointed assistant's own results, (b) keep the rewind's own unit, (c) keep mulligan:* notes. resolvePinnedHide
 * removes EXACTLY the pinned entries — a DISCRETE set, not a sweep. Pairing safety comes from the PRODUCER
 * (captureHideEntryIds, P1.M2.T3, resolves at the UNIT level → pins the WHOLE unit's entry ids: assistant + ALL its
 * results), so this resolver removes whole units by construction. The mulligan:note and the rewind's own tool call
 * are NOT in hideEntryIds (capture runs at marker-creation time, BEFORE the marker is persisted + the note sent, and
 * resolves the TARGET span not the rewind's own call) → they are never walked as pinned → never removed.
 *
 * RETURNS `number[]` (NEVER null): the ascending message indices to hide. [] = determinable-but-empty OR refusal
 * (nothing pinned / indeterminate compaction / alignment lost / non-array input). filterPipeline (P1.M2.T4) feeds
 * this straight to applyRewind, where [] is the documented idempotent no-op. Returning [] (not null) is INTENTIONAL:
 * a refused pinned hide must NOT fall back to legacy relative resolution (that re-introduces BUG-001/BUG-002). The
 * P1.M2.T4 dispatch checks `Array.isArray(hideEntryIds) && hideEntryIds.length > 0` BEFORE calling this fn, so the
 * legacy fallback only runs for markers that genuinely LACK hideEntryIds (old markers / capture failure).
 *
 * Pure + defensive: null/non-array messages/branchEntries/hideEntryIds → []; malformed/non-record entries,
 * throwing-Proxy objects, and non-string ids are all handled gracefully — NEVER throws (E13; context-handler hot
 * path via filterPipeline). Every field read goes through the module-private isRecord/readOwn. NEVER imports Pi
 * (purity). REUSES entryMessageYield + isContextProducingType (module-private, hoisted above — do NOT redeclare).
 *
 * @param messages the LLM message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param branchEntries getBranch() output, ROOT→LEAF (getBranch() order; NO internal reverse); non-array → []
 * @param hideEntryIds stable ENTRY ids pinned at marker-creation time (captureHideEntryIds, P1.M2.T3); non-array/empty → []
 * @returns ascending message indices to hide ([] = nothing pinned / refusal / non-array input — safe no-op)
 */
export function resolvePinnedHide(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  hideEntryIds: string[],
): number[] {
  // 1) Defensive: all three must be arrays; hideEntryIds must be non-empty.
  if (!Array.isArray(messages) || !Array.isArray(branchEntries) || !Array.isArray(hideEntryIds)) return [];
  if (hideEntryIds.length === 0) return [];

  // 2) O(1) membership lookup (skips non-string/empty ids; dedupes).
  const hideSet = new Set<string>();
  for (const id of hideEntryIds) {
    if (typeof id === "string" && id.length > 0) hideSet.add(id);
  }
  if (hideSet.size === 0) return []; // hideEntryIds held no usable string ids → nothing to hide

  // 3) ctxEntries = context-producing entries, ROOT→LEAF (getBranch() order — NO reverse; P1.M1.T1.S1 convention).
  const ctxEntries = branchEntries.filter((e) =>
    isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined),
  );

  // 4) Walk in parallel with messages; collect the message indices of every PINNED entry.
  const remove: number[] = [];
  let msgCursor = 0;
  for (const e of ctxEntries) {
    const y = entryMessageYield(e); // 1 for message/custom_message/branch_summary; -1 (indeterminate) for compaction/unknown
    if (y < 0) return []; // compaction (or unknown) on the walked range → alignment INDETERMINATE → refuse safely
    if (msgCursor + y > messages.length) return []; // raw branch vs compaction-aware messages misalign → refuse
    const id = isRecord(e) ? readOwn(e, "id") : undefined;
    if (typeof id === "string" && hideSet.has(id)) {
      for (let j = msgCursor; j < msgCursor + y; j++) remove.push(j); // yield is 1 in practice; range is forward-compatible
    }
    msgCursor += y;
  }

  // 5) remove is ascending by construction (root→leaf walk + monotonic msgCursor). Return it.
  return remove;
}
```

#### Exact edits — `test/transforms.test.ts` (Task 2)

**(2a) EDIT the import** (line 2) — add `resolvePinnedHide` to the existing long import (do NOT add a second `from "../src/transforms.js"`):

```ts
// BEFORE (existing line 2 — excerpt):
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, applyRewind, … } from "../src/transforms.js";

// AFTER (add resolvePinnedHide next to the other resolve* functions):
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, resolvePinnedHide, applyRewind, … } from "../src/transforms.js";
```
*(Keep the rest of the import list EXACTLY as-is — `applyRewind, applyShrink, resolveShrinkTarget, filterPipeline, stableSortBySeq, protectedOk, type Unit, type MessageLike, type BranchEntry, type ShrinkTarget, type RewindMarkerLike, type ShrinkMarkerLike, type MarkerBundle, type ProtectedConfig`. Only INSERT `resolvePinnedHide` after `resolveCheckpoint`.)*

**(2b) APPEND** this `describe` block to the END of `test/transforms.test.ts` (uses the hoisted `entry` fixture at line 738 + the message fixtures at lines 9–52; `BranchEntry` is already imported):

```ts
// ── resolvePinnedHide (fix_design.md §Change 3; permanent-hiding resolver; fixes BUG-001/BUG-002) ────────

describe("resolvePinnedHide — fix_design.md §Change 3 PINNED contract (basic / growth / compaction / defensive / empty)", () => {
  // NOTE (transforms.ts:416, 449; test comment line 748): getBranch() is ROOT→LEAF. We build branchEntries in that
  // order. Each context-producing entry yields exactly 1 message → messages[k] ↔ k-th context-producing entry.

  it("(a) basic — 3 message-entries, hide [e1,e3] → removes their 2 message indices", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1")]; // idx0 user, idx1 asst, idx2 result
    const branch: BranchEntry[] = [
      entry("e1", "message"), entry("e2", "message"), entry("e3", "message"),
    ];
    expect(resolvePinnedHide(msgs, branch, ["e1", "e3"])).toEqual([0, 2]); // e1→idx0, e3→idx2; e2 skipped
  });

  it("(b) growth stability — same hideEntryIds against a branch with 2 MORE trailing entries → same 2 removed, the NEW 2 NOT removed (PERMANENCE — the BUG-001/002 fix)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1"), asst("c2")]; // 4 msgs (e3,e4 are NEW work)
    const branchGrown: BranchEntry[] = [
      entry("e1", "message"), entry("e2", "message"), entry("e3", "message"), entry("e4", "message"),
    ];
    // hide [e1,e2] → [0,1]; the NEW entries e3,e4 (idx 2,3) are NOT in the pinned set → VISIBLE (agent sees its own work)
    expect(resolvePinnedHide(msgs, branchGrown, ["e1", "e2"])).toEqual([0, 1]);
  });

  it("(c) compaction refusal — a branch containing a compaction entry → [] (entryMessageYield returns -1 → refuse)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1")];
    // compaction PASSES isContextProducingType but entryMessageYield(compaction) === -1 → walk returns []
    const branch: BranchEntry[] = [
      entry("e1", "message"), entry("eC", "compaction"), entry("e2", "message"),
    ];
    expect(resolvePinnedHide(msgs, branch, ["e2"])).toEqual([]); // alignment INDETERMINATE → refuse safely
  });

  it("(d) defensive — non-array messages / branchEntries / hideEntryIds → [] each", () => {
    const msgs: MessageLike[] = [user("u")];
    const branch: BranchEntry[] = [entry("e1", "message")];
    expect(resolvePinnedHide("garbage" as unknown as MessageLike[], branch, ["e1"])).toEqual([]);
    expect(resolvePinnedHide(msgs, "garbage" as unknown as BranchEntry[], ["e1"])).toEqual([]);
    expect(resolvePinnedHide(msgs, branch, "garbage" as unknown as string[])).toEqual([]);
    expect(resolvePinnedHide(null as unknown as MessageLike[], branch, ["e1"])).toEqual([]);
    expect(resolvePinnedHide(msgs, null as unknown as BranchEntry[], ["e1"])).toEqual([]);
    expect(resolvePinnedHide(msgs, branch, null as unknown as string[])).toEqual([]);
  });

  it("(e) empty hideEntryIds → []", () => {
    const msgs: MessageLike[] = [user("u")];
    const branch: BranchEntry[] = [entry("e1", "message")];
    expect(resolvePinnedHide(msgs, branch, [])).toEqual([]);
  });

  it("alignment loss — branch entries imply MORE messages than messages.length → [] (refuse)", () => {
    // 1 message but 2 context-producing entries → at e2: msgCursor(1)+yield(1)=2 > 1 → return []
    const msgs: MessageLike[] = [user("u")];
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")];
    expect(resolvePinnedHide(msgs, branch, ["e2"])).toEqual([]);
  });

  it("whole-toolGroup pairing — hide [e_asst, e_result] → both removed → no orphaned toolCall (pairing-safe by construction)", () => {
    // messages: user0, asst(c1)1, result(c1)2, asstText3. captureHideEntryIds pins the WHOLE toolGroup (e_asst+e_result).
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1"), asstText("tail")];
    const branch: BranchEntry[] = [
      entry("e_user", "message"), entry("e_asst", "message"), entry("e_result", "message"), entry("e_tail", "message"),
    ];
    // hiding e_asst AND e_result removes idx1 (call) AND idx2 (result) together → toolGroup fully gone → no orphan
    expect(resolvePinnedHide(msgs, branch, ["e_asst", "e_result"])).toEqual([1, 2]);
    expect(resolvePinnedHide(msgs, branch, ["e_asst", "e_result"])).not.toContain(0); // user kept
    expect(resolvePinnedHide(msgs, branch, ["e_asst", "e_result"])).not.toContain(3); // tail kept
  });

  it("label id in hideEntryIds (caller error) → [] (label is filtered out by isContextProducingType → never walked)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1")];
    const branch: BranchEntry[] = [
      entry("e1", "message"), entry("eL", "label"), entry("e2", "message"),
    ];
    // hideEntryIds names a LABEL entry id → label is not context-producing → filtered out → never walked → remove=[]
    expect(resolvePinnedHide(msgs, branch, ["eL"])).toEqual([]);
  });

  it("hideEntryIds with non-string / empty / duplicate ids → those are ignored (defensive)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1")];
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")];
    // 123 (non-string), "" (empty), and the dup "e1" — only the valid "e1" hides idx0
    const ids = [123, "", "e1", "e1"] as unknown as string[];
    expect(resolvePinnedHide(msgs, branch, ids)).toEqual([0]);
  });

  it("entry id not present in the branch → not removed, no error (id simply never matches)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1")];
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")];
    expect(resolvePinnedHide(msgs, branch, ["nonexistent-id"])).toEqual([]); // no entry matches → remove=[]
  });

  it("malformed / non-record / throwing-Proxy entries → skipped defensively, never throws (E13)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1")];
    const branch = [null, 42, "raw", entry("e1", "message")] as unknown as BranchEntry[]; // garbage + one good entry
    expect(() => resolvePinnedHide(msgs, branch, ["e1"])).not.toThrow();
    // null/42/"raw" → isRecord false → isContextProducingType(undefined) false → filtered out; only e1 walks → idx0
    expect(resolvePinnedHide(msgs, branch, ["e1"])).toEqual([0]);
  });

  it("is pure — calling twice returns the same result (no module state)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1")];
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message"), entry("e3", "message")];
    const a = resolvePinnedHide(msgs, branch, ["e1", "e3"]);
    const b = resolvePinnedHide(msgs, branch, ["e1", "e3"]);
    expect(a).toEqual(b);
    expect(a).toEqual([0, 2]);
  });
});

describe("resolvePinnedHide — types (fix_design.md §Change 3)", () => {
  it("returns number[] for valid inputs; [] for non-array", () => {
    expectTypeOf(resolvePinnedHide([], [], [])).toEqualTypeOf<number[]>();
  });
  it("accepts real-shaped MessageLike[] + BranchEntry[] + string[]", () => {
    const msgs: MessageLike[] = [{ role: "user", content: "hi" }];
    const branch: BranchEntry[] = [{ type: "message", id: "e1", parentId: null, timestamp: "t" }];
    const hide: string[] = ["e1"];
    expectTypeOf(resolvePinnedHide(msgs, branch, hide)).toEqualTypeOf<number[]>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN: mirror resolveCheckpoint's walk, generalized to a SET, returning number[] (never null).
export function resolvePinnedHide(messages, branchEntries, hideEntryIds) {
  if (!Array.isArray(messages) || !Array.isArray(branchEntries) || !Array.isArray(hideEntryIds)) return [];
  if (hideEntryIds.length === 0) return [];
  const hideSet = new Set<string>();
  for (const id of hideEntryIds) if (typeof id === "string" && id.length > 0) hideSet.add(id);
  if (hideSet.size === 0) return [];
  const ctxEntries = branchEntries.filter((e) => isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined)); // NO reverse (GOTCHA #1)
  const remove: number[] = [];
  let msgCursor = 0;
  for (const e of ctxEntries) {
    const y = entryMessageYield(e);              // reuse (GOTCHA #2)
    if (y < 0) return [];                        // compaction/unknown → refuse (GOTCHA #5)
    if (msgCursor + y > messages.length) return []; // alignment lost → refuse
    const id = isRecord(e) ? readOwn(e, "id") : undefined;
    if (typeof id === "string" && hideSet.has(id)) for (let j = msgCursor; j < msgCursor + y; j++) remove.push(j);
    msgCursor += y;                              // do NOT break (GOTCHA #6)
  }
  return remove;                                 // ascending by construction (GOTCHA #7)
}
// GOTCHA #1: NO reverse (getBranch is already root→leaf; P1.M1.T1.S1).   GOTCHA #3: return [], never null.
// GOTCHA #4: no unit-snap/rewind-own/note exclusion (discrete set, not a sweep).  GOTCHA #9: 0 new imports.
```

### Integration Points

```yaml
DOWNSTREAM CONSUMERS (LATER subtasks — do NOT implement here):
  - P1.M2.T4 (filterPipeline dispatch, transforms.ts:993): the SOLE caller. Reads `const hide = readOwn(rw,
      "hideEntryIds")`; if `Array.isArray(hide) && hide.length > 0` → `remove = resolvePinnedHide(m, branchEntries,
      hide)` (NEW permanent path); else legacy relative fallback (resolveLastToolCallGroup/resolveLastTurn/
      resolveCheckpoint). Then `if (!protectedOk(m, remove, config)) continue; m = applyRewind(m, remove)`.
  - P1.M2.T3 (captureHideEntryIds, rewind.ts/markers.ts): the PRODUCER — writes `data.hideEntryIds = [...]` (stable
      ENTRY ids of the whole unit(s) to hide, resolved against buildContextEntries() at marker-creation time).

NO DATABASE / NO ROUTES / NO CONFIG / NO NEW DEPS — resolvePinnedHide is a pure function reusing module-local
helpers. Nothing is added to package.json. No spec-doc change (P1.M4.T1 owns the spec/06 idempotency/resolver sync).
No Pi handle touched (transforms.ts stays Pi-FREE / 0 imports).
```

---

## Validation Loop

### Level 1: Type-safety & scope gates (run after Task 1)

```bash
# Type-check the whole project (the new fn must be type-sound under strict):
npx tsc --noEmit -p tsconfig.json          # MUST exit 0

# The function exists and is exported exactly once:
grep -c "export function resolvePinnedHide" src/transforms.ts   # expect 1
# transforms.ts is STILL Pi-FREE (0 imports — GOTCHA #9; adding a fn reusing module scope adds none):
grep -cE '^import|^from' src/transforms.ts   # MUST equal the baseline count recorded in Task 0
# The two reused helpers still exist (we reused, didn't redeclare — GOTCHA #2):
grep -cE 'function (entryMessageYield|isContextProducingType)\b' src/transforms.ts   # expect 2 (unchanged)
# resolveCheckpoint / filterPipeline / RewindMarkerLike are UNTOUCHED (out-of-scope regions intact):
grep -c "export function resolveCheckpoint" src/transforms.ts   # expect 1 (unchanged)

# Expected: tsc exit 0; resolvePinnedHide exported once; imports unchanged; helpers count = 2. If tsc errors with
# "Duplicate function implementation" for entryMessageYield/isContextProducingType, you REDECLARED them — delete your
# copy and reuse the existing ones (GOTCHA #2).
```

### Level 2: Unit tests (run after Task 2)

```bash
# The transforms suite (existing 134 + the new resolvePinnedHide block):
npx vitest run test/transforms.test.ts        # MUST be all-green

# Full regression — the new pure fn + its tests must NOT change any existing behavior:
npx vitest run                                  # MUST be all-green (671+ tests; zero regressions)

# Expected: every resolvePinnedHide test green. If any fail, debug the ROOT CAUSE — do not weaken asserts.
# Particular attention:
#   - (a) basic [0,2]; (b) growth [0,1] with trailing entries VISIBLE (the permanence proof); (c) compaction → [].
#   - whole-toolGroup [1,2] (pairing-safe). If you got [1] only, you broke the walk early (GOTCHA #6).
#   - If (a) returns [2,0] or wrong indices, you likely REVERSED branchEntries (GOTCHA #1) — remove the .reverse().
```

### Level 3: Integration / runtime (N/A for this change)

This task adds a **pure function** with no Pi handler and no caller yet (the caller is P1.M2.T4). Real end-to-end
permanent hiding across session growth is exercised by the P1.M3 regression tests (P1.M3.T1.S1) once the dispatch
(P1.M2.T4) + capture (P1.M2.T3) land. Nothing to run here beyond Levels 1–2.

### Level 4: Creative / domain-specific validation

```bash
# (Optional) Confirm the entryMessageYield compaction sentinel is what drives refusal (not a separate compaction
# check). In a scratch probe, assert that a branch with a compaction entry reaches `return []` via `y < 0`:
#   - covered by test (c). No additional gate needed for v1.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is fully green (zero regressions — the new fn is unread by existing code).
- [ ] `grep -cE '^import|^from' src/transforms.ts` unchanged from baseline (still Pi-FREE / 0 imports — GOTCHA #9).
- [ ] `resolvePinnedHide` exported exactly once, between `isContextProducingType` and `applyRewind`.

### Feature Validation
- [ ] **(a)** basic `[e1,e3]→[0,2]`; **(b)** growth stability `[e1,e2]→[0,1]` with new trailing entries NOT removed; **(c)** compaction → `[]`; **(d)** non-array inputs → `[]`; **(e)** empty → `[]`.
- [ ] alignment-loss → `[]`; whole-toolGroup `[e_asst,e_result]→[1,2]` (pairing-safe); label-id-in-hideSet → `[]`.
- [ ] Returns `number[]` ALWAYS (never null); never throws on malformed/Proxy inputs (E13).
- [ ] Did NOT reverse branchEntries (GOTCHA #1); did NOT break the walk at first match (GOTCHA #6).

### Code Quality Validation
- [ ] Mirrors `resolveCheckpoint`'s defensive walk style (Array.isArray guards, isRecord/readOwn, refuse on yield<0).
- [ ] Reuses `entryMessageYield`/`isContextProducingType`/`isRecord`/`readOwn` (no redeclaration).
- [ ] Anti-patterns avoided (see below — no reverse, no null, no unit-snap, no out-of-scope edits, no new imports).
- [ ] No new dependencies; no package.json change.

### Documentation & Deployment
- [ ] Comprehensive JSDoc on `resolvePinnedHide` (Mode A): algorithm, compaction refusal, root→leaf no-reverse walk, why-no-unit-snap.
- [ ] No spec-doc change required here (P1.M4.T1 owns the spec/06 idempotency/resolver sync).
- [ ] No new environment variables.

---

## Anti-Patterns to Avoid

- ❌ **Reversing `branchEntries`** — it is ALREADY root→leaf (getBranch() order; P1.M1.T1.S1). fix_design.md's `.reverse()` is SUPERSEDED. Reversing maps ids to wrong indices; every test fails (GOTCHA #1).
- ❌ **Returning `null`** — return `number[]` always; `[]` is the refusal/no-op. null forces a null-check + risks a legacy fallback that re-introduces BUG-001/BUG-002 (GOTCHA #3).
- ❌ **Adding unit-snap / rewind-own / note exclusion** — those are for resolveCheckpoint's contiguous SWEEP. resolvePinnedHide removes a DISCRETE pinned set; pairing safety comes from the PRODUCER (captureHideEntryIds pins whole units). Adding them here is wrong + noisy (GOTCHA #4).
- ❌ **Redeclaring `entryMessageYield`/`isContextProducingType`/`isRecord`/`readOwn`** — they are module-private + hoisted; reuse them. Redeclaring is a TS duplicate-function error (GOTCHA #2).
- ❌ **Breaking the walk at the first pinned match** — a SET of entries may be pinned (a whole toolGroup = assistant + results). Walk the entire branch (GOTCHA #6).
- ❌ **Touching `resolveCheckpoint` / `filterPipeline` / `RewindMarkerLike`** — those belong to P1.M1.T3.S1 (Complete) / P1.M2.T4 / P1.M2.T1.S1 (parallel). Stay in your lane (the new fn, disjoint region).
- ❌ **Adding an import to transforms.ts** — it must stay Pi-FREE / 0 imports. A fn reusing module scope can't add one, but verify (GOTCHA #9).
- ❌ **Implementing `captureHideEntryIds` or the `filterPipeline` dispatch here** — those are P1.M2.T3 / P1.M2.T4. This task is the pure resolver + its tests only.
- ❌ **Skipping the full `vitest run`** — "it's a pure additive fn, it can't break anything" is exactly the assumption that lets an out-of-scope edit slip through. Run the whole suite.

---

## Confidence Score

**9.5/10** for one-pass implementation success. The exact `resolvePinnedHide` body and the full test block are given
verbatim (copy-pasteable). The function was **hand-traced against all 5 contract cases + 4 extras** (research/
research_summary.md). The two reused helpers (`entryMessageYield`, `isContextProducingType`) are quoted verbatim with
their exact semantics. The #1 landmine — fix_design.md's `.reverse()` being SUPERSEDED by the live no-reverse
convention — is documented with line-number evidence and a dedicated GOTCHA. The one residual risk (‑0.5): the test
fixtures (`entry`, `user`, `asst`, `result`, `asstText`, `custom`) must be referenced exactly as defined (hoisted at
lines 9–52 + 738) — if an implementer mis-renames one, a couple of tests would fail to compile; the PRP quotes each
signature to prevent that. There is **no runtime/Pi risk** (pure function, no caller yet; the caller is P1.M2.T4).