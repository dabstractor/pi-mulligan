# PRP — P1.M1.T2.S2: `getConfig()` + `validateConfig()` + `setConfig()` (lazy cache, fail-safe validation)

**Work item:** P1.M1.T2.S2 · **Points:** 1 · **Stage:** Foundation & Infrastructure → Configuration System
**Scope:** **Append** to the existing `src/config.ts` (delivered by S1) — add a module-level cache plus
three exported functions (`getConfig`, `setConfig`, `validateConfig`) and a few **private** helpers. **Extend**
the existing `test/config.test.ts` with validation/cache test suites. **Do NOT modify** the S1 exports
(`Granularity`, `EstimateConfidence`, `MulliganConfig`, `DEFAULT_CONFIG`) — append below them.

---

## Goal

**Feature Goal**: Add the runtime half of the configuration system to `src/config.ts`: a **lazy, cached,
fail-safe** public API (`getConfig()` / `setConfig()`) backed by a pure validation engine
(`validateConfig(raw: unknown): MulliganConfig`) that deep-merges an unknown user settings object over a
**deep-cloned** `DEFAULT_CONFIG`, validates + coerces every known field exactly per `spec/09-configuration.md`
§4, ignores unknown keys, and **never throws** — on any error it returns a fresh clone of `DEFAULT_CONFIG`.

**Deliverable** (all added to the SAME file S1 created, `src/config.ts`, below `DEFAULT_CONFIG`):
1. `export function getConfig(): MulliganConfig` — lazy-init + cached + defensive-copy read API.
2. `export function setConfig(raw: unknown): void` — validate + replace the session cache (never throws).
3. `export function validateConfig(raw: unknown): MulliganConfig` — pure, fail-safe validation engine.
4. Private helpers: `isRecord`, `safeGet`, `coerceBoolean`, `coerceNumber`, `coerceProtectedRoles`,
   `coerceEstimateConfidence`, `coerceLogFile`, `warnConfig`, `safeStringify`, plus module-level `cachedConfig`.
5. **Extend** `test/config.test.ts` with `describe("validateConfig")` + `describe("getConfig / setConfig cache")`
   + `describe("getConfig lazy init")` suites (S1's `describe("DEFAULT_CONFIG")` stays unchanged).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (deterministic; proves the new code is type-sound and the
  S1 exports are untouched).
- `npx vitest run test/config.test.ts` is **all-green** (S1's 3 tests + the new suites), proving: partial
  merge, per-field coercion/validation, unknown-key ignoring, **never-throws** on adversarial input
  (circular refs, throwing `Proxy` getters), and that **`DEFAULT_CONFIG` is never mutated** and the cache
  is **never poisoned** by a caller.
- `validateConfig` is **pure** and **side-effect-free except `console.warn`** (config.ts still imports
  NOTHING from Pi — it stays a dependency-free module).

---

## User Persona

**Target User**: (a) The implementing AI agents for **every downstream module** (`filter.ts`, `tools/*`,
`nudges.ts`, `index.ts`), and (b) the human who writes a `"mulligan": { … }` block in `settings.json`.

**Use Case**: Every module that branches on config calls `getConfig()` once at entry and reads typed fields
(`if (!config.enabled) return;`, `config.nudges.bloatThresholdBytes`, `config.rewind.protectedRoles`, …).
`index.ts` calls `setConfig(settings.mulligan)` from its factory / `session_start` handler (and again on
`/reload`) to load merged user settings. A human's partial/typo'd/garbage `settings.json` must never crash
an agent turn — bad values silently fall back to safe defaults with a warn.

**User Journey**:
1. Pi loads the extension; `index.ts` factory extracts `settings.mulligan` (cast `unknown`) and calls
   `setConfig(raw)`. `validateConfig` runs once, the result is cached.
2. Each `context` / `tool_result` / `turn_end` handler (P1.M4/P1.M6) calls `getConfig()` → gets a fresh,
   defensive copy of the validated config; reads fields; never mutates.
3. `/reload` → `session_start` fires again → `index.ts` calls `setConfig` again → cache re-validated.
4. If a human typed `"bloatThresholdBytes": -1`, the bloat reminder still works at the 8192 default and a
   warn is printed; nothing throws.

**Pain Points Addressed**: Without a fail-safe `getConfig`, a single malformed `settings.json` value (a
string where a number is expected, a typo'd enum, a stale config from an older version) would throw inside
the `context` handler and break the agent turn. The "works with zero configuration" + "never throw" design
principles (`spec/03` / `spec/09 §4`) require this layer to absorb all malformed input.

---

## Why

- **Closes the configuration system.** S1 delivered the *shape* (`MulliganConfig` + `DEFAULT_CONFIG`); S2
  delivers the *behavior* (read/validate/coerce/merge/cache). `spec/11-build-order.md` Step 1 splits these
  deliberately: "config.ts // load + validate + default settings" — S1 owned "default settings," S2 owns
  "load + validate."
- **Makes "never throw" a compile-+test-verifiable guarantee.** The whole body of `validateConfig` is wrapped
  in `try/catch`, every property read goes through a `safeGet` that swallows throwing `Proxy` traps, and the
  adversarial test suite feeds circular refs + throwing proxies to prove no input can escape. This is the
  fail-open foundation every later handler relies on (`spec/06 §1`: filter fail-open; `spec/08` edge cases).
- **Protects the shared `DEFAULT_CONFIG` singleton.** S1's JSDoc on `DEFAULT_CONFIG` promises
  *"getConfig() returns a freshly-merged copy built atop this object (deep-cloned before user overrides are
  applied), never this object itself."* S2 honors that with `structuredClone(DEFAULT_CONFIG)` as the merge
  base AND `structuredClone(cachedConfig)` on every `getConfig()` return, so neither the default nor the
  session cache can be mutated by a caller. A mutation test pins this.
- **Single, dependency-free source of truth for runtime config.** `config.ts` still imports NOTHING from Pi
  (Pi's `Settings` type is closed with no `mulligan` key and `ExtensionContext` exposes no settings accessor —
  `api_verification.md §3.1`). Settings are handed IN via `setConfig(raw)` from `index.ts`; config.ts stays
  pure and the `tsc` gate stays purely local.

---

## What

Append the runtime layer to `src/config.ts`. Concretely:

- A module-level cache `let cachedConfig: MulliganConfig | null = null;`.
- `getConfig(): MulliganConfig` — if cache is `null`, validate `DEFAULT_CONFIG` (lazy); always return a
  **defensive deep clone** of the cached config.
- `setConfig(raw: unknown): void` — `cachedConfig = validateConfig(raw)`; wrapped so it **never throws**
  (resets to defaults on any error).
- `validateConfig(raw: unknown): MulliganConfig` — `try { clone DEFAULT_CONFIG; if raw is a record, overlay
  each known field validated+coerced per §4; return cfg } catch { return clone of DEFAULT_CONFIG }`.
- Private coercion/validation helpers, each emitting a fail-safe `console.warn` (naming field + value) when a
  *present* value is invalid (booleans never warn — `!!` always coerces).

This subtask does **NOT**: read Pi `settings.json` directly (that's `index.ts`'s job in P1.M7 — S2 only
exposes the seam), create/import `log.ts` (P1.M1.T3 — S2 uses a wrapped `console.warn` stand-in), build
`runtime.ts`/`filter.ts`/tools/nudges (later subtasks), wire anything into `index.ts` (P1.M7.T1), or write
the README (P1.M7.T4).

### Success Criteria

- [ ] `src/config.ts` additionally exports exactly `getConfig`, `setConfig`, `validateConfig` (the S1 exports
      are unchanged and still present).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run test/config.test.ts` is all-green (S1 + new suites).
- [ ] `validateConfig` / `setConfig` / `getConfig` **never throw** on any input (adversarial suite green).
- [ ] `DEFAULT_CONFIG` is **never mutated** by any operation (mutation test green).
- [ ] Per-field behavior matches `spec/09-configuration.md` §4 exactly (coercion/validation test suite green).
- [ ] `config.ts` imports NOTHING from Pi / typebox (grep gate = 0).

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code to append is given verbatim in Task 1 (and the exact tests in
> Task 2). The authoritative rules are `spec/09-configuration.md` §1 + §4 (reproduced below). The S1 input
> contract (the existing `src/config.ts` interface + constant) is reproduced verbatim. The typing risk
> (`structuredClone` global under `types:["node"]`) and the runtime/library facts (Node 26, vitest 1.6.1,
> tsc 5.9.3) are all verified first-hand in the research notes. No prior knowledge beyond "the S1 scaffold +
> `src/config.ts` exist and pass `tsc`/`vitest`" is required.

### Documentation & References

```yaml
# MUST READ — authoritative sources for this module
- file: spec/09-configuration.md
  why: "§1 (where/when/lazy/cached/re-read-on-reload) and §4 (the exact per-field validation rules) are THE
        spec for this subtask. §2 (schema & defaults) is already encoded by S1's DEFAULT_CONFIG."
  critical: "§4 rules, verbatim: Booleans coerce with !!; invalid→default. Numbers must be finite, >=0
        (thresholds >0); invalid→default. protectedRoles must be array of known selector strings
        ('first:user','latest:user'); unknown entries ignored (with warn). estimateConfidence must be one of
        'low'|'medium'|'high'; else default. log.file if set must be a string; opening deferred. On ANY
        per-field failure: log a warn naming the field+value, use default, continue. NEVER throw."

- file: src/config.ts            # the S1 deliverable — DO NOT MODIFY its existing exports
  why: "S2 APPENDS below DEFAULT_CONFIG. Contains: type Granularity, type EstimateConfidence,
        interface MulliganConfig (enabled; rewind{enabled,protectedRoles,maxDepth,requireMutationWarning};
        shrink{enabled}; nudges{bloatReminder,perTurnDrift,bloatThresholdBytes,driftThresholdTokens};
        audit{estimateConfidence}; log{file}), and const DEFAULT_CONFIG: MulliganConfig. All JSON-serializable."
  pattern: "S2 imports/reuses MulliganConfig, EstimateConfidence, DEFAULT_CONFIG from the same file
        (same-module references, no import statement needed)."
  gotcha: "DEFAULT_CONFIG JSDoc says 'CONSTANT: do not mutate. getConfig() returns a freshly-merged copy
        ... never this object itself.' ⇒ S2 MUST structuredClone before merging AND before returning."

- file: test/config.test.ts      # S1's test — EXTEND, do not duplicate
  why: "S1 created it; S1 PRP says 'S2 will EXTEND the same file with getConfig tests — do not duplicate it.'
        Currently 3 tests in describe('DEFAULT_CONFIG'). Uses vitest, imports from '../src/config.js'."
  pattern: "import { describe, it, expectTypeOf, expect } from 'vitest'; Add beforeEach, vi to the import."

- file: plan/001_2e5baf25fe9f/P1M1T2S1/PRP.md   # the S1 contract (read-only reference)
  why: "Defines exactly what S1 produced and explicitly reserves the getConfig/setConfig/validateConfig
        work for S2 ('S2 owns getConfig() ... ADDED to the SAME file'). Confirms autoOnBloat is NOT v1."
  critical: "GOTCHA #7 (DEFAULT_CONFIG is a shared singleton; S2 must deep-clone before merging) and the
        fail-safe / zero-Pi-dependency constraints originate here."

- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  why: "§3.1 confirms ExtensionContext has NO settings accessor; Pi's Settings type is closed (no 'mulligan'
        key). ⇒ S2 cannot read settings from Pi; settings are handed in via setConfig(raw). config.ts stays
        dependency-free."
  critical: "Do NOT try to import Pi's Settings or read settings.json from config.ts. That wiring is index.ts
        (P1.M7.T1), which will cast (settings as any).mulligan → unknown → setConfig(unknown)."

