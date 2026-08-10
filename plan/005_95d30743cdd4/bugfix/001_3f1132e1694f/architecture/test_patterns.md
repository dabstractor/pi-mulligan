# Test Patterns — pi-mulligan Bug Fix Reference

## Overview

This document captures the test conventions used across the pi-mulligan test suite so that bug-fix
subtasks can follow the exact same patterns. Findings are drawn from a close read of:

- `test/tools/rewind.test.ts` (1287 lines)
- `test/config.test.ts` (~450 lines)
- `test/transforms.test.ts` (~2000+ lines)
- `test/tools/audit.test.ts` (~980 lines)

---

## 1. Test Framework & House Idiom

**Framework**: vitest (`import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest"`)

**House conventions (consistent across ALL test files)**:
- **Hand-rolled fakes** — NO `vi.fn()`. Fakes are plain JS objects with methods that push to capture arrays. The rewind test file explicitly states: "hand-rolled `makePi()`/`makeCtx()` fakes (NO vi.fn())".
- **`.js` import paths** — all imports from `../../src/` use `.js` extensions (ESM/bundler resolution).
- **`expectTypeOf`** for type-level assertions (e.g., `expectTypeOf(tool).toEqualTypeOf<ToolDefinition<...>>()`).
- **`clearAll()` from runtime.ts** called in `beforeEach` AND `afterEach` to reset the module-scoped runtime Map (nextSeq mutates shared state).
- **`setConfig(undefined)`** called in `beforeEach`/`afterEach` of tool tests to reset the config cache to validated DEFAULT_CONFIG (prevents poisoned cache leaking between tests).

---

## 2. test/tools/rewind.test.ts — Checkpoint & Tool Harness Patterns

### Fake Construction

#### `makePi(opts)` — fake ExtensionAPI
- Returns `{ appended, sent, labels, pi }` where:
  - `appended`: array of `{ customType, data }` captured from `pi.appendEntry(customType, data)`
  - `sent`: array of `{ customType, content, display, details, options }` captured from `pi.sendMessage(...)`
  - `labels`: array of `{ entryId, label }` captured from `pi.setLabel(entryId, label)`
  - `pi`: cast as `unknown as ExtensionAPI`
- Accepts `throwOn*` options: `{ throwOnAppend?, throwOnSendMessage?, throwOnSetLabel? }`

#### `makeCtx(opts)` — fake ExtensionContext
- Returns `{ ctx }` cast as `unknown as ExtensionContext`
- Scripts `sessionManager` with:
  - `getSessionId()` → `opts.sessionId ?? "s1"`
  - `getLeafId()` → `opts.leafId ?? "leaf-1"` (the marker entry id capture)
  - `getEntries()` → `opts.entries ?? []` (raw session entries)
  - `getLabel(id)` → **latest-wins label map**: walks `entries` keeping the LAST `label` per `targetId`. Optional `opts.labels` override map forces the post-consumption state directly.
  - `getBranch()` → `opts.branch ?? []`
  - `buildContextEntries()` → `opts.contextEntries ?? []`
- `throwOn*` flags: `throwOnGetEntries`, `throwOnGetBranch`, `throwOnBuildContext`, `throwOnGetLeafId`
- Optional `contextUsage` (attaches `getContextUsage()` → `{ contextWindow }`)

### Naming Convention
- `describe("mulligan_rewind — <topic> (spec ref)")` — each describe block references the spec section
- `it("(a) <description>", ...)` — lettered sub-cases within a describe (a, b, c, d, ...)
- Regression tests: `it("(f) [regression 1a] <description>")` — tagged with regression + issue number

### Helper Functions
- `run(pi, ctx, params, toolCallId?)` — invokes `tool.execute(toolCallId, params, undefined, undefined, ctx)`
- `firstText(res)` — extracts `.text` from the first content block (narrows TextContent)
- `rewindEntry(seq)` — builds a `{ type:"custom", customType:"mulligan:rewind", data:{ seq } }` entry
- `metricEntry(turnIndex, seq?)` — builds a `mulligan:turn-metric` entry
- `checkpointLabelEntry(name, targetId?)` — builds a `{ type:"label", targetId, label:"mulligan:checkpoint:<name>" }` entry (default targetId `"leaf-1"`)
- `msgEntry(message)` — builds a `{ type:"message", id:"e-<random>", message }` entry
- `msgEntryId(id, message)` — like msgEntry but with a DETERMINISTIC id (for hideEntryIds assertions)
- Message builders: `asst(...callIds)`, `result(toolCallId)`, `asstWrite(callId, file_path)`, `asstBash(callId, command)`, `user(text)`

