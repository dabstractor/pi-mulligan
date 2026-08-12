# Research Notes — P1.M1.T2.S1 (BUG-002: renderHighWaterNudge awareness-only text)

## Target & the bug
`renderHighWaterNudge` (src/nudges.ts:534–543, EXPORTED, PURE). BOTH return paths prescribe
`mulligan_shrink`/`mulligan_rewind`. spec/07 §5.2 v1.1 note (line 172) is the AUTHORITY: the high-water signal
measures TOTAL filtered context (incl. user pastes), so "its prescription is pure awareness, not rewind/shrink."
Prescribing rewind/shrink re-couples the D10-separated signals and fires misaligned advice on user-attributable
bloat (the guardrail spec/13 §1 protects user messages from rewind). Confirmed: architecture/bug_analysis.md §BUG-002.

## Verbatim current code (src/nudges.ts:534–543)
```typescript
export function renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string {
  if (!(windowTokens > 0)) {
    // Defensive: ... (comment)
    return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";   // line 539
  }
  const pct = Math.round((totalFilteredTokens / windowTokens) * 100);
  return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;  // line 542
}
```
KEEP: signature, the `if (!(windowTokens > 0))` guard, the `Math.round` pct, `[mulligan]` prefix, ~25–40 token budget.
CHANGE: both return STRINGS (drop the "Consider mulligan_shrink or mulligan_rewind to reclaim space." prescription).

## Verbatim current JSDoc (src/nudges.ts ~517–522)
- Line ~518: `* ... leading "[mulligan] " prefix, recommends mulligan_shrink/mulligan_rewind, NO trailing newline, ~25–40 tokens.`
- Lines ~519–521: `* The text format is PINNED by the item contract:` / `*   \`[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.\``
CHANGE: "recommends mulligan_shrink/mulligan_rewind" → "is awareness-only (does NOT prescribe rewind/shrink — spec/07 §5.2 v1.1 note D10: the signal fires on TOTAL filtered context incl. user pastes the guardrail protects)"; update the PINNED example to the new text.

## Target text (both paths awareness-only; MUST NOT contain 'mulligan_rewind' or 'mulligan_shrink')
- Percentage: `` `[mulligan] Context is at ~${pct}% of the window; review recent output for reclaimable space.` ``
- Fallback: `"[mulligan] Context is filling up; review recent output for reclaimable space."`
injectHighWaterNudge (line 555+) calls renderHighWaterNudge + wraps — NO CHANGE (only text content changes; the
customType "mulligan:high-water", display:false, ephemeral append all stay).

## Affected tests (MUST UPDATE) — test/drift_nudge.test.ts, describe at line 487
- Test 1 "returns a non-empty string containing the rounded percentage" (488–498):
    `expect(s).toContain("mulligan_shrink");` (495) → `expect(s).not.toContain("mulligan_shrink");`
    `expect(s).toContain("mulligan_rewind");` (496) → `expect(s).not.toContain("mulligan_rewind");`
  ADD: `expect(s).toContain("review recent output");` (asserts the awareness content present).
  KEEP: `~70%`, `[mulligan]`, non-empty assertions.
- Test 3 "never throws + returns a percentage-free fallback" (~506–512):
    `expect(s).toContain("mulligan_shrink"); // still recommends the tools` (511) → `expect(s).not.toContain("mulligan_shrink");`
  ADD: `expect(s).not.toContain("mulligan_rewind");`. KEEP: `not.toContain("%")`, non-empty, no-throw.
- Test 2 "rounds the percentage (0.75 → 75%, 0.666 → 67%)" (~500–503): NO change (only ~XX%, unaffected).
- test/filter.test.ts:955–967 ("reports ~70%"): NO change — asserts customType + "~70%" + display:false, NOT the
  prescription text (verified by reading 950–970).

## README.md:233 (the quoted nudge — UPDATE)
Current quotes the OLD text inline:
`... a one-time annotation (\`[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.\`) the first time ...`
→ replace the quoted text with: `[mulligan] Context is at ~70% of the window; review recent output for reclaimable space.`
(The surrounding sentence describing the feature stays — only the inline-quoted nudge text changes.)

## spec/07 §5.2 v1.1 note (line ~172) — the AUTHORITY (NO edit by me)
"...but its prescription is pure awareness, not rewind/shrink." This is already correct; I change CODE/TESTS/README
to MATCH it. I do NOT edit spec/07 §5.2 (the previous PRP owns §5.1; §5.2 is untouched by both).

## Conflict check with previous PRP (P1.M1.T1.S1) — NON-OVERLAPPING regions, both safe
Both touch src/nudges.ts + test/drift_nudge.test.ts + spec/07 + README.md, but DIFFERENT regions:
- nudges.ts: prev = comment block ~296–306 (driftThresholdTokens deviation framing); mine = JSDoc ~517–522 + body ~534–543.
- drift_nudge.test.ts: prev = ~128–143 (>= drift tests); mine = ~488–512 (renderHighWaterNudge block).
- spec/07: prev = §5.1 (`>` → `>=`); mine = no edit (§5.2 is authority).
- README.md: prev = line 98 (UNCHANGED — already correct); mine = line 233.
RISK: prev rewrites the ~296–306 comment (same-line-count rewrite, "no behavioral change"), so it should NOT shift
my line numbers. BUT to be robust: LOCATE renderHighWaterNudge by signature, not raw line number; the verbatim
find/replace strings are line-drift-immune.

## TDD ordering
1. Write/update the failing assertions FIRST (they assert NOT-contains + new awareness text) → red.
2. Change the two return strings → green.
3. Update JSDoc + README quote.

## Validation (project tooling — vitest + tsc)
- `npx vitest run test/drift_nudge.test.ts` — all pass (updated renderHighWaterNudge tests + rounding + fallback).
- `npx vitest run test/filter.test.ts` — high-water integration (~70%) still passes (NO change to that test).
- `npx vitest run` — full suite passes.
- `npx tsc --noEmit` — no new errors (string-content change; signature/types unchanged).
- Grep guard: `grep -n 'mulligan_rewind\|mulligan_shrink' src/nudges.ts` → the high-water renderer must have ZERO hits
  (the drift nudge + bloat reminder elsewhere in nudges.ts legitimately keep their tool-name references — scope is ONLY renderHighWaterNudge).

## Scope discipline (do NOT touch)
- renderDriftNudge / renderBloatReminder / injectNudge / injectHighWaterNudge mechanism (lines ~555+) — those
  legitimately reference tools (drift + bloat nudges prescribe rewind/shrink CORRECTLY; only high-water is awareness-only).
- shouldHighWater (the edge-trigger gate) — unchanged.
- spec/07 §5.1 + nudges.ts comment ~296–306 — previous PRP's territory.
- spec/07 §5.2 — already correct (authority); no edit.
- config defaults / driftThresholdTokens — BUG-001 (previous task), not mine.
- README line 98 — previous task (unchanged).