# Verification Findings — P1.M3.T1.S1 (README note-structure + nudge-text sections)

**Task**: [Mode B] changeset-level README sync for delta-006 (note consolidation 4→3 fields + nudge text
re-shortening). Three line-level edits in `README.md` (lines 151, 224, 225) mirroring the landed M1
(three-field `NoteInput`) + M2 (short nudge renderers). No code, no tests — README only.

Ground truth read: `README.md` (lines 19, 146-157, 218-230), `src/notes.ts` (NoteInput:39-43,
NOTE_FIELDS:64-66, renderBloatReminder:268-270 + JSDoc:249-252, renderDriftNudge), `architecture/system_context.md`,
P1M2T1S1/PRP.md + P1M2T1S2/PRP.md (sibling contracts — new nudge strings).

---

## A. THE THREE EDITS (verbatim current → verbatim new)

### Edit (a) — README:151 (the note blurb, under §4 Tools → mulligan_rewind)
**FIND** (verbatim current — the whole line):
```
**The four-field note (confabulation defense).** A rewind requires a `note` with four non-empty fields — `what_happened` (what went wrong), `avoid` (what not to do again), `true_current_state` (files changed, commands run, decisions made on the discarded span — a deterministic file ledger is auto-appended here), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context.
```
**REPLACE WITH** (verbatim — from contract step a; mirrors src/notes.ts NoteInput):
```
**The three-field note (confabulation defense).** A rewind requires a `note` with three non-empty fields — `what_happened` (what happened and the lesson to avoid repeating), `true_current_state` (task progress, decisions, and conclusions — files/commands are auto-captured in the ledger), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context.
```
**Why**: M1 removed `NoteInput.avoid` (folded its lesson into `what_happened`). src/notes.ts confirms:
`NoteInput` has 3 fields (what_happened/true_current_state/next — line 39-43); `NOTE_FIELDS` (64-66) has no
`avoid`; `what_happened` JSDoc (40) reads "what went wrong … and what to avoid doing again"; `renderNote`
(180-181) emits `**What happened:**` + `**Current true state:**` (no `**Avoid:**`).

### Edit (b) — README:224 (Nudge A cost)
**FIND** (verbatim substring, unique on the line): `and costs ~30 tokens, once, only when the threshold is crossed.`
**REPLACE WITH**: `and costs ~20 tokens, once, only when the threshold is crossed.`
**Why**: src/notes.ts renderBloatReminder JSDoc (line 249) now says "~20 tokens, incurred once per bloated
result". The README must match.

### Edit (c) — README:225 (Nudge B drift example)
**FIND** (verbatim substring — the backtick-wrapped example, unique on the line):
`` `Previous turn added ~4.2k tokens to your context. If that growth was wasteful, call mulligan_rewind or mulligan_shrink; run mulligan_audit for a breakdown.` ``
**REPLACE WITH** (new short form — renderDriftNudge output, per contract step c + P1M2T1S1/S2):
`` ``Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.`` ``
⚠ **MARKDOWN NESTED-BACKTICK GOTCHA**: the NEW example string itself contains literal backticks around
`mulligan_rewind`/`mulligan_shrink` (the renderer emits them — renderBloatReminder line 270 uses \` escapes).
The CURRENT example uses a SINGLE-backtick code span with PLAIN tool names (no inner backticks). If you keep
the single outer backtick and add inner backticks, markdown breaks (`` `…`mulligan_rewind`…` `` → 3 broken
spans). Use a DOUBLE-backtick outer code span (`` `` … `` ``) so the inner single backticks render literally.
This preserves the "exact injected string" visual. (Alt: drop the code span, inline-code the tool names with
double-quotes around the example — also clean. The double-backtick span is preferred.)

## B. THE FALSE POSITIVE — README:19 (DO NOT TOUCH)
`- **Silent accumulation.** … the agent has no built-in signal that it is drifting toward an auto-compaction
it would rather **avoid**.` ← The word "avoid" here is a VERB ("compaction it would rather avoid"), NOT the
`NoteInput.avoid` field. It MUST stay. Contract step (d) says grep for 'avoid' — the intent is stale
NOTE-field refs, not every English "avoid". Line 19 is the ONLY other "avoid" in the README and it is correct.

## C. STALE-REFERENCE AUDIT (comprehensive grep — the FULL edit set)
Contract step (d): grep the ENTIRE README for stale terms. Results (run this session):
- `four[- ]field` / `all four` / `four non-empty` → **1 hit: line 151** (Edit a). No others.
- `\bavoid\b` → **2 hits: line 19 (FALSE POSITIVE — keep) + line 151 (Edit a)**. No others.
- `~30 tokens` → **1 hit: line 224** (Edit b). No others.
- `mulligan_audit for a breakdown` → **1 hit: line 225** (Edit c). No others.
- `If that growth was wasteful` → **1 hit: line 225** (Edit c). No others.
- `granularity:"last_tool_call_group"` / `with a summary or` / `This result added` → **0 hits** (already clean).
**CONCLUSION: the edit set is EXACTLY {151, 224, 225}.** No §7 Known Limitations / config table / §2 references
to the note fields exist (verified). The "Out of scope" section does not mention the note fields.

## D. SOURCE-OF-TRUTH (verified in src/notes.ts, post-M1 [Complete])
- `NoteInput` (line 39): `{ what_happened: string; true_current_state: string; next: string }` — 3 fields, no `avoid`.
- `what_happened` JSDoc (40): "Past tense: what went wrong and wasted context — and what to avoid doing again."
- `renderBloatReminder` (270): `` `\n---\n~${resultKb} KB added to your context. `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.` `` — new short form ✅.
- `renderBloatReminder` JSDoc (249): "~20 tokens" ✅.
- `renderDriftNudge` new output: `Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind`
  to undo the turn or `mulligan_shrink` to compact a result.` (lead UNCHANGED; per P1M2T1S1/S2 contracts).
These strings are the EXACT targets the README example sentences must quote.

## E. SCOPE
- EDIT: `README.md` ONLY (3 line-level edits: 151, 224, 225). [Mode B] — this IS the changeset-level doc sync.
- DO NOT edit any src/* or test/* (M1/M2 own those; M2.T1.S2 edits test/notes.test.ts in parallel).
- DO NOT touch README:19's "avoid" (false positive).
- PARALLEL-SIBLING: P1.M2.T1.S2 edits test/notes.test.ts — different file, zero overlap.

## F. VALIDATION
- PRIMARY gate: grep confirms NO stale refs remain in README (lines 151/224/225 migrated; line 19 "avoid" stays).
- NO-REGRESSION sanity: `npm run typecheck` + `npx vitest run` — README edits are provably non-behavioral and
  CANNOT fail these; if they're non-green it reflects the parallel siblings' in-flight state (per P1.M2T1.S2 PRP,
  up to 2 pre-existing errors from in-progress M1.T1.S3: notes.test.ts:323, rewind.test.ts:843), NOT this task.

## G. FILES READ (evidence)
README.md (19, 146-157, 218-230), src/notes.ts (NoteInput:39-43, NOTE_FIELDS:64-66, renderBloatReminder:249-270,
renderDriftNudge), architecture/system_context.md (touchpoint map + verification), P1M2T1S1/PRP.md +
P1M2T1S2/PRP.md (new nudge string contracts).