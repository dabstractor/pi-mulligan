name: "P3.M4.T1.S2 — Add mulligan_cancel to README tools list"
description: |
  Docs-only (Mode B) task. Add the `mulligan_cancel` tool to README.md §4 "Tools":
  change the intro count "four agent-callable tools" → "five", and append a
  `### \`mulligan_cancel\`` entry (5th, after `mulligan_audit`) whose blockquote is the
  VERBATIM `CANCEL_DESC` string from `src/tools/cancel.ts` and whose "When to use it"
  is condensed from `spec/05-tools.md` §5, framed as the safety valve for mis-targeted
  rewinds/shrinks (softens D6). The tool already shipped (P3.M1.T3.S1 COMPLETE). No
  source changes, no tests. Edit ONLY §4 — §3 (S1) and the feature blurbs (§1/§5/§6/§7/
  Further-reading = S3) are out of scope.

---

## Goal

**Feature Goal**: Make README.md §4 "Tools" reflect the five tools that actually ship —
the `mulligan_cancel` tool (marker retraction, P3.M1.T3.S1, COMPLETE) is currently absent
from the list and the intro still says "four agent-callable tools".

**Deliverable**: An edited `README.md` §4 — (a) intro line reads "Mulligan registers
**five** agent-callable tools"; (b) a new `### \`mulligan_cancel\`` subsection appended
**after `### \`mulligan_audit\``** and before the `---` / `## 5. How It Works` separator,
following the established §4 convention: a blockquote holding the verbatim `CANCEL_DESC`
description, followed by a `**When to use it:**` paragraph (safety-valve framing).

**Success Definition**: (1) §4 lists exactly five tool subsections including
`mulligan_cancel`; (2) the `mulligan_cancel` blockquote is byte-identical to
`CANCEL_DESC` in `src/tools/cancel.ts`; (3) the intro count reads "five"; (4) no edits
outside §4 (§3 config = S1; §1/§5/§6/§7/Further-reading blurbs = S3).

## User Persona (if applicable)

**Target User**: A human (developer / operator) reading README §4 to learn what the agent
can now do.
**Use Case**: Scanning the tools list to understand the agent's context-shedding surface.
**Pain Points Addressed**: README §4 currently omits a tool that already ships, so a human
comparing README ↔ `src/tools/` sees drift and doesn't learn the marker-retraction escape
hatch exists.

## Why

- **Documentation correctness**: the README is the public surface for "what the agent can
  do"; it must list every shipped tool. `mulligan_cancel` shipped in P3.M1.T3.S1.
- **Completes part of P3.M4.T1 (changeset-level docs sync)**: this is task S2 of 3. S1
  (README §3 config) is done/doing; S3 (feature blurbs: windowed drift, high-water,
  marker retraction — incl. the §7 D6 amendment) is separate and MUST NOT be touched here.
- Low risk: documentation-only, no runtime/build/test impact (README is imported by
  nothing — `grep -rl README src/ test/` is empty).

## What

Edit **only** `README.md` §4 "Tools" (lines ~124–181). Concretely:

