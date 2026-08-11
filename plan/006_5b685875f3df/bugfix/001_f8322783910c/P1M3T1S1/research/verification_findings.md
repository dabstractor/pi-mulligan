# Verification Findings — P1.M3.T1.S1 (Update VERIFICATION.md for the 7 bug fixes)

**Task**: [documentation] Sync VERIFICATION.md (root, 211 lines) to the post-fix codebase after the current
bug-fix round (P1.M1 + P1.M2). Update the stale "checkpoint non-gated" note, refresh the DoD #4 gate counts,
and add a fix-log/changelog table for the round's 7 fixes.

Ground truth read: VERIFICATION.md (full, 211 lines), architecture/system_context.md (the 7 fixes),
P1M2T4S1/PRP.md (BUG-007), src/{config,nudges,filter,tools/*}.ts (verified post-fix state).

---

## A. CRITICAL FINDING — the contract's premise is INACCURATE for 6 of 7 bugs

Contract step 2 says: "Read the current VERIFICATION.md to find every section that references: suppressCheck /
NUDGE_TURN_WINDOW_MS / 10-minute window (BUG-001), resolvePinnedHide / compaction / E24 (BUG-002), shouldNudge /
driftThresholdTokens / 6000 / criterion (b) (BUG-003), pendingBloatHits / perTurnDrift=false (BUG-004),
countRetriesAtLatestPrompt / cancel-awareness (BUG-005), cancel no-op text (BUG-006), checkpoint / config gate /
E14 (BUG-007)."

**PRECISE grep of VERIFICATION.md (this session):**
- `suppressCheck` / `NUDGE_TURN_WINDOW` / `10-min` / `wall-clock` → **0 hits** (BUG-001: NO stale note)
- `resolvePinnedHide` / `E24` → **0 hits** (BUG-002: NO stale note)
- `shouldNudge` / `6000` / `driftThreshold` → **0 hits** (BUG-003: NO stale note)
- `pendingBloatHits` / `perTurnDrift` → **0 hits** (BUG-004: NO stale note)
- `countRetriesAtLatestPrompt` → **0 hits** (BUG-005: NO stale note)
- `no-op` → 5 hits but ALL are DoD-framework ("pure no-op", "pinned no-op", fail-open) — NONE are the cancel-text
  note (BUG-006: NO stale note)
- `checkpoint` / `non-gated` / `always-on` → **lines 95-99** (BUG-007: the ONE genuine stale note)

**CONCLUSION**: VERIFICATION.md does NOT contain "deliberate deviation" notes for 6 of the 7 bugs. Those 6 were
bug-hunt FINDINGS (in the PRD/bug_hunt_result.json), never framed as "deliberate" in VERIFICATION.md. The ONLY
stale "deliberate deviation" note is lines 95-99 (checkpoint non-gated), which BUG-007 reverses. So "remove or
annotate deliberate deviation notes" (contract step 3) applies ONLY to that checkpoint note. The PRIMARY
deliverable is the fix-log/changelog table (contract step 3) + the DoD #4 refresh.

## B. THE GENUINE STALE CONTENT (what actually needs updating)

### Stale #1 — lines 95-99 (the checkpoint "non-gated" note) — BUG-007
```
**`checkpoint` is non-gated** (always-on; a harmless label write). **`audit` IS gated** on the master
config.enabled switch ... DoD #4's pure-no-op applies to the gated entry points (filter, rewind, shrink, audit,
bloat nudge, turn_end nudge), not checkpoint. An earlier draft of this note claimed audit + checkpoint were
"intentionally non-gated"; that pre-dates the BUG-005 audit gate and is corrected here.
```
This is now WRONG: BUG-007 added a `getConfig().enabled` gate to checkpointExecute (checkpoint.ts:138). After
the fix, checkpoint IS gated — it refuses "Mulligan: refused — Mulligan is disabled." when disabled (before name
validation, no label written). Update: checkpoint joins the gated set; the "not checkpoint" exclusion is gone.

### Stale #2 — line 20 (DoD #4 row: gate count)
`**5 gates present** (filter/rewind/shrink/nudges×2) + **115 disabled-path tests green**`
STALE: there are now **7 gate sites across 7 files** — filter.ts:240, rewind.ts:511, shrink.ts:286,
audit.ts:584 (prior BUG-005), cancel.ts:350, checkpoint.ts:138 (BUG-007), nudges.ts:122 + nudges.ts:217.
All five tools + filter + 2 nudge handlers are now gated. (The "5 gates" predates the audit+cancel+checkpoint gates.)

### Stale #3 — lines 54-56 (DoD #4 grep cheat-sheet)
`grep -n '!config.enabled\|!cfg.enabled' src/filter.ts src/tools/rewind.ts src/tools/shrink.ts src/nudges.ts`
STALE: omits audit.ts, cancel.ts, checkpoint.ts. Expand to include all 5 tools (the grep must list
src/tools/audit.ts, src/tools/cancel.ts, src/tools/checkpoint.ts too). The result comment must list all 7 sites.

### Stale #4 — lines 58-61 (DoD #4 code-inspection)
`grep -rn "Mulligan is disabled" src/tools/  # → present in rewind.ts + shrink.ts`
STALE: post-fix, "Mulligan is disabled" / the refusal text is in ALL FIVE tools (rewind, shrink, audit,
cancel, checkpoint). Update the comment to reflect all five.

## C. THE NEW DELIVERABLE — fix-log/changelog table (contract step 3)
Append a new section (mirroring the existing "Bug-fix remediation pass — BUG-001 through BUG-006" table at
lines 195-211) for the CURRENT round's 7 fixes. Source-of-truth fix details (verified in src/ + system_context.md):

| Bug | Sev | Root cause | Fix applied | Regression test |
|-----|-----|-----------|-------------|-----------------|
| BUG-001 | Major | `suppressCheck` (nudges.ts) used a fixed 10-min wall-clock window (`NUDGE_TURN_WINDOW_MS`) instead of the spec §5.3 turn-boundary check → drift nudge over-suppressed ~10 min after any rewind/shrink | Turn-based lower bound: a marker is "during the metric's turn" iff `prevMetric.ts < marker.ts <= metric.ts` (uses `recentMetrics[1]?.ts`); `NUDGE_TURN_WINDOW_MS` removed | drift_nudge.test.ts suppressCheck cases |
| BUG-002 | Major | `resolvePinnedHide`/`resolvePinnedShrink` (transforms.ts) bailed entirely on hitting ANY compaction entry → ALL pinned hides no-op after the first compaction (broader than documented E24) | Compaction-aware retained-tail walk: find the last compaction entry; the retained tail (entries after it) maps to the last N messages; walk only the tail | transforms.test.ts compaction cases |
| BUG-003 | Major | `shouldNudge` moving-average vs `driftThresholdTokens` (6000) used strict `>` → `avg([4000,4000,4000])=4000 < 6000` did not fire, violating §5.1 criterion (b) | `driftThresholdTokens` default 6000→**4000** (config.ts:158) + comparison `>`→**`>=`** (nudges.ts:328) | drift_nudge.test.ts criterion (b) case |
| BUG-004 | Minor | `turnEndMetricHandler` cleared `rt.pendingBloatHits` AFTER the `perTurnDrift` early-return → unbounded growth when `bloatReminder=true, perTurnDrift=false` | Move the snapshot+clear of `pendingBloatHits` to BEFORE the early-return (nudges.ts:181, 214-215) | nudges.test.ts |
| BUG-005 | Minor | `countRetriesAtLatestPrompt` (rewind.ts) counted ALL post-prompt rewind markers, including ones later retired by `mulligan:cancel` → inflated the E22 budget | Cancel-exclusion: scan post-prompt `mulligan:cancel` entries, collect their `data.targetId` into a Set, skip counted rewinds whose `data.id` is in it (rewind.ts:242-281) | rewind.test.ts cancel-aware retry cases |
| BUG-006 | Minor | `mulligan_cancel` emitted one no-op text ("with that id") for BOTH the target-not-found and markerId-not-found paths (spec/05 §5 wants distinct texts) | Split the no-op text by resolution path: target→"for that target", markerId→"with that id" | cancel.test.ts (updated pin) |
| BUG-007 | Minor | `mulligan_checkpoint` had NO `getConfig().enabled` gate (its header documented the omission as intentional) → wrote a label when disabled, violating E14 | Add `getConfig().enabled` gate as step 0 inside the try (before name validation); refuses byte-identical "Mulligan: refused — Mulligan is disabled." (checkpoint.ts:138) | checkpoint.test.ts config-disabled describe (2 tests) |

## D. POST-FIX SOURCE STATE (verified this session)
- **Config gates** — 7 sites: filter.ts:240, rewind.ts:511, shrink.ts:286, audit.ts:584, cancel.ts:350,
  checkpoint.ts:138, nudges.ts:122 + nudges.ts:217. (BUG-007 confirmed landed.)
- **driftThresholdTokens = 4000** (config.ts:158, was 6000).
- **shouldNudge uses `>=`** (nudges.ts:328 `return avg >= config.nudges.driftThresholdTokens;`).
- **suppressCheck** is turn-based (nudges.ts:364 JSDoc "implementing spec/07 §5.3"); NUDGE_TURN_WINDOW_MS gone.
- **countRetriesAtLatestPrompt** cancel-aware (rewind.ts:242-281 CANCEL-EXCLUSION comment).
- **pendingBloatHits** cleared before the perTurnDrift early-return (nudges.ts:181, 214-215).
- **checkpoint** config gate present (checkpoint.ts:138).

## E. SCOPE
- EDIT: `VERIFICATION.md` ONLY (4 stale-note updates + 1 new fix-log table). [documentation task — this IS the doc task.]
- DO NOT edit src/*, test/*, README.md (README is sibling P1.M3.T1.S2; src/test are the fixes' owners).
- The existing "Bug-fix remediation pass — BUG-001 through BUG-006" table (lines 195-211) is a PRIOR round's
  accurate history — DO NOT delete/overwrite it; ADD the new round's table as a SEPARATE section. (Bug numbers
  collide between rounds — keep them distinct by labeling the new section "round 2 / PRD-compliance" or similar.)

## F. VALIDATION
- PRIMARY gate: grep VERIFICATION.md confirms (a) no "checkpoint is non-gated"/"not checkpoint" stale claim;
  (b) the new fix-log table lists all 7 bugs; (c) DoD #4 lists all 7 gate sites / 5 tools.
- NO-REGRESSION sanity: VERIFICATION.md edits can't affect tsc/vitest. Run `npm test` to record the CURRENT
  count for the new table (the prior table's "956" is historical; the new table records the post-this-round count).
  Baseline this session: 21 test files pass; tsc clean.

## G. FILES READ (evidence)
VERIFICATION.md (full 211 lines), architecture/system_context.md (7 fixes), P1M2T4S1/PRP.md (BUG-007),
src/config.ts (driftThresholdTokens:158), src/nudges.ts (shouldNudge:328, suppressCheck:364, pendingBloatHits:181/214),
src/tools/{rewind:511,shrink:286,audit:584,cancel:350,checkpoint:138}.ts, src/filter.ts:240.