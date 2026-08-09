# PRP — P1.M2.T1.S1: Fix stale SessionRuntime fixture in drift_nudge.test.ts (BUG-002)

## Goal

**Feature Goal**: Make the project type-check cleanly under `npx tsc --noEmit` by adding the one missing
required field (`rewindRefusedTurnIndex`) to the stale `rt()` test fixture in `test/drift_nudge.test.ts`.
The field was added to the `SessionRuntime` type by later P4 drift-nudge-mute work but the hand-built
fixture was never updated, so the `as SessionRuntime` cast on a near-complete literal raises TS2352 under
`strict: true`.

**Deliverable**: A test-internal, one-line edit to **exactly one file** — `test/drift_nudge.test.ts` — inside
the `rt()` helper (lines 238–250): insert `rewindRefusedTurnIndex: null,` after `aboveHighWater: above,` and
before the closing `} as SessionRuntime;`.

**Success Definition**: After the edit, `npx tsc --noEmit` exits 0 with ZERO errors (the TS2352 at
test/drift_nudge.test.ts:239 is gone), and `npx vitest run` still passes all 882 tests unchanged (the added
field is unread by the high-water tests, so there is no behavior change). The cast remains `as SessionRuntime`
(NOT `as unknown as SessionRuntime`) — adding the missing field is the honest fix.

## User Persona (if applicable)

**Target User**: Developers / CI running a strict `tsc --noEmit` type-check gate on the project.

**Use Case**: A contributor (or CI) runs `npx tsc --noEmit` before merging; it must pass cleanly.

**Pain Points Addressed**: Today `tsc --noEmit` fails with a single TS2352 because the `rt()` fixture is stale
relative to the `SessionRuntime` type. A standard CI typecheck gate (which sibling P1.M2.T1.S2 will add) would
fail. This fix closes the one type error so the project type-checks cleanly.

## Why

- **CI hygiene / shift-left**: a clean `tsc --noEmit` is the baseline for a strict-TS project. PRD §2.5
  explicitly recommends "add a CI `tsc --noEmit` gate so the project type-checks cleanly" — this fix is the
  prerequisite (it removes the one error), and the sibling S2 adds the gate script.
- **Spec/type fidelity**: the `rewindRefusedTurnIndex` field is a real, required `SessionRuntime` field (added
  by P4, consumed by `filter.ts` to mute Nudge B after a rewind refusal). A test fixture cast to
  `SessionRuntime` should faithfully represent the type, not silently drop a field.
- **No runtime impact, no new tests.** The fixture is plain-object scaffolding; vitest transpiles without
  type-checking, so the 882 tests already pass and continue to.

## What

One inserted line in the `rt()` helper's returned object literal. No production code, no new tests, no config,
no API surface. The line goes BETWEEN `aboveHighWater: above,` and the closing `} as SessionRuntime;`.

### Success Criteria

- [ ] The `rt()` fixture object literal contains the line `rewindRefusedTurnIndex: null,` (4-space indent,
      matching the other fields), placed AFTER `aboveHighWater: above,` and BEFORE `} as SessionRuntime;`.
- [ ] The value is `null` — matches the field type `number | null` (src/runtime.ts:101) and the `freshRuntime()`
      default (src/runtime.ts:127).
