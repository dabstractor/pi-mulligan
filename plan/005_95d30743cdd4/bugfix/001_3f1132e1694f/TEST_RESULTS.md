# Bug Fix Requirements

## Overview
Creative end-to-end PRD validation of pi-mulligan against its full specification. Approach: (1) read the spec master + companion docs (01–12) to map every MUST/REQUIRED clause; (2) read all 17 source modules (transforms, filter, markers, tools/*, nudges, config, tokens, ledger, notes, runtime); (3) cross-check the implementation's assumptions against the REAL Pi session-manager.js source (getBranch ordering, setLabel/labelsById semantics, sessionEntryToContextMessages yields); (4) write and run targeted probe tests (12 cases, all passing) to confirm each hypothesis end-to-end through the actual tools, then removed the probe file and re-ran the shipped suite (949/949 still green, no regression). The implementation is high quality — pairing-aware transforms, pinned-hide/shrink identity resolution (BUG-001/002/003 from the spec's own history already fixed), fail-open discipline everywhere, and robust config validation. Six genuine issues surfaced, all in edge cases the existing 949 tests don't cover: one MAJOR spec-MUST violation (checkpoint consumption clears the wrong target when a name is set on multiple targets — real Pi allows two targets to share a label string, which the existing single-target tests never exercise), and five MINOR issues (a driftWindowTurns fractional→0 validation gap; shrink.maxActive/staleAfterFires accepting fractions; the filter resolver matching the first message on an empty by_content_includes needle; audit reporting a transformed view while the extension is disabled; and nuclear last_turn on the first user message persisting a no-op marker instead of refusing). No crashes, no pairing/serialization breakages, no data-loss vectors — the core rewind/shrink/cancel/nudge mechanisms are correct. The drift-nudge subsystem was observed firing correctly in this very session, confirming the end-to-end pipeline works.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

None.


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

### Issue 1: Checkpoint not consumed when the same name is set on multiple targets (spec/05 §3 step 5 MUST violation)
**Severity**: Major
**ID**: BUG-001
**Location**: src/tools/rewind.ts (step 7b checkpoint-consumption loop, ~the `if (granularity === "checkpoint")` block that scans entries and breaks after the first pi.setLabel(targetId, undefined))

**Description**:
When a checkpoint name (e.g. "x") is set, then some message is appended (advancing the branch leaf past the first anchor), and the same name is set again, Pi persists TWO distinct label entries on two different targetIds. Pi's `appendLabelChange` (session-manager.js) stores labels in a `Map<targetId,label>` with NO cross-target uniqueness, so BOTH targets carry the label string concurrently. The rewind tool's checkpoint-consumption loop (spec/05 §3 step 5 "Auto-expiry on consumption (REQUIRED)") scans `getEntries()` in append order, calls `pi.setLabel(targetId, undefined)` on the FIRST matching label entry it finds, then `break`s. That clears only the OLDEST target; the newer target retains the label, so `checkpointExists(name)` (which returns true if ANY candidate target's `getLabel` matches) still returns true. Net effect: after a rewind to "x", the checkpoint is NOT retired — a second `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` succeeds instead of refusing with "not found". This directly violates spec/05 §3 step 5 ("Once a mulligan_rewind successfully targets it, the checkpoint is consumed and MUST be retired") and the F-checkpoint acceptance criterion in spec/10 §2.1 ("a second rewind to 'x' refuses (not found) unless re-created"). The existing unit tests (test/tools/rewind.test.ts cases g/h) only ever label a single targetId ("leaf-1"), so they never exercise the duplicate-target case and mask the bug. Verified end-to-end against a faithful Pi labelsById fake (Map<targetId,label>, no cross-target uniqueness) and against the real Pi session-manager.js source.

**Steps to Reproduce**:
1. mulligan_checkpoint({name:"x"}) — labels targetA (the current last real message). 2. Append any message (assistant/user/tool) so the leaf advances past targetA. 3. mulligan_checkpoint({name:"x"}) again — labels targetB (a different entry). Now Pi's labelsById = { targetA: "mulligan:checkpoint:x", targetB: "mulligan:checkpoint:x" }. 4. mulligan_rewind({note, granularity:"checkpoint", checkpoint:"x"}) — resolveCheckpoint targets targetB (most recent), but the consumption loop (src/tools/rewind.ts step 7b) iterates getEntries() in append order, finds targetA's label entry FIRST, calls pi.setLabel(targetA, undefined), and breaks. 5. mulligan_rewind({note, granularity:"checkpoint", checkpoint:"x"}) again — checkpointExists("x") still returns true (targetB still labeled) → the rewind SUCCEEDS instead of refusing. Probe test confirmed: after the first rewind, labelsById.get("msg-b") === "mulligan:checkpoint:x" (still active).


## Minor Issues (Nice to Fix)
Small improvements or polish items.

### Issue 1: nudges.driftWindowTurns accepts fractional values that floor to 0, producing a degenerate empty drift window
**Severity**: Minor
**ID**: BUG-002
**Location**: src/config.ts (validateConfig, the `nudges.driftWindowTurns` branch: `cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;` — missing a `Math.floor(n) >= 1` guard)

**Description**:
In validateConfig, `nudges.driftWindowTurns` is coerced via `coerceNumber(..., true)` (which only requires `> 0`) and then `Math.floor`-ed, but the result is NOT re-guarded with `>= 1`. A user-supplied value like `0.5` passes the `> 0` check, then `Math.floor(0.5) === 0`, so `cfg.nudges.driftWindowTurns` becomes 0. With a zero-length window, `shouldNudge` (src/nudges.ts) slices `recentMetrics.slice(0, 0)` → empty `deltas` → it falls back to the bloat-only path permanently, defeating the spec/07 §5.1 windowed-drift design entirely. The sibling knob `rewind.maxRetriesPerPrompt` DOES guard with `Math.floor(n) >= 1` (and falls back to default otherwise) — driftWindowTurns is missing that same guard, so the two integer knobs are validated inconsistently.

**Steps to Reproduce**:
const cfg = validateConfig({ nudges: { driftWindowTurns: 0.5 } }); expect(cfg.nudges.driftWindowTurns).toBe(0); // confirmed: degenerate window. Then shouldNudge(anyMetrics, cfg) always takes the bloat-only fallback because the window slice is empty.

### Issue 2: shrink.maxActive and shrink.staleAfterFires accept fractional values without flooring to integers
**Severity**: Minor
**ID**: BUG-003
**Location**: src/config.ts (validateConfig, shrink.maxActive and shrink.staleAfterFires branches — no Math.floor / integer guard)

**Description**:
`shrink.maxActive` and `shrink.staleAfterFires` are validated with `coerceNumber(..., true)` (requires `> 0`) but are NOT floored to integers (unlike `driftWindowTurns` and `maxRetriesPerPrompt`). A value like `0.5` is accepted verbatim. Consequences in filter.ts: (a) the soft-cap check `markers.shrinks.length > config.shrink.maxActive` becomes `1 > 0.5` → true with just ONE active shrink, so the oldest shrink is auto-retired immediately; (b) the stale-retirement check `misses >= config.shrink.staleAfterFires` becomes `1 >= 0.5` → a pinned shrink is retired after a SINGLE miss instead of the default 3. spec/09 §4 specifies these are integer knobs ("Positive integer"/"integer ≥ 1" semantics for counts); accepting fractions is a validation gap that lets a misconfigured value silently neuter the shrink subsystem.

**Steps to Reproduce**:
const cfg = validateConfig({ shrink: { maxActive: 0.5 } }); expect(cfg.shrink.maxActive).toBe(0.5); // confirmed fractional. const cfg2 = validateConfig({ shrink: { staleAfterFires: 0.5 } }); expect(cfg2.shrink.staleAfterFires).toBe(0.5);

### Issue 3: resolveShrinkTarget with empty by_content_includes matches the FIRST message (degenerate; only guarded at the tool layer)
**Severity**: Minor
**ID**: BUG-004
**Location**: src/transforms.ts (resolveShrinkTarget, the `by_content_includes` branch — no `needle.length > 0` guard before the substring scan)

**Description**:
In src/transforms.ts, `resolveShrinkTarget` for the `by_content_includes` arm has no empty-string guard — every string includes "", so an empty needle matches the FIRST message in the list (index 0) regardless of role. The shrink TOOL refuses empty discriminators via `targetIsStructurallyValid` (src/tools/shrink.ts), but the FILTER-level resolver does not. Any path that constructs a shrink marker without going through the tool's validation — an old/persisted marker from a prior version, a hand-crafted CustomEntry, or a marker whose `by_content_includes` was later emptied — would silently substitute the first message's content with the replacement on every context fire. Defense-in-depth dictates the resolver itself reject a degenerate needle rather than relying solely on the tool layer.

**Steps to Reproduce**:
const messages = [{role:"user",content:"hello"},{role:"assistant",content:[{type:"text",text:"world"}]}]; const i = resolveShrinkTarget(messages, { by_content_includes:"" }); expect(i).toBe(0); // confirmed: degenerate match on first message. (The shrink tool refuses this, but the filter resolver does not.)

### Issue 4: mulligan_audit runs and reports a marker-transformed view even when config.enabled === false (inconsistent with E14 "no-op")
**Severity**: Minor
**ID**: BUG-005
**Location**: src/tools/audit.ts (auditExecute — no `if (!getConfig().enabled) return refusal(...)` gate at the top, unlike rewind/shrink/cancel)

**Description**:
spec/08 E14 requires that when `config.enabled === false` "the extension is a no-op" and the context handler returns immediately (pass-through, no transform, and crucially no caching of `rt.lastFiltered`). However `mulligan_audit` (src/tools/audit.ts) has NO `config.enabled` gate — it is deliberately always-on diagnostics. When mulligan is disabled, the model's actual context is the UNFILTERED view, but audit's fallback path (rt.lastFiltered is null because the filter never cached it) runs `filterPipeline` over `buildContextEntries()`, APPLIES all persisted rewind/shrink markers, and reports the transformed token total + active marker counts. The agent is therefore told (e.g.) "2 active rewinds hiding 5k tokens; total 12k" while the model is actually seeing the full 50k unfiltered context — actively misleading the agent about what the model sees, the exact thing D5 (honest bookkeeping) exists to prevent. The rewind/shrink/cancel tools correctly refuse when disabled; audit is the lone inconsistency.

**Steps to Reproduce**:
Set config.enabled=false. Call mulligan_audit while persisted mulligan:rewind/shrink markers exist on the branch. The context filter is pass-through (model sees unfiltered view), but audit's execute (src/tools/audit.ts) never checks config.enabled and its E16-fallback path invokes filterPipeline, so it reports markers as active and a filtered total that does NOT match what the model sees. Structural confirmation: the auditExecute function body contains no `config.enabled` check.

### Issue 5: to_previous_prompt (nuclear) rewind on the first/only user message persists a no-op marker instead of refusing per spec E3
**Severity**: Minor
**ID**: BUG-006
**Location**: src/tools/rewind.ts (rewindExecute — resolvePreview returns remove:[] for the protected nuclear case, but step 7 persists anyway; no explicit protected-refusal check between resolvePreview and persist)

**Description**:
spec/08 E3 states a rewind that would cross a protected message "the tool refuses before persisting (returns a refusal text)." For `granularity:"last_turn"` with `to_previous_prompt:true` when the latest user message IS the first user message, `resolveLastTurn` (src/transforms.ts) correctly returns `{remove:[]}` (the nuclear-first-user protected refusal). However the rewind TOOL (src/tools/rewind.ts) does not independently detect this case: it treats an empty `remove` from `resolvePreview` as a legitimate K=0 rewind, persists the marker (with empty `hideEntryIds`), leaves the note, and returns success text "0 messages will be hidden ... (nothing matched to hide)". This (a) violates E3's "refuses before persisting", (b) consumes a depth slot toward `rewind.maxDepth` with a permanently-useless marker, and (c) leaves a stray mulligan:note in context. The protected boundary is still honored in effect (the filter no-ops the empty hide), but the tool-level contract (refuse + do not persist) is not met.

**Steps to Reproduce**:
Branch with a SINGLE user message. Call mulligan_rewind({note, granularity:"last_turn", to_previous_prompt:true}). resolveLastTurn returns {remove:[]} (protected). The tool persists a mulligan:rewind marker (kind:"rewind", hideEntryIds:[]) + a mulligan:note, and returns "Mulligan: rewound last_turn. 0 messages will be hidden ... (nothing matched to hide). Note left." instead of a "Mulligan: refused — ..." text. Probe confirmed end-to-end: appended.length >= 1 rewind marker and text lacks "refused".

## Testing Summary
- Total bugs found: 6
- Critical: 0
- Major: 1
- Minor: 5

## Recommendations
- Fix BUG-001 by clearing the SPECIFIC target that resolveCheckpoint determined was the match (or clear ALL label entries whose current getLabel maps to the name), not just the first raw entry found in append order. Add a regression test that sets the same checkpoint name on two distinct targets.
- BUG-002/BUG-003: apply the same `Math.floor(n) >= 1 ? Math.floor(n) : default` guard already used for maxRetriesPerPrompt to driftWindowTurns, maxActive, and staleAfterFires for consistent integer validation.
- BUG-004: add `needle.length > 0` guard inside resolveShrinkTarget's by_content_includes arm (return null for empty) as defense-in-depth, mirroring the existing length>0 checks on the other two arms.
- BUG-005: either add a `config.enabled` gate to auditExecute that reports the unfiltered view / refuses, or document that audit is intentionally always-on; the current behavior actively misleads about the filtered total when disabled.
- BUG-006: add an explicit protected-refusal check in rewindExecute (detect to_previous_prompt crossing first:user via resolveLastTurn's empty-remove signal, or a dedicated guard) that refuses BEFORE persisting, matching E3's contract.
