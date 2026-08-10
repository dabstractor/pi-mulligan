# PRP — P1.M1.T1.S2: `rewind.ts` schema + description + `REWIND_DESC` (note consolidation, step 2/3)

---

## Goal

**Feature Goal**: Update `src/tools/rewind.ts` so the `mulligan_rewind` parameter schema + LLM-facing description match the **3-field note** produced by S1 (`src/notes.ts` → `NoteInput` lost `avoid`). Concretely: remove the `avoid` field from `RewindParams.note`, update the `what_happened` / `true_current_state` descriptions to the spec/05 §1 verbatim text, change the note object description "All four → All three", fix the file-header "four-field → three-field", and rephrase one substring in `REWIND_DESC` ("The hidden content disappears from your view permanently" → "The content is hidden from your context going forward"). This is the rewind-tool half of the note consolidation; the tests are S3.

**Deliverable**: A modified `src/tools/rewind.ts` with (1) a 3-field `RewindParams.note` typebox schema (no `avoid`), (2) the updated field/object descriptions, (3) the file-header "three-field" wording, (4) the rephrased `REWIND_DESC`. `Static<typeof RewindParams>` then infers `note` as a 3-field object matching `NoteInput`. No other file is touched in S2.

**Success Definition**:
- `grep -n "avoid" src/tools/rewind.ts` → zero matches; `grep -nE "four-field|All four|disappears from your view permanently"` → zero matches.
- `npx tsc --noEmit` reports NO error originating in `src/tools/rewind.ts`. (Remaining errors are EXPECTED, in the test files that still reference `avoid` — owned by S3; see GOTCHA #4.)
- `RewindParams.note` is structurally identical to the spec/05 §1 schema (3 arms, verbatim descriptions).

## User Persona (if applicable)

**Target User**: The coding agent (LLM) that calls `mulligan_rewind`, and the S3 implementer who updates the tests.

**Use Case**: The agent authors a rewind note. After S1+S2 it writes 3 fields (`what_happened` / `true_current_state` / `next`); the "what to avoid" lesson is folded into `what_happened`. The schema the LLM sees now describes exactly those 3 fields.

**User Journey**: S1 narrowed `NoteInput` → S2 aligns the `RewindParams.note` schema + the LLM-facing `REWIND_DESC` → S3 updates the test fixtures/assertions. After all three, the agent writes 3 fields and the schema/doc/tests all agree.

**Pain Points Addressed**: A 4-field note was redundant (`avoid` + `what_happened` overlapped). Consolidating to 3 reduces agent friction + token cost with no information loss.

## Why

- **Business value / user impact**: Minor UX simplification — one fewer required field per rewind note, lower token cost, no information loss (the lesson moves into `what_happened`).
- **Integration with existing features**: `RewindParams.note` is the typebox mirror of `NoteInput` (`src/notes.ts`, narrowed by S1). `validateNote` / `renderNote` are called from `rewindExecute` with `params.note as NoteInput`; after S2 the schema and `NoteInput` agree (3 fields), so those casts are clean identity casts. `NoteInput` is persisted verbatim in `RewindMarker.note` (`src/markers.ts`, type-only import — auto-adapts, NO edit; verified).
- **Problems this solves and for whom**: For the agent: a less repetitive note-authoring schema + accurate LLM-facing descriptions. For maintainers: schema parity with the updated spec/05 §1 + spec/05 §6.

## What

No user-visible runtime behavior change in S2 alone beyond what S1 already caused (the agent is no longer asked for `avoid`). The source change: the schema loses `avoid`; two field descriptions + the object description are rewritten; the file-header says "three-field"; `REWIND_DESC` has one substring rephrased.

### Success Criteria

- [ ] `RewindParams.note` has exactly 3 fields: `what_happened`, `true_current_state`, `next` (no `avoid`), in that order.
- [ ] `what_happened` + `true_current_state` descriptions equal the spec/05 §1 verbatim text (Task 1).
- [ ] The note object description is `"The note your resumed self will read. All three fields required."`.
- [ ] The file-header comment says "structured three-field note" (not "four-field").
- [ ] `REWIND_DESC` contains "The content is hidden from your context going forward" and NOT "disappears from your view permanently".
- [ ] `next` field description, `granularity`/`to_previous_prompt`/`checkpoint` arms, `RewindArgs`, `rewindExecute`, `makeRewindTool`, `RewindDetails`, `refusal()`, `MUTATION_WARNING`, all preview helpers — UNCHANGED.
- [ ] `grep -n "avoid" src/tools/rewind.ts` → zero; tsc shows no error originating in rewind.ts.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP lists every touchpoint with its CURRENT text and TARGET text (verbatim), confirms the exact line numbers via grep, gives the spec/05 §1 authoritative schema to match byte-for-byte, and tells the implementer which downstream tsc/test failures are EXPECTED (owned by S3) so they don't chase them out of scope. The S1 PRP (sibling) defines the 3-field `NoteInput` this builds on; this PRP treats it as a stable contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/tools/rewind.ts
  why: "THE file. ALL S2 edits are here. Touchpoints (grep-confirmed): line 5 (file header 'four-field'), lines 82-84 (what_happened desc), line 86-88 (the avoid Type.String block to REMOVE), lines 89-91 (true_current_state desc), line 97 (note object desc 'All four'), line 136 (REWIND_DESC 'disappears from your view permanently'). RewindParams is ~line 79; RewindArgs derivation ~line 105 (auto-updates, no edit); REWIND_DESC ~line 136."
  pattern: "The note schema is a Type.Object with a 2nd-arg { description } for the object-level doc the LLM sees. Keep that 2-arg shape; only the field list + descriptions change. The `next` field + its description are UNCHANGED (item omits it; spec/05 §1 shows it identical to current)."
  gotcha: "rewind.ts imports { validateNote, renderNote, NOTE_INVALID_REASON, type NoteInput } from ../notes.js (~line 57). The call sites validateNote((params?.note ?? {}) as NoteInput) and renderNote((params.note as NoteInput)...) are CASTS — permissive. After S2 params.note is 3-field == NoteInput, so they're clean identity casts. Do NOT touch the call sites or the execute body."

- file: src/notes.ts  # (modified by S1 — assumed to exist as 3-field)
  why: "The source of NoteInput (now 3-field after S1). The RewindParams.note schema MUST match NoteInput's shape so the `as NoteInput` casts are honest and Static<typeof RewindParams>.note ≡ NoteInput. The field descriptions S2 writes into the schema mirror the docstrings S1 wrote into NoteInput (both are spec/05 §1 verbatim)."
  pattern: "NoteInput fields (post-S1): what_happened, true_current_state, next (in that order). NOTE_FIELDS iterates these; validateNote checks exactly these 3."
  gotcha: "Do NOT edit notes.ts in S2 (S1 owns it — parallel subtask, merge-conflict risk). Do NOT edit markers.ts (type-only NoteInput import, auto-adapts)."

- file: plan/006_5b685875f3df/architecture/system_context.md
  why: "§Touchpoint Map is the authoritative scope list. Row 'src/tools/rewind.ts | Cluster 1' enumerates EXACTLY the 3 edits (schema remove avoid + update descriptions; header four-field→three-field; REWIND_DESC substring). Row 'src/markers.ts | Cluster 1 (verify only)' confirms NO markers.ts edit. Verification #1 confirms NoteInput is type-only in markers.ts."
  critical: "Confirms the (it stays on disk for the human) clause in REWIND_DESC is NOT part of the changed substring — only 'disappears from your view permanently' → 'hidden from your context going forward' changes. Confirms forward-compat (old persisted markers with `avoid` are ignored on read-back; no migration)."

- spec: spec/05-tools.md §1 (Parameter schema) + §6 (Description strings)
  why: "The authoritative target text. spec/05 §1 RewindParams.note (h3.21) gives the EXACT 3-field schema with verbatim descriptions — paste them. spec/05 §6 (h3.47) gives the EXACT full REWIND_DESC string with 'The content is hidden from your context going forward (it stays on disk for the human)' — match it."
  critical: "These are LLM-facing docs (Mode A) that drive tool usage. Paraphrasing drifts from the spec and from what S1 wrote into NoteInput. Copy verbatim."

- file: test/tools/rewind.test.ts (READ-ONLY — do NOT edit in S2)
  why: "Confirms the EXPECTED test breakage owned by S3. After S2, rewind.test.ts fixtures (VALID_NOTE ~lines 54-55, 844-845) and the refusal parametrized table (~line 332 'whitespace-only avoid') still reference `avoid` → they will fail until S3 updates them. Do NOT fix them here (scope boundary)."
  gotcha: "test/edge-cases.test.ts ALSO has 4 `avoid` references (lines 286, 307, 685, 701) — also S3. test/notes.test.ts + test/integration/smoke.ts likewise. All EXPECTED, all S3."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  tools/rewind.ts   # ← MODIFY (S2): RewindParams.note schema (line ~79) + REWIND_DESC (line ~136) + file header (line ~5)
  notes.ts          # ← S1 (NOT this subtask): NoteInput now 3-field
  markers.ts        # ← type-only NoteInput import; auto-adapts, NO edit
test/
  notes.test.ts           # ← S3 (NOT this subtask): VALID_NOTE/FIELDS/**Avoid** assertions
  tools/rewind.test.ts    # ← S3: VALID_NOTE + refusal table
  edge-cases.test.ts      # ← S3: avoid at lines 286/307/685/701
  integration/smoke.ts    # ← S3: avoid at line ~67
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S2 MODIFIES exactly ONE source file (no test changes):
src/tools/rewind.ts   # 6 touchpoints: file header (line 5) + note schema fields/descriptions (lines 82-97) + REWIND_DESC (line 136)
# All other files are S1 (notes.ts) / S3 (tests) — NOT touched here. markers.ts auto-adapts (no edit).
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (the note schema field ORDER matters — match spec/05 §1 + NoteInput). The current schema
//   orders the fields what_happened, avoid, true_current_state, next. After removing `avoid`, the order becomes
//   what_happened, true_current_state, next — which EXACTLY matches spec/05 §1 (h3.21) AND NoteInput's field
//   order (S1). Do not reorder what_happened/true_current_state/next. The `next` field stays LAST.

// CRITICAL GOTCHA #2 (the `next` field description is UNCHANGED). The item contract lists only what_happened +
//   true_current_state for description updates. spec/05 §1 (h3.21) shows `next` description as "Imperative: the
//   immediate next action to take when you resume." — IDENTICAL to the current rewind.ts text. Leave `next` and
//   its description byte-for-byte alone. Editing it would drift from the spec for no reason.

// CRITICAL GOTCHA #3 (REWIND_DESC is a SINGLE substring change — keep the rest VERBATIM). Only "The hidden content
//   disappears from your view permanently" → "The content is hidden from your context going forward". The clause
//   "(it stays on disk for the human)" STAYS (it is not part of the changed substring). The first sentence, "Costs
//   only a short note.", and the granularity tail are all UNCHANGED. The result must equal the spec/05 §6 (h3.47)
//   full string byte-for-byte. REWIND_DESC is the LLM-facing tool doc (Mode A) — drift defeats its purpose.

// CRITICAL GOTCHA #4 (EXPECT downstream test breakage — do NOT chase it). After S2, the test files that still
//   reference `avoid` will fail tsc and/or vitest: test/notes.test.ts, test/tools/rewind.test.ts,
//   test/edge-cases.test.ts (lines 286/307/685/701), test/integration/smoke.ts. These are OWNED by S3
//   (P1.M1.T1.S3). S2's bar is: rewind.ts itself is clean (no error originating in it; the 6 touchpoints done).
//   Do NOT edit any test file in S2 (scope creep + merge-conflict risk with the parallel S3 work).

// CRITICAL GOTCHA #5 (the `as NoteInput` casts are NOT touched). rewindExecute calls validateNote((params?.note ??
//   {}) as NoteInput) and renderNote((params.note as NoteInput) ...). These casts are permissive (a source with
//   MORE props casts down fine). After S2 params.note is 3-field == NoteInput, so they're clean identity casts.
//   Do NOT remove the casts or touch the execute body — S2 is schema + descriptions + REWIND_DESC ONLY.

// CRITICAL GOTCHA #6 (markers.ts auto-adapts — DO NOT edit it). markers.ts line 27 `import type { NoteInput }` +
//   line 79 `note: NoteInput` are TYPE-ONLY. Removing `avoid` flows through with no markers.ts change (confirmed by
//   the arch Touchpoint Map verification #1). Old persisted markers that carry `avoid` are ignored on read-back
//   (validateNote/renderNote run only at tool-call time; unknown keys ignored) — forward-compatible, no migration.

// CRITICAL GOTCHA #7 (do NOT touch renderBloatReminder / renderDriftNudge). Those live in notes.ts (Cluster 2,
//   P1.M2.T1) — NOT in rewind.ts at all, but flagging in case of confusion. S2 is the REWIND tool only.
```

## Implementation Blueprint

### Data models and structure

**No data-model change beyond the schema literal.** `RewindParams` is a typebox `Type.Object`; `Static<typeof RewindParams>` (`RewindArgs`) auto-updates to a 3-field `note` once the schema field is removed. `NoteInput` (notes.ts, S1) is the matching 3-field interface. `RewindMarker.note` (markers.ts) is typed `NoteInput` and auto-adapts.

```typescript
// The structural contract: after S2, Static<typeof RewindParams>["note"] ≡ NoteInput (3 fields).
//   { what_happened: string; true_current_state: string; next: string }
// This makes the `as NoteInput` casts in rewindExecute clean identity casts (no shape diff).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT RewindParams.note schema (rewind.ts ~lines 79-98) — remove avoid + rewrite descriptions
  - REPLACE the entire note: Type.Object({...}, { description }) block. CURRENT:
      note: Type.Object(
        {
          what_happened: Type.String({
            description:
              "Past tense: what specifically went wrong and wasted context. Be concrete.",
          }),
          avoid: Type.String({
            description: "Imperative: what NOT to do again on resume.",
          }),
          true_current_state: Type.String({
            description:
              "The TRUE current state as of this rewind — files changed, commands run, decisions made on the span being discarded. This prevents redoing work. (A deterministic file ledger is auto-appended.)",
          }),
          next: Type.String({
            description: "Imperative: the immediate next action to take when you resume.",
          }),
        },
        { description: "The note your resumed self will read. All four fields required." },
      ),
    TARGET (spec/05 §1 h3.21 VERBATIM — 3 fields, no avoid, updated descriptions):
      note: Type.Object(
        {
          what_happened: Type.String({
            description:
              "Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson.",
          }),
          true_current_state: Type.String({
            description:
              "The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work.",
          }),
          next: Type.String({
            description: "Imperative: the immediate next action to take when you resume.",
          }),
        },
        { description: "The note your resumed self will read. All three fields required." },
      ),
  - NAMING/ORDER: keep field names what_happened / true_current_state / next in THIS order (GOTCHA #1). The `avoid`
    block is removed entirely (it sat between what_happened and true_current_state).
  - GOTCHA: `next` + its description are UNCHANGED (GOTCHA #2) — copy them verbatim into the target. The object-level
    description 2nd arg stays; only its text changes ("All four" → "All three").
  - VERIFY: paste the what_happened + true_current_state descriptions byte-for-byte from spec/05 §1 (the em-dashes,
    "— and what to avoid doing again.", "(files/commands are auto-captured in the ledger below)." are load-bearing).
  - DEPENDENCIES: S1's notes.ts (NoteInput is 3-field, so Static<typeof RewindParams>.note now matches NoteInput).

Task 2: EDIT the file-header comment (rewind.ts line 5) — "four-field" → "three-field"
  - CURRENT (line 5): "...it calls this tool with a structured four-field note + a granularity."
  - TARGET: "...it calls this tool with a structured three-field note + a granularity."
  - GOTCHA: this is a JSDoc comment (the file-header block). Only the adjective changes. The rest of the header
    (the tool's 5-step description, the DESIGN block, the gotchas) is UNCHANGED.
  - DEPENDENCIES: none.

Task 3: EDIT REWIND_DESC (rewind.ts line 136) — one substring rephrase
  - CURRENT (line 136):
      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The hidden content disappears from your view permanently (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message."
  - TARGET (spec/05 §6 h3.47 VERBATIM — only the one substring changes; the "(it stays on disk for the human)" clause STAYS):
      "Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message."
  - GOTCHA (GOTCHA #3): the ONLY substring that changes is "The hidden content disappears from your view permanently"
    → "The content is hidden from your context going forward". Do NOT touch the first sentence, "(it stays on disk
    for the human)", "Costs only a short note.", or the granularity tail. The result must equal spec/05 §6 byte-for-byte.
  - DEPENDENCIES: none.

Task 4: VERIFY markers.ts auto-adapts (NO edit)
  - CONFIRM (read-only): src/markers.ts line 27 is `import type { NoteInput } from "./notes.js";` and line 79 is
    `note: NoteInput;`. Both are TYPE-ONLY — no runtime field access on `avoid`. Removing `avoid` from NoteInput
    (S1) flows through with NO markers.ts change.
  - DO NOT edit markers.ts. (Confirmed by arch Touchpoint Map verification #1.)
  - DEPENDENCIES: none.

Task 5: VALIDATE (no new code)
  - GREP: `grep -n "avoid" src/tools/rewind.ts` → expect ZERO matches (the schema field is gone; nothing else in
    rewind.ts referenced it). Also `grep -nE "four-field|All four|disappears from your view permanently"` → ZERO.
  - RUN `npx tsc --noEmit` → NO error line cites `src/tools/rewind.ts` as its origin. Remaining errors are EXPECTED
    and confined to the test files that still reference `avoid` (test/notes.test.ts, test/tools/rewind.test.ts,
    test/edge-cases.test.ts, test/integration/smoke.ts — GOTCHA #4, all owned by S3). Do NOT fix those.
  - DO NOT run `npx vitest run` expecting green — it WILL fail until S3. (You MAY run it to CONFIRM the failures are
    exactly the expected avoid-related ones — that's a sanity check, not a gate.)
  - DEPENDENCIES: Tasks 1-4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the note schema is a Type.Object with a 2nd-arg object description. Keep that shape; only the
//   field list + descriptions change. After the edit, Static<typeof RewindParams>["note"] is the 3-field NoteInput:
//     { what_happened: string; true_current_state: string; next: string }
//   which makes the `as NoteInput` casts in rewindExecute clean identity casts (no shape diff).

// PATTERN (Task 3): REWIND_DESC is a single string literal. The edit is a pure substring replacement:
//   "The hidden content disappears from your view permanently"  →  "The content is hidden from your context going forward"
//   Everything else (incl. "(it stays on disk for the human)") is verbatim. The result == spec/05 §6 (h3.47) string.

// CRITICAL: the two cheapest correctness gates are the greps (Task 5). "avoid" should appear NOWHERE in rewind.ts
//   after S2, and the three stale phrases ("four-field", "All four", "disappears from your view permanently") must
//   all be gone. If any grep matches, you missed a touchpoint.
```

### Integration Points

```yaml
CODE:
  - modify: src/tools/rewind.ts ONLY (6 touchpoints: file header + note schema fields/descriptions + REWIND_DESC)
  - untouched: rewindExecute body, makeRewindTool, RewindDetails, refusal(), MUTATION_WARNING, all preview helpers,
    RewindArgs derivation, the `as NoteInput` casts, granularity/to_previous_prompt/checkpoint schema arms
DOWNSTREAM (later subtasks — NOT this one):
  - S1 (P1.M1.T1.S1): src/notes.ts — NoteInput 3-field (parallel, assumed landed)
  - S3 (P1.M1.T1.S3): test/notes.test.ts, test/tools/rewind.test.ts, test/edge-cases.test.ts, test/integration/smoke.ts
    — fixtures/FIELDS/refusal-table/assertions updated to 3-field
  - markers.ts: TYPE-ONLY NoteInput import, auto-adapts (NO edit — GOTCHA #6)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config field, no persistence-shape migration (forward-compatible — arch verification #3), no registration
    change (makeRewindTool unchanged).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The cheapest, most decisive gates — confirm every touchpoint is done:
grep -n "avoid" src/tools/rewind.ts                                              # EXPECTED: no output (zero matches)
grep -nE "four-field|All four|disappears from your view permanently" src/tools/rewind.ts  # EXPECTED: no output

# Full project typecheck — EXPECTED downstream errors, NOT necessarily a clean run:
npx tsc --noEmit
# EXPECTED: errors ONLY in the test files that still reference `avoid` (test/notes.test.ts, test/tools/rewind.test.ts,
#   test/edge-cases.test.ts, test/integration/smoke.ts) — all owned by S3 (GOTCHA #4).
# YOUR bar: NO error line cites `src/tools/rewind.ts`. rewind.ts is internally consistent (3-field schema matching
#   the 3-field NoteInput, descriptions matching spec/05 §1). If rewind.ts DOES appear in an error, you left a
#   touchpoint half-done (e.g. removed `avoid` from the schema but the description still says "All four") — fix YOUR file.
# Do NOT "fix" the test/* errors here (they are S3).
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A as a GREEN gate for S2: test/tools/rewind.test.ts WILL FAIL after S2 (VALID_NOTE fixture + refusal table still
# reference `avoid`). Those failures are EXPECTED and owned by S3 (P1.M1.T1.S3).
#
# You MAY run it as a SANITY CHECK to confirm the failures are exactly the expected avoid-related ones (no surprise
# failures in unrelated rewind tests):
npx vitest run test/tools/rewind.test.ts
# EXPECTED: failures limited to the avoid-field fixture/refusal cases. If a DIFFERENT rewind test fails (e.g. a
#   granularity/depth/retry-budget case broke), that's an S2 bug — investigate (you likely edited more than the 6
#   touchpoints). Do NOT update the tests in S2 (that's S3).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2: there is no live runtime seam to exercise — the schema/description change is LLM-facing (what the agent
# sees when it inspects the tool) and type-level (RewindArgs.note). The end-to-end "agent writes a 3-field note and
# validateNote/renderNote agree" validation belongs to S3 (tests). No server/endpoint to curl.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Schema-parity check against the spec (optional — proves the schema matches spec/05 §1 byte-for-byte):
#   diff the RewindParams.note block against spec/05 §1 (h3.21). A quick structural grep:
#     grep -nE "what_happened|true_current_state|next|All three fields" src/tools/rewind.ts
#   Expected: the 3 field names appear in order (what_happened, true_current_state, next) + "All three fields required".
#   NO `avoid`, NO `by_tool_name` (that's shrink/cancel, not rewind). The descriptions contain the spec's em-dash
#   clauses ("— and what to avoid doing again" / "(files/commands are auto-captured in the ledger below)").
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -n "avoid" src/tools/rewind.ts` → zero matches.
- [ ] `grep -nE "four-field|All four|disappears from your view permanently" src/tools/rewind.ts` → zero matches.
- [ ] `npx tsc --noEmit` → NO error originating in `src/tools/rewind.ts` (remaining errors are expected test-file failures, S3).

### Feature Validation

- [ ] `RewindParams.note` has exactly 3 fields (`what_happened`, `true_current_state`, `next`); `avoid` removed.
- [ ] `what_happened` + `true_current_state` descriptions match spec/05 §1 (h3.21) verbatim (em-dashes + ledger clause).
- [ ] Note object description is `"The note your resumed self will read. All three fields required."`.
- [ ] File-header comment says "structured three-field note".
- [ ] `REWIND_DESC` contains "The content is hidden from your context going forward" and NOT "disappears from your view permanently"; the "(it stays on disk for the human)" clause is preserved.
- [ ] `next` field + description, granularity/to_previous_prompt/checkpoint arms, `rewindExecute`, `makeRewindTool`, `RewindDetails`, `refusal()`, `MUTATION_WARNING`, preview helpers — all UNCHANGED.

### Code Quality Validation

- [ ] Only `src/tools/rewind.ts` is modified — NO edits to notes.ts (S1), markers.ts (auto-adapts), nudges.ts, or any test file (S3).
- [ ] The description rewrites match the spec verbatim (not paraphrased) — they are LLM-facing docs.
- [ ] The note schema field order is what_happened → true_current_state → next (matches spec/05 §1 + NoteInput).

### Documentation & Deployment

- [ ] File-header comment + schema descriptions + REWIND_DESC updated (Mode A — rides with the code).
- [ ] No README/spec change in S2 (changeset doc sync is P1.M3.T1; spec files are the source of truth, already 3-field).

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" the downstream `avoid` references in any test file — those are S3 (P1.M1.T1.S3). Touching them here crosses task boundaries and risks merge conflicts with the parallel S3 work. S2's bar is rewind.ts only (GOTCHA #4).
- ❌ Don't reorder the note fields or move `next` — the order what_happened → true_current_state → next matches spec/05 §1 and NoteInput (S1). Removing `avoid` (which sat between what_happened and true_current_state) yields the correct order automatically (GOTCHA #1).
- ❌ Don't edit the `next` field or its description — the item contract lists only what_happened + true_current_state for description updates, and spec/05 §1 shows `next` identical to the current text. Editing it drifts from the spec for no reason (GOTCHA #2).
- ❌ Don't rephrase more than the one REWIND_DESC substring — only "The hidden content disappears from your view permanently" → "The content is hidden from your context going forward" changes. The "(it stays on disk for the human)" clause and every other sentence stay verbatim (GOTCHA #3). The result must equal spec/05 §6 (h3.47) byte-for-byte.
- ❌ Don't touch the `as NoteInput` casts or the `rewindExecute` body — they are permissive casts that become clean identity casts once the schema is 3-field. S2 is schema + descriptions + REWIND_DESC ONLY (GOTCHA #5).
- ❌ Don't edit `src/markers.ts` — it imports `NoteInput` TYPE-ONLY, so the field removal flows through automatically (GOTCHA #6). Old persisted markers carrying `avoid` are ignored on read-back (forward-compatible).
- ❌ Don't paraphrase the what_happened / true_current_state descriptions — paste spec/05 §1 verbatim (the em-dashes + the "ledger below" clause are load-bearing). These descriptions are what S1 wrote into NoteInput and what the LLM reads; drift creates a three-way inconsistency.
- ❌ Don't rely on `npx vitest run` being green as your S2 gate — it WILL fail (expectedly) until S3. The real gates are the two greps (avoid gone; stale phrases gone) + tsc showing no error originating in rewind.ts (GOTCHA #4).

---

## Decision Log

- **D1 — Leave the `next` field + description unchanged.** The item contract specifies description updates for `what_happened` and `true_current_state` only. spec/05 §1 (h3.21) shows `next`'s description as "Imperative: the immediate next action to take when you resume." — byte-for-byte identical to the current rewind.ts text. Editing it would drift from the spec with no benefit. `next` stays LAST in the field order (matching spec + NoteInput).

- **D2 — REWIND_DESC is a single substring replacement (the disk clause stays).** The item says change "The hidden content disappears from your view permanently" → "The content is hidden from your context going forward". The adjacent clause "(it stays on disk for the human)" is NOT part of that substring and is preserved. spec/05 §6 (h3.47) confirms the full target string reads "...going forward (it stays on disk for the human)...". This keeps the operator-reassurance clause (the human can still see hidden content via `/tree`) that the old string carried.

- **D3 — markers.ts is verified, not edited.** Confirmed via grep (line 27 `import type { NoteInput }`, line 79 `note: NoteInput`) and the architecture Touchpoint Map verification #1: the import is type-only with no runtime field access on `avoid`. Removing the field flows through automatically. Old persisted markers carrying `avoid` are ignored on read-back (validateNote/renderNote run only at tool-call time; unknown keys are ignored) — forward-compatible, no migration needed.

---