- [ ] The cast is STILL `as SessionRuntime` (unchanged — NOT switched to `as unknown as SessionRuntime`).
- [ ] `npx tsc --noEmit` exits 0 with ZERO errors (the TS2352 at test/drift_nudge.test.ts:239 is gone).
- [ ] `npx vitest run` passes all 882 tests (no behavior change).
- [ ] No file other than `test/drift_nudge.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current fixture (lines 238–250), the verbatim type field (with exact
line citations), the exact line to insert and its placement, the rationale for `null`, the confirmed live
compiler error, and the precise validation commands. The implementer needs no exploration beyond opening
`test/drift_nudge.test.ts`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: test/drift_nudge.test.ts
  why: The rt() helper (lines 238–250) builds the stale SessionRuntime fixture; insert the missing field here.
  section: "rt() helper, lines 238–250 (the object literal returned by `return { ... } as SessionRuntime;`)."
  gotcha: "Field indent is 4 spaces (the `return {` is 2-space indented; the fields are 4-space). Match it.
           Insert BETWEEN `aboveHighWater: above,` and the closing `} as SessionRuntime;` — NOT at the top,
           NOT after sessionId."

# MUST READ — the type the fixture must satisfy (the field being added)
- file: src/runtime.ts
  why: (1) Line 101 `rewindRefusedTurnIndex: number | null;` — the REQUIRED field (no `?`) the fixture omits.
        (2) Line 127 `rewindRefusedTurnIndex: null,` inside freshRuntime() — the runtime DEFAULT = null.
        (3) Lines 59–101 export interface SessionRuntime — 10 required fields; the fixture has 9.
  pattern: "all fields are REQUIRED (none optional); the type added `rewindRefusedTurnIndex` in P4 (drift-nudge-
            mute). freshRuntime default for it is null."
  gotcha: "DO NOT change src/runtime.ts. It is the source of truth; the FIX is in the test fixture, not the type."

# MUST READ — the bug-hunt research (root cause + why TS2352 fires here but not the empty-object cast)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/tsc_fixture_research.md
  why: §3 (the stale fixture) + §3 'Why TS2352 fires here but not on the empty-object cast in runtime.test.ts'
        + §4 (full SessionRuntime field inventory) + §11 (validation commands). Confirms exactly one field is
        missing and that the empty `{}` cast elsewhere is NOT stale (do not touch it).
  critical: "§9 'Recommended fix' prescribes `rewindRefusedTurnIndex: null` (the honest fix) over the
             `as unknown as` escape hatch. This PRP follows §9 exactly."

# CONTEXT — tsconfig that makes tsc check test files under strict
- file: tsconfig.json
  why: `"strict": true` + `"include": ["src", "test"]` → tsc --noEmit type-checks test files, which is why the
        fixture error surfaces. (READ-ONLY — do NOT edit tsconfig.)
  gotcha: "vitest transpiles WITHOUT type-checking, which is why the 882 tests pass despite the missing field.
           The error only appears under tsc."

# CONTEXT — the test runner script
- file: package.json
  why: `"test": "vitest run"` is the suite command (882 tests). There is no `typecheck` script yet — the sibling
        task P1.M2.T1.S2 adds it. This PRP must NOT edit package.json (no file conflict).
  gotcha: "Do NOT add a typecheck script here — that is P1.M2.T1.S2's job (separate sibling, edits package.json).
           This PRP only fixes the fixture so tsc --noEmit passes."

# CONTEXT — the parallel item (confirms no file conflict)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M1T2S2/PRP.md
  why: CONTRACT. Wires settings loading into src/index.ts (factory + session_start handler). Edits src/index.ts
        (+ possibly src/settings.ts). Does NOT touch test/drift_nudge.test.ts → zero overlap; either order OK.
```

### Current Codebase tree (the only relevant slice)

