---
name: "P1.M1.T1.S1 — Add revert config interface, defaults, and validation"
description: >
  Add the `revert` config block (8 fields) to `MulliganConfig`, `DEFAULT_CONFIG`, and
  `validateConfig` in `src/config.ts`, plus JSDoc (Mode A) and a full validation test
  suite in `test/config.test.ts`. This is the typed config contract that ALL downstream
  v1.2 working-tree-revert phases consume via `getConfig().revert`.
---

## Goal

**Feature Goal**: The `revert` configuration block — with all 8 fields, exact spec defaults,
fail-safe per-field validation, and JSDoc — exists in `src/config.ts` and is accessible at
`getConfig().revert`, matching the established `rewind`/`shrink`/`nudges`/`ui`/`log` block
patterns exactly.

**Deliverable**:
1. `MulliganConfig.revert` interface block (8 fields) with per-field JSDoc, citing `@14 §8`
   and `spec/09 §2/§3`.
2. `DEFAULT_CONFIG.revert` with the exact spec defaults (all INERT — `enabled:false`).
3. A `revertRaw = safeGet(raw, "revert")` validation section inside `validateConfig()` that
   coerces/validates each field per `spec/09 §4`, NEVER throws, falls back to defaults on
   any per-field failure with a `warnConfig`.
4. Three new module-local coerce helpers: `coerceNonGitMode`, `coerceStorageDir`,
   `coerceExcludeGlobs` (parallel to existing `coerceEstimateConfidence` / `coerceLogFile` /
   `coerceProtectedRoles`).
5. One `import { resolve, relative, isAbsolute } from "node:path";` at the top of config.ts
   (the file currently imports NOTHING; Node built-ins are allowed — config.ts is Pi-free,
   not Node-free).
6. A full validation test suite in `test/config.test.ts` (new `describe` block + updates to
   two existing whole-config literals — see CRITICAL GOTCHA below).

**Success Definition**:
- `getConfig().revert` returns a typed object with all 8 fields at the spec defaults.
- `validateConfig({ revert: { ... } })` deep-merges valid partials over defaults; invalid
  present values fall back to the default + exactly one `console.warn` naming the field;
  absent values keep the default SILENTLY (no warn).
- `validateConfig` NEVER throws on adversarial input (the existing outer try/catch covers it).
- `npm run typecheck` (tsc --noEmit) and `npm test` (vitest run) both pass.

## Why

- This is the **root of the entire v1.2 working-tree-revert feature**. Every downstream phase
  (P1.M2 types, P2 SnapshotStore backends, P3 capture lifecycle, P4 rewind integration, P5
  integration tests) reads its behavioral knobs from `getConfig().revert`.
- The config is DEFAULT-OFF (`enabled:false`) so adding it is non-disruptive: until a user
  opts in, the snapshot machinery is fully inert — no capture, no overhead.
