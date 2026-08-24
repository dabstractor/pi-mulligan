name: "P1.M4.T2.S1 — README.md v2.0 sync: shrink blurb, drift paragraph, E19 note, matcher lists, BUG-004 note"
description: Update README.md's five verified stale surfaces to the shipped v2.0 current-turn semantics — shrink blurb + hard-refusal sentence, two-arm matcher lists (shrink :169, cancel :187/:189), E19 moot rewording, awareness-only drift-nudge paragraph (:234), historical BUG-004 note (:266) — plus a sanity sweep for remaining three-arm/past-turn language. README.md only.
---

## Goal

**Feature Goal**: README.md describes the shipped v2.0 behavior everywhere: shrink is current-turn-only with a hard refusal for earlier-turn targets; both matcher lists (shrink + cancel hint shapes) show two arms; the E19 note marks the non-toolResult shrink case as moot under v2.0; the drift-nudge paragraph quotes the v2.0 awareness-only tail; the v1.0 BUG-004 note is marked historical.

**Deliverable**: Modified `README.md` — nothing else.

**Success Definition**: `grep -nE "by_content_includes|If wasteful|any role" README.md` returns **0** hits (BUG-004 note reworded to name the arm without matching the grep? — NO: the BUG-004 note must be reworded to avoid the literal `by_content_includes` string while remaining accurate, see Task 6); `git status` shows only README.md changed; all internal anchors still resolve.

## Why

- v2.0 removed the `by_content_includes` arm (P1.M1.T1.S1), hard-refuses out-of-current-turn targets (P1.M2.T1.S2), made the drift nudge awareness-only (P1.M3.T1.S1), and moved cancel to a two-arm union (P1.M2.T3.S1). All four shipped — README.md still describes the v1.x three-arm, past-turn, prescribing-nudge behavior at six verified locations. This is R6 changeset-level documentation (Mode B: this IS the docs task).
- Sibling P1.M4.T2.S2 (a LATER task) does the broader stale-reference grep sweep including VERIFICATION.md — do NOT touch VERIFICATION.md or do the wrap-up notes here.

## What

Edit README.md only. Sources of truth are the shipped strings in `src/` (verbatim below — do not paraphrase the exact quoted fragments).

### Success Criteria

- [ ] Shrink blurb (:~157) teaches current-turn eligibility + the hard-refusal sentence
- [ ] Shrink target-matcher list (:~169) shows exactly two arms with CURRENT-TURN wording
- [ ] E19 trust note (:~173) marks E19 moot under v2.0, keeps view-substitution/`/tree` framing, drops user-message-shrink framing
- [ ] Cancel hint-shape mentions (:~187 and :~189) list two arms only
- [ ] Drift-nudge paragraph (:~234) quotes the v2.0 tail and notes awareness-only (Nudge A prescribes)
- [ ] BUG-004 note (:~266) marked historical (v1.x; arm removed in v2.0) without the literal removed-arm identifier
- [ ] Sanity sweep: no other three-arm / past-turn shrink language remains

## All Needed Context

### Context Completeness Check

Every edit site is pinned with its current text and the exact replacement content (drawn from the shipped source strings). An agent with zero prior knowledge can perform this with only README.md and this PRP.

### Documentation & References

```yaml
- file: src/tools/shrink.ts
  why: SHRINK_DESC (:119, v2.0 blurb wording) and the exact hard-refusal string (:368); ShrinkParams field descriptions (:67ff) for matcher-list wording
  pattern: copy phrases verbatim where the README quotes tool-facing text
  gotcha: refusal string is exact — "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk." (earlier-turn, no-in-turn-match, and structurally-invalid all share it)

- file: src/notes.ts
  why: renderDriftNudge v2.0 tail (:340) — the string README:234 must quote
  pattern: quote only the tail + a sample lead ("Previous turn added ~4.2k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.")

- file: src/tools/cancel.ts
  why: CANCEL_DESC (:137) — two-arm hint-shape enumeration "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence)"

- file: plan/008_1c8ca4d1826d/architecture/_scouts/nudges-docs.md
  why: §3 has the verified README hit map with line numbers and current verbatim text for all six sites

- file: plan/008_1c8ca4d1826d/P1M4T1S3/PRP.md
  why: parallel integration task — confirms v2.0 semantics contract (in-span match → pinned marker; earlier-turn → hard refusal); no file overlap (it touches test/integration/ only)

- file: README.md
  why: THE edit target; ~157, ~169, ~173, ~187-189, ~234, ~266 per the scout map
  gotcha: line numbers drift — locate by the verbatim quoted text, not the line number
```

