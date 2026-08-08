# PRP — P1.M7.T2.S1: Adapt looper-smoke prototype into integration harness with F-* scenarios

**Work item:** P1.M7.T2.S1 · **Points:** 2 · **Stage:** Integration, Hardening & Documentation
(spec/10-testing.md §2 "Tier 2 — Integration smoke harness"; spec §8 verification strategy; spec/03 §4
architecture). **Scope:** CREATE `test/integration/smoke.ts` (a Pi *helper extension* loaded via a second
`-e`), CREATE `test/integration/scenarios.md` (the integration-test docs), CREATE
`test/integration/run-smoke.mjs` (the orchestrator), and UPDATE `package.json` `scripts.smoke`. **No file
under `src/` is touched** — this task exercises the COMPLETE extension (P1.M7.T1.S1) end-to-end against
real `pi`.

> **THIS IS THE END-TO-END VERIFICATION LAYER.** Every pure module is unit-tested; every Pi-coupled handler
> is unit-tested with fakes. The smoke harness is the ONLY thing that proves the real `context` filter takes
> effect on a real inference and the model auto-continues. It is the feasibility spike
> (`spec/reference/looper-smoke.proto.ts`) adapted to the real extension.

---

## Goal

**Feature Goal**: Ship an integration smoke harness that drives the COMPLETE Mulligan extension (produced by
the parallel predecessor P1.M7.T1.S1) through the 9 F-* scenarios defined in `spec/10-testing.md` §2.1
(F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift, F-protected, F-maxdepth, F-checkpoint,
F-failopen, F-reload) against a real `pi -p` run, and asserts the §2.1 pass criteria + §2.3 JSONL invariants.
The harness is **reliable and CI-friendly**: it does NOT depend on a strong instruction-following model — it
uses a deterministic extension command (`/mulligan_smoke <scenario>`) that drives each scenario through the
REAL tools/handlers, and triggers the observing inference via `pi.sendUserMessage({deliverAs:"followUp"})`.

**Deliverable** (4 artifacts):
1. **`test/integration/smoke.ts`** — a Pi *helper extension* (default factory). It is the SECOND extension
   on the command line (`pi -e ./src/index.ts -e ./test/integration/smoke.ts …`), which (verified) means its
   `context`/`tool_result`/`turn_end` handlers fire **after** Mulligan's — so it observes the **post-filter**
   messages. Responsibilities: (a) inject canary observables at `session_start`; (b) log every `context.fire`
   with `{count, canaryPresent, notePresent, hasRewindMarker, …}` to a JSONL log (mirroring the spike);
   (c) register the `/mulligan_smoke <scenario>` command that deterministically sets up each scenario using
   the REAL tool factories + `sendUserMessage` follow-up; (d) register the `mulligan_smoke_big` test tool
   (returns a >8 KB canary result) for the tool-result-driven scenarios.
2. **`test/integration/scenarios.md`** — the integration-test documentation (Mode A: this IS the docs).
   Explains how to run each F-* scenario (deterministic command path + model-driven prompt path), the exact
   `pi` invocation, and the expected log/JSONL results + pass criteria.
3. **`test/integration/run-smoke.mjs`** — a plain-Node ESM orchestrator. For each scenario it spawns
   `pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id <stable> -p "/mulligan_smoke <s>"`,
   parses the smoke JSONL log + the session JSONL, asserts the §2.1/§2.3 criteria, prints PASS/FAIL, and
   exits non-zero on any failure. F-reload = two runs sharing `--session-id`.
4. **`package.json`** — change `scripts.smoke` from the placeholder to `"node test/integration/run-smoke.mjs"`.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (smoke.ts type-checks; the orchestrator is `.mjs`, not
  type-checked — it is shell-like glue). *NOTE: smoke.ts may need to be added to tsconfig `include` OR kept
  out of it — see GOTCHA #6; verify tsc stays green.*
- `npm run smoke` runs all 9 deterministic scenarios, prints a PASS/FAIL line per scenario, and **exits 0**
  when all pass (non-zero otherwise). It must run **without requiring an API key** for the deterministic
  scenarios — see GOTCHA #8 (the model only responds to a trivial follow-up; if even that is unavailable,
  the harness still asserts on the persisted markers + the session JSONL, which are written BEFORE any
  model call).
- Each F-* scenario asserts the exact §2.1 pass criteria AND the §2.3 JSONL invariants
  (`mulligan:rewind`/`mulligan:shrink`/`mulligan:turn-metric` = `type:"custom"`; `mulligan:note` =
  `type:"custom_message"`; `mulligan:checkpoint:` = `type:"label"`; ZERO `mulligan:nudge` entries on disk).
- `pi -e ./src/index.ts -e ./test/integration/smoke.ts -p "/mulligan_smoke F-protected"` dispatches the
  command and exits cleanly (no uncaught exception).

---

## User Persona

**Target User**: (a) **The Mulligan developer/maintainer** — gets a runnable, reliable end-to-end suite that
catches regressions in the Pi-coupled glue (the parts unit tests fake out): real `context`-event chaining,
real marker persistence + reload, real tool refusal paths, real nudge injection. (b) **A future contributor
or reviewer** — `scenarios.md` is the playbook to reproduce any scenario by hand and read what "pass" means.

**Use Case**: A maintainer runs `npm run smoke` before merging. It spins up real `pi` subprocesses with the
Mulligan extension + the smoke helper, drives each F-* scenario deterministically, and reports which pass.
On a regression (e.g. the filter stops dropping the canary after a rewind), the failing scenario's
`/tmp/mulligan-smoke.log` shows exactly which `context.fire` observables went wrong.

**User Journey**:
1. `npm run smoke` → `run-smoke.mjs` iterates the 9 scenarios.
2. For each: clear `/tmp/mulligan-smoke.log`; spawn `pi -e ./src/index.ts -e ./test/integration/smoke.ts
   --session-id smoke-<scenario> -p "/mulligan_smoke <scenario>"`.
3. Pi transpiles both extensions via jiti, calls both factories (Mulligan first, smoke second), loads tools +
   handlers in `-e` order.
4. The `/mulligan_smoke` command handler (in smoke.ts) sets up the scenario's state via the REAL tools
   (e.g. `makeRewindTool(pi).execute(…)`) + canaries, then calls `pi.sendUserMessage("ok",
   {deliverAs:"followUp"})` to trigger the observing inference.
5. The follow-up inference fires `context` → Mulligan filters → smoke's handler (runs second) logs
   `context.fire` (canary now absent / shrink now applied) → the model answers the trivial follow-up.
6. `run-smoke.mjs` parses `/tmp/mulligan-smoke.log` + the session JSONL, asserts the §2.1/§2.3 criteria,
   prints `PASS F-…` / `FAIL F-… (reason)`.
7. All 9 pass → exit 0; any fail → exit 1 + a summary.

**Pain Points Addressed**: (a) The unit tests fake out `ExtensionAPI`/`ExtensionContext` — they can't prove
the real `context` event flows through Mulligan's filter to the model. (b) The pure transforms are proven in
isolation, but composition with real Pi session entries (CustomEntry vs CustomMessage vs LabelEntry shapes),
real `sendUserMessage` follow-up semantics, and real reload is unverified without this harness. (c) Model
unreliability: a naive "prompt the model to call the tool" suite is flaky; this harness removes that
dependency by driving scenarios from an extension command and using the model only for a trivial reply.

---

## Why

- **This is the verification capstone (spec §8; spec/10 §2).** spec §8: "a deterministic command-based suite
  for the data layer, and model-driven integration runs that prove the `context`-filter takes effect on the
  next inference and the model auto-continues. Pass/fail criteria are tied to the same observables used in
  the spike (message counts in the filtered payload, persisted entry shapes in session JSONL)." This task
  delivers exactly that, adapted from the proven spike.
