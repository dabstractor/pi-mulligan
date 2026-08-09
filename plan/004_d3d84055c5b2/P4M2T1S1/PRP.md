# PRP — P4.M2.T1.S1: Remove the `|| bloatHit` arm from shouldNudge's delta-available return

**Parent**: P4.M2.T1 (Demote bloatHit). This is the **SOURCE** item: a one-line logic change + a JSDoc rewrite in
`src/nudges.ts`. It adds zero tests, zero new files. The companion **P4.M2.T1.S2** flips the 1–2 stale
bloat-armed test assertions this change makes false — **that is explicitly NOT this item's scope.**

**Spec refs**: `spec/07-preventive-and-nudges.md` §2 (Edge cases) + §5.1 (Windowed drift signaling, REQUIRED),
committed `0bcaa814`. Architecture: `plan/004_d3d84055c5b2/architecture/codebase_patterns.md` §4.

---

## Goal

**Feature Goal**: Make `shouldNudge` (`src/nudges.ts`) return **delta-only** when delta data exists — a window
whose deltas average `≤ driftThresholdTokens` no longer fires just because some metric had a bloated tool result.
The no-delta fallback (first turn / post-reload) still fires on `bloatHit`, unchanged.

**Deliverable**: Two edits inside `src/nudges.ts` only — (1) line 323: drop the `|| window.some((m) =>
m.bloatHit === true)` arm from the delta-available `return`; (2) rewrite the `shouldNudge` JSDoc (lines 271–315)
so the inline doc states the new delta-only-when-delta-exists semantics (it currently asserts bloat fires
*regardless*, which is now false). **No other file is touched.**

**Success Definition**:
- `npx tsc --noEmit` is green (the change is type-neutral — removing a `||` arm).
- `shouldNudge`'s no-delta fallback branch (`if (deltas.length === 0) return window.some((m) => m.bloatHit ===
  true);`, line 321) is byte-for-byte unchanged.
- The delta-available path now returns `avg > config.nudges.driftThresholdTokens;` with NO `||` bloat arm.
- Every `shouldNudge` test in `test/drift_nudge.test.ts` stays green **except the one** documented below
  (`shouldNudge([m(500, true, 1)], cfg())` flips `true`→`false`), which is the contract for **P4.M2.T1.S2**.
- The full suite passes once S2 lands; S1 intentionally leaves that one assertion red (it is the spec-correct
  new behavior — bloat no longer arms the delta path).

## User Persona

**Target User**: Maintainer / future implementer of Mulligan's drift nudge. [Mode A] — no user-facing docs; the
JSDoc on `shouldNudge` is the inline doc that rides with this work.

**Use Case**: A single large tool result amid a low/zero net-growth window must no longer trigger the per-turn
drift nudge (Nudge B), because that result is already co-located with Nudge A's bloat reminder and re-announcing it
one turn later was an observed **stuck-turn-loop amplifier** (the `~0k tokens / N bloated results`
self-contradiction).

---

## Why

- The `|| bloatHit` arm fired the drift nudge on ANY single large tool result — **redundant with Nudge A**, which
  is already co-located on that same result (the `tool_result` reminder). Re-announcing it one turn later adds
  nothing and, observed live, drove a stuck-turn loop.
- It produced a **self-contradictory nudge**: a near-zero-net-growth turn with one big result fired the drift nudge
  rendered as "~0k tokens / N bloated results". With bloat demoted, a ~0-net-growth turn does NOT fire regardless
  of how big a result it held.
- `bloatHit` is **retained only as a no-delta fallback** (first turn / post-reload), so a bloated result still
  nudges before any baseline exists. This is the spec (`spec/07 §5.1` + `§2 Edge cases`) and the architecture
  (`codebase_patterns.md §4`) contract.
- This is the root of the M2 tree (independent of M1 — no config/tool/runtime dependency) and is consumed
  unchanged by the existing `filter.ts` caller and by P4.M2.T1.S2 (test flips).

## What

- **User-visible behavior**: a per-turn drift nudge that previously fired on a single bloated result no longer does
  (when delta data exists). It still fires on genuine *sustained* windowed growth, and still fires on bloat when no
  delta exists yet.
- **Technical requirement**: edit `src/nudges.ts` `shouldNudge` only — see Blueprint for the exact diff and the
  exact JSDoc replacement text.

### Success Criteria

- [ ] Line 323 reads exactly `return avg > config.nudges.driftThresholdTokens;` (no trailing `|| …`).
- [ ] Line 321 (the `if (deltas.length === 0) …` fallback) is unchanged.
- [ ] The `shouldNudge` JSDoc no longer claims bloat fires "regardless" / is "INDEPENDENT"; it states delta-only
      when delta data exists and bloatHit as a no-delta-only fallback.
- [ ] `npx tsc --noEmit` green.
- [ ] In `test/drift_nudge.test.ts`, every `shouldNudge` case stays green EXCEPT the documented flip
      (`m(500,true,1)` → now `false`), which is handed to P4.M2.T1.S2.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_
**Yes** — the exact two edits, the exact replacement JSDoc (verbatim), the exact line anchors, the unchanged
caller, and the exact one test that must flip are all pinned below.

### Documentation & References

```yaml
# MUST READ — the spec authority for the demotion
- url: spec/07-preventive-and-nudges.md §5.1 (Windowed drift signaling, REQUIRED)
  why: "The firing condition is delta-only when delta data is available: avg(window.deltaTokens) >
       driftThresholdTokens. The earlier || bloatHit arm is dropped ... bloatHit remains a firing condition
       only in the no-delta fallback (first turn / post-reload)."
  critical: This is the line-for-line contract for the code change. The acceptance criteria (a) single 8k turn
        does NOT fire; (b) three ~4k turns DO fire; (c) a single large result with ~0 net growth does NOT fire —
        are the test-truth-table the implementation must satisfy.
