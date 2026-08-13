---
name: "P1.M1.T2.S1 — Review + update README.md and spec/14 delete_created_files safety-guarantee wording for the defense-in-depth size guard"
description: >
  Mode B documentation-only subtask. After the BUG-001 hardening lands (P1.M1.T1.S1 GitBackend `stat`
  DI seam + maxFileBytes size guard in restore()'s delete step; P1.M1.T1.S2 CasBackend walkTree `st`
  param + size guard), BOTH backends spare a `delete_created_files` candidate whose CURRENT size exceeds
  `revert.maxFileBytes`, INDEPENDENT of the best-effort capture record (manifest.skipped / oversize git
  note). This closes the R1 note-write-failure data-loss window so deletion safety no longer SOLELY
  depends on a capture note/manifest that may not have been written. REVIEW whether the existing
  guarantee-#4 wording understates the safety, and if so, add a concise defense-in-depth clause to
  README.md §5 (Git-safety guarantee #4, line ~262) and align spec/14 §3 (guarantee #4 + the restore
  bullet) + §6 step 4 (restore semantics). Do NOT over-claim: the floor is specific to the DELETE path
  (a span-created file under maxFileBytes is still deleted). Conscious no-edit decisions (with rationale)
  for the README flag blurb (241), spec §4.3 (capture-focused), and spec §6 step 6 (invariant, unchanged).
  No code change. Runs LAST in the changeset (depends on S1 complete + S2 landing).
---

## Goal

**Feature Goal**: README.md and `spec/14-working-tree-revert.md` accurately reflect (or consciously omit,
with documented rationale) the defense-in-depth restore-time `maxFileBytes` size guard added by the
BUG-001 hardening. The headline change: `delete_created_files` guarantee #4 gains a concise clause noting
that a delete-candidate exceeding `maxFileBytes` is always spared — even if its capture record was lost —
so deletion safety never depends solely on the best-effort capture note/manifest.

**Deliverable** (documentation edits only — NO code change):
1. `README.md` §5 "Git-safety guarantee" #4 (line ~262) — add a defense-in-depth size-floor clause.
2. `README.md` §"Configuration" `revert.maxFileBytes` row (line ~294) — add a brief note on the knob's
   dual role (capture skip + restore-time safety floor).
3. `spec/14-working-tree-revert.md` §3 guarantee #4 (the five-guarantees list) — align to mention BOTH
   layers (spare Set from the capture record AND the restore-time size guard).
4. `spec/14-working-tree-revert.md` §3 restore bullet + §6 step 4 — note the sparing in the delete step.
5. Documented conscious NO-EDIT decisions (with rationale) for README flag blurb (241), spec §4.3, spec
   §6 step 6 — REVIEW happened; the existing wording remains accurate as scoped.

**Success Definition**:
- README guarantee #4 + spec §3 guarantee #4 state the two-layer safety: (i) capture-record spare
  (manifest.skipped / oversize note), AND (ii) defense-in-depth restore-time size floor (independent of
  the capture record).
- The wording does NOT over-claim: it scopes the floor to the `delete_created_files` DELETE path
  (a span-created file under `maxFileBytes` is still deleted); it never implies the revert path or "no
  large file is ever touched anywhere".
- The existing five guarantees are STRENGTHENED, not weakened or removed (additive edits only).
- `npm test` stays green (docs don't affect tests, but a green run rules out accidental file corruption).
- grep confirms: the new size-floor clause is present at guarantee #4; no unscoped "never touches large
  files" phrasing was introduced.

## User Persona (if applicable)

**Target User**: A developer / power user reading the README or spec to understand the safety properties
of the v1.2 working-tree-revert `delete_created_files` path before opting into the destructive mode
(`allowDeleteCreatedFiles: true`).

**Use Case**: Evaluating whether it is safe to enable `delete_created_files` — specifically, "can a
pre-existing large file (a vendored binary, `pnpm-lock.yaml`, a big `.env`) be lost if its capture record
wasn't written?"

**Pain Points Addressed**: BUG-001 — `delete_created_files` silently deleted pre-existing files exceeding
`maxFileBytes` (irreversible data loss) because the delete path conflated "absent from beforeRef"
(span-created) with "skipped at capture" (pre-existing oversize). The docs now reflect the fix that makes
this fail-safe regardless of capture-record health.

## Why

- **The guarantee as written now UNDERSTATES the safety.** README guarantee #4's parenthetical "(present
  now, absent from the before-snapshot)" is an incomplete characterization of the delete set post-hardening:
  the delete set is actually "present now, absent from before-snapshot, **AND not exceeding maxFileBytes**".
  Leaving the parenthetical as the full definition misleads a reader into thinking a lost capture record
  could still expose a large pre-existing file to deletion.
