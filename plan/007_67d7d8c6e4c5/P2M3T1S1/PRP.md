name: "P2.M3.T1.S1 — config.ts + settings.ts: add ui.activeCheckpointBanner"
description: |
  Add a new top-level `ui: { activeCheckpointBanner: boolean }` block to the MulliganConfig surface:
  the interface field (with JSDoc), the DEFAULT_CONFIG value (`true`), and the validateConfig
  per-field coercion (`!!`, never warns, never throws). settings.ts needs NO change — its
  deepMergeSettings already recurses into nested objects. This is the config knob that the
  active-checkpoint banner (P2.M3.T1.S2 `reconcileBanner`, hooked in S3) will read to decide
  whether the persistent above-prompt-box reminder renders. Two existing exact-equality tests in
  test/config.test.ts BREAK and MUST be updated; one new validation describe block is added.
  No production-code change to settings.ts, banner.ts, or commands.ts. Mode A (JSDoc rides with
  the field; spec/09 §2/§3 already documents the rationale).

---

## Goal

**Feature Goal**: Extend the MulliganConfig surface with a validated, defaulted
`ui.activeCheckpointBanner` boolean so the (separately-built) active-checkpoint banner can be
toggled off without disabling checkpoints themselves.

**Deliverable**: Three edits in `src/config.ts` (interface field + DEFAULT_CONFIG value +
validateConfig block) + JSDoc on the new field. Plus: update the two existing whole-object
`toEqual({...})` literals in `test/config.test.ts` that the new top-level block breaks, and add
one focused `describe("ui.activeCheckpointBanner", …)` validation block. **Zero changes to
`src/settings.ts`** (deepMergeSettings already handles nested objects).

**Success Definition**: `npx vitest run test/config.test.ts -v` green (existing tests updated +
new block passing), `npx vitest run test/settings.test.ts -v` still green, `npm run typecheck`
(`tsc --noEmit`) clean, and `MulliganConfig["ui"]["activeCheckpointBanner"]` is a required
`boolean` with default `true` that survives `getConfig()`/`setConfig()` round-trips.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers / the operator who wants to disable the persistent
checkpoint banner (e.g. on a small terminal) without losing the destructive-rewind safety net of
the checkpoint itself.

**Use Case**: A user sets `/mulligan_checkpoint` (S2/sibling work). The banner reminds them it is
armed. If the banner is unwanted, they set `mulligan.ui.activeCheckpointBanner: false` in
settings.json and it stops rendering — checkpoints still work.

**Pain Points Addressed**: The banner is a v1.1 requirement (spec/13 §5, E26) but must be
disablable (spec/09 §3 rationale row: "Disablable without disabling checkpoints"). This knob is
the disablable seam; without it the banner is all-or-nothing.

## Why

- **Spec compliance (spec/09 §2 schema, §4 validation rule, §3 rationale; spec/13 §5 banner)**:
  the merged PRD mandates the knob. This item ships ONLY the config surface — the banner
  mechanism itself (reconcileBanner + the `ctx.ui.setWidget` calls + the refresh hooks) is
  S2/S3/S4.
- **Forward-safe, additive**: a new top-level block with a single boolean is the lowest-risk
  config extension possible. The fail-safe validator (never throws, never warns for booleans,
  unknown/structurally-wrong sub-objects silently ignored) is already the file's convention.
- **No settings.ts churn**: the deep-merge recursion already handles `mulligan.ui.*`, so a
  project-local override of just `ui.activeCheckpointBanner` merges correctly over a global
  `ui` block. Proven by existing recursion tests.

## What

User-visible behavior: **none** (this is a config-surface addition; nothing reads it yet — S2's
`reconcileBanner` will). Technical requirement: a new top-level config block, validated and
defaulted, with the established per-field idiom.

### Success Criteria

- [ ] `MulliganConfig` interface has `ui: { activeCheckpointBanner: boolean }` (required,
      non-optional), placed between the `audit` and `log` blocks, with a JSDoc comment.
- [ ] `DEFAULT_CONFIG.ui.activeCheckpointBanner === true`.
- [ ] `validateConfig({ ui: { activeCheckpointBanner: false } }).ui.activeCheckpointBanner === false`.
- [ ] `validateConfig({}).ui.activeCheckpointBanner === true` (absent → default, NO warn).
- [ ] `!!` coercion: `validateConfig({ ui: { activeCheckpointBanner: "false" } }).ui.activeCheckpointBanner === true`
      (non-empty string is truthy — matches the `enabled` convention); `null → false`.
