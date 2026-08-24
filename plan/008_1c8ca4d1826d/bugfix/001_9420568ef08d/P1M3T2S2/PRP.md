name: "P1.M3.T2.S2 — README.md: sweep §4 Tools/human-commands and §7 bug history for consistency with the shipped changes"
description: Documentation-only changeset sweep. README.md must match shipped v2.0 post-validation behavior: checkpoint targeting/consent semantics in the mulligan_rewind blurb (§4), the E22 identical-note advisory, smoke 19/19, and a new dated §7 subsection recording the three v2.0 validation fixes WITHOUT renumbering historical BUG entries.

---

## Goal

**Feature Goal**: Make `README.md` consistent with the behavior actually shipped by the v2.0 post-validation changeset (P1.M1.T1.S1, P1.M1.T2.S2, P1.M2.T6.S1, P1.M3.T1.S1) — and nothing more. No marketing drift, no speculative edits.

**Deliverable**: A modified `README.md` (300 lines today; this is the ONLY file modified). Concretely:
1. §4 `### mulligan_rewind` blurb mentions the `checkpoint` targeting mode with its consent/hides-user-prompts semantics, consistent with the shipped REWIND_DESC.
2. §7 gains a new dated subsection recording the three v2.0 validation fixes (the PRD's BUG-001..003) following the existing resolved-bugs subsection pattern, without touching any historical BUG-001–005 / v1.1 BUG-001–004 / field-report BUG-001 entries.
3. The "Zero-config smoke (the acceptance check)" section (README:52) remains accurate; the 19/19 scenario count is referenced only if stated consistently with VERIFICATION.md (which P1.M3.T2.S1 records as 19/19).

**Success Definition**: A reader of README.md alone gets an accurate picture of the four agent tools, the human commands, and the resolved-bug history including the v2.0 round; every historical bug entry is byte-identical to before except for the new subsection.

## Why

- README is the public-facing surface (GitHub). The shipped changeset changed LLM-facing tool docs (checkpoint consent semantics), added a new rewind-time advisory, grew the smoke suite 14→19, and deprecated the dead checkpoint agent-tool module. README currently omits all four.
- Follows the repo's own pattern: every validation/remediation round gets a dated §7 subsection (v1.0 hunt, v1.1 pass, field reports) cross-referencing VERIFICATION.md. The v2.0 round is missing.
- Sibling task P1.M3.T2.S1 records the engineering record in VERIFICATION.md; this PRP handles the README sweep only (Mode B).

## What

1. **§4 `mulligan_rewind` blurb sync (P1.M1.T1.S1).** The shipped REWIND_DESC (src/tools/rewind.ts:127-129) now ends: *"granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it)."* The `checkpoint` param description (rewind.ts:113) now says "set via the /mulligan_checkpoint command". README's rewind blurb (README:133–~150) currently ends its granularity discussion at `last_turn`. Add a concise sentence to the rewind prose covering the checkpoint mode + consent/hides-user-prompts semantics. Note README already has related content at L176 (shrink section tail: "The agent still rewinds to a checkpoint via `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")`") and in the Human-commands section — do not duplicate; a one-sentence cross-reference style mention in the rewind blurb itself is the gap to close. Do NOT paste REWIND_DESC verbatim into README (README never has; that string lives in the tool schema).
2. **E22 advisory mention (P1.M1.T2.S1/S2).** rewindExecute's success path now appends, on a second consecutive same-prompt rewind with substantively identical note (`what_happened` after trim/lowercase): *"⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."* README §7's "Markers accumulate" bullet already names the two E22 hard backstops (`maxRetriesPerPrompt`, `abortContextFraction`). Add the advisory alongside them (one clause — the early warning before the budget is exhausted) — keep it inside that existing bullet or the new §7 subsection; do not expand scope.
3. **§7 new dated subsection: the three v2.0 validation fixes.** Add after the existing "Resolved bugs — field reports (BUG-001)" subsection, titled e.g. **"Resolved bugs — v2.0 post-validation pass (BUG-001–BUG-003)"**, following the established subsection pattern exactly (intro paragraph: severity counts — 0 Critical, 0 Major, 3 Minor — distinct-numbering note, "All have regression tests; see VERIFICATION.md 'v2.0 post-validation fixes' for the full engineering record"), then three bullets:
   - **BUG-001 (Minor)** — REWIND_DESC was missing the spec's checkpoint/consent sentence and the `checkpoint` param docs referenced the removed `mulligan_checkpoint` agent tool; both restored (param now says "/mulligan_checkpoint command").
   - **BUG-002 (Minor)** — the E22 identical-note advisory (SHOULD) was absent from the rewind success path; now appended on a second consecutive identical-note same-prompt rewind, before the hard budgets fire.
   - **BUG-003 (Minor)** — the five v1.1 REQUIRED integration scenarios (F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt) existed only as unit tests; the smoke harness was extended (banner/checkpoint/user-visibility/high-water observables) and all five registered/driven/asserted — smoke gate now 19/19.
   **CRITICAL NAMING HAZARD**: the three prior §7 subsections each use their own BUG-001..N numbering (v1.0 hunt's BUG-001–005; v1.1 pass's BUG-001–004; field report's BUG-001). Do NOT renumber, merge, or edit any historical entry — only ADD the new subsection with its own round-scoped numbering, and include a "distinct from the earlier rounds' numbering" note mirroring the v1.1 subsection's wording.
4. **Smoke acceptance-check section (README:52).** The "Zero-config smoke" section documents the zero-config load check and does not state a scenario count (the count lives in VERIFICATION.md). Keep it accurate as-is; you may add one parenthetical pointing at the smoke suite ("the full integration smoke suite is 19/19 — see VERIFICATION.md") ONLY if consistent with VERIFICATION.md's post-P1.M3.T2.S1 state (it records 19/19). If VERIFICATION.md has not yet been updated when you implement, still state 19/19 — it is the shipped truth (P1.M2.T6.S1 completed with 19/19).
5. **Out of scope**: §5 How It Works, §6 Guarantees, the shrink/cancel/audit tool sections, the Human commands banner text, VERIFICATION.md, scenarios.md (P1.M3.T2.S3 owns scenarios.md), any spec/ file, any src/ file.

### Success Criteria

- [ ] §4 rewind blurb covers checkpoint targeting + consent/hides-user-prompts semantics consistent with src/tools/rewind.ts REWIND_DESC; no verbatim REWIND_DESC paste
- [ ] §7 has a new dated v2.0 subsection with the three fixes; all pre-existing bug entries byte-identical
- [ ] Smoke section consistent with 19/19 (count only in a VERIFICATION.md-consistent reference)
- [ ] E22 advisory (identical-note) is mentioned wherever the E22 hard backstops are mentioned
- [ ] Only README.md modified; no marketing language added

## All Needed Context

### Context Completeness Check

_Passes: the implementer needs only README.md, src/tools/rewind.ts (read-only, for the exact shipped strings), and the existing §7 subsection patterns — all specified below with line anchors._

### Documentation & References

```yaml
- file: README.md
  why: THE file being modified
  anchors: L52 smoke section; L129-190 §4 Tools (rewind blurb L133+, shrink, cancel, audit); L194-205 Human commands (v1.1) incl. verbatim banner line; §7 Known Limitations with three resolved-bugs subsections (~L236-283)
  gotcha: README does NOT quote REWIND_DESC verbatim anywhere — keep it that way

- file: src/tools/rewind.ts
  why: read-only source of the shipped strings to stay consistent with
  anchors: L113 checkpoint param description ("set via the /mulligan_checkpoint command"); L127-129 REWIND_DESC incl. the restored final sentence
  pattern: mirror the semantics, not the exact text, in README prose

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M3T2S1/PRP.md
  why: sibling contract — VERIFICATION.md will contain section "v2.0 post-validation fixes — BUG-001 through BUG-003" recording smoke 19/19; README's new §7 subsection must cross-reference that section title
  gotcha: do not duplicate the remediation table; README cross-references (existing pattern)

- file: VERIFICATION.md
  why: existing cross-reference target pattern; currently records 14/14 pre-sweep (P1.M3.T2.S1 updates it in parallel — assume it will record 19/19)

- file: src/tools/checkpoint.ts
  why: P1.M3.T1.S1 added @deprecated JSDoc to the dead agent-tool surface; README correctly does not document an agent checkpoint tool (§4 lists four tools) — no README change needed for this, just verify §4 still lists exactly four agent tools (rewind/shrink/audit/cancel) and the Human commands section is unchanged
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                     # 300 lines — the only file to modify
VERIFICATION.md               # sibling task's target; cross-reference only
src/tools/rewind.ts           # read-only: shipped REWIND_DESC + param strings
src/tools/checkpoint.ts       # read-only: @deprecated surface (no README action)
test/integration/run-smoke.mjs # read-only: 19 scenarios
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
README.md   # MODIFIED only — no new files
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL — BUG-ID COLLISION: §7 contains THREE prior rounds each starting at BUG-001
#   (v1.0 hunt BUG-001–005; v1.1 pass BUG-001–004; field reports BUG-001).
#   The PRD's BUG-001..003 are a FOURTH, newest round. NEVER renumber history.
# CRITICAL — README never quotes REWIND_DESC verbatim and never states the smoke
#   scenario count as an acceptance gate (that lives in VERIFICATION.md, 19/19).
#   The L52 section is the zero-config LOAD check, not the smoke suite result.
# GOTCHA — the drift nudge seen in live sessions ("mulligan_rewind to undo the turn")
#   comes from a GLOBALLY-INSTALLED older mulligan build, not this worktree; do not
#   let it tempt you into "fixing" nudge text in README — v2.0 nudges are
#   awareness-only and README already documents that correctly (§5 item 2).
# GOTCHA — Mode B docs task: accuracy IS the validation gate. No code may change.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ-ONLY verification sweep of README.md against shipped behavior
  - READ README.md fully (300 lines) + src/tools/rewind.ts:100-135
  - CHECK: §4 lists exactly four agent tools; Human commands section (L194-205) intact
  - LOCATE: rewind blurb granularity prose end-point; §7 last subsection ("field reports")
    and the "Markers accumulate" bullet naming the two E22 backstops

Task 2: EDIT §4 mulligan_rewind blurb — checkpoint targeting + consent semantics
  - ADD: one-to-two-sentence mention of granularity 'checkpoint' — rewinds back to a
    user-set checkpoint (via /mulligan_checkpoint) and may hide the user's prompts after
    it (they consented by setting it); consistent with rewind.ts:127-129 semantics
  - CROSS-REF: the existing [Human commands (v1.1)](#human-commands-v11) anchor (L176 pattern)
  - DO NOT: paste REWIND_DESC verbatim; touch shrink/cancel/audit sections

Task 3: EDIT §7 — mention the E22 identical-note advisory next to the hard backstops
  - FIND: the "Markers accumulate" bullet's final sentence naming maxRetriesPerPrompt
    and abortContextFraction
  - ADD: one clause — an advisory warning now also fires on a second consecutive
    identical-note same-prompt rewind, steering the agent to change approach before the
    budget is exhausted (spec/08 E22 SHOULD)

Task 4: ADD §7 subsection "Resolved bugs — v2.0 post-validation pass (BUG-001–BUG-003)"
  - PLACEMENT: immediately after "Resolved bugs — field reports (BUG-001)", before "## 8. License"
  - FORMAT: follow the v1.1 subsection's structure verbatim-style: intro paragraph
    (0 Critical / 0 Major / 3 Minor; round-scoped numbering distinct from earlier rounds;
    all have regression tests; see VERIFICATION.md "v2.0 post-validation fixes") + three
    bullets with the content specified in What §3
  - PRESERVE: every historical bug entry byte-identical

Task 5: EDIT smoke acceptance-check section (README:52) — 19/19 consistency (optional add)
  - ADD (only if it reads naturally): one parenthetical that the integration smoke
    suite is 19/19 scenarios, see VERIFICATION.md
  - DO NOT: restate the zero-config load check's meaning or move the section

Task 6: FINAL accuracy + diff-hygiene pass (see Validation Loop)
```

### Implementation Patterns & Key Details

```markdown
<!-- Pattern for the new §7 subsection (mirror the v1.1 one at ~L254): -->

### Resolved bugs — v2.0 post-validation pass (BUG-001–BUG-003)

A third validation pass (v2.0 post-validation) found and fixed three minor docs/coverage
defects (0 Critical, 0 Major, 3 Minor). These are **resolved** corrections, listed
separately from the prior rounds above (the bug numbers below are THIS round's numbering
and are distinct from the earlier rounds'). All three have regression tests; see
VERIFICATION.md "v2.0 post-validation fixes" for the full engineering record.

- **BUG-001 (Minor)** — ... (REWIND_DESC checkpoint/consent sentence restored; param
  docs now reference the /mulligan_checkpoint command)
- **BUG-002 (Minor)** — ... (E22 identical-note advisory added to the rewind success path)
- **BUG-003 (Minor)** — ... (five v1.1 smoke scenarios added; smoke gate 19/19)
```

### Integration Points

```yaml
DOCS:
  - cross-reference: VERIFICATION.md section "v2.0 post-validation fixes — BUG-001 through BUG-003"
    (produced by sibling P1.M3.T2.S1 — assume it exists as specified in its PRP)
NO CODE / CONFIG / DATABASE CHANGES.
```

## Validation Loop

### Level 1: Accuracy (docs task — accuracy IS the gate)

```bash
# 1. Only README.md changed
git status --porcelain          # expect: M README.md only
git diff --stat

# 2. Historical bug entries untouched — diff must show only additions in §7
git diff README.md | grep '^-' | grep -v '^---'
# Expected: EMPTY (pure additions) or deletions limited strictly to lines you
# intentionally reflowed; any deletion inside a historical BUG bullet is a FAILURE.

# 3. Consistency spot-checks
grep -n "checkpoint a user set" README.md        # new §4 sentence present (semantic match)
grep -n "consented" README.md                    # consent semantics present
grep -n "19/19" README.md                        # smoke count consistent w/ VERIFICATION.md
grep -c "Resolved bugs" README.md                # 4 subsection headers
grep -n "identical note" README.md               # E22 advisory mentioned
```

### Level 2: Cross-document consistency

```bash
# Smoke count agrees with the (post-P1.M3.T2.S1) VERIFICATION.md
grep -n "19/19" VERIFICATION.md | head
# §4 still lists exactly the four agent tools
grep -n "^### \`mulligan_" README.md   # expect: mulligan_rewind, mulligan_shrink, mulligan_audit, mulligan_cancel
```

### Level 3: Render check

```bash
# Markdown sanity (no broken headings/anchors)
npx --yes markdownlint-cli README.md 2>/dev/null || true   # advisory only
# Manual: confirm the [Human commands (v1.1)](#human-commands-v11) anchor still resolves
```

### Level 4: Not applicable (no runtime behavior changed)

```bash
# No code touched — nothing to run. If ANY file other than README.md is modified, revert it.
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–3 pass; `git status` shows only `M README.md`
- [ ] No code, config, spec, VERIFICATION.md, or scenarios.md changes

### Feature Validation
- [ ] §4 rewind blurb covers checkpoint mode + consent/hides-user-prompts semantics
- [ ] §7 new dated subsection present with the three v2.0 fixes; historical entries byte-identical
- [ ] E22 advisory mentioned alongside the hard backstops
- [ ] Smoke section consistent with 19/19 / VERIFICATION.md
- [ ] Human commands (v1.1) section and verbatim banner line untouched
- [ ] No marketing drift — only what this changeset changed

### Code Quality Validation
- [ ] Matches README's existing voice, heading style, and cross-reference patterns
- [ ] New subsection follows the v1.1 subsection's structure

## Anti-Patterns to Avoid

- ❌ Do NOT renumber or edit historical BUG-001–005 / v1.1 / field-report entries
- ❌ Do NOT paste REWIND_DESC verbatim or quote tool schemas into README
- ❌ Do NOT rewrite sections the changeset didn't touch (§5, §6, shrink/cancel/audit)
- ❌ Do NOT add feature claims beyond the shipped four changes
- ❌ Do NOT modify VERIFICATION.md or scenarios.md (owned by sibling tasks)

---

**Confidence Score**: 9/10 — pure documentation sync with exact anchors, a strict subsection pattern to mirror, and the naming hazard explicitly fenced.