# Research Notes — P1.M1.T1.S2: `loadMulliganConfig(cwd?)` entry point

## Dependency on S1 (assumed implemented)
`src/settings.ts` already contains (exported `@internal`):
- `readSettingsFile(filePath: string): Record<string, unknown>` — fail-open `{}` reader.
- `deepMergeSettings(global, project): Record<string, unknown>` — recursive own-key merge, project wins.
- private `isRecord`.
- imports only `node:fs`. Module header notes S2 will add `loadMulliganConfig`.

`test/settings.test.ts` already exists with `readSettingsFile` + `deepMergeSettings` describe blocks
(module-level `let dir;` + `beforeEach`/`afterEach` using `mkdtempSync`/`rmSync`).

## What S2 adds
- `src/settings.ts`: `import { getAgentDir } from "@earendil-works/pi-coding-agent";` + `import { join } from "node:path";` + `export function loadMulliganConfig(cwd?: string): unknown`. Update module header.
- `test/settings.test.ts`: `vi.mock` + `vi.hoisted` at module top + new `describe("loadMulliganConfig")` block (scoped beforeEach/afterEach).

## Verified facts (runtime)
- `getAgentDir` IS re-exported from package index:
  `node_modules/@earendil-works/pi-coding-agent/dist/index.js:3` → `export { CONFIG_DIR_NAME, getAgentDir, getDocsPath, getExamplesPath, getPackageDir, getReadmePath, VERSION } from "./config.js";`
- `getSettingsPath` is **NOT** re-exported from index (grep empty). → MUST use `path.join(getAgentDir(), "settings.json")` (matches item contract + system_context §1.3).
- `getAgentDir()` impl (config.js:412-418): reads `process.env.PI_CODING_AGENT_DIR` live each call, else `join(homedir(), ".pi", "agent")`. Does NOT throw normally → test case (g) needs a throwable mock.

## Mocking decision (test case g drives it)
Contract test cases (a)-(f) could use `process.env.PI_CODING_AGENT_DIR` (live read). But case (g)
"getAgentDir throws → undefined" REQUIRES a controllable mock that can throw. Single clean mechanism:
`vi.mock("@earendil-works/pi-coding-agent", factory)` + `vi.hoisted` to share mutable impl state
(vi.mock factory is hoisted above `let` declarations). vitest 1.6.1 supports `vi.hoisted`.

vi.mock is file-scoped → only affects test/settings.test.ts. S1's readSettingsFile/deepMergeSettings
tests don't call getAgentDir → unaffected. Minimal factory `{ getAgentDir }` is enough (settings.ts
imports only getAgentDir from the package).

## Consumer contract (out of scope — P1.M1.T2 wires index.ts)
- Factory `function(pi)`: `setConfig(loadMulliganConfig(process.cwd()))` — no ctx, best-effort cwd.
- `session_start(event, ctx)`: `setConfig(loadMulliganConfig(ctx.cwd))` — authoritative + /reload seam.
- After each setConfig, re-fire `setLogFile(getConfig().log.file)`.

## Return-type detail
`deepMergeSettings` returns `Record<string, unknown>`, so `merged.mulligan` is `unknown` directly;
the contract's `(merged as Record<string,unknown>)?.mulligan` cast is defensive/harmless. Return
type is `unknown`. Outer `try/catch → return undefined` is the fail-open wrapper (getAgentDir throw,
process.cwd throw, or any unforeseen error → undefined → validateConfig(undefined) → DEFAULT_CONFIG).

## tsc bar
Only pre-existing error is `test/drift_nudge.test.ts:239` (BUG-002, separate task P1.M2.T1.S1).
S2 must add NO new errors. Watch: vi.hoisted typed state + null-check before calling the impl fn
(keep strict-mode happy). vi.mock factory return type is permissive under vitest types.