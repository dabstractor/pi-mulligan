# P1.M2.T1.S3 — Research Summary

## Item
Tests for shrink echo + config validation (test-only). Consumes S1 (config knob, COMPLETE) + S2
(terse result + ctx.ui.notify echo, IMPLEMENTING in parallel).

## Verified current state (read directly from repo @ HEAD)

### src/config.ts — S1 COMPLETE ✅
- L73: `notifyMaxChars: number;` (MulliganConfig.shrink interface, required)
- L146: `notifyMaxChars: 2048,` (DEFAULT_CONFIG.shrink)
- L270-271: validation —
  `v = safeGet(shrinkRaw, "notifyMaxChars");`
  `if (v !== undefined) cfg.shrink.notifyMaxChars = coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true);`
  (mustBePositive:true → 0 / -1 / NaN / non-numeric → default + warn, identical to maxActive/staleAfterFires)

### src/tools/shrink.ts — S2 NOT YET LANDED (mid-flight) ⏳
- L143-146: feedbackText STILL verbose: `Mulligan: shrink recorded. Matched message will show the
  replacement from the next turn on. (Matched now: yes|no)` — S2 will make it terse.
- No `ctx.ui.notify`, no `cap`, no `describeTarget` helpers yet — S2 adds them.
- L298: `content: [{ type: "text", text: feedbackText(matched) }]` (return point, unchanged).
- PRP treats S2 contract as target state (terse result + notify echo wrapped in try/catch E13).

### test/tools/shrink.test.ts — makeCtx ALREADY S2-READY ✅ (L76-112)
makeCtx returns `{ ctx, notifyCalls }` (ADDITIVE — `const {ctx} = makeCtx()` still works):
- `hasUI?: boolean` opt (default true) — L78-79
- `notifyCalls: { message: string; type?: string }[] = []` — L86
- `ctx.hasUI = opts.hasUI ?? true` — L103
- `ctx.ui.notify(message, type) { notifyCalls.push({message, type}); }` — L104-106
- `return { ctx, notifyCalls };` — L110
BUT the 11 verbose-text assertions are STILL VERBOSE (L268/288-289/324/336/347/430/449/462/471/492/513).
**S2 fixes those 11; S3 does NOT touch them** — S3 only ADDS a new describe block.

### test/config.test.ts — S1 already baked notifyMaxChars:2048 into toEqual snapshots ✅
(DEFAULT_CONFIG block, "applies a full valid override", "ignores unknown keys", maxActive block b/d/h).
S3 does NOT touch those — it ADDS a dedicated `shrink.notifyMaxChars` validation describe block,
verbatim-modeled on the existing `shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)`
block (tests a-h + type, incl. the per-value invalid loop with console.warn spy).

## Test helpers (shrink.test.ts, module-scoped) — QUOTED for copy-paste
- `makePi({throwOnAppend?})` → `{appended:[{customType,data}], pi}`
- `makeCtx({sessionId?,leafId?,contextEntries?,throwOnGetSessionId?,throwOnGetLeafId?,throwOnBuildContextEntries?,hasUI?})`
  → `{ctx, notifyCalls}` (notifyCalls captured from ctx.ui.notify)
- `run(pi, ctx, params, toolCallId="call-1")` → `await tool.execute(toolCallId, params, undefined, undefined, ctx)`
- `firstText(res)` → `res.content[0].text`
- `msgEntry(role, extra)` → `{type:"message", id, parentId:null, timestamp:"", message:{role,...extra}}`
- `toolResult(toolCallId, toolName, text)` → `{role:"toolResult", toolCallId, toolName, content:[{type:"text",text}]}`
- beforeEach/afterEach → `clearAll()` (resets runtime; config default notifyMaxChars=2048 applies; NO shrink.test.ts
  test overrides notifyMaxChars, so default 2048 holds throughout).

## matched:yes by_tool_call_id setup (the template — L279-289)
```
const { appended, pi } = makePi();
const { ctx } = makeCtx({ leafId:"leaf-9", contextEntries:[ msgEntry("toolResult", toolResult("call-A","read","big log...")) ] });
const target = { by_tool_call_id: "call-A" };
const res = await run(pi, ctx, { target, replacement });
```

## S2 contract facts S3 asserts against (target state once S2 lands)
- Terse result: `Mulligan: shrink recorded. Matched: yes.` (yes) / `... Matched: no.` (no). Replacement NOT in result.
- Notify msg: `Shrunk ${describeTarget(target)} — replacement:\n<<<\n${cap(replacement, cfg.shrink.notifyMaxChars)}\n>>>`
  type `"info"`; ONLY when `ctx.hasUI`.
- `cap(s,max)`: s.length<=max → s; else `s.slice(0,max) + "…(N chars total)"` (N=s.length; U+2026 ellipsis).
- notify wrapped in try/catch (E13) — a ui throw must not crash the tool.

## Validation commands (verified in package.json)
- `npm test` → `vitest run` (full suite)
- targeted: `npx vitest run test/tools/shrink.test.ts test/config.test.ts`
- `npm run typecheck` → `tsc --noEmit`

## External research
None needed — vitest patterns + TypeBox + Pi extension API are all demonstrated in-file. No new libraries.