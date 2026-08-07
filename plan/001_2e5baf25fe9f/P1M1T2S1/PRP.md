# PRP — P1.M1.T2.S1: Define `MulliganConfig` interface and `DEFAULT_CONFIG` constant

**Work item:** P1.M1.T2.S1 · **Points:** 0.5 · **Stage:** Foundation & Infrastructure (Configuration System)
**Scope:** Create exactly ONE file — `src/config.ts` — exporting two type aliases (`Granularity`,
`EstimateConfidence`), one JSDoc-documented interface (`MulliganConfig`), and one runtime constant
(`DEFAULT_CONFIG`). **No `getConfig()`, no validation logic, no Pi-settings reading, no handlers.**

---

## Goal

**Feature Goal**: Establish the complete, type-safe public configuration surface for pi-mulligan as
a single self-contained TypeScript module (`src/config.ts`) whose shapes match `spec/09-configuration.md`
§2 and `spec/04-data-model.md` §7 **exactly** (field names, casing, optionality, defaults), so that
every downstream module (S2 `getConfig`, the tools, the filter, the nudges) imports one source of
truth and so that `tsc --noEmit` deterministically proves the constant is assignable to the interface.

**Deliverable**: One file, `src/config.ts`, exporting:
1. `export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";`
2. `export type EstimateConfidence = "low" | "medium" | "high";`
3. `export interface MulliganConfig { … }` — with Mode-A JSDoc on every field/section.
4. `export const DEFAULT_CONFIG: MulliganConfig = { … }` — all spec defaults, typed-annotated so
   `tsc` verifies the literal matches the interface.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits 0 (deterministic type-check; no model needed). This is
  the primary gate and it ALSO proves `DEFAULT_CONFIG` is assignable to `MulliganConfig`.
- The exported field names/types/defaults match `spec/09-configuration.md` §2 character-for-character
  (verified by the Level 1 `grep` checks and the optional Level 2 deep-equality test).
- No other files are created or modified by this subtask (the optional `test/config.test.ts` aside).

---

## User Persona

**Target User**: (a) The implementing AI agent for **S2** (`getConfig()`) and every later module, and
(b) the human end user who writes a `"mulligan": { … }` block in `settings.json`.

**Use Case**: Every later subtask that branches on config (`mulligan_rewind` reads
`config.rewind.enabled`, the filter reads `config.rewind.protectedRoles`/`maxDepth`, the bloat nudge
reads `config.nudges.bloatThresholdBytes`, the audit tool reports `config.audit.estimateConfidence`,
etc.) imports these types so the compiler catches field-name/casing typos at build time rather than
at runtime in a broken agent turn. The human, in turn, gets a stable, documented configuration
surface whose defaults "just work" with zero config.

**User Journey**:
1. Implementer creates `src/config.ts` (verbatim content in Task 1).
2. Runs `tsc --noEmit` → must exit 0 (the `: MulliganConfig` annotation proves assignability).
3. (Optional) Runs `vitest run test/config.test.ts` → asserts every default value.
4. Hands a typed, defaulted config module to S2 (`getConfig`) and downstream.

**Pain Points Addressed**: Without a single typed config module, each consumer would re-declare the
shape locally, drifting on field names/casing (e.g. `bloatThresholdBytes` vs `bloat_threshold_bytes`)
— the LLM's reliable tool use and the filter's correctness depend on these strings being exact.
Defining the interface + frozen defaults up front also forces a completeness decision NOW (e.g.
"should `autoOnBloat` exist?") rather than mid-build.

---

## Why

- **Single source of truth for the public configuration surface.** `spec/09-configuration.md` §2 is
  the authoritative schema; `spec/04-data-model.md` §7 re-states it for co-location. Both are
  reproduced into ONE typed module here so downstream code imports a name, not a JSON snippet.
- **Locks the v1 scope of config.** A completeness cross-check (grep across all 12 spec docs — see
  *Context*) confirms every downstream `config.*` reference resolves to a §2 field **except**
  `config.shrink.autoOnBloat`, which `spec/07` line 61 explicitly marks **"not in v1."** Encoding
  the interface WITHOUT `autoOnBloat` here prevents a future module from accidentally depending on
  an unbuilt knob.
