# PRP — P4.M2.T1.S2: Flip the stale bloat-armed test assertions

**Parent**: P4.M2.T1 (Demote bloatHit). This is the **SINK** item: it consumes P4.M2.T1.S1's delta-only
`shouldNudge` return and flips the **1 stale assertion** (+ 1 stale comment) that S1's change makes false, so
the full suite goes back to green. **No production code is touched.** Tests are not user-facing → **[Mode A]**
no docs/README change.

**Spec refs**: `spec/07-preventive-and-nudges.md` §5.1 (Windowed drift signaling, REQUIRED) + §2 (Edge cases),
committed `0bcaa814`. Architecture: `plan/004_d3d84055c5b2/architecture/codebase_patterns.md` §4 (the demotion)
+ §7 (test helpers).

**Depends on**: P4.M2.T1.S1 (must land first — it is what makes the assertion stale). P4.M1.T2.S3 already
landed (it shifted test line numbers; see "Line-number drift" below).

---

## Goal

**Feature Goal**: Make `test/drift_nudge.test.ts`'s `shouldNudge` truth table **match the new delta-only
semantics** shipped by P4.M2.T1.S1, and fix the one stale referencing comment in `test/filter.test.ts`. After
this, the full test suite is green again (S1 intentionally left exactly one assertion red; this item flips it
back and touches nothing else of substance).

**Deliverable**: Three surgical edits across **two test files** —
1. `test/drift_nudge.test.ts`: rename + flip the stale bloat-armed assertion at **lines 95-97**
   (`shouldNudge([m(500, true, 1)], cfg())`: `.toBe(true)` → `.toBe(false)`).
2. `test/drift_nudge.test.ts` (optional): add a clarifying comment to the no-delta fallback assertion at
   **lines 90-93** (`shouldNudge([m(null, true, 1)], cfg())` → `true`, the surviving bloat-armed path).
3. `test/filter.test.ts`: correct the stale **comment** at **line 943** ("or any window bloatHit" → bloatHit
   is a no-delta fallback only).

**NO assertion changes in `test/filter.test.ts`** (all its drift-nudge injection tests are delta-driven —
verified; see Context). **NO changes in `test/nudges.test.ts`** (zero `shouldNudge` references — verified).

**Success Definition**:
- `npm test` (= `vitest run`) is **fully green** — S1's one red case is now green, and nothing else changed
  color.
- `npx tsc --noEmit` is green (test-file edits are type-neutral).
- The `shouldNudge` describe block in `test/drift_nudge.test.ts` reads as a correct delta-only truth table:
  single spike `[8k,0.5k,0.5k]`→false; sustained `[7k,7k,7k]`→true; **bloat with delta `[500,true]`→false
  (the flip)**; no-delta bloat `[null,true]`→true (the fallback, unchanged); empty→false; malformed→false.
- `git diff` shows **only** the two test files (drift_nudge.test.ts, filter.test.ts) — no production code.

## User Persona

**Target User**: Maintainer of the Mulligan drift-nudge test suite. **[Mode A]** — no user-facing surface; the
test titles/comments ARE the documentation that rides with this work.

**Use Case**: A future reader of `test/drift_nudge.test.ts` must be able to read the truth table and
immediately understand that bloat does NOT arm the drift nudge when delta data exists (and that bloat remains
a no-delta fallback). The current flipped-around assertion + stale filter comment would actively mislead them.

---

## Why

