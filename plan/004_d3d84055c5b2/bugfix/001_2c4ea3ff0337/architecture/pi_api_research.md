# Pi Extension API Research — How extensions can read `settings.json`

**Purpose:** Determine how (or whether) the pi-mulligan extension can read the `mulligan`
object from Pi's `settings.json`, to unblock BUG-001 (config surface is non-functional —
`src/index.ts:30` hard-codes `setConfig(undefined)`).

**Pi version investigated:** `@earendil-works/pi-coding-agent@0.84.1`
(confirmed at `node_modules/@earendil-works/pi-coding-agent/package.json:3`).
pi-mulligan depends on `"@earendil-works/pi-coding-agent": "*"` (`package.json:8`).

---

## TL;DR (verdict)

1. **Pi 0.84.1 exposes NO settings accessor on the extension API.** Neither `ExtensionAPI`
   (the object passed to the factory) nor `ExtensionContext` (passed to every event handler /
   tool `execute()`) has any method to read the host's `settings.json`. The PRD's root-cause
   claim is **verified and correct**.
2. **There is no `getSettings()` / `config` / `loadConfig` on either surface.** Verified by
   reading the full interfaces (see §A).
3. **The fix must read `settings.json` directly from disk.** This is a supported, documented
   pattern — Pi's own example extension `sandbox` reads its own config file from disk, and Pi
   exports reliable path helpers (`getSettingsPath()`, `getAgentDir()`, `CONFIG_DIR_NAME`) plus
   the full `SettingsManager` class from its public package entry point. See §C for the
   recommended architecture and §D for the exact file paths.
4. **The clean seam is `index.ts`** (the only Pi-binding module), which already imports from
   `@earendil-works/pi-coding-agent` and already calls `setConfig()` / `setLogFile()`. The
   `config.ts` validation engine stays Pi-free (by design) — it must remain fed raw via
   `setConfig(settings.mulligan)`.
5. **Project-local `cwd` is NOT available at factory time** (the factory receives only
   `pi: ExtensionAPI`). It IS available in event handlers via `ctx.cwd` /
   `ctx.sessionManager.getCwd()`. The `session_start` handler is the natural re-read seam and
   is already wired in `index.ts`.

---

## A. ExtensionAPI & ExtensionContext — no settings accessor (verified)

**Source of truth file:**
`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`

### A.1 `ExtensionAPI` (`types.d.ts`, "ExtensionAPI passed to extension factory functions")
The complete method set (every member — there are NO others):
- Event subscription: `on(event, handler)` for ~35 event types.
- `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `getFlag`.
- `registerMessageRenderer`, `registerMarkdownTransformer`, `registerEntryRenderer`.
- `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`, `getSessionName`, `setLabel`.
- `exec`, `getActiveTools`, `getAllTools`, `setActiveTools`, `getCommands`.
- `setModel`, `getThinkingLevel`, `setThinkingLevel`.
- `registerProvider`, `unregisterProvider`, `events` (EventBus).

**There is no `getSettings`, `getConfig`, `settings`, `loadConfig`, or any config/reader member.**
`getFlag(name)` exists but is for *extension-registered CLI flags only* (via `registerFlag`),
not for reading `settings.json`.

### A.2 `ExtensionContext` (`types.d.ts`, "Context passed to extension event handlers")
Complete member set:
- `ui: ExtensionUIContext`, `mode: ExtensionMode`, `hasUI: boolean`, `cwd: string`.
- `sessionManager: ReadonlySessionManager`, `modelRegistry: ModelRegistry`, `model`, `scopedModels`, `thinkingLevel?`.
- `isIdle()`, `isProjectTrusted()`, `signal`, `abort()`, `hasPendingMessages()`, `shutdown()`.
- `getContextUsage(): ContextUsage | undefined`, `compact()`, `getSystemPrompt()`.

**No settings accessor.** The closest usable fields are `cwd: string` and
`sessionManager: ReadonlySessionManager` (which exposes `getCwd()`).

### A.3 ExtensionEvent payloads — none carry settings
Checked every event type in `types.d.ts` (the `ExtensionEvent` union + each `*Event` interface).
None carry a settings/config payload. Relevant ones for config re-reading:
- `SessionStartEvent`: `{ type, reason: "startup"|"reload"|"new"|"resume"|"fork", previousSessionFile? }`.
  No settings — but `reason: "reload"` is the documented re-read trigger (matches spec/09 §1
  "re-read on /reload"). The handler also receives `ctx` with `ctx.cwd`.
- `ContextEvent`: `{ type, messages }`. No settings.
- `TurnEndEvent`: `{ type, turnIndex, message, toolResults }`. No settings.

### A.4 `SessionStartEvent`/`SessionShutdownEvent` and the runner
`ExtensionRunner` (`dist/core/extensions/runner.d.ts`) holds private `cwd`, `sessionManager`,
`modelRegistry`, etc., and builds contexts via `createContext()`. No settings object is stored
on the runner and none is injected into contexts. Confirmed: settings are simply not part of the
extension runtime in 0.84.1.

---

## B. SessionManager surface available to handlers (for project-local cwd)

`ReadonlySessionManager` (`dist/core/session-manager.d.ts`) =
`Pick<SessionManager, "getCwd" | "getSessionDir" | "getSessionId" | "getSessionFile" | "getLeafId"
 | "getLeafEntry" | "getEntry" | "getLabel" | "getBranch" | "buildContextEntries" | "getHeader"
 | "getEntries" | "getTree" | "getSessionName">`.

Usable for config: **`getCwd(): string`** (also `ctx.cwd: string` on `ExtensionContext`).
This gives the authoritative project working directory for the project-local settings file.

---

## C. Recommended fix architecture (grounded in the codebase)

### C.1 Where settings live (verified in Pi source)
From `dist/core/settings-manager.js` (`FileSettingsStorage` constructor, lines 44–47):
```js
this.globalSettingsPath  = join(resolvedAgentDir, CONFIG_DIR_NAME? -> NO, "settings.json");
//   → <agentDir>/settings.json  = ~/.pi/agent/settings.json
this.projectSettingsPath = join(resolvedCwd, CONFIG_DIR_NAME, "settings.json");
//   → <cwd>/.pi/settings.json
```
Pi **deep-merges** global + project (project wins; recursive nested merge) — see
`deepMergeSettings` / `deepMergeObjects` (`settings-manager.js` lines 8–34). So a
`mulligan` block split across both files merges correctly; pi-mulligan should mirror this.

### C.2 Path helpers exported from the public package entry point
`@earendil-works/pi-coding-agent` re-exports from `dist/config.ts` / `dist/config.d.ts` (see
`dist/index.d.ts` first export line). Available and stable:
- `getSettingsPath(): string` → global settings.json path (`<getAgentDir()>/settings.json`).
- `getAgentDir(): string` → `~/.pi/agent/` by default; **respects `PI_CODING_AGENT_DIR` env var**
  (`dist/config.js:412-417`; `ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"` since `APP_NAME="pi"`).