### Current Codebase tree (relevant slice)

```bash
README.md          # edit target (docs surface for the extension)
VERIFICATION.md    # NOT this task (T2.S2 owns it)
src/tools/shrink.ts, src/tools/cancel.ts, src/notes.ts  # read-only sources of truth
spec/              # read-only; already known-stale in places — README mirrors SRC, not spec
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
README.md  # MODIFIED — consistent with shipped v2.0 (no new files)
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: README quotes must match src/ strings exactly where they quote tool-facing text
#   (grep-locked in tests elsewhere; README is human docs but mirrors the same sources).
# GOTCHA: the removed arm's identifier ("by_content_includes") must have ZERO occurrences in
#   README after this task — including inside the BUG-004 historical note (reword it).
# GOTCHA: keep the "[Human commands (v1.1)](#human-commands-v11)" anchor and all other
#   markdown links intact — the sections around the edits are untouched.
# GOTCHA: cancel hint resolution stays FULL-HISTORY under v2.0 (only the covering-marker
#   check is span-bound) — do not introduce current-turn wording into the cancel HINT text.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — shrink blurb (~:157)
  - FIND: "> Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."
  - REPLACE with (mirrors SHRINK_DESC, src/tools/shrink.ts:119):
    "> Replace the current turn's tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Only results from THIS turn can be shrunk — a target from an earlier turn is refused outright. Unlike rewind, the call stays in context (just with your summary as its result)."
  - KEEP: the surrounding "When to use it (vs mulligan_rewind)" paragraph (still accurate)

Task 2: EDIT README.md — target matcher list (~:169)
  - FIND the three-bullet list under "**Target matchers** (resolved live each turn, robust to compaction):" with the `by_content_includes` bullet "(any role)"
  - REPLACE the three bullets with TWO, and re-scope the intro to current-turn:
    "**Target matchers** (both resolve only within the current turn's tool-result span, live each turn, robust to compaction):"
    - `by_tool_call_id` — the unique toolCallId of the result to shrink — must be a call from the CURRENT turn.
    - `by_tool_name` + `occurrence` (`"last"` / `"first"`) — first/last matching result within the current turn.
  - ADD one sentence after the bullets: a selector that resolves only in an earlier turn — or has no match this turn — is a hard refusal: "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk." (v2.0; the pre-v2.0 substring arm is removed.)

Task 3: EDIT README.md — E19 trust note (~:173)
  - FIND: "**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: the original message stays on disk and is recoverable by the human via `/tree`, so only the model's in-context copy is replaced — even summarizing a user message (E19) is lossless at the session level."
  - REPLACE with: keep the view-substitution + `/tree` framing verbatim up through "copy is replaced", then close with: "— this is lossless at the session level. (The old E19 concern — shrinking a non-tool-result message such as a user prompt — is moot under v2.0: only current-turn tool results are eligible targets, so a non-toolResult shrink is no longer expressible.)"

Task 4: EDIT README.md — cancel hint shapes (~:187 and ~:189)
  - Site A (~:187, blurb): "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes)" → "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence)"  [verbatim match with CANCEL_DESC, src/tools/cancel.ts:137]
  - Site B (~:189, when-to-use): "(`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`)" → "(`by_tool_call_id` / `by_tool_name`+`occurrence`)"
  - PRESERVE the "resolved live each turn" phrase — hint resolution is full-history under v2.0 and stays correct

Task 5: EDIT README.md — drift-nudge paragraph (~:234, item 2 under "Ride-along nudges")
  - FIND the quoted old nudge string: "Previous turn added ~4.2k tokens to your context. If wasteful, `mulligan_rewind` to undo the turn or `mulligan_shrink` to compact a result."
  - REPLACE the quoted example with the v2.0 string (src/notes.ts:340): "Previous turn added ~4.2k tokens to your context. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them."
  - APPEND one sentence to the same paragraph: "The nudge is **awareness-only** (v2.0): the turn it reports on is already out of modification scope, so it may not prescribe rewind/shrink — the bloated-result reminder (Nudge A, item 1 above) is the only prescribing nudge."
  - KEEP the windowing/agent-attributable/delta-only sentences (still accurate)

Task 6: EDIT README.md — BUG-004 note (~:266, v1.0 round)
  - FIND: "- **BUG-004 (Minor)** — `mulligan_shrink` `by_content_includes` with an empty substring now matches nothing (returns null)."
  - REPLACE with: "- **BUG-004 (Minor, v1.x — historical)** — `mulligan_shrink`'s former substring matcher (`by_content_includes` …) with an empty substring now matches nothing (returns null). In v2.0 that matcher arm was removed entirely; the fix remains as defense-in-depth for the legacy read path."
    (Adjust so the literal removed-arm identifier appears at most in a clearly historical framing — the goal is zero grep hits for `by_content_includes`; if keeping the identifier, that is acceptable ONLY if you prefer accuracy over the grep gate — prefer rewording without it.)

Task 7: SANITY SWEEP README.md
  - RUN: grep -nE "by_content_includes|any role|If wasteful|past tool result|three matcher|three-arm" README.md
  - FIX any remaining hit in tool tables / features sections (e.g. §3 features table, §4 tool sections, §5 How It Works) with the same two-arm / current-turn wording
  - The §5 "How It Works" shrink sentence ("substitutes content in place …") is still accurate — leave unless it mentions past turns

### Implementation Patterns & Key Details

```text
# PATTERN: README mirrors SHIPPED SRC strings, not spec/ (spec is known-stale in places).
# Exact quotes to embed (already in Tasks above):
#   hard refusal: "Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk."
#   drift tail:   "Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them."
# CRITICAL: do not touch VERIFICATION.md, spec/, src/, test/ — those belong to other tasks.
```

### Integration Points

```yaml
DOCS:
  - file: README.md only
  - downstream: P1.M4.T2.S2 runs a stale-reference grep sweep over README + VERIFICATION.md —
    leave VERIFICATION.md's BUG-004 row for it; your README BUG-004 rewording should not
    reference VERIFICATION.md sections that don't exist.
