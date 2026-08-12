# PRP — P1.M2.T1.S2: nudges.ts turnEndMetricHandler — use estimateAgentTokens (D10)

## Goal

**Feature Goal**: Make the per-turn drift `deltaTokens` **agent-attributable** (D10) by switching the `now`
computation in `turnEndMetricHandler` (`src/nudges.ts`) from the TOTAL `estimateTokens(rt.lastFiltered).tokens`
to the AGENT-ATTRIBUTABLE `estimateAgentTokens(rt.lastFiltered)` (exported by sibling S1). User prompts are
intentional ground-truth input — never bloat to shed — so a 50k-token user paste must NOT inflate the drift
delta or trip the drift nudge. The high-water signal (which measures TOTAL context, correctly) is UNCHANGED.

**Deliverable**: A surgical, ~3-edit change to **exactly one file** — `src/nudges.ts`:
1. Import line: replace `estimateTokens` with `estimateAgentTokens` (estimateTokens becomes unused in nudges.ts).
2. The `now` ternary: `estimateTokens(rt.lastFiltered).tokens` → `estimateAgentTokens(rt.lastFiltered)` (fallback unchanged).
3. The comment block above `now`: rewrite to cite D10.

**Success Definition**: After the edit (given S1 applied), (a) `deltaTokens` (=`now - rt.tokenBaseline`)
excludes user-message contributions — a user-heavy `rt.lastFiltered` no longer inflates `now`; (b) the
`ctx.getContextUsage()?.tokens ?? 0` fallback is byte-for-byte unchanged; (c) `rt.tokenBaseline = now` now
stores an agent-attributable baseline (apples-to-apples with the next delta); (d) the high-water signal
(`shouldHighWater` + its caller) is untouched; (e) `npx tsc --noEmit` introduces NO new errors (the
`estimateAgentTokens` import resolves; `rt.lastFiltered` is assignable to `MessageLike[]`).

> ⚠️ **Cross-item dependency (S2 → S1, HARD)**: S2 imports `estimateAgentTokens` from `./tokens.js`. Sibling
> **P1.M2.T1.S1** exports it (`export function estimateAgentTokens(messages: MessageLike[] | null | undefined):
> number` — sums `estimateTokens([msg]).tokens` for messages whose `role !== "user"`; pure, 0-import, uses
> module-private `readOwn`). S1 edits ONLY `src/tokens.ts`; S2 edits ONLY `src/nudges.ts` → disjoint, no merge
> conflict. **Assume S1 is applied** (per parallel_execution_context). Without S1, the import fails tsc and the
> call is `undefined` at runtime.

## User Persona (if applicable)

**Target User**: The agent receiving the drift nudge (and the operator watching for noise).

**Use Case**: The user pastes a 50k-token reference doc. Pre-D10, that inflated `now` → a large `deltaTokens`
→ the drift nudge fired, nagging the agent to rewind/shrink — but rewind/shrink can only legitimately target
AGENT output, not user input, so the nudge was unactionable noise. Post-D10, `now` excludes user messages, so
the paste does not trip the drift nudge. (The high-water nudge still fires on such a paste — correctly — because
the window genuinely is filling; its prescription is pure awareness, not rewind/shrink.)

**Pain Points Addressed**: spurious drift nudges on legitimate user input; conflation of "agent bloat" with
"user-provided ground-truth." D10 cleanly separates "the agent should shed something" (delta) from "the window
is getting full" (high-water total).

## Why

- **spec/07 §5.1 v1.1 note (D10)**: "Because Phase 1 now excludes `user` messages from `now`, a large
  user-supplied input never inflates the drift delta." This PRP implements that Phase-1 change.
- **Actionability**: the drift nudge prescribes `mulligan_rewind`/`mulligan_shrink`, which can only target
  agent output. Measuring agent-attributable tokens makes the delta's prescription coherent.
- **No new surface**: pure refactor of an existing computation — one helper call swap + import + comment.

## What

Three edits in `src/nudges.ts`, all inside `turnEndMetricHandler` (lines ~218–247) plus the import (line 42).

