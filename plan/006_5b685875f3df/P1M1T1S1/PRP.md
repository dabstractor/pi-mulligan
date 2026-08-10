# PRP — P1.M1.T1.S1: `notes.ts` note machinery + JSDocs (remove the `avoid` field) — 4-field → 3-field note

---

## Goal

**Feature Goal**: Consolidate Mulligan's rewind note from **4 fields to 3** by removing `NoteInput.avoid` and folding its "what to avoid" lesson into `what_happened` (per spec/04 §2.1). This is the SOURCE-ONLY change to `src/notes.ts` — the pure-helper tier. It is the first subtask (S1) of the note-consolidation task; the rewind-tool schema (S2) and the tests (S3) land afterward and depend on this change.

**Deliverable**: A modified `src/notes.ts` where `NoteInput` has 3 fields (`what_happened` / `true_current_state` / `next`), `NOTE_FIELDS` has 3 entries, `renderNote` emits no `**Avoid:**` line, `readNoteField`'s key union has 3 members, and ALL JSDoc "four" → "three" references + the FORMAT-block `**Avoid:**` line are updated. No other file is touched in S1.

**Success Definition**:
- `src/notes.ts` is internally consistent and compiles on its own (3-field interface, 3-entry array, renderNote/readNoteField updated in lockstep).
- `npx tsc --noEmit` reports errors ONLY in the EXPECTED downstream consumer files that still reference `avoid` (`src/tools/rewind.ts`, `test/notes.test.ts`, `test/edge-cases.test.ts`, `test/tools/rewind.test.ts`, `test/integration/smoke.ts`) — these are owned by S2/S3, NOT fixed here. No NEW error originates *within* `src/notes.ts`.
- The `avoid` string does not appear anywhere in `src/notes.ts` after the edits (grep is clean).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and the S2/S3 implementers; indirectly the coding agent that authors rewind notes.

**Use Case**: The agent calls `mulligan_rewind` with a 3-field note. `validateNote` checks the 3 fields; `renderNote` renders a 3-section note. The "lesson" the agent once wrote in `avoid` is now folded into `what_happened` (one concrete past-tense field that generalizes the lesson).

**User Journey**: S1 narrows the type → S2 updates `RewindParams.note` typebox schema to match → S3 updates the tests/fixtures. After all three, the agent writes 3 fields and the rendered note has no `**Avoid:**` line.

