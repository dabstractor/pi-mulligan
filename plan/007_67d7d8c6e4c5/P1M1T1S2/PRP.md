# PRP — P1.M1.T1.S2: `rewind.ts` schema + behavior (remove `to_previous_prompt` + BUG-006 dead code)

---

## Goal

**Feature Goal**: Remove the v1 `to_previous_prompt` "nuclear" option from the `mulligan_rewind` tool entirely — it discarded the latest user message, violating the v1.1 guardrail ("a rewind never wipes user input"). Concretely, in `src/tools/rewind.ts`: (1) drop the `to_previous_prompt` field from the `RewindParams` typebox schema, (2) update the one `resolveLastTurn` call site to S1's new 2-arg signature, (3) delete the now-dead BUG-006 refusal block, and (4) stop emitting `to_previous_prompt` in the persisted marker's `options`. The agent retains the consented way to rewind further: `granularity:"checkpoint"` (user-set checkpoints). This is the rewind-tool half of the `to_previous_prompt` removal; S1 owns transforms.ts, S3 owns markers.ts, S4 owns the tests.

**Deliverable**: A modified `src/tools/rewind.ts` with 5 surgical edits (1 JSDoc, 1 schema field removal, 1 call-site arg change, 1 dead-block removal, 1 payload.options simplification). `Static<typeof RewindParams>` then no longer has `to_previous_prompt`; `rewindExecute` never references it; persisted marker `options` carry only `{ protect }`. No other file is touched by S2.

**Success Definition**:
- `grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts` → zero matches.
- `npx tsc --noEmit` → NO error originating in `src/tools/rewind.ts` (the S1-left TS2554/TS2345 at line 444 are resolved). Remaining errors are in test files (owned by S4) — not chased.
- `RewindParams` structurally matches spec/05 §1 (h3.21): `note` + `granularity` + `checkpoint?` only — no `to_previous_prompt`.
- `REWIND_DESC` is byte-for-byte unchanged (it never mentioned `to_previous_prompt` — verified).

## User Persona (if applicable)

**Target User**: The coding agent (LLM) that calls `mulligan_rewind`, and maintainers enforcing the v1.1 guardrail.

**Use Case**: The agent rewinds its own mistaken work. It can no longer discard the user's message (that was unsafe — it could abandon the original task). To rewind further back, the human sets a checkpoint; the agent rewinds *to* it via `granularity:"checkpoint"`.

**User Journey**: S1 removed `resolveLastTurn`'s nuclear mode (transforms.ts) → **S2 removes the rewind tool's `to_previous_prompt` field + the dead BUG-006 block + the persisted option** → S3 annotates markers.ts (legacy optional) → S4 updates the 39 test occurrences. After all four, the guardrail holds by construction: a `last_turn` rewind always keeps the latest user message.

**Pain Points Addressed**: `to_previous_prompt:true` let the agent silently discard the user's current ask — a footgun that could abandon the original task. v1.1 removes it; checkpoints (human-created) are the consented way to rewind across user messages.

## Why

- **Business value / user impact**: Enforces the v1.1 guardrail (spec/13 §1, h2.127): "a rewind may hide the agent's own output freely, but must never hide a `user` message." The one exception is `checkpoint` (the user opted in by setting it). Removing `to_previous_prompt` eliminates the only agent path that could wipe user input.
- **Integration with existing features**: `RewindParams.to_previous_prompt` flowed into `resolveLastTurn(messages, {to_previous_prompt}, toolCallId)` (S1 removed the `opts` param) and into the persisted marker `options.to_previous_prompt` (S3 keeps the field optional for legacy reads). S2 is the consumer of S1's new 2-arg signature and the producer of the now-simplified `options`. `REWIND_DESC` is already guardrail-compliant (no `to_previous_prompt` mention) — no doc change.
- **Problems this solves and for whom**: BUG-006 (the dead refusal block) was a runtime guard for a now-impossible code path; leaving it is misleading dead code. For maintainers: schema parity with spec/05 §1 (h3.21) + a clean, guardrail-by-construction tool.

