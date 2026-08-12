# PRP — P4.M1.T1.S1: edge-cases.test.ts E19 — assert `applyShrink` is non-mutating

> **Mode A — test-only.** No source change, no spec edit, no docs. The spec/08 E19 "hard invariant" bullet
> (commit d5701c8f) already states: *shrink is a view substitution — the user's actual message stays on disk
> and is recoverable via `/tree`.* This task makes that invariant **executable** at the pure-helper level by
> asserting `applyShrink` never mutates its input array. This is the first subtask of Phase 4 (no prior
> dependency) and feeds P4.M1.T1.S2 (integration proof) and P4.M1.T1.S3 (README note can cite the test).

---

## Goal

**Feature Goal**: Add 2 (or 3, incl. the optional multi-message case) `it()` tests inside the existing
`describe("E19 — Shrink target is a non-toolResult message (role preserved)")` block of
`test/edge-cases.test.ts` that **explicitly assert `applyShrink` does NOT mutate its input array** — the
input survives byte-identical, and only the returned (new) array carries the stamped replacement. This
locks the "the original is never lost" hard invariant against future regressions at the pure-helper level.

**Deliverable**: A single edit to `test/edge-cases.test.ts` — new `it()` cases appended inside the E19
describe block (after the existing `filterPipeline pairing is unaffected` test, before the block's closing
`});`). Pure-helper tests, no Pi, no new imports, no fixtures beyond the already-in-scope local builders
(`user`/`asstText`) and already-imported `applyShrink`/`stampShrink`/`MessageLike`.

**Success Definition**: `npx vitest run test/edge-cases.test.ts` is green (new tests pass alongside the
existing E19 tests), `npm run typecheck` (tsc --noEmit) passes with no new errors, and the full suite
`npm test` stays green. The E19 block now asserts both role preservation (existing) **and** input
non-mutation (new).

## User Persona (if applicable)

**Target User**: Maintainer / future contributor who refactors `src/transforms.ts`.
**Use Case**: A refactor of `applyShrink` (e.g. an in-place optimization that assigns onto `orig` or
reuses the input array) would silently break the "original survives" guarantee. These tests fail loudly
the moment such a regression is introduced.
**Pain Points Addressed**: The current E19 tests assert only the *returned* array's shape — they do NOT
prove the *input* was untouched. The hard invariant ("the original stays on disk") currently rests on
reading the function body; this task turns that reading into an executable regression guard.

## Why

- **The hard invariant is a trust statement, not yet a test.** spec/08 E19 (h2.100) gained a bullet:
  *"shrink is a view substitution — the user's actual message stays on disk and is recoverable via `/tree`."*
  That promise is only as durable as `applyShrink`'s non-mutation discipline. An executable test is the
  only thing that survives the next refactor. (PRD h2.115 §1.5 mandates pure-helper `applyShrink` tests.)
- **Non-mutation IS the in-code proof.** `applyShrink` (src/transforms.ts ~L963) returns
  `messages.map((m, j) => (j === i ? replacement : m))` — a NEW array — and builds each replacement via
  `{ ...orig, content: newContent }` (a spread clone). The input array and its message objects are never
  assigned to. These tests assert exactly that, closing the gap between "we believe the code is safe" and
  "a CI failure proves we broke it."
- **Scope discipline.** This is the helper-level layer (PRD Tier 1, h2.115). The integration/on-disk proof
  is P4.M1.T1.S2's job (smoke harness); the README trust note is P4.M1.T1.S3's. This task stays purely at
  the `applyShrink` function boundary — no Pi, no disk.

## What

### Visible behavior (test additions, all inside the E19 describe)

1. **(a) Hard-invariant non-mutation (single user message):** deep-clone a snapshot of the input array
   before the call, run `applyShrink`, then assert `JSON.stringify(msgs) === JSON.stringify(snapshot)`
   (input byte-identical) AND `expect(out).not.toBe(msgs)` (a NEW array was returned, never the input ref).
2. **(b) Input element holds the original; only the returned copy is replaced:** after the call, assert
   the *input* `msgs[0].content === "hello world"` (the raw user string — NOT `stampShrink("X")`), and the
   *returned* `out[0]` content-array's `[0].text === stampShrink("X")`. This is the pure-helper analog of
   "the original stays on disk; only the model's in-context copy is replaced."