- url: spec/07-preventive-and-nudges.md §2 (Nudge B — Edge cases)
  why: "First turn / post-reload ... with no delta data in the window, shouldNudge falls back to bloatHit-only
        signaling. This is the ONLY path on which bloatHit fires the drift nudge." + the "Bloat counts are
        cosmetic now, not a firing trigger" note — the rationale for the demotion.
- url: spec/08-edge-cases.md E22 (Same-prompt rewind retry loop — runaway growth)
  why: The stuck-turn loop this demotion helps defuse. Context only — E22's hard backstops live in P4.M1, not here.

# Architecture research (verified against HEAD) — THE blueprint
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§4 nudges.ts — the bloatHit demotion (P4.M2.T1)"
  why: Pins the exact change: "line 323 → return avg > config.nudges.driftThresholdTokens; The deltas.length === 0
        fallback (line 321) is UNCHANGED." + the JSDoc rewrite directive.

# The ONLY file to edit
- file: src/nudges.ts
  why: shouldNudge lives here (function at line 316; JSDoc at lines 271–315). Two edits inside this one function.
  pattern: PURE boolean helper, no Pi calls, no tokenization. Reads config.nudges.driftWindowTurns +
        config.nudges.driftThresholdTokens only.
  gotcha: DO NOT touch line 321 (the no-delta fallback) — it is the ONLY remaining bloat-armed path and is
        spec-required to survive. Touching it breaks the first-turn/post-reload nudge.

# The UNCHANGED caller (read-only — confirms no caller edit is needed)
- file: src/filter.ts
  why: The drift-nudge injection block (~lines 290–305) calls shouldNudge(markers.recentMetrics, config) and
        consumes a plain boolean. It already passes the full recentMetrics array (shouldNudge slices the window
        itself). No change required here — the contract is a boolean in, boolean out.

# The test file that flips (NOT this item's edit — owned by P4.M2.T1.S2; read to confirm the boundary)
- file: test/drift_nudge.test.ts
  why: The `shouldNudge — windowed drift gate (spec/07 §5.1)` describe block. After this item's code change, the
        case `shouldNudge([m(500, true, 1)], cfg())` flips from true → false (deltas=[500], avg 500 < 6000, bloat
        no longer armed). The no-delta case `shouldNudge([m(null, true, 1)], cfg())` STAYS true (fallback path).
  pattern: Pure-function tests — NO Pi fakes, NO setConfig. The m() helper builds a minimal TurnMetric:
        (deltaTokens, bloatHit=false, seq). cfg() builds nudges:{driftWindowTurns:3, driftThresholdTokens:6000}.
  gotcha: This item ships its code change WITH one expected-red test (handed to S2). Do NOT edit any test file.

