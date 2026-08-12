# Research Notes — P2.M2.T1.S3 (Tests for the `/mulligan_audit` command)

Mode A (test-only). PRP: `../PRP.md`. This file records the research basis so the PRP stays compact.

## 1. What the work item requires (contract, verbatim)

Four test cases, all in `test/commands.test.ts`:
- **(a)** The command handler renders the SAME string `renderAuditReport` produces — build the same args, call both, compare (string equality).
- **(b)** The report is delivered to the human sink — fake `ctx.ui` captures the notify message; assert it contains the report.
- **(c)** Zero writes to `event.messages`-equivalent — assert `pi.sendMessage` / `pi.appendEntry` were NOT called (0 times with the report).
- **(d)** `config.enabled=false` → refuse with `"Mulligan is disabled"`.
DOCS: none (test-only). OUTPUT: `test/commands.test.ts` covers the audit command path.

## 2. The INPUT — `makeAuditCommand` (S1, LANDED in src/commands.ts)

Read directly. Key facts (the test asserts against these):

```
makeAuditCommand(pi: ExtensionAPI) → {
  description: "Run the Mulligan context-bloat diagnostic — see what the model is carrying",
  handler: async (args, ctx) => Promise<void>
}
```

Handler body (whole in try/catch → `notify(ctx, "Mulligan: unexpected error: …", "warning")`):
1. `const config = getConfig(); if (!config.enabled) { notify(ctx, "Mulligan is disabled", "warning"); return; }` — gate FIRST, type **warning**, NO `"Mulligan: "` prefix.
2. `if (!ctx.hasUI) return;` — skip pipeline in print/JSON mode.
3. `sessionId = ctx.sessionManager.getSessionId(); rt = getRuntime(sessionId);`
4. Resolve filtered: `if (Array.isArray(rt.lastFiltered)) { filtered = rt.lastFiltered; confidence = config.audit.estimateConfidence }` else E16 fallback (`buildContextEntries` → `filterPipeline`, confidence `"low"`).
5. `totalTokens = estimateTokens(filtered).tokens` — **NOT** `computeFilteredTotal`.
6. `top = 8; callLookup = buildCallLookup(filtered); rows = filtered.map(m => ({tokens: estimateTokens([m]).tokens, msg: m})).sort((a,b)=>b.tokens-a.tokens).slice(0, top).map(({tokens,msg}) => { toolName = typeof msg.toolName==="string"?msg.toolName:undefined; rowThreshold = bloatThresholdFor(toolName, config); return { tokens, role: typeof msg.role==="string"?msg.role:"?", label: describeMessage(msg, callLookup), bloaty: messageBytes(msg) > rowThreshold, thresholdBytes: rowThreshold }; })`.
7. `markers = readMarkers(ctx); checkpointNames = listCheckpoints(ctx.sessionManager.getEntries());`
8. `report = renderAuditReport({ totalTokens, confidence, rewinds: markers.rewinds, shrinks: markers.shrinks, checkpointNames, protectedRoles: config.rewind.protectedRoles, rows, filtered, cancelledCount: markers.cancelledIds.size });`
9. `notify(ctx, report, "info");` — human sink ONLY; **NEVER** `pi.sendMessage`/`pi.appendEntry`.

**Critical**: `args` IGNORED (future `top` override). `pi` captured-but-UNUSED (every read goes through `ctx` + pure helpers) → case (c) holds trivially.

## 3. The `renderAuditReport` arg shape (VERBATIM — basis of the expected-report builder)

```ts
{ totalTokens: number, confidence: "low"|"medium"|"high",
  rewinds: RewindMarker[], shrinks: ShrinkMarker[],
  checkpointNames: string[], protectedRoles: string[],
  rows: AuditRow[], filtered: unknown[], cancelledCount: number }
// AuditRow = { tokens: number, role: string, label: string, bloaty: boolean, thresholdBytes: number }
```

