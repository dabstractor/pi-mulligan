# External Dependencies & API Surfaces (pi-mulligan bugfix 001)

No new third-party dependencies are introduced by this changeset. Everything rides on the existing
peer deps (`@earendil-works/pi-coding-agent` 0.84.1, `typebox` 1.3.11, vitest 1, TS 5) and Node ≥22
built-ins. The relevant "external" surfaces are the **Pi extension API** and the **pi CLI**, both already
proven in this codebase — reuse them exactly as existing code does.

## Pi extension API (in-process, via `src/index.ts` extension entry)

| Surface | Where proven in this repo | Notes for this changeset |
|---|---|---|
| `pi.registerTool(tool)` | src/index.ts:53–56 | Tool registration is pinned at exactly 4 by test/index.test.ts:74 — BUG-003's F-ckptcmd asserts `mulligan_checkpoint` is NOT among them; do not add tools. |
| `pi.registerCommand(name, {description, handler(args, ctx)})` | src/index.ts:62–64 | Slash commands are dispatchable end-to-end by passing `"/mulligan_checkpoint x"` as a `-p` prompt (Pi intercepts the leading `/`; deterministic, no model call). This is the cheapest F-ckptcmd/F-banner/F-useraudit driver. |
| `pi.setLabel(entryId, label?)` / `ctx.sessionManager.getLabel(id)` | src/markers.ts:456–490 (setCheckpoint), src/commands.ts:78–127 (clearCheckpointByName) | Checkpoints ARE labels (`mulligan:checkpoint:<name>`), latest-wins on read; `undefined` clears. `labelActive(entries,label)` in run-smoke.mjs:177 already mirrors this for assertions. |
| `ctx.ui.setWidget(key, lines, {placement})` / `ctx.ui.notify(msg, level)` | src/banner.ts:69, src/commands.ts | `hasUI === false` in `pi -p` headless mode: `reconcileBanner` no-ops (branch a) and `/mulligan_audit` early-returns. F-banner/F-useraudit must therefore assert via smoke-log observables + session JSONL, not by observing widget/notify output directly. |
| `ctx.sessionManager.getEntries()/getBranch()` | everywhere (markers.ts, rewind.ts) | The durable channel; rewind marker `data.note` holds the raw NoteInput — no new state store needed for BUG-002. |
| `context` event (`event.messages`, filter pipeline) | src/filter.ts; smoke.ts context handler | smoke.ts observer logs `context.fire` observables and MUST keep returning void (never override the filter). Extend the log line, never the mutation surface. |
| `ctx.getContextUsage()` | src/tools/audit.ts, rewind.ts step 4c | Exposes the model's context window — needed by F-drift-userexempt to size a paste that provably crosses `highWaterFraction` (0.7). |
| `getRuntime(sessionId)` (module-scoped `SessionRuntime`) | src/runtime.ts:112 | In-memory latch `aboveHighWater` (nudges.ts:497) is readable cross-extension since smoke.ts already imports from `src/` — the honest way to observe the high-water edge signal headless. |

## pi CLI (integration harness, `test/integration/run-smoke.mjs`)

- `spawnSync("pi", ["-ne","-e","./src/index.ts","-e","./test/integration/smoke.ts","--session-id",…,"-p",…])`,
  timeout 120 s, env `MULLIGAN_SMOKE_LOG=<tmp>/mulligan-smoke/<scenario>.log`.
- `-ne` disables extension discovery so a **globally-installed older mulligan build cannot collide**
  (this collision was observed live during the hunt — the v1.x prescribing nudge string exists only in
  `/home/dustin/projects/pi-mulligan/src/notes.ts:337`, zero matches in this worktree). Never drop `-ne`.
- `-e` load ORDER is load-bearing: src/index.ts first (the filter), smoke.ts second (post-filter observer).
- `--session-id` reuse across two spawns within one run is the established /resume-and-reload pattern
  (F-reload, E11) — reuse it for F-banner's `/resume` restore assertion.
- Large `-p` payloads: a ~50k-token paste is ~200 KB of argv — comfortably under Linux ARG_MAX (~2 MB);
  feasible to inject the user paste directly as a prompt. Size it off `getContextUsage().contextWindow`
  (target ≥0.75×window) so the high-water crossing is provable across providers.

## Gates (unchanged commands)

- `npm test` — vitest unit suite (1104 tests / 25 files; will grow with BUG-002 tests).
- `npx tsc --noEmit` — must stay clean.
- `npm run smoke` — real-`pi -p` suite; expect 14 → 19 scenarios after BUG-003.