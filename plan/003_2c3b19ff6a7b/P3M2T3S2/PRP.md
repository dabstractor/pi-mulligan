# PRP — P3.M2.T3.S2: Soft cap — retire oldest shrink when active count exceeds maxActive

## Goal

**Feature Goal**: Add the **soft cap** to `contextHandler`: when the number of *active* shrink
markers exceeds `config.shrink.maxActive` (default 32), auto-retire the **oldest** one (lowest
`seq`) by appending a `mulligan:cancel` — the same retraction primitive the `mulligan_cancel` tool
and the S1 stale-retirement pass use. This bounds long-session filter cost (spec/08 **E15**,
REQUIRED): the active shrink set can never grow unbounded.

**Deliverable**:
- `src/filter.ts` — modified: a 6-line soft-cap block, placed **inside** S1's existing inner
  try/catch (the stale-retirement one), **after** the stale `for`-loop and **before** that try's
  closing brace. Plus one new value import (`stableSortBySeq` from `./transforms.js`).
- `test/filter.test.ts` — modified: a `contextHandler — soft cap` describe block (≈6 cases).
- `spec/06-context-filter.md` — modified: extend the §1 retirement note S1 added with one
  soft-cap sentence (Mode A: doc rides with the work).

**Success Definition**:
- When `markers.shrinks.length > config.shrink.maxActive`, the lowest-`seq` active shrink is
  retired: `appendCancelMarker` is called with `data.targetId === oldest.id`.
- Exactly **ONE** shrink is retired per fire (bounded, eventual — N over the cap takes N fires).
- When `length <= maxActive` (including equal), **no** cancel is appended.
- The cap never throws — it lives inside S1's inner try/catch (a throwing `stableSortBySeq` /
  `appendCancelMarker` is swallowed; the turn still returns `{ messages }` unchanged — E13).
- `npx tsc --noEmit` clean; `npm test` green (no regressions).

## Why

- Implements the second half of spec/08 **E15 (REQUIRED)**: *"Active shrink markers are
  additionally capped at `config.shrink.maxActive` (default 32, mirroring `rewind.maxDepth`);
  when exceeded, the oldest is retired."* The first half (stale-marker retirement) is S1; this is
  the cap.
- It is a tiny, additive delta on S1's landed retirement machinery: it reuses S1's `pi`-threading,
  S1's inner try/catch, the already-landed `appendCancelMarker` (P3.M1.T1.S1), and the already-landed
  config knob `shrink.maxActive` (P3.M2.T1.S1). No new data model, no new config, no new runtime
  state. The cap and the stale pass are the two halves of the same E15 long-session cost bound.

## What

