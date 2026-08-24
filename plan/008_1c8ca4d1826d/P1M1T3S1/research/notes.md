# Research — P1.M1.T3.S1 (resolveShrinkTarget span tests)

## Contract under test (src/transforms.ts, landed by P1.M1.T1.S2)
- `resolveShrinkTarget(messages, target, span?)` at :827-880. Half-open `[start,end)`; span clamped
  (start≥0, end≤len, end<start → empty → null); malformed span (NaN/non-number/absent fields) → IGNORED → full range.
- `by_tool_call_id` → first toolResult with matching toolCallId within range.
- `by_tool_name` + occurrence → LAST in-range match by default; FIRST only when `occurrence === "first"` (GOTCHA #6).
- `by_content_includes` (legacy) falls through → null always (v2.0).
- `currentTurnSpan(messages)` at :379 → `{start: iLastUser+1, end: len}`; no user → start 0; non-array → `{0,0}`.
- Types: `ShrinkTarget` (WRITE, 2 arms, :776) vs `ShrinkTargetRead` (READ, +deprecated content arm, :787) —
  legacy-arm tests must use ShrinkTargetRead.

## Test file recon (test/transforms.test.ts)
- Import list :1-2 (add `currentTurnSpan`, `type ShrinkTargetRead`).
- Factories :32-42: user/asst/asstText/result/custom + `summary()` + pairing invariant helper.
  NO toolResult(callId, toolName) factory — result() hardcodes toolName:"tool"; add one for by_tool_name tests.
- Turn simulation = literal arrays (e.g. :1391-1399).
- House style: vitest describe/it/expect, no vi.fn, `.js` imports, no module state → no beforeEach.
- Existing legacy content-arm rows already flipped to null expectations: :1032 (no-op same-ref), :1067-1079
  (null / E19 unchanged), :1090-1093 (resolver → null incl. empty needle BUG-004), :1114-1125 (trap/Proxy
  defensive). Do NOT duplicate — this PRP adds only span-interaction variants.

## Downstream consumers (context only)
- P1.M1.T2S2 PRP: filterPipeline LIVE branch calls resolveShrinkTarget(messages, target, markerSpan) with
  issuing-turn span — the semantics locked here make that guard sound.
- cancel.ts: full-history hints rely on span-omitted → full range (back-compat requirement (c)).