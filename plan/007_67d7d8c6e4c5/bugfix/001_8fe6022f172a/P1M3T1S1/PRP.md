# PRP — P1.M3.T1.S1: README high-water description + resolved-bugs entries for BUG-001–004 (Mode B doc sync)

## Goal

**Feature Goal**: Sync `README.md` to the landed v1.1 validation-pass bug round (BUG-001–004). Verify the
high-water / driftThresholdTokens / highWaterFraction README lines are consistent with the fixes (they are —
the implementing subtasks updated them Mode-A), and **add 4 resolved-bugs entries** in a separate,
collision-free subsection so the README's changelog reflects the round.

**Deliverable**: Edits to **`README.md` ONLY** — insert one new subsection (`### Resolved bugs — v1.1
validation pass (BUG-001–BUG-004)` + 4 bullets) after the existing `### Resolved bugs (BUG-001–BUG-005)`
section. No prose change to lines 98/100/118/233 (already consistent — verification only). No code, no tests.

**Success Definition**: After the edit, (a) README has the new "v1.1 validation pass (BUG-001–BUG-004)"
subsection with exactly 4 bullets (one per fix), clearly labeled so it does NOT collide with the prior
"BUG-001–BUG-005" section; (b) the prior section (lines 258-265) is preserved unchanged; (c) line 233 still
quotes the awareness-only high-water text (no stale `mulligan_rewind`/`mulligan_shrink`/`Consider … reclaim
space` wording); (d) `npm run typecheck` + `npx vitest run` are green (README edits are non-behavioral).

> ⚠️ **Most of the contract's "update" steps are VERIFY-ONLY.** Research confirmed README lines 98 (driftThresholdTokens=4000 + `>=`), 100 (highWaterFraction=0.7), 118 (example), and 233 (the awareness-only
> high-water quote) are **already consistent** with the fixes — the implementing subtasks (P1.M1.T1.S1,
> P1.M1.T2.S1, P1.M2.T1.S1) updated them Mode-A. So contract steps (a) and (c) require NO prose edit, only a
> grep verification. The **sole README edit** is the 4 new resolved-bugs bullets (contract step b).

## User Persona (if applicable)

**Target User**: Developers/operators reading the README changelog to see what the v1.1 validation pass fixed.

**Use Case**: A maintainer reads "Resolved bugs" to understand the nudge/audit/guard-layer fixes shipped this
round, distinct from the earlier round.

**Pain Points Addressed**: Pre-sync, the README's "Resolved bugs" section lists only the PRIOR round
(BUG-001–005: checkpoint-clearing, config-validation, etc.). The current round's 4 fixes are undocumented.

## Why

- **Changelog completeness**: each remediation round adds a resolved-bugs section; this round (4 fixes) needs
  the same so the README stays an accurate changelog.
- **Numbering non-collision**: the prior round and this round BOTH number their findings BUG-001..N. A single
  merged list would conflate them (e.g., "BUG-001 checkpoint-clearing" vs "BUG-001 driftThresholdTokens"). A
  separate, labeled subsection ("v1.1 validation pass") keeps them distinct and unambiguous.
- **Awareness-only contract visibility**: BUG-002 (high-water no longer prescribes rewind/shrink) is a
  user-observable behavior change worth recording in the changelog even though the feature blurb (line 233) was
  already updated.
- **[Mode B]**: this IS the changeset-level documentation sync task (contract DOCS clause).

## What

One README edit: insert a new subsection after the existing resolved-bugs section. Plus verification (grep)
that the high-water / config lines are already consistent (no edit).

### Success Criteria

- [ ] README has a new `### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)` subsection with exactly 4
      bullets (BUG-001 Major, BUG-002 Major, BUG-003 Minor, BUG-004 Minor).
- [ ] The new subsection is placed AFTER the prior `### Resolved bugs (BUG-001–BUG-005)` section's last bullet
      and BEFORE `## 8. License`.
- [ ] The prior `### Resolved bugs (BUG-001–BUG-005)` section (lines 258-265) is UNCHANGED.
- [ ] `grep -nE 'mulligan_rewind.*reclaim|mulligan_shrink.*reclaim|Consider mulligan_(rewind|shrink)' README.md`
      → 0 hits (line 233 has no stale high-water prescription wording).