- **The chaining discovery makes a clean observer possible.** Verified in Pi's `runner.js#emitContext`
  (research §1): context handlers CHAIN in `-e` order, each receiving the prior handler's transformed
  messages. So the smoke helper loaded SECOND sees the POST-filter messages and can observe
  `canaryPresent=false` after a rewind — exactly the spike's proof, without reimplementing the filter.
  (The spike had to be its own filter because it was the ONLY extension.)
- **`pi -p "/cmd"` dispatches extension commands (research §5).** This is the spike's trick
  (`pi -e ./looper-smoke.ts -p "/looper_test"`) and it is verified in Pi's `agent-session.js`
  `_tryExecuteExtensionCommand`. It lets the harness drive scenarios deterministically with NO model
  judgment — the model only answers a trivial follow-up, so the suite is reliable and API-key-tolerant.
- **The deterministic path uses the REAL tools (research §6).** The smoke helper imports
  `makeRewindTool`/`makeShrinkTool`/`makeCheckpointTool` from `../../src/tools/*.js` (shared module, same
  process) and calls `execute(…)` directly. So F-protected/F-maxdepth exercise the ACTUAL refusal logic, and
  F-rewind/F-shrink/F-checkpoint persist markers through the ACTUAL wrappers — not reimplementations.
- **Print mode persists the session JSONL (research §3, §4).** `SessionManager.create` → `persist=true`; the
  file is `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<sessionId>.jsonl`. So the §2.3 entry-shape
  invariants are assertable from disk, and F-reload works via `--session-id` (create-then-reopen).

---

## What

CREATE 3 files + UPDATE 1. **No `src/` changes.**

### Artifact 1 — `test/integration/smoke.ts` (Pi helper extension)

A default-export factory `(pi: ExtensionAPI) => void` that is loaded as the SECOND `-e`. It:

1. **Reads config from env at load**: `const SMOKE_LOG = process.env.MULLIGAN_SMOKE_LOG ??
   "/tmp/mulligan-smoke.log";` and truncates it once at factory time (`writeFileSync(SMOKE_LOG, "# mulligan
   smoke " + new Date().toISOString() + "\n")`, wrapped in try/catch — never crash on a bad path).