- **Deletion safety must not depend on a best-effort side channel** (the BUG-001 / R1 lesson). The docs
  should make explicit that the deterministic, local, independent size check is a second layer — so a user
  reading the guarantee understands WHY it holds even when the capture note/manifest is absent.
- **Consistency across README + spec.** The spec is the authoritative source; the README summarizes it.
  Aligning both keeps the two in sync (a stale README guarantee that omits the floor while the spec mentions
  it — or vice versa — is a doc-drift defect).
- **It is the Mode B doc sync that closes the changeset.** The implementing subtasks (S1/S2) deliberately
  left the README/spec untouched (their DOCS clauses say "none"); this task owns the user-facing wording.

## What

### Behavior / wording change

No code or runtime behavior changes. The edits describe the **post-hardening end state** (both backends
have the guard) so the docs are forward-accurate regardless of the exact S1/S2 landing order.

The accurate, scoped statement the docs will convey (memorize before editing — this is the non-over-
claiming phrasing the edits must match):

> A `delete_created_files` candidate whose **current** size exceeds `revert.maxFileBytes` is always
> **spared** in the DELETE path — even if its capture record was lost — so deletion safety never depends
> solely on the best-effort capture note/manifest (fail-safe: a leftover large file is recoverable; a
> deleted pre-existing one is not). This is a second layer, in addition to sparing files the capture
> record marked oversize/skipped.

### Success Criteria