- `CONFIG_DIR_NAME = ".pi"` (`config.js:394`, from `package.json` `piConfig.configDir`).
- `ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"`, `ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR"`.

### C.3 The `SettingsManager` class is also publicly exported
`SettingsManager` (`dist/core/settings-manager.d.ts`) is re-exported from the package index.
`SettingsManager.create(cwd, agentDir?, options?)` loads both files and exposes
`getGlobalSettings()` / `getProjectSettings()` (each returns `structuredClone` of the raw parsed
object). **Crucially, `migrateSettings()` only touches known legacy keys and `return`s the
settings object unchanged otherwise** (`settings-manager.js:193-241`) — so an unknown key like
`mulligan` **survives** `getGlobalSettings()`/`getProjectSettings()` intact. The `Settings`
interface is typed and has no `mulligan` field, so reading it requires a cast (`as Record`).

### C.4 Recommended approach (matches existing patterns)
**Read the files directly from disk in `index.ts`** (the Pi-binding layer), extract `.mulligan`,
hand it to `setConfig()`. This:
- keeps `config.ts` Pi-free (its stated design — `config.ts:160` "imports NOTHING from Pi …
  settings are handed in via setConfig()"),
- mirrors Pi's own example-extension pattern (`examples/extensions/sandbox/index.ts:13-16` reads
  its own `sandbox.json` from `~/.pi/agent/extensions/` and `<cwd>/.pi/`),
- honors the `PI_CODING_AGENT_DIR` override by using `getSettingsPath()` rather than hard-coding
  `~/.pi/agent/settings.json`.

