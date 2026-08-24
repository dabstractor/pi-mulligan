---
name: "P1.M2.T6.S1 — Run npm run smoke to 19/19 + npm test + tsc --noEmit; record gate evidence"
---

## Goal

**Feature Goal**: Execute the full acceptance gate for the BUG-003 changeset: run the complete integration smoke suite end-to-end and require **19/19 scenarios PASS with exit 0** (the prior 14 v1.0/edge scenarios plus the five new v1.1 scenarios F-ckptcmd, F-banner, F-consent, F-useraudit, F-drift-userexempt), re-run the unit suite (`npm test`, expected ≥ 1104 passing — 1104 prior + the new BUG-002/fixture tests from P1.M1.T2, all green), and confirm `npx tsc --noEmit` is clean. Record the observed counts as the gate evidence consumed by the P1.M3.T2 docs sweep.

**Deliverable**: A research note at `plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md` capturing the exact observed numbers (smoke `19/19 scenarios passed` + exit code, unit-test pass count and file count, tsc exit 0), plus any harness-level flake fixes made *within the new asserters/flows only*. NO product-code changes, NO docs changes (the write-up belongs to P1.M3.T2.S1–S3).

**Success Definition**: All three gates green in one session, evidence recorded; spec/11 §3 DoD #2 ("All F-* integration scenarios green against a real pi -p run") fully satisfied for the v1.1 surface.

## Why

The five v1.1 scenarios were implemented in parallel sibling subtasks (P1.M2.T2–T5) and have never run together in one `npm run smoke` invocation. This gate proves the combined suite — including shared-harness interactions (the single `RUN_ID` session naming, the `context.fire` log line now carrying banner/visibility/high-water/paste-canary observables, and per-scenario asserters) — is green simultaneously, and that the changeset (BUG-001 doc fix, BUG-002 identical-note advisory, BUG-003 scenarios) did not regress the 1104 prior unit tests or typechecking. The recorded numbers are the raw input for VERIFICATION.md (P1.M3.T2.S1), README (S2), and scenarios.md (S3).

## What

1. Pre-flight: confirm the tree contains all sibling outputs — `test/integration/run-smoke.mjs` SCENARIOS array (run-smoke.mjs:30-49) must list exactly 19 entries: the 14 prior (F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7, E11, E12, E15, E20) **plus** F-ckptcmd, F-banner, F-consent, F-useraudit, F-drift-userexempt; ASSERTERS map must have an entry for every scenario name. If a sibling output is missing, STOP and report — do not implement the sibling here.
2. `npm run smoke` (≈ `node test/integration/run-smoke.mjs`, package.json:58) — require `19/19 scenarios passed` and process exit 0.
3. `npm test` (= `vitest run`, package.json:57) — require 0 failed; record total passed and file count (baseline was 1104/25; expect 1104 + the new BUG-002 prevRewindNoteAtLatestPrompt/advisory tests from P1.M1.T2 plus any fixture tests).
4. `npx tsc --noEmit` — require exit 0 (strict + skipLibCheck).
5. Record evidence + any flake triage in `research/gate-evidence.md`.

### Success Criteria

- [ ] `npm run smoke` → `19/19 scenarios passed`, exit 0, zero FAIL lines
- [ ] `npm test` → 0 failed, recorded pass count
- [ ] `npx tsc --noEmit` → exit 0
- [ ] Gate evidence written to `research/gate-evidence.md` with exact observed numbers
- [ ] Zero changes to `src/**` (product code untouched by this gate)

## All Needed Context

### Context Completeness Check

An agent knowing nothing about this repo needs: the three gate commands, what "19" is composed of, the flake-triage boundary (harness-only), the environment hazard (globally-installed older mulligan colliding via extension discovery), and where to record evidence. All are below.

### Documentation & References

