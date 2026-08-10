# PRP — P1.M4.T3.S1: suppressCheck JSDoc + test align to §5.3

## Goal

**Feature Goal**: Align `suppressCheck`'s documentation and tests to cite **spec/07 §5.3** explicitly (the hard
rule: "the drift nudge MUST NOT fire for a turn in which the agent already issued a `mulligan:rewind` or
`mulligan:shrink`, regardless of delta or `bloatHit`"), and assert the §5.3 acceptance cases (a)/(b)/(c)
explicitly. The `suppressCheck` **mechanism stays a ts-window heuristic** — this task is JSDoc + test align,
NOT a rewrite to seq-based (item contract point (c); the spec itself calls suppress a "Simple heuristic").

**Deliverable**: Edits to **two files** (a third is optional, comments-only) — `src/nudges.ts` (JSDoc only on
`suppressCheck` L367 + `NUDGE_TURN_WINDOW_MS` L260; **no body change**), and `test/drift_nudge.test.ts` (relabel
the existing `suppressCheck` describe to cite §5.3 + add a focused §5.3 (a)/(b)/(c) acceptance `describe`).
`test/filter.test.ts` is an OPTIONAL comments-only edit (§5.3 traceability labels on L453/L467; mechanism
unchanged → those integration tests already pass). DOCS = [Mode A]: the `suppressCheck` JSDoc update **IS** the
doc — no separate `.md` file.

**Success Definition**: After the edits, (1) `suppressCheck`'s JSDoc cites **§5.3** as the hard rule and quotes
the "regardless of delta or bloatHit" framing (with §2 retained as the origin note); (2) `NUDGE_TURN_WINDOW_MS`'s
JSDoc cites §5.3 as the rule the window implements; (3) the §5.3 acceptance **(a)** >threshold+shrink→no nudge,
**(b)** >threshold+nothing→fires, **(c)** >threshold+rewind→no nudge are asserted explicitly (combined
`shouldNudge && !suppressCheck` guard) and PASSING; (4) the `suppressCheck` **function body is byte-identical**
(GOTCHA — do not rewrite to seq-based); (5) `npm run typecheck` exits 0; (6) `npx vitest run` is green (test
COUNT +3 from the new §5.3 acceptance describe; existing tests unchanged).

> ⚠️ **[Mode A] doc update.** The only "documentation" change is the `suppressCheck` (L367) + `NUDGE_TURN_WINDOW_MS`
> (L260) JSDoc. There is **no** separate `.md` doc file. The README sync is sibling **P1.M5.T1.*** — do NOT touch
> README.

> ⚠️ **Sibling PRP running in parallel.** P1.M4.T2.S1 (`renderDriftNudge` rewrite) edits `src/notes.ts` +
> `test/notes.test.ts` + `test/edge-cases.test.ts` + `test/drift_nudge.test.ts`. This PRP (T3) edits
> `src/nudges.ts` + `test/drift_nudge.test.ts` (a DIFFERENT `describe` block — the `suppressCheck` block at L171,
> not the `injectNudge`/`renderDriftNudge` blocks T2 touches). The two edits are NON-OVERLAPPING by content, but
> **line numbers will shift** after T2 lands. LOCATE every edit by its CONTENT / `describe` label, NOT by absolute
> line number. The `grep -n` commands in the Validation Loop are content-keyed for exactly this reason.

## User Persona (if applicable)

**Target User**: Future maintainers/reviewers of the Mulligan nudge subsystem (the consumers of the JSDoc + the
§5.3 traceability in the tests), and the implementing agent that consumes the spec contract.

**Use Case**: A reviewer asks "does the drift nudge re-announce bloat the agent already shrank?" → the §5.3 JSDoc
on `suppressCheck` answers it at the rule level, and the §5.3 (a)/(b)/(c) acceptance tests prove it
deterministically.

**Pain Points Addressed**: The JSDoc currently cites only §2 "Edge cases" — a reviewer tracing §5.3 lands on
`suppressCheck` and sees no §5.3 citation, so the link from the REQUIRED hard rule to its implementation is
implicit. The existing tests prove the ts-window *mechanism* but are labeled §2 and do not assert the §5.3
acceptance *semantic* (the combined `shouldNudge && !suppressCheck` net-nudge decision), so the §5.3 contract
points (a)/(b)/(c) are not executable as written.

## Why

- **§5.3 promotes the §2 edge-case heuristic to a hard rule** (selected_prd_content h3.61 / h2.80). The JSDoc must
  reflect that: §2 is the ORIGIN; §5.3 is the RULE. Citing only §2 undersells a REQUIRED behavior and breaks the
  spec→code traceability a reviewer relies on.
- **The §5.3 acceptance (a)/(b)/(c) are the contract** (item contract point (b); spec/10 F-nudge-drift L88).
  Today they hold *de facto* (the mechanism + filter.test.ts:453/467 cover them) but are not asserted *as §5.3*.
  Making them explicit turns the contract into executable checks that fail loudly if a future edit regresses the
  non-overlap between Nudge A (inline) and Nudge B (cross-turn).
- **Scope discipline within M4**: this is the *§5.3 align* third (T3). T1 (`renderBloatReminder`) and T2
  (`renderDriftNudge`) are the text rewrites. T3 touches `suppressCheck`'s JSDoc + the §5.3 tests ONLY — it does
  NOT touch any render function or the suppressCheck body.

## What

A JSDoc citation swap + a focused §5.3 acceptance test block. No behavior change, no signature change, no
mechanism change.