### Checkpoint Consumption Test Cases (spec/05 §3 step 5)
Located in `describe("mulligan_rewind — checkpoint consumption (spec/05 §3 step 5)")`:
- **(a)** successful checkpoint rewind clears the label → `listCheckpoints` drops it
- **(b)** second rewind to consumed name refuses "not found"
- **(c)** re-creating the checkpoint sets a fresh label; subsequent rewind works
- **(d)** non-checkpoint rewind does NOT consume labels
- **(e)** setLabel throw during consumption is swallowed (E13) — rewind still succeeds
- **(f)** [regression 1a] clears label when it's NOT the first entry (multi-entry session)
- **(g)** [regression 1b] listCheckpoints drops consumed checkpoint; second rewind refuses
- **(h)** [regression 1b] re-set checkpoint (set, clear, set-again) is active again

**KEY GOTCHA**: The fake's `entries` array is STATIC (not mutated by `setLabel`). So multi-step scenarios construct FRESH ctx objects that simulate the post-consumption / post-re-create state.

**IMPORTANT for BUG-001 fix**: All existing checkpoint tests use `targetId: "leaf-1"` (single target). The bug is that when the same name is set on TWO DIFFERENT targets, the consumption loop clears only the first one found. A regression test needs `checkpointLabelEntry("x", "targetA")` and `checkpointLabelEntry("x", "targetB")` — two entries with the same label string but different targetIds.

---

## 3. test/config.test.ts — Config Validation Patterns

### Fake Construction
- No fakes needed — `validateConfig(raw)` and `setConfig(raw)` are pure functions tested directly.
- `vi.spyOn(console, "warn")` used to assert warn behavior on invalid-present values.
- Pattern: `const warn = vi.spyOn(console, "warn").mockImplementation(() => {}); try { ... } finally { warn.mockRestore(); }`

### Naming Convention
- `describe("<field> (<task ref> / spec ref)")` — e.g., `describe("shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)")`
- Lettered sub-cases: `it("(a) passes through valid values", ...)` through `(h)` or more
- `it("(type) <field> is a required number (type-level)")` for expectTypeOf assertions

### Integer Validation Pattern (precedent for BUG-002/003)
The existing test for `maxRetriesPerPrompt` (the sibling knob that ALREADY has the `Math.floor(n) >= 1` guard) is in:
```
describe("rewind.maxRetriesPerPrompt & rewind.abortContextFraction (P4.M1.T3.S1 / spec/09 §4, spec/08 E22)")
  it("(d) maxRetriesPerPrompt: 0 → 5; 2.7 → 2 (Math.floor); 'x' → 5")
```
This shows: `0 → default` (floor(0)=0 < 1 → default), `2.7 → 2` (floor(2.7)=2 ≥ 1 → kept), `'x' → default` (non-number).

The shrink.maxActive/staleAfterFires tests in:
```
describe("shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)")
```
Test invalid values `[0, -1, NaN, "abc", Infinity]` but do NOT test fractions like `0.5` — confirming BUG-003's gap.

The driftWindowTurns tests in:
```
describe("nudges.driftWindowTurns & nudges.highWaterFraction ...")
  it("(c) driftWindowTurns is FLOORED to an integer (5.7 → 5)")
  it("(d) driftWindowTurns invalid ∈ {0,-1,NaN,'abc',Infinity} → 3 + exactly 1 warn")
```
Tests `5.7 → 5` (floor works) but does NOT test `0.5 → 0` (the BUG-002 gap where floor(0.5)=0 passes the `>0` check but floors to 0, creating a degenerate window).

### Pattern for Adding Integer-Guard Tests
Follow the maxRetriesPerPrompt precedent: test that `0.5` and other fractions that floor to 0 fall back to the default, not 0. Use the `vi.spyOn(console, "warn")` pattern to assert no warn on valid values and exactly 1 warn on invalid ones.

---

## 4. test/transforms.test.ts — Pure Transform Patterns

### Fake Construction
- **No fakes at all** — transforms.ts is Pi-free. Tests construct plain `MessageLike[]` arrays directly.
- Message builder helpers (module-local, at top of file): `user(text)`, `asst(...callIds)`, `result(toolCallId)`, `custom(customType)`.

### Naming Convention
- `describe("<function> — spec/10 §1.N PINNED contract")` for contract tests
- `describe("<function> — <topic> (spec ref)")` for feature/edge-case tests
- `describe("<function> — defensive (NEVER throws — spec/08 E13)")` for defensive tests
- `describe("<function> — purity, ordering, types")` for meta tests

