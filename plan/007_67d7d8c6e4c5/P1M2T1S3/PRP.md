# PRP — P1.M2.T1.S3: Tests for agent-attributable drift delta (D10)

## Goal

**Feature Goal**: Prove, via TDD unit tests, that the per-turn drift delta is **agent-attributable**
(D10): user-supplied messages are excluded from the token count that feeds `deltaTokens`, so a large
user paste never inflates the drift delta and never trips the drift nudge. Locks the S1 helper
(`estimateAgentTokens`) and the S2 wiring (`turnEndMetricHandler` now-computation) end-to-end across
the three layers: the pure helper, the metric handler, and the drift-nudge gate.

**Deliverable**: New passing tests **added** to three existing files (no production code):
1. `test/tokens.test.ts` — a new `estimateAgentTokens` describe block (4 core cases + edge + type).
2. `test/turn_metric.test.ts` — one new `turnEndMetricHandler` test with a mixed user+assistant
   fixture asserting `deltaTokens` / rolled baseline are agent-only (500, not 50500).
3. `test/drift_nudge.test.ts` — one new `shouldNudge` test (F-drift-userexempt-shaped) proving a 50k
   user paste does NOT trip the drift nudge, contrasted against the pre-D10 would-have-fired case.

**Success Definition**: `npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts`
is green and `npm run typecheck` passes; the new tests fail-open the D10 contract (user excluded at the
helper layer, excluded from the metric delta, and exempt from the drift-nudge firing condition). All
existing tests remain green (S3 is strictly additive; S2 owns any existing-deltaTokens-assertion drift
caused by its `now`-swap).

## Why

- D10 (spec/07 §5.1 v1.1 note) separates "the agent should shed something" (delta = agent-attributable)
  from "the window is getting full" (high-water = total). Without tests, the `estimateAgentTokens`
  exclusion could silently regress and a 50k-token user paste would once again fire a spurious drift
  nudge prescribing `mulligan_rewind`/`mulligan_shrink` — which can only legitimately target **agent**
  output, making the nudge unactionable noise.
- The three test files mirror the three layers of the D10 pipeline, so a regression at any layer is
  caught locally: `estimateAgentTokens` (tokens.ts) → `now`/`deltaTokens` (nudges.ts turnEndMetricHandler) →
  `shouldNudge` windowed gate (nudges.ts).
- This is the verification backstop for the P1.M2 headline change (agent-attributable drift delta).

## What

User-visible behaviour: **none** (test-only; Mode A).

Test-visible behaviour added (across 3 files, all **append-only**):

### 1. `test/tokens.test.ts` — NEW describe block
`estimateAgentTokens` unit tests proving the helper itself:
- (1) A large `user` message + a small `assistant` message → returns **only** the assistant tokens
  (e.g. user `"x"`.repeat(200000) [=50000 if counted] + assistant `"x"`.repeat(2000) [=500] → **500**, not 50500).
- (2) empty / `null` / `undefined` / non-array → **0**.
- (3) an all-user-messages list → **0**.
- (4) a mix of roles → sums the **non-user** messages only (assistant + toolResult + custom; user excluded).
- (edge) a message with no `role` is NOT `"user"` → **counted** (S1 contract: "when in doubt, attribute to agent").
- (type) `estimateAgentTokens` is exported and returns a non-negative `number`.

### 2. `test/turn_metric.test.ts` — NEW `turnEndMetricHandler` test
Mock `rt.lastFiltered` with a 50k-token user message + a 500-token assistant message; assert the
recorded `deltaTokens` and the rolled `rt.tokenBaseline` are **agent-only (500)** — not 50500 — proving
the S2 `now`-swap propagates the exclusion into the persisted metric + the apples-to-apples baseline roll.

### 3. `test/drift_nudge.test.ts` — NEW `shouldNudge` test (F-drift-userexempt-shaped)
A 50k-token user paste does NOT trip the drift nudge: build the same filtered view, show
`estimateAgentTokens` yields 500 (not 50500), and that a window of such agent-attributable deltas stays
below `driftThresholdTokens` → `shouldNudge` is **false**. Contrast: the pre-D10 50000-token delta
**does** fire — proving the exemption is load-bearing.