# Sibling PRPs (assume landed as specified)
- file: plan/004_d3d84055c5b2/P4M1T3S1/PRP.md   # parallel — adds rewind-tool guard tests; does NOT touch nudges.ts
- file: plan/004_d3d84055c5b2/P4M2T1S2/PRP.md   # (next) flips the stale bloat-armed test assertion(s)
```

### Current Codebase tree (the relevant slice)

```bash
src/
  nudges.ts           # shouldNudge (line 316) + its JSDoc (lines 271–315)  ← EDIT (2 edits, one function)
  filter.ts           # unchanged caller (drift-nudge block ~lines 290–305) — READ-ONLY
test/
  drift_nudge.test.ts # shouldNudge gate tests — READ-ONLY here; ONE case flips under S2
```

### Desired Codebase tree with files to be edited

```bash
src/nudges.ts        # EDIT ONLY: line 323 (drop || arm) + JSDoc lines 271–315 (rewrite)
# NO new files. NO test edits (that is S2). NO README/config change (Mode A).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: line 321 (the no-delta fallback) MUST stay byte-for-byte unchanged. It is the ONLY surviving
//   bloat-armed path and is spec-required for the first-turn / post-reload nudge. Do not "clean up" both arms.
//     if (deltas.length === 0) return window.some((m) => m.bloatHit === true);   // line 321 — DO NOT TOUCH

// CRITICAL: the edit is to the DELTA-AVAILABLE return ONLY (line 323). It becomes a bare comparison:
//     return avg > config.nudges.driftThresholdTokens;   // line 323 — remove the || arm

// GOTCHA (the bloatHit === true guard): keep the `=== true` (not truthy) in the line-321 fallback — readMarkers
//   casts raw session data, so bloatHit may be undefined/non-boolean; === true fails safe to "no bloat". This
//   applies to the UNCHANGED fallback; the edited line no longer references bloatHit at all.

// GOTCHA (test expectation): after this change, test/drift_nudge.test.ts case `shouldNudge([m(500,true,1)],cfg())`
//   becomes false (was true). This is CORRECT and is P4.M2.T1.S2's flip. Do not "fix" the code to keep it true.

// GOTCHA (build command): package.json has NO `npm run build` script. Type-check = `npx tsc --noEmit`
//   (typescript ^5 devDep; tsconfig.json present). Tests = `npm test` (vitest run). Removing a `||` arm is
//   type-neutral — tsc stays green.
```

---

## Implementation Blueprint

### Data models / structure

None. No types, no models, no new functions, no signature change. `shouldNudge` keeps its exact signature
`(recentMetrics: TurnMetric[], config: MulliganConfig): boolean`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/nudges.ts line 323 — DROP the || bloatHit arm from the delta-available return
  - FIND (line 323, exact current text):
        return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);
  - REPLACE WITH:
        return avg > config.nudges.driftThresholdTokens;
  - PRESERVE: line 321 unchanged:
        if (deltas.length === 0) return window.some((m) => m.bloatHit === true);
  - NAMING/PLACEMENT: no change — same function, same line region.
  - VERIFY: the function body now has exactly ONE `window.some((m) => m.bloatHit === true)` reference (on line
        321, inside the no-delta fallback) and the delta path returns a bare comparison.

Task 2: EDIT src/nudges.ts lines 271–315 — REWRITE the shouldNudge JSDoc to delta-only-when-delta-exists
  - REPLACE the ENTIRE shouldNudge JSDoc block (the `/**` starting at line 271 through the closing `*/` at line
        315) with the VERBATIM target text in "JSDoc replacement text" below.
  - The rewrite changes four things, nothing else:
      (a) First-paragraph tail: bloat is no longer an OR'd firing condition; it is a no-delta-only fallback.
      (b) The algorithm block's "Bloat is INDEPENDENT of the windowed delta ... fires regardless" sentence →
          "bloat is NOT OR'd into this path; bloatHit fires ONLY in the no-delta fallback".
      (c) Add a short "WHY bloatHit is demoted" paragraph citing P4.M2.T1.S1 / spec/07 §5.1 (stuck-turn-loop
          amplifier; the ~0k/N self-contradiction).
      (d) The @returns line: "delta > threshold OR bloatHit" → "delta-only when delta data exists; bloatHit is a
          fallback ONLY when no window metric has a usable delta".
  - PRESERVE: the @param recentMetrics + @param config lines (unchanged); the SPEC-AMBIGUITY RESOLUTION reasoning
        (moving-average vs sum — unchanged algorithm choice; only the trailing "with bloat OR'd in" clause becomes
        "DELTA-ONLY (bloat demoted)"); the defensive `=== true` / `Number.isFinite` notes; the grewOverThreshold
        note.
  - DO NOT alter any OTHER JSDoc in the file (bloatReminderHandler, turnEndMetricHandler, injectNudge,
        suppressCheck, shouldHighWater, etc. — they are unaffected by this change).
```

