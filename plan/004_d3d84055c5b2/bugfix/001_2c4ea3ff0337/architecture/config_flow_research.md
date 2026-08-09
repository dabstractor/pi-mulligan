# Config Flow Research — pi-mulligan

Research scope: how `getConfig()` / `setConfig()` are initialized, cached, and consumed across `src/`,
and what each consumer does when `enabled: false`. Includes a feasibility probe of the installed Pi
0.84.1 extension API surface (directly relevant to BUG-001, the non-functional settings.json surface).

All file:line references are against the working tree as inspected. Pi version installed:
`@earendil-works/pi-coding-agent` 0.84.1.

---

## 1. Executive Summary

- **Initialization is a single, hard-coded call.** `src/index.ts:30` calls `setConfig(undefined)` and
  that is the **only** `setConfig()` call site in all of `src/`. `validateConfig(undefined)` always
  yields `DEFAULT_CONFIG` (`enabled: true`, `log.file: null`). No code anywhere reads Pi's
  `settings.json`. This is the root cause of BUG-001.
- **The consumers are fully wired and correct** — they all gate on `getConfig().enabled` and would
  honor real user settings *if* they were ever loaded. The gap is purely the loader (the `undefined`
  argument), not the consumer logic. Every master-switch, sub-feature gate, and threshold read is in
  place downstream of the cache.
- **Pi 0.84.1 exposes NO settings accessor to extensions.** Neither `ExtensionAPI` nor
  `ExtensionContext` exposes a settings getter, and `SettingsManager` is **not** re-exported from the
  extensions module. CONFIRMED (see §7). This means a real fix cannot "ask Pi for settings"; it must
  either read the settings file(s) directly from disk or wait for an upstream accessor.
- **Log destination is also dead** for the same reason: `index.ts:33 setLogFile(getConfig().log.file)`
  always passes `null`, so `log.file` (spec §10 primary observability surface) can never be enabled by
  a user.

---

## 2. Config Initialization (`src/index.ts`)

The factory is the single entry point (`package.json` `main` + `pi.extensions`):

```ts
export default function (pi: ExtensionAPI): void {
  // 1. Load + cache config at factory time (v1: validated defaults … setConfig(undefined) → DEFAULT_CONFIG;
  //    reading real settings.mulligan is v1.1). Never throws.
  setConfig(undefined);                       // index.ts:30  ← THE BUG: always DEFAULT_CONFIG

  // 2. Point the logger at the configured destination (after the cache is populated). null = off (default).
  setLogFile(getConfig().log.file);           // index.ts:33  ← always null (log dead too)

  // 3. Register all 5 agent-callable tools (factories capture `pi` via closure; auditTool is a plain const).
  pi.registerTool(makeRewindTool(pi));
  pi.registerTool(makeShrinkTool(pi));
  pi.registerTool(makeCheckpointTool(pi));
  pi.registerTool(auditTool);
  pi.registerTool(makeCancelTool(pi));

  // 4. Arm the 3 event-driven handlers.
  registerFilterHandler(pi);   // pi.on("context", …)
  registerBloatReminder(pi);   // pi.on("tool_result", …)
  registerTurnEndMetric(pi);   // pi.on("turn_end", …)

  // 5. session_start → reset this session's runtime (reads sessionId FRESH — C12).
  pi.on("session_start", (_event, ctx) => {
    resetRuntime(ctx.sessionManager.getSessionId());   // index.ts:~50 — NOTE: no setConfig here
  });

  // 6. session_shutdown → wipe ALL per-session runtimes.
  pi.on("session_shutdown", () => { clearAll(); });
}
```

Key observations for the fix:
- **The factory signature is `(pi: ExtensionAPI): void`** — it receives **only `pi`**, NO `ctx`. At
  factory time there is **no working directory** and **no settings accessor** available. This
  constrains what config loading can do at factory time.
