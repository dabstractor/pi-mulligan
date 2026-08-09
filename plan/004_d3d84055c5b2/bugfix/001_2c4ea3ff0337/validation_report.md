# pi-mulligan — Validation Report

**Date:** 2025-08-09 · **Pi:** 0.84.1 · **Scope:** Full end-to-end validation against the PRD (bug-fix requirements).

## Executive Summary

The two defects documented in the PRD are **both resolved** in the current codebase, and **no new issues** were found across deep source review, the full unit suite, strict type-checking, and the live integration smoke harness. The headline `enabled:false` master-disable switch — the PRD's Major issue (BUG-001) — is fixed **and verified end-to-end at the behavioral level**: mulligan's own context filter now honors a project-local `enabled:false` and becomes a true no-op. The project type-checks cleanly (`tsc --noEmit` exit 0) and the stale test fixture (BUG-002) is corrected.

**Verdict: PASS — 0 issues.**

---

## Validation Approach

1. **Deep source review.** Read every core module: `index`, `config`, `settings`, `filter`, `transforms`, `nudges`, `notes`, `markers`, `ledger`, `tokens`, `runtime`, `log`, and all five tools (`rewind`, `shrink`, `checkpoint`, `cancel`, `audit`), plus the smoke harness (`run-smoke.mjs`, `smoke.ts`). Cross-referenced each against `spec/` and `README.md`.
2. **Type checking.** `tsc --noEmit` against the project `tsconfig.json` (which `include`s both `src` and `test`).
3. **Unit testing.** `vitest run` (21 test files).
4. **Integration smoke.** `npm run smoke` against real `pi 0.84.1` + a live model — 14 deterministic scenarios.
5. **Behavioral config-disable probe.** A custom end-to-end check that the `enabled:false` switch is actually honored by mulligan's own filter (the decisive proof that `settings.json` is genuinely read).

---

## PRD Issue Status

### BUG-001 (Major) — Configuration surface non-functional — **FIXED ✅**

The PRD reported that `index.ts` called `setConfig(undefined)` so the entire configuration surface (the master `enabled` switch + all knobs + `log.file`) was ignored. **This is resolved.**

- **`src/index.ts`** now calls `setConfig(loadMulliganConfig(process.cwd()))` at factory time, and re-reads on every `session_start` reason (startup|reload|new|resume|fork) via `setConfig(loadMulliganConfig(ctx.cwd))`. `setLogFile` is re-pointed after each config load.
- **`src/settings.ts`** is fully implemented: it reads the global (`~/.pi/agent/settings.json` via `getAgentDir()`) + project-local (`<cwd>/.pi/settings.json`) settings, deep-merges them (project wins; nested recurse; arrays replace — mirroring Pi's `deepMergeObjects`), and returns the raw `mulligan` block. The whole body is fail-open (`try/catch → undefined`).
- **Unit coverage** (`test/index.test.ts`, `test/settings.test.ts`, `test/config.test.ts`): asserts `loadMulliganConfig(process.cwd())` is called and its return flows through `setConfig` → `getConfig()`; uses **real temp files** for `readSettingsFile`/`deepMergeSettings`/`loadMulliganConfig`; covers global+project merge and fail-open.

**End-to-end behavioral proof (new, performed this validation):**
- A real `pi` process running from a temp cwd with `.pi/settings.json = { "mulligan": { "enabled": false } }` returns `loadMulliganConfig(cwd) = {"enabled":false}` — the real code path reads the disabled setting correctly.
- The `F-shrink-persist` scenario was driven in a **DISABLED** project and an **ENABLED** project. The shrink marker was created in **both** (tool returned "Matched now: yes"), but mulligan's own filter applied it only when enabled:
  - DISABLED project → `context.fire` `shrunkInContext: false` (filter pass-through — the disable switch is honored).
  - ENABLED project → `context.fire` `shrunkInContext: true` (filter applied the substitution).

This decisively confirms mulligan's own context handler (loaded via `index.ts`, the only realm that populates the config cache from real settings) honors `enabled:false` and becomes a no-op. *(Note: each `-e` extension gets an isolated module cache under pi's jiti loader, so an external observer cannot read mulligan's internal config directly — but behavioral observation of the filter's pass-through is conclusive.)*

