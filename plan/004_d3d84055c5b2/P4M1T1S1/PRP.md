---
name: "P4.M1.T1.S1 — Add rewind.maxRetriesPerPrompt + rewind.abortContextFraction config knobs"
description: "Add two E22 backstop knobs to MulliganConfig.rewind (interface + defaults + fail-safe validation + JSDoc) in src/config.ts, and fix the 2 snapshot assertions in test/config.test.ts that break when DEFAULT_CONFIG.rewind grows. Keep `npm test` green. Detailed validation tests are a separate task (P4.M1.T3.S1)."
---

## Goal

**Feature Goal**: Extend `MulliganConfig.rewind` in `src/config.ts` with two new configuration knobs that back the E22 runaway-loop hard backstops (consumed by P4.M1.T2.S1/S2 in `src/tools/rewind.ts`):

1. `rewind.maxRetriesPerPrompt` — integer ≥ 1, **default 5**. Caps *consecutive* rewinds that re-land at the same latest user prompt (the per-prompt retry budget).
2. `rewind.abortContextFraction` — number in the half-open interval **(0, 1]**, **default 0.9**. Refuses any rewind once the filtered-context estimate reaches this fraction of the model's window (the zero-marker loop backstop).

Both knobs must be present on every `getConfig()`/`validateConfig()` result with a valid value, validated fail-safe (never throw), and documented with JSDoc on the interface fields.

**Deliverable**: A single source file edit to `src/config.ts` (interface + `DEFAULT_CONFIG` + `validateConfig` rewind block + JSDoc) plus a minimal fix to the two existing full-shape `toEqual` snapshot assertions in `test/config.test.ts` that would otherwise break. The TypeScript compile and the full `vitest` suite remain green.

**Success Definition**:
- `cfg.rewind.maxRetriesPerPrompt` and `cfg.rewind.abortContextFraction` are always valid (`integer >= 1` and `number in (0,1]` respectively) on any `validateConfig()` / `getConfig()` result, regardless of input.
- `DEFAULT_CONFIG` deep-equals the spec/09 §2 JSON shape (now including the two new rewind fields).
- Absent fields keep their default **silently** (no warn); present-but-invalid values fall back to the default **with exactly one `warnConfig` naming the field and value**.
- `validateConfig` never throws on adversarial input (pre-existing invariants preserved).
- `npm test` is green (zero failures) after this change in isolation.
- `npx tsc --noEmit` passes (strict mode).

## Why

- **Business value**: These are the two config knobs backing E22 (`spec/08-edge-cases.md` §E22) — the most severe Mulligan failure mode: a same-prompt rewind retry loop that grows the session until the provider rejects the next request as "Prompt too long", at which point the human cannot even send a new message. `maxRetriesPerPrompt` is the marker-counting budget; `abortContextFraction` is the wall-clock backstop that catches the zero-marker loop vector the budget cannot see.
- **Scope position**: This is the **root config subtask** of P4 (Runaway-loop hard backstops). P4.M1.T2.S1 consumes `maxRetriesPerPrompt`; P4.M1.T2.S2 consumes `abortContextFraction`. Nothing in P4 beyond this task can start until these knobs exist and validate. P4.M1.T3.S1 writes the detailed validation tests.
- **Problems solved / for whom**: Gives the rewind tool (and, indirectly, the human via `settings.json`) two independent hard limits. The defaults (5, 0.9) restore near-old loop-tolerance while still arresting a true runaway.

## What

User-visible behavior: none directly (this is a config-layer change). After this task, `settings.json` may carry:

```jsonc
{ "mulligan": { "rewind": {
  "maxRetriesPerPrompt": 5,
  "abortContextFraction": 0.9
} } }
```

and those values are validated/coerced by `validateConfig`. Invalid values fall back to the default with a console warn; `validateConfig` never throws.

### Success Criteria