- The `session_start` handler **does** receive `(event, ctx)` and so **has** `ctx.cwd` and
  `ctx.sessionManager.getCwd()` — but the current handler does **not** call `setConfig` there.
- The code comment at `index.ts:28-29` explicitly admits the gap: "v1: validated defaults — no Pi
  settings accessor in v1; … reading real settings.mulligan is v1.1".
- spec/09 §1 promises config is "loaded lazily … and re-read on /reload" — but nothing re-reads it.

---

## 3. Config Module API (`src/config.ts`)

This module is Pi-free and fully capable of validating a raw settings object (it is unit-tested in
`test/config.test.ts`). The validation engine exists; it is simply never fed real user settings.

### `getConfig(): MulliganConfig` (`config.ts:180`)
- Public read API. LAZY: on first call (cache empty) validates `DEFAULT_CONFIG` and caches it.
- Returns a fresh `structuredClone` on EVERY call (callers can never mutate the session cache or
  `DEFAULT_CONFIG`). Cheap (~10 fields). Callers must still treat result as read-only.

### `setConfig(raw: unknown): void` (`config.ts:195`)
- Initialize / replace the session cache from a raw settings object. Called from the index.ts factory
  / session_start handler (and again on /reload). Accepts the merged Pi settings object (or
  `settings.mulligan`); the caller is responsible for extraction (config.ts is Pi-free).
- **NEVER throws**: any error resets the cache to validated defaults (outer try/catch →
  `validateConfig(undefined)`).

### `validateConfig(raw: unknown): MulliganConfig` (`config.ts:~210`)
- Pure, fail-safe validation engine. Deep-merges `raw` over a clone of `DEFAULT_CONFIG`, validates +
  coerces each known field per spec/09 §4, ignores unknown keys (forward-compat), returns a
  fully-valid `MulliganConfig`. NEVER throws (whole body in try/catch → fresh `DEFAULT_CONFIG` clone).
- Exported so unit tests exercise it directly. Reads each field via a throwing-safe `safeGet`, applies
  coercers (`coerceBoolean`, `coerceNumber`, `coerceProtectedRoles`, `coerceBloatThresholdByTool`,
  `coerceEstimateConfidence`, `coerceLogFile`), and `warnConfig`s on present-but-invalid values.

### `MulliganConfig` shape (`config.ts:24`) — the full knob surface
Top-level: `enabled`. Sub-trees: `rewind{enabled,protectedRoles,maxDepth,maxRetriesPerPrompt,
abortContextFraction,requireMutationWarning}`, `shrink{enabled,maxActive,staleAfterFires}`,
`nudges{bloatReminder,perTurnDrift,bloatThresholdBytes,bloatThresholdBytesByTool?,driftThresholdTokens,
driftWindowTurns,highWaterFraction}`, `audit{estimateConfidence}`, `log{file}`.

**Implication:** `validateConfig` is ready to consume a raw `settings.mulligan` object. A correct
fix only needs to **obtain** that object and call `setConfig(settings.mulligan)` instead of
`setConfig(undefined)`. The downstream behavior is already implemented and tested.

---

## 4. ALL `getConfig()` Call Sites (consumers)

There are **7** call sites in `src/` that read config. Each reads a fresh clone and (for the gated
ones) short-circuits cleanly when `enabled: false`. Note `validateConfig` would make ALL of these
honor real settings if the cache were loaded from real settings.

