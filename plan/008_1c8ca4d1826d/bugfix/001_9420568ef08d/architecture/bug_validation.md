# Bug Validation — PRD BUG-001..003 vs codebase reality

All three PRD claims were verified against source + spec. **All CONFIRMED.** Couplings and nuances the
breakdown must respect are flagged per bug.

---

## BUG-001 — REWIND_DESC omits v1.1 checkpoint clause; checkpoint param docs reference the removed agent tool
**CONFIRMED.** `src/tools/rewind.ts:127–129` ends at "…to redo the whole turn from the user's last message."

Spec-mandated strings (VERBATIM, verify byte-for-byte):

- `spec/05-tools.md:325` (§6 "Description strings") — required final sentence, appended with a leading
  space and an em-dash:
  ```
   granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it).
  ```
- `spec/05-tools.md:46–47` — checkpoint param description:
  ```
  Required when granularity=checkpoint. The name of a checkpoint set via the /mulligan_checkpoint command.
  ```
  Current `rewind.ts:112–114` says "…set via mulligan_checkpoint." (references the removed v1 agent tool;
  v1.1 spec/05 §3 lines 167–175: "There is no agent-callable way to create a checkpoint.").

**COUPLING (not in the PRD):** `test/tools/rewind.test.ts:304–312` hard-codes the OLD REWIND_DESC string —
that assertion must be updated in the same commit or the suite fails. Also note the code comment at
rewind.ts:122 already calls these strings "Mode A LLM-facing docs" — the strings themselves ARE the doc
surface for this fix. The `granularity` param description (rewind.ts:101–108) already matches spec — do
NOT touch it.

## BUG-002 — E22 identical-note advisory not implemented
**CONFIRMED.** Zero grep hits for "identical note"/"reproducing the mistake"/"Change approach or shrink" in
src/. `successText` (rewind.ts:179–187) appends only MUTATION_WARNING. Both MUST-level backstops ARE
implemented + unit-tested (step 4b budget 570–581, step 4c fraction 583–612) — only the SHOULD-level
steering advisory is missing.

Spec VERBATIM (`spec/08-edge-cases.md:117`):
> **Advisory repeat-detection hint:** if two consecutive rewinds re-land at the same prompt with
> substantively identical notes (same `what_happened` after trim/lowercase — which now includes the
> avoid/lesson), the success text for the second one SHOULD append: `"⚠ You have rewound with an identical
> note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather
> than rewinding again."` This steers; the budget/context-fraction stops above are what ultimately refuse.

Implementation grounding (researched):
- **No new persistent state is needed.** The durable channel already exists: each rewind marker's
  `data.note` holds the raw `NoteInput` (`src/markers.ts:80`).
- "Same prompt slice" = the exact slice `countRetriesAtLatestPrompt` (rewind.ts:283+) already walks:
  entries after the LAST `type:"message" && role==="user"` entry; rewind markers there that are NOT
  retired by a later `mulligan:cancel` (BUG-005 cancel-exclusion pattern, `cancelledRewindIds`).
- "Substantively identical" = compare `what_happened` after `trim().toLowerCase()` (per spec, `what_happened`
  already absorbs avoid/lesson content, so one field suffices). Two CONSECUTIVE rewinds at the same prompt.
- Append point: step 9 success return (rewind.ts:699–704) via/next to `successText` — advisory NEVER refuses
  and must not change the k-clause or MUTATION_WARNING behavior.
- Test fixture gap: existing `rewindEntry(seq)` (rewind.test.ts:207) carries NO `data.note` — add a
  `rewindEntryWithNote` fixture; mirror the retry-budget tests at ~1001–1016.

## BUG-003 — five v1.1 integration scenarios missing from the smoke suite
**CONFIRMED.** None of F-consent / F-ckptcmd / F-banner / F-useraudit / F-drift-userexempt appear in
`run-smoke.mjs` SCENARIOS (30–44), `smoke.ts` `driveScenario` (16 cases, none v1.1), or `scenarios.md`.
Spec `@10-testing.md` §2.1 (lines 101–105) defines them as REQUIRED; `@11-build-order.md` Step 6b (~105)
names four of them in its verify criteria, and DoD #2 (lines 139–149) requires "All F-* integration
scenarios green against a real `pi -p` run (log + JSONL assertions)."

Pass criteria VERBATIM (spec/10 §2.1):

