# PRP — P1.M2.T1.S1: ShrinkParams 2-arm union + current-turn field descriptions + SHRINK_DESC reword

## Goal

**Feature Goal**: Reduce `ShrinkParams` (the typebox schema for `mulligan_shrink`) from 3 arms to the 2-arm v2.0 union (`by_tool_call_id` / `by_tool_name`+`occurrence`), rewrite all field/union descriptions with current-turn wording, and reword `SHRINK_DESC` per the normative §2 purpose text. Fix all `ShrinkArgs` Static type fallouts so `npm run typecheck` and the full suite stay green.

**Deliverable**: Edited `src/tools/shrink.ts` only (schema + description constants + JSDoc + type fallouts). No behavior change in `execute` (that's P1.M2.T1.S2); no test-sweep rewrite (that's P1.M2.T2.S1 / P1.M4).

**Success Definition**: `npm run typecheck` clean, `npx vitest run` green, `by_content_includes` calls now rejected at HOST schema validation (anyOf must-be-object ×2), and every exported description string carries the v2.0 current-turn wording.

## Why

The PRD v2.0 delta restricts shrink to current-turn results. The resolver (P1.M1.T1.S2, `resolveShrinkTarget` span-bound + content arm deleted) and the filter scope guard (P1.M1.T2.*) are already done. The schema is the remaining 3-arm surface: leaving `by_content_includes` in the schema lets the model issue calls that are dead-on-arrival (host validates args BEFORE `execute`, C13) or that reach a resolver which now returns `null` for the content arm. The descriptions ARE the LLM-facing docs (Mode A) — they must teach the current-turn scope and the hard refusal for earlier-turn targets.

## What

1. `ShrinkParams.target` union: exactly two arms with the PRD §2 verbatim descriptions (see Blueprint).
2. `SHRINK_DESC` reworded to current-turn scope, mentioning the hard refusal for earlier-turn targets. Do NOT copy the stale spec §5 "Description strings" text ("Replace a specific past tool result…") — the normative source is §2's purpose text.
3. `ShrinkArgs = Static<typeof ShrinkParams>` narrows to the 2-arm union; every compile fallout fixed (in-file helpers and existing tests) with minimal casts, NOT behavior rewrites.

### Success Criteria

- [ ] `ShrinkParams[Symbol]("anyOf")]`-level: exactly 2 object schemas in the `target` union; none mentions `by_content_includes`.
- [ ] All v2.0 description strings present verbatim (union, by_tool_call_id, by_tool_name, occurrence).
- [ ] `SHRINK_DESC` says "current turn" and warns earlier-turn targets are refused.
- [ ] `prepareArguments: prepareObjectArgs<ShrinkArgs>(["target"])` at line ~400 unchanged.
- [ ] `ctx.ui.notify` echo path unchanged.
- [ ] `npm run typecheck` + `npx vitest run` green.

## All Needed Context

### Documentation & References

```yaml
- file: plan/008_1c8ca4d1826d/prd_snapshot.md
  why: §2 "mulligan_shrink" — the NORMATIVE v2.0 wording for the 2-arm schema (verbatim block), the v2.0 current-turn-scope note, and the §2 purpose text that SHRINK_DESC must follow
  gotcha: spec §5 "Description strings" ("Replace a specific past tool result…") is INTERNALLY STALE — do not copy it

- file: src/tools/shrink.ts
  why: the file being edited — ShrinkParams at :80-106, SHRINK_DESC at :112-116, ShrinkArgs at :104, describeTarget at :185, targetIsStructurallyValid at :215, prepareArguments at :400
  pattern: typebox Type.Union arms with per-field `description` strings
  gotcha: keep `prepareObjectArgs<ShrinkArgs>(["target"])` and the notify echo untouched

- file: src/tools/cancel.ts
  why: structurally identical CancelParams union (P1.M3.T3.S1 will do the same edit there later — do NOT touch it now)

- file: src/transforms.ts
  why: ShrinkTarget (2-arm write type, :776) + ShrinkTargetRead (read view with @deprecated legacy content arm, :787) — the parity reference the schema arms must match
  gotcha: ShrinkParams target shape must equal ShrinkTarget's two arms

- file: test/tools/shrink.test.ts
  why: existing tests that pass `{ by_content_includes: ... }` literals (lines ~253-254, ~344, ~381-386, ~455-460, ~598-605) — these are TYPE fallouts to fix with casts, not rewrite (behavior sweep is P1.M2.T2.S1 / P1.M4.T1.S2)
  gotcha: line 184 already asserts SHRINK_DESC verbatim — update that expected string to the new one

- file: test/prepare-args.test.ts
  why: line 151 uses '{"by_content_includes": "pclntab"}' as a generic prepareObjectArgs fixture — typed as unknown, likely compiles fine; verify, cast only if needed

- file: architecture/_scouts/tools.md (section §1) + architecture/external_deps.md
  why: scout notes on host pre-validation (C13) and typebox anyOf rejection semantics
```