- [ ] README §5 guarantee #4 includes a defense-in-depth size-floor clause scoped to the delete path.
- [ ] spec §3 guarantee #4 mentions BOTH layers (capture-record spare + restore-time size guard).
- [ ] spec §3 restore bullet + §6 step 4 note the sparing in the delete step.
- [ ] The `revert.maxFileBytes` config row notes the knob's dual role (capture skip + restore-time floor).
- [ ] No existing guarantee is weakened/removed; all edits are ADDITIVE.
- [ ] No over-claiming phrasing (the floor is scoped to the DELETE path; never generalized).
- [ ] Conscious no-edit decisions (README 241, spec §4.3, spec §6 step 6) are documented with rationale.
- [ ] `npm test` green (sanity — docs don't affect tests).

## All Needed Context

### Context Completeness Check

✅ "If someone knew nothing about this codebase, would they have everything needed?" YES. The exact
current text at every edit location (verified line-exact), the exact new text (oldText → newText in the
Implementation Tasks), the hardening semantics (the CONTRACT input from S1/S2), the "do not over-claim"
guardrail, and the conscious no-edit decisions with rationale are all below. No code reading is required
to implement this — it is pure documentation editing.

### Documentation & References

```yaml
# MUST READ — the hardening this doc task reflects (the INPUT/CONTRACT)
- file: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/P1M1T1S1/PRP.md
  why: "Defines the GitBackend guard semantics: restore() step (c) delete loop spares a candidate whose
        stat(abs).size > cfg.revert.maxFileBytes (continue + dedup push to result.skipped); a thrown
        stat falls through to unlink. Closes the R1 note-write-failure window. This is LAYER (ii) the
        docs describe."
  critical: "GitBackend pushes the spared path to result.skipped (visibility). CasBackend does NOT
             (bare return for the residual case). The user-facing guarantee describes BEHAVIOR ('spared'),
             NOT this backend-internal surfacing asymmetry — do not bake it into the wording."

- file: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/P1M1T1S2/PRP.md
  why: "Defines the CasBackend guard: walkTree delete callback accepts `st`; after `if (spare.has(rel))
        return;` adds `if (st.size > this.cfg.maxFileBytes) return;`. Belt-and-suspenders (CAS is immune
        to R1) but makes both backends share the same deterministic safety floor."
  critical: "Confirms BOTH backends now spare oversize delete-candidates — so the docs can describe a
             uniform end state. S2 is in-flight at PRP-authoring time; this PRP describes the post-S2
             end state so the docs are forward-accurate."

# MUST READ — the files being edited (read the exact regions first)
- file: README.md
  why: "EDIT 3 regions: §5 Git-safety guarantee #4 (~line 262), the delete_created_files flag blurb
        (~241, CONSCIOUS NO-EDIT), the revert.maxFileBytes config row (~294). The five-guarantees list
        is an ordered markdown list (1-5); keep item 4 as one entry (just longer)."
  pattern: "House style: bold lead-in (**`delete_created_files` only deletes...**), inline backticked
            code refs (`config.revert.allowDeleteCreatedFiles`, `revert.maxFileBytes`), parenthetical
            clarifications. Match it."
  gotcha: "The guarantee list is shared with guarantees #1-3 + #5. Touch ONLY item #4 (and the maxFileBytes
           row). Do not renumber or restructure the list."

- file: spec/14-working-tree-revert.md
  why: "EDIT 3 regions: §3 the restore() algorithm bullet (delete step), §3 guarantee #4 (five-guarantees
        list), §6 step 4 (restore semantics). CONSCIOUS NO-EDIT: §4.3 'Fail-closed large files' bullet +
        §6 step 6 (the 'never delete a file not provably created' invariant)."
  pattern: "Spec style: bold **guarantee name** lead-in, backticked refs (`beforeRef`,
            `config.revert.maxFileBytes`), cross-refs (§3, §6). Match it."
  gotcha: "§3 has TWO relevant spots — the restore() algorithm bullet (BEFORE the five-guarantees list)
           AND guarantee #4 (INSIDE the list). Edit both. §4.3's 'Fail-closed large files' is CAPTURE-focused
           and stays (the restore-time role now lives at §3 #4 + §6 step 4) — do NOT move/duplicate it."

# READ — the bug-hunt finding (the original BUG-001 + the data-loss mechanism this hardening fixes)
- file: plan/009_1ecb4b3cb372/bugfix/001_c5105b89490f/prd_snapshot.md
  why: "Issue 1 (BUG-001) documents the original mechanism: a pre-existing file > maxFileBytes is skipped
        at capture → absent from beforeRef → indistinguishable from a span creation at restore → unlinked.
        Cite this as the motivation in the guarantee clause if a brief rationale is wanted."
```

### Current Codebase tree (relevant slice)

```bash
README.md                          # ← EDIT: guarantee #4 (~262) + maxFileBytes row (~294); NO-EDIT flag blurb (241)
spec/14-working-tree-revert.md     # ← EDIT: §3 restore bullet + §3 guarantee #4 + §6 step 4; NO-EDIT §4.3 + §6 step 6
```
No source files touched. No tests touched.

### Desired Codebase tree

```bash
README.md                          # MODIFIED (2 additive wording edits — guarantee #4 + maxFileBytes row)
spec/14-working-tree-revert.md     # MODIFIED (3 additive wording edits — §3 restore bullet + §3 guarantee #4 + §6 step 4)
```
No new files. No code/config/API change.

### Known Gotchas of our codebase & Library Quirks

```markdown
# GOTCHA #1 — Do NOT over-claim. The accurate, scoped statement is: "a delete_created_files candidate
# whose CURRENT size exceeds maxFileBytes is spared IN THE DELETE PATH, regardless of whether it was
# captured." Do NOT generalize to "no large file is ever touched" — that would falsely imply the REVERT
# path (revert_file_changes) also spares oversize files, or that no oversize file is affected anywhere.
# The floor applies ONLY to the delete_created_files delete step. A genuinely span-created file UNDER
# maxFileBytes is still deleted (that's correct — it's small and span-created).

# GOTCHA #2 — Describe BEHAVIOR ("spared"), not the backend-internal surfacing asymmetry. GitBackend
# (S1) pushes the spared oversize path to result.skipped (so the rewind success text reports it); the
# CasBackend (S2) residual-case bare return does NOT. This asymmetry is a backend-internal implementation
# detail that T2 may reconcile — do NOT bake "surfaced in skipped" into the user-facing guarantee. The
# guarantee promises the file is SPARED (not deleted); how/whether it is reported is an internal concern.

# GOTCHA #3 — TWO layers, not one. The guarantee now rests on TWO independent spares: (i) the capture-
# record spare Set (files the manifest.skipped list / the oversize git note recorded — the FIRST defense,
# already landed in commit ec5ad32), AND (ii) the defense-in-depth restore-time size guard (independent of
# the capture record — the SECOND defense added by S1/S2). The docs must name BOTH so a reader understands
# WHY the guarantee holds even when the capture record is absent (layer ii is the deterministic fallback).

# GOTCHA #4 — The edits are ADDITIVE. Do NOT weaken, remove, or renumber any existing guarantee. The five
# guarantees list (README §5 / spec §3) stays 1-5; only item #4's prose grows. A reviewer diffing the
# change must see ONLY additions/clarifications, never a deletion of existing safety language.

# GOTCHA #5 — spec §3 has TWO edit spots, not one. The "Restore (`restore(beforeRef, opts)`...)" algorithm
# block has its OWN delete-step bullet ("If deleteCreatedFiles ...: delete work-tree files present now but
# absent from the beforeRef tree (span creations).") — SEPARATE from the five-guarantees list's item #4.
# Edit BOTH (the algorithm bullet gets a brief sparing note; guarantee #4 gets the two-layer note).

# GOTCHA #6 — Keep cross-references consistent. spec §3 guarantee #4 and §6 step 4 should cross-reference
# each other (e.g. "see §3 guarantee #4" / "see §6 step 4") so a reader landing in either spot finds the
# full picture. README guarantee #4 references spec/14 §3 (the README already cites "spec/14 §3" for the
# five guarantees — keep that citation).

# GOTCHA #7 — POSIX/markdown structure: the guarantee list is an ordered markdown list. Adding a clause to
# item #4 keeps it as ONE list item (the clause is a sentence within the item, possibly a bolded sub-lead-
# in like "**Defense-in-depth size floor:**"). Do NOT split item #4 into multiple list items (that would
# renumber guarantee #5 and break the "five guarantees" framing).

# GOTCHA #8 — The `revert.maxFileBytes` config row edit is MINOR and optional-ish. The row currently
# describes the CAPTURE role ("skip + warn (fail-closed)"). The knob now ALSO bounds the delete path. A
# brief clause connecting the two roles helps a config-table reader, but do NOT overload the row — one
# short clause + a cross-link to guarantee #4. If the row feels crowded, the cross-link alone suffices.
```

## Implementation Blueprint

### Data models and structure

None — documentation only. No types, interfaces, config, or code.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT README.md §5 Git-safety guarantee #4 (~line 262) — add the defense-in-depth size-floor clause
  - CURRENT (exact text):
      4. **`delete_created_files` only deletes files the span created** (present now, absent from the
      before-snapshot), behind the per-call flag **and** `config.revert.allowDeleteCreatedFiles`.
  - NEW (add the clause — keep item 4 as ONE list entry; bolded sub-lead-in; scoped to the delete path):
      4. **`delete_created_files` only deletes files the span created** (present now, absent from the
      before-snapshot), behind the per-call flag **and** `config.revert.allowDeleteCreatedFiles`.
      **Defense-in-depth size floor:** a delete-candidate whose current size exceeds `revert.maxFileBytes`
      is always spared — even if its capture record was lost — so deletion safety never depends solely on
      the best-effort capture note/manifest (a leftover large file is recoverable; a deleted pre-existing
      one is not).
  - WHY: the parenthetical now understates (the delete set is "…AND not exceeding maxFileBytes"). The
    clause makes the floor explicit and accurate without over-claiming (scoped to the delete path).
  - GOTCHA #1 (no over-claim), #2 (behavior not surfacing asymmetry), #4 (additive), #7 (one list item).

Task 2: EDIT README.md Configuration — `revert.maxFileBytes` row (~line 294) — note the dual role
  - CURRENT (exact table row):
      | `revert.maxFileBytes` | `262144` | Per-file cap (256 KB); skip + warn (fail-closed) — a huge
      gitignored data file is not silently captured. |
  - NEW (add a brief restore-time role clause + cross-link):
      | `revert.maxFileBytes` | `262144` | Per-file cap (256 KB); skip + warn at capture (fail-closed) —
      a huge gitignored data file is not silently captured. Also the restore-time safety floor that spares
      oversize files from `delete_created_files` (see Git-safety guarantee #4). |
  - WHY: the knob now has a capture role AND a restore-time role; a config-table reader benefits from the
    cross-link. Minimal — one clause + cross-link. GOTCHA #8 (don't overload; cross-link suffices).

Task 3: EDIT spec/14-working-tree-revert.md §3 guarantee #4 (five-guarantees list) — the two-layer note
  - CURRENT (exact text):
      4. **`delete_created_files` only deletes files the span created** (present now, absent from
      `beforeRef`), behind the per-call flag AND `config.revert.allowDeleteCreatedFiles`.
  - NEW (name BOTH layers — capture-record spare + defense-in-depth size guard; cross-ref §6 step 4):
      4. **`delete_created_files` only deletes files the span created** (present now, absent from
      `beforeRef`), behind the per-call flag AND `config.revert.allowDeleteCreatedFiles`. Two layers keep
      this true even when the capture record is incomplete: (i) files recorded as oversize/skipped at
      capture (the `manifest.skipped` list / the oversize shadow-repo note) are spared; (ii)
      **defense-in-depth** — a delete-candidate whose *current* size exceeds `config.revert.maxFileBytes`
      is always spared, independent of the capture record, so deletion safety never depends solely on a
      best-effort note/manifest that may not have been written (fail-safe: a leftover large file is
      recoverable, a deleted pre-existing one is not). See §6 step 4.
  - WHY: authoritative spec; the work-item LOGIC (c) mandates aligning guarantee #4 to mention both layers.
  - GOTCHA #3 (two layers), #6 (cross-ref §6 step 4).

Task 4: EDIT spec/14-working-tree-revert.md §3 restore() algorithm bullet — note the sparing in the delete step
  - CURRENT (exact text, inside the "Restore (`restore(beforeRef, opts)`...)" block):
      - If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree files present now but
      absent from the `beforeRef` tree (span creations).
  - NEW (add the sparing clause):
      - If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree files present now but
      absent from the `beforeRef` tree (span creations) — sparing (i) files recorded oversize/skipped at
      capture and (ii) any candidate whose current size exceeds `config.revert.maxFileBytes` (the
      defense-in-depth size floor, independent of the capture record; see guarantee #4).
  - WHY: the restore()-algorithm description should reflect the actual delete-step behavior.
  - GOTCHA #5 (§3 has TWO edit spots — this bullet AND guarantee #4).

Task 5: EDIT spec/14-working-tree-revert.md §6 step 4 (restore semantics) — note the sparing
  - CURRENT (exact text):
      4. **Restore:** for each affected path, write its `beforeRef` content (best-effort; failure →
      `failed[]`, not fatal). If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree
      files present now but absent from `beforeRef` (span creations).
  - NEW (add the sparing clause + cross-ref):
      4. **Restore:** for each affected path, write its `beforeRef` content (best-effort; failure →
      `failed[]`, not fatal). If `deleteCreatedFiles` (and `allowDeleteCreatedFiles`): delete work-tree
      files present now but absent from `beforeRef` (span creations) — but spare any candidate recorded
      oversize at capture OR whose current size exceeds `config.revert.maxFileBytes` (defense-in-depth;
      independent of the capture record — see §3 guarantee #4).
  - WHY: the restore-semantics algorithm step mirrors the §3 restore bullet; keep them consistent.
  - GOTCHA #6 (cross-ref §3 guarantee #4).

Task 6: CONSCIOUS NO-EDIT — README.md delete_created_files flag blurb (~line 241)
  - DECISION: leave unchanged. The flag blurb conveys the destructive INTENT + the two-gate CONSENT
    ("destructive ... requires both this flag AND the global config kill-switch") at the right level.
    The PRECISE delete-set definition (with the size floor) belongs at guarantee #4 (Task 1). Editing the
    consent blurb would over-load it and split the safety story across two places.
  - DOCUMENT: note this decision in the commit message ("README flag blurb (241) unchanged — consent-level
    description; the size floor lives at guarantee #4").

Task 7: CONSCIOUS NO-EDIT — spec/14 §4.3 "Fail-closed large files" bullet
  - DECISION: leave unchanged. §4.3's bullet is CAPTURE-focused (the maxFileBytes capture skip + warn).
    The restore-time role is now carried at §3 guarantee #4 (Task 3) + §6 step 4 (Task 5). Keeping §4.3
    capture-focused preserves the section's structure (it is under "Cross-cutting implementation
    requirements" for the CAPTURE/path/async behavior).
  - OPTIONAL (if the implementer prefers a cross-link): append to the §4.3 bullet: " At restore, the same
    cap is the defense-in-depth floor that spares oversize files from `delete_created_files` (§3 guarantee
    #4)." — but this is OPTIONAL; a clean no-edit is equally acceptable.
  - DOCUMENT: note the decision in the commit message.

Task 8: CONSCIOUS NO-EDIT — spec/14 §6 step 6 ("never delete a file not provably created during the span")
  - DECISION: leave unchanged. Step 6 states the INVARIANT; the size guard is one MECHANISM that enforces
    it. The invariant remains TRUE (the size guard only SHRINKS the delete set — it also spares oversize
    span files, so "never delete a file not provably created during the span" is still a valid lower bound).
    The mechanism detail lives at step 4 (Task 5) + guarantee #4 (Task 3); leaving step 6 avoids redundancy.
  - DOCUMENT: note the decision in the commit message.

Task 9: VALIDATE (no code)
  - RUN: `npm test` (full suite). MUST be green — docs don't affect tests, but a green run rules out
    accidental file corruption (e.g. a botched markdown edit that broke a test that reads README? none do,
    but the sanity run is cheap). PRIMARY gate = green.
  - RUN (grep): confirm the new clause is present + no over-claiming phrasing survived (see Validation Loop
    Level 4).
  - DIFF review: confirm edits are ADDITIVE (no existing guarantee weakened/removed; list still 1-5).
```

### Implementation Patterns & Key Details

```markdown
# THE ACCURATE NON-OVER-CLAIMING STATEMENT (every edit must match this scoping):
#   "A delete_created_files candidate whose CURRENT size exceeds revert.maxFileBytes is always SPARED
#    in the DELETE PATH — even if its capture record was lost — so deletion safety never depends solely
#    on the best-effort capture note/manifest (fail-safe: a leftover large file is recoverable; a
#    deleted pre-existing one is not)."
#
# WHY each qualifier exists (memorize before editing):
#   "candidate"              — it's a delete-candidate (in the delete_created_files path), not any file.
#   "CURRENT size"           — the size AT RESTORE time (stat/walkTree), not the size at capture. This is
#                              what makes it independent of the capture record (the capture record could
#                              be stale/absent; the current stat is deterministic).
#   "DELETE PATH"            — scoped to delete_created_files. The revert_file_changes path is NOT covered
#                              by this floor (and the docs must not imply it is). GOTCHA #1.
#   "even if its capture     — the whole point of defense-in-depth (R1): the capture note/manifest is
#    record was lost"         best-effort; if its write failed, the spare Set is empty — the size guard
#                              is the deterministic fallback. GOTCHA #3.
#   "spared" (not "surfaced  — describe BEHAVIOR, not the GitBackend-skipped vs CasBackend-bare-return
#    in skipped")             asymmetry (GOTCHA #2).
#
# THE TWO LAYERS (guarantee #4 in BOTH README + spec must name BOTH):
#   (i)  capture-record spare — files the manifest.skipped list / the oversize git note recorded at
#                               capture (the FIRST defense; landed in commit ec5ad32).
#   (ii) restore-time size guard — a candidate whose current size > maxFileBytes is spared regardless of
#                                  the capture record (the SECOND defense; added by S1/S2). INDEPENDENT
#                                  of layer (i) — that independence is the safety claim.
```

### Integration Points

```yaml
DOCUMENTATION (the ONLY files changed):
  README.md:
    - §5 Git-safety guarantee #4 (~262): + defense-in-depth size-floor clause (Task 1)
    - Configuration revert.maxFileBytes row (~294): + dual-role clause + cross-link (Task 2)
    - delete_created_files flag blurb (~241): UNCHANGED — conscious no-edit (Task 6)
  spec/14-working-tree-revert.md:
    - §3 restore() algorithm bullet: + sparing clause (Task 4)
    - §3 guarantee #4 (five-guarantees list): + two-layer note + cross-ref §6 (Task 3)
    - §6 step 4 (restore semantics): + sparing clause + cross-ref §3 (Task 5)
    - §4.3 "Fail-closed large files": UNCHANGED — conscious no-edit (Task 7)
    - §6 step 6 ("never delete ... not provably created"): UNCHANGED — conscious no-edit (Task 8)

NO CHANGES TO: any src/*.ts, any test/*, config, the rewind tool, any other doc file.
  - The implementing subtasks (S1/S2) own the CODE; this task owns the WORDING only.
  - The commit message records the 3 conscious no-edit decisions (Tasks 6/7/8) with rationale.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# This is a TypeScript + vitest project, but this task touches ONLY .md files. There is no markdown
# linter configured (no markdownlint / remark / biome in package.json). The "syntax" check is a visual
# diff review: confirm no broken markdown (unclosed bold **, broken table cell, list renumbering).
git diff README.md spec/14-working-tree-revert.md
# Expected: additive hunks only. Watch points: (1) the guarantee-#4 list item stays ONE entry (did not
# split into two list items — that would renumber #5); (2) the maxFileBytes table row still has 3 cells
# (| knob | default | description |) — the added clause is inside the 3rd cell, not a new column;
# (3) no stray unclosed backticks (`) or bold (**) introduced.
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A — no code change. (Docs are not unit-tested.) Skip to Level 4. (Level 3's `npm test` is the sanity
# gate that no file was corrupted.)
```

### Level 3: Integration Testing (System Validation)

```bash
# Sanity run — docs don't affect tests, but a green full suite rules out accidental file corruption
# (e.g. a botched edit that happened to touch a path a test reads — none do, but the run is cheap):
npm test                 # = vitest run (all files)
# Expected: ALL green (identical to the pre-edit baseline; 1394+ tests). If ANY test fails, it is NOT
# caused by a .md edit (tests don't read these docs) — investigate separately (likely a pre-existing
# flake or an in-flight S2 code change, not this doc task).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# (a) Confirm the new size-floor clause is present at guarantee #4 in BOTH README + spec:
grep -n "Defense-in-depth size floor\|defense-in-depth" README.md spec/14-working-tree-revert.md
# Expected: matches in README §5 guarantee #4 AND spec §3 guarantee #4 (and the §3 restore bullet / §6
# step 4 sparing clauses). If zero matches → the edits didn't land.

# (b) Confirm NO over-claiming phrasing was introduced (the floor must be scoped to the DELETE path):
grep -nEi "never (touches|deletes|unlinks).*large|no large file.*(touched|deleted|unlinked)" README.md spec/14-working-tree-revert.md
# Expected: ZERO matches. An unscoped "never touches large files" would over-claim (it would imply the
# revert path also spares oversize files). The accurate scoping is "spared in the delete path".

# (c) Confirm the two layers are BOTH named in spec §3 guarantee #4 (capture-record spare AND size guard):
grep -n "manifest.skipped\|oversize shadow-repo note\|defense-in-depth" spec/14-working-tree-revert.md
# Expected: spec §3 guarantee #4 mentions BOTH (i) the capture-record spare (manifest.skipped / oversize
# note) AND (ii) the defense-in-depth size guard. If only one layer is named, the guarantee understates.

# (d) Confirm the edits are ADDITIVE — no existing guarantee was weakened/removed:
git diff README.md spec/14-working-tree-revert.md | grep -E "^-" | grep -v "^---"
# Expected: ZERO removed-content lines (all hunks are additions / in-place clarifications). A "-"
# hunk removing existing safety language is a regression — revert it (GOTCHA #4).

# (e) Confirm the five-guarantees list is still 1-5 (item #4 was not split into two items):
grep -nE "^[0-9]\. \*\*" README.md | head -10
# Expected: guarantees 1-5, each one line-item; item 4 is still a single (now longer) entry. If #5
# became #6, item #4 was accidentally split (GOTCHA #7).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm test` green (sanity — no file corruption; identical to pre-edit baseline).
- [ ] grep (a): the defense-in-depth clause is present at README + spec guarantee #4.
- [ ] grep (b): ZERO over-claiming phrasing (no unscoped "never touches large files").
- [ ] grep (c): spec §3 guarantee #4 names BOTH layers (capture-record spare + size guard).
- [ ] grep (d): diff is ADDITIVE (zero removed-content lines — no guarantee weakened/removed).
- [ ] grep (e): the five-guarantees list is still 1-5 (item #4 not split).

### Feature Validation

- [ ] README §5 guarantee #4 has the defense-in-depth size-floor clause (scoped to the delete path).
- [ ] spec §3 guarantee #4 names both layers + cross-refs §6 step 4.
- [ ] spec §3 restore bullet + §6 step 4 note the sparing in the delete step (+ cross-ref §3 #4).
- [ ] The `revert.maxFileBytes` config row notes the dual role (capture skip + restore-time floor).
- [ ] The wording matches the accurate non-over-claiming statement (scoped to the DELETE path; "CURRENT
      size"; "even if its capture record was lost"; "spared" not "surfaced in skipped").
- [ ] The 3 conscious no-edit decisions (README 241, spec §4.3, spec §6 step 6) are documented with
      rationale (in the PRP + the commit message).

### Code Quality Validation

- [ ] House style preserved (bold lead-ins, backticked refs, parenthetical clarifications).
- [ ] No markdown breakage (table cells intact, no unclosed bold/backticks, list not renumbered).
- [ ] Edits are additive (GOTCHA #4); existing safety language untouched.

### Documentation & Deployment

- [ ] README + spec are mutually consistent (both describe the two-layer floor; cross-refs resolve).
- [ ] No user-facing/config/API/runtime change (Mode B docs only — nothing to deploy).
- [ ] Commit message records the review outcome (edits made) + the 3 conscious no-edit decisions + rationale.

---

## Anti-Patterns to Avoid

- ❌ Don't over-claim — never write "no large file is ever touched/deleted" unscoped. The floor is SPECIFIC
  to the `delete_created_files` DELETE path. The revert path (`revert_file_changes`) is not covered, and a
  span-created file UNDER maxFileBytes IS still deleted (GOTCHA #1).
- ❌ Don't bake the GitBackend-vs-CasBackend surfacing asymmetry into the user-facing guarantee. Describe
  BEHAVIOR ("spared"), not "surfaced in result.skipped" (GitBackend pushes; CasBackend's residual bare
  return does not — an internal detail T2 may reconcile) (GOTCHA #2).
- ❌ Don't name only ONE layer. Guarantee #4 must mention BOTH (i) the capture-record spare AND (ii) the
  defense-in-depth size guard — the independence of (ii) from (i) is the whole safety claim (GOTCHA #3).
- ❌ Don't weaken/remove any existing guarantee — edits are ADDITIVE only. A diff that deletes existing
  safety language is a regression (GOTCHA #4).
- ❌ Don't split guarantee #4 into multiple list items (that renumbers #5 and breaks the "five guarantees"
  framing) — keep it ONE list entry with an appended clause (GOTCHA #7).
- ❌ Don't edit the code (src/*.ts) or tests — this is Mode B documentation only. The implementing subtasks
  (S1/S2) own the code; this task owns the wording.
- ❌ Don't duplicate the restore-time note into §4.3 — §4.3 is capture-focused; the restore-time role lives
  at §3 guarantee #4 + §6 step 4 (Task 7 conscious no-edit).
- ❌ Don't skip the REVIEW and make a blind edit. The work item requires a deliberate decision per location
  (edit vs conscious no-edit), documented with rationale — even where the decision is "no change" (Tasks 6-8).
- ❌ Don't describe the floor as depending on the capture record. The POINT is independence — "even if its
  capture record was lost" must appear (else the guarantee understates the R1 fix).

---

## Confidence Score: 9/10

**Why 9**: This is a small, well-scoped Mode B documentation task. The exact current text at every edit
location is verified line-exact (README §5 guarantee #4, the flag blurb, the maxFileBytes row; spec §3
restore bullet, §3 guarantee #4, §4.3, §6 step 4, §6 step 6). The exact new text is drafted verbatim
(oldText → newText in the Implementation Tasks). The hardening semantics (the CONTRACT input) are read
from the S1/S2 PRPs — the two-layer model and the "do not over-claim" scoping are pinned. The conscious
no-edit decisions have explicit rationale. The grep-based validation proves the edits landed correctly and
introduced no over-claiming.

**The −1 (residual risk)**: the one judgment call is whether to cross-link the `revert.maxFileBytes` config
row (Task 2) and §4.3 (Task 7 optional). Both are explicitly framed as minor/optional with the exact
wording provided and a clean no-edit alternative — so either choice satisfies the work item. The
substantive edit (guarantee #4 two-layer clause) is fully pinned. A careless implementer could over-claim
(writing "never touches large files" unscoped) — GOTCHA #1 + grep (b) catch that; or could split the list
item — GOTCHA #7 + grep (e) catch that. Both failure modes are guarded.

---