2. **A `smokeLog(test, status, detail)` helper** (adapted from the spike's `log()`): appends one JSONL line
   `{ts, test, status, detail}` to `SMOKE_LOG` AND writes a short line to `process.stderr` (so `pi -p`
   captures it on stderr). All wrapped in try/catch — logging never crashes the extension.
3. **`session_start` handler**: `pi.on("session_start", (_e, ctx) => { smokeLog("session.start", "info",
   { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
   leafId: ctx.sessionManager.getLeafId() }); /* inject the message canary for observing-context scenarios */
   try { pi.sendMessage({ customType:"mulligan_smoke_canary", content:"MULLIGAN-SMOKE-MSG-CANARY",
   display:false }); } catch {} smokeLog("setup.canary", "info", { ok:true }); })`. *(The sessionFile is
   logged so the orchestrator can find the JSONL for the §2.3 assertions.)*
4. **`context` handler (THE OBSERVER — MUST return void)**: `pi.on("context", (event, ctx) => { try { const
   msgs = event.messages as any[]; const entries = ctx.sessionManager.getEntries(); const hasRewindMarker =
   entries.some(e => e?.type === "custom" && e?.customType === "mulligan:rewind"); const notePresent =
   msgs.some(m => m?.customType === "mulligan:note"); const msgCanary = msgs.some(m =>
   JSON.stringify(m).includes("MULLIGAN-SMOKE-MSG-CANARY")); const resultCanary = msgs.some(m =>
   JSON.stringify(m).includes("MULLIGAN-SMOKE-RESULT-CANARY")); const shrunk = msgs.some(m =>
   JSON.stringify(m).includes("MULLIGAN-SMOKE-SHRUNK")); smokeLog("context.fire", "info", { count:
   msgs.length, msgCanaryPresent: msgCanary, resultCanaryPresent: resultCanary, notePresent, hasRewindMarker,
   shrunkInContext: shrunk, hasNudge: msgs.some(m => m?.customType === "mulligan:nudge") }); } catch (e) {
   smokeLog("context.fire", "fail", { error: String(e) }); } /* return void = pass-through, do NOT
   override Mulligan's filter */ })`. This mirrors the spike's `context.fire` log with the spike's field
   shape (`count`, `canaryPresent`, `notePresent`, `hasRewindMarker`) — `spec/10 §2.2` requires this exact
   observable set.
5. **`mulligan_smoke_big` test tool** (for tool-result-driven scenarios): `pi.registerTool({ name:
   "mulligan_smoke_big", label:"Big Result", description:"SMOKE TEST TOOL. Returns a >8KB canary result.
   Call when asked.", parameters: Type.Object({}), async execute() { const big =
   "MULLIGAN-SMOKE-RESULT-CANARY " + "x".repeat(9000); smokeLog("tool.smoke_big", "info", { len: big.length
   }); return { content: [{ type:"text" as const, text: big }] }; } })`. The >8KB size triggers Mulligan's
   bloat reminder (F-shrink-preventive); the canary string is the observable for last_tool_call_group rewind
   (F-rewind-core) and shrink (F-shrink-persist).
6. **`/mulligan_smoke <scenario>` command** (THE DETERMINISTIC DRIVER):
   `pi.registerCommand("mulligan_smoke", { description:"drive a smoke scenario deterministically",
   handler: async (args, ctx) => { await driveScenario(pi, ctx, args.trim()); } })`. `driveScenario`
   dispatches on the scenario name and uses the REAL tool factories + `sendUserMessage` follow-up. (See
   Implementation Tasks for the per-scenario bodies + the exact tool-param shapes, which are verified in
   research §13 / the schemas below.)
7. **OPTIONAL mulligan-log enablement** (corroborating source, not required): at the top of the factory,
   `try { const { setConfig, getConfig } = await import("../../src/config.js"); const { setLogFile } = await
   import("../../src/log.js"); setConfig({ log: { file: SMOKE_LOG + ".mulligan" } });
   setLogFile(getConfig().log.file); } catch {}` — enables Mulligan's OWN `filter.fire {before,after}`
   logging (research §9). Use STATIC imports (not dynamic) and wrap in try/catch; if it fails, the smoke
   helper's own log is sufficient. *(Keep this OPTIONAL/simple — the smoke log is the primary source.)*

### Artifact 2 — `test/integration/scenarios.md` (Mode A docs)

A markdown doc with, for EACH of the 9 F-* scenarios: (a) what it tests (1 line); (b) the deterministic
`pi` command to run it; (c) the model-driven alternative prompt; (d) the expected `context.fire`/log
observables; (e) the expected session-JSONL entries + §2.3 invariant check; (f) the pass criteria. Mirror
the spec/10 §2.1 table. Plus a header explaining the two-extension load order, the log location, and how to
read `/tmp/mulligan-smoke.log`.

### Artifact 3 — `test/integration/run-smoke.mjs` (orchestrator)

Plain Node ESM (`import { spawnSync } from "node:child_process"; import { readFileSync, existsSync,
mkdirSync, rmSync } from "node:fs";`). For each scenario in `SCENARIOS = ["F-rewind-core", …, "F-reload"]`:
(a) set `MULLIGAN_SMOKE_LOG` to a per-scenario path under a temp dir; (b) build the `pi` argv
(`-e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<scenario> -p "/mulligan_smoke
<scenario>"`); (c) `spawnSync("pi", argv, { encoding:"utf8", env:{…process.env, MULLIGAN_SMOKE_LOG}, timeout:
120_000 })`; (d) parse the smoke JSONL (split lines, `JSON.parse`, collect the `context.fire` entries + the
`session.start` sessionFile); (e) read the session JSONL (from the logged sessionFile) and walk entries; (f)
run the scenario's assertion function; (g) print `PASS F-…` or `FAIL F-… (<reason>)`. F-reload runs TWO
spawns sharing `--session-id smoke-F-reload`. Exit `failCount === 0 ? 0 : 1`.

### Artifact 4 — `package.json`

Change `"smoke"` in `scripts` from the placeholder to `"node test/integration/run-smoke.mjs"`. Leave
`"test": "vitest run"` and all other fields untouched.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The CRITICAL Pi behavior (context-handler chaining in `-e` order, print-mode
> persistence, `/cmd` dispatch, `sendUserMessage` follow-up) is verified and quoted in the research notes
> and the GOTCHAs below. The exact tool param schemas (verified from src) are in research §13 + Implementation
> Tasks. The exact customType→entry-type invariants are quoted from `src/markers.ts`. The spike
> (`spec/reference/looper-smoke.proto.ts`) is a complete working reference for the observer/command/log
> patterns. The orchestrator is plain Node (no framework). The predecessor PRP guarantees the complete
> extension loads via `pi -e ./src/index.ts`. No prior knowledge beyond "write these 4 artifacts using the
> verified facts" is required.

### Documentation & References

```yaml
# MUST READ — the proven prototype to adapt (rename looper_* → mulligan_*, restructure for 2-extension load)
- file: spec/reference/looper-smoke.proto.ts
  why: "The COMPLETE working reference. Copy its log() helper, its context-fire observation shape, its
        registerCommand/registerTool patterns, and its sendUserMessage({deliverAs:'followUp'}) follow-up
        technique. The ONLY structural change: it was a SINGLE self-filtering extension; the smoke helper
        is now the SECOND extension (observer-only, returns void) and the REAL filter lives in src/index.ts."
  pattern: "session_start canary injection; context.fire {count,canaryPresent,notePresent,hasRewindMarker};
            registerCommand deterministic suite; registerTool test tool; sendUserMessage followUp dispatch."
  gotcha: "The spike's context handler RETURNED {messages: filtered} (it WAS the filter). The smoke helper
           MUST return void (observer only) — returning {messages} would OVERRIDE Mulligan's real filter
           (last writer wins in the chain — research §1)."

# MUST READ — the scenarios + pass criteria + JSONL invariants (the spec this harness implements)
- file: spec/10-testing.md
  section: "§2.1 (the 9 F-* scenarios + pass criteria table), §2.2 (driving reliability — deterministic
            command path), §2.3 (session JSONL assertions + the 4 key invariants)."
  why: "§2.1 IS the pass criteria. §2.2 mandates the /mulligan_smoke <scenario> deterministic fallback.
        §2.3 mandates the exact entry-shape invariants the orchestrator must assert."

# MUST READ — the architecture (what the harness observes: 4 tools + context filter + 2 nudges)
- file: spec/03-architecture.md
  section: "§4 (the 4 tools, 1 context filter, 2 nudges; the data flow on a rewind)."
  why: "§4's rewind data flow (appendEntry marker + sendMessage note → next context fire drops the span) is
        EXACTLY what F-rewind-core observes. The customEntry vs customMessage distinction (control state vs
        in-context note) is the §2.3 invariant."

# THE VERIFIED PI BEHAVIOR (the crux — read before writing smoke.ts)
- file: plan/001_2e5baf25fe9f/P1M7T2S1/research/verified_findings.md
  section: "§1 context handlers CHAIN in -e order (emitContext); §2 load order = -e flag order; §3 print mode
            persists session JSONL; §4 --session-id create-if-missing (F-reload); §5 pi -p '/cmd' dispatches
            extension commands; §6 deterministic path can call REAL tool factories; §7 sendUserMessage
            follow-up triggers the observing inference; §8 customType→entry-type invariants; §9 mulligan log
            vs smoke log; §10 canary is scenario-specific; §12 orchestrator shape."
  why: "EVERY non-obvious decision in this PRP traces to a verified fact here. If a behavior seems surprising
        (e.g. 'why does the smoke helper see post-filter messages?'), the answer + the Pi source line is in
        this file."

# THE VERIFIED PI API SURFACE (event/tool/session shapes)
- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§2.1 (appendEntry/sendMessage/setLabel/sendUserMessage/on/registerTool/registerCommand);
            §4 (getSessionFile/getSessionId/getEntries/getLabel on ReadonlySessionManager); §5 (CustomEntry
            vs CustomMessageEntry vs LabelEntry shapes); §7.1 (ContextEvent/ContextEventResult); §7.5/§7.6
            (session_start/session_shutdown)."
  why: "§2.1 confirms sendUserMessage + registerCommand are on ExtensionAPI (the smoke helper uses both).
        §4 confirms getSessionFile() is readable (the orchestrator needs the JSONL path). §5 confirms the
        entry type strings to assert on ('custom'/'custom_message'/'label')."

# THE CONSUMED MULLIGAN MODULES (exact export names — treat as contracts; src/ is READ-ONLY)
- file: src/tools/rewind.ts
  section: "export function makeRewindTool(pi): ToolDefinition<typeof RewindParams, RewindDetails>. RewindParams
            = { note:{what_happened,avoid,true_current_state,next}, granularity:'last_tool_call_group'|
            'last_turn'|'checkpoint', to_previous_prompt?:boolean, checkpoint?:string }. execute(toolCallId,
            params, signal, onUpdate, ctx)."
- file: src/tools/shrink.ts
  section: "export function makeShrinkTool(pi): ToolDefinition<typeof ShrinkParams, ShrinkDetails>. ShrinkParams
            = { target:{by_tool_call_id:string}|{by_tool_name:string,occurrence:'last'|'first'}|
            {by_content_includes:string}, replacement:string, reason?:string }."
- file: src/tools/checkpoint.ts
  section: "export function makeCheckpointTool(pi): ToolDefinition<typeof CheckpointParams, CheckpointDetails>.
            CheckpointParams = { name:string } (validated /^[a-z0-9_-]{1,40}$/)."
- file: src/markers.ts
  section: "appendRewindMarker(pi,ctx,data)/appendShrinkMarker(pi,ctx,data)/appendTurnMetric(pi,ctx,data)/
            leaveNote(pi,content,rewindId)/setCheckpoint(pi,ctx,name) — the raw wrappers, importable for
            scenarios that bypass tool validation. RewindMarkerInput/ShrinkMarkerInput/TurnMetricInput types."
  why: "The /mulligan_smoke command imports these to drive scenarios through the REAL code (research §6)."

# SIBLING PRP — the predecessor (will be COMPLETE when this runs)
- file: plan/001_2e5baf25fe9f/P1M7T1S1/PRP.md
  section: "Produces the COMPLETE src/index.ts factory (4 tools + 3 handlers + lifecycle). Guarantees
            'pi -e ./src/index.ts -p hi' loads + exits 0. Notes package.json scripts.smoke is a PLACEHOLDER
            that P1.M7.T2 (THIS task) replaces."
  why: "This task CONSUMES the predecessor's output (the live extension). The 2-extension load order (-e
        src first, -e smoke second) depends on the predecessor's factory loading cleanly."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # "main":"src/index.ts"; "pi":{"extensions":["./src/index.ts"]}; type:'module';
│                           #   scripts.test:'vitest run'; scripts.smoke: PLACEHOLDER (THIS TASK replaces it).
├── tsconfig.json           # strict, include:['src','test']  ← smoke.ts lives under test/, so it IS included.
├── src/                    # THE COMPLETE EXTENSION (all Complete per <plan_status>; index.ts wired by P1.M7.T1.S1).
│   ├── index.ts            # factory (P1.M7.T1.S1): registers 4 tools + 3 handlers + lifecycle. DO NOT TOUCH.
│   ├── config.ts / log.ts / runtime.ts / markers.ts / filter.ts / nudges.ts / transforms.ts / …  # DO NOT TOUCH.
│   └── tools/{rewind,shrink,checkpoint,audit}.ts  # makeRewindTool/makeShrinkTool/makeCheckpointTool/auditTool.
├── test/                   # unit tests (vitest). *.test.ts. DO NOT TOUCH.
└── test/integration/       # DOES NOT EXIST YET — THIS TASK CREATES IT (smoke.ts, scenarios.md, run-smoke.mjs).
# VERIFIED: `pi` v0.84.x on PATH. `pi -e <a> -e <b>` loads both in flag order. `pi -p "/cmd args"` dispatches
#   the extension command. Print mode persists ~/.pi/agent/sessions/--<encoded-cwd>--/<ts>_<id>.jsonl.
# NOTE: NO eslint/prettier/biome. The type gate is `tsc --noEmit`. The smoke .mjs orchestrator is NOT type-checked.
```

### Desired Codebase tree with files to be CREATED / MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── package.json                                   # MODIFIED: scripts.smoke → "node test/integration/run-smoke.mjs".
├── test/integration/
│   ├── smoke.ts                                   # NEW: Pi helper extension (observer + /mulligan_smoke driver).
│   ├── scenarios.md                               # NEW: integration-test docs (Mode A) — the 9 F-* playbooks.
│   └── run-smoke.mjs                              # NEW: plain-Node orchestrator (spawns pi, parses logs, asserts).
# No src/ file is touched.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL — the whole architecture) — context handlers CHAIN in -e order; the smoke helper MUST
#   be the SECOND -e and MUST return void. Verified: dist/core/extensions/runner.js emitContext iterates
#   this.extensions (load order = -e flag order) and flows `currentMessages = handlerResult.messages` into
#   the next handler. So `pi -e ./src/index.ts -e ./test/integration/smoke.ts` → Mulligan's contextHandler
#   runs FIRST (returns {messages: filtered}); smoke's context handler runs SECOND and sees the POST-FILTER
#   messages → canaryPresent=false after a rewind. IF you reverse the -e order, smoke sees PRE-filter (canary
#   always present) → every assertion fails. IF smoke returns {messages: …} instead of void, it OVERRIDES
#   Mulligan's filtered set (last writer wins) → the model sees smoke's (unfiltered) messages and the filter
#   is silently defeated. ⟹ load order: src FIRST, smoke SECOND; smoke context handler returns void.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL — the deterministic driver) — a command that calls tool.execute() directly does NOT
#   trigger an inference, so NO context event fires → the filter's effect is unobservable. To observe it,
#   the command must trigger a follow-up inference: pi.sendUserMessage("ok", { deliverAs:"followUp" }).
#   Verified: deliverAs:"followUp" (from inside a tool/command) queues a follow-up user message that resumes
#   the agent loop → fires context → Mulligan filters → smoke logs context.fire. This is the spike's proven
#   A6 technique. The model only answers "ok" → minimal dependence. WITHOUT this, scenarios that assert on
#   context.fire (F-rewind-core, F-shrink-persist, F-nudge-drift, F-checkpoint, F-reload) cannot observe
#   the post-marker inference and will spuriously "pass" (no context.fire lines) or fail.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (the canary is NOT a fixed message) — the real filter removes only the span a rewind TARGETS
#   (last tool-call group / last turn / checkpoint) or the content a shrink REPLACES. It does NOT drop an
#   arbitrary canary whenever a marker exists (that was spike-only test behavior). So:
#   • last_tool_call_group rewind → removes a TOOL GROUP → the canary must live in a tool RESULT (use
#     mulligan_smoke_big, marker "MULLIGAN-SMOKE-RESULT-CANARY"). Observe resultCanaryPresent.
#   • last_turn / checkpoint rewind → removes a SPAN that may include the session_start canary custom_message
#     (marker "MULLIGAN-SMOKE-MSG-CANARY") IF it falls in the removed span. Position accordingly.
#   • shrink → REPLACES content → observe shrunkInContext ("MULLIGAN-SMOKE-SHRUNK") + the original still on disk.
#   The smoke context.fire logs BOTH msgCanaryPresent AND resultCanaryPresent so each scenario asserts on the
#   RIGHT canary. If you inject one fixed canary and assert it for all scenarios, last_tool_call_group will
#   never drop it → false failures.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (pi -p "/cmd" dispatches the command, NOT a model call) — verified agent-session.js
#   _tryExecuteExtensionCommand: if text.startsWith("/"), parse /<name> <args>, run command.handler(args, ctx),
#   return true → the prompt is NOT sent to the model. So "/mulligan_smoke F-protected" runs the command and
#   NO model call happens for THAT prompt. This is why the command must itself trigger the follow-up (GOTCHA #2)
#   when an observing inference is needed. For pure-refusal scenarios (F-protected, F-maxdepth) the tool's
#   refusal TEXT is the assertion — read it from the tool result (execute() return value), not from a model
#   reply. (The command logs the refusal text to the smoke log; the orchestrator asserts on it.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (finding the session JSONL) — the orchestrator needs the on-disk .jsonl path for the §2.3 entry
#   assertions. Do NOT hardcode/guess it. The smoke helper logs it at session_start:
#   ctx.sessionManager.getSessionFile() (ReadonlySessionManager HAS getSessionFile — api_verification §4).
#   The orchestrator reads the smoke log's "session.start" line → detail.sessionFile → reads that file. For
#   F-reload, BOTH runs share --session-id smoke-F-reload, so the file is the SAME (appended across runs).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (tsc includes test/) — tsconfig include is ['src','test']. smoke.ts is under test/integration/,
#   so tsc WILL type-check it. It must compile clean: import ExtensionAPI type-only; use `.js` extensions on
#   the src/ imports (ESM Bundler — `../../src/tools/rewind.js`); the typebox Type import for the test tool.
#   run-smoke.mjs is .mjs → NOT in any tsconfig → NOT type-checked (it is shell-like glue using spawnSync +
#   JSON.parse; keep it simple and defensive). If smoke.ts causes tsc friction (e.g. the ExtensionAPI import
#   path), prefer adjusting smoke.ts — do NOT widen tsconfig.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (mulligan logging is OFF by default) — config.log.file defaults to null; v1 has NO settings
#   accessor (P1.M7.T1.S1 GOTCHA #3), so setConfig(undefined) at Mulligan's factory time leaves logging off.
#   The smoke helper's OWN log (/tmp/mulligan-smoke.log) is the PRIMARY assertion source and needs NO mulligan
#   config. OPTIONALLY enable mulligan's own filter.fire log by calling setConfig({log:{file:…}})+setLogFile(…)
#   from the shared ../../src/config.js + ../../src/log.js (same process → shared module cache). Wrap in
#   try/catch; if it throws, the smoke log alone is sufficient. Do NOT rely on mulligan's log for the core
#   assertions (it may be off); use it only as corroboration.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 (API-key tolerance) — the deterministic path needs the model ONLY to answer a trivial follow-up
#   ("ok"). In an env with NO API key, the follow-up inference will FAIL (Pi errors the assistant turn), but:
#   (a) the markers are ALREADY persisted before the follow-up; (b) the session JSONL is written; (c) the
#   context event STILL fires before the failed inference (Mulligan's filter runs, smoke logs context.fire).
#   So the CORE assertions (context.fire observables + JSONL invariants + tool-refusal text) hold even with
#   no key. ONLY the "a second assistant message is produced (auto-prompt)" sub-criterion of F-rewind-core
#   needs a working key — make that assertion SOFT (warn, don't fail) so the suite is CI-runnable. Document
#   this in scenarios.md.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 (F-failopen needs a real throw inside the filter) — the filter is fail-open by construction
#   (src/filter.ts wraps the whole body in try/catch → pass-through). To TEST fail-open you must FORCE a throw.
#   Cleanest: the /mulligan_smoke F-failopen command monkey-patches a Mulligan internal for ONE fire, OR
#   (simpler, no src/ change) it appends a MALFORMED mulligan:rewind marker (e.g. pi.appendEntry("mulligan:rewind",
#   { kind:"rewind", /* missing required fields */ })) that makes readMarkers' cast succeed but filterPipeline
#   throw on use. Assert: context.fire shows NO crash (the turn survives) AND mulligan logged filter.fire
#   error OR the smoke context.fire count is unchanged (pass-through). Verify the EXACT throw surface against
#   transforms.ts at implementation time; if no clean malformed-marker throw exists, fall back to documenting
#   F-failopen as "verified by the unit test in filter.test.ts (handler never throws)" + a manual note, rather
#   than a fragile harness hack. Prefer correctness over forcing a brittle scenario.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 (F-nudge-drift is the hardest to force deterministically) — the drift nudge fires when a turn's
#   deltaTokens > driftThresholdTokens (default 3000). The turn_end handler computes the delta from an
#   in-memory baseline. Forcing >3000 tokens of growth in a deterministic command is awkward. Two options:
#   (A) LOWER the threshold via the smoke helper calling setConfig({ nudges:{ driftThresholdTokens:1 } }) so
#       ANY turn triggers it — then the next context.fire shows hasNudge:true. Clean + deterministic. BUT note
#       mulligan caches config at factory time; the smoke helper's setConfig must run AFTER mulligan's factory
#       (it does — smoke is loaded second) AND before the observing inference. Verify getConfig() reads the
#       updated cache (it does — same module/cache). (B) Use mulligan_smoke_big (>8KB ≈ >2000 tokens) twice.
#   Prefer (A) — it directly tests the nudge injection path. Assert: hasNudge:true in context.fire AND ZERO
#   mulligan:nudge entries in the session JSONL (ephemeral — §2.3 invariant).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 (the smoke helper must NOT register conflicting tools/handlers that break Mulligan) — the smoke
#   helper registers mulligan_smoke_big (a NEW name, no conflict) and /mulligan_smoke (a NEW command). It does
#   NOT re-register mulligan_rewind etc. (those come from src/index.ts). Its context/tool_result/turn_end
#   handlers are ADDITIVE observers (return void) — they do not interfere with Mulligan's. Do NOT have smoke
#   return {messages} from context (GOTCHA #1) or {content} from tool_result (would rewrite results).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 (the predecessor's factory must load FIRST and cleanly) — if src/index.ts has a wiring error
#   (e.g. the non-existent rewindTool import — P1.M7.T1.S1 GOTCHA #1), `pi -e ./src/index.ts …` fails BEFORE
#   smoke loads, and EVERY scenario fails with a load error. The orchestrator should detect a non-zero pi exit
#   with NO smoke-log output and report "EXTENSION LOAD FAILED" distinctly from a scenario assertion failure,
#   so the maintainer knows to look at src/index.ts, not the harness.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

The smoke helper defines no shared types. Its internal shape is the log line `{ts, test, status, detail}`
(adapted from the spike) plus the scenario-driver dispatch. The tool param shapes it passes to the REAL
tools are the VERIFIED mulligan schemas (research §13):

```ts
// RewindParams (verified src/tools/rewind.ts) — what /mulligan_smoke passes to makeRewindTool(pi).execute():
{ note: { what_happened: string; avoid: string; true_current_state: string; next: string };
  granularity: "last_tool_call_group" | "last_turn" | "checkpoint";
  to_previous_prompt?: boolean; checkpoint?: string }
// ShrinkParams (src/tools/shrink.ts):
{ target: { by_tool_call_id: string } | { by_tool_name: string; occurrence: "last"|"first" }
           | { by_content_includes: string };
  replacement: string; reason?: string }
// CheckpointParams (src/tools/checkpoint.ts): { name: string }  // /^[a-z0-9_-]{1,40}$/
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES (no edits — run only; assume P1.M7.T1.S1 is COMPLETE)
  - RUN: grep -n "export default function" src/index.ts          # MUST print (the factory exists)
  - RUN: grep -n "makeRewindTool\|makeShrinkTool\|makeCheckpointTool\|auditTool" src/index.ts  # 4 tool wirings
  - RUN: timeout 60 pi -e ./src/index.ts -p "hi"                  # MUST load + exit 0 (the predecessor's gate)
  - RUN: timeout 60 pi -e ./src/index.ts -p "/mulligan_smoke nosuch" 2>&1 | head   # no command yet → prints nothing
        (this confirms Mulligan loads; the unknown-command is expected — smoke.ts adds it in Task 1)
  - RUN: npx tsc --noEmit -p tsconfig.json                       # baseline green (predecessor's gate)
  NOTE: if pi exits non-zero on the first run, src/index.ts is not wired yet → STOP (predecessor incomplete).

Task 1: CREATE test/integration/smoke.ts   (the Pi helper extension — observer + /mulligan_smoke driver)
  - HEAD: import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
          import { Type } from "typebox";
          import { appendFileSync, writeFileSync } from "node:fs";
          // REAL mulligan tools (shared module, same process — research §6):
          import { makeRewindTool } from "../../src/tools/rewind.js";
          import { makeShrinkTool } from "../../src/tools/shrink.js";
          import { makeCheckpointTool } from "../../src/tools/checkpoint.js";
          // (OPTIONAL corroborating log — wrap in try/catch; GOTCHA #7):
          import { setConfig, getConfig } from "../../src/config.js";
          import { setLogFile } from "../../src/log.js";
  - SMOKE_LOG from env (default /tmp/mulligan-smoke.log); truncate once at factory time (try/catch).
  - smokeLog(test,status,detail): appendFileSync JSONL line + process.stderr line; never throw.
  - export default function (pi: ExtensionAPI): void { … the 6 pieces from "What → Artifact 1" … }
    PIECES (in order):
      (1) OPTIONAL enable-mulligan-log (try/catch; setConfig({log:{file: SMOKE_LOG+".mulligan"}}) + setLogFile).
      (2) session_start handler → smokeLog("session.start", "info", {sessionId, sessionFile, leafId}) +
          inject msg-canary via pi.sendMessage({customType:"mulligan_smoke_canary",
          content:"MULLIGAN-SMOKE-MSG-CANARY", display:false}).
      (3) context handler (OBSERVER → return void) → smokeLog("context.fire", "info",
          {count, msgCanaryPresent, resultCanaryPresent, notePresent, hasRewindMarker, shrunkInContext,
          hasNudge}) — the fields from GOTCHA #1/#3 + spec/10 §2.2.
      (4) registerTool mulligan_smoke_big → returns "MULLIGAN-SMOKE-RESULT-CANARY " + "x".repeat(9000)
          (>8KB → triggers Mulligan bloat reminder; GOTCHA #3/#10).
      (5) registerCommand "mulligan_smoke" → handler(args, ctx) => driveScenario(pi, ctx, args.trim()).
      (6) driveScenario dispatch (see per-scenario recipes below). Each scenario that needs an observing
          inference ENDS with: pi.sendUserMessage("ok", { deliverAs:"followUp" }) (GOTCHA #2).
  - CONSTRAINTS:
      * context handler returns VOID (GOTCHA #1). tool_result/turn_end handlers (if any) also return void.
      * The REAL tool calls use execute(toolCallId, params, undefined, undefined, ctx) with a synthetic
        toolCallId (e.g. "smoke-rewind-1") — research §6.
      * The command handler's ctx is ExtensionCommandContext (has sessionManager) — pass it as the execute ctx.
      * ALL imports of src/ use .js extensions (ESM Bundler — GOTCHA #6).
      * NEVER throw out of the factory/handlers (mirror the spike's try/catch discipline).
  - PER-SCENARIO RECIPES (driveScenario switch — use the REAL tools; verify exact fields at impl time):
      F-rewind-core: log "scenario.start"; the mulligan_smoke_big result is the canary (it was produced by a
        prior /mulligan_smoke F-rewind-core-setup OR injected as a synthetic toolResult — see NOTE below);
        call makeRewindTool(pi).execute("smoke-rewind-1", { note:{4 fields}, granularity:"last_tool_call_group" },
        undefined, undefined, ctx); log the tool result (assert it is a SUCCESS, not a refusal);
        pi.sendUserMessage("ok",{deliverAs:"followUp"}). ASSERT (orchestrator): context.fire after the rewind
        shows resultCanaryPresent:false AND hasRewindMarker:true; session JSONL has mulligan:rewind(custom) +
        mulligan:note(custom_message).
      F-shrink-persist: produce a mulligan_smoke_big result (the canary); call makeShrinkTool(pi).execute(
        "smoke-shrink-1", { target:{by_content_includes:"MULLIGAN-SMOKE-RESULT-CANARY"},
        replacement:"MULLIGAN-SMOKE-SHRUNK", reason:"test" }, undefined, undefined, ctx); sendUserMessage
        followUp. ASSERT: context.fire shows shrunkInContext:true; session JSONL toolResult still contains
        the ORIGINAL canary (shrink is a view-substitution, NOT a JSONL rewrite) + mulligan:shrink(custom).
      F-shrink-preventive: ensure config.nudges.bloatReminder true (default); produce mulligan_smoke_big
        (>8KB) via a setup step that the AGENT calls (model-driven) OR assert the bloat-reminder path via the
        unit test. DETERMINISTIC ALT: call makeCheckpointTool or a no-op to end the turn, then read the
        turn-metric. ASSERT: a turn-metric entry with bloatHit:true exists in JSONL; the result content has
        the [mulligan] reminder (if model-driven). See GOTCHA — this is the most model-dependent; document it.
      F-nudge-drift: setConfig({nudges:{driftThresholdTokens:1}}) to force the nudge (GOTCHA #10); run one
        turn; sendUserMessage followUp. ASSERT: context.fire hasNudge:true AND ZERO mulligan:nudge in JSONL.
      F-protected: call makeRewindTool(pi).execute("smoke-prot-1", { note:{4 fields}, granularity:"last_turn",
        to_previous_prompt:true }, …, ctx) when only ONE user message exists (the /mulligan_smoke prompt
        itself). ASSERT: tool result text contains "refused" (the protected-refusal path); NO mulligan:rewind
        entry in JSONL.
      F-maxdepth: loop 5× makeRewindTool(pi).execute(…, {granularity:"last_tool_call_group", note:{4
        fields}}, …) (each a distinct toolCallId); then a 6th. ASSERT: the 6th result text contains "depth"
        / "refused"; exactly 5 mulligan:rewind entries in JSONL.
      F-checkpoint: makeCheckpointTool(pi).execute("smoke-cp-1", {name:"alpha"}, …, ctx); then makeRewindTool
        (pi).execute("smoke-cp-rw-1", {note:{4 fields}, granularity:"checkpoint", checkpoint:"alpha"}, …, ctx);
        sendUserMessage followUp. ASSERT: JSONL has a label entry "mulligan:checkpoint:alpha" + a
        mulligan:rewind(custom); context.fire count drops to the checkpoint prefix.
      F-failopen: append a MALFORMED mulligan:rewind marker (pi.appendEntry("mulligan:rewind",
        {schema:"pi-mulligan",v:1,kind:"rewind",granularity:"last_tool_call_group"} /* missing note/seq/etc */));
        sendUserMessage followUp. ASSERT: the turn SURVIVES (no uncaught crash in pi's exit; context.fire still
        logs). If no clean throw is reachable (GOTCHA #9), fall back to: log "F-failopen: deferred to unit test
        filter.test.ts (handler-never-throws)" and mark the scenario PASS-with-note.
      F-reload: (run 1) makeRewindTool(...) → marker persisted; sendUserMessage followUp; log the sessionFile.
        (run 2, SAME --session-id) just sendUserMessage("ok") followUp. ASSERT run-2 context.fire shows
        hasRewindMarker:true AND the canary still hidden (marker survived reload).
      NOTE on producing the mulligan_smoke_big result deterministically: a tool RESULT only exists if the
        AGENT called the tool (model-driven). For a fully deterministic path, driveScenario can SYNTHESIZE a
        toolResult on the branch by... it CANNOT (no mutator on ReadonlySessionManager — C1). So the big-result
        canary scenarios (F-rewind-core, F-shrink-persist, F-shrink-preventive) use the session_start
        MSG-canary as the rewind target with granularity:"last_turn" instead, OR rely on a model-driven setup
        call to mulligan_smoke_big. PREFERRED deterministic approach: for F-rewind-core use
        granularity:"last_turn" against the msg-canary (it IS in the last turn) → resultCanaryPresent stays
        true but msgCanaryPresent goes true→false, which is the SAME "canary dropped" assertion. Document BOTH
        granularities in scenarios.md; the orchestrator asserts on the canary that the chosen granularity
        actually removes. (This keeps F-rewind-core deterministic without a model-driven tool call.)
  - NAMING/PLACEMENT: test/integration/smoke.ts.

Task 2: CREATE test/integration/scenarios.md   (Mode A docs — the integration test playbook)
  - HEADER: explain the 2-extension load order (-e src FIRST, -e smoke SECOND — GOTCHA #1), the log location
    (/tmp/mulligan-smoke.log or $MULLIGAN_SMOKE_LOG), how to read a context.fire line, and the §2.3 invariants.
  - ONE SECTION PER F-* scenario with: (a) "Tests:" 1 line; (b) "Run (deterministic):" the exact
    `pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-<S> -p "/mulligan_smoke <S>"`
    command; (c) "Run (model-driven):" the alternative prompt that asks the model to call the tool; (d) "Expect
    in log:" the context.fire observables; (e) "Expect in JSONL:" the entries + invariant; (f) "Pass:" the
    criteria. Mirror the spec/10 §2.1 table verbatim where possible.
  - A "Running the whole suite" section: `npm run smoke` (deterministic) + the API-key-tolerance note
    (GOTCHA #8) + the soft "auto-prompt" criterion.
  - NAMING/PLACEMENT: test/integration/scenarios.md.

Task 3: CREATE test/integration/run-smoke.mjs   (plain-Node orchestrator — NOT type-checked)
  - import { spawnSync } from "node:child_process"; import { readFileSync, existsSync, mkdirSync } from
    "node:fs"; import { join } from "node:path"; import { tmpdir } from "node:os";
  - const SCENARIOS = ["F-rewind-core","F-shrink-persist","F-shrink-preventive","F-nudge-drift",
    "F-protected","F-maxdepth","F-checkpoint","F-failopen","F-reload"];
  - const TMP = mkdirSync(join(tmpdir(),"mulligan-smoke"),{recursive:true});
  - HELPERS:
      runPi(scenario, extraArgs=[]) → spawnSync("pi", ["-e","./src/index.ts","-e",
        "./test/integration/smoke.ts","--session-id",`smoke-${scenario}`,"-p",`/mulligan_smoke ${scenario}`,
        ...extraArgs], {encoding:"utf8", env:{...process.env, MULLIGAN_SMOKE_LOG:
        join(TMP,`${scenario}.log`)}, timeout:120000});
      parseSmokeLog(path) → read lines, JSON.parse each, bucket by .test (e.g. contextFires =
        lines.filter(l=>l.test==="context.fire")); also extract sessionFile from the session.start line.
      readSessionEntries(sessionFile) → readFileSync(sessionFile,'utf8').split("\n").filter(Boolean)
        .map(JSON.parse) (the session JSONL is one JSON object per line).
      assert(label, cond, detail) → push to results; print PASS/FAIL.
  - PER-SCENARIO ASSERT FUNCTIONS (each takes {smokeLines, contextFires, sessionEntries, piResult}):
      F-rewind-core: contextFires.length>=2; the LAST contextFire (after rewind) has resultCanaryPresent||msgCanary
        Present === false (canary dropped) AND hasRewindMarker===true; sessionEntries has a custom mulligan:rewind
        AND a custom_message mulligan:note. SOFT (warn-only): a 2nd assistant message (auto-prompt) — needs a key.
      F-shrink-persist: last contextFire shrunkInContext===true; sessionEntries toolResult still contains the
        ORIGINAL "MULLIGAN-SMOKE-RESULT-CANARY" (NOT rewritten on disk) AND a custom mulligan:shrink.
      F-shrink-preventive: a turn-metric entry with bloatHit===true exists; (model-driven only) result has [mulligan].
      F-nudge-drift: last contextFire hasNudge===true; ZERO entries with customType mulligan:nudge in sessionEntries.
      F-protected: the tool-refusal smokeLog line (or the mulligan_smoke command result) contains "refus";
        ZERO mulligan:rewind in sessionEntries.
      F-maxdepth: exactly 5 mulligan:rewind custom entries; the 6th-attempt smokeLog contains "depth"/"refus".
      F-checkpoint: a label entry "mulligan:checkpoint:alpha"; a custom mulligan:rewind; contextFire count
        dropped vs the pre-rewind fire.
      F-failopen: piResult.status===0 (the turn survived); contextFires still logged. (PASS-with-note if
        deferred to the unit test per GOTCHA #9.)
      F-reload: run TWO runPi calls (same --session-id); parse BOTH logs; run-2 contextFires has
        hasRewindMarker===true AND canary hidden; run-1 sessionEntries has the mulligan:rewind (persisted).
      §2.3 GLOBAL (run for every scenario that creates markers): assert each mulligan:rewind/shrink/turn-metric
        entry.type==="custom"; each mulligan:note entry.type==="custom_message"; each checkpoint entry.type===
        "label"; ZERO mulligan:nudge entries (any type).
  - MAIN: for each scenario → runPi → parseSmokeLog → readSessionEntries → assert function → collect
    pass/fail. Print a summary table. process.exit(failCount===0?0:1). Handle GOTCHA #12: if pi exits non-zero
        AND the smoke log is empty → print "EXTENSION LOAD FAILED — check src/index.ts".
  - NAMING/PLACEMENT: test/integration/run-smoke.mjs.

Task 4: MODIFY package.json   (scripts.smoke → the orchestrator)
  - CHANGE: "smoke" in scripts from the placeholder to "node test/integration/run-smoke.mjs".
  - PRESERVE: "test":"vitest run", main, pi, dependencies, devDependencies, type — all unchanged.
  - FIND pattern: the existing `"smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""` line.

Task 5: VERIFY (run the gates)
  - RUN: npx tsc --noEmit -p tsconfig.json   # expect exit 0 (smoke.ts type-checks; GOTCHA #6)
  - RUN: timeout 120 pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-probe \
           -p "/mulligan_smoke F-protected" 2>&1 | tail   # expect the command runs, no crash
  - RUN: npm run smoke                         # expect: 9 PASS lines (or documented soft-fails) + exit 0
  - RUN: npm test                              # expect: all-green (smoke.ts under test/ must not break vitest;
                                               #   if vitest tries to run smoke.ts as a test, exclude it — GOTCHA)
```

### Implementation Patterns & Key Details

```ts
// ── smokeLog (adapted from the spike's log()) — never throws ──────────────────
function smokeLog(test: string, status: "pass" | "fail" | "info", detail: unknown): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), test, status, detail });
  try { appendFileSync(SMOKE_LOG, line + "\n"); } catch { /* never crash */ }
  try { process.stderr.write(`[mulligan-smoke] ${status.toUpperCase()} ${test}: ${line}\n`); } catch {}
}