3. **(c) [OPTIONAL but recommended] Multi-message non-mutation:** a 3-message input where `by_content_includes`
   matches the middle index; assert the whole input array is byte-identical to its snapshot, and that the
   *other* indices' originals survive in the input (and are passed through by reference in the output).

### Success Criteria
- [ ] New `it()` cases live INSIDE the existing E19 describe (not a new top-level describe, not in another
      edge-case block).
- [ ] Test (a) asserts input byte-identity via a JSON snapshot AND `out` is a new array (`not.toBe(msgs)`).
- [ ] Test (b) asserts the input element is unchanged (raw string) while the returned copy is the stamped
      replacement array.
- [ ] Test (c) (if included) covers a multi-message input and asserts every non-matched index's original
      survives in the input.
- [ ] `npx vitest run test/edge-cases.test.ts` green; `npm run typecheck` clean; `npm test` green.
- [ ] NO file other than `test/edge-cases.test.ts` is touched. NO new imports added (all symbols in scope).

---

## All Needed Context

### Context Completeness Check
_Pass._ An agent with zero knowledge of this repo can execute this PRP: the exact file, the exact
describe block, the exact insertion anchor, the exact local builders to call, the exact assertion idiom
(matching the existing E19 tests + the house non-mutation idiom in `drift_nudge.test.ts`), and the exact
validation commands are all given below. The content-type subtlety (user content = string vs. shrunk
content = array) is called out so the casts are correct on the first try.

### Documentation & References

```yaml
# MUST READ — include in your context window before editing

- file: test/edge-cases.test.ts
  why: THE file being edited (1023 lines). Read the E19 describe block (L989–1023) in full — the new
        tests must MATCH its style (local builders, inline casts, single-line // comments on assertions).
  pattern: E19's existing "applyShrink on a USER message → role 'user' preserved, content replaced" (L991)
        is the template for the new user-message tests: build [user("...")], call applyShrink, assert on
        out[0] with `const block = out[0].content as Array<Record<string, unknown>>`.
  gotcha: E19 is the LAST describe in the file; its closing `});` is effectively EOF (L1022–1023). Insert
        the new tests just before that final `});`.

- file: test/edge-cases.test.ts  (L25–L30 — imports)
  why: CONFIRMS no new imports are needed. `applyShrink`, `stampShrink`, and `type MessageLike` are
        already imported. Do NOT add imports.

- file: test/edge-cases.test.ts  (L76–L115 — LOCAL fixture builders)
  why: `user(text)` and `asstText(text)` are already defined IN-FILE and in scope inside any `it()`.
  pattern: |
      function user(text: string): MessageLike { return { role: "user", content: text }; }   // content = STRING
      function asstText(text: string): MessageLike { return { role: "assistant", content: [{ type: "text", text }] }; }  // content = ARRAY
  critical: A USER message's `content` is a bare STRING, not an array. A shrunk message's `content` is
        an ARRAY of blocks. This asymmetry drives every assertion below.

- file: src/transforms.ts  (~L963–L1000 — applyShrink body)
  why: PROOF of non-mutation; read it to understand WHY the tests pass and to cite the mechanic.
  pattern: |
      const orig = messages[i];
      const text = stampShrink(typeof rep === "string" ? rep : "");
      const newContent: ContentBlock[] = [{ type: "text", text }];
      let replacement: MessageLike;
      try { replacement = { ...(orig as MessageLike), content: newContent }; }   // spread CLONE — orig never written
      catch { replacement = { role: ..., content: newContent }; }
      return messages.map((m, j) => (j === i ? replacement : m));   // NEW array; others passed BY REFERENCE
  critical: On a NO-MATCH / out-of-range, applyShrink returns the SAME reference (`return messages;`) —
        that path is already covered by E8's "SAME reference" tests (L601). The NEW tests cover the MATCH
        path: a NEW array is returned and the input is untouched.

- file: test/drift_nudge.test.ts  (L185 and L492)
  why: HOUSE non-mutation test idiom to mirror for stylistic consistency.
  pattern: |
      expect(result).not.toBe(input);          // a NEW array
      expect(before[0]).toEqual({ role: "user", content: "hi" });   // element deep-equality
  gotcha: The task contract ALSO specifies a byte-identical JSON snapshot
        (`JSON.parse(JSON.stringify(msgs))`) for the hard-invariant test — STRICTER than toEqual (catches
        nested mutation). Use the snapshot for test (a); it's the load-bearing assertion.

- file: src/transforms.ts  (stampShrink, ~L955)
  why: stampShrink(rep) returns `"<context-shrunk>\n${rep}\n</context-shrunk>"`. Cited so the `.not.toBe`
        belt-and-suspenders assertion in test (b) is obviously correct (a raw user string never equals a
        stamped envelope).

- prd: spec/08-edge-cases.md §E19 (heading h2.100)
  why: The hard-invariant bullet this test enforces: "shrink is a view substitution — the user's actual
        message stays on disk and is recoverable via /tree. Summarizing user input is acceptable precisely
        because the original always survives; only the model's in-context copy is replaced."
  section: "E19. Shrink target is a non-toolResult message" → "The original is never lost (hard invariant)"

- prd: spec/10-verification.md §1.5 (heading h3.62, via h2.115)
  why: Authoritative Tier-1 test contract for applyShrink — these new tests are an extension of that list
        (the existing E19 block already partially covers §1.5's role-preservation bullets; non-mutation is
        the missing assertion).
```

