# PRP — P1.M2.T1.S2: Add high-water observables (edge latch + filtered-total/window fraction) to the context.fire log line (smoke.ts)

## Goal

**Feature Goal**: Extend the `context.fire` JSONL observable in `test/integration/smoke.ts` with a `highWater: { latch: boolean, fraction: number | null }` object — `latch` read from the SHARED session runtime's `aboveHighWater` edge latch after src's handlers ran, `fraction` = `estimateTokens(event.messages) / contextWindow` when `contextWindow > 0` else `null` — so the F-drift-userexempt scenario (P1.M2.T5.S1) can PROVE "the high-water signal fires". Document the fields in `test/integration/scenarios.md`.

**Deliverable**: Edited `test/integration/smoke.ts` (context handler detail object + two imports + a comment) and edited `test/integration/scenarios.md` (context.fire field reference). No product code changes; `npx tsc --noEmit` clean; `npm test` green.

**Success Definition**: every `context.fire` line carries `highWater: {latch, fraction}`; the handler remains a pure observer (returns void, never mutates `event.messages` or runtime state); a session above the high-water fraction shows `latch:true` once the nudges handler has fired across the threshold.

## Why

BUG-003 / spec @10 §2.1 F-drift-userexempt pass criteria: "a 50k user paste does not fire the drift nudge while high-water does." The harness currently logs only `hasNudge` — which the drift nudge (agent-attributable delta) and the high-water annotation (§5.2 edge-triggered, total-context awareness) BOTH set, and whose absence cannot distinguish "high-water didn't fire" from "it fired earlier and the custom message isn't in this fire's view". The `aboveHighWater` latch (src/nudges.ts:497 `shouldHighWater`, mutated in place on the live `SessionRuntime`) is the durable edge signal; and because the smoke extension imports from `../../src/runtime.js` in the SAME pi process/module instance as src (see `plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/architecture/external_deps.md`), reading it post-handler is exact — no reimplementation, no drift.

## What

In the `context` handler's `smokeLog("context.fire", ...)` detail object, add:

```ts
highWater: { latch: boolean, fraction: number | null }
// latch    = getRuntime(ctx.sessionManager.getSessionId()).aboveHighWater  — read AFTER src's handlers ran
//            (smoke loads second → post-update state; §5.2 edge latch: true after the first upward
//            crossing of nudges.highWaterFraction (default 0.7), cleared on dropping below)
// fraction = estimateTokens(event.messages).tokens / contextWindow when contextWindow > 0, else null
//            (E12 tolerance: ctx.getContextUsage() may be undefined and contextWindow 0/undefined
//            pre-first-inference — never divide by zero)
```

Pure observer: no mutation of `event.messages`, no runtime state writes (do NOT call `shouldHighWater` — it mutates the latch; read the field only).

### Success Criteria

- [ ] Every `context.fire` line includes `highWater: {latch, fraction}` (fraction `null` when `contextWindow` missing/0).
- [ ] `getRuntime` imported from `../../src/runtime.js`; `estimateTokens` from `../../src/tokens.js` (in the existing src-imports block, ~lines 38-42).
- [ ] Handler still returns void; no `shouldHighWater` call (mutates the latch); no mutation of `event.messages`.
- [ ] `scenarios.md` context.fire field reference shows the new fields with `//`-comments in house style.
- [ ] `npx tsc --noEmit` clean; `npm test` green (no new unit tests — observer glue).

## All Needed Context

### Documentation & References

