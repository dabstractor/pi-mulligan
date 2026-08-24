# Research notes — P1.M2.T4.S1 (F-useraudit)

## Production surfaces (READ-ONLY)
- `makeAuditCommand` (src/commands.ts:262-360): factory `(pi) => {description, handler(args, ctx)}`. Handler order: `getConfig().enabled` gate → **`if (!ctx.hasUI) return;`** (headless early return) → `getRuntime(sessionId)` → filtered view (`rt.lastFiltered` primary, else `buildContextEntries` → `auditEntriesToMessages` → `filterPipeline` w/ getBranch cast, confidence "low") → `estimateTokens` total → top-8 rows → `readMarkers` + `listCheckpoints` → **`renderAuditReport`** (identical call to auditExecute) → **`notify(ctx, report, "info")`** only. Whole body try/catch → notify warning. Never sendMessage/appendEntry. `pi` captured but unused.
- `notify()` (commands.ts:48-50): `if (ctx.hasUI) ctx.ui.notify(msg, type)` — the ONLY sink.
- `auditTool` (src/tools/audit.ts:706-711): PLAIN `export const` (no factory) — call `auditTool.execute(toolCallId, {top}, undefined, undefined, ctx)` directly; smoke.ts:359 (E12) is the in-file precedent. execute: same steps as the command; never throws; returns `{content:[{type:"text",text:report}], details}`.

## Harness facts
- run-smoke.mjs: SCENARIOS :30-44 (now incl. F-ckptcmd, F-banner; F-consent landing per P1.M2.T3.S1); ASSERTERS :652-666; `runPi(scenario,{prompts})` :62-96 (custom prompt flows proven by F-banner/F-consent branches ~:736); helpers `parseSmokeLog` :103, `readSessionEntries` :127, `assert` :142, `countCustom` :150, `countCustomMessage` :159, `assertGlobalInvariants` :204. assertCkptcmd :418-464 is the closest asserter template (JSONL-based, hard-fail-on-missing-JSONL deviation).
- smoke.ts: `smokeLog` :79 (never-throwing JSONL appender), `resultText` :91, driveScenario switch — F-ckptcmd case :404, F-banner case :411 (both no-op cases; F-useraudit's case is the first that actively drives BOTH a tool and a command handler). `auditTool` already imported :41; `makeAuditCommand` must be added to the commands.js import. `ctx` is the real ExtensionCommandContext; `pi` in scope.

## Key design conclusions (baked into the PRP)
1. Headless `pi -p` ⇒ `ctx.hasUI === false` ⇒ raw command handler early-returns; the harness MUST wrap: `{...ctx, hasUI:true, ui:{notify:capture}}` with the REAL sessionManager.
2. Parity: both consumers share runtime cache (`rt.lastFiltered`) / identical fallback pipeline on the same ctx ⇒ identical `renderAuditReport` output; compare NORMALIZED (trim, drop rule lines, filter any volatile lines discovered in the actual log) with a non-vacuity length guard.
3. Zero-writes proof: this scenario creates no markers at all → `countCustom` totals === 0; plus grep the JSONL for a distinctive report fragment (title line — verify from the actual rendered report during implementation).
4. Prompt 2 of the 3-prompt flow (`-p /mulligan_audit`) exercises the REAL headless dispatch (early return, no throw) through index.ts's `pi.registerCommand("mulligan_audit", ...)`.