**User-visible behavior**: None directly — automatic background maintenance on the filter hot path.
The observable effect is that, in a very long session with many accumulated shrinks, the oldest
shrinks beyond `maxActive` stop applying (their substitution no longer appears) on successive fires,
and `mulligan_audit` (P3.M1.T4.S1) reports them as retired (the appended `mulligan:cancel` flows
through `readMarkers.cancelledIds`).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. **Placement**: inside S1's existing retirement `try { ... } catch (retireErr) { ... }` block,
   AFTER the stale `for`-loop, BEFORE the closing brace of the `try`. (The contract: *"Wrap in the
   same try/catch as the stale pass."*)
2. **Logic**:
   ```typescript
   if (markers.shrinks.length > config.shrink.maxActive) {
     const oldest = stableSortBySeq(markers.shrinks)[0];
     if (oldest) {
       const id = readOwn(oldest, "id");
       if (typeof id === "string" && id.length > 0) {
         appendCancelMarker(pi, ctx, { targetId: id });
       }
     }
   }
   ```
3. **Strict `>`**: `length === maxActive` does NOT retire (equal is not "exceeds").
4. **Exactly ONE per fire**: no loop. If exceeded by N, it takes N fires to bring it under the cap.
5. **Oldest = lowest `seq`**: `stableSortBySeq` sorts ascending; `[0]` is the oldest. (A shrink with
   a non-finite/missing `seq` is treated as 0 by `stableSortBySeq` → sorted first → retired first;
   safest interpretation.)
6. **targetId = the shrink's uuid `id`** (read via `readOwn`), NOT the Pi entry id. Same as the
   stale pass and the cancel tool.
7. **Next-fire effect**: the appended cancel takes effect on the NEXT `context` fire (`readMarkers`
   drops the cancelled id from `markers.shrinks`). No in-fire mutation.
8. **Never throws**: the cap is inside S1's inner try/catch (E13 isolation). A throwing
   `stableSortBySeq`/`appendCancelMarker` is logged + swallowed; the turn returns the already-computed
   `{ messages }`.

### Success Criteria
- [ ] Soft-cap block present inside S1's retirement try/catch, after the stale loop.
- [ ] `length > maxActive` → ONE `appendCancelMarker` with `targetId === lowest-seq` shrink's `id`.
- [ ] `length <= maxActive` (incl. equal) → no cancel appended.
- [ ] Exactly one retirement per fire (firing once with `maxActive=1` and 3 active shrinks → exactly
      ONE cancel, not 2).
- [ ] Cap never throws (a throwing `appendEntry`/`stableSortBySeq` is swallowed; turn returns
      `{ messages }` unchanged).
- [ ] `stableSortBySeq` added to the transforms.js **value** import in filter.ts.
- [ ] `npx tsc --noEmit` clean; `npm test` green.
- [ ] `spec/06-context-filter.md` §1 note extended with the soft-cap sentence.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP names: the EXACT insertion point (inside S1's retirement try/catch — quoted
verbatim so the implementer can locate it even though S1 lands first); the EXACT cap code
(verbatim, 6 lines); the EXACT symbol to import (`stableSortBySeq`, exported transforms.ts:1068)
and the import line to edit (S1's resolved `import { filterPipeline, resolvePinnedShrink } from
"./transforms.js";`); the EXACT test fakes to reuse (`shrinkData`, `customEntry`,
`makeCancelEntry`, `makeCtx`, `makePi` — with S1's `appendCalls` capture); the EXACT config override
(`setConfig({ shrink: { maxActive: 2 } })` deep-merges, verified); and the EXACT dependency state
(every upstream item, with evidence + status). An implementer who has never seen this repo can do it
from this document + `src/filter.ts` (post-S1) + `test/filter.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file you are editing (use the POST-S1 state; S1 lands first)
- file: src/filter.ts
  why: |
    Contains contextHandler. After S1 lands, contextHandler has signature (pi, event, ctx) and an
    INNER try/catch retirement block (its own try { stale-pass } catch (retireErr) { log }) placed
    AFTER the observability try/catch and BEFORE the final `return { messages: ... }`. This task
    ADDS the cap block INSIDE that same try, after the stale for-loop.
  pattern: |
    // S1's block (the insertion target). The cap goes on the line AFTER the stale `for` closes:
    try {
      const staleAfterFires = config.shrink.staleAfterFires;
      for (const sh of markers.shrinks) {
        const pinnedEntryId = readOwn(sh, "pinnedEntryId");
        if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) continue;
        const id = readOwn(sh, "id");
        if (typeof id !== "string" || id.length === 0) continue;
        const hit = resolvePinnedShrink(event.messages as unknown as MessageLike[],
          branchEntries as unknown as BranchEntry[], pinnedEntryId) !== null;
        if (hit) rt.shrinkMissCounts.set(id, 0);
        else {
          const misses = (rt.shrinkMissCounts.get(id) ?? 0) + 1;
          rt.shrinkMissCounts.set(id, misses);
          if (misses >= staleAfterFires) appendCancelMarker(pi, ctx, { targetId: id });
        }
      }
      // <── P3.M2.T3.S2 SOFT CAP GOES HERE ──>
    } catch (retireErr) {
      try { log("warn", "filter.retire", sessionId, { error: retireErr instanceof Error ? retireErr.message : String(retireErr) }); } catch { /* safe */ }
    }
  section: contextHandler retirement try/catch (between the observability block and the final return)
  gotcha: |
    The cap REUSES the already-read locals `markers`, `config`, `pi`, `ctx` (all in scope inside the
    try) — do NOT re-fetch. `markers.shrinks` is the ACTIVE set (readMarkers already cancel-dropped
    it), so `.length` is the live count — no re-filter.

# MUST READ — the helper to import + reuse
- file: src/transforms.ts
  why: |
    stableSortBySeq<T extends {seq?:unknown}>(markers): T[] (line 1068, EXPORTED) returns a NEW array
    sorted ASCENDING by seq (oldest-first); defensive (non-finite/missing seq → 0; never throws;
    never mutates input). This is the SAME helper filterPipeline uses to apply shrinks oldest-first.
    Reuse it — do NOT reimplement min-by-seq (readOwnSeq, the seq reader, is module-private here).
  pattern: |
    const oldest = stableSortBySeq(markers.shrinks)[0];   // lowest seq; undefined if empty
  section: stableSortBySeq (lines 1055-1073)
  gotcha: |
    It is a VALUE export (a function), not a type. S1 already changed filter.ts's transforms import
    line to `import { filterPipeline, resolvePinnedShrink } from "./transforms.js";` — ADD
    stableSortBySeq to that SAME line → `import { filterPipeline, resolvePinnedShrink,
    stableSortBySeq } from "./transforms.js";`. Do NOT make it a type-only import.

# MUST READ — the test file to extend (use the POST-S1 state)
- file: test/filter.test.ts
  why: |
    Reuse the existing fakes: shrinkData(seq, id?) (builds a LIVE shrink — NO pinnedEntryId, so S1's
    stale pass `continue`s and the cap is isolated), customEntry(type, data), makeCancelEntry(id)
    (a mulligan:cancel entry — add to the fixture between fires to simulate "next fire the cancel
    has taken effect"), makeCtx({entries, branch, sessionId}), makePi() → S1 extended to return
    { handlers, appendCalls, pi } capturing appendEntry(customType, data). setConfig deep-merges
    per-leaf so setConfig({ shrink: { maxActive: 2 } }) sets ONLY maxActive (keeps staleAfterFires=3,
    enabled=true).
  pattern: |
    beforeEach(() => setConfig({ shrink: { maxActive: 2 } }));          // within the describe
    const { pi, appendCalls } = makePi();
    const entries = [
      customEntry("mulligan:shrink", shrinkData(5, "sh-5")),
      customEntry("mulligan:shrink", shrinkData(3, "sh-3")),   // lowest seq → will be retired
      customEntry("mulligan:shrink", shrinkData(4, "sh-4")),
    ];
    const ctx = makeCtx({ entries });
    const result = contextHandler(pi, { type: "context", messages: [] }, ctx);
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0].customType).toBe("mulligan:cancel");
    expect((appendCalls[0].data as { targetId: string }).targetId).toBe("sh-3");
  section: fakes (lines 51-112) + contextHandler describe (~281-392)
  gotcha: |
    pipelineReturn (module-level) controls the mocked filterPipeline output; default [] → the cap
    tests don't care about messages, only appendCalls. If a test asserts the RETURN, set
    pipelineReturn = [{role:"user",content:"OK"}] first. makeCtx.getEntries returns a FIXED array;
    the fake pi.appendEntry does NOT feed back into it — so multi-fire "next-fire drop" tests must
    MANUALLY append a makeCancelEntry(id) to the entries between fires (mirror the readMarkers
    cancel-drop tests at lines 183-279).

