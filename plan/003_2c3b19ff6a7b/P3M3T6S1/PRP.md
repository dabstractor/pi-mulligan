name: "P3.M3.T6.S1 — Wire windowed drift + high-water signal into contextHandler (filter.ts)"
description: |

---

## Goal

**Feature Goal**: Wire the two P3.M3 drift-nudge refinements into Mulligan's `context` event handler
(`contextHandler` in `src/filter.ts`) so they fire on EVERY `context` event (the free ride — D4, zero extra
model requests): **(a)** replace the existing drift-nudge guard with the windowed one (smooth over
`driftWindowTurns`, gate on a non-empty `recentMetrics` window), and **(b)** add the **edge-triggered
high-water** annotation that fires ONCE when the *total filtered* context first crosses
`config.nudges.highWaterFraction` (default 0.7) of the window, latched via `rt.aboveHighWater`. Both blocks ride
the existing context fire, mutate ONLY the in-flight message copy, and NEVER throw (the existing outer try/catch +
defensive wrapping inside the high-water block).

**Deliverable**:
- `src/filter.ts` — **MODIFY** `contextHandler` (3 surgical changes):
  1. ADD `shouldHighWater, injectHighWaterNudge` to the existing `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";` line.
  2. TIGHTEN the existing drift-nudge guard to the contract's full guard (`markers.recentMetrics && markers.recentMetrics.length > 0 && shouldNudge(markers.recentMetrics, config) && markers.metric && !suppressCheck(markers.metric, markers)`).
  3. ADD the high-water block immediately AFTER the drift-nudge block (compute `totalFilteredTokens = estimateTokens(messages).tokens` on the FILTERED view — D5; `windowTokens = ctx.getContextUsage()?.contextWindow ?? 0`; if `shouldHighWater(…)` → `messages = injectHighWaterNudge(…)`).
  No other function in filter.ts changes; no new file; no config/runtime/marker change; no nudges.ts change (the
  helpers are already exported there).
- `test/filter.test.ts` — **MODIFY**: extend `makeCtx` with an OPTIONAL `getContextUsage` override (default absent
  ⇒ all existing tests stay green), and ADD a new `describe` block covering the contract's mocking scenarios
  (high-water edge-trigger lifecycle on one `rt`, fail-open when `getContextUsage` is undefined, and the windowed
  drift wiring: single heavy-turn window → no drift nudge; sustained-growth window → drift nudge).

**Success Definition**:
- The windowed drift nudge fires iff `recentMetrics` is non-empty AND `shouldNudge(recentMetrics, config)` AND
  `markers.metric` (latest, for the text + suppress heuristic) AND NOT `suppressCheck` — the guard is the contract
  guard verbatim. `shouldNudge` receives the full `recentMetrics` array (NOT the single `metric`).
- The high-water annotation fires EXACTLY ONCE when `totalFilteredTokens/windowTokens >= highWaterFraction`, then
  does NOT re-fire while `rt.aboveHighWater === true`; it re-fires only after the total drops below the fraction
  (latch cleared) and then crosses up again.
- When `ctx.getContextUsage()` is undefined (no model / pre-first-inference / E12) OR `contextWindow === 0` OR the
  estimate call throws, `windowTokens === 0` ⇒ `shouldHighWater` returns `false` ⇒ NO high-water annotation and
  `rt.aboveHighWater` is **NOT mutated** (fail-open, never break the turn).
- `npx tsc --noEmit` clean; `npm test` green (new describes pass; ALL existing filter/readMarkers/nudge/retire/cap
  tests pass UNCHANGED — the default `makeCtx` has no `getContextUsage`, so the high-water block is a no-op there).

## Why

- **spec/07 §5.1 (Windowed drift, REQUIRED) + §5.2 (Edge-triggered high-water, REQUIRED) both mandate it.** §5.1:
  "fire when the *windowed* delta crosses the threshold, NOT on a single turn's raw delta … a single 8k-token turn
  amid small turns does NOT fire; three ~4k turns in a row DO." §5.2: "inject a one-line annotation the first time
  the total filtered context crosses highWaterFraction … edge-triggered — fire once on crossing, not every turn
  while above — by tracking `rt.aboveHighWater`." Both are marked REQUIRED and both explicitly "ride the existing
  context event (D4 — zero extra requests)." This task is the integration slice that turns the already-shipped
  helpers (P3.M3.T4.S1 shouldNudge + P3.M3.T5.S1 shouldHighWater/injectHighWaterNudge) into live behavior.
- **This is the INTEGRATION slice of milestone P3.M3.G1.** P3.M3.T1.S1 (config knobs) — COMPLETE. P3.M3.T2.S1
  (`rt.aboveHighWater`) — COMPLETE. P3.M3.T3.S1 (`recentMetrics` on MarkersBundle) — COMPLETE. P3.M3.T4.S1
  (windowed `shouldNudge`) — COMPLETE. P3.M3.T5.S1 (`shouldHighWater`/`renderHighWaterNudge`/`injectHighWaterNudge`)
  — landed (exported from nudges.ts). **P3.M3.T6.S1 (this task)** — the ONLY remaining piece: call them from
  contextHandler. After this, milestone P3.M3.G1 is DONE.
- **Small, surgical, mostly-call-site change.** Three edits in one function + one import line + test additions.
  No new module, no schema/type change, no Pi-surface change, no tokenization authored here (estimateTokens +
  shouldHighWater already do the math). The high-water logic mutates only `rt` + the ephemeral copy — it does NOT
  need `pi` (the drift-nudge block also does not).

## What

**User-visible behavior** (indirect, via the in-flight message copy): each turn, the windowed drift nudge fires
only on SUSTAINED per-turn growth over `driftWindowTurns` (a single heavy turn no longer nags); independently, the
FIRST turn whose *filtered* total crosses 70% of the window fires a single `[mulligan] Context is at ~70% of the
window …` annotation recommending `mulligan_shrink`/`mulligan_rewind`. The high-water annotation does NOT repeat
on subsequent turns while still above 70%; it re-fires only after the total drops below 70% (e.g. after a
shrink/rewind) and crosses up again. Zero extra requests (rides the existing context inference — D4).

**Technical requirements** (from the work-item contract + Pattern 11 — implement EXACTLY):

1. **Import (src/filter.ts)** — add `shouldHighWater, injectHighWaterNudge` to the existing nudges import. `estimateTokens` is ALREADY imported (line 48). NO new value/type import beyond the two nudges functions.
2. **Drift-nudge guard (src/filter.ts `contextHandler`)** — REPLACE the current guard with the contract guard. The
   ONLY behavior change vs. today: (i) `shouldNudge` is called on `recentMetrics` (already true today — P3.M3.T4.S1
   landed it — but the contract wants the explicit `markers.recentMetrics.length > 0` pre-guard and `markers.metric`
   moved after `shouldNudge`); (ii) `injectNudge`/`suppressCheck` still take the single latest `markers.metric`.
