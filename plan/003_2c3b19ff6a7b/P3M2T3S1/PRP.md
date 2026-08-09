# PRP — P3.M2.T3.S1: Thread pi into contextHandler + stale-marker retirement logic

## Goal

**Feature Goal**: Thread the Pi `ExtensionAPI` (`pi`) into `contextHandler` (mirroring the established `turnEndMetricHandler(pi, event, ctx)` pattern), then add a **stale-marker retirement pass** that auto-retires any pinned shrink whose target entry has been absent from the branch for `config.shrink.staleAfterFires` (default 3) consecutive `context` fires — by appending a `mulligan:cancel` marker (the same retraction primitive shipped in P3.M1). This bounds long-session filter cost (spec/08 E15) and retires shrinks whose target was compacted away.

**Deliverable**:
- `src/filter.ts` — modified: `contextHandler` signature becomes `(pi: ExtensionAPI, event: ContextEvent, ctx: ExtensionContext)`; `registerFilterHandler` wraps the handler to thread `pi` through; a new stale-retirement pass (own inner try/catch) runs after `filterPipeline`, before the return.
- `test/filter.test.ts` — modified: extend `makePi()` to capture `appendEntry`; update all existing `contextHandler(event, ctx)` call sites to `(pi, event, ctx)`; add a `contextHandler — stale-marker retirement` describe block.
- `spec/06-context-filter.md` — modified: §1 gains a short prose note documenting the retirement pass (Mode A: doc rides with the work).

**Success Definition**:
- `registerFilterHandler(pi)` wires `pi` through to `contextHandler` via a wrapper; `contextHandler` is directly callable as `contextHandler(pi, event, ctx)` with a fake pi.
- A pinned shrink whose target is ABSENT for `staleAfterFires` consecutive fires is auto-retired (a `mulligan:cancel` carrying its `id` is appended via `pi.appendEntry`).
- A pinned shrink whose target IS present does NOT get retired (miss count stays 0); `rt.shrinkMissCounts` resets to 0 on a hit.
- A LIVE shrink (no `pinnedEntryId`) is never considered for retirement.
- The retirement pass NEVER throws — even if `resolvePinnedShrink`/`appendCancelMarker` throw, the turn completes unchanged (E13).
- `npx tsc --noEmit` is clean; `npm test` is green (no regressions).

## Why

- Implements spec/08 **E15 (REQUIRED)**: "a pinned shrink whose target entry has been absent for `config.shrink.staleAfterFires` consecutive fires MUST be auto-retired (treated as cancelled per E21) so it stops being resolved every fire." Without this, a pinned shrink whose target was compacted away is re-resolved (and no-ops) on EVERY fire for the rest of the session — unbounded, pointless per-fire work.
- It is the immediate consumer of the parallel state container P3.M2.T2.S1 (`rt.shrinkMissCounts`), the already-landed config knobs P3.M2.T1.S1 (`shrink.staleAfterFires`), and the already-landed retraction primitive P3.M1.T1.S1 (`appendCancelMarker`) + P3.M1.T2.S1 (`readMarkers` cancel-drop). It RETIRES a marker by appending the SAME `mulligan:cancel` that the agent-facing `mulligan_cancel` tool (P3.M1.T3.S1) uses — one retraction mechanism, two callers (human-driven + automatic).
- It is the prerequisite for P3.M2.T3.S2 (the soft cap: retire oldest shrink when `active count > maxActive`), which adds its own retirement pass into the SAME spot in `contextHandler` and reuses the `pi`-threading this task introduces.

## What

**User-visible behavior**: None directly — this is an automatic background maintenance pass on the filter hot path. The observable effect is that a pinned shrink stops applying (its substitution no longer appears) after its target has been gone for N consecutive fires, and `mulligan_audit` (P3.M1.T4.S1) will report it as retired (the appended `mulligan:cancel` flows through `readMarkers.cancelledIds`).

**Technical requirements** (from the work-item contract — implement EXACTLY):
1. Change `contextHandler` signature to `(pi: ExtensionAPI, event: ContextEvent, ctx: ExtensionContext)`.
2. Change `registerFilterHandler` to: `pi.on("context", (event, ctx) => contextHandler(pi, event, ctx))`.
3. AFTER `filterPipeline` runs (on the filtered messages) and BEFORE the return, add the stale-retirement pass:
   - For each active shrink in `markers.shrinks` that has a `pinnedEntryId` (read via `readOwn`): call `resolvePinnedShrink(event.messages, branchEntries, pinnedEntryId)` to check if the target is present.
   - If present (non-null) → `rt.shrinkMissCounts.set(shrink.id, 0)` (reset).
   - If absent (null) → `rt.shrinkMissCounts.set(shrink.id, (rt.shrinkMissCounts.get(shrink.id) ?? 0) + 1)`.
   - If the count reaches `config.shrink.staleAfterFires` → `appendCancelMarker(pi, ctx, { targetId: shrink.id })` (auto-retire).
4. This append takes effect on the NEXT fire (`readMarkers` drops the cancelled id) — no in-fire mutation.
5. NEVER throws: wrap the stale-retirement pass in its OWN try/catch INSIDE the outer try/catch (a failure in retirement must not break the turn — E13).
6. Only process shrinks with a `pinnedEntryId` (live shrinks cannot go stale — they re-resolve each fire and either match or no-op harmlessly).