# CONTRACT — contextHandler pi-threading + retirement try/catch (S1, implementing in parallel)
- file: src/filter.ts  (per plan/003_2c3b19ff6a7b/P3M2T3S1/PRP.md)
  why: |
    S1 (a) changes contextHandler signature to (pi, event, ctx); (b) changes registerFilterHandler
    to pi.on("context", (event, ctx) => contextHandler(pi, event, ctx)); (c) adds the value imports
    appendCancelMarker (markers.js) + resolvePinnedShrink (transforms.js); (d) adds the stale-pass
    inside its OWN inner try/catch (the insertion target above); (e) extends makePi() with appendEntry
    capture → appendCalls, and updates the 14 contextHandler call sites with a pi arg. THIS TASK
    assumes all of that has landed; it only ADDS the cap block + the stableSortBySeq import + tests
    + a doc sentence. Do NOT redo S1's work.

# CONTRACT — config knob (already-landed by P3.M2.T1.S1)
- file: src/config.ts
  why: |
    config.shrink.maxActive (number, default 32, integer-validated via coerceNumber(...,true)) is the
    cap threshold. Read via the already-obtained `config` local in contextHandler — reuse it. (The
    sibling knob staleAfterFires is S1's; the enabled flag is the master switch, already checked at
    the top of contextHandler — when disabled, contextHandler returns before the retirement block, so
    the cap never runs while disabled.)
  gotcha: `>` strict. Equal (length === maxActive) does NOT retire.

# CONTRACT — appendCancelMarker (already-landed by P3.M1.T1.S1)
- file: src/markers.ts
  why: |
    appendCancelMarker(pi, ctx, { targetId }): string | null — dumb persistence; NEVER throws (returns
    null on failure). targetId = the marker's uuid `id`. Do NOT pre-validate targetId existence —
    markers.shrinks is already the active set. Return value is IGNORED (fire-and-forget; next fire's
    readMarkers drops the cancelled id).
  pattern: appendCancelMarker(pi, ctx, { targetId: id });   // id = readOwn(oldest, "id")

# Architecture reference (read-only; the verified pattern)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  why: "Pattern 7 (Stale retirement + cap) sketches BOTH halves. This task implements the CAP half
        only (the `if (markers.shrinks.length > maxActive) { retire oldest by seq }` tail). The
        stale-retirement half is S1."
  section: "G2 / P3.M2 — Pattern 7 (cap half only)"