3. **High-water block (src/filter.ts `contextHandler`)** — immediately AFTER the drift-nudge block, BEFORE
   `rt.lastFiltered = messages`:
   - `totalFilteredTokens = estimateTokens(messages).tokens` on the FILTERED view (D5 — the same filtered total
     mulligan_audit reports; NEVER `getContextUsage().tokens`, which counts hidden/rewound tokens). `messages` here
     is post-`filterPipeline` + post-drift-nudge (the contract: "post-filterPipeline + post-nudge messages").
   - `windowTokens = ctx.getContextUsage()?.contextWindow ?? 0`.
   - `if (shouldHighWater(totalFilteredTokens, windowTokens, rt, config)) { messages = injectHighWaterNudge(messages, totalFilteredTokens, windowTokens); }`
   - Wrap the estimate + getContextUsage read defensively (its own inner try/catch) so a throw leaves both at 0 →
     `shouldHighWater(_, 0, …)` → `false` (fail-open). This is BELT-AND-SUSPENDERS — estimateTokens NEVER throws
     and `getContextUsage?.()` is optional-chained — but the contract mandates the defensive wrap (never break the
     turn over an annotation).
4. **NEVER throws** — both blocks are inside the existing outer try/catch; the high-water computation additionally
   has its own inner try/catch. An extension bug can NEVER break an agent turn (spec/03 #4 fail-open, spec/08 E13).
5. **Observability log (OPTIONAL)** — the existing `log("info", "filter.fire", …)` MAY additionally include
   `aboveHighWater: rt.aboveHighWater` (contract point d: "optional, belt-and-suspenders"). NOT required.

### Success Criteria
- [ ] `shouldHighWater, injectHighWaterNudge` imported into `src/filter.ts`.
- [ ] Drift-nudge guard is the contract guard verbatim (non-empty `recentMetrics` window → windowed `shouldNudge` →
      `markers.metric` → `!suppressCheck`); `injectNudge` still takes `markers.metric`.
- [ ] High-water block computes `totalFilteredTokens` from the FILTERED `messages` (D5), `windowTokens` from
      `ctx.getContextUsage()?.contextWindow ?? 0`, and injects the `mulligan:high-water` nudge iff
      `shouldHighWater(…)` returns true.
- [ ] Edge-trigger lifecycle holds: cross → fire + `rt.aboveHighWater=true`; same total again → no re-fire; drop
      below → `rt.aboveHighWater=false`; re-cross → fire again.
- [ ] `getContextUsage` undefined / `contextWindow` 0 / estimate throws ⇒ no high-water nudge AND `rt.aboveHighWater`
      UNCHANGED (fail-open).
- [ ] ALL existing tests pass UNCHANGED (default `makeCtx` has no `getContextUsage` ⇒ high-water is a no-op there).
- [ ] `npx tsc --noEmit` clean; `npm test` green.

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the EXACT current drift-nudge block (verbatim, with line anchors), the EXACT target
guard, the EXACT high-water block to insert (with the established `type TokenMessages = Parameters<typeof
estimateTokens>[0]` cast reused from the existing observability log), the EXACT import line to extend, the EXACT
placement (after drift-nudge, before `rt.lastFiltered`), the EXACT test-fake extension (`makeCtx` + an optional
`getContextUsage`) and why the default keeps every existing test green, the EXACT `estimateTokens` mechanic
(`ceil(chars/4)`) for crafting known token totals, the EXACT builder helpers (`metricData`, `customEntry`,
`pipelineReturn`) the tests use, and cites spec/07 §5.1+§5.2, external_deps.md (the `ContextUsage` surface),
implementation_patterns.md Pattern 11 (the wiring sketch), and the sibling PRPs (the helper contracts). An
implementer who has never seen this repo can do it from this document + `src/filter.ts` + `test/filter.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file being edited (the ONLY src/ file this task touches)
- file: src/filter.ts
  why: |
    Where the import is extended, the drift-nudge guard is tightened, and the high-water block is inserted — all
    INSIDE contextHandler (the `context` event handler). The handler's structure (read sessionId → getConfig gate
    → getRuntime → readMarkers → getBranch → filterPipeline → drift-nudge block → cache rt.lastFiltered →
    observability log → stale retirement + soft cap → return) is the map. The high-water block slots in AFTER the
    drift-nudge block and BEFORE the cache. The existing outer try/catch (fail-open) + the inner try/catch around
    the observability log (the PATTERN to mirror for the high-water estimate wrap) are both already there.
  section: contextHandler (~lines 150–260); the drift-nudge block (~lines 165–173)
  pattern: |
    # The CURRENT drift-nudge block (verbatim — REPLACE its guard):
    if (
      config.nudges.perTurnDrift &&
      markers.metric &&
      shouldNudge(markers.recentMetrics, config) &&
      !suppressCheck(markers.metric, markers)
    ) {
      messages = injectNudge(messages, markers.metric);
    }
    # The existing observability-log inner try/catch (the PATTERN to mirror for the high-water estimate wrap):
    try {
      type TokenMessages = Parameters<typeof estimateTokens>[0];
      const after = estimateTokens(messages as unknown as TokenMessages).tokens;
      const before = estimateTokens(event.messages as unknown as TokenMessages).tokens;
      log("info", "filter.fire", sessionId, { before, after, ... });
    } catch { /* observability only — never break the turn */ }
  gotcha: |
    Reuse the `type TokenMessages = Parameters<typeof estimateTokens>[0]` cast verbatim — estimateTokens defines
    its OWN narrower MessageLike (tokens.ts) that is NOT transforms.ts's MessageLike; the cast through `unknown` is
    established + type-safe. Do NOT add a new cast idiom.

# MUST READ — the import line to extend
- file: src/filter.ts
  why: |
    Line ~51: `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`. ADD `shouldHighWater,
    injectHighWaterNudge` to this SAME named-import (alphabetical-ish is the file's loose convention; placement
    among the names is not significant). `estimateTokens` is ALREADY imported (line ~48). NO other import.
  pattern: "import { shouldHighWater, injectHighWaterNudge, injectNudge, shouldNudge, suppressCheck } from \"./nudges.js\";"

# MUST READ — the helper signatures being called (the CONTRACT; do NOT re-implement them here)
- file: src/nudges.ts
  why: |
    Confirms the EXACT signatures + behavior of the four functions called from contextHandler (all already
    exported; this task only CALLS them):
      shouldNudge(recentMetrics: TurnMetric[], config): boolean           # windowed moving-average (T4.S1)
      injectNudge(messages, metric: TurnMetric): MessageLike[]            # drift nudge, customType "mulligan:nudge"
      suppressCheck(metric, markers): boolean                            # time-window suppress heuristic
      shouldHighWater(totalFilteredTokens, windowTokens, rt, config): boolean  # edge-trigger latch; mutates rt.aboveHighWater; windowTokens<=0 → false (NO rt mutation)
      injectHighWaterNudge(messages, totalFilteredTokens, windowTokens): MessageLike[]  # customType "mulligan:high-water"
    shouldHighWater is the ONLY impure one (it latches rt.aboveHighWater). renderHighWaterNudge is called INSIDE
    injectHighWaterNudge (not by contextHandler).
  section: shouldNudge / injectNudge / suppressCheck / shouldHighWater / injectHighWaterNudge

# MUST READ — MarkersBundle.recentMetrics + metric (the INPUTS to the drift gate)
- file: src/filter.ts
  why: |
    MarkersBundle (readMarkers return): `recentMetrics: TurnMetric[]` — ALL turn-metrics, NEWEST-FIRST (index 0 =
    highest seq); ALWAYS present (empty array on every fail-open path). `metric: TurnMetric | null ===
    recentMetrics[0] ?? null` (kept for backward compat — suppressCheck + injectNudge still use the single latest).
    The drift guard slices nothing — shouldNudge slices driftWindowTurns itself. So `markers.recentMetrics.length >
    0` ⟺ `markers.metric !== null`.
  section: MarkersBundle interface (~lines 60–85) + readMarkers sort (~lines 195–215)

# MUST READ — SessionRuntime.aboveHighWater (the latch shouldHighWater mutates)
- file: src/runtime.ts
  why: |
    Confirms SessionRuntime ALREADY has `aboveHighWater: boolean` (P3.M3.T2.S1 COMPLETE; default false). The `rt`
    local in contextHandler is the LIVE mutable per-session runtime (getRuntime(sessionId)); shouldHighWater
    mutates rt.aboveHighWater in place. resetRuntime (session_start) already wipes it. NO runtime change here.
  section: SessionRuntime.aboveHighWater + freshRuntime

# MUST READ — the test file to extend
- file: test/filter.test.ts
  why: |
    The home for the new contextHandler tests. Uses vi.mock("../src/transforms.js") to control filterPipeline via
    `pipelineReturn` (+ `pipelineCalls`, `resolvePinnedShrinkReturn`). `makeCtx({sessionId, entries, branch,
    throwOn*})` builds a minimal fake ExtensionContext (sessionManager only — NO getContextUsage today, which is
    why the default keeps the high-water block a no-op). `makePi()` captures `.on`+`.appendEntry`. Builder helpers:
    `metricData(seq, grew=false, bloat=false)` (grew=true ⇒ deltaTokens=7000 ⇒ fires moving-avg>6000; grew=false ⇒
    deltaTokens=100 ⇒ no fire), `customEntry(customType, data)`, `rewindData`, `shrinkData`. Existing drift-nudge
    test pattern: set `pipelineReturn = [{role:"user",content:"P"}]`, fire contextHandler, assert
    `result.messages` length + last `customType`. clearAll() in beforeEach/afterEach.
  section: makeCtx (~lines 99–125) + the contextHandler describe (~lines 379–500, esp. the drift-nudge its 445–480)

# Architecture reference (read-only) — the EXACT contextHandler wiring sketch
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  section: "Pattern 11: contextHandler nudge wiring (filter.ts)"
  why: |
    Pattern 11 sketches the EXACT wiring: windowed drift guard on recentMetrics.length>0 + shouldNudge(window) +
    !suppressCheck(latest), then `totalFiltered = estimateTokens(messages).tokens`; `windowTokens =
    ctx.getContextUsage()?.contextWindow ?? 0`; `if (shouldHighWater(...)) messages = injectHighWater(...)`. This
    PRP's implementation mirrors Pattern 11 (note: Pattern 11 writes `injectHighWater` as shorthand; the REAL
    export name — from nudges.ts — is `injectHighWaterNudge`; use the real name).

# Architecture reference (read-only) — the ContextUsage surface (windowTokens denominator)
- docfile: plan/003_2c3b19ff6a7b/architecture/external_deps.md
  section: "ContextUsage type (critical for §5.2 high-water signal)"
  why: |
    ContextUsage { tokens: number|null; contextWindow: number; percent: number|null };
    ctx.getContextUsage(): ContextUsage|undefined. windowTokens = ctx.getContextUsage()?.contextWindow ?? 0. D5:
    the high-water TOTAL uses estimateTokens(messages).tokens (filtered), NEVER getContextUsage().tokens (counts
    hidden/rewound tokens). E12: getContextUsage may be undefined (no model / pre-first-inference) → contextWindow
    0 → shouldHighWater fail-opens to false.

# Architecture reference (read-only) — the EXACT shouldHighWater algorithm (the latch behavior to assert)
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  section: "Pattern 9: High-water signal (nudges.ts)"
  why: |
    Pattern 9 documents the edge-trigger latch: windowTokens<=0 → false (no rt mutation); fraction>=fraction →
    latch-on-first-cross fire; else clear + false. contextHandler does NOT re-implement this — it CALLS
    shouldHighWater — but the tests must assert the latch transitions across sequential fires on ONE session id
    (because rt is per-session).

# Spec sources (read-only — the authoritative meaning)
- docfile: spec/07-preventive-and-nudges.md
  section: "§5.1 Windowed drift signaling (REQUIRED)" + "§5.2 Edge-triggered high-water signal (REQUIRED)"
  why: |
    §5.1: "fire when the windowed delta crosses the threshold, NOT on a single turn's raw delta … single 8k turn
    amid small turns does NOT fire; sustained growth fires." §5.2: "inject a one-line annotation the first time
    the total filtered crosses highWaterFraction (0.7) … edge-triggered — fire once on crossing — tracked via
    rt.aboveHighWater." §2 (Nudge B mechanism) establishes the free-ride-on-context principle (D4 zero extra
    requests) + the ephemeral-CustomMessage injection technique. The behavior is "already specified" (item
    contract point 6: "DOCS: none — the integration is internal").

# The sibling PRPs (assumed to land as specified) — the helper contracts
- docfile: plan/003_2c3b19ff6a7b/P3M3T5S1/PRP.md
  why: |
    P3.M3.T5.S1 defines shouldHighWater + renderHighWaterNudge + injectHighWaterNudge (the EXACT signatures +
    behavior this task calls). They are ALREADY exported from src/nudges.ts (verified). This task does NOT touch
    nudges.ts. P3.M3.T4.S1 (shouldNudge windowing) is also COMPLETE + already in nudges.ts.
```

### Current Codebase tree (relevant slice)

```bash
src/
  filter.ts          # <-- MODIFY: extend the nudges import + tighten the drift guard + add the high-water block (all in contextHandler).
  nudges.ts          # read-only (shouldNudge/injectNudge/suppressCheck/shouldHighWater/renderHighWaterNudge/injectHighWaterNudge ALL already exported)
  runtime.ts         # read-only (SessionRuntime.aboveHighWater ALREADY exists — P3.M3.T2.S1)
  config.ts          # read-only (driftWindowTurns=3, highWaterFraction=0.7, driftThresholdTokens=6000 ALL exist — P3.M3.T1.S1)
  tokens.ts          # read-only (estimateTokens = ceil(chars/4); already imported into filter.ts)
  transforms.ts      # read-only (MessageLike; filterPipeline already imported)
  markers.ts         # read-only (TurnMetric; readMarkers already imports it)
test/
  filter.test.ts     # <-- MODIFY: extend makeCtx with an optional getContextUsage override + ADD a new describe (high-water lifecycle + windowed-drift wiring).
spec/
  07-preventive-and-nudges.md  # read-only (§5.1 + §5.2 — the requirement; §2 — the injection technique)
plan/003_2c3b19ff6a7b/architecture/
  implementation_patterns.md   # read-only (Pattern 11 — the wiring sketch; Pattern 9 — the latch)
  external_deps.md             # read-only (ContextUsage.contextWindow — windowTokens)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/filter.ts          # EDITED in place. One import extended (shouldHighWater, injectHighWaterNudge); the drift-nudge guard
                       #   tightened; the high-water block inserted after the drift-nudge block. contextHandler now injects
                       #   BOTH the windowed drift nudge AND the edge-triggered high-water annotation.
test/filter.test.ts    # EDITED in place. makeCtx gains an optional getContextUsage override; a new describe covers the
                       #   high-water edge-trigger lifecycle (cross/latch/no-refire/clear/re-cross), fail-open (undefined
                       #   getContextUsage), and the windowed-drift wiring (single heavy turn → no nudge; sustained growth → nudge).
# No new files. All changes are edits to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — `ctx.getContextUsage?.()` (OPTIONAL CHAINING) is load-bearing for the existing tests. The test fake
//   makeCtx does NOT define getContextUsage; `?.` short-circuits to undefined → windowTokens=0 → shouldHighWater
//   returns false → NO high-water nudge in ANY existing test (they all use the default makeCtx). This is why the
//   default makeCtx needs NO change to keep the suite green. New high-water tests ADD an optional getContextUsage
//   override to makeCtx. Do NOT change makeCtx's default behavior.

// CRITICAL — placement is AFTER the drift-nudge block and BEFORE `rt.lastFiltered = messages`. Rationale:
//   totalFilteredTokens is "post-filterPipeline + post-nudge" (contract). Injecting the high-water nudge BEFORE
//   the cache means rt.lastFiltered (mulligan_audit + turnEndMetricHandler baseline) includes the high-water nudge
//   when it fires — that is CORRECT + CONSISTENT (the drift nudge is already cached the same way; the high-water
//   nudge is ~30 tokens, negligible). totalFilteredTokens is computed from messages BEFORE the high-water nudge is
//   added (the nudge must not push the total over its own threshold).

// CRITICAL — D5 (NEVER getContextUsage().tokens for the TOTAL). totalFilteredTokens =
//   estimateTokens(messages).tokens on the FILTERED view (exactly what mulligan_audit reports).
//   getContextUsage().tokens counts HIDDEN/rewound tokens (Pi's view includes rewound messages). windowTokens (the
//   DENOMINATOR) DOES come from getContextUsage().contextWindow — that is correct (window SIZE, not active count).

// CRITICAL — the high-water estimate + getContextUsage read is wrapped in its OWN inner try/catch (mirror the
//   existing observability-log inner try/catch). On ANY throw, leave totalFilteredTokens=0 + windowTokens=0 →
//   shouldHighWater(_, 0, …) → false (fail-open). The whole thing is ALSO inside the outer try/catch — double-safe.
//   estimateTokens NEVER throws and getContextUsage?.() is optional-chained, so this is belt-and-suspenders, but
//   the contract mandates it (never break the turn over an annotation).

// GOTCHA — the drift-nudge guard REORDERING matters for correctness, not just style. The contract guard is:
//     config.nudges.perTurnDrift
//       && markers.recentMetrics
//       && markers.recentMetrics.length > 0      // gate shouldNudge on a non-empty window
//       && shouldNudge(markers.recentMetrics, config)
//       && markers.metric                         // latest metric for the TEXT + suppressCheck
//       && !suppressCheck(markers.metric, markers)
//   `markers.metric` MOVES to AFTER shouldNudge (so the window gate runs first). This is short-circuit-safe:
//   markers.recentMetrics.length>0 ⟺ markers.metric !== null (metric === recentMetrics[0] ?? null), so the order
//   is logically equivalent to today EXCEPT shouldNudge is never called on an empty window (cleaner). injectNudge
//   + suppressCheck STILL take the single latest markers.metric (the text uses the latest delta; the suppress
//   heuristic uses the latest ts window) — do NOT change those call sites.

// GOTCHA — `markers.recentMetrics` is ALWAYS a present array (MarkersBundle interface; readMarkers returns [] on
//   every fail-open path including getEntries-throws). So `markers.recentMetrics &&` is belt-and-suspenders but
//   matches the contract verbatim. Keep it (defensive against a hand-built MarkersBundle in a future caller).

// GOTCHA — the high-water block does NOT need `pi`. It mutates only `rt` + the ephemeral `messages` copy. (The
//   drift-nudge block also does not need pi.) pi is a contextHandler param for the stale-retirement/cap
//   appendCancelMarker calls (P3.M2) — unrelated to the nudges.

// GOTCHA — reuse the `type TokenMessages = Parameters<typeof estimateTokens>[0]` cast from the existing
//   observability log VERBATIM. estimateTokens (tokens.ts) defines its OWN narrower MessageLike (its content-block
//   type) that is NOT transforms.ts's MessageLike; `messages as unknown as TokenMessages` is the established,
//   type-safe boundary. Do NOT invent a new cast.

// GOTCHA — estimateTokens = Math.ceil(totalChars / 4) (CHARS_PER_TOKEN=4). For tests, a message whose content is
//   "x".repeat(N) contributes ceil(N/4) tokens. To hit T tokens: N = 4*T (e.g. 4*700 = 2800 chars → 700 tokens).
//   NEVER throws on malformed input.

// GOTCHA — the edge-trigger latch lives in the PER-SESSION rt. Tests that assert the lifecycle (cross → no-refire
//   → clear → re-cross) MUST reuse ONE sessionId across sequential contextHandler fires (getRuntime(sessionId)
//   returns the SAME mutable rt each fire). A fresh sessionId each fire would always start aboveHighWater=false
//   and never exercise the latch.

// GOTCHA — when BOTH the drift nudge AND the high-water nudge fire on the same context event, BOTH are appended
//   (drift first, then high-water). The high-water total is computed AFTER the drift nudge (the drift nudge is in
//   `messages` when estimateTokens runs) — that is the contract ("post-nudge"). A ~30-token drift nudge will not
//   materially change the high-water fraction. This is fine + intended.

// GOTCHA — NO nudges.ts / config.ts / runtime.ts / markers.ts / transforms.ts edit. The helpers + the latch +
//   the config knobs + recentMetrics are ALL already shipped. This task is the CALL SITE only. Editing those
//   files would exceed scope and conflict with the parallel/landed siblings.

// GOTCHA — DOCS: none. The integration is internal to contextHandler (item contract point 6: spec/06 §1 +
//   spec/07 §5 already specify the behavior). README feature-blurb sync is the separate P3.M4.T1.S3 task.
```

## Implementation Blueprint

### Data models and structure

```typescript
// NO data-model change. SessionRuntime.aboveHighWater ALREADY exists (P3.M3.T2.S1).
// MulliganConfig.nudges.{driftWindowTurns=3, highWaterFraction=0.7, driftThresholdTokens=6000} ALL exist
// (P3.M3.T1.S1). MarkersBundle.recentMetrics ALREADY exists (P3.M3.T3.S1). The helpers shouldHighWater/
// injectHighWaterNudge/renderHighWaterNudge/shouldNudge/injectNudge/suppressCheck ALL already exist (T4.S1/T5.S1).
// This task changes NO interface/type/schema — it edits the contextHandler CALL SITE + extends the test fake.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/filter.ts — EXTEND the nudges import
  - LOCATE line ~51: `import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";`
  - ADD `shouldHighWater, injectHighWaterNudge` to the SAME named-import:
      import { shouldHighWater, injectHighWaterNudge, injectNudge, shouldNudge, suppressCheck } from "./nudges.js";
  - VERIFY estimateTokens is ALREADY imported (line ~48) — do NOT re-import it.
  - GOTCHA: NO type import needed (all five are value exports). renderHighWaterNudge is NOT imported (it is called
    internally by injectHighWaterNudge; contextHandler never calls it directly).

Task 2: MODIFY src/filter.ts contextHandler — TIGHTEN the drift-nudge guard
  - LOCATE the existing drift-nudge block (~lines 165–173), verbatim:
        if (
          config.nudges.perTurnDrift &&
          markers.metric &&
          shouldNudge(markers.recentMetrics, config) &&
          !suppressCheck(markers.metric, markers)
        ) {
          messages = injectNudge(messages, markers.metric);
        }
  - REPLACE the guard condition ONLY (keep the body `messages = injectNudge(messages, markers.metric);` UNCHANGED)
    with the contract guard:
        if (
          config.nudges.perTurnDrift &&
          markers.recentMetrics &&
          markers.recentMetrics.length > 0 &&
          shouldNudge(markers.recentMetrics, config) &&
          markers.metric &&
          !suppressCheck(markers.metric, markers)
        ) {
          messages = injectNudge(messages, markers.metric);
        }
  - UPDATE the preceding JSDoc/comment if present to note the tightened guard (non-empty window gate; shouldNudge
    on the window; injectNudge/suppressCheck still on the latest metric). Keep it concise.
  - GOTCHA: injectNudge + suppressCheck STILL take markers.metric (the latest) — do NOT change those call sites.
    The ONLY behavior delta: shouldNudge is never called on an empty recentMetrics window (logically equivalent
    to today because markers.metric !== null ⟺ recentMetrics.length > 0).

Task 3: MODIFY src/filter.ts contextHandler — ADD the high-water block
  - INSERT immediately AFTER the drift-nudge block (after its closing `}`), BEFORE `rt.lastFiltered = messages;`:
        // Edge-triggered high-water signal (spec/07 §5.2, REQUIRED). Fires ONCE when the total FILTERED context
        // first crosses config.nudges.highWaterFraction of the window (D5: the filtered view, never
        // getContextUsage().tokens which counts hidden/rewound tokens). Latched via rt.aboveHighWater (set on
        // fire, cleared when the total drops back below). windowTokens from ctx.getContextUsage()?.contextWindow
        // (E12: undefined / 0 / no model → shouldHighWater fail-opens to false). NEVER throws — the estimateTokens
        // + getContextUsage read is wrapped defensively (its own inner try/catch); a throw leaves both at 0.
        let totalFilteredTokens = 0;
        let windowTokens = 0;
        try {
          type TokenMessages = Parameters<typeof estimateTokens>[0];
          totalFilteredTokens = estimateTokens(messages as unknown as TokenMessages).tokens;
          const usage = ctx.getContextUsage?.();
          windowTokens = usage?.contextWindow ?? 0;
        } catch {
          // defensive — leave both at 0; shouldHighWater(_, 0, …) → false (fail-open, never break the turn)
        }
        if (shouldHighWater(totalFilteredTokens, windowTokens, rt, config)) {
          messages = injectHighWaterNudge(messages, totalFilteredTokens, windowTokens);
        }
  - VERIFY the block uses the LIVE `rt` local (getRuntime(sessionId), already in scope), the LIVE `messages` local
    (post-filterPipeline + post-drift-nudge), and `config` (already in scope). NO new locals beyond
    totalFilteredTokens/windowTokens/usage.
  - GOTCHA: reuse `type TokenMessages = Parameters<typeof estimateTokens>[0]` from the existing observability log.
    Do NOT add a second estimateTokens on event.messages here (the observability log already does before/after).
    The `usage?.contextWindow ?? 0` handles usage===undefined (getContextUsage absent/undefined) AND a present
    usage with contextWindow===0 (both → 0 → fail-open).

Task 4 (OPTIONAL): MODIFY src/filter.ts — extend the observability log with the high-water state
  - In the existing observability-log `log("info", "filter.fire", sessionId, { before, after, rewinds, shrinks,
    hasMetric })` object, OPTIONALLY add `aboveHighWater: rt.aboveHighWater` (contract point d: "optional,
    belt-and-suspenders"). This is the ONLY observability change; it is NOT required for success.
  - GOTCHA: place `aboveHighWater` AFTER the high-water block has run (it already is — the log is after the
    cache). If skipped, nothing is lost.

Task 5: MODIFY test/filter.test.ts — EXTEND makeCtx with an OPTIONAL getContextUsage override
  - LOCATE makeCtx (~lines 99–125). It returns `{ sessionManager } as ExtensionContext`.
  - ADD an optional `getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined`
    to the opts, and spread a `getContextUsage` onto the returned object ONLY when provided. Example:
        function makeCtx(opts: {
          sessionId?: string;
          entries?: SessionEntry[];
          branch?: SessionEntry[];
          throwOnGetEntries?: boolean;
          throwOnGetBranch?: boolean;
          throwOnGetSessionId?: boolean;
          getContextUsage?: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
        } = {}) {
          const sessionId = opts.sessionId ?? "s1";
          const sessionManager = { /* unchanged */ };
          const ctx: { sessionManager: unknown; getContextUsage?: () => unknown } = { sessionManager };
          if (opts.getContextUsage !== undefined) ctx.getContextUsage = opts.getContextUsage;
          return ctx as unknown as ExtensionContext;
        }
  - GOTCHA: the DEFAULT (no getContextUsage opt) returns a ctx WITHOUT getContextUsage — so `ctx.getContextUsage?.()`
    in filter.ts is undefined → windowTokens=0 → high-water never fires. This keeps ALL existing tests green. Do
    NOT make getContextUsage a default-returning function (that would change behavior for existing tests).

Task 6: MODIFY test/filter.test.ts — ADD the high-water edge-trigger lifecycle describe
  - ADD a new describe AFTER the existing contextHandler describes (e.g. after the soft-cap describe, before
    registerFilterHandler OR at the end). Cover the contract's high-water mocking scenarios. Reuse ONE sessionId
    across the lifecycle its (the latch is per-session in rt). Control totalFilteredTokens via pipelineReturn
    (a message with a known content length: ceil(len/4) tokens). Control windowTokens via makeCtx({getContextUsage}).
  - A helper for a message with a known token count:
        // A single user message whose content is 4*tokens 'x' chars → estimateTokens === tokens (ceil(4t/4)=t).
        const msgTokens = (tokens: number): unknown[] => [{ role: "user", content: "x".repeat(4 * tokens) }];
        const usage = (contextWindow: number) => () => ({ tokens: null, contextWindow, percent: null });
  - Scenarios (the contract's high-water mocking bullets):
      (a) it("fires the high-water annotation + latches rt.aboveHighWater on the first upward crossing", () => {
            pipelineReturn = msgTokens(700);        // 700 tokens
            const ctx = makeCtx({ sessionId: "hw1", getContextUsage: usage(1000) }); // 0.7 of 1000
            const result = contextHandler(pi, { type:"context", messages:[] } as ContextEvent, ctx) as { messages: unknown[] };
            expect(result.messages).toHaveLength(2);              // filtered + high-water nudge
            const last = result.messages[1] as Record<string, unknown>;
            expect(last.role).toBe("custom");
            expect(last.customType).toBe("mulligan:high-water");
            expect(typeof last.content).toBe("string");
            expect(last.content).toContain("~70%");
            expect(last.display).toBe(false);
            expect(getRuntime("hw1").aboveHighWater).toBe(true);   // latched
          });
      (b) it("does NOT re-fire while already above (edge-triggered) on a SECOND fire", () => {
            // reuse hw1 session: aboveHighWater already true from (a). Same total → shouldHighWater returns false.
            pipelineReturn = msgTokens(700);
            const ctx = makeCtx({ sessionId: "hw1", getContextUsage: usage(1000) });
            const result = contextHandler(pi, { type:"context", messages:[] } as ContextEvent, ctx) as { messages: unknown[] };
            expect(result.messages).toHaveLength(1);              // NO high-water nudge (already above)
            expect(getRuntime("hw1").aboveHighWater).toBe(true);  // unchanged
          });
            NOTE: run (a) and (b) in ONE it() OR ensure clearAll() does NOT run between them — vitest runs each
            it() inside the SAME describe with beforeEach clearAll(). Since clearAll() wipes rt, a TRUE lifecycle
            test must do all transitions in ONE it(). RECOMMENDED: one it() with sequential fires:
      (b') it("full lifecycle on one session: cross→latch→no-refire→drop→clear→re-cross→fire", () => {
            const sid = "hw-life";
            // fire 1: cross 0.7 → fire + latch true
            pipelineReturn = msgTokens(700);
            let r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, makeCtx({sessionId:sid, getContextUsage: usage(1000)})) as {messages:unknown[]};
            expect(r.messages).toHaveLength(2);
            expect((r.messages[1] as Record<string,unknown>).customType).toBe("mulligan:high-water");
            expect(getRuntime(sid).aboveHighWater).toBe(true);
            // fire 2: same total, already above → no re-fire
            r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, makeCtx({sessionId:sid, getContextUsage: usage(1000)})) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);
            expect(getRuntime(sid).aboveHighWater).toBe(true);
            // fire 3: drop below (0.5) → clear latch, no fire
            pipelineReturn = msgTokens(500);
            r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, makeCtx({sessionId:sid, getContextUsage: usage(1000)})) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);
            expect(getRuntime(sid).aboveHighWater).toBe(false);
            // fire 4: re-cross 0.7 → fire again (re-armed)
            pipelineReturn = msgTokens(700);
            r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, makeCtx({sessionId:sid, getContextUsage: usage(1000)})) as {messages:unknown[]};
            expect(r.messages).toHaveLength(2);
            expect((r.messages[1] as Record<string,unknown>).customType).toBe("mulligan:high-water");
            expect(getRuntime(sid).aboveHighWater).toBe(true);
          });
      (c) it("fail-open: getContextUsage undefined → no high-water nudge AND aboveHighWater unchanged", () => {
            // default makeCtx (NO getContextUsage opt) → ctx.getContextUsage?.() === undefined → windowTokens=0
            pipelineReturn = msgTokens(700);
            const ctx = makeCtx({ sessionId: "hw-undef" });        // no getContextUsage
            const r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, ctx) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);                   // no nudge
            expect(getRuntime("hw-undef").aboveHighWater).toBe(false); // unchanged
          });
      (d) it("fail-open: contextWindow === 0 → no high-water nudge (shouldHighWater returns false)", () => {
            pipelineReturn = msgTokens(700);
            const ctx = makeCtx({ sessionId: "hw-zero", getContextUsage: usage(0) });
            const r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, ctx) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);                   // no nudge
            expect(getRuntime("hw-zero").aboveHighWater).toBe(false);
          });
      (e) it("does not fire high-water when well below the fraction (0.3)", () => {
            pipelineReturn = msgTokens(300);
            const ctx = makeCtx({ sessionId: "hw-low", getContextUsage: usage(1000) });
            const r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, ctx) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);
            expect(getRuntime("hw-low").aboveHighWater).toBe(false);
          });
  - GOTCHA: build `pi` via makePi() inside each it() (or share via a local). Clear pipelineReturn between fires in
    the lifecycle it() (it is module-scoped + reset in beforeEach, but within one it() you reassign it directly).
  - GOTCHA: assert content contains "~70%" (Math.round(700/1000*100)=70). For a 0.75 fraction use msgTokens(750)
    + usage(1000) → "~75%".