- **Makes `DEFAULT_CONFIG` compiler-verified.** Typing the constant as `MulliganConfig` turns a
  silent typo (e.g. `maxDepth: 5` vs `maxdepth: 5`, or a wrong default) into a hard `tsc` error — a
  cheap, deterministic correctness gate for the zero-config promise (design principle: "the
  extension works with zero configuration").
- **Sets up S2 cleanly.** S2 (`getConfig`) only has to implement read/validate/coerce/merge against
  `Partial<MulliganConfig>` + `DEFAULT_CONFIG`; the shapes are already proven. This subtask is the
  contract S2 consumes.

---

## What

Create `src/config.ts` with the exact exports shown in Task 1. The module is **pure TypeScript types
+ one constant** — it imports nothing at runtime (not even `@earendil-works/pi-coding-agent`), because
the config shape is Mulligan-local (Pi's own `Settings` type is a closed interface that does not
know about `"mulligan"`; see *Gotchas*). JSDoc (Mode A) documents every field and its default.

This subtask does **NOT** create: `getConfig()` (S2), any validation/coercion logic (S2), any read
of Pi `settings.json` (S2), `log.ts`/`runtime.ts` (T3/T4), any handler/tool (P1.M4/P1.M5), or the
README. The optional `test/config.test.ts` is a recommended regression test, not a contract artifact.

### Success Criteria

- [ ] `src/config.ts` exists and exports exactly: `Granularity`, `EstimateConfidence`, `MulliganConfig`,
      `DEFAULT_CONFIG` — nothing more.
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `MulliganConfig` field names/types/defaults match `spec/09-configuration.md` §2 exactly
      (verified by the Level 1 grep checks; optional Level 2 deep-equality test).
- [ ] `shrink` contains ONLY `enabled` (no `autoOnBloat` — reserved, not v1).
- [ ] `DEFAULT_CONFIG` is declared with an explicit `: MulliganConfig` annotation (so `tsc` verifies it).
- [ ] (Recommended) `test/config.test.ts` asserts the full default shape and exits green.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement
> this successfully?"_ — **Yes.** The exact file content (types, JSDoc, constant) is given verbatim
> in Task 1, the authoritative schema is `spec/09-configuration.md` §2 (reproduced & cross-checked
> against `spec/04-data-model.md` §7), every default value is pinned, and the validation gate
  (`tsc --noEmit`) is deterministic and proven executable in this scaffold (S1 + S2 delivered a
  non-empty `src/`, so TS18003 is already resolved). No prior codebase knowledge is required beyond
  "the S1/S2 scaffold (package.json/tsconfig.json/node_modules/src/index.ts) exists."

### Documentation & References

```yaml
# MUST READ — authoritative sources for this module
- file: spec/09-configuration.md
  why: "§2 schema & defaults (THE authoritative config block — copy field names, casing, defaults
        verbatim). §3 per-knob rationale (drives JSDoc wording). §4 validation rules (S2's job, but
        confirms the known protectedRoles selectors = 'first:user' | 'latest:user' and the
        estimateConfidence enum)."
  pattern: "MulliganConfig interface + DEFAULT_CONFIG mirror the §2 JSONC exactly, minus the
            wrapping 'mulligan' key."
  critical: "§2 default for protectedRoles is ['first:user','latest:user'] (NOT the loose
             'user' prose in spec/04 §7's comment). §4 confirms only those two selectors are known
             in v1. autoOnBloat is commented-out in §2 and explicitly excluded in spec/07 — OMIT it."

- file: spec/04-data-model.md
  why: "§7 is the co-located TS form of MulliganConfig (cross-check against §09). §3 RewindMarker
        shows the persisted marker's granularity is the NARROWER 2-value union
        ('last_tool_call_group'|'last_turn') — but THIS subtask exports the 3-value Granularity
        (the tool-facing superset incl. 'checkpoint'); markers.ts (P1.M4) derives the narrow form."
  pattern: "interface MulliganConfig { enabled; rewind{enabled,protectedRoles,maxDepth,requireMutationWarning};
            shrink{enabled}; nudges{bloatReminder,perTurnDrift,bloatThresholdBytes,driftThresholdTokens};
            audit{estimateConfidence}; log{file} }"

- file: spec/05-tools.md
  why: "§1 RewindParams.granularity = Type.Union(['last_tool_call_group','last_turn','checkpoint']) —
        confirms the exported Granularity has 3 values. §4 mulligan_audit report shows
        'confidence: medium' — confirms EstimateConfidence is consumed by the audit tool."
  gotcha: "The TOOL param is 3-value; the PERSISTED marker (spec/04 §3) is 2-value. Export the
           3-value superset here; do not narrow it."

- file: spec/12-glossary.md
  why: "Line 18: 'Granularity — the unit a rewind targets: last_tool_call_group, last_turn, or
        checkpoint.' Definitive 3-value definition."

- file: spec/11-build-order.md
  why: "§1 file layout puts this at src/config.ts ('load + validate + default settings'). §2 Step 1
        names config.ts + log.ts + runtime.ts together; THIS subtask owns ONLY the interface +
        DEFAULT_CONFIG (the 'default settings' half); getConfig (the 'load + validate' half) is S2."

- file: plan/001_2e5baf25fe9f/P1M1T1S2/PRP.md
  why: "THE CONTRACT for this subtask's INPUT. S2 delivered src/index.ts (a no-op stub importing
        type ExtensionAPI). config.ts is NOT imported by that stub yet — it will be wired by
        P1.M7.T1. So adding config.ts cannot break the S2 load path; the only gate is tsc."
  pattern: "config.ts co-exists with index.ts under src/; both covered by tsconfig include:['src']."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  why: "§3.1 confirms ExtensionContext has NO settings/getSettings accessor, and § (Settings type)
        note: Pi's Settings interface is closed (no index signature, no 'mulligan' key). This is an
        S2 concern (how getConfig reads settings), but it confirms S1's module must stay
        dependency-free: the types are Mulligan-local, NOT imported from Pi."
  critical: "Do NOT try to augment Pi's Settings type here. MulliganConfig is a standalone local
             interface. S2 will cast settings.mulligan as Partial<MulliganConfig>."
```

### Current Codebase tree (state at this subtask's start — S1+S2 delivered)

```bash
pi-mulligan/
├── package.json            # S1 — main:'src/index.ts', pi.extensions, deps, devDeps (incl. @types/node)
├── tsconfig.json           # S1 — strict, noImplicitAny, types:['node'], include:['src','test'], skipLibCheck
├── package-lock.json       # S1 — tracked
├── node_modules/           # S1 — @earendil-works/pi-coding-agent + typebox + @types/node resolve at top level
├── .pi/extensions/         # S1/S2 — empty (project-local auto-discovery dir)
├── src/
│   ├── index.ts            # S2 — no-op default-export factory (imports type ExtensionAPI only)
│   └── tools/              # S1 — empty (tools/* arrive in P1.M5)
├── test/                   # S1 — empty (tests arrive in P1.M2+)
│   └── integration/        # S1 — empty (smoke.ts/scenarios.md arrive in P1.M7)
├── .gitignore              # existing — ignores node_modules/, dist/, build/
├── plan/                   # orchestration (read-only)
└── spec/                   # 12-doc spec (read-only)
```

### Desired Codebase tree with files to be added (THIS subtask)

```bash
pi-mulligan/
└── src/
    └── config.ts           # NEW (Task 1) — Granularity, EstimateConfidence, MulliganConfig (+JSDoc), DEFAULT_CONFIG
# RECOMMENDED (Task 2, optional): test/config.test.ts — default-shape regression test (S2 extends it)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — `shrink.autoOnBloat` is RESERVED, NOT v1
# spec/09 §2 shows it COMMENTED OUT; spec/07 line 61 says "Auto-shrink is a future opt-in mode
# (config.shrink.autoOnBloat, **not in v1**)." A repo-wide grep confirms it is the ONLY config.*
# reference absent from the §2 schema. OMIT it from both MulliganConfig and DEFAULT_CONFIG.
# Adding it now would imply a knob that no v1 code honors → misleading public surface.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — protectedRoles default is ["first:user","latest:user"], NOT ["user",...]
# spec/04 §7's COMMENT uses loose prose ("['user' (first), 'user' (latest)]") describing the ROLES.
# spec/09 §2 (authoritative for config) + spec/09 §4 (known selectors) + the item description all
# use the exact selector strings "first:user" and "latest:user". Use those exact strings.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — Granularity is 3 values; the persisted marker uses only 2
# Export Granularity = "last_tool_call_group" | "last_turn" | "checkpoint" (tool-facing superset,
# per spec/05 §1 RewindParams + spec/12 glossary). spec/04 §3 RewindMarker.granularity is the
# NARROWER 2-value form (no checkpoint — checkpoints resolve via a different path). markers.ts
# (P1.M4.T1) will reuse this export, e.g. `Exclude<Granularity, "checkpoint">`. Do NOT narrow
# Granularity here.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — type the constant explicitly; do NOT use bare `as const`
# `export const DEFAULT_CONFIG: MulliganConfig = {...}` makes tsc VERIFY the literal matches the
# interface (catches typos / wrong defaults — a free correctness gate). Bare `as const` would
# narrow field types to literals (e.g. maxDepth: 5 instead of number) and is NOT assignable to
# MulliganConfig. If you also want immutability, `Object.freeze`/`as const` is an option, but keep
# the `: MulliganConfig` annotation first; the spec interface fields are non-readonly, so plain
# annotation is the spec-faithful choice.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — config.ts has ZERO runtime Pi dependency; do NOT import from pi-coding-agent
# MulliganConfig is a Mulligan-local interface. Pi's Settings type (settings-manager.d.ts) is a
# CLOSED interface with no index signature and no "mulligan" key — it cannot be augmented cleanly,
# and ExtensionContext exposes no settings accessor anyway. So config.ts imports NOTHING at runtime.
# (S2 will read settings via an `unknown`/Partial<MulliganConfig> cast — that is S2's concern, not
# this module's.) Keeping config.ts dependency-free means the tsc gate is purely about local types.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — EstimateConfidence must be CONSUMED, not just declared
# MulliganConfig.audit.estimateConfidence: EstimateConfidence (use the type alias on the field, not
# the inline "low"|"medium"|"high"). This guarantees the exported alias is referenced and gives S2
# + the audit tool a single name.
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — DEFAULT_CONFIG is a shared singleton; JSDoc it "do not mutate"
# Later modules must treat DEFAULT_CONFIG as read-only. S2's getConfig() MUST deep-clone before
# merging user overrides (a `structuredClone(DEFAULT_CONFIG)` or per-section spread), or a caller
# could mutate the shared default for the whole session. S1 need not freeze the object, but the
# JSDoc on DEFAULT_CONFIG must say "constant — getConfig returns a merged copy, never this object."
# ────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — JSON-serializable shapes only
# Every field type is JSON-compatible (boolean, number, string, string[], string|null, and the
# literal-union aliases). This is required because config round-trips through settings.json (JSON)
# and through the JSONL log. Avoid `Date`, `Map`, functions, symbols, etc. log.file is `string | null`
# (null = off), NOT `string | undefined` — match the spec.
# ────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

The entire deliverable IS the data model — three exported types and one constant. They are given
verbatim in Task 1. No runtime logic, no state, no side effects.

**Shape summary** (mirrors `spec/09-configuration.md` §2 minus the wrapping `mulligan` key):

```
MulliganConfig
├── enabled: boolean                                    // default true
├── rewind: { enabled, protectedRoles: string[], maxDepth: number, requireMutationWarning: boolean }
├── shrink: { enabled: boolean }                        // NOTE: autoOnBloat OMITTED (not v1)
├── nudges: { bloatReminder, perTurnDrift, bloatThresholdBytes: number, driftThresholdTokens: number }
├── audit: { estimateConfidence: EstimateConfidence }   // default "medium"
└── log: { file: string | null }                        // default null (off)

Granularity          = "last_tool_call_group" | "last_turn" | "checkpoint"
EstimateConfidence   = "low" | "medium" | "high"
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/config.ts   (the ONE contract deliverable)
  - PRECONDITION: S1+S2 scaffold exists. Verify:
        test -f package.json && test -f tsconfig.json && test -d node_modules/@earendil-works/pi-coding-agent && test -f src/index.ts
    (all must pass). If node_modules is missing, run `npm install` first.
  - WRITE the exact file content below (verbatim). Use the `: MulliganConfig` annotation on
    DEFAULT_CONFIG (GOTCHA #4). Add Mode-A JSDoc to EVERY field and section (the contract's DOCS
    requirement: "this is the public configuration surface"). Consume EstimateConfidence on the
    audit field and the 3-value Granularity alias (GOTCHAs #3, #6). OMIT autoOnBloat (GOTCHA #1).
  - FIELD CHECKLIST after writing (each must be present, exact name + type + default):
      * export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";
      * export type EstimateConfidence = "low" | "medium" | "high";
      * interface MulliganConfig { enabled; rewind{enabled,protectedRoles,maxDepth,requireMutationWarning};
        shrink{enabled}; nudges{bloatReminder,perTurnDrift,bloatThresholdBytes,driftThresholdTokens};
        audit{estimateConfidence}; log{file} }   (exact field names/casing)
      * audit.estimateConfidence typed as EstimateConfidence (NOT inline union)
      * log.file typed as string | null
      * const DEFAULT_CONFIG: MulliganConfig with: enabled=true; rewind={enabled:true,
        protectedRoles:["first:user","latest:user"], maxDepth:5, requireMutationWarning:true};
        shrink={enabled:true}; nudges={bloatReminder:true, perTurnDrift:true,
        bloatThresholdBytes:8192, driftThresholdTokens:3000}; audit={estimateConfidence:"medium"};
        log={file:null}
      * NO `autoOnBloat` anywhere in the file
      * NO runtime imports (no `import … from "@earendil-works/..."`, no `import { Type }`)
      * JSDoc (`/** … */`) on MulliganConfig, each nested object section, and each leaf field
  - NAMING/PLACEMENT: file at repo-root `src/config.ts`. CamelCase for types/interface; the nested
    config keys are the spec's exact lowerCamelCase JSON keys (enabled, protectedRoles, maxDepth,
    requireMutationWarning, bloatReminder, perTurnDrift, bloatThresholdBytes, driftThresholdTokens,
    estimateConfidence, file). Do NOT snake_case any of them.
  - EXACT CONTENT (copy verbatim; JSDoc may be expanded but field names/types/values must be exact):

    /**
     * Granularity — the unit a rewind targets.
     * - "last_tool_call_group": hide just the most recent tool interaction (surgical).
     * - "last_turn":            hide everything after the most recent user message (redo the turn).
     * - "checkpoint":           hide back to a named checkpoint set via mulligan_checkpoint.
     * Source: spec/12-glossary.md §Granularity, spec/05-tools.md §1 (RewindParams).
     */
    export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";

    /**
     * EstimateConfidence — honesty label reported alongside token estimates.
     * Token accounting is approximate; this conveys how approximate. Default "medium".
     * Source: spec/04-data-model.md §7, spec/09-configuration.md §2.
     */
    export type EstimateConfidence = "low" | "medium" | "high";

    /**
     * MulliganConfig — the shape of the `"mulligan"` object read from Pi `settings.json`
     * (global `~/.pi/agent/settings.json` and/or project-local `<project>/.pi/settings.json`,
     * project-local overriding global). Every option has a safe default; the extension works with
     * zero configuration. Unknown keys are ignored; type-mismatched values fall back to the
     * default (handled by getConfig in config.ts S2). Source of truth: spec/09-configuration.md.
     */
    export interface MulliganConfig {
      /** Master switch. false → the entire extension is a no-op (no context transform, tools
       *  refuse cleanly). Default: true. */
      enabled: boolean;

      /** Rewind operation (`mulligan_rewind`) settings. */
      rewind: {
        /** Enable the rewind tool/feature. Default: true. */
        enabled: boolean;
        /** Message selectors that can never be rewound past. v1 known selectors: "first:user"
         *  (the original task) and "latest:user" (the current ask). Unknown entries ignored.
         *  Default: ["first:user", "latest:user"]. */
        protectedRoles: string[];
        /** Max simultaneous active mulligan:rewind markers on a branch. Bounds marker
         *  accumulation (markers are permanent). Default: 5. */
        maxDepth: number;
        /** If true, the rewind tool appends a warning when the hidden span contained write /
         *  side-effecting tool calls (those effects PERSIST on disk). Default: true. */
        requireMutationWarning: boolean;
      };

      /** Shrink operation (`mulligan_shrink`) settings. */
      shrink: {
        /** Enable the shrink tool/feature. Default: true. */
        enabled: boolean;
        // NOTE: "autoOnBloat" is reserved for a FUTURE opt-in mode and is NOT in v1
        //       (spec/07 §nudges: "Auto-shrink would risk data loss"). Do not add it.
      };

      /** Preventive nudge settings (advisory; ride inferences that were already happening). */
      nudges: {
        /** Annotate a tool_result when a single result exceeds bloatThresholdBytes. Default: true. */
        bloatReminder: boolean;
        /** Inject a one-line context drift nudge when a turn grew past driftThresholdTokens.
         *  Default: true. */
        perTurnDrift: boolean;
        /** In-context byte size of a single tool result above which the bloat reminder fires.
         *  Below Pi's ~50 KB built-in cap to catch meaningful-but-not-catastrophic results.
         *  Must be > 0. Default: 8192 (8 KB). */
        bloatThresholdBytes: number;
        /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
         *  Default: 3000. */
        driftThresholdTokens: number;
      };

      /** Audit tool (`mulligan_audit`) settings. */
      audit: {
        /** Confidence label reported with token estimates. Default: "medium". */
        estimateConfidence: EstimateConfidence;
      };

      /** Structured logging settings (the primary observability surface in non-TUI modes). */
      log: {
        /** Absolute path to an append-only JSONL debug log, or null to disable. If set, opening
         *  is deferred to first write and wrapped so a bad path never crashes the extension.
         *  Default: null (off). */
        file: string | null;
      };
    }

    /**
     * DEFAULT_CONFIG — the zero-configuration defaults for MulliganConfig.
     * CONSTANT: do not mutate. getConfig() (S2) returns a freshly-merged copy built atop this
     * object (deep-cloned before user overrides are applied), never this object itself.
     * Source of truth: spec/09-configuration.md §2.
     */
    export const DEFAULT_CONFIG: MulliganConfig = {
      enabled: true,
      rewind: {
        enabled: true,
        protectedRoles: ["first:user", "latest:user"],
        maxDepth: 5,
        requireMutationWarning: true,
      },
      shrink: {
        enabled: true,
      },
      nudges: {
        bloatReminder: true,
        perTurnDrift: true,
        bloatThresholdBytes: 8192,
        driftThresholdTokens: 3000,
      },
      audit: {
        estimateConfidence: "medium",
      },
      log: {
        file: null,
      },
    };

Task 2 (RECOMMENDED, not strictly required by the contract): CREATE test/config.test.ts
  - RATIONALE: a deep-equality regression test locks the defaults against spec drift and gives the
    tsc gate a behavioral companion. S2 will EXTEND this same file with getConfig tests, so creating
    it now is forward-compatible (do not duplicate it in S2). vitest is already configured (S1).
  - WRITE the exact content below. It asserts (a) every default value and (b) that the exported
    types type-check (compile-time), proving the public surface.
  - PLACEMENT: repo-root `test/config.ts` is reserved for the module; this test goes in
    `test/config.test.ts` (vitest discovers `**/*.test.ts`).
  - EXACT CONTENT:
    import { describe, it, expectTypeOf, expect } from "vitest";
    import {
      DEFAULT_CONFIG,
      type MulliganConfig,
      type Granularity,
      type EstimateConfidence,
    } from "../src/config.js";

    describe("DEFAULT_CONFIG", () => {
      it("matches the spec/09 §2 defaults exactly", () => {
        expect(DEFAULT_CONFIG).toEqual({
          enabled: true,
          rewind: {
            enabled: true,
            protectedRoles: ["first:user", "latest:user"],
            maxDepth: 5,
            requireMutationWarning: true,
          },
          shrink: { enabled: true },           // no autoOnBloat (not v1)
          nudges: {
            bloatReminder: true,
            perTurnDrift: true,
            bloatThresholdBytes: 8192,
            driftThresholdTokens: 3000,
          },
          audit: { estimateConfidence: "medium" },
          log: { file: null },
        });
      });

      it("is assignable to MulliganConfig (type-level)", () => {
        expectTypeOf(DEFAULT_CONFIG).toMatchTypeOf<MulliganConfig>();
      });

      it("exports the 3-value Granularity and 3-value EstimateConfidence (type-level)", () => {
        expectTypeOf<Granularity>().toEqualTypeOf<"last_tool_call_group" | "last_turn" | "checkpoint">();
        expectTypeOf<EstimateConfidence>().toEqualTypeOf<"low" | "medium" | "high">();
      });
    });
  - GOTCHA: the import path `../src/config.js` — vitest resolves `.js` to the `.ts` source under
    moduleResolution "Bundler"/ESM (S1 tsconfig). If your vitest config differs, use `../src/config`.
    `expectTypeOf` is a vitest API (zero-cost type assertion); it requires vitest ^1 (S1 pinned ^1).

Task 3: VALIDATE  (no file changes — run the gates in the Validation Loop)
  - Level 1 (tsc, deterministic — THE primary gate) and, if Task 2 was done, Level 2 (vitest).
  - Levels 3 & 4 N/A (config.ts is not yet imported by the extension; no runtime surface to test).
```

### Implementation Patterns & Key Details

```ts
// ── PATTERN: module-local typed config surface (no Pi import) ──────────────
// config.ts defines MulliganConfig locally. Pi's own Settings type is closed and has no
// "mulligan" key (settings-manager.d.ts), and ExtensionContext exposes no settings accessor
// (api_verification.md §3.1). So this module imports NOTHING at runtime. S2 will bridge Pi
// settings → MulliganConfig via a Partial<MulliganConfig> cast; that is not this module's job.

// ── PATTERN: typed constant for compiler-verified defaults ─────────────────
export const DEFAULT_CONFIG: MulliganConfig = { /* … */ };
//   The `: MulliganConfig` annotation is the gate: tsc rejects a typo'd field name, a wrong
//   default, or a missing/extra property. Do NOT drop the annotation and do NOT use bare `as const`
//   (which narrows literals and breaks assignability). (GOTCHA #4)

// ── PATTERN: consume the alias types, don't re-inline them ─────────────────
export type EstimateConfidence = "low" | "medium" | "high";
// …
export interface MulliganConfig {
  audit: { estimateConfidence: EstimateConfidence };  // ← use the alias, not the inline union
}
//   This keeps a single name and guarantees the exported alias is referenced. (GOTCHA #6)

// ── PATTERN: Granularity is the tool-facing superset (3 values) ────────────
export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";
//   The PERSISTED RewindMarker (spec/04 §3) uses only the first two. markers.ts (P1.M4) will
//   derive its narrower type, e.g.:  type RewindGranularity = Exclude<Granularity, "checkpoint">;
//   Export the 3-value superset here as the single source of truth. (GOTCHA #3)

// ANTI-PATTERN (do NOT do any of these):
//   - import { Type } from "typebox"                       // config.ts is pure types + a constant
//   - import { … } from "@earendil-works/pi-coding-agent"  // no runtime Pi dependency (GOTCHA #5)
//   - export function getConfig(...) { … }                 // that is S2 (this subtask = types + const)
//   - shrink: { enabled: true, autoOnBloat: false }        // RESERVED, not v1 (GOTCHA #1)
//   - protectedRoles: ["user", "user"]                     // wrong; use "first:user","latest:user" (GOTCHA #2)
//   - const DEFAULT_CONFIG = { … } as const                // narrows literals; not assignable (GOTCHA #4)
//   - log: { file: undefined }                             // spec says string | null; default null (GOTCHA #8)
//   - snake_case keys (bloat_threshold_bytes)              // spec uses lowerCamelCase JSON keys
```

### Integration Points

```yaml
MODULE PLACEMENT:
  - file: src/config.ts   (spec/11-build-order.md §1 src/ tree; "config.ts // load + validate + default settings")
  - this subtask owns: the interface + DEFAULT_CONFIG (the "default settings" half)
  - S2 (P1.M1.T2.S2) owns: getConfig() (the "load + validate" half), ADDED to the SAME file

DOWNSTREAM CONSUMERS (created by LATER subtasks — do NOT create here):
  - P1.M1.T2.S2 getConfig()      → merges Partial<MulliganConfig> over a deep-cloned DEFAULT_CONFIG
  - P1.M4.T2 filter.ts           → reads config.rewind.{enabled,protectedRoles,maxDepth},
                                   config.shrink.enabled, config.enabled
  - P1.M5 tools/*                → read config.rewind.enabled, config.shrink.enabled,
                                   config.rewind.requireMutationWarning, config.audit.estimateConfidence
  - P1.M6 nudges.ts              → reads config.nudges.{bloatReminder,perTurnDrift,
                                   bloatThresholdBytes,driftThresholdTokens}
  - P1.M4.T1 markers.ts          → reuses Granularity via Exclude<Granularity,"checkpoint"> for
                                   the persisted RewindMarker.granularity (spec/04 §3)
  - P1.M7.T1 index.ts            → wires getConfig() (not this module directly) into the factory

CONFIG / DATABASE / ROUTES:
  - none at runtime in THIS subtask. (S2 reads Pi settings.json "mulligan" key; no DB, no routes.)
  - no env vars introduced.
```

---

## Validation Loop

### Level 1: Syntax & Style (deterministic; no model — run after Task 1)

```bash
# (a) The file exists at the right path.
test -f src/config.ts && echo "FILE OK" || echo "FILE MISSING"

# (b) Required exports are present (each must print 1).
grep -c 'export type Granularity = "last_tool_call_group" | "last_turn" | "checkpoint";' src/config.ts   # expect 1
grep -c 'export type EstimateConfidence = "low" | "medium" | "high";' src/config.ts                       # expect 1
grep -c 'export interface MulliganConfig' src/config.ts                                                   # expect 1
grep -c 'export const DEFAULT_CONFIG: MulliganConfig' src/config.ts                                       # expect 1

# (c) Scope discipline: NO getConfig, NO Pi/typebox imports, NO autoOnBloat (each must print 0).
grep -cE 'getConfig|import .*(typebox|pi-coding-agent)' src/config.ts   # expect 0
grep -c 'autoOnBloat' src/config.ts                                     # expect 0  (GOTCHA #1)

# (d) Exact defaults are present (each must print 1).
grep -c 'protectedRoles: \["first:user", "latest:user"\]' src/config.ts   # expect 1  (GOTCHA #2)
grep -c 'maxDepth: 5,' src/config.ts                                     # expect 1
grep -c 'bloatThresholdBytes: 8192,' src/config.ts                       # expect 1
grep -c 'driftThresholdTokens: 3000,' src/config.ts                      # expect 1
grep -c 'estimateConfidence: "medium",' src/config.ts                    # expect 1
grep -c 'file: null,' src/config.ts                                      # expect 1

# (e) TYPE-CHECK — the primary gate. Proves (i) the file is type-sound, (ii) DEFAULT_CONFIG is
#     assignable to MulliganConfig (the `: MulliganConfig` annotation), (iii) EstimateConfidence is
#     consumed correctly on audit.estimateConfidence. Deterministic; needs NO model.
npx tsc --noEmit -p tsconfig.json && echo "TSC OK (exit 0)" || echo "TSC FAILED"
# Expected: "TSC OK (exit 0)". A failure here almost always means a field-name/casing/default typo
# or a type mismatch (e.g. log.file typed as undefined) — read the error, fix config.ts, re-run.
```

### Level 2: Unit Tests (run if Task 2 was done — recommended)

```bash
# Run the default-shape regression test (locks the spec defaults against drift).
npx vitest run test/config.test.ts
# Expected: 3 tests pass (deep-equality; MulliganConfig assignability; Granularity/EstimateConfidence
# type-shapes). If the deep-equality test fails, a default value diverges from spec/09 §2 — fix it.

# (If other test files do not yet exist, vitest may warn "no other test files" — that is fine.)
```

### Level 3: Integration Testing

> N/A for this subtask. `config.ts` is **not imported by the S2 stub** (`src/index.ts`), so there is
> no runtime surface to integration-test yet — `getConfig()` wiring and the extension consuming
> config arrive in S2 and P1.M7.T1 respectively. The deterministic Level 1 `tsc` gate is the
> authoritative proof this subtask is sound. (You MAY run `pi -e ./src/index.ts -p "hi"` as a
> regression check that the scaffold still loads, but it exercises index.ts, not config.ts.)

### Level 4: Creative & Domain-Specific Validation

```bash
# Confirm the exported defaults JSON-serialize cleanly (they must, since config round-trips through
# settings.json and the JSONL log — GOTCHA #8). This also produces a human-readable diff target.
node --input-type=module -e "
import { DEFAULT_CONFIG } from './src/config.ts';
console.log(JSON.stringify(DEFAULT_CONFIG, null, 2));
"
# Expected: valid JSON with exactly the spec/09 §2 defaults and NO undefined/`autoOnBloat` keys.
# (jiti handles the .ts import under Node ESM in this env; if it errors, run via `pi` or vitest.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1 passes: `test -f src/config.ts` (FILE OK); the four export `grep -c` checks each
      print 1; the scope-discipline `grep -c` checks (getConfig / Pi-typebox imports / autoOnBloat)
      each print 0; the six default `grep -c` checks each print 1; `npx tsc --noEmit -p tsconfig.json`
      prints "TSC OK (exit 0)".
- [ ] (If Task 2 done) Level 2 passes: `npx vitest run test/config.test.ts` → 3 tests green.
- [ ] `DEFAULT_CONFIG` carries an explicit `: MulliganConfig` annotation (GOTCHA #4) and `tsc`
      therefore proves it is assignable to the interface.

### Feature Validation (scope discipline)
- [ ] `src/config.ts` exports exactly `Granularity`, `EstimateConfidence`, `MulliganConfig`,
      `DEFAULT_CONFIG` — nothing more (no `getConfig`, no helpers).
- [ ] Field names/types/defaults match `spec/09-configuration.md` §2 character-for-character;
      `audit.estimateConfidence` uses the `EstimateConfidence` alias; `log.file` is `string | null`.
- [ ] `shrink` contains ONLY `enabled` (no `autoOnBloat` — GOTCHA #1).
- [ ] `Granularity` is the 3-value superset incl. `"checkpoint"` (GOTCHA #3).
- [ ] No files other than `src/config.ts` (and, optionally, `test/config.test.ts`) are created or
      modified; `index.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `plan/`, `spec/` untouched.

### Code Quality / Convention Validation
- [ ] No runtime imports (zero Pi/typebox dependency) — GOTCHA #5.
- [ ] Mode-A JSDoc on `MulliganConfig`, each nested section, and each leaf field (DOCS requirement).
- [ ] JSDoc on `DEFAULT_CONFIG` states it is a constant and that `getConfig()` returns a merged copy
      (GOTCHA #7); all shapes are JSON-serializable (GOTCHA #8).
- [ ] lowerCamelCase JSON keys preserved exactly (no snake_case).

### Documentation & Deployment
- [ ] No new env vars introduced.
- [ ] No user-facing docs in THIS subtask (the public README is P1.M7.T4); the JSDoc IS the
      configuration documentation for downstream implementers.

---

## Anti-Patterns to Avoid

- ❌ Don't implement `getConfig()` / validation / coercion — that is **S2** (this subtask = types + a
  constant). The build-order Step 1 splits "load + validate" (S2) from "default settings" (this).
- ❌ Don't import from `@earendil-works/pi-coding-agent` or `typebox` — `config.ts` is pure local
  types + a constant (GOTCHA #5). Pi's `Settings` type is closed and has no `mulligan` key.
- ❌ Don't add `shrink.autoOnBloat` — it is reserved for a future opt-in mode, explicitly **not v1**
  (GOTCHA #1; spec/07 line 61).
- ❌ Don't use `["user", "user"]` (or any non-selector string) for `protectedRoles` — the v1 known
  selectors are exactly `"first:user"` and `"latest:user"` (GOTCHA #2).
- ❌ Don't narrow `Granularity` to 2 values — export the 3-value tool-facing superset; the persisted
  marker's narrower type is derived later in markers.ts (GOTCHA #3).
- ❌ Don't drop the `: MulliganConfig` annotation on `DEFAULT_CONFIG`, and don't use bare `as const`
  — the annotation is the compile-time correctness gate (GOTCHA #4).
- ❌ Don't type `log.file` as `string | undefined` — the spec says `string | null`, default `null`
  (GOTCHA #8).
- ❌ Don't re-inline the `"low"|"medium"|"high"` union on `audit.estimateConfidence` — consume the
  exported `EstimateConfidence` alias so there is one name (GOTCHA #6).
- ❌ Don't mutate or hand out `DEFAULT_CONFIG` directly in later code — JSDoc it as constant; S2
  deep-clones before merging (GOTCHA #7).
- ❌ Don't create a second config file, register a tool/handler, or write the README — all out of
  scope (S2 / P1.M4 / P1.M5 / P1.M7.T4).
- ❌ Don't modify `package.json`, `tsconfig.json`, `.gitignore`, or anything in `plan/`/`spec/`
  (PRP rules — read-only).

---

## Confidence Score: 10/10

This is a single pure-TypeScript file whose entire content (types, JSDoc, constant) is given
verbatim, with every field name/type/default pinned to an authoritative source (`spec/09 §2`,
cross-checked against `spec/04 §7`, `spec/05 §1`, `spec/12 §18`). Every ambiguity has been resolved
first-hand:
- `protectedRoles` strings resolved via the item description + `spec/09 §2`/§4 (GOTCHA #2).
- `Granularity` cardinality resolved via the item description + glossary + tool schema (GOTCHA #3).
- `autoOnBloat` exclusion confirmed by a repo-wide spec grep (GOTCHA #1).
- `DEFAULT_CONFIG` assignability guaranteed by the explicit `: MulliganConfig` annotation, which the
  deterministic `tsc --noEmit` gate proves at compile time (no model, no provider dependency).
The module has zero runtime dependency, so the only failure mode is a transcription error (wrong
field name/casing/default) — all of which the Level 1 `grep` checks and the `tsc` gate catch
deterministically, and the optional Level 2 deep-equality test pins to the exact spec values.