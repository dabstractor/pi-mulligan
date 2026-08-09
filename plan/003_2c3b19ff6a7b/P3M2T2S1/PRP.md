---

## Goal

**Feature Goal**: Add a per-session `shrinkMissCounts: Map<string, number>` field to `SessionRuntime` so that the stale-marker-retirement logic (built in P3.M2.T3.S1) can count consecutive "fires" during which each active pinned shrink's target was absent — without that data leaking across sessions or surviving a `session_start` reset.

**Deliverable**: A modified `src/runtime.ts` (interface + `freshRuntime`) plus an updated `test/runtime.test.ts`, with the new field available via `getRuntime(sessionId).shrinkMissCounts`.

**Success Definition**: `getRuntime('s1').shrinkMissCounts` is a fresh empty `Map` on first access; each session gets its own Map instance; it survives `nextSeq`/in-place mutation; it is wiped by `resetRuntime` (fresh empty Map on next access) and by `clearAll`; `npx tsc --noEmit` is clean and all `test/runtime.test.ts` tests pass.

## Why

- Prerequisite state for P3.M2.T3.S1 (stale retirement + soft cap, spec E15): a pinned shrink whose target has been absent for `config.shrink.staleAfterFires` (default 3) consecutive fires MUST be auto-retired. Counting those consecutive misses requires per-session mutable state — exactly what `SessionRuntime` is for.
- This task ONLY adds the state container. The logic that increments/reads/retires is P3.M2.T3.S1. Keeping the state-addition isolated lets P3.M2.T3 land on a stable, already-tested field.
- Mirrors the existing `pendingBloatHits: BloatHit[]` per-turn accumulator pattern (GOTCHA #5: each fresh runtime gets its own collection).

## What

User-visible behavior: **none**. `runtime.ts` is internal in-memory state (spec §8); no user-facing surface change.

Technical requirement:
- Add `shrinkMissCounts: Map<string, number>` to the `SessionRuntime` interface (keyed by shrink marker `id`, value = consecutive miss count).
- Initialize it as `shrinkMissCounts: new Map()` inside `freshRuntime` so every fresh runtime gets its **own** Map instance.
- **No changes** to `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll` — `resetRuntime` deletes the whole map entry (so a new field is automatically fresh on `session_start`), and `clearAll` wipes everything.

### Success Criteria

- [ ] `SessionRuntime` interface declares `shrinkMissCounts: Map<string, number>`.
- [ ] `freshRuntime` returns an object containing `shrinkMissCounts: new Map()`.
- [ ] Each fresh runtime gets its own Map instance (no cross-session sharing).
- [ ] `resetRuntime('s1')` → next `getRuntime('s1')` has a fresh empty Map (different instance).
- [ ] `clearAll()` → every session has a fresh empty Map.
- [ ] `npx tsc --noEmit` passes (including the type test in `runtime.test.ts`).
- [ ] `npx vitest run test/runtime.test.ts` passes.

## All Needed Context

### Context Completeness Check

_Passes the "No Prior Knowledge" test_: this PRP names the exact file (`src/runtime.ts`, 154 lines, Pi-free, 0 imports), the exact existing field to mirror (`pendingBloatHits`), the exact constructor (`new Map()`), the exact test assertions that must change (two `toEqual` default-shape blocks + the `expectTypeOf` block), and the exact new tests to add. An implementer who has never seen this repo can do it from this document alone.

### Documentation & References

```yaml
# MUST READ — the file you are editing and its test
- file: src/runtime.ts
  why: The ONLY production file to modify. Pi-free, 0 imports. Contains the SessionRuntime interface,
        freshRuntime(), getRuntime/nextSeq/resetRuntime/clearAll.
  pattern: |
    Mirror the `pendingBloatHits: BloatHit[]` field exactly:
    (1) add to the interface with a doc comment;
    (2) initialize in freshRuntime with a FRESH instance per call (never a module-level shared value — GOTCHA #5).
  gotcha: |
    runtime.ts imports NOTHING (not Pi, not config, not log) by design — it is a pure, fast unit-test target.
    Do NOT add any import. The Map is a built-in TS/JS type, no import needed.

- file: test/runtime.test.ts
  why: The test file to extend. Uses vitest. clearAll() in before/afterEach.
  pattern: |
    Two `expect(rt).toEqual({ ...fullShape... })` assertions assert the EXACT default shape and will FAIL
    once the field is added unless updated. There is also an `expectTypeOf` block that must gain a line.
  gotcha: |
    vitest `toEqual` does deep equality on Map instances by comparing entries, so
    `expect(rt).toEqual({ ..., shrinkMissCounts: new Map() })` works for an empty Map. Do NOT compare the Map
    with `===` when checking value-equality; use `.toEqual(new Map([...]))` or check `.size`/`.get()`.

# SPEC references (read-only context; do not edit)
- docfile: spec/04-data-model.md
  section: "§8. In-memory (non-persisted) state"
  why: SessionRuntime lives in a Map<string, SessionRuntime> keyed by sessionId; reset/created on session_start.
        Never cache a sessionManager handle (C12) — only primitive values + collections.

- docfile: spec/09-edge-cases.md
  section: "E15. Very large number of accumulated markers/notes (long sessions)"
  why: The CONSUMER. Stale-marker retirement: a pinned shrink whose target entry has been absent for
        config.shrink.staleAfterFires (default 3) consecutive fires MUST be auto-retired. This task provides
        the miss-count map that E15 logic (P3.M2.T3.S1) increments/reads.

# Architecture reference (read-only; describes current verified codebase state)
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  section: "### runtime.ts (154 lines) — Pi-free per-session state"
  why: Confirms current 7-field SessionRuntime and the exact P3.M2 delta: "add shrinkMissCounts: Map<string,
        number> (keyed by shrink marker id). resetRuntime already wipes the entire entry, so new fields are
        automatically reset on session_start."
```

### Current Codebase tree (the two files in scope)

```bash
src/runtime.ts            # 154 lines, Pi-free, 0 imports. MODIFY: interface + freshRuntime.
test/runtime.test.ts      # vitest. MODIFY: 2 toEqual shape asserts, 1 expectTypeOf block, ADD new tests.
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/runtime.ts            # SessionRuntime gains shrinkMissCounts; freshRuntime initializes new Map().
test/runtime.test.ts      # shape asserts + type assert updated; ownership/reset/clearAll/mutation tests added.
```

No new files. (Research notes optionally land in `plan/003_2c3b19ff6a7b/P3M2T2S1/research/`.)

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — GOTCHA #5 (per-session ownership): Each fresh runtime MUST get its OWN collection instance.
//   The existing code initializes `pendingBloatHits: []` inside freshRuntime() — NOT as a module-level
//   shared array. Do the same for shrinkMissCounts: `new Map()` INSIDE freshRuntime, never a module-level
//   const Map. A shared module-level Map would leak miss-counts across sessions (s1's counts visible to s2).

// CRITICAL — no imports: runtime.ts deliberately imports NOTHING (not Pi, not config, not log). Map is a
//   built-in; do not add any import statement.

// GOTCHA — resetRuntime DELETES the whole map entry; it does NOT mutate fields in place. So adding a new
//   field needs NO change to resetRuntime/clearAll/getRuntime/nextSeq — the new field is fresh by construction
//   on the next getRuntime after a reset. Do not "helpfully" add reset logic.

// GOTCHA — vitest toEqual with Map: `toEqual` deep-compares Map contents. For an empty default Map,
//   `shrinkMissCounts: new Map()` inside an `toEqual({...})` literal works. Avoid `===` for value checks.

// GOTCHA — the two `toEqual({...})` default-shape assertions in runtime.test.ts are EXACT-shape checks.
//   They currently enumerate all 7 fields. After adding the 8th field they WILL FAIL unless updated to include
//   `shrinkMissCounts: new Map()`. There are exactly two such blocks (see Implementation Tasks).

// SCOPE — do NOT touch config.ts. The knobs shrink.maxActive (32) and shrink.staleAfterFires (3) are added
//   by P3.M2.T1.S1 (running in parallel, disjoint file). This task does NOT read or consume them. The consumer
//   is P3.M2.T3.S1 (filter.ts contextHandler), which is NOT this task. Do not add retirement logic here.
```

## Implementation Blueprint

### Data models and structure

```typescript
// The ONLY data-model change: one new field on the SessionRuntime interface.
// Type: Map<string, number>
//   - key:   a shrink marker's `id` (string, from markers.ts appendShrinkMarker — randomUUID-based)
//   - value: consecutive "miss" fires count (number). Incremented by the future P3.M2.T3 logic on each
//            context.fire where the pinned shrink's target is absent; reset to 0 / deleted on a hit.
// No new Pydantic/schema/oracle model — this is in-memory, non-persisted (spec §8).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/runtime.ts — extend SessionRuntime interface
  - ADD to the `SessionRuntime` interface (immediately after `pendingBloatHits: BloatHit[];`):
      /** Consecutive-fire miss count per active pinned shrink (keyed by shrink marker id), for stale-marker
       *  retirement (spec E15). Incremented by filter.ts contextHandler when a pinned shrink's target is
       *  absent on a given fire; reset/deleted on a hit or retirement. Each fresh runtime gets its OWN Map
       *  (GOTCHA #5 — never a module-level shared Map). Consumed by P3.M2.T3.S1. */
      shrinkMissCounts: Map<string, number>;
  - NAMING: field name exactly `shrinkMissCounts` (camelCase, matching contract). Type exactly
            `Map<string, number>`.
  - PLACEMENT: inside the `export interface SessionRuntime { ... }` block, as the last field.
  - FOLLOW: the doc-comment style of every other field (a `/** ... */` block above the field).

Task 2: MODIFY src/runtime.ts — initialize in freshRuntime
  - ADD to the object returned by `freshRuntime(sessionId)` (immediately after `pendingBloatHits: [],`):
      shrinkMissCounts: new Map(),
  - CRITICAL: `new Map()` is constructed INSIDE freshRuntime (per-call), NOT a module-level shared Map.
  - FOLLOW pattern: the existing `pendingBloatHits: [],` line (also a per-call fresh instance — GOTCHA #5).
  - DO NOT modify getRuntime, nextSeq, resetRuntime, or clearAll. (resetRuntime deletes the entry → the new
    field is automatically fresh on the next getRuntime; clearAll wipes the whole map. No extra wiring.)

Task 3: MODIFY test/runtime.test.ts — update the two exact-shape toEqual assertions
  - FIND: the block titled "getRuntime creates a runtime with the exact default shape on first access".
          Its `expect(rt).toEqual({ ... })` lists all 7 current fields.
          ADD: `shrinkMissCounts: new Map(),` as the last property (after pendingBloatHits: []).
  - FIND: in describe("resetRuntime ..."), the test "clears the entry so the next getRuntime returns a
          FRESH runtime". Its `expect(rt).toEqual({ ... })` also lists all 7 current fields.
          ADD: `shrinkMissCounts: new Map(),` as the last property there too.
  - GOTCHA: both blocks assert EXACT shape; omitting the new field makes them fail. Both must be updated.

Task 4: MODIFY test/runtime.test.ts — extend the expectTypeOf type block
  - FIND: describe("types") → "exports SessionRuntime / BloatHit / AgentMessage with the correct field types".
  - ADD after the `expectTypeOf(rt.pendingBloatHits).toEqualTypeOf<BloatHit[]>();` line:
      expectTypeOf(rt.shrinkMissCounts).toEqualTypeOf<Map<string, number>>();

Task 5: ADD tests in test/runtime.test.ts — ownership, reset, clearAll, in-place mutation
  - ADD (mirror the existing "each fresh runtime gets its OWN pendingBloatHits array" test):
      it("each fresh runtime gets its OWN shrinkMissCounts Map — no cross-session sharing (GOTCHA #5)", () => {
        const a = getRuntime("s1");
        const b = getRuntime("s2");
        expect(a.shrinkMissCounts).not.toBe(b.shrinkMissCounts);
        a.shrinkMissCounts.set("shrink-1", 1);
        expect(b.shrinkMissCounts.get("shrink-1")).toBeUndefined(); // b unaffected
      });
  - ADD (in the resetRuntime describe block):
      it("shrinkMissCounts is a fresh empty Map after resetRuntime", () => {
        const a = getRuntime("s1");
        a.shrinkMissCounts.set("shrink-1", 2);
        resetRuntime("s1");
        const fresh = getRuntime("s1");
        expect(fresh.shrinkMissCounts).not.toBe(a.shrinkMissCounts); // new Map instance (C12: stale ref abandoned)
        expect(fresh.shrinkMissCounts.size).toBe(0);
      });
  - ADD (in the clearAll describe block):
      it("clearAll wipes shrinkMissCounts for all sessions", () => {
        getRuntime("A").shrinkMissCounts.set("s", 3);
        clearAll();
        expect(getRuntime("A").shrinkMissCounts.size).toBe(0);
      });
  - ADD (in describe("in-place mutation contract ...")):
      it("filter.ts-style set/get/delete on shrinkMissCounts persists and is read back via getRuntime", () => {
        // Documents the P3.M2.T3 consumption contract: increment on miss, delete on hit/retire.
        getRuntime("s1").shrinkMissCounts.set("shrink-7", 1);
        expect(getRuntime("s1").shrinkMissCounts.get("shrink-7")).toBe(1);
        getRuntime("s1").shrinkMissCounts.set("shrink-7", 2); // consecutive miss increment
        expect(getRuntime("s1").shrinkMissCounts.get("shrink-7")).toBe(2);
        getRuntime("s1").shrinkMissCounts.delete("shrink-7"); // hit/retire resets
        expect(getRuntime("s1").shrinkMissCounts.has("shrink-7")).toBe(false);
      });
  - NAMING/PLACEMENT: put each new test in the describe block that matches its theme (see above). No new file.
```

### Implementation Patterns & Key Details

```typescript
// The complete production diff is two small additions. Here is the exact before→after for the interface:

// BEFORE (interface, last field):
//   pendingBloatHits: BloatHit[];
// }

// AFTER:
//   pendingBloatHits: BloatHit[];
//   /** Consecutive-fire miss count per active pinned shrink (keyed by shrink marker id), for stale-marker
//    *  retirement (spec E15). Each fresh runtime gets its OWN Map (GOTCHA #5). Consumed by P3.M2.T3.S1. */
//   shrinkMissCounts: Map<string, number>;
// }

// BEFORE (freshRuntime return, last prop):
//   pendingBloatHits: [],
// };

// AFTER:
//   pendingBloatHits: [],
//   shrinkMissCounts: new Map(),
// };

// Why a Map and not an object: keys are dynamic shrink-marker ids (added/removed at runtime), and the
// consumer needs .get/.set/.delete/.has/.size. Map<string, number> is the idiomatic fit and matches the
// contract verbatim. The key is the shrink marker `id` (the string stamped by appendShrinkMarker in
// markers.ts — a randomUUID). The value is the consecutive-miss count; the threshold (staleAfterFires,
// default 3) is read by the CONSUMER (P3.M2.T3), never here.
```

### Integration Points

```yaml
NO INTEGRATION POINTS for this task. Specifically:
  - runtime.ts: internal state only; no new import; no new export (the interface field is reachable via the
    already-exported SessionRuntime type and getRuntime).
  - config.ts: UNCHANGED (shrink.maxActive / shrink.staleAfterFires are P3.M2.T1.S1, disjoint file).
  - filter.ts: UNCHANGED here — the consumer (P3.M2.T3.S1) will later read/ mutate this map from
    contextHandler. This task only ships the container.
  - index.ts: UNCHANGED — resetRuntime already fires on session_start and wipes the whole entry; clearAll
    already fires on session_shutdown. No wiring change needed (the contract calls this out explicitly).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project first (runtime.ts is Pi-free so this is fast and authoritative).
npx tsc --noEmit
# Expected: ZERO errors. If the new interface field is missing from freshRuntime, or any test's toEqual
# shape is stale, tsc/vitest will surface it. Read and fix before proceeding.

# (No ruff / mypy / formatter configured — this is a TypeScript repo with no lint script in package.json.
#  Do not invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the runtime tests in isolation first (the only file this task touches on the test side).
npx vitest run test/runtime.test.ts
# Expected: ALL tests pass, including:
#   - the 2 updated exact-shape toEqual assertions (now include shrinkMissCounts: new Map()),
#   - the updated expectTypeOf line (Map<string, number>),
#   - the 4 new tests (ownership, reset, clearAll, in-place set/get/delete).

# Then the full suite to prove no other test regressed (e.g. a test importing SessionRuntime shape).
npx vitest run
# Expected: ALL tests pass. No other file should be affected (grep confirms shrinkMissCounts is greenfield).
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable for this task — runtime.ts is pure in-memory state with no runtime/server/endpoint surface.
# The smoke harness (test/integration/run-smoke.mjs, `npm run smoke`) exercises real Pi events and is owned
# by the integration tier; it does NOT directly assert on SessionRuntime fields. Skip it for this task
# unless a full-suite regression run is desired.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Not applicable — no domain-specific, performance, or security surface for an in-memory Map field.
# The semantic correctness (per-session isolation, reset/clear semantics) is fully covered by Level 2 tests.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes with zero errors.
- [ ] `npx vitest run test/runtime.test.ts` — all tests pass.
- [ ] `npx vitest run` — full suite passes (no regressions).

### Feature Validation

- [ ] `SessionRuntime` interface declares `shrinkMissCounts: Map<string, number>`.
- [ ] `freshRuntime` returns `shrinkMissCounts: new Map()` constructed per-call.
- [ ] Each fresh runtime gets its OWN Map instance (ownership test passes).
- [ ] After `resetRuntime('s1')`, `getRuntime('s1').shrinkMissCounts` is a fresh empty Map (new instance).
- [ ] After `clearAll()`, every session's `shrinkMissCounts` is a fresh empty Map.
- [ ] In-place `set`/`get`/`delete` on the Map persists across `getRuntime` calls (same live reference).
- [ ] No change to `getRuntime` / `nextSeq` / `resetRuntime` / `clearAll` bodies.

### Code Quality Validation

- [ ] `runtime.ts` still imports NOTHING (no new import added).
- [ ] Field doc-comment follows the existing per-field comment style.
- [ ] Field placement is the last member of the interface and the last property of the freshRuntime return.
- [ ] Test placement matches existing describe-block themes (ownership / resetRuntime / clearAll / mutation).
- [ ] No scope creep: config.ts, filter.ts, index.ts, markers.ts are all untouched.

### Documentation & Deployment

- [ ] No user-facing docs change required (internal in-memory state, spec §8). Confirmed greenfield and
      non-user-visible. README updates are P3.M4 (out of scope here).

---

## Anti-Patterns to Avoid

- ❌ Do NOT initialize `shrinkMissCounts` as a module-level shared Map — it MUST be `new Map()` inside `freshRuntime` (GOTCHA #5; shared state would leak counts across sessions).
- ❌ Do NOT add reset/wipe logic for the new field inside `resetRuntime`/`clearAll` — they already handle it by deleting/wiping the whole entry. "Helpful" reset code is wrong here.
- ❌ Do NOT import anything into `runtime.ts` — it is deliberately Pi-free with 0 imports.
- ❌ Do NOT touch `config.ts` — `shrink.maxActive`/`shrink.staleAfterFires` are P3.M2.T1.S1 (parallel, disjoint). This task neither reads nor consumes them.
- ❌ Do NOT add the stale-retirement / soft-cap logic — that is P3.M2.T3.S1 (filter.ts contextHandler). This task ships ONLY the state container.
- ❌ Do NOT leave the two exact-shape `toEqual` assertions in `runtime.test.ts` un-updated — they WILL fail and block the suite.

---

**Confidence Score: 10/10** — a single, well-scoped interface-field addition with a verbatim existing pattern (`pendingBloatHits`) to mirror, zero imports, and no integration surface. The only implementation risk is forgetting to update the two exact-shape test assertions, which is called out explicitly in Task 3 and the anti-patterns.