Task 7: MODIFY test/filter.test.ts — ADD windowed-drift wiring scenarios (contract bullets 1–2)
  - ADD (in the existing contextHandler describe OR a new describe) two its asserting the WIRING passes
    recentMetrics (not the single metric) to shouldNudge. These are thin — shouldNudge's OWN behavior is tested in
    test/drift_nudge.test.ts (T4.S1); here we assert contextHandler calls it with the window + injects/suppresses.
      (a) it("does NOT inject the drift nudge for a single heavy-turn window (windowed: §5.1)", () => {
            // window = [heavy(7000), small(100), small(100)] → moving-avg = 2400 < 6000 → no fire
            pipelineReturn = [{ role: "user", content: "P" }];
            const ctx = makeCtx({ sessionId: "wd-single", entries: [
              customEntry("mulligan:turn-metric", metricData(3, true)),   // 7000 (heavy)
              customEntry("mulligan:turn-metric", metricData(2, false)),  // 100
              customEntry("mulligan:turn-metric", metricData(1, false)),  // 100
            ]});
            const r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, ctx) as {messages:unknown[]};
            expect(r.messages).toHaveLength(1);  // no drift nudge (avg 2400 < 6000), no markers → no high-water either
          });
      (b) it("injects the drift nudge for a sustained-growth window (windowed: §5.1)", () => {
            // window = [7000, 7000, 7000] → moving-avg = 7000 > 6000 → fire
            pipelineReturn = [{ role: "user", content: "P" }];
            const ctx = makeCtx({ sessionId: "wd-sustained", entries: [
              customEntry("mulligan:turn-metric", metricData(3, true)),
              customEntry("mulligan:turn-metric", metricData(2, true)),
              customEntry("mulligan:turn-metric", metricData(1, true)),
            ]});
            const r = contextHandler(pi, {type:"context",messages:[]} as ContextEvent, ctx) as {messages:unknown[]};
            expect(r.messages).toHaveLength(2);  // drift nudge appended
            expect((r.messages[1] as Record<string,unknown>).customType).toBe("mulligan:nudge");
          });
  - GOTCHA: these use the DEFAULT makeCtx (no getContextUsage) so the high-water block is a no-op (the single
    "P"-content message is ~1 token, far below any fraction anyway). They isolate the drift wiring.
  - GOTCHA: recentMetrics is sorted NEWEST-FIRST by readMarkers; metricData(3,..) has seq 3 → index 0. shouldNudge
    slices the first driftWindowTurns (3) regardless of order (it averages), so order within the window does not
    affect the moving-average result here.

