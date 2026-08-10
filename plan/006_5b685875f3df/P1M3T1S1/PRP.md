# PRP — P1.M3.T1.S1: README note-structure + nudge-text sections (Mode B changeset sync)

## Goal

**Feature Goal**: Sync `README.md` to the landed delta-006 changeset — (1) the rewind note is now
**three fields** (M1 removed `NoteInput.avoid`, folding its lesson into `what_happened`); (2) the bloat
reminder now costs **~20 tokens** (M2 re-shortened `renderBloatReminder`); (3) the drift-nudge example is
now the **short form** (M2 re-shortened `renderDriftNudge`, dropping the `mulligan_audit` clause). This is
the [Mode B] changeset-level documentation sweep — the catch-all doc task for the whole delta.

**Deliverable**: Three line-level edits to **`README.md` ONLY** — line 151 (the note blurb: four-field →
three-field, new field descriptions), line 224 (`~30 tokens` → `~20 tokens`), and line 225 (the drift-nudge
example sentence → the new short form). No code, no tests, no other file.

**Success Definition**: After the edits, (a) README:151 reads "**The three-field note**" and lists
`what_happened` / `true_current_state` / `next` (no `avoid`, no "four"); (b) README:224 reads "~20 tokens";
(c) README:225's drift example is the new short sentence with NO `mulligan_audit` clause and NO "If that
growth was wasteful"; (d) a comprehensive grep of README finds **zero** stale references
(`four-field`, `four non-empty`, `All four`, `~30 tokens`, `mulligan_audit for a breakdown`,
`If that growth was wasteful`) EXCEPT README:19's legitimate English "avoid" (a false positive that stays);
(e) the README renders correctly (no broken nested-backtick markdown).

> ⚠️ **This is a README-only [Mode B] documentation sync.** It consumes the OUTPUTS of M1 (three-field
> `NoteInput`, Complete) and M2 (short nudge renderers, Complete/Implementing). It touches NO source/test
> files. The source-of-truth strings are in `src/notes.ts` (post-M1) — the README must quote them exactly.

## User Persona (if applicable)

**Target User**: Developers/operators reading the README to learn the rewind note structure and the nudge cost.

**Use Case**: A user reads §4 Tools to learn what a rewind `note` contains, and §5 to understand the nudge
costs/wording. The README must describe the CURRENT (post-delta-006) behavior.

**Pain Points Addressed**: Pre-sync, the README advertises a "four-field note" with an `avoid` field that no
longer exists, a "~30 tokens" cost that is now ~20, and a verbose drift example that was shortened. Stale docs
erode trust and mislead users about the actual note contract.

## Why

- **Truth-in-docs (D2 confabulation defense)**: the note is Mulligan's flagship UX. The README's §4 blurb is
  the most prominent user-facing description of its structure. It must match `NoteInput` (3 fields, post-M1).
- **Cost accuracy**: the bloat-reminder cost dropped to ~20 tokens (renderBloatReminder JSDoc, src/notes.ts:249).
  The README's "~30 tokens" is stale.
- **Example fidelity**: the drift nudge was re-shortened (M2). The README example must quote the new short form
  so users (and the spec cross-check) see what is actually injected.
- **[Mode B] sweep completeness**: this IS the catch-all doc-sync task for delta-006 (per the contract's DOCS
  clause). No further docs subtask exists — this single task sweeps the README for the whole delta.

## What

Three edits in `README.md`:

**(a) Line 151** — rewrite the note blurb (four-field → three-field, new field descriptions).
**(b) Line 224** — `~30 tokens` → `~20 tokens`.
**(c) Line 225** — replace the drift-nudge example sentence with the new short form (drop `mulligan_audit`).

Plus: confirm via comprehensive grep that NO other stale references remain (README:19's "avoid" is a false
positive — keep it).

### Success Criteria

- [ ] README:151 reads "**The three-field note (confabulation defense).**" and lists exactly three fields
      (`what_happened`, `true_current_state`, `next`) with the new descriptions; no `avoid`, no "four".
- [ ] README:224 reads "and costs ~20 tokens, once, only when the threshold is crossed."
- [ ] README:225's drift example is `Previous turn added ~4.2k tokens to your context. If wasteful,
      `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.` (no `mulligan_audit`,
      no "If that growth was wasteful"), and it **renders correctly** in markdown (no broken nested backticks).
