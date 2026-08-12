# pi-mulligan v1.1 — Validation Report

**Date:** 2026-08-12
**Validator scope:** End-to-end validation of pi-mulligan v1.1 against the PRD (Bug Fix Requirements: BUG-001–BUG-004).
**Verdict:** ✅ **PASS — 0 issues.** All four PRD-described bugs are already **resolved** in the current tree (commits `a37c5263`, `32ee702d`, `02da9dd3`, `4c55abc6`, `0cf8d461`), each verified independently. No new code defects were found.

---

## 1. Context: the PRD vs. the current tree

The PRD (Bug Fix Requirements) is a **prior** validation pass's finding list describing four divergences (2 Major, 2 Minor; 0 Critical, 0 data-loss) in the nudge/audit/guard layer. **A fixer has since run**: the git history shows commits fixing BUG-002/003/004 and reconciling BUG-001, and the README "Resolved bugs — v1.1 validation pass" section documents all four as resolved.

This validation therefore re-checked the **current** state of each of the four locations **independently** (not trusting the commit messages or the existing regression tests), and then ran a broad spec↔code + E2E sweep for any remaining or newly-introduced issues.

---

## 2. Methodology & phases

| Phase | What | Result |
|---|---|---|
| 1 | Type checking — `npm run typecheck` (`tsc --noEmit`, strict) | ✅ clean |
| 2 | Unit + integration — `npm test` (`vitest run`) | ✅ **1044/1044** pass (PRD said 1042; +2 are the bug-fix regression tests) |
| 3 | **Independent** bug-fix probe (7 assertions) — temp vitest file asserting BUG-001–004 fixed | ✅ 7/7 |
| 4 | Config-defaults consistency scan — all 19 `spec/09 §2` defaults vs `src/config.ts DEFAULT_CONFIG` | ✅ 19/19 agree |
| 5 | E2E smoke — `npm run smoke` (14 deterministic `pi` user-workflow scenarios) | ✅ 14/14 on direct/faster-model runs (see §5) |

---

## 3. Per-bug verification (all four RESOLVED)

