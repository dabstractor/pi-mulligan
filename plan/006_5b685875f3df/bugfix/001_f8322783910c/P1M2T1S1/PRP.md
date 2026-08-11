# PRP — P1.M2.T1.S1: Move `pendingBloatHits` clear before the `perTurnDrift` early-return (BUG-004)

## Goal

**Feature Goal**: Close the BUG-004 unbounded-accumulation gap in `turnEndMetricHandler` (src/nudges.ts).
`bloatReminderHandler` (Nudge A) pushes to `rt.pendingBloatHits` on its **own** `bloatReminder` gate, but the
**only** clear (`rt.pendingBloatHits = []`, line 218) runs AFTER the `if (!config.enabled || !config.nudges.perTurnDrift) return;`
gate (line ~199). So in the valid config `bloatReminder:true, perTurnDrift:false`, the accumulator grows by one
entry per bloated result for the entire session. Fix: move the snapshot+clear **as a block** (plus
`getRuntime`) to BEFORE the gate, so the accumulator is cleared every `turn_end` regardless of the flag — while
the captured `bloat` still feeds the metric correctly when `perTurnDrift` is on.

**Deliverable**: Edits to **two files**:
1. `src/nudges.ts` — block-reorder inside `turnEndMetricHandler` (move `getRuntime` + the
   `const bloat = rt.pendingBloatHits; rt.pendingBloatHits = [];` block to before the gate) + a JSDoc note
   (Mode A inline docs).
2. `test/turn_metric.test.ts` — one regression `it(...)` proving `pendingBloatHits` is cleared even when
   `perTurnDrift:false` (the assertion that FAILS before the fix, PASSES after).

**Success Definition**: After the edit, `turnEndMetricHandler` with `perTurnDrift:false` + a seeded
`pendingBloatHits` leaves `rt.pendingBloatHits === []` (cleared); with `perTurnDrift:true` the metric still
snapshots the real hits (`bloatHit`/`bloatHits` correct, field reassigned to a fresh `[]`). `npx tsc --noEmit`
exits 0; the full vitest suite passes (count +1 for the new regression test). **No existing test changes
behavior** (verified against the 3 relevant turn_metric.test.ts tests).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers; indirectly the tool_result hot path (memory hygiene).

**Use Case**: An operator enables the inline bloat reminder but disables the per-turn drift nudge
(`bloatReminder:true, perTurnDrift:false`). The session runs long with many large bash results.

**Pain Points Addressed**: Today `pendingBloatHits` grows without bound in that config (dead data — never
read — but unbounded in-memory accumulation on the hot path). After the fix it is cleared every turn.

## Why

- **Memory hygiene on the hot path**: `bloatReminderHandler` fires on every over-threshold tool result; the
  accumulator it feeds must be drained every turn regardless of the drift-nudge flag. BUG-004 (Minor).
