# PRP — P1.M7.T1.S1: Wire all tools, handlers, config, and lifecycle in `index.ts` factory

**Work item:** P1.M7.T1.S1 · **Points:** 1 · **Stage:** Integration, Hardening & Documentation (spec/11
§8 "index.ts wiring"; spec/01 §1 "What an extension is"; spec/03 §4 architecture; spec/09 §1 config
loading). **Scope:** **REPLACE** the no-op `src/index.ts` stub with the complete Pi extension factory
that (1) loads+caches config, (2) sets the log destination, (3) registers all 4 tools, (4) arms all 3
event handlers, and (5)/(6) wires the `session_start`/`session_shutdown` lifecycle. **CREATE** one new
test file `test/index.test.ts`. **No other file is touched.** This is the **extension entry point** —
the single file named in `package.json` (`main: "src/index.ts"`, `pi.extensions: ["./src/index.ts"]`).

> **THIS IS THE FINAL WIRING.** Every upstream module (config, log, runtime, filter, nudges, all 4 tools)
> is COMPLETE per `<plan_status>`. This task is pure delegation: import the ready-made `register*` seams
> and tool definitions, then call each once in the factory. The complexity is all in the GOTCHAS — above
> all, **the tool export shapes** (GOTCHA #1), which the work-item contract gets slightly wrong.

> **CRITICAL CORRECTION TO THE WORK-ITEM CONTRACT (read GOTCHA #1 before coding):** The contract's LOGIC
> step (3) writes `pi.registerTool(rewindTool); pi.registerTool(shrinkTool); pi.registerTool(checkpointTool);
> pi.registerTool(auditTool);` as if all four are plain consts. **They are NOT.** Verified against the
> shipped source: `rewind`/`shrink`/`checkpoint` export **FACTORY FUNCTIONS** (`makeRewindTool(pi)`,
> `makeShrinkTool(pi)`, `makeCheckpointTool(pi)` — they capture `pi` via closure because their `execute()`
> needs `pi` but doesn't receive it as an argument); only `auditTool` is a plain `export const`. The
> import names `rewindTool`/`shrinkTool`/`checkpointTool` DO NOT EXIST and will fail to resolve. Use the
> `makeXxxTool(pi)` factory calls.

> **PARALLEL-PREDECESSOR CONTRACT (P1.M6.T2.S2):** Implementing in parallel. When THIS PRP runs, P1.M6.T2.S2
> is COMPLETE → `npx tsc --noEmit` exit 0, `npx vitest run` all-green (15+ files, 592+ tests). The current
> repo shows 3 failing tests / 2 tsc errors that are P1.M6.T2.S2's in-flight transition (it moves
> shouldNudge/injectNudge from filter.ts to nudges.ts) — **ignore that; it will be green**. THIS task does
> NOT touch filter.ts or its test, so it composes cleanly on top.

---

## Goal

**Feature Goal**: Ship the complete `src/index.ts` Pi extension factory — the single entry point that
turns Mulligan from a pile of complete-but-disconnected modules into a live extension. The factory loads
+ caches config (`setConfig`), points the logger at `config.log.file` (`setLogFile`), registers all 4
agent-callable tools (`mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`, `mulligan_audit`) via
`pi.registerTool`, arms all 3 event-driven handlers (`context` filter, `tool_result` bloat reminder,
`turn_end` metric) via the existing `register*` seams, and wires the `session_start` (runtime reset) +
`session_shutdown` (full cleanup) lifecycle. Zero-config: with no `mulligan` settings object, it runs on
all defaults (spec/09 §1). The factory is **sync** (no async work) and starts **no** long-lived resources
(spec/01 §1).

**Deliverable** (REPLACE `src/index.ts`; CREATE `test/index.test.ts`):
1. **`src/index.ts`** — replace the no-op stub with the complete factory:
   ```ts
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
   import { setConfig, getConfig } from "./config.js";
   import { setLogFile } from "./log.js";
   import { resetRuntime, clearAll } from "./runtime.js";
   import { registerFilterHandler } from "./filter.js";
   import { registerBloatReminder, registerTurnEndMetric } from "./nudges.js";
   import { makeRewindTool } from "./tools/rewind.js";
   import { makeShrinkTool } from "./tools/shrink.js";
   import { makeCheckpointTool } from "./tools/checkpoint.js";
   import { auditTool } from "./tools/audit.js";

   export default function (pi: ExtensionAPI): void {
     // 1. Load + cache config (v1: validated defaults — no Pi settings accessor; GOTCHA #3).
     setConfig(undefined);
     // 2. Point the logger at the configured destination (after config is cached; GOTCHA #2).
     setLogFile(getConfig().log.file);
     // 3. Register all 4 agent-callable tools (3 are FACTORIES capturing pi; GOTCHA #1).
     pi.registerTool(makeRewindTool(pi));
     pi.registerTool(makeShrinkTool(pi));
     pi.registerTool(makeCheckpointTool(pi));
     pi.registerTool(auditTool);
     // 4. Arm the 3 event-driven handlers (fail-open lives INSIDE each handler; GOTCHA #5).
     registerFilterHandler(pi);
     registerBloatReminder(pi);
     registerTurnEndMetric(pi);
     // 5. session_start → reset this session's runtime (read sessionId FRESH — C12).
     pi.on("session_start", (_event, ctx) => {
       resetRuntime(ctx.sessionManager.getSessionId());
     });
     // 6. session_shutdown → wipe ALL runtimes (full teardown).
     pi.on("session_shutdown", () => {
       clearAll();
     });
   }
   ```
2. **`test/index.test.ts`** — NEW file: unit tests that call the default export with a fake `ExtensionAPI`
   capturing both `.on` registrations AND `.registerTool` calls, then assert: 4 tools registered with the
   exact names; 5 handlers armed (`context`, `tool_result`, `turn_end`, `session_start`,
   `session_shutdown`); the `session_start` handler resets the runtime; the `session_shutdown` handler
   clears all runtimes.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**. (Key type-check: the `session_start` handler's `ctx`
  param is `ExtensionContext` — `ctx.sessionManager.getSessionId()` resolves via ReadonlySessionManager,
  api_verification §4; the arrow `(_event, ctx) =>` infers the param types from the
  `on("session_start", …)` overload — verify it does NOT need explicit annotations.)
- `npx vitest run test/index.test.ts` → all index tests pass.
- `npx vitest run` → **all-green, no regression** (the new file ADDS tests; nothing else changes).
- **`pi -e ./src/index.ts -p "hi"`** loads without error and exits **0** (the contract's verification
  gate — verified to work against the current stub; a wiring/import error fails BEFORE any model call).
- **4 tools** registered via `pi.registerTool` with names EXACTLY `mulligan_rewind`, `mulligan_shrink`,
  `mulligan_checkpoint`, `mulligan_audit` (verified via the test asserting the captured `tool.name`s).
- **5 event handlers** armed via `pi.on`: `context` (filter), `tool_result` (bloat reminder), `turn_end`
  (metric), `session_start` (runtime reset), `session_shutdown` (clearAll).
- **Zero-config**: `setConfig(undefined)` → the extension runs on all DEFAULT_CONFIG (enabled:true) with
  `log.file: null` (logging off). No `mulligan` settings object required.

---

## User Persona

**Target User**: Two-sided. (a) **The agent itself** — gains 4 callable tools + 2 free-ride nudges that
ride inferences it was already making (design principle #5). (b) **The developer/human** — gains an
installable, zero-config extension whose entire surface is wired from a single entry file
(`pi.extensions: ["./src/index.ts"]` in package.json). The factory is the ONLY file Pi loads; it is the
seam between "a set of modules" and "a live extension".

**Use Case**: A user runs `pi -e ./src/index.ts -p "summarize this repo"`. Pi transpiles `src/index.ts`
via jiti, calls the default export with the `ExtensionAPI`, the factory wires every tool + handler +
lifecycle hook, and the agent now has `mulligan_rewind`/`mulligan_shrink`/`mulligan_checkpoint`/
`mulligan_audit` available — with the `context` filter silently rewriting the message copy on every
inference and the two nudges riding `tool_result`/`turn_end`→`context`. All with zero configuration.

**User Journey**:
1. Pi loads `src/index.ts`, calls `default(pi)`.
2. Factory: `setConfig(undefined)` → cache = validated DEFAULT_CONFIG (enabled:true, log off).
3. Factory: `setLogFile(getConfig().log.file)` → logger destination = null (off).
4. Factory: `pi.registerTool(makeRewindTool(pi))` (+ shrink, checkpoint, audit) → 4 tools callable.
5. Factory: `registerFilterHandler(pi)` (+ registerBloatReminder, registerTurnEndMetric) → 3 handlers
   armed on `context`/`tool_result`/`turn_end`.
6. Factory: `pi.on("session_start", …)` → on session start, `resetRuntime(sessionId)` clears the
   per-session in-memory runtime (a resumed/reloaded session starts from clean control state; persisted
   markers are untouched and remain the source of truth).
7. Factory: `pi.on("session_shutdown", …)` → on teardown, `clearAll()` wipes every session's runtime.
8. Agent turns proceed; `context` filter fires before every inference, nudges ride `tool_result`/`turn_end`.

**Pain Points Addressed**: (a) Mulligan's modules are all complete but DISCONNECTED — without the factory,
the extension is a no-op stub (`pi.on("session_start", () => {})`). This task is the connective tissue.
(b) Config + logger + runtime are module-scoped singletons that need explicit initialization at load
(`setConfig`, `setLogFile`) and lifecycle management (`resetRuntime`/`clearAll`) — without it, the runtime
map leaks across sessions and the logger is never pointed at its destination.

---

## Why

- **This is the integration capstone (spec/11 §8).** Every module ships its own `register*` seam
  (`registerFilterHandler`, `registerBloatReminder`, `registerTurnEndMetric`) precisely so that index.ts
  is a thin, obvious, hard-to-get-wrong delegation layer. The complexity lives in the modules; index.ts
  just wires them. spec/11 §8: "Register all tools; attach all handlers; wire config."
- **Config is loaded at factory time, not lazily (spec/09 §1; contract).** `getConfig()` IS lazy (loads
  defaults on first use if the cache is empty), but the contract requires "Config is loaded at factory
  time and cached" — calling `setConfig(undefined)` eagerly initializes the cache so the very first
  `context` fire (which may race with first use) reads a populated cache. setConfig NEVER throws (config.ts
  wraps the whole body in try/catch → defaults).
- **The logger must be pointed at its destination after config load (log.ts header).** log.ts is
  deliberately Pi-free AND config-free (it holds its own `logFile` to break the config↔log cycle and avoid
  the chicken-and-egg timing bug where the log path comes FROM the config under validation). index.ts is
  the ONLY place that knows BOTH (it has config via `setConfig` and the logger via `setLogFile`) — so it
  calls `setLogFile(getConfig().log.file)` after the cache is populated.
- **session_start resets RUNTIME, not config (contract; runtime.ts).** The runtime map
  (`Map<sessionId, SessionRuntime>`) is in-memory, per-session, non-persisted. A resumed/reloaded session
  would otherwise carry stale in-memory state (a stale `tokenBaseline`, stale `lastFiltered`, stale
  `pendingBloatHits`). `resetRuntime(sessionId)` deletes the entry so the next `getRuntime` creates a
  fresh one. The PERSISTED markers (the source of truth) are untouched — they live in Pi's session tree.
- **session_shutdown wipes EVERYTHING (runtime.ts `clearAll`).** On quit/reload, no session's in-memory
  runtime should leak into the next process. `clearAll()` empties the whole map. This is the only place
  `clearAll` is wired (it is the process-teardown counterpart to `resetRuntime`'s per-session teardown).
- **The factory must NOT start long-lived resources (spec/01 §1).** "Do not start timers, sockets,
  watchers from the factory — defer to session_start / tear down in session_shutdown. (Mulligan has no
  long-lived resources.)" Mulligan has none → the factory body is pure synchronous wiring. ✓ satisfied.

---

## What

REPLACE `src/index.ts` (the no-op stub); CREATE `test/index.test.ts`.

### The factory — exact behavior (sync, `void`, default export)

The factory receives `pi: ExtensionAPI` (spec/01 §1; verified api_verification §1: `ExtensionFactory =
(pi: ExtensionAPI) => void | Promise<void>`). It performs, in order:

1. **`setConfig(undefined)`** — eagerly initialize the config cache with validated DEFAULT_CONFIG. (v1
   reads NO Pi settings — there is no settings accessor on ExtensionAPI/ExtensionContext, verified by
   grepping the installed .d.ts; see GOTCHA #3. Reading real `settings.mulligan` is deferred to a future
   version. `undefined` → `validateConfig(undefined)` → returns `structuredClone(DEFAULT_CONFIG)`.) setConfig
   never throws. *Forward-compatible: a future version that finds a settings accessor would call
   `setConfig(settings.mulligan)` here instead — the signature already accepts `unknown`.*
2. **`setLogFile(getConfig().log.file)`** — point the logger at the configured destination (null = off,
   the default). MUST run after step 1 (getConfig reads the cache populated in step 1). Assigning a string
   or null cannot throw. (log.ts is config-free by design — see "Why".)
3. **Register the 4 tools** (GOTCHA #1 — three are FACTORIES, one is a plain const):
   - `pi.registerTool(makeRewindTool(pi));`
   - `pi.registerTool(makeShrinkTool(pi));`
   - `pi.registerTool(makeCheckpointTool(pi));`
   - `pi.registerTool(auditTool);`
   Each factory captures `pi` via closure (its `execute()` needs `pi` for `appendRewindMarker(pi, …)` etc.
   but `execute()` does not receive `pi`). `auditTool` needs no `pi` → plain const. Verified the tool NAMES
   embedded: `mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`, `mulligan_audit` (the test asserts
   these).
4. **Arm the 3 event handlers** (each is a sync `void` seam that calls `pi.on(...)`):
   - `registerFilterHandler(pi);` → `pi.on("context", contextHandler)` (the filter heart; fail-open inside).
   - `registerBloatReminder(pi);` → `pi.on("tool_result", bloatReminderHandler)` (Nudge A).
   - `registerTurnEndMetric(pi);` → `pi.on("turn_end", …)` (Nudge B Phase 1).
5. **`pi.on("session_start", (_event, ctx) => { resetRuntime(ctx.sessionManager.getSessionId()); });`** —
   read the sessionId FRESH from `ctx.sessionManager` (C12: never cache a sessionManager handle) and reset
   that session's runtime. `resetRuntime` never throws; a no-op if the session had no runtime. Do NOT
   branch on `_event.reason` (startup/reload/new/resume/fork) — every session_start resets.
6. **`pi.on("session_shutdown", () => { clearAll(); });`** — wipe ALL runtimes (process teardown). The
   event/ctx args are unused → omit them (arrow with empty param list) or name `_event`/`_ctx`. `clearAll`
   never throws.

### DO NOT (anti-scope — see GOTCHA #11)

- Do NOT read `settings.json` from disk (no settings accessor; v1.1 territory).
- Do NOT make the factory `async` (no async work; spec/01 §1 allows it but it adds nothing).
- Do NOT wrap the factory body in try/catch (fail-FAST on wiring/import errors — see GOTCHA #6; the
  individual handlers already self-protect for fail-open).
- Do NOT branch on `session_start` reason (always reset).
- Do NOT register message/entry renderers, commands, shortcuts, or flags (no custom UI/CLI surface in v1).
- Do NOT re-read config on `session_start` (config loads once at factory time; session_start resets RUNTIME).
- Do NOT start timers/watchers (spec/01 §1; Mulligan has none).
- Do NOT use the contract's literal variable names `rewindTool`/`shrinkTool`/`checkpointTool` — they DO
  NOT EXIST as exports. Use `makeRewindTool(pi)` / `makeShrinkTool(pi)` / `makeCheckpointTool(pi)`.

### Success Criteria

- [ ] `src/index.ts` default-exports a SYNC `(pi: ExtensionAPI): void` factory performing the 6 ordered
      steps above, with all 9 imports resolving (config×2, log, runtime×2, filter, nudges×2, 4 tools).
- [ ] The 3 factory tool registrations use `makeRewindTool(pi)` / `makeShrinkTool(pi)` /
      `makeCheckpointTool(pi)` (factories) and `auditTool` (plain const) — NOT the non-existent plain names.
- [ ] `setConfig(undefined)` runs before `setLogFile(getConfig().log.file)` (ordering).
- [ ] `session_start` handler reads `ctx.sessionManager.getSessionId()` and calls `resetRuntime(...)`; does
      not branch on reason; does not cache a sessionManager handle.
- [ ] `session_shutdown` handler calls `clearAll()`.
- [ ] `test/index.test.ts` asserts: 4 tools registered with the exact names; 5 handlers armed
      (context/tool_result/turn_end/session_start/session_shutdown); session_start resets runtime;
      session_shutdown clears all.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is all-green (no regression; the new test file adds tests).
- [ ] `pi -e ./src/index.ts -p "hi"` loads without error, exits 0.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The COMPLETE factory source (all 9 imports + 6 ordered steps) is given
> verbatim in the Goal's Deliverable block. The exact export names of every consumed module are verified
> and quoted (GOTCHA #1 for the tools; §4 for the register* seams; §2/§3 for config/log). The exact
> `pi.on` overload signatures for `session_start`/`session_shutdown` are quoted from the installed .d.ts
> (api_verification §7.5/§7.6). The test file's fakePi pattern is described precisely (extend the
> established `makePi` helper to also capture `.registerTool`). The verification gate
> (`pi -e ./src/index.ts -p "hi"`) is verified to work against the current stub. The 11 gotchas pin every
> non-obvious decision (tool factory names, no settings accessor, ordering, sync-not-async, fail-fast vs
> fail-open, C12, import `.js` extensions, the parallel predecessor's green baseline). No prior knowledge
> beyond "replace the stub with the factory below + write the test" is required.

### Documentation & References

```yaml
# MUST READ — what an extension factory IS (the contract this file fulfills)
- file: spec/01-pi-context-internals.md
  section: "§1 'What an extension is' — `export default function (pi: ExtensionAPI) { pi.on(...);
            pi.registerTool(...) }`. 'A factory MAY be async; if so, Pi awaits it. Do not start long-lived
            resources (timers, sockets, watchers) from the factory — defer to session_start and tear down in
            session_shutdown. (Mulligan has no long-lived resources.)'"
  why: "§1 IS the factory shape this task implements. The 'no long-lived resources' constraint + 'may be
        async' are both honored (Mulligan is sync, has no resources)."

# MUST READ — the verified Pi API surface (registerTool, on, session lifecycle events)
- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§1 ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>; §2.1 ExtensionAPI write
            methods (registerTool, on, appendEntry, sendMessage); §4 ReadonlySessionManager.getSessionId();
            §7.5 SessionStartEvent {reason}; §7.6 SessionShutdownEvent {reason}."
  why: "§2.1 confirms pi.registerTool + pi.on are the two write methods this factory uses. §4 confirms
        ctx.sessionManager.getSessionId() is present on the READ-ONLY session manager (the session_start
        handler uses it). §7.5/§7.6 confirm the event handler signatures."
  critical: "§2.1 also confirms there is NO settings accessor on ExtensionAPI — config must be loaded via
            setConfig (v1: defaults). See GOTCHA #3."

# MUST READ — design principles the wiring honors
- file: spec/03-architecture.md
  section: "§3 principle #3 (zero extra requests — the nudges ride inferences already happening), #4 (fail
            open — every HANDLER is wrapped; the factory is bootstrap and fails fast instead), #5 (the agent
            is the user); §4 high-level architecture (the 4 tools + 1 filter + 2 nudges + lifecycle)."
  why: "§4 is the inventory of WHAT gets wired (4 tools, context filter, 2 nudges). #4 is WHY the factory
        is NOT wrapped in try/catch while each handler IS (GOTCHA #6)."

# MUST READ — config loading model (v1 = defaults; no settings accessor)
- file: spec/09-configuration.md
  section: "§1 'Where config is read' — 'Source: the merged Pi settings object. Mulligan reads
            settings.mulligan... When: loaded lazily on first use and cached for the session; re-read on
            /reload'; §5 'Environment overrides (optional, v1.1 — not required for v1)'."
  why: "§1 states the INTENT (read settings.mulligan). BUT the API to read Pi settings is NOT exposed to
        extensions in v1 (verified — GOTCHA #3). The work-item contract resolves this: 'for v1, accept
        config via a setConfig call or read defaults'. ⟹ setConfig(undefined). §5 confirms env overrides
        are v1.1 — out of scope."

# MUST READ — the build-order step this task fulfills
- file: spec/11-build-order.md
  section: "§2 Step 8 'index.ts wiring + edge pass' — 'Register all tools; attach all handlers; wire
            config.' §1 file tree + package.json (`main: src/index.ts`, `pi: { extensions: [./src/index.ts] }`)."
  why: "§2 Step 8 IS this task. §1 confirms src/index.ts is the named entry point."

# THE CONSUMED MODULES — exact exports (verified; treat as contracts)
- file: src/config.ts
  section: "setConfig(raw: unknown): void (init/replace session cache; never throws); getConfig(): MulliganConfig
            (fresh structuredClone of the cache; lazy-loads DEFAULT_CONFIG if cache empty); MulliganConfig.log.file:
            string | null."
  why: "Step 1 (setConfig(undefined)) + step 2 (setLogFile(getConfig().log.file))."

- file: src/log.ts
  section: "setLogFile(path: string | null): void (assigns the module-level logFile; null = off). Header
            comment: 'index.ts (P1.M7.T1) calls setLogFile(getConfig().log.file) after config load.'"
  why: "Step 2. log.ts is config-free BY DESIGN (breaks the config↔log cycle) — index.ts is the only place
        that bridges them."

- file: src/runtime.ts
  section: "resetRuntime(sessionId: string): void (deletes this session's entry; no-op if absent; never
            throws); clearAll(): void (empties the whole map; never throws)."
  why: "session_start (resetRuntime) + session_shutdown (clearAll)."

- file: src/filter.ts
  section: "registerFilterHandler(pi: ExtensionAPI): void → body: pi.on('context', contextHandler). JSDoc:
            'Called once from the extension factory (index.ts, P1.M7.T1.S1): registerFilterHandler(pi).'"
  why: "Step 4 (context filter)."

- file: src/nudges.ts
  section: "registerBloatReminder(pi: ExtensionAPI): void → pi.on('tool_result', bloatReminderHandler);
            registerTurnEndMetric(pi: ExtensionAPI): void → pi.on('turn_end', (event, ctx) => {...}). Both
            JSDocs: 'index.ts (P1.M7.T1.S1) calls this once at startup.'"
  why: "Step 4 (the two nudges)."

# THE TOOLS — CRITICAL: 3 factories + 1 plain const (GOTCHA #1)
- file: src/tools/rewind.ts
  section: "export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails>
            (FACTORY — captures pi; name 'mulligan_rewind'). JSDoc: 'index.ts will do: pi.registerTool(makeRewindTool(pi));'"
- file: src/tools/shrink.ts
  section: "export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails>
            (FACTORY — captures pi; name 'mulligan_shrink'). JSDoc: 'index.ts will do: pi.registerTool(makeShrinkTool(pi));'"
- file: src/tools/checkpoint.ts
  section: "export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<typeof CheckpointParams, CheckpointDetails>
            (FACTORY — captures pi; name 'mulligan_checkpoint'). JSDoc: 'index.ts will do: pi.registerTool(makeCheckpointTool(pi));'"
- file: src/tools/audit.ts
  section: "export const auditTool: ToolDefinition<typeof AuditParams, AuditDetails> (PLAIN const — needs NO
            pi; name 'mulligan_audit'). JSDoc: 'index.ts does: pi.registerTool(auditTool); (NO factory call —
            unlike makeCheckpointTool/makeRewindTool/makeShrinkTool which capture pi).'"
  why: "Step 3. The SHAPE MISMATCH with the work-item contract is GOTCHA #1."

# SIBLING PRP — the parallel predecessor (will be COMPLETE/green when this runs)
- file: plan/001_2e5baf25fe9f/P1M6T2S2/PRP.md
  section: "Moves shouldNudge/injectNudge/suppressCheck from filter.ts to nudges.ts; rewires the context
            handler's nudge gate. Does NOT touch index.ts."
  why: "Explains the CURRENT 3-failing-tests/2-tsc-errors baseline (P1.M6.T2.S2 in flight). When this PRP
        runs, that is green. This task does not conflict."

# VERIFIED RESEARCH NOTES (this task's own research/)
- file: plan/001_2e5baf25fe9f/P1M7T1S1/research/verified_findings.md
  section: "§1 tool export shapes (GOTCHA #1 source); §2 no settings accessor; §3 setLogFile ordering; §4
            register* signatures; §5 session lifecycle signatures; §6 sync/fail-fast; §7 .js imports;
            §8 smoke command verified; §9 test approach; §10 baseline; §11 anti-scope."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # "main":"src/index.ts"; "pi":{"extensions":["./src/index.ts"]}; type:'module';
│                           #   deps @earendil-works/pi-coding-agent *, typebox *; devDeps typescript ^5,
│                           #   vitest ^1, @types/node ^22; scripts.test:'vitest run'.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test'].
├── src/
│   ├── index.ts            # NO-OP STUB (pi.on("session_start", () => {})). THIS TASK: REPLACE with the factory.
│   ├── config.ts           # setConfig / getConfig / MulliganConfig (COMPLETE). DO NOT TOUCH.
│   ├── log.ts              # setLogFile (COMPLETE). DO NOT TOUCH.
│   ├── runtime.ts          # resetRuntime / clearAll / getRuntime (COMPLETE). DO NOT TOUCH.
│   ├── tokens.ts / ledger.ts / notes.ts / transforms.ts / markers.ts  # (COMPLETE). DO NOT TOUCH.
│   ├── filter.ts           # registerFilterHandler (COMPLETE). DO NOT TOUCH.
│   ├── nudges.ts           # registerBloatReminder + registerTurnEndMetric (COMPLETE; P1.M6.T2.S2 appends
│   │                       #   shouldNudge/injectNudge/suppressCheck — irrelevant to index.ts). DO NOT TOUCH.
│   └── tools/
│       ├── rewind.ts       # makeRewindTool(pi) FACTORY (COMPLETE). DO NOT TOUCH.
│       ├── shrink.ts       # makeShrinkTool(pi) FACTORY (COMPLETE). DO NOT TOUCH.
│       ├── checkpoint.ts   # makeCheckpointTool(pi) FACTORY (COMPLETE). DO NOT TOUCH.
│       └── audit.ts        # auditTool PLAIN const (COMPLETE). DO NOT TOUCH.
└── test/
    ├── *.test.ts (16 files)# all module tests (COMPLETE). DO NOT TOUCH.
    └── index.test.ts       # NEW — THIS TASK CREATES (factory registration unit tests).
# VERIFIED: `pi -e ./src/index.ts -p "hi"` against the CURRENT stub → loads, answers, exit 0.
# VERIFIED: `pi` v0.84.1 on PATH; `pi --extension, -e <path>` + `pi --print, -p <prompt>` flags exist.
# NOTE: NO eslint/prettier/biome. The type+style gate is `tsc --noEmit` (TS strict).
# NOTE: src imports use "./<sibling>.js" (ESM Bundler resolution). index.ts follows this.
# BASELINE (post-P1.M6.T2.S2): `npx tsc --noEmit` exit 0; `npx vitest run` all-green.
#   (CURRENT repo shows P1.M6.T2.S2's in-flight 3 failures/2 tsc errors — ignore; will be green.)
```

### Desired Codebase tree with files to be CREATED / MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── index.ts            # MODIFIED (FULL REWRITE): no-op stub → complete factory (6 ordered steps,
│                           #   9 imports). Sync, void, default export. See Goal's Deliverable block.
└── test/
    └── index.test.ts       # NEW: factory unit tests (fakePi captures .on + .registerTool; asserts 4 tools,
                            #   5 handlers, session_start resets runtime, session_shutdown clears all).
# No other files touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL — THE thing that breaks one-pass if missed) — the tool EXPORT SHAPES do NOT match
#   the work-item contract. The contract's LOGIC step (3) writes the wiring as if all 4 tools are plain
#   consts: `pi.registerTool(rewindTool); pi.registerTool(shrinkTool); pi.registerTool(checkpointTool);
#   pi.registerTool(auditTool);`. The names `rewindTool`/`shrinkTool`/`checkpointTool` DO NOT EXIST as
#   exports. Verified (grep):
#     src/tools/rewind.ts:402     export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<...>
#     src/tools/shrink.ts:280     export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<...>
#     src/tools/checkpoint.ts:166 export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<...>
#     src/tools/audit.ts:593      export const auditTool: ToolDefinition<...>
#   ⟹ the first THREE are FACTORIES that capture `pi` via closure (their execute() needs pi for
#   appendRewindMarker(pi, …)/appendShrinkMarker(pi, …)/setCheckpoint(pi, …)/leaveNote(pi, …) but execute()
#   does NOT receive pi as an arg). Only auditTool is a plain const (audit needs NO pi — every read goes
#   through ctx or a pure helper). The CORRECT wiring:
#     pi.registerTool(makeRewindTool(pi));
#     pi.registerTool(makeShrinkTool(pi));
#     pi.registerTool(makeCheckpointTool(pi));
#     pi.registerTool(auditTool);
#   Each tool file's JSDoc states this verbatim ("index.ts will do: pi.registerTool(makeRewindTool(pi))").
#   If the implementer blindly follows the contract's variable names, the IMPORT fails to resolve →
#   `pi -e ./src/index.ts -p hi` exits non-zero with a "has no exported member 'rewindTool'" error.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (ordering) — setLogFile MUST run AFTER setConfig. setLogFile takes the log path FROM the config:
#   `setLogFile(getConfig().log.file)`. getConfig() reads the cache that setConfig populated. If you reverse
#   them, getConfig() still works (it's lazy — loads DEFAULT_CONFIG if cache empty), so it won't ERROR, but
#   the contract requires "Config is loaded at factory time and cached" THEN "setLogFile". Keep the order:
#   setConfig → (getConfig) → setLogFile → registerTool → register* → pi.on.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL — config source) — there is NO Pi settings accessor. Verified: `grep -rn "settings"
#   dist/core/extensions/types.d.ts` for ExtensionAPI/ExtensionContext returns nothing relevant. The
#   ExtensionAPI surface is on/registerTool/registerCommand/.../appendEntry/sendMessage/setLabel/exec —
#   NONE read Pi's settings.json. spec/09 §1 says "Mulligan reads settings.mulligan" but the API to do so is
#   not exposed to extensions in v1. The work-item contract resolves it: "for v1, accept config via a setConfig
#   call or read defaults". ⟹ `setConfig(undefined)` → validateConfig(undefined) →
#   structuredClone(DEFAULT_CONFIG) → cached. This is the "read defaults" path. getConfig() is ALSO lazy so
#   the extension works even without setConfig — but calling it eagerly honors "config loaded at factory time".
#   setConfig NEVER throws (config.ts wraps the whole body in try/catch → defaults). Reading real
#   settings.mulligan + env overrides is v1.1 (spec/09 §5) — out of scope.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (the session_start ctx param) — the handler reads ctx.sessionManager.getSessionId(). The
#   `on("session_start", handler)` overload types handler as ExtensionHandler<SessionStartEvent> =
#   (event: SessionStartEvent, ctx: ExtensionContext) => …. So the arrow `(_event, ctx) =>` INFERS both param
#   types from the overload — you do NOT need explicit annotations (and shouldn't add them; they'd just
#   repeat the inferred types). ctx.sessionManager is ReadonlySessionManager (api_verification §4) which HAS
#   getSessionId() (verified in the Pick<…> list). C12: read it FRESH each fire — do NOT lift sessionId or
#   sessionManager to module scope. The factory does not branch on _event.reason (startup/reload/new/resume/
#   fork) — every session_start resets the runtime (correct: the runtime is per-sessionId in-memory state;
#   persisted markers are untouched and remain the source of truth).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (fail-open location) — do NOT wrap the factory body in try/catch. Design principle #4 (fail open)
#   applies to HANDLERS (context/tool_result/turn_end) which fire DURING agent turns — each of those already
#   wraps its own body in try/catch (contextHandler, bloatReminderHandler, turnEndMetricHandler). The factory
#   is BOOTSTRAP: it runs ONCE at load. The operations are all safe (setConfig never throws; setLogFile
#   assigns a string; registerTool/pi.on are framework calls). If a REAL wiring bug exists (e.g. importing
#   the non-existent `rewindTool` — GOTCHA #1, or a typo), we WANT it to surface as a load error
#   (`pi -e ./src/index.ts -p hi` exits non-zero) rather than be silently swallowed. ⟹ fail-FAST at bootstrap;
#   fail-OPEN in handlers. The register* seams are thin (one pi.on call each) — they don't need their own
#   try/catch either; if pi.on throws, that's a framework failure we want to see.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (sync, not async) — the factory is SYNC. spec/01 §1 says "A factory MAY be async; if so, Pi
#   awaits it before startup." There is NO async work here (setConfig/setLogFile/registerTool/pi.on/resetRuntime/
#   clearAll are all sync). ⟹ `export default function (pi: ExtensionAPI): void { … }`. Making it `async`
#   adds an unnecessary Promise and changes the return type to `Promise<void>` — harmless but pointless and
#   diverges from the established convention (every shipped module is sync). Keep it sync.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (.js import extensions) — source files import siblings with `.js` (ESM Bundler resolution;
#   tsconfig moduleResolution:'Bundler'). filter.ts does `import { getConfig } from "./config.js";`. index.ts
#   follows: `./config.js`, `./log.js`, `./runtime.js`, `./filter.js`, `./nudges.js`, `./tools/rewind.js`,
#   `./tools/shrink.js`, `./tools/checkpoint.js`, `./tools/audit.js`. The ExtensionAPI import is type-only:
#   `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";` (the existing stub does exactly
#   this — preserve it; the runtime value is passed IN as `pi`).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (no long-lived resources) — spec/01 §1: "Do not start long-lived resources (timers, sockets,
#   watchers) from the factory — defer to session_start and tear down in session_shutdown. (Mulligan has no
#   long-lived resources.)" The factory body does NOT call setInterval/setTimeout(fs watcher)/net.Socket etc.
#   Mulligan has none. ✓ satisfied by writing ONLY the 6 wiring steps. If you're tempted to add a periodic
#   flush or a file watcher — DON'T (it violates spec/01 §1 and Mulligan's design).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 (session_shutdown handler args) — the event/ctx args are UNUSED in session_shutdown (clearAll
#   takes no args). Write `pi.on("session_shutdown", () => { clearAll(); });` (empty param list) OR
#   `(_event, _ctx) => { clearAll(); }` if you prefer explicit unused-param names. Both type-check (the
#   overload allows fewer params). The empty-param-list form is cleaner. Do NOT name them without the `_`
#   prefix if unused — tsconfig has no noUnusedParameters, so it won't error, but the `_` convention is
#   established across the codebase.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 (test fakePi must capture BOTH .on AND .registerTool) — the established makePi helper
#   (test/filter.test.ts:96, test/nudges.test.ts:37) captures ONLY `.on` registrations into a `handlers`
#   record. index.ts ALSO calls `pi.registerTool(...)` 4×. The index.test.ts fakePi MUST extend the pattern
#   to capture `.registerTool` into a `tools` array (so the test asserts the 4 tool NAMES). Pattern:
#     const handlers: Record<string, Function> = {};
#     const tools: { name: string }[] = [];
#     const pi = {
#       on(event: string, handler: Function) { handlers[event] = handler; },
#       registerTool(tool: { name: string }) { tools.push(tool); },
#     } as unknown as ExtensionAPI;
#   Then call the default export: `import factory from "../src/index.js"; factory(pi);` and assert
#   `tools.map(t => t.name)` = [mulligan_rewind, mulligan_shrink, mulligan_checkpoint, mulligan_audit] and
#   `Object.keys(handlers)` includes context/tool_result/turn_end/session_start/session_shutdown.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 (anti-scope) — index.ts does NOT: read settings.json (no accessor, v1.1); make the factory
#   async; wrap in try/catch; branch on session_start reason; register renderers/commands/shortcuts/flags;
#   re-read config on session_start; start timers/watchers; use the non-existent plain tool-name imports.
#   It is EXACTLY the 6 steps in the Deliverable — nothing more.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 (test isolation — module-scoped state) — index.ts calls setConfig(undefined) + setLogFile(...)
#   at FACTORY-CALL time (not import time — the default export is a function; it only runs when CALLED). The
#   test calls `factory(pi)` explicitly inside the test. runtime.ts is module-scoped; index.test.ts should
#   `clearAll()` in beforeEach so a prior test's runtime map doesn't leak. config/log state is safe to leave
#   (setConfig(undefined)→defaults, setLogFile(null)→off are both no-op-safe). Importing the default export:
#   `import indexFactory from "../src/index.js";` (the default export IS the factory function).
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

This task defines NO new types and NO new data. It consumes the ExtensionAPI (`pi`), the 6 module
functions (setConfig/getConfig/setLogFile/resetRuntime/clearAll), the 3 register* seams, and the 4 tool
exports (3 factories + 1 const). The factory is pure delegation.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES + BASELINE (no edits — run only)
  - RUN: grep -n "export function makeRewindTool" src/tools/rewind.ts         # MUST print (GOTCHA #1 source)
  - RUN: grep -n "export function makeShrinkTool" src/tools/shrink.ts         # MUST print
  - RUN: grep -n "export function makeCheckpointTool" src/tools/checkpoint.ts # MUST print
  - RUN: grep -n "export const auditTool" src/tools/audit.ts                  # MUST print (PLAIN const)
  - RUN: grep -n "export function registerFilterHandler" src/filter.ts        # MUST print
  - RUN: grep -n "export function registerBloatReminder\|export function registerTurnEndMetric" src/nudges.ts  # BOTH must print
  - RUN: grep -n "export function setConfig\|export function getConfig" src/config.ts   # BOTH must print
  - RUN: grep -n "export function setLogFile" src/log.ts                       # MUST print
  - RUN: grep -n "export function resetRuntime\|export function clearAll" src/runtime.ts # BOTH must print
  - RUN: npx tsc --noEmit -p tsconfig.json   # expect exit 0 (post-P1.M6.T2.S2 green baseline)
  - RUN: npx vitest run                       # expect all-green (post-P1.M6.T2.S2; ~15 files, 592+ tests)
  NOTE: if tsc/vitest show P1.M6.T2.S2's in-flight failures (2 tsc errors / 3 failing tests in
        filter.test.ts), that is the parallel predecessor mid-flight — it will be green when this task runs.

Task 1: REWRITE src/index.ts   (FULL REPLACEMENT of the no-op stub — exact content below)
  - DELETE the current stub body (the `pi.on("session_start", () => {})` no-op). KEEP the file.
  - WRITE the factory (verbatim from the Goal's Deliverable block). The 9 imports + 6 ordered steps.
  - CONSTRAINTS:
      * SYNC factory: `export default function (pi: ExtensionAPI): void { … }`. NOT async.
      * Step 1 setConfig(undefined) BEFORE step 2 setLogFile(getConfig().log.file).
      * Step 3: makeRewindTool(pi) / makeShrinkTool(pi) / makeCheckpointTool(pi) (FACTORIES) + auditTool
        (plain const). NOT the non-existent rewindTool/shrinkTool/checkpointTool names.
      * Step 4: registerFilterHandler(pi); registerBloatReminder(pi); registerTurnEndMetric(pi);
      * Step 5: pi.on("session_start", (_event, ctx) => { resetRuntime(ctx.sessionManager.getSessionId()); });
      * Step 6: pi.on("session_shutdown", () => { clearAll(); });
      * NO try/catch around the factory body (GOTCHA #5). NO timers/watchers (GOTCHA #8).
      * Imports use ".js" extensions (GOTCHA #7). ExtensionAPI import is `import type`.
  - NAMING/PLACEMENT: src/index.ts (the existing entry file; package.json main + pi.extensions point at it).

Task 2: CREATE test/index.test.ts   (NEW file — factory registration unit tests)
  - IMPORT: `import { describe, it, expect, beforeEach } from "vitest";`
            `import indexFactory from "../src/index.js";`
            `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";`
            `import { getRuntime, clearAll } from "../src/runtime.js";`  (to assert lifecycle effects)
  - fakePi helper (captures BOTH .on AND .registerTool — GOTCHA #10):
        function makePi() {
          const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
          const tools: { name: string }[] = [];
          const pi = {
            on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
            registerTool(tool: { name: string }) { tools.push(tool); },
          };
          return { handlers, tools, pi: pi as unknown as ExtensionAPI };
        }
  - fakeCtx helper (minimal — only sessionManager.getSessionId needed for the session_start test):
        function makeCtx(sessionId = "sess-test") {
          const sm = { getSessionId: () => sessionId };
          return { sessionManager: sm as unknown as ExtensionContext["sessionManager"] } as ExtensionContext;
        }
  - beforeEach: clearAll() (GOTCHA #12 — runtime.ts is module-scoped).
  - TESTS:
      1. it("registers all 4 tools with the exact names", …) — factory(pi); expect
         tools.map(t => t.name).sort() = [mulligan_audit, mulligan_checkpoint, mulligan_rewind,
         mulligan_shrink].sort()  (use expect(...).toEqual(expect.arrayContaining([...])) + length 4).
      2. it("arms the 5 event handlers", …) — factory(pi); expect
         ["context","tool_result","turn_end","session_start","session_shutdown"].every(e => e in handlers).
      3. it("session_start handler resets the runtime for that session", …) — factory(pi); const sid="s1";
         const rt = getRuntime(sid); rt.seq = 99; rt.tokenBaseline = 5000; (mutate); call
         handlers["session_start"]!(makeStartEvent(), makeCtx(sid)); const rt2 = getRuntime(sid);
         expect(rt2.seq).toBe(0) && expect(rt2.tokenBaseline).toBeNull()  (FRESH runtime → reset worked).
         (makeStartEvent returns { type:"session_start", reason:"new" } — shape only, unused by the handler.)
      4. it("session_shutdown handler clears all runtimes", …) — factory(pi); getRuntime("s1"); getRuntime("s2");
         handlers["session_shutdown"]!(); expect(getRuntime("s1").seq).toBe(0)  (clearAll wiped → fresh).
      5. (OPTIONAL) it("does not register extra tools", …) — expect tools.length === 4.
      6. (OPTIONAL) it("does not arm extra handlers", …) — expect Object.keys(handlers).length === 5.
  - CONSTRAINTS: NO real Pi runtime (the fakePi + fakeCtx are sufficient). NO model calls. Pure unit test.
  - NAMING/PLACEMENT: test/index.test.ts (NEW; alongside the other module tests).

Task 3: VERIFY (run the gates)
  - RUN: npx tsc --noEmit -p tsconfig.json   # expect exit 0
  - RUN: npx vitest run test/index.test.ts   # expect all-green
  - RUN: npx vitest run                       # expect all-green (no regression; +~6 new tests)
  - RUN: timeout 60 pi -e ./src/index.ts -p "hi"   # expect loads, answers/exits, EXIT 0 (the contract gate)
```

### Implementation Patterns & Key Details

```ts
// ── The complete factory (src/index.ts) — copy verbatim ──────────────────────
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setConfig, getConfig } from "./config.js";
import { setLogFile } from "./log.js";
import { resetRuntime, clearAll } from "./runtime.js";
import { registerFilterHandler } from "./filter.js";
import { registerBloatReminder, registerTurnEndMetric } from "./nudges.js";
import { makeRewindTool } from "./tools/rewind.js";
import { makeShrinkTool } from "./tools/shrink.js";
import { makeCheckpointTool } from "./tools/checkpoint.js";
import { auditTool } from "./tools/audit.js";

/**
 * Mulligan — Pi extension factory (spec/01 §1, spec/03 §4, spec/11 §8 Step 8).
 *
 * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
 * the 3 event-driven handlers (context filter + 2 nudges), and the session lifecycle (runtime reset /
 * full cleanup). Zero-config: setConfig(undefined) → validated DEFAULT_CONFIG (enabled:true, log off).
 *
 * SYNC (no async work; spec/01 §1 allows async but it is unnecessary). Does NOT start long-lived
 * resources (spec/01 §1; Mulligan has none). Does NOT wrap in try/catch — fail-FAST on wiring errors at
 * bootstrap; the individual handlers (contextHandler/bloatReminderHandler/turnEndMetricHandler) already
 * self-protect for fail-open (spec/03 #4).
 */
export default function (pi: ExtensionAPI): void {
  // 1. Load + cache config at factory time (v1: validated defaults — no Pi settings accessor in v1;
  //    setConfig(undefined) → DEFAULT_CONFIG; reading real settings.mulligan is v1.1). Never throws.
  setConfig(undefined);

  // 2. Point the logger at the configured destination (after the cache is populated). null = off (default).
  setLogFile(getConfig().log.file);

  // 3. Register all 4 agent-callable tools. rewind/shrink/checkpoint are FACTORIES capturing `pi` via
  //    closure (their execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …)/setCheckpoint(pi, …)
  //    but execute() does NOT receive pi). auditTool is a PLAIN const (audit needs no pi).
  pi.registerTool(makeRewindTool(pi));
  pi.registerTool(makeShrinkTool(pi));
  pi.registerTool(makeCheckpointTool(pi));
  pi.registerTool(auditTool);

  // 4. Arm the 3 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).
  registerFilterHandler(pi);   // pi.on("context", contextHandler)        — the filter heart
  registerBloatReminder(pi);   // pi.on("tool_result", bloatReminderHandler) — Nudge A
  registerTurnEndMetric(pi);   // pi.on("turn_end", …)                     — Nudge B Phase 1

  // 5. session_start → reset this session's runtime (read sessionId FRESH — C12; never cache a
  //    sessionManager handle). A resumed/reloaded session starts from clean in-memory control state;
  //    persisted markers are untouched and remain the source of truth. Never branches on reason.
  pi.on("session_start", (_event, ctx) => {
    resetRuntime(ctx.sessionManager.getSessionId());
  });

  // 6. session_shutdown → wipe ALL per-session runtimes (full process teardown). Never throws.
  pi.on("session_shutdown", () => {
    clearAll();
  });
}

// ── Test fakePi (test/index.test.ts) — captures .on AND .registerTool ─────────
function makePi() {
  const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
  const tools: { name: string }[] = [];
  const pi = {
    on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
    registerTool(tool: { name: string }) { tools.push(tool); },
  };
  return { handlers, tools, pi: pi as unknown as ExtensionAPI };
}
```

### Integration Points

```yaml
PACKAGE.JSON (NO CHANGE — already correct, verified):
  - main: "src/index.ts"                    # the factory file
  - pi.extensions: ["./src/index.ts"]       # Pi loads this file; calls default(pi)
  - scripts.smoke: 'pi -e ./src/index.ts -p "$(cat test/integration/scenarios.md)"'  # (integration harness — P1.M7.T2)

LIFECYCLE (wired HERE, consumed upstream):
  - session_start  → resetRuntime(ctx.sessionManager.getSessionId())   # runtime.ts (fresh per-session state)
  - session_shutdown → clearAll()                                       # runtime.ts (wipe all)

CONFIG/LOG (wired HERE, consumed by every handler):
  - setConfig(undefined) → cached MulliganConfig (read by getConfig() in contextHandler/audit/tools)
  - setLogFile(getConfig().log.file) → log.ts module-level logFile (read by log()/logInfo()/…)

EVENTS (wired HERE via the register* seams — the handlers themselves are COMPLETE upstream):
  - context        ← registerFilterHandler(pi)   (filter.ts — the message-copy transform)
  - tool_result    ← registerBloatReminder(pi)    (nudges.ts — Nudge A bloat annotator)
  - turn_end       ← registerTurnEndMetric(pi)    (nudges.ts — Nudge B Phase 1 metric)

TOOLS (wired HERE — the definitions are COMPLETE upstream):
  - pi.registerTool(makeRewindTool(pi))     # mulligan_rewind
  - pi.registerTool(makeShrinkTool(pi))     # mulligan_shrink
  - pi.registerTool(makeCheckpointTool(pi)) # mulligan_checkpoint
  - pi.registerTool(auditTool)              # mulligan_audit
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# There is NO eslint/prettier/biome (devDeps = typescript + vitest + @types/node). The type+style gate IS tsc.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0. Key type-checks:
#   - all 9 imports resolve (config×2, log, runtime×2, filter, nudges×2, 4 tools).
#   - makeRewindTool(pi) etc. return ToolDefinition<…> assignable to pi.registerTool's param.
#   - the session_start arrow's ctx param infers ExtensionContext; ctx.sessionManager.getSessionId() resolves.
#   - setConfig(undefined) accepts unknown; getConfig().log.file is string|null assignable to setLogFile.
# If errors: READ the output. The most likely failure is an import-name typo (rewindTool vs makeRewindTool —
#   GOTCHA #1) — fix the import to the factory name. Do NOT proceed until exit 0.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new factory registration tests
npx vitest run test/index.test.ts
# Expected: all-green. Asserts: 4 tools (exact names), 5 handlers armed, session_start resets runtime,
#   session_shutdown clears all.

# Full suite — no regression (the new file ADDS tests; nothing else changed)
npx vitest run
# Expected: all-green (post-P1.M6.T2.S2 baseline + the new index.test.ts). If a PRIOR test now fails,
#   this task touched something it shouldn't have — re-read the anti-scope (GOTCHA #11); only index.ts
#   and test/index.test.ts should be modified.
```

### Level 3: Integration Testing (System Validation — THE contract gate)

```bash
# Load the extension end-to-end via Pi. This is the work-item contract's verification command.
# It transpiles src/index.ts via jiti, calls default(pi), runs a one-shot prompt, exits.
timeout 60 pi -e ./src/index.ts -p "hi"
# Expected: the agent answers (or at minimum loads + exits 0). EXIT 0.
# A wiring/import error (e.g. the non-existent rewindTool import — GOTCHA #1) fails HERE, BEFORE any model
#   call, with a "has no exported member" or similar error + non-zero exit. This is the PRIMARY end-to-end
#   gate. (In an env with no API key, the load itself still must succeed — a wiring error fails pre-model.)

# Optional: confirm the 4 tools are discoverable (if pi lists extension tools)
pi -e ./src/index.ts -p "list your available tools" 2>&1 | grep -i mulligan || true
# Expected (informational): mulligan_rewind, mulligan_shrink, mulligan_checkpoint, mulligan_audit appear.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (This is wiring code — there is no domain-specific creative validation beyond Levels 1–3.)
# The downstream integration harness (P1.M7.T2, scripts.smoke) exercises the full F-* scenarios against
#   a real pi -p run; that is OUT OF SCOPE for this task. This task's contract is: loads, wires, tests green.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed: `npx tsc --noEmit -p tsconfig.json` exit 0; `npx vitest run` all-green;
      `pi -e ./src/index.ts -p "hi"` loads + exit 0.
- [ ] `npx vitest run test/index.test.ts` all-green (4 tools, 5 handlers, lifecycle reset/clear).
- [ ] No lint/type errors (tsc IS the gate — no eslint/prettier/biome).

### Feature Validation

- [ ] `src/index.ts` default-exports the SYNC `(pi: ExtensionAPI): void` factory.
- [ ] Step 3 uses `makeRewindTool(pi)` / `makeShrinkTool(pi)` / `makeCheckpointTool(pi)` (FACTORIES) +
      `auditTool` (plain const) — NOT the non-existent plain names (GOTCHA #1).
- [ ] `setConfig(undefined)` runs before `setLogFile(getConfig().log.file)` (ordering — GOTCHA #2).
- [ ] `session_start` handler reads `ctx.sessionManager.getSessionId()` FRESH and calls `resetRuntime(...)`;
      does not branch on reason; does not cache a sessionManager handle (C12 — GOTCHA #4).
- [ ] `session_shutdown` handler calls `clearAll()`.
- [ ] 4 tools registered with names EXACTLY `mulligan_rewind`, `mulligan_shrink`, `mulligan_checkpoint`,
      `mulligan_audit` (verified by the test).
- [ ] 5 handlers armed: `context`, `tool_result`, `turn_end`, `session_start`, `session_shutdown`.
- [ ] Zero-config: no `mulligan` settings object required (setConfig(undefined) → all defaults).

### Code Quality Validation

- [ ] Factory follows the codebase convention (sync, default export, `.js` imports, type-only ExtensionAPI import).
- [ ] No try/catch around the factory body (fail-fast at bootstrap — GOTCHA #5/#6).
- [ ] No long-lived resources started (no timers/watchers/sockets — GOTCHA #8).
- [ ] File placement matches the desired tree (src/index.ts modified; test/index.test.ts created; nothing else).
- [ ] Anti-scope respected (GOTCHA #11): no settings.json read, no async, no extra registrations.

### Documentation & Deployment

- [ ] Factory JSDoc explains the sync/no-try-catch/no-resources design (self-documenting).
- [ ] No new environment variables (v1 uses defaults; env overrides are v1.1 — spec/09 §5).
- [ ] package.json unchanged (already correct: `main`, `pi.extensions`, `scripts.smoke`).

---

## Anti-Patterns to Avoid

- ❌ Don't import `rewindTool`/`shrinkTool`/`checkpointTool` as plain consts — they DON'T EXIST. Use the
  `makeXxxTool(pi)` factories (GOTCHA #1). Only `auditTool` is a plain const.
- ❌ Don't read Pi `settings.json` — there's no settings accessor in v1 (GOTCHA #3). Use `setConfig(undefined)`.
- ❌ Don't wrap the factory body in try/catch — fail FAST on wiring errors; the handlers self-protect (GOTCHA #5).
- ❌ Don't make the factory `async` — there's no async work (GOTCHA #6).
- ❌ Don't start timers/watchers from the factory (spec/01 §1; GOTCHA #8).
- ❌ Don't reverse setConfig/setLogFile ordering (GOTCHA #2).
- ❌ Don't branch on `session_start` reason — always reset the runtime.
- ❌ Don't cache a sessionManager handle or sessionId at module scope (C12 — GOTCHA #4).
- ❌ Don't use `.ts` import extensions in source — use `.js` (ESM Bundler — GOTCHA #7).
- ❌ Don't touch any file other than `src/index.ts` and `test/index.test.ts`.
- ❌ Don't re-read/re-set config on `session_start` — config loads once at factory time; session_start resets RUNTIME.

---

**Confidence Score: 9/10** — This is a thin, well-bounded wiring task. Every consumed export is verified
shipped with its exact name + signature. The complete factory source is given verbatim. The single highest
risk (the tool-export-shape mismatch with the work-item contract) is pinned as GOTCHA #1 with the exact
correct wiring. The verification gate (`pi -e ./src/index.ts -p "hi"`) is verified to work against the
current stub. The -1 is for the parallel-predecessor baseline dependency (P1.M6.T2.S2 must land green first;
its in-flight state is documented so the implementer doesn't mistake it for a regression they caused).