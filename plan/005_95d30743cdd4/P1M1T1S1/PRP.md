# PRP — P1.M1.T1.S1: `CancelParams` schema (target-union) + `CANCEL_DESC` rewrite (M1 cancel-by-target, step 1/3)

---

## Goal

**Feature Goal**: Convert the `mulligan_cancel` parameter schema from id-only (`{ markerId: string }`) to the **target-based** shape that matches `mulligan_shrink`'s `target` union, and rewrite the LLM-facing `CANCEL_DESC` description string to lead with target-based identification. This is the SCHEMA + DESC half of the cancel-by-target headline change; the execute-body target resolution is S2 (P1.M1.T1.S2), and the target-behavior tests are S3.

**Deliverable**: In `src/tools/cancel.ts` — (1) a rewritten `CancelParams` typebox schema with the 3-arm `target` union + the now-optional `markerId` fallback, (2) the updated `CANCEL_DESC` verbatim string, (3) `CancelArgs = Static<typeof CancelParams>` (unchanged derivation). No execute-body change.

**Success Definition**:
- `npx tsc --noEmit` — NO new errors originate from `src/tools/cancel.ts` or `test/tools/cancel.test.ts`.
- `npx vitest run test/tools/cancel.test.ts` — all existing tests pass (they call `{markerId: "…"}` which remains valid — see Decision D1).
- `npx vitest run` — full suite passes.
- `CancelParams.target` is structurally identical to `ShrinkParams.target` (same 3 arms, same `Type.Union([Type.Literal("last"), Type.Literal("first")])` occurrence arm).

## User Persona (if applicable)

**Target User**: The coding agent (LLM) that calls `mulligan_cancel`, and the maintainer reading spec/05 §5.

**Use Case**: The agent issued a mis-targeted rewind/shrink and needs to undo it. It should identify the mistaken marker by the **content it affected** (a `target` hint) rather than by a fragile opaque id — because the toolkit's own shrink/rewind can hide the message that carried the `markerId`.

**User Journey**: Agent calls `mulligan_cancel({ target: { by_tool_name: "read", occurrence: "last" } })` → (S2 resolves the target to the covering marker) → confirmation text. The `markerId` explicit id remains available as a fallback.

**Pain Points Addressed**: An id captured at issue-time is fragile by construction (the message carrying it can be hidden/shrunk). A content/role `target` hint re-resolves live each turn — the same compaction-robustness `mulligan_shrink` already enjoys.

## Why

- **Business value / user impact**: This is the schema foundation of the headline cancel-by-target change (M1). The agent can now retract a mistaken marker by describing the content it affected, instead of tracking an opaque entry id that may have been hidden. S1 alone ships no behavior change (the execute body still reads `markerId` until S2), but it defines the contract S2/S3 build on.
- **Integration with existing features**: `target` is the SAME union `mulligan_shrink` uses — so the agent reuses one learned hint shape across two tools, and S2 reuses the SAME pure resolver (`resolveShrinkTarget` in transforms.ts). The `markerId` fallback preserves the existing id-based path and its tests verbatim.
- **Problems this solves and for whom**: For the agent: a robust, compaction-proof way to name the marker to retract. For maintainers: schema parity with shrink (one canonical target union, not two).

## What

User-visible behavior: NONE in S1 (the schema accepts `target`, but `cancelExecute` still resolves only `markerId` until S2). The LLM-facing `CANCEL_DESC` text changes to describe the target-based API. Type-wise, `CancelArgs` gains an optional `target` and `markerId` becomes optional.

### Success Criteria

