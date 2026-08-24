# PRP — P1.M2.T2.S2: Register + drive + assert F-banner (aboveEditor banner persists, clears within one fire, restored on /resume, 0 banner bytes in view)

## Goal

**Feature Goal**: Add the `F-banner` scenario to the integration smoke suite (BUG-003 / spec @10-testing.md §2.1) proving end-to-end, on a real `pi -p` run, that the active-checkpoint banner state: (1) PERSISTS across turns while a checkpoint is active (`banner.activeCount >= 1`, names includes it, on EVERY fire), (2) CLEARS within ONE fire after `/mulligan_checkpoint_revoke` (`activeCount === 0`), (3) is RESTORED on `/resume` (second spawn reusing the SAME `--session-id`, checkpoint still active), and (4) contributes ZERO banner bytes to the filtered view (no context.fire message contains the banner line text).

**Deliverable**: Edited `test/integration/run-smoke.mjs` (SCENARIOS entry, a two-run custom-flow branch mirroring F-reload/E11, `assertBanner` + a `main()` special-case), a logging-only `F-banner` case in `test/integration/smoke.ts`'s `driveScenario`, and a new `### F-banner` section in `test/integration/scenarios.md`. No production-code changes.

**Success Definition**: `npm run smoke` runs F-banner and reports PASS (16/16 at this stage; 19/19 once P1.M2.T3–T5 land); all assertions below hold; `npm test` + `npx tsc --noEmit` stay green.

## Why

The banner (spec/13 §5, spec/08 E26) is the v1.1 human-surface notification that a user-set checkpoint may cause future prompts to be hidden. It is unit-tested (test/banner.test.ts, 8 its) but the end-to-end path — `pi -p '/mulligan_checkpoint beta'` → label written → banner state active on the next fires → `/resume` restores it (src/index.ts:87 calls reconcileBanner on session_start "so '/resume never silently drops the reminder'") — has no CI coverage. BUG-003's headless nuance: in `pi -p` mode `ctx.hasUI === false`, so `reconcileBanner` no-ops and `ctx.ui.setWidget` is unobservable; the scenario therefore asserts via the **banner context.fire observable from P1.M2.T1.S1** (a pure `listCheckpoints` recompute of what reconcileBanner WOULD render — the same latest-wins scanner banner.ts imports) plus a 0-banner-bytes grep of the filtered view. This also lands the reusable **two-run /resume assertion pattern** counted by P1.M2.T6.S1.

## What

