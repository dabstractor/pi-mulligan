name: "P1.M3.T2.S3 — scenarios.md: reconcile overview counts and harness docs with the five new v1.1 scenarios"
description: Documentation-only (Mode B) changeset-level sweep of test/integration/scenarios.md (715 lines). The five new per-scenario sections (F-ckptcmd/F-banner/F-consent/F-drift-userexempt/F-useraudit) and the extended context.fire observables already landed Mode-A with their implementing subtasks; THIS task reconciles only the cross-cutting overview — heading count, suite footer, "How the harness works" (two-run /resume pattern, -ne flag, multi--p flows), and the spec-only not-driven caveat.

---

## Goal

**Feature Goal**: Make `test/integration/scenarios.md` internally consistent with the shipped 19/19 smoke suite (P1.M2.T6.S1): every cross-cutting count, list, and harness description matches the 14 F-* + 5 E* scenarios actually driven by `test/integration/run-smoke.mjs`, and the spec-only not-driven caveat stays honest (F-retrycap/F-abortfraction documented but not auto-run; **there is NO F-cancel section — do not invent one**; the five v1.1 additions ARE driven).

**Deliverable**: A modified `test/integration/scenarios.md` — the ONLY file modified. Concretely:
1. Heading `## The F-* scenarios (10)` (~L98) becomes `(14)` and names the five v1.1 additions (F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt).
2. "## Running the whole suite" footer (~L701-715): "Runs all 14 deterministic scenarios (9 F-* + 5 E*)" → **19 (14 F-* + 5 E*)**, consistent with VERIFICATION.md's recorded 19/19.
3. "## How the harness works" reconciled with (a) the **two-run same-`--session-id` /resume pattern** (F-banner, F-reload, E11) and (b) the **`-ne` flag** (`pi -ne` — defends against a globally-installed older mulligan build colliding; used by F-banner/F-ckptcmd runs), and (c) multi-`-p` flows beyond the canonical two-prompt shape (F-shrink-persist already uses 3; F-consent is split-phase).
4. The not-driven caveat: F-retrycap / F-abortfraction already carry accurate per-section "documented, not auto-run" callouts — keep them accurate; optionally surface one line in the overview that spec-only F-cancel (no section exists; unit-covered) and F-retrycap/F-abortfraction are not auto-driven, while all 14 listed F-* ARE.
5. Every internal cross-reference still resolves (grep every `§`, scenario name, and anchor after editing).

**Success Definition**: `npm run smoke` untouched and still 19/19; scenarios.md contains zero stale counts (grep "14 deterministic", "(9 F-*", "(10)" → no matches); the doc's overview matches run-smoke.mjs's SCENARIOS array exactly (14 F-* then E7/E11/E12/E15/E20).

## Why

- The PRD (BUG-003 / h3.2) and the work-item contract: the five v1.1 sections were added Mode-A by P1.M2.T2–T5, but the playbook's overview still describes the old 14-scenario/9-F-* world — a reader following the overview would believe F-consent et al. don't exist or that the gate is 14/14.
- Completes the changeset-level documentation sync (P1.M3.T2) alongside VERIFICATION.md (S1) and README.md (S2). scenarios.md is the harness playbook CI runners actually consult.
- Keeps the honest boundary: this changeset added only the five v1.1 scenarios (PRD scope); F-cancel/F-retrycap/F-abortfraction remain spec-only/not auto-driven and the doc must not imply otherwise.

## What

### Scope of edits (all in test/integration/scenarios.md)

