# PRP — P1.M3.T2.S1: Enhance F-rewind-core + F-checkpoint smoke assertions (RE-PLAN, attempt 2/3)

**Work item:** P1.M3.T2.S1 · **Points:** 1 · **Bugfix:** integration-tier regression guard for BUG-001/002/003
**Scope:** **MODIFY two existing files** (`test/integration/smoke.ts` + `test/integration/run-smoke.mjs`). **No source
edits. No new files. No new deps. No config/API/spec change.** This is a **test-only subtask** that hardens the two
smoke scenarios to assert **ACTUAL HIDING** (not just marker persistence) so a regression re-introducing any of the 3
bugs **FAILS the deterministic smoke suite** — and **FIXES a baseline breakage** (the current 2-prompt F-checkpoint
REFUSES because the M1.T2.S1 `setCheckpoint` fix correctly rejects the fresh-session transient leaf).

> **WHY ATTEMPT 1 FAILED (read first):** Attempt 1 tried to assert hiding on the **2-prompt** path
> (`-p "/mulligan_smoke X" -p "Reply OK"`). On a FRESH session, at command-handler time the only thing on the branch is
> the `/mulligan_smoke` user message — nothing committed after it — so `resolveLastTurn`→K=0 and `setCheckpoint`→"no
> stable entry to checkpoint" (REFUSES). Its `pi.sendMessage` HIDE_CANARY workaround also gave K=0 (the appended
> custom_message is not yet resolvable at the synchronous rewind-preview tick, and custom messages are not the `message`
> entries the resolvers count). Attempt 1 concluded "deterministic hiding is impossible; re-scope to unit tier."
>
> **THE BREAKTHROUGH (this session, empirically verified):** the wall only holds for the **2-prompt** path. **Prepending
> a SEED model turn** before the command commits a real assistant message to the branch, so the resolvers HAVE content
> to anchor/hide. Verified with fresh `$$`-suffixed sessions on pi 0.84.1:
> - **F-rewind-core** (3-prompt seed): rewind reports **K=1** ("1 messages will be hidden"); a 3rd observer logged
>   `roles=[custom,user,custom,user]` on the observing inference → **no assistant survives → seed reply HIDDEN**.
> - **F-checkpoint** (5-prompt set/seed/rewind split): setCheckpoint **SUCCEEDS** ("checkpoint 'alpha' set"),
>   rewind reports **K=2** ("2 messages will be hidden") → catches BUG-003 (was always K=0).
>
> **BASELINE BREAKAGE (also confirmed, MUST be fixed here):** the CURRENT 2-prompt F-checkpoint REFUSES on a fresh
> session (`tool.checkpoint`: "no stable entry to checkpoint"; `tool.rewind`: "checkpoint 'alpha' not found"). The seed
> flow fixes it. See `research/notes.md`.

