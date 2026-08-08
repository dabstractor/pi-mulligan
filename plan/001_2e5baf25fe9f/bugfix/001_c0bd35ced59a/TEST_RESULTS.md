# Bug Fix Requirements

## Overview
End-to-end PRD validation against Pi 0.84.1 found that the extension's CORE capability — permanent soft-delete rewind — does not actually persist its hiding in real agent loops. All 671 unit tests pass and the 14 smoke scenarios pass, but the test suite never simulates the documented usage pattern 'rewind, then resume work', which is exactly where the system breaks. Three critical, mutually-related bugs were confirmed both by pure-function probes and by real `pi -p` runs with an observing extension: (1) last_tool_call_group rewinds are not permanent — hidden content leaks back into the model's view as soon as the agent makes any further tool call, and the agent's new work is hidden instead (violates PRD §1 'permanent soft-delete' and §2.5 #1 'no subsequent inference sees it'); (2) last_turn rewinds trap the agent in an infinite loop because the agent's own re-attempted work is hidden on every inference (the agent fired context 29+ times stuck at n=4, unable to progress); (3) checkpoint rewinds hide nothing in real sessions — resolveCheckpoint always returns an empty removal set because the checkpoint labels a transient getLeafId() entry that maps to the last message index. The shared root cause is that rewind markers store RELATIVE specs ('last tool group' / 'last turn') that filterPipeline re-resolves against the constantly-growing message list every inference; relative targeting is stable only across a STATIC session, but the session changes the moment the agent resumes work after a rewind — the normal, intended usage. The shrink feature, bloat-reminder nudge (bloatHit:true verified), turn-metric, fail-open behavior, protected first:user check, and the zero-extra-request / never-persisted-nudge invariants all behave correctly. The bugs are confined to the rewind hiding semantics.


## Critical Issues (Must Fix)
Issues that prevent core functionality from working.

### Issue 1: last_tool_call_group rewind is not permanent: hidden content leaks back once the agent does any further tool work (and the new work is hidden instead)
**Severity**: Critical
**ID**: BUG-001
**Location**: src/transforms.ts:223 (resolveLastToolCallGroup returns most-recent non-excluded toolGroup) and src/transforms.ts:969 (filterPipeline re-resolves the relative spec against the current message list every fire)

**Description**:
The headline 'mulligan' operation does not achieve its core PRD goal. The PRD (§1) defines a rewind as 'a permanent soft-delete: a persisted instruction that hides a span of messages from every future copy sent to the model', and success criterion §2.5 #1 requires that shed content is seen by 'no subsequent inference'. The implementation violates both. Root cause: RewindMarker stores a RELATIVE spec ('last_tool_call_group'), and filterPipeline (src/transforms.ts:969) RE-RESOLVES that spec against the CURRENT (constantly growing) message list on EVERY context fire. resolveLastToolCallGroup (src/transforms.ts:223) returns 'the most recent non-excluded toolGroup', which is a moving target: as soon as the agent resumes work and makes any new tool call (the exact scenario a rewind is meant to enable — undo, then do better), the newest tool call becomes 'the most recent toolGroup', so the rewind re-targets the NEW (legitimate) work and UN-HIDES the originally-hidden mistake. The result is the worst of both worlds: the bloated/mistaken content the agent tried to shed reappears in context, and the agent's new work disappears. The design note (transforms.ts idempotency comment) acknowledges that filterPipeline is not stable under re-resolution, but frames it only as an abstract idempotency concern — it does not recognize that it causes permanent hiding to fail in normal single-rewind usage. spec/06 §11's idempotency claim ('across fires the session is unchanged between user prompts') is the flawed assumption: the session DOES change within a turn after the agent calls a tool. The F-rewind-core smoke scenario passes only because it asserts the marker persists + context.fire shows hasRewindMarker, never that the hiding is permanent across subsequent tool work.