1. **Heading count** (~L98): `## The F-* scenarios (10)` → `## The F-* scenarios (14)` with a short parenthetical or trailing sentence naming the five v1.1 additions from BUG-003/spec @10 §2.1: **F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt** (added in the v2.0 post-validation round). Keep the existing ordering of the sections as-is on disk: rewind-core, shrink-persist, shrink-preventive, nudge-drift, protected, maxdepth, retrycap, abortfraction, checkpoint, ckptcmd, banner, consent, drift-userexempt, useraudit, failopen, reload.
2. **"Running the whole suite"** (~L707): "Runs all 14 deterministic scenarios (9 F-* + 5 E*)" → "Runs all 19 deterministic scenarios (14 F-* + 5 E*)". Also scan that section's Notes: if any note still implies 14 total, fix it; the per-scenario log-isolation note and SOFT-criteria note stay as-is (still true: model-dependent sub-criteria remain SOFT; F-drift-userexempt's `hasNudge` arm is the drift case).
3. **"How the harness works" reconciliation** (~L10-96):
   - **Two-run /resume pattern**: add a short subsection or extend "The deterministic command path" to document that scenarios needing persistence-across-restart (F-banner run 2, F-reload, E11) spawn a SECOND `pi` process reusing the same `--session-id` (pi reopens/resumes the session). Point at the F-banner section (~L366-401) as the reference example. Do NOT duplicate its full detail — one pattern paragraph + cross-reference.
   - **The `-ne` flag**: mention that some runs use `pi -ne` (F-banner/F-ckptcmd) — it isolates from a globally-installed older mulligan build's extension collision (PRD h2.0 confounder note; the drift-nudge-from-old-build artifact). One or two sentences, cross-reference the F-banner run block.
   - **Multi-prompt flows**: the canonical shape is two `-p` flags; note some scenarios use three (F-shrink-persist, ~L129) or split-phase seeding (F-consent, ~L410) — the second/subsequent `-p` still triggers the observing turn + JSONL flush. Keep it brief; the per-scenario sections carry the detail.
   - **context.fire observables**: the sample line (~L56-73) ALREADY includes `banner`, `userMsgCount`, `firstUserPresent`, `highWater` — verify the surrounding prose (if any) acknowledges the v1.1 observables and reference which scenarios consume them (F-banner → banner; F-consent → userMsgCount/firstUserPresent; F-drift-userexempt → highWater). Add at most one sentence; do not rewrite the JSON block.
4. **Not-driven caveat accuracy**: keep F-retrycap (~L258) and F-abortfraction (~L280) per-section callouts ("Tier-2 live-reproduction path, documented, not auto-run") exactly as they are. There is **no F-cancel section and never was** — if the overview is extended with a not-driven note, name F-cancel as spec-only/unit-covered WITHOUT creating a section for it. Optional (only if it fits naturally under the new heading): one sentence — "Spec-only scenarios not auto-driven: F-cancel (no section; unit-covered), F-retrycap, F-abortfraction (sections above are documented manual paths); everything else listed here is driven by `npm run smoke`."
5. **Cross-reference sweep**: grep for `§`, `F-`, `smoke-`, `L####`-style references and heading anchors inside scenarios.md; fix any broken by the edits (there should be none if edits are additive/local, but verify).

### Out of scope

- Any `src/` or `test/` code file (the suite is DONE and green 19/19 — do not touch run-smoke.mjs or smoke.ts).
- The per-scenario sections themselves (Mode-A, already landed): F-ckptcmd (~L321), F-banner (~L357), F-consent (~L410), F-drift-userexempt (~L459), F-useraudit (~L504), plus the pre-existing ones.
- README.md (S2), VERIFICATION.md (S1), any spec/ file.
- Adding an F-cancel section or converting F-retrycap/F-abortfraction to driven status (PRD scope: only the five v1.1 scenarios were added).

### Success Criteria

- [ ] Heading reads `(14)` and names the five v1.1 additions
- [ ] Footer/summary states 19 deterministic scenarios (14 F-* + 5 E*); no stale "14 deterministic" / "(9 F-*" / "(10)" strings anywhere in the file
- [ ] Harness-works section documents the two-run /resume pattern and the `-ne` flag with cross-references to F-banner
- [ ] Not-driven caveat remains accurate (F-retrycap/F-abortfraction callouts intact; F-cancel, if mentioned, is marked spec-only with no section created)
- [ ] All internal cross-references resolve; only scenarios.md modified

