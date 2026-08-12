# Delta PRD — v1.1 Human-facing surface + consent model + agent-attributable drift

**From:** Draft 1.0 (post-session-006 codebase) · **To:** Draft 1.1
**Spec state:** spec files are ALREADY at v1.1 (commit `57a5e1f9` updated `spec/01–13` + `SPEC.md` only). **The code is still v1.0.** This delta implements the v1.1 code changes against the v1.0 codebase.
**Baseline:** all tests green; `mulligan_checkpoint` is an agent tool; `to_previous_prompt` exists; drift delta counts `user` messages; no human commands; no banner.

---

## 0. Diff analysis (what actually changed in the PRD)

The v1.1 amendment makes **four** user-facing/behavioral changes plus one pure-helper change. Counted against the codebase, the change surface is **medium-large** (≈15 src files touched, 1 tool removed, 1 cross-cutting option removed with 39 test occurrences, 3 new commands, 1 new UI mechanism, 1 new pure helper, 1 new config knob). This is ~2× session-006's scope (which was two localized text/field edits).

| # | Change | Type | Code surface |
|---|--------|------|--------------|
| 1 | `mulligan_checkpoint` agent tool **removed** → `/mulligan_checkpoint` human command (+ `/mulligan_checkpoint_revoke`) | remove + add | delete tool reg in `index.ts`; new `src/commands.ts`; agent retains `mulligan_rewind(granularity:"checkpoint")` |
| 2 | `to_previous_prompt` option **removed** (violates new guardrail) | remove (cross-cutting) | `RewindParams` schema, `resolveLastTurn` signature, `rewindExecute` behavior, `markers.ts` options, `filter.ts` pass-through, 9 test files |
| 3 | New guardrail (principle 7): no rewind wipes user input except opt-in checkpoint | hardening | largely enforced-by-construction once #2 is gone; `protectedOk` already only enforces `first:user` (verified) — **no change needed** there |
| 4 | Drift nudge measures **agent-attributable** growth only (D10) | modify | new `estimateAgentTokens` pure helper; `turnEndMetricHandler` uses it; high-water unchanged |
| 5 | New human command `/mulligan_audit` (report to human, not model) | add | new command handler; reuse `renderAuditReport` |
| 6 | Active-checkpoint banner (`ctx.ui.setWidget`) | add | new `reconcileBanner`; new config knob `ui.activeCheckpointBanner`; hook in `contextHandler` tail + `session_start` + commands |

**Non-goals for this delta (do not implement):** re-verifying the already-shipped rewind/shrink/cancel/nudge core; changing the marker persistence model; touching `protectedOk` (already correct).

---

## Phase 1 — Guardrail + agent-side modifications (no new Pi surfaces)

Pure-core + tool + nudge changes that do not depend on the new `registerCommand`/`setWidget` surfaces. Land first because Phase 2's commands reuse the (now-finalized) rewind behavior + `setCheckpoint` wrapper.

### Milestone P1.M1 — Remove `to_previous_prompt`; finalize the guardrail

**Scope:** the `to_previous_prompt` option is gone from the agent API and the filter; `last_turn` always keeps the latest user message (the guardrail is enforced by construction). `protectedOk` is **already** `first:user`-only (verified `transforms.ts:1212`) — no change there. The rewind tool's nuclear-first-user refusal (BUG-006, `rewind.ts` step 5b) becomes dead code and is removed.

**Tasks:**

