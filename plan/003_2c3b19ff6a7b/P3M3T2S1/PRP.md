# PRP — P3.M3.T2.S1: Add `aboveHighWater` boolean to SessionRuntime

## Goal

**Feature Goal**: Add a new boolean field `aboveHighWater` to the `SessionRuntime` interface in
`src/runtime.ts`, defaulted to `false` in `freshRuntime`. This is the per-session edge-triggered latching
state for the §5.2 high-water signal: it records whether the **total filtered** context is *currently* above
the high-water fraction of the window (`config.nudges.highWaterFraction`, default 0.7 — landed by the parallel
predecessor P3.M3.T1.S1). The field is written/cleared by the consumer `shouldHighWater` (future
P3.M3.T5.S1) via the `rt` parameter; this task only creates the field and its default.

**Deliverable**:
- `src/runtime.ts` — modified: `SessionRuntime` interface (+1 field with JSDoc), `freshRuntime` return
  literal (+1 field). **No changes** to `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll`.
- `test/runtime.test.ts` — modified: 2 existing `toEqual` shape assertions updated (+`aboveHighWater: false`),
  1 new in-place-mutation-persistence `it`, 1 new resetRuntime-clears `it`, 1 new clearAll-clears `it`, and
  1 new `expectTypeOf` line.

**Success Definition**:
- `getRuntime("s1").aboveHighWater === false` on first access (fresh runtime default).
- `rt.aboveHighWater = true;` persists when read back via `getRuntime("s1")` (mutable-reference contract).
- `resetRuntime("s1")` → next `getRuntime("s1").aboveHighWater === false` (entry is deleted → fresh runtime).
- `clearAll()` → every session's `aboveHighWater` back to `false`.
- `npx tsc --noEmit` clean; `npm test` green (all existing tests + new tests pass).

## Why

- **Required by §5.2 (edge-triggered high-water signal).** spec/07 §5.2 mandates the filter inject the
  high-water annotation only on the *rising edge* — "fire once on crossing, not every turn while above — by
  tracking `rt.aboveHighWater` (set true when the annotation fires, cleared only when the total drops back
  below the fraction) in the session runtime." Without this field there is nowhere to latch the edge.
  spec/04 §8 is the authoritative home for `SessionRuntime` in-memory state.
- **It is the runtime-state foundation for the high-water signal.** P3.M3.T5.S1 (`shouldHighWater`) reads and
  mutates `rt.aboveHighWater`; P3.M3.T6.S1 (`contextHandler` nudge wiring) calls `shouldHighWater` and passes
  the `rt` it obtains from `getRuntime`. This task is upstream of both — but it is **purely additive state**:
  nothing in `src/` references `aboveHighWater` today, so adding the field changes zero runtime behavior.
- **Tiny, surgical, mechanical.** One Pi-free module, one new primitive field, a known set of test edits that
  exactly mirror how `shrinkMissCounts` was added by P3.M2.T2.S1 (the immediately-preceding runtime.ts
  change). The field is a primitive boolean, so it is *simpler* than `shrinkMissCounts` (a `Map`) — there is
  no GOTCHA #5 (cross-session reference sharing) concern, because primitives cannot share references.

## What

**User-visible behavior**: None directly. `aboveHighWater` is internal in-memory control state (spec/04 §8),
never persisted, never shown to the model or user. The observable effect (once the consumer lands) is that the
high-water annotation fires *once* per upward crossing rather than nagging every turn — this field is the latch
that makes that possible.

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. **`SessionRuntime` interface** — add `aboveHighWater: boolean`. Tracks whether the total filtered context is
   currently above the high-water fraction. REQUIRED (non-optional, no `?`) — it always carries a value (the
   default `false`), mirroring every other field on the interface.
