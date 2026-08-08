# E1–E20 Edge Case → Implementation → Test Mapping

Source of truth: `spec/08-edge-cases.md`. Verified against LIVE `src/` (all modules Complete).
This file maps each edge case to (a) WHERE it is handled in code, (b) test tier (unit vs smoke),
(c) the concrete assertion, and (d) existing coverage status + any gap.

Legend: ✅ = already covered by an existing `test/*.test.ts`; 🆕 = NOT yet covered → edge-cases.test.ts
must add it; ⚠ = gap/finding to probe; 🔌 = Pi-dependent → smoke harness.

---

## TIER 1 — UNIT TESTS (test/edge-cases.test.ts, no Pi)

### E1 — Orphan toolResult (no matching toolCall)
- **Code**: `partitionIntoUnits` (transforms.ts) → orphan result skipped in assistant-join → falls to a
  `plain` unit (its own). Rewind removes whole units only → never orphans either side.
- **Existing**: ✅ transforms.test.ts "orphan result → its OWN plain unit" + pairing-invariant tests.
- **🆕 edge-cases.test.ts**: a DEDICATED E1-named test: orphan result present → `filterPipeline` with a
  `last_tool_call_group` rewind still leaves NO orphan call/result in the output (pairing-invariant holds).
  Assert the orphan plain unit is removable as a unit (both-sides-confirmed rule).

### E2 — Rewinding the executing turn
- **Code**: `resolveLastToolCallGroup(units, m, excludeToolCallId)` skips the rewind's own toolGroup
  (transforms.ts). `resolveLastTurn` keeps the rewind's own unit via `rewindOwnIndices`.
- **Existing**: ✅ transforms.test.ts resolveLastToolCallGroup "exclude the rewind's own".
- **🆕 edge-cases.test.ts**: E2-named test: messages where the LAST toolGroup IS the rewind itself
  (excludeToolCallId set) → resolves to the PREVIOUS toolGroup, never null/self. Also: rewind tool
  marker carries excludeToolCallId === execute's toolCallId arg (covered in rewind.test.ts; re-assert here
  as the E2 contract).

### E3 — Rewinding across a protected message
- **Code**: `resolveLastTurn` nuclear refuses when iFirstUser===iLastUser (transforms.ts);
  `protectedOk` (transforms.ts) = defense-in-depth `min(remove) > iFirstUser`; rewind tool refuses
  before persisting (rewind.ts returns refusal — but the TOOL doesn't pre-check protected; the FILTER
  does via protectedOk). **Note**: the tool does NOT itself refuse on protected — it persists, and the
  filter no-ops. E3 text says "the tool refuses before persisting" but the IMPLEMENTED behavior is
  filter-side no-op (defense-in-depth). This is a spec-vs-code divergence worth a 🆕 test that documents
  the ACTUAL behavior (filter no-ops + the resolveLastTurn nuclear refusal).
- **Existing**: ✅ resolveLastTurn nuclear refusal tested; protectedOk tested.
- **🆕 edge-cases.test.ts**: E3-named test: a `to_previous_prompt:true` rewind on a single-user-message
  list → `resolveLastTurn` returns {remove:[]} AND protectedOk(... ) on a remove that WOULD cross
  iFirstUser returns false → filterPipeline leaves messages unchanged. Document the actual two-layer
  defense (resolver refuses nuclear; protectedOk blocks anything crossing first:user).

### E4 — Max rewind depth exceeded
- **Code**: `countRewindMarkers(ctx)` + depth guard in rewind.ts execute (`depth >= config.rewind.maxDepth`
  → refusal naming count). Default maxDepth=5.
- **Existing**: ✅ rewind.test.ts depth-guard cases.
- **🆕 edge-cases.test.ts**: E4-named test using makeRewindTool(fakePi)+makeCtx with 5 pre-seeded
  mulligan:rewind entries → 6th call returns refusal text containing "depth"/"max"; makeCtx.entries shows
  exactly 5 counted. Verify countRewindMarkers counts ONLY type:"custom"+customType:"mulligan:rewind".

### E5 — Rewinding a span with side effects (writes/bash)
- **Code**: rewind.ts — `resolvePreview` → `extractFileLedger` over the removed indices → if
  `config.rewind.requireMutationWarning && (modifiedFiles.length>0 || bashSideEffects.length>0)` →
  MUTATION_WARNING appended VERBATIM. `renderNote` includes `<files-modified>`/`<bash-side-effects>` blocks.