**Pain Points Addressed**: A 4-field note was redundant — `avoid` (imperative "don't do X again") and `what_happened` (past-tense "did X") overlapped. Consolidating to 3 reduces agent friction without losing the lesson (it's folded into `what_happened`).

## Why

- **Business value / user impact**: Minor UX simplification — fewer required fields for the agent to fill, lower token cost per note, no information loss (the lesson moves into `what_happened`).
- **Integration with existing features**: `NoteInput` is the shared type consumed by `src/tools/rewind.ts` (the `RewindParams.note` schema + `validateNote`/`renderNote` calls) and persisted verbatim in `RewindMarker.note` (`src/markers.ts`, type-only import — flows through automatically). `validateNote`'s loop iterates `NOTE_FIELDS`, so removing `avoid` from that array automatically stops checking it — NO loop-logic change.
- **Problems this solves and for whom**: For the agent: a less repetitive note authoring experience. For maintainers: schema parity with the updated spec/04 §2.1 + spec/05 §1.

## What

No user-visible behavior in S1 alone (the rewind tool still requires `avoid` until S2 updates its schema). The source change: `NoteInput` drops `avoid`; `NOTE_FIELDS` drops `"avoid"`; `renderNote` drops the `**Avoid:**` section; `readNoteField`'s key union drops `"avoid"`; all JSDocs say "three" not "four" and the FORMAT block no longer lists `**Avoid:**`.

### Success Criteria

- [ ] `NoteInput` has exactly 3 fields: `what_happened`, `true_current_state`, `next` (no `avoid`).
- [ ] `what_happened` and `true_current_state` docstrings match the spec verbatim (Task 1).
- [ ] `NOTE_FIELDS` has exactly 3 entries (no `"avoid"`).
- [ ] `renderNote`'s `sections` array has no `**Avoid:**` entry; its FORMAT JSDoc block lists no `**Avoid:**` line.
- [ ] `readNoteField`'s `key` union is `"what_happened" | "true_current_state" | "next"`.
- [ ] Every "four" in the JSDocs is now "three"; no `avoid` string remains in `src/notes.ts`.
- [ ] `validateNote`'s LOOP body is UNCHANGED (it reads `NOTE_FIELDS`; removing the array entry does the work).
- [ ] `renderBloatReminder` / `renderDriftNudge` are UNCHANGED (those are P1.M2.T1, Cluster 2 — NOT this subtask).

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP enumerates all 14 exact touchpoints in `src/notes.ts` with their current text and target text, confirms the loop needs no change, and — critically — tells the implementer which downstream tsc/test failures are EXPECTED (owned by S2/S3) so they don't chase them out of scope.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/notes.ts
  why: "THE file. ALL S1 edits are here. 14 touchpoints (enumerated in the Implementation Tasks): module-header JSDoc (line 6 'all four'), DESIGN block (line 13 'all four required strings'), NoteInput interface + JSDoc (lines 34-42), NOTE_FIELDS array + JSDoc (lines 65-70), validateNote JSDoc (lines 74 + 81 'all four'), renderNote FORMAT JSDoc (~line 155) + sections array (line 185), readNoteField key union (line 209)."
  pattern: "NoteInput (line ~33), NOTE_FIELDS (line ~66, `readonly (keyof NoteInput)[]`), validateNote (loops NOTE_FIELDS — NO body change), renderNote (sections[] array, line ~166), readNoteField (key union, line ~205). isRecord/readOwn module-private helpers are UNCHANGED."
  gotcha: "validateNote's LOOP logic is UNCHANGED — it iterates NOTE_FIELDS, so removing 'avoid' from the array automatically stops checking it (contract item 3). Do NOT touch the loop body, isRecord, readOwn, NOTE_INVALID_REASON, NoteValidation, or the S3 nudge renderers (renderBloatReminder/renderDriftNudge — those are P1.M2.T1)."

- file: plan/006_5b685875f3df/architecture/system_context.md
  why: "§Touchpoint Map confirms: (1) markers.ts imports NoteInput TYPE-ONLY (`import type { NoteInput }`, `note: NoteInput` on RewindMarker) — removing avoid flows through with NO markers.ts edit; (2) nudges.ts call sites are already correct (no avoid); (3) the consumer files that WILL break (rewind.ts, test/notes.test.ts, test/edge-cases.test.ts, test/tools/rewind.test.ts, test/integration/smoke.ts) are owned by S2/S3."
  critical: "Confirms NO migration is needed: old persisted markers have `avoid`, but validateNote/renderNote run only at TOOL-CALL time (never on read-back), and unknown keys are ignored. So removing the field is forward-compatible — old sessions are unaffected."

- file: src/tools/rewind.ts (READ-ONLY — do NOT edit in S1)
  why: "The downstream consumer. Line 57 imports `{ validateNote, renderNote, NOTE_INVALID_REASON, type NoteInput }`; line 86 has `avoid: Type.String({...})` in RewindParams.note schema. After S1, rewind.ts STILL references avoid → it will have a tsc error (the schema field is no longer in NoteInput's shape, and the typebox schema is a separate concern). This is EXPECTED — rewind.ts is S2 (P1.M1.T1.S2). Do NOT fix it here."

- file: test/notes.test.ts (READ-ONLY — do NOT edit in S1)
  why: "Confirms the EXPECTED test breakage. Line 18-20: VALID_NOTE fixture is typed NoteInput and includes `avoid`; line 42: FIELDS array includes 'avoid'; line 67: `avoid: null`; renderNote section assertions check for `**Avoid:**`. After S1 these FAIL (type error: excess property 'avoid'; runtime: the avoid-empty case returns valid:true because validateNote no longer checks avoid; the **Avoid:** render assertion finds no such line). ALL owned by S3 (P1.M1.T1.S3). Do NOT fix them here."

- spec: spec/04-data-model.md §2.1 (NoteInput) + spec/05 §1 (RewindParams.note schema)
  why: "The authoritative 3-field shape + the exact field docstrings. spec/05 §1 RewindParams.note gives the verbatim descriptions to use for what_happened + true_current_state (see Task 1 — they match the contract item 3a)."
  critical: "spec/04 §2.1 now says 'All three fields are required and non-empty'. The NoteInput JSDoc must match (currently says 'All four')."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  notes.ts        # ← MODIFY (S1): NoteInput, NOTE_FIELDS, renderNote, readNoteField, all JSDocs
  tools/rewind.ts # ← S2 (NOT this subtask): RewindParams.note schema still has `avoid`
  markers.ts      # ← type-only import of NoteInput; auto-adapts, NO edit
test/
  notes.test.ts        # ← S3 (NOT this subtask): VALID_NOTE/FIELDS/**Avoid** assertions
  edge-cases.test.ts   # ← S3: avoid references at lines ~286, 307, 685, 701
  tools/rewind.test.ts # ← S3: VALID_NOTE + refusal table
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S1 MODIFIES exactly ONE source file:
src/notes.ts   # 14 touchpoints (interface field, array entry, render section, key union, 10 JSDoc spots)
# All other files are S2 (rewind.ts) / S3 (tests) — NOT touched here.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S1 is the SOURCE DOMINO — EXPECT downstream breakage, do NOT chase it).
//   Removing `avoid` from NoteInput narrows the type. CONSUMER files that still reference `avoid` will fail:
//     - src/tools/rewind.ts:86  (RewindParams.note schema has `avoid: Type.String({...})`) → S2 (P1.M1.T1.S2)
//     - test/notes.test.ts       (VALID_NOTE excess property, FIELDS array, **Avoid** assertions) → S3
//     - test/edge-cases.test.ts  (avoid at lines ~286/307/685/701) → S3
//     - test/tools/rewind.test.ts (VALID_NOTE + refusal table) → S3
//     - test/integration/smoke.ts (avoid at line ~67) → S3
//   These failures are EXPECTED and OWNED by S2/S3. S1's bar is: src/notes.ts is internally consistent,
//   and tsc/vitest failures are CONFINED to the files listed above. Do NOT "fix" rewind.ts or any test in S1
//   (scope creep that crosses task boundaries + risks merge conflicts with the parallel S2/S3 work).

// CRITICAL GOTCHA #2 (validateNote's LOOP body is UNCHANGED). The loop `for (const field of NOTE_FIELDS)`
//   reads the array. Removing "avoid" from NOTE_FIELDS makes the loop skip it automatically. Do NOT add an
//   explicit `if (field === "avoid") continue;` or touch the loop body. The contract is explicit: only the
//   NOTE_FIELDS array literal + JSDocs change; the function logic is untouched.

// CRITICAL GOTCHA #3 (do NOT touch the S3 nudge renderers). notes.ts also contains renderBloatReminder +
//   renderDriftNudge (lines ~230+). Those are Cluster 2 (P1.M2.T1.S1), NOT this subtask. S1 touches ONLY the
//   note machinery: NoteInput, NOTE_FIELDS, validateNote JSDoc, renderNote, readNoteField. Leave the nudge
//   renderers + their helpers (bytesToKb/kTokens/resultWord/readDelta/readBloatHits) byte-for-byte unchanged.

// CRITICAL GOTCHA #4 (every "four" must become "three"; every "**Avoid:**" must go). The string "avoid" /
//   "four" appears in 14 spots across notes.ts (module header, DESIGN block, NoteInput JSDoc+interface,
//   NOTE_FIELDS JSDoc+array, validateNote JSDoc x2, renderNote FORMAT JSDoc + sections array, readNoteField
//   union). Missing ONE leaves a stale reference. After editing, grep `avoid` and `all four` / `The four` /
//   `All four` in src/notes.ts — both MUST return nothing.

// CRITICAL GOTCHA #5 (the NoteInput JSDoc prose also mentions "what to avoid"). Line ~36 currently reads
//   "the resumed model is told explicitly what happened, what to avoid, the true current state, and what to do
//   next." Since `avoid` is folded into `what_happened`, reword to e.g. "what happened (and the lesson — what
//   to avoid doing again), the true current state, and what to do next." Don't leave a dangling "what to avoid"
//   that implies a separate field.

// CRITICAL GOTCHA #6 (markers.ts auto-adapts — DO NOT edit it). markers.ts line 27 `import type { NoteInput }`
//   + line 79 `note: NoteInput` are TYPE-ONLY. Removing the field flows through with no markers.ts change.
//   Editing markers.ts is out of scope and unnecessary (confirmed by the architecture Touchpoint Map).
```

## Implementation Blueprint

### Data models and structure

The ONLY data-model change is `NoteInput` losing one field:

```typescript
// CURRENT (notes.ts ~line 33 — 4 fields):
export interface NoteInput {
  what_happened: string;
  avoid: string;            // ← REMOVED
  true_current_state: string;
  next: string;
}

// TARGET (3 fields):
export interface NoteInput {
  /** Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson. */
  what_happened: string;
  /** The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work. */
  true_current_state: string;
  /** The immediate next action to take on resume. Imperative. e.g. "Re-run the search as `grep -rl auth src/`." */
  next: string;
}
```

`NoteValidation`, `NOTE_INVALID_REASON`, `DriftNudgeInput` are UNCHANGED.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT NoteInput interface + its JSDoc (notes.ts ~lines 33-43)
  - REMOVE the `avoid` field (line ~41) entirely (the `/** What NOT to do again. ... */` docstring + the field).
  - REPLACE the what_happened docstring (line ~40). CURRENT:
      /** What went wrong, concretely. Past tense. e.g. "Ran `grep -r auth .` and dumped ~40k tokens I didn't need." */
    TARGET (spec/05 §1 verbatim):
      /** Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson. */
  - REPLACE the true_current_state docstring (line ~42). CURRENT:
      /** The current TRUE world state as of the rewind — files changed, commands run, decisions made on the span. */
    TARGET (spec/05 §1 verbatim):
      /** The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work. */
  - EDIT the NoteInput JSDoc (line ~34): "All four fields are REQUIRED" → "All three fields are REQUIRED".
  - EDIT the NoteInput JSDoc prose (line ~36): "the resumed model is told explicitly what happened, what to avoid,
    the true current state, and what to do next." → "the resumed model is told explicitly what happened (and the
    lesson — what to avoid doing again), the true current state, and what to do next." (folds avoid into what_happened).
  - KEEP the `next` field + its docstring UNCHANGED.
  - DEPENDENCIES: none.

Task 2: EDIT NOTE_FIELDS array + its JSDoc (notes.ts ~lines 65-70)
  - EDIT the JSDoc (line ~65): "The four required, non-empty note fields, in spec/04 §2.1 order." → "The three required, non-empty note fields, in spec/04 §2.1 order."
  - REMOVE the `"avoid",` line (line ~68) from the array. TARGET array (3 entries):
      const NOTE_FIELDS: readonly (keyof NoteInput)[] = [
        "what_happened",
        "true_current_state",
        "next",
      ];
  - DEPENDENCIES: Task 1 (NoteInput no longer has avoid, so keyof NoteInput no longer includes it — the array typechecks).

Task 3: EDIT validateNote JSDoc — "four" → "three" (notes.ts ~lines 74 + 81)
  - Line ~74 (the @description/opening): "assert all four NoteInput fields are non-empty strings AFTER TRIM" → "assert all three NoteInput fields are non-empty strings AFTER TRIM".
  - Line ~81 (inline): "All four present + non-empty → { valid:true }." → "All three present + non-empty → { valid:true }."
  - DO NOT touch the validateNote FUNCTION BODY (the loop reads NOTE_FIELDS; GOTCHA #2).
  - DEPENDENCIES: none.

Task 4: EDIT renderNote — drop the **Avoid:** section + FORMAT JSDoc (notes.ts ~lines 151-185)
  - In the renderNote FORMAT JSDoc block (~line 155): REMOVE the line `*     **Avoid:** <avoid>`.
    (The block goes straight from `**What happened:** <what_happened>` to `**Current true state:** <true_current_state>`.)
  - In the renderNote function body (line ~185): REMOVE the line
      `**Avoid:** ${readNoteField(note, "avoid")}`,
    from the `sections` array. TARGET sections head:
      const sections: string[] = [
        `## 🔄 Mulligan rewind (${granularity})`,
        `**What happened:** ${readNoteField(note, "what_happened")}`,
        `**Current true state:** ${readNoteField(note, "true_current_state")}`,
      ];
  - KEEP the LEDGER_BLOCKS loop + the final `**Next:**` push UNCHANGED.
  - DEPENDENCIES: none.

