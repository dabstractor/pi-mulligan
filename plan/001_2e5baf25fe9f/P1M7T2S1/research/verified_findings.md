# P1.M7.T2.S1 — Verified Research Findings

> Source: Pi `0.84.x` installed at `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/`,
> the mulligan source (`src/`), `spec/10-testing.md`, `spec/reference/looper-smoke.proto.ts`,
> and the parallel-predecessor PRP `plan/001_2e5baf25fe9f/P1M7T1S1/PRP.md`.
> Every claim below is verified against the installed .js/.d.ts unless marked *[spec]*.

---

## 1. THE CRUX — context handlers CHAIN across extensions, in `-e` flag order

`dist/core/extensions/runner.js` `emitContext(messages)` (verified, lines ~749–772):

```js
async emitContext(messages) {
    const ctx = this.createContext();
    let currentMessages = structuredClone(messages);
    for (const ext of this.extensions) {                 // iterate extensions IN ORDER
        const handlers = ext.handlers.get("context");
        if (!handlers || handlers.length === 0) continue;
        for (const handler of handlers) {                // iterate handlers within each extension
            const event = { type: "context", messages: currentMessages };
            const handlerResult = await handler(event, ctx);
            if (handlerResult && handlerResult.messages) {
                currentMessages = handlerResult.messages;   // CHAINED → next handler sees transformed
            }
        }
    }
    return currentMessages;   // what the model actually sees
}
```

**Implications (the entire harness architecture rests on these):**

- Each handler receives `event.messages = currentMessages` — a deep clone of the original, then
  transformed by every PRIOR handler. A handler returning `void`/`undefined` does NOT update
  `currentMessages` (only `handlerResult && handlerResult.messages` does).
- **Load order**: mulligan FIRST (`-e ./src/index.ts`), smoke helper SECOND
  (`-e ./test/integration/smoke.ts`). Mulligan's `contextHandler` runs first and returns
  `{messages: filtered}`; the smoke helper's context handler runs second and sees the
  **POST-filter** messages → it can observe `canaryPresent=false` after a rewind. ✅
- The smoke helper MUST return `void` (pure observer) so it does NOT override mulligan's filtered set.
  Returning `{messages}` would REPLACE mulligan's output (last writer wins).

## 2. Extension load order = `-e` flag order (confirmed end-to-end)

- `dist/cli/args.js` line 120–122: `-e <path>` → `result.extensions.push(args[++i])` — **flag order preserved**.
- `dist/core/extensions/loader.js` `loadFromPaths(paths)` (~line 432): `for (const extPath of paths) { … extensions.push(extension) }` — order preserved.
- `dist/core/extensions/runner.js` constructor (~line 151): `this.extensions = extensions`.
- `emitContext` / `emitToolResult` / `emitTurnEnd` all iterate `this.extensions` in that order.
- Help text (args.js:268): `--extension, -e <path>  Load an extension file (can be used multiple times)`.
- **CONCLUSION**: `pi -e ./src/index.ts -e ./test/integration/smoke.ts` guarantees mulligan's handlers
  fire before smoke's, for context/tool_result/turn_end. ✅

## 3. Print mode (`pi -p`) PERSISTS the session JSONL to disk

- `dist/core/session-manager.js` line 1182: `SessionManager.create(cwd, sessionDir)` →
  `new SessionManager(cwd, dir, undefined, true, …)` → **`persist = true`**.
- Session file path (line 667): `join(getSessionDir(), \`${fileTimestamp}_${sessionId}.jsonl\`)`.
- Session dir encoding (line 242–246): `getDefaultSessionDirPath(cwd)` →
  `~/.pi/agent/sessions/--<cwd-with-/\\-replaced-by-dash>--/` (leading slash stripped, `/:\\` → `-`).
- **CONCLUSION**: every `pi -p "…"` run writes a `.jsonl` session file → JSONL assertions work, and
  F-reload can re-open a known session. ✅
- The smoke helper can read the live path via `ctx.sessionManager.getSessionFile()` (ReadonlySessionManager
  has `getSessionFile` — api_verification §4 Pick list) and log it so the runner can find the file.

## 4. `--session-id <id>` — create with EXACT id if missing (F-reload)

- args.js:67–69: `--session-id <id>` → `result.sessionId = args[++i]`.
- Help (args.js:254): `Use exact project session ID, creating it if missing`.
- **F-reload recipe**: run 1 with `--session-id SMOKE-RELOAD` (creates + persists markers); run 2 with
  the SAME `--session-id SMOKE-RELOAD` (re-opens) → markers survive → filter still hides canary. ✅

## 5. `pi -p "/cmd args"` DISPATCHES the extension command (no model call) — the spike's trick

`dist/core/agent-session.js` `_tryExecuteExtensionCommand(text)` (verified, lines 922–949):

