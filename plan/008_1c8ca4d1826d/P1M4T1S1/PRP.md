---
name: "P1.M4.T1.S1 — Sweep transforms/markers/prepare-args/edge-cases tests + rewrite the E19 unit block"
description: Eliminate every by_content_includes usage from four unit-test files (keeping only the deliberate LEGACY-READ fixture in markers.test.ts), rewrite the E19 block as legacy no-op / immutability-on-toolResult tests, and fix the ×3→×2 arm-count language. Test-only; no source changes.
---

## Goal

**Feature Goal**: The four unit-test files contain zero `by_content_includes` occurrences except the deliberate LEGACY-READ type fixture in `test/markers.test.ts`, with all affected test semantics re-expressed against the v2.0 two-arm target union, and the E19 block rewritten per PRD E19 ("no longer expressible / legacy marker no-ops").

**Deliverable**: Modified `test/transforms.test.ts`, `test/markers.test.ts` (naming/comment polish only if needed), `test/prepare-args.test.ts`, `test/edge-cases.test.ts` — all green under `npx vitest run`.

**Success Definition**: `grep -rn by_content_includes test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts` matches ONLY lines inside markers.test.ts; the four files pass `npx vitest run test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts`; `npm run typecheck` (tsc --noEmit) still clean.

## Why

- The v2.0 delta (P1.M1/P1.M2) removed the content arm from the write union; the test suite still carries ~23 `by_content_includes` literals whose assertions are now either redundant (covered by P1.M1.T3.S1's span-semantics lock and markers.test.ts's type fixture) or mis-document the system. This sweep is R5 of the reconciliation: the tests must tell the v2.0 truth so future agents don't re-learn the dead arm.
- P1.M4.T1.S2 (tools tests) and P1.M4.T1.S3 (integration smoke) are separate items — do NOT touch `test/tools/**` or `test/integration/**`.

## What

1. `test/transforms.test.ts` — remove/retarget all `by_content_includes` usages (see Task 1 for per-site dispositions, including the comment at :2424 and describe block (d) at :2473).
2. `test/markers.test.ts` — KEEP the legacy-read fixture (it is the sanctioned survivor); confirm no "3-arm" naming remains (already true in the working tree).
3. `test/prepare-args.test.ts` — replace the legacy it.each row with a two-arm JSON-string fixture; update the "×3" comment at :11 to ×2.
4. `test/edge-cases.test.ts` — rewrite the E19 describe block (at :992) per PRD E19 v2.0: user/assistant shrink cases → legacy-marker no-op through filterPipeline; immutability invariants re-targeted at toolResult fixtures.

### Success Criteria

- [ ] Grep gate passes (markers.test.ts-only matches).
- [ ] All four files green; full `npx vitest run` green (no collateral breakage).
- [ ] No behavioral/source files changed (`git status` shows only the four test files).
- [ ] E27 regression language reads "both/×2 anyOf arms" everywhere arm counts are mentioned.

## All Needed Context

### Context Completeness Check

Someone with zero knowledge of this repo can do this from the PRP alone: every edit site is listed with its current line number, current assertion text, and its required replacement semantics.

### Documentation & References

```yaml
- file: test/transforms.test.ts
  why: Primary sweep target — 13 in-code occurrences + comment at :2424 + describe block (d) at :2473-2481
  pattern: v2.0 no-op expectations already written (same-ref toBe(msgs)); this sweep REMOVES the legacy literal, keeping semantics via two-arm targets
- file: test/markers.test.ts
  why: The LEGACY-READ fixture that SURVIVES (lines ~537-556); read it before editing to know the sanctioned pattern
  pattern: "ShrinkTarget is the 2-arm write union; ShrinkTargetRead adds the legacy arm" — expectTypeOf equality assertions
- file: test/prepare-args.test.ts
  why: it.each row at :153 + header comment "×3" at :11; ShrinkParams import from src/tools/shrink.js
- file: test/edge-cases.test.ts
  why: E19 describe block at :992 through ~:1075 (7 occurrences)
- file: src/transforms.ts
  why: READ-ONLY reference — ShrinkTarget (2-arm write, :771-782), ShrinkTargetRead (adds legacy arm, :782-793), resolver legacy fall-through-to-null (:875)
  gotcha: do NOT modify src/ — this item is test-only
- file: architecture/_scouts/tests.md
  why: §1 harness conventions (vitest, no vi.fn(), .js imports, factories), §2 full occurrence inventory
- docfile: plan/008_1c8ca4d1826d/prd_snapshot.md
  why: E19 (h2.101 "MOOT" ruling), E27 (h2.109 two-arm acceptance), §1.5 applyShrink unit-test contract (h2.117/h3.62)
```