### resolveShrinkTarget Tests
Located within `describe("applyShrink — spec/06 §5")` block (tested via applyShrink, not directly):
- `by_content_includes` → FIRST message (any role) whose stringified content includes substring
- spec/08 E19 → matches a NON-toolResult (user) → content replaced, role PRESERVED
- Defensive: throwing-Proxy with empty needle does NOT throw
- `resolveShrinkTarget(msgs, { by_content_includes: "u" })` → returns 0 (user("u") includes "u")

**IMPORTANT for BUG-004**: The test at line 1140 explicitly tests `resolveShrinkTarget([trap], { by_content_includes: "" })` — it only asserts it doesn't throw, NOT that it returns null. The bug is that empty needle matches the FIRST message. A fix test should add `expect(resolveShrinkTarget(msgs, { by_content_includes: "" })).toBeNull()`.

### resolveLastTurn Tests
- PINNED contract tests: default removes after last user; nuclear removes last user too; single-user nuclear → `{ remove: [] }`
- "the rewind's OWN unit survives" — excludeToolCallId keeps the rewind's own toolGroup
- "mulligan:* notes survive at the tail"
- "no-op cases" — no user message → `{ remove: [] }`
- "nuclear edge cases" — first-user protection
- "defensive (NEVER throws)" — non-array messages, throwing-Proxy messages

---

## 5. test/tools/audit.test.ts — Audit Tool Patterns

### Fake Construction

#### `makePi()` — NO-OP spy ExtensionAPI
- The audit NEVER calls pi.* (no factory — `auditTool` is a plain `export const`)
- Still captures appendEntry/sendMessage/setLabel to arrays to PROVE nothing is persisted

#### `makeCtx(opts)` — fake ExtensionContext with call tracking
- Returns `{ calls, ctx }` where `calls: string[]` tracks the ORDER of sessionManager calls
- `getContextUsage` is INTENTIONALLY ABSENT (D5: audit must NEVER call it)
- Scripts: `sessionId`, `contextEntries`, `entries`, `branch` with `throwOn*` flags

### Naming Convention
- `describe("mulligan_audit — <topic> (spec ref)")`
- Lettered sub-cases (a) through (k) per the PRP Task 2 case list

### Helper Functions
- `run(ctx, params?, toolCallId?)` — invokes `auditTool.execute(toolCallId, params, undefined, undefined, ctx)`
- `firstText(res)` — same as rewind
- `toolResult(toolCallId, toolName, text)`, `userMsg(text)`, `assistantMsg(content)`
- `msgEntry(role, extra?)` — module-level `entrySeq` counter for deterministic ids
- `checkpointEntry(name, targetId?)` — default targetId is `leaf-${name}` (DISTINCT per checkpoint)
- `rewindMarkerEntry(granularity, seq)`, `shrinkMarkerEntry(seq)`, `cancelMarkerEntry(targetId)`
- `kbText(kb)` — string of ~KB of ASCII text for bloat flag tests

### config.enabled Patterns
**IMPORTANT for BUG-005**: The audit test does NOT test `config.enabled === false`. There is no test that calls audit when the extension is disabled. The `setConfig({})` in `beforeEach` uses defaults (enabled: true). Adding a test for the disabled case would follow the existing pattern:
```ts
it("when config.enabled === false, audit reports the unfiltered view", async () => {
  setConfig({ enabled: false });
  const { ctx } = makeCtx({ contextEntries: [...] });
  const res = await run(ctx, {});
  // assert behavior per the fix decision
});
```

### D5 Guard Testing Pattern
The D5 guard is tested by asserting `getContextUsage` is NOT in the tracked `calls` array:
```ts
expect(calls).not.toContain("getContextUsage");
```

---

## Summary: Key Patterns for Bug Fix Subtasks

| Bug | Test File | Pattern to Follow | Key Gap in Existing Tests |
|-----|-----------|-------------------|--------------------------|
| BUG-001 | rewind.test.ts | Checkpoint consumption tests (a)-(h); use two checkpointLabelEntry with different targetIds | All tests use single targetId "leaf-1" |
| BUG-002 | config.test.ts | driftWindowTurns test (c)/(d); add 0.5 test | Only tests 5.7→5, not 0.5→0 |
| BUG-003 | config.test.ts | shrink.maxActive test (e); add fraction tests | Tests [0,-1,NaN,...] but not 0.5 |
| BUG-004 | transforms.test.ts | resolveShrinkTarget/applyShrink tests; add empty-needle guard | Line 1140 tests empty needle but only for no-throw, not null return |
| BUG-005 | audit.test.ts | D5/cached/fallback tests; add config.enabled=false test | No disabled-state test exists |
| BUG-006 | rewind.test.ts | resolveLastTurn nuclear tests; add tool-level refusal test | Tool persists no-op marker instead of refusing |