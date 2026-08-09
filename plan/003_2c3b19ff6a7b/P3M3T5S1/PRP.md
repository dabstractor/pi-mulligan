name: "P3.M3.T5.S1 — Add shouldHighWater + renderHighWaterNudge + injectHighWaterNudge (spec/07 §5.2 edge-triggered)"
description: |

---

## Goal

**Feature Goal**: Implement the **edge-triggered high-water signal** (spec/07 §5.2, REQUIRED) — three exported
pure-ish helpers in `src/nudges.ts` that detect when the *total filtered* context crosses a high-water fraction
of the model's window and compose + inject a one-line annotation. `shouldHighWater` latches `rt.aboveHighWater` so
the annotation fires **once on the upward crossing** and **not every turn while above** (it re-arms only after the
total drops back below the fraction). This catches slow, steady accumulation that the per-turn delta nudge (§5.1)
structurally cannot see, without nagging.

**Deliverable**:
- `src/nudges.ts` — **ADD** three exports + ONE new type import. NO modification to existing functions
  (`shouldNudge`, `injectNudge`, `suppressCheck`, the Nudge A handlers, `turnEndMetricHandler`, their registrars,
  `NUDGE_TURN_WINDOW_MS`). No call-site change (contextHandler wiring is the separate P3.M3.T6.S1).
  - `shouldHighWater(totalFilteredTokens: number, windowTokens: number, rt: SessionRuntime, config: MulliganConfig): boolean`
    — pure boolean **except** it mutates `rt.aboveHighWater` (the intentional edge-trigger latch).
  - `renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string` — pure, never-throws,
    one-line annotation in `renderDriftNudge` style.
  - `injectHighWaterNudge(messages: MessageLike[], totalFilteredTokens: number, windowTokens: number): MessageLike[]`
    — pure (returns a NEW array with an ephemeral `mulligan:high-water` CustomMessage appended; input NOT mutated).
  - `import type { SessionRuntime } from "./runtime.js";` — NEW type import (the value `getRuntime` is already
    imported; `SessionRuntime` is needed for `shouldHighWater`'s `rt` parameter type).
- `test/drift_nudge.test.ts` — **ADD** imports (`shouldHighWater`, `renderHighWaterNudge`, `injectHighWaterNudge`
  to the existing nudges.js import line; `SessionRuntime` type from runtime.js; `MulliganConfig` type from
  config.js) + an `rt()` helper + new `describe` blocks covering the contract's mocking scenarios (the FULL
  edge-trigger lifecycle on one `rt`, fail-open at `windowTokens <= 0`, renderer non-empty, injector purity).
  Existing `shouldNudge`/`injectNudge`/`suppressCheck`/`NUDGE_TURN_WINDOW_MS` describes + the `metric()`/
  `rewind()`/`shrink()` helpers are **UNCHANGED**.

**Success Definition**:
- `shouldHighWater(140000, 200000, rt{aboveHighWater:false}, cfg{fraction:0.7})` → `true` AND `rt.aboveHighWater === true` after.
- Called again with the same values → `false` (already above; no re-fire). `rt.aboveHighWater` stays `true`.
- `shouldHighWater(100000, 200000, rt, cfg{0.7})` → `false` AND `rt.aboveHighWater === false` (cleared on dropping below).
- Called again with `140000` → `true` (re-crossed after dropping below — the latch re-armed).
- `shouldHighWater(_, 0, rt, cfg)` → `false` (fail-open; windowTokens <= 0). `rt.aboveHighWater` **unchanged**.
- `renderHighWaterNudge(140000, 200000)` → non-empty string containing `~70%`.
- `injectHighWaterNudge([...m], 140000, 200000)` → NEW array of length `m.length + 1`; last element is
  `{role:"custom", customType:"mulligan:high-water", content:<non-empty>, display:false, ...}`; input array untouched.
- `npx tsc --noEmit` clean; `npm test` green (new describes pass; no regression).

## Why

- **spec/07 §5.2 (Edge-triggered high-water signal, REQUIRED) mandates it.** §5.2: "the filter MUST inject a
  one-line annotation the first time the **total filtered** context crosses a high-water fraction of the window
  (`config.nudges.highWaterFraction`, default 0.7) … It MUST be **edge-triggered** — fire once on crossing, not every
  turn while above — by tracking `rt.aboveHighWater` … This catches slow, steady accumulation that no single-turn
  delta nudge sees, without nagging." The windowed drift nudge (§5.1, P3.M3.T4.S1) is *per-turn delta* growth; the
  high-water signal is *absolute total* level. They are complementary: a session adding 3k tokens/turn never trips
  the §5.1 delta nudge (each turn < 6000 threshold) but the *total* creeps toward the window — §5.2 fires once at 70%.
- **This is the HELPER-LAYER slice of milestone P3.M3.G1.** P3.M3.T1.S1 (config knob `highWaterFraction`=0.7) —
  COMPLETE. P3.M3.T2.S1 (runtime state `rt.aboveHighWater`) — COMPLETE. P3.M3.T5.S1 (**this task**) — the three
  helpers. P3.M3.T6.S1 (contextHandler wiring: compute `totalFilteredTokens` from the filtered view + `windowTokens`
  from `ctx.getContextUsage()?.contextWindow` + call these helpers) — LATER, builds on top. This task exports the
  helpers and unit-tests them directly; it does NOT touch the filter call site.
- **Small, surgical, mostly-pure-function addition.** Three functions + one type import + tests. No new file, no
  config/runtime/marker change, no Pi-surface change, no tokenization inside the helpers. The helpers are pure
  arithmetic + string composition + array spread — deterministic, Tier-1 unit-testable with NO Pi (spec/07 §3).

## What

**User-visible behavior**: Indirect, via the high-water annotation injected into the in-flight message copy at the
`context` event (wired by P3.M3.T6.S1). The first turn whose *filtered* context total crosses 70% of the window
fires a single one-line `[mulligan] Context is at ~70% of the window …` annotation (recommending
`mulligan_shrink`/`mulligan_rewind`). It does NOT repeat on subsequent turns while still above 70%; it re-fires only
after the total drops below 70% (e.g. after a shrink/rewind) and then crosses up again. Zero extra requests (rides
the existing `context` inference — D4).

**Technical requirements** (from the work-item contract + Pattern 9 — implement EXACTLY):

1. **`shouldHighWater` signature**: `(totalFilteredTokens: number, windowTokens: number, rt: SessionRuntime,
   config: MulliganConfig): boolean`. Mutates `rt.aboveHighWater` (the edge-trigger latch). NOT purely functional
   (the contract is explicit: edge state must live in the session runtime).
2. **`shouldHighWater` algorithm** (Pattern 9, verified verbatim against the architecture doc):
   - `if (windowTokens <= 0) return false;` — fail-open (E12: `getContextUsage` undefined / no model →
     `contextWindow` 0). Do NOT mutate `rt.aboveHighWater` on this path.
   - `const fraction = totalFilteredTokens / windowTokens;`
   - `if (fraction >= config.nudges.highWaterFraction) { if (!rt.aboveHighWater) { rt.aboveHighWater = true;
     return true; } return false; }` — first upward crossing fires (latches true); subsequent turns above do NOT
     re-fire.
   - `rt.aboveHighWater = false; return false;` — dropped below the fraction → clear the latch (re-arm for the next
     crossing) and do not fire.
3. **`renderHighWaterNudge` signature**: `(totalFilteredTokens: number, windowTokens: number): string`. PURE,
   never throws. ONE-line annotation in `renderDriftNudge` style:
   `[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`
   where `<pct>` = `Math.round((totalFilteredTokens / windowTokens) * 100)`. Guard `windowTokens <= 0`
   defensively → return a fallback string without a percentage (shouldHighWater short-circuits this in prod, but
   the renderer is exported + directly testable; never let a NaN/`Infinity`% leak).