- [ ] Non-record `ui` (string/array/null/number) → silently ignored, default `true`, NO warn
      (matches how `audit`/`log`/`rewind`/`shrink`/`nudges` handle a structurally-wrong sub-object).
- [ ] The two existing whole-object `toEqual({...})` literals in `test/config.test.ts` updated to
      include the new `ui` block (otherwise they fail — extra key on the actual).
- [ ] `src/settings.ts` UNCHANGED. `src/banner.ts`, `src/commands.ts`, `src/index.ts` UNCHANGED.
- [ ] `npm run typecheck` clean; `npx vitest run test/config.test.ts test/settings.test.ts -v` green.

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, they would need: the exact shape of `config.ts`
(provided verbatim below), the exact per-field validation idiom to mirror (the `audit.*` block —
closest single-field sibling), the two existing tests that break (named + located), and the
confirming note that `settings.ts` needs no change. All of that is inline. No external library
docs are required — this is pure TypeScript with no new dependencies.

### Documentation & References

```yaml
# MUST READ — the spec anchors this knob traces to.
- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h2.110" — spec/09 §2 Schema & defaults)
  why: "The schema shows the exact block: \"ui\": { \"activeCheckpointBanner\": true }, placed
        BETWEEN audit and log. This is the source-of-truth for DEFAULT_CONFIG ordering."
  critical: "Order in the literal is cosmetic (toEqual is order-independent) but keep spec order
             (audit → ui → log) for readability."

- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h2.112" — spec/09 §4 Validation rules)
  why: "Explicit rule: 'ui.activeCheckpointBanner: boolean (coerce with !!); invalid → default true.'
        Booleans coerce with !!; invalid → default. NEVER throw."
  critical: "Booleans do NOT warn on invalid values (only numbers/enums/arrays/strings do). A
             non-record 'ui' sub-object is silently ignored, matching the whole file's convention."

- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h2.111" — spec/09 §3 Rationale per knob)
  why: "The ui.activeCheckpointBanner rationale row — copy its essence into the JSDoc:
        'v1.1: shows the persistent above-prompt-box banner while ≥1 user-set checkpoint is active
        ... Disablable without disabling checkpoints.'"
  critical: "The JSDoc must state WHY default is true and that disabling does NOT disable checkpoints."

- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h2.131" — spec/13 §5 Active-checkpoint banner)
  why: "CONTEXT ONLY — describes the downstream consumer (reconcileBanner → ctx.ui.setWidget with
        placement:'aboveEditor'). NOT implemented in S1. Included so the JSDoc rationale is accurate."
  critical: "Do NOT implement setWidget / reconcileBanner here. S2 owns that. S1 is config-only."

# PRODUCTION CODE TO EDIT — read it first to confirm current shape.
- file: src/config.ts
  why: "THE file. Three insertions (interface field, DEFAULT_CONFIG value, validateConfig block) + JSDoc."
  pattern: "Mirror the audit.* block in validateConfig EXACTLY (safeGet → isRecord guard → safeGet field →
            if(v!==undefined) assign via coerceBoolean). See 'Implementation Patterns' below for the verbatim block."
  gotcha: "coerceBoolean is the boolean helper: value===undefined ? fallback : !!value. Booleans NEVER warn.
           The call-site still guards with `if (v !== undefined)` first for uniformity (it's harmless since
           coerceBoolean also handles undefined, but every other boolean site in the file does the same)."

# PRODUCTION CODE TO CONFIRM NEEDS NO CHANGE.
- file: src/settings.ts
  why: "deepMergeSettings recurses when BOTH sides are isRecord: out[key] = isRecord(g) && isRecord(p) ?
        deepMergeSettings(g, p) : p. So mulligan.ui deep-merges correctly. loadMulliganConfig only extracts
        the top-level .mulligan key. NO EDIT."
  pattern: "No change. (test/settings.test.ts already proves 3-level recursion.)"

# TESTS TO EDIT — the two whole-object literals that break.
- file: test/config.test.ts
  why: "EDIT (1): describe('DEFAULT_CONFIG') > it('matches the spec/09 §2 defaults exactly') — the
            expect(DEFAULT_CONFIG).toEqual({...}) literal must gain `ui: { activeCheckpointBanner: true },`.
        EDIT (2): describe('validateConfig') > it('applies a full valid override') — the
            expect(cfg).toEqual({...}) literal must gain the ui block; ALSO add ui to the INPUT to
            genuinely exercise the override (see Tasks).
        ADD: a new describe('ui.activeCheckpointBanner', ...) validation block mirroring the per-knob idiom."
  pattern: "Mirror the existing per-knob describe blocks (e.g. 'shrink.notifyMaxChars', 'rewind.maxRetriesPerPrompt
            & rewind.abortContextFraction'): (a) pass-through, (b) default-no-warn, (c) coercion semantics,
            (d) structural-no-warn, (e) round-trip, (type) type-level. Use vi.spyOn(console,'warn') for the
            no-warn assertions exactly like the existing blocks."
  gotcha: "toEqual is order-independent, so WHERE you put `ui:` in the literal doesn't affect pass/fail — but it
           MUST be present or the test fails (extra key on actual). The (c) coercion test must assert
           'false'(string)→true and null→false to lock the !! convention."
```

