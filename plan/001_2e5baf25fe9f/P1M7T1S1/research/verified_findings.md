# Verified Findings — P1.M7.T1.S1 (index.ts factory wiring)

All findings below were verified LIVE against the shipped source + the installed Pi 0.84.1 type
definitions. This is a wiring task: replace the no-op `src/index.ts` stub with the complete factory.
The stub currently does `pi.on("session_start", () => {})` (a no-op). This task replaces it.

## 1. THE critical gotcha — tool export shapes (CONTRACT vs REALITY mismatch)

The work-item contract's LOGIC step (3) writes the wiring as if all four tools are plain consts:
```
pi.registerTool(rewindTool); pi.registerTool(shrinkTool); pi.registerTool(checkpointTool); pi.registerTool(auditTool);
```
**This is WRONG for the first three.** Verified against the shipped source:

| Tool module    | ACTUAL export                                            | Shape        | How index.ts registers it      |
|----------------|----------------------------------------------------------|--------------|--------------------------------|
| tools/rewind.ts    | `export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<...>`     | **FACTORY**  | `pi.registerTool(makeRewindTool(pi));`  |
| tools/shrink.ts    | `export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<...>`     | **FACTORY**  | `pi.registerTool(makeShrinkTool(pi));`  |
| tools/checkpoint.ts| `export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<...>` | **FACTORY**  | `pi.registerTool(makeCheckpointTool(pi));` |
| tools/audit.ts     | `export const auditTool: ToolDefinition<...>`                               | PLAIN const  | `pi.registerTool(auditTool);`           |

WHY the split: rewind/shrink/checkpoint each call `appendRewindMarker(pi, ctx, …)` /
`appendShrinkMarker(pi, ctx, …)` / `setCheckpoint(pi, ctx, …)` / `leaveNote(pi, …)` — all of which need
`pi` (the ExtensionAPI) at execute time, but `execute()` does NOT receive `pi`. So they capture `pi`
via a closure at construction (`makeXxxTool(pi)`). audit.ts needs NO `pi` (every read goes through `ctx`
or a pure helper) → it is a plain `export const`. The JSDocs in EACH tool file state this verbatim:
"index.ts (P1.M7.T1.S1) will do: `pi.registerTool(makeRewindTool(pi));`" / "index.ts does:
`pi.registerTool(auditTool);` (NO factory call — unlike makeCheckpointTool/makeRewindTool/makeShrinkTool
which capture pi)".

**If the implementer follows the contract's literal variable names (`rewindTool`, `shrinkTool`,
`checkpointTool`), the import will FAIL to resolve (those names are not exported) → load error. The
implementer MUST use the `makeXxxTool(pi)` factory calls + the `auditTool` plain const.**

Verified grep:
```
src/tools/rewind.ts:402:    export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails>
src/tools/shrink.ts:280:    export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails>
src/tools/checkpoint.ts:166:export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<typeof CheckpointParams, CheckpointDetails>
src/tools/audit.ts:593:     export const auditTool: ToolDefinition<typeof AuditParams, AuditDetails>
```

## 2. Config loading — NO Pi settings accessor exists (v1 = defaults)

