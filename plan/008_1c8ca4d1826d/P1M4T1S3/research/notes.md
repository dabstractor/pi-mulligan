# P1.M4.T1.S3 research — integration smoke v2.0 retarget

## Ground truth (verified in working tree)

### 1. Command prompts are NOT user messages (the linchpin)

pi docs `extensions.md` (~:287): "extension commands checked first, bypass if found" — a `-p "/mulligan_smoke X"`
prompt dispatches the command handler and BYPASSES the agent loop; it is not persisted as a user message.
Evidence in the existing harness: F-rewind-core's seed flow (run-smoke.mjs:539-547) issues a `last_turn`
rewind at COMMAND time and asserts K≥1 — only true if `iLastUser` is still the seed prompt's user message,
not the command prompt. Consequence: at command dispatch, `currentTurnSpan` = everything after the LAST REAL
user prompt → the model turn produced by prompt 1 (`-p "Call mulligan_smoke_big …"`) is IN the current turn
span. This is what makes a deterministic in-span shrink possible:

- `src/transforms.ts:379` `currentTurnSpan(messages)` = `{start: iLastUser+1, end}`.
- `src/tools/shrink.ts` `resolveTargetEntryId` → snapshot via `ctx.sessionManager.buildContextEntries()`;
  out-of-span/earlier-turn/no-match → hard refusal
  `"that result is from a previous turn; only this turn's tool calls can be shrunk"`
  (earlier-turn and no-match share ONE string — shrink.ts ~:364). Advisory throw (E13) → persists matched:false.

### 2. Filter-side scope (why persistence still works across the observing prompt)

`plan/.../architecture/scope_guard_design.md` §1–2: the bound is the MARKER'S ISSUING turn (last user
message BEFORE the marker entry), stable forever. Marker issued during the command (after u1) → its span =
after u1 → includes the turn-1 toolResult → substitution keeps applying on the observing `-p "Reply OK"`
turn (u2). This smoke is the end-to-end mirror of the P1.M1.T3.S2 unit regression (pinned in-turn shrink
issued turn N keeps applying after user message N+1).

### 3. Can a toolResult be synthesized deterministically? NO.

smoke.ts:163-164 comment (verified): "we cannot synthesize a toolResult — ReadonlySessionManager has no
mutator". `pi.appendEntry` writes custom entries only. So the ONLY way a toolResult enters the session is a
real model tool call → the setup turn must be model-driven (same reliability tier as the existing SEED turns
in F-rewind-core / F-checkpoint, which already assert K≥1 off a model reply).

### 4. Occurrence inventory (grep by_content_includes test/integration/ → 4+1)

- smoke.ts:187,196 — F-shrink-persist deterministic shrink vs session-start MSG_CANARY custom_message
  (`{target:{by_content_includes: MSG_CANARY} as unknown as …}` cast — v2.0 would make this REFUSE since
  the session-start canary precedes u1 → out of span; must be replaced, not cast-fixed).
- smoke.ts:206,213 — E19 user-message shrink (USER_CANARY = orchestrator's first -p; USER_SHRUNK_MARKER).
- scenarios.md:134 — model-driven prompt text "…(by_content_includes CANARY)…".
- Related-only (no literal): run-smoke.mjs:263-277 E19 assertions; smoke.ts:489-490 userCanaryPresent/
  userShrunkInContext log fields; run-smoke.mjs:529-537 the 3-prompt USER_CANARY flow.

### 5. Shrink tool surface used by the driver

`makeShrinkTool(pi).execute(toolCallId, params, signal, onUpdate, ctx)` — same call shape as the existing
smoke code. Two-arm target: `{ by_tool_call_id }` or `{ by_tool_name, occurrence? ("last" default) }`.
Success → marker appended via `appendShrinkMarker` (with pinnedEntryId when matched in-span). Refusal →
text contains "Mulligan: refused —", NOTHING appended. Success text includes feedback ("Matched: yes") +
v1.2 orientation line ("Context updated…"); assert success as `!/refused/i` (same idiom as assertRewindCore)
plus JSONL marker presence.

### 6. Canaries (GOTCHA #8 — byte-identical across smoke.ts / run-smoke.mjs)

MSG_CANARY / RESULT_CANARY / SHRUNK_MARKER / SEED_* stay; USER_CANARY + USER_SHRUNK_MARKER are REMOVED from
both files (their only consumer is the E19 case). RESULT_CANARY is produced by `mulligan_smoke_big`
(bigResult(): RESULT_CANARY + " x"*9000) — tool is mulligan_* → bloat reminder skipped (nudges.ts) → no
cross-talk with F-shrink-preventive.

### 7. Harness mechanics that must be preserved

- run-smoke.mjs `runScenario` special-cases F-shrink-persist's prompt list (currently :529-537); ASSERTERS
  map "F-shrink-persist" → assertShrinkPersist (:515).
- context.fire log fields (smoke.ts:483-491) feed the asserters via parseSmokeLog; resultCanaryPresent
  ALREADY EXISTS and currently is unasserted for this scenario — it becomes the two-signal pair with
  shrunkInContext (true + canary ABSENT on the observing fire).
- assertGlobalInvariants runs §2.3 checks on every scenario with entries.
- `npm run smoke` = `node test/integration/run-smoke.mjs` (package.json:56) — needs the real `pi` binary
  on PATH and a working model (already required by the seed scenarios).