// ── context handler (OBSERVER → return void; GOTCHA #1) ──────────────────────
pi.on("context", (event, ctx) => {
  try {
    const msgs = event.messages as any[];
    const entries = ctx.sessionManager.getEntries();
    const has = (s: string) => msgs.some((m) => JSON.stringify(m).includes(s));
    smokeLog("context.fire", "info", {
      count: msgs.length,
      msgCanaryPresent: has("MULLIGAN-SMOKE-MSG-CANARY"),
      resultCanaryPresent: has("MULLIGAN-SMOKE-RESULT-CANARY"),
      notePresent: msgs.some((m) => m?.customType === "mulligan:note"),
      hasRewindMarker: entries.some((e: any) => e?.type === "custom" && e?.customType === "mulligan:rewind"),
      shrunkInContext: has("MULLIGAN-SMOKE-SHRUNK"),
      hasNudge: msgs.some((m) => m?.customType === "mulligan:nudge"),
    });
  } catch (e) { smokeLog("context.fire", "fail", { error: String(e) }); }
  // return void → pass-through; do NOT override Mulligan's filter (GOTCHA #1).
});

// ── calling a REAL tool from the command (research §6) ───────────────────────
async function rewindNow(pi: ExtensionAPI, ctx: ExtensionContext, toolCallId: string,
                         granularity: "last_tool_call_group" | "last_turn" | "checkpoint"): Promise<any> {
  const tool = makeRewindTool(pi);   // shared module → REAL tool bound to the same pi
  const result = await tool.execute(
    toolCallId,
    { note: { what_happened: "smoke setup", avoid: "n/a", true_current_state: "smoke", next: "continue" },
      granularity },
    undefined, undefined, ctx,
  );
  smokeLog("tool.rewind", "info", { toolCallId, granularity, text: result.content?.[0]?.text?.slice(0,80) });
  return result;   // assert result.content text for success vs refusal
}