```yaml
- file: test/integration/run-smoke.mjs
  why: The smoke orchestrator this gate runs. SCENARIOS array (:30-49) must equal 19 entries;
        ASSERTERS map must cover every name. runPi() (:~87) spawns `pi -ne -e ./src/index.ts
        -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p ... -p ...`.
  pattern: exit-0-on-all-pass; per-scenario PASS/FAIL printout; final `${totalPass}/${SCENARIOS.length}` line (:910)
  gotcha: NEVER drop the `-ne` flag (see Known Gotchas). RUN_ID is per-invocation → re-running is idempotent.

- file: test/integration/smoke.ts
  why: The observer extension loaded into pi; emits the smoke JSONL (context.fire lines with
        hasNudge, highWater, banner/visibility observables, pasteCanaryPresent). Harness-level
        flake fixes may touch this ONLY within the new v1.1 observable code.

- file: VERIFICATION.md
  why: Prior gate record — baseline numbers to compare against (1104/25 unit, 14/14 smoke, tsc exit 0).
        Do NOT edit it in this subtask; that is P1.M3.T2.S1's job. Record-only reference.

- file: package.json
  why: scripts: test = "vitest run" (:57), smoke = "node test/integration/run-smoke.mjs" (:58),
        typecheck = "tsc --noEmit" (:59).

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T5S1/PRP.md
  why: Contract for the last sibling (F-drift-userexempt) — describes its SCENARIOS registration,
        generated 60k-token paste flow, pasteCanaryPresent observable, soft high-water arm. Assume landed.

- file: spec/11-build-order.md (§3 Definition of Done)
  why: DoD #2 = "All F-* integration scenarios green against a real pi -p run" — the requirement this gate certifies.
```

### Current Codebase tree (relevant slice)

```bash
package.json                 # scripts: test / smoke / typecheck
test/integration/run-smoke.mjs   # orchestrator; SCENARIOS (:30), ASSERTERS, runPi, per-scenario asserters
test/integration/smoke.ts        # observer extension; smoke JSONL log
test/integration/scenarios.md    # per-scenario docs (sibling-updated; not this task's job)
VERIFICATION.md                  # prior gate record (read-only here)
plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/   # ← evidence output
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL — environment hazard (PRD Overview confounder): a GLOBALLY-INSTALLED older mulligan
# build exists on this machine. If extension discovery is on, its v1.x prescribing-nudge string
# ("If wasteful, mulligan_rewind to undo the turn...") can appear in output — verified to exist
# ONLY in /home/dustin/projects/pi-mulligan/src/notes.ts:337 (the parent checkout), zero matches
# in this worktree. runPi()'s `-ne` flag exists precisely to prevent this collision.
# RULE: never drop `-ne`; if a foreign nudge string appears in smoke output, treat it as an
# environment artifact and investigate the spawn flags FIRST, not the code under test.

# Flake-triage boundary: fix harness flakes ONLY within the new asserters/flows (assertion logic,
# prompt flows, timeouts in the five new scenarios' code). If a PRODUCT defect surfaces
# (assertion correctly failing against src/**), STOP, loop back to the owning subtask —
# do NOT patch product code in this gate.

# Model timeouts: run-smoke.mjs treats a missing session JSONL (model timeout) as non-fatal —
# smoke-log assertions are primary. A per-scenario PI_TIMEOUT_MS is 120s; if a scenario
# times out repeatedly, consider raising it in the harness for the new flows only.

# `npm run smoke` runs REAL `pi -p` processes (19 spawns, each up to 120s) — total wall time
# can be 10-30 minutes. Do not assume a hang; check per-scenario progress output.

# F-drift-userexempt's high-water arm is intentionally SOFT on large provider windows —
# a `⚠ SOFT:` line is NOT a failure. Only FAIL lines and a non-zero exit count against the gate.

# Smoke idempotency: RUN_ID (pid+timestamp) makes re-running safe; no cleanup needed between runs.
```

## Implementation Blueprint

This is an evidence-gathering gate — no new source files. The "implementation" is a run-and-triage loop.

### Task list (ordered)

