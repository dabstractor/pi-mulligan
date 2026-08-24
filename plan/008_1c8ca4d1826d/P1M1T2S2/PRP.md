# PRP — P1.M1.T2.S2: Enforce the marker's issuing-turn span on BOTH shrink paths (fail-safe no-op)

## Goal

**Feature Goal**: `filterPipeline`'s shrink pass (src/transforms.ts:~1562-1606) enforces the §2 ruling: a shrink may only substitute within **its marker's ISSUING turn's span** — never earlier, never later — on both resolution paths, with fail-safe no-op (E8-style silence, never throw, never widen) when the span is unavailable or the target falls outside it. In-span markers keep applying across later turns (persistence).

**Deliverable**: (1) per-marker `span = markerTurnSpan(messages, branch, markerEntryId)` computed in the shrink loop; `null` or missing markerEntryId → `continue` (no-op that fire); (2) PINNED path: additional `origIdx ∈ [span.start, span.end)` check; (3) LIVE path: `applyShrink` gains an optional 4th param `span?` threaded to the already-span-aware 3-arg `resolveShrinkTarget`; the pipeline translates the ORIGINAL-space span into reduced space via `reducedToOrig` before calling. JSDoc [Mode A] on both sites.

**Success Definition**: `npm run typecheck` green; `npx vitest run` green; pinned in-span shrink issued in turn N still applies after user sends turn N+1 (behavior surface for P1.M1.T3.S2's regression test); out-of-span pinned and live targets no-op every fire; no change to applyShrinkAt, stampShrink, E25 render-only discipline, or filter.ts stale-retirement.

## Why

PRD v2.0 (spec/06 §5 v2.0) makes the filter independently enforce the scope bound as defense in depth. The binding ruling (architecture/scope_guard_design.md §§1-2; PRD §2): the bound is the **marker's issuing turn**, not the fire-time current turn — a fire-time bound would expire markers at the next prompt, resurrect the shed bloat, and re-invalidate the tail cache (persistence is retained). The guard exists to no-op malformed/legacy markers whose target predates the marker's own turn, and to stop live selectors from drifting beyond their marker's turn. This subtask consumes the primitives delivered by P1.M1.T2.S1 (`markerTurnSpan`, `markerEntryId` threading) and P1.M1.T1.S2 (3-arg `resolveShrinkTarget`).

## What

1. **Compute the span per marker** in the shrink loop, in ORIGINAL `messages` space:
   ```ts
   const markerEntryIdRaw = readOwn(sh, "markerEntryId");
   const span = typeof markerEntryIdRaw === "string" && markerEntryIdRaw.length > 0
     ? markerTurnSpan(messages, branch, markerEntryIdRaw)
     : null;
   if (span === null) continue; // fail-safe no-op (E8/E13; old bundles, compacted-head marker — identity no-ops too)
   ```
2. **PINNED path**: after `origIdx = resolvePinnedShrink(messages, branch, pinnedId)` resolves non-null and before the `removedOrig` check, add: `if (origIdx < span.start || origIdx >= span.end) continue;` (pure defense in depth — identity resolution is already scope-safe for well-formed markers; this no-ops malformed/legacy ones). Keep `removedOrig` + binary-search translation + `applyShrinkAt` UNCHANGED.
3. **LIVE path**: add an optional 4th param to `applyShrink`:
   ```ts
   export function applyShrink(
     messages: MessageLike[],
     marker: { target: ShrinkTargetRead; replacement: string; pinnedEntryId?: string },
     branchEntries?: BranchEntry[],
     span?: { start: number; end: number },   // NEW — issuing-turn bound (PRD §2 ruling)
   ): MessageLike[]
   ```
   Thread it into the live-resolution call only: `i = resolveShrinkTarget(messages, readOwn(marker, "target") as ShrinkTargetRead, span)`. (Optionally also pass it on the pinned branch of applyShrink for symmetry — `resolvePinnedShrink` ignores it; harmless but NOT required.) Then in the pipeline's LIVE branch, translate the ORIGINAL-space span into reduced space and call:
   ```ts
   const rSpan = translateSpanToReduced(span, reducedToOrig, messages.length);
   if (rSpan === null) continue; // boundary can't be translated / empty reduced span → conservative no-op
   m = applyShrink(m, sh, branchEntries, rSpan);
   ```
   Translation (module-local helper, ascending `reducedToOrig`, conservative — never widen):
   ```ts
   function lowerBoundAsc(arr: number[], v: number): number {
     let lo = 0, hi = arr.length;
     while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
     return lo;
   }
   function translateSpanToReduced(span, reducedToOrig, origLen) {
     const rStart = lowerBoundAsc(reducedToOrig, span.start);
     const rEnd = span.end >= origLen ? reducedToOrig.length : lowerBoundAsc(reducedToOrig, span.end);
     return rStart < rEnd ? { start: rStart, end: rEnd } : null;
   }
   ```
4. **UNCHANGED**: `applyShrink` substitution body, `stampShrink`/E25 render-only discipline, rewind phases, nudge injection, `filter.ts` stale-retirement pass (:380-410 — a permanently out-of-scope pinned marker now misses every fire and auto-retires via `shrinkMissCounts`; correct disposition, document in the wrap-up, do NOT special-case).
5. **DOCS [Mode A]**: JSDoc on (a) filterPipeline's shrink pass — cite spec/06 §5 v2.0 ("a marker whose target predates its turn no-ops at every fire") + the PRD §2 issuing-turn ruling + persistence rationale; (b) `applyShrink`'s new `span` param — issuing-turn bound, clamped by resolveShrinkTarget, undefined → full range (backward compat).

### Success Criteria

- [ ] Both paths enforce `[span.start, span.end)`; `markerTurnSpan === null` / missing markerEntryId → no-op (fail-safe)
- [ ] In-span pinned shrink KEEPS applying after the user sends the next turn (no fire-time expiry)
- [ ] Live selector can never match outside the marker's issuing turn (earlier or later) — even after rewind translation
- [ ] Translation is conservative: never widens; untranslatable/empty reduced span → no-op
- [ ] applyShrink 4th param optional → all existing 3-arg callers/tests unaffected; typecheck + full vitest suite green
- [ ] transforms.ts stays import-free (`grep -c '^import' src/transforms.ts` → 0); nothing throws (E13)
- [ ] filter.ts, markers.ts, tools/ untouched

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase": they need the exact current shrink-loop shape (pinned vs live branches, `reducedToOrig`/`removedOrig` mechanics), the S1 contract (`markerTurnSpan`/`markerEntryId`), the 3-arg `resolveShrinkTarget`, the §2 ruling, and the conservative-translation rule. All below.

### Documentation & References

```yaml
- file: src/transforms.ts
  why: THE file. Shrink loop :~1562-1606 (pinned branch resolves in ORIGINAL space then binary-searches
        reducedToOrig — mirror this for the span translation; live branch calls 3-arg applyShrink at :~1603).
        applyShrink :1030-1075 (add 4th param; live call to resolveShrinkTarget at :~1053). resolveShrinkTarget
        :827-877 (ALREADY span-aware — 3rd param clamps [start,end), undefined → full range; DO NOT edit).
        markerTurnSpan (S1, near :920 — CONTRACT). resolvePinnedShrink :918 (ORIGINAL-space resolution).
  pattern: readOwn for every field access; plain returns; no Pi imports; never throws.
  gotcha: pinned identity resolution is inherently scope-safe for well-formed markers — the explicit
          origIdx∈span check is pure defense in depth for malformed/legacy markers. KEEP removedOrig +
          translation logic byte-for-byte.

- file: plan/008_1c8ca4d1826d/P1M1T2S1/PRP.md
  why: CONTRACT for markerTurnSpan (signature, ORIGINAL-space semantics, null-on-indeterminate) and
        ShrinkMarkerLike.markerEntryId (threaded by readMarkers; absent on old bundles → span null → no-op).

- file: plan/008_1c8ca4d1826d/architecture/scope_guard_design.md
  why: §1 the binding ruling (issuing turn, NOT fire-time current turn); §2.3 enforcement points incl. the
        recommended original-space-first + conservative translate/clamp approach; §3 the persistence regression.

- spec: spec/06-context-filter.md §5 v2.0 (current-turn scope, defense in depth), §5.1 (stampShrink — render-only,
        UNCHANGED), §12 (pipeline pseudocode)
- spec: spec/08-edge-cases.md E8 (no-op + retry), E13 (never throw), E25 (render-only stamp)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the bound is the MARKER'S ISSUING TURN — do NOT use currentTurnSpan(fire-time) here; that would
//   expire in-span markers at the next prompt (the exact regression the ruling forbids).
// CRITICAL: markerTurnSpan returns ORIGINAL-space indices; the LIVE path resolves against the REDUCED array m —
//   you MUST translate (lowerBound on ascending reducedToOrig) or the span is meaningless in reduced space.
// CRITICAL: never WIDEN — lowerBound clamps boundaries to survivors only; untranslatable/empty → no-op.
// GOTCHA: removedOrig/binary-search translation on the pinned path is EXISTING machinery — add ONLY the
//   origIdx∈[span.start,span.end) check; touch nothing else in that branch.
// GOTCHA: transforms.ts has zero imports — reuse in-scope helpers only; add the two small local helpers
//   (lowerBoundAsc, translateSpanToReduced) module-private, near filterPipeline.
// GOTCHA: applyShrinkAt and stampShrink stay 3-arg/unchanged — the span is enforced BEFORE index resolution
//   reaches them; E25 render-only discipline untouched.
// GOTCHA: span null (old bundle, compacted-head marker, markerEntryId missing) → continue — silent no-op,
//   E8-style; do NOT fall back to an unbounded resolve.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD module-local helpers in src/transforms.ts (near filterPipeline)
  - lowerBoundAsc(arr: number[], v: number): number  — standard binary lower bound
  - translateSpanToReduced(span, reducedToOrig, origLen): {start,end} | null — conservative translate/clamp;
    rStart< rEnd required else null (empty reduced span → no-op)

Task 2: WIDEN applyShrink signature (src/transforms.ts :1030)
  - ADD optional 4th param span?: { start: number; end: number }
  - THREAD into the LIVE resolveShrinkTarget call only (pinned branch keeps resolvePinnedShrink)
  - JSDoc: issuing-turn bound per PRD §2 ruling / spec/06 §5 v2.0; clamped by resolver; undefined → full range
    (backward compat — old callers/tests unaffected)

Task 3: MODIFY filterPipeline's shrink loop (src/transforms.ts :~1574)
  - PER MARKER: readOwn(sh,"markerEntryId") → markerTurnSpan(messages, branch, id); null/absent → continue
  - PINNED branch: after origIdx resolves non-null, require origIdx ∈ [span.start, span.end) else continue
    (before the removedOrig check is fine; order between the two checks is immaterial — both no-op)
  - LIVE branch: translateSpanToReduced(span, reducedToOrig, messages.length) → null → continue; else
    m = applyShrink(m, sh, branchEntries, rSpan)
  - JSDoc block above the loop: issuing-turn ruling + persistence + fail-safe no-op + auto-retirement note

Task 4: VERIFY
  - npm run typecheck && npx vitest run
  - grep -c '^import' src/transforms.ts → 0
  - grep -n "markerTurnSpan\|translateSpanToReduced" src/transforms.ts → definition + pipeline call sites only
```

### Implementation Patterns & Key Details

```ts
// Shrink-loop skeleton (only the NEW lines shown; everything else byte-identical):
for (const sh of stableSortBySeq(shrinks)) {
  const markerEntryIdRaw = readOwn(sh, "markerEntryId");
  const span = (typeof markerEntryIdRaw === "string" && markerEntryIdRaw.length > 0)
    ? markerTurnSpan(messages, branch, markerEntryIdRaw) : null;
  if (span === null) continue;                       // fail-safe no-op (E8/E13)
  const pinnedId = readOwn(sh, "pinnedEntryId");
  if (typeof pinnedId === "string" && pinnedId.length > 0) {
    const origIdx = resolvePinnedShrink(messages, branch, pinnedId);
    if (origIdx === null) continue;
    if (origIdx < span.start || origIdx >= span.end) continue;   // NEW — issuing-turn guard
    if (removedOrig.has(origIdx)) continue;
    // ... existing binary-search translation + applyShrinkAt UNCHANGED ...
  } else {
    const rSpan = translateSpanToReduced(span, reducedToOrig, messages.length);
    if (rSpan === null) continue;                    // NEW — conservative no-op
    m = applyShrink(m, sh, branchEntries, rSpan);    // NEW 4th arg
  }
}
```

### Integration Points

```yaml
EXPORTS (src/transforms.ts):
  - CHANGED: applyShrink gains optional 4th param span? (backward compatible)
  - NEW (module-private): lowerBoundAsc, translateSpanToReduced
CONSUMED (from S1, treat as landed): markerTurnSpan, ShrinkMarkerLike.markerEntryId
NOT TOUCHED: applyShrinkAt, stampShrink, resolveShrinkTarget, resolvePinnedShrink, filter.ts (incl. stale-
  retirement pass :380-410), markers.ts, tools/ — a permanently out-of-scope pinned marker misses every fire
  and auto-retires via shrinkMissCounts after staleAfterFires (correct; document in wrap-up, no special-case)
TESTS: full-suite lock is P1.M1.T3.S2 — here only keep vitest green (no new tests required)
```

## Validation Loop

### Level 1: Type check

```bash
npm run typecheck    # 0 errors (S1 may land in parallel; joint gate at merge)
```

### Level 2: Tests

```bash
npx vitest run       # all green — existing applyShrink/pipeline tests must pass unchanged (4th param optional)
```

### Level 3: Contract assertions

```bash
grep -c '^import' src/transforms.ts                              # → 0
grep -n "markerTurnSpan" src/transforms.ts                       # definition + the ONE pipeline call site
grep -n "translateSpanToReduced\|lowerBoundAsc" src/transforms.ts # private helpers + call sites
grep -n "span" src/transforms.ts | grep -i "applyShrinkAt\|stampShrink"   # expect nothing — unchanged
grep -n "markerEntryId\|markerTurnSpan" src/filter.ts             # S1 sites only — NO new filter.ts edits
```

## Final Validation Checklist

- [ ] `npm run typecheck` passes; `npx vitest run` green with zero test edits
- [ ] Shrink loop computes markerTurnSpan per marker; null/missing markerEntryId → silent no-op
- [ ] PINNED: origIdx ∈ [span.start, span.end) enforced; removedOrig + translation + applyShrinkAt unchanged
- [ ] LIVE: span translated to reduced space conservatively; untranslatable/empty → no-op; applyShrink 4th arg
- [ ] In-span pinned shrink persists across later turns (no fire-time expiry) — surface ready for P1.M1.T3.S2
- [ ] transforms.ts import-free, never throws, filter.ts/markers.ts/tools untouched
- [ ] [Mode A] JSDoc on the shrink pass + applyShrink's span param, citing spec/06 §5 v2.0 + PRD §2 ruling

## Anti-Patterns to Avoid

- ❌ Do NOT use currentTurnSpan (fire-time) as the bound — that is the exact regression the ruling forbids
- ❌ Do NOT widen the span when translation is ambiguous — no-op is ALWAYS the safe answer
- ❌ Do NOT touch applyShrinkAt / stampShrink / the rewind phases / filter.ts
- ❌ Do NOT make the 4th applyShrink param required — 3-arg callers (tests) must stay valid
- ❌ Do NOT special-case out-of-scope markers in the stale-retirement pass — shrinkMissCounts handles them