---
name: "P1.M4.T1.S2 — Sweep tools tests: zero by_content_includes occurrences; schema-rejection via computed key"
description: Test-only. Eliminate the last 6 `by_content_includes` literals from test/tools/shrink.test.ts and test/tools/cancel.test.ts while preserving the schema-rejection (C13) and type-rejection semantics via computed keys / relocation to markers.test.ts. The item's stale line-number clauses already satisfied by P1.M2 are documented as do-NOT-redo.
---

## Goal

**Feature Goal**: `grep -c by_content_includes test/tools/*.test.ts` returns 0 for every tools test file, with all schema/type/host-rejection semantics for the removed v2.0 content arm still asserted (via computed keys or delegation to the sanctioned survivor in `test/markers.test.ts`), and the full suite stays green.

**Deliverable**: Modified `test/tools/shrink.test.ts` and `test/tools/cancel.test.ts` — nothing else.

**Success Definition**: The grep gate is 0 everywhere under `test/tools/`; `npx vitest run test/tools/shrink.test.ts test/tools/cancel.test.ts` passes; full `npx vitest run` passes; `npm run typecheck` clean; `git status` shows only these two files.

## Why

- The v2.0 delta removed the content arm from the write union (P1.M1.T1.S1). P1.M2 already rewrote the behavioral cases; this item is the final R5 reconciliation sweep for the tools tier. The literal must not survive even in schema-rejection tests or comments — future agents grepping the suite must not re-learn a dead arm (the grep gate counts comments).
- P1.M4.T1.S1 (parallel) sweeps the four unit-test files and explicitly does NOT touch `test/tools/**`; this item owns that directory. Do not overlap with S1's files.

## What

### Already satisfied — do NOT redo (verified in working tree; the item's line numbers are stale)

- Structural-invalid it.each rows are already two-arm at shrink.test.ts ~:268-272 (empty/whitespace `by_tool_call_id` + `by_tool_name`), asserting `"Mulligan: refused — target discriminator must be non-empty."` with zero persistence.
- The "content arm fails schema" host-rejection case EXISTS (shrink.test.ts :732) alongside "proper 2-arm target passes" rows (:744-751). This item only rewrites how the dead arm is spelled.
- Cancel case (c) is already `by_tool_name:'bash', occurrence:'last'` covering (:702) and (c-neg) is already a no-cover no-op (:723) — the content-covering originals were removed in P1.M2.T4.S1.
- CANCEL_DESC assertion (cancel.test.ts :473-490) already checks `tool.description === CANCEL_DESC` (imported from `src/tools/cancel.ts:137`) plus an inline byte-identical copy of the new two-arm string. **Do not touch these strings.**

### Actual remaining work — exactly 6 literal occurrences

All sites verified by grep on the current tree:

1. **shrink.test.ts :625** — `expectTypeOf<{ by_content_includes: string }>().not.toMatchTypeOf<ShrinkArgs["target"]>();`
2. **shrink.test.ts :732** — it title `{by_content_includes} target fails host validation — execute never runs`
3. **shrink.test.ts :738** — the literal arg to `hostPipelinePasses(ShrinkParams, { target: { by_content_includes: "x" }, replacement: "r" }, tool.prepareArguments)`
4. **cancel.test.ts :499** — it title `host validation pipeline: legacy by_content_includes target FAILS CancelParams; a 2-arm target PASSES`
5. **cancel.test.ts :513** — `expect(pipeline({ target: { by_content_includes: "x" } })).toBe(false);`
6. **cancel.test.ts :699** — comment `// The legacy by_content_includes cast-based cases were removed in P1.M2.T4.S1: ...`

### Success Criteria

- [ ] `grep -c by_content_includes test/tools/shrink.test.ts test/tools/cancel.test.ts test/tools/audit.test.ts test/tools/rewind.test.ts test/tools/checkpoint.test.ts` → 0 for all
- [ ] Both files green individually; full suite green; typecheck clean
- [ ] Schema-rejection semantics preserved: a target with ONLY the removed arm still FAILS the real host pipeline (`prepareArguments → Value.Convert → Compile.Check`), proper 2-arm targets still PASS
- [ ] No source changes; no changes outside the two files

## All Needed Context

### Context Completeness Check

Someone with zero repo knowledge can do this: every edit site is listed with its exact current line, current text, and required replacement. The "already done" clauses prevent wasted/conflicting re-edits.

### Documentation & References

