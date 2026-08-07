# Codebase recon — structured JSONL logger (P1.M1.T3.S1)

First-hand findings from the live repo at `/home/dustin/projects/pi-mulligan`.
Run: `node --version` → **v26.7.0**; `npx tsc --version` → 5.9.3 (resolved);
`package.json` devDeps resolve: vitest 1.6.1, `@types/node` 22.20.1.

## Files that exist / matter for this subtask

| path | role for THIS subtask |
|---|---|
| `package.json` | `"type":"module"`, `main:"src/index.ts"`, `pi.extensions:["./src/index.ts"]`; devDeps `typescript ^5`, `vitest ^1`, `@types/node ^22`; script `"test":"vitest run"`. **No vitest config file exists** (verified) → vitest uses defaults + `tsconfig.include:["src","test"]`. |
| `tsconfig.json` | `strict`, `noImplicitAny`, `types:["node"]`, `moduleResolution:"Bundler"`, `include:["src","test"]`, `skipLibCheck`. ⇒ `appendFileSync`, `process`, `structuredClone`, `node:fs` all resolve with no extra config. |
| `src/index.ts` | current S2-era stub: `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"; export default function (pi: ExtensionAPI) { pi.on("session_start", () => {}); }`. **NOT wired to config or log** — that wiring is **P1.M7.T1** (out of scope here). |
| `src/config.ts` | **S1 + S2 content present.** Exports `MulliganConfig` (incl. `log: { file: string \| null }`), `DEFAULT_CONFIG` (`log.file: null`), `getConfig()`, `setConfig()`, `validateConfig()`. The `log.file` value is `null` by default. NOTE: the file currently uses an `UNSET = Symbol(...)` sentinel — the parallel S2 PRP (GOTCHA #11) is REPLACING that with `undefined`-as-absence RIGHT NOW. ⇒ **DO NOT touch `config.ts` in this subtask** (parallel edit → merge conflict). |
| `test/config.test.ts` | the established **test convention** to follow: `import { describe, it, expect, ... } from "vitest";` then `import { ... } from "../src/config.js";` (note the `.js` extension — required for ESM + Bundler resolution). Uses `beforeEach`, `vi`, `expectTypeOf`. Top-level `describe`/`it` blocks. |
| `src/tools/`, `test/integration/` | empty (future subtasks). |

## The exact LogLine shape (spec/04-data-model.md §9 — AUTHORITATIVE)

```ts
interface LogLine {
  ts: string;                        // ISO 8601 (new Date().toISOString())
  level: "debug" | "info" | "warn" | "error";
  event: string;                     // dotted, e.g. "rewind.applied", "filter.fire", "nudge.inject"
  sessionId: string;
  data?: unknown;                    // OPTIONAL — omit from JSON when undefined
}
```

## The exact required public API (work-item contract OUTPUT)

```ts
log(level, event, sessionId, data?): void          // main
logInfo / logDebug / logWarn / logError(event, sessionId, data?): void  // curry the level
setLogFile(path: string | null): void              // configure destination (null = off)
```

Consumers (per contract + spec/11 layout): `filter.ts`, `tools/*`, `nudges.ts`,
`markers.ts`, `index.ts` — **all LATER subtasks**. None import the logger yet, so
this subtask ships the module standalone.

## Circular-dependency / call-order analysis (the key design decision)

- The work-item contract says: *"the logger should accept the file path as a
  parameter or read it from config at call time"* and *"export a setLogFile(…)
  function … called from index.ts when config is loaded."*
- ⇒ **`src/log.ts` imports NOTHING from `config.ts`** (or Pi). It holds its own
  module-level `let logFile: string | null = null;` updated by `setLogFile`.
  `index.ts` (P1.M7.T1) will call `setLogFile(getConfig().log.file)` after config
  load. This is the only cycle-free wiring: `index.ts → {config, log}`, with
  `log` and `config` independent of each other.
- **Re-pointing `config.ts`'s `warnConfig` helper to the structured logger is
  OUT OF SCOPE and, on reflection, architecturally wrong**: `warnConfig` runs
  *during* `validateConfig` (i.e. while `settings.json` is being parsed), which
  is necessarily **before** `setLogFile` has been called (the log path comes
  *from* the config being validated — chicken-and-egg). So config-validation
  warns must stay on `console.warn`/stderr; the structured logger is for runtime
  events only. Documented as a scope decision in the PRP. (S2's GOTCHA #8 mooted
  a future re-point; this subtask intentionally does NOT do it, both to avoid a
  chicken-and-egg no-op AND to avoid editing the parallel-in-flight `config.ts`.)

## Verified Node facts (see external_best_practices.md)

- `appendFileSync(file, str, "utf8")`: default flag `'a'` → creates+appends;
  throws `ENOENT` (missing parent dir), `EISDIR` (path is a dir), `EACCES`
  (perms) — all synchronous, all caught by our try/catch.
- `JSON.stringify` throws `TypeError` on circular refs and BigInt → the
  stringify + append must share ONE try/catch.
- `process.stderr.write(str)` returns `boolean`; spied in tests via
  `vi.spyOn(process.stderr, "write")`.

## Baseline gates (run before starting)

```bash
npx tsc --noEmit -p tsconfig.json     # expect exit 0 (S1/S2 green)
npx vitest run test/config.test.ts    # expect all-green (S1 + S2 suites)
```

## Gates this subtask must leave green after

```bash
npx tsc --noEmit -p tsconfig.json     # exit 0 (new log.ts + log.test.ts type-check)
npx vitest run                        # ALL tests green (config + log)
grep -c '@earendil-works/pi-coding-agent' src/log.ts   # 0 (log.ts is Pi-free)
grep -c 'from "config' src/log.ts                     # 0 (no config import → no cycle)
```