### Current Codebase tree (the files this item touches)

```bash
src/config.ts          # EDIT — +1 interface field, +1 DEFAULT_CONFIG entry, +1 validateConfig block (+JSDoc)
src/settings.ts        # NO CHANGE (deepMergeSettings already recurses)
test/config.test.ts    # EDIT — update 2 existing toEqual literals; +1 describe block
test/settings.test.ts  # NO CHANGE
# Out of scope (S2/S3/S4 own these):
src/banner.ts          # NO CHANGE — reconcileBanner stub stays (S2 implements it; it will READ this knob)
src/commands.ts        # NO CHANGE — already calls the stub reconcileBanner
src/index.ts           # NO CHANGE
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/config.ts          # MODIFIED — ui block added (interface + default + validation); 0 new files
test/config.test.ts    # MODIFIED — 2 literals updated, 1 describe block added; 0 new files
# (NO new files. Mode A: JSDoc is the only doc artifact; spec/09 already documents the rationale.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — two existing tests have EXACT whole-object toEqual({...}) literals that enumerate EVERY
// field of MulliganConfig. Adding a new top-level block makes the actual carry an extra `ui` key → the
// literal no longer matches → test FAILS. You MUST add `ui: { activeCheckpointBanner: true },` to BOTH:
//   1. describe("DEFAULT_CONFIG") > it("matches the spec/09 §2 defaults exactly")
//   2. describe("validateConfig") > it("applies a full valid override")
// (For #2, also add `ui: { activeCheckpointBanner: false }` to the INPUT so the "full override" test
//  actually exercises the new knob with a non-default value.)

// CRITICAL — booleans NEVER call warnConfig. coerceBoolean(value, fallback) = value===undefined ? fallback : !!value.
// So `ui.activeCheckpointBanner: "banana"` → !!("banana") → true, SILENTLY. This is by design (spec/09 §4:
// "Booleans: coerce with !!; invalid → default") and matches every other boolean field (enabled,
// rewind.enabled, shrink.enabled, nudges.bloatReminder, nudges.perTurnDrift, rewind.requireMutationWarning).

// GOTCHA — `null` is PRESENT (not absent) → coerceBoolean → !!null → false. Same as `enabled: null → false`.
// Users wanting the DEFAULT must OMIT the field entirely (safeGet returns undefined → skipped → default kept).

// GOTCHA — a non-record `ui` value ({ui:"oops"}, {ui:[1]}, {ui:null}, {ui:42}) is SILENTLY ignored (the
// `if (isRecord(uiRaw))` guard skips it) → cfg.ui keeps the cloned DEFAULT → activeCheckpointBanner===true.
// NO warn. This is identical to how rewind/shrink/nudges/audit/log handle a structurally-wrong sub-object.
// (This is NOT a bug; it is the established file convention. Only per-FIELD invalid values warn.)

// GOTCHA — do NOT add a `coerceBoolean`-style warn for the boolean. The helper exists and is reused as-is.
// Do NOT touch warnConfig, safeGet, isRecord, structuredClone, or any other helper.

// GOTCHA — settings.ts needs NO change. deepMergeSettings recurses into nested objects (verified).
// Do NOT edit src/settings.ts, src/banner.ts, src/commands.ts, or src/index.ts.
```

