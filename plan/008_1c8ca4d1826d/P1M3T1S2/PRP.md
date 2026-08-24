# PRP — P1.M3.T1.S2: Nudge tests — exact new tail (3 notes + 2 drift + injectNudge sites) + negative no-prescription assertion

## Goal

**Feature Goal**: Update every test that pins the OLD prescribing drift-nudge tail (`. If wasteful, \`mulligan_rewind\` … or \`mulligan_shrink\` …`) to the NEW v2.0 awareness-only tail, and add a negative assertion locking the no-prescription invariant (drift nudge output NEVER mentions `mulligan_rewind` or `mulligan_shrink`).

**Deliverable**: Modified `test/notes.test.ts` + `test/drift_nudge.test.ts`. **Test files only** — no source changes.

**Success Definition**: `npx vitest run test/notes.test.ts test/drift_nudge.test.ts` fully green; `npm run typecheck` passes; `renderBloatReminder`'s pinned prescribing phrasing (notes.test.ts:418-421) is **unchanged** (Nudge A still prescribes — that is correct and must stay).

## Contract with P1.M3.T1.S1 (predecessor, running in parallel)

S1 changes `src/notes.ts` `renderDriftNudge` (return line ~:337) and its FORMAT JSDoc so the output for every lead is:

```
<lead>. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.
```

The exact new tail, **with the leading period and the EM-DASH (—, U+2014)**, as it will appear in a JS/TS string literal:

```ts
const DRIFT_TAIL =
  ". Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.";
```

Leads are UNCHANGED by S1 (delta lead, bloat-fallback lead, totality fallback lead, and the optional ` (sustained over the last N turns)` clause insertion point). `src/nudges.ts` (`injectNudge`, `shouldNudge`, etc.) is untouched by S1. If S1 has not landed yet when you start, write the tests against the string above anyway — they will go green the moment S1 lands. If `grep "Keep this turn's outputs lean" src/notes.ts` already matches, S1 has landed; verify the exact bytes match the string above before writing tests.

## Why

v2.0 current-turn scoping makes the drift nudge awareness-only (PRD §2 Nudge B v2.0 note): it fires at the next inference about the PREVIOUS turn's growth, and past content is out of modification scope, so it must not prescribe rewind/shrink. The tests currently pin the old prescribing tail and would fail against S1's change — this item re-pins them to the new tail and adds a regression lock so the prescription can never silently come back.

## What

Exact edit sites (verified against the current tree):

### test/notes.test.ts

1. **:395-396 — module const `DRIFT_TAIL`**: replace its string value with the new tail above. This const is consumed by the `renderDriftNudge` describe (~:465+, incl. the totality-fallback `toBe("Previous turn changed your context" + DRIFT_TAIL)` at ~:518) and the fixed-tail loop — one edit fixes all `toContain(DRIFT_TAIL)` / concatenation sites.
2. **:646 — inline snapshot** (`representative drift-only nudge (~4.2k tokens)`): re-snapshot to:
   ```
   `Previous turn added ~4.2k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
   ```
   (In vitest `toMatchInlineSnapshot` — either paste the string manually or run `npx vitest run test/notes.test.ts -u` once, then review the diff.)
3. **:660 — inline snapshot** (`representative first-turn bloat-only nudge (null delta + 2 hits)`): re-snapshot to:
   ```
   `Previous turn produced 2 bloated results. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
   ```
4. **NEW negative assertion** — add inside the existing `"the tail is FIXED and present in EVERY case"` it-block (:522-534, which already loops 4 `DriftNudgeInput` cases), extending the loop body:
   ```ts
   for (const c of cases) {
     const out = renderDriftNudge(c);
     expect(out).toContain(DRIFT_TAIL);
     // P1.M3.T1.S2 — v2.0 awareness-only lock: the drift nudge NEVER prescribes rewind/shrink
     // (the reported turn is out of modification scope; only Nudge A prescribes).
     expect(out).not.toContain("mulligan_rewind");
     expect(out).not.toContain("mulligan_shrink");
   }
   ```
5. **DO NOT touch :398-437** (`renderBloatReminder` describe) — its `mulligan_shrink`/`mulligan_rewind` assertions at :419-421 are correct: Nudge A still prescribes.

### test/drift_nudge.test.ts

6. **:~243** (`does NOT append the clause when the latest single-turn delta alone explains the fire (>= threshold)`): the exact `toBe` is currently `"Previous turn added ~5k tokens to your context. If wasteful, …"` → replace the tail: `"Previous turn added ~5k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them."`
7. **:~250** (`does NOT append the clause when recentMetrics/config are omitted (back-compat…)`): same rewrite with `~0.8k tokens`.
8. **Strengthen :198-204** (`produces a non-empty string content via renderDriftNudge` in the `injectNudge` describe): it currently only checks `startsWith("Previous turn")` and no `[mulligan]` prefix. Add the tail + no-prescription assertions:
   ```ts
   expect((last.content as string)).toContain("Keep this turn's outputs lean");
   expect((last.content as string)).not.toContain("mulligan_rewind");
   expect((last.content as string)).not.toContain("mulligan_shrink");
   ```
9. Leave the sustained-clause tests (`:~221-239`, `toContain("added ~0.8k tokens to your context (sustained over the last 3 turns)")`) as-is — the lead/sustained clause is unchanged; those use `toContain` and stay green.

### Success Criteria

- [ ] `DRIFT_TAIL` const (:395-396) equals the new tail exactly (em-dash, leading `. `, trailing `.`)
- [ ] Both inline snapshots (:646, :660) re-snapshotted to the new full strings
- [ ] Negative no-prescription assertions added in the fixed-tail loop (notes.test.ts) and strengthened in the injectNudge content test (drift_nudge.test.ts)
- [ ] `renderBloatReminder` phrasing tests (:398-437) byte-identical to before
- [ ] `npx vitest run test/notes.test.ts test/drift_nudge.test.ts` → all green
- [ ] Sustained-clause and lead-variant tests untouched and green