- **Existing**: partial (ledger.test.ts covers extractFileLedger; notes.test.ts covers renderNote blocks).
- **🆕 edge-cases.test.ts**: E5-named test: rewind tool with a ctx whose buildContextEntries yields a span
  containing an edit + a mutating bash → success text ENDS with the VERBATIM MUTATION_WARNING ⚠ string AND
  the persisted note content (captured via fakePi.sent) contains `<files-modified>` + `<bash-side-effects>`.
  Also: requireMutationWarning:false → NO warning even with side effects.

### E6 — Parallel tool mode (mulligan_rewind with siblings)
- **Code**: `resolveLastToolCallGroup` skips the WHOLE shared unit (assistantIssuedCall scans all calls);
  `resolveLastTurn` keeps the whole shared unit (rewindOwnIndices = all unit indices). Conservative.
- **Existing**: ✅ resolveLastToolCallGroup parallel case; resolveLastTurn keeps own unit.
- **🆕 edge-cases.test.ts**: E6-named test: one assistant message issuing BOTH mulligan_rewind(callId=R)
  AND a sibling tool call(callId=S) with result(S); excludeToolCallId=R → resolveLastToolCallGroup skips
  the shared unit → returns the PREVIOUS toolGroup (or null). resolveLastTurn: rewindOwnIndices contains
  BOTH the shared assistant + result(S) (kept whole). Document "keep entire shared message".

### E8 — Marker targets nothing (already removed/compacted)
- **Code**: applyRewind empty remove → same ref; applyShrink no-match → same ref; resolveLastToolCallGroup
  → null → remove=[]; resolveCheckpoint → null → remove=[]. No error, silently retried next fire.
- **Existing**: ✅ applyRewind/applyShrink no-op tests; filterPipeline idempotency.
- **🆕 edge-cases.test.ts**: E8-named test: filterPipeline with a checkpoint rewind whose label is absent
  (branchEntries empty) → remove=[] → messages UNCHANGED (=== same reference). And a shrink whose target
  isn't present → same ref. Assert `result === messages` (reference equality = true no-op).

### E9 — Note field validation failure
- **Code**: `validateNote` (notes.ts) — all 4 fields non-empty after trim; rewind.ts refuses with
  NOTE_INVALID_REASON ("note fields must all be non-empty").
- **Existing**: ✅ notes.test.ts validateNote; rewind.test.ts invalid-note refusal.
- **🆕 edge-cases.test.ts**: E9-named test: rewind tool with note.what_happened="" (and whitespace-only)
  → refusal text "Mulligan: refused — note fields must all be non-empty." AND NO marker persisted
  (fakePi.appended empty) AND NO note sent (fakePi.sent empty). Tests all 4 fields individually.

### E10 — Checkpoint name invalid or not found
- **Code**: `validCheckpointName` (/^[a-z0-9_-]{1,40}$/) in checkpoint.ts (refuses at creation);
  `checkpointExists` in rewind.ts (refuses at rewind time); `resolveCheckpoint` → null (filter no-op).
- **Existing**: ✅ checkpoint.test.ts invalid name; rewind.test.ts checkpoint-not-found.
- **🆕 edge-cases.test.ts**: E10-named test (3 sub-cases): (a) checkpoint tool with name "Bad Name!"
  → refusal naming the regex; (b) rewind with granularity:checkpoint + checkpoint:"ghost" (no label) →
  refusal "checkpoint 'ghost' not found"; (c) checkpoint granularity with empty name → refusal
  "checkpoint granularity requires a checkpoint name".

### E13 — Tool throws internally (fail-open)
- **Code**: EVERY handler/tool body wrapped in ONE try/catch. filter.ts contextHandler catch → return
  (pass-through). nudges.ts bloat/turn handlers catch → return. All 4 tools catch → refusal text.
- **Existing**: partial (filter.test.ts has a fail-open test; tool tests have throwOnX options).
- **🆕 edge-cases.test.ts**: E13-named CROSS-CUTTING suite (the headline invariant): for EACH handler
  (contextHandler, bloatReminderHandler via registerBloatReminder, turnEndMetricHandler) and EACH tool
  (rewind/shrink/checkpoint/audit), force an internal throw (fake ctx that throws, or a filterPipeline
  mock that throws) → the call NEVER throws (returns void/refusal text) AND the turn is not broken.
  This is the single most important consolidated test in the file.

### E14 — Extension disabled via config
- **Code**: contextHandler `if (!config.enabled) return` (pass-through); nudges `if (!config.enabled
  || !sub) return`. Tools gate on SUB-config (config.rewind.enabled / config.shrink.enabled).