### Current Codebase tree (relevant slice)

```
test/
  edge-cases.test.ts     # THE file edited (1023 lines; E19 = L989–1023, last describe)
  drift_nudge.test.ts    # READ-ONLY reference for the non-mutation assertion idiom (L185, L492)
src/
  transforms.ts          # READ-ONLY reference: applyShrink body (~L963) + stampShrink (~L955)
test/                    # fixture builders (user/asstText) are LOCAL to edge-cases.test.ts (L76–L115)
```

### Desired Codebase tree (delta)

```
test/
  edge-cases.test.ts     # MODIFIED — 2 (or 3) new `it()` cases appended inside the E19 describe block.
                         #   No other file touched.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — content-type asymmetry. A user() message has content: STRING. After applyShrink, the
//   RETURNED message has content: ContentBlock[] (an array). So:
//     - assert the INPUT element:  expect(msgs[0].content).toBe("hello world")      // string compare ✓
//     - assert the OUTPUT element: must cast — `(out[0].content as Array<Record<string,unknown>>)[0].text`
//   The existing E19 tests already do this cast (L998). Mirror it exactly.

// CRITICAL #2 — insertion anchor must be UNIQUE. The edit's oldText is the tail of the filterPipeline test:
//        expect(shrunk?.role).toBe("assistant");
//      });
//    });
//   The line `expect(shrunk?.role).toBe("assistant");` appears ONCE in the file (verify via grep before
//   editing). Insert the new it() blocks between the filterPipeline test's closing `  });` and the
//   describe's closing `});`.

// CRITICAL #3 — do NOT add a new describe or move tests. The new it() cases go INSIDE the existing
//   "E19 — Shrink target is a non-toolResult message (role preserved)" describe. Do not create an "E19b".

// CRITICAL #4 — do NOT add imports. applyShrink, stampShrink, MessageLike, and the user/asstText builders
//   are all already in scope. Adding a duplicate import is a lint/compile error.

// CRITICAL #5 — applyShrink's no-op path returns the SAME array reference (already tested in E8, L601).
//   The new tests must use a MATCHING target (by_content_includes that hits a message) so they exercise
//   the NEW-array path — that is where non-mutation of the input is meaningful. A no-match would make
//   `expect(out).not.toBe(msgs)` FAIL (out === msgs on no-op). Always pick a substring that IS present.

// CRITICAL #6 — JSON snapshot compares the WHOLE input structure. Because a user() message serializes
//   content as a string and an asstText() message serializes it as an array, the snapshot covers both
//   shapes — no special handling needed. Use JSON.parse(JSON.stringify(msgs)) (the task-specified idiom).

// CRITICAL #7 — by_content_includes is a SUBSTRING match (first/any occurrence). For the multi-message
//   test (c), ensure the substring is unique to the intended index so the match is unambiguous.
```

---

## Implementation Blueprint

