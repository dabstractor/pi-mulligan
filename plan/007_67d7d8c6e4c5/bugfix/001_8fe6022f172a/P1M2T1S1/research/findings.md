# Research Notes — P1.M2.T1.S1: renderAuditReport checkpoint clause — add `(user-set)`, singularize count (BUG-003)

> Surgical text-format change in `renderAuditReport` (src/tools/audit.ts ~448–454) + 2 test-string updates +
> 1 new singular test + 1 doc-comment update. PURE renderer (shared by agent tool + human command). No Pi
> mocking, no signature change, no behavior beyond the rendered string.

## 1. The checkpoint clause (current — src/tools/audit.ts:448–454)
```ts
  const ckptNames = args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []";
  const cancelledClause = args.cancelledCount > 0 ? `, ${args.cancelledCount} cancelled (retired)` : "";
  L.push(
    `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
      `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}${cancelledClause}`,
  );
```
Today renders: `…, N checkpoints [names]` (or `0 checkpoints []`). MISSING `(user-set)` (spec/13 §4 step 3) and
does NOT singularize (`1 checkpoints`).

## 2. The fix (per bug_analysis §BUG-003 lines 136–139)
Add two consts + use them in the template; `(user-set)` goes AFTER the names bracket, BEFORE cancelledClause:
```ts
  const ckptWord    = args.checkpointNames.length === 1 ? "checkpoint" : "checkpoints";
  const ckptUserSet = args.checkpointNames.length > 0 ? " (user-set)" : "";
  …
      `${args.shrinks.length} shrink, ${args.checkpointNames.length} ${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}`,
```
Outputs:
- `2 checkpoints [before-x, before-y] (user-set)`
- `1 checkpoint [solo] (user-set)`
- `0 checkpoints []` (length 0 → no annotation; cancelledClause still appends if cancelledCount > 0)

## 3. Spec requirement
spec/13-human-facing-surface.md §4 step 3 (line 89): "the report's `Active markers` line includes
`N checkpoints [names] (user-set)` so the human can see what they have armed." The `(user-set)` annotation is
meaningful in v1.1 (checkpoints moved to the user — E23). Applies to BOTH the agent tool AND the human command
(they share `renderAuditReport`, per spec/13 §4 "same renderer").

## 4. Test breakage map (verified — `grep -rn 'checkpoints \[' test/`)

### WILL BREAK (need ` (user-set)` appended) — both in test/tools/audit.test.ts
- **Line 550** (integration, `toContain`): `"Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y]"`
- **Line 929** (pure renderer, exact `toBe(lines[2])`): `"Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]"`

### UNCHANGED (empty checkpoints → no annotation; length 0)
- **Line 558**: `toContain("0 rewind, 0 shrink, 0 checkpoints []")` — stays.
- **Line 975**: `toContain("0 rewind, 0 shrink, 0 checkpoints []")` — stays.
- **Lines 568–600** (cancelledCount>0 tests): use `checkpointNames: []` → no `(user-set)`. The cancelledClause
  (`, N cancelled (retired)`) still matches via `.toContain`. Still passes. (The contract's "verify it still
  works with (user-set) present" is moot here — these tests use empty checkpoints, so no annotation appears.)

### NEW test (singular + annotation)
Add a pure-renderer `it(...)` asserting `checkpointNames:["solo"]` → `"1 checkpoint [solo] (user-set)"`
(+) `not.toContain("1 checkpoints")` (singular guard).

### Doc comment (consistency)
- **Line 23** (file-header docstring): `"…2 checkpoints [a, b]"` → `"…2 checkpoints [a, b] (user-set)"`.

## 5. commands.test.ts is UNAFFECTED (self-consistent — key insight)
`buildExpectedReport` (line 516–543) calls `renderAuditReport` with `checkpointNames` from `listCheckpoints`.
The case-(a) test (line 559) asserts EXACT-STRING equality: `notify msg === renderAuditReport re-derived from
the same filtered+ctx`. BOTH sides call `renderAuditReport` → both change identically → equality STILL HOLDS.
Its fixtures use `entries: []` (no checkpoints) → `0 checkpoints []` (no annotation anyway). NO edit needed.

## 6. Baseline + conflict (verified)
- `npx tsc --noEmit` → **0 errors** (clean).
- `npx vitest run test/tools/audit.test.ts test/commands.test.ts` → **96/96 green**.
- After fix: tsc still 0; audit.test.ts 2 string updates (no count change) + 1 new test → 97 in those 2 files.
- **Parallel item P1.M1.T2.S1** edits `src/nudges.ts` (renderHighWaterNudge) + `test/drift_nudge.test.ts` +
  README. Does NOT touch audit.ts/audit.test.ts/commands.test.ts. Zero overlap.
- This PRP edits ONLY `src/tools/audit.ts` (the checkpoint clause) + `test/tools/audit.test.ts` (2 string
  updates + 1 new test + 1 doc-comment). Nothing else.

## 7. Ordering detail (gotcha)
The template order must be `${ckptWord}${ckptNames}${ckptUserSet}${cancelledClause}` — i.e. `(user-set)`
AFTER the names bracket and BEFORE the `, N cancelled (retired)` clause. Example with both:
`2 checkpoints [before-x, before-y] (user-set), 1 cancelled (retired)`.