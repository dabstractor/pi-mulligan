# Codebase Recon — P1.M2.T1.S1 (estimateTokens)

First-hand findings from reading the pi-mulligan repo at the start of this subtask.

## 1. Where this file lives / build-order placement

- `spec/11-build-order.md` §1 layout:
  - `src/tokens.ts` — `# PURE: estimateTokens, resultBytes, approxTokens` (line 29).
  - `test/tokens.test.ts` — under `test/` (line 40).
- `spec/11` §2 **Step 2** (Pure helpers): "Implement `estimateTokens`, `resultBytes`, `approxTokens`" — grouped with `ledger.ts` + `notes.ts`.
  - ⚠️ **S1/S2 split**: P1.M2.T1.S1 = `estimateTokens`; **P1.M2.T1.S2** = `resultBytes` + `approxTokens`. BOTH add to `src/tokens.ts`. S1 CREATES the file; S2 APPENDS to it. **S1 must not stub/own the helpers that belong to S2.**
- `spec/11` line 193: "Everything under `tokens.ts` … is **pure and unit-testable without Pi**." → tokens.ts is a foundation-tier pure helper (no Pi import).

## 2. The function contract (from work-item description)

```
estimateTokens(messages: AgentMessage[], model?: unknown)
  → { tokens: number; confidence: 'low' | 'medium' | 'high' }
```
- **Heuristic only** — no tokenizer library (`spec/01` §7, `spec/03` §2.3, `external_deps.md` line 114: "tokens are estimated via character-count heuristic"). ~4 chars/token.
- Required properties: **monotonic in input length**, **empty → 0**, **confidence flag present** (`spec/10` §1.7).
- "known string yields a stable estimate (snapshot test)" (`spec/10` §1.7).
- "Return confidence 'medium' by default (configurable via audit config)."
- `model?` is `unknown` and v1-unused (forward-compat / model-specific calibration seam).
- Consumers (`spec/03` §2.3, `spec/04` §5/§9, `spec/05` §4, `spec/06` §7): `filter.ts` (turn metric), `tools/audit.ts`, `nudges.ts`.

## 3. Message/content-block shapes to stringify (VERIFIED — `architecture/api_verification.md` §6)

AgentMessage union = `UserMessage | AssistantMessage | ToolResultMessage | BashExecutionMessage | CustomMessage | BranchSummaryMessage | CompactionSummaryMessage`. For ESTIMATION we only need the common `content` field:

| role | content type |
|---|---|
| user | `string \| (TextContent \| ImageContent)[]` |
| assistant | `(TextContent \| ThinkingContent \| ToolCall)[]` |
| toolResult | `(TextContent \| ImageContent)[]` |
| custom | `string \| (TextContent \| ImageContent)[]` |
| bashExecution / branchSummary / compactionSummary | (not pinned in §6; treat defensively) |

Content blocks (`§6.2`):
- `TextContent { type:"text"; text:string }`
- `ThinkingContent { type:"thinking"; thinking:string }`
- `ImageContent { type:"image"; data:string; mimeType:string }` ← `data` is **base64**
- `ToolCall { type:"toolCall"; id:string; name:string; arguments:Record<string,any> }`

**Stringify plan** (per contract: "stringify content blocks and apply ~4 chars/token"):
- text → `.text` length
- thinking → `.thinking` length
- toolCall → `.name` + `JSON.stringify(.arguments)` length (the substance; id omitted as overhead)
- image → `.data` (base64) length — **deliberate overestimate**; the `confidence` flag conveys the fuzziness (`spec/01` §7: "more so with images"). Keeps the estimate monotonic + simple.

## 4. The `AgentMessage` type is NOT importable here (confirmed — same as P1.M1.T4S1 PRP GOTCHA #1)

