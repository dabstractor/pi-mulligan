# Non-Regression Audit — P1.M3.T2.S1 (BUG-006), Re-planning Attempt 2

## Context

Attempt 1 correctly implemented the step 5b guarded refusal in `src/tools/rewind.ts`
and updated `test/tools/rewind.test.ts` (1 updated snapshot + 1 new F-protected
regression test). BUT its non-regression proof audited ONLY `rewind.test.ts` for
`to_previous_prompt` usage and missed that `test/edge-cases.test.ts` encodes the
PRE-FIX buggy behavior — causing 1 full-suite failure.

This audit is COMPLETE: it greps **every** test file for the protected-nuclear
signal (`last_turn` + `to_previous_prompt:true` reaching the tool) and classifies
each hit.

## Method

```bash
grep -rn "to_previous_prompt" test/
```

then read each hit in context and classify: (a) does it exercise the nuclear
last_turn path through the rewind TOOL, and (b) does it assert persist (buggy) or
refuse (correct)?

## Complete inventory of `to_previous_prompt` hits

| File:Lines | Path | Asserts | Status / Action |
|---|---|---|---|
| `test/edge-cases.test.ts:447-456` | tool execute, nuclear `last_turn` on EMPTY context (`makeCtx()` no `contextEntries`) | **PERSIST** (`appended.length + sent.length > 0`) | **FAILING — THE ONE FIX NEEDED.** Flip to refuse + no-persist. |
| `test/edge-cases.test.ts:403-405` | `describe` block header comment for E3 | comment claims "The TOOL does NOT pre-check protected — it persists" | **NOW FALSE — update comment** (part of the same edit region). |
| `test/edge-cases.test.ts:407-411` | `resolveLastTurn` UNIT test (single user msg) | resolver returns `{remove:[]}` | UNCHANGED — resolver behavior is identical. No change. |
| `test/edge-cases.test.ts:413-419` | `resolveLastTurn` UNIT test (two user msgs) | resolver removes iLastUser only | UNCHANGED. No change. |
| `test/edge-cases.test.ts:431-444` | `filterPipeline` no-op test (protectedOk defense) | filter no-ops (same ref) | UNCHANGED — filter layer still defense-in-depth. No change. |
| `test/tools/rewind.test.ts:432-456` | new F-protected regression test | refuse + no-persist | **ALREADY APPLIED (Attempt 1)** — correct, keep. |
| `test/tools/rewind.test.ts:558-578` | updated `options.to_previous_prompt` test (now 2 user msgs) | persist (legit, K=1) | **ALREADY APPLIED (Attempt 1)** — correct, keep. |
| `test/integration/smoke.ts:233-237` | `F-protected` smoke case | asserts REFUSAL text via `rewindNow` (GOTCHA #4) | **Already consistent with the fix.** No change. |
| `test/transforms.test.ts:549,556,614,…` | pure `resolveLastTurn` UNIT tests | resolver returns `{remove:[]}` / index sets | UNCHANGED — resolver behavior identical. No change. |
| `test/markers.test.ts:122,175` | static fixture, `to_previous_prompt:false` | n/a (false, not nuclear) | UNCHANGED. No change. |
| `test/tools/cancel.test.ts:171` | static fixture, `to_previous_prompt:false` | n/a (false) | UNCHANGED. No change. |

## Conclusion

**Exactly ONE test** asserts the buggy persist behavior: `test/edge-cases.test.ts:447-456`
(plus its now-false describe-block comment at 403-405). Every other hit either
(Already applied in Attempt 1, tests the unchanged resolver/filter layer, or
already asserts refusal. This time the audit is exhaustive — no third file will
surprise Attempt 2.

## Empty-messages behavior (verified in source)

`resolveLastTurn([], {to_previous_prompt:true}, …)` returns `{remove:[]}` via the
`if (iLastUser === -1) return { remove: [] }` early-return (src/transforms.ts,
the "no user message → nothing to rewind (protected)" guard). So the
edge-cases.test.ts:447 case (makeCtx with NO contextEntries → buildContextEntries()
returns `[]`) ALSO hits step 5b (k===0) and refuses. Confirmed empirically: the
test currently fails with `expected 0 to be greater than 0` (nothing persisted).