- [ ] `MulliganConfig.rewind` interface declares `maxRetriesPerPrompt: number;` and `abortContextFraction: number;`, each with a JSDoc comment citing `@08 E22` and the default, placed after `maxDepth` and before `requireMutationWarning` (matching spec/09 §2 JSON field order: `maxDepth, maxRetriesPerPrompt, abortContextFraction, requireMutationWarning`).
- [ ] `DEFAULT_CONFIG.rewind` sets `maxRetriesPerPrompt: 5,` and `abortContextFraction: 0.9,` in the same relative position.
- [ ] `validateConfig` coerces/validates both fields per spec/09 §4 rules:
  - `maxRetriesPerPrompt`: integer ≥ 1; non-integer or `<1` → default.
  - `abortContextFraction`: number in (0,1]; out of range or non-number → default.
- [ ] Present-but-invalid values produce exactly one `warnConfig(field, value)` and fall back to the default; absent values are silent.
- [ ] `npm test` green; `npx tsc --noEmit` clean.
- [ ] spec/09-configuration.md is NOT modified (it is already at the target state — source of truth). README is NOT modified (P4.M3).

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ **Yes** — every edit location is given with verified line numbers, the exact code to write is specified, the sibling patterns to follow are named, and the two existing tests that must be updated (or the suite breaks) are identified precisely.

### Documentation & References

```yaml
# MUST READ — the spec sections that define this feature
- url: spec/09-configuration.md §2 (lines ~16-46) and §4 (lines ~88-94)
  why: §2 is the canonical JSON schema + defaults + field order; §4 line 92-93 give the EXACT validation rules ("maxRetriesPerPrompt: integer ≥ 1; non-integer or <1 → default" and "abortContextFraction: number in (0,1]; out of range or non-number → default"). §1 line ~31 + §6 cross-ref confirm WHERE knobs are enforced (rewind tool, NOT config).
  critical: §4 ALSO states the global rule "On any per-field validation failure: log a warn naming the field and the value, use the default, continue. Never throw." This task must honor it.
- url: spec/08-edge-cases.md §E22 (heading "Same-prompt rewind retry loop")
  why: E22 defines both backstops and the exact refusal semantics the consuming tasks (T2.S1/S2) implement. The "Config:" line at the end of E22 restates the two knobs + defaults + ranges and points back to spec/09. Cite E22 in the interface JSDoc per the item contract.
  critical: E22 acceptance (a)-(g) are about the TOOL behavior, NOT this config task — but they motivate the ranges. Do not implement E22 tool behavior here.

# MUST READ — the file you are editing (primary deliverable)
- file: src/config.ts
  why: This is the ONLY source file to change. It contains the MulliganConfig interface, DEFAULT_CONFIG, validateConfig, and all private coerce/warn helpers.
  pattern: The `highWaterFraction` inline-fraction check (lines 256-259) is the EXACT pattern for abortContextFraction — adapted from `(0,1)` to `(0,1]` (see GOTCHA). The `driftWindowTurns` integer pattern (lines 251-254) is the basis for maxRetriesPerPrompt — but ADD the `Math.floor(n) >= 1` guard the item contract requires (driftWindowTurns omits it).
  gotcha: "absent ≠ invalid" — the `if (v !== undefined)` guard MUST wrap each new field exactly like its siblings, so an absent key keeps the default SILENTLY (no warn). A present-but-invalid value is what triggers warnConfig.

# MUST READ — the test file you must keep green
- file: test/config.test.ts
  why: Two existing `toEqual` snapshot assertions encode the full rewind shape and WILL FAIL when DEFAULT_CONFIG.rewind grows. This task must update those two assertions (Implementation Task 5). Detailed validation tests belong to P4.M1.T3.S1 — do not write them here.
  pattern: The `shrink.maxActive & staleAfterFires` describe block (lines ~229-310) and the `nudges.driftWindowTurns & highWaterFraction` describe block (lines ~313+) are the templates T3.S1 will follow for the new knobs' validation tests.
  gotcha: vitest 1.6.1 with `vi.spyOn(console, "warn").mockImplementation(...)` + try/finally warn.mockRestore() is the established warn-counting pattern (see lines 113-161). Do not import anything new to assert warns.

# Grounded research (read for line-number accuracy + the breakage analysis)
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md §1
  why: Verifies the config.ts edit points and the exact coerceNumber/inline-pattern split. (Note: line numbers there cite commit 0bcaa814; the CURRENT working-tree line numbers are slightly different and are reconciled in this PRP's tasks.)
- docfile: plan/004_d3d84055c5b2/P4M1T1S1/research/findings.md
  why: Verified current-tree line numbers + the full breakage analysis (which existing tests break, which do not) + the maxRetriesPerPrompt (0,1) edge-case behavior.
```

