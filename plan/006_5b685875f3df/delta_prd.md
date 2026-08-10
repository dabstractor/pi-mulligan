# pi-mulligan — Delta PRD (005 → 006)

**Status:** Draft · **Scope:** two localized changes against the post-005 codebase · **No new architecture**

## What changed (diff summary)

The 005 → 006 spec delta is **two small, independent, localized changes**. There is no new tool, no new event, no new config knob, and no architectural change. Both ride entirely on existing code that session 005 already shipped.

### Cluster 1 — Rewind note consolidated: 4 fields → 3 fields (HEADLINE)
The `NoteInput.avoid` field is **removed**. Its content (the "what NOT to do again" lesson) is **folded into `what_happened`**, which now means "what went wrong *and* the lesson." The note goes from four required fields (`what_happened` / `avoid` / `true_current_state` / `next`) to three (`what_happened` / `true_current_state` / `next`).

This is the headline change. It cascades through the rendered note (the `**Avoid:**` line is dropped), the typebox `RewindParams` schema, field validation, the tool example, and every test fixture.

- **Spec evidence:** spec/04 §2.1 (`NoteInput`, "all three fields", header description); spec/04 §2.3 (rendered note drops `**Avoid:**`, closing paragraph rewritten); spec/05 §1 (Purpose list, `RewindParams`, "All three fields", Behavior step 2, Example); spec/03 §3.1 (data-flow example); spec/10 §1.8 ("All three fields present").
- **Backward compat:** automatic — old markers persisted an `avoid` field that the new `validateNote`/`renderNote` simply never read (unknown keys ignored; `validateNote`/`renderNote` run only at tool-call time, never on read-back). No migration.