### Success Criteria
- [ ] `contextHandler(pi, event, ctx)` — `pi` is the first parameter.
- [ ] `registerFilterHandler(pi)` registers a wrapper: `pi.on("context", (event, ctx) => contextHandler(pi, event, ctx))`.
- [ ] A pinned shrink absent for `staleAfterFires` consecutive fires → `appendCancelMarker` called (the fake `pi.appendEntry` recorded a `"mulligan:cancel"` with `data.targetId === shrink.id`).
- [ ] A pinned shrink whose target IS present → NOT retired; `rt.shrinkMissCounts.get(id)` stays 0 (resets on hit).
- [ ] A live shrink (no `pinnedEntryId`) → never counted, never retired.
- [ ] The retirement pass never throws: a throwing `resolvePinnedShrink` is swallowed; the turn still returns `{ messages }` unchanged (E13).
- [ ] `npx tsc --noEmit` clean; `npm test` green.
- [ ] `spec/06-context-filter.md` §1 has a stale-retirement note.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP names: the EXACT in-repo pattern to mirror (`turnEndMetricHandler(pi, event, ctx)` + `registerTurnEndMetric` wrapper in `src/nudges.ts`); the EXACT signature of the Pi-free helper to call (`resolvePinnedShrink(messages, branchEntries, pinnedEntryId): number | null`, exported from `src/transforms.ts:828`); the EXACT miss-count logic (verbatim from the contract); the EXACT placement (after filterPipeline, before the return, in its own inner try/catch); the EXACT test impact (14 existing call sites that must gain a `pi` arg, listed); and the EXACT dependency state (all four upstream items, with evidence). An implementer who has never seen this repo can do it from this document + the two named source files (`src/filter.ts`, `src/nudges.ts`).

### Documentation & References

```yaml
# MUST READ — the file you are editing
- file: src/filter.ts
  why: |
    Contains (1) contextHandler (the function whose signature changes + gains the retirement pass),
    (2) registerFilterHandler (the registration seam that must wrap the handler to thread pi), and
    (3) the module-private readOwn/isRecord helpers (REUSE for reading shrink.id / pinnedEntryId —
    a Proxy get-trap may throw). It ALSO imports resolvePinnedShrink's CALL SITE indirectly: contextHandler
    already calls filterPipeline (transforms.ts) and reads branchEntries once (ctx.sessionManager.getBranch());
    reuse that branchEntries local for the retirement pass — do NOT call getBranch() a second time.
  pattern: |
    contextHandler currently: export function contextHandler(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void
    registerFilterHandler currently: export function registerFilterHandler(pi: ExtensionAPI): void { pi.on("context", contextHandler); }
  section: contextHandler (~lines 190-260) + registerFilterHandler (last function in the file)
  gotcha: |
    contextHandler is EXPORTED and called DIRECTLY in tests (no Pi callback) — that is why the signature
    must put pi FIRST (testable with a fake pi), exactly like turnEndMetricHandler. Do NOT capture pi in a
    module-scoped variable instead — that would break direct testability (the whole point of the pattern).

# MUST READ — the canonical in-repo pattern to mirror (THIS is the template)
- file: src/nudges.ts
  why: |
    turnEndMetricHandler(pi, event, ctx) + registerTurnEndMetric(pi) solve the IDENTICAL problem: an event
    handler that needs pi to call an appendXxx(pi, ...) wrapper, but the Pi callback only passes (event, ctx).
    Its JSDoc literally says: "WHY pi is a parameter (GOTCHA #2): the turn_end callback only receives
    (event, ctx), but this handler must call appendTurnMetric(pi, ctx, …)... so the exported handler is
    directly testable with a fake pi." Copy this design verbatim for contextHandler.
  pattern: |
    export function turnEndMetricHandler(pi: ExtensionAPI, event: TurnEndEvent, ctx: ExtensionContext): void { ... }
    export function registerTurnEndMetric(pi: ExtensionAPI): void {
      pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext): void => {
        turnEndMetricHandler(pi, event, ctx);
      });
    }
  section: turnEndMetricHandler + registerTurnEndMetric

# MUST READ — the Pi-free helper to call in the retirement pass
- file: src/transforms.ts
  why: |
    resolvePinnedShrink(messages, branchEntries, pinnedEntryId): number | null is the stale detector.
    Returns the message index if the pinned target ENTRY is present in branchEntries; returns null when the
    target is absent (compacted away / wrong branch / alignment indeterminate). NULL IS THE STALE SIGNAL.
    Pi-free + exported + never throws. Reuse it unchanged — do NOT reimplement presence detection.
  pattern: |
    const hit = resolvePinnedShrink(event.messages, branchEntries, pinnedEntryId) !== null;
  section: resolvePinnedShrink (~lines 800-859)
  gotcha: |
    Pass event.messages (the PRE-filter list), NOT the filtered `messages` variable. filterPipeline REMOVES
    messages (rewinds), which breaks the branchEntries↔messages identity alignment resolvePinnedShrink
    relies on. event.messages is the raw branch-aligned list. PINNED by the work-item contract.

# MUST READ — the test file to modify
- file: test/filter.test.ts
  why: |
    The signature change breaks 14 existing contextHandler(event, ctx) call sites — ALL must be prepended
    with a fake pi. makePi() (line ~102) currently captures ONLY .on; it MUST gain an appendEntry capture
    (record {customType, data}) for the stale-retirement assertions. The registerFilterHandler test calls
    the handler via (handlers["context"])(event, ctx) — that is the WRAPPER boundary (still (event, ctx)),
    so it needs no arg change, but its fake pi must gain appendEntry if asserting through registration.
  pattern: |
    // extended makePi (appendEntry capture):
    function makePi() {
      const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
      const appendCalls: { customType: string; data: unknown }[] = [];
      const pi = {
        on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
        appendEntry(customType: string, data: unknown) { appendCalls.push({ customType, data }); },
      };
      return { handlers, appendCalls, pi: pi as unknown as ExtensionAPI };
    }
  section: contextHandler describe (~lines 281-392) + registerFilterHandler describe (~lines 394-411) + makePi (line ~102)
  gotcha: |
    The 14 broken call sites are at lines 287,300,312,331,338,346,366,373,380,381,387,388 (grep confirmed).
    Each becomes contextHandler(fakePi, {type:"context",messages:...}, ctx). The disabled-pass-through test
    (line 287) returns BEFORE the retirement pass runs (config.enabled false), so its fake pi need not be
    elaborate — but it still needs the pi ARG for the type to check.

# CONTRACT — the parallel state container (treat as already-landed; do NOT touch runtime.ts)
- file: src/runtime.ts  (per plan/003_2c3b19ff6a7b/P3M2T2S1/PRP.md)
  why: |
    SessionRuntime gains shrinkMissCounts: Map<string, number> (keyed by shrink marker id, value = consecutive
    miss count). Initialized new Map() in freshRuntime (per-call, GOTCHA #5). getRuntime(sessionId).shrinkMissCounts
    is the live mutable reference the retirement pass .get/.set on. resetRuntime (session_start) + clearAll
    wipe it automatically. THIS TASK consumes it; it does NOT add it.
  pattern: |
    const rt = getRuntime(sessionId);            // already obtained at the top of contextHandler
    rt.shrinkMissCounts.set(id, 0);              // reset on hit
    rt.shrinkMissCounts.set(id, (rt.shrinkMissCounts.get(id) ?? 0) + 1);  // increment on miss
  gotcha: |
    rt is ALREADY obtained as `const rt = getRuntime(sessionId)` near the top of contextHandler — REUSE it;
    do NOT call getRuntime a second time.

# CONTRACT — the appendCancelMarker wrapper (already-landed by P3.M1.T1.S1)
- file: src/markers.ts
  why: |
    appendCancelMarker(pi: ExtensionAPI, ctx: ExtensionContext, data: { targetId: string }): string | null
    persists a mulligan:cancel custom entry and NEVER throws (returns null on failure). targetId = the
    marker's uuid `id` field (RewindMarker.id / ShrinkMarker.id), NOT the Pi entry id. readMarkers
    (P3.M1.T2.S1, landed) will drop that shrink on the NEXT fire. THIS TASK calls it; it does NOT modify it.
  pattern: |
    appendCancelMarker(pi, ctx, { targetId: id });   // id = the shrink's uuid id (readOwn(sh, "id"))
  gotcha: |
    Do NOT validate targetId existence before calling — appendCancelMarker is dumb persistence by design
    (validation is the cancel TOOL's job, P3.M1.T3.S1). The retirement pass already KNOWS the shrink is
    active (it came from markers.shrinks, which already excludes cancelled ids). The append's return value
    (entry id | null) is IGNORED — fire-and-forget; next fire's readMarkers does the drop.

# CONTRACT — config knobs (already-landed by P3.M2.T1.S1)
- file: src/config.ts
  why: |
    config.shrink.staleAfterFires (number, default 3, validated > 0) is the retirement threshold. Read via
    the already-obtained `const config = getConfig()` at the top of contextHandler — REUSE it. (The sibling
    soft-cap knob shrink.maxActive is P3.M2.T3.S2, NOT this task — do not add cap logic.)
  gotcha: Use `>= staleAfterFires` ("reaches"). With default 3: counts 1,2,3 → retire on the 3rd miss.

# CONSUMER-SAFETY (no edit needed; documented for awareness)
- file: src/index.ts
  why: |
    registerFilterHandler(pi) is called once at the factory. The signature change is INTERNAL to
    filter.ts — registerFilterHandler still takes (pi) and still registers on "context". index.ts is UNCHANGED.
    (It does NOT call contextHandler directly; only through pi.on.)

# Architecture reference (read-only; describes the verified pattern)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  why: "Pattern 7 (Stale retirement + cap) sketches the exact pass + the pi-in-contextHandler GOTCHA.
        NOTE: it ALSO sketches the soft-cap (maxActive) retirement — that is P3.M2.T3.S2, NOT this task.
        Implement ONLY the stale-retirement half (the pinned-shrink miss-count loop) here; leave cap to S2."
  section: "G2 / P3.M2 — Pattern 7 (stale-retirement half only)"

# Spec source (read-only context)
- docfile: spec/08-edge-cases.md
  section: "E15. Very large number of accumulated markers/notes (long sessions)" + "E21. Marker retraction"
  why: E15 (REQUIRED) mandates the stale-retirement; E21 defines the mulligan:cancel retraction this reuses.
```

