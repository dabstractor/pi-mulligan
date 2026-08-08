# Codebase Recon — P1.M2.T1.S2 (`resultBytes` + `approxTokens`)

## 0. What this subtask is (one line)
APPEND two exported pure helpers — `resultBytes(content)` and `approxTokens(bytes)` — to the END of
`src/tokens.ts` (created by the parallel sibling **P1.M2.T1.S1**), and APPEND their unit tests to
`test/tokens.test.ts`. **No new files. No other file is modified.**

## 1. The sibling PRP (P1.M2.T1.S1) — read as a CONTRACT
Verified from `plan/001_2e5baf25fe9f/P1M2T1S1/PRP.md`. S1 **CREATES** `src/tokens.ts` and `test/tokens.test.ts`.
By the time S2 runs, S1's `src/tokens.ts` contains (exactly):

**Exported:**
- `export function estimateTokens(messages, _model?): TokenEstimate`
- `export const CHARS_PER_TOKEN = 4`   ← **S2 REUSES this** (the S1 PRP says "exported for transparency + S2/test reuse")
- `export type TokenConfidence = "low" | "medium" | "high"`
- `export interface TokenEstimate { tokens: number; confidence: TokenConfidence }`
- `export interface MessageLike { role?: string; content?: string | ContentBlock[]; [key: string]: unknown }`

**Module-LOCAL (NOT exported — but S2 is in the SAME file/module scope, so it CAN call them):**
- `interface TextContent { type: "text"; text: string }`
- `interface ThinkingContent { type: "thinking"; thinking: string }`
- `interface ImageContent { type: "image"; data: string; mimeType: string }`
- `interface ToolCallContent { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }`
- `type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent`
- `function messageCharLength(msg: MessageLike): number`
- `function blockCharLength(block: unknown): number`
- `function isRecord(value): value is Record<string, unknown>`   ← **S2 REUSES** (true for plain records)
- `function readOwn(obj, key): unknown`   ← **S2 REUSES** (read without throwing; Proxy-safe)
- `function stringLength(value: unknown): number`   ← returns `typeof v === "string" ? v.length : 0` — **S2 REUSES for the image `data` case** (base64 is ASCII → char length == byte length)
- `function safeStringLength(value: unknown): number` (JSON.stringify length, fail-open)

> KEY INSIGHT: S2 does NOT need to re-implement defensive record/string helpers — `isRecord`, `readOwn`, and
> `stringLength` already exist in the same module scope (JS/TS hoists function declarations, so an
> end-of-file `resultBytes` can call them). S2 only adds ONE new helper: `stringByteLength` (UTF-8 byte length
> via `Buffer.byteLength`), because `stringLength` measures CHARS not BYTES.

## 2. The tool_result `content` shape resultBytes receives (api_verification.md §7.2)
```ts
interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: (TextContent | ImageContent)[];   // ← ALWAYS an array; never a plain string
  isError: boolean;
  usage?: Usage;
}
```
- `TextContent  = { type: "text";  text: string }`
- `ImageContent = { type: "image"; data: string; mimeType: string }`   (`data` = base64)

spec/07 §1 calls `resultBytes(event.content)` directly on this array. So resultBytes operates on a
`(TextContent | ImageContent)[]`. The work-item CONTRACT gives a deliberately looser structural type
`{ type: string; text?: string; data?: string }[]` — broader, so a real `(TextContent | ImageContent)[]`
assigns in with no cast. S2 defines its own permissive `ResultContentBlock` (S1's TextContent/ImageContent are
module-local, not exported — and reusing them would be over-tight; resultBytes only reads `type`/`text`/`data`).

## 3. The asymmetry in the contract (read carefully — this is the crux)
The work-item contract (item_description §LOGIC) specifies:
- **text block**  → `Buffer.byteLength(block.text, "utf8")`   ← proper UTF-8 BYTE length (multibyte-aware)
- **image block** → `block.data?.length ?? 0`                  ← CHAR length of the base64 string

WHY the asymmetry: tool result TEXT can contain multibyte UTF-8 (emoji, accented letters, non-Latin) where
bytes > chars — so byte length needs `Buffer.byteLength`. Image `data` is base64 (pure ASCII: A–Z a–z 0–9 + /)
where char length == byte length exactly — so `.length` suffices and is what the contract pins. **Do not
"normalize" image to `Buffer.byteLength`** — the contract says `.length`; either gives the same number for
ASCII, but matching the contract verbatim avoids drift.

