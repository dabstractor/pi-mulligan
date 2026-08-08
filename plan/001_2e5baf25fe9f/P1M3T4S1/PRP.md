# PRP — P1.M3.T4.S1: `applyRewind` — unit-aware gap-closing index removal

**Work item:** P1.M3.T4.S1 · **Points:** 0.5 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND ONE exported pure function to the EXISTING `src/transforms.ts`** and **APPEND ONE `describe`
block (+ a one-token import edit) to the EXISTING `test/transforms.test.ts`.** **No new file, no other file
touched.** Adds **ZERO imports** (`grep -c '^import' src/transforms.ts` → stays **0** — the module is Pi-free).
Reuses the in-scope `MessageLike` (T1.S1) only. This is **T4.S1 of the `transforms.ts` build** (spec/11 §2 Step 3):
it ships `applyRewind` — the pure gap-closing index-remover that `filterPipeline` (T5.S1) consumes as
`m = applyRewind(m, remove)` (spec/06 §12 L254, where the spec's pseudocode placeholder name is `removeIndices`).

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** The four earlier pure-core tasks are treated as **hard contracts**
> and have **LANDED** (verified live this session — `src/transforms.ts` is 533 lines, import count **0**, `tsc` exit 0,
> `vitest` 84 tests green; `test/transforms.test.ts` import line already includes
> `resolveCheckpoint, …, type BranchEntry`):
> 1. **P1.M3.T1.S1 (`partitionIntoUnits`) — LANDED.** `src/transforms.ts` + `test/transforms.test.ts` contain
>    `partitionIntoUnits`, `export interface Unit`, `export interface MessageLike`, module-private `isRecord` /
>    `readOwn`, and test fixtures `asst` / `asstText` / `result` / `user` / `custom` / `summary` / `expectPairingInvariant`.
> 2. **P1.M3.T2.S1 (`resolveLastToolCallGroup` + module-private `assistantIssuedCall`) — LANDED.**
> 3. **P1.M3.T2.S2 (`resolveLastTurn` + module-private `isMulliganCustomMessage`) — LANDED.**
> 4. **P1.M3.T3.S1 (`resolveCheckpoint` + `export interface BranchEntry` + module-private `entryMessageYield` /
>    `isContextProducingType`) — LANDED** (the parallel item this PRP was planned alongside — it shipped exactly as
>    its PRP specified).
>
> This task **APPENDS `applyRewind`** to the END of `src/transforms.ts` (after `isContextProducingType`, the current
> tail) and **APPENDS a `describe("applyRewind …")` block** to the END of `test/transforms.test.ts` (+ one-token
> import edit). Do NOT recreate, redefine, or re-import any symbol — `MessageLike` is already in module scope.
> `applyRewind` is the **DUMB** half of rewind: it touches **no message internals** (it filters by index only), so —
> uniquely among the transforms — it needs **no `isRecord`/`readOwn`** and is trivially safe against throwing-Proxy
> elements.

> **THE ONE LOAD-BEARING FACT (read before coding):** spec/06 §12 (the pipeline) calls the removal step
> `m = removeIndices(m, remove)` where `remove: number[]` comes from one of the three resolvers (or `[]` on a
> no-op). **That `removeIndices` placeholder and the canonical name `applyRewind` are the SAME function** —
> `applyRewind` is the name used everywhere else (spec/03 §2.3, spec/06 §3/§4) and the name this task exports. The
> resolvers (`resolveLastToolCallGroup`/`resolveLastTurn`/`resolveCheckpoint`) already computed **unit-aware**
> index sets (a toolGroup is removed as `[assistant, ...results]` together), so pairing is preserved **by
> construction** — `applyRewind` does NOT re-verify pairing (it cannot; it only sees indices, not content). Empty
> `remove` (a resolver returned `null`/`[]`) → return `messages` **unchanged (same reference)** — the documented
> idempotent no-op (spec/10 §1.4), matching the `applyShrink` precedent (spec/06 §5 L133 `if (i === null) return
> messages;`). Full proof + citations: §"Known Gotchas" below and `research/verification.md`.

---

## Goal

**Feature Goal**: Ship the **pure gap-closing index-remover** for Mulligan's rewind application —
`applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]` (spec/06 §3, §4, §12). Given a message
list and a set of indices to drop (computed by a unit-aware resolver), it returns a new array with those
indices removed and the gap closed (contiguous). It is the single call `filterPipeline` (P1.M3.T5.S1) makes per
rewind marker: `m = applyRewind(m, remove)`. Empty `remove` (or non-array/remove-with-no-numbers) →
`messages` **unchanged (same reference)** — the idempotent no-op. Pairing is preserved **by construction**
because the caller removed whole units; `applyRewind` itself only filters by index and touches no message
internals, so it is the ONE transform that needs no `isRecord`/`readOwn` and is trivially safe vs throwing-Proxy
elements.

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (file already exists, 533 lines, 0 imports): the EXPORTED
   `applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]`. **NO new imports** (reuse the
   in-scope `MessageLike` only). File import count stays **0**.
2. `test/transforms.test.ts` — APPEND (file already exists, 84 tests green): MODIFY the import line to add
   `applyRewind`, and ADD one new
   `describe("applyRewind — spec/10 §1.4 PINNED contract + defensive + composition", …)` block.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the existing transforms suite AND the appended `applyRewind` block; no
  pre-existing suite regresses (append-only to one src file + one test file).
- `applyRewind` **never throws** (E13; it sits on the `context` handler hot path via `filterPipeline`) —
  non-array `messages`/`remove`, out-of-range/negative/non-number/duplicate indices, and throwing-Proxy message
  elements are all handled gracefully.
- The **gap-close contract** holds: dropping indices yields a contiguous new array with the surviving elements
  shifted into place (no holes) — verified by `Array.filter` semantics + a structural assertion.
- The **idempotency contract** holds: empty `remove` returns the **same** array reference (`toBe`); a
  non-array `remove` likewise returns `messages` unchanged.
- The **pairing contract** holds: removing a whole toolGroup's indices leaves the surviving list with no orphan
  `toolCall`/`toolResult` (re-partition + `expectPairingInvariant`).
- The **last_turn composition** contract holds: `applyRewind(msgs, resolveLastTurn(msgs, {}, exclude).remove)`
  yields the tail `[user] + [mulligan:note] + [rewind asst + result]` with pairing intact.

---

## User Persona

**Target User**: The implementing AI agent for `filterPipeline` (P1.M3.T5.S1) — the **single pure-tier
consumer**. Per rewind marker (spec/06 §12), after a resolver produces `remove: number[]` and the
`protectedOk` guard passes, `filterPipeline` calls `m = applyRewind(m, remove)`. The SECOND consumer is the test
suite (this PRP).

**Use Case**: The agent called `mulligan_rewind({granularity:"last_tool_call_group", …})`. The marker persists.
Next inference → `context` handler → `filterPipeline` → `resolveLastToolCallGroup(units, m, excludeId)` returns
a toolGroup's `indices` (say `[3, 4]` = the bad assistant + its bloated result) → `remove = [3, 4]` →
`applyRewind(m, [3, 4])` drops both, closes the gap, and the model never sees the orphaned call or result.

**User Journey**:
1. A rewind marker is read by `readMarkers(ctx)` (P1.M4.T2). `filterPipeline` iterates rewinds oldest-first.
2. For each marker, a resolver (`resolveLastToolCallGroup`/`resolveLastTurn`/`resolveCheckpoint`) computes a
   **unit-aware** `remove: number[]` (or `[]` on a no-op — spec/08 E8).
3. `if (!protectedOk(m, remove, config)) continue;` (T5.S1's defense-in-depth — upstream of `applyRewind`).
4. `m = applyRewind(m, remove)` — **this function** — drops the indices, closes the gap, returns the new array.
5. Shrinks + nudges run next; the final `m` is cached as `rt.lastFiltered` for `mulligan_audit`.

**Pain Points Addressed**: The resolvers compute *what* to hide; `applyRewind` computes *how* to remove it
without leaving holes or breaking pairing. Keeping it a dumb, total, one-purpose pure function means the
pipeline's composition (multiple rewinds in sequence) is just repeated `m = applyRewind(m, remove)` — each pass
operates on the already-reduced list (spec/06 §1, §11 intent).

---

## Why

- **Unblocks rewind application end-to-end (at the pure tier).** `applyRewind` is the removal half of EVERY
  rewind granularity (spec/06 §3/§4/§6 each end with "`applyRewind` for this granularity = remove the resolved
  unit's indices, then close the gap"). Shipping it now (pure-core, unit-testable in isolation) lets T5.S1 focus
  on pipeline composition + protected-message checks + marker iteration, not on the mechanics of gap-closing.
- **Pairing safety by construction.** The model API rejects an orphaned `toolCall`/`toolResult`
  (`api_verification.md §6.4`). Because the resolvers emit whole-unit index sets and `applyRewind` removes them
  verbatim, both sides of every pair are removed together — the filtered view never orphans either side. This is
  the spec/06 §2 invariant ("All removal operations in Mulligan operate on units, never raw indices") made
  concrete at the removal step.
- **Pure-core tier & unit-testable in isolation.** `applyRewind` adds **NO new imports** (it reuses `MessageLike`
  already in `transforms.ts`). It is a pure, deterministic, side-effect-free function covered by fast unit tests
  with no Pi, no model, no session (spec/10 §1; spec/03 §7). It even fits a clean invariant/property test
  (monotonic shrinkage, idempotency — spec/10 §3).

---

## What

APPEND `applyRewind` to `src/transforms.ts`, and APPEND an `applyRewind` test block (+ one-token import edit) to
`test/transforms.test.ts`.

`applyRewind`:

- **Accepts** `messages: MessageLike[]` (a real Pi `AgentMessage[]` assigns in with no cast) and
  `remove: number[]` (ascending message indices to drop — from a resolver; possibly empty). Returns `MessageLike[]`.
- **Algorithm** (the entire body):
  1. If `messages` is not an array → return `[]` (defensive; mirrors `partitionIntoUnits` L113). If `remove` is
     not an array OR is empty → return `messages` **unchanged (same reference)** — the idempotent no-op
     (spec/10 §1.4; matches applyShrink §5:133).
  2. Build `removeSet = new Set<number>()` from `remove`'s **numeric** entries only. Non-numbers / out-of-range /
     negatives never match a valid array index → harmless (resolvers never emit those, but stay total). Dedup is
     free. If `removeSet.size === 0` → return `messages` unchanged (e.g. `remove = [NaN, "x"]`).
  3. `return messages.filter((_msg, i) => !removeSet.has(i));` — `Array.filter` yields a **contiguous** new array
     (gap closed for free — spec/06 §3/§4 "close the gap"). The callback **ignores the element** (`_msg`), so a
     throwing-Proxy element's get-trap **never fires** → `applyRewind` **never throws** on malformed/proxy
     messages (E13) even though it uses no `isRecord`/`readOwn`.

This subtask does **NOT**: implement `resolveShrinkTarget`/`applyShrink`/`filterPipeline`/`protectedOk`/`stableSortBySeq`
(later P1.M3 subtasks APPEND to this same file); import anything (the file is foundation-tier pure); redefine
`MessageLike`/`Unit`/`isRecord`/`readOwn`/`partitionIntoUnits`/`resolveLastToolCallGroup`/`resolveLastTurn`/
`resolveCheckpoint`/`assistantIssuedCall`/`isMulliganCustomMessage`/`BranchEntry` (reuse them); take `config` or a
marker or `ctx` (purity — `applyRewind` is a pure function of `(messages, remove)`); call `protectedOk` (that is
`filterPipeline`'s defense-in-depth — upstream of the call); re-verify pairing (the caller already guaranteed
unit-aware ranges); mutate `messages`; or read any message field (it filters by index only).

### Success Criteria

- [ ] `src/transforms.ts` has an EXPORTED `applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]`
      and **NO new imports** (`grep -c '^import' src/transforms.ts` → **0**).
- [ ] `test/transforms.test.ts` has a new `describe("applyRewind …")` block; the import line now includes
      `applyRewind`; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Basic removal + gap-close:** `applyRewind([u,a,r,u,t], [1,2])` → a 3-element array whose elements are the
      surviving `u0`, `u1`, `t` (indices renumbered contiguously — no holes).
- [ ] **Idempotent no-op:** `applyRewind(msgs, [])` returns `msgs` by **same reference** (`toBe(msgs)`); a
      non-array `remove` likewise returns `msgs` unchanged.
- [ ] **Pairing preserved (spec/10 §1.4 bullet 1):** removing a whole toolGroup's indices leaves the surviving
      list with no orphan toolCall/toolResult (re-partition + `expectPairingInvariant`).
- [ ] **last_turn composition (spec/10 §1.4 bullet 2):** `applyRewind(msgs, resolveLastTurn(msgs, {}, exclude).remove)`
      yields the tail `[user] + [mulligan:note] + [rewind asst + result]` (own unit + note survive), pairing intact.
- [ ] **Monotonic shrinkage (spec/10 §3):** `applyRewind(msgs, remove).length <= msgs.length` for any `remove`.
- [ ] **Defensive / never throws (E13):** non-array `messages` → `[]`; non-array `remove` → unchanged (same ref);
      out-of-range/negative/non-number/duplicate indices in `remove` → harmless; a throwing-Proxy message element
      is never read (filter ignores the element) → no throw.
- [ ] **Purity:** `applyRewind` never mutates its `messages` input.
- [ ] **Signature + return exact:** `applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `applyRewind` to APPEND is given verbatim below (Task 1), and the exact
> tests + import edit are given verbatim (Task 2). The algorithm is a 3-line `Array.filter` (spec-pinned at
> spec/06 §3/§4/§12); the idempotency rule is the `applyShrink` precedent (spec/06 §5:133); the never-throws
> discipline is inherited from the siblings (spec/08 E13); the composition test's expected `remove` is DERIVED by
> simulating `resolveLastTurn` (NOT copied from the internally-inconsistent spec/06 §11 example — see Known
> Gotcha #5). The only prerequisite is that the four earlier P1.M3 tasks have landed their symbols in
> `src/transforms.ts` (the parallel-execution contract — verified live). No prior knowledge beyond "this APPENDS
> a pure function to the existing transforms module and APPENDS its tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (533 lines, 0 imports).** Ship ONLY `applyRewind`
  (exported). REUSE the in-scope `MessageLike` — do NOT redefine or re-import it. Do NOT add `isRecord`/`readOwn`
  (this transform touches no message fields — it filters by index only). Later P1.M3 subtasks (applyShrink,
  filterPipeline) APPEND further to this same file.
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS (84 tests green).** Add ONE new `describe` block +
  MODIFY the import line (one token). Reuse the fixture helpers already defined: `asst`, `asstText`, `result`,
  `user`, `custom`, AND `partitionIntoUnits` + `resolveLastTurn` + `expectPairingInvariant` (all already
  imported/defined). Do NOT redefine any fixture or helper.

### Documentation & References

```yaml
# MUST READ — the removal step in the pipeline (the authoritative consumer contract)
- url: spec/06-context-filter.md  (read §3 L77-95, §4 L113-115, §12 L243-254)
  why: §3/§4 each end "applyRewind for this granularity = remove the resolved unit's indices (then close the gap)". §12 L254 is the single call site `m = removeIndices(m, remove)` — `removeIndices` is the pseudocode PLACEHOLDER name for THIS function (export as `applyRewind`).
  critical: "§12 L243 declares `let remove: number[]` — it is ALWAYS a number[] (possibly []) from a resolver or the [] of a no-op. The protectedOk guard (L253) runs BEFORE applyRewind and continues on failure → applyRewind is never reached on a protected-miss; it IS reached with remove=[] whenever a resolver returns null/empty. That empty path is the documented idempotent no-op."

# MUST READ — the tier-1 test contract for THIS function (verbatim)
- url: spec/10-testing.md §1.4 (L27-31)
  why: The 3 pinned bullets: (1) removing a toolGroup keeps pairing intact; (2) removing last_turn keeps the rewind's own unit + mulligan notes at the tail; (3) empty remove → input unchanged (idempotent). Plus §3 L56-60 properties (idempotency, monotonic shrinkage).
  critical: "§1.4 says 'input unchanged (idempotent)' — a CONTENT-equality phrasing. Returning the SAME reference is the strict reading + the applyShrink precedent (spec/06 §5:133); assert it with `toBe(msgs)` as an intentional strengthening (the spec does not MANDATE same-ref, but it is safe + preferred — see Known Gotcha #4)."

# MUST READ — the applyShrink same-reference precedent (proves the no-op-fast-path is the established convention)
- url: spec/06-context-filter.md §5 L133
  why: applyShrink does `if (i === null) return messages;` — returning the SAME array reference on a no-op is the spec's own pattern for a sibling transform. applyRewind mirrors it for empty remove.
  critical: "rt.lastFiltered cache + mulligan_audit are CONTENT consumers (§7 L174) — they never compare references. Same-ref ⇒ same contents ⇒ correct. PROVEN safe in research/verification.md §4."

# MUST READ — edge cases E8 (marker targets nothing → no-op) + E13 (never throws; fail-open)
- url: spec/08-edge-cases.md §E8 + §E13
  why: E8 = a resolver returns null/[] → applyRewind is reached with remove=[] → no-op (this is the idempotent path). E13 = every transform/handler must be wrapped / total — applyRewind never throws (non-array inputs, bad indices, throwing-Proxy elements all handled).
  critical: "applyRewind sits on the context-handler hot path via filterPipeline — a throw would break the turn. The Array.filter callback IGNORES the element, so a throwing-Proxy message is never introspected → no trap fires → never throws even without isRecord/readOwn."

# REFERENCE — the sibling resolvers that FEED this function (do NOT reimplement)
- file: src/transforms.ts
  why: resolveLastToolCallGroup (L223) returns a toolGroup's `indices` (number[]); resolveLastTurn (L319) returns `{ remove: number[] }`; resolveCheckpoint (L450) returns `{ remove: number[] } | null`. All three emit UNIT-AWARE index sets → applyRewind removes them verbatim → pairing preserved by construction.
  pattern: "applyRewind is the DUMB half: it trusts remove. It does NOT call protectedOk (that's filterPipeline's upstream guard) and does NOT re-partition (the caller already did)."

# REFERENCE — the function name + param-name divergences (do NOT be fooled)
- url: spec/06-context-filter.md §12 L254 + spec/03-architecture.md §2.3 L65
  why: §12 pseudocode names it `removeIndices`; spec/03 §2.3 names the param `range`. BOTH are older/placeholder names. The canonical name everywhere else (spec/03 §2.3 L65/96, spec/06 §3 L93, §4 L115, this task) is `applyRewind(messages, remove)`.
  gotcha: "Export as `applyRewind`. filterPipeline (T5.S1) writes `m = applyRewind(m, remove)` — NOT `removeIndices`. Same kind of spec divergence as the `u ? u.indices : []` already noted at src/transforms.ts:210."

# REFERENCE — the Pi-free module convention + MessageLike (the input type)
- file: src/transforms.ts L49-58 (MessageLike) + L1-30 (file-header DESIGN notes)
  why: transforms.ts is Pi-FREE (0 imports) — every function uses the LOCAL structural `MessageLike[]` (a real Pi AgentMessage[] assigns in with no cast). applyRewind uses `MessageLike[]`/`MessageLike[]`, NOT `AgentMessage[]` (the task prose's external-facing name). Adds 0 imports.
  gotcha: "Do NOT import AgentMessage from Pi — that would break the Pi-free invariant and the `grep -c '^import' → 0` gate."
```

### Current Codebase tree (relevant slice)

```bash
src/
  transforms.ts        # EXISTS (533 lines, 0 imports) — MessageLike(53), Unit(71), partitionIntoUnits(109),
                       #   resolveLastToolCallGroup(223), resolveLastTurn(319), BranchEntry(394),
                       #   resolveCheckpoint(450) + module-private isRecord/readOwn/assistantIssuedCall/
                       #   isMulliganCustomMessage/entryMessageYield/isContextProducingType (tail)
                       #   ← APPEND applyRewind AT THE END (after isContextProducingType). 0 new imports.
test/
  transforms.test.ts   # EXISTS (84 tests green) — import L2 already has resolveCheckpoint + type BranchEntry;
                       #   fixtures asst/asstText/result/user/custom/summary + expectPairingInvariant
                       #   ← APPEND applyRewind describe block + EDIT import line (add `applyRewind`).
spec/
  06-context-filter.md # §3/§4 = the applyRewind definitions per granularity; §12 L254 = the call site;
                       #   §5 L133 = applyShrink same-ref precedent; §11 = INCONSISTENT example (Known Gotcha #5)
  10-testing.md        # §1.4 = applyRewind tier-1 tests; §3 = idempotency + monotonic-shrinkage properties
  08-edge-cases.md     # E8 (no-op) + E13 (never throws)
plan/001_2e5baf25fe9f/P1M3T4S1/research/verification.md  # THIS ITEM's research (gates, gotchas, live-state proof)
```

### Desired Codebase tree with files to be added/modified

```bash
src/transforms.ts        # MODIFY (append): + applyRewind (exported). 0 new imports.
test/transforms.test.ts  # MODIFY (append + one-token edit): + describe("applyRewind …") block;
                         #   import line += applyRewind
# NO new files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — applyRewind is the DUMB half of rewind. It trusts `remove`. It does NOT call protectedOk,
//   does NOT call a resolver, does NOT take config/marker/ctx, does NOT re-partition. All of that is UPSTREAM in
//   filterPipeline (T5.S1, spec/06 §12 L243-254). applyRewind is a pure function of (messages, remove). If you find
//   yourself reaching for partitionIntoUnits or protectedOk inside applyRewind, STOP — you are reimplementing the
//   pipeline. applyRewind's entire body is: guard arrays → build a Set → Array.filter.

// GOTCHA #2 — the function is named `applyRewind`, NOT `removeIndices`. spec/06 §12 L254 pseudocode writes
//   `m = removeIndices(m, remove)`; `removeIndices` is the PLACEHOLDER name. The canonical name everywhere else
//   (spec/03 §2.3 L65/96, spec/06 §3 L93, §4 L115, this task) is `applyRewind`. Export `applyRewind`. filterPipeline
//   (T5.S1) writes `m = applyRewind(m, remove)`. (Same kind of spec divergence as the `u ? u.indices : []` note
//   at src/transforms.ts:210.)

// GOTCHA #3 — use MessageLike[], NOT AgentMessage[]. transforms.ts is Pi-FREE (0 imports — verified). All four
//   shipped siblings use the LOCAL structural MessageLike (src/transforms.ts:53); a real Pi AgentMessage[] assigns
//   in with no cast. The task prose's "AgentMessage[]" is the external-facing name. Importing AgentMessage from Pi
//   would BREAK the Pi-free invariant and the `grep -c '^import' → 0` gate.

// GOTCHA #4 — empty/non-array remove → return messages UNCHANGED (SAME REFERENCE), not a fresh copy. spec/10 §1.4
//   says "input unchanged (idempotent)" (content wording). Same-reference is the strict reading AND the established
//   convention: applyShrink does `if (i === null) return messages;` (spec/06 §5:133). It is SAFE for the
//   rt.lastFiltered cache + mulligan_audit (both are content consumers — §7 L174; proven in research §4). Assert it
//   with `expect(applyRewind(m, [])).toBe(m)` (an intentional strengthening — the spec mandates only content equality).

// GOTCHA #5 — spec/06 §11's two-rewind composition example is INTERNALLY INCONSISTENT with the §3
//   resolveLastToolCallGroup algorithm (proven in research §5). Its stated intermediate arrays
//   ([u0,a1,r1,a3,res3,note,a4,res4] → [u0,a3,res3,note,a4,res4]) do NOT follow from the resolver's "skip only the
//   excludeToolCallId's unit, walk end→start" rule. DO NOT copy §11 as a verbatim pipeline-test oracle. For THIS
//   task: (a) test applyRewind in isolation (trivial — drop indices, close gap); (b) for the composition test, DERIVE
//   the expected remove by simulating the resolver (e.g. resolveLastTurn) on hand-built input — do NOT trust §11's
//   stated targets. (Full-pipeline composition with §11's exact arrays is a T5.S1 concern, not this item's.)

// GOTCHA #6 — applyRewind NEVER throws (E13; context-handler hot path). It achieves this WITHOUT isRecord/readOwn
//   because it touches NO message internals — the Array.filter callback ignores the element (`_msg`). So a
//   throwing-Proxy message element's get-trap NEVER fires. The only guards needed: Array.isArray(messages) → [];
//   Array.isArray(remove) && remove.length>0 → else unchanged. Non-numbers/out-of-range/negatives in remove never
//   match a valid array index → harmless.

// GOTCHA #7 — pairing is preserved BY CONSTRUCTION, not by applyRewind's own logic. The resolvers emit whole-unit
//   index sets (a toolGroup = [assistant, ...results]); applyRewind removes them together → neither side is orphaned.
//   applyRewind CANNOT re-verify pairing (it sees only indices, not content). The pairing-preservation TEST works by
//   REMOVING a whole toolGroup's indices then RE-PARTITIONING the result and asserting no orphan via the existing
//   expectPairingInvariant helper — it proves the property end-to-end without applyRewind needing to know about it.

// GOTCHA #8 — Array.filter closes the gap for free. Do NOT hand-roll a splice loop or a manual compact: filter
//   returns a contiguous new array directly. That IS the gap-close (spec/06 §3/§4 "close the gap"). A splice loop
//   would be more error-prone (index-shift bugs) and would not be obviously total.
```

---

## Implementation Blueprint

### Data models and structure

No new types. `applyRewind` reuses the EXPORTED `MessageLike` (src/transforms.ts:53) already in module scope. It
introduces no interfaces, no classes, no module-private helpers.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: APPEND applyRewind to src/transforms.ts
  - IMPLEMENT: `export function applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]`
      (spec/06 §3/§4/§12; verbatim code below).
  - REUSE (do NOT redefine/import): MessageLike — already in module scope.
  - DO NOT add isRecord/readOwn (this transform touches no message fields — it filters by index only).
  - NAMING: applyRewind (exported fn), messages + remove (params; NOT range/removeIndices).
  - PLACEMENT: append at the END of src/transforms.ts (after isContextProducingType, the current tail).
  - VERIFY: `grep -c '^import' src/transforms.ts` → 0 (no new imports).

Task 2: APPEND applyRewind tests + EDIT the import line in test/transforms.test.ts
  - EDIT import line (L2): insert `applyRewind` into the existing destructure (after `resolveCheckpoint,`).
      Result: `import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint,
      applyRewind, type Unit, type MessageLike, type BranchEntry } from "../src/transforms.js";`
  - ADD: `describe("applyRewind — spec/10 §1.4 PINNED contract + defensive + composition", …)` with the verbatim
      tests below (idempotent no-op same-ref, basic removal + gap-close, pairing preserved, last_turn composition,
      non-array messages, non-array remove, harmful-indices harmless, throwing-Proxy never-read, monotonic
      shrinkage, purity/no-mutation, return type).
  - REUSE (do NOT redefine): fixtures asst/asstText/result/user/custom + partitionIntoUnits + resolveLastTurn +
      expectPairingInvariant + type MessageLike (all already imported/defined in the test file).
  - FOLLOW pattern: the existing describe blocks' style (spec-section pinning in the title, one it() per case).
  - COVERAGE: the 3 spec/10 §1.4 bullets + defensive + composition + monotonic shrinkage + purity + type.
  - PLACEMENT: append at the END of test/transforms.test.ts.

Task 3: VALIDATE (no code)
  - RUN: `npx tsc --noEmit -p tsconfig.json` → exit 0.
  - RUN: `npx vitest run test/transforms.test.ts` → all green (existing 84 + new block).
  - RUN: `npx vitest run` → all green, no regression in any suite.
  - RUN: `grep -c '^import' src/transforms.ts` → 0.
```

### Implementation Patterns & Key Details

```typescript
// ───────────── APPEND TO src/transforms.ts (verbatim) ─────────────

/**
 * applyRewind — the PURE gap-closing index-removal helper for rewind application (spec/06-context-filter.md
 * §3, §4, §12). The DUMB half of rewind: the resolvers (resolveLastToolCallGroup / resolveLastTurn /
 * resolveCheckpoint — sibling functions above) compute UNIT-AWARE `remove` index sets; `applyRewind` filters
 * those indices out and closes the gap. Pairing is preserved BY CONSTRUCTION because the caller already removed
 * whole units (a toolGroup's [assistant, ...results] go together — never orphaning either side — spec/06 §3/§4
 * "applyRewind for this granularity = remove the resolved unit's indices, then close the gap").
 *
 * CONTRACT (spec/06 §12 call site, `m = applyRewind(m, remove)`):
 *   - INPUT: `messages` (a real Pi AgentMessage[] assigns in with no cast via the MessageLike[] param), `remove`
 *     (a number[] of message indices to drop — ascending, from a resolver; possibly empty).
 *   - EMPTY `remove` (or a remove with no numeric entries) → return `messages` UNCHANGED (SAME reference). This
 *     is the documented idempotent no-op (spec/10 §1.4; spec/06 §12 reaches here with remove=[] whenever a
 *     resolver returns null/empty — spec/08 E8). Same-reference matches the applyShrink precedent (spec/06 §5
 *     L133) and is safe for the `lastFiltered` cache + mulligan_audit (content consumers — spec/06 §7 L174).
 *   - NON-ARRAY `messages` → return `[]` (defensive; mirrors partitionIntoUnits L113). NON-ARRAY `remove` → treat
 *     as no removal → return `messages` unchanged (same reference).
 *   - OUT-OF-RANGE / negative / non-number / duplicate entries in `remove` → harmless (they never match a valid
 *     array index). The resolvers never emit those, but the function stays TOTAL regardless.
 *
 * WHY filter (not a hand-rolled splice loop): `Array.filter` returns a CONTIGUOUS new array → the gap is closed
 * for free (spec/06 §3/§4 "close the gap"). The callback IGNORES the element (`_msg`) so a throwing-Proxy message
 * element's get-trap NEVER fires → applyRewind NEVER throws on malformed/proxy messages (spec/08 E13) even though
 * it uses no isRecord/readOwn — it is the ONE transform that touches no message internals (trivially safe vs the
 * siblings, which read role/content/customType).
 *
 * Pure + defensive + TOTAL: non-array messages → []; non-array/empty remove → messages unchanged; out-of-range/
 * negative/non-number/duplicate indices → harmless; throwing-Proxy elements → never read → never throws (E13;
 * context-handler hot path via filterPipeline T5.S1). Side-effect-free (never mutates `messages`). NO new imports
 * (reuses MessageLike already in module scope; `grep -c '^import' src/transforms.ts` stays 0).
 *
 * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → []
 * @param remove ascending message indices to drop (from a resolver); empty/non-array → messages unchanged
 * @returns a NEW array with `remove` indices dropped (gap closed); the SAME array reference when nothing is removed
 */
export function applyRewind(messages: MessageLike[], remove: number[]): MessageLike[] {
  // Defensive: a non-array messages (shouldn't happen) → []. Non-array/empty remove → messages unchanged (no-op).
  if (!Array.isArray(messages)) return [];
  if (!Array.isArray(remove) || remove.length === 0) return messages;

  // Build a Set of NUMERIC removal indices. Non-numbers / out-of-range / negatives never match a valid array
  // index → harmless (the resolvers never emit those, but stay total). Dedup is free.
  const removeSet = new Set<number>();
  for (const r of remove) {
    if (typeof r === "number") removeSet.add(r);
  }
  if (removeSet.size === 0) return messages; // no valid indices → unchanged (idempotent)

  // Filter out the indices to remove; Array.filter yields a contiguous new array (gap closed — spec/06 §3/§4).
  // The callback IGNORES the element → a throwing-Proxy element's get-trap never fires → never throws (E13).
  return messages.filter((_msg, i) => !removeSet.has(i));
}
```

```typescript
// ───────────── APPEND TO test/transforms.test.ts (verbatim) ─────────────
// (Also EDIT L2 import — see Task 2.) REUSE the existing fixtures/helpers: asst, asstText, result, user, custom,
// partitionIntoUnits, resolveLastTurn, expectPairingInvariant, type MessageLike. Do NOT redefine any.

describe("applyRewind — spec/10 §1.4 PINNED contract + defensive + composition", () => {
  it("empty remove → input UNCHANGED — SAME reference (idempotent; applyShrink §5:133 precedent)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    // Intentional strengthening: spec says "input unchanged" (content); same-ref is the strict reading + convention.
    expect(applyRewind(msgs, [])).toBe(msgs);
  });

  it("basic removal + gap-close: drop middle indices → contiguous result, no holes, elements renumbered", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c1"), result("c1"), user("u1"), asstText("x")];
    // remove indices 1,2 (an asst+result toolGroup) → survivors [u0, u1, asstText] shift into 0,1,2 (gap closed).
    const out = applyRewind(msgs, [1, 2]);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
    expect(out[0]).toBe(msgs[0]); // u0 preserved
    expect(out[1]).toBe(msgs[3]); // u1 shifted into index 1 (gap closed)
    expect(out[2]).toBe(msgs[4]); // asstText shifted into index 2 (gap closed)
  });

  it("spec/10 §1.4 bullet 1 — removing a toolGroup unit keeps pairing intact (no orphan results/calls)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1"), asst("c2"), result("c2"), asstText("tail")];
    // Partition → toolGroup{1,2}, toolGroup{3,4}, plain{0}, plain{5}. Remove the FIRST toolGroup (its indices).
    const units = partitionIntoUnits(msgs);
    const firstToolGroup = units.find((u) => u.kind === "toolGroup")!;
    const out = applyRewind(msgs, firstToolGroup.indices);
    // Re-partition the result + assert NO orphan: every remaining toolResult has a matching assistant & vice versa.
    expectPairingInvariant(out, partitionIntoUnits(out));
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]); // 2nd toolGroup + tail survive
  });

  it("spec/10 §1.4 bullet 2 — removing last_turn keeps the rewind's OWN unit + mulligan notes at the tail (composition)", () => {
    // [user(u1), asst(grep), result(grep), mulligan:note, asst(rewind), result(rewind)]
    // resolveLastTurn default (exclude the rewind's call) → remove the grep toolGroup (idx 1,2); KEEP the note
    // (idx3) + the rewind's own unit (idx4,5). applyRewind closes the gap → tail keeps note + own unit.
    const exclude = "rewind-call";
    const msgs: MessageLike[] = [
      user("u1"), asst("grep"), result("grep"), custom("mulligan:note"), asst(exclude), result(exclude),
    ];
    const { remove } = resolveLastTurn(msgs, {}, exclude);
    expect(remove).toEqual([1, 2]); // the resolver computed a UNIT-AWARE removal (DERIVED by simulation — NOT copied from spec/06 §11)
    const out = applyRewind(msgs, remove);
    expect(out.map((m) => m.role)).toEqual(["user", "custom", "assistant", "toolResult"]); // tail = [user] + [note] + [rewind asst + result]
    expect((out[1] as MessageLike).customType).toBe("mulligan:note"); // the note survived
    expect(out[2]).toBe(msgs[4]); // the rewind's OWN assistant survived
    expect(out[3]).toBe(msgs[5]); // the rewind's OWN result survived
    expectPairingInvariant(out, partitionIntoUnits(out)); // no orphans
  });

  it("defensive: non-array messages → [] (mirrors partitionIntoUnits)", () => {
    expect(applyRewind(null as unknown as MessageLike[], [1])).toEqual([]);
    expect(applyRewind(undefined as unknown as MessageLike[], [0])).toEqual([]);
  });

  it("defensive: non-array remove → messages UNCHANGED (same reference, treated as no removal)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    expect(applyRewind(msgs, null as unknown as number[])).toBe(msgs);
    expect(applyRewind(msgs, undefined as unknown as number[])).toBe(msgs);
  });

  it("defensive: out-of-range / negative / non-number / duplicate indices in remove are HARMLESS", () => {
    const msgs: MessageLike[] = [user("a"), user("b"), user("c")];
    // remove=[1, 1, 99, -3, NaN, "x"] → only index 1 is a valid match → [a, c].
    expect(applyRewind(msgs, [1, 1, 99, -3, NaN, "x" as unknown as number])).toEqual([msgs[0], msgs[2]]);
    // remove with NO valid numbers → unchanged (same reference).
    expect(applyRewind(msgs, [NaN, "y" as unknown as number])).toBe(msgs);
  });

  it("spec/08 E13 — NEVER throws: a throwing-Proxy element is never read (the filter callback ignores the element)", () => {
    const trap: MessageLike = new Proxy(
      { role: "user", content: "x" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("keep"), trap, user("also")];
    // Removing index 1 (the trap) must not crash: filter never reads the trap's properties.
    expect(() => applyRewind(msgs, [1])).not.toThrow();
    expect(applyRewind(msgs, [1])).toHaveLength(2);
    // Keeping the trap (removing a DIFFERENT index) must not crash either — the trap element is only copied by
    // reference into the result array, never introspected.
    expect(() => applyRewind(msgs, [0])).not.toThrow();
    expect(applyRewind(msgs, [0])).toHaveLength(2);
  });

  it("spec/10 §3 — monotonic shrinkage: result.length <= messages.length for any remove", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), asstText("t")];
    expect(applyRewind(msgs, []).length).toBeLessThanOrEqual(msgs.length);
    expect(applyRewind(msgs, [1, 2]).length).toBeLessThanOrEqual(msgs.length);
    expect(applyRewind(msgs, [0, 1, 2, 3]).length).toBeLessThanOrEqual(msgs.length);
  });

  it("purity: never mutates the input array (filter returns a new array; empty path returns the same unmuted ref)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    const snapshot = [...msgs];
    applyRewind(msgs, [1]);
    applyRewind(msgs, []);
    expect(msgs).toEqual(snapshot); // input untouched
    expect(msgs).toHaveLength(3);
  });

  it("returns MessageLike[] (the array type, not null/wrapped)", () => {
    expectTypeOf(applyRewind([], [])).toEqualTypeOf<MessageLike[]>();
    expectTypeOf(applyRewind([user("u")], [0])).toEqualTypeOf<MessageLike[]>();
  });
});
```

### Integration Points

```yaml
MODULE (src/transforms.ts):
  - append: "export function applyRewind(...) at END of file (after isContextProducingType)"
  - imports: "ZERO new imports (reuse MessageLike in module scope); grep -c '^import' → 0"

TEST (test/transforms.test.ts):
  - edit import L2: "add `applyRewind` to the existing destructure (after `resolveCheckpoint,`)"
  - append: "describe('applyRewind — spec/10 §1.4 PINNED contract + defensive + composition', …) at END of file"

DOWNSTREAM CONSUMER (NOT this task — P1.M3.T5.S1 filterPipeline):
  - call site: "m = applyRewind(m, remove);  // spec/06 §12 L254 (pseudocode names it removeIndices)"
  - note: "filterPipeline feeds applyRewind a resolver's unit-aware remove + runs protectedOk UPSTREAM; applyRewind is the dumb gap-closer"
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending applyRewind — fix before proceeding
npx tsc --noEmit -p tsconfig.json   # Type check the whole project (the function is in src/transforms.ts)
# Expected: exit 0 (no errors). If errors exist, READ the output and fix before proceeding.

# Pi-free invariant (the module's foundational constraint)
grep -c '^import' src/transforms.ts
# Expected: 0. If >0, you accidentally imported something (e.g. AgentMessage) — remove it; use MessageLike.
```

> This project has NO linter/formatter configured (no eslint/ruff/prettier in package.json) — the gates are
> `tsc` (type check) + `vitest` (tests) + the `grep -c '^import' → 0` Pi-free invariant. Do NOT invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# Test applyRewind (and the whole transforms suite — append-only, so no regression)
npx vitest run test/transforms.test.ts
# Expected: ALL green (the existing 84 tests + the new applyRewind block). If failing, debug root cause and fix.

# Full test suite (no regression in any other suite — ledger/tokens/notes/config/log/runtime/markers/tools)
npx vitest run
# Expected: all green.
```

### Level 3: Integration Testing (System Validation)

```bash
# applyRewind is a PURE helper with NO Pi dependency, so there is no service to start / endpoint to hit.
# Its "integration" is its composition with a resolver — already covered by the spec/10 §1.4 bullet-2 test
# (applyRewind(msgs, resolveLastTurn(msgs, {}, exclude).remove) yields the correct tail).

# (Optional) sanity-build the project to confirm the dist compiles (the extension entry is src/index.ts):
npx tsc -p tsconfig.json
# Expected: dist/ builds cleanly (exit 0). This is NOT required for this task (pure-helper), but confirms no
# breakage downstream.

# Expected: pure helper compiles + all tests green. No service/endpoint/MCP/database integration for this item.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Pairing-invariant spot check (the cardinal rule — spec/06 §2, api_verification.md §6.4): build a message list
# with two toolGroups, remove one whole toolGroup's indices via applyRewind, then re-partition and assert the
# result has NO orphan toolCall/toolResult. This is already the "spec/10 §1.4 bullet 1" test above; re-run it
# explicitly to confirm:
npx vitest run test/transforms.test.ts -t "removing a toolGroup unit keeps pairing intact"
# Expected: 1 test passed.

# Idempotency spot check (spec/10 §3): empty remove → same reference, length never increases:
npx vitest run test/transforms.test.ts -t "empty remove → input UNCHANGED"
npx vitest run test/transforms.test.ts -t "monotonic shrinkage"
# Expected: both pass.

# Expected: pairing intact, idempotent, monotonic. (No perf/security/load gates for a 0.5-pt pure helper.)
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed successfully
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0
- [ ] `npx vitest run` is all-green (no regression; new applyRewind block passes)
- [ ] `grep -c '^import' src/transforms.ts` → **0** (Pi-free invariant preserved)

### Feature Validation

- [ ] All success criteria from "What" section met
- [ ] spec/10 §1.4 bullet 1 (toolGroup removal keeps pairing) — test green
- [ ] spec/10 §1.4 bullet 2 (last_turn keeps own unit + notes) — composition test green
- [ ] spec/10 §1.4 bullet 3 (empty remove → unchanged) — same-ref test green
- [ ] Defensive cases (non-array messages/remove, bad indices, throwing-Proxy) never throw — tests green
- [ ] Monotonic shrinkage + purity properties — tests green

### Code Quality Validation

- [ ] Follows existing codebase patterns (pure, defensive, total, JSDoc-pinned to spec sections — mirrors the siblings)
- [ ] File placement matches the desired tree (append to src/transforms.ts + test/transforms.test.ts; no new files)
- [ ] Anti-patterns avoided (see below)
- [ ] ZERO new imports (reuses MessageLike; does not import AgentMessage/Pi/config/log)
- [ ] applyRewind is a dumb index-remover — does NOT reimplement resolver/protectedOk/pipeline logic

### Documentation & Deployment

- [ ] Code is self-documenting (JSDoc pins spec/06 §3/§4/§12 + spec/08 E13 + the applyShrink §5:133 precedent)
- [ ] The `removeIndices` vs `applyRewind` naming divergence is documented in JSDoc (prevents a future implementer
      from "fixing" the name)
- [ ] No new environment variables or config (pure helper)

---

## Anti-Patterns to Avoid

- ❌ Don't hand-roll a splice/compact loop — `Array.filter` closes the gap for free and is obviously total.
- ❌ Don't add `isRecord`/`readOwn` to applyRewind — it touches NO message fields (filters by index only); adding
  them is dead code and implies (wrongly) that it reads message content.
- ❌ Don't call `protectedOk`/a resolver/`partitionIntoUnits` INSIDE applyRewind — that is `filterPipeline`'s job
  (upstream of the call). applyRewind trusts `remove`.
- ❌ Don't return a fresh copy on empty `remove` — return the SAME reference (the applyShrink §5:133 precedent;
  the idempotent optimum). A fresh copy would still pass content checks but breaks the intentional strengthening.
- ❌ Don't import `AgentMessage` from Pi (or anything) — it breaks the Pi-free invariant and the `grep -c '^import' → 0` gate.
- ❌ Don't name it `removeIndices` (the spec/06 §12 pseudocode placeholder) — the canonical/exported name is `applyRewind`.
- ❌ Don't copy spec/06 §11's stated arrays as a pipeline-test oracle — that example is internally inconsistent
  with the §3 algorithm (proven in research §5). Derive expected output by simulating the resolver instead.
- ❌ Don't skip the throwing-Proxy test — it PROVES applyRewind never throws without isRecord/readOwn (the
  callback ignores the element), which is this function's distinctive safety property.