Verified: `grep -rn "settings" dist/core/extensions/types.d.ts` for ExtensionAPI/ExtensionContext returns
NO settings accessor. The ExtensionAPI surface (verified, §2.1 of api_verification.md) is: `on`,
`registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `getFlag`,
`registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`, `sendMessage`,
`sendUserMessage`, `appendEntry`, `setSessionName`, `getSessionName`, `setLabel`, `exec`, etc. NONE of
these read Pi `settings.json`. spec/09 §1 says "the merged Pi settings object. Mulligan reads
`settings.mulligan`" — but the API to read it is NOT exposed to extensions in v1.

THEREFORE v1 config loading (per the work-item contract: "for v1, accept config via a setConfig call or
read defaults") = `setConfig(undefined)`. config.ts `setConfig(raw: unknown)` → `validateConfig(undefined)`
→ returns validated `structuredClone(DEFAULT_CONFIG)` → caches it. This eagerly initializes the session
cache at factory time (satisfies "Config is loaded at factory time and cached"). `getConfig()` is ALSO
lazy (loads defaults on first call if cache empty), so even omitting `setConfig` would work — but calling
`setConfig(undefined)` at factory time is explicit and matches the contract. setConfig NEVER throws
(whole body try/catch → defaults). Reading real `settings.mulligan` is deferred to a future version (v1.1
per spec/09 §5 reserves env overrides).

IMPORT SIGNATURES (config.ts):
- `export function setConfig(raw: unknown): void` — init/replace session cache. Never throws.
- `export function getConfig(): MulliganConfig` — returns a fresh structuredClone of the cached config.
  Needed to read `config.log.file` for `setLogFile`. Returns `MulliganConfig { log: { file: string|null } }`.

## 3. setLogFile — needs getConfig() first; ordering matters

log.ts `export function setLogFile(path: string | null): void` — assigns the module-level `logFile`.
Called as `setLogFile(getConfig().log.file)`. MUST run AFTER `setConfig` (so the cache is populated with
the config carrying the log path). log.ts is Pi-free AND config-free (it holds its own `logFile`
destination precisely to break the config↔log cycle — see log.ts header comment: "index.ts (P1.M7.T1)
calls setLogFile(getConfig().log.file) after config load"). `setLogFile(null)` = logging off (default).
Assigning a string cannot throw.

## 4. Handler registrations — exact signatures (all take `pi: ExtensionAPI`, all sync)

Verified exports + the EXACT one-liner each register* performs (so index.ts is a thin delegation):

- filter.ts:    `export function registerFilterHandler(pi: ExtensionAPI): void` → body: `pi.on("context", contextHandler);`
- nudges.ts:    `export function registerBloatReminder(pi: ExtensionAPI): void` → body: `pi.on("tool_result", bloatReminderHandler);`
- nudges.ts:    `export function registerTurnEndMetric(pi: ExtensionAPI): void` → body: `pi.on("turn_end", (event, ctx) => {...});`

All three are sync `void` functions that capture `pi` and call `pi.on(...)`. index.ts just calls each
once: `registerFilterHandler(pi); registerBloatReminder(pi); registerTurnEndMetric(pi);`. The fail-open
try/catch lives INSIDE each handler (contextHandler, bloatReminderHandler, turnEndMetricHandler), NOT in
index.ts — design principle #4 is already honored at the handler layer.

## 5. session_start / session_shutdown — exact signatures

ExtensionAPI `on()` overloads (verified dist/core/extensions/types.d.ts):
```
on(event: "session_start",   handler: ExtensionHandler<SessionStartEvent>): void;
on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
```
So handlers are `(event, ctx) => ...`, may be sync or async. index.ts uses SYNC handlers (no async work).

- session_start:   `pi.on("session_start", (_event, ctx) => { resetRuntime(ctx.sessionManager.getSessionId()); });`
  - `ctx.sessionManager.getSessionId()` is on ReadonlySessionManager (api_verification §4 — verified
    present). Returns a string. resetRuntime clears this session's runtime entry so a resumed/reloaded
    session starts clean (seq 0, null baseline, empty bloat hits). resetRuntime never throws.
  - The event has `{ type: "session_start"; reason: "startup"|"reload"|"new"|"resume"|"fork" }`. We do
    NOT branch on reason — every session_start resets the runtime (the runtime is per-sessionId; a fresh
    session gets a fresh runtime; a resumed session clears any stale in-memory state, which is correct
    since the persisted markers ARE the source of truth, not the runtime).
  - NOTE: `resetRuntime` uses the ctx sessionId, NOT a constant. We MUST read it from ctx each fire (C12:
    never cache a sessionManager handle). We DO cache nothing here — just read getSessionId() inline.

- session_shutdown: `pi.on("session_shutdown", () => { clearAll(); });`
  - `clearAll()` wipes ALL per-session runtimes (process teardown). Never throws. The event/ctx args are
    unused → omit them from the arrow (cleaner) or name them `_event`/`_ctx`. session_shutdown fires on
    quit/reload/new/resume/fork (reason field). We wipe everything regardless — correct for a full teardown.

## 6. Factory shape — SYNC, not wrapped in try/catch (fail-FAST on wiring errors)

- The factory MAY be async (spec/01 §1: "A factory MAY be async; if so, Pi awaits it before startup").
  But there is NO async work here (setConfig/setLogFile/registerTool/pi.on are all sync). ⟹ SYNC factory:
  `export default function (pi: ExtensionAPI): void { ... }`. Async would add nothing.
- spec/01 §1 constraint (verified): "Do not start long-lived resources (timers, sockets, watchers) from
  the factory — defer to session_start and tear down in session_shutdown. (Mulligan has no long-lived
  resources.)" ⟹ the factory body does NOT set timers/watchers. Mulligan has none. ✓ satisfied.
- DO NOT wrap the factory body in try/catch. Rationale: the factory runs ONCE at load. The operations are
  all safe (setConfig never throws; setLogFile assigns a string; registerTool/pi.on are framework calls).
  If a REAL wiring bug exists (a bad import — e.g. importing the non-existent `rewindTool` instead of
  `makeRewindTool`), we WANT it to surface as a load error (`pi -e ./src/index.ts -p hi` exits non-zero),
  not be silently swallowed. Fail-open (spec/03 #4) applies to HANDLERS (which fire during agent turns);
  the individual handlers already wrap themselves. The factory is bootstrap → fail fast.
- The default export is the factory. tsconfig has no special config for it; `main: "src/index.ts"` +
  `pi: { extensions: ["./src/index.ts"] }` in package.json point Pi at this file (verified).

## 7. Import conventions (verified across all src/*.ts)

- Source files import siblings with `.js` extensions (ESM Bundler resolution): e.g. filter.ts does
  `import { getConfig } from "./config.js";`. index.ts MUST follow: `./config.js`, `./log.js`,
  `./runtime.js`, `./filter.js`, `./nudges.js`, `./tools/rewind.js`, `./tools/shrink.js`,
  `./tools/checkpoint.js`, `./tools/audit.js`.
- `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";` (type-only — the existing stub
  already does this). Keep it type-only (the runtime value is passed IN as `pi`).
