# PRP — P1.M1.T1.S1: Restore spec-verbatim REWIND_DESC checkpoint sentence + checkpoint param description (rewind.ts + rewind.test.ts)

## Goal

**Feature Goal**: Fix BUG-001 — the LLM-facing docs drift on `mulligan_rewind`: (a) `REWIND_DESC` is missing its spec-mandated final sentence about checkpoint granularity; (b) the `checkpoint` parameter description references `mulligan_checkpoint`, the agent tool removed in v1.1, instead of the `/mulligan_checkpoint` human command. Both strings must become spec-verbatim, and the coupled hard-coded test assertions updated in the same change.

**Deliverable**: Corrected `REWIND_DESC` constant and `RewindParams.properties.checkpoint` typebox description in `src/tools/rewind.ts`; updated + extended assertions in `test/tools/rewind.test.ts`.

**Success Definition**: `REWIND_DESC` ends byte-verbatim with the spec sentence; the checkpoint param description matches the spec string exactly; the registration-metadata tests assert both new strings; `npm test` green and `npx tsc --noEmit` clean. Strings only — no logic, schema-shape, or registration changes.

## Why

spec/05 §6 says description strings "drive LLM usage" and must be copied verbatim. Without the checkpoint sentence, the model is never told (at the description level) that checkpoint rewinds exist or that they may hide the user's prompts (with consent). The wrong param description sends the agent hunting for an agent-callable `mulligan_checkpoint` tool that does not exist (E23/v1.1 removed it; `src/index.ts:53-56` registers only rewind/shrink/audit/cancel).

## What

Two string edits in `src/tools/rewind.ts` plus test updates in `test/tools/rewind.test.ts`. The strings (both from `spec/05-tools.md`, quoted below EXACTLY, em-dashes included):

**REWIND_DESC final sentence** — spec/05-tools.md §6 "Description strings" Rewind entry (line ~325). Append to the existing description with a SINGLE leading space, before the closing quote:

```
granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it).
```

(The `—` characters above are EM-DASHES, U+2014. Do not substitute hyphens.)

**Checkpoint param description** — spec/05-tools.md:46-47, replace the current one:

```
Required when granularity=checkpoint. The name of a checkpoint set via the /mulligan_checkpoint command.
```

### Success Criteria

- [ ] `REWIND_DESC` (src/tools/rewind.ts:127-129) ends with `"...from the user's last message. granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it)."`
- [ ] `RewindParams.properties.checkpoint` description (rewind.ts:112-114) equals the spec string above
- [ ] `test/tools/rewind.test.ts:304-312` ("description is the spec/05 §5 verbatim string" it) updated to the NEW full string
- [ ] New sibling assertion: `RewindParams.properties.checkpoint.description` equals the spec param string (mirror the registration-metadata describe block at rewind.test.ts:295-315)
- [ ] `npm test` green; `npx tsc --noEmit` clean
- [ ] NO other changes — granularity param description (rewind.ts:101-108) already matches spec and must NOT be touched

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they need the exact current strings, the exact spec strings, the test file location/shape, and where these strings are consumed (makeRewindTool / pi.registerTool). All provided below — verified against the live files.

### Documentation & References