Task 8 (OPTIONAL — none): no docs/README/spec change. The integration is internal to contextHandler (item contract
  point 6: spec/06 §1 + spec/07 §5 already specify it). README feature-blurb sync is P3.M4.T1.S3.
```

### Implementation Patterns & Key Details

```typescript
// ── Task 1: the import line (src/filter.ts, ~line 51) ──
//   BEFORE: import { shouldNudge, injectNudge, suppressCheck } from "./nudges.js";
//   AFTER:  import { shouldHighWater, injectHighWaterNudge, injectNudge, shouldNudge, suppressCheck } from "./nudges.js";
//   (estimateTokens already imported at line ~48 — do NOT re-import.)

// ── Task 2: the drift-nudge guard (src/filter.ts contextHandler) — REPLACE the guard, KEEP the body. ──
    if (
      config.nudges.perTurnDrift &&
      markers.recentMetrics &&
      markers.recentMetrics.length > 0 &&
      shouldNudge(markers.recentMetrics, config) &&
      markers.metric &&
      !suppressCheck(markers.metric, markers)
    ) {
      messages = injectNudge(messages, markers.metric); // UNCHANGED — still the latest metric for the text
    }

// ── Task 3: the high-water block (src/filter.ts contextHandler) — INSERT after Task 2's block, before the cache. ──
    // Edge-triggered high-water signal (spec/07 §5.2, REQUIRED). See the JSDoc above; the block is defensive.
    let totalFilteredTokens = 0;
    let windowTokens = 0;
    try {
      type TokenMessages = Parameters<typeof estimateTokens>[0];
      totalFilteredTokens = estimateTokens(messages as unknown as TokenMessages).tokens;
      const usage = ctx.getContextUsage?.();
      windowTokens = usage?.contextWindow ?? 0;
    } catch {
      // defensive — leave both at 0; shouldHighWater(_, 0, …) → false (fail-open, never break the turn)
    }
    if (shouldHighWater(totalFilteredTokens, windowTokens, rt, config)) {
      messages = injectHighWaterNudge(messages, totalFilteredTokens, windowTokens);
    }
