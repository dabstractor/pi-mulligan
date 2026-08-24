# Test Suite Recon — pi-mulligan v2.0 delta (READ-ONLY)

## 1. Harness conventions

- **Framework: vitest** (`vitest ^1`, `package.json:52`). NOT node:test.
- Scripts (`package.json:55-60`):
  - `"test": "vitest run"`
  - `"smoke": "node test/integration/run-smoke.mjs"` (no `test:smoke` — the smoke script is `smoke`)
  - `"typecheck": "tsc --noEmit"`; `prepublishOnly` runs typecheck + tests.
- Assertion style: vitest `describe/it/expect/expectTypeOf/beforeEach/afterEach` (e.g. `test/tools/shrink.test.ts:29`, `test/banner.test.ts:22`). Heavy use of `it.each` tables and `toMatchInlineSnapshot`.
- **House idiom**: hand-rolled fakes, NO `vi.fn()`; `.js` import paths; `clearAll()` from `src/runtime.js` before+after each test to reset the shared nextSeq map (GOTCHA #8) — `test/tools/shrink.test.ts:44-46`.
- Fake pattern (`test/tools/shrink.test.ts:55-116`):
  - `makePi({throwOnAppend})` → captures `appendEntry(customType, data)` into `appended[]`; casts to `ExtensionAPI`.
  - `makeCtx({sessionId, leafId, contextEntries, throwOnGetSessionId, throwOnGetLeafId, throwOnBuildContextEntries, hasUI})` → scripts `getSessionId`/`getLeafId`/`buildContextEntries` (the shrink best-effort snapshot source) and records `ctx.ui.notify`.
  - `run(pi, ctx, args)` helper wraps `tool.execute("id", args, undefined, undefined, ctx)`.
- `test/filter.test.ts` mocks `transforms.js` via `vi.mock` with a scriptable `filterPipeline` stub (`test/filter.test.ts:3-18`) to isolate the context handler.
- **Smoke driver**: `test/integration/run-smoke.mjs` (plain Node ESM). Per scenario it spawns `pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p "/mulligan_smoke <scenario>" -p "Reply with exactly: OK"` (first `-p` runs the deterministic setup command; second triggers the observing model turn so the `context` filter fires). Parses the smoke JSONL log (primary assertions) + session JSONL. Unique `RUN_ID` per invocation for idempotency (`run-smoke.mjs:1-30`, scenario list lines ~30-50). Scenarios: F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7, E11, E12, E15, E20.
- `smoke.ts` scenario dispatch (`driveScenario`, test/integration/smoke.ts ~162-220+): recipes call the REAL tools (`makeShrinkTool(pi)` etc.) with `tool.execute("id", args, undefined, undefined, ctx)`; canary constants must be byte-identical to `run-smoke.mjs` (GOTCHA #8).

## 2. Every `by_content_includes` occurrence in tests

### test/transforms.test.ts (13)
- 1032 — "not-present needle → applyShrink no-op returns SAME ref" (`applyShrink(msgs, {target:{by_content_includes:"not-present-anywhere"}})` → `toBe(msgs)`).
- 1067-1074 — "by_content_includes → FIRST message (any role) whose stringified content includes the substring".
- 1075-1079 — "spec/08 E19 — matches a NON-toolResult (user) → content replaced, role PRESERVED".
- 1092 — resolveShrinkTarget direct: `by_content_includes:"u"` → 0 (user stringified includes "u").
- 1093 — resolveShrinkTarget: empty needle → null (BUG-004).
- 1116-1117 — defensive throwing-Proxy trap message: empty needle → null, no throw (BUG-004).
- 1120 — `applyShrink` with needle "keep" doesn't throw on trap message.
- 1121 — BUG-004: empty needle → applyShrink is a NO-OP (returns same/identity result).
- 1124-1125 — `applyShrink(trapArr, by_content_includes:"")` → no throw, same ref (no-op).

### test/tools/shrink.test.ts (11)
- 253 — it.each structural-invalid row: `["by_content_includes empty", { by_content_includes: "" }]`.
- 254 — row: `["by_content_includes whitespace", { by_content_includes: " \t " }]`.
- 344-356 — "matched:yes on a message whose content includes the substring" (ENOSPC toolResult; persistence payload asserted).
- 385-392 — best-effort match pinning block: "by_content_includes → the first matching entry" → `pinnedEntryId` = that entry id.
- 459-468 — "no-match: target substring not present → matched:no + STILL persists" (ZZZ-NOT-PRESENT).
- 620-624 — type test: `ShrinkArgs.target` includes the `{ by_content_includes: string }` arm (expectTypeOf union).
- 750-756 — "matched:no STILL persists (E8) → the marker IS ACTIVE → orientation line present with ~0" (`by_content_includes:"not-present-anywhere"`).

### test/edge-cases.test.ts (7 — E19 block, describe at 992)
- 992 — "applyShrink on a USER message → role 'user' preserved, content replaced" (needle "hello").
- 1001 — same on a text ASSISTANT message (needle "note").
- 1013 — "filterPipeline pairing is unaffected (no toolResult involved)": marker `shrinks:[{seq:1,target:{by_content_includes:"note"},replacement:"SUMMARY"}]` applied through `filterPipeline`; pairing invariant + shrunk assistant asserted.
- 1030 — "applyShrink does NOT mutate its input array (original survives — the hard invariant)" (needle "hello").
- 1040 — "input array still holds the original content; only the returned copy is replaced".
- 1052-1055 — "applyShrink at index i leaves every OTHER index's original intact (multi-message)" (needle "shrink me" unique to index 1).

### test/tools/cancel.test.ts (7)
- 466 — inside the verbatim CANCEL_DESC string assertion (description mentions by_content_includes as a hint shape).
- 658 — comment header: "Case (c): by_content_includes → most-recent covering a message with the substring".
- 660-679 — "(c) by_content_includes: a message whose content includes the substring → covering marker retired" (target ENOSPC; asserts cancel appended with targetId, `cancelled:true`).
- 681-691 — "(c-neg) by_content_includes with an absent substring → no message matches → no-op (covered in case e)" (ZZZ-NOT-PRESENT; `appended` length 0).

### test/integration/smoke.ts (4)
- 187, 196 — F-shrink-persist deterministic path: `tool.execute(..., {target:{by_content_includes: MSG_CANARY}, replacement: SHRUNK_MARKER, reason:"smoke test"})` against the session_start MSG-canary (a custom_message); asserts marker persists, substitution visible in filtered view, original stays on disk.
- 206, 213 — E19 user-message shrink: second `makeShrinkTool` execute with `{target:{by_content_includes: USER_CANARY}, replacement: USER_SHRUNK_MARKER, reason:"E19 user-message shrink (original must survive)"}` — USER_CANARY is the orchestrator's first `-p` prompt (role:"user"); distinct replacement for independent observability.

### test/markers.test.ts (2)
- 538 — type test "ShrinkTarget is the 3-arm discriminated union": `const c: ShrinkTarget = { by_content_includes: "substr" }`.
- 544 — the expectTypeOf union assertion includes `{ by_content_includes: string }` arm.

### test/prepare-args.test.ts (1)
- 151 — it.each row `['{"by_content_includes": "pclntab"}']` in "coerces every union arm from a JSON string: %s" — the JSON-string-target shim via `prepareArguments` + `hostPipelinePasses`.

### test/integration/scenarios.md
- 134 — prompt text: "…then mulligan_shrink it (by_content_includes CANARY)…" (model-driven path doc).

## 3. Helpers / fixtures / turn simulation

- Message factory helpers duplicated per file (transforms.test.ts:32-42, edge-cases.test.ts:95-101):
  - `user(text)` → `{role:"user", content: text}` (bare string content).
  - `custom(customType)` → `{role:"custom", customType, content:"x", display:true}` (notes/nudges are plain units).
  - `asst(toolCallId)` / `asstText(text)` / `result(callId)` / `toolResult(callId, toolName, text)` builders above them.
  - `summary(units)` → compact "kind:minIdx:len" assertion strings; `expectPairingInvariant(messages, units)` shared invariant checker.
- Fake session/turn: `makePi`/`makeCtx` as above (§1). In cancel/rewind tests, `makeCtx({contextEntries: [...msgEntry(...)], entries: [makeShrinkEntry(entryId, uuid, {target, seq})]})` scripts BOTH the flattened messages and the marker custom entries.
- **Turn simulation**: there is NO turn-loop harness at unit level. "Multiple user messages" are simulated by literal arrays (`[user("u0"), asst("c1"), result("c1"), user("u1"), ...]`, e.g. transforms.test.ts:1391-1399 "last_turn rewind through the pipeline…"). Time/turn windows in drift logic are simulated via `metric({deltaTokens, seq, turnIndex, ts})` and `recentMetrics` arrays (drift_nudge.test.ts:128-146, 221-260). Integration-level turns are simulated by run-smoke.mjs's two `-p` prompts per scenario.

## 4. Drift-nudge tail exact-string sites

The tail (src/notes.ts:337): ``. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.``

### test/notes.test.ts (3+)
- 396 — module const `DRIFT_TAIL = ". If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."` (shared by the renderDriftNudge describe at 465).
- 646 — inline snapshot in "representative drift-only nudge (~4.2k tokens)": full string `Previous turn added ~4.2k tokens … If wasteful, …`.
- 660 — inline snapshot "representative first-turn bloat-only nudge (null delta + 2 hits)": `Previous turn produced 2 bloated results. If wasteful, …`.
- Also: 522-534 — "the tail is FIXED and present in EVERY case" (loops 4 DriftNudgeInput cases asserting `toContain(DRIFT_TAIL)`); 418-421 pins the sibling bloat-reminder phrasing (`mulligan_rewind` if the whole call was a mistake).

### test/drift_nudge.test.ts (2 + injectNudge content test)
- 243 — inside "does NOT append the clause when the latest single-turn delta alone explains the fire (>= threshold)": `expect(content).toBe("Previous turn added ~5k tokens to your context. If wasteful, `mulligan_rewind` …")`.
- 250 — "does NOT append the clause when recentMetrics/config are omitted (back-compat…)" — same tail with `~0.8k tokens`.
- injectNudge content test: 198-204 — "produces a non-empty string content via renderDriftNudge" (checks `startsWith("Previous turn")`, no `[mulligan]` prefix — does NOT pin the tail itself).

## 5. E27 "all three anyOf arms" language

- No literal "E27" or "all three anyOf" in tests or src. Closest matches:
  - `test/prepare-args.test.ts:11` — "every `anyOf` arm fails ('must be object' ×3) and the tool call is dead on arrival" (the JSON-string-target bug rationale).
  - `test/prepare-args.test.ts:3` — "on the three object-param tools: mulligan_shrink (`target`), mulligan_cancel …".
  - `test/markers.test.ts:530-546` — "ShrinkTarget is the 3-arm discriminated union".

## 6. shrink.test.ts structural-invalid content rows (lines 253-254)

```ts
["by_content_includes empty", { by_content_includes: "" }],
["by_content_includes whitespace", { by_content_includes: " \t " }],
```
(inside `it.each` at 248-264, describe "mulligan_shrink — structurally-impossible-target refusal (spec/05 §2 step3; GOTCHA #7)", refusing with "Mulligan: refused — target discriminator must be non-empty.", `appended` length 0, `details {}`.)

## 7. Shrink persistence-across-turns in filterPipeline tests

- **No existing test where a by_content_includes (or any) shrink marker is shown re-applying after a NEW user message is appended to the messages array.** Shrink-in-pipeline tests:
  - transforms.test.ts:1376-1391 "shrinks compose through the pipeline oldest-first (two shrinks → both applied)" — single user("u0"), two tool-call shrinks, both substituted in one filterPipeline pass.
  - transforms.test.ts:1434-1454 "FINDING 3 — PINNED shrink does NOT drift to a new later message as the session grows (moving-target fix at the pipeline level)" — messages `[user, asst, readOld, asst, readNew]` (session grew), marker still applies to the pinned OLD read, NEW read untouched. This is the closest "session grew and the marker still applies" test (pinned by entry id, not by_content_includes; growth is tool messages, no new user message).
  - transforms.test.ts:1456-1466 "FINDING 3 — UNPINNED shrink (no pinnedEntryId) still LIVE-resolves (backward compat)".
  - edge-cases.test.ts:1010-1024 — E19 shrink through filterPipeline (single user message).
  - Integration: F-shrink-persist in smoke.ts (187-196) proves persistence across turns end-to-end (second `-p` turn observes the substitution).

## Start Here
`test/tools/shrink.test.ts` (fakes at 55-116, structural table at 248-264, match/persist at 344-470) — it defines the house tool-test idiom that a v2.0 delta will extend; then `test/edge-cases.test.ts:985-1060` (E19 block) and `test/integration/smoke.ts:180-220` (F-shrink-persist + E19 user shrink).