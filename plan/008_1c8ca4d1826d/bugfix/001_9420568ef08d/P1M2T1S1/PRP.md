# PRP — P1.M2.T1.S1: Add banner-state + user-message-visibility observables to the context.fire log line (smoke.ts)

## Goal

**Feature Goal**: Extend the `context.fire` JSONL observable in `test/integration/smoke.ts` with three new fields — `banner` (recomputed via `listCheckpoints`), `userMsgCount`, and `firstUserPresent` — so the upcoming F-banner (P1.M2.T2.S2) and F-consent (P1.M2.T3.S1) scenarios have assertion data. Document the new fields in `test/integration/scenarios.md` (~line 56 field reference).

**Deliverable**: Edited `test/integration/smoke.ts` (context handler observable object + one import + a comment) and edited `test/integration/scenarios.md` ("A `context.fire` line" block). No product code changes, no new tests; `npx tsc --noEmit` stays clean and `npm test` stays green.

**Success Definition**: Every `context.fire` line carries `banner: {activeCount, names}`, `userMsgCount`, `firstUserPresent`; the handler still returns void and never mutates `event.messages`; typecheck + unit suite green.

## Why

BUG-003: the five v1.1 integration scenarios are missing from the smoke suite. Before F-banner and F-consent can be driven and asserted (later subtasks), the observer harness must LOG the state they assert against: whether the checkpoint banner would be showing (recomputed — headless `pi -p` has `ctx.hasUI=false` so `reconcileBanner` no-ops and `setWidget` cannot be observed) and whether user messages are visible in the filtered view (the F-consent pass criteria hinge on "first:user never hidden" / "subsequent user prompts hidden").

## What

In the `context` handler's `smokeLog("context.fire", ...)` detail object, add:

```ts
banner: { activeCount: number, names: string[] },  // recomputed each fire via listCheckpoints(entries)
userMsgCount: number,                              // msgs.filter(m => m?.role === "user").length
firstUserPresent: boolean,                         // the FIRST message with role==="user" is present in msgs
```

Plus a comment in smoke.ts explaining that `banner` mirrors what `reconcileBanner` WOULD render (it no-ops headless: `src/banner.ts` branch (a), `ctx.hasUI === false`), recomputed via the same pure latest-wins scanner `listCheckpoints` that `reconcileBanner` imports.

### Success Criteria

- [ ] Every `context.fire` line includes the three new fields
- [ ] `listCheckpoints` imported from `../../src/tools/audit.js` in smoke.ts's existing src-imports block (lines 38-42)
- [ ] Context handler still returns void, never mutates `event.messages` (pure observer)
- [ ] scenarios.md `context.fire` field reference shows the new fields with short comments matching house style
- [ ] `npx tsc --noEmit` clean; `npm test` green (no new unit tests — observer glue)

## All Needed Context

### Documentation & References

```yaml
- file: test/integration/smoke.ts
  why: THE EDIT TARGET. Context handler at ~lines 458-519: builds msgs/entries, computes hasRewindMarker/seed flags, then smokeLog("context.fire", ...) with detail {count, msgCanaryPresent, resultCanaryPresent, notePresent, hasRewindMarker, shrunkInContext, hasNudge, seedAnchorInAssistant, seedHiddenInAssistant}
  pattern: every computation inside the existing try/catch; msgs is Array<Record<string,unknown>>; entries already fetched via ctx.sessionManager.getEntries() with its own try/catch fallback []
  gotcha: handler MUST return void (GOTCHA #1) — pass-through of Mulligan's post-filter set; smoke loads SECOND so event.messages is POST-filter state

- file: src/tools/audit.ts
  why: `listCheckpoints(entries: unknown[]): string[]` at line ~356 — the pure latest-wins scanner over `mulligan:checkpoint:` LabelEntries; the SAME function reconcileBanner uses (imported by src/banner.ts)
  pattern: call as `listCheckpoints(entries)` on the entries array already in scope

- file: src/banner.ts
  why: reconcileBanner's branch (a) no-ops when ctx.hasUI is false — the reason banner state must be RECOMPUTED, not observed; cite this in the smoke.ts comment

- file: test/integration/scenarios.md
  why: "A `context.fire` line" section at ~lines 56-67 — append the three new fields with `//`-comments in the JSON example, matching the existing style (camelCase key + short trailing comment)