### Success Criteria
- [ ] `estimateAgentTokens` tests (1)-(4)+edge+type pass and fail if the helper regresses (e.g. starts
      counting user messages, or throws on null/non-array).
- [ ] The turn_metric test asserts `deltaTokens === 500` and `rt.tokenBaseline === 500` for the mixed
      fixture (given S2 applied) — and would be 50500 under the pre-D10 `estimateTokens` computation.
- [ ] The drift_nudge test asserts `shouldNudge(...) === false` for the agent-attributable window and
      `=== true` for the pre-D10 contrast.
- [ ] Zero edits to existing assertions (S2 owns existing-deltaTokens drift; S3 is additive).
- [ ] `npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts` fully green.
- [ ] `npm run typecheck` passes (no new type errors).

## All Needed Context

### Context Completeness Check
✅ Passes "No Prior Knowledge": the exact `estimateAgentTokens` body, the S2 `now`-swap contract, each
test file's imports/helpers/reset discipline, the exact token math (`ceil(chars/4)`), and copy-pasteable
test code are all quoted below. An implementer who has never seen this repo can write the tests by
copying "Test code" in the Implementation Blueprint.

### Documentation & References

```yaml
- file: src/tokens.ts   # READ-ONLY (S1 owns it; S3 consumes)
  why: estimateAgentTokens (L142-150) is the S1 helper under test. EXACT body quoted in Known Gotchas.
  pattern: "non-array→0; per-msg readOwn(msg,'role')!=='user' → counted; each msg ceiling-rounded via estimateTokens([msg])."
  gotcha: "a message with NO role is counted (!== 'user'). estimateAgentTokens NEVER throws (defensive)."

- file: src/nudges.ts   # READ-ONLY (S2 owns it; S3 tests its behaviour)
  why: "turnEndMetricHandler (L196) computes now/delta/baseline; shouldNudge (L321) is the windowed gate.
        POST-S2: now = rt.lastFiltered ? estimateAgentTokens(rt.lastFiltered) : (ctx.getContextUsage()?.tokens ?? 0);
        delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline; rt.tokenBaseline = now."
  pattern: "shouldNudge NEWEST-FIRST window (recentMetrics.slice(0, driftWindowTurns)); delta-only firing
            (avg(window finite deltaTokens) >= driftThresholdTokens); bloatHit only as no-delta fallback."
  gotcha: "This PRP does NOT edit nudges.ts. Tests assume S2 applied (the now-swap). If S2 hasn't landed,
           the turn_metric test's deltaTokens would be 50500 not 500 — see 'S2 dependency' below."

- file: test/tokens.test.ts      # EDIT: +import estimateAgentTokens, +1 describe block
  why: unit-test home for estimateTokens; S3 adds the estimateAgentTokens block beside it.
  pattern: "NO beforeEach (tokens.ts has no module state). MessageLike fixtures. exact ceil(chars/4) assertions."
  gotcha: "ADD estimateAgentTokens to the existing import list (from ../src/tokens.js). Do NOT touch existing blocks."

- file: test/turn_metric.test.ts # EDIT: +1 it() inside the existing turnEndMetricHandler describe
  why: home for turnEndMetricHandler tests; S3 adds the D10 mixed-fixture case.
  pattern: "beforeEach/afterEach → clearAll() + setConfig(structuredClone(DEFAULT_CONFIG)). makePi/makeCtx/makeEvent
            fakes. Idiom: getRuntime('s1'); mutate rt.tokenBaseline/lastFiltered; call handler; assert appended[0].data."
  gotcha: "msgOfChars(n) builds a USER message — existing assertions using it BREAK under S2 and are S2's to fix.
           S3 builds its MIXED fixture INLINE (user + assistant), never via msgOfChars. S3 touches no existing assertion."

- file: test/drift_nudge.test.ts # EDIT: +import estimateAgentTokens, +1 it() inside the shouldNudge describe
  why: home for shouldNudge tests; S3 adds the F-drift-userexempt case.
  pattern: "PURE file (no beforeEach/clearAll/Pi). Helpers m(deltaTokens,bloatHit,seq) + cfg(windowTurns,threshold).
            shouldNudge(metrics, cfg)."
  gotcha: "ADD `import { estimateAgentTokens } from '../src/tokens.js';` (additive). MessageLike is already imported
           from transforms.js (structurally compatible with tokens.MessageLike — see gotcha #5)."

- docfile: spec/07-preventive-and-nudges.md   # READ-ONLY
  why: "§5.1 v1.1 note (D10): 'Because Phase 1 now excludes user messages from now, a large user-supplied input
        never inflates the drift delta... a user pasting a 50k-token reference doc does NOT trip the drift nudge.'
        §2 Phase-1 code shows the estimateAgentTokens call + baseline roll."
  section: "h3.55 (§5.1 D10 note); h2.78 (§2 Phase 1 measure)."

- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md   # READ-ONLY
  why: "§Change 4 prescribes the S2 swap + the S1 helper. Confirms D10 is delta-only (high-water unchanged)."
  section: "§Change 4 (D10)."
```