### Current Codebase tree (relevant subset)

```bash
pi-mulligan/
├── package.json          # "test": "vitest run" ; NO tsc/eslint/prettier scripts
├── tsconfig.json         # strict:true, moduleResolution:Bundler, include:["src","test"]
├── spec/
│   ├── 08-edge-cases.md  # §E22 — the feature this backs (READ-ONLY, already committed)
│   └── 09-configuration.md # §1/§2/§4 — source of truth (READ-ONLY, already committed)
├── src/
│   └── config.ts         # ← EDIT: interface + DEFAULT_CONFIG + validateConfig + JSDoc
└── test/
    ├── config.test.ts    # ← EDIT: fix 2 broken toEqual snapshots
    └── (others unchanged: edge-cases, transforms, etc. use Partial configs)
```

### Desired Codebase tree (files touched)

```bash
src/config.ts        # MODIFIED — 2 interface fields + 2 defaults + 2 validation blocks + JSDoc
test/config.test.ts  # MODIFIED — 2 toEqual expected-literals gain the 2 new rewind defaults
```
No new files. No other files change.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — abortContextFraction uses an INCLUSIVE upper bound; highWaterFraction does NOT.
//   spec: abortContextFraction ∈ (0,1]  → condition: v > 0 && v <= 1   ← INCLUSIVE (v <= 1)
//   spec: highWaterFraction   ∈ (0,1)   → condition: v > 0 && v <  1   ← EXCLUSIVE (existing)
//   The single character difference (`<=` vs `<`) is the whole point of this knob.
//   Do NOT copy highWaterFraction's line verbatim — change `< 1` to `<= 1`.

// CRITICAL #2 — coerceNumber has NO upper bound, so abortContextFraction CANNOT use it.
//   coerceNumber(field, value, fallback, mustBePositive) enforces finite + (>0 or >=0) ONLY.
//   For abortContextFraction you MUST use the inline typeof/Number.isFinite/range check
//   (the highWaterFraction pattern), NOT coerceNumber.

// CRITICAL #3 — maxRetriesPerPrompt needs coerceNumber AND Math.floor AND a `>= 1` guard.
//   coerceNumber(..., true) gives "finite and > 0" — but 0.5 passes that (>0) and floors to 0.
//   So: const n = coerceNumber(..., true); then Math.floor(n) only if Math.floor(n) >= 1,
//   else keep default. This guard is REQUIRED by the item contract (driftWindowTurns omits it).

// GOTCHA #4 — "absent ≠ invalid" (the if (v !== undefined) discipline).
//   safeGet returns undefined for BOTH absent keys and throwing-Proxy traps. The
//   `if (v !== undefined)` wrapper must skip those (silent default). warnConfig fires ONLY
//   for a genuinely-present-but-invalid value. Every sibling follows this; so must the new fields.

// GOTCHA #5 — DEFAULT_CONFIG is a shared singleton; validateConfig deep-clones it first
//   (structuredClone at the top of validateConfig). You are editing the singleton literal, not a
//   clone — that's correct and intended.

// GOTCHA #6 — maxRetriesPerPrompt EDGE CASE (documented, not a bug): a value in (0,1), e.g. 0.5,
//   passes coerceNumber(true) without warning (0.5 > 0), then Math.floor(0.5)=0 < 1, so the
//   default (5) is kept with NO warn. This silent fallback is the item contract's specified
//   behavior. To exercise the WARN path in tests use {0, -1, NaN, "abc", Infinity} (which fail
//   coerceNumber's >0 check), NOT fractional (0,1) values.

