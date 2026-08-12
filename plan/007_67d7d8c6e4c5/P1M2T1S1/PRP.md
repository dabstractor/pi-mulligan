# PRP — P1.M2.T1.S1: `tokens.ts` — add `estimateAgentTokens` pure helper (D10)

## Goal

**Feature Goal**: Add a single exported pure helper `estimateAgentTokens(messages): number` to `src/tokens.ts`
that returns the **agent-attributable** token count of a message list — the sum of `estimateTokens([msg]).tokens`
over every message whose `role !== "user"`. This is the D10 primitive: user prompts are ground-truth input
(never bloat to shed), so they are excluded from the drift delta. Consumed downstream by S2
(`turnEndMetricHandler` uses it for the drift `now`) and tested by S3.

**Deliverable**: An edit to **exactly one file** — `src/tokens.ts`: one new exported function + its JSDoc
(Mode A inline docs), inserted immediately after `estimateTokens` (line 126). No new imports, no test changes,
no consumer wiring.

**Success Definition**: After the edit, `estimateAgentTokens` is exported from `src/tokens.ts`;
`estimateAgentTokens([{role:"user",content:"xxxx"},{role:"assistant",content:"yyyy"}])` returns `1` (the
4-char assistant message → ⌈4/4⌉=1 token; the user message EXCLUDED). `npx tsc --noEmit` introduces NO new
errors in `src/tokens.ts` (the 44 pre-existing errors are all in test files, owned by the in-progress parallel
S4). `npx vitest run test/tokens.test.ts` stays green (additive change).

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers; indirectly the drift-nudge subsystem (S2's `turnEndMetricHandler`).

**Use Case**: At `turn_end`, the drift delta is computed from the agent-attributable token count, so a large
user-supplied paste (e.g. a 50k-token reference doc) does NOT trip the drift nudge — it is intentional input,
not agent bloat.

**Pain Points Addressed**: Pre-D10, the drift delta counted user input, so pasting reference docs could falsely
fire the rewind/shrink nudge. D10 excludes user messages from the measurement; this helper is the primitive
that realizes it.

## Why

- **D10 realization (spec/07 §2 / §5.1 v1.1 note)**: the drift nudge prescribes rewind/shrink, which can only
  legitimately target *agent* output. Measuring agent-attributable tokens cleanly separates "the agent should
  shed something" (delta, agent-attributable) from "the window is getting full" (high-water, total). PRD h3.55
  spells this out explicitly.
- **Pure, Pi-free, 0-import, unit-testable**: the helper lives in `tokens.ts` (a 0-import pure module) and
  reuses the already-exported `estimateTokens` + the module-private `readOwn` — no new dependencies.
- **Unblocks S2/S3**: S2 wires it into `turnEndMetricHandler`; S3 tests it. This S1 is the primitive both depend on.

## What

One new exported function + JSDoc in `src/tokens.ts`, inserted after `estimateTokens`. Body: defensive
non-array → 0; loop summing `estimateTokens([msg]).tokens` for each message where `readOwn(msg, "role") !== "user"`.
Never throws (reuses estimateTokens + readOwn's defensive discipline). No signature/algorithm change to any
existing function; no new imports.

### Success Criteria

- [ ] `src/tokens.ts` exports `estimateAgentTokens(messages: MessageLike[] | null | undefined): number`,
      placed immediately after `estimateTokens` (before the `messageCharLength` JSDoc).
- [ ] Body: `if (!Array.isArray(messages)) return 0;` then sum `estimateTokens([msg]).tokens` for each `msg`
      where `readOwn(msg, "role") !== "user"`.
- [ ] Uses the **module-private `readOwn`** (src/tokens.ts:181) — ZERO new imports.
- [ ] JSDoc cites D10 (agent-attributable only; user prompts are ground-truth, excluded from the drift delta;
      spec/07 §2, spec/04 §5) + notes pure/0-import/never-throws/non-array→0.
- [ ] `npx tsc --noEmit` introduces NO new errors in `src/tokens.ts` (the 44 pre-existing test-file errors from
      the in-progress parallel S4 are out of scope).
- [ ] `npx vitest run test/tokens.test.ts` stays green (additive; no existing test changes).
- [ ] No file other than `src/tokens.ts` is modified. No test changes (S3 owns tests). No consumer wiring (S2).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP carries the verbatim current `estimateTokens` body, the confirmed module-private `readOwn`
(line 181, never-throws), the `MessageLike.role` field, the exact desired function body, the verbatim JSDoc
content, the precise insertion point, and the accurate baseline (tsc has 44 pre-existing test-file errors from
the parallel S4 — none in src/tokens.ts). The implementer needs no exploration beyond opening `src/tokens.ts`.

### Documentation & References

```yaml
# MUST READ — the ONLY file this PRP modifies
- file: src/tokens.ts
  why: estimateTokens (lines 114–126) — the function the new helper reuses; insert immediately after its
        closing brace (line 126). readOwn (line 181) — module-private, the defensive role reader (ZERO new
        imports). MessageLike (line 61) — `role?: string`. CHARS_PER_TOKEN = 4 (line 91).
  pattern: "estimateTokens([msg]).tokens = Math.ceil(messageCharLength(msg)/4) per single message. The new
            helper SUMS these per-message estimates (each message ceiling-rounded independently). readOwn is
            the same defensive reader messageCharLength uses (isRecord guard + try/catch → never throws)."
  gotcha: "readOwn is module-private (line 181) — CONFIRMED available, so NO new import. Do NOT use the
           contract's fallback cast; do NOT add any import (tokens.ts is a 0-import pure module by design)."

# MUST READ — the spec primitive this realizes (D10)
- file: spec/07-preventive-and-nudges.md
  why: §2 Phase 1 pseudocode uses `estimateAgentTokens(rt.lastFiltered)` as the drift `now`; §5.1 v1.1 note
        (D10) explains WHY user messages are excluded (ground-truth input, not agent bloat; the user pasting a
        50k-token doc must NOT trip the drift nudge).
  section: "§2 (Nudge B Phase 1); §5.1 v1.1 note (D10 — deltaTokens is agent-attributable)."
  gotcha: "READ-ONLY — do NOT edit spec/07. The JSDoc cites it."

# SHOULD READ — the change-surface research (confirms the exact signature + the S2 consumer)
- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: §Change 4 prescribes 'ADD estimateAgentTokens(messages: MessageLike[]): number — sum of estimateTokens
        over messages where role !== "user". Pure, 0-import, unit-testable.' and notes S2 replaces
        estimateTokens(rt.lastFiltered).tokens → estimateAgentTokens(rt.lastFiltered) in nudges.ts.
  critical: "the signature in the contract/research is (MessageLike[] | null | undefined) — ACCEPT null/undefined
             (defensive, non-array → 0). Do NOT narrow to MessageLike[] only."

# CONTEXT — the consumer + test owner (confirms S1 = helper only; no consumer/test edits here)
- file: plan/007_67d7d8c6e4c5/architecture/external_deps.md
  why: Documents tokens.ts as a 0-import pure module; estimateAgentTokens is consumed by nudges.ts (S2) and
        tested in test/tokens.test.ts (S3). S1 adds ONLY the helper + JSDoc.
  critical: "do NOT wire the consumer (nudges.ts — S2) or add tests (test/tokens.test.ts — S3) in this subtask."

# CONTEXT — the parallel item (confirms no src/ overlap + explains the baseline tsc state)
- file: plan/007_67d7d8c6e4c5/P1M1T1S4/PRP.md
  why: CONTRACT. S4 is TEST-ONLY (to_previous_prompt removal across edge-cases/rewind/transforms/smoke test
        files). It does NOT touch src/. The 44 baseline tsc errors are ALL in test files (S4's in-flight
        residue); NONE in src/tokens.ts. My pure addition → 0 new errors.
  critical: "the baseline tsc is RED (44 errors) from S4 — do NOT try to fix those (out of scope). The S1 gate
             is 'no NEW errors in src/tokens.ts', NOT 'tsc exit 0'."
```

### Current Codebase tree (the only relevant slice)

```bash
src/
└── tokens.ts            # ← EDIT: add estimateAgentTokens (JSDoc + fn) after estimateTokens (line 126)
spec/07-preventive-and-nudges.md  # READ-ONLY reference — §2/§5.1 D10
test/
└── tokens.test.ts       # READ-ONLY here — S3 owns the estimateAgentTokens tests (0 refs today)
src/nudges.ts            # READ-ONLY here — S2 wires the consumer (turnEndMetricHandler)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
src/tokens.ts   # +1 exported function (estimateAgentTokens) + its JSDoc, after estimateTokens
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (readOwn is module-private — ZERO imports): src/tokens.ts:181 defines
//   `function readOwn(obj: unknown, key: string): unknown` (isRecord guard + try/catch → never throws). It is
//   CONFIRMED available in module scope. Use `readOwn(msg, "role") !== "user"` directly. Do NOT add an import,
//   do NOT use the contract's `(msg as Record<string, unknown>)?.role` fallback — that fallback was only for
//   the case where readOwn was absent, which it is NOT.

// CRITICAL GOTCHA #2 (per-message ceiling, NOT one ceiling on the sum): the helper SUMS
//   `estimateTokens([msg]).tokens` per message. Each call ceiling-rounds THAT message independently
//   (Math.ceil(messageCharLength(msg)/4)). This is the spec's "sum of estimateTokens over messages" semantics
//   and may differ slightly from Math.ceil(totalChars/4). Do NOT "optimize" by summing messageCharLength and
//   dividing once — messageCharLength is module-private and the contract prescribes estimateTokens([msg]).
//   (You CAN see messageCharLength, but follow the contract: use estimateTokens([msg]).tokens.)

// CRITICAL GOTCHA #3 (the role filter is !== "user", not === "assistant"): D10 excludes ONLY role === "user".
//   assistant / toolResult / tool / custom / bashExecution / no-role / non-record are all INCLUDED
//   (agent-attributable). A message with no role (or a non-record → readOwn returns undefined → !== "user" true)
//   is COUNTED — when in doubt, attribute to the agent (correct for a drift signal; estimateTokens is defensive
//   on it). Do NOT whitelist specific roles.

// CRITICAL GOTCHA #4 (baseline tsc is RED — 44 errors, all in test files): the in-progress parallel S4
//   (to_previous_prompt removal) leaves 44 tsc errors in test/edge-cases.test.ts, test/tools/rewind.test.ts,
//   test/transforms.test.ts, test/integration/smoke.ts. NONE in src/tokens.ts. My pure addition adds ZERO new
//   errors. The S1 gate is `npx tsc --noEmit 2>&1 | grep 'src/tokens.ts'` → empty (NOT "tsc exit 0"). Do NOT
//   fix the 44 test errors (S4's job).

// OUT OF SCOPE (do NOT touch in this subtask):
#   - src/nudges.ts (turnEndMetricHandler call site) → P1.M2.T1.S2 wires estimateAgentTokens in.
#   - test/tokens.test.ts (the estimateAgentTokens tests) → P1.M2.T1.S3.
#   - estimateTokens / messageCharLength / readOwn bodies → reuse as-is; do not modify.
#   - spec/07, spec/04, README → read-only / owned by P3.
# This PRP edits ONLY src/tokens.ts (1 insertion: JSDoc + function).
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no data-model change. `MessageLike` (line 61, `role?: string`), `TokenEstimate`, and `CHARS_PER_TOKEN`
are unchanged. The new helper reuses the existing `estimateTokens` + module-private `readOwn`._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tokens.ts — insert estimateAgentTokens (JSDoc + function) after estimateTokens
  - LOCATE the end of estimateTokens (line 126 `}`) immediately followed by the messageCharLength JSDoc (line 128).
  - FIND (verbatim current — the estimateTokens return + closing brace + the start of the messageCharLength JSDoc):
      "  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);\n  return { tokens, confidence: DEFAULT_TOKEN_CONFIDENCE };\n}\n\n/**\n * messageCharLength — the character length of one message's stringified content. Pure + defensive: a message with"
  - REPLACE WITH (insert the new JSDoc + function BETWEEN estimateTokens and the messageCharLength JSDoc):
      "  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);\n  return { tokens, confidence: DEFAULT_TOKEN_CONFIDENCE };\n}\n\n/**\n * estimateAgentTokens — the AGENT-ATTRIBUTABLE token count of a message list: the sum of estimateTokens\n * over every message whose `role !== \"user\"` (D10 — spec/07 §2, spec/04 §5). User prompts are intentional\n * ground-truth input, never bloat to shed, and the drift nudge prescribes rewind/shrink (which can only\n * legitimately target agent output) — so a large user-supplied paste must NOT inflate the drift delta.\n * Consumed by turnEndMetricHandler (P1.M2.T1.S2) as the agent-attributable `now` for the drift delta.\n *\n * Semantics: sums estimateTokens([msg]).tokens per non-user message (each message is ceiling-rounded\n * independently — see estimateTokens' GOTCHA #5). A message with no `role` (or a non-record) is NOT \"user\" →\n * counted (when in doubt, attribute to the agent). Pure, Pi-free, 0-import (reuses module-private readOwn).\n * NEVER throws (estimateTokens + readOwn are both defensive — mirrors messageCharLength's discipline).\n *\n * @param messages the message list (a real Pi AgentMessage[] assigns in with no cast); non-array → 0\n * @returns the agent-attributable token estimate (non-negative integer); empty/non-array → 0\n */\nexport function estimateAgentTokens(messages: MessageLike[] | null | undefined): number {\n  if (!Array.isArray(messages)) return 0;\n  let total = 0;\n  for (const msg of messages) {\n    if (readOwn(msg, \"role\") !== \"user\") total += estimateTokens([msg]).tokens;\n  }\n  return total;\n}\n\n/**\n * messageCharLength — the character length of one message's stringified content. Pure + defensive: a message with"
  - RATIONALE: realizes D10 — agent-attributable token count (user prompts excluded). Reuses estimateTokens (the
    per-message estimator) + module-private readOwn (the defensive role reader) — 0 new imports. Per-message
    ceiling sum is the spec's "sum of estimateTokens over messages" semantics. Never throws (both deps defensive).
  - PRESERVE: estimateTokens (unchanged), messageCharLength/readOwn (unchanged), all other exports.
  - DO NOT: add any import; use the fallback cast; whitelist roles (use !== "user"); "optimize" with messageCharLength;
    wire the nudges.ts consumer (S2); add tests (S3); touch the 44 baseline test errors (S4).
```

#### Resulting function (post-edit)

```ts
export function estimateAgentTokens(messages: MessageLike[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    if (readOwn(msg, "role") !== "user") total += estimateTokens([msg]).tokens;
  }
  return total;
}
```

### Implementation Patterns & Key Details

```typescript
// PATTERN: tokens.ts is a 0-import PURE module. Every helper is defensive (never throws). The new function
// follows the same discipline: non-array → 0; reuses estimateTokens + the module-private readOwn.

// estimateTokens([msg]).tokens — the per-message estimate (Math.ceil(messageCharLength(msg)/4)). Summing these
// is the spec's "sum of estimateTokens over messages" (each message ceiling-rounded independently).

// readOwn(msg, "role") (src/tokens.ts:181) — isRecord guard + try/catch → returns the role string or undefined,
// never throws. `!== "user"` is the D10 filter (excludes ONLY user prompts; everything else is agent-attributable).

// WHY !== "user" (not a role whitelist): Pi roles include assistant/toolResult/tool/custom/bashExecution and
// may grow. D10's intent is "exclude user ground-truth" — a single negative check is robust to new roles and
// counts no-role/non-record messages as agent-attributable (the safe default for a drift signal).
```

### Integration Points

```yaml
CODE:
  - add: src/tokens.ts — estimateAgentTokens (JSDoc + fn), after estimateTokens
  - consumed-by (NO change here): src/nudges.ts turnEndMetricHandler — S2 (P1.M2.T1.S2) replaces
    estimateTokens(rt.lastFiltered).tokens → estimateAgentTokens(rt.lastFiltered) (change_surface §Change 4).
TESTS:
  - DO NOT add tests here — P1.M2.T1.S3 owns test/tokens.test.ts (0 estimateAgentTokens refs today).
  - test/tokens.test.ts stays GREEN (additive export; no existing test changes).

CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. Pure helper; no config, no DB, no routes, no registration. 0 new imports.
```

---

## Validation Loop

> **Baseline note:** `npx tsc --noEmit` currently reports **44 errors**, ALL in test files (the in-progress
> parallel S4 — `to_previous_prompt` removal — has not yet fixed them). **None are in `src/tokens.ts`.** This
> pure addition introduces **zero new** errors. The S1 gate is "no `src/tokens.ts` errors", NOT "tsc exit 0".

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check. The 44 pre-existing test-file errors remain; the gate is that NONE mention src/tokens.ts.
npx tsc --noEmit 2>&1 | grep 'src/tokens.ts' && echo "FAIL: new error in tokens.ts" || echo "PASS: no tokens.ts errors"
# EXPECT: PASS (empty grep). estimateAgentTokens is type-clean: MessageLike[]|null|undefined → number;
# readOwn returns unknown (===/!== comparisons accept unknown); estimateTokens([msg]).tokens is a number.

# Confirm the export landed:
grep -n 'export function estimateAgentTokens' src/tokens.ts   # expect 1 hit
```

### Level 2: Unit Tests (Component Validation)

```bash
# The tokens suite — adding an export is ADDITIVE; existing tests are unaffected (S3 adds the new tests later).
npx vitest run test/tokens.test.ts
# EXPECT: all pass (same count as baseline; estimateAgentTokens is not yet asserted — S3 adds those). If a test
# FAILS, the insertion accidentally altered an existing function — re-check the FIND span (estimateTokens body
# must be byte-identical; only an INSERT between it and messageCharLength).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — no service/endpoint/DB. Direct REPL proof of the D10 behavior (user excluded, agent counted):
npx tsx -e "
import { estimateAgentTokens } from './src/tokens.js';
const user = { role: 'user', content: 'x'.repeat(40) };       // 40 chars → would be 10 tokens if counted
const asst = { role: 'assistant', content: 'y'.repeat(8) };   // 8 chars → ⌈8/4⌉ = 2 tokens
const tool = { role: 'toolResult', content: [{ type: 'text', text: 'z'.repeat(4) }] }; // 4 → 1 token
console.log('user+asst ->', estimateAgentTokens([user, asst]));     // 2 (user EXCLUDED)
console.log('asst+tool ->', estimateAgentTokens([asst, tool]));     // 3 (2 + 1)
console.log('all      ->', estimateAgentTokens([user, asst, tool])); // 3 (user excluded)
console.log('empty    ->', estimateAgentTokens([]));                // 0
console.log('null     ->', estimateAgentTokens(null));              // 0
"
# EXPECT: user+asst -> 2 ; asst+tool -> 3 ; all -> 3 ; empty -> 0 ; null -> 0. (Proves user-exclusion + defensiveness.
# These exact cases become S3's unit tests; running them here is a one-pass confidence check.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for a pure token-counting helper. No UI/perf/security surface. Levels 1–3 cover correctness.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit 2>&1 | grep 'src/tokens.ts'` → empty (0 new errors; the 44 test-file errors are S4's).
- [ ] `npx vitest run test/tokens.test.ts` — all pass (additive; no existing test changes).
- [ ] Level 3 spot-check: user message excluded; assistant/toolResult counted; null/[]→0.

### Feature Validation
- [ ] `estimateAgentTokens` is exported from `src/tokens.ts`, placed after `estimateTokens`.
- [ ] Body: non-array → 0; sum `estimateTokens([msg]).tokens` where `readOwn(msg, "role") !== "user"`.
- [ ] Uses module-private `readOwn` — ZERO new imports.
- [ ] JSDoc cites D10 (agent-attributable; user prompts are ground-truth, excluded) + pure/0-import/never-throws.
- [ ] No edits to any file other than `src/tokens.ts`.

### Code Quality / Scope Discipline
- [ ] Did NOT wire the consumer (`src/nudges.ts` turnEndMetricHandler — that is S2).
- [ ] Did NOT add tests (`test/tokens.test.ts` — that is S3).
- [ ] Did NOT modify `estimateTokens` / `messageCharLength` / `readOwn` (reused as-is).
- [ ] Did NOT add any import (tokens.ts stays a 0-import pure module).
- [ ] Did NOT use the contract's fallback cast (readOwn is confirmed available).
- [ ] Did NOT touch the 44 baseline test errors (S4's in-flight `to_previous_prompt` residue).

### Documentation
- [ ] JSDoc on `estimateAgentTokens` cites D10 + spec/07 §2 / spec/04 §5 (Mode A inline doc) — this IS the doc.

---

## Anti-Patterns to Avoid

- ❌ Don't add an import for `readOwn` — it is module-private in tokens.ts (line 181); use it directly. And don't
  use the contract's `(msg as Record<string, unknown>)?.role` fallback — that was only if readOwn were absent.
- ❌ Don't "optimize" by summing `messageCharLength` and dividing once — the contract prescribes
  `estimateTokens([msg]).tokens` (per-message ceiling sum, the spec's semantics). messageCharLength is private;
  reuse estimateTokens as instructed.
- ❌ Don't whitelist roles (e.g. `role === "assistant" || role === "toolResult"`) — D10 excludes ONLY `user`;
  use `!== "user"` so new Pi roles and no-role/non-record messages default to agent-attributable.
- ❌ Don't wire the consumer or add tests here — nudges.ts is S2; test/tokens.test.ts is S3. S1 = helper + JSDoc.
- ❌ Don't expect `npx tsc --noEmit` to exit 0 — the baseline is RED (44 test errors from the in-progress S4).
  The gate is "no NEW errors in src/tokens.ts". Do NOT fix those 44 (out of scope).
- ❌ Don't touch estimateTokens, messageCharLength, readOwn, spec/07, or README — reuse / read-only.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a single additive pure function with the verbatim
desired body, the confirmed module-private `readOwn` (zero imports), the exact insertion point (after
estimateTokens, before the messageCharLength JSDoc), and a JSDoc that cites D10. The two non-obvious points
are both resolved by direct verification: (1) `readOwn` IS in tokens.ts (line 181) — no fallback cast/import
needed; (2) the baseline tsc is RED (44 test errors from the parallel S4) — the gate is "no src/tokens.ts
errors", not "exit 0". Residual risks: an implementer who adds an unnecessary import or whitelists roles — both
caught by the Level-1 grep (`grep 'src/tokens.ts'`) + the Level-3 REPL spot-check (which proves user-exclusion
and the !== "user" semantics). No dependency on the parallel item (separate files); S2/S3 consume/test this
later.