#### Task P1.M1.T1 — Remove `to_previous_prompt` from the rewind tool + transforms + markers
- **Subtask P1.M1.T1.S1 — `src/transforms.ts` `resolveLastTurn` signature + body.** Remove the `opts` parameter entirely: `resolveLastTurn(messages, excludeToolCallId?)` — it always keeps the latest user message (drop the nuclear branch at line ~334/`const nuclear = ...`). Update the JSDoc (lines ~286–321) to remove all `to_previous_prompt`/nuclear language; state the v1.1 guardrail ("keeps the user message — `last_turn` never wipes user input"). Update the `RewindMarkerLike.options` type (line ~1123) — the `to_previous_prompt` field becomes legacy-only (keep it OPTIONAL on the persisted shape for backward-compat reads of old markers, but the resolver no longer reads it). `filterPipeline`'s `resolveLastTurn(m, rw.options, rw.excludeToolCallId)` call (line ~1362) drops the `rw.options` arg. **(Mode A doc: JSDoc on `resolveLastTurn` is the inline spec — spec/06 §4.)**
- **Subtask P1.M1.T1.S2 — `src/tools/rewind.ts` schema + behavior.** Remove `to_previous_prompt` from `RewindParams` (the `Type.Optional(Type.Boolean(...))` block). Update `REWIND_DESC`'s `last_turn` clause if it mentions discarding the user message (it currently doesn't — verify). In `rewindExecute`: (a) stop passing `to_previous_prompt` to `resolveLastTurn`; (b) **remove the dead BUG-006 refusal** (step 5b, the `granularity === "last_turn" && params.to_previous_prompt === true && k === 0` block); (c) in the persisted `payload.options`, stop emitting `to_previous_prompt` (emit `{ protect: config.rewind.protectedRoles }` only). The checkpoint-granularity path is **retained** (agent still rewinds to user-set checkpoints). **(Mode A doc: `RewindParams` field descriptions + `REWIND_DESC` are the LLM-facing docs — spec/05 §1.)**
- **Subtask P1.M1.T1.S3 — `src/markers.ts` (backward-compat only).** `RewindMarker.options.to_previous_prompt` stays OPTIONAL on the persisted TYPE for reading old markers (no migration — old markers are simply never consulted for it anymore since the resolver dropped the arg). No behavioral change; just confirm the field is `?:` and add a one-line JSDoc note "legacy v1.0 field; ignored by the v1.1 resolver." **No test change** (markers.test.ts fixtures that set `to_previous_prompt` still type-check since it stays optional).
- **Subtask P1.M1.T1.S4 — Tests for `to_previous_prompt` removal** (`test/transforms.test.ts`, `test/tools/rewind.test.ts`, `test/edge-cases.test.ts`, `test/markers.test.ts`, `test/tools/cancel.test.ts`, `test/integration/smoke.ts`). 39 occurrences across these files. Remove every `to_previous_prompt`-passing call to `resolveLastTurn`; remove the nuclear-mode test cases (the "also removes the user message" assertions); remove the BUG-006 refusal test; keep the default-`last_turn`-keeps-user-message assertions (strengthen them into guardrail assertions: `last_turn` NEVER removes a `user` message). Add one positive guardrail test: a `last_turn` rewind leaves the latest user message in the surviving tail. All tests green.

### Milestone P1.M2 — Agent-attributable drift delta (D10)

**Scope:** the drift nudge's `deltaTokens` excludes `user` messages (a user's prompt is ground-truth, never sheddable bloat). The high-water signal is **unchanged** (it measures total filtered context — correctly fills on a big user paste). New pure helper in the Pi-free tier.

**Tasks:**

#### Task P1.M2.T1 — `estimateAgentTokens` + wire into `turnEndMetricHandler`
- **Subtask P1.M2.T1.S1 — `src/tokens.ts`: add `estimateAgentTokens`.** New exported pure helper: `estimateAgentTokens(messages: MessageLike[]): number` = sum of `estimateTokens` over messages whose `role !== "user"` (i.e. assistant + toolResult + custom + bashExecution). Reuse `estimateTokens` + `messageCharLength`'s discipline; never throws; empty/non-array → 0. Pure, Pi-free, unit-testable. **(Mode A doc: JSDoc states D10 — "agent-attributable only; user prompts are ground-truth" — spec/07 §2, spec/04 §5.)**
- **Subtask P1.M2.T1.S2 — `src/nudges.ts` `turnEndMetricHandler`: use `estimateAgentTokens`.** In the `now` computation (currently `rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens : (ctx.getContextUsage()?.tokens ?? 0)`), replace `estimateTokens(rt.lastFiltered).tokens` with `estimateAgentTokens(rt.lastFiltered)`. The `getContextUsage()` **fallback stays as-is** (it already counts the raw session — acceptable as a pre-baseline fallback; the no-delta path is unaffected). Add an `agentTokensFromUsage` is NOT needed — keep the existing fallback. Roll-forward `rt.tokenBaseline = now` now stores an agent-attributable baseline (correct: the next delta is agent-attributable too). Update the JSDoc to cite D10. **(Mode A doc: JSDoc on `turnEndMetricHandler` — spec/07 §2 v1.1 note.)**
- **Subtask P1.M2.T1.S3 — Tests for agent-attributable delta** (`test/tokens.test.ts`, `test/turn_metric.test.ts`, `test/drift_nudge.test.ts`). Add `estimateAgentTokens` unit tests: a list with a large `user` message + small assistant → estimates only the assistant. In `turn_metric.test.ts`, assert `deltaTokens` excludes a user-message contribution (mock `rt.lastFiltered` with a user msg; assert the baseline rolled is agent-only). Add the F-drift-userexempt-scenario-shaped assertion: a 50k-token user paste does NOT inflate the delta. All green.