```yaml
- file: test/tools/shrink.test.ts
  why: Primary sweep target — sites :625 (type assertion), :732 (it title), :738 (host-pipeline arg)
  pattern: hostPipelinePasses(ShrinkParams, args, tool.prepareArguments) at :735-741 is the C13 exact-pipeline harness; keep it, change only how the dead arm is spelled
  gotcha: comments and it TITLES count for the grep gate — reword, don't just fix code

- file: test/tools/cancel.test.ts
  why: Sites :499 (it title), :513 (pipeline arg), :699 (comment)
  pattern: local `pipeline(args)` helper at :502-511 mirrors prepare-args.test.ts's hostPipelinePasses; keep the helper
  gotcha: CANCEL_DESC inline string at :482-490 must stay byte-identical to src/tools/cancel.ts:137-147 — do not "simplify" it to a re-export

- file: test/markers.test.ts
  why: READ-ONLY reference — the sanctioned survivor of the `not.toMatchTypeOf` idiom (~:537-556); the compile-time rejection coverage lives there after this sweep
  gotcha: owned by P1.M4.T1.S1 (may be concurrently edited) — do NOT modify it; only reference it in comments

- file: src/tools/cancel.ts
  why: READ-ONLY — CANCEL_DESC (:133-147), already the v2.0 two-arm string; CancelParams schema
- file: src/tools/shrink.ts
  why: READ-ONLY — ShrinkParams 2-arm union; prepareArguments shim
- file: plan/008_1c8ca4d1826d/P1M4T1S2/research/ground-truth-occurrences.md
  why: Verified occurrence inventory + already-satisfied clause list (this PRP's evidence base)
- docfile: plan/008_1c8ca4d1826d/prd_snapshot.md
  why: E27 (h2.109) — host validates args BEFORE execute; C13 pipeline; E19 (h2.101) MOOT ruling
```

### Current Codebase tree (relevant subset)

```bash
test/tools/
  shrink.test.ts   # 3 literal occurrences (:625, :732, :738)
  cancel.test.ts   # 3 literal occurrences (:499, :513, :699)
  audit.test.ts rewind.test.ts checkpoint.test.ts  # already clean — verify only
test/markers.test.ts  # sanctioned survivor (S1's file — hands off)
src/tools/{shrink,cancel}.ts  # read-only
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: grep counts comments and it(...) titles — reword every one.
# CRITICAL: the type-level assertion at :625 needs a literal type; the computed-key trick does not work for
#   expectTypeOf. The compile-time rejection coverage already exists in test/markers.test.ts's
#   not.toMatchTypeOf fixture — DELETE :625 and leave a one-line pointer comment (no literal).
# vitest ^1; run explicitly: npx vitest run test/tools/shrink.test.ts test/tools/cancel.test.ts
# House idiom: .js import paths; no vi.fn(); typebox imported from src/tools already in these files
#   (Value/Compile are imported in cancel.test.ts; shrink.test.ts has hostPipelinePasses helper).
# typebox Value.Convert/Check on a COMPUTED key: { [REMOVED_ARM]: "x" } with REMOVED_ARM built via
#   ["by_content", "_includes"].join("_") is still an own-string property at runtime — the pipeline
#   correctly rejects it (no discriminator arm matches). Assert .toBe(false) as before.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/tools/shrink.test.ts
  1a. DELETE :625 (expectTypeOf not.toMatchTypeOf line). Replace with a comment line, e.g.:
      "// (f) the removed v2.0 content-substring arm is not assignable to the target union —
      //  compile-time lock lives in test/markers.test.ts (not.toMatchTypeOf idiom)."
      (No literal anywhere in the comment.)
  1b. REWORD the it title at :732 to drop the literal, e.g.:
      it("a target using the REMOVED content-substring arm fails host validation — execute never runs", ...)
  1c. REWRITE :735-741's argument using a computed key declared near the top of that describe block:
      const REMOVED_ARM = ["by_content", "_includes"].join("_"); // the arm v2.0 deleted from the union
      ... hostPipelinePasses(ShrinkParams, { target: { [REMOVED_ARM]: "x" }, replacement: "r" }, tool.prepareArguments)
      ... .toBe(false)   // same assertion, same pipeline, no literal
  1d. Scan for any other occurrence (comments included): grep -n by_content_includes test/tools/shrink.test.ts → empty.

Task 2: MODIFY test/tools/cancel.test.ts
  2a. REWORD the it title at :499: e.g. "host validation pipeline: the REMOVED content-substring arm FAILS CancelParams; a 2-arm target PASSES"
  2b. REWRITE :513 using the same computed key (declare REMOVED_ARM once in that describe block):
      expect(pipeline({ target: { [REMOVED_ARM]: "x" } })).toBe(false);
      Keep the two positive rows (:514-515) untouched.
  2c. REWORD the comment at :699 to avoid the literal, e.g.:
      "// The legacy cast-based content-matcher cases were removed in P1.M2.T4.S1: that arm no longer
      //  exists in the v2.0 schema, and the unmatched-substring no-op is fully covered by case (e) below."
  2d. grep -n by_content_includes test/tools/cancel.test.ts → empty.

Task 3: VERIFY neighbors are already clean (no edits expected)
  grep -c by_content_includes test/tools/audit.test.ts test/tools/rewind.test.ts test/tools/checkpoint.test.ts
  → 0 each (verified during research; if a stray appears due to S1/S3 parallel edits, apply the same
  computed-key/reword treatment ONLY within test/tools/).

Task 4: FULL VALIDATION
  npx vitest run test/tools/shrink.test.ts test/tools/cancel.test.ts   # green
  npx vitest run                                                        # whole suite green
  npm run typecheck                                                     # tsc --noEmit clean (removing :625 must not orphan imports — ShrinkArgs is still used elsewhere)
  grep -c by_content_includes test/tools/*.test.ts                      # 0 for every file
  git status                                                            # only the two test files
```