### Current Codebase tree (relevant slice)

```bash
src/
  filter.ts            # <-- MODIFY: contextHandler signature + pi threading + retirement pass
  nudges.ts            # read-only template (turnEndMetricHandler/registerTurnEndMetric — the pattern to mirror)
  transforms.ts        # read-only dep (resolvePinnedShrink — the stale detector; exported, Pi-free)
  markers.ts           # read-only dep (appendCancelMarker — already-landed)
  runtime.ts           # CONTRACT-only (shrinkMissCounts added by parallel P3.M2.T2.S1)
  config.ts            # read-only dep (shrink.staleAfterFires — already-landed)
  index.ts             # NO CHANGE (calls registerFilterHandler(pi); signature unchanged)
test/
  filter.test.ts       # <-- MODIFY: makePi += appendEntry capture; 14 call sites += pi arg; + retirement tests
spec/
  06-context-filter.md # <-- MODIFY: §1 stale-retirement note (Mode A)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/filter.ts              # EXTENDED in place (no new file). contextHandler gains pi + retirement pass.
test/filter.test.ts        # EXTENDED in place. makePi += appendEntry; call sites updated; + retirement describe.
spec/06-context-filter.md  # EXTENDED in place. §1 prose note.
# No new files. All changes are additive/edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — pi FIRST, mirror turnEndMetricHandler. contextHandler(pi, event, ctx). The Pi "context"
//   callback only passes (event, ctx); registerFilterHandler must WRAP: pi.on("context", (event, ctx) =>
//   contextHandler(pi, event, ctx)). Do NOT capture pi in a module-scoped variable — that breaks the
//   direct-testability that is the entire reason for the pattern (nudges.ts GOTCHA #2).

// CRITICAL — use event.messages (PRE-filter) for resolvePinnedShrink, NOT the filtered `messages` variable.
//   filterPipeline REMOVES messages (rewinds), breaking the branchEntries↔messages identity alignment.
//   event.messages is the raw branch-aligned list. Pinned verbatim by the work-item contract.

// CRITICAL — REUSE the already-read locals. contextHandler already does `const rt = getRuntime(sessionId)`,
//   `const config = getConfig()`, and `const branchEntries = ctx.sessionManager.getBranch()` near its top.
//   The retirement pass uses those SAME locals — do NOT re-fetch getRuntime/getConfig/getBranch.

// CRITICAL — own INNER try/catch INSIDE the outer try/catch. The retirement pass is its own try/catch so a
//   retirement failure (resolvePinnedShrink throws, appendCancelMarker throws) is logged/swallowed and the
//   turn still returns the already-computed { messages }. The outer try/catch remains the last line of defense.
//   A retirement failure must NOT reach the outer catch and return void (that would pass-through = lose the
//   filter transform for the whole turn). So: retirement try/catch returns/continues to the normal return.

// CRITICAL — read shrink.id and pinnedEntryId via readOwn(sh, "id") / readOwn(sh, "pinnedEntryId") — the
//   module-private defensive helper (a Proxy get-trap may throw; readOwn swallows it → undefined → safe).
//   NEVER use sh.id / sh.pinnedEntryId directly.

// CRITICAL — only process shrinks WITH a pinnedEntryId. Live shrinks (no pinnedEntryId) re-resolve each
//   fire and either match or no-op harmlessly — they CANNOT go stale. Filter: readOwn(sh,"pinnedEntryId")
//   is a non-empty string.

// GOTCHA — `>= staleAfterFires` ("reaches"). Default 3: counts climb 1,2,3; on the 3rd miss count === 3 → retire.
//   appendCancelMarker is then called at most ONCE for this shrink: next fire readMarkers drops it (its id
//   is now in cancelledIds) so it leaves markers.shrinks and is no longer iterated. If appendCancelMarker
//   FAILS (returns null) the cancel is not persisted → shrink stays → count keeps climbing → retried next
//   fire (desired). No explicit "already retired" guard needed — readMarkers handles it.

// GOTCHA — markers.shrinks is ALREADY the ACTIVE shrinks (P3.M1.T2.S1 landed): readMarkers drops any shrink
//   whose id ∈ cancelledIds BEFORE returning. So the retirement pass only ever sees live+active pinned
//   shrinks — a just-cancelled shrink never re-enters the loop. Do NOT re-filter by cancelledIds here.

// GOTCHA — the 14 existing contextHandler(event, ctx) call sites in test/filter.test.ts ALL break on the
//   signature change. They MUST each be prepended with a fake pi. The registerFilterHandler test's
//   (handlers["context"])(event, ctx) call stays (event, ctx) (wrapper boundary) but makePi needs appendEntry.

// GOTCHA — NO new import of appendCancelMarker into filter.ts is needed for the LOGIC if you import it; BUT
//   filter.ts currently imports ONLY RewindMarker/ShrinkMarker/TurnMetric (type-only) from markers.ts. You
//   MUST add a runtime import: `import { appendCancelMarker } from "./markers.js";` (it is a function, not a
//   type). Add it alongside the existing type-only marker import. Also import resolvePinnedShrink from
//   transforms.js (runtime import) — it is currently NOT imported (filterPipeline is the only transforms import).

// GOTCHA — the retirement pass appends a mulligan:cancel to the SESSION (pi.appendEntry), which is a write.
//   This is the ONLY write contextHandler performs (it is otherwise read-only / soft-over-hard). It is safe:
//   appendCancelMarker never throws, and a custom entry is NOT in LLM context (it does not pollute this turn's
//   messages — the return uses the already-computed `messages`). The cancel takes effect next fire.
```