### Edit 1 — Import (line 42)
```ts
// CURRENT:
import { resultBytes, approxTokens, estimateTokens } from "./tokens.js";
// NEW:
import { resultBytes, approxTokens, estimateAgentTokens } from "./tokens.js";
```
**Rationale**: after Edit 2, `estimateTokens` has ZERO code usages in nudges.ts (verified: the only code call was
line 224; lines 440/447 are JSDoc in `shouldHighWater`, which takes `totalFilteredTokens` as a parameter and never
calls `estimateTokens`). `estimateAgentTokens` replaces it in the import. tsconfig has `strict:true` but NO
`noUnusedLocals`, so a dead import would not fail tsc — but replacing is the clean one-pass action (no dead code).

### Edit 2 — The `now` computation (lines 223–225)
```ts
// CURRENT:
    const now = rt.lastFiltered
      ? estimateTokens(rt.lastFiltered).tokens
      : (ctx.getContextUsage()?.tokens ?? 0);
// NEW:
    const now = rt.lastFiltered
      ? estimateAgentTokens(rt.lastFiltered)
      : (ctx.getContextUsage()?.tokens ?? 0);
```
**Rationale**: `estimateAgentTokens(rt.lastFiltered)` sums tokens over messages whose `role !== "user"` (D10).
The ternary structure is PRESERVED (only the truthy-branch expression changes); the `ctx.getContextUsage()?.tokens
?? 0` fallback is byte-for-byte UNCHANGED (it counts the raw session — acceptable as a pre-baseline fallback on
the no-filtered-view path; the no-delta path is unaffected since delta is null on the first turn).
**Type check**: `rt.lastFiltered` is `AgentMessage[]` (`Record<string,unknown>[]`), structurally assignable to
`estimateAgentTokens`'s `MessageLike[] | null | undefined` param (same assignability S1 verified for `estimateTokens`).

### Edit 3 — Comment block above `now` (lines 218–222) → cite D10
```ts
// CURRENT:
    // (4) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw
    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet
    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),
    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc).
// NEW:
    // (4) Current AGENT-ATTRIBUTABLE filtered token count (D10): user prompts are EXCLUDED — they are ground-truth
    //     input, never bloat to shed, and the drift nudge prescribes rewind/shrink (which can only legitimately
    //     target agent output). lastFiltered is the filter's cached output (what the model actually saw — D5/D6).
    //     Fallback to ctx.getContextUsage() only when no filtered view exists yet (first turn / context never
    //     fired) — it counts the raw session, acceptable as a pre-baseline fallback (the no-delta path is
    //     unaffected). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]), structurally
    //     assignable to estimateAgentTokens' MessageLike[] (GOTCHA #3).
```
**Rationale**: the old comment cited D5/D6 honest-bookkeeping + `estimateTokens`; the new comment cites D10
(agent-attributable, user excluded) + `estimateAgentTokens`, and keeps the fallback rationale. (Mode A inline doc.)

### What STAYS UNCHANGED (do NOT touch)
- `rt.tokenBaseline = now;` (line 247) — same code; now stores an agent-attributable baseline.
- The `ctx.getContextUsage()?.tokens ?? 0` fallback.
- `shouldHighWater` (~line 400+) and its caller `contextHandler` — the high-water signal measures TOTAL filtered
  context (D10 separates delta/agent-attributable from high-water/total). `estimateTokens` is still used by the
  CALLER (contextHandler) to compute `totalFilteredTokens` passed into `shouldHighWater` — that is OUTSIDE nudges.ts
  and NOT changed by S2.
- Everything else in nudges.ts (bloatReminderHandler, shouldNudge, injectNudge, suppressCheck, etc.).

### Success Criteria