- Mirrors the proven fail-safe validation philosophy (`spec/09 §4`: "never throw, fall back
  to defaults") that already governs every other block.

## What

A new `revert` block on `MulliganConfig` with these fields and exact defaults
(`spec/09 §2`, `spec/14 §8`):

| Field                       | Type                     | Default                                                                  | Validation (`spec/09 §4`)                                                                         |
|-----------------------------|--------------------------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| `enabled`                   | `boolean`                | `false`                                                                  | coerceBoolean (`!!`); never warns.                                                                |
| `allowDeleteCreatedFiles`   | `boolean`                | `false`                                                                  | coerceBoolean (`!!`); never warns.                                                                |
| `nonGitMode`                | `"cas"` \| `"explicit-paths"` | `"cas"`                                                                  | must be one of the two literals; else default `cas` + warn.                                       |
| `storageDir`                | `string \| null`         | `null`                                                                   | `null` valid (default); string accepted ONLY if it does NOT resolve inside `process.cwd()`; else `null` + warn. non-string → `null` + warn. |
| `maxFileBytes`              | `number`                 | `262144` (256 KB)                                                        | coerceNumber `>0`, finite; else default + warn.                                                   |
| `maxTotalBytes`             | `number`                 | `33554432` (32 MB)                                                       | coerceNumber `>0`, finite; else default + warn.                                                   |
| `maxSnapshotsPerTurn`       | `number`                 | `64`                                                                     | coerceNumber `>0`, finite; else default + warn.                                                   |
| `excludeGlobs`              | `string[]`               | `[".git","node_modules","dist","build",".next",".venv","target"]`        | array of strings; non-array → default list + warn; non-string elements dropped (per-entry warn).   |

### Success Criteria

- [ ] `DEFAULT_CONFIG.revert` deep-equals the 8-field default object above.
- [ ] `validateConfig({}).revert` === those defaults, with ZERO `console.warn` calls.
- [ ] Each present-but-invalid field falls back to its default with exactly one warn naming
      the field (e.g. `revert.storageDir`, `revert.nonGitMode`, `revert.maxFileBytes`).
- [ ] Absent fields never warn (the `v !== undefined` guard — GOTCHA #1).
- [ ] `storageDir` set to a path resolving inside `process.cwd()` → `null` + warn.
- [ ] `revert` block that is not a record (string/array/null) → all defaults SILENTLY (no warn),
      matching how `ui`/`audit`/`shrink`/`nudges` non-record blocks are handled.
- [ ] `validateConfig` still never throws on a throwing Proxy / circular ref.
- [ ] `DEFAULT_CONFIG` is never mutated by validation (the structuredClone guard holds).
- [ ] `npm run typecheck` + `npm test` pass.

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?"
YES. The target file (`src/config.ts`), the exact pattern to mirror (`shrink`/`ui`/`log`
blocks), every helper signature, the test conventions, and the two tests that MUST be
updated are all specified below with line-anchored references.

### Documentation & References

```yaml
# MUST READ — the authority for every field default + validation rule
- file: spec/09-configuration.md
  why: "§2 = schema/defaults table; §3 = rationale per knob (the WHY behind each default);
        §4 = the exact validation rules this task implements line-for-line."
  section: "§2 Schema & defaults, §3 Rationale per knob (revert.* rows), §4 Validation rules
            (the 'revert.*' bullet)"
  critical: "§4 also states the global rules: 'Any failure → default for that field; never
             throw.' and 'On any per-field validation failure: log a warn naming the field
             and the value, use the default, continue.' Implement these EXACTLY."

- file: spec/14-working-tree-revert.md
  why: "§8 reproduces the exact revert config JSONC block with inline comments (the canonical
        copy of the defaults). §1 explains the 3-layer opt-in model (config.enabled /
        per-call flags / allowDeleteCreatedFiles) the fields encode."
  section: "§8 Configuration (the jsonc block), §1 Opt-in model & guardrails"
  critical: "§8 comment on storageDir: 'null → default (<sessionDir>/mulligan/). NEVER under
             cwd.' — this is the requirement the storageDir-inside-cwd rejection enforces."

# MUST READ — the file being modified (read it FULLY first)
- file: src/config.ts
  why: "This is the ONLY source file modified. It defines MulliganConfig, DEFAULT_CONFIG,
        validateConfig, and all coerce* helpers. The new revert block mirrors the existing
        shrink/ui/log blocks verbatim in structure."
  pattern: "Block validation shape to copy (the shrink block is the closest analog — nested
            object read via safeGet, isRecord guard, then per-field coerce with v!==undefined
            guards). See Implementation Tasks Task 3."
  gotcha: "The file currently has ZERO import statements. The storageDir cwd-check needs
           node:path — see Task 1. config.ts is 'Pi-free' (the docstring says 'imports
           NOTHING from Pi') but Node built-ins ARE allowed (settings.ts already imports
           node:path/node:fs). Do NOT import anything from Pi here."

# MUST READ — the test file being modified
- file: test/config.test.ts
  why: "Add the new revert validation tests here AND update the two whole-config literals
        that will otherwise break. Every existing block's test shape is the template."
  pattern: "Per-field describe blocks with lettered (a)/(b)/(c)... cases; warn assertions via
            vi.spyOn(console,'warn').mockImplementation(()=>{}) wrapped in try/finally
            mockRestore; type-level via expectTypeOf<...>(). See Task 5."
  critical: "CRITICAL GOTCHA — see 'Known Gotchas' #1 below: TWO existing tests assert the
             WHOLE config object with expect(...).toEqual({...}) literals. Adding revert to
             DEFAULT_CONFIG makes those literals missing the revert key → they FAIL unless
             the revert default block is added to each literal."

# Cross-check — confirm the deep-merge already recurses (NO code change expected)
- file: src/settings.ts
  why: "deepMergeSettings recurses whenever BOTH values are isRecord. Since `revert` is a
        nested object, project-local mulligan.revert.* already deep-merges over global
        mulligan.revert.* with no code change. Verify in test (Task 6) rather than editing."
  pattern: "deepMergeSettings(global, project): isRecord(g) && isRecord(p) ? recurse : replace"

# Architecture notes prepared for this feature
- file: plan/008_c36fd26768ae/architecture/codebase_patterns.md
  why: "§1 (Config Pattern) is the precise recipe for THIS task. Confirms the helper set and
        the storageDir special-validation requirement."
  section: "§1 Config Pattern (src/config.ts)"
```

### Current Codebase tree (relevant slice)

```bash
src/
├── config.ts        # ← THE file modified (interface + DEFAULT_CONFIG + validateConfig + helpers)
├── settings.ts      # deep-merge; verify-only (no change expected)
└── ... (other modules unchanged by this task)
test/
├── config.test.ts   # ← add revert tests + update 2 whole-config literals
└── settings.test.ts # optional: add a revert-block deep-merge regression test
```

### Desired Codebase tree

```bash
src/
└── config.ts        # MODIFIED: +revert interface block, +revert DEFAULT_CONFIG, +revert
                     #   validateConfig section, +3 coerce helpers, +node:path import
test/
└── config.test.ts   # MODIFIED: +revert describe block, +revert in 2 existing toEqual literals
```
No new files are created by this task.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 — TWO EXISTING TEST LITERALS WILL BREAK.
// config.test.ts asserts the WHOLE config object via toEqual with an explicit literal in:
//   (1) describe("DEFAULT_CONFIG"): it("matches the spec/09 §2 defaults exactly")
//         expect(DEFAULT_CONFIG).toEqual({ enabled, rewind, shrink, nudges, audit, ui, log })
//   (2) describe("validateConfig"): it("applies a full valid override")
//         expect(cfg).toEqual({ ...same shape... })
// Adding `revert` to DEFAULT_CONFIG means both literals are now MISSING the revert key → toEqual
// FAILS (toEqual requires exact key sets). The implementer MUST add the revert default block to
// BOTH literals. Other tests use field-level access (cfg.rewind.maxDepth) or expect(...).toEqual(DEFAULT_CONFIG)
// (self-referential) — those are unaffected. → See Task 5 Step 0.

// GOTCHA #2 — config.ts imports NOTHING today. storageDir validation needs node:path.
// Add `import { resolve, relative, isAbsolute } from "node:path";` as the FIRST line.
// config.ts is "Pi-free" (docstring: "imports NOTHING from Pi"), NOT "Node-free". settings.ts
// already imports node:path/node:fs. Keep it Pi-free.

// GOTCHA #3 — absent vs present-but-invalid (the v !== undefined guard).
// Each field is read via safeGet; the `if (v !== undefined)` guard SKIPS absent fields (keep
// default, NO warn) and only runs the coercer on a genuinely-present value. This is why a
// partial override produces ZERO warns. Booleans (coerceBoolean) NEVER warn even when present.
// Copy this guard verbatim from the shrink/ui blocks.

// GOTCHA #4 — the outer try/catch in validateConfig NEVER throws.
// The whole body is wrapped in try/catch → return structuredClone(DEFAULT_CONFIG). The new
// revert section sits INSIDE that try block, so a throwing Proxy get-trap on raw.revert.* is
// already covered. Do NOT add a try/catch inside the revert section.

// GOTCHA #5 — storageDir cwd-check uses process.cwd() (config.ts has no ctx).
// config.ts is pure and runs at factory time (D4 lifecycle asymmetry: process.cwd() before
// session_start, then re-validated). The "resolves inside cwd" check therefore uses
// process.cwd(). TESTS run with process.cwd() = the repo root, so a "valid outside cwd" test
// value must be os.tmpdir() or an absolute path outside the repo — NOT a relative path.

// GOTCHA #6 — coerceNumber mustBePositive:true enforces >0; the default fallback is passed in.
// cfg.revert.maxFileBytes = coerceNumber("revert.maxFileBytes", v, cfg.revert.maxFileBytes, true).
// The fallback arg MUST be cfg.revert.<field> (the cloned default), not a hardcoded literal, so
// deep-merge semantics hold. (Matches the shrink.notifyMaxChars / nudges.driftThresholdTokens calls.)

// GOTCHA #7 — nonGitMode has exactly TWO valid literals (NOT a 3-value enum like EstimateConfidence).
// Valid: "cas" | "explicit-paths". Anything else (including "CAS", "explicit_paths", 123) →
// default "cas" + warn. Match coerceEstimateConfidence's shape but with a 2-element set.

// GOTCHA #8 — excludeGlobs has NO domain restriction (any non-empty string is valid).
// Unlike protectedRoles (filtered to KNOWN selectors), excludeGlobs keeps every string element.
// Only the element TYPE (must be string) and the top-level shape (must be array) are validated.
// Per-entry warn on non-string elements mirrors coerceProtectedRoles' per-entry warn on unknowns.
```

## Implementation Blueprint

### Data models and structure

The ONLY data model is the new `revert` block on `MulliganConfig`. No Pydantic/ORM — this is
TypeScript interfaces + a plain `DEFAULT_CONFIG` const.

```typescript
// Inside the MulliganConfig interface, placed BETWEEN `shrink` and `nudges`
// (matches spec/09 §2 key order: enabled, rewind, shrink, revert, nudges, audit, ui, log):

  /** Working-tree revert operation (`mulligan_rewind` file restoration) settings — v1.2,
   *  opt-in. The whole block is INERT until `enabled` is set true AND the agent passes the
   *  per-call revert flags on rewind (spec/14 §1 three-layer opt-in). Source: spec/14 §8,
   *  spec/09 §2/§3. */
  revert: {
    /** Master opt-in. false (default) → snapshot machinery is fully inert (no capture, no
     *  overhead). The rewind tool still accepts the per-call flags but ignores them.
     *  Default: false. (spec/14 §1, spec/09 §2/§3) */
    enabled: boolean;
    /** Global kill-switch on the destructive delete path. Deletion is the one irreversible
     *  revert action, so it sits behind BOTH the per-call `delete_created_files` flag AND
     *  this config gate (both required). Default: false. (spec/14 §1, spec/09 §3) */
    allowDeleteCreatedFiles: boolean;
    /** Non-git capture strategy. "cas" (default — comprehensive whole-tree snapshot) or
     *  "explicit-paths" (conservative — only write/edit tool paths; bash not captured; the
     *  pi-undo-redo model). Git workspaces use the GitBackend regardless. Default: "cas".
     *  (spec/14 §4.1/§4.2, spec/09 §3) */
    nonGitMode: "cas" | "explicit-paths";
    /** Root dir for the shadow repo / CAS store, or null for the default
     *  `<sessionDir>/mulligan/`. MUST NOT resolve inside cwd (would pollute the workspace) —
     *  validateConfig rejects such a value with null + warn. Default: null. (spec/14 §8,
     *  spec/09 §3/§4) */
    storageDir: string | null;
    /** Per-file byte cap; files larger than this are skipped + warned (fail-closed — a huge
     *  gitignored data file is never silently claimed restorable). Must be > 0.
     *  Default: 262144 (256 KB). (spec/14 §8, spec/09 §3/§4) */
    maxFileBytes: number;
    /** Per-session byte cap for capture; capture stops (best-effort partial snapshot) beyond
     *  it. Must be > 0. Default: 33554432 (32 MB). (spec/14 §8, spec/09 §3/§4) */
    maxTotalBytes: number;
    /** Count cap on snapshots captured per turn; capture stops accepting new data beyond it.
     *  Must be > 0. Default: 64. (spec/14 §8, spec/09 §3/§4) */
    maxSnapshotsPerTurn: number;
    /** Snapshot exclude globs for BOTH backends. `.gitignore` is deliberately NOT consulted —
     *  a gitignored `.env` is exactly the file a revert must restore. Non-array → default list.
     *  Default: [".git","node_modules","dist","build",".next",".venv","target"].
     *  (spec/14 §4.3/§8, spec/09 §3/§4) */
    excludeGlobs: string[];
  };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts — add the node:path import
  - ADD as the FIRST line of the file (currently no imports):
      import { resolve, relative, isAbsolute } from "node:path";
  - WHY: storageDir validation (Task 4) needs path resolution to test "resolves inside cwd".
    config.ts is Pi-free, NOT Node-free (settings.ts already imports node:path).
  - GOTCHA: #2 above.

Task 2: MODIFY src/config.ts — add the `revert` block to MulliganConfig AND DEFAULT_CONFIG
  - INTERFACE: add the `revert: { ... }` block (8 fields, from "Data models" above) BETWEEN
    the `shrink` block and the `nudges` block in the MulliganConfig interface. Include the
    per-field JSDoc shown above (cite @14 §8 and spec/09 §2/§3 on the block + each field).
  - DEFAULT_CONFIG: add the matching object BETWEEN the `shrink` and `nudges` entries:
        revert: {
          enabled: false,
          allowDeleteCreatedFiles: false,
          nonGitMode: "cas",
          storageDir: null,
          maxFileBytes: 262144,
          maxTotalBytes: 33554432,
          maxSnapshotsPerTurn: 64,
          excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
        },
  - NAMING: camelCase fields, exact spelling above (allowDeleteCreatedFiles, nonGitMode, etc.).
  - PLACEMENT: between shrink and nudges (spec/09 §2 canonical key order).

Task 3: MODIFY src/config.ts — add the `revert` validation section in validateConfig()
  - FIND pattern: the `shrink` validation block inside validateConfig (the
    `const shrinkRaw = safeGet(raw, "shrink"); if (isRecord(shrinkRaw)) { ... }` block).
  - ADD the revert block IMMEDIATELY AFTER the shrink block and BEFORE the nudges block:
        // revert.* (v1.2 working-tree revert; spec/14 §8, spec/09 §2/§4)
        const revertRaw = safeGet(raw, "revert");
        if (isRecord(revertRaw)) {
          v = safeGet(revertRaw, "enabled");
          if (v !== undefined) cfg.revert.enabled = coerceBoolean(v, cfg.revert.enabled);
          v = safeGet(revertRaw, "allowDeleteCreatedFiles");
          if (v !== undefined) cfg.revert.allowDeleteCreatedFiles = coerceBoolean(v, cfg.revert.allowDeleteCreatedFiles);
          v = safeGet(revertRaw, "nonGitMode");
          if (v !== undefined) cfg.revert.nonGitMode = coerceNonGitMode(v, cfg.revert.nonGitMode);
          v = safeGet(revertRaw, "storageDir");
          if (v !== undefined) cfg.revert.storageDir = coerceStorageDir(v, cfg.revert.storageDir);
          v = safeGet(revertRaw, "maxFileBytes");
          if (v !== undefined) cfg.revert.maxFileBytes = coerceNumber("revert.maxFileBytes", v, cfg.revert.maxFileBytes, true);
          v = safeGet(revertRaw, "maxTotalBytes");
          if (v !== undefined) cfg.revert.maxTotalBytes = coerceNumber("revert.maxTotalBytes", v, cfg.revert.maxTotalBytes, true);
          v = safeGet(revertRaw, "maxSnapshotsPerTurn");
          if (v !== undefined) cfg.revert.maxSnapshotsPerTurn = coerceNumber("revert.maxSnapshotsPerTurn", v, cfg.revert.maxSnapshotsPerTurn, true);
          v = safeGet(revertRaw, "excludeGlobs");
          if (v !== undefined) cfg.revert.excludeGlobs = coerceExcludeGlobs(v, cfg.revert.excludeGlobs);
        }
  - FOLLOW pattern: the shrink block EXACTLY (safeGet → isRecord guard → v!==undefined per field).
  - GOTCHA #3/#4 above (the v!==undefined guard + outer try/catch already covers throwing proxies).
  - DEPENDENCIES: Tasks 1 (node:path) + 4 (the 3 coerce helpers) must land first or in the same edit.

Task 4: MODIFY src/config.ts — add the 3 new module-local coerce helpers
  - PLACEMENT: alongside the existing private helpers (coerceLogFile, coerceEstimateConfidence,
    coerceProtectedRoles), i.e. under the `// ── private helpers (module-local; not exported) ─` section.
  - IMPLEMENT (exact bodies):

      /** nonGitMode: must be one of "cas"|"explicit-paths"; else fallback + warn (spec/09 §4). */
      function coerceNonGitMode(value: unknown, fallback: "cas" | "explicit-paths"): "cas" | "explicit-paths" {
        if (value === "cas" || value === "explicit-paths") return value;
        warnConfig("revert.nonGitMode", value);
        return fallback;
      }

      /** storageDir: null (valid — default) or a string that MUST NOT resolve inside process.cwd()
       *  (spec/14 §8: "NEVER under cwd"). A value that resolves inside cwd → null + warn.
       *  Non-string/non-null → null + warn. Mirrors coerceLogFile's null-is-valid handling. */
      function coerceStorageDir(value: unknown, fallback: string | null): string | null {
        if (value === null) return fallback;            // explicit "use default" — valid, no warn
        if (typeof value !== "string") {
          warnConfig("revert.storageDir", value);
          return fallback;                              // non-string → null (default)
        }
        // Reject if the resolved path is inside cwd (would pollute the workspace).
        const cwd = resolve(process.cwd());
        const resolved = resolve(cwd, value);
        const rel = relative(cwd, resolved);
        const insideCwd = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
        if (insideCwd) {
          warnConfig("revert.storageDir", value);
          return fallback;                              // inside cwd → null (default)
        }
        return value;
      }

      /** excludeGlobs: array of strings; non-array → fallback + warn. Non-string elements
       *  dropped with a per-entry warn (mirrors coerceProtectedRoles' per-entry discipline).
       *  Any non-empty string is valid (NO domain restriction, unlike protectedRoles).
       *  spec/09 §4, spec/14 §8. */
      function coerceExcludeGlobs(value: unknown, fallback: string[]): string[] {
        if (!Array.isArray(value)) {
          warnConfig("revert.excludeGlobs", value);
          return fallback;
        }
        const out: string[] = [];
        for (const entry of value) {
          if (typeof entry === "string") out.push(entry);
          else warnConfig("revert.excludeGlobs entry", entry);
        }
        return out;
      }

  - NAMING: lowercase coerce* verb, exact names above (referenced by Task 3).
  - GOTCHA #5 (process.cwd at validate time), #7 (2-value nonGitMode), #8 (excludeGlobs any string).

Task 5: MODIFY test/config.test.ts — Step 0 UPDATE the 2 existing whole-config literals, then ADD revert tests
  - STEP 0 (CRITICAL — GOTCHA #1): add the revert default block to BOTH existing toEqual literals:
      (1) describe("DEFAULT_CONFIG") → it("matches the spec/09 §2 defaults exactly"):
          add to the expect(DEFAULT_CONFIG).toEqual({...}) literal, between shrink and nudges:
              revert: {
                enabled: false,
                allowDeleteCreatedFiles: false,
                nonGitMode: "cas",
                storageDir: null,
                maxFileBytes: 262144,
                maxTotalBytes: 33554432,
                maxSnapshotsPerTurn: 64,
                excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
              },
      (2) describe("validateConfig") → it("applies a full valid override"):
          the input omits revert, so the validated output carries the DEFAULT revert block —
          add the SAME revert default block to the expect(cfg).toEqual({...}) literal
          (between shrink and nudges). Do NOT add revert to the input object (it must stay a
          test of overrides-over-defaults for the other fields).
  - STEP 1: ADD a new describe block (place it near the other block-specific describes, e.g.
    after the ui.activeCheckpointBanner describe). Header comment cites spec/14 §8 + spec/09 §4
    and the task id P1.M1.T1.S1. Lettered (a)/(b)/(c)... cases, mirroring the shrink/notifyMaxChars
    blocks exactly (vi.spyOn(console,"warn").mockImplementation(()=>{}) in try/finally mockRestore):

        describe("revert.* (P1.M1.T1.S1 / spec/14 §8, spec/09 §2-§4)", () => {
          const REVERT_DEFAULT = {
            enabled: false,
            allowDeleteCreatedFiles: false,
            nonGitMode: "cas",
            storageDir: null,
            maxFileBytes: 262144,
            maxTotalBytes: 33554432,
            maxSnapshotsPerTurn: 64,
            excludeGlobs: [".git", "node_modules", "dist", "build", ".next", ".venv", "target"],
          };

          it("(a) defaults to the spec/14 §8 block with NO warn", () => { ... });
          it("(b) passes through a full valid override", () => { ... });
          it("(c) enabled/allowDeleteCreatedFiles coerce with !! (never warn)", () => { ... });
          it("(d) nonGitMode: 'cas'/'explicit-paths' kept; invalid → 'cas' + 1 warn", () => { ... });
          it("(e) storageDir: null valid; string-outside-cwd valid; string-inside-cwd → null + warn; non-string → null + warn", () => { ... });
          it("(f) maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn: finite >0; invalid → default + 1 warn each", () => { ... });
          it("(g) excludeGlobs: string[] kept; non-array → default + 1 warn; non-string elements dropped", () => { ... });
          it("(h) non-record revert block → all defaults SILENTLY (no warn)", () => { ... });
          it("(i) round-trip via setConfig/getConfig", () => { ... });
          it("(type) revert fields are correctly typed", () => { ... });
        });

    CONCRETE ASSERTIONS each case must make (so the implementer doesn't guess):
      (a) warn-silent; expect(validateConfig({}).revert).toEqual(REVERT_DEFAULT).
      (b) full override all 8 fields valid → all 8 reflected; warn-silent.
          Use storageDir: <os.tmpdir()> (absolute, outside repo cwd) so it's accepted.
      (c) enabled:1→true, enabled:0→false, allowDeleteCreatedFiles:"x"→true, allowDeleteCreatedFiles:null→false,
          and booleans NEVER warn (assert warn not called) — matches the `enabled`/`activeCheckpointBanner` tests.
      (d) nonGitMode:"explicit-paths"→kept; "cas"→kept; "bogus"/123/null→"cas"+1 warn each naming revert.nonGitMode.
      (e) storageDir:null→null (no warn); storageDir:os.tmpdir()→kept (no warn);
          storageDir:"./local-revert" (resolves inside repo cwd)→null + 1 warn naming revert.storageDir;
          storageDir: process.cwd() itself → null + warn (rel==="" → inside);
          storageDir:42→null + 1 warn.
      (f) for each of the 3 number fields and each bad in {0,-1,NaN,Infinity,"x"}: default + exactly 1 warn
          naming the field (revert.maxFileBytes / revert.maxTotalBytes / revert.maxSnapshotsPerTurn).
          Boundary 1 is valid (must be >0).
      (g) excludeGlobs:["foo","bar"]→["foo","bar"]; excludeGlobs:"not-array"→default + 1 warn;
          excludeGlobs:[1,"ok",null,"ok2"]→["ok","ok2"] + 2 per-entry warns naming "revert.excludeGlobs entry".
      (h) validateConfig({ revert: "oops" }).revert === REVERT_DEFAULT and warn NOT called; same for
          revert:[1,2] and revert:null (null is not a record → block silently ignored, matches ui/audit/shrink).
      (i) setConfig({ revert: { enabled: true } }); expect(getConfig().revert.enabled).toBe(true);
          and the other 7 fields are still the defaults (deep-merge holds).
      (type) expectTypeOf<MulliganConfig["revert"]>().toHaveProperty("enabled").toEqualTypeOf<boolean>();
             ...nonGitMode → EqualTypeOf<"cas"|"explicit-paths">; storageDir → string|null;
             maxFileBytes/maxTotalBytes/maxSnapshotsPerTurn → number; excludeGlobs → string[].
  - FOLLOW pattern: the shrink.notifyMaxChars / ui.activeCheckpointBanner describe blocks.
  - NAMING: import nothing new (os is a Node global; type MulliganConfig already imported).
  - IMPORT note: `import os from "node:os";` at top of the test file IF using os.tmpdir(); OR use a
    hard-coded absolute path outside the repo (e.g. "/tmp/mulligan-revert-test"). Either is fine.

Task 6 (VERIFY-ONLY, optional): settings.test.ts — confirm revert-block deep-merge
  - The item says "Verify settings.ts deep-merge recurses into the new revert block (it should —
    verify no change needed)." deepMergeSettings recurses when both values are isRecord — a
    nested revert object qualifies, so NO settings.ts change is required.
  - OPTIONAL: add one regression test to test/settings.test.ts asserting
    deepMergeSettings({mulligan:{revert:{enabled:false}}}, {mulligan:{revert:{maxFileBytes:1}}})
    recurses into revert (yields {mulligan:{revert:{enabled:false,maxFileBytes:1}}}). If
    settings.test.ts already has a generic nested-merge case, skip this.
  - DO NOT modify src/settings.ts.
```

### Implementation Patterns & Key Details

```typescript
// The revert validation section is a carbon copy of the shrink block's SHAPE. Reference shape
// (from src/config.ts, the shrink block — copy this structure for revert):
//
//   const shrinkRaw = safeGet(raw, "shrink");
//   if (isRecord(shrinkRaw)) {
//     v = safeGet(shrinkRaw, "enabled");
//     if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
//     ...per field...
//   }
//
// KEY INVARIANTS for the revert copy:
//   - safeGet(raw, "revert")      // never throws even on a Proxy with a throwing get trap
//   - isRecord(revertRaw)         // false for null/array/string/primitive → whole block skipped SILENTLY
//   - v = safeGet(revertRaw, X)   // read each field
//   - if (v !== undefined) ...    // SKIP absent fields (keep default, no warn); only coerce present ones
//   - coerceBoolean NEVER warns; coerceNumber/coerceNonGitMode/coerceStorageDir/coerceExcludeGlobs DO warn
//     on invalid-present (exactly once, via warnConfig, which itself is wrapped in try/catch).

// The storageDir "inside cwd" predicate (the one non-trivial piece):
//   const cwd = resolve(process.cwd());                 // absolute, normalized
//   const resolved = resolve(cwd, value);               // resolve relative-to-cwd (or absolute passthrough)
//   const rel = relative(cwd, resolved);                // path from cwd to resolved
//   const insideCwd = rel === ""                        // resolved IS cwd exactly
//                  || (!rel.startsWith("..") && !isAbsolute(rel));  // or a path under cwd
//   // rel starting with ".." → outside cwd → accepted. rel absolute (different drive on Windows) → outside.
// This is the standard "is path B inside dir A" idiom and is cross-platform (Windows drive letters
// make relative() return an absolute path, which isAbsolute() then flags as outside).

// NON-GOAL: do NOT create src/snapshot/, do NOT add RewindMarker.revert, do NOT touch runtime.ts,
// do NOT modify the rewind tool or commands. Those are P1.M2 / P3 / P4. This task is config-only.
```

### Integration Points

```yaml
CONFIG (src/config.ts — the ONLY source change):
  - interface MulliganConfig: + `revert` block (8 fields) between shrink and nudges
  - const DEFAULT_CONFIG:     + `revert` object between shrink and nudges (all inert defaults)
  - function validateConfig:  + `revertRaw` validation section between shrink and nudges blocks
  - private helpers:          + coerceNonGitMode, coerceStorageDir, coerceExcludeGlobs
  - imports:                  + `import { resolve, relative, isAbsolute } from "node:path"`

TESTS (test/config.test.ts):
  - UPDATE: 2 existing expect(...).toEqual({...}) whole-config literals (add revert default block)
  - ADD:    1 new describe("revert.* ...") block (~10 lettered cases)

NO CHANGES TO: src/settings.ts (deep-merge already recurses — verify only),
  src/index.ts, src/markers.ts, src/runtime.ts, any src/tools/*, any other test file
  (optionally test/settings.test.ts for a regression assertion — Task 6).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After editing src/config.ts (and before touching tests):
npm run typecheck        # = tsc --noEmit (strict mode, ESNext). MUST be clean.
# Expected: zero errors. If tsc complains about the new import, the nonGitMode literal-union
# type, or coerceStorageDir/coerceExcludeGlobs signatures, fix before proceeding.
# (This repo uses tsc, NOT ruff/mypy — those are Python tools from the template and DO NOT APPLY.)
```

> NOTE: this is a TypeScript + vitest project. There is no ruff/mypy/eslint configured
> (package.json scripts: `test`, `typecheck`, `smoke`, `prepublishOnly`). Use `npm run typecheck`
> for the syntax/type gate and `npm test` for the behavioral gate. Do not invent lint commands.

### Level 2: Unit Tests (Component Validation)

```bash
# Run the config suite specifically after Task 5:
npx vitest run test/config.test.ts
# Expected: ALL green, including the two UPDATED whole-config literals and the new revert block.

# Full suite (catches accidental regressions from the DEFAULT_CONFIG shape change):
npm test                 # = vitest run (all test files)
# Expected: all green. If a non-config test fails on a DEFAULT_CONFIG toEqual, that test ALSO
# needs the revert block added to its literal — search: grep -rn "toEqual(DEFAULT_CONFIG)" test/
# and grep -rn "\.revert" test/ to find any other consumer. (self-referential toEqual(DEFAULT_CONFIG)
# cases are fine; only EXPLICIT object literals need updating.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Confirm the runtime handoff still works (config.ts → setConfig → getConfig):
# This is exercised by test/config.test.ts "getConfig / setConfig cache" + the new revert (i) case.
# No service to start (this is a pi extension, not a server). Level 3 here = the full `npm test` pass.

# If you want a live sanity check that getConfig().revert is reachable from the extension entry:
node --input-type=module -e "
  import('./src/config.js').then(({ getConfig }) => {
    const r = getConfig().revert;
    console.log(JSON.stringify(r));
    console.assert(r.enabled === false && r.nonGitMode === 'cas' && r.excludeGlobs.length === 7, 'defaults ok');
  });
"
# Expected: prints the 8-field revert object and 'defaults ok' (no assertion error).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Adversarial-input safety (the NEVER-throw guarantee — spec/09 §4):
node --input-type=module -e "
  import('./src/config.js').then(({ validateConfig }) => {
    const circular = {}; circular.self = circular;
    const throwingProxy = new Proxy({}, { get(){ throw new Error('boom'); } });
    validateConfig(circular); validateConfig(throwingProxy);
    validateConfig({ revert: new Proxy({ enabled: 'x' }, { get(){ throw 1; } }) });
    console.log('adversarial OK — no throw');
  });
"
# Expected: 'adversarial OK — no throw'. (The outer try/catch in validateConfig covers all of these.)

# storageDir cross-platform sanity (run where process.cwd() is the repo root):
node --input-type=module -e "
  import('./src/config.js').then(({ validateConfig }) => {
    console.log('inside  :', validateConfig({ revert: { storageDir: './local' } }).revert.storageDir);   // null
    console.log('cwd-eq  :', validateConfig({ revert: { storageDir: process.cwd() } }).revert.storageDir);// null
    console.log('tmp     :', validateConfig({ revert: { storageDir: '/tmp/m' } }).revert.storageDir);     // /tmp/m
    console.log('null    :', validateConfig({ revert: { storageDir: null } }).revert.storageDir);         // null (no warn)
  });
"
# Expected: inside→null, cwd-eq→null, tmp→'/tmp/m', null→null.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` is clean (no TS errors from the new import, types, or helpers).
- [ ] `npm test` passes (full suite) — including the 2 updated whole-config literals.
- [ ] `npx vitest run test/config.test.ts` — the new revert describe block is fully green.

### Feature Validation

- [ ] `getConfig().revert` returns all 8 fields at the spec/14 §8 defaults.
- [ ] `validateConfig({}).revert` warns ZERO times (absent fields never warn — GOTCHA #3).
- [ ] Each present-but-invalid field → its default + exactly one warn naming `revert.<field>`.
- [ ] `storageDir` resolving inside `process.cwd()` → `null` + warn (GOTCHA #5).
- [ ] Non-record `revert` value → whole block silently defaulted (matches ui/audit/shrink).
- [ ] `validateConfig` never throws on circular/Proxy/adversarial input (GOTCHA #4).
- [ ] `DEFAULT_CONFIG` is not mutated by validation (the structuredClone guard holds).

### Code Quality Validation

- [ ] The revert block mirrors the shrink/ui/log block structure verbatim (safeGet→isRecord→per-field).
- [ ] JSDoc on the block + each field cites `@14 §8` and `spec/09 §2/§3` (Mode A docs ride WITH the work).
- [ ] The 3 new helpers sit under the private-helpers section, named `coerce*`, not exported.
- [ ] No new files created; no changes to settings.ts/index.ts/markers.ts/runtime.ts/tools.

### Documentation & Deployment

- [ ] Field-level JSDoc is self-documenting (defaults + spec citations inline).
- [ ] No new environment variables introduced.

---

## Anti-Patterns to Avoid

- ❌ Don't add a try/catch INSIDE the revert validation section — the outer try/catch in
  `validateConfig` already guarantees never-throw (GOTCHA #4).
- ❌ Don't warn on ABSENT fields — the `v !== undefined` guard skips them silently (GOTCHA #3).
  Only present-but-invalid values warn.
- ❌ Don't hardcode the number defaults inside the coerce calls — pass `cfg.revert.<field>`
  (the cloned default) as the fallback so deep-merge semantics hold (GOTCHA #6).
- ❌ Don't import anything from Pi in config.ts — it stays Pi-free. Node built-ins (node:path)
  are allowed and already used in settings.ts (GOTCHA #2).
- ❌ Don't use `>=0` for the revert numbers — they are thresholds, must be `>0`
  (coerceNumber `mustBePositive:true`). Boundary 1 is valid.
- ❌ Don't forget GOTCHA #1 — the two existing whole-config `toEqual` literals MUST get the
  revert default block added or `npm test` fails on pre-existing tests.
- ❌ Don't expand scope: no snapshot/, no marker/runtime/tool changes, no settings.ts edits.
  Those are P1.M2 / P3 / P4. This task is the config contract only.
- ❌ Don't add `autoOnBloat`-style reserved fields — implement EXACTLY the 8 specified fields.

---

## Confidence Score: 9/10

**Why high**: The task is config-only in a single well-understood file with a verbatim pattern
to copy (the `shrink` block). Every field default and validation rule is pinned in
`spec/09 §2/§3/§4` and `spec/14 §8`, and the helper signatures already exist
(`coerceBoolean`/`coerceNumber`/`warnConfig`/`isRecord`/`safeGet`). The three new helpers are
1:1 analogs of existing ones (`coerceEstimateConfidence`, `coerceLogFile`, `coerceProtectedRoles`).

**Residual risk (the 1 point)**: the `storageDir` inside-cwd predicate is the one piece with
no direct precedent in the file — the PRP gives the exact cross-platform idiom
(`resolve`/`relative`/`isAbsolute`), but the implementer must use `process.cwd()` (not `ctx.cwd`,
which config.ts doesn't have) and must use an absolute-outside-repo path (e.g. `os.tmpdir()`) in
the "valid" test case. Mitigated by Level 4's concrete storageDir sanity script.