4. **`injectHighWaterNudge` signature**: `(messages: MessageLike[], totalFilteredTokens: number, windowTokens:
   number): MessageLike[]`. PURE — returns a NEW array `[…messages, nudge]`; input NOT mutated. Mirrors `injectNudge`:
   appends an EPHEMERAL `mulligan:high-water` CustomMessage `{ role:"custom", customType:"mulligan:high-water",
   content: renderHighWaterNudge(…), display:false, details:{ ephemeral:true, totalFilteredTokens, windowTokens },
   timestamp: Date.now() }`. The nudge lives ONLY in the returned copy (the model sees it THIS inference); Pi
   persists the ORIGINAL branch untouched (zero persistence).
5. **NO call-site change** in this task. contextHandler (P3.M3.T6.S1) computes `totalFilteredTokens =
   estimateTokens(messages).tokens` (FILTERED view — D5: never `getContextUsage().tokens`) and `windowTokens =
   ctx.getContextUsage()?.contextWindow ?? 0`, then calls `shouldHighWater(…)` + `injectHighWaterNudge(…)`.

### Success Criteria
- [ ] `shouldHighWater`, `renderHighWaterNudge`, `injectHighWaterNudge` are all **exported** from `src/nudges.ts`.
- [ ] `shouldHighWater` mutates `rt.aboveHighWater` with correct edge-trigger lifecycle (cross→fire+latch; above→no
      re-fire; drop-below→clear; re-cross→fire again; `windowTokens<=0`→false WITHOUT mutation).
- [ ] `renderHighWaterNudge` returns a non-empty string containing the percentage; never throws (incl. `windowTokens<=0`).
- [ ] `injectHighWaterNudge` returns a NEW array (input untouched) with the `mulligan:high-water` CustomMessage appended.
- [ ] `SessionRuntime` type imported into `nudges.ts`; `shouldNudge`/`injectNudge`/`suppressCheck`/handlers UNCHANGED.
- [ ] `npx tsc --noEmit` clean; `npm test` green (new describes pass; no regression in the rest of the suite).

## All Needed Context

### Context Completeness Check

> If someone knew nothing about this codebase, would they have everything needed to implement this successfully?

**Yes.** This PRP quotes the EXACT current `injectNudge` (the mirror template for `injectHighWaterNudge`), the EXACT
`shouldHighWater` body from architecture `implementation_patterns.md` Pattern 9 (verified verbatim), the EXACT
`renderDriftNudge` style + the EXACT high-water text format the contract specifies, the EXACT current imports in
`nudges.ts` (so the implementer knows `estimateTokens`/`renderDriftNudge`/`MessageLike` are ALREADY imported and only
the `SessionRuntime` TYPE is new), the EXACT `MessageLike` shape (index signature → no cast on the nudge literal),
the EXACT `highWaterFraction` config knob + `aboveHighWater` runtime field (both ALREADY exist), and the EXACT
test-file imports + helper pattern to extend. It cites spec/07 §5.2 (the source), external_deps.md (the
`ContextUsage.contextWindow` surface the caller will use), and Pattern 9 (the algorithm). An implementer who has
never seen this repo can do it from this document + `src/nudges.ts` + `src/notes.ts` + `src/runtime.ts` +
`test/drift_nudge.test.ts`.

### Documentation & References

