# PRP — P4.M1.T1.S3: README trust note for the shrink-preservation invariant (Mode B)

## Goal

**Feature Goal**: Add exactly ONE sentence to README.md's `### mulligan_shrink`
section that states, in the shrink blurb's own voice, the E19 "original never lost"
hard invariant — i.e. shrink is a *view substitution* (the original message always
survives on disk, recoverable via `/tree`; only the model's in-context copy is
replaced, so even summarizing a user message is lossless at the session level).

**Deliverable**: A single new markdown paragraph inside the `### mulligan_shrink`
section of `README.md` (repo root). No other file is touched. No code change, no
spec change, no test change.

**Success Definition**: (a) the README shrink section carries the trust note;
(b) the note is ONE sentence in the shrink blurb's voice using the "view
substitution" vocabulary; (c) it does NOT duplicate or contradict the two existing
general soft-delete statements (README L233, L241); (d) it does NOT restate the
whole E19 bullet; (e) no stale reference is introduced; (f) `npm run typecheck`
and `npm test` remain green (sanity — a README edit must not perturb them).

## User Persona (if applicable)

**Target User**: Two audiences — (1) the **agent operator / human** reading the
README to understand what `mulligan_shrink` does and whether it is safe, and
(2) the **AI agent** whose tool description/README shapes its trust in shrink.
This note primarily reassures the *human* that shrink is lossless.

**Use Case**: An operator hesitates to shrink a large paste or a long user message
because they fear "losing" the original. The trust note tells them, inline in the
shrink section, that the original always survives on disk via `/tree`.

**Pain Points Addressed**: Ambiguity about whether shrink is destructive — the
README's shrink blurb currently describes *what* it does (swap the result for a
summary) and that `by_content_includes` can match any-role messages, but never
states the *hard guarantee* that the original is never lost. E19 made this an
explicit hard invariant; the README should reflect that.

## Why

- **Trust/trustworthiness**: shrink is the one Mulligan operation that *rewrites*
  content the model sees; an explicit "original never lost" note is the single most
  reassuring thing the shrink section can say.
- **Orthogonal to P3's v1.1 surface sweep**: P3.M1.T1.S1 (COMPLETE) edited
  v1.1-surface sentences (tool-count, `to_previous_prompt`, checkpoint subsection,
  human-commands, BUG-006, status line, banner config). It did **not** touch the
  shrink blurb. Keeping the E19 note as its own subtask avoids entangling P3's
  dependency graph and edits a different README site.
- **Documents a *verified* invariant**: S1 (pure non-mutation unit test) and S2
  (integration on-disk test for user-message shrink) are complete/verifying the
  invariant *before* it is documented here (Mode B — changeset-level doc sync for
  the E19 spec clarification, which was itself already landed in commit d5701c8f).
- **E19 framing**: the distinguishing angle is that *even summarizing a user
  message* is acceptable precisely because the original always survives — this is
  the part not already said by the general soft-delete statements.

## What

A new one-sentence paragraph is inserted into the `### mulligan_shrink` section of
`README.md`, immediately after the faithful-replacement line (`The \`replacement\`
must be non-empty and **faithful** — the model treats it as ground truth from then
on.`) and immediately before the `Checkpoints moved to the human in v1.1` paragraph.

The sentence must:
1. Be **exactly one sentence** (semicolons / em-dashes OK; no multi-sentence restatement).
2. Be in the **shrink blurb's voice** (lead with a `**Label.**` paragraph header that
   matches the README's existing shrink-paragraph style, e.g. `**Operator echo (zero context cost).**`,
   `**Target matchers**`, `**When to use it (vs mulligan_rewind):**`).
3. Use the E19 vocabulary **"view substitution"**.
4. State that the original message stays on disk and is recoverable by the human
   via `/tree` (D2 / soft-delete).
5. Carry the E19-specific angle that **even summarizing a user message is lossless**
   at the session level.