// GOTCHA #7 — TypeScript `strict`. Adding REQUIRED fields to the interface is ADDITIVE: existing
//   code reading the interface keeps compiling. The only full MulliganConfig literal in the repo is
//   DEFAULT_CONFIG (which this task updates). All test files use Partial configs type-asserted as
//   `ProtectedConfig`, so they do not break at compile time. (Verified: grep found no other full
//   MulliganConfig literal.)

// LIBRARY QUIRK — vitest does NOT type-check by default (esbuild transpile only). `npm test`
//   passing does NOT prove types are correct. Run `npx tsc --noEmit` explicitly to gate types.
//   package.json has no `tsc`/`lint`/`format` script — call tsc directly.
```

## Implementation Blueprint

### Data models and structure

This task changes the `MulliganConfig` TypeScript interface (a plain structural type; no ORM/Pydantic). The two new fields are primitive numbers with range invariants enforced in `validateConfig` (not at the type level — TS has no literal-range types here).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/config.ts — MulliganConfig.rewind interface (add 2 fields + JSDoc)
  - FIND: the rewind interface block. Fields are at current lines 40-43:
      `maxDepth: number;`        (line 41)
      `requireMutationWarning: boolean;`  (line 42)
  - INSERT between `maxDepth` (line 41) and `requireMutationWarning` (line 42), matching
    spec/09 §2 JSON order (maxDepth, maxRetriesPerPrompt, abortContextFraction, requireMutationWarning):
      /** Max CONSECUTIVE rewinds re-landing at the same latest user prompt before the tool
       *  refuses (the runaway-loop bound; `@08-edge-cases.md` E22). Distinct from `maxDepth`
       *  (which bounds cumulative markers): a loop can persist while re-bloating between
       *  rewinds, so depth alone cannot stop it. Integer ≥ 1. Default: 5. Consumed by
       *  P4.M1.T2.S1 (the per-prompt retry budget guard in src/tools/rewind.ts). */
      maxRetriesPerPrompt: number;
      /** Wall-clock backstop: refuse any rewind once the filtered-context estimate reaches
       *  this fraction of the model's window (catches the zero-marker loop vector the
       *  retry budget cannot see; `@08-edge-cases.md` E22). Number in (0,1]. Default: 0.9
       *  (leaves headroom below the provider's "Prompt too long" rejection). Consumed by
       *  P4.M1.T2.S2 (the context-fraction stop guard in src/tools/rewind.ts). */
      abortContextFraction: number;
  - NAMING: camelCase fields (matches maxDepth, requireMutationWarning).
  - JSDoc MUST cite `@08-edge-cases.md` E22 and the default (item contract §3d).

Task 2: EDIT src/config.ts — DEFAULT_CONFIG.rewind (add 2 defaults)
  - FIND: the DEFAULT_CONFIG.rewind object literal (lines 117-120):
      maxDepth: 5,                 (line 118)
      requireMutationWarning: true, (line 119)
  - INSERT between maxDepth and requireMutationWarning (same order as Task 1):
      maxRetriesPerPrompt: 5,
      abortContextFraction: 0.9,
  - VALUES: 5 and 0.9 EXACTLY (spec/09 §2; item contract §2). No trailing comment needed
    (the inline JSDoc on the interface fields is the documentation).

Task 3: EDIT src/config.ts — validateConfig rewind block (add 2 validation blocks)
  - FIND: the rewind validation block, lines 223-226:
      v = safeGet(rewindRaw, "maxDepth");                                  (line 223)
      if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);  (line 224)
      v = safeGet(rewindRaw, "requireMutationWarning");                    (line 225)
      if (v !== undefined) cfg.rewind.requireMutationWarning = coerceBoolean(v, cfg.rewind.requireMutationWarning);  (line 226)
  - INSERT after the maxDepth lines (223-224) and BEFORE the requireMutationWarning lines (225-226):
      v = safeGet(rewindRaw, "maxRetriesPerPrompt");
      if (v !== undefined) {
        const n = coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true);
        cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
      }
      v = safeGet(rewindRaw, "abortContextFraction");
      if (v !== undefined) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) cfg.rewind.abortContextFraction = v;
        else warnConfig("rewind.abortContextFraction", v);
      }
  - WHY this exact code:
      * maxRetriesPerPrompt: coerceNumber(...,true) returns fallback+warn for {0,-1,NaN,"abc",Infinity}
        (those fail the >0 / finite checks), then the Math.floor(n)>=1 ternary normalizes a valid
        float (e.g. 5.7→5) and rejects floor<1. Reuses `v` and `cfg` already in scope (the block
        declares `let v: unknown;` above and `const cfg = structuredClone(DEFAULT_CONFIG)`).
      * abortContextFraction: the INLINE check (NOT coerceNumber — coerceNumber has no upper bound).
        `v <= 1` is the INCLUSIVE upper bound — the critical difference from highWaterFraction's `v < 1`.
  - PRESERVE: the surrounding `const rewindRaw = safeGet(raw, "rewind"); if (isRecord(rewindRaw)) { ... }`
    wrapper, the existing maxDepth + requireMutationWarning lines, and the single try/catch around the
    whole validateConfig body (never throws — do not add a second try/catch).

Task 4: EDIT test/config.test.ts — fix the 2 broken full-shape toEqual snapshots
  - WHY: adding fields to DEFAULT_CONFIG.rewind makes these two `toEqual` assertions fail unless
    their expected literals also carry the two new fields. Detailed validation tests are P4.M1.T3.S1;
    here we only keep the suite green.
  - 4a. FIND the "matches the spec/09 §2 defaults exactly" test (lines ~9-31). Its expected literal's
        rewind block is currently:
          rewind: {
            enabled: true,
            protectedRoles: ["first:user", "latest:user"],
            maxDepth: 5,
            requireMutationWarning: true,
          },
        ADD, between maxDepth and requireMutationWarning:
            maxRetriesPerPrompt: 5,
            abortContextFraction: 0.9,
  - 4b. FIND the "applies a full valid override" test (lines ~62-82). Its expected literal's rewind
        block is currently:
          rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, requireMutationWarning: false },
        The INPUT override (line ~64) only sets 4 fields, so deep-merge fills the two new fields with
        DEFAULTS (5, 0.9). Therefore the EXPECTED literal (assertion side, line ~76) must ALSO gain:
          rewind: { enabled: false, protectedRoles: ["first:user"], maxDepth: 2, maxRetriesPerPrompt: 5, abortContextFraction: 0.9, requireMutationWarning: false },
        (Match spec/09 field order: maxDepth, maxRetriesPerPrompt, abortContextFraction, requireMutationWarning.)
        NOTE: you do NOT need to touch the INPUT override object — defaults fill the gaps.
  - 4c. VERIFY no other test breaks: `npm test` after Tasks 1-3 should show ONLY these two failures
        (plus their type-level sibling if any). The partial-config tests in edge-cases.test.ts,
        transforms.test.ts, bug-replay-repro.test.ts, and config.test.ts's single-field .toBe checks
        and the "ignores unknown keys" toEqual-vs-toEqual are NOT affected (confirmed in research/findings.md).
```