2. **`freshRuntime`** — add `aboveHighWater: false` to the returned object literal.
3. **No changes** to `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll`. (`resetRuntime` already
   `runtimes.delete(sessionId)` → the next `getRuntime` builds a fresh runtime with `aboveHighWater: false`,
   so the field is **automatically reset on `session_start`** — no resetRuntime edit needed. This is confirmed
   by `plan/003_2c3b19ff6a7b/architecture/system_context.md` §runtime.ts: "resetRuntime already wipes the
   entire entry, so new fields are automatically reset on session_start.")

### Edge semantics (consumed by P3.M3.T5.S1 — do NOT implement the logic here, only the field)
- Set to `true` by `shouldHighWater` when the high-water annotation fires (total crosses above the fraction).
- Cleared to `false` by `shouldHighWater` when the total drops back **below** the fraction.
- Persists **across turns within a session** (it is *not* reset per-turn). This is what makes the signal
  edge-triggered rather than level-triggered. The contract's MOCKING clause captures this: "Set it true, assert
  it persists until explicitly cleared."

### Success Criteria
- [ ] `SessionRuntime` interface has `aboveHighWater: boolean` (required, non-optional) with JSDoc.
- [ ] `freshRuntime` returns `{ …, aboveHighWater: false }`.
- [ ] `getRuntime("s1").aboveHighWater === false` initially; assignment persists; resetRuntime/clearAll restore false.
- [ ] `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll` bodies unchanged.
- [ ] `npx tsc --noEmit` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the exact `SessionRuntime` interface block and `freshRuntime` literal to edit (the
insertion point is right after the `shrinkMissCounts` field/clause, added by P3.M2.T2.S1), names the exact test
edits line-by-line, and points at `shrinkMissCounts` as the verbatim pattern to mirror (a primitive boolean is
strictly simpler than a `Map`). An implementer who has never seen this repo can do it from this document +
`src/runtime.ts` + `test/runtime.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file you are editing
- file: src/runtime.ts
  why: |
    Contains the SessionRuntime interface and freshRuntime — the two sites to edit. The file is Pi-FREE
    (imports nothing) and the field is a primitive boolean, so the edit is a 2-line addition (1 interface
    field + 1 freshRuntime literal field). No logic, no coercion, no helper reuse.
  pattern: |
    // SessionRuntime interface — INSERT aboveHighWater AFTER the shrinkMissCounts field (the last field):
    export interface SessionRuntime {
      sessionId: string;
      seq: number;
      tokenBaseline: number | null;
      lastTurnIndex: number | null;
      lastFiltered: AgentMessage[] | null;
      lastFilterTs: number | null;
      pendingBloatHits: BloatHit[];
      shrinkMissCounts: Map<string, number>;
      // <── INSERT aboveHighWater: boolean here (with JSDoc) ──>
    }
    // freshRuntime — INSERT aboveHighWater: false AFTER the shrinkMissCounts line in the returned literal:
    function freshRuntime(sessionId: string): SessionRuntime {
      return {
        sessionId,
        seq: 0,
        tokenBaseline: null,
        lastTurnIndex: null,
        lastFiltered: null,
        lastFilterTs: null,
        pendingBloatHits: [],
        shrinkMissCounts: new Map(),
        // <── INSERT aboveHighWater: false here ──>
      };
    }
  section: SessionRuntime interface + freshRuntime (lines ~50-100)
  gotcha: |
    Place the new field LAST in BOTH the interface and the freshRuntime literal (after shrinkMissCounts).
    Every prior runtime.ts addition (lastFiltered/lastFilterTs/pendingBloatHits/shrinkMissCounts) was appended
    last — keep that ordering convention so the "exact default shape" toEqual tests diff minimally. The field
    is REQUIRED (no `?`); it always has the default `false`.

# MUST READ — the pattern to mirror EXACTLY (the immediately-preceding runtime.ts change)
- file: src/runtime.ts
  why: |
    `shrinkMissCounts` was added by P3.M2.T2.S1 using the SAME two-edit pattern this task uses. Read its JSDoc
    block (interface) + its `shrinkMissCounts: new Map(),` line (freshRuntime) to match the comment style,
    depth, and spec/06+consumer-task references. `aboveHighWater` is a primitive boolean, so it is SIMPLER —
    no "each fresh runtime gets its OWN …" GOTCHA #5 note is needed (primitives cannot share references,
    unlike arrays/Maps). Still cross-reference the consumer task (P3.M3.T5.S1) in the JSDoc, as the
    shrinkMissCounts JSDoc cross-references P3.M2.T3.S1.
  pattern: |
    /** <one-line purpose>. <edge semantics — set true on crossing, cleared when total drops below the
     *  fraction>. Default: false. Consumed by shouldHighWater (P3.M3.T5.S1). */
    aboveHighWater: boolean;
  section: shrinkMissCounts field + its JSDoc (the template)

# MUST READ — the test file to extend
- file: test/runtime.test.ts
  why: |
    Two existing `toEqual` assertions pin the FULL default shape (the "exact default shape" test in the
    "fresh runtime defaults" describe, and the "clears the entry … FRESH runtime" test in the resetRuntime
    describe). BOTH must gain `aboveHighWater: false` or deep-equality fails. Then add the new tests (see
    Implementation Tasks Task 4). Mirror the shrinkMissCounts test additions made by P3.M2.T2.S1, but NOTE:
    do NOT add an "each fresh runtime gets its OWN aboveHighWater" test — that test only makes sense for
    reference types (arrays/Maps). For a primitive boolean, cross-session isolation is structurally guaranteed
    and testing it would be a tautology.
  pattern: |
    // The two toEqual shapes to update (add aboveHighWater: false as the LAST key, after shrinkMissCounts):
    expect(rt).toEqual({
      sessionId: "s1",
      seq: 0,
      tokenBaseline: null,
      lastTurnIndex: null,
      lastFiltered: null,
      lastFilterTs: null,
      pendingBloatHits: [],
      shrinkMissCounts: new Map(),
      aboveHighWater: false,   // <-- ADD
    });
  section: "fresh runtime defaults" describe (first it) + resetRuntime describe (first it) + types describe
  gotcha: |
    The types describe uses `const rt: SessionRuntime = {} as SessionRuntime;` — a cast that BYPASSES tsc's
    missing-field check. So adding a required field does NOT break that line; you only need to ADD a new
    `expectTypeOf(rt.aboveHighWater).toEqualTypeOf<boolean>();` assertion there. Confirmed by grep: the ONLY
    SessionRuntime object literal in src+test is that `{} as SessionRuntime` cast — no other construction
    would break tsc when the field becomes required.

# Architecture reference (read-only confirmation — matches the contract exactly)
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  section: "### runtime.ts (154 lines) — Pi-free per-session state"
  why: |
    Confirms the P3.M3 delta verbatim: "P3 delta (M3): add `aboveHighWater: boolean` (default false)" and
    "resetRuntime already wipes the entire entry, so new fields are automatically reset on session_start."
    Also confirms SessionRuntime is the only Pi-free state holder and the canonical construction site is
    freshRuntime.

# Spec sources (read-only; the source of this field's meaning)
- docfile: spec/04-data-model.md
  section: "§8. In-memory (non-persisted) state"
  why: |
    Authoritative home for SessionRuntime. Lists the core fields; this P3 refinement adds aboveHighWater to
    the in-memory (non-persisted) group. Confirms "Never cache a sessionManager handle (C12) — only primitive
    values" — a boolean qualifies.
- docfile: spec/07-preventive-and-nudges.md
  section: "§5.2 Edge-triggered high-water signal (REQUIRED)"
  why: |
    The CONSUMER's spec — defines exactly how aboveHighWater is used: "fire once on crossing, not every turn
    while above — by tracking rt.aboveHighWater (set true when the annotation fires, cleared only when the
    total drops back below the fraction)." Read this to understand the edge semantics you are enabling, but do
    NOT implement shouldHighWater here (that is P3.M3.T5.S1).

# The parallel predecessor (currently being implemented — assume it lands exactly as specified)
- docfile: plan/003_2c3b19ff6a7b/P3M3T1S1/PRP.md
  why: |
    T1.S1 adds `config.nudges.highWaterFraction` (default 0.7) to src/config.ts. That knob is READ by
    shouldHighWater (P3.M3.T5.S1) to decide when to flip aboveHighWater. T1 and THIS task are independent
    files (config.ts vs runtime.ts) — no edit conflict, and this task does NOT import config.ts (runtime.ts
    imports nothing). You only need T1's existence in mind to understand the full high-water design; you do
    not touch config.ts.
```

### Current Codebase tree (relevant slice)

```bash
src/
  runtime.ts          # <-- MODIFY: SessionRuntime interface (+1 field + JSDoc) + freshRuntime (+1 literal field)
  nudges.ts           # read-only (references SessionRuntime type; will gain shouldHighWater in P3.M3.T5.S1 — NOT this task)
  config.ts           # read-only (T1.S1 adds highWaterFraction here — independent of runtime.ts)
test/
  runtime.test.ts     # <-- MODIFY: 2 toEqual updates + ~4 new its + 1 expectTypeOf line
spec/
  04-data-model.md    # read-only (§8 — SessionRuntime home)
  07-preventive-and-nudges.md  # read-only (§5.2 — the consumer spec)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/runtime.ts       # EXTENDED in place. SessionRuntime.aboveHighWater (boolean); freshRuntime returns aboveHighWater: false.
test/runtime.test.ts # EXTENDED in place. 2 toEqual shape updates + new persistence/reset/clearAll/type assertions.
# No new files. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — resetRuntime does NOT need an edit. It does `runtimes.delete(sessionId)` (line 152), so the
//   next getRuntime(sessionId) builds a fresh runtime with aboveHighWater: false. The field is therefore
//   automatically reset on session_start. The contract explicitly forbids touching resetRuntime. Confirmed by
//   system_context.md §runtime.ts. (Contrast: if resetRuntime mutated-in-place instead of deleting, you'd have
//   to reset aboveHighWater there — but it deletes, so you don't.)

// CRITICAL — the field is REQUIRED (no `?`), so any SessionRuntime LITERAL built from scratch would break tsc.
//   GREP-VERIFIED: the only literal is `{} as SessionRuntime` in test/runtime.test.ts (a cast that bypasses the
//   missing-field check). freshRuntime is the only real construction site, and you're editing it. No other
//   src/test file constructs a SessionRuntime literal. nudges.ts references the TYPE but only reads/mutates
//   fields via getRuntime() — never constructs a literal — so it stays type-clean.

// CRITICAL — aboveHighWater is a PRIMITIVE boolean, NOT a reference type. Unlike pendingBloatHits (array) and
//   shrinkMissCounts (Map), it does NOT need a "each fresh runtime gets its OWN aboveHighWater" GOTCHA #5 note
//   or test: primitives are copied by value on every `=` and cannot be shared across sessions. Do NOT add a
//   cross-session-isolation test for it (it would be a tautology). The shrinkMissCounts tests are the model for
//   reference-typed fields; for aboveHighWater, the persistence + reset + clearAll tests are sufficient.

// GOTCHA — append the field LAST in both the interface and the freshRuntime literal (after shrinkMissCounts).
//   Every prior addition was appended last. This keeps the two toEqual "exact default shape" assertions a
//   minimal diff (just add the trailing `aboveHighWater: false,` line) and matches the established convention.

// GOTCHA — the two toEqual "exact default shape" tests (in the "fresh runtime defaults" + "resetRuntime"
//   describes) do DEEP equality. They WILL FAIL if you add the field to freshRuntime but forget to add
//   `aboveHighWater: false` to the expected literal. This is the most likely mistake — it's mechanical.

// GOTCHA — aboveHighWater is in-memory/non-persisted (spec/04 §8). It is NOT written into any marker, NOT read
//   by readMarkers, NOT part of MarkersBundle. It lives ONLY in the runtime map. Do not add it to markers.ts,
//   filter.ts, or any customType.

// GOTCHA — the field persists ACROSS TURNS within a session (it is NOT cleared at turn_end). It is cleared
//   ONLY by the consumer (shouldHighWater) when the total drops below the fraction, OR by resetRuntime/clearAll.
//   Do NOT wire any per-turn reset. The persistence test documents this contract.
```

## Implementation Blueprint

### Data models and structure

```typescript
// SessionRuntime — the ONLY data-model change (interface in src/runtime.ts). One new required boolean field:
export interface SessionRuntime {
  sessionId: string;
  seq: number;
  tokenBaseline: number | null;
  lastTurnIndex: number | null;
  lastFiltered: AgentMessage[] | null;
  lastFilterTs: number | null;
  pendingBloatHits: BloatHit[];
  shrinkMissCounts: Map<string, number>;
  /** Whether the total filtered context is currently ABOVE the high-water fraction of the window
   *  (config.nudges.highWaterFraction, default 0.7). Latches the §5.2 edge-triggered high-water signal:
   *  set `true` when the high-water annotation fires (total crosses above the fraction); cleared (`false`)
   *  only when the total drops back below the fraction. Edge-triggered — prevents the annotation from
   *  nagging every turn while above. Persists across turns within a session; auto-reset to `false` by
   *  resetRuntime (entry deleted on session_start) and clearAll (shutdown). Default: `false`. In-memory,
   *  non-persisted (spec/04 §8). Consumed by shouldHighWater (P3.M3.T5.S1) via the rt parameter. */
  aboveHighWater: boolean;
}
// No schema library — this is a plain TS interface. No persistence wrapper. The field is read/written in place
// by consumers that obtain the live runtime via getRuntime().
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/runtime.ts — SessionRuntime interface (+1 field + JSDoc)
  - LOCATE the `export interface SessionRuntime { … }` block (the field list ends with shrinkMissCounts).
  - APPEND after the shrinkMissCounts field (with the JSDoc shown in "Data models and structure" above):
      /** Whether the total filtered context is currently ABOVE the high-water fraction of the window
       *  (config.nudges.highWaterFraction, default 0.7). Latches the §5.2 edge-triggered high-water signal:
       *  set `true` when the high-water annotation fires (total crosses above the fraction); cleared (`false`)
       *  only when the total drops back below the fraction. Edge-triggered — prevents the annotation from
       *  nagging every turn while above. Persists across turns within a session; auto-reset to `false` by
       *  resetRuntime (entry deleted on session_start) and clearAll (shutdown). Default: `false`. In-memory,
       *  non-persisted (spec/04 §8). Consumed by shouldHighWater (P3.M3.T5.S1) via the rt parameter. */
      aboveHighWater: boolean;
  - FOLLOW pattern: the shrinkMissCounts field + its JSDoc block (mirror the comment depth + the
    "Consumed by <task>" cross-reference style).
  - NAMING: `aboveHighWater` (exact camelCase — match the contract + spec/07 §5.2 "rt.aboveHighWater").
  - GOTCHA: REQUIRED (no `?`) — always carries the default. Mirrors every other field on the interface.

Task 2: MODIFY src/runtime.ts — freshRuntime return literal (+1 field)
  - LOCATE `function freshRuntime(sessionId: string): SessionRuntime { return { … }; }`.
  - APPEND after the `shrinkMissCounts: new Map(),` line:
      aboveHighWater: false,
  - WHY: spec/04 §8 in-memory defaults; the contract mandates `aboveHighWater: false` in freshRuntime. This is
    the only construction site, so this single edit makes the default correct for every path (first access,
    post-reset, post-clearAll).
  - GOTCHA: append LAST (after shrinkMissCounts) to match the convention and keep the toEqual diff minimal.
    A primitive `false` needs no "new" allocation (unlike shrinkMissCounts's `new Map()`).

Task 3: NO-OP — explicitly do NOT modify getRuntime / nextSeq / resetRuntime / clearAll
  - The contract forbids it. resetRuntime deletes the map entry (line 152) → next getRuntime builds a fresh
    runtime with aboveHighWater: false → the field auto-resets on session_start. clearAll wipes the whole map
    (line 160) → same effect. getRuntime/nextSeq are field-agnostic. Do not touch any of them.

Task 4: MODIFY test/runtime.test.ts — update the 2 toEqual shape assertions
  - (4a) "getRuntime creates a runtime with the exact default shape on first access" (in the "fresh runtime
    defaults" describe): in the `expect(rt).toEqual({ … })`, ADD `aboveHighWater: false,` as the LAST key
    (after `shrinkMissCounts: new Map(),`).
  - (4b) "clears the entry so the next getRuntime returns a FRESH runtime" (in the resetRuntime describe): same
    edit — ADD `aboveHighWater: false,` as the last key of the `expect(rt).toEqual({ … })`.
  - GOTCHA: both use `.toEqual` (deep equality) — omitting the field makes them fail ("expected … to
    deep-equal …" with the extra `aboveHighWater: false` key in the received object).

Task 5: MODIFY test/runtime.test.ts — ADD new test cases (persistence + reset + clearAll)
  - (5a) ADD to the "in-place mutation contract (consumers mutate the live object)" describe (this is the
    natural home — it documents the consumer contract):
      it("shouldHighWater-style set of aboveHighWater persists across getRuntime calls (edge latches, not per-turn)", () => {
        // Documents the P3.M3.T5.S1 consumption contract: set true on rising edge, persists until cleared.
        const rt = getRuntime("s1");
        expect(rt.aboveHighWater).toBe(false);   // fresh default
        rt.aboveHighWater = true;                 // shouldHighWater sets it on the rising edge
        expect(getRuntime("s1").aboveHighWater).toBe(true);   // persists (same live reference)
      });
  - (5b) ADD to the "resetRuntime — session_start re-initialization" describe (alongside the shrinkMissCounts
    reset test):
      it("aboveHighWater resets to false after resetRuntime", () => {
        const a = getRuntime("s1");
        a.aboveHighWater = true;
        resetRuntime("s1");
        const fresh = getRuntime("s1");
        expect(fresh.aboveHighWater).toBe(false);   // entry was deleted → fresh runtime → default false
        expect(fresh).not.toBe(a);                   // new reference (C12: stale ref abandoned) — same as the shrinkMissCounts test
      });
  - (5c) ADD to the "clearAll — shutdown cleanup" describe (alongside the shrinkMissCounts clearAll test):
      it("clearAll resets aboveHighWater for all sessions", () => {
        getRuntime("A").aboveHighWater = true;
        clearAll();
        expect(getRuntime("A").aboveHighWater).toBe(false);   // map wiped → fresh runtime → default false
      });
  - FOLLOW pattern: the shrinkMissCounts reset + clearAll tests (same shape: mutate → reset/clearAll → assert
    fresh default + distinct reference where applicable).
  - GOTCHA: do NOT add an "each fresh runtime gets its OWN aboveHighWater" test (tautology for a primitive).

Task 6: MODIFY test/runtime.test.ts — ADD the type-level assertion
  - LOCATE the `describe("types", …)` block; inside its single `it`, ADD after the shrinkMissCounts line:
      expectTypeOf(rt.aboveHighWater).toEqualTypeOf<boolean>();
  - GOTCHA: the `const rt: SessionRuntime = {} as SessionRuntime;` cast bypasses tsc's missing-field check, so
    no break — you only ADD the expectTypeOf line. (Confirmed by grep: this is the only SessionRuntime literal.)

Task 7 (OPTIONAL — accuracy only, NOT required for green tests): none
  - Unlike T1.S1, there are no stale references to update elsewhere. aboveHighWater is brand-new and
    internal-only. Skip — no docs, no README, no integration references. (README config-table sync for the
    nudges knobs is P3.M4.T1.S1, a dedicated later doc task; aboveHighWater is runtime state, not config, and
    is intentionally undocumented per the contract's "DOCS: none — internal in-memory state (spec/04 §8)".)
```

### Implementation Patterns & Key Details

```typescript
// THE two edits to src/runtime.ts (verbatim — interface field + freshRuntime literal field):

// Edit 1 — SessionRuntime interface (append after shrinkMissCounts):
  /** Whether the total filtered context is currently ABOVE the high-water fraction of the window
   *  (config.nudges.highWaterFraction, default 0.7). Latches the §5.2 edge-triggered high-water signal:
   *  set `true` when the high-water annotation fires (total crosses above the fraction); cleared (`false`)
   *  only when the total drops back below the fraction. Edge-triggered — prevents the annotation from
   *  nagging every turn while above. Persists across turns within a session; auto-reset to `false` by
   *  resetRuntime (entry deleted on session_start) and clearAll (shutdown). Default: `false`. In-memory,
   *  non-persisted (spec/04 §8). Consumed by shouldHighWater (P3.M3.T5.S1) via the rt parameter. */
  aboveHighWater: boolean;

// Edit 2 — freshRuntime return literal (append after `shrinkMissCounts: new Map(),`):
    aboveHighWater: false,

// WHY a primitive boolean (not a getter, not a function): consumers mutate it in place via the live reference
//   (getRuntime("s1").aboveHighWater = true), exactly like every other field (tokenBaseline, lastTurnIndex,
//   lastFiltered). The runtime map's contract is "callers obtain the live runtime and mutate fields in place."
// WHY no resetRuntime edit: resetRuntime deletes the map entry → next getRuntime calls freshRuntime → field
//   defaults to false. This is the established auto-reset pattern for ALL runtime fields (seq, tokenBaseline,
//   pendingBloatHits, shrinkMissCounts all reset the same way). Confirmed by system_context.md §runtime.ts.
```

### Integration Points

```yaml
RUNTIME (src/runtime.ts):
  - interface SessionRuntime: +aboveHighWater (boolean, required)
  - freshRuntime return literal: +aboveHighWater: false

TESTS (test/runtime.test.ts):
  - 2 toEqual shape assertions: +aboveHighWater: false (last key)
  - +1 persistence it (in-place mutation describe)
  - +1 resetRuntime-clears it (resetRuntime describe)
  - +1 clearAll-clears it (clearAll describe)
  - +1 expectTypeOf line (types describe)

NO DATABASE / NO ROUTES / NO NEW FILES / NO config.ts / NO nudges.ts / NO filter.ts / NO markers.ts / NO index.ts.
  - resetRuntime, clearAll, getRuntime, nextSeq: UNCHANGED (the field auto-resets via entry deletion).
  - Consumer shouldHighWater (P3.M3.T5.S1): FUTURE task. It reads/writes rt.aboveHighWater; nothing in src/
    references the field today. Adding it now is purely additive — zero runtime behavior change.
  - config.nudges.highWaterFraction (the fraction threshold): landed by the parallel P3.M3.T1.S1 in config.ts.
    runtime.ts imports nothing (Pi-free), so it does not read highWaterFraction — the consumer (shouldHighWater)
    will read BOTH the config fraction and this runtime latch.

DOCS:
  - None required. The contract states "DOCS: none — internal in-memory state (spec/04 §8)." aboveHighWater is
    intentionally undocumented (not user-facing, not persisted, not in any marker). README sync is P3.M4.T1.S1
    and concerns the config knobs, not runtime state.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: ZERO errors. If tsc errors "Property 'aboveHighWater' is missing in type '{ … }'" pointing at
# freshRuntime → you added the interface field but forgot Edit 2 (the freshRuntime literal). If
# "Property 'aboveHighWater' does not exist on type 'SessionRuntime'" in a future consumer → that's a later
# task; this task only adds the field, so no consumer references exist yet (grep confirms zero today).

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback).
npx vitest run test/runtime.test.ts
# Expected: ALL pass. Watch especially:
#   - "getRuntime creates a runtime with the exact default shape on first access": the toEqual now includes
#     aboveHighWater: false. If it fails "expected … to deep-equal …", you missed adding the field to the
#     expected literal (Task 4a) OR didn't add aboveHighWater: false to freshRuntime (Task 2).
#   - "clears the entry so the next getRuntime returns a FRESH runtime": same toEqual must include the field (Task 4b).
#   - New tests (Task 5): persistence (false→true persists), resetRuntime (true→false after reset),
#     clearAll (true→false after clearAll). All green.

# Then the full suite to prove no regression.
npm test
# Expected: ALL green. runtime.ts is Pi-free and only runtime.test.ts imports it directly for shape checks;
# other test files (nudges/filter/markers) obtain runtimes via getRuntime() and mutate fields — they now see
# aboveHighWater on the type but none reference it, so they're unaffected. tsc --noEmit already covered type
# safety across the suite.
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds a single in-memory boolean defaulting to false; no consumer reads it yet, so there is NO
# behavioral change to exercise. The integration smoke harness is unaffected:
npm run smoke   # optional — passes unchanged (no nudge behavior changes; aboveHighWater is dormant until
                # P3.M3.T5/T6 land shouldHighWater + contextHandler wiring).
# Expected: no change. Skip unless validating the broader session_start/reset path.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the new unit tests (the real gate for runtime state):
#   - fresh default: getRuntime("s1").aboveHighWater === false
#   - persistence: set true → read back via getRuntime("s1") === true (live-reference contract)
#   - resetRuntime: true → reset → getRuntime === false (entry deleted → fresh runtime)
#   - clearAll: true → clearAll → getRuntime === false (map wiped)
# These mirror the contract's MOCKING clause: "getRuntime('s1').aboveHighWater === false initially. Set it
# true, assert it persists until explicitly cleared."
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (interface field + freshRuntime literal + test edits type-clean).
- [ ] `npx vitest run test/runtime.test.ts` — all pass (2 updated toEqual + ~4 new its + 1 expectTypeOf).
- [ ] `npm test` — full suite green (no regressions; nudges/filter/markers tests unaffected).

### Feature Validation
- [ ] `getRuntime("s1").aboveHighWater === false` on first access.
- [ ] `rt.aboveHighWater = true` persists via `getRuntime("s1").aboveHighWater === true`.
- [ ] `resetRuntime("s1")` → `getRuntime("s1").aboveHighWater === false`.
- [ ] `clearAll()` → `getRuntime("A").aboveHighWater === false`.
- [ ] `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll` bodies unchanged.

### Code Quality Validation
- [ ] New interface field is REQUIRED (no `?`); JSDoc present (purpose + edge semantics + default + consumer task + spec refs).
- [ ] Field appended LAST in both the interface and the freshRuntime literal (matches convention).
- [ ] JSDoc mirrors the shrinkMissCounts block's depth and "Consumed by <task>" cross-reference style.
- [ ] No changes outside `src/runtime.ts` and `test/runtime.test.ts`.

### Documentation & Deployment
- [ ] No docs required (contract: "DOCS: none — internal in-memory state"). spec/04 §8 is the canonical home.
- [ ] No README change (runtime state, not config; README config-table sync is the separate P3.M4.T1.S1 task).

---

## Anti-Patterns to Avoid

- ❌ Do NOT modify `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll` — the contract forbids it, and the field auto-resets because `resetRuntime` deletes the map entry.
- ❌ Do NOT make `aboveHighWater` optional (`?`) — it always carries the default `false`; it is required like every other field.
- ❌ Do NOT add a `shouldHighWater` function or any high-water *logic* — that is P3.M3.T5.S1. This task only adds the field + default.
- ❌ Do NOT read `config.nudges.highWaterFraction` in runtime.ts — runtime.ts is Pi-free and imports NOTHING (not config). The consumer (shouldHighWater, future task) reads both the config fraction and this runtime latch.
- ❌ Do NOT persist `aboveHighWater` into any marker or expose it on `MarkersBundle` — it is in-memory/non-persisted (spec/04 §8). Do not touch markers.ts / filter.ts.
- ❌ Do NOT add an "each fresh runtime gets its OWN aboveHighWater" cross-session-isolation test — that test only makes sense for reference types (arrays/Maps). For a primitive boolean it is a tautology; primitives cannot share references.
- ❌ Do NOT append the field anywhere but LAST (after shrinkMissCounts) in both the interface and the freshRuntime literal — every prior addition was appended last; keep the convention and the toEqual diff minimal.
- ❌ Do NOT forget the two `toEqual` updates in runtime.test.ts — deep-equality fails if the expected literal omits `aboveHighWater: false`. This is the most likely mechanical mistake.
- ❌ Do NOT wire any per-turn reset of `aboveHighWater` — it persists across turns within a session (edge-triggered). It is cleared only by the consumer (total drops below the fraction) or by resetRuntime/clearAll.
- ❌ Do NOT create a new file or touch any file other than `src/runtime.ts` and `test/runtime.test.ts`.

---

## Confidence Score

**10 / 10** — one-pass success is essentially certain. This is the smallest possible runtime.ts change: one
required boolean field on the interface + one literal field in freshRuntime, with the reset behavior handled
for free by `resetRuntime`'s existing `runtimes.delete()`. The pattern is the verbatim precedent set by
P3.M2.T2.S1's `shrinkMissCounts` addition (the immediately-preceding runtime.ts change), and `aboveHighWater`
is strictly simpler (a primitive vs. a `Map`, so no GOTCHA #5 reference-sharing concern). Grep-verified that
the only SessionRuntime object literal in `src`+`test` is a `{} as SessionRuntime` cast (bypasses tsc's
missing-field check), so adding a required field cannot break any other construction site. The test edits are a
known, fully-enumerated set (2 toEqual updates + persistence/reset/clearAll/type assertions). No external
research adds value — the in-repo precedent and `system_context.md` §runtime.ts (which confirms the delta and
the auto-reset property verbatim) are authoritative.