```yaml
- file: test/integration/smoke.ts
  why: THE EDIT TARGET. Context handler ~:458-519; the smokeLog("context.fire","info",{...}) detail object at ~:480 (fields count/msgCanaryPresent/resultCanaryPresent/notePresent/hasRewindMarker/shrunkInContext/hasNudge/seedAnchorInAssistant/seedHiddenInAssistant); src-imports block at :38-42
  pattern: every computation inside the handler's existing single try/catch; msgs is Array<Record<string,unknown>> (cast event.messages once at the top); returns void (GOTCHA #1 — pass-through of the POST-filter set; smoke loads SECOND)
  gotcha: P1.M2.T1.S1 (parallel, same file) appends banner/userMsgCount/firstUserPresent to the SAME detail object — rebase onto it; your keys live under `highWater` so no collision

- file: src/runtime.ts
  why: getRuntime(sessionId): SessionRuntime (:139) — module-scoped Map, never throws, fresh-on-first-access. SessionRuntime.aboveHighWater is the §5.2 edge latch (mutable field). Both extensions share ONE pi process + module instance → this import reads the SAME runtime the nudges handler mutated (external_deps.md)
  pattern: const rt = getRuntime(ctx.sessionManager.getSessionId()); — read getSessionId FRESH in-handler (C12 stale-reference rule; nudges.ts:194 precedent)
  gotcha: getRuntime never throws but getSessionId CAN — keep the read inside the handler's try/catch

- file: src/nudges.ts
  why: shouldHighWater (:497-513) — the ONLY writer of rt.aboveHighWater: first upward crossing of (totalFilteredTokens/windowTokens) >= nudges.highWaterFraction (default 0.7) sets true; below-threshold clears; windowTokens<=0 returns false WITHOUT touching the latch (E12 fail-open). renderHighWaterNudge text is awareness-only (spec/07 §5.2, D10)
  critical: do NOT call shouldHighWater from smoke.ts — it mutates the latch; the observer only READS rt.aboveHighWater

- file: src/tokens.ts
  why: estimateTokens(messages: MessageLike[]|null|undefined): {tokens, confidence} (:114) — chars/4 ceil, never throws, non-negative. Same function src uses → same numbers the latch decisions used (modulo the nudge's filtered-view vs event.messages — both are the post-filter set on the observing fire)

- file: test/integration/scenarios.md
  why: "A `context.fire` line" JSON block ~:56-67 — append the highWater fields with // comments matching existing style
  gotcha: P1.M2.T1.S1 also appends its fields to this block in parallel; both are additive

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T1S1/PRP.md
  why: the parallel sibling's contract (banner/userMsgCount/firstUserPresent observables + scenarios.md edit) — consume, don't duplicate; your fields are disjoint (`highWater.*`)

- file: src/config.ts
  why: nudges.highWaterFraction default 0.7 (:170, :113) — the threshold fraction is compared against; cite in the smoke.ts comment
```

### Current Codebase tree (relevant)

```bash
test/integration/smoke.ts       # EDIT — context.fire observable + imports + comment
test/integration/scenarios.md   # EDIT — context.fire field reference (Mode A docs ride with the work)
src/runtime.ts                  # READ — getRuntime / SessionRuntime.aboveHighWater (FROZEN)
src/nudges.ts                   # READ — shouldHighWater semantics (:497), highWaterFraction default 0.7
src/tokens.ts                   # READ — estimateTokens (:114)
test/integration/run-smoke.mjs  # READ ONLY — the asserter of P1.M2.T5.S1 will read detail.highWater; do NOT edit here
```

### Known Gotchas

```ts
// CRITICAL: never call shouldHighWater from smoke.ts — it MUTATES rt.aboveHighWater (the observer
//   must be side-effect-free; a mutation here would re-arm/clear the real latch under test).
// CRITICAL: read getSessionId() FRESH inside the handler (C12 — captured references go stale after rebinds).
// CRITICAL: fraction MUST be null (never NaN/Infinity) when ctx.getContextUsage() is undefined or
//   contextWindow <= 0 (E12 pre-first-inference tolerance — the harness already tolerates this class).
// GOTCHA: event.messages on the observing fire is the POST-filter set (smoke loads second) — the
//   fraction is the FILTERED total, matching what shouldHighWater measured (spec/07 §5.2).
// GOTCHA: the latch is EDGE-triggered: after the first crossing it stays true while above threshold
//   (the custom message may not be present this fire even though latch===true — that's the point of
//   logging the latch rather than only hasNudge).
// GOTCHA: .js import extensions for src imports (ESM convention used at :38-42).
```

