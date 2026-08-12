# PRP — P1.M1.T2.S1: Rewrite `renderHighWaterNudge` to awareness-only text (BUG-002 fix)

---

## Goal

**Feature Goal**: Fix BUG-002 — `renderHighWaterNudge` (src/nudges.ts:534–543) prescribes `mulligan_shrink`/`mulligan_rewind` in BOTH return paths, contradicting spec/07 §5.2 v1.1 note ("its prescription is pure awareness, not rewind/shrink"). The high-water signal measures TOTAL filtered context (including user pastes the guardrail protects from rewind), so prescribing rewind/shrink is misaligned and re-couples the D10-separated signals. Rewrite both return strings to be **awareness-only** (report fill level + suggest reviewing recent output, never naming a tool), update the JSDoc, update the two tests that assert the old prescription, and update the README quote.

**Deliverable**:
1. `src/nudges.ts` (MODIFY) — change the two return strings in `renderHighWaterNudge` (lines 539, 542) to awareness-only text; update the JSDoc (lines ~517–522) to drop "recommends mulligan_shrink/mulligan_rewind" and document the awareness-only contract per spec/07 §5.2 v1.1 note. Signature/types/mechanism (`injectHighWaterNudge`) UNCHANGED.
2. `test/drift_nudge.test.ts` (MODIFY) — in the `renderHighWaterNudge` describe block (line 487): flip the two `toContain("mulligan_shrink"/"mulligan_rewind")` assertions to `not.toContain` + assert the awareness content; flip the fallback test's `toContain("mulligan_shrink")` to `not.toContain` both tools. Rounding test unchanged.
3. `README.md` (MODIFY) — line 233: replace the inline-quoted old nudge text with the new awareness-only example.

**Success Definition**:
- `renderHighWaterNudge(70000, 100000)` returns a string containing `~70%` and `[mulligan]` but **NOT** `mulligan_rewind` or `mulligan_shrink`.
- `renderHighWaterNudge(140000, 0)` (fallback) returns a string with **NO** `%` and **NOT** `mulligan_rewind`/`mulligan_shrink`.
- The string `'mulligan_rewind'`/`'mulligan_shrink'` does NOT appear anywhere in `renderHighWaterNudge` (grep guard on the function).
- `npx vitest run test/drift_nudge.test.ts` — all pass (updated renderHighWaterNudge tests; rounding + fallback green). `npx vitest run test/filter.test.ts` — high-water integration (~70%) STILL passes (unchanged). `npx vitest run` — full suite passes. `npx tsc --noEmit` — no new errors.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + the agent receiving the high-water annotation (and the human reading the README to understand it).

**Use Case**: The agent's filtered context crosses `highWaterFraction` (default 0.7) — possibly because the *user* pasted a large reference doc. The annotation should make the agent AWARE the window is filling, not tell it to rewind/shrink (which can't legitimately shed user ground-truth input).

**User Journey**: Total filtered context crosses 0.7 → `shouldHighWater` returns true → `contextHandler` calls `injectHighWaterNudge` → `renderHighWaterNudge` now returns `[mulligan] Context is at ~70% of the window; review recent output for reclaimable space.` → the agent sees awareness (and can decide — e.g. audit/shrink its OWN output) without being told to rewind/shrink user content.

**Pain Points Addressed**: Today the high-water nudge tells the agent to `mulligan_rewind`/`mulligan_shrink` even when the bloat is a user paste the guardrail forbids rewinding and the agent shouldn't shrink — misaligned advice that re-couples the D10-separated "agent should shed" (delta) vs "window is full" (total) signals.

## Why