- The factory param is named `pi: ExtensionAPI` (convention — spec/01 §1, all tool/filter/nudge JSDocs).

## 8. Verification — the smoke command WORKS (verified against the current stub)

```
$ timeout 60 pi -e ./src/index.ts -p "hi"
Hi! How can I help you today? ...
EXIT: 0
```
- `pi --extension, -e <path>` loads an extension file (verified `pi --help`).
- `pi --print, -p <prompt>` is non-interactive (process prompt and exit).
- The contract's verification gate `pi -e ./src/index.ts -p 'hi'` loads the factory, transpiles via jiti,
  runs a one-shot prompt, exits 0. A load error (bad import / throw) → non-zero exit + stderr. This is the
  PRIMARY end-to-end gate for this task. (It requires a model/API key to fully answer, but a LOAD error
  fails BEFORE any model call — so "loads without error" is verifiable even without a working API key if
  the failure is a wiring/import error. In this env it answered fully → key is present.)

## 9. Test approach — extend the fakePi pattern to capture registerTool too

There is NO existing `test/index.test.ts` (verified: test/ has 16 .test.ts files, none for index). The
established fakePi helper (test/filter.test.ts:96, test/nudges.test.ts:37) captures `.on` registrations
into a `handlers` record. For index.ts we need a fakePi that ALSO captures `.registerTool` calls (into a
`tools` array) so we can assert: 4 tools registered (mulligan_rewind, mulligan_shrink,
mulligan_checkpoint, mulligan_audit); 5 handlers armed (context, tool_result, turn_end, session_start,
session_shutdown). Then assert the session_start handler, when called with a fake ctx, calls
resetRuntime(sessionId) — verifiable via getRuntime(sessionId) returning a FRESH runtime (seq 0) after a
mutation. And session_shutdown → clearAll (getRuntime returns fresh after clearAll).

IMPORTANT test hygiene: index.ts calls `setConfig(undefined)` at module load (factory call) and
`setLogFile(getConfig().log.file)` (null by default). The existing config.test.ts / log.test.ts reset
these in beforeEach. The index.test.ts SHOULD be isolated: call the factory in the test (not at import
time), and reset runtime via clearAll() in beforeEach. Since setConfig(undefined) → defaults is safe and
setLogFile(null) → off is safe, no teardown is strictly needed, but clearAll() in beforeEach is good
hygiene (runtime.ts is module-scoped).

## 10. Baseline state — PARALLEL PREDECESSOR P1.M6.T2.S2 is mid-flight (will be green when this runs)

Verified CURRENT baseline: `npx tsc --noEmit` reports 2 errors in test/filter.test.ts (it imports
`shouldNudge`/`injectNudge` from filter.js, which P1.M6.T2.S2 is REMOVING from filter.ts and MOVING to
nudges.ts). `npx vitest run` → 3 failed | 589 passed. This is the IN-FLIGHT state of the parallel
P1.M6.T2.S2 implementation. **When THIS PRP (P1.M7.T1.S1) runs, P1.M6.T2.S2 will be COMPLETE** →
`npx tsc --noEmit` exit 0; `npx vitest run` → all green (15+ files, 592+ tests). The index.ts wiring does
NOT touch filter.ts/test, so it composes cleanly on top of the complete P1.M6.T2.S2 output. THIS PRP's
baseline assertion is the post-P1.M6.T2.S2 all-green state.

## 11. Anti-scope — what index.ts does NOT do

- Does NOT read Pi settings.json from disk (no settings accessor; deferred to v1.1 — GOTCHA).
- Does NOT branch on session_start `reason` (always resets runtime).
- Does NOT call pi.registerTool with a plain `rewindTool` const (it's `makeRewindTool(pi)` — GOTCHA #1).
- Does NOT wrap the factory body in try/catch (fail-fast on wiring errors; handlers self-protect).
- Does NOT make the factory async (no async work).
- Does NOT start timers/watchers (spec/01 §1; Mulligan has none).
- Does NOT register message/entry renderers (audit tool returns text; no custom UI surface in v1).
- Does NOT call registerCommand/registerShortcut/registerFlag (Mulligan adds no CLI surface in v1).
- Does NOT re-read config on session_start (config is loaded once at factory time; session_start resets
  RUNTIME only — per the contract "session_start reinitializes runtime").