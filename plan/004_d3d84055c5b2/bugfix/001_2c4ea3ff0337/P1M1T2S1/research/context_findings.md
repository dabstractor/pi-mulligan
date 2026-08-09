# Research Notes — P1.M1.T2.S1 (wire loadMulliganConfig into factory body, BUG-001)

## Target & the bug
`src/index.ts` factory line 30: `setConfig(undefined);` — the ONLY setConfig call site in all of `src/`.
This hardcodes DEFAULT_CONFIG forever, so the documented `enabled:false` switch + all 17 config knobs do
nothing, and `setLogFile(getConfig().log.file)` (line 33) is always `null` → logging is dead too.
Root-cause doc: `architecture/config_flow_research.md §2` ("THE BUG: always DEFAULT_CONFIG").

## Confirmed exact current state of src/index.ts (verbatim, from grep + read)
- Line 2:  `import { setConfig, getConfig } from "./config.js";`
- Line 18 (JSDoc body): `* full cleanup). Zero-config: setConfig(undefined) → validated DEFAULT_CONFIG (enabled:true, log off).`
- Lines 28–29 (inline comment):
  `// 1. Load + cache config at factory time (v1: validated defaults — no Pi settings accessor in v1;`
  `//    setConfig(undefined) → DEFAULT_CONFIG; reading real settings.mulligan is v1.1). Never throws.`
- Line 30: `  setConfig(undefined);`  ← REPLACE
- Line 33: `  setLogFile(getConfig().log.file);`  ← KEEP (lights up for free once config is real)
- session_start handler (~lines 47–49): `pi.on("session_start", (_event, ctx) => { resetRuntime(ctx.sessionManager.getSessionId()); });`
  NOTE: does NOT call setConfig. Adding that is **T2.S2** (separate subtask) — I MUST NOT touch this handler.

## The dependency: loadMulliganConfig (src/settings.ts) — CONFIRMED IMPLEMENTED & matches T1.S2 contract
- `export function loadMulliganConfig(cwd?: string): unknown` (settings.ts, already present & matching PRP).
- Body: one outer try/catch. Reads `readSettingsFile(join(getAgentDir(), "settings.json"))` (global) +
  `readSettingsFile(join(cwd ?? process.cwd(), ".pi", "settings.json"))` (project-local), deep-merges via
  `deepMergeSettings`, returns `merged.mulligan` (unknown | undefined). catch → return undefined (fail-open).
- settings.ts imports getAgentDir (@earendil-works/pi-coding-agent) + join (node:path). Pi-coupled by design.
- It returns RAW `unknown` (no validation). Validation is config.ts's job via setConfig.

## config.ts consumer API (confirmed)
- `setConfig(raw: unknown): void` (line 195): try { cachedConfig = validateConfig(raw); } catch { cachedConfig = validateConfig(undefined); } → NEVER throws; bad raw → DEFAULT_CONFIG.
- `getConfig(): MulliganConfig` (line 180): returns `structuredClone(cachedConfig)` (lazy-inits to DEFAULT_CONFIG). Callers treat as read-only.
- So the wiring `setConfig(loadMulliganConfig(process.cwd()))` is doubly fail-open (loadMulliganConfig never throws AND setConfig never throws).

## Lifecycle asymmetry (architecture/system_context.md §1.4 — authoritative table)
- Factory `function(pi)`: NO ctx → `process.cwd()` only → `setConfig(loadMulliganConfig(process.cwd()))`.
- `session_start(event, ctx)`: HAS ctx.cwd → `setConfig(loadMulliganConfig(ctx.cwd))` (+ re-fire setLogFile).
- T2.S1 = FACTORY ONLY. T2.S2 = session_start. My comment must REFERENCE session_start re-read ("see below / P1.M1.T2.S2") but NOT implement it.

## The fix (T2.S1 scope — factory body ONLY)
1. ADD import after line 2 (config group): `import { loadMulliganConfig } from "./settings.js";`
2. Line 30: `setConfig(undefined);` → `setConfig(loadMulliganConfig(process.cwd()));`
3. Line 33: UNCHANGED.
4. UPDATE inline comment (lines 28–29): drop the "v1/v1.1 no accessor" language; state config now loads from
   merged Pi settings via loadMulliganConfig, cwd=process.cwd() (no ctx at factory — D4 asymmetry), session_start
   re-reads with ctx.cwd (T2.S2), never throws (loadMulliganConfig + setConfig both fail-open).
5. UPDATE factory JSDoc (lines 14–27): replace "Zero-config: setConfig(undefined) → DEFAULT_CONFIG" with the
   loadMulliganConfig reality (reads merged settings; absent/invalid → DEFAULT_CONFIG via fail-open).

## Testing (test/index.test.ts) — must deterministically prove the wiring
- PROBLEM: in the test env, loadMulliganConfig reads REAL `~/.pi/agent/settings.json` + `<repo>/.pi/settings.json`
  → unpredictable return → can't behaviorally assert. MUST mock the module to be deterministic.
- EXISTING style: hand-rolled fakes for Pi objects (makePi/makeCtx capture .on/.registerTool). NO vi.fn for Pi
  objects. I keep that; I use vi.mock ONLY for the settings.js module dep (module mocks ≠ object fakes).
- PATTERN: `vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }));` at module top (hoisted),
  then `import { loadMulliganConfig } from "../src/settings.js";` → that binding IS the mock.
  `vi.mocked(loadMulliganConfig).mockReturnValue({enabled:false})` controls the return.
- ASSERTIONS (proves wiring end-to-end without a real settings file):
  - `expect(loadMulliganConfig).toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith(process.cwd())`.
  - `vi.mocked(loadMulliganConfig).mockReturnValue({enabled:false})` → after indexFactory → `getConfig().enabled === false`
    (proves the return value flows loadMulliganConfig → setConfig → validateConfig → getConfig).
  - `mockReturnValue(undefined)` → `getConfig().enabled === true` (DEFAULT_CONFIG fail-open).
- ISOLATION: add `vi.mocked(loadMulliganConfig).mockReset()` to the module-level `beforeEach` (after clearAll()) so
  every test starts with an undefined-returning clean mock. Existing tests call indexFactory → setConfig(undefined)
  → DEFAULT_CONFIG (unchanged behavior). vi.mock is file-scoped → does not leak to other test files.
- IMPORTS to add to the test file: `vi` (vitest), `getConfig` (../src/config.js). vi.mock call placed AFTER
  imports per vitest hoisting rules (vitest hoists it regardless, but conventional placement reads cleaner).

## Validation commands (verified project tooling)
- `npx vitest run test/index.test.ts` — fast, isolated.
- `npx vitest run` — full suite (confirm no regression; settings.test.ts from T1.S2 + others still green).
- `npx tsc --noEmit` — EXACTLY ONE pre-existing error at test/drift_nudge.test.ts:239 (BUG-002, P1.M2.T1.S1, NOT mine).
  My bar: NO error referencing src/index.ts or test/index.test.ts.

## Scope guard (what I must NOT touch)
- session_start handler body (T2.S2 owns it).
- src/settings.ts (T1.S2 owns it — already done), src/config.ts (Pi-free, unchanged).
- test/drift_nudge.test.ts:239 (BUG-002, P1.M2.T1.S1).
- README/spec (P1.M3.T1).