## Implementation Blueprint

### Data models and structure

No data-model change in this task (the `shrinkMissCounts` Map is added by the parallel P3.M2.T2.S1; `config.shrink.staleAfterFires` by P3.M2.T1.S1; `appendCancelMarker` by P3.M1.T1.S1). This task is pure wiring + a pass.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/filter.ts — add the two runtime imports
  - ADD to the existing `import type { ... } from "./markers.js";` line's sibling: a RUNTIME import
    `import { appendCancelMarker } from "./markers.js";` (keep the type-only import separate or merge —
    either is fine, but appendCancelMarker MUST be a runtime/value import, not type-only).
  - ADD to the transforms imports: `resolvePinnedShrink` (runtime import). The current line is
    `import { filterPipeline } from "./transforms.js"; import type { MessageLike, BranchEntry } from "./transforms.js";`
    Change the first to `import { filterPipeline, resolvePinnedShrink } from "./transforms.js";`.
  - WHY: the retirement pass calls both functions; they must be imported as values.
  - GOTCHA: do not accidentally turn filterPipeline/appendCancelMarker into type-only imports — they are values.

Task 2: MODIFY src/filter.ts — change contextHandler signature (pi first)
  - EDIT the signature from:
      `export function contextHandler(event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void {`
    to:
      `export function contextHandler(pi: ExtensionAPI, event: ContextEvent, ctx: ExtensionContext): ContextEventResult | void {`
  - UPDATE the JSDoc @param block to add `@param pi the Pi ExtensionAPI (appendCancelMarker → pi.appendEntry).`
    and a "WHY pi is a parameter" note mirroring nudges.ts turnEndMetricHandler's GOTCHA #2 comment:
      "The `context` callback only receives (event, ctx), but this handler must call appendCancelMarker(pi, …)
       (→ pi.appendEntry) for stale-marker retirement (spec E15). registerFilterHandler captures pi in a closure
       and passes it here, so the exported handler is directly testable with a fake pi (mirrors turnEndMetricHandler)."
  - NO body changes yet in this task (the existing rt/config/branchEntries/markers/filterPipeline/nudge/cache/return
    logic is untouched). ExtensionAPI is already imported type-only at the top of filter.ts (no new type import).