```yaml
# MUST READ — the file being edited (all three helpers are ADDED here)
- file: src/nudges.ts
  why: |
    Where shouldHighWater + renderHighWaterNudge + injectHighWaterNudge are ADDED (exported). The file currently
    holds Nudge A (bloatReminderHandler/registerBloatReminder), the turn_end metric (turnEndMetricHandler/
    registerTurnEndMetric), NUDGE_TURN_WINDOW_MS, shouldNudge, injectNudge, suppressCheck — ALL UNCHANGED. The new
    helpers fit naturally in the "Phase 2 injection" region near injectNudge/suppressCheck (they are the same
    conceptual layer: pure-ish nudge gates/injectors consumed by contextHandler). estimateTokens, renderDriftNudge,
    MessageLike, MulliganConfig, TurnMetric are ALREADY imported. The ONE new import is the SessionRuntime TYPE
    (getRuntime is imported as a value; the type is not — add `import type { SessionRuntime } from "./runtime.js";`).
  section: injectNudge + suppressCheck region (~lines 380–460)
  pattern: |
    # injectNudge — the MIRROR TEMPLATE for injectHighWaterNudge (verbatim current code):
    export function injectNudge(messages: MessageLike[], metric: TurnMetric): MessageLike[] {
      const line = renderDriftNudge(metric);
      const nudge: MessageLike = {
        role: "custom",
        customType: "mulligan:nudge",
        content: line,
        display: false,
        details: { ephemeral: true, turnIndex: metric.turnIndex },
        timestamp: Date.now(),
      };
      return [...messages, nudge];
    }
    #   ── injectHighWaterNudge mirrors this with customType:"mulligan:high-water",
    #      content: renderHighWaterNudge(totalFilteredTokens, windowTokens), and
    #      details:{ ephemeral:true, totalFilteredTokens, windowTokens }. PURE (new array; input untouched).
  gotcha: |
    Do NOT modify shouldNudge/injectNudge/suppressCheck/bloatReminderHandler/registerBloatReminder/
    turnEndMetricHandler/registerTurnEndMetric/NUDGE_TURN_WINDOW_MS. (The parallel sibling P3.M3.T4.S1 rewrites
    shouldNudge to a windowed gate; that is orthogonal — shouldHighWater does not touch it. Coordinate merge order
    only if both land in the same file edit; they touch different functions.)

# MUST READ — renderDriftNudge (the STYLE reference for renderHighWaterNudge)
- file: src/notes.ts
  why: |
    renderDriftNudge establishes the nudge-text DISCIPLINE: leading "[mulligan] " prefix, single responsibility,
    DEFENSIVE (never throws — readOwn/isRecord guards; a malformed metric renders gracefully), NO trailing newline,
    ~25–40 tokens. renderHighWaterNudge follows the same discipline but emits ONE line (the contract pins the text;
    the drift nudge is 3 lines). The notes.ts kTokens() helper exists (delta/1000) but is NOT used here — high-water
    interpolates a PERCENTAGE (Math.round(fraction*100)), not kTokens.
  section: renderDriftNudge (~lines 295–337); renderBloatReminder (~251–289) for the defensive style
  pattern: |
    # renderDriftNudge FORMAT (the style to mirror):
    #   [mulligan] <first line>.
    #   <tail lines ...>
    # renderHighWaterNudge FORMAT (ONE line, pinned by the contract):
    #   [mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.
    #   <pct> = Math.round((totalFilteredTokens / windowTokens) * 100)
    # Defensive: windowTokens <= 0 → return a fallback WITHOUT a percentage (avoid NaN%/Infinity%).

# MUST READ — SessionRuntime.aboveHighWater (the latch shouldHighWater mutates)
- file: src/runtime.ts
  why: |
    Confirms SessionRuntime ALREADY has aboveHighWater: boolean (P3.M3.T2.S1 COMPLETE) with full latch semantics in
    its JSDoc (set true when the annotation fires, cleared when total drops below; auto-reset via resetRuntime on
    session_start + clearAll). Default false in freshRuntime. shouldHighWater's `rt` param is the LIVE mutable
    reference (callers mutate fields in place). shouldHighWater does NOT call getRuntime — the caller (contextHandler)
    passes `rt` in; this keeps shouldHighWater unit-testable with a hand-built rt literal.
  section: SessionRuntime interface (aboveHighWater field) + freshRuntime
  pattern: |
    aboveHighWater: boolean;   // latch; default false; mutated by shouldHighWater
  gotcha: |
    shouldHighWater RECEIVES rt as a parameter — do NOT call getRuntime() inside it (that would make it
    non-unit-testable and would need a sessionId it doesn't have). The contract signature is the source of truth.

# MUST READ — the highWaterFraction config knob (ALREADY EXISTS; this task only READS it)
- file: src/config.ts
  why: |
    Confirms MulliganConfig.nudges.highWaterFraction: number EXISTS (P3.M3.T1.S1 COMPLETE): default 0.7, must be in
    (0,1), validated (non-finite/non-number → 0.7 default + warn; NOT string-coerced; 0.01/0.99 kept). The JSDoc
    names THIS task as the consumer. shouldHighWater READS config.nudges.highWaterFraction; NO config change here.
  section: MulliganConfig.nudges (highWaterFraction) + DEFAULT_CONFIG + validateConfig

# MUST READ — MessageLike (the array element type for injectHighWaterNudge)
- file: src/transforms.ts
  why: |
    MessageLike = { role?: string; content?: string | ContentBlock[]; [key: string]: unknown }. The INDEX SIGNATURE
    means the nudge object literal {role, customType, content, display, details, timestamp} assigns in with NO cast
    (same as injectNudge). customType is read elsewhere via readOwn(msg,"customType") + startsWith("mulligan:").
  section: MessageLike interface (~lines 53–58)

# Architecture reference (read-only) — the EXACT shouldHighWater algorithm
- docfile: plan/003_2c3b19ff6a7b/architecture/implementation_patterns.md
  section: "Pattern 9: High-water signal (nudges.ts)"
  why: |
    Pattern 9 gives the shouldHighWater body VERBATIM (windowTokens<=0 fail-open → false; fraction=total/window;
    fraction>=highWaterFraction → latch-on-first-cross fire; else clear latch + false). This PRP's algorithm mirrors
    Pattern 9 exactly. Read it to confirm the edge-trigger semantics + the fail-open placement (return BEFORE any
    rt mutation). Pattern 11 sketches the contextHandler wiring (P3.M3.T6.S1's job, NOT this task's).

# Architecture reference (read-only) — the ContextUsage surface the CALLER uses
- docfile: plan/003_2c3b19ff6a7b/architecture/external_deps.md
  section: "ContextUsage type (critical for §5.2 high-water signal)"
  why: |
    ContextUsage { tokens: number|null; contextWindow: number; percent: number|null }; ctx.getContextUsage():
    ContextUsage|undefined. The CALLER (contextHandler, P3.M3.T6.S1) computes windowTokens =
    ctx.getContextUsage()?.contextWindow ?? 0 and totalFilteredTokens = estimateTokens(messages).tokens (D5: NEVER
    getContextUsage().tokens — it counts hidden tokens). shouldHighWater receives BOTH already computed. This task
    does NOT call getContextUsage — it documents where windowTokens/totalFilteredTokens come from so the implementer
    understands the inputs.

# MUST READ — the test file to extend (imports + helpers + the pure-test discipline)
- file: test/drift_nudge.test.ts
  why: |
    The home for the new unit tests. Imports { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS } from
    "../src/nudges.js" (ADD shouldHighWater, renderHighWaterNudge, injectHighWaterNudge here); imports type
    { TurnMetric, RewindMarker, ShrinkMarker } from markers.js + type { MessageLike } from transforms.js (ADD type
    { SessionRuntime } from runtime.js + type { MulliganConfig } from config.js). Has metric()/rewind()/shrink()
    helpers (partial literals cast to the marker type — pure-test scaffolding). ADD an rt() helper building a
    minimal SessionRuntime (aboveHighWater:false + all fields defaulted) + new describe blocks. NO Pi fakes,
    NO clearAll, NO setConfig — these are pure helpers (spec/07 §3 Tier-1).
  section: imports (~lines 1–4) + metric() helper (~lines 12–25)

# Spec sources (read-only — the authoritative meaning)
- docfile: spec/07-preventive-and-nudges.md
  section: "§5.2 Edge-triggered high-water signal (REQUIRED)"
  why: |
    The source requirement: "inject a one-line annotation the first time the total filtered context crosses
    highWaterFraction (default 0.7) of the window … edge-triggered — fire once on crossing, not every turn while
    above — tracked via rt.aboveHighWater." §2 (Nudge B mechanism) establishes the free-ride-on-context principle
    (D4 zero extra requests) + the ephemeral-CustomMessage injection technique this task's injectHighWaterNudge
    reuses. §3 (determinism & testability) mandates Tier-1 pure-helper unit tests (no Pi).

# The parallel sibling (assumed to land as specified) — shouldNudge windowing
- docfile: plan/003_2c3b19ff6a7b/P3M3T4S1/PRP.md
  why: |
    P3.M3.T4.S1 rewrites shouldNudge to a windowed moving-average gate. It is ORTHOGONAL to this task (different
    function, no shared state) but lands in the SAME file (src/nudges.ts). Coordinate: if both land in one edit,
    keep them in separate regions; shouldHighWater does not read shouldNudge and vice versa. Neither blocks the
    other. (The contextHandler wiring that calls BOTH — windowed shouldNudge + shouldHighWater — is P3.M3.T6.S1.)
```

### Current Codebase tree (relevant slice)

```bash
src/
  nudges.ts          # <-- MODIFY: ADD shouldHighWater + renderHighWaterNudge + injectHighWaterNudge + SessionRuntime type import.
                     #     shouldNudge/injectNudge/suppressCheck/Nudge A/turn_end/registrars/NUDGE_TURN_WINDOW_MS UNCHANGED.
  notes.ts           # read-only (renderDriftNudge STYLE reference; renderHighWaterNudge mirrors its discipline)
  runtime.ts         # read-only (SessionRuntime.aboveHighWater ALREADY exists — P3.M3.T2.S1)
  config.ts          # read-only (highWaterFraction ALREADY exists — P3.M3.T1.S1)
  tokens.ts          # read-only (estimateTokens — the caller computes totalFilteredTokens; helpers receive it)
  transforms.ts      # read-only (MessageLike — index signature, nudge literal assigns with no cast)
  markers.ts         # read-only (TurnMetric — not consumed by the high-water helpers, but co-imported)
  filter.ts          # NOT MODIFIED in this task (contextHandler wiring = P3.M3.T6.S1)
test/
  drift_nudge.test.ts # <-- MODIFY: ADD imports + rt() helper + new describes for the three helpers.
                      #     shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS describes + metric/rewind/shrink UNCHANGED.
spec/
  07-preventive-and-nudges.md  # read-only (§5.2 — the requirement; §2 — the injection technique; §3 — Tier-1 tests)
plan/003_2c3b19ff6a7b/architecture/
  implementation_patterns.md   # read-only (Pattern 9 — the exact shouldHighWater algorithm; Pattern 11 — caller wiring)
  external_deps.md             # read-only (ContextUsage.contextWindow — what the caller passes as windowTokens)
```

### Desired Codebase tree with files to be added and responsibility

