# PRP — P1.M1.T3.S1: Lower `driftThresholdTokens` default to 4000 and change `shouldNudge` comparison to `>=` (BUG-003 fix)

---

## Goal

**Feature Goal**: Make the windowed drift nudge (Nudge B) satisfy **all three** spec/07 §5.1 acceptance criteria — specifically the unmet criterion **(b) "three ~4k turns in a row DO fire"** — by (a) lowering `DEFAULT_CONFIG.nudges.driftThresholdTokens` from `6000` → `4000` and (b) changing `shouldNudge`'s comparison from strict `>` to `>=`. Today `shouldNudge` computes `avg(window deltas)` and compares `avg > driftThresholdTokens` (default 6000), so `avg([4000,4000,4000]) = 4000 < 6000` does NOT fire — directly contradicting criterion (b). At default 4000 + `>=`: (a) `avg([8000,500,500])=3000 >= 4000`? No ✓; (b) `avg([4000,4000,4000])=4000 >= 4000`? Yes ✓; (c) `avg(~0) >= 4000`? No ✓.

**Deliverable**:
1. `src/config.ts` (MODIFY) — `DEFAULT_CONFIG.nudges.driftThresholdTokens`: `6000` → `4000`; rewrite the field's interface JSDoc with the new default + rationale that all three §5.1 criteria hold (Mode A docs).
2. `src/nudges.ts` (MODIFY) — `shouldNudge` return: `avg > driftThresholdTokens` → `avg >= driftThresholdTokens`; update the `@returns` JSDoc (`>` → `>=`); rewrite the `SPEC-AMBIGUITY RESOLUTION` comment to note criterion (b) is now satisfied (removing the "ILLUSTRATIVE" recharacterization).
3. `test/config.test.ts` (MODIFY) — the **4 places** that read `driftThresholdTokens`'s default value directly (audit result): update `6000` → `4000` (structural `toEqual` + 3 `toBe(6000)` + the describe/test titles at the `driftThresholdTokens 6000` block).
4. `test/drift_nudge.test.ts` (MODIFY) — existing tests pass unchanged (they use an explicit-threshold `cfg()` helper); **ADD** new tests proving criterion (b) fires + boundary (`>=` edge) + criterion (a) reaffirmed at threshold 4000.

**Success Definition**:
- `shouldNudge([m(4000,3), m(4000,2), m(4000,1)], cfg(3, 4000)) === true` (criterion (b) — was `false` before the fix).
- `shouldNudge([m(8000,3), m(500,2), m(500,1)], cfg(3, 4000)) === false` (criterion (a) holds at the new default).
- `DEFAULT_CONFIG.nudges.driftThresholdTokens === 4000`; `validateConfig({})` returns `driftThresholdTokens: 4000`.
- `npm test` (vitest run) — full suite passes; `npm run typecheck` (`tsc --noEmit`) — no new errors.
- `grewOverThreshold` (src/nudges.ts:226, the audit/back-compat single-turn precompute) is **UNCHANGED** — out of scope; its `>` is semantically distinct (raw single-turn delta, deliberately unused by the gate).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + the agent relying on Nudge B (the signature "free-ride" drift nudge) during long sessions with sustained, sub-spike context growth.

**Use Case**: The agent runs three consecutive turns each adding ~4000 tokens of context (routine file edits / reads accumulating). Today no nudge fires (4000-avg < 6000 threshold), so the slow drift goes unannotated until it crosses 6000-avg — exactly the "sustained growth" §5.1 is meant to catch. After the fix, the windowed average of ~4000 meets the lowered default 4000 with `>=` and the one-line nudge fires on the third turn.

**User Journey**: Three ~4k turns accumulate → `shouldNudge` computes `avg ≈ 4000` → `4000 >= 4000` → true → `suppressCheck` passes (no marker this turn) → `injectNudge` appends the one-line ephemeral drift annotation to the model's filtered view → the agent sees the nudge and can rewind/shrink.

**Pain Points Addressed**: A stated PRD acceptance criterion (spec/07 §5.1 (b)) was silently violated — the code comment even recharacterized (b) as "ILLUSTRATIVE" instead of implementing it. This closes the PRD-compliance gap for a headline feature.

## Why