## All Needed Context

### Context Completeness Check

_Passes: the implementer needs only scenarios.md (715 lines, fully mapped below), run-smoke.mjs's SCENARIOS array (read-only ground truth), and awareness of sibling PRP outputs (VERIFICATION.md 19/19 entry, README §7 v2.0 subsection) for consistent cross-references._

### Documentation & References

```yaml
- file: test/integration/scenarios.md
  why: THE file being modified — the harness playbook
  map: "L1-8 header blockquote (mentions 3 model-dependent scenarios — verify still true: F-rewind-core, F-shrink-preventive, F-nudge-drift; F-drift-userexempt's nudge arm is SOFT too — leave unless inaccurate); L10-96 How the harness works (two-extension order L12; deterministic command path L30 incl. the why-a-second-prompt note; log+JSONL L48; context.fire sample L56-73 ALREADY has banner/userMsgCount/firstUserPresent/highWater; §2.3 table L76; API-key tolerance L89); L98 heading '(10)'; L100-598 the sixteen F-* sections (14 driven + retrycap/abortfraction not-driven); L599-699 edge cases E7/E11/E12/E15/E20; L701-715 Running the whole suite ('all 14 deterministic scenarios (9 F-* + 5 E*)' at ~L707)"
  gotcha: "the five v1.1 sections and the extended context.fire sample ALREADY exist — do not re-add or rewrite them; this task is the overview only"

- file: test/integration/run-smoke.mjs
  why: read-only ground truth — SCENARIOS array (L30-50): 14 F-* in order rewind-core, shrink-persist, shrink-preventive, nudge-drift, protected, maxdepth, checkpoint, ckptcmd, banner, consent, drift-userexempt, useraudit, failopen, reload; then E7/E11/E12/E15/E20
  gotcha: note the ARRAY order differs from the DOC's section order (doc lists retrycap/abortfraction between maxdepth and checkpoint; they are NOT in the array) — the doc need not mirror array order, only the count/membership

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M3T2S1/PRP.md
  why: sibling contract — VERIFICATION.md records smoke 19/19 under "v2.0 post-validation fixes"; any count scenarios.md states must agree
- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M3T2S2/PRP.md
  why: sibling contract — README §7 v2.0 subsection names the five scenarios and 19/19; keep naming identical (F-consent, F-ckptcmd, F-banner, F-useraudit, F-drift-userexempt)
```

### Current Codebase tree (relevant excerpt)