## What

No user-visible behavior change beyond what S1 already caused at the resolver tier (the agent could no longer get a nuclear `last_turn` once S1 landed, because `resolveLastTurn` ignores the opts). S2 completes the removal at the tool tier: the schema no longer *offers* the option, the call site no longer *passes* it, the dead refusal block is gone, and the persisted `options` no longer *carry* it.

### Success Criteria

- [ ] `RewindParams` has exactly: `note`, `granularity`, `checkpoint?` (no `to_previous_prompt`).
- [ ] Line 444 reads `remove = resolveLastTurn(messages, toolCallId).remove;` (2-arg, S1's signature).
- [ ] The `(5b)` BUG-006 refusal block (comment + `if`/`refuse`) is entirely gone.
- [ ] `payload.options` is `{ protect: config.rewind.protectedRoles }` (no `to_previous_prompt`).
- [ ] The RewindParams JSDoc (line 76) no longer lists `to_previous_prompt?`.
- [ ] `REWIND_DESC`, the checkpoint-granularity path, and steps 1–4/5/6/7b/8 of `rewindExecute` are UNCHANGED.
- [ ] `grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts` → zero; tsc shows no error citing rewind.ts.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP lists every touchpoint with its current text and target text, gives the exact line ranges for the dead-block removal, confirms `REWIND_DESC` needs no edit, verifies the `markers.ts` `options` shape stays assignable, and tells the implementer which downstream tsc/test failures are EXPECTED (owned by S3/S4). The S1 PRP (sibling) defines the new `resolveLastTurn` signature this consumes; this PRP treats it as a stable contract.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/tools/rewind.ts
  why: "THE file. ALL S2 edits are here. Touchpoints (grep-confirmed): line 76 (RewindParams JSDoc 'to_previous_prompt?'), lines 109-114 (the schema field), line 444 (the resolveLastTurn call — 3-arg, must become 2-arg), lines 593-610 (the (5b) BUG-006 comment + if/refuse block — remove entirely), line 620 (payload.options — drop to_previous_prompt). REWIND_DESC is lines ~132-134 (NO edit — verified no to_previous_prompt mention)."
  pattern: "RewindParams is a Type.Object; removing one field is a clean delete of the field + its JSDoc mention. The resolveLastTurn call is in resolvePreview's granularity dispatch (last_turn branch, line 444). payload.options is built inline in step 7 (line 618-629) and cast `as RewindMarkerInput` at the appendRewindMarker call."
  gotcha: "The (5b) block is a COMMENT + an if/refuse, spanning lines 593-610 (from `// (5b) protected-refusal check` through the closing `}` of the if). Remove the WHOLE block (comment + code), not just the if. It sits between the resolvePreview catch (ends ~line 592) and the (6) render note comment (line 612)."

- file: src/transforms.ts  # (modified by S1 — assumed to exist with the new signature)
  why: "S1's new resolveLastTurn signature is `(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }` — the `opts` param is GONE. S2's line 444 call MUST become `resolveLastTurn(messages, toolCallId)` to consume it. After S1 (pre-S2), line 444 has TS2554 (3 args, 2 expected) + TS2345 (object where string expected) — both EXPECTED, both resolved by S2."
  pattern: "resolveLastTurn always keeps iLastUser (loop starts at iLastUser+1) — the guardrail holds by construction. A last_turn K=0 means 'no agent work after the latest user message' → a legitimate success, NOT a refusal (that's why the BUG-006 block is dead and must go)."
  gotcha: "Do NOT edit transforms.ts in S2 (S1 owns it — parallel subtask, merge-conflict risk). S1 also fixed the filterPipeline call site internally, so transforms.ts is self-consistent after S1."

- file: src/markers.ts
  why: "Defines RewindMarkerInput.options (line ~60): `{ to_previous_prompt?: boolean; protect?: string[] }`. S2's simplified payload `options: { protect }` is ASSIGNABLE (to_previous_prompt is optional). markers.ts line 60 stays optional (S3's job — legacy field for old persisted markers; resolver ignores it)."
  pattern: "The payload is cast `as RewindMarkerInput` at the appendRewindMarker call (rewind.ts ~line 630). Even if options shape differed, the cast absorbs it — but here no cast is needed because `{ protect }` ⊆ the options type."
  gotcha: "Do NOT edit markers.ts in S2 (S3 owns it). The field staying optional means S2's `{ protect }` payload typechecks with NO cast change. Old persisted markers carrying to_previous_prompt are read harmlessly (forward-compat)."

- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 2 is the authoritative touchpoint list. It enumerates EXACTLY the 4 rewind.ts edits (schema line 109-114, call site line 444, BUG-006 block lines 605-610, payload.options lines 618-629) + confirms REWIND_DESC needs no change. §Backward Compatibility confirms old persisted markers are read harmlessly."
  critical: "Confirms the checkpoint-granularity path is RETAINED (the agent still rewinds to user-set checkpoints). Only to_previous_prompt is removed. Confirms the 39 test occurrences are a SEPARATE task (S4) — S2 does not touch tests."

- file: plan/007_67d7d8c6e4c5/P1M1T1S1/PRP.md
  why: "The CONTRACT. It specifies the new resolveLastTurn signature `(messages, excludeToolCallId?)`, confirms S1 leaves rewind.ts:444 UNCHANGED (the expected TS2554/TS2345 owned by S2), and confirms markers.ts options.to_previous_prompt stays optional (S3)."
  critical: "S1's bar was 'tsc errors only in rewind.ts + test files; NONE originating in transforms.ts.' S2's bar is 'NO error originating in rewind.ts' (S2 clears the rewind.ts errors S1 left). The remaining test errors are S4's."

- spec: spec/05-tools.md §1 (Parameter schema, h3.21) + spec/13 §1 (guardrail, h2.127)
  why: "spec/05 §1 (h3.21) is the AUTHORITATIVE 3-field RewindParams (note + granularity + checkpoint? — NO to_previous_prompt). Match it exactly. spec/13 §1 (h2.127) states the guardrail: 'v1's to_previous_prompt option is removed — it discarded the latest user message.' The consented exception is checkpoint (user-set)."
  critical: "These are LLM-facing docs (Mode A). The RewindParams schema S2 produces must equal spec/05 §1 (h3.21) structurally."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  tools/rewind.ts   # ← MODIFY (S2): schema (line 109-114) + call site (line 444) + BUG-006 block (593-610) + payload.options (620) + JSDoc (76)
  transforms.ts     # ← S1 (NOT this subtask): resolveLastTurn now 2-arg (no opts/nuclear)
  markers.ts        # ← S3 (NOT this subtask): options.to_previous_prompt stays optional (legacy)
test/
  tools/rewind.test.ts   # ← S4 (NOT this subtask): 11 to_previous_prompt occurrences
  transforms.test.ts     # ← S4: 13 occurrences
  edge-cases.test.ts     # ← S4: 8 occurrences
  integration/smoke.ts   # ← S4: 4 occurrences
  markers.test.ts        # ← S4: 2 occurrences
  tools/cancel.test.ts   # ← S4: 1 occurrence
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S2 MODIFIES exactly ONE source file (no test changes):
src/tools/rewind.ts   # 5 surgical edits: RewindParams JSDoc + schema field + resolveLastTurn call + BUG-006 block + payload.options
# All other files are S1 (transforms.ts) / S3 (markers.ts) / S4 (tests) — NOT touched here.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (REWIND_DESC needs NO edit — verified). The current REWIND_DESC (lines ~132-134) reads
//   "...Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the
//   whole turn from the user's last message." — it NEVER mentioned to_previous_prompt. grep -c confirms zero
//   to_previous_prompt/previous-prompt matches in the REWIND_DESC string. Leave it byte-for-byte. (The item
//   contract explicitly says "no change needed there.")

// CRITICAL GOTCHA #2 (remove the ENTIRE (5b) block — comment + code, lines 593-610). The block is NOT just the
//   `if` statement; it starts with a ~12-line `// (5b) protected-refusal check` comment (referencing BUG-006,
//   nuclear-first-user, to_previous_prompt) and ends with the if's closing `}`. Leaving the comment while removing
//   the if (or vice versa) leaves a stale lie. Remove from `// (5b) protected-refusal check` (line 593) through the
//   `}` that closes the if (line 610). The block sits between the resolvePreview catch's closing `}` (line 592) and
//   the `// (6) render note` comment (line 612).

// CRITICAL GOTCHA #3 (the BUG-006 block is dead code, not a behavior regression). With to_previous_prompt removed,
//   `params.to_previous_prompt === true` is ALWAYS false → the if never fires. resolveLastTurn (S1) always keeps
//   iLastUser (no nuclear mode), so a last_turn K=0 means "no agent work after the latest user message" → a
//   LEGITIMATE success (K=0 honesty, step 8), NOT a refusal. The guardrail now holds BY CONSTRUCTION (S1), not via
//   this runtime check. Removing the block is correct and safe.

// CRITICAL GOTCHA #4 (the checkpoint-granularity path is RETAINED). Do NOT touch the checkpoint branch of
//   resolvePreview (line ~446: resolveCheckpoint dispatch) or the checkpointExist check (~line 525) or the
//   checkpoint-consumption block (step 7b). The agent still rewinds TO user-set checkpoints — that is the consented
//   v1.1 way to rewind across user messages. Only the to_previous_prompt nuclear option is removed.

// CRITICAL GOTCHA #5 (payload.options `{ protect }` is assignable — no cast change). RewindMarkerInput.options
//   (markers.ts:60) is `{ to_previous_prompt?: boolean; protect?: string[] }`. S2's `{ protect: config.rewind.protectedRoles }`
//   is a subset (to_previous_prompt optional) → assignable with NO cast. The existing `as RewindMarkerInput` cast at
//   the appendRewindMarker call (for the `checkpoint` field, GOTCHA #1 in the file) stays; it is unrelated to this change.

// CRITICAL GOTCHA #6 (EXPECT downstream test breakage — do NOT chase it). After S2, the 39 to_previous_prompt test
//   occurrences (across 6 files) will fail tsc and/or vitest — owned by S4 (P1.M1.T1.S4). S2's bar: rewind.ts itself
//   is clean (grep clean + no tsc error citing rewind.ts). Do NOT edit any test file in S2 (scope creep + merge-conflict
//   risk with the parallel S3/S4 work).

// CRITICAL GOTCHA #7 (scope — S2 is rewind.ts ONLY). Do NOT touch transforms.ts (S1), markers.ts (S3), config.ts,
//   index.ts, the checkpoint tool, nudges.ts, or any test. S2 is the rewind TOOL: schema + call site + dead block +
//   payload. The `makeRewindTool` factory, `RewindDetails`, `refusal()`, `MUTATION_WARNING`, `successText`, and all
//   the preview/guard helpers are UNCHANGED.
```

## Implementation Blueprint

### Data models and structure

**No data-model change beyond the schema literal.** `RewindParams` loses one field (`to_previous_prompt`); `Static<typeof RewindParams>` (`RewindArgs`) auto-updates. The persisted marker `options` (markers.ts, S3) keeps `to_previous_prompt?` optional for legacy reads — S2 just stops *emitting* it.

```typescript
// The structural contract: after S2, Static<typeof RewindParams> === { note: NoteInput; granularity: Granularity; checkpoint?: string }.
//   (No to_previous_prompt.) This matches spec/05 §1 (h3.21) exactly.
// The persisted payload.options becomes { protect: string[] } — assignable to RewindMarkerInput.options (to_previous_prompt optional).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT RewindParams schema (rewind.ts lines 109-114) — remove the to_previous_prompt field
  - DELETE the entire field block:
      to_previous_prompt: Type.Optional(
        Type.Boolean({
          description:
            "Only for granularity=last_turn. If true, also discard the most recent user message (nuclear: you abandon the current ask entirely). Default false.",
        }),
      ),
  - The resulting schema has exactly: note, granularity, checkpoint (matches spec/05 §1 h3.21).
  - GOTCHA: this is a clean delete of the field + its description. The `note` / `granularity` / `checkpoint` fields are UNCHANGED.
    Do NOT reorder or reformat the surviving fields.
  - DEPENDENCIES: none.

Task 2: EDIT the RewindParams JSDoc (rewind.ts line 76) — drop to_previous_prompt from the Static<> summary
  - CURRENT (line 76): "`Static<typeof RewindParams>` === `{ note: NoteInput, granularity, to_previous_prompt?, checkpoint? }`."
  - TARGET: "`Static<typeof RewindParams>` === `{ note: NoteInput, granularity, checkpoint? }`."
  - GOTCHA: only the `, to_previous_prompt` token is removed. Keep the rest of the JSDoc sentence + the "EXPORTED for tests" clause.
  - DEPENDENCIES: Task 1.

Task 3: EDIT the resolveLastTurn call site (rewind.ts line 444) — consume S1's 2-arg signature
  - CURRENT (line 444):
      remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;
  - TARGET:
      remove = resolveLastTurn(messages, toolCallId).remove;
  - This resolves the S1-left TS2554 (3 args, 2 expected) + TS2345 (object where string expected).
  - GOTCHA: S1's signature is `(messages, excludeToolCallId?)`. `toolCallId` is already in scope (resolvePreview's 3rd param).
    The `.remove` accessor stays (resolveLastTurn returns `{ remove: number[] }`).
  - DEPENDENCIES: Task 1 (so params.to_previous_prompt is gone — though this line no longer references it either way) + S1's transforms.ts.