```bash
src/nudges.ts         # EDITED in place. Three new exports (shouldHighWater, renderHighWaterNudge, injectHighWaterNudge) + SessionRuntime type import.
test/drift_nudge.test.ts # EDITED in place. New imports + rt() helper + new describes covering the edge-trigger lifecycle + fail-open + renderer + injector.
# No new files. All changes are additions to existing files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — shouldHighWater is the ONLY impure helper. It mutates rt.aboveHighWater (the edge-trigger latch).
//   The contract is explicit: "shouldHighWater mutates rt — it is NOT purely functional despite taking simple
//   args; this is intentional (edge-trigger state must live in the session runtime)." renderHighWaterNudge +
//   injectHighWaterNudge ARE pure. Document this asymmetry in the JSDoc.

// CRITICAL — the edge-trigger lifecycle is STATEFUL and must be tested IN ORDER on ONE rt. The contract's mocking
//   scenarios (a)–(d) are a single sequence: cross→fire+latch (rt.aboveHighWater becomes true); same values
//   again→no re-fire (stays true); drop below→clear (becomes false); cross again→fire again (re-armed). A test
//   that builds a FRESH rt for each scenario would NOT exercise the latch — it would always start aboveHighWater:false.
//   Reuse ONE rt across the lifecycle its, OR assert the field's transition each step.

// CRITICAL — windowTokens <= 0 is fail-open AND MUST NOT mutate rt.aboveHighWater. Pattern 9 returns false BEFORE
//   any latch touch. Decision: leave rt.aboveHighWater UNCHANGED on this path (early `return false;` above the
//   fraction block). Test: rt.aboveHighWater has whatever value it had before the call. Document in the JSDoc.
//   (Rationale: failing open means "no signal this turn"; clobbering the latch would either falsely clear a real
//   "above" state or falsely arm a re-fire — neither is correct when we can't even compute the fraction.)

// GOTCHA — `>=` not `>` for the fraction comparison (Pattern 9 + the contract: "fraction >= highWaterFraction").
//   At EXACTLY 0.7 of the window (e.g. totalFilteredTokens=140000, windowTokens=200000, fraction=0.7), it FIRES
//   (if the latch was false). Do not weaken to `>`.

// GOTCHA — the percentage uses Math.round (not floor/trunc): 0.7→70, 0.75→75, 0.666→67. The contract example says
//   "~70%" for 0.7. Math.round(0.7*100)=70 ✓. Guard windowTokens<=0 BEFORE dividing (avoid NaN/Infinity%).

// GOTCHA — renderHighWaterNudge is exported and DIRECTLY testable, so it must be TOTAL (never throw) even for
//   windowTokens<=0 (shouldHighWater short-circuits this in prod, but a test/another caller could call the
//   renderer directly). Return a fallback string without a percentage on that path. Match renderDriftNudge/
//   renderBloatReminder's "DEFENSIVE — NEVER throws" discipline (they guard malformed inputs and render gracefully).

// GOTCHA — injectHighWaterNudge is PURE: return [...messages, nudge]. Do NOT push into the input array. Mirror
//   injectNudge exactly (it returns a new array; the input is untouched). The returned nudge is a MessageLike
//   literal that assigns with NO cast (MessageLike has an index signature — [key:string]:unknown).

// GOTCHA — customType is "mulligan:high-water" (DISTINCT from "mulligan:nudge"). The drift nudge and the
//   high-water nudge are individually detectable by mulligan-aware code via the customType.startsWith("mulligan:")
//   check (transforms.ts isMulliganCustom). Do NOT reuse "mulligan:nudge" — they serve different purposes and
//   should be separable for any future dedup/audit logic.

// GOTCHA — NO new value imports. estimateTokens + renderDriftNudge + MessageLike + MulliganConfig + TurnMetric are
//   ALREADY imported into nudges.ts. The ONE new import is the SessionRuntime TYPE: `import type { SessionRuntime }
//   from "./runtime.js";`. Follow the codebase convention of a SEPARATE `import type` line for a same-module
//   value+type pair (config.js: `import { getConfig }` + `import type { MulliganConfig }`; tokens.js: value +
//   `import type { ResultContentBlock }`). Do NOT inline `import { getRuntime, type SessionRuntime }` — match the
//   existing separate-line style.

// GOTCHA — NO call-site change. contextHandler (src/filter.ts) is NOT modified here. The caller wiring (computing
//   totalFilteredTokens = estimateTokens(messages).tokens on the FILTERED view — D5; windowTokens =
//   ctx.getContextUsage()?.contextWindow ?? 0; then shouldHighWater(…)/injectHighWaterNudge(…)) is P3.M3.T6.S1.
//   Editing filter.ts in this task would exceed scope and conflict with the parallel T4.S1 call-site change.

// GOTCHA — D5 (NEVER use getContextUsage().tokens for the total). The high-water TOTAL is the FILTERED view
//   (estimateTokens(messages).tokens), exactly like mulligan_audit. getContextUsage().tokens counts HIDDEN tokens
//   (rewound messages still in Pi's view). The CALLER enforces this; the helpers receive totalFilteredTokens
//   already filtered. Document D5 in the JSDoc so P3.M3.T6.S1 does the right thing.

// GOTCHA — the helpers do NOT tokenize. shouldHighWater/renderHighWaterNudge/injectHighWaterNudge receive
//   totalFilteredTokens already computed. estimateTokens is imported into nudges.ts (used by turnEndMetricHandler)
//   but the high-water helpers do NOT call it. This keeps them pure + cheap (no re-tokenization in the gate).

// GOTCHA — E12 (getContextUsage undefined / no model / pre-first-inference → contextWindow 0). The windowTokens<=0
//   fail-open IS the E12 handling (at the helper level). The caller may additionally guard, but shouldHighWater's
//   early return is the authoritative fail-open. Never throw / never break the turn over a missing window size.
```

## Implementation Blueprint

### Data models and structure

```typescript
// NO data-model change. SessionRuntime.aboveHighWater: boolean ALREADY exists (P3.M3.T2.S1).
// MulliganConfig.nudges.highWaterFraction: number ALREADY exists (P3.M3.T1.S1). MessageLike ALREADY exists
// (transforms.ts). This task changes NO interface/type/schema — it ADDS three functions + one type import.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/nudges.ts — ADD the SessionRuntime TYPE import
  - LOCATE the runtime import line: `import { getRuntime } from "./runtime.js";` (~line 38).
  - ADD a SEPARATE type-import line immediately after it: `import type { SessionRuntime } from "./runtime.js";`
    (matches the config.js + tokens.js separate-line convention for same-module value+type pairs).
  - DO NOT inline `import { getRuntime, type SessionRuntime }` — follow the existing separate-line style.
  - WHY: shouldHighWater's third param is `rt: SessionRuntime`. getRuntime (value) is already imported; the TYPE is
    not. No other new import (estimateTokens, renderDriftNudge, MessageLike, MulliganConfig all already imported).

Task 2: MODIFY src/nudges.ts — ADD shouldHighWater (export) + full JSDoc
  - PLACE it in the "Phase 2" region near injectNudge/suppressCheck (~after suppressCheck, end of file), or
    immediately before injectHighWaterNudge so the helpers read in dependency order (shouldHighWater →
    renderHighWaterNudge → injectHighWaterNudge).
  - IMPLEMENT exactly (verbatim from Pattern 9 + the contract — see "Implementation Patterns & Key Details"):
        export function shouldHighWater(
          totalFilteredTokens: number,
          windowTokens: number,
          rt: SessionRuntime,
          config: MulliganConfig,
        ): boolean {
          if (windowTokens <= 0) return false; // fail-open (E12); do NOT touch rt.aboveHighWater here
          const fraction = totalFilteredTokens / windowTokens;
          if (fraction >= config.nudges.highWaterFraction) {
            if (!rt.aboveHighWater) {
              rt.aboveHighWater = true; // latch: first upward crossing fires
              return true;
            }
            return false; // already above → do not re-fire
          }
          rt.aboveHighWater = false; // dropped below → clear the latch (re-arm for next crossing)
          return false;
        }
  - WRITE the full JSDoc (see "Implementation Patterns & Key Details") — it MUST cite spec/07 §5.2, document the
    edge-trigger latch semantics, the `windowTokens <= 0` fail-open (E12) that does NOT mutate rt, the `>=`
    comparison, the D5 note (the caller computes totalFilteredTokens from the FILTERED view), and the explicit
    "PURE-but-mutates-rt" status (the intentional asymmetry).
  - NAMING: `totalFilteredTokens`, `windowTokens`, `rt`, `config`, local `fraction`.
  - GOTCHA: do NOT call getRuntime() inside (rt is passed in). do NOT mutate rt on the fail-open path.

