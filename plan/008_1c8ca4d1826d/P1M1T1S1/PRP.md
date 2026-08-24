# PRP — P1.M1.T1.S1: Split ShrinkTarget into 2-arm write union + `@deprecated` legacy read field (transforms.ts + markers.ts)

## Goal

**Feature Goal**: In BOTH `src/transforms.ts` and `src/markers.ts` (whose `ShrinkTarget` declarations are hard-contracted to stay structurally identical), change the WRITE type to exactly two arms — `{ by_tool_call_id: string } | { by_tool_name: string; occurrence: "last" | "first" }` — and add an exported READ type `ShrinkTargetRead` that additionally accepts the legacy v1.x `{ by_content_includes: string }` shape as a deprecated, ignored-by-resolver field, so OLD persisted `mulligan:shrink` markers still type-check at read sites. Type-level only; NO behavior change.

**Deliverable**: Exported `ShrinkTarget` (2-arm write) and `ShrinkTargetRead` (read) from BOTH files, structurally identical in both; `tsc --noEmit` (`npm run typecheck`) passes; `vitest run` stays green.

**Success Definition**: All read sites that may see legacy persisted markers (`ShrinkMarker.target`, `ShrinkMarkerLike.target`, `resolveShrinkTarget`'s param, `applyShrink`'s marker param) are typed with `ShrinkTargetRead`; a fresh 2-arm write target is assignable to `ShrinkTargetRead`; JSDoc on both declarations cites spec/06 §5 v2.0 (current-turn scope, defense in depth) and the PRD §2 ruling; `resolveShrinkTarget`'s runtime behavior is UNCHANGED (its `by_content_includes` branch survives until S2).

## Why

The PRD v2.0 removes the `by_content_includes` shrink arm entirely: both remaining arms resolve only within the current turn's tool-result span (spec/06 §5, "defense in depth" — enforced at both tool creation and filter resolution). This subtask is the type-level groundwork (P1.M1.T1.S1) that later subtasks build on: S2 deletes the content arm from the resolver and adds the span bound; P1.M2 reworks the tools. Splitting write vs read types now lets the compiler catch any new content-target writes while keeping v1.x persisted sessions readable.

## What

- `ShrinkTarget` (write): 2 arms only. No `by_content_includes`.
- `ShrinkTargetRead` (read): the 2-arm union PLUS a legacy arm, following the `RewindMarker.options.to_previous_prompt` optional-legacy-field precedent (`src/markers.ts:60-62`).
- Old persisted markers with `data.target.by_content_includes` must type-check at read sites; the v2.0 resolver (S2) will make them resolve null and no-op.
- Update JSDoc on both declarations in both files: cite `spec/06-context-filter.md §5` v2.0 (current-turn scope, defense in depth) and PRD §2 ruling (arm removal).
- **DO NOT change `resolveShrinkTarget` behavior** — its `by_content_includes` branch (transforms.ts:800-807) is removed in S2. Delete it here ONLY if the compiler forces it (it should NOT, if the param is widened to `ShrinkTargetRead`).

### Success Criteria

- [ ] `export type ShrinkTarget` = 2 arms in both `src/transforms.ts` (~line 740) and `src/markers.ts` (~line 96), structurally identical
- [ ] `export type ShrinkTargetRead` in both files, structurally identical, accepting legacy `{ by_content_includes: string }`
- [ ] Read sites (`ShrinkMarker.target`, `ShrinkMarkerLike.target`, `resolveShrinkTarget(messages, target: ShrinkTargetRead)`, `applyShrink` marker param) use the read type
- [ ] A variable of type `ShrinkTarget` is assignable to `ShrinkTargetRead` (union member)
- [ ] `npm run typecheck` (tsc --noEmit) passes; `npx vitest run` all green
- [ ] JSDoc updated in both files, both types
- [ ] No runtime behavior change anywhere

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: they need the exact current declarations, the read/write site inventory (below), the structural-identity contract, the `to_previous_prompt` precedent, and the Pi-free constraint on transforms.ts. All provided here.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: ShrinkTarget declared LOCALLY at line 740 (3 arms); resolveShrinkTarget at 771
        with the by_content_includes branch at 800-807 (KEEP behavior this subtask);
        applyShrink marker param at ~965; ShrinkMarkerLike.target at ~1132.
  pattern: local structural type, 0 imports — transforms.ts is the Pi-free pure tier and
           must NOT import from markers.ts.
  gotcha: The two ShrinkTarget declarations (transforms.ts + markers.ts) must stay
          structurally identical — hard contract (architecture/system_context.md §2).

