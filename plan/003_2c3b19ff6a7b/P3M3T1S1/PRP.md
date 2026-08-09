# PRP — P3.M3.T1.S1: Add driftWindowTurns, highWaterFraction; raise driftThresholdTokens 3000→6000

## Goal

**Feature Goal**: Extend the `MulliganConfig.nudges` config surface with two new knobs —
`driftWindowTurns` (rolling window size for §5.1 windowed drift signaling) and `highWaterFraction`
(§5.2 edge-triggered high-water fraction of the context window) — and **raise** the
`driftThresholdTokens` default from `3000` → `6000` to match spec/09 §2/§3 (the on-disk spec already
mandates 6000; `DEFAULT_CONFIG` is a drift from the spec). All three land with fail-safe validation
in `validateConfig` and zero behavior change in the runtime (the consumers — `shouldNudge`,
`shouldHighWater`, `readMarkers`, `contextHandler` — are separate future tasks P3.M3.T4/T5/T3/T6).

**Deliverable**:
- `src/config.ts` — modified: `MulliganConfig.nudges` interface (+2 fields), `DEFAULT_CONFIG.nudges`
  (+2 fields, driftThresholdTokens 3000→6000), `validateConfig` nudges block (+driftWindowTurns floor
  validation, +highWaterFraction dedicated (0,1) check). Plus updated JSDoc.
- `test/config.test.ts` — modified: 4 existing assertions updated (3000→6000 + new fields in the
  `toEqual` objects), and a NEW describe block for the two knobs + the threshold raise.
- `test/turn_metric.test.ts` — modified: pin `driftThresholdTokens` in 3 boundary tests that construct
  deltas against the old 3000 default (see Known Gotchas — these would otherwise BREAK).

**Success Definition**:
- `validateConfig(undefined)` → `nudges = { …, driftThresholdTokens: 6000, driftWindowTurns: 3, highWaterFraction: 0.7 }`.
- `validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } })`
  → all three set to 5 / 0.8 / 10000.
- `driftWindowTurns: 5.7` → `5` (floored to integer). Invalid (`0, -1, NaN, "abc", Infinity`) → `3` + 1 warn.
- `highWaterFraction` invalid (`0, 1, -0.5, 1.5, NaN, "0.7"`) → `0.7` + 1 warn (dedicated `(0,1)` check; NO string coercion).
- Existing nudges knobs (`bloatReminder`, `perTurnDrift`, `bloatThresholdBytes`, `bloatThresholdBytesByTool`)
  unchanged when the new knobs are set.
- `npx tsc --noEmit` clean; `npm test` green (all existing tests pass + new tests pass).

## Why

