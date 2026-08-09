# PRP — P1.M1.T1.S2: `loadMulliganConfig(cwd?)` entry point in `src/settings.ts` (BUG-001, step 2/2)

---

## Goal

**Feature Goal**: Add the **public** entry point `loadMulliganConfig(cwd?: string): unknown` to the `src/settings.ts` module created in S1. It orchestrates S1's two leaf helpers into the full settings-loading pipeline: read global `settings.json` (via `getAgentDir()`) + project-local `<cwd>/.pi/settings.json` → deep-merge (project wins) → extract the raw `.mulligan` object → return it (or `undefined`). The **entire** body is fail-open: any error → `undefined` → downstream `validateConfig(undefined)` → `DEFAULT_CONFIG`. This is the read-only, Pi-coupled counterpart that hands raw `unknown` INTO the Pi-free `config.ts` via `setConfig()`.

**Deliverable**:
1. `src/settings.ts` (MODIFY the S1 file) — add two imports (`getAgentDir` from `@earendil-works/pi-coding-agent`, `join` from `node:path`) + the `export function loadMulliganConfig(cwd?: string): unknown`. Update the module-header JSDoc to reflect that the public entry point now exists (S1's header said "loadMulliganConfig arrives in S2").
2. `test/settings.test.ts` (MODIFY the S1 file) — add `vi.mock` + `vi.hoisted` at module top to control `getAgentDir`, add `loadMulliganConfig` to the import, and add a new `describe("loadMulliganConfig")` block with the 7 contract test cases.

**Success Definition**:
- `npx vitest run test/settings.test.ts` — all pass: S1's readSettingsFile/deepMergeSettings tests STILL pass, AND the 7 new loadMulliganConfig cases pass (no mulligan key → undefined; global-only → global mulligan; project-only → project mulligan; both → merged project-wins; missing files → undefined; invalid JSON → undefined; getAgentDir throws → undefined).
- `npx vitest run` — full suite passes (no regressions).
- `npx tsc --noEmit` — NO new errors originate from `src/settings.ts` or `test/settings.test.ts`. (The single pre-existing error at `test/drift_nudge.test.ts:239` is BUG-002, owned by a SEPARATE task P1.M2.T1.S1 — see GOTCHA #6. Do NOT fix it here.)

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and the **P1.M1.T2 implementer** who wires `loadMulliganConfig` into `src/index.ts` (factory + `session_start`). Not end-user-facing yet — the user-visible fix (the `enabled:false` master switch finally working) lands in P1.M1.T2 when index.ts calls `setConfig(loadMulliganConfig(...))`.

**Use Case**: `index.ts` factory calls `setConfig(loadMulliganConfig(process.cwd()))`; the `session_start` handler calls `setConfig(loadMulliganConfig(ctx.cwd))` on every session start / `/reload`. `loadMulliganConfig` is the single place that knows where settings live and how to merge them; `config.ts`'s `validateConfig` does the rest.

**User Journey**: caller passes a cwd (or omits it) → `loadMulliganConfig` reads both files → merges → extracts `.mulligan` → returns raw object → caller hands it to `setConfig(raw)` → `validateConfig` coerces into a valid `MulliganConfig` → `getConfig()` serves it to all handlers/tools.

**Pain Points Addressed**: Removes the hardcoded `setConfig(undefined)` gap by providing a tested, fail-open settings reader that the lifecycle seams can call. A missing/corrupt settings file or a throwing `getAgentDir` never crashes extension startup (fail-open → `undefined` → defaults).

## Why

- **Business value / user impact**: This is the orchestration layer of the BUG-001 fix (the documented `enabled:false` switch + all 17 config knobs currently do nothing). `loadMulliganConfig` is the exact function the PRD/spec/README promise exists ("Mulligan reads `mulligan` from Pi settings.json"). Alone it has no user-visible effect — combined with the S1 helpers and the P1.M1.T2 wiring, it makes the entire config surface functional.
- **Integration with existing features**: Builds directly on S1's `readSettingsFile` + `deepMergeSettings`. Hands raw `unknown` to `config.ts`'s `setConfig` (which stays Pi-free by design — `config.ts:160` "imports NOTHING from Pi … settings are handed in via setConfig()"). `getAgentDir` (from the Pi package) is the ONLY new external dependency, and it respects the `PI_CODING_AGENT_DIR` env override (verified: `config.js:412-418`). No changes to `config.ts`, `index.ts` (P1.M1.T2), handlers, or tools.
- **Problems this solves and for whom**: For the P1.M1.T2 implementer: a one-liner `setConfig(loadMulliganConfig(cwd))` instead of reimplementing file-path resolution + merge + extraction. For users: the foundation that makes the disable switch and every knob actually work.

## What

One exported function added to an existing module. No user-visible behavior in isolation (no `index.ts` wiring in this subtask).

- `loadMulliganConfig(cwd?: string): unknown` — reads global `~/.pi/agent/settings.json` and project-local `<cwd>/.pi/settings.json`, deep-merges (project-local wins, recursive for nested objects), and returns the merged `mulligan` object (or `undefined` if absent). **Never throws** — the whole body is wrapped in `try/catch → return undefined`. `cwd` defaults to `process.cwd()` when `undefined`.

### Success Criteria

- [ ] `src/settings.ts` exports `loadMulliganConfig(cwd?: string): unknown`.
- [ ] It imports `getAgentDir` from `@earendil-works/pi-coding-agent` and `join` from `node:path` (S1's `readFileSync` import already present).
- [ ] It calls `readSettingsFile(join(getAgentDir(), "settings.json"))` for global and `readSettingsFile(join(cwd ?? process.cwd(), ".pi", "settings.json"))` for project-local, then `deepMergeSettings(global, project)`, then returns `.mulligan`.
- [ ] The entire body is wrapped in `try { … } catch { return undefined; }` — never throws.
- [ ] `test/settings.test.ts` has a `describe("loadMulliganConfig")` block covering all 7 contract cases.
- [ ] `npx vitest run test/settings.test.ts` passes; `npx vitest run` full suite passes; `npx tsc --noEmit` shows no NEW errors from the new/modified files.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains a copy-pasteable implementation of `loadMulliganConfig`, the exact `vi.mock` + `vi.hoisted` pattern to make `getAgentDir` both controllable and throwable, the precise test matrix, and verified facts about the Pi package exports. The S1 PRP (sibling) defines the two helpers this builds on; this PRP treats them as a stable contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/settings.ts  # (created by S1 — assumed to exist exactly as its PRP specifies)
  why: "The module S2 modifies. S1 added readSettingsFile + deepMergeSettings (exported @internal) + a private isRecord, importing only node:fs. S2 ADDS the getAgentDir/join imports and the loadMulliganConfig export. S1's module header says 'loadMulliganConfig arrives in S2' — update that comment."
  pattern: "S1 helpers are already exported @internal; loadMulliganConfig is the ONLY PUBLIC export (no @internal tag). Reuse readSettingsFile + deepMergeSettings directly — do NOT reimplement reading or merging."
  gotcha: "Do NOT modify readSettingsFile / deepMergeSettings / isRecord. Do NOT remove S1's exports. Append loadMulliganConfig; keep the file's existing structure intact."

- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/system_context.md
  why: "Authoritative synthesis. §1.5 is the settings.ts contract (imports/exports/behavior/paths); §1.3 confirms getAgentDir IS available at runtime and getSettingsPath is NOT (hence path.join(getAgentDir(),'settings.json')); §1.4 is the lifecycle-asymmetry table (factory has no ctx → process.cwd(); session_start has ctx.cwd); §1.7 notes setLogFile lights up for free (consumer's job, not S2)."
  critical: "§1.5 BEHAVIOR steps 1-5 are the literal spec for loadMulliganConfig's body. Fail-open: 'every step wrapped in try/catch; any error → undefined'. Deep-merge rules (recurse/replace/arrays-replace) are ALREADY implemented by S1's deepMergeSettings — just call it."

- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/pi_api_research.md
  why: "Grounds the getAgentDir choice. §C.2: getAgentDir() returns ~/.pi/agent/ and respects PI_CODING_AGENT_DIR. §C.1: global path = join(agentDir,'settings.json'), project path = join(cwd,'.pi','settings.json') — EXACTLY what loadMulliganConfig must build. §E: readFileSync is lock-safe (settings.json is overwrite-only; torn read fails parse → {} via readSettingsFile → fail-open)."
  critical: "getAgentDir reads process.env.PI_CODING_AGENT_DIR LIVE each call (verified config.js:413). This means an env-var approach could work for non-throw tests, BUT test case (g) 'getAgentDir throws → undefined' REQUIRES a throwable mock → use vi.mock (see GOTCHA #4)."

- file: src/config.ts
  why: "The Pi-free consumer of loadMulliganConfig's output. setConfig(raw: unknown) (config.ts:195) → validateConfig(raw) → cachedConfig. validateConfig(undefined) → DEFAULT_CONFIG (the fail-open path loadMulliganConfig's undefined return feeds). Confirms loadMulliganConfig must return `unknown` (raw, UNVALIDATED) — validation is config.ts's job, NOT ours."
  pattern: "setConfig already wraps validateConfig in try/catch → defaults (config.ts:198-201). So even if loadMulliganConfig returned garbage, setConfig is safe. loadMulliganConfig's own fail-open (→ undefined) is belt-and-suspenders for DIRECT callers/tests and for the bootstrap path."
  gotcha: "Do NOT import or call setConfig/validateConfig/getConfig from settings.ts — that would couple the Pi-bound module to config.ts's cache and break the Pi-free invariant of config.ts's testability. settings.ts ONLY reads+merges+extracts; index.ts (P1.M1.T2) does the setConfig handoff."

- file: src/index.ts
  why: "The consumer that P1.M1.T2 will modify (NOT this subtask). Shows the current bug (setConfig(undefined) at index.ts:30) and the two seams: factory body + the existing session_start handler (index.ts ~line 55). Confirms loadMulliganConfig's cwd parameter semantics: factory passes process.cwd() (no ctx); session_start passes ctx.cwd."
  pattern: "Consumer calls will be: setConfig(loadMulliganConfig(process.cwd())) in the factory; setConfig(loadMulliganConfig(ctx.cwd)) in session_start; then setLogFile(getConfig().log.file). ALL of that is P1.M1.T2 — S2 only provides the function."
  gotcha: "Do NOT modify index.ts in S2. S2's deliverable is the function + its tests only."

- file: test/settings.test.ts  # (created by S1 — assumed to exist)
  why: "The test file S2 modifies. S1 created it with a module-level `let dir; beforeEach/afterEach` (mkdtempSync('mulligan-settings-')/rmSync) and two describe blocks (readSettingsFile, deepMergeSettings). S2 ADDS: vi.mock+vi.hoisted at module top, loadMulliganConfig to the import, and a new describe('loadMulliganConfig') block with its OWN scoped beforeEach/afterEach (separate agentDir/projectDir temps)."
  pattern: "vi.mock is file-scoped — mocking @earendil-works/pi-coding-agent affects ONLY this test file. S1's readSettingsFile/deepMergeSettings tests never call getAgentDir, so the mock does not perturb them. Coexistence is safe."
  gotcha: "vi.mock MUST be at module top level (it is hoisted). It CANNOT reference module-scope `let` vars directly (hoisting ordering) — use vi.hoisted to share mutable state with the factory (see Implementation Patterns)."

- file: test/nudges.test.ts
  why: "Real-temp-file test idiom (mkdtempSync/rmSync/writeFileSync) + the codebase's preference for hand-rolled fakes over vi.fn for Pi objects. loadMulliganConfig tests follow the real-temp-file part; the getAgentDir mock is the ONE exception (must be vi.mock because case g needs a throw — see GOTCHA #4)."
  pattern: "let dir; beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mulligan-…-')); }); afterEach(() => { rmSync(dir, { recursive: true, force: true }); });"

- file: test/config.test.ts
  why: "Pure-data assertion idiom (expect(x).toEqual(y)) and the vitest import style. loadMulliganConfig's project-wins merge test (case d) mirrors the deep-merge assertions here."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  settings.ts   # ← S1 created this: readSettingsFile + deepMergeSettings + private isRecord (import node:fs only). S2 ADDS loadMulliganConfig.
  config.ts     # ← Pi-free: validateConfig/setConfig/getConfig + DEFAULT_CONFIG (consumer of loadMulliganConfig output; UNCHANGED here)
  index.ts      # ← setConfig(undefined) bug; wired in P1.M1.T2 (NOT this subtask)
  filter.ts, nudges.ts, tools/*  # ← downstream consumers; already gate on getConfig().enabled; UNCHANGED
test/
  settings.test.ts        # ← S1 created this: readSettingsFile + deepMergeSettings tests. S2 ADDS the loadMulliganConfig describe + vi.mock.
  config.test.ts, nudges.test.ts  # ← test idiom references (READ-ONLY here)
  drift_nudge.test.ts:239        # ← PRE-EXISTING tsc error (BUG-002, separate task P1.M2.T1.S1) — DO NOT TOUCH
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/settings.ts        # MODIFY (S1 file) — + import getAgentDir + import join + export loadMulliganConfig + update module header
test/settings.test.ts  # MODIFY (S1 file) — + vi.mock+vi.hoisted at top + loadMulliganConfig import + describe("loadMulliganConfig") block
# (NO new files in S2. NO changes to config.ts, index.ts, handlers, tools, README, spec.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (fail-open MUST wrap the WHOLE body, including getAgentDir()).
//   getAgentDir() does not normally throw (config.js:412-418 just reads env/homedir), but the contract
//   requires guarding it, and process.cwd() can throw in rare environments. The outer try/catch is the
//   fail-open wrapper: getAgentDir throw | process.cwd throw | join throw | readSettingsFile throw
//   (shouldn't, S1 made it fail-open) | deepMergeSettings throw (shouldn't, pure) → ALL → return undefined.
//   ONE try/catch around the whole body returning the extracted .mulligan; catch returns undefined.

// CRITICAL GOTCHA #2 (extract .mulligan with optional chaining; may be undefined = zero-config).
//   deepMergeSettings returns Record<string,unknown>, so merged.mulligan is `unknown` and is simply
//   `undefined` when the key is absent (the zero-config case → downstream validateConfig(undefined)
//   → DEFAULT_CONFIG). The contract's `(merged as Record<string,unknown>)?.mulligan` cast is harmless
//   (merged is already that type); `?.` is defensive. Returning undefined is CORRECT, not an error.

// CRITICAL GOTCHA #3 (cwd default semantics — but the CALLER picks cwd, not loadMulliganConfig).
//   `cwd ?? process.cwd()` → string. At factory time the caller (P1.M1.T2) passes process.cwd()
//   (or undefined); at session_start the caller passes ctx.cwd. loadMulliganConfig itself never
//   branches on the source — it just resolves `cwd ?? process.cwd()`. Do not add isProjectTrusted()
//   gating here (Decision D5: settings.json is config not code; validateConfig is fail-safe; simpler).
//   Project-trust gating, if ever wanted, is the consumer's concern.

// CRITICAL GOTCHA #4 (test case (g) REQUIRES vi.mock, not an env var).
//   getAgentDir() reads process.env.PI_CODING_AGENT_DIR live, so cases (a)-(f) COULD set that env var
//   to a temp dir. BUT case (g) "getAgentDir throws → undefined" needs a function that THROWS — an env
//   var can't do that. The contract explicitly says "mock getAgentDir to return a temp directory", so
//   use vi.mock("@earendil-works/pi-coding-agent", factory) with vi.hoisted for mutable state. vi.mock
//   is hoisted above `let` declarations, so the factory can ONLY close over vi.hoisted() results.
//   Minimal factory `{ getAgentDir }` is sufficient — settings.ts imports ONLY getAgentDir from the pkg.

// CRITICAL GOTCHA #5 (vi.mock is FILE-SCOPED — does not leak to other test files).
//   Mocking @earendil-works/pi-coding-agent in test/settings.test.ts affects ONLY that file's module
//   graph. Other files (test/index.test.ts imports index.ts which imports the real package) are
//   unaffected. And S1's readSettingsFile/deepMergeSettings tests in the SAME file never touch
//   getAgentDir, so the mock does not perturb them. No cross-test contamination.

// CRITICAL GOTCHA #6 (validation gate — the pre-existing tsc error is NOT yours).
//   `npx tsc --noEmit` currently reports EXACTLY ONE error at test/drift_nudge.test.ts:239
//   (TS2352: missing rewindRefusedTurnIndex). That is BUG-002, owned by P1.M2.T1.S1. It is
//   PRE-EXISTING. S2's tsc bar = "no NEW errors from src/settings.ts or test/settings.test.ts".
//   Do NOT fix drift_nudge.test.ts here. Watch for: vi.hoisted typed state must null-check before
//   calling the impl fn (strict mode); keep `getAgentDirImpl: null as null | (() => string)` and guard.

// CRITICAL GOTCHA #7 (scope — S2 is the function + its tests ONLY).
//   Do NOT wire src/index.ts (P1.M1.T2), do NOT call setConfig anywhere in settings.ts, do NOT touch
//   config.ts/filter.ts/nudges.ts/tools, do NOT update README/spec (P1.M3), do NOT fix drift_nudge
//   (P1.M2). loadMulliganConfig returns raw `unknown`; it does NOT validate (config.ts's job).

// CRITICAL GOTCHA #8 (ESM import paths).
//   Use the `node:` scheme: `import { join } from "node:path";`. The package import is bare:
//   `import { getAgentDir } from "@earendil-works/pi-coding-agent";`. The test imports settings via
//   '../src/settings.js' (ESM .js extension convention, matching S1 + the rest of test/).
```

## Implementation Blueprint

### Data models and structure

**No new exported types.** `loadMulliganConfig` returns `unknown` (the raw `mulligan` object or `undefined`). Validation into `MulliganConfig` is `config.ts`'s job (downstream, via the P1.M1.T2 `setConfig` handoff). `cwd?: string` is the only parameter. The `.mulligan` extraction is structural on `Record<string, unknown>`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/settings.ts — add the two imports
  - ADD after S1's `import { readFileSync } from "node:fs";`:
      import { getAgentDir } from "@earendil-works/pi-coding-agent";
      import { join } from "node:path";
  - ORDER: keep node: imports first (fs, path), then the package import — matches a sensible grouping.
    (config.ts imports node modules + typebox; there is no rigid convention — just keep it tidy.)
  - GOTCHA: these two imports are the ONLY Pi/path coupling. config.ts must stay Pi-free — it is NOT
    touched here. settings.ts is intentionally the Pi-bound module (system_context §1.5).
  - DEPENDENCIES: S1's src/settings.ts must exist (it does, per the sibling PRP).

Task 2: MODIFY src/settings.ts — add loadMulliganConfig (the public entry point)
  - APPEND below S1's deepMergeSettings (after the helper block, as the module's final + public export):
      /**
       * loadMulliganConfig — read + merge Pi settings and extract the raw `mulligan` block.
       *
       * Reads the GLOBAL settings file at `path.join(getAgentDir(), "settings.json")` (respects the
       * PI_CODING_AGENT_DIR env override) and the PROJECT-LOCAL file at
       * `path.join(cwd ?? process.cwd(), ".pi", "settings.json")`, deep-merges them (project-local
       * wins; nested objects recurse; arrays replace — via deepMergeSettings, mirroring Pi's
       * deepMergeObjects), and returns the merged `mulligan` object.
       *
       * @param cwd optional project working directory. Falls back to `process.cwd()` when undefined.
       *   At factory time (no ctx) pass `process.cwd()` or undefined; at `session_start` pass `ctx.cwd`.
       * @returns the raw, UNVALIDATED `mulligan` object (`unknown`), or `undefined` when the `mulligan`
       *   key is absent (zero-config case → DEFAULT_CONFIG) or when any step fails.
       *
       * FAIL-OPEN: the entire body is wrapped in try/catch — a throwing getAgentDir(), an unreadable
       * file, a process.cwd() failure, etc. all return `undefined`. Callers feed the result to
       * `setConfig(raw)`; `validateConfig(undefined)` then yields `DEFAULT_CONFIG`, so the extension
       * always boots. NEVER throws. (This is the module's ONLY public export; readSettingsFile and
       * deepMergeSettings are @internal helpers.)
       */
      export function loadMulliganConfig(cwd?: string): unknown {
        try {
          const globalSettings = readSettingsFile(join(getAgentDir(), "settings.json"));
          const projectSettings = readSettingsFile(join(cwd ?? process.cwd(), ".pi", "settings.json"));
          const merged = deepMergeSettings(globalSettings, projectSettings);
          return merged.mulligan;
        } catch {
          return undefined; // fail-open: any error → undefined → validateConfig(undefined) → DEFAULT_CONFIG
        }
      }
  - NAMING: loadMulliganConfig (camelCase, matches the contract). Parameter `cwd`.
  - GOTCHA: `merged` is `Record<string, unknown>` (deepMergeSettings return type), so `merged.mulligan`
    is already `unknown` — no cast needed. If you prefer the contract's literal form
    `return (merged as Record<string, unknown>)?.mulligan;` it is also fine (the cast is a no-op;
    the `?.` is harmless defensive). The recursive merge of nested `mulligan` sub-objects (e.g.
    `mulligan.nudges`) is handled BY deepMergeSettings — loadMulliganConfig does NOT re-merge.
  - GOTCHA: readSettingsFile + deepMergeSettings NEVER throw (S1 made them fail-open / pure), so the
    only realistic throw sources are getAgentDir(), process.cwd(), join() — all caught by the one
    try/catch. Do NOT add inner try/catches; one outer wrapper is the contract.
  - DEPENDENCIES: Task 1 (imports) + S1's helpers.

Task 3: MODIFY src/settings.ts — update the module-header JSDoc
  - S1's module header says (paraphrased) "S1 adds the leaf helpers; loadMulliganConfig (public entry
    point) arrives in S2". UPDATE it to state that loadMulliganConfig now exists and is the module's
    only public export; readSettingsFile/deepMergeSettings are @internal helpers it composes. Keep the
    design note: config.ts stays Pi-free; this module owns all Pi/fs coupling (getAgentDir, join, fs).
  - DEPENDENCIES: Task 2.

Task 4: MODIFY test/settings.test.ts — add vi.mock + vi.hoisted at module top
  - ADD `vi` to the vitest import (S1 imported from "vitest"; ensure `vi` is in the destructure).
  - ADD (at module top, AFTER the imports, BEFORE any describe — vi.mock is hoisted but reads cleanly
    near the top):
      // getAgentDir is the ONLY symbol settings.ts imports from the Pi package. Mock it so tests run
      // against temp dirs (not the real ~/.pi/agent) AND so case (g) can make it throw. vi.mock is
      // hoisted above `let`, so the factory closes over vi.hoisted() mutable state (not a module `let`).
      const mockAgent = vi.hoisted(() => ({
        agentDir: "/nonexistent-mulligan-agent",
        impl: null as null | (() => string),
      }));
      vi.mock("@earendil-works/pi-coding-agent", () => ({
        getAgentDir: () => {
          if (mockAgent.impl) return mockAgent.impl();
          return mockAgent.agentDir;
        },
      }));
  - GOTCHA: the factory returns ONLY `{ getAgentDir }`. That is enough because settings.ts imports
    nothing else from the package. (Returning the whole real module via importOriginal is unnecessary
    and slower — but acceptable if tsc complains about the mock's return type; prefer the minimal form.)
  - GOTCHA: `mockAgent.impl` is `null | (() => string)`; the `if (mockAgent.impl)` guard makes the call
    type-safe under strict mode (GOTCHA #6).
  - DEPENDENCIES: S1's test/settings.test.ts must exist.

Task 5: MODIFY test/settings.test.ts — add loadMulliganConfig to the import + the describe block
  - ADD `loadMulliganConfig` to the existing `import { readSettingsFile, deepMergeSettings } from "../src/settings.js";`
    → `import { readSettingsFile, deepMergeSettings, loadMulliganConfig } from "../src/settings.js";`
  - ADD a new describe block (separate from S1's two describes) with its OWN scoped beforeEach/afterEach
    so it does not collide with S1's module-level `let dir` setup:
      describe("loadMulliganConfig — global+project merge, fail-open", () => {
        let agentDir: string;
        let projectDir: string;
        beforeEach(() => {
          agentDir = mkdtempSync(join(tmpdir(), "mulligan-agent-"));
          projectDir = mkdtempSync(join(tmpdir(), "mulligan-project-"));
          mockAgent.impl = null;       // default: getAgentDir() returns mockAgent.agentDir
          mockAgent.agentDir = agentDir;
        });
        afterEach(() => {
          rmSync(agentDir, { recursive: true, force: true });
          rmSync(projectDir, { recursive: true, force: true });
        });
        // helpers:
        function writeGlobal(json: string) { writeFileSync(join(agentDir, "settings.json"), json); }
        function writeProject(json: string) {
          mkdirSync(join(projectDir, ".pi"), { recursive: true });
          writeFileSync(join(projectDir, ".pi", "settings.json"), json);
        }
        // … it() cases below …
      });
    - NOTE on imports: ensure `mkdirSync` and `writeFileSync` are imported from "node:fs" (S1 imported
      mkdtempSync/rmSync/readFileSync; ADD mkdirSync + writeFileSync if not already present).
  - DEPENDENCIES: Task 4.

Task 6: MODIFY test/settings.test.ts — the 7 loadMulliganConfig test cases (inside the describe)
  - ADD these it() cases (all call loadMulliganConfig(projectDir) explicitly so process.cwd() is never
    exercised — deterministic; cwd is passed, not defaulted):
      (a) "no mulligan key → undefined":
            writeGlobal('{"foo":1}'); writeProject('{"bar":2}');
            expect(loadMulliganConfig(projectDir)).toBeUndefined();
      (b) "global-only mulligan → returns global mulligan":
            writeGlobal('{"mulligan":{"enabled":false}}');  // no project file
            expect(loadMulliganConfig(projectDir)).toEqual({ enabled: false });
      (c) "project-only mulligan → returns project mulligan":
            writeProject('{"mulligan":{"enabled":true}}');  // no global file
            expect(loadMulliganConfig(projectDir)).toEqual({ enabled: true });
      (d) "both → merged (project wins on nested)":   // THE key deep-merge-of-mulligan test
            writeGlobal('{"mulligan":{"enabled":true,"nudges":{"bloatReminder":false,"perTurnDrift":true}}}');
            writeProject('{"mulligan":{"nudges":{"bloatReminder":true}}}');
            expect(loadMulliganConfig(projectDir)).toEqual(
              { enabled: true, nudges: { bloatReminder: true, perTurnDrift: true } });
            // global enabled:true preserved; nested nudges merged (project bloatReminder:true wins;
            // global perTurnDrift:true preserved). Proves deepMergeSettings recursed INTO mulligan.
      (e) "missing files → undefined":
            // neither file written
            expect(loadMulliganConfig(projectDir)).toBeUndefined();
      (f) "invalid JSON → undefined":
            writeGlobal('{not json');  // readSettingsFile fail-opens to {}; project absent → merged {} → no mulligan
            expect(loadMulliganConfig(projectDir)).toBeUndefined();
      (g) "getAgentDir throws → undefined (fail-open)":
            mockAgent.impl = () => { throw new Error("boom"); };
            expect(loadMulliganConfig(projectDir)).toBeUndefined();
  - NAMING: titles phrase input → expected output. Use toBeUndefined() for the undefined cases and
    toEqual() for object cases (deep equality).
  - GOTCHA (case f): make sure the FAIL-OPEN comes from the *absence of a mulligan key* after the
    invalid global is treated as {} — i.e. project file absent. If you instead want to prove invalid
    JSON alone is swallowed, that is readSettingsFile's contract (already tested in S1); here it is the
    end-to-end "garbage file → undefined" path.
  - GOTCHA (case g): set mockAgent.impl per-test; the next beforeEach resets it to null. No cross-test
    leak because beforeEach re-asserts `mockAgent.impl = null`.
  - DEPENDENCIES: Tasks 4-5.

Task 7: VALIDATE (no new code)
  - RUN `npx vitest run test/settings.test.ts` → all pass (S1's tests + the 7 new ones).
  - RUN `npx vitest run` → full suite passes (no regressions).
  - RUN `npx tsc --noEmit` → the ONLY error is the pre-existing test/drift_nudge.test.ts:239 (BUG-002,
    separate task). Confirm NO error line references src/settings.ts or test/settings.test.ts. (GOTCHA #6.)
  - DEPENDENCIES: Tasks 1-6.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): the entire function is one try/catch → the fail-open contract.
export function loadMulliganConfig(cwd?: string): unknown {
  try {
    const globalSettings = readSettingsFile(join(getAgentDir(), "settings.json"));
    const projectSettings = readSettingsFile(join(cwd ?? process.cwd(), ".pi", "settings.json"));
    const merged = deepMergeSettings(globalSettings, projectSettings);
    return merged.mulligan; // Record<string,unknown>.mulligan → unknown | undefined
  } catch {
    return undefined; // fail-open → validateConfig(undefined) → DEFAULT_CONFIG
  }
}
// Walk-through (case d — nested merge of the mulligan block):
//   global = { mulligan: { enabled:true, nudges:{ bloatReminder:false, perTurnDrift:true } } }
//   project= { mulligan: { nudges:{ bloatReminder:true } } }
//   merged = deepMergeSettings(global, project):
//     key "mulligan": both isRecord → recurse deepMergeSettings(global.mulligan, project.mulligan):
//       key "enabled": project lacks → preserved (true)
//       key "nudges":  both isRecord → recurse:
//         key "bloatReminder": project true replaces global false → true
//         key "perTurnDrift":  project lacks → preserved (true)
//       → { bloatReminder:true, perTurnDrift:true }
//     → { enabled:true, nudges:{ bloatReminder:true, perTurnDrift:true } }
//   merged.mulligan = { enabled:true, nudges:{ bloatReminder:true, perTurnDrift:true } } ✓
//
// Walk-through (case g — getAgentDir throws):
//   getAgentDir() throws → caught by the outer try/catch → return undefined ✓ (never reaches a read)

// PATTERN (Task 4): vi.hoisted + vi.mock so the mock can both return a temp dir AND throw.
const mockAgent = vi.hoisted(() => ({
  agentDir: "/nonexistent-mulligan-agent",
  impl: null as null | (() => string),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => (mockAgent.impl ? mockAgent.impl() : mockAgent.agentDir),
}));
// WHY vi.hoisted: vi.mock is hoisted ABOVE `let`/`const` at module scope, so a plain
// `let agentDir` referenced inside the factory would be undefined at call time. vi.hoisted
// creates a reference that is ALSO hoisted, so the factory closes over stable mutable state.
// Minimal factory { getAgentDir } is sufficient (settings.ts imports nothing else from the pkg).
```

### Integration Points

```yaml
CODE:
  - modify: src/settings.ts (S1 file) — + import getAgentDir + import join + export loadMulliganConfig + update module header
  - untouched: src/config.ts (Pi-free; receives raw via setConfig in P1.M1.T2), src/index.ts (P1.M1.T2),
    src/filter.ts, src/nudges.ts, src/tools/*, src/log.ts, src/runtime.ts, all other src files

TESTS:
  - modify: test/settings.test.ts (S1 file) — + vi.mock+vi.hoisted at top + loadMulliganConfig import + describe block (7 cases)
  - untouched: all other test files (drift_nudge.test.ts:239 is a SEPARATE task — GOTCHA #6)

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. loadMulliganConfig is a pure read-only function; no config keys, no persistence, no tool/event registration.
    The runtime wiring (setConfig(loadMulliganConfig(...)) at factory + session_start) is P1.M1.T2.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After modifying src/settings.ts:
npx tsc --noEmit
# EXPECTED: exactly ONE error — `test/drift_nudge.test.ts(239,10): error TS2352 ... rewindRefusedTurnIndex`.
# That is BUG-002 (pre-existing, separate task P1.M2.T1.S1) — NOT yours.
# YOUR bar: NO line in the output references src/settings.ts or test/settings.test.ts.
# If you see a settings.ts/settings.test.ts error, READ it and fix YOUR file. Common causes:
#   - a missing null-check before calling mockAgent.impl() under strict mode;
#   - an import name mismatch (getAgentDir / join / mkdirSync / writeFileSync).
# Do NOT "fix" the drift_nudge error here (scope creep across a task boundary).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The settings test file in isolation — fast feedback on the 7 cases + regression check on S1's tests.
npx vitest run test/settings.test.ts
# EXPECTED: all pass. If a loadMulliganConfig case fails:
#   - undefined case returning an object? → check the mock is wired (getAgentDir returns agentDir);
#     a stale real ~/.pi/agent/settings.json would otherwise leak in.
#   - case (d) merge wrong? → you likely re-implemented merging instead of calling deepMergeSettings;
#     reuse S1's helper (it already recurses into nested objects).
#   - case (g) not undefined? → the outer try/catch is missing or getAgentDir isn't actually throwing
#     (verify mockAgent.impl is set to a throwing fn in that test only).
# S1's readSettingsFile/deepMergeSettings tests must STILL pass (the vi.mock must not perturb them).

# Full suite — confirm no regressions elsewhere (vi.mock is file-scoped; other files unaffected).
npx vitest run
# EXPECTED: all pass (baseline + settings tests). vitest transpiles without type-checking, so the
# pre-existing drift_nudge fixture does not block the run.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: loadMulliganConfig is a pure read-only function with no runtime integration
# to exercise until the index.ts wiring (P1.M1.T2) lands. The end-to-end "does enabled:false actually
# disable Mulligan" validation belongs to P1.M1.T2, not S2. (Documented so the implementer does not
# attempt a premature integration test that has no seam yet — setConfig is not called anywhere in S2.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual REPL sanity check against Pi's own merge (optional — proves the mulligan block merges right):
#   node --input-type=module -e "
#     import { loadMulliganConfig } from './src/settings.js';
#     // writes a real global file at ~/.pi/agent/settings.json — only run on a scratch agent dir via
#     // PI_CODING_AGENT_DIR=/tmp/x node ... to avoid clobbering your real settings.
#     console.log(loadMulliganConfig(process.cwd()));
#   "
# The unit tests in Level 2 already assert these cases programmatically, so this is optional confirmation.
# Prefer setting PI_CODING_AGENT_DIR to a temp dir if you exercise this, to avoid touching real settings.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx vitest run test/settings.test.ts` — all pass (S1's tests + 7 new loadMulliganConfig cases).
- [ ] `npx vitest run` — full suite passes (no regressions).
- [ ] `npx tsc --noEmit` — NO new errors from `src/settings.ts` / `test/settings.test.ts` (the single pre-existing `drift_nudge.test.ts:239` error is BUG-002, out of scope).

### Feature Validation

- [ ] `loadMulliganConfig(cwd?)` reads global (`join(getAgentDir(),"settings.json")`) + project-local (`join(cwd ?? process.cwd(),".pi","settings.json")`), merges via `deepMergeSettings`, and returns `.mulligan`.
- [ ] Returns `undefined` for: no mulligan key (a), missing files (e), invalid JSON (f), getAgentDir throw (g).
- [ ] Returns the correct merged object for global-only (b), project-only (c), and both-with-nested-merge (d — project wins on nested).
- [ ] NEVER throws (entire body in one try/catch → undefined).
- [ ] `cwd` defaults to `process.cwd()` when undefined; the caller (P1.M1.T2) chooses what to pass.

### Code Quality Validation

- [ ] `src/settings.ts` mirrors the codebase's module-header JSDoc style (updated to reflect loadMulliganConfig is now the public export; design split from config.ts noted).
- [ ] `loadMulliganConfig` reuses S1's `readSettingsFile` + `deepMergeSettings` — does NOT reimplement reading or merging.
- [ ] S1's helpers (`readSettingsFile` / `deepMergeSettings` / `isRecord`) are UNCHANGED.
- [ ] Only `src/settings.ts` and `test/settings.test.ts` are modified — NO changes to config.ts, index.ts, handlers, tools, drift_nudge.test.ts, README, or spec.

### Documentation & Deployment

- [ ] JSDoc on `loadMulliganConfig` explains: what it reads (global + project-local), merge precedence (project-local wins), fail-open contract (any error → undefined → DEFAULT_CONFIG), and the `cwd` parameter semantics (Mode A — rides with the code). This is the module's only public export.
- [ ] No user-facing doc change in S2 — the README/spec accuracy sweep is P1.M3.T1 (after the index.ts wiring lands).

---

## Anti-Patterns to Avoid

- ❌ Don't add inner try/catches or let any path throw — the contract is ONE outer `try { read+merge+extract } catch { return undefined; }`. A throw at config-load time crashes extension startup; loadMulliganConfig is on that path (called from the factory via P1.M1.T2).
- ❌ Don't reimplement file reading or merging — call S1's `readSettingsFile` + `deepMergeSettings`. They are already fail-open / pure / tested. Duplicating logic is exactly the drift bug class this fix is eliminating.
- ❌ Don't validate, coerce, or shape the result — return raw `unknown`. `validateConfig` (config.ts) is the single validation engine; calling it here couples the Pi-bound module to the cache and breaks config.ts's Pi-free invariant.
- ❌ Don't call `setConfig` / `getConfig` / `setLogFile` from `settings.ts` — that wiring lives in `index.ts` (P1.M1.T2). S2 is the function + tests only.
- ❌ Don't use `process.env.PI_CODING_AGENT_DIR` instead of mocking getAgentDir — it works for cases (a)-(f) but CANNOT make getAgentDir throw for case (g). The contract explicitly requires mocking getAgentDir; use `vi.mock` + `vi.hoisted`.
- ❌ Don't reference a module-scope `let` inside the `vi.mock` factory — `vi.mock` is hoisted above such declarations, so the factory would see `undefined`. Use `vi.hoisted()` to share mutable state (the factory closes over the hoisted object).
- ❌ Don't return a non-minimal mock factory (e.g. `importOriginal` + spread) unless tsc forces it — settings.ts imports ONLY `getAgentDir`, so `{ getAgentDir }` is the cleanest factory.
- ❌ Don't put the loadMulliganConfig `beforeEach`/`afterEach` at module scope where it could collide with S1's module-level `let dir` setup — scope them INSIDE the new `describe("loadMulliganConfig")` block (vitest runs describe-scoped hooks in addition to module-scoped ones; different temp-dir variable names avoid any collision).
- ❌ Don't "fix" the `test/drift_nudge.test.ts:239` tsc error — that's BUG-002, a separate task (P1.M2.T1.S1). Your tsc bar is "no NEW errors from my files", not "tsc is fully clean".
- ❌ Don't pass `cwd` through `process.cwd()` unconditionally — resolve `cwd ?? process.cwd()` so an explicit cwd (e.g. `ctx.cwd` at session_start) is honored.

---

## Decision Log

- **D1 — Use `vi.mock` + `vi.hoisted` (not `PI_CODING_AGENT_DIR`) to control getAgentDir in tests.** `getAgentDir()` reads `PI_CODING_AGENT_DIR` live (config.js:413), so an env-var approach would work for cases (a)-(f). But contract case (g) "getAgentDir throws → undefined" requires a function that can THROW — an env var cannot throw. `vi.mock("@earendil-works/pi-coding-agent", factory)` with `vi.hoisted` state is the single mechanism that satisfies all 7 cases. `vi.mock` is file-scoped, so it does not leak to other test files and does not perturb S1's readSettingsFile/deepMergeSettings tests (which never call getAgentDir). The minimal factory `{ getAgentDir }` is sufficient because settings.ts imports nothing else from the package.

- **D2 — Return `unknown` (raw, unvalidated), not a typed `MulliganConfig`.** The architecture (system_context §1.5) and config.ts's Pi-free invariant require that settings.ts only reads + merges + extracts; validation is config.ts's `validateConfig`. Returning `unknown` (with `undefined` for absent/error) preserves the clean handoff `loadMulliganConfig → setConfig(raw) → validateConfig`. The `(merged as Record<string, unknown>)?.mulligan` cast in the contract is a harmless no-op (deepMergeSettings already returns `Record<string, unknown>`); `merged.mulligan` is the idiomatic form.

- **D3 — One outer try/catch; no inner guards.** `readSettingsFile` and `deepMergeSettings` never throw by construction (S1), so the only realistic throw sources are `getAgentDir()`, `process.cwd()`, and `join()`. A single outer `try { … } catch { return undefined; }` covers all of them and matches the contract's "ENTIRE body wrapped in try/catch". Adding inner try/catches would be dead code and obscure the fail-open contract.

- **D4 — Scope the loadMulliganConfig test hooks inside its `describe` block.** S1's test/settings.test.ts already has module-level `let dir; beforeEach/afterEach`. Adding S2's `agentDir`/`projectDir` setup at module scope risks confusion and variable-name churn. Vitest runs describe-scoped hooks alongside module-scoped ones, and using distinct variable names (`agentDir`/`projectDir` vs S1's `dir`) plus distinct temp-dir prefixes (`mulligan-agent-`/`mulligan-project-` vs `mulligan-settings-`) keeps the two setups cleanly independent.

---