### Current Codebase tree (test/ only, relevant subset)

```bash
test/
  transforms.test.ts      # sweep target (largest)
  markers.test.ts         # keeps the legacy-read fixture
  prepare-args.test.ts    # 1 row + 1 comment
  edge-cases.test.ts      # E19 block rewrite
  tools/                  # NOT yours (P1.M4.T1.S2)
  integration/            # NOT yours (P1.M4.T1.S3)
src/transforms.ts         # read-only reference
src/markers.ts            # read-only reference (ShrinkTargetRead)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: comments count for the grep gate — comment lines mentioning by_content_includes
#   (transforms.test.ts :2424, :1072 test title, :1079 test title) must be reworded too.
# CRITICAL: markers.test.ts is the ONLY sanctioned survivor; do not "clean" it.
# vitest ^1; run files explicitly: npx vitest run test/<file> ...
# House idiom: no vi.fn() in these four files; .js import paths; filterPipeline/applyShrink are pure (no clearAll() needed).
# ShrinkTargetRead-typed fixtures still type-check with the legacy arm — use them ONLY in markers.test.ts after this sweep.
# stampShrink() wraps replacements at RENDER time; assertions compare textOf(...) === stampShrink("X").
# tsc --noEmit (npm run typecheck) covers tests — deleting block (d) must also drop the now-unused ShrinkTargetRead import in transforms.test.ts if nothing else uses it (check: :2 import list, :2460 uses `as ShrinkTargetRead` casts which STAY — only the legacy-arm literal usage goes).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/transforms.test.ts — remove all by_content_includes usages
  Dispositions per site (current line numbers; verify by grep before editing):
  - :1037 (inside "no match → input UNCHANGED" it): DELETE the by_content_includes expect line;
    the two preceding two-arm expects (by_tool_call_id "nope", by_tool_name "absent") already cover the no-op contract.
  - :1072-1079 (two legacy no-op its: "by_content_includes → legacy content target resolves null" and
    "spec/08 E19 (legacy) — ... NO-OP"): DELETE both its entirely — their semantics are locked by markers.test.ts's
    legacy-read fixture + the resolver fall-through; keeping them violates the grep gate.
  - :1095-:1096 (resolver direct nulls): DELETE both expect lines (covered by block (d) move, Task 1b).
  - :1119-:1128 (E13 throwing-Proxy + BUG-004 empty-needle): RETARGET to the two-arm union, same defensive shape:
    * `resolveShrinkTarget([trap], { by_tool_call_id: "" })` → null, not-throw
    * `applyShrink(msgs1, { target: { by_tool_call_id: "nope" }, replacement: "r" })` → not-throw (trap present, unmatched)
    * empty-string id → no-op same-ref on trapArr: `applyShrink(trapArr, { target: { by_tool_call_id: "" }, replacement: "r" })` → toBe(trapArr)
    Keep the throwing-Proxy construction and comment intent; reword comments to drop the legacy literal.
  - :2424 comment: reword to "legacy content-arm targets resolve to null ALWAYS" (no literal).
  - :2473-2481 describe block (d) "(d) legacy by_content_includes (typed via ShrinkTargetRead) → null ALWAYS":
    MOVE this semantic into test/markers.test.ts (Task 2) as a small resolver-null companion test using ShrinkTargetRead-typed
    fixtures; DELETE block (d) from transforms.test.ts. Keep blocks (a)-(c) untouched.
  After edits: `npx vitest run test/transforms.test.ts` → green; `grep -n by_content_includes test/transforms.test.ts` → empty.

Task 2: MODIFY test/markers.test.ts — keep + extend the legacy-read fixture
  - KEEP the existing "ShrinkTarget is the 2-arm write union; ShrinkTargetRead adds the legacy arm" test
    (~:537-556) byte-for-byte (title already v2.0; no "3-arm" text remains — verify with
    `grep -n "3-arm" test/markers.test.ts` → empty; if found, rename to "2-arm write union / legacy read arm").
  - ADD (relocated from transforms block (d)) a test in the same describe area:
    "legacy read-arm target resolves to null ALWAYS (resolver ignores the deprecated arm)":
    import resolveShrinkTarget from ../src/transforms.js; build a small MessageLike[] with user/asst/result factories
    (or inline literals — markers.test.ts has no message factories, inline records are fine);
    assert resolveShrinkTarget(msgs, { by_content_includes: "read" } as ShrinkTargetRead) → null,
    with and without a { start, end } span (mirror deleted block (d)'s three fixture variants).
  - This file is the grep-gate survivor: matches here are EXPECTED.

Task 3: MODIFY test/prepare-args.test.ts — two-arm fixture + comment fix
  - :153 it.each row `['{"by_content_includes": "pclntab"}', false]` → REPLACE with
    `['{"by_tool_call_id": "call_x"}', true]` (a JSON-string two-arm target that the shim coerces and host accepts).
    Optionally also add `['{"by_tool_name": "bash", "occurrence": "last"}', true]` — but note rows :150-151 already
    cover both by_tool_name / by_tool_call_id string forms; check first and only ensure BOTH arms appear exactly once
    as JSON-string rows.
  - :11 header comment: `("must be object" ×3)` → `("must be object" ×2)`; scan the whole header (:1-:25) for any other
    "three"/"×3"/"3 arm" language and align to the two-arm reality (the comment at ~:150 referencing "the content arm
    was removed" may stay but must not contain the literal).
  - Verify: `npx vitest run test/prepare-args.test.ts` green; grep → empty.

Task 4: MODIFY test/edge-cases.test.ts — rewrite the E19 describe block (:992-~:1075)
  Rename the describe to: `E19 — Shrink of a non-toolResult message is NO LONGER EXPRESSIBLE (v2.0; legacy markers no-op)`.
  Rewrite its seven tests as:
  a) "a user/assistant message can no longer be addressed by ANY write arm" — construct
     [user("hello world"), asstText("note here")] and assert `resolveShrinkTarget(msgs, { by_tool_call_id: "hello" })`
     and `resolveShrinkTarget(msgs, { by_tool_name: "hello", occurrence: "last" })` both → null (arms only match
     toolResults); do NOT use applyShrink with the legacy arm.
  b) "a persisted LEGACY marker passed through filterPipeline applies NOTHING" —
     a legacy v1.x marker is semantically 'a target matching no write arm' (resolver → null → no-op, PRD E8/E19).
     Express it WITHOUT the literal (this file must grep clean):
     MarkerBundle.shrinks: [{ seq: 1, target: {} as ShrinkTarget, replacement: "SUMMARY" }]
     with comment "legacy content-arm markers resolve like any unmatched target → null → no-op (PRD E8/E19)".
     Run it over [user("hello"), asst("c1"), result("c1"), asstText("note here")]; assert the output contains NO
     stampShrink("SUMMARY") text anywhere (find + toBeUndefined, mirroring the current :1022-1024 assertion) AND
     expectPairingInvariant(out, partitionIntoUnits(out)) still holds. The literal-based lock of this semantics
     lives in markers.test.ts (Task 2's ShrinkTargetRead fixture + resolver-null test).
  c) "filterPipeline pairing is unaffected when a shrink no-ops" — reuse the current :1013 test but with the
     unmatched-target marker from (b); keep expectPairingInvariant + the no-stamp find assertion.
  d) Immutability invariants RE-TARGETED at toolResult fixtures (keep the hard invariants, change the subject):
     - (a-analog) applyShrink with a MATCHING by_tool_call_id on a toolResult returns a NEW array; deep-snapshot
       the input (JSON.parse(JSON.stringify)) and assert byte-identical after the call (the original survives —
       the E19 "original never lost" invariant, now on the only expressible target kind).
     - (b-analog) the INPUT element still holds the raw content; only the RETURNED copy carries stampShrink(replacement)
       (compare textOf(out[i]) === stampShrink("X") vs msgs[i] raw).
     - (c-analog) multi-message [user, asst, BIG result, user]: matched index replaced in output; every index's INPUT
       original survives byte-identical; non-matched indices pass through by ref (out[0] toBe msgs[0]).
     Use the existing factories (user/asst/result/toolResult, textOf, stampShrink already imported in this file).
  e) DELETE the old user/assistant-message shrink its (:992-:1010 originals) — superseded by (a).
  Verify: `npx vitest run test/edge-cases.test.ts` green; grep → empty.

Task 5: FULL VALIDATION
  - npx vitest run            # whole suite — no collateral damage (bug-replay, filter, tools tests untouched)
  - npm run typecheck         # tsc --noEmit — dropping block (d) may orphan the ShrinkTargetRead import in transforms.test.ts; fix the import list at :2 if tsc flags it (note: :2460 `as ShrinkTargetRead` casts REMAIN, so the import likely stays used)
  - grep -rn by_content_includes test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts
    → matches ONLY in test/markers.test.ts
  - git status → only the four test files modified
```