- **Spec alignment.** spec/09 §2/§3 already specify `driftThresholdTokens: 6000` (with rationale:
  "Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1
  windowing is what makes 6k a quiet, accurate trip point") plus `driftWindowTurns: 3` and
  `highWaterFraction: 0.7`. `DEFAULT_CONFIG.nudges.driftThresholdTokens` is currently still `3000` —
  this task fixes that drift and lands the two knobs the refinements (P3.M3) depend on.
- **It is the config foundation for the whole M3 milestone.** P3.M3.T4.S1 (`shouldNudge` windowing)
  reads `driftWindowTurns` + `driftThresholdTokens`; P3.M3.T5.S1 (`shouldHighWater`) reads
  `highWaterFraction`; P3.M3.T3.S1 (`readMarkers` recent-metrics window) reads `driftWindowTurns`;
  P3.M3.T6.S1 (`contextHandler` nudge wiring) reads all three. None of those can be implemented
  correctly until these knobs + their validation exist. This task is upstream of all four.
- **Small, surgical, well-specified.** One src file, exact code given by the contract, a known and
  fully-scoped set of test edits. No new module, no runtime change, no data model.

## What

**User-visible behavior**: None directly. These are configuration knobs read by downstream filter/nudge
logic. The observable effect (once the consumers land) is that the drift nudge uses a 6000-token
*windowed* trip point instead of 3000-token single-turn, and a one-time high-water annotation fires at
70% of the context window. With config disabled (`enabled: false`) or the knobs absent, all behavior is
identical to today (defaults apply).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. **`MulliganConfig.nudges` interface** — add `driftWindowTurns: number` (positive integer; rolling
   window for §5.1) and `highWaterFraction: number` (§5.2 edge-triggered fraction of context window,
   in open interval (0,1)). Keep `driftThresholdTokens: number`; update its JSDoc default 3000→6000
   and note the §5.1 windowing rationale.
2. **`DEFAULT_CONFIG.nudges`** — add `driftWindowTurns: 3`, `highWaterFraction: 0.7`; change
   `driftThresholdTokens: 3000` → `6000`.
3. **`validateConfig` nudges block** — add the two validation clauses (verbatim code in Implementation
   Blueprint). `driftWindowTurns` = `coerceNumber(...,true)` then `Math.floor`. `highWaterFraction` =
   dedicated inline `typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1` else `warnConfig`.
4. **Update all tests** that assert `driftThresholdTokens === 3000` (config.test.ts) → `6000`; add
   the new knobs to the existing `toEqual` objects; pin the threshold in the turn_metric boundary tests.

### Success Criteria
- [ ] `MulliganConfig.nudges` has `driftWindowTurns: number` and `highWaterFraction: number` (required, non-optional).
- [ ] `DEFAULT_CONFIG.nudges.driftWindowTurns === 3`, `.highWaterFraction === 0.7`, `.driftThresholdTokens === 6000`.
- [ ] `validateConfig` floors `driftWindowTurns` to an integer; invalid → default `3` + 1 warn naming `nudges.driftWindowTurns`.
- [ ] `validateConfig` enforces `highWaterFraction ∈ (0,1)` (dedicated check); invalid → default `0.7` + 1 warn naming `nudges.highWaterFraction`.
- [ ] All 3000-asserting tests updated to 6000; `toEqual` objects updated to include the new knobs.
- [ ] turn_metric boundary tests pinned so they don't break on the raised default.
- [ ] `npx tsc --noEmit` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the exact `config.ts` blocks to edit (interface, DEFAULT_CONFIG, validateConfig
nudges block — verbatim), gives the exact validation code from the contract, names the exact helpers to
reuse (`safeGet`, `coerceNumber`, `warnConfig`) with their signatures, specifies every test edit
line-by-line (including the non-obvious `turn_metric.test.ts` boundary-test break and its fix), and
provides the full new describe-block test list. An implementer who has never seen this repo can do it
from this document + `src/config.ts` + `test/config.test.ts` + `test/turn_metric.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file you are editing
- file: src/config.ts
  why: |
    Contains MulliganConfig interface, DEFAULT_CONFIG, and validateConfig — the three sites to edit.
    The validateConfig nudges block is where the two new clauses go (after the driftThresholdTokens line).
  pattern: |
    // validateConfig nudges block (current state — the insertion point is AFTER the driftThresholdTokens line):
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
      // <── INSERT driftWindowTurns + highWaterFraction clauses HERE ──>
      v = safeGet(nudgesRaw, "bloatThresholdBytesByTool");
      if (v !== undefined) cfg.nudges.bloatThresholdBytesByTool = coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool);
    }
  section: validateConfig nudges block (the `const nudgesRaw = …` if-block)
  gotcha: |
    REUSE the module-private helpers — do NOT inline new ones. `safeGet(obj, key)` returns undefined on
    absent/throwing reads. `coerceNumber(field, value, fallback, mustBePositive)` → finite number (and >0
    when mustBePositive) or fallback+warn. `warnConfig(field, value)` logs a warn naming the field+value.
    The `v !== undefined` guard SKIPS absent fields (keep default, NO warn); only present-but-invalid warns.

# MUST READ — the helpers' exact signatures (module-private in config.ts, reuse as-is)
- file: src/config.ts
  why: "coerceNumber / warnConfig / safeGet are the building blocks. They are already in scope in validateConfig."
  pattern: |
    function safeGet(obj: object, key: string): unknown   // returns undefined if absent OR get-trap throws
    function coerceNumber(field: string, value: unknown, fallback: number, mustBePositive: boolean): number
      // returns value if (typeof number && isFinite && (>0 if mustBePositive else >=0)); else warnConfig(field,value) + fallback
    function warnConfig(field: string, value: unknown): void   // console.warn "[mulligan] config: invalid \"<field>\"=…"; never throws

# MUST READ — the test file to extend for the new knobs
- file: test/config.test.ts
  why: |
    Mirror the "shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 …)" describe block — it is the
    established pattern for a new-knob validation describe (valid passthrough, defaults-no-warn, boundary,
    per-invalid-value warn count via vi.spyOn(console,"warn"), type-level). Reuse its exact structure.
    ALSO: 4 existing assertions must be updated for 3000→6000 + new fields (see Implementation Tasks Task 5).
  pattern: |
    describe("nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000 (P3.M3.T1.S1 / spec/09 §2-§4)", () => {
      it("defaults to 3 / 0.7 / 6000 with NO warn", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const cfg = validateConfig({});
          expect(cfg.nudges.driftWindowTurns).toBe(3);
          expect(cfg.nudges.highWaterFraction).toBe(0.7);
          expect(cfg.nudges.driftThresholdTokens).toBe(6000);
          expect(warn).not.toHaveBeenCalled();
        } finally { warn.mockRestore(); }
      });
      // … (see Implementation Tasks Task 4 for the full case list)
    });
  section: the shrink.maxActive describe block (the template) + DEFAULT_CONFIG/validateConfig describes (the assertions to update)
  gotcha: |
    vi.spyOn(console,"warn") MUST be created inside each `it` and restored in a `finally` (mirror the
    bloatThresholdByTool tests). The module-level beforeEach (top of file) calls clearAll-equivalent — it
    does NOT reset config; validateConfig is pure (no cache), so no setConfig needed in these unit tests.

# MUST READ — the boundary tests that BREAK on 3000→6000 (the non-obvious gotcha)
- file: test/turn_metric.test.ts
  why: |
    Three tests construct deltas against the DEFAULT threshold (3000) to verify grewOverThreshold's strict
    `>` boundary. The module-level beforeEach does `setConfig(structuredClone(DEFAULT_CONFIG))` → uses the
    default. Raising the default to 6000 makes deltas 3001 and 4000 fall BELOW threshold → grewOverThreshold
    flips to false → the two expecting-true tests FAIL. nudges.ts:225 computes
    `grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens`.
  pattern: |
    // FIX (per affected `it`, as its FIRST statement — pins the threshold so deltas stay meaningful):
    setConfig({ nudges: { driftThresholdTokens: 3000 } });   // decouple boundary test from the global default
  section: "normal growth" describe (lines ~189-217, 2 tests) + the multi-turn "baseline rolls" test (~line 341)
  gotcha: |
    setConfig deep-merges per-leaf → `{ nudges: { driftThresholdTokens: 3000 } }` alone sets ONLY that knob;
    all other nudges (incl. the new driftWindowTurns/highWaterFraction) stay default. The pin runs AFTER the
    module-level beforeEach (which resets to DEFAULT_CONFIG), so it wins. Pinning to 3000 keeps the existing
    deltas (3001/3000/4000) AND the existing inline comments ("delta = 3001 > 3000") accurate — zero comment edits.

# Architecture reference (read-only confirmation — matches the contract exactly)
- docfile: plan/003_2c3b19ff6a7b/architecture/system_context.md
  section: "### config.ts (355 lines) — Pi-free config"
  why: |
    Confirms the P3 delta: "DEFAULT_CONFIG.nudges.driftThresholdTokens = 3000 — P3 delta: raise to 6000"
    and "nudges — P3 delta: add driftWindowTurns: 3, highWaterFraction: 0.7". Also notes recentMetrics is a
    SEPARATE task (T3) — do not add it here.
- docfile: plan/003_2c3b19ff6a7b/architecture/external_deps.md
  section: "## Config validation pattern (config.ts)"
  why: |
    Confirms the coercer design: "For highWaterFraction (fraction in (0,1)), the existing coerceNumber
    doesn't enforce the upper bound < 1. A dedicated coercer or an inline check is needed (finite, > 0, < 1).
    For driftWindowTurns, use coerceNumber with mustBePositive and additionally floor to integer." This is
    EXACTLY the contract's approach — no design deviation needed.

# Spec source (read-only; the source of these knobs + the rationale for 6000)
- docfile: spec/09-configuration.md
  section: "§2. Schema & defaults" + "§3. Rationale per knob" + "§4. Validation rules"
  why: |
    §2 shows the canonical nudges block (driftThresholdTokens: 6000, driftWindowTurns: 3, highWaterFraction: 0.7).
    §3 gives the rationale for the 3000→6000 raise. §4 gives the validation rules (numbers finite >0;
    never throw; warn-on-invalid). spec/07 §5.1/§5.2 define what the knobs mean (consumed by later tasks).
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts            # <-- MODIFY: interface + DEFAULT_CONFIG + validateConfig nudges block (+ JSDoc)
  nudges.ts            # read-only dep (line 225 reads config.nudges.driftThresholdTokens — NO edit this task)
  markers.ts           # read-only dep (JSDoc references driftThresholdTokens — optional comment, not required)
test/
  config.test.ts       # <-- MODIFY: 4 existing assertions + a NEW describe block
  turn_metric.test.ts  # <-- MODIFY: pin threshold in 3 boundary tests (critical gotcha)
  drift_nudge.test.ts  # NO CHANGE (builds grewOverThreshold literals; doesn't read config threshold)
  filter.test.ts       # NO CHANGE (builds metric literals directly)
  integration/
    smoke.ts           # optional comment-only accuracy fix (line ~221 "default 3000"→6000); not run by `npm test`
    scenarios.md       # optional markdown accuracy fix (lines ~181,196); not run by `npm test`
spec/
  09-configuration.md  # read-only (the source spec — already specifies these knobs)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/config.ts       # EXTENDED in place. nudges interface +2 fields; DEFAULT_CONFIG +2 fields & 1 value change; validateConfig +2 clauses.
test/config.test.ts # EXTENDED in place. 4 assertion updates + 1 new describe block (~10 cases).
test/turn_metric.test.ts # EXTENDED in place. 3 tests gain a 1-line threshold pin.
# No new files. All changes are additive edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — turn_metric.test.ts WILL BREAK if you only touch config.ts + config.test.ts.
//   nudges.ts:225 reads config.nudges.driftThresholdTokens to set grewOverThreshold on the turn metric.
//   turn_metric.test.ts constructs deltas of 3001 / 3000 / 4000 against the DEFAULT threshold (3000) to
//   test the strict-`>` boundary. Raise the default to 6000 and deltas 3001 + 4000 are no longer > threshold
//   → grewOverThreshold flips false → the two expecting-true tests FAIL. FIX: pin the threshold to 3000 in
//   those 3 tests via setConfig({ nudges: { driftThresholdTokens: 3000 } }) (see Task 6). This is NOT in the
//   contract's explicit "update 3000→6000" list — it is a behavioral side effect of raising the default.

// CRITICAL — highWaterFraction MUST use a DEDICATED (0,1) check, NOT coerceNumber.
//   coerceNumber(field, v, fallback, mustBePositive) enforces finite + (>0 or >=0) — it does NOT enforce
//   the upper bound < 1. A highWaterFraction of 1.5 would pass coerceNumber(true) (1.5 > 0) but is invalid.
//   The contract's inline check `typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1` is required.

// CRITICAL — driftWindowTurns is FLOORED to an integer. coerceNumber returns a finite>0 number (or fallback).
//   Apply Math.floor AFTER coerceNumber. The contract's defensive ternary
//   `Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns` keeps it verbatim — note n is always
//   finite post-coerceNumber (returns either a finite value or the finite fallback), so the floor always runs;
//   the ternary is belt-and-suspenders. 5.7 → 5. Do NOT round (Math.round) — the contract says floor.

// CRITICAL — never throw (spec/09 §4). validateConfig's whole body is wrapped in try/catch → all-defaults.
//   The new clauses are inside that body, so a throwing Proxy get-trap (safeGet) or adversarial input is
//   already caught. Do NOT add a separate try/catch for the new clauses — they sit safely inside the existing one.

// CRITICAL — the `v !== undefined` guard SKIPS absent fields (keep default, NO warn); only present-but-invalid
//   values warn. This is the established pattern (every nudges/shrink/rewind clause follows it). Absent
//   driftWindowTurns/highWaterFraction must NOT warn — they just keep the default (3 / 0.7).

// GOTCHA — `v` is a single `let v: unknown` reused across all clauses in validateConfig (declared once near
//   the top). The two new clauses reassign `v` via safeGet, exactly like every other clause. Do NOT declare a
//   second `v`.

// GOTCHA — highWaterFraction has NO string coercion. validateConfig("0.7") (string) → invalid → warnConfig →
//   default 0.7. Mirrors coerceNumber (which also rejects strings). Do NOT parseFloat.

// GOTCHA — the `applies a full valid override` test (config.test.ts) uses `.toEqual` with a COMPLETE object
//   literal. Because the new knobs default to 3/0.7 and the test input does NOT set them, the expected nudges
//   object in that toEqual MUST add `driftWindowTurns: 3, highWaterFraction: 0.7` or deep-equality fails.
//   Same for the DEFAULT_CONFIG toEqual (add the 2 fields + change 3000→6000).

// GOTCHA — setConfig deep-merges per-leaf (validateConfig clones DEFAULT_CONFIG then overlays raw). So
//   setConfig({ nudges: { driftThresholdTokens: 3000 } }) sets ONLY driftThresholdTokens — every other nudges
//   knob (bloatReminder, perTurnDrift, bloatThresholdBytes, bloatThresholdBytesByTool, AND the new
//   driftWindowTurns/highWaterFraction) stays at default. This is what makes the turn_metric pin a clean 1-liner.
```

## Implementation Blueprint

### Data models and structure

```typescript
// MulliganConfig.nudges — the ONLY data-model change (interface in src/config.ts):
nudges: {
  bloatReminder: boolean;
  perTurnDrift: boolean;
  bloatThresholdBytes: number;
  bloatThresholdBytesByTool?: Record<string, number>;
  driftThresholdTokens: number;   // default 6000 (was 3000)
  driftWindowTurns: number;       // NEW — positive integer, default 3 (§5.1 rolling window)
  highWaterFraction: number;      // NEW — fraction in (0,1), default 0.7 (§5.2 edge-triggered)
};
// No pydantic/orm — this is a plain TS interface validated by validateConfig. No schema library; typebox
// is used only for tool params (tools/*.ts), not config.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts — MulliganConfig.nudges interface (+2 fields + JSDoc)
  - LOCATE the `nudges: { … }` block inside `export interface MulliganConfig` (the block with bloatReminder,
    perTurnDrift, bloatThresholdBytes, bloatThresholdBytesByTool?, driftThresholdTokens).
  - ADD after the driftThresholdTokens field (keep field order tidy; placement among nudges fields is flexible
    but grouping the three drift knobs together reads best):
      /** Rolling window (in turns) over which the per-turn token delta is smoothed before thresholding
       *  (spec/07 §5.1). Positive integer. Default: 3. Consumed by shouldNudge (P3.M3.T4) + readMarkers
       *  recent-metrics window (P3.M3.T3). */
      driftWindowTurns: number;
      /** Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered —
       *  once on crossing, cleared when total drops back below). Must be in the open interval (0,1).
       *  Default: 0.7. Consumed by shouldHighWater (P3.M3.T5) + contextHandler (P3.M3.T6). */
      highWaterFraction: number;
  - UPDATE the existing driftThresholdTokens JSDoc: change "Default: 3000." → "Default: 6000 (raised from
    3000; spec/09 §3: the §5.1 windowing makes 6000 a quiet, accurate trip point)." Keep the "Must be > 0."
    and "Turn token-delta above which the per-turn drift nudge fires." lines.
  - NAMING: driftWindowTurns / highWaterFraction (exact, camelCase — match spec/09 §2 + the contract).
  - GOTCHA: both are REQUIRED (non-optional, no `?`) — they always have a value (the default). Mirrors
    driftThresholdTokens. Do NOT make them optional.

Task 2: MODIFY src/config.ts — DEFAULT_CONFIG.nudges (+2 fields, driftThresholdTokens 3000→6000)
  - LOCATE `export const DEFAULT_CONFIG: MulliganConfig = { … nudges: { … } … }`.
  - CHANGE `driftThresholdTokens: 3000,` → `driftThresholdTokens: 6000,`.
  - ADD inside the nudges literal (after driftThresholdTokens):
      driftWindowTurns: 3,
      highWaterFraction: 0.7,
  - WHY: spec/09 §2 mandates exactly these defaults. The 3000→6000 raise is the spec drift fix.
  - GOTCHA: DEFAULT_CONFIG is the shared singleton cloned by validateConfig — never mutated at runtime.
    Adding the 2 fields here is what makes them default-correct for every absent-field path.

Task 3: MODIFY src/config.ts — validateConfig nudges block (+2 clauses)
  - LOCATE the `const nudgesRaw = safeGet(raw, "nudges"); if (isRecord(nudgesRaw)) { … }` block.
  - INSERT these two clauses AFTER the driftThresholdTokens clause and BEFORE the bloatThresholdBytesByTool
    clause (grouping the three drift knobs; reusing the shared `let v: unknown`):
      v = safeGet(nudgesRaw, "driftWindowTurns");
      if (v !== undefined) {
        const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
        cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
      }
      v = safeGet(nudgesRaw, "highWaterFraction");
      if (v !== undefined) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;
        else warnConfig("nudges.highWaterFraction", v);
      }
  - WHY driftWindowTurns uses coerceNumber(true) then floor: coerceNumber gives finite>0 (or default+warn on
    invalid); floor makes it an integer. WHY highWaterFraction uses a dedicated check: coerceNumber cannot
    enforce < 1 (1.5 would pass). The inline `(0,1)` guard + warnConfig is the spec/09 §4-compliant path.
  - FOLLOW pattern: the existing `v = safeGet(nudgesRaw, "driftThresholdTokens"); if (v !== undefined) …`
    clause — identical safeGet + `if (v !== undefined)` shape.
  - GOTCHA: do NOT declare a new `v` — reuse the shared one. Do NOT add a try/catch — the whole validateConfig
    body is already wrapped. Do NOT parseFloat / round. Keep the Math.floor ternary verbatim (defensive).

Task 4: MODIFY test/config.test.ts — ADD a new describe block for the two knobs + threshold raise
  - ADD a new describe AFTER the existing "shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 …)" block,
    mirroring its structure. Title:
      describe("nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000 (P3.M3.T1.S1 / spec/09 §2-§4)", () => { … })
  - CASES (one `it` each; use `const warn = vi.spyOn(console, "warn").mockImplementation(() => {});` + `try { … } finally { warn.mockRestore(); }` per the bloatThresholdByTool tests):
    1. "(a) defaults: driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 6000 — NO warn":
       validateConfig({}) → assert all three; assert warn NOT called.
    2. "(b) passes through all three valid values together":
       validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } })
       → expect driftWindowTurns 5, highWaterFraction 0.8, driftThresholdTokens 10000. (warn NOT called.)
    3. "(c) driftWindowTurns is FLOORED to an integer (5.7 → 5)":
       validateConfig({ nudges: { driftWindowTurns: 5.7 } }) → 5. (5.7 is finite>0 → coerceNumber returns 5.7 → floor 5. No warn.)
    4. "(d) driftWindowTurns invalid ∈ {0,-1,NaN,'abc',Infinity} → 3 + exactly 1 warn naming nudges.driftWindowTurns":
       loop over [0, -1, NaN, "abc", Infinity]; for each, validateConfig({ nudges: { driftWindowTurns: bad } })
       → expect 3; warn called once; call[0][0] contains "nudges.driftWindowTurns". (0 fails >0; -1 fails >0;
       NaN fails isFinite; "abc" fails typeof number; Infinity fails isFinite.)
    5. "(e) highWaterFraction invalid ∈ {0, 1, -0.5, 1.5, NaN} → 0.7 + exactly 1 warn naming nudges.highWaterFraction":
       loop over [0, 1, -0.5, 1.5, NaN]; each → 0.7; warn once; call contains "nudges.highWaterFraction".
       (0 fails >0; 1 fails <1; -0.5 fails >0; 1.5 fails <1; NaN fails isFinite.)
    6. "(f) highWaterFraction is NOT string-coerced ('0.7' → 0.7 default + warn)":
       validateConfig({ nudges: { highWaterFraction: "0.7" } }) → 0.7; warn once naming nudges.highWaterFraction.
    7. "(g) highWaterFraction valid near-boundary values 0.01 and 0.99 are KEPT":
       validateConfig({ nudges: { highWaterFraction: 0.01 } }).highWaterFraction → 0.01;
       validateConfig({ nudges: { highWaterFraction: 0.99 } }).highWaterFraction → 0.99. (open interval.)
    8. "(h) existing nudges knobs UNCHANGED when new knobs are set":
       validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8 } }) → assert bloatReminder true,
       perTurnDrift true, bloatThresholdBytes 16384, bloatThresholdBytesByTool {bash:32768,read:20480} (all default).
    9. "(i) round-trip via setConfig/getConfig":
       setConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } });
       getConfig() → all three correct. (setConfig deep-merges; only those three set.) [Wrap in the
       getConfig/setConfig cache describe OR add a standalone setConfig reset — see the shrink describe which
       calls validateConfig directly, NOT setConfig, to avoid cache coupling. Prefer validateConfig for purity.]
    10. "(type) driftWindowTurns / highWaterFraction are required numbers (type-level)":
        expectTypeOf<MulliganConfig["nudges"]>().toHaveProperty("driftWindowTurns").toEqualTypeOf<number>();
        expectTypeOf<MulliganConfig["nudges"]>().toHaveProperty("highWaterFraction").toEqualTypeOf<number>();
  - FOLLOW pattern: the shrink.maxActive describe block (valid passthrough, defaults-no-warn, boundary 1/1,
    per-invalid loop with warn count, type-level). Use validateConfig directly (pure) for cases 1-8,10.
  - GOTCHA: vi.spyOn(console,"warn") MUST be per-`it` + restored in finally (mirror bloatThresholdByTool tests).
    Do NOT rely on a shared spy.

Task 5: MODIFY test/config.test.ts — UPDATE the 4 existing assertions (3000→6000 + new fields)
  - (5a) "DEFAULT_CONFIG matches the spec/09 §2 defaults exactly" (`expect(DEFAULT_CONFIG).toEqual({...})`):
    in the nudges literal, CHANGE `driftThresholdTokens: 3000,` → `driftThresholdTokens: 6000,` AND ADD
    `driftWindowTurns: 3,` and `highWaterFraction: 0.7,`. (toEqual does deep equality — the new default fields
    must appear or this test fails.)
  - (5b) "deep-merges partial valid overrides over defaults":
    CHANGE `expect(cfg.nudges.driftThresholdTokens).toBe(3000); // unchanged default` → `.toBe(6000); // unchanged default`.
  - (5c) "applies a full valid override" (`expect(cfg).toEqual({...})`): the input nudges is
    `{ bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1 }` (does NOT
    set the new knobs → they default). UPDATE the expected nudges object to:
      nudges: { bloatReminder: false, perTurnDrift: false, bloatThresholdBytes: 1, driftThresholdTokens: 1, bloatThresholdBytesByTool: { bash: 32768, read: 20480 }, driftWindowTurns: 3, highWaterFraction: 0.7 },
    (Add the two fields; bloatThresholdBytesByTool already present. driftThresholdTokens stays 1 — it's in the input.)
  - (5d) "does NOT warn for ABSENT fields in a partial override":
    CHANGE `expect(cfg.nudges.driftThresholdTokens).toBe(3000); // absent → default, silently` → `.toBe(6000); // absent → default, silently`.
  - GOTCHA: do NOT touch the "validates numbers" test unless you choose to add a `driftThresholdTokens: 0 → 6000`
    assertion there (optional — the mustBePositive path is already covered for bloatThresholdBytes). Leaving it
    is fine. The "ignores unknown keys" test compares two validateConfig outputs (both gain the new fields
    identically) so it stays consistent — no edit needed.

Task 6: MODIFY test/turn_metric.test.ts — PIN the threshold in the 3 boundary tests (CRITICAL)
  - WHY: these tests construct deltas (3001 / 3000 / 4000) against the DEFAULT threshold to verify
    grewOverThreshold's strict `>` boundary. Raising the default to 6000 makes deltas 3001 + 4000 fall below
    threshold → the two expecting-true tests FAIL. Pin the threshold so the deltas stay meaningful.
  - (6a) "records grewOverThreshold true + deltaTokens = now - baseline" (~line 190, in the "normal growth"
    describe): as the FIRST statement inside the `it`, ADD:
      setConfig({ nudges: { driftThresholdTokens: 3000 } });   // pin: delta 3001 must exceed the threshold
    (delta 3001 > 3000 → grew true, as the test expects. The inline comment "delta = 3001 > 3000" stays accurate.)
  - (6b) "records grewOverThreshold false when delta == threshold (strict >, not >=)" (~line 206, same describe):
    ADD the same first statement `setConfig({ nudges: { driftThresholdTokens: 3000 } });`.
    (delta 3000 == 3000 → NOT > → false, as expected. Comment "3000 == threshold" stays accurate.)
  - (6c) the multi-turn test whose turn-2 delta is 4000 and asserts `d2.grewOverThreshold === true` (~line 341,
    in the "baseline rolls forward" / multi-turn describe): ADD the same first statement
    `setConfig({ nudges: { driftThresholdTokens: 3000 } });`.
    (delta 4000 > 3000 → grew true, as expected. Comment "delta = 4000 > 3000" stays accurate.)
  - FOLLOW pattern: the module-level beforeEach already does `setConfig(structuredClone(DEFAULT_CONFIG))` —
    the pin runs after it and overrides ONLY driftThresholdTokens (deep-merge). setConfig is already imported
    in this file (line: `import { DEFAULT_CONFIG, setConfig } from "../src/config.js";`).
  - GOTCHA: pin to 3000 (NOT a new arbitrary value) — it keeps every existing delta + inline comment valid
    with zero other edits. Do NOT change the deltas or the msgOfChars sizes. Do NOT add a describe-level
    beforeEach (ambiguous across the 3 tests in 2 different describes) — pin per-test for clarity.
  - GOTCHA: the negative-delta test ("delta = -3000 → false", ~line 223) does NOT need pinning — -3000 is
    below any positive threshold → false regardless. Leave it untouched.
  - NOTE: a cleaner long-term alternative is to pin via a describe-scoped beforeEach in the "normal growth"
    describe. Either is acceptable; per-test pinning is more explicit and avoids describe-boundary ambiguity.

Task 7 (OPTIONAL — accuracy only, NOT required for green tests): update stale 3000 references in integration docs
  - test/integration/smoke.ts (~line 221): comment "(default 3000)" → "(default 6000)".
  - test/integration/scenarios.md (~lines 181, 196): ">3000 tokens (default driftThresholdTokens)" → 6000.
  - WHY: accuracy; these are NOT run by `npm test` (vitest runs *.test.ts only; smoke = `npm run smoke`;
    scenarios.md is markdown). Skip if pressed for time — they don't affect the validation gates. The contract
    says "DOCS: none" (referring to spec/ Mode-A docs); these are integration-test artifacts.
```

### Implementation Patterns & Key Details

```typescript
// THE two new validateConfig clauses (verbatim from the contract — place after driftThresholdTokens, before
// bloatThresholdBytesByTool, reusing the shared `let v: unknown`):
v = safeGet(nudgesRaw, "driftWindowTurns");
if (v !== undefined) {
  const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
  cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
}
v = safeGet(nudgesRaw, "highWaterFraction");
if (v !== undefined) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1) cfg.nudges.highWaterFraction = v;
  else warnConfig("nudges.highWaterFraction", v);
}