- `node_modules/@earendil-works/` contains ONLY `pi-coding-agent`. `pi-agent-core` is **not hoisted** (transitive only).
- `import type { AgentMessage } from "@earendil-works/pi-agent-core"` → TS2307 under this tsconfig.
- The P1.M1.T4S1 PRP (runtime.ts) solved this with a LOCAL OPAQUE alias `type AgentMessage = Record<string, unknown>`.
- **tokens.ts needs MORE than opaque** — it introspects content blocks. So it defines its OWN LOCAL STRUCTURAL types (`MessageLike` + a `ContentBlock` union) matching the verified §6 shapes. It does NOT import runtime.ts's opaque alias (that gains nothing for introspection) and stays **import-free** (foundation discipline).

## 5. Foundation-module conventions to mirror (read live)

- **config.ts** (`src/config.ts`): exports `type EstimateConfidence = "low" | "medium" | "high"` (line 15) — the canonical confidence union, frozen by spec (`spec/04` §7, `spec/09` §2). Used by `MulliganConfig.audit.estimateConfidence` (default `"medium"`). tokens.ts will define a STRUCTURALLY IDENTICAL local `TokenConfidence` (no import) — assignable to/from config's type with no cast.
- **log.ts** (`src/log.ts`): fail-open pattern (try/catch around the risky op; never throws). tokens.ts mirrors this for `JSON.stringify(arguments)` (circular/BigInt) and Proxy-trap-throwing accessors.
- **runtime.ts** (`src/runtime.ts`, in-flight P1.M1.T4S1): module-scoped mutable state + `beforeEach` reset. tokens.ts has NO module-scoped mutable state → no `beforeEach` reset needed in its test.
- Test convention (`test/config.test.ts`, `test/log.test.ts`, `test/runtime.test.ts`): vitest; `import { … } from "../src/<file>.js"` (note `.js` for ESM+Bundler); top-level `describe/it`; `expectTypeOf` for type assertions.

## 6. The "configurable via audit config" seam (THE one design subtlety)

- estimateTokens is PURE → it CANNOT import config.ts (would break foundation discipline + create config↔tokens coupling).
- The fixed signature `(messages, model?)` has no config param.
- **Resolution**: estimateTokens returns `confidence: "medium"` (its default). The **audit tool** (P1.M5.T4S1) is the consumer that reads `config.audit.estimateConfidence` and OVERRIDES the reported confidence when rendering. So "configurable via audit config" = consumer-side override, not an estimateTokens param. This is the only faithful reading.

## 7. tsconfig / package.json facts (verified)

- `tsconfig.json`: `strict`, `noImplicitAny`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `types:["node"]`, `include:["src","test"]`.
- `package.json`: `"type":"module"`, devDeps `typescript ^5`, `vitest ^1`, `@types/node ^22`. `scripts.test = "vitest run"`. No vitest config file → vitest uses tsconfig.include + defaults.

## 8. Baseline state (run live at start of recon)

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `npx vitest run` → config + log suites green; `test/runtime.test.ts` has ONE failing assertion (the in-flight parallel task P1.M1.T4S1). **Not my concern** — tokens.ts is independent + pure; it cannot affect runtime.ts and vice versa.

## 9. Sibling/parallel boundaries (do NOT collide)

- **P1.M1.T4S1 (runtime.ts)** — in flight. Provides `SessionRuntime`/`BloatHit`/`AgentMessage` alias. tokens.ts does NOT import it.
- **P1.M2.T1.S2 (resultBytes + approxTokens)** — NEXT; appends to `src/tokens.ts`. S1 leaves room (S1 owns `estimateTokens` + the `CHARS_PER_TOKEN` constant + structural types; S2 adds byte-based helpers, possibly its own `BYTES_PER_TOKEN`).
- **Consumers (later)**: `tools/audit.ts` (P1.M5.T4S1) calls `estimateTokens([msg]).tokens` per message; `nudges.ts` (P1.M6.T2) uses it for the turn delta; `filter.ts` (P1.M4.T2) caches `lastFiltered` (runtime.ts) then estimates.