Task 3: MODIFY src/filter.ts — add the stale-retirement pass (after filterPipeline+nudge+cache, before return)
  - PLACE: immediately BEFORE the final `return { messages: messages as unknown as ... };` statement (and after
    the observability try/catch block). It does NOT mutate `messages`, so it can run last.
  - STRUCTURE: its OWN inner try/catch INSIDE the outer try/catch. A retirement failure is logged and swallowed;
    execution continues to the normal return (the turn is NOT broken, the already-computed messages ARE returned).
  - CODE (verbatim per the contract):
      ```typescript
      // P3.M2.T3.S1 / spec E15: stale-marker retirement. A PINNED shrink whose target ENTRY has been absent
      // from the branch for config.shrink.staleAfterFires consecutive fires is auto-retired (a mulligan:cancel
      // is appended — the SAME retraction primitive the cancel tool uses, P3.M1). The cancel takes effect on
      // the NEXT fire (readMarkers drops the cancelled id) — NO in-fire mutation. Only PINNED shrinks can go
      // stale (live shrinks re-resolve each fire and no-op harmlessly). NEVER throws: own try/catch (E13).
      try {
        const staleAfterFires = config.shrink.staleAfterFires;
        for (const sh of markers.shrinks) {
          const pinnedEntryId = readOwn(sh, "pinnedEntryId");
          if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) continue; // live shrink → skip
          const id = readOwn(sh, "id");
          if (typeof id !== "string" || id.length === 0) continue; // unreadable id → skip (defensive)
          // resolvePinnedShrink aligns branchEntries with event.messages (PRE-filter) by identity; null = absent.
          const hit = resolvePinnedShrink(
            event.messages as unknown as MessageLike[],
            branchEntries as unknown as BranchEntry[],
            pinnedEntryId,
          ) !== null;
          if (hit) {
            rt.shrinkMissCounts.set(id, 0); // target present → reset miss count
          } else {
            const misses = (rt.shrinkMissCounts.get(id) ?? 0) + 1;
            rt.shrinkMissCounts.set(id, misses);
            if (misses >= staleAfterFires) {
              appendCancelMarker(pi, ctx, { targetId: id }); // auto-retire (next fire drops it); never throws
            }
          }
        }
      } catch (retireErr) {
        // Retirement failure must not break the turn (E13). Log + continue to the normal return.
        try {
          log("warn", "filter.retire", sessionId, { error: retireErr instanceof Error ? retireErr.message : String(retireErr) });
        } catch {
          /* log() never throws, but be safe */
        }
      }
      ```
  - FOLLOW pattern: the existing observability try/catch (its own inner try/catch that never breaks the turn).
  - GOTCHA: `event.messages` (PRE-filter) — NOT the `messages` variable (post-filter). `branchEntries` and `rt`
    and `config` are the already-read locals; reuse them. `log` is already imported.
  - GOTCHA: the cast `event.messages as unknown as MessageLike[]` mirrors the EXISTING filterPipeline call site's
    cast (Pi AgentMessage[] → transforms MessageLike[] at this boundary). branchEntries cast is identical to the
    existing filterPipeline call. Copy those casts verbatim.
  - NOTE: log level "warn" (not "error") — a retirement failure is non-fatal best-effort maintenance, matching
    the observability block's "info" tone and the fail-open discipline. (If log.ts lacks a "warn" level, use
    "error" — check src/log.ts signature; it accepts (level, scope, sessionId, fields). See Validation Task.)

Task 4: MODIFY src/filter.ts — change registerFilterHandler to thread pi
  - EDIT from:
      `export function registerFilterHandler(pi: ExtensionAPI): void { pi.on("context", contextHandler); }`
    to:
      ```typescript
      export function registerFilterHandler(pi: ExtensionAPI): void {
        // Thread pi through: the `context` callback only passes (event, ctx), but contextHandler needs pi for
        // appendCancelMarker (stale retirement, P3.M2.T3.S1). Mirrors registerTurnEndMetric (nudges.ts).
        pi.on("context", (event: ContextEvent, ctx: ExtensionContext) => contextHandler(pi, event, ctx));
      }
      ```
  - GOTCHA: do NOT inline contextHandler's body into the arrow — keep contextHandler a named export so tests can
    call it directly with a fake pi. The arrow is a thin pass-through, exactly like registerTurnEndMetric.

Task 5: MODIFY test/filter.test.ts — extend makePi with appendEntry capture
  - EDIT makePi (line ~102) to ALSO capture appendEntry calls:
      ```typescript
      function makePi() {
        const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
        const appendCalls: { customType: string; data: unknown }[] = [];
        const pi = {
          on(event: string, handler: (...a: unknown[]) => unknown) { handlers[event] = handler; },
          appendEntry(customType: string, data: unknown) { appendCalls.push({ customType, data }); },
        };
        return { handlers, appendCalls, pi: pi as unknown as ExtensionAPI };
      }
      ```
  - WHY: the stale-retirement assertions must observe `appendEntry("mulligan:cancel", {targetId, ...})`.
  - GOTCHA: the EXISTING two makePi() call sites (lines ~396, ~403) destructure `{ handlers, pi }` — they now
    also receive `appendCalls` (ignored) and still work. No change needed there.

Task 6: MODIFY test/filter.test.ts — update all 14 existing contextHandler(event, ctx) call sites
  - FIND: every `contextHandler(event, ctx)` / `contextHandler({ type: "context", messages: ... }, ctx)` call
    in the `contextHandler — disabled pass-through...` describe block (lines 287,300,312,331,338,346,366,373,
    380,381,387,388 — grep `contextHandler(` to enumerate).
  - EDIT: prepend a fake pi as the FIRST arg. Each test that does not already create a pi should create one:
      `const { pi } = makePi();` (or `{ pi, appendCalls }` where assertions need it), then call
      `contextHandler(pi, event, ctx)`.
  - GOTCHA: the disabled-pass-through test (line 287) returns before the retirement pass runs (config.enabled
    false) — its pi is only needed for the ARG, not for assertions; a plain `makePi().pi` suffices.
  - GOTCHA: do NOT change the registerFilterHandler describe block's `(handlers["context"])(event, ctx)` calls —
    those invoke the WRAPPER (which still takes (event, ctx)). Only contextHandler DIRECT calls change.
  - VERIFY after editing: `npx tsc --noEmit` must pass (a missed call site is a type error: expected 3 args, got 2).