// WHY coerceNumber+floor for driftWindowTurns: coerceNumber(field, v, fallback, true) returns a finite>0
//   number (the value, if valid) or the fallback (default 3) + a warn (if invalid). Math.floor then makes it
//   an integer (5.7 → 5). The ternary `Number.isFinite(n) ? Math.floor(n) : fallback` is defensive — n is
//   always finite post-coerceNumber (it returns either a finite value or the finite fallback), so the floor
//   always runs; keep the ternary verbatim per the contract.

// WHY a dedicated (0,1) check for highWaterFraction: coerceNumber's mustBePositive only enforces >0; it CANNOT
//   reject 1.5 (1.5 > 0). The spec mandates the open interval (0,1). The inline guard is the spec/09 §4 path.
//   warnConfig(field, value) (module-private) logs "[mulligan] config: invalid \"nudges.highWaterFraction\"=…"
//   and never throws — exactly the per-field-failure-uses-default-continues behavior §4 requires.

// WHY both new fields are REQUIRED (no `?`): they always carry the default (3 / 0.7); there is no "unset"
//   state. Mirrors driftThresholdTokens / maxActive / staleAfterFires.

// THE turn_metric pin (the non-obvious behavioral fix) — first statement of 3 affected `it`s:
setConfig({ nudges: { driftThresholdTokens: 3000 } });   // decouple boundary test from the raised default
//   setConfig → validateConfig deep-merges: ONLY driftThresholdTokens is set to 3000; every other nudges knob
//   (incl. the new driftWindowTurns=3, highWaterFraction=0.7) stays at default. The deltas (3001/3000/4000)
//   are then meaningful against 3000 again. This is setConfig (cache path) — already imported in that test file.
```

### Integration Points

```yaml
CONFIG (src/config.ts):
  - interface MulliganConfig.nudges: +driftWindowTurns (number), +highWaterFraction (number)
  - DEFAULT_CONFIG.nudges: +driftWindowTurns: 3, +highWaterFraction: 0.7, driftThresholdTokens: 6000 (was 3000)
  - validateConfig nudges block: +2 clauses (driftWindowTurns floor; highWaterFraction (0,1) check)