#### JSDoc replacement text (verbatim target for Task 2 — replaces lines 271–315)

```ts
/**
 * shouldNudge — Nudge B Phase 2 gate (spec/07 §2; spec/07 §5.1 Windowed drift signaling, REQUIRED). PURE boolean
 * (no Pi calls, no tokenization). Fires the drift nudge iff the per-turn token delta, SMOOTHED over a rolling
 * window of the last `config.nudges.driftWindowTurns` turns, exceeds `config.nudges.driftThresholdTokens`
 * (DELTA-ONLY when delta data exists). bloatHit is NOT a firing condition when delta data exists — it is a
 * FALLBACK ONLY when no window metric has a usable delta (first turn / post-reload).
 *
 * ALGORITHM — moving average (spec/07 §5.1 "moving-average, or M-of-N"; the item contract + architecture
 * implementation_patterns.md Pattern 8 both RECOMMEND moving average). The window is the first `driftWindowTurns`
 * entries of `recentMetrics` (P3.M3.T3.S1 sorts them NEWEST-FIRST — highest seq at index 0). From that window we
 * collect the `deltaTokens` values that are finite numbers (null/non-number/NaN/±Infinity deltas — first turn /
 * post-reload / a malformed cast — are dropped). If NO window metric has a usable delta, the delta path is skipped
 * and we fall back to the bloat path ALONE (first turn / post-reload — the ONLY path on which bloatHit fires the
 * drift nudge). Otherwise the AVERAGE of the window's usable deltas is compared (strictly greater) to
 * `driftThresholdTokens`, and the result is DELTA-ONLY — bloat is NOT OR'd into this path.
 *
 * WHY bloatHit is demoted (P4.M2.T1.S1 / spec/07 §5.1, §2 Edge cases): the earlier `|| bloatHit` arm fired the
 * drift nudge on ANY single large tool result — redundant with Nudge A (already co-located on that result) and a
 * known stuck-turn-loop amplifier (it produced the live-observed `~0k tokens / N bloated results`
 * self-contradiction: a near-zero-net-growth turn with one big result fired the drift nudge). With bloatHit removed
 * from the delta-available path, a ~0-net-growth turn does NOT fire regardless of how big a result it held.
 * bloatHit survives ONLY in the no-delta fallback so a bloated result on turn 1 (before any baseline exists) still
 * nudges.
 *
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
 *
 * The bloat fallback uses `=== true` (not truthy) so a malformed metric — readMarkers casts raw session data, so
 * `bloatHit` could be undefined/non-boolean — fails safe to "no bloat". Delta values are guarded with
 * `typeof === "number" && Number.isFinite(d)` so a malformed `deltaTokens` (string/NaN/Infinity) is dropped rather
 * than poisoning the average with NaN. An empty window (no metrics) → no usable deltas → bloat fallback over an
 * empty window → false (no nudge).
 *
 * `grewOverThreshold` (the per-turn precomputation from turnEndMetricHandler) is NOT consulted here — the windowed
 * average replaces the single-turn comparison. It is still computed and persisted by turnEndMetricHandler (for
 * audit/back-compat) but is deliberately unused by this gate.
 *
 * @param recentMetrics ALL mulligan:turn-metric entries on the branch, sorted NEWEST-FIRST
 *                       (MarkersBundle.recentMetrics from P3.M3.T3.S1). This function slices the first
 *                       `driftWindowTurns` itself; the caller passes the full array.
 * @param config        the MulliganConfig (reads nudges.driftWindowTurns + nudges.driftThresholdTokens).
 * @returns true iff the windowed moving-average delta > driftThresholdTokens (delta-only when delta data exists);
 *          bloatHit is a fallback ONLY when no window metric has a usable delta (first turn / post-reload).
 */
```

