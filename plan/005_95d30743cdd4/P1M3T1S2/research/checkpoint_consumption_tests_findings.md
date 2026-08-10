# Research Notes — P1.M3.T1.S2 (Tests for checkpoint consumption)

**Task**: TDD tests proving that a successful checkpoint-granularity rewind **consumes** the checkpoint
(its label is cleared via the S1 hook in `src/tools/rewind.ts`), so it drops from `mulligan_audit`, a
second rewind to the same name refuses "not found", re-creating works, an unconsumed checkpoint persists,
and a `setLabel` throw during consumption is swallowed (E13).

---

## A. The five contract scenarios (from the work item, step 3) → test mapping

| # | Contract scenario | How to drive it | Pass criteria |
|---|---|---|---|
| a | After a successful checkpoint rewind, `mulligan_audit` no longer lists it active | `run()` a checkpoint rewind with `entries:[checkpointLabelEntry("anchor")]`; then call `listCheckpoints(consumedEntries)` where `consumedEntries` simulates the post-clear state (label removed/undefined) | `listCheckpoints` does NOT include "anchor" |
| b | A second checkpoint rewind to the consumed name refuses "not found" | `run()` a second rewind against a fresh ctx whose `entries` simulates the consumed state (no label entry) | firstText contains `Mulligan: refused — checkpoint 'anchor' not found on this branch.` |
| c | Re-creating (`mulligan_checkpoint("x")` again) sets a fresh label; a subsequent rewind works | (this is the `setCheckpoint` SET path — already tested in checkpoint.test.ts; S2 asserts the ROUND-TRIP: after consumption, if a new label is present, rewind succeeds again) | after re-adding `checkpointLabelEntry("x")`, a rewind succeeds + clears the new label |
| d | A checkpoint that is NEVER consumed persists (unchanged behavior) | a `last_turn` rewind leaves checkpoint "persist" in entries; `listCheckpoints(entries)` still includes it | `listCheckpoints` includes the name |
| e | If `pi.setLabel` throws during consumption, the rewind still succeeds (E13) | `makePi({throwOnSetLabel:true})`; `run()` a checkpoint rewind | firstText contains `Mulligan: rewound checkpoint.` (success), NOT a refusal |

## B. The CRITICAL test-fake mechanic (the gotcha that determines test structure)

**`makeCtx().entries` is STATIC — the fake does NOT mutate it when `pi.setLabel` is called.**
`setLabel` only pushes to `makePi().labels`; it does NOT edit `ctx.sessionManager.getEntries()`.
`getEntries()` returns the SAME array reference on every call.

**Consequence for scenario (b)**: to test "a second rewind refuses not found", I cannot call `run()`
twice against the same ctx and expect the second to see the cleared label. Instead I construct a
**fresh ctx** for the second call whose `entries` array **simulates the consumed state** (the label
entry removed, or its `label` set to `undefined`). This mirrors how the real session would look after
the clear (Pi removes/undefines the label). Two valid simulations:
1. **Omit the label entry entirely** — `entries: []` (or entries without the checkpoint label). This is
   the most faithful (Pi removes cleared labels).
2. **Keep the entry but set `label: undefined`** — `{ type:"label", targetId:"leaf-1", label:undefined }`.
   This tests the `checkpointExists` guard's `typeof label !== "string"` path directly.

I'll use approach (1) for scenario (b) (clearest "not found") and approach (2) is implicitly covered by
the `listCheckpoints` pure-function test in scenario (a) (which I can call with both shapes).

**For scenario (a)**: `listCheckpoints` is a PURE exported function (`src/tools/audit.ts:332`) taking
`unknown[]`. I import it directly and assert on a hand-constructed consumed-state array — no need to
thread it through the tool. This is the cleanest assertion that "mulligan_audit no longer lists it".

## C. Where these tests live

**`test/tools/rewind.test.ts`** (NOT `checkpoint.test.ts`). Reasoning:
- All five scenarios are about what happens to a checkpoint AFTER a `mulligan_rewind` consumes it →
  the rewind tool is the actor under test.
- `rewind.test.ts` already has: the checkpoint-rewind success path (line ~340), the `checkpointLabelEntry`
  fixture (line ~192), `makePi().labels` (captures setLabel including undefined), `makeCtx({entries})`,
  `run()`, `firstText()`, `VALID_NOTE`, and the exact refusal-text assertion pattern (line 334:
  `"Mulligan: refused — checkpoint 'nope' not found on this branch."`).
- `checkpoint.test.ts` tests the `mulligan_checkpoint` SET path only — scenario (c)'s "re-create works"
  is the SET direction and is already covered there; S2 only needs to assert the ROUND-TRIP in rewind.test.ts.
- The contract (step 4) permits EITHER file; rewind.test.ts is the natural home.

## D. The exact assertion strings / shapes (verified against code)

- **Success text** (rewind.ts): `firstText(res)` contains `"Mulligan: rewound checkpoint."` (existing
  success test at line ~340 asserts this).
- **Refusal text** (rewind.ts `checkpointExists` refuse, line 468-469 → `refusal(reason, gran)`):
  `firstText(res)` === `"Mulligan: refused — checkpoint 'anchor' not found on this branch."` (existing
  refusal test at line 334 confirms this exact format with em-dash U+2014 + trailing period).
