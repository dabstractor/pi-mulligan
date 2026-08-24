# Research notes — P1.M2.T3.S1 (F-consent smoke scenario)

## Verified codebase facts

- **Split-phase pattern**: run-smoke.mjs F-checkpoint branch (:643-658) — 5-prompt SET/SEED/REWIND flow. Slash-command prompts (`/mulligan_checkpoint`, `/mulligan_smoke`) dispatch WITHOUT creating user-message entries or firing context; only model-reply prompts produce fires. The seed anchor must commit before the command because `setCheckpoint` (src/markers.ts:456-490) walks `getBranch()` backwards for the last `message` entry with a real role.
- **Landed observables (P1.M2.T1.S1/S2)**: smoke.ts context handler computes `userMsgCount` (:494), `firstUserPresent` (:495), `banner {activeCount,names}` (:524), `highWater` (:526) — all in the `context.fire` detail (:513-527). smoke.ts loads SECOND ⇒ msgs are POST-filter (canary absence = hidden).
- **rewindNow helper** (smoke.ts:103-120): calls REAL `makeRewindTool(pi).execute` with `SMOKE_NOTE` (canonical valid 4-field note); granularity param accepts `"checkpoint"` with `{checkpoint}` opts (F-checkpoint-rewind case :299-304 is the template).
- **Assertion patterns**: assertCheckpoint (:378-415) — K>0 guard `/refused|0 messages will be hidden/i`, label set + consumed (`!labelActive`), assertGlobalInvariants; helpers readSessionEntries/countCustom/countLabel/labelActive; assert() at :141; ASSERTERS map :588-600.
- **protectedRoles** default `["first:user","latest:user"]` (src/config.ts:151); enforcement `protectedOk` in transforms.ts :1373-1397 (fail-safe: missing config still protects first:user).
- **Parallel item P1.M2.T2.S2 (F-banner)**: also edits run-smoke.mjs + smoke.ts; PRP read — its additions are appends (F-banner scenario, assertBanner, main() special-case, banner case in driveScenario). No conflicts if F-consent appends after it. F-banner is two-run (needs main() special-case); F-consent is single-run (standard `{smoke, piRes}` asserter).

## Scenario design decisions

- 8-prompt flow: seed anchor → `/mulligan_checkpoint delta` → U1 → U2 → `/mulligan_smoke F-consent-rewind` → GUARD user prompt → `/mulligan_smoke F-consent-guard` → observe. 5 expected fires (prompts 1,3,4,6,8).
- U1/U2 in USER prompts (consented hiding targets — checkpoint granularity only); GUARD in the user prompt the last_turn rewind re-lands on (must stay visible).
- Consent booleans logged on EVERY fire (needed for pre-rewind presence sanity — anti-vacuous-pass — and the every-fire firstUserPresent invariant).
- Final fire asserts everything (both markers still apply at the end: U1/U2 hidden, GUARD visible) — simpler and more robust than mid-run fire indexing.