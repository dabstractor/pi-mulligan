# System Context — pi-mulligan v2.0 bug-fix changeset (BUG-001..003)

Project: `/home/dustin/projects/pi-mulligan-current-turn-only` (npm `pi-mulligan` 0.1.4).
Type: Pi coding-agent **extension** (TS, ESM, entry `src/index.ts`, `pi.extensions` in package.json).
Gates: `npm test` (vitest, 1104 tests / 25 files, all green at hunt time), `npx tsc --noEmit` (clean),
`npm run smoke` (real `pi -p` integration, currently 14/14).

## Module map (with anchors)

- `src/index.ts` — registration: **4 tools only** (lines 53–56: `makeRewindTool`, `makeShrinkTool`,
  `auditTool`, `makeCancelTool`). `mulligan_checkpoint` agent tool is NOT registered (v1.1 E23).
  Slash commands (lines 62–64): `mulligan_checkpoint`, `mulligan_checkpoint_revoke`, `mulligan_audit`.
  Line 87 calls `reconcileBanner(ctx)` on `session_start` (covers /resume banner restore).
- `src/tools/rewind.ts` (743 lines) — `REWIND_PARAMS` typebox schema ~81–116 (`checkpoint` param
  description at 112–114); `REWIND_DESC` 127–129; `MUTATION_WARNING` ~131; `successText(granularity, k,
  hasWarning)` 179–187 (returns `{text}`; appends MUTATION_WARNING when `hasWarning`);
  `countRewindMarkers` 209 (E4 depth guard, cancel-aware); `countRetriesAtLatestPrompt` 283 (~E22 step 4b);
  `rewindExecute` 486–717: (1) config gates 537–542 → (2) `validateNote` 545 → (3) `checkpointExists` 551 →
  (4) depth guard 559 → (4b) retry budget refuse 570–581 → (4c) context-fraction refuse 583–612 →
  (5) `resolvePreview` 613 → (6) `renderNote` 627 → (7) `appendRewindMarker` 631 (payload carries raw
  `note: params.note`) → (7b) checkpoint label consumption 642–693 → (8) mutation check 695 →
  (9) success via `successText` 699–704. Tool factory `makeRewindTool(pi)` 721–742 (`name` at 733).
- `src/tools/checkpoint.ts` (192 lines) — exports `CheckpointParams`(53), `CheckpointArgs`(61),
  **`validCheckpointName`(74 — LIVE: imported by `src/commands.ts:34`)**, `CKPT_DESC`(84),
  `CheckpointDetails`(91), `makeCheckpointTool`(182 — dead in src/, used by `test/integration/smoke.ts:40,273,289`
  and unit tests as a deterministic label-creation driver). NOT safely deletable without surgery.
- `src/commands.ts` (360 lines) — `/mulligan_checkpoint` (`makeCheckpointCommand` 160–210: enabled gate →
  `validCheckpointName` → `setCheckpoint` → fair-warning notify + `reconcileBanner`);
  `/mulligan_checkpoint_revoke` (217–255 + `clearCheckpointByName` 78–127: two-phase discover+confirm via
  latest-wins `getLabel`, `pi.setLabel(id, undefined)`); `/mulligan_audit` (262–360: disabled gate →
  `!ctx.hasUI` early return → filtered view from `rt.lastFiltered` else E16 fallback → `renderAuditReport` →
  **`notify(ctx, report, "info")` ONLY — never `event.messages`, never appendEntry/sendMessage**).
  Checkpoints are **Pi LabelEntries** (`setCheckpoint` in `src/markers.ts:456–490`,
  `pi.setLabel(stableId, "mulligan:checkpoint:"+name)`), not custom entries.
- `src/banner.ts` (75 lines) — `reconcileBanner(ctx)` is the SINGLE writer of widget key
  `"mulligan:active-checkpoint"`; branches: (a) `!ctx.hasUI` no-op, (b) knob off → CLEAR,
  (c) 0 active → CLEAR, (d) ≥1 active → `setWidget(KEY, lines, {placement:"aboveEditor"})` (line 69).
  Never throws (whole-body try/catch). Banner is UI-only, zero model-context cost.
- `src/nudges.ts` — Nudge A (bloat reminder, prescribing) rides `tool_result`; Nudge B drift
  (`turnEndMetricHandler` 197–260) rides `turn_end`; `shouldNudge` 325–332 gates on moving average of
  agent-attributable deltas (default ≥4000 over 3 turns); `shouldHighWater` 497 (awareness-only, edge latch
  `rt.aboveHighWater`, default fraction 0.7). **D10 user-paste exemption is structural**: `estimateAgentTokens`
  (`src/tokens.ts:126–143`) counts only `role !== "user"` messages — "50k" is illustrative (spec/07:174),
  NOT a numeric threshold.