```

## Validation Loop

### Level 1: Grep gates (deterministic)

```bash
# Zero hits expected (after BUG-004 rewording choice — see Task 6):
grep -nE "by_content_includes" README.md
# Zero hits expected:
grep -nE "any role|If wasteful|past tool result" README.md
# Should still hit (new content present):
grep -n "only this turn's tool calls can be shrunk" README.md
grep -n "Keep this turn's outputs lean" README.md
grep -n "awareness-only" README.md
```

### Level 2: Anchor & structure integrity

```bash
# Internal anchors still resolve (grep each link target heading exists):
grep -n "#human-commands-v11" README.md   # link still present
grep -n "^### \`mulligan_shrink\`" README.md   # section intact
# Only README.md changed:
git status --porcelain   # expect exactly one modified file
```

### Level 3: Manual read-through

Read the edited sections end-to-end (§4 mulligan_shrink, §4 mulligan_cancel, §5 nudges item 2, §7 BUG-004 list) and confirm no remaining three-arm or past-turn shrink language and no contradiction with §5 "How It Works".

### Level 4: N/A (docs-only task — no build/test surface changes)

```bash
# Optional regression: repo still builds/tests untouched
npm run typecheck   # expect clean (no src changes made)
```

## Final Validation Checklist

### Technical Validation
- [ ] All grep gates pass (Level 1)
- [ ] `git status --porcelain` shows only README.md
- [ ] No broken markdown anchors introduced

### Feature Validation
- [ ] All 7 success criteria from "What" met
- [ ] README quotes match src/ strings exactly (refusal line, drift tail, cancel hint shape)
- [ ] E19 note keeps the `/tree` view-substitution invariant framing

### Code Quality Validation
- [ ] Prose style consistent with surrounding README voice (bold lead-ins, spec citations like `spec/05-tools.md` §2 preserved where still true)
- [ ] No edits outside README.md

---

## Anti-Patterns to Avoid

- ❌ Don't "improve" surrounding README sections that are already accurate — minimal-diff docs sync
- ❌ Don't copy wording from spec/ files (known-stale) — mirror shipped src/ strings
- ❌ Don't introduce current-turn scope into the cancel HINT text (hints resolve full-history in v2.0)
- ❌ Don't delete the BUG-004 audit-history entry — mark it historical instead