- [ ] `grep -n 'driftThresholdTokens.*4000' README.md` → hits (line 98 + 118 already correct; unchanged).
- [ ] `npm run typecheck` exits 0; `npx vitest run` green (README-only edit → non-behavioral).
- [ ] No file other than `README.md` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the verbatim new subsection to insert (heading + 4 bullets), the exact placement
anchors (the prior section's last bullet + the `## 8. License` heading), the verification result that lines
98/100/118/233 are already consistent (so no prose edit — with the grep that proves it), the 4 fix descriptions
verified against the source (nudges.ts/config.ts/audit.ts + the BUG-004 sibling contract), and deterministic
grep + typecheck/vitest gates. The implementer opens one file and inserts one block.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: README.md
  why: The "Resolved bugs" changelog. The prior round's section (### Resolved bugs (BUG-001–BUG-005), lines
        258-265) is complete; this round (BUG-001–004) is missing. Insert the new subsection after line 265.
  section: "§7 Known Limitations → '### Resolved bugs (BUG-001–BUG-005)' (line 258, heading; bullets 262-265);
            '## 8. License' (line 269). Insert the new subsection BETWEEN the last prior bullet and ## 8."
  pattern: "Each bullet: '- **BUG-NNN (Severity)** — one-line description.' (match the existing format at
            lines 262-265). Use a ### subsection heading so it nests under §7 alongside the prior section."
  gotcha: "Use TEXT anchors (the prior BUG-005 bullet + the '## 8. License' heading), NOT line numbers —
           line numbers shift as you insert. The new heading MUST be distinct from '### Resolved bugs
           (BUG-001–BUG-005)' to avoid number collision."

# MUST READ — the authoritative 4-bug analysis (the resolved-bugs entry source of truth)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/bug_analysis.md
  why: Per-bug divergence + fix + spec citation for BUG-001..004. The 4 bullets summarize these.
  critical: "BUG-001: the PRD's '6000' premise is STALE — code/spec/README/tests already agree at 4000+>=;
             the fix was spec-text (>) → (>=) consistency. Do NOT write the bullet as if the default changed
             from 6000→4000 in this round; write it as 'reconciled with spec §5.1 (b)'. BUG-002: awareness-only
             (D10). BUG-003: '(user-set)' + singularize. BUG-004: count active (exclude cancelled)."

# MUST READ — the system-context summary table (cross-check the 4 fixes)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/system_context.md
  why: "§The Four PRD Divergences table: BUG-001 config.ts:168, BUG-002 nudges.ts:534-543, BUG-003 audit.ts:448-454,
        BUG-004 rewind.ts:204-220. Confirms the file:line + one-line description per bug."
  critical: "Confirms all 4 are nudge/audit/guard-layer (no core soft-delete / data-loss impact)."

# VERIFY (no edit) — README line 233 already matches the awareness-only source
- file: src/nudges.ts
  why: READ-ONLY. renderHighWaterNudge (lines 538-546) returns the awareness-only text
        `[mulligan] Context is at ~<pct>% of the window; review recent output for reclaimable space.`
        (NO mulligan_rewind/mulligan_shrink). README line 233 already quotes this exact string → consistent.
  critical: "This PROVES contract step (a) is verify-only — P1.M1.T2.S1 updated README line 233 Mode-A.
             Do NOT edit line 233. The grep gate (0 'Consider mulligan_…' hits) confirms it."

# VERIFY (no edit) — README line 98 already documents 4000 + >=
- file: src/config.ts
  why: READ-ONLY. driftThresholdTokens default = 4000 (line 168). README line 98 already documents 4000 + the
        >= rationale. → consistent. Do NOT edit line 98.
- file: src/nudges.ts
  why: READ-ONLY. shouldNudge uses `avg >= config.nudges.driftThresholdTokens` (line 332). Matches README line 98.

# CONTEXT — the BUG-004 sibling (parallel; defines the depth-guard fix the BUG-004 bullet describes)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/P1M2T2S1/PRP.md
  why: CONTRACT. BUG-004 = countRewindMarkers cancel-exclusion (mirror of BUG-005 countRetriesAtLatestPrompt +
        readMarkers cancelledIds), spec/05 §1 step 4 "count active". Edits src/tools/rewind.ts +
        test/tools/rewind.test.ts — ZERO overlap with README. Assume applied (the BUG-004 bullet describes it).
  gotcha: "Do NOT edit src/tools/rewind.ts (sibling's file). README-only."