## Implementation Blueprint

### Data models and structure

Only an additive change to the existing `MulliganConfig` interface (no new types):

```typescript
// New top-level block (between `audit` and `log` in the interface):
/** UI settings (operator-facing surfaces). */
ui: {
  /** v1.1: shows the persistent above-prompt-box banner (`ctx.ui.setWidget`,
   *  placement:"aboveEditor") while ≥1 user-set checkpoint is active, so the operator does not
   *  forget they have armed destructive cross-prompt rewind power (spec/08 E26, spec/13 §5).
   *  Disablable WITHOUT disabling checkpoints. Default: true. Source: spec/09 §2/§3.
   *  Consumed by reconcileBanner (P2.M3.T1.S2). */
  activeCheckpointBanner: boolean;
};
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the `ui` field to the MulliganConfig interface
  - FILE: src/config.ts
  - LOCATE: the `log` block near the end of the interface (the last field, just before the closing `}`):
        /** Structured logging settings (the primary observability surface in non-TUI modes). */
        log: { file: string | null; };
  - IMPLEMENT: INSERT the `ui` block (with the JSDoc above) IMMEDIATELY BEFORE that `log` block,
    so the order is audit → ui → log (matching spec/09 §2).
  - NAMING: block key `ui`; field `activeCheckpointBanner: boolean` (required, NOT optional).
  - FOLLOW pattern: the `audit` block's JSDoc style (a /** */ on the block + a /** */ on the field).
  - GOTCHA: do NOT mark the field optional (`?`) — it is always present after validation (default true).

Task 2: ADD `ui: { activeCheckpointBanner: true }` to DEFAULT_CONFIG
  - FILE: src/config.ts
  - LOCATE: the tail of the DEFAULT_CONFIG literal:
        audit: { estimateConfidence: "medium" },
        log: { file: null },
      };
  - IMPLEMENT: INSERT between `audit` and `log`:
        ui: { activeCheckpointBanner: true },
  - FOLLOW pattern: 2-space indent, trailing comma, matching the sibling blocks.
  - GOTCHA: the constant comment says "CONSTANT: do not mutate" — you are only ADDING a key, still a constant.

Task 3: ADD the `ui.*` validation block to validateConfig
  - FILE: src/config.ts (inside validateConfig, between the `audit.*` block and the `log.*` block)
  - LOCATE: the end of the `audit.*` block:
        // audit.*
        const auditRaw = safeGet(raw, "audit");
        if (isRecord(auditRaw)) {
          v = safeGet(auditRaw, "estimateConfidence");
          if (v !== undefined) cfg.audit.estimateConfidence = coerceEstimateConfidence(v, cfg.audit.estimateConfidence);
        }
  - IMPLEMENT: INSERT immediately AFTER that block and BEFORE the `// log.*` block:
        // ui.* (v1.1: active-checkpoint banner; spec/09 §2/§4, spec/13 §5)
        const uiRaw = safeGet(raw, "ui");
        if (isRecord(uiRaw)) {
          v = safeGet(uiRaw, "activeCheckpointBanner");
          if (v !== undefined) cfg.ui.activeCheckpointBanner = coerceBoolean(v, cfg.ui.activeCheckpointBanner);
        }
  - FOLLOW pattern: byte-identical to the audit.* block structure (safeGet → isRecord → safeGet field →
    if(v!==undefined) assign via the matching coercer). Reuse the EXISTING module-local coerceBoolean helper.
  - GOTCHA: do NOT add a warn on the boolean (booleans never warn). do NOT add a new helper.

Task 4: UPDATE the two existing exact-equality literals in test/config.test.ts (MANDATORY — they break)
  - FILE: test/config.test.ts
  - EDIT (4a): in describe("DEFAULT_CONFIG") > it("matches the spec/09 §2 defaults exactly"),
    add to the expect(DEFAULT_CONFIG).toEqual({...}) literal, between `audit:` and `log:`:
        ui: { activeCheckpointBanner: true },
  - EDIT (4b): in describe("validateConfig") > it("applies a full valid override"):
      (i)  add to the INPUT object:  ui: { activeCheckpointBanner: false },
      (ii) add to the expect(cfg).toEqual({...}) literal, between `audit:` and `log:`:
              ui: { activeCheckpointBanner: false },
    (This makes the "full override" test genuinely cover the new knob with a non-default value,
     rather than only exercising the default path.)
  - FOLLOW pattern: keep the existing literal indentation/formatting exactly.
  - GOTCHA: toEqual is order-independent, so literal position is cosmetic — but the key MUST be present.
    Without these edits the two tests fail (actual carries an extra `ui` key).

