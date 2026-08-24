# Research notes — P1.M1.T1.S2

Verified facts (read directly, not from memory):

- `resolveShrinkTarget` at `src/transforms.ts:771`; signature `(messages, target)`; no span today.
- `by_tool_call_id` arm: `:775-781` (full-list scan, `role === "toolResult"`, `toolCallId === id`).
- `by_tool_name` + occurrence arm: `:784-797`; `occurrence === "first"` → return immediately; anything else → last (GOTCHA #6).
- `by_content_includes` branch: `:800-807` — the deletion target. Sole runtime use of `stringifyContent` is line 806; other mentions are JSDoc (:758) and the definition (`:1065-1074`). After branch deletion, `stringifyContent` is dead → delete.
- `resolveLastTurn` last-user scan precedent: `:331-337` — `isRecord(m) && readOwn(m, "role") === "user"`, last index wins; non-array → `{ remove: [] }`; never throws (E13).
- Caller inventory (grep, non-test): `src/tools/cancel.ts:268, :285`; `src/tools/shrink.ts:267`; `src/transforms.ts:986` (applyShrink live path) and a second filterPipeline call ~`:1546` (resolveLastTurn at 1476 nearby). All 2-arg — optional third param keeps them compiling.
- Tests: `test/transforms.test.ts:1115` mentions stringifyContent in a COMMENT only. `grep by_content_includes test/` needed at implementation time to find content-arm expectations to flip to null.
- Commands: `npm run typecheck` (tsc --noEmit), `npm run test` / `npx vitest run`.
- Parallel predecessor S1 (PRP read in full): delivers 2-arm `ShrinkTarget` write type + `ShrinkTargetRead` read union with deprecated legacy content arm; resolver param widened to `ShrinkTargetRead` but content branch KEPT until S2 (this item).
- Spec anchors: spec/06 §5 v2.0 (turnSpan = current turn's tool-result span; out-of-span → null; `by_content_includes` no longer exists), spec/04 §4 marker:shrink (v2.0 note), PRD §2 two-bound ruling (tool = current turn; filter = marker's issuing-turn span).