# PRP — P1.M2.T1.S2: Match-now within currentTurnSpan + hard-refusal texts + drop content branches

## Goal

**Feature Goal**: Make `mulligan_shrink`'s execute path v2.0-correct: the advisory match resolves ONLY within the current turn's span (`currentTurnSpan`), out-of-turn/unmatched selectors are HARD REFUSALS with the exact spec text, and `targetIsStructurallyValid` + `describeTarget` drop their `by_content_includes` branches.

**Deliverable**: Edited `src/tools/shrink.ts` only (`resolveTargetEntryId`, `shrinkExecute` step 3, the two validators) plus minimal alignment of existing `test/tools/shrink.test.ts` cases that now hit the new refusals. No schema changes (P1.M2.T1.S1 owns those); no new R2 test lock (P1.M2.T2.S1 owns that).

**Success Definition**: in-span target → success with `pinnedEntryId`; earlier-turn-only or no-in-turn match → `Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk.` with NO marker persisted; throwing snapshot → matched:false + marker persisted (E13/E8, orientation ~0 path); `npm run typecheck` + `npx vitest run` green.

## Why

The resolver (`resolveShrinkTarget` 3-arg span-bound, P1.M1.T1.S2) and the filter scope guard (P1.M1.T2) are shipped, and the 2-arm schema is landing in parallel (P1.M2.T1.S1). The tool still matches against FULL history — so today a `by_tool_call_id` from a previous turn "succeeds" (pins an entry the filter will refuse to touch, guaranteeing `Matched: yes` lies) and a no-match persists a marker that can never fire within its turn span (dead marker). v2.0 makes the tool honest: refuse now, refuse exactly.

## What