Task 5: ADD a focused describe("ui.activeCheckpointBanner", …) validation block
  - FILE: test/config.test.ts (append, e.g. after the "shrink.notifyMaxChars" describe block)
  - IMPLEMENT cases (mirror the per-knob idiom; see "Implementation Patterns" for the verbatim block):
      (a) pass-through true/false
      (b) absent → default true, NO warn (also {ui:{}} → true, NO warn)
      (c) !! coercion: 1→true, 0→false, "false"→true (non-empty string truthy), null→false
      (d) non-record ui ({ui:"oops"}, {ui:[1]}, {ui:null}) → default true, NO warn
      (e) round-trip via setConfig/getConfig
      (type) ui.activeCheckpointBanner is a required boolean (expectTypeOf)
  - FOLLOW pattern: the "shrink.notifyMaxChars" and "rewind.maxRetriesPerPrompt & abortContextFraction"
    describe blocks (vi.spyOn(console,'warn').mockImplementation + try/finally mockRestore; expectTypeOf).
  - NAMING: describe("ui.activeCheckpointBanner (P2.M3.T1.S1 / spec/09 §2-§4, spec/13 §5)", () => {…}).
  - GOTCHA: validateConfig is PURE (does not touch the session cache), so cases (a)-(d) need no reset.
    Only (e) touches the cache via setConfig/getConfig — match the existing (i) round-trip precedent
    (no explicit reset needed; the dedicated "getConfig / setConfig cache" describe resets itself).
  - IMPORTS: none new — MulliganConfig, validateConfig, getConfig, setConfig are already imported at
    the top of test/config.test.ts.

Task 6: VERIFY — typecheck, targeted tests, full suite
  - RUN: npm run typecheck              (tsc --noEmit — expect clean; no `any` needed)
  - RUN: npx vitest run test/config.test.ts -v   (expect all green incl. the 2 updated + new block)
  - RUN: npx vitest run test/settings.test.ts -v (expect green — settings.ts unchanged)
  - RUN: npm test                       (full suite — expect green, no regressions)
```

### Implementation Patterns & Key Details

```typescript
// ── THE validation block to insert in validateConfig (byte-identical to the audit.* idiom) ──
// Place between the `audit.*` block and the `// log.*` block.
    // ui.* (v1.1: active-checkpoint banner; spec/09 §2/§4, spec/13 §5)
    const uiRaw = safeGet(raw, "ui");
    if (isRecord(uiRaw)) {
      v = safeGet(uiRaw, "activeCheckpointBanner");
      if (v !== undefined) cfg.ui.activeCheckpointBanner = coerceBoolean(v, cfg.ui.activeCheckpointBanner);
    }

// ── The interface field + JSDoc (insert before the `log` block) ──
  /** UI settings (operator-facing surfaces). */
  ui: {
    /** v1.1: shows the persistent above-prompt-box banner (`ctx.ui.setWidget`,
     *  placement:"aboveEditor") while ≥1 user-set checkpoint is active, so the operator does not
     *  forget they have armed destructive cross-prompt rewind power (spec/08 E26, spec/13 §5).
     *  Disablable WITHOUT disabling checkpoints. Default: true. Source: spec/09 §2/§3.
     *  Consumed by reconcileBanner (P2.M3.T1.S2). */
    activeCheckpointBanner: boolean;
  };

// ── The DEFAULT_CONFIG entry (insert between `audit` and `log`) ──
  ui: {
    activeCheckpointBanner: true,
  },