### Data models and structure
None — this is a test-only edit. The only "data" is the exact `it()` blocks below. All message shapes are
produced by the existing local builders; the marker literal `{ target: { by_content_includes: "..." }, replacement: "..." }`
matches the `applyShrink` 2nd-arg type already used by the existing E19 tests.

### Implementation Tasks (ordered by dependencies)

> **Process:** Read the live `test/edge-cases.test.ts` E19 block (offset ~986, limit ~40) to capture the
> EXACT closing text of the filterPipeline test, then issue ONE edit that inserts the new `it()` blocks
> between that test's closing `});` and the describe's closing `});`. Run the validation loop.

```yaml
Task 1: READ — confirm the insertion anchor
  - READ test/edge-cases.test.ts offset 986 limit 40.
  - CONFIRM the last lines of the filterPipeline test are exactly:
        expect(shrunk?.role).toBe("assistant");
      });
    });
  - CONFIRM (grep) `expect(shrunk?.role).toBe("assistant");` is unique in the file.
  - CONFIRM applyShrink / stampShrink / MessageLike are imported (L25–L30) and user/asstText are local (L76–L115).

Task 2: EDIT — append the new it() blocks inside the E19 describe (ONE edit)
  - oldText (the unique tail of the filterPipeline test + the describe close):
        expect(shrunk?.role).toBe("assistant");
      });
    });
  - newText (the SAME tail, but with the new it() blocks inserted BEFORE the describe's closing `});`).
    Paste the test bodies from "Implementation Patterns & Key Details" verbatim. Each it() is:
      (a) "applyShrink does NOT mutate its input array (original survives — the hard invariant)"
      (b) "applyShrink on a USER message: the input array still holds the original content; only the returned copy is replaced"
      (c) [OPTIONAL] "applyShrink at index i leaves every OTHER index's original intact in the input (multi-message)"
  - FOLLOW pattern: the existing E19 "applyShrink on a USER message" test (L991) — same builder call,
        same inline `as Array<Record<string, unknown>>` cast for the output content array, same terse
        `// comment` style on load-bearing assertions.
  - NAMING: `it("applyShrink ...", () => { ... })` — imperative, describes the asserted behavior.
  - PLACEMENT: INSIDE the E19 describe, AFTER the filterPipeline test, BEFORE the block's `});`.

Task 3: VERIFY — targeted run + typecheck + full suite
  - RUN: npx vitest run test/edge-cases.test.ts   (expect green, incl. the new E19 tests)
  - RUN: npm run typecheck                        (tsc --noEmit; expect no new errors)
  - RUN: npm test                                  (full suite; expect green — no regressions)
  - IF any new test fails: READ the failure, re-read the applyShrink body, and reconcile (the function is
    provably non-mutating — a failure means an assertion was written against the wrong content type or a
    no-match target; fix the test, never the source, for this task).
```

### Implementation Patterns & Key Details

```typescript
// ════════════════════════════════════════════════════════════════════════════
// PASTE THESE it() BLOCKS INSIDE the E19 describe, just before its closing `});`.
// They mirror the existing E19 tests' style (local builders, inline casts, terse // comments).
// All symbols (applyShrink, stampShrink, MessageLike, user, asstText) are already in scope — NO imports.
// ════════════════════════════════════════════════════════════════════════════

// (a) THE HARD INVARIANT — the input array survives byte-identical; applyShrink returns a NEW array.
//     This is the in-code proof of spec/08 E19 "the original is never lost (view substitution)".
it("applyShrink does NOT mutate its input array (original survives — the hard invariant)", () => {
  const msgs: MessageLike[] = [user("hello world")];
  const snapshot = JSON.parse(JSON.stringify(msgs)); // deep clone the pre-call state
  const out = applyShrink(msgs, { target: { by_content_includes: "hello" }, replacement: "X" });
  expect(out).not.toBe(msgs); // a NEW array (map) — never the input reference
  // The input is byte-identical to its pre-call snapshot → the original user content SURVIVES untouched.
  expect(JSON.stringify(msgs)).toBe(JSON.stringify(snapshot));
});

