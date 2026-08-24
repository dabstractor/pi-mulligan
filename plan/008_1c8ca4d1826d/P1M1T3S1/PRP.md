# PRP — P1.M1.T3.S1: resolveShrinkTarget span tests (both arms, out-of-span → null, omitted span = full range, legacy content → null)

## Goal

**Feature Goal**: Lock the v2.0 span semantics of `resolveShrinkTarget` and `currentTurnSpan` in `test/transforms.test.ts` with a dedicated, deterministic test block — both target arms (`by_tool_call_id`, `by_tool_name`+occurrence) restricted to `[span.start, span.end)`, out-of-span matches → `null`, omitted span → full range (back-compat for cancel usage), legacy `by_content_includes` targets → `null` always, and `currentTurnSpan` edge behavior (last-user boundary, no-user → start 0, non-array → empty span).

**Deliverable**: New `describe("resolveShrinkTarget — v2.0 span semantics ...")` and `describe("currentTurnSpan — ...")` blocks in `test/transforms.test.ts`; existing legacy content-arm tests at lines ~1032, 1067-1079, 1092-1093, 1116-1125 confirmed/normalized to legacy-null expectations (some already flipped — verify, don't duplicate); `npx vitest run test/transforms.test.ts` fully green.

**Success Definition**: All sub-tests pass with zero mocks/vi.fn; the contract consumed by the filter guard (P1.M1.T2.S2 — its live path passes the marker's span as the 3rd argument) and by both tools is pinned so future refactors cannot silently widen or narrow the search range.

## Why

- The span bound is the core of the v2.0 current-turn scoping ruling: `resolveShrinkTarget` alone decides whether a target resolves or no-ops when outside its turn. Without tests, a refactor could re-widen the search to full history and resurrect the shed bloat.
- P1.M1.T2.S2 (parallel, in flight) threads a span into `resolveShrinkTarget` at the pipeline's LIVE branch — it depends on exactly the semantics locked here: `[start, end)` half-open, out-of-span → null, undefined → full range.
- Legacy v1.x content-arm markers must be proven to no-op forever (E19 moot ruling; PRD §2) at the resolver level now; the bulk test migration is P1.M4.T1.S1.

## What

Test-only change to `test/transforms.test.ts`. No production code edits; no docs (no user-facing/config/API surface change).

### Success Criteria

- [ ] (a) `by_tool_call_id` matching INSIDE `[start,end)` → that index; the same id matching only BEFORE `span.start` (or at/after `span.end`) → `null`.
- [ ] (b) `by_tool_name` + `occurrence:"first"` → first in-span match index; `occurrence:"last"` (and default/omitted) → last in-span match; a LATER out-of-span same-name result must NOT win `occurrence:"last"`.
- [ ] (c) span omitted (`undefined`) → full range (back-compat: `cancel.ts` full-history hint usage).
- [ ] (d) `{ by_content_includes: "x" }` (typed via `ShrinkTargetRead`) → `null` ALWAYS, with and without a span.
- [ ] (e) `currentTurnSpan`: returns `{start: iLastUser+1, end: len}` for a multi-user array; no user message → `{start:0, end:len}`; non-array → `{start:0, end:0}`.
- [ ] Existing legacy content-arm tests at :1032, :1067-1079, :1092-1093, :1116-1125 already express null/no-op expectations — verify they remain green; add nothing duplicating them.
- [ ] `npx vitest run test/transforms.test.ts` green; `npx tsc --noEmit` clean.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need the exact resolver signature + span clamping rules, the factory helpers, the vitest house idioms, and the distinction between the WRITE union (`ShrinkTarget`, 2 arms) and READ union (`ShrinkTargetRead`, +deprecated content arm). All provided below.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: CONTRACT — the function under test (already landed by P1.M1.T1.S2)
  lines: ":827-880 resolveShrinkTarget (3-arg, optional span; clamps start≥0/end≤len, degenerate/NaN/non-number
    span → full range; first-present-non-empty-string discriminator decides variant; by_tool_call_id → first
    toolResult with toolCallId===id; by_tool_name → LAST index by default, FIRST only when occurrence==='first';
    by_content_includes falls through to null). :379 currentTurnSpan. :357 turnSpanAfter (shared clamp helper)."
  pattern: "readOwn/isRecord defensive reads; half-open [start,end) iteration `for (i=lo; i<hi; i++)`"
  gotcha: "occurrence is LAST by default for ANY non-'first' value incl. missing (GOTCHA #6); span with end<start
    clamps to an EMPTY range → both arms return null (worth a test); a span with non-number/NaN fields is IGNORED
    → full range"

- file: src/transforms.ts (types)
  why: ":776 ShrinkTarget = {by_tool_call_id} | {by_tool_name+occurrence} (WRITE union — 2 arms).
    :787 ShrinkTargetRead adds the @deprecated {by_content_includes} arm (READ union). Tests of the legacy arm
    MUST use ShrinkTargetRead (a content target no longer type-checks as ShrinkTarget)."

- file: test/transforms.test.ts
  why: THE file being edited. :1-2 import list (extend it: resolveShrinkTarget already imported; add
    currentTurnSpan, type ShrinkTargetRead). :32-42 factories user/asst/asstText/result. toolResult factory
    is NOT present — grep for it; if absent, build results via result(callId) and override toolName, or add a
    local toolResult(callId, toolName) helper next to result(). Turn simulation = literal arrays (:1391-1399)."
  pattern: "describe blocks with spec-citation headers (e.g. 'resolveShrinkTarget — v2.0 span semantics
    (spec/06 §5 v2.0; PRD §2)'); it() titles state the contract in prose"
  gotcha: "NO vi.fn, NO mocks — pure functions only; `.js` import paths; no beforeEach needed (transforms.ts
    has no module state)"