//   Then the EXISTING cache + observability + retirement code follows UNCHANGED:
//       rt.lastFiltered = messages as unknown as AgentMessage[];
//       rt.lastFilterTs = Date.now();
//       try { ...estimateTokens... log("info","filter.fire",...) } catch { ... }

// ── Task 5: makeCtx extension (test/filter.test.ts) ──
//   ADD `getContextUsage?` to opts; attach to the returned ctx ONLY when provided (default absent ⇒ existing
//   tests unaffected). See Task 6 for the usage() + msgTokens() helpers.

// ── WHY optional chaining on getContextUsage: the test fake does not define it (default), so undefined →
//   windowTokens=0 → no high-water in existing tests. In prod the method IS on ExtensionContext (called normally).
// ── WHY the inner try/catch around the estimate: belt-and-suspenders (estimateTokens never throws; getContextUsage
//   is optional-chained), but the contract mandates defensive wrapping — never break the turn over an annotation.
// ── WHY compute totalFilteredTokens BEFORE the high-water nudge: the nudge must not push the total over its own
//   threshold. The drift nudge (already in `messages`) IS included ("post-nudge", per the contract).
// ── WHY place before rt.lastFiltered: the cache (audit + baseline) should reflect the final filtered view the
//   model sees, INCLUDING both nudges — consistent with how the drift nudge is already cached.
// ── WHY one sessionId across the lifecycle test: rt is per-session; the latch lives in rt.aboveHighWater.
//   clearAll() in beforeEach wipes rt, so a true end-to-end lifecycle must be ONE it() with sequential fires.
```

### Integration Points

```yaml
IMPORT (src/filter.ts — the ONE import edit):
  - extend: `import { shouldHighWater, injectHighWaterNudge, injectNudge, shouldNudge, suppressCheck } from "./nudges.js";`
  - (estimateTokens ALREADY imported at line ~48; NO other import.)