Task 3: MODIFY src/nudges.ts — ADD renderHighWaterNudge (export) + full JSDoc
  - PLACE immediately after shouldHighWater.
  - IMPLEMENT exactly (see "Implementation Patterns & Key Details"):
        export function renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string {
          if (!(windowTokens > 0)) {
            // Defensive: can't compute a percentage. shouldHighWater short-circuits this in prod, but this
            // renderer is exported + directly callable — never let NaN/Infinity% leak. Fail to a percentage-free
            // line (mirrors renderDriftNudge/renderBloatReminder's never-throws discipline).
            return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";
          }
          const pct = Math.round((totalFilteredTokens / windowTokens) * 100);
          return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;
        }
  - WRITE the JSDoc — cite spec/07 §5.2, note the ONE-line format pinned by the contract, the renderDriftNudge
    style it mirrors (leading "[mulligan] " + never-throws + ~tokens), the Math.round percentage, and the
    windowTokens<=0 defensive fallback. NO trailing newline.
  - NAMING: `totalFilteredTokens`, `windowTokens`, local `pct`.
  - GOTCHA: PURE + never throws. Do NOT call renderDriftNudge (different text); only mirror its STYLE/discipline.

Task 4: MODIFY src/nudges.ts — ADD injectHighWaterNudge (export) + full JSDoc
  - PLACE immediately after renderHighWaterNudge.
  - IMPLEMENT exactly (mirrors injectNudge — see "Implementation Patterns & Key Details"):
        export function injectHighWaterNudge(
          messages: MessageLike[],
          totalFilteredTokens: number,
          windowTokens: number,
        ): MessageLike[] {
          const line = renderHighWaterNudge(totalFilteredTokens, windowTokens);
          const nudge: MessageLike = {
            role: "custom",
            customType: "mulligan:high-water",
            content: line,
            display: false,
            details: { ephemeral: true, totalFilteredTokens, windowTokens },
            timestamp: Date.now(),
          };
          return [...messages, nudge];
        }
  - WRITE the JSDoc — cite spec/07 §5.2 (rides the context inference — D4 zero extra requests; zero persistence
    — the nudge lives ONLY in the returned copy), document the PURE status (new array; input untouched), the
    MessageLike index-signature (no cast), the DISTINCT customType "mulligan:high-water", and that it is called by
    contextHandler (P3.M3.T6.S1) only when shouldHighWater returned true.
  - NAMING: `messages`, `totalFilteredTokens`, `windowTokens`, locals `line`, `nudge`.
  - GOTCHA: PURE. Do NOT push into messages. Mirror injectNudge's spread-return exactly.

Task 5: MODIFY test/drift_nudge.test.ts — ADD imports
  - LOCATE the nudges.js import line: `import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS }
    from "../src/nudges.js";` (~line 2).
  - ADD the three new exports to it: `import { shouldNudge, injectNudge, suppressCheck, NUDGE_TURN_WINDOW_MS,
    shouldHighWater, renderHighWaterNudge, injectHighWaterNudge } from "../src/nudges.js";`
  - ADD two type imports (new lines): `import type { SessionRuntime } from "../src/runtime.js";` and
    `import type { MulliganConfig } from "../src/config.js";` (both type-only — erased at runtime).
  - GOTCHA: the existing `import type { TurnMetric, RewindMarker, ShrinkMarker } from "../src/markers.js";` and
    `import type { MessageLike } from "../src/transforms.js";` stay UNCHANGED.

Task 6: MODIFY test/drift_nudge.test.ts — ADD an rt() helper + new describe blocks
  - ADD a minimal SessionRuntime helper near the existing metric()/rewind()/shrink() helpers:
        // Build a minimal SessionRuntime literal for the high-water edge-trigger lifecycle tests. aboveHighWater
        // starts false (the freshRuntime default); the lifecycle its mutate it in place to exercise the latch.
        function rt(above = false): SessionRuntime {
          return {
            sessionId: "s1", seq: 0, tokenBaseline: null, lastTurnIndex: null, lastFiltered: null,
            lastFilterTs: null, pendingBloatHits: [], shrinkMissCounts: new Map(), aboveHighWater: above,
          } as SessionRuntime;
        }
    ADD a tiny config helper (shouldHighWater reads nudges.highWaterFraction; cast a partial literal — it only
    reads that one field):
        const hcfg = (fraction = 0.7): MulliganConfig =>
          ({ nudges: { highWaterFraction: fraction } } as MulliganConfig);
  - ADD new describes (each exercises one contract scenario — place them AFTER the existing describes):
    (a) describe "shouldHighWater — edge-triggered latch (spec/07 §5.2)" with a SHARED-rt lifecycle sequence:
          it("fires on the first upward crossing and latches aboveHighWater true", () => {
            const r = rt(false); // window 200000, total 140000 → fraction 0.7 → fire
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
            expect(r.aboveHighWater).toBe(true);
          });
          it("does NOT re-fire while already above (edge-triggered)", () => {
            const r = rt(true); // already latched from a prior crossing
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(false);
            expect(r.aboveHighWater).toBe(true); // unchanged
          });
          it("clears the latch when the total drops back below the fraction", () => {
            const r = rt(true); // was above; total 100000 → fraction 0.5 < 0.7 → clear
            expect(shouldHighWater(100000, 200000, r, hcfg(0.7))).toBe(false);
            expect(r.aboveHighWater).toBe(false);
          });
          it("fires again after dropping below and re-crossing (re-armed)", () => {
            const r = rt(false); // simulate: was cleared, now crosses up again
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);
            expect(r.aboveHighWater).toBe(true);
          });
        // OPTIONAL: one SEQUENTIAL its that reuses ONE rt across the whole lifecycle end-to-end (stronger):
          it("full lifecycle on one rt: cross→latch→no-refire→drop→clear→re-cross→fire", () => {
            const r = rt(false);
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);  expect(r.aboveHighWater).toBe(true);
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(false); expect(r.aboveHighWater).toBe(true);
            expect(shouldHighWater(100000, 200000, r, hcfg(0.7))).toBe(false); expect(r.aboveHighWater).toBe(false);
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true);  expect(r.aboveHighWater).toBe(true);
          });
        // fail-open + boundary:
          it("returns false at windowTokens <= 0 WITHOUT mutating aboveHighWater (fail-open, E12)", () => {
            const r = rt(true);  // latched above; window unknown → must not fire NOR clear the latch
            expect(shouldHighWater(140000, 0, r, hcfg(0.7))).toBe(false);
            expect(r.aboveHighWater).toBe(true); // UNCHANGED — fail-open does not touch the latch
            const r2 = rt(false);
            expect(shouldHighWater(140000, -5, r2, hcfg(0.7))).toBe(false);
            expect(r2.aboveHighWater).toBe(false); // UNCHANGED
          });
          it("fires at exactly the fraction (>= comparison): total/window === highWaterFraction", () => {
            const r = rt(false);
            expect(shouldHighWater(140000, 200000, r, hcfg(0.7))).toBe(true); // 0.7 >= 0.7 → fire
          });
          it("honors a custom fraction (0.9): 0.7 < 0.9 → no fire", () => {
            const r = rt(false);
            expect(shouldHighWater(140000, 200000, r, hcfg(0.9))).toBe(false); // 0.7 < 0.9
            expect(r.aboveHighWater).toBe(false); // cleared (below)
          });
    (b) describe "renderHighWaterNudge — one-line annotation (spec/07 §5.2)" :
          it("returns a non-empty string containing the rounded percentage", () => {
            const s = renderHighWaterNudge(140000, 200000); // 0.7 → 70%
            expect(typeof s).toBe("string"); expect(s.length).toBeGreaterThan(0);
            expect(s).toContain("~70%"); expect(s).toContain("[mulligan]");
            expect(s).toContain("mulligan_shrink"); expect(s).toContain("mulligan_rewind");
          });
          it("rounds the percentage (0.75 → 75%, 0.666 → 67%)", () => {
            expect(renderHighWaterNudge(150000, 200000)).toContain("~75%"); // 0.75
            expect(renderHighWaterNudge(133333, 200000)).toContain("~67%"); // 0.6666 → 67
          });
          it("never throws + returns a percentage-free fallback when windowTokens <= 0", () => {
            expect(() => renderHighWaterNudge(140000, 0)).not.toThrow();
            const s = renderHighWaterNudge(140000, 0);
            expect(typeof s).toBe("string"); expect(s.length).toBeGreaterThan(0);
            expect(s).not.toContain("%"); // no NaN/Infinity%
            expect(s).toContain("mulligan_shrink"); // still recommends the tools
          });
    (c) describe "injectHighWaterNudge — pure injection (spec/07 §5.2, mirror injectNudge)" :
          it("returns a NEW array of length input+1 with a mulligan:high-water custom message appended", () => {
            const before: MessageLike[] = [{ role: "user", content: "hi" }];
            const out = injectHighWaterNudge(before, 140000, 200000);
            expect(out).not.toBe(before);              // new array (PURE)
            expect(out.length).toBe(2);                // input untouched + 1
            const nudge = out[1];
            expect(nudge.role).toBe("custom");
            expect(nudge.customType).toBe("mulligan:high-water");
            expect(typeof nudge.content).toBe("string");
            expect((nudge.content as string).length).toBeGreaterThan(0);
            expect(nudge.display).toBe(false);
            expect(nudge.details).toMatchObject({ ephemeral: true, totalFilteredTokens: 140000, windowTokens: 200000 });
            expect(typeof nudge.timestamp).toBe("number");
          });
          it("does NOT mutate the input array", () => {
            const before: MessageLike[] = [{ role: "user", content: "hi" }];
            injectHighWaterNudge(before, 140000, 200000);
            expect(before.length).toBe(1);             // untouched
            expect(before[0]).toEqual({ role: "user", content: "hi" });
          });
          it("delegates the text to renderHighWaterNudge (content matches)", () => {
            const out = injectHighWaterNudge([], 140000, 200000);
            expect(out[0].content).toBe(renderHighWaterNudge(140000, 200000));
          });
  - GOTCHA: the existing shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS describes + the metric()/
    rewind()/shrink() helpers are UNCHANGED. (If the parallel P3.M3.T4.S1 has rewritten the shouldNudge describe in
    this same file, keep the high-water describes in a SEPARATE region — they do not overlap.)