- [ ] `estimateAgentTokens` is imported from `./tokens.js` in nudges.ts; `estimateTokens` is NOT (it's unused in nudges.ts after the swap).
- [ ] The `now` ternary's truthy branch calls `estimateAgentTokens(rt.lastFiltered)`; the `: (ctx.getContextUsage()?.tokens ?? 0)` fallback is byte-for-byte unchanged.
- [ ] The comment block above `now` cites D10 and references `estimateAgentTokens`.
- [ ] `rt.tokenBaseline = now` is unchanged (semantics now agent-attributable).
- [ ] `shouldHighWater` and the high-water path are untouched.
- [ ] `npx tsc --noEmit` introduces NO new errors (given S1 applied).
- [ ] No edits to any file other than `src/nudges.ts`.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current import line, the verbatim current `now` block (comment + ternary),
the verbatim desired replacements, the S1 contract for `estimateAgentTokens` (signature + behavior), the verified
fact that `estimateTokens` becomes unused in nudges.ts (with grep evidence), the type-assignability rationale,
the unchanged fallback + high-water guarantees, and the deterministic validation commands. The implementer needs
no exploration beyond opening `src/nudges.ts`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: src/nudges.ts
  why: (1) import line 42 (`from "./tokens.js"`) → swap estimateTokens → estimateAgentTokens.
        (2) turnEndMetricHandler `now` block (lines 218–225): comment + ternary → use estimateAgentTokens.
        (3) line 247 `rt.tokenBaseline = now` — unchanged (reference only).
  pattern: "turnEndMetricHandler is a SYNC never-throws handler (one try/catch → log + return). The `now`
            computation is step (4); `delta` step (5); metric step (6); persist step (7); baseline-roll step (8)."
  gotcha: "ONLY the truthy-branch expression of the `now` ternary changes. The fallback `: (ctx.getContextUsage()?
           .tokens ?? 0)` and the ternary structure are PRESERVED."

# MUST READ — the sibling contract (defines estimateAgentTokens, which S2 imports)
- file: plan/007_67d7d8c6e4c5/P1M2T1S1/PRP.md
  why: CONTRACT. S1 adds `export function estimateAgentTokens(messages: MessageLike[] | null | undefined): number`
        to src/tokens.ts (sums estimateTokens([msg]).tokens where readOwn(msg,"role") !== "user"; pure; 0-import).
        S1 edits ONLY src/tokens.ts → disjoint from S2 (src/nudges.ts).
  critical: "S2 REQUIRES S1 applied (else the import fails tsc + the call is undefined at runtime). Verify
             `grep -n 'export function estimateAgentTokens' src/tokens.ts` returns a hit BEFORE starting S2.
             Do NOT edit src/tokens.ts (S1 owns it)."

# MUST READ — the architecture touchpoint doc (confirms the exact line change)
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 4 'Agent-attributable drift delta (D10)' prescribes EXACTLY: 'In turnEndMetricHandler, replace
        estimateTokens(rt.lastFiltered).tokens with estimateAgentTokens(rt.lastFiltered). Keep
        ctx.getContextUsage()?.tokens ?? 0 fallback unchanged.' This PRP implements that verbatim."
  section: "§Change 4 (D10)."

# SHOULD READ — the spec D10 note (the why)
- docfile: spec/07-preventive-and-nudges.md
  why: "§5.1 v1.1 note (D10): 'Because Phase 1 now excludes user messages from now, a large user-supplied input
        never inflates the drift delta... The high-water signal (§5.2) still measures total filtered context and
        will still fire on such a paste (correctly) — this cleanly separates the agent should shed something
        (delta) from the window is getting full (high-water total).'"
  section: "h3.55 (§5.1 D10 note); h3.56 (§5.2 high-water, UNCHANGED)."

# CONTEXT — the helper S2 imports (READ-ONLY; S1 adds it, S2 does not)
- file: src/tokens.ts
  why: "After S1, exports estimateAgentTokens (after estimateTokens ~L126). S2 imports it. Pre-S1 it is absent."
  gotcha: "S2 must NOT edit tokens.ts. If estimateAgentTokens is absent, S1 hasn't landed — S2 cannot proceed."
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── nudges.ts    # ← THIS PRP edits: import (L42) + turnEndMetricHandler `now` block (L218–225) + comment
├── tokens.ts    # READ-ONLY for S2 — S1 adds estimateAgentTokens here (consumed by S2)
└── runtime.ts   # READ-ONLY — SessionRuntime.tokenBaseline / lastFiltered (the fields S2 reads/writes)
spec/07-preventive-and-nudges.md                       # READ-ONLY — §5.1 D10 note + §5.2 high-water (unchanged)
plan/007_67d7d8c6e4c5/architecture/change_surface.md   # READ-ONLY — §Change 4 (the exact line change)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
src/nudges.ts   # import swap + `now` uses estimateAgentTokens + D10 comment (turnEndMetricHandler only)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S2 REQUIRES S1 applied): estimateAgentTokens is exported by S1 from src/tokens.ts. If S1
//   has not landed, `grep -n 'export function estimateAgentTokens' src/tokens.ts` returns nothing → the import
//   fails tsc and the call is undefined at runtime. Verify S1 is present BEFORE editing. Do NOT add the helper
//   yourself (S1 owns tokens.ts).

// CRITICAL GOTCHA #2 (estimateTokens becomes UNUSED in nudges.ts — replace, don't add-and-leave-dead): grep
//   confirms estimateTokens is called in CODE at exactly ONE site (line 224); lines 440/447 are JSDoc in
//   shouldHighWater (which takes totalFilteredTokens as a PARAM, never calling estimateTokens itself). After the
//   swap, estimateTokens has zero code usages → REPLACE it with estimateAgentTokens in the import (line 42). Do
//   NOT leave a dead `estimateTokens` import. (tsconfig has no noUnusedLocals, so dead-import wouldn't fail tsc,
//   but it is unclean and some linters flag it.)

// CRITICAL GOTCHA #3 (the FALLBACK stays byte-for-byte): `: (ctx.getContextUsage()?.tokens ?? 0)` is UNCHANGED.
//   It counts the RAW session (includes user) and is ONLY hit on the no-filtered-view path (first turn / context
//   never fired). That is acceptable: on the first turn `delta` is null anyway (no baseline), so the no-delta path
//   is unaffected by the fallback counting user tokens. Do NOT "fix" the fallback to also exclude user — the
//   contract + arch §Change 4 say keep it unchanged.

// CRITICAL GOTCHA #4 (the high-water path is UNCHANGED): shouldHighWater (~L400) + contextHandler measure TOTAL
//   filtered context (D10: delta = agent-attributable, high-water = total). contextHandler computes
//   totalFilteredTokens via estimateTokens (OUTSIDE nudges.ts) and passes it as a param — S2 does NOT touch that.
//   Do NOT change shouldHighWater, renderHighWaterNudge, or injectHighWaterNudge.

// CRITICAL GOTCHA #5 (type assignability — no cast needed): rt.lastFiltered is AgentMessage[] (Record<string,
//   unknown>[]); estimateAgentTokens takes MessageLike[] | null | undefined. MessageLike has an index signature,
//   so AgentMessage[] is structurally assignable — NO cast (same as the pre-S2 estimateTokens call). If tsc
//   complains, re-check that S1's param type is `MessageLike[] | null | undefined` (not a narrower type).

// CRITICAL GOTCHA #6 (estimateAgentTokens already handles null/empty/non-array → 0): the ternary `rt.lastFiltered
//   ? estimateAgentTokens(rt.lastFiltered) : (fallback)` is PRESERVED for parity with the contract (keep the
//   fallback behind the `:`). Do NOT "simplify" to `estimateAgentTokens(rt.lastFiltered) || fallback` — that
//   changes semantics (0-token filtered view would fall through to the raw-session count). Keep the ternary.

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/tokens.ts → S1 (estimateAgentTokens). S2 only CONSUMES it.
#   - NEW/updated deltaTokens tests → S3 (P1.M2.T1.S3). S2 is the CODE change only (see Test-impact note).
#   - shouldHighWater / contextHandler / the high-water path → UNCHANGED (D10 separation).
#   - The fallback expression, rt.tokenBaseline assignment, bloatReminderHandler, shouldNudge, injectNudge, etc.
# This PRP edits ONLY the import + the `now` block (+ its comment) in src/nudges.ts turnEndMetricHandler.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data-model change. `SessionRuntime.tokenBaseline` / `lastFiltered` and `TurnMetricInput.deltaTokens`
types are unchanged. Only the VALUE of `now` (and thus `deltaTokens`) changes semantics: it now excludes user
messages. `estimateAgentTokens` (S1) is a pure helper with the same return type (`number`) as
`estimateTokens(...).tokens`._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/nudges.ts — import line 42 (swap estimateTokens → estimateAgentTokens)
  - PRECONDITION: verify S1 landed → `grep -n 'export function estimateAgentTokens' src/tokens.ts` returns a hit.
    If not, STOP (S1 not applied; S2 cannot proceed).
  - FIND (verbatim current): "import { resultBytes, approxTokens, estimateTokens } from \"./tokens.js\";"
  - REPLACE WITH:          "import { resultBytes, approxTokens, estimateAgentTokens } from \"./tokens.js\";"
  - RATIONALE: after Task 2, estimateTokens has zero code usages in nudges.ts → replace (not add-and-leave-dead).