### Implementation Patterns & Key Details

```typescript
// No-op assertion idiom (house pattern — same-reference):
expect(applyShrink(msgs, { target: { by_tool_call_id: "nope" }, replacement: "x" })).toBe(msgs);

// Legacy-marker no-op through filterPipeline WITHOUT the literal (E19 v2.0):
const markers: MarkerBundle = {
  rewinds: [],
  shrinks: [{ seq: 1, target: {} as ShrinkTarget, replacement: "SUMMARY" }], // legacy/unmatched arm → resolver null → no-op (PRD E8/E19)
};
const out = filterPipeline(msgs, markers, cfg);
expect(out.find((m) => JSON.stringify(m.content)?.includes(stampShrink("SUMMARY")))).toBeUndefined();
expectPairingInvariant(out, partitionIntoUnits(out));

// Immutability on toolResult (the only expressible shrink target in v2.0):
const bloated = { ...result("c"), content: [{ type: "text", text: "BIG" }] };
const msgs = [user("u"), asst("c"), bloated];
const snap = JSON.parse(JSON.stringify(msgs));
const out = applyShrink(msgs, { target: { by_tool_call_id: "c" }, replacement: "X" });
expect(JSON.stringify(msgs)).toBe(JSON.stringify(snap));   // input never mutated
expect(textOf(out[2])).toBe(stampShrink("X"));             // only the returned copy is stamped
```