> **Diff sanity check** vs the original JSDoc: only four spans change — (1) the first-paragraph tail
> ("…OR any metric in that window recorded a bloated result." → the delta-only/fallback clause); (2) the algorithm
> block's "Bloat is INDEPENDENT … fires regardless" sentence → "bloat is NOT OR'd into this path … only the
> no-delta fallback"; (3) a NEW short "WHY bloatHit is demoted" paragraph; (4) the @returns line. Everything else
> (the moving-average-vs-sum reasoning, defensive guards, grewOverThreshold note, @param lines) is preserved
> verbatim — use that to keep the edit surgical if you prefer targeted edits over a full-block replacement.

### Implementation Patterns & Key Details

```ts
// ── Task 1: the single line change (before → after) ────────────────────────────────────────────────
// BEFORE (line 323):
  return avg > config.nudges.driftThresholdTokens || window.some((m) => m.bloatHit === true);
// AFTER (line 323):
  return avg > config.nudges.driftThresholdTokens;

// ── Line 321 (the no-delta fallback) is UNCHANGED — it is the only surviving bloat-armed path ───────
  if (deltas.length === 0) return window.some((m) => m.bloatHit === true);

// ── Truth table after the change (driftWindowTurns:3, driftThresholdTokens:6000) ───────────────────
//   [8000,500,500]   deltas len 3, avg 3000, bloat false → false  (single spike suppressed) ✓
//   [7000,7000,7000] deltas len 3, avg 7000, bloat false → true   (sustained growth) ✓
//   [null] bloat true deltas len 0 → FALLBACK → true              (first turn bloat — unchanged) ✓
//   [500]  bloat true deltas len 1, avg 500, bloat true → false   (← was true; the S2 flip) ⚠
//   []                 deltas len 0 → FALLBACK → false            (empty window) ✓
//   [null] bloat false deltas len 0 → FALLBACK → false            (first turn, no bloat) ✓
```

### Integration Points

```yaml
DATABASE: none.
CONFIG: none — reads the SAME two knobs (nudges.driftWindowTurns, nudges.driftThresholdTokens). No knob added.
ROUTES/EVENTS: none — shouldNudge is a PURE helper; its sole caller (filter.ts drift-nudge block) is unchanged
  (boolean in, boolean out; already passes markers.recentMetrics).
PERSISTENCE: none.
DOCUMENTATION: [Mode A] the shouldNudge JSDoc IS the doc that rides with the work. No README/config-table change
  (this is a logic refinement, not a new user-facing feature).
```

---

## Validation Loop

### Level 1: Syntax & Type (after the edits)

```bash
npx tsc --noEmit          # the only type-check (no `npm run build` script exists). Removing a || arm is type-neutral.
# Expected: zero errors. (No type/shape/export change — shouldNudge's signature is untouched.)
```

### Level 2: Targeted test run (confirms the surgical effect + the ONE expected flip)

```bash
# The shouldNudge gate tests. After Task 1, EVERY case passes EXCEPT the documented bloat-armed-delta case.
npx vitest run test/drift_nudge.test.ts -t "windowed drift gate"
# Expected: PASS for [8k,0.5k,0.5k]→false, [7k,7k,7k]→true, [null,true]→true (fallback, unchanged),
#   empty→false, all-null-no-bloat→false, window-slicing, malformed-delta.
#   FAIL for "fires on bloatHit even when the windowed average is below threshold"  ←  ([500,true]→false now).
#   That single failure is CORRECT and is P4.M2.T1.S2's flip. Do NOT edit the test here.
```

### Level 3: Full-suite regression (confirm no collateral breakage)