### Cluster 2 — Nudge text shortened again
Both `context`-riding renderers get terser text (a continuation of 005's M4 simplification, one step further):

- **`renderBloatReminder`** (spec/07 §1): the body condenses from `"This result added ~<KB> KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:"last_tool_call_group")\` if the whole call was a mistake."` to **`"~<KB> KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake."`** (~30 → ~20 tokens).
- **`renderDriftNudge`** (spec/07 §2): the fixed tail condenses from `". If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown."` to **`". If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result."`** — the `mulligan_audit` reference is dropped. The same condensing applies to the no-delta bloat-fallback lead.

- **Spec evidence:** spec/07 §1 (`renderBloatReminder` block + cost note); spec/07 §2 (`renderDriftNudge` block); spec/10 §2.1 F-shrink-preventive (reminder-text description updated to the short form).

### Doc-only spec alignment (no task; awareness)
spec/08 E22's advisory repeat-detection hint now keys on `what_happened` alone ("which now includes the avoid/lesson") instead of `what_happened`/`avoid`. **This hint is not implemented in code** (grep for identical-note detection returns nothing — it was always a SHOULD). It is a pure spec-text update with no code impact; no task is created for it.

### Minor wording (folded into the rewind task, not a standalone change)
spec/05 §6 `RWIND_DESC` tweaks one phrase: `"The hidden content disappears from your view permanently"` → `"The content is hidden from your context going forward"`. Single string update; rides with Cluster 1's rewind-tool task.

---

## P1 — Rewind note consolidation + nudge text simplification

**Phase type:** MEDIUM delta. Two localized, independent changes to existing code. No new files, no new mechanisms. M1 and M2 both edit `src/notes.ts` (disjoint functions: M1 = note machinery, M2 = nudge renderers), so **M2 depends on M1** to keep a single writer on `notes.ts`. M3 (README) depends on both.

### M1 — Consolidate the rewind note to three fields
The `avoid` field is removed from `NoteInput`; its lesson folds into `what_happened`. Update the schema, the renderer, validation, the rewind tool's typebox schema + description, and the fixtures/assertions in the two affected test files.

**T1 — Note consolidation (notes.ts note side + rewind.ts schema + tests)**
- **Subtask S1 — `notes.ts` note machinery + JSDocs** (sp 1). Edit `NoteInput` (remove `avoid`; rewrite `what_happened` docstring to "past tense + the lesson, generalize it"; rewrite `true_current_state` docstring to "task progress, decisions, conclusions — files/commands are auto-captured in the ledger"). Remove `"avoid"` from `NOTE_FIELDS`. `validateNote` logic is unchanged (it loops `NOTE_FIELDS`); update its JSDoc + the module header from "four" → "three". In `renderNote`, remove the `**Avoid:** <avoid>` section line. Remove `"avoid"` from the `readNoteField` key union. Update every JSDoc FORMAT block / field count reference ("all four" → "all three"). Pure helpers; never throws discipline preserved. **Mode A docs:** the JSDoc updates ARE the inline docs (spec/04 §2.1, spec/05 §1 step 2, spec/10 §1.8).
- **Subtask S2 — `rewind.ts` schema + description** (sp 0.5). Depends on S1. Edit `RewindParams.note`: remove the `avoid` field; update `what_happened` description to "Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson."; update `true_current_state` description to "The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work."; change the object description to "All three fields required." Update the file-header comment ("structured four-field note" → "three-field"). Update `RWIND_DESC` line 136: "The hidden content disappears from your view permanently" → "The content is hidden from your context going forward". **Verify (no edit):** `src/markers.ts` references `NoteInput` by type only (`import type { NoteInput }`, `note: NoteInput`) — removing `avoid` flows through automatically. **Mode A docs:** the `RewindParams` descriptions + `RWIND_DESC` are the LLM-facing docs (spec/05 §1, §6).
- **Subtask S3 — Tests for the three-field note** (sp 1.5). Depends on S1, S2. Update `test/notes.test.ts`: the `VALID_NOTE` fixture (merge `avoid` into `what_happened` as one sentence with ";"); the `FIELDS` array (drop `avoid`); the parametrized "each field empty → invalid" cases (repoint the `avoid`-specific cases to another field); the renderNote section assertions (drop the `**Avoid:**` line at ~lines 185-187, 213-215, 323); the `null`/`undefined`/whitespace defensive cases. Update `test/tools/rewind.test.ts`: its `VALID_NOTE` fixtures (lines ~54-55, ~844-845, merge `avoid` into `what_happened`); the refusal parametrized table (line ~332 "whitespace-only avoid" → repoint to e.g. "whitespace-only true_current_state"). Run `npm test` — all green. **Mode A docs:** none (test-only).

### M2 — Nudge text re-shortening
Both `context`-riding renderers emit terser text. Pure text + JSDoc in `notes.ts`; assertion updates in `notes.test.ts`.

**T1 — `renderBloatReminder` + `renderDriftNudge` text + tests**
- **Subtask S1 — Renderer text + JSDocs** (sp 1). Depends on P1.M1 (same file). Rewrite `renderBloatReminder` body to: `` `\n---\n~${resultKb} KB added to your context. \`mulligan_shrink\` to summarize, or \`mulligan_rewind\` if the whole call was a mistake.` `` (verbatim spec/07 §1). Rewrite `renderDriftNudge`'s fixed tail to: `` `. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.` `` (verbatim spec/07 §2; drops the `mulligan_audit` reference). Apply the same tail-condensing to the no-delta bloat-fallback lead ("Previous turn produced <N> bloated result(s)." + new tail). Update both JSDoc FORMAT blocks + the cost note (bloat ~30 → ~20 tokens). `bytesToKb`/`kTokens`/`resultWord`/`readDelta`/`readBloatHits` unchanged. The `nudges.ts` call site is already 2-arg (005 M4) — **no call-site change**. **Mode A docs:** the JSDoc FORMAT blocks ARE the inline docs (spec/07 §1, §2).
- **Subtask S2 — Nudge text test assertions** (sp 1). Depends on S1. Update `test/notes.test.ts`: the `DRIFT_TAIL` const (~line 406) to the new tail; every `renderBloatReminder` assertion / inline snapshot (~lines 412, 420, 425, 449, 452, 455, 467-470) to the short form; the `renderDriftNudge` delta-path + bloat-fallback assertions. Grep `test/drift_nudge.test.ts` + `test/nudges.test.ts` for any pinned-text assertions and align them. Run `npm test` — all green. **Mode A docs:** none (test-only).

### M3 — Sync README (Mode B; depends on M1 + M2)
**T1 — README note-structure + nudge-text sync**
- **Subtask S1 — README note + nudge sections** (sp 0.5). Depends on P1.M1.T1.S2, P1.M2.T1.S1. (a) README ~line 151: rewrite "The four-field note ... `what_happened`, `avoid`, `true_current_state`, `next`" to "The three-field note ... `what_happened` (what happened + the lesson to avoid repeating), `true_current_state`, `next`". (b) README ~line 224: change the bloat-reminder cost "~30 tokens" → "~20 tokens". (c) README ~line 225: update the drift-nudge example sentence to the new short form (drop the `mulligan_audit` clause). Confirm nothing else in README still names `avoid` or quotes the old nudge text.

---

## Out of scope (no tasks)
- **Hard deletion / tree mutation / new tools / new events / new config knobs** — none in this delta.
- **The spec/08 E22 repeat-detection hint** — doc-only (not implemented in code; a SHOULD). No task.
- **Migration of on-disk `avoid` fields** — none needed (forward-compat: extra field ignored).
- **The `mulligan_audit` report format** — unchanged (it lists markers, not note fields).

## Verification (definition of done)
1. `npm test` is fully green; no test still references `NoteInput.avoid` or the old nudge strings.
2. `renderNote` output for a three-field note contains no `**Avoid:**` line.
3. A rewind call with a note missing `what_happened` (or any of the three) is still refused with the pinned reason.
4. README's note blurb says "three-field" and its nudge example matches the new short text.