### Current Codebase tree (relevant slice)

```bash
src/
├── tokens.ts    # S1 DONE: estimateAgentTokens (L142-150). READ-ONLY for S3.
├── nudges.ts    # S2 target: turnEndMetricHandler now-swap (L223-225) + shouldNudge (L321). READ-ONLY for S3.
└── runtime.ts   # SessionRuntime.tokenBaseline / lastFiltered (the fields turn_metric.test mutates). READ-ONLY.
test/
├── tokens.test.ts        # EDIT: +import, +estimateAgentTokens describe block
├── turn_metric.test.ts   # EDIT: +1 it() (mixed user+assistant fixture)
└── drift_nudge.test.ts   # EDIT: +import, +1 it() (F-drift-userexempt)
package.json   # scripts: test=vitest run, typecheck=tsc --noEmit
tsconfig.json  # strict:true, noImplicitAny (NO noUnusedLocals)
```

### Desired Codebase tree (files MODIFIED by this item)

```bash
test/tokens.test.ts        # +1 describe block "estimateAgentTokens — D10 agent-attributable (...)" + import
test/turn_metric.test.ts   # +1 it() inside the turnEndMetricHandler describe
test/drift_nudge.test.ts   # +1 it() inside the shouldNudge describe + import
# (no new files; no production-code edits)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — S3 DEPENDS ON S2 APPLIED. estimateAgentTokens (S1) is ALREADY in src/tokens.ts (verified L142).
//   turnEndMetricHandler's `now` (S2) is the swap under test. PRECONDITION for test 2 (turn_metric):
//     `grep -n 'estimateAgentTokens' src/nudges.ts` must return ≥1 hit (the import + the now-line).
//   If S2 has NOT landed, the turn_metric test's deltaTokens will be 50500 not 500 → the test will FAIL,
//   which is CORRECT (it means S2 isn't done). Do NOT "fix" the test to 50500 — flag that S2 is missing.
//   tests 1 (tokens) and 3 (drift_nudge) do NOT depend on S2 (they call estimateAgentTokens / shouldNudge directly).

// CRITICAL — the token math is ceil(chars/4). For exact assertions:
//   "x".repeat(200000) → 50000 tokens (if counted); "x".repeat(2000) → 500 tokens; "abcd" → 1 token.
//   estimateAgentTokens([user 200000, assistant 2000]) = 500 (user excluded). Use "x".repeat() for determinism.

// CRITICAL — S3 is ADDITIVE. In turn_metric.test.ts, the existing assertions use msgOfChars(n) = a USER
//   message; under S2 those assertions break (user now excluded → now=0). THOSE ARE S2'S TO FIX (S2 Test-impact
//   note). S3 must NOT touch them. S3 builds its mixed fixture INLINE (not via msgOfChars).

// GOTCHA — a message with NO role is COUNTED by estimateAgentTokens (readOwn(msg,'role') !== 'user' → true).
//   This is the documented S1 semantic ("when in doubt, attribute to agent"). Test (edge) locks it.

// GOTCHA — drift_nudge.test.ts imports MessageLike from transforms.js; estimateAgentTokens takes tokens.MessageLike[].
//   They are STRUCTURALLY compatible (both are message shapes with role/content). Passing the literal works; if tsc
//   flags it, annotate `as MessageLike[]` (in-scope) or drop the annotation (TS infers an assignable literal).

// GOTCHA — shouldNudge's window is NEWEST-FIRST (highest seq at index 0). m(delta, bloat, seq) takes seq as 3rd arg.
```