// ── triggering the observing inference (GOTCHA #2) ───────────────────────────
pi.sendUserMessage("ok", { deliverAs: "followUp" });  // queues a follow-up → next context fire is observable
```

### Integration Points

```yaml
PI CLI (how the harness is driven — verified):
  - two extensions, src FIRST:  pi -e ./src/index.ts -e ./test/integration/smoke.ts …   # GOTCHA #1
  - deterministic command:      … -p "/mulligan_smoke <scenario>"                        # GOTCHA #4
  - stable session for reload:  … --session-id smoke-<scenario>                          # GOTCHA #5, F-reload
  - per-scenario log isolation: MULLIGAN_SMOKE_LOG=<path> env var                         # orchestrator sets it

PACKAGE.JSON (THIS task modifies):
  - scripts.smoke: "node test/integration/run-smoke.mjs"   # WAS the placeholder

TSCONFIG (verify, do NOT widen):
  - include:["src","test"] → smoke.ts IS type-checked; run-smoke.mjs (.mjs) is NOT.   # GOTCHA #6

VITEST (verify smoke.ts is not picked up as a unit test):
  - if `npm test` tries to run smoke.ts, add it to a vitest exclude OR ensure smoke.ts has no .test. naming
    (it does not — it is smoke.ts, not smoke.test.ts). Default vitest config picks up *.test.ts only, so
    smoke.ts is naturally excluded. Verify with `npm test`.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# smoke.ts type-checks (it is under test/, which tsconfig includes). run-smoke.mjs is NOT type-checked (.mjs).
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0. Likely friction: the .js import extensions on src/ imports (use ../../src/tools/rewind.js),
#   the typebox Type import, the ExtensionAPI type-only import. Fix in smoke.ts — do NOT widen tsconfig.
```

### Level 2: Unit Tests (no regression)

```bash
npm test
# Expected: all-green. smoke.ts is NOT named *.test.ts → vitest does not run it. If it does (custom config),
#   confirm smoke.ts has no top-level side effects beyond defining the factory (it should not — the factory
#   only runs when Pi calls it). run-smoke.mjs and scenarios.md are never run by vitest.
```

### Level 3: Integration Testing (THE gate — real pi)

```bash
# 3a. Single deterministic scenario (smoke dispatches the command, no model judgment needed):
timeout 120 pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-probe \
  -p "/mulligan_smoke F-protected"