// ── The new test block (mirror the per-knob idiom; booleans never warn) ──
describe("ui.activeCheckpointBanner (P2.M3.T1.S1 / spec/09 §2-§4, spec/13 §5)", () => {
  it("(a) passes through a valid boolean", () => {
    expect(validateConfig({ ui: { activeCheckpointBanner: false } }).ui.activeCheckpointBanner).toBe(false);
    expect(validateConfig({ ui: { activeCheckpointBanner: true } }).ui.activeCheckpointBanner).toBe(true);
  });

  it("(b) defaults to true with NO warn when absent (spec/09 §4 — booleans never warn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({}).ui.activeCheckpointBanner).toBe(true);          // top-level ui absent
      expect(validateConfig({ ui: {} }).ui.activeCheckpointBanner).toBe(true);  // ui present, field absent
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) coerces with !! — non-empty string truthy, null falsy (matches `enabled`; GOTCHA #3)", () => {
    expect(validateConfig({ ui: { activeCheckpointBanner: 1 } }).ui.activeCheckpointBanner).toBe(true);
    expect(validateConfig({ ui: { activeCheckpointBanner: 0 } }).ui.activeCheckpointBanner).toBe(false);
    expect(validateConfig({ ui: { activeCheckpointBanner: "false" } }).ui.activeCheckpointBanner).toBe(true); // non-empty string → truthy
    expect(validateConfig({ ui: { activeCheckpointBanner: null } }).ui.activeCheckpointBanner).toBe(false);   // !!null → false
  });

  it("(d) non-record ui value → whole block silently ignored, default true, NO warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ ui: "oops" }).ui.activeCheckpointBanner).toBe(true);
      expect(validateConfig({ ui: [1, 2] }).ui.activeCheckpointBanner).toBe(true); // array is not a record
      expect(validateConfig({ ui: null }).ui.activeCheckpointBanner).toBe(true);   // null is not a record
      expect(warn).not.toHaveBeenCalled(); // matches audit/log/shrink/nudges block handling
    } finally {
      warn.mockRestore();
    }
  });

  it("(e) round-trip via setConfig/getConfig", () => {
    setConfig({ ui: { activeCheckpointBanner: false } });
    expect(getConfig().ui.activeCheckpointBanner).toBe(false);
  });

  it("(type) ui.activeCheckpointBanner is a required boolean", () => {
    expectTypeOf<MulliganConfig["ui"]>().toHaveProperty("activeCheckpointBanner").toEqualTypeOf<boolean>();
  });
});
```

### Integration Points

```yaml
CONFIG (src/config.ts):
  - interface: ADD `ui: { activeCheckpointBanner: boolean }` (between `audit` and `log`)
  - DEFAULT_CONFIG: ADD `ui: { activeCheckpointBanner: true }` (between `audit` and `log`)
  - validateConfig: ADD the `ui.*` safeGet/isRecord/coerceBoolean block (between `audit.*` and `log.*`)
  - NO new helper: reuse the existing module-local coerceBoolean (value, fallback) => value===undefined?fallback:!!value

SETTINGS (src/settings.ts): NO CHANGE
  - deepMergeSettings already recurses into nested objects (isRecord(g)&&isRecord(p) → recurse).
    A project-local mulligan.ui.activeCheckpointBanner override merges over a global mulligan.ui block.

DOWNSTREAM CONSUMERS (out of scope — DO NOT touch in S1):
  - src/banner.ts reconcileBanner (P2.M3.T1.S2) WILL read getConfig().ui.activeCheckpointBanner as its gate.
  - src/index.ts / src/filter.ts contextHandler tail + session_start (P2.M3.T1.S3) WILL call reconcileBanner.
  - None of these exist yet as readers — S1 is a pure, additive config change that compiles & validates on its own.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (config.ts + the test file flow through tsc).
npm run typecheck          # tsc --noEmit — expect: zero errors.
# If a type error appears in the new interface block, it is almost certainly the field being marked
# optional (`?`) or a stray comma; the field is a REQUIRED boolean.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: the file under test (config) + the sibling that must stay green (settings).
npx vitest run test/config.test.ts -v
# Expected: ALL green — the 2 updated literals pass (now include `ui`), the existing per-knob blocks
# unchanged, and the new "ui.activeCheckpointBanner" block's 6 it()s pass.

npx vitest run test/settings.test.ts -v
# Expected: green — settings.ts is unchanged; the deep-merge recursion tests are unaffected.