**Steps to Reproduce**:
Real Pi 0.84.1 run (extension /tmp/probe/leakdetail.ts logging every context.fire): `pi -e ./src/index.ts -e <observer> -p 'Use the read tool to read /etc/hostname. Then call mulligan_rewind granularity last_tool_call_group with a valid note saying the read was wasteful. Then use the read tool to read /etc/os-release. Then reply OK.'`. Observed context fires: right after the rewind (rewindMarkers=1) the view is [user, assistant(rewind), toolResult, note] — the /etc/hostname read IS hidden (4 msgs). But on the VERY NEXT fire (after the agent reads /etc/os-release) the view becomes [user, assistant(read /etc/hostname), toolResult('ghost'), assistant(rewind), toolResult, note, assistant(read /etc/os-release), toolResult('Arch Linux')] — the /etc/hostname read LEAKED BACK into the view and the /etc/os-release read is the one now hidden. The originally-hidden 'ghost' result is visible to every subsequent inference. Pure-function confirmation (filterPipeline on [u, a(READ),r(READ), a(RW1),r(RW1), note, u2, a(GREP),r(GREP)] with one last_tool_call_group marker excludeToolCallId=RW1): READ remains present, GREP is removed — the rewind hid the wrong (newest) group.

### Issue 2: last_turn rewind traps the agent in an infinite loop: the agent's own 'redo' work is hidden on every inference, so it can never recover within the turn (and content leaks across turns)
**Severity**: Critical
**ID**: BUG-002
**Location**: src/transforms.ts:319 (resolveLastTurn removes all messages after last user msg) combined with src/transforms.ts:969 (filterPipeline re-applies the persistent marker every fire)

**Description**:
The 'last_turn' granularity (spec/05 §1, spec/06 §4) is meant to let the agent 'redo the whole turn from the user's last message'. In practice it makes recovery impossible. resolveLastTurn (src/transforms.ts:319) computes remove = every index after the last user message (except the rewind's own unit + mulligan notes). Because the marker persists and filterPipeline re-applies it on every context fire, ANY new work the agent produces after the rewind — including the very 'redo' the rewind was supposed to enable — lands after the last user message and is immediately hidden from the agent's own next inference. The agent therefore cannot see its own re-attempted work, cannot complete the turn, and loops. This directly defeats PRD §1 ('redo a turn') and §2.5 #1. A secondary manifestation (same root cause): once a new user message arrives in a later turn, the old last_turn marker re-resolves against the new 'last user message', un-hiding the originally-removed turn's content (it is now BEFORE the new last user message) and instead hiding the new turn's legitimate work. spec/06 §4 states the surviving tail should be [user message] + [note] + [rewind assistant+result] so 'the model resumes at the user's prompt' — but resuming is impossible when every resume action is hidden.

**Steps to Reproduce**:
Real Pi 0.84.1 run (observer logging each context.fire): `pi -e ./src/index.ts -e <observer> --session-id ltprobe -p 'Use the read tool to read /etc/hostname. Then call mulligan_rewind with granularity last_turn and a valid note. Then use the read tool to read /etc/os-release. Then reply OK.'`. Observed: after the rewind marker is created, the context handler fires 29+ times in a row, EVERY fire stuck at n=4 with view [user, assistant(mulligan_rewind), toolResult, custom(note)]. The agent's attempt to read /etc/os-release is hidden each fire (it is after the last user message), so the agent never sees its own result and cannot progress — an effectively infinite loop until the process is killed. Pure-function confirmation: filterPipeline on [u, a(BADWORK),r, a(RW),r, note, a(GOODWORK),r] with one last_turn marker excludeToolCallId=RW yields view [user, assistant(RW), toolResult, note] — GOODWORK (the redo) is hidden; on the next-turn shape [u, BADWORK, RW, note, u2, NEWWORK] it yields BADWORK visible (leaked) + NEWWORK hidden.

### Issue 3: checkpoint rewind hides nothing in real sessions — resolveCheckpoint always returns an empty removal set (feature is silently non-functional)
**Severity**: Critical
**ID**: BUG-003
**Location**: src/markers.ts:333 (setCheckpoint labels getLeafId(), a transient in-progress entry) and src/transforms.ts:450 (resolveCheckpoint entry->message walk maps that entry to the last message index -> empty removal set)