## Implementation Blueprint

### Data models and structure
None — test-only. Reuses `MessageLike` (tokens.ts / transforms.ts), `TurnMetric` (markers.ts), `MulliganConfig` (config.ts) — all already imported in the respective test files.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT test/tokens.test.ts (+import, +describe block)
  - ADD estimateAgentTokens to the import list from "../src/tokens.js" (the named import, alongside estimateTokens).
  - APPEND a new describe block (copy-paste under "Test code — tokens.test.ts") near the other estimateTokens blocks.
  - FOLLOW pattern: the existing estimateTokens describe blocks (MessageLike fixtures; exact ceil(chars/4) assertions;
    defensive-never-throws). NO beforeEach.
  - NAMING: "describe('estimateAgentTokens — D10 agent-attributable token count (spec/07 §2/§5.1 v1.1)', …)".
  - PLACEMENT: after the estimateTokens describe blocks, before the resultBytes/approxTokens blocks (any spot is fine).
  - DO NOT: touch any existing estimateTokens/resultBytes/approxTokens assertion.

Task 2: EDIT test/turn_metric.test.ts (+1 it, inside the turnEndMetricHandler describe)
  - APPEND one it() (copy-paste under "Test code — turn_metric.test.ts") inside the existing turnEndMetricHandler describe.
  - FOLLOW pattern: the existing deltaTokens idiom (getRuntime('s1'); set rt.tokenBaseline/lastFiltered; call handler;
    assert appended[0].data.deltaTokens + rt.tokenBaseline). Uses makePi/makeCtx/makeEvent already in the file.
  - NAMING: "it('D10 (agent-attributable): deltaTokens EXCLUDES the user-message contribution; baseline rolls agent-only', …)".
  - DEPENDENCIES: assumes S2 applied (now = estimateAgentTokens). PRECONDITION: grep estimateAgentTokens in src/nudges.ts.
  - DO NOT: use msgOfChars (it's user-only) — build the mixed fixture INLINE. Do NOT edit existing assertions.

Task 3: EDIT test/drift_nudge.test.ts (+import, +1 it, inside the shouldNudge describe)
  - ADD `import { estimateAgentTokens } from "../src/tokens.js";` at the top (additive).
  - APPEND one it() (copy-paste under "Test code — drift_nudge.test.ts") inside the existing shouldNudge describe.
  - FOLLOW pattern: the existing shouldNudge its (helpers m(delta,bloat,seq) + cfg(windowTurns,threshold); pure, no Pi).
  - NAMING: "it('D10 (F-drift-userexempt-shaped): a 50k-token user paste does NOT trip the drift nudge …', …)".
  - DO NOT: add beforeEach/clearAll (the file is pure). Do NOT edit existing its.

Task 4: VALIDATE
  - RUN: npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts  (green)
  - RUN: npm test                                                                          (full suite, no regressions)
  - RUN: npm run typecheck                                                                 (tsc --noEmit, clean)
```

### Test code — test/tokens.test.ts (copy-paste; add `estimateAgentTokens` to the import, then append this block)

```ts
// ── estimateAgentTokens — D10 agent-attributable token count (spec/07 §2/§5.1 v1.1) ────────
// P1.M2.T1.S3: locks the S1 helper — only NON-user messages count toward the drift delta's `now`.
describe("estimateAgentTokens — D10 agent-attributable token count (spec/07 §2/§5.1 v1.1)", () => {
  it("(1) a large user message + a small assistant message → ONLY the assistant tokens (user EXCLUDED)", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "x".repeat(200000) },      // 50000 tokens if counted
      { role: "assistant", content: "x".repeat(2000) },    // 500 tokens
    ];
    expect(estimateAgentTokens(msgs)).toBe(500);           // NOT 50500 — the user paste is excluded (D10)
  });

  it("(2) empty / null / undefined / non-array → 0 (defensive — mirrors estimateTokens)", () => {
    expect(estimateAgentTokens([])).toBe(0);
    expect(estimateAgentTokens(null)).toBe(0);
    expect(estimateAgentTokens(undefined)).toBe(0);
    expect(estimateAgentTokens("nope" as unknown as MessageLike[])).toBe(0);
  });

  it("(3) an all-user-messages list → 0 (every message excluded)", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "x".repeat(200000) },
      { role: "user", content: "abcd" },
    ];
    expect(estimateAgentTokens(msgs)).toBe(0);
  });

  it("(4) a mix of roles → sums the NON-user messages only (assistant + toolResult + custom)", () => {
    const msgs: MessageLike[] = [
      { role: "user", content: "abcd" },                                    // 1 token — EXCLUDED
      { role: "assistant", content: [{ type: "text", text: "efgh" }] },     // 1 token — counted
      { role: "toolResult", toolCallId: "1", toolName: "read", content: [{ type: "text", text: "ijkl" }] }, // 1 — counted
      { role: "custom", customType: "mulligan:nudge", content: "mnop" },    // 1 token — counted
    ];
    expect(estimateAgentTokens(msgs)).toBe(3);             // 1 + 1 + 1 (user excluded)
  });

  it("(edge) a message with no role is NOT 'user' → counted (when in doubt, attribute to agent)", () => {
    const msgs = [{ content: "abcd" }] as unknown as MessageLike[]; // no role → counted (S1 contract)
    expect(estimateAgentTokens(msgs)).toBe(1);
  });

  it("(type) estimateAgentTokens is exported and returns a non-negative number", () => {
    expectTypeOf(estimateAgentTokens([])).toEqualTypeOf<number>();
    const r = estimateAgentTokens([{ role: "assistant", content: "x" }]);
    expect(typeof r).toBe("number");
    expect(r).toBeGreaterThanOrEqual(0);
  });
});
```

### Test code — test/turn_metric.test.ts (copy-paste; append this it() inside the turnEndMetricHandler describe)

```ts
  // ── P1.M2.T1.S3: D10 — agent-attributable delta (requires S2 applied) ────────────────────
  it("D10 (agent-attributable): deltaTokens EXCLUDES the user-message contribution; baseline rolls agent-only", () => {
    const { appended, pi } = makePi();
    const { ctx } = makeCtx({ sessionId: "s1" });
    const rt = getRuntime("s1");
    rt.tokenBaseline = 0; // previous agent baseline → delta == now

    // The user pasted a 50k-token reference doc this turn; the agent replied with ~500 tokens.
    // (Built INLINE — not msgOfChars, which is user-only — so this test is independent of S2's
    //  existing-assertion fixes.)
    rt.lastFiltered = [
      { role: "user", content: "x".repeat(200000) },      // 50000 tokens — EXCLUDED (D10 ground-truth)
      { role: "assistant", content: "x".repeat(2000) },    // 500 tokens — agent-attributable
    ];

    turnEndMetricHandler(pi, makeEvent(1), ctx);
    const data = appended[0].data as Record<string, unknown>;

    // POST-S2: now = estimateAgentTokens(rt.lastFiltered) = 500 → delta = 500 - 0 = 500.
    // PRE-D10 this would have been 50500 (the paste inflated now). The user paste never inflates the drift delta.
    expect(data.deltaTokens).toBe(500);
    // The rolled baseline is agent-attributable (apples-to-apples with the next delta):
    expect(rt.tokenBaseline).toBe(500);
  });
