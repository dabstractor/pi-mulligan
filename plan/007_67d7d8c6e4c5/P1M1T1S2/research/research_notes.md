# Research Notes — P1.M1.T1.S2: rewind.ts schema + behavior (remove to_previous_prompt + BUG-006 dead code)

## Dependency on S1 (assumed implemented)
S1 (P1.M1.T1.S1) modifies src/transforms.ts ONLY. resolveLastTurn signature becomes
`(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }` — `opts` param GONE; no nuclear mode.
Default behavior (keep iLastUser, remove everything after except own unit + mulligan:* messages) is the ONLY behavior.
After S1, rewind.ts:444 has TS2554 (3 args, 2 expected) + TS2345 (object where string expected) — EXPECTED, owned by S2.

## S2 scope: src/tools/rewind.ts ONLY (5 surgical edits). 1 point. No test changes (S4), no markers.ts (S3).

## Verified touchpoints (grep-confirmed — ALL `to_previous_prompt` + `nuclear` refs in rewind.ts)
1. **Line 76 (RewindParams JSDoc):** "...=== `{ note: NoteInput, granularity, to_previous_prompt?, checkpoint? }`"
   → drop `, to_previous_prompt` → "...=== `{ note: NoteInput, granularity, checkpoint? }`".
2. **Lines 109-114 (schema field):** the `to_previous_prompt: Type.Optional(Type.Boolean({...}))` block → REMOVE entirely.
3. **Line 444 (resolveLastTurn call):** `resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove`
   → `resolveLastTurn(messages, toolCallId).remove` (consumes S1's 2-arg signature).
4. **Lines 593-610 (the (5b) BUG-006 block):** the ENTIRE block — the multi-line `// (5b) protected-refusal check` comment
   + the `if (granularity === "last_turn" && params.to_previous_prompt === true && k === 0) { return refuse(...) }` → REMOVE.
   It is now dead code: with to_previous_prompt gone, `params.to_previous_prompt === true` is ALWAYS false. resolveLastTurn
   (S1) no longer has nuclear mode, so a last_turn K=0 is a legitimate "nothing after iLastUser to hide" success, NOT a refusal.
5. **Line 620 (payload.options):** `options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles }`
   → `options: { protect: config.rewind.protectedRoles }`.

## NOT changed
- **REWIND_DESC (lines ~132-134):** verified NO mention of to_previous_prompt / "previous prompt". The item explicitly says no edit.
  Current text: "...Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole
  turn from the user's last message." — already guardrail-compliant. Leave byte-for-byte.
- **markers.ts line 60 `to_previous_prompt?: boolean`:** stays OPTIONAL (legacy, S3's job). The S2 payload `{ protect }` is
  assignable (to_previous_prompt optional). Confirmed RewindMarkerInput.options = `{ to_previous_prompt?: boolean; protect?: string[] }`.
- **The checkpoint-granularity path:** RETAINED (checkpointExists at ~525 + resolveCheckpoint dispatch at ~447). The agent still
  rewinds TO user-set checkpoints. Only the to_previous_prompt nuclear option is removed.
- **Steps 1-4, 5, 6, 7b, 8 (the rest of rewindExecute):** unchanged. The refuse() closure, granularity guards, depth/retry/
  context-fraction guards, resolvePreview, renderNote, appendRewindMarker, checkpoint-consumption, mutation warning — all untouched.

## Why removing the BUG-006 block is SAFE (not a behavior regression)
BUG-006 guarded the SPECIFIC case `to_previous_prompt===true && k===0` (nuclear last_turn across first/only user → refuse).
After removing to_previous_prompt, that 3-way AND is structurally impossible. resolveLastTurn (S1) always keeps iLastUser
(loop starts at iLastUser+1), so a last_turn K=0 means "no agent work after the latest user message" — a legitimate success
(K=0 honesty, step 8). The guardrail (never wipe user input) now holds BY CONSTRUCTION (S1), not by this runtime refusal.
The v1.1 consented way to rewind across user messages is `granularity:"checkpoint"` (user-set), which this task RETAINS.

## tsc gate
After S1 (pre-S2): rewind.ts:444 has TS2554 + TS2345 (2 errors). After S2: ZERO errors originating in rewind.ts.
Expected REMAINING errors (owned by other subtasks): test files (39 to_previous_prompt occurrences across 6 files → S4).
markers.ts (S3 keeps to_previous_prompt optional → no error there). S2's bar: grep clean in rewind.ts + no tsc error citing rewind.ts.

## Validation gates for S2
- `grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts` → ZERO matches.
- `npx tsc --noEmit` → NO error citing src/tools/rewind.ts (the S1-left TS2554/TS2345 at :444 resolved). Remaining errors are
  in test/* (S4) — do NOT chase them.
- `npx vitest run test/tools/rewind.test.ts` → WILL FAIL (11 to_previous_prompt occurrences in fixtures/assertions → S4).
  S2 does NOT edit tests. (May run to confirm failures are exactly the to_previous_prompt ones — sanity check, not a gate.)
- Full `npx vitest run` → RED until S4 (test fixtures reference the removed field). S2's gate is tsc + grep, NOT a green suite.