# PRP — P1.M2.T2.S1: shrink v2.0 test lock (refusals, pin, advisory path, schema rejection)

## Goal

**Feature Goal**: Lock the v2.0 `mulligan_shrink` contract (implemented by P1.M2.T1.S1/S2, assume landed) behind tests: earlier-turn targets and no-in-turn matches are HARD REFUSALS with exact text and zero persistence; in-span matches succeed with `pinnedEntryId`; the advisory-throw path persists with the `~0` orientation line; the `by_content_includes` arm is now dead at the SCHEMA level (host validation, not execute); `ShrinkArgs.target` is a 2-arm union.

**Deliverable**: Edited `test/tools/shrink.test.ts` only — new `it.each`/`it` cases for (a)–(f) below, the content-arm rows removed/replaced from the structural-invalid table and the E8/orientation blocks, plus a typebox host-pipeline rejection test reusing the `hostPipelinePasses` harness pattern from `test/prepare-args.test.ts`. No production-code changes.

**Success Definition**: `npx vitest run test/tools/shrink.test.ts` green; `npm test` + `npm run typecheck` green; every existing E14/empty-replacement/structural-discriminator/payload-exactness/type test still green (aligned, not deleted).

## Why

P1.M2.T1 ships the v2.0 execute path (span-bounded match-now, hard refusals) but its PRP only *minimally aligns* existing tests. Without this lock, a future refactor could silently re-admit earlier-turn pinning (the `Matched: yes` lie) or resurrect the content arm, and nothing would fail. R5 moves structural content-arm rejection from execute-time to schema-time (C13), so the old `it.each` rows are now testing dead code paths.

## What

Add/replace tests in `test/tools/shrink.test.ts`:

- **(a) Earlier-turn refusal**: `by_tool_call_id` that resolves ONLY before the last user message → `firstText(res)` EXACTLY `'Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.'` and `appended.length === 0` and `res.details` equals `{}`.
- **(b) No in-turn match refusal**: well-formed `by_tool_name` with an in-earlier-turn-only match, AND a no-match-anywhere variant → same exact refusal text, `appended.length === 0`.
- **(c) In-span success + pin**: `by_tool_call_id` matching a toolResult AFTER the last user message → `'Mulligan: shrink recorded. Matched: yes.\n' + shrinkOrientationLine(1, <t>)` (compute `<t>` via `estimateTokens` on the original, same as the existing orientation test at ~:740) and `appended[0].data.pinnedEntryId === <matched entry id>`.
- **(d) Advisory orientation path**: `makeCtx({throwOnBuildContextEntries: true})` → persists (`appended.length === 1`), text contains `Matched: no`, ends with `shrinkOrientationLine(1, 0)` — the v1.2 `~0` line, unchanged.
- **(e) Schema rejection of the content arm**: `{by_content_includes: 'x'}` as target FAILS host validation via `hostPipelinePasses(ShrinkParams, args, tool.prepareArguments) === false` — execute never runs. Also assert proper 2-arm objects PASS. The two `by_content_includes` rows (~:253-254) MOVE OUT of the structural-invalid `it.each` (that table keeps only execute-level discriminator rows for the 2 live arms).
- **(f) Type test**: `expectTypeOf<ShrinkArgs["target"]>()` union has exactly the 2 arms (`{by_tool_call_id: string}` | `{by_tool_name: string, occurrence: "first"|"last"}`) — replace the 3-arm assertion at ~:620-624. Assert the content arm is NOT assignable.

Additionally: snapshot the shrink entry payload via `appended[0]` in the (c) case (`customType`, `data` envelope `{schema, v, kind, id, seq, ts}` plus `{target, replacement, reason?, pinnedEntryId}`) — follow the existing payload-exactness describe block (~:340-400).

### Success Criteria

- [ ] (a)-(f) all present and green, with the exact strings above.
- [ ] `appended.length === 0` asserted on every refusal case (a)/(b).
- [ ] `pinnedEntryId` asserted equal to the matched entry's `id` in (c).
- [ ] Content arm fails `hostPipelinePasses` with the tool's real `prepareArguments`; proper objects pass.
- [ ] No `by_content_includes` execute-level row remains in the structural-invalid table.
- [ ] `npm test`, `npm run typecheck` green.

## All Needed Context

### Documentation & References