```

### Current Codebase tree (the relevant slice)

```bash
README.md                              # ← EDIT: insert 1 new subsection (heading + 4 bullets) after line 265
src/nudges.ts                          # READ-ONLY — renderHighWaterNudge (538-546) awareness-only; shouldNudge >= (332)
src/config.ts                          # READ-ONLY — driftThresholdTokens:4000 (168)
src/tools/audit.ts                     # READ-ONLY — BUG-003 (user-set) annotation (449-454)
src/tools/rewind.ts                    # READ-ONLY — BUG-004 countRewindMarkers (sibling P1.M2.T2.S1)
spec/07-preventive-and-nudges.md       # READ-ONLY — §5.1 (b), §5.2 v1.1 awareness note
plan/.../architecture/{system_context,bug_analysis}.md  # READ-ONLY — the 4-bug source of truth
```

### Desired Codebase tree with files to be added or responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
README.md   # +1 subsection ("### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)" + 4 bullets)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL GOTCHA #1 (BUG-001's PRD premise is STALE — do NOT write "6000 → 4000"): the PRD bug report claims
#   spec/09 §2 shows 6000, but the CURRENT spec/09 already shows 4000 (amended in a prior cycle). Code, spec,
#   README (line 98), and tests ALL already agree at 4000 + >=. This round's BUG-001 fix was a spec/07 §5.1
#   TEXT consistency fix (> → >=) + comment cleanup, NOT a default change. Write the bullet as "reconciled
#   with spec/07 §5.1 (b)" — NOT "lowered from 6000 to 4000" (that would be historically wrong).

# CRITICAL GOTCHA #2 (numbering COLLISION with the prior round — use a separate labeled subsection): README
#   already has "### Resolved bugs (BUG-001–BUG-005)" (lines 258-265) from a PRIOR round (checkpoint-clearing,
#   config-validation, shrink-empty-substring, audit-enabled-gate). This round ALSO numbers BUG-001..004 but
#   for DIFFERENT issues. DO NOT merge into one list (a reader would see two "BUG-001"s). ADD a separate
#   "### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)" subsection. Both coexist, clearly labeled.

# CRITICAL GOTCHA #3 (lines 98/100/118/233 are ALREADY consistent — do NOT edit them): the implementing
#   subtasks updated the README Mode-A. Research verified: line 233 = awareness-only quote (matches source);
#   line 98 = 4000 + >= rationale; line 118 = example with 4000; line 100 = 0.7 (unaffected). Contract steps
#   (a) + (c) are VERIFY-ONLY. Editing them risks introducing a regression. The grep gate confirms consistency.

# CRITICAL GOTCHA #4 (preserve the prior round's section): the "### Resolved bugs (BUG-001–BUG-005)" section
#   (lines 258-265) is accurate history for ITS round. Do NOT modify, reorder, or relabel it. Insert the new
#   subsection AFTER it (after line 265's BUG-005 bullet), before "## 8. License".

# GOTCHA (TEXT-anchored insertion, not line numbers): find the prior section's LAST bullet
#   ("- **BUG-005 (Minor)** — `mulligan_audit` now refuses when `enabled: false` (stays read-only).") and the
#   "## 8. License" heading; insert the new subsection between them. Line numbers (258-269) are a guide, not
#   an anchor — they may have shifted.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/* and test/* → the fixes' owners; READ-ONLY.
#   - README lines 98, 100, 118, 233 → already consistent (verification only; editing risks regression).
#   - The prior "### Resolved bugs (BUG-001–BUG-005)" section (lines 258-265) → preserve.
#   - spec/* → READ-ONLY.
# This PRP edits ONLY README.md (one new subsection).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a markdown changelog insertion. The "model" is the 4-bug summary (verified
against the source) rendered as 4 bullets matching the existing format._

### Implementation Tasks (ordered by dependencies)

One insertion task + verification. Use TEXT anchors, not line numbers.

```yaml
Task 1: INSERT README.md — new "v1.1 validation pass" resolved-bugs subsection
  - LOCATE the END of the prior resolved-bugs section: its LAST bullet is
      "- **BUG-005 (Minor)** — `mulligan_audit` now refuses when `enabled: false` (stays read-only)."
    and the next heading is "## 8. License".
  - INSERT (between that bullet and "## 8. License") the following subsection (verbatim):

      ### Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)

      - **BUG-001 (Major)** — `driftThresholdTokens` default (4000) and the `shouldNudge` comparison (`>=`, not `>`) are reconciled with spec/07 §5.1 acceptance criterion (b): three ~4k turns in a row now fire the drift nudge (previously the strict-`>` + 6000 default failed to fire).
      - **BUG-002 (Major)** — the §5.2 high-water nudge is now **awareness-only** (`Context is at ~<pct>% of the window; review recent output for reclaimable space.`) and no longer prescribes `mulligan_rewind`/`mulligan_shrink`, since the signal fires on user-attributable content the agent cannot legitimately shed (D10).
      - **BUG-003 (Minor)** — the `mulligan_audit` "Active markers" checkpoint clause now appends ` (user-set)` and singularizes the count (spec/13 §4 step 3), so the human sees exactly what they have armed.
      - **BUG-004 (Minor)** — the rewind depth guard (`rewind.maxDepth`) now counts only **active** markers, excluding those retired by `mulligan_cancel` (spec/05 §1 step 4 "count active"), so the cancel-then-retry workflow is no longer blocked at 5 cumulative rewinds.

  - RATIONALE (per bullet, matching the source of truth):
      BUG-001: config.ts:168=4000 + nudges.ts:332 `>=`; spec/07 §5.1 (b). (NOT "6000→4000" — GOTCHA #1.)
      BUG-002: nudges.ts:538-546 awareness-only; spec/07 §5.2 v1.1 note (D10).
      BUG-003: audit.ts:449-454 `(user-set)` + singularize; spec/13 §4 step 3.
      BUG-004: rewind.ts countRewindMarkers cancel-exclusion (sibling P1.M2.T2.S1); spec/05 §1 step 4.
  - FORMAT: each bullet is `- **BUG-NNN (Severity)** — description.` (matches lines 262-265). The `### ` heading
    nests under §7 "Known Limitations" alongside the prior `### Resolved bugs (BUG-001–BUG-005)`.
  - DO NOT: merge into the prior section; edit lines 98/100/118/233; touch any other file.

Task 2: VERIFY (no edit) — README lines 98/100/118/233 are consistent with the fixes
  - RUN (each should confirm consistency; NO edit if they pass):
      grep -nE 'Consider mulligan_(rewind|shrink).*reclaim|mulligan_rewind.*reclaim space' README.md
        # EXPECT: 0 hits (line 233 is awareness-only — no stale prescription).
      grep -n 'driftThresholdTokens.*`4000`' README.md
        # EXPECT: line 98 (the config table row) — already documents 4000 + >=.
      grep -n 'highWaterFraction.*`0.7`' README.md
        # EXPECT: line 100 — unaffected by BUG-002 (text change, not fraction).
  - IF any check FAILS (a stale line), ONLY THEN edit that line to match the source. Otherwise leave all four
    lines untouched (GOTCHA #3 — editing risks regression).

Task 3: VALIDATE (no-regression sanity — contract step d)
  - RUN: npm run typecheck        # = tsc --noEmit → expect exit 0.
  - RUN: npx vitest run           # → expect green (1042 tests; README-only edit cannot change this).
```

### Implementation Patterns & Key Details

```markdown
# PATTERN (collision-free changelog numbering): two remediation rounds both number BUG-001..N. Keep them in
#   SEPARATE ### subsections under §7, each clearly labeled by round ("BUG-001–BUG-005" vs "v1.1 validation
#   pass BUG-001–BUG-004"). A reader scanning the changelog sees two distinct rounds, not a conflated list.

# PATTERN (bullet format): match the existing bullets at lines 262-265 exactly —
#   `- **BUG-NNN (Severity)** — <one-line description with the key spec cite>.`
#   Keep each to one line (they wrap in render). Lead with the user-observable change, parenthetical the spec.

# CRITICAL (BUG-001 wording — do NOT say "6000 → 4000"): the PRD's 6000 premise is stale; code/spec/README
#   already agreed at 4000 before this round. This round reconciled the >= operator + spec text. Write
#   "reconciled with spec/07 §5.1 (b)" (GOTCHA #1).

# CRITICAL (verify-only for lines 98/100/118/233): the implementing subtasks updated README Mode-A. Research
#   confirmed consistency. The grep gate (Task 2) is the proof; edit ONLY if a check fails (GOTCHA #3).
```

### Integration Points

```yaml
NO INTEGRATION POINTS — documentation-only (Mode B doc sync).
  - DATABASE: none
  - CONFIG: none (README line 98 documents driftThresholdTokens=4000 but is not config; it's already correct)
  - ROUTES: none
  - CODE: none (all src/* is READ-ONLY; this task quotes the post-fix state but edits nothing)
  - TESTS: none (the fixes' owners added regression tests; this task only DOCUMENTS them in the changelog)
  - DOCS: README.md ONLY. This IS the changeset-level documentation task (contract DOCS clause).
  - PARALLEL-SIBLING COORDINATION: P1.M2.T2.S1 (BUG-004) edits src/tools/rewind.ts + test/tools/rewind.test.ts
          — different file, zero overlap. The BUG-004 bullet describes its fix; assume it is applied.
  - The only "integration" is DOC CONSISTENCY: the new bullets must AGREE with the source (4000+>=,
          awareness-only high-water, (user-set) audit annotation, cancel-excluded depth guard). The grep +
          source-read gates enforce this.
```

---

## Validation Loop

A README-only edit cannot break the build. Validation = grep confirms the new subsection + the already-consistent
lines + typecheck/vitest as no-regression sanity (contract step d).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The new subsection + 4 bullets landed:
grep -n 'Resolved bugs — v1.1 validation pass (BUG-001–BUG-004)' README.md   # EXPECT: 1 (the new heading).
grep -cE '^\- \*\*BUG-00[1-4] \(' README.md                                  # EXPECT: ≥4 (the 4 new bullets; the
                                                                              # prior section's BUG-001..005 add more).

# (b) The prior round's section is PRESERVED:
grep -n '### Resolved bugs (BUG-001–BUG-005)' README.md                       # EXPECT: 1 (the prior heading intact).

# (c) The new subsection sits in the right place (after the prior BUG-005 bullet, before ## 8. License):
grep -n -E 'BUG-005 \(Minor\).*audit now refuses|## 8. License|v1.1 validation pass' README.md
# EXPECT (in order): the prior BUG-005 bullet line, THEN the new "v1.1 validation pass" heading, THEN "## 8. License".

# (d) Line 233 has NO stale high-water prescription (verify-only — contract step a):
grep -nE 'Consider mulligan_(rewind|shrink)|mulligan_rewind.*reclaim space|mulligan_shrink.*reclaim space' README.md
# EXPECT: 0 hits.
```
Expected: (a) new heading + ≥4 new bullets; (b) prior heading intact; (c) correct ordering; (d) 0 stale prescription hits.

### Level 2: Source-agreement check (the core gate — bullets match the post-fix code)

```bash
# The 4 bullets must agree with the source.
echo "--- BUG-001: driftThresholdTokens=4000 + >= ---"
grep -n 'driftThresholdTokens: 4000' src/config.ts               # EXPECT: line 168.
grep -n 'avg >= config.nudges.driftThresholdTokens' src/nudges.ts # EXPECT: line 332.

echo "--- BUG-002: high-water awareness-only (no rewind/shrink) ---"
grep -nE 'review recent output for reclaimable space' src/nudges.ts          # EXPECT: the new text (546).
grep -nE 'Consider mulligan_(rewind|shrink).*reclaim' src/nudges.ts          # EXPECT: 0 (the old prescription gone).

echo "--- BUG-003: audit (user-set) annotation ---"
grep -n 'ckptUserSet' src/tools/audit.ts                          # EXPECT: line ~454 (the annotation logic).

echo "--- BUG-004: countRewindMarkers cancel-exclusion (sibling P1.M2.T2.S1) ---"
grep -nE 'cancelledRewindIds|countRewindMarkers' src/tools/rewind.ts | head  # EXPECT: the cancel-exclusion landed.
```
Expected: each bullet's claim is backed by the cited source line. (If BUG-004's grep is empty, the sibling hasn't landed — the bullet still describes the intended fix; note it.)

### Level 3: Build + tests (no-regression sanity — contract step d)

```bash
# README edits CANNOT affect tsc or vitest. Run as sanity (contract step d explicitly requires it).
npm run typecheck        # = tsc --noEmit → expect exit 0.
echo "typecheck exit: $?"
npx vitest run           # → expect green (1042 tests; README-only edit cannot change the count).
# If NON-green: it reflects the parallel sibling P1.M2.T2.S1's in-flight state (it edits rewind.ts), NOT this
# README task. Confirm via `git diff --name-only` — your hunks are README.md only.
```
Expected: typecheck exit 0; vitest green (count unchanged by this task).

### Level 4: Scope-discipline gate (no collateral edits)

```bash
git diff --stat           # EXPECT: README.md ONLY.
git diff --name-only | grep -vE '^README.md$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/*, test/*, spec/* must NOT appear. (Parallel sibling P1.M2.T2.S1's rewind.ts/test
#   edits, if applied, are its own diff — confirm YOUR hunks are README.md only via `git diff -- README.md`.)
```
Expected: only `README.md` in your diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: the new "v1.1 validation pass (BUG-001–BUG-004)" subsection + 4 bullets are present; the prior
      section is intact; the new subsection is correctly placed; line 233 has 0 stale prescription wording.
- [ ] Level 2: each bullet's claim is backed by the cited source line (4000+>=, awareness-only, (user-set),
      cancel-excluded).
- [ ] Level 3: `npm run typecheck` exit 0; `npx vitest run` green (README-only → non-behavioral).
- [ ] Level 4: `git diff --name-only` shows ONLY `README.md`.

### Feature Validation
- [ ] README has a new subsection with exactly 4 bullets (BUG-001 Major, BUG-002 Major, BUG-003 Minor, BUG-004 Minor).
- [ ] The BUG-001 bullet says "reconciled with spec/07 §5.1 (b)" — NOT "lowered from 6000 to 4000".
- [ ] The BUG-002 bullet describes the awareness-only text and the D10 rationale (fires on user content).
- [ ] The new subsection is distinct from (does not merge into) the prior "BUG-001–BUG-005" section.
- [ ] Lines 98/100/118/233 are UNCHANGED (already consistent — verify-only).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `README.md` (one new subsection).
- [ ] Did NOT edit any `src/*` or `test/*` (the fixes' owners; READ-ONLY).
- [ ] Did NOT edit README lines 98/100/118/233 (already consistent; editing risks regression).
- [ ] Did NOT modify or relabel the prior "Resolved bugs (BUG-001–BUG-005)" section.
- [ ] Did NOT edit `spec/*`.
- [ ] Used TEXT anchors (the prior BUG-005 bullet + `## 8. License` heading), not line numbers.

### Documentation
- [ ] [Mode B] README's changelog now reflects the v1.1 validation-pass round (4 fixes), distinct from the prior round.
- [ ] The new bullets are consistent with the architecture bug_analysis.md + the verified source state.

---

## Anti-Patterns to Avoid

- ❌ Don't write the BUG-001 bullet as "lowered driftThresholdTokens from 6000 to 4000." The PRD's 6000 premise
  is STALE — code/spec/README/tests already agreed at 4000 before this round. This round reconciled the `>=`
  operator + spec text. Write "reconciled with spec/07 §5.1 (b)." (GOTCHA #1.)
- ❌ Don't merge the new bullets into the prior "### Resolved bugs (BUG-001–BUG-005)" section. Both rounds number
  BUG-001..N; merging creates two "BUG-001"s. Use a separate labeled subsection. (GOTCHA #2.)
- ❌ Don't edit README lines 98/100/118/233. The implementing subtasks updated them Mode-A; research verified
  consistency. They are VERIFY-ONLY; editing risks a regression. (GOTCHA #3; Task 2's grep is the proof.)
- ❌ Don't modify the prior round's section (lines 258-265). It's accurate history for its round. Insert AFTER it.
- ❌ Don't edit `src/*`, `test/*`, or `spec/*` — those are the fixes'/siblings'/read-only. README only.
- ❌ Don't use line numbers as the insertion anchor — they shift. Anchor on the prior BUG-005 bullet + `## 8. License`.
- ❌ Don't run only the typecheck/vitest and call it validated — those are no-regression sanity (README edits can't
  fail them). The REAL gates are the subsection-presence grep (Level 1) + the source-agreement check (Level 2).
- ❌ Don't describe BUG-004 as "fixed" if the sibling P1.M2.T2.S1 hasn't landed — verify with the Level-2 grep;
  if empty, the bullet still describes the intended fix but note the dependency.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a single-subsection markdown insertion with: the verbatim
heading + 4 bullets (each backed by a cited, verified source line), the exact placement anchors (prior BUG-005
bullet + `## 8. License`), the research-verified fact that lines 98/100/118/233 are already consistent (so the
"update" steps are verify-only, removing the main failure mode of accidental regression), and deterministic
grep + typecheck/vitest gates. The two residual risks — both clearly flagged — are (1) writing BUG-001 as
"6000→4000" instead of "reconciled" (mitigated by GOTCHA #1 + the bullet's verbatim wording) and (2) merging
into the prior section / colliding numbers (mitigated by GOTCHA #2 + the distinct subsection heading). README
edits are provably non-behavioral, so typecheck/tests are guaranteed unchanged by THIS task (any in-flight
sibling state is documented). No dependency on the parallel BUG-004 sibling beyond the bullet describing its fix.