### Implementation Patterns & Key Details

```ts
// ── The maxRetriesPerPrompt integer-coercion pattern (adapted from driftWindowTurns + the >=1 guard) ──
// Existing driftWindowTurns (src/config.ts nudges block) is the sibling WITHOUT the >=1 guard:
//   const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
//   cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
// maxRetriesPerPrompt adds the `Math.floor(n) >= 1` predicate inside the ternary's condition:
v = safeGet(rewindRaw, "maxRetriesPerPrompt");
if (v !== undefined) {
  const n = coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true);
  cfg.rewind.maxRetriesPerPrompt =
    Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
}

// ── The abortContextFraction inline-fraction pattern (adapted from highWaterFraction) ──
// Existing highWaterFraction (nudges block) — note the EXCLUSIVE `v < 1`:
//   if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;
//   else warnConfig("nudges.highWaterFraction", v);
// abortContextFraction changes `< 1` to `<= 1` (INCLUSIVE — spec says (0,1]):
v = safeGet(rewindRaw, "abortContextFraction");
if (v !== undefined) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1) cfg.rewind.abortContextFraction = v;
  else warnConfig("rewind.abortContextFraction", v);
}

// ── What NOT to do ──
// ✗ Do NOT call coerceNumber for abortContextFraction (no upper bound).
// ✗ Do NOT reuse highWaterFraction's `v < 1` verbatim — abortContextFraction is inclusive.
// ✗ Do NOT add a separate try/catch (the whole validateConfig body is already wrapped).
// ✗ Do NOT add the detailed validation test cases here (that is P4.M1.T3.S1).
// ✗ Do NOT edit spec/09-configuration.md (already at target) or README.md (P4.M3).
```

