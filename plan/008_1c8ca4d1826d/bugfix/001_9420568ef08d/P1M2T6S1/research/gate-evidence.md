# Gate Evidence — P1.M2.T6.S1 (BUG-003 acceptance gate)

- **Date**: 2025-06-14 (session)
- **Git rev**: e080943
- **Runner**: `npm run smoke`, `npm test`, `npx tsc --noEmit` in one session

## Observed results (verbatim)

| Gate | Command | Result |
|---|---|---|
| Smoke | `npm run smoke` | `19/19 scenarios passed`, exit code **0**, zero FAIL lines |
| Unit | `npm test` (vitest run) | **1122 passed / 0 failed** across **25 test files** (baseline 1104/25 + 18 new BUG-002/fixture tests) |
| Typecheck | `npx tsc --noEmit` | exit code **0**, no output |

## Smoke per-scenario PASS list (19/19)

F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected,
F-maxdepth, F-checkpoint, F-ckptcmd, F-banner, F-consent, F-drift-userexempt,
F-useraudit, F-failopen, F-reload, E7, E11, E12, E15, E20 — all PASS.

All five new v1.1 scenarios (F-ckptcmd, F-banner, F-consent, F-useraudit,
F-drift-userexempt) green on the first full-suite invocation together.

## SOFT notes (non-failing, expected)

- F-shrink-preventive: `bloatHit:true` is model-driven (requires the model to call `mulligan_smoke_big`); see scenarios.md.
- F-nudge-drift: `hasNudge:true` requires a >3000-token model turn; model-driven.
- F-drift-userexempt: high-water did not cross 0.7 (max fraction 0.070181) — 60k-token paste vs. large provider window; the arm is intentionally soft.
- E7: `deltaTokens:null` (baseline lost on reload) is the drift-nudge fallback, not asserted.
- E12: turn-metric persisted on the observing turn (`turn_end` ran).

## Harness fixes made

None — no flakes; no edits to `run-smoke.mjs` or `smoke.ts` were required.

## No-product-change affirmation

`git status --short src/` → empty. Zero changes to `src/**`; VERIFICATION.md /
README.md / scenarios.md untouched (owned by P1.M3.T2.S1–S3).

## Consumption

These numbers are the raw input for P1.M3.T2.S1 (VERIFICATION.md re-record),
P1.M3.T2.S2 (README), and P1.M3.T2.S3 (scenarios.md). spec/11 §3 DoD #2
("All F-* integration scenarios green against a real pi -p run") is satisfied
for the v1.1 surface.