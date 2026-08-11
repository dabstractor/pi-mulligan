# Validation Report — pi-mulligan

**PRD under validation:** Bug Fix Requirements (7 behavioral bugs: BUG-001…BUG-007).
**Verdict:** ✅ **PASS — zero issues found.** All seven PRD requirements are implemented correctly and verified through multiple independent means. No new issues were uncovered during end-to-end workflow simulation.

---

## 1. Executive summary

The PRD describes seven behavioral/PRD-compliance deviations (3 Major, 4 Minor; 0 Critical, 0 data-loss). An
end-to-end validation confirms **all seven are fixed** in the current source (git log shows a commit per fix;
working tree is clean). Critically, the fixes were verified **independently of the shipped test suite**: a
fresh probe reproducing each PRD "Steps to Reproduce" scenario was written by this validator, run against the
real source modules, and passed. The full unit suite (974 tests), `tsc --noEmit`, and the real-`pi` integration
smoke harness (14/14 scenarios) are all green, and the README + VERIFICATION.md are consistent with the fixes.

No critical, major, or minor issues remain. The structured verdict (`validation_result.json`) reflects
`hasIssues: false`, `issueCount: 0`.

---

## 2. Validation approach

| # | Phase | Tool | Result |
|---|-------|------|--------|
| 1 | Type checking | `tsc --noEmit` (strict) | ✅ 0 errors |
| 2 | Unit + integration tests | `vitest run` | ✅ 974 passed |
| 3 | End-to-end smoke (real `pi`) | `npm run smoke` (14 scenarios) | ✅ 14/14 passed |
| 4 | **Independent PRD probe** | fresh `vitest` file reproducing BUG-001…BUG-007 | ✅ 12 passed |
| — | Documentation consistency | README.md + VERIFICATION.md vs source | ✅ consistent |
| — | Skipped/incomplete work scan | grep for `.skip`/`.todo`/`xit` | ✅ none |

Phase 4 is the independent signal: the probe is **not** part of the shipped suite. It was materialized into
`test/` by `validate.sh`, executed, and deleted, so the result cannot be attributed to tests that were
retargeted alongside the fixes.

### User workflows exercised (simulated "User"/agent persona)

The integration smoke harness drives the **real** Mulligan tools (`makeRewindTool`,
`makeShrinkTool`, `makeCheckpointTool`) through complete journeys in a live `pi` process:

- **F-rewind-core** — agent sheds a bloated read via `mulligan_rewind(last_tool_call_group)`; the hidden
  result is absent from the post-filter view, the note survives, pairing is intact.
- **F-shrink-preventive** — Nudge A annotates a bloated result; the agent `mulligan_shrink`s it.
- **F-nudge-drift** — sustained per-turn growth triggers the §5.1 windowed drift nudge.
- **F-protected** — `to_previous_prompt` rewind across the first/only user message is refused pre-persist.
- **F-checkpoint** — `mulligan_checkpoint` → `mulligan_rewind(granularity:'checkpoint')` round-trip; the
  checkpoint is consumed on use.
- **F-reload / E11** — marker permanence across a session reload.
- **E7 / E12 / E15 / E20** — compaction, pre-first-inference audit, long-session marker accumulation,
  append-ordering races.

A dedicated **compaction E2E** probe (Phase 4) drives `filterPipeline` directly with a compaction entry on the
branch and asserts a pinned rewind's retained-tail tool result stays hidden (BUG-002 end-to-end) while pairing
is preserved (no orphaned `toolCall`).

---

## 3. Per-bug verification (BUG-001 … BUG-007)

Each row reproduces the PRD's own "Steps to Reproduce" and states the observed (post-fix) behavior. All were
confirmed by the independent probe in `validate.sh` Phase 4.

| ID | Severity | PRD symptom (pre-fix) | Verified post-fix behavior | Status |
|----|----------|------------------------|-----------------------------|--------|
| BUG-001 | Major | Drift nudge over-suppressed for ~10 min after any rewind/shrink (fixed 10-min wall-clock window `NUDGE_TURN_WINDOW_MS`). | `suppressCheck` now takes `recentMetrics` and uses a **turn-boundary** lower bound (`prevMetric.ts < marker.ts <= metric.ts`); a marker from a *previous* turn no longer suppresses a later turn. `NUDGE_TURN_WINDOW_MS` removed. | ✅ Fixed |
| BUG-002 | Major | ALL pinned rewinds became no-ops after the first compaction (hidden content leaked back into the model's view). | `resolvePinnedHide` is now **compaction-aware**: it locates the last compaction entry, maps the retained tail (entries after it) to the last N messages, and hides exactly the pinned retained-tail entries. E2E probe confirms the big tool result stays hidden post-compaction with pairing intact. | ✅ Fixed |
| BUG-003 | Major | Drift nudge did NOT fire for "three ~4k turns in a row" — spec §5.1 acceptance criterion (b) unmet (`avg(4000)=4000 < 6000`, strict `>`). | `driftThresholdTokens` default **6000→4000** and comparison **`>`→`>=`**; `shouldNudge([4k,4k,4k])` now returns `true` while `[8k,0.5k,0.5k]` still returns `false`. All three §5.1 criteria hold. | ✅ Fixed |
| BUG-004 | Minor | `pendingBloatHits` grew without bound when `bloatReminder=true, perTurnDrift=false` (cleared only after the per-turn-drift gate). | `turnEndMetricHandler` now snapshots+c**lears `rt.pendingBloatHits` BEFORE** the `perTurnDrift` early-return, every `turn_end`. Probe fires two bloated results + a turn_end and confirms the array is empty. | ✅ Fixed |
| BUG-005 | Minor | Per-prompt retry budget counted rewinds later retired by `mulligan:cancel` (a cancelled rewind never took effect yet consumed budget). | `countRetriesAtLatestPrompt` now scans post-prompt `mulligan:cancel` entries, collects their `data.targetId`, and skips rewinds whose `data.id` is retired. Probe: with `maxRetriesPerPrompt:2` and `[rw1(cancelled), rw2]`, a third rewind succeeds. | ✅ Fixed |
| BUG-006 | Minor | `mulligan_cancel` returned "…with that id" for the target path too, diverging from spec/05 §5. | No-op text is now **path-specific**: target path → "no active marker found **for that target**"; markerId path → "no active marker found **with that id**". Both pinned by probe. | ✅ Fixed |
| BUG-007 | Minor | `mulligan_checkpoint` wrote a label even when `enabled:false`, violating spec E14. | `checkpointExecute` now refuses with "Mulligan: refused — Mulligan is disabled." as step 0 (before name validation) and writes **no** label when disabled — byte-identical to the other four tools. All five tools now gate on the master switch. | ✅ Fixed |

---

## 4. Bug tracker

| Severity | Count | Items |
|----------|-------|-------|
| Critical | 0 | — |
| Major    | 0 | — |
| Minor    | 0 | — |
| **Total**| **0** | — |

No issues were found. The seven PRD requirements are fully met; end-to-end workflow simulation surfaced no
additional defects. The hidden-content soft-delete guarantee holds (no data loss); the leaks described in the
PRD were view-level and are now closed.

---

## 5. How to reproduce this validation

```bash
./validate.sh        # runs typecheck + unit suite + smoke + independent PRD probe
```

The script is self-contained, exits non-zero on any failure, and cleans up its temporary probe file. It skips
(gracefully, not as a failure) the Phase 3 smoke harness only if the `pi` binary is absent from `PATH`.