### Integration Points

```yaml
CONFIG (this IS the config layer — no external integration to wire):
  - The new fields are read by P4.M1.T2.S1 (config.rewind.maxRetriesPerPrompt) and
    P4.M1.T2.S2 (config.rewind.abortContextFraction) via getConfig() / the `config` already
    fetched in rewindExecute step 1. No wiring change needed here — the fields simply become
    present and valid on every config object.

TYPES:
  - Adding REQUIRED number fields to MulliganConfig.rewind is additive; no consumer breaks.
    The only full-literal consumer (DEFAULT_CONFIG) is updated in Task 2.

DOCS (Mode A — no external doc surface in this subtask):
  - spec/09-configuration.md: READ-ONLY (already committed at 3ff35059; it is the source of truth
    the interface JSDoc should cite).
  - README.md: NOT in this task (P4.M3.T1 adds the config-table rows + blurb).
  - The interface JSDoc added in Task 1 IS this subtask's inline documentation deliverable.
```

## Validation Loop

### Level 1: Syntax & Type (Immediate Feedback)

```bash
# 1a. TypeScript strict type-check. vitest does NOT type-check; run tsc explicitly.
#     (package.json has no `tsc` script — call it directly.)
npx tsc --noEmit
# Expected: zero errors. The new fields are required on the interface and present on DEFAULT_CONFIG,
# so types stay consistent. If tsc reports an error on a test file's full-config literal, that test
# was missed in Task 4 — add the two fields to its expected literal too.

# 1b. Confirm no formatter/linter is configured (there is none in package.json), so skip
#     ruff/eslint/prettier equivalents.
```

### Level 2: Unit Tests (Component Validation)

```bash
# 2a. The config test file (must be green after Task 4).
npx vitest run test/config.test.ts
# Expected: ALL tests pass. The two snapshot tests ("matches the spec/09 §2 defaults exactly" and
# "applies a full valid override") pass because their expected literals now include the two new fields.
# The pre-existing driftWindowTurns/highWaterFraction/shrink/maxDepth tests are unaffected.

# 2b. Full suite — confirm the change did not break any other test file.
#     (edge-cases, transforms, bug-replay-repro use Partial configs and must stay green.)
npm test            # == `vitest run`
# Expected: ALL tests pass, zero failures.
```

### Level 3: Manual sanity checks (quick, no harness needed)

