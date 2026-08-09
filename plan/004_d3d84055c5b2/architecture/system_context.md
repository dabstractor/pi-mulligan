# System Context — Delta P4 (Runaway-loop hard backstops + drift-nudge bloatHit demotion)

## What this delta is

**Code-only.** The spec files are ALREADY at the target state (committed in `3ff35059`
for E22 knobs/guards, `0bcaa814` for the bloatHit demotion). This delta makes the
**implementation** match the already-written spec. No spec writing is required.

Two gaps remain between spec and code:

1. **E22 — runaway same-prompt rewind retry loop.** Two independent hard guards in
   the rewind tool that refuse *before persisting*:
   - per-prompt retry budget (`config.rewind.maxRetriesPerPrompt`, default 5)
   - out-of-band context-fraction stop (`config.rewind.abortContextFraction`, default 0.9)
   Neither guard exists in code today (`grep maxRetriesPerPrompt|abortContextFraction src/` → none).

2. **bloatHit demotion in `shouldNudge`.** When delta data exists, the drift nudge must
   fire on delta ALONE. The `|| window.some(bloatHit)` arm must be removed from the
   delta-available return (kept only in the `deltas.length === 0` fallback).

## Baseline state (verified)

- **Branch HEAD:** `0bcaa814` (Demote bloatHit from drift nudge trigger to fallback — spec only).
- **Tests:** `npx vitest run` → **863 passed (863)**, 20 files. This is the baseline; P4 must
  keep all 863 green and add new tests.
- **Prior layers done (do NOT touch):** marker retraction (P3.M1), stale retirement + soft cap
  (P3.M2), windowed drift + high-water (P3.M3), `turnHasAdvanced` gate + `diag`/`filter.invariant`
  sink (`src/transforms.ts`, `src/filter.ts`, commit `79590bc6`).

## Spec source-of-truth locations (target state — already committed)

| Concern | Spec file | Lines | Notes |
|---|---|---|---|
| E22 full case + acceptance (a)–(g) | `spec/08-edge-cases.md` | 108–117 | REQUIRED hard backstop |
| Rewind step-4 guards (depth + retry + fraction) | `spec/05-tools.md` | 71–73 | "All three guards apply independently" |
| Config knobs + rationale | `spec/09-configuration.md` | 20–26 (JSON), 68–70 (table), 92–93 (validation) | defaults 5 / 0.9 |
| §1.10 test tier (retry-cap + fraction) | `spec/10-testing.md` | 57 | unit-test spec |
| Integration scenarios F-retrycap / F-abortfraction | `spec/10-testing.md` | 86 | documented only (not auto-run) |
| bloatHit fallback-only demotion | `spec/07-preventive-and-nudges.md` | 119, 151–153, 173 | "delta-only when delta data exists" |
| E13 (never throw) | `spec/08-edge-cases.md` | E13 | every tool path |

## Out of scope (no code)

- E23 (checkpoint wrong-actor) — pure design note.
- E24 (pinned-hide compaction leak) — known limitation, diagnosed via existing `diag` sink.
- `turnHasAdvanced` gate, stale retirement, marker retraction, windowed drift — all done.
- The E22 "advisory repeat-detection hint" (identical-note warning) is a SHOULD steers,
  not a MUST; the PRD does not request it for v1. The PRD DOES request T2.S3 (nudge
  suppression on refused turn) as a SHOULD.

## Key invariant preserved

- **D4** (no new model request): both guards are pure pre-persist checks inside the tool.
- **D5** (never trust `getContextUsage().tokens`): the context-fraction guard uses the
  FILTERED total (`estimateTokens(filtered)`), same as audit; it may read
  `.contextWindow` (the window SIZE — D5 only forbids `.tokens`).
- **E13** (never throw): every new guard wraps defensively and fails open.