- **Business value / user impact**: Major (BUG-003). The drift nudge is a headline feature ("the non-obvious mechanism the project pivoted on" per the PRD). Missing an explicit spec acceptance criterion is a real PRD-compliance gap, not a cosmetic nit. The fix is the smallest defensible change that satisfies all three §5.1 criteria (Option A from the architecture analysis: lower threshold + `>=`).
- **Integration with existing features**: `shouldNudge` is consumed by `filter.ts` (the `context` event handler) at the gate `shouldNudge(recentMetrics, config) && !suppressCheck(...)` (P1.M1.T1's BUG-001 fix). The comparison change is INTERNAL — signature `(recentMetrics, config): boolean` is UNCHANGED. `DEFAULT_CONFIG` flows through `getConfig()`/`setConfig()`/`validateConfig()` (config.ts S2) to every consumer; lowering the default changes the zero-config trip point only (users can still override via `settings.json`).
- **Problems this solves and for whom**: For the agent/maintainer — sustained ~4k-turn growth now triggers the advisory nudge as the spec demands. For maintainers — the "ILLUSTRATIVE" workaround comment is removed; the code matches the spec.
- **Scope boundary (CRITICAL)**: This task touches the `shouldNudge` comparison + `DEFAULT_CONFIG.nudges.driftThresholdTokens` + their JSDocs ONLY. `grewOverThreshold` (nudges.ts:226, a separate single-turn `>` precompute persisted for audit/back-compat, deliberately unused by `shouldNudge`) is NOT changed. No algorithm swap (NOT Option B M-of-N); no new config knob; `driftWindowTurns` default (3) unchanged; `suppressCheck`/`injectNudge`/`shouldHighWater` untouched.

## What

User-visible behavior: a session with three consecutive ~4000-token-growth turns now receives the one-line drift nudge on the third turn (previously did not until the windowed average cleared 6000). Single heavy spikes (one 8k turn amid small turns) still do NOT fire (criterion (a) preserved). No-config sessions get the lowered default automatically; existing `settings.json` overrides keep their explicit value. No API, signature, persistence, or marker changes.

### Success Criteria

- [ ] `DEFAULT_CONFIG.nudges.driftThresholdTokens === 4000` (was 6000).
- [ ] `validateConfig({}).nudges.driftThresholdTokens === 4000` (absent → new default, silently).
- [ ] `shouldNudge` returns `avg >= config.nudges.driftThresholdTokens` (was `>`).
- [ ] `shouldNudge([4k,4k,4k], cfg(3,4000)) === true` (criterion (b)); `shouldNudge([8k,0.5k,0.5k], cfg(3,4000)) === false` (criterion (a)); `shouldNudge([0,0,0], cfg(3,4000)) === false` (criterion (c)).
- [ ] All 4 `driftThresholdTokens`-default-reads in `test/config.test.ts` updated 6000 → 4000.
- [ ] New criterion-(b) + boundary tests added to `test/drift_nudge.test.ts`; existing tests there UNCHANGED & green.
- [ ] `grewOverThreshold` (nudges.ts:226) UNCHANGED.
- [ ] `npm test` + `npm run typecheck` pass.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP carries the verbatim current text of every line to edit (the config default value + its interface JSDoc; the `shouldNudge` return line + `@returns` + the full `SPEC-AMBIGUITY RESOLUTION` comment), the exact 4 default-read test assertions in `config.test.ts` (with line numbers), the traced proof that every existing `drift_nudge.test.ts` test stays green under `>=`, the new test cases with traced expected values reusing the file's `m()`/`cfg()` helpers, and the hard constraint (GOTCHA) to leave `grewOverThreshold` alone.

### Documentation & References

```yaml
# MUST READ — the source file carrying DEFAULT_CONFIG + the field's JSDoc + validateConfig (the S2 layer that
# propagates the default). The DEFAULT value is at line 156; the interface JSDoc to rewrite is directly above
# the `driftThresholdTokens: number;` field declaration.
- file: src/config.ts
  why: "THE config file. DEFAULT_CONFIG.nudges.driftThresholdTokens = 6000 at line 156 → change to 4000. The
    interface JSDoc (2 lines above the `driftThresholdTokens: number;` field) currently reads 'Default: 6000
    (raised from 3000; spec/09 §3: the §5.1 windowing makes 6000 a quiet, accurate trip point).' → rewrite with
    new default 4000 + the §5.1 (a)/(b)/(c) rationale (Task 2). validateConfig (S2) + getConfig/setConfig are
    UNCHANGED — they propagate the default mechanically (no threshold-specific logic beyond coerceNumber >0)."
  pattern: "DEFAULT_CONFIG is a CONST object literal; getConfig() returns a fresh structuredClone; validateConfig
    deep-clones DEFAULT_CONFIG then deep-merges user overrides. Lowering the literal value is the ONLY change."
  gotcha: "Do NOT touch validateConfig's driftThresholdTokens coercer (`coerceNumber('nudges.driftThresholdTokens',
    v, cfg.nudges.driftThresholdTokens, true)` — mustBePositive=true). It correctly preserves any valid >0 user
    override. The default is read from the cloned DEFAULT_CONFIG, so changing the literal propagates everywhere."

# MUST READ — the source file carrying shouldNudge + the comparison + the SPEC-AMBIGUITY RESOLUTION comment.
- file: src/nudges.ts
  why: "THE nudges file. shouldNudge return at line 320: `return avg > config.nudges.driftThresholdTokens;` → change
    `>` to `>=`. @returns JSDoc at line 310: '...moving-average delta > driftThresholdTokens...' → `>=`. The
    SPEC-AMBIGUITY RESOLUTION comment block (lines ~289–298) contains the 'ILLUSTRATIVE' recharacterization to
    REMOVE and replace with 'criterion (b) now satisfied' (Task 4)."
  pattern: "shouldNudge is PURE: slices recentMetrics[0..driftWindowTurns), maps deltaTokens, filters finite, empty→
    bloat fallback, else `avg >= threshold`. Signature (recentMetrics: TurnMetric[], config: MulliganConfig): boolean
    UNCHANGED. Call site filter.ts (BUG-001 fix) consumes it unchanged."
  critical: "grewOverThreshold (line 226: `delta != null && delta > config.nudges.driftThresholdTokens`) is a
    SEPARATE single-turn precompute persisted by turnEndMetricHandler for AUDIT/BACK-COMPAT — explicitly 'NOT
    consulted' by shouldNudge (JSDoc line ~302). DO NOT change its `>`; it is out of scope and semantically distinct."

# MUST READ — the test file that reads the default DIRECTLY (4 places). The audit the item contract calls for.
- file: test/config.test.ts
  why: "4 assertions pin driftThresholdTokens' DEFAULT to 6000 and WILL FAIL when the default drops to 4000:
    (1) line 30 inside `expect(DEFAULT_CONFIG).toEqual({...})` structural equality;
    (2) line 63 `toBe(6000) // unchanged default` after partial bloatThresholdBytes override;
    (3) line 221 `toBe(6000) // absent → default, silently`;
    (4) lines 338–345 describe title + test title + `toBe(6000)` (the 'driftThresholdTokens 6000' block)."
  pattern: "These are the ONLY tests that assert the default value; update all four 6000 → 4000. They import
    DEFAULT_CONFIG + validateConfig directly from ../src/config.js."
  gotcha: "Do NOT touch the driftThresholdTokens OVERRIDE-coercion tests (validateConfig with an explicit present
    value) — those pass a literal threshold, unaffected by the default change. Only DEFAULT-read assertions change."