- **⚠ FINDING/GAP**: E14 text says "tools refuse with 'Mulligan is disabled.'" But rewind/shrink check
  ONLY their sub-config, NOT the master config.enabled. If a human sets config.enabled=false but leaves
  rewind.enabled=true (default), the tool does NOT refuse. DECISION needed:
  - Option A (recommended, honors E14 literally): add `if (!config.enabled) return refusal("Mulligan
    is disabled", ...)` as the FIRST gate in rewind + shrink execute (before the sub-feature check).
  - Option B (document): config.enabled gates passive observers only; sub-flags gate tools. Then E14's
    "tools refuse" refers to the sub-feature case.
  The PRP recommends Option A (small, spec-faithful). The test should assert the chosen behavior.
- **Existing**: partial (contextHandler disabled test; tool sub-config disabled tests).
- **🆕 edge-cases.test.ts**: E14-named test: (a) config.enabled=false → contextHandler returns void
  (messages NOT in result / pass-through) + nudges no-op; (b) config.rewind.enabled=false → rewind
  refuses "rewind is disabled"; (c) [if Option A] config.enabled=false + rewind.enabled=true → rewind
  refuses "Mulligan is disabled".

### E16 — mulligan_audit before any inference
- **Code**: audit.ts E16 fallback — `rt.lastFiltered` null → `buildContextEntries()` → messages →
  `filterPipeline` → source="fallback", confidence="low".
- **Existing**: ✅ audit.test.ts fallback cases.
- **🆕 edge-cases.test.ts**: E16-named test: makeCtx + getRuntime with lastFiltered=null → audit.execute
  → details.source==="fallback" AND details.confidence==="low" AND no throw. (Audit tool is a plain const
  `auditTool`, execute via auditTool.execute(toolCallId, {top:8}, sig, onUpdate, ctx).)

### E17 — Two shrinks target the same message
- **Code**: applyShrink applied in seq order, last wins (resolveShrinkTarget re-resolves against the
  already-shrunk message — by_tool_call_id stable since role/toolCallId preserved by the spread).
- **Existing**: ✅ transforms.test.ts applyShrink "two shrinks same target → last wins".
- **🆕 edge-cases.test.ts**: E17-named test: filterPipeline with TWO shrink markers (seq 1, seq 2) same
  by_tool_call_id target → output message content === seq-2's replacement (last wins). Also reverse seq
  → still last-seq wins (NOT last-pushed).

### E19 — Shrink target is a non-toolResult message
- **Code**: applyShrink preserves `role` via the `{...orig, content}` spread (by_content_includes matches
  ANY role). Pairing unaffected (not a toolResult).
- **Existing**: ✅ transforms.test.ts by_content_includes on user/assistant.
- **🆕 edge-cases.test.ts**: E19-named test: shrink marker by_content_includes matching a USER message →
  applyShrink replaces content BUT output message.role==="user" (preserved). Same for an assistant text
  message → role==="assistant". Assert role preserved + pairing unaffected.

---

## TIER 2 — SMOKE HARNESS (test/integration/smoke.ts additions — Pi-dependent)

These CANNOT be deterministically unit-tested (they need real Pi session reload / getContextUsage / disk
entry ordering). Add a `/mulligan_smoke E7|E11|E12|E15|E20` dispatch in smoke.ts + assertions in run-smoke.mjs.
The smoke harness is produced by the PARALLEL P1.M7.T2.S1; THIS task ADDS edge-case scenarios to it.

### E7 — Compaction summarizes hidden content (KNOWN LIMITATION)
- **Code**: NONE (v1 accepts as bounded/transient). Documented in spec/08 + README (P1.M7.T4).
- **Smoke**: a scenario that creates a rewind, then forces/observes compaction → assert the behavior is
  bounded (no crash). Primarily a DOCUMENTATION scenario: log "E7: known limitation — compaction may
  transiently reference hidden content." Assert: no crash; the note survives.

### E11 — Session reload / /resume mid-task
- **Code**: index.ts session_start → `resetRuntime(sessionId)` (in-memory cache cleared); markers are
  persisted entries → survive; filter re-applies on first inference; tokenBaseline→null → drift nudge
  falls back to bloat-only.
- **Existing F-reload**: the P1.M7.T2.S1 F-reload scenario covers marker survival. E11 adds the
  tokenBaseline-null assertion.
- **Smoke**: extend F-reload OR add E11 scenario: two `pi` runs sharing --session-id; run-2 first
  context.fire → drift nudge (if any) uses bloat-only path (deltaTokens null in the first turn-metric).
  Assert: markers present run-2; no crash; (soft) first run-2 turn-metric has deltaTokens null.

### E12 — getContextUsage() undefined
- **Code**: turn_end handler (nudges.ts) tolerates undefined getContextUsage (falls back to estimate/null);
  audit never calls getContextUsage (uses estimateTokens over filtered — D5).
