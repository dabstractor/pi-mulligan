# Delta PRD — P4: Runaway-loop hard backstops (E22) + drift-nudge bloatHit demotion

**Source of truth:** the spec files (`spec/05-tools.md`, `spec/07-preventive-and-nudges.md`, `spec/08-edge-cases.md` E22, `spec/09-configuration.md`, `spec/10-testing.md` §1.10) are **already at the target state** (verified — committed in `3ff35059` and `0bcaa814`). This delta is **code-only**: make the implementation match the already-written spec. No spec writing is required.

**Provenance:** the prior session completed P3 (marker retraction, stale-marker retirement + soft cap, windowed drift + high-water, the `turnHasAdvanced` gate + `diag` invariant sink). Those are all green in `src/` and all 863 tests pass. This delta is the *next* layer: the **hard backstops against runaway growth** that the spec mandates but the code does not yet enforce, plus one small drift-nudge correctness fix that the spec calls out.

---

## 1. Problem (what this delta fixes)

Two gaps between spec and code:

1. **E22 — same-prompt rewind retry loop → runaway growth (no hard backstop).** Observed in live use: a single prompt left the agent retrying the same `last_turn` rewind for hours, each loop appending a marker + note + metric, until the provider rejected the request as **"Prompt too long"** — an unrecoverable hard stop. The agent's own self-authored note (`next`) cannot be trusted to break the loop (it can re-instruct the looping action), and the existing `maxDepth` cap only bounds *cumulative* markers — it cannot arrest a loop that re-bloats between rewinds. The spec mandates **two independent hard guards** in the rewind tool (spec/08 E22, spec/05 §1 step 4) that refuse *before persisting*:
   - a **per-prompt retry budget** (`config.rewind.maxRetriesPerPrompt`, default 5) counting rewinds that re-land at the latest user message, and
   - an **out-of-band context-fraction stop** (`config.rewind.abortContextFraction`, default 0.9) that refuses any rewind once the filtered-context estimate reaches that fraction of the window.
   Neither guard exists in code today (`grep maxRetriesPerPrompt|abortContextFraction src/` → none).

2. **bloatHit still fires the drift nudge even when delta data exists.** `shouldNudge` currently returns `avg(deltas) > threshold || window.some(m => m.bloatHit)` (nudges.ts line ~323). The spec (§07 §2 / §5.1, committed in `0bcaa814`) demoted `bloatHit` to a **fallback-only** condition: when delta data exists, the drift nudge fires on **delta alone**. The `|| window.some(bloatHit)` arm must be removed from the delta-available path (kept only in the `deltas.length === 0` fallback). A single big result is already covered by Nudge A (co-located on the result) and is a known stuck-turn-loop amplifier (the live-observed `~0k tokens / N bloated results` self-contradiction).

Both are **REQUIRED** by the (already-written) spec and are directly testable.

## 2. Scope (exactly what changes)

| Area | Change | Files |
|---|---|---|
| E22 config | Add `rewind.maxRetriesPerPrompt` (5) + `rewind.abortContextFraction` (0.9) | `src/config.ts` |
| E22 rewind tool | Two new guards in step 4 (before persist), refuse-before-persist, never throw | `src/tools/rewind.ts` |
| E22 tests | §1.10 retry-cap + context-fraction guard unit tests | `test/tools/rewind.test.ts` (+ `test/config.test.ts`) |
| E22 advisory (SHOULD) | Suppress drift nudge for the remainder of a turn in which a rewind was refused | `src/runtime.ts`, `src/tools/rewind.ts`, `src/filter.ts` |
| bloatHit demotion | Remove `\|\| window.some(bloatHit)` from `shouldNudge`'s delta-available return | `src/nudges.ts` |
| bloatHit tests | Flip the 2 now-stale assertions; keep the no-delta fallback assertion | `test/drift_nudge.test.ts` |
| README (Mode B) | Add the 2 new config knobs to the table + JSON example + a feature-blurb sentence | `README.md` |