1. `resolveTargetEntryId`: compute `const span = currentTurnSpan(messages)` (import from transforms.js), call `resolveShrinkTarget(messages, target, span)`, and on match return `{entryId, origTokens, index}` (`index?: number` added to the return type) so the caller can distinguish in-span success.
2. `shrinkExecute` step 3 (v2.0 REQUIRED, after structural validity):
   - In-span match (`index` is a number) → proceed exactly as today (pin, persist, feedback).
   - Earlier-turn-only match OR no in-turn match OR span empty-but-nonempty-history → `return refusal(PREV_TURN_MSG)` with reason string exactly: `that result is from a previous turn; only this turn's tool calls can be shrunk`. Nothing persisted. To distinguish "earlier-turn match" from "no match at all" you MAY resolve once WITHOUT the span (full history) purely for classification — both end in the SAME refusal text.
   - Structurally-invalid target keeps its OWN discriminator message: `target discriminator must be non-empty`.
   - Advisory throw (buildContextEntries throws → `{entryId:null, origTokens:0}` from the catch): KEEP the E13 rule — persist with matched:false, orientation line `~0` path stays reachable (the filter's scope guard makes an unverifiable marker inherently safe).
3. `targetIsStructurallyValid` + `describeTarget`: delete the `by_content_includes` branches (2 arms + defensive fallbacks remain).
4. JSDoc updates on `resolveTargetEntryId` + `shrinkExecute` citing §2 step 3 v2.0 and the exact refusal string (Mode A — docs ride with the work).

### Success Criteria

- [ ] `resolveTargetEntryId` uses `currentTurnSpan` + 3-arg `resolveShrinkTarget`; returns `{entryId, origTokens, index?}`.
- [ ] Earlier-turn target → exact refusal text, `appendShrinkMarker` NOT called.
- [ ] No in-span match (well-formed selector, non-empty span) → same refusal, no persistence.
- [ ] In-span match → success; `pinnedEntryId` present in marker payload.
- [ ] Throwing `buildContextEntries` → still persists, `Matched: no`, orientation line present with `~0` when `markerId` truthy.
- [ ] No `by_content_includes` reference remains in shrink.ts helpers.
- [ ] `npm run typecheck` and `npx vitest run` green.

## All Needed Context

### Documentation & References

```yaml
- file: plan/008_1c8ca4d1826d/prd_snapshot.md
  why: §2 "mulligan_shrink" step 3 v2.0 — NORMATIVE refusal text, return shape, orientation-line rules; E8 (§E8) no-op semantics; E13 (§E13) never-throw
  critical: refusal string is EXACT and grep-tested: "that result is from a previous turn; only this turn's tool calls can be shrunk" (refusal() adds the "Mulligan: refused — " prefix and trailing ".")

- file: src/tools/shrink.ts
  why: the file being edited. Key anchors: refusal() ~:135-139, feedbackText ~:141, shrinkOrientationLine, describeTarget ~:185-192, targetIsStructurallyValid ~:215-222, entryIdAtMessageIndex ~:230-252, resolveTargetEntryId ~:258-275, shrinkExecute step order
  pattern: all helpers are module-private, defensive, never throw; every AgentToolResult path carries `details`
  gotcha: P1.M2.T1.S1 lands in parallel on this same file (2-arm ShrinkParams + SHRINK_DESC) — rebase your edit onto whatever is present; do NOT touch the schema or SHRINK_DESC

- file: src/transforms.ts
  why: currentTurnSpan (:379, exported, pure — last role:"user" index +1 → length; no user msg → start 0; non-array → {0,0}) and resolveShrinkTarget (:827, 3-arg: optional span clamps BOTH arms to [start,end); span undefined → full range)
  gotcha: resolveShrinkTarget takes (messages, target, span) — span is the THIRD arg; content arm already returns null

- file: test/tools/shrink.test.ts
  why: existing harness — makeCtx({contextEntries, throwOnBuildContextEntries, hasUI}) scripts buildContextEntries; notifyCalls recorded; makePi captures appendEntry. NO vi.fn() for Pi objects (hand-rolled fakes)
  gotcha: existing cases (e)/(f)/(g) script matches via contextEntries — under v2.0 a target resolving outside the current turn now REFUSES; align those fixtures minimally (script a user message before the toolResult so it falls in-span, or expect the refusal) without building the full R2 lock (that is P1.M2.T2.S1)

- file: plan/008_1c8ca4d1826d/architecture/_scouts/tools.md
  why: §1 pre-delta recon of shrink.ts (verbatim anchors: refusal :135-139, describeTarget :185-192, targetIsStructurallyValid :215-222)
```

### Current Codebase tree (relevant)

```bash
src/tools/shrink.ts        # EDIT — execute-path scoping + refusals + helper cleanup
src/transforms.ts          # READ — currentTurnSpan, resolveShrinkTarget (3-arg) — FROZEN, consume only
src/markers.ts             # READ — appendShrinkMarker(pi, ctx, ShrinkMarkerInput) incl. pinnedEntryId?: string (:145)
src/prepare-args.ts        # READ — prepareObjectArgs shim (leave untouched)
test/tools/shrink.test.ts  # EDIT (minimal) — align existing cases with v2.0 semantics
```

### Known Gotchas

```ts
// CRITICAL: resolveTargetEntryId must return index on match — the caller distinguishes
//   in-span success (index: number) from advisory-throw (entryId:null, origTokens:0, no index).
// CRITICAL: the classification resolve (full history, no span) is for REFusal REASONING only —
//   never pin from it, never persist from it. Both classifications share ONE refusal text.
// CRITICAL: span empty (start===end) with nonempty history → refusal too ("no in-turn match").
//   span empty with EMPTY history (start=0,end=0 on empty session) — no messages at all:
//   a well-formed selector has nothing later this turn → also refusal (same text; nothing persists).
// GOTCHA: refusal paths must NOT append shrinkOrientationLine ("Context updated must not lie").
// GOTCHA: keep ONE outer try/catch in shrinkExecute → refusal("unexpected error: …") (E13).
// GOTCHA: import currentTurnSpan from "../transforms.js" (.js ESM extension, repo convention).
// GOTCHA: describeTarget/targetIsStructurallyValid keep their defensive fallbacks ("message" /
//   false for unrecognized shapes) — the schema rejects content arms, but prepareObjectArgs-decoded
//   or hand-crafted objects can still reach them at runtime.
```

## Implementation Blueprint

### Task 1: MODIFY `resolveTargetEntryId` (src/tools/shrink.ts)

```ts
function resolveTargetEntryId(
  ctx: ExtensionContext,
  target: ShrinkArgs["target"],
): { entryId: string | null; origTokens: number; index?: number } {
  try {
    const entries = ctx.sessionManager.buildContextEntries();
    const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
    const span = currentTurnSpan(messages); // v2.0: current-turn bound (import from ../transforms.js)
    const i = resolveShrinkTarget(messages, target as ShrinkTarget, span);
    if (i === null) return { entryId: null, origTokens: 0 };
    const origTokens = estimateTokens([messages[i]] as unknown as EstMessageLike[]).tokens;
    return { entryId: entryIdAtMessageIndex(entries, i), origTokens, index: i };
  } catch {
    return { entryId: null, origTokens: 0 }; // E13 advisory-throw rule — caller persists matched:false
  }
}
```

Optionally a sibling `classifyOutOfTurn(ctx, target): boolean` — resolve WITHOUT span, true iff a match exists in full history — purely to justify the refusal reason (same text either way; may be omitted and folded inline).

### Task 2: MODIFY `shrinkExecute` step 3 (hard refusal branch)

After structural validity, replace the current unconditional proceed:

```ts
const { entryId, origTokens, index } = resolveTargetEntryId(ctx, params.target);
if (index === undefined) {
  // v2.0 §2 step 3: no match within the current turn's tool-result span — nothing later THIS
  // turn can still match. Whether it matches an EARLIER turn or nothing at all: same refusal.
  // (Advisory-throw indistinguishable path also lands here ONLY when resolution threw — but the
  //  E13 rule says a THROWN snapshot persists matched:false. Distinguish by re-checking: a thrown
  //  buildContextEntries is detected by resolveTargetEntryId's catch; see Task 3.)
  return refusal("that result is from a previous turn; only this turn's tool calls can be shrunk");
}
const matched = entryId !== null; // in-span match; entryId may still be null (unmappable entry id) — fine
```

**Ordering decision (spec-exact)**: config gates → replacement → structural validity → hard-refusal (no in-span match) → persist + pin → notify → feedback + orientation. The E13 advisory-throw carve-out: `resolveTargetEntryId` returning `{entryId:null, origTokens:0}` is BOTH "no match" and "threw". To keep the throw path persisting (per E13) while refusing real no-matches, have `resolveTargetEntryId` return a third discriminant, e.g. `{ snapshotOk: boolean }` (true when the try block completed, false when it caught). Rule:

- `snapshotOk === false` → E13 path: persist with `matched:false` (no pin), orientation ~0 (markerId truthy).
- `snapshotOk === true && index === undefined` → HARD REFUSAL (PREV_TURN text), nothing persisted.

### Task 3: DELETE content branches

- `describeTarget`: remove the `by_content_includes` line; keep `by_tool_call_id`, `by_tool_name`, defensive `"message"` fallbacks.
- `targetIsStructurallyValid`: remove the `by_content_includes` line; update JSDoc (remove the content-arm degenerate-match paragraph; empty by_tool_call_id/by_tool_name still provably never match → refuse `target discriminator must be non-empty`).

### Task 4: JSDoc (Mode A)

- `resolveTargetEntryId`: document the span binding, the `index`/`snapshotOk` return contract, cite §2 step 3 v2.0 + E13.
- `shrinkExecute`: document the step order incl. the hard refusal, quoting the EXACT refusal string and noting refusals never persist and never carry the orientation line.

### Task 5: ALIGN `test/tools/shrink.test.ts` (minimal, NOT the R2 lock)

- Existing matched:yes cases: ensure fixtures script a `role:"user"` message BEFORE the toolResult entries so the target falls inside `currentTurnSpan`.
- Existing matched:no-persists cases (E8-styled): these become HARD REFUSALS — either retarget the fixture in-span-but-unmatched is impossible post-v2.0 (well-formed + no in-turn match = refusal), so convert them to expect the refusal text + `appendShrinkMarker` NOT called, and keep ONE throwing-snapshot case (`throwOnBuildContextEntries`) asserting persist + `Matched: no` + orientation `~0`.
- Do not add the full R2 matrix (P1.M2.T2.S1).

## Validation Loop

### Level 1: Types & Lint

```bash
npm run typecheck        # tsc --noEmit — zero errors
npx vitest run test/tools/shrink.test.ts   # targeted suite
```

### Level 2: Full suite

```bash
npx vitest run           # all green — esp. transforms.test.ts (untouched) and filter.test.ts (untouched)
```

### Level 3: Behavioral spot-checks (via the targeted suite)

- In-span `by_tool_call_id` → success text contains `Matched: yes` + orientation line; marker payload has `pinnedEntryId`.
- Fixture where the only matching toolResult precedes the last user message → exact refusal string, no appendEntry call recorded by makePi.
- `throwOnBuildContextEntries` → persisted, `Matched: no`, `~0 tokens shed`.

## Final Validation Checklist

- [ ] `npm run typecheck` clean; `npx vitest run` green.
- [ ] Exact refusal string grep: `that result is from a previous turn; only this turn's tool calls can be shrunk` present in shrink.ts (JSDoc + code).
- [ ] No `by_content_includes` in shrink.ts.
- [ ] ShrinkParams / SHRINK_DESC / prepareArguments / notify echo untouched (S1's contract).
- [ ] transforms.ts, markers.ts, filter.ts untouched.
- [ ] E13 path (throwing snapshot) still persists matched:false.

## Anti-Patterns to Avoid

- ❌ Don't pin or persist from the full-history classification resolve — it exists only to explain the refusal.
- ❌ Don't make "earlier-turn" and "no-match" produce different texts — spec mandates ONE string.
- ❌ Don't add the orientation line to any refusal path.
- ❌ Don't rewrite the test file into the full R2 matrix — that's P1.M2.T2.S1.
- ❌ Don't throw anywhere on the execute path (E13).