Task 7 (OPTIONAL — none): no docs/README/spec change. The high-water signal is already specified in spec/07 §5.2
  (the source of this delta). README feature-blurb sync is the separate P3.M4.T1.S3 task. contextHandler wiring is
  P3.M3.T6.S1.
```

### Implementation Patterns & Key Details

```typescript
// ── shouldHighWater (src/nudges.ts) — signature + body (verbatim from Pattern 9 + the contract). ──

export function shouldHighWater(
  totalFilteredTokens: number,
  windowTokens: number,
  rt: SessionRuntime,
  config: MulliganConfig,
): boolean {
  if (windowTokens <= 0) return false; // fail-open (E12); do NOT touch rt.aboveHighWater
  const fraction = totalFilteredTokens / windowTokens;
  if (fraction >= config.nudges.highWaterFraction) {
    if (!rt.aboveHighWater) {
      rt.aboveHighWater = true; // latch: first upward crossing fires
      return true;
    }
    return false; // already above → edge-triggered, do NOT re-fire
  }
  rt.aboveHighWater = false; // dropped below → clear the latch (re-arm for next crossing)
  return false;
}

// ── shouldHighWater JSDoc (src/nudges.ts) — write this in full. ──
/**
 * shouldHighWater — §5.2 edge-triggered high-water gate (spec/07-preventive-and-nudges.md §5.2, REQUIRED). Returns
 * true iff the TOTAL filtered context just crossed above `config.nudges.highWaterFraction` of the window, EDGE-
 * TRIGGERED (fires once on the upward crossing, not every turn while above).
 *
 * STATUS — PURE EXCEPT it MUTATES `rt.aboveHighWater` (the edge-trigger latch that lives in the session runtime).
 * This is intentional (spec/07 §5.2: "tracked via rt.aboveHighWater — set true when the annotation fires, cleared
 * only when the total drops back below the fraction"). The other two high-water helpers (renderHighWaterNudge,
 * injectHighWaterNudge) ARE purely functional; only this gate carries the latch.
 *
 * ALGORITHM (architecture implementation_patterns.md Pattern 9):
 *   1. windowTokens <= 0 → return false (fail-open — E12: ctx.getContextUsage() undefined / no model / pre-first-
 *      inference → contextWindow 0). Do NOT mutate rt.aboveHighWater on this path (failing open must not clobber a
 *      real "above" state nor falsely arm a re-fire).
 *   2. fraction = totalFilteredTokens / windowTokens.
 *   3. fraction >= highWaterFraction → if the latch was false, set it true and return true (first upward crossing
 *      fires); else return false (already above → edge-triggered, no re-fire).
 *   4. fraction < highWaterFraction → set the latch false (cleared on dropping below, re-arming for the next
 *      crossing) and return false.
 *
 * The `>=` (not `>`) means a total at EXACTLY the fraction (e.g. 140000/200000 = 0.7) fires.
 *
 * INPUTS (computed by the CALLER — contextHandler, P3.M3.T6.S1):
 *   - totalFilteredTokens = estimateTokens(filteredMessages).tokens — the FILTERED view (D5: NEVER
 *     ctx.getContextUsage().tokens, which counts hidden/rewound tokens). This is the same filtered total
 *     mulligan_audit reports.
 *   - windowTokens = ctx.getContextUsage()?.contextWindow ?? 0 — the model's context window size.
 * This function does NOT tokenize, does NOT call getContextUsage, does NOT call getRuntime — all inputs are passed
 * in, keeping it a cheap, deterministic, unit-testable gate.
 *
 * @param totalFilteredTokens the filtered-view token total (estimateTokens(messages).tokens).
 * @param windowTokens        the model's context window size (getContextUsage()?.contextWindow).
 * @param rt                  the live per-session runtime (aboveHighWater is mutated in place as the latch).
 * @param config              the MulliganConfig (reads nudges.highWaterFraction).
 * @returns true iff the total just crossed above the fraction this turn (the annotation should fire once).
 */

// ── renderHighWaterNudge (src/nudges.ts) — signature + body. ──

export function renderHighWaterNudge(totalFilteredTokens: number, windowTokens: number): string {
  if (!(windowTokens > 0)) {
    // Defensive: can't compute a percentage. shouldHighWater short-circuits this in prod, but this renderer is
    // exported + directly callable — never let NaN/Infinity% leak. Fail to a percentage-free line (mirrors
    // renderDriftNudge/renderBloatReminder's never-throws discipline — spec/07 §2/§1, E13).
    return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";
  }
  const pct = Math.round((totalFilteredTokens / windowTokens) * 100);
  return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;
}
// JSDoc: cite §5.2; note the ONE-line format pinned by the item contract; the renderDriftNudge STYLE mirrored
// (leading "[mulligan] ", never-throws, ~25-40 tokens, NO trailing newline); Math.round percentage; the
// windowTokens<=0 defensive fallback. PURE.

// ── injectHighWaterNudge (src/nudges.ts) — signature + body (mirrors injectNudge). ──

export function injectHighWaterNudge(
  messages: MessageLike[],
  totalFilteredTokens: number,
  windowTokens: number,
): MessageLike[] {
  const line = renderHighWaterNudge(totalFilteredTokens, windowTokens);
  const nudge: MessageLike = {
    role: "custom",
    customType: "mulligan:high-water",
    content: line,
    display: false,
    details: { ephemeral: true, totalFilteredTokens, windowTokens },
    timestamp: Date.now(),
  };
  return [...messages, nudge];
}
// JSDoc: cite §5.2; note it rides the context inference (D4 zero extra requests) + is NEVER persisted (the nudge
// lives ONLY in the returned copy — zero accumulation; each context fire gets a fresh deep copy from Pi so the
// annotation is recomputed/replaced, never stacked). PURE (new array; input untouched). The MessageLike index
// signature lets the literal assign with NO cast (same as injectNudge). customType "mulligan:high-water" is
// DISTINCT from "mulligan:nudge" so the two annotation kinds are individually detectable. Called by contextHandler
// (P3.M3.T6.S1) only when shouldHighWater returned true.

