# Bug Fix Requirements

## Overview
Rigorous end-to-end validation of pi-mulligan v1.1 against the PRD. The implementation is mature, heavily defended (every handler/tool is fail-open, E13), and all 1042 existing unit/integration tests pass. The guardrail (no rewind wipes user input except user-set checkpoints), the soft-delete model, tool pairing, pinning (BUG-001/002 fixes), the cancel tool, the banner reconciliation, and the D10 agent-attributable delta wiring were all verified correct. I found 4 PRD divergences, all in the nudge/audit/guard layer (none affect the core soft-delete correctness or cause data loss): (1) the driftThresholdTokens default is 4000 rather than the PRD-specified 6000 (a documented deviation citing an acceptance-criterion tension, but still a config-default mismatch); (2) the high-water nudge text prescribes mulligan_rewind/mulligan_shrink, contradicting the PRD §5.2 v1.1 note that it should be 'pure awareness, not rewind/shrink' — this re-couples the signal the D10 amendment deliberately separated, and fires misaligned advice on user-attributable bloat; (3) the audit report omits the '(user-set)' checkpoint annotation required by spec/13 §4 step 3; (4) the rewind depth guard counts cancelled markers, contradicting spec/05 §1 step 4 'count active,' with a stale pre-E21 justification and misleading refusal text. Findings (1) and (2) are the highest-impact (broad effect on a core feature); (3) and (4) are niche/conservative. No critical bugs: the core rewind/shrink/cancel/checkpoint/banner mechanisms are correct.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: driftThresholdTokens default is 4000 but PRD specifies 6000
**Severity**: Major
**ID**: BUG-001
**Location**: src/config.ts:168

**Description**:
The DEFAULT_CONFIG sets `nudges.driftThresholdTokens: 4000` (src/config.ts:168), but the PRD explicitly specifies a default of 6000 in two places. spec/09-configuration.md §2 shows `"driftThresholdTokens": 6000`, and §3's rationale states the value was deliberately 'Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point.' The lowered default of 4000 makes the per-turn drift nudge fire MORE aggressively than the PRD intends, re-introducing exactly the false-positive sensitivity on routine multi-file reads that the PRD raised the threshold to avoid. The drift nudge is a core feature (the 'free ride' mechanism) whose firing behavior is governed by this default. Verified via probe: getConfig().nudges.driftThresholdTokens === 4000, expected 6000. (Note: the implementer documented the deviation in nudges.ts and README.md, citing spec/07 §5.1 acceptance (b) 'three ~4k turns DO fire' — which 6000 would fail. This is a genuine spec-internal tension, but the implementation still diverges from the explicitly-specified PRD config default of 6000.)

**Steps to Reproduce**:
1. Load the extension with zero configuration (all defaults). 2. Call getConfig().nudges.driftThresholdTokens. 3. Observe 4000. PRD spec/09 §2/§3 specifies 6000. Alternatively: setConfig(undefined) then assert getConfig().nudges.driftThresholdTokens === 6000 (fails, returns 4000).

### Issue 2: High-water nudge text prescribes mulligan_rewind/mulligan_shrink, contradicting PRD 'pure awareness, not rewind/shrink'
**Severity**: Major
**ID**: BUG-002
**Location**: src/nudges.ts:534-543

**Description**:
renderHighWaterNudge (src/nudges.ts:534-543) emits: '[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.' This prescribes rewind/shrink. But the PRD spec/07-preventive-and-nudges.md §5.2 v1.1 note explicitly states the high-water signal's 'prescription is pure awareness, not rewind/shrink.' The rationale is load-bearing: the high-water signal measures TOTAL filtered context (including user-supplied content), so it fires on a large user paste (F-drift-userexempt acceptance in spec/10 §2.1 confirms the high-water signal DOES fire on a user paste). When it fires on user-attributable bloat, prescribing mulligan_rewind/mulligan_shrink is misaligned — the guardrail (spec/13 §1) protects user messages from rewind, and shrinking the user's ground-truth prompt is the wrong action. The PRD's D10 amendment exists precisely to separate 'the agent should shed something' (delta, agent-attributable) from 'the window is getting full' (high-water, total awareness-only). This implementation re-couples them. Verified via probe: renderHighWaterNudge(70000,100000) contains both 'mulligan_rewind' and 'mulligan_shrink'; PRD requires neither.

**Steps to Reproduce**:
1. Import renderHighWaterNudge from src/nudges.js. 2. Call renderHighWaterNudge(70000, 100000). 3. Observe 'Consider mulligan_shrink or mulligan_rewind to reclaim space.' 4. Per PRD spec/07 §5.2 v1.1 note, the text must be pure awareness and must NOT prescribe rewind/shrink (because the signal fires on user pastes, whose content the agent cannot legitimately shed).


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: Audit report 'Active markers' line omits '(user-set)' annotation for checkpoints
**Severity**: Minor
**ID**: BUG-003
**Location**: src/tools/audit.ts:448-454

