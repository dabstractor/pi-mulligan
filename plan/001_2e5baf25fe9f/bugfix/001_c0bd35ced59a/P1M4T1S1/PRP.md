# PRP — P1.M4.T1.S1: Update spec/06 idempotency + resolver descriptions + spec/04 hideEntryIds field + JSDoc sweep

**Work item:** P1.M4.T1.S1 · **Points:** 1 · **Bugfix 001:** the FINAL documentation-sync task of the P1
rewind-permanence bugfix. The source code (M1 checkpoint fix + M2 pinning mechanism) is **LANDED and complete**;
this task makes the specification documents accurately describe the shipped pinning mechanism, the corrected
within-turn idempotency model, and the `hideEntryIds` field, and verifies the JSDoc on all 6 modified functions.
**Scope:** **MODIFY at most 3 files** — `spec/06-context-filter.md` (§3/§4/§6/§11/§12), `spec/04-data-model.md`
(§3 RewindMarker), and (only if a discrepancy is found) the JSDoc of one or more of the 6 modified functions in
`src/transforms.ts` / `src/markers.ts` / `src/tools/rewind.ts`. **No new files. No code-behavior change. No new
deps. No config/API change. Documentation-only.**

> **PARALLEL-COORDINATION:** P1.M3.T2.S1 (parallel) modifies `test/integration/smoke.ts` + `run-smoke.mjs` ONLY
> (test assertions). It does NOT touch `spec/` or `src/`. My task is fully independent (different files) → no
> collision. **CONTRACT INPUT:** "All modified source files from M1 and M2" are LANDED — I document what shipped,
> I do not change behavior. The previous PRP (P1.M3.T2.S1) produces test-only output I neither consume nor conflict with.

---

## Goal

**Feature Goal**: Sync the changeset-level documentation to accurately describe the pinning mechanism that the
M1+M2 source already implements, so that `spec/06-context-filter.md` and `spec/04-data-model.md` contain **no
stale claims** about the rewind resolution model or idempotency, and the JSDoc on all 6 modified functions is
verified accurate. Concretely: (a) **spec/06 §11** — replace the FALSE claim "across fires the session is
unchanged between user prompts" with the accurate within-turn-pinning model (the root cause of BUG-001/BUG-002);
(b) **spec/06 §3/§4/§6** — add a note that new markers capture `hideEntryIds` at creation time and
`filterPipeline` resolves via `resolvePinnedHide`, with the relative resolvers retained as a backward-compat
fallback; (c) **spec/06 §12** — update the `filterPipeline` pseudocode to show the pinned-first `hideEntryIds`
dispatch; (d) **spec/04 §3** — document the `hideEntryIds` field on `RewindMarker`; (e) **JSDoc sweep** — verify
the 6 modified functions (`resolveCheckpoint`, `setCheckpoint`, `resolvePinnedHide`, `filterPipeline`,
`resolvePreview`, `captureHideEntryIds`) have accurate JSDoc, correcting only if a discrepancy is found.

**Deliverable** (MODIFY existing files; documentation-only):
1. `spec/06-context-filter.md` — §3, §4, §6 each gain a short "pinning note"; §11 idempotency paragraph corrected;
   §12 pseudocode gains the pinned-first dispatch branch (and aligned `resolveCheckpoint` signature).
2. `spec/04-data-model.md` — §3 `RewindMarker` interface gains the `hideEntryIds?: string[]` field + doc comment.
3. `src/transforms.ts` / `src/markers.ts` / `src/tools/rewind.ts` — **only if** the JSDoc sweep finds an
   inaccuracy: correct the JSDoc of the affected function. (As-verified all 6 are already accurate → expected
   no-op; the sweep is confirmatory.)

**Success Definition** (all must hold):
- `grep -ni "unchanged between user prompts" spec/06-context-filter.md` → **NO matches** (the false claim is gone).
- `grep -ni "hideEntryIds" spec/04-data-model.md spec/06-context-filter.md` → matches present in **both** files
  (the field is documented + the dispatch is in the pseudocode).
- spec/06 §3, §4, §6 each contain a note naming `captureHideEntryIds` / `resolvePinnedHide` / `hideEntryIds` and
  the backward-compat-fallback framing.
- spec/06 §11 states the within-turn instability + the pinning remedy (no claim that the session is static across
  fires).
- spec/06 §12 pseudocode's rewind loop dispatches on a non-empty `hideEntryIds` FIRST, then the granularity branches.
- The 6 modified functions' JSDoc is confirmed accurate against the shipped behavior (or corrected if not).
- `npx tsc --noEmit -p tsconfig.json` exits **0**; `npx vitest run` stays **green** (docs can't break tests;
  baseline 18 files / 706–711 tests).
- No stale claim about the rewind resolution model or idempotency remains in either spec (verified by grep).

---

## User Persona

**Target User**: Future maintainers + the implementing agent of any follow-on work who read the specs as the
authoritative description of Mulligan's behavior. The 3 critical bugs (BUG-001/002/003) shipped partly BECAUSE
spec/06 §11's idempotency assumption ("the session is unchanged between user prompts") was false and went
unquestioned (PRD §h2.5 "Re-examine spec/06 §11's idempotency assumption"). Accurate docs are the guard against
re-introducing the relative-re-resolution model.

**Use Case**: A maintainer reads spec/06 §11 to reason about whether a new filter change is idempotent. With the
corrected model they understand that within a turn the session grows between fires, so hiding MUST be pinned at
creation time — they will not "simplify" the pinning back into relative re-resolution.

**Pain Points Addressed**: Today the specs describe a resolution model (relative, re-resolved each fire) that the
shipped code NO LONGER uses for new markers, and assert an idempotency property that is false within a turn. A
reader trusting the docs would re-introduce the bugs. This task aligns docs with the shipped, correct behavior.

---

## Why