## All Needed Context

### Documentation & References

```yaml
- file: test/notes.test.ts
  why: 3 tail sites + negative assertion + the UNTOUCHABLE bloat-reminder describe
  pattern: DRIFT_TAIL module const shared by toContain/toBe concatenation; toMatchInlineSnapshot for verbatim pins
  gotcha: :418-421 renderBloatReminder assertions must stay EXACTLY as-is (Nudge A prescribes)

- file: test/drift_nudge.test.ts
  why: 2 exact toBe tails + the injectNudge content test to strengthen
  pattern: metric()/cfgFor() literal builders; content extracted as (result[0] as Record<string, unknown>).content as string
  gotcha: imports come from ../src/nudges.js (".js" suffix — house idiom); no clearAll needed (pure tests)

- file: src/notes.ts
  why: renderDriftNudge (S1's edit target) — read to confirm the exact new tail bytes before pinning tests
  gotcha: em-dash U+2014; apostrophe in "turn's" is fine inside double-quoted vitest strings

- docfile: plan/008_1c8ca4d1826d/architecture/_scouts/tests.md §4
  why: the authoritative exact-string site inventory this PRP is built from

- docfile: plan/008_1c8ca4d1826d/P1M3T1S1/PRP.md
  why: predecessor contract — the exact new tail and the S1/S2 boundary
```

### Current Codebase tree (relevant excerpt)

```bash
src/notes.ts            # renderDriftNudge (S1 edits; you only read it)
test/notes.test.ts      # YOUR file: :395-396 DRIFT_TAIL, :522-534 loop, :646/:660 snapshots
test/drift_nudge.test.ts # YOUR file: :198-204 content test, :~243/:~250 exact toBe
```

### Known Gotchas

```python
# CRITICAL: the em-dash "—" (U+2014) — NOT "-", NOT "--". Copy byte-for-byte from src/notes.ts after S1 lands.
# CRITICAL: the tail begins with ". " (period+space) because it's appended after "<lead>" with no separator.
# GOTCHA: inline snapshots use escaped backticks only when backticks appear — the NEW tail has NO backticks
#   (unlike the old one), so the snapshot strings are plain.
# GOTCHA: run vitest with -u to auto-re-snapshot, then `git diff test/` to verify ONLY the tail changed.
# GOTCHA: if tests still fail on the tail, S1 may not have landed yet — check
#   grep -c "Keep this turn's outputs lean" src/notes.ts   # >= 2 means landed
```

## Implementation Blueprint

```yaml
Task 1: EDIT test/notes.test.ts
  - UPDATE: DRIFT_TAIL const (:395-396) → new tail
  - RE-SNAPSHOT: :646 and :660 inline snapshots (or `npx vitest run test/notes.test.ts -u`)
  - EXTEND: fixed-tail loop (:522-534) with the two `not.toContain` assertions
  - PRESERVE: everything in the renderBloatReminder describe (:398-437) byte-identical

Task 2: EDIT test/drift_nudge.test.ts
  - UPDATE: exact toBe strings at :~243 (~5k) and :~250 (~0.8k)
  - STRENGTHEN: injectNudge content test (:198-204) — toContain(new tail head) + not.toContain x2
  - PRESERVE: sustained-clause tests and all shouldNudge/suppressCheck/high-water tests

Task 3: VALIDATE (see below)
```

No data models, no integration points, no config.

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run typecheck
# Expected: zero errors
```

### Level 2: Unit Tests (the deliverable gate)

```bash
npx vitest run test/notes.test.ts test/drift_nudge.test.ts
# Expected: ALL green. If tail mismatches remain, verify src/notes.ts matches the S1 tail byte-for-byte.

# Full suite regression (other files must be unaffected):
npm test
# Expected: no NEW failures vs. before this change (pre-existing failures outside these two files
# belong to later sweep items P1.M4 — do not fix them here).
```

### Level 3: Diff audit

```bash
git diff --stat          # only test/notes.test.ts + test/drift_nudge.test.ts
git diff test/notes.test.ts | grep -c "^-.*mulligan_rewind.*whole call was a mistake" || true
# Expected for the last: 0 removals in the renderBloatReminder block; confirm the :419-421 assertions unchanged.
grep -n "whole call was a mistake" test/notes.test.ts   # still present (>=1)
```

## Final Validation Checklist

- [ ] Both test files green in isolation and no new failures suite-wide
- [ ] New tail pinned at all 5 sites (DRIFT_TAIL const, 2 snapshots, 2 exact toBe) + strengthened injectNudge test
- [ ] Negative no-prescription assertions present in both files
- [ ] renderBloatReminder phrasing tests untouched
- [ ] Sustained-clause / lead-variant tests untouched and green
- [ ] `npm run typecheck` passes
- [ ] Diff touches only the two test files

## Anti-Patterns to Avoid

- ❌ Don't "fix" `src/notes.ts` — if the rendered output doesn't match, that's S1's scope (it runs in parallel)
- ❌ Don't weaken the bloat-reminder assertions "for consistency" — Nudge A legitimately prescribes
- ❌ Don't replace the em-dash with a hyphen
- ❌ Don't sweep unrelated `by_content_includes` test sites — that is P1.M4's scope

---

**Confidence Score**: 9/10 — every edit site is pinned with exact current and target strings verified against the live tree; the only residual risk is landing before S1 (mitigated by the grep check in the contract section).