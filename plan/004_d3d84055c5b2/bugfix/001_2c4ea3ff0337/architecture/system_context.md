# System Context & Architecture Decision — BUG-001 + BUG-002

**Synthesizes:** pi_api_research.md, config_flow_research.md, docs_spec_research.md, tsc_fixture_research.md.
**Purpose:** Single authoritative reference for downstream PRP agents implementing the two fixes.

---

## 1. BUG-001: Configuration Surface Non-Functional

### 1.1 Root Cause (confirmed)

`src/index.ts:30` calls `setConfig(undefined)` — the ONLY `setConfig` call site in all of `src/`.
`validateConfig(undefined)` always yields `DEFAULT_CONFIG` (enabled: true, log.file: null).
No code anywhere reads Pi's `settings.json`. The entire 17-knob configuration surface — including
the `enabled: false` master disable switch — silently does nothing.

### 1.2 Why No Accessor Exists (confirmed)

Pi 0.84.1's `ExtensionAPI` (factory arg) and `ExtensionContext` (handler/tool arg) expose NO
settings accessor. Verified by reading the full interfaces in
`dist/core/extensions/types.d.ts`. No event payload carries settings either.

### 1.3 What IS Available at Runtime (confirmed)

| Export | Available at runtime? | Returns |
|--------|-----------------------|---------|
| `getSettingsPath()` | **NO** (defined in config.d.ts but NOT re-exported from package index) | `undefined` |
| `getAgentDir()` | **YES** | `~/.pi/agent/` (respects `PI_CODING_AGENT_DIR` env var) |
| `SettingsManager` | **YES** (class) | Manages global+project settings merge |
| `CONFIG_DIR_NAME` | **YES** | `".pi"` |

At runtime, `getAgentDir()` gives us the global agent directory. Settings paths are:
- **Global:** `path.join(getAgentDir(), "settings.json")` → `~/.pi/agent/settings.json`
- **Project-local:** `path.join(cwd, ".pi", "settings.json")` → `<cwd>/.pi/settings.json`

### 1.4 Lifecycle Asymmetry

| Time | Has `ctx`? | Has `cwd`? | What can be loaded? |
|------|-----------|-----------|---------------------|
| Factory `function(pi)` | NO | `process.cwd()` only (best-effort) | Global settings + best-effort project-local |
| `session_start(event, ctx)` | YES | `ctx.cwd` (authoritative) | Full merged settings (global + project-local) |
| `context`/`tool_result`/`turn_end` handlers | YES | `ctx.cwd` | (No re-read needed; cache already set) |

**Decision:** Load at BOTH seams:
1. **Factory:** `setConfig(loadMulliganConfig(process.cwd()))` — covers the common `pi` invoked in a project dir.
2. **session_start:** `setConfig(loadMulliganConfig(ctx.cwd))` — authoritative project-local; re-reads on `/reload` (reason: "reload"), "new", "resume", "fork".

### 1.5 Architectural Decision: New `src/settings.ts` Module