- file: src/markers.ts
  why: duplicate ShrinkTarget at lines 96-99; ShrinkMarker.target at line 110 (READ site —
        persisted markers); RewindMarker.options.to_previous_prompt at lines 60-62 is the
        exact JSDoc precedent for a deprecated legacy optional field.
  pattern: JSDoc on the deprecated field explaining "ignored by the v2.0 resolver ... kept
           so old persisted markers type-check and read harmlessly".

- file: architecture/system_context.md
  why: §2 has verified line numbers and the structural-identity contract; pure-tier notes.
- docfile: plan/008_1c8ca4d1826d/architecture/_scouts/pure-tier.md
  why: pure-tier constraints for transforms.ts.
```

### Current code (exact, verified)

`src/transforms.ts:740` and `src/markers.ts:96` (currently identical):
```ts
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Do NOT write ShrinkTargetRead as `(2-arm) & { by_content_includes?: string }`.
// An intersection over a union distributes to (A&C)|(B&C) — a legacy content-only object
// { by_content_includes: "x" } is NOT assignable to that (it lacks by_tool_call_id /
// by_tool_name). Use a UNION with a dedicated legacy arm instead:

export type ShrinkTargetRead =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | {
      /** @deprecated legacy v1.x field — ignored by the v2.0 resolver; legacy
       *  content-shrinks resolve null and no-op. Kept so old persisted markers
       *  type-check (precedent: RewindMarker.options.to_previous_prompt). */
      by_content_includes: string;
    };

// GOTCHA: transform.ts must stay Pi-FREE (0 imports) — declare BOTH types locally there;
// do not import anything. markers.ts keeps its own identical copies.

