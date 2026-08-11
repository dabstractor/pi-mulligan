# Research Notes — P1.M2.T1.S1: Move `pendingBloatHits` clear before the `perTurnDrift` early-return (BUG-004)

> Surgical block-reorder in `turnEndMetricHandler` (src/nudges.ts). Move the snapshot+clear (`const bloat =
> rt.pendingBloatHits; rt.pendingBloatHits = [];`) + `getRuntime(sessionId)` from AFTER the `perTurnDrift` gate
> to BEFORE it, so the bloat accumulator is cleared every turn_end regardless of the flag. Plus a JSDoc note
> (Mode A) + one regression test in test/turn_metric.test.ts. **No existing test breaks** (verified).

## 1. The defect (verified — src/nudges.ts:188–218)

`turnEndMetricHandler` order (current):
```
sessionId = ctx.sessionManager.getSessionId();
const config = getConfig();
if (!config.enabled || !config.nudges.perTurnDrift) return;   // GATE (line ~199)
const rt = getRuntime(sessionId);                              // (line ~201)
const now = …; const delta = …;
const bloat = rt.pendingBloatHits;   // snapshot   (line 217)
rt.pendingBloatHits = [];            // clear      (line 218)  ← the ONLY clear
…build metric using bloat…
```
`bloatReminderHandler` (Nudge A, line 142) pushes to `rt.pendingBloatHits` on its OWN gate (`bloatReminder`,
NOT `perTurnDrift`). So when `bloatReminder:true, perTurnDrift:false`, the gate at line ~199 returns BEFORE
the clear → `pendingBloatHits` grows by one entry per bloated result for the whole session (until
session_start resets the runtime). It's never read in that config (dead data, not a correctness bug), but it's
unbounded in-memory accumulation on the tool_result hot path.

## 2. The fix — BLOCK move (snapshot+clear TOGETHER, + getRuntime), NOT just the reset

The contract's RESEARCH NOTE offers two framings; the **authoritative** one is the "Actually…" clause: move
the snapshot+clear **as a block** (`const bloat = rt.pendingBloatHits; rt.pendingBloatHits = [];`) to BEFORE
the gate. WHY the block (not just the reset): if you cleared before the gate but snapshotted after it, the
after-gate snapshot would capture an already-empty array (tool_result fires BEFORE turn_end, so no new hits
arrive between a pre-gate clear and an after-gate snapshot) → `bloat` always empty → `bloatHit` always false
→ BREAKS the existing bloat-snapshot test (turn_metric.test.ts:241). Moving the BLOCK (snapshot THEN clear,
together, before the gate) captures the real hits into `bloat`, clears the field, and `bloat` is referenced
later (step 6 metric) only when perTurnDrift is on. `getRuntime(sessionId)` must move before the gate too
(the clear needs `rt`). `getConfig()` stays first (needed for the gate).

New order:
```
sessionId = ctx.sessionManager.getSessionId();
const config = getConfig();
const rt = getRuntime(sessionId);                 // ← moved before gate
const bloat = rt.pendingBloatHits; rt.pendingBloatHits = [];  // ← moved before gate (BLOCK)
if (!config.enabled || !config.nudges.perTurnDrift) return;   // GATE now AFTER the clear
const now = …; const delta = …;
…metric uses bloat (step 6)…
```

## 3. Why NO existing test breaks (verified against test/turn_metric.test.ts)

- **perTurnDrift-OFF test (line 146):** asserts only `appended.length===0` + `baseline unchanged` — does NOT
  assert pendingBloatHits. After the fix the gate still returns before appendTurnMetric/baseline-roll → passes.
  (It now ALSO clears pendingBloatHits, but the test doesn't check that.)
- **bloat snapshot-THEN-clear test (line 241):** perTurnDrift is ON (default) → gate passes → `bloat`
  captured before gate feeds the metric (snapshot) + field reassigned to fresh [] → passes unchanged.
- **fail-open: throwing-getSessionId test (line 398):** asserts pendingBloatHits NOT cleared when
  `getSessionId()` throws. `sessionId = getSessionId()` stays FIRST in the try; a throw jumps to catch
  BEFORE the clear → pendingBloatHits preserved → passes. (The clear is correctly AFTER sessionId, so a
  sessionId throw still skips it — the hits retry next turn. This is the desired fail-open semantics.)

## 4. The regression test (BUG-004 proof) — add to test/turn_metric.test.ts

In the "turnEndMetricHandler — config gates short-circuit before measurement (GOTCHA #8)" describe (line 134),
add an `it(...)` mirroring the existing perTurnDrift-OFF test (line 146) but seeding pendingBloatHits and
asserting it IS cleared:
- setConfig perTurnDrift:false (bloatReminder default true); seed rt.pendingBloatHits = 2 hits; call handler;
- assert `appended.length===0`, `baseline unchanged`, AND `rt.pendingBloatHits === []` (the BUG-004 assertion
  that FAILS before the fix, PASSES after).

Idiom (from line 241–262): `makePi()` → `{appended, pi}`; `makeCtx({sessionId})` → `{ctx}`; `makeEvent(n)`;
`getRuntime(id)`; `rt.pendingBloatHits = [{toolName, approxTokens}, …]`.

## 5. JSDoc update (Mode A)
Add a paragraph to the `turnEndMetricHandler` JSDoc (after the "NEVER throws… SYNC." paragraph, before "WHY pi
is a parameter"): note that `rt.pendingBloatHits` is snapshot+cleared BEFORE the perTurnDrift early-return
(always, every turn_end), because bloatReminderHandler pushes on its own `bloatReminder` gate; the snapshot
feeds the metric only when perTurnDrift is on.

## 6. Baseline + conflict check (verified)
- `npx tsc --noEmit` → exit **0** (clean).
- `npx vitest run test/nudges.test.ts test/drift_nudge.test.ts` → 75/75 green.
- **Parallel item P1.M1.T3.S1** edits `shouldNudge` (a DIFFERENT function, after turnEndMetricHandler) +
  `src/config.ts` (driftThresholdTokens 6000→4000) + `shouldNudge`'s `>`→`>=` + its JSDoc + test/config.test.ts
  + test/drift_nudge.test.ts. It does NOT touch `turnEndMetricHandler` (lines 188–218). DISJOINT regions in
  src/nudges.ts → no textual conflict; either order. (Both also leave `grewOverThreshold` line ~226 alone.)
- This PRP edits `src/nudges.ts` (turnEndMetricHandler block reorder + JSDoc) + `test/turn_metric.test.ts`
  (one regression `it(...)`). Nothing else.

## 7. Spec cross-reference
- PRD §2.3/§3.3 BUG-004 + §2.5 recommendation: "clear rt.pendingBloatHits at the top of turnEndMetricHandler
  (before the perTurnDrift early-return), or only push to it when perTurnDrift is also enabled." This PRP takes
  the first option (clear before the gate) — the smaller, cleaner fix that preserves the bloat-reminder's
  independence from the drift nudge.