CALL SITES (src/filter.ts contextHandler — the ONLY edits):
  - drift-nudge guard TIGHTENED (Task 2): adds `markers.recentMetrics && markers.recentMetrics.length > 0` +
    moves `markers.metric` after `shouldNudge`. Body UNCHANGED.
  - high-water block ADDED (Task 3): totalFilteredTokens from estimateTokens(filtered messages) (D5);
    windowTokens from ctx.getContextUsage()?.contextWindow ?? 0; shouldHighWater(…) → injectHighWaterNudge(…).

NO nudges.ts CHANGE (shouldHighWater/renderHighWaterNudge/injectHighWaterNudge/shouldNudge ALREADY exported — T5.S1/T4.S1).
NO runtime.ts CHANGE (SessionRuntime.aboveHighWater ALREADY exists — T2.S1).
NO config.ts CHANGE (driftWindowTurns/highWaterFraction/driftThresholdTokens ALREADY exist — T1.S1).
NO markers.ts / transforms.ts / tokens.ts CHANGE.
NO index.ts CHANGE (no new handler/tool — contextHandler is already registered; the new calls are internal to it).
TESTS (test/filter.test.ts):
  - EXTEND makeCtx with an OPTIONAL getContextUsage override (default absent ⇒ existing tests unchanged).
  - ADD a high-water edge-trigger lifecycle describe (cross/latch/no-refire/clear/re-cross on one session id,
    fail-open when getContextUsage undefined / contextWindow 0, no-fire when below the fraction).
  - ADD windowed-drift wiring its (single heavy-turn window → no nudge; sustained-growth window → nudge).