- **Correct config-decoupling**: Nudge A (`bloatReminder`) and Nudge B (`perTurnDrift`) are independently
  configurable by design (spec/09). The clear was incorrectly coupled to `perTurnDrift`; moving it before the
  gate restores the decoupling. PRD §2.5 recommends exactly this ("clear at the top of turnEndMetricHandler
  before the perTurnDrift early-return").
- **Tiny, safe, well-contained**: a block reorder; the metric snapshot is unchanged (the block captures the
  real hits before clearing); fail-open semantics preserved (a `getSessionId()` throw still skips the clear,
  so hits retry — the existing fail-open test stays green).

## What

One block-reorder inside `turnEndMetricHandler`'s try body: `getRuntime(sessionId)` + the snapshot+clear block
move from after the `perTurnDrift` gate to before it; the gate moves down (after the clear); `now`/`delta` stay
after the gate; the metric (step 6) still uses the captured `bloat`. Plus a JSDoc paragraph + one regression
test. No signature change, no algorithm change, no new config.

### Success Criteria

- [ ] In `turnEndMetricHandler`, `const rt = getRuntime(sessionId)` and `const bloat = rt.pendingBloatHits;
      rt.pendingBloatHits = [];` run BEFORE `if (!config.enabled || !config.nudges.perTurnDrift) return;`.
- [ ] `getConfig()` is still read before the gate (it's needed for the gate).
- [ ] The `bloat` const is still referenced in the metric (`bloatHit: bloat.length > 0`, `bloatHits: bloat`)
      — now declared before the gate, used after it (same try block; type-clean).
- [ ] `sessionId = ctx.sessionManager.getSessionId()` stays FIRST in the try (so a throw there still skips the
      clear → fail-open test stays green).
- [ ] JSDoc notes the clear runs before the `perTurnDrift` gate (always cleared).
- [ ] New regression test: `perTurnDrift:false` + seeded `pendingBloatHits` → `rt.pendingBloatHits === []` after.
- [ ] `npx tsc --noEmit` exits 0; `npx vitest run` passes (count +1).
- [ ] No file other than `src/nudges.ts` and `test/turn_metric.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP carries the verbatim current text of the span to reorder, the verbatim desired replacement,
the proof that the block-move (not just the reset) is required, the traced analysis that no existing test
breaks (3 specific tests), the exact regression test with the file's idiom, and the deterministic gates.

### Documentation & References

```yaml
# MUST READ — the file being edited (the block reorder)
- file: src/nudges.ts
  why: turnEndMetricHandler (lines 188–240). Reorder the try body: move getRuntime + the snapshot+clear block
        (lines ~201, 217–218) to BEFORE the gate (line ~199). The metric (step 6, ~line 220) uses `bloat`.
  pattern: "the try body is a linear sequence: sessionId → getConfig → [GATE] → getRuntime → now → delta →
            snapshot+clear → metric → append → roll baseline. The reorder moves getRuntime+snapshot+clear
            BEFORE the gate; everything else (now/delta/metric/append/roll) stays after it."
  gotcha: "move the snapshot+clear AS A BLOCK (const bloat = rt.pendingBloatHits; THEN rt.pendingBloatHits = []),
          NOT just the reset. Clearing alone before the gate would leave the after-gate snapshot capturing an
          empty array (tool_result fires before turn_end → no hits arrive between a pre-gate clear and an
          after-gate snapshot) → bloat always empty → breaks the bloat-snapshot test. The block captures the
          real hits into `bloat` BEFORE clearing."

# MUST READ — the bug research (root cause + fix prescription)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: §BUG-004 gives the root cause (clear at line 218 after the gate at line 200; bloatReminderHandler pushes
        on its own gate), and prescribes "move the rt.pendingBloatHits = [] clear to BEFORE the early return."
        Files touched: src/nudges.ts (turnEndMetricHandler) + test.
  critical: "the contract's RESEARCH NOTE has two framings; the AUTHORITATIVE one is the 'Actually…' clause —
             move the snapshot+clear as a BLOCK before the gate (not just the reset). See GOTCHA #1."

# MUST READ — the test file for turnEndMetricHandler (where the regression test goes + the 3 tests to preserve)
- file: test/turn_metric.test.ts
  why: (1) The "config gates short-circuit before measurement (GOTCHA #8)" describe (line 134) is the home for
        the new regression test — mirror the existing perTurnDrift-OFF it() at line 146. (2) The bloat
        snapshot-THEN-clear test (line 241) seeds rt.pendingBloatHits then asserts snapshot+fresh [] — proves
        the perTurnDrift-ON path is unchanged. (3) The fail-open throwing-getSessionId test (line 398) asserts
        pendingBloatHits NOT cleared on a sessionId throw — proves fail-open is preserved.
  pattern: "makePi()→{appended,pi}; makeCtx({sessionId})→{ctx}; makeEvent(n); getRuntime(id);
            rt.pendingBloatHits = [{toolName, approxTokens}, …]; setConfig({…structuredClone(DEFAULT_CONFIG)…})."
  gotcha: "the existing perTurnDrift-OFF test (line 146) does NOT assert pendingBloatHits — that's the coverage
           gap BUG-004 exposes. Add the assertion in a NEW it(), don't modify the existing one (keep its scope)."

# SHOULD READ — the push site (confirms bloatReminderHandler's gate is bloatReminder, not perTurnDrift)
- file: src/nudges.ts
  why: bloatReminderHandler (line ~130–145) gates on `config.enabled && config.nudges.bloatReminder` (NOT
        perTurnDrift) and pushes to rt.pendingBloatHits (line 142). This is WHY the clear must be decoupled
        from perTurnDrift. DO NOT change bloatReminderHandler.
  gotcha: "do NOT 'fix' this by gating the push on perTurnDrift — that would suppress the bloat reminder's own
           recording. The clear is the correct fix."

# CONTEXT — the parallel item (confirms disjoint edit regions in src/nudges.ts)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M1T3S1/PRP.md
  why: CONTRACT. Edits `shouldNudge` (a DIFFERENT function, AFTER turnEndMetricHandler) — its return `>`→`>=` +
        @returns JSDoc + the SPEC-AMBIGUITY comment — plus src/config.ts (driftThresholdTokens 6000→4000) +
        test/config.test.ts + test/drift_nudge.test.ts. It does NOT touch turnEndMetricHandler (lines 188–240)
        and explicitly leaves `grewOverThreshold` (line ~226) alone. DISJOINT regions → no textual conflict.
  critical: "if M1.T3.S1 lands first, the `driftThresholdTokens` default is 4000 (not 6000) — irrelevant to
             this fix (the gate/comparison are untouched here). Either order is safe."
```

### Current Codebase tree (the only relevant slice)

```bash
src/
└── nudges.ts            # ← EDIT: turnEndMetricHandler block-reorder (188–218) + JSDoc (177–194)
test/
└── turn_metric.test.ts  # ← EDIT: +1 regression it() in the "config gates short-circuit" describe (line 134)
# (test/nudges.test.ts tests bloatReminderHandler — the PUSH side; unaffected. test/edge-cases.test.ts has 2
#  turnEndMetricHandler fail-open/disabled tests — also unaffected: the gate still returns before appendTurnMetric.)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/nudges.ts           # block-reorder in turnEndMetricHandler + JSDoc paragraph (Mode A)
test/turn_metric.test.ts # +1 regression it() (BUG-004 proof)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (BLOCK move, not just the reset): move `const bloat = rt.pendingBloatHits;` AND
//   `rt.pendingBloatHits = [];` TOGETHER (as a block) to before the gate. If you clear before the gate but
//   leave the snapshot after it, the snapshot captures an already-empty array (tool_result fires BEFORE
//   turn_end → no new hits arrive between a pre-gate clear and an after-gate snapshot) → bloat always empty →
//   bloatHit always false → BREAKS test/turn_metric.test.ts:241. The block captures the real hits into `bloat`
//   BEFORE clearing, and `bloat` is referenced later (step 6 metric) only when perTurnDrift is on.

// CRITICAL GOTCHA #2 (getRuntime must move too): the clear needs `rt`, which comes from getRuntime(sessionId).
//   Currently getRuntime is AFTER the gate (line ~201). Move it BEFORE the gate along with the block. getConfig()
//   stays first (the gate reads config). sessionId = getSessionId() stays FIRST overall (fail-open: a throw
//   there must skip the clear so hits retry — see GOTCHA #3).

// CRITICAL GOTCHA #3 (preserve fail-open on sessionId throw): test/turn_metric.test.ts:398 asserts
//   pendingBloatHits is NOT cleared when getSessionId() throws. Because sessionId = getSessionId() is the FIRST
//   statement in the try and the clear comes AFTER it, a throw at getSessionId jumps to catch before the clear
//   → pendingBloatHits preserved → test stays green. DO NOT move the clear above getSessionId.

// CRITICAL GOTCHA #4 (the bloat const is used after the gate): `bloat` is declared before the gate (step 3)
//   but referenced in the metric (step 6, `bloatHit: bloat.length > 0`, `bloatHits: bloat`) which is AFTER the
//   gate. TypeScript is fine with this (same try-block scope; a const used later). No type error.

// OUT OF SCOPE (do NOT touch in this subtask):
#   - bloatReminderHandler (the push site, line ~130–145) → its gate is bloatReminder (correct); do not couple
#     it to perTurnDrift.
#   - shouldNudge / grewOverThreshold / driftThresholdTokens → owned by the parallel M1.T3.S1 (BUG-003).
#   - SessionRuntime / getRuntime / freshRuntime → the field + reset-on-session_start are correct; unchanged.
#   - filter.ts, the metric shape, appendTurnMetric → unchanged.
#   - test/nudges.test.ts, test/edge-cases.test.ts → unaffected; do not edit (the regression test goes in
#     test/turn_metric.test.ts, the turnEndMetricHandler test home).
# This PRP edits ONLY src/nudges.ts (turnEndMetricHandler + JSDoc) + test/turn_metric.test.ts (+1 it()).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. `SessionRuntime.pendingBloatHits` (the field), `BloatHit` ({toolName, approxTokens}),
and `TurnMetricInput` are unchanged. Only the ORDER of statements in `turnEndMetricHandler`'s try body changes._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/nudges.ts — block-reorder inside turnEndMetricHandler (THE FIX)
  - LOCATE the try body span from getConfig through the clear (lines ~197–218).
  - FIND (verbatim current):
      "    const config = getConfig();\n    if (!config.enabled || !config.nudges.perTurnDrift) return; // both gates BEFORE measurement (GOTCHA #8)\n\n    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)\n\n    // (3) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw\n    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet\n    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),\n    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).\n    const now = rt.lastFiltered\n      ? estimateTokens(rt.lastFiltered).tokens\n      : (ctx.getContextUsage()?.tokens ?? 0);\n\n    // (4) Delta vs the baseline captured at the previous turn_end (or session_start). null on first turn.\n    const delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline;\n\n    // (5) Snapshot + CLEAR the bloat hits collected this turn by bloatReminderHandler (Nudge A). Grab the OLD\n    //     array reference (the metric's frozen snapshot), then REASSIGN the field to a fresh [] for next turn.\n    const bloat = rt.pendingBloatHits;\n    rt.pendingBloatHits = [];"
  - REPLACE WITH (getRuntime + snapshot+clear moved BEFORE the gate; now/delta renumbered (4)/(5); gate moved after the clear):
      "    const config = getConfig();\n    const rt = getRuntime(sessionId); // STRING arg, not ctx (GOTCHA #5)\n\n    // (3) Snapshot + CLEAR the bloat hits collected this turn by bloatReminderHandler (Nudge A) — ALWAYS,\n    //     every turn_end, BEFORE the perTurnDrift gate. BUG-004: bloatReminderHandler pushes here on its OWN\n    //     gate (bloatReminder, not perTurnDrift), so when bloatReminder=true but perTurnDrift=false the clear\n    //     must still run or pendingBloatHits grows without bound for the whole session. Grab the OLD array\n    //     reference (the metric's frozen snapshot — used in step 6, only when perTurnDrift is on), then\n    //     REASSIGN the field to a fresh [] for next turn.\n    const bloat = rt.pendingBloatHits;\n    rt.pendingBloatHits = [];\n\n    if (!config.enabled || !config.nudges.perTurnDrift) return; // both gates AFTER the bloat clear (GOTCHA #8)\n\n    // (4) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw\n    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet\n    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),\n    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).\n    const now = rt.lastFiltered\n      ? estimateTokens(rt.lastFiltered).tokens\n      : (ctx.getContextUsage()?.tokens ?? 0);\n\n    // (5) Delta vs the baseline captured at the previous turn_end (or session_start). null on first turn.\n    const delta = rt.tokenBaseline == null ? null : now - rt.tokenBaseline;"
  - RATIONALE: the snapshot+clear now runs unconditionally (before the gate) → pendingBloatHits is drained
    every turn_end even when perTurnDrift=false (BUG-004 fix). `bloat` captures the real hits BEFORE clearing,
    so the metric (step 6, unchanged — `bloatHit: bloat.length > 0`, `bloatHits: bloat`) is correct when
    perTurnDrift is on. getRuntime moves before the gate (the clear needs rt); getConfig stays first (gate
    needs config). sessionId stays FIRST overall (fail-open preserved).
  - PRESERVE: the metric construction block AFTER this (step 6: `const metric: TurnMetricInput = { … bloatHit:
    bloat.length > 0, bloatHits: bloat, … }`) — UNCHANGED (it already references `bloat`). appendTurnMetric +
    the baseline roll (steps 7/8) — UNCHANGED. The catch block — UNCHANGED.
  - DO NOT: move the clear above `sessionId = getSessionId()` (breaks fail-open); clear without snapshotting
    (breaks the metric); touch now/delta logic; touch shouldNudge/grewOverThreshold.

Task 2: EDIT src/nudges.ts — JSDoc paragraph on turnEndMetricHandler (Mode A)
  - LOCATE the JSDoc (lines ~177–194), the "NEVER throws … SYNC." paragraph followed by "WHY pi is a parameter".
  - FIND:
      " * (baseline missing) → the downstream nudge falls back to bloat-only signaling. SYNC (every dependency is sync).\n *\n * WHY pi is a parameter (GOTCHA #2): the turn_end callback only receives (event, ctx), but this handler must"
  - REPLACE WITH:
      " * (baseline missing) → the downstream nudge falls back to bloat-only signaling. SYNC (every dependency is sync).\n *\n * BUG-004: rt.pendingBloatHits is snapshot+CLEARed BEFORE the `perTurnDrift` early-return (always, every\n * turn_end), not after the gate. bloatReminderHandler (Nudge A) pushes to it on its OWN `bloatReminder` gate\n * (not perTurnDrift), so when bloatReminder=true but perTurnDrift=false the clear must still run or the\n * accumulator grows without bound for the whole session. The snapshot feeds the metric's bloatHit/bloatHits\n * (step 6) only when perTurnDrift is on (the gate still short-circuits measurement/metric/baseline-roll).\n *\n * WHY pi is a parameter (GOTCHA #2): the turn_end callback only receives (event, ctx), but this handler must"
  - RATIONALE: documents the new ordering + WHY (bloatReminder's gate is decoupled from perTurnDrift). Mode A
    inline doc. DO NOT edit the @param/@returns lines.

Task 3: EDIT test/turn_metric.test.ts — add the BUG-004 regression test
  - LOCATE the describe "turnEndMetricHandler — config gates short-circuit before measurement (GOTCHA #8)"
    (line 134). Its LAST it() is "nudges.perTurnDrift OFF → no metric, baseline unchanged" (line 146, closing
    `});` ~line 160). INSERT a new it(...) AFTER that test's closing `});` and BEFORE the describe's closing `});`.
  - INSERT:
      "  it(\"BUG-004: clears pendingBloatHits even when perTurnDrift is OFF (bloatReminder gate is separate)\", () => {\n    setConfig({\n      ...structuredClone(DEFAULT_CONFIG),\n      enabled: true,\n      nudges: { ...DEFAULT_CONFIG.nudges, perTurnDrift: false }, // bloatReminder stays default true\n    });\n    const { appended, pi } = makePi();\n    const { ctx } = makeCtx({ sessionId: \"s1\", tokens: 1000 });\n    const rt = getRuntime(\"s1\");\n    rt.tokenBaseline = 50;\n    rt.pendingBloatHits = [\n      { toolName: \"bash\", approxTokens: 5000 },\n      { toolName: \"read\", approxTokens: 3000 },\n    ];\n    turnEndMetricHandler(pi, makeEvent(3), ctx);\n    // No metric persisted (perTurnDrift off) + baseline NOT rolled (gate still short-circuits those)…\n    expect(appended).toHaveLength(0);\n    expect(rt.tokenBaseline).toBe(50);\n    // …but the accumulator IS cleared every turn_end (BUG-004 — no unbounded growth).\n    expect(rt.pendingBloatHits).toEqual([]);\n  });"
  - RATIONALE: the `expect(rt.pendingBloatHits).toEqual([])` assertion FAILS before the fix (the gate returns
    before the clear → 2 hits remain) and PASSES after. Mirrors the existing perTurnDrift-OFF test's idiom
    (setConfig/makePi/makeCtx/getRuntime/makeEvent). Seeds 2 hits to prove accumulation is bounded.
  - DEPENDENCIES: Task 1 (the fix must land for the test to pass). NO new imports (turnEndMetricHandler,
    getRuntime, setConfig, DEFAULT_CONFIG, makePi/makeCtx/makeEvent already imported in the file).
  - DO NOT: modify the existing perTurnDrift-OFF test (line 146) — keep its scope; add a NEW it().
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the try body is a linear pipeline. The reorder moves TWO things above the gate:
//   (a) const rt = getRuntime(sessionId);            // was after the gate
//   (b) const bloat = rt.pendingBloatHits;            // snapshot — was step (5) after the gate
//       rt.pendingBloatHits = [];                     // clear   — was step (5) after the gate
//   …then the gate… then now/delta/metric/append/roll (unchanged, but now/delta renumbered (4)/(5)).
//
// WHY the block (b), not just the reset:
//   tool_result (push) fires BEFORE turn_end within a turn. So between a pre-gate clear and an after-gate
//   snapshot, ZERO new hits arrive → an after-gate snapshot would be empty. Capturing bloat BEFORE clearing
//   (the block) preserves the real hits for the metric. (This is the contract's authoritative "Actually…"
//   framing — the earlier "move only the reset" framing is WRONG and would break test:241.)
//
// WHY fail-open is preserved: sessionId = getSessionId() is the FIRST statement; a throw there jumps to catch
//   before getRuntime/the clear → pendingBloatHits survives → hits retry next turn (test:398 stays green).
```

### Integration Points

```yaml
CODE:
  - modify: src/nudges.ts — turnEndMetricHandler block-reorder (Task 1) + JSDoc (Task 2)
  - unchanged: bloatReminderHandler (push site, line ~142) — its bloatReminder gate is correct; do not couple to perTurnDrift.
  - unchanged: the metric shape / appendTurnMetric / filter.ts — `bloat` still feeds bloatHit/bloatHits.
TESTS:
  - add: test/turn_metric.test.ts — 1 regression it() in the "config gates short-circuit" describe (Task 3)
  - unchanged: test/nudges.test.ts (bloatReminderHandler push tests), test/edge-cases.test.ts (turnEndMetricHandler
    fail-open + disabled tests — gate still returns before appendTurnMetric; getSessionId-throw still skips clear).

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config, no DB, no routes, no registration. Pure pipeline reorder.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Strict type-check — `bloat` is a const declared before the gate, used after it (same try block): type-clean.
npx tsc --noEmit
echo "tsc exit: $?"   # expect 0 (baseline was 0; the reorder adds no type error)

# Confirm the reorder landed (the clear now precedes the gate):
grep -n 'rt.pendingBloatHits = \[\]\|if (!config.enabled || !config.nudges.perTurnDrift)' src/nudges.ts
# EXPECT: the `rt.pendingBloatHits = []` line appears BEFORE the `if (!config.enabled …` line (lower line number).
```
Expected: tsc exit 0; the clear line number < the gate line number.

### Level 2: Unit Tests (Component Validation)

```bash
# The turnEndMetricHandler suite — the new regression test + the 3 preserved tests live here.
npx vitest run test/turn_metric.test.ts
# EXPECT: all pass, INCLUDING:
#   - the new "BUG-004: clears pendingBloatHits even when perTurnDrift is OFF" it() (GREEN after the fix;
#     was RED before — the assertion `expect(rt.pendingBloatHits).toEqual([])` failed with 2 hits remaining).
#   - "bloat snapshot THEN clear" (line 241) — still green (perTurnDrift ON; bloat captured before gate).
#   - "throwing getSessionId → pendingBloatHits NOT cleared" (line 398) — still green (clear is after sessionId).

# The bloatReminderHandler suite — unaffected (push side).
npx vitest run test/nudges.test.ts
# EXPECT: all green (the push site and its gates are unchanged).

# Full suite — regression guard.
npx vitest run
# EXPECT: all pass; count is baseline + 1 (the new regression it()). If a turn_metric test OTHER than the new
# one fails, the reorder broke a behavior — re-check that sessionId stayed first and the metric still uses `bloat`.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for this pure-handler fix is the Level-2 suite
# (it exercises turnEndMetricHandler end-to-end with a fake pi/ctx). Optionally, a direct REPL check:
npx tsx -e "
import { setConfig, getConfig, getRuntime } from './src/config.js';
import { turnEndMetricHandler } from './src/nudges.js';
" 2>/dev/null || echo "(if imports differ, rely on the vitest suite — it is the authoritative gate)"
# The vitest suite IS the integration proof (makePi/makeCtx drive the real handler with a fake pi).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for an in-memory accumulator-clear reorder. No UI/perf/security surface. Levels 1–3 cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` exits 0 (baseline 0; `bloat` const used later in the same try block is type-clean).
- [ ] `npx vitest run test/turn_metric.test.ts` — all pass, incl. the new BUG-004 regression it().
- [ ] `npx vitest run` — full suite passes (count = baseline + 1).
- [ ] In src/nudges.ts, `rt.pendingBloatHits = []` precedes the `if (!config.enabled || !config.nudges.perTurnDrift)` gate.

### Feature Validation
- [ ] `turnEndMetricHandler` with `perTurnDrift:false` + seeded `pendingBloatHits` leaves `rt.pendingBloatHits === []`.
- [ ] `turnEndMetricHandler` with `perTurnDrift:true` still snapshots the real hits into the metric (`bloatHit`/
      `bloatHits` correct; field reassigned to a fresh `[]`) — the bloat-snapshot test (line 241) stays green.
- [ ] A `getSessionId()` throw still skips the clear (pendingBloatHits preserved) — the fail-open test (line 398) stays green.
- [ ] JSDoc notes the clear runs before the `perTurnDrift` gate (BUG-004).
- [ ] No edits to any file other than `src/nudges.ts` and `test/turn_metric.test.ts`.

### Code Quality / Scope Discipline
- [ ] Moved the snapshot+clear as a BLOCK (not just the reset) — `bloat` captures real hits before clearing.
- [ ] `getRuntime` moved before the gate; `getConfig` stayed first; `sessionId = getSessionId()` stayed first overall.
- [ ] Did NOT touch `bloatReminderHandler` (push site), `shouldNudge`/`grewOverThreshold`/`driftThresholdTokens`
      (parallel M1.T3.S1), `SessionRuntime`, the metric shape, `appendTurnMetric`, or `filter.ts`.
- [ ] Did NOT edit test/nudges.test.ts or test/edge-cases.test.ts (unaffected; regression test goes in
      test/turn_metric.test.ts).
- [ ] Did NOT modify the existing perTurnDrift-OFF test (line 146) — added a NEW it().

### Documentation
- [ ] JSDoc paragraph added (Mode A inline doc) — this IS the doc for this subtask.

---

## Anti-Patterns to Avoid

- ❌ Don't move ONLY the reset (`rt.pendingBloatHits = []`) before the gate while leaving the snapshot after it —
  the after-gate snapshot would capture an empty array (tool_result fires before turn_end) → `bloatHit` always
  false → breaks test:241. Move the BLOCK (`const bloat = …; rt.pendingBloatHits = [];`) together.
- ❌ Don't move the clear ABOVE `sessionId = ctx.sessionManager.getSessionId()` — a throw there must skip the
  clear so the hits retry (fail-open; test:398). sessionId stays first; the clear comes after it (but before
  the gate).
- ❌ Don't "fix" this by gating `bloatReminderHandler`'s push on `perTurnDrift` — that suppresses the bloat
  reminder's own recording and couples two independently-designed nudges. The clear is the correct fix.
- ❌ Don't touch `shouldNudge` / `grewOverThreshold` / `driftThresholdTokens` — those are the parallel M1.T3.S1
  (BUG-003); disjoint regions, leave them alone.
- ❌ Don't edit test/nudges.test.ts or test/edge-cases.test.ts — the regression test belongs in
  test/turn_metric.test.ts (the turnEndMetricHandler test home); the others are unaffected.
- ❌ Don't modify the existing perTurnDrift-OFF test (line 146) — add a NEW it() so its scope/contract is preserved.

---

## Confidence Score

**9/10** for one-pass implementation success. The fix is a localized block-reorder with the verbatim current
span and the verbatim desired replacement (renumbered comments included). The one subtle correctness point —
move the BLOCK (snapshot+clear together), not just the reset — is the headline GOTCHA, explained with the
tool_result-before-turn_end reasoning and cross-referenced to the test it would break. The "no existing test
breaks" claim is traced concretely against the 3 relevant turn_metric.test.ts tests (perTurnDrift-OFF doesn't
assert pendingBloatHits; snapshot test has perTurnDrift ON so `bloat` is still captured; fail-open test throws
at sessionId which stays first). Residual risks: (1) the implementer moves only the reset (mitigated by
GOTCHA #1 + the FIND/REPLACE showing the block); (2) the implementer moves the clear above sessionId (mitigated
by GOTCHA #3 + the FIND placing getConfig/getRuntime/clear strictly after sessionId). Both are caught by
`npx vitest run test/turn_metric.test.ts` (specific failure signatures noted). No dependency on the parallel
item (disjoint functions in src/nudges.ts; either order).