// (b) The pure-helper analog of "the original stays on disk; only the model's in-context copy is replaced":
//     the INPUT element still holds the raw string; only the RETURNED copy carries the stamped replacement.
it("applyShrink on a USER message: the input array still holds the original content; only the returned copy is replaced", () => {
  const msgs: MessageLike[] = [user("hello world")];
  const out = applyShrink(msgs, { target: { by_content_includes: "hello" }, replacement: "X" });
  // INPUT: still the raw user string — NOT the stamped replacement.
  expect(msgs[0].content).toBe("hello world"); // user() content is a bare STRING
  expect(msgs[0].content).not.toBe(stampShrink("X")); // belt-and-suspenders (a raw string ≠ a stamped envelope)
  // RETURNED COPY: content is the stamped replacement block array.
  const outBlock = out[0].content as Array<Record<string, unknown>>;
  expect(outBlock[0].text).toBe(stampShrink("X"));
});

// (c) [OPTIONAL but recommended] Multi-message: the matched index is replaced in the output, but EVERY
//     index's original survives in the INPUT (byte-identical), and non-matched indices pass through by ref.
it("applyShrink at index i leaves every OTHER index's original intact in the input (multi-message)", () => {
  // "shrink me" is unique to index 1 → unambiguous match (by_content_includes is a substring match).
  const msgs: MessageLike[] = [user("keep me"), asstText("shrink me please"), user("also keep")];
  const snapshot = JSON.parse(JSON.stringify(msgs));
  const out = applyShrink(msgs, { target: { by_content_includes: "shrink me" }, replacement: "Z" });
  expect(out).not.toBe(msgs); // a NEW array
  // The ENTIRE input is byte-identical to its pre-call snapshot (no index mutated).
  expect(JSON.stringify(msgs)).toBe(JSON.stringify(snapshot));
  // Specifically: the non-matched indices in the INPUT still hold their raw originals.
  expect(msgs[0].content).toBe("keep me");
  expect(msgs[2].content).toBe("also keep");
  expect(msgs[1].content).toBe("shrink me please"); // the matched index's INPUT is also untouched
  // And in the OUTPUT, only index 1 was replaced; the others are the original object refs.
  expect((out[1].content as Array<Record<string, unknown>>)[0].text).toBe(stampShrink("Z"));
});

// ════════════════════════════════════════════════════════════════════════════
// GOTCHA recap embedded for the implementer:
//  - "hello" / "shrink me" are SUBSTRINGS that ARE present → match path (NEW array), NOT the no-op path.
//  - user() content is a STRING; shrunk output content is an ARRAY → cast the OUTPUT, compare the INPUT as string.
//  - These three it() blocks are the ONLY change to the file.
// ════════════════════════════════════════════════════════════════════════════
```

### Integration Points

```yaml
TESTS:
  - file: test/edge-cases.test.ts
    - block: the EXISTING `describe("E19 — Shrink target is a non-toolResult message (role preserved)")`
    - action: append the 2 (or 3) it() blocks above, INSIDE the describe, before its closing `});`
    - preserve: all 3 existing E19 it() blocks unchanged; all other edge-case blocks unchanged.
CONFIG:   none (pure-helper; no config, no runtime, no Pi). beforeEach/afterEach already reset module state.
BUILD:    none (no src change). `npm run typecheck` must still pass (the casts are already a proven pattern).
DOCS:     none (Mode A — test-only). The spec/08 E19 bullet already landed (commit d5701c8f); no spec edit.
```

---

## Validation Loop

### Level 1: Targeted test run (the PRIMARY gate)

```bash
# Run just the edge-cases file — fast feedback. The new E19 non-mutation tests must pass alongside the
# existing E19 tests. vitest filters by filename substring.
npx vitest run test/edge-cases.test.ts
# Expected: all green, including the new "does NOT mutate its input array",
#   "input array still holds the original content", and (if added) "every OTHER index's original intact".
```

### Level 2: Type safety (no new compile errors)

```bash
# tsc --noEmit across the project. The casts (`as Array<Record<string, unknown>>`) are already used by
# the existing E19 tests, so no new errors are expected.
npm run typecheck
# Expected: zero errors.
```

### Level 3: Full suite (no regressions)

```bash
# The whole vitest suite. Confirms the edit didn't disturb any other block (e.g. a malformed describe close).
npm test
# Expected: green. If a DIFFERENT test file starts failing with a parse/syntax error, the edit likely
# broke the describe/it nesting — re-read the file tail and fix the brace structure.
```

### Level 4: Structural sanity (cheap, catches a botched insertion)

```bash
# The new tests are inside E19 and the file still parses (balanced describe/it braces).
npx vitest run test/edge-cases.test.ts -t "E19"   # vitest -t filters by test-name substring
# Expected: exactly the E19 block's tests run (3 existing + 2/3 new), all green.

