# PRP — P3.M2.T1.S1: Add shrink.maxActive (32) and shrink.staleAfterFires (3) to MulliganConfig, DEFAULT_CONFIG, validateConfig

## Goal

**Feature Goal**: Add two numeric config knobs to the `shrink` block — `maxActive` (cap on simultaneous
active `mulligan:shrink` markers; oldest retired when exceeded; default **32**) and `staleAfterFires`
(auto-retire a pinned shrink whose target has been absent this many consecutive fires; default **3**) —
across all three config surfaces: the `MulliganConfig` interface, `DEFAULT_CONFIG`, and the `validateConfig`
shrink block. This is **pure config plumbing**: it defines and validates the knobs but does NOT consume them
(consumption is the later P3.M2.T2.S1 runtime miss-counts + P3.M2.T3.S1/S2 stale-retirement & soft-cap logic).
It unblocks those later tasks by giving them validated, defaulted values to read via `getConfig().shrink.*`.

**Deliverable** (exactly two files modified — no new files):
- `src/config.ts` — MODIFIED only:
  - `MulliganConfig.shrink` interface gains `maxActive: number;` and `staleAfterFires: number;` (with JSDoc).
  - `DEFAULT_CONFIG.shrink` gains `maxActive: 32,` and `staleAfterFires: 3,`.
  - `validateConfig`'s `shrink.*` block gains two `coerceNumber(..., true)` lines (mustBePositive) after the
    existing `shrink.enabled` check, using the established `safeGet` + `if (v !== undefined)` pattern.