- **Business value / user impact**: Major (BUG-002). The high-water nudge is a core preventive feature; its text directly drives agent behavior. Wrong advice (rewind/shrink on user-attributable bloat) is actively harmful (it nudges toward actions the guardrail blocks / that destroy ground-truth input).
- **Integration with existing features**: `renderHighWaterNudge` is consumed by `injectHighWaterNudge` (src/nudges.ts:555+) → `contextHandler` (filter.ts). The fix is text-only (same signature, same return type, same `[mulligan]` prefix, same rounded percentage, same injection mechanism); no handler/tool/guard change. The drift nudge (`renderDriftNudge`) and bloat reminder (`renderBloatReminder`) legitimately keep their tool-name references — ONLY the high-water signal is awareness-only.
- **Problems this solves and for whom**: For the agent — correct, non-misaligned awareness. For maintainers — code/test/README/spec consistency: spec/07 §5.2 v1.1 note is the authority; the code finally matches it.
- **Scope boundary (CRITICAL)**: This task is `renderHighWaterNudge` text + its JSDoc + its 2 tests + the README quote ONLY. The previous PRP (P1.M1.T1.S1) touches `spec/07 §5.1` + a `nudges.ts` comment block (~296–306) + drift tests (~128–143) — **NON-OVERLAPPING regions** (see GOTCHA #7). `shouldHighWater`, `injectHighWaterNudge`, the drift/bloat renderers, config defaults, and spec/07 §5.2 itself are UNCHANGED.

## What

User-visible behavior: the high-water annotation changes wording from a rewind/shrink prescription to an awareness suggestion. It still fires edge-triggered at the same fraction, still reports `~<pct>%`, still has the `[mulligan]` prefix, still costs ~25–40 tokens, still is ephemeral/non-persisted. No other nudge or feature changes.

### Success Criteria

- [ ] `renderHighWaterNudge` percentage path returns `` `[mulligan] Context is at ~${pct}% of the window; review recent output for reclaimable space.` `` (was `…Consider mulligan_shrink or mulligan_rewind to reclaim space.`).
- [ ] Fallback path (`windowTokens <= 0`) returns `"[mulligan] Context is filling up; review recent output for reclaimable space."`.
- [ ] Neither return string contains `mulligan_rewind` or `mulligan_shrink`.
- [ ] JSDoc no longer says "recommends mulligan_shrink/mulligan_rewind"; documents awareness-only per spec/07 §5.2 v1.1 note; the PINNED-format example matches the new text.
- [ ] test/drift_nudge.test.ts: the two `toContain("mulligan_shrink")`/`toContain("mulligan_rewind")` assertions are flipped to `not.toContain` (and the awareness content asserted); the fallback test flips its `toContain("mulligan_shrink")`.
- [ ] README.md:233 inline-quoted nudge text matches the new awareness-only example.
- [ ] `npx vitest run`, `npx tsc --noEmit` pass (no new errors). `test/filter.test.ts` ~70% integration test unchanged + green.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim current text of both return strings, the verbatim JSDoc lines, the verbatim test assertions to flip, the verbatim README quote, the exact replacement strings, the spec/07 §5.2 v1.1 authority quote, and a grep guard. The implementer needs only to open `src/nudges.ts`, `test/drift_nudge.test.ts`, and `README.md`.

### Documentation & References

```yaml
# MUST READ — the function being fixed (body + JSDoc + the injection caller, all in this file)
- file: src/nudges.ts
  why: "THE file. renderHighWaterNudge = lines 534–543 (body). JSDoc = lines ~515–533 (the 'recommends mulligan_shrink/mulligan_rewind' claim is ~line 518; the PINNED-format example ~519–521). injectHighWaterNudge (555+) calls renderHighWaterNudge + wraps — UNCHANGED (only text changes)."
  pattern: "PERCENTAGE path (line 542): return \\`[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.\\`;
            FALLBACK path (line 539, inside if (!(windowTokens > 0))): return \"[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.\";"
  gotcha: "KEEP: the signature, the if (!(windowTokens > 0)) guard, Math.round pct, the [mulligan] prefix, ~25–40 token budget, PURE/never-throws. CHANGE: only the two return STRINGS. Do NOT touch renderDriftNudge/renderBloatReminder/injectNudge/injectHighWaterNudge/shouldHighWater — those legitimately reference tools (drift + bloat prescribe rewind/shrink CORRECTLY; only high-water is awareness-only)."

# MUST READ — the authoritative spec (the code must match this; NO spec edit by this task)
- file: spec/07-preventive-and-nudges.md
  why: "§5.2 v1.1 note (~line 172, inside the §5 'Drift-nudge refinements' D10 note) is the AUTHORITY: '...the high-water signal (§5.2) still measures *total* filtered context and will still fire on such a paste (correctly — the window genuinely is filling), but its prescription is pure awareness, not rewind/shrink. This cleanly separates \"the agent should shed something\" (delta, agent-attributable) from \"the window is getting full\" (high-water, total).' §5.2 itself ('Edge-triggered high-water signal', ~line 175) defines the edge-trigger semantics — also already correct, NOT edited."
  critical: "The previous PRP (P1.M1.T1.S1) edits §5.1's drift `>` → `>=`. This task does NOT edit spec/07 (§5.2 is the authority the code is being made to match). No overlap. Do NOT touch §5.1."

# MUST READ — the confirmed bug write-up (verbatim buggy lines + fix approach)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/bug_analysis.md
  why: "§BUG-002 quotes the exact buggy lines (534–543), cites the spec/07 §5.2 v1.1 authority, explains WHY it matters (high-water fires on user pastes; guardrail spec/13 §1 protects user messages from rewind; D10 separates delta vs total), and gives the suggested awareness-only text for both paths (the PRP's target strings). Also lists the affected tests (drift_nudge.test.ts:492–496)."
  critical: "Confirms the fix is TEXT-ONLY: retain [mulligan] prefix + percentage + Math.round; drop the tool prescription; ~25–40 tokens; do NOT touch the injection mechanism or shouldHighWater."

# MUST READ — the test file (the two tests to update)
- file: test/drift_nudge.test.ts
  why: "THE test file. describe block 'renderHighWaterNudge — one-line annotation (spec/07 §5.2)' at line 487. Test 1 (488–498): asserts toContain('~70%'), toContain('[mulligan]'), toContain('mulligan_shrink') (line 495), toContain('mulligan_rewind') (line 496) — the last two FLIP to not.toContain. Test 2 (rounding ~500–503): toContain('~75%')/'~67%' — UNCHANGED. Test 3 (fallback ~506–512): asserts not.toContain('%') + toContain('mulligan_shrink') (line ~511, '// still recommends the tools') — FLIP to not.toContain both tools."
  pattern: "Flip: expect(s).toContain('mulligan_shrink') → expect(s).not.toContain('mulligan_shrink'); same for 'mulligan_rewind'. Add: expect(s).toContain('review recent output') to assert the awareness content landed. Keep: ~70%, [mulligan], non-empty, no-throw, not.toContain('%') for fallback."
  gotcha: "Test 2 (rounding) is UNCHANGED — it only asserts ~XX%, which the new text still contains. Do NOT touch it."

# MUST READ — the integration test (UNCHANGED — verify, don't edit)
- file: test/filter.test.ts
  why: "Lines 955–967: 'the high-water nudge text reports ~70% (Math.round(700/1000*100)=70)'. It asserts customType 'mulligan:high-water', content is a string, content contains '~70%', display:false. It does NOT assert the prescription text → it stays GREEN after the text change. Verified by reading 950–970."
  critical: "Do NOT edit this test. Running it post-fix CONFIRMS the integration path (contextHandler → injectHighWaterNudge → renderHighWaterNudge) still works and still reports ~70%."

# MUST READ — the README quote to update
- file: README.md
  why: "Line 233 (the 'High-water signal' feature blurb) quotes the EXACT old nudge inline: '([mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.)'. Replace the quoted text with the new awareness-only example. The surrounding descriptive sentence stays."
  gotcha: "The previous PRP touches README line 98 (driftThresholdTokens) — marked UNCHANGED there. This task touches line 233 (high-water). No overlap."

# CONTEXT — the previous task's contract (non-overlapping; confirms line-drift note)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/P1M1T1S1/PRP.md
  why: "CONTRACT for BUG-001 (driftThresholdTokens). Touches spec/07 §5.1 + nudges.ts comment ~296–306 + drift_nudge.test.ts ~128–143 + README line 98 (unchanged). NON-OVERLAPPING with this task's regions (nudges.ts ~515–543; drift_nudge.test.ts ~487–512; README ~233). Its nudges.ts edit is a same-region comment rewrite (no line-count change) → should not shift my line numbers. LOCATE renderHighWaterNudge by signature to be robust."
  critical: "Do NOT edit spec/07 §5.1, the ~296–306 nudges.ts comment, or drift_nudge.test.ts ~128–143 (previous task's territory)."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  nudges.ts   # ← MODIFY: renderHighWaterNudge body (539, 542) + JSDoc (~517–522). injectHighWaterNudge (555+) UNCHANGED.
test/
  drift_nudge.test.ts   # ← MODIFY: renderHighWaterNudge describe block (487) — tests 1 + 3 flip toContain→not.toContain
  filter.test.ts        # ← READ-ONLY (955–967 integration; unchanged + green)
README.md               # ← MODIFY: line 233 inline-quoted nudge text
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly three existing files:
src/nudges.ts            # renderHighWaterNudge: 2 return strings → awareness-only; JSDoc updated
test/drift_nudge.test.ts # 2 assertions flipped (toContain→not.toContain) + awareness-content assertions added
README.md                # line 233 inline-quoted nudge text → awareness-only example
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (change ONLY the two return strings — keep everything else).
//   KEEP: export function signature `(totalFilteredTokens: number, windowTokens: number): string`; the
//   `if (!(windowTokens > 0))` defensive guard; `const pct = Math.round((totalFilteredTokens / windowTokens) * 100)`;
//   the `[mulligan]` prefix; the ~25–40 token budget; PURE/never-throws (E13). CHANGE: only the two return STRINGS.
//   Do NOT touch the Math.round, the guard, or the percentage interpolation.

// CRITICAL GOTCHA #2 (the new text MUST NOT contain 'mulligan_rewind' or 'mulligan_shrink' — grep-guard it).
//   Both return paths must drop the "Consider mulligan_shrink or mulligan_rewind to reclaim space." prescription.
//   Target percentage: `[mulligan] Context is at ~${pct}% of the window; review recent output for reclaimable space.`
//   Target fallback:   `[mulligan] Context is filling up; review recent output for reclaimable space.`
//   ("reclaimable space" is fine — it is awareness phrasing, not a tool name.) Verify with the grep guard in Level 4.

// CRITICAL GOTCHA #3 (do NOT touch renderDriftNudge / renderBloatReminder / injectNudge / injectHighWaterNudge).
//   The DRIFT nudge (§2/§5.1) and BLOAT reminder (§1) CORRECTLY prescribe mulligan_rewind/mulligan_shrink — the
//   drift delta is agent-attributable (D10) and the bloat result is a tool result the agent produced, so prescribing
//   rewind/shrink there is RIGHT. ONLY the high-water signal (§5.2) measures TOTAL (incl. user pastes) → awareness-only.
//   injectHighWaterNudge (555+) just calls renderHighWaterNudge + wraps — its customType/display/append stay; no change.

// CRITICAL GOTCHA #4 (flip BOTH toContain assertions in test 1, AND the toContain in the fallback test 3).
//   Test 1 (lines 495–496): toContain("mulligan_shrink") + toContain("mulligan_rewind") → BOTH flip to not.toContain.
//   Test 3 (line ~511): toContain("mulligan_shrink") (comment "still recommends the tools") → flips to not.toContain,
//   and ADD not.toContain("mulligan_rewind") for symmetry. If you flip only one of test 1's two, the other fails.
//   Do NOT touch test 2 (rounding ~XX%) — it's unaffected.

// CRITICAL GOTCHA #5 (add a POSITIVE awareness-content assertion so the test isn't vacuously true).
//   After flipping to not.toContain, ADD expect(s).toContain("review recent output") to test 1 (and optionally the
//   fallback). A test that only asserts "not contains X" could pass on an empty string — the positive assertion pins
//   the new awareness phrasing. Keep the existing ~70% / [mulligan] / non-empty assertions.

// CRITICAL GOTCHA #6 (TDD ordering — failing assertions first, then the code).
//   Recommended: update the 2 tests FIRST (they now assert NOT-contains + awareness text) → run → RED (the code still
//   emits the old prescription) → change the 2 return strings → run → GREEN. The red→green proves the test locks in
//   the fix. (If you change code first, a passing test proves nothing about whether the assertion actually guards it.)

// CRITICAL GOTCHA #7 (non-overlapping with the parallel previous PRP — but LOCATE by signature, not line number).
//   Both this task and P1.M1.T1.S1 touch src/nudges.ts + test/drift_nudge.test.ts + spec/07 + README.md, but at
//   DIFFERENT regions (nudges.ts: prev ~296–306 comment, mine ~515–543; tests: prev ~128–143, mine ~487–512;
//   spec/07: prev §5.1, mine no-edit; README: prev line 98, mine line 233). The previous PRP's nudges.ts edit is a
//   same-region comment rewrite (no line-count change) → line numbers ~515–543 should stay valid. To be robust,
//   LOCATE renderHighWaterNudge by `export function renderHighWaterNudge` (signature) and match the VERBATIM return
//   strings (provided in this PRP) — the find/replace is line-drift-immune.

// CRITICAL GOTCHA #8 (README edit is the inline-quoted text only — keep the feature description).
//   README:233 is a sentence describing the high-water feature with the nudge quoted INLINE in parentheses. Replace
//   ONLY the parenthesized quoted text (the `...Consider mulligan_shrink or mulligan_rewind to reclaim space.` part)
//   with `...review recent output for reclaimable space.`. Keep the surrounding sentence ("a one-time annotation ...
//   the first time the *filtered* context crosses ... edge-triggered ... never nags"). Do NOT rewrite the blurb.
```

---

## Implementation Blueprint

### Data models and structure

**No data-model changes.** `renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string` — signature, params, and return type (`string`) are UNCHANGED. The fix swaps two string literals + updates comments/assertions.

### Implementation Tasks (ordered by dependencies — TDD: tests first, then code)

```yaml
Task 1: UPDATE test/drift_nudge.test.ts — flip the prescription assertions (TDD red step)
  - LOCATE the describe at line 487: "renderHighWaterNudge — one-line annotation (spec/07 §5.2)".
  - TEST 1 "returns a non-empty string containing the rounded percentage" (lines 488–498). FIND (verbatim):
        expect(s).toContain("~70%");
        expect(s).toContain("[mulligan]");
        expect(s).toContain("mulligan_shrink");
        expect(s).toContain("mulligan_rewind");
    REPLACE the last two lines WITH:
        expect(s).not.toContain("mulligan_shrink");   // BUG-002: high-water is awareness-only (spec/07 §5.2 v1.1 note)
        expect(s).not.toContain("mulligan_rewind");
        expect(s).toContain("review recent output");  // the new awareness phrasing
    (KEEP: typeof string, length>0, ~70%, [mulligan].)
  - TEST 3 "never throws + returns a percentage-free fallback when windowTokens <= 0" (lines ~506–512). FIND (verbatim):
        expect(s).not.toContain("%"); // no NaN/Infinity%
        expect(s).toContain("mulligan_shrink"); // still recommends the tools
    REPLACE the last line WITH:
        expect(s).not.toContain("mulligan_shrink"); // BUG-002: fallback is awareness-only too
        expect(s).not.toContain("mulligan_rewind");
        expect(s).toContain("review recent output");
    (KEEP: not.toContain("%"), typeof string, length>0, not.toThrow.)
  - DO NOT touch TEST 2 (rounding ~75%/~67%) — unchanged.
  - GOTCHA: flipping to not.toContain alone is weak — ADD the toContain("review recent output") positive assertion
    (GOTCHA #5). If you change only one of test 1's two toContain lines, the other fails (GOTCHA #4).
  - DEPENDENCIES: none. (After this task, `npx vitest run test/drift_nudge.test.ts` is RED — the code still emits the
    old text. That is the intended TDD red step.)

Task 2: REWRITE src/nudges.ts renderHighWaterNudge — both return strings → awareness-only (TDD green step)
  - LOCATE renderHighWaterNudge (search `export function renderHighWaterNudge` — robust to line drift, GOTCHA #7).
  - FALLBACK path (currently line 539, inside `if (!(windowTokens > 0))`). FIND (verbatim):
        return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";
    REPLACE WITH:
        return "[mulligan] Context is filling up; review recent output for reclaimable space.";
  - PERCENTAGE path (currently line 542). FIND (verbatim):
        return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;
    REPLACE WITH:
        return `[mulligan] Context is at ~${pct}% of the window; review recent output for reclaimable space.`;
  - PRESERVE: the signature, the `if (!(windowTokens > 0))` guard, `const pct = Math.round(...)`, the `[mulligan]`
    prefix, ~25–40 token budget. (GOTCHA #1, #2.)
  - GOTCHA: change ONLY the two string literals. The Math.round interpolation `${pct}` STAYS in the percentage path.
    Do NOT touch renderDriftNudge/renderBloatReminder/injectHighWaterNudge/shouldHighWater (GOTCHA #3).
  - DEPENDENCIES: Task 1 (run the tests now → GREEN).

Task 3: UPDATE src/nudges.ts JSDoc (~lines 517–522) — document awareness-only (Mode A)
  - FIND (verbatim, in the renderHighWaterNudge JSDoc):
        * "[mulligan] " prefix, recommends mulligan_shrink/mulligan_rewind, NO trailing newline, ~25–40 tokens. The text
        * format is PINNED by the item contract:
        *   `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
  - REPLACE WITH:
        * "[mulligan] " prefix, AWARENESS-ONLY (does NOT prescribe rewind/shrink), NO trailing newline, ~25–40 tokens.
        * The text is awareness-only per spec/07 §5.2 v1.1 note (D10): the high-water signal measures TOTAL filtered
        * context (including user-supplied content), so it must NOT prescribe mulligan_rewind/mulligan_shrink — those
        * would mis-fire on user-attributable bloat the guardrail (spec/13 §1) protects from rewind. (This separates
        * "the agent should shed something" = drift delta, agent-attributable, from "the window is filling" = high-water,
        * total awareness.) The text format is PINNED by the item contract:
        *   `[mulligan] Context is at ~<pct>% of the window; review recent output for reclaimable space.`
  - GOTCHA: JSDoc only — no code change. The "where `<pct>` = Math.round(...)" sentence that follows STAYS (the
    percentage math is unchanged). Update ONLY the "recommends …" claim + the PINNED-format example line.
  - DEPENDENCIES: Task 2 (or concurrent — non-overlapping text).

Task 4: UPDATE README.md:233 — replace the inline-quoted nudge text (Mode A)
  - FIND (verbatim, the parenthesized inline quote in the 'High-water signal' blurb):
        (`[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`)
    REPLACE WITH:
        (`[mulligan] Context is at ~70% of the window; review recent output for reclaimable space.`)
  - GOTCHA: replace ONLY the parenthesized quoted text. KEEP the surrounding feature description ("a one-time
    annotation … the first time the *filtered* context crosses nudges.highWaterFraction … edge-triggered … never
    nags"). Do NOT rewrite the blurb. (GOTCHA #8.)
  - DEPENDENCIES: none (rides with the work).

Task 5: VALIDATE (no new code)
  - RUN `npx vitest run test/drift_nudge.test.ts` → all pass (updated renderHighWaterNudge tests 1+3 green; rounding
    test 2 green; injectHighWaterNudge/shouldHighWater tests green).
  - RUN `npx vitest run test/filter.test.ts` → the ~70% integration test (955–967) STILL passes (unchanged; confirms
    contextHandler → injectHighWaterNudge → renderHighWaterNudge still reports ~70% + customType mulligan:high-water).
  - RUN `npx vitest run` → full suite passes (no regressions; drift/bloat nudge tests unaffected — their tool-name
    references are correct and untouched).
  - RUN `npx tsc --noEmit` → no new errors (string-content change; signature/types unchanged). Any pre-existing
    errors elsewhere are out of scope.
  - GREP GUARD (Level 4): confirm 'mulligan_rewind'/'mulligan_shrink' do NOT appear in renderHighWaterNudge.
  - DEPENDENCIES: Tasks 1–4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): awareness-only text — report fill level, never name a tool.
//   BEFORE (buggy, percentage):  `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
//   AFTER  (fixed, percentage):  `[mulligan] Context is at ~${pct}% of the window; review recent output for reclaimable space.`
//   BEFORE (buggy, fallback):    "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space."
//   AFTER  (fixed, fallback):    "[mulligan] Context is filling up; review recent output for reclaimable space."
//   The ONLY delta per line is: ". Consider mulligan_shrink or mulligan_rewind to reclaim space." → "; review recent output for reclaimable space."

// PATTERN (Task 1): flip the assertion polarity + add a positive content anchor.
//   expect(s).toContain("mulligan_shrink")  →  expect(s).not.toContain("mulligan_shrink")
//   expect(s).toContain("mulligan_rewind")  →  expect(s).not.toContain("mulligan_rewind")
//   ADD: expect(s).toContain("review recent output")   // pins the new awareness phrasing (non-vacuous)

// CRITICAL: do NOT purge tool-name references from the OTHER renderers. renderDriftNudge (§2/§5.1) and
//   renderBloatReminder (§1) legitimately say mulligan_rewind/mulligan_shrink (drift delta is agent-attributable;
//   bloat is a tool result the agent produced). ONLY the high-water signal (§5.2, TOTAL incl. user pastes) is
//   awareness-only. The grep guard (Level 4) targets renderHighWaterNudge specifically — not the whole file.
```

### Integration Points

```yaml
CODE:
  - modify: src/nudges.ts — renderHighWaterNudge return strings (539, 542) + JSDoc (~517–522)
  - untouched: injectHighWaterNudge (555+), shouldHighWater, renderDriftNudge, renderBloatReminder, injectNudge,
    contextHandler (filter.ts), all tools, all config
TESTS:
  - modify: test/drift_nudge.test.ts — renderHighWaterNudge describe (487): tests 1 + 3 assertion flips + content anchor
  - untouched: test/filter.test.ts (955–967 integration — verify green, do not edit); all drift/bloat/other tests
DOCS:
  - modify: README.md:233 (inline-quoted nudge text)
  - untouched: spec/07 §5.2 (the authority — already correct); spec/07 §5.1 (previous task); README line 98 (previous task)
CONFIG / DATABASE / ROUTES / REGISTRATION: none.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no new errors from src/nudges.ts. The change is two string literals + comments — signature/types
# unchanged. Common mistake: accidentally editing renderDriftNudge/renderBloatReminder/injectHighWaterNudge
# (GOTCHA #3) — re-read the diff to confirm ONLY renderHighWaterNudge's two return strings + its JSDoc changed.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The drift_nudge test file — fast feedback on the text change.
npx vitest run test/drift_nudge.test.ts
# EXPECTED: all pass. If test 1 fails on not.toContain("mulligan_shrink") → Task 2's percentage string still has the
# prescription (re-check). If the "review recent output" assertion fails → the new string didn't land. Test 2 (rounding)
# and the inject/shouldHighWater tests must be GREEN and unchanged.

# The filter integration test — confirms the end-to-end injection path still works + still reports ~70%.
npx vitest run test/filter.test.ts
# EXPECTED: all pass (the 955–967 high-water test is UNCHANGED and asserts only customType + ~70% + display:false).

# Full suite — confirm no regression in the drift/bloat nudge tests (their tool-name references are correct).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for this subtask: renderHighWaterNudge is a PURE string function exercised directly by the unit tests, and the
# end-to-end injection path is covered by test/filter.test.ts:955–967 (which stays green). There is no new runtime
# seam. (A manual REPL check — `node -e 'import("./src/nudges.js").then(m => console.log(m.renderHighWaterNudge(70000,100000)))'`
# — is optional confirmation the string contains ~70% and NOT the tool names.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# GREP GUARD — the high-water renderer must NOT name the tools (the OTHER renderers legitimately do).
# Extract just renderHighWaterNudge's body and grep it:
awk '/^export function renderHighWaterNudge/,/^}/' src/nudges.ts | grep -n 'mulligan_rewind\|mulligan_shrink'
# EXPECTED: ZERO output (the function body has no tool-name references after the fix).
# (Do NOT run a whole-file grep — renderDriftNudge/renderBloatReminder/injectNudge correctly contain those names.)

# Cross-check the new text is present in both paths:
awk '/^export function renderHighWaterNudge/,/^}/' src/nudges.ts | grep -n 'review recent output for reclaimable space'
# EXPECTED: TWO hits (the percentage path + the fallback path).

# TDD red→green (GOTCHA #6): run `npx vitest run test/drift_nudge.test.ts` AFTER Task 1 (tests updated) but BEFORE
# Task 2 → the renderHighWaterNudge tests are RED (code still emits old text). After Task 2 → GREEN. That transition
# proves the assertions actually guard the fix.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — no new errors from `src/nudges.ts`.
- [ ] `npx vitest run test/drift_nudge.test.ts` — all pass (tests 1+3 flipped + green; test 2 unchanged).
- [ ] `npx vitest run test/filter.test.ts` — the ~70% integration test (955–967) still passes (unchanged).
- [ ] `npx vitest run` — full suite passes.

### Feature Validation
- [ ] `renderHighWaterNudge(70000,100000)` contains `~70%` + `[mulligan]` + `review recent output`, and does NOT contain `mulligan_rewind`/`mulligan_shrink`.
- [ ] `renderHighWaterNudge(140000,0)` (fallback) has no `%` and does NOT contain `mulligan_rewind`/`mulligan_shrink`.
- [ ] Level 4 grep guard: renderHighWaterNudge body has ZERO `mulligan_rewind`/`mulligan_shrink` hits.

### Code Quality Validation
- [ ] Signature `(totalFilteredTokens, windowTokens): string` UNCHANGED; `Math.round` pct + `[mulligan]` prefix + defensive guard preserved.
- [ ] `injectHighWaterNudge` (555+), `shouldHighWater`, `renderDriftNudge`, `renderBloatReminder` are UNCHANGED.
- [ ] Only `src/nudges.ts` (2 strings + JSDoc), `test/drift_nudge.test.ts` (2 tests), `README.md` (1 quote) are modified.

### Documentation & Deployment
- [ ] JSDoc documents the awareness-only contract + cites spec/07 §5.2 v1.1 note (D10); the PINNED-format example matches the new text.
- [ ] README:233 inline-quoted nudge matches the new awareness-only example.
- [ ] spec/07 §5.2 NOT edited (it is the authority the code is made to match).

---

## Anti-Patterns to Avoid

- ❌ Don't purge `mulligan_rewind`/`mulligan_shrink` from the OTHER renderers — `renderDriftNudge` (§2/§5.1) and `renderBloatReminder` (§1) correctly prescribe them (drift delta is agent-attributable; bloat is a tool result). ONLY the high-water signal is awareness-only (GOTCHA #3). The grep guard targets renderHighWaterNudge specifically.
- ❌ Don't change the signature, the `Math.round` percentage, the defensive `windowTokens <= 0` guard, or the `[mulligan]` prefix — only the two return STRINGS change (GOTCHA #1).
- ❌ Don't flip only ONE of test 1's two `toContain` lines — both `mulligan_shrink` and `mulligan_rewind` must flip to `not.toContain`, and the fallback test's assertion must flip too (GOTCHA #4).
- ❌ Don't leave the test as only `not.toContain` — add `expect(s).toContain("review recent output")` so a passing test isn't vacuously true (e.g. an empty string) (GOTCHA #5).
- ❌ Don't touch test 2 (rounding ~75%/~67%) or test/filter.test.ts:955–967 (~70% integration) — both are unaffected and must stay green.
- ❌ Don't edit spec/07 §5.2 (the authority — already correct) or spec/07 §5.1 / nudges.ts comment ~296–306 / drift_nudge.test.ts ~128–143 / README line 98 (the previous parallel task's territory) (GOTCHA #7).
- ❌ Don't rewrite the README blurb — replace ONLY the inline-quoted nudge text in parentheses (GOTCHA #8).
- ❌ Don't skip the TDD red step — updating the tests first (red) then the code (green) proves the assertions actually guard the fix (GOTCHA #6).

---

## Decision Log

- **D1 — Awareness-only text: report fill level + suggest reviewing recent output; never name a tool.** spec/07 §5.2 v1.1 note is unambiguous: "its prescription is pure awareness, not rewind/shrink." The high-water signal measures TOTAL filtered context (incl. user pastes); prescribing rewind/shrink mis-fires on user-attributable bloat the guardrail (spec/13 §1) protects. The chosen phrasing ("review recent output for reclaimable space") is awareness (it points the agent at *its own* output, which it CAN legitimately shed, without mandating a specific tool or naming rewind/shrink). It retains `[mulligan]` + `~<pct>%` + the ~25–40 token budget.

- **D2 — Only renderHighWaterNudge changes; the other two renderers keep their tool references.** The drift nudge (§2/§5.1) and bloat reminder (§1) prescribe rewind/shrink CORRECTLY — the drift delta is agent-attributable (D10) and a bloated tool result is agent-produced, so telling the agent to rewind/shrink there is right. Conflating all three would break the drift/bloat nudges. The D10 amendment deliberately separates "agent should shed" (delta) from "window is full" (total) — this fix restores that separation for the high-water signal only.

- **D3 — TDD: tests first (red), then code (green).** The bug is a string-content mismatch against spec/07 §5.2. Updating the assertions first (to assert NOT-contains + the new awareness phrasing) makes them RED against the current code, then the two-string fix turns them GREEN. This proves the assertions actually lock in the behavior (a code-first change with a passing test could mask a vacuous assertion). The positive `toContain("review recent output")` anchor prevents the not-contains from being vacuously satisfied.

- **D4 — No spec edit; spec/07 §5.2 is the authority the code is aligned TO.** §5.2 (and its v1.1 D10 note) already state the awareness-only contract correctly. The divergence is entirely on the code/test/README side. Editing §5.2 would be wrong (it's correct) and would overlap the previous task's §5.1 work. This task makes the code match the spec, not the reverse.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused text-content fix to one PURE function (two return strings) + its JSDoc + two test assertion-flips + one README quote, backed by: (a) the verbatim current text of every edit site, (b) the verbatim target strings, (c) the spec/07 §5.2 v1.1 authority quote, (d) the exact assertions to flip (and which to leave), (e) confirmation the filter integration test is unaffected, and (f) a grep guard + TDD red→green protocol. Residual risks: (1) flipping only one of the two test-1 assertions (mitigated by GOTCHA #4 + explicit verbatim find/replace); (2) line-drift from the parallel previous task (mitigated by GOTCHA #7 — locate by signature + verbatim-string matching).