---
name: "P1.M4.T1.S3 — Integration smoke v2.0: F-shrink-persist current-turn retarget; E19 user-message case replaced; run-smoke.mjs + scenarios.md synced"
description: Rework test/integration/smoke.ts F-shrink-persist + E19 to v2.0 current-turn semantics (real mulligan_smoke_big toolResult target + refusal-path variant), sync run-smoke.mjs canaries/assertions/prompts and scenarios.md, leaving zero by_content_includes occurrences under test/integration/.
---

## Goal

**Feature Goal**: `npm run smoke` passes a rewritten F-shrink-persist that exercises the v2.0 current-turn shrink semantics end-to-end (in-span match against a REAL current-turn toolResult → pinned marker → substitution persists on the next turn; original stays on disk) plus a refusal-path variant replacing the deleted E19 user-message case; `grep -rn by_content_includes test/integration/` returns 0.

**Deliverable**: Modified `test/integration/smoke.ts`, `test/integration/run-smoke.mjs`, `test/integration/scenarios.md` — nothing else.

**Success Definition**: The grep gate is 0 across `test/integration/`; `npm run smoke` is green for F-shrink-persist (and all untouched scenarios still green); `npm run typecheck` clean; `git status` shows only the three files.

## Why

- v2.0 removed the content-substring arm (P1.M1.T1.S1) and hard-refuses any target outside the current turn's tool-result span (P1.M2.T1.S2). The smoke still drives a `by_content_includes` cast against the session-start custom_message and a user-message shrink — both now inexpressible/refusing. This is the integration-tier leg of the R5 reconciliation sweep (S1 = unit files, S2 = tools files, THIS = integration files).
- The persistence assertion (substitution visible on the observing turn, original on disk) is the end-to-end mirror of the P1.M1.T3.S2 unit regression — the only place the "in-span shrink keeps applying after user message N+1" invariant is proven against the REAL filter + REAL session JSONL.

## What

### Design ruling (why this flow works — verified, see research/notes.md §1–3)