[NO docs/README/spec change — internal integration; README sync is P3.M4.T1.S3.]
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after editing src/filter.ts (and again after the test edit). Fix before proceeding.
npx tsc --noEmit                      # Type-check the whole project (catches the import + the cast + the guard types).
# (This repo has no separate linter/formatter step in package.json; tsc --noEmit is the primary gate. If a
#  lint script exists, run it too: npm run lint || true.)

# Expected: Zero errors. If errors exist, READ the output — the most likely causes are:
#   - a typo in the new import names (shouldHighWater / injectHighWaterNudge must match the nudges.ts exports);
#   - a missing `rt` / `config` / `messages` reference (all already in scope in contextHandler);
#   - the TokenMessages cast (reuse verbatim — do not change the cast shape).
```

### Level 2: Unit Tests (Component Validation)

```bash
# The filter tests (readMarkers + contextHandler + retire + cap + the NEW high-water/drift its):
npx vitest run test/filter.test.ts

# The nudges tests (should NOT regress — this task does not touch nudges.ts, but confirm the helpers are intact):
npx vitest run test/drift_nudge.test.ts

# Full suite (catches any cross-file regression — e.g. a config/runtime consumer):
npm test

# Expected: ALL green. The new high-water lifecycle its pass; the windowed-drift its pass; every existing
# readMarkers / contextHandler / retire / cap / nudge it passes UNCHANGED (the default makeCtx has no
# getContextUsage ⇒ the high-water block is a no-op in every pre-existing test).
```

### Level 3: Integration Testing (System Validation)

```bash
# (No live pi / HTTP layer for this task — contextHandler is exercised via the vitest fakes in Level 2.)
# Smoke: build the extension + confirm it loads without a runtime error.
npx tsc --noEmit && echo "tsc OK"