# Expected: exits 0; /tmp/mulligan-smoke.log (or $MULLIGAN_SMOKE_LOG) has session.start + context.fire +
#   tool.rewind lines. If pi exits non-zero with an empty smoke log → src/index.ts failed to load (GOTCHA #12).

# 3b. The full suite via the orchestrator:
npm run smoke
# Expected: 9 lines like "PASS F-rewind-core" … "PASS F-reload" (or documented soft-fails for the
#   auto-prompt sub-criterion when no API key), then "9/9 passed", exit 0.

# 3c. Manual model-driven check (requires a working model + key) — documented in scenarios.md:
pi -e ./src/index.ts -e ./test/integration/smoke.ts -p "Call mulligan_smoke_big, then use mulligan_rewind
  (granularity last_tool_call_group) to undo it, leaving yourself a note."
# Expected: the model calls the tools; context.fire shows resultCanaryPresent true→false.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Inspect the persisted session JSONL for the §2.3 invariants (the orchestrator does this automatically,
#   but running it by hand confirms the entry shapes):
SID=smoke-F-checkpoint
F=$(ls -t ~/.pi/agent/sessions/*${SID}*/ 2>/dev/null | head -1)   # or read it from the smoke log's session.start
grep -c '"customType":"mulligan:rewind"'   "$F"   # rewind markers persisted as custom entries
grep -c '"customType":"mulligan:nudge"'    "$F"   # MUST be 0 (nudge is ephemeral — §2.3)
grep -o '"type":"label","targetId":"[^"]*","label":"mulligan:checkpoint:[^"]*"' "$F"   # checkpoint label