## Implementation Blueprint

### Task 1: EDIT `test/integration/smoke.ts` — imports

Add to the src-imports block (after line 42, alongside the existing `../../src/*.js` imports):

```ts
import { getRuntime } from "../../src/runtime.js"; // SHARED module instance — same SessionRuntime src mutated
import { estimateTokens } from "../../src/tokens.js"; // same estimator src uses (chars/4)
```

### Task 2: EDIT the context handler — compute + log `highWater`

Inside the existing `pi.on("context", (event, ctx) => {...})` try block, before `smokeLog("context.fire", ...)`:

```ts
// ── High-water observables (§5.2 edge latch + filtered-total/window fraction; P1.M2.T1.S2). PURE READ:
//    we never call shouldHighWater (it mutates rt.aboveHighWater). Both extensions share ONE pi process
//    and module instance, so getRuntime(...) returns the SAME SessionRuntime src's nudges handler just
//    updated (observer loads second → post-update state). fraction is the FILTERED total over the window
//    (event.messages is the post-filter set); null when the window is unknown (E12 — pre-first-inference
//    getContextUsage may be undefined / contextWindow 0 — never divide by zero).
let hwLatch = false;
let hwFraction: number | null = null;
try {
  hwLatch = getRuntime(ctx.sessionManager.getSessionId()).aboveHighWater === true;
  const windowTokens = ctx.getContextUsage()?.contextWindow ?? 0;
  if (typeof windowTokens === "number" && windowTokens > 0) {
    hwFraction = estimateTokens(msgs as never).tokens / windowTokens;
  }
} catch {
  // E13-style tolerance: an observable computation must never break the observer.
}
```

Then add to the `smokeLog("context.fire", "info", { ... })` detail object (after `hasNudge` / alongside S1's fields):

```ts
highWater: { latch: hwLatch, fraction: hwFraction },
```

(`estimateTokens` takes `MessageLike[]`; `msgs` is `Array<Record<string,unknown>>` — reuse the file's established cast idiom, e.g. `msgs as never` or the same `as unknown as` chain used at the top of the handler for event.messages.)

### Task 3: EDIT `test/integration/scenarios.md` — document the fields

Append to the "A `context.fire` line" JSON block (with S1's fields present):

```json
"highWater": { "latch": false, "fraction": 0.42 }  // §5.2 edge latch (aboveHighWater, post-handler read) and filtered-tokens/contextWindow; fraction null when the window is unknown (E12)
```

## Validation Loop

### Level 1: Types

```bash
npx tsc --noEmit        # zero errors
```

### Level 2: Unit suite

```bash
npm test                # all green — smoke.ts is not unit-imported, but the gate must stay green
```

### Level 3: Smoke spot-check (optional here; full drive is P1.M2.T5.S1)

```bash
npm run smoke           # existing 14 scenarios still pass; grep a context.fire line for highWater presence
```

(Do not register or assert F-drift-userexempt — that is P1.M2.T5.S1.)

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean; `npm test` green.
- [ ] Every `context.fire` line in a smoke run contains `highWater: {latch, fraction}`.
- [ ] No call to `shouldHighWater` in smoke.ts; no writes to runtime state; handler returns void.
- [ ] Fraction is `null` (not NaN/Infinity/0-division) when `contextWindow` is 0/undefined.
- [ ] scenarios.md field reference updated (with S1's fields intact).
- [ ] No edits to run-smoke.mjs, src/*, or the scenario registry.

## Anti-Patterns to Avoid

- ❌ Don't call `shouldHighWater` to "compute" the latch — read `rt.aboveHighWater` only (side-effect-free observer).
- ❌ Don't re-implement the threshold comparison or guess the config value — the latch IS the spec's signal.
- ❌ Don't register/assert F-drift-userexempt here (P1.M2.T5.S1) or duplicate S1's banner/visibility fields.
- ❌ Don't let an observable computation throw — wrap in try/catch inside the handler (E13 discipline).