Task 7: ADD test/filter.test.ts — a `contextHandler — stale-marker retirement` describe block
  - ADD a new describe block AFTER the existing contextHandler describe (before or after registerFilterHandler).
    Reuse shrinkData (add a pinnedEntryId variant), customEntry, makeCtx, makePi. Cases (one `it` each):
    1. "retires a pinned shrink absent for staleAfterFires consecutive fires (appends mulligan:cancel)":
       - entries: a pinned shrink (id "sh-1", pinnedEntryId "entry-gone"); branch has NO entry with id "entry-gone"
         (so resolvePinnedShrink returns null every fire). staleAfterFires default = 3.
       - Fire contextHandler(pi, event, ctx) THREE times (same entries/branch each fire).
       - After fire 3: assert appendCalls contains exactly ONE { customType: "mulligan:cancel", data.targetId === "sh-1" }.
         (Misses climb 1,2,3; on the 3rd, retire. Fires 1+2 append nothing.)
       - Assert rt.shrinkMissCounts.get("sh-1") === 3 after the third fire.
    2. "does NOT retire a pinned shrink whose target IS present (miss count resets to 0)":
       - entries: pinned shrink (id "sh-2", pinnedEntryId "entry-here"); branch HAS a message entry with id
         "entry-here" aligned to event.messages (so resolvePinnedShrink returns a number, not null).
       - Fire contextHandler THREE times. Assert appendCalls is EMPTY (no cancel). Assert
         rt.shrinkMissCounts.get("sh-2") === 0 (reset each fire — never accumulates).
       - GOTCHA: building an aligned branch+messages fixture so resolvePinnedShrink returns non-null is the
         tricky part — mirror a transforms.test.ts resolvePinnedShrink hit fixture (a `message` entry whose id
         matches, with a matching event.messages element). If aligning is fiddly, an alternative is to
         vi.mock/spy resolvePinnedShrink to return a number — but PREFER a real fixture (the file already vi.mocks
         transforms.js; you can override resolvePinnedShrink in the mock to return 0 for the "hit" case and null
         for the "absent" case — see the vi.mock factory at the top of the file).
    3. "rt.shrinkMissCounts resets on a hit after misses (a miss-run then a hit clears it)":
       - Fire TWICE with target absent (misses → 2), then ONCE with target present (hit → reset to 0). Assert
         appendCalls empty and shrinkMissCounts.get(id) === 0. (Proves reset semantics.)
    4. "does NOT consider live shrinks (no pinnedEntryId) — never counted, never retired":
       - entries: a live shrink (shrinkData default, NO pinnedEntryId). Fire staleAfterFires+1 times with an
         empty branch. Assert appendCalls empty AND rt.shrinkMissCounts.has(id) === false (never written).
    5. "never throws: a throwing resolvePinnedShrink is swallowed and the turn still returns {messages}":
       - pipelineReturn = [{role:"user",content:"OK"}]; mock resolvePinnedShrink to throw (override the vi.mock).
         entries: a pinned shrink. Fire once. Assert it does NOT throw (expect(...).not.toThrow()), the result is
         {messages: [{role:"user",content:"OK"}]} (the filter transform is PRESERVED — retirement failure did not
         pass-through), and appendCalls is empty. (Proves the inner try/catch isolates retirement from the turn.)
    6. "appendCancelMarker failure is tolerated (appendEntry throwing does not break the turn)":
       - fake pi.appendEntry THROWS; entries: pinned shrink absent for staleAfterFires. Fire once (misses → 1,
         not yet threshold). Then fire two more (misses → 2, 3 → retire attempted → appendEntry throws → caught).
         Assert no throw; result still {messages}; the shrink stays (count at 3). (Proves appendCancelMarker's
         own try/catch + the inner retirement try/catch both hold.)
  - NAMING/PLACEMENT: put the describe after the existing contextHandler block. No new file.
  - FOLLOW pattern: the existing contextHandler tests (direct contextHandler call, assert on result + rt).
  - GOTCHA: clearAll() in beforeEach resets rt (including shrinkMissCounts) AND appendCalls should be reset per
    test (the makePi() is created per-test, so appendCalls is fresh each test — good). If a test reuses pi across
    fires within one test, appendCalls accumulates across those fires (desired — assert on length).

Task 8: MODIFY spec/06-context-filter.md — document the retirement pass (Mode A: rides with the work)
  - ADD a prose note in §1 (after the existing cancel-drop note from P3.M1.T2.S1, before the §2 divider).
    Suggested text (adapt to the file's tone):
    > **Stale-marker retirement (spec/08 E15).** After `filterPipeline` runs, `contextHandler` performs a
    > stale-marker retirement pass: for each *active pinned* shrink, it resolves the pinned target entry against
    > the *pre-filter* `event.messages` + `branchEntries` via `resolvePinnedShrink`. A hit resets that shrink's
    > consecutive-miss counter (`rt.shrinkMissCounts`) to 0; a miss increments it. When a shrink's miss count
    > reaches `config.shrink.staleAfterFires` (default 3), `contextHandler` auto-retires it by appending a
    > `mulligan:cancel` (the same retraction primitive as the `mulligan_cancel` tool) — which takes effect on
    > the *next* `context` fire (`readMarkers` drops the cancelled id), so there is no in-fire mutation. Live
    > shrinks (no `pinnedEntryId`) are never considered: they re-resolve each fire and no-op harmlessly. The
    > whole pass is wrapped in its own try/catch, so a retirement failure can never break an agent turn (E13).
    > (`contextHandler` receives `pi` (threaded through by `registerFilterHandler`) precisely so it can call
    > `appendCancelMarker` here — mirroring `turnEndMetricHandler`.)
  - WHY: §1 is the authoritative contextHandler contract; the retirement pass is otherwise undocumented.
  - Do NOT renumber §2+ — insert as a trailing paragraph of §1.
```

### Implementation Patterns & Key Details

```typescript
// THE pattern to mirror — nudges.ts turnEndMetricHandler (pi first) + registerTurnEndMetric (wrapper):
//   export function turnEndMetricHandler(pi, event, ctx) { ... appendTurnMetric(pi, ctx, metric) ... }
//   export function registerTurnEndMetric(pi) { pi.on("turn_end", (event, ctx) => turnEndMetricHandler(pi, event, ctx)); }
// contextHandler becomes the same shape (appendCancelMarker instead of appendTurnMetric).

// The retirement pass — read everything defensively via readOwn (module-private, already in filter.ts):
for (const sh of markers.shrinks) {
  const pinnedEntryId = readOwn(sh, "pinnedEntryId");
  if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) continue; // live shrink
  const id = readOwn(sh, "id");
  if (typeof id !== "string" || id.length === 0) continue;                       // unreadable → skip
  const hit = resolvePinnedShrink(event.messages as unknown as MessageLike[],
    branchEntries as unknown as BranchEntry[], pinnedEntryId) !== null;           // PRE-filter messages!
  if (hit) rt.shrinkMissCounts.set(id, 0);
  else {
    const misses = (rt.shrinkMissCounts.get(id) ?? 0) + 1;
    rt.shrinkMissCounts.set(id, misses);
    if (misses >= config.shrink.staleAfterFires) appendCancelMarker(pi, ctx, { targetId: id });
  }
}

