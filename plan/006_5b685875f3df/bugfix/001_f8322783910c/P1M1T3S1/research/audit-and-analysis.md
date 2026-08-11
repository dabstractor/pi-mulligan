# Research Notes — P1.M1.T3.S1 (BUG-003: drift threshold + `>=`)

## Verbatim current state (exact text to match for edits)

### src/config.ts — DEFAULT_CONFIG.nudges.driftThresholdTokens
- **Value (line 156):** `driftThresholdTokens: 6000,`
- **Interface JSDoc (above the field):**
  ```
  /** Turn token-delta above which the per-turn drift nudge fires. Must be > 0.
   *  Default: 6000 (raised from 3000; spec/09 §3: the §5.1 windowing makes 6000
   *  a quiet, accurate trip point). */
  driftThresholdTokens: number;
  ```

### src/nudges.ts — shouldNudge
- **Return (line 320):** `return avg > config.nudges.driftThresholdTokens;`
- **@returns JSDoc (line 310):** ` * @returns true iff the windowed moving-average delta > driftThresholdTokens (delta-only when delta data exists);`
- **SPEC-AMBIGUITY RESOLUTION comment (lines ~289–298)** — contains the "ILLUSTRATIVE" recharacterization to remove. Full text captured in PRP §Implementation Tasks Task 4.

### OUT OF SCOPE — grewOverThreshold (src/nudges.ts:226)
`grewOverThreshold: delta != null && delta > config.nudges.driftThresholdTokens,`
- This is a per-turn PRECOMPUTATION persisted by `turnEndMetricHandler` for **audit/back-compat only**.
- The shouldNudge JSDoc (line ~302) states it explicitly: "grewOverThreshold ... is NOT consulted here — the windowed average replaces the single-turn comparison ... deliberately unused by this gate."
- The item contract scopes the comparison change to **shouldNudge's `avg` only**. grewOverThreshold is NOT in INPUT/LOGIC/OUTPUT. → MUST NOT change (changing it is scope creep; its `>` is a single-turn raw comparison, semantically distinct from the windowed average).

## Test audit — what breaks when DEFAULT goes 6000 → 4000

### test/config.test.ts — 4 places read the default DIRECTLY (MUST update 6000 → 4000)
1. **Line 30** — structural `expect(DEFAULT_CONFIG).toEqual({... driftThresholdTokens: 6000 ...})` — **WILL FAIL** (structural equality).
2. **Line 63** — `expect(cfg.nudges.driftThresholdTokens).toBe(6000); // unchanged default` (after partial `bloatThresholdBytes:100` override) — **WILL FAIL**.
3. **Line 221** — `expect(cfg.nudges.driftThresholdTokens).toBe(6000); // absent → default, silently` — **WILL FAIL**.
4. **Lines 338–345** — describe title `"...driftThresholdTokens 6000..."`, test title `"(a) defaults: ...driftThresholdTokens 6000 — NO warn"`, assertion `toBe(6000)` — **WILL FAIL** (3 spots).

### test/drift_nudge.test.ts — existing tests PASS (explicit cfg threshold); ADD new (b) test
- `cfg` helper (line 77): `cfg = (windowTurns = 3, threshold = 6000)` — passes **explicit** threshold. Lowering DEFAULT_CONFIG does NOT touch this.
- Traced every existing shouldNudge test under NEW `>=` at explicit threshold 6000 — ALL still pass:
  - L82 `[8k,0.5k,0.5k]` avg3000 `>= 6000`? No → false ✓
  - L86 `[7k,7k,7k]` avg7000 `>= 6000`? Yes → true ✓
  - L91 bloat-only no-delta fallback → true ✓
  - L97 `[500]` avg500 `>= 6000`? No → false ✓
  - L101 empty → false ✓
  - L105 null-delta no-bloat → false ✓
  - L110 `cfg(2)` avg([7k,7k])=7000 `>= 6000`? Yes → true ✓
  - L111 `cfg(1)` avg([7k])=7000 `>= 6000`? Yes → true ✓
  - L117 bad delta dropped → bloat fallback no-bloat → false ✓
- Second `cfg` (L261–262, suppressCheck describe) explicit 6000: driftWindow=[7k]×3 avg7000 `>= 6000` → true ✓
- **NO existing drift_nudge.test.ts test breaks.** ADD new tests for criterion (b) + boundary.

### test/turn_metric.test.ts:331 — NOT broken (explicit threshold, untouched code)
- `setConfig({ nudges: { driftThresholdTokens: 3000 } })` — explicit 3000, exercises `grewOverThreshold` (the OUT-OF-SCOPE field, NOT shouldNudge). `4000 > 3000` → true (unchanged). Passes.

## Out-of-scope doc refs (NOT modified — handled by P1.M3.T1 doc-sync tasks)
- README.md:98, 116 — "6000" + raised-from-3k prose → P1.M3.T1.S2 territory.
- test/integration/scenarios.md:181,196 — prose mentioning "default driftThresholdTokens" → doc-sync.
- test/integration/smoke.ts:221 — stale comment "(default 3000)" (already stale pre-fix). Not executed by vitest; doc-sync.

## Build/test commands (verified from package.json)
- `npm test` → `vitest run`
- `npm run typecheck` → `tsc --noEmit`
- No ruff/mypy (TS project). vitest only.

## Verification math (from contract — all three §5.1 criteria at default 4000 + `>=`)
- (a) avg([8000,500,500]) = 3000 `>= 4000`? **No** → no fire ✓
- (b) avg([4000,4000,4000]) = 4000 `>= 4000`? **Yes** → fire ✓
- (c) avg(~0) `>= 4000`? **No** → no fire ✓