- `test/config.test.ts` — MODIFIED only:
  - **UPDATE three existing exact-shape assertions** whose `shrink` object must grow the two new fields (else
    `npm test` breaks on untouched assertions — see CRITICAL GOTCHA #1).
  - **ADD a new describe block** asserting: provided values pass through; defaults apply when absent; invalid
    values (`0`, `-1`, `NaN`, `'abc'`, `Infinity`) fall back to defaults with exactly one warn naming the field;
    the existing `shrink.enabled` behavior is unchanged.

**Success Definition**:
- `npx tsc --noEmit` clean (the `MulliganConfig` interface change is type-checked; no consumer yet, so nothing
  downstream breaks, but the type surface is honest).
- `npm test` green: the 3 updated assertions pass, the new shrink-knob cases pass, AND zero regressions in the
  other 18 test files (no other file reads `cfg.shrink` shape in a way this change breaks — verified by grep).
- `validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } }).shrink` →
  `{ enabled: true, maxActive: 10, staleAfterFires: 5 }`.
- `validateConfig({}).shrink` → `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` (defaults).
- `validateConfig({ shrink: { maxActive: 0 } }).shrink.maxActive === 32` (0 is rejected: mustBePositive).
- `autoOnBloat` is STILL absent from the interface, DEFAULT_CONFIG, and validateConfig (reserved, not v1 — D3).

## Why

- This is the **config foundation** of the P3.M2 milestone (stale-marker retirement + soft cap; G2 / edge case
  E15). The spec mandates (h2.93 E15, REQUIRED): "a pinned shrink whose target entry has been absent for
  `config.shrink.staleAfterFires` (default 3) consecutive fires MUST be auto-retired … Active shrink markers are
  additionally capped at `config.shrink.maxActive` (default 32, mirroring `rewind.maxDepth`); when exceeded, the
  oldest is retired. Both bound long-session filter cost." None of that logic can be written until the knobs
  exist, are defaulted, and are validated. This task does precisely that and nothing more.
- It follows the **established numeric-knob pattern** verbatim: `coerceNumber(field, value, fallback, mustBePositive)`
  → finite number `>0` (else warn + fallback). Identical to how `nudges.bloatThresholdBytes` /
  `nudges.driftThresholdTokens` are handled today (both mustBePositive=true). `rewind.maxDepth` (mustBePositive=false,
  i.e. `>=0`) is the only sibling that differs — these two new knobs are strictly `>0` because a cap/retire-count
  of 0 is nonsensical (0 cap = "no shrinks allowed"; 0 fires = "retire on first miss, immediately").
- It is **self-contained and low-risk**: config.ts is Pi-free (no `pi.*`, no event handlers, no persistence), and
  no existing `src/` code reads `cfg.shrink.maxActive`/`staleAfterFires` yet (confirmed by grep — the only
  `cfg.shrink` reads are `.enabled`). So this change cannot change any runtime behavior in `src/`; it only widens
  the validated type surface and updates the three config-test assertions that pin the exact shape.

## What

**User-visible behavior**: none directly (config only). Indirectly, once P3.M2.T3 ships, the human can set
`mulligan.shrink.maxActive` / `mulligan.shrink.staleAfterFires` in `settings.json` to tune long-session filter
cost. With the knobs absent, behavior is identical to today (shrink feature unchanged; the new defaults are
dormant until consumed).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. `MulliganConfig.shrink` interface gains `maxActive: number;` and `staleAfterFires: number;` as REQUIRED
   fields (no `?` — they always have a default value, like `rewind.maxDepth`).
2. `DEFAULT_CONFIG.shrink` gains `maxActive: 32,` and `staleAfterFires: 3,` (spec/09 §2 source-of-truth).
3. In `validateConfig`, inside the existing `if (isRecord(shrinkRaw))` block, immediately AFTER the
   `shrink.enabled` line, add two coercions — EXACTLY this shape (verified against `rewind.maxDepth` /
   `nudges.bloatThresholdBytes` precedent):
   ```ts
   v = safeGet(shrinkRaw, "maxActive");
   if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
   v = safeGet(shrinkRaw, "staleAfterFires");
   if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
   ```
   `true` = mustBePositive (>0). The module-level `let v: unknown;` is reused (do NOT redeclare it).
4. `autoOnBloat` STAYS OUT of the interface, DEFAULT_CONFIG, AND validateConfig (spec/07 D3 — reserved, not v1;
   the existing comment + the existing "ignores unknown keys ... incl. shrink.autoOnBloat" test enforce this).
5. Absent fields keep their default SILENTLY (no warn) — the `if (v !== undefined)` guard ensures this, matching
   every other field. Present-but-invalid values warn once via `warnConfig` and fall back.

### Success Criteria
- [ ] `MulliganConfig.shrink` has REQUIRED `maxActive: number;` and `staleAfterFires: number;` fields (JSDoc'd).
- [ ] `DEFAULT_CONFIG.shrink === { enabled: true, maxActive: 32, staleAfterFires: 3 }`.
- [ ] `validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } }).shrink.maxActive === 10` AND `.staleAfterFires === 5`.
- [ ] `validateConfig({}).shrink.maxActive === 32` AND `.staleAfterFires === 3` (defaults when absent, no warn).
- [ ] `validateConfig({ shrink: { maxActive: 0 } }).shrink.maxActive === 32` (0 rejected — mustBePositive; 1 warn).
- [ ] Each of `0`, `-1`, `NaN`, `'abc'`, `Infinity` for EACH knob → its default, exactly one warn naming the field.
- [ ] `validateConfig({ shrink: { enabled: false } }).shrink === { enabled: false, maxActive: 32, staleAfterFires: 3 }` (existing enabled behavior unchanged).
- [ ] `autoOnBloat` is NOT present in the interface / DEFAULT_CONFIG / validateConfig output.
- [ ] `npx tsc --noEmit` clean; `npm test` green (3 updated assertions + new cases pass; no regressions).

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes** — this is a tightly-scoped 2-file change with a verbatim precedent. The implementer must read
`src/config.ts` (the ONLY source file edited — three precise insertion points, all shown verbatim below) and
`test/config.test.ts` (the ONLY test file edited — three exact assertions to UPDATE plus a new describe block to
ADD). The numeric-coercion pattern is already implemented in this file (`coerceNumber`); there is nothing new to
invent. The single most important non-obvious fact is **CRITICAL GOTCHA #1**: three *existing* `toEqual`
assertions hard-code the current `shrink: { enabled }` shape and WILL break unless updated in the same change.
Everything else is mechanical application of the established pattern. No `pi.*`, no persistence, no event
handlers, no index.ts wiring change, no docs change.

### Documentation & References

```yaml
# MUST READ + EDIT — the ONLY source file this task touches
- file: src/config.ts
  why: |
    Contains ALL three edit sites: (a) the `MulliganConfig.shrink` interface block, (b) the `DEFAULT_CONFIG.shrink`
    object, (c) the `validateConfig` `shrink.*` coercion block. The `coerceNumber`, `safeGet`, `isRecord`, and
    `warnConfig` helpers are UNCHANGED and reused as-is. `getConfig`/`setConfig` are UNCHANGED.
  section: MulliganConfig.shrink (~the "Shrink operation settings" block); DEFAULT_CONFIG.shrink (~line 92);
           validateConfig shrink block (~the "shrink.*  (autoOnBloat intentionally NOT honored …)" comment + block)
  pattern: |
    # The rewind.maxDepth coercion is the mustBePositive=FALSE sibling — DO NOT copy its `false` arg.
    v = safeGet(rewindRaw, "maxDepth");
    if (v !== undefined) cfg.rewind.maxDepth = coerceNumber("rewind.maxDepth", v, cfg.rewind.maxDepth, false);
    # The nudges.bloatThresholdBytes coercion is the mustBePositive=TRUE precedent — THIS is the shape to copy:
    v = safeGet(nudgesRaw, "bloatThresholdBytes");
    if (v !== undefined) cfg.nudges.bloatThresholdBytes = coerceNumber("nudges.bloatThresholdBytes", v, cfg.nudges.bloatThresholdBytes, true);
  gotcha: |
    (1) Both new knobs use mustBePositive=TRUE (the literal `true` 4th arg). Copying rewind.maxDepth's `false`
        would wrongly allow 0. maxActive/staleAfterFires of 0 is nonsensical → must fall back.
    (2) Reuse the module-level `let v: unknown;` declared once at the top of validateConfig. Do NOT redeclare `v`.
    (3) Place the two new lines INSIDE the existing `if (isRecord(shrinkRaw)) { … }` block, AFTER the
        `shrink.enabled` line, so a non-record `shrink` value still silently keeps all defaults (no new warn).
    (4) Keep the `autoOnBloat` comment + do NOT add the field (spec/07 D3; existing test enforces).

# MUST READ + EDIT — the ONLY test file this task touches
- file: test/config.test.ts
  why: |
    House idiom: vitest, `expect().toEqual()` for exact-shape assertions, `expectTypeOf` for type-level checks,
    `vi.spyOn(console, "warn").mockImplementation(()=>{})` + try/finally mockRestore for warn assertions,
    `setConfig(undefined)` in beforeEach to reset the module cache. THREE existing assertions hard-code the
    current `shrink` shape and MUST be updated (CRITICAL GOTCHA #1, below). One NEW describe block is added.
  section: "DEFAULT_CONFIG" describe (defaults-exact test); "validateConfig" describe (full-override +
           ignores-unknown-keys tests); getConfig/setConfig describe (unchanged — do not touch)
  pattern: |
    # Warn-assertion idiom to mirror for the invalid-value cases (copy from the bloatThresholdByTool tests):
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = validateConfig({ shrink: { maxActive: 0 } });
      expect(cfg.shrink.maxActive).toBe(32);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("shrink.maxActive");
    } finally {
      warn.mockRestore();
    }
  gotcha: |
    The 3 assertions that break are listed verbatim in CRITICAL GOTCHA #1. Failing to update even one of them
    makes `npm test` red on an assertion you didn't intend to change.

# Architecture — the P3 config-validation design (the authoritative pattern statement)
- docfile: plan/003_2c3b19ff6a7b/architecture/external_deps.md
  why: §"Config validation pattern (config.ts)" states the exact two-line shape to add (verbatim, with the `true`
        mustBePositive arg). Confirms `coerceNumber` is the established knob mechanism; highWaterFraction (a
        later task) needs a custom coercer but maxActive/staleAfterFires do NOT — plain coerceNumber suffices.
  section: "Config validation pattern (config.ts)"
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  why: §"config.ts (355 lines)" records the current state: "shrink currently has only `{ enabled: true }` — P3
        delta: add `maxActive: 32`, `staleAfterFires: 3`." Confirms these knobs are greenfield (not present
        anywhere in src/) and that consumption lives in filter.ts (later task), NOT here.

# Spec source-of-truth (the knobs are ALREADY specified — this delta implements spec/09)
- docfile: plan/003_2c3b19ff6a7b/prd_snapshot.md
  why: spec/09 §2 (Schema & defaults) shows `shrink: { enabled, maxActive: 32, staleAfterFires: 3 }` verbatim;
        §3 (Rationale) gives the per-knob "why"; §4 (Validation rules) "Numbers: must be finite, >= 0 (thresholds
        > 0); invalid → default." maxActive/staleAfterFires are thresholds (counts) → `> 0` → mustBePositive=true.
  section: spec/09 §2 (defaults), §3 (rationale: shrink.maxActive / shrink.staleAfterFires rows), §4 (validation)

# Sibling PRP (read-only contract — what EXISTS when this item starts)
- docfile: plan/003_2c3b19ff6a7b/P3M1T4S1/PRP.md
  why: Implements in parallel; edits src/tools/audit.ts + test/tools/audit.test.ts ONLY. NO overlap with
        config.ts/config.test.ts — the two tasks touch disjoint files. Listed only to confirm non-conflict.
```

### Current Codebase tree (relevant slice)

```bash
src/
├── config.ts             # ← EDIT (MulliganConfig.shrink + DEFAULT_CONFIG.shrink + validateConfig shrink block)
├── filter.ts             # consumer of these knobs LATER (P3.M2.T3) — DO NOT touch this task
├── runtime.ts            # shrinkMissCounts added LATER (P3.M2.T2) — DO NOT touch this task
└── … (tools/, markers.ts, etc. — none read cfg.shrink.maxActive/staleAfterFires today)
test/
└── config.test.ts        # ← EDIT (3 updated assertions + 1 new shrink-knobs describe block)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Two EXISTING files modified:
src/config.ts       # MulliganConfig.shrink (+maxActive,+staleAfterFires); DEFAULT_CONFIG.shrink (+32,+3);
                    #   validateConfig shrink block (+2 coerceNumber(...,true) lines). No new helpers.
test/config.test.ts # UPDATE 3 exact-shape shrink assertions; ADD "shrink.maxActive & staleAfterFires" describe block.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// ★★★ CRITICAL GOTCHA #1 — THREE existing test assertions BREAK unless updated in the SAME change.
// test/config.test.ts pins the EXACT shape of `shrink`. Adding fields widens the shape. These MUST be updated:
//
//   (a) ~line 18, "matches the spec/09 §2 defaults exactly":
//       shrink: { enabled: true }            →  shrink: { enabled: true, maxActive: 32, staleAfterFires: 3 }
//
//   (b) ~lines 62–70, "applies a full valid override" — BOTH input AND expected output:
//       input  shrink: { enabled: false }    →  shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 }
//       expect shrink: { enabled: false }    →  shrink: { enabled: false, maxActive: 8, staleAfterFires: 2 }
//       (pick non-default values in the input so the "full override" test actually exercises the new knobs.)
//
//   (c) ~line 210, "ignores unknown keys … incl. shrink.autoOnBloat":
//       expect(cfg.shrink).toEqual({ enabled: true })
//            →  expect(cfg.shrink).toEqual({ enabled: true, maxActive: 32, staleAfterFires: 3 })
//       (cfg is built from { shrink: { autoOnBloat: true } }: enabled absent→true, new fields absent→defaults.
//        autoOnBloat is STILL dropped. The trailing `expect(cfg).toEqual(validateConfig({rewind:{enabled:false}}))`
//        is fine — both sides route through validateConfig, so shapes match automatically.)
//
// Missing even ONE of (a)/(b)/(c) → `npm test` red on an untouched assertion.

// GOTCHA #2 — mustBePositive must be the literal `true`, NOT `false`.
// rewind.maxDepth uses `false` (>=0 allowed, because maxDepth:0 means "rewind disabled"). Copying that arg would
// wrongly accept maxActive:0 / staleAfterFires:0. The correct precedent is nudges.bloatThresholdBytes (true).
// coerceNumber(field, value, fallback, /*mustBePositive=*/true) → finite AND > 0, else warn + fallback.

// GOTCHA #3 — REUSE the module-level `let v: unknown;` in validateConfig. Do NOT redeclare `v` inside the
// shrink block (it is declared once near the top and reused across every field's safeGet/coerce sequence).

// GOTCHA #4 — place the two new lines INSIDE the existing `if (isRecord(shrinkRaw)) { … }` block, AFTER the
// shrink.enabled line. A non-record `shrink` (e.g. shrink: "oops") must STILL keep all defaults silently for the
// new knobs (it never enters the block) — do not lift the coercion outside the guard.

// GOTCHA #5 — absent ≠ invalid. `if (v !== undefined)` SKIPS absent fields (no warn, keep default). Only a
// PRESENT-but-invalid value (0, -1, NaN, 'abc', Infinity) warns once and falls back. This is the established
// rule (spec/09 §4) and the existing "does NOT warn for ABSENT fields" test enforces it.

// GOTCHA #6 — autoOnBloat STAYS OUT. It is reserved (spec/07 D3). The interface comment, the validateConfig
// comment, AND the "ignores unknown keys … incl. shrink.autoOnBloat" test all enforce its absence. Do not add it.

// GOTCHA #7 — config.ts is Pi-FREE and PURE. No console.log (warnConfig uses console.warn under a try/catch),
// no I/O, no pi.*. Adding these knobs changes NO runtime behavior in src/ (nothing reads them yet) — only the
// validated type surface widens. The blast radius is exactly config.ts + config.test.ts.
```

## Implementation Blueprint

### Data models and structure

The only data-model change is widening the `MulliganConfig.shrink` inline interface literal in `src/config.ts`
(no separate models file; this is a TypeScript project). No ORM/Pydantic artifacts apply.

```ts
// MulliganConfig.shrink — add two REQUIRED fields (beside `enabled`, after the autoOnBloat NOTE comment):
shrink: {
  /** Enable the shrink tool/feature. Default: true. */
  enabled: boolean;
  /** Cap on simultaneous active mulligan:shrink markers on a branch; when exceeded the oldest is retired
   *  (bounds long-session filter cost; mirrors rewind.maxDepth). Must be > 0. Default: 32.
   *  Source: spec/09 §2/§3; consumed by the stale-retirement + soft-cap logic (P3.M2.T3). */
  maxActive: number;
  /** Auto-retire a pinned shrink whose target entry has been absent for this many consecutive fires
   *  (stops dead markers being walked every fire; @08 E15/E21). Must be > 0. Default: 3.
   *  Source: spec/09 §2/§3; consumed by P3.M2.T3. */
  staleAfterFires: number;
  // NOTE: "autoOnBloat" is reserved for a FUTURE opt-in mode and is NOT in v1
  //       (spec/07 §nudges: "Auto-shrink would risk data loss"). Do not add it.
};

// DEFAULT_CONFIG.shrink — add the two defaults:
shrink: {
  enabled: true,
  maxActive: 32,
  staleAfterFires: 3,
},
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts — MulliganConfig.shrink interface (+2 fields)
  - IMPLEMENT: add `maxActive: number;` and `staleAfterFires: number;` (each with a one-line JSDoc citing
        spec/09 §2/§3 + the consuming task P3.M2.T3). Place them after `enabled: boolean;`, BEFORE the existing
        `autoOnBloat` NOTE comment (which stays).
  - WHY FIRST: editing the interface first surfaces tsc's downstream expectations (there are none yet — nothing
        reads these fields — so it compiles cleanly and the DEFAULT_CONFIG assignment in Task 2 type-checks).
  - NAMING: maxActive / staleAfterFires (camelCase; matches spec/09 §2 JSON keys exactly — case-sensitive).
  - GOTCHA: REQUIRED (no `?`). They always have a default value (like rewind.maxDepth), so they are non-optional.
  - PLACEMENT: inside the existing `shrink: { … };` interface block.

Task 2: MODIFY src/config.ts — DEFAULT_CONFIG.shrink (+2 defaults)
  - IMPLEMENT: add `maxActive: 32,` and `staleAfterFires: 3,` to the DEFAULT_CONFIG.shrink object.
  - DEPENDENCIES: Task 1 (the interface must allow these fields for the literal to type-check).
  - NAMING: keys maxActive / staleAfterFires; values 32 / 3 (spec/09 §2 verbatim).
  - GOTCHA: CONSTANT object — getConfig() returns a structuredClone, never this object (unchanged here).
  - PLACEMENT: inside the existing `shrink: { enabled: true, … },` object literal.

Task 3: MODIFY src/config.ts — validateConfig shrink block (+2 coerceNumber lines)
  - IMPLEMENT: inside the existing `if (isRecord(shrinkRaw)) { … }` block, immediately AFTER the
        `shrink.enabled` line, add:
        v = safeGet(shrinkRaw, "maxActive");
        if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
        v = safeGet(shrinkRaw, "staleAfterFires");
        if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
  - FOLLOW pattern: nudges.bloatThresholdBytes (mustBePositive=TRUE precedent) — NOT rewind.maxDepth (false).
  - DEPENDENCIES: Tasks 1–2 (cfg.shrink.maxActive / .staleAfterFires must exist on the cloned DEFAULT_CONFIG).
  - GOTCHA: reuse the module-level `let v: unknown;`; mustBePositive is the literal `true`; keep the lines
        INSIDE the isRecord guard so non-record `shrink` keeps defaults silently.
  - PLACEMENT: the `shrink.*` block (search the comment "autoOnBloat intentionally NOT honored").

Task 4: MODIFY test/config.test.ts — UPDATE the 3 breaking exact-shape assertions (CRITICAL GOTCHA #1)
  - UPDATE (a) the DEFAULT_CONFIG defaults `toEqual` (~line 18): shrink object gains maxActive:32, staleAfterFires:3.
  - UPDATE (b) the "applies a full valid override" test (~lines 62–70): add the two knobs to BOTH the input
        override (use non-default values, e.g. maxActive:8, staleAfterFires:2) AND the expected output.
  - UPDATE (c) the "ignores unknown keys … incl. shrink.autoOnBloat" test (~line 210): the `cfg.shrink` toEqual
        gains maxActive:32, staleAfterFires:3 (defaults, since the input omits them; autoOnBloat still dropped).
  - WHY BEFORE new tests: these MUST pass before adding cases, or the suite is red and new-case results are noise.
  - GOTCHA: do NOT touch the trailing `expect(cfg).toEqual(validateConfig({rewind:{enabled:false}}))` in (c) —
        both sides route through validateConfig so the new shape matches on both sides automatically.

Task 5: MODIFY test/config.test.ts — ADD "shrink.maxActive & shrink.staleAfterFires" describe block
  - IMPLEMENT (pass-through + defaults):
    a) validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } }) → maxActive===10, staleAfterFires===5.
    b) validateConfig({}).shrink → { enabled:true, maxActive:32, staleAfterFires:3 } (defaults; NO warn).
    c) validateConfig({ shrink: { maxActive: 1, staleAfterFires: 1 } }) → 1 / 1 (boundary: >0 valid).
    d) validateConfig({ shrink: { enabled: false } }).shrink → { enabled:false, maxActive:32, staleAfterFires:3 }
       (existing enabled behavior unchanged; new knobs keep defaults).
  - IMPLEMENT (invalid → fallback + exactly one warn, PER knob, using vi.spyOn(console,"warn") + try/finally):
    e) shrink.maxActive ∈ {0, -1, NaN, 'abc', Infinity} → 32; exactly one warn containing "shrink.maxActive".
    f) shrink.staleAfterFires ∈ {0, -1, NaN, 'abc', Infinity} → 3; exactly one warn containing "shrink.staleAfterFires".
    g) both invalid at once → 2 warns (one per field), both fall back to defaults.
  - IMPLEMENT (forward-compat): validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5, autoOnBloat: true } })
       → maxActive===10, staleAfterFires===5, autoOnBloat dropped (NOT in output). (Reinforces GOTCHA #6.)
  - IMPLEMENT (type-level): expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("maxActive").toEqualTypeOf<number>()
       and same for staleAfterFires; OR extend the existing "is assignable to MulliganConfig" type assert.
  - FOLLOW pattern: the bloatThresholdByTool warn tests (vi.spyOn + mockRestore + try/finally) and the existing
       "validates numbers … rejects strings/NaN/Infinity" test (which covers bloatThresholdBytes the same way).
  - NAMING: describe "shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 / spec/09 §2-§4)".
  - COVERAGE: pass-through (a,c), defaults+no-warn (b), enabled-unchanged (d), per-knob invalid-fallback+warn
       (e,f,g), forward-compat autoOnBloat-drop (h), type-surface (type assert).
  - PLACEMENT: new describe block inside the existing top-level suite, near the other validateConfig cases
       (e.g. after the "validates numbers …" test or as its own describe at file scope).
```

### Implementation Patterns & Key Details

```ts
// PATTERN (Task 3) — the two coercion lines, verbatim. mustBePositive=TRUE (the literal `true`).
// Copied from the nudges.bloatThresholdBytes precedent; `v` is the module-level reusable scratch variable.
// shrink.*  (autoOnBloat intentionally NOT honored — reserved, not v1; S1 GOTCHA #1)
const shrinkRaw = safeGet(raw, "shrink");
if (isRecord(shrinkRaw)) {
  v = safeGet(shrinkRaw, "enabled");
  if (v !== undefined) cfg.shrink.enabled = coerceBoolean(v, cfg.shrink.enabled);
  v = safeGet(shrinkRaw, "maxActive");
  if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
  v = safeGet(shrinkRaw, "staleAfterFires");
  if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
}

// TEST PATTERN (Task 5 e/f) — invalid → fallback + exactly one warn. Mirror the bloatThresholdByTool tests:
it("rejects invalid shrink.maxActive (0, -1, NaN, 'abc', Infinity) → 32 + one warn", () => {
  for (const bad of [0, -1, NaN, "abc", Infinity]) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ shrink: { maxActive: bad } }).shrink.maxActive).toBe(32);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("shrink.maxActive");
    } finally {
      warn.mockRestore();
    }
  }
});
// (same shape for shrink.staleAfterFires → 3; combine both-invalid in a separate case expecting 2 warns.)
```

### Integration Points

```yaml
DATABASE:
  - none (config is in-memory + Pi settings.json; nothing persisted by this task)
CONFIG:
  - the NEW knobs: mulligan.shrink.maxActive (number, >0, default 32) and mulligan.shrink.staleAfterFires
        (number, >0, default 3). Read by downstream code via getConfig().shrink.maxActive / .staleAfterFires.
        No environment variable (spec/09 §5 env overrides are v1.1, out of scope).
ROUTES:
  - none (no tool/handler/wiring change; index.ts is untouched)
TYPES:
  - MulliganConfig.shrink widens by two REQUIRED number fields. No existing consumer reads them, so nothing
        in src/ changes behavior; the type surface is simply honest about what now exists.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck after each src/config.ts edit — strict tsconfig. Adding the two fields to the interface is checked,
# and the DEFAULT_CONFIG literal + the validateConfig assignments must all satisfy the widened type.
npx tsc --noEmit
# Expected: zero errors. If a "Property 'maxActive' does not exist" error appears, Task 1 (interface) was missed
# or the field name's casing diverged from the JSON key (camelCase: maxActive, staleAfterFires).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Full suite — config.test.ts is the file under test; the other 18 files MUST stay green (this change touches
# no runtime behavior in src/, so nothing else can regress — but run the whole suite to PROVE that).
npm test
# Expected: all green. If a config.test.ts assertion fails that you did NOT touch, you hit CRITICAL GOTCHA #1
# (a stale exact-shape assertion) — update it per Task 4. If a NON-config test fails, re-check that you did not
# accidentally edit any file other than config.ts/config.test.ts.

# Targeted run while iterating:
npx vitest run test/config.test.ts
# Expected: the 3 updated assertions pass AND the new "shrink.maxActive & shrink.staleAfterFires" block passes.
```

### Level 3: Integration Testing (System Validation)

```bash
# No server / no Pi surface for this task (config.ts is Pi-free + pure). The unit suite IS the integration proof:
# validateConfig is the exact path getConfig()/setConfig() use, so the new knobs are live in the cache layer too.
# (Optional belt-and-suspenders) confirm the cache round-trips the new defaults:
node -e "import('./src/config.js').then(m => { const c = m.validateConfig({ shrink: { maxActive: 7 } }); console.log(JSON.stringify(c.shrink)); })"
# Expected output: {"enabled":true,"maxActive":7,"staleAfterFires":3}
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Forward-compat + reserved-field guard (the spec/07 D3 invariant): autoOnBloat must NEVER appear in output.
node -e "import('./src/config.js').then(m => { const c = m.validateConfig({ shrink: { autoOnBloat: true, maxActive: 9 } }); console.log('autoOnBloat' in c.shrink, c.shrink.maxActive); })"
# Expected: false 9   (autoOnBloat dropped; maxActive honored; enabled defaulted to true)

# Non-regression on the never-throw invariant (adversarial input still returns valid defaults with the new shape):
node -e "import('./src/config.js').then(m => { const throwing = new Proxy({ shrink: {} }, { get(t,k){ if(k==='maxActive') throw new Error('boom'); return t[k]; } }); const c = m.validateConfig(throwing); console.log(c.shrink.maxActive, c.shrink.staleAfterFires); })"
# Expected: 32 3   (safeGet swallows the throwing getter → field treated absent → default, no throw, no warn)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean (interface widening + DEFAULT_CONFIG literal + validateConfig assignments all type-check).
- [ ] `npm test` green — config.test.ts (3 updated + new block) AND the other 18 files unchanged.
- [ ] No NEW console output from a valid/defaulted config (absent fields never warn — GOTCHA #5).

### Feature Validation
- [ ] `validateConfig({ shrink: { maxActive: 10, staleAfterFires: 5 } }).shrink` →
      `{ enabled: true, maxActive: 10, staleAfterFires: 5 }`.
- [ ] `validateConfig({}).shrink` → `{ enabled: true, maxActive: 32, staleAfterFires: 3 }` (defaults, no warn).
- [ ] Each invalid value (0, -1, NaN, 'abc', Infinity) per knob → its default + exactly one warn naming the field.
- [ ] `validateConfig({ shrink: { enabled: false } }).shrink` → `{ enabled: false, maxActive: 32, staleAfterFires: 3 }`.
- [ ] `autoOnBloat` absent from the interface, DEFAULT_CONFIG, AND every validateConfig output (forward-compat).
- [ ] validateConfig never throws (adversarial Proxy / circular input → defaults with the full new shape).

### Code Quality Validation
- [ ] Only `src/config.ts` + `test/config.test.ts` modified (no filter.ts/runtime.ts/markers.ts/tools/index.ts/docs).
- [ ] New fields carry a one-line JSDoc citing spec/09 §2/§3 + the consuming task P3.M2.T3.
- [ ] mustBePositive is the literal `true` for BOTH knobs (copied from bloatThresholdBytes, not rewind.maxDepth).
- [ ] The two coercion lines are INSIDE the `if (isRecord(shrinkRaw))` guard, after the `shrink.enabled` line.
- [ ] `autoOnBloat` NOTE comment preserved in both the interface and the validateConfig block.

### Documentation & Deployment
- [ ] No user-facing doc change required (spec/09 §2/§3 already specify these knobs — they are the SOURCE of this
      delta; the README config-table sync is a LATER Mode-B task P3.M4.T1.S1, explicitly out of scope here).

---

## Anti-Patterns to Avoid

- ❌ Don't copy `rewind.maxDepth`'s `false` mustBePositive arg — both new knobs need `true` (>0). A 0 cap /
  0-fire retire-count is nonsensical and must fall back.
- ❌ Don't forget to UPDATE the three breaking `toEqual` assertions in config.test.ts (CRITICAL GOTCHA #1).
      Leaving even one stale makes `npm test` red on an assertion you never meant to change.
- ❌ Don't add `autoOnBloat` to the interface, DEFAULT_CONFIG, or validateConfig — it is reserved (spec/07 D3);
      the existing comment + the "ignores unknown keys … shrink.autoOnBloat" test enforce its absence.
- ❌ Don't redeclare `v` inside the shrink block — reuse the module-level `let v: unknown;` scratch variable.
- ❌ Don't lift the new coercion lines outside `if (isRecord(shrinkRaw))` — a non-record `shrink` must keep the
      new defaults silently (it never enters the block), matching every other field's guard discipline.
- ❌ Don't warn for ABSENT fields — `if (v !== undefined)` is the established skip rule (spec/09 §4; existing
      "does NOT warn for ABSENT fields" test). Only present-but-invalid values warn.
- ❌ Don't edit `src/filter.ts`, `src/runtime.ts`, `src/markers.ts`, any tool, or `src/index.ts` — the consumption
      (stale retirement + soft cap) is P3.M2.T2/T3, explicitly a SEPARATE, later task. This task is config-only.
- ❌ Don't change the casing of the JSON keys — they are `maxActive` / `staleAfterFires` (camelCase), matching
      spec/09 §2 exactly; settings.json is case-sensitive.

---

**Confidence Score: 9/10** — one-pass success is highly likely: it is a 2-file change with a verbatim
precedent (the `coerceNumber(...,true)` shape is literally stated in the architecture doc and already used by
two nudges knobs), config.ts is Pi-free + pure (zero runtime-behavior change in `src/`), and the only non-obvious
risk — the three existing exact-shape test assertions that break — is enumerated verbatim in CRITICAL GOTCHA #1
with the exact before→after for each. The -1 is for the small risk of a casing typo (maxActive vs maxactive) or
copying the wrong mustBePositive arg (`false` from maxDepth) — both caught deterministically by `npx tsc --noEmit`
and the explicit per-knob invalid-value test cases (0 must fall back to the default, proving mustBePositive=true).