- [ ] `grep -niE 'four[- ]field|all four|four non-empty' README.md` → 0 hits.
- [ ] `grep -nE '~30 tokens' README.md` → 0 hits.
- [ ] `grep -nE 'mulligan_audit for a breakdown|If that growth was wasteful' README.md` → 0 hits.
- [ ] README:19's "avoid" (the verb, "auto-compaction it would rather avoid") is UNCHANGED (false positive).
- [ ] No file other than `README.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim FIND (current) and REPLACE (new) text for all three edits, the
source-of-truth strings (verified in `src/notes.ts` post-M1), the comprehensive stale-reference audit (which
proves the edit set is exactly {151, 224, 225}), the false-positive call-out (README:19 "avoid" stays), the
markdown nested-backtick gotcha for edit (c) with the recommended double-backtick solution, and deterministic
grep gates. The implementer opens one file and runs grep.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: README.md
  why: Three stale references to the delta-006 changeset: line 151 (four-field note + avoid field),
        line 224 (~30 tokens), line 225 (verbose drift example with mulligan_audit clause).
  section: "§4 Tools → mulligan_rewind (line 151, the '**The four-field note**' blurb); §5 How It Works →
            Nudge A (line 224, 'costs ~30 tokens') + Nudge B (line 225, the backtick-wrapped example)."
  pattern: "Line-level prose edits. Lines 151 and 225 are single long lines (no hard wraps) — find by the
            unique substrings quoted in the Implementation Tasks, not by line number (line numbers shift if
            anything above changes). Line 224 is a one-token change (~30 → ~20)."
  gotcha: "Line 225's example is a markdown INLINE-CODE span (wrapped in backticks). The NEW example string
           contains LITERAL backticks around the tool names (the renderer emits them). A single outer backtick
           + inner backticks BREAKS markdown. Use a DOUBLE-backtick outer span — see CRITICAL GOTCHA #1."

# MUST READ — the source of truth for the note structure (post-M1 [Complete])
- file: src/notes.ts
  why: NoteInput (line 39-43) is the authoritative 3-field shape: { what_happened, true_current_state, next }
        — NO avoid. what_happened JSDoc (40): 'what went wrong … and what to avoid doing again' (the lesson is
        folded in). NOTE_FIELDS (64-66) lists the 3 fields. renderNote (180-181) emits **What happened:** +
        **Current true state:** (no **Avoid:** line). The README blurb must mirror this.
  critical: "The field SEMANTICS in the README must match NoteInput: what_happened = 'what happened and the
             lesson to avoid repeating'; true_current_state = 'task progress, decisions, and conclusions —
             files/commands auto-captured in the ledger'; next = 'the immediate next action'. READ-ONLY —
             do NOT edit src/notes.ts (M1 owns it; it is Complete)."

# MUST READ — the source of truth for the nudge text + cost (post-M2 [Complete])
- file: src/notes.ts
  why: renderBloatReminder (line 268-270) returns the NEW short string: '~<KB> KB added to your context.
        `mulligan_shrink` to summarize, or `mulligan_rewind` if the whole call was a mistake.' Its JSDoc
        (line 249) says '~20 tokens' — the README's ~20 figure comes from HERE. renderDriftNudge returns the
        new drift string the README example must quote (lead 'Previous turn added ~4.2k tokens to your context'
        UNCHANGED; tail 'If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a
        result.').
  critical: "The renderer OUTPUT strings contain LITERAL backticks around tool names (renderBloatReminder line
             270 uses \\` escapes inside the template literal → the output has real backticks). The README
             drift example must represent this string; nested backticks need the double-backtick span (GOTCHA #1)."

# MUST READ — the delta-006 touchpoint map (confirms README lines 151/224/225 are the whole doc edit)
- file: plan/006_5b685875f3df/architecture/system_context.md
  why: §Documentation row: 'README.md | 1+2 | Line ~151: four-field→three-field, list avoid removal. Line ~224:
        ~30 tokens→~20 tokens. Line ~225: drift nudge example→new short form (drop mulligan_audit clause).'
        Confirms the 3-line edit set and that NO other README region needs changes.
  critical: "Confirms this is the ONLY doc file touched by delta-006 and the edit set is exactly {151,224,225}."

# CONTEXT — the sibling contracts (new nudge strings; no file overlap)
- file: plan/006_5b685875f3df/P1M2T1S2/PRP.md
  why: CONTRACT. P1.M2.T1.S2 (parallel sibling) updates test/notes.test.ts pinned assertions to the new nudge
        strings. Gives the VERBATIM new renderDriftNudge output the README example must match. Touches ONLY
        test/notes.test.ts → zero overlap with README.
  gotcha: "The sibling's new DRIFT_TAIL is '. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink`
           to compact a result.' — this is the exact tail the README example quotes. READ-ONLY."

# SHOULD READ — the spec the nudge text must match (cross-check)
- docfile: spec/07-preventive-and-nudges.md
  why: "§1 (renderBloatReminder) + §2 (renderDriftNudge) prescribe the short text + the ~20-token cost.
        Cross-check that the README example matches the spec."
  section: "§1 (h3.50 renderBloatReminder); §2 (h3.55 renderDriftNudge). READ-ONLY."
```

### Current Codebase tree (the relevant slice)

```bash
README.md                     # ← EDIT: line 151 (note blurb), 224 (~20 tokens), 225 (drift example)
src/notes.ts                  # READ-ONLY — NoteInput (3 fields) + renderBloatReminder/renderDriftNudge (source of truth)
test/notes.test.ts            # READ-ONLY — parallel sibling P1.M2.T1.S2 edits this (NOT README)
spec/07-preventive-and-nudges.md  # READ-ONLY — §1/§2 nudge text cross-check
plan/006_5b685875f3df/architecture/system_context.md  # READ-ONLY — touchpoint map (confirms edit set)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
README.md   # 3 line-level edits: 151 (three-field note blurb), 224 (~20 tokens), 225 (short drift example)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (NESTED BACKTICKS in edit c — the #1 rendering trap): README:225's drift example is a
#   markdown INLINE-CODE span. The CURRENT example uses a SINGLE-backtick span with PLAIN tool names
#   (`mulligan_rewind` written without inner backticks), so it renders cleanly. The NEW example string (from
#   renderDriftNudge) contains LITERAL backticks around the tool names (the renderer emits them — verified:
#   renderBloatReminder src/notes.ts:270 uses \` escapes → output has real backticks). If you keep the single
#   outer backtick AND add inner backticks, markdown sees ` … `mulligan_rewind` … ` as THREE broken spans.
#   FIX: use a DOUBLE-backtick outer code span (`` `` … `` ``) — markdown renders a double-backtick span as
#   code containing single backticks. So the README bytes become:
#     (e.g. ``Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.``)
#   (Alt: drop the code span, inline-code the tool names, wrap the example in double-quotes — also clean.
#   The double-backtick span is preferred because it preserves the "this is the exact injected string" visual.)

# CRITICAL GOTCHA #2 (README:19 "avoid" is a FALSE POSITIVE — DO NOT TOUCH): line 19 reads "the agent has no
#   built-in signal that it is drifting toward an auto-compaction it would rather avoid." The word "avoid"
#   here is a VERB ("compaction it would rather avoid"), NOT the NoteInput.avoid field. Contract step (d) says
#   grep for 'avoid' — the INTENT is stale note-field references, not every English "avoid". Line 19 is the
#   ONLY other "avoid" in the README and it is CORRECT. Leave it. (Verified: the note-field "avoid" lived only
#   on line 151, which edit (a) removes.)

# CRITICAL GOTCHA #3 (use TEXT anchors, not line numbers): lines 151, 224, 225 are stable NOW, but if any
#   edit above shifts them, find by the unique substrings quoted in Implementation Tasks (the blurb's
#   "four-field note", the "~30 tokens" clause, the "If that growth was wasteful" example) — each is unique
#   in the file.

# CRITICAL GOTCHA #4 (edit a rewrites the WHOLE line 151, not a substring): the note blurb is one long line.
#   Replace the entire sentence from "**The four-field note" through "most-recent context." with the new
#   three-field sentence (verbatim, from Implementation Tasks). Do NOT try to surgically edit "four"→"three"
#   and drop "avoid" in place — the field descriptions ALL change too (what_happened gains "the lesson to
#   avoid repeating"; true_current_state becomes "task progress, decisions, and conclusions"; the file-ledger
#   parenthetical is reworded). One whole-line replacement.

# CRITICAL GOTCHA #5 (the field SEMANTICS must match NoteInput): the new what_happened description is "what
#   happened and the lesson to avoid repeating" (the `avoid` lesson is folded IN — this is the whole point of
#   M1). Do NOT write "what went wrong" alone (that's the OLD description) — the lesson must be mentioned.
#   true_current_state is "task progress, decisions, and conclusions — files/commands are auto-captured in the
#   ledger" (NOT "files changed, commands run, decisions made on the discarded span" — that's the OLD wording).

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/notes.ts, src/tools/rewind.ts, src/nudges.ts → M1/M2 own these; READ-ONLY.
#   - test/* → parallel sibling P1.M2.T1.S2 owns test/notes.test.ts; no README test exists.
#   - spec/* → READ-ONLY (spec/07 is the cross-check source).
#   - README:19's "avoid" (false positive — legitimate English verb).
#   - §7 Known Limitations / config table / §2 — verified clean (no note-field references).
# This PRP edits ONLY README.md lines 151, 224, 225.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a 3-line markdown prose sync. The "model" is the mapping from the stale README
text to the landed source-of-truth strings in `src/notes.ts`._

### Implementation Tasks (ordered by dependencies)

Three independent line-level edits; apply in any order. Use TEXT anchors (the unique substrings), not line numbers.

```yaml
Task 1: EDIT README.md — line 151 (the note blurb: four-field → three-field)
  - FIND (verbatim current — the WHOLE blurb line; unique anchor):
      "**The four-field note (confabulation defense).** A rewind requires a `note` with four non-empty fields — `what_happened` (what went wrong), `avoid` (what not to do again), `true_current_state` (files changed, commands run, decisions made on the discarded span — a deterministic file ledger is auto-appended here), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context."
  - REPLACE WITH (verbatim — mirrors src/notes.ts NoteInput; from contract step a):
      "**The three-field note (confabulation defense).** A rewind requires a `note` with three non-empty fields — `what_happened` (what happened and the lesson to avoid repeating), `true_current_state` (task progress, decisions, and conclusions — files/commands are auto-captured in the ledger), and `next` (the immediate next action). Vacuous notes are refused. The resumed model reads this note as the most-recent context."
  - RATIONALE: M1 removed NoteInput.avoid; the lesson is folded into what_happened. The 3 field descriptions
    match src/notes.ts (what_happened JSDoc: "what went wrong … and what to avoid doing again").
  - PRESERVE: the leading "**The … note (confabulation defense).**" framing; the "Vacuous notes are refused.
    The resumed model reads this note as the most-recent context." closing (unchanged).
  - DO NOT: surgically edit "four"→"three" and drop "avoid" in place — ALL field descriptions change (GOTCHA #4/#5).

Task 2: EDIT README.md — line 224 (~30 tokens → ~20 tokens)
  - FIND (verbatim substring, unique): "and costs ~30 tokens, once, only when the threshold is crossed."
  - REPLACE WITH: "and costs ~20 tokens, once, only when the threshold is crossed."
  - RATIONALE: renderBloatReminder JSDoc (src/notes.ts:249) now says "~20 tokens". The README must match.
  - DO NOT: change any other text on line 224 (the threshold/per-tool wording is unchanged).

Task 3: EDIT README.md — line 225 (the drift-nudge example → new short form)
  - FIND (verbatim current — the backtick-wrapped example substring, unique):
      "`Previous turn added ~4.2k tokens to your context. If that growth was wasteful, call mulligan_rewind or mulligan_shrink; run mulligan_audit for a breakdown.`"
    (this is a SINGLE-backtick code span with PLAIN tool names)
  - REPLACE WITH (new short form — renderDriftNudge output; DOUBLE-backtick outer span for the inner backticks):
      "``Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result.``"
  - RATIONALE: M2 re-shortened renderDriftNudge (drop "that growth was", convert parentheticals to "to
    undo/compact", remove the "; run mulligan_audit" clause). The lead "Previous turn added ~4.2k tokens to
    your context" is UNCHANGED. The new string quotes renderDriftNudge's actual output (per P1M2T1S1/S2).
  - ⚠ DOUBLE-BACKTICK (GOTCHA #1): the new example contains inner backticks around the tool names. A single
    outer backtick would break markdown. The `` `` … `` `` double-backtick span renders the inner single
    backticks literally. (If you prefer, drop the code span and inline-code the tool names with double-quotes
    around the example — both are acceptable; double-backtick is preferred to preserve the "exact string" look.)
  - DO NOT: change the surrounding prose on line 225 (the windowed/delta-only/never-persisted explanation is
    unchanged) — only the parenthetical example sentence changes.

Task 4: VERIFY — comprehensive stale-reference grep (contract step d)
  - RUN (each must print NOTHING):
      grep -niE 'four[- ]field|all four|four non-empty' README.md
      grep -nE '~30 tokens' README.md
      grep -nE 'mulligan_audit for a breakdown|If that growth was wasteful' README.md
  - RUN (confirms the FALSE POSITIVE stays — should STILL print line 19):
      grep -nE '\bavoid\b' README.md   # EXPECT: line 19 (the verb) + line 151 (now "the lesson to avoid
                                       # repeating" — that's the NEW wording, correct) + NO others.
  - Note: after edit (a), line 151 will contain "avoid" inside "the lesson to avoid repeating" — that is the
    NEW, CORRECT wording (the lesson is folded into what_happened). It is NOT a stale reference. Line 19's
    "avoid" (the verb) is also correct. So the post-edit grep for "avoid" should show exactly lines 19 and 151.
```

### Implementation Patterns & Key Details

The three edits and their source-of-truth anchors:

```markdown
# Edit (a) — line 151: the note blurb.
#   Source of truth: src/notes.ts NoteInput (3 fields: what_happened/true_current_state/next, no avoid) +
#   what_happened JSDoc ("what went wrong … and what to avoid doing again" — the lesson is folded in).
#   The README blurb must say "three-field" and describe what_happened as "what happened and the lesson to
#   avoid repeating" (NOT just "what went wrong").

# Edit (b) — line 224: the bloat cost.
#   Source of truth: src/notes.ts renderBloatReminder JSDoc (line 249): "~20 tokens".
#   One-token change: ~30 → ~20.

# Edit (c) — line 225: the drift example.
#   Source of truth: renderDriftNudge output (per P1M2T1S1/S2): the string
#     "Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or
#      `mulligan_shrink` to compact a result."
#   (lead UNCHANGED; tail is the new short form; the string CONTAINS literal backticks around tool names).
#   The README must represent this string in markdown → use a DOUBLE-backtick code span (`` `` … `` ``) so the
#   inner single backticks render. (GOTCHA #1.)

# MARKDOWN CHECK: after the edits, the README should render line 225's example as a single code span showing
#   the full sentence with `mulligan_rewind`/`mulligan_shrink` as inline code. If a markdown linter or GitHub
#   preview shows broken spans, you used a single outer backtick — switch to double (`` `` ``).
```

### Integration Points

```yaml
NO CODE/CONFIG/ROUTE INTEGRATION — documentation-only (Mode B).
  - DATABASE: none
  - CONFIG: none (README is not config)
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY; this task quotes src/notes.ts as the source of truth but edits nothing)
  - TESTS: none (parallel sibling P1.M2.T1.S2 owns test/notes.test.ts; no README tests exist)
  - DOCS: README.md ONLY. This IS the [Mode B] changeset-level doc sync — no further doc subtask.
  - The only "integration" is DOC CONSISTENCY: the README must AGREE with src/notes.ts (NoteInput 3 fields,
    renderBloatReminder ~20 tokens, renderDriftNudge short form) and spec/07 (§1/§2). The grep gates enforce this.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S2 edits test/notes.test.ts — different file, no overlap, any order.
```

---

## Validation Loop

A README-only edit cannot break the build. Validation = grep confirms no stale refs remain + the markdown
renders correctly + (optional) the typecheck/test suite is unaffected (it reflects sibling state, not this task).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The three edits landed:
grep -n "three-field note (confabulation defense)" README.md    # EXPECT: line 151 (the new blurb).
grep -n "costs ~20 tokens" README.md                            # EXPECT: line 224.
grep -n "If wasteful, \`mulligan_rewind\` to undo the turn" README.md  # EXPECT: line 225 (new example).

# (b) The stale terms are GONE (each must print NOTHING):
grep -niE 'four[- ]field|all four|four non-empty' README.md     # EXPECT: no output.
grep -nE '~30 tokens' README.md                                 # EXPECT: no output.
grep -nE 'mulligan_audit for a breakdown|If that growth was wasteful' README.md  # EXPECT: no output.

# (c) The false positive stays + the new "avoid repeating" wording is present:
grep -nE '\bavoid\b' README.md
# EXPECT: line 19 ("auto-compaction it would rather avoid" — the verb, CORRECT) +
#         line 151 ("the lesson to avoid repeating" — the NEW what_happened wording, CORRECT). NO others.
```
Expected: (a) three hits (the new text); (b) no output; (c) exactly lines 19 + 151.

### Level 2: Markdown rendering check (the nested-backtick gate)

```bash
# Confirm edit (c) used a DOUBLE-backtick outer span (not single) so the inner tool-name backticks render.
# Inspect the raw bytes around the example:
grep -n 'Previous turn added ~4.2k tokens' README.md
# EXPECT (raw bytes): the example is wrapped in `` `` … `` `` (double backticks), with single backticks around
#   `mulligan_rewind` and `mulligan_shrink` inside. If you see a single leading/trailing backtick with inner
#   backticks, markdown will break — re-apply Task 3 with the double-backtick span (GOTCHA #1).

# Optional: render-check with a markdown tool if available (e.g., glow / mdcat / a GitHub preview). The example
# should display as ONE code span containing the full sentence with inline-coded tool names — not three spans.
```
Expected: the example is a double-backtick code span; renders as a single span.

### Level 3: Build + tests (no-regression sanity — README edits are non-behavioral)

```bash
# README edits CANNOT affect tsc or vitest (no code/test touched). Run them only as a no-regression sanity
# check. NOTE: the parallel sibling P1.M2.T1.S2 is in flight and the in-progress M1.T1.S3 may leave up to 2
# pre-existing errors (notes.test.ts:323, rewind.test.ts:843); those are NOT caused by this README task.
npm run typecheck 2>&1 | tail -3   # = tsc --noEmit. EXPECT: no NEW errors introduced by this task.
echo "typecheck exit: $?"
npx vitest run 2>&1 | grep -iE 'test files|tests passed|tests failed' | tail -2  # EXPECT: suite state unchanged.
```
Expected: typecheck/test results UNCHANGED vs. pre-edit (README edits are provably non-behavioral). Any failures
reflect sibling state, not this task — confirm via `git diff --name-only` (only README.md changed by THIS task).

### Level 4: Cross-doc consistency (system validation)

```bash
# The README must AGREE with the source of truth (src/notes.ts) and the spec (spec/07).
echo "--- README note blurb ---";  grep -n "three-field note" README.md
echo "--- src/notes.ts NoteInput ---"; grep -nE "what_happened: string|true_current_state: string|next: string" src/notes.ts | head
echo "--- README bloat cost ---"; grep -n "costs ~20 tokens" README.md
echo "--- src/notes.ts cost JSDoc ---"; grep -n "~20 tokens" src/notes.ts
echo "--- spec/07 renderDriftNudge (short form) ---"; grep -nE "If wasteful|to undo the turn|to compact" spec/07-preventive-and-nudges.md | head
```
Expected: README:151 lists the same 3 fields as NoteInput; README:224 ~20 tokens matches notes.ts JSDoc;
README:225's drift example matches spec/07 §2's short form.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
git diff --stat   # EXPECT: README.md ONLY.
git diff --name-only | grep -vE '^README.md$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/notes.ts, test/notes.test.ts, spec/* must NOT appear (those are siblings'/read-only).
```
Expected: only `README.md` in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: the three new strings are present (three-field blurb, ~20 tokens, short drift example); the
      stale-term greps print nothing; "avoid" appears only on lines 19 + 151 (both correct).
- [ ] Level 2: edit (c) is a DOUBLE-backtick code span; the example renders as one span (no broken markdown).
- [ ] Level 3: `npm run typecheck` / `npx vitest run` UNCHANGED (README edits are non-behavioral; any failures
      are sibling state — confirm via `git diff --name-only`).
- [ ] Level 4: README agrees with src/notes.ts (3 fields, ~20 tokens) and spec/07 (short drift form).
- [ ] Level 5: `git diff --name-only` shows ONLY `README.md`.

### Feature Validation
- [ ] README:151 reads "**The three-field note**" with `what_happened`/`true_current_state`/`next` (no avoid).
- [ ] README:151's `what_happened` description includes "the lesson to avoid repeating" (the folded lesson).
- [ ] README:224 reads "~20 tokens".
- [ ] README:225's drift example is the new short form (no `mulligan_audit`, no "If that growth was wasteful").
- [ ] README:19's "avoid" (the verb) is UNCHANGED (false positive).
- [ ] Comprehensive grep finds zero stale references (four-field, ~30 tokens, mulligan_audit-for-breakdown, etc.).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `README.md` (3 lines: 151, 224, 225).
- [ ] Did NOT edit any `src/*` (M1/M2 own them; READ-ONLY source of truth).
- [ ] Did NOT edit `test/*` (parallel sibling P1.M2.T1.S2 owns test/notes.test.ts).
- [ ] Did NOT edit `spec/*` (read-only cross-check).
- [ ] Did NOT touch README:19's "avoid" (false positive — legitimate English verb).
- [ ] Used TEXT anchors (unique substrings), not line numbers, for the find/replace.

### Documentation
- [ ] [Mode B] this IS the changeset-level doc sync — README now matches the landed delta-006 behavior.
- [ ] The note blurb, bloat cost, and drift example all quote the source-of-truth strings (src/notes.ts).

---

## Anti-Patterns to Avoid

- ❌ Don't use a SINGLE outer backtick for edit (c) with inner tool-name backticks — markdown breaks into
  multiple spans. Use a DOUBLE-backtick code span (`` `` … `` ``) so the inner backticks render. (GOTCHA #1.)
- ❌ Don't "fix" README:19's "avoid" — it's a verb ("compaction it would rather avoid"), not the NoteInput.avoid
  field. It's the only false positive in the grep; leave it. (GOTCHA #2.)
- ❌ Don't surgically edit line 151 (change "four"→"three" + drop "avoid" in place). ALL field descriptions
  change in this delta — replace the WHOLE blurb line with the verbatim new sentence. (GOTCHA #4/#5.)
- ❌ Don't keep the OLD `what_happened` description ("what went wrong"). The new one folds the lesson in:
  "what happened and the lesson to avoid repeating" — that's the whole point of M1.
- ❌ Don't change the surrounding prose on line 225 (the windowed/delta-only/never-persisted explanation). Only
  the parenthetical example sentence changes.
- ❌ Don't edit `src/notes.ts`, `src/tools/rewind.ts`, `test/notes.test.ts`, or `spec/*` — those are siblings'/
  read-only. This task edits ONLY README.md.
- ❌ Don't add a `mulligan_audit` reference back anywhere — M2 explicitly dropped it from the drift nudge; the
  README must not re-advertise it in the example.
- ❌ Don't run only `npm run typecheck`/`npx vitest run` and call it validated — those are no-regression sanity
  only (README edits can't fail them). The REAL gate is the stale-reference grep (Level 1) + the markdown
  render check (Level 2).
- ❌ Don't use line numbers as the find anchor — use the unique substrings (the blurb text, "~30 tokens",
  "If that growth was wasteful") so the edit is robust to any line shifts.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 3-line markdown prose sync with: the verbatim FIND and
REPLACE for every edit (anchored on unique substrings, not line numbers), the source-of-truth strings verified
in `src/notes.ts` (post-M1 [Complete]: 3-field NoteInput, ~20-token JSDoc, short renderers), the comprehensive
stale-reference audit proving the edit set is exactly {151, 224, 225}, the explicit false-positive call-out
(README:19 "avoid" stays), and deterministic grep gates. The two residual risks — both clearly flagged — are
(1) the nested-backtick markdown trap in edit (c) (mitigated by GOTCHA #1's double-backtick solution + the
Level 2 render check) and (2) accidentally surgical-editing line 151 instead of replacing the whole blurb
(mitigated by GOTCHA #4/#5 + the verbatim whole-line REPLACE). The README edits are provably non-behavioral, so
typecheck/tests are guaranteed unchanged by THIS task (any in-flight sibling state is documented). No dependency
on the parallel sibling beyond quoting the same source-of-truth strings.