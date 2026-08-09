# PRP — P1.M1.T2.S2: Add config re-read in `session_start` handler + re-fire `setLogFile` (BUG-001, session-lifecycle half)

---

## Goal

**Feature Goal**: Complete BUG-001's config-surface repair by adding the **authoritative** config re-read to the `session_start` event handler in `src/index.ts`. Today (after the sibling task T2.S1) only the **factory** loads config with the best-effort `process.cwd()`; the `session_start` handler still does nothing but `resetRuntime(...)`. This task makes the handler, which receives the authoritative `ctx.cwd`, re-run `setConfig(loadMulliganConfig(ctx.cwd))` on **every** `session_start` (all 5 reasons: `startup | reload | new | resume | fork`) and then **re-fire** `setLogFile(getConfig().log.file)` so the logger picks up a changed `log.file`. This fulfills spec/09 §1's explicit promise of "re-read on `/reload`" and is the half that actually makes a project-local `.pi/settings.json` with `enabled:false` disable Mulligan for that session.

**Deliverable**:
1. `src/index.ts` (MODIFY) — the `pi.on("session_start", (_event, ctx) => { ... })` handler body: insert `setConfig(loadMulliganConfig(ctx.cwd));` and `setLogFile(getConfig().log.file);` **before** the existing unchanged `resetRuntime(ctx.sessionManager.getSessionId());`, and rewrite the comment above it (step 5) to explain the re-read behavior + the authoritative `ctx.cwd` + spec/09 §1 fulfillment. **No import change** (T2.S1 already imported `loadMulliganConfig`, `setConfig`/`getConfig`, `setLogFile`).
2. `test/index.test.ts` (MODIFY) — building on T2.S1's test scaffolding (which is assumed applied): (a) extend `makeCtx` to include a `cwd` string field; (b) add a `vi.mock("../src/log.js", …)` so the `setLogFile` re-fire is assertable; (c) **replace** T2.S1's "session_start does NOT call loadMulliganConfig" scope-guard test with a positive assertion that `session_start` DOES call `loadMulliganConfig(ctx.cwd)`, re-fires `setLogFile` with the new `log.file`, and updates the config cache; (d) add coverage that all reasons (`reload`, `resume`, `fork`, …) trigger the re-read.