```bash
test/integration/scenarios.md    # 715 lines — the ONLY file to modify
test/integration/run-smoke.mjs   # read-only ground truth (19 scenarios)
test/integration/smoke.ts        # read-only (observables already landed)
VERIFICATION.md                  # sibling S1 output (19/19) — cross-reference consistency only
README.md                        # sibling S2 output — cross-reference consistency only
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
test/integration/scenarios.md   # MODIFIED only — no new files
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL — COUNT ARITHMETIC: 14 F-* DRIVEN sections + 2 documented-not-driven (F-retrycap,
#   F-abortfraction) = 16 F-* SECTIONS in the doc, but the heading count is the DRIVEN number (14).
#   There is NO F-cancel section — never create one; F-cancel is spec-only/unit-covered.
# CRITICAL — 19 = 14 F-* + 5 E*. The old text said 14 = 9 F-* + 5 E*. Both numbers change.
#   (Historical note: the older heading once said (9) before F-failopen-era additions; today's file
#   says (10) — both are stale relative to the 14 driven.)
# GOTCHA — Mode B docs task: accuracy IS the validation gate. No code may change; run-smoke.mjs
#   and smoke.ts are read-only. If a count discrepancy makes you want to edit code — STOP, you've
#   misread; the suite is green 19/19 (P1.M2.T6.S1).
# GOTCHA — the harness drift nudge seen live ("mulligan_rewind to undo the turn...") comes from a
#   GLOBALLY-INSTALLED older mulligan build, not this worktree — exactly why F-banner/F-ckptcmd
#   runs use `pi -ne`. Document -ne as environment defense, not as a suite requirement.
# GOTCHA — do not renumber or reorder the existing sections; keep all edits additive/local.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ-ONLY sweep — build the discrepancy list
  - READ test/integration/scenarios.md fully (715 lines) + run-smoke.mjs:30-50
  - GREP stale markers: grep -n '14 deterministic\|9 F-\|(10)\|(9)' test/integration/scenarios.md
  - CONFIRM the five v1.1 sections + observables exist (grep -n '### F-ckptcmd\|### F-banner\|### F-consent\|### F-drift-userexempt\|### F-useraudit\|highWater\|firstUserPresent')
  - LIST every hit → these are exactly the lines to fix; nothing else

Task 2: EDIT the F-* heading (~L98)
  - CHANGE '## The F-* scenarios (10)' → '## The F-* scenarios (14)'
  - ADD one sentence naming the v1.1 additions (F-consent, F-ckptcmd, F-banner, F-useraudit,
    F-drift-userexempt — BUG-003 / spec @10-testing.md §2.1, v2.0 post-validation round)
  - OPTIONAL: one-line not-driven caveat per What §4 (F-cancel spec-only, no section;
    F-retrycap/F-abortfraction documented manual paths)

Task 3: EDIT "Running the whole suite" (~L701-715)
  - CHANGE 'Runs all 14 deterministic scenarios (9 F-* + 5 E*)' → '...all 19 deterministic
    scenarios (14 F-* + 5 E*)...'
  - RE-READ the Notes bullets; update any that imply the old count; leave SOFT-criteria and
    log-isolation notes intact (still true)

Task 4: EDIT "How the harness works" (~L10-96) — two-run /resume + -ne + multi--p
  - ADD (either a new short subsection after 'The deterministic command path' or an extension
    of it): the two-run pattern — scenarios proving persistence across restart (F-banner run 2,
    F-reload, E11) spawn a second pi process with the SAME --session-id, which pi reopens/resumes;
    cross-reference '### F-banner' as the reference example
  - ADD: the -ne flag note — `pi -ne` (used by F-banner/F-ckptcmd) isolates the run from a
    globally-installed older mulligan build's extension collision; environment defense, not a
    suite requirement
  - ADD one sentence: some scenarios use more than the canonical two -p flags (three: F-shrink-persist;
    split-phase: F-consent) — later -p prompts are ordinary observing turns
  - VERIFY the context.fire sample (L56-73) prose: add at most one sentence mapping observables
    to consumers (banner→F-banner, userMsgCount/firstUserPresent→F-consent, highWater→F-drift-userexempt)

Task 5: CROSS-REFERENCE + consistency sweep
  - GREP every internal reference: grep -n 'F-\|§\|smoke-' test/integration/scenarios.md → resolve each
  - CROSS-DOC: grep -n '19/19' VERIFICATION.md (post-S1) and README.md (post-S2) — counts must agree
  - CONFIRM no stale strings remain: grep -n '14 deterministic\|(9 F-\* + 5' → 0 matches
```

### Implementation Patterns & Key Details

```markdown
<!-- Heading edit pattern (keep the existing plain style): -->

## The F-* scenarios (14)

Ten v1.0 scenarios plus the five v1.1 additions (F-consent, F-ckptcmd, F-banner, F-useraudit,
F-drift-userexempt — BUG-003 / spec @10-testing.md §2.1, added in the v2.0 post-validation round).
F-retrycap and F-abortfraction below are documented manual (Tier-2) paths, not auto-run; spec-only
F-cancel has no section (unit-covered). Everything else here is driven by `npm run smoke`.

<!-- Two-run pattern paragraph pattern (inside How the harness works): -->

### The two-run `/resume` pattern

Scenarios that prove state persists across a process restart (F-banner, F-reload, E11) run **twice**:
a second `pi` invocation with the **same `--session-id`**, which pi reopens/resumes (see F-banner's
Run 1 / Run 2 blocks for the reference form). Those runs also pass `-ne` to isolate from a
globally-installed older mulligan build (environment defense, not a suite requirement).
```