> **PARALLEL-COORDINATION:** P1.M3.T1.S1 (LANDED, 706 vitest tests) added the **pure-unit-tier** permanence guard
> (`test/transforms.test.ts` — filterPipeline multi-fire). It does NOT touch smoke.ts/run-smoke.mjs. THIS task is the
> **integration-tier** guard: it proves the REAL tools + REAL pi session + REAL filter fire-hide content end-to-end.
> The two tiers are complementary (different files, no collision).
>
> **BASELINE (VERIFIED LIVE):** `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / **706 tests
> green**. This task touches smoke.ts (type-checked) + run-smoke.mjs (plain .mjs, not type-checked). vitest does NOT run
> smoke.ts (it is an integration harness loaded via `pi -e`, not a vitest test) → vitest stays 706.

---

## ⚠️ WHY THE LITERAL CONTRACT IS IMPOSSIBLE — AND THE HONEST SUBSTITUTE (read before coding)

The contract says: "assert the filtered view does NOT contain the MSG_CANARY (the session-start custom message that the
last_turn rewind should hide)" on the post-rewind fire. **This is structurally impossible, independent of fresh/polluted
sessions:** the session-start MSG_CANARY is injected at `session_start` BEFORE the first user message; `resolveLastTurn`
removes ONLY content AFTER the last `role:"user"` message → the session-start canary is NEVER in the removal set → it is
never hidden → `msgCanaryPresent` is always `true`. (Confirmed: every context.fire in every probe shows
`msgCanaryPresent:true`.)

**The contract's INTENT** ("a deterministic regression guard that FAILS if hiding regresses") **IS achievable** by
asserting the **SEED reply** is hidden instead. The seed reply is a real assistant message committed AFTER the first user
message (by a prepended model turn), so it IS in the last_turn removal span and IS pinned by `hideEntryIds`. This is the
"dedicated hideable canary placed after the rewind/checkpoint point" that attempt 1's own notes identified as the intent —
but created via a **real model turn** (works) instead of `pi.sendMessage` (fails). The PRD's recommendation #2 ("Add
integration tests that drive the real usage pattern: perform tool work, rewind, then assert the originally-hidden content
is STILL absent") is satisfied by the seed reply standing in for "tool work."

**Do NOT attempt to assert `msgCanaryPresent===false`.** It will always be `true` and produce a vacuous failure. Assert
the seed canaries instead (exact mechanics in the Implementation Blueprint).

---

## Goal

**Feature Goal**: Harden `F-rewind-core` and `F-checkpoint` so each asserts **ACTUAL HIDING** on the observing inference
(the post-rewind `context.fire`), via deterministic **seed-prompt flows** that create committed hideable content before
the rewind. A regression of BUG-001/002 (relative re-resolution leak-back → `hideEntryIds` pinning lost) or BUG-003
(`resolveCheckpoint` → `remove=[]` → K=0) MUST fail the smoke suite. ALSO fix the baseline F-checkpoint breakage
(`setCheckpoint` refuses on a fresh session → no marker created → current `assertCheckpoint` is RED).

**Deliverable** (MODIFY two existing files):
1. `test/integration/smoke.ts` — add 2 seed-canary constants + a `currentScenario` module var; extend the `context`
   handler with seed-presence fields + 2 scenario-scoped HARD pass/fail `smokeLog` assertions; add 2 new driveScenario
   cases (`F-checkpoint-set`, `F-checkpoint-rewind`). All never-throwing (try/catch). F-rewind-core recipe UNCHANGED.
2. `test/integration/run-smoke.mjs` — refactor `runPi` to accept custom prompt sequences; special-case `F-rewind-core`
   (3-prompt seed) and `F-checkpoint` (5-prompt set/seed/rewind) in `runScenario`; rewrite `assertRewindCore` (+K≥1,
   +seed-hidden) and `assertCheckpoint` (+setCheckpoint-succeeded, +K>0, +seed-hidden/anchor-survives).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (smoke.ts type-checks under strict; run-smoke.mjs is not type-checked).
- `npx vitest run` is **all-green — 706 tests, 18 files** (smoke.ts is not a vitest test; zero regressions).
- `node test/integration/run-smoke.mjs` (the deterministic smoke suite) — `F-rewind-core` and `F-checkpoint` **PASS**
  with the NEW hiding + K assertions firing green (seed reply hidden; K≥1 / K>0); the other 12 scenarios stay green.
- The new assertions are **real guards** (a BUG-001/002/003 regression flips them red), verified by the two-signal
  composition (tool K-text + context-handler seed-absence) — see Validation Loop Level 3.

---

## User Persona

**Target User**: The bugfix maintainer + the CI gate. Today, BUG-001/002/003 all shipped (or would re-ship) green because
the smoke suite asserts only MARKER PERSISTENCE, never that content is actually hidden (spec_and_test_analysis §KEY
QUESTION 4). Worse, the post-M1.T2.S1 `setCheckpoint` fix made the CURRENT F-checkpoint REFUSE on a fresh session, so
`assertCheckpoint` is RED at baseline. This task closes the integration-tier gap: the two scenarios now create real
hideable content (via seed turns), pin+hide it with the REAL tools, and assert it stays hidden — end to end, through the
real pi session + real filter.

**Use Case**: A maintainer edits `src/transforms.ts` (`resolvePinnedHide`/`resolveCheckpoint`/`filterPipeline` dispatch)
or `src/tools/rewind.ts` (`captureHideEntryIds`/`resolvePreview`). The smoke run executes F-rewind-core + F-checkpoint;
if pinning regressed (BUG-001/002) the seed reply LEAKS BACK → `seedHiddenInAssistant===true` → FAIL; if
`resolveCheckpoint` regressed to `remove=[]` (BUG-003) the rewind reports K=0 → the K-assertion FAILS.

**Pain Points Addressed**: the smoke suite passed while hiding was broken; now a hiding regression is impossible to ship
green. The F-checkpoint baseline breakage is fixed.

---

## Why

- **Closes the spec_and_test_analysis §KEY QUESTION 4 gap at the INTEGRATION tier.** That analysis names the exact
  missing assertions: "F-rewind-core … never asserts the hiding is permanent"; "F-checkpoint never asserts anything is
  hidden." The unit tier (P1.M3.T1.S1) closes it for the pure `filterPipeline`; THIS task closes it for the REAL
  tools + REAL session + REAL filter wiring — the path the bugs actually lived in.
- **Fixes a live baseline regression.** The M1.T2.S1 `setCheckpoint` fix (correctly) refuses the transient leaf, which
  BROKE the deterministic F-checkpoint (it now refuses on a fresh session). The seed flow restores a working F-checkpoint.
- **Satisfies PRD recommendation #2 directly:** "Add integration tests that drive the real usage pattern: perform tool
  work, rewind, then assert the originally-hidden content is STILL absent from every subsequent context.fire." The seed
  reply is the "tool work"; the observing inference is the "subsequent context.fire."
- **Honest, not vacuous.** Two independent signals (the REAL rewind tool's K-text + the context handler's seed-absence)
  compose into each guard, so it cannot pass for the wrong reason. On model timeout it FAILS with a clear K=0/seed-missing
  message rather than silently passing.

---

## What

Two files MODIFIED (no new files). Every change is never-throwing (the harness discipline: each handler/recipe is
independently try/catch-guarded).

### F-rewind-core — 3-prompt SEED flow (the recipe in smoke.ts is UNCHANGED; run-smoke.mjs prepends the seed)
- run-smoke.mjs drives: `-p "Reply with exactly: MULLIGAN-SMOKE-SEED-HIDDEN" -p "/mulligan_smoke F-rewind-core" -p "Reply with exactly: OK"`.
- p1 commits the seed assistant reply. p2 runs the EXISTING `rewindNow(pi, ctx, "smoke-rewind-1", "last_turn")`
  (resolveLastTurn now finds the seed reply after user(p1) → K=1 → `captureHideEntryIds` pins it). p3 is the observing
  inference. The context handler logs `seedHiddenInAssistant` and, when `hasRewindMarker`, emits a HARD
  `F-rewind-core.hiding` pass/fail line (`seedHiddenInAssistant===false` ⇒ pass; `true` ⇒ "LEAKED BACK" fail).

### F-checkpoint — 5-prompt SET/SEED/REWIND split flow (replaces the single-handler set+rewind)
- run-smoke.mjs drives: `-p "Reply with exactly: MULLIGAN-SMOKE-SEED-ANCHOR" -p "/mulligan_smoke F-checkpoint-set" -p "Reply with exactly: MULLIGAN-SMOKE-SEED-HIDDEN" -p "/mulligan_smoke F-checkpoint-rewind" -p "Reply with exactly: OK"`.
- p1 commits SEED_ANCHOR (the checkpoint anchor). p2 `F-checkpoint-set` runs ONLY `setCheckpoint("alpha")` → labels the
  SEED_ANCHOR assistant (stable entry) → SUCCEEDS (baseline-breakage fix). p3 commits SEED_HIDDEN (post-checkpoint
  content). p4 `F-checkpoint-rewind` runs ONLY `rewindNow(checkpoint, "alpha")` → K=2 (hides the post-checkpoint turn).
  p5 is the observing inference. Context handler emits a HARD `F-checkpoint.hiding` pass/fail line
  (`seedHiddenInAssistant===false` AND `seedAnchorInAssistant===true` ⇒ pass).

### Context handler additions (smoke.ts)
- Two new fields per `context.fire`: `seedAnchorInAssistant` and `seedHiddenInAssistant` (each =
  `msgs.some(m => m?.role === "assistant" && JSON.stringify(m).includes(<CANARY>))`).
- Two scenario-scoped HARD `smokeLog` pass/fail assertions, emitted on the post-rewind fire (`currentScenario` matches
  AND `hasRewindMarker===true`): `F-rewind-core.hiding`, `F-checkpoint.hiding` (see Implementation Blueprint).

### run-smoke.mjs additions
- `runPi` accepts optional `{ prompts }` (default = existing 2-prompt flow) so seed flows pass custom `-p` sequences.
- `runScenario` special-cases F-rewind-core (3-prompt) and F-checkpoint (5-prompt).
- `assertRewindCore`: +assert `tool.rewind` text is NOT `/0 messages will be hidden/i` (K≥1); +assert
  `F-rewind-core.hiding` last line `status==="pass"`. (The old SOFT "canary-drop is model-driven" note is REMOVED —
  hiding is now deterministically asserted.)
- `assertCheckpoint`: rewrite — setCheckpoint SUCCEEDED (text not `/refused/i`); rewind K>0 (text not
  `/refused|0 messages will be hidden/i`); `F-checkpoint.hiding` pass; existing JSONL label+marker invariants kept.

This subtask does **NOT**: edit any `src/*` file (test-only); add new smoke scenarios beyond the two; touch the other 12
scenarios' flows; change the §2.3 global invariants; assert `msgCanaryPresent===false` (impossible — see ⚠️ section);
duplicate P1.M3.T1.S1's unit tests; sync spec docs (P1.M4); or implement the separate-marker union fix.

### Success Criteria

- [ ] smoke.ts: 2 seed-canary consts + `currentScenario` module var added; context handler logs `seedAnchorInAssistant`
      + `seedHiddenInAssistant` on every fire; 2 scenario-scoped HARD `smokeLog` pass/fail assertions emitted; 2 new
      driveScenario cases (`F-checkpoint-set`, `F-checkpoint-rewind`) added; F-rewind-core recipe UNCHANGED.
- [ ] run-smoke.mjs: `runPi` accepts custom prompts; `runScenario` seeds F-rewind-core (3-prompt) + F-checkpoint (5-prompt);
      `assertRewindCore` + `assertCheckpoint` enforce the new K + hiding assertions.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` → 18 files / 706 tests green (unchanged — smoke.ts is not a vitest test).
- [ ] `node test/integration/run-smoke.mjs` → `F-rewind-core` PASSES with `tool.rewind` K≥1 + `F-rewind-core.hiding` pass;
      `F-checkpoint` PASSES with setCheckpoint succeeded + rewind K>0 + `F-checkpoint.hiding` pass; the other 12 green.
- [ ] No new files; no source edits; no new deps; no `msgCanaryPresent===false` assertion anywhere.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** The exact edits are specified line-by-line below (Tasks 1-4), each backed by an empirical probe trace in
> `research/notes.md` (K=1 for F-rewind-core; K=2 for F-checkpoint; observer roles confirming hiding). The relevant
> smoke.ts/run-smoke.mjs regions are quoted. The resolver contracts (`resolveLastTurn`, `setCheckpoint`,
> `captureHideEntryIds`) are verified on disk. The rewind tool's K-text format and the refusal format are confirmed in
> live smoke logs. No prior knowledge beyond "tsc+vitest green; pi 0.84.1 with working keys runs the smoke suite" is
> required.

### Documentation & References

```yaml
# MUST READ — authoritative sources for this task
- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/spec_and_test_analysis.md
  section: "KEY QUESTION 4 (F-rewind-core / F-checkpoint assert only persistence, never hiding)"
  why: "THE justification: names the exact missing integration assertions this task adds."
  critical: "KEY QUESTION 4 lists what each scenario SHOULD assert: hidden content absent on fire 1 AND still absent on
        later fires (permanent). The seed reply + observing-inference assertion delivers exactly that."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M3T2S1/research/notes.md
  why: "THE empirical basis: documents attempt-1's failure (2-prompt wall), the SEED breakthrough, the F-rewind-core
        K=1 + observer roles=[custom,user,custom,user] trace, the F-checkpoint K=2 trace, the baseline-breakage proof,
        and the literal-contract-is-impossible reasoning. Read before coding."

- file: test/integration/smoke.ts
  section: "factory: SMOKE_LOG/canary consts (38-46), smokeLog (60-73), rewindNow (89-110), driveScenario switch
            (F-rewind-core ~149, F-checkpoint ~227), the context handler (~253), registerCommand (~last)"
  why: "THE file under edit. The context handler is the OBSERVER (returns void — GOTCHA #1); driveScenario dispatches
        per scenario using the REAL tool factories. The new consts/module-var/context-fields/cases slot in here."
  pattern: "never-throwing: every handler + recipe is try/catch-guarded; smokeLog never throws."
  gotcha: "The context handler MUST return void (do NOT override Mulligan's filter). smoke loads SECOND so event.messages
        is POST-filter. /mulligan_smoke command prompts do NOT appear in the filtered view as user messages (verified)."

- file: test/integration/run-smoke.mjs
  section: "runPi (~45), parseSmokeLog (~73), assert helpers (~120), assertRewindCore (~158), assertCheckpoint (~243),
            ASSERTERS map + runScenario (~330), main (~360)"
  why: "THE orchestrator under edit. runPi hardcodes the two -p flags (refactor to accept {prompts}). assertRewindCore
        /assertCheckpoint are rewritten. runScenario special-cases F-reload/E11 already (mirror that pattern)."
  pattern: "assert(results,label,cond,detail) collects {pass,label,detail}; a scenario FAILS iff any result.pass===false
        (NO global 'any smokeLog fail→fail' rule — verified: main() counts results.filter(!r.pass))."
  gotcha: "run-smoke.mjs is plain .mjs — NOT type-checked by tsc. SCENARIOS list + ASSERTERS map drive everything."

- file: test/integration/scenarios.md
  section: "'How the harness works' (2-extension load order, deterministic command path, API-key tolerance) +
            'F-rewind-core' + 'F-checkpoint'"
  why: "The playbook doc. NOTE: it currently says the canary-drop/bloatHit/hasNudge are MODEL-DRIVEN (SOFT). After this
        task, F-rewind-core hiding is DETERMINISTIC (seed) — scenarios.md should be updated in a follow-up doc task, but
        is OUT OF SCOPE here (P1.M4 owns docs)."

- file: src/transforms.ts
  section: "resolveLastTurn (319) + resolveCheckpoint (454) + resolvePinnedHide (625) + filterPipeline dispatch (~1124)"
  why: "READ-ONLY context: the resolvers the REAL tools invoke. resolveLastTurn removes indices > iLastUser (so a seed
        reply after user(p1) IS removed). resolvePinnedHide maps hideEntryIds → indices (pinning)."

- file: src/markers.ts
  section: "setCheckpoint (345-376)"
  why: "READ-ONLY context: explains the baseline breakage. setCheckpoint walks getBranch() backwards for a `message`
        entry with non-empty role; on a fresh 2-prompt session there is none → REFUSES. A seed model turn produces
        exactly such an entry → succeeds. This is WHY the seed flow fixes F-checkpoint."

- file: src/tools/rewind.ts
  section: "resolvePreview (~315) + captureHideEntryIds (~282) + the K-text formatting (~187)"
  why: "READ-ONLY context: resolvePreview computes `remove` at creation time → captureHideEntryIds maps to entry ids →
        hideEntryIds on the marker. K-text: K=0 → '0 messages will be hidden … (nothing matched to hide)'; K>0 →
        '${k} messages will be hidden …'. This is the K-assertion signal."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; scripts.smoke:'node test/integration/run-smoke.mjs'; scripts.test:'vitest run'
├── tsconfig.json           # strict, include:['src','test']  ← smoke.ts IS type-checked; run-smoke.mjs is NOT (.mjs)
├── src/                    # ALL READ-ONLY (transforms.ts/markers.ts/tools/* LANDED in P1.M1/P1.M2)
└── test/
    ├── integration/
    │   ├── smoke.ts        # MODIFY: +2 consts, +1 module var, context-handler fields/assertions, +2 driveScenario cases
    │   ├── run-smoke.mjs   # MODIFY: runPi {prompts}, runScenario seed flows, assertRewindCore/assertCheckpoint rewrites
    │   └── scenarios.md    # READ-ONLY (doc update is P1.M4 — out of scope)
    └── transforms.test.ts  # READ-ONLY (P1.M3.T1.S1 LANDED the unit-tier guard; 706 tests)
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / 706 green.
# pi 0.84.1 at /home/dustin/.local/bin/pi; working keys present (the seed model turns need them, same as session-JSONL).
# NOTE: no eslint/prettier (devDeps = typescript + vitest + @types/node). Gate = `tsc --noEmit` + `vitest run` + `run-smoke.mjs`.
```

### Desired Codebase tree with files to be changed (THIS subtask)

```bash
pi-mulligan/
└── test/integration/
    ├── smoke.ts        # ~25 new lines (consts, module var, context-handler fields/assertions, 2 cases). MODIFIED.
    └── run-smoke.mjs   # ~40 changed lines (runPi refactor, runScenario special-cases, 2 asserter rewrites). MODIFIED.
# No source edits. No new files. No new deps. No config/API/spec change.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — Do NOT assert msgCanaryPresent===false. The session-start MSG_CANARY is injected at
#   session_start BEFORE the first user message; resolveLastTurn removes only content AFTER the last user message →
#   the session-start canary is NEVER in the removal set → msgCanaryPresent is ALWAYS true. Assert the SEED canaries
#   (seed reply, committed AFTER the first user message) instead. (See ⚠️ section + research/notes.md.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — The seed reply is committed by a PREPENDED model turn (run-smoke.mjs drives an extra `-p`
#   BEFORE the /mulligan_smoke command). The smoke.ts recipe is UNCHANGED for F-rewind-core; F-checkpoint is SPLIT
#   into F-checkpoint-set (setCheckpoint only) + F-checkpoint-rewind (rewind only) so a model turn can run BETWEEN
#   them (creating the post-checkpoint content that makes K>0). Do NOT try to create hideable content inside a single
#   command handler — attempt 1 proved that gives K=0.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — The context handler MUST return void (it is an OBSERVER; GOTCHA #1 of smoke.ts). It must NOT
#   return {messages} or it overrides Mulligan's filter. The new fields/assertions are LOG-ONLY (smokeLog); the handler
#   still returns void.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — smoke loads SECOND → its context handler sees POST-filter messages (event.messages already filtered by
#   Mulligan). So seed-absence in event.messages = seed-hidden-by-the-filter (not seed-never-existed). The tool.rewind
#   K-text is the backstop that proves the seed existed+was pinned (K≥1) before the filter hid it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — Distinguish the two seed canaries by ROLE, not just substring: the user PROMPT also contains the canary
#   text (e.g. "Reply with exactly: MULLIGAN-SMOKE-SEED-HIDDEN"). So check `m?.role === "assistant" && includes(canary)`,
#   NOT just `has(canary)` (which would match the prompt). seedAnchorInAssistant / seedHiddenInAssistant both gate on
#   role:"assistant".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — currentScenario must be NORMALIZED so the context-handler assertion fires during BOTH F-checkpoint
#   phases. driveScenario sets `currentScenario = scenario.startsWith("F-checkpoint") ? "F-checkpoint" : scenario`.
#   The assertion gates on `hasRewindMarker===true` (only true after F-checkpoint-rewind), so it fires exactly once.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — A scenario FAILS iff an assert() result is pass===false (verified: main() counts
#   results.filter(!r.pass)). There is NO global "any smokeLog status:fail → scenario fail" rule. So the new HARD
#   pass/fail smokeLog lines (F-rewind-core.hiding / F-checkpoint.hiding) MUST be READ BACK by the asserter and
#   converted to an assert() — logging them alone does not fail the scenario.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — run-smoke.mjs is plain .mjs and NOT type-checked by tsc. The seed-canary STRING LITERALS must match
#   EXACTLY between smoke.ts (the TS consts) and run-smoke.mjs (the -p prompt text). Define them once in smoke.ts and
#   COPY the identical string into run-smoke.mjs (there is no shared module). Mismatch → seed never matches → K=0 → fail.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — These 2 scenarios now REQUIRE working model turns (the seeds), the SAME dependence the suite already has
#   for session-JSONL persistence (the 2nd `-p "Reply OK"` must produce a model reply). On model TIMEOUT the seed reply
#   is not committed → K=0 → the K-assertion FAILS with a clear message (honest: cannot assert hiding without content).
#   Do NOT add a "skip on timeout" escape hatch — that would make the guard vacuous (the exact failure mode attempt 1
#   was warned about). Document the model-dependence; do not hide it.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — There is NO lint/format tool (devDeps = typescript + vitest + @types/node). The gate is tsc + vitest +
#   run-smoke.mjs. Do NOT invent an eslint/ruff/prettier command. Keep smoke.ts edits TS-clean (strict) so tsc passes.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — Keep changes minimal + never-throwing (the contract NOTE). Every new context-handler block + recipe
#   branch is wrapped in try/catch (mirror the existing discipline). No new tool registrations; no new events.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No data-model change — test-only. Two new module-local string constants + one module-local mutable var in smoke.ts,
mirroring the existing `MSG_CANARY`/`RESULT_CANARY`/`SMOKE_NOTE` pattern. The context handler's logged `detail` object
gains two boolean fields; two new `smokeLog` test-names (`F-rewind-core.hiding`, `F-checkpoint.hiding`) carry the HARD
pass/fail verdicts the orchestrator reads back.

```ts
// smoke.ts — new consts (beside MSG_CANARY/RESULT_CANARY at ~line 44)
const SEED_ANCHOR = "MULLIGAN-SMOKE-SEED-ANCHOR"; // F-checkpoint: the checkpoint anchor assistant (SURVIVES the rewind)
const SEED_HIDDEN = "MULLIGAN-SMOKE-SEED-HIDDEN"; // F-rewind-core (the only seed) + F-checkpoint post-checkpoint seed (HIDDEN)
// module-local mutable: which logical scenario is running (set in driveScenario; read by the context handler)
let currentScenario = "";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + the empirical claims (no edits — run/probe only)
  - RUN: npx tsc --noEmit -p tsconfig.json                 # expect exit 0
  - RUN: npx vitest run                                    # expect 18 files / 706 green
  - RUN (confirm baseline breakage + the seed fix): see Validation Loop Level 3 probe commands. You should observe:
        2-prompt F-checkpoint → tool.checkpoint "no stable entry to checkpoint" (REFUSES); tool.rewind "not found".
        3-prompt F-rewind-core seed → tool.rewind "1 messages will be hidden"; post-rewind context.fire has NO assistant.
        5-prompt F-checkpoint seed split → tool.checkpoint "checkpoint 'alpha' set"; tool.rewind "2 messages will be hidden".
    If these do NOT reproduce, STOP — the pi version/timing has shifted; re-read research/notes.md before proceeding.

Task 1: EDIT test/integration/smoke.ts  (exact content below — copy verbatim into the marked regions)
  - ADD the 2 seed-canary consts beside the existing canary consts (after RESULT_CANARY / SHRUNK_MARKER).
  - ADD `let currentScenario = "";` as a module-local var (near the top, after the consts).
  - In driveScenario: set+normalize currentScenario at the very start of the try block (BEFORE the switch):
        currentScenario = scenario.startsWith("F-checkpoint") ? "F-checkpoint" : scenario;
  - In driveScenario: ADD two new cases "F-checkpoint-set" and "F-checkpoint-rewind" (exact code below). KEEP the
    existing "F-checkpoint" case as a backward-compat alias (it is NOT driven by the new flow; leave its body intact).
  - In the `pi.on("context", …)` handler: ADD the two seed fields to the logged detail + the two scenario-scoped HARD
    smokeLog assertions (exact code below). The handler STILL returns void.
  - CONSTRAINTS: never-throwing (the new blocks are inside the existing try/catch); role-gated seed detection
    (GOTCHA #5); normalized currentScenario (GOTCHA #6); handler returns void (GOTCHA #3).

Task 2: EDIT test/integration/run-smoke.mjs  (exact content below — copy verbatim)
  - REFACTOR runPi to accept an optional { prompts } (default = the existing 2-prompt flow). The -e/-e/--session-id
    argv stay; the -p flags come from `prompts`.
  - In runScenario: special-case "F-rewind-core" (3-prompt seed) and "F-checkpoint" (5-prompt set/seed/rewind) BEFORE
    the default 2-prompt path. (Mirror the existing F-reload/E11 special-case structure.)
  - REWRITE assertRewindCore: keep the existing marker/note/JSONL asserts; ADD (a) tool.rewind text NOT
    /0 messages will be hidden/i (K≥1), (b) read back F-rewind-core.hiding → assert status==="pass". REMOVE the old
    `soft: "canary-drop … is model-driven"` return value (hiding is now deterministic) — return no `soft`.
  - REWRITE assertCheckpoint: keep the existing label/marker/§2.3 asserts; ADD (a) setCheckpoint SUCCEEDED (text not
    /refused/i), (b) rewind K>0 (text not /refused|0 messages will be hidden/i), (c) read back F-checkpoint.hiding →
    assert status==="pass". The cpLines/rwLines now come from the split flow (2 checkpoint phases).
  - CONSTRAINTS: identical seed-canary string literals to smoke.ts (GOTCHA #8); scenario fails iff an assert is
    pass===false (GOTCHA #7); read-back the hiding smokeLog lines (logging alone does not fail).

Task 3: VALIDATE (no edits — run the Validation Loop gates)
  - Level 1 (tsc) + Level 2 (vitest unchanged) + Level 3 (run-smoke.mjs: F-rewind-core + F-checkpoint green with the
    new assertions firing; then the full 14-scenario suite). Level 4 = the regression-injection sanity check.
```

#### Exact content — `test/integration/smoke.ts`

**(1a) New consts + module var** — add after the existing canary consts (after the `SHRUNK_MARKER` line, ~line 46):

```ts
// SEED canaries for the deterministic HIDING assertions (P1.M3.T2.S1). The session-start MSG_CANARY precedes the first
// user message, so a last_turn rewind (which hides content AFTER the last user message) can NEVER hide it. Instead, a
// SEED model turn (a prepended `-p "Reply with exactly: <SEED>"`) commits a real assistant message AFTER the first user
// message — which the rewind CAN pin + hide. SEED_HIDDEN is the content asserted ABSENT on the observing inference;
// SEED_ANCHOR is the F-checkpoint anchor asserted PRESENT (the checkpoint must keep its anchor, not over-hide).
const SEED_ANCHOR = "MULLIGAN-SMOKE-SEED-ANCHOR";
const SEED_HIDDEN = "MULLIGAN-SMOKE-SEED-HIDDEN";

// Which logical scenario is running (set+normalized in driveScenario; read by the context handler so its scenario-scoped
// hiding assertions fire on the right post-rewind fire). Module-local mutable — never exported.
let currentScenario = "";
```

**(1b) driveScenario — set+normalize currentScenario** — add as the FIRST statement inside the existing `try {` (before `switch`):

```ts
    // Normalize so the context-handler assertion fires during BOTH F-checkpoint phases (set + rewind).
    currentScenario = scenario.startsWith("F-checkpoint") ? "F-checkpoint" : scenario;
```

**(1c) driveScenario — two new cases** — add inside the `switch (scenario)` (e.g. right after the existing `case "F-checkpoint":` block):

```ts
      case "F-checkpoint-set": {
        // Phase 1 of the F-checkpoint HIDING flow (run-smoke.mjs drives a SEED_ANCHOR model turn BEFORE this command):
        // set the checkpoint ONLY. The SEED_ANCHOR assistant (committed by the preceding prompt) is the stable entry
        // setCheckpoint labels — so it SUCCEEDS (fixes the baseline breakage where a fresh 2-prompt session has no
        // stable entry). A SEED_HIDDEN model turn runs AFTER this, then F-checkpoint-rewind hides it (K>0).
        try {
          const cpTool = makeCheckpointTool(pi);
          const cpRes = await cpTool.execute("smoke-cp-1", { name: "alpha" }, undefined, undefined, ctx);
          const cpText = resultText(cpRes.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.checkpoint", "info", { phase: "set", text: cpText.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.checkpoint", "fail", { phase: "set", error: String(e) });
        }
        break;
      }
      case "F-checkpoint-rewind": {
        // Phase 2 of the F-checkpoint HIDING flow (a SEED_HIDDEN model turn has run BETWEEN set and this): rewind to
        // 'alpha' → hides the post-checkpoint SEED_HIDDEN turn (K>0). The orchestrator's final `-p "Reply OK"` is the
        // observing inference on which F-checkpoint.hiding is asserted.
        await rewindNow(pi, ctx, "smoke-cp-rw-1", "checkpoint", { checkpoint: "alpha" });
        break;
      }
```

**(1d) context handler — seed fields + scenario-scoped HARD assertions** — inside the existing `pi.on("context", (event, ctx) => { try { … } })`, AFTER the existing `hasRewindMarker` computation and the existing `smokeLog("context.fire", …)` call, ADD (still inside the same try; the handler still ends with `return void`):

```ts
      // ── SEED-canary hiding detection (P1.M3.T2.S1). Role-gated: the user PROMPT also contains the canary text, so
      //    gate on role:"assistant" to detect the seed REPLY specifically (GOTCHA #5). smoke loads SECOND → these read
      //    the POST-filter view, so seed-absence = seed-hidden-by-the-filter.
      const seedAnchorInAssistant = msgs.some(
        (m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_ANCHOR),
      );
      const seedHiddenInAssistant = msgs.some(
        (m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_HIDDEN),
      );
      // (Re-emit context.fire WITH the seed fields appended. Keep the existing fields; add the two new ones.)
      smokeLog("context.fire", "info", {
        count: msgs.length,
        msgCanaryPresent: has(MSG_CANARY),
        resultCanaryPresent: has(RESULT_CANARY),
        notePresent: msgs.some((m) => m?.customType === "mulligan:note"),
        hasRewindMarker,
        shrunkInContext: has(SHRUNK_MARKER),
        hasNudge: msgs.some((m) => m?.customType === "mulligan:nudge"),
        seedAnchorInAssistant,
        seedHiddenInAssistant,
      });
      // ── Scenario-scoped HARD hiding assertions (emitted on the post-rewind fire only). These are READ BACK by
      //    run-smoke.mjs assertRewindCore/assertCheckpoint and converted to assert() — logging alone does not fail a
      //    scenario (GOTCHA #7). Two-signal guard: the tool.rewind K-text (read by the asserter) proves the seed
      //    existed+was pinned; seed-absence here proves it is hidden. If pinning regressed (BUG-001/002) the seed
      //    reply LEAKS BACK → seedHiddenInAssistant===true → FAIL.
      if (currentScenario === "F-rewind-core" && hasRewindMarker) {
        smokeLog("F-rewind-core.hiding", seedHiddenInAssistant ? "fail" : "pass", {
          seedHiddenInAssistant,
          note: seedHiddenInAssistant ? "LEAKED BACK (BUG-001/002 regression: pinned hide lost)" : "seed reply hidden on observing inference",
        });
      }
      if (currentScenario === "F-checkpoint" && hasRewindMarker) {
        // The checkpoint must HIDE the post-checkpoint SEED_HIDDEN turn AND KEEP its SEED_ANCHOR (not over-hide).
        const pass = !seedHiddenInAssistant && seedAnchorInAssistant;
        smokeLog("F-checkpoint.hiding", pass ? "pass" : "fail", {
          seedHiddenInAssistant,
          seedAnchorInAssistant,
          note: pass
            ? "post-checkpoint seed hidden; anchor survives"
            : seedHiddenInAssistant
              ? "post-checkpoint seed LEAKED BACK (BUG-003/001 regression)"
              : "checkpoint anchor MISSING (over-hid / checkpoint not set)",
        });
      }
```

> **NOTE on (1d):** the existing `smokeLog("context.fire", …)` call (smoke.ts ~line 262) is REPLACED by the new
> `smokeLog("context.fire", …)` that APPENDS `seedAnchorInAssistant` + `seedHiddenInAssistant`. Do NOT emit two
> context.fire lines per fire. Edit the existing block in place: keep all existing fields, add the two new ones, then
> add the seed-detection consts + the two scenario-scoped assertions AFTER it. Everything stays inside the one `try`.

#### Exact content — `test/integration/run-smoke.mjs`

**(2a) runPi — accept optional { prompts }** — replace the existing `runPi(scenario, extraArgs = [])` body's argv construction so the `-p` flags come from `prompts`:

```js
function runPi(scenario, { prompts, extraArgs = [] } = {}) {
  const logPath = join(SMOKE_TMP_DIR, `${scenario}.log`);
  // Default = the existing 2-prompt deterministic flow (unchanged for the 12 non-seeded scenarios).
  const ps = prompts ?? [`/mulligan_smoke ${scenario}`, "Reply with exactly: OK"];
  const argv = [
    "-e", "./src/index.ts",
    "-e", "./test/integration/smoke.ts",
    "--session-id", `smoke-${scenario}`,
    ...ps.flatMap((p) => ["-p", p]),
    ...extraArgs,
  ];
  const res = spawnSync("pi", argv, {
    encoding: "utf8",
    env: { ...process.env, MULLIGAN_SMOKE_LOG: logPath },
    timeout: PI_TIMEOUT_MS,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", logPath };
}
```

**(2b) runScenario — seed flows for F-rewind-core + F-checkpoint** — add at the TOP of `runScenario`, before the F-reload/E11 branch and the default:

```js
function runScenario(scenario) {
  // F-rewind-core: 3-prompt SEED flow. A seed model turn commits a hideable assistant reply BEFORE the command, so the
  // last_turn rewind pins it (K≥1) and the observing inference shows it HIDDEN. (The 2-prompt path gives K=0 — nothing
  // after the user message at command time.)
  if (scenario === "F-rewind-core") {
    const piRes = runPi(scenario, {
      prompts: [
        `Reply with exactly: ${SEED_HIDDEN}`,
        `/mulligan_smoke F-rewind-core`,
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  // F-checkpoint: 5-prompt SET/SEED/REWIND flow. SEED_ANCHOR → set checkpoint (labels the anchor) → SEED_HIDDEN
  // (post-checkpoint content) → rewind to 'alpha' (K>0) → observing turn. Fixes the baseline breakage (setCheckpoint
  // refused on a fresh 2-prompt session) AND asserts hiding (the single-handler set+rewind always gave K=0).
  if (scenario === "F-checkpoint") {
    const piRes = runPi(scenario, {
      prompts: [
        `Reply with exactly: ${SEED_ANCHOR}`,
        `/mulligan_smoke F-checkpoint-set`,
        `Reply with exactly: ${SEED_HIDDEN}`,
        `/mulligan_smoke F-checkpoint-rewind`,
        "Reply with exactly: OK",
      ],
    });
    const smoke = parseSmokeLog(piRes.logPath);
    return { piRes, smoke };
  }
  if (scenario === "F-reload" || scenario === "E11") {
    // … existing two-spawn reload logic UNCHANGED …
  }
  const piRes = runPi(scenario);
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}
```

> Add the two canary literals at the top of run-smoke.mjs (beside the other string literals / near the top), IDENTICAL
> to smoke.ts (GOTCHA #8): `const SEED_ANCHOR = "MULLIGAN-SMOKE-SEED-ANCHOR";` / `const SEED_HIDDEN = "MULLIGAN-SMOKE-SEED-HIDDEN";`.

**(2c) assertRewindCore — add K≥1 + seed-hidden; drop the old SOFT note.** Replace the body with:

```js
function assertRewindCore({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const rewindLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  const lastRewind = rewindLines[rewindLines.length - 1];
  const text = lastRewind?.detail?.text ?? "";
  assert(results, "tool.rewind ran", rewindLines.length >= 1, rewindLines.length ? "" : "no tool.rewind line");
  assert(results, "tool.rewind succeeded (not refused)", lastRewind && !/refused/i.test(text), text.slice(0, 80));
  // NEW (P1.M3.T2.S1): the seed flow commits a hideable assistant reply BEFORE the command, so the rewind MUST pin
  // ≥1 message. K=0 means the seed did not commit (model timeout) OR the resolver found nothing — either way the
  // hiding assertion below is meaningless, so fail here with a clear message.
  assert(results, "tool.rewind hid content (K≥1; not '0 messages will be hidden')", !/0 messages will be hidden/i.test(text), text.slice(0, 80));
  const cf = smoke.contextFires[smoke.contextFires.length - 1];
  assert(results, "context.fire observed", !!cf, cf ? "" : "no context.fire");
  assert(results, "context.fire hasRewindMarker:true", cf?.hasRewindMarker === true, String(cf?.hasRewindMarker));
  assert(results, "context.fire notePresent:true", cf?.notePresent === true, String(cf?.notePresent));
  // NEW: the seed reply MUST be hidden on the observing inference (BUG-001/002 regression guard). Read back the HARD
  // smokeLog verdict emitted by the context handler (GOTCHA #7 — logging alone does not fail a scenario).
  const hidingLines = smoke.lines.filter((l) => l.test === "F-rewind-core.hiding");
  const lastHiding = hidingLines[hidingLines.length - 1];
  assert(results, "seed reply HIDDEN on observing inference (BUG-001/002 guard)", lastHiding && lastHiding.status === "pass", JSON.stringify(lastHiding?.detail ?? {}));
  if (entries.length > 0) {
    assert(results, "JSONL has mulligan:rewind (custom)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assert(results, "JSONL has mulligan:note (custom_message)", countCustomMessage(entries, "mulligan:note") >= 1, "");
    assertGlobalInvariants(results, entries);
  } else {
    console.log(`  ⚠ JSONL unavailable (model may have timed out) — smoke-log assertions are primary`);
  }
  return { results, entries }; // NOTE: no `soft` — hiding is now DETERMINISTIC (seed flow), not model-driven.
}
```

**(2d) assertCheckpoint — rewrite for the split flow + K>0 + hiding.** Replace the body with:

```js
function assertCheckpoint({ smoke, piRes }) {
  const results = [];
  const sessionFile = smoke.sessionFile;
  const entries = readSessionEntries(sessionFile);
  const cpLines = smoke.lines.filter((l) => l.test === "tool.checkpoint");
  const rwLines = smoke.lines.filter((l) => l.test === "tool.rewind");
  const cpLine = cpLines[cpLines.length - 1];
  const cpText = cpLine?.detail?.text ?? "";
  const rwLine = rwLines[rwLines.length - 1];
  const rwText = rwLine?.detail?.text ?? "";
  // setCheckpoint RAN + SUCCEEDED (not refused). This is the baseline-breakage fix: a fresh 2-prompt session made
  // setCheckpoint refuse "no stable entry to checkpoint"; the seed flow commits SEED_ANCHOR first so it succeeds.
  assert(results, "tool.checkpoint ran", cpLines.length >= 1, "");
  assert(results, "checkpoint SET succeeded (not refused — baseline-breakage fix)", cpLine && !/refused/i.test(cpText), cpText.slice(0, 80));
  // checkpoint rewind RAN + K>0. K=0 (or refusal) is the BUG-003 signature (resolveCheckpoint → remove=[]). The seed
  // flow commits SEED_HIDDEN AFTER the checkpoint so the rewind hides it (K>0).
  assert(results, "checkpoint rewind ran", rwLines.length >= 1, "");
  assert(results, "checkpoint rewind K>0 (BUG-003 guard)", rwLine && !/refused|0 messages will be hidden/i.test(rwText), rwText.slice(0, 80));
  // The post-checkpoint seed MUST be hidden AND the anchor MUST survive (read back the HARD context-handler verdict).
  const hidingLines = smoke.lines.filter((l) => l.test === "F-checkpoint.hiding");
  const lastHiding = hidingLines[hidingLines.length - 1];
  assert(results, "post-checkpoint seed hidden + anchor survives (BUG-003/001 guard)", lastHiding && lastHiding.status === "pass", JSON.stringify(lastHiding?.detail ?? {}));
  if (entries.length > 0) {
    assert(results, "JSONL has label mulligan:checkpoint:alpha", countLabel(entries, "mulligan:checkpoint:alpha") >= 1, "");
    assert(results, "JSONL has mulligan:rewind (custom)", countCustom(entries, "mulligan:rewind", "rewind") >= 1, "");
    assertGlobalInvariants(results, entries);
  } else {
    assert(results, "JSONL available", false, "session JSONL missing — model may have timed out");
  }
  return { results, entries };
}
```

### Implementation Patterns & Key Details

```ts
// PATTERN (context handler — OBSERVER, returns void): log the post-filter view, emit scenario-scoped HARD verdicts.
pi.on("context", (event, ctx) => {
  try {
    const msgs = event.messages as unknown as Array<Record<string, unknown>>;
    // … existing has()/hasRewindMarker …
    const seedAnchorInAssistant = msgs.some((m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_ANCHOR));
    const seedHiddenInAssistant = msgs.some((m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_HIDDEN));
    smokeLog("context.fire", "info", { /* existing fields */ , seedAnchorInAssistant, seedHiddenInAssistant });
    if (currentScenario === "F-rewind-core" && hasRewindMarker)
      smokeLog("F-rewind-core.hiding", seedHiddenInAssistant ? "fail" : "pass", { /* … */ });
    if (currentScenario === "F-checkpoint" && hasRewindMarker) {
      const pass = !seedHiddenInAssistant && seedAnchorInAssistant;
      smokeLog("F-checkpoint.hiding", pass ? "pass" : "fail", { /* … */ });
    }
  } catch (e) { smokeLog("context.fire", "fail", { error: String(e) }); }
  // return void → pass-through (do NOT override Mulligan's filter).
});