**Description**:
renderAuditReport (src/tools/audit.ts:448-454) renders the checkpoint clause as 'N checkpoints [names]' but OMITS the '(user-set)' annotation that PRD spec/13-human-facing-surface.md §4 step 3 requires: 'the report's Active markers line includes `N checkpoints [names] (user-set)` so the human can see what they have armed.' The '(user-set)' annotation is meaningful in v1.1 because checkpoints moved to the user (E23) — it distinguishes them as user-owned destructive-power grants. This affects BOTH the agent's mulligan_audit tool AND the human /mulligan_audit command (they share renderAuditReport, per spec/13 §4 'same renderer'). Verified via probe: renderAuditReport({...checkpointNames:['before-x']...}) yields 'Active markers: 0 rewind, 0 shrink, 1 checkpoints [before-x]' — no '(user-set)'. (Secondary cosmetic nit: the count is not singularized — '1 checkpoints' should be '1 checkpoint'.)

**Steps to Reproduce**:
1. Import renderAuditReport from src/tools/audit.js. 2. Call renderAuditReport({totalTokens:1000, confidence:'medium', rewinds:[], shrinks:[], checkpointNames:['before-x'], protectedRoles:['first:user','latest:user'], rows:[], filtered:[], cancelledCount:0}). 3. Find the 'Active markers:' line. 4. Observe '1 checkpoints [before-x]' with NO '(user-set)'. PRD spec/13 §4 step 3 requires '(user-set)'.

### Issue 2: Rewind depth guard counts CANCELLED markers, contradicting spec 'count active' (E21 cancel workflow blocked at 5 cumulative rewinds)
**Severity**: Minor
**ID**: BUG-004
**Location**: src/tools/rewind.ts:204-220 (called at src/tools/rewind.ts:525)

**Description**:
countRewindMarkers (src/tools/rewind.ts:204-220) counts ALL persisted mulligan:rewind entries (`type==='custom' && customType==='mulligan:rewind'`) WITHOUT excluding markers retired by a mulligan:cancel entry. Its own comment justifies this with stale pre-E21 reasoning: 'Markers are permanent (never cleared), so ALL persisted rewind markers count toward maxDepth.' But E21 (spec/08-edge-cases.md) amended D6 — markers ARE now retractable via mulligan_cancel. PRD spec/05-tools.md §1 step 4 says 'count ACTIVE mulligan:rewind markers.' The result: an agent that legitimately creates 5 rewinds, cancels all 5 via mulligan_cancel (0 active remain), and attempts a 6th is REFUSED with a misleading message ('max rewind depth (5) reached — 5 active rewind marker(s)') even though there are 0 active markers. This blocks the documented cancel-then-retry workflow. Notably, the sibling guard countRetriesAtLatestPrompt (step 4b) DOES exclude cancelled rewinds (the BUG-005 fix), so the two guards are internally inconsistent in their treatment of cancels. The divergence is in the conservative (refuses earlier) direction, so impact is niche, but it is a clear spec violation and the refusal text is actively misleading. Verified via probe: 5 rewind markers each cancelled by a mulligan:cancel → a new rewind is depth-refused despite 0 active markers.

**Steps to Reproduce**:
1. Build a fake ctx whose getEntries() returns: 1 user message + 5 mulligan:rewind entries (each data.id='rew-N', data.seq=i) + 5 mulligan:cancel entries (each data.targetId='rew-N'). 2. Call makeRewindTool(fakePi).execute(...) with a valid note + granularity 'last_tool_call_group'. 3. Observe refusal text 'Mulligan: refused — max rewind depth (5) reached — 5 active rewind marker(s)...' 4. Per spec/05 §1 step 4 ('count ACTIVE'), with 0 active rewinds this should NOT be a depth refusal.

## Testing Summary
- Total bugs found: 4
- Critical: 0
- Major: 2
- Minor: 2

## Recommendations
- Reconcile the driftThresholdTokens default with the PRD: either restore 6000 (spec/09) and rework spec/07 §5.1 acceptance (b), or formally amend the PRD config default to 4000. The current state leaves the implementation and PRD disagreeing on an explicit value.
- Rewrite renderHighWaterNudge to be awareness-only (e.g. 'Context is filling up (~<pct>% of the window); review recent output') and NOT prescribe rewind/shrink, per PRD §5.2 v1.1 note — this is important because the signal fires on user pastes whose content the agent cannot legitimately shed.
- Add the '(user-set)' annotation to the audit report checkpoint clause (and singularize the count) per spec/13 §4 step 3.
- Update countRewindMarkers to exclude markers whose data.id is in the active cancelledIds set (mirroring countRetriesAtLatestPrompt's BUG-005 fix), so the depth guard honors spec/05 §1 step 4 'count active' and the cancel-then-retry workflow is not blocked.