- **Closes the PRD §h2.5 recommendation directly** — "Re-examine spec/06 §11's idempotency assumption ('across
  fires the session is unchanged between user prompts') — it does not hold within a turn after a tool call, which
  is the root of BUG-001 and BUG-002." This task re-examines and corrects it.
- **Makes the pinning mechanism discoverable.** The `hideEntryIds` field, `captureHideEntryIds`, and
  `resolvePinnedHide` are the core of the BUG-001/002 fix, but are absent from the data-model spec (spec/04 §3)
  and the algorithm spec (spec/06). A maintainer inspecting `RewindMarker` via `/tree` or reading spec/06 has no
  documented explanation of why hiding is permanent.
- **Prevents regression by documentation.** spec/06 §3/§4/§6 + §12 currently describe ONLY the relative resolvers
  as the resolution path. Without the pinning note + the pinned-first pseudocode branch, a future implementer
  could "optimize" `filterPipeline` back to relative-only resolution and re-introduce BUG-001/002. Documenting the
  backward-compat-fallback framing preserves the invariant ("a refused pinned hide MUST NOT fall back to relative
  resolution").
- **Low risk, high value.** Pure documentation; no behavioral change; no test impact. The only failure mode is an
  inaccurate edit, caught by the grep gates + tsc/vitest.

---

## What

MODIFY `spec/06-context-filter.md` (5 edits), `spec/04-data-model.md` (1 edit), and conditionally the JSDoc of up
to 6 functions (verify-then-correct-if-needed). Summary of the documentation changes:

- **spec/06 §11** — Replace "across fires the session is unchanged between user prompts" with an accurate
  statement: within a turn, tool calls append entries between context fires, so relative specs are unstable; new
  markers pin stable entry IDs at creation time (`hideEntryIds`) to ensure permanent hiding across session growth.
- **spec/06 §3** (`resolveLastToolCallGroup`) — Append a note: this relative resolver is the **backward-compat
  fallback**; new markers capture `hideEntryIds` at creation time and `filterPipeline` resolves via
  `resolvePinnedHide` (permanent hiding). This resolver runs only for old markers / capture failures.
- **spec/06 §4** (`resolveLastTurn`) — Same pinning note as §3.
- **spec/06 §6** (Checkpoint) — Same pinning note (checkpoint rewinds also pin via `captureHideEntryIds`;
  `resolveCheckpoint` remains the checkpoint-granularity producer + legacy fallback; `resolvePinnedHide`
  generalizes its entry→message walk). Also align the function signature in the §6 code block to the real
  `(messages, branchEntries, checkpointName, excludeToolCallId)` (the current `resolveCheckpoint(messages, ctx,
  checkpointName)` signature is stale vs the M1 fix).
- **spec/06 §12** (`filterPipeline` pseudocode) — Add the pinned-first dispatch: `if (Array.isArray(rw.hideEntryIds)
  && rw.hideEntryIds.length > 0) remove = resolvePinnedHide(m, branchEntries, rw.hideEntryIds)` BEFORE the
  granularity `if/else` chain. Add a `branchEntries` parameter + a comment that `partitionIntoUnits` is re-run per
  rewind in the real code. Align `resolveCheckpoint` to the real signature.
- **spec/04 §3** (`RewindMarker`) — Add `hideEntryIds?: string[]` field with a doc comment (stable entry IDs pinned
  at creation; optional for backward compat; absent → relative fallback).
- **JSDoc sweep (e)** — Verify each of the 6 functions' JSDoc against shipped behavior; correct ONLY if inaccurate.

This subtask does **NOT**: change any source-code behavior (M1+M2 are LANDED); edit tests (P1.M3 owns those);
touch spec/06 §5 (shrinks intentionally re-resolve each fire — NOT affected by BUG-001/002; touching it is a
regression); touch any other spec file (spec/05 tools, spec/08 edge cases, etc. — out of scope); or rewrite the
specs wholesale (surgical edits only).

### Success Criteria

- [ ] `spec/06-context-filter.md` §11 no longer claims the session is unchanged across fires; states the
      within-turn instability + the pinning remedy.
- [ ] `spec/06-context-filter.md` §3, §4, §6 each have a pinning note naming `hideEntryIds` /
      `captureHideEntryIds` / `resolvePinnedHide` and the backward-compat-fallback framing.
- [ ] `spec/06-context-filter.md` §12 pseudocode dispatches on non-empty `hideEntryIds` FIRST; `resolveCheckpoint`
      uses the real `(messages, branchEntries, checkpointName, excludeToolCallId)` signature.
- [ ] `spec/04-data-model.md` §3 `RewindMarker` has a documented `hideEntryIds?: string[]` field.
- [ ] All 6 modified functions have verified-accurate JSDoc (or corrected where found inaccurate).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0; `npx vitest run` stays green.
- [ ] `grep -ni "unchanged between user prompts" spec/06` → no matches; `grep -ni "hideEntryIds" spec/04 spec/06`
      → matches in both.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** Every edit is given as an exact anchor (current text → replacement text) below, traced
> against the shipped code (src/transforms.ts, src/markers.ts, src/tools/rewind.ts) which was read in full. The
> stale claims were located by grep (the complete set is listed in research/notes.md §2). The "do NOT touch" list
> (shrinks §5, §1 composition) is explicit. The JSDoc-sweep is a verification table (each function's
> location + accuracy criterion) — expected no-op, not a writing exercise. The validation gates (tsc + vitest +
  grep) are verified. No prior knowledge beyond "edit these spec files surgically; verify 6 JSDocs" is required.

### Scope decision (READ BEFORE CODING)

- **MODIFY `spec/06-context-filter.md` + `spec/04-data-model.md` — both ALREADY EXIST.** Do NOT create new files.
- **Do NOT change source-code behavior.** M1+M2 are LANDED. The ONLY permissible `src/` edit is a JSDoc comment
  correction IF the sweep finds an inaccuracy. Do NOT refactor, rename, or "improve" any function.
- **Do NOT touch spec/06 §5** (`applyShrink`). Its "Matchers resolve against the current `messages` each fire"
  (line 121) is CORRECT — shrinks are content substitution, intentionally re-resolved, and are NOT affected by
  BUG-001/002. Pinning applies ONLY to rewind hiding. Editing §5's re-resolution language would be a correctness
  regression.
- **Surgical edits only.** Each edit targets a specific sentence/code-block. Do not rewrite whole sections. The
  pinning notes are short (3–6 lines each) and appended to the END of §3/§4/§6 so the existing relative-resolver
  descriptions stay valid (they remain the backward-compat fallback).
- **Spec code fences are illustrative, not compiled.** Keep the §12 pseudocode accurate + internally consistent
  with the real `filterPipeline`, but it is in a ```ts fence — `tsc` does NOT type-check it. The tsc gate only
  catches accidental corruption of real `src/` files.
- **JSDoc sweep = verify, do not invent.** All 6 functions already have detailed, accurate JSDoc (verified in
  research/notes.md §3). The sweep confirms each; correction happens ONLY where a real discrepancy is found.
  Spending time rewriting accurate JSDoc is scope creep.

### Documentation & References

```yaml
# MUST READ — authoritative sources (the shipped behavior the docs must match)
- file: src/transforms.ts
  section: "resolveCheckpoint (~454) + resolvePinnedHide (~625) + filterPipeline dispatch (~1146-1166)"
  why: "THE source of truth for what the spec must describe. resolvePinnedHide maps pinned entry ids → message
        indices by identity every fire (permanent hiding). filterPipeline dispatches PINNED FIRST
        (hideEntryIds non-empty → resolvePinnedHide), then granularity LEGACY branches (the backward-compat
        fallback). resolveCheckpoint takes (messages, branchEntries, checkpointName, excludeToolCallId) and
        unit-snaps iTarget. branchEntries is getBranch() ROOT→LEAF (no reverse)."
  critical: "The dispatch is the load-bearing fact: a refused pinned hide returns [] and does NOT fall back to
        relative resolution (control-flow-enforced — else the bug returns). The §12 pseudocode MUST show this."

- file: src/markers.ts
  section: "RewindMarker.hideEntryIds (~68-74) + setCheckpoint (~345)"
  why: "hideEntryIds is OPTIONAL (backward compat); holds ENTRY ids (stable UUIDs), NOT message indices.
        setCheckpoint walks getBranch() backwards to the last real message entry (BUG-003 fix). spec/04 §3 must
        document hideEntryIds; spec/06 §6 must reflect the setCheckpoint anchor selection."

- file: src/tools/rewind.ts
  section: "captureHideEntryIds (~282) + resolvePreview (~315)"
  why: "captureHideEntryIds runs ONCE at creation time (inside resolvePreview) to map the resolved message-index
        removal set → stable ENTRY ids. Pins WHOLE units (pairing-safe). spec/06 §3/§4/§6 notes must name it."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/architecture/fix_design.md
  why: "The design doc for the fix: §Change 2 (captureHideEntryIds), §Change 3 (resolvePinnedHide), §Change 4
        (filterPipeline pinned-first dispatch). The spec language should mirror its framing."

- file: plan/001_2e5baf25fe9f/bugfix/001_c0bd35ced59a/P1M4T1S1/research/notes.md
  why: "THE complete stale-claim inventory (§2) + the JSDoc accuracy table (§3) + scope boundaries (§4). Read it
        before editing — it lists every exact line to change AND every line to leave alone (shrinks §5, §1)."

# FILES TO MODIFY (read each in full first; edits are surgical)
- file: spec/06-context-filter.md
  why: "The file you MODIFY (§3/§4/§6/§11/§12). Read §11 (line 232 — the false claim), §3 (ends ~95), §4 (ends
        ~118), §6 (ends ~165 + the stale resolveCheckpoint signature at line 154), §12 (pseudocode 236-266)."