### Current Codebase tree (relevant slice)

```bash
src/tools/shrink.ts        # EDIT TARGET
src/transforms.ts          # ShrinkTarget / ShrinkTargetRead (parity, read-only)
src/markers.ts             # markers.ts ShrinkTarget (identical write type, read-only)
src/prepare-args.ts        # prepareObjectArgs shim (unchanged)
test/tools/shrink.test.ts  # SHRINK_DESC verbatim assert + content-arm literals (cast-only fixes)
```

### Known Gotchas

- **Host validates before execute (C13)**: removing the arm means `by_content_includes` calls die at schema validation ("must be object" per anyOf arm) — never reach `execute`. This is intended; schema-rejection tests belong to P1.M2.T2.S1, not here.
- **Typebox `Static` inference**: `ShrinkArgs["target"]` narrows automatically; `describeTarget` (line 185) and `targetIsStructurallyValid` (line 215) both have `by_content_includes` branches — those branches become unreachable typed-code. P1.M2.T1.S2 will DELETE the content branches; HERE only fix compile errors (delete the branch only if it no longer typechecks — `target.by_content_includes` on the 2-arm union is a type error, so those branches must be removed or the access cast). Prefer: cast `target` to `ShrinkTargetRead`-ish `unknown`-record access OR remove the branch with a comment "content arm: removed in v2.0 schema (P1.M2.T1.S1); runtime handling removed in P1.M2.T1.S2". Keep runtime behavior fail-open: a content target can no longer arrive from a validated call.
- **Tests with content-arm literals**: cast as `ShrinkArgs["target"]` via `as unknown as` where the object literal no longer satisfies the type. Do NOT delete tests — the sweep is P1.M4.
- **SHRINK_DESC verbatim test** (test/tools/shrink.test.ts:184): must be updated in lockstep with the reword.

## Implementation Blueprint

### The 2-arm schema (PRD §2, copy field descriptions VERBATIM)

```ts
export const ShrinkParams = Type.Object({
  target: Type.Union(
    [
      Type.Object({
        by_tool_call_id: Type.String({
          description: "The toolCallId of the result to shrink — must be a call from the CURRENT turn.",
        }),
      }),
      Type.Object({
        by_tool_name: Type.String({
          description: "e.g. 'read', 'bash' — matches only results from the CURRENT turn",
        }),
        occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")], {
          description: "first/last matching result within the current turn",
        }),
      }),
    ],
    {
      description:
        "How to identify the CURRENT-TURN tool result to shrink. Only results produced this turn are eligible; earlier turns are out of scope. Resolved live each turn (robust to compaction).",
    },
  ),
  replacement: Type.String({
    description:
      "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on.",
  }),
  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});
```

### SHRINK_DESC (reword — normative source is PRD §2 purpose, NOT spec §5)

```ts
export const SHRINK_DESC =
  "Replace the current turn's tool result with a compact summary you provide, in your view, going forward. " +
  "Use when the call was fine but its output is too big to keep carrying. Only results from THIS turn can be " +
  "shrunk — a target from an earlier turn is refused outright. Unlike rewind, the call stays in context " +
  "(just with your summary as its result).";
```