Task 2: EDIT src/nudges.ts — the `now` ternary truthy branch (line 224)
  - FIND (verbatim current, the full ternary):
      "    const now = rt.lastFiltered\n      ? estimateTokens(rt.lastFiltered).tokens\n      : (ctx.getContextUsage()?.tokens ?? 0);"
  - REPLACE WITH:
      "    const now = rt.lastFiltered\n      ? estimateAgentTokens(rt.lastFiltered)\n      : (ctx.getContextUsage()?.tokens ?? 0);"
  - RATIONALE: D10 — agent-attributable token count (user prompts excluded). ONLY the truthy-branch expression
    changes (`estimateTokens(rt.lastFiltered).tokens` → `estimateAgentTokens(rt.lastFiltered)`). The fallback
    `: (ctx.getContextUsage()?.tokens ?? 0)` and the ternary structure are PRESERVED (contract + arch §Change 4).
  - DO NOT: change the fallback, remove the ternary, or add a cast.

Task 3: EDIT src/nudges.ts — the comment block above `now` (lines 218–222) → cite D10
  - FIND (verbatim current, the 4-line comment):
      "    // (4) Current filtered token count. lastFiltered is the filter's cached output (what the model actually saw\n    //     — D5/D6 honest bookkeeping). Fallback to ctx.getContextUsage() only when no filtered view exists yet\n    //     (first turn / context never fired). NO cast: rt.lastFiltered is AgentMessage[] (Record<string,unknown>[]),\n    //     structurally assignable to estimateTokens' MessageLike[] (GOTCHA #3, verified by tsc)."
  - REPLACE WITH: the D10 comment block from "What → Edit 3" verbatim (cites D10, agent-attributable, user
    excluded as ground-truth, fallback rationale, estimateAgentTokens assignability).
  - RATIONALE: the old comment cites estimateTokens; the new comment cites D10 + estimateAgentTokens (Mode A).
  - DO NOT: change step numbers of other steps, or touch the `// (5) Delta…` comment below.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: the ONLY behavioral change is the token-aggregation function on the truthy branch of one ternary.