- `src/markers.ts` — CustomEntry markers `mulligan:rewind|shrink|turn-metric|cancel` (228–366), envelope
  `{schema,v,kind,id,seq,ts}`; rewind marker `data.note` holds the **raw `NoteInput`
  `{what_happened, avoid, lesson, next?}`** (line 80) — this is the durable channel for note comparison.
- `src/runtime.ts` — `SessionRuntime` (59–109), module-scoped `Map<sessionId,…>` (112): `seq`,
  `tokenBaseline`, `lastTurnIndex`, `lastFiltered`, `pendingBloatHits`, `shrinkMissCounts`,
  `aboveHighWater`, `rewindRefusedTurnIndex`. C12: never caches a sessionManager handle.
- `src/config.ts` — `MulliganConfig` (24–146): `rewind.{enabled,protectedRoles:["first:user","latest:user"],
  maxDepth:5, maxRetriesPerPrompt:5, abortContextFraction:0.9, requireMutationWarning}`,
  `nudges.{…,highWaterFraction:0.7}`, `ui.{activeCheckpointBanner:true}` (banner gate). No env vars.

## Test architecture

- Unit: vitest, hand-rolled fakes. `test/tools/rewind.test.ts` (1378 lines): `makePi()` fake ExtensionAPI,
  `makeCtx({entries,…})` fake ctx (sessionManager: `getEntries/getLabel/getBranch/buildContextEntries/
  getContextUsage`), `run(pi,ctx,params,toolCallId="call-1")` helper 181–195, `firstText(res)`.
  Fixtures: `msgEntry(user(...))`, `rewindEntry(seq)` 207–209 (**no `data.note`** — E22 advisory tests need a
  new fixture), `rewindEntryWithId` 212, `cancelEntry` 217, `metricEntry` 223, `VALID_NOTE`, `setConfig({...})`.
  Registration describe at 295–315: asserts `tool.description === REWIND_DESC` (301) AND **hard-codes the
  current (old) REWIND_DESC string at 304–312 — must be updated in the same commit as BUG-001's fix**.
  Retry-budget tests ~1001–1016 (mirror shape for advisory tests).
  `test/index.test.ts:74` asserts exactly 4 registered tools. v1.1 unit coverage exists:
  `test/commands.test.ts` (37 its), `test/banner.test.ts` (8 its), D10 drift tests
  `test/drift_nudge.test.ts` ~147, `test/turn_metric.test.ts` ~508.
- Integration (`test/integration/`):
  - `run-smoke.mjs` (674 lines): `SCENARIOS` array **lines 30–44** (9 v1.0 F-* + E7/E11/E12/E15/E20 —
    **none of the five v1.1 scenarios**). `runPi()` 78–101 spawns `pi -ne -e ./src/index.ts -e
    ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p … -p …` (`-ne` blocks globally
    installed mulligan collisions; `-e` ORDER matters: filter first, observer second; timeout 120 s).
    Per-scenario asserters in `ASSERTERS` (~560); custom multi-prompt flows in `runScenario()` (~545).
    Helpers: `assert`, `parseSmokeLog` (105–125), `readSessionEntries`, `countCustom`,
    `countLabel(prefix)`, `labelActive(entries,label)` (177 — latest-wins label resolution mirroring Pi),
    `entryIncludes`, `assertGlobalInvariants` (§2.3). Pass = all results pass; exit 0 iff all scenarios pass.
  - `smoke.ts` (545 lines): observer extension; `driveScenario(pi,ctx,scenario)` switch at ~164
    (16 existing cases incl. split-phase `F-checkpoint-set`/`F-checkpoint-rewind` 283–303 — the seed-flow
    pattern F-consent should reuse); drives REAL tool factories; `smokeLog()` JSONL observables; context
    handler logs `context.fire` `{count,msgCanaryPresent,resultCanaryPresent,notePresent,hasRewindMarker,
    shrunkInContext,hasNudge}`; registers `mulligan_smoke_big` tool (RESULT_CANARY) + `/mulligan_smoke`
    command. **No v1.1 cases.**
  - `scenarios.md` (473 lines): harness playbook + per-scenario run/expect/pass criteria for the existing
    14 (also documents spec-only F-retrycap/F-abortfraction as not-yet-driven).

## Docs landscape

No `docs/` directory. Changeset-level candidates: `README.md` (§4 Tools + human commands 194–205; §7
resolved bugs; does NOT state a scenario count) and `VERIFICATION.md` (DoD gate table; **canonical place to
re-record the 14→19 scenario count and gate results**). `spec/` is the read-only source of truth.

## Environment confounder (do not chase)

During the hunt, the harness session received v1.x prescribing-drift nudges ("If wasteful, mulligan_rewind
to undo the turn…") fired by a **globally installed older mulligan build** — that string exists ONLY in the
parent checkout `~/projects/pi-mulligan/src/notes.ts:337` (verified: 0 matches in this worktree's src/ and
test/). `run-smoke.mjs`'s `-ne` flag exists precisely to defend against this. Environment artifact, not a
bug in the code under test. (This session has also received these nudges; they are the same artifact.)