(Exact phrasing is yours as long as it: says current turn, says the shrink replaces content with a compact summary, and explicitly warns of the hard refusal for earlier-turn targets. Do NOT reuse "past tool result".)

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/tools/shrink.ts — ShrinkParams
  - REPLACE the 3-arm union with the 2-arm block above (verbatim descriptions)
  - UPDATE the file-header JSDoc (lines ~70-79): remove the by_content_includes bullet, note v2.0 2-arm union + parity with transforms.ts ShrinkTarget

Task 2: EDIT src/tools/shrink.ts — SHRINK_DESC
  - REPLACE the string per above; update the JSDoc above it to note the normative source is PRD §2 purpose (spec §5 string is stale)

Task 3: EDIT src/tools/shrink.ts — Static type fallouts
  - describeTarget / targetIsStructurallyValid: the "by_content_includes" property accesses no longer typecheck on the 2-arm ShrinkArgs["target"] — remove or cast those branches with a `// v2.0: content arm removed from the schema (P1.M2.T1.S1); runtime deletion lands in P1.M2.T1.S2` comment. If removal is what compiles, remove.
  - Verify prepareArguments line (~400) and the ctx.ui.notify echo are untouched

Task 4: EDIT test/tools/shrink.test.ts — minimal fallout fixes ONLY
  - Update the SHRINK_DESC verbatim expectation (line ~184) to the new string
  - Cast existing by_content_includes literals: `as unknown as ShrinkArgs["target"]` (or equivalent). Do NOT delete/rewrite tests — P1.M2.T2.S1 + P1.M4 own the sweep
  - Check test/prepare-args.test.ts:151 compiles as-is; cast only if typecheck fails

Task 5: VERIFY
  - npm run typecheck && npx vitest run
  - grep -n "by_content_includes" src/tools/shrink.ts → 0 matches
  - node -e sanity: compile ShrinkParams and assert no anyOf arm mentions by_content_includes (optional; the M2.T2.S1 tests will lock this)
```

### Integration Points

None — pure schema-level edit within `src/tools/shrink.ts` (+ minimal test casts). No `index.ts` changes (it imports `makeShrinkTool`, whose signature is unchanged). `src/tools/cancel.ts` keeps its 3-arm union until P1.M3.T3.S1 — do NOT touch it.

## Validation Loop

### Level 1: Types & Lint

```bash
npm run typecheck          # tsc --noEmit — must be clean
npx vitest run             # full suite must pass
grep -c "by_content_includes" src/tools/shrink.ts   # → 0
```

### Level 2: Schema shape sanity (quick, optional)

```bash
node --experimental-strip-types -e "
import {ShrinkParams} from './src/tools/shrink.ts';
const arms = ShrinkParams.properties.target.anyOf;
console.log(arms.length === 2, arms.map(a => Object.keys(a.properties)).flat().join(','));
"
# Expected: true by_tool_call_id,by_tool_name,occurrence
```

(If strip-types is inconvenient, verify via a throwaway vitest `expect(...)` — do not add a permanent test; P1.M2.T2.S1 adds the schema-rejection lock.)

## Final Validation Checklist

- [ ] `ShrinkParams.target` union has exactly 2 arms; descriptions verbatim from PRD §2
- [ ] `SHRINK_DESC` reworded (current-turn scope + refusal warning); verbatim test updated in lockstep
- [ ] `by_content_includes` gone from `src/tools/shrink.ts` (grep = 0)
- [ ] `prepareArguments` shim + notify echo untouched
- [ ] No changes to `cancel.ts`, `transforms.ts`, `markers.ts`, `index.ts`
- [ ] `npm run typecheck` clean; `npx vitest run` green
- [ ] Existing content-arm tests kept (cast-only), not deleted

## Anti-Patterns to Avoid

- ❌ Don't copy the stale spec §5 description string ("past tool result") — §2 purpose is normative
- ❌ Don't rewrite execute-body logic (match-now, refusals) — that's P1.M2.T1.S2
- ❌ Don't delete/rewrite the content-arm tests — cast them; sweep is P1.M4
- ❌ Don't touch cancel.ts's union in this task
- ❌ Don't mock anything — this is a schema-level edit using existing fakes