```yaml
- file: test/tools/shrink.test.ts
  why: THE file being edited. Harness: makePi({throwOnAppend})/makeCtx({contextEntries, throwOnBuildContextEntries, hasUI})/run() at :55-116; msgEntry/toolResult fixtures ~:150-170 (entry ids e-1, e-2...); firstText ~:130; clearAll() before+after each ~:44-46
  pattern: it.each tables for multi-row cases; hand-rolled fakes, NO vi.fn(); .js import paths
  gotcha: structural-invalid table :248-264 — DELETE the two by_content_includes rows only (the execute-level discriminator rows for by_tool_call_id/by_tool_name STAY); pinning block :385-392 — the by_content_includes sub-block goes; E8 test :459-468 and orientation test :750-756 use the content arm — rewrite them per (b)/(d); type test :620-624 — shrink to 2 arms

- file: test/prepare-args.test.ts
  why: the hostPipelinePasses harness to reuse/extend (:42-54): structuredClone → prepareArguments → Value.Convert → Compile(params).Check
  pattern: import { Compile } from "typebox/compile" (check the file's exact Value import and mirror it); pass tool.prepareArguments so the shim runs
  gotcha: prepareObjectArgs only coerces STRING values — an already-object {by_content_includes:'x'} passes through untouched, so Check sees it and rejects; execute never runs (C13)

- file: src/tools/shrink.ts
  why: the contract under test (P1.M2.T1.S1/S2 output): refusal() prefix "Mulligan: refused — " + trailing "."; hard refusal reason `that result is from a previous turn; only this turn's tool calls can be shrunk`; shrinkOrientationLine(k, t); 2-arm ShrinkParams; details === {} on refusals
  gotcha: import shrinkOrientationLine + ShrinkParams + SHRINK_DESC + ShrinkArgs/ShrinkDetails — the test file already does this; do not modify shrink.ts

- file: src/transforms.ts
  why: currentTurnSpan (:379 — span = after last role:"user"; no user msg → start 0) and resolveShrinkTarget (:827, 3-arg). Needed to build correct in-span vs earlier-turn fixtures

- file: src/tokens.ts
  why: estimateTokens — compute the expected ~<t> in case (c) with the SAME estimator the tool uses (existing orientation test precedent ~:735)

- file: plan/008_1c8ca4d1826d/prd_snapshot.md
  why: PRD h2.117 §1.12 (orientation line verbatim, ~0 on matched:no), E8 (persist no-op markers), E13 (never throw), E27/C13 (host validates before execute; string→object shim). h2.58 shrink behavior

- file: plan/008_1c8ca4d1826d/architecture/_scouts/tests.md
  why: §§1-2 — harness conventions + the full inventory of by_content_includes test occurrences (this item owns the test/tools/shrink.test.ts slice only; smoke is P1.M4.T1.S3, other files P1.M4.T1.S1/S2)

- file: plan/008_1c8ca4d1826d/P1M2T1S2/PRP.md
  why: CONTRACT for the execute path under test — exact refusal text, resolveTargetEntryId {entryId, origTokens, index?} semantics, advisory-throw → persist matched:false