Two implementation styles, in increasing coupling:
1. **Direct disk read (recommended).** A small Pi-bound helper in `index.ts` (or a new
   `src/settings-reader.ts` that imports the path helpers): `readFileSync` both files, `JSON.parse`
   in try/catch (absent/unparseable → treat as `{}`), deep-merge project-over-global (reuse a small
   recursive merge — Pi's `deepMergeObjects` is the reference), return `merged.mulligan`.
   Fail-open: any error → `undefined` → `validateConfig` yields `DEFAULT_CONFIG`.
2. **Use `SettingsManager`.** `import { SettingsManager } from "@earendil-works/pi-coding-agent"`;
   `const sm = SettingsManager.create(cwd, undefined, { projectTrusted: true })`; read
   `sm.getGlobalSettings()` + `sm.getProjectSettings()`, deep-merge, cast to read `.mulligan`.
   Slightly heavier coupling to Pi internals (and triggers Pi's settings-locking machinery), but
   reuses Pi's exact merge/migrate logic. **Option 1 is preferred** for minimal coupling and to
   avoid importing Pi's lockfile/fs machinery into the extension path.

### C.5 When to read (the two seams — both already present in `index.ts`)
- **Factory time** (`index.ts:28` block "1. Load + cache config"): global settings are always
  available via `getSettingsPath()`. Project-local needs `cwd`, which is NOT passed to the factory
  (`export default function (pi: ExtensionAPI)`). Fallback to `process.cwd()` as a best-effort
  project-local read at factory time (covers the common `pi` invoked in a project dir).
- **`session_start` handler** (`index.ts`, already wired): `ctx.cwd` /
  `ctx.sessionManager.getCwd()` give the authoritative project dir. **Re-read merged settings here
  and re-call `setConfig()` + `setLogFile()`** so `/reload` (reason "reload") and session resume
  pick up current config. This is the spec/09 §1 "re-read on /reload" seam.
- After any `setConfig(...)`, re-point the logger with `setLogFile(getConfig().log.file)` (the
  existing pattern at `index.ts:32`).

### C.6 Master `enabled:false` no-op
Once config is wired, the documented off-switch must be honored. The handlers already call
`getConfig()`; they must early-return (and tools must refuse cleanly) when `getConfig().enabled`
is `false`. Verify the existing handler bodies in `filter.ts` / `nudges.ts` / the five tools
already gate on `enabled` (or add the gates where missing) — this is the user-visible half of the
fix beyond just calling `setConfig(settings.mulligan)`.

---

## D. Exact file paths & line numbers (for the implementer)

| Fact | Location |
|------|----------|
| `setConfig(undefined)` — the only config init, the bug | `src/index.ts:30` |
| `setConfig` / `getConfig` / `validateConfig` definitions | `src/config.ts:195`, `:175`, `:208` |
| config.ts is Pi-free by design | `src/config.ts:160` |
| README documents config as working | `README.md:64` ("## 3. Configuration") onward |
| Pi version | `node_modules/@earendil-works/pi-coding-agent/package.json:3` (`0.84.1`) |
| `ExtensionAPI` full interface | `dist/core/extensions/types.d.ts` ("ExtensionAPI passed to…") |
| `ExtensionContext` full interface | same file ("Context passed to extension event handlers") |
| `ReadonlySessionManager` (has `getCwd`) | `dist/core/session-manager.d.ts` |
| Settings file path logic (global + project) | `dist/core/settings-manager.js:44-47` (`FileSettingsStorage`) |
| Deep-merge (project over global) | `dist/core/settings-manager.js:8-34` |
| `migrateSettings` preserves unknown keys (`mulligan`) | `dist/core/settings-manager.js:193-241` |
| `getSettingsPath()` / `getAgentDir()` / `CONFIG_DIR_NAME` | `dist/config.d.ts` (+ impl `dist/config.js:394,412,432`) |
| `ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"` | `dist/config.js:397` |
| `SettingsManager.create(cwd, agentDir?)` | `dist/core/settings-manager.js:144` |
| Example extension reading its own disk config | `examples/extensions/sandbox/index.ts:13-16` |
| `session_start` handler (re-read seam, already wired) | `src/index.ts` (pi.on("session_start", …)) |

### Resolved absolute paths (defaults; `PI_CODING_AGENT_DIR` overrides global)
- Global settings: `~/.pi/agent/settings.json`  (i.e. `join(os.homedir(), ".pi", "agent", "settings.json")`)
- Project-local settings: `<projectCwd>/.pi/settings.json`  (i.e. `join(cwd, ".pi", "settings.json")`)
- Both contain an optional top-level `"mulligan": { … }` object → deep-merged → extract `.mulligan`.

---

## E. Risks / caveats for the implementer
- **No upstream accessor means reading files is the only route** until Pi adds one. The PRD's
  recommendation to "correct the README/spec to stop advertising config as working" applies ONLY
  if config is *not* wired; this research shows it CAN be wired via direct disk reads, so the
  better path is to implement the read (BUG-001 fix) rather than retract the docs.
- **Factory-time `cwd`**: only `process.cwd()` is available; the authoritative project dir comes
  from `ctx` at `session_start`. A two-stage load (global at factory, merged at session_start) is
  correct and matches the existing session_start wiring.
- **Project-trust gating**: Pi only loads project settings when the project is trusted
  (`settings-manager.js:170-172`, `loadFromStorage` returns `{}` for untrusted project scope). A
  direct disk read bypasses this gate; decide whether to mirror it (use
  `ctx.isProjectTrusted()` at the session_start seam) or always read (simpler). Recommend reading
  always for global, and gating project-local on `ctx.isProjectTrusted()` to match Pi semantics.
- **Locking**: `SettingsManager` uses `proper-lockfile` for writes. A read-only disk read via
  `readFileSync` does not need locking and is safe (settings.json is append/overwrite-only; a torn
  read just fails JSON.parse and fail-opens to defaults).
- **Env override**: always use `getSettingsPath()` (not a hard-coded `~/.pi/agent/settings.json`)
  so `PI_CODING_AGENT_DIR` is respected for non-default agent dirs.