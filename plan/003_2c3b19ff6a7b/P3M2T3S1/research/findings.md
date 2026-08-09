# Research Findings — P3.M2.T3.S1 (Thread pi into contextHandler + stale retirement)

## The canonical in-repo pattern to mirror (THE most important finding)

`src/nudges.ts` already solved the EXACT problem this task faces: an event handler that needs `pi`
to call an `appendXxx(pi, ...)` wrapper, but the Pi callback only receives `(event, ctx)`.

```ts
// nudges.ts — the exported handler takes pi FIRST, so it is directly testable with a fake pi
export function turnEndMetricHandler(pi: ExtensionAPI, event: TurnEndEvent, ctx: ExtensionContext): void { ... }

// nudges.ts — registerXxx captures pi in a closure and re-passes it to the handler
export function registerTurnEndMetric(pi: ExtensionAPI): void {
  pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext): void => {
    turnEndMetricHandler(pi, event, ctx);
  });
}
```

`contextHandler` must adopt this SAME shape:
- `contextHandler(pi, event, ctx)` (pi first).
- `registerFilterHandler(pi)` → `pi.on("context", (event, ctx) => contextHandler(pi, event, ctx))`.

The nudges.ts JSDoc even calls this out verbatim: *"WHY pi is a parameter (GOTCHA #2): the turn_end
callback only receives (event, ctx), but this handler must call appendTurnMetric(pi, ctx, …)... so the
exported handler is directly testable with a fake pi."* This is the exact rationale for THIS task too.

## Current state of the dependency chain (all confirmed by reading source)

| Dep                         | Status        | Evidence |
|-----------------------------|---------------|----------|
| `appendCancelMarker(pi,ctx,{targetId})` (P3.M1.T1.S1) | LANDED | `src/markers.ts` — present, takes `CancelMarkerInput = {targetId}`, returns entry id or null, never throws |
| readMarkers cancel-drop (P3.M1.T2.S1) | LANDED | `src/filter.ts` — `markers.shrinks` is ALREADY the ACTIVE shrinks (cancelled ids dropped); `MarkersBundle.cancelledIds: Set<string>` present |
| `config.shrink.maxActive` (32) + `staleAfterFires` (3) (P3.M2.T1.S1) | LANDED | `src/config.ts` — both present in interface, DEFAULT_CONFIG, and validateConfig (coerceNumber mustBePositive) |
| `rt.shrinkMissCounts: Map<string,number>` (P3.M2.T2.S1) | PARALLEL (treat as CONTRACT) | Its PRP adds the field to SessionRuntime + `new Map()` in freshRuntime. Keyed by shrink marker `id`. resetRuntime/clearAll wipe it. |

## resolvePinnedShrink — the exact contract (src/transforms.ts:828-859)

```ts
export function resolvePinnedShrink(
  messages: MessageLike[],       // MUST be event.messages (PRE-filterPipeline), NOT the filtered view
  branchEntries: BranchEntry[],  // ctx.sessionManager.getBranch() (ROOT→LEAF)
  pinnedEntryId: string,         // the shrink's pinnedEntryId (stable ENTRY id)
): number | null                 // message index if target present, null if absent/indeterminate
```

- Pi-free, exported, NEVER throws. Returns **null** when the target entry is absent (compacted away /
  wrong branch / alignment indeterminate) — this null IS the "stale" signal.
- **CRITICAL — use `event.messages`, the PRE-filter list.** filterPipeline REMOVES messages (rewinds),
  so the filtered view is no longer aligned with `branchEntries` by identity. The branch-aligned list is
  the raw `event.messages`. The work-item contract pins `resolvePinnedShrink(event.messages, branchEntries, ...)`.
- `branchEntries` is ALREADY read once in contextHandler as `ctx.sessionManager.getBranch()` — REUSE that
  local; do NOT call getBranch() a second time.

## Stale-retirement logic (the heart of the task) — pinned EXACTLY by the work-item contract

- Only process shrinks that HAVE a `pinnedEntryId` (live shrinks re-resolve each fire — they cannot "go stale";
  they just no-op harmlessly when their selector no longer matches). Read pinnedEntryId via `readOwn(sh,"pinnedEntryId")`.
- For each such shrink:
  - `hit = resolvePinnedShrink(event.messages, branchEntries, pinnedEntryId) !== null`
  - `id = readOwn(sh, "id")` (the uuid; same id readMarkers keys cancelledIds against — drives targetId)
  - hit → `rt.shrinkMissCounts.set(id, 0)` (reset)
  - miss → `rt.shrinkMissCounts.set(id, (rt.shrinkMissCounts.get(id) ?? 0) + 1)`
  - if `(rt.shrinkMissCounts.get(id) ?? 0) >= config.shrink.staleAfterFires` → `appendCancelMarker(pi, ctx, { targetId: id })`
- The append takes effect on the **NEXT** fire (readMarkers drops the cancelled id then) — NO in-fire
  mutation of `markers.shrinks`. So the count naturally stops incrementing: next fire the shrink is gone
  from `markers.shrinks` → not iterated. appendCancelMarker is thus called at most once per stale shrink
  (if it FAILS/returns null, the shrink stays → count keeps rising → retried next fire — desired).
- **NEVER throws**: wrap the WHOLE retirement pass in its OWN inner try/catch INSIDE the outer try/catch.
  A retirement failure must not break the turn (E13) — the already-computed `messages` are still returned.

## Test impact — NON-TRIVIAL (the biggest implementation risk)

The signature change `(event,ctx)` → `(pi,event,ctx)` means **14 existing `contextHandler(event, ctx)`
call sites in `test/filter.test.ts` BREAK** (lines 287,300,312,331,338,346,366,373,380,381,387,388...).
Each must be prepended with a fake `pi`. The existing `makePi()` fake only captures `.on` — it needs an
`appendEntry` capture (record `customType` + `data`) for the stale-retirement assertions.

The `registerFilterHandler` test (line ~407) calls the registered handler as `(handlers["context"])(event, ctx)`
— this is the WRAPPER boundary, which STILL receives `(event, ctx)` (the wrapper internally calls
`contextHandler(pi, event, ctx)`). So that test stays (event, ctx) at the boundary, but its fake pi must
gain appendEntry if asserting retirement through registration.

## Validation commands (verified present in package.json)

- `npx tsc --noEmit` — type gate (no separate build script; tsc is a devDependency).
- `npm test` (= `vitest run`) — full suite.
- `npx vitest run test/filter.test.ts` — the affected file in isolation.
- No linter/formatter configured (only `test` + `smoke` scripts). Do NOT invent one.

## No external research needed

This is a pure internal TypeScript/vitest task. The Pi extension API surface (`pi.on`, `pi.appendEntry`,
`ContextEvent`, `ExtensionAPI`, `ExtensionContext`) is already exercised identically by the in-repo
`turnEndMetricHandler` (nudges.ts) — which IS the authoritative example to mirror. No external library docs
add value over the in-repo pattern; the work-item contract + nudges.ts pattern are fully sufficient.