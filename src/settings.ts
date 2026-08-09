/**
 * settings.ts — the Pi-bound settings-loading module (BUG-001 config-surface repair).
 *
 * This module owns ALL coupling to Pi + node:fs/node:path. Its deliberate counterpart is `src/config.ts`,
 * which is Pi-free by design (config.ts:160 "imports NOTHING from Pi") and owns validation only
 * (validateConfig / setConfig / getConfig / DEFAULT_CONFIG). settings.ts reads raw settings files and hands
 * them to config.ts as `unknown` via `setConfig(raw)` — validation remains config.ts's job.
 *
 * PUBLIC ENTRY POINT (this subtask, P1.M1.T1.S2): `loadMulliganConfig(cwd?)` — the module's ONLY public
 * export. It reads the global (`~/.pi/agent/settings.json`, via getAgentDir()) + project-local
 * (`<cwd>/.pi/settings.json`) settings files, deep-merges them (project-local wins; nested objects recurse;
 * arrays replace — mirroring Pi's deepMergeObjects), and returns the merged `.mulligan` block as raw
 * `unknown`. The ENTIRE body is fail-open: any error → `undefined` → downstream `validateConfig(undefined)`
 * → `DEFAULT_CONFIG`, so the extension always boots. It hands raw `unknown` INTO the Pi-free `config.ts`
 * via `setConfig(raw)` (the setConfig handoff itself lives in src/index.ts, P1.M1.T2 — settings.ts only
 * reads + merges + extracts; it does NOT validate or call setConfig).
 *
 * LEAF HELPERS (built in the prerequisite subtask S1, exported @internal for direct unit testing):
 *   - `readSettingsFile(filePath)`  — fail-open synchronous JSON-file reader (returns `{}` on any failure).
 *   - `deepMergeSettings(global, project)` — recursive deep-merge mirroring Pi's `deepMergeObjects`
 *     (settings-manager.js:8-34): both-plain-objects → recurse; otherwise project replaces; arrays replace
 *     (never concatenate); keys present in only one side are preserved.
 *
 * DESIGN: the helpers carry `@internal` tags because their direct unit tests need them exported, but
 * loadMulliganConfig is the only intended runtime caller. This mirrors src/tools/audit.ts, which exports
 * describeMessage/buildCallLookup/listCheckpoints/messageBytes/renderAuditReport purely so tests can assert
 * them directly ("EXPORTED so the test can assert directly"). See Decision D1 in the PRP.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ── private helpers (module-local; not exported) ─────────────────────────────

/** True for plain records and Object.create(null); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── leaf helpers (exported @internal for direct unit testing in S1) ──────────

/**
 * readSettingsFile — synchronously read + JSON.parse a settings file, fail-open to `{}`.
 *
 * @internal — only `loadMulliganConfig` (S2) calls this at runtime; exported for direct unit testing in S1.
 *
 * Never throws (spec/03 #4 fail-open — the extension loads config at bootstrap, so a throw would crash
 * startup). A missing file (ENOENT), an unreadable file (EACCES), or invalid JSON (SyntaxError) all return
 * `{}`. Also returns `{}` when the parsed value is not a non-null, non-array object — e.g. a JSON array,
 * number, string, boolean, or `null` — because those shapes are not valid settings objects.
 *
 * Lock-safe: settings.json is overwrite-only (never concurrently appended in Pi), so a torn read simply
 * fails JSON.parse and fail-opens to `{}` (confirmed in pi_api_research §E).
 *
 * @param filePath absolute or relative path to the settings JSON file.
 * @returns the parsed object, or `{}` on any read/parse/shape failure.
 */
export function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, "utf8"); // throws ENOENT/EACCES on read failure
    const parsed: unknown = JSON.parse(raw); // throws SyntaxError on malformed JSON
    return isRecord(parsed) ? parsed : {}; // array/number/string/bool/null → {}
  } catch {
    return {}; // missing / unreadable / invalid JSON / non-object → fail-open
  }
}