Task 4: REMOVE the (5b) BUG-006 refusal block (rewind.ts lines 593-610)
  - DELETE the ENTIRE block — the comment + the if/refuse:
      // (5b) protected-refusal check — spec/08 E3 ... BUG-006 ... nuclear ... to_previous_prompt ...
      if (granularity === "last_turn" && params.to_previous_prompt === true && k === 0) {
        return refuse(
          "would cross a protected message (to_previous_prompt would rewind across the first/only user message — the original task)",
          "last_turn",
        );
      }
  - Remove from `// (5b) protected-refusal check` (line 593) through the if's closing `}` (line 610). The result: the
    resolvePreview catch's `}` (line 592) is immediately followed by a blank line + the `// (6) render note` comment (line 612).
  - GOTCHA (GOTCHA #2 + #3): remove the COMMENT too, not just the if. The block is dead code (params.to_previous_prompt
    is gone → the AND is always false) AND resolveLastTurn (S1) never produces the nuclear-first-user empty remove, so a
    last_turn K=0 is a legitimate success. The guardrail holds by construction now.
  - DEPENDENCIES: Task 1 (params.to_previous_prompt removed → the if is structurally unreachable, confirming it's safe to delete).

Task 5: EDIT payload.options (rewind.ts line 620) — stop emitting to_previous_prompt
  - CURRENT (line 620):
      options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
  - TARGET:
      options: { protect: config.rewind.protectedRoles },
  - GOTCHA (GOTCHA #5): `{ protect }` is assignable to RewindMarkerInput.options (to_previous_prompt optional). The existing
    `as RewindMarkerInput` cast at the appendRewindMarker call (for the `checkpoint` field) stays; it is unrelated.
  - DEPENDENCIES: Task 1 (params.to_previous_prompt removed).

Task 6: VALIDATE (no new code)
  - GREP: `grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts` → ZERO matches (all 7 to_previous_prompt refs + 5 nuclear refs gone).
  - RUN `npx tsc --noEmit` → NO error citing src/tools/rewind.ts. The S1-left TS2554/TS2345 at line 444 are resolved.
    Remaining errors are EXPECTED in test/* (39 occurrences, S4) — do NOT chase them. (markers.ts has no error — S3 keeps the field optional.)
  - DO NOT run `npx vitest run` expecting green — it WILL fail until S4 (test fixtures reference the removed field). You MAY run
    test/tools/rewind.test.ts to CONFIRM the failures are exactly the to_previous_prompt ones (sanity check, not a gate).
  - DEPENDENCIES: Tasks 1-5.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): removing a typebox field is a clean delete — Static<typeof RewindParams> auto-updates.
//   Before: { note, granularity, to_previous_prompt?, checkpoint? }. After: { note, granularity, checkpoint? }.
//   This matches spec/05 §1 (h3.21) exactly (the spec schema has no to_previous_prompt).

// PATTERN (Task 3): S1's signature is (messages, excludeToolCallId?) — the opts object is GONE.
//   OLD: resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove
//   NEW: resolveLastTurn(messages, toolCallId).remove
//   resolveLastTurn always keeps iLastUser now (S1) — the guardrail holds by construction.

// PATTERN (Task 4): dead-block removal — the AND is structurally impossible after Task 1.
//   `granularity === "last_turn" && params.to_previous_prompt === true && k === 0`
//   → params.to_previous_prompt is `undefined` (field removed) → `undefined === true` is `false` → AND always false.
//   The if NEVER fires. Remove comment + if together (GOTCHA #2).

// CRITICAL walk-through (why a last_turn K=0 is now a SUCCESS, not a refusal):
//   Before S1+S2: a nuclear last_turn (to_previous_prompt:true) across the first/only user → resolveLastTurn returned
//     {remove:[]} (iFirstUser===iLastUser) → k===0 → BUG-006 refused "would cross a protected message".
//   After S1+S2: no nuclear mode. resolveLastTurn keeps iLastUser (loop from iLastUser+1). A last_turn K=0 means
//     "nothing after the latest user message to hide" → step 8 reports K=0 honestly as a success. The guardrail
//     (never wipe user input) holds by construction — no runtime refusal needed.

// CRITICAL: the persisted options simplify to { protect } — old markers carrying to_previous_prompt are read
//   harmlessly (markers.ts keeps the field optional for legacy; the resolver ignores it). Forward-compatible.
```

### Integration Points

```yaml
CODE:
  - modify: src/tools/rewind.ts ONLY (5 edits: JSDoc line 76, schema lines 109-114, call site line 444, BUG-006 block lines 593-610, payload.options line 620)
  - untouched: REWIND_DESC (no to_previous_prompt mention), makeRewindTool, RewindDetails, refusal(), MUTATION_WARNING,
    successText, all preview/guard helpers, the checkpoint-granularity path (resolvePreview checkpoint branch +
    checkpointExists + step 7b consumption), steps 1-4/5/6/7b/8 of rewindExecute
DOWNSTREAM (later subtasks — NOT this one):
  - S1 (P1.M1.T1.S1): src/transforms.ts — resolveLastTurn 2-arg (parallel, assumed landed)
  - S3 (P1.M1.T1.S3): src/markers.ts — options.to_previous_prompt stays optional (legacy JSDoc)
  - S4 (P1.M1.T1.S4): 39 test occurrences across 6 files (fixtures/assertions updated)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config field (to_previous_prompt was a tool param, not config); no persistence migration (forward-compatible —
    old markers read harmlessly); no registration change (makeRewindTool unchanged).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# The cheapest, most decisive gate — confirms every touchpoint is done:
grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts   # EXPECTED: no output (zero matches)

# Full project typecheck — EXPECTED downstream errors, NOT a clean run:
npx tsc --noEmit
# EXPECTED: errors ONLY in the test files that still reference to_previous_prompt (test/tools/rewind.test.ts,
#   test/transforms.test.ts, test/edge-cases.test.ts, test/integration/smoke.ts, test/markers.test.ts,
#   test/tools/cancel.test.ts — 39 occurrences total, all owned by S4).
# YOUR bar: NO error line cites `src/tools/rewind.ts`. rewind.ts is internally consistent (3-field schema matching
#   spec/05 §1, 2-arg resolveLastTurn call, no dead BUG-006 block, { protect } options). If rewind.ts DOES appear in
#   an error, you left a touchpoint half-done (e.g. removed the schema field but left params.to_previous_prompt at line
#   444/605/620) — fix YOUR file. Do NOT "fix" the test/* errors here (they are S4).
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A as a GREEN gate for S2: test/tools/rewind.test.ts WILL FAIL after S2 (11 to_previous_prompt occurrences in
#   fixtures/assertions — VALID_NOTE options, the nuclear BUG-006 test, the RewindArgs type test, persisted-options
#   assertions). Those failures are EXPECTED and owned by S4 (P1.M1.T1.S4).
#
# You MAY run it as a SANITY CHECK to confirm the failures are exactly the to_previous_prompt-related ones (no surprise
# failures in unrelated rewind tests):
npx vitest run test/tools/rewind.test.ts
# EXPECTED: failures limited to the to_previous_prompt cases (options assertions, nuclear test, type test). If a
#   DIFFERENT rewind test fails (e.g. a depth/retry/context-fraction/checkpoint case broke), that's an S2 bug —
#   investigate (you likely removed more than the 5 touchpoints). Do NOT update the tests in S2 (that's S4).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S2: there is no live runtime seam to exercise — the schema/behavior change is LLM-facing (what the agent
#   sees) + type-level (RewindArgs) + persistence (options). The end-to-end "agent can't pass to_previous_prompt and
#   a last_turn keeps the user message" validation belongs to S4 (tests). No server/endpoint to curl.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Schema-parity check against the spec (optional — proves the schema matches spec/05 §1 h3.21 byte-for-byte):
#   diff the RewindParams block against spec/05 §1 (h3.21). A quick structural grep:
#     grep -nE "to_previous_prompt|note:|granularity:|checkpoint:" src/tools/rewind.ts | head
#   Expected: note/granularity/checkpoint present; to_previous_prompt ABSENT. The granularity description still lists
#   the 3 literals (last_tool_call_group / last_turn / checkpoint). The checkpoint description is unchanged.
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -nE "to_previous_prompt|nuclear" src/tools/rewind.ts` → zero matches.
- [ ] `npx tsc --noEmit` → NO error originating in `src/tools/rewind.ts` (the S1-left TS2554/TS2345 at line 444 resolved; remaining errors are expected test-file failures, S4).

### Feature Validation

- [ ] `RewindParams` has exactly `note`, `granularity`, `checkpoint?` (no `to_previous_prompt`) — matches spec/05 §1 (h3.21).
- [ ] Line 444 reads `resolveLastTurn(messages, toolCallId).remove` (2-arg, S1's signature).
- [ ] The (5b) BUG-006 block (comment + if/refuse, lines 593-610) is entirely gone.
- [ ] `payload.options` is `{ protect: config.rewind.protectedRoles }` (no `to_previous_prompt`).
- [ ] The RewindParams JSDoc (line 76) no longer lists `to_previous_prompt?`.
- [ ] `REWIND_DESC` is byte-for-byte unchanged (it never mentioned to_previous_prompt — GOTCHA #1).
- [ ] The checkpoint-granularity path (resolvePreview checkpoint branch + checkpointExists + step 7b) is UNCHANGED.
- [ ] Steps 1–4/5/6/7b/8 of `rewindExecute`, `makeRewindTool`, `RewindDetails`, `refusal()`, `MUTATION_WARNING`, `successText` — all UNCHANGED.

### Code Quality Validation

- [ ] Only `src/tools/rewind.ts` is modified — NO edits to transforms.ts (S1), markers.ts (S3), config.ts, index.ts, or any test file (S4).
- [ ] The dead BUG-006 block is removed COMMENT + CODE together (no stale comment left behind — GOTCHA #2).
- [ ] The schema matches spec/05 §1 (h3.21) structurally (3 fields, no to_previous_prompt).

### Documentation & Deployment

- [ ] RewindParams JSDoc updated (Mode A — rides with the code): the Static<> summary no longer lists to_previous_prompt.
- [ ] No README/spec change in S2 (the spec is already v1.1 — h3.21/h2.127 reflect the removal; changeset doc sync is P3.M1.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't edit `REWIND_DESC` — it never mentioned `to_previous_prompt` (verified by grep). The item contract explicitly says "no change needed there." Editing it would drift from the spec/05 §6 verbatim string for no reason (GOTCHA #1).
- ❌ Don't remove only the BUG-006 `if` and leave its ~12-line comment — the comment references `to_previous_prompt`, BUG-006, and "nuclear-first-user", all of which are now stale. Remove the COMMENT + the if together (lines 593-610) so no lying doc remains (GOTCHA #2).
- ❌ Don't keep the BUG-006 block "just in case" — it is structurally dead code (`params.to_previous_prompt === true` is always false after Task 1), and the guardrail now holds by construction in `resolveLastTurn` (S1). Keeping a refusal for an impossible path is misleading (GOTCHA #3).
- ❌ Don't touch the checkpoint-granularity path — the agent still rewinds TO user-set checkpoints (`granularity:"checkpoint"`). That is the consented v1.1 way to rewind across user messages. Only `to_previous_prompt` (the agent-initiated nuclear option) is removed (GOTCHA #4).
- ❌ Don't change the `as RewindMarkerInput` cast or worry about the options type — `{ protect }` is assignable to `RewindMarkerInput.options` (to_previous_prompt is optional). The cast stays for the unrelated `checkpoint` field (GOTCHA #5).
- ❌ Don't edit transforms.ts (S1), markers.ts (S3), or any test file (S4) — those are parallel/sibling subtasks. Touching them crosses task boundaries and risks merge conflicts (GOTCHA #6, #7).
- ❌ Don't expect a green `npx vitest run` — the 39 test occurrences will fail until S4. S2's gates are the grep (to_previous_prompt/nuclear gone) + tsc (no error citing rewind.ts), NOT a green suite.
- ❌ Don't paraphrase the surviving schema fields — `note`, `granularity`, `checkpoint` and their descriptions stay byte-for-byte (they already match spec/05 §1 h3.21). Only `to_previous_prompt` is removed.

---

## Decision Log

- **D1 — `REWIND_DESC` is unchanged (verified, not assumed).** grep confirmed zero `to_previous_prompt`/`previous prompt` matches in the REWIND_DESC string. The current text ("...or 'last_turn' to redo the whole turn from the user's last message.") is already guardrail-compliant — it describes `last_turn` as re-landing at the user's last message, which is exactly the kept-iLastUser behavior. The item contract explicitly says "no change needed there." Editing it would risk drifting from the spec/05 §6 verbatim LLM-facing doc.

- **D2 — Remove the BUG-006 block entirely (comment + code), not just the if.** The block (lines 593-610) is a ~12-line comment explaining the nuclear-first-user refusal + the `if (granularity === "last_turn" && params.to_previous_prompt === true && k === 0)` guard. After Task 1 removes `to_previous_prompt` from the schema, `params.to_previous_prompt === true` is always `false` → the if is dead code. And S1's `resolveLastTurn` no longer has nuclear mode, so a `last_turn` K=0 is a legitimate "nothing after the latest user message" success (reported honestly per step 8), not a refusal. The guardrail (never wipe user input) now holds BY CONSTRUCTION in the resolver. Leaving the comment while removing the if (or keeping both) would leave a stale lie about the implementation. Remove comment + if together.

- **D3 — The persisted `options` simplify to `{ protect }`; markers.ts keeps `to_previous_prompt?` optional (S3).** S2 stops *emitting* `to_previous_prompt` in the payload, but markers.ts (S3) keeps the field OPTIONAL on `RewindMarkerInput.options` so old persisted markers (v1.0, carrying `to_previous_prompt`) type-check and are read harmlessly — the resolver ignores it (S1). This is forward-compatible (no migration). S2's `{ protect }` payload is assignable to the options type with no cast change (to_previous_prompt optional).

---