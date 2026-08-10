# Research Notes — P1.M2.T1.S1: Renderer text + JSDocs (`renderBloatReminder` + `renderDriftNudge`)

> Surgical text-rewrite of TWO renderer functions in `src/notes.ts` + their JSDoc FORMAT blocks (Mode A inline
> docs). The test assertions are a SEPARATE sibling (P1.M2.T1.S2) — S1 must NOT touch test files. The suite
> will be RED on `test/notes.test.ts` after S1 until S2 lands; that is the PLANNED split.

## 1. The two renderers (current verbatim — src/notes.ts)

### renderBloatReminder (function at line 269; body line 271)
```ts
export function renderBloatReminder(toolName: string, bytes: number): string {
  const resultKb = bytesToKb(bytes);
  return `\n---\nThis result added ~${resultKb} KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake.`;
}
```
NEW body (VERBATIM per contract; matches PRD spec/07 §1 h3.50):
```ts
  return `\n---\n~${resultKb} KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake.`;
```
Drops: "This result added"→prefix removed; "If you don't need the full output, call"→gone; "with a summary
or"→"to summarize,"; the `(granularity:"last_tool_call_group")` detail→gone. Leading `\n---\n` (markdown rule)
+ `~${resultKb} KB` + NO trailing newline PRESERVED. (~30→~20 tokens.)

### renderDriftNudge (function at line 306; body tail line 320)
```ts
  return `${lead}. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.`;
```
NEW tail (VERBATIM per contract; matches PRD spec/07 §2 h3.55):
```ts
  return `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`;
```
Drops: "that growth was"→gone ("If wasteful"); "(undo the turn)"→"to undo the turn"; "(compact a result)"→
"to compact a result"; the ENTIRE "; run `mulligan_audit` for a breakdown" clause→gone. The 3-branch LEAD
selection (delta / bloat / fallback) is UNCHANGED. `${lead}.` join + NO embedded newline PRESERVED.

## 2. JSDoc FORMAT blocks (Mode A — must match the new text)

### renderBloatReminder JSDoc
- **cost note (line 249):** "~30 tokens" → "~20 tokens" (PRD h3.50 says "~20 tokens").
- **FORMAT block (lines 252–255):** change the VERBATIM text to:
```
 *     \n---\n~<KB> KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind`
 *     if the whole call was a mistake.
```

### renderDriftNudge JSDoc
- **FORMAT block (lines 283–285):** change the tail text to:
```
 *     <lead>. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.
```
- **(consistency) line 296:** the stale note "The 'consider'→'call' + '; run'-joined tail condenses the old
  3-line form" describes the OLD tail structure (which had a "; run audit" clause). Update to reflect the new
  terse tail (no audit clause). Recommended, not strictly required by the contract, but leaving it contradicts
  the new FORMAT block.

## 3. What stays UNCHANGED (scope discipline)
- `bytesToKb`, `kTokens`, `resultWord`, `readDelta`, `readBloatHits` helpers — UNCHANGED.
- The 3-branch lead selection in renderDriftNudge (delta != null / bloat>0 / fallback) — UNCHANGED.
- Function signatures: `renderBloatReminder(toolName, bytes)` and `renderDriftNudge(metric)` — UNCHANGED.
  `toolName` is still accepted-but-unused (spec unchanged; reserved for future).
- Never-throws discipline — PRESERVED (no new throws; pure string composition).
- The call site in `src/nudges.ts` — already 2-arg (verified: `renderBloatReminder(event.toolName, bytes)` at
  nudges.ts ~line 71; `renderDriftNudge(metric)` via injectNudge). NO call-site change.

## 4. Test breakage map (CRITICAL — planned S1/S2 split)

### WILL BREAK after S1 (owned by P1.M2.T1.S2 — do NOT fix in S1)
`test/notes.test.ts` pins the OLD renderer text:
- Line 405–406: `DRIFT_TAIL` const = OLD tail.
- Lines 410–431: renderBloatReminder exact/`toContain` assertions on "This result added …" + the
  `mulligan_rewind(granularity:"last_tool_call_group")` detail.
- Lines 449/452/455: `.toContain("This result added ~0 KB …")` (bad-number tests).
- Lines 467–470: `toMatchInlineSnapshot()` of the OLD full text.
- Lines 475–527: renderDriftNudge tests compose `"<lead>" + DRIFT_TAIL` → all fail (DRIFT_TAIL is old).
→ `npx vitest run test/notes.test.ts` is EXPECTED-RED after S1; S2 owns updating these. NOT an S1 gate.

### AUTO-ADAPTS (stays GREEN — valid S1 consistency gates)
- `test/nudges.test.ts:299`: `expect(appended.text).toBe(renderBloatReminder("read", OVER_BYTES))` — compares
  against the RETURN VALUE (not pinned text) → passes with the new text. ✅ baseline 30/30 green.
- `test/drift_nudge.test.ts:155–156`: `startsWith("Previous turn")` + `not.toContain("[mulligan]")` (loose) →
  passes. ✅ baseline 40/40 green.

## 5. Baseline (verified)
- `npx tsc --noEmit` → exit **2** with TWO pre-existing errors, BOTH from the in-progress parallel M1.T1.S3
  (the `avoid` removal): `test/notes.test.ts:323` + `test/tools/rewind.test.ts:843`. My renderer edits (pure
  string literals) add NO new tsc errors → after S1 the error set is UNCHANGED (same 2, no new).
- `npx vitest run test/nudges.test.ts test/drift_nudge.test.ts` → 70/70 green (auto-adapting consumers).

## 6. Conflict / scope check
- Parallel item P1.M1.T1.S3 edits TEST files only (notes.test.ts, rewind.test.ts, edge-cases.test.ts,
  markers.test.ts) for the `avoid` removal. It does NOT touch src/notes.ts. Zero file overlap with S1.
- Sibling P1.M2.T1.S2 owns the notes.test.ts renderer-snapshot updates. S1 must NOT touch test files.
- M1's notes.ts changes (NoteInput/validateNote/renderNote, now Complete) are DISJOINT functions from the two
  renderers (S3 region, lines 221+) — no overlap within notes.ts either.
- This PRP edits ONLY `src/notes.ts`: 2 renderer return-strings + 2 JSDoc FORMAT blocks + 1 cost note +
  (optional) 1 stale line-296 note. Nothing else.

## 7. Spec cross-references (the VERBATIM targets)
- spec/07-preventive-and-nudges.md §1 (h3.50): the new renderBloatReminder text — `~<KB> KB added to your
  context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake.` (~20 tokens).
- spec/07 §2 (h3.55): the new renderDriftNudge text — `<lead>. If wasteful, \`mulligan_rewind\` to undo the
  turn or \`mulligan_shrink\` to compact a result.`