- docfile: plan/008_1c8ca4d1826d/architecture/_scouts/tests.md
  why: full test recon — house idioms, all legacy by_content_includes test sites with line numbers
  section: "§1 Harness conventions; §2 every by_content_includes occurrence; §3 helpers/fixtures"

- docfile: plan/008_1c8ca4d1826d/P1M1T2S2/PRP.md
  why: CONTRACT of the parallel filter-guard item — its LIVE branch calls
    resolveShrinkTarget(messages, target, span) with the marker's issuing-turn span; this PRP's tests are the
    seam that makes that guard trustworthy. Do NOT test filterPipeline here (that's P1.M1.T3.S2).
```

### Current Codebase tree (relevant slice)

```bash
src/transforms.ts        # pure helpers (resolveShrinkTarget, currentTurnSpan, turnSpanAfter, types)
test/transforms.test.ts  # vitest suite — ADD the two describe blocks here
src/markers.ts           # persisted-marker types (READ-side ShrinkTargetRead twin — not edited)
src/tools/cancel.ts      # consumer of span-omitted full-range resolution (context, not edited)
```

### Desired Codebase tree with files to be added/changed

```bash
test/transforms.test.ts   # MODIFIED ONLY — new describe blocks + import additions; nothing else changes
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: occurrence semantics — ANY value !== "first" (incl. missing/"last"/garbage) → LAST match in span.
// CRITICAL: span {start:5,end:3} (end<start) → EMPTY range → null from BOTH arms (resolver clamps hi=lo).
// CRITICAL: span with NaN / non-number start/end → IGNORED → full range (not empty range!).
// CRITICAL: by_tool_call_id scans [lo,hi) — a match at index exactly === span.end is OUT (half-open).
// CRITICAL: a toolResult factory with a custom toolName: {role:"toolResult", toolCallId, toolName, content, isError}
//   — result(callId) hardcodes toolName:"tool"; for by_tool_name tests either use toolName:"tool" or add a helper.
// CRITICAL: legacy content-arm tests MUST type the target as ShrinkTargetRead (compile error otherwise — intended).
// GOTCHA: messages are MessageLike (unknown-ish records) — factories at :32-42 return MessageLike; keep that.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/transforms.test.ts — imports
  - ADD to the ../src/transforms.js import: currentTurnSpan, type ShrinkTargetRead
    (resolveShrinkTarget, turnSpanAfter-if-needed, user/asst/result are already available/imported)

Task 2: ADD local toolResult factory (only if absent — grep first)
  - IMPLEMENT (next to result(), ~:40): function toolResult(toolCallId: string, toolName: string): MessageLike
    returning {role:"toolResult", toolCallId, toolName, content:[{type:"text",text:"..."}], isError:false}
  - NAMING/shape: mirror the existing result() builder exactly

Task 3: ADD describe("currentTurnSpan — v2.0 current-turn span (spec/06 §5 v2.0)")
  - (e) [user,asst,result,user,asst,result] → {start:4? no — compute: iLastUser=3 → start 4, end 6}
  - no user message ([asst,result,...]) → {start:0, end:len}
  - single user at 0 → {start:1, end:len}
  - non-array (cast [] as never-ish via `([1,2] as unknown as MessageLike[])`-style defensive idiom used
    elsewhere in the file — match the existing defensive-test style) → {start:0, end:0}
  - cross-check invariant vs resolveLastTurn's scan on the same array (last role:"user" index)

Task 4: ADD describe("resolveShrinkTarget — v2.0 span semantics (spec/06 §5 v2.0; PRD §2)")
  Fixture (built inline with factories, roles: 0 user, 1 asst("c1"), 2 result("c1"), 3 user, 4 asst("c2"),
  5 toolResult("r2","read"), 6 toolResult("r3","read"), 7 toolResult("r4","bash")) — adjust ids so:
  - (a) by_tool_call_id: target {by_tool_call_id:"r3"}, span {start:5,end:8} → 6;
    span {start:0,end:5} → null (match exists only before span.start);
    span {start:6,end:8} → null for "r2" (match at 5 === span.start boundary: use {start:6} to exclude it);
    a match at index === span.end → null (half-open)
  - (b) by_tool_name "read": occurrence:"first" span {start:5,end:8} → 5;
    occurrence:"last" span {start:5,end:8} → 6; span {start:0,end:6} with occurrence:"last" → 5
    (index 6's later "read" is out-of-span and must NOT win); occurrence omitted → same as "last";
    occurrence:"garbage" → same as "last" (GOTCHA #6)
  - (c) span omitted → full range: by_tool_call_id:"r4" → 7; by_tool_name "read" occurrence:"last" → 6
  - (d) legacy: const legacy: ShrinkTargetRead = { by_content_includes: "read" } (and "u", and "")
    → null with span omitted AND with span {start:0,end:8} AND with empty span
  - Degenerate/defensive: span {start:5,end:3} → null for both arms; span {start:NaN,end:8} /
    {start:0,end:"x" as never} → full range (resolver ignores malformed span); never throws
  - Type-lock (expectTypeOf optional, matches house style at :348): resolveShrinkTarget returns number|null

Task 5: VERIFY existing legacy content-arm tests (:1032, :1067-1079, :1090-1093, :1114-1125)
  - These were already flipped to null/no-op expectations by earlier delta work — do NOT rewrite them again,
    do NOT duplicate (d)-style cases that already exist there (e.g. :1090 by_content_includes:"u" → null;
    :1091 empty needle → null). Your (d) block adds only the SPAN-interaction variants (legacy + span).
  - The bulk migration of tools/edge-cases/cancel/smoke tests is P1.M4.T1.S1 — OUT OF SCOPE here.
```

### Implementation Patterns & Key Details

```ts
// Span test skeleton (house style — factories, literal arrays, prose it() titles):
const msgs: MessageLike[] = [
  user("turn 0"),
  asst("c1"),
  result("c1"),
  user("turn 1"),
  asst("c2"),
  toolResult("r2", "read"),
  toolResult("r3", "read"),
  toolResult("r4", "bash"),
];

it("by_tool_name occurrence:'last' — a later OUT-OF-SPAN same-name result must not win", () => {
  expect(resolveShrinkTarget(msgs, { by_tool_name: "read", occurrence: "last" }, { start: 0, end: 6 })).toBe(5);
  expect(resolveShrinkTarget(msgs, { by_tool_name: "read", occurrence: "last" }, { start: 5, end: 8 })).toBe(6);
});

// Legacy arm MUST be typed ShrinkTargetRead:
const legacy: ShrinkTargetRead = { by_content_includes: "read" };
expect(resolveShrinkTarget(msgs, legacy, { start: 0, end: 8 })).toBeNull();
```

### Integration Points

```yaml
NONE — test-only. No config, no routes, no migrations.
Downstream contract consumers (reference only, do not edit):
  - P1.M1.T2.S2 filterPipeline LIVE branch passes the marker's issuing-turn span as 3rd arg
  - cancel.ts relies on span-omitted full-range resolution
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # zero errors (type-lock matters: legacy arm via ShrinkTargetRead only)
```

### Level 2: Unit Tests

```bash
npx vitest run test/transforms.test.ts   # all green, including the pre-existing legacy-null rows
npx vitest run                            # full suite must stay green (no production edits → zero ripple)
```

### Level 3-4: N/A (pure-function, test-only; no service, no MCP surface)

## Final Validation Checklist

- [ ] (a)-(e) success criteria all covered by explicit `it()` cases
- [ ] Both arms tested in-span, before-span, at-boundary (=== span.start in / === span.end out), after-span
- [ ] occurrence default/garbage → "last" behavior locked
- [ ] Degenerate span (end<start → empty → null) and malformed span (NaN → full range) locked
- [ ] Legacy content arm typed via `ShrinkTargetRead` → null with and without span
- [ ] `currentTurnSpan` edges: last-user boundary, no-user → start 0, non-array → `{0,0}`
- [ ] No vi.fn, no mocks, `.js` imports, factories reused — house style (scout §1)
- [ ] No duplication of the already-flipped legacy rows (:1067-1093, :1114-1125)
- [ ] `npx vitest run` full-suite green; `npx tsc --noEmit` clean
- [ ] No production files touched (transforms.ts, filter.ts, markers.ts untouched)

## Anti-Patterns to Avoid

- ❌ Don't "fix" `src/transforms.ts` if a test fails — the resolver is the landed P1.M1.T1.S2 contract; a failing expectation means YOUR test's span arithmetic is wrong (recompute the fixture indices).
- ❌ Don't test filterPipeline span-guarding here — that is P1.M1.T3.S2's scope.
- ❌ Don't migrate the by_content_includes tests in shrink/cancel/edge-cases/smoke — that is P1.M4.T1.S1.
- ❌ Don't use vi.fn or vi.mock — pure functions, no mocks needed.

---

**Confidence Score**: 9/10 — the resolver implementation is already landed and its JSDoc fully specifies the clamping/occurrence semantics being tested; the test file's conventions are exhaustively documented in the scout. Residual risk: fixture index arithmetic errors in boundary cases (mitigated by the explicit fixture layout above).