```

### Current Codebase tree (relevant)

```bash
test/tools/shrink.test.ts   # EDIT — all work here
test/prepare-args.test.ts   # READ — hostPipelinePasses pattern to copy
src/tools/shrink.ts         # READ (frozen contract from P1.M2.T1)
src/transforms.ts           # READ — currentTurnSpan semantics for fixtures
src/tokens.ts               # READ — estimateTokens for ~<t>
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: refusal text is byte-exact: 'Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.' (em-dash, trailing period).
// CRITICAL: clearAll() before+after EVERY test (shared nextSeq map — GOTCHA #8) — already wired via top-level beforeEach/afterEach; new describes inherit it.
// CRITICAL: to place a toolResult in an EARLIER turn it must sit BEFORE a later role:"user" entry:
//   [msgEntry("user",{content:"u0"}), msgEntry("toolResult", toolResult("call-A","read","big")), msgEntry("user",{content:"u1"})] + target call-A.
//   With NO user entry at all, currentTurnSpan start=0 → the match IS in-span (succeeds) — do not accidentally build that fixture for (a)/(b).
// GOTCHA: setConfig MERGES — each describe sets its own beforeEach config (existing pattern); keep {shrink:{enabled:true}} for all new cases.
// GOTCHA: prepare-args shim: hostPipelinePasses must receive tool.prepareArguments (from makeShrinkTool(pi).prepareArguments) — the object content arm passes the shim untouched and dies in Check.
// GOTCHA: `by_content_includes` values in (e) must be cast `as unknown as ShrinkArgs["target"]` where TS complains — the union no longer has that arm.
// GOTCHA: expectTypeOf union-arm counting: assert each of the 2 arms IS in the union and that {by_content_includes: string} is NOT assignable to ShrinkArgs["target"].
// GOTCHA: .js import extensions (ESM) for all src imports; vitest only, no node:test.
```

## Implementation Blueprint

### Task 1: ADD `hostPipelinePasses` helper + imports (top of test/tools/shrink.test.ts)

Copy the ~10-line helper from `test/prepare-args.test.ts:42-54` verbatim (plus its `Compile`/`Value` typebox imports). It lives module-private; do not export.

### Task 2: REWORK the structural-invalid table (:248-264)

Delete the two `by_content_includes` rows. Keep the 4 remaining rows (by_tool_call_id empty/whitespace, by_tool_name empty/whitespace) — execute-level discriminator validation still exists for the 2 live arms.

### Task 3: ADD describe "mulligan_shrink — v2.0 current-turn scoping (R2 lock)"

Cases (a)–(d) using the existing fixtures:

```ts
// (a) earlier-turn match
const { appended, pi } = makePi();
const e = msgEntry("toolResult", toolResult("call-A", "read", "big output"));
const u0 = msgEntry("user", { content: "u0" });
const u1 = msgEntry("user", { content: "u1" });
const { ctx } = makeCtx({ contextEntries: [u0, e, u1] });
const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "s" });
expect(firstText(res)).toBe("Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.");
expect(appended).toHaveLength(0);
expect(res.details).toEqual({});
```

(b) two variants via `it.each` or two `it`s: `by_tool_name:"read", occurrence:"last"` where the only `read` result is before the last user message (same fixture shape as (a)); and a no-match-anywhere case (`by_tool_call_name`/`call-ZZZ` id not in any entry) — both same exact refusal + `appended.length === 0`.

(c) in-span: `[u0, e]` (e AFTER the user) + `by_tool_call_id:"call-A"` →
`expect(firstText(res)).toBe(\`Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, expectedT)}\`)` where `expectedT` derives from `estimateTokens` on the original toolResult text (mirror the existing ~:735 orientation test's computation); `expect((appended[0].data as any).pinnedEntryId).toBe((e as {id:string}).id)`. Also snapshot-check the envelope: `customType` matches the shrink marker custom type used by `appendShrinkMarker` (see existing payload-exactness block ~:340-400 — reuse its envelope assertions).

(d) `makeCtx({ throwOnBuildContextEntries: true })` → `appended.length === 1`, text contains `Matched: no`, full equality with `` `Mulligan: shrink recorded. Matched: no.\n${shrinkOrientationLine(1, 0)}` ``. (This REPLACES the ~:750-756 content-arm test.)

### Task 4: REWRITE the E8 block (:459-468)

The old "no-match → matched:no + STILL persists" content-arm test becomes a v2.0 no-in-span-match case → covered by Task 3(b). If a persisted-unmatched path is still reachable in v2.0 ONLY via the advisory throw, that's Task 3(d); delete the redundant content-arm test.

### Task 5: ADD schema-rejection describe (case e)

```ts
describe("mulligan_shrink — schema (typebox) rejects the removed content arm (C13)", () => {
  it("{by_content_includes} target fails host validation — execute never runs", () => {
    const tool = makeShrinkTool(makePi().pi);
    expect(hostPipelinePasses(ShrinkParams, { target: { by_content_includes: "x" }, replacement: "r" }, tool.prepareArguments)).toBe(false);
  });
  it.each([
    { by_tool_call_id: "call-A" },
    { by_tool_name: "read", occurrence: "last" },
  ])("proper 2-arm target %o passes host validation", (target) => {
    const tool = makeShrinkTool(makePi().pi);
    expect(hostPipelinePasses(ShrinkParams, { target, replacement: "r" }, tool.prepareArguments)).toBe(true);
  });
});
```

### Task 6: FIX the type test (:620-624)

```ts
expectTypeOf<ShrinkArgs["target"]>().toEqualTypeOf<
  { by_tool_call_id: string } | { by_tool_name: string; occurrence: "first" | "last" }
>();
// content arm no longer assignable:
expectTypeOf<{ by_content_includes: string }>().not.toExtend<ShrinkArgs["target"]>(); // use .not.toAssignTo / toBeAssignableTo as vitest version supports — match repo idiom in test/markers.test.ts
```

(Check the exact `expectTypeOf` matcher spelling used elsewhere in the repo, e.g. test/markers.test.ts:544, and mirror it.)

## Validation Loop

### Level 1: Type & lint

```bash
npm run typecheck        # tsc --noEmit — must be clean (new casts as unknown as ... where needed)
```

### Level 2: Unit tests

```bash
npx vitest run test/tools/shrink.test.ts   # the file under edit — must be fully green
npm test                                    # full suite — no regressions in markers/transforms/prepare-args/edge-cases
```

### Level 3: Contract spot-checks (manual reasoning, no code)

- Grep: `grep -n "by_content_includes" test/tools/shrink.test.ts` → only schema-rejection + type-negation references remain (no execute-level rows).
- Exact-string grep: refusal text appears verbatim in both the test and src/tools/shrink.ts.

## Final Validation Checklist

- [ ] `npx vitest run test/tools/shrink.test.ts` green
- [ ] `npm test` green; `npm run typecheck` clean
- [ ] Cases (a)–(f) all present with exact strings/`appended` assertions
- [ ] Content-arm rows moved OUT of the structural-invalid table; E8/orientation blocks rewritten per v2.0
- [ ] No production files touched (test-only item)

## Anti-Patterns to Avoid

- ❌ Don't weaken the exact-string assertions to `toContain` where full equality is specified (refusals, orientation lines).
- ❌ Don't use `vi.fn()` — hand-rolled fakes only.
- ❌ Don't edit src/ to make a test pass — if the contract differs from P1.M2.T1's PRP, flag it rather than papering over.
- ❌ Don't delete the still-valid E14/empty-replacement/discriminator/payload tests — align only.
- ❌ Don't build fixtures without a trailing user message for the earlier-turn cases — that makes the match in-span.

**Confidence Score**: 9/10 — the harness, fixtures, and contract are all concretely pinned; the only residual risk is slight drift in expectTypeOf matcher spelling and the parallel P1.M2.T1 implementation landing with a different refusal-string constant location.