// GOTCHA: `tsc` object-literal excess-property checks only fire on fresh literals, so
// widening ShrinkMarker.target to ShrinkTargetRead is the change that actually keeps old
// persisted markers type-checking.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/transforms.ts (~line 732-743)
  - CHANGE the exported ShrinkTarget union to exactly 2 arms (drop { by_content_includes: string })
  - ADD exported ShrinkTargetRead immediately after (union form above, @deprecated JSDoc on the legacy arm)
  - REWRITE the JSDoc above both: cite spec/06-context-filter.md §5 v2.0 (current-turn scope,
    defense in depth — arms resolve ONLY within the current turn's tool-result span) and the
    PRD §2 ruling (by_content_includes REMOVED in v2.0)
  - PRESERVE the "STRUCTURALLY IDENTICAL to markers.ts" note, now covering BOTH types

Task 2: EDIT src/transforms.ts — widen READ sites
  - resolveShrinkTarget(messages: MessageLike[], target: ShrinkTargetRead)  (line ~771)
    → the by_content_includes branch (800-807) now type-checks unchanged; do NOT delete it
  - applyShrink marker param: { target: ShrinkTargetRead; replacement: string; pinnedEntryId?: string } (~965)
  - ShrinkMarkerLike.target: ShrinkTargetRead (~1132)
  - KEEP the JSDoc contract notes ("a real ShrinkMarker / ShrinkMarkerLike assigns in with NO cast")

Task 3: EDIT src/markers.ts (~lines 92-99, 110)
  - Same 2-arm ShrinkTarget + ShrinkTargetRead (structurally identical to Task 1)
  - ShrinkMarker.target: ShrinkTargetRead  (persisted markers are READ; v1.x markers carry by_content_includes)
  - Check appendShrinkMarker's input type (ShrinkMarkerInput-like Omit, if present): keep the
    WRITE type where the signature allows; if the Omit inherits ShrinkMarker.target and the
    compiler forces it, keep the read type there too and note it — the tools' schema-level
    lockstep is P1.M2's job, not this subtask's
  - Update the JSDoc of both type declarations (spec/06 §5 v2.0, PRD §2)

Task 4: FIX compiler-forced call sites ONLY (then stop)
  - src/tools/shrink.ts:267 and :285 cast `target as ShrinkTarget` where target may be the
    content arm — change to `as ShrinkTargetRead` (or `as unknown as ShrinkTargetRead` if
    overlap checking still complains). Do NOT touch ShrinkParams / describeTarget /
    isTargetStructurallyValid — those still describe the v1 tool surface until P1.M2.T1.
  - src/tools/cancel.ts:65 imports `type { ShrinkTarget }` — switch to ShrinkTargetRead
    wherever the value flows into resolveShrinkTarget (lines ~259, ~285).
  - In-file literals: transforms.ts has ~8 by_content_includes occurrences and markers.ts ~2 —
    the ones inside the resolver branch and JSDoc/comments stay; only actual type-position
    literals that now fail must move to ShrinkTargetRead or be deleted.
  - NO test edits in this subtask beyond what tsc forces (test-suite sweep is P1.M4.T1).
    Tests run through `vitest run` (no typecheck in the runner), so only genuine compile
    breaks in src/ matter here.

Task 5: VALIDATE
  - npm run typecheck   → 0 errors
  - npx vitest run      → all green (no behavior change expected)
```

### Integration Points

```yaml
TYPES:
  - New export: ShrinkTargetRead (both src/transforms.ts and src/markers.ts)
  - Changed export: ShrinkTarget (2 arms, both files)
  - Downstream consumers to keep compiling: src/tools/shrink.ts, src/tools/cancel.ts,
    src/filter.ts (imports ShrinkMarker/ShrinkMarkerLike paths — verify after edit)
```

## Validation Loop

### Level 1: Type check (the primary gate — this is a type-only subtask)

```bash
npm run typecheck   # tsc --noEmit — MUST pass with 0 errors
```

### Level 2: Behavior lock (nothing may change)

```bash
npx vitest run      # full suite must stay green — this subtask changes TYPES ONLY
grep -n "by_content_includes" src/transforms.ts   # resolver branch at ~800-807 must STILL EXIST
```

### Level 3: Contract assertions

```bash
# Both declarations structurally identical (2-arm ShrinkTarget + ShrinkTargetRead in each):
grep -n "export type ShrinkTarget\b\|export type ShrinkTargetRead" src/transforms.ts src/markers.ts
# @deprecated JSDoc present on the legacy arm in BOTH files:
grep -n "@deprecated" src/transforms.ts src/markers.ts
```

Optional compile-level proof (throwaway check, do not commit): a scratch `const t: ShrinkTargetRead = { by_content_includes: "x" };` compiles, and `const w: ShrinkTarget = { by_tool_call_id: "a" }; const r: ShrinkTargetRead = w;` compiles.

## Final Validation Checklist

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` fully green
- [ ] `ShrinkTarget` is 2-arm in both files, identical
- [ ] `ShrinkTargetRead` exported from both files with `@deprecated by_content_includes` legacy arm
- [ ] Read sites (`ShrinkMarker.target`, `ShrinkMarkerLike.target`, `resolveShrinkTarget` param, `applyShrink` param) use `ShrinkTargetRead`
- [ ] `resolveShrinkTarget` runtime behavior unchanged (content branch intact at transforms.ts:800-807)
- [ ] JSDoc cites spec/06 §5 v2.0 + PRD §2 in both files
- [ ] No files other than src/transforms.ts, src/markers.ts, and compiler-forced casts in src/tools/{shrink,cancel}.ts touched
- [ ] [Mode A docs] carried by JSDoc — no separate docs change needed

## Anti-Patterns to Avoid

- ❌ Do NOT define `ShrinkTargetRead` as an intersection `(2-arm) & { by_content_includes?: string }` — legacy content-only objects won't assign (see Gotchas)
- ❌ Do NOT delete the resolver's `by_content_includes` branch — that is S2 (P1.M1.T1.S2)
- ❌ Do NOT import between transforms.ts and markers.ts (Pi-free pure tier)
- ❌ Do NOT touch ShrinkParams, CancelParams, describeTarget, or test fixtures beyond compiler-forced minimum — those are P1.M2 / P1.M4 subtasks
- ❌ Do NOT add the span/turn-bound logic — that is S2/T2