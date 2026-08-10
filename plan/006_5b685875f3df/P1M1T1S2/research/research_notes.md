# Research Notes — P1.M1.T1.S2: rewind.ts schema + description + RWIND_DESC

## Dependency on S1 (assumed implemented)
S1 (P1.M1.T1.S1) modifies src/notes.ts ONLY: NoteInput → 3 fields (what_happened / true_current_state / next, NO avoid);
NOTE_FIELDS 3 entries; renderNote drops **Avoid:**; readNoteField union 3 members; all JSDocs four→three.
markers.ts imports NoteInput TYPE-ONLY (`import type { NoteInput }` line 27, `note: NoteInput` line 79) → auto-adapts, NO edit.

## S2 scope: src/tools/rewind.ts ONLY (4 surgical edits + 1 verify). 0.5 points.

## Verified touchpoints (grep-confirmed in current rewind.ts)
1. **Line 5 (file header):** "...it calls this tool with a structured four-field note + a granularity."
   → change "four-field" → "three-field".
2. **Line 86 (schema):** `avoid: Type.String({ description: "Imperative: what NOT to do again on resume." })` block
   → REMOVE entirely (the block is between what_happened and true_current_state).
3. **Lines 82-84 (what_happened desc):** "Past tense: what specifically went wrong and wasted context. Be concrete."
   → "Past tense: what went wrong and wasted context — and what to avoid doing again. Be concrete; generalize the lesson."
4. **Lines 89-91 (true_current_state desc):** "The TRUE current state as of this rewind — files changed, commands run,
   decisions made on the span being discarded. This prevents redoing work. (A deterministic file ledger is auto-appended.)"
   → "The TRUE current state as of this rewind — task progress, decisions, and conclusions (files/commands are auto-captured in the ledger below). This prevents redoing work."
5. **Line 97 (note object desc):** "All four fields required." → "All three fields required."
6. **Line 136 (REWIND_DESC):** substring "The hidden content disappears from your view permanently"
   → "The content is hidden from your context going forward". (The "(it stays on disk for the human)" clause STAYS.)

## NOT changed
- `next` field description ("Imperative: the immediate next action to take when you resume.") — item omits it; spec/05 §1
  h3.21 shows it IDENTICAL to current. Leave alone.
- granularity / to_previous_prompt / checkpoint schema arms — untouched.
- RewindArgs derivation (Static<typeof RewindParams>) — auto-updates to 3-field note.
- The `as NoteInput` casts (validateNote/renderNote call sites) — these are permissive; after S2 params.note is 3-field = NoteInput, so they're clean (identity casts).
- rewindExecute body, makeRewindTool, RewindDetails, refusal(), MUTATION_WARNING, all preview helpers — untouched.

## Resulting note schema ORDER (matches spec/05 §1 + NoteInput field order)
what_happened → true_current_state → next (avoid removed from between what_happened and true_current_state).

## markers.ts verification (no edit) — CONFIRMED
Line 27: `import type { NoteInput } from "./notes.js";` (type-only). Line 79: `note: NoteInput;` (type annotation only).
No runtime field access on `avoid`. Removing the field flows through automatically. (system_context.md Touchpoint Map
item #1 verified ✅; forward-compat: old persisted markers with `avoid` are ignored on read-back — validateNote/renderNote
run only at tool-call time.)

## tsc/vitest gates
- `npx tsc --noEmit`: rewind.ts must have NO error originating in it after S2. (rewind.ts likely did NOT error after S1
  alone — the `as NoteInput` casts absorb the shape diff — but the schema/descriptions were STALE. S2 fixes the staleness.)
  EXPECTED remaining errors (owned by S3): test/notes.test.ts, test/edge-cases.test.ts (lines 286/307/685/701),
  test/tools/rewind.test.ts, test/integration/smoke.ts — all still reference `avoid`.
- grep gates: `grep -n "avoid" src/tools/rewind.ts` → 0; `grep -nE "four-field|All four|disappears from your view permanently"` → 0.

## Spec authority
spec/05 §1 (h3.21) gives the EXACT verbatim RewindParams.note schema (3 fields + descriptions) — TARGET. spec/05 §6
(h3.47) gives the EXACT verbatim REWIND_DESC with "The content is hidden from your context going forward" — TARGET.