**`config.ts` stays Pi-free** (design constraint: `config.ts:160` "imports NOTHING from Pi —
settings are handed in via setConfig()"). The settings-file-reading logic belongs in a NEW
Pi-bound module: `src/settings.ts`.

```
┌─────────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   src/settings.ts   │─────▶│   src/config.ts  │─────▶│ All consumers   │
│ (Pi-bound, fs reads)│      │ (Pi-free validate)│      │ (filter, nudges,│
│ loadMulliganConfig()│      │ setConfig(raw)    │      │  tools, log)    │
└─────────────────────┘      └──────────────────┘      └─────────────────┘
        ▲                           ▲
        │                           │
┌───────┴───────┐          ┌────────┴────────┐
│  src/index.ts │──────────│  getConfig()    │
│ (factory +    │          │  (lazy cache)   │
│  session_start)│         └─────────────────┘
└───────────────┘
```

**`src/settings.ts` contract:**
- IMPORTS: `getAgentDir` from `@earendil-works/pi-coding-agent`; `readFileSync` from `node:fs`; `join` from `node:path`.
- EXPORTS: `loadMulliganConfig(cwd?: string): unknown` — returns the raw `mulligan` object from merged settings (or `undefined` if absent/error).
- BEHAVIOR:
  1. Read global `settings.json` via `path.join(getAgentDir(), "settings.json")`.
  2. Read project-local `settings.json` via `path.join(cwd ?? process.cwd(), ".pi", "settings.json")`.
  3. Deep-merge (project-local wins, recursive for nested objects like `rewind`, `nudges`).
  4. Return `(merged as Record<string, unknown>)?.mulligan` — or `undefined` if absent.
  5. FAIL-OPEN: every step wrapped in try/catch; any error → `undefined` (→ `validateConfig(undefined)` → `DEFAULT_CONFIG`).
- NO SIDE EFFECTS: pure read-only. No file writes, no locks.

**Deep-merge rules** (must match Pi's `deepMergeObjects` in `settings-manager.js:8-34`):
- Both values are plain objects → recurse.
- Otherwise → project-local value replaces global value.
- Arrays are replaced (not concatenated).

### 1.6 Consumer Verification (no changes needed)

All downstream consumers ALREADY gate on `getConfig().enabled`:

| Consumer | Location | Gate | `enabled:false` behavior |
|----------|----------|------|--------------------------|
| contextHandler | `filter.ts:240` | `if (!config.enabled) return;` | Pass-through (no transform) |
| bloatReminderHandler | `nudges.ts:122` | `if (!config.enabled \|\| !config.nudges.bloatReminder) return;` | No annotation |
| turnEndMetricHandler | `nudges.ts:200` | `if (!config.enabled \|\| !config.nudges.perTurnDrift) return;` | No nudge |
| mulligan_rewind | `rewind.ts:454` | `if (!config.enabled) return refuse(...)` | Refuses "Mulligan is disabled" |
| mulligan_shrink | `shrink.ts:263` | `if (!config.enabled) return refusal(...)` | Refuses "Mulligan is disabled" |
| mulligan_cancel | `cancel.ts:182` | `if (!getConfig().enabled) return refusal(...)` | Refuses "Mulligan is disabled" |
| mulligan_audit | `audit.ts:534` | NO gate (always-on diagnostics) | Runs regardless |
| mulligan_checkpoint | `checkpoint.ts` | NO gate (intentional) | Runs regardless |

**Implication:** The downstream consumer logic is fully implemented and tested. The ONLY fix needed is the upstream settings loading. No changes to filter.ts, nudges.ts, or any tool.

### 1.7 Logging Lights Up for Free

`index.ts:33` already calls `setLogFile(getConfig().log.file)`. Once real config is loaded,
this passes the user's `log.file` path instead of `null`. The session_start re-read must also
re-fire `setLogFile(getConfig().log.file)` after `setConfig(...)`.

---

## 2. BUG-002: tsc --noEmit Failure

### 2.1 Root Cause (confirmed)

`test/drift_nudge.test.ts:239` — the `rt()` helper builds a `SessionRuntime` fixture missing
the `rewindRefusedTurnIndex` field (added by P4 drift-nudge-mute work). The `as SessionRuntime`
cast on a near-complete literal fails TS2352 under `strict: true`.

### 2.2 Fix

Add `rewindRefusedTurnIndex: null,` to the fixture object (matches `freshRuntime()` default).
Exactly one line change in one file.

### 2.3 CI Gate

Add `"typecheck": "tsc --noEmit"` to `package.json` scripts so `npm run typecheck` is available
for CI. No existing script covers this (vitest transpiles without type-checking).

---

## 3. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | New `src/settings.ts` module (not in config.ts) | config.ts is Pi-free by design; settings.ts is Pi-bound |
| D2 | Direct disk read (not SettingsManager) | Minimal coupling; avoids Pi's lockfile machinery; predictable |
| D3 | Use `getAgentDir()` (not hard-coded path) | Respects `PI_CODING_AGENT_DIR` env var for non-default agent dirs |
| D4 | Load at factory + session_start | Factory covers common case; session_start has authoritative cwd + handles /reload |
| D5 | No project-trust gating | Settings.json is config not code; validateConfig is fail-safe; simplifies impl |
| D6 | Re-fire setLogFile on session_start | Log destination can change between sessions/reloads |
| D7 | Deep-merge matches Pi's semantics | Project-local wins; nested objects recurse; arrays replace |

---

## 4. Files Changed (summary)

| File | Change | Bug |
|------|--------|-----|
| `src/settings.ts` | **NEW** — settings-loading module | BUG-001 |
| `src/index.ts` | Wire `loadMulliganConfig()` at factory + session_start; update comments | BUG-001 |
| `test/settings.test.ts` | **NEW** — unit tests for settings.ts | BUG-001 |
| `test/index.test.ts` | Update factory/session_start assertions for config loading | BUG-001 |
| `test/drift_nudge.test.ts` | Add `rewindRefusedTurnIndex: null` to fixture | BUG-002 |
| `package.json` | Add `"typecheck": "tsc --noEmit"` script | BUG-002 |
| `README.md` | Final sweep — verify Configuration/Disabling sections are accurate | Both |