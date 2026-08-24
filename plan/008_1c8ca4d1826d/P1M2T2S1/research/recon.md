# Research Notes — P1.M2.T2.S1 (shrink v2.0 test lock)

## Harness recon (test/tools/shrink.test.ts, verified)
- House idiom: hand-rolled fakes, NO `vi.fn()`; `clearAll()` from `src/runtime.js` in `beforeEach`+`afterEach` (seq-leak GOTCHA #8, lines ~44-46).
- `makePi({throwOnAppend})` → `{appended: [{customType, data}], pi}` captures `appendEntry`.
- `makeCtx({sessionId, leafId, contextEntries, throwOnGetSessionId, throwOnGetLeafId, throwOnBuildContextEntries, hasUI})` → `{ctx, notifyCalls}`; scripts `buildContextEntries` returning `SessionEntry[]`.
- `run(pi, ctx, params, toolCallId="call-1")` → `tool.execute(toolCallId, params, undefined, undefined, ctx)`.
- `msgEntry(role, extra)` builds `{type:"message", id:"e-N", parentId:null, timestamp:"", message:{role,...extra}}`; `toolResult(callId, toolName, text)` builds the message body. Entry ids are `e-1`, `e-2`, ... — use for pinnedEntryId assertions.
- `firstText(res)` narrows content[0] to text.
- Success text shape (line ~740): `` `Mulligan: shrink recorded. Matched: yes.\n${shrinkOrientationLine(1, 998)}` `` — `shrinkOrientationLine` is imported from `src/tools/shrink.js` and takes (k, tokens).

## Turn-span simulation
`currentTurnSpan` = index after the LAST `role:"user"` message → end. So a fixture `[msgEntry("user",{content:"hi"}), msgEntry("toolResult", toolResult("call-A",...))]` puts call-A IN the current turn; `[msgEntry("toolResult", toolResult("call-A",...))]` (no user msg) → span start 0 end 2 → also in-span (currentTurnSpan: no user → start 0). To make an EARLIER-turn match: `[user("u0"), toolResult("call-A"), user("u1"), toolResult("call-B")]` then target call-A → resolves only before last user msg → hard refusal. No-match-anywhere: target `"call-ZZZ"` with any fixture.

## Existing content-arm rows that must MOVE (per R5 / item (e))
- `it.each` structural-invalid table ~:248-264 — two `by_content_includes` rows → replaced by typebox schema-rejection test.
- Pinning block ~:385-392 content-arm sub-block → deleted (schema-rejected upstream).
- E8 persist ~:459-468 (ZZZ-NOT-PRESENT content arm) → replaced with a well-formed no-in-turn-match → HARD REFUSAL (v2.0), no persist.
- Orientation ~:750-756 (`by_content_includes:"not-present-anywhere"`) → replaced with advisory-throw (throwOnBuildContextEntries) path asserting persist + Matched: no + line with ~0.
- Type test ~:620-624 — shrink to exactly 2 arms via expectTypeOf.

## Host-pipeline schema rejection (from test/prepare-args.test.ts:42-54)
```ts
import { Compile } from "typebox/compile";
import * as Value from "typebox/value"; // actual import in file: see test/prepare-args.test.ts:2x
function hostPipelinePasses(params, args, prepareArguments?) {
  let prepared = structuredClone(args);
  if (typeof prepareArguments === "function") prepared = prepareArguments(prepared);
  Value.Convert(params, prepared);
  return Compile(params).Check(prepared);
}
```
C13: host validates BEFORE execute — so `{by_content_includes:'x'}` must FAIL `hostPipelinePasses(ShrinkParams, args, tool.prepareArguments)`. Note: prepareObjectArgs only coerces STRING values; an already-object content arm passes through untouched → Check rejects it. Also assert proper 2-arm objects pass.

## Contract from P1.M2.T1.S2 (parallel, assume landed)
- `resolveTargetEntryId` uses `currentTurnSpan` + 3-arg `resolveShrinkTarget`; returns `{entryId, origTokens, index?}`.
- Hard refusal text (exact, refusal() adds "Mulligan: refused — " prefix + "."): `that result is from a previous turn; only this turn's tool calls can be shrunk`.
- Advisory throw → persists, `Matched: no`, orientation line `~0`.
- Schema (P1.M2.T1.S1): 2-arm `ShrinkParams` union (`by_tool_call_id` | `by_tool_name`+occurrence).

## Commands
- `npm run typecheck` (tsc --noEmit), `npx vitest run test/tools/shrink.test.ts`, full `npm test`.