// PATTERN (orchestrator read-back): a smokeLog pass/fail line does NOT fail a scenario by itself — the asserter must
// read it back and assert(). Two-signal guard: tool K-text (content existed+pinned) + context-handler seed-absence
// (content hidden). Either signal alone is insufficient; together they cannot pass vacuously.
const hidingLines = smoke.lines.filter((l) => l.test === "F-rewind-core.hiding");
assert(results, "seed reply HIDDEN …", hidingLines.length && hidingLines[hidingLines.length-1].status === "pass", …);
```

### Integration Points

```yaml
EDITS (this task — confined to the two test/integration files):
  - test/integration/smoke.ts: +2 consts (SEED_ANCHOR/SEED_HIDDEN), +1 module var (currentScenario), driveScenario
      +normalize +2 cases (F-checkpoint-set/F-checkpoint-rewind), context handler +2 fields +2 scenario-scoped HARD
      smokeLog assertions. ~25 new lines.
  - test/integration/run-smoke.mjs: +2 string literals (SEED_ANCHOR/SEED_HIDDEN), runPi {prompts} refactor, runScenario
      +2 seed-flow special-cases, assertRewindCore rewrite (+K≥1 +seed-hidden, −old SOFT), assertCheckpoint rewrite
      (+setCheckpoint-succeeded +K>0 +hiding). ~40 changed lines.