```js
async _tryExecuteExtensionCommand(text) {
    const spaceIndex = text.indexOf(" ");
    const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
    const command = this._extensionRunner.getCommand(commandName);
    if (!command) return false;
    const ctx = this._extensionRunner.createCommandContext();   // ExtensionCommandContext
    await command.handler(args, ctx);
    return true;   // command ran → prompt is NOT sent to the model
}
```

- Called from `prompt()` when `text.startsWith("/")` (lines 797–802, 987–991, 1004–1008).
- The handler receives `(args: string, ctx: ExtensionCommandContext)`. `ExtensionCommandContext`
  extends `ExtensionContext` with `navigateTree`, `waitForIdle`, `newSession`, `fork`, `reload`,
  `switchSession` (api_verification §3.3) AND has `ctx.sessionManager` (ReadonlySessionManager).
- The command handler closes over `pi` (captured at `pi.registerCommand` time) → it can call
  `pi.appendEntry`, `pi.sendMessage`, `pi.sendUserMessage`, `pi.setLabel`, AND any imported function.
- **CONCLUSION**: `pi -e ./src/index.ts -e ./test/integration/smoke.ts -p "/mulligan_smoke F-protected"`
  dispatches the `mulligan_smoke` command with args `"F-protected"` — a fully deterministic, model-free
  scenario driver. ✅ (This is exactly how the spike's `pi -p "/looper_test"` worked.)

## 6. Deterministic path can call the REAL tool factories (faithful validation)

- The smoke helper imports the factories from the SHARED mulligan modules (same process, Node module cache):
  `import { makeRewindTool } from "../../src/tools/rewind.js"`, etc.
- Calling `makeRewindTool(pi)` returns a `ToolDefinition`; its
  `execute(toolCallId, params, signal, onUpdate, ctx)` can be invoked DIRECTLY with a synthetic
  `toolCallId` (e.g. `"smoke-rewind-1"`) and the command's `ctx`. This runs the REAL tool validation +
  marker persistence — so **F-protected** (tool refuses to rewind first user) and **F-maxdepth** (6th
  rewind refuses) exercise the actual refusal logic, not a reimplementation.
- Marker wrappers (`appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric`, `leaveNote`,
  `setCheckpoint`) from `../../src/markers.js` are also importable for scenarios that need raw marker
  setup without tool-input validation.
- `pi` passed to the smoke factory IS the same runner instance mulligan uses (one ExtensionRunner per session).

## 7. Triggering the OBSERVING inference from a command — `pi.sendUserMessage({deliverAs:"followUp"})`

- The `context` event fires BEFORE an LLM call. A command run that calls `tool.execute()` directly does
  NOT trigger an inference → no context fire → no observable filter effect.
- To observe the filter AFTER a deterministic marker setup, the command triggers a follow-up inference:
  `pi.sendUserMessage("ok", { deliverAs: "followUp" })`. This queues a follow-up user message that
  resumes the agent loop → fires `context` → mulligan filters → smoke logs `context.fire` (canary dropped).
  (This is the spike's proven A6 technique — `deliverAs:"followUp"` from inside a tool/command.)
- The model only has to respond to a trivial `"ok"` → **minimal model dependence** (works with any model,
  no need for instruction-following tool-calling). `[spec 10 §2.2]` anticipated this ("phrase prompts to
  force tool calls" + deterministic fallback); `sendUserMessage` follow-up is the reliable hybrid.
- `sendMessage` is on `ExtensionAPI`; `sendUserMessage` is also on `ExtensionAPI` (api_verification §2).
  Both are available to the command handler via the captured `pi`.

## 8. The Mulligan customTypes + persistence invariants (the JSONL assertions) — verified from src

From `src/markers.ts` + `src/filter.ts` (verified by reading):
- `mulligan:rewind`        → `pi.appendEntry("mulligan:rewind", RewindMarker)`     → **CustomEntry** (`type:"custom"`), NOT in context.
- `mulligan:shrink`        → `pi.appendEntry("mulligan:shrink", ShrinkMarker)`     → **CustomEntry**, NOT in context.
- `mulligan:turn-metric`   → `pi.appendEntry("mulligan:turn-metric", TurnMetric)`   → **CustomEntry**, NOT in context.
- `mulligan:note`          → `pi.sendMessage({customType:"mulligan:note", …})`      → **CustomMessage** (`type:"custom_message"`), IN context.
- `mulligan:checkpoint:<n>`→ `pi.setLabel(leafId, "mulligan:checkpoint:<n>")`       → **LabelEntry** (`type:"label"`), NOT in context.
- `mulligan:nudge`         → constructed INLINE in `filterPipeline`/`injectNudge`; **NEVER persisted** → 0 entries on disk. `[spec 10 §2.3]`
- The filter (`readMarkers` in filter.ts) reads markers by scanning `getEntries()` for
  `type === "custom" && customType.startsWith("mulligan:")` and buckets by `data.kind`.
- **Assertion recipe**: walk the session JSONL (or `ctx.sessionManager.getEntries()`); assert each
  `mulligan:rewind`/`mulligan:shrink`/`mulligan:turn-metric` has `type:"custom"`; each `mulligan:note` has
  `type:"custom_message"`; each checkpoint has `type:"label"` + label prefix; ZERO `mulligan:nudge` entries.

## 9. mulligan's OWN log vs the smoke helper's log

- mulligan `config.log.file` defaults to `null` (OFF). v1 has NO settings accessor
  (P1.M7.T1.S1 GOTCHA #3) → `setConfig(undefined)` at factory time → logging stays off.
- mulligan's `contextHandler` logs `filter.fire` with `{before, after, rewinds, shrinks, hasMetric}`
  (src/filter.ts) — but ONLY if logging is enabled.
- The smoke helper writes its OWN log (e.g. `/tmp/mulligan-smoke.log`, JSONL) — independent of mulligan's
  logger. This is the PRIMARY assertion source (the contract: "a helper extension that logs structured JSONL").
- OPTIONAL (documented, not required): the smoke helper can enable mulligan's own logging by calling
  `setConfig({log:{file:"…"}})` + `setLogFile("…")` from the shared `../../src/config.js` + `../../src/log.js`
  (same process → shared module cache → same `cachedConfig`/`logFile`). This gives a second, corroborating
  source (`filter.fire before/after`). Coupling is mild (public exported functions).

## 10. The canary is scenario-specific (NOT a fixed standalone message)

The real filter removes only the span a rewind TARGETS (last tool-call group / last turn / checkpoint) or
the content a shrink REPLACES — it does NOT drop an arbitrary canary whenever a marker exists (that was
spike-only test behavior). So the canary must be positioned to be affected:
- **F-rewind-core** (`last_tool_call_group`): canary = a big tool RESULT (from a `mulligan_smoke_big` test
  tool) that the rewind removes. `canaryPresent` = any message contains the canary marker string.
- **F-shrink-persist**: canary = a big tool result that `mulligan_shrink` replaces. Assert original still
  on disk (JSONL) + replacement in the filtered view (`shrunkInContext`).
- **F-shrink-preventive**: `mulligan_smoke_big` returns >8KB → mulligan's `tool_result` handler appends the
  `[mulligan]` reminder. Observed in the result content + `turn-metric.bloatHit:true`.
- **F-protected / F-maxdepth / F-checkpoint**: canary = a tool-call group positioned to be rewound; the
  assertion is on the tool's REFUSAL (F-protected, F-maxdepth) or the rewind's reach (F-checkpoint).
- The smoke helper's `context.fire` log computes `{count, canaryPresent, notePresent, hasRewindMarker,
  shrinkCanaryInContext, shrunkInContext}` by scanning `event.messages` (POST-filter) — mirroring the spike.

## 11. Parallel-predecessor contract (P1.M7.T1.S1 — will be COMPLETE when this runs)

- `src/index.ts` becomes the full factory: registers 4 tools (`makeRewindTool(pi)`, `makeShrinkTool(pi)`,
  `makeCheckpointTool(pi)`, `auditTool`), arms 3 handlers (`registerFilterHandler`,
  `registerBloatReminder`, `registerTurnEndMetric`), wires session lifecycle.
- `pi -e ./src/index.ts -p "hi"` loads + exits 0 (verified against current stub).
- `package.json` already has `scripts.smoke` = `pi -e ./src/index.ts -p "$(cat …)"` — a PLACEHOLDER this
  task replaces with a real orchestrator. (P1.M7.T1.S1 treats it as "integration harness — P1.M7.T2".)
- This task does NOT touch src/ — it only CREATES `test/integration/*` and updates the `smoke` script.

## 12. Runner/orchestrator shape (reliable, CI-friendly, no hard API-key dependence)

- `test/integration/run-smoke.mjs` — a plain Node ESM script (no transpile; Node runs it directly).
  - For each F-* scenario, spawns `pi -e ./src/index.ts -e ./test/integration/smoke.ts
    --session-id <stable-id> -p "/mulligan_smoke <scenario>"` (deterministic path).
  - Parses `/tmp/mulligan-smoke.log` (the smoke helper's JSONL) + the session JSONL (path logged by the
    smoke helper at session_start) → asserts the §2.1/§2.3 pass criteria → prints PASS/FAIL per scenario.
  - F-reload = two runs sharing `--session-id`.
  - Exits non-zero if ANY scenario fails.
- Model-driven path (the "real agent" verification for F-rewind-core/F-shrink-persist/F-nudge-drift) is
  DOCUMENTED in `scenarios.md` and runnable via a separate prompt set; it is NOT the default CI gate
  (model unreliability). `npm run smoke` runs the deterministic suite by default.
- `package.json` `scripts.smoke` → `node test/integration/run-smoke.mjs`.