```bash
# 3a. Confirm the two knobs appear on DEFAULT_CONFIG with the spec defaults, in spec field order.
node --input-type=module -e '
  import("./src/config.ts").then(async () => {
    const { DEFAULT_CONFIG, validateConfig } = await import("./src/config.ts").catch(()=>null) || {};
  });
' 2>/dev/null || echo "(node cannot run .ts directly — rely on the vitest snapshot test instead)"
# NOTE: src/config.ts is TypeScript, so a raw node -e won't import it. The authoritative check is the
# "matches the spec/09 §2 defaults exactly" test in test/config.test.ts (Task 4a) — it asserts the
# exact shape. If it passes, the defaults + field order are correct.

# 3b. Quick functional spot-check via a one-off vitest test is NOT needed here — defer the detailed
#     validation matrix (invalid values, warn counts, boundary 0.9 and 1) to P4.M1.T3.S1.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# This task has no runtime/server/database surface — it is pure config-layer TypeScript.
# The "creative" validation is the adversarial-input invariant already covered by the existing
# "NEVER throws on adversarial input" test (config.test.ts ~line 197-205). Confirm it still passes:
npx vitest run test/config.test.ts -t "NEVER throws"
# Expected: passes. validateConfig still returns all-defaults (now including the two new fields) on
# circular refs / throwing Proxy traps / type-mismatched nested values.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes (zero errors).
- [ ] `npm test` passes (zero failures across the whole suite).
- [ ] `npx vitest run test/config.test.ts` passes in isolation.
- [ ] The "NEVER throws on adversarial input" invariant still holds.

### Feature Validation
- [ ] `DEFAULT_CONFIG.rewind` contains `maxRetriesPerPrompt: 5` and `abortContextFraction: 0.9`, positioned between `maxDepth` and `requireMutationWarning` (spec/09 §2 field order).
- [ ] `validateConfig({ rewind: { maxRetriesPerPrompt: 3, abortContextFraction: 0.8 } })` → both honored (this exact assertion will be added by P4.M1.T3.S1; here, just confirm via the unbroken existing tests that the fields are present and defaulted).
- [ ] The interface fields carry JSDoc citing `@08-edge-cases.md` E22 and the default.
- [ ] abortContextFraction validation uses `v <= 1` (inclusive) — NOT `v < 1`.
- [ ] maxRetriesPerPrompt validation uses `coerceNumber(..., true)` + `Math.floor(n) >= 1` guard.
- [ ] spec/09-configuration.md and README.md are UNCHANGED.

### Code Quality Validation
- [ ] Follows existing config.ts conventions: `if (v !== undefined)` wrappers, `safeGet`, `warnConfig(field, value)` naming, single try/catch in validateConfig.
- [ ] Field placement matches spec/09 §2 JSON order.
- [ ] No new patterns introduced (reuses coerceNumber + the highWaterFraction inline pattern).
- [ ] No new imports, no new helpers, no new exported symbols.

### Documentation & Scope Boundaries
- [ ] Interface JSDoc added (this task's inline doc).
- [ ] No README changes (P4.M3.T1).
- [ ] No spec changes (spec/09 already at target).
- [ ] No tool/runtime/filter changes (P4.M1.T2 / P4.M1.T2.S3).
- [ ] No detailed validation test matrix (P4.M1.T3.S1) — only the 2 snapshot fixes.

---

## Anti-Patterns to Avoid

- ❌ Don't call `coerceNumber` for `abortContextFraction` — it has no upper bound; use the inline `typeof`/range check.
- ❌ Don't copy `highWaterFraction`'s `v < 1` verbatim — `abortContextFraction` is `(0,1]`, so use `v <= 1`.
- ❌ Don't omit the `Math.floor(n) >= 1` guard on `maxRetriesPerPrompt` (driftWindowTurns omits it, but the item contract requires it here; without it, 0.5 would floor to 0 and pass).
- ❌ Don't add a second try/catch inside the rewind block — the whole `validateConfig` body is already wrapped; a throwing helper is already handled.
- ❌ Don't warn for ABSENT fields — the `if (v !== undefined)` wrapper is what keeps absent keys silent; mirror it exactly.
- ❌ Don't write the detailed validation test cases (invalid values × warn counts × boundary) here — that is P4.M1.T3.S1. Only fix the 2 snapshots that break from the DEFAULT_CONFIG growth.
- ❌ Don't edit `spec/09-configuration.md` (already the source of truth) or `README.md` (P4.M3.T1).
- ❌ Don't trust `npm test` alone for type correctness — vitest uses esbuild and does not type-check; run `npx tsc --noEmit`.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is small (2 interface fields + 2 defaults + 2 ~5-line validation blocks + 2 test-literal edits), every edit point has a verified line number, the exact code is specified, the two sibling patterns to mirror are named, the single critical character difference (`<=` vs `<`) is called out three times, and the only failure mode (two existing snapshot tests breaking) is pre-identified with its exact fix. The 0.5 deduction is for the `maxRetriesPerPrompt` (0,1)-fractional silent-no-warn edge case, which is documented but relies on the T3.S1 test author reading this PRP's gotcha rather than assuming a warn.