NO SOURCE EDITS. NO NEW FILES. NO NEW DEPS. NO config/API/spec change.
- src/* (transforms.ts/markers.ts/tools/*): ALL READ-ONLY (the fix code is LANDED in P1.M1/P1.M2).
- test/transforms.test.ts: READ-ONLY (P1.M3.T1.S1 LANDED the unit-tier guard).
- test/integration/scenarios.md: doc update is P1.M4 — OUT OF SCOPE (but note F-rewind-core hiding is now deterministic).

PARALLEL-COORDINATION:
  - P1.M3.T1.S1 LANDED unit tests in test/transforms.test.ts (706 vitest). It does NOT touch smoke.ts/run-smoke.mjs →
    no collision. This task is the integration-tier complement.
```

---

## Validation Loop

### Level 1: Type-safety (run after Task 1)

```bash
npx tsc --noEmit -p tsconfig.json          # MUST exit 0 (smoke.ts type-checks under strict; run-smoke.mjs is not checked)
# NOTE: no eslint/prettier (GOTCHA #10). The type+style gate IS tsc. Do NOT run a lint/format command.
```

### Level 2: Unit Tests (regression guard)

```bash
# smoke.ts is NOT a vitest test → the suite is unchanged. Confirm no regression:
npx vitest run                             # expect 18 files / 706 tests green (UNCHANGED from baseline)
```

### Level 3: Integration Testing (THE gate for this task)

```bash
# (3a) Confirm the empirical claims BEFORE trusting the new assertions (reproduce research/notes.md). Fresh $$ sessions:
SID=rw$$; LOG=$(mktemp); MULLIGAN_SMOKE_LOG="$LOG" pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id $SID \
  -p "Reply with exactly: MULLIGAN-SMOKE-SEED-HIDDEN" -p "/mulligan_smoke F-rewind-core" -p "Reply with exactly: OK" >/dev/null 2>&1
grep tool.rewind "$LOG"        # EXPECT: "1 messages will be hidden …" (K=1). If "0 messages will be hidden" → seed did not commit; check the model/key.
grep F-rewind-core.hiding "$LOG"  # EXPECT: status "pass" (seedHiddenInAssistant:false).

SID=cp$$; LOG=$(mktemp); MULLIGAN_SMOKE_LOG="$LOG" pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id $SID \
  -p "Reply with exactly: MULLIGAN-SMOKE-SEED-ANCHOR" -p "/mulligan_smoke F-checkpoint-set" \
  -p "Reply with exactly: MULLIGAN-SMOKE-SEED-HIDDEN" -p "/mulligan_smoke F-checkpoint-rewind" -p "Reply with exactly: OK" >/dev/null 2>&1
grep tool.checkpoint "$LOG"    # EXPECT: "checkpoint 'alpha' set …" (NOT "refused").
grep tool.rewind "$LOG"        # EXPECT: "2 messages will be hidden …" (K=2). If "0 messages" or "refused" → BUG-003 alive or seed missing.
grep F-checkpoint.hiding "$LOG"   # EXPECT: status "pass" (seedHiddenInAssistant:false AND seedAnchorInAssistant:true).

# (3b) Run the full deterministic suite (the real gate). Exits 0 iff all 14 scenarios pass:
node test/integration/run-smoke.mjs
# EXPECT: "PASS F-rewind-core" + "PASS F-checkpoint" (with the new assertions green) + the other 12 PASS; "14/14 scenarios passed".

# If F-rewind-core/F-checkpoint FAIL: read the per-assertion ✗ lines. The most likely cause is a seed-canary string
# MISMATCH between smoke.ts and run-smoke.mjs (GOTCHA #8) or a model timeout (K=0 → honest fail; re-run with a working key).
```

### Level 4: Creative & Domain-Specific Validation (regression-injection sanity check)

```bash
# PROVE the new assertions actually CATCH the bugs (otherwise they are vacuous — the exact failure mode attempt 1 fled).
# Temporarily NEUTER pinning in src/transforms.ts resolvePinnedHide (return {remove:[]} at the top), rebuild, and run:
#   node test/integration/run-smoke.mjs   → EXPECT F-rewind-core FAIL ("seed reply LEAKED BACK") + F-checkpoint FAIL.
# Then REVERT the src edit (git checkout src/transforms.ts) and re-run → EXPECT all green again.
# (This is a MANUAL sanity check for the implementer; do NOT commit the src neuter. It confirms the two-signal guard
#  is live: without pinning, the seed reply reappears in the view → the context-handler verdict flips to fail.)
# NOTE: if you do this, run `git checkout src/transforms.ts` afterward and re-run `npx vitest run` (expect 706 green)
#       + `node test/integration/run-smoke.mjs` (expect 14/14) to confirm a clean restore.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] Level 2 passed: `npx vitest run` → 18 files / 706 tests green (unchanged).
- [ ] Level 3 passed: `node test/integration/run-smoke.mjs` → 14/14 scenarios passed (F-rewind-core + F-checkpoint green
      with the NEW K + hiding assertions firing).
- [ ] Level 4 (manual): regression-injection (neuter resolvePinnedHide) flips F-rewind-core + F-checkpoint to FAIL;
      revert restores green. (Confirms the guard is non-vacuous.)
- [ ] No lint/format command invented (GOTCHA #10).

### Feature Validation

- [ ] F-rewind-core: `tool.rewind` K≥1 (not "0 messages will be hidden"); `F-rewind-core.hiding` pass (seed reply hidden).
- [ ] F-checkpoint: setCheckpoint SUCCEEDED (not refused); rewind K>0 (BUG-003 guard); `F-checkpoint.hiding` pass
      (post-checkpoint seed hidden + anchor survives).
- [ ] The baseline F-checkpoint breakage is FIXED (setCheckpoint succeeds via the seed anchor).
- [ ] NO `msgCanaryPresent===false` assertion anywhere (it is impossible — GOTCHA #1).
- [ ] The context handler still returns void (OBSERVER — does not override the filter).

### Code Quality Validation

- [ ] All new smoke.ts blocks are never-throwing (inside try/catch); mirror the existing harness discipline.
- [ ] Seed-canary string literals are IDENTICAL between smoke.ts and run-smoke.mjs (GOTCHA #8).
- [ ] Seed detection is role-gated (`role === "assistant"`) — not bare substring (GOTCHA #5).
- [ ] `currentScenario` is normalized so the F-checkpoint assertion fires on the rewind phase (GOTCHA #6).
- [ ] The HARD smokeLog verdicts are READ BACK by the asserters and converted to assert() (GOTCHA #7).
- [ ] Minimal changes (no new tools/events/scenarios beyond the two); F-rewind-core recipe unchanged.

### Documentation & Deployment

- [ ] No source/config/API/spec change (test-only).
- [ ] The model-dependence of the 2 seeded scenarios is documented (GOTCHA #9) — they need working model turns, same as
      the session-JSONL persistence the suite already relies on; on timeout they FAIL honestly (K=0), never silently pass.
- [ ] scenarios.md is NOT edited here (doc sync is P1.M4 — out of scope); a note that F-rewind-core hiding is now
      deterministic is left for P1.M4.

---

## Anti-Patterns to Avoid

- ❌ Don't assert `msgCanaryPresent===false` — the session-start canary precedes the first user message; last_turn can
  never hide it. Assert the SEED canaries (committed AFTER the first user message) instead. (GOTCHA #1.)
- ❌ Don't try to create hideable content INSIDE a single command handler (pi.sendMessage custom_message, appendEntry) —
  attempt 1 proved it gives K=0. Use a PREPENDED seed model turn (run-smoke.mjs `-p`). (GOTCHA #2.)
- ❌ Don't make the context handler return `{messages}` — it would override Mulligan's filter. It returns void (OBSERVER).
- ❌ Don't detect the seed by bare substring (`has(SEED)`) — the user PROMPT also contains it; gate on `role:"assistant"`.
- ❌ Don't rely on a smokeLog `status:"fail"` line alone to fail a scenario — the asserter must read it back + assert().
- ❌ Don't add a "skip on model timeout" escape hatch — that makes the guard vacuous (the failure mode attempt 1 fled).
  On timeout, FAIL with the clear K=0/seed-missing message (honest).
- ❌ Don't mismatch the seed-canary strings between smoke.ts and run-smoke.mjs — the seed never matches → K=0 → fail.
- ❌ Don't edit ANY src/* file (test-only; the fix code is LANDED). (The Level-4 regression-injection neuter is MANUAL
  and MUST be reverted with `git checkout`.)
- ❌ Don't duplicate P1.M3.T1.S1's unit tests — this is the integration-tier complement (different files).
- ❌ Don't skip Level 3/4 — the whole point is that the new assertions are REAL and CATCH the bugs; verify it.

---

## Confidence Score: 9/10 — EMPIRICALLY VERIFIED END-TO-END (the -1 is seed-model-turn nondeterminism)

Both contracts were PROBED against the REAL pi 0.84.1 + REAL tools on fresh `$$`-suffixed sessions (research/notes.md):
- F-rewind-core seed → rewind K=1 + observer `roles=[custom,user,custom,user]` (no assistant survives → seed hidden). ✓
- F-checkpoint seed split → setCheckpoint "checkpoint 'alpha' set" + rewind K=2. ✓
- Baseline breakage reproduced (2-prompt F-checkpoint refuses) → the seed flow fixes it. ✓

The exact edits above are line-by-line and copy-verbatim. The one residual risk (GOTCHA #9 / residual risk #1) is that a
model occasionally ignores the seed instruction or times out → K=0 → honest FAIL (not a false pass). The K-assertion
makes this self-diagnosing. The regression-injection check (Level 4) proves the guard is non-vacuous. The previous
attempt's "impossible" conclusion is overtaken by the seed mechanism, which is the SAME model-dependence the suite
already accepts for session-JSONL persistence.