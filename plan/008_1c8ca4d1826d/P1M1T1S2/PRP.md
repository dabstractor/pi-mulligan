# PRP — P1.M1.T1.S2: `currentTurnSpan` helper + optional span bound on `resolveShrinkTarget`; delete the content arm from the resolver

## Goal

**Feature Goal**: In `src/transforms.ts` (Pi-free pure tier), (a) add an exported pure helper `currentTurnSpan(messages)` returning `{ start, end }` where `start = iLastUser + 1` (same last-`role:"user"` scan as `resolveLastTurn`) and `end = messages.length`; (b) change `resolveShrinkTarget` to accept an optional third parameter `span?: { start: number; end: number }` and search ONLY indices `[span.start, span.end)` in its `by_tool_call_id` and `by_tool_name` arms (undefined span → full range, i.e. today's behavior — this keeps `cancel.ts` and the current `filterPipeline` call sites compiling and correct); (c) DELETE the `by_content_includes` branch (transforms.ts:800-807) so a legacy content target falls through to `return null` (no-op), and delete `stringifyContent` (transforms.ts:1065-1074) which becomes dead code (verified: its ONLY non-JSDoc usage is line 806).

**Deliverable**: `src/transforms.ts` exporting `currentTurnSpan` (and optionally `turnSpanAfter(iLastUser, len)`), the 3-arg `resolveShrinkTarget`, with the content arm and `stringifyContent` removed; all existing in-repo callers compile and behave unchanged where span is omitted.

**Success Definition**: `npm run typecheck` passes; `npx vitest run` stays green (existing tests that assert content-arm resolution of by_content_includes targets — if any still exist after S1's type split — may legitimately now expect null; change ONLY those assertions the compiler/tests force, full test sweep is P1.M1.T3.S1/P1.M4.T1); JSDoc documents span semantics and cites spec/06 §5 v2.0 + PRD §2 ruling.

## Why

PRD v2.0 removes the `by_content_includes` shrink arm and mandates current-turn scoping (defense in depth: the tool refuses out-of-scope targets at creation AND the filter independently enforces the same bound at every fire — spec/06 §5 v2.0, `ShrinkTarget` note in PRD §4-markers). This subtask delivers the resolver primitives: the span helper + the span-bounded resolver. Note the two-bound distinction (PRD §2 ruling): the TOOL uses the CURRENT turn's span (`currentTurnSpan(messages)`); the FILTER uses the marker's ISSUING turn's span (threaded from branchEntries in P1.M1.T2 — not this subtask). This subtask only makes `resolveShrinkTarget` able to accept any span; wiring the filter is T2.

## What

1. `currentTurnSpan(messages: MessageLike[]): { start: number; end: number }`
   - `end = messages.length`; `start = iLastUser + 1` using the SAME scan as `resolveLastTurn` (transforms.ts:331-337): last index with `isRecord(m) && readOwn(m, "role") === "user"`.
   - No user message exists → `start = 0` (session-start edge — the whole list is the span). Document this in JSDoc.
   - Non-array `messages` → return `{ start: 0, end: 0 }` (defensive; never throws — E13 hot path).
   - Plain primitive pair object — NO Span class (repo convention; matches `resolveLastTurn`'s `{ remove: number[] }` style).
   - Optionally also export `turnSpanAfter(iLastUser: number, len: number): { start: number; end: number }` (`start = iLastUser + 1` clamped to `[0, len]`, `end = len`; `-1` iLastUser → start 0) as the shared core both `currentTurnSpan` and future callers use.
2. `resolveShrinkTarget(messages: MessageLike[], target: ShrinkTargetRead, span?: { start: number; end: number }): number | null`
   - Param type is `ShrinkTargetRead` (delivered by P1.M1.T1.S1 — assume it exists exactly as that PRP specifies: 2-arm write `ShrinkTarget` + read union with legacy `by_content_includes` arm).
   - The `by_tool_call_id` loop and `by_tool_name` loop iterate only `i` in `[span.start, span.end)` when span is provided; clamp defensively (`start = Math.max(0, span.start)`, `end = Math.min(messages.length, span.end)`, non-number/NaN → full range). A match outside the span returns null. Span undefined → full range (cancel.ts full-history usage).
   - DELETE the `by_content_includes` branch (lines ~800-807): a legacy content-only target now falls to the final `return null` — legacy content-shrinks no-op forever (scope holds under all circumstances).
   - DELETE `stringifyContent` (lines 1065-1074) — pre-verified dead after the branch removal (only usage was line 806). Also remove the `stringifyContent` mention in `resolveShrinkTarget`'s JSDoc (~line 758). Do a final `grep -n stringifyContent src/` to confirm zero non-JSDoc references before deleting.
   - Purity rules unchanged: `isRecord`/`readOwn` for all field access, NEVER throws (E13), non-array messages → null, non-record target → null.
3. All existing callers keep compiling and behave identically (no span passed): `src/tools/cancel.ts:268` and `:285`, `src/tools/shrink.ts:267`, `src/transforms.ts` `applyShrink` (~904/986) and `filterPipeline` (986; also a second call site ~1546). Do NOT add span at the filterPipeline sites — that is P1.M1.T2.S2. Update their call-site comments only if they reference the deleted content arm.
4. Tests: TDD for span semantics is P1.M1.T3.S1 (a LATER subtask). Here: keep `npx vitest run` green. If existing tests assert by_content_includes resolves non-null (check `grep -n by_content_includes test/`), the compiler will not flag them (vitest doesn't typecheck) but they will FAIL at runtime — for those specific tests only, flip the expectation to `null` with a comment "v2.0: content arm removed — see P1.M1.T3.S1". Do not do a broader sweep (P1.M4.T1).

### Success Criteria

- [ ] `currentTurnSpan` exported from src/transforms.ts: `{start: iLastUser+1, end: length}`, start 0 when no user message, `{0,0}` for non-array
- [ ] `resolveShrinkTarget(messages, target, span?)` — both surviving arms bounded to `[span.start, span.end)`, out-of-span → null, undefined span → full range
- [ ] `by_content_includes` branch DELETED; legacy content targets resolve null
- [ ] `stringifyContent` DELETED (grep-verified dead)
- [ ] All existing callers unchanged in call shape; `npm run typecheck` passes; `npx vitest run` green
- [ ] JSDoc on `resolveShrinkTarget` (span semantics: in-span-only, undefined = full range, cancel usage) and on `currentTurnSpan` (cite spec/06 §5 v2.0 + PRD §2: tool bound = current turn; filter uses the marker's issuing-turn span)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need the exact current resolver code (excerpted below), the `resolveLastTurn` scan precedent, purity conventions, the S1 type contract, and the caller inventory. All provided.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: THE file to edit. resolveShrinkTarget at :771 (2-arm branches at :775-797; content
        branch :800-807 to DELETE); resolveLastTurn last-user scan precedent at :331-337;
        stringifyContent at :1065-1074 (dead after deletion); applyShrink call at :986;
        filterPipeline second resolveShrinkTarget call ~:1546.
  pattern: plain-primitive return objects, isRecord/readOwn everywhere, no imports
           (Pi-free pure tier — 0 imports, hard rule).
  gotcha: transforms.ts must NOT import from markers.ts (or anything).

- file: plan/008_1c8ca4d1826d/P1M1T1S1/PRP.md
  why: CONTRACT from the parallel predecessor: after S1, resolveShrinkTarget's target param
        is ShrinkTargetRead; ShrinkTarget (write) is 2-arm. Build on that; do not re-split types.
  gotcha: S1 is being implemented in parallel — if its ShrinkTargetRead is not yet present
        when you start, the type widening of the param to ShrinkTargetRead is part of S1;
        code against its contract regardless (the runtime changes here are independent of
        the type split, so implement them; tsc green at merge time is the joint gate).

- docfile: plan/008_1c8ca4d1826d/architecture/_scouts/pure-tier.md
  why: §2 — purity rules, E13 hot path, never-throws discipline, throwing-Proxy safety.

- spec: spec/06-context-filter.md §5 (v2.0 block) — turnSpan semantics, "by_content_includes no longer exists"
- spec: spec/04-data-model.md §4-marker:shrink — "v2.0: by_content_includes REMOVED; both remaining arms resolve ONLY within the CURRENT turn's tool-result span"
```

### Current code (exact excerpts, verified)

`resolveShrinkTarget` head + the two surviving arms (transforms.ts:771-797) — loops currently run `for (let i = 0; i < messages.length; i++)`:

```ts
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null {
  if (!Array.isArray(messages)) return null;
  if (!isRecord(target)) return null;
  const callId = readOwn(target, "by_tool_call_id");
  if (typeof callId === "string" && callId.length > 0) {
    for (let i = 0; i < messages.length; i++) { /* role==="toolResult" && toolCallId===callId → return i */ }
    return null;
  }
  const name = readOwn(target, "by_tool_name");
  if (typeof name === "string" && name.length > 0) {
    const wantFirst = readOwn(target, "occurrence") === "first"; // else → last (GOTCHA #6)
    // same full-range loop; wantFirst returns immediately, else keeps last
  }
  // DELETE THIS BLOCK (lines ~800-807):
  // const needle = readOwn(target, "by_content_includes");
  // if (typeof needle === "string" && needle.length > 0) { ...stringifyContent... }
  return null;
}
```

`resolveLastTurn` scan to mirror (transforms.ts:331-337):

```ts
let iLastUser = -1;
for (let i = 0; i < messages.length; i++) {
  if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
}
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keep GOTCHA #6 — occurrence !== "first" (including missing) → LAST match.
// CRITICAL: clamp the span — span.start < 0, span.end > length, start > end, or NaN must
//   degrade to a safe range (clamp, never throw). Simplest: 
//   const s = Math.max(0, Math.min(Number.isFinite(span.start) ? span.start : 0, ...));
//   or: invalid/degenerate span → full range. Pick one, document in JSDoc, keep deterministic.
// GOTCHA: by_tool_call_id arm — toolCallId is unique, but with a span the loop bounds simply
//   change; a match BEFORE span.start must now return null (was found).
// GOTCHA: vitest does NOT typecheck tests — runtime failures in content-arm tests are the
//   signal to flip those specific expectations to null.
// GOTCHA: no Span class, no imports, plain object literals ({ start, end }).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD currentTurnSpan (+ turnSpanAfter) in src/transforms.ts near resolveLastTurn (~after :345)
  - IMPLEMENT per spec above; JSDoc citing spec/06 §5 v2.0 + PRD §2 two-bound ruling,
    session-start edge (no user → start 0), non-array → {0,0}
  - NAMING: currentTurnSpan, turnSpanAfter; snake_ok — plain functions, exported
  - PLACEMENT: pure tier, src/transforms.ts

Task 2: REWRITE resolveShrinkTarget signature + loops (src/transforms.ts:771)
  - SIGNATURE: (messages: MessageLike[], target: ShrinkTargetRead, span?: { start: number; end: number })
    (if S1's param widening has already landed; otherwise ShrinkTarget — S1 owns the type split)
  - COMPUTE the effective range ONCE before the arms: full range when span undefined/invalid,
    else clamped [start, end). Both loops use `for (let i = start; i < end; i++)`.
  - PRESERVE: non-array → null; non-record target → null; empty-string discriminator skip;
    occurrence semantics (GOTCHA #6)
  - JSDoc: span semantics (in-span-only match; undefined = full range = cancel.ts usage),
    v2.0 citation, content arm removed note (legacy content targets → null no-op)

Task 3: DELETE the by_content_includes branch (:800-807) and stringifyContent (:1065-1074)
  - FIRST run `grep -n "stringifyContent" src/` — expect only :758 (JSDoc), :806 (sole use), :1065 (def)
  - Also clean the :758 JSDoc mention; grep by_content_includes remaining occurrences in src/
    and fix only compile-breaking or now-false ones (tools' describeTarget etc. is P1.M2 — leave)

Task 4: VERIFY callers compile unchanged
  - cancel.ts:268/:285, shrink.ts:267, applyShrink (:986), filterPipeline (~:1546) — all still
    2-arg calls; TypeScript optional param = no caller edits. Run npm run typecheck.

Task 5: TESTS — minimal adjustment only
  - grep -n "by_content_includes" test/ ; for tests asserting a content target resolves to an
    index, flip expected to null with a "v2.0, see P1.M1.T3.S1" comment. NOTHING else.
  - npx vitest run → green
```

### Implementation Patterns & Key Details

```ts
// Effective-range computation (place after the isRecord(target) guard):
let lo = 0, hi = messages.length;
if (span !== undefined && span !== null && isRecord(span)
    && typeof readOwn(span, "start") === "number" && typeof readOwn(span, "end") === "number"
    && Number.isFinite(span.start) && Number.isFinite(span.end)) {
  lo = Math.max(0, Math.trunc(span.start));
  hi = Math.min(messages.length, Math.trunc(span.end));
  if (hi < lo) hi = lo; // degenerate → empty range → guaranteed null from both arms
}

// currentTurnSpan:
export function currentTurnSpan(messages: MessageLike[]): { start: number; end: number } {
  if (!Array.isArray(messages)) return { start: 0, end: 0 };
  let iLastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i; // SAME scan as resolveLastTurn
  }
  return turnSpanAfter(iLastUser, messages.length);
}
```

### Integration Points

```yaml
EXPORTS (src/transforms.ts):
  - NEW: currentTurnSpan, turnSpanAfter (optional)
  - CHANGED: resolveShrinkTarget gains optional 3rd param
  - REMOVED: stringifyContent (module-private; no external impact)
CONSUMERS (no edits needed): src/tools/cancel.ts, src/tools/shrink.ts, src/transforms.ts applyShrink/filterPipeline
FUTURE (NOT this subtask): filterPipeline passes a span (P1.M1.T2.S2); tool-side match-now uses currentTurnSpan (P1.M2.T1.S2); span tests (P1.M1.T3.S1)
```

## Validation Loop

### Level 1: Type check

```bash
npm run typecheck   # tsc --noEmit — 0 errors (note: S1 lands in parallel; if S1's types aren't merged yet, this gate is joint — verify against the combined tree)
```

### Level 2: Tests

```bash
grep -n "by_content_includes" test/         # identify content-arm assertions
npx vitest run                              # all green after minimal expectation flips
```

### Level 3: Contract assertions

```bash
grep -n "currentTurnSpan\|turnSpanAfter" src/transforms.ts            # exported
grep -n "resolveShrinkTarget" src/transforms.ts                        # 3-arg signature
grep -cn "stringifyContent" src/transforms.ts                          # expect 0
grep -n "by_content_includes" src/transforms.ts                        # only ShrinkTargetRead legacy arm + JSDoc, NOT the resolver
# quick sanity (scratch): node/tsx one-liner or a temp vitest test — not committed here (T3.S1 owns the lock):
#   resolveShrinkTarget(msgs, {by_tool_call_id:"x"}, {start:5,end:10}) → null when the match is at index 3
```

## Final Validation Checklist

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` green
- [ ] `currentTurnSpan`/`turnSpanAfter` exported, plain primitives, session-start edge documented
- [ ] `resolveShrinkTarget` bounded by optional span; undefined span = full range; never throws; readOwn/isRecord only
- [ ] Content arm + `stringifyContent` deleted, grep-verified
- [ ] No caller signature changes; filterPipeline span wiring deferred to P1.M1.T2.S2
- [ ] JSDoc cites spec/06 §5 v2.0 + PRD §2 two-bound ruling (tool = current turn; filter = marker's issuing turn)
- [ ] Only src/transforms.ts (plus compiler/test-forced minimal touches) modified

## Anti-Patterns to Avoid

- ❌ Do NOT wire the span into filterPipeline or the tools — P1.M1.T2 / P1.M2
- ❌ Do NOT write the span tests now — P1.M1.T3.S1 (only flip compiler/test-forced content expectations)
- ❌ Do NOT import anything into transforms.ts or introduce a Span class
- ❌ Do NOT throw or assume span well-formedness — clamp/degrade defensively
- ❌ Do NOT change occurrence semantics or the empty-discriminator skip behavior