- **labels capture** (rewind.test.ts makePi): `labels.push({ entryId, label })` — captures EVERY
  setLabel call INCLUDING the `undefined` clear. After a checkpoint rewind consuming "anchor" on
  targetId "leaf-1", `labels` contains `{ entryId: "leaf-1", label: undefined }`. (The `checkpointLabelEntry`
  default targetId is "leaf-1".)
- **Non-checkpoint rewind** (`last_turn`/`last_tool_call_group`): `labels` stays EMPTY (the S1 hook is
  guarded by `if (granularity === "checkpoint")`).
- **listCheckpoints** (audit.ts:332, EXPORTED): `import { listCheckpoints } from "../../src/tools/audit.js"`.
  Takes `unknown[]`, returns `string[]` of checkpoint names (prefix stripped). Skips entries where
  `typeof label !== "string"`. Pure — no ctx needed.

## E. Scenario (e) — the E13 setLabel-throw test

`makePi({ throwOnSetLabel: true })` makes `setLabel` throw `"setLabel boom"`. The S1 hook wraps the
consumption in its OWN try/catch that swallows. So a checkpoint rewind with a throwing setLabel:
- STILL returns success (`firstText` contains `"Mulligan: rewound checkpoint."`).
- The marker is still appended (`appended` has length 1).
- Does NOT return a refusal / "unexpected error" (that would mean the throw escaped the own catch and
  hit rewindExecute's site-9 outer catch — a bug).
- `labels` is EMPTY (the throw happened before the push — `throwOnSetLabel` throws before `labels.push`).

This is the single most important regression test: it proves the E13 own-try/catch is present and
correctly scoped. Without it, a future refactor that removes the inner catch would silently invert
success→failure and no other test would catch it.

## F. Scenario (c) — re-create round-trip (the subtlety)

The contract says "Re-creating (mulligan_checkpoint('x') again) sets a fresh label; a subsequent rewind
works." The SET direction (`setCheckpoint` in markers.ts → `pi.setLabel`) is already unit-tested in
checkpoint.test.ts. For S2 (rewind.test.ts), I assert the **round-trip from the rewind side**: after
consuming "x", if I construct a ctx whose entries contain a FRESH `checkpointLabelEntry("x")` (simulating
the user/agent having re-run `mulligan_checkpoint("x")`), a rewind to "x" succeeds again and clears the
new label. This proves consumption is not permanent — a same-name checkpoint can be re-targeted.

## G. Scenario (d) — unconsumed persistence (unchanged-behavior guard)

A `last_turn` or `last_tool_call_group` rewind must NOT consume any checkpoint. After such a rewind,
`listCheckpoints(entries)` still includes the checkpoint name. This guards against the S1 hook
accidentally firing on non-checkpoint granularities (the `if (granularity === "checkpoint")` guard).
Drive: `entries: [checkpointLabelEntry("persist"), rewindEntry(1)]`, run a `last_turn` rewind, assert
`labels` is empty AND `listCheckpoints(entries)` includes "persist". (The entries array is unchanged by
the rewind since the fake is static — so listCheckpoints naturally still sees the label.)

## H. Test-fixture reuse (no new helpers needed)

All five scenarios reuse the existing rewind.test.ts fixtures — NO new helper functions, NO harness
change:
- `checkpointLabelEntry(name, targetId="leaf-1")` — the LabelEntry fixture.
- `makePi()` / `makePi({throwOnSetLabel:true})` — the setLabel-capturing fake.
- `makeCtx({entries, contextEntries})` — the ctx fake.
- `run(pi, ctx, params)` — the tool invocation helper.
- `firstText(res)` — extract the text block.
- `VALID_NOTE` — the canonical note.
- `msgEntry(user("u"))` — minimal contextEntries so resolveCheckpoint is a no-op.
- `listCheckpoints` (imported from audit.ts) — the pure assertion target for scenarios (a)/(d).

## I. Validation gates (confirmed green at research time)

- `npm run typecheck` (= `tsc --noEmit`): exits 0. New tests are pure additions to a .test.ts file;
  they use already-typed fakes/fixtures, so they typecheck cleanly.
- `npx vitest run test/tools/rewind.test.ts`: the new tests must pass (S1 hook assumed landed per the
  contract). If S1 is NOT yet landed, scenarios (a)/(b)/(c)/(e) will FAIL (the consumption won't happen)
  — that's the TDD signal. Scenario (d) passes regardless.
- `npx vitest run`: full suite green. Test count rises by 5 (or however many `it` blocks S2 adds).
- Scope guard: `git status --short` shows only `test/tools/rewind.test.ts` modified (no src/ changes).

## J. Cross-references used

- `test/tools/rewind.test.ts` — the test file to extend (fakes, fixtures, helpers, existing checkpoint tests).
- `src/tools/rewind.ts` — the S1 hook (assumed landed); `checkpointExists` refusal text (line 469).
- `src/tools/audit.ts:332` — `listCheckpoints` (pure exported function; the scenario-a/d assertion target).
- `src/tools/checkpoint.ts` / `src/markers.ts` — the SET direction (re-create; already tested in checkpoint.test.ts).
- `spec/05-tools.md §3 step 5` — the "Auto-expiry on consumption (REQUIRED)" spec authority.
- `spec/10-verification-strategy.md §2.1 F-checkpoint` — the integration-scenario mirror (audit no longer
  lists it; second rewind refuses unless re-created).
- S1 PRP (plan/005_95d30743cdd4/P1M3T1S1/PRP.md) — the consumption-hook contract this task tests against.
- architecture/m3_checkpoint_expiry.md — the effect table (downstream no-edit proof).