- file: spec/04-data-model.md
  why: "The file you MODIFY (§3 RewindMarker, lines 109-140). Read the interface; the new hideEntryIds field goes
        after excludeToolCallId (line 125) and before seq (line 128)."

# FILES TO VERIFY (JSDoc sweep — correct only if inaccurate)
- file: src/transforms.ts        # resolveCheckpoint@454, resolvePinnedHide@625, filterPipeline@1115
- file: src/markers.ts           # setCheckpoint@345
- file: src/tools/rewind.ts      # captureHideEntryIds@282, resolvePreview@315
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── spec/
│   ├── 04-data-model.md          # MODIFY: §3 RewindMarker += hideEntryIds field.
│   ├── 06-context-filter.md      # MODIFY: §3/§4/§6 += pinning notes; §11 idempotency corrected; §12 pseudocode += pinned dispatch.
│   └── (01,02,03,05,07-12)       # READ-ONLY (out of scope).
├── src/                          # READ-ONLY behavior; JSDoc VERIFY-then-correct-if-needed ONLY.
│   ├── transforms.ts             # resolveCheckpoint@454, resolvePinnedHide@625, filterPipeline@1115 (all JSDoc-accurate as-shipped).
│   ├── markers.ts                # setCheckpoint@345, RewindMarker.hideEntryIds@74 (JSDoc-accurate).
│   └── tools/rewind.ts           # captureHideEntryIds@282, resolvePreview@315 (JSDoc-accurate).
└── test/                         # READ-ONLY (P1.M3 owns tests; P1.M3.T2.S1 parallel = test/integration only).
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 18 files / 706-711 green.
# The specs are plain markdown (NOT compiled); the §12 pseudocode is in a ```ts fence (illustrative).
```

### Desired Codebase tree with files to be MODIFIED (THIS subtask)

```bash
pi-mulligan/
├── spec/
│   ├── 04-data-model.md          # +1 field (hideEntryIds?: string[] + doc comment) in §3 RewindMarker. ~6 lines.
│   └── 06-context-filter.md      # §3/§4/§6 each +1 pinning note (~5 lines); §11 corrected (~4 lines replaced);
│                                 #   §12 pseudocode +pinned-first branch + aligned signatures (~10 lines). ~30 lines total.
└── src/ (transforms.ts | markers.ts | tools/rewind.ts)
    # CONDITIONAL: JSDoc correction ONLY where the sweep finds an inaccuracy. Expected: NO src/ edits.