### Milestone P1.M3 — Remove the `mulligan_checkpoint` agent tool

**Scope:** the agent can no longer *create* checkpoints (E23 resolved — foresight lives with the user). The agent **keeps** `mulligan_rewind(granularity:"checkpoint")`. The `setCheckpoint` wrapper in `markers.ts` is **retained** (the human command in Phase 2 reuses it). `checkpointExists` + checkpoint-consumption logic stay in `rewind.ts` (the agent still rewinds to checkpoints).

**Tasks:**

#### Task P1.M3.T1 — Unregister the agent tool; retire its tests
- **Subtask P1.M3.T1.S1 — `src/index.ts`: stop registering the agent tool.** Remove the `import { makeCheckpointTool }` line and the `pi.registerTool(makeCheckpointTool(pi));` line. Update the factory JSDoc ("5 agent-callable tools" → "4"). **Do NOT delete `src/tools/checkpoint.ts` yet** — Phase 2.M1 reuses `validCheckpointName`, `NAME_RE`, and the name-validation idiom by extracting them into the command; deleting now then re-adding is churn. Leave the file in place; it simply becomes unregistered dead code until Phase 2.M1 extracts its reusable bits (or Phase 2 deletes it after extraction). **(Mode A doc: factory JSDoc — spec/03 §2.1 tool inventory.)**
- **Subtask P1.M3.T1.S2 — `test/index.test.ts`: drop the checkpoint-tool registration assertion.** Remove the `expect(makeCheckpointTool)` / "registers 5 tools" assertions; assert 4 tools (`mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`, `mulligan_cancel`). Leave `test/tools/checkpoint.test.ts` in place for now (Phase 2 will repurpose/delete it); if it imports `makeCheckpointTool` and that breaks nothing (the file still exports it), it stays green. Verify `test/edge-cases.test.ts` and `test/tools/audit.test.ts` references to "5 tools" / checkpoint-as-agent-tool are updated to "4 tools" / checkpoint-as-human-command. All green.

---

## Phase 2 — Human-facing surface (new Pi surfaces: `registerCommand` + `setWidget`)

The three slash commands + the persistent banner. Verified Pi surfaces: `pi.registerCommand(name, {description, handler})` (`types.d.ts:903`, `RegisteredCommand.handler: (args, ctx: ExtensionCommandContext) => Promise<void>` at `:856`); `ctx.ui.setWidget(key, content, {placement:"aboveEditor"})` (`:97`, `WidgetPlacement = "aboveEditor"|"belowEditor"` at `:43`). C2 does NOT block human-typed commands (only agent-tool→`sendUserMessage`→dispatch).

### Milestone P2.M1 — `/mulligan_checkpoint` + `/mulligan_checkpoint_revoke`

**Scope:** the user sets/revokes checkpoints. Setting one arms the banner and emits a fair-warning notify. The agent rewinds to them via the existing `granularity:"checkpoint"` path.

**Tasks:**

