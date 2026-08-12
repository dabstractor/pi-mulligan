# Verification Findings — P1.M3.T1.S1 (README high-water + resolved-bugs entries for BUG-001–004)

**Task**: [Mode B] changeset-level README sync for the v1.1 validation-pass bug round (BUG-001–004). Verify
the high-water / driftThresholdTokens / highWaterFraction README lines are consistent with the fixes (they
are — the implementing subtasks updated them Mode-A), and ADD 4 resolved-bugs entries in a separate
collision-free subsection. README-only.

Ground truth read: README.md (structure + lines 98, 100, 233, 258-265, 269), architecture/system_context.md
+ bug_analysis.md (the 4 bugs), src/nudges.ts (renderHighWaterNudge:538-546), src/config.ts
(driftThresholdTokens:168), src/tools/audit.ts (BUG-003 annotation:449-454), P1M2T2S1/PRP (BUG-004 sibling).

---

## A. THE 4 BUGS (NEW v1.1 validation-pass set — DISTINCT from the prior BUG-001–005 set)

| ID | Sev | Fix (verified in source) |
|----|-----|--------------------------|
| BUG-001 | Major | `driftThresholdTokens` default 4000 + `shouldNudge` `>=` reconciled with spec/07 §5.1 criterion (b). Code/config/README/tests ALL agree at 4000+>= (the PRD's "6000" premise was stale). Fix = spec-text (`>` → `>=`) + comment cleanup. |
| BUG-002 | Major | `renderHighWaterNudge` rewritten **awareness-only**: `[mulligan] Context is at ~<pct>% of the window; review recent output for reclaimable space.` — NO `mulligan_rewind`/`mulligan_shrink` (D10: signal fires on user-attributable content). Source: nudges.ts:538-546. |
| BUG-003 | Minor | audit "Active markers" checkpoint clause appends ` (user-set)` + singularizes count (spec/13 §4 step 3). Source: audit.ts:449-454. |
| BUG-004 | Minor | `countRewindMarkers` (depth guard) now counts only **active** markers — excludes those retired by `mulligan:cancel` (spec/05 §1 step 4 "count active"; mirrors BUG-005 countRetriesAtLatestPrompt). Sibling P1.M2.T2.S1 (parallel). |

## B. README CONSISTENCY CHECK (contract steps a + c) — ALL ALREADY CONSISTENT

The implementing subtasks updated the README Mode-A. Verification confirms:

- **Line 233 (high-water feature description)** — ALREADY quotes the awareness-only text: `[mulligan] Context is
  at ~70% of the window; review recent output for reclaimable space.` This EXACTLY matches the post-fix
  renderHighWaterNudge source (nudges.ts:546: `` `[mulligan] Context is at ~${pct}% of the window; review recent
  output for reclaimable space.` ``). ✅ NO stale `mulligan_rewind`/`mulligan_shrink`/`Consider`/`reclaim space`
  wording. P1.M1.T2.S1 updated it. **No edit needed — just verify (contract step a).**
- **Line 98 (driftThresholdTokens config doc)** — ALREADY documents `4000` + the `>=` rationale ("The moving
  average over driftWindowTurns is compared with >= (not >)… §5.1 criterion (b)"). ✅ Matches source
  (config.ts:168 = 4000; nudges.ts:332 `avg >= driftThresholdTokens`). **No edit needed.**
- **Line 100 (highWaterFraction config doc)** — `0.7`, edge-triggered. BUG-002 changed the nudge TEXT, NOT the
  fraction default. ✅ Unaffected / consistent. **No edit needed.**
- **Line 118 (settings.json example)** — shows `"driftThresholdTokens": 4000`. ✅ Consistent. **No edit needed.**

**CONCLUSION**: contract steps (a) and (c) are VERIFICATION-ONLY — the README prose is already correct. The
sole README EDIT is the 4 new resolved-bugs entries (contract step b).

## C. THE README EDIT — 4 resolved-bugs entries in a separate subsection (contract step b)

**Existing prior-round section (lines 258-265)** — KEEP UNCHANGED:
- Heading line 258: `### Resolved bugs (BUG-001–BUG-005)`
- Bullets 262-265: checkpoint-clearing, config integer-validation, shrink empty-substring, audit-enabled-gate.
These are the PRIOR round's fixes — distinct from the current round.

**NEW subsection** — INSERT after the last prior bullet (line 265) and BEFORE the `## 8. License` heading
(line 269). Use a clearly-labeled heading so the BUG-001–004 numbering does NOT collide with the prior
BUG-001–005 set (contract: "distinct numbering that does NOT collide … label them as the v1.1 validation-pass
findings"):

```markdown
### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)

- **BUG-001 (Major)** — `driftThresholdTokens` default (4000) and the `shouldNudge` comparison (`>=`, not `>`) are reconciled with spec/07 §5.1 acceptance criterion (b): three ~4k turns in a row now fire the drift nudge (previously the strict-`>` + 6000 default failed to fire).
- **BUG-002 (Major)** — the §5.2 high-water nudge is now **awareness-only** (`Context is at ~<pct>% of the window; review recent output for reclaimable space.`) and no longer prescribes `mulligan_rewind`/`mulligan_shrink`, since the signal fires on user-attributable content the agent cannot legitimately shed (D10).
- **BUG-003 (Minor)** — the `mulligan_audit` "Active markers" checkpoint clause now appends ` (user-set)` and singularizes the count (spec/13 §4 step 3), so the human sees exactly what they have armed.
- **BUG-004 (Minor)** — the rewind depth guard (`rewind.maxDepth`) now counts only **active** markers, excluding those retired by `mulligan_cancel` (spec/05 §1 step 4 "count active"), so the cancel-then-retry workflow is no longer blocked at 5 cumulative rewinds.
```

Format matches the existing bullets (each: `- **BUG-NNN (Severity)** — one-line description.`).

## D. SCOPE
- EDIT: `README.md` ONLY (insert 1 new subsection with a heading + 4 bullets). [Mode B — this IS the doc sync.]
- DO NOT edit lines 98/100/118/233 (already consistent — verification only).
- DO NOT edit the prior "Resolved bugs (BUG-001–BUG-005)" section (lines 258-265 — distinct round, preserve).
- DO NOT edit src/* or test/* (the fixes' owners; README can't break them).
- PARALLEL-SIBLING: P1.M2.T2.S1 (BUG-004) edits src/tools/rewind.ts + test/tools/rewind.test.ts — different
  file, zero overlap with README.

## E. VALIDATION
- PRIMARY gate: README has the new "v1.1 validation pass (BUG-001–BUG-004)" subsection with 4 bullets; the
  prior section is intact; line 233 has no stale `mulligan_rewind`/`mulligan_shrink` high-water wording.
- NO-REGRESSION sanity: `npm run typecheck` + `npx vitest run` (README edits are non-behavioral; contract
  step d). Baseline: 1042 tests pass, tsc clean.

## F. FILES READ (evidence)
README.md (98, 100, 118, 233, 258-269), architecture/system_context.md + bug_analysis.md (the 4 bugs),
src/nudges.ts (renderHighWaterNudge:517-546), src/config.ts (driftThresholdTokens:168),
src/tools/audit.ts (BUG-003:449-454), P1M2T2S1/PRP.md (BUG-004 sibling).