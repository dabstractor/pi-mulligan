# Research notes — P1.M2.T2.S2 (F-banner)

## Verified in source (2025-06 harness state)

### run-smoke.mjs (674 lines)
- SCENARIOS array :30-44 (currently 14; P1.M2.T2.S1 adds "F-ckptcmd" after "F-checkpoint" → 15; add "F-banner" after that).
- runPi(scenario, { prompts, extraArgs }) :71-101: spawns `pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p ... `, env MULLIGAN_SMOKE_LOG=<SMOKE_TMP_DIR>/<scenario>.log, 120s timeout, returns {status, stdout, stderr, logPath}.
- **Two-run pattern (F-reload/E11) at :600-610**: `const r1 = runPi(scenario); const smoke1 = parseSmokeLog(r1.logPath); const r2 = runPi(scenario, { extraArgs: ["-p", "Reply with exactly: OK"] }); const smoke2 = parseSmokeLog(r2.logPath); return { piRes: r1, smoke: smoke1, r2, smoke2 };` — both spawns share `--session-id smoke-<scenario>-<RUN_ID>` (RUN_ID stable per invocation). Run 2's extra prompt appends prompts.
- **Log file semantics**: smokeLog APPENDS (runPi uses the SAME logPath for both runs); smoke1 parsed BETWEEN the spawns contains only run-1 lines; smoke2 contains BOTH runs' lines (this is exactly how assertReload/assertE11 :426-475 consume run2.smoke.contextFires[0] / [last]).
- main() special-cases :637-641: `if (scenario === "F-reload") outcome = assertReload(run, { smoke: run.smoke2 }); else if (scenario === "E11") ... else ASSERTERS[scenario](...)`. F-banner needs a THIRD special-case line (or a dedicated branch).
- parseSmokeLog :101-118 → { lines, contextFires (parsed detail of context.fire lines), sessionFile (from session.start line) }.
- readSessionEntries :125-135 (unused by F-banner; all assertions are smoke-log based).
- assert(results, label, cond, detail) helper.

### smoke.ts
- pi.on("context") handler :456+ logs context.fire with `banner: { activeCount: checkpointNames.length, names: checkpointNames }` (P1.M2.T1.S1) — a PURE recompute via listCheckpoints (same scanner reconcileBanner imports). Confirmed at :516.
- Also has `hasNudge` in the fire line; assertGlobalInvariants enforces zero mulligan:nudge.
- Headless note in comments :483-485: ctx.hasUI === false in -p mode → reconcileBanner no-ops → setWidget unobservable; banner state is recomputed instead.
- F-banner needs a `case "F-banner":` logging-only/no-op branch in driveScenario's switch (mirror F-ckptcmd case from P1.M2.T2.S1).

### src/banner.ts
- reconcileBanner branches: (a) !hasUI → no-op; (b) config off → clear; (c) 0 active → clear; (d) ≥1 active → setWidget with one verbatim line per checkpoint.
- Verbatim banner line (needed for the 0-banner-bytes check):
  `⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>`
  (name substituted twice; check with the fragment `Mulligan checkpoint active:` and `/mulligan_checkpoint_revoke ` which never appear in any other smoke string).
- Banner is UI-ONLY, never injected into event.messages (E26 acceptance (d)) — that's WHY 0 banner bytes in the filtered view is assertable.

### src/index.ts
- :87 session_start handler calls reconcileBanner(ctx) — "restore on /resume" is real behavior; in headless -p mode it no-ops (branch a), so the /resume restore must ALSO be proven via the banner recompute observable (listCheckpoints is latest-wins over the reopened session's entries → checkpoint set in run 1 remains active in run 2's fires).

### Commands
- /mulligan_checkpoint <name> and /mulligan_checkpoint_revoke <name> dispatch deterministically (no model call); handlers never throw; reconcileBanner is called by the handlers too (UI mode only).
- config default: ui.activeCheckpointBanner is ON by default (spec/09) — no config override needed for the scenario.

### P1.M2.T2.S1 contract (parallel sibling)
- Adds "F-ckptcmd" to SCENARIOS (after "F-checkpoint"), a runScenario custom-flow branch with literal slash-command prompts, assertCkptcmd + ASSERTERS registration, a logging-only driveScenario case, and a scenarios.md `### F-ckptcmd` section. My edits must be strictly ADDITIVE and land AFTER that sibling's (scenario ordering: F-banner after F-ckptcmd).

### Scenarios count trajectory
14 → 15 (S1 F-ckptcmd) → 16 (this) → 19 after T3/T4/T5.