1. **Intro count** (line ~126): `Mulligan registers four agent-callable tools.` →
   `Mulligan registers five agent-callable tools.` (keep the rest of the sentence
   verbatim — the "verbatim copies of the LLM-facing description strings ... When-to-use
   guidance follows each one (from `spec/05-tools.md`)" clause stays).
2. **New subsection**: append `### \`mulligan_cancel\`` as the 5th entry, immediately
   **after** the `mulligan_audit` subsection's last paragraph
   ("...The audit is **read-only** and persists nothing.") and immediately **before** the
   `---` separator that precedes `## 5. How It Works`. Content:
   - A blockquote (`> ...`) holding the **verbatim** `CANCEL_DESC` string.
   - A `**When to use it:**` paragraph condensed from `spec/05-tools.md` §5, framed as
     the safety valve for mis-targeted rewinds/shrinks.
   - A short closing paragraph noting retraction is forward-only (no on-disk undo, no
     replay of hidden content — stays recoverable via `/tree`), and that this softens D6.

### Success Criteria

- [ ] §4 intro reads "Mulligan registers **five** agent-callable tools."
- [ ] §4 contains a `### \`mulligan_cancel\`` subsection placed 5th (after `mulligan_audit`).
- [ ] The `mulligan_cancel` blockquote is byte-identical to `CANCEL_DESC` in
      `src/tools/cancel.ts` (the verbatim LLM-facing description).
- [ ] A `**When to use it:**` paragraph frames it as the safety valve for mis-targeted
      `mulligan_rewind` / `mulligan_shrink` markers.
- [ ] No edits outside §4: §3 (S1), and §1/§5/§6/§7/"Further reading" (S3) untouched.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?" → **Yes.** The exact current README §4 text, the exact
verbatim `CANCEL_DESC` to quote, the exact `spec/05-tools.md` §5 source for the
"when to use" wording, and the exact placement are all quoted below. This is a
single-file, docs-only edit.

### Documentation & References

```yaml
# MUST READ — the authoritative verbatim description (the blockquote content)
- file: src/tools/cancel.ts
  why: "CANCEL_DESC (search `export const CANCEL_DESC`) is the LLM-facing description the
        agent sees at runtime. README §4's convention is that each blockquote is a VERBATIM
        copy of this string. Copy it byte-for-byte — it drives LLM usage."
  pattern: "The `export const CANCEL_DESC = \"...\" + \"...\"` string — concatenate the
            concatenated parts into one paragraph; do NOT reword."
  gotcha: "The README §4 intro explicitly states the blockquotes are 'verbatim copies of
           the LLM-facing description strings (from src/tools/*.ts)'. Do NOT paraphrase.
           A paraphrased blockquote violates the stated convention and is a defect."

# MUST READ — the authoritative "when to use" wording (condense FROM here)
- file: spec/05-tools.md
  why: "§5 `mulligan_cancel` (heading `## 5. \`mulligan_cancel\`` ~line 215): 'When the
        agent should use it' (~lines 222–223) is the source for the README's
        'When to use it' paragraph; 'Purpose' (~line 217) and 'What retraction is NOT'
        (~line 220) give the forward-only framing. §7 (~line 299) re-prints CANCEL_DESC
        verbatim — use it to cross-check the blockquote."
  section: "§5 `mulligan_cancel` (Purpose, When the agent should use it, What retraction is NOT)"

# The ONLY file to edit
- file: README.md
  why: "§4 'Tools' (lines ~124–181): the intro count line (~126) and the new subsection
        inserted after `### \`mulligan_audit\`` and before the `---` / `## 5` separator."
  pattern: "Existing §4 entries: a `### \`mulligan_<name>\`` heading, a `> ...` blockquote
            (verbatim desc), then a `**When to use it:**` paragraph. Match this exactly."
  gotcha: "Edit ONLY §4. §3 (config) = S1; §1/§5/§6/§7/'Further reading' (blurbs, incl.
           the §7 'No undo / D6' bullet and the 'Further reading' 'four tools' count) = S3.
           Editing those collides with the sequenced siblings."

# Contract framing pointer (the safety-valve framing the work item wants)
- url: in-repo plan/003_2c3b19ff6a7b/prd_snapshot.md (heading h2.99 "E21. Marker retraction")
  why: "E21 is the spec for marker retraction; the work-item contract says frame the entry
        as 'a safety valve for mis-targeted rewinds/shrinks' and that it 'softens the D6
        no-undo decision — markers are now retractable'. Mirror that framing in the
        'When to use it' + closing paragraph."
  critical: "Keep the D6 mention BRIEF in §4 (one clause). The full D6 amendment of §7
             Known Limitations is S3's job — do NOT edit §7 here."
```

### Current Codebase tree (relevant slice)

```bash
README.md                       # ← EDIT ONLY this file, §4 (lines ~124–181)
src/tools/cancel.ts             # ← READ ONLY (CANCEL_DESC — the verbatim blockquote source)
spec/05-tools.md                # ← READ ONLY (§5 "when to use" + §7 CANCEL_DESC cross-check)
plan/003_2c3b19ff6a7b/prd_snapshot.md   # ← READ ONLY (h2.99 E21 framing)
```

### Desired Codebase tree (no new files)

```bash
README.md                       # §4 updated in place — no files added or removed
```

### Exact current README §4 text (the before-state to edit)

**(A) Intro count — line ~126:**
```
Mulligan registers four agent-callable tools. The descriptions below are **verbatim copies** of the LLM-facing description strings the agent sees at runtime (from `src/tools/*.ts`) — they are the agent's documentation, reproduced here so a human knows exactly what the agent can now do. When-to-use guidance follows each one (from `spec/05-tools.md`).
```
→ change **only** `four` → `five`; leave the rest of the sentence verbatim.

**(B) Insertion point — the tail of the `mulligan_audit` subsection (line ~180), which
ends:**
```
The token total is computed from the **filtered view** (what the model actually sees after Mulligan's transforms) — *not* Pi's `getContextUsage()`, which would count already-hidden tokens. The audit is **read-only** and persists nothing.
```
→ insert the new `### \`mulligan_cancel\`` subsection **immediately after** this paragraph
and **before** the `\n\n---\n\n## 5. How It Works` separator.

**(C) The verbatim `CANCEL_DESC` to place in the blockquote** (concatenate the string parts
from `src/tools/cancel.ts` `CANCEL_DESC`; identical to `spec/05-tools.md` §7 line 299):
```
Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Scope boundary. This task = README §4 ONLY. Do NOT edit §3 (config = S1) or
# the feature blurbs §1/§5/§6/§7/"Further reading" (= S3). Two count references are OUTSIDE
# §4 and belong to S3 — leave them untouched:
#   1. §7 "Known Limitations" — the "No undo (D6). ... rewinds and shrinks are permanent"
#      bullet (S3 amends this for marker retraction).
#   2. "Further reading" — "spec/05-tools.md — the four tools' full specification." count.
# Editing either here collides with the sequenced S3 task.

# CRITICAL: The §4 blockquote MUST be a VERBATIM copy of CANCEL_DESC from src/tools/cancel.ts.
# The §4 intro explicitly promises "verbatim copies of the LLM-facing description strings".
# Paraphrasing the blockquote is a defect, even if more readable. Copy byte-for-byte.

# GOTCHA: Placement = 5th, AFTER mulligan_audit (NOT after shrink). Matches the canonical
# order in spec/05-tools.md (§1 rewind, §2 shrink, §3 checkpoint, §4 audit, §5 cancel) and
# the tool's own self-description ("FIFTH of the five" in src/tools/cancel.ts).

# GOTCHA: The em dash "—" in CANCEL_DESC is a real Unicode em dash (U+2014), not "--".
# Copy the string verbatim so the blockquote matches. Likewise the "—" appears in existing
# README prose; preserve it.

# GOTCHA: mulligan_cancel ALREADY EXISTS in src/tools/cancel.ts and is registered in
# src/index.ts (import line 11; pi.registerTool(makeCancelTool(pi)) line 42). This is a
# docs catch-up — do NOT touch any src/ file.

# GOTCHA: README is not imported by any code (grep `README` across src/ test/ → no hits), so
# there is no build/type-check/test impact. `npx tsc --noEmit` and `npm test` are unaffected
# and need NOT be re-run for this docs change (they remain green regardless).
```

## Implementation Blueprint

### Data models and structure

N/A — documentation-only. No data models, schemas, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — §4 intro count (line ~126)
  - CHANGE: "Mulligan registers four agent-callable tools." →
            "Mulligan registers five agent-callable tools."
  - PRESERVE: the rest of the sentence verbatim (the "verbatim copies of the LLM-facing
    description strings ... When-to-use guidance follows each one (from spec/05-tools.md)"
    clause).
  - WHY: §4 now lists five tools (cancel is the 5th).

Task 2: EDIT README.md — insert the `### `mulligan_cancel`` subsection (5th, after audit)
  - FIND: the mulligan_audit subsection's last paragraph, ending
          "...The audit is **read-only** and persists nothing."
  - INSERT IMMEDIATELY AFTER it (and before the "---" / "## 5. How It Works" separator):
      ### `mulligan_cancel`

      > <CANCEL_DESC verbatim — see "Exact current README §4 text (C)" above>

      **When to use it:** <condensed from spec/05-tools.md §5; safety-valve framing>

      <one short closing paragraph: retraction is forward-only; softens D6>

  - FOLLOW: the exact §4 entry convention (heading + blockquote + "When to use it:"
    paragraph). See the suggested wording below.
  - NAMING: heading is `### \`mulligan_cancel\`` (backticked name, matches the other four).
  - PRESERVE: the `---` separator and `## 5. How It Works` heading that follow — do not
    move or remove them; the new subsection slots in above the separator.

Task 3: VERIFY (no edits) — see Validation Loop Level 1–2.
```

### Suggested §4 entry wording (blockquote verbatim; prose condensed from spec/05 §5)

> NOTE: the blockquote below MUST be the verbatim `CANCEL_DESC`. The two prose paragraphs
> are a faithful condensation of `spec/05-tools.md` §5 (Purpose / When to use / What
> retraction is NOT) with the work-item's safety-valve framing — tighten if needed but keep
> the meaning; do NOT invent behavior.

````markdown
### `mulligan_cancel`

> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.

**When to use it:** the safety valve for a mis-targeted `mulligan_rewind` or `mulligan_shrink` — a shrink issued against the wrong message, a rewind that hid something you still need, or any marker pointed at the wrong target. Without it, the mistaken transform would apply on every turn for the rest of the session, and a `mulligan_rewind` of the issuing call does **not** retire it (markers are control entries outside the rewind's span). Pass the `markerId` you received in `details` when you issued the marker; the transform stops applying from the next turn on. Cancelling a non-existent or already-cancelled id is a safe no-op — call it freely if unsure.

Retraction is **forward-only**: it suppresses the marker from the filtered view going forward. It does **not** undo on-disk side effects (file edits and bash commands persist) or replay originally-hidden content into the live turn — that stays recoverable by the human via `/tree`. This softens D6: a mistaken marker is no longer irrevocably permanent.
````

### Implementation Patterns & Key Details

```markdown
# §4 entry shape to match (the existing four all follow this):
### `mulligan_<name>`
> <verbatim LLM-facing description string from src/tools/<name>.ts>
**When to use it:** <condensed from spec/05-tools.md "When the agent should use it">

# Blockquote sourcing: copy CANCEL_DESC VERBATIM from src/tools/cancel.ts (concatenate the
# string-literal parts). Cross-check against spec/05-tools.md §7 line 299, which re-prints
# the same string. The two MUST agree; if they ever diverged, src/tools/cancel.ts is the
# runtime source of truth.

# "When to use it" sourcing: condense faithfully FROM spec/05-tools.md §5 "When the agent
# should use it" + "Purpose" + "What retraction is NOT". Keep the safety-valve framing the
# work item asks for; keep the "rewind of the issuing call does NOT retire it" point (it is
# the core motivation, per E21). Do not invent behavior beyond the spec.

# D6 mention: keep to ONE brief clause in the closing paragraph ("softens D6: a mistaken
# marker is no longer irrevocably permanent"). The full D6 amendment of §7 Known Limitations
# is S3's scope — do not edit §7.
```

### Integration Points

```yaml
CODE: none — README.md is documentation, imported by nothing.
CONFIG: none — config.ts is unaffected (cancel has no config sub-knob; master gate only).
TESTS: none — README changes have no test surface; vitest + tsc are unaffected and stay green.
DOCS: this IS the docs change (Mode B). The only cross-ref worth adding inside the entry is
      to Pi's native `/tree` (already used elsewhere in the README) for human recovery — no
      new external links required.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# No linter step exists for markdown in this repo (package.json has only tsc + vitest).
# Validate manually:
#  - the new blockquote is a single `> ` line (matching the other four blockquotes);
#  - the heading is `### \`mulligan_cancel\`` with backticks;
#  - markdown table/columns are not touched (this task adds no table rows).

# Confirm the heading + blockquote render as a fenced subsection:
sed -n '/^### `mulligan_cancel`/,/^### \|^---\|^## /p' README.md
# Expected: prints the new heading, the blockquote, and the two prose paragraphs, then
# stops at the following separator.
```

### Level 2: Content Consistency (the real gate)

```bash
# (a) Intro count updated:
grep -n "five agent-callable tools" README.md
# Expected: exactly 1 line.
grep -n "four agent-callable tools" README.md
# Expected: NO output (old text gone).

# (b) New subsection heading present, 5th (after mulligan_audit):
grep -n '### `mulligan_cancel`' README.md
# Expected: exactly 1 line, and its line number is GREATER than the mulligan_audit heading.
grep -n '### `mulligan_audit`' README.md
awk '/### `mulligan_audit`/{a=NR} /### `mulligan_cancel`/{c=NR} END{print (c>a) ? "OK: cancel after audit" : "FAIL: ordering"}' README.md

# (c) The blockquote is the VERBATIM CANCEL_DESC — diff README blockquote vs the source:
#     pull CANCEL_DESC's distinctive tail sentence and confirm it appears verbatim in BOTH:
grep -n "Cancelling a non-existent or already-cancelled marker is a safe no-op." src/tools/cancel.ts README.md
# Expected: 2 lines (one in cancel.ts CANCEL_DESC, one in the README blockquote).

# (d) Safety-valve framing present in the "When to use it" prose:
grep -n "safety valve" README.md
# Expected: ≥1 line (the new entry).

# (e) mulligan_cancel now referenced in §4 (heading + body):
grep -c "mulligan_cancel" README.md
# Expected: ≥3 (the heading + blockquote mentions + "When to use it" mentions).

# (f) Scope boundary — NOTHING outside §4 was edited. Re-run after the edit and confirm
#     these still say the OLD value (S3 owns them):
grep -n "four tools' full specification" README.md   # "Further reading" count — STILL "four" (S3's job)
grep -n "rewinds and shrinks are permanent" README.md # §7 Known Limitations D6 bullet — STILL unamended (S3's job)
# Expected: both still present with their original wording. (If you changed them, revert —
# they are S3's scope.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Docs-only task — no runtime integration to test. Confirm no source file imports README:
grep -rl "README" src/ test/ 2>/dev/null || echo "no code references README (expected)"

# Confirm the build/test baseline is unaffected (should be green before AND after; README
# is not compiled or tested):
npx tsc --noEmit && echo "tsc OK (unaffected by README edit)"
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Visual review: open README.md §4 and read top-to-bottom. Confirm:
#  - intro line reads "...registers five agent-callable tools...";
#  - the five subsections appear in order: rewind, shrink, checkpoint, audit, cancel;
#  - the mulligan_cancel blockquote is a single `> ` paragraph matching CANCEL_DESC verbatim
#    (copy the README line, paste next to src/tools/cancel.ts CANCEL_DESC — they must match);
#  - a "When to use it:" paragraph follows, framed as the safety valve for mis-targeted
#    rewind/shrink markers;
#  - a short closing paragraph states retraction is forward-only (no on-disk undo / no
#    replay; `/tree` for recovery) and that it softens D6;
#  - the "---" separator and "## 5. How It Works" still immediately follow the new entry;
#  - nothing in §1, §3, §5, §6, §7, or "Further reading" was changed (those are S1/S3).

# Optional: render the README in a markdown viewer to confirm the blockquote + heading
# display correctly (no broken fence, no stray `> `).
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1: the new blockquote + heading render as a well-formed subsection.
- [ ] Level 2 (a): "five agent-callable tools" present (1 line); "four agent-callable tools" gone.
- [ ] Level 2 (b): `### \`mulligan_cancel\`` present and ordered after `### \`mulligan_audit\``.
- [ ] Level 2 (c): the blockquote's tail sentence matches `src/tools/cancel.ts` `CANCEL_DESC` verbatim.
- [ ] Level 2 (d): "safety valve" framing present in the "When to use it" prose.
- [ ] Level 2 (f): "Further reading" still says "four tools" and §7 D6 bullet still unamended (S3 scope — NOT touched).
- [ ] Level 3: no source/test file references README; `npx tsc --noEmit` still green.

### Feature Validation

- [ ] §4 lists five tool subsections (rewind, shrink, checkpoint, audit, **cancel**).
- [ ] The `mulligan_cancel` blockquote is a byte-identical copy of `CANCEL_DESC`.
- [ ] The entry frames `mulligan_cancel` as the safety valve for mis-targeted rewinds/shrinks.
- [ ] The entry notes retraction is forward-only and softens D6.

### Code Quality Validation

- [ ] New subsection matches the existing §4 entry convention (heading + blockquote + "When to use it:").
- [ ] Blockquote is verbatim, not paraphrased (the §4 intro explicitly promises verbatim copies).
- [ ] "When to use it" prose is condensed faithfully from `spec/05-tools.md` §5 (no invented behavior).
- [ ] No edits to §3 (config = S1) or §1/§5/§6/§7/"Further reading" (blurbs = S3).

### Documentation & Deployment

- [ ] Em dashes ("—") preserved as Unicode (not "--"); no mojibake.
- [ ] No environment variables, config code, or source files touched.

---

## Anti-Patterns to Avoid

- ❌ Don't paraphrase the blockquote — §4 promises **verbatim** LLM-facing description strings; copy `CANCEL_DESC` byte-for-byte.
- ❌ Don't place `mulligan_cancel` anywhere but 5th (after `mulligan_audit`) — it must match the canonical `spec/05-tools.md` order.
- ❌ Don't edit §7 "Known Limitations" (the D6 amendment) or the "Further reading" tool count — both are S3's scope.
- ❌ Don't edit §3 (config) — that's S1.
- ❌ Don't modify any `src/` file — `mulligan_cancel` already shipped; this is docs-only.
- ❌ Don't invent tool behavior beyond `spec/05-tools.md` §5 — condense faithfully.
- ❌ Don't re-run `npm test`/`tsc` as a *gate* for a docs change — they're unaffected and stay green; use the grep checks in Level 2 as the real gate.