TESTS:
  - test/config.test.ts: 4 assertion updates + 1 new describe block (~10 cases)
  - test/turn_metric.test.ts: 3 tests gain a 1-line threshold pin

NO DATABASE / NO ROUTES / NO NEW FILES / NO runtime.ts / NO index.ts / NO nudges.ts / NO filter.ts.
  - nudges.ts:225 already reads config.nudges.driftThresholdTokens (NO edit — it just reads 6000 now instead
    of 3000; the boundary tests are pinned so this doesn't flip their expectations).
  - Consumers (shouldNudge P3.M3.T4, shouldHighWater P3.M3.T5, readMarkers recentMetrics P3.M3.T3,
    contextHandler P3.M3.T6): FUTURE tasks. They will read these knobs; none exist yet. Adding the knobs now
    is purely additive — nothing in src/ references driftWindowTurns/highWaterFraction today.

DOCS:
  - None required (spec/09 already specifies these knobs — it is the SOURCE of this delta; spec/07 §5.1/§5.2
    define their meaning). Optional accuracy fixes in test/integration/smoke.ts + scenarios.md (Task 7).
  - README config table update is P3.M4.T1.S1 (a later, dedicated doc-sync task) — do NOT touch README here.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: ZERO errors. If tsc errors "Property 'driftWindowTurns'/'highWaterFraction' is missing in type
# 'DEFAULT_CONFIG' / the toEqual literals" → you added the interface fields but forgot DEFAULT_CONFIG or the
# test toEqual objects. If "Property 'driftWindowTurns' does not exist on type 'MulliganConfig["nudges"]'" in
# turn_metric/config tests → the interface edit didn't land. If "Cannot find name 'warnConfig'/'safeGet'" inside
# the new clauses → you're outside the validateConfig body (they're module-private, in scope only inside it).

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test files in isolation first (fast feedback).
npx vitest run test/config.test.ts
# Expected: ALL pass. Watch especially:
#   - "DEFAULT_CONFIG matches spec/09 §2 defaults exactly": the toEqual now includes driftWindowTurns:3,
#     highWaterFraction:0.7, driftThresholdTokens:6000. If it fails "expected … to deep-equal …", you missed
#     adding the 2 fields to the expected literal (Task 5a) OR didn't change 3000→6000.
#   - "applies a full valid override": expected nudges must now include driftWindowTurns:3, highWaterFraction:0.7.
#   - New describe block (Task 4): every case green — defaults-no-warn, 5.7→5 floor, per-invalid warn counts,
#     (0,1) boundary, string-not-coerced, type-level.

npx vitest run test/turn_metric.test.ts
# Expected: ALL pass. The 3 boundary tests (190/206/341) now have the threshold pinned → grewOverThreshold
# expectations hold. If "expected true, received false" on a grewOverThreshold assert → you forgot the pin
# (Task 6) OR the pin line isn't the FIRST statement (it must run before turnEndMetricHandler).

# Then the full suite to prove no regression.
npm test
# Expected: ALL green. drift_nudge.test.ts / filter.test.ts / markers.test.ts build grewOverThreshold literals
# directly (don't read config threshold) → unaffected. runtime.test.ts / tokens.test.ts → unaffected.
```

### Level 3: Integration Testing (System Validation)

```bash
# This task changes config.ts only (validateConfig + DEFAULT_CONFIG). The config is consumed lazily by
# getConfig() (cached). The integration smoke harness exercises real Pi events:
npm run smoke   # optional — should pass unchanged (it does not assert the drift threshold value; the nudge
                # scenario in scenarios.md uses lowered driftThresholdTokens to force-fire deterministically).
# Expected: no change. If it does assert a 3000 default somewhere, update the assertion (Task 7 covers the
# known comment/doc references).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the new unit tests (the real gate for config validation):
#   - defaults 3/0.7/6000 with NO warn (absent fields never warn)
#   - valid passthrough: {5, 0.8, 10000} → all set
#   - driftWindowTurns floored (5.7 → 5); invalid {0,-1,NaN,"abc",Infinity} → 3 + warn
#   - highWaterFraction (0,1) guard: {0,1,-0.5,1.5,NaN} → 0.7 + warn; "0.7" string → 0.7 + warn (no coercion)
#   - highWaterFraction near-boundary 0.01/0.99 kept
#   - existing nudges knobs unchanged
#   - never throws (adversarial input → all defaults — covered by the existing validateConfig GOTCHA tests)
# These mirror spec/09 §4 ("on any per-field validation failure: log a warn naming the field and the value,
# use the default, continue. Never throw.") at the unit level.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (interface fields + DEFAULT_CONFIG + validateConfig clauses + test literals).
- [ ] `npx vitest run test/config.test.ts` — all pass (4 updated assertions + ~10 new cases).
- [ ] `npx vitest run test/turn_metric.test.ts` — all pass (3 boundary tests pinned).
- [ ] `npm test` — full suite green (no regressions; drift_nudge/filter/markers unaffected).

### Feature Validation
- [ ] `validateConfig({})` → nudges.driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 6000 (no warn).
- [ ] `validateConfig({ nudges: { driftWindowTurns: 5, highWaterFraction: 0.8, driftThresholdTokens: 10000 } })` → 5/0.8/10000.
- [ ] driftWindowTurns: 5.7 → 5 (floored); invalid → 3 + 1 warn naming `nudges.driftWindowTurns`.
- [ ] highWaterFraction: {0,1,-0.5,1.5,NaN,"0.7"} → 0.7 + 1 warn naming `nudges.highWaterFraction`; 0.01/0.99 kept.
- [ ] Existing nudges knobs unchanged when the new knobs are set.
- [ ] turn_metric boundary tests still pass (grewOverThreshold true at deltas 3001/4000; false at 3000==threshold).

### Code Quality Validation
- [ ] New validateConfig clauses follow the established `v = safeGet(…); if (v !== undefined) { … }` pattern.
- [ ] Reuse module-private helpers (safeGet, coerceNumber, warnConfig) — no new helper functions, no inline reimplementations.
- [ ] Both new interface fields are REQUIRED (no `?`); JSDoc present (purpose + default + consumer tasks).
- [ ] The defensive `Number.isFinite(n) ? Math.floor(n) : fallback` ternary kept verbatim (contract fidelity).
- [ ] highWaterFraction uses a DEDICATED (0,1) check — NOT coerceNumber (which can't enforce <1).
- [ ] No changes outside `src/config.ts`, `test/config.test.ts`, `test/turn_metric.test.ts` (Task 7 integration-doc fixes optional).

### Documentation & Deployment
- [ ] JSDoc on driftThresholdTokens updated (default 3000→6000 + rationale).
- [ ] JSDoc on the two new fields present (§5.1 / §5.2 references + default + consumer tasks).
- [ ] No README change required (README config-table sync is P3.M4.T1.S1 — a dedicated later task).
- [ ] (Optional) smoke.ts/scenarios.md 3000→6000 accuracy fixes (Task 7).

---

## Anti-Patterns to Avoid

- ❌ Do NOT use `coerceNumber` for `highWaterFraction` — it cannot enforce `< 1` (1.5 would pass `> 0`). Use the contract's dedicated inline `(0,1)` check + `warnConfig`.
- ❌ Do NOT `Math.round` `driftWindowTurns` — the contract says `Math.floor` (5.7 → 5, not 6). Apply floor AFTER `coerceNumber`.
- ❌ Do NOT make the new fields optional (`?`) — they always carry a default; they are required like `driftThresholdTokens`.
- ❌ Do NOT parseFloat / string-coerce `highWaterFraction` — `"0.7"` (string) is invalid → warn + default. validateConfig does no string coercion for any number knob.
- ❌ Do NOT declare a second `let v` in validateConfig — reuse the shared one (declared once near the top of the try).
- ❌ Do NOT add a try/catch around the new clauses — the whole validateConfig body is already wrapped (spec/09 §4 "never throw").
- ❌ Do NOT warn for ABSENT driftWindowTurns/highWaterFraction — the `if (v !== undefined)` guard skips absent fields (keep default, no warn). Warn only on present-but-invalid.
- ❌ Do NOT forget the `toEqual` updates in config.test.ts — deep-equality fails if the expected literal omits the 2 new default fields or keeps 3000.
- ❌ Do NOT skip Task 6 (turn_metric pin) — the 3000→6000 raise silently flips grewOverThreshold for deltas 3001/4000; the two expecting-true tests WILL fail. This is the non-obvious behavioral side effect.
- ❌ Do NOT pin the turn_metric threshold to 6000 and bump the deltas — that inflates message sizes and re-couples the boundary test to the global default. Pin to 3000 (keeps all existing deltas + comments valid, decouples from future default changes).
- ❌ Do NOT touch `nudges.ts` / `filter.ts` / `runtime.ts` / `markers.ts` / `index.ts` — consumers are FUTURE tasks (P3.M3.T3/T4/T5/T6). This task is config + tests only.
- ❌ Do NOT update the README config table — that is P3.M4.T1.S1 (a dedicated later doc-sync task).
- ❌ Do NOT create a new file — all changes are additive edits to existing files.

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. This is a narrowly-scoped config task with the exact
validation code given verbatim by the contract, a known and fully-enumerated set of test edits, and
architecture docs (`system_context.md` §config.ts + `external_deps.md` §Config validation pattern) that
confirm the design matches the contract exactly (dedicated `(0,1)` check for highWaterFraction; floor for
driftWindowTurns). The two residual risks, both explicit in the tasks: (1) **the turn_metric boundary-test
break** (Task 6) — raising the default to 6000 silently flips `grewOverThreshold` for the 3001/4000-delta
tests; the PRP identifies the exact 3 tests, the exact cause (nudges.ts:225 reads the default), and the exact
1-line fix (`setConfig({ nudges: { driftThresholdTokens: 3000 } })`), which preserves every existing delta and
comment; (2) **the `toEqual` deep-equality updates** (Task 5) — three config.test.ts assertions use complete
object literals that must gain the 2 new default fields or fail. Both are mechanical once identified. No
external research adds value — the in-repo `coerceNumber`/`warnConfig`/`safeGet` pattern (established by
P3.M2.T1.S1 for shrink.maxActive/staleAfterFires) is authoritative and this task mirrors it exactly.