# Spec source (read-only context)
- docfile: spec/08-edge-cases.md
  section: "E15. Very large number of accumulated markers/notes (long sessions)" + "E21. Marker retraction"
  why: E15 (REQUIRED) mandates the cap ("Active shrink markers are additionally capped at
       config.shrink.maxActive ... when exceeded, the oldest is retired"). E21 defines the
       mulligan:cancel retraction this reuses.
- docfile: spec/06-context-filter.md
  section: "§1. The handler (glue)"
  why: §1 is the authoritative contextHandler contract; S1 added a stale-retirement note there —
       this task EXTENDS it with the cap sentence.
```

### Current Codebase tree (relevant slice)

```bash
src/
  filter.ts            # <-- MODIFY: + stableSortBySeq import; + cap block inside S1's retirement try/catch
  transforms.ts        # read-only dep (stableSortBySeq — exported, Pi-free, defensive; already used by filterPipeline)
  markers.ts           # read-only dep (appendCancelMarker — landed; ShrinkMarker.id/seq shape)
  config.ts            # read-only dep (shrink.maxActive — landed)
  runtime.ts           # NO CHANGE (shrinkMissCounts is S1's; cap needs no runtime state)
  index.ts             # NO CHANGE (registerFilterHandler(pi) signature unchanged by S1/S2)
test/
  filter.test.ts       # <-- MODIFY: + a `contextHandler — soft cap` describe block (≈6 cases)
spec/
  06-context-filter.md # <-- MODIFY: extend the §1 retirement note with one cap sentence
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/filter.ts              # EXTENDED in place (no new file). contextHandler retirement try/catch gains the cap tail.
test/filter.test.ts        # EXTENDED in place. + soft-cap describe block (reuses shrinkData/customEntry/makeCancelEntry/makeCtx/makePi).
spec/06-context-filter.md  # EXTENDED in place. §1 note += one soft-cap sentence.
# No new files. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — place the cap INSIDE S1's retirement try/catch, after the stale for-loop, NOT in a new
//   try/catch and NOT outside the existing one. The contract is explicit: "Wrap in the same try/catch
//   as the stale pass." A separate try/catch would work but diverges from the contract; placing it
//   OUTSIDE the try would let a cap throw reach the OUTER catch (→ void/pass-through → the turn LOSES
//   the entire filter transform — an E13 violation). The cap MUST be inside the inner try/catch.

// CRITICAL — REUSE in-scope locals. Inside S1's try block, `markers`, `config`, `pi`, `ctx` are all
//   already in scope (obtained at the top of contextHandler). Do NOT re-fetch getConfig/getRuntime.
//   markers.shrinks is the ACTIVE set (readMarkers cancel-dropped) — its .length is the live count.

// CRITICAL — `>` strict (exceeds), NOT `>=`. length === maxActive does NOT retire. Mirrors the
//   contract: "when active count EXCEEDS maxActive".

// CRITICAL — exactly ONE retire per fire. NO loop. if (length > maxActive) { … ONE append … }. If the
//   active set is over the cap by N, it takes N fires to bring it under (bounded, eventual — acceptable).

// CRITICAL — read oldest.id via readOwn(oldest, "id"), never bare .id. readOwn (module-private in
//   filter.ts) swallows Proxy get-trap throws → undefined. Guard: typeof id === "string" && id.length > 0.

// CRITICAL — stableSortBySeq is a VALUE import. Add it to the transforms.js value-import line (S1
//   resolved that line to `import { filterPipeline, resolvePinnedShrink } from "./transforms.js";`).
//   Make it: `import { filterPipeline, resolvePinnedShrink, stableSortBySeq } from "./transforms.js";`
//   A type-only import would compile away → runtime "stableSortBySeq is not a function".

// GOTCHA — stableSortBySeq never throws and never mutates; it returns a NEW sorted array. Allocating
//   it once per fire on markers.shrinks (≤ ~32 in pathological cases, usually single digits) is negligible.

// GOTCHA — a double cancel is harmless. The cap targets the OLDEST (lowest seq); a shrink just retired
//   by the STALE pass THIS fire might also be the oldest → two mulligan:cancel entries with the same
//   targetId this fire. readMarkers dedups via a Set (cancelledIds) — the second cancel is a no-op.
//   Do NOT add a de-dup guard — the contract says keep it simple ("keeps the logic simple and the cost
//   bounded"); the Set already makes double-cancel free.

// GOTCHA — markers.shrinks is stable WITHIN a fire: readMarkers runs once at the top of contextHandler.
//   The stale pass appends cancels that take effect NEXT fire, so markers.shrinks.length at the cap
//   check is the SAME count read at the start of THIS fire (it does not shrink mid-fire). Correct.

// GOTCHA — the cap test with default shrinkData() shrinks isolates the cap: shrinkData builds LIVE
//   shrinks (NO pinnedEntryId), so S1's stale pass `continue`s on each (pinnedEntryId guard) and never
//   appends a cancel — only the cap logic fires. Clean isolation.

// GOTCHA — multi-fire "next-fire drop" tests must MANUALLY add a makeCancelEntry(id) to the entries
//   fixture between fires: makeCtx.getEntries returns a FIXED array, and the fake pi.appendEntry does
//   NOT feed back into it. (Mirror the readMarkers cancel-drop tests, filter.test.ts:183-279.)
```

## Implementation Blueprint

### Data models and structure

No data-model change. `ShrinkMarker.id` (uuid) and `ShrinkMarker.seq` (monotonic counter) already
exist. `config.shrink.maxActive` already exists. `appendCancelMarker` already exists. This task is
one `if` block + one import + tests + a doc sentence.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/filter.ts — add stableSortBySeq to the transforms.js value import
  - EDIT the import line S1 resolved to:
      `import { filterPipeline, resolvePinnedShrink } from "./transforms.js";`
    →
      `import { filterPipeline, resolvePinnedShrink, stableSortBySeq } from "./transforms.js";`
  - WHY: the cap uses stableSortBySeq (the in-repo oldest-first sorter) to find the lowest-seq shrink.
  - GOTCHA: it is a VALUE import (function), not type-only. Do NOT touch the separate
    `import type { MessageLike, BranchEntry } from "./transforms.js";` line.

Task 2: MODIFY src/filter.ts — add the soft-cap block inside S1's retirement try/catch
  - LOCATE S1's retirement try/catch (between the observability try/catch and the final
    `return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };`).
  - PLACE: on the line immediately AFTER the stale `for (const sh of markers.shrinks) { … }` loop
    closes, and BEFORE the `} catch (retireErr) {` of that same try. (I.e. last statement inside the try.)
  - CODE (verbatim):
      ```typescript
      // P3.M2.T3.S2 / spec E15: soft cap. If the ACTIVE shrink count exceeds config.shrink.maxActive,
      // retire the OLDEST (lowest seq) by appending a mulligan:cancel (same retraction primitive as the
      // cancel tool + the stale pass above). Exactly ONE per fire (bounded, eventual: N over the cap → N
      // fires). markers.shrinks is already cancel-dropped by readMarkers, so .length is the live count.
      // Takes effect NEXT fire (readMarkers drops the cancelled id). NEVER throws (this try/catch, E13).
      if (markers.shrinks.length > config.shrink.maxActive) {
        const oldest = stableSortBySeq(markers.shrinks)[0]; // lowest seq (defensive: missing seq → 0)
        if (oldest) {
          const id = readOwn(oldest, "id");
          if (typeof id === "string" && id.length > 0) {
            appendCancelMarker(pi, ctx, { targetId: id }); // auto-retire oldest; never throws
          }
        }
      }
      ```
  - FOLLOW pattern: S1's stale-pass line `appendCancelMarker(pi, ctx, { targetId: id })` — identical call shape.
  - GOTCHA: `>` strict. `oldest` is undefined only when markers.shrinks is empty (impossible inside the
    `>` branch, but the guard is belt-and-suspenders + keeps tsc happy on `possibly undefined`). REUSE
    markers/config/pi/ctx — they are in scope. Do NOT add a new try/catch.
  - NOTE: a leading comment block (the `// P3.M2.T3.S2 / spec E15: soft cap` doc) is REQUIRED so the
    cap is self-documenting in the source (mirrors S1's stale-pass comment block).

Task 3: ADD test/filter.test.ts — a `contextHandler — soft cap (spec/08 E15)` describe block
  - ADD a new describe block AFTER the stale-retirement describe S1 added (and before/after
    registerFilterHandler's — placement is flexible). Reuse shrinkData, customEntry, makeCancelEntry,
    makeCtx, makePi (S1's version returns { handlers, appendCalls, pi }). Cases (one `it` each):
    1. "retires the OLDEST shrink (lowest seq) when active count > maxActive":
       - `beforeEach(() => setConfig({ shrink: { maxActive: 2 } }));`
       - entries: 3 LIVE shrinks (default shrinkData — no pinnedEntryId, so S1's stale pass skips them):
         shrinkData(5, "sh-5"), shrinkData(3, "sh-3"), shrinkData(4, "sh-4"). (Array order ≠ seq order
         — proves oldest-by-seq, not first-in-array.)
       - `const { pi, appendCalls } = makePi(); const ctx = makeCtx({ entries });`
       - Fire: `contextHandler(pi, { type: "context", messages: [] }, ctx);`
       - Assert: `appendCalls.length === 1`; `appendCalls[0].customType === "mulligan:cancel"`;
         `(appendCalls[0].data as {targetId:string}).targetId === "sh-3"` (lowest seq).
    2. "does NOT retire when active count === maxActive (boundary: equal is not exceeds)":
       - maxActive=3; 3 shrinks. Fire once. Assert `appendCalls.length === 0`.
       - (Also assert with maxActive=3 and 2 shrinks → 0 cancels, for under-cap.)
    3. "retires exactly ONE per fire (bounded, eventual) — NOT all-at-once":
       - maxActive=1; 3 shrinks (seq 5,3,4). Fire once. Assert `appendCalls.length === 1` (targetId
         "sh-3") — NOT 2. (Proves one-per-fire even though the set is over the cap by 2.)
    4. "over N fires, retires oldest-first until under cap (next-fire drop via readMarkers)":
       - maxActive=1; start entries = [shrinkData(5,"sh-5"), shrinkData(3,"sh-3"), shrinkData(4,"sh-4")].
       - Fire 1 with these entries → appendCalls[0].targetId === "sh-3".
       - Rebuild ctx with entries += makeCancelEntry("sh-3") (simulate the appended cancel now on disk)
         → markers.shrinks is now [sh-5, sh-4]. Fire 2 → appendCalls[1].targetId === "sh-4" (lowest of {5,4}).
       - Rebuild ctx with entries += makeCancelEntry("sh-4") → markers.shrinks is [sh-5] (length 1, not > 1).
         Fire 3 → appendCalls.length === 2 (no NEW cancel on fire 3).
       - (Accumulate appendCalls across fires by reusing ONE makePi's pi + appendCalls — makePi is created
         ONCE; only ctx/entries change between fires.)
    5. "operates on the ACTIVE set — a cancelled shrink is not counted":
       - maxActive=2; entries = 3 shrink entries + makeCancelEntry("sh-3") (sh-3 already retired).
         readMarkers drops sh-3 → markers.shrinks.length === 2 → NOT > 2 → no cap retire.
       - Fire once. Assert `appendCalls.length === 0`. (Proves the cap sees the post-cancel-drop count.)
    6. "never throws — a throwing appendEntry (cap path) is swallowed; turn returns {messages}":
       - maxActive=1; 3 shrinks. `pipelineReturn = [{ role: "user", content: "OK" }]` (so the return is
         asserted). Build a pi whose `appendEntry` THROWS (override makePi or inline):
         `const pi = { on(){}, appendEntry(){ throw new Error("boom"); } } as unknown as ExtensionAPI;`
       - Fire once. Assert `expect(() => contextHandler(pi, event, ctx)).not.toThrow()`; the result is
         `{ messages: [{role:"user",content:"OK"}] }` (the filter transform is PRESERVED — the cap throw
         did not reach the outer pass-through). (Proves E13 isolation: the cap is inside the inner try/catch.)
  - NAMING/PLACEMENT: describe after the stale-retirement describe. No new file.
  - FOLLOW pattern: the stale-retirement tests S1 added (direct contextHandler(pi, event, ctx) call,
    assert on appendCalls + result). setConfig in beforeEach (config deep-merges per-leaf, so
    `{ shrink: { maxActive: N } }` alone is enough — keeps enabled=true, staleAfterFires=3).
  - GOTCHA: the module-level beforeEach (top of file) calls clearAll() + resets pipelineCalls/Return —
    it does NOT reset setConfig. Each cap test's own `beforeEach(() => setConfig({ shrink: { maxActive: 2 } }))`
    sets the cap; tests needing a different maxActive call setConfig inside the `it`.
  - GOTCHA: for test 6, since the fake pi throws on appendEntry, S1's stale pass ALSO throws first (it
    runs before the cap) — but BOTH are inside the same inner try/catch, so the single catch swallows
    the first throw and the cap line is skipped (the for-loop throw exits the try). That's fine — the
    ASSERTION is "no throw escapes + return is preserved", which holds. (If you want to isolate the CAP
    throw specifically, make the shrinks LIVE (default shrinkData, no pinnedEntryId) so the stale pass
    skips them entirely, then only the cap's appendEntry throws. Do THAT — cleaner isolation.)

Task 4: MODIFY spec/06-context-filter.md — extend the §1 retirement note with the cap sentence
  - LOCATE the stale-retirement note S1 added to §1 (a paragraph starting "Stale-marker retirement
    (spec/08 E15)." or similar). APPEND one sentence (or a short follow-on paragraph) documenting the
    cap. Suggested text (adapt to the file's tone):
    > **Soft cap on active shrinks (spec/08 E15).** In the same retirement pass, `contextHandler`
    > additionally enforces a soft cap: when the number of *active* shrink markers exceeds
    > `config.shrink.maxActive` (default 32), the **oldest** shrink (lowest `seq`) is auto-retired by
    > appending a `mulligan:cancel` — exactly one per fire (bounded, eventual), taking effect on the
    > next fire. This bounds the active-shrink set for very long sessions; both the stale retirement
    > and the cap are wrapped in the same best-effort try/catch (E13).
  - WHY: §1 is the authoritative contextHandler contract; the cap is otherwise undocumented. Mode A
    (doc rides with the work).
  - Do NOT renumber — append to the existing §1 note.
```

### Implementation Patterns & Key Details

```typescript
// THE cap block — placed INSIDE S1's retirement try/catch, after the stale for-loop:
if (markers.shrinks.length > config.shrink.maxActive) {
  const oldest = stableSortBySeq(markers.shrinks)[0]; // lowest seq (defensive: missing seq → 0)
  if (oldest) {
    const id = readOwn(oldest, "id");
    if (typeof id === "string" && id.length > 0) {
      appendCancelMarker(pi, ctx, { targetId: id });
    }
  }
}

// WHY stableSortBySeq (not a manual reduce): it is the EXPORTED in-repo oldest-first sorter that
// filterPipeline ALREADY uses for shrinks; it is defensive (non-finite/missing seq → 0; never throws;
// never mutates). The seq reader (readOwnSeq) is module-private to transforms, so reimplementing it
// would duplicate defensive logic. One symbol, one import.

// WHY markers.shrinks.length (not a re-count): readMarkers runs ONCE at the top of contextHandler and
// ALREADY drops cancelled shrinks (P3.M1.T2.S1) — markers.shrinks IS the active set. The stale pass
// above appends cancels that take effect NEXT fire, so markers.shrinks is unchanged mid-fire.

// WHY exactly ONE per fire (no loop): the contract mandates it ("retire exactly ONE per fire; keeps
// the logic simple and the cost bounded"). Over-cap-by-N → N fires. Bounded + eventual.

// WHY no de-dup vs the stale pass: if the oldest shrink was ALSO just stale-retired this fire, two
// mulligan:cancel entries share a targetId — readMarkers dedups via cancelledIds (a Set) → the second
// is a free no-op. A guard would add complexity for zero benefit (violates "keep it simple").

// WHY inside the SAME try/catch (not a new one): the contract says so, AND it guarantees E13 isolation
// without a second catch. A cap throw is caught by the existing `catch (retireErr) { log(...) }` and
// execution continues to the normal `return { messages }`.
```

### Integration Points

```yaml
IMPORTS (src/filter.ts):
  - add: "stableSortBySeq to the transforms.js value import (3rd symbol after filterPipeline, resolvePinnedShrink)"

REGISTRATION (src/filter.ts registerFilterHandler):
  - NO CHANGE. S1 already wraps pi through; the cap reuses the threaded pi.

NO DATABASE / NO CONFIG CHANGES / NO ROUTES / NO NEW FILES / NO runtime.ts / NO index.ts.
  - config.shrink.maxActive: already-landed P3.M2.T1.S1 (this task only READS it).
  - appendCancelMarker: already-landed P3.M1.T1.S1 (this task only CALLS it).
  - readOwn + the retirement try/catch + pi-threading + the test appendCalls capture: all from S1 (CONTRACT).
  - runtime.ts: the cap needs NO runtime state (unlike the stale pass's shrinkMissCounts).

DOCS (spec/06-context-filter.md):
  - §1: extend S1's stale-retirement note with one soft-cap sentence.

DOWNSTREAM (no edit needed):
  - index.ts: calls registerFilterHandler(pi) once — unchanged.
  - P3.M4 (doc sync): the README config table already lists shrink.maxActive (P3.M2.T1.S1 landed it);
    no further README work is triggered by this task.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: ZERO errors. The only new symbol is stableSortBySeq — if tsc errors "stableSortBySeq is
# not exported by transforms.js" or "has no exported member", confirm the import lists it as a value
# (not type-only) and that transforms.ts:1068 still `export function stableSortBySeq`. If tsc errors
# "Cannot find name 'readOwn'/'appendCancelMarker'/'stableSortBySeq' inside the cap block", the block
# is OUTSIDE the try scope or the import is missing.

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback).
npx vitest run test/filter.test.ts
# Expected: ALL tests pass — S1's stale-retirement tests + the NEW soft-cap tests + all existing
# readMarkers/contextHandler/register tests. Watch especially:
#   - test 1 (oldest retired): appendCalls has exactly ONE mulligan:cancel, targetId === lowest-seq id.
#   - test 2 (boundary): length === maxActive → 0 cancels (the `>` strict check).
#   - test 3 (one-per-fire): maxActive=1, 3 shrinks, ONE fire → exactly ONE cancel (not 2).
#   - test 4 (eventual over N fires): oldest-first across fires, stops when under cap.
#   - test 6 (throw swallowed): result is STILL {messages:[…]} (NOT undefined) — proves E13 isolation.

# Then the full suite to prove no regression.
npm test
# Expected: ALL green. config.test.ts (maxActive validation) + runtime.test.ts (unaffected) + markers/
# audit/edge/drift/nudges/transforms tests unchanged.
```

### Level 3: Integration Testing (System Validation)

```bash
# The change is INTERNAL to filter.ts (registerFilterHandler's public signature is unchanged by S1/S2),
# so index.ts wiring is unaffected. The integration smoke harness exercises real Pi events:
npm run smoke   # optional — should pass unchanged (no over-cap scenario in the smoke script yet)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the new unit tests (the real gate for this hot-path maintenance pass):
#   - active count > maxActive → exactly ONE cancel, targetId === lowest-seq shrink's id
#   - active count <= maxActive (incl. equal) → no cancel
#   - one-per-fire (bounded eventual): N over the cap → N fires, oldest-first
#   - operates on the ACTIVE set (cancelled shrinks not counted)
#   - cap throw swallowed → turn returns {messages} (E13)
# These mirror spec/08 E15's mandate ("when exceeded, the oldest is retired") at the unit level. The
# end-to-end "next fire the oldest shrink no longer applies" is satisfied transitively: the appended
# cancel flows into readMarkers.cancelledIds (P3.M1.T2.S1, landed) → the shrink leaves markers.shrinks
# → applyShrink never runs for it. `npm test` covers it.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (stableSortBySeq value import + cap block).
- [ ] `npx vitest run test/filter.test.ts` — all pass (existing + 6 new soft-cap tests).
- [ ] `npm test` — full suite green (no regressions).

### Feature Validation
- [ ] `length > maxActive` → ONE `appendCancelMarker` with `targetId === lowest-seq` shrink's `id`.
- [ ] `length <= maxActive` (incl. equal) → no cancel appended.
- [ ] Exactly one retirement per fire (test 3: maxActive=1 + 3 shrinks + 1 fire → 1 cancel, not 2).
- [ ] Oldest determined by `seq`, not array order (test 1: seq 3 retired out of [5,3,4]).
- [ ] Operates on the active set (test 5: a cancelled shrink is not counted).
- [ ] Cap never throws (test 6: throwing appendEntry swallowed; turn returns `{messages}`).
- [ ] `spec/06-context-filter.md` §1 note extended with the soft-cap sentence.

### Code Quality Validation
- [ ] Cap block is INSIDE S1's retirement try/catch (after the stale loop) — not a new try/catch, not outside.
- [ ] `stableSortBySeq` is a VALUE import (not type-only).
- [ ] Reuses in-scope `markers`/`config`/`pi`/`ctx` (no re-fetch).
- [ ] `readOwn(oldest, "id")` used (defensive); guarded by `typeof id === "string" && id.length > 0`.
- [ ] `>` strict (exceeds), exactly ONE per fire (no loop).
- [ ] No changes outside `src/filter.ts`, `test/filter.test.ts`, `spec/06-context-filter.md`.

### Documentation & Deployment
- [ ] Cap block has a leading comment (mirrors S1's stale-pass comment block).
- [ ] `spec/06-context-filter.md` §1 note states: active-count cap, oldest-by-seq, one-per-fire, next-fire effect, same try/catch, E15.
- [ ] No README change required (shrink.maxActive already in the config table from P3.M2.T1.S1; README blurbs are P3.M4).

---

## Anti-Patterns to Avoid

- ❌ Do NOT place the cap OUTSIDE S1's retirement try/catch — a cap throw would reach the OUTER catch (→ void/pass-through → the turn LOSES the entire filter transform = E13 violation). The cap MUST be inside the inner try/catch.
- ❌ Do NOT create a SEPARATE try/catch for the cap — the contract says "Wrap in the same try/catch as the stale pass." One try/catch, two responsibilities (stale pass + cap), is the intended design.
- ❌ Do NOT use `>=` — the cap fires on EXCEEDS (`>`). `length === maxActive` does NOT retire.
- ❌ Do NOT loop / retire more than one per fire — the contract mandates exactly one (bounded, eventual).
- ❌ Do NOT reimplement min-by-seq with a manual reduce — `readOwnSeq` is module-private to transforms; reuse the EXPORTED `stableSortBySeq`. One import, one line.
- ❌ Do NOT re-fetch `getConfig`/`getRuntime`/`readMarkers` inside the cap — reuse the in-scope `markers`/`config`/`pi`/`ctx` locals.
- ❌ Do NOT re-filter `markers.shrinks` by `cancelledIds` — readMarkers already dropped cancelled shrinks; `.length` is the live active count.
- ❌ Do NOT add a "is this shrink already retired this fire?" de-dup guard — a double cancel is a free readMarkers Set no-op; the guard adds complexity for zero benefit (violates "keep it simple").
- ❌ Do NOT validate `targetId` existence before `appendCancelMarker` — it is dumb persistence; markers.shrinks is already the active set.
- ❌ Do NOT make `stableSortBySeq` a type-only import — it is a VALUE called at runtime; `import type` compiles it away → runtime "is not a function".
- ❌ Do NOT use bare `oldest.id` — use `readOwn(oldest, "id")` (a Proxy get-trap may throw).
- ❌ Do NOT forget to assert ONE-per-fire (test 3) — it is the contract's defining behavioral guarantee and the easiest thing to get wrong (a tempting `while` loop).
- ❌ Do NOT modify `config.ts`/`markers.ts`/`transforms.ts`/`runtime.ts`/`index.ts` — those are contracts (landed or S1). This task is `filter.ts` + its test + the spec doc only.
- ❌ Do NOT create a new file — all changes are additive edits to existing files.

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. This is a 6-line additive delta on S1's landed
retirement machinery: it reuses S1's `pi`-threading, S1's inner try/catch, S1's `appendCancelMarker`
import, S1's test `appendCalls` capture, the already-landed `shrink.maxActive` knob, and the
already-landed `readMarkers` cancel-drop (so `markers.shrinks` is the active set for free). The
"oldest" computation uses the already-exported `stableSortBySeq` that filterPipeline uses for the
identical purpose. The two residual risks, both explicit in the tasks: (1) **correct placement** —
the cap MUST land inside S1's inner try/catch (the PRP quotes S1's block verbatim so the
implementer can locate it even though S1 lands first; a misplaced cap would either fail E13 or
diverge from the contract); (2) **multi-fire test 4** — simulating "next-fire drop" requires
manually appending `makeCancelEntry(id)` to the fixture between fires (the fake `pi.appendEntry`
does not feed back into `makeCtx.getEntries`), mirroring the existing readMarkers cancel-drop tests
at filter.test.ts:183-279 — the PRP spells out each fire's expected `targetId`. No external research
adds value — the in-repo pattern (stableSortBySeq + appendCancelMarker + readMarkers cancel-drop) is
authoritative and already in use.