- file: spec/11-build-order.md
  why: "§1 file layout: 'config.ts // load + validate + default settings'. §2 Step 1 pairs config.ts with
        log.ts + runtime.ts but the tasks.json ordering puts log.ts in T3 (after T2). ⇒ at S2 ship time,
        log.ts is ABSENT; use console.warn stand-in."

- file: plan/001_2e5baf25fe9f/P1M1T2S2/research/codebase_recon.md
  why: "First-hand verification of: the live S1 config.ts/test contents, all downstream config.* field
        accesses (every MulliganConfig field has a consumer — no dead fields), exact §4 rules, vitest 1.6.1,
        tsconfig flags, and that structuredClone IS typed as a global under types:[node]."
- file: plan/001_2e5baf25fe9f/P1M1T2S2/research/external_best_practices.md
  why: "Fail-safe TS validation patterns: !! boolean coercion (the 'false'-string gotcha), Number.isFinite
        (never global isFinite/Number()), Proxy traps throw → try/catch safeGet, structuredClone caveats,
        vitest not.toThrow + mutation-isolation patterns. With MDN/vitest source URLs."

# AUTHORITATIVE RULES (spec/09-configuration.md §1 + §4, verbatim) — implement EXACTLY these:
# §1: "loaded lazily on first use and cached for the session; re-read on /reload. getConfig() returns the
#      validated, defaulted config. ... unknown keys are ignored (forward-compat). Type-mismatched values
#      fall back to the default with a warn log. This must never throw."
# §4: see 'critical' in the spec/09 entry above.
```

### Current Codebase tree (state at this subtask's start — S1 delivered; verified live)

```bash
pi-mulligan/
├── package.json            # main:'src/index.ts'; pi.extensions; devDeps: typescript ^5, vitest ^1, @types/node ^22
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test'], skipLibCheck
├── package-lock.json
├── node_modules/           # @earendil-works/pi-coding-agent, typebox, @types/node 22.20.1, vitest 1.6.1, tsc 5.9.3 all resolve
├── src/
│   ├── index.ts            # S1/P1.M1.T1.S2 — no-op default-export factory (imports type ExtensionAPI only); NOT yet wired to config
│   ├── config.ts           # ← S1 DELIVERED (Granularity, EstimateConfidence, MulliganConfig+JSDoc, DEFAULT_CONFIG). S2 APPENDS here.
│   └── tools/              # empty (tools/* arrive in P1.M5)
├── test/
│   ├── config.test.ts      # ← S1 DELIVERED (describe('DEFAULT_CONFIG'), 3 tests). S2 EXTENDS here.
│   └── integration/        # empty (smoke harness arrives in P1.M7)
├── .pi/extensions/         # empty
├── .gitignore              # ignores node_modules/, dist/, build/
├── plan/                   # orchestration (read-only) — incl. P1M1T2S1/ (contract) + P1M1T2S2/research/ (this PRP's notes)
└── spec/                   # 12-doc spec (read-only); 09-configuration.md is authoritative here
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run test/config.test.ts` → 3/3 green.
```

### Desired Codebase tree with files to be added/modified (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── config.ts           # MODIFIED: PLACE/REPLACE the S2 runtime section (cachedConfig, getConfig, setConfig, validateConfig, helpers) below DEFAULT_CONFIG; S1 contract unchanged
└── test/
    └── config.test.ts      # MODIFIED (extend-only): + imports {getConfig,setConfig,validateConfig,beforeEach,vi};
                            #                          + describe('validateConfig'), describe('getConfig / setConfig cache'),
                            #                          + describe('getConfig lazy init' via vi.resetModules)
