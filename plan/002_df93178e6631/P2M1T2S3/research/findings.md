# P2.M1.T2.S3 Research Findings — smoke.ts threshold references

## Scope (from item contract)
- **SINGLE FILE**: `test/integration/smoke.ts` (TypeScript extension loaded SECOND via `-e`).
- Comments + any threshold-dependent assertions must reflect the new defaults.
- S1 (done) raised global default 8192→16384 + added per-tool overrides {bash:32768, read:20480}.
- S2 (in parallel) updates `test/nudges.test.ts` — does NOT touch smoke.ts.

## The load-bearing insight — `mulligan_*` SKIP (verified in src/nudges.ts)
`bloatReminderHandler` short-circuits BEFORE the threshold measurement:
```ts
const config = getConfig();
if (!config.enabled || !config.nudges.bloatReminder) return;   // gate 1
if (event.toolName.startsWith("mulligan_")) return;            // GOTCHA #3 — gate 2 (BEFORE bytes)
const bytes = resultBytes(...);
const threshold = bloatThresholdFor(event.toolName, config);   // only reached for NON-mulligan_*
if (bytes < threshold) return;
```
- `mulligan_smoke_big`.startsWith("mulligan_") === **true** → ALWAYS skipped.
- Therefore the bloat reminder NEVER fires for `mulligan_smoke_big`, regardless of canary size or threshold.
- `mulligan_smoke_big` is NOT in the per-tool map → would resolve to global 16384 IF it weren't skipped — but it IS skipped, so resolution is moot.
- **Implication for the canary**: resizing `bigResult()` (9000 bytes) to >32KB would have NO effect on bloat detection. Do NOT resize. The canary's remaining job is to be a SHRINK TARGET (RESULT_CANARY observable) + a "big result" shape; its size is now arbitrary w.r.t. bloat.

## Per-tool resolution table (bloatThresholdFor, from S1)
| toolName        | resolves to | source                                  |
|-----------------|-------------|-----------------------------------------|
| `bash`          | 32768       | bloatThresholdBytesByTool.bash          |
| `read`          | 20480       | bloatThresholdBytesByTool.read          |
| `grep`/unknown  | 16384       | global bloatThresholdBytes (fallback)   |
| undefined / ""  | 16384       | global (falsy toolName → global)        |
| `mulligan_*`    | (n/a)       | SKIPPED by mulligan_* guard before resolve |

## Exact threshold references in test/integration/smoke.ts (grep-verified)
- **L14** (header Responsibilities): `(4) registerTool mulligan_smoke_big → returns a >8KB canary result (triggers Mulligan bloat reminder).` — STALE + INCORRECT (skip).
- **L135–136** (bigResult JSDoc): `the >8KB canary string ... >8KB exceeds config.nudges.bloatThresholdBytes (default 8192) → triggers the bloat reminder.` — STALE numbers + INCORRECT claim.
- **L139** (code): `return RESULT_CANARY + " " + "x".repeat(9000);` — size is moot now; keep but its comment must not claim bloat.
- **L198** (F-shrink-preventive): `The bloat reminder fires on the tool_result EVENT when a result exceeds bloatThresholdBytes (8KB).` — STALE number.
- **L199–203** (F-shrink-preventive model-driven note): `the agent calls mulligan_smoke_big → the >8KB result triggers the bloat reminder → turn-metric.bloatHit:true.` — INCORRECT (skip); bloatHit can NEVER be true via mulligan_smoke_big.
- **L493** (registerTool comment): `(4) registerTool mulligan_smoke_big — returns a >8KB canary result. The size triggers Mulligan's bloat reminder` — STALE + INCORRECT.
- **L498** (tool description string): `"SMOKE TEST TOOL. Returns a >8KB canary result. Call when asked."` — STALE number (cosmetic, tool label).

## run-smoke.mjs — NO threshold-dependent assertions
- L251–260 (assertShrinkPreventive): asserts ONLY `smoke.lines.some((l) => l.test === "tool.smoke_big")` (the log line fired).
- `bloatHit:true` is a **SOFT note string** (L260), NOT an assert(): `"bloatHit:true requires the model to call mulligan_smoke_big (model-driven); see scenarios.md"`.
- → No assertions need changing. The soft note is slightly misleading post-skip but is OUT OF SCOPE (item scopes to smoke.ts); flag as optional.

## Validation
- `package.json`: `"test": "vitest run"` (unit tests). smoke.ts is NOT imported by vitest suite → unit tests unaffected by comment edits.
- smoke.ts is TypeScript loaded by Pi via jiti at integration time → a `tsc`/build typecheck guards syntax. S3 only edits comments + a string literal, so risk is near-zero, but typecheck anyway.
- Integration smoke driver: `node test/integration/run-smoke.mjs` (separate from vitest; item says "npm test (including integration) passes").
- Canonical spec already updated: spec/07 L52 (`16384`), spec/09 L66 (`16384`). spec/10-testing.md L67 still says ">8KB" (SPEC DOC, out of scope for S3).

## Decision summary for PRP
1. Update every numeric threshold ref: 8192 → 16384; ">8KB" → ">16KB global (bash:32KB, read:20KB per-tool)".
2. CORRECT the false claim that mulligan_smoke_big triggers bloat: it is skipped by the mulligan_* guard. Comments must say so (design principle #5 honest bookkeeping).
3. Do NOT resize bigResult() (moot due to skip); keep 9000. Its job is shrink target, not bloat.
4. No assertion changes (confirmed none threshold-dependent).
5. run-smoke.mjs soft note: optional adjacent cleanup, not required.