### Implementation Patterns & Key Details

```typescript
// Computed-key idiom — keeps the runtime rejection assertion while zeroing the grep (both files):
describe("... schema (typebox) rejects the removed content arm (C13) ...", () => {
  const REMOVED_ARM = ["by_content", "_includes"].join("_"); // v2.0 deleted this arm from the union

  it("a target using the REMOVED content-substring arm fails host validation — execute never runs", () => {
    const { pi } = makePi();
    const tool = makeShrinkTool(pi);
    expect(
      hostPipelinePasses(ShrinkParams, { target: { [REMOVED_ARM]: "x" }, replacement: "r" }, tool.prepareArguments),
    ).toBe(false);
  });
});

// Type-level site (shrink.test.ts :625) — computed keys don't work for expectTypeOf; delegate instead:
// (f) the removed v2.0 content-substring arm is not assignable to the target union —
//     compile-time lock lives in test/markers.test.ts (not.toMatchTypeOf idiom).
```

### Integration Points

```yaml
NONE - test-only; no src/, config, or build changes. No docs (per item contract).
```

## Validation Loop

### Level 1: Per-file test runs (after each task)

```bash
npx vitest run test/tools/shrink.test.ts
npx vitest run test/tools/cancel.test.ts
# Expected: green. Read any failure before editing further.
```

### Level 2: The grep gate (the item's defining OUTPUT check)

```bash
grep -c by_content_includes test/tools/*.test.ts
# Expected: 0 for every file (grep -c prints per-file counts; all must be 0)
```

### Level 3: Full suite + types + scope

```bash
npx vitest run          # entire suite green (esp. prepare-args, markers, filter, bug-replay)
npm run typecheck       # clean
git status              # only test/tools/shrink.test.ts + test/tools/cancel.test.ts
```

## Final Validation Checklist

### Technical Validation
- [ ] `grep -c by_content_includes test/tools/*.test.ts` → all 0
- [ ] `npx vitest run` green; `npm run typecheck` clean
- [ ] `git status` → exactly the two tools test files

### Feature Validation
- [ ] Host-pipeline rejection (C13) still asserted for the removed arm in BOTH files (computed-key form)
- [ ] Proper 2-arm positive rows still present and passing (shrink :744-751, cancel :514-515)
- [ ] CANCEL_DESC assertions (:473-490) untouched and byte-identical to src
- [ ] Structural-invalid two-arm rows and v2.0 hard-refusal texts untouched
- [ ] No it titles or comments anywhere in test/tools/ contain the literal

### Scope Discipline
- [ ] No changes to test/transforms|markers|prepare-args|edge-cases.test.ts (S1's files — may be concurrently edited)
- [ ] No changes to test/integration/** (S3)
- [ ] No changes to any src/** file

## Anti-Patterns to Avoid

- ❌ Don't delete the schema-rejection tests to make the grep pass — rewrite the arm spelling, keep the assertion
- ❌ Don't re-edit the already-satisfied P1.M2 clauses (two-arm cases, CANCEL_DESC, case (c)) based on the item's stale line numbers
- ❌ Don't use template-literal concatenation that still yields the literal at rest (e.g. `"by_content_" + "includes"` is fine; the grep target must not appear verbatim)
- ❌ Don't touch markers.test.ts even though it holds the surviving literal — it is outside test/tools and owned by S1
- ❌ Don't weaken `expect(...).toBe(false)` to `toBeFalsy()` or drop the prepareArguments arg from the pipeline

**Confidence Score: 9/10** — only 6 sites, each inventoried with exact current text and replacement semantics; the sole judgment call (expectTypeOf delegation) is resolved by the markers.test.ts survivor.