- P4.M2.T1.S1 removed the `|| bloatHit` arm from `shouldNudge`'s delta-available return. That is spec-correct
  (spec/07 §5.1: "The firing condition is delta-only when delta data is available … The earlier `|| bloatHit`
  arm is dropped"). But it makes **one** existing assertion false:
  `shouldNudge([m(500, true, 1)], cfg())` was `.toBe(true)` (bloat armed the delta path) and is now `.toBe(false)`.
- S1 ships its code change **with that one assertion intentionally red** (it is correct new behavior) and hands
  the flip to this item. S2 is what makes the tree green again.
- The stale comment in `test/filter.test.ts` (line 943: "or any window bloatHit") describes the OLD semantics
  and would mislead a reader into thinking filter.ts relies on bloat-arming — it does not (all its injection
  tests are delta-driven). Leaving it stale undermines the point of the demotion.
- This item closes the M2.T1 tree (S1 code + S2 tests); M3 (README sync) depends on M1, not on this.

## What

- **User-visible behavior**: none (test-only).
- **Technical requirement**: edit `test/drift_nudge.test.ts` (flip 1 assertion, optionally annotate 1) and
  `test/filter.test.ts` (fix 1 comment). See Blueprint for the exact diffs.

### Success Criteria

- [ ] `test/drift_nudge.test.ts`: the `it("fires on bloatHit even when the windowed average is below
      threshold", …)` case is renamed and its `.toBe(true)` is `.toBe(false)`.
- [ ] `test/drift_nudge.test.ts`: the no-delta fallback case `shouldNudge([m(null, true, 1)], cfg())` → `true`
      stays green and is labeled as the fallback path.
- [ ] `test/filter.test.ts`: line 943's comment no longer claims "or any window bloatHit" as a firing arm.
- [ ] `npm test` fully green; `npx tsc --noEmit` green.
- [ ] `git diff --stat` touches exactly the two test files (no `.ts` under `src/`).

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this
successfully?_ **Yes** — the exact current text of every line to change (with verified current line numbers),
the exact replacement text, the verified scan results for the two other test files (why they need no
assertion change), and the exact validation commands are all pinned below.

### Documentation & References

```yaml
# MUST READ — the spec authority for the new (delta-only) semantics this item's tests must reflect
- url: spec/07-preventive-and-nudges.md §5.1 (Windowed drift signaling, REQUIRED)
  why: "The firing condition is delta-only when delta data is available: avg(window.deltaTokens) >
       driftThresholdTokens. The earlier || bloatHit arm is DROPPED. bloatHit remains a firing condition ONLY
       in the no-delta fallback (first turn / post-reload)." Acceptance (c): "a single large result
       (>threshold) with ~0 net growth does NOT fire the drift nudge" — this is exactly the [500,true]→false
       case this item codifies.
- url: spec/07-preventive-and-nudges.md §2 (Nudge B — Edge cases)
  why: "First turn / post-reload … shouldNudge falls back to bloatHit-only signaling. This is the ONLY path on
       which bloatHit fires the drift nudge." — this is the [null,true]→true case that MUST stay green.

# Architecture research (verified against HEAD) — the demotion contract
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§4 nudges.ts — the bloatHit demotion (P4.M2.T1)"
  why: Pins the S1 change: line 323 → `return avg > config.nudges.driftThresholdTokens;` (|| arm removed); the
        `deltas.length === 0` fallback (line 321) is UNCHANGED. The truth table in §7 is what these tests assert.

# The SIBLING/PREREQUISITE PRP — defines EXACTLY what shouldNudge returns after S1 lands
- file: plan/004_d3d84055c5b2/P4M2T1S1/PRP.md
  why: S1 is the source item (the one-line code change + JSDoc rewrite in src/nudges.ts). S1's "Implementation
        Patterns" section prints the post-change truth table that S2's assertions must mirror. S1 explicitly
        leaves `shouldNudge([m(500,true,1)],cfg())` red and assigns the flip to THIS item. Read it as a
        CONTRACT: assume S1 landed exactly as specified.

# THE FILE TO EDIT (primary) — drift_nudge.test.ts
- file: test/drift_nudge.test.ts
  why: The `describe("shouldNudge — windowed drift gate (spec/07 §5.1)", …)` block holds the truth table.
        Helpers: `m(deltaTokens, bloatHit=false, seq=1)` and `cfg(windowTurns=3, threshold=6000)` (top of the
        block). The STALE assertion is the `it("fires on bloatHit even when the windowed average is below
        threshold", …)` case; the no-delta fallback is the `it("fires when ANY window metric has bloatHit
        (independent of the windowed delta) — bloat-only", …)` case.
  pattern: Pure-function tests — NO Pi fakes, NO setConfig, NO clearAll. Just `shouldNudge([...], cfg())`
        with hand-built minimal TurnMetric literals. Match the existing terse one-line `// comment` style.
  gotcha: Line numbers in the item contract (90-92 / 86-88) are STALE (P4.M1.T2.S3 shifted them down). The
        CURRENT lines are 95-97 (stale) and 90-93 (fallback). Match by the exact `it(...)` TITLE + `m(...)`
        call text — the `edit` tool keys on text, so this is robust. Do NOT key off the contract's line numbers.

# THE FILE TO EDIT (secondary, comment-only) — filter.test.ts
- file: test/filter.test.ts
  why: The ONLY stale thing here is a COMMENT at line 943 inside the
        `// ── P3.M3.T6.S1: windowed drift-nudge wiring` banner. It says shouldNudge's behavior is "moving
        average > threshold, or any window bloatHit" — the "or any window bloatHit" half is now false. Fix the
        wording. NO assertion in this file changes (all drift-nudge injection tests are delta-driven — see
        "Known Gotchas").
  pattern: The `metricData(seq, grew=false, bloat=false)` helper (line 81) sets `deltaTokens: grew ? 7000 :
        100`. Every drift-nudge injection test (lines 453, 482, 490, 947, 965) calls it with `bloat=false`
        (default) and relies on the delta — so none assert bloat-arming and none go stale.
  gotcha: Do NOT "correct" any assertion here — there is nothing to correct. Only the comment at line 943.

# THE FILE THAT NEEDS NO CHANGE — nudges.test.ts (scan-and-skip)
- file: test/nudges.test.ts
  why: `grep -c shouldNudge test/nudges.test.ts` → 0. The entire file tests Nudge A (bloatReminderHandler,
        registerBloatReminder, bloatThresholdFor) — a DIFFERENT nudge, unrelated to the drift-nudge bloatHit
        arm. There is no stale bloat-armed drift-nudge assertion here. Document this and move on; do not edit.
```

### Current Codebase tree (the relevant slice)

```bash
test/
  drift_nudge.test.ts   # EDIT: flip 1 assertion (L95-97) + optional comment on fallback (L90-93)
  filter.test.ts        # EDIT: comment-only fix at L943
  nudges.test.ts        # READ-ONLY — verified no shouldNudge refs (Nudge A only)
src/
  nudges.ts             # READ-ONLY here — S1 already changed it (do NOT touch in this item)
```

### Desired Codebase tree with files to be edited

```bash
test/drift_nudge.test.ts   # EDIT (flip + optional comment)
test/filter.test.ts        # EDIT (comment wording only)
# NO new files. NO src/ changes. NO README/config change ([Mode A] — tests are not user-facing).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL (line-number drift): the item contract cites L90-92 (stale) / L86-88 (fallback) / ~L919 (filter
//   comment). The CURRENT tree has these at L95-97 / L90-93 / L943 (P4.M1.T2.S3's test additions shifted
//   everything down). The `edit` tool matches by EXACT TEXT, so this is harmless — but key off the exact
//   it(...) title strings + m(...) calls reproduced in the Blueprint, NOT off the contract's line numbers.

// CRITICAL (what stays GREEN): these four cases must NOT change and must stay green after S1+S2:
//     "does NOT fire on a single heavy turn amid small turns — [8k,0.5k,0.5k]" → false   (avg 3000 < 6000)
//     "fires on sustained growth whose windowed average exceeds threshold — [7k,7k,7k]" → true (avg 7000>6000)
//     "fires when ANY window metric has bloatHit … bloat-only" ([null,true]) → true      (NO-DELTA fallback)
//     empty / all-null-no-bloat / window-slicing / malformed-delta → as-is
//   If any of these change color, you edited the wrong line — revert.

// CRITICAL (filter.test.ts needs NO assertion change): metricData(seq, grew, bloat) sets
//   `deltaTokens: grew ? 7000 : 100` and every drift-nudge injection test passes bloat=false (default). So:
//     L453 metricData(1,true)        → delta 7000 > 6000 → fires on DELTA (not bloat) → GREEN after S1
//     L482 metricData(1,false,false) → delta 100 < 6000, bloat false → no fire → GREEN
//     L490 metricData(1,true)        → delta 7000 > 6000 (would fire), suppressed by rewindRefusedTurnIndex
//                                     → GREEN (suppression, not bloat)
//     L947 [7000,100,100]            → avg 2400 < 6000 → no fire → GREEN
//     L965 [7000,7000,7000]          → avg 7000 > 6000 → fire → GREEN
//   NONE assert "bloat fires when delta exists". Only the L943 COMMENT is stale.

// CRITICAL (nudges.test.ts is a false lead): it has ZERO shouldNudge references (grep -c → 0). The whole file
//   tests Nudge A (bloatReminderHandler / bloatThresholdFor). Do not edit it. Document the scan result.

// GOTCHA (build/test commands): package.json has NO `npm run build`. Type-check = `npx tsc --noEmit`
//   (typescript ^5 devDep; tsconfig includes test files). Tests = `npm test` (vitest run). Test-file edits are
//   type-neutral (no signature/shape change) so tsc stays green; vitest is the real gate.

// GOTCHA (the optional comment edit): the item contract says "keep it, optionally add a comment that it is
//   the fallback path". The existing L90-93 case ALREADY has `// all deltas null (first turn / post-reload),
//   one bloatHit → true.` — so it is already self-documenting. The OPTIONAL enhancement is to relabel the
//   it(...) TITLE from "fires when ANY window metric has bloatHit (independent of the windowed delta)" to
//   something that flags it as the NO-DELTA fallback (the word "independent" is slightly misleading now).
//   If you do relabel, keep the assertion body byte-for-byte identical (still .toBe(true)).
```

---

## Implementation Blueprint

### Data models / structure

None. No types, no helpers, no new functions. This item edits test assertion bodies, a test title, and one
comment line. The `m()` / `cfg()` / `metricData()` helpers are unchanged.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT test/drift_nudge.test.ts — FLIP the stale bloat-armed assertion (current lines 95-97)
  - FIND (exact current text — match by this, not by line number):
        it("fires on bloatHit even when the windowed average is below threshold", () => {
          expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);
        });
  - REPLACE WITH (rename the title + flip the expectation; add a one-line rationale comment matching the
        block's terse style):
        it("does NOT fire on bloatHit when delta data exists and average is below threshold (P4.M2.T1)", () => {
          // bloatHit no longer arms the delta-available path (P4.M2.T1.S1 / spec/07 §5.1); deltas=[500],
          // avg 500 < 6000 → false. Only the no-delta fallback (next case) fires on bloat.
          expect(shouldNudge([m(500, true, 1)], cfg())).toBe(false);
        });
  - PRESERVE: the `m` and `cfg` helper signatures; every OTHER case in this describe block byte-for-byte.
  - VERIFY (post-edit): `npx vitest run test/drift_nudge.test.ts -t "windowed drift gate"` is fully GREEN.

Task 2: EDIT test/drift_nudge.test.ts — (OPTIONAL) relabel the no-delta fallback case as the fallback path
  - FIND (exact current text — current lines 90-93):
        it("fires when ANY window metric has bloatHit (independent of the windowed delta) — bloat-only", () => {
          // all deltas null (first turn / post-reload), one bloatHit → true.
          expect(shouldNudge([m(null, true, 1)], cfg())).toBe(true);
        });
  - REPLACE WITH (sharpen the title so it reads as the FALLBACK; keep the assertion IDENTICAL — still true):
        it("fires on bloatHit ONLY in the no-delta fallback (first turn / post-reload) — bloat-only", () => {
          // all deltas null → deltas.length===0 → bloat fallback arm (the ONLY surviving bloat path).
          expect(shouldNudge([m(null, true, 1)], cfg())).toBe(true);
        });
  - GOTCHA: the assertion body MUST stay `.toBe(true)` — this is the surviving bloat-armed path. Only the title
        + comment wording change. If you are unsure, SKIP this task entirely (the case is already green and
        already has a passable comment) — it is strictly optional polish.

Task 3: EDIT test/filter.test.ts — FIX the stale comment at line 943
  - FIND (exact current text — inside the `// ── P3.M3.T6.S1: windowed drift-nudge wiring` banner):
        // shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, or any window bloatHit) is
  - REPLACE WITH:
        // shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, delta-only when delta
        // data exists; bloatHit is a no-delta fallback only — P4.M2.T1 / spec/07 §5.1) is
  - PRESERVE: the surrounding banner lines (941, 942, 944, 945) and every assertion in this file byte-for-byte.
  - GOTCHA: this is a COMMENT-only edit. Do NOT change any `expect(...)` in filter.test.ts — there is nothing
        to fix (all injection tests are delta-driven; see Known Gotchas).
```

### Implementation Patterns & Key Details

```ts
// ── The truth table this describe block must read as AFTER Tasks 1-2 (driftWindowTurns:3, threshold:6000) ──
//   [8000,500,500]  bloat false → deltas avg 3000 < 6000            → false   (single spike) ✓ unchanged
//   [7000,7000,7000] bloat false → deltas avg 7000 > 6000           → true    (sustained)    ✓ unchanged
//   [null] bloat true            → deltas len 0 → FALLBACK          → true    (first turn)   ✓ unchanged
//   [500]  bloat true            → deltas avg 500 < 6000, no || arm → false   (← was true; Task 1 FLIP) ⚠
//   []                            → deltas len 0 → FALLBACK (empty) → false                   ✓ unchanged
//   [null] bloat false           → deltas len 0 → FALLBACK          → false                   ✓ unchanged
//   malformed deltaTokens        → dropped → deltas len 0/1 path    → false                   ✓ unchanged

// ── Task 1 diff (drift_nudge.test.ts) ────────────────────────────────────────────────────────────────
// BEFORE:
//   it("fires on bloatHit even when the windowed average is below threshold", () => {
//     expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);
//   });
// AFTER:
//   it("does NOT fire on bloatHit when delta data exists and average is below threshold (P4.M2.T1)", () => {
//     // bloatHit no longer arms the delta-available path (P4.M2.T1.S1 / spec/07 §5.1); deltas=[500],
//     // avg 500 < 6000 → false. Only the no-delta fallback (next case) fires on bloat.
//     expect(shouldNudge([m(500, true, 1)], cfg())).toBe(false);
//   });

// ── Task 3 diff (filter.test.ts, comment only) ──────────────────────────────────────────────────────
// BEFORE (line 943):
//   // shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, or any window bloatHit) is
// AFTER (wrapped to the block's ~110-col comment width):
//   // shouldNudge. shouldNudge's OWN windowed behavior (moving average > threshold, delta-only when delta
//   // data exists; bloatHit is a no-delta fallback only — P4.M2.T1 / spec/07 §5.1) is
```

### Integration Points

```yaml
DATABASE: none.
CONFIG: none — reads no knobs; tests hand-build cfg() literals.
ROUTES/EVENTS: none — test-file edits only; src/nudges.ts is owned by P4.M2.T1.S1 (already landed).
PERSISTENCE: none.
DOCUMENTATION: [Mode A] — tests are not user-facing. The test titles + comments ARE the in-repo doc that rides
  with this work. No README/config-table change.
```

---

## Validation Loop

### Level 1: Syntax & Type (after the edits)

```bash
npx tsc --noEmit          # the only type-check (no `npm run build` script). Test-file edits are type-neutral.
# Expected: zero errors. (No signature/shape/export change — assertions + a comment only.)
```

### Level 2: Targeted test run (the shouldNudge gate — must be FULLY green now)

```bash
# After Task 1, the previously-red case is green and the whole gate block passes.
npx vitest run test/drift_nudge.test.ts -t "windowed drift gate"
# Expected: ALL PASS — [8k,0.5k,0.5k]→false, [7k,7k,7k]→true, [null,true]→true (fallback), [500,true]→false
#   (the flip), empty→false, all-null-no-bloat→false, window-slicing, malformed-delta.
#   If [500,true] is STILL true or [null,true] became false, you edited the wrong line — revert and re-match
#   by the exact it(...) title text in the Blueprint.
```

### Level 3: Full-suite regression (the real gate — S1's red case is now green)

```bash
npm test                  # = vitest run
# Expected: FULLY GREEN. S1 left exactly ONE red case (the [500,true] assertion in test/drift_nudge.test.ts);
#   this item flips it back to green. NO other test should change color. If ANY other test changed color, STOP
#   — that is collateral (e.g. you accidentally edited a shouldNudge body in src/, or flipped the wrong
#   assertion). Revert and re-check.
```

### Level 4: Diff inspection (deterministic — confirms surgical scope)

```bash
# (a) Only the two test files changed (NO src/ changes):
git diff --stat
# Expected: exactly two files — test/drift_nudge.test.ts, test/filter.test.ts. Zero files under src/.

# (b) The flip landed (and is the only .toBe change in drift_nudge.test.ts):
git diff test/drift_nudge.test.ts | grep -E '^\+.*\.toBe\(|^-.*\.toBe\('
# Expected: exactly ONE removed `-    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(true);` and ONE added
#   `+    expect(shouldNudge([m(500, true, 1)], cfg())).toBe(false);`. The [null,true]→true assertion is
#   UNCHANGED (it must NOT appear as a .toBe diff unless you did the optional Task 2 title relabel, in which
#   case the .toBe(true) line itself stays identical and only the it(...) title/comment lines show).

# (c) The no-delta fallback assertion body is INTACT (still .toBe(true)):
grep -n "shouldNudge(\[m(null, true, 1)\], cfg())).toBe(true)" test/drift_nudge.test.ts
# Expected: exactly ONE match.

# (d) filter.test.ts changed a COMMENT only (no expect(...) line touched):
git diff test/filter.test.ts | grep -E '^\+.*expect\(|^-.*expect\('
# Expected: ZERO matches (no assertion changed). The diff should show only `+`/`-` comment lines around L943.

# (e) src/nudges.ts is UNTOUCHED by this item:
git diff --stat src/nudges.ts
# Expected: empty (S1 owns src/nudges.ts; this item must not touch it).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes (zero errors; test-file edits are type-neutral).
- [ ] `npm test` is **fully green** (S1's one red case flipped back; nothing else changed color).
- [ ] `git diff --stat` touches exactly `test/drift_nudge.test.ts` + `test/filter.test.ts` (zero `src/`).

### Feature Validation (spec/07 §5.1 truth table)
- [ ] `shouldNudge([m(500, true, 1)], cfg())` asserts `.toBe(false)` (the flip — bloat no longer arms delta).
- [ ] `shouldNudge([m(null, true, 1)], cfg())` asserts `.toBe(true)` (no-delta fallback — UNCHANGED).
- [ ] `[8k,0.5k,0.5k]`→false and `[7k,7k,7k]`→true cases are green and byte-for-byte unchanged.
- [ ] `test/filter.test.ts` line 943 comment no longer claims "or any window bloatHit" as a firing arm.

### Code Quality Validation
- [ ] Only test files modified (drift_nudge.test.ts, filter.test.ts); no production code.
- [ ] The flipped test title clearly states the NEW behavior ("does NOT fire on bloatHit when delta data
      exists …"), not the old one.
- [ ] The no-delta fallback assertion body is identical (still `.toBe(true)`) — only title/comment may differ.
- [ ] `test/nudges.test.ts` was scanned and correctly left untouched (zero `shouldNudge` refs — Nudge A only).

### Documentation
- [ ] [Mode A] the test titles + comments are the in-repo doc; no README/config-table change made.

---

## Anti-Patterns to Avoid

- ❌ Don't edit `src/nudges.ts` — that is **P4.M2.T1.S1's** file (already landed). This item is test-only.
- ❌ Don't flip the WRONG assertion — the stale one is the **`[500, true, 1]`** case ("fires on bloatHit even
  when the windowed average is below threshold"). The `[null, true, 1]` case STAYS `.toBe(true)` (it is the
  no-delta fallback, the only surviving bloat-armed path). They look similar — match by the exact `m(...)`
  call, not by eyeballing "bloatHit".
- ❌ Don't change any `expect(...)` in `test/filter.test.ts` — there is nothing stale there (all injection tests
  are delta-driven; `metricData` sets `deltaTokens: grew ? 7000 : 100` with `bloat=false`). Only the **comment**
  at line 943 is stale.
- ❌ Don't "fix" `test/nudges.test.ts` — it has zero `shouldNudge` references (it tests Nudge A /
  bloatReminderHandler). There is no stale drift-nudge assertion there to correct.
- ❌ Don't key off the item contract's line numbers (L90-92 / L86-88 / ~L919) — they predate P4.M1.T2.S3's test
  additions and are shifted. The CURRENT lines are L95-97 / L90-93 / L943. Match by the exact `it(...)` title +
  `m(...)` / comment text in the Blueprint; `edit` keys on text, so line drift is harmless.
- ❌ Don't run `npm run build` (there is no such script). Use `npx tsc --noEmit` + `npm test`.
- ❌ Don't broaden scope to the high-water nudge, suppressCheck, or E22 backstops — those are unrelated nudges.ts
  surfaces owned by other items.

---

**Confidence Score: 10/10** for one-pass success. This is a single assertion flip (`.toBe(true)` →
`.toBe(false)` + a title rename), one optional title/comment polish on the already-green fallback case, and one
comment-wording fix — all pinned to exact current text (with the line-number drift explicitly called out), a
verified "no assertion goes stale" result for filter.test.ts (delta-driven `metricData`), a verified "no change
needed" result for nudges.test.ts (zero `shouldNudge` refs), and a deterministic `git diff` scope check. The
only implementation judgment is *not* over-editing (leave the fallback assertion body, the other gate cases,
and all of filter.test.ts's assertions alone) — which the gotchas and anti-patterns make explicit.