## Validation Loop

### Level 1: Per-file test runs (after each task)

```bash
npx vitest run test/transforms.test.ts
npx vitest run test/markers.test.ts
npx vitest run test/prepare-args.test.ts
npx vitest run test/edge-cases.test.ts
# Expected: all pass. Read failures before editing further.
```

### Level 2: The grep gate (the item's defining check)

```bash
grep -rn by_content_includes test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts
# Expected: hits ONLY on lines in test/markers.test.ts (the legacy-read fixture + relocated resolver-null test).
# Comments count. Any hit in the other three files = incomplete sweep.
```

### Level 3: Full suite + types

```bash
npx vitest run        # entire suite green (esp. filter.test.ts, bug-replay-repro.test.ts, test/tools/**)
npm run typecheck     # tsc --noEmit clean
git status            # only the four test files modified
```

## Final Validation Checklist

### Technical Validation
- [ ] All four files pass individually; full `npx vitest run` green
- [ ] `npm run typecheck` clean
- [ ] Grep gate: by_content_includes only in markers.test.ts
- [ ] `git status` shows exactly the four test files (no src/, no test/tools/, no test/integration/)

### Feature Validation
- [ ] E19 block renamed + rewritten: no "user/assistant shrink" positive cases remain; no-op + immutability-on-toolResult cases present
- [ ] prepare-args: both anyOf arms covered as JSON-string rows; "×2" language in comments
- [ ] markers.test.ts: legacy-read fixture intact (untouched) + relocated legacy-resolver-null test added
- [ ] transforms.test.ts: E13/BUG-004 defensive tests retargeted to empty/unmatched two-arm targets, still exercising the throwing-Proxy

### Scope Discipline
- [ ] No changes to `test/tools/shrink.test.ts` / `cancel.test.ts` (P1.M4.T1.S2)
- [ ] No changes to `test/integration/**` (P1.M4.T1.S3)
- [ ] No changes to any `src/**` file

## Anti-Patterns to Avoid

- ❌ Don't "fix" markers.test.ts's legacy fixture — it is the deliberate survivor
- ❌ Don't delete the throwing-Proxy defensive tests — retarget them, keep the trap fixtures
- ❌ Don't leave the literal in comments — the grep gate counts comments
- ❌ Don't touch src/ or other test files outside the four named ones
- ❌ Don't weaken assertions to make greps pass (e.g. dropping the no-stamp filterPipeline check)

**Confidence Score: 8/10** — every edit site is inventoried with line numbers and replacement semantics; the only judgment call is expressing the legacy-marker no-op without the literal (resolved in Task 4b via the unmatched/empty-target marker approximation, faithful to PRD E8/E19 semantics).