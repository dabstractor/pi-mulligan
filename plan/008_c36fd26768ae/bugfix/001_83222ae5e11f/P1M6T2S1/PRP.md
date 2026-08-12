---
name: "P1.M6.T2.S1 — Sync README.md §5 (working-tree revert v1.2) to post-bugfix behavior; verify VERIFICATION.md"
description: |
  CORRECTIVE docs-only pass. README.md §5 "Working-tree revert (v1.2, opt-in)" (lines ~202–260) was
  written to the SPEC; the changeset's 7 bug fixes (P1.M1–P1.M5) made 4 of the intended §5 behaviors
  actually true. This item makes the §5 feature descriptions precisely match the NOW-SHIPPED behavior
  and confirms VERIFICATION.md has no stale v1.2 claims. It is NOT a rewrite and adds NO new sections.

  THE ONE SUBSTANTIVE EDIT is the "Dirty-guard behavior" paragraph (README.md:245), corrected for
  BUG-001 + BUG-004: (a) the affected set is now the comprehensive snapshot DIFF (every workspace path
  differing pre-turn→now — write/edit AND bash python/perl/heredoc), not the heuristic write/edit
  ledger — so the "never a silent clobber" guarantee now holds for ALL file-modifying tools; (b) the
  dirty guard runs only when a checkpoint has an `afterRef` — checkpoints capture once and have none,
  so checkpoint-granularity revert SKIPS the guard and restores directly (pre-fix it was always
  refused); (c) precision: the rewind marker field is `refusedFiles` (src/markers.ts:97), not `refused`.

  THREE OPTIONAL INLINE TOUCH-UPS (no new sections, no restructure): (1) explicit-paths non-git mode
  (README.md:251, BUG-003) — VERIFY the now-functional description; edit only if a wording nuance is
  off; (2) caps table / per-call flags (README.md:218/256, BUG-005) — optional clause that
  caps-exhausted paths are surfaced in the result (skipped bucket now populated); (3) checkpoint
  persistence across /resume (BUG-002) — optional one-sentence inline note that session_start rebuilds
  checkpoint snapshots so checkpoint file-revert survives /resume.

  VERIFICATION.md: a v1.0 DoD report (grep-confirmed: ZERO v1.2 working-tree-revert content). VERIFY
  via grep and make NO edits — its historical test-count baselines (671/956/974) are intentionally
  preserved snapshots, not stale.

  CONTRACT scope: README.md (§5 prose only) + a VERIFICATION.md grep-verify. NOTHING else. If
  `git diff --name-only` shows src/**, test/**, spec/**, package.json, or VERIFICATION.md edits,
  STOP and revert — this is a docs-only item.

---

## Goal

**Feature Goal**: README.md §5 "Working-tree revert (v1.2, opt-in)" describes the v1.2 feature exactly
as it NOW behaves after the P1.M1–P1.M5 bug fixes, and VERIFICATION.md is confirmed free of stale v1.2
claims — so a reader (human or agent) gets an accurate picture of the shipped revert semantics, not the
pre-bug intended-but-broken description.

**Deliverable**: 
1. ONE substantive Markdown rewrite — the "Dirty-guard behavior" paragraph at `README.md:245` — so it
   states the post-fix affected set (snapshot diff, all tools) and the checkpoint-skips-guard nuance,
   and uses the correct marker field name (`refusedFiles`).
2. UP TO THREE optional one-sentence/one-clause inline clarifications in §5 (explicit-paths verify;
   caps/skipped surfacing; checkpoint /resume persistence) — no new sections, no table restructure.
3. A grep-verified confirmation that VERIFICATION.md has no v1.2 working-tree-revert content (→ no
   edits to VERIFICATION.md; document the finding).

**Success Definition**:
- README §5's dirty-guard, granularity, non-git-mode, and caps descriptions are each accurate against
  the post-fix implementation (cross-checked vs `src/tools/rewind.ts` step 6b, `src/markers.ts:83-100`,
  `src/snapshot/store.ts` RestoreResult, and the 5 bug-fix PRP descriptions).
- No new section, no new table, no config-knob/API-surface mention added (the bug fixes added none).
- `git diff --name-only` shows at most `README.md` (VERIFICATION.md untouched).
- `npm test` is unaffected and still green (docs-only — no test asserts README prose).

## User Persona (if applicable)

**Target User**: a developer/agent reading README §5 to understand v1.2 working-tree revert before
opting in — and the future maintainer who must trust the doc matches the code after the bugfix release.

**Use Case**: "I want to know exactly what `revert_file_changes` will and won't do — including whether a
checkpoint rewind restores files, whether bash-written files are dirty-guarded, and what survives
/resume."

**Pain Points Addressed**: today §5 over-promises/imprecisely describes behaviors that were broken
pre-fix; a careful reader who tested checkpoint revert or explicit-paths mode before the fix would have
found the doc did not match reality. Post-fix the behaviors are true; this sync makes the doc say so
precisely.

## Why

- **Docs-trust for a release.** This is the changeset-level documentation sync (Mode B). The 7 bug
  fixes change observable v1.2 behavior (checkpoint revert now works; explicit-paths now functional;
  dirty guard now comprehensive; caps-degradation now surfaced; checkpoint snapshots now survive
  reload) without adding config/API surface. The README's v1.2 section must reflect that reality so
  the bugfix release ships with accurate docs.
- **Most §5 prose is already correct** — it was written to the spec, and the bugs were implementation
  defects, so post-fix the spec-aligned description becomes true. The work is therefore a SURGICAL
  corrective pass, not a rewrite. Over-editing would risk introducing new inaccuracies and violate the
  "do NOT add new sections" constraint.
- **No code/config/test coupling.** README prose is not asserted by any test, so this item cannot
  regress `npm test`; it can only improve doc accuracy. Validation is a prose-accuracy cross-check +
  a diff-scope check.

## What

**User-visible behavior**: none — docs-only. No code, config, marker schema, tool param, or API-surface
change (the bug fixes added none; this item adds none).

**Technical change**: Markdown edits confined to README.md §5 "Working-tree revert (v1.2, opt-in)"
(roughly lines 202–260). The "Dirty-guard behavior" paragraph (line ~245) gets a precise rewrite; up to
three optional inline clarifications follow. VERIFICATION.md is grep-verified and left untouched.

### Success Criteria

- [ ] README "Dirty-guard behavior" states: the affected set is the snapshot diff (every workspace path
      differing between the pre-turn snapshot and the current tree — so it covers `write`/`edit` AND
      `bash` file mutations like `sed -i`/`python -c`/`perl -i`/heredocs/`awk -i inplace`); and that the
      guard runs only when the boundary has an after-snapshot (turn granularity) — a checkpoint
      captures once (no after-snapshot), so checkpoint-granularity revert skips the dirty guard and
      restores directly.
- [ ] README uses the correct rewind-marker field name (`refusedFiles`) where it names the dirty-guard
      refused paths (the success-text bucket COUNT is `refused`; the marker field is `refusedFiles`).
- [ ] README's checkpoint-granularity table row (✅ "Restore to the checkpoint-creation snapshot") is
      unchanged (it is now TRUE post-fix — no edit needed; the guard nuance lives in the dirty-guard
      paragraph).
- [ ] README's explicit-paths (`nonGitMode:"explicit-paths"`) description is verified consistent with
      the now-functional `tool_call` capture hook (write/edit paths captured; bash warned once per
      turn); edit ONLY if a wording nuance is inaccurate.
- [ ] (Optional) README notes that caps-exhausted files are surfaced in the result (the `skipped`
      bucket is now populated) — inline only, no table restructure.
- [ ] (Optional) README notes that checkpoint snapshots are rebuilt on session start so
      checkpoint-granularity `revert_file_changes` survives `/resume` — one inline sentence.
- [ ] No new section, no new table, no new "v1.2 resolved bugs" subsection added.
- [ ] VERIFICATION.md: a grep confirms ZERO v1.2 working-tree-revert content → NO edits made; the
      finding is documented (it is a v1.0 DoD report whose historical baselines are intentionally
      preserved).
- [ ] `git diff --name-only` shows at most `README.md`.
- [ ] `npm test` still green (unaffected by README edits).

## All Needed Context

### Context Completeness Check

_Passed._ A writer with zero prior knowledge of this repo can do this from: (a) the exact stale-claim
analysis in `research/stale_claim_analysis.md` (line numbers, current text, post-fix truth, source-of-
truth citations for every claim); (b) the README §5 prose in place (lines 202–260); (c) the behavioral
source-of-truth for each fix (`src/tools/rewind.ts` step 6b comment for the BUG-001 afterRef conditional
+ BUG-004 changedPaths; `src/markers.ts:83-100` for the marker schema; the 5 bug-fix PRP description
blocks for exact post-fix semantics). No inference required.

### Documentation & References

```yaml
# MUST READ — the item's own research (line-numbered stale-claim map + post-fix truth + scope decision)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M6T2S1/research/stale_claim_analysis.md
  why: the exact claims to fix (A: dirty-guard 245; B: explicit-paths 251; C: granularity table 228;
    D: caps/flags 218/256; E: /resume persistence) + the VERIFICATION.md no-edit finding + the "do not
    touch the two pre-existing resolved-bugs subsections" rule.
  critical: the PRIMARY edit is Claim A (dirty-guard paragraph). B/D/E are optional inline touches.
    VERIFICATION.md gets NO edit. The two README "Resolved bugs" subsections (331/340) are SEPARATE
    bug rounds — do NOT add a v1.2 one.

# MUST READ — the behavioral source-of-truth (the spec README §5 was written to)
- docfile: spec/14-working-tree-revert.md
  section: "§6 restore / refuse-on-dirty (step 3 — dirty guard CONDITIONAL on afterRef)"
  why: confirms the post-fix behavior is the SPEC behavior: the dirty guard is conditional on afterRef
    existing (checkpoints capture once → skip); the affected set is the snapshot diff (§6 step 2
    VERBATIM). README §5 aligning to this is aligning to the spec the bugs now satisfy.

# MUST READ — the bug-fix behavioral truth (read each description block, top ~20 lines)
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M1T1S1/PRP.md
  why: BUG-001 — checkpoint dirty guard runs ONLY when afterRef truthy; checkpoints skip it; the
    `?? beforeRef` fallback is removed. The exact post-fix checkpoint-revert semantics.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M4T2S1/PRP.md
  why: BUG-004 — affectedPaths = store.changedPaths(beforeRef) = EVERY path differing pre-turn→now
    (write/edit AND bash python/perl/heredoc). This is the "affected set" the dirty-guard paragraph must
    describe.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M3T1S1/PRP.md
  why: BUG-003 — tool_call hook feeds write/edit paths; bash warned once per turn. Confirms the
    explicit-paths description is now accurate (verify, likely no edit).
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M2T1S1/PRP.md
  why: BUG-002 — session_start rebuilds rt.snapshots from persisted mulligan:revert-checkpoint entries
    → checkpoint file-revert survives /resume. Source for the optional Claim E sentence.
- docfile: plan/008_c36fd26768ae/bugfix/001_83222ae5e11f/P1M5T1S1/PRP.md
  why: BUG-005 — RestoreResult.skipped now populated; surfaced in success text + marker.revert.skipped.
    Source for the optional Claim D clause.

# MUST READ — the marker schema (pins field names for precision)
- file: src/markers.ts
  section: "lines 83–100 (the rewind marker `revert` block) + 121–125 (RevertCheckpoint)"
  why: the marker's revert fields are revertedFiles/deletedFiles/failedFiles/refusedFiles/skipped(bool)/
    backend. RevertCheckpoint.afterRef is OPTIONAL (null until agent_end). Cites for the `refusedFiles`
    precision fix and the "checkpoint has no afterRef" nuance.

# READ-ONLY — confirms the dirty-guard wiring (the behavior the paragraph describes)
- file: src/tools/rewind.ts
  section: "step 6b comment (~L799-805) + the afterRef-conditional dirty guard"
  why: the in-code comment already states "CONDITIONAL on checkpoint.afterRef existing (spec/14 §6
    step 3) — skipped (restore proceeds) for checkpoint-granularity rewinds, which capture once and
    have no afterRef." Mirror this wording in the README paragraph.

# READ-ONLY — the target prose (verify line numbers haven't shifted before editing)
- file: README.md
  section: "§5 Working-tree revert (v1.2, opt-in) — Dirty-guard behavior (~L243-245), Non-git mode
    (~L247-254), Granularity scope (~L221-231), Per-call flags (~L214-219), Configuration (~L256-260)"
  why: the exact current text to edit. Re-grep the heading line numbers immediately before editing
    (the file is ~39KB; confirm §5 boundaries with `grep -n "^## 5\|^### \|Dirty-guard\|Non-git mode"`).

# VERIFY (no edit) — confirms VERIFICATION.md is a v1.0 report with no v1.2-revert content
- file: VERIFICATION.md
  section: "(entire file — it is a v1.0 DoD report; grep for v1.2-revert terms returns EMPTY)"
  why: run `grep -niE "working.tree|revert_file|delete_created|nonGitMode|explicit.paths|dirty.?guard|
    snapshot store|v1\.2" VERIFICATION.md` → expected EMPTY. Document the finding; make NO edit.
```

### Current Codebase tree (relevant slice)

```bash
README.md          # EDIT (§5 prose only, ~L202-260) — the dirty-guard paragraph is the primary edit
VERIFICATION.md    # VERIFY ONLY (grep) — v1.0 DoD report, zero v1.2-revert content, NO edit
src/tools/rewind.ts        # READ-ONLY — dirty-guard wiring (the behavior being documented)
src/markers.ts             # READ-ONLY — marker field names (refusedFiles, skipped bool, afterRef?)
src/snapshot/store.ts      # READ-ONLY — RestoreResult {reverted,deleted,failed,skipped,refused}
spec/14-working-tree-revert.md  # READ-ONLY — the spec README §5 aligns to (§6 step 2/3)
plan/.../P1M1T1S1/P1M2T1S1/P1M3T1S1/P1M4T2S1/P1M5T1S1/PRP.md  # READ-ONLY — post-fix behavior truth
```

### Desired Codebase tree with files to be changed

```bash
README.md          # MODIFIED — §5 dirty-guard paragraph rewrite + up to 3 optional inline touches
# (no new files; no code/config/test/spec/marker change; VERIFICATION.md untouched)
```

### Known Gotchas of our codebase & Library Quirks

```markdown
<!-- CRITICAL #1 — DO NOT add a "v1.2 resolved bugs" section. The README already has TWO "Resolved
     bugs" subsections (§8 h3.19 = v1.0 round; h3.20 = v1.1 round) covering the NUDGE/AUDIT/GUARD
     layers — NOT the v1.2 working-tree-revert bugs. The task explicitly forbids new sections. The
     corrective work lives ENTIRELY inside §5's existing feature descriptions. -->

<!-- CRITICAL #2 — the dirty-guard paragraph is the ONLY substantive edit. Resist rewriting the whole
     §5. Most §5 prose was written to the spec and is now accurate post-fix; over-editing risks new
     inaccuracies. Touch ONLY: (a) the dirty-guard paragraph (required); (b-d) optional one-liners. -->

<!-- CRITICAL #3 — VERIFICATION.md is a v1.0 DoD REPORT, not a living changelog. Its test-count
     baselines (671/956/974) are explicitly preserved as "accurate historical snapshots." It has ZERO
     v1.2-revert content (grep-confirmed). Do NOT inject v1.2 content into it — that muddles the
     historical record and violates "no new sections." Verify via grep; make NO edit. -->

<!-- GOTCHA #4 — re-verify line numbers immediately before editing. README.md is ~39KB and may have
     shifted since this PRP was written. Anchor edits on the PROSE CONTENT, not raw line numbers:
     grep for the heading "### Dirty-guard behavior" and the sentence starting "Before restore, a
     dirty check" to locate the exact block. -->

<!-- GOTCHA #5 — field-name precision. The rewind MARKER field for dirty-guard refusals is
     `refusedFiles` (src/markers.ts:97). `refused` (no suffix) is the success-text bucket COUNT in
     rewind.ts's RevertDetails. The README currently says "names the dirty paths (`refused`)" — tighten
     to the marker field. Do NOT invent new field names; copy them from markers.ts:83-100. -->

<!-- GOTCHA #6 — keep the tone/voice of §5. It is precise, spec-anchored, and uses bold for load-
     bearing terms. Match it. Do not add marketing language, emojis, or "now fixed!" framing — this is
     a factual corrective update, the §5 reads as-if-already-true. -->

<!-- GOTCHA #7 — no test asserts README prose. `npm test` cannot catch a prose error and cannot regress
     from a README edit. The validation is a MANUAL prose-accuracy cross-check (re-read the edited
     paragraph against rewind.ts step 6b + markers.ts + the PRP descriptions), NOT a green test bar. -->
```

## Implementation Blueprint

### Data models and structure

None. This is Markdown prose. No types, no code, no schema. The `RevertCheckpoint` (markers.ts:121) and
`RestoreResult` (store.ts) shapes are READ-ONLY references the prose describes; they are unchanged.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY scope anchors (read-only, do FIRST)
  - RUN: `grep -n "^## 5\|^### \|Dirty-guard\|Non-git mode\|Granularity\|Per-call flags\|^### Configuration" README.md`
    to re-confirm §5's heading line numbers (the PRP's ~L245 etc. are approximate).
  - RUN: `grep -niE "working.tree|revert_file|delete_created|nonGitMode|explicit.paths|dirty.?guard|snapshot store|v1\.2" VERIFICATION.md`
    → EXPECT EMPTY (confirms VERIFICATION.md has no v1.2-revert content to fix).
  - RUN: `sed -n '83,100p' src/markers.ts` → confirm the marker `revert` block field names
    (revertedFiles/deletedFiles/failedFiles/refusedFiles/skipped/backend) before citing them.
  - RUN: `grep -n "afterRef\|CONDITIONAL on checkpoint\|capture once" src/tools/rewind.ts | head` →
    confirm the BUG-001 afterRef-conditional wording to mirror.

Task 1: REWRITE the "Dirty-guard behavior" paragraph (README.md §5, the PRIMARY edit) — BUG-001 + BUG-004
  - LOCATE: the `### Dirty-guard behavior` heading + the paragraph starting "Before restore, a dirty
    check compares each affected file's current content to its after-snapshot state."
  - REPLACE it with prose that states BOTH post-fix accuracies, keeping the existing bold/voice:
      * (BUG-004 affected set) The "affected" set is the comprehensive snapshot diff — every workspace
        path that differs between the pre-span snapshot and the current tree — so it covers
        `write`/`edit` AND bash file mutations (`sed -i`, `awk -i inplace`, `cp`, `mv`, `rm`,
        `python -c`, `perl -i`, heredocs). Pre-fix the guard inspected only the write/edit ledger and
        missed bash-written files; post-fix the "never silently clobber a concurrent human edit"
        guarantee holds for every file-modifying tool. (Do NOT claim the ledger is gone — it still
        exists; the GUARD's affected set is now the snapshot diff.)
      * (BUG-001 checkpoint nuance) The guard runs only when the boundary has an after-snapshot — i.e.
        `last_turn` (the agent_end capture sets `afterRef`). A `checkpoint` captures ONCE and has no
        after-snapshot, so checkpoint-granularity revert skips the dirty guard and restores to the
        checkpoint snapshot directly. (This is why checkpoint file-revert is now functional.)
      * (precision) If any affected file drifted since the turn ended (a human/other-process edit),
        the whole file-revert is refused — not a silent clobber — and the context rewind still
        proceeds. The rewind result names the drifted paths in the marker's `refusedFiles` field.
  - KEEP: the existing rationale sentence ("clobbering an unsaved human edit is the one unrecoverable
    failure; refusing and letting the agent re-request is safe").
  - FOLLOW pattern: README §5's existing spec-anchored, bold-for-load-bearing-terms voice. Cross-link
    `spec/14-working-tree-revert.md §6` like the surrounding paragraphs do.
  - NAMING/PLACEMENT: same heading, same paragraph slot. Do NOT add a new subsection.
  - DEPENDENCIES: Task 0 (confirmed field names + line numbers).

Task 2: VERIFY explicit-paths prose (README.md §5 "Non-git mode", ~L251) — BUG-003 (edit only if off)
  - LOCATE: the `"explicit-paths"` bullet ("conservative: snapshots only the explicit write/edit tool
    paths. Bash file commands are not captured (the tool warns once per turn)").
  - CROSS-CHECK vs P1.M3.T1.S1: a `tool_call` hook now feeds every write/edit `event.input.path` into
    capture; bash in explicit-paths mode warns once per turn. The existing prose already matches this.
  - ACTION: if the wording is accurate, MAKE NO EDIT (leave a one-line note in the implementation
    summary that it was verified). If a nuance is off (e.g. "warns once per turn" vs the actual cadence
    in capture.ts), tighten it. Do NOT restructure the Non-git mode subsection.
  - DEPENDENCIES: Task 0.

Task 3 (OPTIONAL): caps/skipped surfacing — one inline clause (README.md §5 Per-call flags ~L218 and/or
  Configuration table ~L256) — BUG-005
  - ADD at most ONE clause (inline, do NOT restructure the table): files skipped at capture time
    because a cap was hit (`maxFileBytes`/`maxTotalBytes`/`maxSnapshotsPerTurn`) are surfaced in the
    rewind result — the success text notes "N skipped/failed" and the marker's `revert.skipped` flag is
    set — so the agent is told its file-revert was incomplete, not silently dropped.
  - PLACE: as a sentence appended to the `revert_file_changes` bullet's "Best-effort; failures are
    logged and never block the rewind." OR as a short clause in the Configuration table's
    `maxTotalBytes`/`maxSnapshotsPerTurn` "partial snapshot" note. Pick ONE spot; do not duplicate.
  - NAMING: use the marker field `skipped` (bool) and the RestoreResult bucket `skipped` (count).
  - DEPENDENCIES: Task 0. SKIP if it would bloat §5 — it is optional.

Task 4 (OPTIONAL): checkpoint /resume persistence — one inline sentence (README.md §5, Granularity or
  Dirty-guard area) — BUG-002
  - ADD at most ONE sentence (inline): checkpoint snapshots are rebuilt from the persisted
    `mulligan:revert-checkpoint` control entries on session start, so a checkpoint-granularity
    `revert_file_changes` rewind still finds its snapshot after `/resume` (the checkpoint survives
    reload, not just the in-memory session).
  - PLACE: at the end of the Granularity "checkpoint" row's Notes, OR appended to the Dirty-guard
    paragraph's checkpoint clause. Pick ONE spot; do not duplicate.
  - DEPENDENCIES: Task 0. SKIP if it would bloat §5 — it is optional.

Task 5 (VERIFY + DOCUMENT): VERIFICATION.md — NO edit
  - RUN the Task-0 grep on VERIFICATION.md → confirm EMPTY (no v1.2-revert content).
  - ACTION: make NO edit. Record the finding in the implementation summary / commit message ("VERIFICATION.md
    is a v1.0 DoD report with zero v1.2 working-tree-revert content; its historical test-count baselines
    are intentionally preserved; no stale v1.2 claims exist").
  - DEPENDENCIES: Task 0.

Task 6 (OUT OF SCOPE — do NOT do): NO edit to src/**, test/**, spec/**, package.json, tsconfig.json,
  .gitignore, or the two README "Resolved bugs" subsections (331/340). NO new README section/table. NO
  edit to VERIFICATION.md. NO mention of new config knobs or API surface (the bug fixes added none). If
  `git diff --name-only` shows anything beyond README.md, STOP and revert those hunks.
```

### Implementation Patterns & Key Details

```markdown
<!-- PATTERN — the dirty-guard paragraph rewrite (the ONE substantive edit). Keep §5's voice: precise,
     spec-anchored, bold for load-bearing terms, cross-link spec/14. Sketch (adapt phrasing to flow
     with the surrounding paragraphs; do NOT copy verbatim if it reads awkwardly): -->

### Dirty-guard behavior

Before restore, a dirty check compares each **affected** file's current content to its after-snapshot
state. The "affected" set is the comprehensive snapshot diff — every workspace path that differs
between the pre-span snapshot and the current tree — so it covers `write`/`edit` **and** bash file
mutations (`sed -i`, `awk -i inplace`, `cp`/`mv`/`rm`, `python -c`, `perl -i`, heredocs), not just the
write/edit tool calls. If **any** affected file drifted since the turn ended (a human/other-process
edit), the **whole file-revert is refused** — never a silent clobber — and the context rewind still
proceeds; the rewind result names the drifted paths in the marker's `refusedFiles` field.

The dirty guard is a **turn-level** guarantee: it needs the turn's after-snapshot (captured at
`agent_end`). A **checkpoint** captures once and has no after-snapshot, so checkpoint-granularity
revert skips the dirty guard and restores to the checkpoint snapshot directly. Rationale: clobbering an
unsaved human edit is the one unrecoverable failure; for turns the guard refuses and lets the agent
re-request, while checkpoints (whose entire purpose is wholesale rollback to a known point) restore
outright. See `spec/14` §6 step 3.

<!-- CRITICAL — this is a CORRECTIVE update, not a feature announcement. §5 already reads as-if-true;
     your edit makes the prose precisely match the now-shipped behavior. Do NOT add "fixed in v1.2.1" /
     "previously broken" / changelog framing — that belongs in release notes, not the feature doc. -->

<!-- CRITICAL — do NOT claim the file ledger was removed. extractFileLedger still exists (it backs the
     mutation warning + the note's auto-appended file list). ONLY the DIRTY GUARD's affected set changed
     from the ledger to the snapshot diff. Say "the guard's affected set", not "the ledger". -->
```

### Integration Points

```yaml
README.md:
  - edit: the "Dirty-guard behavior" paragraph in §5 (PRIMARY) — states snapshot-diff affected set +
    checkpoint-skips-guard + refusedFiles precision.
  - optional: up to 3 one-line inline touches (explicit-paths verify; caps/skipped; /resume persistence).
VERIFICATION.md:
  - verify: grep for v1.2-revert terms (expected EMPTY). NO edit.
CODE/CONFIG/TEST/SPEC/MARKER/API: UNCHANGED — no src/**, test/**, spec/**, package.json, or config edit.
  The bug fixes added no config knobs or API surface, so §5's Configuration table and tool-param docs
  need no new rows/fields.
PARALLEL ITEM (P1.M6.T1.S1): edits test/integration/revert-cas.test.ts ONLY — disjoint from README.md;
  safe to merge (zero file overlap).
```

## Validation Loop

> Markdown prose has no compiler or test suite. Validation here is (1) a diff-scope check, (2) a manual
> prose-accuracy cross-check, and (3) confirmation `npm test` is unaffected.

### Level 1: Scope check (run FIRST and LAST)

```bash
# Confirm ONLY README.md changed (VERIFICATION.md untouched; no code/test/spec/config edits).
git diff --name-only
# EXPECTED: README.md only. If VERIFICATION.md, src/**, test/**, spec/**, package.json, or tsconfig.json
#   appears → OUT OF SCOPE; revert those hunks.

# Confirm no NEW heading was added (the task forbids new sections).
git diff README.md | grep -E '^\+#{1,4} ' || echo "OK: no new Markdown headings added"
# EXPECTED: "OK: no new Markdown headings added" (or only a heading you intentionally did not add —
#   there should be NONE).
```

### Level 2: Prose-accuracy cross-check (manual — the REAL validation)

```bash
# Re-read the edited dirty-guard paragraph and verify each claim against its source-of-truth:
sed -n '/### Dirty-guard behavior/,/^### /p' README.md
#   CHECK 1 (BUG-004): does it say the affected set is the snapshot diff covering write/edit AND bash
#     (sed/python/perl/heredoc)? — cross-check src/tools/rewind.ts step 6b (changedPaths(beforeRef)).
#   CHECK 2 (BUG-001): does it say the guard is turn-level (needs after-snapshot) and checkpoints
#     skip it + restore directly? — cross-check rewind.ts step 6b comment + markers.ts:125 (afterRef?).
#   CHECK 3 (precision): does it name `refusedFiles` (NOT bare `refused`)? — cross-check markers.ts:97.

# Confirm the marker field names you cited are real (no invented names):
sed -n '83,100p' src/markers.ts
#   EXPECTED: revertedFiles/deletedFiles/failedFiles/refusedFiles/skipped/backend present.

# Confirm VERIFICATION.md still has no v1.2-revert content (you made no edit):
grep -ciE "working.tree|revert_file|delete_created|nonGitMode|explicit.paths|dirty.?guard|snapshot store|v1\.2" VERIFICATION.md
#   EXPECTED: 0.
```

### Level 3: Regression safety (confirm docs-only did not touch code)

```bash
# A README edit cannot change test outcomes, but run the suite to PROVE nothing else was touched.
npm test
# EXPECTED: green, identical pass count to before this item (the full v1.2 suite, 1277+ tests). If the
#   count changed, you accidentally edited a non-docs file — check `git diff --name-only`.

npm run typecheck
# EXPECTED: 0 errors (no src/ touched).
```

### Level 4: Whole-§5 readability pass (domain-specific)

```bash
# Render-read §5 end-to-end to ensure the edited paragraph still flows and the cross-links resolve.
sed -n '/^## 5\. Working-tree revert/,/^## 6\./p' README.md
#   CHECK: the dirty-guard paragraph flows from the Granularity table (checkpoint ✅) and into the
#     Non-git mode section; no broken `spec/14` cross-references; no duplicated/contradictory claims
#     (e.g. don't say checkpoints are guarded in one place and skip-guarded in another).
#   CHECK: the optional caps//resume touches (if added) are single inline sentences, not new blocks.
```

## Final Validation Checklist

### Technical Validation

- [ ] `git diff --name-only` shows at most `README.md` (VERIFICATION.md, src/**, test/**, spec/**,
      package.json all untouched).
- [ ] No new Markdown heading added (`git diff README.md | grep -E '^\+#{1,4} '` → empty).
- [ ] `npm test`: green, unchanged pass count (docs-only).
- [ ] `npm run typecheck`: 0 errors.

### Feature (Doc-Accuracy) Validation

- [ ] Dirty-guard paragraph states the affected set is the snapshot diff (write/edit + bash) [BUG-004].
- [ ] Dirty-guard paragraph states the guard is turn-level; checkpoints skip it + restore directly
      [BUG-001].
- [ ] Dirty-guard paragraph names `refusedFiles` (marker field), not bare `refused`.
- [ ] Explicit-paths prose verified consistent with the now-functional tool_call hook [BUG-003]
      (edited only if a nuance was off).
- [ ] (If added) caps/skipped surfacing clause is a single inline sentence [BUG-005].
- [ ] (If added) checkpoint /resume persistence is a single inline sentence [BUG-002].
- [ ] No new section/table; no "v1.2 resolved bugs" subsection; the two pre-existing resolved-bugs
      subsections (331/340) untouched.
- [ ] VERIFICATION.md: grep confirms zero v1.2-revert content; NO edit made; finding documented.

### Code Quality / Scope Validation

- [ ] The edit matches §5's existing voice (precise, spec-anchored, bold-for-load-bearing-terms).
- [ ] No changelog/"fixed in" framing injected into the feature doc.
- [ ] No claim that the file ledger was removed (only the guard's affected set changed).
- [ ] No new config knob or API-surface row added (the bug fixes added none).

### Documentation & Deployment

- [ ] §5 reads as a coherent, accurate description of shipped v1.2 behavior end-to-end.
- [ ] All `spec/14` cross-references in the edited region still resolve.

---

## Anti-Patterns to Avoid

- ❌ **Don't add a "v1.2 resolved bugs" section.** README already has two resolved-bugs subsections
  (§8) for the v1.0/v1.1 nudge/audit/guard rounds — NOT the v1.2 revert bugs. The task forbids new
  sections; corrective work stays inside §5's existing descriptions.
- ❌ **Don't rewrite all of §5.** It was written to the spec and is now mostly accurate post-fix.
  Over-editing risks new inaccuracies. The dirty-guard paragraph is the ONE substantive rewrite; the
  rest are optional one-liners or no-ops.
- ❌ **Don't edit VERIFICATION.md.** It's a v1.0 DoD report (grep-confirmed: zero v1.2-revert content).
  Its baselines are intentionally preserved history. Verify via grep; leave it alone.
- ❌ **Don't claim the file ledger was removed.** `extractFileLedger` still exists (mutation warning +
  note auto-append). Only the DIRTY GUARD's affected set changed (ledger → snapshot diff). Say "the
  guard's affected set", never "the ledger was removed".
- ❌ **Don't use changelog/release-note framing in the feature doc.** §5 reads as-if-already-true; this
  is a corrective accuracy pass, not a "what changed in v1.2.1" announcement. No "previously broken" /
  "now fixed" sentences.
- ❌ **Don't invent marker field names.** Copy them verbatim from `src/markers.ts:83-100`
  (revertedFiles/deletedFiles/failedFiles/refusedFiles/skipped/backend). `refusedFiles` is the marker
  field; `refused` is a success-text count — don't conflate.
- ❌ **Don't add new config rows or tool-param docs.** The 7 bug fixes added no config knobs or API
  surface; §5's Configuration table and `mulligan_rewind` param docs need no new entries.
- ❌ **Don't anchor edits on raw line numbers.** README.md is ~39KB and may shift. Locate the
  dirty-guard paragraph by its heading + opening sentence ("Before restore, a dirty check"), not by
  `:245`.
- ❌ **Don't touch src/, test/, spec/, package.json, or tsconfig.json.** If `git diff --name-only`
  shows anything beyond README.md, revert those hunks — this is docs-only.

---

## Confidence Score

**9/10** — This is a docs-only, single-file, surgical corrective pass where: (a) the stale-claim
analysis is complete and line-anchored (`research/stale_claim_analysis.md` maps every claim to its
current text + post-fix truth + source-of-truth citation); (b) the post-fix behavior is pinned by the 5
bug-fix PRP description blocks + `src/tools/rewind.ts` step 6b comment + `src/markers.ts:83-100` + the
spec (§6 step 2/3) the README was already written to; (c) the VERIFICATION.md no-edit finding is
grep-confirmed (zero v1.2-revert content); (d) the scope is tightly bounded (README §5 prose only; no
new sections; no code/config/test/spec/marker/API change). The one residual risk is judgment on the
three OPTIONAL touches (explicit-paths/caps//resume) — a writer could over-add and bloat §5; the
Anti-Patterns + the "single inline sentence, pick ONE spot, do not duplicate" rules bound that. No
upstream coordination needed (P1.M6.T1.S1 edits a disjoint test file; no README conflict). No test can
regress (docs-only).