# If the repo has a build step (package.json scripts.build), run it:
npm run build 2>/dev/null && echo "build OK" || echo "(no build script — skip)"

# Expected: tsc OK; build OK (or skipped). The extension still registers contextHandler exactly as before
# (registerFilterHandler is UNCHANGED) — the new calls are internal to the handler body.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual reasoning check (no command) — confirm the two signals are COMPLEMENTARY + zero-extra-requests:
#   - Windowed drift (§5.1): per-turn DELTA growth, smoothed over driftWindowTurns. Catches bursts.
#   - High-water (§5.2): absolute TOTAL level, edge-triggered. Catches slow steady creep neither single-turn
#     nor windowed-delta sees.
#   - Both ride the SAME context event (one inference) → D4 zero extra model requests. Both mutate ONLY the
#     in-flight copy (zero persistence). Both NEVER throw.
#
# If you want a quick sanity grep that the wiring landed:
grep -n "shouldHighWater\|injectHighWaterNudge\|recentMetrics.length > 0" src/filter.ts
# Expected: the import line + the tightened drift guard + the high-water block all present.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean (Level 1).
- [ ] `npx vitest run test/filter.test.ts` green — new high-water + windowed-drift its pass; existing its UNCHANGED (Level 2).
- [ ] `npx vitest run test/drift_nudge.test.ts` green — no nudges.ts regression (Level 2).
- [ ] `npm test` green — full suite (Level 2).

### Feature Validation
- [ ] Drift-nudge guard is the contract guard (non-empty recentMetrics window → windowed shouldNudge → markers.metric
      → !suppressCheck); injectNudge still takes markers.metric.
- [ ] High-water block computes totalFilteredTokens from the FILTERED messages (D5) + windowTokens from
      ctx.getContextUsage()?.contextWindow ?? 0; injects mulligan:high-water iff shouldHighWater(…) is true.
- [ ] Edge-trigger lifecycle holds across sequential fires on one session id (cross→latch→no-refire→drop→clear→re-cross).
- [ ] Fail-open: getContextUsage undefined / contextWindow 0 / estimate throws ⇒ no high-water nudge AND
      rt.aboveHighWater UNCHANGED.
- [ ] ALL existing readMarkers/contextHandler/retire/cap/nudge tests pass UNCHANGED.

### Code Quality Validation
- [ ] Follows the existing contextHandler structure (the high-water block slots in after the drift-nudge block).
- [ ] Reuses the `type TokenMessages = Parameters<typeof estimateTokens>[0]` cast (no new cast idiom).
- [ ] Defensive inner try/catch mirrors the existing observability-log pattern.
- [ ] NO change to nudges.ts / config.ts / runtime.ts / markers.ts / transforms.ts / index.ts.

### Documentation & Deployment
- [ ] No new env vars. No docs change (internal integration; README sync is P3.M4.T1.S3).
- [ ] The behavior is already specified (spec/06 §1 + spec/07 §5).

---

## Anti-Patterns to Avoid

- ❌ Don't use `getContextUsage().tokens` for the high-water TOTAL (D5 — it counts hidden/rewound tokens). Use
  `estimateTokens(messages).tokens` (the filtered view).
- ❌ Don't call `getContextUsage()` without optional chaining — the test fake (default makeCtx) has no such method;
  `ctx.getContextUsage?.()` keeps existing tests green.
- ❌ Don't skip the inner try/catch around the high-water estimate — the contract mandates defensive wrapping
  (never break the turn over an annotation), even though estimateTokens never throws.
- ❌ Don't move `markers.metric` out of the drift guard — injectNudge + suppressCheck still need the LATEST metric
  (the text + the time-window suppress heuristic). Only the shouldNudge CALL moves to recentMetrics.
- ❌ Don't compute totalFilteredTokens AFTER injecting the high-water nudge — the nudge must not push the total
  over its own threshold. Compute it on the post-drift-nudge, pre-high-water-nudge `messages`.
- ❌ Don't edit nudges.ts / config.ts / runtime.ts / markers.ts — the helpers, the latch, the knobs, and
  recentMetrics are ALL already shipped. This task is the CALL SITE only.
- ❌ Don't change makeCtx's DEFAULT behavior — the new getContextUsage opt must be ABSENT by default so the
  high-water block is a no-op in every pre-existing test.
- ❌ Don't use a fresh sessionId per lifecycle step in the tests — the edge-trigger latch lives in per-session rt;
  the full lifecycle must reuse ONE sessionId (or be ONE it()).