# MUST READ — the test file for shouldNudge. Existing tests PASS (explicit cfg threshold); ADD criterion (b).
- file: test/drift_nudge.test.ts
  why: "shouldNudge describe block at line 69. Helpers (REUSE): `m(deltaTokens, bloatHit=false, seq=1)` at line 74
    builds a minimal TurnMetric; `cfg = (windowTurns=3, threshold=6000)` at line 77 builds a partial MulliganConfig
    with an EXPLICIT threshold (so lowering the DEFAULT_CONFIG value does NOT break these). The new criterion-(b)
    test uses `cfg(3, 4000)` (the new default)."
  pattern: "All existing shouldNudge tests call cfg() → threshold 6000. Traced under NEW `>=`: every one still
    passes (see GOTCHA #4). ADD new tests: criterion (b) [4k,4k,4k]→true at threshold 4000; criterion (a) reaffirmed
    [8k,0.5k,0.5k]→false at threshold 4000; boundary (avg exactly == threshold → fire; one tick below → no fire)."
  critical: "A SECOND cfg helper at line 261–262 (suppressCheck describe) hardcodes threshold 6000 — leave it; its
    driftWindow=[7k]×3 avg 7000 `>= 6000` → true, still passes. The first cfg (line 77) default 6000 is also left
    UNCHANGED (existing tests depend on it); pass `4000` explicitly in the new tests only."

# MUST READ — the architecture root-cause + fix-option analysis (Option A = this task).
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: "§BUG-003 documents the root cause (moving-average + raised threshold 6000 can't satisfy (b)), the spec
    reference (spec/07 §5.1 (a)/(b)/(c)), BOTH fix options (A lower threshold + >=; B M-of-N hybrid), and the
    test-impact note: 'drift_nudge.test.ts uses an explicit cfg(3, 6000) helper, so lowering the DEFAULT_CONFIG
    value won't break existing tests that pass their own threshold. New tests for criterion (b) must be added.
    Audit any test reading DEFAULT_CONFIG directly.' This PRP IS Option A + that audit."
  critical: "Option A is chosen (minimal, maintainable). The `>=` boundary at exactly 4000 is acceptable: '~4k'
    is approximate and the nudge is ADVISORY (a false positive at exactly 4000 costs ~30 tokens, not a correctness issue)."

# CONTEXT — the spec acceptance criteria being satisfied.
- file: spec/07-preventive-and-nudges.md
  why: "§5.1 (line 167) states the three acceptance criteria verbatim: (a) single 8k turn amid small → NO fire;
    (b) three ~4k turns in a row → DO fire; (c) single large result with ~0 net growth → NO fire. Also states the
    firing condition 'avg(window.deltaTokens) > driftThresholdTokens' — note the spec text says `>`; the `>=` change
    is the fix that lets (b) fire at avg exactly == threshold while keeping (a)/(c) no-fire (see GOTCHA #1)."
  critical: "The spec's literal `avg > threshold` text is what produced the bug at threshold 6000. With threshold
    LOWERED to 4000, criterion (b)'s avg(4000) is exactly == 4000, so `>=` (not `>`) is required to fire. The
    contract explicitly mandates `>=`."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  config.ts   # ← MODIFY: DEFAULT_CONFIG.nudges.driftThresholdTokens (L156) 6000→4000; field interface JSDoc rewrite
  nudges.ts   # ← MODIFY: shouldNudge return (L320) `>`→`>=`; @returns (L310) `>`→`>=`; SPEC-AMBIGUITY comment rewrite
              #   UNCHANGED: grewOverThreshold (L226, separate single-turn precompute, out of scope);
              #   suppressCheck, injectNudge, shouldHighWater, turnEndMetricHandler
test/
  config.test.ts      # ← MODIFY: 4 default-read assertions 6000→4000 (L30, L63, L221, L338–345)
  drift_nudge.test.ts # ← MODIFY: ADD criterion-(b) + boundary + (a)-at-4000 tests in the shouldNudge describe (L69)
                      #   UNCHANGED: cfg helpers (L77, L261–262); all existing shouldNudge tests
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly four existing files (2 src + 2 test):
src/config.ts          # DEFAULT_CONFIG value 6000→4000; driftThresholdTokens interface JSDoc (Mode A rationale)
src/nudges.ts          # shouldNudge return `>`→`>=`; @returns `>`→`>=`; SPEC-AMBIGUITY RESOLUTION comment rewrite
test/config.test.ts    # 4 default-value assertions 6000→4000 (audit result)
test/drift_nudge.test.ts # ADD 3 new shouldNudge tests (criterion b + boundary + criterion a at threshold 4000)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the comparison change is `>=`, NOT `>` — criterion (b)'s avg is EXACTLY == threshold).
//   At default 4000: avg([4000,4000,4000]) = 4000. 4000 > 4000 is FALSE (would NOT fire — the bug persists);
//   4000 >= 4000 is TRUE (fires — criterion (b) satisfied). The contract is explicit: change `>` to `>=`.
//   This does NOT break criterion (a): avg([8000,500,500])=3000 >= 4000 is FALSE → still no fire. Nor (c):
//   avg(~0) >= 4000 is FALSE → still no fire. The boundary is the ENTIRE point of the fix.

// CRITICAL GOTCHA #2 (do NOT touch grewOverThreshold — src/nudges.ts:226 — it is OUT OF SCOPE).
//   `grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens` is a SEPARATE single-turn
//   raw-delta precompute persisted by turnEndMetricHandler for AUDIT/BACK-COMPAT. The shouldNudge JSDoc states it
//   is "NOT consulted here — the windowed average replaces the single-turn comparison ... deliberately unused by
//   this gate." The item contract scopes the comparison change to shouldNudge's `avg` ONLY. Its `>` is semantically
//   distinct (single-turn raw delta, not a windowed average) and is exercised by test/turn_metric.test.ts:331 with
//   an EXPLICIT threshold (3000) that keeps passing. Changing it is scope creep and risks that test.

// CRITICAL GOTCHA #3 (config.test.ts has 4 DEFAULT-read assertions that WILL FAIL — update all to 4000).
//   Line 30: structural `expect(DEFAULT_CONFIG).toEqual({... driftThresholdTokens: 6000})`.
//   Line 63: `toBe(6000)` after partial bloatThresholdBytes override.
//   Line 221: `toBe(6000)` for absent field.
//   Lines 338–345: describe title + test title + `toBe(6000)` (the 'driftThresholdTokens 6000' block).
//   These are the audit result the contract anticipated. Change ALL to 4000 (including the two prose titles).
//   Do NOT touch override-coercion tests (they pass an explicit threshold value).

// CRITICAL GOTCHA #4 (every EXISTING shouldNudge test in drift_nudge.test.ts stays GREEN — proven by trace).
//   The cfg helper (line 77) passes an EXPLICIT threshold (default 6000). Under the NEW `>=`:
//     L82  [8k,0.5k,0.5k] avg3000  >=6000? No  → false ✓  L86  [7k,7k,7k] avg7000 >=6000? Yes → true ✓
//     L91  bloat-only no-delta fallback → true ✓            L97  [500] avg500       >=6000? No  → false ✓
//     L101 empty → false ✓                                  L105 null-delta no-bloat → false ✓
//     L110 cfg(2) avg([7k,7k])=7000 >=6000? Yes → true ✓    L111 cfg(1) avg([7k])=7000  >=6000? Yes → true ✓
//     L117 bad delta dropped → bloat fallback no-bloat → false ✓
//   Second cfg (L261–262, suppressCheck describe) explicit 6000: driftWindow=[7k]×3 avg7000 >=6000 → true ✓.
//   CONCLUSION: leave every existing test + both cfg helpers UNCHANGED. Only ADD new tests.

// CRITICAL GOTCHA #5 (the cfg helper default stays 6000 — do NOT "helpfully" change it to 4000).
//   cfg (line 77) = `(windowTurns=3, threshold=6000)`. The existing tests rely on threshold 6000 to demonstrate
//   the windowing math. Changing the helper's default would silently re-baseline those tests and obscure what
//   they assert. The NEW criterion-(b) test passes `4000` EXPLICITLY via `cfg(3, 4000)` (the new default), which
//   is self-documenting and independent of the helper's default. Leave the helper's default at 6000.

// CRITICAL GOTCHA #6 (README.md + integration docs reference "6000"/"3000" — do NOT modify here).
//   README.md:98,116 and test/integration/scenarios.md:181,196 + smoke.ts:221 mention the drift default in prose.
//   Documentation sync is a SEPARATE task (P1.M3.T1.S2 owns README; scenarios/smoke are doc-sync territory). This
//   PRP touches ONLY src + the two unit-test files. Modifying docs here crosses task boundaries.

// CRITICAL GOTCHA #7 (the no-delta bloat fallback path is UNCHANGED — only the delta-available arm's operator).
//   shouldNudge has TWO arms: (1) deltas.length===0 → `return window.some(m => m.bloatHit === true)` (the no-delta
//   fallback — UNCHANGED); (2) else `return avg >= threshold` (the ONLY line that changes). Do not touch arm (1),
//   the `.filter(typeof === "number" && Number.isFinite(d))` guard, or the `=== true` bloat safety.
```

---

## Implementation Blueprint

### Data models and structure

**No data-model changes.** `MulliganConfig`, `TurnMetric`, and `shouldNudge`'s signature `(recentMetrics: TurnMetric[], config: MulliganConfig): boolean` are all UNCHANGED. The fix is a single config literal value + a single comparison operator + three JSDoc/comment rewrites + test updates.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/config.ts:156 — DEFAULT_CONFIG.nudges.driftThresholdTokens 6000 → 4000
  - LOCATE (verbatim):
      driftThresholdTokens: 6000,
    (inside DEFAULT_CONFIG.nudges, ~line 156)
  - REPLACE WITH:
      driftThresholdTokens: 4000,
  - PRESERVE: the surrounding DEFAULT_CONFIG object literal, all other nudges.* keys, the trailing comma.
  - GOTCHA: this is the ONLY production-code value change in config.ts. validateConfig/getConfig/setConfig are
    UNCHANGED (they propagate the default mechanically via structuredClone + deep-merge). (GOTCHA #3 audit root.)
  - DEPENDENCIES: none.

Task 2: MODIFY src/config.ts — rewrite the driftThresholdTokens INTERFACE JSDoc (Mode A docs)
  - LOCATE (verbatim, the 2-line JSDoc directly above the `driftThresholdTokens: number;` field declaration in the
    MulliganConfig interface):
      /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
       *  Default: 6000 (raised from 3000; spec/09 §3: the §5.1 windowing makes 6000
       *  a quiet, accurate trip point). */
      driftThresholdTokens: number;
  - REPLACE WITH (new default 4000 + the §5.1 (a)/(b)/(c) rationale from the contract):
      /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
       *  Default 4000. The moving-average over driftWindowTurns (default 3) compared with `>=` satisfies all three
       *  spec/07 §5.1 acceptance criteria: (a) a single 8k turn amid small turns averages <4000 → no fire;
       *  (b) three ~4k turns average ~4000 >= 4000 → fire; (c) a single large result with ~0 net growth averages
       *  ~0 → no fire. (Lowered from 6000 + `>=` — BUG-003: at 6000 with `>`, criterion (b) never fired.) */
      driftThresholdTokens: number;
  - GOTCHA: JSDoc only — do NOT change the field type (`number`) or any other interface field. Keep "Must be > 0".
  - DEPENDENCIES: Task 1 (so the doc matches the value).

Task 3: MODIFY src/nudges.ts:320 + :310 — shouldNudge comparison `>` → `>=` (+ @returns)
  - LOCATE the return (verbatim, line 320):
      return avg > config.nudges.driftThresholdTokens;
  - REPLACE WITH:
      return avg >= config.nudges.driftThresholdTokens;
  - LOCATE the @returns JSDoc (verbatim, line 310):
      * @returns true iff the windowed moving-average delta > driftThresholdTokens (delta-only when delta data exists);
  - REPLACE WITH:
      * @returns true iff the windowed moving-average delta >= driftThresholdTokens (delta-only when delta data exists);
  - PRESERVE: the shouldNudge signature, the `deltas` filter (`typeof === "number" && Number.isFinite(d)`), the
    no-delta bloat fallback arm (`if (deltas.length === 0) return window.some((m) => m.bloatHit === true);`), the
    `avg` computation. ONLY the comparison operator + the @returns word change.
  - GOTCHA #1 (the `>=` is the whole fix — criterion (b)'s avg is exactly == threshold). GOTCHA #2 (do NOT touch
    grewOverThreshold at line 226). GOTCHA #7 (leave the bloat fallback arm untouched).
  - DEPENDENCIES: Task 1 (lowered default) — together they satisfy (a)/(b)/(c).

Task 4: MODIFY src/nudges.ts — rewrite the SPEC-AMBIGUITY RESOLUTION comment (lines ~289–298)
  - LOCATE (verbatim — the comment block starting "SPEC-AMBIGUITY RESOLUTION"):
      * SPEC-AMBIGUITY RESOLUTION (architecture implementation_patterns.md Pattern 8): spec/07 §5.1 gives two acceptance
      * criteria — (1) a single 8k-token turn amid small turns does NOT fire; (2) three ~4k turns in a row DO — and
      * offers "moving-average, OR M-of-N" with threshold 6000, window 3. Neither pure algorithm satisfies BOTH literally
      * at threshold 6000: moving-average [8k,0.5k,0.5k]=3k<6k→no fire ✓ but [4k,4k,4k]=4k<6k→no fire ✗; sum
      * [8k,0.5k,0.5k]=9k>6k→fire ✗ but [4k,4k,4k]=12k>6k→fire ✓. The PRIMARY intent of §5.1 (and the reason it exists)
      * is to SUPPRESS SINGLE SPIKES — a single heavy turn is routinely legitimate (reading files, pasting docs). Moving
      * average is the algorithm that satisfies that primary intent (criterion 1). Criterion 2 ("three ~4k turns fire")
      * is ILLUSTRATIVE of "sustained growth fires"; with the §5.1-windowing-justified raised threshold of 6000
      * (config.ts: "the §5.1 windowing makes 6000 a quiet, accurate trip point"), three 4k turns averaging 4k correctly
      * do NOT fire — sustained growth whose windowed AVERAGE exceeds 6000 (e.g. three ~7k turns) DOES. Chosen algorithm:
      * MOVING AVERAGE vs threshold, DELTA-ONLY (bloat demoted to the no-delta fallback per P4.M2.T1.S1 / spec/07 §5.1).
      * (Matches the item contract + Pattern 8 FINAL ANSWER, updated for the bloat demotion.)
  - REPLACE WITH (note criterion (b) is now satisfied; REMOVE the "ILLUSTRATIVE" recharacterization):
      * SPEC-AMBIGUITY RESOLUTION (spec/07 §5.1, BUG-003 fix): spec/07 §5.1 gives three acceptance criteria —
      * (a) a single 8k-token turn amid small turns does NOT fire; (b) three ~4k turns in a row DO fire; (c) a single
      * large result with ~0 net growth does NOT fire. With the DEFAULT threshold LOWERED to 4000 (config.ts) and the
      * comparison changed from `>` to `>=`, the moving-average algorithm satisfies ALL THREE literally:
      *   (a) avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire ✓
      *   (b) avg([4k,4k,4k])=4k   >= 4k? Yes → fire ✓   (was 4k > 6k → no fire — the BUG-003 violation)
      *   (c) avg(~0)              >= 4k? No → no fire ✓
      * Chosen algorithm: MOVING AVERAGE vs threshold, DELTA-ONLY (bloat demoted to the no-delta fallback per
      * P4.M2.T1.S1 / spec/07 §5.1). The earlier "ILLUSTRATIVE" recharacterization of criterion (b) is RETIRED —
      * (b) is now a firm, satisfied acceptance criterion at the lowered default.
  - GOTCHA: comment-only — do NOT change shouldNudge's code (Task 3 did that) or signature. Keep the surrounding
    comment paragraphs (the "WHY bloatHit is demoted" + "fails safe" + "grewOverThreshold NOT consulted" blocks).
  - DEPENDENCIES: Task 3 (the code change the comment now describes).

Task 5: MODIFY test/config.test.ts — update the 4 DEFAULT-read assertions 6000 → 4000
  - (1) Line ~30 — inside `expect(DEFAULT_CONFIG).toEqual({...})`:
        driftThresholdTokens: 6000,
      → driftThresholdTokens: 4000,
  - (2) Line ~63 — `expect(cfg.nudges.driftThresholdTokens).toBe(6000); // unchanged default`
      → expect(cfg.nudges.driftThresholdTokens).toBe(4000); // unchanged default (BUG-003: lowered from 6000)
  - (3) Line ~221 — `expect(cfg.nudges.driftThresholdTokens).toBe(6000); // absent → default, silently`
      → expect(cfg.nudges.driftThresholdTokens).toBe(4000); // absent → default, silently
  - (4) Lines ~338–345 — the describe + test titles + assertion:
        describe("nudges.driftWindowTurns & nudges.highWaterFraction + driftThresholdTokens 6000 (P3.M3.T1.S1 / spec/09 §2-§4)", () => {
          it("(a) defaults: driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 6000 — NO warn", () => {
            ...
            expect(cfg.nudges.driftThresholdTokens).toBe(6000);
      → describe("...driftThresholdTokens 4000 (P3.M3.T1.S1 / spec/09 §2-§4, BUG-003)", () => {
           it("(a) defaults: driftWindowTurns 3, highWaterFraction 0.7, driftThresholdTokens 4000 — NO warn", () => {
             ...
             expect(cfg.nudges.driftThresholdTokens).toBe(4000);
  - GOTCHA #3 (these are the audit's findings — ALL four change; do NOT touch override-coercion tests). Preserve the
    rest of each test body (the warn-spy setup, the other assertions on driftWindowTurns/highWaterFraction).
  - DEPENDENCIES: Task 1 (the default must be 4000 for these assertions to hold).

Task 6: MODIFY test/drift_nudge.test.ts — ADD new shouldNudge tests (criterion b + boundary + criterion a at 4000)
  - ADD these `it(...)` cases INSIDE the existing `describe("shouldNudge — windowed drift gate (spec/07 §5.1)", ...)`
    block (starts line 69), AFTER the last existing test (the "defensive: malformed deltaTokens" case, ~line 114),
    BEFORE the closing `});` of the describe. Reuse the file's `m()` helper (line 74) and `cfg()` helper (line 77).

    (new b) CRITERION (b) — three ~4k turns FIRE at the lowered default threshold 4000 (THE headline proof):
        it("FIRES on three ~4k turns in a row at the lowered default threshold 4000 (BUG-003 / spec/07 §5.1 criterion b)", () => {
          // Lowered default 4000 + `>=`: avg([4k,4k,4k]) = 4000 >= 4000 → fire.
          // (Before the fix: avg 4000 > 6000 → false → criterion (b) violated.)
          expect(shouldNudge([m(4000, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(true);
        });

    (new c) BOUNDARY — windowed average EXACTLY equal to threshold fires (`>=`, not `>`); one tick below does NOT:
        it("boundary: windowed average EXACTLY equal to threshold fires (`>=`); one tick below does NOT", () => {
          // avg([4k,4k,4k]) === driftThresholdTokens (4000) → fire (the >= edge that satisfies criterion b).
          expect(shouldNudge([m(4000, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(true);
          // avg([3999,4k,4k]) = 3999.67 < 4000 → no fire.
          expect(shouldNudge([m(3999, false, 3), m(4000, false, 2), m(4000, false, 1)], cfg(3, 4000))).toBe(false);
        });

    (new a) CRITERION (a) reaffirmed at threshold 4000 — a single 8k spike amid small turns still does NOT fire:
        it("does NOT fire on a single heavy turn amid small turns at threshold 4000 (criterion a holds at new default)", () => {
          // avg([8k,0.5k,0.5k]) = 3000 >= 4000? No → no fire (criterion a preserved at the lowered default).
          expect(shouldNudge([m(8000, false, 3), m(500, false, 2), m(500, false, 1)], cfg(3, 4000))).toBe(false);
        });
  - NAMING: titles name the criterion / boundary + BUG-003 where relevant. Pass `4000` EXPLICITLY via cfg(3, 4000).
  - GOTCHA #4 (existing tests UNCHANGED — proven green under >=). GOTCHA #5 (do NOT change the cfg helper default).
    m() takes (deltaTokens, bloatHit=false, seq=1); pass seq 3/2/1 to mirror newest-first ordering (cosmetic).
  - DEPENDENCIES: Task 3 (the `>=` change must be in place for the criterion-(b) test to pass; before Task 3 it returns
    false → red, proving the fix — optional TDD red→green confirmation in Level 4).

Task 7: VALIDATE (no new code)
  - RUN `npm run typecheck` (tsc --noEmit) → no new errors (literal number + operator change; no type impact).
  - RUN `npm test` (vitest run) → full suite passes:
      * test/config.test.ts: the 4 updated default-read assertions pass (4000); override-coercion tests unaffected.
      * test/drift_nudge.test.ts: all existing shouldNudge tests green (explicit cfg threshold); 3 new tests green.
      * test/turn_metric.test.ts:331 (explicit 3000, grewOverThreshold) UNAFFECTED & green.
  - DEPENDENCIES: Tasks 1–6.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 3): the ONE production logic line — operator swap `>` → `>=`.
//   BEFORE:  return avg > config.nudges.driftThresholdTokens;   // avg([4k,4k,4k])=4000 > 6000 → false (BUG-003)
//   AFTER:   return avg >= config.nudges.driftThresholdTokens;  // avg([4k,4k,4k])=4000 >= 4000 → true (FIXED)
//   The two arms of shouldNudge are otherwise IDENTICAL:
//     (1) no-delta fallback: `if (deltas.length === 0) return window.some((m) => m.bloatHit === true);` — UNCHANGED
//     (2) delta-available:   `return avg >= config.nudges.driftThresholdTokens;`                       — ONLY this line

// VERIFICATION (all three §5.1 criteria at DEFAULT 4000 + `>=`):
//   (a) shouldNudge([m(8000,3), m(500,2), m(500,1)], cfg(3,4000))
//         deltas=[8000,500,500]; avg=3000; 3000 >= 4000? No → false ✓ (single spike suppressed)
//   (b) shouldNudge([m(4000,3), m(4000,2), m(4000,1)], cfg(3,4000))
//         deltas=[4000,4000,4000]; avg=4000; 4000 >= 4000? Yes → true ✓ (sustained ~4k growth fires)
//   (c) shouldNudge([m(0,3), m(0,2), m(0,1)], cfg(3,4000))
//         deltas=[0,0,0]; avg=0; 0 >= 4000? No → false ✓ (~0 net growth does not fire)

// CRITICAL: grewOverThreshold (src/nudges.ts:226) is a DIFFERENT comparison — do NOT touch it (GOTCHA #2).
//   `grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens`
//   It is a per-turn RAW-delta precompute (single turn, not windowed) persisted for audit/back-compat; shouldNudge
//   does NOT consult it (JSDoc line ~302). Its `>` stays. test/turn_metric.test.ts:331 exercises it with explicit 3000.
```

### Integration Points

```yaml
CODE:
  - modify: src/config.ts — DEFAULT_CONFIG.nudges.driftThresholdTokens (L156) 6000→4000; field interface JSDoc rewrite (Task 2)
  - modify: src/nudges.ts — shouldNudge return (L320) `>`→`>=`; @returns (L310) `>`→`>=`; SPEC-AMBIGUITY comment rewrite (Task 4)
  - untouched: grewOverThreshold (L226), turnEndMetricHandler, suppressCheck, injectNudge, shouldHighWater,
    renderHighWaterNudge, injectHighWaterNudge, renderDriftNudge; filter.ts call site (BUG-001 fix); all transforms/markers
TESTS:
  - modify: test/config.test.ts — 4 default-read assertions 6000→4000 (L30, L63, L221, L338–345)
  - modify: test/drift_nudge.test.ts — ADD 3 shouldNudge tests (criterion b + boundary + criterion a at 4000) in the L69 describe
  - untouched: test/turn_metric.test.ts (explicit 3000, grewOverThreshold); all other test files; override-coercion tests
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No new config keys, no migration, no registration. The default value flows through the existing getConfig/
    setConfig/validateConfig (config.ts S2) to all consumers; users with a settings.json override keep their explicit value.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run typecheck        # tsc --noEmit
# EXPECTED: no new errors. The change is a literal number (6000→4000) + a comparison operator (`>`→`>=`) +
# JSDoc/comment text. No type impact. Common mistakes to check the diff for:
#   - accidentally editing grewOverThreshold (L226) instead of / in addition to shouldNudge (GOTCHA #2);
#   - changing the cfg helper default (L77) 6000→4000 (GOTCHA #5 — leave it);
#   - a typo in the config.ts structural literal that breaks the DEFAULT_CONFIG object.
# Re-read the diff: src/config.ts (L156 value + interface JSDoc) + src/nudges.ts (L320 + L310 + the comment block)
# should be the ONLY production diffs.
```

### Level 2: Unit Tests (Component Validation)

```bash
# config.test.ts — the 4 default-read assertions must pass at 4000.
npx vitest run test/config.test.ts
# EXPECTED: all pass. If the "matches the spec/09 §2 defaults exactly" structural test (L14) FAILS with
# received 4000 expected 6000 → you missed updating L30 (Task 5 spot 1). If the L338 describe block fails →
# missed updating L345/the titles (Task 5 spot 4). Override-coercion tests must be UNAFFECTED.

# drift_nudge.test.ts — existing tests green + 3 new tests green.
npx vitest run test/drift_nudge.test.ts
# EXPECTED: all pass. If a NEW test fails:
#   - criterion (b) returns false → Task 3's `>=` not applied (still `>`) OR cfg threshold not 4000.
#   - boundary "exactly equal" returns false → same (`>` instead of `>=`).
# Existing tests must be UNCHANGED & green (GOTCHA #4 trace). If an EXISTING test flips, you accidentally changed
# the cfg helper default (GOTCHA #5) — revert it.

# Full suite — confirm no collateral (turn_metric.test.ts:331 explicit-3000 grewOverThreshold test unaffected).
npm test
# EXPECTED: all pass (955+ tests). The only tests whose expectations change are the 4 config default-reads.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: shouldNudge is a PURE function exercised directly by the unit tests, and DEFAULT_CONFIG
# propagation is exercised by config.test.ts. The end-to-end "does a ~4k-turn session actually get the nudge" path
# runs through filter.ts → shouldNudge && !suppressCheck → injectNudge, covered by existing filter/integration tests
# (they pass an explicit threshold). No live runtime seam is newly exercisable here.

# Optional config end-to-end sanity (proves the shipped default propagates through getConfig):
node -e "import('./src/config.js').then(m => console.log(m.getConfig().nudges.driftThresholdTokens))"
# EXPECTED: prints 4000 (was 6000).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# TDD red→green confirmation (optional — proves the fix end-to-end):
#   1. BEFORE Task 3 (only Task 1/2 applied, or nothing): the NEW criterion-(b) test FAILS with
#      `expected true, received false` (the bug — avg 4000 vs threshold 6000/>). This is the red step.
#   2. Apply Tasks 1 + 3 (default 4000 + `>=`) → re-run → the criterion-(b) test PASSES (green).
#   The red→green transition on the criterion-(b) test is the proof all three §5.1 criteria now hold.

# Grep sanity (confirm the operator + value landed exactly where intended):
grep -n 'return avg >= config.nudges.driftThresholdTokens' src/nudges.ts   # EXPECTED: 1 hit (L320)
grep -n 'delta != null && delta > config.nudges.driftThresholdTokens' src/nudges.ts   # EXPECTED: 1 hit (L226, grewOverThreshold — UNCHANGED, proves GOTCHA #2 honored)
grep -n 'driftThresholdTokens: 4000' src/config.ts   # EXPECTED: 1 hit (DEFAULT_CONFIG, L156)
grep -n 'ILLUSTRATIVE' src/nudges.ts   # EXPECTED: 0 hits (the recharacterization is RETIRED by Task 4)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` (`tsc --noEmit`) — no new errors.
- [ ] `npm test` (`vitest run`) — full suite passes (955+ tests).
- [ ] `npx vitest run test/config.test.ts` — 4 default-read assertions pass at 4000.
- [ ] `npx vitest run test/drift_nudge.test.ts` — existing green + 3 new tests green.

### Feature Validation
- [ ] `shouldNudge([m(4000,3), m(4000,2), m(4000,1)], cfg(3,4000)) === true` (criterion (b) — was `false`).
- [ ] `shouldNudge([m(8000,3), m(500,2), m(500,1)], cfg(3,4000)) === false` (criterion (a)).
- [ ] `shouldNudge([m(0,3), m(0,2), m(0,1)], cfg(3,4000)) === false` (criterion (c)).
- [ ] Boundary: avg exactly == threshold fires (`>=`); one tick below does not.
- [ ] `DEFAULT_CONFIG.nudges.driftThresholdTokens === 4000`; `validateConfig({}).nudges.driftThresholdTokens === 4000`.

### Code Quality Validation
- [ ] `grewOverThreshold` (src/nudges.ts:226) is UNCHANGED (`>` preserved; out of scope — GOTCHA #2).
- [ ] The no-delta bloat fallback arm of `shouldNudge` is UNCHANGED (GOTCHA #7).
- [ ] The `cfg` helper default (drift_nudge.test.ts:77) stays 6000; new tests pass `4000` explicitly (GOTCHA #5).
- [ ] Only 4 files modified: src/config.ts, src/nudges.ts, test/config.test.ts, test/drift_nudge.test.ts.
- [ ] The "ILLUSTRATIVE" recharacterization is removed from the SPEC-AMBIGUITY RESOLUTION comment.

### Documentation & Deployment
- [ ] config.ts driftThresholdTokens interface JSDoc documents new default 4000 + the §5.1 (a)/(b)/(c) rationale (Mode A).
- [ ] shouldNudge @returns + SPEC-AMBIGUITY RESOLUTION comment reflect `>=` and criterion-(b)-now-satisfied (Mode A).
- [ ] No README/spec/VERIFICATION.md change in this subtask (doc sync is P1.M3.T1 — separate task).

---

## Anti-Patterns to Avoid

- ❌ Don't change `grewOverThreshold`'s `>` (src/nudges.ts:226) — it's a separate single-turn audit/back-compat precompute, deliberately unused by `shouldNudge`; the contract scopes the change to `shouldNudge`'s `avg` only (GOTCHA #2).
- ❌ Don't use `>` instead of `>=` — criterion (b)'s windowed average is EXACTLY equal to the lowered threshold (4000), so `>` would still return false. `>=` is the entire fix (GOTCHA #1).
- ❌ Don't change the `cfg` helper's default threshold (drift_nudge.test.ts:77) from 6000 to 4000 — existing tests depend on 6000 to demonstrate the windowing math; pass `4000` explicitly in the new tests (GOTCHA #5).
- ❌ Don't forget to update ALL 4 default-read assertions in config.test.ts (L30, L63, L221, L338–345) — the structural `toEqual` at L30 WILL fail if missed, and so will the three `toBe(6000)` (GOTCHA #3).
- ❌ Don't touch the override-coercion tests in config.test.ts — they pass an explicit threshold value and are unaffected by the default change.
- ❌ Don't modify README.md / VERIFICATION.md / integration scenario docs here — documentation sync is a separate task (P1.M3.T1), and crossing that boundary risks merge conflicts (GOTCHA #6).
- ❌ Don't add a new config knob or switch to the M-of-N algorithm (Option B) — the contract selects Option A (lower threshold + `>=`); stay in scope.
- ❌ Don't leave the "ILLUSTRATIVE" recharacterization in the SPEC-AMBIGUITY RESOLUTION comment — Task 4 explicitly retires it now that criterion (b) is satisfied.

---

## Decision Log

- **D1 — Option A (lower threshold 6000→4000 + `>=`) over Option B (M-of-N hybrid).** The architecture analysis (system_context §BUG-003) lists both; the item contract mandates Option A. It is the minimal, most maintainable change (one literal + one operator) and satisfies all three §5.1 criteria at the lowered default. The `>=` boundary at exactly 4000 is acceptable: "~4k" is approximate and the nudge is ADVISORY (a false positive at exactly 4000 costs ~30 tokens, not a correctness issue). Option B would add algorithmic complexity for no marginal benefit at the chosen threshold.

- **D2 — `>=` (not `>`) is required, not optional.** At default 4000, criterion (b)'s `avg([4k,4k,4k])` equals exactly 4000. `4000 > 4000` is false (the bug persists); `4000 >= 4000` is true (criterion (b) satisfied). The operator change is the load-bearing half of the fix alongside the threshold change. Criterion (a) (`avg 3000 >= 4000`? No) and (c) (`avg ~0 >= 4000`? No) are preserved because their averages are strictly below 4000.

- **D3 — `grewOverThreshold` is explicitly OUT OF SCOPE.** It is a per-turn RAW-delta precompute (`delta > threshold`) persisted by `turnEndMetricHandler` for audit/back-compat; `shouldNudge` does NOT consult it (documented in its JSDoc). Its `>` is semantically distinct from the windowed-average comparison. The item contract's INPUT/LOGIC/OUTPUT mention only `shouldNudge`'s `avg`. Changing it is scope creep and would require auditing/re-authoring `turn_metric.test.ts` — out of this task's bounds.

- **D4 — Leave the `cfg` helper default at 6000; pass `4000` explicitly in new tests.** The existing `shouldNudge` tests use `cfg()` (threshold 6000) to exercise the windowing math independent of the production default. Rebasing the helper's default to 4000 would silently re-baseline those tests and obscure what they assert. The new criterion-(b) test calls `cfg(3, 4000)` explicitly — self-documenting, independent of the helper default, and a faithful expression of "the new default threshold."

- **D5 — Update config.test.ts's 4 default-read assertions (the audit result).** The contract anticipated this: "Audit test files for any test that reads `DEFAULT_CONFIG.nudges.driftThresholdTokens` directly instead of passing an explicit value." The audit found exactly 4 such assertions (1 structural `toEqual` + 3 `toBe(6000)`, one of which sits in a describe block titled with "6000"). All four flip 6000→4000; no override-coercion test is touched.

- **D6 — Retire the "ILLUSTRATIVE" recharacterization.** The old SPEC-AMBIGUITY RESOLUTION comment justified NOT firing on three 4k turns by recharacterizing criterion (b) as "ILLUSTRATIVE." With the lowered threshold + `>=`, criterion (b) is now a firm, satisfied acceptance criterion; the workaround comment must be rewritten to state this (Task 4), per the contract's DOGS [sic] point (c). Leaving the stale "ILLUSTRATIVE" text would contradict the fix.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a surgically small, well-bounded change (1 config literal + 1 operator + 3 JSDoc/comment rewrites + 4 test-assertion updates + 3 new tests) backed by: (a) the verbatim current text of every line to edit (config default + interface JSDoc; shouldNudge return + @returns + the full SPEC-AMBIGUITY comment); (b) the exact 4 default-read test assertions in config.test.ts with line numbers; (c) the traced proof that every existing drift_nudge.test.ts test stays green under `>=` (GOTCHA #4) — so the implementer need not re-derive it; (d) the new test cases with traced expected values reusing the file's `m()`/`cfg()` helpers; (e) the hard constraint (GOTCHA #2) to leave `grewOverThreshold` (the look-alike line at L226) untouched; (f) the explicit out-of-scope boundary on README/doc-sync (GOTCHA #6). Residual risks: (1) forgetting to update one of the 4 config.test.ts assertions (mitigated by Task 5 enumerating all four with line numbers + GOTCHA #3); (2) accidentally editing `grewOverThreshold` instead of `shouldNudge` (mitigated by GOTCHA #2 + the Level 4 grep sanity check that asserts L226 is unchanged); (3) leaving the "ILLUSTRATIVE" text (mitigated by Task 4 + the Level 4 `grep -n ILLUSTRATIVE` returning 0 hits).