**Out of scope (already done — do NOT touch):** `turnHasAdvanced` gate + `diag`/`filter.invariant` sink (`src/transforms.ts`, `src/filter.ts` — commit `79590bc6`), stale retirement + soft cap (P3.M2), marker retraction (P3.M1), windowed drift + high-water (P3.M3). The spec's E23 (checkpoint wrong-actor — pure design note) and E24 (pinned-hide compaction leak — known limitation, diagnosed via the existing `diag` sink) require **no code** — they are already reflected in the spec only.

**Documentation impact:** Mode A (doc-with-work) = **none** — the spec is the source and is already written. Mode B (changeset-level) = **yes** → `README.md` must gain the two new knobs (P4.M3).

---

## 3. Build plan

One phase, three milestones. **M2 is independent of M1** (different file, different concern) and may be done in parallel. **M3 depends on M1** (it documents M1's knobs).

### Phase P4 — Runaway-loop backstops + drift-nudge bloatHit demotion

#### Milestone P4.M1 — E22 retry budget + context-fraction stop (the main feature)

> Goal: the rewind tool refuses before persisting when either (a) ≥ `maxRetriesPerPrompt` rewinds have re-landed at the latest user message, or (b) the filtered-context estimate is ≥ `abortContextFraction` of the window. Both guards run independently of the existing `maxDepth` guard and never throw (E13). Acceptance = spec/10 §1.10 (a)–(g).

- **Task P4.M1.T1 — Config knobs (`src/config.ts`).** Add `maxRetriesPerPrompt: number` (default 5) and `abortContextFraction: number` (default 0.9) to `MulliganConfig.rewind`, `DEFAULT_CONFIG.rewind`, and `validateConfig`'s rewind block. Reuse the established `coerceNumber`/`safeGet` pattern that the existing `maxDepth` line (`config.ts` ~line 223) uses — **except** `abortContextFraction` needs a dedicated `(0,1]` check (`coerceNumber` does not enforce the upper bound): `typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1`, else `warnConfig` + default. `maxRetriesPerPrompt` = `coerceNumber(..., true)` then `Math.floor` to an integer ≥ 1. Never throws. Doc-with-work: none (spec/09 already specifies both knobs + rationale).
  - *Subtask P4.M1.T1.S1* (1 pt): add both knobs to interface + defaults + validate. Test: `validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } })` sets both; defaults (5, 0.9) when absent; invalid (`abortContextFraction` of 0, 1.5, -0.5, NaN → 0.9; `maxRetriesPerPrompt` of 0, 2.7→2, 'x' → 5) fall back. Existing rewind knobs unchanged.

- **Task P4.M1.T2 — Rewind tool guards (`src/tools/rewind.ts`).** Add two guards to step 4, **after** the existing `maxDepth` guard (~line 393) and **before** step 5 (`resolvePreview`). The rewind tool already reads entries via the `countRewindMarkers(ctx)` pattern (step 4) — extend it. All three guards (`maxDepth`, retry-budget, context-fraction) apply **independently** (spec/05 §1 step 4); order among them is not load-bearing (first refusal wins).
  - *Subtask P4.M1.T2.S1* (2 pt) — **Per-prompt retry budget.** Add `countRetriesAtLatestPrompt(ctx): number`. A "retry" = any `mulligan:rewind` marker whose resumed turn re-lands at the latest user message: every `last_turn` / `to_previous_prompt` rewind, plus a `last_tool_call_group` / `checkpoint` rewind whose resolved target is at/after the latest user message. **Recommended simple implementation (over-approximation that catches the canonical `last_turn` loop vector, satisfies the §1.10 acceptance, and needs no message-list resolution):** scan `getEntries()` in order, find the index/timestamp of the last `type:"message"` entry with `role:"user"`, then count `mulligan:rewind` markers appended **after** it. This counts a `last_turn` rewind during the current turn (correct — it re-lands at the prompt). For the `last_tool_call_group`/`checkpoint` sub-case, entry-position ordering is an acceptable v1 over-approximation (it counts a tool-group rewind issued this turn even if its target was a prior turn's group) — document this in a code comment; the spec's intent (arrest the loop) is met and the §1.10 acceptance tests pass. When `countRetriesAtLatestPrompt(ctx) >= config.rewind.maxRetriesPerPrompt`, `return refusal("hit the per-prompt retry budget (<N>/<max> rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again", granularity)`. **A zero-hide rewind still counts** (it is the canonical loop vector) — do not special-case it. If no user message is found, return 0 (no prompt → no budget consumption). Never throws (wrap the entry scan defensively, mirroring `countRewindMarkers`).
  - *Subtask P4.M1.T2.S2* (2 pt) — **Out-of-band context-fraction stop.** Compute the filtered-context total **the same way `mulligan_audit` does** (`src/tools/audit.ts` `auditExecute` step 1): prefer `rt.lastFiltered` (the filter's cached output) via `estimateTokens`, else fall back to `buildContextEntries()` → `estimateTokens`; window size = `ctx.getContextUsage()?.contextWindow ?? 0` (the window **size** is fine under D5 — D5 only forbids `.tokens`). If `windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction`, `return refusal("context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result", granularity)`. Extract the total-computation into a small shared helper (e.g. `computeFilteredTotal(ctx): { totalTokens, windowTokens }`) so audit and the rewind tool do not diverge — audit can be refactored to call it (low-risk; same numbers). Wrap the whole computation in try/catch → on any failure, **skip this guard** (fail-open: a stale cache or a throwing `getContextUsage` must never block a rewind). Never throws.
  - *Subtask P4.M1.T2.S3* (1 pt, SHOULD/advisory — may defer) — **Suppress the drift nudge for a turn in which a rewind was refused (spec/07 §2 Edge cases).** Add `rewindRefusedTurnIndex: number | null` to `SessionRuntime` (default `null`, reset on `session_start`). In `rewind.ts`, every `refusal(...)` path sets `rt.rewindRefusedTurnIndex = currentTurnIndex` (obtainable from the latest `mulligan:turn-metric` on the branch, or `rt.lastTurnIndex`). In `filter.ts` `contextHandler`, gate the drift-nudge block on `rt.rewindRefusedTurnIndex !== latestMetricTurnIndex` (skip injection when set this turn; clear it when the turn advances). This is a SHOULD — if time-boxed, ship M1 with T2.S1+S2 and file T2.S3 as a follow-up; the MUST guards (T2.S1/S2) are what arrest the runaway loop. Doc-with-work: none.

- **Task P4.M1.T3 — Tests (`test/tools/rewind.test.ts`, `test/config.test.ts`).** Mirror spec/10 §1.10. Add to the existing rewind-test fakes (`makePi`/`makeCtx` scripting `getEntries`, `getLeafId`, `getContextUsage`).
  - *Subtask P4.M1.T3.S1* (2 pt): (a) `maxRetriesPerPrompt: 3` + 3 `last_turn` rewind markers after the latest user message → the 4th `mulligan_rewind` is refused with the budget text and persists nothing; (b) a zero-hide rewind still increments the counter (mock a session where the previous rewind hid nothing); (c) a new user message resets the budget and the next rewind succeeds; (d) `mulligan_shrink`/`audit`/`checkpoint`/`cancel` remain callable after the budget is hit (only prompt-re-landing rewinds are gated); (e) `abortContextFraction: 0.9` + scripted `lastFiltered`/`getContextUsage` putting the total at ≥ 0.9 of the window → rewind refused with the context-fraction text **even though budget remains**; shrink still callable; (f) all refusals return a reason, never throw (E13), and never block a normal text reply. Add the two config-knob validation cases to `test/config.test.ts` per P4.M1.T1.S1. (Integration scenarios F-retrycap / F-abortfraction from spec/10 §2.1 are documented in `test/integration/scenarios.md` — add them there if a deterministic path exists; they are not auto-run, so a scenarios.md note suffices for v1.)

#### Milestone P4.M2 — bloatHit demotion in `shouldNudge` (independent, tiny)

> Goal: `shouldNudge` fires on **delta alone** when delta data exists; `bloatHit` fires only in the no-delta fallback. One production line changes; two tests flip.

- **Task P4.M2.T1 — Demote `bloatHit` (`src/nudges.ts` + `test/drift_nudge.test.ts`).**
  - *Subtask P4.M2.T1.S1* (0.5 pt): in `shouldNudge` (`nudges.ts` ~line 316–323), change the final return from `return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);` to `return avg > config.nudges.driftThresholdTokens;`. The `deltas.length === 0` fallback (`return window.some((m) => m.bloatHit === true);`) stays **unchanged** — that is the only path on which `bloatHit` fires (first turn / post-reload). Update the function's JSDoc to state "delta-only when delta data exists; bloatHit is a no-delta fallback only".
  - *Subtask P4.M2.T1.S2* (0.5 pt): in `test/drift_nudge.test.ts`, the two assertions at the "fires on bloatHit even when the windowed average is below threshold" block (~lines 90–98) are now **stale** — flip them: `shouldNudge([m(500, true, 1)], cfg())` must now be `false` (delta=500 exists, below threshold, bloatHit no longer fires). Add a positive assertion that the **no-delta fallback** still fires on bloat: `shouldNudge([m(null, true, 1)], cfg())` → `true` (this one already passes). Keep the "single heavy turn does not fire" + "sustained growth fires" tests green. Scan `test/filter.test.ts` (~line 919 comment "or any window bloatHit") and `test/nudges.test.ts` for any other stale bloat-armed assertion and correct the wording/assertion. Run the full suite — expect only the two intentional flips to change.

#### Milestone P4.M3 — Sync README (Mode B; depends on P4.M1)

> Goal: `README.md` reflects the two new config knobs. The spec is already written; only the human-facing README lags.

- **Task P4.M3.T1 — README config table + JSON example + blurb (`README.md`).** Depends on P4.M1.T1 (knob names/defaults) and P4.M1.T2 (the runaway-loop framing).
  - *Subtask P4.M3.T1.S1* (0.5 pt): add two rows to the README config table near the existing `rewind.maxDepth` row: `rewind.maxRetriesPerPrompt` (default 5 — caps consecutive rewinds re-landing at the same user prompt; the runaway-loop bound, `spec/08-edge-cases.md` E22) and `rewind.abortContextFraction` (default 0.9 — refuse any rewind once the filtered-context estimate reaches this fraction of the window; the zero-marker-loop guard, E22). Add both to the commented JSON example block near the existing `rewind.maxDepth` line.
  - *Subtask P4.M3.T1.S2* (0.5 pt): add one sentence to the relevant feature blurb (near the existing "Markers accumulate" / E15 note around README line 244) noting the two hard backstops: a per-prompt retry budget and a context-fraction stop that refuse a rewind before it can drive a runaway loop, with a one-line pointer to spec/08 E22.

---

## 4. Definition of done

1. `grep maxRetriesPerPrompt|abortContextFraction src/` finds both knobs in `config.ts` and both guards in `tools/rewind.ts`.
2. `shouldNudge` returns delta-only when delta data exists (the `|| bloatHit` arm removed); the no-delta fallback still fires on `bloatHit`.
3. All 863 existing tests still pass; the P4.M1.T3 / P4.M2.T1.S2 tests added/flipped pass.
4. No new model request is introduced (both guards are pure pre-persist checks in the tool — D4 holds).
5. `README.md` documents the two new knobs in the table, the JSON example, and a feature-blurb sentence.

## 5. Risks / notes for the implementer

- **The per-prompt retry counter must never throw** — it sits on the rewind-tool hot path (E13). Mirror `countRewindMarkers`'s defensive entry scan (try/catch → 0).
- **The context-fraction total is a *stale* estimate mid-turn** (`rt.lastFiltered` is the previous fire's view; the current turn's work isn't cached yet). This is acceptable — the guard is a 0.9 backstop, not a precise meter, and it errs toward *firing later* (under-counting), which is the safe direction. Do not "fix" this by calling `getContextUsage().tokens` (D5).
- **Do not conflate E22 with the turn-replay bug** (FIX_TURN_REPLAY_LOOP — already fixed by the `turnHasAdvanced` gate, a *filter* defect). E22 is a *marker/tool* problem (runaway growth); the replay bug is a *re-resolution* problem. They share the "loop" theme but are distinct (spec/08 E22 calls this out explicitly).
- **P4.M1.T2.S3 is a SHOULD.** If the session is time-boxed, ship T2.S1+S2 (the MUST guards) and defer T2.S3; the runaway loop is arrested by the two guards alone.