```

### Test code — test/drift_nudge.test.ts (copy-paste; add the import, then append this it() inside the shouldNudge describe)

```ts
// TOP OF FILE — add to imports (additive):
// import { estimateAgentTokens } from "../src/tokens.js";

  // ── P1.M2.T1.S3: D10 — F-drift-userexempt-shaped (does NOT require S2) ───────────────────
  it("D10 (F-drift-userexempt-shaped): a 50k-token user paste does NOT trip the drift nudge (agent-attributable delta stays below threshold)", () => {
    // The turn's filtered view: a 50k-token user paste + a ~500-token assistant reply.
    const filteredView = [
      { role: "user", content: "x".repeat(200000) },      // 50000 tokens if counted — EXCLUDED by D10
      { role: "assistant", content: "x".repeat(2000) },    // 500 tokens — agent-attributable
    ] as MessageLike[];

    // turnEndMetricHandler (post-S2) computes `now` via estimateAgentTokens → the paste contributes 0.
    const agentAttributableNow = estimateAgentTokens(filteredView);
    expect(agentAttributableNow).toBe(500);                // NOT 50500 — the paste is ground-truth, never bloat

    // A window of such turns: the windowed-average delta stays far below the threshold → no drift nudge.
    expect(
      shouldNudge(
        [m(agentAttributableNow, false, 3), m(agentAttributableNow, false, 2), m(agentAttributableNow, false, 1)],
        cfg(3, 6000),
      ),
    ).toBe(false);

    // Contrast (pre-D10 would-have-fired): counting the paste gives a ~50000-token delta → drift nudge FIRES.
    expect(shouldNudge([m(50000, false, 1)], cfg(3, 6000))).toBe(true);
  });