1. pi dispatches `-p "/mulligan_smoke X"` as a COMMAND that bypasses the agent loop and is NOT persisted as a user message (docs/extensions.md ~:287; proven by F-rewind-core's seed flow asserting K≥1 at command time). Therefore at command dispatch, `currentTurnSpan` = everything after the last REAL user prompt.
2. A toolResult CANNOT be synthesized (ReadonlySessionManager has no mutator — smoke.ts:163). So the setup turn is a real model turn: `-p "Call the mulligan_smoke_big tool once, then reply with exactly: DONE"` commits an assistant + toolResult (RESULT_CANARY) INSIDE the current turn span.
3. The command then drives the REAL `makeShrinkTool` with the two-arm selector → in-span match → pinned marker. On the filter side the marker's issuing-turn span (last user message BEFORE the marker entry = the setup prompt) still contains that toolResult → the substitution persists on the observing `-p "Reply with exactly: OK"` turn (scope_guard_design.md §1–2 ruling).

### Success Criteria

- [ ] F-shrink-persist flow = 3 prompts: setup tool call turn → `/mulligan_smoke F-shrink-persist` (drives success shrink + refusal-variant shrink) → observing `Reply with exactly: OK`
- [ ] Success shrink target is a two-arm selector (`by_tool_name: "mulligan_smoke_big"` + `occurrence`, or `by_tool_call_id`) — NO content arm, NO `as unknown as` target cast
- [ ] Asserted: shrink NOT refused; context.fire `shrunkInContext:true` AND `resultCanaryPresent:false` on the observing fire; JSONL has `mulligan:shrink` (custom) ≥1; ORIGINAL RESULT_CANARY still on disk; §2.3 global invariants
- [ ] E19 replacement: a second in-command shrink attempt that hits the v2.0 hard-refusal path end-to-end — exact refusal text contains "refused" + "previous turn", and NO second marker is appended (JSONL `mulligan:shrink` count stays == the success count)
- [ ] USER_CANARY / USER_SHRUNK_MARKER constants, their log fields (`userCanaryPresent`, `userShrunkInContext`), their prompts and their assertions removed from BOTH smoke.ts and run-smoke.mjs
- [ ] `grep -rn by_content_includes test/integration/` → 0 (comments and md included)
- [ ] scenarios.md:134 model-driven wording updated (drop the removed arm; say by_tool_call_id / by_tool_name); F-shrink-persist section documents the new 3-prompt flow and the refusal variant
- [ ] MSG_CANARY session-start injection and `msgCanaryPresent` are KEPT (still used by F-rewind-core / F-reload / E11)

## All Needed Context

### Context Completeness Check

Someone with zero repo knowledge can implement this: the exact flow, the pi command-dispatch fact it rests on, every occurrence site (with current line numbers), the canary-sync gotcha, and the assertion set are all specified below with file:line anchors.

### Documentation & References

```yaml
- file: test/integration/smoke.ts
  why: Primary edit target — F-shrink-persist case (:186-220), canary consts (:48-56), context.fire fields (:483-491), driveScenario mechanics
  pattern: follow the F-rewind-core/F-checkpoint SEED-turn pattern (3-prompt model-driven setup + deterministic command drive) and the rewindNow() REAL-tool-call idiom
  gotcha: canary strings MUST stay byte-identical with run-smoke.mjs (GOTCHA #8); context handler MUST return void; use the REAL makeShrinkTool factory, never a reimplementation

- file: test/integration/run-smoke.mjs
  why: Sync target — assertShrinkPersist (:253-285), ASSERTERS map (:515), F-shrink-persist prompt flow special case (:529-541)
  pattern: follow assertRewindCore's !/refused/i success idiom + two-signal context.fire reads; entryIncludes/countCustom helpers for JSONL
  gotcha: model may not call the tool on a slow day — detect setup failure EXPLICITLY (JSONL must contain RESULT_CANARY) so the failure message points at the setup turn, not the shrink

- file: test/integration/scenarios.md
  why: Mode A docs ride-along — F-shrink-persist section (:121-141 incl. :134 model-driven prompt) must document the new flow
  pattern: existing "Run (deterministic)" / "Run (model-driven)" / "Expect in log" / "Expect in JSONL" / "Pass" block shape

- file: src/tools/shrink.ts
  why: READ-ONLY — ShrinkParams two-arm union, execute() contract, hard-refusal text (earlier-turn AND no-match share ONE string ~:364: "that result is from a previous turn; only this turn's tool calls can be shrunk"), success = feedback + v1.2 orientation line
  gotcha: refusal appends NOTHING; success with in-span match pins pinnedEntryId

- file: src/transforms.ts
  why: READ-ONLY — currentTurnSpan (:379) = {start: iLastUser+1, end}; resolveShrinkTarget span-bounded

- file: plan/008_1c8ca4d1826d/architecture/scope_guard_design.md
  why: The binding ruling — the filter bound is the MARKER'S ISSUING turn, stable across later prompts; explains why the substitution persists on the observing turn
  section: §1-§3

- docfile: plan/008_1c8ca4d1826d/P1M4T1S3/research/notes.md
  why: This PRP's evidence base — command-prompt-not-a-user-message proof, occurrence inventory, canary list, harness mechanics
```

### Current Codebase tree (relevant subset)

```bash
test/integration/
  smoke.ts        # 4 by_content_includes literals (:187,:196,:206,:213) + E19 log fields (:489-490)
  run-smoke.mjs   # E19 assertions (:263-277) + USER_CANARY 3-prompt flow (:529-541)
  scenarios.md    # 1 literal (:134) + F-shrink-persist section (:121-141)
src/tools/shrink.ts, src/transforms.ts  # read-only contracts
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files. All three integration files modified in place:
test/integration/smoke.ts        # F-shrink-persist: setup-toolResult turn + in-span two-arm shrink + refusal variant; E19 user case + consts removed
test/integration/run-smoke.mjs   # synced prompts/canaries/assertions for the new flow
test/integration/scenarios.md    # updated scenario docs (drop the removed arm everywhere)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL (GOTCHA #8): every canary/scenario change must be applied to BOTH smoke.ts and run-smoke.mjs,
#   byte-identically. RESULT_CANARY / SHRUNK_MARKER survive; USER_CANARY / USER_SHRUNK_MARKER are deleted from both.
# CRITICAL: the /mulligan_smoke command prompt is NOT a user message (pi command dispatch bypasses the loop) —
#   this is WHY the turn-1 toolResult is still "current turn" at command time. Do not add any -p prompt between
#   the setup turn and the command.
# CRITICAL: cannot synthesize a toolResult (no session mutator) — the setup turn MUST be model-driven; mirror
#   the SEED-turn reliability pattern ("Call the mulligan_smoke_big tool once, then reply with exactly: DONE").
#   mulligan_smoke_big is mulligan_* → bloat reminder never fires for it → no cross-talk with F-shrink-preventive.
# The shrink hard-refusal covers BOTH earlier-turn and no-in-turn-match with ONE string — a by_tool_name:"read"
#   (or a nonexistent by_tool_call_id) refusal-variant asserts the same end-to-end path.
# The context handler MUST keep returning void (observer-only; returning {messages} would override Mulligan's filter).
# Use the REAL makeShrinkTool(pi) factory (shared module); never reimplement matching.
# Smoke requires the real pi binary on PATH + a live model (npm run smoke = node test/integration/run-smoke.mjs).
# Smoke loads SECOND (-e order) → its context handler sees POST-filter messages (that's what makes
#   shrunkInContext:true + resultCanaryPresent:false a valid two-signal assertion on the observing fire).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/integration/smoke.ts — F-shrink-persist case (~:186-220)
  1a. REPLACE the first (MSG_CANARY content-arm) shrink with a two-arm in-span target:
      - PREFERRED (deterministic): { target: { by_tool_name: "mulligan_smoke_big", occurrence: "last" }, replacement: SHRUNK_MARKER, reason: "smoke test" }
      - NO cast needed — the two-arm form typechecks against ShrinkArgs; DELETE the `as unknown as Parameters<…>` wrapper.
      - Keep toolCallId "smoke-shrink-1", the try/catch, and the smokeLog("tool.shrink", …) line; add
        variant: "current-turn" to the detail so the asserter can find it.
  1b. REPLACE the E19 user-message shrink (:206-220) with the REFUSAL variant: second makeShrinkTool execute
      with toolCallId "smoke-shrink-refusal", target { by_tool_name: "read", occurrence: "last" }
      (no read call exists in the turn → same hard-refusal string as the earlier-turn case), replacement
      anything (e.g. "n/a"), reason "v2.0 refusal path (out-of-turn target)". Log via
      smokeLog("tool.shrink", "info", { variant: "refusal", text: text2.slice(0, 120) }).
      Comment: replaces the deleted E19 user-message case (spec/08 E19 is MOOT in v2.0 — a non-toolResult
      shrink is no longer expressible; PRD §E19/h2.101).
  1c. DELETE the USER_CANARY and USER_SHRUNK_MARKER consts (~:50-56) and their explanatory comment block;
      keep MSG_CANARY / RESULT_CANARY / SHRUNK_MARKER / SEED_* untouched.
  1d. In the context handler's context.fire detail (~:483-491): DELETE userCanaryPresent and
      userShrunkInContext. Keep resultCanaryPresent (it becomes an asserted field) and everything else.

Task 2: MODIFY test/integration/run-smoke.mjs — prompts + assertions
  2a. runScenario F-shrink-persist special case (~:529-541): new 3-prompt flow —
      prompts: [
        "Call the mulligan_smoke_big tool once, then reply with exactly: DONE",   # setup: real toolResult (RESULT_CANARY) in the current turn
        "/mulligan_smoke F-shrink-persist",                                       # drives success shrink + refusal variant
        "Reply with exactly: OK",                                                  # observing inference — substitution must be visible
      ]
      DELETE the USER_CANARY prompt and its comment (canary byte-sync: no USER_* strings may remain in the file).
  2b. Rewrite assertShrinkPersist (~:253-285):
      - setup guard: entryIncludes(entries, "MULLIGAN-SMOKE-RESULT-CANARY") — if false, FAIL with a message
        naming the setup turn ("model did not call mulligan_smoke_big").
      - success shrink: last line with detail.variant === "current-turn"; assert present, text NOT /refused/i.
      - refusal variant: line with detail.variant === "refusal"; assert text /refused/i AND /previous turn/i.
      - context.fire (last): shrunkInContext === true AND resultCanaryPresent === false (two-signal).
      - JSONL: countCustom(entries, "mulligan:shrink", "shrink") >= 1 AND === the number of successful
        (non-refused) shrink log lines (the refusal must append nothing — typically exactly 1);
        entryIncludes(entries, "MULLIGAN-SMOKE-RESULT-CANARY") still true (original on disk — view
        substitution, not rewrite); assertGlobalInvariants(results, entries).
      - DELETE the USER_CANARY on-disk assertion (:277) and the "BOTH variants ≥2 shrink lines" assertion (:263-264).
  2c. Sweep the file for "USER-CANARY"/"USER-SHRUNK"/E19 references in comments (:529-537) — remove/reword.

Task 3: MODIFY test/integration/scenarios.md — F-shrink-persist section (~:121-141)
  3a. Update the deterministic Run block to the 3-prompt flow (show the exact prompts).
  3b. :134 model-driven prompt: replace "…mulligan_shrink it (by_content_includes CANARY)…" with
      "…then mulligan_shrink it (by_tool_call_id of that call, or by_tool_name + occurrence)…".
  3c. Update Expect/Pass prose: add the refusal variant (v2.0: out-of-turn targets hard-refuse; the old
      user-message case is MOOT per spec/08 E19) and note the persistence assertion is the end-to-end mirror
      of the unit regression (in-span shrink keeps applying after the next user message).
  3d. grep -rn by_content_includes test/integration/ → empty.

Task 4: FULL VALIDATION
  npm run typecheck
  grep -rn by_content_includes test/integration/        # → 0 hits
  npm run smoke                                          # real pi + model; ALL scenarios green
  git status                                             # exactly the three integration files
```

### Implementation Patterns & Key Details

```typescript
// smoke.ts — the new success shrink (NO cast; two-arm target):
const tool = makeShrinkTool(pi);
const result = await tool.execute(
  "smoke-shrink-1",
  { target: { by_tool_name: "mulligan_smoke_big", occurrence: "last" }, replacement: SHRUNK_MARKER, reason: "smoke test" },
  undefined, undefined, ctx,
);
smokeLog("tool.shrink", "info", { variant: "current-turn", text: resultText(result.content as …).slice(0, 120) });

// run-smoke.mjs — refusal-variant read + two-signal fire:
const refusalLine = smoke.lines.filter((l) => l.test === "tool.shrink" && l.detail?.variant === "refusal").pop();
assert(results, "out-of-turn shrink REFUSES (v2.0)", refusalLine && /refused/i.test(refusalLine.detail?.text ?? ""), refusalLine?.detail?.text ?? "no line");
const cf = smoke.contextFires[smoke.contextFires.length - 1];
assert(results, "fire: substitution present AND original canary absent", cf?.shrunkInContext === true && cf?.resultCanaryPresent === false, JSON.stringify(cf ?? {}));
```

### Integration Points

```yaml
NONE - test/docs-only; no src/, config, package.json, or build changes.
Sibling-PRP boundary: P1.M4.T1.S2 owns test/tools/** — do not touch it; P1.M4.T1.S1 owns the four unit
test files — do not touch them. This item owns ONLY test/integration/**.
```

## Validation Loop

### Level 1: Static

```bash
npm run typecheck                              # clean
grep -rn by_content_includes test/integration/ # → 0 hits (md + comments included)
```

### Level 2: The smoke run (the item's defining OUTPUT check)

```bash
npm run smoke
# Expected: all scenarios pass, including the rewritten F-shrink-persist.
# If F-shrink-persist fails on "model did not call mulligan_smoke_big": that is setup-turn flake —
# re-run once; if persistent, sharpen the setup prompt (mirror the SEED phrasing) but NEVER relax the
# refusal or persistence assertions.
```

### Level 3: Scope

```bash
git status   # only test/integration/smoke.ts, run-smoke.mjs, scenarios.md
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean; `grep -rn by_content_includes test/integration/` → 0
- [ ] `npm run smoke` green end-to-end
- [ ] `git status` → exactly the three integration files

### Feature Validation
- [ ] F-shrink-persist: setup turn commits a real mulligan_smoke_big toolResult; command-time shrink matches IN-SPAN via a two-arm selector (no cast)
- [ ] Substitution visible on the observing turn (shrunkInContext:true, resultCanaryPresent:false) AND the original RESULT_CANARY still on disk — the persistence invariant (mirror of P1.M1.T3.S2)
- [ ] Refusal variant end-to-end: out-of-turn/no-match target → "refused … previous turn" text, ZERO markers appended for it
- [ ] USER_CANARY / USER_SHRUNK_MARKER fully gone from both .ts and .mjs (canary sync intact for the surviving constants)
- [ ] context handler still returns void; still uses the REAL tool factories
- [ ] scenarios.md documents the new flow; no removed-arm mentions anywhere under test/integration/

### Scope Discipline
- [ ] No changes to test/transforms|markers|prepare-args|edge-cases.test.ts (S1) or test/tools/** (S2)
- [ ] No changes to src/**, spec/, PRD.md, tasks.json

## Anti-Patterns to Avoid

- ❌ Don't keep any `as unknown as` target cast — the two-arm target typechecks natively; a cast would hide schema drift
- ❌ Don't insert an extra `-p` prompt between the setup turn and the command — it would become a new last-user message and push the toolResult out of the current-turn span (the shrink would refuse)
- ❌ Don't relax the persistence/refusal assertions to work around a flaky setup turn — assert the setup explicitly instead
- ❌ Don't delete MSG_CANARY or msgCanaryPresent (F-rewind-core / F-reload / E11 depend on them)
- ❌ Don't edit the canaries in only one of smoke.ts / run-smoke.mjs (GOTCHA #8)
- ❌ Don't reimplement shrink matching in the smoke helper — always call makeShrinkTool's real execute

**Confidence Score: 8/10** — the flow rests on a verified pi behavior (command prompts bypass the loop and are not user messages) and mirrors already-green SEED-turn patterns; the residual risk is setup-turn model flake, mitigated by the explicit setup guard + retry guidance.