### Integration Points

```yaml
DOCS:
  - cross-doc consistency: VERIFICATION.md "v2.0 post-validation fixes" records 19/19 (sibling S1);
    README.md §7 v2.0 subsection names the same five scenarios (sibling S2) — use identical names/counts
NO CODE / CONFIG / DATABASE CHANGES.
```

## Validation Loop

### Level 1: Accuracy (docs task — accuracy IS the gate)

```bash
# 1. Only scenarios.md changed
git status --porcelain          # expect: M test/integration/scenarios.md only
# 2. No stale counts
grep -n '14 deterministic\|(9 F-\*\|(10)' test/integration/scenarios.md   # expect: 0 matches
grep -n '19 deterministic\|(14 F-\*' test/integration/scenarios.md        # expect: footer hit
grep -n '## The F-\* scenarios (14)' test/integration/scenarios.md        # expect: heading hit
# 3. Five v1.1 sections still present and untouched by the diff
grep -c '^### F-' test/integration/scenarios.md   # 16 (14 driven + retrycap + abortfraction)
# 4. -ne and /resume documented in the harness section
grep -n '\-ne\|/resume' test/integration/scenarios.md | head
# 5. Diff hygiene: per-scenario sections unchanged (edits confined to overview/footer)
git diff test/integration/scenarios.md | grep '^-' | grep -v '^---'
# Expected: deletions ONLY on the two rewritten overview lines (heading count, footer count)
```

### Level 2: Cross-document consistency

```bash
grep -n '19/19' VERIFICATION.md | head      # sibling-recorded gate — must agree
grep -n 'F-consent' README.md | head        # sibling §7 naming — identical names
```

### Level 3: Suite untouched and still green

```bash
git diff --stat           # code files absent
npm run smoke 2>&1 | tail -5   # expect 19/19 PASS, exit 0 (unchanged code — sanity only;
                               # skip if environment can't spawn pi, the code is untouched)
```

### Level 4: Not applicable (no runtime behavior changed)

## Final Validation Checklist

### Technical Validation
- [ ] Level 1–3 pass; `git status` shows only `M test/integration/scenarios.md`
- [ ] No code, spec, README, or VERIFICATION.md changes

### Feature Validation
- [ ] Heading `(14)` + five v1.1 names; footer 19 (14 F-* + 5 E*)
- [ ] Two-run /resume pattern and `-ne` flag documented with cross-references
- [ ] Not-driven caveat accurate; no F-cancel section created
- [ ] All internal cross-references resolve; counts agree with VERIFICATION.md/README.md
- [ ] Per-scenario sections (incl. the five v1.1 ones) byte-identical to pre-edit

### Code Quality Validation
- [ ] Matches the playbook's existing voice (plain headings, bold key words, bash blocks)
- [ ] Edits additive/local; no section reordering or renumbering

## Anti-Patterns to Avoid

- ❌ Do NOT touch run-smoke.mjs / smoke.ts / any src file — the suite is green and out of scope
- ❌ Do NOT rewrite or duplicate the five v1.1 scenario sections or the context.fire JSON sample
- ❌ Do NOT create an F-cancel section or mark F-retrycap/F-abortfraction as driven
- ❌ Do NOT change section order to mirror the SCENARIOS array — counts/membership only
- ❌ Do NOT state a count that disagrees with VERIFICATION.md's 19/19

---

**Confidence Score**: 9/10 — the file is fully mapped with exact line anchors, the stale strings are enumerable by grep, the landed v1.1 content is confirmed present, and the only hazards (count arithmetic, no-F-cancel, read-only code) are explicitly fenced.