#### Task P2.M1.T1 — New `src/commands.ts` with the two checkpoint commands
- **Subtask P2.M1.T1.S1 — `src/commands.ts`: checkpoint set + revoke command factories.** New module. Two factory functions `makeCheckpointCommand(pi)` and `makeCheckpointRevokeCommand(pi)`, each returning a `{ description, handler: (args, ctx) => Promise<void> }` (capturing `pi` via closure, mirroring the tool factories). **Set:** parse `name` from `args` (trim); validate via `validCheckpointName` (extract from `src/tools/checkpoint.ts` or re-export — keep one source); on invalid → `ctx.ui.notify("Mulligan: invalid checkpoint name '<name>' ...", "warning")` and return; on valid → `setCheckpoint(pi, ctx, name)` (reuse the shipped wrapper); on `{entryId}` → `ctx.ui.notify("Mulligan: checkpoint '<name>' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point ... Revoke with /mulligan_checkpoint_revoke <name>.", "warning")` and call `reconcileBanner(ctx)`; on `{error}` → `ctx.ui.notify("Mulligan: could not set checkpoint: <error>", "warning")`. Guard everything with `ctx.hasUI`. **Revoke:** parse `name`; scan `ctx.sessionManager.getEntries()` for a `label` entry whose label === `mulligan:checkpoint:<name>` and confirm via `getLabel(id)===needle` (mirror `checkpointExists` in `rewind.ts`); if none → `ctx.ui.notify("Mulligan: no active checkpoint named '<name>'.", "info")`; else `pi.setLabel(targetId, undefined)` for each currently-active target (mirror rewind.ts consumption's clear-all-concurrent loop), `reconcileBanner(ctx)`, `ctx.ui.notify("Mulligan: checkpoint '<name>' revoked. ...", "info")`. The whole handler bodies are try/catch → `ctx.ui.notify("Mulligan: unexpected error: <msg>", "warning")` (never throw). Export a small `clearCheckpointByName(pi, ctx, name): boolean` helper factored out of revoke (reused conceptually by the banner-state read — pure scan). **(Mode A doc: JSDoc on each factory cites spec/13 §2/§3.)**
- **Subtask P2.M1.T1.S2 — `src/index.ts`: register the two commands.** Add `pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));` and `pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));`. Update factory JSDoc to list the 3 human commands. (This is the same edit site as the Phase 2.M3 banner arming + the `/mulligan_audit` registration — coordinate so `index.ts` is touched once.)
- **Subtask P2.M1.T1.S3 — Tests for the checkpoint commands** (`test/commands.test.ts`, new file). Hand-rolled fake `pi` + fake `ctx` (fake `sessionManager` with `getEntries`/`getLabel`/`getLeafId`, fake `ui.notify`/`ui.setWidget`). Assert: set valid → `setLabel` called with `mulligan:checkpoint:<name>` + warning notify fired + banner reconciled; set invalid → notify "invalid", no label written; revoke existing → `setLabel(id, undefined)` + info notify + banner reconciled; revoke missing → "no active checkpoint" info, no clear; disabled config (`config.enabled=false`) → the command STILL works (E14 applies to the *agent* path; a human command is the escape hatch — but per spec/13 there's no `config.checkpoint` sub-knob, so honor only the master `enabled`; if `enabled=false`, refuse with "Mulligan is disabled"). All green.

### Milestone P2.M2 — `/mulligan_audit` (human-facing)

**Scope:** the human runs the same bloat diagnostic the agent's `mulligan_audit` produces, on demand, WITHOUT asking the agent. Output goes to the human (transcript / `ctx.ui`), **never** into `event.messages`.

**Tasks:**

#### Task P2.M2.T1 — `/mulligan_audit` command
- **Subtask P2.M2.T1.S1 — `src/commands.ts`: `makeAuditCommand(pi)`.** Reuse the existing `renderAuditReport` (already exported from `src/tools/audit.ts:429`) + `computeFilteredTotal` (audit.ts:526) + `listCheckpoints` (audit.ts:356). The handler: build the same filtered view the tool builds (`getRuntime(sessionId).lastFiltered`, else the E16 `buildContextEntries()` fallback), call `renderAuditReport`, then surface the report to the human via `ctx.ui` (e.g. `ctx.ui.notify(report, "info")` — capped if needed — or whatever the transcript sink is; verify `ExtensionCommandContext` exposes a print-to-transcript helper, else `ctx.ui.custom`/`notify`). The report's "Active markers" line includes `N checkpoints [names] (user-set)` (banner-aware). **Output does NOT enter `event.messages`** — a human command must not bloat the model's context. Guard `ctx.hasUI`. Whole body try/catch → notify "unexpected error". **(Mode A doc: JSDoc cites spec/13 §4.)**
- **Subtask P2.M2.T1.S2 — `src/index.ts`: register the audit command.** `pi.registerCommand("mulligan_audit", makeAuditCommand(pi));`.
- **Subtask P2.M2.T1.S3 — Tests for the audit command** (`test/commands.test.ts`). Assert: the command renders the same string `renderAuditReport` produces (call both, compare); the report is delivered to the human sink (fake `ctx.ui` captures it); zero writes to any `event.messages`-equivalent (assert no `pi.sendMessage`/`appendEntry` of kind `note`). All green.

### Milestone P2.M3 — Active-checkpoint banner + config knob

**Scope:** a persistent above-prompt-box reminder while ≥1 user-set checkpoint is active (E26). Reconciled on set/revoke/consumption/`session_start`/every `context` fire. New config knob `ui.activeCheckpointBanner` (default `true`).

**Tasks:**

#### Task P2.M3.T1 — `reconcileBanner` + config knob + hooks
- **Subtask P2.M3.T1.S1 — `src/config.ts` + `src/settings.ts`: add `ui.activeCheckpointBanner`.** Add `ui: { activeCheckpointBanner: boolean }` to `MulliganConfig` (default `true`) and `DEFAULT_CONFIG`. Add validation in `validateConfig`: coerce with `!!` (like `enabled`); invalid → default. Spec/09 §2/§4. **(Mode A doc: JSDoc on the field + rationale row in config — spec/09 §3.)**
- **Subtask P2.M3.T1.S2 — `src/commands.ts` (or a new `src/banner.ts`): `reconcileBanner(ctx)`.** Exported helper. Reads active checkpoints (scan `ctx.sessionManager.getEntries()` for `label` entries with `mulligan:checkpoint:` prefix, confirmed active via `getLabel`). If `≥1` active AND `getConfig().ui.activeCheckpointBanner` AND `ctx.hasUI` → `ctx.ui.setWidget("mulligan:active-checkpoint", lines, { placement:"aboveEditor" })` where each line is the spec/13 §5 VERBATIM warning (`⚠ Mulligan checkpoint active: "<name>" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke <name>`). If 0 active OR disabled OR no UI → `ctx.ui.setWidget("mulligan:active-checkpoint", undefined)` (clear). Never throws (whole body try/catch; a `setWidget` failure is logged + swallowed). Pure-ish (reads ctx + config; side-effect is the widget). **(Mode A doc: JSDoc cites spec/13 §5, spec/08 E26.)**
- **Subtask P2.M3.T1.S3 — Hook `reconcileBanner` into the refresh points.** (a) `src/commands.ts` checkpoint set + revoke handlers call `reconcileBanner(ctx)` after mutating state (already in P2.M1.T1.S1). (b) `src/index.ts` `session_start` handler calls `reconcileBanner(ctx)` AFTER `resetRuntime` (so `/resume` restores the banner). (c) `src/filter.ts` `contextHandler` calls `reconcileBanner(ctx)` at the **tail** (after `rt.lastFiltered = ...`, before `return { messages }`) — defense-in-depth: catches checkpoint consumption (a rewind retires the label) and any state change the command hooks missed. Wrap in its own try/catch (E13 — a banner failure must never break a context fire). This is the ONE filter.ts edit.
- **Subtask P2.M3.T1.S4 — Tests for the banner** (`test/banner.test.ts`, new; + `test/filter.test.ts` regression). Assert: after a set, `setWidget` called with the warning line + `placement:"aboveEditor"`; after revoke (or consumption via a rewind), `setWidget` called with `undefined` within one fire; `config.ui.activeCheckpointBanner=false` → `setWidget(key, undefined)` even with an active checkpoint; `ctx.hasUI=false` → no `setWidget` call; the banner string is NEVER present in the filtered `messages` array (assert 0 occurrences of `"mulligan:active-checkpoint"` in `contextHandler`'s return). A filter.test.ts regression: adding a `reconcileBanner(ctx)` call at the contextHandler tail does not change the filtered message list (it's a UI-only side effect). All green.

---

## Phase 3 — Sync changeset-level documentation (Mode B)

**Scope:** the README has cross-cutting references to the v1.0 surface that this delta invalidates. One sweep. (The spec files `spec/01–13` are already at v1.1 from commit `57a5e1f9` — **no spec edits needed**.) Depends on all of Phases 1 + 2.

### Milestone P3.M1 — README sweep

#### Task P3.M1.T1 — Update README to v1.1
- **Subtask P3.M1.T1.S1 — README.md.** (a) §"five agent-callable tools" → "four agent-callable tools" (line ~129); drop `mulligan_checkpoint` from the tool list (lines ~169–173) — note it is now `/mulligan_checkpoint`, a human command. (b) Remove the `to_previous_prompt` blurb (line ~149) entirely; replace with a one-line guardrail note: "`last_turn` keeps your latest message; to rewind further (across your own subsequent prompts), set a checkpoint first." (c) Update the "disabled" section (line ~123): the master switch now also gates the human commands; the agent tool list drops checkpoint (4 tools). (d) Add a new short subsection "### Human commands (v1.1)" listing `/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit` + the active-checkpoint banner — one line each, citing that checkpoints grant the agent cross-prompt rewind power for their lifetime. (e) The "Mulligan adds no human-facing command" sentence (line ~228) is now FALSE — replace with the narrow-surface framing ("Mulligan adds three narrow human commands — checkpoint set/revoke (the destructive cross-prompt power belongs to the user) and audit (the bloat diagnostic a human monitors); `/tree` remains the audit trail."). (f) Drift-nudge token example (line ~225) stays (text unchanged in v1.1); optionally add a note that user prompts are exempt from the delta. (g) Grep README for `checkpoint`, `to_previous_prompt`, `five`, `5 agent`, `no human-facing` — confirm no stale references. **No other docs** (spec is done; JSDoc was Mode A per-task above).

---

## Definition of done

1. All Tier-1 + integration tests green (`npm test`); the suite grew by the new command/banner/agent-delta tests and shrank by the removed `to_previous_prompt`/checkpoint-tool cases.
2. `mulligan_checkpoint` is **not** a registered agent tool; `mulligan_rewind(granularity:"checkpoint")` still works (rewinds to a user-set checkpoint).
3. `to_previous_prompt` is gone from `RewindParams`, `resolveLastTurn`, and every test; `last_turn` provably never hides a `user` message.
4. `/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit` are registered and human-invocable; `/mulligan_audit`'s output never enters `event.messages`.
5. The active-checkpoint banner shows while ≥1 checkpoint is active, clears on revoke/consumption/zero, restores on `/resume`, and is never in the filtered view.
6. The drift `deltaTokens` excludes `user` messages (F-drift-userexempt passes); the high-water signal still measures total.
7. `config.ui.activeCheckpointBanner` defaults `true` and is validated.
8. README reflects 4 tools, the 3 human commands, the banner, and the guardrail; no stale `to_previous_prompt`/"five tools"/"no human command" references.

## Notes for the breakdown agent

- **`index.ts` is touched by P1.M3.T1.S1 (unregister tool), P2.M1.T1.S2 + P2.M2.T1.S2 (register 3 commands), P2.M3.T1.S3 (session_start banner).** Sequence these so the file is edited coherently; the dependency graph is P1.M3 → P2.M1/P2.M2 → P2.M3 (banner hooks depend on commands existing for the reconcile-call sites, though `reconcileBanner` itself only needs `ctx`).
- **`src/tools/checkpoint.ts` lifecycle:** Phase 1 leaves it as unregistered dead code (exports still used by tests); Phase 2 extracts `validCheckpointName`/`NAME_RE` into `commands.ts` (or a shared util) and then the agent-tool file + `test/tools/checkpoint.test.ts` can be deleted. Decide extraction-vs-reexport in P2.M1.T1.S1.
- **`reconcileBanner` placement:** a new `src/banner.ts` is cleaner than overloading `commands.ts`, but either is acceptable — pick one and keep `reconcileBanner` the single writer of the `"mulligan:active-checkpoint"` widget key.
- **No spec-file edits** — `spec/01–13` + `SPEC.md` are already v1.1 (commit `57a5e1f9`). All Mode A docs are JSDoc/description strings riding with the code; Mode B is the README sweep only.
- **Backward-compat:** old persisted markers carrying `options.to_previous_prompt` are read harmlessly (field stays optional; resolver ignores it). No migration. Old `mulligan:checkpoint:` labels set by the v1.0 agent tool still work as rewind targets under v1.1 (the label mechanism is unchanged).