# Count `it(` inside E19 to confirm the insertion landed inside the block (not orphaned at EOF):
awk '/^describe\("E19/,/^});$/' test/edge-cases.test.ts | grep -c 'it('
# Expected: 5 (3 existing + 2 new) or 6 (if optional test (c) is included).
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx vitest run test/edge-cases.test.ts` green (new E19 non-mutation tests pass).
- [ ] `npm run typecheck` reports zero errors.
- [ ] `npm test` green (full suite — no regressions).
- [ ] Level 4 `-t "E19"` filter runs the new tests; `awk` count confirms they are INSIDE the E19 block.

### Feature Validation (contract acceptance)
- [ ] Test (a) asserts input byte-identity (`JSON.stringify(msgs) === JSON.stringify(snapshot)`) AND
      `out` is a new array (`expect(out).not.toBe(msgs)`).
- [ ] Test (b) asserts the input element is the raw user string (`msgs[0].content === "hello world"`)
      while the returned copy carries `stampShrink("X")` in its content-array's `[0].text`.
- [ ] Test (c) [if included] covers a 3-message input and asserts the whole input is byte-identical plus
      the non-matched indices' originals survive.
- [ ] All new tests use a MATCHING `by_content_includes` substring (so they exercise the NEW-array path,
      not E8's no-op SAME-reference path).
- [ ] No new imports added; no new describe created.

### Code Quality / Scope Validation
- [ ] ONLY `test/edge-cases.test.ts` is modified. No `src/*.ts`, no `spec/*.md`, no `README.md`,
      no `tasks.json`, no PRD snapshot.
- [ ] New tests match the existing E19 style (local builders, inline `as Array<Record<string, unknown>>`
      cast, terse `// comment` on load-bearing assertions).
- [ ] Content-type asymmetry handled (input string compared directly; output cast to array block).

### Documentation Validation
- [ ] None required (Mode A — test-only). The spec bullet already landed; README note is P4.M1.T1.S3.

---

## Anti-Patterns to Avoid

- ❌ Do NOT assert against a NO-MATCH target and then expect `out !== msgs` — applyShrink returns the SAME
  reference on no-op (that's E8's invariant). Always use a substring that IS present in a message.
- ❌ Do NOT compare `msgs[0].content` to an array or cast it — a `user()` message's content is a bare
  STRING. Cast ONLY the *returned* (`out[0]`) content.
- ❌ Do NOT add a new `describe(...)` block or an "E19b" — the new tests live INSIDE the existing E19 block.
- ❌ Do NOT add imports — `applyShrink`, `stampShrink`, `MessageLike`, `user`, `asstText` are all in scope.
- ❌ Do NOT "fix" `src/transforms.ts` to make a test pass. `applyShrink` is provably non-mutating; if a new
  test fails, the assertion is wrong (wrong content type or a no-match target), not the source.
- ❌ Do NOT edit any file other than `test/edge-cases.test.ts` (P3.M1.T1.S1 owns `README.md` in parallel;
  spec is done; source is done).
- ❌ Do NOT change the existing 3 E19 tests — only APPEND new ones before the block's closing `});`.

---

## Confidence Score: 9/10

This is a test-only task on a pure helper with an already-proven non-mutation mechanic. The exact file,
describe block, insertion anchor, local builders, assertion idiom (matching the existing E19 tests +
`drift_nudge.test.ts`'s non-mutation pattern), content-type gotcha, and validation commands are all pinned.
The only residual risk is a TypeScript cast nuance on the returned content array — already modeled by the
existing E19 tests, so the implementer can copy the exact cast. No design decisions, no external deps, no
Pi — one-pass success is highly likely.

---
~1 file edited (test/edge-cases.test.ts). ~2–3 new `it()` blocks inside the existing E19 describe. No build/dependency impact.