### BUG-002 (Minor) — `tsc --noEmit` fails (stale fixture) — **FIXED ✅**

`npx tsc --noEmit` now exits **0**. The fixture in `test/drift_nudge.test.ts` includes `rewindRefusedTurnIndex: null`, satisfying the `SessionRuntime` type. (Runtime was unaffected — vitest transpiles without type-checking — so this was strictly a CI-gate cleanliness fix.)

---

## Testing Results

| Check | Command | Result |
|-------|---------|--------|
| Type checking | `npx tsc --noEmit` | ✅ exit 0 (clean) |
| Unit tests | `npx vitest run` | ✅ **912/912 passed** (21 files) |
| Integration smoke | `npm run smoke` | ✅ **14/14 scenarios passed** (exit 0) |
| Config-disable E2E | custom probe | ✅ disabled=no-op, enabled=active |

**Smoke scenarios passing (exit 0 from `run-smoke.mjs`):** F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7, E11, E12, E15, E20.

**Live observation:** the extension's nudges (bloat reminder + windowed drift nudge) were observed firing on this validator's own session during large file reads, confirming the ride-along nudge subsystem operates correctly in a real pi process.

---

## Source Review Findings (all clean)

All 17 reviewed modules are robust, defensive, and spec-compliant:

- **Fail-open discipline** is uniform: every handler (`context`, `tool_result`, `turn_end`) and every tool `execute()` wraps its entire body in one `try/catch` → logged no-op / pass-through. An extension bug can never break an agent turn (spec/03 #4, spec/08 E13).
- **Soft-delete / audit trail** is intact: rewinds/shrinks persist markers; originals stay on disk and remain visible via Pi's `/tree`.
- **Pairing invariant** is preserved by construction (`partitionIntoUnits` groups each assistant tool-call with its results; `applyShrink` spreads `{...orig}` overriding only `content`, keeping `role`/`toolCallId`/`toolName`/`isError`).
- **BUG-001/BUG-002 pinned-hide permanence** (the in-product bug-replay fix, distinct from the PRD's config BUG-001): new rewind markers pin stable *entry* ids (`hideEntryIds`) resolved by identity each fire, so hidden content never leaks back as the session grows; a `turnHasAdvanced` replay guard no-ops legacy un-pinned markers once new work follows.
- **E22 runaway-loop backstops** are implemented and unit-tested: per-prompt retry budget (`rewind.maxRetriesPerPrompt`) + context-fraction stop (`rewind.abortContextFraction`, computed on the filtered view) — both refuse *before* persisting.
- **Retraction** (`mulligan_cancel`) correctly maps the passed entry id → the marker's uuid `data.id` (since `readMarkers` drops by uuid), with already-cancelled idempotency and a safe no-op for unknown ids.

---

## Issues Found

**None.** Both PRD-documented issues (BUG-001, BUG-002) are resolved, and the deep review + full automated suites surfaced no new critical, major, or minor defects.

## Non-blocking Observations (recommendations, NOT issues)

These are aspirational polish items — the code is fully correct and functional without them, so they are **not counted as issues**:

- **CI gate.** Adding a CI step that runs `tsc --noEmit` (alongside `vitest run`) would lock in the BUG-002 cleanliness fix. The `package.json` already exposes a `typecheck` script for this.
- **E2E coverage for §5.2 high-water nudge & E22 context-fraction guard.** Both are unit-tested and code-reviewed correct; an additional integration scenario for each would add marginal confidence. (As the PRD noted, `abortContextFraction` evaluates the last context-fire's filtered view — which excludes the current turn's just-produced tool results — so it lags one turn in the exact re-bloat loop it targets; this is spec-consistent and acceptable, but a code comment documenting the one-turn lag would aid future maintainers.)
- **LICENSE file.** The README recommends adding a top-level MIT `LICENSE` (the project is MIT per `spec/SPEC.md`); its absence is documented, not a defect.

---

## Conclusion

pi-mulligan is production-ready as validated. The configuration surface (the PRD's Major defect) is fully wired and the master-disable switch is verified working end-to-end; the project type-checks cleanly; the full automated suite (912 unit tests + 14 integration scenarios) passes. **0 issues remain.**