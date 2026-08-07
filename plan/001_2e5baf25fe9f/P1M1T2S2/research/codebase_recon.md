# Code Context — P1.M1.T2.S2 (getConfig + validateConfig + setConfig)

Codebase recon for implementing `getConfig()` / `validateConfig()` / `setConfig()` in
`src/config.ts`. S1 (P1.M1.T2.S1) already delivered `src/config.ts` (interface + DEFAULT_CONFIG)
and `test/config.test.ts`. This brief is the INPUT contract S2 must consume WITHOUT modifying the
existing exports.

---

## 0. Work-item definition (tasks.json, authoritative)

`plan/001_2e5baf25fe9f/tasks.json` entry `P1.M1.T2.S2` (status: "Researching") verbatim scope:

> "LOGIC: Implement getConfig(): MulliganConfig that reads the merged Pi settings object … Implement a validateConfig(raw: unknown): MulliganConfig function that: deep-merges raw with DEFAULT_CONFIG, validates each field per spec §4 rules, coerces types safely, returns the validated config. Wrap everything in try/catch returning DEFAULT_CONFIG on any error. Implement a setConfig(settings: unknown) function to initialize the cache (called from index.ts factory or session_start). … OUTPUT: Exported functions getConfig(): MulliganConfig and setConfig(raw: unknown): void. Consumed by filter.ts, tools/*, nudges.ts, and index.ts."

So S2 must **add to the SAME file** `src/config.ts` (per S1 PRP "Integration Points": "S2 owns getConfig() (the 'load + validate' half), ADDED to the SAME file"). It must NOT touch the S1 exports.

**Required new public exports (the exact API surface):**
```ts
export function getConfig(): MulliganConfig;
export function setConfig(raw: unknown): void;
export function validateConfig(raw: unknown): MulliganConfig; // spec/09 §4 names it; tasks.json names it
```
Note: `setConfig(raw: unknown): void` in tasks.json vs the PRP/spec psuedocode. Use `void` (tasks.json is authoritative for signatures).

---

## 1. EXACT INPUT CONTRACT (the S1 deliverable S2 consumes — DO NOT modify)

**File:** `src/config.ts` (delivered by S1, currently UNTRACKED in git `?? src/config.ts`).
**Test:** `test/config.test.ts` (UNTRACKED `?? test/`), passes 3/3 under vitest 1.6.1.

### Exported type aliases (verbatim, src/config.ts:7-8)
```ts
export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";
export type EstimateConfidence = "low" | "medium" | "high";
```