# No other files are created or modified.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — NEVER throw. spec/09 §4: "This must never throw."
# Wrap the ENTIRE validateConfig body in try/catch returning structuredClone(DEFAULT_CONFIG).
# Read EVERY property through safeGet() (try/catch) because a Proxy's `get`/`has` trap can throw
# (MDN Proxy). `in`, destructuring, Object.keys, and {...spread} ALL invoke traps and can throw on
# adversarial input → the top-level catch saves you, but safeGet keeps one bad field from nuking the rest.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 — Protect the DEFAULT_CONFIG singleton AND the session cache.
# (a) validateConfig starts from structuredClone(DEFAULT_CONFIG) — never merge into the singleton.
# (b) getConfig returns structuredClone(cachedConfig) on EVERY call — never hand out the cache reference,
#     so a caller mutating the returned object cannot poison the session for other callers.
# structuredClone is a Node 17+ GLOBAL and IS typed under types:["node"] (declared in
# @types/node/worker_threads.d.ts inside a `global { … }` block) — verified: tsc accepts it with no import.
# structuredClone throws DataCloneError ONLY on functions/symbols; DEFAULT_CONFIG & the cache are plain JSON,
# so they are always safe. NEVER structuredClone the raw `unknown` user input (it may contain a function) —
# only clone DEFAULT_CONFIG / the already-validated cache.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — Boolean coercion is `!!`, including for `null`/`""`/`"false"`. (spec/09 §4)
#   coerceBoolean(value, fallback) = value === undefined ? fallback : !!value
# Consequences (all INTENTIONAL per spec — pin them with tests):
#   - enabled: 0 / "" / null  → false        (so `enabled: null` DISABLES the extension; users who want the
#                                             default must OMIT the field, not set null)
#   - enabled: "false" / "0"  → TRUE          (non-empty strings are truthy!) — document this loudly
# Booleans NEVER emit a warn (!! always succeeds); only absent (undefined) → default.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — Numbers: use Number.isFinite(), NEVER global isFinite()/Number(). (spec/09 §4 + MDN)
#   - typeof value !== "number"  → fallback (NO string→number coercion: "8192" → default, not 8192)
#   - !Number.isFinite(value)    → fallback (rejects NaN, Infinity, -Infinity)
#   - thresholds (bloatThresholdBytes, driftThresholdTokens): value <= 0 → fallback  (must be > 0)
#   - maxDepth: value < 0 → fallback                                          (must be >= 0; 0 is allowed)
# Global isFinite("8192")===true and Number("")===0, Number(null)===0 — both silently coerce. AVOID.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — protectedRoles: filter to KNOWN selectors; do NOT invent defaults for filtered entries.
# Known set (spec/09 §2/§4, v1): {"first:user","latest:user"}. (spec/04 §7's loose "user" prose is
# illustrative only — S1 already ships the exact selector strings in DEFAULT_CONFIG.)
#   - not an array            → fallback ["first:user","latest:user"] + warn
#   - array                    → keep entries ∈ known set; warn+drop each unknown entry
#   - result CAN be []         (e.g. user set ["bogus"]) — that is spec-faithful ("unknown entries ignored");
#                               do NOT re-inject defaults. (No de-dup required by spec; keep it simple.)
# Narrow each entry with `typeof entry === "string" && KNOWN.has(entry)` (Set<string>.has rejects unknown).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — estimateConfidence is a 3-value enum; validate with strict equality, not `as`.
#   value === "low" | "medium" | "high" → value; else fallback "medium" + warn.
# Do NOT use `as EstimateConfidence` (bypasses validation) and do NOT use Array.includes on `unknown`
# without a typeof-string guard (TS won't allow `.includes` on unknown anyway).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — log.file: `null` is the valid "off" sentinel (NO warn); any string is accepted (even "");
#   non-string (number/bool/object/array) → fallback null + warn.
# OPENING/WRITING the file is log.ts (P1.M1.T3) — NOT S2. S2 only validates the value; never touch the FS.
# Accepting "" is harmless because T3's open is deferred+wrapped (a bad path never crashes the extension).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — Logging: use a wrapped console.warn stand-in; log.ts (P1.M1.T3) does NOT exist yet.
# spec/09 §4 requires "a warn naming the field and the value" but the structured JSONL logger (spec/04 §9)
# is a LATER task. Put ALL warn calls behind ONE private helper warnConfig(field, value) that wraps
# console.warn in its own try/catch (a logging failure must never throw) and uses safeStringify (JSON.stringify
# wrapped — circular refs → String()). When T3 ships, re-point this single helper to the structured logger.
# Do NOT create or import src/log.ts in this subtask.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — cache is module-level mutable state → tests must reset it.
# vitest does NOT reset module state between tests by default. Reset via setConfig(undefined) in a beforeEach
# (setConfig(undefined) → validateConfig(undefined) → all defaults). For the TRUE lazy-null first-call path,
# use vi.resetModules() + dynamic import('../src/config.js') in its own describe (fresh module → cache null).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — Do not break the S1 contract; the S1 exports are immutable.
# The existing exports (Granularity, EstimateConfidence, MulliganConfig, DEFAULT_CONFIG) and the S1 test
# suite MUST remain unchanged. The S2 runtime section lives BELOW DEFAULT_CONFIG. Reuse
# MulliganConfig/EstimateConfidence/DEFAULT_CONFIG by same-module reference (no import statement).
# The Level 1 grep gates assert S1 exports still appear exactly once and no S1 line was altered.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 (CRITICAL) — A PRIOR S2 ATTEMPT MAY ALREADY BE PRESENT; it must be REPLACED, not duplicated.
# OBSERVED AT RESEARCH TIME: the repo's src/config.ts already contained an S2 implementation using an
# `UNSET = Symbol("mulligan:config:unset")` sentinel with `if (v !== UNSET)` guards. That version has a
# real defect — `obj.missingKey` returns `undefined` (NOT the UNSET symbol), so the `!== UNSET` guard is
# ALWAYS true for absent fields, causing every absent sibling field in a partial override to be coerced and
# to emit a SPURIOUS warn (e.g. setting bloatThresholdBytes warns about absent driftThresholdTokens).
# The CORRECTED design (the verbatim block in Task 1) drops the UNSET sentinel and uses `undefined`-as-
# absence with `if (v !== undefined)` guards, so absent fields keep their default SILENTLY (verified: 0 warns
# on a valid partial override). Therefore: if a prior S2 attempt exists, DELETE IT ENTIRELY (everything
# after DEFAULT_CONFIG's closing `};`) and write the Task 1 block fresh — do NOT merge with / keep any of it.
# The Level 1 gate asserts `grep -c UNSET src/config.ts` == 0 afterward.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No new data models — S2 **reuses** `MulliganConfig`, `EstimateConfidence`, and `DEFAULT_CONFIG` from the same
file. The only new state is the module-level cache `let cachedConfig: MulliganConfig | null = null;`.
All returned configs are JSON-serializable (they're clones of `DEFAULT_CONFIG`
with validated overlays), preserving S1's GOTCHA #8.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE + DETECT PRIOR ATTEMPT (no edits — run only)
  - RUN: test -f src/config.ts && test -f test/config.test.ts
  - RUN: npx tsc --noEmit -p tsconfig.json            # expect exit 0
  - RUN: npx vitest run test/config.test.ts            # expect green
  - RUN: grep -c 'export function getConfig' src/config.ts   # 0 → pure S1 (APPEND in Task 1); >0 → a PRIOR S2 attempt exists (REPLACE in Task 1)
  - RUN: grep -c 'UNSET' src/config.ts                       # >0 → the prior attempt has the over-warn bug (GOTCHA #11); it MUST be replaced
  - IF tsc/vitest fail on the S1 CONTRACT (DEFAULT_CONFIG / MulliganConfig): STOP — flag to the orchestrator;
    do not "fix" S1. (Failures caused only by a buggy prior-S2 attempt are expected and are fixed by Task 1.)