- file: test/integration/run-smoke.mjs
  why: the orchestrator that reads the JSONL — DO NOT EDIT here (scenario registration is P1.M2.T2/T3/T5); just be aware asserters read detail.* fields

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M1T2S2/PRP.md
  why: the parallel-implementation sibling (E22 advisory in src/tools/rewind.ts) — does NOT touch smoke.ts or the context.fire line; no conflict. Your fields must not collide with its observables (they don't: it works on rewind success text)
```

### Current Codebase tree (relevant slice)

```bash
test/integration/smoke.ts       # EDIT — context handler observable object + import
test/integration/scenarios.md   # EDIT — field reference docs
src/tools/audit.ts              # READ — listCheckpoints (import source)
src/banner.ts                   # READ — reconcileBanner headless no-op (comment justification)
```

### Known Gotchas

- **Headless no-UI**: `pi -p` ⇒ `ctx.hasUI === false` ⇒ `reconcileBanner` returns early (branch (a)) and `setWidget` never fires. The banner observable is therefore a RECOMPUTATION (`listCheckpoints`), never a widget observation. Say so in the code comment.
- **Second-loaded observer**: smoke.ts is the second `-e`; Mulligan's handlers ran first, so `event.messages` is the POST-filter view — exactly what the visibility fields must measure. Do not mutate it (GOTCHA #1).
- **Module-cache separation**: smoke.ts cannot enable Mulligan's own log (noted in-file); irrelevant here — listCheckpoints is imported for its pure function, not for shared state. It runs on the smoke extension's OWN copy of the pure function, which is fine (pure scan, no state).
- **entries already fetched**: reuse the in-scope `entries` array; don't call `getEntries()` twice.
- **JSONL size**: fields are tiny (numbers + short name array); no truncation concerns.

## Implementation Blueprint

### The extended context.fire detail object

```ts
// In the existing context handler, after hasRewindMarker/seed computations (inside the same try):
// ── Banner + user-visibility observables (P1.M2.T1.S1). Headless pi -p has ctx.hasUI=false, so
//    reconcileBanner no-ops (src/banner.ts branch (a)) and setWidget cannot be observed — banner state
//    is RECOMPUTED here via listCheckpoints, the same pure latest-wins label scanner reconcileBanner
//    itself uses. This mirrors what the banner WOULD render; the post-filter msgs give user visibility.
const checkpointNames = listCheckpoints(entries);
const userMsgs = msgs.filter((m) => m?.role === "user");
const firstUserIdx = msgs.findIndex((m) => m?.role === "user");
const firstUserPresent = firstUserIdx !== -1 && /* same index survives in post-filter set */ msgs[firstUserIdx] !== undefined;

// firstUserPresent simplified: presence of ANY message with role==="user" is not enough (F-consent needs
// "the FIRST user message specifically"). The post-filter array preserves order, so:
//   firstUserPresent = the first role==="user" message in the POST-filter msgs is the session's FIRST
//   user prompt. Since rewinds hide by span (never the first:user before/at the anchor — guardrail #1),
//   a missing first user message in the post-filter view = guardrail violation. Implement as:
//     const firstUserPresent = userMsgs.length > 0;   // ordered array: msgs[0..] — the first
//     // user message in the filtered view IS the first user message if no earlier one was hidden;
//     // asserters compare against session-start expectations. Simplest honest form: presence of a
//     // role==="user" message at all PLUS count.
```

Concrete final form (simple and honest — asserters in T2.S2/T3.S1 do the verdict math):

```ts
const checkpointNames = listCheckpoints(entries);   // mirrors reconcileBanner's scanner (headless no-op workaround)
const userMsgCount = msgs.filter((m) => m?.role === "user").length;
const firstUserPresent = msgs.some((m) => m?.role === "user"); // first user prompt still visible in filtered view
...
smokeLog("context.fire", "info", {
  count: msgs.length,
  msgCanaryPresent: has(MSG_CANARY),
  resultCanaryPresent: has(RESULT_CANARY),
  notePresent: ...,
  hasRewindMarker,
  shrunkInContext: has(SHRUNK_MARKER),
  hasNudge: ...,
  seedAnchorInAssistant,
  seedHiddenInAssistant,
  banner: { activeCount: checkpointNames.length, names: checkpointNames },  // P1.M2.T1.S1
  userMsgCount,                                                            // P1.M2.T1.S1
  firstUserPresent,                                                        // P1.M2.T1.S1
});
```

(`firstUserPresent` as `msgs.some(role==="user")` is the agreed minimal observable: in the ordered post-filter view, if the FIRST user message was hidden there may still be later user messages, so T3.S1's asserter pairs `userMsgCount` deltas across fires with this flag. Do not over-engineer here.)

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT test/integration/smoke.ts — import
  - ADD to the src-imports block (lines 38-42): import { listCheckpoints } from "../../src/tools/audit.js";

Task 2: EDIT test/integration/smoke.ts — context handler
  - COMPUTE checkpointNames / userMsgCount / firstUserPresent inside the existing try (reuse `entries` and `msgs`)
  - ADD the banner/userMsgCount/firstUserPresent fields to the context.fire detail object per the Blueprint
  - ADD the explanatory comment (headless reconcileBanner no-op → recompute via listCheckpoints)
  - PRESERVE: handler returns void; no mutation of event.messages; existing fields untouched; the scenario-scoped hiding assertion blocks below unchanged

Task 3: EDIT test/integration/scenarios.md — "A context.fire line" field reference (~lines 56-67)
  - APPEND to the JSON example:
      "banner": {"activeCount": 1, "names": ["cp"]},  // recomputed checkpoint labels (banner would show headless)
      "userMsgCount": 2,                              // role==="user" messages in the filtered view
      "firstUserPresent": true                        // a user prompt is still visible in the filtered view

Task 4: VERIFY
  - npx tsc --noEmit   (project typecheck)
  - npm test           (unit suite must stay green)
  - Optional: npm run smoke — 14/14 still green (this subtask adds fields only; asserters ignore unknown detail keys)
```

### Integration Points

None in product code. Downstream consumers (later subtasks, do NOT implement here):
- P1.M2.T2.S2 (F-banner) asserts `banner.activeCount` transitions 0→1→0 across fires + /resume restore.
- P1.M2.T3.S1 (F-consent) asserts `userMsgCount` drops / `firstUserPresent` stays true across checkpoint rewinds.

## Validation Loop

### Level 1: Types

```bash
npx tsc --noEmit          # must be clean (smoke.ts is included by tsconfig)
```

### Level 2: Unit suite

```bash
npm test                  # must stay green (no unit tests added — observer glue)
```

### Level 3: Smoke sanity (optional but recommended)

```bash
npm run smoke             # 14/14 green; then grep banner /tmp/mulligan-smoke.log
grep -m2 '"banner"' "${MULLIGAN_SMOKE_LOG:-/tmp/mulligan-smoke.log}"
# Expected: context.fire lines now carry banner/userMsgCount/firstUserPresent; run-smoke.mjs ignores new keys
```

## Final Validation Checklist

- [ ] `context.fire` lines carry `banner {activeCount, names}`, `userMsgCount`, `firstUserPresent`
- [ ] `listCheckpoints` imported from `../../src/tools/audit.js`; `entries` reused (no double getEntries)
- [ ] Comment documents the headless recompute rationale (reconcileBanner branch (a) no-op)
- [ ] Handler still returns void; `event.messages` never mutated; existing fields/keys unchanged
- [ ] scenarios.md field reference updated in the same edit
- [ ] `npx tsc --noEmit` clean; `npm test` green; (optional) `npm run smoke` 14/14
- [ ] No product-code changes (src/ untouched); no run-smoke.mjs changes

## Anti-Patterns to Avoid

- ❌ Don't try to observe the banner widget directly — `setWidget` never fires headless (`ctx.hasUI=false`); recompute via `listCheckpoints`
- ❌ Don't mutate `event.messages` or return a filtered array (GOTCHA #1 — pure observer)
- ❌ Don't add scenario registration or asserters — those are P1.M2.T2/T3/T5
- ❌ Don't add unit tests for this glue — typecheck + existing suites are the gate
- ❌ Don't touch src/banner.ts or src/tools/audit.ts — read/import only