Task 5: EDIT readNoteField key union (notes.ts ~line 209)
  - CHANGE the `key` parameter type. CURRENT:
      key: "what_happened" | "avoid" | "true_current_state" | "next",
    TARGET:
      key: "what_happened" | "true_current_state" | "next",
  - KEEP the function body UNCHANGED (it just calls readOwn + typeof check).
  - DEPENDENCIES: Task 1 (so the union matches the real NoteInput keys). NOTE: after Task 4 removed the only
    `readNoteField(note, "avoid")` call site, the "avoid" member of the union is dead — removing it is required
    for the union to match keyof NoteInput and keeps the literal-union type-check honest.

Task 6: EDIT the module-header + DESIGN JSDocs — remaining "four" references (notes.ts ~lines 6 + 13)
  - Line ~6 (module header): "spec/05-tools.md §1 step 2 (validate note: all four non-empty)" → "all three non-empty".
  - Line ~13 (DESIGN block): "note is typed NoteInput (all four required strings)" → "(all three required strings)".
  - DEPENDENCIES: none.

Task 7: VERIFY (no new code)
  - GREP: `grep -n "avoid" src/notes.ts` → expect ZERO matches (the field, the array entry, the render line, the
    union member, and every JSDoc mention are all gone). Also `grep -nE "all four|The four|All four" src/notes.ts`
    → ZERO matches.
  - RUN `npx tsc --noEmit` → EXPECT errors in the downstream consumer files ONLY (src/tools/rewind.ts, and the
    test/* files listed in GOTCHA #1). Confirm NO error line cites `src/notes.ts` as its origin — notes.ts itself
    is internally consistent. (If notes.ts DOES appear in a tsc error, you missed a touchpoint or left an internal
    inconsistency — fix it; do NOT fix the consumer files.)
  - DO NOT run `npx vitest run test/notes.test.ts` expecting green — it WILL fail (the avoid-empty case now returns
    valid:true, and the **Avoid:** render assertion finds no line). Those failures are S3's to fix. (You MAY run it
    to CONFIRM the failures are exactly the expected ones — that's a useful sanity check, not a gate.)
  - DEPENDENCIES: Tasks 1-6.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): the array drives the loop — remove the entry, the loop adapts.
//   NOTE_FIELDS is `readonly (keyof NoteInput)[]`. After Task 1 removes `avoid` from NoteInput, `"avoid"` is no
//   longer a `keyof NoteInput`, so leaving it in the array would be a tsc error (good — it forces Task 2).
//   validateNote's `for (const field of NOTE_FIELDS)` then iterates only the 3 surviving keys. NO loop change.

// PATTERN (Task 4): renderNote builds sections top-to-bottom; drop the one line.
//   The sections array is order-sensitive (spec/04 §2.3). Removing the `**Avoid:**` line makes the rendered note go:
//     ## 🔄 Mulligan rewind (<g>)
//     **What happened:** <what_happened>
//     **Current true state:** <true_current_state>
//     <ledger blocks>
//     **Next:** <next>
//   which matches spec/04 §2.3 (the updated spec has no **Avoid:** line — see selected_prd h3.18).

// PATTERN (Task 5): the readNoteField literal-union key is a TYPE-CHECK on call sites.
//   After Task 4 removes `readNoteField(note, "avoid")`, the "avoid" member is unused. Removing it from the union
//   keeps the union == keyof NoteInput (3 keys). If you LEFT "avoid" in the union, tsc would still compile (an
//   extra literal is harmless), but it would be a stale lie about NoteInput's shape — remove it for honesty.

// CRITICAL: the grep check (Task 7) is the cheapest correctness gate. "avoid" should appear NOWHERE in notes.ts
//   after S1 — not in code, not in JSDoc, not in the FORMAT block. If grep finds it, you missed a touchpoint.
```

### Integration Points

```yaml
CODE:
  - modify: src/notes.ts ONLY (14 touchpoints across 6 tasks)
  - untouched: validateNote loop body, isRecord/readOwn, NOTE_INVALID_REASON, NoteValidation, renderBloatReminder, renderDriftNudge, all S3 helpers, DriftNudgeInput
DOWNSTREAM (later subtasks — NOT this one):
  - S2 (P1.M1.T1.S2): src/tools/rewind.ts — remove `avoid` from RewindParams.note typebox schema + update descriptions + RWIND_DESC
  - S3 (P1.M1.T1.S3): test/notes.test.ts, test/edge-cases.test.ts, test/tools/rewind.test.ts, test/integration/smoke.ts — fixtures/FIELDS/assertions
  - markers.ts: TYPE-ONLY import, auto-adapts (NO edit — GOTCHA #6)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config field, no persistence-shape migration (forward-compatible — GOTCHA in arch doc), no registration.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The cheapest, most decisive gate — confirms every touchpoint is done:
grep -n "avoid" src/notes.ts                       # EXPECTED: no output (zero matches)
grep -nE "all four|The four|All four" src/notes.ts # EXPECTED: no output (zero matches)

# Full project typecheck — EXPECTED downstream errors, NOT a clean run:
npx tsc --noEmit
# EXPECTED: errors ONLY in src/tools/rewind.ts (the `avoid` schema field) + test/* files (excess property,
#   FIELDS array, **Avoid** assertions) — all listed in GOTCHA #1, all owned by S2/S3.
# YOUR bar: NO error line cites `src/notes.ts`. notes.ts is internally consistent (3-field interface,
#   3-entry array, renderNote/readNoteField in lockstep). If src/notes.ts DOES appear in an error, you left an
#   internal inconsistency (e.g. "avoid" still in NOTE_FIELDS after removing it from NoteInput) — fix YOUR file.
# Do NOT "fix" the rewind.ts or test/* errors here (they are S2/S3).
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A as a GREEN gate for S1: test/notes.test.ts WILL FAIL after S1 (the avoid-empty case now returns valid:true
# because validateNote no longer checks avoid; the **Avoid:** render-section assertion finds no line). Those
# failures are EXPECTED and owned by S3 (P1.M1.T1.S3).
#
# You MAY run it as a SANITY CHECK to confirm the failures are exactly the expected ones (no surprise failures
# in unrelated notes.ts tests):
npx vitest run test/notes.test.ts
# EXPECTED: failures limited to the avoid-field cases + the **Avoid:** render assertion. If a DIFFERENT notes.ts
#   test fails (e.g. a what_happened/true_current_state/next case broke), that's an S1 bug — investigate.
# Do NOT update the tests in S1 (that's S3).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1: there is no live runtime seam to exercise until S2 (rewind schema) + S3 (tests) land. The end-to-end
# "agent writes a 3-field note and the rendered note has no **Avoid:** line" validation belongs to S3.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Rendered-note shape check (optional — proves renderNote output matches spec/04 §2.3 after the edit):
#   a quick tsx one-liner (NOTE: will tsc-error on the 3-field NoteInput if you pass avoid, which is the point):
#   npx tsx -e "import {renderNote} from './src/notes.js'; console.log(renderNote({what_happened:'wh',true_current_state:'tcs',next:'nx'},{readFiles:[],modifiedFiles:[],bashSideEffects:[]},'last_turn'));"
#   → the output should contain "**What happened:**", "**Current true state:**", "**Next:**" and NO "**Avoid:**".
# (The unit test in Level 2 / S3 covers this programmatically; this is just a manual confirmation.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -n "avoid" src/notes.ts` → zero matches.
- [ ] `grep -nE "all four|The four|All four" src/notes.ts` → zero matches.
- [ ] `npx tsc --noEmit` → errors ONLY in the expected downstream files (rewind.ts + test/*); NO error cites `src/notes.ts`.

### Feature Validation

- [ ] `NoteInput` has exactly 3 fields (`what_happened`, `true_current_state`, `next`); `avoid` removed.
- [ ] `what_happened` + `true_current_state` docstrings match spec/05 §1 verbatim (Task 1).
- [ ] `NOTE_FIELDS` has exactly 3 entries.
- [ ] `renderNote` emits no `**Avoid:**` line; its FORMAT JSDoc lists no `**Avoid:**`.
- [ ] `readNoteField`'s key union has 3 members.
- [ ] All JSDoc "four" → "three"; NoteInput prose folds "what to avoid" into "what happened".
- [ ] `validateNote` loop body, `isRecord`/`readOwn`, `NOTE_INVALID_REASON`, `NoteValidation` UNCHANGED.
- [ ] `renderBloatReminder` / `renderDriftNudge` + their S3 helpers UNCHANGED (Cluster 2 = P1.M2.T1).

### Code Quality Validation

- [ ] Only `src/notes.ts` is modified — NO edits to rewind.ts, markers.ts, nudges.ts, or any test file (GOTCHA #1).
- [ ] The docstring rewrites match the spec verbatim (not paraphrased).
- [ ] The renderNote sections array stays order-correct (What happened → Current true state → ledger blocks → Next).

### Documentation & Deployment

- [ ] JSDocs updated (Mode A — rides with the code): module header, NoteInput, NOTE_FIELDS, validateNote, renderNote FORMAT block.
- [ ] No README/spec change in S1 (changeset doc sync is P1.M3.T1; spec files are the source of truth, already 3-field).

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" the downstream `avoid` references in `src/tools/rewind.ts` or any test file — those are S2 (P1.M1.T1.S2) and S3 (P1.M1.T1.S3). Touching them here crosses task boundaries and risks merge conflicts with the parallel subtasks. S1 is the source domino; the downstream breakage is EXPECTED (GOTCHA #1).
- ❌ Don't touch the `validateNote` loop body — it iterates `NOTE_FIELDS`, so removing `"avoid"` from the array makes the loop skip it automatically. Adding an explicit `if (field === "avoid") continue;` is redundant and diverges from the contract (GOTCHA #2).
- ❌ Don't edit `renderBloatReminder` / `renderDriftNudge` or their helpers — those are Cluster 2 (P1.M2.T1.S1, nudge text re-shortening), a separate task. S1 is the NOTE machinery only (GOTCHA #3).
- ❌ Don't edit `src/markers.ts` — it imports `NoteInput` TYPE-ONLY (`import type`), so the field removal flows through automatically. Editing it is unnecessary (GOTCHA #6, confirmed by the arch Touchpoint Map).
- ❌ Don't leave a stale "what to avoid" in the NoteInput JSDoc prose implying a separate field — fold it into "what happened" so the doc matches the 3-field reality (GOTCHA #5).
- ❌ Don't leave `"avoid"` in the `readNoteField` key union "to be safe" — it's a stale lie about `NoteInput`'s shape after the field is gone. The union should equal `keyof NoteInput` (3 keys). Remove it (Task 5).
- ❌ Don't paraphrase the `what_happened` / `true_current_state` docstrings — paste the spec/05 §1 verbatim text (Task 1). These docstrings are the source of truth that S2's RewindParams schema descriptions will mirror.
- ❌ Don't rely on `npx vitest run` being green as your S1 gate — it WILL fail (expectedly) until S3. The real gates are the two greps (avoid gone; "four" gone) + tsc showing no error originating in notes.ts (GOTCHA #1).