## 4. `Buffer` is available (no import) — verified
- `tsconfig.json` has `"types": ["node"]` + `@types/node ^22` in devDeps (package.json).
- `Buffer` is a **Node global** — no `import` needed. `node_modules/@types/node/buffer.d.ts` declares it.
- `Buffer.byteLength(str, "utf8")` is synchronous, O(n), never throws on valid strings.
  - `Buffer.byteLength("", "utf8")` → 0; `Buffer.byteLength("abc", "utf8")` → 3; `Buffer.byteLength("café", "utf8")` → 5 (é = 2 bytes).
- IMPORTANT: tokens.ts must remain **import-free** (S1 GOTCHA #2: `grep -cE '^import|^from' src/tokens.ts` → 0).
  `Buffer` is a global, so using it does NOT add an import line. S2 MUST NOT `import { Buffer }` (not needed,
  and it would break the zero-imports gate). Same discipline: `Math` is a JS builtin (used by S1). No new imports.

## 5. `approxTokens` reuses `CHARS_PER_TOKEN` (= 4)
- Work-item contract: `approxTokens(bytes): return Math.ceil(bytes / 4)`.
- `CHARS_PER_TOKEN = 4` is already exported by S1; the S1 PRP explicitly flags it "for S2/test reuse".
- For the ASCII/English text that dominates tool results, bytes ≈ chars, so the same ~4 ratio is the right
  byte→token heuristic. S2 reuses `CHARS_PER_TOKEN` (DRY — one canonical "4") rather than adding a redundant
  `BYTES_PER_TOKEN`. (The S1 PRP allowed S2 to "define its own BYTES_PER_TOKEN" — reuse is simpler & equivalent.)
- Defensive guard: contract is `bytes: number`, but `Math.ceil(NaN/4)=NaN`, `Math.ceil(Inf/4)=Inf`,
  `Math.ceil(-5/4)=-1` (negative tokens = nonsense). Guard non-finite + negative → return 0. For all valid
  non-negative input the behavior is EXACTLY `Math.ceil(bytes / 4)`. (resultBytes never yields negative bytes,
  so `approxTokens(resultBytes(...))` is always clean.)

## 6. Test convention (mirrors S1's test/tokens.test.ts + test/config.test.ts)
- vitest; import from `"../src/tokens.js"` (note the `.js` — ESM + Bundler resolution).
- top-level `describe`/`it`/`expect`/`expectTypeOf`; NO `beforeEach` (tokens.ts has no module-scoped mutable
  state for resultBytes/approxTokens — they are pure over their args).
- S1's test file already has the import block:
  ```ts
  import { describe, it, expect, expectTypeOf } from "vitest";
  import {
    estimateTokens,
    CHARS_PER_TOKEN,
    type TokenEstimate,
    type TokenConfidence,
    type MessageLike,
  } from "../src/tokens.js";
  ```
  S2 EDITS this import (adds `resultBytes`, `approxTokens`, `type ResultContentBlock`) and APPENDS new
  `describe` blocks at the END of the file. (S2 must not recreate the file — S1 owns it.)

## 7. Consumers (downstream — none import yet; listed to anchor scope)
- `nudges.ts` tool_result handler (P1.M6.T1.S1): `const bytes = resultBytes(event.content); if (bytes <
  config.nudges.bloatThresholdBytes) return; ... recordBloatHit(ctx, toolName, approxTokens(bytes))`.
  (spec/07 §1 — verbatim usage shown in the PRP Context.)
- `TurnMetric.bloatHits[].approxTokens` (spec/04 §5): the number `approxTokens(bytes)` produces is stored in
  the turn-metric entry. So `approxTokens`'s output shape is part of the persisted data model.
- This is WHY resultBytes measures BYTES (the threshold `bloatThresholdBytes` default 8192 is in bytes) while
  approxTokens converts to a rough token count for the metric/audit display.

## 8. Baseline state (verified live, this recon)
- `src/`: index.ts, config.ts (S1+S2 present), log.ts, runtime.ts present. **No tokens.ts yet** (S1 creates it).
- `test/`: config.test.ts, log.test.ts, runtime.test.ts present. **No tokens.test.ts yet** (S1 creates it).
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (verified). vitest config = defaults (no vitest.config file).
- node_modules/@earendil-works/pi-coding-agent hoisted; pi-agent-core NOT (irrelevant — S2 adds no Pi import).

## 9. Scope boundaries (what S2 does NOT do)
- Does NOT modify `src/index.ts`, `src/config.ts`, `src/log.ts`, `src/runtime.ts`.
- Does NOT change S1's `estimateTokens`/`CHARS_PER_TOKEN`/types (append-only; S2 ADDS to tokens.ts).
- Does NOT implement the tool_result handler itself (that is P1.M6.T1.S1) — only the two pure helpers it calls.
- Does NOT import anything (Buffer/Math/JSON are globals/builtins; zero-import gate stays green).