```bash
npm test                  # = vitest run
# Expected: green EVERYWHERE except the single shouldNudge case above (S2's). Confirm the count of failures is
#   exactly ONE (in test/drift_nudge.test.ts). If ANY other test changed color, STOP — that is collateral
#   breakage (e.g. you accidentally touched line 321, or a filter.ts integration test asserted bloat-armed firing).
#   Revert and re-check.
```

### Level 4: Spec-traceability + diff inspection (deterministic)

```bash
# (a) The delta-available return is a bare comparison (no || arm):
grep -n "return avg > config.nudges.driftThresholdTokens;" src/nudges.ts
# Expected: exactly ONE match (line ~323), with NO "|| window.some" trailing on that line.

# (b) The no-delta fallback is INTACT (still the only bloat-armed path):
grep -n "if (deltas.length === 0) return window.some((m) => m.bloatHit === true);" src/nudges.ts
# Expected: exactly ONE match (line ~321).

# (c) Count of bloatHit references in shouldNudge dropped from 2 → 1:
grep -nE "bloatHit === true" src/nudges.ts
# Expected: exactly ONE match in the whole file (line ~321). (was two before this item.)

# (d) The JSDoc no longer claims bloat is independent/always-fires:
grep -nE "INDEPENDENT of the windowed delta|fires regardless|with bloat OR'd in" src/nudges.ts
# Expected: ZERO matches (those phrases were rewritten out). The new doc says "DELTA-ONLY" / "no-delta fallback".
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes (zero errors; no signature/shape change).
- [ ] `npm test` is green everywhere except the single `shouldNudge([m(500,true,1)],cfg())` case (S2's flip).
- [ ] Exactly ONE test changed color vs HEAD, and it is the documented one in `test/drift_nudge.test.ts`.

### Feature Validation (spec/07 §5.1)
- [ ] Line 323 is `return avg > config.nudges.driftThresholdTokens;` (no `||` arm).
- [ ] Line 321 (no-delta fallback) is byte-for-byte unchanged.
- [ ] A single ~0-net-growth turn with a bloated result does NOT fire (criterion (c) — the demotion's purpose).
- [ ] Sustained windowed growth still fires; first-turn bloat still fires via the fallback.

### Code Quality Validation
- [ ] Only `src/nudges.ts` is modified (no test file, no filter.ts, no README, no config).
- [ ] The JSDoc rewrite is accurate (delta-only when delta exists; bloatHit = no-delta fallback only).
- [ ] No other JSDoc in the file was altered.

### Documentation
- [ ] [Mode A] the `shouldNudge` JSDoc is updated (the inline doc that rides with the work). No other docs touched.

---

## Anti-Patterns to Avoid

- ❌ Don't touch line 321 (the `if (deltas.length === 0) …` fallback). It is the ONLY surviving bloat-armed path and
  is spec-required for the first-turn/post-reload nudge. Both arms look similar — edit ONLY the trailing `return`.
- ❌ Don't "fix" the failing test by editing `test/drift_nudge.test.ts` — that flip is **P4.M2.T1.S2's** contract.
  S1 ships the code change with that one assertion intentionally red.
- ❌ Don't edit `filter.ts` (the caller) — it consumes a plain boolean and already passes `markers.recentMetrics`;
  no caller change is needed or correct.
- ❌ Don't reword the moving-average-vs-sum SPEC-AMBIGUITY reasoning — only the trailing "bloat OR'd in" clause
  changes. The algorithm choice (moving average) is unchanged by this item.
- ❌ Don't run `npm run build` (there is no such script). Use `npx tsc --noEmit`.
- ❌ Don't broaden scope to E22 / suppressCheck / high-water — those are M1 and unrelated nudges.ts functions.

---

**Confidence Score: 10/10** for one-pass success. This is a single-line logic edit (`return A || B` → `return A`)
plus a JSDoc rewrite, both pinned to exact line anchors with verbatim replacement text, an unchanged pure-boolean
caller, and a precisely documented single-test flip handed to S2. The only implementation judgment is *not*
over-editing (leave line 321 and the algorithm reasoning alone) — which the gotchas and anti-patterns make explicit.