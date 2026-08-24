---
name: "P1.M2.T5.S1 — Register + drive + assert F-drift-userexempt (big user paste via -p; hasNudge false; high-water observable true, soft on huge windows)"
---

## Goal

**Feature Goal**: Add the `F-drift-userexempt` scenario to the integration smoke suite (BUG-003 / spec @10-testing.md §2.1, fifth and final v1.1 scenario), proving end-to-end on a real `pi -p` run that a large (~60k-token) USER paste does **NOT** fire the drift nudge (D10: `estimateAgentTokens`, src/tokens.ts:126-143, excludes `role==='user'` messages from the drift delta — the exemption is STRUCTURAL, there is no `50000` constant; spec/07:174's "50k" is illustrative), while the total-context **high-water** signal from P1.M2.T1.S2 (`highWater: {latch, fraction}` in the `context.fire` log line) does observe the paste when the provider window allows crossing 0.7.

**Deliverable**: Edited `test/integration/run-smoke.mjs` (SCENARIOS entry, generated-paste prompt flow in `runScenario()`, `assertDriftUserexempt` + ASSERTERS wiring), a minimal `test/integration/smoke.ts` addition (`PASTE_CANARY` observable in the `context.fire` log line), and a new `### F-drift-userexempt` section in `test/integration/scenarios.md`. NO production-code changes.

**Success Definition**: `npm run smoke` runs F-drift-userexempt and reports PASS (19/19 expected at P1.M2.T6.S1 full-suite time; fewer while siblings are landing is fine — this PRP only adds this one scenario); `npm test` + `npx tsc --noEmit` stay green. The scenario completes the five v1.1 scenarios required by spec/11 DoD #2 ("All F-* integration scenarios green against a real pi -p run").

## Why

The D10 user-exemption of the drift nudge is unit-tested (test/drift_nudge.test.ts:147, test/turn_metric.test.ts:508) but never exercised end-to-end through the real `pi -p` argv → session → turn_end → nudge-gate path (BUG-003). This is the negative-space counterpart of the already-green F-nudge-drift scenario: F-nudge-drift proves agent-attributable growth DOES fire the nudge; F-drift-userexempt proves user-attributable growth does NOT, while the window-level high-water signal (which counts ALL context, user included) still observes it. Together they pin the D10 boundary at the integration level.

## What

### 1. Register — `test/integration/run-smoke.mjs`

- Append `"F-drift-userexempt"` to the `SCENARIOS` array (:30-49) after `"F-consent"`.
- Add `"F-drift-userexempt": assertDriftUserexempt` to the ASSERTERS map (:708-719).

### 2. Drive — generated paste, `runScenario()` branch (next to the F-ckptcmd/F-consent custom-prompt branches, ~:736+)

**CRITICAL — NO `/mulligan_smoke` prompt.** The item's prompt flow is `[<one -p containing a generated ~60k-token document paste>, "Reply with exactly: OK"]`. The paste must arrive as a REAL user prompt through argv (`-p`), because the whole point is that a genuine user message is exempt. The smoke.ts `context` observer logs `context.fire` on **every** fire regardless of `currentScenario` (smoke.ts:523+ — `currentScenario` only gates the F-rewind-core/F-checkpoint hard-hiding logs), so no command dispatch is needed for the observables.

**Generate the paste at runtime — do NOT check a fixture into the repo.** A ~60k-token paste ≈ 240KB of argv, comfortably under Linux `ARG_MAX` (~2MB) plus one environment-variable-set overhead; a checked-in 240KB file would bloat the repo. Deterministic generation in run-smoke.mjs:

```js
if (scenario === "F-drift-userexempt") {
  // F-drift-userexempt (BUG-003 / spec @10 §2.1): D10 user-exemption, end-to-end. The paste is a REAL
  // user prompt delivered via -p (no /mulligan_smoke dispatch — the exemption is about genuine user
  // input). Generated at runtime: ~60k tokens ≈ 240KB argv, under Linux ARG_MAX (~2MB); never a repo
  // fixture. estimateAgentTokens (src/tokens.ts:126-143) excludes role==='user' from the drift delta
  // → the nudge must NOT fire even though total context grows ~60k. The highWater observables
  // (P1.M2.T1.S2) count the FULL filtered context → they SHOULD observe the paste when the window
  // is small enough for 60k to cross 0.7 of it.
  const PASTE_TOKENS_TARGET = 60_000;
  const CHARS_PER_TOKEN = 4; // must match src/tokens.ts CHARS_PER_TOKEN (verify with grep — see PRP gotcha)
  const line = "MULLIGAN-SMOKE-PASTE-FILLER-0123456789abcdef "; // ~48 chars incl. space
  const lineTokens = Math.ceil(line.length / CHARS_PER_TOKEN); // ceiling per estimateTokens' GOTCHA #5
  const repeat = Math.ceil((PASTE_TOKENS_TARGET * CHARS_PER_TOKEN) / line.length);
  const paste =
    `Ignore the filler below; it simulates a large document paste (D10 user-exemption smoke).\n` +
    `MULLIGAN-SMOKE-PASTE-CANARY\n` +
    Array.from({ length: repeat }, (_, i) => `${i} ${line}`).join("\n");
  const piRes = runPi(scenario, {
    prompts: [paste, "Reply with exactly: OK"],
  });
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}
```

Notes:
- `runPi` already flattens each prompt into a `-p <prompt>` argv pair (:87), so a single 240KB argument is passed as one `-p` value — exactly what we want.
- Include the unique `MULLIGAN-SMOKE-PASTE-CANARY` line so the fire-line observable can prove the paste is actually IN the filtered context (see §3).
- The runPi GOTCHA: verify the runtime is fine with a 240KB argv — `spawnSync` handles it; if `pi` rejects oversized argv on some platform, the asserter's `piRes.status !== 0` check surfaces it.

### 3. smoke.ts — one observable addition to the `context.fire` line

Minimal edit (the observer at smoke.ts:523-563 already computes `hasNudge` and `highWater` for every fire):

- Add a module const near the other canaries (SEED_ANCHOR area): `const PASTE_CANARY = "MULLIGAN-SMOKE-PASTE-CANARY";` — MUST be byte-identical to the string embedded in run-smoke.mjs's generated paste (GOTCHA #8: no shared module; a mismatch → canary never matches → false negative).
- In the `context.fire` smokeLog payload add: `pasteCanaryPresent: msgs.some((m) => JSON.stringify(m).includes(PASTE_CANARY)),`.

No new `case` in `driveScenario`'s switch — the scenario never dispatches `/mulligan_smoke`.

### 4. Assert — `assertDriftUserexempt` in run-smoke.mjs

Follow the `assertNudgeDrift` shape (:326-343) — reuse `readSessionEntries`, `assert`, `assertGlobalInvariants`, `countCustom`:

```js
function assertDriftUserexempt({ smoke, piRes }) {
  const results = [];
  const entries = readSessionEntries(smoke.sessionFile);
  const fires = smoke.lines.filter((l) => l.test === "context.fire");
  // (a) HARD: the drift nudge must NOT fire — the paste is user-attributable and excluded from the
  // delta (estimateAgentTokens D10). hasNudge false on EVERY fire + ZERO mulligan:nudge in the JSONL.
  assert(results, "pi exited 0 (turn survived)", piRes.status === 0, `exit=${piRes.status}`);
  assert(results, "context.fire lines exist (paste turn + observing turn)", fires.length >= 1, `${fires.length} fires`);
  const nudgeFires = fires.filter((l) => l.detail?.hasNudge === true);
  assert(results, "hasNudge===false on every fire (D10 user-exemption)", nudgeFires.length === 0,
    nudgeFires.length ? `${nudgeFires.length} fires show hasNudge:true` : "");
  const pasteFires = fires.filter((l) => l.detail?.pasteCanaryPresent === true);
  assert(results, "paste is in the filtered context on post-paste fires", pasteFires.length >= 1, `${pasteFires.length} fires`);
  if (entries.length > 0) {
    const nudgeCount = entries.filter((e) => e.customType === "mulligan:nudge").length;
    assert(results, "ZERO mulligan:nudge entries on disk (§2.3 + exemption)", nudgeCount === 0,
      nudgeCount ? `${nudgeCount} found` : "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  // (b) high-water arm (window-dependent → SOFT when the window is too large for 60k to cross 0.7 —
  // follow the F-nudge-drift soft convention, cf. :342). Compute; assert only when satisfied; else SOFT.
  const hwOk = pasteFires.some((l) => l.detail?.highWater?.latch === true || (typeof l.detail?.highWater?.fraction === "number" && l.detail.highWater.fraction >= 0.7));
  const hwFraction = pasteFires.map((l) => l.detail?.highWater?.fraction).filter((f) => typeof f === "number").sort((a, b) => b - a)[0];
  let soft;
  if (hwOk) {
    assert(results, "high-water observed the paste (latch or fraction>=0.7)", true, `fraction=${hwFraction}`);
  } else {
    soft = `highWater did not cross 0.7 (max fraction ${hwFraction ?? "null"} — provider window too large for a 60k-token paste; cf. F-nudge-drift's model-dependent arm)`;
  }
  // (c) contrast criterion: agent-attributable growth DOES fire the drift nudge — proven by the
  // existing green F-nudge-drift scenario (its model-driven arm). Cross-reference only; no duplication.
  return { results, entries, soft,
    note: "contrast arm (agent reads fire the drift nudge) is covered by F-nudge-drift — see scenarios.md" };
}
```

Soft convention: the orchestrator prints `⚠ SOFT: <soft>` (:895) and does NOT fail the scenario — match that; never put the high-water arm in the hard `results` unless it actually held on this run.

### 5. Docs — `test/integration/scenarios.md` (Mode A, same subtask)

Add a `### F-drift-userexempt` section after `### F-consent` (:410-458), matching the file's established format (Tests / Run / Expect in log / Expect in JSONL / Pass). Document:
- The paste is GENERATED at runtime (~60k tokens ≈ 240KB argv, under Linux ARG_MAX ~2MB) — never a repo fixture.
- D10 rationale: `estimateAgentTokens` (src/tokens.ts:126-143) excludes `role==='user'` from the drift delta; the exemption is structural (no 50000 constant — spec/07:174 "50k" is illustrative).
- The soft high-water arm: `highWater.latch`/`fraction` (P1.M2.T1.S2) SHOULD show the crossing when the provider window is small enough; on huge windows the result is SOFT (cf. F-nudge-drift's model-dependent arm).
- The contrast cross-reference: the "3 turns of agent reads ~4k each DO fire the drift nudge" criterion is covered by the existing green F-nudge-drift scenario (scenarios.md :191-221) — do not duplicate model-driven drift turns here.
- Example run command (paste elided with a note that run-smoke.mjs generates it).

## All Needed Context

### Documentation & References

```yaml
- file: test/integration/run-smoke.mjs
  why: SCENARIOS array (:30-49), runPi/-p flattening (:74-94), assertNudgeDrift asserter pattern (:326-343),
       ASSERTERS map (:708-719), runScenario custom-prompt branches (:730+), soft printing (:895)
  pattern: follow assertNudgeDrift for readSessionEntries/assert/assertGlobalInvariants/countCustom usage
  gotcha: GOTCHA #8 — canary strings must be byte-identical between run-smoke.mjs and smoke.ts (no shared module)

- file: test/integration/smoke.ts
  why: the context observer (:523-563) — hasNudge (:552), highWater {latch, fraction} (:559), canary consts,
       pasteCanaryPresent insertion point
  pattern: add PASTE_CANARY next to SEED_ANCHOR consts; extend the context.fire smokeLog payload only
  gotcha: the observer runs on EVERY fire; currentScenario gating only applies to hard-hiding logs — no
          /mulligan_smoke dispatch is needed for the observables

- file: src/tokens.ts
  why: estimateAgentTokens (:126-143) — the D10 structural exemption (role!=='user' summed; user skipped);
        CHARS_PER_TOKEN constant (verify the exact value with grep before mirroring it in run-smoke.mjs)
  pattern: mirror CHARS_PER_TOKEN as a local const with a comment pointing at src/tokens.ts
  gotcha: estimateTokens ceiling-rounds per message (GOTCHA #5) — token sizing is approximate; target 60k,
          exact count irrelevant (any paste >> driftThresholdTokens 4000 works)

- file: src/nudges.ts
  why: shouldNudge (:325-332, windowed average vs driftThresholdTokens) — reference only, for asserter comments;
        shouldHighWater (:466-512) mutates rt.aboveHighWater latch — the observer reads, never calls it
  gotcha: NEVER call shouldHighWater from smoke.ts (it mutates the latch); read rt.aboveHighWater via
          getRuntime(...).aboveHighWater as the existing observer already does

- file: test/integration/scenarios.md
  why: F-nudge-drift section (:191-221) is the contrast reference to cross-cite; F-consent section (:410-458)
        shows the latest section format to imitate

- file: src/config.ts
  why: defaults (:168-170) — driftThresholdTokens 4000, driftWindowTurns 3, highWaterFraction 0.7
  gotcha: the F-nudge-drift smoke.ts comment (:250) says 3000 — that is STALE v1.0 text; the current default
          is 4000. Do not copy the stale number into new comments/docs.

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T4S1/PRP.md
  why: sibling PRP landing F-useraudit concurrently — it edits run-smoke.mjs (SCENARIOS/ASSERTERS/runScenario)
        and scenarios.md in the same regions; keep edits ADDITIVE and scenario-local to avoid conflicts
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: runPi must receive the paste as ONE prompt entry — its flatMap already emits ["-p", paste].
#   ~240KB single argv is fine under Linux ARG_MAX (~2MB); do NOT split the paste across multiple -p.
# CRITICAL: no /mulligan_smoke dispatch for this scenario — the paste must be a genuine user prompt
#   (a command dispatch bypasses the agent loop and would defeat the D10 point being tested).
# CRITICAL: never call shouldHighWater() in smoke.ts — it mutates rt.aboveHighWater (the latch).
#   Read-only: getRuntime(sessionId).aboveHighWater + estimateTokens(msgs)/windowTokens (already shipped P1.M2.T1.S2).
# CRITICAL: the -ne flag stays (globally-installed older mulligan collision defense, M-1) — runPi adds it.
# driftThresholdTokens default is 4000 (config.ts:168), NOT 3000 (stale comment at smoke.ts:250).
# JSONL may be missing on model timeout — the existing "JSONL unavailable" tolerance pattern (assertNudgeDrift :339-341).
```

## Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/integration/run-smoke.mjs — drive
  - ADD "F-drift-userexempt" to SCENARIOS (after "F-consent")
  - ADD runScenario branch: generated ~60k-token paste prompt + "Reply with exactly: OK" (code in §2 above)
  - NAMING: paste canary literal "MULLIGAN-SMOKE-PASTE-CANARY"; filler lines "MULLIGAN-SMOKE-PASTE-FILLER-..."
  - GOTCHA: verify CHARS_PER_TOKEN in src/tokens.ts by grep before mirroring

Task 2: MODIFY test/integration/smoke.ts — observable
  - ADD const PASTE_CANARY (byte-identical to Task 1's string)
  - ADD pasteCanaryPresent to the context.fire smokeLog payload (:552-562 area)
  - NO new driveScenario case

Task 3: MODIFY test/integration/run-smoke.mjs — assert
  - ADD assertDriftUserexempt (code in §4) + wire "F-drift-userexempt": assertDriftUserexempt in ASSERTERS
  - COVERAGE: hasNudge false every fire; zero mulligan:nudge entries; paste in filtered context;
    pi exit 0; assertGlobalInvariants; soft high-water arm; F-nudge-drift contrast note

Task 4: MODIFY test/integration/scenarios.md — docs (Mode A, same subtask)
  - ADD "### F-drift-userexempt" section (§5 above): generated paste, soft arm, contrast cross-reference
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit        # smoke.ts is type-checked; run-smoke.mjs is plain ESM (NOT type-checked)
# Expected: clean (no new errors)
```

### Level 2: The scenario itself

```bash
npm run smoke 2>&1 | tee /tmp/smoke-t5.log
grep -E "F-drift-userexempt|PASS|FAIL|SOFT" /tmp/smoke-t5.log | tail -30
# Expected: F-drift-userexempt PASS; all previously-green scenarios stay green. A "⚠ SOFT: highWater did not
# cross 0.7 ..." line is acceptable (provider-window dependent); "hasNudge===false" must be a HARD pass.
# Inspect the fire lines for ground truth:
grep context.fire /tmp/mulligan-smoke/F-drift-userexempt.log 2>/dev/null || cat "$(ls -d /tmp/mulligan-smoke 2>/dev/null)/F-drift-userexempt.log" 2>/dev/null | head
```

### Level 3: Regression

```bash
npm test               # full unit suite — must remain green (no production code touched)
npx tsc --noEmit       # clean
```

## Final Validation Checklist

- [ ] `npm run smoke`: F-drift-userexempt PASS; no sibling scenario regressed
- [ ] hasNudge===false on every fire (HARD) + zero `mulligan:nudge` entries in the session JSONL
- [ ] pasteCanaryPresent===true on post-paste fires (the paste is really in the filtered context)
- [ ] high-water arm asserted when it held; SOFT note (with measured fraction) when the window is too large
- [ ] asserter output notes the F-nudge-drift contrast cross-reference
- [ ] `assertGlobalInvariants` called when the JSONL is available
- [ ] No paste fixture committed — filler generated at runtime in run-smoke.mjs
- [ ] `npm test` green; `npx tsc --noEmit` clean
- [ ] scenarios.md has the `### F-drift-userexempt` section (generated paste, soft arm, contrast reference)
- [ ] No production code (src/) modified

## Anti-Patterns to Avoid

- ❌ Don't check a 240KB fixture into the repo — generate the paste at runtime.
- ❌ Don't dispatch `/mulligan_smoke F-drift-userexempt` as a prompt — the paste must be a real user prompt via `-p`.
- ❌ Don't make the high-water arm a hard failure — it's window-dependent (SOFT convention, cf. :342/:895).
- ❌ Don't duplicate the model-driven drift-positive contrast — cross-reference F-nudge-drift instead.
- ❌ Don't call shouldHighWater() from smoke.ts (latch mutation); read `getRuntime(...).aboveHighWater` only.
- ❌ Don't trust the stale "3000" in smoke.ts:250 — the default driftThresholdTokens is 4000 (config.ts:168).
```