```bash
test/
├── drift_nudge.test.ts   # ← THIS PRP edits the rt() helper (lines 238–250)
├── runtime.test.ts       # READ-ONLY — `{} as SessionRuntime` empty cast (compiles fine; DO NOT touch)
└── (other tests — out of scope)
src/
├── runtime.ts            # READ-ONLY reference — SessionRuntime interface (line 101) + freshRuntime (line 127)
├── filter.ts             # READ-ONLY — consumes rewindRefusedTurnIndex (drift-nudge mute)
└── tools/rewind.ts       # READ-ONLY — consumes rewindRefusedTurnIndex
tsconfig.json             # READ-ONLY — strict:true, include:["src","test"]
package.json              # READ-ONLY here — sibling P1.M2.T1.S2 adds the typecheck script
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
test/drift_nudge.test.ts   # +1 line inside the rt() helper's object literal
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (placement): insert `rewindRefusedTurnIndex: null,` AFTER `aboveHighWater: above,`
//   and BEFORE the closing `} as SessionRuntime;`. Do NOT place it elsewhere in the literal. Keeping it last
//   (just above the cast) mirrors freshRuntime() field order minimally and keeps the diff to one insertion.

// CRITICAL GOTCHA #2 (value = null, not a number): the field type is `number | null` and freshRuntime's
//   default is `null`. Use `null` — NOT 0, NOT undefined, NOT a fake turnIndex. The shouldHighWater tests
//   that consume this fixture never read rewindRefusedTurnIndex, so null is behaviorally inert AND type-correct.

// CRITICAL GOTCHA #3 (keep `as SessionRuntime`): DO NOT "fix" the error by switching to
//   `as unknown as SessionRuntime`. Casting through `unknown` silences TS2352 but hides the staleness; adding
//   the missing field makes the literal structurally complete so the plain `as SessionRuntime` cast is
//   legitimate (this is the honest fix the research §9 prescribes).

// CRITICAL GOTCHA #4 (indent): the fixture's fields are 4-space indented (`return {` is 2-space; fields are
//   4-space). The new line must be 4-space indented to match — `    rewindRefusedTurnIndex: null,`.

// CRITICAL GOTCHA #5 (do NOT touch the empty cast): runtime.test.ts:263 uses `{} as SessionRuntime` — an empty
//   object. TS ALLOWS that cast (SessionRuntime is assignable to {} so the overlap check passes) and it is NOT
//   the BUG-002 error. Leave it alone. (It's a minor coverage gap, explicitly out of scope per research §10.)

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/runtime.ts, src/filter.ts, src/tools/rewind.ts, src/index.ts, src/settings.ts → production code.
#   - package.json → the typecheck script is P1.M2.T1.S2 (separate sibling).
#   - runtime.test.ts (the empty `{}` cast) and any other test file → out of scope.
#   - tsconfig.json → READ-ONLY.
# This PRP edits ONLY test/drift_nudge.test.ts (the rt() helper).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. The PRP adds a field to a test fixture so it satisfies the EXISTING
`SessionRuntime` interface (src/runtime.ts:59–101). The field `rewindRefusedTurnIndex: number | null` already
exists in the type; the fixture was simply stale._

### Implementation Tasks (ordered by dependencies)

Exactly one task — a single-line insertion. Apply it as one exact find/replace.

```yaml
Task 1: EDIT test/drift_nudge.test.ts — insert `rewindRefusedTurnIndex: null,` into the rt() fixture
  - LOCATE the rt() helper (lines 238–250). The object literal spans `return {` (line 239) … `} as SessionRuntime;` (line 249).
  - FIND (verbatim current — the last field + the closing cast):
      "    aboveHighWater: above,\n  } as SessionRuntime;"
  - REPLACE WITH:
      "    aboveHighWater: above,\n    rewindRefusedTurnIndex: null,\n  } as SessionRuntime;"
  - RATIONALE: SessionRuntime (src/runtime.ts:101) requires `rewindRefusedTurnIndex: number | null`; the
    fixture omitted it (stale since P4). Value `null` matches the type and the freshRuntime() default
    (src/runtime.ts:127). The shouldHighWater tests that use this fixture never read this field, so the
    runtime behavior is unchanged (882 tests stay green).
  - FORM: 4-space indent (matches the other fields). Comma-terminated. Placed AFTER `aboveHighWater: above,`
    and BEFORE `} as SessionRuntime;`.
  - DO NOT:
      * change the `as SessionRuntime` cast to `as unknown as SessionRuntime`;
      * reorder or edit any other field;
      * touch runtime.test.ts's `{} as SessionRuntime` empty cast (it compiles fine; out of scope);
      * edit src/runtime.ts, package.json, tsconfig.json, or any other file.
```

#### Resulting rt() helper (post-edit, lines ~238–251)

```ts
function rt(above = false): SessionRuntime {
  return {
    sessionId: "s1",
    seq: 0,
    tokenBaseline: null,
    lastTurnIndex: null,
    lastFiltered: null,
    lastFilterTs: null,
    pendingBloatHits: [],
    shrinkMissCounts: new Map(),
    aboveHighWater: above,
    rewindRefusedTurnIndex: null,
  } as SessionRuntime;
}
```

### Implementation Patterns & Key Details

```typescript
// The single change: one new line in the fixture literal.
// BEFORE (last two lines of the literal):
//     aboveHighWater: above,
//   } as SessionRuntime;
// AFTER:
//     aboveHighWater: above,
//     rewindRefusedTurnIndex: null,   // ← added; matches src/runtime.ts:101 type + :127 default
//   } as SessionRuntime;

// WHY `null` and not `as unknown as`:
//   - src/runtime.ts:101  →  rewindRefusedTurnIndex: number | null;   (REQUIRED, not optional)
//   - src/runtime.ts:127  →  rewindRefusedTurnIndex: null,            (freshRuntime default)
//   Adding the field with its default value makes the literal structurally complete, so the existing
//   `as SessionRuntime` assertion becomes a legitimate narrowing (TS2352 disappears). The `as unknown as`
//   escape hatch TS suggests would HIDE the staleness rather than fix it — do not use it.
```

### Integration Points

```yaml
NO INTEGRATION POINTS — test-internal fix (Mode A).
  - DATABASE: none
  - CONFIG: none
  - ROUTES: none
  - CODE: none (src/* are READ-ONLY references; the parallel item P1.M1.T2.S2 edits src/index.ts — separate
          surface, zero overlap; the sibling P1.M2.T1.S2 adds a typecheck script to package.json — separate
          surface, complementary but no file conflict)
  - The only "integration" is TYPE-CHECK CLEANLINESS: this fix is the prerequisite for the CI `tsc --noEmit`
    gate recommended in PRD §2.5 (the script is added by P1.M2.T1.S2). Validation gates below enforce it.
```

---

## Validation Loop

This is a one-line test-fixture fix. Validation = the strict type-check (the gate that was failing) + the
full vitest suite (regression guard). Run both after the edit.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The strict type-check — THIS IS THE GATE THE FIX TARGETS.
# Before the fix it prints exactly one error (TS2352 at test/drift_nudge.test.ts:239); after the fix: ZERO errors, exit 0.
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0

# Confirm the fixture now includes the field:
grep -n 'rewindRefusedTurnIndex' test/drift_nudge.test.ts   # expect ≥1 hit inside the rt() helper
```
Expected: `npx tsc --noEmit` exits 0 with no output; the grep prints the new line.

### Level 2: Unit Tests (Component Validation)

```bash
# The drift_nudge suite specifically (the file touched).
npx vitest run test/drift_nudge.test.ts
# Expected: all tests in this file pass (the high-water lifecycle tests are unaffected — they never read
# rewindRefusedTurnIndex).

# Full suite — regression guard (must stay at the existing 882 passing).
npx vitest run
# Expected: 882 tests pass, 0 failures. (vitest transpiles without type-checking, so the fix changes no
# runtime behavior.)
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for a test-fixture fix. There is no service to start, no endpoint to hit, no DB.
# The "system" validation IS Level 1 (the project-wide `tsc --noEmit` now passes).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Optional — confirm the exact pre-fix error is gone (the before/after proof):
#   BEFORE the fix, `npx tsc --noEmit` printed:
#     test/drift_nudge.test.ts(239,10): error TS2352: ... Property 'rewindRefusedTurnIndex' is missing ...
#   AFTER the fix, the same command prints nothing and exits 0.
# That before→after transition is the proof the fix is correct. Level 1 covers it programmatically.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 with ZERO errors (the TS2352 at test/drift_nudge.test.ts:239 is gone).
- [ ] `npx vitest run test/drift_nudge.test.ts` — all tests pass.
- [ ] `npx vitest run` — full suite passes (882 tests, 0 failures).

### Feature Validation
- [ ] The `rt()` fixture literal contains `rewindRefusedTurnIndex: null,` (4-space indent), placed after
      `aboveHighWater: above,` and before `} as SessionRuntime;`.
- [ ] Value is `null` (matches the `number | null` type and the freshRuntime default).
- [ ] The cast is still `as SessionRuntime` (NOT `as unknown as SessionRuntime`).
- [ ] No edits to any file other than `test/drift_nudge.test.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT touch `src/runtime.ts` (or any `src/*` — production code; runtime.ts is the source of truth).
- [ ] Did NOT touch `package.json` (the typecheck script is sibling P1.M2.T1.S2's job).
- [ ] Did NOT touch `tsconfig.json` (READ-ONLY).
- [ ] Did NOT touch `runtime.test.ts`'s `{} as SessionRuntime` empty cast (compiles fine; out of scope).
- [ ] Did NOT switch the cast to `as unknown as SessionRuntime` (adding the field is the honest fix).

### Documentation
- [ ] No user-facing/config/API/spec surface change (Mode A — test-internal fix). No README/spec edits needed.

---

## Anti-Patterns to Avoid

- ❌ Don't switch the cast to `as unknown as SessionRuntime` to silence the error — that hides the staleness
  instead of fixing it. Adding the missing field (with its default `null`) is the correct, honest fix
  (research §9).
- ❌ Don't invent a numeric value for `rewindRefusedTurnIndex` (e.g. `0`) — the field type is `number | null`
  and the runtime default is `null`; `null` is both type-correct and behaviorally inert for the high-water
  tests.
- ❌ Don't place the new line anywhere except after `aboveHighWater: above,` and before `} as SessionRuntime;`
  — keep the diff to a single insertion at the end of the literal.
- ❌ Don't touch `runtime.test.ts`'s empty `{} as SessionRuntime` cast — TS allows it (not a TS2352) and it is
  out of scope.
- ❌ Don't edit `src/runtime.ts`, `package.json`, `tsconfig.json`, or any other file — the type is correct; only
  the test fixture is stale. The typecheck script is a separate sibling task.
- ❌ Don't add new tests — this is a one-line fixture repair; there is no new behavior to test (the gate IS the
  now-passing `tsc --noEmit`).

---

## Confidence Score

**10/10** for one-pass implementation success. This is a single-line insertion in one test fixture, with the
verbatim current text, the exact target line and placement, the verified field type + default (src/runtime.ts
lines 101 + 127), the confirmed live TS2352 error message, and two deterministic validation gates (`tsc`
exits 0; vitest 882/882). The only decisions (value = `null`; keep `as SessionRuntime`) are both pinned by
the contract and the research §9. No dependency on the parallel item (separate file) or the sibling script
task (separate file).