**Success Definition**:
- `npx vitest run test/index.test.ts` — all pass: T2.S1's factory tests + the **rewritten** session_start/config tests all green.
- `npx vitest run` — full suite passes (no regressions; `vi.mock` is file-scoped — `settings.test.ts`, `log`-using tests like `nudges.test.ts`/`filter.test.ts` are unaffected).
- `npx tsc --noEmit` — NO new errors from `src/index.ts` or `test/index.test.ts`. (The single pre-existing `test/drift_nudge.test.ts:239` error is BUG-002, owned by P1.M2.T1.S1 — NOT this task. See GOTCHA #5.)
- Manually: firing `session_start` with `ctx.cwd = "/proj"` and a project `.pi/settings.json` containing `{ "mulligan": { "enabled": false } }` results in `getConfig().enabled === false` for that session. (Covered by the unit test with a programmed mock.)

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + end users who set `enabled:false` (or any knob, or `log.file`) in a **project-local** `.pi/settings.json`. This is the half of BUG-001 that makes per-project config authoritative.

**Use Case**: A user runs `pi` from a project directory that contains `.pi/settings.json` with `{ "mulligan": { "enabled": false } }`. On `session_start` (which fires for startup/new/resume/reload/fork), Mulligan re-reads config using the **authoritative** `ctx.cwd` and honors the disable switch for that session.

**User Journey**: Pi loads extension → factory loads config (best-effort `process.cwd()`) → a `session_start` event fires → handler re-reads config with authoritative `ctx.cwd` → `setConfig` caches the validated result → `setLogFile` re-points the logger at the (possibly new) `log.file` → `resetRuntime` clears this session's in-memory state → handlers/tools now reflect real merged settings.

**Pain Points Addressed**: The `enabled:false` switch + `log.file` + all knobs finally work on a per-session basis (especially after `/reload`, where a user just edited settings). T2.S1 fixed the factory; T2.S2 fixes the authoritative, reload-aware path.

## Why

- **Business value / user impact**: This is the session-lifecycle half of the BUG-001 repair. T2.S1 alone covers the common single-session bootstrap, but `session_start` is the seam that (a) has the **authoritative** `ctx.cwd` (the factory only has best-effort `process.cwd()`) and (b) fires on **`/reload`** — exactly the scenario spec/09 §1 promises config is re-read for. Without T2.S2, editing settings and `/reload`-ing would NOT pick up the change, and a session whose `ctx.cwd` differs from the factory's `process.cwd()` would never see its project-local settings. D4 (system_context.md) decided to load at BOTH seams; T2.S2 is the second seam.
- **Integration with existing features**: Builds on T2.S1's wiring (the `loadMulliganConfig` import + the doubly-fail-open `setConfig`/`getConfig`). `setLogFile` (src/log.ts:48) is the same call the factory already makes — just re-fired here after the cache is repopulated (D6, system_context.md §1.7). No change to `config.ts`, `settings.ts`, `log.ts`, handlers, or tools.
- **Problems this solves and for whom**: For users — `/reload` now actually reloads config; project-local `enabled:false`/`log.file` are authoritative per-session. For the P1.M3 doc-sweep task — the README/spec can finally truthfully advertise config as working. For maintainers — the `session_start` comment stops implying the handler ignores config.
- **Scope boundary (CRITICAL)**: T2.S2 = the `session_start` handler ONLY (+ its test). Do NOT touch the factory body (T2.S1), the factory comment/JSDoc, `session_shutdown`, tool registration, or handler arming. Do NOT add config re-reads to any other handler (`context`/`tool_result`/`turn_end`) — the cache is already set by then (system_context.md §1.4).

## What

One surgical edit to the `session_start` handler body in `src/index.ts` (two new lines before the existing `resetRuntime`, plus a rewritten comment), plus test scaffolding in `test/index.test.ts` that extends `makeCtx` with `cwd`, mocks `../src/log.js`, and replaces T2.S1's scope-guard test with a positive re-read assertion.

### Success Criteria

- [ ] The `session_start` handler body executes, **in order**: `setConfig(loadMulliganConfig(ctx.cwd));` → `setLogFile(getConfig().log.file);` → `resetRuntime(ctx.sessionManager.getSessionId());`.
- [ ] The comment above the handler explains: config is re-read on every `session_start` (all reasons — startup/reload/new/resume/fork) using the authoritative `ctx.cwd`, fulfilling spec/09 §1 "re-read on `/reload`", and the logger is re-pointed after the re-read.
- [ ] `_event` remains unused (no branching on `reason`) — a one-line note is acceptable.
- [ ] `test/index.test.ts`: `makeCtx` now exposes a `cwd: string` field (backward-compatible default).
- [ ] `test/index.test.ts`: `loadMulliganConfig` is asserted to be called with `ctx.cwd` on `session_start`.
- [ ] `test/index.test.ts`: `setLogFile` is asserted to be re-fired with the re-read config's `log.file`.
- [ ] `test/index.test.ts`: T2.S1's "session_start does NOT call loadMulliganConfig" scope-guard test is **removed/replaced** (it is now factually wrong) — converted into a positive re-read test.
- [ ] `npx vitest run test/index.test.ts` passes; `npx vitest run` passes; `npx tsc --noEmit` shows no NEW errors from `src/index.ts` / `test/index.test.ts`.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim current `session_start` handler, the exact replacement handler body + comment, the verified Pi type definitions (`ExtensionContext.cwd`, `SessionStartEvent.reason`), the exact `vi.mock` + `makeCtx` extension + assertion snippets, and the explicit instruction to replace T2.S1's now-obsolete scope-guard test. The implementer needs only to open `src/index.ts` and `test/index.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file being modified (the consumer/wiring site). Its CURRENT state (post-T2.S1) is:
#   line 2 imports setConfig/getConfig from ./config.js; line 6 imports loadMulliganConfig from ./settings.js;
#   a separate import line imports setLogFile from ./log.js; resetRuntime/clearAll from ./runtime.js.
#   factory body: setConfig(loadMulliganConfig(process.cwd())); then setLogFile(getConfig().log.file); (unchanged by T2.S2)
#   the session_start handler (~step 5) is STILL: pi.on("session_start", (_event, ctx) => { resetRuntime(ctx.sessionManager.getSessionId()); });
#   THIS TASK edits ONLY that handler body + its comment.
- file: src/index.ts
  why: "THE edit site. The session_start handler is the ONLY thing you change in src/. All imports it needs (loadMulliganConfig, setConfig, getConfig, setLogFile, resetRuntime) are ALREADY imported by T2.S1/factory — add NOTHING to the import block."
  critical: "Do NOT re-import anything. Do NOT touch the factory body (steps 1–4) or session_shutdown (step 6). Insert the two new lines INSIDE the session_start handler, BEFORE resetRuntime, and rewrite the comment above it."

# MUST READ — the Pi types that make ctx.cwd + reason authoritative (VERIFIED, not assumed).
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: "L209-240 ExtensionContext has `cwd: string` (L217, 'Current working directory') and `sessionManager: ReadonlySessionManager`. L415-421 SessionStartEvent has `reason: \"startup\" | \"reload\" | \"new\" | \"resume\" | \"fork\"`. L862 ExtensionHandler<E> = (event, ctx) => ... L869 on(\"session_start\", ExtensionHandler<SessionStartEvent>)."
  critical: "ctx.cwd is a plain string — pass it directly to loadMulliganConfig. The handler's 2nd param IS ExtensionContext, so ctx.cwd + ctx.sessionManager.getSessionId() are both available. _event is SessionStartEvent; reason is available but ALL reasons trigger re-read, so do not branch."

# MUST READ — the function being called (its contract is the dependency; T1.S2 complete).
- file: src/settings.ts
  why: "loadMulliganConfig(cwd?: string): unknown — reads global (getAgentDir()/settings.json) + project-local (join(cwd ?? process.cwd(), '.pi', 'settings.json')), deep-merges (project wins), returns raw merged `.mulligan` (unknown | undefined). Entire body is ONE try/catch → returns undefined on ANY error (fail-open). NEVER throws."
  pattern: "export function loadMulliganConfig(cwd?: string): unknown { try { ...; return merged.mulligan; } catch { return undefined; } }"
  gotcha: "Pass ctx.cwd (authoritative). loadMulliganConfig resolves `cwd ?? process.cwd()` if you pass undefined, but you MUST pass ctx.cwd explicitly here — that is the whole point (factory already used process.cwd(); session_start uses the better value). Do NOT modify settings.ts."

# MUST READ — the Pi-free validation/cache this handler hands off to.
- file: src/config.ts
  why: "setConfig(raw: unknown) (L195) → try { cachedConfig = validateConfig(raw) } catch { cachedConfig = validateConfig(undefined) } — NEVER throws; bad raw → DEFAULT_CONFIG. getConfig() (L180) → structuredClone(cachedConfig). So setConfig(loadMulliganConfig(ctx.cwd)) is DOUBLY fail-open. setLogFile must be called AFTER setConfig so getConfig() returns the freshly-cached config."
  pattern: "The handoff is loadMulliganConfig → setConfig(raw) → validateConfig. ORDER MATTERS: setConfig first (populates cache), THEN setLogFile(getConfig().log.file) (reads the new cache)."

# MUST READ — the log destination that must be re-pointed after the re-read.
- file: src/log.ts
  why: "setLogFile(path: string | null): void (L48) just assigns a module-level `logFile = path`. Cannot throw. The factory already calls setLogFile(getConfig().log.file). On session_start, after setConfig repopulates the cache, getConfig().log.file may differ from the factory-time value (e.g. a user enabled logging then /reload-ed), so setLogFile MUST be re-fired (D6, system_context §1.7)."
  gotcha: "Do NOT touch log.ts. Just call setLogFile(getConfig().log.file) again in the handler, after setConfig. Null is the default (logging off) — re-firing with null is a harmless no-op assignment."

# MUST READ — the authoritative lifecycle rationale + the reload promise.
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/system_context.md
  why: "§1.4 Lifecycle Asymmetry table: factory NO ctx → process.cwd(); session_start HAS ctx.cwd (authoritative). D4 = 'Load at BOTH seams ... session_start re-reads on /reload (reason reload), new, resume, fork.' §1.7: 'The session_start re-read must also re-fire setLogFile(getConfig().log.file) after setConfig(...).' D6 = 'Re-fire setLogFile on session_start.'"
  critical: "The comment you write MUST cite ctx.cwd as the authoritative cwd (vs the factory's process.cwd()) and MUST reference spec/09 §1 're-read on /reload'. This is the documented justification for the second seam."

# MUST READ — the root-cause write-up showing the current (minimal) handler.
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/config_flow_research.md
  why: "§2 quotes the CURRENT session_start handler verbatim and notes 'NOTE: no setConfig here' — exactly the gap T2.S2 closes. Confirms the handler has ctx.cwd available but does not use it today."

# MUST READ — the test file being modified.
- file: test/index.test.ts
  why: "Contains makePi() (→ {handlers, tools, pi}), makeCtx(sessionId) (→ {sessionManager} ONLY — T2.S2 adds cwd), makeStartEvent(reason), and the existing session_start tests. T2.S1 (assumed applied) added vi.mock('../src/settings.js') + imports loadMulliganConfig/getConfig + mockReset in beforeEach + a describe('index.ts config loading (factory)') block with a SCOPE-GUARD test #3 asserting session_start does NOT call loadMulliganConfig."
  pattern: "handlers['session_start']!(makeStartEvent('reload'), makeCtx('s1')) is how to fire the handler in a test. getConfig() (from ../src/config.js) is how to assert the cache was repopulated."
  gotcha: "T2.S1's scope-guard test #3 is now FACTUALLY WRONG after T2.S2 (session_start WILL call loadMulliganConfig). You MUST replace it — see Task 6. Leaving it would make the suite red."

# CONTEXT — the sibling contract (assume applied exactly).
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M1T2S1/PRP.md
  why: "CONTRACT for what the factory + its tests look like when T2.S2 begins. T2.S1 does NOT touch the session_start handler (only references it in a comment). T2.S1's factory comment says 'the session_start handler below re-reads with the authoritative ctx.cwd (P1.M1.T2.S2)' — this task fulfills that forward-reference."
  critical: "If T2.S1's test scaffolding (vi.mock settings.js, imports, mockReset, describe block + scope-guard test) is NOT yet present in test/index.test.ts, your FIRST test step is to verify/establish it per the T2.S1 contract, THEN make the T2.S2 edits. Do not assume the file is identical to the raw working tree."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  index.ts      # ← THIS PRP modifies the session_start handler body + its comment (ONLY)
  settings.ts   # loadMulliganConfig(cwd?) — READ-ONLY; the function being called
  config.ts     # setConfig/getConfig — READ-ONLY; Pi-free validation/cache (doubly fail-open)
  log.ts        # setLogFile — READ-ONLY; re-fired here, NOT modified
  runtime.ts    # resetRuntime — READ-ONLY; the existing unchanged handler tail
test/
  index.test.ts # ← THIS PRP modifies (extend makeCtx + mock log.js + replace scope-guard test)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/index.ts      # MODIFY — session_start handler: + setConfig(loadMulliganConfig(ctx.cwd)); + setLogFile(getConfig().log.file); (before resetRuntime); rewritten step-5 comment
test/index.test.ts # MODIFY — makeCtx gains cwd; + vi.mock('../src/log.js'); + mockReset setLogFile in beforeEach; REPLACE T2.S1 scope-guard test with positive re-read assertions; + reason-coverage test
# (NO new files. NO changes to settings.ts, config.ts, log.ts, runtime.ts, handlers, tools, README, spec.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (scope — SESSION_START HANDLER ONLY).
//   src/index.ts has the factory (steps 1–4, already done by T2.S1) and the session_start handler (step 5,
//   THIS task) and session_shutdown (step 6). T2.S2 edits ONLY the session_start handler body + the comment
//   directly above it. Do NOT touch the factory, the factory comment/JSDoc, session_shutdown, tool
//   registration, or handler arming. Do NOT add config re-reads to context/tool_result/turn_end (the cache
//   is already set by session_start — system_context §1.4).

// CRITICAL GOTCHA #2 (ORDER: setConfig THEN setLogFile THEN resetRuntime).
//   setLogFile(getConfig().log.file) reads the cache, so it MUST come AFTER setConfig(...) repopulates it.
//   resetRuntime must remain the LAST line (it's the existing tail; reordering it is pointless and risky).
//   Correct order inside the handler:
//     setConfig(loadMulliganConfig(ctx.cwd));     // 1. re-read authoritative cwd → cache
//     setLogFile(getConfig().log.file);           // 2. re-point logger at new cache's log.file
//     resetRuntime(ctx.sessionManager.getSessionId()); // 3. (existing) clear this session's in-memory state

// CRITICAL GOTCHA #3 (DOUBLY fail-open — no try/catch needed in the handler).
//   loadMulliganConfig NEVER throws (one outer try/catch → undefined) AND setConfig NEVER throws
//   (try/catch → DEFAULT_CONFIG) AND setLogFile cannot throw (just an assignment). So the two new lines
//   cannot throw. Do NOT wrap them in try/catch. (resetRuntime also never throws.)

// CRITICAL GOTCHA #4 (T2.S1's SCOPE-GUARD TEST MUST BE REPLACED — it is now wrong).
//   T2.S1 added a test asserting session_start does NOT call loadMulliganConfig (to lock the T2.S1/T2.S2
//   boundary). T2.S2 makes session_start DO call loadMulliganConfig, so that test will FAIL after your edit.
//   You MUST replace it with a positive assertion (see Task 6). Leaving it red = a failed suite. This is
//   the single most important cross-task interaction.

// CRITICAL GOTCHA #5 (the pre-existing tsc error is NOT yours).
//   `npx tsc --noEmit` currently reports EXACTLY ONE error: test/drift_nudge.test.ts:239
//   (TS2352: missing rewindRefusedTurnIndex). That is BUG-002, owned by P1.M2.T1.S1. It is PRE-EXISTING.
//   T2.S2's tsc bar = "no NEW errors from src/index.ts or test/index.test.ts". Do NOT fix drift_nudge here.

// CRITICAL GOTCHA #6 (asserting setLogFile requires a NEW vi.mock for ../src/log.js).
//   T2.S1 only mocked ../src/settings.js. To assert the setLogFile RE-FIRE, add
//   vi.mock("../src/log.js", () => ({ setLogFile: vi.fn() })) and import setLogFile (the mocked binding).
//   index.ts imports ONLY setLogFile from ./log.js, so the minimal mock is sufficient. The factory ALSO
//   calls setLogFile (step 2), so to assert the SESSION_START call precisely, mockClear() setLogFile right
//   before firing the handler, THEN assert toHaveBeenCalledWith(<expected>).

// CRITICAL GOTCHA #7 (makeCtx must gain cwd — backward-compatibly).
//   Current makeCtx(sessionId) returns ONLY { sessionManager }. The handler now reads ctx.cwd, so the fake
//   ctx MUST expose cwd. Extend makeCtx(sessionId = "sess-test", cwd = "/test/cwd") and add cwd to the
//   returned object. Existing callers makeCtx(sid) keep working (default cwd). Cast as ExtensionContext
//   (it already is — cwd is just one more field on it).

// CRITICAL GOTCHA #8 (config cache is module-scoped — repopulated per fire, no manual reset needed).
//   config.ts's cachedConfig is module-scoped. Each indexFactory(pi) call AND each session_start fire
//   overwrites it via setConfig. Tests assert getConfig() AFTER firing the handler, so they read the
//   just-cached value. No manual cache reset is needed (the mockReset on loadMulliganConfig + each test's
//   own mockReturnValue is what isolates them).

// CRITICAL GOTCHA #9 (_event stays unused; do NOT branch on reason).
//   The work item is explicit: all reasons trigger re-read, so do not add `if (event.reason === ...)`.
//   Keep the param as `_event` (or add a comment that `reason` is available but all reasons re-read).
//   Branching would violate spec/09 §1 ("re-read on /reload" implies reload is just one of several).

// CRITICAL GOTCHA #10 (the forward-reference in the factory comment becomes true).
//   T2.S1's factory comment says "the session_start handler below re-reads with the authoritative ctx.cwd
//   (P1.M1.T2.S2)". After this task, that statement is TRUE. Do not edit the factory comment — it already
//   points here. Your session_start comment should mirror that wording (cite ctx.cwd authoritative,
//   spec/09 §1 reload).
```

---

## Implementation Blueprint

### Data models and structure

**No new types.** This task calls existing functions in an existing handler: `ctx.cwd: string` → `loadMulliganConfig(string): unknown` → `setConfig(unknown): void` → `getConfig(): MulliganConfig` → `setLogFile(string | null): void`. The data flow is `string → unknown → cachedConfig → log.file (string | null)`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the starting state of src/index.ts (no edit)
  - OPEN src/index.ts. CONFIRM the session_start handler currently reads:
        pi.on("session_start", (_event, ctx) => {
          resetRuntime(ctx.sessionManager.getSessionId());
        });
    and that the import block ALREADY contains:
        import { setConfig, getConfig } from "./config.js";
        import { loadMulliganConfig } from "./settings.js";
        import { setLogFile } from "./log.js";
        import { resetRuntime, clearAll } from "./runtime.js";
  - IF any of those imports is missing (T2.S1 not yet applied): STOP and flag it — T2.S2 depends on the
    T2.S1 factory wiring being present. Do NOT re-add imports that exist.
  - DEPENDENCIES: none (read-only verification).

Task 2: MODIFY src/index.ts — rewrite the session_start handler comment (step 5)
  - FIND (verbatim, the two comment lines above the handler):
      `  // 5. session_start → reset this session's runtime (read sessionId FRESH — C12; never cache a`
      `  //    sessionManager handle). A resumed/reloaded session starts from clean in-memory control state;`
      `  //    persisted markers are untouched and remain the source of truth. Never branches on reason.`
  - REPLACE WITH:
      `  // 5. session_start → re-read config with the AUTHORITATIVE ctx.cwd, re-point the logger, then reset`
      `  //    this session's runtime. Fires for ALL reasons (startup | reload | new | resume | fork) — config`
      `  //    may change between sessions (esp. /reload), so every start re-reads. This is the authoritative`
      `  //    cwd the factory lacks (D4; the factory used best-effort process.cwd()), and it fulfills spec/09`
      `  //    §1 "re-read on /reload". loadMulliganConfig + setConfig are doubly fail-open (→ DEFAULT_CONFIG),`
      `  //    and setLogFile just re-points the destination after the cache is repopulated (D6) — none throw.`
      `  //    _event.reason is available but intentionally not branched on (all reasons re-read). The`
      `  //    resetRuntime tail reads sessionId FRESH (C12; never cache a sessionManager handle); a resumed/`
      `  //    reloaded session starts from clean in-memory control state; persisted markers are untouched.`
  - RATIONALE: the old comment described ONLY the runtime reset and said "never branches on reason" as if
    that were the handler's whole job. The new comment leads with the config re-read (the new primary
    behavior), explains WHY ctx.cwd (lifecycle asymmetry D4), cites spec/09 §1 (the reload promise),
    notes the doubly-fail-open guarantee + setLogFile re-point (D6), and retains the C12/sessionManager
    rationale for the resetRuntime tail. (GOTCHA #2, #9, #10.)
  - DEPENDENCIES: Task 1.

Task 3: MODIFY src/index.ts — the handler body (the core edit)
  - FIND (verbatim, the handler body):
      `  pi.on("session_start", (_event, ctx) => {`
      `    resetRuntime(ctx.sessionManager.getSessionId());`
      `  });`
  - REPLACE WITH:
      `  pi.on("session_start", (_event, ctx) => {`
      `    setConfig(loadMulliganConfig(ctx.cwd));`
      `    setLogFile(getConfig().log.file);`
      `    resetRuntime(ctx.sessionManager.getSessionId());`
      `  });`
  - RATIONALE: loadMulliganConfig(ctx.cwd) reads+merges global+project settings with the AUTHORITATIVE
    project dir and returns the raw mulligan block (or undefined); setConfig validates+ caches it (or
    DEFAULT_CONFIG). setLogFile re-points the logger at the new cache's log.file (may differ after
    /reload — D6). resetRuntime is the existing unchanged tail. ORDER is critical: setConfig must precede
    setLogFile (GOTCHA #2). Doubly fail-open (GOTCHA #3) — no try/catch.
  - GOTCHA: ctx.cwd is a plain string (verified ExtensionContext.cwd: string, types.d.ts:217) — pass it
    directly. Do NOT branch on reason (GOTCHA #9). Do NOT wrap in try/catch. Do NOT touch any other handler.
  - DEPENDENCIES: Task 2 (comment first, so the edit reads cleanly).

Task 4: MODIFY test/index.test.ts — extend makeCtx with cwd
  - FIND (verbatim):
      `/** Minimal fake ExtensionContext: only sessionManager.getSessionId() is needed by the session_start handler. */`
      `function makeCtx(sessionId = "sess-test") {`
      `  const sessionManager = {`
      `    getSessionId() {`
      `      return sessionId;`
      `    },`
      `  };`
      `  return {`
      `    sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],`
      `  } as ExtensionContext;`
      `}`
  - REPLACE WITH:
      `/** Minimal fake ExtensionContext: exposes cwd (read by session_start config re-read) +`
      ` *  sessionManager.getSessionId() (read by session_start runtime reset). */`
      `function makeCtx(sessionId = "sess-test", cwd = "/test/cwd") {`
      `  const sessionManager = {`
      `    getSessionId() {`
      `      return sessionId;`
      `    },`
      `  };`
      `  return {`
      `    cwd,`
      `    sessionManager: sessionManager as unknown as ExtensionContext["sessionManager"],`
      `  } as ExtensionContext;`
      `}`
  - RATIONALE: the handler now reads ctx.cwd; the fake ctx must expose it. Backward-compatible default
    keeps existing makeCtx(sid) callers working. (GOTCHA #7.)
  - DEPENDENCIES: Task 1.

Task 5: MODIFY test/index.test.ts — add the log.js mock + imports + beforeEach reset
  - PRECONDITION: T2.S1 already added `vi` to the vitest import, `vi.mock("../src/settings.js", ...)`,
    `import { loadMulliganConfig } from "../src/settings.js";`, `import { getConfig } from "../src/config.js";`,
    and `vi.mocked(loadMulliganConfig).mockReset();` in beforeEach. VERIFY these are present; if not, they
    belong to T2.S1 (flag, do not duplicate).
  - ADD (near the existing settings.js mock):
      // Deterministic setLogFile-re-fire assertion: mock log.js so the handler's setLogFile call is
      // observable (index.ts imports ONLY setLogFile from ./log.js). File-scoped → no leak.
      vi.mock("../src/log.js", () => ({ setLogFile: vi.fn() }));
  - ADD to the test imports (after the vi.mock line):
      import { setLogFile } from "../src/log.js";   // the mocked binding (assert the re-fire)
  - FIND the module-level beforeEach (which T2.S1 extended to mockReset loadMulliganConfig) and ADD a line
    so setLogFile is also reset per test:
      beforeEach(() => {
        clearAll();
        vi.mocked(loadMulliganConfig).mockReset(); // T2.S1 — default undefined → DEFAULT_CONFIG
        vi.mocked(setLogFile).mockReset();         // T2.S2 — clear call history each test
      });
    (If T2.S1's beforeEach does NOT yet contain the loadMulliganConfig mockReset, add BOTH per the T2.S1
    contract.)
  - RATIONALE: asserting the setLogFile re-fire requires a controllable binding; the real setLogFile just
    assigns a module var with no read-back. (GOTCHA #6.) mockReset clears call history + return between tests.
  - DEPENDENCIES: Task 4.

Task 6: MODIFY test/index.test.ts — REPLACE T2.S1's scope-guard test with positive re-read assertions
  - FIND T2.S1's scope-guard test (inside `describe("index.ts config loading (factory)", ...)`):
      it("never calls loadMulliganConfig from the session_start handler (that re-read is T2.S2)", () => {
        const { handlers, pi } = makePi();
        indexFactory(pi);
        const callsBefore = vi.mocked(loadMulliganConfig).mock.calls.length;
        handlers["session_start"]!(makeStartEvent("new"), makeCtx("s1"));
        expect(vi.mocked(loadMulliganConfig).mock.calls.length).toBe(callsBefore); // unchanged
      });
  - DELETE that test entirely (it is now factually wrong — GOTCHA #4).
  - ADD a NEW describe block (or fold into the factory describe) that asserts the POSITIVE behavior. Place
    it after the `describe("index.ts extension factory", ...)` block:
      describe("index.ts session_start config re-read (T2.S2)", () => {
        it("re-reads config with the authoritative ctx.cwd on session_start", () => {
          const { handlers, pi } = makePi();
          indexFactory(pi);
          vi.mocked(setLogFile).mockClear(); // ignore the factory's step-2 setLogFile call

          vi.mocked(loadMulliganConfig).mockReturnValue({ log: { file: "/proj.log" } });
          handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1", "/proj"));

          expect(loadMulliganConfig).toHaveBeenCalledWith("/proj"); // ctx.cwd, NOT process.cwd()
          expect(getConfig().log.file).toBe("/proj.log");           // setConfig cached the re-read
        });

        it("re-fires setLogFile with the re-read config's log.file", () => {
          const { handlers, pi } = makePi();
          indexFactory(pi);
          vi.mocked(setLogFile).mockClear();

          vi.mocked(loadMulliganConfig).mockReturnValue({ log: { file: "/x.log" } });
          handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1", "/x"));

          expect(setLogFile).toHaveBeenCalledTimes(1);     // exactly one re-fire in the handler
          expect(setLogFile).toHaveBeenCalledWith("/x.log"); // the re-read config's log.file
        });

        it("is fail-open to DEFAULT_CONFIG when the re-read returns undefined", () => {
          const { handlers, pi } = makePi();
          indexFactory(pi);
          vi.mocked(setLogFile).mockClear();

          vi.mocked(loadMulliganConfig).mockReturnValue(undefined); // absent/invalid/no-mulligan-key
          handlers["session_start"]!(makeStartEvent("resume"), makeCtx("s1", "/any"));

          expect(getConfig().enabled).toBe(true);         // DEFAULT_CONFIG.enabled === true
          expect(setLogFile).toHaveBeenCalledWith(null);  // DEFAULT_CONFIG.log.file === null
        });

        it("re-reads on EVERY reason (startup | reload | new | resume | fork)", () => {
          for (const reason of ["startup", "reload", "new", "resume", "fork"] as const) {
            vi.mocked(loadMulliganConfig).mockReset();
            const { handlers, pi } = makePi();
            indexFactory(pi);
            vi.mocked(setLogFile).mockClear();

            handlers["session_start"]!(makeStartEvent(reason), makeCtx("s1", "/r"));
            // loadMulliganConfig was called both at factory time (process.cwd()) AND in the handler (ctx.cwd)
            expect(loadMulliganConfig).toHaveBeenCalledWith("/r");
          }
        });

        it("still resets the session runtime after the config re-read (existing behavior preserved)", () => {
          const { handlers, pi } = makePi();
          indexFactory(pi);
          // populate + mutate a runtime so we can observe the reset
          const rt = getRuntime("s1");
          rt.seq = 99;

          handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1", "/p"));

          expect(getRuntime("s1").seq).toBe(0); // resetRuntime fired → fresh runtime
        });
      });
  - RATIONALE:
    - Test 1 proves loadMulliganConfig is called with ctx.cwd (the authoritative value), NOT process.cwd()
      — the core T2.S2 behavior. getConfig().log.file round-trips proves setConfig cached the re-read.
    - Test 2 proves setLogFile is RE-FIRED (exactly once in the handler) with the new config's log.file —
      the D6 requirement.
    - Test 3 proves fail-open: undefined re-read → DEFAULT_CONFIG (enabled:true, log.file:null), and
      setLogFile is re-fired with null (harmless).
    - Test 4 proves NO branching on reason — all 5 reasons trigger the re-read (spec/09 §1).
    - Test 5 is a regression guard: resetRuntime STILL fires after the new lines (the existing handler tail
      is preserved). (GOTCHA #4, #6, #8, #9.)
  - GOTCHA: getRuntime is already imported at the top of the file (existing session_start tests use it).
    The mockClear() on setLogFile before each handler fire isolates the re-fire assertion from the factory's
    step-2 call. mockReset on loadMulliganConfig inside test 4's loop ensures a clean count each iteration.
  - DEPENDENCIES: Tasks 4–5.

Task 7: VALIDATE (no new code)
  - RUN `npx vitest run test/index.test.ts` → all pass (T2.S1 factory tests + the new session_start/config tests).
  - RUN `npx vitest run` → full suite passes (no regressions; vi.mock is file-scoped).
  - RUN `npx tsc --noEmit` → the ONLY error is pre-existing test/drift_nudge.test.ts:239 (BUG-002). Confirm
    NO error line references src/index.ts or test/index.test.ts. (GOTCHA #5.)
  - DEPENDENCIES: Tasks 2–6.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 3): the handler edit. Two new lines, fixed order, doubly fail-open; no try/catch.
pi.on("session_start", (_event, ctx) => {
  setConfig(loadMulliganConfig(ctx.cwd));      // 1. re-read authoritative cwd → validate → cache
  setLogFile(getConfig().log.file);            // 2. re-point logger at the new cache's log.file
  resetRuntime(ctx.sessionManager.getSessionId()); // 3. (existing) clear this session's in-memory state
});
//   ctx.cwd           → string (authoritative; types.d.ts:217)
//   loadMulliganConfig(string) → unknown (raw mulligan) | undefined — NEVER throws
//   setConfig(unknown)         → caches validateConfig(raw); throw → DEFAULT_CONFIG — NEVER throws
//   getConfig().log.file       → string | null (the just-cached config)
//   setLogFile(string | null)  → assigns module var — cannot throw

// PATTERN (Tasks 4–6): deterministic handler test via module mocks.
vi.mock("../src/log.js", () => ({ setLogFile: vi.fn() }));          // NEW (T2.S2); T2.S1 already mocked settings.js
import { setLogFile } from "../src/log.js";                         // this binding IS the mock
//   To assert ONLY the session_start re-fire (not the factory's step-2 call): mockClear() setLogFile after
//   indexFactory(pi) and before firing the handler:
//     vi.mocked(setLogFile).mockClear();
//     handlers["session_start"]!(makeStartEvent("reload"), makeCtx("s1", "/proj"));
//     expect(setLogFile).toHaveBeenCalledWith("/proj.log");
//   makeCtx("s1", "/proj") now carries cwd:"/proj" → assert loadMulliganConfig called with "/proj".

// ANTI-PATTERN to avoid: asserting setLogFile via the real log.ts module var. There is no read-back export.
// Always mock ../src/log.js and assert on vi.mocked(setLogFile).
```

### Integration Points

```yaml
CODE:
  - modify: src/index.ts — session_start handler: + setConfig(loadMulliganConfig(ctx.cwd)); + setLogFile(getConfig().log.file); (before resetRuntime); rewritten step-5 comment
  - untouched: src/index.ts factory body + factory comment/JSDoc + session_shutdown (T2.S1 / not in scope);
    src/settings.ts (T1.S2); src/config.ts (Pi-free validation/cache); src/log.ts (just re-fired); src/runtime.ts;
    src/filter.ts, src/nudges.ts, src/tools/*
TESTS:
  - modify: test/index.test.ts — makeCtx gains cwd; + vi.mock('../src/log.js') + import setLogFile + mockReset in beforeEach; REPLACE T2.S1 scope-guard test with positive re-read describe (5 cases)
  - untouched: all other test files (drift_nudge.test.ts:239 = BUG-002, separate task — GOTCHA #5)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none new. The extension still registers the same 5 tools + arms the same 5 handlers. The ONLY behavioral
    change is that session_start now re-reads config (authoritative cwd) + re-points the logger — which, with
    T2.S1, is the completed BUG-001 fix.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After modifying src/index.ts:
npx tsc --noEmit
# EXPECTED: exactly ONE error — `test/drift_nudge.test.ts(239,10): error TS2352 ... rewindRefusedTurnIndex`.
# That is BUG-002 (pre-existing, P1.M2.T1.S1) — NOT yours (GOTCHA #5).
# YOUR bar: NO line in the output references src/index.ts or test/index.test.ts.
# If you see an index.ts/index.test.ts error, common causes:
#   - ctx is not typed (it is — ExtensionContext; do not re-annotate);
#   - makeCtx return no longer assignable to ExtensionContext (it still is — cwd is a real field);
#   - missing `vi` / setLogFile import / mockReset pairing;
#   - you accidentally edited the factory or session_shutdown (revert — out of scope).
# Do NOT "fix" the drift_nudge error here.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The index test file in isolation — fast feedback on the 5 new session_start/config cases + regression.
npx vitest run test/index.test.ts
# EXPECTED: all pass. If a new test fails:
#   - "toHaveBeenCalledWith('/proj')" fails? → you passed process.cwd() instead of ctx.cwd, OR makeCtx
#     doesn't expose cwd (check Task 4).
#   - "setLogFile toHaveBeenCalledWith('/x.log')" fails / called 0 times? → the handler doesn't re-fire
#     setLogFile (check Task 3 ordering: setConfig THEN setLogFile), OR you didn't mockClear after
#     indexFactory (the factory's step-2 call masks the count — check Task 6's mockClear), OR you didn't
#     mock ../src/log.js (check Task 5).
#   - "getConfig().log.file === '/proj.log'" fails? → setConfig isn't caching the re-read (check loadMulliganConfig
#     mockReturnValue is set BEFORE firing the handler).
#   - "all reasons re-read" fails for one reason? → you branched on reason (you should NOT — GOTCHA #9).
#   - "seq === 0" (runtime reset) fails? → you removed/reordered resetRuntime (it must stay the LAST line).
# The T2.S1 factory tests + the existing 8 factory tests MUST still pass (mocked loadMulliganConfig returns
# undefined by default → DEFAULT_CONFIG = identical to pre-T2.S2 behavior for the factory path).

# Full suite — confirm no regressions (vi.mock is file-scoped; log.ts-using tests like nudges.test.ts /
# filter.test.ts are unaffected because they import the REAL log.ts, not the index.test.ts mock).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# The end-to-end "does enabled:false actually disable Mulligan after /reload" check spans T2.S1 (factory) +
# T2.S2 (session_start). T2.S2's unit tests (Level 2) already prove the wiring deterministically with
# programmed mocks. For an OPTIONAL real-filesystem integration smoke (do NOT clobber real settings):
#
#   PI_CODING_AGENT_DIR="$(mktemp -d)" node --input-type=module -e '
#     process.chdir("/tmp/proj"); // simulate ctx.cwd
#     // write /tmp/proj/.pi/settings.json with { mulligan: { enabled: false } }, then stand up a fake pi,
#     // call indexFactory, fire session_start with ctx.cwd="/tmp/proj", assert getConfig().enabled === false.
#   '
#
# NOTE: OPTIONAL — Level 2 covers the contract. Do not block T2.S2 on this. The full README/spec accuracy
# verification (does the documented disable switch really work end-to-end) is P1.M3.T1's job.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the handler now re-reads config and the comment is honest:
grep -n "loadMulliganConfig(ctx.cwd)\|setLogFile(getConfig\|resetRuntime(ctx.sessionManager" src/index.ts
# EXPECTED: all three appear INSIDE the session_start handler body, in that order.

# Confirm the comment cites the authoritative cwd + spec/09 §1 + reload (no stale "never branches on reason"-
# only language remains as the handler's whole job):
grep -n "ctx.cwd\|spec/09\|reload\|D4\|D6" src/index.ts
# EXPECTED: hits in the session_start comment (the factory comment from T2.S1 also mentions ctx.cwd/T2.S2 — fine).

# Confirm T2.S1's obsolete scope-guard test is GONE (it asserted session_start does NOT call loadMulliganConfig):
grep -n "never calls loadMulliganConfig from the session_start\|mock.calls.length).toBe(callsBefore)" test/index.test.ts
# EXPECTED: ZERO hits after the edit (replaced by the positive re-read tests).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx vitest run test/index.test.ts` — all pass (T2.S1 factory tests + 5 new session_start/config tests).
- [ ] `npx vitest run` — full suite passes (no regressions).
- [ ] `npx tsc --noEmit` — NO new errors from `src/index.ts` / `test/index.test.ts` (the single pre-existing `drift_nudge.test.ts:239` error is BUG-002, out of scope).

### Feature Validation
- [ ] The `session_start` handler body runs `setConfig(loadMulliganConfig(ctx.cwd))` → `setLogFile(getConfig().log.file)` → `resetRuntime(...)` in that order.
- [ ] The handler comment cites the authoritative `ctx.cwd` (vs factory `process.cwd()`), spec/09 §1 "re-read on /reload", and the doubly-fail-open + setLogFile re-point (D6) guarantees.
- [ ] `_event` stays unused; no branching on `reason` (the all-reasons test enforces this).
- [ ] `makeCtx` exposes `cwd`; the re-read test asserts `loadMulliganConfig` is called with `ctx.cwd`.
- [ ] The re-fire test asserts `setLogFile` is called with the re-read config's `log.file`.
- [ ] T2.S1's obsolete scope-guard test is removed/replaced (Level 4 grep confirms).

### Code Quality Validation
- [ ] `src/index.ts` changes are confined to the session_start handler body + the comment directly above it; the factory, factory comment/JSDoc, and session_shutdown are byte-identical to the post-T2.S1 state.
- [ ] No new imports in `src/index.ts` (T2.S1 already imported everything needed).
- [ ] `test/index.test.ts` mocks are file-scoped and minimal (`{ setLogFile: vi.fn() }` for log.js; T2.S1's `{ loadMulliganConfig: vi.fn() }` for settings.js).
- [ ] Only `src/index.ts` and `test/index.test.ts` are modified — NO changes to settings.ts, config.ts, log.ts, runtime.ts, handlers, tools, drift_nudge.test.ts, README, or spec.

### Documentation & Deployment
- [ ] The session_start comment is honest about the re-read behavior, the cwd choice, and the reload promise.
- [ ] No user-facing doc change in T2.S2 — the README/spec accuracy sweep is P1.M3.T1 (after this + T2.S1 land).

---

## Anti-Patterns to Avoid

- ❌ Don't touch the factory body, factory comment/JSDoc, tool registration, handler arming, or `session_shutdown` — T2.S2 is the `session_start` handler ONLY (GOTCHA #1).
- ❌ Don't add config re-reads to `context`/`tool_result`/`turn_end` handlers — the cache is already set by `session_start` (system_context §1.4).
- ❌ Don't reorder the handler body — `setConfig` MUST precede `setLogFile` (it reads the cache), and `resetRuntime` MUST stay last (GOTCHA #2).
- ❌ Don't wrap the new lines in try/catch — they're doubly fail-open + setLogFile can't throw (GOTCHA #3).
- ❌ Don't leave T2.S1's scope-guard test in place — it asserts session_start does NOT call `loadMulliganConfig`, which is now false; it WILL fail and red the suite (GOTCHA #4). Replace it.
- ❌ Don't branch on `_event.reason` — all reasons trigger a re-read (spec/09 §1; GOTCHA #9). The all-reasons test enforces this.
- ❌ Don't re-add imports that T2.S1 already added (`loadMulliganConfig`, `setConfig`/`getConfig`, `setLogFile`) — verify first (Task 1).
- ❌ Don't assert `setLogFile` via the real `log.ts` module var — there's no read-back export. Mock `../src/log.js` and assert on `vi.mocked(setLogFile)` (GOTCHA #6).
- ❌ Don't forget `mockClear()`/`mockReset()` on `setLogFile` after `indexFactory(pi)` — the factory's step-2 `setLogFile` call would otherwise inflate the call count and mask the handler's re-fire (GOTCHA #6).
- ❌ Don't break `makeCtx`'s existing callers — add `cwd` as a backward-compatible optional param with a default (GOTCHA #7).
- ❌ Don't "fix" `test/drift_nudge.test.ts:239` — that's BUG-002 (P1.M2.T1.S1). Your tsc bar is "no NEW errors from my files", not "tsc fully clean" (GOTCHA #5).

---

## Decision Log

- **D1 — Re-read uses `ctx.cwd`, not `process.cwd()` or `ctx.sessionManager.getCwd()`.** `ctx.cwd` is the authoritative project directory on `ExtensionContext` (verified: types.d.ts:217 "Current working directory"). The factory already used best-effort `process.cwd()` (it has no ctx); `session_start` is the seam that has the better value, so it must use it (system_context §1.4, decision D4). `ctx.sessionManager.getCwd()` exists but is redundant with `ctx.cwd` and not the documented choice; `ctx.cwd` is simpler and authoritative.

- **D2 — `setLogFile` is re-fired AFTER `setConfig`, not omitted.** The factory already calls `setLogFile(getConfig().log.file)` once. On `session_start`, the cache is repopulated by `setConfig`, so `getConfig().log.file` may differ (e.g. a user enabled logging then `/reload`-ed). Re-firing `setLogFile` re-points the logger at the new destination (system_context §1.7, decision D6). Re-firing with `null` (the default) is a harmless no-op assignment. Omitting it would leave the logger pointed at a stale path after a config change — a subtle, hard-to-debug observability bug.

- **D3 — No branching on `reason`; all 5 reasons re-read.** spec/09 §1 frames `/reload` as the canonical re-read trigger, but the work item is explicit that all reasons (`startup | reload | new | resume | fork`) are valid (config may change between sessions). Branching would risk skipping a legitimate re-read (e.g. a `resume` into a project whose `.pi/settings.json` differs from the factory-time `process.cwd()` read). The handler is also cheaper than it looks (two fail-open function calls). The all-reasons unit test locks this in.

- **D4 — Mock `../src/log.js` (not spy on the real module) for the setLogFile assertion.** `setLogFile` in the real `log.ts` assigns a module-private `logFile` with no exported read-back. To assert the handler calls it with a specific value, the binding must be observable. `vi.mock("../src/log.js", () => ({ setLogFile: vi.fn() }))` is the standard vitest mechanism; `index.ts` imports only `setLogFile` from `./log.js`, so the minimal mock is sufficient. It is file-scoped, so `log.ts`-using tests (`nudges.test.ts`, `filter.test.ts`) are unaffected. This mirrors T2.S1's decision to mock `../src/settings.js` (D3 there).

- **D5 — Replace, don't relax, T2.S1's scope-guard test.** T2.S1 deliberately added a test asserting `session_start` does NOT call `loadMulliganConfig` to lock the subtask boundary. T2.S2 invalidates that premise. Relaxing it (e.g. deleting the assertion silently) would lose coverage; replacing it with a positive re-read test preserves the coverage intent (the handler's config behavior IS now tested) and keeps the suite green. The new all-reasons + setLogFile + fail-open + runtime-reset tests are strictly richer than the guard they replace.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 2-line handler edit + comment rewrite + a focused set of test changes, backed by: (a) the VERIFIED Pi types (`ExtensionContext.cwd`, `SessionStartEvent.reason`, handler signature), (b) the doubly-fail-open `setConfig`/`getConfig` and non-throwing `setLogFile` (re-confirmed in source), (c) the authoritative lifecycle rationale (system_context §1.4/§1.7, D4/D6), (d) the explicit T2.S1 contract (imports already present; scope-guard test to replace), and (e) verbatim `vi.mock`/`makeCtx`/assertion snippets. Residual risks: (1) the starting state of `test/index.test.ts` depends on T2.S1 being applied — Task 1 + Task 5's precondition step guard against a stale tree (mitigated by explicit "verify/flag, don't duplicate" instructions); (2) the `mockClear`-after-`indexFactory` discipline for `setLogFile` (mitigated by GOTCHA #6 + the exact snippet in Task 6); (3) tsc noise from the pre-existing drift_nudge error (mitigated by GOTCHA #5 — the bar is "no NEW errors from my files").