| # | File:line | Field(s) read | `enabled:false` behavior | Notes |
|---|-----------|---------------|--------------------------|-------|
| 1 | `index.ts:33` | `log.file` | (bootstrap) passes `null` → logging off | `setLogFile(getConfig().log.file)`. Dead today (cache always null). |
| 2 | `filter.ts:239` | `enabled` (+ passes whole `config` to `filterPipeline`) | `if (!config.enabled) return;` → **context pass-through** (does NOT pollute the audit cache). When enabled, also reads nudges knobs + rewind knobs via `filterPipeline(markers, config, …)`. | The filter heart. Whole config threaded into the Pi-free pipeline. |
| 3 | `nudges.ts:119` | `enabled`, `nudges.bloatReminder`, `nudges.bloatThresholdBytes(…ByTool)` | `if (!config.enabled \|\| !config.nudges.bloatReminder) return;` BEFORE any measurement (GOTCHA #8) → **no bloat reminder appended, no bloat hit recorded**. | Nudge A (`tool_result` handler). |
| 4 | `nudges.ts:199` | `enabled`, `nudges.perTurnDrift`, `nudges.driftThresholdTokens` | `if (!config.enabled \|\| !config.nudges.perTurnDrift) return;` BEFORE measurement → **no turn metric written, no drift nudge**. | Nudge B Phase 1 (`turn_end` handler). |
| 5 | `tools/rewind.ts:453` | `enabled`, `rewind.enabled`, `rewind.maxDepth`, `rewind.maxRetriesPerPrompt`, `rewind.abortContextFraction`, `rewind.protectedRoles`, `rewind.requireMutationWarning` | `if (!config.enabled) return refuse("Mulligan is disabled", granularity);` then `if (!config.rewind.enabled) return refuse("rewind is disabled", …);`. | Reads ONCE per execute (GOTCHA #14). Also runs maxDepth/retry-budget/abort-fraction guards + mutation warning. |
| 6 | `tools/shrink.ts:262` | `enabled`, `shrink.enabled` | `if (!config.enabled) return refusal("Mulligan is disabled");` then `if (!config.shrink.enabled) return refusal("shrink is disabled");`. | Reads ONCE per execute (GOTCHA #10). |
| 7 | `tools/audit.ts:534` | `audit.estimateConfidence`, `rewind.protectedRoles`, + whole `config` to `filterPipeline` (E16 fallback) | **NO `enabled` gate** (intentional — GOTCHA #4: audit is always-on read-only diagnostics). | Reads `config.audit.estimateConfidence`, `config.rewind.protectedRoles`, and threads `config` into the fallback `filterPipeline`. |
| 8 | `tools/cancel.ts:182` | `enabled` | `if (!getConfig().enabled) return refusal("Mulligan is disabled");` (E14 master switch ONLY — NO sub-feature knob; GOTCHA #6). | Reads ONCE per execute. |

Summary of `enabled:false` behavior across the system (all ALREADY implemented — they just never fire
today because the cache is always `DEFAULT_CONFIG`):
- **context filter** → pass-through (`filter.ts:240`).
- **bloat reminder** → suppressed (`nudges.ts:120`).
- **drift/turn metric** → suppressed (`nudges.ts:200`).
- **rewind/shrink/cancel tools** → refuse cleanly with "Mulligan is disabled"
  (`rewind.ts:454`, `shrink.ts:263`, `cancel.ts:182`).
- **audit tool** → intentionally ALWAYS runs (read-only diagnostics; no `enabled` gate).

---

## 5. ALL `setConfig()` Call Sites

**Exactly ONE**, and it is the bug:

- `index.ts:30` → `setConfig(undefined);` — always `DEFAULT_CONFIG`. There is **no** `setConfig` call
  in the `session_start` handler, the `context` handler, or anywhere else. There is no re-read-on-
  `/reload` path despite the config-cache comment promising it (`config.ts:167-168`).

---

## 6. `src/log.ts` — `setLogFile` consumption

`log.ts` is **Pi-free AND config-free**: it holds its own module-level `logFile: string | null`
(`log.ts:39`), configured via `setLogFile(path)` (`log.ts:48`). `log.ts` imports neither config.ts nor
Pi (this deliberately breaks a config↔log cycle: the log path comes FROM the config under validation).

- `setLogFile(getConfig().log.file)` is called once from `index.ts:33` after the cache is populated.
- Because the cache is always `DEFAULT_CONFIG` (`log.file: null`), logging is **always off** today.
  `log.file` (spec §10 primary observability surface) can NEVER be enabled by a user until BUG-001 is
  fixed — `setLogFile` only ever receives `null`.
- `log(level, event, sessionId, data?)` is a no-op when `logFile === null`; otherwise appends one JSONL
  line via `appendFileSync`, fail-open on any error (stderr fallback, never throws).

**Implication:** wiring real config will automatically light up logging for free, because
`index.ts:33` already passes `getConfig().log.file` into `setLogFile`. No separate fix needed for the
log surface.

---

## 7. Pi 0.84.1 Extension API Surface — Settings Accessor Feasibility (BUG-001)

The PRD claims Pi 0.84.1 exposes no settings accessor to extensions. **CONFIRMED** by direct
inspection of the installed `.d.ts` types:

### `ExtensionAPI` (`dist/core/extensions/types.d.ts:866`)
Methods present: `on(...)`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`,
`getFlag`, `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`,
`sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getSessionName`, `setLabel`,
`exec`, `getActiveTools`, `getAllTools`, `setActiveTools`, `getCommands`, `setModel`, …
**NO `getSettings` / `readSettings` / settings manager accessor.** (The only "settings" string
matches in `types.d.ts` are unrelated comments at lines 225 and 1100.)

### `ExtensionContext` (`types.d.ts:209`)
Fields/methods present: `ui`, `mode`, `hasUI`, `cwd`, `sessionManager` (a `ReadonlySessionManager`),
`modelRegistry`, `model`, `scopedModels`, `thinkingLevel`, `isIdle()`, `isProjectTrusted()`,
`signal`, `abort()`, `hasPendingMessages()`, `shutdown()`, `getContextUsage()`, `compact()`,
`getSystemPrompt()`.
**NO settings manager, NO settings getter, NO `agentDir`.**

### `SessionStartEvent` (`types.d.ts:415`)
Carries only: `type`, `reason` (`"startup" | "reload" | "new" | "resume" | "fork"`),
`previousSessionFile?`. **NO settings.**

### `ReadonlySessionManager` (`session-manager.d.ts:140`)
`Pick<SessionManager, "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile" | "getLeafId" |
"getLeafEntry" | "getEntry" | "getLabel" | "getBranch" | "buildContextEntries" | "getHeader" |
"getEntries" | "getTree" | "getSessionName">`.
**NOTE: `getCwd()` and `getSessionDir()` ARE exposed** → the extension CAN discover the working
directory at runtime (in a handler that has `ctx`). **No** settings accessor.

### `SettingsManager` reachability
`SettingsManager` exists internally (`dist/core/settings-manager.d.ts`) with `FileSettingsStorage`
holding `globalSettingsPath` / `projectSettingsPath` (constructed from `cwd` + `agentDir`) and methods
`getGlobalSettings()`, `getProjectSettings()`, `reload()`. **But `SettingsManager` is NOT re-exported
from `dist/core/extensions/index.d.ts`** (only extension types + `defineTool`/helpers/wrappers are
exported). An extension cannot import or construct it through the supported surface.

### Settings file locations (inferred from `FileSettingsStorage(cwd, agentDir)` + PRD/README)
- **Global:** `<agentDir>/settings.json` where `agentDir = ~/.pi/agent` (i.e. `~/.pi/agent/settings.json`).
- **Project-local:** `<cwd>/.pi/settings.json`.

### Feasibility conclusion for the BUG-001 fix
Because there is no settings accessor on the extension surface, a real "wire settings.json" fix has
**two** implementation paths:

1. **Read settings files directly from disk.** Construct the paths from available inputs:
   - Project-local: `path.join(ctx.sessionManager.getCwd() ?? ctx.cwd, ".pi", "settings.json")`.
   - Global: `path.join(os.homedir(), ".pi", "agent", "settings.json")`.
   Then `JSON.parse`, merge (project-local overriding global per spec/09 §1), extract `.mulligan`,
   and `setConfig(merged.mulligan)`. **Constraint:** the factory has no `ctx` (no `getCwd`/`cwd`), so
   loading at factory time is only possible for the GLOBAL path (via `os.homedir()`); full
   project-local merge must happen in `session_start` (which has `ctx`). Must be fail-open
   (missing/invalid file → fall back to defaults, never throw) to honor spec/03 #4 + spec/09 §4.

2. **Wait for / request an upstream settings accessor** on `ExtensionAPI`/`ExtensionContext`. Out of
   scope for an in-repo fix.

Either way, the existing consumer logic (§4) needs **no changes** — it already honors the cache.

---

## 8. Architectural Constraints / Patterns to Follow (for the implementation plan)

1. **config.ts stays Pi-free.** It is a foundation-tier unit. Settings extraction (locating +
   reading + merging the JSON files) belongs in a NEW loader, or in `index.ts`/a small `settings.ts`
   helper, NOT in `config.ts`. The contract: hand a raw object to `setConfig()`.
2. **Fail-open is mandatory.** Any file read/parse must be wrapped so a missing/invalid settings file
   never crashes the extension (spec/03 #4, spec/09 §4). The cache must always end up a valid
   `MulliganConfig` (defaults on any error). `setConfig` already guards with try/catch → defaults,
   but the loader's own I/O must also be fail-open.
3. **Factory-time vs session-time asymmetry.** The factory `(pi)` has no `ctx`; `session_start`'s
   `(event, ctx)` has `ctx.cwd` / `ctx.sessionManager.getCwd()`. Project-local settings resolution
   requires `ctx`, so it must run at `session_start` (and the cache must be re-set there). The spec's
   "re-read on /reload" promise maps onto the `session_start` handler with `reason: "reload"`.
4. **Lazy re-set is safe** because `getConfig()` returns clones and `setConfig()` is non-throwing.
   Re-setting the cache in `session_start` will not corrupt any held reference (callers re-read each
   event).
5. **Logging lights up for free** once config is real, because `index.ts:33` already passes
   `getConfig().log.file` to `setLogFile`. (If settings load moves to session_start, the
   `setLogFile(getConfig().log.file)` call must move/refire there too, or logging stays dead.)
6. **Test seam:** `index.test.ts` currently has NO config/settings assertions (grep for
   `setConfig|getConfig|enabled|settings` → no matches). Existing config validation is covered in
   `test/config.test.ts` via `validateConfig` directly. A settings-loader fix should add tests for the
   loader (file read + merge + fail-open + extraction), keeping config.ts unit tests untouched.

---

## 9. Residual Risks / Open Questions

- **Settings path discovery is inferred, not authoritative.** The exact `agentDir` resolution for the
  global path (env var like `PI_AGENT_DIR`? XDG? hardcoded `~/.pi/agent`?) is not exposed to
  extensions; the `~/.pi/agent/settings.json` path is taken from the PRD/README. An implementation
  that hard-codes `~/.pi/agent` may miss non-default agent dirs. This is a real limitation of
  disk-reading approach #1 and should be flagged to the decision authority (the "ideal" fix is an
  upstream accessor that does not exist yet).
- **Merge semantics** (global vs project-local precedence, and which fields deep-merge vs replace)
  must match spec/09 §1. The loader must decide whether to deep-merge the two files before handing to
  `setConfig`, or hand only one. `validateConfig` does NOT cross-file merge — it validates a single
  object — so the loader owns the merge step.
- **Scope of the README/spec documentation correction** (the PRD Recommendation: until a real accessor
  exists, stop advertising config / the `enabled:false` switch as working). This is a separate concern
  from the code fix; the parent should decide whether the task is "implement the loader" vs "correct
  the docs" vs both.