# No new files. No behavior change. No new deps. No config/API change. Documentation-only.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — Do NOT touch spec/06 §5 (applyShrink, line 121). Its "Matchers resolve against the
#   current messages each fire" is CORRECT: shrinks are content substitution, intentionally re-resolved each fire,
#   and are NOT affected by BUG-001/002. Pinning applies ONLY to rewind hiding. Editing §5's re-resolution
#   language would be a correctness regression. (Verified: applyShrink re-resolves live each fire by design.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — spec/06 §12 pseudocode's resolveCheckpoint call (line 250) uses a STALE signature
#   `resolveCheckpoint(m, ctx, rw.checkpoint)`. The real signature is `(messages, branchEntries, checkpointName,
#   excludeToolCallId)` (M1 fix). The §6 code block (line 154) has the same stale signature. Align BOTH to the
#   real signature when editing — "no stale claims remain" includes stale signatures.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — spec/06 §12 pseudocode partitions ONCE before the loop (`const units =
#   partitionIntoUnits(m)` at line 240). The REAL filterPipeline re-partitions FRESH inside the loop per rewind
#   (transforms.ts ~1163) because each rewind reduces `m`, so unit.indices from a pre-loop partition index a
#   stale array. The pseudocode should NOTE this (a comment) so a reader doesn't "fix" the real code to
#   partition-once (which is a stale-index bug).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — The pinning notes in §3/§4/§6 are ADDITIVE (appended to the end of each section), not replacements.
#   The relative resolvers REMAIN (they are the backward-compat fallback for old/capture-failed markers). Do NOT
#   delete the existing relative-resolution descriptions — just add the pinning note after them.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — hideEntryIds holds ENTRY ids (stable Pi SessionEntryBase.id UUIDs), NOT message indices. This is
#   the WHOLE POINT (indices shift on compaction; entry ids don't). The spec/04 field doc + the spec/06 notes
#   must say "entry IDs" / "stable entry ids", never "indices". (Verified: resolvePinnedHide maps by identity.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 — A refused pinned hide (resolvePinnedHide returns []) MUST NOT fall back to relative resolution.
#   In the code this is control-flow-enforced (the length>0 gate already fired, so the else-if chain is skipped).
#   The §12 pseudocode + the §3/§4/§6 notes must preserve this invariant in spirit (the pinned branch is
#   if/else-if, not "try pinned, then try relative"). Documenting a "try-both" flow would mislead a future editor
#   into re-introducing the bug.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — spec files are plain markdown. There is NO lint/format command for them (none configured at all —
#   devDeps are typescript + vitest + @types/node). The gate is tsc (src/ only) + vitest + grep + human eyeball.
#   Do NOT invent a markdown-lint command.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — The JSDoc sweep is VERIFY-then-correct-IF-inaccurate, NOT rewrite-for-style. All 6 functions
#   already have accurate, detailed JSDoc (verified in research/notes.md §3). If you find yourself rewriting
#   accurate JSDoc for "clarity", STOP — that is scope creep. Only correct a demonstrable factual inaccuracy
#   (e.g. a JSDoc that says "returns null" when the function returns [], or names the wrong root→leaf order).
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

No code data-model change. The only "data model" work is documenting the `hideEntryIds` field in spec/04 §3
(markdown). The field's canonical definition lives in `src/markers.ts:74` (copy its semantics into the spec).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 18 files / 706-711 green
  - RUN: grep -n "unchanged between user prompts" spec/06-context-filter.md
        # confirm the false claim EXISTS at line ~232 (the thing you will remove).
  - RUN: grep -n "hideEntryIds" spec/04-data-model.md spec/06-context-filter.md
        # confirm hideEntryIds is currently ABSENT from BOTH specs (you will add it).
  - RUN: grep -n "^function resolveCheckpoint(messages" spec/06-context-filter.md
        # confirm the stale §6 signature (line ~154) you will align.

