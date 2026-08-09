# PRP — P1.M1.T1.S1: `readSettingsFile()` + `deepMergeSettings()` private helpers in `src/settings.ts` (BUG-001, step 1/2)

---

## Goal

**Feature Goal**: Create the NEW `src/settings.ts` module containing the two leaf utility helpers that the settings-loading pipeline (completed in S2 by `loadMulliganConfig`) depends on: (1) `readSettingsFile(filePath)` — a fail-open synchronous JSON-file reader, and (2) `deepMergeSettings(global, project)` — a recursive deep-merge whose semantics exactly mirror Pi's `deepMergeObjects` (`settings-manager.js:8-34`). These are the pure fs + merge primitives; **no Pi imports, no path resolution, no `loadMulliganConfig`** in this subtask.

**Deliverable**:
1. `src/settings.ts` (NEW) — module header + `readFileSync` import + private `isRecord` helper + the two helpers (`@internal`, exported for direct testing).
2. `test/settings.test.ts` (NEW) — vitest unit tests covering fail-open parsing + deep-merge semantics (recurse / replace / arrays-replace / non-overlapping preserved).

**Success Definition**:
- `npx vitest run test/settings.test.ts` — all pass (missing file → `{}`, invalid JSON → `{}`, valid JSON object → parsed, non-object JSON → `{}`; merge: nested recurse, project primitive replaces, arrays replace, both-only keys preserved).
- `npx vitest run` — full suite passes (no regressions; new settings tests added).
- `npx tsc --noEmit` — NO new errors originate from `src/settings.ts` or `test/settings.test.ts`. (The pre-existing single error at `test/drift_nudge.test.ts:239` is BUG-002, owned by a SEPARATE task P1.M2.T1.S1 — see GOTCHA #5. Do NOT fix it here.)

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and the S2 implementer who builds `loadMulliganConfig` on top of these helpers. Not end-user-facing.

**Use Case**: The downstream `loadMulliganConfig(cwd)` (S2) calls `readSettingsFile` on both the global (`~/.pi/agent/settings.json`) and project-local (`<cwd>/.pi/settings.json`) files, then `deepMergeSettings(global, project)` to produce the merged `mulligan` block handed to `setConfig`.

**User Journey**: S2 implementer imports both helpers → reads global + project files → deep-merges → extracts `.mulligan` → hands to `setConfig()`. The fail-open contract means a missing/corrupt file never crashes the extension.

**Pain Points Addressed**: Provides a tested, fail-open foundation for the BUG-001 config-surface repair so that S2 can be a thin orchestration layer rather than re-implementing fs/merge logic.

## Why

- **Business value / user impact**: This is the foundation layer of the BUG-001 fix (the documented `enabled:false` master disable switch + all 17 config knobs currently do nothing). Correct, fail-open file reading + Pi-matching merge semantics are prerequisites for the config surface actually working. This subtask alone has no user-visible effect (S1+S2+P1.M1.T2 wiring together produce the visible fix).
- **Integration with existing features**: `src/settings.ts` is a NEW Pi-bound module, deliberately kept SEPARATE from `src/config.ts` (which is Pi-free by design — `config.ts:160` "imports NOTHING from Pi"). `config.ts`'s `validateConfig`/`setConfig`/`getConfig` stay untouched. These helpers feed raw `unknown` into `setConfig(raw)` — validation remains config.ts's job.
- **Problems this solves and for whom**: For the S2 implementer: removes the need to re-derive Pi's deep-merge semantics or hand-roll fail-open JSON reading. For the project: a tested merge primitive prevents the silent config-drift class of bugs (project settings silently ignored or wrongly overriding).

## What

Two leaf utility functions in a new module. No user-visible behavior in isolation.

- `readSettingsFile(filePath: string): Record<string, unknown>` — `readFileSync` + `JSON.parse`, fail-open to `{}` on missing/unreadable/invalid-JSON/non-object. **Never throws.**
- `deepMergeSettings(global: Record<string, unknown>, project: Record<string, unknown>): Record<string, unknown>` — recursive merge, project wins; nested plain objects recurse; arrays/primitives/null are replaced (not concatenated). Matches Pi's `deepMergeObjects`.

### Success Criteria

- [ ] `src/settings.ts` exists with `readSettingsFile` and `deepMergeSettings`.
- [ ] Both helpers are exported (marked `@internal`) so `test/settings.test.ts` can unit-test them directly (see Decision D1 — the contract's "PRIVATE (not exported)" is reconciled with its explicit "test them directly" requirement).
- [ ] `readSettingsFile` returns `{}` for: missing file, unreadable file, invalid JSON, JSON array, JSON primitive, JSON `null`. Returns the parsed object for a valid JSON object.
- [ ] `deepMergeSettings` recurses on nested plain objects; replaces on primitive/array/null overlap; preserves non-overlapping keys from both inputs.
- [ ] `npx vitest run test/settings.test.ts` passes; `npx vitest run` full suite passes; `npx tsc --noEmit` shows no NEW errors from the new files.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains copy-pasteable implementations of both helpers, the exact `isRecord` helper already used elsewhere in the codebase, the test idiom to mirror (real temp files via `mkdtempSync`/`rmSync` like `test/nudges.test.ts`; pure-data assertions like `test/config.test.ts`), and the precise merge semantics. No external documentation is required.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/config.ts
  why: "The SIBLING Pi-free module. Mirrors its style: module-header JSDoc referencing spec files, the private isRecord helper (config.ts:313), and the 'imports NOTHING from Pi' design constraint (config.ts:160). settings.ts is the Pi-bound counterpart that hands raw settings INTO config.ts via setConfig()."
  pattern: "function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); } — REUSE THIS EXACT BODY in settings.ts (it is the canonical 'plain object' check used across the codebase; not exported from config.ts, so each module has its own private copy)."
  gotcha: "config.ts MUST stay Pi-free. settings.ts is where Pi-coupled (fs/path/getAgentDir) code lives. S1's helpers use only node:fs — NO Pi imports yet (getAgentDir/join are added in S2 by loadMulliganConfig)."

- file: src/tools/audit.ts
  why: "Establishes the codebase convention for exporting internal helpers for testability: comments like 'EXPORTED so the pure renderer is unit-testable in isolation' and 'EXPORTED so the test can assert directly'. readSettingsFile/deepMergeSettings follow this exact pattern (export + @internal)."
  pattern: "audit.ts exports describeMessage/buildCallLookup/listCheckpoints/messageBytes/renderAuditReport purely so tests can assert them directly, even though only auditExecute consumes them at runtime. Same rationale applies here."
  gotcha: "Decision D1 (below): the contract says 'PRIVATE (not exported)' but ALSO says 'test them directly in S1'. Since loadMulliganConfig (S2) does not exist yet, the ONLY way to unit-test these in S1 is to export them @internal — matching audit.ts. Do NOT make them literally un-exported or the S1 test contract is unsatisfiable."

- file: test/config.test.ts
  why: "Test idiom to mirror: vitest, `describe`/`it`/`expect`/`expectTypeOf`, `.js` import paths (../src/config.js → here ../src/settings.js), explicit edge-case coverage (validateConfig tests undefined/null/{}/42/'nope')."
  pattern: "import { readSettingsFile, deepMergeSettings } from '../src/settings.js'; then one describe per helper with it() cases for each documented behavior."
  gotcha: "No vi.fn() needed (these helpers take plain data/paths). readSettingsFile tests use REAL temp files (see test/nudges.test.ts pattern) rather than mocking node:fs — exercises the genuine readFileSync path."

- file: test/nudges.test.ts
  why: "The pattern for real-temp-file tests: import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; beforeEach makes a dir, afterEach rmSync(recursive,force). Reuse this EXACT setup for readSettingsFile tests."
  pattern: "let dir; beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mulligan-settings-')); }); afterEach(() => { rmSync(dir, { recursive: true, force: true }); }); then writeFileSync(join(dir,'x.json'), content) per test."

- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/system_context.md
  why: "Authoritative synthesis. §1.5 specifies the settings.ts module contract (imports/exports/behavior); §1.5 'Deep-merge rules' pins the exact semantics: both plain objects → recurse; otherwise project replaces; arrays replace (not concat). Confirms S1's scope = the two leaf helpers ONLY."
  critical: "§1.3 confirms getAgentDir() IS exported at runtime, getSettingsPath() is NOT — but that's S2's concern. S1 helpers take a filePath/objects as inputs and need NO Pi import. Do not add getAgentDir/join in S1."

- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0377/architecture/pi_api_research.md
  why: "§C.1/C.4 ground the deep-merge reference: Pi's deepMergeObjects (settings-manager.js:8-34) = global+project deep-merge, project wins, recursive nested merge, arrays replaced. §E notes readFileSync is lock-safe (settings.json is append/overwrite-only; a torn read fails JSON.parse and fail-opens to {})."
  critical: "Pi's Settings interface is typed with NO `mulligan` field — reading the merged result requires casting via Record<string,unknown>. That cast lives in S2's loadMulliganConfig, NOT in these helpers (they return Record<string,unknown> generically)."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  config.ts     # ← SIBLING: Pi-free validate/setConfig/getConfig + DEFAULT_CONFIG (READ-ONLY here)
  index.ts      # ← setConfig(undefined) bug lives here; WIRED in P1.M1.T2 (NOT this subtask)
  nudges.ts, filter.ts, tools/*  # ← downstream consumers; UNCHANGED here
test/
  config.test.ts     # ← test idiom reference (pure-data assertions)
  nudges.test.ts     # ← test idiom reference (mkdtempSync/rmSync temp files)
  drift_nudge.test.ts:239  # ← PRE-EXISTING tsc error (BUG-002, separate task P1.M2.T1.S1) — DO NOT TOUCH
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/settings.ts        # NEW — Pi-bound settings-loading module. S1 adds readSettingsFile + deepMergeSettings (+ private isRecord). S2 will ADD loadMulliganConfig + getAgentDir/join imports.
test/settings.test.ts  # NEW — vitest unit tests for both helpers (fail-open parsing + merge semantics).
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1: "PRIVATE" ≠ "un-exported" in this codebase (Decision D1).
//   The contract says the helpers are "PRIVATE (not exported)" AND "test them directly in S1".
//   These contradict if read literally. This codebase EXPORTS internal helpers for testability
//   (audit.ts: describeMessage/buildCallLookup/listCheckpoints/messageBytes/renderAuditReport are
//   all "EXPORTED so the test can assert directly"). Resolution: EXPORT readSettingsFile +
//   deepMergeSettings with an `@internal` JSDoc tag. loadMulliganConfig (S2) is the only PUBLIC
//   entry point. Since S2 does not exist yet, exporting is the ONLY way to satisfy the S1 test
//   contract. Do NOT make them literally un-exported.

// CRITICAL GOTCHA #2: deepMergeSettings MUST use OWN-key iteration (Object.keys / {...spread}),
//   NOT for...in. Object.keys returns own enumerable keys only — this avoids inherited
//   Object.prototype members (constructor/toString/...) leaking in, the SAME class of bug as the
//   bloatThresholdFor prototype-leak (a parallel bugfix). `{ ...global }` and `Object.keys(project)`
//   are both own-property-only. This is correct and matches Pi's deepMergeObjects.

// CRITICAL GOTCHA #3: the "plain object" check is EXACTLY isRecord (typeof 'object' && !== null && !Array.isArray).
//   `null` has typeof 'object' but is NOT a plain object → EXCLUDED (null replaces, does not recurse).
//   Arrays are EXCLUDED → arrays REPLACE (not concat). This is the merge contract. Reuse config.ts:313's
//   isRecord body verbatim — do not write a second slightly-different object check.

// CRITICAL GOTCHA #4: readSettingsFile is FAIL-OPEN, never throws. A bare `readFileSync` on a missing
//   file THROWS ENOENT; `JSON.parse` on bad input THROWS SyntaxError. BOTH must be inside ONE try/catch
//   → return {}. Do NOT let any path reach a throw; the extension loads config at bootstrap and a throw
//   there would crash startup (violates spec/03 #4 fail-open). Pi's readFileSync is also lock-safe
//   (settings.json is overwrite-only; a torn read just fails parse → {} — confirmed pi_api_research §E).

// CRITICAL GOTCHA #5 (validation gate): `npx tsc --noEmit` currently reports EXACTLY ONE error at
//   test/drift_nudge.test.ts:239 (TS2352: missing rewindRefusedTurnIndex). That is BUG-002, owned by a
//   SEPARATE task (P1.M2.T1.S1). It is PRE-EXISTING — NOT caused by S1. The S1 success bar for tsc is:
//   "no NEW errors from src/settings.ts or test/settings.test.ts". Do NOT fix drift_nudge.test.ts here
//   (scope creep that crosses a task boundary). If you see your new file in the tsc output, fix YOUR file.

// CRITICAL GOTCHA #6 (scope): S1 adds the two helpers + tests ONLY. Do NOT add loadMulliganConfig
//   (S2), do NOT wire src/index.ts (P1.M1.T2), do NOT touch config.ts/filter.ts/nudges.ts/tools,
//   do NOT update README/spec (P1.M3). The new module header comment should NOTE that loadMulliganConfig
//   arrives in S2 so the next implementer knows the module is intentionally incomplete after S1.

// CRITICAL GOTCHA #7 (ESM imports): use `import { readFileSync } from "node:fs";` (the node: scheme).
//   Do NOT add `import ... from "@earendil-works/pi-coding-agent"` or `node:path` in S1 — those are S2's
//   (loadMulliganConfig needs getAgentDir + join). The package is ESM with .js import extensions per
//   the rest of src/ (e.g. config.ts imports, audit.ts:47 '../tokens.js'). The test imports settings via
//   '../src/settings.js'.
```

## Implementation Blueprint

### Data models and structure

**No exported types.** Both helpers operate on the generic `Record<string, unknown>` and the private `isRecord` type guard. The return types are structural (not branded domain types) because these are JSON-file primitives — validation into `MulliganConfig` is config.ts's job (downstream of S2's `loadMulliganConfig`).

```typescript
// The only "data model" is the private isRecord guard (mirrors config.ts:313 / audit.ts verbatim).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/settings.ts — module header + imports + private isRecord
  - CREATE the file src/settings.ts. Start with a module-header JSDoc block (mirror config.ts's style):
    describe it as the Pi-bound settings-loading module, note that S1 adds the two leaf helpers
    (readSettingsFile + deepMergeSettings) and that loadMulliganConfig (the public entry point) is
    added in S2. Note the design constraint: config.ts stays Pi-free; this module owns all Pi/fs coupling.
  - IMPORT (S1 scope): `import { readFileSync } from "node:fs";`
    (Do NOT add getAgentDir / node:path — those are S2.)
  - ADD the private isRecord helper (verbatim body from GOTCHA #3 / config.ts:313). Keep it module-private
    (NOT exported) — it is an implementation detail.
  - DEPENDENCIES: none (leaf file).

Task 2: CREATE src/settings.ts — readSettingsFile (the fail-open JSON reader)
  - ADD (exported, @internal):
      /**
       * readSettingsFile — synchronously read + JSON.parse a settings file, fail-open to {}.
       * @internal — only loadMulliganConfig (S2) calls this; exported for direct unit testing.
       * Never throws: missing file (ENOENT), unreadable, or invalid JSON all return {}. Also returns
       * {} if the parsed value is not a non-null, non-array object (e.g. a JSON array/number/string/null).
       * Lock-safe: settings.json is overwrite-only, so a torn read fails parse → {} (fail-open).
       */
      export function readSettingsFile(filePath: string): Record<string, unknown> {
        try {
          const raw = readFileSync(filePath, "utf8");
          const parsed: unknown = JSON.parse(raw);
          return isRecord(parsed) ? parsed : {};
        } catch {
          return {}; // missing / unreadable / invalid JSON / non-object → fail-open
        }
      }
  - NAMING: readSettingsFile (camelCase, matches the contract). Parameter name `filePath`.
  - GOTCHA: ONE try/catch wraps BOTH readFileSync AND JSON.parse (a missing file throws on readFileSync;
    bad JSON throws on JSON.parse — both must be caught). Pass "utf8" encoding so readFileSync returns a
    string (not a Buffer).
  - DEPENDENCIES: Task 1 (isRecord).

Task 3: CREATE src/settings.ts — deepMergeSettings (the recursive Pi-matching merge)
  - ADD (exported, @internal):
      /**
       * deepMergeSettings — recursive deep-merge of two settings objects; project-local wins.
       * @internal — only loadMulliganConfig (S2) calls this; exported for direct unit testing.
       * Semantics mirror Pi's deepMergeObjects (settings-manager.js:8-34):
       *   - For each key: if BOTH the global and project values are plain objects (isRecord — object,
       *     not null, not array), RECURSE.
       *   - Otherwise the project value REPLACES the global value (primitives, arrays, null all replace;
       *     arrays are NOT concatenated).
       *   - Keys present only in global are preserved; keys present only in project are added.
       * Uses own-key iteration ({...global} spread + Object.keys(project)) so inherited Object.prototype
       * members cannot leak in (same own-property discipline as the bloatThresholdFor fix).
       */
      export function deepMergeSettings(
        global: Record<string, unknown>,
        project: Record<string, unknown>,
      ): Record<string, unknown> {
        const out: Record<string, unknown> = { ...global }; // own enumerable keys of global
        for (const key of Object.keys(project)) {
          const g = global[key];
          const p = project[key];
          out[key] = isRecord(g) && isRecord(p) ? deepMergeSettings(g, p) : p;
        }
        return out;
      }
  - NAMING: deepMergeSettings (camelCase). Parameters `global` and `project` (match the contract + Pi's
    global/project terminology; `global` here is a parameter name, NOT the JS global object — fine in scope).
  - GOTCHA: isRecord(g) && isRecord(p) is the recursion guard — null and arrays fail isRecord → fall to the
    `: p` replace branch (correct: arrays replace, null replaces, primitives replace). The recursive call
    passes two isRecord-narrowed values, which are Record<string,unknown> per the type guard.
  - DEPENDENCIES: Task 1 (isRecord).

Task 4: CREATE test/settings.test.ts — readSettingsFile tests (real temp files)
  - CREATE test/settings.test.ts. Imports:
      import { describe, it, expect, beforeEach, afterEach } from "vitest";
      import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      import { readSettingsFile, deepMergeSettings } from "../src/settings.js";
  - SETUP (mirror test/nudges.test.ts):
      let dir: string;
      beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mulligan-settings-")); });
      afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  - ADD a describe("readSettingsFile — fail-open JSON parsing") block with these it() cases:
      (a) "missing file → {}": readSettingsFile(join(dir, "nope.json")) deep-equals {}.
      (b) "invalid JSON → {}": writeFileSync(join(dir,"bad.json"), "{not json"); → {}.
      (c) "valid JSON object → parsed": writeFileSync a '{"mulligan":{"enabled":false}}' → deep-equals that object.
      (d) "JSON array → {}": writeFileSync '[1,2,3]' → {}.
      (e) "JSON primitive (number) → {}": writeFileSync '42' → {}.
      (f) "JSON null → {}": writeFileSync 'null' → {}.
      (g) (optional) "nested object preserved": a deep object like '{"a":{"b":1}}' round-trips unchanged.
  - NAMING: test titles phrase the input → expected output. Use expect(actual).toEqual(expected).
  - DEPENDENCIES: Tasks 1-3.

Task 5: CREATE test/settings.test.ts — deepMergeSettings tests (pure data)
  - ADD a describe("deepMergeSettings — project wins, Pi deepMergeObjects semantics") block with it() cases:
      (a) "empty + empty → {}": deepMergeSettings({}, {}) toEqual {}.
      (b) "non-overlapping keys preserved from both": deepMergeSettings({a:1},{b:2}) toEqual {a:1,b:2}.
      (c) "project primitive replaces global primitive": deepMergeSettings({a:1},{a:2}) toEqual {a:2}.
      (d) "nested objects RECURSE (not replace)": deepMergeSettings({n:{x:1,y:2}},{n:{y:3,z:4}}) toEqual {n:{x:1,y:3,z:4}}.
          (global's x preserved; project's y replaces; project's z added — this is THE key recursion test.)
      (e) "arrays REPLACE (not concatenated)": deepMergeSettings({r:[1,2]},{r:[3]}) toEqual {r:[3]}.
      (f) "project null replaces global object": deepMergeSettings({a:{x:1}},{a:null}) toEqual {a:null}.
          (null is not isRecord → replace branch → null wins. Guards against typeof-null gotcha.)
      (g) "global-only nested key preserved when project adds a sibling": deepMergeSettings({n:{a:1}},{n:{b:2}})
          toEqual {n:{a:1,b:2}}.
      (h) (optional) "deeply nested 3-level recurse": {l1:{l2:{a:1}}},{l1:{l2:{b:2}}} → {l1:{l2:{a:1,b:2}}}.
  - NAMING: each title names the specific merge rule under test. Use toEqual for deep comparison.
  - DEPENDENCIES: Tasks 1-3.

Task 6: VALIDATE (no new code)
  - RUN `npx vitest run test/settings.test.ts` → all pass.
  - RUN `npx vitest run` → full suite passes (new tests added, no regressions).
  - RUN `npx tsc --noEmit` → the ONLY error is the pre-existing test/drift_nudge.test.ts:239 (BUG-002,
    separate task). Confirm NO error line references src/settings.ts or test/settings.test.ts. (See GOTCHA #5.)
  - DEPENDENCIES: Tasks 1-5.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): fail-open reader — ONE try/catch around BOTH the read and the parse.
export function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, "utf8");   // throws ENOENT if missing, EACCES if unreadable
    const parsed: unknown = JSON.parse(raw);       // throws SyntaxError if malformed
    return isRecord(parsed) ? parsed : {};         // array/number/string/null/bool → {}
  } catch {
    return {}; // fail-open: the extension must still boot with zero/corrupt settings
  }
}