```

### Implementation Patterns & Key Details

```ts
// PATTERN — estimateAgentTokens is `sum of estimateTokens([msg]).tokens where role !== "user"`. For exact
//   assertions use "x".repeat(n) so chars are deterministic: tokens = ceil(n/4). (200000→50000; 2000→500; 4→1.)

// PATTERN — turn_metric.test.ts delta idiom: getRuntime('s1') returns the SAME object turnEndMetricHandler will
//   read via runtime(ctx) (keyed by sessionId). Mutate rt.tokenBaseline + rt.lastFiltered BEFORE calling the
//   handler; then assert appended[0].data.deltaTokens and rt.tokenBaseline (post-roll).

// PATTERN — drift_nudge.test.ts is PURE (no Pi). shouldNudge(metrics, cfg): metrics are NEWEST-FIRST (highest
//   seq at index 0); firing = avg(window finite deltaTokens) >= driftThresholdTokens. Use m(delta,bloat,seq)+cfg().

// GOTCHA — test 2 (turn_metric) is the ONLY test that depends on S2. If it fails with deltaTokens===50500, S2
//   has not landed yet (the now-swap is missing) — do NOT change 500→50500; flag S2 as incomplete. Tests 1 & 3
//   call estimateAgentTokens/shouldNudge directly and pass regardless of S2.

// GOTCHA — a message with NO role is counted (readOwn(msg,'role') returns undefined !== 'user'). The (edge)
//   test in tokens.test.ts locks this S1 contract.
```

### Integration Points
```yaml
TEST FILES (append-only — vitest auto-discovers *.test.ts; no registration):
  - test/tokens.test.ts:      +import estimateAgentTokens, +1 describe block (Task 1)
  - test/turn_metric.test.ts: +1 it() inside the turnEndMetricHandler describe (Task 2)
  - test/drift_nudge.test.ts: +import estimateAgentTokens, +1 it() inside the shouldNudge describe (Task 3)
NO: production-code edits, config changes, package.json changes, new files, DB, routes, registration.
```

## Validation Loop

### Level 1: Syntax & Style (after writing each block)
```bash
# PRECONDITION for Task 2 only: S2 must be applied. Verify before relying on the turn_metric test:
grep -n 'estimateAgentTokens' src/nudges.ts
# EXPECT: ≥2 hits (import line + the now-line). If 0 hits, S2 hasn't landed → Task 2's test will fail at 50500
#   (correctly); flag it. (S1 — estimateAgentTokens in tokens.ts — is already present; verify with:
grep -n 'export function estimateAgentTokens' src/tokens.ts   # EXPECT: 1 hit at ~L142.)

npm run typecheck                  # tsc --noEmit — must be clean (strict + noImplicitAny)
# Expected: zero errors. Common cause of failure: a MessageLike structural mismatch in drift_nudge.test.ts —
#   fix with `as MessageLike[]` (already in the copy-paste code) or drop the annotation.
```

### Level 2: Unit Tests (the deliverable)
```bash
# The three files this item touches — run first, must be fully green:
npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts

