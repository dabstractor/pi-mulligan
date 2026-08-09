/**
 * settings.ts — the Pi-bound settings-loading module (BUG-001 config-surface repair).
 *
 * This module owns ALL coupling to Pi + node:fs/node:path. Its deliberate counterpart is `src/config.ts`,
 * which is Pi-free by design (config.ts:160 "imports NOTHING from Pi") and owns validation only
 * (validateConfig / setConfig / getConfig / DEFAULT_CONFIG). settings.ts reads raw settings files and hands
 * them to config.ts as `unknown` via `setConfig(raw)` — validation remains config.ts's job.
 *
 * SCOPE (this subtask, P1.M1.T1.S1): the two LEAF helpers the settings pipeline depends on:
 *   - `readSettingsFile(filePath)`  — fail-open synchronous JSON-file reader (node:fs only, no Pi import).
 *   - `deepMergeSettings(global, project)` — recursive deep-merge mirroring Pi's `deepMergeObjects`
 *     (settings-manager.js:8-34): both-plain-objects → recurse; otherwise project replaces; arrays replace
 *     (never concatenate); keys present in only one side are preserved.
 *
 * PENDING (S2, P1.M1.T1.S2): `loadMulliganConfig(cwd?)` — the PUBLIC entry point. It will add
 * `import { getAgentDir } from "@earendil-works/pi-coding-agent";` + `import { join } from "node:path";`,
 * resolve the global (`~/.pi/agent/settings.json`) + project-local (`<cwd>/.pi/settings.json`) paths via
 * getAgentDir(), call readSettingsFile on each, deepMergeSettings(global, project), then return the merged
 * `.mulligan` block as `unknown` for setConfig. That orchestration does NOT exist yet — this module is
 * intentionally incomplete after S1 (only the tested primitives are here).
 *
 * DESIGN: the helpers are exported with `@internal` tags because S1's contract requires direct unit tests,
 * but loadMulliganConfig (S2) is the only intended runtime caller. This mirrors src/tools/audit.ts, which
 * exports describeMessage/buildCallLookup/listCheckpoints/messageBytes/renderAuditReport purely so tests can
 * assert them directly ("EXPORTED so the test can assert directly"). See Decision D1 in the PRP.
 */
import { readFileSync } from "node:fs";

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