1. **`src/nudges.ts`** — `suppressCheck` JSDoc (first paragraph, ~L367): change the citation from
   `spec/07 §2 "Edge cases"` to **`spec/07 §5.3`** as the hard rule; add the §5.3 framing sentence
   ("hard rule — drift nudge MUST NOT fire for a turn in which the agent already issued a rewind/shrink,
   regardless of delta or bloatHit"); **retain §2 as the origin note** ("§5.3 promotes the §2 edge-case ts-window
   heuristic to a hard rule"). KEEP the GOTCHA #6/#7 paragraphs + `@param`/`@returns` unchanged.
2. **`src/nudges.ts`** — `NUDGE_TURN_WINDOW_MS` JSDoc (~L260): update the citation to cite **§5.3** as the rule
   the window implements (the window IS the §5.3 mechanism); keep the §2 origin phrasing for consistency.
3. **`test/drift_nudge.test.ts`** — relabel the existing `describe("suppressCheck — suppress heuristic window
   (spec/07 §2 Edge cases)")` (~L171) to cite **§5.3** (it implements the §5.3 mechanism). KEEP all 10 existing
   mechanism tests unchanged (they prove the window).
4. **`test/drift_nudge.test.ts`** — ADD a new `describe("suppressCheck — spec/07 §5.3 hard rule … (acceptance
   a/b/c)")` with **3** `it` blocks asserting the combined §5.3 net-nudge guard
   `shouldNudge(recentMetrics, config) && !suppressCheck(metric, markers)` for (a) >threshold+shrink→false,
   (b) >threshold+nothing→true, (c) >threshold+rewind→false.
5. **`test/filter.test.ts`** *(OPTIONAL, comments-only)* — add a `// §5.3 (b)` / `// §5.3 (c)` traceability
   comment to the existing drift-suppression integration tests at L453 / L467. NO logic change (mechanism
   unchanged → they pass as-is).

### Success Criteria

- [ ] `suppressCheck`'s JSDoc first paragraph cites **§5.3** (the hard rule) AND retains **§2** as the origin.
- [ ] The §5.3 framing sentence ("MUST NOT fire … regardless of delta or bloatHit") appears in the JSDoc.
- [ ] `NUDGE_TURN_WINDOW_MS`'s JSDoc cites **§5.3** as the rule the window implements.
- [ ] The `suppressCheck` **function body is byte-identical** to before (`git diff` shows NO change inside the
      `export function suppressCheck(…){…}` body — only JSDoc above it).
- [ ] `test/drift_nudge.test.ts`: the existing `suppressCheck` describe is relabeled to §5.3 (10 mechanism tests
      unchanged) + a new §5.3 (a)/(b)/(c) acceptance describe is added (3 new `it` blocks, all passing).
- [ ] `npm run typecheck` exits 0; `npx vitest run` is green (test COUNT +3).
- [ ] `git diff --name-only` shows `src/nudges.ts` + `test/drift_nudge.test.ts` (and, if the optional task is
      done, `test/filter.test.ts`). NO other files.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the EXACT current `suppressCheck` body (so the implementer can verify it stays
byte-identical — GOTCHA #1), the EXACT current JSDoc first-paragraph text for both `suppressCheck` (L367) and
`NUDGE_TURN_WINDOW_MS` (L260) (so the `edit` oldText is unambiguous), the EXACT target citation + framing
(verbatim from spec/07 §5.3 / selected_prd_content h3.61), the EXACT existing test helper signatures available
for reuse (`metric`/`rewind`/`shrink` module-level; `m`/`cfg` are shouldNudge-scoped → must be re-defined), the
EXACT combined guard the §5.3 acceptance tests must mirror (`shouldNudge && !suppressCheck` — quoted from
filter.ts:319), and the two validation gates (`npm run typecheck` = `tsc --noEmit` strict; `npx vitest run`).
The implementer makes targeted `edit` calls and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the function whose JSDoc is aligned (BODY STAYS BYTE-IDENTICAL)
- file: src/nudges.ts
  why: Owns suppressCheck (export at ~L390) + NUDGE_TURN_WINDOW_MS (export at ~L262). The JSDoc FIRST PARAGRAPH
        of suppressCheck (~L367) and the NUDGE_TURN_WINDOW_MS JSDoc (~L260) are the only edits in this file.
        The suppressCheck FUNCTION BODY is NOT touched (item contract point (c); GOTCHA #1).
  section: "suppressCheck JSDoc: the block immediately above `export function suppressCheck(` (the first
            paragraph starting 'suppressCheck — Nudge B Phase 2 suppress heuristic (spec/07 §2 …)'). KEEP the
            two 'WHY a window…' (GOTCHA #7) + 'WHY a structural markers param' (GOTCHA #6) paragraphs and the
            @param/@returns lines UNCHANGED — edit ONLY the first paragraph's citation + add the §5.3 framing
            sentence. NUDGE_TURN_WINDOW_MS JSDoc: the block above `export const NUDGE_TURN_WINDOW_MS =`."
  pattern: "House style for a spec-cited helper: the FIRST line names the helper + its spec section in parentheses
            — '(spec/07 §N …)'. Mirror it: swap '§2 \"Edge cases\"' → '§5.3' as the primary citation, keep §2 as
            the origin ('§5.3 promotes the §2 edge-case ts-window heuristic to a hard rule')."
  gotcha: "GOTCHA #1 (the FUNCTION BODY must NOT change): the task is JSDoc + test align ONLY. Do NOT rewrite
           suppressCheck to be seq-based (item contract point (c)). The spec itself frames suppress as a 'Simple
           heuristic' (spec/07 §2); the implementation is ts-window and that is intentional. A `git diff` that
           shows ANY change inside `export function suppressCheck(…){…}` is a SCOPE VIOLATION — revert it."

# MUST EDIT — the suppressCheck unit tests (relabel existing describe + ADD §5.3 acceptance describe)
- file: test/drift_nudge.test.ts
  why: Two changes: (1) relabel the existing `describe(\"suppressCheck — suppress heuristic window (spec/07 §2
        Edge cases)\")` (~L171) to cite §5.3 — KEEP all 10 mechanism `it` blocks unchanged; (2) ADD a new
        `describe(\"suppressCheck — spec/07 §5.3 hard rule … (acceptance a/b/c)\")` with 3 `it` blocks asserting
        the combined §5.3 net-nudge guard. Test COUNT +3.
  section: "The existing suppressCheck describe is the 3rd top-level describe (after shouldNudge + injectNudge).
            Its label literally contains 'suppress heuristic window (spec/07 §2 Edge cases)'. The new §5.3
            acceptance describe goes IMMEDIATELY AFTER it (before the NUDGE_TURN_WINDOW_MS describe)."
  pattern: "House test style: vitest, imports from '../src/nudges.js', 'it' blocks, expect().toBe. REUSE the
            MODULE-LEVEL helpers already in the file: metric(opts), rewind(seq,ts), shrink(seq,ts). Do NOT try to
            reuse `m()`/`cfg()` — they are LOCAL to the shouldNudge describe and invisible at top level; define
            your own driftWindow()/cfg() inside the new describe (see Implementation Tasks Task 4)."
  gotcha: "GOTCHA #2 (m()/cfg() are shouldNudge-scoped): the windowed-metric helper `m(deltaTokens,bloatHit,seq)`
           and `cfg(windowTurns,threshold)` are declared with `const` INSIDE `describe(\"shouldNudge …\")`. A new
           SIBLING describe CANNOT see them (lexical scope). Re-declare equivalent helpers inside the new §5.3
           describe. The §5.3 acceptance needs shouldNudge to return true → build a 3-metric window whose
           deltaTokens moving-average EXCEEDS the threshold (e.g. [7000,7000,7000], threshold 6000 → avg 7000)."

# OPTIONAL EDIT (comments-only) — integration-level drift-suppression tests (§5.3 traceability labels)
- file: test/filter.test.ts
  why: Lines 453 + 467 are integration-level mirrors of §5.3 (b) [fires normally, no marker] + (c) [rewind →
        suppressed]. Mechanism UNCHANGED → they PASS as-is. The ONLY edit is adding a `// §5.3 (b)` / `// §5.3 (c)`
        traceability comment so a reviewer tracing §5.3 finds the integration proof. This is OPTIONAL — the unit
        acceptance in drift_nudge.test.ts is the REQUIRED deliverable; filter.test.ts is a nice-to-have label.
  section: "describe for contextHandler drift-nudge injection. L453 'injects the drift nudge when shouldNudge true
            and not suppressed' = §5.3 (b); L467 'does NOT inject … suppressed by a same-turn rewind marker' =
            §5.3 (c). L490/502 are E22 (refused-rewind mute) — ORTHOGONAL to §5.3, do not label them §5.3."
  pattern: "Add a one-line comment above the `it(...)` naming the §5.3 acceptance letter. Do NOT change the
            assertion, the metricData/rewindData inputs, or the makeCtx harness. If in doubt, SKIP this task —
            it is pure labeling and the tests are green without it."

# MUST READ — the spec authority (verbatim §5.3 text + acceptance a/b/c)
- docContext: selected_prd_content heading h3.61 (== spec/07 §5.3) + h2.80 (§5 header)
  why: h3.61 is the SINGLE source of truth for the §5.3 rule text + the (a)/(b)/(c) acceptance. Quote it verbatim
        into the JSDoc framing sentence + the new test describe label/it-names.
  critical: "§5.3 verbatim: 'The drift nudge (§2) MUST NOT fire for a turn in which the agent already issued a
             mulligan:shrink or mulligan:rewind … regardless of delta or bloatHit.' + 'Acceptance: (a) a turn
             that produces a >threshold result AND shrinks it does NOT fire the drift nudge next turn; (b) a turn
             that produces a >threshold result and does nothing fires normally; (c) a turn that rewinds also does
             not fire.' The §5.3 spec FRAMES the rule as 'shouldNudge returns false' but the IMPLEMENTATION
             delegates to a SEPARATE suppressCheck gate (filter.ts:319: shouldNudge && !suppressCheck) — the tests
             assert that COMBINED guard, not a fictional in-shouldNudge branch."

# MUST READ — the authoritative call site (proves the combined guard the tests mirror)
- file: src/filter.ts
  why: Lines 316–325 are the REAL §5.3 enforcement: the nudge fires iff `shouldNudge(recentMetrics, config) &&
        markers.metric && !suppressCheck(markers.metric, markers) && rt.rewindRefusedTurnIndex !== …`. The §5.3
        acceptance tests mirror EXACTLY `shouldNudge && !suppressCheck` (the refused-rewind flag is E22,
        orthogonal — out of scope).
  section: "The `// Per-turn drift nudge (spec/07 §2; §5.1 …)` comment block ~L304 + the `if (...)` at ~L316.
            READ-ONLY — do NOT edit filter.ts (it is not in the edit set)."

# CONTEXT — the Tier-2 integration mirror (already exists; NOT in scope to write)
- file: test/integration/scenarios.md
  why: spec/10 F-nudge-drift (scenarios.md:177 + smoke.ts:220 + run-smoke.mjs:34/492) is the REAL-pi integration
        scenario that includes the §5.3 negative ('a turn that produces a >threshold result AND shrinks/rewinds
        it in the same turn does NOT fire the drift nudge next turn (§5.3 …)'). It ALREADY EXISTS — this PRP does
        NOT write it. The unit-level (a)/(b)/(c) tests in drift_nudge.test.ts are the deterministic FOUNDATION
        for that integration scenario.
  critical: "Do NOT create or edit anything under test/integration/. That is a separate Tier-2 harness. The item
             contract references 'spec/10 F-nudge-drift §5.3' as the ACCEPTANCE SHAPE (a/b/c), realized here at
             the pure-helper unit tier."

# CONTEXT — the tsconfig facts (no logic change → no new gotchas; new tests are plain literals)
- file: tsconfig.json
  why: Confirms strict:true. There is NO eslint config in the repo. The new §5.3 tests are well-typed partial
        literals cast to TurnMetric (the file's existing pattern). No arity change to suppressCheck.
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── nudges.ts            # ← EDIT (JSDoc only): suppressCheck JSDoc (~L367) + NUDGE_TURN_WINDOW_MS JSDoc (~L260)
└── filter.ts            # READ-ONLY (the call site that proves the combined guard — ~L316–325)
test/
├── drift_nudge.test.ts  # ← EDIT: relabel suppressCheck describe (~L171) → §5.3; ADD §5.3 (a)/(b)/(c) describe
└── filter.test.ts       # ← OPTIONAL (comments-only): §5.3 (b)/(c) labels on L453/L467
# READ-ONLY context:
plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md   # M4.T3 section (target JSDoc + test intent)
tsconfig.json            # strict:true, NO eslint
spec/07-preventive-and-nudges.md   # §5.3 + §2 Edge cases (verbatim authority)
spec/10-testing.md       # F-nudge-drift L88 (the integration acceptance shape)
test/integration/        # F-nudge-drift Tier-2 harness — EXISTS, NOT in scope to write
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files (a third optional, comments-only):
src/notes.ts             # NOT TOUCHED (T2's scope) — listed only to draw the scope boundary
src/nudges.ts            # suppressCheck JSDoc (§5.3 citation + framing) + NUDGE_TURN_WINDOW_MS JSDoc (§5.3)
test/drift_nudge.test.ts # relabel suppressCheck describe → §5.3; ADD §5.3 (a)/(b)/(c) acceptance describe (+3 it)
test/filter.test.ts      # [OPTIONAL] §5.3 (b)/(c) traceability comments on L453/L467 (no logic change)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (the suppressCheck FUNCTION BODY must NOT change — scope boundary):
//   The task is JSDoc + test align ONLY (item contract point (c)). The suppressCheck mechanism is a ts-window
//   heuristic — that is INTENTIONAL (spec/07 §2 frames suppress as a "Simple heuristic"; §5.3 *promotes* it to
//   a hard rule but does NOT change the mechanism). Do NOT rewrite it to collect `seq`s / be seq-based. A
//   `git diff` showing ANY change inside `export function suppressCheck(metric, markers){ … }` is a SCOPE
//   VIOLATION — revert it. The ONLY src/nudges.ts edits are the two JSDoc blocks ABOVE the two exports.

// CRITICAL GOTCHA #2 (m()/cfg() are shouldNudge-SCOPED — a sibling describe cannot see them):
//   The windowed helpers `const m = (deltaTokens, bloatHit, seq) => …` and `const cfg = (windowTurns, threshold)
//   => …` are declared with `const` INSIDE `describe("shouldNudge — windowed drift gate …")`. A NEW sibling
//   describe for §5.3 (a)/(b)/(c) is at TOP level and CANNOT reference them (lexical scope; TS would error
//   "Cannot find name 'm'/'cfg'"). Re-declare equivalent helpers INSIDE the new describe. The MODULE-LEVEL
//   helpers (metric/rewind/shrink, defined near the top of the file) ARE reusable — use them for the marker
//   literals.

// GOTCHA #3 (shouldNudge keys on the WINDOWED deltaTokens average, NOT grewOverThreshold):
//   To make shouldNudge(...) return true for the §5.3 acceptance tests, build a 3-metric window whose
//   deltaTokens MOVING AVERAGE exceeds driftThresholdTokens (e.g. [7000,7000,7000] with threshold 6000 →
//   avg 7000 > 6000 → true). Setting grewOverThreshold:true does NOT make shouldNudge fire (the JSDoc on
//   shouldNudge explicitly states grewOverThreshold is "deliberately unused by this gate" — P3.M3.T4.S1).
//   newest-first ordering: highest seq at index 0 (P3.M3.T3.S1).

// GOTCHA #4 (the §5.3 NET guard is `shouldNudge && !suppressCheck`, tested at the PURE-HELPER tier):
//   §5.3 spec FRAMES the rule as "shouldNudge returns false for that metric" — but the IMPLEMENTATION delegates
//   to a SEPARATE suppressCheck gate (filter.ts:319). Do NOT invent a branch inside shouldNudge; instead assert
//   the COMBINED guard `shouldNudge(recentMetrics, cfg) && !suppressCheck(metric, markers)` that filter.ts:319
//   actually evaluates. That is the faithful, mechanism-accurate mirror of §5.3 at the unit tier.

// GOTCHA #5 (the same-turn marker's ts must equal the metric's ts to land in the half-open window):
//   suppressCheck returns true iff `ts > metric.ts − window && ts <= metric.ts`. For "same-turn" acceptance,
//   build the marker with ts === metric.ts (the latest metric's ts). Using a ts from a PRIOR turn (e.g. ts=0
//   when metric.ts=3) would fall OUTSIDE (lo, metric.ts] for a small window… actually ts=0 with metric.ts=3 and
//   window=10min is INSIDE — but the SEMANTIC intent is "same turn", so set marker.ts === metric.ts to match the
//   spec's "marker created DURING the metric's turn". The existing drift_nudge.test.ts:179/199 already use
//   ts===T for the rewind/shrink cases — mirror that.

// GOTCHA #6 (line numbers SHIFT because sibling T2 edits the same test file in parallel):
//   T2 (renderDriftNudge) edits test/drift_nudge.test.ts too (the injectNudge/renderDriftNudge blocks). T2's
//   edits do not overlap the suppressCheck describe (L171) by content, but T2's land first → the suppressCheck
//   describe's line number shifts. LOCATE it by its CONTENT (the describe label string "suppressCheck —
//   suppress heuristic window"), not by L171. The Validation Loop greps are content-keyed.

// GOTCHA #7 (the existing 10 suppressCheck mechanism tests are KEPT AS-IS — do not rewrite them):
//   They prove the ts-window boundaries (inclusive upper, exclusive lower, future excluded, non-finite→safe).
//   That IS the §5.3 mechanism. Relabel the describe to cite §5.3; do NOT touch the `it` bodies. The new §5.3
//   (a)/(b)/(c) describe is ADDITIVE (+3 tests), not a rewrite of the mechanism tests.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new data models. `TurnMetric`, `RewindMarker`, `ShrinkMarker` (src/markers.ts), `MulliganConfig`
(src/config.ts) are all UNCHANGED. The suppressCheck signature
`(metric: TurnMetric, markers: { rewinds: ReadonlyArray<RewindMarker>; shrinks: ReadonlyArray<ShrinkMarker> }): boolean`
is UNCHANGED._

### The exact before → after

**`src/nudges.ts` — `suppressCheck` JSDoc, FIRST PARAGRAPH (the only edit on this block):**

```ts
// BEFORE (current first paragraph, ~L367 — cites ONLY §2):
/**
 * suppressCheck — Nudge B Phase 2 suppress heuristic (spec/07 §2 "Edge cases": "avoid nagging after the agent
 * already acted"). PURE: returns true (suppress the nudge) iff ANY rewind or shrink marker was created during the
 * metric's turn, approximated as: some marker.ts falls in the half-open window
 * (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]. Returns false otherwise (no markers / all older than the window /
 * marker ts in the future).
 *
 * … (GOTCHA #7 + GOTCHA #6 paragraphs UNCHANGED) …
 */

// AFTER (target first paragraph — §5.3 is the RULE, §2 retained as the ORIGIN; body + later paragraphs UNCHANGED):
/**
 * suppressCheck — Nudge B Phase 2 suppress gate, implementing spec/07 §5.3 (REQUIRED, hard rule): the drift nudge
 * MUST NOT fire for a turn in which the agent already issued a mulligan:rewind or mulligan:shrink that addressed
 * the bloat/drift the nudge would describe — REGARDLESS of delta or bloatHit. §5.3 promotes the earlier spec/07
 * §2 "Edge cases" ts-window heuristic ("avoid nagging after the agent already acted") to a hard rule; the
 * MECHANISM is unchanged (an acknowledged "Simple heuristic" per spec/07 §2 — NOT seq-based). PURE: returns true
 * (suppress the nudge) iff ANY rewind or shrink marker was created during the metric's turn, approximated as:
 * some marker.ts falls in the half-open window (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]. Returns false
 * otherwise (no markers / all older than the window / marker ts in the future). Call site (filter.ts): the nudge
 * fires iff `shouldNudge(recentMetrics, config) && !suppressCheck(markers.metric, markers)` — suppressCheck is
 * the §5.3 gate AFTER shouldNudge (§5.1), composing with the E22 refusal-suppression rule.
 *
 * … (GOTCHA #7 + GOTCHA #6 paragraphs UNCHANGED) …
 */
```

**`src/nudges.ts` — `NUDGE_TURN_WINDOW_MS` JSDoc (~L260) — cite §5.3 as the rule the window implements:**

```ts
// BEFORE (current, ~L260):
/**
 * NUDGE_TURN_WINDOW_MS — the heuristic time window for suppressCheck (spec/07 §2 "Edge cases": suppress if a
 * rewind/shrink marker was created "during the metric's turn"). 10 minutes: a generous bound on a single agent
 * turn's wall-clock duration. …
 */

// AFTER (target — §5.3 is the rule; §2 is the origin):
/**
 * NUDGE_TURN_WINDOW_MS — the heuristic time window for suppressCheck, which implements spec/07 §5.3 (REQUIRED,
 * hard rule: suppress the drift nudge for a turn in which the agent already rewound/shrunk). §5.3 promotes the
 * spec/07 §2 "Edge cases" ts-window heuristic to a hard rule; the window bounds "during the metric's turn" as
 * (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]. 10 minutes: a generous bound on a single agent turn's wall-clock
 * duration. …
 */
```

> The `suppressCheck` FUNCTION BODY (the `export function suppressCheck(…) { const metricTs = …; … return false; }`
> block) is **byte-identical** before and after — GOTCHA #1. Verify with the Level 4 grep.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT suppressCheck JSDoc first paragraph in src/nudges.ts (~L367)
  - OLD TEXT (the first paragraph only — the 4 lines starting "suppressCheck — Nudge B Phase 2 suppress heuristic
    (spec/07 §2 …)" through "marker ts in the future)."). REPLACE with the AFTER text above (Task's "exact before
    → after").
  - CITE §5.3 as the hard rule; RETAIN §2 as the origin ("§5.3 promotes the earlier spec/07 §2 'Edge cases'
    ts-window heuristic to a hard rule; the MECHANISM is unchanged").
  - ADD the §5.3 framing sentence (verbatim intent from spec/07 §5.3): "the drift nudge MUST NOT fire for a turn
    in which the agent already issued a mulligan:rewind or mulligan:shrink … REGARDLESS of delta or bloatHit".
  - ADD a one-line call-site note: "Call site (filter.ts): the nudge fires iff `shouldNudge(recentMetrics, config)
    && !suppressCheck(markers.metric, markers)` — suppressCheck is the §5.3 gate AFTER shouldNudge (§5.1)".
  - PRESERVE: the two "WHY a window, not a pure upper bound (GOTCHA #7)" + "WHY a structural markers param
    (GOTCHA #6)" paragraphs + the @param/@returns lines — UNCHANGED.
  - PLACEMENT: immediately above `export function suppressCheck(`. Do NOT move it.

Task 2: EDIT NUDGE_TURN_WINDOW_MS JSDoc in src/nudges.ts (~L260)
  - OLD TEXT (the first sentence): "NUDGE_TURN_WINDOW_MS — the heuristic time window for suppressCheck (spec/07 §2
    \"Edge cases\": suppress if a rewind/shrink marker was created \"during the metric's turn\")."
  - NEW: "NUDGE_TURN_WINDOW_MS — the heuristic time window for suppressCheck, which implements spec/07 §5.3
    (REQUIRED, hard rule: suppress the drift nudge for a turn in which the agent already rewound/shrunk). §5.3
    promotes the spec/07 §2 \"Edge cases\" ts-window heuristic to a hard rule; the window bounds \"during the
    metric's turn\" as (metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]."
  - PRESERVE: the "10 minutes: a generous bound…" sentence + the "EXPORTED so tests can reference the exact
    boundary" + "Best-effort by design … NOT config in v1" sentences — UNCHANGED.

Task 3: RELABEL the existing suppressCheck describe in test/drift_nudge.test.ts (~L171)
  - OLD: `describe("suppressCheck — suppress heuristic window (spec/07 §2 Edge cases)", () => {`
  - NEW: `describe("suppressCheck — §5.3 hard-rule suppress window (mechanism: ts-window; spec/07 §5.3, origin §2)", () => {`
  - KEEP: all 10 existing `it` blocks INSIDE this describe UNCHANGED (no markers / rewind at T / T−1 / boundary /
    outside / future / shrink at T / non-finite ts / any-marker / non-finite metric.ts). They prove the §5.3
    mechanism; only the label changes.

Task 4: ADD the §5.3 acceptance (a)/(b)/(c) describe in test/drift_nudge.test.ts
  - INSERT a NEW top-level `describe` IMMEDIATELY AFTER the existing suppressCheck describe (before the
    NUDGE_TURN_WINDOW_MS describe). Use this exact shape (reuses module-level rewind()/shrink(); defines its OWN
    driftWindow()/cfg() per GOTCHA #2):

        describe("suppressCheck — spec/07 §5.3 hard rule (acceptance a/b/c): drift nudge MUST NOT fire when the agent already acted", () => {
          // §5.3: "if [the marker set created during the metric's turn] is non-empty, [the drift nudge] returns
          // false for that metric REGARDLESS of delta or bloatHit". The IMPLEMENTATION delegates this to
          // suppressCheck (a separate gate AFTER shouldNudge in filter.ts:319). The §5.3 NET nudge decision is
          // `shouldNudge(recentMetrics, config) && !suppressCheck(metric, markers)` — the guard these tests
          // assert. (Pure helpers — no Pi; the spec/10 F-nudge-drift §5.3 integration scenario is the real-pi
          // mirror, already in test/integration/.)

          // A sustained-growth window whose moving average (7000) exceeds the threshold (6000) → shouldNudge true.
          // newest-first (highest seq at index 0); delta-only path (bloat irrelevant when delta data exists).
          const driftWindow = (): TurnMetric[] => [
            { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:3, ts:3, deltaTokens:7000, bloatHit:false,
              bloatHits:[], grewOverThreshold:false, turnIndex:3 } as TurnMetric,
            { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:2, ts:2, deltaTokens:7000, bloatHit:false,
              bloatHits:[], grewOverThreshold:false, turnIndex:2 } as TurnMetric,
            { schema:"pi-mulligan", v:1, kind:"turn-metric", seq:1, ts:1, deltaTokens:7000, bloatHit:false,
              bloatHits:[], grewOverThreshold:false, turnIndex:1 } as TurnMetric,
          ];
          const cfg = (): MulliganConfig =>
            ({ nudges: { driftWindowTurns: 3, driftThresholdTokens: 6000 } } as MulliganConfig);
          const latest = (): TurnMetric => driftWindow()[0]; // seq 3, ts 3 — bounds the suppress window

          it("(a) >threshold window + same-turn SHRINK → net nudge decision is FALSE (no drift nudge)", () => {
            const sameTurnShrink = shrink(1, latest().ts); // ts === metric.ts → in (ts−window, ts] → suppress
            const fire = shouldNudge(driftWindow(), cfg()) &&
                         !suppressCheck(latest(), { rewinds: [], shrinks: [sameTurnShrink] });
            expect(shouldNudge(driftWindow(), cfg())).toBe(true);           // would fire on growth alone
            expect(suppressCheck(latest(), { rewinds: [], shrinks: [sameTurnShrink] })).toBe(true); // suppressed
            expect(fire).toBe(false);                                      // §5.3 (a): net NO nudge
          });

          it("(b) >threshold window + NO action → net nudge decision is TRUE (fires normally)", () => {
            const fire = shouldNudge(driftWindow(), cfg()) &&
                         !suppressCheck(latest(), { rewinds: [], shrinks: [] });
            expect(shouldNudge(driftWindow(), cfg())).toBe(true);           // growth fires
            expect(suppressCheck(latest(), { rewinds: [], shrinks: [] })).toBe(false); // no marker → not suppressed
            expect(fire).toBe(true);                                       // §5.3 (b): fires
          });

          it("(c) >threshold window + same-turn REWIND → net nudge decision is FALSE (no drift nudge)", () => {
            const sameTurnRewind = rewind(1, latest().ts); // ts === metric.ts → in (ts−window, ts] → suppress
            const fire = shouldNudge(driftWindow(), cfg()) &&
                         !suppressCheck(latest(), { rewinds: [sameTurnRewind], shrinks: [] });
            expect(suppressCheck(latest(), { rewinds: [sameTurnRewind], shrinks: [] })).toBe(true); // suppressed
            expect(fire).toBe(false);                                      // §5.3 (c): net NO nudge
          });
        });

  - REUSE: module-level `rewind(seq,ts)` + `shrink(seq,ts)` (already imported/defined at file top). Do NOT
    re-import — they are in scope at top level.
  - GOTCHA #2: `driftWindow()`/`cfg()` are declared INSIDE this describe (not reusing the shouldNudge-scoped
    `m`/`cfg`). GOTCHA #3: the window's deltaTokens average (7000) > threshold (6000) → shouldNudge true.
  - GOTCHA #4: the asserted guard is `shouldNudge && !suppressCheck` (the real filter.ts:319 shape), NOT a
    fictional in-shouldNudge branch.

Task 5 (OPTIONAL, comments-only): ADD §5.3 traceability labels in test/filter.test.ts (L453 / L467)
  - ABOVE the `it("injects the drift nudge when shouldNudge(metric) is true and not suppressed", …)` (~L453):
    add `// §5.3 acceptance (b): >threshold + no action → fires normally (integration-level mirror).`
  - ABOVE the `it("does NOT inject the drift nudge when suppressed by a same-turn rewind marker", …)` (~L467):
    add `// §5.3 acceptance (c): >threshold + same-turn rewind → suppressed (integration-level mirror).
    //     (§5.3 acceptance (a) [shrink] is covered at the unit tier in test/drift_nudge.test.ts.)`
  - DO NOT change the assertion, the metricData/rewindData inputs, or the makeCtx harness. This is pure labeling.
  - SKIP if uncertain — the unit acceptance in drift_nudge.test.ts is the REQUIRED deliverable.

Task 6: VALIDATE
  - RUN: `npm run typecheck`   → expect exit 0 (the new tests are well-typed partial literals cast to TurnMetric,
    matching the file's existing pattern; no arity change to suppressCheck).
  - RUN: `npx vitest run test/drift_nudge.test.ts` → expect green (10 existing mechanism tests + 3 new §5.3
    acceptance tests).
  - RUN: `npx vitest run`      → expect full suite green (test COUNT +3).
  - RUN scope guard: `git diff --name-only` → expect `src/nudges.ts` + `test/drift_nudge.test.ts` (+ optionally
    `test/filter.test.ts`). NO `src/notes.ts` (T2), NO `src/filter.ts` (read-only), NO README (M5).
  - RUN body-identity guard (Level 4): `git diff src/nudges.ts` must show changes ONLY in JSDoc comment lines
    (lines starting with ` *` or `/**`/` */`), NOT in the `export function suppressCheck(…){…}` body.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the spec-citation house style (mirror the existing JSDoc on shouldNudge/shouldHighWater): the FIRST
// line names the helper + its spec section in parentheses — "(spec/07 §N …)". For suppressCheck, §5.3 is now the
// PRIMARY citation (the hard rule), §2 is the ORIGIN ("§5.3 promotes the §2 ts-window heuristic to a hard rule").
// This matches how shouldNudge's JSDoc already cites "§5.1 … REQUIRED" as its primary rule.

// PATTERN — the §5.3 acceptance test mirrors the REAL filter.ts:319 guard, not a fictional branch. §5.3 spec TEXT
// says "shouldNudge returns false for that metric" but the IMPLEMENTATION keeps shouldNudge pure (§5.1 windowed
// gate) and puts the suppress in a SEPARATE suppressCheck gate. The faithful unit-tier assertion is therefore the
// COMBINED guard:
const fires = shouldNudge(recentMetrics, config) && !suppressCheck(metric, markers);
// Asserting `fires` for (a)/(b)/(c) is the mechanism-accurate mirror of §5.3. Do NOT add a branch to shouldNudge.

// CRITICAL — the suppressCheck body is a SCOPE BOUNDARY (GOTCHA #1). The ONLY src/nudges.ts edits are the two
// JSDoc blocks. A diff that touches `const metricTs = …` / the `for (const m of …)` loops / `return false;` is a
// VIOLATION. The §5.3 "hard rule" is realized by the EXISTING ts-window mechanism; promoting it to a "hard rule"
// is a DOCUMENTATION framing (spec/07 §5.3), not a code change.

// PATTERN — build a shouldNudge-true window via deltaTokens, NOT grewOverThreshold (GOTCHA #3). shouldNudge reads
// nudges.driftWindowTurns + nudges.driftThresholdTokens and computes the moving average of finite deltaTokens:
//   const cfg = { nudges: { driftWindowTurns: 3, driftThresholdTokens: 6000 } } as MulliganConfig;
//   const window = [m(7000), m(7000), m(7000)]; // newest-first; avg 7000 > 6000 → shouldNudge true
// grewOverThreshold is computed by turnEndMetricHandler for audit/back-compat but is DELIBERATELY UNUSED by the
// gate (see shouldNudge JSDoc). Setting it true does NOT make shouldNudge fire.

// PATTERN — "same-turn" marker = marker.ts === metric.ts (GOTCHA #5). The latest metric (seq 3, ts 3) bounds the
// suppress window's upper end (inclusive). A marker created "during the metric's turn" has ts === metric.ts →
// satisfies `ts <= metricTs` (inclusive upper) and `ts > metricTs − window` → suppressCheck returns true. Mirror
// the existing drift_nudge.test.ts:179 (rewind at T) / :199 (shrink at T) which already use ts===T.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — JSDoc citation swap + additive test block (suppressCheck signature UNCHANGED).
  - DATABASE: none
  - CONFIG: none (no knob added/removed; NUDGE_TURN_WINDOW_MS stays a non-config const per its JSDoc)
  - ROUTES: none
  - CODE: filter.ts:319 (`!suppressCheck(markers.metric, markers)`) is the §5.3 enforcement — UNCHANGED (read-only
          proof). shouldNudge (§5.1) + suppressCheck (§5.3) + the E22 refused-rewind mute compose as before.
  - TESTS: +3 `it` blocks in test/drift_nudge.test.ts (the §5.3 acceptance describe); 1 describe relabel;
           OPTIONAL 2 comments in test/filter.test.ts. Test COUNT net +3. No existing `it` is deleted/rewritten.
  - DOCS: [Mode A] — the suppressCheck JSDoc (§5.3 citation + framing) + NUDGE_TURN_WINDOW_MS JSDoc ARE the doc.
          NO separate .md file. README sync is sibling P1.M5.T1.* (do NOT touch README).
```

---

## Validation Loop

A JSDoc swap + additive tests cannot change runtime behavior, but the JSDoc must cite §5.3, the new tests must
typecheck and pass, and the suppressCheck **body must stay byte-identical** (GOTCHA #1). Run all levels.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) suppressCheck's JSDoc now cites §5.3 (and retains §2 as origin):
grep -n 'spec/07 §5.3' src/nudges.ts
# Expected: ≥2 hits — the suppressCheck JSDoc first paragraph + the NUDGE_TURN_WINDOW_MS JSDoc. (Also the
#           shouldHighWater JSDoc may cite §5.2; that is unrelated. Confirm the §5.3 hits are on suppressCheck +
#           NUDGE_TURN_WINDOW_MS by reading the lines.)

# (b) the §5.3 "hard rule" framing sentence is present:
grep -nF 'MUST NOT fire for a turn in which the agent already issued' src/nudges.ts
# Expected: 1 hit — in the suppressCheck JSDoc first paragraph.

# (c) §2 is RETAINED as the origin (not deleted):
grep -nF '§5.3 promotes' src/nudges.ts
# Expected: ≥1 hit ("§5.3 promotes the … §2 … ts-window heuristic to a hard rule") in suppressCheck JSDoc, and
#           a parallel line in NUDGE_TURN_WINDOW_MS JSDoc.

# (d) the drift_nudge suppressCheck describe is relabeled to §5.3:
grep -nF '§5.3 hard-rule suppress window' test/drift_nudge.test.ts
# Expected: 1 hit (the relabeled existing describe).

# (e) the new §5.3 acceptance describe is present with all 3 acceptance letters:
grep -nE 'spec/07 §5.3 hard rule \(acceptance a/b/c\)' test/drift_nudge.test.ts
grep -nE '\(a\) >threshold window \+ same-turn SHRINK' test/drift_nudge.test.ts
grep -nE '\(b\) >threshold window \+ NO action' test/drift_nudge.test.ts
grep -nE '\(c\) >threshold window \+ same-turn REWIND' test/drift_nudge.test.ts
# Expected: 1 hit each.
```
Expected: all grep checks pass.

### Level 2: Type-check (the strict gate)

```bash
npm run typecheck        # = tsc --noEmit (strict:true; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The #1 cause of failure is referencing the shouldNudge-scoped `m`/`cfg` from the
#           new top-level §5.3 describe (GOTCHA #2 — "Cannot find name 'm'/'cfg'"). FIX by declaring driftWindow()
#           + cfg() INSIDE the new describe. A close second is a typo'd TurnMetric literal field — mirror the
#           existing `metric()` helper's field set.
```
Expected: exit 0.

### Level 3: Unit Tests (the new §5.3 acceptance + unchanged mechanism)

```bash
# The suppressCheck suite (10 existing mechanism tests, now under a §5.3-labeled describe) + the new §5.3 (a/b/c):
npx vitest run test/drift_nudge.test.ts
# Expected: all pass. The new §5.3 acceptance describe adds 3 `it` blocks (test COUNT +3 in this file). The 10
#           existing mechanism tests are UNCHANGED (only the describe label moved). shouldNudge/injectNudge/
#           NUDGE_TURN_WINDOW_MS/shouldHighWater tests UNCHANGED.

# (if Task 5 done) the integration-level §5.3 mirrors still pass (comments-only → no behavior change):
npx vitest run test/filter.test.ts
# Expected: all pass, test COUNT UNCHANGED (comments only).

# Full suite (catches any cross-file surprise — there should be none):
npx vitest run
# Expected: all files green. NET test count +3 (the §5.3 acceptance describe). NOTE: sibling T2 may also change
#           test count in drift_nudge.test.ts (injectNudge/renderDriftNudge assertion rewrites — no count change
#           there); reconcile against the merged tree when both land.
```
Expected: drift_nudge.test.ts green (+3); filter.test.ts green (if touched, unchanged count); full suite green.

### Level 4: Behavior / scope proof (the contract's hard constraints)

```bash
# (1) the suppressCheck FUNCTION BODY is byte-identical — diff shows ONLY JSDoc (comment) lines changed in src/nudges.ts:
git diff src/nudges.ts | grep -E '^[+-]' | grep -vE '^[+-]\s*\*|^[+-]\s*/\*|^[+-]\s*\*/|^[+-]$' && echo "REGRESSION — non-JSDoc line changed in src/nudges.ts" || echo "src/nudges.ts: only JSDoc changed"
# Expected: "src/nudges.ts: only JSDoc changed". (The grep excludes + lines that are JSDoc comment lines ` * …` /
#           `/**` / ` */` and blank `+`/`-` diff markers; any surviving hit is a code-line change = violation.)

# (2) suppressCheck still returns true for a same-turn marker (the §5.3 mechanism is intact) — re-run the
#     existing mechanism test by name to prove the body was not disturbed:
npx vitest run test/drift_nudge.test.ts -t 'returns true when a SHRINK marker ts is within the window'
npx vitest run test/drift_nudge.test.ts -t 'returns true when a rewind marker ts is within'
# Expected: both pass (the body is unchanged → these still pass).

# (3) the §5.3 acceptance (a)/(b)/(c) pass by name:
npx vitest run test/drift_nudge.test.ts -t 'acceptance a/b/c'
# Expected: 3 pass.

# (4) scope: only the allowed files changed:
git diff --name-only
# Expected: src/nudges.ts + test/drift_nudge.test.ts (+ optionally test/filter.test.ts if Task 5 done).
git diff --name-only | grep -vE '^(src/nudges\.ts|test/drift_nudge\.test\.ts|test/filter\.test\.ts)$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK". src/notes.ts (T2), src/filter.ts (read-only), test/notes.test.ts (T2), test/edge-cases.test.ts
#           (T2), README (M5), config, spec/*, package.json must NOT appear.
```
Expected: only JSDoc changed in src/nudges.ts; mechanism tests pass; §5.3 (a/b/c) pass; scope OK.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms §5.3 cited in suppressCheck + NUDGE_TURN_WINDOW_MS JSDoc, §2 retained as origin, the
      "MUST NOT fire … regardless of delta or bloatHit" framing present, the describe relabeled, the 3 §5.3
      acceptance `it` names present.
- [ ] Level 2: `npm run typecheck` exits 0 (strict mode clean; GOTCHA #2 — no leaked shouldNudge-scoped helper).
- [ ] Level 3: `npx vitest run test/drift_nudge.test.ts` green (+3 tests); `npx vitest run` full suite green.
- [ ] Level 4: `git diff src/nudges.ts` shows ONLY JSDoc comment lines changed (body byte-identical — GOTCHA #1);
      the 2 named mechanism tests still pass; scope guard shows only allowed files.

### Feature Validation
- [ ] `suppressCheck`'s JSDoc cites **§5.3** as the hard rule + the "regardless of delta or bloatHit" framing;
      §2 retained as the origin ("§5.3 promotes the §2 ts-window heuristic to a hard rule").
- [ ] `NUDGE_TURN_WINDOW_MS`'s JSDoc cites **§5.3** as the rule the window implements.
- [ ] The §5.3 acceptance **(a)** >threshold+shrink→no nudge, **(b)** >threshold+nothing→fires, **(c)**
      >threshold+rewind→no nudge are asserted explicitly (combined `shouldNudge && !suppressCheck` guard) and
      PASSING.
- [ ] The `suppressCheck` **function body is byte-identical** (mechanism stays ts-window — NOT seq-based; item
      contract point (c)).

### Code Quality / Scope Discipline
- [ ] The spec-citation house style is preserved (first line names helper + spec section in parentheses).
- [ ] Did NOT touch the `suppressCheck` body (GOTCHA #1), `shouldNudge` (§5.1), `renderDriftNudge`/`renderBloatReminder`
      (T1/T2), `renderHighWaterNudge`/`shouldHighWater` (§5.2), `filter.ts` (read-only call site), or README (M5).
- [ ] Did NOT change the `suppressCheck` signature or any existing `it` body (only the describe label + 3 new
      additive `it` blocks; the existing 10 mechanism tests are UNCHANGED).
- [ ] [Optional Task 5] If `test/filter.test.ts` was touched, ONLY comments were added (no assertion/input change).

### Documentation
- [ ] [Mode A] satisfied: the suppressCheck JSDoc (§5.3 citation + framing) + NUDGE_TURN_WINDOW_MS JSDoc ARE the doc.
- [ ] No separate `.md` doc file written; README not touched (sibling P1.M5.T1.* owns it).

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite `suppressCheck` to be seq-based (item contract point (c); GOTCHA #1). The spec calls suppress a
  "Simple heuristic" (spec/07 §2); §5.3 *promotes* it to a hard rule but does NOT change the mechanism. A diff
  touching the function body is a scope violation. The whole task is JSDoc + additive tests.
- ❌ Don't cite §5.3 and DELETE §2. §2 is the ORIGIN of the ts-window heuristic; §5.3 promotes it. The JSDoc must
  say "§5.3 promotes the §2 edge-case ts-window heuristic to a hard rule" — both citations, §5.3 primary.
- ❌ Don't reuse `m()`/`cfg()` from the `shouldNudge` describe in the new §5.3 describe (GOTCHA #2). They are
  `const`-declared INSIDE that describe → lexically invisible at top level → typecheck error "Cannot find name".
  Declare your own `driftWindow()`/`cfg()` inside the new describe.
- ❌ Don't make shouldNudge fire via `grewOverThreshold:true` (GOTCHA #3). The gate ignores it (P3.M3.T4.S1).
  Build a deltaTokens window whose moving average > threshold (e.g. [7000,7000,7000], threshold 6000).
- ❌ Don't assert a fictional in-shouldNudge §5.3 branch (GOTCHA #4). §5.3 spec TEXT says "shouldNudge returns
  false" but the IMPLEMENTATION keeps shouldNudge pure and puts suppress in a separate gate. Assert the REAL
  combined guard `shouldNudge && !suppressCheck` (filter.ts:319) — that is the mechanism-accurate mirror.
- ❌ Don't rely on absolute line numbers (GOTCHA #6). Sibling T2 edits test/drift_nudge.test.ts in parallel; the
  suppressCheck describe's line shifts. Locate it by its CONTENT (the describe label string).
- ❌ Don't rewrite the 10 existing mechanism tests (GOTCHA #7). They prove the ts-window boundaries — that IS the
  §5.3 mechanism. Relabel the describe; leave the `it` bodies alone. The §5.3 (a)/(b)/(c) describe is ADDITIVE.
- ❌ Don't touch `src/filter.ts` (read-only call-site proof), `src/notes.ts` (T2), `test/notes.test.ts` (T2),
  `test/edge-cases.test.ts` (T2), `test/integration/*` (the F-nudge-drift Tier-2 harness EXISTS and is not in
  scope), `renderHighWaterNudge`/`shouldHighWater` (§5.2), or README (M5).
- ❌ Don't add/remove existing tests to "balance" anything. The only count change is +3 (the new §5.3 acceptance
  describe). The mechanism describe is relabeled, not gutted.