// PATTERN (Task 3): own-key recursive merge — the ternary IS the entire merge rule.
export function deepMergeSettings(
  global: Record<string, unknown>,
  project: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...global };          // preserve global-only keys
  for (const key of Object.keys(project)) {                    // own keys only (no prototype leak)
    const g = global[key];
    const p = project[key];
    out[key] = isRecord(g) && isRecord(p) ? deepMergeSettings(g, p) : p;  // recurse | replace
  }
  return out;
}
// GOTCHA walk-through: deepMergeSettings({n:{x:1,y:2}}, {n:{y:3,z:4}})
//   key "n": isRecord({x:1,y:2}) && isRecord({y:3,z:4}) → recurse deepMergeSettings({x:1,y:2},{y:3,z:4})
//     → out={x:1}; key"y": 1 replaced by 3 → {x:1,y:3}; key"z": added → {x:1,y:3,z:4}
//   → final {n:{x:1,y:3,z:4}} ✓
// GOTCHA walk-through: deepMergeSettings({r:[1,2]}, {r:[3]})
//   key "r": isRecord([1,2]) → FALSE (arrays excluded) → replace branch → out.r = [3] → {r:[3]} ✓
// GOTCHA walk-through: deepMergeSettings({a:{x:1}}, {a:null})
//   key "a": isRecord(null) → FALSE (null excluded despite typeof 'object') → replace → {a:null} ✓
```

### Integration Points

```yaml
CODE:
  - create: src/settings.ts (NEW) — readFileSync import + private isRecord + readSettingsFile + deepMergeSettings
  - future (S2, NOT this subtask): add `import { getAgentDir } from "@earendil-works/pi-coding-agent"; import { join } from "node:path";` + `export function loadMulliganConfig(cwd?: string): unknown`
  - untouched: src/config.ts (stays Pi-free; receives raw via setConfig in S2/index.ts wiring), src/index.ts (P1.M1.T2), all handlers/tools