### MulliganConfig interface (verbatim, src/config.ts:11-83)
```ts
export interface MulliganConfig {
  enabled: boolean;
  rewind: {
    enabled: boolean;
    protectedRoles: string[];
    maxDepth: number;
    requireMutationWarning: boolean;
  };
  shrink: {
    enabled: boolean;
    // NOTE: "autoOnBloat" is reserved ... NOT in v1
  };
  nudges: {
    bloatReminder: boolean;
    perTurnDrift: boolean;
    bloatThresholdBytes: number;    // "Must be > 0"
    driftThresholdTokens: number;   // "Must be > 0"
  };
  audit: {
    estimateConfidence: EstimateConfidence;   // uses the alias, NOT inline union
  };
  log: {
    file: string | null;           // null = off; NOT string | undefined
  };
}
```
All fields non-readonly, all JSON-serializable (GOTCHA #8). `shrink` has ONLY `enabled` (no `autoOnBloat`).

### DEFAULT_CONFIG (verbatim, src/config.ts:96-117)
```ts
export const DEFAULT_CONFIG: MulliganConfig = {
  enabled: true,
  rewind: { enabled: true, protectedRoles: ["first:user", "latest:user"], maxDepth: 5, requireMutationWarning: true },
  shrink: { enabled: true },
  nudges: { bloatReminder: true, perTurnDrift: true, bloatThresholdBytes: 8192, driftThresholdTokens: 3000 },
  audit: { estimateConfidence: "medium" },
  log: { file: null },
};
```
JSDoc says: "CONSTANT: do not mutate. getConfig() (S2) returns a freshly-merged copy built atop this object (deep-cloned before user overrides are applied), never this object itself." ⇒ **S2 MUST deep-clone before merging** (use `structuredClone` — see §7; it IS typed as a global).

---

## 2. ALL references across spec/ + plan/ (downstream consumer API surface)

### getConfig() call sites (the consumers S2's getConfig serves)
| File:line | Consumer | How it uses getConfig |
|---|---|---|
| `spec/06-context-filter.md:13` | filter.ts handler | `const config = getConfig(); if (!config.enabled) return;` then reads `config.nudges.perTurnDrift`, passes `config` into `shouldNudge(metric, config)` and `applyRewindSafe(..., config, ctx)` |
| `spec/07-preventive-and-nudges.md:18` | nudges.ts tool_result hook | `const config = getConfig(); if (!config.enabled || !config.nudges.bloatReminder) return;` then `config.nudges.bloatThresholdBytes` |
| `spec/07-preventive-and-nudges.md:78` | nudges.ts turn_end hook | `const config = getConfig(); if (!config.enabled || !config.nudges.perTurnDrift) return;` then `config.nudges.driftThresholdTokens` |
| `spec/09-configuration.md:10` | (spec §1) | "loaded lazily on first use and cached for the session; re-read on `/reload`. `getConfig()` returns the validated, defaulted config." |
| `plan/.../system_context.md:99` | arch note | "config.ts — getConfig(), validation" |

### config.* FIELD accesses by downstream (the exact keys validateConfig must produce)
- **master switch:** `config.enabled` — filter.ts:14, tools (05:66 shrink validate), 07:19,07:79, 08:72, 11:139
- **rewind:** `config.rewind.enabled` (05:66), `config.rewind.maxDepth` (05:71, 08:23), `config.rewind.requireMutationWarning` (05:80, 08:30), `config.rewind.protectedRoles` (06:185, 06:189 — enforced by filter + tools)
- **shrink:** `config.shrink.enabled` (05:135), `config.shrink.autoOnBloat` (07:61 — **NOT in v1, omit**)
- **nudges:** `config.nudges.bloatReminder` (07:19), `config.nudges.perTurnDrift` (07:79, 06:28, 06:259), `config.nudges.bloatThresholdBytes` (07:23, 07:25, 05:208), `config.nudges.driftThresholdTokens` (07:96)
- **audit:** `config.audit.estimateConfidence` (consumed by audit tool — 05 §4; reports confidence label)
- **log:** `config.log.file` (consumed by log.ts — T3)

⇒ Every field of MulliganConfig has a consumer. No dead fields.

### MulliganConfig / DEFAULT_CONFIG references in plan/
- `plan/.../P1M1T2S1/PRP.md` — the S1 PRP (contract source; "S2 owns getConfig() … ADDED to the SAME file").
- `plan/.../P1M1T2S1/research/verification.md:80-99` — "S2's getConfig() must NOT hand out references to [DEFAULT_CONFIG] … S2 should deep-clone (structuredClone or per-field spread) before merging." and "getConfig() will read settings.mulligan via an unknown/Partial<MulliganConfig> cast (e.g. `(settings as any).mulligan as Partial<MulliganConfig>`) since Pi's Settings type cannot be augmented cleanly."
- `plan/.../system_context.md:99` — config.ts = getConfig() + validation.

### setConfig / validateConfig references
- Only in `tasks.json` (S2 entry) and `spec/09-configuration.md §4` heading ("Validation rules (in config.ts)"). `validateConfig` is not yet referenced by any spec consumer code — it is the internal engine `setConfig`/`getConfig` use.

---

## 3. EXACT validation & lifecycle rules (spec/09, verbatim)

### spec/09 §1 "Where config is read" (verbatim, 09:8-11)
> - **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
> - **When:** loaded lazily on first use and cached for the session; re-read on `/reload`. `getConfig()` returns the validated, defaulted config.
> - **Validation:** unknown keys are ignored (forward-compat). Type-mismatched values fall back to the default with a warn log. This must never throw.

### spec/09 §4 "Validation rules (in config.ts)" (verbatim, 09:67-74)
> - Booleans: coerce with `!!`; invalid → default.
> - Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.
> - `protectedRoles`: must be an array of known selector strings (`"first:user"`, `"latest:user"`); unknown entries ignored (with warn). v1 does not support arbitrary role rules.
> - `estimateConfidence`: must be one of `"low"|"medium"|"high"`; else default.
> - `log.file`: if set, must be a string; opening is deferred to first write (and wrapped — a bad path must not crash the extension).
> - On any per-field validation failure: log a warn naming the field and the value, use the default, continue. **Never throw.**

**Implications for S2:**
- `!!` for booleans (researcher notes `'false'` string → truthy; that is spec-intended).
- Numbers: `Number.isFinite()` AND `typeof === 'number'` (researcher 2bef28ee: NEVER use global `isFinite()` — it coerces strings). `maxDepth` is `>= 0`; `bloatThresholdBytes`/`driftThresholdTokens` are strictly `> 0` (they are thresholds).
- `protectedRoles`: filter array to entries ∈ `{"first:user","latest:user"}`; drop unknown with warn.
- `estimateConfidence`: enum check vs `{"low","medium","high"}`; else `"medium"`.
- `log.file`: if not a string, default `null`. (Opening/writing is T3's concern, NOT S2's — S2 only validates the *value*.)
- Whole function wrapped in try/catch → return `structuredClone(DEFAULT_CONFIG)` on any error.

---

## 4. protectedRoles selector strings — CONFIRMED + discrepancy

**Canonical spelling: `"first:user"` and `"latest:user"`.** Confirmed in:
- `spec/09-configuration.md:22` (§2 default): `"protectedRoles": ["first:user", "latest:user"]`
- `spec/09-configuration.md:56` (§3 rationale table): `` ["first:user","latest:user"] ``
- `spec/09-configuration.md:71` (§4): `"first:user"`, `"latest:user"`
- `spec/06-context-filter.md:189` (§8): `["first:user", "latest:user"]` semantics

**DISCREPANCY (illustrative only — do NOT use):** `spec/04-data-model.md:210` (§7 co-located summary) uses loose prose:
> `protectedRoles: string[];        // never rewind past; default ["user" (first), "user" (latest)]`

This is describing the ROLES, not the selector strings. The S1 PRP GOTCHA #2 already resolved this: spec/09 §2 is authoritative for config → use `"first:user"`,`"latest:user"`. The DEFAULT_CONFIG already ships those exact strings. **No action for S2 other than to validate against `{"first:user","latest:user"}`.**

---

## 5. log.ts ABSENT — fail-safe warn logging for v1

**log.ts does NOT exist** (`ls src/` → only `config.ts`, `index.ts`, `tools/`). It is **P1.M1.T3** (status: "Planned"), a separate, later task. S2 must ship validation BEFORE the structured logger exists.

- `spec/09 §4` requires a "warn log" on per-field failure, but the structured `LogLine` logger (spec/04 §9: `{ts, level:"warn", event, sessionId, data?}`) is T3's deliverable.
- `spec/11 §2 Step 1` lists config.ts + log.ts + runtime.ts together, but the tasks.json ordering puts log.ts in T3 (after T2). So at S2's ship time, the logger is absent.

**Safest fail-safe for v1 in config.ts:** emit warnings via `console.warn(...)` wrapped in its own try/catch (so a logging failure can never throw and violate "Never throw"). Pattern:
```ts
function warnConfig(field: string, value: unknown): void {
  try { console.warn(`[mulligan] config: invalid ${field}=${JSON.stringify(value)}, using default`); } catch { /* never throw */ }
}
```
This is a stand-in to be swapped for the structured logger when T3 ships (S2 should keep the warn call site in a single local helper so T3 can re-point it). `console.warn` is safe (never throws in Node). Do NOT import or create `src/log.ts`.

---

## 6. Test conventions — vitest confirmed

- `spec/10-testing.md §1`: "Framework: any (Vitest/node:test)" — leaves it open.
- **Actual choice (S1 scaffold): VITEST.** `package.json scripts.test` = `"vitest run"`; `devDependencies.vitest` = `"^1"`; installed = **vitest 1.6.1**.
- **Existing test file `test/config.test.ts`** import style (verbatim):
  ```ts
  import { describe, it, expectTypeOf, expect } from "vitest";
  import { DEFAULT_CONFIG, type MulliganConfig, type Granularity, type EstimateConfidence } from "../src/config.js";
  ```
  ⇒ vitest, NOT node:test. Import path uses `../src/config.js` (Bundler/ESM resolution maps `.js` → `.ts`).
- `tsconfig.json include: ["src","test"]` ⇒ tests are type-checked by the `tsc --noEmit` gate too.

**S2 test guidance:** EXTEND the existing `test/config.test.ts` (S1 PRP: "S2 will EXTEND the same file with getConfig tests — do not duplicate it"). Add `getConfig`/`setConfig`/`validateConfig` cases. Researcher artifact `2bef28ee/research.md` §5 gives ready patterns: `expect(() => validateConfig(x)).not.toThrow()` over adversarial inputs (null, primitives, arrays, Proxy w/ throwing getters, circular refs), singleton-immutability assertions (`a`≠`b` referential, `DEFAULT_CONFIG` unchanged), and `vi.resetModules()` for cache isolation (or an explicit `setConfig` reset).

---

## 7. tsconfig.json + structuredClone typing — CONFIRMED

### tsconfig.json (verbatim)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noImplicitAny": true, "types": ["node"], "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```
Flags: `strict` ✓, `noImplicitAny` ✓, `types: ["node"]` (ONLY node — no DOM lib), `moduleResolution: "Bundler"`, `include: ["src","test"]`. No `lib` array set ⇒ defaults to `["ES2022","DOM","DOM.Iterable","ScriptHost"]` per target, but `types:["node"]` restricts `@types/*`.

### structuredClone IS typed as a global under types:["node"] — VERIFIED
- `@types/node@22.20.1`, declaration at `node_modules/@types/node/worker_threads.d.ts:781`:
  ```ts
  global {
      function structuredClone<T>(
          value: T,
          options?: { transfer?: Transferable[] },
      ): T;
  ```
  The `global { … }` block makes it a **global** declaration (not module-scoped). It is surfaced automatically whenever `@types/node` is included (i.e. `types:["node"]`).
- **Empirically verified:** created `src/__sc_test.ts` containing `const x = structuredClone({ a: 1 });` → `npx tsc --noEmit -p tsconfig.json` exit **0**. So S2 can call `structuredClone(DEFAULT_CONFIG)` directly with NO import and NO type error. (The `2bef28ee/research.md` note claiming it lives in `globals.d.ts` is imprecise — it is in `worker_threads.d.ts`, but still globally typed. No functional impact.)

⚠️ **Edge:** `structuredClone` throws `DataCloneError` on functions/symbols. DEFAULT_CONFIG is plain JSON (booleans/numbers/strings/string[]/null) so it is always safe — but if S2 validates a *user* `raw` that may contain a Proxy/function BEFORE cloning, only clone DEFAULT_CONFIG (never raw). Validate raw field-by-field; clone only the default.

---

## 8. State & cache design (from spec/09 §1 + researcher)

`spec/09 §1`: "loaded lazily on first use and cached for the session; re-read on `/reload`."
⇒ S2 needs a module-level cache: `let cached: MulliganConfig | null = null;`
- `setConfig(raw)`: `cached = validateConfig(raw);` (called from index.ts factory / session_start; also the test seam to reset).
- `getConfig()`: if `cached == null`, `cached = validateConfig(undefined)` (defaults); return `structuredClone(cached)` (HAND OUT A COPY — never the singleton; JSDoc GOTCHA #7).
- `/reload` re-read: the cleanest v1 hook is `setConfig` being re-called; spec/11 Step 8 ties `/reload` to marker survival, not config. Keep it simple: S2 exposes `setConfig`; wiring the re-read to a `/reload` event is index.ts's job (P1.M7).

**No dependency on Pi at this stage:** S1 PRP + system_context confirm Pi's `Settings` is a closed interface with no `mulligan` key and `ExtensionContext` exposes no settings accessor (api_verification.md §3.1). So for v1, `setConfig` receives the settings object from the factory (which casts `(settings as any).mulligan` → `unknown`). config.ts itself still imports NOTHING from Pi (config.ts stays dependency-free → the tsc gate stays purely local).

---

## 9. Start Here

**Open `src/config.ts` first.** It is the ONE file S2 edits (append `getConfig`/`setConfig`/`validateConfig` + a private `warnConfig` helper + the `cached` state, below the existing exports). Do NOT alter lines 1-117 (the S1 contract). Then open `test/config.test.ts` to extend with getConfig/validation cases.

Primary gate (run after editing): `npx tsc --noEmit -p tsconfig.json` (must exit 0) and `npx vitest run test/config.test.ts` (must stay green).

---

## 10. Residual risks / open questions (FLAGGED)

1. **`validateConfig` naming ambiguity.** tasks.json names `validateConfig`; spec/09 §4 header says "Validation rules (in config.ts)" without naming the export. No downstream consumer imports `validateConfig` by name yet (only `getConfig`/`setConfig` are consumed externally). Recommend: export all three (`getConfig`, `setConfig`, `validateConfig`) — `validateConfig` as the testable pure engine, `getConfig`/`setConfig` as the cached public API. Low risk.
2. **`setConfig` signature.** tasks.json: `setConfig(raw: unknown): void`. The 2bef28ee researcher artifact and S1 PRP psuedocode occasionally show `setConfig(settings: unknown)`. Use `setConfig(raw: unknown): void` (tasks.json authoritative). Low risk.
3. **`/reload` re-read wiring.** spec/09 §1 says "re-read on /reload" but the mechanism (Pi event?) is not pinned. S2 ships `setConfig`; the actual re-call on `/reload` is index.ts (P1.M7). S2 should document this; the lazy+cached model still satisfies §1 within a session. Medium risk only if a reviewer insists on full /reload behavior in T2.
4. **`console.warn` stand-in vs structured logger.** v1 uses `console.warn` (wrapped) because log.ts (T3) is absent. When T3 ships, the warn helper should be re-pointed to the structured `LogLine` (level "warn"). S2 must NOT create/import log.ts. Low risk (spec/09 §4 only requires "a warn"; the channel is unspecified pre-T3).
5. **structuredClone on Node version.** Requires Node ≥17 global. The runtime here is Node v26.7.0 (vitest run output) and @types/node 22 — fine. No risk.
6. **`bloatThresholdBytes`/`driftThresholdTokens` validation bound.** spec/09 §4 says "thresholds `> 0`" and the field JSDoc says "Must be > 0". `maxDepth` is "`>= 0`" (general number rule). Implement the strict-`> 0` check for the two thresholds and `>= 0` for maxDepth. No risk if followed.