//   BEFORE:  const now = rt.lastFiltered ? estimateTokens(rt.lastFiltered).tokens : (ctx.getContextUsage()?.tokens ?? 0);
//   AFTER:   const now = rt.lastFiltered ? estimateAgentTokens(rt.lastFiltered)   : (ctx.getContextUsage()?.tokens ?? 0);
//   estimateAgentTokens (S1) = sum of estimateTokens([msg]).tokens over messages whose role !== "user".

// PATTERN: the baseline roll (line 247) is UNCHANGED code — `rt.tokenBaseline = now;` — but now stores an
//   agent-attributable baseline. The NEXT delta = agent-attributable now − agent-attributable baseline = an
//   agent-attributable delta. Apples-to-apples (this is the point of D10).

// CRITICAL: the high-water signal (shouldHighWater + contextHandler) measures TOTAL filtered context and is
//   UNCHANGED. D10 separates "agent should shed" (delta) from "window is full" (high-water total). Do not
//   touch shouldHighWater/renderHighWaterNudge/injectHighWaterNudge or contextHandler's totalFilteredTokens.
```

### Integration Points

```yaml
NO PERSISTENCE/CONFIG/ROUTE/REGISTRATION INTEGRATION — a one-line computation swap (Mode A inline doc).
  - DATABASE/session: none (the turn-metric CustomEntry is still persisted by appendTurnMetric; only its
        deltaTokens VALUE's semantics change — it is now agent-attributable).
  - CONFIG: none.
  - CODE: src/nudges.ts (edited). CONSUMES src/tokens.ts::estimateAgentTokens (S1). READS SessionRuntime
          (tokenBaseline/lastFiltered — unchanged fields). FEEDS TurnMetricInput.deltaTokens (unchanged type).
  - DOWNSTREAM: shouldNudge (windowed delta gate) and renderDriftNudge now operate on an agent-attributable
        delta — semantically richer, no signature change. S3 (P1.M2.T1.S3) owns the tests for this.
```

---

## Test-impact note (S2 vs S3 split)

S2 is the **CODE** change; S3 (P1.M2.T1.S3) owns the **NEW** agent-attributable-delta tests. However, S2's
swap MAY change the value of `deltaTokens` in EXISTING turnEndMetricHandler tests (in `test/nudges.test.ts`)
**if** those tests pin a numeric `deltaTokens` with USER messages in the `rt.lastFiltered` fixture (user
contributions are now excluded → the delta shrinks). Decision rule for one-pass success:

- Run `npx vitest run test/nudges.test.ts` after the edits.
- If a `deltaTokens` assertion fails BECAUSE the fixture contains a `user` message whose tokens are now
  excluded: that is the EXPECTED D10 effect. Update that specific assertion to the new agent-attributable value
  (mirrors the "fix what your change breaks" rule — keep the existing suite green). This is S2's responsibility.
- If a NON-`deltaTokens` test fails: that is a BUG in S2 — investigate (you likely touched more than the `now` block).
- Do NOT write NEW D10-coverage tests (a user-paste-doesn't-inflate-delta scenario, etc.) — that is S3's scope.

(If `test/nudges.test.ts` has NO numeric `deltaTokens` assertions involving user messages — e.g. its fixtures are
all-assistant/toolResult — then S2 changes nothing in tests and the suite stays green as-is. Determine by running it.)

---

## Validation Loop

A one-line computation swap. Validation = tsc clean (given S1) + the existing suite green (or only expected
deltaTokens-assertion drift, per the Test-impact note) + a direct behavioral proof.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# PRECONDITION: S1 must be landed. Verify before anything else:
grep -n 'export function estimateAgentTokens' src/tokens.ts
# EXPECT: ≥1 hit (S1 applied). If nothing, STOP — S1 not present; S2 cannot proceed.

# Type-check. S2's edits are a helper-call swap + import swap + comment → they add NO new errors IF S1 is present.
# (Baseline may carry pre-existing errors from the in-progress P1.M1.T1.S4 to_previous_prompt removal; S2 adds none.)
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sort
# EXPECT: NO error mentioning src/nudges.ts, estimateAgentTokens, or turnEndMetricHandler. If nudges.ts errors
#   appear, the likely cause is a stale `estimateTokens` reference or an assignability issue — re-check Tasks 1–2.

# Confirm the swap landed and estimateTokens is gone from nudges.ts code:
grep -nE 'estimateAgentTokens|estimateTokens' src/nudges.ts
# EXPECT: estimateAgentTokens at the import (L42) + the `now` line (L224); estimateTokens ONLY in JSDoc (L440/447),
#         NOT in any code call and NOT in the import.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The nudges suite (turnEndMetricHandler lives here). Run after the edits:
npx vitest run test/nudges.test.ts
# EXPECT: green, OR only expected deltaTokens-assertion drift per the Test-impact note. If a NON-deltaTokens test
#   fails, S2 over-reached — re-check scope. Update now-stale deltaTokens assertions (user-message fixtures) to the
#   new agent-attributable values; do NOT add NEW D10 tests (S3).

# Full suite — regression guard (S2 changes only src/nudges.ts):
npx vitest run
# EXPECT: green (modulo the documented deltaTokens drift, if any). If an UNRELATED suite fails, re-check scope.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. The "system" validation for a computation swap is a direct behavioral proof:
npx tsx -e "
import { estimateAgentTokens } from './src/tokens.js';
// D10 proof: a user message is EXCLUDED from the agent-attributable count.
const msgs = [
  { role: 'user', content: 'X'.repeat(200000) },        // a 50k-token-class user paste
  { role: 'assistant', content: 'short reply' },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{type:'text', text:'data'}] },
];
console.log('agent-attributable tokens:', estimateAgentTokens(msgs));
// EXPECT: a SMALL number (only assistant + toolResult counted) — the giant user paste contributes ~0.
"
# (This proves the D10 behavior end-to-end. The same `msgs` fed to the OLD estimateTokens(msgs).tokens would be
#  huge; estimateAgentTokens excludes the user paste.) [Requires S1 applied.]
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a one-line computation swap. No UI/perf/security surface. Levels 1–3 fully cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `grep -n 'export function estimateAgentTokens' src/tokens.ts` → ≥1 hit (S1 applied; precondition).
- [ ] `npx tsc --noEmit` — NO new errors (no nudges.ts / estimateAgentTokens / turnEndMetricHandler errors).
- [ ] `npx vitest run test/nudges.test.ts` — green, or only expected deltaTokens drift (per Test-impact note).
- [ ] `npx vitest run` — full suite green (modulo documented drift).

### Feature Validation
- [ ] The `now` ternary's truthy branch calls `estimateAgentTokens(rt.lastFiltered)`.
- [ ] The `: (ctx.getContextUsage()?.tokens ?? 0)` fallback is byte-for-byte unchanged.
- [ ] `estimateAgentTokens` is imported; `estimateTokens` is NOT in the import (and has no code call in nudges.ts).
- [ ] The comment above `now` cites D10 (agent-attributable; user excluded as ground-truth).
- [ ] `rt.tokenBaseline = now` is unchanged; the high-water path is untouched.
- [ ] No edits to any file other than `src/nudges.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT edit `src/tokens.ts` (S1 owns estimateAgentTokens).
- [ ] Did NOT add NEW D10 tests (S3's scope) — only updated existing deltaTokens assertions broken by the swap, if any.
- [ ] Did NOT touch the fallback, the high-water path (shouldHighWater/contextHandler), or any other nudges.ts function.
- [ ] Did NOT leave a dead `estimateTokens` import.
- [ ] Did NOT add a cast (rt.lastFiltered is assignable to estimateAgentTokens' MessageLike[] param).

### Documentation
- [ ] The `now` comment cites D10 + references estimateAgentTokens (Mode A inline doc — this IS the doc).

---

## Anti-Patterns to Avoid

- ❌ Don't start without verifying S1 landed — `estimateAgentTokens` must be exported from `src/tokens.ts`. If
  absent, STOP (S1 not applied). Do NOT add the helper yourself (S1 owns tokens.ts).
- ❌ Don't change the FALLBACK (`: (ctx.getContextUsage()?.tokens ?? 0)`) — the contract + arch §Change 4 say keep
  it unchanged. It counts the raw session (includes user), acceptable on the no-filtered-view / first-turn path
  where `delta` is null anyway. "Fixing" it to exclude user would deviate from the contract.
- ❌ Don't touch the high-water path — D10 separates delta (agent-attributable) from high-water (total). Leave
  `shouldHighWater`/`renderHighWaterNudge`/`injectHighWaterNudge` and `contextHandler`'s totalFilteredTokens alone.
- ❌ Don't leave a dead `estimateTokens` import — it becomes unused in nudges.ts after the swap (verified by grep);
  REPLACE it with `estimateAgentTokens` in the import. Don't add both and leave estimateTokens dead.
- ❌ Don't "simplify" the ternary to `estimateAgentTokens(rt.lastFiltered) || fallback` — that changes semantics (a
  0-token filtered view would fall through to the raw-session count). Keep the `rt.lastFiltered ? … : …` structure.
- ❌ Don't add a cast — `rt.lastFiltered` (AgentMessage[]) is structurally assignable to `estimateAgentTokens`'s
  `MessageLike[] | null | undefined` param (MessageLike has an index signature).
- ❌ Don't write NEW D10 tests — that's S3. Only update EXISTING deltaTokens assertions your swap breaks (if any),
  to keep the suite green.
- ❌ Don't edit `src/tokens.ts`, `src/runtime.ts`, spec/07, README, or any test file's NEW content.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a one-line computation swap (plus import swap + comment) in
a single file, with the verbatim current code, the verbatim desired code, the S1 contract for `estimateAgentTokens`
(signature + behavior), the verified fact that `estimateTokens` becomes unused in nudges.ts (grep evidence), the
unchanged fallback + high-water guarantees, and a direct D10 behavioral proof. The two residual risks are both
mitigated: (1) the S1 dependency — flagged as a hard precondition with a `grep` check to run BEFORE editing, and
disjoint files (S1=tokens.ts; S2=nudges.ts) so no merge conflict; (2) the test-impact ambiguity — resolved by an
explicit decision rule (update existing deltaTokens assertions broken by the swap; NEW D10 coverage is S3) so the
implementer keeps the suite green without over-reaching. Deterministic gates: `npx tsc --noEmit` adds no new
errors; `npx vitest run` green modulo documented drift; the Level-3 proof shows a user paste contributes ~0.