// ── the ONE new import (src/nudges.ts) ──
//   add: import type { SessionRuntime } from "./runtime.js";   (separate line, after `import { getRuntime } ...`)

// ── WHY `>=` not `>`: the contract + Pattern 9 both use `fraction >= highWaterFraction`. At exactly 0.7, fire.
// ── WHY no rt mutation on fail-open: failing open = "no signal"; clobbering the latch would be wrong either way.
// ── WHY Math.round for the %: the contract example "~70%" for 0.7 (Math.round(0.7*100)=70). round, not floor/trunc.
// ── WHY a defensive fallback in the renderer: it is exported + directly testable; must be TOTAL (never throw).
// ── WHY customType "mulligan:high-water" not "mulligan:nudge": separable annotation kinds for audit/dedup.
// ── WHY injectHighWaterNudge is PURE (new array): mirrors injectNudge; the model sees the annotation THIS inference
//   and Pi persists the ORIGINAL branch untouched — zero persistence, zero accumulation.
```

### Integration Points

```yaml
FUNCTIONS (src/nudges.ts — all NEW exports):
  - shouldHighWater(totalFilteredTokens, windowTokens, rt: SessionRuntime, config: MulliganConfig): boolean
      # PURE except mutates rt.aboveHighWater (edge-trigger latch). windowTokens<=0 → false (no rt touch).
  - renderHighWaterNudge(totalFilteredTokens, windowTokens): string
      # PURE, never throws. "[mulligan] Context is at ~<pct>% of the window. Consider mulligan_shrink or
      #  mulligan_rewind to reclaim space." windowTokens<=0 → percentage-free fallback.
  - injectHighWaterNudge(messages: MessageLike[], totalFilteredTokens, windowTokens): MessageLike[]
      # PURE (new array; input untouched). Appends {role:"custom", customType:"mulligan:high-water", content,
      # display:false, details:{ephemeral,totalFilteredTokens,windowTokens}, timestamp}.

IMPORT (src/nudges.ts — the ONE new import):
  - add: import type { SessionRuntime } from "./runtime.js";
  - (estimateTokens, renderDriftNudge, MessageLike, MulliganConfig, TurnMetric already imported — NO other change)

NO config.ts CHANGE (highWaterFraction=0.7 ALREADY exists from COMPLETE P3.M3.T1.S1).
NO runtime.ts CHANGE (SessionRuntime.aboveHighWater ALREADY exists from COMPLETE P3.M3.T2.S1).
NO markers.ts / transforms.ts / tokens.ts / notes.ts CHANGE.
NO filter.ts CHANGE in this task (contextHandler wiring — computing totalFilteredTokens from the FILTERED view +
  windowTokens from ctx.getContextUsage()?.contextWindow ?? 0, then calling shouldHighWater + injectHighWaterNudge
  — is P3.M3.T6.S1).
NO index.ts CHANGE (no new event handler/tool registration — these are pure helpers consumed by contextHandler).
TESTS (test/drift_nudge.test.ts):
  - ADD shouldHighWater, renderHighWaterNudge, injectHighWaterNudge to the nudges.js import.
  - ADD import type { SessionRuntime } from "../src/runtime.js"; + import type { MulliganConfig } from "../src/config.js";
  - ADD rt() + hcfg() helpers + new describes: edge-trigger lifecycle (cross/latch/no-refire/clear/re-cross/shared-rt
    sequence), fail-open at windowTokens<=0 (no rt mutation), >= boundary, custom fraction, renderer non-empty +
    rounded % + windowTokens<=0 fallback, injector new-array + customType + purity + delegates-to-renderer.
  - existing shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS describes + metric()/rewind()/shrink() UNCHANGED.
DOCS: none — the high-water signal is already specified in spec/07 §5.2 (the source). README feature-blurb sync is
  the separate P3.M4.T1.S3 task.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project (strict:true; no separate build/lint script).
npx tsc --noEmit
# Expected: ZERO errors. If tsc errors:
#   - "Cannot find name 'SessionRuntime'" in src/nudges.ts → you forgot Task 1 (add `import type { SessionRuntime }
#     from "./runtime.js";`).
#   - "Property 'aboveHighWater' does not exist on type 'SessionRuntime'" → P3.M3.T2.S1 has not landed (the runtime
#     field is missing); coordinate (the plan_status marks T2.S1 COMPLETE — it should be present).
#   - "Property 'highWaterFraction' does not exist on type 'MulliganConfig'" → P3.M3.T1.S1 has not landed; coordinate.
#   - "Argument of type 'X' is not assignable to parameter of type 'SessionRuntime'" in a test → the rt() helper
#     literal is missing a required SessionRuntime field (re-check the helper builds ALL fields: sessionId, seq,
#     tokenBaseline, lastTurnIndex, lastFiltered, lastFilterTs, pendingBloatHits, shrinkMissCounts, aboveHighWater).
# (No linter/formatter is configured — package.json has only "test" and "smoke" scripts. Do NOT invent one.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the affected test file in isolation first (fast feedback) — the new high-water helper tests.
npx vitest run test/drift_nudge.test.ts
# Expected: ALL pass (new describes + the UNCHANGED shouldNudge/injectNudge/suppressCheck/NUDGE_TURN_WINDOW_MS ones).
# Watch especially:
#   - "fires on the first upward crossing and latches aboveHighWater true" → true + rt.aboveHighWater===true.
#     If false, the `>=` is `<` or the latch set is on the wrong branch.
#   - "does NOT re-fire while already above" → false + rt.aboveHighWater stays true. If true, you removed the latch
#     check (rt.aboveHighWater) on the fraction>= branch.
#   - "clears the latch when the total drops back below" → false + rt.aboveHighWater===false. If it stays true, the
#     else branch doesn't set rt.aboveHighWater=false.
#   - "fires again after dropping below and re-crossing" → true. If false, the latch wasn't cleared on drop-below.
#   - "full lifecycle on one rt" → the 4-step sequence; the strongest single test of edge-trigger correctness.
#   - "windowTokens <= 0 … WITHOUT mutating aboveHighWater" → false + rt.aboveHighWater UNCHANGED. If it changed,
#     the fail-open path touches the latch (move `if (windowTokens <= 0) return false;` to the very top, before any
#     rt access).
#   - "fires at exactly the fraction (>= comparison)" → true at 0.7===0.7.
#   - "honors a custom fraction (0.9)" → false at 0.7<0.9.
#   - "renderHighWaterNudge … ~70%" → contains "~70%". If "~70.0000001%" or "NaN%", the % computation is wrong.
#   - "renderHighWaterNudge … windowTokens <= 0 fallback" → non-empty, no "%", recommends the tools, doesn't throw.
#   - "injectHighWaterNudge … NEW array … custom message appended" → length 2, customType "mulligan:high-water".
#   - "injectHighWaterNudge … does NOT mutate the input" → before.length stays 1.

# Full suite — proves no regression.
npm test
# Expected: ALL green. The new describes are the only delta; nudges.test.ts (Nudge A), turn_metric.test.ts,
# markers.test.ts, tools/*, config.test.ts, runtime.test.ts are untouched (they don't reference the new helpers).
# filter.test.ts is NOT modified in this task (no contextHandler call-site change) → its drift-nudge tests are
# unaffected (shouldHighWater is not called from contextHandler yet — that's P3.M3.T6.S1).
```

### Level 3: Integration Testing (System Validation)

```bash
# This task adds PURE helpers + tests; there is NO new I/O, NO new Pi surface, NO call-site change. The integration
# smoke harness (test/integration/smoke.ts) does NOT exercise these helpers yet (contextHandler wiring is
# P3.M3.T6.S1), so it is unaffected:
npm run smoke   # optional — passes unchanged (the helpers are exported but not yet called by the filter).
# Expected: no change in harness shape or results. Skip unless validating the broader build.