# Expected: ALL pass.
#   - If tokens.test.ts (1)-(4)+edge+type fail → estimateAgentTokens regressed (re-read src/tokens.ts L142-150).
#   - If turn_metric.test.ts fails with deltaTokens===50500 → S2 NOT applied (now still uses estimateTokens);
#     do NOT change 500→50500; flag S2 incomplete. If it fails any other way → re-check the fixture/baseline.
#   - If drift_nudge.test.ts fails → re-check the m()/cfg() helper signatures + the shouldNudge windowing.
```

### Level 3: Full Suite (no regressions)
```bash
npm test                           # vitest run — entire suite
# Expected: green. S3 is additive; it must not break any existing test.
#   NOTE: S2 (running in parallel) may itself change EXISTING turn_metric deltaTokens assertions (the msgOfChars
#   ones). If those specific assertions are red here, that is S2's Test-impact responsibility, NOT S3's — S3 added
#   only NEW tests. Confirm S3's three additions are green and that S3 touched no existing line.
```

### Level 4: Contract spot-check (manual reasoning)
```bash
# Confirm the exact token math the tests rely on (ceil(chars/4), user excluded):
node -e "
const f=[{role:'user',content:'x'.repeat(200000)},{role:'assistant',content:'x'.repeat(2000)}];
const per=(m)=>Math.ceil(m.content.length/4);
const agent=f.filter(m=>m.role!=='user').reduce((s,m)=>s+per(m),0);
const total=f.reduce((s,m)=>s+per(m),0);
console.log('agent-attributable:',agent,'| total (pre-D10):',total);
"
# Expected: agent-attributable: 500 | total (pre-D10): 50500   ← the exact values the tests assert.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run test/tokens.test.ts test/turn_metric.test.ts test/drift_nudge.test.ts` fully green.
- [ ] `npm test` (full suite) green — S3 added tests without breaking the existing suite.

### Feature Validation
- [ ] tokens.test.ts (1) large user + small assistant → 500 (not 50500); (2) empty/null/non-array → 0;
      (3) all-user → 0; (4) mixed → non-user sum; (edge) no-role counted; (type) exported → number.
- [ ] turn_metric.test.ts: mixed user(50k)+assistant(500) fixture → `deltaTokens===500` and
      `rt.tokenBaseline===500` (given S2 applied).
- [ ] drift_nudge.test.ts: `estimateAgentTokens===500`; `shouldNudge([m(500)×3],cfg(3,6000))===false`;
      contrast `shouldNudge([m(50000)],cfg(3,6000))===true`.

### Code Quality Validation
- [ ] Append-only: zero edits to existing assertions in any of the three files (S2 owns existing-deltaTokens drift).
- [ ] New blocks follow existing describe/it naming + reset discipline (beforeEach/clearAll where the file uses them).
- [ ] turn_metric test builds its fixture INLINE (not via the user-only msgOfChars helper).
- [ ] No production-code, package.json, or new-file changes.

### Documentation & Deployment
- [ ] Mode A: no user-facing/config/API surface change — no README/spec update required (rides with S2/S1).

---

## Anti-Patterns to Avoid
- ❌ Don't edit `src/tokens.ts` or `src/nudges.ts` — S1/S2 own them; S3 only consumes/tests.
- ❌ Don't touch existing assertions — especially the `msgOfChars`-based deltaTokens ones in turn_metric.test.ts
      (those break under S2 and are S2's Test-impact responsibility).
- ❌ Don't use `msgOfChars` for the D10 mixed fixture — it's user-only. Build the user+assistant fixture inline.
- ❌ Don't "fix" the turn_metric test to expect 50500 if it fails — a 50500 failure means S2 hasn't landed; flag it.
- ❌ Don't add `beforeEach`/`clearAll` to drift_nudge.test.ts — it's a pure-function file.
- ❌ Don't conflate `estimateAgentTokens` (agent-attributable) with `estimateTokens` (total) in the assertions —
      the whole point of D10 is they differ when user messages are present.
- ❌ Don't write production code or new files — this item is test-only.

---

**Confidence Score: 9/10** — one-pass success likelihood is high: the exact `estimateAgentTokens` body is
quoted (S1, verified present), each test file's imports/helpers/reset/idoms are documented, the token math
is deterministic (`ceil(chars/4)`; verified 500/50500 by node), and all three test blocks are copy-pasteable.
The two residual risks are both mitigated: (1) the S2 dependency for test 2 (turn_metric) — flagged as a hard
precondition with a `grep` check, and tests 1 & 3 pass regardless of S2; (2) the S2-vs-S3 scope split on
existing deltaTokens assertions — made explicit (S3 is additive; S2 owns the msgOfChars-assertion drift), so
the implementer will not over-reach into S2's work. Deterministic gates: `npx vitest run` green on the three
files; `npm run typecheck` clean; the Level-4 spot-check prints the exact 500/50500 values the tests assert.