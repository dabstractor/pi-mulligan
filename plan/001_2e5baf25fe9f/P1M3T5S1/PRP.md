# PRP — P1.M3.T5.S1: `filterPipeline` + `stableSortBySeq` + `protectedOk` (the composition core)

**Work item:** P1.M3.T5.S1 · **Points:** 2 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND FOUR exported functions (`filterPipeline`, `stableSortBySeq`, `protectedOk`) + ONE module-private
helper (`readOwnSeq`) + FOUR exported LOCAL structural types (`RewindMarkerLike`, `ShrinkMarkerLike`, `MarkerBundle`,
`ProtectedConfig`) to the EXISTING `src/transforms.ts`** and **APPEND ONE top-level `describe` block (+ a one-line
import edit) to the EXISTING `test/transforms.test.ts`.** **No new file, no other file touched.** Adds **ZERO
imports** (`grep -c '^import' src/transforms.ts` → stays **0** — the module is Pi-free). Reuses the LANDED
`partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`, `applyRewind`, `applyShrink`,
`ShrinkTarget`, `MessageLike`, `Unit`, `BranchEntry`, + the module-private `isRecord`/`readOwn` only. This is **T5.S1,
the FINAL step of the `transforms.ts` build** (spec/11 §2 Step 3): it ships the **composition core** — the single PURE
entry point the `context` handler (`filter.ts`, P1.M4.T2) calls: `return { messages: filterPipeline(event.messages,
readMarkers(ctx), config, branchEntries) }`.

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** Treat the four earlier pure-core tasks + `applyShrink` (T4.S2) as
> **hard contracts that have LANDED** (verified live this session — `src/transforms.ts` is 764 lines, import count
> **0**, `tsc` exit 0, `vitest` **107 transforms tests / full suite green**). Concretely, when THIS task runs:
> 1. **`src/transforms.ts`** already contains `partitionIntoUnits`, `Unit`, `MessageLike`, `ContentBlock`, the
>    module-private `isRecord`/`readOwn`/`assistantIssuedCall`/`isMulliganCustomMessage`/`entryMessageYield`/
>    `isContextProducingType`, `resolveLastToolCallGroup`, `resolveLastTurn`, `BranchEntry`, `resolveCheckpoint`,
>    `applyRewind`, AND (from T4.S2) `ShrinkTarget`, `resolveShrinkTarget`, `applyShrink`, `stringifyContent` at the tail.
> 2. **`test/transforms.test.ts`** import line already includes `applyShrink`, `resolveShrinkTarget`, `type ShrinkTarget`
>    (T4.S2's edit) — the fixtures `asst`/`asstText`/`result`/`user`/`custom` + `expectPairingInvariant` are all defined.
>
> This task **APPENDS** `filterPipeline` + `stableSortBySeq` + `protectedOk` + `readOwnSeq` + the four LOCAL types to
> the END of `src/transforms.ts` (after `applyShrink`/`stringifyContent`) and **APPENDS one top-level `describe` block**
> to the END of `test/transforms.test.ts` (+ one import-line edit adding the new symbols). Do NOT recreate, redefine, or
> re-import any symbol — `partitionIntoUnits`/`resolveLastToolCallGroup`/`resolveLastTurn`/`resolveCheckpoint`/
> `applyRewind`/`applyShrink`/`ShrinkTarget`/`MessageLike`/`Unit`/`BranchEntry`/`isRecord`/`readOwn` are already in
> module scope.

> **THE LOAD-BEARING FACT (read before coding):** spec/06 §12's pipeline pseudocode has a **STALE-INDEX BUG**: it
> partitions `const units = partitionIntoUnits(m);` ONCE before the rewind loop, but `resolveLastToolCallGroup(units,
> m, …)` returns `unit.indices` that index the array `units` was built from — and `m` is REDUCED by each `applyRewind`.
> After rewind#1, rewind#2's `unit.indices` point at the OLD array → `applyRewind(reducedM, staleIndices)` removes the
> wrong messages. **THE FIX (what `filterPipeline` implements): re-partition FRESH inside the loop, only for each
> `last_tool_call_group` rewind** (`const units = partitionIntoUnits(m);` per rewind). `resolveLastTurn` and
> `resolveCheckpoint` take `messages` directly (not units) and are inherently correct against the current `m`. Full
> proof + the §11 erratum + idempotency analysis: §"Known Gotchas" + `research/verification.md`.

---

## Goal

**Feature Goal**: Ship Mulligan's **composition core** — `filterPipeline`, `stableSortBySeq`, and `protectedOk`
(spec/06-context-filter.md §1, §5, §8, §11, §12; spec/03-architecture.md §5 ordering/composition/idempotency). It is
the single PURE entry point that composes every persisted marker into the filtered message view the model sees:
**rewinds oldest-first (each resolved against the current, already-reduced array, gated by `protectedOk`, then
`applyRewind`), then shrinks oldest-first (`applyShrink`), then return.** `stableSortBySeq` orders markers by their
monotonic per-session `seq` (oldest-first, stable). `protectedOk` is the filter's defense-in-depth check that a
rewind's removal set never crosses the first-user (original-task) boundary (`min(remove) > iFirstUser` — spec/06 §8
verbatim). All three are pure, total, side-effect-free, and add ZERO imports.

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (file already exists, 764 lines, 0 imports): the EXPORTED `RewindMarkerLike`,
   `ShrinkMarkerLike`, `MarkerBundle`, `ProtectedConfig` types (LOCAL structural declarations — see GOTCHA #1), the
   EXPORTED `stableSortBySeq`, `protectedOk`, `filterPipeline`, and ONE module-private `readOwnSeq`. **NO new
   imports** (reuse everything already in module scope). File import count stays **0**.
2. `test/transforms.test.ts` — APPEND (file already exists, 107 tests green): MODIFY the import line to add
   `filterPipeline`, `stableSortBySeq`, `protectedOk`, `type RewindMarkerLike`, `type ShrinkMarkerLike`,
   `type MarkerBundle`, `type ProtectedConfig`, and ADD one new top-level
   `describe("filterPipeline / stableSortBySeq / protectedOk — spec/10 §1.9 + §3", …)` block (with nested
   `describe`s for each function + the property tests).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the existing transforms suite AND the appended block; no pre-existing suite
  regresses (append-only to one src file + one test file).
- `filterPipeline` / `stableSortBySeq` / `protectedOk` **never throw** (E13; they sit on the `context` handler hot
  path) — non-array `messages`, non-record `markers`/config, malformed markers, and throwing-Proxy messages are all
  handled gracefully.
- **spec/10 §1.9 composition tests** pass: (a) two rewinds compose (rewind#1 removes the mistake; rewind#2 re-resolves
  against the reduced array and no-ops) → exact resulting set; (b) rewind-then-shrink-on-removed-target → shrink
  no-ops; (c) protected message → rewind skipped.
- **spec/10 §3 property tests** pass (seeded, deterministic): pairing invariant (no orphan toolCall/toolResult on
  random inputs), monotonic shrinkage (rewind never increases count), shrink idempotency
  (`filterPipeline(filterPipeline(m)) === filterPipeline(m)` for shrinks), and determinism (same input → same output).
- `grep -c '^import' src/transforms.ts` → **0** (the Pi-free invariant — declare types LOCALLY, do NOT import
  `RewindMarker`/`ShrinkMarker`/`MulliganConfig` from `markers.ts`/`config.ts`).

---

## User Persona

**Target User**: The implementing AI agent for `filter.ts` (P1.M4.T2) — the **single pure-tier consumer**. The
`context` handler reads markers via `readMarkers(ctx)`, deep-copies `event.messages`, and calls
`messages = filterPipeline(messages, markers, config, branchEntries)`; it wraps that in try/catch fail-open, caches the
result as `rt.lastFiltered` for `mulligan_audit`, injects the per-turn nudge AFTER (the nudge is `filter.ts`'s concern,
NOT this pure pipeline), and returns `{ messages }`. The SECOND consumer is the test suite (this PRP). (`mulligan_audit`
P1.M5.T4 reads `rt.lastFiltered`, not this fn directly.)

**Use Case**: The agent called `mulligan_rewind(granularity:"last_tool_call_group", excludeToolCallId:"call_R1")` after
a bad grep, then later `mulligan_shrink({by_tool_call_id:"call_42"}, "[3 files]")` on a bloated read. Both markers
persist. Next inference → `context` → `filterPipeline(event.messages, {rewinds:[…], shrinks:[…]}, config, branchEntries)`:
rewinds oldest-first (re-partition each, resolve, `protectedOk` gate, `applyRewind`), then shrinks oldest-first
(`applyShrink`), then return. The model sees `[kept prefix] + [mulligan:note] + [rewind confirmation]` with the bloated
read compacted — pairing intact, the original task (first user) never removed.

**User Journey**:
1. `readMarkers(ctx)` (P1.M4.T2) builds `{ rewinds: RewindMarker[], shrinks: ShrinkMarker[] }` (a real MarkerBundle).
2. `filterPipeline(messages, markers, config, branchEntries)` — **this function** — applies rewinds oldest-first
   (re-partitioning per `last_tool_call_group` rewind, gating each with `protectedOk`), then shrinks oldest-first.
3. `filter.ts` caches the result as `rt.lastFiltered`, injects the nudge if warranted, returns `{ messages }`.

**Pain Points Addressed**: The agent accumulated permanent control state (rewind + shrink markers) that must compose
DETERMINISTICALLY into one filtered view every inference — oldest-first, each rewind resolving against the
already-reduced array, never crossing the protected first-user line, never orphaning a tool pair, never throwing.
`filterPipeline` is the one pure function that owns that composition so `filter.ts` stays thin glue.

---

## Why

- **Ships the composition core end-to-end (at the pure tier).** Every resolver (`partitionIntoUnits`,
  `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`) and applicator (`applyRewind`, `applyShrink`) has
  landed; this task WIRES them in the spec-mandated fixed order (rewinds → shrinks — spec/03 §5) with the
  `stableSortBySeq` oldest-first ordering and the `protectedOk` defense-in-depth gate. After this, `filter.ts`
  (P1.M4.T2) is pure glue.
- **Correct composition by re-partitioning.** The spec/06 §12 pseudocode's partition-once is a stale-index bug for
  multi-rewind composition; `filterPipeline` re-partitions fresh per `last_tool_call_group` rewind so `unit.indices`
  always index the CURRENT array. This is the difference between correct and subtly-wrong composition.
- **Protected by defense-in-depth.** `protectedOk` is the filter's double-check (spec/06 §8) that no rewind crosses
  the first-user (original-task) boundary — fail-safe (enforce when in doubt), never throws.
- **Deterministic + idempotent-by-re-fire.** `stableSortBySeq` makes marker order independent of timestamp ties;
  the pure pipeline is deterministic (same input → same output), so re-firing the filter on an unchanged session
  reproduces the same view (spec/03 §5 / spec/06 §11).
- **Pure-core tier & unit-testable in isolation.** Adds **NO new imports**. Pure, deterministic, side-effect-free,
  covered by fast unit + property tests with no Pi, no model, no session (spec/10 §1.9 + §3; spec/03 §7).

---

## What

APPEND `RewindMarkerLike` + `ShrinkMarkerLike` + `MarkerBundle` + `ProtectedConfig` + `stableSortBySeq` + `protectedOk`
+ `filterPipeline` (+ module-private `readOwnSeq`) to `src/transforms.ts`, and APPEND one top-level `describe` block
(+ a one-line import edit) to `test/transforms.test.ts`.

**`RewindMarkerLike`** (LOCAL structural — GOTCHA #1): the slice of a persisted `RewindMarker` that `filterPipeline`
reads — `{ seq: number; granularity: "last_tool_call_group" | "last_turn" | "checkpoint"; options?: { to_previous_prompt?: boolean }; excludeToolCallId?: string; checkpoint?: string }`. A real `markers.ts` `RewindMarker` assigns in with NO cast.

**`ShrinkMarkerLike`**: `{ seq: number; target: ShrinkTarget; replacement: string }` (adds `seq` to `applyShrink`'s
`{target, replacement}`). A real `ShrinkMarker` assigns in with NO cast.

**`MarkerBundle`**: `{ rewinds: RewindMarkerLike[]; shrinks: ShrinkMarkerLike[] }` (the `readMarkers` output MINUS the
turn-metric, which the nudge injector consumes — NOT this pipeline).

**`ProtectedConfig`** (LOCAL structural): `{ rewind: { protectedRoles: string[] } }` (the slice `protectedOk` reads).
A real `MulliganConfig` assigns in with NO cast.

**`stableSortBySeq<T extends { seq?: unknown }>(markers: T[]): T[]`**: return a NEW array sorted ASCENDING by `seq`
(oldest-first), stable. Non-array → `[]`; non-finite/non-number `seq` → 0; throwing-Proxy-safe (reads via `readOwn`).
Never mutates the input.

**`protectedOk(messages, remove, config): boolean`**: the spec/06 §8 first-user defense-in-depth check. Empty/non-array
`remove` → `true`. `iFirstUser` = first `role==="user"`; none → `true`. Honor `"first:user"` when present in
`config.rewind.protectedRoles` (default YES); empty/absent/malformed → **FAIL SAFE: enforce**. `min(remove) > iFirstUser`
→ `true`, else `false` (non-number/NaN entries ignored). Never throws.

**`filterPipeline(messages, markers?, config?, branchEntries?): MessageLike[]`** (spec/06 §1/§12; spec/03 §5):
non-array `messages` → `[]`. Read `rewinds`/`shrinks` defensively from `markers` (non-record → `[]`).
1. **REWINDS** oldest-first (`stableSortBySeq`): per rewind, dispatch by `granularity` —
   `last_tool_call_group` → **re-partition fresh** (`partitionIntoUnits(m)`) then `resolveLastToolCallGroup(units, m,
   excludeId) ?? []`; `last_turn` → `resolveLastTurn(m, options, excludeId).remove`; `checkpoint` →
   `resolveCheckpoint(m, branchEntries ?? [], checkpoint, excludeId)?.remove ?? []`; unknown → `[]`. Gate with
   `protectedOk(m, remove, config)` (skip on false). `m = applyRewind(m, remove)`.
2. **SHRINKS** oldest-first (`stableSortBySeq`), on the post-rewind array: `m = applyShrink(m, sh)` per shrink.
3. Return `m` (SAME reference as `messages` when no marker transforms anything).

This subtask does **NOT**: implement `filter.ts`/`readMarkers`/`applyRewindSafe`/`applyShrinkSafe`/`injectNudge`/
`shouldNudge` (later P1.M4/P1.M6 subtasks); import anything (the file is foundation-tier pure); redefine
`partitionIntoUnits`/`resolveLastToolCallGroup`/`resolveLastTurn`/`resolveCheckpoint`/`applyRewind`/`applyShrink`/
`ShrinkTarget`/`MessageLike`/`Unit`/`BranchEntry`/`isRecord`/`readOwn` (reuse them); take `ctx` (ExtensionContext —
purity; checkpoint rewinds take `branchEntries: BranchEntry[]` DATA, not `ctx`); mutate `messages` or the markers; or
import `RewindMarker`/`ShrinkMarker`/`MulliganConfig`/`Granularity` from `markers.ts`/`config.ts` (breaks the Pi-free
invariant — declare the four types LOCALLY, GOTCHA #1).

### Success Criteria

- [ ] `src/transforms.ts` EXPORTS `RewindMarkerLike`, `ShrinkMarkerLike`, `MarkerBundle`, `ProtectedConfig` (types),
      `stableSortBySeq`, `protectedOk`, `filterPipeline` and has **NO new imports** (`grep -c '^import'` → **0**); one
      new module-private `readOwnSeq`.
- [ ] `test/transforms.test.ts` has a new top-level `describe` block; the import line now includes the 3 new fns + 4
      new types; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **spec/10 §1.9 (composition):** two rewinds compose (rewind#1 removes the mistake; rewind#2 no-ops) → exact
      resulting set; rewind-then-shrink-on-removed-target → shrink no-ops; protected message → rewind skipped.
- [ ] **spec/10 §3 (property, seeded):** pairing invariant (no orphans on random inputs); monotonic shrinkage
      (rewind never increases count); shrink idempotency (`filterPipeline(filterPipeline(m)) === filterPipeline(m)`);
      determinism (same input → same output).
- [ ] **Defensive / never throws (E13):** non-array `messages` → `[]`; non-record `markers`/config → pass-through /
      fail-safe; malformed markers + throwing-Proxy messages never crash.
- [ ] **Purity:** `filterPipeline` never mutates its `messages` input or the markers.
- [ ] **Signatures exact:** `stableSortBySeq<T extends { seq?: unknown }>(markers: T[]): T[]`;
      `protectedOk(messages: MessageLike[], remove: number[], config: ProtectedConfig | undefined): boolean`;
      `filterPipeline(messages: MessageLike[], markers: MarkerBundle | undefined, config: ProtectedConfig | undefined,
      branchEntries?: BranchEntry[]): MessageLike[]`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `filterPipeline` + `stableSortBySeq` + `protectedOk` + `readOwnSeq` + the four
> LOCAL types to APPEND are given verbatim below (Task 1), and the exact tests + import edit are given verbatim
> (Task 2). The algorithm is spec-pinned (spec/06 §1/§5/§8/§11/§12 + spec/03 §5 — quoted in the JSDoc +
> `research/spec_extracts.md`); the three §1.9 composition cases + the four §3 property tests are spec/10 §1.9/§3.
> The load-bearing non-obvious bits — **re-partition per `last_tool_call_group` rewind** (the §12 pseudocode
> partition-once is a stale-index bug) and the **§11 erratum** (its two-rewind narrative is mechanically impossible
> under §3's exclude-own-call rule) — are motivated + specified in GOTCHA #2/#3. The only prerequisite is that the
> four earlier P1.M3 tasks + `applyShrink` (T4.S2) have landed their symbols in `src/transforms.ts` (the
> parallel-execution contract — verified live). No prior knowledge beyond "this APPENDS pure symbols to the existing
> transforms module and APPENDS their tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (764 lines, 0 imports; `applyShrink`/`stringifyContent` land at
  the tail via T4.S2).** Ship the four LOCAL types + `stableSortBySeq` + `protectedOk` + `filterPipeline` + the
  module-private `readOwnSeq`. REUSE everything in scope — do NOT redefine or re-import. This is the FINAL append to
  `transforms.ts` (the build is complete after T5.S1).
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (107 tests green).** Add ONE new top-level `describe`
  block + MODIFY the import line (7 new tokens). Reuse the fixture helpers already defined: `asst`, `asstText`,
  `result`, `user`, `custom`. Do NOT redefine any fixture or helper.

### Documentation & References

```yaml
# MUST READ — the pipeline contract (the authoritative pseudocode — NOTE its 2 bugs, fixed in filterPipeline)
- url: spec/06-context-filter.md §1 (L9-42) + §12
  why: §1 = the handler glue + the stableSortBySeq oldest-first ordering ("later rewinds resolve against an
       already-reduced list"); §12 = the full pipeline pseudocode (rewinds → shrinks → nudge). filterPipeline implements
       §12 MINUS the nudge (filter.ts's concern) and with TWO FIXES (GOTCHA #2 re-partition; §6 takes branchEntries not ctx).
  critical: "§12 partitions `const units = partitionIntoUnits(m);` ONCE before the loop — a STALE-INDEX BUG after the
       first rewind reduces m (resolveLastToolCallGroup returns unit.indices that index the ORIGINAL m). FIX: re-partition
       FRESH inside the loop per last_tool_call_group rewind. §12's resolveCheckpoint takes ctx; the LANDED pure
       resolveCheckpoint takes branchEntries — pass branchEntries, NOT ctx."

# MUST READ — protected messages (the protectedOk contract, VERBATIM)
- url: spec/06-context-filter.md §8
  why: "compute iFirstUser and iLatestUser; a rewind's remove set MUST satisfy min(remove) > iFirstUser; for
       to_previous_prompt, refuse if iLatestUser === iFirstUser." protectedOk enforces min(remove) > iFirstUser
       (the first:user boundary); the latest:user boundary + nuclear refusal are construction-enforced in resolveLastTurn.
  critical: "protectedOk is the filter's DOUBLE-CHECK (defense-in-depth). It CANNOT be triggered to BLOCK by the real
       resolvers (they never cross iFirstUser by construction) — its block is for a hypothetical buggy/adversarial
       resolver. Test it via direct unit tests + assert the pipeline preserves the first user."

# MUST READ — the tier-1 test contract for THIS function
- url: spec/10-testing.md §1.9 (L36-38) + §3 (Lproperty/invariant)
  why: §1.9 = the 3 composition cases (two rewinds compose; rewind-then-shrink-on-removed no-ops; protected → skipped);
       §3 = the property tests (pairing invariant; idempotency; monotonic shrinkage). The item REQUIRES the §3 property tests.
  critical: "§1.9 bullet 1 says 'two rewinds compose to the example in §11' — but §11 is an ERRATUM (GOTCHA #3): its
       narrative is mechanically impossible under §3's exclude-own-call rule. The test uses a CLEAN, mechanically-correct
       composition scenario (rewind#1 removes the mistake; rewind#2 no-ops) and asserts its exact result. Do NOT chase
       the §11 narrative. §3's 'filterPipeline(filterPipeline(m))===filterPipeline(m)' holds for SHRINKS (assert it) but
       NOT in general for last_tool_call_group rewinds under live re-resolution — assert determinism + shrink idempotency
       instead (GOTCHA #8)."

# MUST READ — ordering/composition/idempotency (the architecture rationale)
- url: spec/03-architecture.md §5
  why: "fixed order: 1 rewinds oldest-first (each mutates the working array; later rewinds resolve against the
       already-reduced array), 2 shrinks oldest-first on the post-rewind array, 3 nudge, 4 return. Idempotent w.r.t.
       re-firing (rewind whose target already removed → empty range → no-op; shrink whose target gone → no-op)."
  critical: "The 'each removal mutates the working array; later rewinds resolve against the already-reduced array' line
       is EXACTLY why re-partitioning per rewind is required (GOTCHA #2). The nudge (step 3) is filter.ts's concern —
       filterPipeline transforms MARKERS ONLY (rewinds + shrinks)."

# MUST READ — the marker shapes filterPipeline reads
- url: spec/04-data-model.md §3 (RewindMarker) + §4 (ShrinkMarker) + §7 (config.rewind.protectedRoles)
  why: The fields filterPipeline reads (granularity, options.to_previous_prompt, excludeToolCallId, seq for rewind;
       target, replacement, seq for shrink; rewind.protectedRoles for config). NOTE: spec/04 §3 RewindMarker has NO
       `checkpoint` field, but spec/06 §12 + spec/05 §1 require it for checkpoint granularity — read it defensively via
       readOwn (absent → checkpoint no-ops).
  critical: "markers.ts ALREADY exports RewindMarker/ShrinkMarker and config.ts exports MulliganConfig — but transforms.ts
       must NOT import them (Pi-free). Declare the four types LOCALLY (structurally identical — GOTCHA #1). A real
       RewindMarker/ShrinkMarker/MulliganConfig assigns into the LOCAL type with NO cast."

# REFERENCE — the LANDED sibling functions (signatures verified live this session — research/verification.md §1)
- file: src/transforms.ts
  why: partitionIntoUnits(messages): Unit[]; resolveLastToolCallGroup(units, messages, excludeToolCallId?): number[]|null
       (takes UNITS first); resolveLastTurn(messages, opts, excludeToolCallId?): {remove}; resolveCheckpoint(messages,
       branchEntries, checkpointName, excludeToolCallId?): {remove}|null; applyRewind(messages, remove): MessageLike[]
       (no-op → SAME ref); applyShrink(messages, {target, replacement}): MessageLike[] (no-op → SAME ref).
  gotcha: "resolveLastToolCallGroup takes UNITS (partitioned) as its FIRST param — so filterPipeline must partition
       fresh before calling it (GOTCHA #2). resolveLastTurn/resolveCheckpoint take messages directly (no partition)."

# REFERENCE — the parallel-execution sibling PRPs (the contracts this builds on)
- file: plan/001_2e5baf25fe9f/P1M3T4S1/PRP.md (applyRewind) + P1M3T4S2/PRP.md (applyShrink)
  why: applyRewind's no-op-same-ref convention + applyShrink's structural {target, replacement} marker type (GOTCHA #4) +
       the LOCAL ShrinkTarget convention (GOTCHA #1). filterPipeline MIRRORS both conventions.
```

### Current Codebase tree (relevant slice)

```bash
src/
  transforms.ts        # EXISTS (764 lines, 0 imports) — partitionIntoUnits, Unit, MessageLike, ContentBlock,
                       #   resolveLastToolCallGroup, resolveLastTurn, BranchEntry, resolveCheckpoint, applyRewind,
                       #   ShrinkTarget, resolveShrinkTarget, applyShrink + module-private isRecord/readOwn/
                       #   assistantIssuedCall/isMulliganCustomMessage/entryMessageYield/isContextProducingType/stringifyContent.
                       #   ← APPEND RewindMarkerLike + ShrinkMarkerLike + MarkerBundle + ProtectedConfig + stableSortBySeq
                       #     + protectedOk + filterPipeline + readOwnSeq AT THE END (after applyShrink/stringifyContent).
                       #     0 new imports.
  config.ts            # EXISTS (Pi-FREE) — exports MulliganConfig + DEFAULT_CONFIG (rewind.protectedRoles default
                       #   ["first:user","latest:user"]). DO NOT import into transforms.ts (Pi-free invariant). The LOCAL
                       #   ProtectedConfig is structurally identical; a real MulliganConfig assigns in with no cast.
  markers.ts           # EXISTS (Pi-coupled) — exports RewindMarker/ShrinkMarker/ShrinkTarget. DO NOT import into
                       # transforms.ts. The LOCAL RewindMarkerLike/ShrinkMarkerLike are structurally identical.
test/
  transforms.test.ts   # EXISTS (107 tests green) — import L2 has partitionIntoUnits…applyShrink, resolveShrinkTarget,
                       #   type Unit/MessageLike/BranchEntry/ShrinkTarget; fixtures asst/asstText/result/user/custom +
                       #   expectPairingInvariant.
                       #   ← APPEND one top-level describe block + EDIT import line (add filterPipeline, stableSortBySeq,
                       #     protectedOk, type RewindMarkerLike/ShrinkMarkerLike/MarkerBundle/ProtectedConfig).
spec/
  06-context-filter.md # §1 = handler + ordering; §8 = protected; §11 = composition (ERRATUM); §12 = pipeline pseudocode
  03-architecture.md   # §5 = ordering/composition/idempotency rationale
  10-testing.md        # §1.9 = composition tier-1 tests; §3 = property/invariant tests
  04-data-model.md     # §3 RewindMarker + §4 ShrinkMarker + §7 config
plan/001_2e5baf25fe9f/P1M3T5S1/research/  # THIS ITEM's research (gates, gotchas, spec extracts, live-state proof)
```

### Desired Codebase tree with files to be added/modified

```bash
src/transforms.ts        # MODIFY (append): + RewindMarkerLike/ShrinkMarkerLike/MarkerBundle/ProtectedConfig (exported
                         #   LOCAL types), + stableSortBySeq/protectedOk/filterPipeline (exported), + readOwnSeq
                         #   (module-private). 0 new imports.
test/transforms.test.ts  # MODIFY (append + one-line edit): + describe("filterPipeline / stableSortBySeq / protectedOk
                         #   — spec/10 §1.9 + §3", …); import line += the 3 fns + 4 types.
# NO new files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — Declare the four marker/config types LOCALLY in transforms.ts; do NOT import them from markers.ts /
//   config.ts. markers.ts imports Pi (ExtensionAPI/ExtensionContext); config.ts is Pi-free BUT importing MulliganConfig
//   would still make `grep -c '^import'` > 0, BREAKING the foundational Pi-free invariant (all landed siblings + the
//   file-header JSDoc enforce 0 imports). Declare LOCAL structural types (RewindMarkerLike, ShrinkMarkerLike,
//   MarkerBundle, ProtectedConfig) — structurally IDENTICAL to the markers.ts/config.ts exports. A real
//   RewindMarker/ShrinkMarker/MulliganConfig assigns into the LOCAL type with NO cast (excess-property checks do not
//   apply to non-literal object assignments). This is EXACTLY the MessageLike/ShrinkTarget/BranchEntry convention.

// CRITICAL #2 — RE-PARTITION per last_tool_call_group rewind. resolveLastToolCallGroup(units, messages, excludeId)
//   returns unit.indices that index the array `units` was partitioned from. spec/06 §12 partitions ONCE before the
//   loop; after rewind#1 reduces `m`, rewind#2's unit.indices are STALE → applyRewind removes the wrong messages.
//   FIX: `if (granularity === "last_tool_call_group") { const units = partitionIntoUnits(m); remove =
//   resolveLastToolCallGroup(units, m, excludeId) ?? []; }` — partition FRESH each iteration. resolveLastTurn and
//   resolveCheckpoint take `messages` directly (not units) and are inherently correct against the current `m`.

// CRITICAL #3 — spec/06 §11 is an ERRATUM. Its two-rewind narrative ("rewind#1 → a2/r2; rewind#2 → a1/r1; result
//   [u0,a3,res3,note,a4,res4]") is mechanically IMPOSSIBLE under §3's exclude-own-call rule: walking end→start, the
//   older rewind's exclude only skips ITS OWN group, so it resolves to the NEWEST other toolGroup (the newer rewind's
//   group), not an earlier mistake. The CORRECT live-resolution result of the §11 input is [u0,a1,r1,a2,r2,note]
//   (keeps the mistakes, removes the rewind calls) — the OPPOSITE of the narrative. The exclude-own-call mechanic is
//   fundamentally single-rewind; multiple last_tool_call_group rewinds interfere. DO NOT chase the §11 narrative. The
//   §1.9 "two rewinds compose" test uses a CLEAN, mechanically-correct scenario (rewind#1 removes the mistake;
//   rewind#2 re-resolves against the reduced array and no-ops) and asserts its exact, intent-consistent result. Proof:
//   research/verification.md §3.

// GOTCHA #4 — applyShrink's marker param is the STRUCTURAL {target, replacement}; ShrinkMarkerLike ADDS `seq` for
//   ordering. filterPipeline calls `m = applyShrink(m, sh)` where sh: ShrinkMarkerLike. ShrinkMarkerLike is
//   structurally ASSIGNABLE to applyShrink's {target, replacement} param (has both required fields; extra `seq` is fine
//   for a non-literal argument) → NO cast needed. applyShrink reads marker.target/marker.replacement via readOwn
//   (defensive) — a real ShrinkMarker assigns in with NO cast (GOTCHA #2 of the T4.S2 PRP).

// GOTCHA #5 — resolveLastTurn reads `to_previous_prompt` (snake_case) VERBATIM from rw.options (spec/04 §3; the T2.S2
//   PRP's D1 — NOT spec/06 §4's `toPreviousPrompt`, which is a spec typo). filterPipeline passes `readOwn(rw, "options")`
//   (cast to `{ to_previous_prompt?: boolean } | undefined`) straight through. Do NOT rename it.

// GOTCHA #6 — resolveCheckpoint takes `branchEntries: BranchEntry[]` (DATA), NOT `ctx` (purity — the LANDED pure
//   resolver takes the data it needs). spec/06 §12 pseudocode writes `resolveCheckpoint(m, ctx, rw.checkpoint)` — that
//   is the SPEC's shorthand for "the resolver needs the branch"; the IMPLEMENTED pure signature is
//   `resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId)`. filterPipeline passes
//   `branchEntries ?? []`. branchEntries is filterPipeline's OPTIONAL 4th param (absent/empty → checkpoint rewinds
//   no-op via resolveCheckpoint returning null). filter.ts (P1.M4.T2) supplies `ctx.sessionManager.getBranch()`.

// GOTCHA #7 — protectedOk CANNOT be triggered to BLOCK by the real resolvers. resolveLastTurn anchors removal at
//   iLastUser (>= iFirstUser) → min(remove) > iFirstUser always. resolveCheckpoint anchors at iTarget >= 0 with
//   remove = indices > iTarget → min(remove) > iFirstUser when the user is at index 0. So protectedOk's `false` branch
//   is PURELY defense-in-depth for a hypothetical buggy/adversarial resolver. Test the BLOCK via direct protectedOk
//   unit tests (min(remove) <= iFirstUser → false); test the PIPELINE by asserting the first user survives every
//   rewind scenario. Do NOT expect a real marker to exercise the block.

// GOTCHA #8 — spec/10 §3's `filterPipeline(filterPipeline(m)) === filterPipeline(m)` does NOT hold in general for
//   last_tool_call_group rewinds under live re-resolution: after rewind#1 removes a group, re-running against the
//   reduced array re-resolves to an EARLIER group and removes MORE. It DOES hold for SHRINKS (re-substitute same
//   replacement; or no-op if the needle is gone) and in the common single-mistake rewind case (after removal, no
//   further non-excluded group remains → second pass no-ops). The spec/03 §5 idempotency ("re-firing reproduces the
//   same result") is the DETERMINISM guarantee (same input → same output), which ALWAYS holds. Assert: shrink
//   idempotency (strict), determinism (always), single-mistake-rewind idempotency (the common case). Document the
//   general limitation. Proof: research/verification.md §4.

// GOTCHA #9 — stableSortBySeq must return a NEW array and NOT mutate the input. `[...markers].sort(…)` does both.
//   The marker OBJECTS are shared by reference (filterPipeline never mutates them — it only reads via readOwn + passes
//   them to the applicators). sort() is STABLE in Node (ES2019-mandated) so equal-seq markers keep input order (ties
//   are impossible by construction — runtime.ts nextSeq is a monotonic pre-increment — but stable regardless).

// GOTCHA #10 — protectedOk FAILS SAFE: when config is undefined OR config.rewind.protectedRoles is absent/malformed,
//   ENFORCE first:user (never silently remove the original task). Only DISABLE when protectedRoles is a NON-EMPTY
//   array that explicitly OMITS "first:user" (an intentional config). This mirrors the extension's "fail open" for
//   handlers but "fail SAFE/protect" for the protected boundary (the original task is sacred).

// GOTCHA #11 — "no markers / all no-ops → return messages SAME reference." When markers has no rewinds/shrinks, the
//   loops don't run and `m === messages` is returned (same ref). When markers exist but every rewind/shrink no-ops,
//   applyRewind/applyShrink each return the SAME ref they received, so `m` stays === messages. This matches the
//   applyRewind/applyShrink no-op-same-ref convention (safe for rt.lastFiltered/mulligan_audit — content consumers).

// GOTCHA #12 — filterPipeline NEVER throws (E13; context-handler hot path). Every field read goes through
//   isRecord/readOwn (throwing-Proxy-safe). applyRewind never reads message internals (trivially Proxy-safe).
//   applyShrink is already try/caught (T4.S2). protectedOk/stableSortBySeq are pure + read via readOwn. So the whole
//   pipeline is total — filter.ts's outer try/catch is belt-and-suspenders, not load-bearing.

// GOTCHA #13 — the nudge (spec/06 §1 step 3 / §12) is filter.ts's (P1.M4.T2) concern, NOT filterPipeline's.
//   filterPipeline transforms MARKERS ONLY (rewinds + shrinks). filter.ts calls filterPipeline, THEN injects the nudge
//   if the latest turn-metric warrants. Do NOT add nudge logic to filterPipeline (it has no metric + would break purity
//   — the metric is read from markers by filter.ts). This matches the item contract: "filterPipeline … consumed by
//   filter.ts (context handler)."
```

---

## Implementation Blueprint

### Data models and structure

FOUR new EXPORTED LOCAL structural types (`RewindMarkerLike`, `ShrinkMarkerLike`, `MarkerBundle`, `ProtectedConfig`)
+ ONE module-private helper (`readOwnSeq`). All declare their shape LOCALLY (Pi-free — GOTCHA #1); a real
`markers.ts`/`config.ts` export assigns in with NO cast. `filterPipeline`/`protectedOk`/`stableSortBySeq` reuse the
LANDED `MessageLike`/`Unit`/`BranchEntry`/`ShrinkTarget` + the module-private `isRecord`/`readOwn` already in scope.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: APPEND the four LOCAL types + stableSortBySeq + protectedOk + filterPipeline + readOwnSeq to src/transforms.ts
  - IMPLEMENT: `export interface RewindMarkerLike` (LOCAL structural — GOTCHA #1; verbatim below).
  - IMPLEMENT: `export interface ShrinkMarkerLike`, `export interface MarkerBundle`, `export interface ProtectedConfig`.
  - IMPLEMENT: `export function stableSortBySeq<T extends { seq?: unknown }>(markers: T[]): T[]` (verbatim below).
  - IMPLEMENT: `export function protectedOk(messages, remove, config): boolean` (verbatim below).
  - IMPLEMENT: `export function filterPipeline(messages, markers?, config?, branchEntries?): MessageLike[]` (verbatim below).
  - IMPLEMENT: `function readOwnSeq(marker: unknown): number` (module-private; verbatim below).
  - REUSE (do NOT redefine/import): partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint,
      applyRewind, applyShrink, ShrinkTarget, MessageLike, Unit, BranchEntry, isRecord, readOwn — all in module scope.
  - NAMING: RewindMarkerLike/ShrinkMarkerLike/MarkerBundle/ProtectedConfig (exported types), stableSortBySeq/protectedOk/
      filterPipeline (exported fns), readOwnSeq (module-private).
  - PLACEMENT: append at the END of src/transforms.ts (after applyShrink/stringifyContent, the T4.S2 tail).
  - VERIFY: `grep -c '^import' src/transforms.ts` → 0 (no new imports).

Task 2: APPEND the test block + EDIT the import line in test/transforms.test.ts
  - EDIT import line (L2): insert `filterPipeline, stableSortBySeq, protectedOk,` after `resolveShrinkTarget,` and
      append `, type RewindMarkerLike, type ShrinkMarkerLike, type MarkerBundle, type ProtectedConfig` after
      `type ShrinkTarget`. Target result line (verbatim below).
  - ADD: `describe("filterPipeline / stableSortBySeq / protectedOk — spec/10 §1.9 + §3", …)` (one top-level describe
      with nested describes: stableSortBySeq, protectedOk, filterPipeline §1.9, filterPipeline §3 property tests;
      verbatim below).
  - REUSE (do NOT redefine): fixtures asst/asstText/result/user/custom (all already defined in the test file).
  - FOLLOW pattern: the existing describe blocks' style (spec-section pinning in the title, one it() per case).
  - COVERAGE: spec/10 §1.9 (3 cases) + spec/10 §3 (pairing invariant, monotonic shrinkage, shrink idempotency,
      determinism) + defensive/never-throws + purity + types.
  - PLACEMENT: append at the END of test/transforms.test.ts.

Task 3: VALIDATE (no code)
  - RUN: `npx tsc --noEmit -p tsconfig.json` → exit 0.
  - RUN: `npx vitest run test/transforms.test.ts` → all green (existing 107 + new block).
  - RUN: `npx vitest run` → all green, no regression in any suite.
  - RUN: `grep -c '^import' src/transforms.ts` → 0.
```

### Implementation Patterns & Key Details

```typescript
// ───────────── APPEND TO src/transforms.ts (verbatim) ─────────────
// APPEND AFTER applyShrink/stringifyContent (the T4.S2 tail). REUSE partitionIntoUnits, resolveLastToolCallGroup,
// resolveLastTurn, resolveCheckpoint, applyRewind, applyShrink, ShrinkTarget, MessageLike, Unit, BranchEntry,
// isRecord, readOwn (all in module scope). ZERO new imports (the file is Pi-free; `grep -c '^import'` stays 0).

/**
 * RewindMarkerLike — the structural slice of a persisted RewindMarker that filterPipeline READS (spec/04 §3; spec/06
 * §1/§12). Declared LOCALLY (structurally identical to markers.ts's RewindMarker) so transforms.ts stays Pi-FREE
 * (0 imports — it must NOT import from markers.ts, which pulls in Pi). This mirrors the MessageLike / ShrinkTarget /
 * BranchEntry convention. A real markers.ts RewindMarker assigns in with NO cast. EXPORTED so filter.ts (P1.M4.T2),
 * the audit tool, and tests share one shape at the pure tier.
 *
 * NOTE: spec/04 §3 RewindMarker lists granularity as only the two relative literals, but spec/05 §1/§6 + config.ts's
 * Granularity union require "checkpoint"; and spec/04 §3 has NO `checkpoint` field though spec/06 §12 + spec/05 require
 * it for checkpoint granularity. This type includes BOTH (granularity union + optional checkpoint) — a real checkpoint
 * rewind marker (built by the rewind tool P1.M5.T1) assigns in; filterPipeline reads checkpoint defensively via readOwn
 * (absent → checkpoint rewind no-ops).
 */
export interface RewindMarkerLike {
  /** Monotonic per-session counter (runtime.ts nextSeq); orders markers oldest-first (stableSortBySeq). */
  seq: number;
  /** The targeting spec the filter resolves each inference (config.ts Granularity union). */
  granularity: "last_tool_call_group" | "last_turn" | "checkpoint";
  /** last_turn only — nuclear mode (also discard the most recent user message). Default false. */
  options?: { to_previous_prompt?: boolean };
  /** toolCallId of THIS rewind's own tool call (filter skips its group for last_tool_call_group; keeps its unit for
   *  last_turn/checkpoint). Absent/empty/non-string → not skipped/kept. */
  excludeToolCallId?: string;
  /** checkpoint only — the checkpoint name (without the mulligan:checkpoint: prefix). Absent → checkpoint rewind no-ops. */
  checkpoint?: string;
}

/**
 * ShrinkMarkerLike — the structural slice of a persisted ShrinkMarker that filterPipeline READS + ORDERS (spec/04 §4;
 * spec/06 §5). Structurally identical to markers.ts's ShrinkMarker minus the envelope/id/ts/reason; adds `seq` (which
 * applyShrink's {target, replacement} param does not name) so stableSortBySeq can order shrinks oldest-first. A real
 * ShrinkMarker assigns in with NO cast; ShrinkMarkerLike is ASSIGNABLE to applyShrink's {target, replacement} param
 * (extra `seq` is fine for a non-literal argument — GOTCHA #4). EXPORTED.
 */
export interface ShrinkMarkerLike {
  seq: number;
  target: ShrinkTarget;
  replacement: string;
}

/**
 * MarkerBundle — the marker set filterPipeline transforms (spec/06 §1 readMarkers output, MINUS the turn-metric which
 * the nudge injector consumes — NOT this pipeline). rewinds are applied oldest-first (stableSortBySeq) BEFORE shrinks
 * (spec/03 §5; spec/06 §1/§12). EXPORTED so filter.ts (P1.M4.T2) types its readMarkers return + tests build typed fixtures.
 */
export interface MarkerBundle {
  rewinds: RewindMarkerLike[];
  shrinks: ShrinkMarkerLike[];
}

/**
 * ProtectedConfig — the structural slice of MulliganConfig that protectedOk READS (spec/06 §8; spec/04 §7
 * config.rewind.protectedRoles). Declared LOCALLY (a real MulliganConfig from config.ts assigns in with NO cast) so
 * transforms.ts stays Pi-FREE (0 imports — config.ts is Pi-free BUT importing it would break the foundational 0-import
 * invariant). v1 protectedRoles selectors: "first:user", "latest:user". EXPORTED.
 */
export interface ProtectedConfig {
  rewind: { protectedRoles: string[] };
}

/**
 * stableSortBySeq — return a NEW array of markers sorted ASCENDING by `seq` (oldest-first), preserving input order for
 * equal seq (stable). seq is a monotonic per-session counter (runtime.ts nextSeq — ties impossible by construction, but
 * the sort is stable regardless). Used by filterPipeline to apply rewinds then shrinks oldest-first (spec/06 §1
 * "stableSortBySeq orders markers by their seq"; spec/03 §5 "oldest marker first … later rewinds resolve against the
 * already-reduced array").
 *
 * Defensive + TOTAL: a non-array `markers` → []; a marker whose seq is not a finite number is treated as 0 (sorted
 * first); a throwing-Proxy marker's seq is read via readOwn (never throws — E13). NEVER mutates the input (returns a
 * shallow copy via [...markers]; the marker OBJECTS are shared by reference — filterPipeline does not mutate them).
 *
 * @param markers the marker array (rewinds OR shrinks); non-array → []
 * @returns a NEW array, sorted ascending by seq (stable); the input array is unchanged
 */
export function stableSortBySeq<T extends { seq?: unknown }>(markers: T[]): T[] {
  if (!Array.isArray(markers)) return [];
  // Shallow copy (do NOT mutate the input) then stable ascending sort by seq. Array.prototype.sort is stable in Node
  // (ES2019-mandated) so equal-seq markers keep input order (ties impossible by construction, but stable regardless).
  return [...markers].sort((a, b) => readOwnSeq(a) - readOwnSeq(b));
}

/** Module-private: read a marker's `seq` as a finite number (0 if missing/non-finite/throwing-Proxy). Never throws. */
function readOwnSeq(marker: unknown): number {
  const s = readOwn(marker, "seq");
  return typeof s === "number" && Number.isFinite(s) ? s : 0;
}

/**
 * protectedOk — the FILTER's defense-in-depth protected-message check for a rewind's removal set (spec/06 §8; spec/03
 * §3). Returns true when the rewind is ALLOWED to remove `remove`; false when it must be SKIPPED (the pipeline no-ops
 * the rewind; filter.ts logs a warn).
 *
 * RULE (spec/06 §8, verbatim): "compute iFirstUser and iLatestUser in messages. A rewind's remove set MUST satisfy
 * min(remove) > iFirstUser." This function enforces the FIRST:USER boundary — a rewind may not remove the original-task
 * user message (or anything at/before it). The LATEST:USER boundary + the to_previous_prompt refusal are enforced BY
 * CONSTRUCTION in resolveLastTurn (default keeps iLastUser; nuclear refuses when iFirstUser===iLastUser — already
 * implemented + tested). protectedOk is the filter's DOUBLE-CHECK (spec/06 §8 "the filter double-checks and no-ops as
 * defense-in-depth") so a buggy/adversarial resolver cannot cross the line (GOTCHA #7: the real resolvers never cross
 * iFirstUser by construction, so this block is defense-in-depth).
 *
 * v1 config.rewind.protectedRoles supports exactly ["first:user","latest:user"] (spec/04 §7; config.ts KNOWN set). This
 * function honors "first:user" when present (the default — always present in a valid config). An empty/absent/malformed
 * protectedRoles → STILL enforce first:user (FAIL SAFE: when in doubt, protect the original task — never silently remove
 * it — GOTCHA #10). A non-empty protectedRoles that explicitly OMITS "first:user" → protection disabled (→ true). NEVER
 * throws (every read via isRecord/readOwn).
 *
 * @param messages the CURRENT message list (a real Pi AgentMessage[] assigns in); non-array → true (vacuous)
 * @param remove the rewind's removal index set; empty/non-array → true (nothing to remove → vacuously ok)
 * @param config the config slice (rewind.protectedRoles); missing/malformed → enforce first:user (fail safe)
 * @returns true if the rewind may proceed; false if it must be skipped (crosses the first:user boundary)
 */
export function protectedOk(
  messages: MessageLike[],
  remove: number[],
  config: ProtectedConfig | undefined,
): boolean {
  // Nothing to remove → vacuously allowed (resolver returned [] — a no-op/refused rewind).
  if (!Array.isArray(remove) || remove.length === 0) return true;
  if (!Array.isArray(messages)) return true; // vacuous (filterPipeline guards non-array → [] upstream)

  // Does the config protect the FIRST user message? Default YES (v1 always includes "first:user"). FAIL SAFE: enforce
  // UNLESS protectedRoles is a NON-EMPTY array that explicitly OMITS "first:user" (GOTCHA #10).
  let protectFirstUser = true;
  const rewindCfg = isRecord(config) ? readOwn(config, "rewind") : undefined;
  const roles = isRecord(rewindCfg) ? readOwn(rewindCfg, "protectedRoles") : undefined;
  if (Array.isArray(roles) && roles.length > 0) {
    protectFirstUser = roles.some((r) => r === "first:user");
  }
  if (!protectFirstUser) return true; // config explicitly disables first:user protection → allow

  // iFirstUser = index of the FIRST "user" message (the original task).
  let iFirstUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") {
      iFirstUser = i;
      break;
    }
  }
  if (iFirstUser === -1) return true; // no user message → nothing protected by first:user → allow

  // min(remove) MUST be > iFirstUser (spec/06 §8). Non-number/NaN entries are ignored (never a valid array index).
  let minRemove = Infinity;
  for (const r of remove) {
    if (typeof r === "number" && !Number.isNaN(r) && r < minRemove) minRemove = r;
  }
  if (!Number.isFinite(minRemove)) return true; // no numeric remove entries → vacuous
  return minRemove > iFirstUser;
}

/**
 * filterPipeline — Mulligan's composition core: apply persisted markers to a message list, returning the filtered view
 * the model sees (spec/06-context-filter.md §1, §5, §8, §11, §12; spec/03 §5 ordering/composition/idempotency). The
 * single PURE entry point the context handler (filter.ts, P1.M4.T2) calls: `return { messages: filterPipeline(...) }`.
 *
 * ORDER (FIXED — spec/03 §5; spec/06 §1/§12):
 *   1. REWINDS oldest-first (stableSortBySeq). For each rewind: resolve its removal set by granularity AGAINST THE
 *      CURRENT (already-reduced) array, check protectedOk (defense-in-depth — skip on false), then applyRewind
 *      (gap-closing index removal). Each rewind mutates the working array; later rewinds resolve against the
 *      already-reduced array (spec/03 §5).
 *   2. SHRINKS oldest-first (stableSortBySeq), on the post-rewind array: applyShrink per marker (content substitution).
 *   3. Return the array. (Nudge injection — spec/06 §1 step 3 / §12 — is filter.ts's concern, NOT this pure pipeline;
 *      filterPipeline transforms markers ONLY. GOTCHA #13.)
 *
 * GRANULARITY DISPATCH (spec/06 §12, with the re-partition FIX — GOTCHA #2):
 *   - "last_tool_call_group": RE-PARTITION the current array FRESH (partitionIntoUnits(m)), then
 *     resolveLastToolCallGroup(units, m, excludeToolCallId). (The §12 pseudocode partitions ONCE before the loop — a
 *     stale-index bug after the first rewind reduces m, because resolveLastToolCallGroup returns unit.indices that index
 *     the partitioned array. Re-partitioning each iteration keeps them valid against the current m.)
 *   - "last_turn": resolveLastTurn(m, rw.options, excludeToolCallId).remove. (options carries to_previous_prompt
 *     VERBATIM — GOTCHA #5.)
 *   - "checkpoint": resolveCheckpoint(m, branchEntries ?? [], rw.checkpoint, excludeToolCallId)?.remove ?? []. (Takes
 *     branchEntries DATA, NOT ctx — GOTCHA #6.)
 *
 * IDEMPOTENCY (spec/03 §5; spec/06 §11): re-firing the pipeline on the SAME input reproduces the SAME output
 * (deterministic — the spec's "re-firing on the same session reproduces the same result"). Shrinks are STRICTLY
 * idempotent under filterPipeline∘filterPipeline (re-substituting the same replacement = same result). Rewinds are
 * idempotent in the common single-mistake case (after removal, no further non-excluded group remains → second pass
 * no-ops); the general filterPipeline(filterPipeline(m))===filterPipeline(m) does NOT hold for multi-group
 * last_tool_call_group rewinds under live re-resolution (GOTCHA #8). See research/verification.md §4.
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-record markers → pass-through (rewinds/shrinks default to []);
 * protectedOk false → rewind skipped (no throw); a throwing-Proxy message never crashes (every read via
 * isRecord/readOwn; applyRewind never reads message internals; applyShrink is already try/caught — GOTCHA #12).
 * Side-effect-free (never mutates `messages` or the markers). NO new imports (reuses everything already in module
 * scope; the Pi-free `grep -c '^import'` invariant stays 0).
 *
 * @param messages      the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param markers       { rewinds, shrinks } (a real readMarkers output assigns in); undefined/non-record → pass-through
 * @param config        the config slice protectedOk reads (rewind.protectedRoles); undefined → enforce first:user
 * @param branchEntries getBranch() output for checkpoint rewinds (leaf→root); optional — absent → checkpoint no-ops
 * @returns the filtered message array; the SAME reference as `messages` when no marker transforms anything
 */
export function filterPipeline(
  messages: MessageLike[],
  markers: MarkerBundle | undefined,
  config: ProtectedConfig | undefined,
  branchEntries?: BranchEntry[],
): MessageLike[] {
  // Defensive: a non-array messages → [] (mirrors partitionIntoUnits/applyRewind/applyShrink).
  if (!Array.isArray(messages)) return [];

  // Read the marker arrays defensively (non-record markers / missing arrays → []).
  const bundle = isRecord(markers) ? markers : undefined;
  const rewindsRaw = bundle ? readOwn(bundle, "rewinds") : undefined;
  const shrinksRaw = bundle ? readOwn(bundle, "shrinks") : undefined;
  const rewinds: RewindMarkerLike[] = Array.isArray(rewindsRaw) ? (rewindsRaw as RewindMarkerLike[]) : [];
  const shrinks: ShrinkMarkerLike[] = Array.isArray(shrinksRaw) ? (shrinksRaw as ShrinkMarkerLike[]) : [];

  let m = messages;

  // 1) REWINDS, oldest-first (stableSortBySeq). Each resolves against the CURRENT m; protectedOk gates each.
  for (const rw of stableSortBySeq(rewinds)) {
    const granularity = readOwn(rw, "granularity");
    const excludeRaw = readOwn(rw, "excludeToolCallId");
    const excludeId = typeof excludeRaw === "string" ? excludeRaw : undefined;

    let remove: number[];
    if (granularity === "last_tool_call_group") {
      // RE-PARTITION fresh each iteration so unit.indices index the CURRENT m (GOTCHA #2 — the §12 pseudocode's
      // partition-once is a stale-index bug after the first rewind reduces m).
      const units = partitionIntoUnits(m);
      remove = resolveLastToolCallGroup(units, m, excludeId) ?? [];
    } else if (granularity === "last_turn") {
      // options carries to_previous_prompt VERBATIM (GOTCHA #5). resolveLastTurn refuses nuclear when iFirst===iLast.
      remove = resolveLastTurn(
        m,
        readOwn(rw, "options") as { to_previous_prompt?: boolean } | undefined,
        excludeId,
      ).remove;
    } else if (granularity === "checkpoint") {
      // resolveCheckpoint takes branchEntries DATA, not ctx (GOTCHA #6). Absent/empty → null → no-op.
      const cpRaw = readOwn(rw, "checkpoint");
      const cpName = typeof cpRaw === "string" ? cpRaw : "";
      remove = resolveCheckpoint(m, Array.isArray(branchEntries) ? branchEntries : [], cpName, excludeId)?.remove ?? [];
    } else {
      remove = []; // unknown granularity → no-op
    }

    // Defense-in-depth: skip (no-op) rewinds that cross the protected first:user boundary. (filter.ts logs the warn.)
    if (!protectedOk(m, remove, config)) continue;

    m = applyRewind(m, remove);
  }

  // 2) SHRINKS, oldest-first (stableSortBySeq), on the post-rewind array. ShrinkMarkerLike is structurally assignable
  //    to applyShrink's {target, replacement} param (extra seq is fine — GOTCHA #4). applyShrink is defensive + total.
  for (const sh of stableSortBySeq(shrinks)) {
    m = applyShrink(m, sh);
  }

  return m;
}
```

```typescript
// ───────────── EDIT test/transforms.test.ts import line (L2) ─────────────
// BEFORE:  import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, applyRewind,
//          applyShrink, resolveShrinkTarget, type Unit, type MessageLike, type BranchEntry, type ShrinkTarget } from "../src/transforms.js";
// AFTER (add the 3 fns after resolveShrinkTarget, and the 4 types after type ShrinkTarget):
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, applyRewind, applyShrink, resolveShrinkTarget, filterPipeline, stableSortBySeq, protectedOk, type Unit, type MessageLike, type BranchEntry, type ShrinkTarget, type RewindMarkerLike, type ShrinkMarkerLike, type MarkerBundle, type ProtectedConfig } from "../src/transforms.js";
```

```typescript
// ───────────── APPEND TO test/transforms.test.ts (verbatim) ─────────────
// APPEND at the END of the file. REUSE the existing module-scope fixtures: asst, asstText, result, user, custom.
// Do NOT redefine any fixture. All NEW helpers (mkRewind, mkShrink, mulberry32, genMessages, expectNoOrphans, cfg)
// are closure-local to this one describe block.

describe("filterPipeline / stableSortBySeq / protectedOk — spec/10 §1.9 + §3", () => {
  // ── shared helpers (closure-local; do NOT clash with the module-scope user/asst/result/custom) ──
  const cfg = { rewind: { protectedRoles: ["first:user", "latest:user"] } } as ProtectedConfig;

  /** Build a RewindMarkerLike (the structural slice filterPipeline reads). */
  function mkRewind(seq: number, granularity: RewindMarkerLike["granularity"], extra: Partial<RewindMarkerLike> = {}): RewindMarkerLike {
    return { seq, granularity, ...extra };
  }
  /** Build a ShrinkMarkerLike. */
  function mkShrink(seq: number, target: ShrinkTarget, replacement: string): ShrinkMarkerLike {
    return { seq, target, replacement };
  }
  /** Read the first text block's text from a message (for shrink-content assertions). */
  function textOf(m: MessageLike): string {
    const c = m.content;
    if (Array.isArray(c) && c.length > 0) {
      const first = c[0] as { text?: unknown };
      return typeof first.text === "string" ? first.text : "";
    }
    return "";
  }

  // ── stableSortBySeq ───────────────────────────────────────────────────────
  describe("stableSortBySeq — ascending by seq, stable, non-mutating", () => {
    it("sorts ascending by seq (oldest-first)", () => {
      const ms = [{ seq: 3 }, { seq: 1 }, { seq: 2 }];
      expect(stableSortBySeq(ms).map((m) => m.seq)).toEqual([1, 2, 3]);
    });
    it("is stable for equal seq (preserves input order)", () => {
      const a = { seq: 1, id: "a" }, b = { seq: 1, id: "b" }, c = { seq: 1, id: "c" };
      expect(stableSortBySeq([c, a, b]).map((m) => m.id)).toEqual(["c", "a", "b"]);
    });
    it("returns a NEW array; does not mutate the input", () => {
      const ms = [{ seq: 2 }, { seq: 1 }];
      const sorted = stableSortBySeq(ms);
      expect(sorted).not.toBe(ms);                       // new array
      expect(ms.map((m) => m.seq)).toEqual([2, 1]);      // input unchanged
      expect(sorted.map((m) => m.seq)).toEqual([1, 2]);
    });
    it("defensive: non-array → []; non-finite seq → 0 (sorted first, stable)", () => {
      expect(stableSortBySeq(null as unknown as { seq: number }[])).toEqual([]);
      const ms = [{ seq: NaN }, { seq: 5 }, { seq: "x" as unknown as number }];
      // NaN + non-number → 0 (sorted first, stable input order); the finite 5 sorts last.
      const out = stableSortBySeq(ms);
      expect(out.map((m) => m.seq)).toEqual([NaN, "x" as unknown as number, 5]);
    });
  });

  // ── protectedOk ───────────────────────────────────────────────────────────
  describe("protectedOk — spec/06 §8 first:user defense-in-depth", () => {
    it("empty remove → true (vacuous)", () => {
      expect(protectedOk([user("u"), asst("c"), result("c")], [], cfg)).toBe(true);
    });
    it("min(remove) > iFirstUser → true (removal stays after the first user)", () => {
      expect(protectedOk([user("u"), asst("c"), result("c")], [1, 2], cfg)).toBe(true);
    });
    it("min(remove) <= iFirstUser → false (would remove the original-task user)", () => {
      expect(protectedOk([user("u"), asst("c"), result("c")], [0, 1], cfg)).toBe(false);
    });
    it("no user message → true (nothing protected by first:user)", () => {
      expect(protectedOk([asst("c"), result("c")], [0, 1], cfg)).toBe(true);
    });
    it("config protectedRoles omits first:user → true (protection disabled by config)", () => {
      const noFirst = { rewind: { protectedRoles: ["latest:user"] } } as ProtectedConfig;
      expect(protectedOk([user("u"), asst("c")], [0], noFirst)).toBe(true);
    });
    it("defensive: non-array remove → true; undefined config → FAIL SAFE (enforce first:user)", () => {
      expect(protectedOk([user("u")], null as unknown as number[], cfg)).toBe(true);
      expect(protectedOk([user("u"), asst("c")], [0], undefined)).toBe(false); // fail safe: protect the original task
    });
    it("defensive: throwing-Proxy messages never crash protectedOk", () => {
      const trap = new Proxy({ role: "user" } as MessageLike, { get() { throw new Error("trap"); } });
      expect(() => protectedOk([trap], [0], cfg)).not.toThrow(); // reads via isRecord/readOwn → role unreadable → not "user" → no iFirstUser → true
    });
  });

  // ── filterPipeline — spec/10 §1.9 composition ─────────────────────────────
  describe("filterPipeline — spec/10 §1.9 composition (rewinds then shrinks)", () => {
    it("spec/10 §1.9 bullet 1 — two rewinds compose (rewind#1 removes the mistake; rewind#2 no-ops)", () => {
      // messages: [u0, a1(mistake call cM), r1, aR1(rewind#1 own call cR1), resR1, note1]
      const msgs: MessageLike[] = [
        user("u0"), asst("cM"), result("cM"), asst("cR1"), result("cR1"), custom("mulligan:note"),
      ];
      const markers: MarkerBundle = {
        // rewind#1 (older, applied first) excludes its own call cR1 → resolves to the last non-excluded toolGroup
        // (a1/r1 at indices 1,2). rewind#2 (same exclude cR1) re-resolves against the reduced array: the only toolGroup
        // left is aR1/resR1 (excluded) → null → no-op. (The exclude-own-call mechanic is single-rewind; see GOTCHA #3
        // for why spec/06 §11's "two distinct removals" narrative is an erratum.)
        rewinds: [
          mkRewind(1, "last_tool_call_group", { excludeToolCallId: "cR1" }),
          mkRewind(2, "last_tool_call_group", { excludeToolCallId: "cR1" }),
        ],
        shrinks: [],
      };
      const out = filterPipeline(msgs, markers, cfg);
      expect(out).toHaveLength(4);                                  // a1/r1 removed; aR1/resR1/note kept
      expect(out.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "custom"]);
      expect(out[3]).toBe(msgs[5]);                                 // the note survives (same ref)
    });

    it("spec/10 §1.9 bullet 2 — rewind-then-shrink-on-removed-target → shrink no-ops", () => {
      // rewind removes a1/r1 (the bloated result); the shrink targets r1's callId cM (now gone) → resolveShrinkTarget
      // returns null → applyShrink no-ops (SAME ref). Harmless composition (spec/06 §5 "shrink after rewind … no-ops").
      const msgs: MessageLike[] = [
        user("u0"),
        asst("cM"),
        { ...result("cM"), content: [{ type: "text", text: "BIG" }] },
        asst("cR1"),
        result("cR1"),
        custom("mulligan:note"),
      ];
      const markers: MarkerBundle = {
        rewinds: [mkRewind(1, "last_tool_call_group", { excludeToolCallId: "cR1" })],
        shrinks: [mkShrink(2, { by_tool_call_id: "cM" }, "[shrunk]")],
      };
      const out = filterPipeline(msgs, markers, cfg);
      expect(out).toHaveLength(4);                                  // a1/r1 removed by rewind
      expect(out.some((m) => textOf(m) === "[shrunk]")).toBe(false); // shrink no-op'd (target gone)
    });

    it("spec/10 §1.9 bullet 3 — protected message → rewind skipped (first user never removed)", () => {
      // A last_turn rewind with to_previous_prompt on a SINGLE-user session: resolveLastTurn REFUSES (iFirst===iLast)
      // → remove=[] → protectedOk vacuously true → applyRewind no-op. The first user is never removed (layered
      // protection: resolver refusal + protectedOk defense-in-depth — GOTCHA #7).
      const msgs: MessageLike[] = [user("u0"), asst("c"), result("c")];
      const markers: MarkerBundle = {
        rewinds: [mkRewind(1, "last_turn", { options: { to_previous_prompt: true }, excludeToolCallId: "c" })],
        shrinks: [],
      };
      const out = filterPipeline(msgs, markers, cfg);
      expect(out).toHaveLength(3);                                  // nothing removed — first user protected
      expect(out[0].role).toBe("user");
    });

    it("shrinks compose through the pipeline oldest-first (two shrinks → both applied)", () => {
      const msgs: MessageLike[] = [
        user("u0"),
        asst("c1"),
        { ...result("c1"), content: [{ type: "text", text: "BIG1" }] },
        asst("c2"),
        { ...result("c2"), content: [{ type: "text", text: "BIG2" }] },
      ];
      const markers: MarkerBundle = {
        rewinds: [],
        shrinks: [
          mkShrink(1, { by_tool_call_id: "c1" }, "[s1]"),
          mkShrink(2, { by_tool_call_id: "c2" }, "[s2]"),
        ],
      };
      const out = filterPipeline(msgs, markers, cfg);
      expect(out).toHaveLength(5);
      expect(textOf(out[2])).toBe("[s1]");
      expect(textOf(out[4])).toBe("[s2]");
    });

    it("last_turn rewind through the pipeline keeps the rewind's own unit + the note", () => {
      // [u0, a1, r1, u1, a2, r2, aR1, resR1, note1] — last_turn (default, exclude cR1) removes a2/r2 (the turn's work
      // after u1) but KEEPS u1, the rewind's own unit (aR1/resR1), and the note.
      const msgs: MessageLike[] = [
        user("u0"), asst("c1"), result("c1"), user("u1"),
        asst("c2"), result("c2"), asst("cR1"), result("cR1"), custom("mulligan:note"),
      ];
      const markers: MarkerBundle = {
        rewinds: [mkRewind(1, "last_turn", { excludeToolCallId: "cR1" })],
        shrinks: [],
      };
      const out = filterPipeline(msgs, markers, cfg);
      expect(out.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "user", "assistant", "toolResult", "custom"]);
      // u0,a1,r1,u1 kept; a2,r2 removed (turn work); aR1,resR1 (rewind's own unit) + note kept.
    });

    it("checkpoint rewind through the pipeline removes everything after the checkpoint point", () => {
      // branchEntries (leaf→root): [message u0, message a1, label checkpoint "x" targeting a1]. messages = [u0, a1, r1?]
      // — to keep it simple: a 2-message prefix [u0, a1text] with a checkpoint labeling a1; a checkpoint rewind hides
      // everything after the checkpoint (nothing here → remove=[]). We instead label an EARLIER point to force a removal.
      const msgs: MessageLike[] = [user("u0"), asstText("keep"), asstText("drop1"), asstText("drop2")];
      // branchEntries leaf→root: label "mulligan:checkpoint:x" targets the entry yielding message index 1 (asstText keep).
      const branchEntries: BranchEntry[] = [
        { type: "message", id: "e3", parentId: "e2" }, // msg index 3 (drop2) — leaf
        { type: "message", id: "e2", parentId: "e1" }, // msg index 2 (drop1)
        { type: "message", id: "e1", parentId: "e0" }, // msg index 1 (keep)
        { type: "label", id: "L1", parentId: "e0", targetId: "e1", label: "mulligan:checkpoint:x" },
        { type: "message", id: "e0", parentId: null }, // msg index 0 (u0) — root
      ];
      const markers: MarkerBundle = {
        rewinds: [mkRewind(1, "checkpoint", { checkpoint: "x", excludeToolCallId: undefined })],
        shrinks: [],
      };
      const out = filterPipeline(msgs, markers, cfg, branchEntries);
      // iTarget = 1 (the checkpointed message "keep"); remove = indices > 1 → [2,3]. Result = [u0, keep].
      expect(out.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect((out[1].content as { text: string }[])[0].text).toBe("keep");
    });

    it("defensive: no markers → SAME reference; non-array messages → []; non-record markers → pass-through", () => {
      const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
      expect(filterPipeline(msgs, undefined, cfg)).toBe(msgs);          // no markers → same ref
      expect(filterPipeline(msgs, null as unknown as MarkerBundle, cfg)).toBe(msgs); // non-record markers → same ref
      expect(filterPipeline(msgs, { rewinds: [], shrinks: [] }, cfg)).toBe(msgs);    // empty markers → same ref
      expect(filterPipeline(null as unknown as MessageLike[], { rewinds: [], shrinks: [] }, cfg)).toEqual([]);
    });

    it("defensive: unknown granularity + malformed markers are skipped (never throws — spec/08 E13)", () => {
      const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
      const markers = {
        rewinds: [{ seq: 1, granularity: "bogus" }, { seq: 2 }], // unknown granularity + missing granularity
        shrinks: [{ seq: 1 }],                                    // missing target/replacement → applyShrink no-ops
      } as unknown as MarkerBundle;
      expect(() => filterPipeline(msgs, markers, cfg)).not.toThrow();
      expect(filterPipeline(msgs, markers, cfg)).toBe(msgs);          // all no-ops → same ref
    });

    it("purity: never mutates the input messages array or the markers", () => {
      const msgs: MessageLike[] = [user("u"), asst("cM"), result("cM"), asst("cR1"), result("cR1"), custom("mulligan:note")];
      const markers: MarkerBundle = {
        rewinds: [mkRewind(1, "last_tool_call_group", { excludeToolCallId: "cR1" })],
        shrinks: [],
      };
      const snapshotRoles = msgs.map((m) => m.role);
      filterPipeline(msgs, markers, cfg);
      expect(msgs.map((m) => m.role)).toEqual(snapshotRoles);         // input untouched
      expect(msgs).toHaveLength(6);
      expect(markers.rewinds[0].seq).toBe(1);                         // markers untouched
    });

    it("returns MessageLike[] (stableSortBySeq is generic; protectedOk returns boolean)", () => {
      expectTypeOf(filterPipeline([], undefined, undefined)).toEqualTypeOf<MessageLike[]>();
      expectTypeOf(filterPipeline([user("u")], { rewinds: [], shrinks: [] }, cfg)).toEqualTypeOf<MessageLike[]>();
      expectTypeOf(protectedOk([], [], cfg)).toEqualTypeOf<boolean>();
    });
  });

  // ── filterPipeline — spec/10 §3 property/invariant tests (seeded, deterministic; no external dep) ──
  describe("filterPipeline — spec/10 §3 property/invariant tests (seeded)", () => {
    /** Deterministic mulberry32 PRNG (no external dep). Fixed seed → reproducible. */
    function mulberry32(seed: number): () => number {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    /** Build a WELL-FORMED random message list: user / text-assistant / fully-paired assistant+results (ADJACENT, so
     *  pairs are never split across a turn boundary → removals preserve pairing). */
    function genMessages(rng: () => number): MessageLike[] {
      const n = 2 + Math.floor(rng() * 8); // 2..9 entries
      const msgs: MessageLike[] = [];
      let callCounter = 0;
      for (let i = 0; i < n; i++) {
        const roll = rng();
        if (roll < 0.34) {
          msgs.push(user(`u${i}`));
        } else if (roll < 0.6) {
          msgs.push(asstText(`text${i}`));
        } else {
          const calls = 1 + Math.floor(rng() * 2); // 1-2 calls
          const ids: string[] = [];
          for (let k = 0; k < calls; k++) { callCounter++; ids.push(`c${callCounter}`); }
          msgs.push(asst(...ids));
          for (const id of ids) msgs.push(result(id)); // ADJACENT → pair block is contiguous
        }
      }
      return msgs;
    }
    /** Assert the output never contains an orphan toolCall or toolResult (the pairing invariant — spec/10 §3). */
    function expectNoOrphans(msgs: MessageLike[]): void {
      const calls = new Set<string>();
      const results = new Set<string>();
      for (const m of msgs) {
        const c = m.content;
        if (Array.isArray(c)) {
          for (const b of c) {
            const blk = b as { type?: string; id?: string };
            if (blk?.type === "toolCall" && typeof blk.id === "string") calls.add(blk.id);
          }
        }
        if (m.role === "toolResult" && typeof m.toolCallId === "string") results.add(m.toolCallId);
      }
      for (const id of calls) expect(results.has(id), `orphan toolCall ${id} (no matching result)`).toBe(true);
      for (const id of results) expect(calls.has(id), `orphan toolResult ${id} (no matching call)`).toBe(true);
    }

    it("pairing invariant: random markers never produce an orphan toolCall/toolResult (spec/10 §3)", () => {
      const rng = mulberry32(0xc0ffee);
      for (let iter = 0; iter < 300; iter++) {
        const msgs = genMessages(rng);
        const rewinds: RewindMarkerLike[] = [];
        for (let r = 0; r < 2; r++) {
          if (rng() < 0.5) {
            rewinds.push(
              mkRewind(r + 1, rng() < 0.5 ? "last_tool_call_group" : "last_turn", {
                excludeToolCallId: rng() < 0.5 ? `c${1 + Math.floor(rng() * 4)}` : undefined,
              }),
            );
          }
        }
        const out = filterPipeline(msgs, { rewinds, shrinks: [] }, cfg);
        expectNoOrphans(out);
      }
    });

    it("monotonic shrinkage: a rewind never increases the message count (spec/10 §3)", () => {
      const rng = mulberry32(0xbeef);
      for (let iter = 0; iter < 300; iter++) {
        const msgs = genMessages(rng);
        const rewinds: RewindMarkerLike[] = [];
        if (rng() < 0.7) {
          rewinds.push(
            mkRewind(1, rng() < 0.5 ? "last_tool_call_group" : "last_turn", {
              excludeToolCallId: `c${1 + Math.floor(rng() * 3)}`,
            }),
          );
        }
        const out = filterPipeline(msgs, { rewinds, shrinks: [] }, cfg);
        expect(out.length, "rewind never increases count").toBeLessThanOrEqual(msgs.length);
      }
    });

    it("idempotency (shrinks): filterPipeline(filterPipeline(m)) === filterPipeline(m) (spec/10 §3)", () => {
      // Shrinks are STRICTLY idempotent: a by_tool_call_id shrink re-matches the same toolResult (the first shrink's
      // spread PRESERVED toolCallId) and re-substitutes the SAME replacement → identical output. (The general
      // filterPipeline∘filterPipeline property does NOT hold for multi-group last_tool_call_group rewinds under live
      // re-resolution — GOTCHA #8; this test exercises the shrink path where it always holds.)
      const rng = mulberry32(0xf00d);
      for (let iter = 0; iter < 200; iter++) {
        const msgs = genMessages(rng);
        const callIds: string[] = [];
        for (const m of msgs) if (m.role === "toolResult" && typeof m.toolCallId === "string") callIds.push(m.toolCallId);
        const shrinks: ShrinkMarkerLike[] = [];
        for (let s = 0; s < 2 && callIds.length > 0; s++) {
          const id = callIds[Math.floor(rng() * callIds.length)];
          shrinks.push(mkShrink(s + 1, { by_tool_call_id: id }, `[s${s}]`));
        }
        const markers: MarkerBundle = { rewinds: [], shrinks };
        const once = filterPipeline(msgs, markers, cfg);
        const twice = filterPipeline(once, markers, cfg);
        expect(twice).toEqual(once);
      }
    });

    it("determinism: the same input always yields the same output (spec/03 §5 / spec/06 §11 re-fire idempotency)", () => {
      // The spec's idempotency guarantee is "re-firing on the same session reproduces the same result" = DETERMINISM
      // (same input → same output). This ALWAYS holds for the pure pipeline (GOTCHA #8).
      const rng = mulberry32(0x1234);
      for (let iter = 0; iter < 200; iter++) {
        const msgs = genMessages(rng);
        const rewinds: RewindMarkerLike[] = [];
        if (rng() < 0.6) {
          rewinds.push(
            mkRewind(1, "last_tool_call_group", { excludeToolCallId: `c${1 + Math.floor(rng() * 3)}` }),
          );
        }
        const markers: MarkerBundle = { rewinds, shrinks: [] };
        const a = filterPipeline(msgs, markers, cfg);
        const b = filterPipeline(msgs, markers, cfg);
        expect(b).toEqual(a);
      }
    });
  });
});
```

### Integration Points

```yaml
MODULE (src/transforms.ts):
  - append: "export interface RewindMarkerLike + ShrinkMarkerLike + MarkerBundle + ProtectedConfig + export function
    stableSortBySeq + protectedOk + filterPipeline + function readOwnSeq (module-private) at END of file (after
    applyShrink/stringifyContent, the T4.S2 tail)"
  - imports: "ZERO new imports (reuse partitionIntoUnits/resolveLastToolCallGroup/resolveLastTurn/resolveCheckpoint/
    applyRewind/applyShrink/ShrinkTarget/MessageLike/Unit/BranchEntry/isRecord/readOwn in module scope); grep -c '^import' → 0"

TEST (test/transforms.test.ts):
  - edit import L2: "add `filterPipeline, stableSortBySeq, protectedOk,` (after resolveShrinkTarget) and
    `, type RewindMarkerLike, type ShrinkMarkerLike, type MarkerBundle, type ProtectedConfig` (after type ShrinkTarget)"
  - append: "describe('filterPipeline / stableSortBySeq / protectedOk — spec/10 §1.9 + §3', …) at END of file"

DOWNSTREAM CONSUMER (NOT this task — P1.M4.T2 filter.ts):
  - call site: "messages = filterPipeline(event.messages, readMarkers(ctx), config, ctx.sessionManager.getBranch());
    // then injectNudge if the latest turn-metric warrants; cache as rt.lastFiltered; return { messages }"
  - wrapper:   "filter.ts wraps filterPipeline in try/catch fail-open (spec/03 §5); the PURE fn is filterPipeline"
  - note: "filter.ts passes a real readMarkers {rewinds,shrinks} (assigns into MarkerBundle with no cast) + a real
    MulliganConfig (assigns into ProtectedConfig with no cast). branchEntries is optional — checkpoint rewinds no-op
    when absent. The nudge (spec/06 §1 step 3) is filter.ts's concern, NOT filterPipeline (GOTCHA #13)."
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending the symbols — fix before proceeding
npx tsc --noEmit -p tsconfig.json   # Type check the whole project (the symbols are in src/transforms.ts)
# Expected: exit 0 (no errors). If errors exist, READ the output and fix before proceeding.

# Pi-free invariant (the module's foundational constraint)
grep -c '^import' src/transforms.ts
# Expected: 0. If >0, you accidentally imported something (e.g. RewindMarker/ShrinkMarker/MulliganConfig/Granularity
# from markers.ts/config.ts) — remove it; declare the four types LOCALLY (GOTCHA #1).
```

> This project has NO linter/formatter configured (no eslint/ruff/prettier in package.json) — the gates are
> `tsc` (type check) + `vitest` (tests) + the `grep -c '^import' → 0` Pi-free invariant. Do NOT invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# Test filterPipeline / stableSortBySeq / protectedOk (and the whole transforms suite — append-only, so no regression)
npx vitest run test/transforms.test.ts
# Expected: ALL green (the existing 107 tests + the new block). If failing, debug root cause and fix.

# Full test suite (no regression in any other suite — ledger/tokens/notes/config/log/runtime/markers/tools)
npx vitest run
# Expected: all green (full suite across all test files).
```

### Level 3: Integration Testing (System Validation)

```bash
# filterPipeline / stableSortBySeq / protectedOk are PURE helpers with NO Pi dependency, so there is no service to
# start / endpoint. Their "integration" is their COMPOSITION — already covered by the spec/10 §1.9 cases (two rewinds
# compose; rewind-then-shrink-on-removed no-ops; protected → skipped) + the three-matcher/last_turn/checkpoint pipeline
# tests + the spec/10 §3 property tests (pairing invariant / monotonic shrinkage / shrink idempotency / determinism).

# (Optional) sanity-build the project to confirm the dist compiles (the extension entry is src/index.ts):
npx tsc -p tsconfig.json
# Expected: dist/ builds cleanly (exit 0). NOT required for this task (pure-helper), but confirms no breakage downstream.

# Expected: pure helpers compile + all tests green. No service/endpoint/MCP/database integration for this item.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Composition spot check (spec/10 §1.9 bullet 1 — two rewinds compose):
npx vitest run test/transforms.test.ts -t "two rewinds compose"
# Expected: 1 test passed.

# Rewind-then-shrink-on-removed spot check (spec/10 §1.9 bullet 2):
npx vitest run test/transforms.test.ts -t "rewind-then-shrink-on-removed-target"
# Expected: 1 test passed.

# Protected-message spot check (spec/10 §1.9 bullet 3):
npx vitest run test/transforms.test.ts -t "protected message → rewind skipped"
# Expected: 1 test passed.

# Property-test spot checks (spec/10 §3):
npx vitest run test/transforms.test.ts -t "pairing invariant"
npx vitest run test/transforms.test.ts -t "monotonic shrinkage"
npx vitest run test/transforms.test.ts -t "idempotency"
npx vitest run test/transforms.test.ts -t "determinism"
# Expected: each passes (300 or 200 seeded iterations).

# Expected: composition + property tests green. (No perf/security/load gates for a 2-pt pure helper.)
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed successfully
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npx vitest run` is all-green (no regression; new block passes)
- [ ] `grep -c '^import' src/transforms.ts` → **0** (Pi-free invariant preserved)

### Feature Validation

- [ ] All success criteria from "What" section met
- [ ] spec/10 §1.9 bullet 1 (two rewinds compose — rewind#1 removes, rewind#2 no-ops) — test green
- [ ] spec/10 §1.9 bullet 2 (rewind-then-shrink-on-removed → shrink no-ops) — test green
- [ ] spec/10 §1.9 bullet 3 (protected message → rewind skipped) — test green
- [ ] spec/10 §3 pairing invariant (no orphans on random inputs) — test green (300 iters)
- [ ] spec/10 §3 monotonic shrinkage (rewind never increases count) — test green (300 iters)
- [ ] spec/10 §3 shrink idempotency (filterPipeline∘filterPipeline === filterPipeline) — test green (200 iters)
- [ ] determinism (same input → same output) — test green (200 iters)
- [ ] stableSortBySeq (ascending, stable, non-mutating, defensive) — tests green
- [ ] protectedOk (min(remove) > iFirstUser; fail-safe; never throws) — tests green
- [ ] Defensive cases (non-array messages/markers/config, malformed markers, throwing-Proxy) never throw — tests green

### Code Quality Validation

- [ ] Follows existing codebase patterns (pure, defensive, total, JSDoc-pinned to spec sections — mirrors the siblings)
- [ ] File placement matches the desired tree (append to src/transforms.ts + test/transforms.test.ts; no new files)
- [ ] Anti-patterns avoided (see below)
- [ ] ZERO new imports (reuses everything in scope; declares the four types LOCALLY — does not import
      RewindMarker/ShrinkMarker/MulliganConfig/Granularity from markers.ts/config.ts)
- [ ] filterPipeline composes the LANDED siblings — does NOT reimplement partition/resolve/apply logic

### Documentation & Deployment

- [ ] Code is self-documenting (JSDoc pins spec/06 §1/§5/§8/§11/§12 + spec/03 §5 + spec/10 §1.9/§3 + the re-partition
      fix + the §11 erratum + the idempotency caveat)
- [ ] The re-partition-per-rewind fix is documented (GOTCHA #2) — prevents a future implementer from "simplifying" to
      the §12 partition-once (which is a stale-index bug)
- [ ] The §11 erratum is documented (GOTCHA #3) — prevents a future implementer from chasing the broken narrative
- [ ] The LOCAL types vs markers.ts/config.ts decision is documented (GOTCHA #1) — prevents a future implementer from
      "DRY-ing" them into imports that break Pi-free
- [ ] No new environment variables or config (pure helper)

---

## Anti-Patterns to Avoid

- ❌ Don't import `RewindMarker`/`ShrinkMarker`/`MulliganConfig`/`Granularity` from `markers.ts`/`config.ts` (or
  `AgentMessage` from Pi) — it breaks the Pi-free invariant and the `grep -c '^import' → 0` gate. Declare the four types
  LOCALLY (structurally identical; a real one assigns in with no cast — GOTCHA #1).
- ❌ Don't partition ONCE before the rewind loop (the spec/06 §12 pseudocode's shape) — `resolveLastToolCallGroup`
  returns `unit.indices` that index the partitioned array, which is stale after the first rewind reduces `m`.
  RE-PARTITION fresh inside the loop per `last_tool_call_group` rewind (GOTCHA #2).
- ❌ Don't try to reproduce spec/06 §11's two-rewind narrative literally — it is mechanically impossible under §3's
  exclude-own-call rule (the older rewind resolves to the newer rewind's group, not an earlier mistake). Use a clean
  composition scenario (GOTCHA #3).
- ❌ Don't pass `ctx` to `resolveCheckpoint` — the LANDED pure resolver takes `branchEntries: BranchEntry[]` DATA.
  filterPipeline's 4th param is `branchEntries?`; pass it (or `[]`) — never `ctx` (GOTCHA #6).
- ❌ Don't add nudge logic to `filterPipeline` — the nudge (spec/06 §1 step 3) is `filter.ts`'s concern; the pipeline
  transforms markers ONLY (rewinds + shrinks — GOTCHA #13).
- ❌ Don't make `protectedOk` fail-open (allow removal) when config is missing/malformed — FAIL SAFE: enforce first:user
  (the original task is sacred — GOTCHA #10). Only disable when `protectedRoles` explicitly omits `"first:user"`.
- ❌ Don't assert the general `filterPipeline(filterPipeline(m)) === filterPipeline(m)` for `last_tool_call_group`
  rewinds — it does NOT hold under live re-resolution (after a rewind removes a group, re-running re-resolves to an
  earlier group). Assert SHRINK idempotency (strict) + DETERMINISM (always) instead (GOTCHA #8).
- ❌ Don't mutate the input `messages` array or the markers — `stableSortBySeq` returns a NEW array; `applyRewind`/
  `applyShrink` are already non-mutating; `filterPipeline` must be pure + side-effect-free.
- ❌ Don't rename `to_previous_prompt` to `toPreviousPrompt` — read it VERBATIM (snake_case) from `rw.options`
  (spec/04 §3; GOTCHA #5 — `toPreviousPrompt` in spec/06 §4 is a spec typo).
- ❌ Don't skip the property tests (spec/10 §3) — the item REQUIRES pairing invariant + idempotency + monotonic
  shrinkage. They are seeded + deterministic (mulberry32, no external dep) so they are fast + reproducible.