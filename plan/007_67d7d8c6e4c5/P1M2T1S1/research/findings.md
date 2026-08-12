# Research Notes — P1.M2.T1.S1: tokens.ts `estimateAgentTokens` pure helper (D10)

> Add ONE exported pure helper to `src/tokens.ts`. No new imports, no test changes (S3 owns tests), no consumer
> wiring (S2 owns the nudges.ts call site). The helper sums `estimateTokens([msg]).tokens` over non-`user`
> messages — the agent-attributable token count for the D10 drift delta.

## 1. The insertion target — `estimateTokens` (src/tokens.ts:114–126)

```ts
export function estimateTokens(
  messages: MessageLike[] | null | undefined,
  _model?: unknown,
): TokenEstimate {
  const list = Array.isArray(messages) ? messages : [];
  let chars = 0;
  for (const msg of list) chars += messageCharLength(msg);
  const tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  return { tokens, confidence: DEFAULT_TOKEN_CONFIDENCE };
}
```
`estimateTokens([msg]).tokens` = `Math.ceil(messageCharLength(msg) / 4)` per single message (CHARS_PER_TOKEN=4,
line 91). The new helper SUMS these per-message estimates (each message ceiling-rounded independently — this is
the spec's "sum of estimateTokens over messages" semantics, NOT one ceiling on the total chars).

## 2. `readOwn` is module-private → ZERO new imports (the contract's "verify" → CONFIRMED)

`src/tokens.ts:181`:
```ts
function readOwn(obj: unknown, key: string): unknown {
  if (!isRecord(obj)) return undefined;
  try { return obj[key]; } catch { return undefined; }
}
```
Never throws (isRecord guard + try/catch). `readOwn(msg, "role")` returns the role string (or undefined for a
non-record/missing role). `readOwn(msg, "role") !== "user"` is the D10 filter. **No new import needed** — the
contract's fallback (`(msg as Record<string, unknown>)?.role`) is NOT required.

## 3. `MessageLike` (src/tokens.ts:61–65)
```ts
export interface MessageLike {
  role?: string;            // ← the discriminator (D10 excludes role === "user")
  content?: string | ContentBlock[];
  [key: string]: unknown;
}
```

## 4. The new helper (body per contract LOGIC)
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
- Non-array / null / undefined → 0 (defensive; never throws).
- `role !== "user"`: assistant / toolResult / tool / custom / bashExecution / no-role / non-record are all
  INCLUDED (agent-attributable). Only `role === "user"` is excluded (ground-truth input, per D10).
- A non-record message (readOwn → undefined → `!== "user"` true) is COUNTED + estimateTokens is defensive on it
  (≥0, never throws) — when in doubt, attribute to the agent (correct for a drift signal).
- Reuses `estimateTokens` + module-private `readOwn`. **0 new imports.**

## 5. Placement — immediately AFTER `estimateTokens` (line 126), BEFORE the `messageCharLength` JSDoc (line 128)
Groups the two PUBLIC estimators together; `messageCharLength`/`readOwn` (module-private helpers) stay below.
Function hoisting means estimateAgentTokens can reference messageCharLength (via estimateTokens) regardless of
definition order — no issue.

## 6. JSDoc (Mode A) — cites D10
Note: agent-attributable only; `user` prompts are ground-truth and excluded from the drift delta (spec/07 §2,
spec/04 §5); per-message ceiling sum; pure/Pi-free/0-import; never-throws; non-array → 0. Consumed by S2.

## 7. Scope / conflict / baseline
- **S2 (P1.M2.T1.S2)** will replace `estimateTokens(rt.lastFiltered).tokens` with `estimateAgentTokens(rt.lastFiltered)`
  in nudges.ts turnEndMetricHandler (change_surface.md §Change 4). Separate file; depends on this helper existing.
- **S3 (P1.M2.T1.S3)** owns the tests (test/tokens.test.ts has 0 estimateAgentTokens refs today). S1 = helper +
  JSDoc ONLY — do NOT add tests.
- **Parallel item P1.M1.T1.S4** is TEST-ONLY (to_previous_prompt removal in edge-cases/rewind/transforms/smoke
  test files). Does NOT touch src/. Zero file overlap.
- **Baseline tsc = 44 errors**, ALL in test files (S4's in-flight `to_previous_prompt` residue). NONE in
  src/tokens.ts. My pure addition → 0 NEW errors. S1 gate = `npx tsc --noEmit 2>&1 | grep 'src/tokens.ts'` empty
  (the 44 test errors are S4's job, out of scope).
- **test/tokens.test.ts** stays GREEN (adding an exported function is additive; existing tests unaffected).
- This PRP edits ONLY `src/tokens.ts` (1 insertion: JSDoc + function). Nothing else.

## 8. Spec cross-reference
- PRD h3.55 (§5.1 v1.1 note D10): "`deltaTokens` is agent-attributable … the user pasting a 50k-token reference
  doc does NOT trip the drift nudge — it is ground-truth input, not agent bloat."
- PRD h2.78 (§2 Phase 1 pseudocode): `estimateAgentTokens(rt.lastFiltered)` is the `now` for the drift delta.
- change_surface.md §Change 4: "ADD `estimateAgentTokens(messages: MessageLike[]): number` — sum of
  estimateTokens over messages where `role !== 'user'`. Pure, 0-import, unit-testable."