1. **Register** `"F-banner"` in the SCENARIOS array (test/integration/run-smoke.mjs:30-44) — append after `"F-ckptcmd"` (added by P1.M2.T2.S1; if it hasn't landed yet, place after `"F-checkpoint"` and do not otherwise conflict).
2. **Drive** — a new two-run branch in `runScenario()` (alongside the `F-reload || E11` branch at ~:600), sharing `--session-id smoke-F-banner-<RUN_ID>` WITHIN the run (runPi already does this — RUN_ID is stable per invocation):

```js
if (scenario === "F-banner") {
  // Two spawns sharing --session-id (the /resume arm — F-reload/E11 pattern).
  // Run 1: set checkpoint → 2 observing turns (persistence) → revoke → observing turn (clears within one fire).
  const r1 = runPi(scenario, {
    prompts: [
      "/mulligan_checkpoint beta",
      "Reply with exactly: OK",       // fire 1 → banner active (beta)
      "Reply with exactly: OK again", // fire 2 → STILL active (persists across turns)
      "/mulligan_checkpoint_revoke beta",
      "Reply with exactly: OK3",      // fire 3 → activeCount === 0
    ],
  });
  const smoke1 = parseSmokeLog(r1.logPath); // parsed BETWEEN spawns → run-1 lines only
  // Run 2 (same session id → pi reopens/resumes it): set a checkpoint, observe it on the resumed session.
  const r2 = runPi(scenario, {
    prompts: ["/mulligan_checkpoint gamma", "Reply with exactly: OK4"],
  });
  const smoke2 = parseSmokeLog(r2.logPath); // APPEND semantics → contains run-2 lines (after run-1's)
  return { piRes: r1, smoke: smoke1, r2, smoke2 };
}
```

   Note: pass `prompts` for run 2 explicitly (do NOT use the `extraArgs`-append shape from F-reload — we need run 2 to start with its OWN command prompt, not inherit run-1 defaults).
3. **smoke.ts**: add a logging-only case to `driveScenario`'s switch (mirror the F-ckptcmd case from P1.M2.T2.S1):

```ts
case "F-banner": {
  // Slash-command-driven two-run scenario: the orchestrator drives real /mulligan_checkpoint(+_revoke)
  // prompts and reads the banner observable on context.fire lines. Headless -p ⇒ ctx.hasUI === false ⇒
  // reconcileBanner no-ops (src/banner.ts branch (a)) and setWidget is unobservable — banner state is
  // RECOMPUTED at the fire point via listCheckpoints (P1.M2.T1.S1 observable). Nothing to do here.
  break;
}
```

4. **Assert** — new `assertBanner(run)` (signature mirrors `assertReload(run1, run2)` — it receives the whole `run`, not `{smoke, piRes}`) plus a `main()` special-case `else if (scenario === "F-banner") { outcome = assertBanner(run); }` (next to the F-reload/E11 special-cases at :637-641). Assertions, all over `contextFires` (each element has `.banner = {activeCount, names}`) and the raw JSONL text of the filtered view:

   Let `f1 = run.smoke.contextFires` (run-1 fires) and `f2 = run.smoke2.contextFires` (both runs' fires — filter out run-1's by taking the fires AFTER the last `activeCount === 0` fire of run 1, or simpler: `f2.slice(f1.length)` since the log APPENDS and fire order is preserved).

   - **(a) persistence**: every run-1 fire BEFORE the revoke prompt (`f1[0]`, `f1[1]` — fires 1 and 2) has `banner.activeCount >= 1` AND `banner.names` includes `"beta"`. Assert `f1.length >= 2` first (label the failure clearly if the model timed out early).
   - **(b) clears within ONE fire**: the first run-1 fire AFTER the revoke (`f1[2]`) has `banner.activeCount === 0` AND `!names.includes("beta")`. There must be no fire with activeCount ≥ 1 after that in run 1.
   - **(c) restored on /resume**: run-2 fires (post-revoke fires of the same session) include at least one with `banner.activeCount >= 1` AND `banner.names.includes("gamma")` — proves the checkpoint set on the RESUMED session is active (the label persisted in the reopened session JSONL, and index.ts's session_start reconcileBanner path exists for it in UI mode; in headless we assert the pure state it would render).
   - **(d) 0 banner bytes in the filtered view**: for EVERY context.fire line in BOTH runs' logs, the raw JSON of the fire's messages must NOT contain the banner line text. Implement by checking the smoke log JSONL text for the fragment `"Mulligan checkpoint active:` — assert it appears ZERO times in the messages of any context.fire detail (stringify each `detail` except its `.banner` field, or scan each fire's detail JSON and exclude matches that came from the `banner` observable field itself — the observable stores `names` only, never the rendered line, so a straight `JSON.stringify(fire).includes("Mulligan checkpoint active:")` is safe ONLY if you confirm the observable field holds just names; it does — `{activeCount, names}` — so scan the whole fire detail). Also assert `hasNudge === false` on every fire (assertGlobalInvariants already enforces zero `mulligan:nudge`; belt-and-braces is fine).
   - **(e) exit sanity**: `run.piRes.status === 0 && run.r2.status === 0` (soft-assert with a ⚠ note if non-zero but logs are present, mirroring F-reload tolerance).

   Return `{ results }` (no JSONL-session assertions needed — everything is smoke-log based, so there is no entries-skip caveat).

5. **Docs (Mode A)**: add `### F-banner` to `test/integration/scenarios.md` — the two-run flow, the five prompts, pass criteria (a)–(e), and EXPLICITLY document the headless observable strategy: "`ctx.ui.setWidget` is unobservable in `-p` mode (`ctx.hasUI === false` → reconcileBanner branch (a) no-ops); the scenario asserts the pure `listCheckpoints` recompute logged on `context.fire` (P1.M2.T1.S1) plus a 0-banner-bytes grep of the filtered view. `/resume` restore is proven with a second spawn reusing the same `--session-id` (F-reload/E11 two-run pattern)." Reference spec @10-testing.md:103 pass criteria and BUG-003.

### Success Criteria

- [ ] "F-banner" in SCENARIOS; two-run branch in runScenario; assertBanner + main() special-case wired.
- [ ] Assertions (a)–(e) implemented with labeled asserts; PASS on a clean run.
- [ ] `-ne` retained in every spawn (automatic — reuse runPi).
- [ ] scenarios.md `### F-banner` section documents the headless observable strategy.
- [ ] `npm run smoke` green including F-banner; `npm test` + `npx tsc --noEmit` green.

## All Needed Context

### Documentation & References

```yaml
- file: test/integration/run-smoke.mjs
  why: THE EDIT TARGET (orchestrator). SCENARIOS :30-44; runPi() :71-101 (spawn shape, MULLIGAN_SMOKE_LOG env, same logPath per scenario — smokeLog APPENDS, so run-1's parse between the spawns yields only run-1 lines); two-run F-reload/E11 branch :600-610 (the pattern to extend — note it uses extraArgs to append a run-2 prompt; F-banner instead needs explicit run-2 prompts starting with its own command); parseSmokeLog :101-118 (contextFires = parsed context.fire detail objects); assertReload/assertE11 :426-475 (two-run asserter precedents); main() special-cases :637-641; assert() helper ~:138
  pattern: asserters collect results via assert(results, label, cond, detail); outcome = {results, soft?, note?}
  gotcha: plain Node ESM, NOT type-checked — no TS syntax, no imports from src/

- file: test/integration/smoke.ts
  why: add the logging-only 'F-banner' case to driveScenario's switch (mirror the F-ckptcmd case from P1.M2.T2.S1); the context handler :456-520 already logs banner: {activeCount, names} (P1.M2.T1.S1) and hasNudge on every context.fire — those ARE the assertion observables; comments :483-485 document the headless hasUI=false rationale
  gotcha: the banner observable stores ONLY {activeCount, names} — never the rendered line — so a whole-detail JSON grep for the banner text is a true filtered-view check

- file: src/banner.ts
  why: reconcileBanner's 4 branches and the VERBATIM banner line used for the 0-banner-bytes fragment check: '⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>' — grep for the stable fragment 'Mulligan checkpoint active:'
  critical: banner is UI-ONLY, never injected into event.messages (E26 acceptance (d)) — that is WHY zero banner bytes in the filtered view is assertable

- file: src/index.ts
  why: :87 — session_start handler calls reconcileBanner(ctx) ('/resume never silently drops the reminder'); in headless -p mode it no-ops, so the /resume restore arm asserts the recompute observable (listCheckpoints latest-wins over the REOPENED session's entries)

- file: src/tools/audit.ts
  why: listCheckpoints — the pure two-phase latest-wins label scanner both reconcileBanner and the smoke observable use; guarantees a revoked checkpoint (clear entry) never reports active → assertions (b)/(c) semantics

- file: test/integration/scenarios.md
  why: EDIT — add '### F-banner' (Mode A: same subtask); follow the F-reload/E11 section style for two-run scenarios (see :341-409); must explicitly document the headless observable strategy

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T2S1/PRP.md
  why: the parallel sibling's CONTRACT — it adds F-ckptcmd (SCENARIOS + custom-flow branch + asserter + scenarios.md section). Your edits are strictly additive and land after it; scenario order: F-banner AFTER F-ckptcmd. Its slash-command prompt-flow branch is the run-1 template

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/research/bug_validation.md
  why: BUG-003 nuance — spec/10-testing.md:103 F-banner pass criteria (setWidget aboveEditor persists, clears within one fire, restored on /resume, 0 banner bytes in filtered view)
```

### Current Codebase tree (relevant)

```bash
test/integration/run-smoke.mjs   # EDIT — SCENARIOS + two-run branch + assertBanner + main() special-case
test/integration/smoke.ts        # EDIT — logging-only F-banner driveScenario case
test/integration/scenarios.md    # EDIT — ### F-banner section (Mode A)
src/banner.ts                    # READ — reconcileBanner branches + verbatim banner line (frozen)
src/index.ts                     # READ — :87 session_start reconcileBanner (frozen)
src/tools/audit.ts               # READ — listCheckpoints semantics (frozen)
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: KEEP -ne in runPi's argv — globally-installed older mulligan collision guard (PRD Overview confounder).
// CRITICAL: log APPEND semantics — smoke2.contextFires contains run-1's fires too. Split with
//   f2.slice(f1.length) or anchor on the first post-'gamma' fire; NEVER assume smoke2 starts fresh.
// CRITICAL: runPi uses the SAME logPath for both spawns by design (F-reload/E11 rely on it); do not
//   "fix" this for F-banner — parse run-1's log BETWEEN the two spawns exactly like :603-604.
// GOTCHA: F-reload's run-2 uses extraArgs to append ONE prompt to the default flow — that shape is wrong
//   for F-banner (run 2 must begin with '/mulligan_checkpoint gamma'); pass explicit prompts instead.
// GOTCHA: prompts 'Reply with exactly: OK' / 'OK again' / 'OK3' / 'OK4' — use DISTINCT texts so a model
//   echo can never confuse fire attribution; the reply content itself is NOT asserted.
// GOTCHA: command prompts (leading '/') are dispatched by pi without an observing model turn — the only
//   context fires come from the 'Reply with exactly: ...' prompts. Expected run-1 fire count: 3 (set→2
//   observe fires, revoke→1 observe fire). Model timeouts can reduce this — assert >= the minimum needed
//   per arm and label shortfalls clearly rather than indexing blindly (f1[2] may be undefined).
// GOTCHA: assert (d) — the banner observable field holds only {activeCount, names}, so scanning the whole
//   fire detail for 'Mulligan checkpoint active:' cannot false-positive off the observable itself.
// GOTCHA: F-banner assertions are SMOKE-LOG based only (no session-JSONL dependence) — no entries-skip
//   caveat; but if BOTH runs produced zero context fires, fail hard (spawn/model failure), don't pass vacuously.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY test/integration/run-smoke.mjs — SCENARIOS
  - ADD: "F-banner" after "F-ckptcmd" (or after "F-checkpoint" if the sibling hasn't landed)
  - COUNT: suite total 15→16 at this stage of the changeset

Task 2: MODIFY test/integration/run-smoke.mjs — runScenario two-run branch
  - ADD: the `if (scenario === "F-banner")` branch (code in the What section) BEFORE the F-reload/E11 branch
  - FOLLOW pattern: runScenario's F-reload/E11 branch :600-610 (shared session id via runPi; parse smoke1 between spawns)
  - DEVIATION (documented): run 2 passes explicit prompts (starts with its own command), not extraArgs

Task 3: MODIFY test/integration/smoke.ts — logging-only case
  - ADD: `case "F-banner": break;` in driveScenario's switch with the headless-observable comment (What §3)
  - VERIFY: context.fire banner observable (P1.M2.T1.S1) already present (:516) — do not duplicate it

Task 4: MODIFY test/integration/run-smoke.mjs — assertBanner + main() special-case
  - IMPLEMENT: function assertBanner(run) — assertions (a)-(e) per What §4; defensive index access
    (check f1.length / run2-fires length before indexing); hard-fail on zero total fires
  - REGISTER: `else if (scenario === "F-banner") { outcome = assertBanner(run); }` next to F-reload/E11 :637-641
  - NOTE: F-banner is NOT in the ASSERTERS map (two-run signature differs) — same as F-reload/E11

Task 5: MODIFY test/integration/scenarios.md — ### F-banner
  - FOLLOW pattern: the F-reload/E11 two-run section style (:341-409)
  - MUST document: the headless observable strategy (setWidget unobservable in -p; pure listCheckpoints
    recompute on context.fire + JSONL labels; 0-banner-bytes grep) and the second-spawn same---session-id
    /resume proof, per the work item's DOCS requirement

Task 6: VALIDATE
  - npm run smoke (expect 16/16 green at this stage); npm test; npx tsc --noEmit
```

### Implementation Patterns & Key Details

```js
// Two-run asserter skeleton (run-smoke.mjs, plain ESM JS)
function assertBanner(run) {
  const results = [];
  const f1 = run.smoke.contextFires;                 // run-1 fires only (parsed between spawns)
  const allFires = run.smoke2.contextFires;          // both runs (log appends)
  const f2 = allFires.slice(f1.length);              // run-2 fires
  const total = allFires.length;
  assert(results, "at least 4 context fires across both runs", total >= 4, `${total} fires`);
  if (total === 0) return { results };               // hard-fail via the assert above
  // (a) persistence: fires before the revoke (f1[0], f1[1])
  // (b) cleared within one fire: f1[2] → banner.activeCount === 0, no later run-1 active fire
  // (c) restored on /resume: some f2 fire has names including "gamma"
  // (d) 0 banner bytes: every fire in allFires — JSON.stringify(fire) must not include "Mulligan checkpoint active:"
  //     AND fire.hasNudge === false
  // (e) exit sanity: run.piRes.status === 0 && run.r2.status === 0 (soft note on non-zero)
  return { results };
}
```

### Integration Points

```yaml
SCENARIOS: test/integration/run-smoke.mjs :30-44 — append "F-banner"
RUNNER: runScenario() ~:600 — new branch before the F-reload/E11 branch
MAIN: main() :637-641 — third special-case line for "F-banner"
DOCS: test/integration/scenarios.md — new "### F-banner" section (Mode A, same subtask)
NO production-code changes; no config changes (ui.activeCheckpointBanner defaults ON per spec/09).
```

## Validation Loop

### Level 1: Type check

```bash
npx tsc --noEmit    # smoke.ts edit must typecheck; run-smoke.mjs is plain ESM (not type-checked)
```

### Level 2: Unit regression

```bash
npm test    # untouched suites stay green (esp. test/banner.test.ts — banner.ts is frozen this subtask)
```

### Level 3: The scenario itself

```bash
npm run smoke
# Expect: F-banner PASS with (a)-(e) labels; suite total 16/16 at this stage of the changeset.
# Debug: inspect $(node -e 'console.log(require("os").tmpdir())')/mulligan-smoke/F-banner.log —
# grep '"test":"context.fire"' and check the banner field per fire; run-1 vs run-2 lines are appended in order.
```

### Level 4: Manual /resume sanity (optional once)

```bash
pi -ne -e ./src/index.ts --session-id banner-manual \
  -p '/mulligan_checkpoint beta' -p 'Reply with exactly: OK' -p '/mulligan_checkpoint_revoke beta' -p 'Reply with exactly: OK3'
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id banner-manual \
  -p '/mulligan_checkpoint gamma' -p 'Reply with exactly: OK4'
# Then check the MULLIGAN_SMOKE_LOG fires: gamma active on the resumed session's fire.
```

## Final Validation Checklist

- [ ] `npm run smoke` green including F-banner; (a)–(e) labels all pass
- [ ] `npm test` green; `npx tsc --noEmit` clean
- [ ] `-ne` retained; both spawns share `smoke-F-banner-<RUN_ID>`
- [ ] run-1 log parsed between spawns (append-semantics respected); run-2 fires sliced correctly
- [ ] scenarios.md `### F-banner` added, headless observable strategy explicitly documented
- [ ] No production code touched; strictly additive vs P1.M2.T2.S1's edits

## Anti-Patterns to Avoid

- ❌ Don't assert on stdout/notify strings or on setWidget (unobservable headless) — assert the context.fire banner observable + 0-banner-bytes grep.
- ❌ Don't reuse F-reload's `extraArgs` run-2 shape — run 2 must start with its own `/mulligan_checkpoint gamma` prompt.
- ❌ Don't index fires blindly (`f1[2]` may be undefined on a model timeout) — length-check first, fail loudly on zero fires.
- ❌ Don't let a vacuous pass happen: zero fires across both runs = hard FAIL.
- ❌ Don't remove or reorder existing scenarios; append. Don't add TS syntax to run-smoke.mjs.

**Confidence Score**: 8/10 — all harness surfaces verified in-source (two-run branch :600-610, main() special-cases :637-641, banner observable in smoke.ts :516, verbatim banner line in banner.ts); residual risks: (1) exact run-1 fire count under model timeouts (mitigated by defensive indexing), (2) run-2 fire slicing relies on append-order (verified by F-reload precedent, but re-confirm at implementation).