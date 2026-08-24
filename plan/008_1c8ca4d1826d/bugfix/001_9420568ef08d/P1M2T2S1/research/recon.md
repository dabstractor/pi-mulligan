# Research Notes — P1.M2.T2.S1 (F-ckptcmd smoke scenario)

## Harness recon (test/integration/run-smoke.mjs, verified)
- `SCENARIOS` array :30-44 — add `"F-ckptcmd"`.
- `runPi(scenario, {prompts, extraArgs})` :71-101 — spawns `pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario>-<RUN_ID> -p ... ` with `MULLIGAN_SMOKE_LOG` env, 120s timeout. KEEP `-ne` (collision guard vs globally-installed older mulligan).
- `runScenario(scenario)` :550 — custom-flow branches by exact scenario name before the default 2-prompt flow; add an `if (scenario === "F-ckptcmd")` branch with prompts `["/mulligan_checkpoint x", "/mulligan_checkpoint_revoke x", "Reply with exactly: OK"]`.
- `ASSERTERS` map ~:533-549 — add `"F-ckptcmd": assertCkptcmd`.
- Helpers available: `assert(results, label, cond, detail)`, `parseSmokeLog(path)` → `{lines, contextFires, sessionFile}`, `readSessionEntries(sessionFile)`, `countCustom(entries, customType, kind?)`, `countLabel(entries, prefix)`, `labelActive(entries, label)` (:177 — mirrors Pi latest-wins label resolution; a `setLabel(id, undefined)` clear entry sets undefined), `assertGlobalInvariants(results, entries)`.
- Asserter signature: `function assertX({ smoke, piRes })` → `{ results, sessionEntries }`; entries.length===0 (model timeout) → JSONL assertions skipped with a ⚠ note (existing convention in assertRewindCore).

## Why prompts are enough (no smoke.ts driveScenario case needed beyond logging)
Slash commands dispatch deterministically: `-p '/mulligan_checkpoint x'` — Pi intercepts the leading `/`; the command handler (registered in src/index.ts) runs; NO model call needed. setCheckpoint requires a prior REAL conversation message (walks getBranch() backwards for last `message` entry with a role) — a FRESH session has the `-p` user prompt itself, which IS a message entry, so `stableId` exists after prompt 1. So the flow works: prompt 1's own user message is the anchor.

Caveat: with a fresh session, at `/mulligan_checkpoint x` time the branch contains the session header + the prompt-1 user message entry → setCheckpoint labels it. Revoke then clears (clearCheckpointByName two-phase latest-wins confirm → setLabel(id, undefined)).

Label entry shape on disk: `{type:"label", targetId, label}` (set) and `{type:"label", targetId, label:undefined}` (clear). `labelActive` mirrors Pi resolution.

## No agent checkpoint tool
- src/index.ts registers only rewind/shrink/audit/cancel (4 tools); unit-pinned at test/index.test.ts:74.
- JSONL assertion: zero `type:"custom"` entries with customType `mulligan:checkpoint` (checkpoints are LabelEntries — `countCustom(entries, "mulligan:checkpoint") === 0`). Also zero tool invocations of mulligan_checkpoint — assert no session entry stringifying a toolCall with name "mulligan_checkpoint".

## smoke.ts
Needs a `F-ckptcmd` case in driveScenario ONLY to smokeLog scenario completion — actually the item says: "smoke.ts driveScenario gets a 'F-ckptcmd' case that only smokeLogs (commands execute via src/index.ts's registration — NOT routed through /mulligan_smoke)". Note: since the orchestrator's prompts are literal slash commands (not `/mulligan_smoke F-ckptcmd`), driveScenario is never invoked for this scenario — but smoke.ts's `session.start` log (sessionFile observable) still fires from the extension load. Check smoke.ts's command registration: it registers `/mulligan_smoke`; the scenario.start line comes from driveScenario. As long as session.start with sessionFile is logged at load/session event (not only in driveScenario), parseSmokeLog gets sessionFile. VERIFY during implementation: the sessionFile must be available — if session.start is logged only inside driveScenario, add a minimal no-op case. Safest: add a `case "F-ckptcmd": break;` to driveScenario AND (if needed) ensure sessionFile comes from a session/session.start line emitted at load. parseSmokeLog reads sessionFile from any `session.start` line.

## commands.ts contract
- makeCheckpointCommand (:160-210): parse name → disabled-gate → validCheckpointName → setCheckpoint → notify verbatim strings; reconcileBanner on success.
- makeCheckpointRevokeCommand (:217-255): clearCheckpointByName → not-found notify `Mulligan: no active checkpoint named 'x'.` or cleared notify + reconcileBanner.
- setCheckpoint src/markers.ts:456-490 — `pi.setLabel(stableId, 'mulligan:checkpoint:x')`; returns `{error:"no conversation message to checkpoint..."}` when no message entry exists.

## scenarios.md
Add `### F-ckptcmd` section mirroring existing per-scenario entries (how to run / expect / pass criteria, spec @10-testing.md:102).

## Docs/tests
- npm run smoke; npm test; npx tsc --noEmit (run-smoke.mjs is NOT type-checked; smoke.ts is).