# Full suite (regression net — the new knob must not perturb any other test).
npm test                   # = vitest run
# Expected: full suite green. (Note: P2.M2.T1.S3 may land in parallel and also touches the suite —
# both items must keep `npm test` green; the two are disjoint files.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this is a config-surface unit item (no server, no DB, no network, no Pi runtime).
# The integration smoke harness (test/integration/smoke.ts) is owned by P2.M3.T1.S4 (banner + filter
# regression). Do NOT add a smoke scenario here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# None for a config-only item. The per-field validation cases (a)-(e) + (type) ARE the domain
# validation: they lock the spec/09 §4 contract (coerce with !!, invalid → default, never warn,
# never throw) before S2/S3 build on the knob.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (no `any`; the new field is a plain `boolean`).
- [ ] `npx vitest run test/config.test.ts -v` — all green (2 literals updated + new block passing).
- [ ] `npx vitest run test/settings.test.ts -v` — green (settings.ts untouched).
- [ ] `npm test` — full suite green, no regressions.

### Feature Validation (the spec/09 §4 contract for this knob)

- [ ] `validateConfig({}).ui.activeCheckpointBanner === true` (default; NO warn).
- [ ] `validateConfig({ ui: { activeCheckpointBanner: false } }).ui.activeCheckpointBanner === false` (pass-through).
- [ ] `!!` coercion: `"false"`(string) → `true`; `null` → `false`; `0` → `false`; `1` → `true`.
- [ ] Non-record `ui` → default `true`, NO warn.
- [ ] `MulliganConfig["ui"]["activeCheckpointBanner"]` is a required `boolean` (type-level).
- [ ] `setConfig({ui:{activeCheckpointBanner:false}})` → `getConfig().ui.activeCheckpointBanner === false`.

### Code Quality Validation

- [ ] The `ui.*` validateConfig block is byte-identical in structure to the `audit.*` block (safeGet →
      isRecord → safeGet field → if(v!==undefined) assign via coerceBoolean).
- [ ] JSDoc on the field states the v1.1 rationale + "Disablable without disabling checkpoints" + default.
- [ ] The interface/DEFAULT_CONFIG/validateConfig `ui` placement is between `audit` and `log` (spec order).
- [ ] `src/settings.ts`, `src/banner.ts`, `src/commands.ts`, `src/index.ts` UNCHANGED.
- [ ] No new helper added; existing `coerceBoolean` reused.

### Documentation & Deployment

- [ ] JSDoc present on the `ui` block and on `activeCheckpointBanner` (Mode A — rides with the field).
- [ ] No new environment variables (this is a settings.json knob, not an env override).

---

## Anti-Patterns to Avoid

- ❌ Don't add a `warnConfig` call for the boolean — booleans NEVER warn (spec/09 §4; matches every
  other boolean field). Only numbers/enums/arrays/strings warn.
- ❌ Don't mark `activeCheckpointBanner?` optional — it is always present after validation (default `true`).
  Every other scalar field in MulliganConfig is required.
- ❌ Don't handle a non-record `ui` value with a warn — the `if (isRecord(uiRaw))` guard silently skips
  it, exactly like audit/log/rewind/shrink/nudges. (Only the OPTIONAL `bloatThresholdBytesByTool` field
  warns on a non-record; `ui` is a required block, not an optional map.)
- ❌ Don't edit `src/settings.ts` — deepMergeSettings already recurses. Adding a merge branch there is
  both wrong (it's generic) and unnecessary.
- ❌ Don't implement `reconcileBanner`, `ctx.ui.setWidget`, or any banner logic — that is S2/S3. S1 is
  config-only. Leave `src/banner.ts` as the stub.
- ❌ Don't forget the TWO existing `toEqual({...})` literals in test/config.test.ts — they WILL fail
  without the `ui` key added (this is the single most likely one-pass failure).
- ❌ Don't reposition existing blocks in DEFAULT_CONFIG/validateConfig — insert `ui` between `audit`
  and `log`; leave everything else byte-for-byte unchanged.

---

## Confidence Score

**9 / 10** — one-pass success likelihood.

Rationale: the change is a textbook additive config block with a single boolean, mirroring an
existing sibling (`audit.*`) line-for-line in validateConfig. The interface/DEFAULT_CONFIG edits are
literal additions. The only residual risk — and the reason for not scoring 10 — is the two existing
whole-object `toEqual({...})` test literals that silently break when a new top-level key appears;
this PRP names both locations explicitly and gives the exact edit, so a careful implementer clears
them on the first pass. settings.ts genuinely needs no change (deepMergeSettings recurses), and the
downstream consumer (reconcileBanner) is out of scope and already stub-wired, so S1 compiles and
validates independently of S2/S3/S4.