**Description**:
The 'checkpoint' granularity (spec/05 §1/§3, spec/06 §6) is a documented, shipped feature: the agent sets a named checkpoint, then later rewinds back to it. In a real Pi 0.84.1 session it never hides a single message. Root cause: setCheckpoint (src/markers.ts:327) labels whatever ctx.sessionManager.getLeafId() returns DURING the checkpoint tool's execute(). At tool-execute time getLeafId() returns a transient in-progress 'message' entry (verified: leafType='message', no role/content) whose position in ctx.sessionManager.getBranch() ends up at/near the leaf. resolveCheckpoint (src/transforms.ts:450) reverses getBranch() to root->leaf, walks it counting 1 message per 'message' entry, and stops at the labeled entry's id. Because the labeled entry sits at the leaf-most position, the walk maps it to the LAST message index (iTarget = messages.length-1), so 'remove = indices > iTarget' is always empty. The rewind tool therefore reports 'Mulligan: rewound checkpoint. 0 messages will be hidden from your view starting next turn (nothing matched to hide). Note left.' and the filtered view is unchanged on every subsequent inference. The PRD §2.3 'Checkpoint' capability and success criterion §2.5 #1 are not met. The F-checkpoint smoke scenario passes only because its assertions check that a label + a rewind marker persist to JSONL — it never asserts that any messages were actually hidden. NOTE: even if this mapping bug were fixed, a checkpoint rewind to an assistant message that contains toolCalls would keep the assistant call but remove its toolResult (iTarget is the assistant; its result is at iTarget+1) — producing an orphaned toolCall that violates the cardinal pairing rule (spec/06 §2, E1) and would be rejected by the model API.

**Steps to Reproduce**:
Real Pi 0.84.1 run (observer /tmp/probe/cpwalk.ts replicating resolveCheckpoint's exact walk, plus /tmp/probe/cpresolve.ts calling the real resolveCheckpoint): `pi -e ./src/index.ts -e <observer> --session-id cpX -p 'Use mulligan_checkpoint to set a checkpoint named start. Then use the read tool to read package.json. Then call mulligan_rewind granularity checkpoint checkpoint start with a valid note. Then reply OK.'`. Observed: the persisted mulligan:rewind marker's toolResult text is 'Mulligan: rewound checkpoint. 0 messages will be hidden ... (nothing matched to hide)'. The observer's call to the REAL resolveCheckpoint against ctx.sessionManager.getBranch() + event.messages returns {"remove":[]} on every fire after the rewind; the filtered view retains all 8-9 original messages (nothing hidden). The walk log shows the labeled target entry consistently resolving to the last ctxEntries position (iTarget = messages.length-1), hence remove=[].


## Major Issues (Should Fix)
Issues that significantly impact user experience or functionality.

None.


## Minor Issues (Nice to Fix)
Small improvements or polish items.

None.

## Testing Summary
- Total bugs found: 3
- Critical: 3
- Major: 0
- Minor: 0

## Recommendations
- Pin rewind targets at marker-creation time (e.g. capture the entry ids / a stable anchor of the span to hide) instead of re-resolving a relative spec ('last tool group' / 'last turn') against the live message list every fire — OR make a rewind marker a one-shot that is consumed after its first effective application, so it does not re-resolve against later-added content.
- Add integration tests that drive the real usage pattern: perform tool work, rewind, then perform MORE tool work, and assert the originally-hidden content is STILL absent from every subsequent context.fire (the current F-rewind-core / F-checkpoint scenarios only assert markers persist, not that hiding is permanent).
- For checkpoint: either resolve the getLeafId()-transient-entry mismatch (label a stable context-producing entry, or map via a stable anchor), and ensure a checkpoint target that is an assistant message with toolCalls does not orphan its toolResult.
- Re-examine spec/06 §11's idempotency assumption ('across fires the session is unchanged between user prompts') — it does not hold within a turn after a tool call, which is the root of BUG-001 and BUG-002.