- [ ] `CancelParams` has a `target` field whose union is structurally identical to `ShrinkParams.target` (3 arms: `by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`), with the cancel-specific descriptions.
- [ ] `markerId` is `Type.Optional(Type.String({...}))` (the explicit-id fallback; "markerId wins if both given").
- [ ] `target` is ALSO `Type.Optional(...)` — see Decision D1 (the spec's literal "required target" contradicts its own "At least one MUST be present" prose + acceptance-(a)'s "OR by explicit markerId"; both-optional is the only schema that admits markerId-ALONE, which Pi's tool runtime would otherwise reject).
- [ ] `CANCEL_DESC` equals the spec/05 §6 verbatim string (see Task 2).
- [ ] `CancelArgs = Static<typeof CancelParams>` derivation unchanged.
- [ ] `cancelExecute`, `CancelDetails`, `refusal()`, `readOwn`/`isRecord` UNCHANGED.
- [ ] `npx tsc --noEmit` shows no new errors from the touched files; `npx vitest run test/tools/cancel.test.ts` and `npx vitest run` pass.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current code, the exact reference shape (`ShrinkParams.target`), the exact target schema with every description string, the exact verbatim `CANCEL_DESC`, the resolved schema-arity decision (D1), and the precise file/line locations. No external documentation is required.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/tools/cancel.ts
  why: "THE file being modified. CancelParams is at ~line 70 (Type.Object({ markerId: Type.String({...}) })); CancelArgs at ~line 80; CANCEL_DESC at ~line 86 (the multi-line string concatenation). cancelExecute (the body) is OUT OF SCOPE for S1 — leave it reading params.markerId (S2 rewrites it)."
  pattern: "imports already include `import { Type } from 'typebox'` and `import type { Static } from 'typebox'` — NO new imports needed for S1 (Type.Union/Type.Object/Type.Literal/Type.Optional/Type.String are all on the already-imported Type)."
  gotcha: "CancelParams/CANCEL_DESC/CancelArgs are EXPORTED (consumed by test/tools/cancel.test.ts imports + index.ts wiring). Keep them exported. Do NOT touch CancelDetails, refusal(), readOwn, isRecord, cancelExecute, makeCancelTool."

- file: src/tools/shrink.ts
  why: "THE reference for the target union shape. ShrinkParams.target is at lines ~62-76. CancelParams.target must be STRUCTURALLY IDENTICAL (same 3 arms, same Type.Union([Type.Literal('last'), Type.Literal('first')]) occurrence arm with NO description), differing ONLY in the description strings (cancel talks about 'a message the marker affected', shrink talks about 'the result to shrink')."
  pattern: "Type.Union([ Type.Object({by_tool_call_id: Type.String({description:...})}), Type.Object({by_tool_name: Type.String({description:...}), occurrence: Type.Union([Type.Literal('last'), Type.Literal('first')])}), Type.Object({by_content_includes: Type.String({description:...})}) ], { description: ... })"
  gotcha: "In shrink.ts, `target` is REQUIRED (not Optional) because shrink ALWAYS needs a target. Cancel is DIFFERENT (Decision D1): cancel's target must be Optional so markerId-ALONE remains a valid call. Do NOT blindly copy shrink's required-target arity."

- file: plan/005_95d30743cdd4/architecture/m1_cancel_target_resolution.md
  why: "The M1 design doc. §'New CancelParams schema' gives the target-union + optional markerId (spec/05 §5 verbatim). §'Target resolution → marker uuid' is S2's job (NOT S1) — read it only to understand WHY the schema has a target (so the execute body can resolve it live each turn), not to implement resolution here."
  critical: "Confirms `resolveShrinkTarget` (transforms.ts:758, EXPORTED, pure, Pi-free) is the resolver S2 will reuse — so the schema's target union MUST match ShrinkTarget exactly or S2's handoff breaks. Structural identity with ShrinkParams.target is therefore a hard requirement, not cosmetic."

- file: plan/005_95d30743cdd4/architecture/spec_cancel.md
  why: "Contains the EXACT verbatim strings. Line 19 = the target-union description. Line 38 = the full CANCEL_DESC verbatim string (spec/05 §6). Lines 40-50 = the current-vs-new CANCEL_DESC diff (the middle sentence changes)."
  critical: "Use the CANCEL_DESC at line 38 VERBATIM. The ONLY sentence that changes vs the current code is the middle one (old: 'Pass the markerId you received in details when you issued the marker.' → new: 'Identify the marker by `target` (same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one.')."

- file: test/tools/cancel.test.ts
  why: "Confirms S1's test blast radius. The existing tests all call run(pi, ctx, {markerId: '…'}) (cases at lines ~212, 240, 257, 293, 325, 343). There is NO registration-metadata describe block asserting CANCEL_DESC verbatim or the schema shape — so S1's CANCEL_DESC change breaks NO existing assertion."
  pattern: "run(pi, ctx, params: CancelArgs) helper at ~line 104. With Decision D1 (both params optional), {markerId:'…'} still conforms to CancelArgs → all existing tests typecheck and pass unchanged."
  gotcha: "CancelParams + CANCEL_DESC are imported at lines 28-29 but appear UNUSED in assertions (no metadata test). S1 may OPTIONALLY add a registration-metadata test (mirror test/tools/audit.test.ts) to lock in the new CANCEL_DESC verbatim + schema — recommended, not required."
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/tools/
  cancel.ts    # ← MODIFY: CancelParams schema (~line 70) + CANCEL_DESC (~line 86). Leave cancelExecute alone.
  shrink.ts    # ← READ-ONLY reference for the target union shape (ShrinkParams.target ~lines 62-76)
  rewind.ts, checkpoint.ts, audit.ts   # ← untouched
test/tools/
  cancel.test.ts   # ← OPTIONAL: add a registration-metadata test (no existing test breaks under Decision D1)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This subtask MODIFIES exactly one source file (no test changes REQUIRED; one optional test addition):
src/tools/cancel.ts        # CancelParams (target-union + optional markerId) + CANCEL_DESC (verbatim) + CancelArgs
test/tools/cancel.test.ts  # OPTIONAL: add registration-metadata test asserting the new CANCEL_DESC + schema shape
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (THE schema-arity decision — read Decision D1 in full). The spec/contract shows
//   `target: Type.Union([...])` (NOT wrapped in Type.Optional) while markerId IS Optional. Taken literally,
//   target becomes STRUCTURALLY REQUIRED. But the spec's own object description says "At least one MUST be
//   present", acceptance (a) says cancel works "by target OR by explicit markerId", and E21 calls markerId
//   "an optional fallback for hosts that surface details.markerId" — all of which require markerId-ALONE
//   to be a VALID call. If target is required, Pi's tool runtime REJECTS a markerId-only call before execute
//   ever runs (the tool infra validates params against the registered schema). That would BREAK the documented
//   fallback path. RESOLUTION (Decision D1): make BOTH target and markerId Optional; enforce "at least one
//   MUST be present" in cancelExecute (S2's job). This also keeps S1 self-contained: existing {markerId:'…'}
//   tests continue to typecheck and pass with ZERO changes. Flag this deviation in the commit/PR for review.

// CRITICAL GOTCHA #2 (S1 is SCHEMA + DESC ONLY — do not touch the execute body). cancelExecute currently
//   reads params.markerId at step 3 (the entry.id → data.id uuid mapping). After S1, params.markerId is
//   `string | undefined`. When undefined (agent passed only target), `readOwn(e,"id") !== undefined` is true
//   for every real entry → never matches → targetUuid stays null → the existing "no active marker found"
//   no-op path fires. This is the EXPECTED intermediate state (S2 wires target resolution). Do NOT try to
//   make cancelExecute handle target in S1 — that is P1.M1.T1.S2.

// CRITICAL GOTCHA #3 (structural identity with ShrinkParams.target is a HARD requirement). S2 hands
//   params.target to `resolveShrinkTarget(messages, target)` (transforms.ts:758), whose `target` param is
//   typed `ShrinkTarget` (the transforms.ts discriminated union). If CancelParams.target diverges from
//   ShrinkParams.target (e.g. a renamed discriminator, a missing arm, a different occurrence literal set),
//   the S2 handoff `resolveShrinkTarget(messages, params.target)` will NOT typecheck. Copy the union shape
//   from shrink.ts EXACTLY (only the description strings differ).

// CRITICAL GOTCHA #4 (no new imports). `import { Type } from "typebox"` is already at the top of cancel.ts.
//   Type.Object / Type.Optional / Type.Union / Type.Literal / Type.String are all members of that Type.
//   Do NOT add a typebox import or a transforms.ts import in S1 (resolveShrinkTarget is S2's import).

// CRITICAL GOTCHA #5 (CANCEL_DESC is a single string, currently multi-line-concatenated). The current code
//   builds it as `"..." + "..." + ...` across lines. Keep that style (or a single template literal) — but
//   the RESULT must equal the spec verbatim string BYTE-FOR-BYTE (whitespace/newlines inside the quoted
//   segments only; no stray newlines in the final string). The string is the LLM-facing doc (Mode A).

// CRITICAL GOTCHA #6 (the occurrence arm has NO description in shrink, and none in the cancel spec).
//   `occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")])` — do NOT add a description to
//   occurrence; match shrink.ts exactly (it has none). The by_tool_name description "e.g. 'read', 'bash'"
//   is IDENTICAL to shrink's — copy it verbatim.
```

## Implementation Blueprint

### Data models and structure

No data models change. The only "model" is the typebox schema (`CancelParams`) and its `Static` derivation (`CancelArgs`). `CancelDetails`, the marker shapes, and `CancelMarkerInput` (in markers.ts) are all untouched.

```typescript
// The structural contract S2 depends on: CancelParams.target ≡ ShrinkParams.target (same 3-arm union).
// Static<typeof CancelParams> (CancelArgs) becomes, after S1:
//   { target?: { by_tool_call_id: string } | { by_tool_name: string; occurrence: "last"|"first" } | { by_content_includes: string };
//     markerId?: string }
// (both optional per Decision D1; "at least one" enforced in cancelExecute by S2.)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE CancelParams in src/tools/cancel.ts (~line 70) — the target-union + optional markerId
  - REPLACE the current schema:
      CURRENT (cancel.ts ~line 70):
        export const CancelParams = Type.Object({
          markerId: Type.String({
            description:
              "The marker id to cancel (the markerId value returned by mulligan_rewind or mulligan_shrink in details.markerId).",
          }),
        });
      TARGET (spec/05 §5 verbatim, with Decision D1 — target ALSO Optional):
        export const CancelParams = Type.Object(
          {
            target: Type.Optional(
              Type.Union(
                [
                  Type.Object({
                    by_tool_call_id: Type.String({ description: "The toolCallId of a message the marker affected." }),
                  }),
                  Type.Object({
                    by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
                    occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
                  }),
                  Type.Object({
                    by_content_includes: Type.String({
                      description: "Match a marker whose affected message(s) include this substring.",
                    }),
                  }),
                ],
                {
                  description:
                    "How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired.",
                },
              ),
            ),
            markerId: Type.Optional(
              Type.String({
                description:
                  "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins.",
              }),
            ),
          },
          {
            description:
              "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present.",
          },
        );
  - NAMING: keep `CancelParams` (exported const). Keep field names `target` + `markerId` + discriminator keys
    `by_tool_call_id` / `by_tool_name` / `occurrence` / `by_content_includes` (IDENTICAL to shrink — GOTCHA #3).
  - PLACEMENT: same location (~line 70), replacing the old schema verbatim. Update the JSDoc comment above
    CancelParams to reflect the new shape (target-union + optional markerId fallback; references spec/05 §5).
  - GOTCHA: the `Type.Object({...}, { description })` 2nd-arg object description is the object-level doc the LLM
    sees — include it VERBATIM ("Cancel accepts a `target` (preferred)...At least one MUST be present.").
  - DEPENDENCIES: none (Type is already imported).

Task 2: REWRITE CANCEL_DESC in src/tools/cancel.ts (~line 86) — the spec/05 §6 verbatim string
  - REPLACE the current CANCEL_DESC string with this VERBATIM text (from spec_cancel.md:38):
      export const CANCEL_DESC =
        "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
        "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
        "transform would apply on every turn for the rest of the session. Identify the marker by `target` " +
        "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — " +
        "the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. " +
        "The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). " +
        "Cancelling a non-existent or already-cancelled marker is a safe no-op.";
  - VERIFY byte-for-byte against spec_cancel.md:38 — the ONLY sentence that changed vs the current code is the
    middle one (GOTCHA #5). Keep the multi-line `"..." +` concatenation style (matches the current code + the
    other four tools' DESC strings).
  - UPDATE the JSDoc comment above CANCEL_DESC to note it is the spec/05 §6 verbatim string (Mode A LLM-facing).
  - DEPENDENCIES: none.

Task 3: VERIFY CancelArgs derivation (no code change — confirm it still compiles)
  - `export type CancelArgs = Static<typeof CancelParams>;` (already present, ~line 80) — UNCHANGED. After Task 1,
    CancelArgs is automatically `{ target?: <union>; markerId?: string }`. Confirm with tsc (Task 5).
  - DEPENDENCIES: Task 1.

Task 4 (OPTIONAL but RECOMMENDED): ADD a registration-metadata test to test/tools/cancel.test.ts
  - There is currently NO metadata test in cancel.test.ts (verified: no describe block before line 212). Adding
    one locks in the S1 change and mirrors test/tools/audit.test.ts's convention. Add at the TOP of the test
    file (after the imports, before the fakes), a describe("mulligan_cancel — registration metadata (spec/05 §5)"):
      (a) it("name === 'mulligan_cancel', label === 'Mulligan Cancel', description === CANCEL_DESC"):
            const tool = makeCancelTool(makePi().pi); expect(tool.name).toBe("mulligan_cancel");
            expect(tool.label).toBe("Mulligan Cancel"); expect(tool.description).toBe(CANCEL_DESC);
      (b) it("CANCEL_DESC is the spec/05 §6 verbatim string"): expect(CANCEL_DESC).toBe("<paste Task 2 string>").
      (c) it("parameters === CancelParams"): expect(tool.parameters).toBe(CancelParams).
      (d) it("CancelArgs type has optional target + optional markerId (type-level)"):
            expectTypeOf<{ target?: unknown; markerId?: string }>().toMatchTypeOf<CancelArgs>() (and vice-versa).
  - NAMING: mirror audit.test.ts's registration-metadata describe titles.
  - GOTCHA: makePi() in this file returns {appended, pi} — use makePi().pi for the factory. This describe block
    is pure metadata (no ctx needed) — it does NOT call execute.
  - DEPENDENCIES: Tasks 1-2. (If you skip this task, S1 still succeeds — the existing behavior tests pass unchanged.)

Task 5: VALIDATE (no new code)
  - RUN `npx tsc --noEmit` → NO new errors from src/tools/cancel.ts or test/tools/cancel.test.ts. (Any pre-existing
    errors elsewhere are out of scope — your bar is "no NEW errors from the files I touched".)
  - RUN `npx vitest run test/tools/cancel.test.ts` → all pass (existing {markerId:'…'} calls remain valid under
    Decision D1; the optional new metadata test passes too).
  - RUN `npx vitest run` → full suite passes (no regressions).
  - DEPENDENCIES: Tasks 1-3 (Task 4 if added).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the target union is copied from shrink.ts with cancel-specific descriptions.
//   STRUCTURE (3 arms + occurrence literal union) is IDENTICAL to ShrinkParams.target — only descriptions differ.
//   This structural identity is what lets S2 hand params.target to resolveShrinkTarget (ShrinkTarget-typed).
//
//   shrink.ts by_tool_call_id desc:  "The toolCallId of the result to shrink."
//   cancel by_tool_call_id desc:     "The toolCallId of a message the marker affected."   ← different
//
//   shrink.ts by_content_includes:   "Shrink the (first) message whose text contains this substring."
//   cancel by_content_includes:      "Match a marker whose affected message(s) include this substring."  ← different
//
//   by_tool_name desc:  "e.g. 'read', 'bash'"   ← IDENTICAL (copy verbatim)
//   occurrence:         Type.Union([Type.Literal("last"), Type.Literal("first")])  ← IDENTICAL, NO description

// DECISION D1 — why target is Optional (not required, despite the spec's literal `target: Type.Union(...)`):
//   The spec is self-inconsistent: structural "target required" vs prose "At least one MUST be present" +
//   acceptance-(a) "by target OR by explicit markerId" + E21 "markerId ... optional fallback". The behavioral
//   prose is authoritative — markerId-ALONE must be a valid call. If target were required, Pi's tool runtime
//   would REJECT mulligan_cancel({markerId:"x"}) before execute runs, breaking the fallback. Making both
//   optional + enforcing "at least one" in cancelExecute (S2) is the only schema that honors all the prose.
//   Bonus: existing {markerId:'…'} tests typecheck unchanged → S1 is self-contained.

// PATTERN (Task 2): CANCEL_DESC diff — ONLY the middle sentence changes.
//   OLD middle: "Pass the markerId you received in details when you issued the marker."
//   NEW middle: "Identify the marker by `target` (same hint shape as mulligan_shrink: by_tool_call_id,
//                by_tool_name+occurrence, or by_content_includes) — the most recent marker affecting that
//                content is retired; or pass an explicit `markerId` if you have one."
//   First sentence + last two sentences are UNCHANGED. Keep the "safe no-op" closing sentence verbatim.
```

### Integration Points

```yaml
CODE:
  - modify: src/tools/cancel.ts — CancelParams (~line 70) + CANCEL_DESC (~line 86) + the JSDoc above each
  - untouched: cancelExecute, CancelDetails, refusal(), readOwn/isRecord, makeCancelTool, all imports
TESTS:
  - optional add: test/tools/cancel.test.ts — registration-metadata describe (no existing test requires changing)
  - S3 (later): adds the target-based behavior tests (P1.M1.T1.S3)
DOWNSTREAM (S2, NOT this subtask):
  - S2 imports resolveShrinkTarget from ../transforms.js and rewrites cancelExecute step 3 to resolve params.target
    → covering marker → uuid. S1's target union MUST match ShrinkTarget for that handoff to typecheck (GOTCHA #3).
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config knob (cancel has no sub-gate — GOTCHA #6 in the file header). No registration change (makeCancelTool unchanged).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit
# EXPECTED: no NEW errors from src/tools/cancel.ts or test/tools/cancel.test.ts.
# Common S1 mistakes tsc catches:
#   - a typo in a discriminator key (by_tool_call_id → breaks the union shape)
#   - forgetting Type.Optional on target → CancelArgs requires target → existing {markerId:'…'} test calls
#     error with TS2741 "Property 'target' is missing" (this is the Decision D1 trap — re-wrap target in Optional)
#   - a stray comma/brace in the nested Type.Object/Type.Union
# Any PRE-EXISTING errors in OTHER files are out of scope — your bar is "no NEW errors from my files".
```

### Level 2: Unit Tests (Component Validation)

```bash
# The cancel test file in isolation — confirms the schema/desc change didn't regress the markerId path.
npx vitest run test/tools/cancel.test.ts
# EXPECTED: all pass. The existing cases (cancel-by-markerId, no-op, already-cancelled, disabled, never-throws)
# all call run(pi, ctx, {markerId:'…'}) — under Decision D1 (both params optional) these remain valid and the
# execute body still resolves markerId exactly as before. If you added the optional metadata test (Task 4),
# those 4 cases pass too.

# Full suite — confirm no regressions elsewhere (e.g. index.test.ts tool-registration assertions).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1: the schema change has no observable runtime behavior until S2 wires target resolution into
# cancelExecute. There is no live seam to exercise yet. (The end-to-end "cancel by target retires the marker
# and the content reappears next fire" validation belongs to S2/S3.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Structural-parity check against shrink (optional — proves S2's handoff will typecheck):
#   confirm CancelParams.target's union has the SAME 3 discriminator keys + occurrence literal set as
#   ShrinkParams.target. A quick grep:
#     grep -n "by_tool_call_id\|by_tool_name\|by_content_includes\|Type.Literal(\"last\")\|Type.Literal(\"first\")" \
#       src/tools/cancel.ts src/tools/shrink.ts
#   The discriminator keys + literal set must match between the two files (only descriptions differ).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` — no new errors from `src/tools/cancel.ts` / `test/tools/cancel.test.ts`.
- [ ] `npx vitest run test/tools/cancel.test.ts` — all pass.
- [ ] `npx vitest run` — full suite passes.

### Feature Validation

- [ ] `CancelParams.target` is a 3-arm union structurally identical to `ShrinkParams.target` (same discriminators + occurrence literals).
- [ ] Both `target` and `markerId` are `Type.Optional` (Decision D1).
- [ ] Description strings match the spec verbatim (target-union desc, markerId desc, object desc, each arm desc).
- [ ] `CANCEL_DESC` equals the spec/05 §6 verbatim string (Task 2).
- [ ] `cancelExecute`, `CancelDetails`, `refusal()`, `readOwn`/`isRecord`, `makeCancelTool`, imports — all UNCHANGED.

### Code Quality Validation

- [ ] `CancelParams` target union reuses the canonical discriminator names (`by_tool_call_id` / `by_tool_name` / `occurrence` / `by_content_includes`) — no invented keys.
- [ ] Only `src/tools/cancel.ts` is modified for code (optional test addition in `test/tools/cancel.test.ts`).
- [ ] Decision D1 (target Optional) is flagged in the commit message / PR for reviewer adjudication.
- [ ] No execute-body change leaked into S1 (target resolution is S2 / P1.M1.T1.S2).

### Documentation & Deployment

- [ ] JSDoc above `CancelParams` and `CANCEL_DESC` updated to reflect the target-based schema (Mode A — rides with the code).
- [ ] CANCEL_DESC is the LLM-facing doc — no separate doc file (README sweep is P1.M5, after M1–M4).

---

## Anti-Patterns to Avoid

- ❌ Don't make `target` structurally required (copying shrink's required-target arity blindly) — that makes `markerId`-ALONE schema-invalid (Pi rejects it before execute), breaking the documented fallback + acceptance-(a). Make BOTH optional; enforce "at least one" in cancelExecute (S2). See Decision D1.
- ❌ Don't invent discriminator keys or rename the occurrence literals — `target` must be STRUCTURALLY IDENTICAL to `ShrinkParams.target` or S2's `resolveShrinkTarget(messages, params.target)` handoff won't typecheck (`ShrinkTarget`-typed param). Copy the union shape from shrink.ts, change ONLY descriptions.
- ❌ Don't touch `cancelExecute` — S1 is schema + desc only. The execute body still reads `params.markerId`; making it handle `target` is P1.M1.T1.S2. (After S1, a target-only call harmlessly no-ops via the existing "no active marker found" path — that's the expected intermediate state.)
- ❌ Don't add a `config.cancel` sub-knob or any new import — cancel has no sub-gate (master `enabled` only), and `Type` is already imported; `resolveShrinkTarget` is S2's import, not S1's.
- ❌ Don't paraphrase `CANCEL_DESC` — paste the spec/05 §6 verbatim string. The descriptions are LLM-facing docs that drive tool usage; drift from the spec defeats the "one learned hint shape" goal. Verify byte-for-byte (only the middle sentence changed vs the old string).
- ❌ Don't add a description to the `occurrence` field — shrink.ts has none, and the spec has none; match it exactly (consistency across the two tools' shared target shape).

---

## Decision Log

- **D1 — Make BOTH `target` and `markerId` Optional (deviate from the spec's literal `target: Type.Union(...)`).** The spec/contract present `target` unwrapped (→ structurally required) while marking `markerId` Optional, yet the same spec's object description says "At least one MUST be present", acceptance criterion (a) (E21) says cancel works "by target (content/role hint) **OR** by explicit `markerId`", and E21 calls `markerId` "an optional fallback for hosts that surface `details.markerId`". These are mutually inconsistent ONLY if `target` is required: a required `target` makes `markerId`-ALONE schema-invalid, and Pi's tool runtime rejects schema-invalid calls *before* `execute` runs — silently breaking the documented fallback. The behavioral prose is authoritative over the structural slip, so both params are `Type.Optional` and "at least one MUST be present" is enforced in `cancelExecute` (S2 / P1.M1.T1.S2). **Side benefit:** with both optional, every existing `{markerId:'…'}` test in `test/tools/cancel.test.ts` continues to typecheck and pass with zero changes, keeping S1 self-contained. This deviation is documented here for reviewer adjudication; if the reviewer insists on the literal required-`target` schema, the consequence is that every existing markerId-path test must additionally pass a `target`, AND markerId-only agent calls become runtime-rejected (revisit acceptance-(a) before agreeing).