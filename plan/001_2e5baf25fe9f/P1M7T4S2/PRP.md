# PRP — P1.M7.T4.S2: Verify zero-config default behavior and finalize

**Work item:** P1.M7.T4.S2 · **Points:** 0.5 · **Stage:** Integration, Hardening & Documentation (spec/11-build-order.md
§3 "Definition of done" + §2 Step 9; Mode B — "Final verification pass; any README corrections discovered during
verification are applied"). **This is the CONVERGENCE task — the last subtask in the entire P1 plan.**
**Scope:** RUN the full Definition-of-Done verification suite for the complete pi-mulligan v1.0 extension, FIX any
genuine failures found (src/ edits ARE permitted here, unlike the docs-only S1), APPLY README corrections discovered
during verification (Mode B), and do final cleanup. The deliverable is a **verified, green v1.0 extension that meets
all 6 Definition-of-Done criteria.**

> **NOT a greenfield build.** The prior 26 subtasks (M1→M7.T3) built the entire extension; S1 (parallel) writes the
> README. S2 is the final gate-keeper. **Bias heavily toward NOT changing code**: if every gate is green, the work is
> "run gates → confirm green → apply any README corrections → trivial cleanup → done." Code edits happen ONLY when a
> gate is red AND the root cause is a real v1 bug in scope (not a stale test). The expected change footprint is tiny
> (0.5 points). The ground-truth state of every gate is captured in `research/verification-gates.md` — READ IT FIRST.

---

## Goal

**Feature Goal**: Prove (don't assert) that the complete pi-mulligan v1.0 extension meets all 6 spec/11 §3
"Definition of done" criteria, by running each as a deterministic gate; fix any genuine failure; finalize (README
corrections + cleanup). End state: a releaseable v1.0 where `npm test` is 671/671 green, `npx tsc --noEmit` is exit 0,
`pi -e ./src/index.ts` loads with zero config and no error, all 9 F-* smoke scenarios pass, `mulligan:nudge` provably
never persists, `config.enabled=false` is a pure no-op, an intentional filter exception never breaks a turn, and the
README is accurate to the shipped code.

**Deliverable**: ONE verified green codebase + a short **`VERIFICATION.md`** report (NEW file at repo root — the
evidence trail that all 6 DoD criteria pass, with the exact command + observed result for each). Plus any src/ fixes
required to make a red gate green, plus any README.md accuracy corrections (Mode B). **The codebase is the deliverable;
VERIFICATION.md is the receipt.**

**Success Definition** (all must hold):
- `npm test` → **671 passed, 0 failed** (incl. the pairing-invariant property test — `test/transforms.test.ts`).
- `npx tsc --noEmit` → **exit 0** (typebox schemas + strict types compile clean).
- `pi -e ./src/index.ts -p "Reply with the single word: ok"` → **no extension-load error** (zero-config smoke; a
  model/API timeout is NOT a load failure — see GOTCHA #5).
- `npm run smoke` → **9/9 F-* scenarios PASS**.
- `grep -rl "mulligan:nudge"` across the smoke temp dir + session JSONL → **0 files** (DoD #3).
- `config.enabled=false` no-op verified: the 5 entry-point gates exist (grep) + the disabled-path unit tests are green
  (DoD #4; `enabled-disabled-analysis.md`).
- `README.md` exists (S1) and its accuracy claims hold against the shipped code (Mode B corrections applied if not).
- `VERIFICATION.md` exists at repo root documenting each gate's command + result.

---

## User Persona

**Target User**: (a) **The release reviewer / maintainer** — needs a single document proving the v1.0 changeset is
done, with reproducible commands. (b) **The next person to touch pi-mulligan** — needs confidence the baseline is
green before they change anything (the VERIFICATION.md report is the regression anchor).

**Use Case**: A reviewer opens VERIFICATION.md, sees all 6 DoD criteria with the exact command + observed green
result, re-runs the gates themselves to confirm, and signs off the v1.0 release.

**Pain Points Addressed**: 26 subtasks of code + a README were produced across many sessions. Without a final
verification pass, there's no single proof that (a) the whole thing compiles + tests green together, (b) the zero-config
claim is actually true end-to-end, (c) the nudge never leaks to disk, (d) disabling is a true no-op, (e) fail-open holds,
(f) the README matches the code. S2 closes that gap.

---

## Why

- **spec/11 §3 "Definition of done"** is the explicit contract — 6 numbered criteria. This task RUNS all 6 as gates.
  It is literally the "is it done?" checkpoint for the entire project.
- **spec/11 §2 Step 9 (Polish)**: "Confirm `pi -e ./src/index.ts` with no mulligan config works out of the box (all
  defaults)." The zero-config smoke is a Step-9 acceptance test — S2 runs it.
- **Mode B (changeset-level documentation).** S2 is the "final verification pass" Mode-B task: it doesn't write new
  feature docs, it VERIFIES the docs (README from S1) against the shipped code and applies corrections.
- **Convergence + regression anchor.** As the last subtask, S2 is the only point where the ENTIRE extension is
  exercised together. VERIFICATION.md becomes the regression baseline for v1.1+ (settings-driven config, marker GC,
  etc. are all explicitly v1.1+ — see README Known Limitations).

---

## What

A gate-by-gate verification of the 6 Definition-of-Done criteria, executed in dependency order, with a fix-then-re-run
discipline for any red gate. **The implementer's workflow is a decision tree, not a file-creation list** — see
Implementation Tasks. The visible behavior: a green test suite, a green type check, a clean zero-config load, 9/9 smoke
scenarios, zero nudge persistence, a confirmed disable-no-op, surviving fail-open, an accurate README, and a
VERIFICATION.md report.

### Success Criteria (mapped to spec/11 §3)

- [ ] **DoD #1** — `npm test` → 671/671 green (incl. pairing-invariant property test on randomized inputs).
- [ ] **DoD #2** — `npm run smoke` → 9/9 F-* scenarios PASS (log + JSONL assertions).
- [ ] **DoD #3** — `grep -rl "mulligan:nudge"` over smoke temp dir + session JSONL → 0 files.
- [ ] **DoD #4** — `config.enabled=false` pure no-op: 5 entry-point gates present (grep) + disabled unit tests green.
- [ ] **DoD #5** — intentional filter exception does not break the turn: `filter.test.ts` fail-open tests green + F-failopen PASS.
- [ ] **DoD #6** — README documents install, the four tools, configuration, the soft-delete guarantee; zero-config claim verified.
- [ ] **Bonus** — typebox schemas compile (`npx tsc --noEmit` exit 0); `VERIFICATION.md` written.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_
> — **Yes.** This task's "implementation" is running gates + fixing failures. `research/verification-gates.md` gives
> the LIVE state of every gate (current pass/fail counts, exact failing test names, the line-level code-correct proofs
> for the gates that can't be run live). `research/enabled-disabled-analysis.md` is the DoD #4 proof. The implementer
> reads those two files + the cited src/ lines, runs each gate, and follows the fix decision tree. No codebase
> reasoning is required beyond diagnosing a specific red gate (and the research files name the likely fix site for each).

### Documentation & References

```yaml
# MUST READ FIRST — this task's research (the gate ground-truth + fix-site map)
- file: plan/001_2e5baf25fe9f/P1M7T4S2/research/verification-gates.md
  why: "The LIVE state of every DoD gate (§1 the 6-criteria table), the 4 currently-failing tests + that they're
        P1.M7.T3.S1's in-flight work (§2 — the BLOCKER), the nudge-leak proof (§3), the typebox compile status (§4),
        the zero-config smoke mechanics (§5), the gate-command cheat sheet (§9), and the permitted-edit policy (§10)."
  section: "All 10 sections; especially §1 (the gates table), §2 (the 4 red tests), §9 (command cheat sheet)."
- file: plan/001_2e5baf25fe9f/P1M7T4S2/research/enabled-disabled-analysis.md
  why: "DoD #4 line-level proof: the 5 master-switch gates (filter/rewind/shrink/nudges×2) + the 2 intentionally
        non-gated entry points (audit/checkpoint — do NOT 'fix'). Plus how DoD #4 is verified in v1 (unit-level, since
        settings-reading is v1.1) + the 4 unit-test files that exercise the disabled paths."
  section: "The 5-gate table + 'Intentionally NON-gated' table + 'How verified in v1'."

# MUST READ — the Definition-of-Done contract + the build-order (the authoritative checklist)
- file: spec/11-build-order.md
  why: "§3 'Definition of done' is the 6-criteria contract this task gates against. §2 Step 9 (Polish) is the
        zero-config smoke acceptance check. §1 is the file-layout (the tree you're verifying)."
  section: "§3 (the 6 criteria) + §2 Step 9."

# MUST READ — the parallel S1 PRP (the README contract S2 verifies + may correct)
- file: plan/001_2e5baf25fe9f/P1M7T4S1/PRP.md
  why: "S1 produces README.md per THIS contract. S2's gate (6) cross-checks the README's accuracy claims against src/
        (the verbatim *_DESC strings, the 12-knob config table vs DEFAULT_CONFIG, the zero-config claim, the Disabling
        note's POST-E14 consistency). READ S1's Validation Loop (Level 2 accuracy cross-checks) — S2 re-runs them."
  section: "Goal (Success Definition: 6 README accuracy bullets) + Validation Loop Level 2."

# MUST READ — the entry points S2 verifies (read-only, cite the exact gate lines)
- file: src/index.ts
  section: "Line 29 (setConfig(undefined) → DEFAULT_CONFIG — the zero-config guarantee) + the factory wiring."
  why: "Confirms zero-config load + that 4 tools + 3 handlers + lifecycle are registered. Gate (b) exercises this."
- file: src/filter.ts
  section: "Line 180 (if (!config.enabled) return — the no-op gate) + the whole-body try/catch fail-open."
  why: "DoD #4 (no-op gate) + DoD #5 (fail-open) live here. Confirms pass-through does NOT pollute the audit cache."
- file: src/tools/rewind.ts
  section: "Line 322 (if (!config.enabled) return refusal('Mulligan is disabled', granularity) — E14 LANDED)."
- file: src/tools/shrink.ts
  section: "Line 235 (if (!config.enabled) return refusal('Mulligan is disabled') — E14 LANDED)."
- file: src/tools/audit.ts
  section: "Lines 22-23 (GOTCHA #4 — INTENTIONALLY no enabled gate; always-on read-only diagnostics)."
  why: "DoD #4 reviewer trap: audit being always-on is CORRECT. Do NOT add a gate. enabled-disabled-analysis.md."
- file: src/tools/checkpoint.ts
  section: "Lines 27-28 (GOTCHA #4 — INTENTIONALLY no enabled gate; spec/09 has no checkpoint.enabled knob)."
- file: src/nudges.ts
  section: "Line 98 (bloat no-op gate) + line 176 (turn_end no-op gate) + injectNudge (the nudge-never-persists proof)."
  why: "DoD #4 (both gates short-circuit before measurement) + DoD #3 (injectNudge returns a COPY, never pi.sendMessage)."
- file: src/config.ts
  section: "DEFAULT_CONFIG (the 12-knob table source of truth) + validateConfig (never-throws — the zero-config root)."

# MUST READ — the verification surface (the gates' harnesses)
- file: test/integration/run-smoke.mjs
  why: "The orchestrator S2 runs (npm run smoke). §assertGlobalInvariants is the DoD #3 nudge-leak check; each
        assertXxx is a DoD #2 scenario. Detects 'EXTENSION LOAD FAILED' distinctly (GOTCHA #12)."
- file: test/integration/scenarios.md
  why: "How each F-* scenario is run + which assertions are deterministic vs model-driven (the 'soft' notes)."
- file: test/filter.test.ts
  why: "The fail-open unit tests (DoD #5): 'throwing filterPipeline caught', 'throwing getSessionId caught',
        'readMarkers never throws when getEntries throws', + 'pass-through when config.enabled false' (DoD #4)."

# REFERENCE — the spec the gates encode
- file: spec/10-testing.md
  why: "The two-tier strategy (pure-unit + integration-smoke) + the F-* scenario definitions + the §2.3 entry-shape
        invariants the smoke asserts. §1.6-1.8 + §1.1-1.5 + §1.9 are the Tier-1 unit-test tiers (DoD #1)."
```

### Current Codebase tree (state at this subtask's start)

```bash
pi-mulligan/
├── package.json            # scripts: test=vitest run, smoke=node test/integration/run-smoke.mjs
├── tsconfig.json           # strict, include:['src','test'], skipLibCheck
├── .gitignore              # dist/, node_modules/, .env
├── README.md               # ← S1 produces this (parallel; may not exist yet at S2 start — SEE PREREQUISITE)
├── VERIFICATION.md         # ← DOES NOT EXIST — THIS TASK CREATES IT (the evidence report).
├── spec/                   # SPEC.md + 01-12 (read-only; the DoD source: spec/11 §3)
├── src/                    # THE COMPLETE EXTENSION (index.ts + config.ts + tools/ + nudges.ts + filter.ts + ...)
│   ├── index.ts            # factory: line 29 setConfig(undefined) → DEFAULT_CONFIG (zero-config)
│   ├── filter.ts           # context handler: line 180 enabled gate + whole-body try/catch fail-open
│   ├── nudges.ts           # line 98/176 enabled gates + injectNudge (nudge-never-persists)
│   ├── tools/{rewind,shrink,checkpoint,audit}.ts  # rewind:322 + shrink:235 enabled gates (E14 LANDED)
│   └── config.ts           # DEFAULT_CONFIG (12 knobs) + validateConfig (never throws)
├── test/                   # vitest unit tests (18 files, 671 tests) + integration/{smoke.ts,run-smoke.mjs,scenarios.md}
└── .pi/extensions/         # empty (auto-discovery dir; dev uses `pi -e`)
# LIVE STATE (research): tsc exit 0 ✓ ; npm test 667/671 (4 fail in edge-cases.test.ts — P1.M7.T3.S1 in-flight).
```

### Desired Codebase tree with files to be ADDED/CHANGED (this subtask)

```bash
pi-mulligan/
├── VERIFICATION.md   # NEW (repo root). The evidence report: each DoD criterion → command → observed result.
├── README.md         # CHANGED ONLY if verification finds an inaccuracy (Mode B corrections). Otherwise untouched.
└── src/**, test/**   # CHANGED ONLY if a gate is red and the root cause is a real v1 bug. Bias to NO change.
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (BLOCKER — the 4 red tests are NOT yours to introduce) — at research time `npm test` reported
#   667 passed / 4 FAILED, ALL in test/edge-cases.test.ts (E5 mutation-warning text; E13 fail-open ×3: contextHandler
#   getEntries-throw, makeRewindTool appendEntry-throw, makeShrinkTool appendEntry-throw). These are P1.M7.T3.S1's
#   in-flight edge-case fixes (status "Implementing"). S2 MUST NOT START until P1.M7.T3.S1 is Complete (all 671 green).
#   If you run gate (a) and these 4 are STILL red, that is a hard blocker: STOP, report it (do not paper over a red
#   gate, do not `.skip` the tests). S2's job is to verify the CONVERGED green state, not to finish M7.T3.S1's work.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (DoD #4 is unit-verified in v1, NOT settings-driven) — index.ts:29 hardcodes setConfig(undefined) →
#   DEFAULT_CONFIG (enabled:true). The factory does NOT read settings.mulligan ("reading real settings.mulligan is
#   v1.1" — index.ts:28). So at RUNTIME, enabled is ALWAYS true via Pi settings in v1. DoD #4 ("config.enabled=false
#   → pure no-op") is therefore verified at the UNIT level: setConfig({enabled:false}) then assert each entry point
#   (filter.test.ts pass-through; config.test.ts round-trip; tools tests' E14 refusal). Do NOT try to set
#   enabled:false via .pi/settings.json — index.ts ignores it in v1, so a settings-driven test would be meaningless.
#   See research/enabled-disabled-analysis.md.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (audit + checkpoint are INTENTIONALLY non-gated — do NOT "fix") — mulligan_audit (audit.ts:22-23 GOTCHA #4)
#   and mulligan_checkpoint (checkpoint.ts:27-28 GOTCHA #4) have NO config.enabled gate BY DESIGN: audit is always-on
#   read-only diagnostics (you'd want it most when debugging a misbehaving agent); checkpoint is a harmless label
#   (spec/09 has no checkpoint.enabled knob). If a reviewer flags "audit doesn't check enabled," that's CORRECT —
#   point at the GOTCHA #4 comments. Adding a gate would be a regression. DoD #4's "pure no-op" applies to the 5
#   GATED entry points (filter, rewind, shrink, bloat nudge, turn_end nudge), NOT audit/checkpoint.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (DoD #3 nudge-leak is code-correct — a leak would be a REAL bug) — injectNudge (nudges.ts) constructs the
#   mulligan:nudge CustomMessage in a RETURNED COPY ([...messages, nudge]); it has NO pi parameter and never calls
#   pi.sendMessage. Pi persists the ORIGINAL branch untouched → mulligan:nudge can never land in the session JSONL. If
#   the grep gate finds >0, the leak is in injectNudge (must not persist) OR filter.ts contextHandler (must return the
#   copy, not persist it). Fix there. The smoke's assertGlobalInvariants is the primary check; the direct grep is the
#   belt-and-suspenders proof across ALL session JSONL, not just the asserted scenarios.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (zero-config smoke: LOAD success ≠ model response) — `pi -e ./src/index.ts -p "..."` loads the factory
#   (setConfig(undefined) → DEFAULT_CONFIG; registers 4 tools + 3 handlers + lifecycle) THEN makes a model call. The
#   acceptance check (spec/11 §2 Step 9) is the LOAD: no "Error loading extension", no stack trace at factory time. A
#   model/API timeout or a missing-API-key error happens AFTER the factory ran — the extension still loaded fine. The
#   smoke orchestrator (run-smoke.mjs GOTCHA #12) distinguishes "EXTENSION LOAD FAILED" (non-zero pi exit + empty
#   smoke log) from a model error. So: gate (b) passes if the factory loads cleanly, even if the model call fails.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (the smoke is mostly deterministic; some assertions are "soft"/model-driven) — run-smoke.mjs marks certain
#   assertions as `soft` (canary-drop, bloatHit:true, hasNudge:true) because they need the MODEL to call a tool mid-turn,
#   which a deterministic /command path can't force. These soft items LOG a warning but do NOT fail the scenario. The
#   HARD deterministic assertions (marker persists, JSONL invariants, ZERO nudges, turn survives, filter ran) are what
#   gate DoD #2/#3/#5. Do NOT treat a `soft` note as a failure. See scenarios.md + each assertXxx's `soft` field.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (README corrections: fix INACCURACIES, never the source-of-truth) — S1's README copies the 4 verbatim
#   *_DESC tool descriptions + the 12-knob config table from src/. If verification finds the README paraphrased a
#   description or mis-stated a default, fix the README to match src/ (src/ is the source of truth, NEVER the reverse).
#   Never edit src/tools/*.ts *_DESC or src/config.ts DEFAULT_CONFIG to "match" the README — that inverts the dependency.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (typebox schemas compile via tsc, not a runtime check) — the 4 tool param schemas (RewindParams,
#   ShrinkParams, CheckpointParams, AuditParams) are typebox Type.Object values; they compile cleanly (tsc exit 0,
#   verified). There's no separate "schema compile" command — `npx tsc --noEmit` IS the gate (strict + skipLibCheck).
#   typebox IS in node_modules; @earendil-works/pi-coding-agent is resolved from the GLOBAL pi at runtime (absent
#   locally by design — spec/11 §1.1). So a local `npm install` is NOT needed to type-check; it IS needed if tsc can't
#   find typebox (it's present, so it won't).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 (this task MAY edit src/ — the prior 26 subtasks are the baseline) — unlike S1 (docs-only), S2 is the
#   convergence fixer: if a gate is red and the root cause is a real v1 bug (a missing fail-open catch, a nudge leak,
#   a typo'd mutation-warning string), FIX it in src/ (or test/ if the test asserts stale behavior). But bias hard
#   toward no-op: most gates are already green (research). The fix footprint should be tiny. If you find yourself
#   rewriting logic, STOP — that's a sign the issue belongs to an earlier subtask (M3/M5/M6/M7.T3), not S2's polish.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 (the single intentional console.warn STAYS) — config.ts warnConfig() uses console.warn as the documented
#   warn seam (the comment says "the structured JSONL logger should re-point this single helper"). Do NOT remove it in
#   "final cleanup." Other stray console.log/console.error from debugging ARE cleanup targets. The JSONL logger (log.ts)
#   is the structured surface; warnConfig is deliberately console-based in v1.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

None created. `VERIFICATION.md` is a markdown evidence report (the only new file). Its "model" is the
6-criteria → command → result table (below in Implementation Patterns). No TypeScript, no schemas.

### Implementation Tasks (the verification decision tree — ordered by dependency)

```yaml
Task 0: PREREQUISITE CHECK (no edits — confirm S2 can start)
  - VERIFY P1.M7.T3.S1 is Complete: run `npm test 2>&1 | tail -5` → expect "Tests  671 passed" (0 failed).
    If 4 tests STILL fail in test/edge-cases.test.ts (E5/E13×3) → STOP: P1.M7.T3.S1 is not done; report the blocker
    (research/verification-gates.md §2). Do NOT skip/mark tests. (GOTCHA #1)
  - VERIFY P1.M7.T4.S1 produced README.md: `ls README.md` → exists. If absent → STOP: S1 not done; report it.
  - VERIFY `pi` is on PATH + the runtime deps resolve: `pi --version` → 0.84.x; `ls node_modules/typebox` → present.
    (@earendil-works/pi-coding-agent is resolved from the GLOBAL pi at runtime — GOTCHA #8; its local absence is fine.)
  - If all 3 prerequisites hold → proceed to Task 1. This is the ONLY place S2 may halt without producing a report.

Task 1: GATE (a) + typebox — Tier-1 unit tests + full type check (DoD #1)
  - RUN: `npm test`                              # = vitest run
    EXPECT: "Tests  671 passed (671)" / "Test Files  18 passed (18)". 0 failed.
  - RUN: `npx tsc --noEmit`                      # strict + skipLibCheck; typebox Type.Object schemas compile here
    EXPECT: exit 0 (no output).
  - CONFIRM (pairing-invariant property test is in the suite): the randomized property test lives in
    test/transforms.test.ts (the §3 pairing-invariant on randomized inputs — DoD #1's explicit requirement).
    `npx vitest run test/transforms.test.ts` → all green (it's part of the 671).
  - IF RED (a unit test fails): DIAGNOSE — is it (i) a real v1 bug, or (ii) a stale test asserting pre-E14/old behavior?
    Read the failing assertion + the cited src/. If (i) → fix src/ (the minimal change). If (ii) → flip the test's
    expectation to match correct current behavior. Re-run `npm test` until green. (GOTCHA #9 — keep changes tiny.)

Task 2: GATE (b) — zero-config smoke load (DoD #6 / spec/11 §2 Step 9)
  - RUN: `pi -e ./src/index.ts -p "Reply with the single word: ok" 2>&1 | head -40`
    EXPECT: NO "Error loading extension" / no stack trace at FACTORY time (the setConfig(undefined) at index.ts:29 +
      the 4 registerTool calls + the 3 pi.on registrations all succeed with zero config). The model may respond "ok"
      OR time out / error on the model call — that is NOT a load failure (GOTCHA #5).
  - DISTINGUISH: a load failure surfaces immediately at startup (a jiti import error, a wiring throw). A model error
    surfaces later (after the factory returned). The acceptance check is the former. If the factory loads clean → PASS.
  - IF RED (load error): READ the stack trace — it names the failing src/ line. Fix it (likely an import path / a
    registerTool signature / a typebox schema). Re-run. (GOTCHA #8 — typebox schemas compile via tsc, already green,
    so a load error here is more likely a runtime wiring issue than a type issue.)

Task 3: GATE (c) — config.enabled=false pure no-op (DoD #4)
  - CODE-INSPECTION (grep the 5 master-switch gates exist):
      grep -n '!config.enabled\|!cfg.enabled' src/filter.ts src/tools/rewind.ts src/tools/shrink.ts src/nudges.ts
    EXPECT: filter.ts:180, rewind.ts:322, shrink.ts:235, nudges.ts:98, nudges.ts:176 (5 hits).
  - CODE-INSPECTION (E14 refusal text LANDED): grep -rn "Mulligan is disabled" src/tools/
    EXPECT: present in rewind.ts AND shrink.ts (the post-E14 final behavior).
  - CODE-INSPECTION (audit/checkpoint intentionally non-gated — GOTCHA #3): confirm audit.ts:22-23 + checkpoint.ts:27-28
    have the GOTCHA #4 comments. Do NOT add a gate. (If one was accidentally added by a prior task, REMOVE it — that
    would be a regression; but research shows neither has a gate.)
  - UNIT-LEVEL (v1 verifies DoD #4 here — GOTCHA #2): run the disabled-path tests explicitly:
      npx vitest run test/config.test.ts test/filter.test.ts test/tools/rewind.test.ts test/tools/shrink.test.ts
    EXPECT: all green — incl. filter.test.ts:171 "pass-through when config.enabled false", config.test.ts:64-74
      enabled:false round-trip, the tools' E14 refusal paths.
  - IF RED: diagnose per enabled-disabled-analysis.md (the 5 gates + the 4 test files). The likely fix is a missing
    `if (!config.enabled)` early-return at the exact entry point the failing test names. Re-run until green.

Task 4: GATE (2) + (d) + (5) — integration smoke + nudge-leak + fail-open (DoD #2/#3/#5)
  - RUN: `npm run smoke`                          # = node test/integration/run-smoke.mjs ; 9 F-* scenarios
    EXPECT: "9/9 scenarios passed" (exit 0). Each scenario's HARD assertions green; `soft` notes are warnings, NOT
      failures (GOTCHA #6). F-failopen asserts pi exits 0 + context.fire logged (DoD #5 deterministic proof).
  - RUN (DoD #3 nudge-leak — belt-and-suspenders grep across ALL smoke session JSONL):
      SMOKE_DIR="${TMPDIR:-/tmp}/mulligan-smoke"
      grep -rl 'mulligan:nudge' "$SMOKE_DIR" 2>/dev/null | wc -l        # EXPECT 0
      # also sweep any pi session dir the smoke may have written:
      grep -rl 'mulligan:nudge' ~/.pi/sessions 2>/dev/null | wc -l       # EXPECT 0 (or no such dir)
    EXPECT: 0. The smoke's assertGlobalInvariants already checks this per-scenario; the grep is the cross-file proof.
  - CONFIRM (DoD #5 authoritative unit proof): `npx vitest run test/filter.test.ts -t "fail-open"` → green (the
    contextHandler whole-body try/catch + readMarkers getEntries-throw catch).
  - IF RED (a scenario fails): read run-smoke.mjs's per-scenario ✗ lines (they name the exact assertion). If it's a
    `soft` note → NOT a failure (GOTCHA #6). If it's a HARD assertion → diagnose: is it a model timeout (JSONL
    unavailable → the scenario logs "⚠ JSONL unavailable" and the smoke-log assertions are primary) or a real bug?
    A real bug → fix in src/ (filter.ts for transform issues; tools/*.ts for tool issues; nudges.ts for nudge issues).
    A nudge-leak (>0 mulligan:nudge on disk) → fix injectNudge/contextHandler (GOTCHA #4). Re-run until 9/9 + 0 nudges.

Task 5: GATE (6) — README accuracy cross-check + Mode B corrections (DoD #6)
  - VERIFY README exists (Task 0 confirmed). Cross-check S1's accuracy claims (re-run S1 PRP Validation Loop Level 2):
    (a) The 4 tool descriptions are VERBATIM from src/tools/*.ts *_DESC — copy-equality, not paraphrase.
    (b) The 12-knob config table matches src/config.ts DEFAULT_CONFIG (exact defaults).
    (c) The Disabling note ↔ the enabled config row ↔ the Guarantees are consistent + reflect POST-E14 behavior
        (master switch → whole extension no-op; tools refuse "Mulligan is disabled").
    (d) The zero-config claim is TRUE (Task 2 proved it).
  - IF an inaccuracy is found → APPLY the correction to README.md (Mode B). src/ is the source of truth — fix the
    README to match src/, NEVER edit src/ to match the README (GOTCHA #7). Re-run the cross-check until clean.
  - IF the README is fully accurate → no edit (the common case if S1 was thorough).

Task 6: FINAL CLEANUP + WRITE VERIFICATION.md (the report)
  - CLEANUP (low-risk, only if present): stray TODO/FIXME comments referencing already-resolved edge cases; dead
    imports; debugging console.log/console.error (NOT the intentional config.ts warnConfig console.warn — GOTCHA #10).
    Run `npm test` after any cleanup to confirm still green.
  - WRITE VERIFICATION.md at repo root — the evidence report. One section per DoD criterion, each = the command run +
    the observed result + a one-line interpretation. Include: the gate-command cheat sheet (research §9), the 6 DoD
    criteria → status table, the soft-vs-hard smoke note (GOTCHA #6), and the v1 settings-vs-unit nuance for DoD #4
    (GOTCHA #2). This is the regression anchor for v1.1+. (Template in Implementation Patterns below.)
  - FINAL RE-RUN of all gates in sequence (npm test → tsc → zero-config load → smoke → nudge grep → README check) to
    confirm the green state is reproducible after any edits. Record the final results in VERIFICATION.md.
```

### Implementation Patterns & Key Details

```markdown
# The VERIFICATION.md report skeleton (the ONE new file — the evidence trail):

# pi-mulligan v1.0 — Verification Report

> Generated by P1.M7.T4.S2 (spec/11 §3 "Definition of done" final pass). Reproduce by running each gate command.

## DoD criteria — status

| # | Criterion (spec/11 §3) | Gate command | Result |
|---|---|---|---|
| 1 | Tier-1 unit tests green (incl. pairing-invariant property test) | `npm test` | 671 passed, 0 failed ✓ |
| 2 | All F-* integration scenarios green | `npm run smoke` | 9/9 PASS ✓ |
| 3 | mulligan:nudge never persisted | `grep -rl mulligan:nudge <smoke-dir> \| wc -l` | 0 ✓ |
| 4 | config.enabled=false → pure no-op | (unit-level in v1) grep gates + disabled unit tests | 5 gates present + tests green ✓ |
| 5 | Intentional filter exception doesn't break turn | filter.test.ts fail-open + F-failopen | green + PASS ✓ |
| 6 | README documents everything | cross-check vs src/ | accurate ✓ |
| + | typebox schemas compile | `npx tsc --noEmit` | exit 0 ✓ |
| + | zero-config smoke load | `pi -e ./src/index.ts -p "..."` | no load error ✓ |

## Notes
- DoD #4 is verified at the unit level in v1 (index.ts:29 setConfig(undefined); settings-reading is v1.1). See
  enabled-disabled-analysis.md.
- Smoke `soft` assertions (canary-drop, bloatHit:true, hasNudge:true) are model-driven warnings, not failures.
- audit.ts + checkpoint.ts are intentionally non-gated (always-on read-only diagnostics) — not a DoD #4 violation.

## Fixes applied during this pass
- (list each src/README/test change with the gate that surfaced it + the root cause; or "none — all gates green on first run.")

# The gate-command cheat sheet (the exact one-liners — also in research §9):

npm test                                        # DoD #1 (vitest run; expect 671 passed, 0 failed)
npx tsc --noEmit                                # typebox + strict types (expect exit 0)
pi -e ./src/index.ts -p "Reply with the single word: ok"   # DoD #6 zero-config smoke (expect no load error)
npm run smoke                                   # DoD #2/#3/#5 (expect 9/9 PASS)
grep -rl 'mulligan:nudge' "${TMPDIR:-/tmp}/mulligan-smoke" 2>/dev/null | wc -l   # DoD #3 (expect 0)
npx vitest run test/config.test.ts test/filter.test.ts test/tools/rewind.test.ts test/tools/shrink.test.ts  # DoD #4
ls README.md && grep -c "Mulligan is disabled" README.md   # DoD #6 README accuracy (Disabling note present)

# The fix-decision tree (when a gate is RED):

1. Is it a SOFT smoke note (canary-drop/bloatHit/hasNudge)?  → NOT a failure (GOTCHA #6). Proceed.
2. Is it a model timeout (JSONL unavailable)?                → NOT an extension bug. Smoke-log assertions are primary. Proceed.
3. Is it a stale test asserting pre-E14/old behavior?        → flip the test expectation to correct behavior (test/).
4. Is it a real v1 bug?                                      → minimal src/ fix at the named site; re-run the gate.
   - DoD #3 nudge-leak   → nudges.ts injectNudge (must not persist) / filter.ts contextHandler (must return the copy).
   - DoD #4 missing gate → add `if (!config.enabled) return [refusal|];` at the exact entry point (NEVER audit/checkpoint — GOTCHA #3).
   - DoD #5 fail-open    → ensure the whole handler/tool body is one try/catch → pass-through/refusal (filter.ts/tools).
   - README inaccuracy   → fix README to match src/ (NEVER the reverse — GOTCHA #7).
5. Is it a wholesale logic rewrite?                          → STOP. That belongs to an earlier subtask (M3/M5/M6/M7.T3), not S2's polish (GOTCHA #9).
```

### Integration Points

```yaml
DOCUMENTATION (this task's NEW output):
  - VERIFICATION.md at repo root. The evidence report + regression anchor. One section per DoD criterion.
  - README.md: CHANGED ONLY if verification finds an inaccuracy (Mode B). src/ is the source of truth.

CODE (this task MAY edit, but biases to no-op):
  - src/*.ts, src/tools/*.ts: ONLY a genuine v1 bug found by a gate (a nudge leak, a missing fail-open catch, a
    missing/wrong enabled gate, a typo'd mutation-warning string). Minimal change; re-run npm test after.
  - test/*.ts: ONLY if a test asserts stale behavior and the code is correct. Flip the expectation. Rare.

NEVER TOUCH (out of scope / owned elsewhere):
  - spec/** (read-only reference), package.json/tsconfig.json/.gitignore (frozen), plan/**/tasks.json +
    **/prd_snapshot.md (orchestrator-owned).

PARALLEL/SIBLING COUPLING:
  - P1.M7.T3.S1 (edge-case hardening — "Implementing"): MUST be Complete before S2 starts (the 4 red tests are its
    work — GOTCHA #1). S2's Task 0 prerequisite check enforces this.
  - P1.M7.T4.S1 (README — parallel): MUST be Complete before S2 starts. S2's Task 5 verifies + may correct its output.
```

---

## Validation Loop

> S2's validation IS the deliverable. Each level below is a gate Task above; the "expected" is the green state. If a
> level is red, apply the fix-decision tree (Implementation Patterns) and re-run until green, then record it in
> VERIFICATION.md. **Do not skip a level.** Do not mark a red gate as passed.

### Level 1: Prerequisites + Type Check (Immediate)

```bash
# (Task 0) Prerequisites — S2 cannot start without these.
npm test 2>&1 | tail -3            # EXPECT "Tests  671 passed" — if 4 fail in edge-cases.test.ts → STOP (GOTCHA #1)
ls README.md                       # EXPECT exists — if not → STOP (S1 not done)
pi --version                       # EXPECT 0.84.x

# (Task 1) Type check — typebox schemas + strict types compile.
npx tsc --noEmit                   # EXPECT exit 0 (no output). If errors → fix the named src/ line; re-run.
```

### Level 2: Unit Tests — DoD #1 + #4 + #5 (the pure-core + disabled + fail-open proof)

```bash
# (Task 1) Full unit suite — DoD #1.
npm test                           # EXPECT 671 passed, 0 failed (incl. transforms.test.ts pairing-invariant property test)

# (Task 3) Disabled-path tests explicitly — DoD #4 (unit-level in v1; GOTCHA #2).
npx vitest run test/config.test.ts test/filter.test.ts test/tools/rewind.test.ts test/tools/shrink.test.ts
# EXPECT all green: filter.test.ts:171 pass-through-when-disabled; config.test.ts enabled:false; tools E14 refusals.

# (Task 4) Fail-open authoritative unit proof — DoD #5.
npx vitest run test/filter.test.ts -t "fail-open"   # EXPECT green (contextHandler + readMarkers never throw → pass-through)

# (Task 3) Code-inspection — the 5 master-switch gates exist + E14 LANDED + audit/checkpoint intentionally ungated.
grep -n '!config.enabled\|!cfg.enabled' src/filter.ts src/tools/rewind.ts src/tools/shrink.ts src/nudges.ts   # 5 hits
grep -rn "Mulligan is disabled" src/tools/          # present in rewind.ts + shrink.ts
# EXPECT: filter:180, rewind:322, shrink:235, nudges:98, nudges:176 gated; audit.ts:22-23 + checkpoint.ts:27-28 NOT (GOTCHA #3).
```

### Level 3: Integration — DoD #2/#3/#5 + zero-config smoke (System Validation)

```bash
# (Task 2) Zero-config smoke — DoD #6 / spec/11 §2 Step 9.
pi -e ./src/index.ts -p "Reply with the single word: ok" 2>&1 | head -40
# EXPECT: no "Error loading extension" / no factory-time stack trace. Model may respond "ok" OR time out (NOT a load
# failure — GOTCHA #5). The factory's setConfig(undefined) at index.ts:29 + 4 registerTool + 3 pi.on all succeed.

# (Task 4) Integration smoke — DoD #2/#3/#5.
npm run smoke                      # = node test/integration/run-smoke.mjs ; EXPECT "9/9 scenarios passed" (exit 0)
#   F-rewind-core / F-shrink-persist / F-shrink-preventive / F-nudge-drift / F-protected / F-maxdepth /
#   F-checkpoint / F-failopen / F-reload. HARD assertions green; `soft` notes are warnings (GOTCHA #6).

# (Task 4) Nudge-leak grep — DoD #3 (belt-and-suspenders across ALL smoke session JSONL).
SMOKE_DIR="${TMPDIR:-/tmp}/mulligan-smoke"
grep -rl 'mulligan:nudge' "$SMOKE_DIR" 2>/dev/null | wc -l          # EXPECT 0
grep -rl 'mulligan:nudge' ~/.pi/sessions 2>/dev/null | wc -l        # EXPECT 0 (or dir absent)
# EXPECT 0. If >0 → real bug: fix nudges.ts injectNudge / filter.ts contextHandler (GOTCHA #4); re-run npm run smoke.
```

### Level 4: Documentation Accuracy — DoD #6 (Mode B)

```bash
# (Task 5) README cross-check — re-run S1 PRP Validation Loop Level 2.
# (a) The 4 tool descriptions are VERBATIM from src/tools/*.ts *_DESC (copy-equality). For each, confirm the README's
#     quoted string === the src *_DESC string (use the node byte-equality check from S1's Validation Loop Level 2a).
# (b) The 12-knob config table matches src/config.ts DEFAULT_CONFIG (exact defaults — cross-check each row).
# (c) The Disabling note + enabled row + Guarantees are consistent + reflect POST-E14 behavior:
grep -c "Mulligan is disabled" README.md           # EXPECT >= 1 (the Disabling note documents the post-E14 refusal)
# (d) The zero-config claim is TRUE — Task 2 proved `pi -e ./src/index.ts` loads clean.
# IF any inaccuracy → fix README.md to match src/ (NEVER edit src/ to match README — GOTCHA #7). Re-check until clean.

# (Task 6) VERIFICATION.md exists + is complete.
ls VERIFICATION.md && wc -l VERIFICATION.md        # EXPECT exists; the 6-criteria → command → result table present.
```

---

## Final Validation Checklist

### Technical Validation (the gates — all must be green + recorded in VERIFICATION.md)
- [ ] (Task 0) Prerequisites met: P1.M7.T3.S1 Complete (671/671), README.md exists, `pi --version` 0.84.x.
- [ ] (Task 1) `npm test` → 671 passed, 0 failed (incl. transforms.test.ts pairing-invariant property test).
- [ ] (Task 1) `npx tsc --noEmit` → exit 0 (typebox schemas + strict types compile).
- [ ] (Task 2) `pi -e ./src/index.ts -p "..."` → no factory-time load error (zero-config smoke).
- [ ] (Task 3) 5 master-switch gates present (grep) + E14 "Mulligan is disabled" in rewind+shrink + disabled unit tests green.
- [ ] (Task 3) audit.ts + checkpoint.ts remain intentionally non-gated (GOTCHA #3 — not "fixed").
- [ ] (Task 4) `npm run smoke` → 9/9 scenarios PASS; `soft` notes not treated as failures.
- [ ] (Task 4) `grep -rl mulligan:nudge` over smoke temp dir + sessions → 0 files (DoD #3).
- [ ] (Task 4) filter.test.ts fail-open tests green + F-failopen PASS (DoD #5).
- [ ] (Task 5) README accuracy cross-check clean (verbatim *_DESC, 12-knob table, POST-E14 consistency, zero-config true).

### Feature Validation (spec/11 §3 Definition of Done — all 6)
- [ ] DoD #1 — all Tier-1 unit tests green including the pairing-invariant property test.
- [ ] DoD #2 — all F-* integration scenarios green (log + JSONL assertions).
- [ ] DoD #3 — `mulligan:nudge` provably never persisted (grep returns 0 across all scenarios).
- [ ] DoD #4 — `config.enabled=false` makes the extension a pure no-op (no context transform, tools refuse cleanly).
- [ ] DoD #5 — an intentional filter exception does not break an agent turn (F-failopen + unit tests).
- [ ] DoD #6 — README documents install, the four tools, configuration, and the soft-delete/visible-in-`/tree` guarantee.

### Code Quality / Documentation Validation
- [ ] Any src/ fix was minimal + named the gate + root cause in VERIFICATION.md (or "none — all gates green first run").
- [ ] README corrections (if any) matched src/, never the reverse (GOTCHA #7).
- [ ] Final cleanup removed only stray debug console.log / dead TODOs (the config.ts warnConfig console.warn STAYS — GOTCHA #10).
- [ ] VERIFICATION.md written at repo root with the 6-criteria → command → result table + the gate cheat sheet.
- [ ] No spec/ / package.json / tsconfig.json / .gitignore / tasks.json / prd_snapshot.md modified.
- [ ] Final sequential re-run of all gates confirms the green state is reproducible after any edits.

---

## Anti-Patterns to Avoid

- ❌ **Don't start before P1.M7.T3.S1 + S1 are Complete.** The 4 red edge-cases tests are M7.T3.S1's in-flight work;
  if they're still red at Task 0, STOP and report (GOTCHA #1). S2 verifies the converged green state, it doesn't
  finish a sibling's work or `.skip` red tests.
- ❌ **Don't paper over a red gate.** Every gate must be genuinely green. Marking a test `it.skip`, deleting a failing
  assertion, or claiming PASS without running the command defeats the entire point of the convergence task.
- ❌ **Don't "fix" audit.ts / checkpoint.ts by adding an enabled gate.** They are intentionally always-on (GOTCHA #3 —
  read-only diagnostics / harmless labels). DoD #4's no-op applies to the 5 GATED entry points only.
- ❌ **Don't try to set enabled:false via Pi settings.json.** index.ts:29 hardcodes setConfig(undefined) in v1;
  settings-reading is v1.1 (GOTCHA #2). DoD #4 is unit-verified (setConfig({enabled:false}) + assert), not settings-driven.
- ❌ **Don't edit src/ to match the README.** src/ is the source of truth; README corrections flow src/→README (GOTCHA #7).
  Never change a *_DESC string or a DEFAULT_CONFIG value to "agree" with a README claim.
- ❌ **Don't treat a smoke `soft` note or a model timeout as a failure.** Canary-drop / bloatHit / hasNudge are
  model-driven (GOTCHA #6); a JSONL-unavailable note means the model timed out and the smoke-log assertions are primary.
- ❌ **Don't do a wholesale logic rewrite.** If a gate needs one, the issue belongs to an earlier subtask (M3/M5/M6/
  M7.T3), not S2's polish (GOTCHA #9). Minimal fixes only; report larger issues rather than absorbing them here.
- ❌ **Don't remove the config.ts warnConfig console.warn in cleanup.** It's the documented v1 warn seam (GOTCHA #10).
- ❌ **Don't skip writing VERIFICATION.md.** It's the evidence report + regression anchor — the receipt that the v1.0
  changeset is done. The green codebase without the report is an incomplete deliverable.