### BUG-001 (Major) — `driftThresholdTokens` default — ✅ RESOLVED
- **PRD claim:** code `4000` vs spec/09 `6000`.
- **Current state:** Reconciled by **amending the spec to the code value** (PRD recommendation option #2). `src/config.ts:168` `driftThresholdTokens: 4000`; `spec/09-configuration.md` §2 (`"driftThresholdTokens": 4000`) and §3 rationale table (`4000`, with the `>`→`>=` justification) now **agree**. The `shouldNudge` gate (`src/nudges.ts:332`) uses `avg >= driftThresholdTokens`, so spec/07 §5.1 acceptance criterion (b) — three ~4k turns fire — holds. (`grewOverThreshold` at line 240 is a separate per-turn flag, strict `>`, explicitly NOT consulted by the gate — line 314 — so no inconsistency.)
- **Independent probe:** `getConfig().nudges.driftThresholdTokens === spec/09 §2 === spec/09 §3 === 4000`. ✅
- **Full config scan:** all 19 defaults consistent → closes the entire class of bug. ✅

### BUG-002 (Major) — high-water nudge awareness-only — ✅ RESOLVED
- **PRD claim:** `renderHighWaterNudge` prescribed `mulligan_rewind`/`mulligan_shrink`, contradicting spec/07 §5.2 v1.1 note ("pure awareness, not rewind/shrink").
- **Current state:** `src/nudges.ts:538-548` returns `[mulligan] Context is at ~<pct>% of the window; review recent output for reclaimable space.` (and a `%`-free fallback when `windowTokens<=0`). **No rewind/shrink prescription.** Percentage uses `Math.round` (contract example "~70%" for 0.7 holds). `injectHighWaterNudge` (line 579) is wired to this renderer.
- **Independent probe:** `renderHighWaterNudge(70000,100000)` contains neither `rewind` nor `shrink` (case-insensitive), contains `~70%`, references context/window. ✅

### BUG-003 (Minor) — audit report `(user-set)` + singularization — ✅ RESOLVED
- **PRD claim:** `Active markers` line rendered `N checkpoints [names]` with no `(user-set)` and no singularization, contradicting spec/13 §4 step 3.
- **Current state:** `src/tools/audit.ts:449-460` adds `ckptWord` (`1`→`checkpoint`, else `checkpoints`) and `ckptUserSet = checkpointNames.length > 0 ? " (user-set)" : ""`. Both the agent **tool** (`auditExecute` → `renderAuditReport`, line 649) and the human **`/mulligan_audit` command** (`src/commands.ts:340`, identical renderer call per spec/13 §4 "same renderer") share the fix.
- **Independent probe:** 1 checkpoint → `1 checkpoint [before-x] (user-set)`; 0 → `0 checkpoints []` (no annotation); 2 → `2 checkpoints [a, b] (user-set)`. ✅

### BUG-004 (Minor) — depth guard counts cancelled markers — ✅ RESOLVED
- **PRD claim:** `countRewindMarkers` counted cancelled rewinds, blocking the cancel-then-retry workflow at 5 cumulative rewinds, contradicting spec/05 §1 step 4 "count ACTIVE".
- **Current state:** `src/tools/rewind.ts:208-260` now first collects `cancelledRewindIds` (all `mulligan:cancel` entries' `data.targetId`), then skips any `mulligan:rewind` whose `data.id ∈ cancelledRewindIds`. Mirrors the sibling `countRetriesAtLatestPrompt` BUG-005 fix and `readMarkers`' `cancelledIds` (filter.ts). Refusal text now accurately reports `N active rewind marker(s)`.
- **Independent probe (self-contained fake, not the existing test):** 5 rewinds each retired by a `mulligan:cancel` → a new rewind is **not** depth-refused (output contains neither `max rewind depth (5) reached` nor `5 active rewind marker(s)`). ✅

---

## 4. Additional checks (no new issues)

- **README accuracy:** the "Resolved bugs — v1.1 validation pass" section (README.md:267-274) describes all four fixes correctly and matches the verified code.
- **No latent markers:** `grep -rn 'TODO|FIXME|HACK|XXX' src/` returns nothing concerning (one comment references upgrading a spec section).
- **Guardrail / soft-delete model:** the protected-roles guard, soft-delete (cancel) model, tool pairing, pinning, banner reconciliation, and D10 agent-attributable delta wiring are all exercised green by the unit suite (edge-cases.test.ts, transforms.test.ts, filter.test.ts) and the E2E smoke scenarios (F-protected, F-failopen, F-checkpoint, E15, E20).
- **Bug-fix commits did not introduce regressions:** BUG-002/003/004 fixes touched only `nudges.ts`, `audit.ts`, `rewind.ts` (+ spec text). The full 1044-test suite and the 14-scenario smoke pass.

---

## 5. E2E smoke observations (environmental, not code defects)

The E2E smoke suite (`npm run smoke`) spawns 14 fresh `pi` processes, each driving a real user workflow (rewind/shrink/checkpoint/nudge/protected/maxdepth/failopen/reload + E7/E11/E12/E15/E20). It is **model-dependent**:

- In one tight-budget full-suite run (default model, 280 s outer cap) two scenarios transiently failed: **F-shrink-persist** (0 `tool.shrink` lines — prompt 1 sent the model agentic, eating the 120 s per-process budget so the `/mulligan_smoke` command never ran) and **E12** (pi `exit=1` on the model turn — but the `E12.audit` line logged `source:"fallback"` first, proving the E16 fallback path the scenario tests **did** work).
- **Both pass reliably when run directly:** F-shrink-persist — `tool.shrink` logged ×2, `shrunkInContext:true`, `userShrunkInContext:true`; E12 — 3/3 direct runs `pi_exit=0`, audit logged. With a faster model the **full 14/14 suite passes**.
- The shrink tool itself is unrelated to the bug-fix commits (none touched `src/tools/shrink.ts`) and passes its 40 unit tests.

**Conclusion:** these are environmental model-latency flakes in the smoke *harness*, not product-code defects. The deterministic command-path assertions (markers persist before any model call) hold in every run. No action required on the product; the smoke harness's per-process/outer timeout budget is the only thing worth tuning for very slow models (out of scope for this validation).

---

## 6. Issue tracker

| ID | Severity | Status | Notes |
|---|---|---|---|
| BUG-001 | Major | **RESOLVED** | spec amended to 4000; `>=` gate; full config scan 19/19 consistent |
| BUG-002 | Major | **RESOLVED** | high-water nudge is awareness-only, no rewind/shrink |
| BUG-003 | Minor | **RESOLVED** | `(user-set)` annotation + singularization on both surfaces |
| BUG-004 | Minor | **RESOLVED** | depth guard counts only active (non-cancelled) rewinds |

**Total open issues: 0** (Critical: 0, Major: 0, Minor: 0).

---

## 7. Recommendation

No fixer run required. The four PRD bugs are fixed and independently verified; the type checker, the full 1044-test unit/integration suite, a 7-assertion independent fix-verification probe, a 19/19 config-default consistency scan, and all 14 E2E smoke scenarios (on direct/faster-model runs) are green. The only observation is environmental smoke-harness flakiness under very slow models, which is not a product defect.