/**
 * deepMergeSettings — recursive deep-merge of two settings objects; project-local wins.
 *
 * @internal — only `loadMulliganConfig` (S2) calls this at runtime; exported for direct unit testing in S1.
 *
 * Semantics mirror Pi's `deepMergeObjects` (settings-manager.js:8-34):
 *   - For each key in `project`: if BOTH the global and project values are plain objects (`isRecord` —
 *     typeof object, not null, not array), RECURSE into them.
 *   - Otherwise the project value REPLACES the global value. This covers primitives, arrays, and `null`
 *     (arrays are NOT concatenated; `null` is not a plain object despite typeof 'object', so it replaces).
 *   - Keys present only in `global` are preserved (via the initial `{ ...global }` spread).
 *   - Keys present only in `project` are added.
 *
 * Uses OWN-key iteration (`{ ...global }` spread + `Object.keys(project)`) so inherited `Object.prototype`
 * members (constructor/toString/valueOf/...) cannot leak in — the same own-property discipline as the
 * parallel `bloatThresholdFor` prototype-leak fix.
 *
 * @param global  the global settings object (e.g. ~/.pi/agent/settings.json).
 * @param project the project-local settings object (e.g. <cwd>/.pi/settings.json); wins on overlap.
 * @returns a NEW merged object (inputs are not mutated).
 */
export function deepMergeSettings(
  global: Record<string, unknown>,
  project: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...global }; // own enumerable keys of global preserved
  for (const key of Object.keys(project)) {
    // own keys only — no inherited prototype members
    const g = global[key];
    const p = project[key];
    out[key] = isRecord(g) && isRecord(p) ? deepMergeSettings(g, p) : p; // recurse | replace
  }
  return out;
}

// ── public entry point (the module's ONLY non-@internal export) ──────────────

/**
 * loadMulliganConfig — read + merge Pi settings and extract the raw `mulligan` block.
 *
 * Reads the GLOBAL settings file at `join(getAgentDir(), "settings.json")` (respects the
 * PI_CODING_AGENT_DIR env override) and the PROJECT-LOCAL file at
 * `join(cwd ?? process.cwd(), ".pi", "settings.json")`, deep-merges them (project-local wins; nested
 * objects recurse; arrays replace — via deepMergeSettings, mirroring Pi's deepMergeObjects), and returns
 * the merged `mulligan` object.
 *
 * @param cwd optional project working directory. Falls back to `process.cwd()` when undefined. At factory
 *   time (no ctx) pass `process.cwd()` or undefined; at `session_start` pass `ctx.cwd`.
 * @returns the raw, UNVALIDATED `mulligan` object (`unknown`), or `undefined` when the `mulligan` key is
 *   absent (the zero-config case → DEFAULT_CONFIG) or when any step fails.
 *
 * FAIL-OPEN: the entire body is wrapped in try/catch — a throwing getAgentDir(), an unreadable file, a
 * process.cwd() failure, etc. all return `undefined`. Callers feed the result to `setConfig(raw)`;
 * `validateConfig(undefined)` then yields `DEFAULT_CONFIG`, so the extension always boots. NEVER throws.
 *
 * The recursive merge of nested `mulligan` sub-objects (e.g. `mulligan.nudges`) is handled BY
 * deepMergeSettings — loadMulliganConfig does NOT re-merge, it only extracts the top-level `.mulligan` key.
 * Validation into a typed `MulliganConfig` is config.ts's job (via the P1.M1.T2 `setConfig` handoff), NOT
 * ours — hence the raw `unknown` return.
 */
export function loadMulliganConfig(cwd?: string): unknown {
  try {
    const globalSettings = readSettingsFile(join(getAgentDir(), "settings.json"));
    const projectSettings = readSettingsFile(join(cwd ?? process.cwd(), ".pi", "settings.json"));
    const merged = deepMergeSettings(globalSettings, projectSettings);
    return merged.mulligan; // Record<string, unknown>.mulligan → unknown | undefined
  } catch {
    return undefined; // fail-open: any error → undefined → validateConfig(undefined) → DEFAULT_CONFIG
  }
}