Task 1: MODIFY spec/06-context-filter.md   (5 surgical edits — exact text below)
  - EDIT A: §11 idempotency paragraph (line 232) — replace the false "across fires…" clause.
  - EDIT B: §3 resolveLastToolCallGroup — append a pinning note after the applyRewind line (~95).
  - EDIT C: §4 resolveLastTurn — append a pinning note after the applyRewind line (~118).
  - EDIT D: §6 Checkpoint — align the signature (line 154) + append a pinning note after the refuse-safely line (~165).
  - EDIT E: §12 filterPipeline pseudocode (lines 236-266) — add branchEntries param + pinned-first dispatch
            branch + aligned resolveCheckpoint signature + a re-partition comment.
  - CONSTRAINTS: additive notes (GOTCHA #4); entry IDs not indices (GOTCHA #5); pinned branch is if/else-if not
    try-both (GOTCHA #6); do NOT touch §5 (GOTCHA #1).

Task 2: MODIFY spec/04-data-model.md   (1 surgical edit — exact text below)
  - EDIT F: §3 RewindMarker interface — add hideEntryIds?: string[] field + doc comment (after excludeToolCallId,
            before seq).
  - CONSTRAINTS: mark OPTIONAL (?); say "entry IDs" (GOTCHA #5); mirror src/markers.ts:68-74 semantics.

Task 3: JSDoc SWEEP (verify-then-correct-if-needed)   (read-only unless an inaccuracy is found)
  - VERIFY each of the 6 functions against its accuracy criterion (table below). Open the file at the line; read
    the JSDoc; confirm it matches shipped behavior. Correct ONLY a demonstrable factual inaccuracy.
  - FUNCTIONS: resolveCheckpoint (transforms.ts:454), resolvePinnedHide (transforms.ts:625),
    filterPipeline (transforms.ts:1115), setCheckpoint (markers.ts:345), captureHideEntryIds (rewind.ts:282),
    resolvePreview (rewind.ts:315).
  - CONSTRAINT: do NOT rewrite accurate JSDoc for style (GOTCHA #8). Expected: NO src/ edits.

Task 4: VALIDATE (run the gates in the Validation Loop)
  - Level 1 (tsc) + Level 2 (vitest) + the grep gates + markdown sanity.
```

#### Exact edits — `spec/06-context-filter.md`

**EDIT A — §11 idempotency paragraph (replace the final sentence of the paragraph at line 232).**

Find this exact text:

```
Idempotency: re-firing the filter on the same session reproduces the same result (markers resolve against the same session each time until the session changes). No double-removal because removed messages are absent from subsequent passes within the same fire, and across fires the session is unchanged between user prompts.
```

Replace with:

```
Idempotency: re-firing the filter on the same session reproduces the same result (markers resolve against the same session each time until the session changes). No double-removal because removed messages are absent from subsequent passes within the same fire.

**Within a turn, the session is NOT static across fires.** A tool call appends entries between one `context` fire and the next, so a rewind marker that stores a *relative* spec ("last tool-call group" / "last turn") and is re-resolved against the live message list every fire is unstable: the moment the agent resumes work after a rewind, the relative spec re-targets onto the NEW work, un-hiding the originally-hidden mistake (BUG-001) and/or hiding the agent's own redo on every fire (BUG-002). For this reason, **new markers pin stable entry IDs at creation time** (`hideEntryIds`, captured by `captureHideEntryIds` — see §3/§4/§6 and `@04-data-model.md` §3) and `filterPipeline` resolves them by *identity* every fire via `resolvePinnedHide` (§12). The hidden set is therefore invariant across session growth: the originally-hidden mistake stays hidden every fire; the agent's new work (new entries, new IDs not in the pinned set) stays visible. The relative resolvers below remain ONLY as a backward-compat fallback for old markers (or capture failures) that lack `hideEntryIds`. (Idempotency of the pure pipeline on identical input still holds; the instability was always about re-resolution against a *growing* input, which pinning eliminates.)
```

**EDIT B — §3 `resolveLastToolCallGroup` (append a pinning note after the existing last line of §3, which reads
"`**applyRewind** for this granularity = remove the resolved unit's indices from the array (then close the gap).`").**

Append immediately after that line:

```

> **Pinning (permanent hiding):** the relative algorithm above is the **backward-compat fallback**. Markers created by the current `mulligan_rewind` capture the resolved unit's stable **entry IDs** at creation time into `hideEntryIds` (via `captureHideEntryIds`), and `filterPipeline` resolves them by identity every fire via `resolvePinnedHide` (§12). Because entry IDs are stable across session growth, the hidden unit never shifts onto new work — this is what makes the soft-delete permanent (fixes the leak-back of BUG-001). This `resolveLastToolCallGroup` resolver runs only for old markers (or capture failures) that lack `hideEntryIds`. See `@04-data-model.md` §3 for the field and §11 for why pinning is required.
```

**EDIT C — §4 `resolveLastTurn` (append a pinning note after the existing last line of §4, which reads
"`**applyRewind** for `last_turn` = remove `remove` indices (gap-closed), unit-aware.`").**

Append immediately after that line:

```

> **Pinning (permanent hiding):** like `resolveLastToolCallGroup` above, this relative resolver is the **backward-compat fallback**. Current `last_turn` markers pin the entry IDs of the removed span at creation time (`hideEntryIds` via `captureHideEntryIds`) and `filterPipeline` resolves them by identity every fire via `resolvePinnedHide` (§12). This is essential for `last_turn`: without pinning, the agent's own "redo" work lands after the last user message and is hidden on every subsequent fire, trapping the agent in a loop (BUG-002). Pinning makes the redo visible (its entries have new IDs not in the pinned set) while the shed span stays hidden. See `@04-data-model.md` §3 and §11.
```

**EDIT D — §6 Checkpoint (TWO sub-edits).**

*Sub-edit D1 — align the stale function signature at line 154.* Find:

```
function resolveCheckpoint(messages: AgentMessage[], ctx, checkpointName: string): { remove: number[] } | null
```

Replace with:

```
function resolveCheckpoint(messages: AgentMessage[], branchEntries: SessionEntry[], checkpointName: string, excludeToolCallId?: string): { remove: number[] } | null
```

*Sub-edit D2 — append a pinning note after the existing last line of §6, which ends "…refuse safely and log —
never guess.".* Append immediately after that sentence:

```

> **Pinning (permanent hiding):** checkpoint rewinds ALSO pin at creation time. `captureHideEntryIds` runs inside `resolvePreview` (the rewind tool's creation-time snapshot) and captures the entry IDs of the resolved removal set into `hideEntryIds`; `filterPipeline` then resolves them by identity every fire via `resolvePinnedHide`, which generalizes this section's entry→message walk from "one checkpoint target" to "a set of pinned entry IDs". The relative `resolveCheckpoint` above remains the **backward-compat fallback** (old markers / capture failures) AND the producer used at creation time to compute the removal set. Note also: `setCheckpoint` labels the last *real* `message` entry on the branch (walking `getBranch()` backwards), not the raw leaf — this avoids labeling a transient/non-context-producing entry that would make the walk map to the leaf and hide nothing (BUG-003). See `@04-data-model.md` §3 and §11.
```

**EDIT E — §12 `filterPipeline` pseudocode (replace the entire code block at lines 236-266).**

Find the existing block (starts `function filterPipeline(messages: AgentMessage[], markers, config, ctx): AgentMessage[] {`
and ends with the `injectNudge`/`shouldNudge` reference line). Replace the **rewind loop** portion so the new
block reads:

```ts
function filterPipeline(messages: AgentMessage[], markers, config, branchEntries, ctx): AgentMessage[] {
  let m = messages;
  for (const rw of stableSortBySeq(markers.rewinds)) {
    let remove: number[];

    // PINNED PATH (permanent hiding — fixes BUG-001/BUG-002): new markers carry stable ENTRY ids captured once
    // at creation time (captureHideEntryIds). resolvePinnedHide maps them by IDENTITY to current message indices
    // every fire, so the hidden set never shifts onto new work. A refused pinned hide returns [] and does NOT
    // fall back to the relative branches below (that would re-introduce the bug). branchEntries is getBranch()
    // output, ROOT→LEAF (no reverse).
    const pinned = Array.isArray(rw.hideEntryIds) ? rw.hideEntryIds : [];
    if (pinned.length > 0) {
      remove = resolvePinnedHide(m, branchEntries, pinned);
    } else if (rw.granularity === "last_tool_call_group") {
      // LEGACY FALLBACK (old markers / capture failures): relative re-resolution. Re-partition FRESH each rewind
      // (the real code partitions inside the loop, not once before it — a pre-loop partition indexes a stale array
      // after the first rewind reduces m).
      const units = partitionIntoUnits(m);
      const u = resolveLastToolCallGroup(units, m, rw.excludeToolCallId);
      remove = u ? u.indices : [];
    } else if (rw.granularity === "last_turn") {
      remove = resolveLastTurn(m, rw.options, rw.excludeToolCallId).remove;
    } else { // checkpoint
      const res = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId);
      remove = res ? res.remove : [];
    }
    if (!protectedOk(m, remove, config)) { log("warn","rewind.protected",...); continue; }
    m = removeIndices(m, remove);
  }
  for (const sh of stableSortBySeq(markers.shrinks)) {
    m = applyShrink(m, sh);   // shrinks intentionally re-resolve against m each fire (§5) — NOT pinned.
  }
  if (config.nudges.perTurnDrift && markers.metric && shouldNudge(markers.metric, config)) {
    m = injectNudge(m, markers.metric);
  }
  return m;
}
```

> Note: `branchEntries` is added as a parameter (the real `filterPipeline` takes `branchEntries?` — see
> `src/transforms.ts:1115`). `ctx` is kept in the illustrative signature only because the old block referenced it;
> if you prefer, drop `ctx` (the real signature does not take it). The key change is the pinned-first `if/else-if`
> dispatch + the re-partition comment + the aligned `resolveCheckpoint` signature.

#### Exact edit — `spec/04-data-model.md`

**EDIT F — §3 `RewindMarker` interface (add the `hideEntryIds` field).**

Find this exact block in the interface (the `excludeToolCallId` field + its comment, followed by `seq`):

```ts
  /** toolCallId of THIS rewind's own tool call, so the filter can exclude the
   *  rewind's own group when resolving "last tool-call group". Captured from the
   *  tool execute()'s toolCallId argument. */
  excludeToolCallId?: string;
  /** Monotonic per-session counter, so the filter can order markers reliably
   *  even if timestamps tie. Maintained in memory + snapshotted in the marker. */
  seq: number;
```

Insert a new field between `excludeToolCallId` and `seq`:

```ts
  /** toolCallId of THIS rewind's own tool call, so the filter can exclude the
   *  rewind's own group when resolving "last tool-call group". Captured from the
   *  tool execute()'s toolCallId argument. */
  excludeToolCallId?: string;
  /** Stable ENTRY IDs of the messages to hide, pinned ONCE at marker-creation time
   *  (by `captureHideEntryIds` in the rewind tool's creation-time snapshot). When
   *  present + non-empty, `filterPipeline` resolves them by identity → current
   *  message indices via `resolvePinnedHide` (`@06-context-filter.md` §12),
   *  guaranteeing PERMANENT soft-delete hiding across session growth (fixes
   *  BUG-001 leak-back + BUG-002 infinite loop: relative specs re-target onto
   *  new work; pinned entry IDs do not). Holds ENTRY ids (stable Pi
   *  SessionEntryBase.id UUIDs), NOT message indices (which shift on compaction).
   *  OPTIONAL for backward compatibility: absent (old markers, or when capture
   *  failed) → `filterPipeline` falls back to granularity-based relative
   *  re-resolution. See `@06-context-filter.md` §3/§4/§6/§11. */
  hideEntryIds?: string[];
  /** Monotonic per-session counter, so the filter can order markers reliably
   *  even if timestamps tie. Maintained in memory + snapshotted in the marker. */
  seq: number;
```

#### JSDoc sweep — accuracy table (Task 3)

Open each function's JSDoc and confirm it matches the criterion. Correct ONLY a factual inaccuracy.

| Function (file:line) | Accuracy criterion (must state) | As-verified |
|---|---|---|
| `resolveCheckpoint` (transforms.ts:454) | `branchEntries` is getBranch() ROOT→LEAF (NO internal reverse); unit-snaps iTarget to a unit's max index (BUG-003 secondary / pairing); returns `{remove}\|null` (null = refuse). | Accurate — no edit expected. |
| `resolvePinnedHide` (transforms.ts:625) | Maps a SET of pinned stable entry IDs → message indices by identity every fire; generalizes resolveCheckpoint; fixes BUG-001/002; returns `number[]` (NEVER null; [] = refuse/no-op). | Accurate — no edit expected. |
| `filterPipeline` (transforms.ts:1115) | "GRANULARITY DISPATCH" block documents PINNED FIRST (hideEntryIds non-empty → resolvePinnedHide) then legacy granularity branches; a refused pinned hide does NOT fall back; idempotency caveat re multi-group re-resolution. | Accurate — no edit expected. |
| `setCheckpoint` (markers.ts:345) | Does NOT label getLeafId(); walks getBranch() backwards to the last `message` entry with a real role (BUG-003 fix); returns `{entryId}\|{error}`. | Accurate — no edit expected. |
| `captureHideEntryIds` (rewind.ts:282) | Runs ONCE at creation time (inside resolvePreview); maps resolved message-index removal set → stable ENTRY ids; pins whole units; the producer half of the BUG-001/002 fix. | Accurate — no edit expected. |
| `resolvePreview` (rewind.ts:315) | Returns `{ ledger, k, hideEntryIds }`; builds a buildContextEntries() snapshot; calls captureHideEntryIds; the capture is best-effort (caller try/catch). | Accurate — no edit expected. |

> If (and only if) a JSDoc contradicts its criterion, correct the JSDoc comment ONLY. Do not touch the function
> body, signature, or any logic. Re-run `tsc` after any src/ edit.

### Implementation Patterns & Key Details

```markdown
# PATTERN (pinning note): every relative-resolver section (§3/§4/§6) gets the SAME 3-part framing:
#   1. "the relative algorithm above is the backward-compat fallback"
#   2. "new markers capture hideEntryIds at creation (captureHideEntryIds) → resolvePinnedHide by identity"
#   3. "this is what makes hiding permanent (BUG-001/002)" + a §11/§04 cross-ref.
# Keep notes SHORT (5-8 lines). They are ADDITIVE (append to end of section), not replacements.

# PATTERN (pseudocode): the pinned branch is `if (pinned.length > 0) { … } else if (granularity …)`.
#   It is an if/else-if CHAIN, not "try pinned then try relative" — a refused pinned hide (resolvePinnedHide
#   returns []) takes the pinned branch and gets [] (no-op), it does NOT fall through to the granularity branches.
#   This mirrors the real control flow (transforms.ts:1146-1166) and is the invariant that prevents the bug.

# CRITICAL (GOTCHA #1): do NOT edit §5 (applyShrink). Shrinks re-resolve live each fire BY DESIGN and are
#   unaffected by BUG-001/002. Pinning is rewind-hiding only.

# CRITICAL (GOTCHA #5): always say "entry IDs" / "stable entry ids", never "indices". The whole fix rests on
#   entry IDs being stable where message indices are not (compaction shifts indices; entry ids don't).
```

### Integration Points

```yaml
EDITS (this task — confined to spec/ + conditional src/ JSDoc):
  - spec/06-context-filter.md: §3 +pinning note; §4 +pinning note; §6 aligned signature + pinning note;
                                §11 corrected idempotency (false claim removed); §12 pseudocode +pinned dispatch
                                + aligned signatures + re-partition comment. ~30 lines.
  - spec/04-data-model.md:     §3 RewindMarker += hideEntryIds?: string[] + doc comment. ~12 lines.
  - src/transforms.ts | markers.ts | tools/rewind.ts:
                                CONDITIONAL — JSDoc correction ONLY where the sweep finds a factual inaccuracy.
                                Expected: NO src/ edits.

NO BEHAVIOR CHANGE. NO NEW FILES. NO NEW DEPS. NO config/API change. NO test change.
- spec/01,02,03,05,07,08,09,10,11,12 : READ-ONLY (out of scope — do not "fix" cross-references unless a doc
  literally references the removed false claim; none found in the cross-doc grep).
- test/* : P1.M3 owns tests (P1.M3.T2.S1 parallel = test/integration only). DO NOT TOUCH.

PARALLEL-COORDINATION:
  - P1.M3.T2.S1 (parallel) edits test/integration/smoke.ts + run-smoke.mjs. Different files → no collision.
    My docs edits cannot affect its test run (specs are not loaded by any test).
```

---

## Validation Loop

### Level 1: Type-safety (run after any src/ JSDoc edit; otherwise a sanity check)

```bash
npx tsc --noEmit -p tsconfig.json          # MUST exit 0. (Docs are not compiled; this only guards src/ JSDoc edits.)
# NOTE: no eslint/prettier configured (GOTCHA #7). Do NOT run a lint/format command.
```

### Level 2: Unit Tests (confirm docs did not break anything)

```bash
# Docs cannot break tests, but confirm the baseline holds (in case a src/ JSDoc edit accidentally touched code).
npx vitest run                             # expect green — 18 files / 706-711 tests (P1.M3.T1.S1 may have added ~5).
```

### Level 3: Documentation gates (THE validation for this task)

```bash
# (a) The false idempotency claim is GONE:
grep -ni "unchanged between user prompts" spec/06-context-filter.md
# Expected: NO output (exit code 1). If it prints a line, EDIT A did not land — fix it.

# (b) hideEntryIds is now documented in BOTH specs:
grep -ni "hideEntryIds" spec/04-data-model.md spec/06-context-filter.md
# Expected: multiple matches in BOTH files. If either file has zero, the field/dispatch note is missing — fix it.

# (c) The pinned-first dispatch is in the §12 pseudocode:
grep -n "resolvePinnedHide" spec/06-context-filter.md
# Expected: matches in the §12 pseudocode (and the §3/§4/§6 notes). If zero in §12, EDIT E did not land.

# (d) The 6 modified functions' JSDoc still exists + the functions are intact (sweep did not corrupt code):
grep -n "^export function resolveCheckpoint\|^export function resolvePinnedHide\|^export function filterPipeline" src/transforms.ts
grep -n "^export function setCheckpoint" src/markers.ts
grep -n "^function captureHideEntryIds\|^function resolvePreview" src/tools/rewind.ts
# Expected: all 6 signatures present, unchanged.

# (e) Shrink §5 re-resolution language is UNTOUCHED (GOTCHA #1 regression guard):
grep -n "Matchers resolve against the current" spec/06-context-filter.md
# Expected: the line is still present (you must NOT have edited §5).
```

### Level 4: Markdown sanity (human eyeball)

```bash
# Render-check the two edited specs (no tool — read them):
#   - spec/06 §11 reads as a corrected idempotency model (within-turn instability + pinning remedy).
#   - spec/06 §3/§4/§6 each end with a "> **Pinning (permanent hiding):**" note.
#   - spec/06 §12 pseudocode's rewind loop has the pinned if/else-if dispatch FIRST.
#   - spec/04 §3 RewindMarker shows hideEntryIds?: string[] between excludeToolCallId and seq.
#   - No ``` code fence is left unbalanced (count ``` fences is even).
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 passed: `npx tsc --noEmit -p tsconfig.json` exits 0 (only relevant if src/ JSDoc edited).
- [ ] Level 2 passed: `npx vitest run` green (docs can't break tests; count unchanged from baseline).
- [ ] Level 3 passed: all 5 grep gates (a–e) give the expected output.
- [ ] No lint/format command invented (GOTCHA #7).

### Feature Validation

- [ ] **spec/06 §11** no longer claims the session is unchanged across fires; states within-turn instability + pinning.
- [ ] **spec/06 §3, §4, §6** each have a pinning note naming `hideEntryIds` / `captureHideEntryIds` /
      `resolvePinnedHide` + the backward-compat-fallback framing.
- [ ] **spec/06 §6** `resolveCheckpoint` signature aligned to `(messages, branchEntries, checkpointName, excludeToolCallId)`.
- [ ] **spec/06 §12** pseudocode dispatches on non-empty `hideEntryIds` FIRST (if/else-if, not try-both); `resolveCheckpoint`
      uses the real signature; a re-partition comment is present.
- [ ] **spec/04 §3** `RewindMarker` has a documented `hideEntryIds?: string[]` field (entry IDs, optional, fallback).
- [ ] **§5 (shrinks)** re-resolution language is UNTOUCHED (grep gate e).
- [ ] **JSDoc sweep:** all 6 functions verified accurate (or corrected where a factual inaccuracy was found).

### Code Quality Validation

- [ ] Edits are surgical (no whole-section rewrites); pinning notes are ADDITIVE (appended, not replacing).
- [ ] "entry IDs" used throughout (never "indices") — GOTCHA #5.
- [ ] The pinned dispatch is described as if/else-if (a refused pinned hide does NOT fall back) — GOTCHA #6.
- [ ] No stale signature (`resolveCheckpoint(m, ctx, …)`) remains in §6 or §12.
- [ ] No source-code behavior changed (M1+M2 LANDED); only markdown + conditional JSDoc comments.

### Documentation & Deployment

- [ ] Cross-references (`@04-data-model.md` §3, `@06-context-filter.md` §11/§12) are consistent across the notes.
- [ ] No broken markdown (code fences balanced; headings intact).

---

## Anti-Patterns to Avoid

- ❌ Don't edit spec/06 §5 (`applyShrink`). Shrinks re-resolve live each fire BY DESIGN and are unaffected by
  BUG-001/002. Pinning is rewind-hiding only. (GOTCHA #1 — grep gate e guards this.)
- ❌ Don't delete the relative-resolver descriptions in §3/§4/§6. They are the backward-compat fallback and remain
  valid. ADD a pinning note; do not replace. (GOTCHA #4.)
- ❌ Don't describe the pinned dispatch as "try pinned, then try relative." It is an if/else-if chain; a refused
  pinned hide returns [] (no-op) and does NOT fall back (else the bug returns). (GOTCHA #6.)
- ❌ Don't say "indices" where you mean "entry IDs." Message indices shift on compaction; entry IDs don't — that
  stability is the entire point of the fix. (GOTCHA #5.)
- ❌ Don't leave the stale `resolveCheckpoint(messages, ctx, checkpointName)` signature in §6 (line 154) or §12.
  Align both to `(messages, branchEntries, checkpointName, excludeToolCallId)`. (GOTCHA #2.)
- ❌ Don't rewrite accurate JSDoc for "clarity." The sweep verifies; it corrects ONLY a factual inaccuracy.
  Rewriting accurate JSDoc is scope creep + risk. (GOTCHA #8.)
- ❌ Don't change any source-code behavior. M1+M2 are LANDED. The ONLY permissible src/ edit is a JSDoc comment
  correction IF the sweep finds one.
- ❌ Don't touch other spec files (spec/05 tools, spec/08 edge cases, …). The cross-doc grep found no spec that
  references the removed false claim. Out of scope.
- ❌ Don't invent a markdown-lint / eslint / prettier command. None is configured (devDeps = typescript + vitest +
  @types/node). The gate is tsc + vitest + grep + eyeball. (GOTCHA #7.)
- ❌ Don't skip the grep gates (Level 3). tsc + vitest alone CANNOT validate documentation (they don't read specs).
  The grep gates are the real proof the false claim is gone + the field/dispatch are present.

---

## Confidence Score: 9/10

One-pass success is highly likely: every edit is given as an exact anchor (current text → replacement text) traced
against the shipped code (read in full); the complete set of stale claims was located by grep (research/notes.md
§2); the "do NOT touch" list (§5 shrinks) is explicit and grep-guarded; the JSDoc sweep is a verification table
(expected no-op, not a writing exercise); and the validation gates (tsc + vitest + 5 grep checks) are verified.
The **−1** accounts for one residual risk: the §12 pseudocode is illustrative (in a ```ts fence, not compiled),
so a subtle inconsistency (e.g. a parameter name drift) won't be caught by tsc — it relies on the Level 4 eyeball
+ the resolvePinnedHide grep gate (c). Mitigated by giving the full replacement block verbatim.