// WHY event.messages not the filtered `messages`: filterPipeline REMOVES messages (rewinds), breaking the
// branchEntries↔messages identity walk resolvePinnedShrink performs. event.messages is branch-aligned.

// WHY no double-retire guard: once appendCancelMarker persists the cancel, NEXT fire's readMarkers drops the
// shrink from markers.shrinks (its id ∈ cancelledIds) → it leaves the loop. If the append FAILED, the shrink
// stays → count keeps climbing → retried next fire. Both directions are correct with no extra guard.

// WHY own inner try/catch (not relying on the outer): the outer try/catch returns void (pass-through) on
// throw. If the retirement pass threw and only the outer caught it, the turn would pass-through (lose the
// entire filter transform). The inner try/catch SWALLOWS the retirement error and continues to the normal
// `return { messages }`, preserving the transform. This is the E13 isolation requirement.
```

### Integration Points

```yaml
TYPES (src/filter.ts):
  - change: "contextHandler signature: (event, ctx) → (pi, event, ctx)"
  - add imports: "appendCancelMarker (runtime, from markers.js) + resolvePinnedShrink (runtime, from transforms.js)"

REGISTRATION (src/filter.ts registerFilterHandler):
  - change: "pi.on('context', contextHandler) → pi.on('context', (event, ctx) => contextHandler(pi, event, ctx))"
  - public signature UNCHANGED: registerFilterHandler(pi: ExtensionAPI): void (index.ts untouched)

NO DATABASE / NO CONFIG / NO ROUTES / NO NEW FILES / NO INDEX.TS CHANGES.
  - runtime.ts shrinkMissCounts: parallel P3.M2.T2.S1 (contract).
  - config.ts shrink.staleAfterFires: already-landed P3.M2.T1.S1.
  - markers.ts appendCancelMarker: already-landed P3.M1.T1.S1.
  - transforms.ts resolvePinnedShrink: already-landed (no change).
  - The soft-cap (shrink.maxActive) retirement is P3.M2.T3.S2 — do NOT add it here.

DOCS (spec/06-context-filter.md):
  - §1: trailing prose note (after the P3.M1.T2.S1 cancel-drop note) documenting the retirement pass.

DOWNSTREAM (no edit needed; documented for awareness):
  - index.ts: calls registerFilterHandler(pi) once — signature unchanged, no edit.
  - P3.M2.T3.S2 (soft cap): will add its own retirement pass into the SAME spot (after this pass), reusing the
    pi-threading + the inner-try/catch discipline this task establishes.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (no separate build script; tsc is a devDependency).
npx tsc --noEmit
# Expected: ZERO errors. The signature change will surface ANY missed test call site as
# "Expected 3 arguments, but got 2" — fix every one (Task 6 lists them). The two new runtime imports
# (appendCancelMarker, resolvePinnedShrink) must be value imports, not type-only. If a type error appears
# in filter.ts itself, re-check the resolvePinnedShrink call casts match the existing filterPipeline casts.

# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)

# ALSO: confirm log.ts accepts the level string used in the retirement catch. Quick check:
grep -n "export function log" src/log.ts   # signature: log(level, scope, sessionId, fields?) — use a level it accepts ("warn" or "error")
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback while iterating).
npx vitest run test/filter.test.ts
# Expected: ALL tests pass — the 14 updated call sites + the existing readMarkers/contextHandler/register
# tests + the 6 NEW stale-retirement tests. Watch especially:
#   - test 1 (retire after staleAfterFires): exactly ONE mulligan:cancel appended, targetId === shrink id.
#   - test 2 (target present): NO cancel, miss count stays 0 (the resolvePinnedShrink "hit" fixture is the
#     riskiest — if aligning a real branch is fiddly, override resolvePinnedShrink in the vi.mock factory).
#   - test 5 (throwing resolvePinnedShrink swallowed): result is STILL {messages: [...]} (NOT undefined) —
#     this proves the inner try/catch isolates retirement from pass-through.

# Then the full suite to prove no regression (markers/audit/edge/drift/nudges/runtime/config/transforms).
npm test
# Expected: ALL green. Files to eyeball:
#   test/runtime.test.ts   — unaffected (shrinkMissCounts added by parallel P3.M2.T2.S1; if that has landed,
#                            its ownership/reset tests pass independently of this task).
#   test/edge-cases.test.ts — the E13 "handler never throws" coverage; a new retirement failure path is now
#                            covered by filter.test.ts test 5/6.
#   test/nudges.test.ts    — unaffected (turnEndMetricHandler is the TEMPLATE, not the target).
```

### Level 3: Integration Testing (System Validation)

```bash
# The signature change is INTERNAL to filter.ts (registerFilterHandler's public signature is unchanged), so
# index.ts wiring is unaffected. The integration smoke harness exercises real Pi events:
npm run smoke   # optional — should pass unchanged (no stale-shrink scenario in the smoke script yet)
# NOTE: this task adds no tool registration; the context handler is armed exactly as before (via the wrapper).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the new unit tests (the real gate for this hot-path maintenance pass):
#   - pinned shrink absent N times → exactly one mulligan:cancel with the right targetId
#   - pinned shrink present → never retired, miss count reset to 0
#   - live shrink (no pinnedEntryId) → never counted
#   - resolvePinnedShrink throw / appendCancelMarker throw → turn still returns {messages} (E13)
# These mirror spec/08 E15's mandate ("MUST be auto-retired") at the unit level. The end-to-end "next fire the
# shrink no longer applies" is satisfied transitively: the appended cancel flows into readMarkers.cancelledIds
# (P3.M1.T2.S1, landed) → the shrink leaves markers.shrinks → applyShrink never runs for it. `npm test` covers it.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (signature change + 2 new value imports + all test call sites updated).
- [ ] `npx vitest run test/filter.test.ts` — all tests pass (existing updated + 6 new retirement tests).
- [ ] `npm test` — full suite green (no regressions in markers/audit/edge/drift/nudges/runtime/config/transforms).