```yaml
- file: spec/05-tools.md
  why: §6 "Description strings" (lines ~320-327) contains the canonical REWIND_DESC including
        the checkpoint final sentence; lines 46-47 contain the canonical checkpoint param
        description. Both are the source of truth — copy VERBATIM.
  pattern: description strings are quoted inline in the spec bullet list.
  gotcha: em-dash characters (U+2014) in the checkpoint sentence are load-bearing;
          a plain hyphen is a wrong byte.

- file: src/tools/rewind.ts
  why: lines 110-114 hold RewindParams.checkpoint (current wrong description: "set via
        mulligan_checkpoint."); lines 122-129 hold the REWIND_DESC JSDoc ("Mode A LLM-facing
        docs", "Copy verbatim — it drives LLM usage") and the constant itself, which currently
        ends at "...to redo the whole turn from the user's last message."
  pattern: the constant is a single double-quoted TS string; extend it in place.
  gotcha: granularity param description at lines 101-108 already matches spec — do not touch.

- file: test/tools/rewind.test.ts
  why: lines 295-315 are the "registration metadata (spec/05 §5)" describe block; the it at
        304-312 ("description is the spec/05 §5 verbatim string") hard-codes the OLD REWIND_DESC
        and WILL FAIL after the edit unless updated in this same change.
  pattern: plain expect(REWIND_DESC).toBe("...") string equality; add the checkpoint-param
        assertion as a sibling it in the same describe block, accessing the typebox schema via
        RewindParams.properties.checkpoint.description (RewindParams is imported in the test file).

- docfile: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/architecture/bug_validation.md
  why: §BUG-001 is the origin of this fix — full reproduction steps and spec citations.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA: The appended sentence needs exactly ONE leading space where it joins the existing
// string: "...from the user's last message. granularity 'checkpoint' rewinds back..." —
// the space before 'granularity' is part of the appended text (single leading space, per the
// contract). The spec's own quoted string shows this join.

// GOTCHA: The em-dash "—" (U+2014) appears in "a user set — and may hide" — verify with:
//   grep -c $'\u2014' src/tools/rewind.ts   (should be >= 1 after the edit)
// Do not let an editor/linter normalize it to "-", "--", or " - ".

// GOTCHA: typebox schema property descriptions live at
//   (RewindParams.properties.checkpoint as any).description
// — in the typebox Static world the schema object is plain JSON; expect(...).toBe(string) works.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — REWIND_DESC (~lines 127-129)
  - APPEND (single leading space) to the existing string, before the closing quote:
      " granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's prompts after it (they consented by setting it)."
  - Keep the existing JSDoc above it; optionally extend the JSDoc citation to note the v1.1
    checkpoint sentence is included per spec/05 §6 (Mode A LLM-facing docs)
  - PRESERVE everything before the append byte-for-byte

Task 2: EDIT src/tools/rewind.ts — checkpoint param description (~lines 112-114)
  - REPLACE the description value with EXACTLY:
      "Required when granularity=checkpoint. The name of a checkpoint set via the /mulligan_checkpoint command."
  - Do NOT change Type.Optional(Type.String(...)) shape or any other param

Task 3: EDIT test/tools/rewind.test.ts — registration metadata block (lines 295-315)
  - UPDATE the it at 304-312 ("description is the spec/05 §5 verbatim string"): the toBe
    literal becomes the OLD string + the appended sentence (full new REWIND_DESC)
  - ADD sibling it in the same describe block, e.g.
      it("RewindParams.checkpoint description is the spec/05 verbatim string", () => {
        expect(RewindParams.properties.checkpoint.description).toBe(
          "Required when granularity=checkpoint. The name of a checkpoint set via the /mulligan_checkpoint command.",
        );
      });
    (RewindParams is already imported in this test file — the "parameters === RewindParams" it at
     ~314 proves it)

Task 4: VALIDATE
  - npx tsc --noEmit   → clean
  - npm test           → all green (the OLD hard-coded assertion must have been updated in Task 3)
```

### Integration Points

```yaml
CONSUMERS (no code change needed — they read the constants):
  - src/tools/rewind.ts:721-742 makeRewindTool uses REWIND_DESC + RewindParams in the
    registered tool object
  - src/index.ts:53-56 pi.registerTool(makeRewindTool(pi)) presents both strings to the model
FOLLOW-ONS:
  - P1.M3.T2.S2 (README sweep) double-checks README §4 consistency afterwards — do NOT edit
    README here (README does not quote these strings verbatim; [Mode A] these LLM-facing
    strings ARE the documentation surface)
```

## Validation Loop

### Level 1: Type check

```bash
npx tsc --noEmit     # clean
```

### Level 2: Unit tests

```bash
npm test             # full suite green — includes the updated registration-metadata block
```

### Level 3: Byte-exactness spot checks

```bash
# REWIND_DESC ends with the spec sentence (em-dash present, single leading space):
grep -n "they consented by setting it" src/tools/rewind.ts test/tools/rewind.test.ts
grep -n "set via the /mulligan_checkpoint command" src/tools/rewind.ts test/tools/rewind.test.ts
# Old wrong strings gone:
! grep -rn "set via mulligan_checkpoint\." src/
```

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npm test` fully green
- [ ] REWIND_DESC appended sentence byte-verbatim (em-dash U+2014, single leading space)
- [ ] Checkpoint param description byte-verbatim spec string
- [ ] Test at rewind.test.ts:304-312 updated + new checkpoint-param sibling assertion added
- [ ] Granularity param description (rewind.ts:101-108) untouched
- [ ] No logic / schema-shape / registration / index.ts changes
- [ ] Files touched: only src/tools/rewind.ts and test/tools/rewind.test.ts

## Anti-Patterns to Avoid

- ❌ Do NOT reword or "improve" either string — spec-verbatim is the contract
- ❌ Do NOT replace em-dashes with hyphens or let a formatter mangle them
- ❌ Do NOT forget the test update — the old hard-coded assertion WILL fail (the contract flags this coupling explicitly)
- ❌ Do NOT touch the granularity param description, tool registration, or README (that sweep is P1.M3.T2.S2)
- ❌ Do NOT change RewindParams' shape (Type.Optional(Type.String) stays)