6. Cite E19 (e.g. `(E19)` or `(`spec/08-edge-cases.md` E19)`) so the reader can find
   the spec anchor.
7. **Not duplicate** README L233 (`/tree` is the audit trail…) or L241 (Soft-delete
   / audit trail. Hidden content is never lost…) — the distinguishing properties are
   (a) it lives *in* the shrink blurb, (b) it uses "view substitution", (c) it adds
   the user-message-lossless angle.
8. Introduce **no stale reference** (no wrong line numbers, no removed symbols).

### Success Criteria

- [ ] README.md `### mulligan_shrink` section contains the trust note as one sentence.
- [ ] The note is placed between the faithful-replacement line and the
      `Checkpoints moved to the human in v1.1` paragraph.
- [ ] The note uses "view substitution", mentions original-on-disk + recoverable
      via `/tree`, and the user-message-lossless angle; cites E19.
- [ ] `grep -n "shrink" README.md` shows the note reads cleanly in context.
- [ ] No other file changed (only `README.md`).
- [ ] `npm run typecheck` passes (sanity, unaffected).
- [ ] `npm test` passes (sanity, unaffected).

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?" — **YES**. This PRP names the exact file, the exact
section, the exact two-line anchor to insert between, the exact wording constraints,
the two existing statements it must not duplicate, and the validation commands. No
prior knowledge of Mulligan internals is required; the E19 invariant is quoted in
full below.

### Documentation & References

```yaml
# MUST READ - the authoritative invariant wording (quote this voice)
- url: spec/08-edge-cases.md#E19  (file path; section "## E19. Shrink target is a non-`toolResult` message")
  why: This is the hard invariant being documented. Its bullet "The original is never lost (hard invariant)"
       is the exact guarantee the README sentence must reflect.
  critical: |
    E19 bullet (verbatim): "The original is never lost (hard invariant): shrink is a view substitution —
    the user's actual message stays on disk and is recoverable via /tree (D2 / soft-delete). Summarizing
    user input is acceptable precisely because the original always survives; only the model's in-context
    copy is replaced." Do NOT paste the whole E19 bullet into README — condense to ONE sentence.

# MUST READ - the file being edited (only this file is modified)
- file: README.md
  why: The `### mulligan_shrink` section (heading at L155) is where the sentence goes.
  pattern: Shrink-section paragraphs use a `**Label.** ...` header style — match it.
  gotcha: |
    Two OTHER README paragraphs already state the general soft-delete guarantee and must NOT be duplicated:
      - L233: "`/tree` is the audit trail. Every rewind, shrink, and checkpoint is a persisted entry — the
              human can inspect the full un-filtered history (including every hidden span) via Pi's native `/tree`."
      - L241: "**Soft-delete / audit trail.** Hidden content is **never lost** — it stays in the session JSONL
              on disk and is visible in Pi's native `/tree`."
    The S3 note is allowed to reuse the words ("never lost"/"on disk"/"recoverable via /tree") because it IS
    the same guarantee — the duplication risk is only if the note were a generic restatement. Keep it
    shrink-specific + "view substitution" + the user-message-lossless angle to stay distinct.