### Feature Validation
- [ ] `contextHandler(pi, event, ctx)` — pi is the first parameter.
- [ ] `registerFilterHandler(pi)` registers `pi.on("context", (event, ctx) => contextHandler(pi, event, ctx))`.
- [ ] Pinned shrink absent for `staleAfterFires` fires → `appendCancelMarker` called (fake `pi.appendEntry` recorded `"mulligan:cancel"` with `data.targetId === shrink.id`).
- [ ] Pinned shrink present → not retired; `rt.shrinkMissCounts.get(id) === 0` (reset on hit).
- [ ] Live shrink (no `pinnedEntryId`) → never written to `shrinkMissCounts`, never retired.
- [ ] Retirement pass never throws (resolvePinnedShrink/appendCancelMarker failures swallowed); turn returns `{messages}` unchanged (E13).
- [ ] `spec/06-context-filter.md` §1 has the stale-retirement note.

### Code Quality Validation
- [ ] The `pi`-first signature + wrapper mirror `turnEndMetricHandler`/`registerTurnEndMetric` verbatim.
- [ ] The retirement pass reuses the already-read `rt`/`config`/`branchEntries` locals (no re-fetch).
- [ ] The retirement pass uses `event.messages` (PRE-filter), not the filtered `messages` variable.
- [ ] `readOwn` is used for `sh.id` / `sh.pinnedEntryId` (defensive; never bare property access).
- [ ] The retirement pass has its OWN inner try/catch (E13 isolation — does not fall through to the outer void-return).
- [ ] `appendCancelMarker` and `resolvePinnedShrink` are VALUE imports (not type-only).
- [ ] No changes outside `src/filter.ts`, `test/filter.test.ts`, `spec/06-context-filter.md`.

### Documentation & Deployment
- [ ] `contextHandler` JSDoc explains WHY pi is a parameter (mirrors nudges.ts GOTCHA #2 note).
- [ ] `spec/06-context-filter.md` §1 note states: pinned-only, pre-filter messages, next-fire effect, own try/catch, E15/E21.
- [ ] No user-facing README change required (internal filter maintenance; README updates are P3.M4, out of scope).

---

## Anti-Patterns to Avoid

- ❌ Do NOT capture `pi` in a module-scoped variable instead of threading it as a parameter — that breaks the direct-testability that is the entire point of the `turnEndMetricHandler` pattern (the exported handler must be callable as `contextHandler(fakePi, event, ctx)`).
- ❌ Do NOT pass the FILTERED `messages` to `resolvePinnedShrink` — use `event.messages` (pre-filter). filterPipeline removes messages (rewinds), breaking the identity alignment.
- ❌ Do NOT re-fetch `getRuntime`/`getConfig`/`getBranch` inside the retirement pass — reuse the locals already obtained at the top of `contextHandler`.
- ❌ Do NOT rely on the OUTER try/catch alone for the retirement pass — it returns void (pass-through). The retirement pass MUST have its own inner try/catch that swallows the error and continues to the normal `return { messages }`, or a retirement failure would silently lose the entire filter transform for the turn.
- ❌ Do NOT use `sh.id` / `sh.pinnedEntryId` directly — use `readOwn(sh, "id")` / `readOwn(sh, "pinnedEntryId")` (a Proxy get-trap may throw; readOwn swallows it).
- ❌ Do NOT process live shrinks (no `pinnedEntryId`) — they re-resolve each fire and cannot go stale. Skip them with the `typeof pinnedEntryId !== "string"` guard.
- ❌ Do NOT add a "is this shrink already cancelled?" guard — `markers.shrinks` is ALREADY the active set (P3.M1.T2.S1 landed); a just-cancelled shrink never re-enters the loop.
- ❌ Do NOT add the soft-cap (`maxActive`) retirement here — that is P3.M2.T3.S2 (a separate task that lands beside this pass). This task is stale-retirement ONLY.
- ❌ Do NOT validate `targetId` existence before `appendCancelMarker` — it is dumb persistence by design; the retirement pass already knows the shrink is active.
- ❌ Do NOT make `appendCancelMarker`/`resolvePinnedShrink` type-only imports — they are VALUES called at runtime. A `import type { ... }` will cause a tsc error or a runtime "is not a function".
- ❌ Do NOT forget to update ALL 14 existing `contextHandler(event, ctx)` test call sites — a single missed site is a tsc error ("Expected 3 arguments, but got 2"). Grep `contextHandler(` in `test/filter.test.ts` to enumerate.
- ❌ Do NOT change the `registerFilterHandler` describe block's `(handlers["context"])(event, ctx)` calls — those invoke the WRAPPER (still `(event, ctx)`); only DIRECT `contextHandler(...)` calls gain the `pi` arg.
- ❌ Do NOT modify `runtime.ts` / `config.ts` / `markers.ts` / `transforms.ts` / `index.ts` — those are contracts (parallel or already-landed). This task is `filter.ts` + its test + the spec doc only.
- ❌ Do NOT create a new file — all changes are additive edits to existing files.

---

## Confidence Score

**9 / 10** — one-pass success is highly likely. The design is a verbatim clone of an established in-repo pattern (`turnEndMetricHandler`/`registerTurnEndMetric` in nudges.ts), the Pi-free helper (`resolvePinnedShrink`) and the retraction primitive (`appendCancelMarker`) are already landed and exported, and the miss-count logic is pinned verbatim by the work-item contract. The two residual risks, both called out explicitly in the tasks: (1) the signature change breaks 14 existing test call sites — enumerated by grep, each a mechanical prepend; (2) building a real `resolvePinnedShrink` "hit" fixture (test 2) requires a branch+messages alignment that mirrors `transforms.test.ts` resolvePinnedShrink fixtures — if that proves fiddly, the file's existing `vi.mock("../src/transforms.js")` factory can be extended to control `resolvePinnedShrink`'s return (return a number for "hit", null for "absent", throw for the error case), which is the cleaner unit-isolation choice anyway. No external research adds value — the in-repo pattern is authoritative.