# Manual spot-check (no real model needed) — the helpers are fully exercised by Level 2. If you want a one-liner
# proving the lifecycle + renderer end-to-end:
node --input-type=module -e "
import { shouldHighWater, renderHighWaterNudge, injectHighWaterNudge } from './src/nudges.js';
const rt = { sessionId:'s1', seq:0, tokenBaseline:null, lastTurnIndex:null, lastFiltered:null, lastFilterTs:null,
  pendingBloatHits:[], shrinkMissCounts:new Map(), aboveHighWater:false };
const cfg = { nudges:{ highWaterFraction:0.7 } };
console.log('cross',   shouldHighWater(140000,200000,rt,cfg), rt.aboveHighWater); // true  true
console.log('refire?', shouldHighWater(140000,200000,rt,cfg), rt.aboveHighWater); // false true
console.log('below',   shouldHighWater(100000,200000,rt,cfg), rt.aboveHighWater); // false false
console.log('recross', shouldHighWater(140000,200000,rt,cfg), rt.aboveHighWater); // true  true
console.log('win0',    shouldHighWater(140000,0,rt,cfg),       rt.aboveHighWater); // false true (unchanged)
console.log('render',  JSON.stringify(renderHighWaterNudge(140000,200000)));
console.log('inject',  injectHighWaterNudge([],140000,200000).length, injectHighWaterNudge([],140000,200000)[0].customType);
"
# Expected:
#   cross true true
#   refire? false true
#   below false false
#   recross true true
#   win0 false true
#   render "[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space."
#   inject 1 mulligan:high-water
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Behavioral proof = the Level 2 unit tests (the real gate for the edge-trigger algorithm):
#   - first upward crossing fires + latches (rt.aboveHighWater → true)             (edge trigger ✓)
#   - already above → no re-fire (stays true)                                       (no nagging ✓)
#   - drops below → clears the latch (→ false)                                       (re-arm ✓)
#   - re-crosses → fires again                                                       (re-armed ✓)
#   - full lifecycle on ONE rt (the 4-step sequence)                                 (stateful correctness ✓)
#   - windowTokens <= 0 → false WITHOUT touching the latch                           (fail-open E12 ✓)
#   - exactly the fraction (0.7 === 0.7) fires                                       (>= semantics ✓)
#   - custom fraction honored (0.9 suppresses 0.7)                                   (config knob ✓)
#   - renderer non-empty + rounded % + windowTokens<=0 fallback + never throws       (defensive ✓)
#   - injector new array + customType "mulligan:high-water" + input untouched         (pure injection ✓)
# spec/07 §5.2 reconciliation: "inject a one-line annotation the first time the total filtered context crosses
#   highWaterFraction (default 0.7) … edge-triggered — fire once on crossing, not every turn while above — tracked
#   via rt.aboveHigh." Every clause is exercised: one-line (renderHighWaterNudge), first-time-crossing (the latch),
#   total FILTERED (the caller's estimateTokens(messages).tokens — D5, documented in the JSDoc), default 0.7 (hcfg
#   default), edge-triggered (the lifecycle tests), rt.aboveHighWater (the mutated field, asserted each step).
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` — zero errors (new exports + SessionRuntime type import + test imports type-clean).
- [ ] `npx vitest run test/drift_nudge.test.ts` — all pass (new high-water describes + unchanged existing describes).
- [ ] `npm test` — full suite green (no regression; config/runtime/markers/tools/turn_metric/nudges/edge-cases untouched).

### Feature Validation
- [ ] `shouldHighWater` fires on first upward crossing (140000/200000/0.7 → true, latches rt.aboveHighWater true).
- [ ] `shouldHighWater` does NOT re-fire while already above (second call → false, stays true).
- [ ] `shouldHighWater` clears the latch when the total drops below (100000/200000/0.7 → false, → false).
- [ ] `shouldHighWater` re-fires after dropping below + re-crossing (140000 again → true).
- [ ] `shouldHighWater(…, windowTokens<=0, …)` → false WITHOUT mutating rt.aboveHighWater (fail-open, E12).
- [ ] `shouldHighWater` fires at exactly the fraction (`>=`, not `>`); honors a custom fraction.
- [ ] `renderHighWaterNudge` returns a non-empty string with the rounded percentage (~70% for 0.7); never throws.
- [ ] `renderHighWaterNudge(…, windowTokens<=0)` returns a percentage-free fallback (no NaN/Infinity%).
- [ ] `injectHighWaterNudge` returns a NEW array (length +1) with a `mulligan:high-water` custom message; input untouched.
- [ ] All three functions are EXPORTED from `src/nudges.ts`; `SessionRuntime` type imported.

### Code Quality Validation
- [ ] Follows existing `nudges.ts` patterns: JSDoc-heavy exports, spec citations (§5.2), defensive discipline, `.js` import specifiers.
- [ ] `shouldHighWater` mutates only `rt.aboveHighWater` (documented intentional impurity); `renderHighWaterNudge` + `injectHighWaterNudge` are PURE.
- [ ] `customType "mulligan:high-water"` is DISTINCT from `"mulligan:nudge"` (separable annotation kinds).
- [ ] Existing functions (`shouldNudge`, `injectNudge`, `suppressCheck`, Nudge A handlers, `turnEndMetricHandler`, registrars, `NUDGE_TURN_WINDOW_MS`) UNCHANGED.
- [ ] No call-site change to `src/filter.ts` (contextHandler wiring is P3.M3.T6.S1).
- [ ] No config/runtime/marker/transform/token/note change (knobs + state already exist).

### Documentation & Deployment
- [ ] Each new export has a full JSDoc (spec citation §5.2 + algorithm + defensive notes + the PURE-but-mutates-rt status for shouldHighWater).
- [ ] No new environment variables; no new config knobs (highWaterFraction already exists).
- [ ] D5 documented in `shouldHighWater` JSDoc (the caller computes totalFilteredTokens from the FILTERED view, never `getContextUsage().tokens`).

---

## Anti-Patterns to Avoid

- ❌ Don't call `getRuntime()` inside `shouldHighWater` — it receives `rt` as a parameter (keeps it unit-testable; no sessionId needed).
- ❌ Don't mutate `rt.aboveHighWater` on the `windowTokens <= 0` fail-open path (failing open must not clobber the latch).
- ❌ Don't weaken the fraction comparison to `>` (the contract + Pattern 9 use `>=`; exactly-the-fraction fires).
- ❌ Don't reuse `customType "mulligan:nudge"` for the high-water annotation (use `"mulligan:high-water"` — separable kinds).
- ❌ Don't mutate the input array in `injectHighWaterNudge` (return `[...messages, nudge]` — mirror `injectNudge`).
- ❌ Don't let `renderHighWaterNudge` throw or emit `NaN%`/`Infinity%` (it's exported + directly testable; guard `windowTokens <= 0`).
- ❌ Don't modify `src/filter.ts` / the contextHandler call site in this task (that wiring is P3.M3.T6.S1).
- ❌ Don't inline `import { getRuntime, type SessionRuntime }` — follow the codebase's separate-`import type`-line convention.
- ❌ Don't skip the full edge-trigger lifecycle test on ONE shared `rt` (fresh-rt-per-scenario tests do NOT exercise the latch).
- ❌ Don't catch all exceptions / add try-catch in these helpers — they are pure arithmetic/composition with no I/O; the defensive guards (`windowTokens > 0`) are sufficient (match `renderDriftNudge`/`estimateTokens`, which never throw by construction, not by catch).