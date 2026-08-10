# P1.M2.T1.S2 Research — Nudge text test assertions (notes.test.ts)

## Scope (one sentence)
Update the pinned-text assertions in **test/notes.test.ts** to match the new (shorter) nudge renderer
strings that S1 ships in **src/notes.ts**. S2 touches ONLY test/notes.test.ts. Verified: no other test
file references the old nudge text, and the two sibling consumer suites auto-adapt.

## The new strings S1 produces (the CONTRACT — match these EXACTLY)
After S1, `src/notes.ts` returns (verified against the S1 PRP; the `${resultKb}`/`${lead}` interpolations stay):
- `renderBloatReminder(toolName, bytes)` →
  `` `\n---\n~${resultKb} KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.` ``
  (OLD: `` `\n---\nThis result added ~${resultKb} KB … If you don't need the full output, call `mulligan_shrink` with a summary or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole call was a mistake.` ``)
- `renderDriftNudge(metric)` tail (after `${lead}.`) →
  `` `If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.` ``
  (OLD tail: `` `If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.` ``)

S1 edits ONLY src/notes.ts (bodies + 2 JSDoc FORMAT blocks + ~30→~20 tokens cost note). S1 does NOT touch
any test file. test/notes.test.ts is EXPECTED-RED after S1 — S2 owns making it green again.

## VERIFIED: which suites auto-adapt (NO edit) vs. which S2 owns
- `test/nudges.test.ts:299` → `expect(appended.text).toBe(renderBloatReminder("read", OVER_BYTES))` — compares
  to the RETURN VALUE, not pinned text → AUTO-ADAPTS. ✅ (grep confirmed only notes.test.ts has old text.)
- `test/drift_nudge.test.ts:151` → `.startsWith("Previous turn")` + `.not.toContain("[mulligan]")` — both still
  true with new text → AUTO-ADAPTS. ✅
- `test/notes.test.ts` → PINS the old text (DRIFT_TAIL const + exact/contains/snapshot assertions) → S2 OWNS.
  **Confirmed by grep: `test/notes.test.ts` is the ONLY file referencing "This result added"/"that growth was".**

## THE COMPLETE EDIT MAP (test/notes.test.ts) — verified line numbers + exact text
(All find/replace must be TEXT-ANCHORED, not line-number-anchored — M1.T1.S3 may shift lines if it lands first,
though its edits are in a DIFFERENT region ~178–340, disjoint from S2's ~395–619.)

### (A) DRIFT_TAIL constant — ONE edit, auto-adapts ~5 assertions
- Line 395–396:
  ```ts
  const DRIFT_TAIL =
    ". If that growth was wasteful, call `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result); run `mulligan_audit` for a breakdown.";
  ```
  → NEW:
  ```ts
  const DRIFT_TAIL =
    ". If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.";
  ```
  This single change fixes the `.toBe("<lead>" + DRIFT_TAIL)` assertions at lines **468, 481, 510, 518**
  and the `.toContain(DRIFT_TAIL)` loop at **531** — they auto-adapt (concatenation). NO individual edit.

### (B) renderBloatReminder assertions — manual edits (NOT a shared constant)
- L399 test NAME: "8 KB result → 'This result added ~8 KB …'" → "8 KB result → '~8 KB added …'" (stale name)
- **L402 exact .toBe** (the full old string) →
  `"\n---\n~8 KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake."`
- L408 test NAME: "30 KB result → 'This result added ~30 KB …'" → "'~30 KB added …'" (stale name)
- **L410 toContain**: `"This result added ~30 KB to your context."` → `"~30 KB added to your context."`
- **L415 toContain**: `"This result added ~9 KB to your context."` → `"~9 KB added to your context."`
- L418 test NAME: "body text is VERBATIM (backticks, the granularity literal, 'summary or' — no comma — GOTCHA #13)"
  → "body text is VERBATIM (backticks, 'to summarize', 'if the whole call was a mistake' — GOTCHA #13)" (stale)
- **L420 toContain**: `"call \`mulligan_shrink\` with a summary or"` → `` "`mulligan_shrink` to summarize" ``
- **L421 toContain**: `` '`mulligan_rewind(granularity:"last_tool_call_group")`' `` → `` "`mulligan_rewind` if the whole call was a mistake" ``
- **L439 toContain** (NaN): `"This result added ~0 KB to your context."` → `"~0 KB added to your context."`
- **L442 toContain** (-100): same → `"~0 KB added to your context."`
- **L445 toContain** (Infinity): same → `"~0 KB added to your context."`
- The regression guards `.not.toContain("[mulligan]"|"threshold"|"stays on disk")` + the toolName test → UNCHANGED (still pass).

### (C) 3 toMatchInlineSnapshot calls — auto-regenerate via `-u` (preferred) OR manual text
- **L457–461** bloat (30 KB read, multi-line snapshot) — old full text → new:
  new string = `` `\n---\n~30 KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.` ``
- **L604–606** drift-only (~4.2k, single-line `'"..."'` snapshot) — new:
  `"Previous turn added ~4.2k tokens to your context. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result."`
- **L618–619** bloat-only (null delta + 2 hits, single-line `'"..."'` snapshot) — new:
  `"Previous turn produced 2 bloated results. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result."`
- PREFERRED update path: after the manual (A)+(B) edits, run `npx vitest run -u test/notes.test.ts` — it
  auto-rewrites only the 3 stale snapshots to match S1's new renderer output (the .toBe/.toContain are not
  snapshots, so -u leaves them alone). This avoids fiddly whitespace/escaping errors in the inline snapshot text.

## Cross-item dependencies
- **S2 REQUIRES S1 applied**: the assertions assert the NEW renderer text; if S1 hasn't changed src/notes.ts,
  the renderers still return OLD text and S2's NEW assertions would be RED. Assume S1 done (parallel_execution_context).
- **S2 disjoint from M1.T1.S3**: M1.T1.S3 (Ready, not started) edits the renderNote region ~178–340 of
  notes.test.ts (the `avoid` field removal). S2 edits the nudge region ~395–619. Text-disjoint → robust; both
  use text-anchored find/replace. If M1.T1.S3 lands first, line numbers shift but text anchors still match.

## Baseline (verified live, pre-S1)
- `npx vitest run test/notes.test.ts` → 67 passed (67). GREEN pre-S1 (old text matches old assertions).
  After S1 (renderer changed, assertions old) → RED. After S2 → GREEN again.
- `src/notes.ts` renderers at L271 + L317 currently return the OLD text (S1 not yet landed).