```yaml
Task 1: PRE-FLIGHT
  - grep -n '"F-ckptcmd"\|"F-banner"\|"F-consent"\|"F-useraudit"\|"F-drift-userexempt"' test/integration/run-smoke.mjs
    → all five present in SCENARIOS; assert `node -e` count of SCENARIOS entries == 19; ASSERTERS covers each.
  - Confirm `npm ls`-free environment sanity: `which pi` resolves and `pi --version` runs.
  - If anything is missing (sibling not landed), output result:"blocked" with specifics — do not implement siblings.

Task 2: SMOKE GATE
  - RUN: npm run smoke   (allow ≥30 min; use a background bash with monitored output)
  - REQUIRE: final line "19/19 scenarios passed" AND exit code 0.
  - ON FLAKE within a NEW scenario (F-ckptcmd/F-banner/F-consent/F-useraudit/F-drift-userexempt):
    read the failing assert + the per-scenario smoke log under /tmp/mulligan-smoke/<Scenario>.log and the
    session JSONL; fix ONLY the harness (asserter logic, prompt flow, timeout) in run-smoke.mjs/smoke.ts
    within the code those siblings added; re-run JUST the flaky scenario via
    `node test/integration/run-smoke.mjs` (whole-suite rerun after a fix, to catch cross-effects).
  - ON FAILURE of a PRIOR scenario (one of the 14): first suspect environment/regression from sibling
    harness edits; if it traces to src/**, that is a product defect → loop back to the owning subtask
    (report; do not fix product code here).
  - Record: exact output of the final summary line, per-scenario PASS list, any SOFT notes.

Task 3: UNIT GATE
  - RUN: npm test
  - REQUIRE: "0 failed"; record total passed + file count. Baseline 1104/25; new BUG-002
    (prevRewindNoteAtLatestPrompt + advisory wiring, P1.M1.T2) and fixture tests increase it —
    record whatever is observed. Any failure → investigate; unit failures from src/** are product
    regressions → loop back, do not patch here.

Task 4: TYPECHECK GATE
  - RUN: npx tsc --noEmit   (equivalently npm run typecheck)
  - REQUIRE: exit 0, no output.

Task 5: RECORD EVIDENCE
  - WRITE plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md:
    date, git rev (git rev-parse --short HEAD), the three observed results verbatim
    (e.g. "19/19 scenarios passed", "N passed / 0 failed (M files)", "tsc --noEmit → exit 0"),
    any harness fixes made (file:line + reason), any SOFT notes, and the no-product-change affirmation
    (`git status --short src/` empty).
```

### Integration Points

```yaml
OUTPUT: research/gate-evidence.md is consumed by P1.M3.T2.S1 (VERIFICATION.md re-record),
        P1.M3.T2.S2 (README), P1.M3.T2.S3 (scenarios.md counts).
DOCS: none in this subtask — evidence only.
FORBIDDEN: edits to src/**, PRD.md, tasks.json, prd_snapshot.md, VERIFICATION.md, README.md, scenarios.md.
```

## Validation Loop

### Level 1-2 (bundled — this task IS validation)

```bash
npm run smoke        # → "19/19 scenarios passed", exit 0
npm test             # → 0 failed (record count)
npx tsc --noEmit     # → exit 0
```

### Level 3: Evidence integrity

```bash
git status --short src/          # → empty (no product changes)
ls plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T6S1/research/gate-evidence.md   # → exists
```

## Final Validation Checklist

- [ ] `npm run smoke` → 19/19 passed, exit 0 (all five v1.1 scenarios PASS)
- [ ] `npm test` → 0 failed; pass count + file count recorded
- [ ] `npx tsc --noEmit` → exit 0
- [ ] Gate evidence recorded in research/gate-evidence.md with date, rev, verbatim results
- [ ] Any flake fixes confined to new-scenario harness code (run-smoke.mjs/smoke.ts), documented
- [ ] No product-code edits (`git status --short src/` empty)
- [ ] No edits to VERIFICATION.md / README.md / scenarios.md (owned by P1.M3.T2)
- [ ] `-ne` flag never removed; any foreign v1.x nudge string investigated as environment artifact first

## Anti-Patterns to Avoid

- ❌ Don't "fix" a red scenario by weakening its asserter to make the gate pass
- ❌ Don't patch src/** product code to get green — loop back to the owning subtask
- ❌ Don't drop `-ne` or add extension discovery to diagnose — use the smoke logs instead
- ❌ Don't treat SOFT notes or model-timeout JSONL skips as failures
- ❌ Don't skip re-running the full suite after any harness fix

## Confidence Score

**9/10** — the gate is mechanical; the only risk is sibling outputs not having landed when this starts (pre-flight task handles that explicitly) or a genuine cross-scenario harness interaction, which the triage boundary covers.