All re-derivation helpers are EXPORTED and PURE: `renderAuditReport`, `listCheckpoints`, `describeMessage`, `messageBytes`, `buildCallLookup`, `type AuditRow` (from `../src/tools/audit.js`); `estimateTokens` (`tokens.js`); `readMarkers` (`filter.js`); `bloatThresholdFor` (`nudges.js`); `getConfig` (`config.js`).

## 4. The test-file idiom (test/commands.test.ts — THE template)

Already in the file, established by the checkpoint-command tests (P2.M1.T1.S3):
- vitest; **hand-rolled** `makePi()` / `makeCtx()` (**no `vi.fn` for Pi objects** — GOTCHA #3); `.js` import paths.
- File-level `beforeEach`/`afterEach`: `clearAll()` + `setConfig(undefined)` (→ DEFAULT_CONFIG, enabled:true) + `vi.mocked(reconcileBanner).mockClear()`.
- File-scoped `vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }))` at top — **inert for the audit handler** (it never calls `reconcileBanner`).
- Verbatim-string assertions; `expectTypeOf` for the `{ description, handler }` shape.
- Disabled blocks use inline `setConfig({enabled:false})` + `try/finally { setConfig(undefined) }` reset (see the revoke-disabled test).

Existing `makePi()` returns `{ labels, pi }` (setLabel only, + `throwOnSetLabel` opt). Existing `makeCtx()` returns `{ notifies, widgets, ctx }` with `sessionManager.{getBranch, getEntries, getLabel, getLeafId}`.

## 5. NON-BREAKING fake extensions required

The audit handler calls surfaces the current fakes lack:
- `makePi`: add `appendEntry`/`sendMessage` no-op spies (push onto `appended[]`/`sent[]`), return them. (Mirror `test/tools/audit.test.ts` makePi.)
- `makeCtx`: add `sessionId` opt (default `"s1"`) + `contextEntries` opt (default `[]`); expose `sessionManager.getSessionId()` + `buildContextEntries()`. Optionally `throwOnGetSessionId`/`throwOnBuildContext` for the never-throws bonus.

Both are additive (extra keys/methods); the checkpoint tests destructure only what they need → unaffected. **Validation gate**: existing checkpoint tests must stay green.

## 6. Sibling-scope awareness (do NOT cross boundaries)

- **S1** (done): `makeAuditCommand` in `src/commands.ts` — the INPUT.
- **S2** (implementing in parallel): registers the command in `src/index.ts`; patches `test/index.test.ts` command-count assertion 2→3. **S3 does NOT touch index.ts or index.test.ts** — no overlap.
- **P2.M3** (planned): `reconcileBanner` real impl + banner tests. S3's audit section does NOT assert the banner — safe regardless of P2.M3 state.
- **smoke.ts F-useraudit** (planned, separate item): owns the integration human-vs-agent sink divergence. S3 is UNIT-only.

## 7. Test runner / validation (verified from package.json)

- `npm test` = `vitest run`
- `npm run typecheck` = `tsc --noEmit`
- targeted: `npx vitest run test/commands.test.ts -v`
- `prepublishOnly` = `npm run typecheck && npm test`

## 8. Key decisions baked into the PRP

- **Drive case (a) on the PRIMARY (cached) path** — pre-seed `getRuntime("s1").lastFiltered`. This sets `confidence = config.audit.estimateConfidence` and avoids re-running `filterPipeline` (the E16 fallback sets `"low"`), so the expected builder matches without replicating the pipeline.
- **A shared `buildExpectedReport(filtered, ctx)` helper** for cases (a)/(b) — its row loop is byte-identical to the production handler's step 6; case (a) is what catches any drift.
- **Case (c) asserts `appended.length === 0 && sent.length === 0`** — the F-useraudit invariant. Holds because the handler never calls `pi` at all.
- **Disabled gate fires BEFORE `!ctx.hasUI`** — so the disabled notify appears even when `hasUI` is whatever; bonus (e) tests the *enabled* + `hasUI=false` silent early-return instead.
- **Confidence 9/10**: only residual risk is a breaking change to the shared fakes — caught by the "existing checkpoint tests green" gate.