# Context - the verified invariant S3 documents (do not edit these; just be aware they prove the claim)
- file: test/unit/edge-cases.test.ts  (S1 — COMPLETE)
  why: Asserts applyShrink is non-mutating (input array's original survives unchanged). The README claim
       is backed by this unit test.
- file: test/integration/smoke.ts  (S2 — IMPLEMENTING per parallel context; scenario F-shrink-persist)
  why: Extends the smoke harness to shrink a real role:"user" message (USER_CANARY) and assert the original
       survives verbatim on disk. The README claim is backed by this integration test.

# Context - why edit sites are disjoint (no race)
- file: plan/007_67d7d8c6e4c5/P3M1T1S1/PRP.md
  why: P3 (README v1.1 sweep) is COMPLETE and did NOT touch the mulligan_shrink blurb (L155–169). The README
       is already in its final v1.1 state when S3 runs. S3's edit and P3's edits are on disjoint line ranges.
```

### Current Codebase tree (README + spec region of interest)

```bash
README.md                      # <-- ONLY file edited. `### mulligan_shrink` section at L155–169.
spec/08-edge-cases.md          # E19 at L96–99 — authoritative invariant wording (READ, do not edit).
test/unit/edge-cases.test.ts   # S1 test (COMPLETE) backing the claim.
test/integration/smoke.ts      # S2 smoke scenario (IMPLEMENTING) backing the claim.
package.json                   # scripts: test (vitest), smoke, typecheck (tsc). No markdown linter.
```

### Desired Codebase tree with files to be added/changed

```bash
README.md   # MODIFIED — one new one-sentence paragraph inside `### mulligan_shrink`.
            #            No new files. No code/spec/test changes.
```

### Known Gotchas of our codebase & README quirks

```python
# CRITICAL: This is a ONE-SENTENCE trust note, NOT a re-documentation of E19.
#   Do not paste the whole E19 bullet. Do not add a second paragraph. One sentence.

# CRITICAL: Do NOT duplicate the two existing general soft-delete statements (README L233 and L241).
#   Distinctness = (in the shrink blurb) + ("view substitution" vocabulary) + (user-message-lossless angle).

# CRITICAL: The README is plain Markdown. There is NO markdown linter / prettier / eslint / markdownlint
#   in this repo (package.json only has test/smoke/typecheck). So "validation" = grep + read-in-context +
#   typecheck/test sanity. Do not invent a markdown-lint gate.

# GOTCHA: README line numbers shift by +N after the insertion. Reference anchors by their TEXT
#   (the faithful-replacement line, the "Checkpoints moved to the human in v1.1" line), NOT by number.

# GOTCHA: Use fenced code formatting for symbols: `mulligan_shrink`, `by_content_includes`, `/tree`,
#   `role`, `spec/08-edge-cases.md`. The surrounding paragraphs all do this.

# GOTCHA: The intro blockquote (L156) frames shrink around *tool results*, but by_content_includes
#   (L167) matches ANY role message — that is exactly why the E19 "even a user message is lossless"
#   angle belongs here. Do not weaken it to tool-result-only.
```

## Implementation Blueprint

### Data models and structure

N/A — documentation-only task. No data models, schemas, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md — insert ONE one-sentence trust-note paragraph in `### mulligan_shrink`
  - FILE: README.md (repo root) — the ONLY file modified in this entire subtask.
  - LOCATE: the `### mulligan_shrink` section (heading near L155).
  - INSERT POINT: immediately AFTER the line:
        "The `replacement` must be non-empty and **faithful** — the model treats it as ground truth from then on."
    and immediately BEFORE the paragraph beginning:
        "Checkpoints moved to the human in v1.1 (the destructive cross-prompt power belongs to the user)."
  - ADD: exactly ONE blank line, then the new paragraph, then ONE blank line, preserving Markdown
         paragraph separation (the file uses single blank lines between paragraphs).
  - CONTENT (recommended exact text — single sentence, satisfies all 8 requirements):
        "**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: the original message stays on disk and is recoverable by the human via `/tree`, so only the model's in-context copy is replaced — even summarizing a user message (E19) is lossless at the session level."
    Wording latitude: the agent MAY adjust phrasing as long as it remains (a) ONE sentence,
    (b) in shrink-blurb voice, (c) uses "view substitution", (d) states original-on-disk +
    recoverable via /tree, (e) includes the user-message-lossless angle, (f) cites E19.
  - NAMING/STYLE: lead paragraph header `**View substitution (trust note).**` matches the README's
        existing `**Operator echo (zero context cost).**` / `**Target matchers**` style.
  - FOLLOW pattern: the other paragraphs in the same section (bolded lead label, then prose).
  - DEPENDENCIES: none (S1 is complete; S2 verifies the invariant but its result does not block the
        README edit — the invariant is already spec-true as of commit d5701c8f).
  - PLACEMENT: inside `### mulligan_shrink`, as the section's final content paragraph.

Task 2: VERIFY in-context readability (the task's own acceptance gate)
  - RUN: `grep -n -i "shrink" README.md`
  - ASSERT: the new paragraph appears once, inside the shrink section, reads as a coherent sentence,
        and does NOT contradict L233 or L241 (the general soft-delete statements).
  - ASSERT: no stale reference introduced (no dangling line numbers, no removed/renamed symbols).

Task 3: SANITY — confirm no code was perturbed (README-only change must be inert)
  - RUN: `npm run typecheck`  (expect: passes, unchanged)
  - RUN: `npm test`           (expect: passes, unchanged — vitest run)
  - NOTE: these cannot fail because of a Markdown edit; running them proves the working tree was
        not accidentally mutated. If they fail, a code file was touched by mistake — revert it.

Task 4: GIT DIFF review
  - RUN: `git diff -- README.md`
  - ASSERT: exactly ONE hunk in README.md adding the new paragraph; zero changes to any other file
        (`git status` shows only `README.md` modified).
```

### Implementation Patterns & Key Details

```markdown
# README shrink-section paragraph pattern (follow it for the new note)

The existing paragraphs in `### mulligan_shrink` all use this shape:

  **<Short label in bold, often with a parenthetical>.** <One or two sentences of prose,
  with inline `code` for symbols and *(emphasis)* for key terms, ending with an optional
  spec cross-ref like (`spec/05-tools.md` §2.)>

Examples already in the section:
  - "**When to use it (vs `mulligan_rewind`):** rewind = the call was a *mistake* ..."
  - "**Operator echo (zero context cost).** The tool result stays terse ..."
  - "**Target matchers** (resolved live each turn, robust to compaction):"

=> The new note should follow the SAME shape:
  "**View substitution (trust note).** Shrink never deletes anything — it is a *view substitution*: ..."

# GOTCHA: keep it to ONE sentence. The recommended text is one sentence (the em-dashes are
# intra-sentence punctuation, not sentence breaks). Do not split into two paragraphs.
```

### Integration Points

```yaml
FILES MODIFIED:
  - README.md  (only) — insert one paragraph in `### mulligan_shrink`.

CONFIG:     none.
ROUTES:     none.
DATABASE:   none.
SPEC:       none — E19 was already updated by commit d5701c8f; this PRP does NOT edit the spec.
TESTS:      none — S1 (unit) and S2 (integration) VERIFY the invariant; S3 only DOCUMENTS it.
            Do not add or change tests in this subtask.
DEPENDENCIES:
  - P4.M1.T1.S1 (COMPLETE) — proves applyShrink is non-mutating.
  - P4.M1.T1.S2 (IMPLEMENTING) — proves a user-message shrink survives on disk.
    Both establish the invariant as verified; neither blocks the README edit (the invariant is
    already spec-true).
COORDINATION:
  - P3.M1.T1.S1 (COMPLETE) — edited disjoint README sites (v1.1-surface sentences, not the shrink
    blurb). NOT in flight. No edit-order race.
```

## Validation Loop

### Level 1: Markdown / readability (the real gate for this task)

```bash
# Confirm the new paragraph landed in the right place and reads cleanly in context.
grep -n -i "shrink\|view substitution\|trust note\|never lost\|on disk" README.md

# Read the full shrink section back to eyeball flow (paragraphs before + after the new line).
sed -n '155,173p' README.md
#   ^ 1-indexed: heading at ~155, through the `### mulligan_audit` heading at ~173 (numbers shift +2).

# Expected: the new "**View substitution (trust note).**" paragraph appears exactly once, between the
# faithful-replacement line and the "Checkpoints moved to the human in v1.1" paragraph, as one sentence,
# with no stale reference and no contradiction of L233/L241.
```

### Level 2: Duplication / contradiction check (correctness gate)

```bash
# The two general soft-delete statements the note must NOT duplicate or contradict.
grep -n "Soft-delete / audit trail\|never lost\|/tree\` is the audit trail" README.md

# Expected: L233 and L241 unchanged; the new note is the shrink-section-specific, E19-framed
# "view substitution" version (distinct by location + vocabulary + user-message-lossless angle).
# If the new note reads as a verbatim restatement of L241, REWRITE it to be shrink-specific.
```

### Level 3: Sanity — no code perturbation (README edit must be inert)

```bash
# A Markdown change cannot break these; running them proves the working tree wasn't mutated.
npm run typecheck     # tsc --noEmit — expect: passes
npm test              # vitest run — expect: passes

# Expected: both green, identical to before the edit.
```

### Level 4: Git hygiene

```bash
git status --short    # Expected: only " M README.md".
git diff -- README.md # Expected: exactly ONE hunk adding the new paragraph (+ the surrounding blank lines).
                       # No other file appears in the diff.
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -n -i "shrink" README.md` shows the note in-context inside `### mulligan_shrink`.
- [ ] The note is ONE sentence.
- [ ] The note sits between the faithful-replacement line and the "Checkpoints moved to the human in v1.1" paragraph.
- [ ] `npm run typecheck` passes (sanity).
- [ ] `npm test` passes (sanity).
- [ ] `git status --short` shows ONLY `README.md` modified.

### Feature Validation

- [ ] All success criteria from "What" met.
- [ ] The note uses the word "view substitution" (E19 vocabulary).
- [ ] The note states original-on-disk + recoverable via `/tree`.
- [ ] The note includes the "even a user message is lossless" angle and cites E19.
- [ ] The note does NOT duplicate or contradict README L233 or L241.
- [ ] The note does NOT restate the whole E19 bullet (it is condensed to one line).
- [ ] No stale reference introduced (no dangling line numbers / removed symbols).

### Code Quality / Documentation Validation

- [ ] Paragraph header style matches the other shrink-section paragraphs (`**Label.**`).
- [ ] Symbols are fenced as inline code (`mulligan_shrink`, `/tree`, `by_content_includes`, etc.).
- [ ] Only `README.md` is touched — no spec, code, config, or test files changed.

---

## Anti-Patterns to Avoid

- ❌ Don't paste the whole E19 bullet into the README — condense to ONE sentence.
- ❌ Don't add a second paragraph or a bullet list — one sentence only.
- ❌ Don't duplicate the L233 / L241 general soft-delete statements verbatim — stay shrink-specific.
- ❌ Don't reference line numbers in the README text (they drift) — anchor by section/symbol names.
- ❌ Don't touch any file other than `README.md` (no spec edit — E19 already landed in d5701c8f; no test/code/config edit).
- ❌ Don't invent a markdown-lint gate — this repo has none; "validation" = grep + read + typecheck/test sanity.
- ❌ Don't gate the README edit on S2 finishing — the invariant is already spec-true; S1/S2 verify it, they don't block documenting it.

---

## Confidence Score

**9 / 10** for one-pass implementation success.

Rationale: This is a single-sentence Markdown insertion into a known section of a known
file, with the exact insertion anchor (two named paragraphs), the exact recommended
wording, the explicit anti-duplication constraints (named lines L233/L241), and the
exact validation commands (grep, read, typecheck/test sanity, git diff). The only
residual risk is a wording-taste judgement on whether the single sentence "reads
cleanly" — which is fully mitigated by the 8 explicit wording requirements + the
recommended exact text + the in-context grep check. No code, no schema, no
dependencies beyond the (already spec-true) invariant.