| Scenario | Drive | Pass criteria |
|---|---|---|
| F-consent | set a user checkpoint, send 2 more prompts, then agent `mulligan_rewind(granularity:"checkpoint")` | rewind succeeds and hides both subsequent user prompts (the user opted in); `first:user` never hidden; `last_turn`/`last_tool_call_group` never hide a `user` message |
| F-ckptcmd | `/mulligan_checkpoint x`; `/mulligan_checkpoint_revoke x` | `mulligan:checkpoint:x` label set on the leaf (no extra control entry — user-owned); revoke clears it; agent `mulligan_checkpoint` tool does NOT exist |
| F-banner | `/mulligan_checkpoint x` then several turns | `setWidget("mulligan:active-checkpoint",…,{placement:"aboveEditor"})` set + persists; clears within one context fire after revoke/consumption; restored on `/resume`; 0 banner bytes in the filtered view |
| F-useraudit | `/mulligan_audit` (human) vs `mulligan_audit` (agent) | same `renderAuditReport` string both ways; command output to human/transcript, NOT in `event.messages`; tool result still reaches the model |
| F-drift-userexempt | user pastes a ~50k-token doc; agent ~0 work | drift nudge does NOT fire (user content excluded from agent-attributable delta); high-water signal DOES fire on total context; contrast: 3 turns of ~4k agent reads DO fire drift |

Registration recipe (researched, 4 touchpoints per scenario): (1) name in `SCENARIOS`; (2) asserter in
`ASSERTERS` (or two-run special-case in `main()` for /resume flows, cf. F-reload/E11 sharing the
`--session-id`); (3) optional custom prompt flow in `runScenario()`; (4) `case` branch in `smoke.ts`
`driveScenario`. Slash commands can be dispatched directly as `-p "/mulligan_checkpoint x"` prompts (Pi
intercepts /cmd — no model call, deterministic).

**Nuances / risks (flagged):**
- **F-banner headless problem:** `-p` mode has `hasUI=false` → `reconcileBanner` branch (a) no-ops, so
  setWidget cannot be observed directly. Assert instead via smoke-log observables (e.g. banner-state lines
  derived from `listCheckpoints` — pure, headless-safe — logged on each context.fire) plus JSONL
  label-state via `labelActive`, plus "0 banner bytes in filtered view". `/resume` restore = second pi run
  on the same `--session-id` (E11 pattern) asserting banner-state observable is SET again.
- **F-drift-userexempt:** needs a NEW high-water observable in the context.fire log (only `hasNudge` is
  logged today; `rt.aboveHighWater`/`shouldHighWater` state lives in nudges.ts:497). The ~50k-token paste
  goes in as a `-p` argument (~200 KB < ARG_MAX, feasible); the D10 exemption is structural
  (`estimateAgentTokens` excludes `role:"user"`), not a 50k constant. The contrast arm (agent reads firing
  drift) is model-driven — mark soft like F-nudge-drift's documented soft spots.
- **F-consent** needs the F-checkpoint split-phase seed pattern (`F-checkpoint-set`/`F-checkpoint-rewind`,
  smoke.ts:283–303) + a user-message hiding-verdict observable.
- **F-ckptcmd tool-absence:** assert no checkpoint tool invocation in JSONL + (best-effort) tool-list
  probe from the observer extension; `test/index.test.ts:74` already pins 4 registered tools at unit level.
- Pre-existing gap (out of scope): spec-only v1.0 F-cancel/F-retrycap/F-abortfraction are also not driven;
  PRD scopes ONLY the five v1.1 scenarios.
- `smoke.ts` imports `makeCheckpointTool` (line 40) as a deterministic label-setter for the legacy
  F-checkpoint flow — leave that working; do not "clean it up" as part of BUG-003.

## PRD Recommendation #4 — deprecate `src/tools/checkpoint.ts`
Research verdict: **do NOT delete.** `validCheckpointName` (line 74) is imported by `src/commands.ts:34`
(live shared logic) and `makeCheckpointTool` is used by `test/integration/smoke.ts:40,273,289` plus unit
tests. Safe minimal action: JSDoc `@deprecated` on the tool factory/CKPT_DESC/CheckpointParams explaining
v1.1 E23 removal and that only `validCheckpointName` remains live. Deletion would require migrating
smoke.ts's F-checkpoint driver — out of scope for this changeset.