TESTS:
  - create: test/settings.test.ts (NEW) — both helpers unit-tested directly
  - untouched: all existing test files (drift_nudge.test.ts:239 is a SEPARATE task — GOTCHA #5)

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. These are pure primitives; no config keys, no persistence, no tool registration.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After creating src/settings.ts:
npx tsc --noEmit
# EXPECTED: exactly ONE error — `test/drift_nudge.test.ts(239,10): error TS2352 ... rewindRefusedTurnIndex`.
# That is BUG-002 (pre-existing, separate task P1.M2.T1.S1) — NOT yours.
# YOUR bar: NO line in the output references src/settings.ts or test/settings.test.ts.
# If you see a settings.ts/settings.test.ts error, READ it and fix YOUR file (common cause: a typo in the
# isRecord guard, or exporting with a wrong signature). Do NOT "fix" the drift_nudge error here.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new test file in isolation — fast feedback on parsing + merge logic.
npx vitest run test/settings.test.ts
# EXPECTED: all pass. If a merge case fails, re-check the isRecord guard (null/array exclusion) and the
# ternary (recurse vs replace). The nested-recurse case (d) and the array-replace case (e) are the
# most common failure points if the merge rule is mis-implemented.

# Full suite — confirm no regressions elsewhere.
npx vitest run
# EXPECTED: all pass (baseline + new settings tests). vitest transpiles without type-checking, so the
# pre-existing drift_nudge fixture does not block the run.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: readSettingsFile + deepMergeSettings are leaf utilities with no runtime
# integration to exercise until loadMulliganConfig (S2) and the index.ts wiring (P1.M1.T2) land.
# The end-to-end "does enabled:false actually disable Mulligan" validation belongs to P1.M1.T2, not S1.
# (Documented here so the implementer does not attempt a premature integration test that has no seam yet.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual REPL sanity check of the merge against Pi's own deepMergeObjects (optional — proves semantic parity):
#   node --input-type=module -e "
#     import { deepMergeSettings } from './src/settings.js';
#     console.log(JSON.stringify(deepMergeSettings({n:{x:1,y:2}},{n:{y:3,z:4}})));
#     // → {\"n\":{\"x\":1,\"y\":3,\"z\":4}} — matches Pi's recursive nested merge.
#   "
# The unit tests in Level 2 already assert these cases programmatically, so this is optional confirmation.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run test/settings.test.ts` — all pass.
- [ ] `npx vitest run` — full suite passes (no regressions).
- [ ] `npx tsc --noEmit` — NO new errors from `src/settings.ts` / `test/settings.test.ts` (the single pre-existing `drift_nudge.test.ts:239` error is BUG-002, out of scope).

### Feature Validation

- [ ] `readSettingsFile` returns `{}` for missing file, unreadable file, invalid JSON, JSON array, JSON primitive, JSON `null`.
- [ ] `readSettingsFile` returns the parsed object for a valid JSON object.
- [ ] `deepMergeSettings` recurses on nested plain objects (case d); replaces on primitive overlap (case c); replaces arrays (case e); null replaces (case f); preserves both-only keys (cases b, g).
- [ ] Both helpers never throw (fail-open reader; pure merge).
- [ ] Both helpers are exported with `@internal` (Decision D1 — testable directly in S1).

### Code Quality Validation

- [ ] `src/settings.ts` mirrors the codebase's module-header JSDoc style (references the design split from config.ts; notes S2 adds loadMulliganConfig).
- [ ] `isRecord` body is verbatim from config.ts:313 / audit.ts (no second divergent object check).
- [ ] deepMergeSettings uses own-key iteration (`{...global}` + `Object.keys`) — no prototype leak (GOTCHA #2).
- [ ] Only `src/settings.ts` and `test/settings.test.ts` are created — NO changes to config.ts, index.ts, handlers, tools, drift_nudge.test.ts, README, or spec (those are sibling tasks S2 / P1.M1.T2 / P1.M2 / P1.M3).

### Documentation & Deployment

- [ ] JSDoc on each helper explains the fail-open contract (reader) and the exact merge semantics (recurse / replace / arrays-replace) with a reference to Pi's `deepMergeObjects` (Mode A — rides with the code).
- [ ] No user-facing doc change — these are internal utilities (README/spec accuracy is verified in P1.M3.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't make `readSettingsFile`/`deepMergeSettings` literally un-exported — the contract says "test them directly in S1", and S2's `loadMulliganConfig` doesn't exist yet, so un-exported = untestable = contract violation. Export them `@internal` (audit.ts convention). See Decision D1 / GOTCHA #1.
- ❌ Don't use `for...in` or bare `obj[key]` accumulation in the merge — use `Object.keys()` + `{...spread}` so inherited `Object.prototype` members (`constructor`, `toString`, …) cannot leak in. This is the same own-property discipline as the parallel bloatThresholdFor prototype-leak fix.
- ❌ Don't write a second, slightly-different "is plain object" check — reuse the exact `isRecord` body (typeof object && !null && !array) so `null` and arrays are correctly excluded (null → replace; arrays → replace). A divergent check (e.g. `typeof x === 'object' && x`) would wrongly recurse on arrays.
- ❌ Don't split read and parse into separate try/catches or let either throw — one `try { readFileSync; JSON.parse; } catch { return {}; }`. A throw at config-load time crashes extension startup.
- ❌ Don't "fix" the `test/drift_nudge.test.ts:239` tsc error — that's BUG-002, a separate task (P1.M2.T1.S1). Your tsc bar is "no NEW errors from my files", not "tsc is fully clean" (full cleanliness is gated by P1.M2).
- ❌ Don't add `loadMulliganConfig`, `getAgentDir`, `node:path`, or any index.ts wiring in S1 — that's S2 (P1.M1.T1.S2) and P1.M1.T2. Keep S1 to the two leaf helpers + tests.
- ❌ Don't concatenate arrays in the merge — the contract and Pi both REPLACE arrays. `deepMergeSettings({r:[1,2]},{r:[3]})` must be `{r:[3]}`, never `{r:[1,2,3]}`.
- ❌ Don't mock `node:fs` when real temp files (`mkdtempSync`/`writeFileSync`/`rmSync`) exercise the genuine code path more faithfully and match the `test/nudges.test.ts` idiom — reserve `vi.mock` only if a temp-file approach proves impractical (it won't).

---

## Decision Log

- **D1 — Export the helpers `@internal` (not literally un-exported).** The contract phrase "PRIVATE (not exported)" describes the conceptual API surface (only `loadMulliganConfig` is meant for external callers), but the same contract mandates direct unit tests in S1. Since `loadMulliganConfig` (S2) does not yet exist, the only way to satisfy the S1 test requirement is to export the helpers for testability — exactly as `src/tools/audit.ts` exports `describeMessage`/`buildCallLookup`/`listCheckpoints`/`messageBytes`/`renderAuditReport` ("EXPORTED so the test can assert directly"). `@internal` JSDoc tags document that external code should call `loadMulliganConfig`, not these helpers. This reconciles the contract's two clauses without weakening either.