# F-reload cross-process persistence (manual):
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-reload -p "/mulligan_smoke F-reload"
# (the command runs run-1 then exits; run run-2 with the SAME --session-id to verify the marker survived)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (smoke.ts type-checks; GOTCHA #6).
- [ ] `npm test` all-green (smoke.ts is not run as a unit test; no regression).
- [ ] `pi -e ./src/index.ts -e ./test/integration/smoke.ts -p "/mulligan_smoke F-protected"` exits 0 with
      smoke-log output (the 2-extension load + command dispatch work).
- [ ] `npm run smoke` runs all 9 scenarios, prints PASS/FAIL, exits 0 when all pass.

### Feature Validation

- [ ] Load order is `-e ./src/index.ts` FIRST, `-e ./test/integration/smoke.ts` SECOND (GOTCHA #1) everywhere
      (the orchestrator + scenarios.md + any manual commands).
- [ ] smoke's `context` handler returns void (observer only) — verified by reading smoke.ts.
- [ ] Each deterministic scenario that needs an observing inference calls
      `pi.sendUserMessage("ok", {deliverAs:"followUp"})` (GOTCHA #2).
- [ ] The orchestrator asserts the §2.3 JSONL invariants for every marker-creating scenario:
      mulligan:rewind/shrink/turn-metric = `type:"custom"`; mulligan:note = `type:"custom_message"`;
      mulligan:checkpoint: = `type:"label"`; ZERO mulligan:nudge entries.
- [ ] The orchestrator detects "EXTENSION LOAD FAILED" distinctly from scenario-assertion failure (GOTCHA #12).
- [ ] F-reload uses two runs sharing `--session-id` (GOTCHA #5).
- [ ] F-nudge-drift forces the threshold via setConfig (GOTCHA #10) and asserts hasNudge:true + 0 nudge entries.
- [ ] scenarios.md documents BOTH the deterministic command path AND the model-driven prompt path for the
      3 model-dependent scenarios (F-rewind-core, F-shrink-persist, F-nudge-drift).

### Code Quality Validation

- [ ] smoke.ts follows the spike's log()/registerCommand/registerTool patterns (adapted, not copied blindly).
- [ ] All src/ imports use `.js` extensions; ExtensionAPI import is type-only.
- [ ] smoke.ts never throws out of the factory or handlers (try/catch discipline, mirroring the spike).
- [ ] run-smoke.mjs is plain Node ESM (no transpile, no framework) and defensive (handles missing files,
      empty logs, non-zero pi exits).
- [ ] No file under `src/` is modified.

### Documentation & Deployment

- [ ] scenarios.md explains the 2-extension load order, the log location, and how to read context.fire.
- [ ] package.json `scripts.smoke` points at the orchestrator; all other fields unchanged.
- [ ] The API-key-tolerance behavior (GOTCHA #8) is documented in scenarios.md.

---

## Anti-Patterns to Avoid

- ❌ Don't reverse the `-e` order (src must be FIRST) — the smoke helper would see pre-filter messages and
  every context.fire assertion fails (GOTCHA #1).
- ❌ Don't have smoke's context handler return `{messages}` — it overrides Mulligan's real filter (GOTCHA #1).
- ❌ Don't call `tool.execute()` from the command WITHOUT a `sendUserMessage({deliverAs:"followUp"})` — no
  inference fires, so the filter's effect is unobservable (GOTCHA #2).
- ❌ Don't inject ONE fixed canary and assert it for every scenario — last_tool_call_group only removes tool
  results, last_turn/checkpoint remove spans; use the scenario-appropriate canary (GOTCHA #3).
- ❌ Don't reimplement the filter/markers in smoke.ts — import and call the REAL tools/wrappers (research §6);
  reimplementation tests the copy, not Mulligan.
- ❌ Don't hardcode/guess the session JSONL path — read it from the smoke log's session.start detail
  (ctx.sessionManager.getSessionFile()) (GOTCHA #5).
- ❌ Don't rely on Mulligan's OWN log for core assertions — it's OFF by default; the smoke log is primary
  (GOTCHA #7). Mulligan's log is corroboration only.
- ❌ Don't make the suite require a strong model — the deterministic command path + trivial follow-up must
  pass with any/no key (GOTCHA #8); only the "auto-prompt" sub-criterion may be soft.
- ❌ Don't modify any file under `src/` — this task only creates test/integration/* and updates scripts.smoke.
- ❌ Don't widen tsconfig to silence smoke.ts errors — fix smoke.ts (use .js imports, type-only ExtensionAPI).

---

**Confidence Score: 8/10** — The architecture is well-grounded: the three critical Pi behaviors (context
chaining in -e order, `/cmd` dispatch in print mode, print-mode persistence) are verified against Pi's source,
and the spike is a complete working reference for the observer/command/log patterns. The REAL tool-param
schemas are verified from src. The -2 is for the genuinely fiddly scenarios: (a) producing a tool-RESULT
canary deterministically is impossible without a model call (ReadonlySessionManager has no mutator), so
F-rewind-core's deterministic path uses last_turn against the msg-canary instead — correct but a deviation
from the literal "last_tool_call_group" wording that the implementer must reconcile and document; (b)
F-shrink-preventive and F-failopen edge toward needing either a config tweak or a documented unit-test
fallback (GOTCHA #9/#10) rather than a clean deterministic reproduction. These are flagged with concrete
fallbacks so the harness ships reliable and honest rather than brittle.