- **Smoke**: E12 scenario: run audit + one turn_end BEFORE any assistant message (getContextUsage may be
  undefined). Assert: no crash; turn-metric persisted with deltaTokens null (or estimate); audit succeeds.

### E15 — Very large number of accumulated markers/notes
- **Code**: NONE (v1 does no marker GC; filter is O(markers×messages) but cheap in practice). Document only.
- **Smoke**: E15 scenario: seed N=50 rewind markers (loop appendRewindMarker via the smoke driver, capped
  by... NOTE: maxDepth=5 REFUSES the 6th rewind from the TOOL, so seed via the raw appendRewindMarker
  wrapper directly to bypass the tool). Assert: filter still terminates fast (time-bounded); no crash;
  (soft) message count never increases. Document: markers persist intentionally (audit trail).

### E20 — appendEntry/sendMessage ordering race
- **Code**: markers.ts — both synchronous appends on the same session; marker first, note second; filter
  reads markers independently of note position; ordering doesn't affect correctness.
- **Smoke**: E20 scenario: call mulligan_rewind → assert the session JSONL has the mulligan:rewind (custom)
  entry BEFORE the mulligan:note (custom_message) entry, AND the note appears after the rewind tool result
  in context. Assert entry ordering in the JSONL.

---

## E18 — The model ignores the nudges (NO test needed)
- **Code**: NONE (nudges are advisory, D3; cost is ~25-40 tokens when it fires, bounded).
- **Test**: 🆕 edge-cases.test.ts includes an E18 DOCUMENTATION test (it.todo or a comment-anchored test)
  asserting nudges are advisory: the drift nudge (renderDriftNudge) produces a SUGGESTION (mentions
  mulligan_rewind/mulligan_shrink as options), never an imperative/force. No behavioral assertion beyond
  "the text is advisory." This documents E18 in the suite for completeness.

---

## SUMMARY TABLE

| E#  | Tier   | Handled in (file.fn)                         | Existing | Action in THIS task |
|-----|--------|----------------------------------------------|----------|---------------------|
| E1  | unit   | transforms.partitionIntoUnits                | ✅       | 🆕 consolidated test |
| E2  | unit   | transforms.resolveLastToolCallGroup          | ✅       | 🆕 consolidated test |
| E3  | unit   | transforms.resolveLastTurn + protectedOk     | ✅       | 🆕 consolidated test (document 2-layer) |
| E4  | unit   | rewind.countRewindMarkers + guard            | ✅       | 🆕 consolidated test |
| E5  | unit   | rewind.resolvePreview + notes.renderNote     | partial  | 🆕 consolidated test |
| E6  | unit   | transforms.resolve* (keep whole unit)        | ✅       | 🆕 consolidated test |
| E7  | smoke  | (none — known limitation)                    | —        | 🔜 smoke scenario + doc |
| E8  | unit   | transforms.applyRewind/applyShrink           | ✅       | 🆕 consolidated test (ref equality) |
| E9  | unit   | notes.validateNote + rewind refusal          | ✅       | 🆕 consolidated test |
| E10 | unit   | checkpoint.validCheckpointName + rewind      | ✅       | 🆕 consolidated test (3 sub) |
| E11 | smoke  | index.session_start resetRuntime             | partial  | 🔜 smoke scenario (tokenBaseline null) |
| E12 | smoke  | nudges/audit tolerate undefined ctx usage    | —        | 🔜 smoke scenario (pre-inference) |
| E13 | unit   | ALL handlers/tools try/catch                 | partial  | 🆕 CROSS-CUTTING fail-open suite |
| E14 | unit   | filter/nudges config.enabled + tool sub-flag | partial  | ⚠ GAP: add master-check to tools + 🆕 test |
| E15 | smoke  | (none — no GC, document)                     | —        | 🔜 smoke scenario (N markers) |
| E16 | unit   | audit E16 fallback (buildContextEntries)     | ✅       | 🆕 consolidated test |
| E17 | unit   | transforms.applyShrink (last wins)           | ✅       | 🆕 consolidated test (seq order) |
| E18 | doc    | (none — advisory nudges)                     | —        | 🆕 documentation test (advisory text) |
| E19 | unit   | transforms.applyShrink (preserve role)       | ✅       | 🆕 consolidated test |
| E20 | smoke  | markers synchronous append order             | —        | 🔜 smoke scenario (JSONL ordering) |

**Net**: 14 edge cases get consolidated UNIT tests in test/edge-cases.test.ts (E1-E6, E8-E10, E13, E14,
E16-E19 incl. E18 doc). 5 edge cases get SMOKE scenarios (E7, E11, E12, E15, E20). 1 potential code FIX
(E14 master-switch gating on tools). NO src/ rewrite — at most a 1-line addition per tool if Option A.