Task 1: MODIFY src/config.ts  (PLACE the S2 runtime section — the S1 contract stays immutable)
  - PRECONDITION: Task 0 complete (you know whether a prior S2 attempt exists).
  - DETERMINE STARTING STATE from the Task 0 grep:
      * `export function getConfig` ABSENT (pure S1): APPEND the block below AFTER DEFAULT_CONFIG's closing `};`.
      * `export function getConfig` PRESENT (prior attempt — likely the buggy `UNSET` version, GOTCHA #11):
        DELETE everything from the FIRST S2 line (immediately after DEFAULT_CONFIG's closing `};`) through EOF,
        then APPEND the block below. Do NOT keep/merge any prior S2 code (it has the over-warn defect).
  - THE S1 CONTRACT (everything from line 1 through DEFAULT_CONFIG's closing `};`) IS NEVER EDITED in either case.
  - RESULT after this task: `export function getConfig`/`setConfig`/`validateConfig` each appear EXACTLY ONCE,
    there is NO `UNSET` symbol anywhere in the file, and ZERO runtime imports from Pi/typebox.
  - The exact block to place is in "Exact content to place" below. It adds: KNOWN_PROTECTED_ROLES, cachedConfig,
    getConfig(), setConfig(), validateConfig(), and the private helpers
    (isRecord, safeGet, coerceBoolean, coerceNumber, coerceProtectedRoles, coerceEstimateConfidence,
    coerceLogFile, warnConfig, safeStringify).
  - CONSTRAINTS:
      * Reuse MulliganConfig / EstimateConfidence / DEFAULT_CONFIG from the SAME module (NO import line).
      * ZERO runtime imports from @earendil-works/pi-coding-agent or typebox (grep gate = 0).
      * structuredClone used as a bare global (typed under types:["node"]) — NO import.
      * validateConfig body wrapped in try/catch → structuredClone(DEFAULT_CONFIG) on any error.
      * Every property read via safeGet() (try/catch) — never bare `raw.x`, never `in`, never destructuring,
        never {...raw} (all can throw on a Proxy).
      * Booleans: coerceBoolean(v, fb) = v === undefined ? fb : !!v   (GOTCHA #3)
      * Numbers: Number.isFinite + sign rules per GOTCHA #4; warn on invalid-present.
      * protectedRoles: filter to known set per GOTCHA #5; narrow entry typeof === "string".
      * estimateConfidence: strict === enum check per GOTCHA #6.
      * log.file: null→fb (no warn) | string→value | else→fb+warn per GOTCHA #7.
      * warnConfig + safeStringify wrap console.warn in try/catch (GOTCHA #8).
  - NAMING/PLACEMENT: file stays at repo-root src/config.ts; camelCase functions; the new exports are
    getConfig/setConfig/validateConfig; helpers are module-private (no `export`).

Task 2: MODIFY test/config.test.ts  (EXTEND ONLY — keep describe('DEFAULT_CONFIG') intact)
  - CHANGE the vitest import to add beforeEach, vi AND add getConfig, setConfig, validateConfig to the
    config import. (See "Exact test edits" below.)
  - ADD three new describe blocks (exact content in "Exact test edits"):
      describe('validateConfig')         — pure-function suite (no cache; no beforeEach needed).
      describe('getConfig / setConfig cache') — beforeEach(() => setConfig(undefined)) to reset the cache.
      describe('getConfig lazy init')    — uses vi.resetModules() + dynamic import to test the null-cache
                                           first-call path in isolation.
  - COVERAGE (each is a separate `it`):
      * absent/empty/non-object input → deep-equal DEFAULT_CONFIG (undefined, null, {}, 42, "x", [1,2,3]).
      * partial valid override deep-merges (other fields keep defaults).
      * full valid override applied (asserts exact merged object).
      * boolean coercion incl. the "false"-string → true gotcha (GOTCHA #3).
      * number validation: -1/0/NaN/Infinity/"8192"→default; maxDepth 0 allowed, -1→default (GOTCHA #4).
      * protectedRoles filtering + non-array→default + [] allowed (GOTCHA #5).
      * estimateConfidence enum + default (GOTCHA #6).
      * log.file null/string/""/non-string (GOTCHA #7).
      * unknown keys ignored (incl. shrink.autoOnBloat dropped).
      * NEVER throws: circular ref, throwing Proxy, Object.create(null) (GOTCHA #1).
      * DEFAULT_CONFIG not mutated (snapshot before/after) (GOTCHA #2a).
      * setConfig+getConfig round-trip; validation applies through the cache.
      * getConfig hands out INDEPENDENT copies (mutating one doesn't poison the next) (GOTCHA #2b).
      * getConfig never returns DEFAULT_CONFIG by reference (GOTCHA #2b).
      * lazy: fresh module's first getConfig() returns defaults (GOTCHA #9).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc + grep scope gates) and Level 2 (vitest). Levels 3/4 are runtime/adversarial — for this
    pure module they are covered by the vitest suite (config.ts has no Pi/process/FS dependency; the real
    Pi integration arrives in P1.M4/P1.M5/P1.M6/P1.M7).
```

#### Exact content to place in `src/config.ts` (Task 1 — copy verbatim; place AFTER DEFAULT_CONFIG's closing `};`, REPLACING any prior S2 attempt per GOTCHA #11)

```ts

// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M1.T2.S2) — lazy cache + fail-safe validation (spec/09-configuration.md §1, §4)
// APPENDED below the S1 exports (Granularity, EstimateConfidence, MulliganConfig, DEFAULT_CONFIG),
// which are UNCHANGED. This module still imports NOTHING from Pi — settings are handed in via setConfig().
// ─────────────────────────────────────────────────────────────────────────────

/** Known protectedRoles selector strings (spec/09 §4). v1 supports exactly these two. */
const KNOWN_PROTECTED_ROLES = new Set<string>(["first:user", "latest:user"]);

/**
 * Session cache of the validated config. `null` until the first getConfig()/setConfig().
 * Re-validated and replaced on every setConfig() (the re-read-on-/reload seam is index.ts, P1.M7.T1).
 */
let cachedConfig: MulliganConfig | null = null;

/**
 * getConfig() — the public read API (spec/09 §1: "loaded lazily on first use and cached for the session").
 *
 * LAZY: on the first call (cache empty) it validates DEFAULT_CONFIG and caches the result.
 * DEFENSIVE COPY: a fresh structuredClone is returned on EVERY call, so a caller can never mutate the
 * shared session cache (or DEFAULT_CONFIG). The clone is cheap (~10 fields, microseconds) relative to an
 * LLM inference. Callers MUST still treat the result as read-only.
 */
export function getConfig(): MulliganConfig {
  let cfg = cachedConfig;
  if (cfg === null) {
    cfg = validateConfig(undefined);
    cachedConfig = cfg;
  }
  return structuredClone(cfg);
}

/**
 * setConfig() — initialize / replace the session cache from a raw settings object (spec/09 §1).
 * Called from the index.ts factory / session_start handler (and again on /reload). Accepts the merged Pi
 * settings object (or settings.mulligan); the caller is responsible for extraction (config.ts is Pi-free).
 * NEVER throws: any error resets the cache to validated defaults.
 */
export function setConfig(raw: unknown): void {
  try {
    cachedConfig = validateConfig(raw);
  } catch {
    cachedConfig = validateConfig(undefined);
  }
}

/**
 * validateConfig() — the pure, fail-safe validation engine (spec/09 §4).
 *
 * Deep-merges `raw` over a clone of DEFAULT_CONFIG, validates + coerces each known field per the §4 rules,
 * ignores unknown keys (forward-compat), and returns a fully-valid MulliganConfig. NEVER throws: the entire
 * body is wrapped in try/catch; on ANY error (e.g. a Proxy with a throwing trap) it returns a fresh clone
 * of DEFAULT_CONFIG. Exported so unit tests can exercise it directly.
 */
export function validateConfig(raw: unknown): MulliganConfig {
  try {
    // Start from a deep clone so the shared DEFAULT_CONFIG singleton is NEVER mutated (GOTCHA #2a).
    const cfg: MulliganConfig = structuredClone(DEFAULT_CONFIG);
    if (!isRecord(raw)) {
      // null / primitive / array / non-record → all defaults.
      return cfg;
    }

    // Each known field is read via safeGet (which returns `undefined` for ABSENT properties and for a
    // throwing Proxy `get` trap). The `if (v !== undefined)` guard therefore SKIPS absent fields (they
    // keep their default with NO warn — spec/09 §4 warns only on present-but-invalid values) and only runs
    // the coercer on a genuinely-present value. (GOTCHA #1)
    let v: unknown;

    // Top-level master switch.
    v = safeGet(raw, "enabled");
    if (v !== undefined) cfg.enabled = coerceBoolean(v, cfg.enabled);

    // rewind.*
    const rewindRaw = safeGet(raw, "rewind");
    if (isRecord(rewindRaw)) {
      v = safeGet(rewindRaw, "enabled");
      if (v !== undefined) cfg.rewind.enabled = coerceBoolean(v, cfg.rewind.enabled);
      v = safeGet(rewindRaw, "protectedRoles");
      if (v !== undefined) cfg.rewind.protectedRoles = coerceProtectedRoles(v, cfg.rewind.protectedRoles);
      v = safeGet(rewindRaw, "maxDepth");
      if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);
      v = safeGet(rewindRaw, "requireMutationWarning");
      if (v !== undefined) cfg.rewind.requireMutationWarning = coerceBoolean(v, cfg.rewind.requireMutationWarning);
    }

    // shrink.*  (autoOnBloat intentionally NOT honored — reserved, not v1; S1 GOTCHA #1)
    const shrinkRaw = safeGet(raw, "shrink");
    if (isRecord(shrinkRaw)) {
      v = safeGet(shrinkRaw, "enabled");
      if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
    }

    // nudges.*
    const nudgesRaw = safeGet(raw, "nudges");
    if (isRecord(nudgesRaw)) {
      v = safeGet(nudgesRaw, "bloatReminder");
      if (v !== undefined) cfg.nudges.bloatReminder = coerceBoolean(v, cfg.nudges.bloatReminder);
      v = safeGet(nudgesRaw, "perTurnDrift");
      if (v !== undefined) cfg.nudges.perTurnDrift = coerceBoolean(v, cfg.nudges.perTurnDrift);
      v = safeGet(nudgesRaw, "bloatThresholdBytes");
      if (v !== undefined) cfg.nudges.bloatThresholdBytes = coerceNumber("nudges.bloatThresholdBytes", v, cfg.nudges.bloatThresholdBytes, true);
      v = safeGet(nudgesRaw, "driftThresholdTokens");
      if (v !== undefined) cfg.nudges.driftThresholdTokens = coerceNumber("nudges.driftThresholdTokens", v, cfg.nudges.driftThresholdTokens, true);
    }

    // audit.*
    const auditRaw = safeGet(raw, "audit");
    if (isRecord(auditRaw)) {
      v = safeGet(auditRaw, "estimateConfidence");
      if (v !== undefined) cfg.audit.estimateConfidence = coerceEstimateConfidence(v, cfg.audit.estimateConfidence);
    }

    // log.*  (opening/writing the file is log.ts / P1.M1.T3 — NOT this module)
    const logRaw = safeGet(raw, "log");
    if (isRecord(logRaw)) {
      v = safeGet(logRaw, "file");
      if (v !== undefined) cfg.log.file = coerceLogFile(v, cfg.log.file);
    }

    return cfg;
  } catch {
    // NEVER throw (spec/09 §4). Adversarial input (e.g. a throwing Proxy trap) → all defaults.
    return structuredClone(DEFAULT_CONFIG);
  }
}

// ── private helpers (module-local; not exported) ─────────────────────────────

/** True for plain records and Object.create(null); false for null, primitives, and arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a property without throwing (a Proxy `get` trap may throw). Returns `undefined` if the property
 *  is absent OR the read throws — both are treated as "not provided" (keep default, no warn). */
function safeGet(obj: object, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Boolean: coerce with `!!` (spec/09 §4). Absent (undefined) → fallback. Present (incl. null) → `!!value`. */
function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : !!value;
}

/** Number: must be a finite number; `mustBePositive` enforces `> 0` (else `>= 0`). Invalid-present → fallback + warn. */
function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0)) {
    return value;
  }
  warnConfig(field, value);
  return fallback;
}

/** protectedRoles: array of known selectors; unknown entries dropped (per-entry warn). Non-array → fallback + warn. */
function coerceProtectedRoles(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    warnConfig("rewind.protectedRoles", value);
    return fallback;
  }
  const known: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && KNOWN_PROTECTED_ROLES.has(entry)) {
      known.push(entry);
    } else {
      warnConfig("rewind.protectedRoles entry", entry);
    }
  }
  return known;
}

/** estimateConfidence: must be one of low|medium|high; else fallback + warn. */
function coerceEstimateConfidence(value: unknown, fallback: EstimateConfidence): EstimateConfidence {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  warnConfig("audit.estimateConfidence", value);
  return fallback;
}

/** log.file: null (off — no warn) or any string (opening deferred); non-string → fallback + warn. */
function coerceLogFile(value: unknown, fallback: string | null): string | null {
  if (value === null) return fallback; // explicit "off" — valid
  if (typeof value === "string") return value;
  warnConfig("log.file", value);
  return fallback;
}

/** Fail-safe warn (spec/09 §4: "log a warn naming the field and the value"). Uses console.warn until the
 *  structured JSONL logger (log.ts, P1.M1.T3) ships; that task should re-point this single helper. */
function warnConfig(field: string, value: unknown): void {
  try {
    console.warn(`[mulligan] config: invalid "${field}"=${safeStringify(value)}, using default`);
  } catch {
    /* never throw — logging must not crash the extension */
  }
}

/** JSON.stringify that never throws (circular refs / BigInt → String()). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
```

#### Exact test edits (Task 2)

**(a)** Replace the two import lines at the top of `test/config.test.ts`:

```ts
// FROM (S1):
import { describe, it, expectTypeOf, expect } from "vitest";
import {
  DEFAULT_CONFIG,
  type MulliganConfig,
  type Granularity,
  type EstimateConfidence,
} from "../src/config.js";

// TO (S2 adds: beforeEach, vi  +  getConfig, setConfig, validateConfig):
import { describe, it, expectTypeOf, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_CONFIG,
  getConfig,
  setConfig,
  validateConfig,
  type MulliganConfig,
  type Granularity,
  type EstimateConfidence,
} from "../src/config.js";
```

**(b)** Leave the existing `describe("DEFAULT_CONFIG", () => { … })` block **completely unchanged**, then APPEND
the three new describe blocks below:

```ts
describe("validateConfig", () => {
  it("returns deep-equal DEFAULT_CONFIG for absent/empty/non-record input", () => {
    expect(validateConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig({})).toEqual(DEFAULT_CONFIG);
    expect(validateConfig(42)).toEqual(DEFAULT_CONFIG);
    expect(validateConfig("nope")).toEqual(DEFAULT_CONFIG);
    expect(validateConfig([1, 2, 3])).toEqual(DEFAULT_CONFIG); // arrays are not records → defaults
    expect(validateConfig(Object.create(null))).toEqual(DEFAULT_CONFIG); // null-proto object is a record
  });

  it("deep-merges partial valid overrides over defaults", () => {
    const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } });
    expect(cfg.nudges.bloatThresholdBytes).toBe(100);
    expect(cfg.nudges.driftThresholdTokens).toBe(3000); // unchanged default
    expect(cfg.enabled).toBe(true); // unchanged
  });

  it("applies a full valid override", () => {
    const cfg = validateConfig({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },
      audit: { estimateConfidence: "low" },
      log: { file: "/tmp/mulligan.jsonl" },
    });
    expect(cfg).toEqual({
      enabled: false,
      rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
      shrink: { enabled: false },
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 },
      audit: { estimateConfidence: "low" },
      log: { file: "/tmp/mulligan.jsonl" },
    });
  });

  it("coerces booleans with !! (spec/09 §4) — non-empty strings are truthy", () => {
    expect(validateConfig({ enabled: 1 }).enabled).toBe(true);
    expect(validateConfig({ enabled: 0 }).enabled).toBe(false);
    expect(validateConfig({ enabled: "" }).enabled).toBe(false);
    // GOTCHA #3: "false" is a non-empty string → truthy → true (intentional per spec)
    expect(validateConfig({ enabled: "false" }).enabled).toBe(true);
    // null is present → !!null → false (users wanting the default must OMIT the field)
    expect(validateConfig({ enabled: null }).enabled).toBe(false);
  });

  it("validates numbers: finite, >=0; thresholds >0; rejects strings/NaN/Infinity WITHOUT coercion", () => {
    expect(validateConfig({ nudges: { bloatThresholdBytes: -1 } }).nudges.bloatThresholdBytes).toBe(8192);
    expect(validateConfig({ nudges: { bloatThresholdBytes: 0 } }).nudges.bloatThresholdBytes).toBe(8192); // threshold must be >0
    expect(validateConfig({ nudges: { bloatThresholdBytes: NaN } }).nudges.bloatThresholdBytes).toBe(8192);
    expect(validateConfig({ nudges: { bloatThresholdBytes: Infinity } }).nudges.bloatThresholdBytes).toBe(8192);
    expect(validateConfig({ nudges: { bloatThresholdBytes: "8192" } }).nudges.bloatThresholdBytes).toBe(8192); // no string coercion
    expect(validateConfig({ rewind: { maxDepth: 0 } }).rewind.maxDepth).toBe(0); // >=0 allowed
    expect(validateConfig({ rewind: { maxDepth: -1 } }).rewind.maxDepth).toBe(5); // <0 → default
  });

  it("filters protectedRoles to known selectors; drops unknown entries; non-array → default", () => {
    expect(validateConfig({ rewind: { protectedRoles: ["first:user", "bogus"] } }).rewind.protectedRoles).toEqual(["first:user"]);
    expect(validateConfig({ rewind: { protectedRoles: ["bogus", "nope"] } }).rewind.protectedRoles).toEqual([]);
    expect(validateConfig({ rewind: { protectedRoles: [] } }).rewind.protectedRoles).toEqual([]);
    // non-array → default
    expect(validateConfig({ rewind: { protectedRoles: "first:user" } }).rewind.protectedRoles).toEqual(["first:user", "latest:user"]);
  });

  it("validates estimateConfidence enum; else default 'medium'", () => {
    expect(validateConfig({ audit: { estimateConfidence: "low" } }).audit.estimateConfidence).toBe("low");
    expect(validateConfig({ audit: { estimateConfidence: "high" } }).audit.estimateConfidence).toBe("high");
    expect(validateConfig({ audit: { estimateConfidence: "bogus" } }).audit.estimateConfidence).toBe("medium");
    expect(validateConfig({ audit: { estimateConfidence: 123 } }).audit.estimateConfidence).toBe("medium");
  });

  it("validates log.file: null is valid 'off'; any string accepted; non-string → null", () => {
    expect(validateConfig({ log: { file: "/x.jsonl" } }).log.file).toBe("/x.jsonl");
    expect(validateConfig({ log: { file: null } }).log.file).toBe(null);
    expect(validateConfig({ log: { file: "" } }).log.file).toBe(""); // empty string is a string
    expect(validateConfig({ log: { file: 123 } }).log.file).toBe(null);
  });

  it("ignores unknown keys (forward-compat), incl. shrink.autoOnBloat", () => {
    const cfg = validateConfig({ foo: "bar", rewind: { baz: 1, enabled: false }, shrink: { autoOnBloat: true } });
    expect(cfg.rewind.enabled).toBe(false);
    expect(cfg.shrink).toEqual({ enabled: true }); // autoOnBloat dropped; default shrink.enabled retained
    expect(cfg).toEqual(validateConfig({ rewind: { enabled: false } }));
  });

  it("NEVER throws on adversarial input (GOTCHA #1)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const throwingProxy = new Proxy({}, { get() { throw new Error("boom"); } });
    expect(() => validateConfig(circular)).not.toThrow();
    expect(() => validateConfig(throwingProxy)).not.toThrow();
    // a throwing getter nested inside an otherwise-valid object also stays safe:
    const tricky = { rewind: { maxDepth: "not-a-number" } };
    expect(() => validateConfig(tricky)).not.toThrow();
    expect(validateConfig(tricky).rewind.maxDepth).toBe(5); // invalid → default, no throw
  });

  it("does not mutate DEFAULT_CONFIG (GOTCHA #2a)", () => {
    const snapshot = structuredClone(DEFAULT_CONFIG);
    validateConfig({ nudges: { bloatThresholdBytes: 1 }, rewind: { maxDepth: 99 } });
    expect(DEFAULT_CONFIG).toEqual(snapshot);
  });

  it("does NOT warn for ABSENT fields in a partial override (warns only on present-but-invalid, spec/09 §4)", () => {
    // A partial valid override must NOT spew warns about its absent sibling fields.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ nudges: { bloatThresholdBytes: 100 } }); // driftThresholdTokens absent
      expect(cfg.nudges.bloatThresholdBytes).toBe(100);
      expect(cfg.nudges.driftThresholdTokens).toBe(3000); // absent → default, silently
      expect(warn).not.toHaveBeenCalled(); // ZERO warns for a fully-valid partial override
      // …but a present-but-INVALID value DOES warn (exactly once, naming the field):
      warn.mockClear();
      validateConfig({ nudges: { bloatThresholdBytes: -1 } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("nudges.bloatThresholdBytes");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("getConfig / setConfig cache", () => {
  beforeEach(() => {
    setConfig(undefined); // reset the module-level cache to defaults before each test (GOTCHA #9)
  });

  it("getConfig returns validated defaults after a reset", () => {
    expect(getConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("setConfig then getConfig round-trips validated overrides", () => {
    setConfig({ nudges: { bloatThresholdBytes: 100 } });
    expect(getConfig().nudges.bloatThresholdBytes).toBe(100);
  });

  it("setConfig validates/coerces through the cache (invalid → default)", () => {
    setConfig({ nudges: { bloatThresholdBytes: -5 } });
    expect(getConfig().nudges.bloatThresholdBytes).toBe(8192);
  });

  it("getConfig hands out independent copies — the cache cannot be poisoned by callers (GOTCHA #2b)", () => {
    setConfig({ enabled: false });
    const a = getConfig();
    a.enabled = true; // mutate the returned copy
    const b = getConfig();
    expect(b.enabled).toBe(false); // cache unchanged
  });

  it("getConfig never exposes DEFAULT_CONFIG by reference", () => {
    expect(getConfig()).not.toBe(DEFAULT_CONFIG);
    setConfig(DEFAULT_CONFIG);
    expect(getConfig()).not.toBe(DEFAULT_CONFIG); // still a fresh clone
  });

  it("setConfig never throws on garbage input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => setConfig(circular)).not.toThrow();
    expect(() => setConfig(123)).not.toThrow();
    expect(getConfig()).toEqual(DEFAULT_CONFIG); // cache fell back to defaults
  });
});

describe("getConfig lazy init (cache starts null)", () => {
  // vi.resetModules() gives a FRESH module instance → cachedConfig is null again, so the first
  // getConfig() exercises the lazy-init branch. (GOTCHA #9)
  beforeEach(async () => {
    vi.resetModules();
  });

  it("first getConfig() on a fresh module validates defaults lazily", async () => {
    const mod = await import("../src/config.js");
    expect(mod.getConfig()).toEqual(DEFAULT_CONFIG);
    // a second call returns an equal (but distinct) config:
    const again = mod.getConfig();
    expect(again).toEqual(DEFAULT_CONFIG);
    expect(again).not.toBe(mod.getConfig()); // still defensive copies
  });
});
```

> **Note on the lazy test:** `vi.resetModules()` + dynamic `import("../src/config.js")` returns a fresh
> module where `cachedConfig` is `null`, so the first `getConfig()` runs the lazy branch. `DEFAULT_CONFIG`
> at the top of the file is the *original* module's export; `mod.getConfig()` returns a clone of the *fresh*
> module's `DEFAULT_CONFIG`, which is deep-equal — so `toEqual` passes. If `vi.resetModules` interacts
> oddly with other suites in your vitest version, this describe block is safe to drop (the lazy branch is
> trivially covered by code review + the "defaults after reset" test); it is a nice-to-have, not a gate.

### Implementation Patterns & Key Details

```ts
// ── PATTERN: never-throw validation engine ─────────────────────────────────
export function validateConfig(raw: unknown): MulliganConfig {
  try {
    const cfg = structuredClone(DEFAULT_CONFIG);   // never merge into the singleton
    if (!isRecord(raw)) return cfg;                // non-record → all defaults
    // … per-field overlay via safeGet + coerce* …
    return cfg;
  } catch {
    return structuredClone(DEFAULT_CONFIG);        // NEVER throw (spec/09 §4)
  }
}
//   The catch is the safety net for throwing Proxy traps / getters; safeGet is the first line of defense
//   so one bad field doesn't discard the rest. (GOTCHA #1)

// ── PATTERN: safe property read on unknown (Proxy traps can throw) ─────────
function safeGet(obj: object, key: string): unknown {
  try { return (obj as Record<string, unknown>)[key]; }
  catch { return undefined; }
}
//   Absent properties read as `undefined`; a throwing `get` trap ALSO yields `undefined`. Guard each field
//   with `if (v !== undefined)` so ABSENT fields keep their default WITHOUT a spurious warn (spec/09 §4
//   warns only on present-but-invalid values) and a throwing trap is skipped fail-safe (no throw, no warn).
//   NEVER use `in`, destructuring, Object.keys, or {...obj} on `raw` — they all invoke traps. (GOTCHA #1)

// ── PATTERN: lazy cache + defensive copy ───────────────────────────────────
let cachedConfig: MulliganConfig | null = null;
export function getConfig(): MulliganConfig {
  let cfg = cachedConfig;
  if (cfg === null) { cfg = validateConfig(undefined); cachedConfig = cfg; } // lazy
  return structuredClone(cfg);                                               // never hand out the cache ref
}
//   `let cfg = cachedConfig` captures the type into a const-like local so TS keeps the MulliganConfig
//   narrowing (avoids any "possibly null" widening on the module-level let). (GOTCHA #2b, #9)

// ── PATTERN: number validation (Number.isFinite, never Number()/isFinite()) ─
function coerceNumber(field, value, fallback, mustBePositive) {
  if (typeof value === "number" && Number.isFinite(value) && (mustBePositive ? value > 0 : value >= 0))
    return value;
  warnConfig(field, value); return fallback;
}
//   `Number.isFinite("8192")` is false (no coercion); global `isFinite("8192")` is true; `Number("")` is 0.
//   (GOTCHA #4)

// ANTI-PATTERNS (do NOT do any of these):
//   - raw.enabled                         // throws if raw is a throwing Proxy → use safeGet
//   - "enabled" in raw                    // invokes the `has` trap → can throw
//   - const { rewind } = raw              // destructuring invokes get trap → can throw
//   - Number(value) / isFinite(value)     // coerces silently; use Number.isFinite + typeof (GOTCHA #4)
//   - value as EstimateConfidence         // bypasses validation; use strict === enum check (GOTCHA #6)
//   - structuredClone(raw)                // raw may contain a function → DataCloneError; only clone DEFAULT_CONFIG/cache
//   - cachedConfig = validateConfig(raw)  // outside a try/catch in setConfig → a throw escapes; wrap it (GOTCHA #1)
//   - return cachedConfig                 // hands out the shared cache ref → callers can poison it; return a clone (GOTCHA #2b)
//   - return DEFAULT_CONFIG               // violates S1's "never this object itself" JSDoc; return a clone
//   - import { ... } from "@earendil-works/pi-coding-agent"  // config.ts stays Pi-free (grep gate)
//   - creating/importing src/log.ts       // log.ts is P1.M1.T3; use the console.warn stand-in (GOTCHA #8)
//   - reading settings.json / fs / process.env  // not S2's job; settings are handed in via setConfig (P1.M7 wiring)
```

### Integration Points

```yaml
MODULE PLACEMENT:
  - file: src/config.ts   (APPEND to the S1 file; do not alter its existing exports)
  - this subtask owns: getConfig() + setConfig() + validateConfig() + cache + private helpers
  - S1 (P1.M1.T2.S1) owned: the interface + DEFAULT_CONFIG (UNCHANGED)

DOWNSTREAM CONSUMERS (created by LATER subtasks — do NOT create/wire here, just satisfy their contract):
  - P1.M7.T1 index.ts factory   → calls setConfig((settings as any).mulligan) in the factory + on session_start
                                   (reason "reload") to implement spec/09 §1 "re-read on /reload".
  - P1.M4.T2 filter.ts          → const config = getConfig(); if (!config.enabled) return; reads
                                   config.rewind.{protectedRoles,maxDepth}, config.shrink.enabled, config.nudges.perTurnDrift
  - P1.M5 tools/*               → getConfig(); read config.rewind.enabled, config.shrink.enabled,
                                   config.rewind.requireMutationWarning, config.audit.estimateConfidence
  - P1.M6 nudges.ts             → getConfig(); read config.nudges.{bloatReminder,perTurnDrift,
                                   bloatThresholdBytes,driftThresholdTokens}
  - P1.M1.T3 log.ts             → will read config.log.file (S2 only VALIDATES it; opening is deferred to T3).
                                   When T3 ships, it MAY re-point the private warnConfig() helper to its
                                   structured LogLine (level "warn") — S2 isolates all warns behind that ONE helper.

CONFIG / DATABASE / ROUTES:
  - none at runtime in THIS subtask. No DB, no routes, no env vars, no filesystem access.
  - setConfig() receives the settings object from index.ts (Pi-free contract).
```

---

## Validation Loop

### Level 1: Syntax & Style (deterministic; run after Task 1)

```bash
cd /home/dustin/projects/pi-mulligan   # repo root

# (a) The S1 exports are STILL present, each exactly once (unmodified contract — GOTCHA #10):
grep -c 'export type Granularity' src/config.ts                       # expect 1
grep -c 'export type EstimateConfidence' src/config.ts                # expect 1
grep -c 'export interface MulliganConfig' src/config.ts               # expect 1
grep -c 'export const DEFAULT_CONFIG: MulliganConfig' src/config.ts   # expect 1

# (b) The S2 exports are present, each exactly once:
grep -c 'export function getConfig' src/config.ts        # expect 1
grep -c 'export function setConfig' src/config.ts        # expect 1
grep -c 'export function validateConfig' src/config.ts   # expect 1
grep -c 'UNSET' src/config.ts                             # expect 0  (no UNSET sentinel — GOTCHA #11)

# (c) Scope discipline: ZERO runtime Pi/typebox imports (config.ts stays dependency-free — GOTCHA: grep=0):
grep -cE 'import .*(pi-coding-agent|typebox)' src/config.ts   # expect 0

# (d) never-throw scaffolding present (GOTCHA #1):
grep -c 'return structuredClone(DEFAULT_CONFIG);' src/config.ts   # expect >=2  (validateConfig catch + base)

# (e) TYPE-CHECK — the primary gate. Proves (i) type-sound, (ii) structuredClone global resolves,
#     (iii) S1 exports untouched, (iv) EstimateConfidence narrowing in coerceEstimateConfidence.
npx tsc --noEmit -p tsconfig.json && echo "TSC OK (exit 0)" || echo "TSC FAILED"
# Expected: "TSC OK (exit 0)". Common failures & fixes:
#   - "Property 'has' does not exist on Set in …" → you forgot the `typeof entry === "string"` guard (GOTCHA #5).
#   - "Argument of type 'unknown' is not assignable to 'EstimateConfidence'" → you returned an un-narrowed value (GOTCHA #6).
#   - "Cannot find name 'structuredClone'" → should NOT happen (verified typed); if it does, the tsconfig
#     `types` is wrong — do NOT add an import; ensure types:["node"] is intact.
```

### Level 2: Unit Tests (run after Task 2 — the behavioral gate)

```bash
# The config test file (S1's 3 + S2's new suites). This IS the runtime validation for this pure module.
npx vitest run test/config.test.ts
# Expected: ALL green. S1's describe('DEFAULT_CONFIG') (3) + describe('validateConfig') (~12) +
#           describe('getConfig / setConfig cache') (~6) + describe('getConfig lazy init') (~1).

# Full suite (catches accidental regressions if other test files exist later):
npx vitest run
# Expected: all green.
```

### Level 3: Integration Testing

> **Largely N/A for this subtask in isolation.** `config.ts` is **not yet imported by `src/index.ts`** (that
> wiring is P1.M7.T1), so there is no Pi runtime surface to integration-test here. `config.ts` is a **pure**
> module (no Pi, no FS, no process) — the vitest suite in Level 2 IS its runtime validation, including the
> adversarial never-throw cases. The real Pi integration (config consumed by filter/tools/nudges; setConfig
> called from the factory) is verified in P1.M4 / P1.M5 / P1.M6 / P1.M7.
>
> Optional regression (exercises the S2 stub load path, NOT config directly): `pi -e ./src/index.ts -p "hi"`
> should still load without error (config.ts is not imported by index.ts yet, so this only proves the
> scaffold is intact). Skip if `pi` is unavailable in the env.

### Level 4: Creative & Domain-Specific Validation (the fail-safe + immutability guarantees)

```bash
# These guarantees are encoded as vitest cases (Level 2), but you can also assert them directly:

# (a) NEVER-THROW on adversarial input — quick direct check via vitest's inline runner:
npx vitest run test/config.test.ts -t "NEVER throws on adversarial input"
npx vitest run test/config.test.ts -t "setConfig never throws on garbage input"
# Expected: both pass (circular refs, throwing Proxy getters, nested invalid values → defaults, no throw).

# (b) SINGLETON + CACHE immutability:
npx vitest run test/config.test.ts -t "does not mutate DEFAULT_CONFIG"
npx vitest run test/config.test.ts -t "hands out independent copies"
npx vitest run test/config.test.ts -t "never exposes DEFAULT_CONFIG by reference"
# Expected: all pass (DEFAULT_CONFIG never mutated; cache never poisoned by a caller).

# (c) Spec §4 per-field behavior:
npx vitest run test/config.test.ts -t "coerces booleans"
npx vitest run test/config.test.ts -t "validates numbers"
npx vitest run test/config.test.ts -t "filters protectedRoles"
npx vitest run test/config.test.ts -t "estimateConfidence enum"
npx vitest run test/config.test.ts -t "validates log.file"
# Expected: all pass — these pin the exact spec/09 §4 rules.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] Task 0 baseline was green BEFORE editing (`tsc` exit 0; `vitest run test/config.test.ts` 3/3).
- [ ] Level 1 passes: the four S1-export `grep -c` checks each print 1; the three S2-export `grep -c` checks
      each print 1; the Pi/typebox import `grep -c` prints 0; `npx tsc --noEmit -p tsconfig.json` prints
      "TSC OK (exit 0)".
- [ ] Level 2 passes: `npx vitest run test/config.test.ts` is all-green; `npx vitest run` is all-green.

### Feature Validation (spec/09 §1 + §4 compliance)
- [ ] `validateConfig` deep-merges partial valid overrides over a clone of DEFAULT_CONFIG.
- [ ] Booleans coerce with `!!` (incl. `"false"`→true, `null`→false); absent→default.
- [ ] Numbers require `typeof === "number"` && `Number.isFinite` && sign rule (thresholds >0, maxDepth >=0);
      strings/NaN/Infinity → default (no coercion).
- [ ] `protectedRoles` filters to `{"first:user","latest:user"}`; non-array → default; unknown entries dropped.
- [ ] `estimateConfidence` accepts only `low|medium|high`; else `medium`.
- [ ] `log.file`: null/`string` accepted; non-string → null.
- [ ] Unknown keys ignored (incl. `shrink.autoOnBloat`).
- [ ] **Never throws** on adversarial input (circular refs, throwing Proxy, primitives, arrays).
- [ ] `getConfig` is lazy (cache null → validate defaults) + cached; returns a defensive copy every call.
- [ ] `setConfig` validates + replaces the cache and never throws (resets to defaults on error).

### Code Quality / Convention Validation
- [ ] S1 exports (`Granularity`, `EstimateConfidence`, `MulliganConfig`, `DEFAULT_CONFIG`) are UNCHANGED.
- [ ] S1's `describe("DEFAULT_CONFIG")` test block is UNCHANGED.
- [ ] ZERO runtime imports from `@earendil-works/pi-coding-agent` / `typebox` (config.ts stays pure).
- [ ] `structuredClone` used as a bare global (no import); only ever clones DEFAULT_CONFIG / the cache, never `raw`.
- [ ] All property reads on `raw` go through `safeGet` (no bare `.x`, no `in`, no destructuring, no spread).
- [ ] All warns flow through the single `warnConfig` helper (wrapped in try/catch), ready to re-point to log.ts (T3).
- [ ] camelCase functions; helpers are module-private (not exported); no `console.*` except inside `warnConfig`.

### Documentation & Deployment
- [ ] JSDoc on `getConfig`, `setConfig`, `validateConfig` states lazy/cached/defensive-copy and never-throws.
- [ ] JSDoc notes the `console.warn` stand-in is to be re-pointed to the structured logger when T3 ships.
- [ ] No new env vars; no FS/process/Pi access; no user-facing README changes (README is P1.M7.T4).
- [ ] No files other than `src/config.ts` and `test/config.test.ts` are created or modified; `index.ts`,
      `package.json`, `tsconfig.json`, `.gitignore`, `plan/`, `spec/` untouched.

---

## Anti-Patterns to Avoid

- ❌ Don't modify the S1 exports (Granularity/EstimateConfidence/MulliganConfig/DEFAULT_CONFIG) or the S1
      test block — the S2 section lives BELOW DEFAULT_CONFIG. If a prior S2 attempt is already present,
      REPLACE it wholesale (GOTCHA #11): never keep the buggy `UNSET` version, and never append a second copy
      (that would redeclare exports and fail `tsc`).
- ❌ Don't read `raw` properties with `.x`, `in`, destructuring, or `{...raw}` — a throwing Proxy trap escapes
  (use `safeGet`; the top-level `catch` is the backstop) (GOTCHA #1).
- ❌ Don't `structuredClone(raw)` — `raw` may contain a function/symbol → `DataCloneError`. Only clone
  `DEFAULT_CONFIG` and the already-validated cache (GOTCHA #2).
- ❌ Don't hand out the cache reference (`return cachedConfig`) or `DEFAULT_CONFIG` itself — always return a
  fresh clone so callers can't poison the session or mutate the default (GOTCHA #2).
- ❌ Don't use `Number(value)` / global `isFinite()` / `parseInt` for numbers — they silently coerce strings
  and `""`/`null`→0. Use `typeof === "number" && Number.isFinite(...)` (GOTCHA #4).
- ❌ Don't `as EstimateConfidence` or `Array.includes` on `unknown` — validate with strict `===` enum checks
  (GOTCHA #6).
- ❌ Don't import from `@earendil-works/pi-coding-agent` or `typebox`, and don't create/import `src/log.ts` —
  config.ts is pure; warns use the wrapped `console.warn` stand-in (GOTCHA #8).
- ❌ Don't read `settings.json` / touch the filesystem / read env vars — settings are handed in via
  `setConfig` from `index.ts` (P1.M7 wiring); S2 only exposes the seam.
- ❌ Don't warn for booleans (`!!` always coerces) or for `log.file: null` (the valid "off" sentinel) — only
  warn for *present-but-invalid* numbers/enums/protectedRoles/logFile values (GOTCHAs #3, #7).
- ❌ Don't forget to reset the cache between tests (`beforeEach(() => setConfig(undefined))`; use
  `vi.resetModules()` for the lazy-null path) — vitest doesn't reset module state by default (GOTCHA #9).
- ❌ Don't modify `package.json`, `tsconfig.json`, `.gitignore`, or anything in `plan/`/`spec/` (PRP rules).

---

## Confidence Score: 10/10

The exact code to append (Task 1) and the exact tests (Task 2) are given verbatim; the authoritative rules
(`spec/09 §1` + `§4`) are reproduced and encoded one-to-one in the coercion helpers; and the verbatim Task 1
code was EXECUTED end-to-end in a scratch harness (repo's `tsc 5.9.3` under the exact tsconfig → exit 0; then
transpiled with the repo's `esbuild` and run under Node 26 → 30/30 behavioral assertions pass, including
never-throw on circular refs + throwing Proxy, DEFAULT_CONFIG immutability, and cache-copy independence):
- `structuredClone` is verified typed as a global under `types:["node"]` (declared in
  `@types/node/worker_threads.d.ts` `global{}`) and `tsc` accepts it with no import (GOTCHA #2).
- The S1 baseline is verified live-green (`tsc` exit 0; `vitest` 3/3) before S2 starts (Task 0).
- The never-throw requirement is handled at TWO layers (per-read `safeGet` returning `undefined` on a
  throwing trap + whole-body try/catch), and pinned by adversarial tests (circular refs, throwing Proxy)
  (GOTCHA #1). Verified: a throwing-Proxy input yields all defaults with NO warn and NO throw.
- Singleton + cache immutability is enforced by `structuredClone` on both the merge base and every
  `getConfig()` return, and pinned by mutation tests (GOTCHA #2).
- Absent-vs-invalid warn discipline is correct: a PARTIAL valid override (e.g. `{nudges:{bloatThresholdBytes:100}}`)
  emits ZERO warns — absent sibling fields keep their default silently; warns fire ONLY for present-but-invalid
  values (verified). This required dropping an earlier `UNSET`-symbol sentinel (which read absent props as the
  symbol and over-warned) in favor of `undefined`-as-absence.
- The Pi-free, log.ts-free constraints are explicit, with a `console.warn` stand-in isolated behind one
  helper for easy T3 re-pointing (GOTCHA #8).

The only residual risk is the `vi.resetModules()` + dynamic-import lazy test (GOTCHA #9): across some vitest
configurations module-reset can interact subtly with sibling suites. The PRP explicitly marks that one
`describe` block as a nice-to-have (the lazy branch is otherwise trivially evident and covered by the
"defaults after reset" test), so even if it is dropped the subtask still fully meets its contract. Every
other gate is deterministic (`tsc`) or behaviorally pinned (`vitest`), and the verbatim code has already
been observed passing them.